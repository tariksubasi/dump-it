"use strict";
// The screen template catalog: every category file of this folder exports { category, templates }. A template is
// { id, name, desc, keywords, slots, example, build(ctx) -> { widgets, title?, page?, entity?, pre?, op? } }.
// Slots: { key: { kind: entity | attr | attrs | assoc | page | microflow | text, of, type, desc, sample, optional, auto } }.
// catalog() / categoryText() / templateText() print what `mxlocal screens` shows; sketches come from the widgets.
const fs = require("fs");
const path = require("path");
const kit = require("./kit");
const { sideBySideSketch } = require("./sketch");

const FILES = fs.readdirSync(__dirname).filter(f => /^cat-.*\.js$/.test(f)).sort();
const categories = [];
const byId = new Map();
for (const f of FILES) {
    const m = require(path.join(__dirname, f));
    categories.push({ ...m.category, templates: m.templates });
    for (const t of m.templates) {
        if (byId.has(t.id)) throw new Error(`screens: template id ${t.id} twice`);
        byId.set(t.id, { ...t, category: m.category.id });
    }
}

// a ctx with sample names instead of the user's attributes: for sketches without a model
function sampleCtx(t, name = "Page") {
    const s = {}, ty = {};
    for (const [k, d] of Object.entries(t.slots || {})) {
        if (d.kind === "entity") s[k] = `Module.${d.sample || "Item"}`;
        else if (d.kind === "attr") {
            s[k] = d.sample || k[0].toUpperCase() + k.slice(1);
            ty[s[k]] = [].concat(d.type || "String")[0] === "Number" ? "Integer" : [].concat(d.type || "String")[0];
        } else if (d.kind === "attrs") {
            s[k] = d.sample || ["Name", "Detail", "Date", "Status"].slice(0, d.max || 3);
            for (const a of s[k]) ty[a] = "String";
        } else if (d.kind === "assoc") s[k] = `Module.${d.sample || "Assoc"}`;
        else if (d.kind === "page" || d.kind === "microflow") s[k] = `Module.${d.sample || k}`;
        else if (d.kind === "text") s[k] = d.default;
    }
    return {
        s, t: ty, m: "Module", name, d: "comfortable", kit, short: qn => String(qn).split(".").pop(),
        enumValue: (attr, ...wanted) => `Module.Enum.${wanted[0] || "Value"}`,
        enumValues: () => ["Open", "Done"],
        card: (widgets, extra = {}) => kit.card(widgets, extra), stat: (label, val) => kit.stat(label, val)
    };
}

function widgetsOf(t) {
    const b = t.build(sampleCtx(t));
    if (b.op) return b.op.op === "createLoginPage" ? [{ widget: "text", text: b.op.heading || "Sign in", style: "H2" }, { widget: "loginIdTextBox" }, { widget: "passwordTextBox" }, { widget: "loginButton" }, ...(b.op.widgets || [])] : [];
    return b.widgets || [];
}
const sketchOf = t => sideBySideSketch(widgetsOf(t), t.name);

const slotLine = (k, d) => `  ${k}: ${d.kind}${d.type ? ` (${[].concat(d.type).join("/")})` : ""}${d.of ? ` of ${d.of}` : ""}${d.optional || d.auto ? " optional" : ""}${d.auto ? `, made when missing (${d.auto} page)` : ""} - ${d.desc || ""}`;
const exampleOp = t => JSON.stringify({ op: "createScreen", module: "MyFirstModule", name: t.exampleName || `${t.id.split(".").slice(-2).map(x => x[0].toUpperCase() + x.slice(1)).join("")}`, template: t.id, slots: t.example || {} });

// the router: categories, keywords, counts
function catalog() {
    const out = ["SCREEN CATALOG: pick a category, then: python mx.py screens <category>", ""];
    out.push("| Category | Templates | Use for (keywords) |", "|---|---|---|");
    for (const c of categories) out.push(`| ${c.id} | ${c.templates.length} | ${c.title}: ${c.keywords.join(", ")} |`);
    out.push("", `${byId.size} templates. Show the user 3-5 sketches of one category, let them pick a number, then createScreen.`);
    return out.join("\n");
}

function categoryText(id) {
    const c = categories.find(x => x.id === id);
    if (!c) return null;
    const out = [`CATEGORY ${c.id}: ${c.title} (${c.templates.length} templates)`, ""];
    c.templates.forEach((t, i) => {
        out.push(`${i + 1}. ${t.id} - ${t.name}: ${t.desc}`, "```", ...sketchOf(t), "```", "slots:", ...Object.entries(t.slots || {}).map(([k, d]) => slotLine(k, d)), `example: ${exampleOp(t)}`, "");
    });
    return out.join("\n");
}

function templateText(id) {
    const t = byId.get(id);
    if (!t) return null;
    return [`TEMPLATE ${t.id} - ${t.name}`, t.desc, "", "```", ...sketchOf(t), "```", "slots:", ...Object.entries(t.slots || {}).map(([k, d]) => slotLine(k, d)), "", `example: ${exampleOp(t)}`].join("\n");
}

module.exports = { categories, byId, catalog, categoryText, templateText, sketchOf, sampleCtx, exampleOp };
