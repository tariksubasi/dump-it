"use strict";
// Pages: create a page with a data view form for an entity (inputs per attribute type, Save/Cancel), an empty page, or a
// page from a widget list (layout grids, containers, texts, data views, data grids, list views, buttons, inputs), plus
// menu items and home pages. The layout and its placeholder are learned from the project's own pages; widget names,
// defaults and storage follow what Studio Pro writes (checked against Studio Pro-saved pages of Mendix 10.22-11.13).
// A Data grid 2 is copied from one on the project's own pages whose type matches widgets/*.mpk (see pluggable.js).
const sdk = require("mendixmodelsdk");
const { fail, suggest, bool, setIfAvailable, enumValue, validName } = require("./ops-util");
const pluggable = require("./pluggable");
const { userRoleNamed } = require("./ops-security");

const { pages, domainmodels: dm, datatypes, menus, navigation, microflows: mf, customwidgets: cw } = sdk;

// Widget kinds of createPage "widgets" (also the help text). Every widget also takes "name".
const WIDGETS = {
    layoutGrid: {
        doc: "rows of columns; weights 1-12 per row",
        fields: { rows: "[ { \"columns\": [ 8, { \"weight\": 4, \"tablet\": 12, \"phone\": 12, \"widgets\": [...] } ] } ]", columns: "one row: [ 8, 4 ] or [ { \"weight\": 8, \"widgets\": [...] }, ... ]", width: "optional full | fixed (default full)" }
    },
    container: { doc: "a container around widgets", fields: { widgets: "[ widgets ]", class: "optional CSS class" } },
    text: { doc: "a text or heading. Inside a data view or list view {Attribute} shows its value", fields: { text: "R the text", style: "optional Text | Paragraph | H1 | H2 | H3 | H4 | H5 | H6 (default Text; \"widget\": \"heading\" = H2)" } },
    dataView: {
        doc: "shows one object: a page parameter (source parameter) or the selected row of a grid/list view (listenTo)",
        fields: {
            entity: "optional Module.Entity (default: the page entity; with listenTo: the grid's entity)",
            source: "optional parameter | listen (default: listen with listenTo, else parameter = adds a page parameter)",
            listenTo: "optional name of a grid/list view on this page, or dataGrid / listView when the page has one",
            editable: "optional true/false (default true; an editable data view needs a save button: \"buttons\": true or one in footer)",
            fields: "optional [ \"Attribute\" ] inputs by attribute type (default: all attributes, unless widgets is given)",
            buttons: "optional true/false: Save/Cancel in the footer (default: true for an editable parameter data view)",
            widgets: "optional [ widgets ] inside the data view (after the fields)",
            footer: "optional [ widgets ] in the footer, e.g. buttons"
        }
    },
    dataGrid: {
        doc: "data grid over the database (XPath source) with single selection: a classic Data grid with a search bar, or with kind datagrid2 a Data grid 2 copied from the project's own pages",
        fields: {
            entity: "optional Module.Entity (default: the page entity)",
            columns: "optional [ \"Attribute\" or { \"attribute\": ..., \"caption\": ..., \"width\": 25 } ] (default: all attributes; width: classic only)",
            xpath: "optional XPath constraint, e.g. [Active = true()]; inside a data view [Module.Assoc = '[%CurrentObject%]'] shows the objects linked to the data view's object",
            search: "optional true/false: classic only, Search button + search fields for text, number and enumeration columns (default true)",
            selection: "optional Single | SingleAndMaintain | Multi | SimpleMulti | None (default Single; Data grid 2: Single | Multi | None)",
            selectFirst: "optional true/false (default false)",
            rows: "optional rows per page (default 20)",
            kind: "optional classic | datagrid2 | auto (default classic). datagrid2 copies a Data grid 2 from a page of this project whose widget matches widgets/*.mpk (columns, data source and selection set; filters, actions and personalization left empty); auto = datagrid2 when that is possible, else classic. \"widget\": \"dataGrid2\" = kind datagrid2"
        }
    },
    listView: {
        doc: "list of objects over the database (XPath source); a data view can listen to it",
        fields: { entity: "optional Module.Entity (default: the page entity)", xpath: "optional XPath constraint (see dataGrid)", fields: "optional [ \"Attribute\" ] one text per attribute (default: all attributes, unless widgets is given)", widgets: "optional [ widgets ] per item", pageSize: "optional (default 10)" }
    },
    actionButton: {
        doc: "a button",
        fields: {
            action: "R save | cancel | close | delete | showPage | callMicroflow | callNanoflow",
            caption: "optional (default Save/Cancel/Close page/Delete; required for the others)",
            page: "showPage: Module.Page", microflow: "callMicroflow: Module.Microflow", nanoflow: "callNanoflow: Module.Nanoflow",
            style: "optional Default | Primary | Success | Info | Warning | Danger | Inverse",
            closePage: "optional true/false for save/cancel/delete (default: true in a parameter data view; false in a listening data view, which stays on the page; Studio Pro's own default is true)"
        }
    },
    input: { doc: "input for an attribute, inside a data view: text box, text area, check box, date picker or radio buttons (enumeration) by attribute type (or use textBox, textArea, checkBox, datePicker, radioButtons, dropDown)", fields: { attribute: "R attribute name", label: "optional label (default: the attribute name)" } }
};
const INPUTS = { textBox: "TextBox", textArea: "TextArea", checkBox: "CheckBox", datePicker: "DatePicker", radioButtons: "RadioButtonGroup", dropDown: "DropDown" };
const ALIASES = { button: "actionButton", grid: "dataGrid", datagrid: "dataGrid", datagrid2: "dataGrid", list: "listView", heading: "text", div: "container", radiobuttongroup: "radioButtons" };
// fields a weak model takes from a neighbouring widget kind -> what to write instead
const MASTER_DETAIL = `to show objects linked to the selected row, put a dataGrid or listView inside the listening dataView with "xpath": "[Module.Assoc = '[%CurrentObject%]']"`;
const SYNONYMS = {
    dataGrid: { fields: "use \"columns\"", pageSize: "use \"rows\"", listenTo: `a grid cannot listen; ${MASTER_DETAIL}` },
    listView: { columns: "use \"fields\"", rows: "use \"pageSize\"", listenTo: `a list view cannot listen; ${MASTER_DETAIL}` },
    dataView: { columns: "use \"fields\"", readOnly: "use \"editable\": false", readonly: "use \"editable\": false" },
    layoutGrid: { widgets: "a layout grid holds widgets in its columns: \"columns\": [ { \"weight\": 6, \"widgets\": [...] }, { \"weight\": 6, \"widgets\": [...] } ]" }
};
const KINDS = [...Object.keys(WIDGETS), ...Object.keys(INPUTS)];
const PREFIX = { layoutGrid: "layoutGrid", container: "container", text: "text", dataView: "dataView", dataGrid: "grid", listView: "listView", actionButton: "actionButton" };
// enumValue with the widget location in the message
function choice(cls, value, field, where) {
    try {
        return enumValue(cls, value, field);
    } catch (e) {
        e.message = `${where}: ${e.message}`;
        throw e;
    }
}
const NO_MENU_ROLES = page => `menu items have no roles: who sees one = the user roles that may open ${page} (grantAccess / revokeAccess on the page)`;
const LISTENABLE = { datagrid: "dataGrid", grid: "dataGrid", listview: "listView", list: "listView" };
const DATAGRID2 = "com.mendix.widget.web.datagrid.Datagrid";
// Studio Pro's own captions for buttons it creates, in Dutch (the only other language in the test projects)
const NL = { Search: "Zoeken", Save: "Opslaan", Cancel: "Annuleren", "Close page": "Pagina sluiten", Delete: "Verwijderen" };

const widgetHelp = () => Object.entries(WIDGETS).map(([k, w]) => `\n        ${k}: ${w.doc}` + Object.entries(w.fields).map(([f, d]) => `\n            ${f}: ${d}`).join("")).join("");

// The kind of a widget name (dataGrid, grid, heading, textBox, ...) or null.
function widgetKind(name) {
    const low = String(name).toLowerCase();
    return KINDS.find(k => k.toLowerCase() === low) || ALIASES[low] || null;
}

// ops <widget kind>: the fields of one widget kind.
function widgetFields(name) {
    const kind = widgetKind(name);
    if (!kind) return null;
    const w = WIDGETS[kind] || WIDGETS.input;
    return [`widget ${kind} (inside createPage "widgets"): ${w.doc}`, ...Object.entries(w.fields).map(([f, d]) => `    ${f}: ${d}`),
        "    name: optional widget name (default as Studio Pro)", "  all widget kinds: ops createPage"].join("\n");
}

const PAGE_FIELDS = {
    module: "R module name",
    name: "R page name",
    title: "optional page title (default: the name)",
    entity: "optional Module.Entity: without widgets, a page parameter and a data view form for it; with widgets, the default entity of grids and data views (no page parameter unless a data view uses source parameter)",
    fields: "optional [ \"Attribute\", ... ] inputs in the form (default: all attributes of the entity); not with widgets",
    buttons: "optional true/false: Save and Cancel buttons under the form (default true); not with widgets",
    widgets: "optional [ { \"widget\": \"<kind>\", ...fields } ] the page content, top to bottom; every widget takes \"name\" (default: Studio Pro style grid1 / dataGrid2_1, dataView1, ...). A grid followed by a data view that listens to it is placed side by side (layout grid 8/4). Kinds:" + widgetHelp(),
    arrange: "optional auto | rows: rows stacks every top-level widget, also a grid and its listening data view (default auto)",
    menu: "optional \"Responsive\" (navigation profile) or { \"profile\": ..., \"caption\": ..., \"parent\": \"<menu item caption>\" }: a menu item that opens the page",
    layout: "optional Module.Layout (default: the layout most pages of this kind use)",
    folder: "optional folder path",
    roles: "optional [ \"Module.Role\" ] that may open the page"
};
const MENU_FIELDS = {
    page: "R Module.Page (without page parameters)",
    profile: "optional navigation profile: Responsive, Tablet, Phone or its name (default Responsive)",
    caption: "optional (default: the page title)",
    parent: "optional caption of an existing menu item to put it under"
};
const HOME_FIELDS = {
    page: "Module.Page without parameters (or use microflow)",
    microflow: "Module.Microflow without parameters, instead of a page",
    profile: "optional navigation profile (default Responsive)",
    roles: "optional [ \"UserRole\" ] (user roles, e.g. Administrator): home page for these roles only; without: the default home page"
};

function makePages(h) {
    const { model, client } = h;

    // Layout use of the project's pages: { layout, placeholder, withParameter } per page.
    function layoutUse() {
        const out = [];
        for (const id of client.project.units.keys()) {
            const p = client.project.read(id);
            if (p.$Type !== "Forms$Page" || !p.FormCall || !p.FormCall.Form) continue;
            const arg = (p.FormCall.Arguments || []).find(a => a.Parameter);
            if (!arg) continue;
            out.push({ layout: p.FormCall.Form, placeholder: arg.Parameter, withParameter: (p.Parameters || []).length > 0 });
        }
        return out;
    }

    function pickLayout(wanted, withParameter) {
        const known = new Set(model.allLayouts().map(l => l.qualifiedName));
        const uses = layoutUse().filter(u => known.has(u.layout)); // a page may refer to a layout whose module is gone
        if (wanted) {
            const hit = uses.find(u => u.layout === wanted);
            if (!hit) fail(`no page in the project uses layout '${wanted}', so its placeholder is unknown`, wanted, [...new Set(uses.map(u => u.layout))]);
            return hit;
        }
        // a page without an object is usually a full page: prefer layouts that are not popups
        let pool = uses.filter(u => u.withParameter === withParameter);
        if (!withParameter && pool.some(u => !/popup/i.test(u.layout))) pool = pool.filter(u => !/popup/i.test(u.layout));
        const counts = new Map();
        for (const u of pool.length ? pool : uses) counts.set(u.layout + "|" + u.placeholder, (counts.get(u.layout + "|" + u.placeholder) || 0) + 1);
        const best = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (!best) throw new Error("the project has no page with a layout to copy; create the first page in Studio Pro");
        const [layout, placeholder] = best[0].split("|");
        return { layout, placeholder };
    }

    const humanize = s => s.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

    // A unit by qualified name, without the "did you mean" search of h.get (slow on big projects).
    const unitNamed = qn => model.allUnits().find(u => {
        try {
            return u.qualifiedName === qn;
        } catch (e) {
            return false;
        }
    });

    // ------------------------------------------------ texts

    let langs = null;
    async function languages() {
        if (langs) return langs;
        const s = model.allProjectSettings()[0];
        const loaded = s && (await s.load());
        const ls = loaded && loaded.settingsParts.find(p => p instanceof sdk.settings.LanguageSettings);
        const dflt = (ls && ls.defaultLanguageCode) || "en_US";
        langs = [dflt, ...(ls ? ls.languages.map(l => l.code) : []).filter(c => c !== dflt)];
        return langs;
    }

    // Writes value in the default language, as Studio Pro does for typed texts; builtin = one of Studio Pro's own button
    // captions, which it also writes in English and Dutch. Counts texts that other project languages still lack.
    async function textAll(t, value, ctx, builtin) {
        const ls = await languages();
        const items = { [ls[0]]: String(value) };
        const own = builtin && NL[value];
        if (own) for (const c of ls) if (c === "nl_NL" || /^en_/.test(c)) items[c] = c === "nl_NL" ? NL[value] : String(value);
        if (ctx && value !== "" && ls.length > 1 && !own) ctx.untranslated++;
        return h.text(t, items);
    }

    // {1} in a client template is a Mendix placeholder: a literal one would show a parameter (or point at none).
    function noPlaceholder(value, where) {
        const m = /\{\d+\}/.exec(String(value));
        if (m) throw new Error(`${where}: ${m[0]} is a Mendix placeholder; write {AttributeName} to show a value (in a data view or list view), or leave out the braces`);
    }

    async function templateAll(owner, prop, value, ctx, where, builtin) {
        noPlaceholder(value, where);
        if (!owner[prop]) owner[prop] = pages.ClientTemplate.create(model);
        await textAll(owner[prop].template, value, ctx, builtin);
        return owner[prop];
    }

    // ------------------------------------------------ the widget list: validate, name, resolve listenTo

    function kindOf(spec, where) {
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: each widget is an object { "widget": "<kind>", ... }`);
        const raw = spec.widget !== undefined ? spec.widget : spec.type;
        if (raw === undefined) throw new Error(`${where}: missing "widget". Supported: ${KINDS.join(", ")}`);
        if (typeof raw !== "string") throw new Error(`${where}: "widget" must be a kind name such as "text" (supported: ${KINDS.join(", ")})`);
        const kind = widgetKind(raw);
        if (!kind) fail(`${where}: unknown widget '${raw}'. Supported: ${KINDS.join(", ")} (other widgets, e.g. gallery, tab container, snippet, image: add them in Studio Pro)`, raw, KINDS);
        const own = Object.keys((WIDGETS[kind] || WIDGETS.input).fields);
        const known = ["widget", "type", "name", ...own];
        for (const k of Object.keys(spec)) {
            if (known.includes(k)) continue;
            const syn = (SYNONYMS[kind] || {})[k];
            if (syn) throw new Error(`${where}: unknown field '${k}' for ${kind}: ${syn}`);
            const s = suggest(k, own);
            throw new Error(`${where}: unknown field '${k}' for ${kind}. ` + (s.length ? `Did you mean: ${s.join(", ")}?` : `Fields of ${kind}: ${own.join(", ")}, name`));
        }
        for (const [k, d] of Object.entries((WIDGETS[kind] || WIDGETS.input).fields)) if (d.startsWith("R ") && (spec[k] === undefined || spec[k] === "")) throw new Error(`${where}: ${kind} needs '${k}' (${d.slice(2)})`);
        if (spec.name !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(spec.name))) throw new Error(`${where}: name '${spec.name}' is not valid (letters, digits, _)`);
        return kind;
    }

    const list = (v, where) => {
        if (v === undefined) return [];
        if (!Array.isArray(v)) throw new Error(`${where} must be a list [ ... ]`);
        return v;
    };

    function weight(v, where, dflt) {
        if (v === undefined) return dflt;
        if (/^auto$/i.test(String(v))) return -1;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error(`${where}: weight '${v}' must be 1-12 or "auto"`);
        return n;
    }

    // Spec tree -> node tree. container: nearest data view / list view node around this one.
    function scan(specs, where, container, nodes) {
        return list(specs, where).map((spec, i) => {
            const at = `${where}[${i + 1}]`;
            const kind = kindOf(spec, at);
            const node = { kind, spec, where: `${at} (${kind})`, container, name: spec.name !== undefined ? String(spec.name) : null, heading: /^heading$/i.test(spec.widget || spec.type) };
            nodes.push(node);
            if (kind === "layoutGrid") {
                if (spec.rows !== undefined && spec.columns !== undefined) throw new Error(`${node.where}: give rows or columns, not both`);
                const rows = spec.rows !== undefined ? list(spec.rows, `${node.where}.rows`) : [{ columns: spec.columns }];
                if (!rows.length) throw new Error(`${node.where}: needs rows or columns`);
                node.rows = rows.map((r, ri) => {
                    const rw = `${node.where} row ${ri + 1}`;
                    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error(`${rw}: a row is { "columns": [ ... ] }`);
                    for (const k of Object.keys(r)) if (k !== "columns") fail(`${rw}: unknown field '${k}'`, k, ["columns"]);
                    const cols = list(r.columns, `${rw}.columns`);
                    if (!cols.length) throw new Error(`${rw}: needs columns, e.g. [ 8, 4 ]`);
                    const out = cols.map((c, ci) => {
                        const at = `${rw} column ${ci + 1}`;
                        const col = typeof c === "object" && c ? c : { weight: c };
                        for (const k of Object.keys(col)) if (!["weight", "tablet", "phone", "widgets"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["weight", "tablet", "phone", "widgets"]);
                        return { weight: weight(col.weight, at, -1), tablet: weight(col.tablet, at, -1), phone: weight(col.phone, at, -1), widgets: scan(col.widgets, `${at}.widgets`, container, nodes) };
                    });
                    if (out.reduce((s, c) => s + Math.max(c.weight, 0), 0) > 12) client.warn(`layout grid ${rw}: column weights add up to more than 12; the columns wrap`);
                    return out;
                });
            } else if (kind === "container") node.widgets = scan(spec.widgets, `${node.where}.widgets`, container, nodes);
            else if (kind === "dataView") {
                node.widgets = scan(spec.widgets, `${node.where}.widgets`, node, nodes);
                node.footer = scan(spec.footer, `${node.where}.footer`, node, nodes);
            } else if (kind === "listView") node.widgets = scan(spec.widgets, `${node.where}.widgets`, node, nodes);
            if ((INPUTS[kind] || kind === "input") && (!container || container.kind !== "dataView")) throw new Error(`${node.where}: inputs go inside a dataView (its "widgets" or "fields")`);
            if (kind === "actionButton") {
                const a = String(spec.action).toLowerCase();
                if (["save", "cancel"].includes(a) && (!container || container.kind !== "dataView")) throw new Error(`${node.where}: a ${a} button goes inside a dataView`);
                if (a === "delete" && !container) throw new Error(`${node.where}: a delete button goes inside a dataView or listView`);
            }
            return node;
        });
    }

    // taken: names already on the page (an existing page keeps its widget names)
    function names(taken = []) {
        const used = new Set(taken);
        return {
            reserve(n, where) {
                if (used.has(n)) throw new Error(`${where}: the name '${n}' is used twice on this page`);
                used.add(n);
            },
            next(prefix) {
                for (let i = 1; ; i++) {
                    if (!used.has(prefix + i)) {
                        used.add(prefix + i);
                        return prefix + i;
                    }
                }
            }
        };
    }

    // ------------------------------------------------ model lookups

    const entities = new Map();
    async function entityOf(qn, where) {
        if (!qn) throw new Error(`${where}: needs 'entity' (or a page-level "entity")`);
        if (!entities.has(qn)) {
            const e = await h.entity(qn);
            await h.loadParents(e);
            entities.set(qn, e);
        }
        return entities.get(qn);
    }

    function attributeOf(ent, name, where) {
        const chain = h.attributeChain(ent);
        const a = chain.attributes.find(x => x.name === name);
        if (a) return a;
        // a parent in a module that is not in the project (System.User, ...): its attributes are unknown here
        if (!chain.complete) fail(`${where}: '${name}' is not an attribute of ${ent.qualifiedName} itself; attributes inherited from System entities cannot be shown by ops (add that column or input in Studio Pro). Attributes here: ${chain.attributes.map(x => x.name).join(", ") || "none"}`, name, chain.attributes.map(x => x.name));
        return fail(`${where}: ${ent.qualifiedName} has no attribute '${name}'`, name, chain.attributes.map(x => x.name));
    }

    const shown = ent => h.attributeChain(ent).attributes.filter(a => !(a.type instanceof dm.BinaryAttributeType)).map(a => a.name);

    // ent is (a specialization of) the entity named qn
    function isA(ent, qn) {
        for (let e = ent, i = 0; e && i < 20; i++) {
            if (e.qualifiedName === qn) return true;
            const g = e.generalization;
            e = g instanceof dm.Generalization && g.generalization && g.generalization.isLoaded ? g.generalization : null;
        }
        return false;
    }

    // Studio Pro passes the object of the enclosing data view / list view implicitly (no parameter mapping is stored),
    // so a button can call a page or flow without parameters or with exactly that one object parameter.
    function implicitOnly(params, node, what) {
        if (!params.length) return;
        const ctx = node.container && node.container.ent;
        if (params.length === 1 && params[0].entity && ctx && isA(ctx, params[0].entity)) return;
        const list = params.map(p => `${p.name}${p.entity ? " (" + p.entity + ")" : ""}`).join(", ");
        throw new Error(`${node.where}: ${what} has parameter(s) ${list}. A button passes only the object of the data view or list view it is in` +
            (ctx ? ` (${ctx.qualifiedName})` : " (this button is in none)") + ". Use a page/flow with that one parameter or none");
    }

    async function flowParams(qn, cls, kind, node) {
        const f = await h.get(qn);
        if (!(f instanceof cls)) throw new Error(`${node.where}: '${qn}' is not a ${kind}`);
        const params = f.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject)
            .map(p => ({ name: p.name, entity: p.variableType instanceof datatypes.ObjectType ? p.variableType.entityQualifiedName : null }));
        return { f, params };
    }

    // Data grid 2 on the project's pages and snippets: { exemplars (copyable: type = installed .mpk), stale, def, reason }.
    let dg2 = null;
    const dg2Info = () => dg2 || (dg2 = pluggable.exemplars(client.project, DATAGRID2));
    // ... only those still in the model: a plan may delete the page one sits on before it creates a page
    function dg2Live() {
        const info = dg2Info();
        const ids = new Set(model.allUnits().map(u => u.id));
        const exemplars = info.exemplars.filter(e => ids.has(e.unitId));
        return { ...info, exemplars, reason: info.exemplars.length && !exemplars.length ? "the pages with a Data grid 2 to copy from are deleted earlier in this plan" : info.reason };
    }
    // attribute types a Data grid 2 column can show (from widgets/*.mpk)
    function dg2Types(info) {
        const l = info.def && info.def.lines.find(x => x.startsWith("columns/attribute "));
        const m = l && / attr=([^ ]*)/.exec(l);
        return m && m[1] ? m[1].split(",") : [];
    }

    // classic | datagrid2 for a dataGrid node ("auto" picks datagrid2 when the project has a copyable one and no
    // classic-only field is used); a datagrid2 that cannot be copied is refused before anything is built.
    function gridKind(node) {
        const s = node.spec;
        const raw = s.kind !== undefined ? String(s.kind) : /^datagrid2$/i.test(String(s.widget !== undefined ? s.widget : s.type)) ? "datagrid2" : "classic";
        const asked = { classic: "classic", datagrid: "classic", datagrid1: "classic", datagrid2: "datagrid2", dg2: "datagrid2", auto: "auto" }[raw.toLowerCase().replace(/[\s_-]/g, "")];
        if (!asked) fail(`${node.where}: kind '${raw}' is not known (use classic | datagrid2 | auto)`, raw, ["classic", "datagrid2", "auto"]);
        const cols = Array.isArray(s.columns) ? s.columns : [];
        const classicOnly = [bool(s.search, false) && "search", cols.some(c => c && typeof c === "object" && c.width !== undefined) && "column width",
            s.selection !== undefined && !/^(single|multi|none)$/i.test(String(s.selection)) && `selection ${s.selection}`].filter(Boolean);
        node.kindAsked = asked;
        node.gridKind = "classic";
        if (asked === "classic") return;
        const info = dg2Live();
        if (bool(s.selectFirst, false) && info.def && !info.def.lines.some(l => l.startsWith("autoSelect "))) classicOnly.push(`selectFirst (Data grid 2 ${info.def.version} has no autoSelect)`);
        if (asked === "datagrid2") {
            if (!info.exemplars.length) throw new Error(`${node.where}: "kind": "datagrid2" is not possible here: ${info.reason}. Use "kind": "classic" (a classic Data grid, works in every project)`);
            if (classicOnly.length) throw new Error(`${node.where}: ${classicOnly.join(", ")} ${classicOnly.length > 1 ? "work" : "works"} only with "kind": "classic" (a Data grid 2 gets column filters in Studio Pro; its selection is Single, Multi or None)`);
        }
        // auto: columns a Data grid 2 cannot show (HashedString, ...) make it a classic grid
        if (asked === "auto" && info.exemplars.length && !classicOnly.length && Array.isArray(s.columns) && node.ent) {
            try {
                dg2Cols(node, dg2Types(info));
            } catch (e) {
                const m = /cannot show '([^']+)' \(([^)]+)\)/.exec(e.message);
                classicOnly.push(m ? `column ${m[1]} (${m[2]})` : e.message.slice(node.where.length + 2));
            }
        }
        if (info.exemplars.length && !classicOnly.length) node.gridKind = "datagrid2";
        else node.autoWhy = info.exemplars.length ? `${classicOnly.join(", ")} ${classicOnly.length > 1 ? "are" : "is"} classic only` : info.reason;
    }

    // ------------------------------------------------ widget builders

    async function textTemplate(ct, text, node, ctx) {
        noPlaceholder(text, node.where);
        const used = [];
        const out = String(text).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, attr) => {
            if (!used.includes(attr)) used.push(attr);
            return `{${used.indexOf(attr) + 1}}`;
        });
        if (used.length && !node.container) throw new Error(`${node.where}: {${used[0]}} needs a dataView or listView around the text`);
        for (const name of used) {
            const p = pages.ClientTemplateParameter.create(model);
            ct.parameters.push(p);
            const ref = dm.AttributeRef.create(model);
            ref.attribute = attributeOf(node.container.ent, name, node.where);
            p.attributeRef = ref;
        }
        await textAll(ct.template, out, ctx);
    }

    // An input in data view node dv (Studio Pro names: textBox1, checkBox1, ...).
    async function attrInput(kind, list, attr, dv, where, ctx, label, name) {
        const t = attr.type;
        if (t instanceof dm.BinaryAttributeType) throw new Error(`${where}: '${attr.name}' is binary; no input shows it (use an image or file widget in Studio Pro)`);
        if (kind === "input") {
            if (t instanceof dm.BooleanAttributeType) kind = "checkBox";
            else if (t instanceof dm.DateTimeAttributeType) kind = "datePicker";
            else if (t instanceof dm.EnumerationAttributeType) kind = "radioButtons"; // what Studio Pro-saved pages use (no Forms$DropDown in 10.22-11.13)
            else if (t instanceof dm.StringAttributeType && t.length === 0) kind = "textArea";
            else kind = "textBox";
        }
        const en = t instanceof dm.EnumerationAttributeType;
        const fits = {
            checkBox: t instanceof dm.BooleanAttributeType, datePicker: t instanceof dm.DateTimeAttributeType, radioButtons: en, dropDown: en,
            textArea: t instanceof dm.StringAttributeType, textBox: true
        };
        if (!fits[kind]) throw new Error(`${where}: a ${kind} cannot show '${attr.name}' (${t.structureTypeName.split("$")[1].replace("AttributeType", "")}); use "widget": "input" to pick by type`);
        const w = pages[INPUTS[kind]].create(model);
        list.push(w);
        w.name = name || ctx.names.next(kind);
        const ref = dm.AttributeRef.create(model);
        ref.attribute = attr;
        w.attributeRef = ref;
        if (kind === "textBox" && t instanceof dm.HashedStringAttributeType) w.isPasswordBox = true;
        if (kind === "radioButtons") w.renderHorizontal = true; // Studio Pro's default
        // empty messages: Studio Pro stores one empty text in the default language
        if (kind === "textArea") for (const k of ["counterMessage", "textTooLongMessage"]) if (w[k]) await h.text(w[k], "");
        if (kind === "checkBox" && w.validation) await h.text(w.validation.message, "");
        await templateAll(w, "labelTemplate", label || humanize(attr.name), ctx, where);
        // a parameter data view: Studio Pro writes the parameter + data view; a listening data view: SourceVariable null.
        // An existing data view (ops-page-edit) says itself how its inputs refer to its object.
        if (dv.inputVariable) dv.inputVariable(w);
        else if (dv.source === "parameter") {
            const v = pages.PageVariable.createInAttributeWidgetUnderSourceVariable(w);
            v.pageParameter = dv.param;
            v.widget = dv.widget;
        }
        ctx.count.inputs++;
        return w;
    }

    async function pageParameter(ent, ctx) {
        if (ctx.params.has(ent.qualifiedName)) return ctx.params.get(ent.qualifiedName);
        // a new parameter on an existing page would break every button, menu item and flow that opens it
        if (ctx.existing) throw new Error(`${ctx.qn} has no ${ctx.page instanceof pages.Snippet ? "snippet" : "page"} parameter of ${ent.qualifiedName}, and adding one would break everything that opens it. Give the data view "listenTo" (a grid or list view on the page), or put it inside a data view of ${ent.qualifiedName}`);
        const p = pages.PageParameter.createIn(ctx.page);
        let n = ent.name;
        for (let i = 2; ctx.page.parameters.some(x => x !== p && x.name === n); i++) n = ent.name + i;
        p.name = n;
        const pt = datatypes.ObjectType.create(model);
        pt.entity = ent;
        p.parameterType = pt;
        setIfAvailable(p, "isRequired", true); // 11.5+
        ctx.params.set(ent.qualifiedName, p);
        return p;
    }

    async function button(list, caption, action, style, closePage, ctx) {
        const b = pages.ActionButton.create(model);
        list.push(b);
        b.name = ctx.names.next(action === "save" ? "saveButton" : "cancelButton");
        b.buttonStyle = style;
        const cls = action === "save" ? pages.SaveChangesClientAction : pages.CancelChangesClientAction;
        cls.createInActionButtonUnderAction(b).closePage = closePage;
        await templateAll(b, "caption", caption, ctx, "", true);
        return b;
    }

    // ------------------------------------------------ Data grid 2 (copied from the project's own pages)

    const ATTR_TYPES = { String: "String", HashedString: "HashString", AutoNumber: "AutoNumber", Boolean: "Boolean", DateTime: "DateTime",
        Decimal: "Decimal", Enumeration: "Enum", Integer: "Integer", Long: "Long", Binary: "Binary" };
    const PRIMITIVE = ["Boolean", "Integer", "Decimal", "String", "Enumeration"];

    // Writes only what differs: every SDK write is a model change, and a Data grid 2 has ~70 values to reset.
    function put(o, k, v) {
        let cur;
        try {
            cur = o[k];
        } catch (e) {
            if (/not yet available|no longer|can no longer/.test(e.message)) return;
            throw e;
        }
        if (cur !== v) setIfAvailable(o, k, v);
    }

    // A property value as Studio Pro creates it: the type's default and no model references. shape: a value of the same
    // property whose text template / translatable text (null or not) is copied as empty.
    async function blank(v, pt, shape) {
        const vt = pt.valueType, t = vt.type.name;
        put(v, "primitiveValue", PRIMITIVE.includes(t) ? vt.defaultValue : "");
        put(v, "expression", t === "Expression" ? vt.defaultValue : "");
        for (const k of ["attributeRef", "entityRef", "page", "microflow", "nanoflow", "image", "icon", "sourceVariable", "dataSource"]) put(v, k, null);
        for (const k of ["xPathConstraint", "entityPath", "attributePath"]) put(v, k, "");
        put(v, "selection", cw.CustomWidgetSelectionType.None);
        if (!(v.action instanceof pages.NoClientAction)) pages.NoClientAction.createInWidgetValueUnderAction(v);
        if (v.widgets.length) v.widgets.clear();
        if (v.objects.length) v.objects.clear();
        const tt = shape ? shape.textTemplate : v.textTemplate;
        if (!tt) put(v, "textTemplate", null);
        else if (shape || tt.parameters.length) v.textTemplate = pages.ClientTemplate.create(model);
        if (shape && shape.translatableValue) v.translatableValue = shape.translatableValue.deepCopy(model);
        // a required text gets the widget's own default texts (as when Studio Pro drops the widget)
        if (t === "TextTemplate" && vt.required && (!v.textTemplate || !v.textTemplate.template.translations.some(x => x.text))) {
            if (!v.textTemplate) v.textTemplate = pages.ClientTemplate.create(model);
            await h.text(v.textTemplate.template, Object.fromEntries(vt.translations.map(x => [x.languageCode, x.text])));
        }
    }

    const isGrid2 = el => el instanceof cw.CustomWidget && !!el.type && el.type.widgetId === DATAGRID2;
    const valueOf = (obj, key) => {
        const p = obj && obj.properties.find(x => x.type && x.type.key === key);
        return p ? p.value : null;
    };

    // A new object (e.g. a column) of the given object type, every property blank, shaped like pattern (may be null).
    async function blankObject(objType, pattern) {
        const o = cw.WidgetObject.create(model);
        o.type = objType;
        for (const pt of objType.propertyTypes) {
            const p = cw.WidgetProperty.create(model);
            o.properties.push(p);
            p.type = pt;
            const v = cw.WidgetValue.create(model);
            p.value = v;
            v.type = pt.valueType;
            await blank(v, pt, valueOf(pattern, pt.key) || { textTemplate: null });
        }
        return o;
    }

    const typeOf = attr => ATTR_TYPES[attr.type.structureTypeName.split("$")[1].replace("AttributeType", "")] || "?";

    // A Data grid 2 attribute column (not attached yet), shaped like pattern (an attribute column of the same grid type).
    async function dg2Column(colType, pattern, attr, caption, ctx, where) {
        const col = await blankObject(colType, pattern);
        const show = valueOf(col, "showContentAs");
        if (show) show.primitiveValue = "attribute";
        const ref = dm.AttributeRef.create(model);
        ref.attribute = attr;
        valueOf(col, "attribute").attributeRef = ref;
        const header = valueOf(col, "header");
        if (header) await templateAll(header, "textTemplate", caption, ctx, where);
        return col;
    }

    // A classic grid column at the end of grid.columns; width is a weight (Studio Pro: WidthUnit Weight).
    async function classicColumn(grid, attr, caption, width, ctx) {
        const col = pages.GridColumn.create(model);
        grid.columns.push(col);
        col.name = ctx.names.next("column");
        const ref = dm.AttributeRef.create(model);
        ref.attribute = attr;
        col.attributeRef = ref;
        await textAll(col.caption, caption, ctx);
        await textAll(col.aggregateCaption, "", ctx);
        col.width = width;
        return col;
    }

    // Data grid 2 columns { cols: [{ attr, caption }], dropped }: without "columns" every attribute it can show.
    function dg2Cols(node, allowed) {
        const ent = node.ent;
        const ok = attr => !allowed.length || allowed.includes(typeOf(attr));
        if (node.spec.columns === undefined) {
            const attrs = shown(ent).map(n => attributeOf(ent, n, node.where));
            return { cols: attrs.filter(ok).map(attr => ({ attr, caption: humanize(attr.name) })), dropped: attrs.filter(a => !ok(a)).map(a => `${a.name} (${typeOf(a)})`) };
        }
        const cols = list(node.spec.columns, `${node.where}.columns`).map((c, i) => {
            const s = typeof c === "string" ? { attribute: c } : c;
            if (!s || typeof s !== "object" || !s.attribute) throw new Error(`${node.where} column ${i + 1}: use "Attribute" or { "attribute": ..., "caption": ... }`);
            for (const k of Object.keys(s)) if (!["attribute", "caption"].includes(k)) fail(`${node.where} column ${i + 1}: unknown field '${k}' for a Data grid 2 column`, k, ["attribute", "caption"]);
            const attr = attributeOf(ent, s.attribute, node.where);
            if (!ok(attr)) throw new Error(`${node.where}: a Data grid 2 column cannot show '${attr.name}' (${typeOf(attr)}); it shows ${allowed.join(", ")}`);
            return { attr, caption: s.caption !== undefined ? String(s.caption) : humanize(attr.name) };
        });
        return { cols, dropped: [] };
    }

    async function dataGrid2(node, target, ctx) {
        const ent = node.ent;
        const info = dg2Live();
        const pick = info.exemplars[0];
        if (!pick) throw new Error(`${node.where}: "kind": "datagrid2" is not possible here: ${info.reason}. Use "kind": "classic"`);
        // columns first: a refused column must not leave a half-made copy on the page
        const { cols, dropped } = dg2Cols(node, dg2Types(info));
        if (!cols.length) throw new Error(`${node.where}: a Data grid 2 needs at least one column`);
        const unit = model.allUnits().find(u => u.id === pick.unitId);
        const doc = await unit.load();
        let src = null;
        doc.traverse(el => {
            if (!src && el.id === pick.id) src = el;
        });
        if (!(src instanceof cw.CustomWidget)) throw new Error(`${node.where}: the Data grid 2 on ${pick.unitName} could not be loaded; use "kind": "classic"`);
        const grid = src.deepCopy(model);
        grid.name = node.name;
        target.push(grid);
        node.widget = grid;
        // the copy's object must point into the copy's own type
        const root = grid.object && grid.object.type;
        if (!root || root.containerAsCustomWidgetType !== grid.type) throw new Error(`${node.where}: copying the Data grid 2 kept links to the original; use "kind": "classic"`);
        const ap = grid.appearance;
        for (const k of ["class", "style", "dynamicClasses"]) put(ap, k, "");
        if (ap.designProperties.length) ap.designProperties.clear();
        for (const k of ["conditionalVisibilitySettings", "conditionalEditabilitySettings"]) put(grid, k, null);
        put(grid, "tabIndex", 0);
        if (grid.labelTemplate && grid.labelTemplate.parameters.length) grid.labelTemplate = null;
        const props = new Map(grid.object.properties.map(p => [p.type.key, p]));
        for (const k of ["datasource", "columns", "itemSelection"]) if (!props.has(k)) throw new Error(`${node.where}: this Data grid 2 version has no '${k}' property; use "kind": "classic"`);
        // columns: one per attribute, shaped like an attribute column of the original
        const colProp = props.get("columns");
        const colType = colProp.type.valueType.objectType;
        const olds = [...colProp.value.objects];
        const pattern = olds.find(o => (valueOf(o, "showContentAs") || {}).primitiveValue === "attribute") || olds[0] || null;
        if (dropped.length) client.warn(`${ctx.qn}: ${grid.name} leaves out ${dropped.join(", ")}: a Data grid 2 column cannot show that type (give "columns", or "kind": "classic")`);
        const made = [];
        for (const c of cols) made.push(await dg2Column(colType, pattern, c.attr, c.caption, ctx, node.where));
        // everything else back to the widget's defaults, without the original's references
        for (const p of grid.object.properties) if (p.type.key !== "columns") await blank(p.value, p.type, null);
        colProp.value.objects.clear();
        for (const col of made) colProp.value.objects.push(col);
        // data source: the database (XPath), this entity
        const dsv = props.get("datasource").value;
        const ds = cw.CustomWidgetXPathSource.createInWidgetValueUnderDataSource(dsv);
        dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(ds).entity = ent;
        if (node.spec.xpath) {
            checkXPath(node, ent);
            ds.xPathConstraint = String(node.spec.xpath);
        }
        // selection (Single: row click, as Studio Pro's own master-detail grids)
        const selName = { single: "Single", multi: "Multi", none: "None" }[String(node.spec.selection || "Single").toLowerCase()];
        const selVal = props.get("itemSelection").value;
        if (!selVal.type.selectionTypes.some(x => x.name === selName)) throw new Error(`${node.where}: this Data grid 2 has no selection ${selName}`);
        selVal.selection = cw.CustomWidgetSelectionType[selName];
        const method = valueOf(grid.object, "itemSelectionMethod");
        if (selName === "Single" && method && method.type.enumerationValues.some(e => e.key === "rowClick")) method.primitiveValue = "rowClick";
        if (node.spec.rows !== undefined) {
            const n = Number(node.spec.rows);
            if (!Number.isInteger(n) || n < 1) throw new Error(`${node.where}: rows must be a number >= 1`);
            valueOf(grid.object, "pageSize").primitiveValue = String(n);
        }
        if (bool(node.spec.selectFirst, false)) valueOf(grid.object, "autoSelect").primitiveValue = "true"; // checked in gridKind
        // the copy may refer to nothing but this entity
        const okAttrs = new Set(h.attributeChain(ent).attributes.map(a => a.qualifiedName));
        const left = [];
        grid.traverse(el => {
            if (el === grid) return;
            if (el instanceof pages.Widget) left.push(`widget ${el.name}`);
            else if (el instanceof dm.AttributeRef && !okAttrs.has(el.attributeQualifiedName)) left.push(el.attributeQualifiedName);
            else if (el instanceof dm.EntityRef && !(el instanceof dm.DirectEntityRef && el.entityQualifiedName === ent.qualifiedName)) left.push("entity path");
            else if (el instanceof pages.ClientAction && !(el instanceof pages.NoClientAction)) left.push(el.structureTypeName);
            else if (el instanceof pages.ClientTemplateParameter || el instanceof pages.PageVariable) left.push(el.structureTypeName);
            else if (el instanceof cw.WidgetValue && (el.pageQualifiedName || el.microflowQualifiedName || el.nanoflowQualifiedName || el.imageQualifiedName)) left.push("document link");
        });
        if (left.length) throw new Error(`${node.where}: the Data grid 2 copy still refers to ${[...new Set(left)].slice(0, 3).join(", ")}; use "kind": "classic"`);
        const why = node.kindAsked === "auto" ? `"kind": "auto"` : `"kind": "datagrid2"`;
        client.warnFirst(`${ctx.qn}: ${grid.name} is a Data grid 2 ${info.def.version} (${why}), copied from ${doc.qualifiedName}.${pick.name} with its filters, actions and personalization left empty; "kind": "classic" for a classic Data grid`);
        return `${grid.name} (Data grid 2 ${info.def.version}, ${ent.qualifiedName}, ${cols.length} column(s), selection ${selName}${node.spec.xpath ? ", XPath " + node.spec.xpath : ""})`;
    }

    // Light XPath check: brackets, and the first step of each top-level path is an attribute or association of ent.
    const XPATH_WORDS = new Set(["and", "or", "div", "mod", "empty", "true", "false", "createdDate", "changedDate", "id"]);
    function checkXPath(node, ent) {
        const xp = String(node.spec.xpath).trim();
        if (!/^\[[\s\S]*\]$/.test(xp)) throw new Error(`${node.where}: xpath must be in brackets: [${xp.replace(/^\[|\]$/g, "")}]`);
        if (/\[%CurrentObject%\]/i.test(xp) && !node.container) throw new Error(`${node.where}: '[%CurrentObject%]' is the object of the data view or list view around this ${node.kind}, and it is in none`);
        const body = xp.replace(/'(?:[^']|'')*'/g, "''").replace(/\[%\w+%\]/g, "''");
        const chain = h.attributeChain(ent);
        const d = ent.containerAsDomainModel;
        const assocs = [...d.associations, ...d.crossAssociations].map(a => a.qualifiedName);
        let depth = 0;
        for (let i = 0; i < body.length; i++) {
            const c = body[i];
            if (c === "[") depth++;
            else if (c === "]") depth--;
            if (depth !== 1 || !/[A-Za-z_]/.test(c) || /[\w.$/\]-]/.test(body[i - 1] || "")) continue;
            const m = /^[A-Za-z_][\w.-]*(?:\/[\w.-]+)*/.exec(body.slice(i));
            i += m[0].length - 1;
            if (body.slice(i + 1).trimStart()[0] === "(") continue; // a function
            const first = m[0].split("/")[0];
            if (XPATH_WORDS.has(first) || /^\d/.test(first)) continue;
            if (first.includes(".")) {
                if (!first.startsWith("System.") && !model.findAssociationBaseByQualifiedName(first)) fail(`${node.where}: xpath: no association '${first}'`, first, assocs);
            } else if (!chain.attributes.some(a => a.name === first) && !chain.complete) {
                client.warn(`${node.where}: xpath name '${first}' is no attribute of ${ent.qualifiedName} itself (inherited from a System entity?); check the XPath in Studio Pro`);
            } else if (!chain.attributes.some(a => a.name === first)) {
                fail(`${node.where}: xpath: ${ent.qualifiedName} has no attribute '${first}' (an association is written Module.Assoc)`, first, [...chain.attributes.map(a => a.name), ...assocs]);
            }
        }
    }

    const BUILD = {
        async layoutGrid(node, target, ctx) {
            const lg = pages.LayoutGrid.create(model);
            target.push(lg);
            lg.name = node.name || ctx.names.next("layoutGrid");
            if (node.spec.width) lg.width = choice(pages.ContainerWidth, /^fixed$/i.test(node.spec.width) ? "FixedWidth" : /^full$/i.test(node.spec.width) ? "FullWidth" : node.spec.width, "width", node.where);
            const parts = [];
            for (const r of node.rows) {
                const row = pages.LayoutGridRow.create(model);
                lg.rows.push(row);
                for (const c of r) {
                    const col = pages.LayoutGridColumn.create(model);
                    row.columns.push(col);
                    col.weight = c.weight;
                    col.tabletWeight = c.tablet;
                    col.phoneWeight = c.phone;
                    const inner = [];
                    for (const ch of c.widgets) inner.push(await build(ch, col.widgets, ctx));
                    parts.push(`${c.weight === -1 ? "auto" : c.weight}: ${inner.join(", ") || "empty"}`);
                }
            }
            return `${lg.name} [${parts.join(" | ")}]`;
        },
        async container(node, target, ctx) {
            const d = pages.DivContainer.create(model);
            target.push(d);
            d.name = node.name || ctx.names.next("container");
            if (node.spec.class) d.appearance.class = String(node.spec.class);
            const inner = [];
            for (const ch of node.widgets) inner.push(await build(ch, d.widgets, ctx));
            return `${d.name} [${inner.join(", ")}]`;
        },
        async text(node, target, ctx) {
            const t = pages.DynamicText.create(model);
            target.push(t);
            t.name = node.name || ctx.names.next("text");
            const style = node.spec.style || (node.heading ? "H2" : "Text");
            t.renderMode = choice(pages.TextRenderMode, style, "text style", node.where);
            await textTemplate(t.content, node.spec.text, node, ctx);
            return t.name + (/^text$/i.test(style) ? "" : ` (${t.renderMode.name})`);
        },
        async dataView(node, target, ctx) {
            const dv = pages.DataView.create(model);
            target.push(dv);
            dv.name = node.name || ctx.names.next("dataView");
            const ent = node.ent;
            node.widget = dv;
            if (node.source === "listen") {
                pages.ListenTargetSource.createInEntityWidgetUnderDataSource(dv).listenTarget = node.target.name;
            } else {
                node.param = await pageParameter(ent, ctx);
                const src = pages.DataViewSource.createInEntityWidgetUnderDataSource(dv);
                dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = ent;
                const sv = pages.PageVariable.create(model);
                src.sourceVariable = sv; // attach first: the parameter reference is local to the page
                sv.pageParameter = node.param;
            }
            const editable = bool(node.spec.editable, true);
            // Mendix 10.7+: editability; older: editable
            if (!setIfAvailable(dv, "editability", editable ? pages.EditableEnum.Always : pages.EditableEnum.Never)) setIfAvailable(dv, "editable", editable);
            const fields = node.spec.fields !== undefined ? list(node.spec.fields, `${node.where}.fields`) : node.widgets.length ? [] : shown(ent);
            const inner = [];
            const before = ctx.count.inputs;
            for (const f of fields) inner.push((await attrInput("input", dv.widgets, attributeOf(ent, f, node.where), node, node.where, ctx)).name);
            for (const ch of node.widgets) inner.push(await build(ch, dv.widgets, ctx));
            const buttons = bool(node.spec.buttons, editable && node.source === "parameter" && !node.footer.length);
            const saves = [...node.widgets, ...node.footer].some(function has(n) {
                return (n.kind === "actionButton" && /^save$/i.test(n.spec.action)) || [...(n.widgets || []), ...(n.rows || []).flat().flatMap(c => c.widgets)].some(has);
            });
            if (editable && ctx.count.inputs > before && !buttons && !saves) client.warn(`${ctx.qn}: ${dv.name} is editable but has no Save button: add "buttons": true (or a save actionButton in "footer"), or "editable": false`);
            const foot = [];
            if (buttons) {
                foot.push((await button(dv.footerWidgets, "Save", "save", pages.ButtonStyle.Success, node.source === "parameter", ctx)).name);
                foot.push((await button(dv.footerWidgets, "Cancel", "cancel", pages.ButtonStyle.Default, node.source === "parameter", ctx)).name);
            }
            for (const ch of node.footer) foot.push(await build(ch, dv.footerWidgets, ctx));
            if (!dv.widgets.length) client.warn(`${ctx.qn}: ${dv.name} has no widgets and shows nothing`);
            const how = node.source === "listen" ? `listens to ${node.target.name}` : `parameter ${node.param.name}`;
            return `${dv.name} (${ent.qualifiedName}, ${how}, ${editable ? "editable" : "read-only"}) [${inner.join(", ")}${foot.length ? " | footer: " + foot.join(", ") : ""}]`;
        },
        async dataGrid(node, target, ctx) {
            if (node.gridKind === "datagrid2") return dataGrid2(node, target, ctx);
            const ent = node.ent;
            const grid = pages.DataGrid.create(model);
            grid.columns.clear(); // the SDK adds an empty column
            target.push(grid);
            grid.name = node.name;
            node.widget = grid;
            const src = grid.dataSource; // GridXPathSource from Mendix 10.5 (the "Database" source in Studio Pro)
            if (!(src instanceof pages.GridXPathSource)) throw new Error(`${node.where}: this Mendix version gives a ${src.structureTypeName} source; only the XPath source (10.5+) is supported`);
            dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = ent;
            if (node.spec.xpath) {
                checkXPath(node, ent);
                src.xPathConstraint = String(node.spec.xpath);
            }
            grid.selectionMode = choice(pages.GridSelectionMode, node.spec.selection || "Single", "selection", node.where);
            grid.selectFirst = bool(node.spec.selectFirst, false);
            if (node.spec.rows !== undefined) {
                const n = Number(node.spec.rows);
                if (!Number.isInteger(n) || n < 1) throw new Error(`${node.where}: rows must be a number >= 1`);
                grid.numberOfRows = n;
            }
            const specs = node.spec.columns !== undefined ? list(node.spec.columns, `${node.where}.columns`) : shown(ent);
            const cols = specs.map((c, i) => {
                const s = typeof c === "string" ? { attribute: c } : c;
                if (!s || typeof s !== "object" || !s.attribute) throw new Error(`${node.where} column ${i + 1}: use "Attribute" or { "attribute": ..., "caption": ..., "width": ... }`);
                for (const k of Object.keys(s)) if (!["attribute", "caption", "width"].includes(k)) fail(`${node.where} column ${i + 1}: unknown field '${k}'`, k, ["attribute", "caption", "width"]);
                const attr = attributeOf(ent, s.attribute, node.where);
                if (attr.type instanceof dm.BinaryAttributeType) throw new Error(`${node.where}: '${attr.name}' is binary; a grid column cannot show it`);
                if (s.width !== undefined && !(Number.isInteger(Number(s.width)) && Number(s.width) > 0)) throw new Error(`${node.where} column ${i + 1}: width must be a whole number > 0 (a weight; all columns add up to 100)`);
                return { attr, caption: s.caption !== undefined ? String(s.caption) : humanize(attr.name), width: s.width };
            });
            // widths are weights (Studio Pro: WidthUnit Weight, 100 in total)
            const given = cols.filter(c => c.width !== undefined).reduce((s, c) => s + Number(c.width), 0);
            const open = cols.filter(c => c.width === undefined);
            const share = open.length ? Math.max(1, Math.floor(Math.max(100 - given, open.length) / open.length)) : 0;
            for (const [i, c] of cols.entries()) {
                const last = open.length && c === open[open.length - 1];
                const width = c.width !== undefined ? Number(c.width) : last ? Math.max(1, 100 - given - share * (open.length - 1)) : share;
                if (!(width > 0)) throw new Error(`${node.where} column ${i + 1}: width must be a number > 0`);
                await classicColumn(grid, c.attr, c.caption, width, ctx);
            }
            // search: Studio Pro's generated grids have a Search button and one search field per text/number/enum column
            let fields = 0;
            if (bool(node.spec.search, true)) {
                for (const c of cols) {
                    const t = c.attr.type;
                    const text = t instanceof dm.StringAttributeType;
                    const num = [dm.IntegerAttributeType, dm.LongAttributeType, dm.DecimalAttributeType, dm.AutoNumberAttributeType].some(k => t instanceof k);
                    const en = t instanceof dm.EnumerationAttributeType;
                    if (!text && !num && !en) continue;
                    const f = (en ? pages.DropDownSearchField : pages.ComparisonSearchField).create(model);
                    src.searchBar.items.push(f);
                    f.name = ctx.names.next("searchField");
                    const ref = dm.AttributeRef.create(model);
                    ref.attribute = c.attr;
                    f.attributeRef = ref;
                    f.operator = text ? pages.SearchFieldOperator.Contains : pages.SearchFieldOperator.Equal;
                    await textAll(f.caption, c.caption, ctx);
                    fields++;
                }
            }
            if (fields) {
                const b = pages.GridSearchButton.create(model);
                grid.controlBar.items.push(b);
                b.name = ctx.names.next("searchButton");
                await textAll(b.caption.template, "Search", ctx, true);
            } else src.searchBar.type = pages.SearchBarTypeEnum.None;
            if (!cols.length) client.warn(`${ctx.qn}: ${grid.name} has 0 columns; it shows empty rows (give "columns")`);
            let why = node.kindAsked === "auto" ? `"kind": "auto" picks classic: ${node.autoWhy}` : `"kind": "classic"`;
            if (node.kindAsked === "classic") {
                const d2 = dg2Info();
                if (d2.exemplars.length) why += `; this project uses Data grid 2 (${d2.exemplars.length + d2.stale}x), "kind": "datagrid2" makes one`;
            }
            client.warnFirst(`${ctx.qn}: ${grid.name} is a classic Data grid (${why})`);
            return `${grid.name} (classic Data grid, ${ent.qualifiedName}, ${cols.length} column(s)${fields ? `, ${fields} search field(s)` : ""}${node.spec.xpath ? ", XPath " + node.spec.xpath : ""})`;
        },
        async listView(node, target, ctx) {
            const ent = node.ent;
            const lv = pages.ListView.create(model);
            target.push(lv);
            lv.name = node.name;
            node.widget = lv;
            const src = lv.dataSource;
            if (!(src instanceof pages.ListViewXPathSource)) throw new Error(`${node.where}: this Mendix version gives a ${src.structureTypeName} source; only the XPath source (10.5+) is supported`);
            dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = ent;
            if (node.spec.xpath) {
                checkXPath(node, ent);
                src.xPathConstraint = String(node.spec.xpath);
            }
            if (node.spec.pageSize !== undefined) {
                const n = Number(node.spec.pageSize);
                if (!Number.isInteger(n) || n < 1) throw new Error(`${node.where}: pageSize must be a whole number >= 1`);
                lv.pageSize = n;
            }
            const fields = node.spec.fields !== undefined ? list(node.spec.fields, `${node.where}.fields`) : node.widgets.length ? [] : shown(ent);
            const inner = [];
            for (const f of fields) {
                const attr = attributeOf(ent, f, node.where);
                inner.push(await build({ kind: "text", spec: { text: `{${attr.name}}` }, where: node.where, container: node }, lv.widgets, ctx));
            }
            for (const ch of node.widgets) inner.push(await build(ch, lv.widgets, ctx));
            return `${lv.name} (${ent.qualifiedName}${node.spec.xpath ? ", XPath " + node.spec.xpath : ""}) [${inner.join(", ")}]`;
        },
        async actionButton(node, target, ctx) {
            const s = node.spec;
            const action = String(s.action).toLowerCase();
            const known = ["save", "cancel", "close", "delete", "showpage", "callmicroflow", "callnanoflow"];
            if (!known.includes(action)) fail(`${node.where}: action '${s.action}' is not known (use save | cancel | close | delete | showPage | callMicroflow | callNanoflow)`, s.action, ["save", "cancel", "close", "delete", "showPage", "callMicroflow", "callNanoflow"]);
            const need = { showpage: "page", callmicroflow: "microflow", callnanoflow: "nanoflow" }[action];
            if (need && !s[need]) throw new Error(`${node.where}: action ${s.action} needs '${need}'`);
            for (const k of ["page", "microflow", "nanoflow"]) if (s[k] !== undefined && k !== need) throw new Error(`${node.where}: '${k}' does not go with action ${s.action}`);
            if (s.closePage !== undefined && !["save", "cancel", "delete"].includes(action)) throw new Error(`${node.where}: closePage goes with save, cancel or delete`);
            const caption = s.caption !== undefined ? String(s.caption) : { save: "Save", cancel: "Cancel", close: "Close page", delete: "Delete" }[action];
            if (caption === undefined) throw new Error(`${node.where}: a ${s.action} button needs 'caption'`);
            const b = pages.ActionButton.create(model);
            target.push(b);
            b.name = node.name || ctx.names.next(action === "close" ? "closePageButton" : "actionButton");
            b.buttonStyle = choice(pages.ButtonStyle, s.style || (action === "save" ? "Success" : "Default"), "style", node.where);
            // closes the page by default, except in a data view that listens to a grid (it stays on the page)
            const dvParam = node.container && node.container.kind === "dataView" && node.container.source !== "listen";
            let what = action;
            if (action === "save" || action === "cancel") {
                const cls = action === "save" ? pages.SaveChangesClientAction : pages.CancelChangesClientAction;
                const close = bool(s.closePage, !!dvParam);
                cls.createInActionButtonUnderAction(b).closePage = close;
                what = `${action}, ${close ? "closes the page" : "stays on the page"}`;
            } else if (action === "delete") pages.DeleteClientAction.createInActionButtonUnderAction(b).closePage = bool(s.closePage, false);
            else if (action === "close") pages.ClosePageClientAction.createInActionButtonUnderAction(b);
            else if (action === "showpage") {
                const page = await h.get(s.page);
                if (!(page instanceof pages.Page)) throw new Error(`${node.where}: '${s.page}' is not a page`);
                implicitOnly(page.parameters.map(p => ({ name: p.name, entity: p.parameterType instanceof datatypes.ObjectType ? p.parameterType.entityQualifiedName : null })), node, s.page);
                pages.PageClientAction.createInActionButtonUnderAction(b).pageSettings.page = page;
                what = `opens ${s.page}`;
            } else {
                const nano = action === "callnanoflow";
                const { f, params } = await flowParams(nano ? s.nanoflow : s.microflow, nano ? mf.Nanoflow : mf.Microflow, nano ? "nanoflow" : "microflow", node);
                implicitOnly(params, node, f.qualifiedName);
                if (nano) pages.CallNanoflowClientAction.createInActionButtonUnderAction(b).nanoflow = f;
                else pages.MicroflowClientAction.createInActionButtonUnderAction(b).microflowSettings.microflow = f;
                what = `calls ${f.qualifiedName}`;
            }
            await templateAll(b, "caption", caption, ctx, node.where, s.caption === undefined);
            return `${b.name} (${what})`;
        },
        async input(node, target, ctx) {
            const w = await attrInput(node.kind, target, attributeOf(node.container.ent, node.spec.attribute, node.where), node.container, node.where, ctx, node.spec.label, node.name);
            return w.name;
        }
    };
    for (const k of Object.keys(INPUTS)) BUILD[k] = BUILD.input;

    const build = (node, target, ctx) => BUILD[node.kind](node, target, ctx);

    // ------------------------------------------------ navigation

    async function navProfile(name, where) {
        const doc = model.allNavigationDocuments()[0];
        if (!doc) throw new Error(`${where}: the project has no navigation document`);
        const nav = await doc.load();
        const want = String(name || "Responsive");
        const label = p => `${p.name} (${p.kind ? p.kind.name : "native"})`;
        const hit = nav.profiles.find(p => p.name.toLowerCase() === want.toLowerCase()) ||
            nav.profiles.find(p => p.kind && String(p.kind.name).toLowerCase() === want.toLowerCase());
        if (!hit) fail(`${where}: no navigation profile '${want}' (profiles: ${nav.profiles.map(label).join(", ")})`, want, nav.profiles.map(p => p.name));
        if (!(hit instanceof navigation.NavigationProfile)) throw new Error(`${where}: '${hit.name}' is a native profile; its menu and home page are not supported here (use Studio Pro)`);
        return hit;
    }

    const captionOf = t => (t && t.translations.length ? t.translations[0].text : "");
    function menuItems(items, out = [], depth = 0) {
        for (const it of items) {
            out.push({ item: it, depth });
            menuItems(it.items, out, depth + 1);
        }
        return out;
    }
    const opens = (it, qn) => it.action instanceof pages.PageClientAction && it.action.pageSettings && it.action.pageSettings.pageQualifiedName === qn;

    async function menuItem(o, where, ctx) {
        const page = o.pageObj || (await h.get(o.page));
        if (!(page instanceof pages.Page)) throw new Error(`${where}: '${o.page}' is not a page`);
        if (page.parameters.length) throw new Error(`${where}: ${page.qualifiedName} has a page parameter (${page.parameters.map(p => p.name).join(", ")}); a menu item can only open a page without parameters`);
        const profile = await navProfile(o.profile, where);
        const all = menuItems(profile.menuItemCollection.items);
        if (all.some(x => opens(x.item, page.qualifiedName))) throw new Error(`${where}: ${page.qualifiedName} is already in the ${profile.name} menu`);
        let items = profile.menuItemCollection.items;
        let under = "";
        if (o.parent) {
            const p = all.find(x => x.item.caption.translations.some(t => t.text.toLowerCase() === String(o.parent).toLowerCase()));
            if (!p) fail(`${where}: no menu item '${o.parent}' in the ${profile.name} menu`, o.parent, all.map(x => captionOf(x.item.caption)).filter(Boolean));
            if (p.depth >= 2) throw new Error(`${where}: '${o.parent}' is already 3 levels deep; pick a higher menu item`);
            items = p.item.items;
            under = ` > ${captionOf(p.item.caption)}`;
            if (!(p.item.action instanceof pages.NoClientAction)) client.warn(`${where}: menu item '${o.parent}' opens something itself; menu items with sub-items usually have no action`);
        }
        const item = menus.MenuItem.create(model);
        items.push(item);
        const caption = o.caption !== undefined ? String(o.caption) : captionOf(page.title) || humanize(page.name);
        await textAll(item.caption, caption, ctx);
        const a = pages.PageClientAction.createInMenuItemUnderAction(item);
        a.disabledDuringExecution = false; // what Studio Pro writes for menu items
        a.pageSettings.page = page;
        const seen = await menuRoleLint(where, page, caption);
        return `${profile.name} menu${under}: "${caption}" -> ${page.qualifiedName} (${seen})`;
    }

    async function projectSecurity() {
        const s = model.allProjectSecurities()[0];
        return s ? s.load() : null;
    }

    const securityOff = sec => !sec || sec.securityLevel === sdk.security.SecurityLevel.CheckNothing;

    // A menu item shows only for users whose user role has one of the page's module roles (everyone while app
    // security is off). Returns "seen by: ..." for the dry-run line.
    async function menuRoleLint(where, page, caption) {
        const pr = page.allowedRolesQualifiedNames;
        const sec = await projectSecurity();
        const later = securityOff(sec) ? " once app security is on" : "";
        const users = sec ? sec.userRoles : [];
        const seen = users.filter(u => u.moduleRolesQualifiedNames.some(r => pr.includes(r))).map(u => u.name);
        const hidden = users.filter(u => !seen.includes(u.name)).map(u => u.name);
        if (!pr.length) client.warn(`${where}: ${page.qualifiedName} allows no module roles, so the menu item "${caption}" is hidden for every user${later} (give the page roles: grantAccess)`);
        else if (users.length && !seen.length) client.warn(`${where}: no user role has ${pr.join(" or ")}, so the menu item "${caption}" is hidden for every user${later} (addModuleRoles: { "userRole": "${users[0].name}", "moduleRoles": ["${pr[0]}"] })`);
        else if (hidden.length) client.warn(`${where}: the menu item "${caption}" shows only for user roles with ${pr.join(" or ")}; it is hidden for ${hidden.join(", ")}${later}`);
        return later ? `seen by: everyone while app security is off; then ${seen.join(", ") || "nobody"}` : `seen by: ${seen.join(", ") || "nobody"}`;
    }

    // Lints for the roles of a new page: roles of its own module, that reach users and read the entities the page shows.
    async function roleLints(qn, roles, ents) {
        if (!roles.length) return;
        const sec = await projectSecurity();
        const off = sec && securityOff(sec) ? " once app security is on" : "";
        const mod = qn.split(".")[0];
        for (const r of roles) {
            if (!r.startsWith(mod + ".")) client.warn(`${qn}: ${r} is a role of another module; Studio Pro lets a page use only roles of its own module (${mod}.*)`);
            if (sec && !sec.userRoles.some(u => u.moduleRolesQualifiedNames.includes(r))) client.warn(`${qn}: module role ${r} is in no user role, so no user can open the page${off} (addModuleRoles: { "userRole": "${(sec.userRoles[0] || { name: "Administrator" }).name}", "moduleRoles": ["${r}"] })`);
            for (const e of ents) {
                let ok = false, unknown = false;
                for (let x = e, i = 0; x && i < 20 && !ok; i++) {
                    ok = x.accessRules.some(a => a.moduleRolesQualifiedNames.includes(r));
                    const g = x.generalization;
                    if (g instanceof dm.Generalization && g.generalization && !g.generalization.isLoaded) unknown = true;
                    x = g instanceof dm.Generalization && g.generalization && g.generalization.isLoaded ? g.generalization : null;
                }
                if (!ok && !unknown) client.warn(`${qn}: ${r} has no access rule on ${e.qualifiedName}; with production security the page shows no ${e.name} data for it (addAccessRule)`);
            }
        }
    }

    // ------------------------------------------------ operations

    async function createPage(o) {
        validName(o.name, "page name");
        const qn = `${o.module}.${o.name}`;
        if (unitNamed(qn)) throw new Error(`${qn} already exists`);
        // folders of o.folder that exist now: a failed createPage removes the ones it made (and the page)
        const existed = new Set();
        let f = model.allModules().find(m => m.name === o.module);
        for (const part of String(o.folder || "").split(/[/\\]/).filter(Boolean)) if ((f = f && f.folders.find(x => x.name === part))) existed.add(f);
        const leaf = h.folder(o.module, o.folder); // fails with "did you mean" for a wrong module before anything is created
        try {
            const r = await widgetPage(o, qn);
            if (o.roles) await h.grantAccess({ document: qn, roles: o.roles });
            const extra = [];
            if (o.menu !== undefined && o.menu !== false) {
                const m = o.menu === true ? {} : typeof o.menu === "string" ? { profile: o.menu } : o.menu;
                if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error(`${qn}: menu is "Responsive" or { "profile": ..., "caption": ..., "parent": ... }`);
                if (m.roles !== undefined) throw new Error(`${qn}: ${NO_MENU_ROLES(qn)}`);
                for (const k of Object.keys(m)) if (!["profile", "caption", "parent"].includes(k)) fail(`${qn}: unknown menu field '${k}'`, k, ["profile", "caption", "parent"]);
                extra.push("menu: " + (await menuItem({ ...m, page: qn, pageObj: await h.get(qn) }, `${qn} menu`, r.ctx)));
            }
            await roleLints(qn, [].concat(o.roles || []), r.ctx.ents);
            const ls = await languages();
            if (r.ctx.untranslated && ls.length > 1) client.warn(`${qn}: ${r.ctx.untranslated} text(s) exist only in ${ls[0]}; translate them (${ls.slice(1).join(", ")}) in Studio Pro`);
            return r.text + extra.map(x => "\n      " + x).join("");
        } catch (e) {
            const p = unitNamed(qn);
            if (p) p.delete();
            for (let x = leaf; x instanceof sdk.projects.Folder && !existed.has(x);) {
                const up = x.container;
                x.delete();
                x = up;
            }
            throw e;
        }
    }

    // A page from a widget list; without "widgets": an edit form (one data view of the entity) or an empty page.
    async function widgetPage(o, qn) {
        const form = o.widgets === undefined;
        if (form && o.fields !== undefined && !o.entity) throw new Error(`${qn}: 'fields' needs 'entity'`);
        if (!form) for (const k of ["fields", "buttons"]) if (o[k] !== undefined) throw new Error(`${qn}: '${k}' goes in a dataView widget when 'widgets' is given`);
        if (o.arrange !== undefined && !/^(auto|rows)$/i.test(String(o.arrange))) fail(`${qn}: arrange must be auto or rows`, o.arrange, ["auto", "rows"]);
        const specs = !form ? o.widgets : !o.entity ? [] : [{ widget: "dataView", ...(o.fields !== undefined ? { fields: o.fields } : {}), ...(o.buttons !== undefined ? { buttons: o.buttons } : {}) }];
        const nodes = [];
        const top = scan(specs, form ? "form" : "widgets", null, nodes);
        if (!top.length && !form) throw new Error(`${qn}: 'widgets' is empty; leave it out for an empty page`);
        const ctx = { qn, names: names(), params: new Map(), count: { inputs: 0 }, untranslated: 0, ents: new Set() };
        // entities of grids and list views (a database source needs a persistable entity), then the grid kinds
        for (const n of nodes) {
            if (n.kind !== "dataGrid" && n.kind !== "listView") continue;
            n.ent = await entityOf(n.spec.entity || o.entity, n.where);
            if (!h.persistable(n.ent)) throw new Error(`${n.where}: ${n.ent.qualifiedName} is non-persistable; a grid or list view over the database needs a persistable entity (show it in a data view with source parameter, or set a microflow/nanoflow source in Studio Pro)`);
        }
        for (const n of nodes) if (n.kind === "dataGrid") gridKind(n);
        // names: given ones first, then grids and list views (listenTo needs them before anything is built)
        for (const n of nodes) if (n.name) ctx.names.reserve(n.name, n.where);
        for (const n of nodes) if (!n.name && (n.kind === "dataGrid" || n.kind === "listView")) n.name = ctx.names.next(n.gridKind === "datagrid2" ? "dataGrid2_" : PREFIX[n.kind]);
        // data view sources
        for (const n of nodes.filter(x => x.kind === "dataView")) {
            const s = n.spec;
            let source = s.source !== undefined ? String(s.source).toLowerCase() : null;
            if (source === "entity") source = "parameter";
            if (source !== null && !["parameter", "listen"].includes(source)) fail(`${n.where}: source '${s.source}' is not known (use parameter | listen)` + (/assoc/.test(source) ? `; ${MASTER_DETAIL}` : ""), s.source, ["parameter", "listen", "entity"]);
            if (s.parameter !== undefined) throw new Error(`${n.where}: use "source": "parameter"`);
            if (s.listenTo !== undefined && source === "parameter") throw new Error(`${n.where}: listenTo goes with source listen, not parameter`);
            n.source = source || (s.listenTo !== undefined ? "listen" : "parameter");
            if (n.source === "listen") {
                if (s.listenTo === undefined) throw new Error(`${n.where}: source listen needs listenTo (a grid or list view on this page)`);
                n.target = listenTarget(n, nodes);
                if (s.entity && s.entity !== n.target.ent.qualifiedName) throw new Error(`${n.where}: listens to ${n.target.name} (${n.target.ent.qualifiedName}), but entity is ${s.entity}; ${MASTER_DETAIL}`);
                n.ent = n.target.ent;
                const sel = String(n.target.spec.selection || "Single").toLowerCase();
                if (n.target.gridKind === "datagrid2" && sel !== "single") throw new Error(`${n.where}: listenTo needs a Data grid 2 with selection Single (${n.target.name} has ${n.target.spec.selection}); leave out "selection"`);
                if (n.target.kind === "dataGrid" && sel === "none") client.warn(`${qn}: ${n.name || "the data view"} listens to ${n.target.name}, whose selection is None; select Single so it can show a row`);
                else if (n.target.kind === "dataGrid" && /multi/.test(sel)) client.warn(`${qn}: ${n.target.name} allows multi-selection; the listening data view shows one of the selected rows (Single is usual)`);
            } else n.ent = await entityOf(s.entity || o.entity, n.where);
        }
        for (const n of nodes) if (n.ent) ctx.ents.add(n.ent);
        // a grid or list view followed by the data view that listens to it: side by side (8/4)
        let arranged = top;
        if (!/^rows$/i.test(String(o.arrange || ""))) {
            arranged = [];
            for (let i = 0; i < top.length; i++) {
                const a = top[i], b = top[i + 1];
                if (b && b.kind === "dataView" && b.target === a) {
                    arranged.push({ kind: "layoutGrid", spec: {}, where: `${a.where} + ${b.where}`, rows: [[{ weight: 8, tablet: -1, phone: -1, widgets: [a] }, { weight: 4, tablet: -1, phone: -1, widgets: [b] }]] });
                    i++;
                } else arranged.push(a);
            }
        }
        const withParameter = nodes.some(n => n.kind === "dataView" && n.source === "parameter");
        const { layout, placeholder } = pickLayout(o.layout, withParameter);
        const layoutDoc = await h.get(layout);
        const page = pages.Page.createIn(h.folder(o.module, o.folder));
        ctx.page = page;
        page.name = o.name;
        if (pages.Autofocus && pages.Autofocus.DesktopOnly) setIfAvailable(page, "autofocus", pages.Autofocus.DesktopOnly); // Studio Pro's default (11.1+)
        await textAll(page.title, o.title || humanize(o.name), ctx);
        const call = pages.LayoutCall.createInPageUnderLayoutCall(page);
        call.layout = layoutDoc;
        const arg = pages.LayoutCallArgument.createIn(call);
        const short = placeholder.split(".").pop();
        let lp = null;
        layoutDoc.traverse(el => {
            if (!lp && el instanceof pages.Placeholder && el.name === short) lp = el;
        });
        if (!lp) throw new Error(`layout ${layout} has no placeholder '${short}'`);
        arg.parameter = lp;
        const parts = [];
        for (const n of arranged) parts.push(await build(n, arg.widgets, ctx));
        if (form) return { ctx, text: `${qn} (layout ${layout}${o.entity ? `, form for ${o.entity} with ${ctx.count.inputs} input(s)` : ""})` };
        return { ctx, text: `${qn} (layout ${layout}${ctx.params.size ? `, parameter ${[...ctx.params.values()].map(p => p.name).join(", ")}` : ""})\n      widgets: ${parts.join("; ")}` };
    }

    function listenTarget(n, nodes) {
        const want = String(n.spec.listenTo);
        const listenable = nodes.filter(x => x.kind === "dataGrid" || x.kind === "listView");
        const cands = listenable.length ? `grids and list views on this page: ${listenable.map(x => `${x.name} (${x.kind})`).join(", ")}` : `this page has no dataGrid or listView; add one to "widgets"`;
        const named = nodes.find(x => x.name === want);
        if (named) {
            if (!listenable.includes(named)) throw new Error(`${n.where}: listenTo '${want}' is a ${named.kind}; a data view listens to a dataGrid or listView (${cands})`);
            return named;
        }
        const kind = LISTENABLE[want.toLowerCase()];
        if (kind) {
            const c = listenable.filter(x => x.kind === kind);
            if (c.length === 1) return c[0];
            if (!c.length) throw new Error(`${n.where}: listenTo '${want}': there is no ${kind} on this page (${cands})`);
            throw new Error(`${n.where}: listenTo '${want}' is ambiguous: ${c.length} ${kind}s on this page (${c.map(x => x.name).join(", ")}); give the name of the one to follow`);
        }
        return fail(`${n.where}: listenTo '${want}' is no grid or list view on this page (${cands})`, want, listenable.map(x => x.name).concat(["dataGrid", "listView"]));
    }

    async function addMenuItem(o) {
        return menuItem(o, `addMenuItem ${o.page}`, null);
    }

    async function setHomePage(o) {
        const where = "setHomePage";
        if (!o.page === !o.microflow) throw new Error(`${where} needs 'page' or 'microflow' (one of them)`);
        let page = null, flow = null;
        if (o.page) {
            page = await h.get(o.page);
            if (!(page instanceof pages.Page)) throw new Error(`${where}: '${o.page}' is not a page`);
            if (page.parameters.length) throw new Error(`${where}: ${o.page} has a page parameter; a home page cannot have one`);
        } else {
            flow = await h.get(o.microflow);
            if (!(flow instanceof mf.Microflow)) throw new Error(`${where}: '${o.microflow}' is not a microflow`);
            if (flow.objectCollection.objects.some(x => x instanceof mf.MicroflowParameterObject)) throw new Error(`${where}: ${o.microflow} has parameters; a home microflow cannot have any`);
        }
        const profile = await navProfile(o.profile, where);
        const target = page ? page.qualifiedName : flow.qualifiedName;
        const roles = [].concat(o.roles || []);
        const pageRoles = page ? page.allowedRolesQualifiedNames : flow.allowedModuleRolesQualifiedNames;
        const sec = await projectSecurity();
        const later = securityOff(sec) ? " once app security is on" : "";
        if (!roles.length) {
            profile.homePage.page = page;
            profile.homePage.microflow = flow;
            if (!pageRoles.length) client.warn(`${where}: ${target} allows no module roles; users get an error instead of the home page${later} (give it roles: grantAccess)`);
            return `${profile.name} home page -> ${target}`;
        }
        if (!sec) throw new Error(`${where}: the project has no project security, so it has no user roles`);
        for (const name of roles) {
            const ur = userRoleNamed(sec, name, `${where}: `);
            let rb = profile.roleBasedHomePages.find(x => x.userRoleQualifiedName === ur.qualifiedName);
            if (!rb) {
                rb = navigation.RoleBasedHomePage.create(model);
                profile.roleBasedHomePages.push(rb);
                rb.userRole = ur;
            }
            rb.page = page;
            rb.microflow = flow;
            if (!ur.moduleRolesQualifiedNames.some(r => pageRoles.includes(r))) client.warn(`${where}: user role ${name} has none of the roles that may open ${target} (${pageRoles.join(", ") || "none"})${later}`);
        }
        return `${profile.name} home page for ${roles.join(", ")} -> ${target}`;
    }

    // ------------------------------------------------ checks after apply (fresh model)

    function countSpecs(specs, out = {}) {
        for (const s of specs || []) {
            if (!s || typeof s !== "object") continue;
            const raw = String(s.widget !== undefined ? s.widget : s.type).toLowerCase();
            const kind = KINDS.find(k => k.toLowerCase() === raw) || ALIASES[raw];
            out[kind] = (out[kind] || 0) + 1;
            countSpecs(s.widgets, out);
            countSpecs(s.footer, out);
            if (kind === "layoutGrid") for (const r of [].concat(s.rows || [{ columns: s.columns }])) for (const c of (r && r.columns) || []) if (c && typeof c === "object") countSpecs(c.widgets, out);
        }
        return out;
    }

    async function menuHas(profileName, qn) {
        const profile = await navProfile(profileName, "check");
        return menuItems(profile.menuItemCollection.items).some(x => opens(x.item, qn));
    }

    const checks = {
        async createPage(o) {
            const qn = `${o.module}.${o.name}`;
            const page = await h.get(qn);
            const r = [];
            if (o.widgets === undefined) {
                if (o.entity && !page.parameters.length) r.push(`${qn} has no page parameter`);
            } else {
                const want = countSpecs(o.widgets);
                const have = {};
                const names = new Map();
                const listens = [];
                page.traverse(el => {
                    const k = el instanceof pages.DataGrid || isGrid2(el) ? "dataGrid" : el instanceof pages.DataView ? "dataView" : el instanceof pages.ListView ? "listView" : el instanceof pages.ActionButton ? "actionButton" : el instanceof pages.LayoutGrid ? "layoutGrid" : null;
                    if (k) have[k] = (have[k] || 0) + 1;
                    if (el instanceof pages.Widget) names.set(el.name, el);
                    if (el instanceof pages.ListenTargetSource) listens.push(el.listenTarget);
                });
                for (const k of ["dataGrid", "dataView", "listView"]) if ((want[k] || 0) !== (have[k] || 0)) r.push(`${qn} has ${have[k] || 0} ${k}(s), expected ${want[k] || 0}`);
                for (const k of ["layoutGrid", "actionButton"]) if ((have[k] || 0) < (want[k] || 0)) r.push(`${qn} has ${have[k] || 0} ${k}(s), expected at least ${want[k]}`);
                for (const t of listens) {
                    const w = names.get(t);
                    if (!(w instanceof pages.DataGrid || w instanceof pages.ListView || isGrid2(w))) r.push(`${qn}: a data view listens to '${t}', which is no grid or list view on the page`);
                    else if (isGrid2(w) && valueOf(w.object, "itemSelection").selection !== cw.CustomWidgetSelectionType.Single) r.push(`${qn}: ${t} is listened to but its selection is not Single`);
                }
            }
            if (o.menu !== undefined && o.menu !== false) {
                const m = typeof o.menu === "string" ? { profile: o.menu } : o.menu === true ? {} : o.menu;
                if (!(await menuHas(m.profile, qn))) r.push(`${qn} is not in the ${m.profile || "Responsive"} menu`);
            }
            return r;
        },
        async addMenuItem(o) {
            return (await menuHas(o.profile, o.page)) ? [] : [`${o.page} is not in the ${o.profile || "Responsive"} menu`];
        },
        async setHomePage(o) {
            const profile = await navProfile(o.profile, "check");
            const target = o.page || o.microflow;
            const roles = [].concat(o.roles || []);
            const at = hp => hp && (hp.pageQualifiedName === target || hp.microflowQualifiedName === target);
            if (!roles.length) return at(profile.homePage) ? [] : [`${profile.name} home page is not ${target}`];
            return roles.filter(r => !at(profile.roleBasedHomePages.find(x => x.userRoleQualifiedName === r))).map(r => `${profile.name} home page for ${r} is not ${target}`);
        }
    };

    // the builders and lookups ops-page-edit.js uses on existing pages
    const internals = { scan, build, gridKind, entityOf, attributeOf, names, textAll, templateAll, noPlaceholder, checkXPath, dg2Info,
        isGrid2, valueOf, humanize, languages, shown, listenTarget, classicColumn, dg2Column, typeOf, isA, list, unitNamed };
    return { createPage, addMenuItem, setHomePage, checks, internals };
}

module.exports = { makePages, PAGE_FIELDS, MENU_FIELDS, HOME_FIELDS, WIDGETS, INPUTS, PREFIX, MASTER_DETAIL, DATAGRID2, widgetKind, widgetFields, NO_MENU_ROLES };
