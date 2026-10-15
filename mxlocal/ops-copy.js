"use strict";
// copyDocument: a page, snippet, layout, microflow, nanoflow, rule, enumeration (a new unit) or an entity (into a
// domain model) copied from its stored contents (so the copy is exactly what Studio Pro wrote), with fresh ids,
// references inside the copy re-bound to the copy, an optional entity mapping (source entity -> target entity,
// attributes and associations by name) and module roles mapped when the copy goes to another module.
// Raw helpers here are shared with moveEntity (ops-entity.js).
const { randomUUID } = require("crypto");
const { META } = require("./convert");
const { validName, fail } = require("./ops-util");
const refs = require("./refs");

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOC_TYPES = /^(Forms\$(Page|Snippet|Layout)|Microflows\$(Microflow|Nanoflow|Rule)|Enumerations\$Enumeration)$/;
// array elements that can be left out of a copy when they name something the target entity lacks
const DROPPABLE = /^(Forms\$|CustomWidgets\$(CustomWidget|WidgetObject)$|Microflows\$(ChangeActionItem|MemberChange)$|DomainModels\$(MemberAccess|ValidationRule)$)/;

const COPY_OPS = {
    copyDocument: {
        doc: "Copy a page, snippet, layout, microflow, nanoflow, rule, enumeration or entity to a new name and/or module; references inside it point to the copy; optionally for another entity (attributes and associations by name).",
        fields: {
            document: "R Module.Document or Module.Entity to copy",
            name: "optional new name (default: the same name, in another module)",
            module: "optional target module (default: the same module)",
            folder: "optional folder path in the target module (documents)",
            entity: "optional { \"Module.Source\": \"Module.Target\" }: the copy works on Target (attributes and associations matched by name)",
            skipUnmatched: "optional true: leave out widgets / member changes that name an attribute or association Target lacks (default: refuse and list them)",
            roles: "optional { \"Module.Role\": \"Other.Role\" } module roles of the copy in another module (default: same role name there, else refused)",
            associations: "optional true (entity): also copy the associations the entity owns"
        }
    }
};

// Deep copy of a plain tree, keeping the stored BSON kinds.
function clone(v) {
    if (Array.isArray(v)) return v.map(clone);
    if (Buffer.isBuffer(v)) return Buffer.from(v);
    if (!v || typeof v !== "object") return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = clone(x);
    if (v[META]) Object.defineProperty(out, META, { value: { ...v[META] }, enumerable: false, writable: true });
    return out;
}

// Fresh $IDs (and GUID fields) in a copied tree; pointers to ids inside it follow. Returns old -> new id.
function freshIds(tree) {
    const map = new Map();
    const collect = o => {
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
        if (Array.isArray(o)) return o.forEach(collect);
        if (typeof o.$ID === "string") map.set(o.$ID, randomUUID());
        for (const [k, v] of Object.entries(o)) if (k[0] !== "$" && v && typeof v === "object") collect(v);
    };
    collect(tree);
    const fix = o => {
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
        if (Array.isArray(o)) {
            for (let i = 0; i < o.length; i++) if (typeof o[i] === "string" && map.has(o[i])) o[i] = map.get(o[i]);
            return o.forEach(fix);
        }
        for (const [k, v] of Object.entries(o)) {
            if (k === "$ID" || (typeof v === "string" && map.has(v))) o[k] = map.get(v);
            else if (k === "GUID" && typeof v === "string" && GUID_RE.test(v)) o[k] = randomUUID();
            else if (v && typeof v === "object") fix(v);
        }
    };
    fix(tree);
    return map;
}

// Walks every string of a tree with its ancestors: fn(value, key, obj, stack) returns the new value.
function eachString(tree, fn) {
    const walk = (o, stack) => {
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
        if (Array.isArray(o)) {
            for (let i = 0; i < o.length; i++) {
                if (typeof o[i] === "string") o[i] = fn(o[i], null, o, stack);
                else walk(o[i], stack.concat({ list: o, item: o[i] }));
            }
            return;
        }
        for (const [k, v] of Object.entries(o)) {
            if (k === "$ID" || k === "$Type") continue;
            if (typeof v === "string") {
                const nv = fn(v, k, o, stack);
                if (nv !== v) o[k] = nv;
            } else if (Array.isArray(v) && v.some(x => typeof x === "string")) {
                for (let i = 0; i < v.length; i++) if (typeof v[i] === "string") v[i] = fn(v[i], k, o, stack);
            } else if (v && typeof v === "object") walk(v, stack.concat({ obj: o, key: k }));
        }
    };
    walk(tree, []);
}

const QN_TOKEN = /(?<![\w.$%])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g;
const NAME_KEY = /^(Name|Documentation|Caption|Text|Title)$/;

function makeCopy(h) {
    const { model, client } = h;

    // Renames by qualified name in a tree: byName values exactly, expressions/XPath by token. mapName(qn) returns the
    // new name, the same name, or undefined for "unmatched" (recorded with where it is).
    function rebind(tree, schema, mapName, unmatched, opts = {}) {
        const exprKey = /expression|xpath|constraint|argument|value|formula|node|condition|oql|initial|return|template|default/i;
        eachString(tree, (v, key, obj, stack) => {
            if (!key || !v || NAME_KEY.test(key) || GUID_RE.test(v)) return v;
            const info = obj.$Type && schema.info(schema.sdkType(obj.$Type));
            const p = info && info.byKey.get(key);
            const byName = p && (p.kind === "byName" || p.kind === "byNameList");
            if (byName || (!p && /^[A-Za-z_]\w*(\.[A-Za-z_]\w*){1,2}$/.test(v))) {
                const n = mapName(v);
                if (n === undefined) {
                    unmatched.push({ name: v, stack: stack.concat({ obj, key }) });
                    return v;
                }
                return n;
            }
            if (!exprKey.test(key) || /^Texts\$/.test(obj.$Type || "") || opts.noExpressions) return v;
            return v.replace(QN_TOKEN, t => {
                const n = mapName(t);
                if (n === undefined) {
                    unmatched.push({ name: t, stack: stack.concat({ obj, key }), text: true });
                    return t;
                }
                return n;
            });
        });
    }

    // Short member names a mapped copy uses ($currentObject/Attr, [Attr = ..], $Param/Attr) that the target lacks.
    function missingMembers(tree, g, targets) {
        const x = refs.extract(tree, client.schema);
        const out = [];
        for (const [kind, to, , place, segs] of x.c) {
            if (kind !== "p" || !targets.has(to)) continue;
            let cur = to;
            for (const s of segs) {
                if (!cur) break;
                if (s.includes(".")) {
                    const a = g.assocs.get(s);
                    cur = a ? (cur === a.child ? a.parent : a.child) : g.names.get(s) === "DomainModels$Entity" ? s : null;
                    continue;
                }
                if (!g.member(cur, s)) out.push(`${place}: ${cur}/${s}`);
                cur = null;
            }
        }
        return out;
    }

    // Entity mapping: { from: to } -> mapName part for entities, their members and associations.
    function entityMapper(g, map, notes) {
        const pairs = Object.entries(map);
        for (const [from, to] of pairs) {
            for (const [qn, what] of [[from, "source"], [to, "target"]]) if (g.names.get(qn) !== "DomainModels$Entity") fail(`entity mapping: ${what} '${qn}' is not an entity`, qn, [...g.names].filter(([, t]) => t === "DomainModels$Entity").map(([n]) => n));
        }
        const assocMap = new Map();
        for (const [a, ends] of g.assocs) {
            for (const [from, to] of pairs) {
                if (ends.parent !== from && ends.child !== from) continue;
                const cands = [...g.assocs].filter(([, e]) => (ends.parent === from ? e.parent === to && e.child === (ends.child === from ? to : ends.child) : e.child === to && e.parent === ends.parent)).map(([n]) => n);
                assocMap.set(a, cands.length === 1 ? cands[0] : null);
            }
        }
        return n => {
            for (const [from, to] of pairs) {
                if (n === from) return to;
                if (n.startsWith(from + ".")) {
                    const member = n.slice(from.length + 1).split(".")[0];
                    const m = g.member(to, member);
                    if (m) {
                        notes.add(member);
                        return m + n.slice(from.length + 1 + member.length);
                    }
                    return undefined;
                }
            }
            if (assocMap.has(n)) return assocMap.get(n) || undefined;
            return n;
        };
    }

    // Module roles of a copy in another module: explicit mapping, else the same role name there, else refused.
    function roleMapper(g, fromModule, toModule, given, refusedRoles) {
        const map = given || {};
        return n => {
            if (fromModule === toModule || !n.startsWith(fromModule + ".") || g.names.get(n) !== "Security$ModuleRole") return n;
            if (map[n] !== undefined) {
                if (map[n] && g.names.get(map[n]) !== "Security$ModuleRole") fail(`roles: '${map[n]}' is not a module role`, map[n], [...g.names].filter(([, t]) => t === "Security$ModuleRole").map(([k]) => k));
                return map[n] || null;
            }
            const same = `${toModule}.${n.split(".").pop()}`;
            if (g.names.get(same) === "Security$ModuleRole") return same;
            refusedRoles.add(n);
            return n;
        };
    }

    // Leaves out the nearest droppable list element around each unmatched name; false when one has none.
    function drop(unmatched) {
        const gone = [];
        for (const u of unmatched) {
            const hit = [...u.stack].reverse().find(s => s.list && s.item && DROPPABLE.test(s.item.$Type || "") && !/Forms\$(Page|Snippet|Layout|LayoutGridRow|LayoutGridColumn)$/.test(s.item.$Type));
            if (!hit) return null;
            const i = hit.list.indexOf(hit.item);
            if (i >= 0) {
                hit.list.splice(i, 1);
                gone.push(hit.item.Name || hit.item.$Type.split("$")[1]);
            }
        }
        return gone;
    }

    // Creates a raw unit in the model held by the client.
    function addUnit(tree, containerId) {
        const id = tree.$ID;
        client.project.plain.set(id, tree);
        client.project.units.set(id, { id, containerId, containmentName: "Documents" });
        client.changes.created.set(id, { containerId, containmentName: "Documents" });
        client.indexed.add(id);
        client.indexTree(tree, null, null, id);
    }

    function moduleUnit(g, name) {
        for (const [id] of client.project.units) {
            const info = client.unitInfo(id);
            if (/^Projects\$Module(Impl)?$/.test(info.type) && info.name === name) return id;
        }
        const mods = [...client.project.units.keys()].map(id => client.unitInfo(id)).filter(i => /^Projects\$Module(Impl)?$/.test(i.type)).map(i => i.name);
        return fail(`Module '${name}' not found`, name, mods);
    }

    async function copyDocument(o) {
        await model.flushChanges();
        const g = refs.graph(client);
        const src = refs.known(g, o.document);
        const srcModule = src.split(".")[0];
        const toModule = o.module ? String(o.module) : srcModule;
        moduleUnit(g, toModule);
        const isEntity = g.names.get(src) === "DomainModels$Entity";
        const unit = g.units.find(u => u.label === src && DOC_TYPES.test(u.type));
        if (!isEntity && !unit) {
            const t = (g.units.find(u => u.label === src) || {}).type || g.names.get(src) || "?";
            throw new Error(`'${src}' is a ${t.split("$").pop()}: copyDocument copies pages, snippets, layouts, microflows, nanoflows, rules, enumerations and entities`);
        }
        const name = validName(o.name || src.split(".").pop(), "name");
        const dst = `${toModule}.${name}`;
        if (dst === src) throw new Error(`copyDocument needs a new name or another module (${src} exists)`);
        if (g.names.has(dst) || g.units.some(u => u.label === dst)) throw new Error(`${dst} already exists`);
        if (o.entity !== undefined && (typeof o.entity !== "object" || Array.isArray(o.entity) || !Object.keys(o.entity).length)) throw new Error(`entity must be { "Module.Source": "Module.Target" }`);
        if (isEntity && o.entity) throw new Error("entity mapping is for documents; to copy an entity give document, name and module");
        const notes = new Set();
        const refusedRoles = new Set();
        const unmatched = [];
        const roles = roleMapper(g, srcModule, toModule, o.roles, refusedRoles);
        const ent = o.entity ? entityMapper(g, o.entity, notes) : n => n;
        const self = n => (n === src || n.startsWith(src + ".") ? dst + n.slice(src.length) : n);
        const mapName = n => {
            const s = self(n);
            if (s !== n) return s;
            const e = ent(n);
            return e === undefined ? undefined : roles(e);
        };
        if (isEntity) return copyEntity(o, g, src, dst, mapName, refusedRoles, unmatched);

        const tree = clone(client.project.read(unit.id));
        freshIds(tree);
        tree.Name = name;
        rebind(tree, client.schema, mapName, unmatched);
        const lines = [];
        if (o.entity) {
            const targets = new Set(Object.values(o.entity));
            for (const m of missingMembers(tree, g, targets)) unmatched.push({ name: m, stack: [], text: true });
        }
        if (refusedRoles.size) throw new Error(`module roles of ${src} have no match in ${toModule}: ${[...refusedRoles].join(", ")}. Give "roles": { "${[...refusedRoles][0]}": "${toModule}.<Role>" } (or "" to drop one)`);
        if (unmatched.length) {
            const list = [...new Set(unmatched.map(u => u.name))];
            const gone = o.skipUnmatched ? drop(unmatched.filter(u => u.stack.length)) : null;
            if (!o.skipUnmatched || gone === null || unmatched.some(u => !u.stack.length)) {
                throw new Error(`the copy names what ${Object.values(o.entity || {}).join(", ") || toModule} lacks: ${list.slice(0, 12).join(", ")}${list.length > 12 ? ", ..." : ""}.${o.skipUnmatched ? " Some are in steps or expressions that cannot be left out: copy without the mapping and change those in Studio Pro." : " Add those attributes/associations first, or \"skipUnmatched\": true to leave out the widgets that show them."}`);
            }
            lines.push(`left out ${gone.length} widget(s)/member change(s) naming ${list.slice(0, 6).join(", ")}: ${[...new Set(gone)].slice(0, 8).join(", ")}`);
        }
        if (Array.isArray(tree.AllowedModuleRoles)) tree.AllowedModuleRoles = tree.AllowedModuleRoles.filter(Boolean);
        if (typeof tree.Url === "string" && tree.Url) {
            lines.push(`URL '${tree.Url}' not copied (a URL belongs to one page)`);
            tree.Url = "";
        }
        if (tree.MicroflowActionInfo) client.warn(`${dst}: copied with the toolbox action of ${src} (${tree.MicroflowActionInfo.Caption || ""}); change its caption in Studio Pro`);
        const container = o.folder ? (await (async () => {
            const f = h.folder(toModule, o.folder);
            await model.flushChanges();
            return f.id;
        })()) : (toModule === srcModule && !o.folder ? client.project.units.get(unit.id).containerId : moduleUnit(g, toModule));
        addUnit(tree, container);
        if (o.entity) lines.unshift(`for ${Object.entries(o.entity).map(([a, b]) => `${a} -> ${b}`).join(", ")} (${notes.size} member(s) by name)`);
        if (toModule !== srcModule && (client.project.read(unit.id).AllowedModuleRoles || []).length) lines.push(`roles ${(tree.AllowedModuleRoles || []).join(", ") || "none"}`);
        return `${src} -> ${dst}${lines.length ? "\n      " + lines.join("\n      ") : ""}`;
    }

    // An entity copied into a domain model: attributes, validation rules, access rules, indexes, event handlers;
    // associations it owns when asked.
    function copyEntity(o, g, src, dst, mapName, refusedRoles, unmatched) {
        const [srcModule, srcName] = src.split(".");
        const [toModule, name] = dst.split(".");
        const dmOf = m => g.units.find(u => u.type === "DomainModels$DomainModel" && u.module === m);
        const fromDm = client.project.read(dmOf(srcModule).id);
        const toUnit = dmOf(toModule);
        const toDm = client.project.read(toUnit.id);
        const e = fromDm.Entities.find(x => x.Name === srcName);
        const copy = clone(e);
        const ids = freshIds(copy);
        copy.Name = name;
        const memberOf = n => (n.startsWith(src + ".") ? dst + n.slice(src.length) : n);
        rebind(copy, client.schema, n => {
            const m = memberOf(n);
            if (m !== n) return m;
            return mapName(n);
        }, unmatched);
        if (refusedRoles.size) throw new Error(`module roles of ${src} have no match in ${toModule}: ${[...refusedRoles].join(", ")}. Give "roles": { "${[...refusedRoles][0]}": "${toModule}.<Role>" } (or "" to drop one)`);
        for (const r of copy.AccessRules || []) r.AllowedModuleRoles = (r.AllowedModuleRoles || []).filter(Boolean);
        copy.AccessRules = (copy.AccessRules || []).filter(r => r.AllowedModuleRoles.length);
        // member rights of associations that are not copied
        const lines = [];
        const owned = (fromDm.Associations || []).filter(a => a.ParentPointer === e.$ID);
        const assocNew = new Map();
        if (o.associations) {
            for (const a of owned) {
                const child = fromDm.Entities.find(x => x.$ID === a.ChildPointer);
                const childQn = child ? `${srcModule}.${child.Name}` : null;
                const selfLink = a.ChildPointer === e.$ID;
                const nameA = a.Name.startsWith(srcName + "_") ? name + a.Name.slice(srcName.length) : `${name}_${a.Name}`;
                if (g.names.has(`${toModule}.${nameA}`)) throw new Error(`${toModule}.${nameA} already exists (copy of association ${srcModule}.${a.Name})`);
                const c = clone(a);
                freshIds(c);
                c.Name = nameA;
                c.ParentPointer = copy.$ID;
                if (selfLink) c.ChildPointer = copy.$ID;
                if (toModule !== srcModule && !selfLink) {
                    // the child stays in the old module: a cross-module association names it
                    const cross = require("./ops-entity").toCross(c, childQn);
                    client.warn(`DomainModels$CrossAssociation first use by ops (no Studio Pro sample in the test projects): check ${toModule}.${nameA} in Studio Pro`);
                    toDm.CrossAssociations = toDm.CrossAssociations || [];
                    toDm.CrossAssociations.push(cross);
                } else (toDm.Associations = toDm.Associations || []).push(c);
                assocNew.set(`${srcModule}.${a.Name}`, `${toModule}.${nameA}`);
            }
            if (owned.length) lines.push(`associations ${[...assocNew.values()].join(", ")}`);
        }
        // XPath of the copied access rules: the copied associations
        eachString(copy.AccessRules || [], (v, key) => (key === "XPathConstraint" ? v.replace(QN_TOKEN, t => assocNew.get(t) || t) : v));
        for (const r of copy.AccessRules || []) {
            r.MemberAccesses = (r.MemberAccesses || []).filter(m => !m.Association || assocNew.has(m.Association) || !owned.some(a => `${srcModule}.${a.Name}` === m.Association));
            for (const m of r.MemberAccesses) if (m.Association && assocNew.has(m.Association)) m.Association = assocNew.get(m.Association);
        }
        if (unmatched.length) throw new Error(`the copy names what ${toModule} lacks: ${[...new Set(unmatched.map(u => u.name))].slice(0, 10).join(", ")}`);
        // place it right of the others
        const xs = (toDm.Entities || []).map(x => Number(String(x.Location || "0;0").split(";")[0]) || 0);
        copy.Location = `${(xs.length ? Math.max(...xs) : 0) + 200};${String(e.Location || "100;100").split(";")[1] || 100}`;
        toDm.Entities.push(copy);
        client.changes.updated.add(toUnit.id);
        (client.rawUnits = client.rawUnits || new Set()).add(toUnit.id);
        client.indexed.delete(toUnit.id);
        client.indexUnit(toUnit.id);
        if (!o.associations && owned.length) lines.push(`not copied: association(s) ${owned.map(a => a.Name).join(", ")} (add "associations": true)`);
        const into = (fromDm.Associations || []).filter(a => a.ChildPointer === e.$ID && a.ParentPointer !== e.$ID);
        if (into.length) lines.push(`not copied: association(s) of other entities to it: ${into.map(a => a.Name).join(", ")}`);
        lines.unshift(`${(copy.Attributes || []).length} attribute(s), ${(copy.ValidationRules || []).length} validation rule(s), ${(copy.AccessRules || []).length} access rule(s)${ids.size ? "" : ""}`);
        return `${src} -> ${dst}\n      ${lines.join("\n      ")}`;
    }

    async function checkCopy(o) {
        const g = refs.graph(client);
        const src = String(o.document).trim();
        const dst = `${o.module || src.split(".")[0]}.${o.name || src.split(".").pop()}`;
        if (!g.names.has(dst) && !g.units.some(u => u.label === dst)) return [`${dst} missing`];
        const r = [];
        const unit = g.units.find(u => u.label === dst);
        if (unit && o.entity) {
            for (const [from] of Object.entries(o.entity)) {
                const left = g.edges.filter(e => e.unit === unit.id && (e.to === from || e.to.startsWith(from + ".")));
                if (left.length) r.push(`${dst} still names ${from} (${left.slice(0, 3).map(e => e.to).join(", ")})`);
            }
        }
        if (unit && g.edges.some(e => e.unit === unit.id && e.to.startsWith(src + ".") && src !== dst)) r.push(`${dst} still names parts of ${src}`);
        return r;
    }

    return { impl: { copyDocument }, checks: { copyDocument: checkCopy }, internals: { clone, freshIds, rebind, eachString, moduleUnit, addUnit, roleMapper } };
}

module.exports = { makeCopy, COPY_OPS, clone, freshIds, eachString };
