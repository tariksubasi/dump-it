"use strict";
// selftest: runs every operation on a temporary copy of a project and checks the result the way a reviewer would:
// saved without loss, every op visible after a fresh reload, the same BSON layout Studio Pro writes for each type in
// this project, a byte-identical roundtrip, a clean reopen in the Model SDK, and a module rename that leaves no old
// references. Nothing touches the real project.
const fs = require("fs");
const os = require("os");
const path = require("path");
const bson = require("./bson");
const { Project } = require("./mpr");
const { LocalClient, loadProject } = require("./client");
const { lostProperties } = require("./lost");

function plans(mod, T) {
    const role = `${mod}.ZzRole`;
    const E = `${mod}.${T}`;
    const phase1 = { ops: [
        { op: "createEnumeration", module: mod, name: `${T}Status`, values: ["Open", { name: "Done", caption: "Done!" }] },
        { op: "createEntity", module: mod, name: T, attributes: [
            { name: "Title", type: "String(100)" }, { name: "Count", type: "Integer" }, { name: "Big", type: "Long" },
            { name: "Amount", type: "Decimal" }, { name: "Flag", type: "Boolean" }, { name: "When", type: "DateTime" },
            { name: "Status", type: `Enum(${mod}.${T}Status)`, default: "Open" }, { name: "No", type: "AutoNumber" }] },
        { op: "createEntity", module: mod, name: `${T}Base`, attributes: [{ name: "CreatedNote", type: "String(200)" }] },
        { op: "createEntity", module: mod, name: `${T}Line`, persistable: true },
        { op: "setGeneralization", entity: `${E}Line`, generalization: `${E}Base` },
        { op: "addAttribute", entity: `${E}Line`, name: "Text", type: "String(unlimited)" },
        { op: "addAssociation", from: `${E}Line`, to: E },
        { op: "addEnumerationValue", enumeration: `${E}Status`, name: "Cancelled" },
        { op: "changeAttribute", attribute: `${E}.Title`, type: "String(200)" },
        { op: "createModuleRole", module: mod, name: "ZzRole" },
        { op: "addAccessRule", entity: E, roles: [role], access: "ReadWrite", create: true, members: { Count: "ReadOnly" } },
        { op: "addValidationRule", entity: E, attribute: "Title", rule: "required", message: "Title is required" },
        { op: "addValidationRule", entity: E, attribute: "Count", rule: "range", min: 0, max: 1000, message: "0..1000" },
        { op: "addValidationRule", entity: E, attribute: "Title", rule: "maxLength", maxLength: 150, message: "Too long" },
        { op: "addIndex", entity: E, attributes: ["Title", { name: "Count", ascending: false }] },
        { op: "createConstant", module: mod, name: `${T}_Url`, type: "String", default: "https://example.com", folder: "ZzTest" },
        { op: "createMicroflow", module: mod, name: `${T}_Sub`, folder: "ZzTest", parameters: [{ name: "Item", type: E }],
            returns: "Boolean", returnValue: "true", actions: [{ action: "log", message: "sub {1}", args: ["$Item/Title"] }] },
        { op: "addEventHandler", entity: E, moment: "Before", event: "Commit", microflow: `${E}_Sub` },
        { op: "createMicroflow", module: mod, name: `${T}_Main`, folder: "ZzTest", roles: [role], actions: [
            { action: "variable", name: "N", type: "Integer", value: "0" },
            { action: "retrieve", variable: "List", entity: E, xpath: "[Flag = true()]" },
            { action: "retrieve", variable: "One", entity: E, first: true },
            { action: "if", condition: "$One = empty", then: [{ action: "message", text: "Nothing found", type: "Warning" }, { action: "end" }] },
            { action: "create", variable: "New", entity: E, set: { Title: "'x'", Count: "1" } },
            { action: "change", variable: "New", set: { Flag: "true" } },
            { action: "loop", over: "List", item: "It", actions: [
                { action: "if", condition: "$It/Count > 10", then: [{ action: "continue" }] },
                { action: "change", variable: "It", set: { Count: "$It/Count + 1" }, commit: true },
                { action: "call", microflow: `${E}_Sub`, args: { Item: "$It" }, variable: "Ok",
                    onError: { rollback: false, actions: [{ action: "log", message: "failed", level: "Error" }, { action: "continue" }] } }] },
            { action: "loop", while: "$N < 3", actions: [{ action: "set", name: "N", value: "$N + 1" }] },
            { action: "commit", variable: "New", onError: { actions: [{ action: "log", message: "commit failed", level: "Error" }] } },
            { action: "call", microflow: `${E}_Sub`, args: { Item: "$New" }, onError: "continue" },
            { action: "message", text: "Done", type: "Information" },
            { action: "delete", variable: "New" }] },
        { op: "addActions", microflow: `${E}_Main`, after: "One", actions: [{ action: "log", message: "inserted" }] },
        { op: "addActions", microflow: `${E}_Main`, after: "New", actions: [{ action: "log", message: "after create" }] },
        { op: "createMicroflow", module: mod, name: `${T}_Job`, folder: "ZzTest", actions: [{ action: "log", message: "job" }] },
        { op: "createScheduledEvent", module: mod, name: `${T}_Nightly`, microflow: `${E}_Job`, every: "Day", at: "02:30", folder: "ZzTest" },
        { op: "createScheduledEvent", module: mod, name: `${T}_Poll`, microflow: `${E}_Job`, every: "Minute", interval: 15, folder: "ZzTest" },
        { op: "createPage", module: mod, name: `${T}_Edit`, entity: E, title: "Edit", folder: "ZzTest", roles: [role] },
        { op: "createPage", module: mod, name: `${T}_Home`, folder: "ZzTest" },
        { op: "createMicroflow", module: mod, name: `${T}_Open`, folder: "ZzTest", actions: [
            { action: "create", variable: "Obj", entity: E },
            { action: "showPage", page: `${E}_Edit`, args: { [T]: "$Obj" } }] },
        { op: "createNanoflow", module: mod, name: `${T}_NF`, folder: "ZzTest", parameters: [{ name: "Item", type: E }], actions: [
            { action: "if", condition: "$Item/Flag", then: [{ action: "message", text: "Flagged" }],
                else: [{ action: "call", microflow: `${E}_Sub`, args: { Item: "$Item" }, variable: "Ok" }] },
            { action: "closePage" }] },
        { op: "createMicroflow", module: mod, name: `${T}_Rest`, folder: "ZzTest", parameters: [{ name: "Id", type: "Long" }], returns: "String", returnValue: "'ok'" },
        { op: "publishRest", module: mod, service: `${T}API`, resource: "items", method: "Get", path: "{Id}", microflow: `${E}_Rest`, roles: [role], folder: "ZzTest" },
        { op: "grantAccess", document: `${E}_Sub`, roles: [role] },
        { op: "moveDocument", document: `${E}_Job`, folder: "ZzTest/Moved" }
    ] };
    return { phase1, role, E };
}

// Keys and BSON kinds Studio Pro writes per type, from this project's own data (before the change).
function ownLayout(catalog) {
    const layout = new Map();
    for (const [type, keys] of catalog.types) {
        if (catalog.reference && catalog.reference.has(type)) continue;
        layout.set(type, new Map([...keys].filter(([k]) => k[0] !== "$").map(([k, d]) => [k, d.k])));
    }
    return layout;
}

function layoutProblems(layout, enc) {
    const problems = new Set();
    let checked = 0;
    const walk = n => {
        if (n.k !== 3) return;
        const t = n.v.find(([k]) => k === "$Type");
        const want = t && layout.get(t[1].v);
        if (want) {
            checked++;
            const have = new Map(n.v.map(([k, x]) => [k, x.k]));
            for (const k of want.keys()) if (!have.has(k)) problems.add(`${t[1].v} lacks ${k}`);
            for (const [k, kind] of have) {
                if (k[0] === "$") continue;
                if (!want.has(k)) problems.add(`${t[1].v} has extra ${k}`);
                else if (want.get(k) !== kind && kind !== 0x0a && want.get(k) !== 0x0a) problems.add(`${t[1].v}.${k} kind ${kind} (Studio Pro: ${want.get(k)})`);
            }
        }
        for (const [, x] of n.v) {
            if (x.k === 3) walk(x);
            if (x.k === 4) x.v.slice(1).forEach(([, y]) => walk(y));
        }
    };
    for (const f of enc.files) walk(bson.decode(f.bytes));
    return { problems: [...problems], checked };
}

async function reopen(copy) {
    const ctx = await loadProject(copy);
    const client = new LocalClient(ctx);
    const model = await client.open();
    return { ctx, client, model, ops: require("./ops").bind(model, client) };
}

async function selftest(mpr, keep, { out, relevant }) {
    const src = new Project(mpr);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-selftest-"));
    const results = [];
    const check = (name, ok, detail) => results.push(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
    try {
        fs.copyFileSync(src.mpr, path.join(tmp, path.basename(src.mpr)));
        fs.cpSync(src.contents, path.join(tmp, "mprcontents"), { recursive: true });
        const copy = path.join(tmp, path.basename(src.mpr));
        const T = "ZzMxlocalTest";

        // phase 1 + 2: every create/change op, then step edits with real step ids
        let s1 = await reopen(copy);
        const custom = s1.model.allModules().filter(m => !m.fromAppStore);
        const mod = (custom.find(m => m.name === "MyFirstModule") || custom[0] || s1.model.allModules()[0]).name;
        const { phase1, E } = plans(mod, T);
        // pages copy a layout from the project's own pages; a project without any cannot get pages
        const layouts = new Set(s1.model.allLayouts().map(l => l.qualifiedName));
        const pageable = [...s1.ctx.project.units.keys()].some(id => {
            const p = s1.ctx.project.read(id);
            return p.$Type === "Forms$Page" && p.FormCall && layouts.has(p.FormCall.Form);
        });
        if (!pageable) {
            phase1.ops = phase1.ops.filter(o => o.op !== "createPage" && o.name !== `${T}_Open`);
            results.push("SKIP pages: this project has no page with a layout to copy");
        }
        const layout = ownLayout(s1.ctx.catalog);
        const lint = await s1.ops.runPlan(phase1, () => {});
        const main = await s1.ops.get(`${E}_Main`);
        const ids = {};
        const walk = coll => coll.objects.forEach(o => {
            const a = o.action;
            if (a && a.outputVariableName === "List") ids.retrieve = o.id.slice(0, 8);
            if (a && a.changeVariableName === "N") ids.setN = o.id.slice(0, 8);
            if (a && a.structureTypeName === "Microflows$ShowMessageAction" && !ids.message) ids.message = o.id.slice(0, 8);
            if (o.objectCollection) walk(o.objectCollection);
        });
        walk(main.objectCollection);
        const phase2 = { ops: [
            { op: "changeAction", microflow: `${E}_Main`, id: ids.retrieve, xpath: "[Flag = true() and Count > 0]" },
            { op: "changeAction", microflow: `${E}_Main`, id: ids.message, text: "Nothing at all", disabled: true },
            { op: "deleteAction", microflow: `${E}_Main`, id: ids.setN }
        ] };
        await s1.ops.runPlan(phase2, () => {});
        await s1.model.flushChanges();
        let enc = s1.client.encode();
        const lost = lostProperties(s1.client, s1.model, enc);
        const sum = s1.client.summary();
        const firstUse = relevant(sum.warnings, enc).filter(w => /first use|never occurs/.test(w));
        const lay = layoutProblems(layout, enc);
        s1.client.project.writeEncoded(enc);
        check(`dry run + apply of ${phase1.ops.length + phase2.ops.length} ops`, !lint.length, lint.length ? lint.join("; ") : `${sum.created.length} created, ${sum.updated.length} updated, ${sum.moved.length} moved unit(s)`);
        check("nothing lost on save", !lost.length, lost.join("; "));
        check("same layout as Studio Pro writes in this project", !lay.problems.length, lay.problems.length ? lay.problems.slice(0, 8).join("; ") : `${lay.checked} elements`);

        let s2 = await reopen(copy);
        const failed = await s2.ops.checkPlan({ ops: [...phase1.ops, ...phase2.ops] });
        check("saved model shows every op", !failed.length, failed.join("; "));

        // phase 3: attribute rename + module rename
        const phase3 = { ops: [{ op: "rename", target: `${E}.Flag`, newName: "Active" }, { op: "rename", target: mod, newName: `${mod}Zz` }] };
        await s2.ops.runPlan(phase3, () => {});
        await s2.model.flushChanges();
        enc = s2.client.encode();
        s2.client.project.writeEncoded(enc);
        const s3 = await reopen(copy);
        const stale = s3.client.referencesTo(mod);
        const renamed = await s3.ops.checkPlan({ ops: [{ op: "rename", target: mod, newName: `${mod}Zz` }] });
        check("module rename updates every reference", !stale.length && !renamed.length, [...renamed, ...stale.slice(0, 5).map(x => "still refers to " + mod + ": " + x)].join("; "));

        let bytes = 0;
        for (const [id] of s3.ctx.project.units) if (bson.encode(bson.decode(s3.ctx.project.readBytes(id))).equals(s3.ctx.project.readBytes(id))) bytes++;
        check("byte roundtrip", bytes === s3.ctx.project.units.size, `${bytes}/${s3.ctx.project.units.size}`);
        const errors = [];
        for (const u of s3.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) {
            try {
                await s3.model.loadUnitById(u.id, false);
            } catch (e) {
                errors.push(e.message);
            }
        }
        await s3.model.flushChanges();
        check("reopen with the Model SDK", !errors.length && !s3.client.log.length, errors.length ? errors[0] : s3.client.log.length ? `${s3.client.log.length} deltas on open` : "");
        const vr = require("./versions").checkRules();
        const dv = require("./inspect").api("DataView", src.version);
        const apiOk = /editability/.test(dv) && /ListenTargetSource/.test(dv) && !/^\s+editable: boolean/m.test(dv);
        check(`api for Mendix ${src.version} + version rules`, !vr.problems.length && apiOk, vr.problems.length ? vr.problems.slice(0, 5).join("; ") : apiOk ? `${vr.rules} rules match the SDK` : "api DataView lacks editability/ListenTargetSource");

        out(`Self test on a copy (module ${mod}, Mendix ${src.meta._ProductVersion}):`);
        out(results.map(r => "  " + r).join("\n"));
        if (firstUse.length) out("  Note: first use of these types in this project (layout from other projects or SDK defaults; check the copy in Studio Pro with --keep): " + [...new Set(firstUse.map(w => w.split(" ")[0]))].join(", "));
        const ok = results.every(r => !r.startsWith("FAIL"));
        if (ok && !keep) fs.rmSync(tmp, { recursive: true, force: true });
        else out(`Copy kept: ${tmp} (open it in Studio Pro to inspect, then delete it)`);
        return ok;
    } catch (e) {
        if (results.length) out(results.map(r => "  " + r).join("\n"));
        out(`Self test FAILED: ${e.message}\nCopy kept for inspection: ${tmp}`);
        return false;
    }
}

module.exports = { selftest };
