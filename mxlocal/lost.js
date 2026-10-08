"use strict";
// Finds values a script set that did not reach the saved model. The SDK accepts properties that this Mendix version
// does not store; they are dropped on save without an error. Compare what the SDK holds with what was encoded.
const bson = require("./bson");
const { toPlain, toSdk } = require("./convert");

// $ID -> { type, props: { name: normalized value } } for every element in an SDK JSON tree.
function flatten(json, out = new Map()) {
    if (!json || typeof json !== "object") return out;
    if (Array.isArray(json)) {
        json.forEach(x => flatten(x, out));
        return out;
    }
    if (!json.$ID) return out;
    const props = {};
    for (const [k, v] of Object.entries(json)) {
        if (k[0] === "$") continue;
        if (v && typeof v === "object" && !Array.isArray(v) && v.$ID) {
            props[k] = "#" + v.$ID;
            flatten(v, out);
        } else if (Array.isArray(v) && v.some(x => x && typeof x === "object" && x.$ID)) {
            props[k] = v.map(x => (x && x.$ID ? "#" + x.$ID : x));
            flatten(v, out);
        } else props[k] = v;
    }
    out.set(json.$ID, { type: json.$Type, props });
    return out;
}

// null, "" and a missing value are the same thing in storage (empty by-name reference, empty blob).
const norm = v => (v === null || v === undefined || v === "" ? null : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

function defaultsOf(schema, type, cache) {
    if (cache.has(type)) return cache.get(type);
    let props = null;
    try {
        const cls = schema.cls(type);
        const el = cls && cls.create && cls.create(schema.probe);
        if (el) props = flatten(el.toJSON()).get(el.id).props;
    } catch (e) {
        props = null; // units and abstract types cannot be created detached
    }
    cache.set(type, props);
    return props;
}

// enc: Project.encode() result. Returns ["<Module.Doc>: <Type>.<prop> = <value> was not stored", ...].
function lostProperties(client, model, enc) {
    const out = [];
    const cache = new Map();
    for (const f of enc.files) {
        const unit = model._units[f.id];
        if (!unit || !unit.isLoaded) continue;
        const want = flatten(unit.toJSON());
        const got = flatten(toSdk(toPlain(bson.decode(f.bytes)), client.schema) || {});
        let before = new Map();
        try {
            before = flatten(toSdk(toPlain(bson.decode(client.project.readBytes(f.id))), client.schema) || {});
        } catch (e) {
            before = new Map(); // new unit
        }
        for (const [id, w] of want) {
            const g = got.get(id);
            const b = before.get(id);
            if (!g) {
                out.push(`${client.label(f.id)}: new ${w.type} element was not stored (type unknown to this Mendix version)`);
                continue;
            }
            const defaults = defaultsOf(client.schema, w.type, cache);
            for (const [k, v] of Object.entries(w.props)) {
                if (same(g.props[k], v)) continue;
                if (b && k in b.props && same(b.props[k], v)) continue; // untouched by the script
                if (!(k in g.props)) {
                    // this Mendix version does not store k: fine while the script left it at the SDK default
                    if (defaults && same(defaults[k], v)) continue;
                    if (v === null || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
                }
                out.push(`${client.label(f.id)}: ${w.type.split("$")[1]}.${k} = ${JSON.stringify(v).slice(0, 80)} was not stored`);
            }
        }
    }
    return out;
}

module.exports = { lostProperties };
