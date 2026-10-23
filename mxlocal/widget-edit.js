"use strict";
// changeWidget fields of the layout and navigation widgets (wave 2): "tabs" of a tab container (add / remove / move /
// rename tab pages, the default tab), "regions" of a scroll container (add / change / remove regions, layout mode,
// width), "items" of a navigation list (add / remove / move items, item actions), "menu" of a navigation tree / menu
// bar / simple menu bar; and the ops convertWidget (text box <-> combo box, container <-> group box, classic grid ->
// convertGrid) and createLoginPage (a custom sign-in page). New widgets inside are built by addWidgets on the page as
// it is after the change (names, objects and checks of addWidgets).
const sdk = require("mendixmodelsdk");
const { fail, validName } = require("./ops-util");
const wk = require("./widget-kinds");

const { pages } = sdk;

const TAB_KEYS = ["add", "remove", "move", "rename", "default"];
const TABS_DOC = "tab container: { \"add\": [ { \"caption\": \"Notes\", \"name\": \"tabNotes\", \"widgets\": [...], \"before\" | \"after\": \"<tab>\" | \"position\": 2 } ], \"remove\": [ \"<tab>\" ], \"move\": [ { \"tab\": \"Notes\", \"before\" | \"after\": \"General\" | \"position\": 1 } ], \"rename\": [ { \"tab\": \"General\", \"caption\": \"Main\", \"name\": \"tabMain\" } ], \"default\": \"<tab>\" } (a tab is its name or caption; widgets into a tab page: addWidgets \"into\": \"<tab page name>\")";

const REGIONS_DOC = "scroll container: { \"left\": { \"widgets\": [...], \"size\": 250, \"sizeMode\": \"pixels\", \"toggleMode\": \"slideOverContent\", \"class\": ... } | null (removes the region), \"right\" / \"top\" / \"bottom\" the same, \"center\": { \"widgets\", \"class\", \"style\" }, \"layoutMode\": \"headline\" | \"sidebar\", \"scrollBehavior\": \"perRegion\" | \"fullWidget\", \"width\": \"full\" | 960 | \"80%\", \"alignment\": \"left\" | \"center\" | \"right\" } (widgets are added at the end of the region; a region with a layout placeholder is not removed)";
const ITEMS_DOC = "navigation list: { \"add\": [ { \"caption\": \"Orders\" or \"widgets\": [...], \"action\": { ... }, \"class\", \"position\": 1 } ], \"remove\": [ 2 ], \"move\": [ { \"item\": 3, \"position\": 1 } ], \"change\": [ { \"item\": 1, \"action\": { \"action\": \"showPage\", \"page\": ... } | \"none\", \"class\", \"style\" } ] } (items by number, 1 = the first; widgets into an item: addWidgets \"into\": \"navigationList1/item 2\")";
const MENU_DOC = "navigation tree, menu bar or simple menu bar: what it shows, a navigation profile (\"Responsive\", \"Phone\", ...) or a menu document Module.Menu";

const CONVERT_TO = ["comboBox", "dropDown", "radioButtons", "textBox", "referenceSelector", "groupBox", "container", "dataGrid2"];
const WIDGET_EDIT_OPS = {
    convertWidget: {
        doc: "Turn a widget into a related kind in place, keeping its name, class, style, dynamic class, design properties and visibility: an enumeration / Boolean input (drop-down, radio buttons, check box) <-> a Combo box, a reference selector <-> a Combo box (association), a container <-> a group box (with what is inside), a classic data grid -> a Data grid 2 (convertGrid). The dry run lists what is not carried over.",
        fields: { page: "R Module.Page, Module.Snippet or Module.Layout", widget: "R widget name (see: widgets Module.Page)", to: `R ${CONVERT_TO.join(" | ")} (dataGrid2: a classic data grid, as convertGrid)`,
            caption: "optional to groupBox: its caption (default: none)", captionAttribute: "optional reference selector -> comboBox: the attribute of the other entity it shows (default: the selector's)", collapsible: "optional to groupBox: no | expanded | collapsed" }
    },
    createLoginPage: {
        doc: "Create a custom sign-in page: a user name and a password text box, a validation message and a Sign in button (Studio Pro's sign-in widgets), open to anonymous users (the guest role's module roles) and set as the navigation profile's sign-in page. Without a sign-in page Mendix shows theme/web/login.html.",
        fields: { module: "R module name", name: "optional page name (default Login)", title: "optional page title (default \"Sign in\")", layout: "optional Module.Layout (default: a layout without menu when the project has one, e.g. a blank / pop-up-free Atlas layout; else as createPage)",
            roles: "optional [ \"Module.Role\" ] that may open it (default: the module roles of the anonymous (guest) user role; none when anonymous users are off)", profile: "optional navigation profile whose sign-in page it becomes (default Responsive; false = do not set it)",
            heading: "optional text above the form (default: the title; \"\" = none)", widgets: "optional [ widgets ] below the form (createPage kinds), e.g. a link to a sign-up page", folder: "optional folder path", class: "optional CSS class of the form container (default \"loginpage-form\")" }
    }
};
const WIDGET_EDIT_SYNONYMS = {
    convertWidget: { kind: "use \"to\"", type: "use \"to\"", into: "use \"to\"", target: "use \"to\"", widgetType: "use \"to\"" },
    createLoginPage: { page: "use \"module\" and \"name\"", signInPage: "use \"profile\"", anonymous: "use \"roles\" (default: the anonymous user role's module roles)" }
};

function makeWidgetEdit(h, I, E) {
    const { model, client } = h;

    // a tab page of tc by name or caption (did you mean)
    async function tabOf(tc, ref, where) {
        const s = String(ref);
        const byName = tc.tabPages.find(t => t.name === s);
        if (byName) return byName;
        for (const t of tc.tabPages) if ((await E.textOf(t.caption)) === s) return t;
        const all = [];
        for (const t of tc.tabPages) all.push(t.name, await E.textOf(t.caption));
        return fail(`${where}: ${tc.name} has no tab '${s}' (tabs: ${tc.tabPages.map(t => t.name).join(", ")})`, s, all);
    }
    // where a tab goes: { before | after: "<tab>" } or { position: 1-based }; null = at the end
    async function tabIndex(tc, s, where, self) {
        const given = ["before", "after", "position"].filter(k => s[k] !== undefined);
        if (given.length > 1) throw new Error(`${where}: give one of before, after, position`);
        if (!given.length) return null;
        if (s.position !== undefined) {
            const n = Number(s.position);
            const max = tc.tabPages.length + (self ? 0 : 1);
            if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${where}: position is 1-${max}`);
            return n - 1;
        }
        const other = await tabOf(tc, s.before !== undefined ? s.before : s.after, where);
        if (other === self) throw new Error(`${where}: a tab cannot go before or after itself`);
        const list = tc.tabPages.filter(t => t !== self);
        return list.indexOf(other) + (s.after !== undefined ? 1 : 0);
    }
    const list = (v, where, what) => {
        if (v === undefined) return [];
        if (!Array.isArray(v)) return [v];
        if (!v.length) throw new Error(`${where}: ${what} is empty`);
        return v;
    };

    const CHANGE = {
        async menu(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!(w instanceof pages.MenuWidget)) throw new Error(`${where}: ${node.name} is a ${E.kindOf(w)}; "menu" changes a navigation tree, menu bar or simple menu bar`);
            return `menu: ${await wk.menuSource(h, w, v, where)}`;
        },
        async regions(P, node, v, dc, ctx, where) {
            const sc = node.el;
            if (!(sc instanceof pages.ScrollContainer)) throw new Error(`${where}: ${node.name} is a ${E.kindOf(sc)}; "regions" changes a scroll container`);
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: ${REGIONS_DOC}`);
            const keys = [...wk.REGIONS, "layoutMode", "scrollBehavior", "width", "alignment"];
            for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${where}: unknown field '${k}' of regions`, k, keys);
            const K = I.kinds();
            const done = K.scrollSettings(sc, v, where);
            for (const r of wk.REGIONS) {
                if (v[r] === undefined) continue;
                const at = `${where}.${r}`;
                const prop = r === "center" ? "center" : r;
                if (v[r] === null || v[r] === false) {
                    if (r === "center") throw new Error(`${at}: the center region stays (a scroll container always has one)`);
                    const reg = sc[prop];
                    if (!reg) {
                        done.push(`no ${r} region (had none)`);
                        continue;
                    }
                    let ph = null;
                    reg.traverse(x => x instanceof pages.Placeholder && !ph && (ph = x.name));
                    if (ph) throw new Error(`${at}: the ${r} region holds placeholder ${ph}; pages fill it, so it stays (move or delete the placeholder first)`);
                    const P2 = await E.open(P.qn, at);
                    for (const w of reg.widgets) {
                        const n2 = P2.nodes.find(x => x.el === w);
                        if (n2) E.removable(P2, n2, at);
                    }
                    reg.delete();
                    done.push(`-${r} region`);
                    continue;
                }
                const rs = wk.regionSpec(v[r], at, r === "center");
                const fresh = !sc[prop];
                const reg = sc[prop] || pages.ScrollContainerRegion[`createInScrollContainerUnder${r[0].toUpperCase()}${r.slice(1)}`](sc);
                const bits = [];
                if (rs.size !== undefined) {
                    const n = Number(rs.size);
                    if (!Number.isInteger(n) || n < 1) throw new Error(`${at}: size is a whole number of pixels or percent`);
                    reg.size = n;
                    if (rs.sizeMode === undefined && reg.sizeMode === pages.SizeMode.Auto) reg.sizeMode = pages.SizeMode.Pixels;
                    bits.push(`size ${n}`);
                }
                if (rs.sizeMode !== undefined) bits.push(`size mode ${(reg.sizeMode = wk.enumOf(pages.SizeMode, rs.sizeMode, `${at}: sizeMode`, "auto | pixels | percentage")).name}`);
                if (rs.toggleMode !== undefined) {
                    if (!["left", "right"].includes(r)) throw new Error(`${at}: only a left or right region can be toggled`);
                    bits.push(`toggle ${(reg.toggleMode = wk.enumOf(pages.ToggleMode, rs.toggleMode, `${at}: toggleMode`, "none | pushContentAside | slideOverContent | shrinkContentInitiallyOpen | shrinkContentInitiallyClosed")).name}`);
                }
                for (const k of ["class", "style"]) if (rs[k] !== undefined) {
                    reg.appearance[k] = String(rs[k]);
                    bits.push(`${k} "${rs[k]}"`);
                }
                if (rs.widgets !== undefined) {
                    if (!Array.isArray(rs.widgets)) throw new Error(`${at}: widgets is a list [ { "widget": ... } ]`);
                    const name = sc.name;
                    (ctx.later = ctx.later || []).push(async () => {
                        const P2 = await E.open(P.qn, at);
                        const res = await E.addWidgetsAt(P2, E.place(P2, { into: name, slot: r }, at), { page: P.qn, widgets: rs.widgets }, at);
                        return `${r} region: ${res.replace(/^[^:]*: /, "")}`;
                    });
                }
                done.push(`${fresh ? "+" : ""}${r} region${bits.length ? ` (${bits.join(", ")})` : ""}`);
            }
            if (!done.length) throw new Error(`${where}: nothing to change; ${REGIONS_DOC}`);
            return `regions: ${done.join(", ")}`;
        },
        async items(P, node, v, dc, ctx, where) {
            const nl = node.el;
            if (!(nl instanceof pages.NavigationList)) throw new Error(`${where}: ${node.name} is a ${E.kindOf(nl)}; "items" changes a navigation list`);
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: ${ITEMS_DOC}`);
            const IK = ["add", "remove", "move", "change"];
            for (const k of Object.keys(v)) if (!IK.includes(k)) fail(`${where}: unknown field '${k}' of items`, k, IK);
            const done = [];
            const itemAt = (n, at) => {
                const i = Number(n);
                if (!Number.isInteger(i) || i < 1 || i > nl.items.length) throw new Error(`${at}: item ${n} does not exist (${nl.name} has ${nl.items.length} item(s): 1-${nl.items.length})`);
                return nl.items[i - 1];
            };
            // remove (highest number first, so the numbers given stay right)
            const rem = list(v.remove, where, "remove").map(n => itemAt(n, `${where}.remove`));
            if (rem.length && rem.length >= nl.items.length && !list(v.add, where, "add").length) throw new Error(`${where}.remove: that removes every item of ${nl.name}; delete the navigation list instead (deleteWidget)`);
            const P2 = rem.length ? await E.open(P.qn, where) : null;
            for (const it of rem) {
                for (const w of it.widgets) {
                    const n2 = P2.nodes.find(x => x.el === w);
                    if (n2) E.removable(P2, n2, `${where}.remove`);
                }
            }
            for (const it of rem) {
                done.push(`-item ${nl.items.indexOf(it) + 1}`);
                it.delete();
            }
            const scopeNode = { container: dc, name: node.name };
            const act = async (a, x, at) => {
                if (a === null || /^none$/i.test(String(a))) {
                    x.action = pages.NoAction.create(model);
                    return "no action";
                }
                const spec = typeof a === "string" ? { action: a } : a;
                if (!ctx.scope || !ctx.scope.length) ctx.scope = await E.scopeOf(P, at);
                return I.makeAction(spec, scopeNode, ctx, at, n => (x.action = n));
            };
            for (const [i, a] of list(v.add, where, "add").entries()) {
                const at = `${where}.add[${i + 1}]`;
                const s = typeof a === "string" ? { caption: a } : a;
                if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${at}: a new item is { "caption": "Orders", "action": ... }`);
                const keys = ["caption", "widgets", "action", "class", "style", "position"];
                for (const k of Object.keys(s)) if (!keys.includes(k)) fail(`${at}: unknown field '${k}'`, k, keys);
                if (s.caption === undefined && s.widgets === undefined) throw new Error(`${at}: give "caption" or "widgets"`);
                const x = pages.NavigationListItem.create(model);
                if (s.position !== undefined) {
                    const n = Number(s.position);
                    if (!Number.isInteger(n) || n < 1 || n > nl.items.length + 1) throw new Error(`${at}: position is 1-${nl.items.length + 1}`);
                    nl.items.splice(n - 1, 0, x);
                } else nl.items.push(x);
                for (const k of ["class", "style"]) if (s[k] !== undefined) x.appearance[k] = String(s[k]);
                const what = s.action !== undefined ? await act(s.action, x, at) : "no action";
                const widgets = [...(s.caption !== undefined ? [{ widget: "text", text: s.caption }] : []), ...[].concat(s.widgets || [])];
                const name = node.name;
                (ctx.later = ctx.later || []).push(async () => {
                    const P3 = await E.open(P.qn, at);
                    const n = nl.items.indexOf(x) + 1;
                    const r = await E.addWidgetsAt(P3, E.place(P3, { into: `${name}/item ${n}` }, at), { page: P.qn, widgets }, at);
                    return `item ${n}: ${r.replace(/^[^:]*: /, "")}`;
                });
                done.push(`+item ${nl.items.indexOf(x) + 1} -> ${what}`);
            }
            for (const [i, m] of list(v.move, where, "move").entries()) {
                const at = `${where}.move[${i + 1}]`;
                if (!m || typeof m !== "object" || m.item === undefined || m.position === undefined) throw new Error(`${at}: a move is { "item": 3, "position": 1 }`);
                const x = itemAt(m.item, at);
                const n = Number(m.position);
                if (!Number.isInteger(n) || n < 1 || n > nl.items.length) throw new Error(`${at}: position is 1-${nl.items.length}`);
                x.detach();
                nl.items.splice(n - 1, 0, x);
                done.push(`item ${m.item} to ${n}`);
            }
            for (const [i, c] of list(v.change, where, "change").entries()) {
                const at = `${where}.change[${i + 1}]`;
                if (!c || typeof c !== "object" || c.item === undefined) throw new Error(`${at}: a change is { "item": 1, "action": ..., "class": ... }`);
                for (const k of Object.keys(c)) if (!["item", "action", "class", "style"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["item", "action", "class", "style"]);
                const x = itemAt(c.item, at);
                const bits = [];
                if (c.action !== undefined) bits.push(await act(c.action, x, at));
                for (const k of ["class", "style"]) if (c[k] !== undefined) {
                    x.appearance[k] = String(c[k]);
                    bits.push(`${k} "${c[k]}"`);
                }
                done.push(`item ${c.item}: ${bits.join(", ") || "unchanged"}`);
            }
            if (!done.length) throw new Error(`${where}: nothing to change; ${ITEMS_DOC}`);
            return `items ${done.join(", ")}`;
        },
        async tabs(P, node, v, dc, ctx, where) {
            const tc = node.el;
            if (!(tc instanceof pages.TabContainer)) throw new Error(`${where}: ${node.name} is a ${E.kindOf(tc)}; "tabs" changes a tab container`);
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: tabs is { "add": [...], "remove": [...], "move": [...], "rename": [...], "default": ... }`);
            for (const k of Object.keys(v)) if (!TAB_KEYS.includes(k)) fail(`${where}: unknown field '${k}' of tabs`, k, TAB_KEYS);
            const done = [];
            let lostDefault = false;
            // remove first (as deleteWidget: refused while data views listen to widgets in it, or variables name them)
            for (const ref of list(v.remove, where, "remove")) {
                const tp = await tabOf(tc, ref, `${where}.remove`);
                if (tc.tabPages.length < 2 && !list(v.add, where, "add").length) throw new Error(`${where}.remove: ${tp.name} is the only tab page of ${tc.name}; delete the tab container instead (deleteWidget)`);
                const P2 = await E.open(P.qn, where);
                const n2 = P2.nodes.find(x => x.el === tp);
                E.removable(P2, n2, `${where}.remove`);
                const wasDefault = tc.defaultPage === tp;
                tp.delete();
                if (wasDefault) lostDefault = true;
                done.push(`-tab ${tp.name}`);
            }
            for (const [i, a] of list(v.add, where, "add").entries()) {
                const at = `${where}.add[${i + 1}]`;
                const s = typeof a === "string" ? { caption: a } : a;
                if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${at}: a new tab is { "caption": "Notes", "widgets": [...] }`);
                const keys = ["caption", "name", "widgets", "before", "after", "position"];
                for (const k of Object.keys(s)) if (!keys.includes(k)) fail(`${at}: unknown field '${k}'`, k, keys);
                if (s.caption === undefined || s.caption === "") throw new Error(`${at}: needs "caption"`);
                const idx = await tabIndex(tc, s, at, null);
                const tp = pages.TabPage.create(model);
                if (idx === null) tc.tabPages.push(tp);
                else tc.tabPages.splice(idx, 0, tp);
                if (s.name !== undefined) {
                    const n = validName(s.name, "tab page name");
                    if (P.names.includes(n)) throw new Error(`${at}: the name '${n}' is already used on ${P.qn}`);
                    ctx.names.reserve(n, at);
                    tp.name = n;
                } else tp.name = ctx.names.next("tabPage");
                await I.textAll(tp.caption, s.caption, ctx);
                if (s.widgets !== undefined) {
                    if (!Array.isArray(s.widgets)) throw new Error(`${at}: widgets is a list [ { "widget": ... } ]`);
                    const name = tp.name;
                    (ctx.later = ctx.later || []).push(async () => {
                        const P2 = await E.open(P.qn, at);
                        const r = await E.addWidgetsAt(P2, E.place(P2, { into: name }, at), { page: P.qn, widgets: s.widgets }, at);
                        return `tab ${name}: ${r.replace(/^[^:]*: /, "")}`;
                    });
                }
                done.push(`+tab ${tp.name} "${s.caption}"${idx === null ? "" : ` at ${tc.tabPages.indexOf(tp) + 1}`}`);
            }
            for (const [i, m] of list(v.move, where, "move").entries()) {
                const at = `${where}.move[${i + 1}]`;
                if (!m || typeof m !== "object" || m.tab === undefined) throw new Error(`${at}: a move is { "tab": "Notes", "before": "General" } (or "after", or "position": 1)`);
                for (const k of Object.keys(m)) if (!["tab", "before", "after", "position"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["tab", "before", "after", "position"]);
                const tp = await tabOf(tc, m.tab, at);
                const idx = await tabIndex(tc, m, at, tp);
                if (idx === null) throw new Error(`${at}: give "before", "after" or "position"`);
                tp.detach();
                tc.tabPages.splice(idx, 0, tp);
                done.push(`tab ${tp.name} to ${idx + 1}`);
            }
            for (const [i, r] of list(v.rename, where, "rename").entries()) {
                const at = `${where}.rename[${i + 1}]`;
                if (!r || typeof r !== "object" || r.tab === undefined || (r.caption === undefined && r.name === undefined)) throw new Error(`${at}: a rename is { "tab": "General", "caption": "Main" } (and / or "name": "tabMain")`);
                for (const k of Object.keys(r)) if (!["tab", "caption", "name"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["tab", "caption", "name"]);
                const tp = await tabOf(tc, r.tab, at);
                if (r.caption !== undefined) {
                    await E.setText(tp.caption, r.caption, ctx, at);
                    done.push(`tab ${tp.name} caption "${r.caption}"`);
                }
                if (r.name !== undefined && r.name !== tp.name) {
                    const n = validName(r.name, "tab page name");
                    if (P.names.includes(n)) throw new Error(`${at}: the name '${n}' is already used on ${P.qn}`);
                    const old = tp.name;
                    tp.name = n;
                    done.push(`tab ${old} renamed to ${n}`);
                }
            }
            // Studio Pro keeps a default tab (DefaultPagePointer: the first one unless set)
            if (lostDefault && v.default === undefined && tc.tabPages.length) tc.defaultPage = tc.tabPages[0];
            if (v.default !== undefined) {
                const tp = await tabOf(tc, v.default, `${where}.default`);
                tc.defaultPage = tp;
                done.push(`default tab ${tp.name}`);
            }
            if (!done.length) throw new Error(`${where}: nothing to change; ${TABS_DOC}`);
            return `tabs ${done.join(", ")}`;
        }
    };

    // ------------------------------------------------ convertWidget

    const inputKinds = [["DropDown", "dropDown"], ["RadioButtonGroup", "radioButtons"], ["CheckBox", "checkBox"], ["TextBox", "textBox"], ["TextArea", "textArea"], ["DatePicker", "datePicker"]];
    const inputKind = el => (inputKinds.find(([c]) => pages[c] && el instanceof pages[c]) || [])[1] || null;
    const isCombo = el => el instanceof sdk.customwidgets.CustomWidget && el.type && /combobox\.Combobox$/i.test(el.type.widgetId);
    const relPath = ref => [...(ref.entityRef && ref.entityRef.steps ? ref.entityRef.steps.map(st => st.associationQualifiedName) : []), ref.attributeQualifiedName.split(".").pop()].join("/");

    // the spec of the new widget and what is not carried over
    async function convertSpec(P, node, to, o, where) {
        const el = node.el, lost = [];
        const label = el.labelTemplate ? await E.textOf(el.labelTemplate.template) : undefined;
        const lbl = label !== undefined ? { label } : {};
        const from = inputKind(el) || (el instanceof pages.ReferenceSelector ? "referenceSelector" : isCombo(el) ? "comboBox" : el instanceof pages.DivContainer ? "container" : el instanceof pages.GroupBox ? "groupBox" : el instanceof pages.DataGrid ? "dataGrid" : null);
        const no = (why) => {
            throw new Error(`${where}: a ${from || E.kindOf(el)} cannot become a ${to}${why ? `; ${why}` : ""} (convertWidget turns: enumeration / Boolean inputs <-> comboBox, referenceSelector <-> comboBox, container <-> groupBox, classic dataGrid -> dataGrid2)`);
        };
        if (from === to) throw new Error(`${where}: ${node.name} is a ${to} already`);
        if (["dropDown", "radioButtons", "checkBox", "textBox"].includes(from) && el.attributeRef) {
            const attr = el.attributeRef.attribute;
            const enumOrBool = attr && (attr.type instanceof sdk.domainmodels.EnumerationAttributeType || attr.type instanceof sdk.domainmodels.BooleanAttributeType);
            const path = relPath(el.attributeRef);
            if (to === "comboBox") {
                if (!enumOrBool) no(`${path} is no enumeration or Boolean attribute (a combo box shows those, or a reference)`);
                if (el.validation && el.validation.expression) lost.push("validation (a combo box has none)");
                return { spec: { widget: "comboBox", attribute: path, ...lbl }, lost };
            }
            if (["dropDown", "radioButtons"].includes(to) && enumOrBool) return { spec: { widget: to, attribute: path, ...lbl }, lost };
            no(from === "textBox" ? "a text box shows a String, number or date; for a list of choices give the attribute an enumeration type first" : "");
        }
        if (from === "referenceSelector") {
            if (to !== "comboBox") no();
            const ref = el.attributeRef;
            const assoc = ref && ref.entityRef && ref.entityRef.steps.length ? ref.entityRef.steps[0].associationQualifiedName : null;
            if (!assoc) no("it has no association");
            if (el.xPathConstraint) lost.push(`XPath ${el.xPathConstraint} (set the combo box's selectable objects in Studio Pro)`);
            if (el.selectPageSettings && el.selectPageSettings.pageQualifiedName) lost.push("select page");
            return { spec: { widget: "comboBox", association: assoc, captionAttribute: o.captionAttribute !== undefined ? String(o.captionAttribute) : ref.attributeQualifiedName.split(".").pop(), ...lbl }, lost };
        }
        if (from === "comboBox") {
            const mode = (I.valueOf(el.object, "optionsSourceType") || {}).primitiveValue;
            const clabel = el.labelTemplate ? { label: await E.textOf(el.labelTemplate.template) } : {};
            if (mode === "association") {
                if (to !== "referenceSelector") no("it shows a reference: it becomes a referenceSelector");
                const v = I.valueOf(el.object, "attributeAssociation");
                const assoc = v && v.entityRef && v.entityRef.steps.length ? v.entityRef.steps[0].associationQualifiedName : null;
                const cap = I.valueOf(el.object, "optionsSourceAssociationCaptionAttribute");
                if (!assoc) no("it has no association");
                return { spec: { widget: "referenceSelector", association: assoc, ...(cap && cap.attributeRef ? { attribute: cap.attributeRef.attributeQualifiedName.split(".").pop() } : {}), ...clabel }, lost };
            }
            const v = I.valueOf(el.object, mode === "boolean" ? "attributeBoolean" : "attributeEnumeration");
            if (!v || !v.attributeRef) no("it has no attribute");
            if (!["dropDown", "radioButtons", ...(mode === "boolean" ? ["checkBox"] : [])].includes(to)) no(`it shows ${mode === "boolean" ? "a Boolean: it becomes a dropDown, radioButtons or checkBox" : "an enumeration: it becomes a dropDown or radioButtons"}`);
            return { spec: { widget: to, attribute: relPath(v.attributeRef), ...clabel }, lost };
        }
        if (from === "container" && to === "groupBox") return { spec: { widget: "groupBox", ...(o.caption !== undefined ? { caption: o.caption } : {}), ...(o.collapsible !== undefined ? { collapsible: o.collapsible } : {}) }, lost, move: true };
        if (from === "groupBox" && to === "container") {
            if (el.caption) lost.push(`caption "${await E.textOf(el.caption.template)}" (a container has none)`);
            if (el.collapsible && el.collapsible.name !== "No") lost.push("collapsible");
            return { spec: { widget: "container" }, lost, move: true };
        }
        return no();
    }

    async function convertWidget(o) {
        const where = `convertWidget ${o.page} ${o.widget}`;
        const to = CONVERT_TO.find(k => k.toLowerCase() === String(o.to).toLowerCase().replace(/[\s_-]/g, "")) || fail(`${where}: to '${o.to}' is not known (use ${CONVERT_TO.join(" | ")})`, String(o.to), CONVERT_TO);
        if (to === "dataGrid2") {
            const r = await E.convertGrid({ page: o.page, widget: o.widget });
            return r.replace(/^convertGrid/, "convertWidget");
        }
        const P = await E.open(o.page, where);
        await I.prepareAssocs(null);
        const node = E.find(P, o.widget, where);
        const el = node.el;
        const { spec, lost, move } = await convertSpec(P, node, to, o, where);
        const name = node.name;
        if (!move) E.removable(P, node, where);
        // the old one steps aside (a free name), the new one is built right before it by addWidgets (entity, checks),
        // then, in one go, gets the old one's widgets and look, and the old one is deleted
        const tmp = `${name}_zzConverted`;
        el.name = tmp;
        const P1 = await E.open(o.page, where);
        const res = await E.addWidgetsAt(P1, E.place(P1, { before: tmp }, where), { page: o.page, widgets: [{ ...spec, name }] }, where).catch(e => {
            el.name = name;
            throw e;
        });
        const nu = (await E.open(o.page, where)).byName.get(name).el;
        const kept = [];
        if (move) for (const w of [...el.widgets]) {
            w.detach();
            nu.widgets.push(w);
        }
        if (el.appearance && nu.appearance) {
            for (const k of ["class", "style", "dynamicClasses"]) if (el.appearance[k]) {
                nu.appearance[k] = el.appearance[k];
                kept.push(k === "dynamicClasses" ? "dynamic class" : k);
            }
            const designs = el.appearance.designProperties;
            if (designs.length) {
                for (const d of designs) nu.appearance.designProperties.push(d.deepCopy(model));
                kept.push(`design ${designs.map(d => d.key).join(", ")}`);
            }
        }
        if (el.conditionalVisibilitySettings) {
            if (nu.conditionalVisibilitySettings !== undefined) {
                nu.conditionalVisibilitySettings = el.conditionalVisibilitySettings.deepCopy(model);
                kept.push("visibility");
            } else lost.push("visibility");
        }
        if (el.tabIndex) {
            nu.tabIndex = el.tabIndex;
            kept.push("tab index");
        }
        el.delete();
        if (client.renames) client.renames = client.renames.filter(r => !r.includes(`.${tmp} (`)); // a step aside, not a rename
        if (lost.length) client.warn(`${where}: not carried over: ${lost.join("; ")}`);
        const body = res.replace(/^[^:]*: /, "");
        const made = body.slice(0, body.lastIndexOf(" -> "));
        return `${P.qn}: ${name} is now ${made}${move ? " with its widgets" : ""}${kept.length ? `; kept ${kept.join(", ")}` : ""}${lost.length ? `; NOT carried over: ${lost.join("; ")}` : ""}`;
    }

    // ------------------------------------------------ createLoginPage

    async function createLoginPage(o, impl) {
        validName(o.module, "module name");
        const name = o.name !== undefined ? validName(o.name, "page name") : "Login";
        const qn = `${o.module}.${name}`;
        const where = `createLoginPage ${qn}`;
        const notes = [];
        // anonymous users: the guest role's module roles may open it
        let roles = o.roles;
        if (roles === undefined) {
            const sec = model.allProjectSecurities()[0];
            const ps = sec && (await sec.load());
            if (ps && ps.enableGuestAccess) {
                const guest = ps.userRoles.find(r => r.name === ps.guestUserRoleName);
                roles = guest ? guest.moduleRoles.map(r => r.qualifiedName).filter(r => r.startsWith(`${o.module}.`)) : [];
                if (guest && !roles.length) notes.push(`the anonymous user role ${guest.name} has no module role of ${o.module}: give one ("roles"), or the page opens for nobody`);
                else notes.push(`open to anonymous users (${roles.join(", ")})`);
            } else {
                roles = [];
                notes.push("anonymous users are off: the sign-in page needs no access rules (Mendix shows it to everyone who is not signed in)");
            }
        }
        let layout = o.layout;
        if (layout === undefined) {
            const ls = model.allLayouts().filter(l => /login|blank/i.test(l.qualifiedName) && !/pop|native|phone|tablet/i.test(l.qualifiedName));
            const pick = ls.find(l => /login/i.test(l.name)) || ls.find(l => /blank/i.test(l.name));
            if (pick) layout = pick.qualifiedName;
        }
        const heading = o.heading !== undefined ? o.heading : o.title !== undefined ? o.title : "Sign in";
        const form = [
            ...(heading === "" ? [] : [{ widget: "text", text: heading, style: "H2" }]),
            { widget: "loginIdTextBox", name: "loginIdTextBox1" }, { widget: "passwordTextBox", name: "passwordTextBox1" },
            { widget: "validationMessage", name: "validationMessage1" }, { widget: "loginButton", name: "loginButton1", validationMessage: "validationMessage1" }
        ];
        const page = { op: "createPage", module: o.module, name, title: o.title !== undefined ? o.title : "Sign in", widgets: [{ widget: "container", name: "loginForm", class: o.class !== undefined ? String(o.class) : "loginpage-form", widgets: form }, ...(o.widgets || [])],
            ...(layout ? { layout } : {}), ...(roles.length ? { roles } : {}), ...(o.folder !== undefined ? { folder: o.folder } : {}) };
        const made = await impl.createPage(page);
        if (o.profile !== false) {
            const profName = String(o.profile === undefined || o.profile === true ? "Responsive" : o.profile);
            const nd = model.allNavigationDocuments()[0];
            const nav = nd && (await nd.load());
            const profs = nav ? nav.profiles.filter(p => p instanceof sdk.navigation.NavigationProfile) : [];
            const prof = profs.find(p => p.name.toLowerCase() === profName.toLowerCase()) || fail(`${where}: no web navigation profile '${profName}'${profs.length ? "" : " (this project has none)"}; or "profile": false`, profName, profs.map(p => p.name));
            const p = await h.get(qn);
            if (!prof.loginPageSettings) prof.loginPageSettings = pages.PageSettings.create(model);
            prof.loginPageSettings.page = p;
            notes.push(`sign-in page of the ${prof.name} profile`);
        }
        const fs = require("fs"), path = require("path");
        const html = path.join(client.project.dir, "theme", "web", "login.html");
        client.warn(`${where}: ${fs.existsSync(html) ? "theme/web/login.html stays in the theme; it is shown only where no sign-in page is set (and as the page after a session timeout in older apps)" : "the theme has no theme/web/login.html"}; check the sign-in in the running app (Studio Pro: App > Navigation > Sign-in page)`);
        client.warn(`${where}: Forms$LoginIdTextBox, Forms$PasswordTextBox, Forms$LoginButton and Forms$ValidationMessage have no Studio Pro sample in the test projects (first use): open ${qn} in Studio Pro once`);
        return `${typeof made === "string" ? made : qn}; ${notes.join("; ")}`;
    }

    // postconditions of the fields above (changeWidget check)
    async function check(P, w, o) {
        const r = [];
        if (o.tabs && typeof o.tabs === "object") {
            const v = o.tabs;
            const caps = [];
            for (const t of w.tabPages || []) caps.push(t.name, await E.textOf(t.caption));
            for (const a of [].concat(v.add || [])) {
                const s = typeof a === "string" ? { caption: a } : a || {};
                if (!caps.includes(s.name !== undefined ? String(s.name) : String(s.caption))) r.push(`${P.qn} ${w.name}: no tab ${s.name || s.caption}`);
            }
            for (const x of [].concat(v.rename || [])) if (x && x.caption !== undefined && !caps.includes(String(x.caption))) r.push(`${P.qn} ${w.name}: no tab captioned "${x.caption}"`);
            for (const x of [].concat(v.rename || [])) if (x && x.name !== undefined && !caps.includes(String(x.name))) r.push(`${P.qn} ${w.name}: no tab named ${x.name}`);
            for (const x of [].concat(v.remove || [])) if (caps.includes(String(x)) && ![].concat(v.add || []).some(a => a && (a === x || a.caption === x || a.name === x))) r.push(`${P.qn} ${w.name}: tab ${x} is still there`);
            if (v.default !== undefined && !(w.defaultPage && (w.defaultPage.name === String(v.default) || (await E.textOf(w.defaultPage.caption)) === String(v.default)))) r.push(`${P.qn} ${w.name}: default tab is not ${v.default}`);
            for (const m of [].concat(v.move || [])) {
                if (!m || m.position === undefined) continue;
                const t = w.tabPages[Number(m.position) - 1];
                if (!t || (t.name !== String(m.tab) && (await E.textOf(t.caption)) !== String(m.tab))) r.push(`${P.qn} ${w.name}: tab ${m.tab} is not at ${m.position}`);
            }
        }
        return r;
    }

    const checks = {
        async convertWidget(o) {
            const to = String(o.to).toLowerCase().replace(/[\s_-]/g, "");
            if (to === "datagrid2") return E.checks.convertGrid({ page: o.page, widget: o.widget });
            const P = await E.open(o.page, "check");
            const n = P.byName.get(String(o.widget));
            if (!n) return [`${P.qn} has no widget ${o.widget}`];
            const el = n.el;
            const ok = { combobox: isCombo(el), dropdown: el instanceof pages.DropDown, radiobuttons: el instanceof pages.RadioButtonGroup, checkbox: el instanceof pages.CheckBox, textbox: el instanceof pages.TextBox,
                referenceselector: el instanceof pages.ReferenceSelector, groupbox: el instanceof pages.GroupBox, container: el instanceof pages.DivContainer }[to];
            return ok ? [] : [`${P.qn} ${o.widget} is a ${E.kindOf(el)}, not a ${o.to}`];
        },
        async createLoginPage(o) {
            const qn = `${o.module}.${o.name || "Login"}`;
            const p = await h.get(qn).catch(() => null);
            if (!p) return [`${qn} does not exist`];
            const r = [];
            const types = new Set();
            p.traverse(x => types.add(x.structureTypeName));
            for (const t of ["Pages$LoginIdTextBox", "Pages$PasswordTextBox", "Pages$LoginButton", "Pages$ValidationMessage"]) if (!types.has(t)) r.push(`${qn} has no ${t.split("$")[1]}`);
            if (o.profile !== false) {
                const nd = model.allNavigationDocuments()[0];
                const nav = nd && (await nd.load());
                const prof = nav && nav.profiles.find(x => x.name.toLowerCase() === String(o.profile === undefined || o.profile === true ? "Responsive" : o.profile).toLowerCase());
                if (!prof || !prof.loginPageSettings || prof.loginPageSettings.pageQualifiedName !== qn) r.push(`${qn} is not the sign-in page of the profile`);
            }
            return r;
        }
    };

    return { CHANGE, check, convertWidget, createLoginPage, checks };
}

const WIDGET_CHANGE = {
    tabs: TABS_DOC,
    regions: REGIONS_DOC,
    items: ITEMS_DOC,
    menu: MENU_DOC
};

module.exports = { makeWidgetEdit, WIDGET_EDIT_OPS, WIDGET_EDIT_SYNONYMS, WIDGET_CHANGE };
