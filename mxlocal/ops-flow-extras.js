"use strict";
// Flow step details next to ops-flows.js: sorting and a custom range on a database retrieve, and reference set
// "add" / "remove" members on create/change object steps. Stored as Studio Pro stores them:
// - DatabaseRetrieveSource: NewSortings (Microflows$SortingsList) { Sortings: [ Microflows$RetrieveSorting
//   { AttributeRef { Attribute, EntityRef }, SortOrder } ] } (Studio Pro 10.24 / 11.12 samples, always present, also
//   empty), Range: ConstantRange { SingleObject } (all / first) or CustomRange { LimitExpression, OffsetExpression }
//   (Studio Pro 11.12 / 11.14 samples). An association retrieve has no sorting or range in Studio Pro.
// - a sort attribute over a reference: AttributeRef.EntityRef = IndirectEntityRef { Steps } (no Studio Pro sample of
//   a retrieve that does it: "first use" warning).
// - ChangeActionItem { Association, Attribute "", Type Add | Remove, Value } (only a Mendix 8 Studio Pro sample:
//   same keys as Set; "first use" warning).
const sdk = require("mendixmodelsdk");
const { fail, bool, noDollar } = require("./ops-util");

const { microflows: mf, domainmodels: dm } = sdk;

const RETRIEVE_FIELDS = {
    sort: "optional database retrieve: [ \"Attribute\" | { \"attribute\": \"Attribute\", \"descending\": true } ], first sorts first; also a path over references to one object \"Order_Customer/Name\"",
    range: "optional database retrieve: { \"offset\": \"0\", \"limit\": \"10\" } (expressions; custom range: a list of at most limit objects); not with first"
};
const MEMBER_FIELDS = {
    add: "optional { \"Module.Assoc\": \"$Obj or $List\" }: add objects to a reference set the entity owns",
    remove: "optional { \"Module.Assoc\": \"$Obj or $List\" }: remove objects from a reference set"
};
const ASSOC_RETRIEVE = "an association retrieve has no sorting or range in Studio Pro: retrieve from the database instead (\"entity\" + \"xpath\": \"[Module.Assoc = $Obj]\") or sort the list afterwards ({ \"action\": \"listOperation\", \"operation\": \"sort\" })";

// h: the ops-flows helpers ({ get, entity, loadParents, client, pages: () => page internals }); x: { expr, variableInfo }
function makeFlowExtras(h, x) {
    const isA = (ent, qn) => {
        for (let e = ent, i = 0; e && i < 20; i++) {
            if (e.qualifiedName === qn) return true;
            const g = e.generalization;
            e = g instanceof dm.Generalization && g.generalization && g.generalization.isLoaded ? g.generalization : null;
        }
        return false;
    };

    // "Attr" or a path "Assoc/Attr" from ent: { attr, steps } (the page builders' attribute paths)
    async function sortPath(ent, spec, where) {
        const P = h.pages();
        await P.prepareAssocs(null);
        try {
            return P.pathOf(ent, spec, where);
        } catch (e) {
            e.message = e.message.replace(/ To show the .*$/, " Sort on an attribute of the entity or over references to one object.").replace(/\(use a list widget.*\)/, "");
            throw e;
        }
    }

    async function sortInto(f, src, specs, where) {
        if (!Array.isArray(specs)) throw new Error(`${where}: sort is a list: [ "Attribute" or { "attribute": "Attribute", "descending": true } ]`);
        const ent = await h.entity(src.entityQualifiedName);
        await h.loadParents(ent);
        if (!src.sortItemList) mf.SortItemList.createInDatabaseRetrieveSourceUnderSortItemList(src);
        for (const old of [...src.sortItemList.items]) old.delete();
        const seen = new Set();
        const out = [];
        for (const s of specs) {
            const o = typeof s === "string" ? { attribute: s } : s && typeof s === "object" ? s : {};
            for (const k of Object.keys(o)) if (!["attribute", "descending"].includes(k)) fail(`${where}: sort item field '${k}' is unknown (use attribute, descending)`, k, ["attribute", "descending"]);
            if (!o.attribute) throw new Error(`${where}: each sort item needs an attribute: "Name" or { "attribute": "Name", "descending": true }`);
            const p = await sortPath(ent, String(o.attribute).trim(), `${where} sort`);
            if (seen.has(p.text)) throw new Error(`${where}: ${p.text} is sorted on twice`);
            seen.add(p.text);
            const item = mf.SortItem.createIn(src.sortItemList);
            item.attributeRef = h.pages().attrRefOf(p);
            item.sortOrder = bool(o.descending, false) ? mf.SortOrderEnum.Descending : mf.SortOrderEnum.Ascending;
            if (p.steps.length) h.client.warnFirst(`Microflows$RetrieveSorting over a reference first use (no Studio Pro sample sorts a retrieve over an association): check ${f.m.qualifiedName} in Studio Pro`);
            out.push(`${p.text}${bool(o.descending, false) ? " desc" : ""}`);
        }
        return out;
    }

    function rangeInto(f, src, spec, where) {
        if (spec === null || spec === "all") {
            mf.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src).singleObject = false;
            return "all";
        }
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: range is { "offset": "0", "limit": "10" } (or "all")`);
        for (const k of Object.keys(spec)) if (!["offset", "limit"].includes(k)) fail(`${where}: range field '${k}' is unknown (use offset, limit)`, k, ["offset", "limit", "amount"].slice(0, 2));
        if (spec.limit === undefined || spec.limit === "") throw new Error(`${where}: range needs "limit" (how many objects, an expression such as "10" or "$PageSize"); "offset" is optional (default 0)`);
        const r = mf.CustomRange.createInDatabaseRetrieveSourceUnderRange(src);
        r.offsetExpression = x.expr(f.m, spec.offset === undefined ? "0" : String(spec.offset), where);
        r.limitExpression = x.expr(f.m, String(spec.limit), where);
        return `offset ${r.offsetExpression} limit ${r.limitExpression}`;
    }

    // createFlow / addActions: after the source is made (first is already applied)
    async function retrieveExtras(f, a, spec, where) {
        const src = a.retrieveSource;
        const has = spec.sort !== undefined || spec.range !== undefined;
        if (!has) return;
        if (!(src instanceof mf.DatabaseRetrieveSource)) throw new Error(`${where}: ${ASSOC_RETRIEVE}`);
        if (spec.range !== undefined && bool(spec.first, false)) throw new Error(`${where}: give "first": true (one object) or "range" (a list), not both`);
        if (spec.sort !== undefined) await sortInto(f, src, spec.sort, where);
        if (spec.range !== undefined) rangeInto(f, src, spec.range, where);
    }

    // changeAction fields of a retrieve step
    const retrieveChanges = {
        sort: async (f, a, v, where) => {
            if (!(a.retrieveSource instanceof mf.DatabaseRetrieveSource)) throw new Error(ASSOC_RETRIEVE);
            await sortInto(f, a.retrieveSource, v === null ? [] : v, where);
        },
        range: (f, a, v, where, o) => {
            if (!(a.retrieveSource instanceof mf.DatabaseRetrieveSource)) throw new Error(ASSOC_RETRIEVE);
            if (o && o.first !== undefined) throw new Error("give \"first\" (true = one object, false = all) or \"range\", not both");
            rangeInto(f, a.retrieveSource, v, where);
        }
    };

    function describeRetrieve(src) {
        const bits = [];
        const r = src.range;
        if (r instanceof mf.CustomRange) bits.push(` RANGE ${r.offsetExpression || "0"}, ${r.limitExpression}`);
        const items = src.sortItemList ? [...src.sortItemList.items] : [];
        if (items.length) {
            bits.push(" SORT " + items.map(it => {
                const ref = it.attributeRef;
                const steps = ref && ref.entityRef instanceof dm.IndirectEntityRef ? ref.entityRef.steps.map(s => (s.associationQualifiedName || "?").split(".").pop()) : [];
                return [...steps, ((ref && ref.attributeQualifiedName) || "?").split(".").pop()].join("/") + (it.sortOrder === mf.SortOrderEnum.Descending ? " desc" : "");
            }).join(", "));
        }
        return bits.join("");
    }

    // ------------------------------------------------ reference set add / remove

    const ends = a => ({ from: a.parent ? a.parent.qualifiedName : null, to: a instanceof dm.CrossAssociation ? a.childQualifiedName : a.child ? a.child.qualifiedName : null });

    async function setMember(f, ent, entityQn, member, where, kind) {
        if (!String(member).includes(".")) {
            const own = (await allAssocs()).filter(a => ends(a).from === entityQn || isA(ent, ends(a).from)).map(a => a.qualifiedName);
            fail(`${where}: ${kind} takes an association Module.Assoc, '${member}' is not one (an attribute is changed with "set")`, member, own);
        }
        const assoc = await h.get(member).catch(() => null);
        if (!(assoc instanceof dm.AssociationBase)) {
            const own = (await allAssocs()).filter(a => isA(ent, ends(a).from) || isA(ent, ends(a).to)).map(a => a.qualifiedName);
            fail(`${where}: '${member}' is not an association`, member, own);
        }
        const { from, to } = ends(assoc);
        if (assoc.type !== dm.AssociationType.ReferenceSet) throw new Error(`${where}: ${assoc.qualifiedName} is a reference (one ${String(to).split(".").pop()}): ${kind} only works on a reference set; use "set": { "${assoc.qualifiedName}": "$Obj" }`);
        const owner = isA(ent, from);
        const both = assoc.owner === dm.AssociationOwner.Both && isA(ent, to);
        if (!owner && !both) {
            if (isA(ent, to)) throw new Error(`${where}: ${assoc.qualifiedName} is owned by ${from}; a ${entityQn} cannot change it (change the ${from.split(".").pop()} object, or make the owner Both with changeAssociation)`);
            throw new Error(`${where}: ${assoc.qualifiedName} links ${from} and ${to}, not ${entityQn}`);
        }
        return { assoc, other: owner ? to : from };
    }

    let assocCache = null;
    async function allAssocs() {
        if (assocCache) return assocCache;
        const out = [];
        for (const d of h.model.allDomainModels()) {
            const full = d.isLoaded ? d : await d.load();
            out.push(...full.associations, ...full.crossAssociations);
        }
        return (assocCache = out);
    }

    // The value of add/remove: an object or list variable of the other end (or an expression we cannot check).
    async function checkValue(f, other, value, where) {
        const v = String(value).trim();
        if (!/^\$\w+$/.test(v)) return;
        const info = await x.variableInfo(f.m, v, where).catch(() => null);
        if (!info || !info.entity || !other) return;
        if (info.entity !== other) {
            const e = await h.entity(info.entity).catch(() => null);
            if (e) await h.loadParents(e);
            if (!e || !isA(e, other)) throw new Error(`${where}: ${v} is ${info.list ? "a list of " : "a "}${info.entity}; this association takes ${other} objects`);
        }
    }

    // spec.add / spec.remove of a create/change step (after its "set" members)
    async function addRemove(f, action, entityQn, spec, where) {
        if (spec.add === undefined && spec.remove === undefined) return [];
        const ent = await h.entity(entityQn);
        await h.loadParents(ent);
        const out = [];
        for (const kind of ["add", "remove"]) {
            const v = spec[kind];
            if (v === undefined) continue;
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: ${kind} is { "Module.Assoc": "$Obj or $List" }`);
            for (const [member, value] of Object.entries(v)) {
                if (spec.set && spec.set[member] !== undefined) throw new Error(`${where}: ${member} is in "set" and in "${kind}"; "set" replaces all linked objects, "${kind}" changes some: give one`);
                const { assoc, other } = await setMember(f, ent, entityQn, member, where, kind);
                await checkValue(f, other, value, `${where} ${kind} ${member}`);
                const mc = mf.MemberChange.createIn(action);
                mc.type = kind === "add" ? mf.ChangeActionItemType.Add : mf.ChangeActionItemType.Remove;
                mc.association = assoc;
                mc.value = x.expr(f.m, String(value), where);
                h.client.warnFirst(`Microflows$ChangeActionItem ${kind === "add" ? "Add" : "Remove"} first use (only a Mendix 8 Studio Pro sample): check ${f.m.qualifiedName} in Studio Pro`);
                out.push(`${assoc.name} ${kind === "add" ? "+=" : "-="} ${value}`);
            }
        }
        return out;
    }

    // changeAction fields of a create/change step: replace the add (or remove) of the association, keep the rest
    const memberChanges = {};
    for (const kind of ["add", "remove"]) {
        memberChanges[kind] = async (f, a, v, where) => {
            const entityQn = a instanceof mf.CreateObjectAction ? a.entityQualifiedName : await x.entityOfVariable(f.m, a.changeVariableName, where);
            const type = kind === "add" ? mf.ChangeActionItemType.Add : mf.ChangeActionItemType.Remove;
            for (const member of Object.keys(v || {})) for (const mc of [...a.items]) if (mc.type === type && mc.associationQualifiedName === member) mc.delete();
            await addRemove(f, a, entityQn, { [kind]: v }, where);
        };
    }

    return { retrieveExtras, retrieveChanges, describeRetrieve, addRemove, memberChanges };
}

module.exports = { makeFlowExtras, RETRIEVE_FIELDS, MEMBER_FIELDS };
