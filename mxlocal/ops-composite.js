"use strict";
// Composites of a design system, built with the createPage machinery (ops-pages.js, ops-page-edit.js):
// - createBuildingBlock / changeBuildingBlock: a Forms$BuildingBlock (Platform Web) with DisplayName, DocumentationUrl,
//   TemplateCategory, TemplateCategoryWeight as Studio Pro stores Atlas_Web_Content's (Mendix 10.24 - 11.13 samples);
//   its widgets come from the createPage "widgets" JSON. As in Studio Pro's own building blocks, a data view or list
//   view without an entity stays unconfigured (DataViewSource / ListViewXPathSource with EntityRef null, inputs with
//   AttributeRef null, Save / Cancel client actions): the page it is dropped on sets it. Such widgets are built as
//   containers / texts / close buttons first (the builders need an entity) and swapped afterwards.
// - createPageTemplate: a Forms$PageTemplate with a LayoutCall (one argument per placeholder), Appearance and
//   TemplateType (Regular / Edit / Select / Overview where the SDK has them), as Atlas_Web_Content's.
// - createLayout without "from": a Forms$Layout with WebLayoutContent (LayoutType), built like Atlas_Core's
//   Atlas_Default (sidebar), Atlas_TopBar (top bar) and PopupLayout (blank): a ScrollContainer "layoutContainer" with
//   regions region-content (placeholders), region-sidebar (navigation tree), region-topbar (toggle button, brand,
//   menu bar), region-footer; header / sidebar / footer widgets from the createPage JSON.
// - applyStyle: class / design / style on every matching widget of a scope, with a dry-run list and limits.
const sdk = require("mendixmodelsdk");
const { fail, validName, setIfAvailable, enumValue, bool } = require("./ops-util");
const design = require("./design");

const { pages, navigation, menus, customwidgets: cw } = sdk;

const TEMPLATE_INFO = {
    displayName: "optional name in Studio Pro's toolbox (default: the name with spaces)",
    category: "optional toolbox category (Studio Pro: Template category; default: the module name)",
    categoryWeight: "optional order inside the category, a whole number (lower first; Atlas uses 10, 20, ...)",
    documentationUrl: "optional link shown in Studio Pro's toolbox",
    documentation: "optional documentation text"
};
const UNBOUND = "a button without \"action\" gets none yet (as Atlas building blocks); a data view or list view without \"entity\" (and without source fields) stays unconfigured, as in Studio Pro's own building blocks: inside it, inputs without \"attribute\" ({ \"widget\": \"textBox\", \"label\": \"Name\" }; also textArea, datePicker, checkBox, radioButtons, dropDown) and save / cancel buttons; the page it lands on sets the entity";
const COMPOSITE_OPS = {
    createBuildingBlock: {
        doc: "Create a web building block (Studio Pro toolbox) from widgets as in createPage. A data view or list view without an entity stays unconfigured (the page it is dropped on sets it), as in Atlas building blocks. Pages take it with createPage / addWidgets { \"widget\": \"buildingBlock\", \"from\": \"Module.Name\" }; its own widgets change with addWidgets / changeWidget (page = Module.BuildingBlock).",
        fields: {
            module: "R module name", name: "R building block name", folder: "optional folder path",
            widgets: "R [ { \"widget\": \"<kind>\", ... } ] as in createPage; " + UNBOUND,
            entity: "optional Module.Entity: default entity of grids, list views and galleries that give none (a bound building block)",
            ...TEMPLATE_INFO
        }
    },
    changeBuildingBlock: {
        doc: "Change the toolbox details of a building block or page template: display name, category, its order, documentation link. Its widgets change with addWidgets / changeWidget / deleteWidget (page = the building block or page template).",
        fields: { document: "R Module.BuildingBlock or Module.PageTemplate", ...TEMPLATE_INFO }
    },
    createPageTemplate: {
        doc: "Create a page template (Studio Pro: New page > template) on a layout, with widgets per placeholder as in createPage. A data view or list view without an entity stays unconfigured (Studio Pro asks for it when a page is made from the template). createPage \"from\" takes it.",
        fields: {
            module: "R module name", name: "R page template name", folder: "optional folder path",
            layout: "optional Module.Layout (default: the layout most of the project's pages use)",
            widgets: "optional [ widgets ] for the layout's main placeholder (Main, or its only one); " + UNBOUND,
            placeholders: "optional instead of widgets: { \"Main\": [ widgets ], \"<other placeholder>\": [ widgets ] }",
            type: "optional regular | edit | select | overview (Studio Pro's template type: regular for any page, edit for an edit form; default regular; edit / select / overview where this Mendix version has them)",
            entity: "optional Module.Entity: default entity of grids, list views and galleries that give none",
            class: "optional CSS class(es) of the page made from it", style: "optional inline CSS of the page made from it",
            ...TEMPLATE_INFO
        }
    },
    applyStyle: {
        doc: "Set a CSS class, design properties or inline style on every widget that matches (a widget type, a scope of pages / snippets / layouts / building blocks, a name pattern, a current class): the dry run lists every widget it changes. Without page, module or folder it is refused unless \"all\": true.",
        fields: {
            widget: "R widget kind: dataGrid2 | dataGrid | listView | gallery | dataView | actionButton | container | text | layoutGrid | groupBox | tabContainer | textBox | textArea | datePicker | checkBox | input (every input) | image | snippetCall | any (every widget)",
            page: "optional scope: Module.Page (also a snippet, layout, building block or page template), or a list of them",
            module: "optional scope: every page, snippet, layout, building block and page template of a module (or a list of modules); Marketplace modules are refused",
            folder: "optional with module: only documents in this folder path (and below)",
            all: "optional true: every non-Marketplace module (needed when page and module are left out)",
            match: "optional widget name pattern: \"save*\", \"*Grid*\" (* = anything; default every name)",
            hasClass: "optional only widgets whose class list has this class",
            class: "optional the class(es) to set (replaces the current ones; \"\" = none)",
            addClass: "optional class(es) to add (kept once)", removeClass: "optional class(es) to remove",
            design: "optional design properties as in changeWidget: { \"Spacing\": { \"margin-top\": \"M\" }, \"Full width\": true } (null / false removes one)",
            style: "optional inline CSS (replaces the current one; \"\" = none)",
            buttonStyle: "optional with widget actionButton: Default | Primary | Success | Info | Warning | Danger | Inverse",
            limit: "optional the most widgets it may change (default 200); more matches are refused with the count"
        }
    },
    createComponentKit: {
        doc: "Create a component kit: one web building block per recipe (card, KPI tile, page header with actions, toolbar above a Data grid 2, form section, list of cards, list view as columns, card layout, gallery, empty state, master-detail) with Atlas classes and \"<prefix>-...\" classes, in one toolbox category; withStyles also writes the SCSS those classes expect.",
        fields: {
            module: "R module name", prefix: "R short company prefix for names and classes, e.g. \"acme\" (building blocks Acme_Card, ...; classes acme-card, acme-card__title, ...)",
            kit: "optional [ \"card\" | \"kpiTile\" | \"pageHeader\" | \"toolbar\" | \"formSection\" | \"listCards\" | \"listColumns\" | \"cardLayout\" | \"gallery\" | \"emptyState\" | \"masterDetail\" or { \"recipe\": ..., \"name\": ..., options } ] (default all but gallery); options: title, text, label, value, delta, subtitle, actions [captions], captions (listColumns), cards (cardLayout: how many), fields [labels, or attributes with entity], labels top | side (formSection), columns, tabletColumns, phoneColumns (gallery), entity",
            entity: "optional Module.Entity for the recipes that show data (toolbar: a Data grid 2 with a search filter; listCards, gallery, masterDetail: bound to it); without it they stay unconfigured (gallery needs it)",
            folder: "optional folder path (default Kit)", category: "optional toolbox category (default \"<Prefix> kit\")",
            withStyles: "optional true: append the kit's SCSS (CSS custom properties with fallbacks) to the theme file", file: "optional with withStyles: the SCSS file (default themesource/<module>/web/main.scss when the module has one, else theme/web/main.scss)"
        }
    },
    createStyleGuide: {
        doc: "Create a style guide page: typography, buttons in every Atlas style, inputs (page variables), cards, alerts, badges, a Data grid 2 and a list view of an entity, and the component kit's building blocks; optionally a menu item.",
        fields: {
            module: "R module name", name: "optional page name (default StyleGuide)", folder: "optional folder path", title: "optional page title (default Style guide)",
            layout: "optional Module.Layout (default the one most pages use)", prefix: "optional component kit prefix (createComponentKit): its building blocks are shown (those without unconfigured data widgets)",
            entity: "optional Module.Entity for the data grid and list view section (without it that section is left out)",
            menu: "optional \"Responsive\" or { \"profile\", \"caption\", \"parent\" }: a menu item that opens it", roles: "optional [ \"Module.Role\" ] that may open it"
        }
    }
};

const COMPOSITE_SYNONYMS = {
    createStyleGuide: { kit: "use \"prefix\" (the kit's prefix)", widgets: "a style guide is generated; add widgets afterwards with addWidgets", sections: "every section is generated; delete one with deleteWidget" },
    createComponentKit: { recipes: "use \"kit\"", components: "use \"kit\"", styles: "use \"withStyles\": true", name: "a kit makes several building blocks: give \"prefix\" (and per item { \"recipe\": ..., \"name\": ... })", widgets: "a kit is made of recipes (\"kit\"); one building block of your own widgets: createBuildingBlock" },
    createBuildingBlock: { title: "a building block has no title; \"displayName\" is its toolbox name", templateCategory: "use \"category\"", templateCategoryWeight: "use \"categoryWeight\"", layout: "a building block has no layout (a page template has: createPageTemplate)", parameters: "a building block has no parameters: leave out the data view's entity (unconfigured) or give it listenTo / source", preset: "use createComponentKit for ready-made recipes" },
    createPageTemplate: { templateCategory: "use \"category\"", templateCategoryWeight: "use \"categoryWeight\"", templateType: "use \"type\"", title: "a page template has no title (pages made from it get one)", from: "a template is not copied from another; give \"widgets\" or \"placeholders\"" },
    changeBuildingBlock: { name: "renaming is the rename op", page: "use \"document\"", templateCategory: "use \"category\"", templateCategoryWeight: "use \"categoryWeight\"" },
    applyStyle: { type: "use \"widget\" (the widget kind)", kind: "use \"widget\" (the widget kind)", pages: "use \"page\": [ ... ]", modules: "use \"module\": [ ... ]", name: "use \"match\" (a name pattern)", widgets: "use \"widget\" (one kind) and \"match\" (a name pattern)", currentClass: "use \"hasClass\"", dryRun: "every change has a dry run: run it without apply", classes: "use \"class\", \"addClass\" or \"removeClass\"" }
};

// keys of a data view / list view that make it bound (configured); without any of them it stays unconfigured
const DV_BOUND = ["entity", "listenTo", "source", "association", "microflow", "nanoflow", "params", "fields"];
const LV_BOUND = ["entity", "source", "association", "microflow", "nanoflow", "params", "xpath", "fields", "search", "sort"];
const DV_FREE = ["widget", "type", "name", "widgets", "footer", "editable", "orientation", "labelWidth", "readOnlyStyle", "showFooter", "buttons", "class", "style", "design"];
const LV_FREE = ["widget", "type", "name", "widgets", "pageSize", "class", "style", "design"];
const FREE_INPUTS = ["textBox", "textArea", "datePicker", "checkBox", "radioButtons", "dropDown"];

// x: { model, client, get, exists, entity, folder, pageOps, pageEdit, impl: () => ops impl, themeOps }
function makeComposite(x) {
    const { model, client } = x;
    const I = () => x.pageOps.internals;
    const { widgetKind } = require("./ops-pages");

    // ------------------------------------------------ toolbox details (Forms$TemplateFormBase)

    function templateInfo(doc, o, where, fresh) {
        const out = [];
        if (o.displayName !== undefined || fresh) {
            const v = o.displayName !== undefined ? String(o.displayName) : String(o.name).replace(/_/g, " ");
            if (doc.displayName !== v) doc.displayName = v;
            out.push(`display name "${v}"`);
        }
        if (o.category !== undefined || fresh) {
            const v = o.category !== undefined ? String(o.category) : doc.qualifiedName.split(".")[0];
            if (!setIfAvailable(doc, "templateCategory", v)) client.warn(`${where}: Mendix ${client.project.version} has no template category; category left out`);
            else out.push(`category "${v}"`);
        }
        if (o.categoryWeight !== undefined) {
            const n = Number(o.categoryWeight);
            if (!Number.isInteger(n)) throw new Error(`${where}: categoryWeight is a whole number (lower comes first), got ${JSON.stringify(o.categoryWeight)}`);
            setIfAvailable(doc, "templateCategoryWeight", n);
            out.push(`weight ${n}`);
        }
        if (o.documentationUrl !== undefined) {
            doc.documentationUrl = String(o.documentationUrl);
            out.push("documentation link");
        }
        if (o.documentation !== undefined) doc.documentation = String(o.documentation).replace(/\r?\n/g, "\r\n");
        return out;
    }

    // ------------------------------------------------ unconfigured data views and inputs

    // Every "name" given in a widget spec tree.
    function givenNames(v, out = []) {
        if (Array.isArray(v)) v.forEach(e => givenNames(e, out));
        else if (v && typeof v === "object") {
            if (typeof v.name === "string" && (v.widget !== undefined || v.caption !== undefined)) out.push(v.name);
            for (const k of ["widgets", "footer", "tabs", "rows", "columns"]) if (v[k] !== undefined) givenNames(v[k], out);
        }
        return out;
    }

    // Unconfigured data views / list views (and the inputs and save / cancel buttons in them) -> stand-ins the builders
    // can make without an entity; st.markers says what each stand-in becomes (swap). bound: inside a configured data
    // container (there the normal rules apply).
    function unbound(specs, where, st, bound, inFree) {
        if (!Array.isArray(specs)) return specs;
        return specs.map((spec, i) => {
            const at = `${where}[${i + 1}]`;
            if (!spec || typeof spec !== "object" || Array.isArray(spec)) return spec;
            const kind = widgetKind(spec.widget !== undefined ? spec.widget : spec.type);
            if (!kind) return spec; // the builder names the unknown kind
            const kids = (s, b, free) => {
                const c = { ...s };
                for (const k of ["widgets", "footer"]) if (Array.isArray(s[k])) c[k] = unbound(s[k], `${at}.${k}`, st, b, free);
                if (Array.isArray(s.tabs)) c.tabs = s.tabs.map((t, ti) => (t && typeof t === "object" && Array.isArray(t.widgets) ? { ...t, widgets: unbound(t.widgets, `${at} tab ${ti + 1}.widgets`, st, b, free) } : t));
                const rowsOf = r => (r && typeof r === "object" && Array.isArray(r.columns) ? { ...r, columns: r.columns.map((col, ci) => (col && typeof col === "object" && Array.isArray(col.widgets) ? { ...col, widgets: unbound(col.widgets, `${at} column ${ci + 1}.widgets`, st, b, free) } : col)) } : r);
                if (Array.isArray(s.rows)) c.rows = s.rows.map(rowsOf);
                else if (kind === "layoutGrid" && Array.isArray(s.columns)) c.columns = rowsOf({ columns: s.columns }).columns;
                return c;
            };
            if (bound) return kids(spec, true, false);
            if (kind === "dataView" && !DV_BOUND.some(k => spec[k] !== undefined)) {
                for (const k of Object.keys(spec)) if (!DV_FREE.includes(k)) fail(`${at}: an unconfigured data view (no "entity") takes ${DV_FREE.filter(f => !["widget", "type"].includes(f)).join(", ")}; '${k}' needs an entity: give "entity" and a source (listenTo, source context / association / microflow)`, k, DV_FREE);
                const name = spec.name !== undefined ? String(spec.name) : st.names.next("dataView");
                const foot = st.names.next("zzFooterStandIn");
                const body = unbound(spec.widgets || [], `${at}.widgets`, st, false, true);
                const footer = unbound(spec.footer || [], `${at}.footer`, st, false, true);
                if (bool(spec.buttons, false)) {
                    for (const a of ["save", "cancel"]) {
                        const n = st.names.next("actionButton");
                        footer.push({ widget: "actionButton", action: "close", name: n, caption: a === "save" ? "Save" : "Cancel", style: a === "save" ? "Success" : "Default" });
                        st.markers.push({ kind: "button", name: n, action: a, where: at });
                    }
                }
                st.markers.push({ kind: "dataView", name, footer: foot, spec, where: at });
                return { widget: "container", name, widgets: [...body, { widget: "container", name: foot, widgets: footer }] };
            }
            if (kind === "listView" && !LV_BOUND.some(k => spec[k] !== undefined)) {
                for (const k of Object.keys(spec)) if (!LV_FREE.includes(k)) fail(`${at}: an unconfigured list view (no "entity") takes ${LV_FREE.filter(f => !["widget", "type"].includes(f)).join(", ")}; '${k}' needs an entity`, k, LV_FREE);
                const name = spec.name !== undefined ? String(spec.name) : st.names.next("listView");
                st.markers.push({ kind: "listView", name, spec, where: at });
                return { widget: "container", name, widgets: unbound(spec.widgets || [], `${at}.widgets`, st, false, true) };
            }
            if (["dataGrid", "gallery", "templateGrid"].includes(kind) && spec.entity === undefined && !["association", "microflow", "nanoflow"].some(k => spec[k] !== undefined) && !st.entity) {
                throw new Error(`${at}: a ${kind} in a ${st.what} needs "entity" (a configured one), or use an unconfigured listView (no entity), which the page it lands on sets`);
            }
            if (inFree && (FREE_INPUTS.includes(kind) || kind === "input") && spec.attribute === undefined && spec.variable === undefined) {
                const input = kind === "input" ? "textBox" : kind;
                for (const k of Object.keys(spec)) if (!["widget", "type", "name", "label"].includes(k)) fail(`${at}: an input without "attribute" (unconfigured) takes label and name; '${k}' needs the attribute`, k, ["label", "name"]);
                const name = spec.name !== undefined ? String(spec.name) : st.names.next(input);
                const label = spec.label !== undefined ? String(spec.label) : "Label";
                st.markers.push({ kind: "input", name, input, label, where: at });
                return { widget: "text", name, text: label || " " };
            }
            if (kind === "actionButton" && spec.action === undefined) {
                // no action yet (as Atlas building blocks' buttons): the page author sets it
                const name = spec.name !== undefined ? String(spec.name) : st.names.next("actionButton");
                if (spec.caption === undefined) throw new Error(`${at}: a button without an action needs "caption"`);
                st.markers.push({ kind: "button", name, action: "none", where: at });
                return { ...spec, action: "close", name };
            }
            if (inFree && kind === "actionButton" && /^(save|cancel)$/i.test(String(spec.action))) {
                const a = String(spec.action).toLowerCase();
                const name = spec.name !== undefined ? String(spec.name) : st.names.next("actionButton");
                const c = { ...spec, action: "close", name, caption: spec.caption !== undefined ? spec.caption : a === "save" ? "Save" : "Cancel", style: spec.style !== undefined ? spec.style : a === "save" ? "Success" : "Default" };
                delete c.closePage;
                st.markers.push({ kind: "button", name, action: a, closePage: spec.closePage, where: at });
                return c;
            }
            const configured = ["dataView", "listView", "dataGrid", "gallery", "templateGrid"].includes(kind);
            return kids(spec, configured, inFree && !configured);
        });
    }

    // The list that holds el, and its place in it.
    function holder(el) {
        const c = el.container;
        for (const p of c.allProperties()) {
            if (p.constructor.name !== "PartListProperty") continue;
            const l = p.get();
            const i = l.indexOf(el);
            if (i >= 0) return { list: l, i };
        }
        throw new Error(`internal: ${el.name} is in no widget list`);
    }

    function byName(doc, name) {
        let hit = null;
        doc.traverse(el => {
            if (!hit && el instanceof pages.Widget && el.name === name) hit = el;
        });
        if (!hit) throw new Error(`internal: stand-in ${name} is missing`);
        return hit;
    }

    // Replace the stand-ins of st.markers in doc by what they stand for.
    async function swap(doc, st, where) {
        const dir = client.project.dir;
        const look = async (w, spec, at) => {
            if (spec.class !== undefined) w.appearance.class = String(spec.class);
            if (spec.style !== undefined) w.appearance.style = String(spec.style);
            if (spec.design !== undefined) design.apply(sdk, model, w, design.resolve(dir, w, spec.design, `${at}: design`), client.warn);
        };
        for (const m of st.markers) {
            const old = byName(doc, m.name);
            if (m.kind === "dataView" || m.kind === "listView") {
                const { list, i } = holder(old);
                const w = (m.kind === "dataView" ? pages.DataView : pages.ListView).create(model);
                list.splice(i, 0, w);
                if (m.kind === "dataView") {
                    pages.DataViewSource.createInEntityWidgetUnderDataSource(w); // no entity: Studio Pro's unconfigured data view
                    const editable = bool(m.spec.editable, true);
                    if (!setIfAvailable(w, "editability", editable ? pages.EditableEnum.Always : pages.EditableEnum.Never)) setIfAvailable(w, "editable", editable);
                    I().dvSettings(w, m.spec, m.where);
                } else if (m.spec.pageSize !== undefined) {
                    const n = Number(m.spec.pageSize);
                    if (!Number.isInteger(n) || n < 1) throw new Error(`${m.where}: pageSize must be a whole number >= 1`);
                    w.pageSize = n;
                }
                for (const c of [...old.widgets]) {
                    if (m.kind === "dataView" && c.name === m.footer) {
                        for (const f of [...c.widgets]) {
                            f.detach();
                            w.footerWidgets.push(f);
                        }
                        continue;
                    }
                    c.detach();
                    w.widgets.push(c);
                }
                old.delete();
                w.name = m.name;
                await look(w, m.spec, m.where);
            } else if (m.kind === "input") {
                const { list, i } = holder(old);
                const w = pages[require("./ops-pages").INPUTS[m.input]].create(model);
                list.splice(i, 0, w);
                old.delete();
                w.name = m.name;
                await I().inputDefaults(w, m.input);
                await I().templateAll(w, "labelTemplate", m.label, null, m.where);
            } else if (m.kind === "button" && m.action === "none") pages.NoClientAction.createInActionButtonUnderAction(old);
            else if (m.kind === "button") {
                const cls = m.action === "save" ? pages.SaveChangesClientAction : pages.CancelChangesClientAction;
                cls.createInActionButtonUnderAction(old).closePage = bool(m.closePage, true);
            }
        }
        const left = [];
        doc.traverse(el => el instanceof pages.Widget && /^zzFooterStandIn\d+$/.test(el.name) && left.push(el.name));
        if (left.length) throw new Error(`${where}: internal: stand-ins left: ${left.join(", ")}`);
        const free = st.markers.filter(m => m.kind === "dataView" || m.kind === "listView").map(m => m.name);
        if (free.length) client.warnFirst(`${where}: unconfigured ${free.join(", ")} (no entity, as Studio Pro's own building blocks): set the entity where the ${st.what} is used`);
        return free;
    }

    // Widgets into a building block / page template (placeholder into), with unconfigured data widgets.
    async function fill(qn, widgets, into, st, where) {
        const specs = unbound(widgets, where, st, false, false);
        const text = await x.pageEdit.addWidgets({ page: qn, widgets: specs, ...(into ? { into } : {}), ...(st.entity ? { entity: st.entity } : {}) });
        const doc = await x.get(qn);
        const free = await swap(doc, st, where);
        return told(text.replace(/^[^:]*: /, "").replace(/ -> [^(]*$/, ""), st) + (free.length ? ` (unconfigured: ${free.join(", ")})` : "");
    }

    // the builders' summary with the stand-ins named as what they became
    function told(text, st) {
        let t = text.replace(/zzFooterStandIn\d+ \[([^\]]*)\]/g, "footer [$1]");
        for (const m of st.markers) if (m.kind === "button") t = t.replace(`${m.name} (close page)`, `${m.name} (${m.action === "none" ? "no action yet" : m.action})`);
        return t;
    }

    function newState(what, entity, taken) {
        return { what, entity, markers: [], names: I().names(taken) };
    }

    // ------------------------------------------------ building blocks

    async function createBuildingBlock(o) {
        validName(o.name, "building block name");
        const qn = `${o.module}.${o.name}`;
        const where = `createBuildingBlock ${qn}`;
        if (await x.exists(qn)) throw new Error(`${qn} already exists`);
        if (!Array.isArray(o.widgets) || !o.widgets.length) throw new Error(`${where}: widgets is a list [ { "widget": "<kind>", ... } ]`);
        if (o.entity !== undefined) await x.entity(String(o.entity));
        const bb = pages.BuildingBlock.createIn(x.folder(o.module, o.folder));
        bb.name = o.name;
        if (pages.SnippetType && bb.platform !== pages.SnippetType.Web) setIfAvailable(bb, "platform", pages.SnippetType.Web);
        try {
            const info = templateInfo(bb, o, where, true);
            const text = await fill(qn, o.widgets, null, newState("building block", o.entity, givenNames(o.widgets)), where);
            return `${qn} (${info.join(", ")}): ${text}`;
        } catch (e) {
            bb.delete();
            throw new Error(e.message.replace(/^addWidgets /, "createBuildingBlock "));
        }
    }

    async function changeBuildingBlock(o) {
        const doc = await x.get(String(o.document));
        if (!(doc instanceof pages.BuildingBlock) && !(doc instanceof pages.PageTemplate)) throw new Error(`changeBuildingBlock: '${o.document}' is a ${doc.structureTypeName.split("$")[1]}, not a building block or page template`);
        const what = Object.keys(TEMPLATE_INFO).filter(k => o[k] !== undefined);
        if (!what.length) throw new Error(`changeBuildingBlock ${o.document}: give what to change: ${Object.keys(TEMPLATE_INFO).join(", ")}`);
        if (doc.qualifiedName.split(".")[0] && model.allModules().find(m => m.name === doc.qualifiedName.split(".")[0] && m.fromAppStore)) throw new Error(`changeBuildingBlock: ${doc.qualifiedName} is in a Marketplace module (updates overwrite it); copy it into your own module first (copyDocument cannot copy building blocks: create one with createBuildingBlock and { "widget": "buildingBlock", "from": "${doc.qualifiedName}" })`);
        return `${doc.qualifiedName}: ${templateInfo(doc, o, `changeBuildingBlock ${doc.qualifiedName}`, false).join(", ") || "documentation"}`;
    }

    // ------------------------------------------------ page templates

    // The layout most of the project's pages use (with a Main placeholder if any).
    function usualLayout() {
        const count = new Map();
        for (const id of client.project.units.keys()) {
            const p = client.project.read(id);
            if (p.$Type === "Forms$Page" && p.FormCall && p.FormCall.Form) count.set(p.FormCall.Form, (count.get(p.FormCall.Form) || 0) + 1);
        }
        const web = new Set(model.allLayouts().map(l => l.qualifiedName));
        return [...count.entries()].filter(([l]) => web.has(l)).sort((a, b) => b[1] - a[1]).map(([l]) => l)[0] || null;
    }

    const TEMPLATE_TYPES = { regular: "RegularPageTemplateType", edit: "EditPageTemplateType", select: "SelectPageTemplateType", overview: "OverviewPageTemplateType" };

    async function createPageTemplate(o) {
        validName(o.name, "page template name");
        const qn = `${o.module}.${o.name}`;
        const where = `createPageTemplate ${qn}`;
        if (await x.exists(qn)) throw new Error(`${qn} already exists`);
        if (o.widgets !== undefined && o.placeholders !== undefined) throw new Error(`${where}: give widgets (the main placeholder) or placeholders { "Main": [...], ... }, not both`);
        const type = String(o.type === undefined ? "regular" : o.type).toLowerCase();
        const cls = TEMPLATE_TYPES[type] && pages[TEMPLATE_TYPES[type]];
        if (!TEMPLATE_TYPES[type]) fail(`${where}: type '${o.type}' is not known (use regular | edit | select | overview)`, String(o.type), Object.keys(TEMPLATE_TYPES));
        if (!cls) throw new Error(`${where}: template type ${type} does not exist in this Mendix version (${client.project.version}); use regular or edit`);
        const lq = o.layout !== undefined ? String(o.layout) : usualLayout();
        if (!lq) throw new Error(`${where}: this project has no page with a layout; give "layout": "Module.Layout"`);
        const layout = await x.get(lq).catch(e => fail(`${where}: layout '${lq}' not found`, lq, model.allLayouts().map(l => l.qualifiedName)));
        if (!(layout instanceof pages.Layout)) throw new Error(`${where}: '${lq}' is a ${layout.structureTypeName.split("$")[1]}, not a layout`);
        if (!(layout.content instanceof pages.WebLayoutContent)) throw new Error(`${where}: ${lq} is a native layout; page templates here are web templates`);
        const phs = [];
        layout.traverse(el => el instanceof pages.Placeholder && phs.push(el));
        if (!phs.length) throw new Error(`${where}: ${lq} has no placeholder`);
        let fills = {};
        if (o.placeholders !== undefined) {
            if (!o.placeholders || typeof o.placeholders !== "object" || Array.isArray(o.placeholders)) throw new Error(`${where}: placeholders is { "Main": [ widgets ], ... }`);
            for (const [k, v] of Object.entries(o.placeholders)) {
                if (!phs.some(p => p.name === k)) fail(`${where}: ${lq} has no placeholder '${k}' (placeholders: ${phs.map(p => p.name).join(", ")})`, k, phs.map(p => p.name));
                if (!Array.isArray(v)) throw new Error(`${where}: placeholders.${k} is a list of widgets`);
                fills[k] = v;
            }
        } else {
            const main = phs.find(p => p.name === "Main") || (phs.length === 1 ? phs[0] : null);
            if (!main) throw new Error(`${where}: ${lq} has placeholders ${phs.map(p => p.name).join(", ")} and none is Main; give "placeholders": { "<name>": [ widgets ] }`);
            fills = { [main.name]: o.widgets || [] };
        }
        if (o.entity !== undefined) await x.entity(String(o.entity));
        const pt = pages.PageTemplate.createIn(x.folder(o.module, o.folder));
        pt.name = o.name;
        try {
            const info = templateInfo(pt, o, where, true);
            cls.createIn(pt);
            if (!pt.appearance) pt.appearance = pages.Appearance.create(model);
            if (o.class !== undefined) pt.appearance.class = String(o.class);
            if (o.style !== undefined) pt.appearance.style = String(o.style);
            const call = pages.LayoutCall.createInPageTemplateUnderLayoutCall(pt);
            call.layout = layout;
            // one argument per placeholder that gets widgets (Main always, as Studio Pro's templates)
            const mainName = (phs.find(p => p.name === "Main") || phs[0]).name;
            for (const p of phs.filter(p => p.name === mainName || fills[p.name])) pages.LayoutCallArgument.createIn(call).parameter = p;
            const st = newState("page template", o.entity, givenNames(Object.values(fills)));
            const parts = [];
            for (const [ph, ws] of Object.entries(fills)) {
                if (!ws.length) continue;
                const specs = unbound(ws, `${where} ${ph}`, st, false, false);
                parts.push(`${ph}: ${(await x.pageEdit.addWidgets({ page: qn, into: ph, widgets: specs, ...(st.entity ? { entity: st.entity } : {}) })).replace(/^[^:]*: /, "").replace(/ -> [^(]*$/, "")}`);
            }
            const free = await swap(pt, st, where);
            return `${qn} (${type} template on ${lq}; ${info.join(", ")})${parts.length ? `: ${told(parts.join("; "), st)}` : ""}${free.length ? ` (unconfigured: ${free.join(", ")})` : ""}`;
        } catch (e) {
            pt.delete();
            throw new Error(e.message.replace(/^addWidgets /, "createPageTemplate "));
        }
    }

    // ------------------------------------------------ layouts from scratch (Atlas_Default / Atlas_TopBar / PopupLayout)

    const LAYOUT_FROM_ONLY = ["type", "preset", "placeholders", "header", "sidebar", "footer", "menu", "brand", "class"];
    const PRESETS = ["sidebar", "topbar", "blank"];

    // The menu source of a navigation tree / menu bar: a navigation profile (by name) or a menu document.
    async function menuSource(w, spec, where) {
        const v = String(spec);
        if (v.includes(".")) {
            const doc = await x.get(v).catch(() => fail(`${where}: menu '${v}' not found`, v, model.allMenuDocuments().map(m => m.qualifiedName)));
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

    async function createLayoutFresh(o) {
        validName(o.name, "layout name");
        const qn = `${o.module}.${o.name}`;
        const where = `createLayout ${qn}`;
        if (await x.exists(qn)) throw new Error(`${qn} already exists`);
        const types = Object.keys(pages.LayoutType).filter(k => pages.LayoutType[k] instanceof pages.LayoutType && k !== "Legacy");
        const type = o.type === undefined ? "Responsive" : types.find(t => t.toLowerCase() === String(o.type).toLowerCase()) || fail(`${where}: type '${o.type}' is not known (use ${types.join(" | ")})`, String(o.type), types);
        const popup = /popup/i.test(type);
        const preset = String(o.preset === undefined ? (popup || type === "Phone" ? "blank" : "sidebar") : o.preset).toLowerCase();
        if (!PRESETS.includes(preset)) fail(`${where}: preset '${o.preset}' is not known (use ${PRESETS.join(" | ")})`, String(o.preset), PRESETS);
        if (popup && preset !== "blank") throw new Error(`${where}: a ${type} layout has no side bar or top bar menu; use preset blank (header / footer widgets are fine)`);
        if (preset === "blank" && o.sidebar !== undefined) throw new Error(`${where}: preset blank has no side bar; use preset sidebar (or topbar) for sidebar widgets`);
        const names = o.placeholders === undefined ? ["Main"] : o.placeholders;
        if (!Array.isArray(names) || !names.length) throw new Error(`${where}: placeholders is a list of names, e.g. [ "Main", "Actions" ]`);
        for (const n of names) validName(n, "placeholder name");
        if (new Set(names).size !== names.length) throw new Error(`${where}: a placeholder name is given twice`);
        const menu = o.menu === undefined ? (preset === "blank" ? false : "Responsive") : o.menu;
        if (menu !== false && preset === "blank") throw new Error(`${where}: preset blank has no menu; use preset sidebar or topbar, or leave out menu`);
        for (const k of ["header", "sidebar", "footer"]) if (o[k] !== undefined && (!Array.isArray(o[k]) || !o[k].length)) throw new Error(`${where}: ${k} is a list of widgets [ { "widget": ... } ]`);
        const l = pages.Layout.createIn(x.folder(o.module, o.folder));
        l.name = o.name;
        try {
            l.canvasWidth = popup ? 800 : 1200;
            l.canvasHeight = 600;
            const content = pages.WebLayoutContent.createIn(l);
            content.layoutType = pages.LayoutType[type];
            if (!l.appearance) l.appearance = pages.Appearance.create(model);
            const cls = o.class !== undefined ? String(o.class) : preset === "sidebar" ? "layout-atlas layout-atlas-responsive-default" : preset === "topbar" ? "layout-atlas layout-atlas-responsive-topbar" : "";
            if (cls) l.appearance.class = cls;
            // the scroll container with its regions, as Atlas_Core's layouts
            const sc = pages.ScrollContainer.create(model);
            content.widgets.push(sc);
            sc.name = popup ? "scrollContainer1" : "layoutContainer";
            sc.scrollBehavior = pages.ScrollBehavior.PerRegion;
            sc.layoutMode = preset === "topbar" ? pages.LayoutModeType.Sidebar : pages.LayoutModeType.Headline;
            sc.alignment = pages.AlignmentEnum.Center;
            if (!sc.center) pages.ScrollContainerRegion.createInScrollContainerUnderCenter(sc);
            sc.center.appearance.class = "region-content";
            for (const n of names) {
                const ph = pages.Placeholder.create(model);
                sc.center.widgets.push(ph);
                ph.name = n;
            }
            const bits = [`${type}`, `preset ${preset}`, `placeholders ${names.join(", ")}`];
            const nav = async (cls2, region, wname) => {
                const w = cls2.create(model);
                region.widgets.push(w);
                w.name = wname;
                return menuSource(w, menu, where);
            };
            if (preset !== "blank") {
                const left = pages.ScrollContainerRegion.createInScrollContainerUnderLeft(sc);
                left.appearance.class = "region-sidebar";
                left.sizeMode = pages.SizeMode.Pixels;
                left.size = 232;
                left.toggleMode = preset === "sidebar" ? pages.ToggleMode.ShrinkContentInitiallyClosed : pages.ToggleMode.SlideOverContent;
                if (menu !== false) bits.push(`side bar ${await nav(pages.NavigationTree, left, "navigationTree1")}`);
            }
            const brand = o.brand !== undefined ? (o.brand === "" ? undefined : o.brand) : preset === "blank" ? undefined : o.module;
            const topWanted = preset !== "blank" || o.header !== undefined || brand !== undefined;
            let topRegion = null;
            if (topWanted) {
                topRegion = pages.ScrollContainerRegion.createInScrollContainerUnderTop(sc);
                topRegion.appearance.class = "region-topbar";
            }
            if (o.footer !== undefined) pages.ScrollContainerRegion.createInScrollContainerUnderBottom(sc).appearance.class = "region-footer";
            // top bar: a container "topbar-content" with the side bar toggle, the brand, the menu bar (topbar) and the header widgets
            if (topRegion) {
                const brandSpec = brand === undefined ? [] : /^\w+\.\w+\.\w+$/.test(String(brand)) ? [{ widget: "image", image: String(brand), name: "brandImage", class: "navbar-brand", alt: o.module }] : [{ widget: "text", text: String(brand), style: "H4", name: "brandText", class: "navbar-brand" }];
                await x.pageEdit.addWidgets({ page: qn, into: sc.name, slot: "top", widgets: [{ widget: "container", name: "topbarContent", class: "topbar-content", widgets: [...brandSpec, ...(o.header || [])] }] });
                const box = byName(l, "topbarContent");
                if (preset !== "blank") {
                    const t = pages.SidebarToggleButton.create(model);
                    box.widgets.splice(0, 0, t);
                    t.name = "sidebarToggle1";
                    t.appearance.class = "toggle-btn";
                    t.buttonStyle = pages.ButtonStyle.Primary;
                    if (!t.caption) t.caption = pages.ClientTemplate.create(model);
                    await I().textAll(t.caption.template, "", null);
                    await I().textAll(t.tooltip, "Toggle Menu", null);
                    const want = model.allCustomIconCollections && model.allCustomIconCollections().some(c => c.qualifiedName === "Atlas_Core.Atlas_Filled") ? "Atlas_Core.Atlas_Filled.navigation-menu" : "glyphicon-menu-hamburger";
                    const ic = await I().ui().iconOf(want, where).catch(() => I().ui().iconOf("glyphicon-menu-hamburger", where));
                    t.icon = ic.make();
                    bits.push(`top bar toggle (${ic.text})`);
                }
                if (preset === "topbar" && menu !== false) {
                    const mb = pages.MenuBar.create(model);
                    box.widgets.splice(brandSpec.length + 1, 0, mb);
                    mb.name = "menuBar1";
                    mb.appearance.class = "hidden-xs";
                    bits.push(`menu bar ${await menuSource(mb, menu, where)}`);
                }
                if (brandSpec.length) bits.push(`brand ${brandSpec[0].widget === "image" ? brandSpec[0].image : JSON.stringify(brandSpec[0].text)}`);
                if (o.header) bits.push(`header ${o.header.length} widget(s)`);
            }
            if (o.sidebar !== undefined) {
                await x.pageEdit.addWidgets({ page: qn, into: sc.name, slot: "left", widgets: o.sidebar });
                bits.push(`side bar ${o.sidebar.length} widget(s)`);
            }
            if (o.footer !== undefined) {
                await x.pageEdit.addWidgets({ page: qn, into: sc.name, slot: "bottom", widgets: [{ widget: "container", name: "footerContent", class: "footer-content", widgets: o.footer }] });
                bits.push(`footer ${o.footer.length} widget(s)`);
            }
            if (cls) bits.push(`class "${cls}"`);
            client.warnFirst(`${where}: a layout built by ops (as Atlas_Core's ${preset === "topbar" ? "Atlas_TopBar" : preset === "sidebar" ? "Atlas_Default" : "PopupLayout"}): open it in Studio Pro once and check the regions`);
            return `${qn} (${bits.join("; ")})`;
        } catch (e) {
            l.delete();
            throw new Error(e.message.replace(/^addWidgets [^:]*:/, `${where}:`));
        }
    }

    // ------------------------------------------------ applyStyle: one look on many widgets

    const STYLE_KINDS = {
        dataGrid2: el => el instanceof cw.CustomWidget && el.type && el.type.widgetId === "com.mendix.widget.web.datagrid.Datagrid",
        gallery: el => el instanceof cw.CustomWidget && el.type && el.type.widgetId === "com.mendix.widget.web.gallery.Gallery",
        dataGrid: el => el instanceof pages.DataGrid, listView: el => el instanceof pages.ListView, dataView: el => el instanceof pages.DataView,
        templateGrid: el => el instanceof pages.TemplateGrid, actionButton: el => el instanceof pages.ActionButton, container: el => el instanceof pages.DivContainer,
        text: el => el instanceof pages.DynamicText, layoutGrid: el => el instanceof pages.LayoutGrid, groupBox: el => el instanceof pages.GroupBox, tabContainer: el => el instanceof pages.TabContainer,
        textBox: el => el instanceof pages.TextBox, textArea: el => el instanceof pages.TextArea, datePicker: el => el instanceof pages.DatePicker, checkBox: el => el instanceof pages.CheckBox,
        radioButtons: el => el instanceof pages.RadioButtonGroup, referenceSelector: el => el instanceof pages.ReferenceSelector,
        input: el => el instanceof pages.InputWidget || (el instanceof cw.CustomWidget && el.type && /combobox/i.test(el.type.widgetId)),
        image: el => el instanceof pages.StaticImageViewer || el instanceof pages.DynamicImageViewer || (el instanceof cw.CustomWidget && el.type && /\.image\.Image$/.test(el.type.widgetId)),
        snippetCall: el => el instanceof pages.SnippetCallWidget, pluggable: el => el instanceof cw.CustomWidget,
        any: el => el instanceof pages.Widget && !(el instanceof pages.Placeholder)
    };
    const classList = v => String(v || "").split(/\s+/).filter(Boolean);
    const globRe = g => new RegExp(`^${String(g).split("*").map(p => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");

    // The documents of the scope (loaded): [{ doc, qn }]
    async function styleScope(o, where) {
        const own = model.allModules().filter(m => !m.fromAppStore).map(m => m.name);
        const all = [...model.allPages(), ...model.allSnippets(), ...model.allLayouts(), ...model.allBuildingBlocks(), ...model.allPageTemplates()];
        const store = m => model.allModules().some(x => x.name === m && x.fromAppStore);
        let units;
        if (o.page !== undefined) {
            if (o.module !== undefined || o.all !== undefined) throw new Error(`${where}: give page, or module (with folder), or all: true; not several`);
            units = [];
            for (const qn of [].concat(o.page)) {
                const u = all.find(d => d.qualifiedName === String(qn)) || fail(`${where}: no page, snippet, layout, building block or page template '${qn}'`, String(qn), all.map(d => d.qualifiedName));
                if (store(u.qualifiedName.split(".")[0])) throw new Error(`${where}: ${u.qualifiedName} is in a Marketplace module (an update overwrites it); style your own pages, or copy it first (copyDocument)`);
                units.push(u);
            }
        } else if (o.module !== undefined) {
            if (o.all !== undefined) throw new Error(`${where}: give module or all: true, not both`);
            const mods = [].concat(o.module).map(String);
            for (const m of mods) {
                if (!model.allModules().some(x => x.name === m)) fail(`${where}: no module '${m}'`, m, own);
                if (store(m)) throw new Error(`${where}: ${m} is a Marketplace module (an update overwrites it); style your own modules (${own.join(", ")}) and override Atlas classes in the theme instead`);
            }
            const fold = o.folder !== undefined ? String(o.folder).split(/[/\\]/).filter(Boolean).join("/") : null;
            const pathOf = d => {
                const p = [];
                for (let c = d.container; c && !(c instanceof sdk.projects.Module); c = c.container) p.unshift(c.name);
                return p.join("/");
            };
            units = all.filter(d => mods.includes(d.qualifiedName.split(".")[0]) && (!fold || pathOf(d) === fold || pathOf(d).startsWith(fold + "/")));
            if (fold && !units.length) throw new Error(`${where}: no page, snippet, layout or building block in ${mods.join(", ")} folder '${fold}'`);
        } else {
            if (o.folder !== undefined) throw new Error(`${where}: folder goes with module`);
            if (o.all !== true) throw new Error(`${where}: say where: "page": "Module.Page" (or a list), "module": "Module" (with "folder"), or "all": true for every page of your own modules (${own.join(", ")}); applyStyle never changes the whole app by accident`);
            units = all.filter(d => own.includes(d.qualifiedName.split(".")[0]));
        }
        const out = [];
        for (const u of units) {
            const doc = u.isLoaded ? u : await u.load();
            if (doc instanceof pages.Layout && !(doc.content instanceof pages.WebLayoutContent)) continue;
            if (doc instanceof pages.Page && doc.layoutCall && model.allLayouts().some(l => l.qualifiedName === doc.layoutCall.layoutQualifiedName && /^Native/.test(l.name))) continue;
            out.push({ doc, qn: doc.qualifiedName });
        }
        return out;
    }

    // The widgets the op picks: [{ qn, el }] (hasClass applied when withClass).
    async function styleTargets(o, where, withClass) {
        const kind = Object.keys(STYLE_KINDS).find(k => k.toLowerCase() === String(o.widget).toLowerCase()) || fail(`${where}: widget '${o.widget}' is not a kind applyStyle knows (use ${Object.keys(STYLE_KINDS).join(" | ")})`, String(o.widget), Object.keys(STYLE_KINDS));
        const docs = await styleScope(o, where);
        const re = o.match !== undefined ? globRe(o.match) : null;
        const out = [];
        for (const { doc, qn } of docs) {
            doc.traverse(el => {
                if (!(el instanceof pages.Widget) || !STYLE_KINDS[kind](el)) return;
                if (re && !re.test(el.name || "")) return;
                if (withClass && o.hasClass !== undefined && !classList(el.appearance && el.appearance.class).includes(String(o.hasClass))) return;
                out.push({ qn, el });
            });
        }
        return { kind, docs, out };
    }

    async function applyStyle(o) {
        const where = `applyStyle ${o.widget}`;
        const sets = ["class", "addClass", "removeClass", "design", "style", "buttonStyle"].filter(k => o[k] !== undefined);
        if (!sets.length) throw new Error(`${where}: give what to set: class, addClass, removeClass, design, style or buttonStyle`);
        if (o.class !== undefined && (o.addClass !== undefined || o.removeClass !== undefined)) throw new Error(`${where}: class replaces all classes; give class, or addClass / removeClass`);
        for (const k of ["class", "addClass", "removeClass", "hasClass"]) if (o[k] !== undefined && classList(o[k]).some(c => !/^-?[A-Za-z_][\w-]*$/.test(c))) throw new Error(`${where}: ${k} '${o[k]}' is not a CSS class list (letters, digits, - and _, separated by spaces)`);
        const limit = o.limit === undefined ? 200 : Number(o.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new Error(`${where}: limit is a whole number >= 1`);
        const { kind, docs, out } = await styleTargets(o, where, true);
        if (o.buttonStyle !== undefined && kind !== "actionButton") throw new Error(`${where}: buttonStyle is for "widget": "actionButton"`);
        const scopeText = o.page !== undefined ? [].concat(o.page).join(", ") : o.module !== undefined ? `${[].concat(o.module).join(", ")}${o.folder ? "/" + o.folder : ""}` : "all own modules";
        if (!out.length) throw new Error(`${where}: no ${kind} widget${o.match !== undefined ? ` named like '${o.match}'` : ""}${o.hasClass !== undefined ? ` with class '${o.hasClass}'` : ""} in ${scopeText} (${docs.length} document(s) searched; see: widgets Module.Page)`);
        if (out.length > limit) throw new Error(`${where}: ${out.length} widgets match (limit ${limit}); narrow it with page / module / folder / match / hasClass, or give "limit": ${out.length}`);
        const bs = o.buttonStyle !== undefined ? enumValue(pages.ButtonStyle, o.buttonStyle, "buttonStyle") : null;
        const dir = client.project.dir;
        const byDoc = new Map();
        for (const { qn, el } of out) {
            const at = `${where}: ${qn} ${el.name}`;
            const ap = el.appearance;
            if (!ap) throw new Error(`${at}: a ${el.structureTypeName.split("$")[1]} has no class or style`);
            const done = [];
            if (o.class !== undefined && ap.class !== String(o.class)) ap.class = String(o.class);
            if (o.addClass !== undefined || o.removeClass !== undefined) {
                const drop = classList(o.removeClass);
                const list = classList(ap.class).filter(c => !drop.includes(c));
                for (const c of classList(o.addClass)) if (!list.includes(c)) list.push(c);
                if (ap.class !== list.join(" ")) ap.class = list.join(" ");
            }
            if (o.style !== undefined && ap.style !== String(o.style)) ap.style = String(o.style);
            if (o.design !== undefined) done.push(design.apply(sdk, model, el, design.resolve(dir, el, o.design, `${at}: design`), client.warn) || "design unchanged");
            if (bs && el.buttonStyle !== bs) el.buttonStyle = bs;
            if (!byDoc.has(qn)) byDoc.set(qn, []);
            byDoc.get(qn).push(el.name || "?");
        }
        const what = [o.class !== undefined && `class "${o.class}"`, o.addClass !== undefined && `+${classList(o.addClass).join(" +")}`, o.removeClass !== undefined && `-${classList(o.removeClass).join(" -")}`,
            o.design !== undefined && `design ${Object.keys(o.design || {}).join(", ")}`, o.style !== undefined && `style "${o.style}"`, bs && `button style ${bs.name}`].filter(Boolean).join(", ");
        return `${out.length} ${kind} widget(s) in ${byDoc.size} document(s): ${what}` + [...byDoc.entries()].map(([qn, ns]) => `\n      ${qn}: ${ns.join(", ")}`).join("");
    }

    // ------------------------------------------------ component kits (ds-kit.js recipes)

    // { items: [{ recipe, name, ...options }], p (class prefix), P (name prefix) } with every field checked
    async function kitPlan(o, where) {
        const kit = require("./ds-kit");
        const P = kit.pascal(String(o.prefix)), p = kit.kebab(String(o.prefix));
        if (!/^[A-Za-z][A-Za-z0-9-_]*$/.test(String(o.prefix)) || !P) throw new Error(`${where}: prefix '${o.prefix}' must start with a letter (letters, digits, - and _), e.g. "acme"`);
        const raw = o.kit === undefined ? kit.DEFAULT_KIT : o.kit;
        if (!Array.isArray(raw) || !raw.length) throw new Error(`${where}: kit is a list of recipes [ ${Object.keys(kit.RECIPES).map(r => `"${r}"`).join(", ")} ]`);
        const names = Object.keys(kit.RECIPES);
        const items = raw.map((r, i) => {
            const at = `${where}: kit[${i + 1}]`;
            const it = typeof r === "string" ? { recipe: r } : r;
            if (!it || typeof it !== "object" || Array.isArray(it) || typeof it.recipe !== "string") throw new Error(`${at}: a recipe name ("card") or { "recipe": "card", ... }`);
            const recipe = names.find(n => n.toLowerCase() === it.recipe.toLowerCase()) || fail(`${at}: no recipe '${it.recipe}' (recipes: ${names.join(", ")})`, it.recipe, names);
            const allowed = ["recipe", "name", ...kit.RECIPES[recipe].options];
            for (const k of Object.keys(it)) if (!allowed.includes(k)) fail(`${at}: ${recipe} takes ${allowed.join(", ")}; not '${k}'`, k, allowed);
            const name = it.name !== undefined ? String(it.name) : `${P}_${recipe[0].toUpperCase()}${recipe.slice(1)}`;
            validName(name, "building block name");
            return { ...it, recipe, name, at };
        });
        const dup = items.map(i => i.name).find((n, i, a) => a.indexOf(n) !== i);
        if (dup) throw new Error(`${where}: two building blocks named ${dup}; give "name" to one`);
        return { kit, items, p, P };
    }

    async function kitEntity(qn, where) {
        const e = await x.entity(String(qn));
        const attrs = [];
        for (let c = e, i = 0; c && i < 10; i++) {
            for (const a of c.attributes) attrs.push({ name: a.name, type: a.type ? a.type.structureTypeName.split("$")[1].replace("AttributeType", "") : "?" });
            const g = c.generalization;
            c = g instanceof sdk.domainmodels.Generalization && g.generalization && g.generalization.isLoaded ? g.generalization : null;
        }
        if (!attrs.length) throw new Error(`${where}: ${qn} has no attributes to show`);
        return { qn: e.qualifiedName, name: e.name, attrs };
    }

    // The theme file the kit's SCSS goes to.
    function kitFile(o) {
        if (o.file !== undefined) return String(o.file);
        const fs = require("fs"), path = require("path");
        const own = model.allModules().find(m => m.name === o.module);
        const dir = path.join(client.project.dir, "themesource", String(o.module).toLowerCase(), "web");
        return own && !own.fromAppStore && fs.existsSync(dir) ? `themesource/${String(o.module).toLowerCase()}/web/main.scss` : "theme/web/main.scss";
    }

    async function createComponentKit(o) {
        const where = `createComponentKit ${o.prefix}`;
        x.folder(o.module, undefined); // the module exists ("did you mean")
        if (o.file !== undefined && o.withStyles !== true) throw new Error(`${where}: "file" goes with "withStyles": true`);
        const { kit, items, p, P } = await kitPlan(o, where);
        for (const it of items) if (await x.exists(`${o.module}.${it.name}`)) throw new Error(`${where}: ${o.module}.${it.name} already exists; give the kit another prefix, a "name" per item, or delete it first`);
        const dir = client.project.dir;
        const inst = require("./pluggable").installed(dir);
        const can = { grid2: inst.has("com.mendix.widget.web.datagrid.Datagrid"), gallery: inst.has("com.mendix.widget.web.gallery.Gallery") };
        const outs = [];
        const used = [];
        for (const it of items) {
            const entQn = it.entity !== undefined ? it.entity : kit.RECIPES[it.recipe].options.includes("entity") ? o.entity : undefined;
            if (kit.NEEDS_ENTITY.includes(it.recipe) && entQn === undefined) throw new Error(`${it.at}: the ${it.recipe} recipe needs an entity: { "recipe": "${it.recipe}", "entity": "Module.Entity" } or the kit's "entity"`);
            if (it.recipe === "gallery" && !can.gallery) throw new Error(`${it.at}: the gallery recipe needs the Gallery widget (widgets/com.mendix.widget.web.Gallery.mpk: Marketplace "Gallery" / Data Widgets); this project has none: use listCards`);
            const ent = entQn !== undefined ? await kitEntity(entQn, it.at) : null;
            const widgets = kit.build(it, p, ent, can);
            const text = await createBuildingBlock({ module: o.module, name: it.name, folder: o.folder !== undefined ? o.folder : "Kit", category: o.category !== undefined ? o.category : `${P} kit`, categoryWeight: (outs.length + 1) * 10, displayName: `${P} ${kit.kebab(it.recipe).replace(/-/g, " ")}`, widgets });
            outs.push(`${it.name} (${it.recipe}${ent ? ` of ${ent.name}` : ""}): ${[...kit.classesOf(widgets)].filter(c => c.startsWith(p + "-")).join(" ")}`);
            if (!used.includes(it.recipe)) used.push(it.recipe);
            void text;
        }
        let styles = "";
        if (o.withStyles === true) {
            const file = kitFile(o);
            const fs = require("fs"), path = require("path");
            const mod = /^themesource\/([^/]+)\//.exec(file.replace(/\\/g, "/"));
            if (mod) {
                const owner = model.allModules().find(m => m.name.toLowerCase() === mod[1].toLowerCase());
                if (owner && owner.fromAppStore) throw new Error(`${where}: ${file} belongs to the Marketplace module ${owner.name} (an update overwrites it); write the kit styles to your own module's themesource or theme/web/main.scss`);
            }
            const rel = file.replace(/\\/g, "/");
            const cur = require("./files").current(client, rel);
            const body = kit.scss(p, used);
            if (cur && cur.toString("utf8").includes(`/* ${p} component kit`)) throw new Error(`${where}: ${rel} already has the ${p} component kit styles; change them with editThemeFile edits (or use another prefix)`);
            styles = "\n      styles: " + (await x.themeOps.impl.editThemeFile(cur === null ? { path: rel, content: body.replace(/^\n/, "") } : { path: rel, append: body }));
            void fs; void path;
        } else styles = `\n      styles: none written; the classes need SCSS (withStyles: true, or the theme's component styles)`;
        return `${items.length} building block(s) in ${o.module}/${o.folder !== undefined ? o.folder : "Kit"}, category "${o.category !== undefined ? o.category : `${P} kit`}":` + outs.map(t => `\n      ${t}`).join("") + styles;
    }

    // ------------------------------------------------ style guide page

    async function createStyleGuide(o) {
        const name = o.name !== undefined ? String(o.name) : "StyleGuide";
        const where = `createStyleGuide ${o.module}.${name}`;
        const h2 = (t, n) => ({ widget: "text", text: t, style: "H2", name: n, class: "styleguide-section" });
        const row = (ws, cls) => ({ widget: "container", class: cls || "styleguide-row", widgets: ws });
        const notes = [];
        const widgets = [{ widget: "text", text: "Typography", style: "H2", class: "styleguide-section", name: "sgTypography" },
            ...["H1", "H2", "H3", "H4", "H5", "H6"].map(h => ({ widget: "text", text: `Heading ${h.slice(1)}`, style: h })),
            { widget: "text", text: "Paragraph: body text as it reads in a form or a card, with enough contrast on every surface.", style: "Paragraph" }, { widget: "text", text: "Small detail text", class: "text-detail" },
            h2("Buttons", "sgButtons"),
            row(["Default", "Primary", "Success", "Info", "Warning", "Danger", "Inverse"].map(st => ({ widget: "actionButton", action: "close", caption: st, style: st }))),
            row([{ widget: "actionButton", action: "close", caption: "Icon", style: "Primary", icon: "glyphicon-plus" }, { widget: "actionButton", action: "close", caption: "Link", renderType: "link" }])];
        const variables = [];
        const page = model.allPages()[0];
        if (page && "variables" in (await page.load())) {
            variables.push({ name: "SgText", type: "String", default: "''" }, { name: "SgFlag", type: "Boolean", default: "false" }, { name: "SgDate", type: "DateTime", default: "empty" });
            widgets.push(h2("Inputs", "sgInputs"), { widget: "layoutGrid", rows: [{ columns: [
                { weight: 6, tablet: 6, phone: 12, widgets: [{ widget: "textBox", variable: "SgText", label: "Text box", placeholder: "Type here" }, { widget: "datePicker", variable: "SgDate", label: "Date picker" }] },
                { weight: 6, tablet: 6, phone: 12, widgets: [{ widget: "checkBox", variable: "SgFlag", label: "Check box" }] }] }] });
        } else notes.push("inputs left out (page variables need Mendix 10)");
        widgets.push(h2("Cards", "sgCards"), { widget: "layoutGrid", rows: [{ columns: [1, 2, 3].map(n => ({ weight: 4, tablet: 6, phone: 12, widgets: [{ widget: "container", class: "card", widgets: [{ widget: "text", text: `Card ${n}`, style: "H4", class: "card-title" }, { widget: "text", text: "Card content on a raised surface." }] }] })) }] },
            h2("Alerts", "sgAlerts"), ...["success", "info", "warning", "danger"].map(a => ({ widget: "container", class: `alert alert-${a}`, widgets: [{ widget: "text", text: `${a[0].toUpperCase()}${a.slice(1)} message` }] })));
        const inst = require("./pluggable").installed(client.project.dir);
        if (inst.has("com.mendix.widget.custom.badge.Badge")) widgets.push(h2("Badges", "sgBadges"), row(["New", "Beta", "3"].map((t, i) => ({ widget: "badge", text: t, ...(i === 1 ? { type: "label" } : {}) }))));
        else notes.push("badges left out (no Badge widget in widgets/)");
        if (o.entity !== undefined) {
            const ent = await x.entity(String(o.entity));
            widgets.push(h2("Data grid", "sgGrid"), { widget: "dataGrid", kind: "auto", entity: ent.qualifiedName, rows: 5 }, h2("List view", "sgList"), { widget: "listView", entity: ent.qualifiedName, pageSize: 5 });
        } else notes.push("data grid and list view left out (give entity)");
        if (o.prefix !== undefined) {
            const P = require("./ds-kit").pascal(String(o.prefix));
            const bbs = model.allBuildingBlocks().filter(b => b.qualifiedName.startsWith(`${o.module}.${P}_`));
            if (!bbs.length) throw new Error(`${where}: no building block ${o.module}.${P}_* (make the kit first: createComponentKit with prefix "${o.prefix}")`);
            const shown = [], skipped = [];
            for (const b of bbs) {
                const d = await b.load();
                let open = false;
                d.traverse(el => {
                    const src = el instanceof pages.DataView || el instanceof pages.ListView ? el.dataSource : null;
                    if (src && !src.entityRef && !(src instanceof pages.ListenTargetSource)) open = true;
                });
                (open ? skipped : shown).push(d.qualifiedName);
            }
            if (shown.length) widgets.push(h2("Components", "sgComponents"), ...shown.map(q => ({ widget: "buildingBlock", from: q })));
            if (skipped.length) notes.push(`not shown (unconfigured data widgets would be errors on a page): ${skipped.join(", ")}`);
        }
        const text = await x.impl().createPage({ module: o.module, name, title: o.title !== undefined ? o.title : "Style guide", arrange: "rows", widgets, ...(variables.length ? { variables } : {}),
            ...Object.fromEntries(["folder", "layout", "menu", "roles"].filter(k => o[k] !== undefined).map(k => [k, o[k]])) });
        return text.split("\n")[0] + ` style guide: ${widgets.filter(w => w.class === "styleguide-section").map(w => w.text).join(", ")}` + notes.map(n => `\n      ${n}`).join("");
    }

    const checks = {
        async createStyleGuide(o) {
            const qn = `${o.module}.${o.name !== undefined ? o.name : "StyleGuide"}`;
            const p = await x.get(qn);
            let n = 0;
            p.traverse(el => el instanceof pages.DynamicText && el.appearance && el.appearance.class === "styleguide-section" && n++);
            return n >= 4 ? [] : [`${qn} has ${n} sections`];
        },
        async createComponentKit(o) {
            const { items, p } = await kitPlan(o, "check");
            const r = [];
            for (const it of items) if (!(await x.exists(`${o.module}.${it.name}`))) r.push(`${o.module}.${it.name} missing`);
            if (o.withStyles === true) {
                const b = require("./files").onDisk(client.project.dir, kitFile(o));
                if (!b || !b.toString("utf8").includes(`/* ${p} component kit`)) r.push(`${kitFile(o)} lacks the ${p} kit styles`);
            }
            return r;
        },
        async applyStyle(o) {
            const replaced = o.class !== undefined || classList(o.removeClass).includes(String(o.hasClass));
            const { out: all } = await styleTargets(o, "check", !replaced);
            // hasClass replaced away: the widgets it picked are the ones with the new state (at least one)
            const out = o.hasClass !== undefined && replaced ? all.filter(t => (o.class !== undefined ? t.el.appearance.class === String(o.class) : !classList(t.el.appearance.class).includes(String(o.hasClass)))) : all;
            if (!out.length) return [`no ${o.widget} widget has the new classes`];
            const r = [];
            for (const { qn, el } of out) {
                const cl = classList(el.appearance.class);
                const bad = (o.class !== undefined && el.appearance.class !== String(o.class)) || classList(o.addClass).some(c => !cl.includes(c)) || classList(o.removeClass).some(c => cl.includes(c)) || (o.style !== undefined && el.appearance.style !== String(o.style));
                if (bad) r.push(`${qn} ${el.name}: class "${el.appearance.class}" style "${el.appearance.style}"`);
            }
            return r.slice(0, 5);
        },
        async createBuildingBlock(o) {
            const qn = `${o.module}.${o.name}`;
            const bb = await x.get(qn);
            if (!(bb instanceof pages.BuildingBlock)) return [`${qn} is not a building block`];
            const r = [];
            if (!bb.widgets.length) r.push(`${qn} has no widgets`);
            if (o.category !== undefined && bb.templateCategory !== String(o.category)) r.push(`${qn} category is '${bb.templateCategory}'`);
            if (o.displayName !== undefined && bb.displayName !== String(o.displayName)) r.push(`${qn} display name is '${bb.displayName}'`);
            return r;
        },
        async changeBuildingBlock(o) {
            const d = await x.get(String(o.document));
            const r = [];
            if (o.category !== undefined && d.templateCategory !== String(o.category)) r.push(`${o.document} category is '${d.templateCategory}'`);
            if (o.displayName !== undefined && d.displayName !== String(o.displayName)) r.push(`${o.document} display name is '${d.displayName}'`);
            if (o.categoryWeight !== undefined && d.templateCategoryWeight !== Number(o.categoryWeight)) r.push(`${o.document} weight is ${d.templateCategoryWeight}`);
            return r;
        },
        async createPageTemplate(o) {
            const qn = `${o.module}.${o.name}`;
            const pt = await x.get(qn);
            if (!(pt instanceof pages.PageTemplate)) return [`${qn} is not a page template`];
            const r = [];
            if (!pt.layoutCall || !pt.layoutCall.layoutQualifiedName) r.push(`${qn} has no layout`);
            else if (o.layout !== undefined && pt.layoutCall.layoutQualifiedName !== String(o.layout)) r.push(`${qn} uses ${pt.layoutCall.layoutQualifiedName}`);
            if (!pt.templateType) r.push(`${qn} has no template type`);
            return r;
        }
    };

    return { impl: { createBuildingBlock, changeBuildingBlock, createPageTemplate, applyStyle, createComponentKit, createStyleGuide }, createLayoutFresh, LAYOUT_FROM_ONLY, checks, internals: { unbound, swap, fill, newState, givenNames, usualLayout, templateInfo } };
}

module.exports = { makeComposite, COMPOSITE_OPS, COMPOSITE_SYNONYMS };
