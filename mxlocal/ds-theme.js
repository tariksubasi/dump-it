"use strict";
// Company design system, web theme layer: a design module (an own UI resources module whose themesource/<module>/web
// holds tokens -> atoms -> molecules -> organisms -> utilities), its tokens (setTokens: SCSS variables, CSS custom
// properties, dark mode, Atlas variables), component styles (addComponentStyle), theme assets and fonts, and its
// design properties (changeDesignProperty / deleteDesignProperty). Files go through files.js like every theme file
// (diff in the dry run, approval code, backup, restore); the module flags go into the model. The dry run compiles the
// theme and lints it (stylecheck.js, STYLE CHECK).
//
// The design module's class prefix (e.g. co-) lives in a comment header of its main.scss, read by every op here:
//   // @ds-prefix: co-
// Its tokens live in tokens/tokens.json next to the generated tokens/_tokens.scss and tokens/_css-vars.scss.
const fs = require("fs");
const path = require("path");
const files = require("./files");
const design = require("./design");
const T = require("./tokens");
const S = require("./stylecheck");
const { fail, suggest, validName } = require("./ops-util");

const LEVELS = { atom: "atoms", molecule: "molecules", organism: "organisms", utility: "utilities" };
const LAYERS = ["tokens", "atoms", "molecules", "organisms", "utilities"];
const ASSET_TYPES = {
    woff2: b => b.slice(0, 4).toString("latin1") === "wOF2",
    woff: b => b.slice(0, 4).toString("latin1") === "wOFF",
    ttf: b => b.readUInt32BE(0) === 0x00010000 || b.slice(0, 4).toString("latin1") === "true",
    otf: b => b.slice(0, 4).toString("latin1") === "OTTO",
    png: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    gif: b => /^GIF8[79]a/.test(b.slice(0, 6).toString("latin1")),
    webp: b => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP",
    ico: b => b.readUInt32BE(0) === 0x00000100,
    svg: b => !b.includes(0) && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(b.slice(0, 1024).toString("utf8"))
};
const ASSET_LIMIT = 2 * 1024 * 1024;
const FONT_FORMAT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

const DS_THEME_OPS = {
    createDesignModule: {
        doc: "Make the company design module: a new (or an existing own) module becomes a UI resources module, placed after the Marketplace UI modules (Atlas) in App Settings > Theme, with themesource/<module>/web/ main.scss -> tokens, atoms, molecules, organisms, utilities (each with _index.scss), design-properties.json, default tokens and a class prefix. Marketplace modules are refused.",
        fields: {
            name: "R module name, e.g. CompanyDesign (an existing own module is adopted: its main.scss content is kept)",
            prefix: "optional class prefix of the design system, e.g. \"co-\" (default: the first two letters of the module name + -)",
            order: "optional position among the UI resources modules, 1 = first (default: after the Marketplace UI modules such as Atlas_Core)"
        }
    },
    setThemeModuleOrder: {
        doc: "Set the order of the UI resources modules (App Settings > Theme): later modules override earlier ones. List every UI resources module once.",
        fields: { order: "R [ \"Atlas_Core\", \"DataWidgets\", \"CompanyDesign\" ]: every UI resources module, in compile order" }
    },
    addComponentStyle: {
        doc: "Add the SCSS of one design system component: <level>s/_<name>.scss in the design module with the prefixed class (.co-<name>), and its @import in that level's _index.scss (sorted). Tokens ($co-... / var(--co-...)) may be used.",
        fields: {
            level: "R atom | molecule | organism | utility",
            name: "R component name in kebab case, e.g. button, card, page-header (the class is <prefix><name>, e.g. co-card)",
            css: "declarations of the class: \"padding: $co-space-4; border-radius: $co-radius-md\" or { \"padding\": \"16px\" }",
            scss: "SCSS instead of css: the body of the class (nesting with &:hover, & > .x allowed), or whole rules that mention .<prefix><name>",
            module: "optional design module (default: the app's one design module)",
            replace: "optional true: replace the component when it exists"
        }
    },
    removeComponentStyle: {
        doc: "Remove a component's SCSS file of the design module and its @import; names widgets that still use the class.",
        fields: { level: "R atom | molecule | organism | utility", name: "R component name", module: "optional design module" }
    },
    setTokens: {
        doc: "Set the design tokens of the design module: tokens/tokens.json -> tokens/_tokens.scss ($co-color-primary-500, $co-space-4, ...) + tokens/_css-vars.scss (:root --co-... custom properties, the dark set) + the Atlas variables in theme/web/custom-variables.scss (brand-primary, bg-color, font-family-base, border-radius-default, spacing-*, ...). Only a brand colour is enough: the rest gets modern defaults; one colour becomes a 50..900 scale. Contrast is checked (STYLE CHECK).",
        fields: {
            tokens: "optional { \"colors\": { \"primary\": \"#0b5fff\", \"neutral\", \"success\", \"warning\", \"danger\", \"info\" (one colour or { \"50\": ..., \"500\": ..., \"900\": ... }) }, \"surface\": { \"0\": page, \"1\": card, \"2\": nested, \"3\": popover }, \"text\": { \"primary\", \"secondary\", \"disabled\", \"onPrimary\", \"link\" }, \"border\": { \"subtle\", \"default\", \"strong\", \"focus\" }, \"radius\", \"spacing\" (4px grid), \"elevation\" { \"1\"..\"4\": shadow }, \"zIndex\", \"typography\" { \"fontFamily\", \"baseSize\", \"lineHeight\", \"scale\", \"weights\" }, \"breakpoints\", \"motion\", \"dark\": true or { \"surface\", \"text\", \"border\" }, \"darkMode\": \"class\" | \"auto\" } (merged over the module's current tokens)",
            brand: "optional the brand colour, e.g. \"#0b5fff\" (short for tokens.colors.primary)",
            module: "optional design module",
            atlas: "optional false: do not set the Atlas variables in custom-variables.scss (default true)",
            strict: "optional true: a text/background pair below WCAG AA refuses the change (default: a warning)"
        }
    },
    addThemeAsset: {
        doc: "Copy a font or image file (.woff2 .woff .ttf .otf .png .svg .jpg .gif .webp .ico, at most 2 MB, checked by content) into theme/web/ or the design module's themesource/<module>/web/.",
        fields: {
            from: "R the local file (relative to the export folder, or an absolute path)",
            to: "R target under theme/web/ or themesource/<own module>/web/, e.g. themesource/companydesign/web/images/logo.svg",
            replace: "optional true: replace the file when it exists"
        }
    },
    addFont: {
        doc: "Add a web font to the design module: the font files (assets), an @font-face per file in tokens/_fonts.scss, and the font family as token (typography.fontFamily) and Atlas $font-family-base (Open Sans import off).",
        fields: {
            family: "R font family name, e.g. Inter",
            files: "R [ { \"from\": \"fonts/Inter-Regular.woff2\", \"weight\": 400, \"style\": \"normal\" } ] (weight default 400, style default normal)",
            fallback: "optional fallback stack (default: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif)",
            base: "optional false: only add the font (no token, no Atlas font)",
            module: "optional design module"
        }
    },
    changeDesignProperty: {
        doc: "Change a design property of an own module (design-properties.json): rename it or its options (Studio Pro keeps the widgets' values through oldNames), add or remove options, description, category. Lists the widgets that use a removed option.",
        fields: {
            widgetType: "R widget type, as in addDesignProperty (DivContainer, ActionButton, Widget, ...)",
            name: "R the property name",
            newName: "optional new property name",
            addOptions: "optional [ { \"name\": \"Flat\", \"class\": \"co-card-flat\", \"css\": \"box-shadow: none\" } ]",
            removeOptions: "optional [ \"Option name\" ]",
            renameOptions: "optional { \"Old option\": \"New option\" }",
            description: "optional new help text", category: "optional new group",
            module: "optional module whose design-properties.json has it"
        }
    },
    deleteDesignProperty: {
        doc: "Delete a design property of an own module (design-properties.json; its CSS rules stay). Lists the widgets that still use it (Studio Pro then shows them as errors: change them first).",
        fields: { widgetType: "R widget type", name: "R the property name", module: "optional module whose design-properties.json has it" }
    }
};

function makeDsTheme({ model, client, impl, theme }) {
    const dir = client.project.dir;
    const text = rel => {
        const b = files.current(client, rel);
        return b === null ? null : b.toString("utf8");
    };
    const { balanced } = theme.internals;
    const sdk = require("mendixmodelsdk");

    // ------------------------------------------------ design module

    const ownModule = (name, where) => {
        const mods = model.allModules();
        const m = mods.find(x => x.name === String(name)) || fail(`${where}: no module '${name}'`, String(name), mods.map(x => x.name));
        if (m.fromAppStore || m.appStoreGuid) throw new Error(`${where}: ${m.name} is a Marketplace module: its themesource is replaced when it is updated. Use your own design module (createDesignModule "CompanyDesign")`);
        return m;
    };
    // { module, folder, prefix } of the design module the op works on
    function designModule(o, where) {
        const all = S.designModules(client, model);
        if (o.module !== undefined) {
            const m = ownModule(o.module, where);
            const d = all.find(x => x.module === m.name);
            if (!d) throw new Error(`${where}: ${m.name} is not a design module yet (no @ds-prefix header in themesource/${m.name.toLowerCase()}/web/main.scss); run { "op": "createDesignModule", "name": "${m.name}" } first`);
            return d;
        }
        if (all.length === 1) return all[0];
        if (!all.length) throw new Error(`${where}: the app has no design module yet; start with { "op": "createDesignModule", "name": "CompanyDesign" }`);
        throw new Error(`${where}: give "module": the app has several design modules (${all.map(x => x.module).join(", ")})`);
    }
    async function webPart() {
        const ps = model.allProjectSettings()[0];
        const s = ps && (await ps.load());
        return (s && s.settingsParts.find(p => p instanceof sdk.settings.WebUIProjectSettingsPart)) || null;
    }
    function writeOrder(part, list) {
        const now = part.themeModuleOrder.map(e => e.moduleName);
        if (now.length === list.length && now.every((n, i) => n === list[i])) return false;
        part.themeModuleOrder.clear();
        for (const n of list) {
            const e = sdk.settings.ThemeModuleEntry.create(model);
            e.moduleName = n;
            part.themeModuleOrder.push(e);
        }
        return true;
    }
    // _index.scss with the given imports added / removed: comment lines kept on top, imports sorted and unique
    function indexWith(rel, add = [], remove = []) {
        const cur = text(rel) || "";
        const lines = cur.split(/\r?\n/);
        const head = lines.filter(l => !/^\s*@import\s+["'][^"']+["'];\s*$/.test(l) && l.trim());
        let imports = lines.map(l => /^\s*@import\s+["']([^"']+)["'];\s*$/.exec(l)).filter(Boolean).map(m => m[1]);
        const first = ["tokens", "fonts", "css-vars"]; // tokens/_index.scss: the variables before what uses them
        const rank = i => (first.includes(i) ? first.indexOf(i) : first.length);
        imports = [...new Set([...imports, ...add])].filter(i => !remove.includes(i)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
        return [...head, ...imports.map(i => `@import "${i}";`)].join("\n") + "\n";
    }
    const indexHead = layer => `// ${layer}: one @import per file (addComponentStyle keeps this list sorted)`;

    function writeTokens(d, t) {
        const tok = `${d.folder}/tokens`;
        files.stage(client, `${tok}/tokens.json`, JSON.stringify(t, null, 4) + "\n");
        files.stage(client, `${tok}/_tokens.scss`, T.toScss(t, d.prefix));
        files.stage(client, `${tok}/_css-vars.scss`, T.toCssVars(t, d.prefix));
        files.stage(client, `${tok}/_index.scss`, indexWith(`${tok}/_index.scss`, ["tokens", "css-vars"]));
    }
    function storedTokens(d) {
        const b = text(`${d.folder}/tokens/tokens.json`);
        if (b === null) return null;
        try {
            return JSON.parse(b);
        } catch (e) {
            throw new Error(`${d.folder}/tokens/tokens.json is not valid JSON (${e.message}); fix it with editThemeFile or give all tokens again`);
        }
    }

    async function createDesignModule(o) {
        const where = `createDesignModule ${o.name}`;
        validName(o.name, "module name");
        let m = model.allModules().find(x => x.name === o.name);
        const clash = !m && model.allModules().find(x => x.name.toLowerCase() === String(o.name).toLowerCase());
        if (clash) throw new Error(`${where}: module ${clash.name} has the same themesource folder (themesource/${clash.name.toLowerCase()}); use that name`);
        if (m) ownModule(o.name, where);
        const folder = `themesource/${String(o.name).toLowerCase()}/web`;
        const cur = text(`${folder}/main.scss`);
        const had = cur && S.MARK.exec(cur);
        let prefix = o.prefix !== undefined ? String(o.prefix).trim().toLowerCase() : had ? had[1] : String(o.name).replace(/[^A-Za-z]/g, "").slice(0, 2).toLowerCase() + "-";
        if (!prefix.endsWith("-")) prefix += "-";
        if (!/^[a-z][a-z0-9]{1,5}-$/.test(prefix)) throw new Error(`${where}: prefix '${o.prefix}' must be 2-6 lower-case letters or digits and a -, e.g. "co-"`);
        if (["mx-", "btn-", "col-", "row-", "form-", "spacing-", "text-", "bg-", "widget-", "glyphicon-"].includes(prefix)) throw new Error(`${where}: prefix ${prefix} is used by Mendix / Atlas classes; take one of your company, e.g. "co-"`);
        if (had && had[1] !== prefix) throw new Error(`${where}: ${o.name} already has the prefix ${had[1]}; changing it would rename every class (not supported: keep ${had[1]})`);
        const done = [];
        if (!m) {
            await impl().createModule({ name: o.name });
            m = model.allModules().find(x => x.name === o.name);
            done.push("module created");
        } else done.push(had ? "existing design module" : "existing module adopted");
        if (!m.isThemeModule) {
            m.isThemeModule = true;
            done.push("UI resources module");
        }
        // App Settings > Theme order: Marketplace UI modules (Atlas) first, then this one (or at "order")
        const part = await webPart();
        if (part) {
            let list = S.uiOrder(model, part);
            if (o.order !== undefined) {
                const n = Number(o.order);
                if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: order is a position 1, 2, ... among the UI resources modules (${list.join(", ")})`);
                list = list.filter(x => x !== m.name);
                list.splice(Math.min(n - 1, list.length), 0, m.name);
            }
            if (writeOrder(part, list)) done.push(`theme order: ${list.join(" > ")}`);
        } else client.warn(`${where}: this project has no web UI settings; set the module order in Studio Pro (App Settings > Theme)`);
        // the folder
        const d = { module: m.name, folder, prefix };
        const vars = files.current(client, "theme/web/custom-variables.scss") !== null;
        const atlas = fs.existsSync(path.join(dir, "themesource", "atlas_core", "web", "_variables.scss"));
        const header = [
            `// ${m.name}: the company design system (made by mxlocal createDesignModule).`,
            `// @ds-prefix: ${prefix}`,
            "// Layers: tokens -> atoms -> molecules -> organisms -> utilities. Change them with setTokens and addComponentStyle;",
            "// Studio Pro compiles this file because the module is a UI resources module (App Settings > Theme).",
            ...(vars ? ['@import "../../../theme/web/custom-variables";'] : []),
            ...(atlas ? ['@import "../../atlas_core/web/variables";'] : []),
            ...LAYERS.map(l => `@import "${l}/index";`)
        ].join("\n") + "\n";
        if (!had) {
            files.stage(client, `${folder}/main.scss`, header + (cur && cur.trim() ? `\n${cur}` : ""));
            done.push(`${folder}/main.scss${cur && cur.trim() ? " (its content kept below the header)" : ""}`);
        } else {
            const miss = LAYERS.filter(l => !new RegExp(`@import\\s+["']${l}/(_)?index["']`).test(cur));
            if (miss.length) files.stage(client, `${folder}/main.scss`, cur + (cur.endsWith("\n") ? "" : "\n") + miss.map(l => `@import "${l}/index";`).join("\n") + "\n");
        }
        for (const l of LAYERS.slice(1)) if (text(`${folder}/${l}/_index.scss`) === null) files.stage(client, `${folder}/${l}/_index.scss`, indexHead(l) + "\n");
        if (text(`${folder}/tokens/_index.scss`) === null) files.stage(client, `${folder}/tokens/_index.scss`, indexHead("tokens") + "\n");
        if (storedTokens(d) === null) {
            writeTokens(d, T.normalize(undefined, null, where).tokens);
            done.push("default tokens");
        }
        if (text(`${folder}/design-properties.json`) === null) files.stage(client, `${folder}/design-properties.json`, "{}\n");
        return `${m.name} (${done.join("; ")}; class prefix ${prefix}): ${folder}/ main.scss + ${LAYERS.join(", ")}`;
    }

    async function setThemeModuleOrder(o) {
        const where = "setThemeModuleOrder";
        if (!Array.isArray(o.order) || !o.order.length) throw new Error(`${where}: order is a list [ "Atlas_Core", "CompanyDesign" ]`);
        const part = await webPart();
        if (!part) throw new Error(`${where}: this project has no web UI settings (Mendix 9.3+); set the order in Studio Pro`);
        const ui = model.allModules().filter(m => m.isThemeModule).map(m => m.name);
        const list = o.order.map(String);
        for (const n of list) {
            if (ui.includes(n)) continue;
            if (model.allModules().some(m => m.name === n)) throw new Error(`${where}: ${n} is not a UI resources module (createDesignModule makes an own module one)`);
            fail(`${where}: no UI resources module '${n}'`, n, ui);
        }
        const dup = list.find((n, i) => list.indexOf(n) !== i);
        if (dup) throw new Error(`${where}: ${dup} is listed twice`);
        const missing = ui.filter(n => !list.includes(n));
        if (missing.length) throw new Error(`${where}: list every UI resources module; missing: ${missing.join(", ")}`);
        const changed = writeOrder(part, list);
        return `${list.join(" > ")}${changed ? "" : " (already so)"}`;
    }

    // ------------------------------------------------ components

    const levelOf = (lv, where) => LEVELS[String(lv).toLowerCase()] || fail(`${where}: level '${lv}' is atom, molecule, organism or utility`, String(lv), Object.keys(LEVELS));
    const nameOf = (n, where) => {
        const s = String(n).trim();
        if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(s)) throw new Error(`${where}: name '${n}' must be kebab case: lower-case letters, digits and -, e.g. card or page-header`);
        return s;
    };
    const declsOf = (css, where) => {
        const d = css && typeof css === "object" && !Array.isArray(css) ? Object.entries(css).map(([k, v]) => `${k}: ${v}`) : String(css).split(";").map(x => x.trim()).filter(Boolean);
        if (!d.length) throw new Error(`${where}: css is empty`);
        for (const x of d) if (!/^[-\w$]+\s*:\s*\S/.test(x) || /[{}]/.test(x)) throw new Error(`${where}: '${x}' is not a CSS declaration (property: value); nested rules go in "scss"`);
        return d.map(x => `    ${x.replace(/\s*:\s*/, ": ")};`).join("\n");
    };

    async function addComponentStyle(o) {
        const where = `addComponentStyle ${o.level} ${o.name}`;
        const layer = levelOf(o.level, where);
        const name = nameOf(o.name, where);
        const d = designModule(o, where);
        const cls = name.startsWith(d.prefix) ? name : d.prefix + name;
        const file = `${d.folder}/${layer}/_${name.startsWith(d.prefix) ? name.slice(d.prefix.length) : name}.scss`;
        if ((o.css === undefined) === (o.scss === undefined)) throw new Error(`${where}: give "css" (declarations of .${cls}) or "scss" (its body or whole rules), one of them`);
        const exists = text(file) !== null;
        if (exists && o.replace !== true) throw new Error(`${where}: ${file} exists; give "replace": true to replace it (or removeComponentStyle)`);
        for (const [lv, l] of Object.entries(LEVELS)) if (l !== layer && text(`${d.folder}/${l}/_${path.posix.basename(file).slice(1)}`) !== null) throw new Error(`${where}: a ${lv} '${name}' exists already (${d.folder}/${l}/); one class, one component`);
        let body;
        if (o.css !== undefined) body = `.${cls} {\n${declsOf(o.css, where)}\n}\n`;
        else {
            const s = String(o.scss).trim();
            if (!s) throw new Error(`${where}: scss is empty`);
            if (new RegExp(`\\.${cls.replace(/-/g, "\\-")}(?![\\w-])`).test(s)) body = s + "\n";
            else body = `.${cls} {\n${s.split("\n").map(l => (l.trim() ? "    " + l.replace(/^ {0,4}/, "") : "")).join("\n")}\n}\n`;
        }
        const out = `// ${Object.keys(LEVELS).find(k => LEVELS[k] === layer)} ${name} (addComponentStyle): use it on a widget with "class": "${cls}"\n${body}`;
        balanced(file, out);
        files.stage(client, file, out);
        const idx = `${d.folder}/${layer}/_index.scss`;
        files.stage(client, idx, indexWith(idx, [path.posix.basename(file, ".scss").slice(1)]));
        if (!new RegExp(`@import\\s+["']${layer}/`).test(text(`${d.folder}/main.scss`) || "")) client.warn(`${where}: ${d.folder}/main.scss does not import ${layer}/index; run createDesignModule ${d.module} again to repair it`);
        return `${file}: .${cls}${exists ? " (replaced)" : ""}; ${idx} imports it (use it with "class": "${cls}")`;
    }

    async function removeComponentStyle(o) {
        const where = `removeComponentStyle ${o.level} ${o.name}`;
        const layer = levelOf(o.level, where);
        const name = nameOf(o.name, where);
        const d = designModule(o, where);
        const base = name.startsWith(d.prefix) ? name.slice(d.prefix.length) : name;
        const file = `${d.folder}/${layer}/_${base}.scss`;
        if (text(file) === null) {
            const have = fs.existsSync(path.join(dir, ...d.folder.split("/"), layer)) ? fs.readdirSync(path.join(dir, ...d.folder.split("/"), layer)).filter(f => /^_.+\.scss$/.test(f) && f !== "_index.scss").map(f => f.slice(1, -5)) : [];
            fail(`${where}: no ${o.level} '${name}' in ${d.folder}/${layer}/ (there: ${have.join(", ") || "none"})`, base, have);
        }
        files.stage(client, file, null);
        const idx = `${d.folder}/${layer}/_index.scss`;
        files.stage(client, idx, indexWith(idx, [], [base]));
        const cls = d.prefix + base;
        const users = S.allAppearances(client).filter(x => S.appearanceClasses(dir, x.a).some(c => c.cls === cls)).map(x => `${x.doc} ${x.widget}`);
        return `${file} removed (and its @import)` + (users.length ? `\n      STILL USED BY (class ${cls}; these widgets lose the look): ${[...new Set(users)].slice(0, 12).join(", ")}` : "");
    }

    // ------------------------------------------------ tokens

    async function setTokens(o) {
        const where = "setTokens";
        if (o.tokens === undefined && o.brand === undefined) throw new Error(`${where}: give "brand": "#0b5fff" and/or "tokens": { ... }`);
        const d = designModule(o, where);
        let input = o.tokens === undefined ? {} : o.tokens;
        if (o.brand !== undefined) {
            if (!T.parseColor(o.brand)) throw new Error(`${where}: brand '${o.brand}' is not a colour (#rrggbb)`);
            input = T.merge(input, { colors: { primary: String(o.brand) } });
        }
        const before = storedTokens(d);
        const { tokens, notes } = T.normalize(input, before, where);
        for (const n of notes) client.warn(`${where}: ${n}`);
        writeTokens(d, tokens);
        const what = [`${d.folder}/tokens: tokens.json, _tokens.scss (${T.flat(tokens).length} $${d.prefix}... variables), _css-vars.scss (:root --${d.prefix}...${tokens.dark ? `, dark: .${d.prefix}dark / [data-theme="dark"]${tokens.darkMode === "auto" ? " + device setting" : ""}` : ""})`];
        if (o.atlas !== false) {
            const known = theme.internals.knownVariables();
            const vars = Object.fromEntries(Object.entries(T.atlasVariables(tokens)).filter(([k]) => known.has(k)));
            if (Object.keys(vars).length) {
                const r = await impl().setThemeVariable({ variables: vars });
                what.push(`Atlas: ${Object.keys(vars).length} variable(s) in ${r.split(":")[0]}`);
            } else what.push("no Atlas variables in this project (only the design module's tokens)");
        }
        return what.join("; ");
    }

    // ------------------------------------------------ assets and fonts

    function exportFolder() {
        const f = client.changeFile;
        if (!f) return process.cwd();
        const dd = path.dirname(f);
        return path.basename(dd) === "edits" ? path.dirname(dd) : dd;
    }
    function readAsset(from, where) {
        const full = path.resolve(exportFolder(), String(from));
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
            const dd = path.dirname(full);
            const near = fs.existsSync(dd) ? fs.readdirSync(dd).filter(n => /\.(woff2?|ttf|otf|png|svg|jpe?g|gif|webp|ico)$/i.test(n)) : [];
            fail(`${where}: no file '${from}' (looked in ${dd})`, path.basename(full), near);
        }
        const size = fs.statSync(full).size;
        if (size > ASSET_LIMIT) throw new Error(`${where}: ${from} is ${(size / 1048576).toFixed(1)} MB; theme files are at most 2 MB (every visitor downloads them): subset the font or shrink the image`);
        return fs.readFileSync(full);
    }
    function assetTarget(to, where) {
        const rel = files.projectPath(dir, to, ["theme", "themesource"], where);
        const m = /^themesource\/([^/]+)\/web\//.exec(rel);
        if (!m && !/^theme\/web\//.test(rel)) throw new Error(`${where}: '${to}' must be under theme/web/ or themesource/<module>/web/`);
        if (m) {
            const mod = model.allModules().find(x => x.name.toLowerCase() === m[1]);
            if (mod && (mod.fromAppStore || mod.appStoreGuid)) throw new Error(`${where}: ${mod.name} is a Marketplace module (its themesource is replaced on update); put the file in your design module or theme/web/`);
        }
        const ext = (/\.([a-z0-9]+)$/i.exec(rel) || [])[1];
        if (!ext || !ASSET_TYPES[ext.toLowerCase()]) fail(`${where}: '${rel}' is not a font or image file (.${Object.keys(ASSET_TYPES).join(" .")})`, ext || "", Object.keys(ASSET_TYPES));
        return { rel, ext: ext.toLowerCase() };
    }
    function stageAsset(from, to, replace, where) {
        const { rel, ext } = assetTarget(to, where);
        const b = readAsset(from, where);
        if (!b.length || !ASSET_TYPES[ext](b)) throw new Error(`${where}: ${from} is not a .${ext} file by its content`);
        const cur = files.current(client, rel);
        if (cur !== null && !cur.equals(b) && replace !== true) throw new Error(`${where}: ${rel} exists; give "replace": true to replace it`);
        files.stage(client, rel, b);
        return { rel, ext, size: b.length };
    }

    async function addThemeAsset(o) {
        const where = `addThemeAsset ${o.to}`;
        const a = stageAsset(o.from, o.to, o.replace, where);
        const url = a.rel.replace(/^theme\/web\//, "").replace(/^themesource\/[^/]+\/web\//, "");
        return `${a.rel} (${(a.size / 1024).toFixed(1)} KB; Studio Pro serves the files of theme/web and themesource/<module>/web next to the compiled theme: in SCSS url("${url}"))`;
    }

    async function addFont(o) {
        const where = `addFont ${o.family}`;
        const fam = String(o.family).trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(fam)) throw new Error(`${where}: family is a plain font name like Inter or Source Sans 3`);
        if (!Array.isArray(o.files) || !o.files.length) throw new Error(`${where}: files is [ { "from": "fonts/Inter-Regular.woff2", "weight": 400 } ]`);
        const d = designModule(o, where);
        const slug = fam.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const faces = [];
        for (const [i, f] of o.files.entries()) {
            const w = `${where} file ${i + 1}`;
            if (!f || typeof f !== "object" || !f.from) throw new Error(`${w}: { "from": "fonts/Inter-Regular.woff2", "weight": 400, "style": "normal" }`);
            for (const k of Object.keys(f)) if (!["from", "weight", "style"].includes(k)) fail(`${w}: unknown field '${k}'`, k, ["from", "weight", "style"]);
            const ext = ((/\.([a-z0-9]+)$/i.exec(String(f.from)) || [])[1] || "").toLowerCase();
            if (!FONT_FORMAT[ext]) throw new Error(`${w}: ${f.from} is not a font file (.woff2, .woff, .ttf, .otf; .woff2 is smallest)`);
            const weight = f.weight === undefined ? 400 : Number(f.weight);
            if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100) throw new Error(`${w}: weight is 100, 200, ... 900`);
            const style = f.style === undefined ? "normal" : String(f.style);
            if (!["normal", "italic"].includes(style)) fail(`${w}: style is normal or italic`, style, ["normal", "italic"]);
            const fileName = `${slug}-${weight}${style === "italic" ? "-italic" : ""}.${ext}`;
            const a = stageAsset(f.from, `${d.folder}/fonts/${d.prefix.replace(/-$/, "")}/${fileName}`, true, w);
            faces.push({ url: a.rel.slice(d.folder.length + 1), weight, style, format: FONT_FORMAT[ext], size: a.size });
        }
        const fontsRel = `${d.folder}/tokens/_fonts.scss`;
        const cur = text(fontsRel) || "// @font-face rules (addFont); the files are in fonts/ next to main.scss\n";
        const kept = cur.split(/\n(?=@font-face)/).filter(b => !(new RegExp(`font-family:\\s*["']${fam}["']`).test(b) && faces.some(f => b.includes(`font-weight: ${f.weight};`) && b.includes(`font-style: ${f.style};`))));
        const rules = faces.map(f => `@font-face {\n    font-family: "${fam}";\n    src: url("${f.url}") format("${f.format}");\n    font-weight: ${f.weight};\n    font-style: ${f.style};\n    font-display: swap;\n}`);
        const out = [...kept.map(x => x.trimEnd()), ...rules].join("\n") + "\n";
        balanced(fontsRel, out);
        files.stage(client, fontsRel, out);
        files.stage(client, `${d.folder}/tokens/_index.scss`, indexWith(`${d.folder}/tokens/_index.scss`, ["fonts"]));
        const stack = `'${fam}', ${o.fallback !== undefined ? String(o.fallback) : "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"}`;
        if (/[;{}]/.test(stack)) throw new Error(`${where}: fallback may not hold ; { }`);
        let more = "";
        if (o.base !== false) {
            more = `; token typography.fontFamily = ${stack}: ${await setTokens({ module: d.module, tokens: { typography: { fontFamily: stack } }, atlas: true })}`;
            if (theme.internals.knownVariables().has("font-family-import")) {
                await impl().setThemeVariable({ variables: { "font-family-import": "false" } });
                more += "; $font-family-import: false (Atlas no longer loads Open Sans)";
            }
        }
        return `${fam}: ${faces.length} file(s) in ${d.folder}/fonts/, @font-face in ${fontsRel}${more}`;
    }

    // ------------------------------------------------ design properties

    // { rel, json, list, index, def } of a design property in an own module's design-properties.json
    function findProperty(o, where) {
        const wt = String(o.widgetType), name = String(o.name);
        const folders = [];
        const ts = path.join(dir, "themesource");
        const mods = model.allModules();
        if (o.module !== undefined) folders.push(ownModule(o.module, where).name.toLowerCase());
        else {
            if (fs.existsSync(ts)) folders.push(...fs.readdirSync(ts));
            for (const [rel] of client.fileChanges || []) {
                const m = /^themesource\/([^/]+)\/web\/design-properties\.json$/.exec(rel);
                if (m && !folders.includes(m[1])) folders.push(m[1]);
            }
        }
        const hits = [];
        for (const f of folders) {
            const rel = `themesource/${f}/web/design-properties.json`;
            const b = text(rel);
            if (b === null) continue;
            let json;
            try {
                json = JSON.parse(b.replace(/^\uFEFF/, "") || "{}");
            } catch (e) {
                continue;
            }
            for (const [k, list] of Object.entries(json)) {
                if (k.toLowerCase() !== wt.toLowerCase() || !Array.isArray(list)) continue;
                const i = list.findIndex(p => p && p.name === name);
                if (i >= 0) hits.push({ rel, json, key: k, list, index: i, def: list[i], mod: mods.find(m => m.name.toLowerCase() === f) });
            }
        }
        const own = hits.filter(h => !h.mod || !(h.mod.fromAppStore || h.mod.appStoreGuid));
        if (!own.length) {
            if (hits.length) throw new Error(`${where}: '${name}' of ${wt} belongs to the Marketplace module ${hits[0].mod.name} (replaced on update); define your own with addDesignProperty in your design module`);
            const all = [...(design.definitions(dir).get(wt) || [])].map(p => p.name);
            if (all.includes(name)) throw new Error(`${where}: '${name}' of ${wt} comes from a Marketplace module (Atlas) and cannot change here; define your own with addDesignProperty in your design module`);
            fail(`${where}: no design property '${name}' for ${wt} in an own module's design-properties.json`, name, all);
        }
        if (own.length > 1) throw new Error(`${where}: '${name}' is in ${own.map(h => h.rel).join(" and ")}; give "module"`);
        return own[0];
    }
    function users(name, option) {
        const out = [];
        for (const { doc, widget, a } of S.allAppearances(client)) for (const dp of a.DesignProperties || []) {
            if (dp.Key !== name) continue;
            const v = dp.Value || {};
            const opts = v.$Type === "Forms$OptionDesignPropertyValue" ? [v.Option] : v.$Type === "Forms$CompoundDesignPropertyValue" ? (v.Properties || []).map(p => p.Key) : [];
            if (option === undefined || opts.includes(option)) out.push(`${doc} ${widget}${opts.length && option === undefined ? ` (${opts.join(", ")})` : ""}`);
        }
        return [...new Set(out)];
    }
    function saveJson(h, where) {
        const body = JSON.stringify(h.json, null, 4) + "\n";
        files.stage(client, h.rel, body);
        design.overlay(dir, path.join(dir, ...h.rel.split("/")), body);
        return body;
    }

    async function changeDesignProperty(o) {
        const where = `changeDesignProperty ${o.name}`;
        const h = findProperty(o, where);
        const def = h.def;
        const done = [];
        const notes = [];
        if (o.newName !== undefined) {
            const nn = String(o.newName).trim();
            if (!nn || /["\\]/.test(nn)) throw new Error(`${where}: newName is a plain text`);
            if (h.list.some(p => p !== def && p.name === nn)) throw new Error(`${where}: ${h.key} already has a property '${nn}'`);
            def.oldNames = [...new Set([...(def.oldNames || []), def.name])];
            def.name = nn;
            done.push(`renamed to '${nn}' (oldNames keeps the widgets' values)`);
        }
        for (const k of ["description", "category"]) if (o[k] !== undefined) {
            def[k] = String(o[k]);
            done.push(`${k} set`);
        }
        const hasOptions = Array.isArray(def.options);
        if ((o.addOptions || o.removeOptions || o.renameOptions) && !hasOptions) throw new Error(`${where}: '${def.name}' is a ${def.type}: it has no options`);
        if (o.renameOptions !== undefined) {
            if (!o.renameOptions || typeof o.renameOptions !== "object" || Array.isArray(o.renameOptions)) throw new Error(`${where}: renameOptions is { "Old name": "New name" }`);
            for (const [from, to] of Object.entries(o.renameOptions)) {
                const opt = def.options.find(x => x.name === from) || fail(`${where}: no option '${from}'`, from, def.options.map(x => x.name));
                if (def.options.some(x => x !== opt && x.name === String(to))) throw new Error(`${where}: option '${to}' exists already`);
                opt.oldNames = [...new Set([...(opt.oldNames || []), opt.name])];
                opt.name = String(to);
                done.push(`option ${from} -> ${to}`);
            }
        }
        if (o.removeOptions !== undefined) {
            if (!Array.isArray(o.removeOptions)) throw new Error(`${where}: removeOptions is [ "Option name" ]`);
            for (const n of o.removeOptions.map(String)) {
                const i = def.options.findIndex(x => x.name === n);
                if (i < 0) fail(`${where}: no option '${n}'`, n, def.options.map(x => x.name));
                def.options.splice(i, 1);
                const u = users(o.name, n);
                done.push(`option ${n} removed`);
                if (u.length) notes.push(`STILL USED BY (option ${n}; Studio Pro shows these as errors until changed): ${u.slice(0, 12).join(", ")}`);
            }
            if (!def.options.length) throw new Error(`${where}: '${def.name}' would have no options left; delete it with deleteDesignProperty`);
        }
        const rules = [];
        if (o.addOptions !== undefined) {
            if (!Array.isArray(o.addOptions) || !o.addOptions.length) throw new Error(`${where}: addOptions is [ { "name": "Flat", "class": "co-card-flat", "css": "box-shadow: none" } ]`);
            for (const [i, x] of o.addOptions.entries()) {
                const w = `${where} addOptions ${i + 1}`;
                if (!x || typeof x !== "object" || !x.name) throw new Error(`${w}: { "name": "Flat", "class": "co-card-flat" }`);
                for (const k of Object.keys(x)) if (!["name", "class", "css"].includes(k)) fail(`${w}: unknown field '${k}'`, k, ["name", "class", "css"]);
                if (!/^-?[A-Za-z_][\w-]*$/.test(String(x.class || ""))) throw new Error(`${w}: "class" '${x.class === undefined ? "" : x.class}' is not a CSS class name`);
                if (def.options.some(p => p.name === String(x.name))) throw new Error(`${w}: option '${x.name}' exists already`);
                def.options.push({ name: String(x.name), class: String(x.class) });
                if (x.css !== undefined) rules.push(`.${x.class} {\n${declsOf(x.css, w)}\n}\n`);
                done.push(`option ${x.name} added`);
            }
        }
        if (!done.length) throw new Error(`${where}: nothing to change: give newName, addOptions, removeOptions, renameOptions, description or category`);
        saveJson(h, where);
        if (rules.length) {
            const ds = S.designModules(client, model).find(x => h.rel.startsWith(x.folder + "/"));
            const css = ds ? `${ds.folder}/utilities/_design-properties.scss` : h.rel.replace(/design-properties\.json$/, "main.scss");
            const cur = text(css) || (ds ? "// CSS of the design properties' options (changeDesignProperty)\n" : "");
            const out = cur + (cur && !cur.endsWith("\n") ? "\n" : "") + rules.join("");
            balanced(css, out);
            files.stage(client, css, out);
            if (ds) files.stage(client, `${ds.folder}/utilities/_index.scss`, indexWith(`${ds.folder}/utilities/_index.scss`, ["design-properties"]));
            done.push(`${rules.length} CSS rule(s) in ${css}`);
        }
        return `${h.rel}: ${h.key} "${def.name}": ${done.join(", ")}` + notes.map(n => `\n      ${n}`).join("");
    }

    async function deleteDesignProperty(o) {
        const where = `deleteDesignProperty ${o.name}`;
        const h = findProperty(o, where);
        h.list.splice(h.index, 1);
        if (!h.list.length) delete h.json[h.key];
        saveJson(h, where);
        const u = users(String(o.name));
        return `${h.rel}: ${h.key} "${o.name}" deleted (its CSS rules stay; remove them with removeComponentStyle / editThemeFile)` + (u.length ? `\n      STILL USED BY (Studio Pro shows these as errors; change them with changeWidget "design"): ${u.slice(0, 12).join(", ")}${u.length > 12 ? ", ..." : ""}` : "");
    }

    // ------------------------------------------------ checks (after apply)

    const onDisk = rel => {
        const b = files.onDisk(dir, rel);
        return b === null ? null : b.toString("utf8");
    };
    const checks = {
        async createDesignModule(o) {
            const r = [];
            const m = model.allModules().find(x => x.name === o.name);
            if (!m) return [`module ${o.name} missing`];
            if (!m.isThemeModule) r.push(`${o.name} is not a UI resources module`);
            const main = onDisk(`themesource/${o.name.toLowerCase()}/web/main.scss`);
            if (!main || !S.MARK.test(main)) r.push(`themesource/${o.name.toLowerCase()}/web/main.scss has no @ds-prefix header`);
            const part = await webPart();
            if (part && !part.themeModuleOrder.some(e => e.moduleName === o.name)) r.push(`${o.name} is not in the theme module order`);
            return r;
        },
        async setThemeModuleOrder(o) {
            const part = await webPart();
            const now = part ? part.themeModuleOrder.map(e => e.moduleName) : [];
            return now.join(",") === o.order.map(String).join(",") ? [] : [`theme module order is ${now.join(", ")}`];
        },
        async addComponentStyle(o) {
            const d = S.designModules(client, model).find(x => o.module === undefined || x.module === o.module);
            if (!d) return ["no design module"];
            const base = String(o.name).startsWith(d.prefix) ? String(o.name).slice(d.prefix.length) : String(o.name);
            const layer = LEVELS[String(o.level).toLowerCase()];
            const f = onDisk(`${d.folder}/${layer}/_${base}.scss`);
            const idx = onDisk(`${d.folder}/${layer}/_index.scss`) || "";
            const r = [];
            if (!f || !f.includes(`.${d.prefix}${base}`)) r.push(`${d.folder}/${layer}/_${base}.scss lacks .${d.prefix}${base}`);
            if (!idx.includes(`@import "${base}";`)) r.push(`${layer}/_index.scss does not import ${base}`);
            return r;
        },
        async removeComponentStyle(o) {
            const d = S.designModules(client, model).find(x => o.module === undefined || x.module === o.module);
            if (!d) return [];
            const base = String(o.name).startsWith(d.prefix) ? String(o.name).slice(d.prefix.length) : String(o.name);
            return onDisk(`${d.folder}/${LEVELS[String(o.level).toLowerCase()]}/_${base}.scss`) === null ? [] : [`${o.level} ${base} still exists`];
        },
        async setTokens(o) {
            const d = S.designModules(client, model).find(x => o.module === undefined || x.module === o.module);
            if (!d) return ["no design module"];
            const r = [];
            const scss = onDisk(`${d.folder}/tokens/_tokens.scss`) || "";
            const brand = o.brand || (o.tokens && o.tokens.colors && typeof o.tokens.colors.primary === "string" && o.tokens.colors.primary);
            if (brand && !scss.includes(`-color-primary-500: ${T.hex(T.parseColor(brand))}`)) r.push(`_tokens.scss has no primary 500 ${brand}`);
            if (!onDisk(`${d.folder}/tokens/_css-vars.scss`)) r.push("_css-vars.scss missing");
            return r;
        },
        async addThemeAsset(o) {
            const rel = files.projectPath(dir, o.to, ["theme", "themesource"], "check");
            return files.onDisk(dir, rel) ? [] : [`${rel} missing`];
        },
        async addFont(o) {
            const d = S.designModules(client, model).find(x => o.module === undefined || x.module === o.module);
            const f = d && onDisk(`${d.folder}/tokens/_fonts.scss`);
            return f && f.includes(`font-family: "${String(o.family).trim()}"`) ? [] : [`no @font-face for ${o.family}`];
        },
        async changeDesignProperty(o) {
            const name = o.newName !== undefined ? String(o.newName) : String(o.name);
            const defs = design.definitions(dir).get(String(o.widgetType)) || [...design.definitions(dir).entries()].find(([k]) => k.toLowerCase() === String(o.widgetType).toLowerCase())?.[1] || [];
            const d = defs.find(p => p.name === name);
            if (!d) return [`no design property '${name}' for ${o.widgetType}`];
            const r = [];
            for (const x of o.addOptions || []) if (!(d.options || []).some(p => p.name === x.name)) r.push(`option ${x.name} missing`);
            for (const n of o.removeOptions || []) if ((d.options || []).some(p => p.name === n)) r.push(`option ${n} still there`);
            return r;
        },
        async deleteDesignProperty(o) {
            design.reset(dir);
            const own = model.allModules().filter(m => !m.fromAppStore && !m.appStoreGuid).map(m => `themesource/${m.name.toLowerCase()}/web/design-properties.json`);
            for (const rel of own) {
                const s = onDisk(rel);
                if (!s) continue;
                try {
                    const j = JSON.parse(s.replace(/^\uFEFF/, ""));
                    if (Object.entries(j).some(([k, l]) => k.toLowerCase() === String(o.widgetType).toLowerCase() && Array.isArray(l) && l.some(p => p && p.name === o.name))) return [`${rel} still has '${o.name}'`];
                } catch (e) {
                    /* checked by others */
                }
            }
            return [];
        }
    };

    return { impl: { createDesignModule, setThemeModuleOrder, addComponentStyle, removeComponentStyle, setTokens, addThemeAsset, addFont, changeDesignProperty, deleteDesignProperty }, checks };
}

module.exports = { makeDsTheme, DS_THEME_OPS, LEVELS };
