"use strict";
// Lists of any entity: tables, cards, rows with a menu, master-detail.
const P = require("./patterns");

const SLOTS = P.RECORD("Item");
const EX = { entity: "MyFirstModule.Employee" };
const t = (id, name, desc, keywords, build, slots = SLOTS) => ({ id: `list.${id}`, name, desc, keywords, slots, example: EX, build });

const templates = [
    t("table", "Table with search", "header + Data grid 2 with a search box and a status filter; row click opens the edit page", ["table", "grid", "overview", "admin"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, "Search, filter and open", [P.newAction(c)], c.d), P.table(c)] })),
    t("tableExport", "Table with export", "as the table, with an Export to Excel button above it", ["export", "excel", "report table"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], c.d), P.table(c, { export: true })] })),
    t("tableCard", "Table in a card", "the table on a raised card with a section title; calm for dashboards", ["card", "panel", "table"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], c.d), c.card([c.kit.h("All records", 4), P.table(c, { pageSize: 10 })])] })),
    t("cards", "Cards 3/2/1", "cards that wrap: 3 per row on desktop, 2 on tablet, 1 on phone; best for end users", ["cards", "gallery", "tiles", "mobile"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], c.d), P.cards(c)] })),
    t("cardsWide", "Wide cards 2/1", "two large cards per row, one on tablet and phone; room for more text", ["large cards", "wide"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], c.d), P.cards(c, { columns: { desktop: 2, tablet: 1, phone: 1 }, pageSize: 8 })] })),
    t("cardsDense", "Small cards 4/2/1", "four small cards per row for many records", ["dense", "small", "many"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], "compact"), P.cards(c, { columns: { desktop: 4, tablet: 2, phone: 1 }, pageSize: 16 })] })),
    t("rows", "Rows with a ⋮ menu", "one row per record: title, status, and a menu with Edit / Delete", ["rows", "menu", "actions", "list"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], c.d), c.card([P.rows(c)])] })),
    t("masterDetail", "Master-detail", "a list left (4/12) and the selected record right (8/12); stacked on phones", ["master detail", "split", "side by side"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], c.d), P.masterDetail(c)] })),
    t("statusTabs", "Tabs per status", "a tab with all records and one tab per status value", ["tabs", "status", "workflow"],
        c => ({ title: c.short(c.s.entity), widgets: [c.kit.header(`${c.short(c.s.entity)}s`, null, [P.newAction(c)], c.d), {
            widget: "tabContainer", tabs: [{ caption: "All", widgets: [P.rows(c)] }, ...c.enumValues(c.s.status).slice(0, 4).map(v => ({ caption: P.label(v), widgets: [P.rows(c, { xpath: `[${c.s.status} = '${v}']` })] }))]
        }] }), { ...SLOTS, status: { ...SLOTS.status, optional: false } })
];

module.exports = { category: { id: "list", title: "Lists of records", keywords: ["list", "table", "grid", "overview", "cards", "liste", "tablo", "master detail"] }, templates };
