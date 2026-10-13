"use strict";
// Design properties (Atlas and other themes): what themesource/*/web/design-properties.json (and theme/web) offer per
// widget type, and how Studio Pro stores a chosen value (Forms$DesignPropertyValue in a widget's Appearance):
//   Dropdown / ToggleButtonGroup / ColorPicker  -> OptionDesignPropertyValue { Option }
//   Toggle                                      -> ToggleDesignPropertyValue (present = on)
//   Spacing                                     -> CompoundDesignPropertyValue { margin-top / padding-left ...: Option }
// (layouts from the Studio Pro-saved samples of Mendix 10.22-11.14).
const fs = require("fs");
const path = require("path");
const { fail, suggest } = require("./ops-util");

const cache = new Map();
// typeKey -> [ property definitions ] merged over every design-properties.json of the project (web or native)
function definitions(dir, platform = "web") {
    const k = dir + "|" + platform;
    if (cache.has(k)) return cache.get(k);
    const out = new Map();
    const files = [];
    const ts = path.join(dir, "themesource");
    if (fs.existsSync(ts)) for (const m of fs.readdirSync(ts).sort()) files.push(path.join(ts, m, platform, "design-properties.json"));
    files.push(path.join(dir, "theme", platform, "design-properties.json"));
    for (const f of files) {
        if (!fs.existsSync(f)) continue;
        let d;
        try {
            d = JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
        } catch (e) {
            continue; // a broken theme file: Studio Pro ignores it too
        }
        for (const [type, props] of Object.entries(d)) {
            if (!Array.isArray(props)) continue;
            const list = out.get(type) || [];
            for (const p of props) {
                if (!p || !p.name) continue;
                const i = list.findIndex(x => x.name === p.name);
                if (i >= 0) list[i] = p; // a later module refines a property of the same name
                else list.push(p);
            }
            out.set(type, list);
        }
    }
    cache.set(k, out);
    return out;
}

// The type keys that apply to SDK element el: its class and base classes (ActionButton, Button, ..., Widget), or a
// pluggable widget's id + Widget.
function typeKeys(el) {
    const keys = [];
    if (el.type && el.type.widgetId) keys.push(el.type.widgetId);
    for (let p = Object.getPrototypeOf(el); p && p.constructor && p.constructor.name !== "Object"; p = Object.getPrototypeOf(p)) {
        const n = p.constructor.name;
        if (/^(Element|AbstractElement|Structure)$/.test(n)) break;
        keys.push(n);
    }
    if (!keys.includes("Widget")) keys.push("Widget");
    return [...new Set(keys)];
}

// [ { name, type, options: [names], toggle, spacing: { margin: [...], padding: [...] } } ] for el
function available(dir, el, platform) {
    const defs = definitions(dir, platform);
    const out = [];
    for (const k of typeKeys(el)) for (const p of defs.get(k) || []) if (!out.some(x => x.name === p.name)) out.push(p);
    return out;
}

const SIDES = ["top", "right", "bottom", "left"];
// "Spacing top": "Large" (old Atlas names, also in oldNames) -> [ "margin-top", "L" ]
function spacingAlias(def, key, value) {
    const want = `${key}::${value}`.toLowerCase();
    for (const kind of ["margin", "padding"]) {
        for (const o of def[kind] || []) {
            for (const side of SIDES) {
                const names = (o[side] && o[side].oldNames) || [];
                if (names.some(n => n.toLowerCase() === want)) return [`${kind}-${side}`, o.name];
            }
        }
    }
    return null;
}

// Checks a "design" spec against what el can take: [ { key, kind: option|toggle|spacing, option, parts } ] (null value =
// remove). where: for messages. dir: project folder.
function resolve(dir, el, spec, where, platform = "web") {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: design is { "<property>": "<option>" }, e.g. { "Spacing": { "margin-bottom": "M" } }`);
    const defs = available(dir, el, platform);
    if (!definitions(dir, platform).size) throw new Error(`${where}: this project has no design-properties.json (themesource/*/${platform}); use "class"`);
    const names = defs.map(d => d.name);
    const spacing = defs.find(d => d.type === "Spacing");
    const out = [];
    const spaced = [];
    for (const [key, value] of Object.entries(spec)) {
        let def = defs.find(d => d.name === key) || defs.find(d => d.name.toLowerCase() === String(key).toLowerCase());
        if (!def && spacing) {
            const a = spacingAlias(spacing, key, value);
            if (a) {
                spaced.push(a);
                continue;
            }
        }
        const side = /^spacing (top|right|bottom|left)$/i.exec(String(key));
        if (!def && spacing && side) {
            const opts = [...new Set((spacing.margin || []).flatMap(o => ((o[side[1].toLowerCase()] || {}).oldNames || []).filter(n => n.toLowerCase().startsWith(String(key).toLowerCase() + "::")).map(n => n.split("::")[1])))];
            fail(`${where}: design '${key}': no option '${value}' (options: ${opts.join(", ")}; or "Spacing": { "margin-${side[1].toLowerCase()}": "${(spacing.margin || []).map(o => o.name).join(" | ")}" })`, String(value), opts);
        }
        if (!def) fail(`${where}: no design property '${key}' for this widget (${names.join(", ") || "none"})`, key, names);
        if (value === null || value === false) {
            out.push({ key: def.name, kind: "remove" });
            continue;
        }
        if (def.type === "Toggle") {
            if (value !== true && value !== "true") throw new Error(`${where}: design '${def.name}' is a toggle: true or false`);
            out.push({ key: def.name, kind: "toggle" });
        } else if (def.type === "Spacing") {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}: design '${def.name}' is { "margin-top": "M", "padding-left": "S", ... }`);
            for (const [side, opt] of Object.entries(value)) spaced.push([side, opt]);
        } else if (["Dropdown", "ToggleButtonGroup", "ColorPicker"].includes(def.type)) {
            if (def.multiSelect) throw new Error(`${where}: design '${def.name}' takes several options; set it in Studio Pro`);
            const opts = (def.options || []).map(o => o.name);
            const hit = opts.find(o => o === String(value)) || opts.find(o => o.toLowerCase() === String(value).toLowerCase());
            if (!hit) fail(`${where}: design '${def.name}': no option '${value}' (options: ${opts.join(", ")})`, String(value), opts);
            out.push({ key: def.name, kind: "option", option: hit });
        } else throw new Error(`${where}: design '${def.name}' (${def.type}) is not supported here; set it in Studio Pro`);
    }
    if (spaced.length) {
        if (!spacing) throw new Error(`${where}: this widget has no Spacing design property`);
        const parts = [];
        for (const [side, opt] of spaced) {
            const m = /^(margin|padding)-(top|right|bottom|left)$/.exec(String(side));
            const sides = ["margin", "padding"].flatMap(k => SIDES.map(s => `${k}-${s}`));
            if (!m) fail(`${where}: spacing '${side}' is not known (use margin-top ... padding-left)`, String(side), sides);
            const opts = (spacing[m[1]] || []).map(o => o.name);
            if (opt === null || opt === false) {
                parts.push({ side, option: null });
                continue;
            }
            const hit = opts.find(o => o === String(opt)) || opts.find(o => o.toLowerCase() === String(opt).toLowerCase()) || ({ small: "S", medium: "M", large: "L" }[String(opt).toLowerCase()] && opts.find(o => o === { small: "S", medium: "M", large: "L" }[String(opt).toLowerCase()]));
            if (!hit) fail(`${where}: ${side}: no option '${opt}' (options: ${opts.join(", ")})`, String(opt), opts);
            parts.push({ side, option: hit });
        }
        out.push({ key: spacing.name, kind: "spacing", parts });
    }
    return out;
}

// Writes resolved values into el.appearance.designProperties (only what changes). Returns a short text.
function apply(sdk, model, el, values) {
    const { pages } = sdk;
    const list = el.appearance.designProperties;
    const find = k => list.find(x => x.key === k);
    const text = [];
    const option = (dpv, o) => {
        if (dpv.value instanceof pages.OptionDesignPropertyValue && dpv.value.option === o) return;
        pages.OptionDesignPropertyValue.createIn(dpv).option = o;
    };
    for (const v of values) {
        let dpv = find(v.key);
        if (v.kind === "remove") {
            if (dpv) dpv.delete();
            text.push(`${v.key} off`);
            continue;
        }
        if (!dpv) {
            dpv = pages.DesignPropertyValue.create(model);
            list.push(dpv);
            dpv.key = v.key;
        }
        if (v.kind === "toggle") {
            if (!(dpv.value instanceof pages.ToggleDesignPropertyValue)) pages.ToggleDesignPropertyValue.createIn(dpv);
            text.push(v.key);
        } else if (v.kind === "option") {
            option(dpv, v.option);
            text.push(`${v.key}: ${v.option}`);
        } else {
            if (!(dpv.value instanceof pages.CompoundDesignPropertyValue)) pages.CompoundDesignPropertyValue.createIn(dpv);
            const parts = dpv.value.properties;
            for (const p of v.parts) {
                const cur = parts.find(x => x.key === p.side);
                if (p.option === null) {
                    if (cur) cur.delete();
                    continue;
                }
                let x = cur;
                if (!x) {
                    x = pages.DesignPropertyValue.create(model);
                    parts.push(x);
                    x.key = p.side;
                }
                option(x, p.option);
                text.push(`${p.side} ${p.option}`);
            }
            if (!parts.length) dpv.delete();
        }
    }
    return text.join(", ");
}

// One line per design property el can take (for messages and the docs)
function describe(dir, el, platform) {
    return available(dir, el, platform).map(d => `${d.name} (${d.type === "Toggle" ? "true/false" : d.type === "Spacing" ? "margin-/padding-top|right|bottom|left: " + (d.margin || []).map(o => o.name).join("|") : (d.options || []).map(o => o.name).join(" | ")})`);
}

module.exports = { definitions, typeKeys, available, resolve, apply, describe, suggest };
