"use strict";
// Checks agent/UI_KIT.md: every JSON block is valid JSON, and works as a change on a copy of a test project.
// Blocks with "ops" run as they are; a widget block runs inside a createPage (inside a list view of the example
// entity when it shows {Attribute} values). The example domain block and the recipes other recipes need (the edit
// page, the time clock) are applied first.
//
//   node scripts/check-ui-kit.js <app.mpr>      (a copy is made; the project is not changed)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MX = path.join(ROOT, "mxlocal", "mxlocal.js");
const md = fs.readFileSync(path.join(ROOT, "agent", "UI_KIT.md"), "utf8");

// json blocks with the recipe heading they are under
const blocks = [];
let heading = "intro";
const re = /^## (.+)$|^```json\n([\s\S]*?)^```/gm;
for (let m; (m = re.exec(md)); ) {
    if (m[1]) heading = m[1];
    else blocks.push({ heading, text: m[2] });
}
const problems = [];
for (const b of blocks) {
    try {
        b.json = JSON.parse(b.text);
    } catch (e) {
        problems.push(`${b.heading}: not valid JSON: ${e.message}`);
    }
}

const src = process.argv[2];
if (!src) {
    console.log(problems.length ? problems.join("\n") : `UI kit: ${blocks.length} JSON blocks are valid JSON (give a project to run them)`);
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

const ops = blocks.filter(b => b.json && b.json.ops);
const widgets = blocks.filter(b => b.json && !b.json.ops);
// what other recipes need, applied in this order
const first = ["Example domain", "R4 ", "R12 "];
for (const p of first) for (const b of ops.filter(x => x.heading.startsWith(p))) run(b.json, b.heading, true);
for (const b of ops.filter(x => !first.some(p => x.heading.startsWith(p)))) run(b.json, b.heading, false);
let n = 0;
for (const b of widgets) {
    const w = /\{[A-Z]\w*\}/.test(b.text) && b.json.widget !== "listView" && b.json.widget !== "gallery" && b.json.widget !== "dataGrid"
        ? { widget: "listView", entity: "MyFirstModule.Employee", widgets: [b.json] }
        : b.json;
    run({ ops: [{ op: "createPage", module: "MyFirstModule", name: `UiKitCheck${++n}`, widgets: [w] }] }, `${b.heading} (widget)`, false);
}
fs.rmSync(work, { recursive: true, force: true });
console.log(problems.length ? `UI KIT PROBLEMS (${problems.length}):\n  ${problems.join("\n  ")}` : `UI kit: all ${blocks.length} JSON blocks work`);
process.exit(problems.length ? 1 : 0);
