"use strict";
// Design tokens of a design module (setTokens, createDesignModule): the token JSON (colours with 50..900 scales,
// semantic colours, surface levels 0..3, text on surfaces, borders, radius, a 4px spacing grid, elevation shadows,
// one z-index scale, typography, breakpoints, motion, an optional dark set), its defaults, the SCSS it becomes
// (tokens/_tokens.scss: $<prefix>... variables; tokens/_css-vars.scss: :root custom properties and the dark block),
// the Atlas variables it maps to (theme/web/custom-variables.scss), and WCAG contrast (pairs to check).
const { fail } = require("./ops-util");

// ------------------------------------------------ colour maths

function parseColor(v) {
    const s = String(v).trim().toLowerCase();
    let m = /^#([0-9a-f]{3,4})$/.exec(s);
    if (m) return m[1].split("").slice(0, 3).map(c => parseInt(c + c, 16));
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(s);
    if (m) return [m[1], m[2], m[3]].map(Number);
    if (s === "white") return [255, 255, 255];
    if (s === "black") return [0, 0, 0];
    return null;
}
const hex = rgb => "#" + rgb.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, w) => a.map((x, i) => x * (1 - w) + b[i] * w); // w = share of b
function luminance(rgb) {
    const [r, g, b] = rgb.map(x => {
        const c = x / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// WCAG 2 contrast ratio of two colours (null when one is not a plain colour)
function contrast(a, b) {
    const x = parseColor(a), y = parseColor(b);
    if (!x || !y) return null;
    const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
    return (l1 + 0.05) / (l2 + 0.05);
}

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
// a 50..900 scale around a base colour (500): lighter steps mix in white, darker ones black
function scale(base) {
    const c = parseColor(base);
    const white = [255, 255, 255], black = [10, 12, 20];
    const light = { 50: 0.92, 100: 0.84, 200: 0.68, 300: 0.5, 400: 0.25 }, dark = { 600: 0.14, 700: 0.3, 800: 0.45, 900: 0.6 };
    const out = {};
    for (const s of STEPS) out[s] = s === 500 ? hex(c) : s < 500 ? hex(mix(c, white, light[s])) : hex(mix(c, black, dark[s]));
    return out;
}

// ------------------------------------------------ the token set

const DEFAULT_BRAND = "#2563eb";
// Calm, high-contrast defaults (WCAG AA for text, soft borders, Material-like elevation).
function defaults(brand = DEFAULT_BRAND) {
    return {
        colors: { primary: brand, neutral: "#64748b", success: "#15803d", warning: "#b45309", danger: "#dc2626", info: "#0369a1" },
        // 0 = page background, 1 = card / panel on it, 2 = something nested in a card, 3 = popover / dialog
        surface: { 0: "#f4f6f9", 1: "#ffffff", 2: "#f8fafc", 3: "#ffffff" },
        text: { primary: "#111827", secondary: "#4b5563", disabled: "#9ca3af", onPrimary: "#ffffff", link: null },
        border: { subtle: "#e5e7eb", default: "#d1d5db", strong: "#9ca3af", focus: null },
        radius: { none: "0", sm: "4px", md: "8px", lg: "12px", xl: "16px", pill: "999px" },
        // the 4px grid
        spacing: { 0: "0", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 8: "32px", 10: "40px", 12: "48px", 16: "64px" },
        elevation: {
            1: "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.1)",
            2: "0 2px 4px rgba(16, 24, 40, 0.06), 0 4px 8px rgba(16, 24, 40, 0.1)",
            3: "0 4px 6px rgba(16, 24, 40, 0.05), 0 12px 16px rgba(16, 24, 40, 0.1)",
            4: "0 8px 8px rgba(16, 24, 40, 0.04), 0 20px 24px rgba(16, 24, 40, 0.1)"
        },
        zIndex: { base: 0, raised: 10, dropdown: 1000, sticky: 1020, header: 1030, overlay: 1040, modal: 1050, popover: 1060, toast: 1070, tooltip: 1080 },
        typography: {
            fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            fontFamilyMono: "'JetBrains Mono', Consolas, 'Courier New', monospace",
            baseSize: "14px",
            lineHeight: "1.5",
            scale: { xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "20px", xxl: "24px", display: "32px" },
            weights: { regular: "400", medium: "500", semibold: "600", bold: "700" }
        },
        breakpoints: { xs: "480px", sm: "576px", md: "768px", lg: "992px", xl: "1200px" },
        motion: { fast: "120ms", base: "200ms", slow: "320ms", easing: "cubic-bezier(0.2, 0, 0, 1)" },
        dark: null,
        darkMode: "class"
    };
}
// a dark set when the user asks for dark mode without values
const DARK_DEFAULTS = {
    surface: { 0: "#0f141b", 1: "#171e27", 2: "#1f2833", 3: "#273241" },
    text: { primary: "#e8edf3", secondary: "#a9b4c2", disabled: "#6b7785", onPrimary: "#ffffff" },
    border: { subtle: "#263040", default: "#334155", strong: "#475569" }
};

const SECTIONS = Object.keys(defaults());
const COLOR_KEYS = ["primary", "secondary", "neutral", "success", "warning", "danger", "info"];

const isPlain = o => o && typeof o === "object" && !Array.isArray(o);
function merge(base, add) {
    if (!isPlain(add)) return add;
    const out = isPlain(base) ? { ...base } : {};
    for (const [k, v] of Object.entries(add)) out[k] = isPlain(v) && isPlain(out[k]) ? merge(out[k], v) : v;
    return out;
}

const SIZE = /^(0|-?\d*\.?\d+(px|rem|em|%|vh|vw|ms|s)?)$/;
// The user's tokens over the stored ones (or the defaults): checked, colours expanded to scales.
// Returns { tokens, notes } (notes: warnings, e.g. a spacing step off the 4px grid).
function normalize(input, stored, where) {
    const notes = [];
    if (input !== undefined && !isPlain(input)) throw new Error(`${where}: tokens is an object { "colors": { "primary": "#0b5fff" }, "radius": { "md": "8px" }, ... }`);
    for (const k of Object.keys(input || {})) if (!SECTIONS.includes(k)) fail(`${where}: unknown token group '${k}' (groups: ${SECTIONS.join(", ")})`, k, SECTIONS);
    const t = merge(stored || defaults(), input || {});
    const colorOk = (v, at) => {
        if (!parseColor(v)) throw new Error(`${where}: ${at} '${v}' is not a colour (#rrggbb, #rgb or rgb(r, g, b))`);
        return hex(parseColor(v));
    };
    // colours: a single colour becomes a 50..900 scale; a scale must have the 500 step
    const colors = {};
    for (const [k, v] of Object.entries(t.colors || {})) {
        if (v === null) continue;
        if (!COLOR_KEYS.includes(k) && !/^[a-z][a-z0-9-]*$/i.test(k)) throw new Error(`${where}: colors.${k}: use a name like primary, secondary, accent`);
        if (isPlain(v)) {
            const steps = Object.keys(v).map(Number);
            const bad = steps.find(s => !STEPS.includes(s));
            if (bad !== undefined) throw new Error(`${where}: colors.${k}: step ${bad} is not one of ${STEPS.join(", ")}`);
            if (!v[500]) throw new Error(`${where}: colors.${k} needs at least the 500 step (or give one colour: "${k}": "#0b5fff")`);
            const full = scale(colorOk(v[500], `colors.${k}.500`));
            for (const s of steps) full[s] = colorOk(v[s], `colors.${k}.${s}`);
            colors[k] = full;
        } else colors[k] = scale(colorOk(v, `colors.${k}`));
    }
    if (!colors.primary) throw new Error(`${where}: colors.primary is needed (the brand colour)`);
    t.colors = colors;
    for (const g of ["surface", "text", "border"]) {
        for (const [k, v] of Object.entries(t[g] || {})) if (v !== null) t[g][k] = colorOk(v, `${g}.${k}`);
    }
    for (const lv of ["0", "1", "2", "3"]) if (!t.surface[lv]) throw new Error(`${where}: surface needs the levels 0, 1, 2 and 3 (0 = page background ... 3 = popover)`);
    if (!t.text.link) t.text.link = colors.primary[600];
    if (!t.border.focus) t.border.focus = colors.primary[500];
    for (const g of ["radius", "spacing", "breakpoints"]) {
        for (const [k, v] of Object.entries(t[g] || {})) {
            if (!SIZE.test(String(v).trim())) throw new Error(`${where}: ${g}.${k} '${v}' is not a size (8px, 0.5rem)`);
            t[g][k] = String(v).trim();
        }
    }
    for (const [k, v] of Object.entries(t.spacing)) {
        const px = /^(\d+)px$/.exec(v);
        if (px && Number(px[1]) % 4 !== 0) notes.push(`spacing.${k} ${v} is off the 4px grid`);
    }
    for (const [k, v] of Object.entries(t.zIndex || {})) if (!/^-?\d+$/.test(String(v))) throw new Error(`${where}: zIndex.${k} '${v}' is not a whole number`);
    for (const [k, v] of Object.entries(t.elevation || {})) if (/[;{}]/.test(String(v))) throw new Error(`${where}: elevation.${k} may not hold ; { }`);
    const ty = t.typography || {};
    if (/[;{}]/.test(String(ty.fontFamily || "")) || /[;{}]/.test(String(ty.fontFamilyMono || ""))) throw new Error(`${where}: typography font families may not hold ; { }`);
    for (const [k, v] of Object.entries(ty.scale || {})) if (!SIZE.test(String(v))) throw new Error(`${where}: typography.scale.${k} '${v}' is not a size`);
    if (!["class", "auto"].includes(t.darkMode)) fail(`${where}: darkMode '${t.darkMode}' is class (dark when the page has the dark class) or auto (also follow the device setting)`, String(t.darkMode), ["class", "auto"]);
    if (t.dark === true) t.dark = JSON.parse(JSON.stringify(DARK_DEFAULTS));
    if (t.dark) {
        if (!isPlain(t.dark)) throw new Error(`${where}: dark is { "surface": {...}, "text": {...}, "border": {...} } or true for the default dark set`);
        for (const k of Object.keys(t.dark)) if (!["surface", "text", "border", "colors"].includes(k)) fail(`${where}: dark.${k}: the dark set changes surface, text, border and colors`, k, ["surface", "text", "border", "colors"]);
        t.dark = merge(DARK_DEFAULTS, t.dark);
        for (const g of ["surface", "text", "border"]) for (const [k, v] of Object.entries(t.dark[g] || {})) t.dark[g][k] = colorOk(v, `dark.${g}.${k}`);
        if (!t.dark.text.link) t.dark.text.link = (t.dark.colors && t.dark.colors.primary && t.dark.colors.primary[300]) || colors.primary[300];
        if (t.dark.colors) for (const [k, v] of Object.entries(t.dark.colors)) t.dark.colors[k] = isPlain(v) ? Object.fromEntries(Object.entries(v).map(([s, c]) => [s, colorOk(c, `dark.colors.${k}.${s}`)])) : scale(colorOk(v, `dark.colors.${k}`));
    }
    return { tokens: t, notes };
}

// ------------------------------------------------ SCSS

const key = k => String(k).replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
// flat [name, value] pairs: color-primary-500, surface-1, text-primary, radius-md, space-4, shadow-2, z-modal, ...
function flat(t, dark = false) {
    const out = [];
    const src = dark ? t.dark : t;
    if (!src) return out;
    for (const [c, sc] of Object.entries(src.colors || {})) for (const [s, v] of Object.entries(sc)) out.push([`color-${key(c)}-${s}`, v]);
    for (const [k, v] of Object.entries(src.surface || {})) out.push([`surface-${k}`, v]);
    for (const [k, v] of Object.entries(src.text || {})) if (v) out.push([`text-${key(k)}`, v]);
    for (const [k, v] of Object.entries(src.border || {})) if (v) out.push([`border-${key(k)}`, v]);
    if (dark) return out;
    for (const [k, v] of Object.entries(t.radius)) out.push([`radius-${key(k)}`, v]);
    for (const [k, v] of Object.entries(t.spacing)) out.push([`space-${key(k)}`, v]);
    for (const [k, v] of Object.entries(t.elevation)) out.push([`shadow-${k}`, v]);
    for (const [k, v] of Object.entries(t.zIndex)) out.push([`z-${key(k)}`, String(v)]);
    const ty = t.typography;
    out.push(["font-family", ty.fontFamily], ["font-family-mono", ty.fontFamilyMono], ["font-size-base", ty.baseSize], ["line-height", ty.lineHeight]);
    for (const [k, v] of Object.entries(ty.scale || {})) out.push([`font-size-${key(k)}`, v]);
    for (const [k, v] of Object.entries(ty.weights || {})) out.push([`font-weight-${key(k)}`, String(v)]);
    for (const [k, v] of Object.entries(t.breakpoints)) out.push([`breakpoint-${key(k)}`, v]);
    for (const [k, v] of Object.entries(t.motion)) out.push([k === "easing" ? "easing" : `duration-${key(k)}`, v]);
    return out.filter(([, v]) => v !== undefined && v !== null && v !== "");
}

const HEAD = "// Generated by mxlocal setTokens from tokens.json next to this file; change tokens with setTokens, not here.\n";
// tokens/_tokens.scss: SCSS variables only (no CSS output, so any partial may @import it)
function toScss(t, prefix) {
    const p = prefix.replace(/-$/, "");
    return HEAD + flat(t).map(([k, v]) => `$${p}-${k}: ${v} !default;`).join("\n") + "\n";
}
// tokens/_css-vars.scss: the same values as CSS custom properties (+ the dark set)
function toCssVars(t, prefix) {
    const p = prefix.replace(/-$/, "");
    const block = list => list.map(([k, v]) => `    --${p}-${k}: ${v};`).join("\n");
    let s = HEAD + `:root {\n${block(flat(t))}\n}\n`;
    if (t.dark) {
        const d = flat(t, true);
        s += `\n// dark mode: the class ${p}-dark (or data-theme="dark") on <html>, the page or a container switches it\n.${p}-dark,\n[data-theme="dark"] {\n${block(d)}\n    color-scheme: dark;\n}\n`;
        if (t.darkMode === "auto") s += `\n// darkMode auto: also when the device is set to dark (unless the page says data-theme="light" / ${p}-light)\n@media (prefers-color-scheme: dark) {\n    :root:not([data-theme="light"]):not(.${p}-light) {\n${block(d).replace(/^/gm, "    ")}\n        color-scheme: dark;\n    }\n}\n`;
    }
    return s;
}

// Atlas variables (theme/web/custom-variables.scss) set from the tokens: plain values, so Atlas's colour functions
// (mix, darken) keep working.
function atlasVariables(t) {
    const c = t.colors, sp = t.spacing, ty = t.typography;
    const pick = (...ks) => ks.map(k => sp[k]).find(Boolean);
    const v = {
        "brand-primary": c.primary[500],
        "brand-success": c.success && c.success[500],
        "brand-warning": c.warning && c.warning[500],
        "brand-danger": c.danger && c.danger[500],
        "brand-info": c.info && c.info[500],
        "bg-color": t.surface[0],
        "bg-color-secondary": t.surface[1],
        "font-color-default": t.text.primary,
        "font-color-header": t.text.primary,
        "font-color-detail": t.text.secondary,
        "link-color": t.text.link,
        "border-color-default": t.border.default,
        "border-radius-default": t.radius.md,
        "font-family-base": ty.fontFamily,
        "font-size-default": ty.baseSize,
        "spacing-smaller": pick(1),
        "spacing-small": pick(2),
        "spacing-medium": pick(4),
        "spacing-large": pick(6),
        "spacing-larger": pick(8),
        "spacing-largest": pick(12),
        "screen-xs": t.breakpoints.xs,
        "screen-sm": t.breakpoints.sm,
        "screen-md": t.breakpoints.md,
        "screen-lg": t.breakpoints.lg,
        "screen-xl": t.breakpoints.xl
    };
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x));
}

// ------------------------------------------------ contrast

// text / background pairs of a token set: [{ label, fg, bg, need }] (need 4.5 = AA normal text, 3 = large / UI)
function tokenPairs(t) {
    const out = [];
    const add = (label, fg, bg, need = 4.5) => fg && bg && out.push({ label, fg, bg, need });
    const sets = [["", t]];
    if (t.dark) sets.push(["dark ", { ...t, ...t.dark, colors: { ...t.colors, ...(t.dark.colors || {}) } }]);
    for (const [d, s] of sets) {
        for (const lv of ["0", "1", "2", "3"]) {
            add(`${d}text.primary on surface ${lv}`, s.text.primary, s.surface[lv]);
            add(`${d}text.secondary on surface ${lv}`, s.text.secondary, s.surface[lv]);
        }
        add(`${d}text.link on surface 1`, s.text.link || t.text.link, s.surface[1]);
        add(`${d}text.onPrimary on colors.primary 500 (primary button)`, s.text.onPrimary, s.colors.primary[500]);
        for (const k of ["success", "warning", "danger", "info"]) if (s.colors[k]) add(`${d}text.onPrimary on colors.${k} 500 (${k} button)`, s.text.onPrimary, s.colors[k][500]);
        // nested surfaces must not blend into their background (not a WCAG rule: a visible step)
        for (const [a, b] of [["0", "1"], ["1", "2"]]) out.push({ label: `${d}surface ${b} on surface ${a}`, fg: s.surface[b], bg: s.surface[a], need: 1.03, kind: "surface" });
    }
    return out;
}

// Atlas variable pairs (values from the compiled theme or the variables files)
const ATLAS_PAIRS = [
    ["font-color-default", "bg-color"], ["font-color-default", "bg-color-secondary"], ["font-color-header", "bg-color"], ["font-color-detail", "bg-color-secondary"],
    ["link-color", "bg-color-secondary"], ["btn-primary-color", "btn-primary-bg"], ["btn-success-color", "btn-success-bg"], ["btn-warning-color", "btn-warning-bg"],
    ["btn-danger-color", "btn-danger-bg"], ["btn-info-color", "btn-info-bg"]
];

// [{ label, ratio, need, ok }] of pairs (pairs without two plain colours are left out)
function judge(pairs) {
    return pairs.map(p => {
        const ratio = contrast(p.fg, p.bg);
        return ratio === null ? null : { ...p, ratio, ok: ratio >= p.need };
    }).filter(Boolean);
}
// the darkest / lightest scale step that reaches 4.5 against bg (a hint in the warning)
function better(scaleObj, bg, need = 4.5) {
    for (const s of [600, 700, 800, 900]) if (scaleObj && contrast(scaleObj[s], bg) >= need) return { step: s, color: scaleObj[s] };
    return null;
}

module.exports = { parseColor, hex, contrast, scale, defaults, normalize, toScss, toCssVars, atlasVariables, tokenPairs, ATLAS_PAIRS, judge, better, flat, DEFAULT_BRAND, SECTIONS, STEPS, merge };
