"use strict";
// selftest phase DS-model (selftest-ds-model.js): the composite layer of a design system on a copy: building blocks
// (configured widgets, unconfigured data view with inputs and Save / Cancel, unconfigured list view; toolbox details),
// addWidgets / changeWidget on a building block, { "widget": "buildingBlock" } on a page, changeBuildingBlock, page
// templates (regular and edit, on the project's layout) and createPage "from" one, createLayout from scratch (sidebar,
// topbar with two placeholders, modal pop-up) with header / side bar / footer widgets and a page on it; and the
// refusals. Every stored key is compared with what Studio Pro writes in the project (layoutProblems), values are read
// back from the saved units, new units roundtrip byte for byte and the copy reopens with 0 errors and 0 deltas.
const bson = require("./bson");
const { lostProperties } = require("./lost");

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};
const words = t => (t && t.Items ? t.Items.map(i => i.Text).join("") : "");

// What the project offers: a page layout with Main (page templates and pages), a Responsive navigation profile (menus).
function dsTargets(s) {
    const project = s.ctx.project;
    const x = { layout: null, nav: false, popup: null };
    const used = new Map(), mains = new Set();
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Page" && u.FormCall && u.FormCall.Form && (u.FormCall.Arguments || []).some(a => /\.Main$/.test(a.Parameter))) used.set(u.FormCall.Form, (used.get(u.FormCall.Form) || 0) + 1);
        if (u.$Type === "Navigation$NavigationDocument" && (u.Profiles || []).some(p => p.$Type === "Navigation$NavigationProfile" && p.Name === "Responsive")) x.nav = true;
    }
    for (const l of s.model.allLayouts()) mains.add(l.qualifiedName);
    const store = s.model.allModules().find(m => m.fromAppStore);
    x.atlasCore = s.model.allModules().some(m => m.name === "Atlas_Core" && m.fromAppStore);
    const inst = require("./pluggable").installed(project.dir);
    x.installed = inst;
    x.gallery = inst.has("com.mendix.widget.web.gallery.Gallery");
    x.grid2 = inst.has("com.mendix.widget.web.datagrid.Datagrid");
    x.store = store ? store.name : null;
    const byUse = [...used.entries()].filter(([l]) => mains.has(l)).sort((a, b) => b[1] - a[1]);
    if (byUse.length) x.layout = byUse[0][0];
    return x;
}

function dsPlan(mod, T, x) {
    const q = n => `${mod}.${T}${n}`;
    const ops = [
        { op: "createEntity", module: mod, name: `${T}DsE`, attributes: [{ name: "Name", type: "String(100)" }, { name: "Active", type: "Boolean" }, { name: "Amount", type: "Decimal" }, { name: "Done", type: "Integer" }] },
        { op: "createBuildingBlock", module: mod, name: `${T}BbCard`, folder: "ZzDs", category: "Zz kit", categoryWeight: 10, displayName: "Zz card", documentationUrl: "https://example.com/card", widgets: [
            { widget: "container", name: "zzCard", class: "card zz-card", widgets: [{ widget: "text", name: "zzCardTitle", text: "Card title", style: "H4" }, { widget: "text", text: "Body" }] }] },
        { op: "createBuildingBlock", module: mod, name: `${T}BbForm`, folder: "ZzDs", widgets: [
            { widget: "dataView", name: "zzForm", orientation: "vertical", class: "zz-form", buttons: true, widgets: [
                { widget: "textBox", name: "zzFName", label: "Name" }, { widget: "datePicker", label: "Date" }, { widget: "checkBox", label: "Active" }, { widget: "textArea", label: "Notes" }, { widget: "radioButtons", label: "Kind" }] },
            { widget: "listView", name: "zzList", pageSize: 5, widgets: [{ widget: "text", text: "Item" }] }] },
        { op: "createBuildingBlock", module: mod, name: `${T}BbBound`, folder: "ZzDs", entity: `${mod}.${T}DsE`, widgets: [{ widget: "listView", name: "zzBoundList", entity: `${mod}.${T}DsE`, fields: ["Name"] }] },
        { op: "addWidgets", page: q("BbCard"), into: "zzCard", widgets: [{ widget: "actionButton", name: "zzCardMore", action: "close", caption: "More" }] },
        { op: "changeWidget", page: q("BbCard"), widget: "zzCardTitle", text: "Zz title", class: "zz-title" },
        { op: "changeBuildingBlock", document: q("BbForm"), displayName: "Zz form", category: "Zz kit", categoryWeight: 20 }
    ];
    const refuse = [
        [{ op: "createBuildingBlock", module: mod, name: `${T}BbR1`, widgets: [{ widget: "dataView", fields: ["Name"] }] }, /needs an entity|needs 'entity'|has no parameters|fields/],
        [{ op: "createBuildingBlock", module: mod, name: `${T}BbR2`, widgets: [{ widget: "dataView", entity: `${mod}.${T}DsE`, widgets: [] }] }, /a building block has no parameters/],
        [{ op: "createBuildingBlock", module: mod, name: `${T}BbR3`, widgets: [{ widget: "gallery" }] }, /needs "entity"/],
        [{ op: "createBuildingBlock", module: mod, name: `${T}BbR4`, widgets: [{ widget: "dataView", widgets: [{ widget: "textBox", label: "x", required: true }] }] }, /unconfigured.*takes label and name/],
        [{ op: "createBuildingBlock", module: mod, name: `${T}BbR5`, templateCategory: "x", widgets: [{ widget: "text", text: "x" }] }, /use "category"/],
        [{ op: "changeBuildingBlock", document: `${mod}.${T}DsE`, displayName: "x" }, /not a building block or page template/],
        [{ op: "createLayout", module: mod, name: `${T}LayR1`, from: "Atlas_Core.Atlas_Default", preset: "blank" }, /copies .* as it is/],
        [{ op: "createLayout", module: mod, name: `${T}LayR2`, type: "ModalPopup", preset: "sidebar" }, /has no side bar or top bar menu/],
        [{ op: "createLayout", module: mod, name: `${T}LayR3`, preset: "sidebr" }, /Did you mean: sidebar/],
        [{ op: "createPageTemplate", module: mod, name: `${T}TplR1`, type: "edt", widgets: [] }, /Did you mean: edit/]
    ];
    const menu = x.nav ? {} : { menu: false };
    ops.push(
        { op: "createLayout", module: mod, name: `${T}LayShell`, folder: "ZzDs", ...menu, brand: "Zz", header: [{ widget: "actionButton", name: "zzSignOut", action: "close", caption: "Close" }], sidebar: [{ widget: "text", name: "zzVersion", text: "v1" }], footer: [{ widget: "text", name: "zzFooter", text: "(c) Zz" }] },
        { op: "createLayout", module: mod, name: `${T}LayTop`, folder: "ZzDs", preset: "topbar", ...menu, placeholders: ["Main", "Actions"] },
        { op: "createLayout", module: mod, name: `${T}LayPopup`, folder: "ZzDs", type: "ModalPopup" },
        { op: "changeWidget", page: q("LayShell"), widget: "zzVersion", class: "zz-version" },
        { op: "createPage", module: mod, name: `${T}_DsShell`, folder: "ZzDs", layout: q("LayShell"), widgets: [{ widget: "buildingBlock", from: q("BbCard") }, { widget: "buildingBlock", name: "zzCopy2", from: q("BbCard") }] }
    );
    ops.push(
        { op: "applyStyle", widget: "container", page: `${mod}.${T}_DsShell`, hasClass: "zz-card", removeClass: "card", addClass: "zz-styled" },
        { op: "applyStyle", widget: "actionButton", module: mod, folder: "ZzDs", match: "zz*", style: "margin: 2px;", buttonStyle: "Primary" }
    );
    refuse.push(
        [{ op: "applyStyle", widget: "container", addClass: "x" }, /say where/],
        [{ op: "applyStyle", widget: "container", module: mod, folder: "ZzDs", limit: 1, addClass: "x" }, /widgets match \(limit 1\)/],
        [{ op: "applyStyle", widget: "datagird", module: mod, addClass: "x" }, /Did you mean: dataGrid/],
        [{ op: "applyStyle", widget: "container", module: mod, class: "a", addClass: "x" }, /class replaces all classes/],
        [{ op: "applyStyle", widget: "text", page: `${mod}.${T}_DsShell`, match: "nothingLikeThis*", addClass: "x" }, /no text widget named like/]
    );
    const dataKit = ["toolbar", "listCards", "listColumns", "masterDetail", ...(x.gallery ? ["gallery"] : [])];
    ops.push(
        { op: "createComponentKit", module: mod, prefix: "zzk", folder: "ZzDs", withStyles: true },
        { op: "createComponentKit", module: mod, prefix: "zzd", folder: "ZzDs", entity: `${mod}.${T}DsE`, kit: dataKit }
    );
    refuse.push(
        [{ op: "createComponentKit", module: mod, prefix: "zzx", kit: ["carrd"] }, /Did you mean: card/],
        [{ op: "createComponentKit", module: mod, prefix: "zzx", kit: ["gallery"] }, /needs an entity/],
        [{ op: "createComponentKit", module: mod, prefix: "zzk", kit: [{ recipe: "card", name: `${T}KitOther` }], withStyles: true }, /already has the zzk component kit styles/],
        [{ op: "createComponentKit", module: mod, prefix: "zzk", kit: ["card"] }, /already exists/],
        [{ op: "createComponentKit", module: mod, prefix: "zzx", kit: [{ recipe: "card", colour: "red" }] }, /card takes recipe, name, title, text; not 'colour'/]
    );
    if (x.atlasCore) refuse.push([{ op: "createComponentKit", module: mod, prefix: "zzy", kit: ["card"], withStyles: true, file: "themesource/atlas_core/web/main.scss" }, /Marketplace module Atlas_Core/]);
    if (x.layout) {
        ops.push({ op: "createStyleGuide", module: mod, name: `${T}_DsStyleGuide`, folder: "ZzDs", layout: x.layout, prefix: "zzk", entity: `${mod}.${T}DsE`, ...(x.nav ? { menu: "Responsive" } : {}) });
        refuse.push([{ op: "createStyleGuide", module: mod, name: `${T}_DsR4`, prefix: "nokit" }, /no building block .*Nokit_\*/]);
    }
    // pluggable presets: the ones whose .mpk this project has
    const E = `${mod}.${T}DsE`;
    const presetSpecs = {
        badge: { widget: "badge", name: "zzBadge", text: "Beta" }, progressBar: { widget: "progressBar", name: "zzBar", value: 40, showLabel: true }, progressCircle: { widget: "progressCircle", name: "zzCircle", value: 70 },
        accordion: { widget: "accordion", name: "zzAcc", groups: [{ header: "One", widgets: [{ widget: "text", text: "a" }] }, { header: "Two", collapsed: false }] },
        popupMenu: { widget: "popupMenu", name: "zzMenu", items: [{ caption: "Close", action: { action: "close" } }, "divider", { caption: "Close too", action: { action: "close" }, style: "danger" }] },
        treeNode: { widget: "treeNode", name: "zzTree", entity: E, caption: "{Name}" }, lineChart: { widget: "lineChart", name: "zzLine", entity: E, x: "Name", y: "Amount" },
        columnChart: { widget: "columnChart", name: "zzColumns", entity: E, x: "Name", y: "Amount", aggregation: "sum" }, pieChart: { widget: "pieChart", name: "zzPie", entity: E, value: "Amount", caption: "{Name}", hole: 50 },
        barChart: { widget: "barChart", name: "zzBars", entity: E, x: "Name", y: "Done", xLabel: "Name", yLabel: "Done" }, areaChart: { widget: "areaChart", name: "zzArea", entity: E, x: "Name", y: "Amount", xpath: "[Active = true()]" }
    };
    const P = require("./pl-presets").PRESETS;
    x.presets = Object.keys(presetSpecs).filter(k => x.installed.has(P[k].id));
    if (x.layout && x.presets.length) {
        ops.push({ op: "createPage", module: mod, name: `${T}_DsPresets`, folder: "ZzDs", layout: x.layout, widgets: x.presets.map(k => presetSpecs[k]) });
        if (x.presets.includes("accordion")) refuse.push([{ op: "createPage", module: mod, name: `${T}_DsR1`, widgets: [{ widget: "accordion", groups: [{ widgets: [] }] }] }, /needs "header"/]);
        if (x.presets.includes("progressBar")) refuse.push([{ op: "createPage", module: mod, name: `${T}_DsR2`, widgets: [{ widget: "progressBar", value: { attribute: "Done" }, min: 1 }] }, /min \/ max go with a fixed number/]);
    }
    const missing = Object.keys(P).find(k => !x.installed.has(P[k].id));
    if (missing && x.layout) refuse.push([{ op: "createPage", module: mod, name: `${T}_DsR3`, widgets: [{ widget: missing, ...Object.fromEntries(Object.entries(P[missing].fields).filter(([, d]) => d.startsWith("R ")).map(([k]) => [k, k === "groups" || k === "items" ? [{ header: "x", caption: "x" }] : "x"])) }] }, /needs the .* widget .*importWidget/]);
    if (x.store) refuse.push([{ op: "applyStyle", widget: "container", module: x.store, addClass: "x" }, /is a Marketplace module/]);
    if (x.layout) {
        ops.push(
            { op: "createPageTemplate", module: mod, name: `${T}TplList`, folder: "ZzDs", layout: x.layout, category: "Zz kit", widgets: [{ widget: "text", text: "Zz list", style: "H2" }, { widget: "listView", name: "zzTplList", widgets: [{ widget: "text", text: "Row" }] }] },
            { op: "createPageTemplate", module: mod, name: `${T}TplEdit`, folder: "ZzDs", type: "edit", layout: q("LayPopup"), class: "zz-edit-page", widgets: [{ widget: "dataView", name: "zzTplForm", buttons: true, widgets: [{ widget: "input", label: "Name" }] }] },
            { op: "createPage", module: mod, name: `${T}_DsFromTpl`, folder: "ZzDs", from: q("TplEdit") },
            { op: "createPage", module: mod, name: `${T}_DsFromTpl2`, folder: "ZzDs", from: q("TplList"), widgets: [{ widget: "buildingBlock", from: q("BbForm") }] }
        );
        refuse.push([{ op: "createPageTemplate", module: mod, name: `${T}TplR2`, layout: x.layout, placeholders: { Mian: [] } }, /has no placeholder .Mian./]);
    }
    return { ops, refuse };
}

function dsProblems(project, mod, T, x) {
    const r = [];
    const say = (ok, what) => ok || r.push(what);
    const units = {};
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.Name && String(u.Name).startsWith(T) && /Forms\$(BuildingBlock|PageTemplate|Layout|Page)$/.test(u.$Type)) units[u.Name] = u;
    }
    const named = (u, n) => {
        let hit = null;
        walk(u || {}, o => !hit && o.Name === n && (hit = o));
        return hit;
    };
    const card = units[`${T}BbCard`];
    say(card && card.$Type === "Forms$BuildingBlock" && card.Platform === "Web" && card.DisplayName === "Zz card" && card.TemplateCategory === "Zz kit" && card.TemplateCategoryWeight === 10 && card.DocumentationUrl === "https://example.com/card", "building block toolbox details not stored");
    say(card && named(card, "zzCardMore") && named(card, "zzCardTitle") && named(card, "zzCardTitle").Appearance.Class === "zz-title", "addWidgets / changeWidget on a building block not stored");
    const form = units[`${T}BbForm`];
    const dv = named(form, "zzForm");
    say(form && form.DisplayName === "Zz form" && form.TemplateCategoryWeight === 20, "changeBuildingBlock not stored");
    say(dv && dv.$Type === "Forms$DataView" && dv.DataSource.$Type === "Forms$DataViewSource" && dv.DataSource.EntityRef === null && dv.LabelWidth === 0 && dv.Appearance.Class === "zz-form", "unconfigured data view not stored as Studio Pro's (DataViewSource, EntityRef null, vertical)");
    const inputs = [];
    walk(dv || {}, o => /Forms\$(TextBox|DatePicker|CheckBox|TextArea|RadioButtonGroup)$/.test(o.$Type) && inputs.push(o));
    say(inputs.length === 5 && inputs.every(i => i.AttributeRef === null && i.SourceVariable === null) && words(inputs[0].LabelTemplate.Template) === "Name", `unconfigured inputs not stored (${inputs.length} of 5, AttributeRef null, label)`);
    const foot = dv ? dv.FooterWidgets.map(w => w.Action && w.Action.$Type) : [];
    say(foot.join() === "Forms$SaveChangesClientAction,Forms$CancelChangesClientAction", `unconfigured data view footer is ${foot.join()} (Save / Cancel expected)`);
    let stand = false;
    walk(units, o => o.Name && /^zzFooterStandIn/.test(o.Name) && (stand = true));
    say(!stand, "a stand-in container was left in a building block");
    const lv = named(form, "zzList");
    say(lv && lv.$Type === "Forms$ListView" && lv.DataSource.EntityRef === null && lv.PageSize === 5 && lv.Widgets.length === 1, "unconfigured list view not stored");
    const bound = named(units[`${T}BbBound`], "zzBoundList");
    say(bound && bound.DataSource.EntityRef && /DsE$/.test(bound.DataSource.EntityRef.Entity), "bound list view of a building block lacks its entity");
    const shell = units[`${T}LayShell`];
    let sc = null, tree = null, toggle = null, bar = null;
    walk(shell || {}, o => (o.$Type === "Forms$ScrollContainer" && !sc && (sc = o), o.$Type === "Forms$NavigationTree" && (tree = o), o.$Type === "Forms$SidebarToggleButton" && (toggle = o)));
    say(shell && shell.Content.LayoutType === "Responsive" && /layout-atlas-responsive-default/.test(shell.Appearance.Class), "sidebar layout type / class not stored");
    say(sc && sc.CenterRegion.Appearance.Class === "region-content" && sc.CenterRegion.Widgets.some(w => w.$Type === "Forms$Placeholder" && w.Name === "Main") && sc.Left && sc.Left.Appearance.Class === "region-sidebar" && sc.Top && sc.Bottom, "sidebar layout regions / placeholder not stored");
    say(!x.nav || (tree && tree.MenuSource && tree.MenuSource.NavigationProfile === "Responsive"), "navigation tree menu source not stored");
    say(toggle && toggle.Appearance.Class === "toggle-btn" && words(toggle.Tooltip) === "Toggle Menu", "side bar toggle not stored");
    say(named(shell, "zzSignOut") && named(shell, "zzVersion") && named(shell, "zzVersion").Appearance.Class === "zz-version" && named(shell, "zzFooter"), "layout header / side bar / footer widgets not stored");
    const top = units[`${T}LayTop`];
    walk(top || {}, o => o.$Type === "Forms$MenuBar" && (bar = o));
    const phs = [];
    walk(top || {}, o => o.$Type === "Forms$Placeholder" && phs.push(o.Name));
    say(phs.join() === "Main,Actions" && (!x.nav || (bar && bar.Appearance.Class === "hidden-xs")), "topbar layout placeholders / menu bar not stored");
    say(units[`${T}LayPopup`] && units[`${T}LayPopup`].Content.LayoutType === "ModalPopup", "modal pop-up layout not stored");
    const page = units[`${T}_DsShell`];
    say(page && page.FormCall.Form === `${mod}.${T}LayShell` && named(page, "zzCopy2") && named(page, "zzCard"), "page on the new layout / building block copies not stored");
    const copies = [];
    walk(page || {}, o => o.$Type === "Forms$DivContainer" && /zz-card/.test(o.Appearance.Class) && copies.push(o.Appearance.Class));
    say(copies.length === 2 && copies.every(c => c === "zz-card zz-styled"), `applyStyle hasClass / removeClass / addClass not stored (${copies.join(" | ")})`);
    const more = named(card, "zzCardMore"), out = named(shell, "zzSignOut");
    say(more && more.Appearance.Style === "margin: 2px;" && more.ButtonStyle === "Primary" && out && out.Appearance.Style === "margin: 2px;", "applyStyle in a module folder (building block + layout buttons) not stored");
    const kitNames = ["Card", "KpiTile", "PageHeader", "Toolbar", "FormSection", "ListCards", "ListColumns", "CardLayout", "EmptyState", "MasterDetail"];
    const kitUnits = kitNames.map(n => units[`Zzk_${n}`] || project.read([...project.units.keys()].find(id => project.read(id).Name === `Zzk_${n}`) || ""));
    say(kitUnits.every(u => u && u.$Type === "Forms$BuildingBlock" && u.TemplateCategory === "Zzk kit") && kitUnits.map(u => u.TemplateCategoryWeight).join() === "10,20,30,40,50,60,70,80,90,100", "component kit building blocks / category / order not stored");
    const kcard = kitUnits[0] && kitUnits[0].Widgets[0];
    say(kcard && kcard.Appearance.Class === "card zzk-card", "kit card classes not stored");
    const fs = require("fs"), path = require("path");
    const scssFile = ["themesource/" + mod.toLowerCase() + "/web/main.scss", "theme/web/main.scss"].map(f => path.join(project.dir, f)).find(f => fs.existsSync(f) && /\/\* zzk component kit/.test(fs.readFileSync(f, "utf8")));
    say(scssFile && /\.zzk-card \{/.test(fs.readFileSync(scssFile, "utf8")) && /var\(--zzk-surface-1, #ffffff\)/.test(fs.readFileSync(scssFile, "utf8")), "kit SCSS not written");
    const unitNamed = n => project.read([...project.units.keys()].find(id => project.read(id).Name === n) || "");
    const tb = unitNamed("Zzd_Toolbar");
    let grid = null;
    walk(tb || {}, o => (o.$Type === "CustomWidgets$CustomWidget" || o.$Type === "Forms$DataGrid") && !grid && (grid = o));
    say(tb && grid && (!x.grid2 || grid.$Type === "CustomWidgets$CustomWidget"), "kit toolbar with a grid of the entity not stored");
    if (x.layout) {
        const sg = units[`${T}_DsStyleGuide`];
        const secs = [], copies2 = [];
        walk(sg || {}, o => (o.$Type === "Forms$DynamicText" && o.Appearance.Class === "styleguide-section" && secs.push(words(o.Content.Template)), o.$Type === "Forms$DivContainer" && /zzk-card$/.test(o.Appearance.Class) && copies2.push(o)));
        say(["Typography", "Buttons", "Cards", "Alerts", "Data grid", "List view", "Components"].every(t => secs.includes(t)) && copies2.length >= 1, `style guide sections / kit components not stored (${secs.join(", ")})`);
        let btns = 0;
        walk(sg || {}, o => o.$Type === "Forms$ActionButton" && btns++);
        say(btns >= 9, "style guide buttons missing");
    }
    if (x.layout && x.presets.length) {
        const pp = units[`${T}_DsPresets`];
        const ids = [];
        walk(pp || {}, o => o.$Type === "CustomWidgets$CustomWidget" && o.Type && ids.push(o.Type.WidgetId));
        const P = require("./pl-presets").PRESETS;
        const want = [...new Set(x.presets.map(k => P[k].id))];
        say(want.every(id => ids.includes(id)), `pluggable presets not stored: ${want.filter(id => !ids.includes(id)).join(", ")}`);
    }
    if (x.layout) {
        const tl = units[`${T}TplList`], te = units[`${T}TplEdit`];
        say(tl && tl.$Type === "Forms$PageTemplate" && tl.TemplateType.$Type === "Forms$RegularPageTemplateType" && tl.LayoutCall.Form === x.layout && tl.TemplateCategory === "Zz kit", "regular page template not stored");
        say(te && te.TemplateType.$Type === "Forms$EditPageTemplateType" && te.Appearance.Class === "zz-edit-page" && named(te, "zzTplForm") && named(te, "zzTplForm").DataSource.EntityRef === null, "edit page template not stored");
        const fp = units[`${T}_DsFromTpl`];
        say(fp && fp.FormCall.Form === `${mod}.${T}LayPopup` && named(fp, "zzTplForm"), "createPage from the new page template not stored");
        say(units[`${T}_DsFromTpl2`] && named(units[`${T}_DsFromTpl2`], "zzTplList") && named(units[`${T}_DsFromTpl2`], "zzForm"), "createPage from a template with a building block not stored");
    }
    return r;
}

async function dsModelPhase({ s2, reopen, copy, mod, T, layout, layoutProblems, check, results }) {
    const x = dsTargets(s2);
    const plan = dsPlan(mod, T, x);
    const problems = [];
    const refused = async (sess, list) => {
        for (const [o, re] of list) {
            let msg = "";
            try {
                await sess.ops.runPlan({ ops: [o] }, () => {});
            } catch (e) {
                msg = e.message;
            }
            if (!re.test(msg)) problems.push(`${o.op} ${o.name || o.document || ""} not refused with ${re}${msg ? `: ${msg.slice(0, 160)}` : " (it ran)"}`);
        }
    };
    let s = s2;
    const before = new Set(s.ctx.project.units.keys());
    problems.push(...(await s.ops.runPlan({ ops: plan.ops }, () => {})));
    // the presets fill every required property: no "leaves required ... empty"
    problems.push(...s.client.summary().warnings.filter(w => /_DsPresets.*leaves required/.test(w)));
    await s.model.flushChanges();
    const enc = s.client.encode();
    enc.plainFiles = require("./files").encode(s.client);
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
    const firstUse = [...new Set(s.client.summary().warnings.filter(w => /never occurs|first use in this project/.test(w)).map(w => w.split(/[ :(]/)[0]).filter(w => w.includes("$")))];
    s.client.project.writeEncoded(enc);
    s = await reopen(copy);
    problems.push(...(await s.ops.checkPlan({ ops: plan.ops })));
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => problems.push(`reopen: ${e.message}`));
    await s.model.flushChanges();
    if (s.client.log.length) problems.push(`${s.client.log.length} deltas on reopen`);
    for (const id of s.ctx.project.units.keys()) {
        if (before.has(id)) continue;
        const b = s.ctx.project.readBytes(id);
        if (!bson.encode(bson.decode(b)).equals(b)) problems.push(`unit ${id} does not roundtrip byte for byte`);
    }
    problems.push(...dsProblems(s.ctx.project, mod, T, x));
    await refused(s, plan.refuse);
    if (!x.layout) results.push("SKIP ds-model: page templates: this project has no page with a layout placeholder Main");
    if (x.layout && x.presets.length < 11) results.push(`SKIP ds-model: pluggable presets without their .mpk here: ${Object.keys(require("./pl-presets").PRESETS).filter(k => !x.presets.includes(k)).join(", ")} (refused, tested)`);
    if (!x.nav) results.push("SKIP ds-model: layout menus: no Responsive navigation profile (layouts built with menu false)");
    const what = ["building blocks (toolbox details, unconfigured data view with 5 inputs + Save / Cancel, unconfigured list view, bound list view)", "addWidgets / changeWidget / changeBuildingBlock on a building block",
        "buildingBlock widget on a page", x.layout && "page templates (regular, edit) + createPage from them", "createLayout sidebar / topbar / modal pop-up with header, side bar, footer, menu", "applyStyle (page + hasClass, module folder + match + style + button style)", `component kits (10 recipes + SCSS, ${4 + Number(x.gallery)} bound to an entity)`, x.layout && "style guide (typography, buttons, inputs, cards, alerts, grid, list, kit)", x.layout && x.presets.length && `pluggable presets ${x.presets.join(", ")}`, `${plan.refuse.length} refusals`].filter(Boolean);
    check(`ds-model: ${what.join("; ")}; stored with Studio Pro's keys, reopen 0 errors`, !problems.length, [...new Set(problems)].slice(0, 6).join("; "));
    if (firstUse.length) results.push(`NOTE ds-model: no Studio Pro sample in this project of ${firstUse.length} type(s) (SDK layout): ${firstUse.slice(0, 10).join(", ")}`);
    return reopen(copy);
}

module.exports = { dsModelPhase, dsPlan, dsTargets, dsProblems };
