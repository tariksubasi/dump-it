"use strict";
// UX CHECK of the dry run: the design rules of agent/UI_DESIGN.md over the widgets a change file writes (createPage,
// addWidgets, createSnippet; createScreen templates follow them by construction). Warnings, nothing refused:
//   P1 a card directly inside a card (same surface twice)        P5 a layout grid column without a phone width
//   P2/P3/P4/P8 inline style with colour, border, height/overflow, position/z-index or a negative margin
//   P6 an icon-only button without a tooltip                     P9 more than one Primary button on a page
const CARD = c => /(^|\s)(shadow-small|shadow-medium|card|[\w-]+-card)(\s|$)/.test(c || "");
const STYLE_RULES = [
    [/(^|;)\s*(color|background(-color)?)\s*:/i, "P2: colours come from the theme (text-muted, text-primary, ... classes), not from style"],
    [/(^|;)\s*border(-\w+)?\s*:/i, "P3: no border in style; a card class gives a soft border and shadow"],
    [/(^|;)\s*(max-)?height\s*:|overflow/i, "P4: no fixed height / overflow: one scroll per page; use paging for long lists"],
    [/(^|;)\s*(position|z-index|top|left|right|bottom)\s*:|margin(-\w+)?\s*:\s*-/i, "P8: no position / z-index / negative margins: things would overlap; use a pop-up page or pop-up menu"]
];

function uxLint(plan) {
    const out = [];
    const walk = (ws, where, parentCard, page) => {
        [].concat(ws || []).forEach((w, i) => {
            if (!w || typeof w !== "object") return;
            const at = `${where} > ${w.name || w.widget}${w.name ? "" : `[${i + 1}]`}`;
            const isCard = w.widget === "container" && CARD(w.class);
            if (isCard && parentCard) out.push(`${at}: P1: a card inside a card has the same surface; drop the inner card class or use background-secondary`);
            if (w.style) for (const [re, msg] of STYLE_RULES) if (re.test(w.style)) out.push(`${at}: ${msg}`);
            if (w.widget === "actionButton" && w.iconOnly && !w.tooltip) out.push(`${at}: P6: an icon-only button needs "tooltip" (its caption for mouse and screen reader users)`);
            if (w.widget === "actionButton" && w.style === "Primary" && !/hide-tablet|hide-phone|hide-desktop/.test(w.class || "")) page.primary++;
            if (w.widget === "layoutGrid") {
                for (const r of w.rows || [{ columns: w.columns }]) for (const c of [].concat((r && r.columns) || [])) {
                    if (c && typeof c === "object" && c.phone === undefined && (c.weight || 12) < 12) out.push(`${at}: P5: a column of ${c.weight} without "phone": phones squeeze it; give "phone": 12 (or a deliberate width)`);
                    if (c && typeof c === "object") walk(c.widgets, at, parentCard || isCard, page);
                }
            }
            for (const k of ["widgets", "footer", "trigger"]) walk(w[k], at, parentCard || isCard, page);
            for (const t of w.tabs || []) walk(t.widgets, `${at} > ${t.caption}`, parentCard || isCard, page);
            for (const g of w.groups || []) walk(g.widgets, `${at} > ${g.header}`, parentCard || isCard, page);
        });
    };
    for (const [i, o] of (plan && plan.ops ? plan.ops : []).entries()) {
        if (!o || !["createPage", "addWidgets", "createSnippet"].includes(o.op) || !o.widgets) continue;
        const where = `op ${i + 1} ${o.op} ${o.module ? `${o.module}.${o.name}` : o.page || o.target || ""}`.trim();
        const page = { primary: 0 };
        walk(o.widgets, where, false, page);
        if (page.primary > 1) out.push(`${where}: P9: ${page.primary} Primary buttons; one main action per page (make the others Default)`);
    }
    return out;
}

module.exports = { uxLint };
