"use strict";
// Building blocks of the screen templates (screens/*.js). Every block follows the design rules of
// agent/UI_DESIGN.md by construction: surfaces change per nesting level (section > card), every layout grid column
// is full width on phones, long captions become icon-only buttons on phones (with a tooltip), forms put labels on top,
// lists page instead of scrolling, one Primary action per area, spacing only from Atlas classes, no inline style.
// A block returns createPage widget specs (the "widget" kinds of ops createPage).

const cls = (...c) => c.filter(Boolean).join(" ");

// density: "comfortable" (default) or "compact"
const gap = d => (d === "compact" ? "spacing-outer-bottom-medium" : "spacing-outer-bottom-large");

// ---------------------------------------------------------------- atoms

const text = (t, extra = {}) => ({ widget: "text", text: t, ...extra });
const h = (t, level = 2, extra = {}) => ({ widget: "text", text: t, style: `H${level}`, ...extra });
const muted = (t, extra = {}) => ({ widget: "text", text: t, class: cls("text-muted", extra.class), ...omit(extra, "class") });
const omit = (o, k) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

// a value of the object around it: {Attr}, with date / number format by the attribute type
function value(attr, type, extra = {}) {
    const format = type === "DateTime" ? { [attr]: { date: extra.date || "dd-MM-yyyy" } } : type === "Decimal" ? { [attr]: { decimals: 2, groupDigits: true } } : null;
    return { widget: "text", text: `${extra.prefix || ""}{${attr}}${extra.suffix || ""}`, ...(format ? { format } : {}), ...omit(omit(omit(extra, "date"), "prefix"), "suffix") };
}

// an input by attribute type (the createPage "input" kind picks text box / date picker / check box / radio buttons)
function input(attr, label, opts = {}) {
    const w = { widget: opts.long ? "textArea" : "input", attribute: attr, label: label || attr };
    if (opts.required) w.required = true;
    if (opts.placeholder) w.placeholder = opts.placeholder;
    if (opts.type === "DateTime") w.format = { date: opts.dateTime ? "dateTime" : "date" };
    if (opts.type === "Decimal") w.format = { decimals: 2 };
    if (opts.editable !== undefined) w.editable = opts.editable;
    return w;
}

// a button; icon-only buttons always carry a tooltip
function button(spec) {
    const w = { widget: "actionButton", ...spec };
    if (w.iconOnly && !w.tooltip) w.tooltip = w.caption;
    return w;
}

// the same action twice: caption + icon on tablet/desktop, icon only on phones
function responsiveButton(spec) {
    return [
        button({ ...spec, class: cls(spec.class, "hide-phone") }),
        button({ ...spec, iconOnly: true, tooltip: spec.caption, class: cls(spec.class, "hide-tablet hide-desktop") })
    ];
}

const badge = attr => ({ widget: "badge", text: `{${attr}}`, type: "label" });

// ---------------------------------------------------------------- molecules

// a card: a raised surface (Atlas background-default + soft shadow + inner spacing), or the company kit's card class
const CARD = "background-default shadow-small spacing-inner-medium spacing-outer-bottom-medium";
const card = (widgets, extra = {}) => ({ widget: "container", class: cls(extra.kitClass || CARD, extra.class), widgets });
// a section: one surface level below the page
const section = (widgets, extra = {}) => ({ widget: "container", renderMode: "section", class: cls("background-secondary spacing-inner-medium", extra.class), widgets });

// columns: [ [weight, widgets, tablet?, phone?], ... ]; phones get 12 unless given
function cols(list, extra = {}) {
    return {
        widget: "layoutGrid", ...(extra.class ? { class: extra.class } : {}),
        rows: [{ columns: list.map(([weight, widgets, tablet, phone]) => ({ weight, tablet: tablet || (weight >= 6 ? 12 : 6), phone: phone || 12, widgets: [].concat(widgets) })) }]
    };
}
// several rows of columns
function grid(rows, extra = {}) {
    return { widget: "layoutGrid", ...(extra.class ? { class: extra.class } : {}), rows: rows.map(r => cols(r).rows[0]) };
}

// page header: title + subtitle left, actions right (a responsive Primary action and plain ones)
function header(title, subtitle, actions = [], d) {
    return {
        widget: "layoutGrid", class: gap(d), rows: [{ columns: [
            { weight: 8, tablet: 8, phone: 8, widgets: [h(title, 2), ...(subtitle ? [muted(subtitle)] : [])] },
            { weight: 4, tablet: 4, phone: 4, class: "text-right", widgets: actions.flatMap(a => (a.responsive === false ? [button(omit(a, "responsive"))] : responsiveButton(a))) }
        ] }]
    };
}

// form fields in pairs: 2 per row on tablet/desktop, 1 on phones
function fieldPairs(fields) {
    const rows = [];
    for (let i = 0; i < fields.length; i += 2) {
        const pair = fields.slice(i, i + 2);
        rows.push({ columns: pair.map(f => ({ weight: pair.length === 1 ? 12 : 6, tablet: pair.length === 1 ? 12 : 6, phone: 12, widgets: [f] })) });
    }
    return { widget: "layoutGrid", rows };
}

// a stat: label + big value
const stat = (label, val, extra = {}) => card([muted(label), typeof val === "string" ? h(val, 2) : val], extra);

// empty state card
function emptyState(title, body, action, kitClass) {
    return card([h(title, 3), muted(body), ...(action ? [button({ ...action, style: "Primary" })] : [])], { kitClass, class: "text-center spacing-inner-large" });
}

module.exports = { cls, gap, text, h, muted, value, input, button, responsiveButton, badge, card, section, cols, grid, header, fieldPairs, stat, emptyState, omit };
