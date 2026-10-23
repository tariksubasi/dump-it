"use strict";
// Marketplace packages (.mpk zip files):
//   widget package: package.xml <clientModule> + widget XML/JS -> copied into widgets/
//   module package: package.xml <modelerProject><module name=..> + project.mpr (an MPR v1 with the module's units in a
//   Contents column, under a stand-in project unit) + javasource/, userlib/, vendorlib/, themesource/, widgets/ files.
// A module is imported by adding its units (same ids) to the MPR v2 under this project's root, as Studio Pro does,
// and copying its files; everything goes through the dry run, approval code, backup and restore.
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const bson = require("./bson");
const { toPlain, guidToString, guidToBytes } = require("./convert");
const { unzip, parseXml } = require("./pluggable");
const files = require("./files");
const { fail } = require("./ops-util");

const FILE_ROOTS = ["javasource", "javascriptsource", "userlib", "vendorlib", "themesource", "widgets", "resources"];
const STUDIO_PRO = "Import it in Studio Pro instead: App Explorer > right-click the app > Import module package > pick the .mpk (Studio Pro converts it to this Mendix version)";

const MARKET_OPS = {
    importWidget: {
        doc: "Install a widget package (.mpk) into the app's widgets/ folder and report its widget type(s).",
        fields: {
            file: "R path to the .mpk, inside the export folder (e.g. downloads/Badge.mpk)",
            replace: "optional true: replace the installed package of the same widget (another version)"
        }
    },
    importModulePackage: {
        doc: "Import a Marketplace module package (.mpk): the module's documents with their ids, Java sources, libraries, theme and widgets, as Studio Pro's Import module package does.",
        fields: { file: "R path to the module .mpk, inside the export folder" }
    },
    exportModulePackage: {
        doc: "Export a module as a module package (.mpk) Studio Pro can import: its documents (same ids), javasource/ and javascriptsource/ of the module, its theme (themesource/<module>), the userlib jars marked for it (.RequiredLib) and the widget packages its pages use. Writes the .mpk into the project folder (default packages/<Module>.mpk) with the change.",
        fields: { module: "R module name", file: "optional output path in the project folder, e.g. packages/Sales_1.0.0.mpk (default packages/<Module>.mpk)" }
    },
    updateModulePackage: {
        doc: "Update an installed module from a module package (.mpk), as Studio Pro's Import module package > Replace: lists documents added, removed and changed (and what of the app still uses removed ones); with replace: true the module's units and files are replaced.",
        fields: { file: "R path to the module .mpk, inside the export folder", replace: "optional true: replace the module (without it the op only reports the differences and is refused)" }
    }
};

const ver = s => String(s || "").split(".").slice(0, 3).map(Number);
const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    return 0;
};
const kid = (el, tag) => el && el.children.find(c => c.tag === tag);
const kids = (el, tag) => (el ? el.children.filter(c => c.tag === tag) : []);

// What a .mpk holds: { kind: "widget" | "module", zip, name, version, widgets: [{id, name, pluggable, platform}], projectFile, files }
function readPackage(file) {
    const zip = unzip(file);
    const pkgXml = zip.get("package.xml");
    if (!pkgXml) throw new Error(`${path.basename(file)} has no package.xml; it is not a Mendix package`);
    const pkg = parseXml(pkgXml().toString("utf8")).children.find(c => c.tag === "package");
    const cm = kid(pkg, "clientModule");
    if (cm) {
        const widgets = [];
        for (const wf of kids(kid(cm, "widgetFiles"), "widgetFile")) {
            const read = zip.get(wf.attrs.path);
            const w = read && parseXml(read().toString("utf8")).children.find(c => c.tag === "widget");
            if (w && w.attrs.id) widgets.push({ id: w.attrs.id, name: (kid(w, "name") || { text: "" }).text.trim(), pluggable: w.attrs.pluginWidget === "true", platform: w.attrs.supportedPlatform || "Web", offline: w.attrs.offlineCapable === "true" });
        }
        return { kind: "widget", zip, name: cm.attrs.name, version: cm.attrs.version || "", widgets };
    }
    const mp = kid(pkg, "modelerProject");
    if (!mp) throw new Error(`${path.basename(file)}: package.xml has neither a widget (clientModule) nor a module (modelerProject)`);
    const mod = kid(mp, "module");
    const pf = kid(mp, "projectFile");
    return {
        kind: mod ? "module" : "project", zip, name: mod ? mod.attrs.name : null,
        projectFile: pf ? pf.attrs.path : "project.mpr",
        files: kids(kid(mp, "files"), "file").map(f => f.attrs.path)
    };
}

// The units of a module package's project.mpr: { meta, units: [{ id, containerId, containmentName, bytes, plain }] }
function readUnits(pkg, where) {
    const read = pkg.zip.get(pkg.projectFile);
    if (!read) throw new Error(`${where}: the package has no ${pkg.projectFile}`);
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-mpk-")), "project.mpr");
    fs.writeFileSync(tmp, read());
    try {
        const db = new DatabaseSync(tmp, { readOnly: true });
        try {
            const meta = db.prepare("select * from _MetaData").get();
            const cols = db.prepare("pragma table_info(Unit)").all().map(c => c.name);
            if (!cols.includes("Contents")) throw new Error(`${where}: the package's ${pkg.projectFile} keeps its units in mprcontents (MPR v2); only packages exported by Studio Pro (units inside the .mpr) are supported. ${STUDIO_PRO}`);
            const units = db.prepare("select UnitID, ContainerID, ContainmentName, Contents from Unit").all().map(r => {
                const id = guidToString(Buffer.from(r.UnitID));
                const c = r.ContainerID ? guidToString(Buffer.from(r.ContainerID)) : null;
                const bytes = Buffer.from(r.Contents);
                return { id, containerId: c === id ? null : c, containmentName: r.ContainmentName, bytes, plain: toPlain(bson.decode(bytes)) };
            });
            return { meta, units };
        } finally {
            db.close();
        }
    } finally {
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
}

// Element types and keys of a unit tree: Map type -> Set(keys)
function shapes(plain, out = new Map()) {
    if (Array.isArray(plain)) plain.forEach(x => shapes(x, out));
    else if (plain && typeof plain === "object" && !Buffer.isBuffer(plain)) {
        if (plain.$Type) {
            const s = out.get(plain.$Type) || new Set();
            for (const k of Object.keys(plain)) if (k[0] !== "$") s.add(k);
            out.set(plain.$Type, s);
        }
        for (const v of Object.values(plain)) shapes(v, out);
    }
    return out;
}

function makeMarket({ client, model }) {
    const project = client.project;
    const dir = project.dir;

    // An .mpk the agent names: inside the export folder (the change file's parent folders) or the project folder.
    function packagePath(p, where) {
        if (typeof p !== "string" || !p.trim()) throw new Error(`${where}: file is empty`);
        const bases = [];
        if (client.changeFile) bases.push(path.dirname(client.changeFile), path.dirname(path.dirname(client.changeFile)));
        bases.push(dir, process.cwd());
        const cands = path.isAbsolute(p) ? [path.resolve(p)] : bases.map(b => path.resolve(b, p));
        const inside = f => bases.some(b => {
            const r = path.relative(fs.realpathSync(b), f);
            return r && !r.startsWith("..") && !path.isAbsolute(r);
        });
        const hit = cands.find(f => fs.existsSync(f) && fs.statSync(f).isFile());
        if (!hit) throw new Error(`${where}: no file '${p}' (looked in ${[...new Set(bases)].join(", ")}); put the .mpk in the export folder`);
        const real = fs.realpathSync(hit);
        if (!inside(real)) throw new Error(`${where}: '${p}' is outside the export and project folders; copy the .mpk into the export folder first`);
        if (!/\.mpk$/i.test(real)) throw new Error(`${where}: '${p}' is not a .mpk file`);
        return real;
    }

    // widgets/*.mpk now (with this change's staged files): widget id -> file name
    function installedWidgets() {
        const out = new Map();
        const wd = path.join(dir, "widgets");
        const names = new Set(fs.existsSync(wd) ? fs.readdirSync(wd).filter(f => /\.mpk$/i.test(f)) : []);
        for (const [rel] of client.fileChanges || []) if (/^widgets\/[^/]+\.mpk$/i.test(rel)) names.add(rel.slice(8));
        for (const f of names) {
            const b = files.current(client, `widgets/${f}`);
            if (!b) continue;
            const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-w-")), f);
            try {
                fs.writeFileSync(tmp, b);
                const pkg = readPackage(tmp);
                for (const w of pkg.widgets || []) out.set(w.id, { file: f, version: pkg.version });
            } catch {
                // unreadable package: ignore it
            } finally {
                fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
            }
        }
        return out;
    }

    async function importWidget(o) {
        const where = `importWidget ${o.file}`;
        const file = packagePath(o.file, where);
        const pkg = readPackage(file);
        if (pkg.kind !== "widget") throw new Error(`${where}: this is a ${pkg.kind} package; use importModulePackage`);
        if (!pkg.widgets.length) throw new Error(`${where}: package.xml lists no widget`);
        const name = path.basename(file);
        const rel = `widgets/${name}`;
        const bytes = fs.readFileSync(file);
        const replace = o.replace === true || o.replace === "true";
        const inst = installedWidgets();
        const notes = [];
        for (const w of pkg.widgets) {
            const have = inst.get(w.id);
            if (!have) continue;
            if (have.file === name && files.current(client, rel) && files.current(client, rel).equals(bytes)) throw new Error(`${where}: ${w.id} ${pkg.version} is already installed as ${rel}`);
            if (!replace) throw new Error(`${where}: ${w.id} is already installed (widgets/${have.file}, version ${have.version || "?"}); give "replace": true to install ${pkg.version} instead`);
            if (have.file !== name) files.stage(client, `widgets/${have.file}`, null);
            notes.push(`replaces widgets/${have.file} ${have.version}`);
            if (cmp(ver(pkg.version), ver(have.version)) < 0) client.warn(`${where}: ${pkg.version} is older than the installed ${have.version}`);
        }
        const existing = files.current(client, rel);
        if (existing && !replace && !existing.equals(bytes)) throw new Error(`${where}: ${rel} exists with other contents; give "replace": true`);
        files.stage(client, rel, bytes);
        client.warn(`${where}: Studio Pro loads it when the app opens (or App > Synchronize App Directory, F4)${notes.length ? "; pages using the widget then ask to update it (Update all widgets)" : ""}`);
        const kinds = pkg.widgets.map(w => `${w.id} "${w.name}" (${w.pluggable ? "pluggable" : "custom (classic)"} widget, ${w.platform}${w.offline ? ", offline capable" : ""})`);
        return `${rel}: ${pkg.name} ${pkg.version}: ${kinds.join("; ")}${notes.length ? ` (${notes.join(", ")})` : ""}`;
    }

    // Units of this project's root: the project unit
    function rootId() {
        for (const u of project.units.values()) if (!u.containerId && project.read(u.id).$Type === "Projects$Project") return u.id;
        throw new Error("this project has no Projects$Project unit");
    }

    async function importModulePackage(o) {
        const where = `importModulePackage ${o.file}`;
        const file = packagePath(o.file, where);
        const pkg = readPackage(file);
        if (pkg.kind === "widget") throw new Error(`${where}: this is a widget package; use importWidget`);
        if (pkg.kind !== "module") throw new Error(`${where}: this is an app package (.mpk of a whole app), not a module. ${STUDIO_PRO.replace("Import module package", "Import app package")}`);
        const { meta, units } = readUnits(pkg, where);
        const theirs = ver(meta._ProductVersion), mine = ver(project.meta._ProductVersion);
        if (cmp(theirs, mine) > 0) throw new Error(`${where}: the package is for Mendix ${meta._ProductVersion}, newer than this app (${project.meta._ProductVersion}); use a package version made for Mendix ${mine.join(".")} or older, or upgrade the app in Studio Pro`);
        const mods = units.filter(u => u.plain.$Type === "Projects$ModuleImpl" && u.containmentName === "Modules");
        if (mods.length !== 1) throw new Error(`${where}: the package has ${mods.length} modules; only one-module packages are supported. ${STUDIO_PRO}`);
        const mod = mods[0];
        const name = mod.plain.Name;
        if (pkg.name && pkg.name !== name) throw new Error(`${where}: package.xml names module ${pkg.name}, its model has ${name}`);
        const existing = model.allModules().find(m => m.name.toLowerCase() === name.toLowerCase());
        if (existing) throw new Error(`${where}: the app already has a module ${existing.name}${existing.appStoreVersion ? ` (version ${existing.appStoreVersion})` : ""}; updating a module replaces it and its changes: ${STUDIO_PRO.replace("Import module package", "Import module package and choose Replace")}`);
        // the module's units: the module and everything under it
        const byContainer = new Map();
        for (const u of units) {
            if (!byContainer.has(u.containerId)) byContainer.set(u.containerId, []);
            byContainer.get(u.containerId).push(u);
        }
        const take = [mod];
        for (let i = 0; i < take.length; i++) take.push(...(byContainer.get(take[i].id) || []));
        const clash = take.filter(u => project.units.has(u.id));
        if (clash.length) throw new Error(`${where}: ${clash.length} unit id(s) of the package are in the app already (${clash.slice(0, 3).map(u => `${u.plain.$Type} ${u.plain.Name || u.id}`).join(", ")}): the module was imported before under another name. ${STUDIO_PRO}`);
        // an older Mendix version: the units must already be stored the way this version stores them
        const sameMinor = theirs[0] === mine[0] && theirs[1] === mine[1];
        if (!sameMinor) {
            const diffs = [];
            const cat = client.catalog;
            for (const [type, keys] of shapes(take.map(u => u.plain))) {
                const known = cat.types.has(type) && !(cat.looseTypes && cat.looseTypes.has(type));
                if (!known) {
                    diffs.push(`${type}: not used in this app, so its stored form cannot be checked`);
                    continue;
                }
                const want = new Set(cat.keys(type).filter(k => k[0] !== "$"));
                const missing = [...want].filter(k => !keys.has(k)), extra = [...keys].filter(k => !want.has(k));
                if (missing.length || extra.length) diffs.push(`${type}: ${missing.length ? "lacks " + missing.slice(0, 3).join(", ") : ""}${missing.length && extra.length ? "; " : ""}${extra.length ? "has old " + extra.slice(0, 3).join(", ") : ""}`);
            }
            if (diffs.length) throw new Error(`${where}: the package is for Mendix ${meta._ProductVersion}; ${diffs.length} element type(s) are stored differently in ${project.meta._ProductVersion} (${diffs.slice(0, 4).join(" | ")}), so it needs Studio Pro's conversion. ${STUDIO_PRO}`);
        }
        // files: the ones package.xml lists, under the folders Studio Pro copies
        const plan = [], conflicts = [], kept = [];
        for (const raw of pkg.files) {
            const rel = path.posix.normalize(String(raw).replace(/\\/g, "/"));
            const read = pkg.zip.get(raw) || pkg.zip.get(rel);
            if (!read || rel.endsWith("/")) continue;
            files.projectPath(dir, rel, FILE_ROOTS, where);
            const bytes = read();
            const now = files.current(client, rel);
            if (now && now.equals(bytes)) continue;
            if (now && rel.startsWith("widgets/")) {
                kept.push(rel);
                continue;
            }
            if (now) conflicts.push(rel);
            else plan.push([rel, bytes]);
        }
        if (conflicts.length) throw new Error(`${where}: ${conflicts.length} file(s) of the package exist with other contents: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? " ..." : ""}. ${STUDIO_PRO}`);
        for (const [rel, bytes] of plan) files.stage(client, rel, bytes);
        if (kept.length) client.warn(`${where}: kept the app's own ${kept.join(", ")} (the package brings another version; update widgets in Studio Pro if needed)`);
        // add the units: the module under this app's project unit, the rest as they were
        const root = rootId();
        for (const u of take) {
            const containerId = u === mod ? root : u.containerId;
            project.units.set(u.id, { id: u.id, containerId, containmentName: u.containmentName, hash: null });
            project.plain.set(u.id, u.plain);
            project.raw = project.raw || new Map();
            project.raw.set(u.id, u.bytes);
            client.changes.created.set(u.id, { containerId, containmentName: u.containmentName });
        }
        // modules the package refers to that the app lacks (by qualified names in its documents)
        const have = new Set([...model.allModules().map(m => m.name), name, "System"]);
        const refs = new Set();
        const scan = v => {
            if (typeof v === "string") {
                const m = /^([A-Z][A-Za-z0-9_]*)\.[A-Za-z_]\w*(\.\w+)*$/.exec(v);
                if (m && !have.has(m[1])) refs.add(m[1]);
            } else if (Array.isArray(v)) v.forEach(scan);
            else if (v && typeof v === "object" && !Buffer.isBuffer(v)) Object.entries(v).forEach(([k, x]) => k !== "Documentation" && scan(x));
        };
        take.forEach(u => scan(u.plain));
        if (refs.size) client.warn(`${where}: ${name} refers to module(s) the app does not have: ${[...refs].slice(0, 8).join(", ")}; import those first (Studio Pro reports the missing references)`);
        const docs = take.filter(u => u.containmentName === "Documents").length;
        const byRoot = {};
        for (const [rel] of plan) byRoot[rel.split("/")[0]] = (byRoot[rel.split("/")[0]] || 0) + 1;
        if (plan.some(([rel]) => rel.startsWith("javasource/"))) client.warn(`${where}: Java sources added; Studio Pro compiles them when the app runs (Deploy for Eclipse/IntelliJ to edit them)`);
        if (!sameMinor) client.warn(`${where}: package for Mendix ${meta._ProductVersion}, stored the same way as ${project.meta._ProductVersion}; check the Errors pane in Studio Pro after opening`);
        const version = mod.plain.AppStoreVersion || (pkg.files.length ? "" : "");
        return `module ${name}${version ? " " + version : ""} (Mendix ${meta._ProductVersion}): ${docs} document(s), ${take.length} unit(s); ${plan.length} file(s)${plan.length ? ` (${Object.entries(byRoot).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}`;
    }

    // ---------------------------------------------------------------- export / update

    // units of module name in this project: [unit] (the module first)
    function moduleUnits(name) {
        const all = [...project.units.values()];
        const mod = all.find(u => u.containmentName === "Modules" && project.read(u.id).Name === name);
        if (!mod) return null;
        const take = [mod];
        for (let i = 0; i < take.length; i++) take.push(...all.filter(u => u.containerId === take[i].id));
        return take;
    }
    // files under dir (posix rel paths)
    function filesUnder(rel) {
        const out = [];
        const walk = r => {
            const full = path.join(dir, ...r.split("/"));
            if (!fs.existsSync(full)) return;
            for (const e of fs.readdirSync(full, { withFileTypes: true })) {
                const sub = `${r}/${e.name}`;
                if (e.isDirectory()) walk(sub);
                else if (e.isFile()) out.push(sub);
            }
        };
        walk(rel);
        return out;
    }
    // widget ids of pluggable / custom widgets in plain unit trees
    function widgetIds(plains) {
        const ids = new Set();
        const walk = v => {
            if (Array.isArray(v)) return v.forEach(walk);
            if (!v || typeof v !== "object" || Buffer.isBuffer(v)) return;
            if (/^CustomWidgets\$CustomWidgetType$/.test(v.$Type || "") && v.WidgetId) ids.add(v.WidgetId);
            for (const x of Object.values(v)) if (x && typeof x === "object") walk(x);
        };
        plains.forEach(walk);
        return ids;
    }

    async function exportModulePackage(o) {
        const where = `exportModulePackage ${o.module}`;
        const name = String(o.module || "");
        const m = model.allModules().find(x => x.name === name);
        if (!m) fail(`${where}: no module '${name}'`, name, model.allModules().map(x => x.name));
        await model.flushChanges();
        const take = moduleUnits(name);
        const pending = take.filter(u => client.changes.updated.has(u.id) || client.changes.created.has(u.id) || (client.changes.moved && client.changes.moved.has(u.id)) || (client.rawUnits && client.rawUnits.has(u.id)));
        if (pending.length) throw new Error(`${where}: earlier ops of this change modify ${name}; the package is made from the saved model. Apply those first, then export in a change of its own`);
        const rel = String(o.file || `packages/${name}.mpk`).replace(/\\/g, "/");
        files.projectPath(dir, rel, ["packages", "deployment", "export"], where);
        if (!/\.mpk$/i.test(rel)) throw new Error(`${where}: file must end in .mpk`);
        const lower = name.toLowerCase();
        const extra = {};
        const add = r => {
            const b = files.current(client, r);
            if (b) extra[r] = b;
        };
        for (const root of ["javasource", "javascriptsource", "themesource"]) filesUnder(`${root}/${lower}`).forEach(add);
        // userlib jars Studio Pro marks as required by this module: <jar>.<Module>.RequiredLib
        const libs = fs.existsSync(path.join(dir, "userlib")) ? fs.readdirSync(path.join(dir, "userlib")) : [];
        for (const f of libs) {
            const mm = new RegExp(`^(.+\\.jar)\\.${name}\\.RequiredLib$`, "i").exec(f);
            if (!mm) continue;
            add(`userlib/${f}`);
            if (libs.includes(mm[1])) add(`userlib/${mm[1]}`);
        }
        // widget packages its pages use
        const ids = widgetIds(take.map(u => project.read(u.id)));
        const inst = installedWidgets();
        const missing = [];
        for (const id of ids) {
            const w = inst.get(id);
            if (w) add(`widgets/${w.file}`);
            else missing.push(id);
        }
        if (missing.length) client.warn(`${where}: no widgets/*.mpk for ${missing.join(", ")} (built-in or missing): the importing app needs them`);
        if (m.fromAppStore) client.warn(`${where}: ${name} is a Marketplace module; share the Marketplace version instead of a copy where you can`);
        const bytes = exportModule(project, name, extra);
        files.stage(client, rel, bytes);
        const docs = take.filter(u => u.containmentName === "Documents").length;
        const byRoot = {};
        for (const r of Object.keys(extra)) byRoot[r.split("/")[0]] = (byRoot[r.split("/")[0]] || 0) + 1;
        client.warnFirst(`exportModulePackage first use: the .mpk follows importModulePackage's reader (project.mpr with the units + package.xml); import ${rel} in Studio Pro once (App Explorer > right-click the app > Import module package) to check it`);
        return `${rel}: module ${name} (Mendix ${project.meta._ProductVersion}): ${docs} document(s), ${take.length} unit(s), ${Object.keys(extra).length} file(s)${Object.keys(extra).length ? ` (${Object.entries(byRoot).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}, ${(bytes.length / 1024).toFixed(0)} KB`;
    }

    async function updateModulePackage(o) {
        const where = `updateModulePackage ${o.file}`;
        const file = packagePath(o.file, where);
        const pkg = readPackage(file);
        if (pkg.kind !== "module") throw new Error(`${where}: this is a ${pkg.kind} package; ${pkg.kind === "widget" ? "use importWidget with \"replace\": true" : STUDIO_PRO}`);
        const { meta, units } = readUnits(pkg, where);
        const theirs = ver(meta._ProductVersion), mine = ver(project.meta._ProductVersion);
        if (theirs[0] !== mine[0] || theirs[1] !== mine[1]) throw new Error(`${where}: the package is for Mendix ${meta._ProductVersion}, this app is ${project.meta._ProductVersion}; an update needs a package of the same minor version. ${STUDIO_PRO}`);
        const mods = units.filter(u => u.plain.$Type === "Projects$ModuleImpl" && u.containmentName === "Modules");
        if (mods.length !== 1) throw new Error(`${where}: the package has ${mods.length} modules; only one-module packages are supported. ${STUDIO_PRO}`);
        const mod = mods[0];
        const name = mod.plain.Name;
        const have = moduleUnits(name);
        if (!have) throw new Error(`${where}: the app has no module ${name}; install it with importModulePackage`);
        const byContainer = new Map();
        for (const u of units) {
            if (!byContainer.has(u.containerId)) byContainer.set(u.containerId, []);
            byContainer.get(u.containerId).push(u);
        }
        const take = [mod];
        for (let i = 0; i < take.length; i++) take.push(...(byContainer.get(take[i].id) || []));
        const appMod = have[0];
        // the package's module unit takes the app module's place (its id may differ)
        const newIds = new Map(take.map(u => [u.id === mod.id ? appMod.id : u.id, u]));
        const oldIds = new Map(have.map(u => [u.id, u]));
        const foreign = take.filter(u => u !== mod && project.units.has(u.id) && !oldIds.has(u.id));
        if (foreign.length) throw new Error(`${where}: ${foreign.length} unit id(s) of the package belong to other modules of the app (${foreign.slice(0, 3).map(u => u.plain.Name || u.id).join(", ")}). ${STUDIO_PRO}`);
        const label = (plain, id) => `${String(plain.$Type).split("$").pop()} ${plain.Name || id.slice(0, 8)}`;
        const added = [], removed = [], changed = [];
        for (const [id, u] of newIds) {
            if (!oldIds.has(id)) {
                if (u.containmentName === "Documents" || u.containmentName === "Folders") added.push(label(u.plain, id));
            } else if (!project.readBytes(id).equals(u.bytes) && id !== appMod.id) changed.push(label(u.plain, id));
        }
        for (const [id, u] of oldIds) if (!newIds.has(id) && (u.containmentName === "Documents" || u.containmentName === "Folders")) removed.push(label(project.read(id), id));
        // what of the rest of the app uses removed documents
        await model.flushChanges();
        const g = require("./refs").graph(client);
        const removedNames = [...oldIds].filter(([id]) => !newIds.has(id)).map(([id]) => project.read(id)).filter(pl => pl.Name).map(pl => `${name}.${pl.Name}`);
        const users = new Set();
        for (const qn of removedNames) for (const e of g.usesOf(qn, false)) if (!oldIds.has(e.unit)) users.add(`${e.doc} (${qn})`);
        // entities: dropped ones lose their table
        const entities = pl => new Set(((pl && pl.Entities) || []).map(e => e.Name));
        const dmOld = have.find(u => project.read(u.id).$Type === "DomainModels$DomainModel");
        const dmNew = take.find(u => u.plain.$Type === "DomainModels$DomainModel");
        const lostEntities = dmOld && dmNew ? [...entities(project.read(dmOld.id))].filter(e => !entities(dmNew.plain).has(e)) : [];
        const version = mod.plain.AppStoreVersion || "";
        const report = [`${name}${version ? ` -> ${version}` : ""}: ${added.length} added, ${removed.length} removed, ${changed.length} changed document(s)`,
            ...(added.length ? [`ADDED: ${added.slice(0, 20).join(", ")}${added.length > 20 ? ", ..." : ""}`] : []),
            ...(removed.length ? [`REMOVED: ${removed.slice(0, 20).join(", ")}${removed.length > 20 ? ", ..." : ""}`] : []),
            ...(changed.length ? [`CHANGED: ${changed.slice(0, 20).join(", ")}${changed.length > 20 ? ", ..." : ""}`] : []),
            ...(users.size ? [`STILL USED BY (fix these after the update): ${[...users].slice(0, 12).join(", ")}`] : []),
            ...(lostEntities.length ? [`DATA LOSS: entities ${lostEntities.join(", ")} are gone from the package; their tables are dropped when the app next starts`] : [])];
        if (!(o.replace === true || o.replace === "true")) throw new Error(`REFUSED (nothing changed): ${report.join("\n      ")}\n      Give "replace": true to replace ${name} (its own changes in this app are lost)`);
        // files: the package's files replace the app's (javasource etc. of the module)
        const plan = [];
        for (const raw of pkg.files) {
            const rel = path.posix.normalize(String(raw).replace(/\\/g, "/"));
            const read = pkg.zip.get(raw) || pkg.zip.get(rel);
            if (!read || rel.endsWith("/")) continue;
            files.projectPath(dir, rel, FILE_ROOTS, where);
            const bytes = read();
            const now = files.current(client, rel);
            if (now && now.equals(bytes)) continue;
            plan.push([rel, bytes]);
        }
        for (const [rel, bytes] of plan) files.stage(client, rel, bytes);
        // units: removed, changed, added (the module unit keeps its id and place)
        project.raw = project.raw || new Map();
        for (const [id] of oldIds) {
            if (newIds.has(id)) continue;
            project.units.delete(id);
            client.changes.updated.delete(id);
            client.changes.deleted.add(id);
        }
        for (const [id, u] of newIds) {
            if (u === mod) continue; // the app's module unit stays (its id, name and place)
            const containerId = u.containerId === mod.id ? appMod.id : u.containerId;
            const plain = u.plain;
            const bytes = u.bytes;
            project.plain.set(id, plain);
            project.raw.set(id, bytes);
            if (oldIds.has(id)) {
                const old = project.units.get(id);
                if (old.containerId !== containerId || old.containmentName !== u.containmentName) {
                    client.changes.moved = client.changes.moved || new Map();
                    client.changes.moved.set(id, { containerId, containmentName: u.containmentName });
                }
                project.units.set(id, { ...old, containerId, containmentName: u.containmentName });
                client.changes.updated.add(id);
            } else {
                project.units.set(id, { id, containerId, containmentName: u.containmentName, hash: null });
                client.changes.created.set(id, { containerId, containmentName: u.containmentName });
            }
        }
        client.warn(`${where}: ${name} replaced from the package; Studio Pro reloads it when the app opens: check the Errors pane`);
        return `${report.join("\n      ")}\n      ${plan.length} file(s) replaced or added`;
    }

    const checks = {
        async exportModulePackage(o) {
            const rel = String(o.file || `packages/${o.module}.mpk`);
            const full = path.join(dir, rel);
            if (!fs.existsSync(full)) return [`${rel} missing`];
            try {
                const pkg = readPackage(full);
                return pkg.kind === "module" && pkg.name === o.module ? [] : [`${rel} is not a module package of ${o.module}`];
            } catch (e) {
                return [`${rel}: ${e.message}`];
            }
        },
        async updateModulePackage(o) {
            let pkg;
            try {
                pkg = readPackage(packagePath(o.file, "check"));
            } catch (e) {
                return [];
            }
            const take = moduleUnits(pkg.name);
            if (!take) return [`module ${pkg.name} is not in the app`];
            const { units } = readUnits(pkg, "check");
            const ids = new Set(take.map(u => u.id));
            const missing = units.filter(u => u.plain.$Type !== "Projects$ModuleImpl" && u.plain.$Type !== "Projects$Project" && !ids.has(u.id));
            return missing.length ? [`${missing.length} unit(s) of the package are not in ${pkg.name}`] : [];
        },
        async importWidget(o) {
            const rel = `widgets/${path.basename(String(o.file))}`;
            return fs.existsSync(path.join(dir, rel)) ? [] : [`${rel} is missing`];
        },
        async importModulePackage(o) {
            let name = null;
            try {
                const pkg = readPackage(packagePath(o.file, "check"));
                name = pkg.name;
            } catch (e) {
                return [];
            }
            return model.allModules().some(m => m.name === name) ? [] : [`module ${name} is not in the app`];
        }
    };

    return { impl: { importWidget, importModulePackage, exportModulePackage, updateModulePackage }, checks };
}

// ---------------------------------------------------------------- writing packages (self test, export)

function crc(b) {
    return zlib.crc32 ? zlib.crc32(b) >>> 0 : (() => {
        let c = ~0;
        for (const x of b) {
            c ^= x;
            for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
        }
        return ~c >>> 0;
    })();
}

// A zip (deflated) of [{ name, data }]
function zip(entries) {
    const parts = [], central = [];
    let off = 0;
    for (const e of entries) {
        const name = Buffer.from(e.name, "utf8");
        const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), "utf8");
        const comp = zlib.deflateRawSync(data);
        const h = Buffer.alloc(30);
        h.writeUInt32LE(0x04034b50, 0);
        h.writeUInt16LE(20, 4);
        h.writeUInt16LE(0x0800, 6);
        h.writeUInt16LE(8, 8);
        h.writeUInt32LE(crc(data), 14);
        h.writeUInt32LE(comp.length, 18);
        h.writeUInt32LE(data.length, 22);
        h.writeUInt16LE(name.length, 26);
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(20, 4);
        c.writeUInt16LE(20, 6);
        c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(8, 10);
        c.writeUInt32LE(crc(data), 16);
        c.writeUInt32LE(comp.length, 20);
        c.writeUInt32LE(data.length, 24);
        c.writeUInt16LE(name.length, 28);
        c.writeUInt32LE(off, 42);
        parts.push(h, name, comp);
        central.push(c, name);
        off += 30 + name.length + comp.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cd, end]);
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// A module package of one module of a (saved) MPR v2 project, as Studio Pro exports it: project.mpr (MPR v1 with the
// project unit and the module's units) + package.xml + the given files ({ rel: Buffer }). version: _ProductVersion.
function exportModule(project, moduleName, extraFiles = {}, version) {
    const units = [...project.units.values()];
    const root = units.find(u => !u.containerId && project.read(u.id).$Type === "Projects$Project");
    const mod = units.find(u => u.containmentName === "Modules" && project.read(u.id).Name === moduleName);
    if (!mod) throw new Error(`no module ${moduleName}`);
    const take = [mod];
    for (let i = 0; i < take.length; i++) take.push(...units.filter(u => u.containerId === take[i].id));
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-exp-")), "project.mpr");
    const db = new DatabaseSync(tmp);
    try {
        db.exec("CREATE TABLE _MetaData (_ProductVersion TEXT, _BuildVersion TEXT, _SchemaHash TEXT)");
        db.exec("CREATE TABLE Unit (UnitID BLOB PRIMARY KEY NOT NULL, ContainerID BLOB, ContainmentName TEXT, TreeConflict LONG, ContentsHash TEXT, ContentsConflicts TEXT, Contents BLOB)");
        const v = version || project.meta._ProductVersion;
        db.prepare("insert into _MetaData values (?, ?, ?)").run(v, v, project.meta._SchemaHash || "");
        const ins = db.prepare("insert into Unit values (?, ?, ?, 0, ?, '', ?)");
        for (const u of [root, ...take]) {
            const bytes = project.readBytes(u.id);
            ins.run(guidToBytes(u.id), guidToBytes(u.containerId || u.id), u.containmentName || "", crypto.createHash("sha256").update(bytes).digest("base64"), bytes);
        }
    } finally {
        db.close();
    }
    const mpr = fs.readFileSync(tmp);
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.mendix.com/package/1.0/">\n  <modelerProject xmlns="http://www.mendix.com/modelerProject/1.0/">\n    <module name="${esc(moduleName)}" />\n    <projectFile path="project.mpr" />\n    <files>\n${Object.keys(extraFiles).map(f => `      <file path="${esc(f)}" />`).join("\n")}\n    </files>\n  </modelerProject>\n</package>`;
    return zip([{ name: "project.mpr", data: mpr }, { name: "package.xml", data: xml }, ...Object.entries(extraFiles).map(([name, data]) => ({ name, data }))]);
}

module.exports = { makeMarket, MARKET_OPS, readPackage, readUnits, exportModule, zip };
