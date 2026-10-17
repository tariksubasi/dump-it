#!/usr/bin/env node
"use strict";
// A FAKE Mendix "mx" for the tests of mxlocal/mxcheck.js (scripts/test-mxcheck.js copies it to <version>/modeler/mx).
// It behaves like the real one as far as known (mendixlabs/mxcli: check.json, docs): "mx check <app.mpr> [-j <file>]
// [-w] [-d]", writes theme-cache/ and deployment/ into the project it checks, prints "[error] [CExxxx] "msg" at ..."
// lines and "The app contains: N errors.", exit code 1 when there are errors.
//
// Problems it reports, read from the model (mxlocal/mpr.js):
//   always       CE0463 on the first page (by name): a pre-existing error the baseline must subtract
//   always       CW0001 (warning) on the first microflow
//   FAKE_MX_FLAG (regex, default ^ZzBroken): CE0117 "Error(s) in expression." on every document whose name matches
// Modes: FAKE_MX_NOJSON=1 (-j unknown: usage + exit 2), FAKE_MX_CRASH=1 (stack trace, no verdict, exit 1),
//        FAKE_MX_SLEEP=<s>, FAKE_MX_LOG=<file> (appends the .mpr path it was given), FAKE_MX_WRAP=1 (wrapped messages)
// FAKE_MX_LIB: the mxlocal folder (when the fake is copied elsewhere)
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const log = process.env.FAKE_MX_LOG;
if (args[0] !== "check" || !args[1]) {
    console.log("Usage: mx check <project.mpr> [-j <file>] [-w] [-d]");
    process.exit(2);
}
const mpr = path.resolve(args[1]);
if (log) fs.appendFileSync(log, mpr + "\n");
if (process.env.FAKE_MX_NOJSON && args.includes("-j")) {
    console.log("Unknown option '-j'.\nUsage: mx check <project.mpr>");
    process.exit(2);
}
if (process.env.FAKE_MX_SLEEP) {
    const until = Date.now() + Number(process.env.FAKE_MX_SLEEP) * 1000;
    while (Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
}
// like the real mx: build output inside the project it checks
fs.mkdirSync(path.join(path.dirname(mpr), "theme-cache"), { recursive: true });
fs.writeFileSync(path.join(path.dirname(mpr), "theme-cache", "fake.css"), "/* fake */\n");
fs.mkdirSync(path.join(path.dirname(mpr), "deployment", "sass"), { recursive: true });

console.log("Checking app for errors...");
if (process.env.FAKE_MX_CRASH) {
    console.log("System.ArgumentException: Object of type 'Mendix.Modeler.WebUI.Navigation.HomePage' cannot be converted to type 'NotFoundHomePage'.");
    console.log("   at Mendix.Modeler.Storage.Loader.Load(String path)");
    process.exit(1);
}

const { Project } = require(path.join(process.env.FAKE_MX_LIB || path.join(__dirname, "..", "mxlocal"), "mpr.js"));
const project = new Project(mpr);
const docs = [];
for (const [id, u] of project.units) {
    const x = project.read(id);
    if (!x.Name || !/^(Forms\$Page|Microflows\$(Micro|Nano)flow|DomainModels|Enumerations|Constants)/.test(x.$Type)) continue;
    let c = u.containerId, mod = null;
    for (let i = 0; c && i < 20 && !mod; i++) {
        const cu = project.units.get(c);
        if (!cu) break;
        const cx = project.read(c);
        if (cx.$Type === "Projects$ModuleImpl") mod = cx.Name;
        c = cu.containerId;
    }
    const kind = { "Forms$Page": "Page", "Microflows$Microflow": "Microflow", "Microflows$Nanoflow": "Nanoflow" }[x.$Type] || x.$Type.split("$")[1];
    docs.push({ id, name: x.Name, mod: mod || "", kind });
}
docs.sort((a, b) => (a.mod + a.name).localeCompare(b.mod + b.name));
const loc = (d, element) => ({ "module-id": "00000000-0000-0000-0000-000000000000", "module-name": d.mod, "document-name": `${d.kind} '${d.name}'`, "element-name": element, "element-id": d.id, "unit-id": d.id });
const errors = [], warnings = [];
const page = docs.find(d => d.kind === "Page");
if (page) errors.push({ code: "CE0463", message: "The definition of this widget has changed. Update this widget by right-clicking it and selecting 'Update widget', or select 'Update all widgets' to update all widgets in the app.", locations: [loc(page, "Data grid 2 'dgFake'")] });
const flag = new RegExp(process.env.FAKE_MX_FLAG || "^ZzBroken");
for (const d of docs.filter(d => flag.test(d.name))) errors.push({ code: "CE0117", message: "Error(s) in expression.", locations: [loc(d, `${d.kind} '${d.mod}.${d.name}'`)] });
const mf = docs.find(d => d.kind === "Microflow");
if (mf) warnings.push({ code: "CW0001", message: "This microflow is not used.", locations: [loc(mf, `Microflow '${mf.mod}.${mf.name}'`)] });

const j = args.indexOf("-j");
if (j > 0 && args[j + 1]) fs.writeFileSync(args[j + 1], JSON.stringify({ serialization_version: 1, errors, warnings: args.includes("-w") ? warnings : [], deprecations: [], "total-problems": errors.length + warnings.length }, null, 2));
for (const [sev, list] of [["error", errors], ["warning", warnings]]) {
    for (const e of list) {
        const l = e.locations[0];
        const msg = process.env.FAKE_MX_WRAP ? e.message.replace(/(.{40}\S*) /, "$1\n                  ") : e.message;
        console.log(`[${sev}] [${e.code}] "${msg}" at ${l["element-name"]}`);
    }
}
console.log(`The app contains: ${errors.length} error${errors.length === 1 ? "" : "s"}.`);
process.exit(errors.length ? 1 : 0);
