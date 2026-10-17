"use strict";
// Data widget recipes of a component kit (createComponentKit): each recipe gives the createPage "widgets" JSON of one
// building block and the SCSS its classes expect. Classes: Atlas's own (card, card-title, btn styles through the
// button style) plus "<prefix>-<part>" (BEM-like: <prefix>-card__title). The SCSS uses CSS custom properties with a
// fallback (var(--<prefix>-surface-1, #ffffff)), so it compiles on its own and follows the design tokens once the theme
// defines them: --<prefix>-surface-0/1/2 (page, card, raised), --<prefix>-text, --<prefix>-text-muted,
// --<prefix>-border-soft, --<prefix>-radius-m, --<prefix>-elevation-1/2, --<prefix>-space-s/m/l, --<prefix>-primary,
// --<prefix>-success, --<prefix>-danger. The UI rules: soft borders and elevation instead of black lines, nested
// surfaces one level up, layout grid weights that go to one column on phones, paging instead of nested scrolling.

const RECIPES = {
    card: { doc: "a card: title, text and an action row (Atlas card + <prefix>-card)", options: ["title", "text"] },
    kpiTile: { doc: "a KPI tile: label, big value, change against the last period", options: ["label", "value", "delta"] },
    pageHeader: { doc: "a page header: title and subtitle left, action buttons right (one column on phones)", options: ["title", "subtitle", "actions"] },
    toolbar: { doc: "a toolbar above a Data grid 2: title and buttons; with entity a Data grid 2 under it with a search filter over its text attributes in the grid header", options: ["title", "actions", "entity", "columns"] },
    formSection: { doc: "a form section: an unconfigured data view with a heading and inputs in two columns on desktop and tablet, one on phones; labels on top (or beside them: labels side), Save / Cancel", options: ["title", "fields", "labels"] },
    listCards: { doc: "a list view whose items are cards (unconfigured, or of entity with its first attributes)", options: ["entity", "fields"] },
    gallery: { doc: "a Gallery of entity with item cards and columns per device (desktop / tablet / phone, default 3 / 2 / 1); needs the Gallery widget (widgets/*.mpk)", options: ["entity", "fields", "columns", "tabletColumns", "phoneColumns"] },
    emptyState: { doc: "an empty state: heading, help text and a primary button", options: ["title", "text", "action"] },
    masterDetail: { doc: "master-detail: a list (4 of 12) and a data view (8 of 12) side by side, stacked on phones; with entity the data view listens to the list", options: ["entity", "fields"] }
};
const DEFAULT_KIT = ["card", "kpiTile", "pageHeader", "toolbar", "formSection", "listCards", "emptyState", "masterDetail"];
const NEEDS_ENTITY = ["gallery"];

const pascal = p => p.split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join("");
const kebab = p => p.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

// item: { recipe, ...options }; p: kebab prefix; ent: { name, attrs: [{ name, type }] } or null; can: { grid2, gallery }
function build(item, p, ent, can) {
    const c = s => `${p}-${s}`;
    const btn = (caption, style) => ({ widget: "actionButton", caption, style });
    const texts = ent ? ent.attrs.filter(a => /^(String|Enum|Integer|Long|Decimal|AutoNumber|DateTime)/.test(a.type)).map(a => a.name) : [];
    const pick = (n) => (item.fields || texts).slice(0, n);
    switch (item.recipe) {
        case "card":
            return [{ widget: "container", class: `card ${c("card")}`, widgets: [
                { widget: "text", text: item.title || "Card title", style: "H4", class: `card-title ${c("card__title")}` },
                { widget: "text", text: item.text || "Supporting text for the card.", style: "Paragraph", class: c("card__body") },
                { widget: "container", class: c("card__actions"), widgets: [btn("Open", "Primary")] }] }];
        case "kpiTile":
            return [{ widget: "container", class: `card ${c("kpi")}`, widgets: [
                { widget: "text", text: item.label || "Revenue", class: c("kpi__label") },
                { widget: "text", text: item.value || "1,234", style: "H2", class: c("kpi__value") },
                { widget: "text", text: item.delta || "+12% vs last month", class: c("kpi__delta") }] }];
        case "pageHeader":
            return [{ widget: "container", class: c("page-header"), widgets: [{ widget: "layoutGrid", rows: [{ verticalAlignment: "center", columns: [
                { weight: 8, tablet: 8, phone: 12, widgets: [{ widget: "text", text: item.title || "Page title", style: "H1", class: c("page-header__title") }, { widget: "text", text: item.subtitle || "A short description of this page.", style: "Paragraph", class: c("page-header__subtitle") }] },
                { weight: 4, tablet: 4, phone: 12, class: c("page-header__actions"), widgets: (item.actions || ["Export", "New"]).map((a, i, all) => btn(a, i === all.length - 1 ? "Primary" : "Default")) }] }] }] }];
        case "toolbar": {
            const bar = { widget: "container", class: c("toolbar"), widgets: [
                { widget: "text", text: item.title || "Items", style: "H3", class: c("toolbar__title") },
                { widget: "container", class: c("toolbar__actions"), widgets: (item.actions || ["Export", "New"]).map((a, i, all) => btn(a, i === all.length - 1 ? "Primary" : "Default")) }] };
            if (!ent) return [bar];
            const cols = item.columns || texts.slice(0, 5);
            const search = ent.attrs.filter(a => /^String/.test(a.type)).map(a => a.name).slice(0, 3);
            return [bar, { widget: "dataGrid", kind: can.grid2 ? "datagrid2" : "classic", entity: ent.qn, columns: cols, class: c("grid"), ...(can.grid2 && search.length ? { headerFilters: [{ filter: "text", attributes: search, placeholder: "Search" }] } : {}) }];
        }
        case "formSection": {
            const fields = (item.fields || ["First name", "Last name", "Email", "Phone"]).map(f => (typeof f === "string" ? { widget: "textBox", label: f } : { widget: f.input || "textBox", label: f.label }));
            const rows = [];
            for (let i = 0; i < fields.length; i += 2) rows.push({ columns: [{ weight: 6, tablet: 6, phone: 12, widgets: [fields[i]] }, { weight: 6, tablet: 6, phone: 12, widgets: fields[i + 1] ? [fields[i + 1]] : [] }] });
            const side = /^side$/i.test(String(item.labels || ""));
            return [{ widget: "dataView", class: c("form-section"), orientation: side ? "horizontal" : "vertical", ...(side ? { labelWidth: 4 } : {}), buttons: true, widgets: [
                { widget: "text", text: item.title || "Details", style: "H3", class: c("form-section__title") },
                { widget: "layoutGrid", rows }] }];
        }
        case "listCards": {
            const inner = ent ? pick(2).map((f, i) => ({ widget: "text", text: `{${f}}`, ...(i ? {} : { style: "H4" }), class: c(i ? "list-card__detail" : "list-card__title") })) : [
                { widget: "text", text: "Title", style: "H4", class: c("list-card__title") }, { widget: "text", text: "Detail", class: c("list-card__detail") }];
            return [{ widget: "listView", class: c("list-cards"), ...(ent ? { entity: ent.qn, pageSize: 10 } : { pageSize: 10 }), widgets: [{ widget: "container", class: `card ${c("list-card")}`, widgets: inner }] }];
        }
        case "gallery":
            return [{ widget: "gallery", entity: ent.qn, class: c("gallery"), columns: item.columns || 3, tabletColumns: item.tabletColumns || 2, phoneColumns: item.phoneColumns || 1, pageSize: 12, widgets: [
                { widget: "container", class: `card ${c("gallery__item")}`, widgets: pick(2).map((f, i) => ({ widget: "text", text: `{${f}}`, ...(i ? {} : { style: "H4" }) })) }] }];
        case "emptyState":
            return [{ widget: "container", class: c("empty-state"), widgets: [
                { widget: "text", text: item.title || "Nothing here yet", style: "H3", class: c("empty-state__title") },
                { widget: "text", text: item.text || "Create the first item to get started.", style: "Paragraph", class: c("empty-state__text") },
                btn(item.action || "Create", "Primary")] }];
        case "masterDetail": {
            const list = ent ? { widget: "listView", name: "masterList", entity: ent.qn, pageSize: 10, widgets: [{ widget: "text", text: `{${pick(1)[0] || ent.attrs[0].name}}`, class: c("master__item") }] } : { widget: "listView", pageSize: 10, widgets: [{ widget: "text", text: "Item", class: c("master__item") }] };
            const detail = ent ? { widget: "dataView", listenTo: "masterList", editable: false, fields: pick(4), class: c("detail__view") } : { widget: "dataView", editable: false, class: c("detail__view"), widgets: [{ widget: "text", text: "Details", style: "H3" }] };
            return [{ widget: "layoutGrid", class: c("master-detail"), rows: [{ columns: [{ weight: 4, tablet: 5, phone: 12, class: c("master"), widgets: [list] }, { weight: 8, tablet: 7, phone: 12, class: c("detail"), widgets: [detail] }] }] }];
        }
        default:
            throw new Error(`internal: no recipe ${item.recipe}`);
    }
}

// The SCSS of the recipes in kit (once per recipe), with the custom properties they read.
function scss(p, recipes) {
    const v = (n, d) => `var(--${p}-${n}, ${d})`;
    const surface = `background-color: ${v("surface-1", "#ffffff")};\n    border: 1px solid ${v("border-soft", "rgba(16, 24, 40, 0.08)")};\n    border-radius: ${v("radius-m", "8px")};\n    box-shadow: ${v("elevation-1", "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.1)")};`;
    const R = {
        card: `.${p}-card {\n    ${surface}\n    padding: ${v("space-l", "24px")};\n}\n.${p}-card__title {\n    margin: 0 0 ${v("space-s", "8px")};\n    color: ${v("text", "#1d2939")};\n}\n.${p}-card__body {\n    color: ${v("text-muted", "#475467")};\n}\n.${p}-card__actions {\n    display: flex;\n    flex-wrap: wrap;\n    gap: ${v("space-s", "8px")};\n    margin-top: ${v("space-m", "16px")};\n}\n`,
        kpiTile: `.${p}-kpi {\n    ${surface}\n    padding: ${v("space-m", "16px")} ${v("space-l", "24px")};\n}\n.${p}-kpi__label {\n    color: ${v("text-muted", "#475467")};\n    font-size: 0.875rem;\n}\n.${p}-kpi__value {\n    margin: ${v("space-s", "8px")} 0;\n    color: ${v("text", "#1d2939")};\n}\n.${p}-kpi__delta {\n    color: ${v("success", "#067647")};\n    font-size: 0.875rem;\n}\n`,
        pageHeader: `.${p}-page-header {\n    padding: ${v("space-l", "24px")} 0 ${v("space-m", "16px")};\n}\n.${p}-page-header__title {\n    margin: 0;\n    color: ${v("text", "#1d2939")};\n}\n.${p}-page-header__subtitle {\n    margin: ${v("space-s", "8px")} 0 0;\n    color: ${v("text-muted", "#475467")};\n}\n.${p}-page-header__actions {\n    display: flex;\n    flex-wrap: wrap;\n    justify-content: flex-end;\n    gap: ${v("space-s", "8px")};\n}\n@media (max-width: 575px) {\n    .${p}-page-header__actions {\n        justify-content: flex-start;\n        margin-top: ${v("space-m", "16px")};\n    }\n}\n`,
        toolbar: `.${p}-toolbar {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    justify-content: space-between;\n    gap: ${v("space-s", "8px")};\n    margin-bottom: ${v("space-m", "16px")};\n}\n.${p}-toolbar__title {\n    margin: 0;\n}\n.${p}-toolbar__actions {\n    display: flex;\n    flex-wrap: wrap;\n    gap: ${v("space-s", "8px")};\n}\n.${p}-grid {\n    ${surface}\n}\n`,
        formSection: `.${p}-form-section {\n    ${surface}\n    padding: ${v("space-l", "24px")};\n    margin-bottom: ${v("space-m", "16px")};\n}\n.${p}-form-section__title {\n    margin: 0 0 ${v("space-m", "16px")};\n}\n`,
        listCards: `.${p}-list-cards .mx-listview-item {\n    border: 0;\n    padding: 0 0 ${v("space-s", "8px")};\n    background: transparent;\n}\n.${p}-list-card {\n    ${surface}\n    padding: ${v("space-m", "16px")};\n}\n.${p}-list-card__title {\n    margin: 0 0 4px;\n}\n.${p}-list-card__detail {\n    color: ${v("text-muted", "#475467")};\n}\n`,
        gallery: `.${p}-gallery__item {\n    ${surface}\n    height: 100%;\n    padding: ${v("space-m", "16px")};\n}\n.${p}-gallery__item:hover {\n    box-shadow: ${v("elevation-2", "0 4px 8px -2px rgba(16, 24, 40, 0.1), 0 2px 4px -2px rgba(16, 24, 40, 0.06)")};\n}\n`,
        emptyState: `.${p}-empty-state {\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    gap: ${v("space-s", "8px")};\n    padding: ${v("space-l", "24px")};\n    text-align: center;\n    background-color: ${v("surface-0", "#f9fafb")};\n    border: 1px dashed ${v("border-soft", "rgba(16, 24, 40, 0.16)")};\n    border-radius: ${v("radius-m", "8px")};\n}\n.${p}-empty-state__text {\n    color: ${v("text-muted", "#475467")};\n}\n`,
        masterDetail: `.${p}-master .mx-listview {\n    ${surface}\n}\n.${p}-master__item {\n    padding: ${v("space-s", "8px")} 0;\n}\n.${p}-detail__view {\n    ${surface}\n    padding: ${v("space-l", "24px")};\n}\n@media (max-width: 575px) {\n    .${p}-detail {\n        margin-top: ${v("space-m", "16px")};\n    }\n}\n`
    };
    return `\n/* ${p} component kit (createComponentKit): ${recipes.join(", ")}.\n   Tokens: --${p}-surface-0/1, --${p}-text, --${p}-text-muted, --${p}-border-soft, --${p}-radius-m, --${p}-elevation-1/2,\n   --${p}-space-s/m/l, --${p}-success (fallbacks after the comma). */\n` + recipes.map(r => R[r]).join("");
}

// The classes a recipe uses (for the docs and the dry run)
function classesOf(widgets, out = new Set()) {
    for (const w of widgets || []) {
        if (!w || typeof w !== "object") continue;
        for (const c of String(w.class || "").split(/\s+/).filter(Boolean)) out.add(c);
        classesOf(w.widgets, out);
        for (const r of w.rows || []) for (const col of r.columns || []) {
            if (col && typeof col === "object") {
                for (const c of String(col.class || "").split(/\s+/).filter(Boolean)) out.add(c);
                classesOf(col.widgets, out);
            }
        }
    }
    return out;
}

module.exports = { RECIPES, DEFAULT_KIT, NEEDS_ENTITY, build, scss, classesOf, pascal, kebab };
