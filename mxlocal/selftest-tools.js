"use strict";
// Self test phases for navigation (menus, profiles), theme files and module/widget packages. Called by selftest.js
// on its temporary copy, between the page edits and the renames.
const sdk = require("mendixmodelsdk");
const { lostProperties } = require("./lost");
const bson = require("./bson");
const fs = require("fs");
const path = require("path");
const { toPlain } = require("./convert");

// A page and a microflow without parameters (menu item targets), and the project's menus.
async function navTargets(model) {
    const own = new Set(model.allModules().filter(m => !m.fromAppStore).map(m => m.name));
    const mod = qn => qn.split(".")[0];
    const sorted = list => list.sort((a, b) => (own.has(mod(b.qualifiedName)) - own.has(mod(a.qualifiedName))) || a.qualifiedName.localeCompare(b.qualifiedName));
    let page = null, flow = null;
    for (const p of sorted(model.allPages())) {
        const l = await p.load();
        if (!l.parameters.length && !l.excluded) {
            page = l;
            break;
        }
    }
    for (const f of sorted(model.allMicroflows())) {
        const l = await f.load();
        if (!l.objectCollection.objects.some(x => x instanceof sdk.microflows.MicroflowParameterObject) && !l.excluded) {
            flow = l;
            break;
        }
    }
    // a layout with exactly one menu widget (for useMenu)
    let layout = null;
    for (const l of sorted(model.allLayouts())) {
        const d = await l.load();
        const ws = [];
        d.traverse(el => {
            if (el instanceof sdk.pages.MenuWidget) ws.push(el);
        });
        if (ws.length === 1 && ws[0].menuSource) {
            layout = d;
            break;
        }
    }
    return { page, flow, layout };
}

// A layout's contents with the $ID of its menu sources dropped (useMenu back creates a new source with a new id).
function noSourceIds(bytes) {
    const walk = o => {
        if (Array.isArray(o)) return o.map(walk);
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return o;
        const out = {};
        for (const [k, v] of Object.entries(o)) out[k] = k === "MenuSource" && v ? { ...walk(v), $ID: null } : walk(v);
        return out;
    };
    return JSON.stringify(walk(toPlain(bson.decode(bytes))));
}

async function encodeWrite(s, layout, ctx) {
    await s.model.flushChanges();
    const enc = s.client.encode();
    const lay = ctx.layoutProblems(layout, enc);
    const lost = lostProperties(s.client, s.model, enc);
    s.client.project.writeEncoded(enc);
    return { enc, lay, lost };
}

async function loadErrors(s) {
    const errs = [];
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => errs.push(e.message));
    await s.model.flushChanges();
    if (s.client.log.length) errs.push(`${s.client.log.length} deltas on open`);
    return errs;
}

// E1: menu items (add with microflow + icon, move, change caption, delete), a menu document shown by a layout's menu
// widget, then everything undone (the navigation document and the layout must be what Studio Pro saved), and a new
// navigation profile for a device type the project lacks.
async function navPhase(ctx) {
    const { copy, reopen, check, results, layout, mod, T } = ctx;
    let s = await reopen(copy);
    const navDoc = s.model.allNavigationDocuments()[0];
    if (!navDoc) return results.push("SKIP navigation: no navigation document");
    const nav = await navDoc.load();
    const resp = nav.profiles.find(p => p instanceof sdk.navigation.NavigationProfile && p.kind && p.kind.name === "Responsive");
    const t = await navTargets(s.model);
    if (!t.page && !t.flow) return results.push("SKIP navigation: no page or microflow without parameters to open");
    const target = t.flow ? { microflow: t.flow.qualifiedName } : { page: t.page.qualifiedName };
    const menuName = `${T}_Menu`;
    const p1 = { ops: [
        { op: "createMenu", module: mod, name: menuName, items: [{ caption: "Zz top", items: [{ caption: "Zz one", ...(t.flow ? target : {}) }, { caption: "Zz two" }] }, { caption: "Zz last" }] },
        { op: "addMenuItem", menu: `${mod}.${menuName}`, parent: "Zz top", before: "Zz two", caption: "Zz added", icon: 57377, ...(t.page ? { page: t.page.qualifiedName } : target) },
        { op: "moveMenuItem", menu: `${mod}.${menuName}`, item: "Zz top/Zz two", parent: "", position: "first" },
        { op: "changeMenuItem", menu: `${mod}.${menuName}`, item: "Zz last", caption: "Zz renamed", icon: "none", ...target },
        { op: "deleteMenuItem", menu: `${mod}.${menuName}`, item: "Zz one" }
    ] };
    const navId = navDoc.id;
    const before = s.ctx.project.readBytes(navId);
    const layoutBefore = t.layout ? s.ctx.project.readBytes(t.layout.id) : null;
    const top = resp && resp.menuItemCollection.items.length ? resp.menuItemCollection.items[0] : null;
    const topCaption = top && top.caption.translations.find(x => x.text) ? top.caption.translations[0].text : null;
    const unique = topCaption && resp.menuItemCollection.items.filter(x => x.caption.translations.some(y => y.text.toLowerCase() === topCaption.toLowerCase())).length === 1;
    const inMenu = qn => (function any(items) {
        return items.some(i => (i.action instanceof sdk.pages.PageClientAction && i.action.pageSettings && i.action.pageSettings.pageQualifiedName === qn) || any(i.items));
    })(resp.menuItemCollection.items);
    if (resp && !t.flow && inMenu(t.page.qualifiedName)) results.push(`SKIP Responsive menu edits: no microflow without parameters, and ${t.page.qualifiedName} is in the menu already`);
    else if (resp) {
        p1.ops.push({ op: "addMenuItem", ...target, caption: "Zz nav", icon: 57377, ...(unique ? { after: topCaption } : {}) });
        if (unique) p1.ops.push({ op: "moveMenuItem", item: "Zz nav", position: "first" }, { op: "changeMenuItem", item: topCaption, caption: "Zz caption" });
    } else results.push("SKIP navigation profile menu edits: no Responsive profile");
    const src = t.layout && t.layout.structureTypeName && (() => {
        let w = null;
        t.layout.traverse(el => {
            if (el instanceof sdk.pages.MenuWidget) w = el;
        });
        return w.menuSource instanceof sdk.pages.MenuDocumentSource ? { menu: w.menuSource.menuQualifiedName } : w.menuSource instanceof sdk.pages.NavigationSource ? { profile: (w.menuSource.navigationProfile || {}).name || "Responsive" } : null;
    })();
    if (src && (src.menu || src.profile)) p1.ops.push({ op: "useMenu", document: t.layout.qualifiedName, menu: `${mod}.${menuName}` });
    else results.push("SKIP useMenu: no layout with exactly one menu widget");
    await s.ops.runPlan(p1, () => {});
    let w = await encodeWrite(s, layout, ctx);
    s = await reopen(copy);
    const failed1 = await s.ops.checkPlan(p1);
    const errs1 = await loadErrors(s);
    const doc = s.ctx.project;
    // stored as Studio Pro: the menu document's items, an item with a glyph icon, a microflow or page action
    const menuUnit = [...doc.units.keys()].map(id => doc.read(id)).find(u => u.$Type === "Menus$MenuDocument" && u.Name === menuName);
    const stored = [];
    if (!menuUnit) stored.push("menu document not stored");
    else {
        const items = menuUnit.ItemCollection.Items;
        const caps = items.map(i => i.Caption.Items[0].Text);
        if (caps.join("|") !== "Zz two|Zz top|Zz renamed") stored.push(`menu top level is ${caps.join(", ")}`);
        const topItem = items.find(i => i.Caption.Items[0].Text === "Zz top");
        const added = topItem && topItem.Items.find(i => i.Caption.Items[0].Text === "Zz added");
        if (!added || !added.Icon || added.Icon.$Type !== "Forms$GlyphIcon" || added.Icon.Code !== 57377) stored.push("added item has no glyph icon 57377");
        if (topItem && topItem.Items.length !== 1) stored.push(`Zz top has ${topItem.Items.length} sub-items, expected 1`);
        const renamed = items.find(i => i.Caption.Items[0].Text === "Zz renamed");
        const want = t.flow ? "Forms$MicroflowAction" : "Forms$FormAction";
        if (!renamed || renamed.Action.$Type !== want || renamed.Icon !== null) stored.push(`changed item is not a ${want} without icon`);
    }
    const all1 = [...w.lay.problems.slice(0, 3), ...w.lost, ...failed1, ...errs1, ...stored];
    check(`navigation: createMenu, addMenuItem into a menu document (glyph icon, before), moveMenuItem (re-order, to the top level), changeMenuItem (caption, action, icon), deleteMenuItem${resp ? ", Responsive menu add/move/change" : ""}${src ? ", useMenu on " + t.layout.qualifiedName : ""}: stored like Studio Pro, reopen 0 errors`, !all1.length, all1.slice(0, 6).join("; "));

    // undo the profile and layout edits: they must be byte for byte what Studio Pro saved
    const p2 = { ops: [] };
    if (resp) {
        p2.ops.push({ op: "deleteMenuItem", item: "Zz nav" });
        if (unique) p2.ops.push({ op: "changeMenuItem", item: "Zz caption", caption: topCaption });
    }
    if (src && (src.menu || src.profile)) p2.ops.push({ op: "useMenu", document: t.layout.qualifiedName, ...src });
    if (p2.ops.length) {
        await s.ops.runPlan(p2, () => {});
        w = await encodeWrite(s, layout, ctx);
        s = await reopen(copy);
        const failed2 = await s.ops.checkPlan(p2);
        const navSame = s.ctx.project.readBytes(navId).equals(before);
        const laySame = !layoutBefore || noSourceIds(layoutBefore) === noSourceIds(s.ctx.project.readBytes(t.layout.id));
        check("navigation undone (deleteMenuItem, changeMenuItem caption back, useMenu back): navigation document byte for byte as Studio Pro saved it, layout the same apart from its menu source", navSame && laySame && !failed2.length,
            [navSame ? "" : "navigation document bytes differ", laySame ? "" : "layout differs outside the menu source", ...failed2].filter(Boolean).join("; "));
    }

    // a navigation profile for a device type the project lacks (Tablet or Phone), with the Responsive menu copied
    const nav2 = await s.model.allNavigationDocuments()[0].load();
    const kinds = nav2.profiles.filter(p => p.kind).map(p => p.kind.name.replace(/Offline$/, ""));
    const kind = ["Phone", "Tablet"].find(k => !kinds.includes(k));
    if (!kind) return results.push("SKIP createNavigationProfile: the project has Phone and Tablet profiles");
    const p3 = { ops: [{ op: "createNavigationProfile", kind, copyMenu: !!resp }] };
    await s.ops.runPlan(p3, () => {});
    w = await encodeWrite(s, layout, ctx);
    s = await reopen(copy);
    const failed3 = await s.ops.checkPlan(p3);
    const nav3 = await s.model.allNavigationDocuments()[0].load();
    const np = nav3.profiles.find(p => p.kind && p.kind.name === kind);
    const r3 = nav3.profiles.find(p => p.kind && p.kind.name === "Responsive");
    const count = items => items.reduce((n, i) => n + 1 + count(i.items), 0);
    const p3x = [];
    if (!np) p3x.push(`no ${kind} profile`);
    else {
        if (np.name !== kind) p3x.push(`profile name ${np.name}`);
        if (r3 && count(np.menuItemCollection.items) !== count(r3.menuItemCollection.items)) p3x.push(`${count(np.menuItemCollection.items)} menu items copied, Responsive has ${count(r3.menuItemCollection.items)}`);
        if (r3 && (np.homePage.pageQualifiedName || np.homePage.microflowQualifiedName) !== (r3.homePage.pageQualifiedName || r3.homePage.microflowQualifiedName)) p3x.push("home page differs from Responsive");
    }
    let dup = "";
    try {
        await s.ops.runPlan({ ops: [{ op: "createNavigationProfile", kind }] }, () => {});
        dup = "a second profile of the same kind was not refused";
    } catch (e) {
        if (!/already has/.test(e.message)) dup = e.message;
    }
    const all3 = [...w.lay.problems.slice(0, 3), ...w.lost, ...failed3, ...p3x, ...(await loadErrors(await reopen(copy))), dup].filter(Boolean);
    check(`createNavigationProfile ${kind}${resp ? " with the Responsive menu" : ""}: stored like Studio Pro (Name, Kind, home page, app title), second one refused`, !all3.length, all3.slice(0, 6).join("; "));
}

// Runs a change file through the real dry run / apply (mxlocal.js), output collected. Returns { lines, code }.
async function cliRun(ctx, plan, name, mpr = ctx.copy) {
    const cli = require("./mxlocal");
    const lines = [];
    cli.setOutput(s => lines.push(String(s)));
    const file = path.join(path.dirname(mpr), "edits", name + ".json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(plan, null, 1));
    try {
        const r = await cli.run(file, mpr, false);
        return { lines, code: r.code };
    } finally {
        cli.setOutput(ctx.out);
    }
}
async function cliDo(ctx, fn) {
    const cli = require("./mxlocal");
    const lines = [];
    cli.setOutput(s => lines.push(String(s)));
    const exit = process.exitCode;
    try {
        await fn(cli);
    } catch (e) {
        lines.push("ERROR: " + e.message);
    } finally {
        cli.setOutput(ctx.out);
        process.exitCode = exit;
    }
    return lines;
}
async function refused(ctx, plan, re) {
    try {
        await cliRun(ctx, plan, "zz-refused");
        return `not refused: ${JSON.stringify(plan.ops[0]).slice(0, 80)}`;
    } catch (e) {
        return re.test(e.message) ? "" : `unexpected error: ${e.message.slice(0, 120)}`;
    }
}

// E4: theme files through dry run (diff), apply (backup), check and restore; refusals outside theme/ themesource/.
async function themePhase(ctx) {
    const { src, copy, check } = ctx;
    const dir = path.dirname(copy);
    for (const d of ["theme", "themesource"]) if (fs.existsSync(path.join(src.dir, d)) && !fs.existsSync(path.join(dir, d))) fs.cpSync(path.join(src.dir, d), path.join(dir, d), { recursive: true });
    const read = rel => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel)) : null);
    const main = "theme/web/main.scss", vars = "theme/web/custom-variables.scss";
    const before = { [main]: read(main), [vars]: read(vars) };
    const ops = [];
    if (!before[main]) ops.push({ op: "editThemeFile", path: main, content: "// app styles\n" });
    ops.push({ op: "addCssClass", name: "zz-card", css: { "background-color": "#fff", padding: "8px" } });
    const brand = before[vars] && /^\$brand-primary:[^\n]*$/m.exec(before[vars].toString("utf8"));
    if (brand) ops.push({ op: "editThemeFile", path: vars, edits: [{ find: brand[0], replace: "$brand-primary: #0a7d32;" }] });
    else ops.push({ op: "editThemeFile", path: main, edits: [{ find: "padding: 8px;", replace: "padding: 12px;" }] });
    const modDir = fs.existsSync(path.join(dir, "themesource")) ? fs.readdirSync(path.join(dir, "themesource")).find(m => fs.existsSync(path.join(dir, "themesource", m, "web", "design-properties.json"))) : null;
    const dp = modDir && `themesource/${modDir}/web/design-properties.json`;
    const dpBefore = dp && read(dp);
    let dpJson = null;
    try {
        dpJson = dpBefore && JSON.parse(dpBefore.toString("utf8"));
    } catch {
        dpJson = null;
    }
    if (dpJson && typeof dpJson === "object") ops.push({ op: "editThemeFile", path: dp, content: JSON.stringify({ ...dpJson, ZzWidget: [{ name: "Zz", type: "Toggle", description: "test", class: "zz-card" }] }, null, 4) + "\n" });
    ops.push({ op: "editThemeFile", path: main, append: "// zz end" });
    const problems = [];
    const dry = await cliRun(ctx, { ops }, "zz-theme");
    if (!dry.code) problems.push("no approval code: " + dry.lines.slice(-3).join(" | "));
    if (!dry.lines.some(l => /^\s+\+ \.zz-card \{$/.test(l))) problems.push("dry run shows no diff line for .zz-card");
    const applied = dry.code ? await cliDo(ctx, cli => cli.apply(copy, dry.code)) : [];
    if (dry.code && !applied.some(l => /^Checked: all/.test(l))) problems.push("apply: " + applied.join(" | ").slice(0, 200));
    const after = read(main);
    if (!after || !/\.zz-card \{\n    background-color: #fff;\n    padding: (8|12)px;\n\}/.test(after.toString("utf8"))) problems.push(`${main} has no .zz-card rule`);
    if (brand && !read(vars).toString("utf8").includes("$brand-primary: #0a7d32;")) problems.push(`${vars} not edited`);
    if (dp && dpJson && !JSON.parse(read(dp).toString("utf8")).ZzWidget) problems.push(`${dp} not edited`);
    // refusals: outside the theme folders, a missing find, JSON that would break, unbalanced braces
    for (const [plan, re] of [
        [{ ops: [{ op: "editThemeFile", path: "../zz-outside.scss", content: "x" }] }, /outside the project folder/],
        [{ ops: [{ op: "editThemeFile", path: "javasource/zz.scss", content: "x" }] }, /not under theme\//],
        [{ ops: [{ op: "editThemeFile", path: main, edits: [{ find: "zz-not-there", replace: "x" }] }] }, /is not in/],
        [{ ops: [{ op: "editThemeFile", path: main, append: ".zz-open {" }] }, /braces/],
        ...(dp ? [[{ ops: [{ op: "editThemeFile", path: dp, append: "{" }] }, /valid JSON|braces/]] : []),
        [{ ops: [{ op: "addCssClass", name: "zz-card", css: "color: red" }] }, /already has a rule/]
    ]) {
        const r = await refused(ctx, plan, re);
        if (r) problems.push(r);
    }
    // undo: every file back byte for byte (a created main.scss removed)
    const undone = await cliDo(ctx, cli => cli.restoreCmd(copy));
    if (!undone.some(l => /^Restored/.test(l))) problems.push("restore: " + undone.join(" | ").slice(0, 200));
    for (const [rel, b] of Object.entries({ ...before, ...(dp ? { [dp]: dpBefore } : {}) })) {
        const now = read(rel);
        if (b === null ? now !== null : !now || !now.equals(b)) problems.push(`${rel} not restored byte for byte`);
    }
    check(`theme files: addCssClass, editThemeFile (find/replace${dp && dpJson ? ", design-properties.json" : ""}, append${before[main] ? "" : ", new main.scss"}) through dry run with diff, apply with backup and check, restore byte for byte; refused outside theme/ themesource/, missing find, broken JSON or braces, duplicate class`, !problems.length, problems.slice(0, 6).join("; "));
}

// H1: widget packages (a new one, the same one again, a replacement) and a module package exported from this app
// (with a Java source and a theme file): imported with the same unit ids and bytes, refused on a name clash or a
// newer Mendix version, and undone byte for byte.
async function packagePhase(ctx) {
    const { copy, check, results, reopen } = ctx;
    const dir = path.dirname(copy);
    const market = require("./marketplace");
    const { Project } = require("./mpr");
    const dl = path.join(dir, "edits", "dl");
    fs.mkdirSync(dl, { recursive: true });
    const problems = [];
    // a widget package of a new widget
    const wid = "com.example.zz.ZzBadge";
    const widgetXml = `<?xml version="1.0" encoding="utf-8"?>\n<widget id="${wid}" pluginWidget="true" offlineCapable="true" xmlns="http://www.mendix.com/widget/1.0/">\n    <name>Zz Badge</name>\n    <description/>\n    <properties><propertyGroup caption="General"><property key="value" type="string" required="false"><caption>Value</caption><description/></property></propertyGroup></properties>\n</widget>\n`;
    const pkgXml = v => `<?xml version="1.0" encoding="utf-8" ?>\n<package xmlns="http://www.mendix.com/package/1.0/">\n    <clientModule name="ZzBadge" version="${v}" xmlns="http://www.mendix.com/clientModule/1.0/">\n        <widgetFiles><widgetFile path="ZzBadge.xml" /></widgetFiles>\n        <files><file path="com/example/zz/" /></files>\n    </clientModule>\n</package>\n`;
    const widget = v => market.zip([{ name: "package.xml", data: pkgXml(v) }, { name: "ZzBadge.xml", data: widgetXml }, { name: "com/example/zz/ZzBadge.js", data: `export function ZzBadge() { return null; } // ${v}` }]);
    fs.writeFileSync(path.join(dl, "ZzBadge.mpk"), widget("1.0.0"));
    fs.writeFileSync(path.join(dl, "ZzBadge-2.mpk"), widget("2.0.0"));
    const w1 = await cliRun(ctx, { ops: [{ op: "importWidget", file: "dl/ZzBadge.mpk" }] }, "zz-widget");
    if (!w1.lines.some(l => l.includes(`${wid} "Zz Badge" (pluggable widget, Web, offline capable)`))) problems.push("importWidget does not report the widget type: " + w1.lines.slice(0, 2).join(" | "));
    const a1 = w1.code ? await cliDo(ctx, cli => cli.apply(copy, w1.code)) : ["no code"];
    if (!a1.some(l => /^Checked: all/.test(l))) problems.push("widget apply: " + a1.join(" | ").slice(0, 160));
    if (!fs.existsSync(path.join(dir, "widgets", "ZzBadge.mpk"))) problems.push("widgets/ZzBadge.mpk not installed");
    for (const [plan, re] of [
        [{ ops: [{ op: "importWidget", file: "dl/ZzBadge.mpk" }] }, /already installed/],
        [{ ops: [{ op: "importWidget", file: "dl/ZzBadge-2.mpk" }] }, /already installed .*replace/],
        [{ ops: [{ op: "importWidget", file: "../../zz-elsewhere.mpk" }] }, /no file|outside/]
    ]) {
        const r = await refused(ctx, plan, re);
        if (r) problems.push(r);
    }
    const w2 = await cliRun(ctx, { ops: [{ op: "importWidget", file: "dl/ZzBadge-2.mpk", replace: true }] }, "zz-widget2");
    const a2 = w2.code ? await cliDo(ctx, cli => cli.apply(copy, w2.code)) : ["no code"];
    if (!a2.some(l => /^Checked: all/.test(l)) || fs.existsSync(path.join(dir, "widgets", "ZzBadge.mpk")) || !fs.existsSync(path.join(dir, "widgets", "ZzBadge-2.mpk"))) problems.push("replace: " + a2.join(" | ").slice(0, 160));
    for (let i = 0; i < 2; i++) await cliDo(ctx, cli => cli.restoreCmd(copy));
    if (fs.existsSync(path.join(dir, "widgets", "ZzBadge.mpk")) || fs.existsSync(path.join(dir, "widgets", "ZzBadge-2.mpk"))) problems.push("widget packages not undone");
    check("importWidget: new widget package installed with its type reported, same one refused, replace with another version, undone; refused outside the export folder", !problems.length, problems.slice(0, 5).join("; "));

    // a module package: create a module, export it, undo, import it back
    const P = "ZzPkg";
    const mk = await cliRun(ctx, { ops: [{ op: "createModule", name: P, roles: ["User"] },
        { op: "createEntity", module: P, name: "Item", attributes: [{ name: "Title", type: "String(200)" }] },
        { op: "createConstant", module: P, name: "Endpoint", type: "String", default: "https://example.com", folder: "Config" },
        { op: "createMicroflow", module: P, name: "ACT_Hello", actions: [{ action: "log", message: "'hello'" }] }] }, "zz-pkg-module");
    const am = mk.code ? await cliDo(ctx, cli => cli.apply(copy, mk.code)) : ["no code: " + mk.lines.join(" | ")];
    const pm = [];
    if (!am.some(l => /^Checked: all/.test(l))) pm.push("create module: " + am.join(" | ").slice(0, 200));
    const proj = new Project(copy);
    const extra = { [`javasource/${P.toLowerCase()}/actions/ZzHello.java`]: "package zzpkg.actions;\npublic class ZzHello {}\n", [`themesource/${P.toLowerCase()}/web/main.scss`]: ".zz-pkg { color: red; }\n" };
    fs.writeFileSync(path.join(dl, "ZzPkg.mpk"), market.exportModule(proj, P, extra));
    const v = proj.meta._ProductVersion.split(".").map(Number);
    fs.writeFileSync(path.join(dl, "ZzPkg-newer.mpk"), market.exportModule(proj, P, extra, `${v[0]}.${v[1] + 1}.0`));
    const mod = [...proj.units.values()].find(u => u.containmentName === "Modules" && proj.read(u.id).Name === P);
    const sub = [mod];
    for (let i = 0; i < sub.length; i++) sub.push(...[...proj.units.values()].filter(u => u.containerId === sub[i].id));
    const orig = new Map(sub.map(u => [u.id, { bytes: proj.readBytes(u.id), containerId: u.containerId, containmentName: u.containmentName, hash: u.hash }]));
    const undo = await cliDo(ctx, cli => cli.restoreCmd(copy));
    if (!undo.some(l => /^Restored/.test(l))) pm.push("undo module: " + undo.join(" | "));
    const fpBefore = new Project(copy).fingerprint();
    const r1 = await refused(ctx, { ops: [{ op: "importModulePackage", file: "dl/ZzPkg-newer.mpk" }] }, /newer than this app/);
    if (r1) pm.push(r1);
    const im = await cliRun(ctx, { ops: [{ op: "importModulePackage", file: "dl/ZzPkg.mpk" }] }, "zz-pkg-import");
    if (!im.lines.some(l => new RegExp(`module ${P} .*${sub.length} unit\\(s\\); 2 file\\(s\\)`).test(l))) pm.push("dry run: " + im.lines.slice(0, 2).join(" | "));
    const ai = im.code ? await cliDo(ctx, cli => cli.apply(copy, im.code)) : ["no code"];
    if (!ai.some(l => /^Checked: all/.test(l))) pm.push("import apply: " + ai.join(" | ").slice(0, 200));
    const after = new Project(copy);
    for (const [id, o] of orig) {
        const u = after.units.get(id);
        if (!u) pm.push(`unit ${id} missing`);
        else if (!after.readBytes(id).equals(o.bytes) || u.hash !== o.hash || u.containerId !== o.containerId || u.containmentName !== o.containmentName) pm.push(`unit ${id} (${after.read(id).$Type}) differs from the exported one`);
    }
    if (after.fingerprint() === fpBefore) pm.push("model unchanged after import");
    for (const [rel, body] of Object.entries(extra)) if (!fs.existsSync(path.join(dir, rel)) || fs.readFileSync(path.join(dir, rel), "utf8") !== body) pm.push(`${rel} not copied`);
    const s = await reopen(copy);
    const errs = await loadErrors(s);
    if (!s.model.allModules().some(m => m.name === P)) pm.push(`module ${P} not in the model`);
    pm.push(...errs);
    const r2 = await refused(ctx, { ops: [{ op: "importModulePackage", file: "dl/ZzPkg.mpk" }] }, /already has a module/);
    if (r2) pm.push(r2);
    const r3 = await refused(ctx, { ops: [{ op: "importModulePackage", file: "dl/ZzBadge.mpk" }] }, /widget package/);
    if (r3) pm.push(r3);
    const back = await cliDo(ctx, cli => cli.restoreCmd(copy));
    if (!back.some(l => /^Restored/.test(l)) || new Project(copy).fingerprint() !== fpBefore || Object.keys(extra).some(rel => fs.existsSync(path.join(dir, rel)))) pm.push("import not undone: " + back.join(" | ").slice(0, 120));
    check(`importModulePackage: module exported from this app (${sub.length} units, a Java source, a theme file) imported with the same unit ids, bytes, containers and hashes; files copied; reopen 0 errors; refused when the module exists, for a newer Mendix version and for a widget package; undone`, !pm.length, pm.slice(0, 6).join("; "));
    if (!results) return;
}

// H2: a git repository with the app, two branches that change the same domain model (a true conflict) and other
// documents (one side each), merged; mergecheck reports the 3-way picture, mergefix + apply rebuild the model.
async function mergePhase(ctx) {
    const { copy, check, results, reopen, mod } = ctx;
    const { execFileSync } = require("child_process");
    const { Project } = require("./mpr");
    const merge = require("./merge");
    const g = path.join(path.dirname(copy), "zz-git");
    const run = (...a) => execFileSync("git", ["-c", "user.name=mxlocal", "-c", "user.email=mxlocal@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: g, stdio: ["ignore", "pipe", "pipe"] }).toString();
    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch {
        return results.push("SKIP merge helper: git is not installed");
    }
    fs.mkdirSync(path.join(g, "app"), { recursive: true });
    fs.copyFileSync(copy, path.join(g, "app", path.basename(copy)));
    fs.cpSync(path.join(path.dirname(copy), "mprcontents"), path.join(g, "app", "mprcontents"), { recursive: true });
    fs.writeFileSync(path.join(g, ".gitignore"), ".mxlocal-backup/\nedits/\n");
    const app = path.join(g, "app", path.basename(copy));
    const problems = [];
    const step = async (plan, name) => {
        const r = await cliRun(ctx, plan, name, app);
        const a = r.code ? await cliDo(ctx, cli => cli.apply(app, r.code)) : ["no code: " + r.lines.slice(-2).join(" | ")];
        if (!a.some(l => /^Checked: all/.test(l))) problems.push(`${name}: ${a.join(" | ").slice(0, 160)}`);
    };
    run("init", "-q");
    run("checkout", "-q", "-b", "zzmain");
    await step({ ops: [{ op: "createEntity", module: mod, name: "ZzMerge", attributes: [{ name: "Title", type: "String(200)" }] }] }, "zz-merge-base");
    run("add", "-A");
    run("commit", "-qm", "base");
    const before = merge.analyse(app).mismatch.map(m => m.id).sort().join();
    run("checkout", "-q", "-b", "zztheirs");
    await step({ ops: [{ op: "addAttribute", entity: `${mod}.ZzMerge`, name: "FromTheirs", type: "Integer" }, { op: "createConstant", module: mod, name: "ZzTheirs", type: "String", default: "t" }] }, "zz-merge-theirs");
    run("add", "-A");
    run("commit", "-qm", "theirs");
    run("checkout", "-q", "zzmain");
    await step({ ops: [{ op: "addAttribute", entity: `${mod}.ZzMerge`, name: "FromOurs", type: "Boolean" }, { op: "createConstant", module: mod, name: "ZzOurs", type: "String", default: "o" }] }, "zz-merge-ours");
    run("add", "-A");
    run("commit", "-qm", "ours");
    try {
        run("merge", "zztheirs");
        problems.push("git merged without a conflict");
    } catch {
        // expected: the .mpr and the domain model conflict
    }
    const report = merge.mergecheck(app);
    const want = [/TRUE CONFLICTS \(both sides changed the same document\): 1/, /DomainModels\$DomainModel .*DomainModel/, /added Attribute 'FromOurs'/, /added Attribute 'FromTheirs'/, /from theirs \(1\):\n\s+new: Constants\$Constant .*ZzTheirs/, /kept from ours \(1\):\n\s+new: Constants\$Constant .*ZzOurs/];
    for (const re of want) if (!re.test(report)) problems.push(`mergecheck lacks ${re}`);
    try {
        merge.mergefix(app);
        problems.push("mergefix without a pick was not refused");
    } catch (e) {
        if (!/need a side/.test(e.message)) problems.push(e.message);
    }
    const fx = merge.mergefix(app, "DomainModel=theirs");
    if (!fx.code) problems.push("mergefix: no approval code");
    const a = fx.code ? await cliDo(ctx, cli => cli.apply(app, fx.code)) : [];
    if (fx.code && !a.some(l => /^Saved/.test(l))) problems.push("apply: " + a.join(" | ").slice(0, 160));
    run("add", "-A");
    run("commit", "-qm", "merged");
    const after = merge.analyse(app);
    if (after.mismatch.map(m => m.id).sort().join() !== before) problems.push(`unit table and files disagree after the merge: ${after.mismatch.slice(0, 3).map(m => m.text).join("; ")}`);
    const s = await reopen(app);
    const names = new Set(require("./inspect").names(s.client).map(x => x.qn));
    for (const n of [`${mod}.ZzTheirs`, `${mod}.ZzOurs`, `${mod}.ZzMerge.FromTheirs`]) if (!names.has(n)) problems.push(`${n} missing after the merge`);
    if (names.has(`${mod}.ZzMerge.FromOurs`)) problems.push("FromOurs still there although theirs was picked");
    problems.push(...(await loadErrors(s)));
    const p = new Project(app);
    if (p.units.size !== fs.readdirSync(path.join(g, "app", "mprcontents"), { recursive: true }).filter(f => String(f).endsWith(".mxunit")).length) problems.push("unit rows and unit files differ in number");
    check("merge helper: git merge of two branches (same domain model on both = true conflict, one new constant on each side): mergecheck 3-way report, mergefix refused without a pick, picked theirs, apply; unit table matches mprcontents, reopen 0 errors, merge committed", !problems.length, problems.slice(0, 6).join("; "));
}

async function phase(ctx) {
    await navPhase(ctx);
    await themePhase(ctx);
    await packagePhase(ctx);
    await mergePhase(ctx);
}

module.exports = { phase, navTargets };
