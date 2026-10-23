"use strict";
// selftest phase native (selftest-native.js): native mobile styling (theme-native.js) on a copy: setNativeVariables
// (an Atlas value, a new key, light / dark, a reference to another variable), setNativeTokens (colour scales, spacing,
// radius, font sizes with line heights, elevation levels, dark mode), addNativeStyle (a container class that includes
// an elevation level and theme variables, a button class), addNativeDesignProperty (an option with its own style class),
// a native page whose widgets take those classes and the design property (createPage, then changeWidget), the NATIVE
// STYLE CHECK (an unknown class, a list inside a clickable container), and the refusals (web CSS, px units, unknown
// style keys and variables with "did you mean", a duplicate class, a dashed class name, a Marketplace module, a
// ColorPicker, inline CSS on a native widget); every core native widget kind, page edits on a native page, a native
// pluggable widget of widgets/*.mpk, and the refusals of web-only widgets, actions and native / web page mixes. The
// native theme files of the project are copied into the copy first; a project without a native theme gets an empty
// theme/native/custom-variables.js there (NOTE line). Files are read back (node --check, values), the page from the
// saved unit; the copy reopens with 0 errors and 0 deltas, new units roundtrip byte for byte. The copy's theme/
// folder is put back as it was afterwards.
const fs = require("fs");
const path = require("path");
const bson = require("./bson");
const { lostProperties } = require("./lost");
const nj = require("./native-js");

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};

// the project's native theme files into the copy (the selftest copies only design-properties.json)
function copyNativeTheme(src, dir) {
    let copied = 0;
    const cp = (from, to) => {
        if (!fs.existsSync(from) || fs.existsSync(to)) return;
        fs.cpSync(from, to, { recursive: true, filter: f => !/node_modules|\.git$/.test(f) });
        copied++;
    };
    cp(path.join(src.dir, "theme", "native"), path.join(dir, "theme", "native"));
    const ts = path.join(src.dir, "themesource");
    if (fs.existsSync(ts)) for (const m of fs.readdirSync(ts)) {
        const from = path.join(ts, m, "native"), to = path.join(dir, "themesource", m, "native");
        if (!fs.existsSync(from)) continue;
        // design-properties.json is there already: copy the rest file by file
        for (const e of fs.readdirSync(from, { withFileTypes: true })) cp(path.join(from, e.name), path.join(to, e.name));
    }
    return copied;
}

// theme/ of the copy (files and folders) before the phase, to put it back afterwards: later phases copy the project's
// theme folder only when the copy has none (themesource/ keeps the native design property the page uses)
function snapshot(dir) {
    const files = new Map(), dirs = new Set();
    const walkDir = rel => {
        const abs = path.join(dir, rel);
        if (!fs.existsSync(abs)) return;
        dirs.add(rel);
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
            const r = path.join(rel, e.name);
            if (e.isDirectory()) walkDir(r);
            else files.set(r, fs.readFileSync(path.join(dir, r)));
        }
    };
    walkDir("theme");
    return { files, dirs };
}
function putBack(dir, snap) {
    const now = snapshot(dir);
    for (const [r, b] of snap.files) if (!now.files.has(r) || !now.files.get(r).equals(b)) fs.writeFileSync(path.join(dir, r), b);
    for (const r of now.files.keys()) if (!snap.files.has(r)) fs.rmSync(path.join(dir, r));
    for (const r of [...now.dirs].sort((a, b) => b.length - a.length)) if (!snap.dirs.has(r)) fs.rmSync(path.join(dir, r), { recursive: true, force: true });
}

function nativeTargets(s, mod) {
    const project = s.ctx.project;
    const x = { nativeLayout: false, own: null, market: null };
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Layout" && u.Content && u.Content.$Type === "Forms$NativeLayoutContent") {
            x.nativeLayout = true;
            if (u.Content.LayoutType === "Popup") x.popup = u.Name;
        }
    }
    const m = s.model.allModules();
    const me = m.find(z => z.name === mod);
    if (me && !me.fromAppStore) x.own = mod;
    const mk = m.find(z => z.fromAppStore);
    if (mk) x.market = mk.name;
    // a JavaScript action called by its name alone (N9): NanoflowCommons.GetPlatform when the app has it
    const js = s.model.allJavaScriptActions().filter(a => a.name === "GetPlatform");
    x.getPlatform = js.length === 1 ? js[0].qualifiedName : null;
    x.biometric = s.model.allJavaScriptActions().some(a => a.name === "BiometricAuthentication");
    // pluggable widgets of widgets/*.mpk: a native one (com.mendix.widget.native.*) and a web one
    const pl = [...require("./pluggable").installed(project.dir).keys()];
    x.nativePl = pl.find(id => /^com\.mendix\.widget\.native\./.test(id)) || null;
    x.webPl = pl.find(id => !/\.native\./.test(id)) || null;
    // a web page without parameters (showPage from a native page is refused)
    const webLayouts = new Set();
    const modName = id => {
        for (let c = id; c; c = project.units.get(c) && project.units.get(c).containerId) {
            const u = project.read(c);
            if (/^Projects\$Module/.test(u.$Type)) return u.Name;
        }
        return null;
    };
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Layout" && u.Content && u.Content.$Type === "Forms$WebLayoutContent") webLayouts.add(`${modName(id)}.${u.Name}`);
    }
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (!x.webPage && u.$Type === "Forms$Page" && u.FormCall && webLayouts.has(u.FormCall.Form) && !(u.Parameters || []).length) x.webPage = `${modName(id)}.${u.Name}`;
    }
    return x;
}

function nativePlan(mod, T, x) {
    const card = `${T[0].toLowerCase()}${T.slice(1)}Card`, btn = `${T[0].toLowerCase()}${T.slice(1)}Btn`, flat = `${T[0].toLowerCase()}${T.slice(1)}Flat`;
    const dp = `${T} native card`;
    const ops = [
        { op: "setNativeVariables", variables: { "brand.primary": "#0B5FFF", "spacing.regular": 18, border: { radiusLarge: 12 }, "background.primary": { light: "#FFFFFF", dark: "#0A1325" } } },
        { op: "setNativeTokens", tokens: { colors: { primary: { 50: "#EEF4FF", 500: "#0B5FFF" }, success: "#1E8E3E", surface: "#F6F7F9", text: "#111827", border: "#D1D5DB", accent: "#FF00FF" },
            spacing: { xs: 4, sm: "8px", md: 16 }, radius: { sm: 4, md: 8, full: 9999 }, typography: { fontSize: { sm: 12, md: 14, h1: 32 }, lineHeight: 1.5 },
            elevation: { 1: "0 1px 2px rgba(0,0,0,0.15)", 2: "0 4px 8px rgba(0,0,0,0.2)" }, dark: { surface: "#161F30", text: "#F9FAFB", border: "#3B4251" } } },
        { op: "setNativeVariables", variables: { "button.container.borderRadius": "$border.radiusLarge" } }
    ];
    const refuse = [];
    if (x.own) {
        ops.push(
            { op: "addNativeStyle", module: mod, name: card, widgetType: "Container", style: { container: { use: "$elevation.level2", backgroundColor: "$background.secondary", borderRadius: "$border.radiusLarge", padding: "$spacing.regular", shadowOffset: { width: 0, height: 2 } } } },
            { op: "addNativeStyle", module: mod, name: btn, widgetType: "ActionButton", style: { container: { backgroundColor: "$brand.primary", minHeight: 48 }, caption: { color: "#FFFFFF", fontWeight: "600", textTransform: "uppercase" } } },
            { op: "addNativeDesignProperty", module: mod, widgetType: "DivContainer", name: dp, type: "Dropdown", options: [{ name: "Flat", class: flat, style: { container: { elevation: 0 } } }, { name: "Raised", class: card }] }
        );
        refuse.push(
            [{ op: "addNativeStyle", module: mod, name: `${card}X`, style: { container: { "box-shadow": "0 2px 4px #000" } } }, /web CSS; use elevation/],
            [{ op: "addNativeStyle", module: mod, name: `${card}X`, style: { container: { padding: "16px" } } }, /numbers without a unit: 16/],
            [{ op: "addNativeStyle", module: mod, name: `${card}X`, style: { container: { backgroundColour: "#FFFFFF" } } }, /Did you mean: backgroundColor/],
            [{ op: "addNativeStyle", module: mod, name: `${card}X`, style: { container: { "background-color": "#FFFFFF" } } }, /camelCase: "backgroundColor"/],
            [{ op: "addNativeStyle", module: mod, name: `${card}X`, widgetType: "ActionButton", style: { text: { color: "#FFFFFF" } } }, /has no element 'text'/],
            [{ op: "addNativeStyle", module: mod, name: card, style: { container: { opacity: 0.5 } } }, /already has the class/],
            [{ op: "addNativeStyle", module: mod, name: "zz-card", style: { container: { opacity: 0.5 } } }, /not a native class name/],
            [{ op: "addNativeStyle", module: mod, name: `${card}X`, style: { container: { padding: "$spacng.regular" } } }, /Did you mean: spacing/],
            [{ op: "addNativeDesignProperty", module: mod, widgetType: "DivContainer", name: `${dp} 2`, type: "ColorPicker", options: [{ name: "Red", class: "red" }] }, /native styles have no CSS/],
            [{ op: "addNativeDesignProperty", module: mod, widgetType: "DivContainer", name: dp, type: "Toggle", class: card }, /already has a native design property/]
        );
        if (x.market) refuse.push([{ op: "addNativeStyle", module: x.market, name: `${card}X`, style: { container: { opacity: 0.5 } } }, /Marketplace module/]);
    }
    if (x.getPlatform) ops.push({ op: "createNanoflow", module: mod, name: `${T}_NatPlatform`, folder: "ZzNative", actions: [{ action: "callJavaScript", jsAction: "GetPlatform", variable: "Platform" }] });
    if (!x.biometric) refuse.push([{ op: "createNanoflow", module: mod, name: `${T}_NatBio`, actions: [{ action: "callJavaScript", jsAction: "BiometricAuthentication", variable: "Ok" }] }, /JavaScript action of the NativeMobileResources module, which this app does not have/]);
    refuse.push(
        [{ op: "setNativeVariables", variables: { "brand.primry": "#000000" } }, /Did you mean: brand\.primary/],
        [{ op: "setNativeVariables", variables: { "brand.primary": "12" } }, /is a colour/],
        [{ op: "setNativeVariables", variables: { "spacing.regular": "16px" } }, /without a unit: 16/]
    );
    let page = null;
    if (x.nativeLayout) {
        page = `${mod}.${T}_Native2`;
        ops.push(
            { op: "createEntity", module: mod, name: `${T}NatE`, attributes: [{ name: "Title", type: "String(100)" }] },
            { op: "createPage", module: mod, name: `${T}_Native2`, native: true, folder: "ZzNative", widgets: [
                { widget: "container", name: "zzNatCard", ...(x.own ? { class: card, design: { [dp]: "Raised" } } : { class: "zzNope" }), widgets: [
                    { widget: "text", name: "zzNatText", text: "Hello" },
                    { widget: "actionButton", name: "zzNatBtn", caption: "Go", action: "close", class: x.own ? `${btn} zzNope` : "zzNope" }
                ] },
                { widget: "container", name: "zzNatTap", onClick: { action: "close" }, widgets: [{ widget: "listView", name: "zzNatList", entity: `${mod}.${T}NatE`, fields: ["Title"] }] }
            ] },
            ...(x.own ? [{ op: "changeWidget", page, widget: "zzNatCard", design: { [dp]: "Flat" } }, { op: "changeWidget", page, widget: "zzNatText", class: card }] : [])
        );
        // every core native widget kind (N1), page edits on a native page (N4), a native pluggable widget (N2)
        ops.push(
            { op: "createEnumeration", module: mod, name: `${T}NatS`, values: ["Open", "Done"] },
            { op: "createEntity", module: mod, name: `${T}NatO`, attributes: [{ name: "Note", type: "String(500)" }, { name: "State", type: `Enum(${mod}.${T}NatS)` }, { name: "When", type: "DateTime" }, { name: "Paid", type: "Boolean" }] },
            { op: "addAssociation", from: `${mod}.${T}NatO`, to: `${mod}.${T}NatE`, name: `${T}NatO_NatE` },
            { op: "createPage", module: mod, name: `${T}_Native3`, native: true, folder: "ZzNative", entity: `${mod}.${T}NatO`, widgets: [
                { widget: "dataView", name: "zzNatDv", source: "parameter", fields: [], widgets: [
                    { widget: "textArea", name: "zzNatNote", attribute: "Note" },
                    { widget: "dropDown", name: "zzNatState", attribute: "State" },
                    { widget: "radioButtons", name: "zzNatRadio", attribute: "State" },
                    { widget: "datePicker", name: "zzNatWhen", attribute: "When" },
                    { widget: "checkBox", name: "zzNatPaid", attribute: "Paid", visible: { attribute: "State", values: ["Done"] } },
                    { widget: "referenceSelector", name: "zzNatRef", association: `${mod}.${T}NatO_NatE`, attribute: "Title" },
                    { widget: "tabContainer", name: "zzNatTabs", tabs: [{ caption: "A", widgets: [{ widget: "text", text: "a" }] }, { caption: "B", widgets: [] }] },
                    { widget: "layoutGrid", name: "zzNatGrid", columns: [{ weight: 6, widgets: [{ widget: "text", text: "L" }] }, 6] }
                ], footer: [{ widget: "actionButton", name: "zzNatSave", action: "save", caption: "Save" }] }
            ] },
            { op: "addWidgets", page, into: "zzNatCard", widgets: [{ widget: "text", name: "zzNatAdd", text: "Added" }, { widget: "text", name: "zzNatTmp", text: "Tmp" },
                ...(x.nativePl ? [{ widget: "pluggable", name: "zzNatPl", type: x.nativePl, properties: {} }] : [])] },
            ...(x.popup ? [{ op: "createPage", module: mod, name: `${T}_NativePop`, native: "popup", folder: "ZzNative", entity: `${mod}.${T}NatE` }] : []),
            // a native snippet shown on the native page (N5)
            { op: "createSnippet", module: mod, name: `${T}_NatSnippet`, native: true, folder: "ZzNative", widgets: [{ widget: "text", name: "zzNatSnText", text: "In a snippet" }] },
            { op: "addWidgets", page, into: "zzNatCard", widgets: [{ widget: "snippetCall", name: "zzNatSnCall", snippet: `${mod}.${T}_NatSnippet` }] },
            // native navigation (N7): bottom bar items with an icon and a place, the native home page
            { op: "createPage", module: mod, name: `${T}_NativeB`, native: true, folder: "ZzNative", widgets: [{ widget: "text", text: "B" }] },
            { op: "addMenuItem", page, caption: `${T} A`, icon: 57377 },
            { op: "addMenuItem", page: `${mod}.${T}_NativeB`, caption: `${T} B`, before: `${T} A`, icon: 57378 },
            { op: "setHomePage", page: `${mod}.${T}_NativeB`, profile: "Native" },
            { op: "moveWidget", page, widget: "zzNatAdd", before: "zzNatText" },
            { op: "deleteWidget", page, widget: "zzNatTmp" }
        );
        refuse.push(
            [{ op: "changeWidget", page, widget: "zzNatText", style: "color: red;" }, /inline CSS does nothing on a native widget/],
            [{ op: "addWidgets", page, into: "zzNatCard", widgets: [{ widget: "dataGrid", entity: `${mod}.${T}NatE` }] }, /a native page has no dataGrid; use a listView/],
            [{ op: "addWidgets", page, into: "zzNatCard", widgets: [{ widget: "gallery", entity: `${mod}.${T}NatE` }] }, /a native page has no gallery/],
            [{ op: "addWidgets", page, into: "zzNatCard", widgets: [{ widget: "actionButton", caption: "W", action: "callWorkflow", workflow: `${mod}.Nope` }] }, /cannot start a workflow/]
        );
        if (x.webPage) refuse.push([{ op: "addWidgets", page, into: "zzNatCard", widgets: [{ widget: "actionButton", caption: "W", action: "showPage", page: x.webPage }] }, /is a web page; a native page opens only native pages/],
            [{ op: "addWidgets", page: x.webPage, widgets: [{ widget: "actionButton", caption: "N", action: "showPage", page }] }, /is a native page; a web page cannot open it/]);
        if (x.webPage) refuse.push([{ op: "addWidgets", page: x.webPage, widgets: [{ widget: "snippetCall", snippet: `${mod}.${T}_NatSnippet` }] }, /is a native snippet; a web page shows only web snippets/]);
        if (x.webPl) refuse.push([{ op: "addWidgets", page, into: "zzNatCard", widgets: [{ widget: "pluggable", type: x.webPl, properties: {} }] }, /is a web widget; a native page takes native pluggable widgets/]);
        if (x.nativePl && x.webPage) refuse.push([{ op: "addWidgets", page: x.webPage, widgets: [{ widget: "pluggable", type: x.nativePl, properties: {} }] }, /is a native widget; it goes on a native page/]);
    }
    return { ops, refuse, page, card, btn, flat, dp };
}

function nativeProblems(project, mod, T, x, plan) {
    const r = [];
    const say = (ok, what) => ok || r.push(what);
    const dir = project.dir;
    const read = rel => (fs.existsSync(path.join(dir, ...rel.split("/"))) ? fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8") : null);
    const vars = read("theme/native/custom-variables.js");
    say(vars !== null, "theme/native/custom-variables.js missing");
    if (vars !== null) {
        const err = nj.syntaxCheck(vars);
        say(!err, `custom-variables.js does not parse: ${err}`);
        const v = k => (nj.getPath(vars, k.split(".")) || "").trim();
        say(v("brand.primary") === '"#0B5FFF"' && v("brand.primaryLight") === '"#EEF4FF"' && v("brand.success") === '"#1E8E3E"', `brand colours not set: ${v("brand.primary")} ${v("brand.primaryLight")} ${v("brand.success")}`);
        say(/^(adjustFont\()?16\)?$/.test(v("spacing.regular")) && v("spacing.smaller") === "4" && v("spacing.small") === "8", `spacing tokens not set: ${v("spacing.regular")} ${v("spacing.small")}`);
        say(v("border.radiusLarge") === "8" && v("border.radiusLargest") === "9999" && v("button.container.borderRadius") === "border.radiusLarge", `radius / reference not set: ${v("border.radiusLarge")} ${v("button.container.borderRadius")}`);
        say(/^(adjustFont\()?32\)?$/.test(v("font.sizeH1")) && /^(adjustFont\()?48\)?$/.test(v("font.lineHeightH1")), `font size / line height tokens not set: ${v("font.sizeH1")} ${v("font.lineHeightH1")}`);
        const m = nj.parse(vars);
        say(m.exports.has("darkMode"), "darkMode export missing");
        // dark mode: a ternary, or the Atlas defaults it reads
        const darkOk = (p, dark, light) => {
            const t = v(p);
            const tern = /^darkMode \? ([\w$]+)\.([\w$]+) : ([\w$]+)\.([\w$]+)$/.exec(t);
            if (tern) return v(`${tern[1]}.${tern[2]}`) === JSON.stringify(dark) && v(`${tern[3]}.${tern[4]}`) === JSON.stringify(light);
            return t === `darkMode ? ${JSON.stringify(dark)} : ${JSON.stringify(light)}`;
        };
        say(darkOk("background.primary", "#0A1325", "#FFFFFF") && darkOk("background.secondary", "#161F30", "#F6F7F9") && darkOk("font.colorTitle", "#F9FAFB", "#111827"), `dark mode colours not set: ${v("background.primary")} / ${v("background.secondary")} / ${v("font.colorTitle")}`);
        say(/elevation:\s*\d/.test(v("elevation.level2")) && /shadowOffset/.test(v("elevation.level1")), "elevation levels missing");
    }
    if (x.own) {
        const rel = `themesource/${mod.toLowerCase()}/native`;
        const main = read(`${rel}/main.js`);
        say(main !== null && !nj.syntaxCheck(main), `${rel}/main.js missing or not parsing`);
        if (main) {
            const m = nj.parse(main);
            say(m.exports.has(plan.card) && m.exports.has(plan.btn) && m.exports.has(plan.flat), `style classes missing in main.js: ${[...m.exports.keys()].join(", ")}`);
            say(/\.\.\.elevation\.level2/.test(nj.getPath(main, [plan.card, "container"]) || "") && m.imports.some(i => i.names.includes("elevation") && i.names.includes("spacing")), "card class does not use the elevation level / import the variables");
            say((nj.getPath(main, [plan.btn, "caption", "fontWeight"]) || "") === '"600"', "button class caption.fontWeight not stored");
        }
        let j = {};
        try {
            j = JSON.parse(read(`${rel}/design-properties.json`) || "{}");
        } catch (e) {
            r.push(`${rel}/design-properties.json is not JSON`);
        }
        say((j.DivContainer || []).some(p => p.name === plan.dp && p.options.map(o => o.class).join() === `${plan.flat},${plan.card}`), "native design property not in design-properties.json");
    }
    if (x.getPlatform) {
        let nf = null;
        for (const id of project.units.keys()) {
            const p = project.read(id);
            if (p.$Type === "Microflows$Nanoflow" && p.Name === `${T}_NatPlatform`) nf = p;
        }
        say(nf && JSON.stringify(nf).includes(`"JavaScriptAction":"${x.getPlatform}"`), `callJavaScript by name: ${x.getPlatform} not called`);
    }
    if (plan.page) {
        let u = null;
        for (const id of project.units.keys()) {
            const p = project.read(id);
            if (p.$Type === "Forms$Page" && p.Name === `${T}_Native2`) u = p;
        }
        say(!!u, "native page missing");
        const named = {};
        walk(u || {}, o => o.Name && (named[o.Name] = o));
        const cardW = named.zzNatCard, text = named.zzNatText, b = named.zzNatBtn;
        if (x.own) {
            const d = cardW && cardW.Appearance.DesignProperties.find(p => p.Key === plan.dp);
            say(cardW && cardW.Appearance.Class === plan.card && d && d.Value.$Type === "Forms$OptionDesignPropertyValue" && d.Value.Option === "Flat", `native container class / design not stored: ${cardW ? `${cardW.Appearance.Class} ${JSON.stringify(cardW.Appearance.DesignProperties).slice(0, 120)}` : "missing"}`);
            say(text && text.Appearance.Class === plan.card, "changeWidget class on a native text not stored");
            say(b && b.Appearance.Class === `${plan.btn} zzNope`, "native button class not stored");
        }
        say(cardW && !cardW.Appearance.Style && b && !b.Appearance.Style, "a native widget got an inline style");
        // page edits: zzNatAdd moved before zzNatText, zzNatTmp deleted, the native pluggable widget added
        const kids = cardW ? (cardW.Widgets || []).map(w => w.Name || w.$Type) : [];
        say(kids.indexOf("zzNatAdd") >= 0 && kids.indexOf("zzNatAdd") < kids.indexOf("zzNatText") && !kids.includes("zzNatTmp"), `addWidgets / moveWidget / deleteWidget on a native page: ${kids.join(", ")}`);
        if (x.nativePl) say(named.zzNatPl && named.zzNatPl.$Type === "CustomWidgets$CustomWidget" && named.zzNatPl.Type && named.zzNatPl.Type.WidgetId === x.nativePl, `native pluggable widget ${x.nativePl} not stored`);
        let u3 = null;
        for (const id of project.units.keys()) {
            const p = project.read(id);
            if (p.$Type === "Forms$Page" && p.Name === `${T}_Native3`) u3 = p;
        }
        const types = {};
        walk(u3 || {}, o => o.Name && (types[o.Name] = o));
        const want = { zzNatNote: "Forms$TextArea", zzNatState: "Forms$DropDown", zzNatRadio: "Forms$RadioButtonGroup", zzNatWhen: "Forms$DatePicker", zzNatPaid: "Forms$CheckBox", zzNatRef: "Forms$ReferenceSelector", zzNatTabs: "Forms$TabControl", zzNatGrid: "Forms$LayoutGrid", zzNatSave: "Forms$ActionButton" };
        const bad = Object.entries(want).filter(([n, t]) => !types[n] || types[n].$Type !== t).map(([n, t]) => `${n} (${types[n] ? types[n].$Type : "missing"}, want ${t})`);
        say(!bad.length, `native page widget kinds not stored: ${bad.join(", ")}`);
        say(types.zzNatPaid && types.zzNatPaid.ConditionalVisibilitySettings, "conditional visibility on a native check box not stored");
        let nav = null;
        for (const id of project.units.keys()) {
            const p = project.read(id);
            if (p.$Type === "Navigation$NavigationDocument") nav = p;
        }
        const np = nav && nav.Profiles.find(p => p.$Type === "Navigation$NativeNavigationProfile");
        const bb = np ? np.BottomBarItems : [];
        const ia = bb.findIndex(b => b.Page === plan.page), ib = bb.findIndex(b => b.Page === `${mod}.${T}_NativeB`);
        say(ia >= 0 && ib >= 0 && ib < ia && bb[ia].Icon && bb[ia].Icon.$Type === "Forms$GlyphIcon" && bb[ia].Icon.Code === 57377, `native bottom bar items (icon, before) not stored: ${JSON.stringify(bb.map(b => [b.Page, b.Icon && b.Icon.Code])).slice(0, 200)}`);
        say(np && JSON.stringify(np.NativeHomePage || {}).includes(`${T}_NativeB`), "native home page not stored");
        let sn = null;
        for (const id of project.units.keys()) {
            const p = project.read(id);
            if (p.$Type === "Forms$Snippet" && p.Name === `${T}_NatSnippet`) sn = p;
        }
        say(sn && sn.Type === "Native" && named.zzNatSnCall && named.zzNatSnCall.$Type === "Forms$SnippetCallWidget", `native snippet / snippet call not stored: ${sn ? sn.Type : "missing"}`);
        if (x.popup) {
            let pop = null;
            for (const id of project.units.keys()) {
                const p = project.read(id);
                if (p.$Type === "Forms$Page" && p.Name === `${T}_NativePop`) pop = p;
            }
            say(pop && pop.FormCall && pop.FormCall.Form.endsWith(`.${x.popup}`), `native pop-up page not on the Popup layout ${x.popup}: ${pop && pop.FormCall ? pop.FormCall.Form : "missing"}`);
        }
    }
    return r;
}

async function nativePhase({ s2, reopen, copy, src, mod, T, layout, layoutProblems, check, results }) {
    let s = s2;
    const dir = s.ctx.project.dir;
    const snap = snapshot(dir);
    const copied = copyNativeTheme(src, dir);
    let made = false;
    if (!fs.existsSync(path.join(dir, "theme", "native", "custom-variables.js"))) {
        fs.mkdirSync(path.join(dir, "theme", "native"), { recursive: true });
        fs.writeFileSync(path.join(dir, "theme", "native", "custom-variables.js"), "");
        made = true;
    }
    const x = nativeTargets(s, mod);
    // no test project has a native profile: one made with the SDK's defaults, as Studio Pro adds it (phase pages2 too)
    if (x.nativeLayout) {
        const sdk = require("mendixmodelsdk");
        const nav = await s.model.allNavigationDocuments()[0].load();
        if (!nav.profiles.some(p => p instanceof sdk.navigation.NativeNavigationProfile)) sdk.navigation.NativeNavigationProfile.createIn(nav).name = "Native";
    }
    const plan = nativePlan(mod, T, x);
    const problems = [];
    const before = new Set(s.ctx.project.units.keys());
    const lint = await s.ops.runPlan({ ops: plan.ops }, () => {});
    problems.push(...lint);
    await s.model.flushChanges();
    const nl = require("./theme-native").nativeStyleLint(s.client);
    if (plan.page) {
        if (!nl.some(l => /zzNatBtn: class 'zzNope' is not a native style class/.test(l))) problems.push(`NATIVE STYLE CHECK misses the unknown class zzNope: ${nl.join(" / ").slice(0, 200)}`);
        if (!nl.some(l => /zzNatList: a scrolling list inside the clickable container zzNatTap/.test(l))) problems.push(`NATIVE STYLE CHECK misses the list inside a clickable container: ${nl.join(" / ").slice(0, 200)}`);
        if (x.own && nl.some(l => new RegExp(`class '${plan.card}'|class '${plan.btn}'`).test(l))) problems.push(`NATIVE STYLE CHECK reports a class made in this change: ${nl.filter(l => /class '/.test(l)).join(" / ")}`);
    }
    if (nl.some(l => /does not parse|not a React Native style property/.test(l))) problems.push(`NATIVE STYLE CHECK on the new files: ${nl.filter(l => /does not parse|not a React Native/.test(l)).join(" / ").slice(0, 200)}`);
    const enc = s.client.encode();
    enc.plainFiles = require("./files").encode(s.client);
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
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
    problems.push(...nativeProblems(s.ctx.project, mod, T, x, plan));
    for (const [o, re] of plan.refuse) {
        let msg = "";
        try {
            await s.ops.runPlan({ ops: [o] }, () => {});
        } catch (e) {
            msg = e.message;
        }
        if (!re.test(msg)) problems.push(`${o.op} ${o.name || o.widget || Object.keys(o.variables || {})[0] || ""} not refused with ${re}${msg ? `: ${msg.slice(0, 160)}` : " (it ran)"}`);
    }
    const what = ["setNativeVariables (value, light/dark, reference)", "setNativeTokens (colour scales, spacing, radius, font sizes + line heights, elevation, dark mode)",
        x.own && "addNativeStyle (elevation level, theme variables, button)", x.own && "addNativeDesignProperty", plan.page && "native page with classes" + (x.own ? " + native design (createPage, changeWidget)" : ""),
        plan.page && "every core native widget kind (text area, drop-down, radio buttons, date picker, check box with visibility, reference selector, tab container, layout grid)",
        plan.page && `addWidgets / moveWidget / deleteWidget on a native page${x.nativePl ? `, native pluggable ${x.nativePl.split(".").pop()}` : ""}${x.popup ? ", native pop-up page" : ""}, native snippet + snippet call, native bottom bar (icon, place) + home page`,
        x.getPlatform && "callJavaScript by action name (GetPlatform)", plan.page && "NATIVE STYLE CHECK", `${plan.refuse.length} refusals (web CSS, web-only widgets and actions, native / web page mix)`].filter(Boolean);
    if (plan.page && !x.nativePl) results.push("SKIP native: native pluggable widget: no com.mendix.widget.native.* in widgets/");
    if (made) results.push("NOTE native: no native theme in this project; an empty theme/native/custom-variables.js was made in the copy");
    else if (!copied) results.push("NOTE native: no native theme files copied (already in the copy)");
    if (!x.nativeLayout) results.push("SKIP native: page styling: no native layout in this project");
    if (!x.own) results.push(`SKIP native: addNativeStyle / addNativeDesignProperty: ${mod} is a Marketplace module`);
    putBack(dir, snap);
    check(`native: ${what.join("; ")}; files parse (node --check), stored with Studio Pro's keys, reopen 0 errors`, !problems.length, [...new Set(problems)].slice(0, 6).join("; "));
    return reopen(copy);
}

module.exports = { nativePhase, nativePlan, nativeTargets, nativeProblems };
