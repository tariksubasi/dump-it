"use strict";
// selftest phase UI (selftest-ui.js): the page UI details of ui.js / design.js / theme.js on a copy: dynamic classes
// (with the expression check), button icons (glyph, Atlas icon collection), icon-only buttons with tooltip, render
// type, aria role, tab index, the drop-down button, screen reader text and aria-required of inputs, image alt text,
// container render mode / on click / screen reader hidden, layout grid row / column alignment, class and design,
// multi-select and custom-colour design properties, page class / style, changePage layout switch, a layout's own
// widgets (createLayout copy: addWidgets, changeWidget, moveWidget, deleteWidget; its placeholder protected),
// addDesignProperty and setThemeVariable (theme files), the A11Y CHECK lines; and the refusals (tooltip on an input,
// column offset, aria label on a button, unknown icon, $currentObject outside a data view, deleting a used
// placeholder, an unknown theme variable, a duplicate design property). Every stored key is compared with what Studio
// Pro writes in the project (layoutProblems), values are read back from the saved units, and the copy reopens with 0
// errors and 0 deltas.
const fs = require("fs");
const path = require("path");
const bson = require("./bson");
const { lostProperties } = require("./lost");
const design = require("./design");

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};
const words = t => (t && t.Items ? t.Items.map(i => i.Text).join("") : "");

// What the project offers: a page layout with Main, another web layout with Main, Atlas icons, design properties,
// an image, the app module's themesource folder, theme variables.
function uiTargets(s, mod) {
    const project = s.ctx.project, dir = project.dir;
    const x = { layout: null, other: null, icons: false, image: null, multi: null, color: null, themeModule: null, vars: false };
    const mains = new Map(), used = new Map(), modOf = new Map();
    const moduleName = id => {
        for (let c = id; c; c = project.units.get(c) && project.units.get(c).containerId) {
            const u = project.read(c);
            if (/^Projects\$Module/.test(u.$Type)) return u.Name;
        }
        return null;
    };
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Layout" && u.Content && u.Content.$Type === "Forms$WebLayoutContent") {
            let main = false;
            walk(u.Content, o => o.$Type === "Forms$Placeholder" && o.Name === "Main" && (main = true));
            const qn = `${moduleName(id)}.${u.Name}`;
            if (main) mains.set(qn, u.Content.LayoutType);
        }
        if (u.$Type === "Forms$Page" && u.FormCall && u.FormCall.Form && (u.FormCall.Arguments || []).some(a => /\.Main$/.test(a.Parameter))) used.set(u.FormCall.Form, (used.get(u.FormCall.Form) || 0) + 1);
        if (u.$Type === "CustomIcons$CustomIconCollection" && u.Prefix === "mx-icon" && (u.Icons || []).some(i => i.Name === "add")) x.icons = true;
        if (u.$Type === "Images$ImageCollection" && (u.Images || []).length && !x.image) x.image = `${moduleName(id)}.${u.Name}.${u.Images[0].Name}`;
        if (u.$Type === "Projects$ModuleImpl") modOf.set(u.Name, u);
    }
    const byUse = [...used.entries()].filter(([l]) => mains.has(l)).sort((a, b) => b[1] - a[1]);
    if (byUse.length) {
        x.layout = byUse[0][0];
        const type = mains.get(x.layout);
        x.other = [...mains.keys()].find(l => l !== x.layout && mains.get(l) === type) || [...mains.keys()].find(l => l !== x.layout) || null;
    }
    const defs = design.definitions(dir);
    const forDiv = [...(defs.get("DivContainer") || []), ...(defs.get("Widget") || [])];
    const multi = forDiv.find(d => d.multiSelect && (d.options || []).length >= 2);
    if (multi) x.multi = { name: multi.name, options: multi.options.slice(0, 2).map(o => o.name) };
    const color = forDiv.find(d => d.type === "ColorPicker");
    if (color) x.color = color.name;
    const m = modOf.get(mod);
    if (m && !m.FromAppStore) x.themeModule = mod;
    const vars = path.join(dir, "theme", "web", "custom-variables.scss");
    x.vars = fs.existsSync(vars) && fs.existsSync(path.join(dir, "themesource", "atlas_core", "web", "_variables.scss"));
    return x;
}

function uiPlan(mod, T, x) {
    const E = `${mod}.${T}UiE`, pg = n => `${mod}.${T}_Ui${n}`;
    const ops = [{ op: "createEntity", module: mod, name: `${T}UiE`, attributes: [{ name: "Name", type: "String(100)" }, { name: "Active", type: "Boolean" }] }];
    const refuse = [];
    if (!x.layout) return { ops, refuse, early: [] };
    const divDesign = {};
    if (x.multi) divDesign[x.multi.name] = x.multi.options;
    if (x.color) divDesign[x.color] = "#ff0000";
    const themeOps = [];
    if (x.themeModule) themeOps.push({ op: "addDesignProperty", module: x.themeModule, widgetType: "DivContainer", name: `${T} card`, type: "ToggleButtonGroup", multiSelect: true, options: [{ name: "Flat", class: "zz-ui-flat", css: "box-shadow: none" }, { name: "Raised", class: "zz-ui-raised", css: { "box-shadow": "0 2px 4px #0003" } }] });
    if (x.vars) themeOps.push({ op: "setThemeVariable", variables: { "brand-primary": "#123456", "spacing-medium": "18px" } });
    ops.push(...themeOps,
        { op: "createPage", module: mod, name: `${T}_UiA`, folder: "ZzUi", entity: E, class: "zz-page", style: "color: #333;", layout: x.layout, widgets: [
            { widget: "container", name: "zzBox", renderMode: "section", dynamicClass: "'zz-box'", tabIndex: 1, screenReaderHidden: true, ...(Object.keys(divDesign).length ? { design: divDesign } : {}), widgets: [
                { widget: "text", name: "zzH1", text: "Title", style: "H1" },
                { widget: "text", name: "zzH3", text: "Sub", style: "H3" },
                { widget: "actionButton", name: "zzIcon", action: "close", icon: "glyphicon-pencil", iconOnly: true, tooltip: "Close it", renderType: "link", ariaRole: "Link" },
                { widget: "actionButton", name: "zzBare", action: "close", icon: x.icons ? "mx-icon-add" : "glyphicon-plus", iconOnly: true },
                { widget: "dropDownButton", name: "zzMenu", caption: "More", icon: "glyphicon-cog", tooltip: "More actions", buttonStyle: "Primary", items: [{ caption: "Close", action: "close" }, { caption: "Docs", action: "openLink", url: "https://docs.mendix.com" }] },
                ...(x.image ? [{ widget: "image", name: "zzImg", image: x.image, alt: "Logo" }] : [])
            ] },
            { widget: "container", name: "zzClick", onClick: { action: "close" }, widgets: [{ widget: "text", text: "Click me" }] },
            { widget: "layoutGrid", name: "zzGrid", rows: [{ class: "zz-row", verticalAlignment: "center", horizontalAlignment: "right", spacing: false, columns: [{ weight: 6, verticalAlignment: "bottom", class: "zz-col", widgets: [] }, 6] }] },
            { widget: "dataView", name: "zzDv", source: "parameter", fields: [], buttons: false, widgets: [
                { widget: "textBox", name: "zzName", attribute: "Name", ariaLabel: "Customer name", ariaRequired: true, dynamicClass: "if $currentObject/Active then 'on' else 'off'" }
            ] }
        ] },
        { op: "createPage", module: mod, name: `${T}_UiB`, folder: "ZzUi", layout: x.layout, widgets: [{ widget: "text", text: "B" }] },
        { op: "changeWidget", page: pg("A"), widget: "zzGrid/row 1/column 2", verticalAlignment: "top", style: "padding: 4px;", weight: 5 },
        { op: "changeWidget", page: pg("A"), widget: "zzBare", tooltip: "Add", tabIndex: 2 },
        { op: "changeWidget", page: pg("A"), widget: "zzClick", renderMode: "aside", dynamicClass: "'zz-click'" },
        { op: "changePage", page: pg("B"), class: "zz-b", ...(x.other ? { layout: x.other } : {}) },
        { op: "createLayout", module: mod, name: `${T}_UiLayout`, from: x.layout, folder: "ZzUi" },
        { op: "createPage", module: mod, name: `${T}_UiC`, folder: "ZzUi", layout: `${mod}.${T}_UiLayout`, widgets: [{ widget: "text", text: "C" }] },
        // the layout's own widgets: into its content (or the container of its master's placeholder)
        { op: "addWidgets", page: `${mod}.${T}_UiLayout`, widgets: [{ widget: "text", name: "zzBrand", text: "Brand" }, { widget: "actionButton", name: "zzOut", action: "close", icon: "glyphicon-log-out", iconOnly: true, tooltip: "Close" }] },
        { op: "changeWidget", page: `${mod}.${T}_UiLayout`, widget: "zzBrand", class: "zz-brand", textStyle: "H4" },
        { op: "deleteWidget", page: `${mod}.${T}_UiLayout`, widget: "zzOut" }
    );
    refuse.push(
        [{ op: "changeWidget", page: pg("A"), widget: "zzName", tooltip: "x" }, /no tooltip/],
        [{ op: "createPage", module: mod, name: `${T}_UiR1`, widgets: [{ widget: "layoutGrid", columns: [{ weight: 6, offset: 2 }] }] }, /no column offset/],
        [{ op: "changeWidget", page: pg("A"), widget: "zzIcon", ariaLabel: "x" }, /no aria label/],
        [{ op: "changeWidget", page: pg("A"), widget: "zzIcon", icon: "glyphicon-pencl" }, /Did you mean: glyphicon-pencil/],
        [{ op: "changeWidget", page: pg("A"), widget: "zzH1", dynamicClass: "$currentObject/Name" }, /\$currentObject is the object/],
        [{ op: "deleteWidget", page: `${mod}.${T}_UiLayout`, widget: "Main" }, /is filled by/],
        [{ op: "changeWidget", page: `${mod}.${T}_UiLayout`, widget: "Main", name: "Content" }, /is filled by/],
        [{ op: "createPage", module: mod, name: `${T}_UiR2`, widgets: [{ widget: "container", design: { [x.multi ? x.multi.name : "Zz"]: x.multi ? ["Nope"] : true } }] }, x.multi ? /no option 'Nope'/ : /no design property|no design-properties/]
    );
    if (x.vars) refuse.push([{ op: "setThemeVariable", variables: { "brand-primry": "#123" } }, /Did you mean: \$brand-primary/], [{ op: "setThemeVariable", variables: { "brand-primary": "12px" } }, /is a colour/]);
    if (x.themeModule) refuse.push([{ op: "addDesignProperty", module: x.themeModule, widgetType: "DivContainer", name: `${T} card`, type: "Toggle", class: "x" }, /already has a design property/]);
    return { ops, refuse, early: [] };
}

function uiProblems(project, mod, T, x) {
    const r = [];
    const say = (ok, what) => ok || r.push(what);
    if (!x.layout) return r;
    const units = {}, named = {};
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.Name && String(u.Name).startsWith(`${T}_Ui`)) units[u.Name] = u;
    }
    for (const u of Object.values(units)) walk(u, o => o.Name && /^zz/.test(o.Name) && !named[o.Name] && (named[o.Name] = o));
    const A = units[`${T}_UiA`];
    say(A && A.Appearance.Class === "zz-page" && A.Appearance.Style === "color: #333;", "page class / style not stored");
    const box = named.zzBox;
    say(box && box.RenderMode === "Section" && box.Appearance.DynamicClasses === "'zz-box'" && box.TabIndex === 1 && box.ScreenReaderHidden === true, "container render mode / dynamic class / tab index / screen reader hidden not stored");
    if (x.multi && box) {
        const d = box.Appearance.DesignProperties.find(p => p.Key === x.multi.name);
        say(d && d.Value.$Type === "Forms$CompoundDesignPropertyValue" && d.Value.Properties.map(p => `${p.Key}:${p.Value.$Type}`).join() === x.multi.options.map(o => `${o}:Forms$ToggleDesignPropertyValue`).join(), `multi-select design '${x.multi.name}' not stored as a compound of toggles`);
    }
    if (x.color && box) {
        const d = box.Appearance.DesignProperties.find(p => p.Key === x.color);
        say(d && d.Value.$Type === "Forms$CustomDesignPropertyValue" && d.Value.Value === "#ff0000", `custom colour '${x.color}' not stored`);
    }
    const ic = named.zzIcon;
    say(ic && ic.Icon && ic.Icon.$Type === "Forms$GlyphIcon" && ic.Icon.Code === require("./glyphicons.json").pencil && !words(ic.CaptionTemplate.Template) && words(ic.Tooltip) === "Close it" && ic.RenderType === "Link" && ic.AriaRole === "Link", "glyph icon / icon only / tooltip / render type / aria role not stored");
    const bare = named.zzBare;
    say(bare && bare.Icon && bare.Icon.$Type === (x.icons ? "Forms$IconCollectionIcon" : "Forms$GlyphIcon") && (!x.icons || /\.add$/.test(bare.Icon.Image)) && words(bare.Tooltip) === "Add" && bare.TabIndex === 2, "icon collection icon / changeWidget tooltip + tab index not stored");
    const menu = named.zzMenu;
    say(menu && menu.$Type === "Forms$DropDownButton" && menu.CaptionTemplate && words(menu.CaptionTemplate.Template) === "More" && menu.Items.length === 2 && menu.Items[1].Action.$Type === "Forms$OpenLinkClientAction" && menu.ButtonStyle === "Primary" && menu.Icon && words(menu.Tooltip) === "More actions", "drop-down button not stored");
    if (x.image) say(named.zzImg && words(named.zzImg.AlternativeText.Template) === "Logo", "image alt text not stored");
    const click = named.zzClick;
    say(click && click.OnClickAction.$Type === "Forms$ClosePageClientAction" && click.RenderMode === "Aside" && click.Appearance.DynamicClasses === "'zz-click'", "container on click / changeWidget render mode not stored");
    const grid = named.zzGrid;
    const row = grid && grid.Rows[0];
    say(row && row.Appearance.Class === "zz-row" && row.VerticalAlignment === "Center" && row.HorizontalAlignment === "End" && row.SpacingBetweenColumns === false, "layout grid row alignment / class / spacing not stored");
    say(row && row.Columns[0].VerticalAlignment === "End" && row.Columns[0].Appearance.Class === "zz-col" && row.Columns[1].VerticalAlignment === "Start" && row.Columns[1].Appearance.Style === "padding: 4px;" && row.Columns[1].Weight === 5, "layout grid column alignment / class / changeWidget not stored");
    const tb = named.zzName;
    say(tb && tb.ScreenReaderLabel && words(tb.ScreenReaderLabel.Template) === "Customer name" && tb.AriaRequired === true && /currentObject\/Active/.test(tb.Appearance.DynamicClasses), "screen reader text / aria-required / dynamic class of an input not stored");
    const B = units[`${T}_UiB`];
    say(B && B.Appearance.Class === "zz-b" && (!x.other || (B.FormCall.Form === x.other && B.FormCall.Arguments.every(a => a.Parameter.startsWith(x.other + ".")))), "changePage class / layout not stored");
    const L = units[`${T}_UiLayout`];
    let brand = null, out = false;
    walk(L || {}, o => {
        if (o.Name === "zzBrand") brand = o;
        if (o.Name === "zzOut") out = true;
    });
    say(L && brand && brand.Appearance.Class === "zz-brand" && brand.RenderMode === "H4" && !out, "layout widgets: add / change / delete not stored");
    const dir = project.dir;
    if (x.themeModule) {
        const rel = path.join(dir, "themesource", x.themeModule.toLowerCase(), "web");
        const j = fs.existsSync(path.join(rel, "design-properties.json")) ? JSON.parse(fs.readFileSync(path.join(rel, "design-properties.json"), "utf8").replace(/^﻿/, "")) : {};
        say((j.DivContainer || []).some(p => p.name === `${T} card` && p.multiSelect === true && p.options.length === 2), "addDesignProperty: property not in design-properties.json");
        say(fs.existsSync(path.join(rel, "main.scss")) && /\.zz-ui-raised \{/.test(fs.readFileSync(path.join(rel, "main.scss"), "utf8")), "addDesignProperty: CSS rule not in main.scss");
    }
    if (x.vars) {
        const v = fs.readFileSync(path.join(dir, "theme", "web", "custom-variables.scss"), "utf8");
        say(/^\$brand-primary:\s*#123456/m.test(v) && /^\$spacing-medium:\s*18px/m.test(v), "setThemeVariable: values not in custom-variables.scss");
    }
    return r;
}

async function uiPhase({ s2, reopen, copy, mod, T, layout, layoutProblems, check, results }) {
    const x = uiTargets(s2, mod);
    const plan = uiPlan(mod, T, x);
    const problems = [];
    const refused = async (sess, list) => {
        for (const [o, re] of list) {
            let msg = "";
            try {
                await sess.ops.runPlan({ ops: [o] }, () => {});
            } catch (e) {
                msg = e.message;
            }
            if (!re.test(msg)) problems.push(`${o.op} ${o.name || o.page || ""} not refused with ${re}${msg ? `: ${msg.slice(0, 160)}` : " (it ran)"}`);
        }
    };
    let s = s2;
    const before = new Set(s.ctx.project.units.keys());
    const lint = await s.ops.runPlan({ ops: plan.ops }, () => {});
    problems.push(...lint);
    await s.model.flushChanges();
    const a11y = require("./ui").a11yLint(s.client);
    if (x.layout) {
        if (!a11y.some(l => /zzBare: the button has no caption and no tooltip/.test(l)) && !a11y.some(l => /zzH3: heading H3 follows H1/.test(l))) problems.push(`A11Y CHECK misses the icon-only button without tooltip and the skipped heading level: ${a11y.join(" / ").slice(0, 200)}`);
        if (a11y.some(l => /zzIcon|zzName/.test(l))) problems.push(`A11Y CHECK reports a widget with tooltip / screen reader text: ${a11y.filter(l => /zzIcon|zzName/.test(l)).join(" / ")}`);
    }
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
    problems.push(...uiProblems(s.ctx.project, mod, T, x));
    await refused(s, plan.refuse);
    const what = x.layout ? ["dynamic classes (expression checked)", "glyph" + (x.icons ? " + Atlas icon collection" : "") + " icons, icon-only, tooltip, link, aria role, tab index", "drop-down button", "screen reader text + aria-required",
        x.image && "image alt text", "container render mode / on click / screen reader hidden", "layout grid row + column alignment, class, style, weight", x.multi && `multi-select design '${x.multi.name}'`, x.color && `custom colour '${x.color}'`,
        "page class / style", x.other && `changePage layout -> ${x.other}`, "layout widgets (add, change, delete; placeholder protected)", x.themeModule && "addDesignProperty", x.vars && "setThemeVariable", "A11Y CHECK",
        `${plan.refuse.length} refusals`].filter(Boolean) : ["no page layout with Main: only the entity"];
    if (!x.layout) results.push("SKIP ui: this project has no page with a layout placeholder Main");
    else {
        if (!x.icons) results.push("SKIP ui: Atlas icon collection (mx-icon) icon: none in this project (glyph icon instead)");
        if (!x.multi || !x.color) results.push(`SKIP ui: design ${[!x.multi && "multi-select", !x.color && "ColorPicker"].filter(Boolean).join(" + ")} property: none for containers in this theme`);
        if (!x.other) results.push("SKIP ui: changePage layout: no second web layout with Main");
        if (!x.themeModule) results.push(`SKIP ui: addDesignProperty: ${mod} is a Marketplace module`);
        if (!x.vars) results.push("SKIP ui: setThemeVariable: no theme/web/custom-variables.scss with Atlas variables");
    }
    check(`ui: ${what.join("; ")}; stored with Studio Pro's keys, reopen 0 errors`, !problems.length, [...new Set(problems)].slice(0, 6).join("; "));
    if (firstUse.length) results.push(`NOTE ui: no Studio Pro sample in this project of ${firstUse.length} type(s) (SDK layout, "check it in Studio Pro" warning): ${firstUse.slice(0, 10).join(", ")}`);
    return reopen(copy);
}

module.exports = { uiPhase, uiPlan, uiTargets, uiProblems };
