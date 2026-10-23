"use strict";
// Changing existing pages and snippets: add widgets (the createPage kinds) into a placeholder, container, data view
// (body or footer), list view, group box, tab page or layout grid column; change a widget's texts, editability,
// visibility, appearance, grid columns, XPath or name; delete or move a widget; and the widget tree (widgets command).
// New widgets are built by the createPage builders in the entity context of the data view or list view around them,
// with names Studio Pro would give. Only what an op touches changes: every other byte of the page stays as it was
// (selftest: add + change + delete on one of the project's own pages gives the page back byte for byte).
const sdk = require("mendixmodelsdk");
const { fail, bool, setIfAvailable, enumValue, validName } = require("./ops-util");
const design = require("./design");
const gridExtras = require("./grid-extras");
const { COLUMN_SETTINGS } = gridExtras;
const GALLERY = "com.mendix.widget.web.gallery.Gallery";
const ui = require("./ui");

const { pages, domainmodels: dm, customwidgets: cw, datatypes, texts } = sdk;

const PLACE = {
    into: "optional where: a container, data view, list view, group box or tab page name, a layout grid column \"layoutGrid1/row 1/column 2\", or the placeholder (\"Main\"). Default: the list of after/before, else the page's only placeholder (or the snippet)",
    slot: "optional footer: with a data view in into, its footer (default: its body); with a pluggable widget in into (Data grid 2, gallery, ...), its widget list: \"content\", \"emptyPlaceholder\", \"columns 2/content\" (see: widgets Module.Page)",
    after: "optional name of a widget in that list: right after it (default: at the end)",
    before: "optional name of a widget in that list: right before it"
};
const PAGE_EDIT_OPS = {
    addWidgets: {
        doc: "Add widgets to an existing page, snippet or layout (a layout's own header, sidebar, menu bar: page = Module.Layout): the createPage widget kinds (ops createPage), into a container, data view (body or footer), list view, group box, tab page, layout grid column or the placeholder. Inputs and {Attribute} texts use the entity of the data view or list view around them. Names and places: widgets Module.Page.",
        fields: { page: "R Module.Page, Module.Snippet or Module.Layout", ...PLACE, widgets: "R [ { \"widget\": \"<kind>\", ...fields } ] as in createPage; new names like Studio Pro (text3, actionButton2, ...)", entity: "optional default Module.Entity of new grids, list views and data views (default: the entity of the page's only object parameter)" }
    },
    changeWidget: {
        doc: "Change one widget of a page, snippet or layout (or a layout grid row / column: \"layoutGrid1/row 1\", \"layoutGrid1/row 1/column 2\"): caption, text, label, placeholder, editable, visible, class, style, text/button style, grid columns, XPath, name, a button's action, on click (Data grid 2, gallery, container), on change (inputs), dynamic class, icon, tooltip, accessibility (aria label, role, tab index, alt text), container render mode, row / column alignment. Give only what changes. Names: widgets Module.Page.",
        fields: {
            page: "R Module.Page or Module.Snippet", widget: "R widget name (see: widgets Module.Page)",
            caption: "button, tab page, group box, grid button or classic grid column caption; inside a data view or list view {Attribute} shows a value",
            text: "text of a text (or label) widget; {Attribute} shows a value inside a data view or list view",
            label: "label of an input (\"\" = no label)",
            placeholder: "placeholder of a text box, text area or date picker",
            editable: "true | false (input, data view or list view: an editable list); an input also takes an expression \"$currentObject/Open\" or { \"attribute\": \"Status\", \"values\": [\"Open\"] } (editable only then)",
            visible: "true (always) | false (never) | an expression \"$currentObject/Active\" | { \"attribute\": \"Active\" } (Boolean: visible when true) | { \"attribute\": \"Status\", \"values\": [\"Open\", \"Paid\"] }; the attribute is of the data view or list view around the widget; { \"roles\": [\"Module.Role\"] } only for users with one of these module roles",
            class: "CSS class(es); replaces the current ones (\"\" = none)",
            design: "Atlas design properties of the theme: { \"Spacing\": { \"margin-top\": \"M\" }, \"Spacing top\": \"Large\", \"Full width\": true, \"Style\": \"Primary\" }; given keys change, null / false removes one, others stay",
            style: "inline CSS, e.g. \"font-weight: bold;\" (\"\" = none)",
            textStyle: "Text | Paragraph | H1 | H2 | H3 | H4 | H5 | H6 (a text)",
            buttonStyle: "Default | Primary | Success | Info | Warning | Danger | Inverse (a button)",
            columns: "{ \"add\": [ \"Attr\" or { \"attribute\": ..., \"caption\": ..., \"width\": 20 } (Data grid 2 also { \"type\": \"dynamicText\", \"text\": \"{1} - {2}\", \"params\": [\"Number\", \"Note\"] } and { \"type\": \"customContent\", \"widgets\": [...] }) ], \"remove\": [ \"Attr\" or a column caption ], \"change\": [ { \"column\": \"Attr\" or a caption, ...settings } ], \"move\": [ { \"column\": \"Note\", \"before\": \"Number\" } | { \"column\": ..., \"after\": ... } | { \"column\": ..., \"position\": 1 } ] } of a classic data grid or Data grid 2 (a gallery: { \"desktop\": 3, \"tablet\": 2, \"phone\": 1 }); added at the end. Classic: width (a weight), class; Data grid 2: the column settings of createPage dataGrid (width autoFill | autoFit | manual or a number, size, minWidth, alignment, hidable, resizable, draggable, sortable, visible, tooltip, wrapText, class, columnClass, rowEvents, exportValue, exportType, exportNumberFormat, exportDateFormat), caption (on change) and \"filter\" (on add, and on change when the column has none)",
            headerFilters: "Data grid 2 / gallery: filters to add above it, as createPage dataGrid headerFilters",
            paging: "Data grid 2 / gallery: \"buttons\" | \"virtualScrolling\" | \"loadMore\" or { \"mode\", \"pageSize\", \"showButtons\": \"always\" | \"auto\", \"position\": \"bottom\" | \"top\" | \"both\", \"showTotal\", \"loadMoreCaption\", \"pageSizeAttribute\" }; list view / classic grid: { \"pageSize\": 20 }",
            selection: "Data grid 2 / gallery: Single | Multi | None; classic data grid / template grid: None | Single | SingleAndMaintain | Multi | SimpleMulti",
            emptyMessage: "Data grid 2 / gallery: text shown when there are no rows (\"\" = none)",
            onClickTrigger: "Data grid 2 / gallery: single | double",
            sort: "sort order of a database source (grid, list view, Data grid 2, gallery): [ \"Attr\" | { \"attribute\": \"Name\", \"direction\": \"desc\" } ] (replaces it; [] = none)",
            template: "list view, gallery or template grid: the new item widgets [ widgets ] (replace the old ones; inputs make an editable list)",
            source: "data source of a grid, list view, Data grid 2, gallery or template grid: { \"source\": \"database\" | \"microflow\" | \"nanoflow\" | \"association\", \"entity\", \"xpath\", \"microflow\", \"nanoflow\", \"association\", \"params\" }; columns and item widgets stay when the entity stays (or is a specialization); another entity is refused while widgets use the old one",
            export: "Data grid 2: true or { \"caption\", \"fileName\", \"sheetName\", \"headers\" }: an Export to Excel button in its header and a new nanoflow (as createPage dataGrid export)",
            xpath: "XPath constraint of a grid, list view or Data grid 2 with a database source, e.g. [Active = true()] (\"\" = all objects)",
            name: "new name; data views listening to it follow",
            action: "a button's action (also a classic grid button): { \"action\": \"showPage\" | \"callMicroflow\" | \"callNanoflow\" | \"save\" | \"cancel\" | \"close\" | \"delete\", \"page\" / \"microflow\" / \"nanoflow\", \"params\" } (replaces the old one)",
            onClick: "on click of a Data grid 2, gallery or list view: an action as in \"action\" (the row / item is passed)",
            onChange: "on change of an input, reference (set) selector or combo box: an action as in \"action\" (the object around it is passed)",
            onEnter: "input: action when it gets the focus", onLeave: "input: action when it loses the focus", onEnterKeyPress: "text box: action on the Enter key",
            required: "input / reference selector: true (validation Required, $value != empty) | false (no validation)", requiredMessage: "with required true: the message",
            validation: "input: { \"expression\": \"$value > 0\", \"message\": \"...\" } (custom validation)",
            format: "text box, date picker or classic grid column: { \"decimals\": 2, \"groupDigits\": true } | { \"date\": \"date\" | \"time\" | \"dateTime\" | \"dd-MM-yyyy\" }",
            readOnlyStyle: "input: inherit | control | text; data view: control | text", inputMask: "text box: a mask, e.g. \"99-99-9999\"", maxLength: "text box / text area: \"attribute\" | \"unlimited\" | a number",
            orientation: "data view: horizontal | vertical; simple menu bar: horizontal | vertical", labelWidth: "data view: label width 1-11 (horizontal form)", showFooter: "data view: true/false",
            selectPage: "reference (set) selector: Module.Page that lists the objects to pick (Studio Pro: Select using Page)",
            ...ui.CHANGE_UI,
            ...require("./widget-edit").WIDGET_CHANGE
        }
    },
    changePage: {
        doc: "Change page settings: title, URL, pop-up size, class / style, layout, and its parameters (add / remove / rename). A parameter change that would break a caller (button, menu item, microflow that opens the page) is refused with the callers listed; remove deletes callers' mappings of it, rename keeps them.",
        fields: {
            page: "R Module.Page",
            title: "optional page title",
            url: "optional page URL, e.g. \"orders\" or \"order/{Order/Id}\" (\"\" = none); unique in the app",
            popupWidth: "optional pop-up width in pixels (0 = auto)", popupHeight: "optional pop-up height in pixels (0 = auto)", popupResizable: "optional true/false",
            addParameter: "optional { \"name\": \"Order\", \"type\": \"Module.Entity\", \"required\": true } (refused while something opens the page, unless required false on Mendix 11.5+)",
            removeParameter: "optional parameter name (refused while a widget of the page uses it; callers' mappings of it are removed)",
            renameParameter: "optional { \"from\": \"Order\", \"to\": \"SalesOrder\" } (widgets and callers follow)",
            variables: "optional page variables to add (or change: same name): [ { \"name\": \"Search\", \"type\": \"String\", \"default\": \"''\" } ] (Mendix 10+; see createPage)",
            design: "optional design properties of the page, e.g. { \"Form orientation\": \"Horizontal\" } (where the theme has them for pages)",
            class: "optional CSS class(es) of the page (\"\" = none)", style: "optional inline CSS of the page (\"\" = none)",
            layout: "optional Module.Layout: switch the page to another layout; its content moves to the placeholders of the same name (refused, with the list, when a placeholder with content has no counterpart)"
        }
    },
    deleteWidget: {
        doc: "Delete a widget and everything inside it from a page, snippet or layout (also a classic grid column, grid button or tab page). Refuses while a data view listens to it, the page's placeholder, and a layout placeholder that pages fill.",
        fields: { page: "R Module.Page or Module.Snippet", widget: "R widget name (see: widgets Module.Page)" }
    },
    moveWidget: {
        doc: "Move a widget with its contents to another place on the same page, snippet or layout (into / after / before as in addWidgets), e.g. a button into the data view footer. Widgets that show attributes stay inside the same data view or list view.",
        fields: { page: "R Module.Page or Module.Snippet", widget: "R widget name", ...PLACE }
    }
};
const INPUT_FIELDS = ["required", "requiredMessage", "validation", "format", "readOnlyStyle", "inputMask", "maxLength"];
const LIST_FIELDS = ["source", "paging", "selection", "emptyMessage", "onClickTrigger", "sort", "template", "export"];
const CHANGE_FIELDS = ["caption", "text", "label", "placeholder", "editable", "visible", "class", "design", "style", "textStyle", "buttonStyle", ...LIST_FIELDS.slice(0, 1), "columns", "headerFilters", ...LIST_FIELDS.slice(1), "xpath", "name", "action", "onClick", "onChange",
    "onEnter", "onLeave", "onEnterKeyPress", ...INPUT_FIELDS, "orientation", "labelWidth", "showFooter", "selectPage", ...Object.keys(ui.CHANGE_UI), ...Object.keys(require("./widget-edit").WIDGET_CHANGE)];
const UI_FIELDS = Object.keys(ui.CHANGE_UI);
// fields a weak model takes from elsewhere -> what to write instead (checked before the generic "unknown field")
const FIELD_SYNONYMS = {
    addWidgets: { in: "use \"into\"", inside: "use \"into\"", target: "use \"into\"", container: "use \"into\"", parent: "use \"into\"", widget: "use \"widgets\": [ { \"widget\": ... } ] (a list)", footer: "use \"into\": \"<data view>\", \"slot\": \"footer\"", position: "use \"after\" or \"before\" (a widget name)" },
    moveWidget: { to: "use \"into\" (and \"after\"/\"before\")", target: "use \"into\"", in: "use \"into\"", footer: "use \"into\": \"<data view>\", \"slot\": \"footer\"" },
    deleteWidget: { widgets: "one widget per deleteWidget op: \"widget\": \"<name>\"", name: "use \"widget\"" },
    changeWidget: {
        readOnly: "use \"editable\": false", readonly: "use \"editable\": false", hidden: "use \"visible\": false (or a condition)", hide: "use \"visible\": false", visibility: "use \"visible\"",
        title: "use \"caption\" (button, tab page, column), \"text\" (a text) or \"tooltip\" (a button)", helpText: ui.INPUT_TOOLTIP, hint: ui.INPUT_TOOLTIP, ariaDescription: "use \"ariaLabel\" (inputs) or \"tooltip\" (buttons)", alternativeText: "use \"alt\"", offset: ui.NOT_STORED.offset, order: ui.NOT_STORED.order, header: "use \"caption\"", value: "use \"text\"", content: "use \"text\"", cssClass: "use \"class\"", className: "use \"class\"",
        newName: "use \"name\"", rename: "use \"name\"", addColumns: "use \"columns\": { \"add\": [...] }", removeColumns: "use \"columns\": { \"remove\": [...] }", column: "use \"columns\": { \"add\": [...], \"remove\": [...] }",
        heading: "use \"textStyle\": \"H2\"", pageSize: "use \"paging\": { \"pageSize\": 20 }", rows: "use \"paging\": { \"pageSize\": 20 }", pagination: "use \"paging\"", dataSource: "use \"source\"", datasource: "use \"source\"",
        items: "use \"template\" (item widgets) or \"columns\" (gallery devices)", content: "use \"template\" (list view / gallery) or \"text\"", widgets: "use \"template\" (list view / gallery items) or addWidgets", sortOrder: "use \"sort\"", moveColumn: "use \"columns\": { \"move\": [ { \"column\": ..., \"before\": ... } ] }", color: "use \"buttonStyle\" (a button) or \"style\" (CSS)", into: "moving is moveWidget", after: "moving is moveWidget", before: "moving is moveWidget"
    }
};

// widget kinds as the widgets listing names them
const KIND_NAMES = [["DataView", "data view"], ["ListView", "list view"], ["DataGrid", "data grid (classic)"], ["TemplateGrid", "template grid"],
    ["LayoutGrid", "layout grid"], ["DivContainer", "container"], ["GroupBox", "group box"], ["TabContainer", "tab container"], ["TabPage", "tab page"],
    ["ScrollContainer", "scroll container"], ["DynamicText", "text"], ["Label", "label"], ["Title", "page title"], ["ActionButton", "button"],
    ["DropDownButton", "drop-down button"], ["LinkButton", "link button"], ["TextBox", "text box"], ["TextArea", "text area"], ["CheckBox", "check box"],
    ["DatePicker", "date picker"], ["RadioButtonGroup", "radio buttons"], ["DropDown", "drop-down"], ["ReferenceSelector", "reference selector"],
    ["InputReferenceSetSelector", "reference set selector"], ["ReferenceSetSelector", "reference set selector"], ["SnippetCallWidget", "snippet call"],
    ["StaticImageViewer", "image"], ["DynamicImageViewer", "dynamic image"], ["ImageUploader", "image uploader"], ["FileManager", "file manager"],
    ["Table", "table"], ["NavigationList", "navigation list"], ["NavigationTree", "navigation tree"], ["MenuBar", "menu bar"], ["SimpleMenuBar", "menu bar"],
    ["GridColumn", "column"], ["SearchField", "search field"], ["ControlBarItem", "grid button"], ["Placeholder", "placeholder"]]
    .filter(([c]) => pages[c]).map(([c, n]) => [pages[c], n]);
const ADDRESSABLE = [pages.Widget, pages.LayoutCallArgument, pages.LayoutGridColumn, pages.TabPage, pages.GridColumn, pages.ControlBarItem, pages.SearchField].filter(Boolean);
// never hold widgets: skipped while walking (a pluggable widget's type alone has hundreds of elements)
const NO_WIDGETS = [cw.CustomWidgetType, texts.Text, pages.ClientTemplate, pages.Appearance, pages.ConditionalSettings, dm.MemberRef, dm.EntityRef].filter(Boolean);
// a data container with one of these sources shows its own objects, whatever is around it
const CONTEXT_FREE = ["ListenTargetSource", "GridXPathSource", "ListViewXPathSource", "CustomWidgetXPathSource"];

// friendly names of pluggable widgets ops makes
const PLUGGABLE_NAMES = { "com.mendix.widget.web.combobox.Combobox": "combo box", "com.mendix.widget.web.gallery.Gallery": "gallery" };
const short = s => (s.length > 60 ? s.slice(0, 57) + "..." : s);
// "Assoc/Attribute" of an AttributeRef (the association names of its steps, then the attribute)
const pathText = ref => [...(ref.entityRef && ref.entityRef.steps ? ref.entityRef.steps.map(st => st.associationQualifiedName.split(".").pop()) : []), ref.attributeQualifiedName.split(".").pop()].join("/");
// the data source of a pluggable widget (Data grid 2, gallery, ...), or null
function cwSource(el) {
    for (const p of el.object ? el.object.properties : []) if (p.value && p.value.dataSource) return p.value.dataSource;
    return null;
}
const isDataContainer = el => el instanceof pages.DataView || el instanceof pages.ListView || el instanceof pages.TemplateGrid || (el instanceof cw.CustomWidget && !!cwSource(el));
const sysProps = w => (w.type && w.type.objectType ? w.type.objectType.propertyTypes.filter(pt => pt.valueType && pt.valueType.type === cw.WidgetValueTypeEnum.System).map(pt => pt.key) : []);
const prop = (o, k) => {
    try {
        return o[k];
    } catch (e) {
        return undefined; // not in this Mendix version
    }
};

function makePageEdit(h, I) {
    const { model, client } = h;

    // ------------------------------------------------ the widget tree of a page or snippet

    // Part children of an element: [{ prop, el }].
    function parts(el) {
        const out = [];
        for (const p of el.allProperties()) {
            const t = p.constructor.name;
            if (t !== "PartListProperty" && t !== "PartProperty") continue;
            let v;
            try {
                v = p.get();
            } catch (e) {
                continue;
            }
            if (t === "PartProperty") {
                if (v) out.push({ prop: p.name, el: v });
            } else for (const c of v) out.push({ prop: p.name, el: c });
        }
        return out;
    }

    // node: { el, name, label, parent, holder (element whose list holds el), prop, children, ctx (data container node above) }
    function buildTree(doc) {
        const nodes = [], byName = new Map(), byPath = new Map(), names = [];
        const visit = (el, parent, holder, propName) => {
            if (NO_WIDGETS.some(c => el instanceof c)) return;
            let node = parent;
            if (el !== doc && ADDRESSABLE.some(c => el instanceof c)) {
                node = { el, parent, holder, prop: propName, children: [], name: null, label: null };
                if (el instanceof pages.LayoutCallArgument) {
                    node.label = String(el.parameterQualifiedName || "").split(".").pop() || "Main";
                    node.placeholder = true;
                } else if (el instanceof pages.LayoutGridColumn) {
                    const row = el.container, grid = row.container;
                    node.label = `${grid.name}/row ${grid.rows.indexOf(row) + 1}/column ${row.columns.indexOf(el) + 1}`;
                    byPath.set(node.label.toLowerCase(), node);
                } else {
                    node.name = node.label = prop(el, "name") || null;
                    if (node.name && !byName.has(node.name)) byName.set(node.name, node);
                }
                if (parent) parent.children.push(node);
                nodes.push(node);
            }
            const n = prop(el, "name");
            if (typeof n === "string" && n && el !== doc) names.push(n);
            for (const c of parts(el)) visit(c.el, node, el, c.prop);
        };
        const root = { el: doc, children: [], name: null, label: doc.name, root: true };
        visit(doc, root, null, null);
        for (const n of nodes) {
            let p = n.parent;
            while (p && !p.root && !isDataContainer(p.el)) p = p.parent;
            n.ctx = p && !p.root ? p : null;
        }
        return { root, nodes, byName, byPath, names };
    }

    // Kind of a node as the listing shows it.
    function kindOf(el) {
        if (el instanceof cw.CustomWidget) {
            const id = el.type ? el.type.widgetId : "";
            return I.isGrid2(el) ? "Data grid 2" : PLUGGABLE_NAMES[id] || `pluggable widget ${id.split(".").pop() || "?"}`;
        }
        if (el instanceof pages.LayoutCallArgument) return "placeholder";
        const hit = KIND_NAMES.find(([c]) => el instanceof c);
        return hit ? hit[1] : el.structureTypeName.split("$")[1];
    }

    // A page, snippet, layout, building block or page template, loaded, with its tree. Other documents are refused.
    async function open(qn, where) {
        const doc = await h.get(qn);
        if (!(doc instanceof pages.Page) && !(doc instanceof pages.Snippet) && !(doc instanceof pages.Layout) && !(doc instanceof pages.BuildingBlock) && !(doc instanceof pages.PageTemplate)) throw new Error(`${where}: '${qn}' is a ${doc.structureTypeName.split("$")[1]}, not a page, snippet, layout, building block or page template`);
        if (doc instanceof pages.Layout && !(doc.content instanceof pages.WebLayoutContent)) throw new Error(`${where}: '${qn}' is a native layout; change it in Studio Pro`);
        if (doc instanceof pages.BuildingBlock && doc.platform && doc.platform.name === "Native") throw new Error(`${where}: '${qn}' is a native building block; change it in Studio Pro`);
        // block: a building block holds its widgets itself (as a snippet); template: a page template fills placeholders (as a page)
        const P = { doc, qn: doc.qualifiedName, snippet: doc instanceof pages.Snippet, layout: doc instanceof pages.Layout, block: doc instanceof pages.BuildingBlock, template: doc instanceof pages.PageTemplate, ...buildTree(doc) };
        P.where = where;
        return P;
    }

    const allNames = P => [...P.byName.keys()];
    const placeholders = P => P.nodes.filter(n => n.placeholder);

    // The node of a widget name (with "did you mean"); the placeholder only when allowed.
    function find(P, name, where, { placeholder = false } = {}) {
        const s = String(name);
        const node = P.byName.get(s);
        if (node) return node;
        const ph = placeholders(P).find(n => n.label === s);
        if (ph) {
            if (placeholder) return ph;
            throw new Error(`${where}: '${s}' is the layout placeholder (the page's content area), not a widget; name a widget in it (see: widgets ${P.qn})`);
        }
        if (P.byPath.has(s.toLowerCase().replace(/\s*\/\s*/g, "/"))) throw new Error(`${where}: '${s}' is a layout grid column, not a widget; use it in "into"`);
        const all = allNames(P);
        const list = all.length <= 40 ? `widgets here: ${all.join(", ") || "none"}` : `${all.length} widgets; all names: widgets ${P.qn}`;
        return fail(`${where}: no widget '${s}' on ${P.qn} (${list})`, s, all);
    }

    // ------------------------------------------------ entity context

    function refEntity(ref) {
        if (!ref) return null;
        if (ref instanceof dm.DirectEntityRef) return ref.entityQualifiedName;
        if (ref instanceof dm.IndirectEntityRef && ref.steps.length) return ref.steps[ref.steps.length - 1].destinationEntityQualifiedName;
        return null;
    }

    async function flowEntity(flow) {
        if (!flow) return null;
        let f = flow;
        let t = prop(f, "microflowReturnType");
        if (t === undefined) t = prop((f = await flow.load()), "microflowReturnType");
        return t instanceof datatypes.ObjectType || t instanceof datatypes.ListType ? t.entityQualifiedName : null;
    }

    // Qualified name of the entity a data container shows, or null with why.
    async function containerEntity(P, node, seen = new Set()) {
        const el = node.el;
        if (seen.has(el)) return { qn: null, why: "the listen targets go round in a circle" };
        seen.add(el);
        const src = el instanceof cw.CustomWidget ? cwSource(el) : prop(el, "dataSource");
        if (!src) return { qn: null, why: `${node.name} has no data source` };
        if (src instanceof pages.ListenTargetSource) {
            const t = P.byName.get(src.listenTarget);
            return t ? containerEntity(P, t, seen) : { qn: null, why: `${node.name} listens to '${src.listenTarget}', which is not on the page` };
        }
        if (src instanceof pages.MicroflowSource) return { qn: await flowEntity(src.microflowSettings && src.microflowSettings.microflow), why: "microflow source" };
        if (src instanceof pages.NanoflowSource) return { qn: await flowEntity(src.nanoflowSettings ? src.nanoflowSettings.nanoflow : prop(src, "nanoflow")), why: "nanoflow source" };
        const fromRef = refEntity(prop(src, "entityRef"));
        if (fromRef) return { qn: fromRef, why: "" };
        const sv = prop(src, "sourceVariable");
        const param = sv && (sv.pageParameter || sv.snippetParameter);
        if (param && param.parameterType instanceof datatypes.ObjectType) return { qn: param.parameterType.entityQualifiedName, why: "" };
        return { qn: null, why: `the source of ${node.name} is a ${src.structureTypeName.split("$")[1]}` };
    }

    // The data container node as the createPage builders take it ({ kind, ent, source, ... }), or null.
    async function builderContext(P, dc, where) {
        if (!dc) return null;
        const el = dc.el;
        const { qn, why } = await containerEntity(P, dc);
        if (!qn) throw new Error(`${where}: the entity of ${dc.name} is not known here (${why}); add widgets that show its attributes in Studio Pro`);
        const ent = await I.entityOf(qn, where).catch(() => {
            throw new Error(`${where}: ${dc.name} shows ${qn}, which ops cannot read (System module); add widgets that show its attributes in Studio Pro`);
        });
        // the data containers around it too (objects a new widget can use; a list item around it)
        const container = dc.ctx ? await builderContext(P, dc.ctx, where).catch(() => null) : null;
        if (el instanceof pages.DataView) {
            const kind = I.sourceKind(el);
            const source = ["listen", "parameter", "context", "association"].includes(kind) ? kind : "other";
            return { kind: "dataView", ent, source, widget: el, name: el.name, existing: true, container, inputVariable: inputStyle(P, dc) };
        }
        if (el instanceof pages.ListView) return { kind: "listView", ent, widget: el, name: el.name, existing: true, container };
        return { kind: el instanceof cw.CustomWidget ? "pluggable" : "templateGrid", ent, widget: el, name: el.name, existing: true, container };
    }

    // How a new input in an existing data view refers to the object: like the inputs already in it (a page variable
    // naming the parameter and the data view, or none); without any, as createPage does (the parameter, if any).
    function inputStyle(P, dvNode) {
        const sibs = [];
        const walk = n => {
            for (const c of n.children) {
                if (isDataContainer(c.el)) continue;
                if (c.el instanceof pages.AttributeWidget) sibs.push(c.el);
                walk(c);
            }
        };
        walk(dvNode);
        const sv = (sibs.find(s => s.sourceVariable) || {}).sourceVariable;
        const src = dvNode.el.dataSource;
        const own = !sibs.length && src instanceof pages.DataViewSource && src.sourceVariable && src.sourceVariable.pageParameter ? { pageParameter: src.sourceVariable.pageParameter, widget: dvNode.el }
            : !sibs.length && src instanceof pages.DataViewSource && src.sourceVariable && src.sourceVariable.snippetParameter ? { snippetParameter: src.sourceVariable.snippetParameter, widget: dvNode.el } : null;
        const like = sv || own;
        return w => {
            if (!like) return;
            let v = null;
            if (w instanceof pages.AttributeWidget) v = pages.PageVariable.createInAttributeWidgetUnderSourceVariable(w);
            else w.sourceVariable = v = pages.PageVariable.create(model);
            for (const k of ["pageParameter", "snippetParameter", "localVariable", "widget"]) if (like[k]) v[k] = like[k];
            if (like.useAllPages) v.useAllPages = true;
        };
    }

    // ------------------------------------------------ where widgets go

    // { list, holder, prop, label, node (container node or null), dc (data container node or null) }
    function slotOf(P, list, holderNode, label) {
        const dc = holderNode && !holderNode.root && isDataContainer(holderNode.el) ? holderNode : holderNode ? holderNode.ctx || null : null;
        return { list, label, node: holderNode, dc };
    }

    function parsePath(s) {
        const m = /^([A-Za-z_]\w*)\s*(?:\/|\s)\s*(?:row\s*)?(\d+)\s*(?:\/|\s)\s*(?:col(?:umn)?\s*)?(\d+)$/i.exec(s.trim()) ||
            /^([A-Za-z_]\w*)\s*(?:\/|\s)\s*col(?:umn)?\s*(\d+)$/i.exec(s.trim());
        if (!m) return null;
        return m.length === 4 ? { grid: m[1], row: Number(m[2]), col: Number(m[3]) } : { grid: m[1], row: 1, col: Number(m[2]) };
    }

    const columnPaths = (gridNode) => gridNode.children.filter(c => c.el instanceof pages.LayoutGridColumn).map(c => c.label);

    function container(P, into, slot, where) {
        const s = String(into).trim();
        const path = parsePath(s);
        if (path) {
            const g = P.byName.get(path.grid);
            if (!g || !(g.el instanceof pages.LayoutGrid)) fail(`${where}: into '${s}': no layout grid '${path.grid}' on ${P.qn}`, path.grid, P.nodes.filter(n => n.el instanceof pages.LayoutGrid).map(n => n.name));
            const row = path.row <= g.el.rows.length ? g.el.rows[path.row - 1] : null;
            const col = row && path.col <= row.columns.length ? row.columns[path.col - 1] : null;
            if (!col) throw new Error(`${where}: ${path.grid} has no row ${path.row} column ${path.col}; columns: ${columnPaths(g).join(", ")}`);
            const node = P.nodes.find(n => n.el === col);
            return checkSlot(slotOf(P, col.widgets, node, node.label), slot, where);
        }
        // a navigation list item: "navigationList1/item 2"
        const item = /^([A-Za-z_]\w*)\s*\/\s*item\s*(\d+)$/i.exec(s);
        if (item) {
            const ln = find(P, item[1], `${where}: into`);
            if (!(ln.el instanceof pages.NavigationList)) throw new Error(`${where}: into '${s}': ${item[1]} is a ${kindOf(ln.el)}, not a navigation list`);
            const it = ln.el.items[Number(item[2]) - 1];
            if (!it) throw new Error(`${where}: ${item[1]} has no item ${item[2]} (items 1-${ln.el.items.length})`);
            return checkSlot(slotOf(P, it.widgets, ln, `${ln.name} item ${item[2]}`), slot, where);
        }
        const node = find(P, s, `${where}: into`, { placeholder: true });
        const el = node.el;
        let out = null;
        if (node.placeholder) out = slotOf(P, el.widgets, null, node.label);
        else if (el instanceof pages.DataView) {
            const footer = slot !== undefined && /^footer$/i.test(String(slot));
            if (slot !== undefined && !/^(footer|body|widgets)$/i.test(String(slot))) fail(`${where}: slot '${slot}' is not known (a data view has body and footer)`, slot, ["footer", "body"]);
            return slotOf(P, footer ? el.footerWidgets : el.widgets, node, footer ? `${node.name} footer` : node.name);
        } else if (el instanceof pages.DivContainer || el instanceof pages.GroupBox || el instanceof pages.TabPage || el instanceof pages.ListView) out = slotOf(P, el.widgets, node, node.name);
        else if (el instanceof pages.TemplateGrid) out = slotOf(P, el.contents.widgets, node, node.name);
        else if (el instanceof pages.NavigationList) throw new Error(`${where}: into '${s}': widgets go into one of its items: "${node.name}/item 1" ... "${node.name}/item ${el.items.length}"`);
        else if (pages.ScrollContainer && el instanceof pages.ScrollContainer) {
            // a layout's scroll container: its regions (center by default)
            const regions = ["center", "left", "right", "top", "bottom"].filter(r => el[r]);
            const r = slot === undefined ? "center" : String(slot).toLowerCase();
            if (!regions.includes(r)) fail(`${where}: ${node.name} has no region '${slot}' (regions: ${regions.join(", ")})`, String(slot), regions);
            return slotOf(P, el[r].widgets, node, `${node.name} ${r}`);
        }
        else if (el instanceof pages.LayoutGrid) {
            const cols = columnPaths(node);
            if (cols.length !== 1) throw new Error(`${where}: into '${s}': a layout grid holds widgets in its columns; name one: ${cols.join(", ")}`);
            const c = node.children.find(x => x.el instanceof pages.LayoutGridColumn);
            out = slotOf(P, c.el.widgets, c, c.label);
        } else if (el instanceof pages.TabContainer) throw new Error(`${where}: into '${s}': widgets go into one of its tab pages: ${node.children.filter(c => c.el instanceof pages.TabPage).map(c => c.name).join(", ")}`);
        else if (el instanceof pages.DataGrid) throw new Error(`${where}: into '${s}': a classic data grid holds columns, not widgets (changeWidget "columns")`);
        else if (el instanceof cw.CustomWidget) return plSlot(P, node, slot, where);
        else throw new Error(`${where}: into '${s}' is a ${kindOf(el)}; widgets go into a container, data view, list view, group box, tab page, layout grid column or the placeholder (see: widgets ${P.qn})`);
        return checkSlot(out, slot, where);
    }

    // The widget lists of a pluggable widget: [{ key: "content" | "columns 2/content", value }]
    function plLists(el) {
        const out = [];
        const walk = (obj, prefix) => {
            for (const p of obj.properties) {
                const vt = p.type && p.type.valueType;
                if (!vt) continue;
                if (vt.type === cw.WidgetValueTypeEnum.Widgets) out.push({ key: prefix + p.type.key, value: p.value });
                else if (vt.type === cw.WidgetValueTypeEnum.Object) p.value.objects.forEach((o, i) => walk(o, `${prefix}${p.type.key} ${i + 1}/`));
            }
        };
        if (el.object) walk(el.object, "");
        return out;
    }
    // A widget list of pluggable node (slot = its key, e.g. "content", "columns 2/content"); widgets in a list linked
    // to the widget's data source get its item as their object, others the object around the widget.
    function plSlot(P, node, slot, where) {
        const lists = plLists(node.el);
        if (!lists.length) throw new Error(`${where}: ${node.name} (${kindOf(node.el)}) holds no widgets`);
        let hit;
        if (slot === undefined) {
            if (lists.length > 1) throw new Error(`${where}: ${node.name} (${kindOf(node.el)}) has several widget lists; give "slot": ${lists.map(l => `"${l.key}"`).join(", ")}`);
            hit = lists[0];
        } else {
            const want = String(slot).trim().replace(/\[(\d+)\]/g, " $1").replace(/\./g, "/").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").toLowerCase();
            hit = lists.find(l => l.key.toLowerCase() === want) || fail(`${where}: ${node.name} has no widget list '${slot}' (slots: ${lists.map(l => l.key).join(", ")})`, String(slot), lists.map(l => l.key));
        }
        const obj = hit.value.containerAsWidgetProperty && hit.value.containerAsWidgetProperty.containerAsWidgetObject;
        const show = obj && obj.properties.find(p => p.type && p.type.key === "showContentAs");
        if (show && show.value.primitiveValue !== "customContent" && /\/content$/.test(hit.key)) client.warn(`${where}: ${node.name} ${hit.key.split("/")[0]} shows ${show.value.primitiveValue}, so its custom content stays hidden; set that column's "Show" to Custom content in Studio Pro`);
        return plSlotOf(P, node, hit.value, `${node.name}/${hit.key}`);
    }
    function plSlotOf(P, node, value, label) {
        const linked = !!(value.type && value.type.dataSourceProperty);
        return linked ? slotOf(P, value.widgets, node, label) : { list: value.widgets, label, node, dc: node.ctx || null };
    }

    function checkSlot(out, slot, where) {
        if (slot !== undefined) throw new Error(`${where}: slot (footer) goes with a data view in into; ${out.label} has no slots`);
        return out;
    }

    // The list a node is in, as a slot.
    function slotOfNode(P, node, where) {
        const holder = node.holder;
        if (holder instanceof cw.WidgetValue) {
            const owner = node.parent;
            const l = plLists(owner.el).find(x => x.value === holder);
            return plSlotOf(P, owner, holder, `${owner.name}/${l ? l.key : holder.type.containerAsWidgetPropertyType.key}`);
        }
        const list = holder && holder[node.prop];
        if (!list || typeof list.indexOf !== "function") throw new Error(`${where}: ${node.label} is not in a list of widgets`);
        const owner = node.parent && !node.parent.root ? node.parent : null;
        let label = owner ? owner.label : P.snippet || P.block || P.layout ? P.qn : "?";
        if (owner && owner.el instanceof pages.DataView && node.prop === "footerWidgets") label = `${owner.name} footer`;
        if (!owner && !P.snippet && !P.block) label = (placeholders(P).find(p => p.el === holder) || {}).label || label;
        const ph = placeholders(P).find(p => p.el === holder);
        return slotOf(P, list, ph ? null : owner, ph ? ph.label : label);
    }

    function defaultContainer(P, where) {
        if (P.snippet || P.block) return slotOf(P, P.doc.widgets, null, P.qn);
        if (P.layout && !P.doc.content.layoutCall) return slotOf(P, P.doc.content.widgets, null, P.qn);
        const ph = placeholders(P);
        if (ph.length === 1) return slotOf(P, ph[0].el.widgets, null, ph[0].label);
        throw new Error(`${where}: say where: "into" one of the placeholders ${ph.map(p => p.label).join(", ")}, a widget name, or "after"/"before" a widget (see: widgets ${P.qn})`);
    }

    // { list, label, node, dc, index, pos } for into/slot/after/before
    function place(P, o, where) {
        if (o.after !== undefined && o.before !== undefined) throw new Error(`${where}: give after or before, not both`);
        let slot = null;
        if (o.into !== undefined) slot = container(P, o.into, o.slot, where);
        else if (o.slot !== undefined) throw new Error(`${where}: slot (footer) goes with "into": the data view`);
        const sibName = o.after !== undefined ? o.after : o.before;
        if (sibName === undefined) {
            slot = slot || defaultContainer(P, where);
            return { ...slot, index: slot.list.length, pos: `${slot.label}, at the end` };
        }
        const word = o.after !== undefined ? "after" : "before";
        const sib = find(P, sibName, `${where}: ${word}`);
        const own = slotOfNode(P, sib, where);
        if (slot && slot.list !== own.list) throw new Error(`${where}: ${sib.label} is not in ${slot.label} (it is in ${own.label}); leave out "into" or name a widget in ${slot.label}`);
        slot = slot || own;
        return { ...slot, sib: sib.el, word, index: slot.list.indexOf(sib.el) + (word === "after" ? 1 : 0), pos: `${slot.label}, ${word} ${sib.label}` };
    }

    // ------------------------------------------------ texts

    async function defaultLanguage() {
        return (await I.languages())[0];
    }

    // Default-language text of a Texts$Text.
    async function textOf(t) {
        if (!t) return "";
        const lang = await defaultLanguage();
        const tr = t.translations.find(x => x.languageCode === lang) || (t.translations.length ? t.translations[0] : null);
        return tr ? tr.text : "";
    }

    // Writes value in the default language (as Studio Pro does when one edits a text); other languages keep their text.
    async function setText(t, value, ctx, where) {
        const ls = await I.languages();
        const cur = t.translations.find(x => x.languageCode === ls[0]);
        const tr = (h.translationsOf && h.translationsOf(value)) || {}; // the other languages, when given per language
        if (cur && cur.text === String(value) && !Object.keys(tr).length) return false;
        await h.text(t, { [ls[0]]: String(value) });
        const others = t.translations.filter(x => x.languageCode !== ls[0] && x.text && !(x.languageCode in tr));
        if (others.length) client.warn(`${where}: the ${others.map(x => x.languageCode).join(", ")} text still says "${short(others[0].text)}"; give the text per language ({ "${ls[0]}": "...", "${others[0].languageCode}": "..." }) or use setTranslations`);
        else if (ls.length > 1 && value !== "" && !ls.slice(1).every(c => c in tr)) ctx.untranslated++;
        return true;
    }

    // {Attribute} -> {1}, ... and the attributes in order
    function template(value) {
        const used = [];
        const text = String(value).replace(/\{([A-Za-z_][\w.]*(?:\/[A-Za-z_][\w.]*)*)\}/g, (m, a) => {
            if (!used.includes(a)) used.push(a);
            return `{${used.indexOf(a) + 1}}`;
        });
        return { text, used };
    }

    // A client template: text in the default language and its attribute parameters (kept when they stay the same).
    async function setTemplate(ct, value, dc, ctx, where) {
        I.noPlaceholder(value, where);
        const { text, used } = template(value);
        if (used.length && !dc) throw new Error(`${where}: {${used[0]}} needs a data view or list view around the widget`);
        const paths = used.map(n => I.pathOf(dc.ent, n, where));
        const key = r => (r ? [r.attributeQualifiedName, ...(r.entityRef && r.entityRef.steps ? r.entityRef.steps.map(st => st.associationQualifiedName) : [])].join("|") : null);
        const cur = ct.parameters.map(p => (p.attributeRef && !prop(p, "expression") ? key(p.attributeRef) : null));
        if (cur.length !== paths.length || paths.some((p, i) => cur[i] !== [p.attr.qualifiedName, ...p.steps.map(st => st.assoc.qualifiedName)].join("|"))) {
            const others = ct.template.translations.filter(x => x.languageCode !== ctx.lang && /\{\d+\}/.test(x.text));
            if (others.length) client.warn(`${where}: the ${others.map(x => x.languageCode).join(", ")} text uses {1}-style values that now mean other attributes; check it in Studio Pro`);
            if (ct.parameters.length) ct.parameters.clear();
            for (const a of paths) {
                const p = pages.ClientTemplateParameter.create(model);
                ct.parameters.push(p);
                p.attributeRef = I.attrRefOf(a);
            }
        }
        await setText(ct.template, text, ctx, where);
    }

    const { condition, sameCondition, fill } = I;

    // ------------------------------------------------ changeWidget fields

    const has = (w, k) => prop(w, k) !== undefined;
    const isInput = w => w instanceof pages.InputWidget || (w instanceof cw.CustomWidget && sysProps(w).includes("Editability"));

    const CHANGE = {
        async caption(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (w instanceof pages.DynamicText) throw new Error(`${where}: a text has no caption; use "text"`);
            if (w instanceof pages.InputWidget || w instanceof cw.CustomWidget) throw new Error(`${where}: an input has no caption; use "label"`);
            if (w instanceof pages.Label) return CHANGE.text(P, node, v, dc, ctx, where);
            const c = prop(w, "caption");
            if (c === undefined) throw new Error(`${where}: a ${kindOf(w)} has no caption`);
            if (c instanceof texts.Text) await setText(c, v, ctx, where);
            else {
                if (!c) w.caption = pages.ClientTemplate.create(model); // a group box without a caption
                await setTemplate(w.caption, v, dc, ctx, where);
            }
            return `caption "${v}"`;
        },
        async text(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (w instanceof pages.DynamicText) await setTemplate(w.content, v, dc, ctx, where);
            else if (w instanceof pages.Label || (pages.Title && w instanceof pages.Title)) await setText(w.caption, v, ctx, where);
            else if (has(w, "caption")) throw new Error(`${where}: a ${kindOf(w)} has a caption, not a text; use "caption"`);
            else throw new Error(`${where}: a ${kindOf(w)} has no text${isInput(w) ? `; use "label"` : ""}`);
            return `text "${v}"`;
        },
        async label(P, node, v, dc, ctx, where) {
            const w = node.el;
            const ok = w instanceof pages.InputWidget || (w instanceof cw.CustomWidget && sysProps(w).includes("Label"));
            if (!ok) throw new Error(`${where}: a ${kindOf(w)} has no label${has(w, "caption") ? `; use "caption"` : w instanceof pages.DynamicText ? `; use "text"` : ""}`);
            if (v === "" || v === null) {
                if (w.labelTemplate) w.labelTemplate = null;
                return "no label";
            }
            if (!w.labelTemplate) w.labelTemplate = pages.ClientTemplate.create(model);
            await setTemplate(w.labelTemplate, v, dc, ctx, where);
            return `label "${v}"`;
        },
        async placeholder(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!(w instanceof pages.AttributeWidgetWithPlaceholder)) throw new Error(`${where}: a ${kindOf(w)} has no placeholder (text box, text area and date picker have one)`);
            const t = prop(w, "placeholderTemplate");
            if (t === undefined) throw new Error(`${where}: placeholders are not supported in this Mendix version`);
            await setTemplate(t, v, dc, ctx, where);
            return `placeholder "${v}"`;
        },
        async editable(P, node, v, dc, ctx, where) {
            const w = node.el;
            const E = pages.EditableEnum;
            if (w instanceof pages.DataView) {
                if (typeof v !== "boolean" && !/^(true|false)$/.test(String(v))) throw new Error(`${where}: a data view is editable true or false (conditional editability: set it on its inputs)`);
                const on = bool(v, true);
                // Mendix 10.7+: editability; older: editable
                if (has(w, "editability")) {
                    if (w.editability !== (on ? E.Always : E.Never)) w.editability = on ? E.Always : E.Never;
                    if (w.conditionalEditabilitySettings) w.conditionalEditabilitySettings = null;
                } else if (w.editable !== on) setIfAvailable(w, "editable", on);
                return on ? "editable" : "read-only";
            }
            if (w instanceof pages.ListView) {
                if (typeof v !== "boolean" && !/^(true|false)$/.test(String(v))) throw new Error(`${where}: a list view is editable true or false (conditional editability: set it on its inputs)`);
                const on = bool(v, false);
                if (w.editable !== on) w.editable = on;
                return on ? "editable list" : "read-only list";
            }
            if (!isInput(w)) throw new Error(`${where}: a ${kindOf(w)} is not an input, data view or list view; editable is for those`);
            if (typeof v === "boolean" || /^(true|false)$/.test(String(v))) {
                const want = bool(v, true) ? E.Always : E.Never;
                if (w.editable !== want) w.editable = want;
                if (w.conditionalEditabilitySettings) w.conditionalEditabilitySettings = null;
                return want === E.Always ? "editable" : "read-only";
            }
            const c = await condition(v, dc, where, "editable");
            if (w.editable !== E.Conditional) w.editable = E.Conditional;
            if (!sameCondition(w.conditionalEditabilitySettings, c)) {
                if (!w.conditionalEditabilitySettings) w.conditionalEditabilitySettings = pages.ConditionalEditabilitySettings.create(model);
                fill(w.conditionalEditabilitySettings, c);
            }
            return c.text;
        },
        async visible(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!has(w, "conditionalVisibilitySettings") || (w instanceof cw.CustomWidget && !sysProps(w).includes("Visibility"))) {
                throw new Error(`${where}: a ${kindOf(w)} has no visibility setting; put it in a container (addWidgets / moveWidget) and make the container conditional`);
            }
            if (v === true || v === "true") {
                if (w.conditionalVisibilitySettings) w.conditionalVisibilitySettings = null;
                return "always visible";
            }
            const c = v === false || v === "false" ? { attribute: null, values: [], expression: "false", text: "never visible (deleteWidget removes it)" } : await condition(v, dc, where, "visible");
            const s = w.conditionalVisibilitySettings;
            if (!sameCondition(s, c)) {
                if (!s) w.conditionalVisibilitySettings = pages.ConditionalVisibilitySettings.create(model);
                fill(w.conditionalVisibilitySettings, c);
            }
            return c.text;
        },
        async class(P, node, v, dc, ctx, where) {
            const ap = prop(node.el, "appearance");
            if (!ap) throw new Error(`${where}: a ${kindOf(node.el)} has no CSS class`);
            if (ap.class !== String(v)) ap.class = String(v);
            return `class "${v}"`;
        },
        async design(P, node, v, dc, ctx, where) {
            const ap = prop(node.el, "appearance");
            if (!ap) throw new Error(`${where}: a ${kindOf(node.el)} has no design properties`);
            const platform = require("./theme-native").isNativeDoc(client, P.doc) ? "native" : "web";
            return `design ${design.apply(sdk, model, node.el, design.resolve(client.project.dir, node.el, v, `${where}: design`, platform), client.warn) || "unchanged"}`;
        },
        async style(P, node, v, dc, ctx, where) {
            const ap = prop(node.el, "appearance");
            if (!ap) throw new Error(`${where}: a ${kindOf(node.el)} has no CSS style`);
            if (require("./theme-native").isNativeDoc(client, P.doc)) throw new Error(`${where}: ${require("./theme-native").NATIVE_STYLE_REFUSAL}`);
            if (/^(text|paragraph|h[1-6])$/i.test(String(v))) throw new Error(`${where}: "style" is inline CSS; for a heading use "textStyle": "${v}"`);
            if (/^(default|primary|success|info|warning|danger|inverse)$/i.test(String(v))) throw new Error(`${where}: "style" is inline CSS; for a button colour use "buttonStyle": "${v}"`);
            if (ap.style !== String(v)) ap.style = String(v);
            return `style "${v}"`;
        },
        async textStyle(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!(w instanceof pages.DynamicText)) throw new Error(`${where}: textStyle is for a text; a ${kindOf(w)} has none`);
            const m = enumValue(pages.TextRenderMode, v, "textStyle");
            if (w.renderMode !== m) w.renderMode = m;
            return `text style ${m.name}`;
        },
        async buttonStyle(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!has(w, "buttonStyle")) throw new Error(`${where}: buttonStyle is for a button; a ${kindOf(w)} has none`);
            const m = enumValue(pages.ButtonStyle, v, "buttonStyle");
            if (w.buttonStyle !== m) w.buttonStyle = m;
            return `button style ${m.name}`;
        },
        async columns(P, node, v, dc, ctx, where) {
            return gridColumns(P, node, v, ctx, where, dc);
        },
        ...Object.fromEntries(LIST_FIELDS.map(f => [f, (...a) => GE().CHANGE[f](...a)])),
        ...Object.fromEntries(Object.keys(require("./widget-edit").WIDGET_CHANGE).map(f => [f, (...a) => WE().CHANGE[f](...a)])),
        async headerFilters(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!(w instanceof cw.CustomWidget) || !w.object || !w.object.properties.some(p => p.type && p.type.key === "filtersPlaceholder")) throw new Error(`${where}: headerFilters is for a Data grid 2 or gallery; ${node.label} is a ${kindOf(w)}`);
            const src = cwSource(w);
            const qn = src && refEntity(prop(src, "entityRef"));
            if (!qn) throw new Error(`${where}: the entity of ${node.label} is not known here; add its filters in Studio Pro`);
            const ent = await I.entityOf(qn, where);
            const out = await I.gridExtras().headerFilters(w, ent, v, { container: dc || null, where, name: node.name, spec: {} }, ctx, where);
            return out.join("; ");
        },
        async xpath(P, node, v, dc, ctx, where) {
            const w = node.el;
            const src = w instanceof cw.CustomWidget ? cwSource(w) : prop(w, "dataSource");
            const xp = src && prop(src, "xPathConstraint");
            if (xp === undefined || xp === null) throw new Error(`${where}: a ${kindOf(w)}${src ? ` with a ${src.structureTypeName.split("$")[1]}` : ""} has no XPath; xpath is for a grid, list view or Data grid 2 over the database`);
            const qn = refEntity(src.entityRef);
            if (String(v).trim()) I.checkXPath({ spec: { xpath: v }, where, kind: kindOf(w), container: dc }, await I.entityOf(qn, where));
            if (String(v).trim()) I.gridExtras().xpathVariables(String(v), ctx, where);
            if (src.xPathConstraint !== String(v)) src.xPathConstraint = String(v);
            return String(v) ? `XPath ${v}` : "XPath removed (all objects)";
        },
        async action(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (pages.GridActionButton && w instanceof pages.GridActionButton) {
                // a classic grid button: the selected row (rows: Multi selection) of its grid
                const grid = w.container && w.container.container;
                const gn = P.nodes.find(n => n.el === grid);
                const { qn } = gn ? await containerEntity(P, gn) : { qn: grid && grid.dataSource && refEntity(prop(grid.dataSource, "entityRef")) };
                const ent = qn ? await I.entityOf(qn, where) : null;
                const multi = grid && /Multi/.test(grid.selectionMode.name);
                const row = { kind: "dataGrid", ent, widget: grid, name: grid.name, existing: true, container: dc, spec: { selection: grid.selectionMode.name } };
                return I.makeAction(v, { container: row, name: grid.name, selectionList: multi ? ent : null }, ctx, where, a => (w.action = a));
            }
            if (!(w instanceof pages.ActionButton)) throw new Error(`${where}: action is for a button; a ${kindOf(w)} has ${w instanceof cw.CustomWidget ? `"onClick"` : isInput(w) ? `"onChange"` : "none"}`);
            return I.makeAction(v, { container: dc, name: node.name }, ctx, where, a => (w.action = a));
        },
        ...Object.fromEntries(UI_FIELDS.map(f => [f, (P, node, v, dc, ctx, where) => uiOf().change(f, node.el, v, { dc, ctx, where, caption: ctx.op && ctx.op.caption, at: { container: dc, name: node.name } })])),
        async onClick(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (w instanceof pages.DivContainer) return uiOf().change("onClick", w, v, { dc, ctx, where, at: { container: dc, name: node.name } });
            if (w instanceof pages.ListView) {
                const { qn } = await containerEntity(P, node);
                const ent = qn ? await I.entityOf(qn, where) : null;
                return I.makeAction(v, { container: { kind: "listView", ent, widget: w, name: node.name, existing: true, container: dc }, name: node.name }, ctx, where, a => (w.clickAction = a));
            }
            const p = w instanceof cw.CustomWidget && w.object ? w.object.properties.find(x => x.type && x.type.key === "onClick") : null;
            if (!p) throw new Error(`${where}: onClick is for a container, Data grid 2 or gallery${w instanceof pages.ActionButton ? `; a button takes "action"` : ""}`);
            const { qn } = await containerEntity(P, node);
            const ent = qn ? await I.entityOf(qn, where) : null;
            const row = { kind: "pluggable", ent, widget: w, name: node.name, existing: true, container: dc };
            return I.makeAction(v, { container: row, name: node.name }, ctx, where, a => (p.value.action = a));
        },
        async onChange(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (w instanceof cw.CustomWidget) {
                const p = w.object ? w.object.properties.find(x => x.type && x.type.key === "onChangeEvent") : null;
                if (!p) throw new Error(`${where}: this ${kindOf(w)} has no on change event`);
                return I.makeAction(v, { container: dc, name: node.name }, ctx, where, a => (p.value.action = a));
            }
            if (prop(w, "onChangeAction") === undefined) throw new Error(`${where}: a ${kindOf(w)} has no on change event (inputs, reference selectors and combo boxes have one)`);
            return I.makeAction(v, { container: dc, name: node.name }, ctx, where, a => (w.onChangeAction = a));
        },
        async onEnter(P, node, v, dc, ctx, where) {
            return eventChange(node, "onEnter", v, dc, ctx, where);
        },
        async onLeave(P, node, v, dc, ctx, where) {
            return eventChange(node, "onLeave", v, dc, ctx, where);
        },
        async onEnterKeyPress(P, node, v, dc, ctx, where) {
            return eventChange(node, "onEnterKeyPress", v, dc, ctx, where);
        },
        ...Object.fromEntries(INPUT_FIELDS.map(f => [f, (P, node, v, dc, ctx, where) => inputChange(node, f, v, dc, ctx, where)])),
        async orientation(P, node, v, dc, ctx, where) {
            if (node.el instanceof pages.SimpleMenuBar) return `orientation ${(node.el.orientation = require("./widget-kinds").enumOf(pages.SimpleMenuBarOrientation, v, `${where}`, "horizontal | vertical")).name.toLowerCase()}`;
            return dvChange(node, "orientation", v, where);
        },
        async labelWidth(P, node, v, dc, ctx, where) {
            return dvChange(node, "labelWidth", v, where);
        },
        async showFooter(P, node, v, dc, ctx, where) {
            return dvChange(node, "showFooter", v, where);
        },
        async selectPage(P, node, v, dc, ctx, where) {
            const w = node.el;
            const ref = prop(w, "attributeRef");
            const steps = ref && ref.entityRef && ref.entityRef.steps ? ref.entityRef.steps : [];
            if (!has(w, "selectPageSettings") || !steps.length) throw new Error(`${where}: selectPage is for a reference selector or reference set selector`);
            const other = await I.entityOf(steps[steps.length - 1].destinationEntityQualifiedName, where);
            const text = await I.selectPage(w, { spec: { selectPage: v }, where, kind: kindOf(w), container: dc }, other, ctx);
            return text.slice(2);
        },
        async name(P, node, v, dc, ctx, where) {
            const n = validName(v, "widget name");
            const old = node.name;
            if (n === old) return `name ${n}`;
            if (P.names.includes(n)) throw new Error(`${where}: the name '${n}' is already used on ${P.qn}`);
            if (node.el instanceof pages.Placeholder && placeholderUsers(P.qn, old).length) throw new Error(`${where}: placeholder ${old} is filled by ${placeholderUsers(P.qn, old).slice(0, 5).join(", ")}${placeholderUsers(P.qn, old).length > 5 ? ", ..." : ""}; renaming it would empty those pages (rename it in Studio Pro, which moves their content)`);
            node.el.name = n; // the Model SDK renames by-name references (page variables) itself
            const listeners = listenersOf(P, [old]);
            for (const l of listeners) l.src.listenTarget = n;
            const left = mentions(P, old);
            if (left.length) client.warn(`${where}: ${left.length} expression(s) still say $${old}: ${left.slice(0, 3).join("; ")}; change them in Studio Pro`);
            return `renamed to ${n}${listeners.length ? ` (${listeners.map(l => l.node.label).join(", ")} now ${listeners.length > 1 ? "listen" : "listens"} to ${n})` : ""}`;
        }
    };

    const EVENT_PROPS = { onChange: "onChangeAction", onEnter: "onEnterAction", onLeave: "onLeaveAction", onEnterKeyPress: "onEnterKeyPressAction" };
    async function eventChange(node, k, v, dc, ctx, where) {
        const w = node.el;
        if (prop(w, EVENT_PROPS[k]) === undefined) throw new Error(`${where}: a ${kindOf(w)} has no ${k} event${k === "onEnterKeyPress" ? " (a text box has one)" : " (text boxes, text areas, date pickers and drop-downs have one)"}`);
        return `${k}: ` + (await I.makeAction(v, { container: dc, name: node.name }, ctx, where, a => (w[EVENT_PROPS[k]] = a)));
    }
    // required / validation / format / read-only style / mask / max length of an input (readOnlyStyle of a data view: dvChange)
    async function inputChange(node, f, v, dc, ctx, where) {
        const w = node.el, o = ctx.op;
        if (f === "readOnlyStyle" && w instanceof pages.DataView) return dvChange(node, f, v, where);
        if (f === "requiredMessage") {
            if (o.required === undefined) throw new Error(`${where}: requiredMessage goes with "required": true`);
            return "";
        }
        if (f === "format" && w instanceof pages.GridColumn) {
            const attr = w.attributeRef ? model.findAttributeByQualifiedName(w.attributeRef.attributeQualifiedName) : null;
            if (!attr) throw new Error(`${where}: the column's attribute is not known here`);
            return `format ${I.formatInto(w, attr, v, where)}`;
        }
        if (!(w instanceof pages.InputWidget)) throw new Error(`${where}: ${f} is for an input (text box, text area, date picker, drop-down, reference selector, ...)${f === "format" ? " or a classic grid column" : ""}; a ${kindOf(w)} has none`);
        if (f === "required" && !bool(v, false)) {
            if (!prop(w, "validation")) throw new Error(`${where}: a ${kindOf(w)} has no validation`);
            const was = w.validation.expression;
            if (was) w.validation.expression = "";
            if (w.validation.message.translations.length) w.validation.message.translations.clear();
            await h.text(w.validation.message, ""); // as Studio Pro stores no validation: one empty text
            return was ? `no validation (was ${was})` : "no validation";
        }
        const ref = prop(w, "attributeRef");
        const attr = ref && !(w instanceof pages.AssociationWidget) ? model.findAttributeByQualifiedName(ref.attributeQualifiedName) : null;
        const spec = { [f]: v, ...(f === "required" && o.requiredMessage !== undefined ? { requiredMessage: o.requiredMessage } : {}) };
        const label = w.labelTemplate ? await textOf(w.labelTemplate.template) : "";
        const out = await I.inputExtras({ spec, where, kind: kindOf(w), container: dc }, w, attr, ctx, label);
        return out.join(", ");
    }
    function dvChange(node, f, v, where) {
        if (!(node.el instanceof pages.DataView)) throw new Error(`${where}: ${f} is for a data view; a ${kindOf(node.el)} has none`);
        return I.dvSettings(node.el, { [f]: v }, where).join(", ");
    }

    // Listening data views of names: [{ node, src }]
    function listenersOf(P, names, except) {
        const out = [];
        for (const n of P.nodes) {
            const src = prop(n.el, "dataSource");
            if (src instanceof pages.ListenTargetSource && names.includes(src.listenTarget) && !(except && except.has(n.el))) out.push({ node: n, src });
        }
        return out;
    }

    // "$name" in expressions and XPath of the page
    function mentions(P, name) {
        const re = new RegExp(`\\$${name}\\b`);
        const out = [];
        P.doc.traverse(el => {
            for (const k of ["expression", "xPathConstraint"]) {
                const v = prop(el, k);
                if (typeof v === "string" && re.test(v)) out.push(`${el.structureTypeName.split("$")[1]}.${k} = ${short(v)}`);
            }
        });
        return out;
    }

    // columns: { add, remove } for a classic data grid or Data grid 2
    async function gridColumns(P, node, v, ctx, where, dc) {
        const w = node.el;
        if (w instanceof cw.CustomWidget && w.type && w.type.widgetId === GALLERY) return I.gridExtras().galleryColumns(w, v, where);
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: columns is { "add": [ "Attr", ... ], "remove": [ "Attr", ... ], "change": [ { "column": "Attr", ... } ], "move": [ { "column": "Attr", "before": "Other" } ] }`);
        const COLUMN_OPS = ["add", "remove", "change", "move"];
        for (const k of Object.keys(v)) {
            if (k === "order" || k === "reorder") throw new Error(`${where}: columns.${k}: use "move": [ { "column": "Note", "before": "Number" } | { "column": "Note", "after": "Number" } | { "column": "Note", "position": 1 } ]`);
            if (!COLUMN_OPS.includes(k)) fail(`${where}: unknown field '${k}' in columns`, k, COLUMN_OPS);
        }
        const add = I.list(v.add, `${where}: columns.add`), remove = I.list(v.remove, `${where}: columns.remove`), change = I.list(v.change, `${where}: columns.change`), move = I.list(v.move, `${where}: columns.move`);
        if (!add.length && !remove.length && !change.length && !move.length) throw new Error(`${where}: columns needs "add", "remove", "change" and/or "move"`);
        const classic = w instanceof pages.DataGrid;
        if (!classic && !I.isGrid2(w)) throw new Error(`${where}: columns is for a classic data grid, Data grid 2 or gallery (devices); ${node.label} is a ${kindOf(w)}`);
        const src = classic ? w.dataSource : cwSource(w);
        const qn = src && refEntity(prop(src, "entityRef"));
        const { qn: shownQn } = qn ? { qn } : await containerEntity(P, node);
        if (!shownQn) throw new Error(`${where}: the entity of ${node.label} is not known here; change its columns in Studio Pro`);
        const ent = await I.entityOf(shownQn, where);
        const colsProp = classic ? null : w.object.properties.find(p => p.type && p.type.key === "columns");
        const cur = () => (classic ? w.columns.map(c => ({ el: c, name: c.name, attr: c.attributeRef ? c.attributeRef.attributeQualifiedName : null, caption: c.caption }))
            : colsProp.value.objects.map(o => ({ el: o, name: null, attr: (I.valueOf(o, "attribute") || {}).attributeRef ? I.valueOf(o, "attribute").attributeRef.attributeQualifiedName : null, caption: (I.valueOf(o, "header") || {}).textTemplate ? I.valueOf(o, "header").textTemplate.template : null })));
        const done = [];
        for (const [i, r] of remove.entries()) {
            const key = String(r);
            const all = cur();
            const label = async c => (c.caption ? await textOf(c.caption) : "");
            const hits = [];
            for (const c of all) if ((c.attr && c.attr.split(".").pop() === key) || c.name === key || (await label(c)) === key) hits.push(c);
            if (hits.length > 1) throw new Error(`${where}: columns.remove '${key}' matches ${hits.length} columns; give a column caption or name`);
            if (!hits.length) {
                const opts = [];
                for (const c of all) opts.push(...[c.attr && c.attr.split(".").pop(), c.name, await label(c)].filter(Boolean));
                fail(`${where}: columns.remove ${i + 1}: ${node.label} has no column '${key}'`, key, [...new Set(opts)]);
            }
            const inside = [];
            hits[0].el.traverse(x => x !== hits[0].el && x instanceof pages.Widget && x.name && inside.push(x.name));
            hits[0].el.delete();
            done.push(`-${key}${inside.length ? ` (with ${inside.join(", ")})` : ""}`);
        }
        let allowed = [];
        if (!classic) {
            const colType = colsProp.type.valueType.objectType;
            const at = colType.propertyTypes.find(pt => pt.key === "attribute");
            allowed = at ? at.valueType.attributeTypes.map(x => x.name) : [];
        }
        const widths = classic ? w.columns.map(c => c.width).filter(x => x > 0) : [];
        for (const [i, a] of add.entries()) {
            let s = typeof a === "string" ? { attribute: a } : a;
            const at = `${where}: columns.add ${i + 1}`;
            const shape = classic ? null : gridExtras.columnShape(s, at);
            if (classic && s && typeof s === "object" && (s.type !== undefined || s.widgets !== undefined || s.dynamicText !== undefined || s.text !== undefined) && !/^attribute$/i.test(String(s.type || ""))) throw new Error(`${at}: a classic data grid shows attributes only; dynamic text and custom content columns are Data grid 2 (convertGrid makes this grid a Data grid 2)`);
            if (classic && (!s || typeof s !== "object" || !s.attribute)) throw new Error(`${at}: use "Attr" or { "attribute": ..., "caption": ..., "width": ... }`);
            if (classic && s.type !== undefined) {
                s = { ...s };
                delete s.type;
            }
            const keys = classic ? ["attribute", "caption", "width", "format", "class"] : shape.own;
            if (classic) for (const k of Object.keys(s)) if (!keys.includes(k) && COLUMN_SETTINGS[k]) throw new Error(`${at}: ${k} is a Data grid 2 column setting; a classic grid column has caption, width (a weight), format and class`);
            if (classic) for (const k of Object.keys(s)) if (!keys.includes(k)) fail(`${at}: unknown field '${k}'`, k, keys);
            if (!classic) I.gridExtras().checkColumnFields(s, keys, at);
            if (!classic && shape.kind !== "attribute") {
                // dynamic text / custom content (its widgets are added after this op's other changes, in the row's object)
                const col = await I.gridExtras().newColumn(colsProp, { kind: shape.kind, text: shape.text, caption: s.caption !== undefined ? String(s.caption) : "", format: s.format }, { grid: w, ent, dc }, ctx, at);
                const set = await I.gridExtras().columnSettings(col, s, { grid: w, ent, dc }, ctx, at);
                if (shape.kind === "customContent") {
                    (ctx.later = ctx.later || []).push(async () => {
                        const P2 = await open(P.qn, at);
                        const n = colsProp.value.objects.indexOf(col) + 1;
                        const r = await addWidgetsAt(P2, place(P2, { into: node.name, slot: `columns ${n}/content` }, at), { page: P.qn, widgets: shape.widgets }, at);
                        return `column ${n} content: ${r.replace(/^[^:]*: /, "")}`;
                    });
                }
                done.push(`+${shape.kind === "dynamicText" ? `dynamic text "${shape.text}"` : "custom content"}${s.caption ? ` "${s.caption}"` : ""}${set.length ? ` (${set.join(", ")})` : ""}`);
                continue;
            }
            if (!classic && s.format !== undefined) throw new Error(`${at}: a Data grid 2 attribute column shows the attribute with its own format; for a format use { "type": "dynamicText", "text": "{${s.attribute}}", "format": { "${s.attribute}": { ... } } }`);
            const path = I.pathOf(ent, String(s.attribute), at), attr = path.attr;
            if (cur().some(c => c.attr === attr.qualifiedName)) client.warn(`${where}: ${node.label} already has a column for ${attr.name}; added a second one`);
            const caption = s.caption !== undefined ? String(s.caption) : I.humanize(attr.name);
            if (classic) {
                if (attr.type instanceof dm.BinaryAttributeType) throw new Error(`${at}: '${attr.name}' is binary; a grid column cannot show it`);
                // width: a weight like the others (they need not add up to 100); default their average
                const width = s.width !== undefined ? Number(s.width) : widths.length ? Math.max(1, Math.round(widths.reduce((x, y) => x + y, 0) / widths.length)) : 100;
                if (!(Number.isInteger(width) && width > 0)) throw new Error(`${at}: width must be a whole number > 0 (a weight)`);
                const col = await I.classicColumn(w, path, caption, width, ctx);
                if (s.format !== undefined) I.formatInto(col, attr, s.format, `${at}: format`);
                if (s.class !== undefined) col.appearance.class = classList(s.class, at);
            } else {
                if (allowed.length && !allowed.includes(I.typeOf(attr))) throw new Error(`${at}: a Data grid 2 column cannot show '${attr.name}' (${I.typeOf(attr)}); it shows ${allowed.join(", ")}`);
                const col = await I.gridExtras().newColumn(colsProp, { kind: "attribute", path, caption }, { grid: w, ent, dc }, ctx, at);
                const set = await I.gridExtras().columnSettings(col, s, { grid: w, ent, dc }, ctx, at);
                const f = s.filter !== undefined ? await I.gridExtras().columnFilter(col, { attr, path, filter: s.filter }, { container: dc || null, spec: {}, name: node.name, widget: w }, ctx, at) : null;
                if (set.length || f) done.push(`+${path.text} (${[...set, ...(f ? [f] : [])].join(", ")})`);
                else done.push(`+${path.text}`);
                continue;
            }
            done.push(`+${path.text}`);
        }
        // change: settings of existing columns
        for (const [i, c] of change.entries()) {
            const at = `${where}: columns.change ${i + 1}`;
            if (!c || typeof c !== "object" || Array.isArray(c) || c.column === undefined) throw new Error(`${at}: use { "column": "Attr" or a caption, ...settings }`);
            const key = String(c.column);
            const all = cur();
            const hits = [];
            for (const x of all) if ((x.attr && x.attr.split(".").pop() === key) || x.name === key || (x.caption && (await textOf(x.caption)) === key)) hits.push(x);
            if (hits.length > 1) throw new Error(`${at}: '${key}' matches ${hits.length} columns; give a column caption or name`);
            if (!hits.length) {
                const opts = [];
                for (const x of all) opts.push(...[x.attr && x.attr.split(".").pop(), x.name, x.caption ? await textOf(x.caption) : ""].filter(Boolean));
                fail(`${at}: ${node.label} has no column '${key}'`, key, [...new Set(opts)]);
            }
            const col = hits[0].el;
            const s = { ...c };
            delete s.column;
            if (classic) {
                for (const k of Object.keys(s)) if (!["width", "class"].includes(k)) {
                    if (COLUMN_SETTINGS[k]) throw new Error(`${at}: ${k} is a Data grid 2 column setting; a classic grid column changes width (a weight) and class here (caption: changeWidget on the column by name)`);
                    fail(`${at}: unknown field '${k}'`, k, ["width", "class"]);
                }
                const bits = [];
                if (s.width !== undefined) {
                    const n = Number(s.width);
                    if (!(Number.isInteger(n) && n > 0)) throw new Error(`${at}: width must be a whole number > 0 (a weight)`);
                    col.width = n;
                    bits.push(`width ${n}`);
                }
                if (s.class !== undefined) {
                    col.appearance.class = classList(s.class, at);
                    bits.push(`class ${s.class}`);
                }
                done.push(`~${key} (${bits.join(", ") || "unchanged"})`);
                continue;
            }
            I.gridExtras().checkColumnFields(s, ["caption", "filter", ...Object.keys(COLUMN_SETTINGS)], at);
            const set = await I.gridExtras().columnSettings(col, s, { grid: w, ent, dc }, ctx, at);
            if (s.caption !== undefined) {
                const hd = I.valueOf(col, "header");
                if (!hd) throw new Error(`${at}: this Data grid 2 column has no caption`);
                await I.templateAll(hd, "textTemplate", String(s.caption), ctx, at);
                set.unshift(`caption "${s.caption}"`);
            }
            if (s.filter !== undefined) {
                const fv = I.valueOf(col, "filter");
                if (fv && fv.widgets.length) throw new Error(`${at}: column ${key} has a filter (${fv.widgets.map(x => x.name).join(", ")}); delete it with deleteWidget first`);
                const ar = (I.valueOf(col, "attribute") || {}).attributeRef;
                if (!ar) throw new Error(`${at}: column ${key} shows no attribute; a filter goes on an attribute column`);
                const steps = ar.entityRef && ar.entityRef.steps ? ar.entityRef.steps.map(st => st.associationQualifiedName.split(".").pop()).join("/") : "";
                const path = I.pathOf(ent, `${steps ? steps + "/" : ""}${ar.attributeQualifiedName.split(".").pop()}`, at);
                set.push(await I.gridExtras().columnFilter(col, { attr: path.attr, path, filter: s.filter }, { container: dc || null, spec: {}, name: node.name, widget: w }, ctx, at));
            }
            done.push(`~${key} (${set.join(", ") || "unchanged"})`);
        }
        // move: reorder (Studio Pro shows the columns in this order; a user's own order is kept in personalization)
        for (const [i, m] of move.entries()) {
            const at = `${where}: columns.move ${i + 1}`;
            if (!m || typeof m !== "object" || Array.isArray(m) || m.column === undefined) throw new Error(`${at}: use { "column": "Attr" or a caption, "before": "Other" } (or "after": "Other", or "position": 1)`);
            const MOVE = ["column", "before", "after", "position"];
            for (const k of Object.keys(m)) if (!MOVE.includes(k)) fail(`${at}: unknown field '${k}'`, k, MOVE);
            const how = ["before", "after", "position"].filter(k => m[k] !== undefined);
            if (how.length !== 1) throw new Error(`${at}: give one of "before", "after" or "position"`);
            const one = await columnOf(cur(), String(m.column), at, node.label);
            const list = classic ? w.columns : colsProp.value.objects;
            let index;
            if (how[0] === "position") {
                const n = Number(m.position);
                if (!Number.isInteger(n) || n < 1 || n > list.length) throw new Error(`${at}: position must be 1-${list.length}`);
                index = n - 1;
            } else {
                const other = await columnOf(cur(), String(m[how[0]]), at, node.label);
                if (other.el === one.el) throw new Error(`${at}: a column cannot move ${how[0]} itself`);
                const without = list.filter(x => x !== one.el);
                index = without.indexOf(other.el) + (how[0] === "after" ? 1 : 0);
            }
            if (list.indexOf(one.el) === index) {
                done.push(`${m.column} stays at ${index + 1}`);
                continue;
            }
            one.el.detach();
            list.splice(index, 0, one.el);
            done.push(`${m.column} to ${index + 1}`);
        }
        if (classic && !w.columns.length) client.warn(`${where}: ${node.label} has no columns left`);
        return `columns ${done.join(", ")}`;
    }

    // One column of cur() by attribute name, column name or caption (with "did you mean")
    async function columnOf(all, key, at, label) {
        const hits = [];
        for (const x of all) if ((x.attr && x.attr.split(".").pop() === key) || x.name === key || (x.caption && (await textOf(x.caption)) === key)) hits.push(x);
        if (hits.length > 1) throw new Error(`${at}: '${key}' matches ${hits.length} columns; give a column caption or name`);
        if (!hits.length) {
            const opts = [];
            for (const x of all) opts.push(...[x.attr && x.attr.split(".").pop(), x.name, x.caption ? await textOf(x.caption) : ""].filter(Boolean));
            fail(`${at}: ${label} has no column '${key}'`, key, [...new Set(opts)]);
        }
        return hits[0];
    }

    const classList = (v, at) => {
        if (!/^[\w\s-]*$/.test(String(v))) throw new Error(`${at}: class '${v}' is not a CSS class list`);
        return String(v);
    };

    // ------------------------------------------------ operations

    // new widgets in the op's ctx, names given and Studio Pro style
    const uiOf = () => I.ui();
    // list edits and convertGrid (grid-edit.js)
    let ge = null;
    const GE = () => ge || (ge = require("./grid-edit").makeGridEdit(h, I, { open, find, containerEntity, builderContext, cwSource, kindOf, listenersOf, subtree, variableUsers, mentions, textOf, slotOfNode, addWidgetsAt: (...a) => addWidgetsAt(...a), place, newCtx, defaultLanguage }));
    // tabs, scroll container regions, navigation list items, menus, convertWidget, createLoginPage (widget-edit.js)
    let we = null;
    const WE = () => we || (we = require("./widget-edit").makeWidgetEdit(h, I, { open, find, containerEntity, builderContext, kindOf, listenersOf, subtree, variableUsers, mentions, textOf, setText, setTemplate, slotOfNode, addWidgetsAt: (...a) => addWidgetsAt(...a), place, newCtx, defaultLanguage, removable, scopeOf: (...a) => scopeOf(...a), convertGrid: o => GE().convertGrid(o), checks: { convertGrid: o => GE().checks.convertGrid(o) }, deleteWidget: o => deleteWidget(o), moveWidget: o => moveWidget(o) }));
    // refuses when deleting node (and what is inside it) would break the page: data views listening to it, page
    // variables naming it (as deleteWidget)
    function removable(P, node, where) {
        const { names, els } = subtree(node);
        const listeners = listenersOf(P, names, els);
        if (listeners.length) throw new Error(`${where}: ${listeners.map(l => `${l.node.label} listens to ${l.src.listenTarget}`).join(", ")}; delete ${listeners.length > 1 ? "those data views" : "that data view"} first, or let ${listeners.length > 1 ? "them" : "it"} listen to another widget`);
        const users = variableUsers(P, names, els);
        if (users.length) throw new Error(`${where}: ${users.join(", ")} refer to ${node.label} (or a widget in it) by name; change or delete them first`);
        return names;
    }

    function newCtx(P) {
        const vars = new Map((prop(P.doc, "variables") || []).map(v => [v.name, v]));
        return { qn: P.qn, names: I.names(P.names), params: new Map(), vars, count: { inputs: 0 }, untranslated: 0, ents: new Set(), page: P.doc, existing: true, scope: [], after: [] };
    }

    async function untranslatedLint(ctx) {
        const ls = await I.languages();
        if (ctx.untranslated && ls.length > 1) client.warn(`${ctx.qn}: ${ctx.untranslated} text(s) are not in every project language (${ls.join(", ")}); give them per language ({ "${ls[0]}": "...", "${ls[1]}": "..." }) or translate them with setTranslations (texts ${ctx.qn} --missing ${ls[1]})`);
    }

    // Existing grids / list views / Data grid 2 / galleries a new data view can listen to, as builder nodes.
    async function listenables(P) {
        const out = [];
        for (const n of P.nodes) {
            const el = n.el;
            let kind = null, sel = "Single", gridKind = "classic";
            if (el instanceof pages.DataGrid || el instanceof pages.TemplateGrid) {
                kind = "dataGrid";
                sel = el.selectionMode ? el.selectionMode.name : "Single";
            } else if (el instanceof pages.ListView) kind = "listView";
            else if (el instanceof cw.CustomWidget) {
                const s = I.valueOf(el.object, "itemSelection");
                if (!s) continue;
                kind = I.isGrid2(el) ? "dataGrid" : "listView";
                gridKind = "datagrid2";
                sel = s.selection ? s.selection.name : "None";
            }
            if (!kind || !n.name) continue;
            const { qn } = await containerEntity(P, n);
            out.push({ kind, name: n.name, gridKind, spec: { selection: sel }, existing: true, entQn: qn, where: n.name, widget: el });
        }
        return out;
    }

    // Grids and listening data views already on the page, as builder nodes (for "params": $grid1.selection, $dataView1).
    async function scopeOf(P, where) {
        const out = await listenables(P);
        for (const n of P.nodes) {
            if (!(n.el instanceof pages.DataView) || !n.name || !(n.el.dataSource instanceof pages.ListenTargetSource)) continue;
            const { qn } = await containerEntity(P, n);
            out.push({ kind: "dataView", source: "listen", name: n.name, existing: true, entQn: qn, widget: n.el, target: { name: n.el.dataSource.listenTarget } });
        }
        for (const e of out) e.ent = e.entQn ? await I.entityOf(e.entQn, where).catch(() => null) : null; // System entities are not in the project
        return out;
    }

    async function addWidgets(o) {
        const where = `addWidgets ${o.page}`;
        const P = await open(o.page, where);
        await I.prepareAssocs(null);
        return addWidgetsAt(P, place(P, o, where), o, where);
    }

    // addWidgets at a place found already (slot: { list, index, pos, dc }); also convertGrid, changeWidget template
    async function addWidgetsAt(P, slot, o, where) {
        const dc = await builderContext(P, slot.dc, where).catch(e => {
            // an unknown entity matters only for widgets that show attributes; say so when one does
            const needs = JSON.stringify(o.widgets || []).match(/"(input|textBox|textArea|checkBox|datePicker|radioButtons|dropDown|referenceSelector|comboBox)"|\{[A-Za-z_]\w*\}|"(save|cancel|delete)"|"(visible|editable)":\s*[{"][^tf]/i);
            if (needs) throw e;
            return null;
        });
        const nodes = [];
        const native = require("./theme-native").isNativeDoc(client, P.doc);
        const wasPlatform = I.setPlatform(native ? "native" : "web");
        let top;
        try {
            top = I.scan(o.widgets, "widgets", dc, nodes);
        } finally {
            I.setPlatform(wasPlatform);
        }
        if (native) require("./ops-native-ui").checkNativeNodes(nodes);
        if (!top.length) throw new Error(`${where}: 'widgets' is empty`);
        const ctx = newCtx(P);
        // default entity: the op's, else the page's only object parameter
        const params = (prop(P.doc, "parameters") || []).filter(p => p.parameterType instanceof datatypes.ObjectType); // also snippet parameters (createSnippet)
        for (const p of params) if (!ctx.params.has(p.parameterType.entityQualifiedName)) ctx.params.set(p.parameterType.entityQualifiedName, p);
        const dflt = o.entity || (params.length === 1 ? params[0].parameterType.entityQualifiedName : undefined);
        I.prepare(nodes);
        for (const n of nodes) if (["dataGrid", "listView", "gallery", "templateGrid"].includes(n.kind)) await I.listEntity(n, { dflt });
        for (const n of nodes) if (n.kind === "dataGrid") I.gridKind(n);
        for (const n of nodes) {
            if (!n.name) continue;
            if (P.names.includes(n.name)) throw new Error(`${n.where}: the name '${n.name}' is already used on ${P.qn}`);
            ctx.names.reserve(n.name, n.where);
        }
        for (const n of nodes) for (const t of n.tabs || []) {
            if (t.name && P.names.includes(t.name)) throw new Error(`${t.where}: the name '${t.name}' is already used on ${P.qn}`);
            if (t.name) ctx.names.reserve(t.name, t.where);
        }
        for (const n of nodes) if (!n.name && ["dataGrid", "listView", "gallery", "templateGrid"].includes(n.kind)) n.name = ctx.names.next(n.gridKind === "datagrid2" ? "dataGrid2_" : n.kind === "dataGrid" ? "grid" : n.kind);
        // data views: listen to a grid or list view (new or on the page), show an existing page parameter, the object
        // around them, an object over an association or from a flow
        const existing = await scopeOf(P, where);
        ctx.scope = [...nodes, ...existing.filter(e => !nodes.some(x => x.name === e.name))];
        await I.resolveSources(nodes, { dflt, extra: existing.filter(e => e.kind !== "dataView"), snippet: P.snippet || (P.block ? "building block" : P.template ? "page template" : false), ctx });
        // insert at the place, in order
        let index = slot.index;
        const at = { push: w => slot.list.splice(index++, 0, w) };
        const parts = [];
        for (const n of top) parts.push(await I.build(n, at, ctx));
        for (const f of ctx.after) f(); // parameter mappings: every widget they name exists now
        await untranslatedLint(ctx);
        return `${P.qn}: ${parts.join("; ")} -> ${slot.pos}${dc ? ` (in ${dc.name}, ${dc.ent.qualifiedName})` : ""}`;
    }

    async function changeWidget(o) {
        const where = `changeWidget ${o.page} ${o.widget}`;
        const P = await open(o.page, where);
        await I.prepareAssocs(null);
        const part = uiOf().gridPart(P, o.widget, where);
        if (part) {
            const gdc = part.grid.ctx && (o.visible !== undefined || o.dynamicClass !== undefined) ? await builderContext(P, part.grid.ctx, where).catch(() => null) : null;
            return `${P.qn}: ${await uiOf().changePart(part, o, gdc, where)}`;
        }
        const node = find(P, o.widget, where);
        const fields = CHANGE_FIELDS.filter(k => o[k] !== undefined);
        if (!fields.length) throw new Error(`${where}: give what to change: ${CHANGE_FIELDS.join(", ")}`);
        const ctx = { ...newCtx(P), lang: await defaultLanguage(), op: o };
        // {Attribute} and conditions use the data view or list view around the widget (for a column: around its grid)
        const needs = ["caption", "text", "label", "placeholder", "visible", "editable", "dynamicClass", "ariaLabel", "xpath", "columns", "headerFilters", "source", "paging", "emptyMessage", "sort", "export", "action", "onClick", "onChange", "onEnter", "onLeave", "onEnterKeyPress", "validation", "selectPage", "items"].some(k => o[k] !== undefined);
        if (["action", "onClick", "onChange", "onEnter", "onLeave", "onEnterKeyPress"].some(k => o[k] !== undefined)) ctx.scope = await scopeOf(P, where);
        const dc = needs && node.ctx ? await builderContext(P, node.ctx, where).catch(e => (/\{[A-Za-z_]|currentObject|"attribute"/.test(JSON.stringify(o)) ? Promise.reject(e) : null)) : null;
        const done = [];
        for (const f of fields) {
            const t = await CHANGE[f](P, node, o[f], dc, ctx, `${where}: ${f}`);
            if (t) done.push(t);
        }
        for (const f of ctx.after) f(); // parameter mappings
        // widgets added into lists of the widget (custom content columns, item templates, empty message): once the
        // fields above are done, as addWidgets on the page as it is now
        for (const f of ctx.later || []) done.push(await f());
        await untranslatedLint(ctx);
        return `${P.qn}: ${o.widget}: ${done.join("; ")}`;
    }

    // Names inside a node (itself included) and elements in its subtree.
    function subtree(node) {
        const names = [], els = new Set();
        const walk = n => {
            if (n.name) names.push(n.name);
            for (const c of n.children) walk(c);
        };
        walk(node);
        node.el.traverse(el => els.add(el));
        return { names, els };
    }

    // Page variables outside the subtree that name a widget inside it: [label]
    function variableUsers(P, names, els) {
        const out = [];
        P.doc.traverse(el => {
            if (!(el instanceof pages.PageVariable) || els.has(el)) return;
            const w = prop(el, "widget");
            if (w && names.includes(w.name)) {
                let c = el.container;
                while (c && !(c instanceof pages.Widget)) c = c.container;
                out.push(c ? c.name : "?");
            }
        });
        return [...new Set(out)];
    }

    async function deleteWidget(o) {
        const where = `deleteWidget ${o.page} ${o.widget}`;
        const P = await open(o.page, where);
        const node = find(P, o.widget, where);
        const el = node.el;
        const phs = [];
        el.traverse(x => x instanceof pages.Placeholder && phs.push(x.name));
        if (phs.length && !P.layout) throw new Error(`${where}: ${node.label} is a layout placeholder; it cannot be deleted from a page`);
        for (const ph of phs) {
            const users = placeholderUsers(P.qn, ph);
            if (users.length) throw new Error(`${where}: ${ph === node.name ? `placeholder ${ph}` : `${node.label} holds placeholder ${ph}, which`} is filled by ${users.length} page(s)/layout(s): ${users.slice(0, 5).join(", ")}${users.length > 5 ? ", ..." : ""}; move their content first or switch them to another layout (changePage "layout")`);
        }
        if (!(el instanceof pages.Widget || el instanceof pages.GridColumn || el instanceof pages.ControlBarItem || el instanceof pages.TabPage)) throw new Error(`${where}: a ${kindOf(el)} cannot be deleted by name`);
        if (el instanceof pages.TabPage && el.container.tabPages.length < 2) throw new Error(`${where}: ${node.label} is the only tab page of ${el.container.name}; delete the tab container instead`);
        const { names, els } = subtree(node);
        const listeners = listenersOf(P, names, els);
        if (listeners.length) throw new Error(`${where}: ${listeners.map(l => `${l.node.label} listens to ${l.src.listenTarget}`).join(", ")}; delete ${listeners.length > 1 ? "those data views" : "that data view"} first (deleteWidget ${listeners[0].node.label}), or let ${listeners.length > 1 ? "them" : "it"} listen to another widget in Studio Pro`);
        const users = variableUsers(P, names, els);
        if (users.length) throw new Error(`${where}: ${users.join(", ")} refer to ${node.label} (or a widget in it) by name; change or delete them first`);
        const left = names.flatMap(n => mentions(P, n).map(m => `$${n}: ${m}`)).filter(Boolean);
        const inside = names.length - 1;
        const kind = kindOf(el);
        el.delete();
        if (left.length) client.warn(`${where}: expressions still name it: ${left.slice(0, 3).join("; ")}; fix them in Studio Pro`);
        return `${P.qn}: deleted ${node.label} (${kind}${inside ? `, with ${inside} named widget(s) inside` : ""})`;
    }

    // Does the subtree use the object of the data view / list view around it (attributes, actions on it, conditions)?
    // A data container inside (or the widget itself) with its own source does not.
    function usesContext(node) {
        let uses = false;
        const walk = el => {
            if (uses || el instanceof cw.CustomWidgetType) return;
            if (!(el instanceof cw.CustomWidget) && (isDataContainer(el) || el instanceof pages.DataGrid)) {
                const src = prop(el, "dataSource");
                const free = src && CONTEXT_FREE.includes(src.structureTypeName.split("$")[1]) && !/CurrentObject/i.test(prop(src, "xPathConstraint") || "");
                if (free || (src instanceof pages.DataViewSource && src.sourceVariable)) return;
            }
            // a pluggable widget property linked to its own data source (a grid column, gallery content) is about its items
            if (el instanceof cw.WidgetProperty && el.type && el.type.valueType && el.type.valueType.dataSourceProperty) return;
            if (/CurrentObject/i.test(prop(el, "xPathConstraint") || "")) uses = true;
            if (el instanceof dm.AttributeRef || el instanceof pages.ClientTemplateParameter || el instanceof pages.PageVariable || el instanceof dm.IndirectEntityRef) uses = true;
            else if (el instanceof pages.ClientAction && !(el instanceof pages.NoClientAction || el instanceof pages.ClosePageClientAction || el instanceof pages.OpenLinkClientAction)) uses = true;
            else if (el instanceof pages.ConditionalSettings && (el.attribute || /currentObject/i.test(el.expression))) uses = true;
            for (const c of parts(el)) walk(c.el);
        };
        walk(node.el);
        return uses;
    }

    // Pages and layouts whose layout call fills placeholder name of layout qn (an argument for it): ["Module.Page"]
    function placeholderUsers(qn, name) {
        const out = [];
        const want = `${qn}.${name}`;
        for (const id of client.project.units.keys()) {
            const info = client.unitInfo(id);
            if (!/^Forms\$(Page|Layout|PageTemplate)$/.test(info.type)) continue;
            const u = client.project.read(id);
            const call = u.FormCall || (u.Content && u.Content.LayoutCall);
            if (call && (call.Arguments || []).some(a => a.Parameter === want)) out.push(client.label(id));
        }
        return out;
    }

    async function moveWidget(o) {
        const where = `moveWidget ${o.page} ${o.widget}`;
        if (o.into === undefined && o.after === undefined && o.before === undefined) throw new Error(`${where}: say where to: "into", "after" or "before"`);
        const P = await open(o.page, where);
        const node = find(P, o.widget, where);
        const el = node.el;
        if (!(el instanceof pages.Widget)) throw new Error(`${where}: a ${kindOf(el)} cannot be moved; only widgets move`);
        if (node.holder instanceof cw.WidgetValue) throw new Error(`${where}: ${node.label} is content of a pluggable widget; move it in Studio Pro`);
        const to = place(P, o, where);
        for (let p = to.node; p && !p.root; p = p.parent) if (p === node) throw new Error(`${where}: cannot move ${node.label} into itself`);
        if ((to.dc && to.dc.el) !== (node.ctx && node.ctx.el) && usesContext(node)) {
            const from = node.ctx ? node.ctx.name : "no data view";
            throw new Error(`${where}: ${node.label} shows or uses the object of ${from}; it can move only within ${node.ctx ? node.ctx.name : "places outside data views and list views"} (to: ${to.dc ? to.dc.name : "outside data views"})`);
        }
        if (to.sib === el) return `${P.qn}: ${node.label} stays where it is`;
        const fromSlot = slotOfNode(P, node, where);
        el.detach();
        const index = to.sib ? to.list.indexOf(to.sib) + (to.word === "after" ? 1 : 0) : to.list.length;
        to.list.splice(index, 0, el);
        return `${P.qn}: moved ${node.label} from ${fromSlot.label} to ${to.pos}`;
    }

    // ------------------------------------------------ the widgets listing

    async function describe(P, n) {
        const el = n.el;
        if (el instanceof pages.LayoutGridColumn) return `weight ${el.weight === -1 ? "auto" : el.weight}`;
        const bits = [kindOf(el)];
        // {1} back to {Attribute} as addWidgets / changeWidget take it
        const tmpl = async ct => (ct ? short((await textOf(ct.template)).replace(/\{(\d+)\}/g, (m, i) => {
            const p = ct.parameters[i - 1], ref = p && p.attributeRef;
            return ref && !prop(p, "expression") ? `{${pathText(ref)}}` : m;
        })) : "");
        if (el instanceof cw.CustomWidget && !I.isGrid2(el)) {
            // the attribute it edits (not linked to its own data source) and its label
            const bound = el.object ? el.object.properties.find(p => p.value && p.value.attributeRef && !(p.type && p.type.valueType.dataSourceProperty)) : null;
            if (bound) bits.push(bound.value.attributeRef.attributeQualifiedName.split(".").pop());
            const assoc = el.object ? el.object.properties.find(p => p.value && p.value.entityRef instanceof dm.IndirectEntityRef && p.value.entityRef.steps.length) : null;
            if (assoc) bits.push(`reference ${assoc.value.entityRef.steps.map(x => x.associationQualifiedName).join("/")}`);
            if (el.labelTemplate && sysProps(el).includes("Label")) bits.push(`label "${await tmpl(el.labelTemplate)}"`);
            const src = cwSource(el);
            if (src) {
                const { qn } = await containerEntity(P, n);
                if (qn) bits.push(`items ${qn}`);
            }
        } else if (el instanceof pages.DataView || el instanceof pages.ListView || el instanceof pages.DataGrid || el instanceof pages.TemplateGrid || el instanceof cw.CustomWidget) {
            const { qn } = await containerEntity(P, n);
            const src = el instanceof cw.CustomWidget ? cwSource(el) : prop(el, "dataSource");
            let how = "";
            if (src instanceof pages.ListenTargetSource) how = `listens to ${src.listenTarget}`;
            else if (src instanceof pages.MicroflowSource) how = `microflow ${src.microflowSettings.microflowQualifiedName}`;
            else if (src instanceof pages.NanoflowSource) how = `nanoflow ${src.nanoflowQualifiedName}`;
            else if (src && prop(src, "sourceVariable") && (src.sourceVariable.pageParameter || src.sourceVariable.snippetParameter)) how = `parameter ${(src.sourceVariable.pageParameter || src.sourceVariable.snippetParameter).name}`;
            else if (src && prop(src, "xPathConstraint") !== undefined) how = `database${src.xPathConstraint ? " " + short(src.xPathConstraint) : ""}`;
            else if (src && prop(src, "entityRef") instanceof dm.IndirectEntityRef) how = `over ${src.entityRef.steps.map(x => x.associationQualifiedName).join("/")}${n.ctx ? ` of ${n.ctx.name}` : ""}`;
            else if (src instanceof pages.DataViewSource && n.ctx) how = `the object of ${n.ctx.name}`;
            if (qn || how) bits.push(`${qn || "?"}${how ? ` (${how})` : ""}`);
            if (el instanceof pages.DataView) {
                const ed = prop(el, "editability");
                bits.push(ed ? (ed.name === "Never" ? "read-only" : ed.name === "Conditional" ? "editable (conditional)" : "editable") : el.editable === false ? "read-only" : "editable");
            }
            if (el instanceof pages.DataGrid) {
                const cols = [];
                for (const c of el.columns) cols.push(`${c.attributeRef ? pathText(c.attributeRef) : "?"} "${short(await textOf(c.caption))}"`);
                bits.push(`columns: ${cols.join(", ") || "none"}`);
            } else if (I.isGrid2(el)) {
                const colsProp = el.object.properties.find(p => p.type && p.type.key === "columns");
                const cols = [];
                for (const o of colsProp ? colsProp.value.objects : []) {
                    const a = I.valueOf(o, "attribute"), hd = I.valueOf(o, "header");
                    cols.push(`${a && a.attributeRef ? pathText(a.attributeRef) : "(custom)"} "${hd && hd.textTemplate ? short(await textOf(hd.textTemplate.template)) : ""}"`);
                }
                bits.push(`columns: ${cols.join(", ") || "none"}`);
            }
        } else if (el instanceof pages.DynamicText) bits.push(`"${await tmpl(el.content)}"${el.renderMode.name !== "Text" ? " " + el.renderMode.name : ""}`);
        else if (el instanceof pages.ActionButton || el instanceof pages.ControlBarItem) {
            const cap = prop(el, "caption");
            bits.push(`"${cap instanceof texts.Text ? short(await textOf(cap)) : await tmpl(cap)}"`);
            const a = prop(el, "action");
            if (a && !(a instanceof pages.NoClientAction)) bits.push(a instanceof pages.PageClientAction ? `opens ${a.pageSettings.pageQualifiedName}` : a instanceof pages.MicroflowClientAction ? `calls ${a.microflowSettings.microflowQualifiedName}` : a.structureTypeName.split("$")[1].replace(/ClientAction$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
        } else if (el instanceof pages.AttributeWidget || el instanceof pages.ReferenceSelector) {
            const ref = prop(el, "attributeRef");
            const path = ref && ref.entityRef && ref.entityRef.steps ? ref.entityRef.steps.map(x => x.associationQualifiedName.split(".").pop()).join("/") : "";
            if (ref) bits.push((path ? path + "/" : "") + ref.attributeQualifiedName.split(".").pop());
            if (el.labelTemplate) bits.push(`label "${await tmpl(el.labelTemplate)}"`);
            if (el.editable && el.editable.name !== "Always") bits.push(el.editable.name === "Never" ? "read-only" : "editable (conditional)");
        } else if (el instanceof pages.Label || el instanceof pages.GridColumn || el instanceof pages.TabPage) {
            const cap = prop(el, "caption");
            if (cap instanceof texts.Text) bits.push(`"${short(await textOf(cap))}"`);
            if (el instanceof pages.GridColumn && el.attributeRef) bits.push(pathText(el.attributeRef));
        } else if (el instanceof pages.GroupBox) {
            if (el.caption) bits.push(`"${await tmpl(el.caption)}"`);
            if (el.collapsible && el.collapsible.name !== "No") bits.push(el.collapsible.name === "YesInitiallyCollapsed" ? "collapsible (collapsed)" : "collapsible");
        } else if (el instanceof pages.TabContainer) bits.push(`${el.tabPages.length} tab(s)`);
        else if (el instanceof pages.StaticImageViewer) bits.push(el.imageQualifiedName || "no image");
        else if (pages.DynamicImageViewer && el instanceof pages.DynamicImageViewer) {
            const src = el.dataSource, er = src && prop(src, "entityRef");
            bits.push(er instanceof dm.IndirectEntityRef ? `image over ${er.steps.map(x => x.associationQualifiedName).join("/")}` : "image of the object around it");
        }
        else if (el instanceof pages.SnippetCallWidget) bits.push(el.snippetCall ? el.snippetCall.snippetQualifiedName : "?");
        if (el instanceof cw.CustomWidget && sysProps(el).includes("Editability") && el.editable && el.editable.name !== "Always") bits.push(el.editable.name === "Never" ? "read-only" : "editable (conditional)");
        const cv = prop(el, "conditionalVisibilitySettings");
        if (cv) bits.push(cv.attributeQualifiedName ? `visible if ${cv.attributeQualifiedName.split(".").pop()} = ${cv.conditions.filter(c => c.editableVisible).map(c => c.attributeValue).join(" or ")}` : cv.expression ? `visible if ${short(cv.expression)}` : "visibility by role");
        const ap = prop(el, "appearance");
        if (ap && ap.class) bits.push(`class "${short(ap.class)}"`);
        if (ap && ap.designProperties && ap.designProperties.length) bits.push(`design ${ap.designProperties.map(designText).join("; ")}`);
        return bits.join(", ");
    }

    const designText = d => {
        const v = d.value;
        if (v instanceof pages.OptionDesignPropertyValue) return `${d.key}: ${v.option}`;
        if (v instanceof pages.CompoundDesignPropertyValue) return `${d.key}: ${v.properties.map(designText).join(", ")}`;
        if (v instanceof pages.CustomDesignPropertyValue) return `${d.key}: ${v.value}`;
        return d.key;
    };
    const INTO = el => (pages.ScrollContainer && el instanceof pages.ScrollContainer) || el instanceof pages.TemplateGrid || el instanceof pages.LayoutCallArgument || el instanceof pages.LayoutGridColumn || el instanceof pages.DivContainer || el instanceof pages.GroupBox || el instanceof pages.TabPage || el instanceof pages.ListView || el instanceof pages.DataView;

    async function widgets(qn) {
        const P = await open(qn, "widgets").catch(e => {
            throw new Error(/^widgets: /.test(e.message) ? e.message : `widgets: ${e.message}`);
        });
        const head = [];
        if (P.layout) head.push(`${P.qn} (layout; placeholders: ${P.nodes.filter(n => n.el instanceof pages.Placeholder).map(n => `${n.name}${placeholderUsers(P.qn, n.name).length ? ` (filled by ${placeholderUsers(P.qn, n.name).length} page(s))` : ""}`).join(", ") || "none"}${P.doc.content.layoutCall ? `; based on ${P.doc.content.layoutCall.layoutQualifiedName}` : ""})`);
        else if (P.snippet) head.push(`${P.qn} (snippet${P.doc.parameters.length ? `; parameters: ${P.doc.parameters.map(p => `${p.name} (${p.parameterType && p.parameterType.entityQualifiedName ? p.parameterType.entityQualifiedName : "?"})`).join(", ")}` : ""})`);
        else head.push(`${P.qn} (page; layout ${P.doc.layoutCall ? P.doc.layoutCall.layoutQualifiedName : "?"}; ${P.doc.parameters.length ? `parameters: ${P.doc.parameters.map(p => `${p.name} (${p.parameterType instanceof datatypes.ObjectType ? p.parameterType.entityQualifiedName : p.parameterType.structureTypeName.split("$")[1].replace("Type", "")})`).join(", ")}` : "no parameters"})`);
        head.push(`"widget", "after" and "before" take a name below; "into" takes one marked [into] or a column path; {Entity} = what inputs and {Attribute} texts inside use.`);
        const lines = [];
        const walk = async (n, depth) => {
            const el = n.el;
            let line = "  ".repeat(depth) + (n.label || "(no name)");
            if (!n.placeholder) line += "  " + (await describe(P, n));
            if (INTO(el)) line += el instanceof pages.DataView ? `  [into] (footer: "slot": "footer")` : "  [into]";
            else if (el instanceof cw.CustomWidget && plLists(el).length) line += `  [into] (slot: ${plLists(el).map(l => `"${l.key}"`).slice(0, 8).join(", ")}${plLists(el).length > 8 ? ", ..." : ""})`;
            if (isDataContainer(el)) {
                const { qn: e } = await containerEntity(P, n);
                if (e && (el instanceof pages.DataView || el instanceof pages.ListView)) line += `  {${e}}`;
            }
            lines.push(line);
            const kids = n.children;
            if (el instanceof pages.DataView && el.footerWidgets.length) {
                for (const c of kids.filter(c => c.prop !== "footerWidgets")) await walk(c, depth + 1);
                lines.push("  ".repeat(depth + 1) + "footer:");
                for (const c of kids.filter(c => c.prop === "footerWidgets")) await walk(c, depth + 2);
            } else for (const c of kids) await walk(c, depth + 1);
        };
        for (const c of P.root.children) await walk(c, 0);
        if (!lines.length) lines.push("(no widgets)");
        // elements of this page that the Model SDK does not know (kept as they are, not listed)
        const unknown = new Set();
        const scan = o => {
            if (Array.isArray(o)) return o.forEach(scan);
            if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
            if (o.$Type && !client.schema.info(client.schema.sdkType(o.$Type))) unknown.add(o.$Type);
            for (const v of Object.values(o)) if (v && typeof v === "object") scan(v);
        };
        scan(client.project.read(P.doc.id));
        if (unknown.size) lines.push(`Note: ${[...unknown].join(", ")} on this page ${unknown.size > 1 ? "are" : "is"} not known to the Model SDK: not listed, kept as ${unknown.size > 1 ? "they are" : "it is"}.`);
        return [...head, ...lines].join("\n");
    }

    // ------------------------------------------------ checks after apply (fresh model)

    // Later ops of a plan that touch the same page and widget: only the final state is checked.
    const namesIn = specs => (specs || []).flatMap(s => (s && typeof s === "object" ? [s.name, ...namesIn(s.widgets), ...namesIn(s.footer), ...[].concat(s.rows || [{ columns: s.columns }]).flatMap(r => ((r && r.columns) || []).flatMap(c => (c && typeof c === "object" ? namesIn(c.widgets) : [])))] : [])).filter(Boolean);
    const touched = o => [o.widget, o.name, o.after, o.before, o.into && String(o.into).split("/")[0], ...namesIn(o.widgets)].filter(Boolean).map(String);

    async function textIs(t, value) {
        return (await textOf(t)) === template(value).text;
    }

    // The list into/after/before name in the saved page (or a message why there is none).
    function expectedList(P, o) {
        try {
            if (o.into !== undefined) return container(P, o.into, o.slot, "check");
            const sib = o.after !== undefined ? o.after : o.before;
            if (sib !== undefined) return P.byName.has(String(sib)) ? slotOfNode(P, P.byName.get(String(sib)), "check") : `${P.qn} has no widget ${sib}`;
            return defaultContainer(P, "check");
        } catch (e) {
            return e.message;
        }
    }

    const checks = {
        async addWidgets(o) {
            const P = await open(o.page, "check");
            const r = [];
            for (const n of namesIn(o.widgets)) if (!P.byName.has(n)) r.push(`${P.qn} has no widget ${n}`);
            const slot = expectedList(P, o);
            if (typeof slot === "string") return r.concat(slot);
            const kinds = (o.widgets || []).length;
            if (slot.list.length < kinds) r.push(`${slot.label} holds ${slot.list.length} widget(s), fewer than the ${kinds} added`);
            for (const s of o.widgets || []) {
                const n = s && s.name && P.byName.get(String(s.name));
                if (n && slot.list.indexOf(n.el) < 0) r.push(`${s.name} is not in ${slot.label}`);
            }
            return r;
        },
        async changeWidget(o) {
            const P = await open(o.page, "check");
            const name = o.name !== undefined ? String(o.name) : String(o.widget);
            const part = uiOf().gridPart(P, name, "check");
            const node = part ? { el: part.el } : P.byName.get(name);
            if (!node) return [`${P.qn} has no widget ${name}`];
            const w = node.el, r = [];
            const say = (ok, what) => ok || r.push(`${P.qn} ${name}: ${what}`);
            const al = v => ({ none: "None", start: "Start", top: "Start", left: "Start", center: "Center", middle: "Center", end: "End", bottom: "End", right: "End" })[String(v).toLowerCase()];
            if (o.dynamicClass !== undefined) say(w.appearance.dynamicClasses === String(o.dynamicClass).trim(), `dynamic class is "${w.appearance.dynamicClasses}"`);
            if (o.verticalAlignment !== undefined) say(w.verticalAlignment.name === al(o.verticalAlignment), `vertical alignment is ${w.verticalAlignment.name}`);
            if (o.horizontalAlignment !== undefined) say(w.horizontalAlignment.name === al(o.horizontalAlignment), `horizontal alignment is ${w.horizontalAlignment.name}`);
            if (o.spacing !== undefined) say(w.spacingBetweenColumns === bool(o.spacing, true), `spacing is ${w.spacingBetweenColumns}`);
            if (part) {
                for (const k of ["class", "style"]) if (o[k] !== undefined) say(w.appearance[k] === String(o[k]), `${k} is "${w.appearance[k]}"`);
                if (o.weight !== undefined) say(w.weight === (/^auto$/i.test(String(o.weight)) ? -1 : Number(o.weight)), `weight is ${w.weight}`);
                return r;
            }
            if (o.tabIndex !== undefined) say(w.tabIndex === Number(o.tabIndex), `tab index is ${w.tabIndex}`);
            if (o.icon !== undefined) say(/^none$/i.test(String(o.icon)) || o.icon === null || o.icon === "" ? !w.icon : !!w.icon, `icon is ${w.icon ? w.icon.structureTypeName : "none"}`);
            if (o.renderType !== undefined) say(w.renderType.name.toLowerCase() === String(o.renderType).toLowerCase(), `render type is ${w.renderType.name}`);
            if (o.ariaRole !== undefined) say(w.ariaRole.name.toLowerCase() === String(o.ariaRole).toLowerCase(), `aria role is ${w.ariaRole.name}`);
            if (o.renderMode !== undefined) say(w.renderMode.name.toLowerCase() === String(o.renderMode).toLowerCase(), `render mode is ${w.renderMode.name}`);
            if (o.screenReaderHidden !== undefined) say(w.screenReaderHidden === bool(o.screenReaderHidden, true), `screenReaderHidden is ${w.screenReaderHidden}`);
            if (o.ariaRequired !== undefined) say(w.ariaRequired === bool(o.ariaRequired, true), `ariaRequired is ${w.ariaRequired}`);
            if (typeof o.tooltip === "string") say(await textIs(w.tooltip, o.tooltip), `tooltip is not "${o.tooltip}"`);
            if (typeof o.ariaLabel === "string") say(o.ariaLabel === "" ? !w.screenReaderLabel : w.screenReaderLabel && (await textIs(w.screenReaderLabel.template, o.ariaLabel)), `screen reader text is not "${o.ariaLabel}"`);
            if (typeof o.alt === "string") say(await textIs(w.alternativeText.template, o.alt), `alt text is not "${o.alt}"`);
            if (o.iconOnly === true) say(w.caption.template.translations.every(x => !x.text), "the caption is not empty");
            if (o.name !== undefined && o.name !== o.widget && P.byName.has(String(o.widget))) r.push(`${P.qn} still has ${o.widget}`);
            if (o.caption !== undefined) {
                const c = w instanceof pages.Label ? w.caption : prop(w, "caption");
                say(await textIs(c instanceof texts.Text ? c : c && c.template, o.caption), `caption is not "${o.caption}"`);
            }
            if (o.text !== undefined) say(await textIs(w instanceof pages.DynamicText ? w.content.template : w.caption, o.text), `text is not "${o.text}"`);
            if (o.label !== undefined) say(o.label === "" ? !w.labelTemplate : w.labelTemplate && (await textIs(w.labelTemplate.template, o.label)), `label is not "${o.label}"`);
            if (o.placeholder !== undefined) say(await textIs(w.placeholderTemplate.template, o.placeholder), `placeholder is not "${o.placeholder}"`);
            if (o.editable !== undefined) {
                const on = typeof o.editable === "boolean" || /^(true|false)$/.test(String(o.editable)) ? bool(o.editable, true) : "Conditional";
                const ed = w instanceof pages.DataView ? (has(w, "editability") ? w.editability.name : w.editable ? "Always" : "Never") : w.editable.name;
                say(ed === (on === true ? "Always" : on === false ? "Never" : on), `editable is ${ed}`);
            }
            if (o.visible !== undefined) {
                const cv = w.conditionalVisibilitySettings;
                if (o.visible === true || o.visible === "true") say(!cv, "still has a visibility condition");
                else if (typeof o.visible === "string" || o.visible === false || o.visible === "false") say(cv && cv.expression === String(o.visible), "visibility expression differs");
                else say(cv && (o.visible.expression !== undefined ? cv.expression === String(o.visible.expression) : String(o.visible.attribute).includes("/") ? !!cv.expression : (cv.attributeQualifiedName || "").endsWith("." + o.visible.attribute)), "visibility condition differs");
            }
            for (const k of ["class", "style"]) if (o[k] !== undefined) say(w.appearance[k] === String(o[k]), `${k} is "${w.appearance[k]}"`);
            if (o.design && typeof o.design === "object") for (const [k, v] of Object.entries(o.design)) if (v !== null && v !== false && typeof v !== "object") say(w.appearance.designProperties.some(d => d.key.toLowerCase() === k.toLowerCase() || (d.value instanceof pages.CompoundDesignPropertyValue)), `design ${k} missing`);
            if (o.textStyle !== undefined) say(w.renderMode.name.toLowerCase() === String(o.textStyle).toLowerCase(), `text style is ${w.renderMode.name}`);
            if (o.buttonStyle !== undefined) say(w.buttonStyle.name.toLowerCase() === String(o.buttonStyle).toLowerCase(), `button style is ${w.buttonStyle.name}`);
            if (o.xpath !== undefined) {
                const src = w instanceof cw.CustomWidget ? cwSource(w) : w.dataSource;
                say(src && src.xPathConstraint === String(o.xpath), "XPath differs");
            }
            for (const k of ["action", "onClick", "onChange"]) {
                if (o[k] === undefined) continue;
                if (k === "onClick" && w instanceof pages.DivContainer) {
                    say(w.onClickAction && !(w.onClickAction instanceof pages.NoClientAction) === !(o[k] === null || o[k] === "" || /^none$/i.test(String(o[k]))), "on click differs");
                    continue;
                }
                const a = k === "action" ? w.action : k === "onChange" && !(w instanceof cw.CustomWidget) ? w.onChangeAction : ((w.object.properties.find(p => p.type && p.type.key === (k === "onClick" ? "onClick" : "onChangeEvent")) || {}).value || {}).action;
                const spec = typeof o[k] === "string" ? { action: o[k] } : o[k] || {};
                const target = spec.page || spec.microflow || spec.nanoflow;
                const named = a && (a.pageSettings ? a.pageSettings.pageQualifiedName : a.microflowSettings ? a.microflowSettings.microflowQualifiedName : prop(a, "nanoflowQualifiedName"));
                say(a && !(a instanceof pages.NoClientAction) && (!target || named === target), `${k} is not ${spec.action}${target ? " " + target : ""}`);
            }
            for (const k of ["onEnter", "onLeave", "onEnterKeyPress"]) if (o[k] !== undefined) say(prop(w, EVENT_PROPS[k]) && !(w[EVENT_PROPS[k]] instanceof pages.NoClientAction), `${k} is not set`);
            if (o.required !== undefined) say(bool(o.required, false) ? w.validation.expression === "$value != empty" : !w.validation.expression, `required is not ${o.required}`);
            if (o.validation && o.validation.expression !== undefined) say(w.validation.expression === String(o.validation.expression).trim(), "validation expression differs");
            if (o.orientation !== undefined && w instanceof pages.SimpleMenuBar) say(w.orientation.name.toLowerCase() === String(o.orientation).toLowerCase(), `orientation is ${w.orientation.name}`);
            else if (o.orientation !== undefined) say(/^vertical$/i.test(String(o.orientation)) ? w.labelWidth === 0 : w.labelWidth > 0, `orientation is not ${o.orientation}`);
            if (o.labelWidth !== undefined) say(w.labelWidth === Number(o.labelWidth), `label width is ${w.labelWidth}`);
            if (o.showFooter !== undefined) say(w.showFooter === bool(o.showFooter, true), `showFooter is ${w.showFooter}`);
            if (o.readOnlyStyle !== undefined) say(String(w.readOnlyStyle.name).toLowerCase() === String(o.readOnlyStyle).toLowerCase(), `read-only style is ${w.readOnlyStyle.name}`);
            if (o.selectPage !== undefined) say(w.selectPageSettings && w.selectPageSettings.pageQualifiedName === String(o.selectPage), "select page differs");
            if (o.editable !== undefined && w instanceof pages.ListView) say(w.editable === bool(o.editable, false), `editable is ${w.editable}`);
            if (o.selection !== undefined) {
                const sel = w instanceof cw.CustomWidget ? ((I.valueOf(w.object, "itemSelection") || {}).selection || { name: "?" }).name : w.selectionMode ? w.selectionMode.name : "?";
                say(sel.toLowerCase() === String(o.selection).toLowerCase() || (sel === "Multi" && /^multiple$/i.test(String(o.selection))), `selection is ${sel}`);
            }
            if (o.emptyMessage !== undefined) {
                const ph = I.valueOf(w.object, "emptyPlaceholder");
                say(o.emptyMessage === "" || o.emptyMessage === null ? !ph.widgets.length : ph.widgets.length === 1, "empty message differs");
            }
            if (Array.isArray(o.template)) {
                const list = w instanceof pages.ListView ? w.widgets : w instanceof pages.TemplateGrid ? w.contents.widgets : I.valueOf(w.object, "content").widgets;
                say(list.length === o.template.length, `holds ${list.length} item widget(s), not ${o.template.length}`);
            }
            if (o.paging && typeof o.paging === "object" && o.paging.pageSize !== undefined) {
                const n = w instanceof cw.CustomWidget ? Number(I.valueOf(w.object, "pageSize").primitiveValue) : w instanceof pages.ListView ? w.pageSize : w.numberOfRows;
                say(n === Number(o.paging.pageSize), `page size is ${n}`);
            }
            if (o.source !== undefined) {
                const src = w instanceof cw.CustomWidget ? cwSource(w) : w.dataSource;
                const want = String(typeof o.source === "string" ? o.source : o.source.source || (o.source.microflow ? "microflow" : o.source.nanoflow ? "nanoflow" : o.source.association ? "association" : "database")).toLowerCase();
                const is = src instanceof pages.MicroflowSource ? "microflow" : src instanceof pages.NanoflowSource ? "nanoflow" : src instanceof pages.AssociationSource ? "association" : src && prop(src, "xPathConstraint") !== undefined ? "database" : "?";
                say(is === (want === "xpath" ? "database" : want), `source is ${is}`);
            }
            if (o.columns && Array.isArray(o.columns.add)) {
                const attrs = [];
                if (w instanceof pages.DataGrid) for (const c of w.columns) attrs.push(c.attributeRef ? c.attributeRef.attributeQualifiedName.split(".").pop() : null);
                else for (const c of (w.object.properties.find(p => p.type.key === "columns") || { value: { objects: [] } }).value.objects) attrs.push(((I.valueOf(c, "attribute") || {}).attributeRef || { attributeQualifiedName: "" }).attributeQualifiedName.split(".").pop());
                for (const a of o.columns.add) {
                    const n = typeof a === "string" ? a : a && a.attribute;
                    if (n === undefined) continue; // dynamic text / custom content
                    say(attrs.includes(String(n).split("/").pop()), `has no column for ${n}`);
                }
            }
            r.push(...(await WE().check(P, w, o)));
            return r;
        },
        async deleteWidget(o) {
            const P = await open(o.page, "check");
            return P.byName.has(String(o.widget)) ? [`${P.qn} still has ${o.widget}`] : [];
        },
        async moveWidget(o) {
            const P = await open(o.page, "check");
            const node = P.byName.get(String(o.widget));
            if (!node) return [`${P.qn} has no widget ${o.widget}`];
            const to = expectedList(P, o);
            if (typeof to === "string") return [to];
            const own = slotOfNode(P, node, "check");
            const r = [];
            if (own.list !== to.list) r.push(`${o.widget} is in ${own.label}, not in ${to.label}`);
            const sib = o.after !== undefined ? o.after : o.before;
            if (sib !== undefined) {
                const s = P.byName.get(String(sib));
                const i = own.list.indexOf(node.el), j = s ? own.list.indexOf(s.el) : -2;
                if (j < 0 || i !== j + (o.after !== undefined ? 1 : -1)) r.push(`${o.widget} is not ${o.after !== undefined ? "after" : "before"} ${sib}`);
            }
            return r;
        }
    };

    // ------------------------------------------------ page settings and parameters

    // Every PageSettings (button, menu item, home page, grid button, microflow show page) that opens qn: [{ ps, where }]
    async function callersOf(qn) {
        const ids = new Set();
        const hit = v => typeof v === "string" && v === qn;
        const scan = (o, id) => {
            if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
            if (Array.isArray(o)) return o.forEach(x => scan(x, id));
            for (const [k, v] of Object.entries(o)) if (k[0] !== "$" && (hit(v) || (v && typeof v === "object" && scan(v, id) === true))) ids.add(id);
        };
        for (const id of client.project.units.keys()) scan(client.project.read(id), id);
        const out = [];
        for (const u of model.allUnits()) {
            const isNew = !client.project.units.has(u.id);
            if (!ids.has(u.id) && !(isNew || u.isLoaded)) continue;
            if (!u.isLoadable) continue;
            let doc;
            try {
                doc = u.isLoaded ? u : await u.load();
            } catch (e) {
                continue;
            }
            doc.traverse(el => {
                if (el instanceof pages.PageSettings && el.pageQualifiedName === qn) out.push({ ps: el, where: doc.qualifiedName || doc.structureTypeName.split("$")[1] });
            });
        }
        return out;
    }

    async function changePage(o) {
        const where = `changePage ${o.page}`;
        const page = await h.get(o.page);
        if (!(page instanceof pages.Page)) throw new Error(`${where}: '${o.page}' is not a page`);
        const out = [];
        if (o.title !== undefined) {
            await I.textAll(page.title, o.title, { untranslated: 0 });
            out.push(`title "${o.title}"`);
        }
        if (o.url !== undefined) out.push(await pageUrl(page, o.url, where));
        if (o.variables !== undefined) out.push(await I.pageVariables(page, o.variables, where, { qn: page.qualifiedName }));
        if (o.design !== undefined) out.push(`design ${design.apply(sdk, model, page, design.resolve(client.project.dir, page, o.design, `${where}: design`, require("./theme-native").isNativeDoc(client, page) ? "native" : "web"), client.warn) || "unchanged"}`);
        if (o.class !== undefined || o.style !== undefined) out.push(uiOf().pageLook(page, o, where));
        if (o.layout !== undefined) out.push(await switchLayout(page, String(o.layout), where));
        for (const [k, prop] of [["popupWidth", "popupWidth"], ["popupHeight", "popupHeight"]]) {
            if (o[k] === undefined) continue;
            const n = Number(o[k]);
            if (!Number.isInteger(n) || n < 0) throw new Error(`${where}: ${k} is a whole number of pixels (0 = auto)`);
            if (page[prop] !== n) page[prop] = n;
            out.push(`${k} ${n || "auto"}`);
        }
        if (o.popupResizable !== undefined) {
            page.popupResizable = bool(o.popupResizable, true);
            out.push(`pop-up ${page.popupResizable ? "" : "not "}resizable`);
        }
        const params = ["addParameter", "removeParameter", "renameParameter"].filter(k => o[k] !== undefined);
        const callers = params.length ? await callersOf(page.qualifiedName) : [];
        const list = cs => [...new Set(cs.map(c => c.where))].join(", ");
        if (o.renameParameter !== undefined) {
            const r = o.renameParameter;
            if (!r || typeof r !== "object" || r.from === undefined || r.to === undefined) throw new Error(`${where}: renameParameter is { "from": "Old", "to": "New" }`);
            const p = page.parameters.find(x => x.name === String(r.from)) || fail(`${where}: no parameter '${r.from}'`, String(r.from), page.parameters.map(x => x.name));
            validName(String(r.to), "parameter name");
            if (page.parameters.some(x => x.name === String(r.to))) throw new Error(`${where}: a parameter '${r.to}' exists already`);
            p.name = String(r.to);
            if (has(page, "url") && page.url.includes(`{${r.from}/`)) page.url = page.url.split(`{${r.from}/`).join(`{${r.to}/`);
            out.push(`parameter ${r.from} -> ${r.to}${callers.length ? ` (callers follow: ${list(callers)})` : ""}`);
        }
        if (o.removeParameter !== undefined) {
            const name = String(o.removeParameter);
            const p = page.parameters.find(x => x.name === name) || fail(`${where}: no parameter '${name}'`, name, page.parameters.map(x => x.name));
            const users = [];
            page.traverse(el => {
                if (el instanceof pages.PageVariable && el.pageParameter === p) {
                    let w = el.container;
                    while (w && !(w instanceof pages.Widget)) w = w.container;
                    users.push(w ? w.name : el.container.structureTypeName.split("$")[1]);
                }
            });
            if (has(page, "url") && page.url.includes(`{${name}/`)) users.push(`the page URL ${page.url}`);
            if (users.length) throw new Error(`${where}: parameter ${name} is used by ${[...new Set(users)].join(", ")} on the page; change or delete those widgets first`);
            const mapped = [];
            for (const c of callers) for (const m of [...c.ps.parameterMappings]) if (m.parameter === p || m.parameterQualifiedName === `${page.qualifiedName}.${name}`) {
                m.delete();
                mapped.push(c.where);
            }
            p.delete();
            out.push(`parameter ${name} removed${mapped.length ? ` (mappings removed in ${[...new Set(mapped)].join(", ")})` : ""}`);
        }
        if (o.addParameter !== undefined) {
            const a = o.addParameter;
            if (!a || typeof a !== "object" || !a.name || !a.type) throw new Error(`${where}: addParameter is { "name": "Order", "type": "Module.Entity" }`);
            for (const k of Object.keys(a)) if (!["name", "type", "required"].includes(k)) fail(`${where}: unknown field '${k}' in addParameter`, k, ["name", "type", "required"]);
            validName(String(a.name), "parameter name");
            if (page.parameters.some(x => x.name === String(a.name))) throw new Error(`${where}: a parameter '${a.name}' exists already`);
            const required = bool(a.required, true);
            const p = pages.PageParameter.createIn(page);
            const canOptional = (() => {
                try {
                    return p.isRequired !== undefined;
                } catch (e) {
                    return false;
                }
            })();
            if (!required && !canOptional) {
                p.delete();
                throw new Error(`${where}: optional page parameters need Mendix 11.5+`);
            }
            if (callers.length && required) {
                p.delete();
                throw new Error(`${where}: ${page.qualifiedName} is opened by ${list(callers)}; a new required parameter would break them${canOptional ? ` (give "required": false, or add it in Studio Pro and map it in each caller)` : " (add it in Studio Pro and map it in each caller)"}`);
            }
            p.name = String(a.name);
            const ent = await I.entityOf(String(a.type), where);
            const t = datatypes.ObjectType.create(model);
            t.entity = ent;
            p.parameterType = t;
            if (canOptional) p.isRequired = required;
            out.push(`parameter ${a.name} (${ent.qualifiedName}${required ? "" : ", optional"})`);
        }
        if (!out.length) throw new Error(`${where}: nothing to change (fields: ${Object.keys(PAGE_EDIT_OPS.changePage.fields).filter(k => k !== "page").join(", ")})`);
        return `${page.qualifiedName}: ${out.join(", ")}`;
    }

    // Switches page to layout qn: each placeholder argument goes to the placeholder of the same name; refused when one
    // with content has none there (Studio Pro would drop that content).
    async function switchLayout(page, qn, where) {
        const all = model.allLayouts().map(l => l.qualifiedName);
        if (!all.includes(qn)) fail(`${where}: no layout '${qn}'`, qn, all);
        const lay = await h.get(qn);
        const call = page.layoutCall;
        if (!call) throw new Error(`${where}: ${page.qualifiedName} has no layout call`);
        const was = call.layoutQualifiedName;
        if (was === qn) return `layout ${qn} (unchanged)`;
        if (!(lay.content instanceof pages.WebLayoutContent)) throw new Error(`${where}: ${qn} is a native layout; a web page keeps a web layout`);
        const phs = new Map();
        lay.traverse(el => el instanceof pages.Placeholder && !phs.has(el.name) && phs.set(el.name, el));
        const lost = [], moved = [], dropped = [];
        for (const a of call.arguments) {
            const name = String(a.parameterQualifiedName || "").split(".").pop();
            if (phs.has(name)) continue;
            if (a.widgets.length) lost.push(`${name} (${a.widgets.length} widget(s): ${a.widgets.slice(0, 4).map(w => w.name || w.structureTypeName.split("$")[1]).join(", ")})`);
        }
        if (lost.length) throw new Error(`${where}: ${qn} has no placeholder for ${lost.join("; ")}; its placeholders are ${[...phs.keys()].join(", ") || "none"}. Move that content into one of them first (moveWidget into "${[...phs.keys()][0] || "Main"}"), or delete it`);
        for (const a of [...call.arguments]) {
            const name = String(a.parameterQualifiedName || "").split(".").pop();
            if (phs.has(name)) {
                a.parameter = phs.get(name);
                moved.push(name);
            } else {
                a.delete();
                dropped.push(name);
            }
        }
        call.layout = lay;
        const popup = t => /Popup/.test(t);
        const oldLay = model.allLayouts().find(l => l.qualifiedName === was);
        const oldType = oldLay && oldLay.isLoaded && oldLay.content ? oldLay.content.layoutType.name : "";
        const newType = lay.content.layoutType.name;
        if (oldType && popup(oldType) !== popup(newType)) client.warn(`${where}: ${was} is a ${oldType} layout and ${qn} a ${newType} one; check how callers open ${page.qualifiedName} (pop-up or full page) in Studio Pro`);
        return `layout ${was} -> ${qn} (placeholders ${moved.join(", ") || "none"} kept${dropped.length ? `; empty ${dropped.join(", ")} dropped` : ""})`;
    }

    // URL of a page ("" = none): no leading slash, {Param/Attribute} parts name a parameter, unique among the pages
    async function pageUrl(page, v, where) {
        const url = String(v).trim().replace(/^\/+/, "");
        if (!has(page, "url")) throw new Error(`${where}: this Mendix version has no page URL`);
        if (url && !/^[A-Za-z0-9_\-./{}]+$/.test(url)) throw new Error(`${where}: url '${url}' may hold letters, digits, - _ . / and {Parameter/Attribute}`);
        for (const m of url.matchAll(/\{([^}]*)\}/g)) {
            const [pn] = m[1].split("/");
            if (!page.parameters.some(p => p.name === pn)) fail(`${where}: url part {${m[1]}} names no parameter of the page`, pn, page.parameters.map(p => p.name));
        }
        if (url) for (const other of model.allPages()) {
            if (other === page || other.id === page.id) continue;
            const o = other.isLoaded ? other : null;
            const raw = !o && client.project.units.has(other.id) ? client.project.read(other.id).Url : o ? o.url : null;
            if (raw && raw.replace(/^\/+/, "").toLowerCase() === url.toLowerCase()) throw new Error(`${where}: url '${url}' is used by ${other.qualifiedName} already`);
        }
        if (page.url !== url) page.url = url;
        return url ? `url ${url}` : "no url";
    }

    Object.assign(checks, {
        async changePage(o) {
            const page = await h.get(o.page);
            const r = [];
            if (o.url !== undefined && page.url !== String(o.url).trim().replace(/^\/+/, "")) r.push(`url is '${page.url}'`);
            if (o.popupWidth !== undefined && page.popupWidth !== Number(o.popupWidth)) r.push(`popupWidth is ${page.popupWidth}`);
            if (o.addParameter && !page.parameters.some(p => p.name === String(o.addParameter.name))) r.push(`no parameter ${o.addParameter.name}`);
            if (o.removeParameter !== undefined && page.parameters.some(p => p.name === String(o.removeParameter))) r.push(`parameter ${o.removeParameter} still there`);
            if (o.renameParameter && !page.parameters.some(p => p.name === String(o.renameParameter.to))) r.push(`no parameter ${o.renameParameter.to}`);
            for (const k of ["class", "style"]) if (o[k] !== undefined && page.appearance[k] !== String(o[k])) r.push(`page ${k} is "${page.appearance[k]}"`);
            if (o.layout !== undefined && page.layoutCall.layoutQualifiedName !== String(o.layout)) r.push(`layout is ${page.layoutCall.layoutQualifiedName}`);
            return r;
        }
    });

    checks.convertGrid = o => GE().checks.convertGrid(o);
    checks.convertWidget = o => WE().checks.convertWidget(o);
    checks.createLoginPage = o => WE().checks.createLoginPage(o);
    return { addWidgets, changeWidget, deleteWidget, moveWidget, changePage, convertGrid: o => GE().convertGrid(o), convertWidget: o => WE().convertWidget(o), createLoginPage: (o, impl) => WE().createLoginPage(o, impl), pageUrl, widgets, checks, touched, open };
}

Object.assign(PAGE_EDIT_OPS, require("./grid-edit").GRID_EDIT_OPS);
Object.assign(FIELD_SYNONYMS, require("./grid-edit").CONVERT_SYNONYMS);
const PAGE_EDIT_NAMES = Object.keys(PAGE_EDIT_OPS);

module.exports = { makePageEdit, PAGE_EDIT_OPS, PAGE_EDIT_NAMES, CHANGE_FIELDS, FIELD_SYNONYMS };
