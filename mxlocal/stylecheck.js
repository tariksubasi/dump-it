"use strict";
// STYLE CHECK of the dry run: the web theme compiled locally with Dart Sass (node_modules/sass, pure JS) the way Studio
// Pro builds it, plus lints over what the change touched.
//
// Studio Pro compiles one SCSS entry it generates: the main.scss of every UI resources module (Projects$Module
// isThemeModule) in the order of App Settings > Theme (WebUIProjectSettingsPart.themeModuleOrder; modules missing
// there follow, Marketplace ones first), then the main.scss of the other modules' themesource folders, then
// theme/web/main.scss. Every module's main.scss imports what it needs itself, relative to its own folder (Atlas_Core:
// "../../../theme/web/custom-variables", "variables", ...): no extra load paths. The entry here mirrors that, with
// theme/web/custom-variables first, and reads files through the change (staged theme files), so the dry run compiles
// the theme as it will be after apply.
//
// Errors (an undefined variable or mixin, an import that does not resolve, a syntax error) block the change with
// file:line, unless the theme had the same error before the change (then a warning). Deprecation warnings of Sass are
// counted as info. Lints (warnings, nothing refused unless "strict"): classes on new or changed widgets that no SCSS
// defines, inline styles, unprefixed classes of the design module that Atlas also defines, contrast of text/background
// token and Atlas variable pairs (WCAG AA); info: design module classes no widget uses.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL, fileURLToPath } = require("url");
const files = require("./files");
const T = require("./tokens");

const ENTRY = "__mxlocal_theme_entry.scss";
const MARK = /^\/\/ @ds-prefix: ([a-z][a-z0-9]*-)\s*$/m; // the design module's main.scss header (ds-theme.js)

// ------------------------------------------------ theme module order

function webPart(model) {
    const sdk = require("mendixmodelsdk");
    const ps = model.allProjectSettings()[0];
    if (!ps || !ps.isLoaded) return null;
    return ps.settingsParts.find(p => p instanceof sdk.settings.WebUIProjectSettingsPart) || null;
}
// the UI resources modules in compile order: stored order first, then the rest (Marketplace first, Atlas_Core first)
function uiOrder(model, part) {
    const ui = model.allModules().filter(m => m.isThemeModule);
    let stored = [];
    try {
        stored = part ? part.themeModuleOrder.map(e => e.moduleName) : [];
    } catch (e) {
        stored = [];
    }
    const out = stored.filter((n, i) => stored.indexOf(n) === i && ui.some(m => m.name === n));
    const rank = m => (m.name === "Atlas_Core" ? 0 : m.fromAppStore ? 1 : 2);
    const rest = ui.filter(m => !out.includes(m.name)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return [...out, ...rest.map(m => m.name)];
}

// rel paths of the module main.scss files in compile order (staged files count)
function mainFiles(client, model) {
    const ui = model ? uiOrder(model, webPart(model)) : [];
    const exists = rel => files.current(client, rel) !== null;
    const dir = client.project.dir;
    const folders = new Set();
    const ts = path.join(dir, "themesource");
    if (fs.existsSync(ts)) for (const d of fs.readdirSync(ts)) folders.add(d);
    for (const [rel, e] of client.fileChanges || []) {
        const m = /^themesource\/([^/]+)\/web\/main\.scss$/.exec(rel);
        if (m && e.after) folders.add(m[1]);
    }
    const order = [...ui.map(n => n.toLowerCase()), ...[...folders].filter(f => !ui.some(n => n.toLowerCase() === f)).sort()];
    return order.map(f => `themesource/${f}/web/main.scss`).filter(exists);
}

// ------------------------------------------------ compile

// file reader over the change: staged content first, else disk (abs path -> Buffer | null)
function reader(client) {
    const dir = client.project.dir;
    return abs => {
        const rel = path.relative(dir, abs).split(path.sep).join("/");
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) return files.current(client, rel);
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs) : null;
    };
}

function importer(read) {
    const isFile = abs => read(abs) !== null;
    const resolve = abs => {
        if (/\.(scss|sass|css)$/i.test(abs)) return isFile(abs) ? abs : null;
        const d = path.dirname(abs), b = path.basename(abs);
        for (const c of [`_${b}.scss`, `${b}.scss`, `_${b}.sass`, `${b}.sass`, `_${b}.css`, `${b}.css`]) if (isFile(path.join(d, c))) return path.join(d, c);
        for (const c of ["_index.scss", "index.scss", "_index.sass", "index.sass"]) if (isFile(path.join(abs, c))) return path.join(abs, c);
        return null;
    };
    return {
        canonicalize(url, ctx) {
            let abs;
            if (url.startsWith("file:")) abs = fileURLToPath(url);
            else if (ctx && ctx.containingUrl && ctx.containingUrl.protocol === "file:") abs = path.resolve(path.dirname(fileURLToPath(ctx.containingUrl)), url);
            else return null;
            const hit = resolve(abs);
            return hit ? pathToFileURL(hit) : null;
        },
        load(url) {
            const abs = fileURLToPath(url);
            const b = read(abs);
            if (b === null) return null;
            return { contents: b.toString("utf8").replace(/^\uFEFF/, ""), syntax: /\.sass$/i.test(abs) ? "indented" : /\.css$/i.test(abs) ? "css" : "scss" };
        }
    };
}

// Compile the theme as of the change (or as on disk with { disk: true }).
// -> { skipped: reason } | { ok, css, error: { file, line, message }, deprecations, warnings: [], entry }
function compile(client, model, opts = {}) {
    const dir = client.project.dir;
    const view = opts.disk ? { project: client.project, fileChanges: new Map() } : client;
    const read = reader(view);
    if (read(path.join(dir, "theme", "web", "main.scss")) === null) return { skipped: "this project has no theme/web/main.scss (no web theme to compile)" };
    let sass;
    try {
        sass = require("sass");
    } catch (e) {
        return { skipped: "Dart Sass (node_modules/sass) is missing" };
    }
    const mains = mainFiles(view, model);
    const lines = [];
    if (read(path.join(dir, "theme", "web", "custom-variables.scss")) !== null) lines.push('@import "theme/web/custom-variables";');
    for (const m of mains) lines.push(`@import "${m.replace(/\.scss$/, "")}";`);
    lines.push('@import "theme/web/main";');
    const entry = lines.join("\n") + "\n";
    const imp = importer(read);
    const deprecations = new Map(), warnings = [];
    const rel = u => (u && u.protocol === "file:" ? path.relative(dir, fileURLToPath(u)).split(path.sep).join("/") : String(u || ENTRY));
    try {
        const r = sass.compileString(entry, {
            url: pathToFileURL(path.join(dir, ENTRY)),
            importer: imp,
            importers: [imp],
            style: "expanded",
            quietDeps: false,
            verbose: false,
            logger: {
                warn(message, o) {
                    if (o && o.deprecation) {
                        const k = String(o.deprecationType ? o.deprecationType.id : message.split("\n")[0]).slice(0, 80);
                        deprecations.set(k, (deprecations.get(k) || 0) + 1);
                    } else if (/repetitive deprecation warnings omitted/.test(message)) deprecations.set("omitted", (deprecations.get("omitted") || 0) + (Number((/(\d+)/.exec(message) || [])[1]) || 0));
                    else warnings.push(`${o && o.span ? `${rel(o.span.url)}:${o.span.start.line + 1}: ` : ""}${message.split("\n")[0]}`);
                },
                debug() {}
            }
        });
        return { ok: true, css: r.css, deprecations, warnings, entry, modules: mains };
    } catch (e) {
        const span = e.span;
        const file = span && span.url ? rel(span.url) : ENTRY;
        const line = span ? span.start.line + 1 : 0;
        const at = span && span.text && span.text.length <= 80 ? ` (${span.text.replace(/\s+/g, " ")})` : "";
        const message = String(e.sassMessage || e.message).split("\n")[0] + at;
        return { ok: false, error: { file, line, message, text: `${file}:${line}: ${message}` }, deprecations, warnings, entry, modules: mains };
    }
}

// ------------------------------------------------ what the CSS defines

function classesOf(css) {
    const out = new Set();
    const s = String(css).replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
    const re = /([^{};]+)\{/g;
    let m;
    while ((m = re.exec(s))) {
        const sel = m[1];
        if (/^\s*@/.test(sel)) continue;
        for (const c of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(c[1]);
    }
    return out;
}
// --name: value of the first :root blocks (Atlas maps its variables there)
function rootVars(css) {
    const out = {};
    for (const b of String(css).matchAll(/(^|[\s,}]):root\s*\{([^{}]*)\}/g)) for (const d of b[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) if (!(d[1] in out)) out[d[1]] = d[2].trim();
    return out;
}
// class names written literally in SCSS / CSS text (no compile: generated #{...} classes are missed)
function textClasses(text) {
    return classesOf(String(text).replace(/\/\/[^\n]*/g, "").replace(/#\{[^}]*\}/g, "X"));
}

// all .scss/.css under a folder (rel paths)
function scssUnder(dir, rel, depth = 0, out = []) {
    const abs = path.join(dir, ...rel.split("/"));
    if (depth > 8 || !fs.existsSync(abs)) return out;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.isDirectory()) scssUnder(dir, `${rel}/${e.name}`, depth + 1, out);
        else if (/\.(scss|css)$/i.test(e.name)) out.push(`${rel}/${e.name}`);
    }
    return out;
}

// What the theme on disk defines, cached in .mxlocal-backup/style-classes.json while no theme file changes.
// -> { classes: Set, vars: {}, compiled: bool }
function diskTheme(client, model) {
    const dir = client.project.dir;
    const all = [...scssUnder(dir, "theme"), ...scssUnder(dir, "themesource")];
    const h = crypto.createHash("sha256").update("2|");
    for (const rel of all.sort()) {
        const st = fs.statSync(path.join(dir, ...rel.split("/")));
        h.update(`${rel}|${st.size}|${st.mtimeMs}\n`);
    }
    if (model) h.update(mainFiles({ project: client.project, fileChanges: new Map() }, model).join(","));
    const key = h.digest("base64");
    const file = path.join(dir, ".mxlocal-backup", "style-classes.json");
    try {
        const c = JSON.parse(fs.readFileSync(file, "utf8"));
        if (c.key === key) return { classes: new Set(c.classes), vars: c.vars, compiled: c.compiled, error: c.error };
    } catch (e) {
        /* no cache yet */
    }
    const r = compile(client, model, { disk: true });
    let res;
    if (r.ok) res = { classes: classesOf(r.css), vars: rootVars(r.css), compiled: true };
    else {
        const classes = new Set();
        for (const rel of all) for (const c of textClasses(fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8"))) classes.add(c);
        res = { classes, vars: {}, compiled: false, error: r.error ? r.error.text : r.skipped };
    }
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ key, classes: [...res.classes], vars: res.vars, compiled: res.compiled, error: res.error }));
    } catch (e) {
        /* read-only project folder: no cache */
    }
    return res;
}

// ------------------------------------------------ widgets of the change

const plainWalk = (o, fn, parent) => {
    if (Array.isArray(o)) return o.forEach(x => plainWalk(x, fn, parent));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o, parent);
    const next = o.$Type && o.Name !== undefined ? o : parent;
    for (const v of Object.values(o)) if (v && typeof v === "object") plainWalk(v, fn, next);
};
// literal class words of a dynamic class expression: 'card-paid' and 'a b' in if ... then 'x' else ''
const dynWords = expr => [...String(expr || "").matchAll(/'((?:[^']|'')*)'/g)].flatMap(m => m[1].split(/\s+/)).filter(w => /^-?[_a-zA-Z][\w-]*$/.test(w));

// design property value -> its CSS classes (any widget type with that property name)
function designClasses(dir, key, value) {
    const defs = require("./design").definitions(dir);
    for (const list of defs.values()) {
        const d = list.find(p => p.name === key || (p.oldNames || []).includes(key));
        if (!d) continue;
        if (d.type === "Toggle") return d.class ? String(d.class).split(/\s+/) : [];
        const opt = (d.options || []).find(o => o.name === value || (o.oldNames || []).includes(value));
        return opt && opt.class ? String(opt.class).split(/\s+/) : [];
    }
    return [];
}
function appearanceClasses(dir, a) {
    const out = [];
    for (const c of String(a.Class || "").split(/\s+/).filter(Boolean)) out.push({ cls: c, from: "class" });
    for (const c of dynWords(a.DynamicClasses)) out.push({ cls: c, from: "dynamicClass" });
    for (const dp of a.DesignProperties || []) {
        const v = dp.Value || {};
        if (v.$Type === "Forms$OptionDesignPropertyValue") for (const c of designClasses(dir, dp.Key, v.Option)) out.push({ cls: c, from: `design "${dp.Key}"` });
        else if (v.$Type === "Forms$ToggleDesignPropertyValue") for (const c of designClasses(dir, dp.Key, null)) out.push({ cls: c, from: `design "${dp.Key}"` });
    }
    return out;
}

// new or changed Appearance objects of the pages, snippets and layouts the change created or changed
function changedAppearances(client) {
    const ch = client.changes;
    if (!ch) return [];
    const { toPlain } = require("./convert");
    const bson = require("./bson");
    const out = [];
    const ids = [...new Set([...ch.updated, ...ch.created.keys()])].filter(id => !ch.deleted.has(id));
    for (const id of ids) {
        let u;
        try {
            u = client.project.read(id);
        } catch (e) {
            continue;
        }
        if (!/^Forms\$(Page|Snippet|Layout|BuildingBlock|PageTemplate)$/.test(u.$Type)) continue;
        const old = new Map();
        if (!ch.created.has(id)) {
            try {
                plainWalk(toPlain(bson.decode(client.project.readBytes(id))), o => o.$ID && old.set(o.$ID, JSON.stringify(o)));
            } catch (e) {
                /* new unit */
            }
        }
        const doc = client.label(id);
        plainWalk(u, (o, parent) => {
            if (o.$Type !== "Forms$Appearance") return;
            if (old.has(o.$ID) && old.get(o.$ID) === JSON.stringify(o)) return;
            out.push({ doc, widget: (parent && parent.Name) || "(page)", a: o });
        });
    }
    return out;
}

// every Appearance of every page, snippet and layout (for "defined but unused" and the design property usages)
function allAppearances(client) {
    const out = [];
    for (const [id, x] of client.project.units) {
        if (x.containmentName !== "Documents") continue;
        let u;
        try {
            u = client.project.read(id);
        } catch (e) {
            continue;
        }
        if (!/^Forms\$(Page|Snippet|Layout|BuildingBlock|PageTemplate)$/.test(u.$Type)) continue;
        const doc = client.label(id);
        plainWalk(u, (o, parent) => o.$Type === "Forms$Appearance" && out.push({ doc, widget: (parent && parent.Name) || "(page)", a: o }));
    }
    return out;
}

// ------------------------------------------------ design module (ds-theme.js)

// { module, folder, prefix } of the app's design modules (own modules whose web/main.scss has the @ds-prefix header)
function designModules(client, model) {
    const out = [];
    for (const m of model ? model.allModules() : []) {
        if (m.fromAppStore) continue;
        const folder = `themesource/${m.name.toLowerCase()}/web`;
        const b = files.current(client, `${folder}/main.scss`);
        const hit = b && MARK.exec(b.toString("utf8"));
        if (hit) out.push({ module: m.name, folder, prefix: hit[1] });
    }
    return out;
}

// ------------------------------------------------ Atlas variable values (no compile)

function scssVars(client, rels) {
    const out = {};
    for (const rel of rels) {
        const b = files.current(client, rel);
        if (!b) continue;
        for (const m of b.toString("utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^\s*\$([\w-]+)\s*:\s*([^;]*?)\s*(!default)?\s*;/gm)) if (!(m[1] in out) || !m[3]) out[m[1]] = m[2].trim();
    }
    const res = v => {
        for (let i = 0; i < 6 && /^\$[\w-]+$/.test(String(v)); i++) v = out[String(v).slice(1)];
        return v;
    };
    return Object.fromEntries(Object.keys(out).map(k => [k, res(out[k])]));
}

// ------------------------------------------------ the check

// opts: { strict, mode ("warn": compile errors do not block) }
// -> { lines: [ "! ..." ], errors: n, compiled }
async function styleCheck(client, model, opts = {}) {
    const dir = client.project.dir;
    const ps = model && model.allProjectSettings()[0];
    if (ps && !ps.isLoaded) await ps.load(); // the theme module order
    const staged = [...(client.fileChanges || new Map()).entries()].filter(([, e]) => !(e.before && e.after && e.before.equals(e.after)));
    const themeChanged = staged.filter(([rel]) => /^theme(source)?\//.test(rel));
    const scssChanged = themeChanged.some(([rel]) => /\.(scss|css)$/i.test(rel));
    const appearances = changedAppearances(client);
    const lines = [], infos = [];
    let errors = 0;
    if (!scssChanged && !appearances.length && !themeChanged.length) return { lines, errors };
    const err = s => {
        lines.push(s);
        errors++;
    };
    const warn = s => lines.push(`(warning) ${s}`);
    const info = s => infos.push(`(info) ${s}`);
    let after = null;
    // 1. compile
    if (scssChanged) {
        after = compile(client, model);
        if (after.skipped) info(`compile skipped: ${after.skipped}`);
        else if (!after.ok) {
            const before = compile(client, model, { disk: true });
            if (!before.ok && before.error && before.error.message === after.error.message) warn(`the theme does not compile, as before this change: ${after.error.text}`);
            else if (opts.mode === "warn") warn(`the theme would not compile ("styleCheck": "warn"): ${after.error.text}`);
            else err(`the theme would not compile: ${after.error.text}`);
        } else {
            const dep = [...after.deprecations.values()].reduce((a, b) => a + b, 0);
            info(`compiled: ${after.modules.length} module main.scss + theme/web/main.scss, ${(after.css.length / 1024).toFixed(0)} KB CSS${dep ? `; ${dep} Sass deprecation warning(s) (${[...after.deprecations.keys()].slice(0, 4).join(", ")}): Studio Pro compiles them too` : ""}`);
            for (const w of after.warnings.slice(0, 5)) info(`@warn ${w}`);
        }
    }
    const ds = designModules(client, model);
    // 2. classes of new or changed widgets
    if (appearances.length) {
        const known = after && after.ok ? { classes: classesOf(after.css), compiled: true } : diskTheme(client, model);
        if (!(after && after.ok) && scssChanged) for (const [rel, e] of themeChanged) if (e.after && /\.(scss|css)$/i.test(rel)) for (const c of textClasses(e.after.toString("utf8"))) known.classes.add(c);
        const missing = new Map();
        for (const { doc, widget, a } of appearances) {
            for (const { cls, from } of appearanceClasses(dir, a)) if (!known.classes.has(cls)) missing.set(`${doc} ${widget}|${cls}`, { doc, widget, cls, from });
            if (String(a.Style || "").trim()) warn(`${doc} ${widget}: inline style "${String(a.Style).trim().slice(0, 60)}": use a class with token values instead (addComponentStyle with var(--${ds[0] ? ds[0].prefix : "co-"}...) / $${ds[0] ? ds[0].prefix : "co-"}... tokens), so the look stays in one place`);
        }
        const { suggest } = require("./ops-util");
        for (const m of [...missing.values()].slice(0, 12)) {
            const s = suggest(m.cls, [...known.classes], 3);
            warn(`${m.doc} ${m.widget}: class '${m.cls}' (${m.from}) is defined by no theme SCSS${known.compiled ? "" : " (searched the SCSS text)"}${s.length ? `; did you mean ${s.join(", ")}?` : ""}; add it with addComponentStyle (or addCssClass)`);
        }
        if (missing.size > 12) warn(`... ${missing.size - 12} more classes defined by no theme SCSS`);
    }
    // 3. the design module's own classes: Atlas clashes without the prefix, unused prefixed ones
    for (const d of ds) {
        const own = themeChanged.filter(([rel, e]) => rel.startsWith(d.folder + "/") && e.after && /\.scss$/i.test(rel));
        if (!own.length) continue;
        const atlas = new Set();
        for (const m of model.allModules().filter(x => x.fromAppStore)) for (const rel of scssUnder(dir, `themesource/${m.name.toLowerCase()}/web`)) for (const c of textClasses(fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8"))) atlas.add(c);
        const mine = new Set();
        for (const [rel, e] of own) {
            const before = e.before ? textClasses(e.before.toString("utf8")) : new Set();
            for (const c of textClasses(e.after.toString("utf8"))) {
                mine.add(c);
                if (!c.startsWith(d.prefix) && atlas.has(c) && !before.has(c)) warn(`${rel}: class .${c} is an Atlas class too and has no ${d.prefix} prefix: your rule changes every Atlas widget that uses it; name it ${d.prefix}${c} (or say so if overriding Atlas is the point)`);
            }
        }
        const used = new Set();
        for (const { a } of allAppearances(client)) for (const { cls } of appearanceClasses(dir, a)) used.add(cls);
        const unused = [...mine].filter(c => c.startsWith(d.prefix) && !used.has(c) && !/-dark$|-light$/.test(c));
        if (unused.length) info(`${d.module}: ${unused.length} ${d.prefix} class(es) no widget uses yet: ${unused.slice(0, 8).join(", ")}${unused.length > 8 ? ", ..." : ""}`);
    }
    // 4. contrast: token pairs (tokens.json of a design module changed) and Atlas variable pairs (custom-variables)
    const contrastLine = (j, where) => {
        const msg = `${where}${j.label}: contrast ${j.ratio.toFixed(2)}:1, ${j.kind === "surface" ? "nested surfaces blend into each other (make the levels differ)" : `WCAG AA needs ${j.need}:1`}`;
        if (opts.strict && j.kind !== "surface") err(`${msg} (strict)`);
        else warn(msg);
    };
    for (const d of ds) {
        const e = staged.find(([rel]) => rel === `${d.folder}/tokens/tokens.json`);
        if (!e || !e[1].after) continue;
        let t;
        try {
            t = JSON.parse(e[1].after.toString("utf8"));
        } catch (x) {
            continue;
        }
        const res = T.judge(T.tokenPairs(t));
        for (const j of res.filter(x => !x.ok)) contrastLine(j, `tokens ${d.module}: `);
        if (res.every(x => x.ok)) info(`tokens ${d.module}: all ${res.length} text/background pairs pass WCAG AA`);
    }
    if (staged.some(([rel]) => /^theme\/web\/custom-variables\.scss$/.test(rel))) {
        let now, was;
        if (after && after.ok) now = rootVars(after.css);
        const varFiles = ["theme/web/custom-variables.scss", ...model.allModules().filter(m => m.name === "Atlas_Core").map(() => "themesource/atlas_core/web/_variables.scss")];
        if (!now || !Object.keys(now).length) now = scssVars(client, varFiles);
        was = diskTheme(client, model).vars;
        if (!was || !Object.keys(was).length) was = scssVars({ project: client.project, fileChanges: new Map() }, varFiles);
        const pairs = T.ATLAS_PAIRS.map(([f, b]) => ({ label: `$${f} on $${b}`, fg: now[f], bg: now[b], need: 4.5, was: [was[f], was[b]] }));
        const res = T.judge(pairs.filter(p => p.fg && p.bg));
        const fresh = res.filter(j => !j.ok && (j.was[0] !== j.fg || j.was[1] !== j.bg));
        for (const j of fresh) contrastLine(j, "Atlas ");
        const old = res.filter(j => !j.ok && !fresh.includes(j));
        if (old.length) info(`Atlas: ${old.length} variable pair(s) below WCAG AA, as before this change: ${old.map(j => `${j.label} ${j.ratio.toFixed(2)}`).join(", ")}`);
    }
    return { lines: [...lines, ...infos], errors, compiled: after && after.ok ? after : null };
}

module.exports = { styleCheck, compile, uiOrder, webPart, mainFiles, classesOf, rootVars, textClasses, designModules, allAppearances, appearanceClasses, dynWords, MARK, diskTheme };
