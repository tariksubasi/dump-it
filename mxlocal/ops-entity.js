"use strict";
// Entity-level changes that the reference graph (refs.js) makes safe:
//   changeEntity  persistable on/off (DATA LOSS line when off), documentation, domain model image
//   moveEntity    an entity to another module: associations follow Studio Pro's rules (stored in the owner's module;
//                 cross-module ones name their child), access rules get the target module's roles, and every
//                 reference (by name, expressions, XPath, OQL) is renamed through the graph
const sdk = require("mendixmodelsdk");
const { fail } = require("./ops-util");
const refs = require("./refs");
const { eachString } = require("./ops-copy");

const { domainmodels: dm } = sdk;

const ENTITY_OPS = {
    changeEntity: {
        doc: "Change an entity: persistable on/off (off drops its table: DATA LOSS), documentation, its image in the domain model.",
        fields: { entity: "R Module.Entity", persistable: "optional true/false (entities without a parent only)", documentation: "optional text", image: "optional Module.Images.Image (\"\" for none)", color: "not stored by Mendix: refused" }
    },
    moveEntity: {
        doc: "Move an entity to another module: its associations (Module.Assoc of the owner's module, cross-module where needed), access rules (module roles mapped) and every reference are updated. Run usages first.",
        fields: { entity: "R Module.Entity", module: "R target module", roles: "optional { \"Old.Role\": \"New.Role\" } for its access rules (default: same role name in the target module, else refused)" }
    }
};

const CROSS_KEYS = ["Name", "GUID", "Type", "Owner", "StorageFormat", "DeleteBehavior", "ParentPointer", "Documentation", "Source", "ExportLevel"];

// A regular association as a cross-module one (child by name) and back.
function toCross(a, childQn) {
    const c = { $ID: a.$ID, $Type: "DomainModels$CrossAssociation" };
    for (const k of CROSS_KEYS) if (k in a) c[k] = a[k];
    c.Child = childQn;
    return c;
}
function toRegular(c, childId) {
    const a = { $ID: c.$ID, $Type: "DomainModels$Association" };
    for (const k of CROSS_KEYS) if (k in c) a[k] = c[k];
    a.ChildPointer = childId;
    a.ParentConnection = "0;30";
    a.ChildConnection = "100;30";
    return a;
}

function makeEntity(h) {
    const { model, client, get } = h;

    async function changeEntity(o) {
        const e = await h.entity(o.entity);
        const lines = [];
        if (o.color !== undefined) throw new Error("Mendix does not store an entity color (the domain model colors entities by kind); leave out color");
        if (o.persistable !== undefined) {
            const want = o.persistable === true || o.persistable === "true";
            if (!(e.generalization instanceof dm.NoGeneralization)) throw new Error(`${o.entity} inherits from ${e.generalization.generalizationQualifiedName || "a parent"}: it is persistable like its parent (change the parent, or setGeneralization)`);
            const was = e.generalization.persistable;
            if (was !== want) {
                await model.flushChanges();
                const g = refs.graph(client);
                if (!want) {
                    // a persistable owner cannot point to a non-persistable entity
                    const bad = [...g.assocs].filter(([, a]) => a.child === o.entity && a.parent && a.parent !== o.entity).map(([n, a]) => `${n} (owned by ${a.parent})`);
                    const owners = [];
                    for (const b of bad) {
                        const owner = /owned by (.*)\)$/.exec(b)[1];
                        try {
                            const pe = await h.entity(owner);
                            if (h.persistable(pe)) owners.push(b);
                        } catch (err) {
                            owners.push(b);
                        }
                    }
                    if (owners.length) throw new Error(`REFUSED: persistable entities own associations to ${o.entity}: ${owners.join(", ")}. A non-persistable entity cannot be their target; delete or turn those around first`);
                }
                e.generalization.persistable = want;
                const subs = [...g.parents].filter(([, p]) => p === o.entity).map(([c]) => c);
                lines.push(`persistable ${was} -> ${want}${subs.length ? ` (also for ${subs.join(", ")}, which inherit it)` : ""}`);
                if (!want && !h.isFresh(o.entity)) lines.push(`DATA LOSS: the table of ${e.name}${subs.length ? " and its specializations" : ""} and all its rows are dropped when the app next starts`);
            }
        }
        if (o.documentation !== undefined) {
            e.documentation = String(o.documentation);
            lines.push("documentation set");
        }
        if (o.image !== undefined) {
            const qn = String(o.image);
            if (qn) {
                await model.flushChanges();
                const g = refs.graph(client);
                if (g.names.get(qn) !== "Images$Image") fail(`'${qn}' is not an image (Module.Collection.Image)`, qn, [...g.names].filter(([, t]) => t === "Images$Image").map(([n]) => n));
            }
            e.__image.updateWithRawValue(qn);
            lines.push(qn ? `image ${qn}` : "no image");
        }
        if (!lines.length) throw new Error("nothing to change: give persistable, documentation or image");
        return `${o.entity}: ${lines.join("; ").replace(/; DATA LOSS/, "\n      DATA LOSS")}`;
    }

    async function moveEntity(o) {
        await model.flushChanges();
        const g = refs.graph(client);
        const src = refs.known(g, o.entity);
        if (g.names.get(src) !== "DomainModels$Entity") throw new Error(`'${src}' is not an entity`);
        const [from, name] = src.split(".");
        const to = String(o.module || "");
        const mods = [...client.project.units.keys()].map(id => ({ id, ...client.unitInfo(id) })).filter(u => /^Projects\$Module(Impl)?$/.test(u.type));
        const target = mods.find(m => m.name === to);
        if (!target) fail(`Module '${to}' not found`, to, mods.map(m => m.name));
        if (to === from) throw new Error(`${src} is already in ${to}`);
        if (client.project.read(target.id).FromAppStore) throw new Error(`${to} is a Marketplace module: an update would remove ${name}; move it to one of the app's own modules`);
        const dst = `${to}.${name}`;
        if (g.names.has(dst)) throw new Error(`${dst} already exists`);
        const dmUnit = m => g.units.find(u => u.type === "DomainModels$DomainModel" && u.module === m);
        const fromUnit = dmUnit(from);
        const toUnit = dmUnit(to);
        const fromDm = client.project.read(fromUnit.id);
        const toDm = client.project.read(toUnit.id);
        const e = fromDm.Entities.find(x => x.Name === name);
        if (!e || e.Source) throw new Error(`${src} ${e && e.Source ? "is a view or external entity: move it in Studio Pro" : "not found in its domain model"}`);
        const idName = new Map(fromDm.Entities.map(x => [x.$ID, `${from}.${x.Name}`]));
        const toIds = new Map(toDm.Entities.map(x => [`${to}.${x.Name}`, x.$ID]));
        const rename = new Map([[src, dst]]);
        const lines = [];
        const taken = new Set([...(toDm.Associations || []), ...(toDm.CrossAssociations || [])].map(a => a.Name));
        const moveAssoc = a => {
            if (taken.has(a.Name)) throw new Error(`${to}.${a.Name} already exists: rename association ${from}.${a.Name} first`);
            rename.set(`${from}.${a.Name}`, `${to}.${a.Name}`);
        };
        // associations it owns move with it
        const ownedReg = (fromDm.Associations || []).filter(a => a.ParentPointer === e.$ID);
        const ownedCross = (fromDm.CrossAssociations || []).filter(a => a.ParentPointer === e.$ID);
        ownedReg.forEach(moveAssoc);
        ownedCross.forEach(moveAssoc);
        // associations of other entities in its old module to it stay there, as cross-module ones
        const intoReg = (fromDm.Associations || []).filter(a => a.ChildPointer === e.$ID && a.ParentPointer !== e.$ID);
        // cross-module associations of the target module to it become regular ones
        const intoCross = (toDm.CrossAssociations || []).filter(a => a.Child === src);

        // access rules: module roles of the old module
        const roleMap = o.roles || {};
        const missing = new Set();
        const mapRole = r => {
            if (!r.startsWith(from + ".")) return r;
            if (roleMap[r] !== undefined) {
                if (roleMap[r] && g.names.get(roleMap[r]) !== "Security$ModuleRole") fail(`roles: '${roleMap[r]}' is not a module role`, roleMap[r], [...g.names].filter(([, t]) => t === "Security$ModuleRole").map(([n]) => n));
                return roleMap[r];
            }
            const same = `${to}.${r.split(".").pop()}`;
            if (g.names.get(same) === "Security$ModuleRole") return same;
            missing.add(r);
            return r;
        };
        const mapped = (e.AccessRules || []).map(rule => (rule.AllowedModuleRoles || []).map(mapRole));
        if (missing.size) throw new Error(`REFUSED: access rules of ${src} use roles of ${from} with no match in ${to}: ${[...missing].join(", ")}. Give "roles": { "${[...missing][0]}": "${to}.<Role>" } (or "" to drop it from the rule)`);
        (e.AccessRules || []).forEach((rule, i) => (rule.AllowedModuleRoles = [...new Set(mapped[i])]));
        for (const rule of e.AccessRules || []) rule.AllowedModuleRoles = rule.AllowedModuleRoles.filter(Boolean);
        const emptied = (e.AccessRules || []).filter(r => !r.AllowedModuleRoles.length).length;
        e.AccessRules = (e.AccessRules || []).filter(r => r.AllowedModuleRoles.length);
        if (emptied) lines.push(`${emptied} access rule(s) without a role left out`);

        // move the entity and its associations
        fromDm.Entities.splice(fromDm.Entities.indexOf(e), 1);
        toDm.Entities.push(e);
        toDm.Associations = toDm.Associations || [];
        toDm.CrossAssociations = toDm.CrossAssociations || [];
        for (const a of ownedReg) {
            fromDm.Associations.splice(fromDm.Associations.indexOf(a), 1);
            if (a.ChildPointer === e.$ID) toDm.Associations.push(a);
            else {
                toDm.CrossAssociations.push(toCross(a, idName.get(a.ChildPointer)));
                client.warn(`DomainModels$CrossAssociation first use by ops (no Studio Pro sample in the test projects): check ${to}.${a.Name} in Studio Pro`);
            }
        }
        for (const a of ownedCross) {
            fromDm.CrossAssociations.splice(fromDm.CrossAssociations.indexOf(a), 1);
            if (toIds.has(a.Child)) toDm.Associations.push(toRegular(a, toIds.get(a.Child)));
            else toDm.CrossAssociations.push(a);
        }
        fromDm.CrossAssociations = fromDm.CrossAssociations || [];
        for (const a of intoReg) {
            fromDm.Associations.splice(fromDm.Associations.indexOf(a), 1);
            fromDm.CrossAssociations.push(toCross(a, dst));
            client.warn(`DomainModels$CrossAssociation first use by ops (no Studio Pro sample in the test projects): check ${from}.${a.Name} in Studio Pro`);
        }
        for (const a of intoCross) {
            toDm.CrossAssociations.splice(toDm.CrossAssociations.indexOf(a), 1);
            toDm.Associations.push(toRegular(a, e.$ID));
        }
        if (ownedReg.length + ownedCross.length) lines.push(`associations moved: ${[...ownedReg, ...ownedCross].map(a => `${from}.${a.Name} -> ${to}.${a.Name}`).join(", ")}`);
        if (intoReg.length) lines.push(`now cross-module (stay in ${from}): ${intoReg.map(a => a.Name).join(", ")}`);
        if (intoCross.length) lines.push(`no longer cross-module: ${intoCross.map(a => `${to}.${a.Name}`).join(", ")}`);

        // every reference, by name and in expressions / XPath / OQL
        const mapName = n => {
            for (const [a, b] of rename) {
                if (n === a) return b;
                if (n.startsWith(a + ".") && a === src) return b + n.slice(a.length);
            }
            return n;
        };
        const units = new Set([fromUnit.id, toUnit.id]);
        for (const [old] of rename) for (const ed of g.usesOf(old)) units.add(ed.unit);
        let count = 0;
        const docs = new Set();
        const QN = /(?<![\w.$%])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g;
        const exprKey = /expression|xpath|constraint|argument|value|formula|node|condition|oql|initial|return|template|default/i;
        for (const id of units) {
            const tree = client.project.read(id);
            let n = 0;
            eachString(tree, (v, key, obj) => {
                if (!key || /^(Name|Documentation|Caption|Text|Title)$/.test(key) || /^Texts\$/.test(obj.$Type || "")) return v;
                const info = obj.$Type && client.schema.info(client.schema.sdkType(obj.$Type));
                const p = info && info.byKey.get(key);
                let nv = v;
                if ((p && (p.kind === "byName" || p.kind === "byNameList")) || (!p && /^[A-Za-z_]\w*(\.[A-Za-z_]\w*){1,2}$/.test(v))) nv = mapName(v);
                else if (exprKey.test(key)) nv = v.replace(QN, mapName);
                if (nv !== v) n++;
                return nv;
            });
            if (n || id === fromUnit.id || id === toUnit.id) {
                client.changes.updated.add(id);
                (client.rawUnits = client.rawUnits || new Set()).add(id);
                client.indexed.delete(id);
                client.indexUnit(id);
            }
            if (n && id !== fromUnit.id && id !== toUnit.id) docs.add(client.label(id));
            count += n;
        }
        lines.unshift(`${count} reference(s) renamed in ${docs.size} document(s) and the two domain models`);
        lines.push(`data stays (same entity id); the table is renamed to ${to.toLowerCase()}$${name.toLowerCase()} when the app next starts`);
        // code that names it: Java proxies are regenerated, own code is not
        const code = refs.codeText(client.project.dir);
        const re = new RegExp(`${from}\\.${name}\\b|\\b${from.toLowerCase()}\\.proxies\\.${name}\\b`);
        if (code && re.test(code)) client.warn(`${src}: Java/JavaScript code names it (${from}.${name} or ${from.toLowerCase()}.proxies.${name}); change it to ${dst} after Studio Pro regenerates the proxies`);
        return `${src} -> ${dst}\n      ${lines.join("\n      ")}`;
    }

    async function checkMove(o) {
        const g = refs.graph(client);
        const src = String(o.entity);
        const dst = `${o.module}.${src.split(".").pop()}`;
        const r = [];
        if (g.names.get(dst) !== "DomainModels$Entity") r.push(`${dst} missing`);
        if (g.names.has(src)) r.push(`${src} still exists`);
        const left = g.edges.filter(e => e.to === src || e.to.startsWith(src + "."));
        if (left.length) r.push(`${left.length} reference(s) still name ${src}: ${left.slice(0, 3).map(e => `${e.doc} ${e.place}`).join(", ")}`);
        return r;
    }

    async function checkChange(o) {
        const e = await h.entity(o.entity);
        const r = [];
        if (o.persistable !== undefined && e.generalization instanceof dm.NoGeneralization && e.generalization.persistable !== (o.persistable === true || o.persistable === "true")) r.push(`${o.entity} persistable is ${e.generalization.persistable}`);
        if (o.documentation !== undefined && e.documentation !== String(o.documentation)) r.push(`${o.entity} documentation not set`);
        if (o.image !== undefined && (e.imageQualifiedName || "") !== String(o.image)) r.push(`${o.entity} image is ${e.imageQualifiedName || "none"}`);
        return r;
    }

    return { impl: { changeEntity, moveEntity }, checks: { changeEntity: checkChange, moveEntity: checkMove } };
}

module.exports = { makeEntity, ENTITY_OPS, toCross, toRegular };
