"use strict";
// What the Model SDK offers in one Mendix version: types, properties, enum values, createIn functions, and what
// replaced the removed ones. Source of truth is the SDK's runtime metadata (versionInfo, createIn version checks);
// the .d.ts files only add TypeScript property types and createIn argument types. Most removals carry no message,
// so version-rules.json adds hand-written replacements. Built once per SDK version into .cache/ (loading the SDK
// takes ~250 ms), then filtered per Mendix version in memory.
const fs = require("fs");
const os = require("os");
const path = require("path");

const FORMAT = 1;
const SDK_DIR = path.dirname(require.resolve("mendixmodelsdk/package.json"));
const RULES = require("./version-rules.json").rules;

const tuple = v => String(v).split(".").slice(0, 3).map(n => parseInt(n, 10) || 0);
function cmp(a, b) {
    const x = tuple(a), y = tuple(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
}

// "10.24.0.73019" / "10.24" -> "10.24.0"; null when it is no version
function normalize(v) {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || "").trim());
    return m ? `${m[1]}.${m[2]}.${m[3] || 0}` : null;
}

// life = [introduced, deleted, deletionMessage] (absent: always there). "ok" | "removed" | "new" at version v.
function state(life, v) {
    if (!life) return "ok";
    if (life[1] && cmp(v, life[1]) >= 0) return "removed";
    if (life[0] && cmp(v, life[0]) < 0) return "new";
    return "ok";
}
const inWindow = (start, end, v) => (!start || cmp(v, start) >= 0) && (!end || cmp(v, end) <= 0);

// ---------- build: runtime metadata + d.ts types ----------

// { "<ns>.<Class>": { get: { prop: tsType }, create: { fn: args } } } from the .d.ts files
function declarations() {
    const out = new Map();
    const dir = path.join(SDK_DIR, "src", "gen");
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".d.ts"))) {
        const ns = file.slice(0, -5);
        let cur = null;
        for (const raw of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
            const line = raw.trim();
            const cls = /^(?:export )?(?:declare )?(?:abstract )?class (\w+)/.exec(line);
            if (cls) {
                cur = { get: {}, create: {} };
                out.set(`${ns}.${cls[1]}`, cur);
                continue;
            }
            if (!cur) continue;
            let m;
            if ((m = /^get (\w+)\(\): (.+);$/.exec(line))) cur.get[m[1]] = m[2];
            else if ((m = /^static (create\w*)\((.*)\): \w+;$/.exec(line))) cur.create[m[1]] = m[2];
            else if (line === "}") cur = null;
        }
    }
    return out;
}

const lifeOf = a => (a && (a.introduced || a.deleted) ? [a.introduced ? String(a.introduced) : null, a.deleted ? String(a.deleted) : null, a.deletionMessage || null] : null);

// types: { key: { s: structureTypeName, x: parent key, l: life, p: [[prop, tsType, ...life]], c: [[fn, args, start, end, prop]] }
//          | { e: [[value, ...life]] } for enums }
function build(sdkVersion) {
    const sdk = require("mendixmodelsdk");
    const dts = declarations();
    const keyOf = new Map();
    for (const [ns, mod] of Object.entries(sdk)) {
        if (!mod || typeof mod !== "object") continue;
        for (const [name, cls] of Object.entries(mod)) {
            if (typeof cls !== "function" || keyOf.has(cls)) continue;
            if (cls.versionInfo || cls.prototype instanceof sdk.AbstractEnum) keyOf.set(cls, `${ns}.${name}`);
        }
    }
    const types = {};
    for (const [cls, key] of keyOf) {
        const d = dts.get(key) || { get: {}, create: {} };
        if (cls.prototype instanceof sdk.AbstractEnum) {
            types[key] = { e: Object.keys(cls).filter(k => cls[k] instanceof cls).map(k => [k, ...(lifeOf(cls[k].versionInfo) || [])]) };
            continue;
        }
        const t = { s: cls.structureTypeName, x: keyOf.get(Object.getPrototypeOf(cls)) || null, p: [], c: [] };
        const life = lifeOf(cls.versionInfo.availability);
        if (life) t.l = life;
        for (const m of cls.toString().matchAll(/this\.__\w+ = new internal\.\w+\(\w+, this, "(\w+)"/g)) {
            if (!(m[1] in d.get)) continue; // no public accessor
            const info = cls.versionInfo.properties[m[1]];
            t.p.push([m[1], d.get[m[1]], ...((info && lifeOf(info.availability)) || [])]);
        }
        for (const fn of Object.getOwnPropertyNames(cls).filter(k => /^create/.test(k) && typeof cls[k] === "function")) {
            const src = cls[fn].toString();
            const w = /createInVersionCheck\([^{]*\{([^}]*)\}/.exec(src);
            const start = w && /start: "([\d.]+)"/.exec(w[1]), end = w && /end: "([\d.]+)"/.exec(w[1]);
            const into = /createElement\(container, \w+, "(\w+)"/.exec(src);
            t.c.push([fn, d.create[fn] || "", start ? start[1] : null, end ? end[1] : null, into ? into[1] : null]);
        }
        types[key] = t;
    }
    return { sdk: sdkVersion, format: FORMAT, max: String(sdk.MAX_METAMODEL_VERSION), types };
}

// ---------- catalog: cached on disk per SDK version, indexed in memory ----------

let cat = null;
function catalog() {
    if (cat) return cat;
    const sdkVersion = JSON.parse(fs.readFileSync(path.join(SDK_DIR, "package.json"), "utf8")).version;
    const name = `sdk-${sdkVersion}-${FORMAT}.json`;
    const dirs = [path.join(__dirname, ".cache"), path.join(os.tmpdir(), "mxlocal-cache")];
    for (const d of dirs) {
        try {
            cat = JSON.parse(fs.readFileSync(path.join(d, name), "utf8"));
            break;
        } catch (e) {
            // not cached there
        }
    }
    if (!cat) {
        cat = build(sdkVersion);
        const text = JSON.stringify(cat);
        for (const d of dirs) {
            try {
                fs.mkdirSync(d, { recursive: true });
                if (!fs.existsSync(path.join(d, ".gitignore"))) fs.writeFileSync(path.join(d, ".gitignore"), "*\n");
                const tmp = path.join(d, `${name}.${process.pid}.tmp`);
                fs.writeFileSync(tmp, text);
                fs.renameSync(tmp, path.join(d, name));
                break;
            } catch (e) {
                // read-only: try the next place; the catalog stays in memory anyway
            }
        }
    }
    cat.byStructure = new Map();
    cat.children = new Map();
    cat.place = new Map(); // "<parent key>.<prop>" -> [[child key, start, end]]
    for (const [key, t] of Object.entries(cat.types)) {
        if (t.s) cat.byStructure.set(t.s, key);
        if (t.x) (cat.children.get(t.x) || cat.children.set(t.x, []).get(t.x)).push(key);
        for (const [, args, start, end, prop] of t.c || []) {
            const parent = /^container: ([\w.]+)$/.exec(args);
            const pk = parent && prop && resolve(parent[1], key.split(".")[0]);
            if (!pk) continue;
            const slot = `${pk}.${prop}`;
            (cat.place.get(slot) || cat.place.set(slot, []).get(slot)).push([key, start, end]);
        }
    }
    return cat;
}

// TS type name as written in a .d.ts of namespace ns -> catalog key (or null)
function resolve(name, ns) {
    const types = (cat || catalog()).types;
    const clean = String(name).replace(/^internal\./, "").replace(/\s*\|\s*null$/, "").trim();
    const key = clean.includes(".") ? clean : `${ns}.${clean}`;
    if (types[key]) return key;
    const noI = key.replace(/\.I([A-Z]\w*)$/, ".$1"); // interface IFolderBase -> FolderBase
    return types[noI] ? noI : null;
}

// Accepts "Attribute", "domainmodels.Attribute", "DomainModels$Attribute", storage names like "Forms$Page".
function lookup(query) {
    const c = catalog();
    let q = String(query).trim();
    if (q.includes("$")) {
        if (c.byStructure.has(q)) return { exact: [c.byStructure.get(q)] };
        const storage = Object.entries(require("./storage-names.json")).find(([, o]) => o.$ === q);
        if (storage && c.byStructure.has(storage[0])) return { exact: [c.byStructure.get(storage[0])] };
        q = q.replace("$", ".");
    }
    const low = q.toLowerCase();
    const keys = Object.keys(c.types);
    const exact = keys.filter(k => k.toLowerCase() === low || k.split(".")[1].toLowerCase() === low);
    if (exact.length) return { exact };
    const words = low.split(/[\s.]+/).filter(Boolean);
    return { exact: [], near: keys.filter(k => words.every(w => k.toLowerCase().includes(w))) };
}

const short = key => key.split(".")[1];

// key and its ancestors in the catalog, nearest first
function chain(key) {
    const out = [];
    for (let k = key; k && out.length < 20; k = cat.types[k].x) out.push(k);
    return out;
}

// Concrete subtypes (key itself included) available at v
function concrete(key, v) {
    const out = [];
    const walk = k => {
        const t = cat.types[k];
        if (state(t.l, v) !== "ok") return;
        if (t.c.some(c => c[0] === "create" || c[0].startsWith("createIn"))) out.push(k);
        for (const ch of cat.children.get(k) || []) walk(ch);
    };
    walk(key);
    return out;
}

// What can be placed in <declaring type>.<prop> at v: types with an available createIn<Parent>Under<Prop>
function placement(declKey, prop, v) {
    const all = (catalog().place.get(`${declKey}.${prop}`) || []).filter(([k, start, end]) => inWindow(start, end, v) && state(cat.types[k].l, v) === "ok");
    return [...new Set(all.map(x => x[0]))].sort();
}

// The type that declares prop, starting at key (props are inherited)
function declaring(key, prop) {
    return chain(key).find(k => (cat.types[k].p || []).some(p => p[0] === prop)) || null;
}

// ---------- availability, rewrites, hints ----------

// "DataView.editable" / "Pages$DataView.editable" / "GridDatabaseSource" -> "pages.DataView.editable" (declaring type)
function ruleKey(q) {
    const c = catalog();
    const parts = String(q).replace(/\$/g, ".").split(".");
    const [typeQ, prop] = parts.length > 2 || (parts.length === 2 && /^[a-z]/.test(parts[1])) ? [parts.slice(0, -1).join("."), parts[parts.length - 1]] : [parts.join("."), null];
    const direct = c.types[typeQ] ? typeQ : c.byStructure.get(typeQ.replace(".", "$"));
    const keys = (direct ? [direct] : lookup(typeQ).exact).map(k => (prop ? `${declaring(k, prop) || k}.${prop}` : k));
    return keys.find(k => RULES[k]) || keys.find(k => k.startsWith("pages.")) || keys[0] || null;
}

// rewrite("GridDatabaseSource" | "pages.DataView.editable" | "Pages$DataView.editable") -> { key, removedIn, use, note } or null
function rewrite(typeOrProp) {
    const key = ruleKey(typeOrProp);
    if (!key) return null;
    const rule = RULES[key];
    const [tk, prop] = key.split(".").length > 2 ? [key.split(".").slice(0, 2).join("."), key.split(".")[2]] : [key, null];
    const t = cat.types[tk];
    const life = prop ? ((t.p || []).find(p => p[0] === prop) || []).slice(2) : t.l;
    const removedIn = (life && life[1]) || (rule && rule.removedIn) || null;
    const message = (life && life[2]) || null;
    if (!rule && !removedIn) return null;
    return { key, removedIn, use: (rule && rule.use) || null, note: (rule && rule.note) || message, kind: (rule && rule.kind) || null };
}

// "Use X: note" for a removed type/property, "" when nothing is known
function advice(r) {
    const end = s => (/[.!?]$/.test(s) ? s : s + ".");
    if (!r) return "";
    if (r.use && r.note) return end(`Use ${r.use}: ${r.note}`);
    if (r.use) return `Use ${r.use}.`;
    return r.note ? end(r.note) : "";
}

// availability(type, prop?, version) -> { key, state: ok|removed|new|unknown, introduced, removedIn, use, note }
function availability(type, prop, version) {
    const v = normalize(version);
    const c = catalog();
    const keys = c.byStructure.has(String(type)) ? [c.byStructure.get(String(type))] : lookup(type).exact;
    const key = keys.find(k => !prop || declaring(k, prop)) || keys[0];
    if (!key) return { key: null, state: "unknown" };
    const t = c.types[key];
    let life = t.l, k = key;
    if (prop) {
        k = declaring(key, prop);
        if (!k) return { key: `${key}.${prop}`, state: "unknown" };
        life = (c.types[k].p.find(p => p[0] === prop) || []).slice(2);
        k = `${k}.${prop}`;
    }
    const s = state(life && life.length ? life : null, v);
    const r = rewrite(k) || {};
    return { key: k, state: s, introduced: (life && life[0]) || null, removedIn: (life && life[1]) || null, use: r.use || null, note: r.note || null };
}

// SDK error text -> hint naming the replacement (version from the message when not given)
function hintFor(msg, version) {
    msg = String(msg || "");
    let m;
    const ver = (m = /Mendix version (\d+\.\d+\.\d+)/.exec(msg)) ? m[1] : normalize(version);
    try {
        catalog();
    } catch (e) {
        return null;
    }
    const keyOf = st => cat.byStructure.get(st) || null;
    if ((m = /Property '(\w+)' of type '(\w+\$\w+)' can no longer be instantiated .*?removed since Mendix version ([\d.]+)\)/.exec(msg))) {
        const key = keyOf(m[2]);
        const r = key && rewrite(`${key}.${m[1]}`);
        return `${short(key || m[2])}.${m[1]} was removed in Mendix ${m[3]}. ${advice(r) || "It has no replacement; leave it out."} Check: api ${short(key || m[2])}`;
    }
    if ((m = /Type '(\w+\$\w+)' can no longer be instantiated .*?removed since Mendix version ([\d.]+)\)/.exec(msg))) {
        const key = keyOf(m[1]);
        const r = key && rewrite(key);
        return `${key || m[1]} was removed in Mendix ${m[2]}. ${advice(r) || "Look for its successor with: api <parent type>."} Check: api ${short(key || m[1])}`;
    }
    if ((m = /(?:Property '(\w+)' of type|Type) '(\w+\$\w+)' is not yet available in Mendix version ([\d.]+)\. It was introduced in Mendix version ([\d.]+)/.exec(msg))) {
        const key = keyOf(m[2]);
        return `${m[1] ? short(key || m[2]) + "." + m[1] : key || m[2]} exists only from Mendix ${m[4]}; this project is ${m[3]}. Use what api ${short(key || m[2])} lists for ${m[3]}.`;
    }
    if ((m = /it is illegal on instances of (\w+\$\w+) to call the "createIn" method/.exec(msg))) {
        const key = keyOf(m[1]);
        if (!key) return null;
        const t = cat.types[key];
        if (state(t.l, ver) === "removed") return `${key} was removed in Mendix ${t.l[1]}. ${advice(rewrite(key)) || ""} Check: api ${short(key)}`.replace(/\s+Check/, " Check");
        if (state(t.l, ver) === "new") return `${key} exists only from Mendix ${t.l[0]}; this project is ${ver}.`;
        const ok = cat.types[key].c.filter(c => inWindow(c[2], c[3], ver) && c[0] !== "create").map(c => `${c[0]}(${c[1]})`);
        return `That createIn function is not valid in Mendix ${ver}. Valid for ${short(key)}: ${ok.slice(0, 4).join(", ") || "none"}${ok.length > 4 ? ` (+${ok.length - 4}; api ${short(key)} <parent word>)` : ""}, or create(model) and assign it to the parent property.`;
    }
    if ((m = /(?:^|\s)(?:sdk\.)?(\w+)\.(\w+)\.(create\w*) is not a function/.exec(msg))) {
        const key = lookup(`${m[1]}.${m[2]}`).exact[0];
        if (!key) return null;
        const ok = cat.types[key].c.filter(c => c[0] !== "create" && (!ver || inWindow(c[2], c[3], ver))).map(c => c[0]);
        const { suggest } = require("./ops-util");
        const s = suggest(m[3], ok, 3);
        return `${short(key)} has no ${m[3]}${ver ? ` in Mendix ${ver}` : ""}.${s.length ? ` Did you mean: ${s.join(", ")}?` : ""} List them: api ${short(key)} <parent word>`;
    }
    if (/Cannot encode value/.test(msg)) {
        const names = Object.entries(RULES).filter(([, r]) => r.kind === "name").map(([k, r]) => `${k.split(".").slice(1).join(".")} (${r.note})`);
        return `A text/number property got an element or object. ${names.length ? "E.g. " + names.join("; ") + ". " : ""}Check property types with: api <Type>`;
    }
    return null;
}

// version-rules.json against the runtime metadata: keys exist, removedIn matches, named replacements exist.
function checkRules() {
    const c = catalog();
    const problems = [];
    for (const [key, r] of Object.entries(RULES)) {
        const parts = key.split(".");
        const t = c.types[parts.slice(0, 2).join(".")];
        const p = t && parts[2] && (t.p || []).find(x => x[0] === parts[2]);
        if (!t || (parts[2] && !p)) {
            problems.push(`${key}: not in the SDK`);
            continue;
        }
        const life = p ? p.slice(2) : t.l || [];
        if ((r.removedIn || null) !== (life[1] || null)) problems.push(`${key}: removedIn ${r.removedIn || "-"}, SDK says ${life[1] || "-"}`);
        for (const u of String(r.use || "").match(/\b[a-z]+\.[A-Z]\w*(?:\.[a-z]\w*)?/g) || []) {
            const [ns, cls, prop] = u.split(".");
            const ut = c.types[`${ns}.${cls}`];
            const dk = ut && prop && declaring(`${ns}.${cls}`, prop);
            if (!ut || (prop && !dk)) {
                problems.push(`${key}: replacement ${u} not in the SDK`);
                continue;
            }
            const ul = prop ? c.types[dk].p.find(x => x[0] === prop).slice(2) : ut.l;
            if (r.removedIn && (state(ut.l, r.removedIn) !== "ok" || state(ul, r.removedIn) !== "ok")) problems.push(`${key}: replacement ${u} not available in ${r.removedIn}`);
        }
    }
    return { rules: Object.keys(RULES).length, problems };
}

module.exports = { catalog, normalize, cmp, state, inWindow, resolve, lookup, chain, concrete, placement, declaring, availability, rewrite, advice, hintFor, checkRules, short };
