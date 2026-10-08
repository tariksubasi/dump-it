"use strict";
// Shared helpers for ops: validation with "did you mean" suggestions, small value parsers.

const ATTRIBUTE_TYPES = "String(200) | String(unlimited) | Integer | Long | Decimal | Boolean | DateTime | AutoNumber | HashedString | Binary | Enum(Module.Enumeration)";
const DATA_TYPES = "String | Integer | Long | Decimal | Boolean | DateTime | Module.Entity | List(Module.Entity) | Enum(Module.Enumeration)";

function distance(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
}

function suggest(word, options, n = 5) {
    const w = String(word).toLowerCase();
    const last = w.split(".").pop();
    return options
        .map(o => {
            const l = o.toLowerCase();
            const score = l === w ? 0 : l.split(".").pop() === last ? 1 : l.includes(last) || last.includes(l.split(".").pop()) ? 2 : 3 + distance(l, w) / Math.max(l.length, w.length);
            return { o, score };
        })
        .filter(x => x.score < 3.5)
        .sort((a, b) => a.score - b.score)
        .slice(0, n)
        .map(x => x.o);
}

function fail(msg, word, options) {
    const s = word !== undefined && options ? suggest(word, options) : [];
    throw new Error(msg + (s.length ? `. Did you mean: ${s.join(", ")}?` : ""));
}

function validate(kind, name, spec, obj, where) {
    const known = Object.keys(spec.fields);
    for (const k of Object.keys(obj)) {
        if (k === kind) continue;
        if (!known.includes(k)) fail(`${where}: unknown field '${k}' for ${name}`, k, known);
    }
    for (const [k, d] of Object.entries(spec.fields)) {
        if (d.startsWith("R ") && (obj[k] === undefined || obj[k] === "")) throw new Error(`${where}: ${name} needs '${k}' (${d.slice(2)})`);
    }
}

const bool = (v, dflt) => (v === undefined || v === null ? dflt : v === true || v === "true" || v === "yes");
const noDollar = v => String(v).replace(/^\$/, "");

function enumValue(enumCls, value, field) {
    const names = Object.keys(enumCls).filter(k => enumCls[k] && enumCls[k] instanceof enumCls);
    const hit = names.find(n => n.toLowerCase() === String(value).toLowerCase());
    if (!hit) fail(`'${value}' is not a valid ${field} (use ${names.join(" | ")})`, value, names);
    return enumCls[hit];
}

// Set a property only when this Mendix version has it (the SDK throws "not yet available" / "no longer ...").
function setIfAvailable(obj, prop, value) {
    try {
        obj[prop] = value;
        return true;
    } catch (e) {
        if (/not yet available|no longer|can no longer/.test(e.message)) return false;
        throw e;
    }
}

module.exports = { setIfAvailable, ATTRIBUTE_TYPES, DATA_TYPES, distance, suggest, fail, validate, bool, noDollar, enumValue };
