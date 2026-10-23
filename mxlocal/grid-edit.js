"use strict";
// Lists on existing pages: changeWidget fields of Data grid 2, gallery, list view, template grid and classic data grid
// (paging, selection, empty message, sort order, item template, data source, export, click trigger) and convertGrid
// (a classic data grid -> a Data grid 2 with the same name, columns, filters, buttons as header / row actions and
// selection; what cannot be carried over is listed in the dry run). New widgets are built by addWidgets on the page as
// it is after the change, so their names, objects and checks are those of addWidgets.
const sdk = require("mendixmodelsdk");
const { fail, enumValue, validName } = require("./ops-util");
const pluggable = require("./pluggable");
const gridExtras = require("./grid-extras");

const { pages, domainmodels: dm, customwidgets: cw, datatypes, microflows: mf } = sdk;

const DATAGRID2 = "com.mendix.widget.web.datagrid.Datagrid", GALLERY = "com.mendix.widget.web.gallery.Gallery";

const GRID_EDIT_OPS = {
    convertGrid: {
        doc: "Turn a classic data grid into a Data grid 2 (built from widgets/*.mpk) with the same name and data source: its columns (weights as sizes, classes), sort order, search fields as column filters (or filters above it), buttons as actions (new / other buttons without the row: a container above it; edit / delete / a flow of the row: buttons in an Actions column; the default (double-click) button: onClick), selection, rows per page. The dry run lists what cannot be carried over; strict refuses then.",
        fields: { page: "R Module.Page or Module.Snippet", widget: "R name of the classic data grid (see: widgets Module.Page)", name: "optional new name (default: the old one, so data views listening to it keep listening)", strict: "optional true: refuse when something cannot be carried over (default false: convert and list it)" }
    }
};
const CONVERT_SYNONYMS = { convertGrid: { grid: "use \"widget\"", dryRun: "every op is a dry run first: the summary lists what is not carried over", target: "use \"widget\"", kind: "convertGrid always makes a Data grid 2" } };

const prop = (o, k) => {
    try {
        return o[k];
    } catch (e) {
        return undefined; // not in this Mendix version
    }
};

function makeGridEdit(h, I, E) {
    const { model, client } = h;
    const isGallery = w => w instanceof cw.CustomWidget && !!w.type && w.type.widgetId === GALLERY;
    const isPlList = w => I.isGrid2(w) || isGallery(w);
    const what = w => E.kindOf(w);

    // the entity a list shows (or null) and the builder node of the data view around it
    async function entityOf(P, node, where) {
        const { qn } = await E.containerEntity(P, node);
        return qn ? I.entityOf(qn, where) : null;
    }

    // Names inside the widgets of list (a list of widgets of the page); refuses when data views elsewhere listen to them
    // or page variables name them (as deleteWidget)
    function removable(P, els, where, why) {
        const names = [], all = new Set();
        for (const el of els) {
            const n = P.nodes.find(x => x.el === el);
            if (!n) continue;
            const t = E.subtree(n);
            names.push(...t.names);
            t.els.forEach(x => all.add(x));
        }
        const listeners = E.listenersOf(P, names, all);
        if (listeners.length) throw new Error(`${where}: ${listeners.map(l => `${l.node.label} listens to ${l.src.listenTarget}`).join(", ")}, which ${why} would delete; delete or change ${listeners.length > 1 ? "those data views" : "that data view"} first`);
        const users = E.variableUsers(P, names, all);
        if (users.length) throw new Error(`${where}: ${users.join(", ")} refer to ${names.join(", ")} by name, which ${why} would delete; change them first`);
        return names;
    }

    // queue an addWidgets into the list of widget name (slot) after the op's other changes
    function later(ctx, P, name, slot, widgets, where, label) {
        (ctx.later = ctx.later || []).push(async () => {
            const P2 = await E.open(P.qn, where);
            const r = await E.addWidgetsAt(P2, E.place(P2, { into: name, ...(slot ? { slot } : {}) }, where), { page: P.qn, widgets }, where);
            return `${label}: ${r.replace(/^[^:]*: /, "")}`;
        });
    }

    const CHANGE = {
        async paging(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (isPlList(w)) return (await I.gridExtras().paging(w, v, dc, ctx, where)).join(", ");
            const s = typeof v === "object" && v !== null && !Array.isArray(v) ? v : { mode: v };
            const own = w instanceof pages.ListView ? "pageSize" : w instanceof pages.DataGrid || w instanceof pages.TemplateGrid ? "numberOfRows" : null;
            if (!own) throw new Error(`${where}: paging is for a Data grid 2, gallery, list view or classic grid; ${node.label} is a ${what(w)}`);
            const other = Object.keys(s).filter(k => k !== "pageSize");
            if (other.length) throw new Error(`${where}: a ${what(w)} pages with ${w instanceof pages.ListView ? "a Load more button" : "its paging bar"}; only "pageSize" changes here (${other.join(", ")}: a Data grid 2 or gallery${w instanceof pages.DataGrid ? "; convertGrid makes this grid one" : ""})`);
            const n = Number(s.pageSize);
            if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: pageSize must be a whole number >= 1`);
            if (w[own] !== n) w[own] = n;
            return `page size ${n}`;
        },
        async selection(P, node, v, dc, ctx, where) {
            const w = node.el;
            let name;
            if (isPlList(w)) name = I.gridExtras().selection(w, v, where);
            else if (w instanceof pages.DataGrid || w instanceof pages.TemplateGrid) {
                const m = enumValue(pages.GridSelectionMode, v, "selection");
                if (w.selectionMode !== m) w.selectionMode = m;
                name = m.name;
            } else throw new Error(`${where}: selection is for a Data grid 2, gallery, classic data grid or template grid; ${node.label} is a ${what(w)}${w instanceof pages.ListView ? " (a list view selects one item for the data views listening to it)" : ""}`);
            const listeners = E.listenersOf(P, [node.name]);
            if (listeners.length && !/^Single/.test(name)) {
                if (isPlList(w)) throw new Error(`${where}: ${listeners.map(l => l.node.label).join(", ")} listen${listeners.length > 1 ? "" : "s"} to ${node.name}, which needs selection Single`);
                client.warn(`${where}: ${listeners.map(l => l.node.label).join(", ")} listen to ${node.name}; with selection ${name} they show one of the selected rows`);
            }
            return `selection ${name}`;
        },
        async onClickTrigger(P, node, v, dc, ctx, where) {
            if (!isPlList(node.el)) throw new Error(`${where}: onClickTrigger is for a Data grid 2 or gallery`);
            return I.gridExtras().clickTrigger(node.el, v, where);
        },
        async emptyMessage(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!isPlList(w)) throw new Error(`${where}: emptyMessage is for a Data grid 2 or gallery${w instanceof pages.ListView ? " (a list view shows nothing when empty: put a text with a visibility condition next to it)" : ""}`);
            const show = I.valueOf(w.object, "showEmptyPlaceholder"), ph = I.valueOf(w.object, "emptyPlaceholder");
            if (!show || !ph) throw new Error(`${where}: this ${what(w)} has no empty message`);
            if (v === null || v === "" || v === false) {
                removable(P, [...ph.widgets], where, "removing the empty message");
                ph.widgets.clear();
                show.primitiveValue = "none";
                return "no empty message";
            }
            if (typeof v !== "string") throw new Error(`${where}: emptyMessage is a text, e.g. "No orders yet" ("" = none)`);
            const gone = removable(P, [...ph.widgets], where, "the new empty message");
            ph.widgets.clear();
            show.primitiveValue = "custom";
            later(ctx, P, node.name, "emptyPlaceholder", [{ widget: "text", text: v }], where, `empty message${gone.length ? ` (replaces ${gone.join(", ")})` : ""}`);
            return `empty message "${v}"`;
        },
        async sort(P, node, v, dc, ctx, where) {
            const w = node.el;
            const src = isPlList(w) ? E.cwSource(w) : prop(w, "dataSource");
            if (!src || !prop(src, "sortBar") || !(src instanceof pages.GridXPathSource || src instanceof pages.ListViewXPathSource || src instanceof cw.CustomWidgetXPathSource)) throw new Error(`${where}: sort is the order of a database source; ${node.label}${src ? ` has a ${src.structureTypeName.split("$")[1]}` : " has no data source"} (a flow returns its own order)`);
            const ent = await entityOf(P, node, where);
            if (src.sortBar.sortItems.length) src.sortBar.sortItems.clear();
            const list = Array.isArray(v) ? v : v === null || v === "" ? [] : [v];
            if (!list.length) return "no sort order";
            return `sort order ${(I.sortOrder({ spec: { sort: list }, source: "database", kind: what(w), where }, src, ent)).replace(/^, sorted by /, "")}`;
        },
        async template(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!Array.isArray(v) || !v.length) throw new Error(`${where}: template is the new item widgets [ { "widget": "text", "text": "{Name}" }, ... ] (inputs too: an editable list)`);
            let list, slot = null;
            if (w instanceof pages.ListView) list = w.widgets;
            else if (w instanceof pages.TemplateGrid) list = w.contents.widgets;
            else if (isGallery(w)) {
                list = I.valueOf(w.object, "content").widgets;
                slot = "content";
            } else if (I.isGrid2(w)) throw new Error(`${where}: a Data grid 2 has no item template; add a column with widgets: "columns": { "add": [ { "type": "customContent", "widgets": [...] } ] }`);
            else throw new Error(`${where}: template is for a list view, gallery or template grid; ${node.label} is a ${what(w)}`);
            const gone = removable(P, [...list], where, "the new template");
            list.clear();
            later(ctx, P, node.name, slot, v, where, `template${gone.length ? ` (replaces ${gone.join(", ")})` : ""}`);
            return `item template: ${v.length} widget(s)`;
        },
        async export(P, node, v, dc, ctx, where) {
            const w = node.el;
            if (!I.isGrid2(w)) throw new Error(`${where}: export is for a Data grid 2${w instanceof pages.DataGrid ? " (convertGrid makes this grid one)" : ""}`);
            if (v === false) throw new Error(`${where}: to remove the export, delete its button with deleteWidget (and the nanoflow with delete)`);
            const ent = await entityOf(P, node, where);
            const props = new Map(w.object.properties.map(p => [p.type.key, p]));
            return I.dg2Export({ spec: { export: v }, where, ent, name: node.name }, w, props, { push: () => { throw new Error(`${where}: this Data grid 2 has no header for the export button`); } }, ctx);
        },
        async source(P, node, v, dc, ctx, where) {
            return changeSource(P, node, v, dc, ctx, where);
        }
    };

    // ------------------------------------------------ data source (D9)

    const SOURCE_KEYS = ["source", "entity", "xpath", "association", "microflow", "nanoflow", "params"];
    // everything inside w (not its data source) that refers to a member of the entity it shows: [label]
    function memberUsers(w, src) {
        const out = [];
        const inSrc = new Set();
        if (src) src.traverse(x => inSrc.add(x));
        w.traverse(el => {
            if (inSrc.has(el) || el instanceof cw.CustomWidgetType) return;
            if (el instanceof dm.AttributeRef || el instanceof dm.MemberRef) out.push(`${el.structureTypeName.split("$")[1]} ${prop(el, "attributeQualifiedName") || ""}`.trim());
            else if (el instanceof pages.Widget && el !== w && (prop(el, "attributeRef") || el instanceof pages.ActionButton)) out.push(el.name);
            const xp = prop(el, "expression");
            if (typeof xp === "string" && /\$currentObject\//i.test(xp)) out.push(`expression ${xp.slice(0, 40)}`);
        });
        return [...new Set(out.filter(Boolean))];
    }

    async function changeSource(P, node, v, dc, ctx, where) {
        const w = node.el;
        const s = typeof v === "string" ? { source: v } : v;
        if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${where}: source is { "source": "database", "entity": "Module.Entity", "xpath": "[...]" } | { "source": "microflow", "microflow": "Module.Flow" } | { "source": "nanoflow", "nanoflow": ... } | { "source": "association", "association": "Module.Assoc" }`);
        for (const k of Object.keys(s)) if (!SOURCE_KEYS.includes(k)) fail(`${where}: unknown field '${k}' in source`, k, SOURCE_KEYS);
        const kind = w instanceof pages.DataGrid ? "dataGrid" : w instanceof pages.ListView ? "listView" : w instanceof pages.TemplateGrid ? "templateGrid" : I.isGrid2(w) ? "dataGrid" : isGallery(w) ? "gallery" : null;
        if (!kind) throw new Error(`${where}: source is for a data grid, Data grid 2, list view, gallery or template grid; ${node.label} is a ${what(w)}${w instanceof pages.DataView ? " (change a data view's source in Studio Pro, or add a new data view)" : ""}`);
        const pl = isPlList(w);
        const oldSrc = pl ? E.cwSource(w) : prop(w, "dataSource");
        const { qn: oldQn } = await E.containerEntity(P, node);
        const spec = { ...s };
        const sameDb = oldSrc && prop(oldSrc, "xPathConstraint") !== undefined && (s.source === undefined || /^(database|xpath)$/i.test(String(s.source))) && !s.association && !s.microflow && !s.nanoflow;
        let keptXPath = "";
        if (sameDb && s.xpath === undefined && oldSrc.xPathConstraint && (!s.entity || s.entity === oldQn)) {
            spec.xpath = keptXPath = oldSrc.xPathConstraint;
        }
        const n = { kind, spec, where, container: dc, name: node.name, gridKind: I.isGrid2(w) ? "datagrid2" : "classic" };
        I.prepare([n]);
        await I.resolveSources([n], { dflt: oldQn, extra: [], snippet: P.snippet, ctx });
        const ent = n.ent;
        const sameEnt = oldQn && (ent.qualifiedName === oldQn || I.isA(ent, oldQn));
        if (!sameEnt) {
            const users = memberUsers(w, oldSrc);
            const listeners = E.listenersOf(P, [node.name]);
            const sortItems = oldSrc && prop(oldSrc, "sortBar") ? oldSrc.sortBar.sortItems.length : 0;
            const search = oldSrc && prop(oldSrc, "searchBar") ? oldSrc.searchBar.items.length : 0;
            const breaks = [...users, ...listeners.map(l => `${l.node.label} (listens to it)`), ...(search ? [`${search} search field(s)`] : [])];
            if (breaks.length) throw new Error(`${where}: the new source gives ${ent.qualifiedName}, not ${oldQn || "the entity it shows now"}; these would break: ${breaks.slice(0, 8).join(", ")}${breaks.length > 8 ? ", ..." : ""}. Keep the entity (or a specialization of it), or change them first (columns.remove, template, deleteWidget), or add a new ${kind} with addWidgets`);
            if (sortItems) oldSrc.sortBar.sortItems.clear();
        }
        // write: a classic widget's database source keeps its source object (search bar, sort order) when it is one
        if (n.source === "database" && !pl && !(oldSrc instanceof pages.GridXPathSource || oldSrc instanceof pages.ListViewXPathSource)) {
            if (kind === "listView") pages.ListViewXPathSource.createInEntityWidgetUnderDataSource(w);
            else {
                const x = pages.GridXPathSource.createInEntityWidgetUnderDataSource(w);
                if (x.searchBar) x.searchBar.type = pages.SearchBarTypeEnum.None;
            }
        } else if (n.source === "database" && !pl && prop(oldSrc, "xPathConstraint") !== undefined) {
            if (oldSrc.xPathConstraint && !spec.xpath) oldSrc.xPathConstraint = "";
        }
        const owner = pl ? I.valueOf(w.object, "datasource") : w;
        const shows = I.listSource(n, owner, pl, ctx);
        if (pl && oldSrc && oldSrc.sortBar && sameEnt && n.source === "database") {
            // keep the sort order of the old database source
            const neu = E.cwSource(w);
            for (const it of [...oldSrc.sortBar.sortItems]) neu.sortBar.sortItems.push(it.deepCopy(model));
        }
        if (!sameEnt) client.warn(`${where}: ${node.label} now shows ${ent.qualifiedName} (was ${oldQn || "?"}); check its columns / content in Studio Pro`);
        return `source ${shows}${keptXPath ? " (XPath kept)" : ""}`;
    }

    // ------------------------------------------------ convertGrid (D10)

    async function convertGrid(o) {
        const where = `convertGrid ${o.page} ${o.widget}`;
        const P = await E.open(o.page, where);
        await I.prepareAssocs(null);
        const node = E.find(P, o.widget, where);
        const g = node.el;
        if (!(g instanceof pages.DataGrid)) throw new Error(`${where}: ${node.label} is a ${what(g)}; convertGrid turns a classic data grid into a Data grid 2${g instanceof pages.TemplateGrid ? " (for a template grid add a gallery with addWidgets)" : ""}`);
        const name = o.name !== undefined ? validName(o.name, "widget name") : node.name;
        if (name !== node.name && P.names.includes(name)) throw new Error(`${where}: the name '${name}' is already used on ${P.qn}`);
        const lang = await E.defaultLanguage();
        const tx = t => {
            if (!t) return "";
            const tr = t.translations.find(x => x.languageCode === lang) || (t.translations.length ? t.translations[0] : null);
            return tr ? tr.text : "";
        };
        const ent = await entityOf(P, node, where);
        if (!ent) throw new Error(`${where}: the entity of ${node.label} is not known here; convert it in Studio Pro`);
        const lost = [], notes = [];
        const spec = { widget: "dataGrid", kind: "datagrid2", name, entity: ent.qualifiedName };
        // data source
        const src = g.dataSource;
        if (src instanceof pages.GridXPathSource) {
            spec.source = "database";
            if (src.xPathConstraint) spec.xpath = src.xPathConstraint;
        } else if (src instanceof pages.AssociationSource || (prop(src, "entityRef") instanceof dm.IndirectEntityRef && !(src instanceof pages.GridXPathSource))) {
            spec.source = "association";
            spec.association = src.entityRef.steps.map(st => st.associationQualifiedName).join("/");
            delete spec.entity;
        } else if (src instanceof pages.MicroflowSource) {
            spec.source = "microflow";
            spec.microflow = src.microflowSettings.microflowQualifiedName;
            delete spec.entity;
            if (src.microflowSettings.parameterMappings.length) notes.push("microflow parameters: passed as Studio Pro's defaults (the objects around it)");
        } else if (src instanceof pages.NanoflowSource) {
            spec.source = "nanoflow";
            spec.nanoflow = src.nanoflowQualifiedName;
            delete spec.entity;
            if (src.parameterMappings.length) notes.push("nanoflow parameters: passed as Studio Pro's defaults");
        } else throw new Error(`${where}: ${node.label} has a ${src ? src.structureTypeName.split("$")[1] : "missing"} data source, which convertGrid does not know; convert it in Studio Pro`);
        const sortItems = prop(src, "sortBar") ? src.sortBar.sortItems : [];
        if (sortItems.length) spec.sort = sortItems.map(it => ({ attribute: pathOf(it.attributeRef), direction: it.sortDirection && it.sortDirection.name === "Descending" ? "desc" : "asc" }));
        // columns
        const allowed = I.dg2Types();
        const cols = [];
        const fresh = pages.FormattingInfo.create(model);
        for (const c of g.columns) {
            const cap = tx(c.caption);
            if (!c.attributeRef) {
                lost.push(`column "${cap}" (no attribute)`);
                continue;
            }
            const path = pathOf(c.attributeRef);
            const attr = model.findAttributeByQualifiedName(c.attributeRef.attributeQualifiedName);
            const t = attr ? I.typeOf(attr) : "?";
            if (["Binary", "HashString"].includes(t) || (allowed.length && !allowed.includes(t))) {
                lost.push(`column ${path} (${t}: a Data grid 2 cannot show it)`);
                continue;
            }
            const col = { attribute: path, caption: cap };
            if (c.width > 0) col.size = c.width;
            if (c.appearance && c.appearance.class && /^[\w\s-]+$/.test(c.appearance.class)) col.class = c.appearance.class;
            const fi = prop(c, "formattingInfo");
            if (fi && ["decimalPrecision", "groupDigits", "enumFormat", "dateFormat", "customDateFormat"].some(k => prop(fi, k) !== undefined && String(prop(fi, k)) !== String(prop(fresh, k)))) lost.push(`format of column ${path} (a Data grid 2 attribute column uses the attribute's own format; use a dynamicText column with "format")`);
            if (prop(c, "aggregateFunction") && c.aggregateFunction.name !== "None") lost.push(`aggregate (${c.aggregateFunction.name}) of column ${path}`);
            if (c.editable) lost.push(`editable column ${path} (Data grid 2 cells are read-only; use a customContent column with an input)`);
            cols.push(col);
        }
        if (!cols.length) throw new Error(`${where}: no column of ${node.label} can be carried over (${lost.join("; ")}); a Data grid 2 needs one`);
        // search fields -> column filters, or filters above it
        const inst = pluggable.installed(client.project.dir);
        const hasFilters = gridExtras.FILTER_IDS.every(id => inst.has(id));
        const header = [];
        for (const f of prop(src, "searchBar") ? src.searchBar.items : []) {
            const p = f.attributeRef ? pathOf(f.attributeRef) : null;
            const label = `search field ${f.name || tx(f.caption)}`;
            if (!p || f instanceof pages.RangeSearchField) {
                lost.push(`${label} (${p ? "a range search" : "no attribute"})`);
                continue;
            }
            if (!hasFilters) {
                lost.push(`${label} (widgets/ has no Data grid filter .mpk)`);
                continue;
            }
            const col = cols.find(c => c.attribute === p);
            if (col) col.filter = true;
            else if (!p.includes("/")) header.push({ filter: I.gridExtras().kindOfAttr(I.attributeOf(ent, p, where)), attributes: [p] });
            else lost.push(`${label} over ${p} (no column shows it)`);
            if (prop(f, "defaultValue")) notes.push(`${label}: its default value ${f.defaultValue} is not carried over`);
        }
        for (const h2 of header) if (!h2.filter) {
            lost.push(`search field on ${h2.attributes[0]} (no filter for its type)`);
            h2.drop = true;
        }
        const hf = header.filter(x => !x.drop).map(({ drop, ...x }) => x);
        if (hf.length) spec.headerFilters = hf;
        // selection, rows
        const sel = g.selectionMode ? g.selectionMode.name : "Single";
        spec.selection = /Multi/.test(sel) ? "Multi" : sel === "None" ? "None" : "Single";
        if (sel === "SingleAndMaintain") notes.push("selection SingleAndMaintain becomes Single");
        if (g.selectFirst && spec.selection !== "None") spec.selectFirst = true;
        if (g.numberOfRows > 0) spec.rows = g.numberOfRows;
        if (prop(g, "tooltipPage") && g.tooltipPageQualifiedName) lost.push(`tooltip page ${g.tooltipPageQualifiedName}`);
        // buttons
        const above = [], row = [];
        const defaultBtn = g.controlBar ? g.controlBar.defaultButton : null;
        for (const b of g.controlBar ? g.controlBar.items : []) {
            const cap = tx(prop(b, "caption") instanceof pages.ClientTemplate ? b.caption.template : prop(b, "caption"));
            const style = b.buttonStyle ? b.buttonStyle.name : undefined;
            const btn = x => ({ widget: "actionButton", caption: cap || undefined, ...(style && style !== "Default" ? { style } : {}), ...x });
            const label = `button ${b.name || cap}`;
            if (b instanceof pages.GridSearchButton) continue;
            if (b instanceof pages.GridSelectAllButton || b instanceof pages.GridDeselectAllButton) {
                notes.push(`${label}: a Data grid 2 with selection Multi has its own select all check box`);
                continue;
            }
            if (b instanceof pages.DataGridExportToExcelButton || b instanceof pages.DataGridExportToCSVButton) {
                if (I.unitNamed("DataWidgets.Export_To_Excel")) spec.export = { caption: cap || "Export to Excel" };
                else lost.push(`${label} (export: the Data Widgets module is not in the project)`);
                continue;
            }
            if (b instanceof pages.GridNewButton) {
                const pg = b.pageSettings && b.pageSettings.pageQualifiedName;
                if (!pg) {
                    lost.push(`${label} (no page)`);
                    continue;
                }
                above.push(btn({ action: "create", entity: b.entityQualifiedName || ent.qualifiedName, page: pg, ...(spec.source === "association" && !spec.association.includes("/") ? { association: spec.association } : {}) }));
                continue;
            }
            if (b instanceof pages.GridEditButton) {
                const pg = b.pageSettings && b.pageSettings.pageQualifiedName;
                if (!pg) lost.push(`${label} (no page)`);
                else onRow({ action: "showPage", page: pg }, b);
                continue;
            }
            if (b instanceof pages.GridDeleteButton) {
                row.push(btn({ action: "delete", caption: cap || "Delete" }));
                if (spec.selection === "Multi") notes.push(`${label}: deletes its row (the classic one deleted the selected rows)`);
                continue;
            }
            if (b instanceof pages.GridActionButton) {
                const a = b.action;
                const x = await actionSpec(a, ent, label);
                if (!x) continue;
                if (x.row) onRow(x.spec, b);
                else above.push(btn(x.spec));
                continue;
            }
            lost.push(`${label} (${b.structureTypeName.split("$")[1]})`);
        }
        function onRow(x, b) {
            const cap = tx(prop(b, "caption") instanceof pages.ClientTemplate ? b.caption.template : prop(b, "caption"));
            const style = b.buttonStyle ? b.buttonStyle.name : undefined;
            row.push({ widget: "actionButton", caption: cap || "Open", ...(style && style !== "Default" ? { style } : {}), ...x });
            if (b === defaultBtn && !spec.onClick) {
                spec.onClick = x;
                spec.onClickTrigger = "double";
            }
        }
        // a flow / page action of a grid button: { row (the row object is passed), spec } or null (listed as lost)
        async function actionSpec(a, ent, label) {
            if (!a || a instanceof pages.NoClientAction) {
                lost.push(`${label} (no action)`);
                return null;
            }
            if (a instanceof pages.DeleteClientAction) return { row: true, spec: { action: "delete" } };
            if (a instanceof pages.ClosePageClientAction) return { row: false, spec: { action: "close" } };
            if (a instanceof pages.PageClientAction) {
                const pg = await h.get(a.pageSettings.pageQualifiedName).catch(() => null);
                const params = pg ? (prop(pg, "parameters") || []).filter(p => p.parameterType instanceof datatypes.ObjectType) : [];
                if (!pg) lost.push(`${label} (page ${a.pageSettings.pageQualifiedName} not found)`);
                else if (!params.length) return { row: false, spec: { action: "showPage", page: pg.qualifiedName } };
                else if (params.length === 1 && I.isA(ent, params[0].parameterType.entityQualifiedName)) return { row: true, spec: { action: "showPage", page: pg.qualifiedName } };
                else lost.push(`${label} (opens ${pg.qualifiedName} with parameters ${params.map(p => p.name).join(", ")})`);
                return null;
            }
            const nano = a instanceof pages.CallNanoflowClientAction;
            if (a instanceof pages.MicroflowClientAction || nano) {
                const qn = nano ? a.nanoflowQualifiedName : a.microflowSettings.microflowQualifiedName;
                const f = qn ? await h.get(qn).catch(() => null) : null;
                if (!f) {
                    lost.push(`${label} (flow ${qn || "?"} not found)`);
                    return null;
                }
                const ps = [];
                f.traverse(el => el instanceof mf.MicroflowParameterObject && ps.push(el));
                const objs = ps.filter(p => p.variableType instanceof datatypes.ObjectType || p.variableType instanceof datatypes.ListType);
                const x = { action: nano ? "callNanoflow" : "callMicroflow", [nano ? "nanoflow" : "microflow"]: qn };
                if (!objs.length) return { row: false, spec: x };
                if (objs.length === 1 && objs[0].variableType instanceof datatypes.ObjectType && I.isA(ent, objs[0].variableType.entityQualifiedName)) return { row: true, spec: x };
                lost.push(`${label} (${qn} takes ${objs.map(p => `${p.name}: ${p.variableType instanceof datatypes.ListType ? "a list (the selected rows)" : p.variableType.entityQualifiedName}`).join(", ")}; pass the selection in Studio Pro)`);
                return null;
            }
            if (a instanceof pages.CreateObjectClientAction) {
                const pg = a.pageSettings && a.pageSettings.pageQualifiedName;
                if (pg) return { row: false, spec: { action: "create", entity: a.entityRef ? a.entityRef.entityQualifiedName || ent.qualifiedName : ent.qualifiedName, page: pg } };
            }
            lost.push(`${label} (${a.structureTypeName.split("$")[1].replace(/ClientAction$/, "")} action)`);
            return null;
        }
        if (row.length) spec.columns = [...cols, { type: "customContent", caption: "", widgets: row }];
        else spec.columns = cols;
        // visibility, class, style of the old grid
        const ap = g.appearance;
        if (ap && ap.class) spec.class = ap.class;
        if (ap && ap.style) spec.style = ap.style;
        if (g.conditionalVisibilitySettings) lost.push("the grid's visibility condition (set it with changeWidget visible)");
        if (o.strict && lost.length) throw new Error(`${where}: strict: not carried over: ${lost.join("; ")}`);
        // nothing may refer to the old grid by its element (page variables of other widgets: $grid.selection)
        const { names, els } = E.subtree(node);
        const users = E.variableUsers(P, names, els);
        if (users.length) throw new Error(`${where}: ${users.join(", ")} pass ${node.name}'s selection (a page variable naming the grid); a Data grid 2 is a different widget: change them in Studio Pro after converting, or first remove that parameter`);
        const listeners = E.listenersOf(P, [node.name], els);
        if (listeners.length && spec.selection !== "Single") notes.push(`${listeners.map(l => l.node.label).join(", ")} listen to it; with selection ${spec.selection} they need Single`);
        // the place: where the grid was
        const slot = E.slotOfNode(P, node, where);
        const index = slot.list.indexOf(g);
        const sib = index > 0 ? slot.list[index - 1] : index + 1 < slot.list.length ? slot.list[index + 1] : null;
        const sibName = sib ? prop(sib, "name") : null;
        g.delete();
        const P2 = await E.open(o.page, where);
        const place = sibName && P2.byName.has(sibName)
            ? E.place(P2, index > 0 ? { after: sibName } : { before: sibName }, where)
            : E.place(P2, holderPlace(P2, slot, node), where);
        const widgets = above.length ? [{ widget: "container", widgets: above }, spec] : [spec];
        const r = await E.addWidgetsAt(P2, place, { page: o.page, widgets }, where);
        for (const l of lost) client.warn(`${where}: not carried over: ${l}`);
        return `${P.qn}: ${node.name} (classic data grid) -> ${r.replace(/^[^:]*: /, "")}${notes.length ? `; notes: ${notes.join("; ")}` : ""}; ${lost.length ? `not carried over: ${lost.join("; ")}` : "everything carried over"}`;
    }

    // into for a place by the list's owner (the old grid was the only widget there)
    function holderPlace(P2, slot, node) {
        const owner = node.parent && !node.parent.root ? node.parent : null;
        if (!owner) return {};
        if (owner.el instanceof pages.LayoutGridColumn) return { into: owner.label };
        if (owner.el instanceof pages.DataView && node.prop === "footerWidgets") return { into: owner.name, slot: "footer" };
        if (owner.placeholder) return { into: owner.label };
        return owner.name ? { into: owner.name } : {};
    }

    const pathOf = ref => [...(ref.entityRef && ref.entityRef.steps ? ref.entityRef.steps.map(st => st.associationQualifiedName) : []), ref.attributeQualifiedName.split(".").pop()].join("/");

    const checks = {
        async convertGrid(o) {
            const P = await E.open(o.page, "check");
            const name = o.name !== undefined ? String(o.name) : String(o.widget);
            const n = P.byName.get(name);
            if (!n) return [`${P.qn} has no widget ${name}`];
            if (!I.isGrid2(n.el)) return [`${P.qn} ${name} is a ${what(n.el)}, not a Data grid 2`];
            const cols = I.valueOf(n.el.object, "columns");
            return cols && cols.objects.length ? [] : [`${P.qn} ${name} has no columns`];
        }
    };

    return { CHANGE, convertGrid, checks };
}

module.exports = { makeGridEdit, GRID_EDIT_OPS, CONVERT_SYNONYMS };
