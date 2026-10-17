"use strict";
// Data grid 2 and gallery extras on top of ops-pages.js (the builders stay there):
//   column settings   width (auto fill / auto fit / manual + size), min width, alignment, can hide / resize / reorder /
//                     sort, visible expression, cell tooltip, wrap text, dynamic cell class, row events: every column
//                     property the installed datagrid .mpk has (refused with the version when it has not)
//   column filters    by attribute type, or a drop-down over the association of a path column ("Order_Customer/Name"):
//                     Data Widgets 3.x baseType ref (refEntity / refOptions / refCaption, as the DataGrid test project's
//                     FilteringIntegration page); Data grid 2 2.x: the column's filterAssociation + options + caption
//   header filters    filters above the grid / gallery (filtersPlaceholder): 3.x attrChoice linked + attributes (as the
//                     Gallery test project's Home_Web page), 2.x the grid's filterList; a filter outside the grid cannot
//                     link to it (the linked data source is the widget the filter sits in; nothing is stored for it)
// Stored keys and defaults are those of the .mpk; values follow the Studio Pro-saved samples of the test projects.
const sdk = require("mendixmodelsdk");
const { fail, bool, suggest } = require("./ops-util");
const pluggable = require("./pluggable");

const { pages, domainmodels: dm, customwidgets: cw } = sdk;

const FILTERS = { text: "com.mendix.widget.web.datagridtextfilter.DatagridTextFilter", number: "com.mendix.widget.web.datagridnumberfilter.DatagridNumberFilter",
    date: "com.mendix.widget.web.datagriddatefilter.DatagridDateFilter", dropdown: "com.mendix.widget.web.datagriddropdownfilter.DatagridDropdownFilter" };
const FILTER_IDS = Object.values(FILTERS);

// column fields -> .mpk key (and how the value is given)
const COLUMN_SETTINGS = {
    width: "autoFill | autoFit | manual, or a number = manual with that size",
    size: "column size (a whole number; weight for autoFill, width for manual)",
    minWidth: "auto | minContent | a number of px (manual min width)",
    alignment: "left | center | right",
    hidable: "true | false | \"hidden\" (can hide, hidden by default)",
    resizable: "true/false", draggable: "true/false (can reorder)", sortable: "true/false (can sort)",
    visible: "expression (Boolean) on the page / data view around the grid, e.g. \"$currentUser/...\"",
    tooltip: "cell tooltip text with {Attribute} of the row",
    wrapText: "true/false",
    class: "CSS class of every cell (stored as the dynamic class expression 'cls')",
    columnClass: "expression for a CSS class per cell, e.g. \"if $currentObject/Late then 'late' else ''\"",
    rowEvents: "true/false (custom content: let clicks reach the row)"
};
const KEY = { width: "width", size: "size", minWidth: "minWidth", alignment: "alignment", hidable: "hidable", resizable: "resizable", draggable: "draggable", sortable: "sortable",
    visible: "visible", tooltip: "tooltip", wrapText: "wrapText", class: "columnClass", columnClass: "columnClass", rowEvents: "allowEventPropagation" };
const COLUMN_HINTS = { headerTooltip: "this Data grid 2 has a cell \"tooltip\" only (no header tooltip)", align: "use \"alignment\"", hideable: "use \"hidable\"", canHide: "use \"hidable\"", canSort: "use \"sortable\"",
    canResize: "use \"resizable\"", reorder: "use \"draggable\"", dynamicClass: "use \"columnClass\"", wrap: "use \"wrapText\"", visibility: "use \"visible\"" };
const FILTER_FIELDS = ["filter", "multiSelect", "caption", "options", "placeholder", "default", "operator", "filterable", "attributes", "attribute", "association", "variable"];

function makeGridExtras(I, h) {
    const { model, client } = h;
    const valueOf = I.valueOf;

    const verOf = w => {
        const d = w && w.type && pluggable.installed(client.project.dir).get(w.type.widgetId);
        return d ? d.version : "";
    };
    const nameOf = w => (w && w.type ? `${w.type.name} ${verOf(w)}`.trim() : "Data grid 2");

    function enumOf(v, given, field, where) {
        const all = v.type.enumerationValues.map(e => e.key);
        const low = String(given).toLowerCase().replace(/[\s_-]/g, "");
        const hit = all.find(k => k.toLowerCase() === low) || v.type.enumerationValues.filter(e => e.caption.toLowerCase().replace(/[\s_-]/g, "") === low).map(e => e.key)[0];
        if (!hit) fail(`${where}: ${field} '${given}' is not known (use ${all.join(" | ")})`, String(given), all);
        return hit;
    }
    const whole = (v, field, where, min = 0) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < min || typeof v === "boolean") throw new Error(`${where}: ${field} must be a whole number${min ? ` >= ${min}` : ""}`);
        return String(n);
    };
    const boolText = (v, field, where) => {
        if (!(typeof v === "boolean" || /^(true|false)$/i.test(String(v)))) throw new Error(`${where}: ${field} is true or false`);
        return String(bool(String(v).toLowerCase(), false));
    };

    // Applies the column settings of spec s to Data grid 2 column object col (made by the builder or existing).
    // g: { grid (the CustomWidget), ent (the grid's entity), dc (data view around the grid: { ent } or null) }
    async function columnSettings(col, s, g, ctx, where) {
        const done = [];
        const need = (field) => {
            const v = valueOf(col, KEY[field]);
            if (!v) throw new Error(`${where}: ${nameOf(g.grid)} has no column ${field}${field === "class" ? " (dynamic cell class)" : ""}; the columns of this version have: ${col.type.propertyTypes.filter(pt => pt.valueType.type.name !== "System").map(pt => pt.key).join(", ")}`);
            return v;
        };
        for (const field of Object.keys(COLUMN_SETTINGS)) {
            if (s[field] === undefined) continue;
            const val = s[field];
            if (field === "width") {
                const v = need("width");
                if (typeof val === "number" || /^\d+$/.test(String(val))) {
                    v.primitiveValue = enumOf(v, "manual", "width", where);
                    need("size").primitiveValue = whole(val, "width", where, 1);
                    done.push(`width manual ${val}`);
                } else {
                    v.primitiveValue = enumOf(v, val, "width", where);
                    done.push(`width ${v.primitiveValue}`);
                }
            } else if (field === "minWidth") {
                const v = need("minWidth");
                if (typeof val === "number" || /^\d+$/.test(String(val))) {
                    v.primitiveValue = enumOf(v, "manual", "minWidth", where);
                    const lim = valueOf(col, "minWidthLimit");
                    if (!lim) throw new Error(`${where}: ${nameOf(g.grid)} has no min width value`);
                    lim.primitiveValue = whole(val, "minWidth", where, 0);
                    done.push(`min width ${val}px`);
                } else {
                    v.primitiveValue = enumOf(v, val, "minWidth", where);
                    done.push(`min width ${v.primitiveValue}`);
                }
            } else if (field === "size") {
                need("size").primitiveValue = whole(val, "size", where, 1);
                done.push(`size ${val}`);
            } else if (field === "alignment") {
                const v = need("alignment");
                v.primitiveValue = enumOf(v, val, "alignment", where);
                done.push(`alignment ${v.primitiveValue}`);
            } else if (field === "hidable") {
                const v = need("hidable");
                const raw = val === true || /^(true|yes)$/i.test(String(val)) ? "yes" : val === false || /^(false|no)$/i.test(String(val)) ? "no" : String(val);
                v.primitiveValue = enumOf(v, raw, "hidable", where);
                done.push(`can hide ${v.primitiveValue}`);
            } else if (["resizable", "draggable", "sortable", "wrapText", "rowEvents"].includes(field)) {
                need(field).primitiveValue = boolText(val, field, where);
                done.push(`${field} ${String(val).toLowerCase()}`);
            } else if (field === "visible") {
                const v = need("visible");
                const e = typeof val === "boolean" ? String(val) : String(val);
                I.exprCheck(e, g.dc, `${where}: visible`);
                if (/\$currentObject/.test(e) && !g.dc) throw new Error(`${where}: visible of a column is one value for the whole column (no row object); use the page's variables or the data view around the grid`);
                v.expression = e;
                done.push(`visible if ${e}`);
            } else if (field === "tooltip") {
                const v = need("tooltip");
                v.textTemplate = pages.ClientTemplate.create(model);
                await I.textTemplate(v.textTemplate, String(val), { where: `${where}: tooltip`, container: { ent: g.ent } }, ctx);
                done.push(`tooltip "${val}"`);
            } else if (field === "class" || field === "columnClass") {
                if (s.class !== undefined && s.columnClass !== undefined) throw new Error(`${where}: give class (a fixed class) or columnClass (an expression), not both`);
                const v = need(field);
                const e = field === "class" ? `'${String(val).replace(/'/g, "''")}'` : String(val);
                if (field === "class" && !/^[\w\s-]+$/.test(String(val))) throw new Error(`${where}: class '${val}' is not a CSS class list (letters, digits, - and _); for a computed class use columnClass`);
                if (field === "columnClass") I.exprCheck(e, { ent: g.ent }, `${where}: columnClass`);
                v.expression = e;
                done.push(field === "class" ? `class ${val}` : `cell class ${e}`);
            }
        }
        return done;
    }

    // Unknown column fields with a hint (did-you-mean over every column field).
    function checkColumnFields(s, own, at) {
        for (const k of Object.keys(s)) {
            if (own.includes(k)) continue;
            if (COLUMN_HINTS[k]) throw new Error(`${at}: unknown field '${k}' for a Data grid 2 column: ${COLUMN_HINTS[k]}`);
            fail(`${at}: unknown field '${k}' for a Data grid 2 column`, k, own);
        }
    }

    // ------------------------------------------------ filters

    const typeOf = I.typeOf;
    function kindOfAttr(attr) {
        const t = typeOf(attr);
        return ["String", "HashString"].includes(t) ? "text" : ["Integer", "Long", "Decimal", "AutoNumber"].includes(t) ? "number" : t === "DateTime" ? "date" : ["Enum", "Boolean"].includes(t) ? "dropdown" : null;
    }
    const installedFilter = kind => pluggable.installed(client.project.dir).get(FILTERS[kind]);
    const needFilter = (kind, where) => {
        if (!installedFilter(kind)) throw new Error(`${where}: a ${kind} filter needs widgets/com.mendix.widget.web.Datagrid${kind[0].toUpperCase() + kind.slice(1).replace("dropdown", "Dropdown")}Filter.mpk (Data Widgets); this project has none`);
        return installedFilter(kind);
    };
    // filter spec: true | false | "text" | ... | { "filter": ..., ... } -> { kind, opts } (kind null = no filter)
    function filterSpec(f, where) {
        if (f === undefined || f === false || f === "false") return { kind: null, opts: {} };
        if (f === true || f === "true") return { kind: "auto", opts: {} };
        if (typeof f === "string") return { kind: f, opts: {} };
        if (!f || typeof f !== "object" || Array.isArray(f)) throw new Error(`${where}: filter is true, "text" | "number" | "date" | "dropdown" | "association", or { "filter": ..., "multiSelect": true, "caption": "Name", "options": "[XPath]", "placeholder": ..., "default": ... }`);
        for (const k of Object.keys(f)) if (!FILTER_FIELDS.includes(k)) fail(`${where}: unknown field '${k}' in filter`, k, FILTER_FIELDS.filter(x => !["attributes", "attribute", "association"].includes(x)));
        if (f.variable !== undefined) throw new Error(`${where}: a filter keeps its value in the grid (Studio Pro cannot bind it to a page variable); for a search on a page variable use { "widget": "textBox", "variable": "${f.variable}" } and the grid's "xpath": "[contains(Name, $${f.variable})]"`);
        return { kind: f.filter !== undefined ? String(f.filter) : "auto", opts: f };
    }
    const KINDS = ["text", "number", "date", "dropdown", "association"];

    // A filter widget of kind at the end of list (a column's filter or the header), built from its .mpk with Studio
    // Pro's defaults: { w, props }
    async function newFilter(kind, list, node, ctx, where) {
        const fnode = { kind: "pluggable", spec: { widget: "pluggable", type: FILTERS[kind] }, where, container: node.container, name: null, quiet: true };
        I.plScan(fnode, node.container, []);
        await I.buildPluggable(fnode, list, ctx);
        const w = fnode.widget;
        return { w, props: new Map(w.object.properties.map(p => [p.type.key, p])), name: fnode.name, version: fnode.pl.version };
    }
    const setPrim = (props, key, val, where, what) => {
        const p = props.get(key);
        if (!p) throw new Error(`${where}: this filter version has no ${what || key}`);
        p.value.primitiveValue = String(val);
    };
    // the common options of a filter (placeholder, default, operator, multiSelect, filterable)
    async function filterOptions(f, kind, opts, ctx, where) {
        const done = [];
        if (opts.multiSelect !== undefined) {
            if (kind !== "dropdown") throw new Error(`${where}: multiSelect is for a drop-down filter`);
            setPrim(f.props, "multiSelect", boolText(opts.multiSelect, "multiSelect", where), where, "multi-select");
            if (bool(opts.multiSelect, false)) done.push("multi-select");
        }
        if (opts.filterable !== undefined) {
            if (kind !== "dropdown") throw new Error(`${where}: filterable is for a drop-down filter`);
            setPrim(f.props, "filterable", boolText(opts.filterable, "filterable", where), where, "filterable (search in the options)");
            if (bool(opts.filterable, false)) done.push("filterable");
        }
        if (opts.placeholder !== undefined) {
            const p = f.props.get("placeholder") || f.props.get("emptySelectionCaption");
            if (!p) throw new Error(`${where}: this ${kind} filter has no placeholder`);
            await I.templateAll(p.value, "textTemplate", String(opts.placeholder), ctx, where);
            done.push(`placeholder "${opts.placeholder}"`);
        }
        if (opts.operator !== undefined) {
            const p = f.props.get("defaultFilter");
            if (!p) throw new Error(`${where}: a ${kind} filter has no operator`);
            p.value.primitiveValue = enumOf(p.value, opts.operator, "operator", where);
            done.push(`operator ${p.value.primitiveValue}`);
        }
        if (opts.default !== undefined) {
            const p = f.props.get("defaultValue");
            if (!p) throw new Error(`${where}: this ${kind} filter has no default value`);
            const e = String(opts.default);
            if (kind === "text" && !/^'.*'$|^\$|\(/.test(e.trim())) client.warn(`${where}: default ${e} is an expression; a text is written in quotes: '${e}'`);
            p.value.expression = e;
            done.push(`default ${e}`);
        }
        return done;
    }

    // An association drop-down (Data Widgets 3.x: baseType ref) over path p (one step) in list.
    async function assocFilter(list, p, opts, node, ctx, where, gridName) {
        if (!p.steps.length) throw new Error(`${where}: an association filter needs a column over an association, e.g. "Order_Customer/Name"`);
        if (p.steps.length > 1) throw new Error(`${where}: an association filter goes over one association (${p.text} has ${p.steps.length}); show the last entity's attribute over its own association`);
        const st = p.steps[0], target = st.to;
        const def = needFilter("dropdown", where);
        const xml = pluggable.widgetXml(client.project.dir, FILTERS.dropdown);
        if (!hasKey(xml, "baseType") || !hasKey(xml, "refEntity")) throw new Error(`${where}: Drop-down filter ${def.version} filters attributes only; association filters need Data Widgets 3 (or the column's filterAssociation of Data grid 2 2.x)`);
        const cap = captionAttr(target, opts.caption !== undefined ? (typeof opts.caption === "object" ? opts.caption : String(opts.caption)) : p.attr, where);
        const f = await newFilter("dropdown", list, node, ctx, where);
        setPrim(f.props, "baseType", "ref", where, "association filter (baseType)");
        const re = f.props.get("refEntity").value;
        const er = dm.IndirectEntityRef.createInWidgetValueUnderEntityRef(re);
        const x = dm.EntityRefStep.createIn(er);
        x.association = st.assoc;
        x.destinationEntity = target;
        const src = cw.CustomWidgetXPathSource.createInWidgetValueUnderDataSource(f.props.get("refOptions").value);
        dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = target;
        if (opts.options !== undefined) {
            const xp = String(opts.options).trim();
            if (!/^\[[\s\S]*\]$/.test(xp)) throw new Error(`${where}: options is an XPath on ${target.qualifiedName} in brackets, e.g. [Active = true()]`);
            I.checkXPath({ spec: { xpath: xp }, where: `${where}: options`, kind: "filter", container: node.container }, target);
            src.xPathConstraint = xp;
        }
        const capRef = dm.AttributeRef.create(model);
        capRef.attribute = cap;
        f.props.get("refCaption").value.attributeRef = capRef;
        const more = await filterOptions(f, "dropdown", opts, ctx, where);
        client.warnFirst(`${ctx.qn}: association drop-down filters (Drop-down filter ${f.version}, Filter by: Association) are stored as the Data Widgets sample page FilteringIntegration; check ${gridName} in Studio Pro`);
        return `association drop-down filter ${f.name} over ${st.assoc.name} (${target.name} by ${cap.name}${opts.options ? `, options ${opts.options}` : ""}${more.length ? ", " + more.join(", ") : ""})`;
    }
    function hasKey(el, key) {
        let found = false;
        const walk = e => {
            if (found || !e) return;
            if (e.tag === "property" && e.attrs.key === key) found = true;
            (e.children || []).forEach(walk);
        };
        walk(el);
        return found;
    }
    function captionAttr(ent, spec, where) {
        const a = typeof spec === "object" ? spec : I.attributeOf(ent, spec, where);
        if (typeOf(a) === "String") return a;
        const strings = h.attributeChain(ent).attributes.filter(x => typeOf(x) === "String").map(x => x.name);
        throw new Error(`${where}: the options of an association filter show a String attribute of ${ent.name}; ${a.name} is ${typeOf(a)}${strings.length ? `: give "filter": { "caption": "${strings[0]}" } (String attributes: ${strings.join(", ")})` : ` and ${ent.name} has no String attribute`}`);
    }

    // Data grid 2 2.x: the association filter is a property of the column (filterAssociation, its options and caption)
    // with a drop-down filter in the column's filter.
    async function assocFilter2(col, p, opts, node, ctx, where, gridName) {
        if (p.steps.length !== 1) throw new Error(`${where}: an association filter goes over one association, e.g. "Order_Customer/Name"`);
        const st = p.steps[0], target = st.to;
        const cap = captionAttr(target, opts.caption !== undefined ? String(opts.caption) : p.attr, where);
        const fa = valueOf(col, "filterAssociation");
        const er = dm.IndirectEntityRef.createInWidgetValueUnderEntityRef(fa);
        const x = dm.EntityRefStep.createIn(er);
        x.association = st.assoc;
        x.destinationEntity = target;
        const src = cw.CustomWidgetXPathSource.createInWidgetValueUnderDataSource(valueOf(col, "filterAssociationOptions"));
        dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = target;
        if (opts.options !== undefined) {
            const xp = String(opts.options).trim();
            if (!/^\[[\s\S]*\]$/.test(xp)) throw new Error(`${where}: options is an XPath on ${target.qualifiedName} in brackets`);
            src.xPathConstraint = xp;
        }
        valueOf(col, "filterAssociationOptionLabel").expression = `$currentObject/${cap.name}`;
        const f = await newFilter("dropdown", valueOf(col, "filter").widgets, node, ctx, where);
        const more = await filterOptions(f, "dropdown", opts, ctx, where);
        client.warnFirst(`${ctx.qn}: ${gridName} column over ${st.assoc.name}: association filter of Data grid 2 2.x (filterAssociation + Drop-down filter ${f.version}); first use by ops, no Studio Pro sample: check it in Studio Pro`);
        return `association drop-down filter ${f.name} over ${st.assoc.name} (${target.name} by ${cap.name}${more.length ? ", " + more.join(", ") : ""})`;
    }

    // The filter of column col (c: { attr, path, filter }) of grid node: by attribute type or over the association.
    async function columnFilter(col, c, node, ctx, where) {
        const { kind: raw, opts } = filterSpec(c.filter !== undefined ? c.filter : node.spec && node.spec.filters ? true : undefined, where);
        if (!raw) return null;
        const fv = valueOf(col, "filter");
        if (!fv) throw new Error(`${where}: this Data grid 2 has no column filters`);
        const p = c.path || { attr: c.attr, steps: [], text: c.attr.name };
        let kind = String(raw).toLowerCase();
        if (kind === "auto") kind = p.steps.length ? "association" : kindOfAttr(p.attr);
        if (!KINDS.includes(kind)) fail(`${where}: filter '${raw}' is not known (use ${KINDS.join(" | ")})`, String(raw), KINDS);
        const grid = node.widget || null;
        const gridName = node.name || "the grid";
        if (kind === "association") {
            if (valueOf(col, "filterAssociation")) return assocFilter2(col, p, opts, node, ctx, where, gridName);
            return assocFilter(fv.widgets, p, opts, node, ctx, where, gridName);
        }
        const want = kindOfAttr(p.attr);
        if (!want) throw new Error(`${where}: no column filter for ${p.attr.name} (${typeOf(p.attr)})`);
        if (want !== kind) throw new Error(`${where}: a ${kind} filter does not fit ${p.text} (${typeOf(p.attr)}); use "${want}"${p.steps.length ? ` or "association" (a drop-down of ${p.steps[p.steps.length - 1].to.name})` : ""}`);
        if (["multiSelect", "filterable"].some(k => opts[k] !== undefined) && kind !== "dropdown") throw new Error(`${where}: multiSelect / filterable are for a drop-down filter`);
        needFilter(kind, where);
        const f = await newFilter(kind, fv.widgets, node, ctx, where);
        const more = await filterOptions(f, kind, opts, ctx, where);
        if (p.steps.length) client.warnFirst(`${ctx.qn}: ${f.name} filters ${p.text} over ${p.steps.map(s => s.assoc.name).join("/")} (a ${kind} filter on a path column): no Studio Pro sample has one; check it in Studio Pro`);
        void grid;
        return `${kind} filter ${f.name}${more.length ? ` (${more.join(", ")})` : ""}`;
    }

    // ------------------------------------------------ filters above the grid / gallery (its filtersPlaceholder)

    // list: [ { "filter": "text", "attributes": [...], ... } | { "filter": "dropdown", "attribute": "Status" } |
    //         { "filter": "association", "association": "Order_Customer", "caption": "Name", "multiSelect": true } ]
    // w: the Data grid 2 or gallery, ent: its entity; node: builder node ({ container, where, name })
    async function headerFilters(w, ent, list, node, ctx, where) {
        if (!Array.isArray(list) || !list.length) throw new Error(`${where}: headerFilters is [ { "filter": "text", "attributes": ["Name", "Email"] }, { "filter": "dropdown", "attribute": "Status" }, { "filter": "association", "association": "Module.Order_Customer", "caption": "Name" } ]`);
        const props = new Map(w.object.properties.map(p => [p.type.key, p]));
        const what = nameOf(w);
        const ph = props.get("filtersPlaceholder");
        if (!ph) throw new Error(`${where}: ${what} has no filters placeholder above it`);
        const filterList = props.get("filterList"); // Data grid 2 2.x / Gallery 1.x: the attributes header filters use
        const out = [];
        for (const [i, raw] of list.entries()) {
            const at = `${where}: headerFilters[${i + 1}]`;
            const spec = typeof raw === "string" ? { filter: "text", attributes: [raw] } : raw;
            const { kind: k0, opts } = filterSpec(spec, at);
            let kind = String(k0 || "").toLowerCase();
            if (kind === "auto") kind = opts.association !== undefined ? "association" : opts.attributes !== undefined || opts.attribute !== undefined ? null : null;
            const attrs = [...(Array.isArray(opts.attributes) ? opts.attributes : opts.attributes !== undefined ? [opts.attributes] : []), ...(opts.attribute !== undefined ? [opts.attribute] : [])];
            if (kind === null || kind === "") {
                const first = attrs.length ? I.pathOf(ent, String(attrs[0]), at) : null;
                kind = first ? kindOfAttr(first.attr) : null;
                if (!kind) throw new Error(`${at}: give "filter": "text" | "number" | "date" | "dropdown" | "association"`);
            }
            if (!KINDS.includes(kind)) fail(`${at}: filter '${k0}' is not known (use ${KINDS.join(" | ")})`, String(k0), KINDS);
            if (kind === "association") {
                if (opts.association === undefined) throw new Error(`${at}: an association filter needs "association": "Module.Order_Customer" (from ${ent.name} to one or many)`);
                if (filterList) throw new Error(`${at}: ${what} has filters above it over attributes only (filterList); an association drop-down goes in a column: { "attribute": "Order_Customer/Name", "filter": true }`);
                const st = assocStep(ent, String(opts.association), at);
                const cap = opts.caption !== undefined ? captionAttr(st.to, String(opts.caption), at) : captionAttr(st.to, firstString(st.to, at), at);
                out.push(await assocFilter(ph.value.widgets, { attr: cap, steps: [st], text: `${st.assoc.name}/${cap.name}` }, { ...opts, caption: cap }, { ...node, container: node.container }, ctx, at, node.name || w.name));
                continue;
            }
            if (!attrs.length) throw new Error(`${at}: a ${kind} filter above the grid needs "attributes": [ ... ] (the ${kind === "dropdown" ? "Enum or Boolean attribute" : `${kind} attributes`} it searches)`);
            if (kind === "dropdown" && attrs.length > 1) throw new Error(`${at}: a drop-down filter has one attribute ("attribute": "Status")`);
            const paths = attrs.map(a => I.pathOf(ent, String(a), at));
            for (const p of paths) {
                const k = kindOfAttr(p.attr);
                if (k !== kind) throw new Error(`${at}: ${p.text} is ${typeOf(p.attr)}; a ${kind} filter takes ${kind === "text" ? "String" : kind === "number" ? "Integer, Long, Decimal, AutoNumber" : kind === "date" ? "DateTime" : "Enum, Boolean"} attributes${k ? ` (use a ${k} filter)` : ""}`);
                if (p.steps.length) throw new Error(`${at}: ${p.text} is over an association; a filter above the grid takes attributes of ${ent.name} itself (for the association: "filter": "association")`);
            }
            needFilter(kind, at);
            const f = await newFilter(kind, ph.value.widgets, node, ctx, at);
            if (filterList) {
                // 2.x: the grid lists the attributes; every filter in the placeholder uses those of its type
                const ot = filterList.type.valueType.objectType;
                for (const p of paths) {
                    const o = await I.blankObject(ot, null);
                    I.valueOf(o, "filter").attributeRef = I.attrRefOf(p);
                    filterList.value.objects.push(o);
                }
                client.warnFirst(`${ctx.qn}: a filter above ${what} filters the attributes of its filterList (Data Widgets 2.x); first use by ops, no Studio Pro sample: check ${w.name} in Studio Pro`);
            } else {
                setPrim(f.props, "attrChoice", "linked", at, "linked attributes (attrChoice)");
                if (kind === "dropdown") {
                    const ref = dm.AttributeRef.create(model);
                    ref.attribute = paths[0].attr;
                    f.props.get("attr").value.attributeRef = ref;
                } else {
                    const ap = f.props.get("attributes");
                    if (!ap) throw new Error(`${at}: ${kind} filter ${f.version} has no attribute list`);
                    for (const p of paths) {
                        const o = await I.blankObject(ap.type.valueType.objectType, null);
                        I.valueOf(o, "attribute").attributeRef = I.attrRefOf(p);
                        ap.value.objects.push(o);
                    }
                }
            }
            const more = await filterOptions(f, kind, opts, ctx, at);
            out.push(`${kind} filter ${f.name} above ${w.name} over ${paths.map(p => p.text).join(", ")}${more.length ? ` (${more.join(", ")})` : ""}`);
        }
        if (!filterList) client.warnFirst(`${ctx.qn}: filters above a Data grid 2 / gallery use the attributes they list (attrChoice linked), as the Gallery test project's Home_Web page`);
        return out;
    }
    function firstString(ent, where) {
        const s = h.attributeChain(ent).attributes.find(x => typeOf(x) === "String");
        if (!s) throw new Error(`${where}: ${ent.name} has no String attribute to show in the drop-down; give "caption"`);
        return s.name;
    }
    // one association step from ent: { assoc, to }
    // (a reference or a reference set the entity owns, or a reference owned by both)
    function assocStep(ent, name, where) {
        const all = I.associations();
        const ends = a => ({ from: a.parent ? a.parent.qualifiedName : null, to: a instanceof dm.CrossAssociation ? a.childQualifiedName : a.child ? a.child.qualifiedName : null });
        const mine = all.filter(a => I.isA(ent, ends(a).from) || (I.isA(ent, ends(a).to) && a.owner === dm.AssociationOwner.Both));
        const a = mine.find(x => x.qualifiedName === name) || mine.find(x => x.name === name);
        if (!a) fail(`${where}: '${name}' is no association from ${ent.qualifiedName} (associations: ${mine.map(x => x.qualifiedName).join(", ") || "none"})`, name, mine.map(x => x.name));
        const toQn = I.isA(ent, ends(a).from) ? ends(a).to : ends(a).from;
        const to = model.findEntityByQualifiedName(toQn);
        if (!to || !to.isLoaded) throw new Error(`${where}: ${a.qualifiedName} leads to ${toQn}, which ops cannot read here`);
        return { assoc: a, to };
    }

    // ------------------------------------------------ page variables in a data source XPath ($Search)

    // $Name in an XPath: a page variable or parameter of this page (the dry run's XPATH CHECK then checks the types)
    function xpathVariables(xp, ctx, where) {
        const body = String(xp).replace(/'(?:[^']|'')*'/g, "''");
        const used = [...new Set([...body.matchAll(/\$([A-Za-z_]\w*)/g)].map(m => m[1]))];
        if (!used.length || !ctx) return [];
        const vars = ctx.vars ? [...ctx.vars.keys()] : [];
        const params = [...(ctx.params ? [...ctx.params.values()].map(p => p.name) : []), ...(ctx.page && ctx.page.parameters ? ctx.page.parameters.map(p => p.name) : [])];
        const builtin = ["currentObject", "currentUser", "currentSession"];
        for (const n of used) {
            if (vars.includes(n) || params.includes(n) || builtin.some(b => b.toLowerCase() === n.toLowerCase())) continue;
            const known = [...vars, ...params];
            fail(`${where}: xpath: $${n} is no page variable or parameter of this page${known.length ? ` (here: ${known.map(x => "$" + x).join(", ")})` : `; give the page "variables": [ { "name": "${n}", "type": "String" } ]`}`, n, known);
        }
        const own = used.filter(n => vars.includes(n));
        if (own.length) client.warnFirst(`${ctx.qn}: data source XPaths use page variables ($Name): no Studio Pro sample in the test projects has one; check them in Studio Pro (the XPATH CHECK of the dry run checks the types)`);
        return own;
    }

    return { columnSettings, checkColumnFields, columnFilter, headerFilters, filterSpec, kindOfAttr, xpathVariables };
}

// a filter widget placed outside a Data grid 2 / gallery cannot reach it
function outsideFilterMessage(id, where, version) {
    return `${where}: ${id.split(".").pop()} ${version} links to the Data grid 2 or gallery it is placed in (its "linked data source": nothing is stored for the link, so a filter elsewhere filters nothing). Put it above the grid: "headerFilters": [ { "filter": "text", "attributes": ["Name"] } ] on the dataGrid / gallery, or in a column: { "attribute": ..., "filter": true }`;
}

module.exports = { makeGridExtras, COLUMN_SETTINGS, FILTERS, FILTER_IDS, outsideFilterMessage, suggest };
