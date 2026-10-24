"use strict";
// Widget kinds of createPage / addWidgets beyond the data widgets (wave 2): navigation tree, menu bar and simple menu
// bar (menu source: a navigation profile or a menu document), scroll container (regions), side bar toggle, page title,
// label, back button and link button (action buttons, as Mendix 7.3+ stores them), the sign-in widgets of a custom login
// page (login id / password text box, sign-in button, validation message) and the navigation list (items with actions).
// Deprecated widgets (table, vertical flow, split panes) are readable in `widgets` and refused here with what to use.
// Stored keys follow the Studio Pro-saved samples of the test projects: Forms$NavigationTree / MenuBar / SimpleMenuBar
// (MenuSource: Forms$NavigationSource NavigationProfile | Forms$MenuDocumentSource Menu, Orientation),
// Forms$ScrollContainer (CenterRegion / Left / Right / Top / Bottom: Forms$ScrollContainerRegion Size, SizeMode,
// ToggleMode, Appearance; LayoutMode, ScrollBehavior, Alignment, WidthMode, Width), Forms$SidebarToggleButton,
// Forms$Title, Forms$Label (Caption: Texts$Text), Forms$NavigationList (Items: Forms$NavigationListItem Action, Widgets).
// The sign-in widgets have no sample in the test projects (Forms$LoginIdTextBox, Forms$PasswordTextBox,
// Forms$LoginButton, Forms$ValidationMessage): first use, check in Studio Pro. Forms$LinkButton and Forms$BackButton
// were removed in Mendix 7 (SDK versions): Studio Pro stores an action button (RenderType Link / a close page action).
const sdk = require("mendixmodelsdk");
const { fail, bool, enumValue } = require("./ops-util");
const ui = require("./ui");

const { pages, menus, navigation } = sdk;

const MENU = "optional what the menu shows: a navigation profile (\"Responsive\", \"Phone\", ...) or a menu document Module.Menu (default \"Responsive\")";
const BUTTON = Object.fromEntries(Object.entries(ui.KIND_UI.actionButton).filter(([k]) => k !== "ariaRole"));
const REGION = "optional [ widgets ] or { \"widgets\": [...], \"size\": 250, \"sizeMode\": \"pixels\" | \"percentage\" | \"auto\", \"toggleMode\": \"none\" | \"pushContentAside\" | \"slideOverContent\" | \"shrinkContentInitiallyOpen\" | \"shrinkContentInitiallyClosed\", \"class\": ..., \"style\": ... }";
const LOGIN_BOX = { label: "optional label (default: none, as Studio Pro drops it; \"\" = none)", placeholder: "optional placeholder text (default \"User name\" / \"Password\")", labelWidth: "optional label width 1-11 (with a label; default 3)" };
const KINDS = {
    navigationTree: { doc: "a navigation tree (the side bar menu of Atlas layouts): the items of a navigation profile's menu or a menu document", fields: { menu: MENU } },
    menuBar: { doc: "a menu bar (drop-down menus, as Atlas's top bar): the items of a navigation profile's menu or a menu document", fields: { menu: MENU } },
    simpleMenuBar: { doc: "a simple menu bar (one row or column of menu items, e.g. a bottom bar): the items of a navigation profile's menu or a menu document", fields: { menu: MENU, orientation: "optional horizontal | vertical (default horizontal)" } },
    scrollContainer: {
        doc: "a scroll container: a center region and optional left / right / top / bottom regions, each with its own widgets (the frame of Atlas layouts; a side bar region can be toggled with a sidebarToggle)",
        fields: { center: "R [ widgets ] or { \"widgets\": [...], \"class\": ... } of the main region", left: REGION, right: REGION, top: REGION, bottom: REGION,
            layoutMode: "optional headline | sidebar: top / bottom regions span the full width (headline), or the left / right ones the full height (sidebar) (default headline)",
            scrollBehavior: "optional perRegion | fullWidget (default perRegion)", width: "optional full (default), a number of pixels (960) or a percentage \"80%\"", alignment: "optional left | center | right (with a width; default center)" }
    },
    sidebarToggle: { doc: "a side bar toggle button: opens and closes the left / right region of the scroll container (layout) around the page", fields: { caption: "optional caption (default: none, only the icon)", buttonStyle: "optional Default | Primary | Success | Info | Warning | Danger | Inverse (default Default)", ...BUTTON } },
    title: { doc: "the page title (shows the title of the page it is on, as Studio Pro's Page title widget; mostly in layouts and snippets)", fields: {} },
    label: { doc: "a label: a fixed text (no {Attribute}; use \"text\" for values)", fields: { text: "R the label text (texts per language allowed)" } },
    backButton: { doc: "a back button: an action button that closes the current page (Mendix stores no separate back button since Mendix 7: a Close page action)", fields: { caption: "optional (default \"Back\")", buttonStyle: "optional Default | Primary | ... (default Default)", ...BUTTON } },
    linkButton: {
        doc: "a link button: an action button shown as a link (Mendix 7.3+ stores no separate link button: RenderType Link); with url / email / phone / sms it opens that link, with page it opens the page, else give action",
        fields: { caption: "R the link text", url: "optional web address \"https://...\" or { \"attribute\": \"Website\" }", email: "optional e-mail address", phone: "optional phone number to call", sms: "optional phone number to text",
            page: "optional Module.Page to open", action: "optional any actionButton action (with its fields) instead", params: "optional page / flow parameters (as actionButton)", microflow: "optional with action callMicroflow", nanoflow: "optional with action callNanoflow",
            buttonStyle: "optional Default | Primary | ... (the link colour; default Default)", ...Object.fromEntries(Object.entries(BUTTON).filter(([k]) => k !== "renderType")) }
    },
    loginIdTextBox: { doc: "sign-in: the user name text box of a custom login page (with passwordTextBox, loginButton and validationMessage; createLoginPage builds the page)", fields: { ...LOGIN_BOX } },
    passwordTextBox: { doc: "sign-in: the password text box of a custom login page", fields: { ...LOGIN_BOX } },
    loginButton: { doc: "sign-in: the button that signs the user in with the user name and password of the page", fields: { caption: "optional (default \"Sign in\")", buttonStyle: "optional (default Primary)", validationMessage: "optional name of the validationMessage widget that shows a failed sign-in (default: the one on the page)", ...BUTTON } },
    validationMessage: { doc: "sign-in: where a failed sign-in is shown (\"The username or password you entered is incorrect\")", fields: {} },
    navigationList: {
        doc: "a navigation list: rows (items) of widgets, each a link with its own action (as Studio Pro's Navigation list)",
        fields: { items: "R [ { \"caption\": \"Orders\" (a text in the item) or \"widgets\": [ widgets ], \"action\": { \"action\": \"showPage\", \"page\": ... } (as actionButton; default none), \"class\", \"style\" } ]" }
    }
};
const ALIASES = { navtree: "navigationTree", navigationtree: "navigationTree", menubar: "menuBar", simplemenubar: "simpleMenuBar", bottombar: "simpleMenuBar", scrollcontainer: "scrollContainer",
    sidebartogglebutton: "sidebarToggle", sidebartoggle: "sidebarToggle", toggle: "sidebarToggle", pagetitle: "title", backbutton: "backButton", closebutton: "backButton", linkbutton: "linkButton", link: "linkButton",
    loginid: "loginIdTextBox", logintextbox: "loginIdTextBox", usernametextbox: "loginIdTextBox", username: "loginIdTextBox", password: "passwordTextBox", passwordtextbox: "passwordTextBox",
    loginbutton: "loginButton", signinbutton: "loginButton", signin: "loginButton", validationmessage: "validationMessage", navigationlist: "navigationList", navlist: "navigationList" };
// deprecated widgets: readable in `widgets`, refused on create with the modern widget
const DEPRECATED = {
    table: "the table widget is deprecated (Studio Pro no longer offers it): use a layoutGrid (rows of columns), or a dataGrid / listView for objects",
    verticalflow: "the vertical flow widget was removed in Mendix 7.15: use a container (widgets stack top to bottom)",
    horizontalsplitpane: "split panes were removed in Mendix 8: use a layoutGrid with two columns, or a scrollContainer with left / right regions",
    verticalsplitpane: "split panes were removed in Mendix 8: use a layoutGrid with two rows, or a scrollContainer with top / bottom regions",
    splitpane: "split panes were removed in Mendix 8: use a layoutGrid with two columns, or a scrollContainer with left / right regions",
    tablecell: "the table widget is deprecated: use a layoutGrid column"
};
// kinds built as an action button (Mendix stores no separate back / link button): spec -> actionButton spec
const REWRITE = {
    backButton(s) {
        const { caption, buttonStyle, ...rest } = s;
        return { ...rest, widget: "actionButton", action: "close", caption: caption === undefined ? "Back" : caption, ...(buttonStyle !== undefined ? { style: buttonStyle } : {}) };
    },
    linkButton(s, where) {
        const { buttonStyle, ...rest } = s;
        const action = s.action !== undefined ? (typeof s.action === "object" && s.action ? s.action.action : s.action) : ["url", "email", "phone", "sms"].some(k => s[k] !== undefined) ? "openLink" : s.page !== undefined ? "showPage" : null;
        if (!action) throw new Error(`${where}: a link button needs where it goes: "url" (or email / phone / sms), "page", or "action"`);
        const spec = typeof s.action === "object" && s.action ? { ...rest, ...s.action } : { ...rest, action };
        return { ...spec, widget: "actionButton", renderType: "link", ...(buttonStyle !== undefined ? { style: buttonStyle } : {}) };
    }
};

// The menu source of a navigation tree / menu bar / simple menu bar: a menu document (Module.Menu) or a web navigation
// profile by name (default Responsive). h: { model, get }. Returns the text for the summary.
async function menuSource(h, w, spec, where) {
    const { model } = h;
    const v = String(spec === undefined || spec === true ? "Responsive" : spec);
    if (v.includes(".")) {
        const doc = await h.get(v).catch(() => fail(`${where}: menu '${v}' not found`, v, model.allMenuDocuments().map(m => m.qualifiedName)));
        if (!(doc instanceof menus.MenuDocument)) throw new Error(`${where}: menu '${v}' is a ${doc.structureTypeName.split("$")[1]}, not a menu document`);
        pages.MenuDocumentSource.createIn(w).menu = doc;
        return `menu ${doc.qualifiedName}`;
    }
    const nd = model.allNavigationDocuments()[0];
    const nav = nd && (await nd.load());
    const profs = nav ? nav.profiles.filter(p => p instanceof navigation.NavigationProfile) : [];
    const prof = profs.find(p => p.name.toLowerCase() === v.toLowerCase()) || fail(`${where}: no web navigation profile '${v}'${profs.length ? "" : " (this project has none)"}; or give a menu document Module.Menu`, v, profs.map(p => p.name));
    pages.NavigationSource.createIn(w).navigationProfile = prof;
    return `navigation ${prof.name}`;
}

// Region fields of a scroll container: { widgets, size, sizeMode, toggleMode, class, style }
const REGION_KEYS = ["widgets", "size", "sizeMode", "toggleMode", "class", "style"];
const REGIONS = ["center", "left", "right", "top", "bottom"];
function regionSpec(v, where, center) {
    if (Array.isArray(v)) return { widgets: v };
    if (!v || typeof v !== "object") throw new Error(`${where}: a region is [ widgets ] or { "widgets": [...], ... }`);
    const keys = center ? ["widgets", "class", "style"] : REGION_KEYS;
    for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${where}: unknown field '${k}' of a ${center ? "center " : ""}region`, k, keys);
    return v;
}

// Child widgets of the new kinds (scan): node.regions / node.items, each with its nodes (scanList(specs, where))
const CHILDREN = {
    scrollContainer(node, s, scanList) {
        node.regions = {};
        for (const r of REGIONS) {
            if (s[r] === undefined) continue;
            const rs = regionSpec(s[r], `${node.where}.${r}`, r === "center");
            node.regions[r] = { spec: rs, widgets: scanList(rs.widgets, `${node.where}.${r}.widgets`) };
        }
    },
    navigationList(node, s, scanList) {
        if (!Array.isArray(s.items) || !s.items.length) throw new Error(`${node.where}: items is a list [ { "caption": "Orders", "action": { "action": "showPage", "page": "Module.Page" } }, ... ]`);
        node.items = s.items.map((it, i) => {
            const at = `${node.where} item ${i + 1}`;
            if (typeof it === "string") it = { caption: it };
            if (!it || typeof it !== "object" || Array.isArray(it)) throw new Error(`${at}: an item is { "caption": ..., "action": ... } or { "widgets": [...], "action": ... }`);
            const keys = ["caption", "widgets", "action", "class", "style"];
            for (const k of Object.keys(it)) if (!keys.includes(k)) fail(`${at}: unknown field '${k}' of a navigation list item`, k, keys);
            if (it.caption === undefined && it.widgets === undefined) throw new Error(`${at}: give "caption" or "widgets"`);
            const widgets = [...(it.caption !== undefined ? [{ widget: "text", text: it.caption }] : []), ...(Array.isArray(it.widgets) ? it.widgets : it.widgets === undefined ? [] : [it.widgets])];
            return { spec: it, where: at, widgets: scanList(widgets, `${at}.widgets`) };
        });
    }
};

const enumOf = (cls, v, where, names) => {
    const k = Object.keys(cls).find(x => cls[x] instanceof cls && x.toLowerCase() === String(v).replace(/[\s_-]/g, "").toLowerCase());
    if (!k) fail(`${where}: '${v}' is not known (use ${names})`, String(v), Object.keys(cls).filter(x => cls[x] instanceof cls).map(x => x[0].toLowerCase() + x.slice(1)));
    return cls[k];
};

function makeKinds(h, getI) {
    const { model, client } = h;
    const I = () => getI();
    const warned = new Set();
    // Studio Pro samples: a type that none of the test projects has gets the first-use warning (once per run)
    const firstUse = (type, where) => {
        if (warned.has(type)) return;
        warned.add(type);
        client.warn(`${type} first use (no Studio Pro sample in the test projects: SDK layout): check it in Studio Pro (${where.split(": ")[0]})`);
    };

    async function menuWidget(cls, prefix, node, target, ctx) {
        const w = cls.create(model);
        target.push(w);
        w.name = node.name || ctx.names.next(prefix);
        if (node.spec.orientation !== undefined) w.orientation = enumOf(pages.SimpleMenuBarOrientation, node.spec.orientation, `${node.where}: orientation`, "horizontal | vertical");
        const src = await menuSource(h, w, node.spec.menu, node.where);
        return `${w.name} (${src}${node.spec.orientation !== undefined ? `, ${w.orientation.name.toLowerCase()}` : ""})`;
    }

    // a scroll container region from its spec (r: { spec, widgets: nodes })
    async function fillRegion(sc, name, r, ctx, where) {
        const reg = name === "center" ? sc.center || pages.ScrollContainerRegion.createInScrollContainerUnderCenter(sc) : pages.ScrollContainerRegion[`createInScrollContainerUnder${name[0].toUpperCase()}${name.slice(1)}`](sc);
        const s = r.spec, bits = [];
        if (s.size !== undefined) {
            const n = Number(s.size);
            if (!Number.isInteger(n) || n < 1) throw new Error(`${where}.${name}: size is a whole number of pixels or percent`);
            reg.size = n;
            if (s.sizeMode === undefined) reg.sizeMode = pages.SizeMode.Pixels;
            bits.push(`size ${n}`);
        }
        if (s.sizeMode !== undefined) reg.sizeMode = enumOf(pages.SizeMode, s.sizeMode, `${where}.${name}: sizeMode`, "auto | pixels | percentage");
        if (s.toggleMode !== undefined) {
            if (!["left", "right"].includes(name)) throw new Error(`${where}.${name}: only a left or right region can be toggled`);
            reg.toggleMode = enumOf(pages.ToggleMode, s.toggleMode, `${where}.${name}: toggleMode`, "none | pushContentAside | slideOverContent | shrinkContentInitiallyOpen | shrinkContentInitiallyClosed");
            bits.push(`toggle ${reg.toggleMode.name}`);
        }
        if (s.class !== undefined) reg.appearance.class = String(s.class);
        if (s.style !== undefined) reg.appearance.style = String(s.style);
        const inner = [];
        for (const ch of r.widgets) inner.push(await I().build(ch, reg.widgets, ctx));
        return `${name}${bits.length ? ` {${bits.join(", ")}}` : ""}: ${inner.join(", ") || "empty"}`;
    }

    // scroll container settings (createPage and changeWidget)
    function scrollSettings(sc, s, where) {
        const out = [];
        if (s.layoutMode !== undefined) out.push(`layout ${(sc.layoutMode = enumOf(pages.LayoutModeType, s.layoutMode, `${where}: layoutMode`, "headline | sidebar")).name}`);
        if (s.scrollBehavior !== undefined) out.push(`scroll ${(sc.scrollBehavior = enumOf(pages.ScrollBehavior, s.scrollBehavior, `${where}: scrollBehavior`, "perRegion | fullWidget")).name}`);
        if (s.width !== undefined) {
            const v = String(s.width).trim();
            const m = /^(\d+)\s*(%|px)?$/.exec(v);
            if (/^(full|auto)$/i.test(v)) sc.widthMode = pages.SizeMode.Auto;
            else if (m && Number(m[1]) > 0) {
                sc.widthMode = m[2] === "%" ? pages.SizeMode.Percentage : pages.SizeMode.Pixels;
                sc.width = Number(m[1]);
            } else throw new Error(`${where}: width '${s.width}' is "full", a number of pixels (960) or a percentage ("80%")`);
            out.push(`width ${sc.widthMode === pages.SizeMode.Auto ? "full" : sc.width + (sc.widthMode === pages.SizeMode.Percentage ? "%" : "px")}`);
        }
        if (s.alignment !== undefined) out.push(`aligned ${(sc.alignment = enumOf(pages.AlignmentEnum, s.alignment, `${where}: alignment`, "left | center | right")).name.toLowerCase()}`);
        return out;
    }

    async function loginBox(cls, prefix, dflt, node, target, ctx) {
        const s = node.spec;
        const w = cls.create(model);
        target.push(w);
        w.name = node.name || ctx.names.next(prefix);
        if (s.label !== undefined && s.label !== "") {
            w.label = sdk.texts.Text.create(model);
            await I().textAll(w.label, s.label, ctx);
        }
        if (s.labelWidth !== undefined) {
            const n = Number(s.labelWidth);
            if (!Number.isInteger(n) || n < 1 || n > 11) throw new Error(`${node.where}: labelWidth is 1-11`);
            w.labelWidth = n;
        }
        await I().textAll(w.placeholder, s.placeholder !== undefined ? s.placeholder : dflt, ctx);
        return `${w.name} (${prefix === "loginIdTextBox" ? "user name" : "password"}${s.label ? `, label "${s.label}"` : ""})`;
    }

    const BUILD = {
        navigationTree: (node, target, ctx) => menuWidget(pages.NavigationTree, "navigationTree", node, target, ctx),
        menuBar: (node, target, ctx) => menuWidget(pages.MenuBar, "menuBar", node, target, ctx),
        simpleMenuBar: (node, target, ctx) => menuWidget(pages.SimpleMenuBar, "simpleMenuBar", node, target, ctx),
        async scrollContainer(node, target, ctx) {
            const sc = pages.ScrollContainer.create(model);
            target.push(sc);
            sc.name = node.name || ctx.names.next("scrollContainer");
            const set = scrollSettings(sc, node.spec, node.where);
            const parts = [];
            for (const r of REGIONS) if (node.regions[r]) parts.push(await fillRegion(sc, r, node.regions[r], ctx, node.where));
            return `${sc.name}${set.length ? ` (${set.join(", ")})` : ""} [${parts.join(" | ")}]`;
        },
        async sidebarToggle(node, target, ctx) {
            const s = node.spec;
            const t = pages.SidebarToggleButton.create(model);
            target.push(t);
            t.name = node.name || ctx.names.next("sidebarToggle");
            t.buttonStyle = enumValue(pages.ButtonStyle, String(s.buttonStyle || "Default"), `buttonStyle (${node.where})`);
            if (!t.caption) t.caption = pages.ClientTemplate.create(model);
            await I().textAll(t.caption.template, s.caption !== undefined ? s.caption : "", ctx);
            if (s.tooltip === undefined) await I().textAll(t.tooltip, "Toggle Menu", ctx);
            if (s.icon === undefined) {
                const want = model.allCustomIconCollections && model.allCustomIconCollections().some(c => c.qualifiedName === "Atlas_Core.Atlas_Filled") ? "Atlas_Core.Atlas_Filled.navigation-menu" : "glyphicon-menu-hamburger";
                const ic = await I().ui().iconOf(want, node.where).catch(() => I().ui().iconOf("glyphicon-menu-hamburger", node.where));
                t.icon = ic.make();
            }
            // on a page (not in a layout, not in a scroll container of its own) it toggles the layout's side bar
            const inPage = !(ctx.page instanceof pages.Layout) && !/\(scrollContainer\)/.test(node.where);
            if (inPage) client.warn(`${node.where}: a side bar toggle opens the side bar region of the layout around the page; check that ${ctx.qn}'s layout has a left or right region that can be toggled`);
            return `${t.name} (side bar toggle)`;
        },
        async title(node, target, ctx) {
            const t = pages.Title.create(model);
            target.push(t);
            t.name = node.name || ctx.names.next("pageTitle");
            return `${t.name} (page title)`;
        },
        async label(node, target, ctx) {
            const l = pages.Label.create(model);
            target.push(l);
            l.name = node.name || ctx.names.next("label");
            if (/\{[A-Za-z_][\w/.]*\}/.test(JSON.stringify(node.spec.text))) throw new Error(`${node.where}: a label shows a fixed text; for {Attribute} use { "widget": "text", ... }`);
            await I().textAll(l.caption, node.spec.text, ctx);
            return `${l.name} (label)`;
        },
        loginIdTextBox: (node, target, ctx) => loginBox(pages.LoginIdTextBox, "loginIdTextBox", "User name", node, target, ctx),
        passwordTextBox: (node, target, ctx) => loginBox(pages.PasswordTextBox, "passwordTextBox", "Password", node, target, ctx),
        async validationMessage(node, target, ctx) {
            const v = pages.ValidationMessage.create(model);
            target.push(v);
            v.name = node.name || ctx.names.next("validationMessage");
            (ctx.built = ctx.built || []).push(v); // for the sign-in button of the same op
            return `${v.name} (sign-in validation message)`;
        },
        async loginButton(node, target, ctx) {
            const s = node.spec;
            const b = pages.LoginButton.create(model);
            target.push(b);
            b.name = node.name || ctx.names.next("loginButton");
            b.buttonStyle = enumValue(pages.ButtonStyle, String(s.buttonStyle || "Primary"), `buttonStyle (${node.where})`);
            await I().templateAll(b, "caption", s.caption !== undefined ? s.caption : "Sign in", ctx, node.where);
            // the validation message: given, else the one of this widget list / page (set once all are built)
            const vm = s.validationMessage !== undefined ? String(s.validationMessage) : null;
            (ctx.after = ctx.after || []).push(() => {
                const all = [];
                if (ctx.page) ctx.page.traverse(x => x instanceof pages.ValidationMessage && all.push(x.name));
                for (const x of ctx.built || []) if (x instanceof pages.ValidationMessage && !all.includes(x.name)) all.push(x.name);
                if (vm !== null && !all.includes(vm)) fail(`${node.where}: validationMessage '${vm}' is no validation message widget here`, vm, all);
                const name = vm !== null ? vm : all[0];
                if (name) b.validationMessageWidget = name;
                else client.warn(`${node.where}: no validationMessage widget: a failed sign-in shows nothing; add { "widget": "validationMessage" }`);
            });
            return `${b.name} (sign in${vm ? `, messages in ${vm}` : ""})`;
        },
        async navigationList(node, target, ctx) {
            const nl = pages.NavigationList.create(model);
            if (nl.items.length) nl.items.clear(); // the SDK creates sample items
            target.push(nl);
            nl.name = node.name || ctx.names.next("navigationList");
            const parts = [];
            for (const it of node.items) {
                const x = pages.NavigationListItem.create(model);
                nl.items.push(x);
                if (it.spec.class !== undefined) x.appearance.class = String(it.spec.class);
                if (it.spec.style !== undefined) x.appearance.style = String(it.spec.style);
                let what = "no action";
                if (it.spec.action !== undefined) {
                    const a = typeof it.spec.action === "string" ? { action: it.spec.action } : it.spec.action;
                    what = await I().makeAction(a, node, ctx, it.where, act => (x.action = act));
                }
                const inner = [];
                for (const ch of it.widgets) inner.push(await I().build(ch, x.widgets, ctx));
                parts.push(`${inner.join(", ") || "empty"} -> ${what}`);
            }
            return `${nl.name} [${parts.join(" | ")}]`;
        }
    };

    return { BUILD, scrollSettings, fillRegion, menuSource: (w, spec, where) => menuSource(h, w, spec, where), enumOf, firstUse };
}

module.exports = { KINDS, ALIASES, DEPRECATED, REWRITE, CHILDREN, REGIONS, REGION_KEYS, regionSpec, makeKinds, menuSource, enumOf };
