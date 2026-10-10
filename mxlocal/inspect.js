"use strict";
// Lookups for an agent that does not know the Model SDK by heart:
//   api <Type> [word]  properties, value types, enum values and createIn functions of an SDK type for the project's
//                      Mendix version (versions.js: SDK runtime metadata + version-rules.json)
//   find <text>        elements of the project whose qualified name contains the text, with their SDK type
const versions = require("./versions");

const { state, inWindow, short } = versions;
const nsOf = key => key.split(".")[0];
const win = (start, end) => (start && end ? `${start}-${end}` : start ? `from ${start}` : `to ${end}`);

// Type list relative to namespace home; long lists grouped by namespace
function oneOf(keys, home) {
    if (keys.length <= 16) return keys.map(k => (nsOf(k) === home ? short(k) : k)).join(", ");
    const groups = new Map();
    for (const k of keys) (groups.get(nsOf(k)) || groups.set(nsOf(k), []).get(nsOf(k))).push(short(k));
    return `${keys.length} types: ` + [...groups].map(([n, names]) => `${n}: ${names.join(", ")}`).join("; ");
}

// query: "<Type> [filter]"; the filter word narrows long CREATE lists (e.g. "ObjectType Microflow").
function api(query, version) {
    const v = versions.normalize(version);
    if (!v) throw new Error(`api needs the project's Mendix version, got '${version}'`);
    const [typeName, ...rest] = query.trim().split(/\s+/);
    const filter = rest.join(" ").toLowerCase();
    const cat = versions.catalog();
    const live = k => state(cat.types[k].l, v) === "ok";
    const head = versions.cmp(v, cat.max) > 0 ? `(Mendix ${v} is newer than this Model SDK (up to ${cat.max}); it cannot change this project)\n` : "";
    const { exact, near } = versions.lookup(typeName);
    if (!exact.length) {
        const hits = near.filter(live), gone = near.filter(k => !live(k)).slice(0, 8);
        const out = [];
        if (hits.length) out.push(`No exact type '${typeName}'. Types containing it in Mendix ${v}:`, ...hits.slice(0, 60).map(k => "  " + k), ...(hits.length > 60 ? [`  ... ${hits.length - 60} more; use a longer word`] : []));
        else {
            const s = [...new Set(require("./ops-util").suggest(typeName, Object.keys(cat.types).filter(live).map(short), 5))];
            out.push(`No SDK type '${typeName}' in Mendix ${v}.` + (s.length ? ` Did you mean: ${s.join(", ")}?` : " Try a shorter word, e.g. api Retrieve."));
        }
        for (const k of gone) {
            const l = cat.types[k].l, r = versions.rewrite(k);
            out.push(`NOT IN MENDIX ${v}: ${k} (${state(l, v) === "removed" ? `removed in ${l[1]}${r && r.use ? "; use " + r.use : ""}` : `from ${l[0]}`})`);
        }
        return head + out.join("\n");
    }
    const rank = k => (live(k) ? 0 : 2) + (nsOf(k) === "pages" ? 0 : 1); // available first, pages before documenttemplates
    return head + exact.sort((a, b) => rank(a) - rank(b)).map(k => describe(k, v, filter)).join("\n\n");
}

function describe(key, v, filter) {
    const cat = versions.catalog();
    const t = cat.types[key];
    const out = [];
    if (t.e) {
        out.push(`sdk.${key}   (Mendix ${v}; enumeration)`);
        out.push("ENUM values: " + t.e.filter(e => state(e.slice(1), v) === "ok").map(e => `${key}.${e[0]}`).join(", "));
        const gone = t.e.filter(e => state(e.slice(1), v) !== "ok").map(e => `${e[0]} (${state(e.slice(1), v) === "removed" ? "removed in " + e[2] : "from " + e[1]})`);
        if (gone.length) out.push(`NOT IN MENDIX ${v}: ${gone.join(", ")}`);
        return out.join("\n");
    }
    const chain = versions.chain(key);
    out.push(`sdk.${key}   (Mendix ${v}; extends ${chain.slice(1).map(short).join(" > ") || "Element"})`);
    const s = state(t.l, v);
    if (s !== "ok") {
        const r = versions.rewrite(key);
        const use = r && r.use && /\b[a-z]+\.([A-Z]\w*)/.exec(r.use);
        if (s === "removed") out.push(`NOT IN MENDIX ${v}: removed in ${t.l[1]}. ${versions.advice(r) || "No replacement is recorded."}`);
        else out.push(`NOT IN MENDIX ${v}: introduced in ${t.l[0]}.`);
        out.push(`Do not create or assign it.${use ? ` See: api ${use[1]}` : ""}`);
        return out.join("\n");
    }
    const rule = versions.rewrite(key);
    if (rule && rule.note && !rule.removedIn) out.push("NOTE: " + rule.note);
    else if (nsOf(key) === "documenttemplates") out.push("NOTE: document templates (PDF/Word export) only, not pages.");
    const subs = versions.concrete(key, v).filter(k => k !== key);
    if (!t.c.length && subs.length) out.push(`ABSTRACT: create one of these instead: ${oneOf(subs, nsOf(key))}`);
    else if (subs.length) out.push(`SUBTYPES: ${oneOf(subs, nsOf(key))}`);
    if (t.c.length) {
        const match = c => !filter || `${c[0]}(${c[1]})`.toLowerCase().includes(filter);
        const ok = t.c.filter(c => c[0] !== "create" && inWindow(c[2], c[3], v) && match(c));
        const max = filter ? 40 : 6;
        out.push(`CREATE (Mendix ${v}):`);
        for (const c of ok.slice(0, max)) out.push(`  sdk.${key}.${c[0]}(${c[1]})`);
        if (ok.length > max) out.push(`  ... ${ok.length - max} more. Narrow it: api ${short(key)} <parent word>, or use create(model) and assign: parent.prop = x`);
        if (t.c.some(c => c[0] === "create")) out.push(`  sdk.${key}.create(model)`);
        const no = t.c.filter(c => !inWindow(c[2], c[3], v) && match(c)).map(c => `${c[0]} [${win(c[2], c[3])}]`);
        if (no.length) out.push(`  NOT IN MENDIX ${v} (do not call): ${no.slice(0, filter ? 40 : 4).join(", ")}${no.length > (filter ? 40 : 4) ? `, +${no.length - (filter ? 40 : 4)} more` : ""}`);
    }
    const seen = new Set(), lists = new Map(), removed = [], quiet = [], later = [];
    out.push("PROPERTIES:");
    for (const k of chain) {
        for (const p of cat.types[k].p) {
            if (seen.has(p[0])) continue;
            seen.add(p[0]);
            const life = p.length > 2 ? p.slice(2) : null;
            const st = state(life, v);
            const r = versions.rewrite(`${k}.${p[0]}`);
            if (st === "removed") {
                const adv = versions.advice(r);
                if (adv) removed.push(`  ${p[0]}: removed in ${life[1]}. ${adv}`);
                else quiet.push(`${p[0]} (${life[1]})`);
            } else if (st === "new") later.push(`${p[0]} (${life[0]})`);
            else {
                out.push(propLine(k, p, v, lists));
                if (r && r.note && !r.removedIn) out.push(`    NOTE: ${r.note}`);
            }
        }
    }
    if (removed.length || quiet.length) out.push(`NOT IN MENDIX ${v} (do not use):`, ...removed);
    if (quiet.length) out.push(`  also removed: ${quiet.join(", ")}`);
    if (later.length) out.push(`NOT YET IN MENDIX ${v} (added later): ${later.join(", ")}`);
    return out.join("\n");
}

// "  name: type  = A | B" / "(one of: ...)" / "[list ...]"; one-of lists come from the createIn functions valid at v
function propLine(declKey, p, v, lists) {
    const [name, type] = p;
    let line = `  ${name}: ${type}`;
    const listOf = /IList<(.+)>/.exec(type);
    const tk = versions.resolve(listOf ? listOf[1] : type, nsOf(declKey));
    const tt = tk && versions.catalog().types[tk];
    if (tt && tt.e) line += "  = " + tt.e.filter(e => state(e.slice(1), v) === "ok").map(e => e[0]).join(" | ");
    else if (tt) {
        let opts = versions.placement(declKey, name, v);
        if (!opts.length) opts = versions.concrete(tk, v);
        if (opts.length > 1 || (opts.length === 1 && opts[0] !== tk)) {
            const text = oneOf(opts, nsOf(declKey));
            line += lists.has(text) ? `  (one of: same as ${lists.get(text)})` : `  (one of: ${text})`;
            if (!lists.has(text)) lists.set(text, name);
        }
    }
    if (listOf) line += "  [list: .push(x) / .remove(x)]";
    return line;
}

// Every named element: units (Module.Doc) and elements inside them (Module.Entity, Module.Entity.Attribute, ...).
function names(client) {
    const hits = [];
    const schema = client.schema;
    const { localNames } = require("./cache");
    const cache = client.project.cache;
    for (const unitId of client.project.units.keys()) {
        // cached names of units unchanged in this run; changed or new units from their current contents
        const e = cache && !client.project.plain.has(unitId) && cache.units.get(unitId);
        const info = e || client.unitInfo(unitId);
        const local = e ? e.names : localNames(client.project.read(unitId));
        const unitName = client.label(unitId);
        const prefix = local.base === "module" ? unitName.split(".")[0] : unitName;
        if (local.base === "unit" && info.name) hits.push({ qn: unitName, type: schema.sdkType(info.type) || info.type });
        for (const [rel, type] of local.items) hits.push({ qn: `${prefix}.${rel}`, type: schema.sdkType(type) || type });
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
