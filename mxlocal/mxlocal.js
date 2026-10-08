#!/usr/bin/env node
"use strict";
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emitWarning.call(process, w, ...rest));

const fs = require("fs");
const path = require("path");
const bson = require("./bson");
const { Project, backups, restore, BACKUP_DIR } = require("./mpr");
const { toPlain, fromPlain, toSdk, fromSdk } = require("./convert");
const { LocalClient, loadProject } = require("./client");
const pending = require("./pending");
const { lostProperties } = require("./lost");
const inspect = require("./inspect");

const out = s => process.stdout.write(s + "\n");

const USAGE = `mxlocal - Mendix Model SDK offline on a local .mpr (v2)

  node mxlocal.js run <change.json|change.js> --project <app.mpr|folder>
        Dry run: computes the change, writes nothing, prints it and an approval code.
  node mxlocal.js apply --code <CODE> --project <app.mpr|folder>
        Writes the change of the last dry run (Studio Pro closed). CODE comes from that dry run.
  node mxlocal.js restore --project <app.mpr|folder> [--backup <name>]
        Undoes the last (or the given) apply.
  node mxlocal.js api <Type>            SDK type: properties, enum values, createIn functions
  node mxlocal.js find <text> --project <app.mpr|folder>
                                        model elements whose qualified name contains <text>
  node mxlocal.js ops                   the operations a change.json can use
  node mxlocal.js verify --project ...  read-only self check (byte roundtrip + SDK mapping)
  node mxlocal.js open --project ...    load every unit through the Model SDK, report problems
  node mxlocal.js selftest --project ... [--keep]
                                        run every operation on a temporary copy and check the result

  change.json: { "ops": [ { "op": "addAttribute", "entity": "Module.Entity", "name": "Note", "type": "String(200)" } ] }
  change.js:   module.exports = async ({ model, sdk, ops, log }) => { ... }   (ops = the same operations as functions)`;

function args(argv) {
    const a = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith("--")) {
            const k = argv[i].slice(2);
            a[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
        } else a._.push(argv[i]);
    }
    return a;
}

function findMpr(p) {
    if (!p || p === true) throw new Error("--project is required");
    p = path.resolve(p);
    if (fs.statSync(p).isDirectory()) {
        const m = fs.readdirSync(p).filter(f => f.endsWith(".mpr"));
        if (m.length !== 1) throw new Error(`Expected exactly one .mpr in ${p}, found ${m.length}`);
        return path.join(p, m[0]);
    }
    return p;
}

function same(a, b) {
    if (a === b) return true;
    if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
    if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
    return Object.keys(b).every(k => same(a[k], b[k]));
}

function count(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function top(map, n = 15) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `    ${v}x ${k}`).join("\n");
}

async function verify(mpr) {
    const { project, schema } = await loadProject(mpr);
    const noHint = (t, k) => {
        throw new Error(`no kind for ${t}.${k}`);
    };
    const known = o => o && typeof o === "object" && schema.info(schema.sdkType(o.$Type));
    let bytesOk = 0, plainOk = 0;
    const failures = [], unknownTypes = new Map(), unmapped = new Map(), wrong = new Map();
    const compare = (plain, back) => {
        for (const [key, v] of Object.entries(back)) {
            if (key === "$ID" || key === "$Type") continue;
            const orig = plain[key];
            if (v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v)) compare(orig, v);
            else if (Array.isArray(v) && Array.isArray(orig) && orig.some(x => x && typeof x === "object" && !Buffer.isBuffer(x))) {
                const kept = Array.isArray(orig) ? orig.filter(known) : [];
                if (kept.length !== v.length) count(wrong, `${plain.$Type}.${key} (list length)`);
                else v.forEach((x, i) => compare(kept[i], x));
            } else if (!same(orig, v)) count(wrong, `${plain.$Type}.${key} (${JSON.stringify(orig)} -> ${JSON.stringify(v)})`);
        }
        const info = schema.info(schema.sdkType(plain.$Type));
        for (const key of Object.keys(plain)) if (key[0] !== "$" && !info.byKey.has(key)) count(unmapped, `${plain.$Type}.${key}`);
    };
    for (const [id] of project.units) {
        const bytes = project.readBytes(id);
        const typed = bson.decode(bytes);
        if (bson.encode(typed).equals(bytes)) bytesOk++;
        else failures.push(`bytes ${id}`);
        const plain = toPlain(typed);
        if (bson.encode(fromPlain(plain, noHint)).equals(bytes)) plainOk++;
        else failures.push(`plain ${id} (${plain.$Type})`);
        const unknown = new Set();
        const sdk = toSdk(plain, schema, { unknown });
        for (const t of unknown) count(unknownTypes, t);
        if (sdk) compare(plain, fromSdk(sdk, schema));
    }
    const n = project.units.size;
    out(`Project: ${project.mpr} (Mendix ${project.meta._ProductVersion}), ${n} units`);
    out(`1. BSON byte roundtrip:      ${bytesOk}/${n} identical`);
    out(`2. Plain store roundtrip:    ${plainOk}/${n} identical`);
    out(`3. SDK mapping roundtrip:    ${wrong.size === 0 ? "all mapped values identical" : wrong.size + " differing properties"}`);
    if (wrong.size) out(top(wrong));
    out(`   Names learned from this project: ${schema.pairs.length}`);
    if (schema.pairs.length) out(schema.pairs.map(p => "    " + p).join("\n"));
    out(`   Element types unknown to the SDK (kept as-is, invisible to scripts): ${unknownTypes.size}`);
    if (unknownTypes.size) out(top(unknownTypes));
    out(`   BSON keys without an SDK property (kept as-is, invisible to scripts): ${unmapped.size}`);
    if (unmapped.size) out(top(unmapped, 100));
    if (failures.length) out("Failures:\n    " + failures.slice(0, 20).join("\n    "));
    return bytesOk === n && plainOk === n && wrong.size === 0;
}

async function openAll(mpr) {
    const ctx = await loadProject(mpr);
    const client = new LocalClient(ctx);
    const model = await client.open();
    const errors = [];
    const units = model.allUnits().filter(u => u.isLoadable && !u.isLoaded);
    for (const u of units) {
        try {
            await model.loadUnitById(u.id, false);
        } catch (e) {
            errors.push(`${u.structureTypeName} ${u.id}: ${e.message}`);
        }
    }
    return { client, model, errors, loaded: units.length };
}

async function open(mpr) {
    const { client, model, errors, loaded } = await openAll(mpr);
    const byType = new Map();
    for (const u of model.allUnits()) count(byType, u.structureTypeName);
    await model.flushChanges();
    out(`Opened ${client.project.mpr} with the Model SDK: ${model.allUnits().length} units (${loaded} loaded fully)`);
    out(top(byType, 40));
    out(`Load errors: ${errors.length}`);
    if (errors.length) out(errors.slice(0, 20).map(e => "    " + e).join("\n"));
    out(`Deltas produced by opening (must be 0): ${client.log.length}`);
    if (client.warnings.size) out("Warnings:\n" + [...client.warnings].map(w => "    " + w).join("\n"));
    return errors.length === 0 && client.log.length === 0;
}

// Storage types present in the encoded units (to drop warnings about elements a script created and replaced).
function typesIn(enc) {
    const types = new Set();
    const walk = n => {
        if (n.k !== 3 && n.k !== 4) return;
        for (const [k, x] of n.v) {
            if (k === "$Type") types.add(x.v);
            else walk(x);
        }
    };
    for (const f of enc.files) walk(bson.decode(f.bytes));
    return types;
}

function relevant(warnings, enc) {
    const types = typesIn(enc);
    return warnings.filter(w => {
        if (/is not known to the Model SDK; left untouched/.test(w)) return false;
        const t = /^(\w+\$\w+)[ .]/.exec(w);
        return !t || types.has(t[1]);
    });
}

function loadChange(file) {
    const full = path.resolve(file);
    if (full.endsWith(".json")) {
        let plan;
        try {
            plan = JSON.parse(fs.readFileSync(full, "utf8"));
        } catch (e) {
            throw new Error(`${file} is not valid JSON: ${e.message}`);
        }
        if (Array.isArray(plan)) plan = { ops: plan };
        if (!plan || !Array.isArray(plan.ops)) throw new Error(`${file} must contain { "ops": [ ... ] }`);
        return { plan };
    }
    delete require.cache[full];
    const fn = require(full);
    if (typeof fn !== "function") throw new Error(`${file} must export an async function`);
    return { fn };
}

async function run(file, mpr) {
    const change = loadChange(file);
    const ctx = await loadProject(mpr);
    const fingerprint = ctx.project.fingerprint();
    const client = new LocalClient(ctx);
    const model = await client.open();
    const ops = require("./ops").bind(model, client);
    const lines = [];
    const say = s => {
        lines.push(s);
        out(s);
    };
    let exprWarnings = [];
    if (change.plan) exprWarnings = await ops.runPlan(change.plan, s => say("  " + s));
    else {
        await change.fn({ model, sdk: require("mendixmodelsdk"), ops, log: s => say("  " + s) });
        exprWarnings = await ops.lintExpressions();
    }
    await model.flushChanges();
    const s = client.summary();
    say(`Changes: ${s.created.length} created, ${s.updated.length} updated, ${s.deleted.length} deleted unit(s)`);
    for (const x of s.created) say("  + " + x);
    for (const x of s.updated) say("  ~ " + x);
    for (const x of s.deleted) say("  - " + x);
    for (const x of s.renames) say("  rename " + x);
    if (!s.created.length && !s.updated.length && !s.deleted.length) {
        pending.clear(client.project.dir);
        return out("Nothing to write.");
    }
    const enc = client.encode();
    const lost = lostProperties(client, model, enc);
    const warnings = relevant(client.summary().warnings, enc);
    if (exprWarnings.length) say("EXPRESSION CHECK (Studio Pro will show these as errors; fix the change file):\n" + exprWarnings.map(w => "  ! " + w).join("\n"));
    if (lost.length) say("NOT STORED (the script set these, but this Mendix version does not keep them; use api <Type>):\n" + lost.map(w => "  ! " + w).join("\n"));
    if (s.leftovers.length) say("OLD NAME STILL USED (rename does not update expressions, XPath, Java; fix these too):\n" + s.leftovers.map(w => "  ! " + w).join("\n"));
    if (warnings.length) say("Warnings:\n" + warnings.map(w => "  ! " + w).join("\n"));
    const code = pending.save(client.project.dir, enc, { fingerprint, source: path.resolve(file), summary: lines, plan: change.plan });
    out(`Dry run: nothing written. Approval code: ${code}`);
    out(`After the user approves (Studio Pro closed): apply --code ${code}`);
}

async function apply(mpr, code) {
    const project = new Project(mpr);
    const p = pending.load(project.dir);
    if (!p) throw new Error("No dry run to apply. Run the change first (run <change>).");
    if (!code || code === true) throw new Error("apply needs --code <CODE> from the dry run, given by the user.");
    if (String(code).toUpperCase() !== p.code) throw new Error(`Code ${code} does not match the last dry run (${p.source}). Show the user the latest dry run and use its code.`);
    project.assertClosed();
    if (project.fingerprint() !== p.fingerprint) {
        pending.clear(project.dir);
        throw new Error("The model changed since the dry run (Studio Pro save, pull or other apply). Run the dry run again.");
    }
    const r = project.writeEncoded({ files: p.files, created: p.created, deleted: p.deleted });
    fs.writeFileSync(path.join(r.backup, "change.txt"), `Source: ${p.source}\n${p.summary.join("\n")}\n`);
    pending.clear(project.dir);
    out(`Saved ${r.written} unit file(s), deleted ${r.deleted}. Backup: ${path.relative(project.dir, r.backup)}`);
    if (p.plan) {
        const ctx = await loadProject(mpr);
        const client = new LocalClient(ctx);
        const model = await client.open();
        const failed = await require("./ops").bind(model, client).checkPlan(p.plan);
        if (failed.length) out("CHECK FAILED - the saved model does not show:\n" + failed.map(f => "  ! " + f).join("\n") + "\nUndo with restore, fix the change, dry run again.");
        else out(`Checked: all ${p.plan.ops.length} operation(s) are in the saved model.`);
        process.exitCode = failed.length ? 1 : 0;
    }
}

// Runs every op on a temporary copy of the project: dry run, apply, checks, byte roundtrip, SDK reopen.
// Proves the ops work for this project's Mendix version before they touch the real model.
async function selftest(mpr, keep) {
    const os = require("os");
    const src = new Project(mpr);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-selftest-"));
    try {
        fs.copyFileSync(src.mpr, path.join(tmp, path.basename(src.mpr)));
        fs.cpSync(src.contents, path.join(tmp, "mprcontents"), { recursive: true });
        const copy = path.join(tmp, path.basename(src.mpr));
        const ctx = await loadProject(copy);
        const client = new LocalClient(ctx);
        const model = await client.open();
        const custom = model.allModules().filter(m => !m.fromAppStore);
        const mod = (custom.find(m => m.name === "MyFirstModule") || custom[0] || model.allModules()[0]).name;
        const role = model.allModules().map(m => m.name).includes(mod) ? `${mod}.ZzRole` : null;
        const T = "ZzMxlocalTest";
        const plan = { ops: [
            { op: "createEnumeration", module: mod, name: `${T}Status`, values: ["Open", { name: "Done", caption: "Done!" }] },
            { op: "createEntity", module: mod, name: T, attributes: [
                { name: "Title", type: "String(100)" }, { name: "Count", type: "Integer" }, { name: "Big", type: "Long" },
                { name: "Amount", type: "Decimal" }, { name: "Flag", type: "Boolean" }, { name: "When", type: "DateTime" },
                { name: "Status", type: `Enum(${mod}.${T}Status)`, default: "Open" }, { name: "No", type: "AutoNumber" }] },
            { op: "createEntity", module: mod, name: `${T}Line`, persistable: true },
            { op: "addAttribute", entity: `${mod}.${T}Line`, name: "Text", type: "String(unlimited)" },
            { op: "addAssociation", from: `${mod}.${T}Line`, to: `${mod}.${T}` },
            { op: "addEnumerationValue", enumeration: `${mod}.${T}Status`, name: "Cancelled" },
            { op: "changeAttribute", attribute: `${mod}.${T}.Title`, type: "String(200)" },
            { op: "createModuleRole", module: mod, name: "ZzRole" },
            { op: "addAccessRule", entity: `${mod}.${T}`, roles: [role], access: "ReadWrite", create: true, members: { Count: "ReadOnly" } },
            { op: "createMicroflow", module: mod, name: `${T}_Sub`, folder: "ZzTest", parameters: [{ name: "Item", type: `${mod}.${T}` }],
                returns: "Boolean", returnValue: "true", actions: [{ action: "log", message: "sub {1}", args: ["$Item/Title"] }] },
            { op: "createMicroflow", module: mod, name: `${T}_Main`, folder: "ZzTest", roles: [role], actions: [
                { action: "variable", name: "N", type: "Integer", value: "0" },
                { action: "retrieve", variable: "List", entity: `${mod}.${T}`, xpath: "[Flag = true()]" },
                { action: "retrieve", variable: "One", entity: `${mod}.${T}`, first: true },
                { action: "create", variable: "New", entity: `${mod}.${T}`, set: { Title: "'x'", Count: "1" }, commit: false },
                { action: "change", variable: "New", set: { Flag: "true" } },
                { action: "commit", variable: "New" },
                { action: "call", microflow: `${mod}.${T}_Sub`, args: { Item: "$New" }, variable: "Ok" },
                { action: "set", name: "N", value: "$N + 1" },
                { action: "message", text: "Done", type: "Information" },
                { action: "delete", variable: "New" }] },
            { op: "addActions", microflow: `${mod}.${T}_Main`, after: "One", actions: [{ action: "log", message: "inserted" }] },
            { op: "addActions", microflow: `${mod}.${T}_Main`, actions: [{ action: "log", message: "last" }] },
            { op: "rename", target: `${mod}.${T}.Flag`, newName: "Active" },
            { op: "grantAccess", document: `${mod}.${T}_Sub`, roles: [role] }
        ] };
        const ops = require("./ops").bind(model, client);
        await ops.runPlan(plan, () => {});
        await model.flushChanges();
        const enc = client.encode();
        const lost = lostProperties(client, model, enc);
        const s = client.summary();
        client.project.writeEncoded(enc);
        const results = [];
        const check = (name, ok, detail) => results.push(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
        check("dry run + apply of " + plan.ops.length + " ops", true, `${s.created.length} created, ${s.updated.length} updated unit(s)`);
        check("nothing lost on save", !lost.length, lost.join("; "));
        const ctx2 = await loadProject(copy);
        const c2 = new LocalClient(ctx2);
        const m2 = await c2.open();
        const failed = await require("./ops").bind(m2, c2).checkPlan(plan);
        check("saved model shows every op", !failed.length, failed.join("; "));
        let bytes = 0;
        for (const [id] of ctx2.project.units) if (bson.encode(bson.decode(ctx2.project.readBytes(id))).equals(ctx2.project.readBytes(id))) bytes++;
        check("byte roundtrip", bytes === ctx2.project.units.size, `${bytes}/${ctx2.project.units.size}`);
        const errors = [];
        for (const u of m2.allUnits().filter(u => u.isLoadable && !u.isLoaded)) {
            try {
                await m2.loadUnitById(u.id, false);
            } catch (e) {
                errors.push(e.message);
            }
        }
        await m2.flushChanges();
        check("reopen with the Model SDK", !errors.length && !c2.log.length, errors.length ? errors[0] : c2.log.length ? `${c2.log.length} deltas on open` : "");
        const firstUse = relevant(s.warnings, enc).filter(w => /first use|never occurs/.test(w));
        out(`Self test on a copy (module ${mod}, Mendix ${src.meta._ProductVersion}):`);
        out(results.map(r => "  " + r).join("\n"));
        if (firstUse.length) out("  Note: types new to this project (open the copy in Studio Pro to be sure): " + firstUse.map(w => w.split(" ")[0]).join(", "));
        const ok = results.every(r => r.startsWith("OK"));
        if (ok && !keep) fs.rmSync(tmp, { recursive: true, force: true });
        else out(`Copy kept: ${tmp} (open it in Studio Pro to inspect, then delete it)`);
        return ok;
    } catch (e) {
        out(`Self test FAILED: ${e.message}\nCopy kept for inspection: ${tmp}`);
        return false;
    }
}

function restoreCmd(mpr, name) {
    const dir = path.dirname(mpr);
    const all = backups(dir);
    const pick = name && name !== true ? name : all[all.length - 1];
    if (!pick) throw new Error("Nothing to undo: no applied change is left to restore (all were undone, or none was applied).");
    if (!all.includes(pick)) throw new Error(`No backup '${pick}' in ${path.join(dir, BACKUP_DIR)}. Backups: ${all.join(", ") || "(none)"}`);
    if (fs.existsSync(mpr + ".lock")) throw new Error("Studio Pro has this project open. Close it first.");
    const m = restore(dir, path.join(dir, BACKUP_DIR, pick));
    pending.clear(dir);
    fs.renameSync(path.join(dir, BACKUP_DIR, pick), path.join(dir, BACKUP_DIR, pick + ".restored"));
    out(`Restored ${pick}: ${m.restore.length} unit file(s) put back, ${m.remove.length} removed, ${m.mpr} restored.`);
}

async function main() {
    const started = Date.now();
    const a = args(process.argv.slice(2));
    const cmd = a._[0];
    if (!cmd || a.help) return out(USAGE);
    if (cmd === "ops") return out(require("./ops").help());
    if (cmd === "api") {
        if (!a._[1]) throw new Error("api needs a type name, e.g. api Attribute");
        const version = a.project ? new Project(findMpr(a.project)).version : a.version || "10.24.0";
        return out(inspect.api(a._.slice(1).join(" "), version));
    }
    const mpr = findMpr(a.project);
    let ok = true;
    if (cmd === "verify") ok = await verify(mpr);
    else if (cmd === "open") ok = await open(mpr);
    else if (cmd === "selftest") ok = await selftest(mpr, a.keep === true);
    else if (cmd === "run") {
        if (!a._[1]) throw new Error("run needs a change file (.json or .js)");
        if (a.apply) throw new Error("run only does a dry run now. Apply with: apply --code <CODE> (the code is printed by the dry run)");
        await run(a._[1], mpr);
    } else if (cmd === "apply") await apply(mpr, a.code);
    else if (cmd === "restore") restoreCmd(mpr, a.backup);
    else if (cmd === "find") {
        if (!a._[1]) throw new Error("find needs a text, e.g. find Customer");
        const ctx = await loadProject(mpr);
        out(inspect.find(new LocalClient(ctx), a._.slice(1).join(" ")));
    } else throw new Error(`Unknown command '${cmd}'.\n\n${USAGE}`);
    if (process.exitCode === undefined) process.exitCode = ok ? 0 : 1;
    if (!["verify", "open"].includes(cmd)) process.stderr.write(`(${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
}

// Known SDK/script errors -> what to do. Weak models fix errors much faster with a concrete next step.
const HINTS = [
    [/Please provide a container or model/, "createIn(parent) got undefined: the lookup before it found nothing. Check the name with: find <name>"],
    [/Cannot read propert(y|ies) of (undefined|null)/, "A lookup returned nothing (wrong name, or the unit is not loaded). Check names with find; use await ops.get(\"Module.Name\")."],
    [/is not a function/, "That function does not exist on this type. Check with: api <Type>"],
    [/is not available offline/, "Team Server, file and lock calls do not work locally. Remove that call."],
    [/Property '.*' of .* cannot be stored/, "This Mendix version has no such property. Check with: api <Type>"],
    [/not loaded|isLoaded|load\(\)/i, "Load the document first: const d = await ops.get(\"Module.Name\") (it loads for you)."],
    [/not found in the model/, "Check the exact name with: find <part of the name>"],
    [/unknown op|unknown field|unknown action|needs '/i, "List the operations and their fields with: ops"]
];

function report(e, file) {
    const msg = e && e.message ? e.message : String(e);
    const lines = ["ERROR: " + msg];
    const stack = (e && e.stack ? e.stack : "").split("\n").slice(1);
    const own = file && stack.find(l => l.includes(path.resolve(file)));
    if (own) lines.push("  at " + own.trim().replace(/^at /, ""));
    else if (!/^(No |Nothing |Code |The model|apply needs|run needs|Studio Pro|Expected|--project|Only|This project|Unknown command|Op \d)/.test(msg)) lines.push(...stack.slice(0, 4).map(l => "  " + l.trim()));
    const hint = HINTS.find(([re]) => re.test(msg));
    if (hint) lines.push("HINT: " + hint[1]);
    return lines.join("\n") + "\n";
}

main()
    .catch(e => {
        const a = args(process.argv.slice(2));
        process.stderr.write(report(e, a._[0] === "run" ? a._[1] : null));
        process.exitCode = 1;
    })
    .finally(() => setImmediate(() => process.exit()));
