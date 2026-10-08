"use strict";
// Lookups for an agent that does not know the Model SDK by heart:
//   api <Type>   properties, value types, enum values and createIn functions of an SDK type, for this Mendix version
//   find <text>  elements of the project whose qualified name contains the text, with their SDK type
const fs = require("fs");
const path = require("path");

const GEN = path.join(path.dirname(require.resolve("mendixmodelsdk/package.json")), "src", "gen");

// { "<ns>.<Class>": { ns, name, ext, props: [{name, type, notes}], creates: [signature], enumValues? } } from the .d.ts files
let declCache = null;
function declarations() {
    if (declCache) return declCache;
    declCache = new Map();
    for (const file of fs.readdirSync(GEN).filter(f => f.endsWith(".d.ts"))) {
        const ns = file.replace(".d.ts", "");
        const lines = fs.readFileSync(path.join(GEN, file), "utf8").split(/\r?\n/);
        let cur = null;
        let notes = [];
        for (const raw of lines) {
            const line = raw.trim();
            const cls = /^(?:export )?(?:declare )?(?:abstract )?class (\w+)(?:<[^>]*>)? extends ([\w.]+)/.exec(line);
            if (cls) {
                cur = { ns, name: cls[1], ext: cls[2], props: [], creates: [], enumValues: [] };
                declCache.set(`${ns}.${cls[1]}`, cur);
                notes = [];
                continue;
            }
            if (!cur) continue;
            const note = /^\*\s+(In version .*)$/.exec(line);
            if (note) {
                notes.push(note[1]);
                continue;
            }
            const get = /^get (\w+)\(\): (.+);$/.exec(line);
            if (get && !get[1].startsWith("containerAs") && !["qualifiedName", "model"].includes(get[1])) {
                cur.props.push({ name: get[1], type: get[2], notes });
            }
            const create = /^static (create\w*)\((.*)\): \w+;$/.exec(line);
            if (create) cur.creates.push({ fn: create[1], args: create[2], notes });
            const ev = /^static (\w+): (\w+);$/.exec(line);
            if (ev && ev[2] === cur.name) cur.enumValues.push({ name: ev[1], notes });
            if (!line.startsWith("*") && !line.startsWith("/**") && !line.startsWith("*/")) notes = [];
            if (line === "}") cur = null;
        }
    }
    return declCache;
}

const versionTuple = v => v.split(".").map(Number);
function cmpVersion(a, b) {
    for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    return 0;
}

// Available in this Mendix version, judged from "In version X: introduced/deleted" notes.
function available(notes, version) {
    const v = versionTuple(version);
    let ok = true;
    const events = notes
        .map(n => /In version ([\d.]+): (introduced|deleted)/.exec(n))
        .filter(Boolean)
        .map(m => ({ v: versionTuple(m[1]), what: m[2] }))
        .sort((a, b) => cmpVersion(a.v, b.v));
    for (const e of events) if (cmpVersion(v, e.v) >= 0) ok = e.what === "introduced";
    if (events.length && events[0].what === "introduced" && cmpVersion(v, events[0].v) < 0) ok = false;
    return ok;
}

function resolveDecl(name, ns) {
    const d = declarations();
    const clean = name.replace(/^internal\./, "").replace(/\s*\|\s*null$/, "");
    if (clean.includes(".")) return d.get(clean.replace(/^(\w+)\./, (m, n) => n.toLowerCase() + "."));
    return d.get(`${ns}.${clean}`);
}

function subtypes(decl) {
    const out = [];
    const target = `${decl.ns}.${decl.name}`;
    for (const [key, c] of declarations()) {
        let cur = c;
        for (let i = 0; i < 10 && cur; i++) {
            const parent = resolveDecl(cur.ext, cur.ns);
            if (!parent) break;
            if (`${parent.ns}.${parent.name}` === target) {
                out.push(key);
                break;
            }
            cur = parent;
        }
    }
    return out;
}

// Accepts "Attribute", "domainmodels.Attribute", "DomainModels$Attribute"; returns matching declaration keys.
function lookup(query) {
    const d = declarations();
    const q = query.replace("$", ".").toLowerCase();
    const exact = [...d.keys()].filter(k => k.toLowerCase() === q || k.split(".")[1].toLowerCase() === q);
    if (exact.length) return { exact };
    const words = q.split(/[\s.]+/).filter(Boolean);
    const near = [...d.keys()].filter(k => words.every(w => k.toLowerCase().includes(w)));
    return { exact: [], near };
}

// query: "<Type> [filter]"; the filter word narrows long CREATE lists (e.g. "ObjectType Microflow").
function api(query, version) {
    const [typeName, ...rest] = query.trim().split(/\s+/);
    const filter = rest.join(" ").toLowerCase();
    const { exact, near } = lookup(typeName);
    if (!exact.length) {
        if (!near.length) return `No SDK type matches '${query}'. Try a shorter word, e.g. api Retrieve.`;
        return `No exact type '${query}'. Types containing it:\n` + near.slice(0, 60).map(k => "  " + k).join("\n");
    }
    return exact.map(k => describe(k, version, filter)).join("\n\n");
}

function describe(key, version, filter) {
    const decl = declarations().get(key);
    const out = [];
    const chain = [];
    let cur = decl;
    const props = [];
    const creates = decl.creates.filter(c => available(c.notes, version));
    for (let i = 0; i < 10 && cur; i++) {
        chain.push(cur.name);
        for (const p of cur.props) if (!props.some(x => x.name === p.name)) props.push({ ...p, from: cur });
        cur = resolveDecl(cur.ext, cur.ns);
    }
    const isEnum = decl.enumValues.length > 0;
    out.push(`sdk.${key}   (Mendix ${version}; extends ${chain.slice(1).join(" > ") || decl.ext})`);
    if (isEnum) {
        out.push("ENUM values: " + decl.enumValues.filter(v => available(v.notes, version)).map(v => `${key}.${v.name}`).join(", "));
        return out.join("\n");
    }
    const subs = subtypes(decl);
    if (subs.length) out.push("ABSTRACT? use one of these subtypes: " + subs.slice(0, 40).join(", "));
    if (creates.length) {
        out.push("CREATE:");
        const shown = creates.filter(c => !filter || c.fn === "create" || `${c.fn}(${c.args})`.toLowerCase().includes(filter));
        const max = filter ? 40 : 6;
        for (const c of shown.slice(0, max)) out.push(`  sdk.${key}.${c.fn}(${c.args})`);
        if (shown.length > max) out.push(`  ... ${shown.length - max} more. Narrow it: api ${decl.name} <parent word>, or use create(model) and assign: parent.prop = x`);
    }
    const missing = [];
    out.push("PROPERTIES:");
    for (const p of props) {
        if (!available(p.notes, version)) {
            missing.push(p.name);
            continue;
        }
        let line = `  ${p.name}: ${p.type}`;
        const listOf = /IList<(.+)>/.exec(p.type);
        const t = resolveDecl(listOf ? listOf[1] : p.type, p.from.ns);
        if (t && t.enumValues.length) line += "  = " + t.enumValues.filter(v => available(v.notes, version)).map(v => v.name).join(" | ");
        else if (t) {
            const s = subtypes(t);
            if (s.length) line += "  (one of: " + s.slice(0, 12).map(x => x.split(".")[1]).join(", ") + (s.length > 12 ? ", ..." : "") + ")";
        }
        if (listOf) line += "  [list: .push(x) / .remove(x)]";
        out.push(line);
    }
    if (missing.length) out.push("NOT IN THIS MENDIX VERSION (do not use): " + missing.join(", "));
    return out.join("\n");
}

// Every named element: units (Module.Doc) and elements inside them (Module.Entity, Module.Entity.Attribute, ...).
function names(client) {
    const hits = [];
    const schema = client.schema;
    for (const unitId of client.project.units.keys()) {
        const plain = client.project.read(unitId);
        const unitName = client.label(unitId);
        const walk = (obj, prefix, depth) => {
            if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
            if (Array.isArray(obj)) return obj.forEach(x => walk(x, prefix, depth));
            let next = prefix;
            if (obj.$Type && typeof obj.Name === "string" && obj.Name && depth > 0) {
                next = `${prefix}.${obj.Name}`;
                hits.push({ qn: next, type: schema.sdkType(obj.$Type) || obj.$Type });
            }
            for (const [k, v] of Object.entries(obj)) if (k[0] !== "$" && v && typeof v === "object") walk(v, next, depth + 1);
        };
        if (plain.$Type === "DomainModels$DomainModel") walk(plain, unitName.split(".")[0], 0);
        else if (/Security\$ModuleSecurity/.test(plain.$Type)) walk(plain, unitName.split(".")[0], 0);
        else {
            if (plain.Name) hits.push({ qn: unitName, type: schema.sdkType(plain.$Type) || plain.$Type });
            if (/Enumeration|Microflow|Nanoflow/.test(plain.$Type)) walk(plain, unitName, 0);
        }
    }
    return hits;
}

function find(client, text, limit = 40) {
    const q = text.toLowerCase();
    const hits = names(client).filter(h => h.qn.toLowerCase().includes(q)).map(h => `${h.qn}   [${h.type}]`);
    hits.sort((a, b) => a.length - b.length || a.localeCompare(b));
    if (!hits.length) return `Nothing named like '${text}'. Use a shorter part of the name.`;
    return hits.slice(0, limit).join("\n") + (hits.length > limit ? `\n... ${hits.length - limit} more; use a longer text.` : "");
}

module.exports = { api, find, names };
