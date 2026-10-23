"use strict";
// Theme files (SCSS, CSS, design-properties.json) under theme/ and themesource/: plain files, changed through the
// same dry run (with a diff), approval code, backup and restore as the model (files.js).
const fs = require("fs");
const path = require("path");
const files = require("./files");
const design = require("./design");
const { fail, suggest } = require("./ops-util");

const ROOTS = ["theme", "themesource"];
const EXT = /\.(scss|css|json)$/i;
// other text files Studio Pro reads from theme/web (not in sub folders): the login page, the web app manifest
const WEB_TEXT = /^theme\/web\/[^/]+\.(html|webmanifest)$/i;
const LOGIN_IDS = ["loginForm", "usernameInput", "passwordInput", "loginButton"];
const DEFAULT_CSS_FILE = "theme/web/main.scss";

const THEME_OPS = {
    editThemeFile: {
        doc: "Change a theme file (theme/web/*.scss, themesource/<module>/web/*.scss, design-properties.json, theme/web/settings.json, login.html, *.webmanifest): new content, find/replace edits, or text appended. Shown as a diff in the dry run; backed up and undone like model changes.",
        fields: {
            path: "R file under theme/ or themesource/, e.g. theme/web/custom-variables.scss (.scss, .css or .json; in theme/web also login.html, *.html and *.webmanifest)",
            content: "optional the whole new content (also creates a new file)",
            edits: "optional [ { \"find\": \"exact text\", \"replace\": \"new text\", \"all\": true/false } ]: each find must occur exactly once (or all: true)",
            append: "optional text added at the end of the file"
        }
    },
    addCssClass: {
        doc: "Add a CSS class rule to the app theme (default theme/web/main.scss), for widgets' class field.",
        fields: {
            name: "R class name without the dot, e.g. card-highlight",
            css: "R declarations: \"background-color: #fff; padding: 8px\" or { \"background-color\": \"#fff\", \"padding\": \"8px\" }",
            file: "optional theme file (default theme/web/main.scss), e.g. theme/web/custom-variables.scss or themesource/<module>/web/main.scss"
        }
    },
    addDesignProperty: {
        doc: "Define a custom design property (Studio Pro's Design properties panel) in themesource/<module>/web/design-properties.json, with its CSS classes in themesource/<module>/web/main.scss; widgets then take it in \"design\". Shown as a diff in the dry run; backed up and undone like model changes.",
        fields: {
            widgetType: "R widget type the property is for: Widget (all), DivContainer, ActionButton, DynamicText, LayoutGrid, DataView, ListView, ... or a pluggable widget id",
            name: "R the property name, e.g. \"Card style\"",
            type: "R Toggle | Dropdown | ToggleButtonGroup | ColorPicker",
            options: "Dropdown / ToggleButtonGroup / ColorPicker: [ { \"name\": \"Raised\", \"class\": \"card-raised\", \"css\": \"box-shadow: 0 2px 4px #0003\" } ] (css optional: the rule for the class)",
            class: "Toggle: the CSS class it adds", css: "optional Toggle: the CSS rule for its class, \"border: 1px solid #ccc\" or { \"border\": \"1px solid #ccc\" }",
            multiSelect: "optional ToggleButtonGroup: true = several options at once",
            description: "optional help text in Studio Pro", category: "optional group in the panel, e.g. \"Card\"",
            module: "optional module whose themesource folder gets it (default: the app's own module that has a themesource folder, not a Marketplace one)"
        }
    },
    setThemeVariable: {
        doc: "Set SCSS theme variables (brand colours, fonts, spacing, ...) in theme/web/custom-variables.scss: a variable already there gets the new value, an Atlas variable not there yet is added. Values are checked (colour, size, font list); shown as a diff in the dry run, backed up and undone like model changes.",
        fields: {
            variables: "R { \"brand-primary\": \"#264ae5\", \"font-family-base\": \"'Inter', sans-serif\", \"spacing-medium\": \"16px\" } (with or without $)",
            file: "optional the variables file (default theme/web/custom-variables.scss)",
            new: "optional true: also add variables Atlas does not know (your own, for your SCSS)"
        }
    }
};

function makeTheme({ client }) {
    const dir = client.project.dir;
    design.reset(dir); // staged design-properties.json of an earlier run are gone
    const text = rel => {
        const b = files.current(client, rel);
        if (b && !files.isText(b)) throw new Error(`${rel} is not a text file`);
        return b === null ? null : b.toString("utf8");
    };
    const near = (body, find) => {
        const first = String(find).split(/\r?\n/).find(l => l.trim()) || "";
        const word = first.trim().slice(0, 30);
        const lines = body.split(/\r?\n/);
        const i = lines.findIndex(l => word && l.includes(word.split(/\s+/)[0]));
        return i >= 0 ? ` (line ${i + 1}: ${JSON.stringify(lines[i].trim().slice(0, 80))}; find must match exactly, spaces and line breaks too)` : "";
    };
    const checkJson = (rel, body) => {
        if (!/\.(json|webmanifest)$/i.test(rel)) return;
        try {
            JSON.parse(body);
        } catch (e) {
            throw new Error(`${rel} would not be valid JSON after this edit: ${e.message}`);
        }
    };
    // Unbalanced { } would break the theme compile in Studio Pro (comments and strings are skipped).
    const balanced = (rel, body) => {
        if (!/\.(scss|css)$/i.test(rel)) return;
        let depth = 0;
        const s = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
        for (const c of s) {
            if (c === "{") depth++;
            else if (c === "}" && --depth < 0) break;
        }
        if (depth !== 0) throw new Error(`${rel}: the braces { } would not balance after this edit (${depth > 0 ? "a } is missing" : "an extra }"})`);
    };
    const pathOf = (p, where) => {
        const rel = files.projectPath(dir, p, ROOTS, where);
        if (!EXT.test(rel) && !WEB_TEXT.test(rel)) throw new Error(`${where}: only .scss, .css and .json theme files (and theme/web/*.html, *.webmanifest) can change here ('${rel}'); fonts and images: addThemeAsset`);
        return rel;
    };

    async function editThemeFile(o) {
        const where = `editThemeFile ${o.path}`;
        const rel = pathOf(o.path, where);
        const kinds = ["content", "edits", "append"].filter(k => o[k] !== undefined);
        if (!kinds.length) throw new Error(`${where}: give content, edits or append`);
        if (o.content !== undefined && kinds.length > 1) throw new Error(`${where}: content replaces the whole file; do not combine it with edits or append`);
        let body = text(rel);
        const created = body === null;
        if (created && o.content === undefined) {
            const scss = [...new Set(ROOTS.flatMap(r => listScss(dir, r)))].slice(0, 15);
            fail(`${where}: ${rel} does not exist (give content to create it; theme files: ${scss.join(", ") || "none"})`, rel, scss);
        }
        const done = [];
        if (o.content !== undefined) {
            body = String(o.content);
            done.push(created ? "created" : "content replaced");
        }
        if (o.edits !== undefined) {
            if (!Array.isArray(o.edits) || !o.edits.length) throw new Error(`${where}: edits is a list [ { "find": ..., "replace": ... } ]`);
            for (const [i, e] of o.edits.entries()) {
                const w = `${where} edits[${i + 1}]`;
                if (!e || typeof e !== "object" || typeof e.find !== "string" || !e.find || e.replace === undefined) throw new Error(`${w}: needs { "find": "exact text", "replace": "new text" }`);
                for (const k of Object.keys(e)) if (!["find", "replace", "all"].includes(k)) fail(`${w}: unknown field '${k}'`, k, ["find", "replace", "all"]);
                const n = body.split(e.find).length - 1;
                if (!n) throw new Error(`${w}: ${JSON.stringify(e.find.slice(0, 80))} is not in ${rel}${near(body, e.find)}`);
                if (n > 1 && e.all !== true) throw new Error(`${w}: ${JSON.stringify(e.find.slice(0, 80))} occurs ${n} times in ${rel}; make find longer so it is unique, or add "all": true`);
                body = body.split(e.find).join(String(e.replace));
                done.push(`${n} replacement(s)`);
            }
        }
        if (o.append !== undefined) {
            const add = String(o.append);
            body = body + (body && !body.endsWith("\n") ? "\n" : "") + add + (add.endsWith("\n") ? "" : "\n");
            done.push(`${add.split("\n").length} line(s) appended`);
        }
        checkJson(rel, body);
        balanced(rel, body);
        if (/\.html$/i.test(rel)) {
            if (body.includes("\0")) throw new Error(`${where}: ${rel} is not a text file`);
            if (!/<html[\s>]/i.test(body)) client.warn(`${where}: ${rel} has no <html> element`);
            const missing = /(^|\/)login\.html$/i.test(rel) ? LOGIN_IDS.filter(id => !new RegExp(`id=["']${id}["']`).test(body)) : [];
            if (missing.length) client.warn(`${where}: ${rel} lacks ${missing.map(i => `id="${i}"`).join(", ")}: Mendix's sign-in script needs them (start from the existing login.html)`);
        }
        if (/^theme\/web\/settings\.json$/i.test(rel)) {
            const j = JSON.parse(body);
            if (!Array.isArray(j.cssFiles) || !j.cssFiles.includes("theme.compiled.css")) client.warn(`${where}: settings.json "cssFiles" should list "theme.compiled.css", or the app loads without its theme`);
        }
        if (created && /\.scss$/i.test(rel) && !/(^|\/)(main|custom-variables)\.scss$/i.test(rel) && !/^_/.test(rel.split("/").pop())) client.warn(`${where}: Studio Pro compiles main.scss of each theme folder; @import "${rel.split("/").pop().replace(/\.scss$/, "")}" in main.scss next to it, or the new rules are not used`);
        files.stage(client, rel, body);
        if (/design-properties\.json$/i.test(rel)) design.overlay(dir, path.join(dir, ...rel.split("/")), body);
        return `${rel}: ${done.join(", ")}`;
    }

    async function addCssClass(o) {
        const where = `addCssClass ${o.name}`;
        const name = String(o.name).replace(/^\./, "");
        if (!/^-?[A-Za-z_][\w-]*$/.test(name)) throw new Error(`${where}: '${o.name}' is not a valid CSS class name (letters, digits, - and _; no spaces)`);
        const rel = pathOf(o.file !== undefined ? o.file : DEFAULT_CSS_FILE, where);
        if (!/\.(scss|css)$/i.test(rel)) throw new Error(`${where}: ${rel} is not a .scss or .css file`);
        const body = text(rel);
        if (body === null) {
            const scss = ROOTS.flatMap(r => listScss(dir, r)).slice(0, 15);
            throw new Error(`${where}: ${rel} does not exist${o.file === undefined ? " (this project has no theme/web/main.scss)" : ""}; give 'file' (theme files: ${scss.join(", ") || "none; create one with editThemeFile content"})`);
        }
        if (new RegExp(`\\.${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(body.replace(/\/\*[\s\S]*?\*\//g, ""))) throw new Error(`${where}: ${rel} already has a rule for .${name}; change it with editThemeFile edits`);
        let decls;
        if (o.css && typeof o.css === "object" && !Array.isArray(o.css)) decls = Object.entries(o.css).map(([k, v]) => `${k}: ${v}`);
        else decls = String(o.css).split(";").map(x => x.trim()).filter(Boolean);
        if (!decls.length) throw new Error(`${where}: css is empty`);
        for (const d of decls) if (!/^[-\w$]+\s*:\s*\S/.test(d) || /[{}]/.test(d)) throw new Error(`${where}: '${d}' is not a CSS declaration (property: value)`);
        const rule = `.${name} {\n${decls.map(d => `    ${d.replace(/\s*:\s*/, ": ")};`).join("\n")}\n}\n`;
        const out = body + (body && !body.endsWith("\n") ? "\n" : "") + (body ? "\n" : "") + rule;
        balanced(rel, out);
        files.stage(client, rel, out);
        return `${rel}: .${name} { ${decls.length} declaration(s) } (use it with "class": "${name}" on a widget)`;
    }

    const checks = {
        async editThemeFile(o) {
            const rel = files.projectPath(dir, o.path, ROOTS, "check");
            const b = files.onDisk(dir, rel);
            if (b === null) return [`${rel} is missing`];
            const s = b.toString("utf8");
            const r = [];
            // later ops of the same change may edit the file again: then its first line is enough
            const first = String(o.content || "").split("\n").find(l => l.trim()) || "";
            if (o.content !== undefined && s !== String(o.content) && !s.includes(first)) r.push(`${rel} does not have the given content`);
            for (const e of Array.isArray(o.edits) ? o.edits : []) if (e && e.replace && !s.includes(String(e.replace))) r.push(`${rel} lacks ${JSON.stringify(String(e.replace).slice(0, 60))}`);
            if (o.append !== undefined && !s.includes(String(o.append).trim())) r.push(`${rel} lacks the appended text`);
            return r;
        },
        async addCssClass(o) {
            const rel = files.projectPath(dir, o.file !== undefined ? o.file : DEFAULT_CSS_FILE, ROOTS, "check");
            const b = files.onDisk(dir, rel);
            return b && b.toString("utf8").includes(`.${String(o.name).replace(/^\./, "")} {`) ? [] : [`${rel} has no .${o.name} rule`];
        }
    };

    // ------------------------------------------------ custom design properties

    const DP_TYPES = ["Toggle", "Dropdown", "ToggleButtonGroup", "ColorPicker"];
    const CLASS_RE = /^-?[A-Za-z_][\w-]*$/;
    const declsOf = (css, where) => {
        const d = css && typeof css === "object" && !Array.isArray(css) ? Object.entries(css).map(([k, v]) => `${k}: ${v}`) : String(css).split(";").map(x => x.trim()).filter(Boolean);
        for (const x of d) if (!/^[-\w$]+\s*:\s*\S/.test(x) || /[{}]/.test(x)) throw new Error(`${where}: '${x}' is not a CSS declaration (property: value)`);
        return d;
    };
    const ruleOf = (cls, decls) => `.${cls} {\n${decls.map(d => `    ${d.replace(/\s*:\s*/, ": ")};`).join("\n")}\n}\n`;
    // widget type keys design-properties.json uses: the page widget classes (and their bases), FormBase, pluggable ids
    function widgetTypes() {
        const sdk = require("mendixmodelsdk");
        const out = new Set(["Widget", "FormBase"]);
        for (const [k, c] of Object.entries(sdk.pages)) if (typeof c === "function" && c.prototype instanceof sdk.pages.Widget) out.add(k);
        for (const k of design.definitions(dir).keys()) out.add(k);
        for (const id of require("./pluggable").installed(dir).keys()) out.add(id);
        return [...out];
    }
    async function themeModule(o, where) {
        const mods = client.model ? client.model.allModules() : [];
        if (o.module !== undefined) {
            const m = mods.find(x => x.name === String(o.module)) || fail(`${where}: no module '${o.module}'`, String(o.module), mods.map(x => x.name));
            return m.name;
        }
        const own = mods.filter(m => !m.fromAppStore && m.name !== "System" && fs.existsSync(path.join(dir, "themesource", m.name.toLowerCase())));
        if (own.length === 1) return own[0].name;
        throw new Error(`${where}: give "module": the module whose themesource folder gets it (${own.length ? `app modules with one: ${own.map(m => m.name).join(", ")}` : "no app module has a themesource folder yet; name one and it is created"})`);
    }

    async function addDesignProperty(o) {
        const where = `addDesignProperty ${o.name}`;
        const type = DP_TYPES.find(t => t.toLowerCase() === String(o.type).toLowerCase()) || fail(`${where}: type '${o.type}' is not supported (use ${DP_TYPES.join(" | ")}; Spacing: use the Atlas Spacing property)`, String(o.type), DP_TYPES);
        const types = widgetTypes();
        const wt = types.find(t => t === String(o.widgetType)) || types.find(t => t.toLowerCase() === String(o.widgetType).toLowerCase()) || fail(`${where}: widgetType '${o.widgetType}' is not known`, String(o.widgetType), types);
        const name = String(o.name).trim();
        if (!name || /["\\]/.test(name)) throw new Error(`${where}: name is a plain text like "Card style"`);
        const mod = await themeModule(o, where);
        const folder = `themesource/${mod.toLowerCase()}/web`;
        const rel = `${folder}/design-properties.json`, scss = `${folder}/main.scss`;
        const before = text(rel);
        let json;
        try {
            json = before === null || !before.trim() ? {} : JSON.parse(before.replace(/^\uFEFF/, ""));
        } catch (e) {
            throw new Error(`${where}: ${rel} is not valid JSON (${e.message}); fix it with editThemeFile first`);
        }
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(`${where}: ${rel} must hold an object { "<widget type>": [ ... ] }`);
        const all = (design.definitions(dir).get(wt) || []).map(d => d.name);
        if (all.some(n => n.toLowerCase() === name.toLowerCase()) || (json[wt] || []).some(p => p && String(p.name).toLowerCase() === name.toLowerCase())) throw new Error(`${where}: ${wt} already has a design property '${name}'; change it with editThemeFile (${rel} or the module that defines it)`);
        const def = { name, type };
        if (o.description !== undefined) def.description = String(o.description);
        if (o.category !== undefined) def.category = String(o.category);
        const rules = [];
        if (type === "Toggle") {
            if (o.options !== undefined) throw new Error(`${where}: a Toggle has one "class", not options`);
            if (!CLASS_RE.test(String(o.class || ""))) throw new Error(`${where}: a Toggle needs "class": the CSS class it adds (letters, digits, - and _)`);
            def.class = String(o.class);
            if (o.css !== undefined) rules.push(ruleOf(def.class, declsOf(o.css, where)));
        } else {
            if (o.class !== undefined || o.css !== undefined) throw new Error(`${where}: a ${type} takes "options": [ { "name": ..., "class": ..., "css": ... } ]`);
            if (!Array.isArray(o.options) || !o.options.length) throw new Error(`${where}: a ${type} needs "options": [ { "name": "Raised", "class": "card-raised" } ]`);
            if (o.multiSelect !== undefined) {
                if (type !== "ToggleButtonGroup") throw new Error(`${where}: multiSelect goes with a ToggleButtonGroup`);
                if (o.multiSelect === true) def.multiSelect = true;
            }
            def.options = o.options.map((x, i) => {
                const w = `${where} option ${i + 1}`;
                if (!x || typeof x !== "object" || !x.name) throw new Error(`${w}: an option is { "name": "Raised", "class": "card-raised" }`);
                for (const k of Object.keys(x)) if (!["name", "class", "css"].includes(k)) fail(`${w}: unknown field '${k}'`, k, ["name", "class", "css"]);
                if (!CLASS_RE.test(String(x.class || ""))) throw new Error(`${w}: "class" '${x.class === undefined ? "" : x.class}' is not a CSS class name`);
                if (x.css !== undefined) rules.push(ruleOf(String(x.class), declsOf(x.css, w)));
                return { name: String(x.name), class: String(x.class) };
            });
            const dup = def.options.map(x => x.name).find((n, i, a) => a.indexOf(n) !== i);
            if (dup) throw new Error(`${where}: two options are named '${dup}'`);
        }
        json[wt] = [...(Array.isArray(json[wt]) ? json[wt] : []), def];
        const body = JSON.stringify(json, null, 4) + "\n";
        if (before !== null && before.trim() && Object.keys(JSON.parse(before.replace(/^\uFEFF/, ""))).length && JSON.stringify(JSON.parse(before.replace(/^\uFEFF/, "")), null, 4).trim() !== before.replace(/^\uFEFF/, "").trim()) client.warn(`${where}: ${rel} is written with 4-space JSON indentation (it had another layout); the diff shows the whole file`);
        files.stage(client, rel, body);
        design.overlay(dir, path.join(dir, ...rel.split("/")), body);
        let css = "";
        if (rules.length) {
            const cur = text(scss);
            const missing = rules.filter(r => !new RegExp(`\\.${r.slice(1, r.indexOf(" ")).replace(/-/g, "\\-")}(?![\\w-])`).test((cur || "").replace(/\/\*[\s\S]*?\*\//g, "")));
            if (missing.length) {
                const out = (cur || "") + (cur && !cur.endsWith("\n") ? "\n" : "") + (cur ? "\n" : "") + `// design property "${name}" (${wt})\n` + missing.join("");
                balanced(scss, out);
                files.stage(client, scss, out);
                css = `; ${missing.length} CSS rule(s) in ${scss}${cur === null ? " (new file: Studio Pro compiles each module's themesource main.scss)" : ""}`;
            }
        }
        const classes = type === "Toggle" ? [def.class] : def.options.map(x => x.class);
        if (!rules.length) client.warn(`${where}: no "css" given: add the rules for ${classes.map(c => "." + c).join(", ")} (addCssClass), or the option changes nothing`);
        const use = type === "Toggle" ? "true" : def.multiSelect ? `[ "${def.options[0].name}" ]` : `"${def.options[0].name}"`;
        return `${rel}: ${wt} "${name}" (${type}${def.multiSelect ? ", several at once" : ""}${def.options ? `: ${def.options.map(x => x.name).join(" | ")}` : ""})${css}; use it on a widget: "design": { "${name}": ${use} }`;
    }

    // ------------------------------------------------ theme variables

    const VARS_FILE = "theme/web/custom-variables.scss";
    // $name -> default value of the Atlas (themesource) variables
    function knownVariables() {
        const out = new Map();
        const ts = path.join(dir, "themesource");
        const walk = (d, depth) => {
            if (depth > 3 || !fs.existsSync(d)) return;
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
                else if (/variables[^/]*\.scss$/.test(e.name)) for (const m of fs.readFileSync(path.join(d, e.name), "utf8").matchAll(/^\s*\$([\w-]+)\s*:\s*([^;]*);/gm)) if (!out.has(m[1])) out.set(m[1], m[2].replace(/\s*!default\s*$/, "").trim());
            }
        };
        if (fs.existsSync(ts)) for (const m of fs.readdirSync(ts)) walk(path.join(ts, m, "web"), 0);
        return out;
    }
    const COLOR = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla)\([^()]*\)|[a-z]+|\$[\w-]+|var\(--[\w-]+\)|(darken|lighten|mix|rgba|transparentize|adjust-hue|saturate|desaturate|shade-color|tint-color)\(.*\))$/i;
    const SIZE = /^(-?\d*\.?\d+(px|rem|em|%|vh|vw|pt|ch)?|0|auto|\$[\w-]+|var\(--[\w-]+\)|(calc|math\.div|min|max|clamp)\(.*\)|\$[\w-]+\s*[*/+-]\s*[\d.]+(px|rem|em)?)$/i;
    function checkValue(name, v, where) {
        const s = String(v).trim();
        if (!s) throw new Error(`${where}: $${name} needs a value`);
        if (/[;{}\n]/.test(s)) throw new Error(`${where}: $${name}: '${s}' may not hold ; { } or a line break`);
        let depth = 0;
        for (const c of s.replace(/"[^"]*"|'[^']*'/g, "")) {
            if (c === "(") depth++;
            else if (c === ")" && --depth < 0) break;
        }
        if (depth !== 0 || (s.match(/"/g) || []).length % 2 || (s.match(/'/g) || []).length % 2) throw new Error(`${where}: $${name}: '${s}' has unbalanced brackets or quotes`);
        if (/(^|-)(color|bg|background)(-|$)|^brand-(?!logo)/.test(name) && !/^(true|false|null)$/.test(s) && !COLOR.test(s)) throw new Error(`${where}: $${name} is a colour: '${s}' is not one (#rrggbb, rgb(...), hsl(...), a colour name, $other-variable or var(--name))`);
        if (/(^|-)(size|height|width|spacing|padding|margin|radius|gutter|gap)(-|$)/.test(name) && !/^(font-family|.*-family)/.test(name) && !/^(true|false|null)$/.test(s) && !SIZE.test(s)) throw new Error(`${where}: $${name} is a size: '${s}' is not one (16px, 1rem, 50%, $other-variable, calc(...))`);
        return s;
    }

    async function setThemeVariable(o) {
        const where = "setThemeVariable";
        const rel = pathOf(o.file !== undefined ? o.file : VARS_FILE, where);
        if (!/\.scss$/i.test(rel)) throw new Error(`${where}: ${rel} is not a .scss file`);
        const vars = o.variables;
        if (!vars || typeof vars !== "object" || Array.isArray(vars) || !Object.keys(vars).length) throw new Error(`${where}: variables is { "brand-primary": "#264ae5", ... }`);
        let body = text(rel);
        if (body === null) {
            if (o.file !== undefined) throw new Error(`${where}: ${rel} does not exist (create it with editThemeFile content)`);
            body = "";
            client.warn(`${where}: ${rel} did not exist; it is created (Studio Pro reads theme/web/custom-variables.scss before Atlas)`);
        }
        const known = knownVariables();
        const done = [];
        for (const [k, v] of Object.entries(vars)) {
            const name = String(k).replace(/^\$/, "");
            const w = `${where} $${name}`;
            if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new Error(`${w}: not a valid SCSS variable name`);
            const value = checkValue(name, v, w);
            for (const m of value.matchAll(/\$([\w-]+)/g)) if (!known.has(m[1]) && !new RegExp(`^\\s*\\$${m[1]}\\s*:`, "m").test(body) && !Object.keys(vars).some(x => x.replace(/^\$/, "") === m[1])) client.warn(`${w}: it uses $${m[1]}, which no theme variables file defines`);
            const re = new RegExp(`^([ \\t]*\\$${name.replace(/-/g, "\\-")}[ \\t]*:[ \\t]*)([^;\\n]*?)([ \\t]*!default)?([ \\t]*;)`, "gm");
            const hits = [...body.matchAll(re)];
            if (hits.length) {
                const old = hits[hits.length - 1][2].trim();
                body = body.replace(re, (all, a, b, d, e) => `${a}${value}${d || ""}${e}`);
                done.push(old === value ? `$${name} already ${value}` : `$${name}: ${old} -> ${value}`);
                if (hits.length > 1) client.warn(`${w}: ${rel} sets it ${hits.length} times; all now ${value}`);
                continue;
            }
            if (!known.has(name) && o.new !== true) {
                const s = suggest(name, [...known.keys()], 5);
                throw new Error(`${w}: Atlas has no variable $${name}${s.length ? `. Did you mean: ${s.map(x => "$" + x).join(", ")}?` : ""} (give "new": true for a variable of your own)`);
            }
            body = body + (body && !body.endsWith("\n") ? "\n" : "") + `$${name}: ${value};\n`;
            done.push(`$${name}: ${value} (added${known.has(name) ? `; Atlas default ${known.get(name)}` : ""})`);
        }
        balanced(rel, body);
        files.stage(client, rel, body);
        return `${rel}: ${done.join(", ")}`;
    }

    checks.addDesignProperty = async o => {
        const r = [];
        const mod = o.module !== undefined ? String(o.module) : null;
        const rels = mod ? [`themesource/${mod.toLowerCase()}/web/design-properties.json`] : [...design.definitions(dir).keys()].length ? fs.readdirSync(path.join(dir, "themesource")).map(m => `themesource/${m}/web/design-properties.json`) : [];
        const hit = rels.some(rel => {
            const b = files.onDisk(dir, rel);
            if (!b) return false;
            try {
                const j = JSON.parse(b.toString("utf8").replace(/^\uFEFF/, ""));
                return Object.entries(j).some(([t, l]) => t.toLowerCase() === String(o.widgetType).toLowerCase() && Array.isArray(l) && l.some(p => p && p.name === String(o.name).trim()));
            } catch (e) {
                return false;
            }
        });
        if (!hit) r.push(`no design property '${o.name}' for ${o.widgetType} in themesource`);
        return r;
    };
    checks.setThemeVariable = async o => {
        const rel = files.projectPath(dir, o.file !== undefined ? o.file : VARS_FILE, ROOTS, "check");
        const b = files.onDisk(dir, rel);
        if (!b) return [`${rel} is missing`];
        const s = b.toString("utf8");
        return Object.entries(o.variables || {}).filter(([k, v]) => !new RegExp(`^\\s*\\$${String(k).replace(/^\$/, "").replace(/-/g, "\\-")}\\s*:\\s*${String(v).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(s)).map(([k]) => `${rel}: $${String(k).replace(/^\$/, "")} is not set`);
    };

    return { impl: { editThemeFile, addCssClass, addDesignProperty, setThemeVariable }, checks, internals: { knownVariables, balanced, text } };
}

function listScss(dir, root) {
    const fs = require("fs");
    const path = require("path");
    const out = [];
    const walk = (d, rel, depth) => {
        if (depth > 4 || !fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/${e.name}`, depth + 1);
            else if (/\.scss$/.test(e.name) && /\/web(\/|$)/.test(`${rel}/`)) out.push(`${rel}/${e.name}`);
        }
    };
    walk(path.join(dir, root), root, 0);
    return out;
}

module.exports = { makeTheme, THEME_OPS };
