"use strict";
// Runs every screen template (mxlocal/screens) on a copy of a test project: the example domain
// (mxlocal/screens/fixture.js) is applied first, then each template's example createScreen as a dry run. Fails on an
// ERROR, a CHECK with errors, or a sketch line wider than its box. Without a project: only the catalog and sketches.
//
//   node scripts/check-screens.js [<app.mpr>] [--only <id prefix>]
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MX = path.join(ROOT, "mxlocal", "mxlocal.js");
const reg = require(path.join(ROOT, "mxlocal", "screens"));
const { FIXTURE } = require(path.join(ROOT, "mxlocal", "screens", "fixture"));

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const src = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
const problems = [];

// offline: every template builds and sketches
for (const t of reg.byId.values()) {
    if (only && !t.id.startsWith(only)) continue;
    try {
        const lines = reg.sketchOf(t);
        if (!lines.length) problems.push(`${t.id}: empty sketch`);
        for (const k of ["id", "name", "desc", "build"]) if (!t[k]) problems.push(`${t.id}: no ${k}`);
        if (!t.example) problems.push(`${t.id}: no example slots`);
    } catch (e) {
        problems.push(`${t.id}: does not build: ${e.message}`);
    }
}
if (!src) {
    console.log(problems.length ? problems.join("\n") : `screens: ${reg.byId.size} templates in ${reg.categories.length} categories build and sketch (give a project to run them)`);
    process.exit(problems.length ? 1 : 0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "screens-"));
const proj = path.join(work, "app");
fs.cpSync(path.dirname(src), proj, { recursive: true, filter: f => !/[\\/](\.git|\.mxlocal-backup|deployment|node_modules)$/.test(f) });
const mpr = path.join(proj, path.basename(src));
fs.mkdirSync(path.join(proj, "edits"), { recursive: true });
const run = (plan, label, apply) => {
    const f = path.join(proj, "edits", "screen.json");
    fs.writeFileSync(f, JSON.stringify(plan, null, 1));
    let out = "";
    try {
        out = execFileSync("node", [MX, "run", f, "--project", mpr], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
    } catch (e) {
        out = String(e.stdout || "") + String(e.stderr || "");
    }
    const err = out.split("\n").find(l => /^ERROR/.test(l));
    const code = (/apply --code (\w+)/.exec(out) || [])[1];
    const checkErr = out.split("\n").filter(l => /CHECK/.test(l) && /[1-9]\d* error/.test(l));
    if (err || !code) problems.push(`${label}: ${(err || out.split("\n").slice(-3).join(" | ")).slice(0, 400)}`);
    else if (checkErr.length) problems.push(`${label}: ${checkErr.join(" | ")}`);
    else console.log(`OK   ${label}`);
    if (apply && code) execFileSync("node", [MX, "apply", "--code", code, "--project", mpr], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out;
};
run({ ops: FIXTURE }, "fixture (example domain)", true);
for (const t of reg.byId.values()) {
    if (only && !t.id.startsWith(only)) continue;
    const name = `Scr_${t.id.replace(/\W/g, "_")}`;
    run({ ops: [{ op: "createScreen", module: "MyFirstModule", name, template: t.id, slots: t.example || {} }] }, t.id, false);
}
fs.rmSync(work, { recursive: true, force: true });
console.log(problems.length ? `SCREEN PROBLEMS (${problems.length}):\n  ${problems.join("\n  ")}` : `screens: all ${only ? "selected" : reg.byId.size} templates work`);
process.exit(problems.length ? 1 : 0);
