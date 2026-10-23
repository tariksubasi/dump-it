"use strict";
// selftest phase widgets (selftest-widgets.js): the layout, navigation and sign-in widgets of wave 2 on a copy: tab
// pages (changeWidget tabs: add / remove / move / rename / default, widgets into a new tab), and the refusals. Every
// stored key is compared with what Studio Pro writes in the project (layoutProblems), values are read back from the
// saved units, new units roundtrip byte for byte and the copy reopens with 0 errors and 0 deltas.
const bson = require("./bson");
const { lostProperties } = require("./lost");

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};
const words = t => (t && t.Items ? t.Items.map(i => i.Text).join("") : "");

function wTargets(s) {
    const x = { nav: false, menu: null, pageLayout: null };
    const project = s.ctx.project;
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Navigation$NavigationDocument" && (u.Profiles || []).some(p => p.$Type === "Navigation$NavigationProfile" && p.Name === "Responsive")) x.nav = true;
        if (u.$Type === "Menus$MenuDocument" && !x.menu) x.menu = id;
    }
    const m = x.menu && s.model.allMenuDocuments().find(d => d.id === x.menu);
    x.menu = m ? m.qualifiedName : null;
    x.installed = require("./pluggable").installed(project.dir);
    x.combo = x.installed.has("com.mendix.widget.web.combobox.Combobox");
    return x;
}

function wPlan(mod, T, x) {
    const q = n => `${mod}.${T}${n}`;
    const ops = [
        // W1 tab pages
        { op: "createPage", module: mod, name: `${T}WTabs`, widgets: [{ widget: "tabContainer", name: "zwTabs", tabs: [{ caption: "General", name: "zwGen", widgets: [{ widget: "text", text: "g" }] }, { caption: "Other", name: "zwOther" }, { caption: "Third", name: "zwThird" }] }] },
        { op: "changeWidget", page: q("WTabs"), widget: "zwTabs", tabs: { add: [{ caption: "Notes", name: "zwNotes", widgets: [{ widget: "text", text: "n", name: "zwNoteText" }], position: 1 }], remove: ["Other"], move: [{ tab: "General", before: "Notes" }], rename: [{ tab: "zwNotes", caption: "Remarks" }, { tab: "Third", name: "zwLast" }], default: "Remarks" } },
        { op: "addWidgets", page: q("WTabs"), into: "zwGen", widgets: [{ widget: "text", text: "more", name: "zwMore" }] },
        // W2-W9, W3: menus, scroll container, side bar toggle, title, label, back / link button, navigation list
        { op: "createPage", module: mod, name: `${T}WKinds`, widgets: [
            ...(x.nav ? [{ widget: "navigationTree", name: "zwTree" }, { widget: "menuBar", name: "zwBar" }] : []),
            ...(x.menu ? [{ widget: "simpleMenuBar", name: "zwSimple", menu: x.menu, orientation: "vertical" }] : []),
            { widget: "scrollContainer", name: "zwScroll", width: "80%", layoutMode: "sidebar", center: [{ widget: "text", text: "c", name: "zwCenter" }],
                left: { widgets: [{ widget: "sidebarToggle", name: "zwToggle" }], size: 200, toggleMode: "slideOverContent", class: "zw-left" }, top: [{ widget: "title", name: "zwTitle" }] },
            { widget: "label", name: "zwLabel", text: "Hello" }, { widget: "backButton", name: "zwBack" }, { widget: "linkButton", name: "zwLink", caption: "Docs", url: "https://docs.mendix.com" },
            { widget: "navigationList", name: "zwNav", items: [{ caption: "One", action: { action: "close" } }, "Two", { widgets: [{ widget: "text", text: "three" }], class: "zw-three" }] }] },
        { op: "changeWidget", page: q("WKinds"), widget: "zwScroll", regions: { left: null, right: { widgets: [{ widget: "text", text: "r", name: "zwRight" }], size: 30, sizeMode: "percentage", toggleMode: "pushContentAside" }, center: { class: "zw-center" }, width: 960 } },
        { op: "changeWidget", page: q("WKinds"), widget: "zwNav", items: { remove: [2], add: [{ caption: "New", action: "close", position: 1 }], move: [{ item: 3, position: 2 }], change: [{ item: 1, class: "zw-first" }] } },
        { op: "addWidgets", page: q("WKinds"), into: "zwNav/item 1", widgets: [{ widget: "text", text: "added", name: "zwAdded" }] },
        ...(x.menu ? [{ op: "changeWidget", page: q("WKinds"), widget: "zwSimple", orientation: "horizontal" }] : []),
        ...(x.nav && x.menu ? [{ op: "changeWidget", page: q("WKinds"), widget: "zwTree", menu: x.menu }] : []),
        // W14 convertWidget
        { op: "createEnumeration", module: mod, name: `${T}WKind`, values: ["A", "B"] },
        { op: "createEntity", module: mod, name: `${T}WCity`, attributes: [{ name: "Name", type: "String(100)" }] },
        { op: "createEntity", module: mod, name: `${T}WE`, attributes: [{ name: "Kind", type: `Enum(${mod}.${T}WKind)` }, { name: "Ok", type: "Boolean" }, { name: "Note", type: "String(200)" }] },
        { op: "addAssociation", from: `${mod}.${T}WE`, to: `${mod}.${T}WCity` },
        { op: "createPage", module: mod, name: `${T}WConv`, entity: `${mod}.${T}WE`, widgets: [{ widget: "dataView", name: "zwDv", widgets: [
            { widget: "dropDown", attribute: "Kind", name: "zwKind", class: "zw-k", visible: { attribute: "Ok" } },
            { widget: "referenceSelector", association: `${mod}.${T}WE_${T}WCity`, name: "zwCity" },
            { widget: "textBox", attribute: "Note", name: "zwNote" },
            { widget: "container", name: "zwBox", class: "zw-box", widgets: [{ widget: "text", text: "in box", name: "zwInBox" }] }] }] },
        { op: "convertWidget", page: q("WConv"), widget: "zwBox", to: "groupBox", caption: "Box" },
        ...(x.combo ? [{ op: "convertWidget", page: q("WConv"), widget: "zwKind", to: "comboBox" }, { op: "convertWidget", page: q("WConv"), widget: "zwCity", to: "comboBox" }, { op: "convertWidget", page: q("WConv"), widget: "zwKind", to: "radioButtons" }] : []),
        // W6 sign-in widgets and createLoginPage
        { op: "createLoginPage", module: mod, name: `${T}WLogin`, title: "Welcome", ...(x.nav ? {} : { profile: false }), widgets: [{ widget: "linkButton", caption: "Help", url: "https://example.com/help" }] }
    ];
    const refuse = [
        [{ op: "changeWidget", page: q("WTabs"), widget: "zwTabs", tabs: { remove: ["Nope"] } }, /has no tab 'Nope'/],
        [{ op: "changeWidget", page: q("WTabs"), widget: "zwTabs", tabs: { ad: [] } }, /Did you mean: add/],
        [{ op: "changeWidget", page: q("WTabs"), widget: "zwTabs", tabs: { move: [{ tab: "General", before: "General" }] } }, /before or after itself/],
        [{ op: "changeWidget", page: q("WTabs"), widget: "zwMore", tabs: { add: ["X"] } }, /changes a tab container/],
        [{ op: "changeWidget", page: q("WTabs"), widget: "zwTabs", tabs: { add: [{ caption: "Dup", name: "zwMore" }] } }, /already used/],
        [{ op: "createPage", module: mod, name: `${T}WR1`, widgets: [{ widget: "table" }] }, /deprecated.*layoutGrid/],
        [{ op: "createPage", module: mod, name: `${T}WR2`, widgets: [{ widget: "verticalFlow" }] }, /removed in Mendix 7.15: use a container/],
        [{ op: "createPage", module: mod, name: `${T}WR3`, widgets: [{ widget: "splitPane" }] }, /split panes were removed/],
        [{ op: "createPage", module: mod, name: `${T}WR4`, widgets: [{ widget: "linkButton", caption: "x" }] }, /needs where it goes/],
        [{ op: "createPage", module: mod, name: `${T}WR5`, widgets: [{ widget: "label", text: "{Name}" }] }, /fixed text/],
        [{ op: "createPage", module: mod, name: `${T}WR6`, widgets: [{ widget: "scrollContainer", center: [], top: { toggleMode: "slideOverContent" } }] }, /only a left or right region/],
        [{ op: "createPage", module: mod, name: `${T}WR7`, widgets: [{ widget: "navigationTree", menu: "Nope" }] }, /no web navigation profile 'Nope'/],
        [{ op: "changeWidget", page: q("WKinds"), widget: "zwNav", items: { remove: [9] } }, /item 9 does not exist/],
        [{ op: "changeWidget", page: q("WKinds"), widget: "zwScroll", regions: { center: null } }, /center region stays/],
        [{ op: "changeWidget", page: q("WKinds"), widget: "zwLabel", menu: "Responsive" }, /"menu" changes a navigation tree/],
        [{ op: "addWidgets", page: q("WKinds"), into: "zwNav", widgets: [{ widget: "text", text: "x" }] }, /go into one of its items/],
        [{ op: "convertWidget", page: q("WConv"), widget: "zwNote", to: "comboBox" }, /no enumeration or Boolean attribute/],
        [{ op: "convertWidget", page: q("WConv"), widget: "zwBox", to: "groupbox" }, /is a groupBox already/],
        [{ op: "convertWidget", page: q("WConv"), widget: "zwBox", to: "grop" }, /Did you mean: groupBox/],
        [{ op: "convertWidget", page: q("WConv"), widget: "zwInBox", to: "container" }, /cannot become a container/],
        [{ op: "createLoginPage", module: mod, name: `${T}WLogin` }, /already exists/],
        [{ op: "createPage", module: mod, name: `${T}WR8`, widgets: [{ widget: "loginButton", validationMessage: "nope" }] }, /no validation message widget here/]
    ];
    return { ops, refuse };
}

function wProblems(project, mod, T, x) {
    const r = [];
    const say = (ok, what) => ok || r.push(what);
    const units = {};
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.Name && String(u.Name).startsWith(T + "W") && /Forms\$(Page|Snippet|Layout)$/.test(u.$Type)) units[u.Name] = u;
    }
    const named = (u, n) => {
        let hit = null;
        walk(u || {}, o => !hit && o.Name === n && (hit = o));
        return hit;
    };
    // W1
    const tabs = named(units[`${T}WTabs`], "zwTabs");
    const order = tabs ? tabs.TabPages.map(t => t.Name).join() : "";
    say(tabs && tabs.$Type === "Forms$TabControl" && order === "zwGen,zwNotes,zwLast", `tab pages not stored in order (${order})`);
    const notes = tabs && tabs.TabPages.find(t => t.Name === "zwNotes");
    say(notes && words(notes.Caption) === "Remarks" && notes.Widgets.some(w => w.Name === "zwNoteText"), "new tab caption / widgets not stored");
    say(tabs && notes && tabs.DefaultPagePointer === notes.$ID, "default tab (DefaultPagePointer) not stored");
    say(tabs && tabs.TabPages[0].Widgets.some(w => w.Name === "zwMore"), "addWidgets into a tab page not stored");
    // W2-W9, W3
    const kinds = units[`${T}WKinds`];
    if (x.nav) {
        const tree = named(kinds, "zwTree"), bar = named(kinds, "zwBar");
        say(tree && tree.$Type === "Forms$NavigationTree" && tree.MenuSource && (x.menu ? tree.MenuSource.Menu === x.menu : tree.MenuSource.NavigationProfile === "Responsive"), "navigation tree menu source not stored");
        say(bar && bar.$Type === "Forms$MenuBar" && bar.MenuSource.$Type === "Forms$NavigationSource", "menu bar not stored");
    }
    if (x.menu) {
        const sm = named(kinds, "zwSimple");
        say(sm && sm.$Type === "Forms$SimpleMenuBar" && sm.MenuSource.$Type === "Forms$MenuDocumentSource" && sm.Orientation === "Horizontal", "simple menu bar (menu document, orientation change) not stored");
    }
    const sc = named(kinds, "zwScroll");
    say(sc && sc.$Type === "Forms$ScrollContainer" && sc.LayoutMode === "Sidebar" && sc.WidthMode === "Pixels" && sc.Width === 960 && sc.Left === null && sc.Right && sc.Right.Size === 30 && sc.Right.SizeMode === "Percentage" && sc.Right.ToggleMode === "PushContentAside" && sc.Right.Widgets.some(w => w.Name === "zwRight") && sc.CenterRegion.Appearance.Class === "zw-center" && sc.Top && sc.Top.Widgets.some(w => w.$Type === "Forms$Title"), "scroll container regions / changes not stored");
    const lbl = named(kinds, "zwLabel");
    say(lbl && lbl.$Type === "Forms$Label" && words(lbl.Caption) === "Hello", "label not stored");
    const back = named(kinds, "zwBack"), link = named(kinds, "zwLink");
    say(back && back.$Type === "Forms$ActionButton" && back.Action.$Type === "Forms$ClosePageClientAction" && words(back.CaptionTemplate.Template) === "Back", "back button (close page action) not stored");
    say(link && link.$Type === "Forms$ActionButton" && link.RenderType === "Link" && link.Action.$Type === "Forms$OpenLinkClientAction", "link button (RenderType Link, open link) not stored");
    const nav = named(kinds, "zwNav");
    const texts = nav ? nav.Items.map(i => i.Widgets.map(w => words(w.Content && w.Content.Template)).join("+")) : [];
    say(nav && nav.$Type === "Forms$NavigationList" && texts.join("|") === "New+added|three|One" && nav.Items[0].Appearance.Class === "zw-first" && nav.Items[0].Action.$Type === "Forms$ClosePageClientAction", `navigation list items not stored (${texts.join("|")})`);
    // W14
    const conv = units[`${T}WConv`];
    const box = named(conv, "zwBox");
    say(box && box.$Type === "Forms$GroupBox" && box.Appearance.Class === "zw-box" && box.Widgets.some(w => w.Name === "zwInBox") && box.CaptionTemplate && words(box.CaptionTemplate.Template) === "Box", "container -> group box (widgets, class, caption) not stored");
    if (x.combo) {
        const kind = named(conv, "zwKind"), city = named(conv, "zwCity");
        say(kind && kind.$Type === "Forms$RadioButtonGroup" && kind.Appearance.Class === "zw-k" && kind.ConditionalVisibilitySettings, "drop-down -> combo box -> radio buttons (class, visibility kept) not stored");
        say(city && city.$Type === "CustomWidgets$CustomWidget" && /Combobox$/.test(city.Type.WidgetId), "reference selector -> combo box not stored");
    }
    let stray = false;
    walk(conv || {}, o => o.Name && /_zzConverted$/.test(o.Name) && (stray = true));
    say(!stray, "a converted widget was left behind");
    // W6
    const login = units[`${T}WLogin`];
    const types = new Set();
    walk(login || {}, o => types.add(o.$Type));
    say(["Forms$LoginIdTextBox", "Forms$PasswordTextBox", "Forms$LoginButton", "Forms$ValidationMessage"].every(t => types.has(t)), `login page widgets not stored (${[...types].filter(t => /Login|Password|Validation/.test(t)).join(", ")})`);
    let lb = null;
    walk(login || {}, o => o.$Type === "Forms$LoginButton" && (lb = o));
    say(lb && lb.ValidationMessageWidget === "validationMessage1", "sign-in button not linked to its validation message");
    if (x.nav) {
        let nd = null;
        for (const id of project.units.keys()) if (project.read(id).$Type === "Navigation$NavigationDocument") nd = project.read(id);
        const prof = nd && nd.Profiles.find(p => p.Name === "Responsive");
        say(prof && prof.LoginPageSettings && prof.LoginPageSettings.Form === `${mod}.${T}WLogin`, "sign-in page of the Responsive profile not stored");
    }
    return r;
}

async function widgetsPhase({ s2, reopen, copy, mod, T, layout, layoutProblems, check, results }) {
    const x = wTargets(s2);
    const plan = wPlan(mod, T, x);
    const problems = [];
    const refused = async (sess, list) => {
        for (const [o, re] of list) {
            let msg = "";
            try {
                await sess.ops.runPlan({ ops: [o] }, () => {});
            } catch (e) {
                msg = e.message;
            }
            if (!re.test(msg)) problems.push(`${o.op} ${o.name || o.widget || ""} not refused with ${re}${msg ? `: ${msg.slice(0, 160)}` : " (it ran)"}`);
        }
    };
    let s = s2;
    const before = new Set(s.ctx.project.units.keys());
    problems.push(...(await s.ops.runPlan({ ops: plan.ops }, () => {})));
    await s.model.flushChanges();
    const enc = s.client.encode();
    enc.plainFiles = require("./files").encode(s.client);
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
    const firstUse = [...new Set(s.client.summary().warnings.filter(w => /never occurs|first use/.test(w)).map(w => w.split(/[ :(]/)[0]).filter(w => w.includes("$")))];
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
    problems.push(...wProblems(s.ctx.project, mod, T, x));
    await refused(s, plan.refuse);
    if (!x.nav) results.push("SKIP widgets: navigation tree / menu bar / sign-in page setting: no Responsive navigation profile");
    if (!x.menu) results.push("SKIP widgets: simple menu bar on a menu document: no menu document in this project");
    const what = ["tab pages (add with widgets / remove / move / rename caption and name / default, addWidgets into a tab)", x.nav && "navigation tree, menu bar", x.menu && "simple menu bar (menu document, orientation)",
        "scroll container (regions, width, layout mode; changeWidget regions add / remove / change)", "side bar toggle, page title, label, back button, link button", "navigation list (items, actions; changeWidget items add / remove / move / change; addWidgets into an item)",
        `convertWidget (container -> group box${x.combo ? ", drop-down -> combo box -> radio buttons, reference selector -> combo box" : ""})`, `createLoginPage (sign-in widgets${x.nav ? ", sign-in page of the profile" : ""})`, "deprecated widgets refused", `${plan.refuse.length} refusals`].filter(Boolean);
    check(`widgets: ${what.join("; ")}; stored with Studio Pro's keys, reopen 0 errors`, !problems.length, [...new Set(problems)].slice(0, 6).join("; "));
    if (firstUse.length) results.push(`NOTE widgets: no Studio Pro sample in this project of ${firstUse.length} type(s) (SDK layout): ${firstUse.slice(0, 12).join(", ")}`);
    return reopen(copy);
}

module.exports = { widgetsPhase, wPlan, wTargets, wProblems };
