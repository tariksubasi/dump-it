"use strict";
// Unit tests (a test microflow for the Marketplace UnitTesting module) and moving an attribute within its
// generalization chain (a model refactoring: the stored values do not move with it).
const sdk = require("mendixmodelsdk");
const { validName, fail, bool, validate } = require("./ops-util");

const { domainmodels: dm, microflows: mf, datatypes } = sdk;

const GENERAL_OPS = {
    createUnitTest: {
        doc: "Create a unit test microflow for the UnitTesting module (Marketplace): name Test_..., returns Boolean, prepare with actions, then the asserts (UnitTesting's AssertTrue action when it has one, else checks that return false). Refused when the UnitTesting module is not in the project.",
        fields: {
            module: "R module the test goes in (the UnitTesting module runs the Test_ microflows of every module)", name: "R test name (Test_ is added when missing), e.g. Test_OrderTotal",
            asserts: "R [ { \"that\": \"Boolean expression\", \"message\": \"text shown when it fails\" } ] (or just the expressions)",
            actions: "optional [ actions ] before the asserts: create test data, call the flow under test (see ops createMicroflow)", folder: "optional folder path (default Tests)"
        }
    },
    moveAttribute: {
        doc: "Move an attribute to its entity's parent or a specialization (same generalization chain, any module), optionally renamed. Model only: stored values are NOT moved (refused unless allowDataLoss). Lists every place that uses it.",
        fields: {
            attribute: "R Module.Entity.Attribute", to: "R Module.Entity: a generalization (parent) or specialization of the attribute's entity",
            newName: "optional new attribute name", allowDataLoss: "optional true: the user agreed that the stored values of this attribute are dropped (the new column starts empty)"
        }
    }
};

const ASSERT_SPEC = { fields: { that: "R", message: "" } };

function makeGeneral(h) {
    const { model, client, get, exists } = h;

    // ------------------------------------------------ createUnitTest

    // UnitTesting's assert Java action: AssertTrue2 (value, message) or AssertTrue1 (value); null when it has none.
    async function assertAction() {
        for (const n of ["AssertTrue2", "AssertTrue1", "AssertTrue"]) {
            const ja = model.allJavaActions().find(x => x.qualifiedName === `UnitTesting.${n}`);
            if (!ja) continue;
            const a = await ja.load();
            const params = [...a.actionParameters];
            const typeOf = p => p.actionParameterType && p.actionParameterType.type && p.actionParameterType.type.structureTypeName;
            const value = params.find(p => /BooleanType/.test(typeOf(p) || ""));
            const message = params.find(p => /StringType/.test(typeOf(p) || ""));
            if (value) return { qn: a.qualifiedName, value: value.name, message: message ? message.name : null };
        }
        return null;
    }

    async function createUnitTest(o) {
        const ut = model.allModules().find(m => m.name === "UnitTesting");
        if (!ut) {
            throw new Error(`the UnitTesting module is not in this project, so nothing would run the test. Import it first: download "Unit Testing" from the Mendix Marketplace (a .mpk) into the export folder, then { "op": "importModulePackage", "file": "UnitTesting.mpk" }; then createUnitTest again`);
        }
        if (o.module === "UnitTesting") throw new Error(`createUnitTest: put the test in your own module (the one it tests), not in UnitTesting`);
        const name = /^test/i.test(String(o.name)) ? String(o.name).replace(/^test_?/i, "Test_") : `Test_${o.name}`;
        validName(name, "test name");
        const qn = `${o.module}.${name}`;
        if (await exists(qn)) throw new Error(`${qn} already exists`);
        if (!Array.isArray(o.asserts) || !o.asserts.length) throw new Error(`${qn}: asserts is [ { "that": "$Order/Total = 10", "message": "total" } ] (at least one)`);
        const asserts = o.asserts.map((x, i) => {
            const a = typeof x === "string" ? { that: x } : x;
            if (!a || typeof a !== "object") throw new Error(`${qn} assert ${i + 1}: { "that": "Boolean expression", "message": "..." }`);
            validate("-", "assert", ASSERT_SPEC, a, `${qn} assert ${i + 1}`);
            return { that: String(a.that), message: a.message === undefined ? `assert ${i + 1}: ${a.that}` : String(a.message) };
        });
        const quote = s => `'${s.replace(/'/g, "''")}'`;
        const act = await assertAction();
        const checks = act
            ? asserts.map(a => ({ action: "callJava", javaAction: act.qn, args: { [act.value]: a.that, ...(act.message ? { [act.message]: quote(a.message) } : {}) }, caption: `Assert: ${a.message}`.slice(0, 80) }))
            : asserts.map(a => ({ action: "if", condition: `not(${a.that})`, then: [{ action: "log", level: "Error", message: `FAILED: ${a.message}`.replace(/[{}]/g, "") }, { action: "end", value: "false" }] }));
        await h.impl().createMicroflow({ module: o.module, name, folder: o.folder === undefined ? "Tests" : o.folder, returns: "Boolean", returnValue: "true", actions: [...(o.actions || []), ...checks] });
        return `${qn} (unit test: ${asserts.length} assert(s) ${act ? `with ${act.qn}` : "as checks that return false (UnitTesting has no AssertTrue action)"}; run it from UnitTesting's test overview)`;
    }

    // ------------------------------------------------ moveAttribute

    // All loaded entities of the project with their generalization chain (own entity first; System parents end it).
    async function allEntities() {
        const out = [];
        for (const d of model.allDomainModels()) out.push(...(await d.load()).entities);
        return out;
    }
    function chainOf(e) {
        const chain = [e];
        let g = e.generalization;
        for (let i = 0; i < 20 && g instanceof dm.Generalization && g.generalization; i++) {
            chain.push(g.generalization);
            g = g.generalization.generalization;
        }
        return chain;
    }

    async function moveAttribute(o) {
        const a = await get(o.attribute);
        if (!(a instanceof dm.Attribute)) throw new Error(`'${o.attribute}' is not an attribute`);
        const from = a.containerAsEntity;
        const to = await h.entity(o.to);
        const ents = await allEntities();
        if (to === from) throw new Error(`${o.attribute} is already in ${o.to}`);
        const up = chainOf(from).includes(to);
        const down = chainOf(to).includes(from);
        if (!up && !down) {
            const related = ents.filter(x => x !== from && (chainOf(from).includes(x) || chainOf(x).includes(from))).map(x => x.qualifiedName);
            fail(`${o.to} is not in the generalization chain of ${from.qualifiedName}; an attribute moves to a parent or a specialization only${related.length ? ` (here: ${related.join(", ")})` : " (it has none)"}`, o.to, related);
        }
        const newName = o.newName === undefined ? a.name : String(o.newName);
        validName(newName, "attribute name");
        // the name must be free in the new owner, its parents and every entity that inherits from it
        const clash = ents.filter(x => chainOf(x).includes(to) || chainOf(to).includes(x)).flatMap(x => x.attributes.filter(y => y !== a && y.name === newName).map(() => x.qualifiedName));
        if (clash.length) throw new Error(`${clash.join(", ")} already ${clash.length > 1 ? "have" : "has"} an attribute '${newName}' (inherited names must be unique); give "newName"`);
        const idx = from.indexes.filter(ix => ix.attributes.some(ia => ia.attribute === a));
        if (idx.length) throw new Error(`${o.attribute} is in ${idx.length} index(es) of ${from.qualifiedName}; remove it from the index first (deleteIndex), then move it`);
        const oldQn = a.qualifiedName;
        const calculated = a.value instanceof dm.CalculatedValue;
        const stored = h.persistable(from) && !h.isFresh(oldQn) && !calculated;
        if (stored && !bool(o.allowDataLoss, false)) {
            throw new Error(`moving ${oldQn} drops its stored values: the column of ${from.name} is removed and ${to.name} gets an empty one when the app next starts. Ask the user; with their yes add "allowDataLoss": true (or first copy the values with a microflow)`);
        }
        // who uses it, before the move (pages, flows, XPath, expressions, mappings, access rules)
        let usage = [];
        try {
            usage = require("./refs").usages(client, oldQn).split("\n").filter(l => l.trim() && !/^\(by name/.test(l));
        } catch {
            usage = []; // created earlier in this plan: nothing uses it yet
        }
        a.detach();
        to.attributes.push(a);
        // references store the qualified name: a name change makes the Model SDK rewrite every one (as rename does)
        const keep = a.name;
        a.name = `${keep}ZzMoving`;
        a.name = newName;
        // validation rules go with it; member accesses where the new owner is not in the entity's chain go
        const moved = [];
        for (const r of [...from.validationRules]) {
            if (r.attribute !== a) continue;
            r.detach();
            to.validationRules.push(r);
            moved.push(r);
        }
        let dropped = 0;
        for (const x of ents) {
            if (chainOf(x).includes(to)) continue;
            for (const r of x.accessRules) {
                for (const ma of [...r.memberAccesses]) {
                    if (ma.attribute === a) {
                        ma.delete();
                        dropped++;
                    }
                }
            }
        }
        await h.addMemberToRules(to, a);
        for (const x of ents) for (const r of x.accessRules) for (const ma of r.memberAccesses) if (ma.attribute === a) ma.attribute = a;
        for (const r of to.validationRules) if (r.attribute === a) r.attribute = a;
        const lines = [];
        if (moved.length) lines.push(`${moved.length} validation rule(s) moved with it`);
        if (dropped) lines.push(`${dropped} member access(es) removed from rules of entities that no longer have it`);
        if (down) lines.push(`NOTE: objects of ${from.name} that are not ${to.name} no longer have ${newName}: expressions, XPath and widgets on ${from.name} that use it must change (Studio Pro shows them as errors)`);
        if (calculated) lines.push(`NOTE: it is calculated by ${a.value.microflowQualifiedName}; check that microflow's parameter fits ${to.qualifiedName}`);
        if (stored) lines.push(`DATA LOSS: the stored values of ${oldQn} are dropped when the app next starts (allowDataLoss: true)`);
        if (usage.length) lines.push(`USED BY (by name; references move with it, check that each still fits ${to.qualifiedName}):`, ...usage.slice(1, 25).map(l => "  " + l.trim()), ...(usage.length > 25 ? [`  ... ${usage.length - 25} more lines (usages ${oldQn} before applying)`] : []));
        return `${oldQn} -> ${to.qualifiedName}.${newName} (${up ? "up to the parent" : "down to the specialization"})` + lines.map(l => `\n      ${l}`).join("");
    }

    const checks = {
        async createUnitTest(o) {
            const name = /^test/i.test(String(o.name)) ? String(o.name).replace(/^test_?/i, "Test_") : `Test_${o.name}`;
            const m = await get(`${o.module}.${name}`);
            const r = [];
            if (!(m instanceof mf.Microflow)) return [`${o.module}.${name} is not a microflow`];
            if (!(m.microflowReturnType instanceof datatypes.BooleanType)) r.push(`${o.module}.${name} does not return a Boolean`);
            const act = await assertAction();
            if (act) {
                let n = 0;
                m.traverse(x => x instanceof mf.JavaActionCallAction && x.javaActionQualifiedName === act.qn && n++);
                if (n !== o.asserts.length) r.push(`${o.module}.${name} calls ${act.qn} ${n} time(s), expected ${o.asserts.length}`);
            }
            return r;
        },
        async moveAttribute(o) {
            const name = o.newName === undefined ? o.attribute.split(".")[2] : o.newName;
            const r = [];
            if (!(await exists(`${o.to}.${name}`))) r.push(`${o.to}.${name} missing`);
            if (o.attribute !== `${o.to}.${name}` && (await exists(o.attribute))) r.push(`${o.attribute} still exists`);
            return r;
        }
    };
    return { impl: { createUnitTest, moveAttribute }, checks };
}

module.exports = { makeGeneral, GENERAL_OPS };
