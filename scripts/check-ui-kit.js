"use strict";
// Checks the UI guides of the agent: agent/UI_DESIGN.md (principles + one-line atoms in tables + JSON blocks) and
// agent/UI_RECIPES.md (whole pages). Every JSON block and atom must be valid JSON; with a project, each one also runs
// as a change (dry run) on a copy of it. Blocks with "ops" run as they are; a widget runs inside a createPage, inside
// a data view of the example entity when it is an input or a save button, inside a list view of it when it shows
// {Attribute} values. The example domain of UI_RECIPES.md and the pages other blocks open are applied first.
//
//   node scripts/check-ui-kit.js [<app.mpr>]      (a copy is made; the project is not changed)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MX = path.join(ROOT, "mxlocal", "mxlocal.js");

// { file, heading, text, json } of the ```json blocks and the `{ "widget": ... }` atoms of table rows
function blocksOf(file) {
    const md = fs.readFileSync(path.join(ROOT, "agent", file), "utf8");
    const out = [];
    let heading = "intro";
    for (const line of md.split("\n")) if (/^#{2,3} /.test(line)) heading = line.replace(/^#+ /, "");
    const re = /^#{2,3} (.+)$|^```json\n([\s\S]*?)^```|^\|([^|\n]+)\| `(\{ "widget"[^`]*\})` \|/gm;
    heading = "intro";
    for (let m; (m = re.exec(md)); ) {
        if (m[1]) heading = m[1];
        else if (m[2]) out.push({ file, heading, text: m[2] });
        else out.push({ file, heading: `${heading}: ${m[3].trim()}`, text: m[4] });
    }
    return out;
}
const blocks = [...blocksOf("UI_DESIGN.md"), ...blocksOf("UI_RECIPES.md")];
const problems = [];
for (const b of blocks) {
    try {
        b.json = JSON.parse(b.text);
    } catch (e) {
        problems.push(`${b.file} ${b.heading}: not valid JSON: ${e.message}`);
    }
}

const src = process.argv[2];
if (!src) {
    console.log(problems.length ? problems.join("\n") : `UI guides: ${blocks.length} JSON blocks and atoms are valid JSON (give a project to run them)`);
    process.exit(problems.length ? 1 : 0);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), "uikit-"));
const proj = path.join(work, "app");
fs.cpSync(path.dirname(src), proj, { recursive: true, filter: f => !/[\\/](\.git|\.mxlocal-backup|deployment|node_modules)$/.test(f) });
const mpr = path.join(proj, path.basename(src));
fs.mkdirSync(path.join(proj, "edits"), { recursive: true });

const run = (plan, label, apply) => {
    const f = path.join(proj, "edits", "uikit.json");
    fs.writeFileSync(f, JSON.stringify(plan, null, 1));
    let out = "";
    try {
        out = execFileSync("node", [MX, "run", f, "--project", mpr], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
        out = String(e.stdout || "") + String(e.stderr || "");
    }
    const err = out.split("\n").find(l => /^ERROR/.test(l));
    const code = (/apply --code (\w+)/.exec(out) || [])[1];
    const checkErr = out.split("\n").filter(l => /CHECK/.test(l) && /[1-9]\d* error/.test(l));
    if (err || !code) problems.push(`${label}: ${err || out.split("\n").slice(-3).join(" | ")}`);
    else if (checkErr.length) problems.push(`${label}: ${checkErr.join(" | ")}`);
    else console.log(`OK   ${label}`);
    if (apply && code) execFileSync("node", [MX, "apply", "--code", code, "--project", mpr], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
};
const name = b => `${b.file.replace(/\.md$/, "")} ${b.heading}`;

const ops = blocks.filter(b => b.json && b.json.ops);
const widgets = blocks.filter(b => b.json && !b.json.ops);
// what other blocks need, applied in this order; then what the atoms of UI_DESIGN.md name
const first = ["Example domain", "R4 ", "R12 "];
for (const p of first) for (const b of ops.filter(x => x.heading.startsWith(p))) run(b.json, name(b), true);
run({ ops: [
    { op: "createEntity", module: "MyFirstModule", name: "Department", attributes: [{ name: "Name", type: "String(100)" }] },
    { op: "addAssociation", from: "MyFirstModule.Employee", to: "MyFirstModule.Department" },
    { op: "createMicroflow", module: "MyFirstModule", name: "ACT_Archive", actions: [{ action: "log", message: "archive" }] }
] }, "atoms setup (Department, ACT_Archive)", true);
for (const b of ops.filter(x => !first.some(p => x.heading.startsWith(p)))) run(b.json, name(b), false);
const INPUTS = ["input", "textArea", "comboBox", "referenceSelector", "referenceSetSelector"];
let n = 0;
for (const b of widgets) {
    const w = b.json;
    let content = [w];
    let entity;
    if (INPUTS.includes(w.widget) || (w.widget === "actionButton" && ["save", "delete"].includes(w.action))) {
        content = [{ widget: "dataView", source: "parameter", widgets: [w], buttons: false }];
        entity = "MyFirstModule.Employee";
    } else if ((/\{[A-Z]\w*\}/.test(b.text) || (w.widget === "actionButton" && w.action === "showPage")) && !["listView", "gallery", "dataGrid"].includes(w.widget)) content = [{ widget: "listView", entity: "MyFirstModule.Employee", widgets: [w] }];
    run({ ops: [{ op: "createPage", module: "MyFirstModule", name: `UiKitCheck${++n}`, ...(entity ? { entity } : {}), widgets: content }] }, `${name(b)} (widget)`, false);
}
fs.rmSync(work, { recursive: true, force: true });
console.log(problems.length ? `UI GUIDE PROBLEMS (${problems.length}):\n  ${problems.join("\n  ")}` : `UI guides: all ${blocks.length} JSON blocks and atoms work`);
process.exit(problems.length ? 1 : 0);
