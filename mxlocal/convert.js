"use strict";
// Three shapes of a Mendix element:
//   typed  - lossless BSON tree from bson.js
//   plain  - JS object with BSON storage names; original BSON kinds are kept on obj[META]
//   sdk    - Model SDK JSON (SDK type/property names, SDK value shapes)
const { randomUUID } = require("crypto");
const META = Symbol("bson");
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function guidToString(b) {
    const h = b.toString("hex");
    const r = s => s.match(/../g).reverse().join("");
    return `${r(h.slice(0, 8))}-${r(h.slice(8, 12))}-${r(h.slice(12, 16))}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function guidToBytes(s) {
    const h = s.replace(/-/g, "");
    const r = x => x.match(/../g).reverse().join("");
    return Buffer.from(r(h.slice(0, 8)) + r(h.slice(8, 12)) + r(h.slice(12, 16)) + h.slice(16), "hex");
}

function lowerCmp(a, b) {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
}

// ---------- typed <-> plain ----------

function leafToPlain(n) {
    switch (n.k) {
        case 0x03:
            return toPlain(n);
        case 0x05:
            return n.v.length === 16 ? guidToString(n.v) : n.v;
        case 0x08:
            return n.v === 1;
        case 0x09:
        case 0x11:
        case 0x12:
            return n.v >= BigInt(Number.MIN_SAFE_INTEGER) && n.v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n.v) : n.v;
        default:
            return n.v;
    }
}

function descOf(n) {
    const d = { k: n.k };
    if (n.s !== undefined) d.s = n.s;
    if (n.raw) d.raw = n.raw;
    if (n.rawKey) d.rawKey = n.rawKey;
    return d;
}

function toPlain(doc) {
    const obj = {};
    const kinds = {};
    for (const [key, n] of doc.v) {
        const d = descOf(n);
        if (n.k === 0x04) {
            d.m = n.v[0][1].v;
            const items = n.v.slice(1);
            if (items.length) d.e = descOf(items[0][1]);
            obj[key] = items.map(([, x]) => leafToPlain(x));
        } else obj[key] = leafToPlain(n);
        kinds[key] = d;
    }
    Object.defineProperty(obj, META, { value: kinds, enumerable: false, writable: true });
    return obj;
}

// hint(storageType, key) -> descriptor for keys not seen in the original document (new elements/properties).
function fromPlain(obj, hint) {
    const kinds = obj[META] || {};
    const type = obj.$Type;
    const keys = Object.keys(obj).filter(k => k !== "$ID" && k !== "$Type").sort(lowerCmp);
    const fields = [];
    if ("$ID" in obj) fields.push(["$ID", leafFromPlain(obj.$ID, kinds.$ID || { k: 0x05, s: 0 }, hint)]);
    if ("$Type" in obj) fields.push(["$Type", { k: 0x02, v: obj.$Type }]);
    for (const key of keys) {
        const node = leafFromPlain(obj[key], kinds[key] || hint(type, key, obj[key]), hint);
        const d = kinds[key];
        if (d && d.rawKey) node.rawKey = d.rawKey;
        fields.push([key, node]);
    }
    return { k: 0x03, v: fields };
}

function leafFromPlain(value, d, hint) {
    d = d || {};
    if (value === null || value === undefined) return { k: 0x0a, v: null };
    if (Array.isArray(value)) {
        const marker = d.m !== undefined ? d.m : value.length && typeof value[0] === "object" ? 2 : 1;
        const e = d.e || {};
        const fields = [["0", { k: 0x10, v: marker }]];
        value.forEach((x, i) => fields.push([String(i + 1), leafFromPlain(x, e, hint)]));
        return { k: 0x04, v: fields };
    }
    if (Buffer.isBuffer(value)) return { k: 0x05, s: d.s || 0, v: value };
    if (typeof value === "object") return fromPlain(value, hint);
    if (typeof value === "string") {
        if (d.k === 0x05 && GUID_RE.test(value)) return { k: 0x05, s: d.s || 0, v: guidToBytes(value) };
        const node = { k: 0x02, v: value };
        if (d.raw && d.raw.toString("utf8") === value) node.raw = d.raw;
        return node;
    }
    if (typeof value === "boolean") return { k: 0x08, v: value ? 1 : 0 };
    if (typeof value === "bigint") return { k: d.k === 0x09 || d.k === 0x11 ? d.k : 0x12, v: value };
    if (typeof value === "number") {
        if (d.k === 0x01) return d.raw && Number.isNaN(value) ? { k: 0x01, v: value, raw: d.raw } : { k: 0x01, v: value };
        if (d.k === 0x10) return { k: 0x10, v: value };
        if (d.k === 0x09 || d.k === 0x11) return { k: d.k, v: BigInt(Math.round(value)) };
        if (d.k === 0x12 || Number.isInteger(value)) return { k: 0x12, v: BigInt(value) };
        return { k: 0x01, v: value };
    }
    throw new Error("Cannot encode value " + String(value));
}

// ---------- catalog: what BSON kind does (storageType, key) use in this project ----------

class Catalog {
    constructor() {
        this.types = new Map();
    }

    learn(obj) {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) return obj.forEach(x => this.learn(x));
        const kinds = obj[META];
        if (kinds && obj.$Type) {
            let t = this.types.get(obj.$Type);
            if (!t) this.types.set(obj.$Type, (t = new Map()));
            for (const [key, d] of Object.entries(kinds)) {
                let cur = t.get(key);
                if (!cur) t.set(key, (cur = { k: d.k, values: new Map() }));
                if (cur.k === 0x0a && d.k !== 0x0a) cur.k = d.k;
                if (d.s !== undefined) cur.s = d.s;
                if (d.m !== undefined) cur.m = d.m;
                if (d.e && !cur.e) cur.e = { k: d.e.k, s: d.e.s };
                const v = obj[key];
                const sample = v === null || ["string", "boolean", "number"].includes(typeof v) ? v : Array.isArray(v) && !v.length ? "[]" : undefined;
                if (sample !== undefined && (cur.values.size < 32 || cur.values.has(sample))) cur.values.set(sample, (cur.values.get(sample) || 0) + 1);
            }
        }
        for (const v of Object.values(obj)) if (v && typeof v === "object" && !Buffer.isBuffer(v)) this.learn(v);
    }

    // Most common primitive value seen for (type, key), or undefined.
    sample(type, key) {
        const d = this.get(type, key);
        if (!d || !d.values.size) return undefined;
        const [v] = [...d.values.entries()].sort((a, b) => b[1] - a[1])[0];
        return v === "[]" ? [] : v;
    }

    get(type, key) {
        const t = this.types.get(type);
        return t && t.get(key);
    }

    // Types this project never used: take key sets and BSON kinds from reference-catalog.json (learned from Studio Pro
    // projects). strict (same major version): added before schema calibration, so storage names are learned from them
    // too, and keys outside the set are dropped as usual. Loose (other major version): only keys the SDK maps for
    // this version, added after calibration, nothing dropped.
    addReference(ref, schema, strict) {
        this.reference = this.reference || new Set();
        this.looseTypes = this.looseTypes || new Set();
        for (const [type, keys] of Object.entries(ref)) {
            if (this.types.has(type)) continue;
            const info = schema && schema.info(schema.sdkType(type));
            if (schema && !info) continue;
            const t = new Map();
            for (const [key, d] of Object.entries(keys)) {
                if (info && !info.byKey.has(key)) continue;
                const entry = { k: d.k, values: new Map() };
                if (d.s !== undefined) entry.s = d.s;
                if (d.m !== undefined) entry.m = d.m;
                if (d.e !== undefined) entry.e = { k: d.e };
                if (d.v !== undefined) entry.values.set(Array.isArray(d.v) ? "[]" : d.v, 1);
                t.set(key, entry);
            }
            this.types.set(type, t);
            this.reference.add(type);
            if (!strict) this.looseTypes.add(type);
        }
    }

    // Other-version samples: keep only keys the Model SDK maps for this version (after calibration).
    pruneLoose(schema) {
        for (const type of this.looseTypes || []) {
            const info = schema.info(schema.sdkType(type));
            const t = this.types.get(type);
            if (!info) {
                this.types.delete(type);
                this.reference.delete(type);
                this.looseTypes.delete(type);
                continue;
            }
            for (const key of [...t.keys()]) if (!info.byKey.has(key)) t.delete(key);
        }
    }

    keys(type) {
        const t = this.types.get(type);
        return t ? [...t.keys()] : [];
    }
}

// ---------- plain <-> sdk ----------

// Studio Pro stores an empty by-id reference as the zero GUID; the SDK expects null.
const NULL_GUID = "00000000-0000-0000-0000-000000000000";

const PRIM_TO_SDK = {
    Point: v => {
        const [x, y] = String(v).split(";").map(Number);
        return { x, y };
    },
    Size: v => {
        const [width, height] = String(v).split(";").map(Number);
        return { width, height };
    },
    Blob: v => (Buffer.isBuffer(v) ? v.toString("base64") : v)
};
const PRIM_TO_PLAIN = {
    Point: v => (v && typeof v === "object" ? `${v.x};${v.y}` : v),
    Size: v => (v && typeof v === "object" ? `${v.width};${v.height}` : v),
    // Studio Pro stores an empty blob as zero-length binary, never as null
    Blob: v => (typeof v === "string" ? Buffer.from(v, "base64") : v == null ? Buffer.alloc(0) : v)
};

function valueToSdk(p, v, schema, opts) {
    switch (p.kind) {
        case "part":
            return v && typeof v === "object" ? toSdk(v, schema, opts) : null;
        case "partList":
            return (v || []).map(x => toSdk(x, schema, opts)).filter(Boolean);
        case "prim":
            return PRIM_TO_SDK[p.prim] ? PRIM_TO_SDK[p.prim](v) : v;
        case "primList":
            return PRIM_TO_SDK[p.prim] ? (v || []).map(PRIM_TO_SDK[p.prim]) : v;
        case "byId":
            return v === NULL_GUID ? null : v;
        default:
            return v;
    }
}

function valueToPlain(p, v, schema) {
    switch (p.kind) {
        case "part":
            return v ? fromSdk(v, schema) : null;
        case "partList":
            return (v || []).map(x => fromSdk(x, schema));
        case "prim":
            return PRIM_TO_PLAIN[p.prim] ? PRIM_TO_PLAIN[p.prim](v) : v;
        case "primList":
            return PRIM_TO_PLAIN[p.prim] ? (v || []).map(PRIM_TO_PLAIN[p.prim]) : v;
        case "byName":
        case "localByName":
            return v === null || v === undefined ? "" : v;
        case "byId":
            return v === null || v === undefined ? NULL_GUID : v;
        default:
            return v;
    }
}

// opts.publicOnly: only include public properties (unit interfaces); opts.unknown: Set collecting unmapped storage types.
function toSdk(obj, schema, opts = {}) {
    const sdkType = schema.sdkType(obj.$Type);
    const info = schema.info(sdkType);
    if (!info) {
        if (opts.unknown) opts.unknown.add(obj.$Type);
        return null;
    }
    const out = { $ID: obj.$ID, $Type: sdkType };
    for (const [key, v] of Object.entries(obj)) {
        if (key === "$ID" || key === "$Type") continue;
        const p = info.byKey.get(key);
        if (!p || p.kind === "struct" || p.kind === "structList") continue;
        if (opts.publicOnly && !p.isPublic) continue;
        out[p.name] = valueToSdk(p, v, schema, opts);
    }
    return out;
}

function fromSdk(json, schema) {
    const storageType = schema.storageType(json.$Type);
    const info = schema.info(json.$Type);
    if (!info) throw new Error("Unknown SDK type " + json.$Type);
    const out = { $ID: json.$ID, $Type: storageType };
    for (const [name, v] of Object.entries(json)) {
        if (name === "$ID" || name === "$Type") continue;
        const p = info.byName.get(name);
        if (!p || p.kind === "struct" || p.kind === "structList") continue;
        out[p.key] = valueToPlain(p, v, schema);
    }
    return out;
}

// Make a new (SDK-created) plain tree look like what Studio Pro writes: exactly the keys this project uses
// for each type, missing ones filled with the most common value. GUID fields that are not references get fresh GUIDs.
function complete(obj, catalog, schema, warn) {
    if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return obj;
    if (Array.isArray(obj)) return obj.forEach(x => complete(x, catalog, schema, warn));
    if (!obj.$Type) return;
    const keys = catalog.keys(obj.$Type);
    const info = schema.info(schema.sdkType(obj.$Type));
    const fromReference = catalog.reference && catalog.reference.has(obj.$Type);
    if (!catalog.types.has(obj.$Type)) warn(`${obj.$Type} never occurs in this project; written with SDK defaults only`);
    else {
        if (fromReference) warn(`${obj.$Type} first use in this project (layout from reference projects): check it in Studio Pro`);
        for (const key of Object.keys(obj)) {
            // reference types: the sample may predate this version, so keys the SDK maps for it are kept when they hold
            // a value; empty ones are dropped like keys Studio Pro does not write
            const v = obj[key];
            const empty = v === null || v === undefined || v === "" || v === NULL_GUID || (Array.isArray(v) && !v.length);
            const sdkKnown = fromReference && info && info.byKey.has(key) && !empty;
            if (key[0] !== "$" && !keys.includes(key) && !sdkKnown) {
                warn(`${obj.$Type}.${key} is not stored by this Mendix version; dropped`);
                delete obj[key];
            }
        }
        for (const key of keys) {
            if (key[0] === "$" || key in obj) continue;
            const d = catalog.get(obj.$Type, key);
            const p = info && info.byKey.get(key);
            if (d.k === 0x05 && p && p.prim === "Blob") obj[key] = Buffer.alloc(0);
            else if (d.k === 0x05 && !(p && p.kind === "byId")) obj[key] = randomUUID();
            else {
                const s = catalog.sample(obj.$Type, key);
                if (s === undefined && d.k === 0x03) warn(`${obj.$Type}.${key} has no default; written as empty`);
                obj[key] = s === undefined ? (d.k === 0x04 ? [] : null) : s;
            }
        }
    }
    for (const key of Object.keys(obj)) {
        const d = catalog.get(obj.$Type, key);
        const p = info && info.byKey.get(key);
        if (d && d.k === 0x05 && obj[key] === "" && !(p && p.kind === "byId")) obj[key] = randomUUID();
        if (key[0] !== "$") complete(obj[key], catalog, schema, warn);
    }
}

// List markers Studio Pro writes per Type.Key (learned from real projects), for types this project never used.
const LIST_MARKERS = require("./list-markers.json");

// Descriptor for keys that the original BSON did not contain.
function hinter(catalog, schema, warn) {
    return (type, key, value) => {
        const d = catalog.get(type, key);
        if (d) return d;
        const info = schema.info(schema.sdkType(type));
        const p = info && info.byKey.get(key);
        if (p && (p.kind === "byId" || p.prim === "Guid" || p.prim === "Blob")) return { k: 0x05, s: 0 };
        if (p && p.prim === "Double") return { k: 0x01 };
        if (Array.isArray(value)) {
            const parts = p && p.kind === "partList";
            const known = LIST_MARKERS[`${type}.${key}`];
            if (parts && known === undefined) warn(`${type}.${key}: list kind unknown in this project, using marker 2`);
            return { k: 0x04, m: known !== undefined ? known : parts ? 2 : 1, e: parts ? { k: 0x03 } : { k: 0x02 } };
        }
        return {};
    };
}

module.exports = { META, Catalog, toPlain, fromPlain, toSdk, fromSdk, valueToPlain, complete, hinter, guidToBytes, guidToString, lowerCmp };
