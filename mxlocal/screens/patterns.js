"use strict";
// Generic organisms the category files share: lists (table, cards, rows, master-detail), detail views, forms, KPI
// stats computed by a microflow, state screens. Each takes the template ctx (c) and options; slot names follow the
// RECORD convention: entity, title, subtitle, date, status, amount, cols, fields, edit.

// the usual slots of a record template; pick() keeps some and overrides others
const RECORD = (sample, extra = {}) => ({
    entity: { kind: "entity", desc: "the records shown", sample },
    title: { kind: "attr", of: "entity", type: "Text", desc: "the main text (name, title)", sample: "Name" },
    subtitle: { kind: "attr", of: "entity", type: "Text", optional: true, desc: "a second line", sample: "Detail" },
    date: { kind: "attr", of: "entity", type: "DateTime", optional: true, desc: "a date to show and sort by", sample: "Date" },
    status: { kind: "attr", of: "entity", type: "Enumeration", optional: true, desc: "a status shown as a label", sample: "Status" },
    amount: { kind: "attr", of: "entity", type: "Number", optional: true, desc: "a number to show", sample: "Amount" },
    cols: { kind: "attrs", of: "entity", max: 5, desc: "table columns (default: the first 5 attributes)", sample: ["Name", "Detail", "Date", "Status"] },
    fields: { kind: "attrs", of: "entity", max: 8, desc: "form fields (default: the first 8 attributes)", sample: ["Name", "Detail", "Date", "Status"] },
    edit: { kind: "page", of: "entity", auto: "edit", desc: "the edit page (made when missing)", sample: "Item_Edit" },
    ...extra
});
const pick = (slots, keys, extra = {}) => ({ ...Object.fromEntries(keys.map(k => [k, slots[k]])), ...extra });

// ---------------------------------------------------------------- small parts

const fmt = (c, attr) => (c.t[attr] === "DateTime" ? { [attr]: { date: "dd-MM-yyyy" } } : c.t[attr] === "Decimal" ? { [attr]: { decimals: 2, groupDigits: true } } : null);
const val = (c, attr, extra = {}) => ({ widget: "text", text: `${extra.prefix || ""}{${attr}}${extra.suffix || ""}`, ...(fmt(c, attr) ? { format: fmt(c, attr) } : {}), ...c.kit.omit(c.kit.omit(extra, "prefix"), "suffix") });
const titleOf = c => [c.kit.text(`{${c.s.title}}`, { style: "H4" }), ...(c.s.subtitle ? [c.kit.muted(`{${c.s.subtitle}}`)] : [])];
const meta = c => [...(c.s.date ? [val(c, c.s.date, { class: "text-muted" })] : []), ...(c.s.amount ? [val(c, c.s.amount)] : [])];
const statusBadge = c => (c.s.status ? [c.kit.badge(c.s.status)] : []);
const newAction = (c, caption) => ({ action: "create", entity: c.s.entity, page: c.s.edit, caption: caption || `New ${c.short(c.s.entity).toLowerCase()}`, icon: "mx-icon-add", style: "Primary" });
const open = c => ({ action: "showPage", page: c.s.edit });
const sortBy = c => (c.s.date ? [{ attribute: c.s.date, direction: "desc" }] : [c.s.title]);
const label = a => a.replace(/([a-z])([A-Z])/g, "$1 $2");

// input widgets for attributes, by type (Text over 200 characters: text area)
const inputsFor = (c, attrs) => attrs.map(a => c.kit.input(a, label(a), { type: c.t[a], long: c.t[a] === "String" && /note|description|remark|comment|reason|message/i.test(a) }));

// ---------------------------------------------------------------- lists

function table(c, o = {}) {
    return {
        widget: "dataGrid", kind: "datagrid2", entity: c.s.entity, columns: o.columns || c.s.cols,
        headerFilters: [{ filter: "text", attributes: [c.s.title, ...(c.s.subtitle ? [c.s.subtitle] : [])], placeholder: "Search" }, ...(c.s.status && o.statusFilter !== false ? [{ filter: "dropdown", attribute: c.s.status }] : [])],
        paging: { mode: "buttons", pageSize: o.pageSize || 20 }, sort: sortBy(c), emptyMessage: o.empty || "Nothing here yet",
        ...(o.click !== false && c.s.edit ? { onClick: open(c) } : {}), ...(o.export ? { export: { caption: "Export to Excel", fileName: c.short(c.s.entity) } } : {}),
        ...(o.xpath ? { xpath: o.xpath } : {})
    };
}

function cards(c, o = {}) {
    return {
        widget: "gallery", entity: c.s.entity, columns: o.columns || { desktop: 3, tablet: 2, phone: 1 },
        headerFilters: [{ filter: "text", attributes: [c.s.title], placeholder: "Search" }],
        paging: { mode: "buttons", pageSize: o.pageSize || 12 }, sort: sortBy(c), emptyMessage: o.empty || "Nothing here yet",
        ...(c.s.edit && o.click !== false ? { onClick: open(c) } : {}), ...(o.xpath ? { xpath: o.xpath } : {}),
        widgets: [c.card([...titleOf(c), ...meta(c), ...statusBadge(c), ...(o.extra || [])])]
    };
}

// rows: title + subtitle | status | menu
function rows(c, o = {}) {
    const menu = c.s.edit ? [{ widget: "popupMenu", items: [{ caption: "Edit", action: open(c) }, "divider", { caption: "Delete", action: { action: "delete" }, style: "danger" }] }] : [];
    return {
        widget: "listView", entity: c.s.entity, pageSize: o.pageSize || 20, sort: sortBy(c), ...(o.xpath ? { xpath: o.xpath } : {}),
        widgets: [c.kit.cols([[7, titleOf(c), 7, 9], [3, [...statusBadge(c), ...meta(c)], 3, 12], [2, o.menu === false ? [] : menu, 2, 3]])]
    };
}

function masterDetail(c) {
    return c.kit.cols([
        [4, [c.card([{ widget: "listView", name: "master", entity: c.s.entity, pageSize: 10, sort: sortBy(c), widgets: [...titleOf(c)] }])], 12],
        [8, [c.card([{ widget: "dataView", listenTo: "master", editable: false, showFooter: false, widgets: [
            c.kit.text(`{${c.s.title}}`, { style: "H3" }), ...(c.s.subtitle ? [c.kit.muted(`{${c.s.subtitle}}`)] : []), ...statusBadge(c),
            ...c.s.fields.filter(f => f !== c.s.title).map(f => c.kit.cols([[4, c.kit.muted(label(f)), 4, 12], [8, val(c, f), 8, 12]])),
            ...(c.s.edit ? [c.kit.button({ action: "showPage", page: c.s.edit, caption: "Edit", icon: "mx-icon-pencil" })] : [])] }])], 12]
    ]);
}

// ---------------------------------------------------------------- one object

// label / value rows of the fields
const readRows = (c, fields) => fields.map(f => c.kit.cols([[4, c.kit.muted(label(f)), 4, 12], [8, val(c, f), 8, 12]]));

function form(c, o = {}) {
    const fields = inputsFor(c, o.fields || c.s.fields);
    return { widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: [o.single ? { widget: "container", widgets: fields } : c.kit.fieldPairs(fields)] };
}

// ---------------------------------------------------------------- stats

// KPI values computed by a microflow: a non-persistable entity <Page>Kpi with a Long per stat, filled by
// <Page>_Kpis (count of an entity with an optional XPath); a data view shows them as stat cards
function kpis(c, stats) {
    const ent = `${c.m}.${c.name}Kpi`;
    const actions = [];
    stats.forEach((st, i) => {
        actions.push({ action: "retrieve", variable: `L${i}`, entity: st.entity, ...(st.xpath ? { xpath: st.xpath } : {}) });
        actions.push({ action: "aggregateList", variable: `N${i}`, list: `L${i}`, function: "count" });
    });
    actions.push({ action: "create", entity: ent, variable: "Kpi", set: Object.fromEntries(stats.map((st, i) => [`Stat${i + 1}`, `$N${i}`])) });
    const pre = [
        { op: "createEntity", module: c.m, name: `${c.name}Kpi`, persistable: false, attributes: stats.map((st, i) => ({ name: `Stat${i + 1}`, type: "Long" })) },
        { op: "createMicroflow", module: c.m, name: `${c.name}_Kpis`, returns: ent, returnValue: "$Kpi", actions }
    ];
    const weight = Math.max(3, Math.floor(12 / stats.length));
    const widget = { widget: "dataView", source: "microflow", microflow: `${c.m}.${c.name}_Kpis`, editable: false, showFooter: false, widgets: [
        c.kit.cols(stats.map((st, i) => [weight, c.stat(st.label, c.kit.h(`{Stat${i + 1}}`, 2)), 6, 12]))] };
    return { pre, widget };
}

// ---------------------------------------------------------------- state screens

const stateScreen = (c, title, body, action) => [c.kit.cols([[2, [], 1, 12], [8, [c.kit.emptyState(title, body, action, c.cardClass)], 10, 12], [2, [], 1, 12]])];

module.exports = { RECORD, pick, val, titleOf, meta, statusBadge, newAction, open, sortBy, label, inputsFor, table, cards, rows, masterDetail, readRows, form, kpis, stateScreen, fmt };
