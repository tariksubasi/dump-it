"use strict";
// Native mobile styling (React Native, Atlas native): theme variables in theme/native/custom-variables.js, style
// classes in themesource/<module>/native/main.js, native design properties (themesource/<module>/native/
// design-properties.json) and design tokens mapped onto the Atlas native variables (with dark mode). The files are ES
// modules: they are read and changed with native-js.js (a tokenizer and exact-span editor, nothing of the project is
// run), checked with `node --check`, and go through the dry run (diff), approval code, backup and restore as the
// other theme files (files.js). Also: which document is native (class / design / style on its widgets) and the
// NATIVE STYLE CHECK of the dry run (syntax, unknown style keys, unknown classes, nested scrolling, taps inside taps).
//
// Mendix facts used (Atlas 3/4 native, Mendix 9-11): themesource/atlas_core/native/variables.js merges every group of
// custom-variables.js over its own (brand = merge(brand, custom.brand || {})), so the custom file may hold partial
// groups; dark mode is the darkMode export of custom-variables.js (Appearance.getColorScheme() === "dark"); a native
// widget's class names are the export names of the native main.js files (all modules, theme/native/main.js last);
// a style class is { <element>: { <React Native style> } } with the elements of the widget type (ActionButton:
// container, icon, caption, ...). Native widgets keep Class and DesignProperties in Forms$Appearance like web ones.
const fs = require("fs");
const path = require("path");
const files = require("./files");
const design = require("./design");
const nj = require("./native-js");
const { fail, suggest } = require("./ops-util");
const CATALOG = require("./native-catalog.json");

const VARS_FILE = "theme/native/custom-variables.js";
const FROM_MODULE = "../../../theme/native/custom-variables"; // themesource/<module>/native/main.js -> custom variables
const CORE_FROM_MODULE = "../../atlas_core/native/variables";

const NATIVE_OPS = {
    setNativeVariables: {
        doc: "Set native mobile theme variables (brand colours, fonts, spacing, border radius, ...) in theme/native/custom-variables.js: a variable already there gets the new value, an Atlas variable not there yet is added (Atlas merges the groups). Values are checked (colours, numbers without units); { \"light\": ..., \"dark\": ... } follows the phone's dark mode. Shown as a diff in the dry run; backed up and undone like model changes.",
        fields: {
            variables: "R { \"brand.primary\": \"#0B5FFF\", \"spacing.regular\": 16, \"font.family\": \"Inter\", \"border.radiusLarge\": 12, \"background.primary\": { \"light\": \"#FFFFFF\", \"dark\": \"#0A1325\" }, \"button.container.borderRadius\": \"$border.radiusLarge\" } (group.key; nested objects work too; \"$group.key\" = another variable)",
            file: "optional the variables file (default theme/native/custom-variables.js)",
            new: "optional true: also add groups or keys Atlas does not know (your own, for your native styles)"
        }
    },
    addNativeStyle: {
        doc: "Add a native style class (a React Native style object) to themesource/<module>/native/main.js (made when missing), for native widgets' \"class\". Keys per element of the widget (container, caption, icon, text, input, label, ...), React Native style properties in camelCase, numbers without px; \"$spacing.regular\" uses a theme variable. Web CSS is refused with how to write it in React Native.",
        fields: {
            name: "R class name = the export name, a JavaScript name like cardRaised (no dashes)",
            style: "R { \"container\": { \"backgroundColor\": \"$background.primary\", \"borderRadius\": 8, \"padding\": \"$spacing.regular\", \"elevation\": 2 }, \"caption\": { \"color\": \"#FFFFFF\", \"fontWeight\": \"600\" } } (an element may take \"use\": \"$elevation.level2\" to include a style object of the variables)",
            widgetType: "optional widget type the class is for, to check its elements: ActionButton, Container, Text, TextBox, ListView, Image, ... or a native pluggable widget id (default: any element name)",
            module: "optional module whose themesource folder gets it (default: the app's own module that has a themesource folder, not a Marketplace one)",
            replace: "optional true: replace a class of this name the module already has"
        }
    },
    addNativeDesignProperty: {
        doc: "Define a native design property (Studio Pro's Design properties panel on native pages) in themesource/<module>/native/design-properties.json; each option's class is a native style class (with \"style\" it is added to that folder's main.js). Native widgets then take it in \"design\". Diff in the dry run, backup and undo.",
        fields: {
            widgetType: "R widget type: Widget (all), DivContainer, ActionButton, DynamicText, ListView, TextBox, Page, ... or a native pluggable widget id",
            name: "R the property name, e.g. \"Card style\"",
            type: "R Toggle | Dropdown | ToggleButtonGroup",
            options: "Dropdown / ToggleButtonGroup: [ { \"name\": \"Raised\", \"class\": \"cardRaised\", \"style\": { \"container\": { \"elevation\": 3 } } } ] (style optional: the class's React Native style)",
            class: "Toggle: the native class it adds", style: "optional Toggle: the class's style { \"container\": { ... } }",
            multiSelect: "optional ToggleButtonGroup: true = several options at once",
            description: "optional help text in Studio Pro", category: "optional group in the panel",
            module: "optional module whose themesource folder gets it (default: the app's own module that has a themesource folder)"
        }
    },
    setNativeTokens: {
        doc: "Map design tokens (the same JSON as for the web theme: colors with scales, spacing, radius, typography, elevation, dark) onto the Atlas native variables in theme/native/custom-variables.js, with dark mode. Unmapped tokens are listed. Diff in the dry run, backup and undo.",
        fields: {
            tokens: "R { \"colors\": { \"primary\": { \"50\": \"#EEF4FF\", \"500\": \"#0B5FFF\" }, \"success\": \"#1E8E3E\", \"background\": \"#FFFFFF\", \"surface\": \"#F6F7F9\", \"text\": \"#111827\", \"textMuted\": \"#4B5563\", \"border\": \"#D1D5DB\" }, \"spacing\": { \"xs\": 4, \"sm\": 8, \"md\": 16, \"lg\": 24, \"xl\": 32 }, \"radius\": { \"sm\": 4, \"md\": 8, \"full\": 9999 }, \"typography\": { \"fontFamily\": \"Inter\", \"fontSize\": { \"sm\": 12, \"md\": 14, \"lg\": 16, \"h1\": 32 }, \"lineHeight\": 1.5 }, \"elevation\": { \"1\": \"0 1px 2px rgba(0,0,0,0.15)\" }, \"dark\": { \"background\": \"#0A1325\", \"surface\": \"#161F30\", \"text\": \"#F9FAFB\", \"border\": \"#3B4251\" } }",
            file: "optional the variables file (default theme/native/custom-variables.js)"
        }
    }
};

// ------------------------------------------------------------------------------------------------ value rules

// React Native style properties (View, Text, Image) and the extra keys Atlas native widgets read (rippleColor, size, ...)
const RN_STYLE = new Set([
    ..."alignContent alignItems alignSelf aspectRatio borderBottomWidth borderEndWidth borderLeftWidth borderRightWidth borderStartWidth borderTopWidth borderWidth bottom columnGap direction display end flex flexBasis flexDirection flexGrow flexShrink flexWrap gap height justifyContent left margin marginBottom marginEnd marginHorizontal marginLeft marginRight marginStart marginTop marginVertical maxHeight maxWidth minHeight minWidth overflow padding paddingBottom paddingEnd paddingHorizontal paddingLeft paddingRight paddingStart paddingTop paddingVertical position right rowGap start top width zIndex".split(" "),
    ..."backfaceVisibility backgroundColor borderBottomColor borderBottomEndRadius borderBottomLeftRadius borderBottomRightRadius borderBottomStartRadius borderColor borderCurve borderEndColor borderLeftColor borderRadius borderRightColor borderStartColor borderStyle borderTopColor borderTopEndRadius borderTopLeftRadius borderTopRightRadius borderTopStartRadius elevation opacity pointerEvents shadowColor shadowOffset shadowOpacity shadowRadius transform transformOrigin".split(" "),
    ..."color fontFamily fontSize fontStyle fontVariant fontWeight includeFontPadding letterSpacing lineHeight textAlign textAlignVertical textDecorationColor textDecorationLine textDecorationStyle textShadowColor textShadowOffset textShadowRadius textTransform userSelect verticalAlign writingDirection".split(" "),
    ..."resizeMode tintColor overlayColor objectFit".split(" "),
    ...CATALOG.keys
]);
const DIM = /^(width|height|(min|max)(Width|Height)|margin\w*|padding\w*|top|left|right|bottom|start|end|flexBasis|gap|rowGap|columnGap)$/;
const NUM = /^(border\w*Width|border\w*Radius|elevation|opacity|flex|flexGrow|flexShrink|zIndex|fontSize|lineHeight|letterSpacing|shadowOpacity|shadowRadius|textShadowRadius|size|pressOpacity|numberOfLines|barsOffset)$/;
const COLORKEY = /(^color$|Color$|ColorOn$|ColorOff$|^fill$)/;
const ENUMS = {
    flexDirection: ["row", "column", "row-reverse", "column-reverse"],
    justifyContent: ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"],
    alignItems: ["flex-start", "flex-end", "center", "stretch", "baseline"],
    alignSelf: ["auto", "flex-start", "flex-end", "center", "stretch", "baseline"],
    alignContent: ["flex-start", "flex-end", "center", "stretch", "space-between", "space-around", "space-evenly"],
    flexWrap: ["wrap", "nowrap", "wrap-reverse"],
    position: ["absolute", "relative", "static"],
    overflow: ["visible", "hidden", "scroll"],
    display: ["flex", "none"],
    fontStyle: ["normal", "italic"],
    fontWeight: ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"],
    textAlign: ["auto", "left", "right", "center", "justify"],
    textAlignVertical: ["auto", "top", "bottom", "center"],
    textTransform: ["none", "uppercase", "lowercase", "capitalize"],
    textDecorationLine: ["none", "underline", "line-through", "underline line-through"],
    textDecorationStyle: ["solid", "double", "dotted", "dashed"],
    resizeMode: ["cover", "contain", "stretch", "repeat", "center"],
    borderStyle: ["solid", "dotted", "dashed"],
    autoCapitalize: ["none", "sentences", "words", "characters"],
    backfaceVisibility: ["visible", "hidden"],
    pointerEvents: ["auto", "none", "box-none", "box-only"]
};
const SHADOW = "use elevation (Android) plus shadowColor, shadowOffset { \"width\": 0, \"height\": 2 }, shadowOpacity and shadowRadius (iOS), e.g. { \"elevation\": 3, \"shadowColor\": \"#000000\", \"shadowOffset\": { \"width\": 0, \"height\": 2 }, \"shadowOpacity\": 0.15, \"shadowRadius\": 4 }";
// web CSS that React Native does not have, with what to write instead
const CSS_ONLY = {
    boxShadow: SHADOW, cursor: "a phone has no mouse cursor; leave it out", transition: "React Native styles do not animate; use the Animation widget", animation: "use the Animation widget",
    float: "use flexDirection: \"row\" on the parent", clear: "use flexDirection / flexWrap on the parent", boxSizing: "React Native always measures like border-box; leave it out",
    outline: "use borderWidth + borderColor", textOverflow: "use the text widget's number of lines", whiteSpace: "texts wrap by default; leave it out", visibility: "use the widget's visibility (\"visible\") or display: \"none\"",
    background: "use backgroundColor (a gradient: the Background gradient widget)", backgroundImage: "use the Background image widget", font: "use fontFamily, fontSize, fontWeight separately",
    border: "use borderWidth, borderColor and borderStyle separately", inset: "use top, right, bottom, left", overflowX: "use overflow", overflowY: "use overflow", textDecoration: "use textDecorationLine",
    filter: "React Native has no CSS filters", backdropFilter: "React Native has no backdrop filter", content: "React Native has no generated content", listStyle: "React Native has no list styles",
    gridTemplateColumns: "React Native has no CSS grid; use flexDirection: \"row\" + flexWrap: \"wrap\" and widths in %", gridTemplateRows: "React Native has no CSS grid; use flexbox", gridArea: "React Native has no CSS grid; use flexbox", gridColumn: "React Native has no CSS grid; use flexbox", gridRow: "React Native has no CSS grid; use flexbox",
    maxLines: "use the text widget's number of lines", wordBreak: "texts wrap by word; leave it out", zoom: "use transform: [ { \"scale\": 1.2 } ]"
};
const COLOR_NAMES = new Set("transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "));
const isColor = s => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || /^(rgb|rgba|hsl|hsla|hwb)\(\s*[-\d.%\s,/deg]+\)$/i.test(s) || COLOR_NAMES.has(s.toLowerCase());
const camel = k => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const JS_NAME = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set("break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static enum await implements package protected interface private public".split(" "));
const REF = /^\$([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*)*)$/;

// "16px" etc. on a number: the hint
function unitHint(s) {
    const m = /^(-?\d*\.?\d+)\s*(px|dp|pt)$/i.exec(s);
    if (m) return `React Native sizes are numbers without a unit: ${Number(m[1])}, not "${s}"`;
    const r = /^(-?\d*\.?\d+)\s*(rem|em)$/i.exec(s);
    if (r) return `React Native has no ${r[2]}; give a number (1${r[2]} is about 16): ${Math.round(Number(r[1]) * 16)}`;
    if (/^calc\(|^var\(/i.test(s)) return `React Native has no ${s.slice(0, 4)}; give a number or "$group.key" (a theme variable)`;
    if (/\s/.test(s.trim()) && /\d/.test(s)) return "React Native takes one number per property (no CSS shorthand): margin 8px 16px is marginVertical: 8, marginHorizontal: 16";
    return "";
}

// ------------------------------------------------------------------------------------------------ the ops

function makeNativeTheme({ client }) {
    const dir = client.project.dir;
    const model = () => client.model;
    const text = rel => {
        const b = files.current(client, rel);
        if (b && !files.isText(b)) throw new Error(`${rel} is not a text file`);
        return b === null ? null : b.toString("utf8").replace(/^\uFEFF/, "");
    };
    const exists = rel => files.current(client, rel) !== null || fs.existsSync(path.join(dir, ...rel.split("/")));
    // the parsed module or a refusal that says how to repair the file
    const parsed = (rel, body, where) => {
        try {
            return nj.parse(body);
        } catch (e) {
            throw new Error(`${where}: ${rel} cannot be read safely (${e.message}); fix it in Studio Pro or an editor first`);
        }
    };
    // stage a changed JS file only when it still parses as an ES module
    const stageJs = (rel, body, where) => {
        parsed(rel, body, where);
        const err = nj.syntaxCheck(body);
        if (err) throw new Error(`${where}: ${rel} would not be valid JavaScript after this change (${err}); nothing written`);
        files.stage(client, rel, body);
    };

    // The Atlas variables: "group.key" -> default expression (the project's Atlas core variables.js, else the catalog)
    let knownCache = null;
    function known() {
        if (knownCache) return knownCache;
        const out = new Map();
        const core = path.join(dir, "themesource", "atlas_core", "native", "variables.js");
        let merged = CATALOG.merged;
        if (fs.existsSync(core)) {
            try {
                const src = fs.readFileSync(core, "utf8");
                const m = nj.parse(src);
                const leaf = (obj, pre) => {
                    for (const p of obj.props) p.obj ? leaf(p.obj, `${pre}.${p.key}`) : out.set(`${pre}.${p.key}`, src.slice(p.valS, p.valE));
                };
                for (const [n, x] of [...m.decls, ...m.exports]) if (x.obj) leaf(x.obj, n);
                merged = [...src.matchAll(/^(\w+) = merge\(/gm)].map(x => x[1]);
            } catch (e) {
                /* an unreadable core file: the catalog */
            }
        }
        if (!out.size) for (const [k, v] of Object.entries(CATALOG.vars)) out.set(k, v);
        knownCache = { vars: out, groups: new Set([...out.keys()].map(k => k.split(".")[0])), merged: new Set(merged), core: fs.existsSync(core) };
        return knownCache;
    }
    // colour | number | weight | string | any for a variable path
    function kindOf(p, dflt) {
        const last = p.split(".").pop();
        const d = String(dflt || "").trim();
        if (/weight/i.test(last)) return "weight";
        if (/family/i.test(last)) return "string";
        if (/^"(#|rgb|hsl)/i.test(d) || COLORKEY.test(last) || /^(brand|background|backgroundDefaults|contrast)\./.test(p) || /^colorTitle|^colorParagraph|^colorDisabled/.test(last)) return "color";
        if (/^-?\d*\.?\d+$/.test(d) || /^adjustFont\(/.test(d) || NUM.test(last) || DIM.test(last) || /^spacing\.|radius/i.test(p)) return "number";
        if (/^"/.test(d)) return "string";
        return "any";
    }

    // JSON value -> JS expression text. env: { ref(root, full), dark() }
    function jsOf(v, kind, where, env) {
        if (typeof v === "string" && v.startsWith("$")) v = { ref: v.slice(1) };
        if (v && typeof v === "object" && !Array.isArray(v)) {
            const keys = Object.keys(v);
            if (keys.length === 1 && keys[0] === "ref") {
                const s = String(v.ref).replace(/^\$/, "");
                const m = REF.exec("$" + s);
                if (!m) throw new Error(`${where}: "$${s}" is not a variable reference like "$spacing.regular"`);
                env.ref(m[1], s, where);
                return s;
            }
            if (keys.length && keys.every(k => k === "light" || k === "dark")) {
                if (!("light" in v) || !("dark" in v)) throw new Error(`${where}: give both "light" and "dark"`);
                env.dark();
                return `darkMode ? ${jsOf(v.dark, kind, `${where} dark`, env)} : ${jsOf(v.light, kind, `${where} light`, env)}`;
            }
            throw new Error(`${where}: a value is a text, a number, true/false, "$group.key" or { "light": ..., "dark": ... }; for several keys write "group.key" names`);
        }
        if (v === null || v === undefined) throw new Error(`${where}: needs a value (removing a variable is not supported: set the Atlas default again)`);
        if (Array.isArray(v)) throw new Error(`${where}: a list is not a theme variable value`);
        if (typeof v === "boolean") return String(v);
        if (typeof v === "number") {
            if (!Number.isFinite(v)) throw new Error(`${where}: ${v} is not a number`);
            if (kind === "color") throw new Error(`${where}: is a colour: ${v} is not one (#rrggbb, rgb(...), a colour name or "$brand.primary")`);
            if (kind === "weight") return JSON.stringify(String(v));
            return String(v);
        }
        const s = String(v);
        if (kind === "color" && !isColor(s.trim())) throw new Error(`${where}: is a colour: '${s}' is not one (#rrggbb, #rrggbbaa, rgb(...), rgba(...), hsl(...), a colour name, "$brand.primary" or { "light": ..., "dark": ... })`);
        if (kind === "number") {
            if (/^-?\d*\.?\d+$/.test(s.trim())) throw new Error(`${where}: give the number without quotes: ${Number(s)}`);
            const h = unitHint(s.trim());
            throw new Error(`${where}: is a number: '${s}' is not one${h ? `; ${h}` : ""}`);
        }
        if (kind === "weight" && !ENUMS.fontWeight.includes(s)) fail(`${where}: '${s}' is not a React Native font weight (normal, bold, "100" ... "900")`, s, ENUMS.fontWeight);
        return JSON.stringify(s);
    }

    // ------------------------------------------------ custom-variables.js

    function varsFile(o, where) {
        const rel = files.projectPath(dir, o.file !== undefined ? o.file : VARS_FILE, ["theme"], where);
        if (!/^theme\/native\/[^/]+\.js$/.test(rel)) throw new Error(`${where}: '${rel}' is not a native theme variables file (theme/native/custom-variables.js)`);
        if (/exclusion-variables\.js$|\/main\.js$/.test(rel)) throw new Error(`${where}: ${rel} is not the variables file; native variables go in ${VARS_FILE}`);
        let body = text(rel);
        if (body === null) {
            if (!fs.existsSync(path.join(dir, "theme", "native")) && !exists("theme/native/main.js")) throw new Error(`${where}: this app has no native theme (no theme/native folder): it has no native mobile pages to style. Add a native navigation profile in Studio Pro (App > Navigation), which brings the Atlas native theme, then run this again`);
            if (o.file !== undefined) throw new Error(`${where}: ${rel} does not exist; native variables go in ${VARS_FILE}`);
            body = "";
            client.warn(`${where}: ${rel} did not exist; it is created (Atlas reads theme/native/custom-variables.js)`);
        }
        return { rel, body };
    }

    // darkMode export (and the Appearance import) when missing
    function withDarkMode(body) {
        const m = nj.parse(body);
        if (m.exports.has("darkMode")) return body;
        let b = nj.addImport(body, "Appearance", "react-native");
        const m2 = nj.parse(b);
        const last = m2.imports[m2.imports.length - 1];
        const line = 'export const darkMode = Appearance.getColorScheme() === "dark";\n';
        const at = b.indexOf("\n", last.e);
        b = at < 0 ? `${b}\n${line}` : b.slice(0, at + 1) + line + b.slice(at + 1);
        return b;
    }

    // Set the "group.key..." -> JSON value pairs in body; returns { body, done: [lines] }
    function setVars(body, pairs, opts, where) {
        const k = known();
        const done = [];
        let needDark = false;
        for (const [p, v, w0] of pairs) {
            const w = w0 || `${where} ${p}`;
            const keys = p.split(".");
            if (!keys.every(x => JS_NAME.test(x)) || RESERVED.has(keys[0])) throw new Error(`${w}: '${p}' is not a variable name like brand.primary (JavaScript names joined with dots)`);
            if (keys[0] === "darkMode") throw new Error(`${w}: darkMode follows the phone setting; give colours as { "light": ..., "dark": ... } instead`);
            const m = nj.parse(body);
            const own = m.exports.get(keys[0]);
            // known: an Atlas variable, or one the file already has
            const fileHas = (() => {
                if (!own) return false;
                let obj = own.obj;
                for (const x of keys.slice(1)) {
                    const q = obj && obj.props.find(y => y.key === x);
                    if (!q) return false;
                    obj = q.obj;
                }
                return true;
            })();
            const dflt = k.vars.get(p);
            if (!fileHas && dflt === undefined && opts.new !== true) {
                if (!k.groups.has(keys[0]) && !own) fail(`${w}: Atlas native has no variable group '${keys[0]}' (give "new": true for a group of your own)`, keys[0], [...k.groups]);
                const deeper = [...k.vars.keys()].filter(x => x.startsWith(p + "."));
                if (deeper.length) throw new Error(`${w}: ${p} is a group of ${deeper.length} variables (${deeper.slice(0, 4).join(", ")}${deeper.length > 4 ? ", ..." : ""}); set them one by one`);
                fail(`${w}: Atlas native has no variable ${p} (give "new": true for a variable of your own)`, p, [...k.vars.keys()].filter(x => x.startsWith(keys[0] + ".")).concat([...k.vars.keys()].filter(x => x.split(".").pop() === keys[keys.length - 1])));
            }
            const kind = kindOf(p, dflt);
            const env = {
                ref: (root, full, ww) => {
                    const mm = nj.parse(body);
                    const x = mm.exports.get(root);
                    if (!x && !mm.imports.some(i => i.names.includes(root))) throw new Error(`${ww}: "$${full}": ${root} is not defined in ${opts.rel}${k.groups.has(root) ? ` (Atlas has it, but this file does not export it; set "${full}" here first)` : ""}`);
                    if (x && own && x.s >= own.s && root !== keys[0]) throw new Error(`${ww}: "$${full}": ${root} is defined after ${keys[0]} in ${opts.rel}; a variable can only use one defined above it`);
                    if (root === keys[0]) throw new Error(`${ww}: "$${full}" refers to its own group ${root}; use the value itself`);
                },
                dark: () => (needDark = true)
            };
            let js = jsOf(v, kind, w, env);
            if (needDark && !m.exports.has("darkMode")) {
                body = withDarkMode(body);
                done.push("darkMode (added: follows the phone's dark mode)");
            }
            const cur = nj.parse(body);
            // keep Atlas' font scaling: adjustFont(14) -> adjustFont(16)
            if (typeof v === "number" && cur.imports.some(i => i.names.includes("adjustFont"))) {
                const old = nj.getPath(body, keys) || "";
                if (/^adjustFont\(/.test(old.trim())) js = `adjustFont(${v})`;
            }
            // light / dark over "darkMode ? defaults.xDark : defaults.xLight" (the Atlas template): set those two instead
            const was = nj.getPath(body, keys);
            const tern = was && /^darkMode\s*\?\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(was.trim());
            if (v && typeof v === "object" && "light" in v && "dark" in v && tern && nj.getPath(body, [tern[1], tern[2]]) !== null && nj.getPath(body, [tern[3], tern[4]]) !== null) {
                const dk = jsOf(v.dark, kind, `${w} dark`, env), lt = jsOf(v.light, kind, `${w} light`, env);
                const d0 = nj.getPath(body, [tern[1], tern[2]]).trim(), l0 = nj.getPath(body, [tern[3], tern[4]]).trim();
                body = nj.setPath(body, [tern[1], tern[2]], dk).text;
                body = nj.setPath(body, [tern[3], tern[4]], lt).text;
                done.push(`${p} (dark / light): ${tern[1]}.${tern[2]}: ${d0 === dk ? "already " : `${d0} -> `}${dk}, ${tern[3]}.${tern[4]}: ${l0 === lt ? "already " : `${l0} -> `}${lt}`);
                continue;
            }
            let r;
            try {
                r = nj.setPath(body, keys, js);
            } catch (e) {
                throw new Error(`${w}: ${e.message}`);
            }
            body = r.text;
            done.push(r.old === null ? `${p}: ${js} (added${dflt !== undefined ? `; Atlas default ${String(dflt).replace(/\s+/g, " ").slice(0, 40)}` : ""})` : r.old.trim() === js ? `${p} already ${js}` : `${p}: ${r.old.replace(/\s+/g, " ").slice(0, 50)} -> ${js}`);
            if (k.core && !k.merged.has(keys[0]) && k.groups.has(keys[0]) && !new RegExp(`\\b${keys[0]}\\.`).test(body.replace(new RegExp(`export const ${keys[0]}\\b[\\s\\S]*?\\n\\};?`), ""))) client.warn(`${w}: Atlas core does not merge '${keys[0]}' from custom-variables.js and nothing in ${opts.rel} uses it, so this value changes nothing; set the colours where they are used (e.g. background.primary, font.colorTitle) instead`);
        }
        return { body, done };
    }

    // { "brand.primary": x, spacing: { regular: 16 } } -> [ [ "brand.primary", x ], [ "spacing.regular", 16 ] ]
    function flatten(vars, pre = "") {
        const out = [];
        for (const [k, v] of Object.entries(vars)) {
            const p = pre ? `${pre}.${k}` : k;
            const special = v && typeof v === "object" && !Array.isArray(v) && (Object.keys(v).every(x => x === "light" || x === "dark") || (Object.keys(v).length === 1 && "ref" in v));
            if (v && typeof v === "object" && !Array.isArray(v) && !special && Object.keys(v).length) out.push(...flatten(v, p));
            else out.push([p, v]);
        }
        return out;
    }

    async function setNativeVariables(o) {
        const where = "setNativeVariables";
        const vars = o.variables;
        if (!vars || typeof vars !== "object" || Array.isArray(vars) || !Object.keys(vars).length) throw new Error(`${where}: variables is { "brand.primary": "#0B5FFF", "spacing.regular": 16, ... }`);
        const { rel, body } = varsFile(o, where);
        parsed(rel, body, where);
        const pairs = flatten(vars);
        const r = setVars(body, pairs, { new: o.new, rel }, where);
        stageJs(rel, r.body, where);
        return `${rel}: ${r.done.join(", ")}`;
    }

    // ------------------------------------------------ tokens

    const SPACING = { xxxs: "smallest", xxs: "smallest", xs: "smaller", sm: "small", s: "small", small: "small", md: "regular", m: "regular", medium: "regular", base: "regular", regular: "regular", lg: "large", l: "large", large: "large", xl: "larger", xxl: "largest", xxxl: "largest" };
    const FONTSIZE = { xxs: "sizeSmallest", xs: "sizeSmallest", sm: "sizeSmall", s: "sizeSmall", small: "sizeSmall", md: "size", m: "size", base: "size", body: "size", regular: "size", lg: "sizeLarge", l: "sizeLarge", large: "sizeLarge", xl: "sizeLargest", xxl: "sizeLargest", h1: "sizeH1", h2: "sizeH2", h3: "sizeH3", h4: "sizeH4", h5: "sizeH5", h6: "sizeH6" };
    const WEIGHT = { light: "weightLight", normal: "weightNormal", regular: "weightNormal", medium: "weightSemiBold", semibold: "weightSemiBold", semiBold: "weightSemiBold", bold: "weightBold" };
    const BRAND = ["primary", "success", "warning", "danger", "info"];
    const ALIASES = { error: "danger", secondary: null, accent: null };
    // the base and the light tint of a colour token: "#0B5FFF" or a scale { 50..900 / base / DEFAULT / main / light }
    function scaleOf(v, where) {
        if (typeof v === "string" || (v && typeof v === "object" && ("light" in v || "dark" in v) && Object.keys(v).every(k => k === "light" || k === "dark"))) return { base: v };
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: a colour token is "#rrggbb" or a scale { "50": ..., "500": ... }`);
        const base = v.DEFAULT || v.base || v.main || v.default || v["500"] || v["600"] || v["400"];
        if (base === undefined) throw new Error(`${where}: the scale has no base colour (give "500", "DEFAULT" or "base")`);
        const light = v.light || v.subtle || v["50"] || v["100"];
        return { base, light };
    }
    const px = (v, where) => {
        if (typeof v === "number") return v;
        const s = String(v).trim();
        let m = /^(-?\d*\.?\d+)(px)?$/.exec(s);
        if (m) return Number(m[1]);
        m = /^(-?\d*\.?\d+)(rem|em)$/.exec(s);
        if (m) return Math.round(Number(m[1]) * 16);
        throw new Error(`${where}: '${s}' is not a size (16, "16px" or "1rem")`);
    };
    // "0 2px 4px rgba(0,0,0,0.2)" -> React Native shadow + elevation (an approximation: Android only knows elevation)
    function shadowOf(v, where) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            for (const k of Object.keys(v)) if (!["elevation", "shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius"].includes(k)) fail(`${where}: '${k}' is not a shadow key`, k, ["elevation", "shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius"]);
            return v;
        }
        const s = String(v).split(/,(?![^(]*\))/)[0].trim();
        const m = /^(?:inset\s+)?(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s*(?:([\d.]+)(?:px)?)?\s*(?:(-?[\d.]+)(?:px)?)?\s*(.*)$/.exec(s);
        if (!m) throw new Error(`${where}: '${v}' is not a shadow ("0 2px 4px rgba(0,0,0,0.2)" or { "elevation": 3, ... })`);
        const blur = Number(m[3] || 0);
        let color = m[5].trim() || "rgba(0,0,0,0.2)", opacity = 0.2;
        const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(color);
        if (rgba) {
            opacity = Number(rgba[4]);
            color = "#" + [rgba[1], rgba[2], rgba[3]].map(x => Number(x).toString(16).padStart(2, "0")).join("");
        } else if (/^#[0-9a-f]{8}$/i.test(color)) {
            opacity = Math.round((parseInt(color.slice(7), 16) / 255) * 100) / 100;
            color = color.slice(0, 7);
        } else if (!isColor(color)) throw new Error(`${where}: shadow colour '${color}' is not a colour`);
        return { elevation: Math.max(1, Math.round(blur / 2 + Math.abs(Number(m[2])) / 2)), shadowColor: color, shadowOffset: { width: Number(m[1]), height: Number(m[2]) }, shadowOpacity: opacity, shadowRadius: Math.round((blur / 2) * 10) / 10 };
    }
    const objText = (o, ind) => `{\n${Object.entries(o).map(([k, v]) => `${ind}    ${k}: ${v && typeof v === "object" ? objText(v, ind + "    ") : JSON.stringify(v)}`).join(",\n")}\n${ind}}`;

    async function setNativeTokens(o) {
        const where = "setNativeTokens";
        const t = o.tokens;
        if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error(`${where}: tokens is { "colors": {...}, "spacing": {...}, "radius": {...}, "typography": {...}, "elevation": {...}, "dark": {...} }`);
        const GROUPS = ["colors", "color", "spacing", "space", "radius", "radii", "borderRadius", "typography", "font", "elevation", "shadows", "shadow", "dark", "zIndex", "breakpoints", "motion", "opacity", "$schema", "name", "version", "description"];
        for (const k of Object.keys(t)) if (!GROUPS.includes(k)) fail(`${where}: unknown token group '${k}'`, k, GROUPS.slice(0, 13));
        const { rel, body } = varsFile(o, where);
        parsed(rel, body, where);
        const pairs = [], skipped = [];
        const colors = t.colors || t.color || {};
        const dark = t.dark && typeof t.dark === "object" ? t.dark.colors || t.dark : {};
        const pair = (light, dk) => (dk !== undefined ? { light, dark: dk } : light);
        for (const [k, v] of Object.entries(colors)) {
            const w = `${where} colors.${k}`;
            const name = k in ALIASES ? ALIASES[k] : k;
            if (BRAND.includes(name)) {
                const s = scaleOf(v, w);
                pairs.push([`brand.${name}`, s.base, w]);
                if (s.light !== undefined) pairs.push([`brand.${name}Light`, s.light, w]);
                continue;
            }
            const target = { background: "background.primary", surface: "background.secondary", text: "font.colorTitle", textMuted: "font.colorParagraph", textSecondary: "font.colorParagraph", muted: "font.colorParagraph", textDisabled: "font.colorDisabled", disabled: "font.colorDisabled", border: "border.color" }[k];
            if (target) {
                const s = scaleOf(v, w);
                const dk = dark[k] !== undefined ? scaleOf(dark[k], `${where} dark.${k}`).base : undefined;
                pairs.push([target, pair(s.base, dk), w]);
            } else skipped.push(`colors.${k}`);
        }
        for (const k of Object.keys(dark)) if (!colors[k] && !["background", "surface", "text", "textMuted", "textSecondary", "muted", "textDisabled", "disabled", "border"].includes(k)) skipped.push(`dark.${k}`);
            else if (!colors[k]) throw new Error(`${where} dark.${k}: give its light value too (colors.${k}); dark mode switches between the two`);
        for (const [k, v] of Object.entries(t.spacing || t.space || {})) {
            const target = SPACING[k] || (["smallest", "smaller", "small", "regular", "large", "larger", "largest"].includes(k) ? k : null);
            if (target) pairs.push([`spacing.${target}`, px(v, `${where} spacing.${k}`), `${where} spacing.${k}`]);
            else skipped.push(`spacing.${k}`);
        }
        const radius = t.radius || t.radii || t.borderRadius || {};
        for (const [k, v] of Object.entries(radius)) {
            const target = /^(xs|sm|s|small)$/.test(k) ? "radiusSmall" : /^(md|m|medium|base|DEFAULT)$/.test(k) || (/^(lg|l|large)$/.test(k) && !Object.keys(radius).some(x => /^(md|m|medium|base|DEFAULT)$/.test(x))) ? "radiusLarge" : /^(full|pill|round|max)$/.test(k) ? "radiusLargest" : null;
            if (target) pairs.push([`border.${target}`, px(v, `${where} radius.${k}`), `${where} radius.${k}`]);
            else skipped.push(`radius.${k}`);
        }
        const ty = t.typography || t.font || {};
        for (const [k, v] of Object.entries(ty)) {
            const w = `${where} typography.${k}`;
            if (/^(fontFamily|family|fontFamilyBase|body)$/.test(k) && typeof v === "string") {
                const fam = v.split(",")[0].trim().replace(/^["']|["']$/g, "");
                pairs.push(["font.family", fam, w]);
                if (!/^(System|normal|sans-serif|serif|monospace)$/.test(fam)) client.warn(`${w}: the native app shows "${fam}" only when the font file is part of the app (custom fonts in the native template); otherwise the phone's font is used`);
            } else if (/^(fontSize|fontSizes|size|sizes)$/.test(k) && v && typeof v === "object") {
                const ratio = typeof ty.lineHeight === "number" && ty.lineHeight < 4 ? ty.lineHeight : null;
                for (const [s, n] of Object.entries(v)) {
                    const target = FONTSIZE[s];
                    if (!target) {
                        skipped.push(`typography.${k}.${s}`);
                        continue;
                    }
                    const size = px(n, `${w}.${s}`);
                    pairs.push([`font.${target}`, size, `${w}.${s}`]);
                    if (ratio) pairs.push([`font.${target.replace(/^size/, "lineHeight")}`, Math.round(size * ratio), `${where} typography.lineHeight`]);
                }
            } else if (/^(fontWeight|fontWeights|weight|weights)$/.test(k) && v && typeof v === "object") {
                for (const [s, n] of Object.entries(v)) WEIGHT[s] ? pairs.push([`font.${WEIGHT[s]}`, String(n), `${w}.${s}`]) : skipped.push(`typography.${k}.${s}`);
            } else if (k === "lineHeight" && typeof v === "number") {
                if (!(ty.fontSize || ty.fontSizes || ty.size || ty.sizes)) skipped.push("typography.lineHeight (give fontSize too: native line heights are sizes)");
            } else skipped.push(`typography.${k}`);
        }
        let r = setVars(body, pairs, { rel }, where);
        // elevation levels: a group of React Native shadow objects for the native styles ("use": "$elevation.level2")
        const el = t.elevation || t.shadows || t.shadow;
        if (el && typeof el === "object") {
            for (const [k, v] of Object.entries(el)) {
                const w = `${where} elevation.${k}`;
                const name = /^\d+$/.test(k) ? `level${k}` : k;
                if (!JS_NAME.test(name)) throw new Error(`${w}: '${k}' is not a level name (1, 2, 3 or a JavaScript name)`);
                const sh = shadowOf(v, w);
                for (const [sk, sv] of Object.entries(sh)) {
                    if (sk === "shadowOffset") checkStyleValue("shadowOffset", sv, `${w} shadowOffset`);
                    else checkStyleValue(sk, sv, `${w} ${sk}`);
                }
                let res;
                try {
                    res = nj.setPath(r.body, ["elevation", name], objText(sh, "    "));
                } catch (e) {
                    throw new Error(`${w}: ${e.message}`);
                }
                r.body = res.text;
                r.done.push(`elevation.${name}: elevation ${sh.elevation}, shadowRadius ${sh.shadowRadius}${res.old === null ? " (added)" : ""}`);
            }
        }
        if (!r.done.length) throw new Error(`${where}: no token maps onto the Atlas native variables (${skipped.slice(0, 6).join(", ")}); use colors.primary/success/warning/danger/info/background/surface/text/border, spacing xs..xl, radius sm/md/full, typography fontFamily/fontSize`);
        stageJs(rel, r.body, where);
        return `${rel}: ${r.done.length} variable(s): ${r.done.slice(0, 12).join(", ")}${r.done.length > 12 ? ", ..." : ""}${skipped.length ? `\n      not used on native: ${skipped.join(", ")}` : ""}`;
    }

    // ------------------------------------------------ style classes (main.js)

    // the widget type key of the catalog for a name: ActionButton, Container (DivContainer), Text (DynamicText), a pluggable id
    function widgetElements(type, where) {
        const w = widgetCatalog();
        const t = String(type);
        const alias = { DivContainer: "Container", DynamicText: "Text", StaticImageViewer: "Image", DynamicImageViewer: "ImageViewer", ScrollContainer: "ScrollContainer", Label: "Text", Title: "PageTitle" };
        const key = w[t] ? t : alias[t] || Object.keys(w).find(k => k.toLowerCase() === t.toLowerCase()) || Object.keys(w).find(k => k === t.replace(/\./g, "_")) || Object.keys(w).find(k => k.toLowerCase().endsWith("_" + t.toLowerCase()));
        if (!key) fail(`${where}: widgetType '${t}' is not a native widget type`, t, Object.keys(w).map(k => k.replace(/^com_mendix_widget_native_\w+_/, "")));
        return { key, elements: w[key] };
    }
    let wcache = null;
    function widgetCatalog() {
        if (wcache) return wcache;
        const out = { ...CATALOG.widgets };
        const wd = path.join(dir, "themesource", "atlas_core", "native", "core", "widgets");
        if (fs.existsSync(wd)) {
            for (const f of fs.readdirSync(wd).filter(f => f.endsWith(".js"))) {
                try {
                    const m = nj.parse(fs.readFileSync(path.join(wd, f), "utf8"));
                    for (const [n, x] of m.exports) if (x.obj && /^[A-Z]|^com_/.test(n)) out[n] = [...new Set([...(out[n] || []), ...x.obj.props.map(p => p.key)])];
                } catch (e) {
                    /* the catalog */
                }
            }
        }
        return (wcache = out);
    }
    const ALL_ELEMENTS = () => [...new Set(Object.values(widgetCatalog()).flat())];

    // a React Native style property and value; throws with the React Native way
    function checkStyleValue(k, v, where) {
        if (/-/.test(k)) {
            const c = camel(k);
            if (CSS_ONLY[c]) throw new Error(`${where}: '${k}' is web CSS; ${CSS_ONLY[c]}`);
            if (RN_STYLE.has(c)) throw new Error(`${where}: '${k}' is web CSS; React Native writes it in camelCase: "${c}"`);
        }
        if (CSS_ONLY[k]) throw new Error(`${where}: '${k}' is web CSS; ${CSS_ONLY[k]}`);
        if (!RN_STYLE.has(k)) fail(`${where}: '${k}' is not a React Native style property`, k, [...RN_STYLE]);
        if (typeof v === "string" && /!important/.test(v)) throw new Error(`${where}: React Native has no !important; leave it out`);
        if (typeof v === "string" && REF.test(v)) return; // a theme variable
        if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "ref" in v) return;
        if (k === "shadowOffset" || k === "textShadowOffset") {
            if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.width !== "number" || typeof v.height !== "number" || Object.keys(v).length !== 2) throw new Error(`${where}: ${k} is { "width": 0, "height": 2 } (numbers)`);
            return;
        }
        if (k === "transform") {
            if (!Array.isArray(v) || !v.every(x => x && typeof x === "object" && Object.keys(x).length === 1)) throw new Error(`${where}: transform is a list like [ { "scale": 1.1 }, { "rotate": "45deg" } ]`);
            return;
        }
        if (k === "fontVariant") {
            if (!Array.isArray(v)) throw new Error(`${where}: fontVariant is a list like [ "tabular-nums" ]`);
            return;
        }
        if (v && typeof v === "object") throw new Error(`${where}: ${k} takes a single value, not ${JSON.stringify(v).slice(0, 40)}`);
        if (typeof v === "boolean") return;
        if (ENUMS[k]) {
            if (k === "fontWeight" && typeof v === "number") throw new Error(`${where}: fontWeight is a text in React Native: "${v}"`);
            if (!ENUMS[k].includes(String(v))) fail(`${where}: '${v}' is not a value of ${k}`, String(v), ENUMS[k]);
            return;
        }
        if (COLORKEY.test(k) || /^(backgroundColor|tintColor|overlayColor)$/.test(k)) {
            if (typeof v !== "string" || !isColor(v.trim())) throw new Error(`${where}: ${k} is a colour: '${v}' is not one (#rrggbb, rgba(...), a colour name or "$brand.primary")`);
            return;
        }
        if (DIM.test(k)) {
            if (typeof v === "number" || (typeof v === "string" && (/^-?\d*\.?\d+%$/.test(v) || v === "auto"))) return;
            const h = unitHint(String(v));
            throw new Error(`${where}: ${k} is a number (or "50%", "auto")${h ? `; ${h}` : `: '${v}'`}`);
        }
        if (NUM.test(k)) {
            if (typeof v === "number") return;
            const h = unitHint(String(v));
            throw new Error(`${where}: ${k} is a number${h ? `; ${h}` : `: '${v}'`}`);
        }
        if (k === "aspectRatio" && !(typeof v === "number" || /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(String(v)))) throw new Error(`${where}: aspectRatio is a number like 1.5 or "16/9"`);
        if (typeof v === "string") {
            const h = unitHint(v);
            if (h && /\dpx|\drem|\dem\b/i.test(v)) throw new Error(`${where}: ${h}`);
        }
    }

    // the module that gets a themesource file; Marketplace modules are refused (an update replaces their files)
    function themeModule(o, where) {
        const mods = model() ? model().allModules() : [];
        if (o.module !== undefined) {
            const m = mods.find(x => x.name === String(o.module)) || fail(`${where}: no module '${o.module}'`, String(o.module), mods.map(x => x.name));
            if (m.fromAppStore) throw new Error(`${where}: ${m.name} is a Marketplace module: an update replaces its themesource files; give your own module (an app module)`);
            return m.name;
        }
        const own = mods.filter(m => !m.fromAppStore && m.name !== "System" && fs.existsSync(path.join(dir, "themesource", m.name.toLowerCase())));
        if (own.length === 1) return own[0].name;
        throw new Error(`${where}: give "module": the module whose themesource folder gets it (${own.length ? `app modules with one: ${own.map(m => m.name).join(", ")}` : "no app module has a themesource folder yet; name one and it is created"})`);
    }

    // export names of every native style file (all modules, theme/native/main.js): name -> [rel]
    function nativeClasses() {
        const out = new Map();
        const add = (rel, src) => {
            try {
                for (const n of nj.parse(src).exports.keys()) out.set(n, [...(out.get(n) || []), rel]);
            } catch (e) {
                /* unreadable: no classes */
            }
        };
        const walk = (abs, rel, depth) => {
            if (depth > 4 || !fs.existsSync(abs)) return;
            for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
                if (e.isDirectory()) walk(path.join(abs, e.name), `${rel}/${e.name}`, depth + 1);
                else if (/\.js$/.test(e.name) && !/variables\.js$|api\.js$/.test(e.name) && !/\/_functions/.test(rel)) {
                    const r = `${rel}/${e.name}`;
                    const b = files.current(client, r);
                    add(r, b ? b.toString("utf8") : "");
                }
            }
        };
        const ts = path.join(dir, "themesource");
        if (fs.existsSync(ts)) for (const m of fs.readdirSync(ts)) walk(path.join(ts, m, "native"), `themesource/${m}/native`, 0);
        for (const [rel, e] of files.staged(client)) if (/^themesource\/[^/]+\/native\/.*\.js$|^theme\/native\/main\.js$/.test(rel) && e.after && !fs.existsSync(path.join(dir, ...rel.split("/")))) add(rel, e.after.toString("utf8"));
        const tm = text("theme/native/main.js");
        if (tm) add("theme/native/main.js", tm);
        return out;
    }

    // The style object text of a class; refs are collected in roots
    function styleText(style, where, widgetType, roots) {
        if (!style || typeof style !== "object" || Array.isArray(style) || !Object.keys(style).length) throw new Error(`${where}: style is { "container": { "backgroundColor": "#FFFFFF", "padding": 16 }, "caption": { ... } }`);
        const elements = widgetType ? widgetElements(widgetType, where) : null;
        const all = ALL_ELEMENTS();
        const lines = [];
        for (const [el, props] of Object.entries(style)) {
            const w = `${where} ${el}`;
            if (RN_STYLE.has(el) || CSS_ONLY[el] || /-/.test(el)) throw new Error(`${where}: '${el}' is a style property; put it under an element: { "container": { "${camel(el)}": ... } } (elements: ${(elements ? elements.elements : ["container", "caption", "icon", "text", "image", "input", "label"]).join(", ")})`);
            if (elements && !elements.elements.includes(el)) fail(`${w}: ${/^[AEIOU]/.test(elements.key) ? "an" : "a"} ${elements.key} has no element '${el}' (elements: ${elements.elements.join(", ")})`, el, elements.elements);
            if (!elements && !all.includes(el)) fail(`${w}: '${el}' is not an element of a native widget`, el, all);
            if (!props || typeof props !== "object" || Array.isArray(props)) throw new Error(`${w}: an element is { "backgroundColor": "#FFFFFF", ... }`);
            const body = [];
            for (const [k, v] of Object.entries(props)) {
                if (k === "use") {
                    for (const u of Array.isArray(v) ? v : [v]) {
                        const m = REF.exec(String(u));
                        if (!m || !m[2]) throw new Error(`${w}: "use" takes "$group.key" of a style object in the variables, e.g. "$elevation.level2"`);
                        roots.add(m[1]);
                        body.push(`...${String(u).slice(1)}`);
                    }
                    continue;
                }
                checkStyleValue(k, v, `${w}.${k}`);
                let js;
                if (typeof v === "string" && REF.test(v)) {
                    roots.add(REF.exec(v)[1]);
                    js = v.slice(1);
                } else if (v && typeof v === "object" && !Array.isArray(v) && "ref" in v) {
                    const m = REF.exec("$" + String(v.ref).replace(/^\$/, ""));
                    if (!m) throw new Error(`${w}.${k}: "${v.ref}" is not a variable like "spacing.regular"`);
                    roots.add(m[1]);
                    js = String(v.ref).replace(/^\$/, "");
                } else js = JSON.stringify(v);
                body.push(`${k}: ${js}`);
            }
            lines.push(`    ${JS_NAME.test(el) ? el : JSON.stringify(el)}: {${body.length ? `\n${body.map(b => `        ${b}`).join(",\n")}\n    ` : ""}}`);
        }
        return `{\n${lines.join(",\n")}\n}`;
    }

    // body with the variable groups imported (custom-variables, else the Atlas core variables that merge them)
    function importRoots(body, roots, where) {
        if (!roots.size) return body;
        const custom = text(VARS_FILE);
        const cm = custom ? parsed(VARS_FILE, custom, where) : null;
        const core = path.join(dir, "themesource", "atlas_core", "native", "variables.js");
        let coreNames = new Set();
        if (fs.existsSync(core)) {
            try {
                const m = nj.parse(fs.readFileSync(core, "utf8"));
                coreNames = new Set(m.exports.keys());
            } catch (e) {
                /* none */
            }
        }
        const own = nj.parse(body);
        for (const r of roots) {
            if (own.exports.has(r) || own.imports.some(i => i.names.includes(r))) continue;
            if (cm && cm.exports.has(r)) body = nj.addImport(body, r, FROM_MODULE);
            else if (coreNames.has(r)) body = nj.addImport(body, r, CORE_FROM_MODULE);
            else fail(`${where}: "$${r}...": no native theme variables file defines '${r}' (${VARS_FILE}${coreNames.size ? ", Atlas core variables.js" : ""}); set it first with setNativeVariables (or setNativeTokens for elevation)`, r, [...new Set([...(cm ? cm.exports.keys() : []), ...coreNames])]);
        }
        return body;
    }

    // add (or replace) export name = style in rel; returns the summary
    function putStyle(rel, name, style, widgetType, replace, where) {
        if (!JS_NAME.test(name) || RESERVED.has(name)) throw new Error(`${where}: '${name}' is not a native class name: a JavaScript name like cardRaised (letters, digits, _; no dashes or spaces)`);
        let body = text(rel);
        const created = body === null;
        if (created) body = `// Native styles of this module: each export is a class name for native widgets ("class": "<name>").\n`;
        const m = parsed(rel, body, where);
        const roots = new Set();
        const obj = styleText(style, where, widgetType, roots);
        const had = m.exports.get(name);
        if (had && replace !== true) throw new Error(`${where}: ${rel} already has the class ${name} (line ${had.line}); give "replace": true to replace it`);
        const others = (nativeClasses().get(name) || []).filter(r => r !== rel);
        if (others.length) client.warn(`${where}: ${others.join(", ")} also define${others.length > 1 ? "" : "s"} ${name}; Mendix merges the native styles of all modules in the theme module order (theme/native/main.js last), so the later one wins per element`);
        body = importRoots(body, roots, where);
        const r = nj.setPath(body, [name], obj);
        body = r.text;
        if (created) body = body.replace(/\n(export const)/, "\n\n$1");
        stageJs(rel, body, where);
        return { created, replaced: !!had, elements: Object.entries(style).map(([e, p]) => `${e}: ${Object.keys(p).length}`) };
    }

    async function addNativeStyle(o) {
        const where = `addNativeStyle ${o.name}`;
        const mod = themeModule(o, where);
        const rel = `themesource/${mod.toLowerCase()}/native/main.js`;
        const r = putStyle(rel, String(o.name), o.style, o.widgetType, o.replace, where);
        return `${rel}${r.created ? " (new file)" : ""}: ${r.replaced ? "replaced" : "export"} ${o.name} { ${r.elements.join(", ")} } (use it with "class": "${o.name}" on a native widget)`;
    }

    // ------------------------------------------------ native design properties

    const DP_TYPES = ["Toggle", "Dropdown", "ToggleButtonGroup"];
    function dpWidgetTypes() {
        const sdk = require("mendixmodelsdk");
        const out = new Set(["Widget", "Page", "Document", "FormBase"]);
        for (const [k, c] of Object.entries(sdk.pages)) if (typeof c === "function" && c.prototype instanceof sdk.pages.Widget) out.add(k);
        for (const k of design.definitions(dir, "native").keys()) out.add(k);
        for (const id of require("./pluggable").installed(dir).keys()) out.add(id);
        return [...out];
    }

    async function addNativeDesignProperty(o) {
        const where = `addNativeDesignProperty ${o.name}`;
        if (String(o.type).toLowerCase() === "colorpicker") throw new Error(`${where}: a ColorPicker sets a colour of its own through CSS; native styles have no CSS: give a Dropdown with one option per colour class`);
        const type = DP_TYPES.find(t => t.toLowerCase() === String(o.type).toLowerCase()) || fail(`${where}: type '${o.type}' is not supported for native (use ${DP_TYPES.join(" | ")})`, String(o.type), DP_TYPES);
        const types = dpWidgetTypes();
        const wt = types.find(t => t === String(o.widgetType)) || types.find(t => t.toLowerCase() === String(o.widgetType).toLowerCase()) || fail(`${where}: widgetType '${o.widgetType}' is not known`, String(o.widgetType), types);
        const name = String(o.name).trim();
        if (!name || /["\\]/.test(name)) throw new Error(`${where}: name is a plain text like "Card style"`);
        const mod = themeModule(o, where);
        const folder = `themesource/${mod.toLowerCase()}/native`;
        const rel = `${folder}/design-properties.json`, main = `${folder}/main.js`;
        const before = text(rel);
        let json;
        try {
            json = before === null || !before.trim() ? {} : JSON.parse(before);
        } catch (e) {
            throw new Error(`${where}: ${rel} is not valid JSON (${e.message}); fix it with editThemeFile first`);
        }
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(`${where}: ${rel} must hold an object { "<widget type>": [ ... ] }`);
        const all = (design.definitions(dir, "native").get(wt) || []).map(d => d.name);
        if (all.some(n => n.toLowerCase() === name.toLowerCase()) || (json[wt] || []).some(p => p && String(p.name).toLowerCase() === name.toLowerCase())) throw new Error(`${where}: ${wt} already has a native design property '${name}'; change it with editThemeFile (${rel} or the module that defines it)`);
        const def = { name, type };
        if (o.description !== undefined) def.description = String(o.description);
        if (o.category !== undefined) def.category = String(o.category);
        const styles = [];
        const cls = (c, w) => {
            if (!JS_NAME.test(String(c || "")) || RESERVED.has(String(c))) throw new Error(`${w}: "class" '${c === undefined ? "" : c}' is not a native class name (a JavaScript name like cardRaised; no dashes)`);
            return String(c);
        };
        if (type === "Toggle") {
            if (o.options !== undefined) throw new Error(`${where}: a Toggle has one "class", not options`);
            def.class = cls(o.class, where);
            if (o.style !== undefined) styles.push([def.class, o.style, where]);
        } else {
            if (o.class !== undefined || o.style !== undefined) throw new Error(`${where}: a ${type} takes "options": [ { "name": ..., "class": ..., "style": ... } ]`);
            if (!Array.isArray(o.options) || !o.options.length) throw new Error(`${where}: a ${type} needs "options": [ { "name": "Raised", "class": "cardRaised" } ]`);
            if (o.multiSelect !== undefined) {
                if (type !== "ToggleButtonGroup") throw new Error(`${where}: multiSelect goes with a ToggleButtonGroup`);
                if (o.multiSelect === true) def.multiSelect = true;
            }
            def.options = o.options.map((x, i) => {
                const w = `${where} option ${i + 1}`;
                if (!x || typeof x !== "object" || !x.name) throw new Error(`${w}: an option is { "name": "Raised", "class": "cardRaised" }`);
                for (const k of Object.keys(x)) if (!["name", "class", "style"].includes(k)) fail(`${w}: unknown field '${k}'${k === "css" ? " (native styles are React Native objects: \"style\": { \"container\": { ... } })" : ""}`, k, ["name", "class", "style"]);
                const c = cls(x.class, w);
                if (x.style !== undefined) styles.push([c, x.style, w]);
                return { name: String(x.name), class: c };
            });
            const dup = def.options.map(x => x.name).find((n, i, a) => a.indexOf(n) !== i);
            if (dup) throw new Error(`${where}: two options are named '${dup}'`);
        }
        const elType = /^(Widget|Page|Document|FormBase)$/.test(wt) || /\./.test(wt) && !widgetCatalog()[wt.replace(/\./g, "_")] ? null : wt;
        const made = [];
        for (const [c, st, w] of styles) {
            let ok = elType;
            try {
                if (ok) widgetElements(ok, w);
            } catch (e) {
                ok = null;
            }
            putStyle(main, c, st, ok, false, w);
            made.push(c);
        }
        const classes = type === "Toggle" ? [def.class] : def.options.map(x => x.class);
        const known = nativeClasses();
        const missing = classes.filter(c => !made.includes(c) && !known.has(c));
        if (missing.length) client.warn(`${where}: no native style class ${missing.join(", ")} yet: add it with addNativeStyle (or "style" on the option), or the option changes nothing`);
        json[wt] = [...(Array.isArray(json[wt]) ? json[wt] : []), def];
        const body = JSON.stringify(json, null, 4) + "\n";
        files.stage(client, rel, body);
        design.overlay(dir, path.join(dir, ...rel.split("/")), body);
        const use = type === "Toggle" ? "true" : def.multiSelect ? `[ "${def.options[0].name}" ]` : `"${def.options[0].name}"`;
        return `${rel}: ${wt} "${name}" (${type}${def.options ? `: ${def.options.map(x => x.name).join(" | ")}` : ""})${made.length ? `; ${made.length} style class(es) in ${main}` : ""}; use it on a native widget: "design": { "${name}": ${use} }`;
    }

    // ------------------------------------------------ postconditions

    const valueAt = (src, keys) => nj.getPath(src, keys);
    const disk = rel => {
        const b = files.onDisk(dir, rel);
        return b ? b.toString("utf8") : null;
    };
    const checks = {
        async setNativeVariables(o) {
            const rel = files.projectPath(dir, o.file !== undefined ? o.file : VARS_FILE, ["theme"], "check");
            const s = disk(rel);
            if (s === null) return [`${rel} is missing`];
            const r = [];
            for (const [p, v] of flatten(o.variables || {})) {
                const got = valueAt(s, p.split("."));
                if (got === null) r.push(`${rel}: ${p} is not set`);
                else if (typeof v === "number" && !new RegExp(`(^|\\()${String(v).replace(".", "\\.")}\\)?$`).test(got.trim())) r.push(`${rel}: ${p} is ${got.trim()}, not ${v}`);
                else if (typeof v === "string" && !v.startsWith("$") && !got.includes(JSON.stringify(v))) r.push(`${rel}: ${p} is ${got.trim().slice(0, 40)}, not ${JSON.stringify(v)}`);
            }
            const err = nj.syntaxCheck(s);
            if (err) r.push(`${rel} does not parse: ${err}`);
            return r;
        },
        async setNativeTokens(o) {
            const rel = files.projectPath(dir, o.file !== undefined ? o.file : VARS_FILE, ["theme"], "check");
            const s = disk(rel);
            if (s === null) return [`${rel} is missing`];
            const r = [];
            const c = (o.tokens && (o.tokens.colors || o.tokens.color)) || {};
            if (c.primary !== undefined) {
                const base = scaleOf(c.primary, "check").base;
                const got = valueAt(s, ["brand", "primary"]);
                if (got === null || (typeof base === "string" && !got.includes(JSON.stringify(base)))) r.push(`${rel}: brand.primary is not ${JSON.stringify(base)}`);
            }
            const err = nj.syntaxCheck(s);
            if (err) r.push(`${rel} does not parse: ${err}`);
            return r;
        },
        async addNativeStyle(o) {
            let mod;
            try {
                mod = o.module !== undefined ? String(o.module) : themeModule(o, "check");
            } catch (e) {
                return [e.message];
            }
            const rel = `themesource/${mod.toLowerCase()}/native/main.js`;
            const s = disk(rel);
            if (s === null) return [`${rel} is missing`];
            const v = valueAt(s, [String(o.name)]);
            const r = v === null ? [`${rel} has no export ${o.name}`] : Object.keys(o.style || {}).filter(e => !new RegExp(`\\b${e}\\s*:`).test(v)).map(e => `${rel}: ${o.name} has no ${e}`);
            const err = nj.syntaxCheck(s);
            if (err) r.push(`${rel} does not parse: ${err}`);
            return r;
        },
        async addNativeDesignProperty(o) {
            let mod;
            try {
                mod = o.module !== undefined ? String(o.module) : themeModule(o, "check");
            } catch (e) {
                return [e.message];
            }
            const rel = `themesource/${mod.toLowerCase()}/native/design-properties.json`;
            const b = disk(rel);
            try {
                const j = JSON.parse(String(b || "").replace(/^\uFEFF/, ""));
                return Object.entries(j).some(([t, l]) => t.toLowerCase() === String(o.widgetType).toLowerCase() && Array.isArray(l) && l.some(p => p && p.name === String(o.name).trim())) ? [] : [`no native design property '${o.name}' for ${o.widgetType} in ${rel}`];
            } catch (e) {
                return [`${rel} is missing or not JSON`];
            }
        }
    };

    return { impl: { setNativeVariables, addNativeStyle, addNativeDesignProperty, setNativeTokens }, checks, internals: { checkStyleValue, nativeClasses, known } };
}

// For the checks after apply: a later op of the plan sets the same variables file again (its values may differ)
const VAR_OPS = ["setNativeVariables", "setNativeTokens"];
function nativeChangedLater(name, o, rest) {
    if (VAR_OPS.includes(name)) return rest.some(x => VAR_OPS.includes(x.op) && (x.file || VARS_FILE) === (o.file || VARS_FILE));
    if (name === "addNativeStyle") return rest.some(x => x.op === "addNativeStyle" && x.name === o.name && x.replace === true);
    return false;
}

// ------------------------------------------------------------------------------------------------ native documents

// Is the page / snippet / layout / building block doc a native one? (a page: its layout's content is native)
const nativeCache = new WeakMap();
function isNativeDoc(client, doc) {
    if (!doc) return false;
    if (nativeCache.has(doc)) return nativeCache.get(doc);
    const sdk = require("mendixmodelsdk");
    const { pages } = sdk;
    let r = false;
    try {
        if (doc instanceof pages.Layout) r = !!(doc.isLoaded && doc.content instanceof pages.NativeLayoutContent);
        else if (doc instanceof pages.Page) {
            const qn = doc.layoutCall ? doc.layoutCall.layoutQualifiedName : null;
            const l = qn && client.model ? client.model.allLayouts().find(x => x.qualifiedName === qn) : null;
            if (l && client.project.units.has(l.id)) {
                const u = client.project.read(l.id);
                r = !!(u.Content && u.Content.$Type === "Forms$NativeLayoutContent");
            } else if (l) r = !!(l.isLoaded && l.content instanceof pages.NativeLayoutContent);
        } else {
            for (const k of ["platform", "type"]) {
                const v = k in doc ? doc[k] : null;
                if (v && v.name === "Native") r = true;
            }
        }
    } catch (e) {
        r = false;
    }
    if (!(doc instanceof pages.Page)) nativeCache.set(doc, r); // a page can still get its layout (createPage)
    return r;
}
// the document (page, snippet, layout, building block) around a widget
function docOf(el) {
    const { pages } = require("mendixmodelsdk");
    for (let c = el; c; c = c.container) if (c instanceof pages.FormBase) return c;
    return null;
}
const isNativeWidget = (client, el, doc) => isNativeDoc(client, doc || docOf(el));
const NATIVE_STYLE_REFUSAL = "inline CSS does nothing on a native widget (React Native has no CSS); make a style class with addNativeStyle and give \"class\"";

// ------------------------------------------------------------------------------------------------ NATIVE STYLE CHECK
// Over what the change created or changed: the native JS files (they parse; unknown style keys of the style classes),
// native pages / snippets (classes that no native style file defines, inline style, nested scrolling, a tap target
// inside a tap target or around a scrolling list). Warnings: nothing is refused here.
function nativeStyleLint(client) {
    const out = [];
    // files
    const jsChanged = [...(client.fileChanges || new Map()).entries()].filter(([rel, e]) => e.after && /^(theme\/native|themesource\/[^/]+\/native)\/.*\.js$/.test(rel));
    for (const [rel, e] of jsChanged) {
        const src = e.after.toString("utf8");
        const err = nj.syntaxCheck(src);
        if (err) {
            out.push(`${rel}: does not parse as JavaScript: ${err}`);
            continue;
        }
        if (!/\/main\.js$/.test(rel)) continue;
        let m;
        try {
            m = nj.parse(src);
        } catch (x) {
            out.push(`${rel}: ${x.message}`);
            continue;
        }
        for (const [name, x] of m.exports) {
            if (!x.obj) continue;
            for (const el of x.obj.props) {
                if (!el.obj) continue;
                for (const p of el.obj.props) if (!RN_STYLE.has(p.key)) out.push(`${rel} ${name}.${el.key}: '${p.key}' is not a React Native style property${suggest(p.key, [...RN_STYLE]).length ? ` (did you mean ${suggest(p.key, [...RN_STYLE]).join(", ")}?)` : ""}`);
            }
        }
    }
    // documents
    const ch = client.changes;
    if (!ch) return out;
    const ids = [...new Set([...ch.updated, ...ch.created.keys()])].filter(id => !ch.deleted.has(id));
    let layouts = null, classes = null;
    const nativeLayouts = () => {
        if (layouts) return layouts;
        layouts = new Set();
        const modOf = id => {
            for (let c = id; c; c = client.project.units.get(c) && client.project.units.get(c).containerId) {
                const u = client.project.read(c);
                if (/^Projects\$Module/.test(u.$Type)) return u.Name;
            }
            return null;
        };
        for (const id of client.project.units.keys()) {
            let u;
            try {
                u = client.project.read(id);
            } catch (e) {
                continue;
            }
            if (u.$Type === "Forms$Layout" && u.Content && u.Content.$Type === "Forms$NativeLayoutContent") layouts.add(`${modOf(id)}.${u.Name}`);
        }
        return layouts;
    };
    for (const id of ids) {
        let u;
        try {
            u = client.project.read(id);
        } catch (e) {
            continue;
        }
        if (!/^Forms\$(Page|Snippet|BuildingBlock)$/.test(u.$Type)) continue;
        const native = u.$Type === "Forms$Page" ? !!(u.FormCall && nativeLayouts().has(u.FormCall.Form)) : u.Platform === "Native" || u.Type === "Native";
        if (!native) continue;
        if (!classes) {
            const t = makeNativeTheme({ client });
            classes = t.internals.nativeClasses();
        }
        const name = client.label(id);
        const walk = (o, scroll, tap) => {
            if (Array.isArray(o)) return o.forEach(x => walk(x, scroll, tap));
            if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
            const t = o.$Type || "";
            const at = `${name} ${o.Name || t.split("$")[1] || ""}`.trim();
            const ap = o.Appearance;
            if (ap && /^Forms\$Appearance$/.test(ap.$Type || "")) {
                for (const c of String(ap.Class || "").split(/\s+/).filter(Boolean)) if (!classes.has(c)) out.push(`${at}: class '${c}' is not a native style class (no native main.js exports it${suggest(c, [...classes.keys()]).length ? `; did you mean ${suggest(c, [...classes.keys()]).join(", ")}?` : ""}); add it with addNativeStyle`);
                if (String(ap.Style || "").trim()) out.push(`${at}: inline style "${String(ap.Style).slice(0, 40)}" does nothing on a native page; use a style class (addNativeStyle + "class")`);
            }
            // offline-first: a native app runs without a connection; microflows run on the server
            if (t === "Forms$MicroflowSource") out.push(`${at}: the data comes from a microflow (server): the page shows nothing without a connection; use a database source (synchronized objects) or a nanoflow source`);
            if (t === "Forms$MicroflowAction") out.push(`${at}: the action calls a microflow (server): it fails without a connection; call a nanoflow, and the microflow from it only when online`);
            const scrolls = /^Forms\$(ListView|ScrollContainer)$/.test(t) || (t === "CustomWidgets$CustomWidget" && /gallery|listviewswipe|carousel/i.test(JSON.stringify(o.Type || "").slice(0, 400)));
            const clickable = (t === "Forms$DivContainer" && o.OnClickAction && o.OnClickAction.$Type && o.OnClickAction.$Type !== "Forms$NoAction") || (t === "Forms$ListView" && o.ClickAction && o.ClickAction.$Type && o.ClickAction.$Type !== "Forms$NoAction");
            if (scrolls && scroll) out.push(`${at}: a scrolling ${t.split("$")[1]} inside ${scroll}: nested scrolling breaks on phones (the inner list does not scroll or renders every item); use one list per page, or paging / a separate page`);
            if (scrolls && tap) out.push(`${at}: a scrolling list inside the clickable ${tap}: taps and scroll gestures conflict (Pressable around a ScrollView); put the action on the list items or a button`);
            if (/^Forms\$(ActionButton|DropDownButton|LinkButton)$/.test(t) && tap) out.push(`${at}: a button inside the clickable ${tap}: one tap triggers both on some phones; remove one of the two actions`);
            if (clickable && tap) out.push(`${at}: a clickable container inside the clickable ${tap}: nested tap targets; keep one`);
            const nextScroll = scrolls ? `${t.split("$")[1]} ${o.Name || ""}`.trim() : scroll;
            const nextTap = t === "Forms$ListView" ? (clickable ? `list view item of ${o.Name || "the list"}` : tap) : clickable ? `container ${o.Name || ""}`.trim() : tap;
            for (const [k, v] of Object.entries(o)) if (v && typeof v === "object" && k !== "Appearance") walk(v, nextScroll, nextTap);
        };
        walk(u.FormCall || u.Widgets || u, null, null);
    }
    return [...new Set(out)];
}

module.exports = { makeNativeTheme, NATIVE_OPS, nativeChangedLater, isNativeDoc, isNativeWidget, docOf, nativeStyleLint, NATIVE_STYLE_REFUSAL, RN_STYLE };
