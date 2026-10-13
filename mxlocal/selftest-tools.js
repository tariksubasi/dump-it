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
async function cliRun(ctx, plan, name) {
    const cli = require("./mxlocal");
    const lines = [];
    cli.setOutput(s => lines.push(String(s)));
    const file = path.join(path.dirname(ctx.copy), "edits", name + ".json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(plan, null, 1));
    try {
        const r = await cli.run(file, ctx.copy, false);
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

async function phase(ctx) {
    await navPhase(ctx);
    await themePhase(ctx);
}

module.exports = { phase, navTargets };
