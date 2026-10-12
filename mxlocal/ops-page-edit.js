"use strict";
// Changing existing pages and snippets: add widgets (the createPage kinds) into a placeholder, container, data view
// (body or footer), list view, group box, tab page or layout grid column; change a widget's texts, editability,
// visibility, appearance, grid columns, XPath or name; delete or move a widget; and the widget tree (widgets command).
// New widgets are built by the createPage builders in the entity context of the data view or list view around them,
// with names Studio Pro would give. Only what an op touches changes: every other byte of the page stays as it was
// (selftest: add + change + delete on one of the project's own pages gives the page back byte for byte).
const sdk = require("mendixmodelsdk");
const { fail, bool, setIfAvailable, enumValue, validName } = require("./ops-util");

const { pages, domainmodels: dm, customwidgets: cw, datatypes, texts } = sdk;

const PLACE = {
    into: "optional where: a container, data view, list view, group box or tab page name, a layout grid column \"layoutGrid1/row 1/column 2\", or the placeholder (\"Main\"). Default: the list of after/before, else the page's only placeholder (or the snippet)",
    slot: "optional footer: with a data view in into, its footer (default: its body)",
    after: "optional name of a widget in that list: right after it (default: at the end)",
    before: "optional name of a widget in that list: right before it"
};
const PAGE_EDIT_OPS = {
    addWidgets: {
        doc: "Add widgets to an existing page or snippet: the createPage widget kinds (ops createPage), into a container, data view (body or footer), list view, group box, tab page, layout grid column or the placeholder. Inputs and {Attribute} texts use the entity of the data view or list view around them. Names and places: widgets Module.Page.",
        fields: { page: "R Module.Page or Module.Snippet", ...PLACE, widgets: "R [ { \"widget\": \"<kind>\", ...fields } ] as in createPage; new names like Studio Pro (text3, actionButton2, ...)", entity: "optional default Module.Entity of new grids, list views and data views (default: the entity of the page's only object parameter)" }
    },
    changeWidget: {
        doc: "Change one widget of a page or snippet: caption, text, label, placeholder, editable, visible, class, style, text/button style, grid columns, XPath, name, a button's action, on click (Data grid 2, gallery), on change (inputs). Give only what changes. Names: widgets Module.Page.",
        fields: {
            page: "R Module.Page or Module.Snippet", widget: "R widget name (see: widgets Module.Page)",
            caption: "button, tab page, group box, grid button or classic grid column caption; inside a data view or list view {Attribute} shows a value",
            text: "text of a text (or label) widget; {Attribute} shows a value inside a data view or list view",
            label: "label of an input (\"\" = no label)",
            placeholder: "placeholder of a text box, text area or date picker",
            editable: "true | false (input or data view); an input also takes an expression \"$currentObject/Open\" or { \"attribute\": \"Status\", \"values\": [\"Open\"] } (editable only then)",
            visible: "true (always) | false (never) | an expression \"$currentObject/Active\" | { \"attribute\": \"Active\" } (Boolean: visible when true) | { \"attribute\": \"Status\", \"values\": [\"Open\", \"Paid\"] }; the attribute is of the data view or list view around the widget",
            class: "CSS class(es); replaces the current ones (\"\" = none)",
            style: "inline CSS, e.g. \"font-weight: bold;\" (\"\" = none)",
            textStyle: "Text | Paragraph | H1 | H2 | H3 | H4 | H5 | H6 (a text)",
            buttonStyle: "Default | Primary | Success | Info | Warning | Danger | Inverse (a button)",
            columns: "{ \"add\": [ \"Attr\" or { \"attribute\": ..., \"caption\": ..., \"width\": 20 } ], \"remove\": [ \"Attr\" or a column caption ] } of a classic data grid or Data grid 2 (width: classic only); added at the end",
            xpath: "XPath constraint of a grid, list view or Data grid 2 with a database source, e.g. [Active = true()] (\"\" = all objects)",
            name: "new name; data views listening to it follow",
            action: "a button's action (also a classic grid button): { \"action\": \"showPage\" | \"callMicroflow\" | \"callNanoflow\" | \"save\" | \"cancel\" | \"close\" | \"delete\", \"page\" / \"microflow\" / \"nanoflow\", \"params\" } (replaces the old one)",
            onClick: "on click of a Data grid 2 or gallery: an action as in \"action\" (the row is passed)",
            onChange: "on change of an input, reference (set) selector or combo box: an action as in \"action\" (the object around it is passed)"
        }
    },
    deleteWidget: {
        doc: "Delete a widget and everything inside it from a page or snippet (also a classic grid column, grid button or tab page). Refuses while a data view listens to it, and the placeholder itself.",
        fields: { page: "R Module.Page or Module.Snippet", widget: "R widget name (see: widgets Module.Page)" }
    },
    moveWidget: {
        doc: "Move a widget with its contents to another place on the same page or snippet (into / after / before as in addWidgets), e.g. a button into the data view footer. Widgets that show attributes stay inside the same data view or list view.",
        fields: { page: "R Module.Page or Module.Snippet", widget: "R widget name", ...PLACE }
    }
};
const CHANGE_FIELDS = ["caption", "text", "label", "placeholder", "editable", "visible", "class", "style", "textStyle", "buttonStyle", "columns", "xpath", "name", "action", "onClick", "onChange"];
// fields a weak model takes from elsewhere -> what to write instead (checked before the generic "unknown field")
const FIELD_SYNONYMS = {
    addWidgets: { in: "use \"into\"", inside: "use \"into\"", target: "use \"into\"", container: "use \"into\"", parent: "use \"into\"", widget: "use \"widgets\": [ { \"widget\": ... } ] (a list)", footer: "use \"into\": \"<data view>\", \"slot\": \"footer\"", position: "use \"after\" or \"before\" (a widget name)" },
    moveWidget: { to: "use \"into\" (and \"after\"/\"before\")", target: "use \"into\"", in: "use \"into\"", footer: "use \"into\": \"<data view>\", \"slot\": \"footer\"" },
    deleteWidget: { widgets: "one widget per deleteWidget op: \"widget\": \"<name>\"", name: "use \"widget\"" },
    changeWidget: {
        readOnly: "use \"editable\": false", readonly: "use \"editable\": false", hidden: "use \"visible\": false (or a condition)", hide: "use \"visible\": false", visibility: "use \"visible\"",
        title: "use \"caption\" (button, tab page, column) or \"text\" (a text)", header: "use \"caption\"", value: "use \"text\"", content: "use \"text\"", cssClass: "use \"class\"", className: "use \"class\"",
        newName: "use \"name\"", rename: "use \"name\"", addColumns: "use \"columns\": { \"add\": [...] }", removeColumns: "use \"columns\": { \"remove\": [...] }", column: "use \"columns\": { \"add\": [...], \"remove\": [...] }",
        renderMode: "use \"textStyle\"", heading: "use \"textStyle\": \"H2\"", color: "use \"buttonStyle\" (a button) or \"style\" (CSS)", into: "moving is moveWidget", after: "moving is moveWidget", before: "moving is moveWidget"
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

    // A page or snippet, loaded, with its tree. Layouts and other documents are refused.
    async function open(qn, where) {
        const doc = await h.get(qn);
        if (!(doc instanceof pages.Page) && !(doc instanceof pages.Snippet)) {
            const what = doc instanceof pages.Layout ? "a layout (change layouts in Studio Pro)" : `a ${doc.structureTypeName.split("$")[1]}`;
            throw new Error(`${where}: '${qn}' is ${what}, not a page or snippet`);
        }
        const P = { doc, qn: doc.qualifiedName, snippet: doc instanceof pages.Snippet, ...buildTree(doc) };
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
        const own = !sibs.length && src instanceof pages.DataViewSource && src.sourceVariable && src.sourceVariable.pageParameter ? { pageParameter: src.sourceVariable.pageParameter, widget: dvNode.el } : null;
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
        const node = find(P, s, `${where}: into`, { placeholder: true });
        const el = node.el;
        let out = null;
        if (node.placeholder) out = slotOf(P, el.widgets, null, node.label);
        else if (el instanceof pages.DataView) {
            const footer = slot !== undefined && /^footer$/i.test(String(slot));
            if (slot !== undefined && !/^(footer|body|widgets)$/i.test(String(slot))) fail(`${where}: slot '${slot}' is not known (a data view has body and footer)`, slot, ["footer", "body"]);
            return slotOf(P, footer ? el.footerWidgets : el.widgets, node, footer ? `${node.name} footer` : node.name);
        } else if (el instanceof pages.DivContainer || el instanceof pages.GroupBox || el instanceof pages.TabPage || el instanceof pages.ListView) out = slotOf(P, el.widgets, node, node.name);
        else if (el instanceof pages.LayoutGrid) {
            const cols = columnPaths(node);
            if (cols.length !== 1) throw new Error(`${where}: into '${s}': a layout grid holds widgets in its columns; name one: ${cols.join(", ")}`);
            const c = node.children.find(x => x.el instanceof pages.LayoutGridColumn);
            out = slotOf(P, c.el.widgets, c, c.label);
        } else if (el instanceof pages.TabContainer) throw new Error(`${where}: into '${s}': widgets go into one of its tab pages: ${node.children.filter(c => c.el instanceof pages.TabPage).map(c => c.name).join(", ")}`);
        else if (el instanceof pages.DataGrid) throw new Error(`${where}: into '${s}': a classic data grid holds columns, not widgets (changeWidget "columns")`);
        else if (el instanceof cw.CustomWidget) throw new Error(`${where}: into '${s}': content of a pluggable widget (${kindOf(el)}) is not supported; add it in Studio Pro`);
        else throw new Error(`${where}: into '${s}' is a ${kindOf(el)}; widgets go into a container, data view, list view, group box, tab page, layout grid column or the placeholder (see: widgets ${P.qn})`);
        return checkSlot(out, slot, where);
    }

    function checkSlot(out, slot, where) {
        if (slot !== undefined) throw new Error(`${where}: slot (footer) goes with a data view in into; ${out.label} has no slots`);
        return out;
    }

    // The list a node is in, as a slot.
    function slotOfNode(P, node, where) {
        const holder = node.holder;
        const list = holder && holder[node.prop];
        if (!list || typeof list.indexOf !== "function") throw new Error(`${where}: ${node.label} is not in a list of widgets`);
        const owner = node.parent && !node.parent.root ? node.parent : null;
        let label = owner ? owner.label : P.snippet ? P.qn : "?";
        if (owner && owner.el instanceof pages.DataView && node.prop === "footerWidgets") label = `${owner.name} footer`;
        if (!owner && !P.snippet) label = (placeholders(P).find(p => p.el === holder) || {}).label || label;
        const ph = placeholders(P).find(p => p.el === holder);
        return slotOf(P, list, ph ? null : owner, ph ? ph.label : label);
    }

    function defaultContainer(P, where) {
        if (P.snippet) return slotOf(P, P.doc.widgets, null, P.qn);
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
        if (sib.holder instanceof cw.WidgetValue) throw new Error(`${where}: ${sib.label} is content of a pluggable widget; widgets there are not supported (use Studio Pro)`);
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
        const tr = t.translations.find(x => x.languageCode === lang) || t.translations[0];
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
        const text = String(value).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, a) => {
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
        const attrs = used.map(n => I.attributeOf(dc.ent, n, where));
        const cur = ct.parameters.map(p => (p.attributeRef && !prop(p, "expression") ? p.attributeRef.attributeQualifiedName : null));
        if (cur.length !== attrs.length || attrs.some((a, i) => cur[i] !== a.qualifiedName)) {
            const others = ct.template.translations.filter(x => x.languageCode !== ctx.lang && /\{\d+\}/.test(x.text));
            if (others.length) client.warn(`${where}: the ${others.map(x => x.languageCode).join(", ")} text uses {1}-style values that now mean other attributes; check it in Studio Pro`);
            if (ct.parameters.length) ct.parameters.clear();
            for (const a of attrs) {
                const p = pages.ClientTemplateParameter.create(model);
                ct.parameters.push(p);
                const ref = dm.AttributeRef.create(model);
                ref.attribute = a;
                p.attributeRef = ref;
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
            if (!isInput(w)) throw new Error(`${where}: a ${kindOf(w)} is not an input or data view; editable is for inputs and data views`);
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
        async style(P, node, v, dc, ctx, where) {
            const ap = prop(node.el, "appearance");
            if (!ap) throw new Error(`${where}: a ${kindOf(node.el)} has no CSS style`);
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
            return gridColumns(P, node, v, ctx, where);
        },
        async xpath(P, node, v, dc, ctx, where) {
            const w = node.el;
            const src = w instanceof cw.CustomWidget ? cwSource(w) : prop(w, "dataSource");
            const xp = src && prop(src, "xPathConstraint");
            if (xp === undefined || xp === null) throw new Error(`${where}: a ${kindOf(w)}${src ? ` with a ${src.structureTypeName.split("$")[1]}` : ""} has no XPath; xpath is for a grid, list view or Data grid 2 over the database`);
            const qn = refEntity(src.entityRef);
            if (String(v).trim()) I.checkXPath({ spec: { xpath: v }, where, kind: kindOf(w), container: dc }, await I.entityOf(qn, where));
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
        async onClick(P, node, v, dc, ctx, where) {
            const w = node.el;
            const p = w instanceof cw.CustomWidget && w.object ? w.object.properties.find(x => x.type && x.type.key === "onClick") : null;
            if (!p) throw new Error(`${where}: onClick is for a Data grid 2 or gallery${w instanceof pages.ActionButton ? `; a button takes "action"` : ""}`);
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
        async name(P, node, v, dc, ctx, where) {
            const n = validName(v, "widget name");
            const old = node.name;
            if (n === old) return `name ${n}`;
            if (P.names.includes(n)) throw new Error(`${where}: the name '${n}' is already used on ${P.qn}`);
            node.el.name = n; // the Model SDK renames by-name references (page variables) itself
            const listeners = listenersOf(P, [old]);
            for (const l of listeners) l.src.listenTarget = n;
            const left = mentions(P, old);
            if (left.length) client.warn(`${where}: ${left.length} expression(s) still say $${old}: ${left.slice(0, 3).join("; ")}; change them in Studio Pro`);
            return `renamed to ${n}${listeners.length ? ` (${listeners.map(l => l.node.label).join(", ")} now ${listeners.length > 1 ? "listen" : "listens"} to ${n})` : ""}`;
        }
    };

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
    async function gridColumns(P, node, v, ctx, where) {
        const w = node.el;
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: columns is { "add": [ "Attr", ... ], "remove": [ "Attr", ... ] }`);
        for (const k of Object.keys(v)) if (!["add", "remove"].includes(k)) fail(`${where}: unknown field '${k}' in columns`, k, ["add", "remove"]);
        const add = I.list(v.add, `${where}: columns.add`), remove = I.list(v.remove, `${where}: columns.remove`);
        if (!add.length && !remove.length) throw new Error(`${where}: columns needs "add" and/or "remove"`);
        const classic = w instanceof pages.DataGrid;
        if (!classic && !I.isGrid2(w)) throw new Error(`${where}: columns is for a classic data grid or Data grid 2; ${node.label} is a ${kindOf(w)}`);
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
            const s = typeof a === "string" ? { attribute: a } : a;
            const at = `${where}: columns.add ${i + 1}`;
            if (!s || typeof s !== "object" || !s.attribute) throw new Error(`${at}: use "Attr" or { "attribute": ..., "caption": ...${classic ? `, "width": ...` : ""} }`);
            const keys = classic ? ["attribute", "caption", "width"] : ["attribute", "caption"];
            for (const k of Object.keys(s)) if (!keys.includes(k)) fail(`${at}: unknown field '${k}'${k === "width" ? " (a Data grid 2 column has no weight width here)" : ""}`, k, keys);
            const attr = I.attributeOf(ent, String(s.attribute), at);
            if (cur().some(c => c.attr === attr.qualifiedName)) client.warn(`${where}: ${node.label} already has a column for ${attr.name}; added a second one`);
            const caption = s.caption !== undefined ? String(s.caption) : I.humanize(attr.name);
            if (classic) {
                if (attr.type instanceof dm.BinaryAttributeType) throw new Error(`${at}: '${attr.name}' is binary; a grid column cannot show it`);
                // width: a weight like the others (they need not add up to 100); default their average
                const width = s.width !== undefined ? Number(s.width) : widths.length ? Math.max(1, Math.round(widths.reduce((x, y) => x + y, 0) / widths.length)) : 100;
                if (!(Number.isInteger(width) && width > 0)) throw new Error(`${at}: width must be a whole number > 0 (a weight)`);
                await I.classicColumn(w, attr, caption, width, ctx);
            } else {
                if (allowed.length && !allowed.includes(I.typeOf(attr))) throw new Error(`${at}: a Data grid 2 column cannot show '${attr.name}' (${I.typeOf(attr)}); it shows ${allowed.join(", ")}`);
                const objs = colsProp.value.objects;
                const pattern = objs.find(o => (I.valueOf(o, "showContentAs") || {}).primitiveValue === "attribute") || objs[0] || null;
                const col = await I.dg2Column(colsProp.type.valueType.objectType, pattern, attr, caption, ctx, at);
                objs.push(col);
            }
            done.push(`+${attr.name}`);
        }
        if (classic && !w.columns.length) client.warn(`${where}: ${node.label} has no columns left`);
        return `columns ${done.join(", ")}`;
    }

    // ------------------------------------------------ operations

    // new widgets in the op's ctx, names given and Studio Pro style
    function newCtx(P) {
        return { qn: P.qn, names: I.names(P.names), params: new Map(), count: { inputs: 0 }, untranslated: 0, ents: new Set(), page: P.doc, existing: true, scope: [], after: [] };
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
        const slot = place(P, o, where);
        const dc = await builderContext(P, slot.dc, where).catch(e => {
            // an unknown entity matters only for widgets that show attributes; say so when one does
            const needs = JSON.stringify(o.widgets || []).match(/"(input|textBox|textArea|checkBox|datePicker|radioButtons|dropDown|referenceSelector|comboBox)"|\{[A-Za-z_]\w*\}|"(save|cancel|delete)"|"(visible|editable)":\s*[{"][^tf]/i);
            if (needs) throw e;
            return null;
        });
        if (dc && dc.kind !== "dataView" && dc.kind !== "listView") throw new Error(`${where}: widgets inside a ${dc.kind === "pluggable" ? "pluggable widget" : "template grid"} are not supported; add them in Studio Pro`);
        const nodes = [];
        const top = I.scan(o.widgets, "widgets", dc, nodes);
        if (!top.length) throw new Error(`${where}: 'widgets' is empty`);
        const ctx = newCtx(P);
        // default entity: the op's, else the page's only object parameter
        const params = (P.snippet ? [] : P.doc.parameters).filter(p => p.parameterType instanceof datatypes.ObjectType);
        for (const p of params) if (!ctx.params.has(p.parameterType.entityQualifiedName)) ctx.params.set(p.parameterType.entityQualifiedName, p);
        const dflt = o.entity || (params.length === 1 ? params[0].parameterType.entityQualifiedName : undefined);
        I.prepare(nodes);
        for (const n of nodes) if (["dataGrid", "listView", "gallery"].includes(n.kind)) await I.listEntity(n, { dflt });
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
        for (const n of nodes) if (!n.name && ["dataGrid", "listView", "gallery"].includes(n.kind)) n.name = ctx.names.next(n.gridKind === "datagrid2" ? "dataGrid2_" : n.kind === "dataGrid" ? "grid" : n.kind);
        // data views: listen to a grid or list view (new or on the page), show an existing page parameter, the object
        // around them, an object over an association or from a flow
        const existing = await scopeOf(P, where);
        ctx.scope = [...nodes, ...existing.filter(e => !nodes.some(x => x.name === e.name))];
        await I.resolveSources(nodes, { dflt, extra: existing.filter(e => e.kind !== "dataView"), snippet: P.snippet, ctx });
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
        const node = find(P, o.widget, where);
        const fields = CHANGE_FIELDS.filter(k => o[k] !== undefined);
        if (!fields.length) throw new Error(`${where}: give what to change: ${CHANGE_FIELDS.join(", ")}`);
        const ctx = { ...newCtx(P), lang: await defaultLanguage() };
        // {Attribute} and conditions use the data view or list view around the widget (for a column: around its grid)
        const needs = ["caption", "text", "label", "placeholder", "visible", "editable", "xpath", "action", "onClick", "onChange"].some(k => o[k] !== undefined);
        if (["action", "onClick", "onChange"].some(k => o[k] !== undefined)) ctx.scope = await scopeOf(P, where);
        const dc = needs && node.ctx ? await builderContext(P, node.ctx, where).catch(e => (/\{[A-Za-z_]|currentObject|"attribute"/.test(JSON.stringify(o)) ? Promise.reject(e) : null)) : null;
        const done = [];
        for (const f of fields) done.push(await CHANGE[f](P, node, o[f], dc, ctx, `${where}: ${f}`));
        for (const f of ctx.after) f(); // parameter mappings
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
        if (el instanceof pages.Placeholder) throw new Error(`${where}: ${node.label} is a layout placeholder; it cannot be deleted from a page`);
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
            return ref && !prop(p, "expression") ? `{${ref.attributeQualifiedName.split(".").pop()}}` : m;
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
                for (const c of el.columns) cols.push(`${c.attributeRef ? c.attributeRef.attributeQualifiedName.split(".").pop() : "?"} "${short(await textOf(c.caption))}"`);
                bits.push(`columns: ${cols.join(", ") || "none"}`);
            } else if (I.isGrid2(el)) {
                const colsProp = el.object.properties.find(p => p.type && p.type.key === "columns");
                const cols = [];
                for (const o of colsProp ? colsProp.value.objects : []) {
                    const a = I.valueOf(o, "attribute"), hd = I.valueOf(o, "header");
                    cols.push(`${a && a.attributeRef ? a.attributeRef.attributeQualifiedName.split(".").pop() : "(custom)"} "${hd && hd.textTemplate ? short(await textOf(hd.textTemplate.template)) : ""}"`);
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
            if (el instanceof pages.GridColumn && el.attributeRef) bits.push(el.attributeRef.attributeQualifiedName.split(".").pop());
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
        return bits.join(", ");
    }

    const INTO = el => el instanceof pages.LayoutCallArgument || el instanceof pages.LayoutGridColumn || el instanceof pages.DivContainer || el instanceof pages.GroupBox || el instanceof pages.TabPage || el instanceof pages.ListView || el instanceof pages.DataView;

    async function widgets(qn) {
        const P = await open(qn, "widgets").catch(e => {
            throw new Error(/^widgets: /.test(e.message) ? e.message : `widgets: ${e.message}`);
        });
        const head = [];
        if (P.snippet) head.push(`${P.qn} (snippet${P.doc.parameters.length ? `; parameters: ${P.doc.parameters.map(p => `${p.name} (${p.parameterType && p.parameterType.entityQualifiedName ? p.parameterType.entityQualifiedName : "?"})`).join(", ")}` : ""})`);
        else head.push(`${P.qn} (page; layout ${P.doc.layoutCall ? P.doc.layoutCall.layoutQualifiedName : "?"}; ${P.doc.parameters.length ? `parameters: ${P.doc.parameters.map(p => `${p.name} (${p.parameterType instanceof datatypes.ObjectType ? p.parameterType.entityQualifiedName : p.parameterType.structureTypeName.split("$")[1].replace("Type", "")})`).join(", ")}` : "no parameters"})`);
        head.push(`"widget", "after" and "before" take a name below; "into" takes one marked [into] or a column path; {Entity} = what inputs and {Attribute} texts inside use.`);
        const lines = [];
        const walk = async (n, depth) => {
            const el = n.el;
            let line = "  ".repeat(depth) + (n.label || "(no name)");
            if (!n.placeholder) line += "  " + (await describe(P, n));
            if (INTO(el)) line += el instanceof pages.DataView ? `  [into] (footer: "slot": "footer")` : "  [into]";
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
            const node = P.byName.get(name);
            if (!node) return [`${P.qn} has no widget ${name}`];
            const w = node.el, r = [];
            const say = (ok, what) => ok || r.push(`${P.qn} ${name}: ${what}`);
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
                else say(cv && (o.visible.expression !== undefined ? cv.expression === String(o.visible.expression) : (cv.attributeQualifiedName || "").endsWith("." + o.visible.attribute)), "visibility condition differs");
            }
            for (const k of ["class", "style"]) if (o[k] !== undefined) say(w.appearance[k] === String(o[k]), `${k} is "${w.appearance[k]}"`);
            if (o.textStyle !== undefined) say(w.renderMode.name.toLowerCase() === String(o.textStyle).toLowerCase(), `text style is ${w.renderMode.name}`);
            if (o.buttonStyle !== undefined) say(w.buttonStyle.name.toLowerCase() === String(o.buttonStyle).toLowerCase(), `button style is ${w.buttonStyle.name}`);
            if (o.xpath !== undefined) {
                const src = w instanceof cw.CustomWidget ? cwSource(w) : w.dataSource;
                say(src && src.xPathConstraint === String(o.xpath), "XPath differs");
            }
            for (const k of ["action", "onClick", "onChange"]) {
                if (o[k] === undefined) continue;
                const a = k === "action" ? w.action : k === "onChange" && !(w instanceof cw.CustomWidget) ? w.onChangeAction : ((w.object.properties.find(p => p.type && p.type.key === (k === "onClick" ? "onClick" : "onChangeEvent")) || {}).value || {}).action;
                const spec = typeof o[k] === "string" ? { action: o[k] } : o[k] || {};
                const target = spec.page || spec.microflow || spec.nanoflow;
                const named = a && (a.pageSettings ? a.pageSettings.pageQualifiedName : a.microflowSettings ? a.microflowSettings.microflowQualifiedName : prop(a, "nanoflowQualifiedName"));
                say(a && !(a instanceof pages.NoClientAction) && (!target || named === target), `${k} is not ${spec.action}${target ? " " + target : ""}`);
            }
            if (o.columns && Array.isArray(o.columns.add)) {
                const attrs = [];
                if (w instanceof pages.DataGrid) for (const c of w.columns) attrs.push(c.attributeRef ? c.attributeRef.attributeQualifiedName.split(".").pop() : null);
                else for (const c of (w.object.properties.find(p => p.type.key === "columns") || { value: { objects: [] } }).value.objects) attrs.push(((I.valueOf(c, "attribute") || {}).attributeRef || { attributeQualifiedName: "" }).attributeQualifiedName.split(".").pop());
                for (const a of o.columns.add) {
                    const n = typeof a === "string" ? a : a && a.attribute;
                    say(attrs.includes(String(n)), `has no column for ${n}`);
                }
            }
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

    return { addWidgets, changeWidget, deleteWidget, moveWidget, widgets, checks, touched, open };
}

const PAGE_EDIT_NAMES = Object.keys(PAGE_EDIT_OPS);

module.exports = { makePageEdit, PAGE_EDIT_OPS, PAGE_EDIT_NAMES, CHANGE_FIELDS, FIELD_SYNONYMS };
