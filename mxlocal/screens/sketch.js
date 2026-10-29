"use strict";
// Text sketches of a page from its createPage widget specs: the phone and the desktop picture an agent shows the user
// to choose a screen (and that the screen catalog prints). Layout grids put columns side by side by their desktop or
// phone weights, cards get a box, hide-phone / hide-desktop classes are honoured, inputs show their label over a
// field, lists and galleries show two sample items, Data grid 2 shows its column captions.

const BOX = { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };

const fit = (s, w) => {
    const t = String(s);
    return t.length > w ? (w > 1 ? t.slice(0, w - 1) + "…" : t.slice(0, w)) : t + " ".repeat(w - t.length);
};
// {Attr} -> ‹Attr›, keep the rest
const shown = t => String(t || "").replace(/\{([\w/]+)\}/g, (m, a) => `‹${a.split("/").pop()}›`);
const classes = w => String(w.class || "").split(/\s+/);
const hiddenOn = (w, device) => classes(w).includes(device === "phone" ? "hide-phone" : "hide-desktop");
const isCard = w => w.widget === "container" && classes(w).some(c => c === "shadow-small" || /-card$/.test(c) || c === "card");

function box(lines, w, title) {
    const inner = w - 2;
    const top = BOX.tl + (title ? fit(` ${title} `, inner).replace(/ +$/, m => BOX.h.repeat(m.length)) : BOX.h.repeat(inner)) + BOX.tr;
    return [top, ...lines.map(l => BOX.v + fit(l, inner) + BOX.v), BOX.bl + BOX.h.repeat(inner) + BOX.br];
}

// side by side: lists of lines with widths
function sideBySide(parts) {
    const n = Math.max(0, ...parts.map(p => p.lines.length));
    const out = [];
    for (let i = 0; i < n; i++) out.push(parts.map(p => fit(p.lines[i] || "", p.w)).join(""));
    return out;
}

function btn(w) {
    if (w.iconOnly) return `[${w.icon && /add/.test(w.icon) ? "+" : w.icon && /pencil/.test(w.icon) ? "✎" : w.icon && /trash/.test(w.icon) ? "🗑" : "•"}]`;
    const icon = w.icon && /add/.test(w.icon) ? "+ " : w.icon && /play/.test(w.icon) ? "▶ " : w.icon && /stop/.test(w.icon) ? "■ " : "";
    return w.style === "Primary" ? `[ ${icon}${w.caption || "OK"} ]` : `[${icon}${w.caption || "OK"}]`;
}

function render(w, width, device) {
    if (!w || hiddenOn(w, device)) return [];
    const kids = ws => [].concat(ws || []).flatMap(x => render(x, width, device));
    switch (w.widget) {
        case "text": case "heading": case "label": case "title": {
            const t = shown(w.text || w.caption || "Title");
            return /^H[1-3]$/.test(w.style) ? [t.toUpperCase()] : [t];
        }
        case "container": case "groupBox": {
            if (isCard(w) && width > 6) return box(kids2(w.widgets, width - 2, device), width, w.caption);
            const inner = kids(w.widgets);
            return w.widget === "groupBox" ? box(inner.map(l => l.slice(0, width - 2)), width, w.caption) : inner;
        }
        case "layoutGrid": {
            const out = [];
            for (const r of w.rows || []) {
                const cols = (r.columns || []).filter(c => !hiddenOn(c, device));
                const weight = c => (device === "phone" ? c.phone || 12 : c.weight || 12);
                // phone: columns of 12 stack; the others share the row
                let row = [];
                let used = 0;
                const flush = () => {
                    if (!row.length) return;
                    const total = row.reduce((a, c) => a + weight(c), 0);
                    let left = width;
                    const parts = row.map((c, i) => {
                        const w2 = i === row.length - 1 ? left : Math.max(4, Math.round((width * weight(c)) / Math.max(12, total)));
                        left -= w2;
                        return { w: w2, lines: [].concat(c.widgets || []).flatMap(x => render(x, Math.max(4, w2 - 1), device)).map(l => (classes(c).includes("text-right") ? l.trimEnd().padStart(w2 - 1) : l)) };
                    });
                    out.push(...sideBySide(parts));
                    row = [];
                    used = 0;
                };
                for (const c of cols) {
                    if (used + weight(c) > 12) flush();
                    row.push(c);
                    used += weight(c);
                }
                flush();
            }
            return out;
        }
        case "dataView": {
            const lines = kids(w.widgets);
            for (const f of [].concat(w.fields || [])) lines.push(...render({ widget: "input", attribute: f }, width, device));
            const foot = [].concat(w.footer || []).map(btn);
            if (w.buttons) foot.push("[Cancel]", "[ Save ]");
            if (foot.length) lines.push(fit("", Math.max(0, width - foot.join(" ").length)) + foot.join(" "));
            return lines;
        }
        case "input": case "textBox": case "textArea": case "datePicker": case "checkBox": case "radioButtons": case "comboBox": case "referenceSelector": case "referenceSetSelector": case "dropDown": {
            const label = w.label || (w.attribute || w.association || "Field").split(/[/.]/).pop();
            const fw = Math.min(width, 30);
            if (w.widget === "checkBox" || w.kind === "Boolean") return [`[x] ${label}`];
            const field = w.widget === "textArea" ? ["[" + "_".repeat(fw - 2) + "]", "[" + "_".repeat(fw - 2) + "]"] : ["[" + fit(w.placeholder || "", fw - 3).replace(/ /g, "_") + (w.widget === "comboBox" || w.widget === "referenceSelector" ? "▾" : w.format && w.format.date ? "▦" : "_") + "]"];
            return [`${label}${w.required ? " *" : ""}`, ...field];
        }
        case "actionButton":
            return [btn(w)];
        case "badge":
            return [`[${shown(w.text || "Status")}]`];
        case "popupMenu":
            return ["⋮"];
        case "image": case "webImage":
            return ["[ image ]"];
        case "listView": case "templateGrid": {
            const item = kids2(w.widgets && w.widgets.length ? w.widgets : [].concat(w.fields || ["Name"]).map(f => ({ widget: "text", text: `{${f}}` })), width, device);
            const sep = "·".repeat(Math.min(width, 20));
            return [...item, sep, ...item, "…"];
        }
        case "gallery": {
            const per = device === "phone" ? (w.columns && w.columns.phone) || w.phoneColumns || 1 : (w.columns && w.columns.desktop) || (typeof w.columns === "number" ? w.columns : 1);
            const iw = Math.floor(width / per);
            const item = kids2(w.widgets || [{ widget: "text", text: "Item" }], iw - 1, device);
            const filters = (w.headerFilters || []).map(f => `[🔍 ${f.placeholder || "Search"}]`);
            return [...filters, ...sideBySide(Array.from({ length: per }, () => ({ w: iw, lines: item }))), "…"];
        }
        case "dataGrid": {
            const colsList = [].concat(w.columns || ["Name"]).map(c => (typeof c === "string" ? c : c.caption || c.attribute)).map(c => c.split("/").pop());
            const shownCols = device === "phone" ? colsList.slice(0, 2) : colsList;
            const cw = Math.max(6, Math.floor(width / shownCols.length));
            const filters = (w.headerFilters || []).map(f => `[🔍 ${f.placeholder || f.attribute || "Filter"}]`).join(" ");
            const row = shownCols.map(() => fit("…", cw)).join("");
            return [...(filters ? [filters] : []), shownCols.map(c => fit(c, cw)).join(""), row, row, fit("", Math.max(0, width - 9)) + "‹ 1 2 ›"];
        }
        case "tabContainer": {
            const tabs = (w.tabs || []).map((t, i) => (i === 0 ? `[${t.caption}]` : ` ${t.caption} `)).join(" ");
            return [tabs, ...kids2((w.tabs && w.tabs[0] && w.tabs[0].widgets) || [], width, device)];
        }
        case "accordion":
            return (w.groups || []).flatMap((g, i) => [`${i === 0 ? "▾" : "▸"} ${g.header}`, ...(i === 0 ? kids2(g.widgets || [], width - 2, device).map(l => "  " + l) : [])]);
        case "progressBar":
            return ["[██████░░░░]"];
        case "progressCircle":
            return ["( 60% )"];
        case "lineChart": case "columnChart": case "barChart": case "areaChart": case "pieChart":
            return box([`${w.widget.replace("Chart", "")} chart`, "▁▃▅▇▅▃"], Math.min(width, 24));
        case "timeline":
            return ["● event", "│", "● event"];
        case "navigationList":
            return (w.items || []).map(i => `${i.caption || "Item"}  ›`);
        case "snippetCall":
            return [`<${w.snippet || "snippet"}>`];
        case "loginIdTextBox":
            return ["[User name______]"];
        case "passwordTextBox":
            return ["[Password_______]"];
        case "loginButton":
            return [`[ ${w.caption || "Sign in"} ]`];
        case "validationMessage":
            return [];
        default:
            return [`<${w.widget}>`];
    }
}
// children of a box
function kids2(ws, width, device) {
    return [].concat(ws || []).flatMap(x => render(x, width, device));
}

// -> { phone: [lines], desktop: [lines] }
function sketch(widgets, title) {
    const make = (width, device) => box(kids2(widgets, width - 2, device), width, title);
    return { phone: make(30, "phone"), desktop: make(64, "desktop") };
}

// phone and desktop next to each other (for the catalog)
function sideBySideSketch(widgets, title) {
    const s = sketch(widgets, title);
    return sideBySide([{ w: 32, lines: ["PHONE", ...s.phone] }, { w: 64, lines: ["DESKTOP", ...s.desktop] }]).map(l => l.trimEnd());
}

module.exports = { sketch, sideBySideSketch, render };
