#!/usr/bin/env node
"use strict";
// Node 22.1+: keep compiled code of the Model SDK between runs (it is most of the start-up time).
try {
    require("module").enableCompileCache(require("path").join(__dirname, ".cache", "compile"));
} catch {
    // older Node or read-only folder: start without it
}
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emitWarning.call(process, w, ...rest));

const fs = require("fs");
const path = require("path");
const bson = require("./bson");
const { Project, backups, restore, BACKUP_DIR } = require("./mpr");
const { toPlain, fromPlain, toSdk, fromSdk } = require("./convert");
// The Model SDK loads in ~250 ms; api does not need it, so client.js loads on first use.
const loadProject = mpr => require("./client").loadProject(mpr);
class LocalClient {
    constructor(ctx) {
        return new (require("./client").LocalClient)(ctx);
    }
}
const pending = require("./pending");
const { lostProperties } = require("./lost");
const inspect = require("./inspect");

let out = s => process.stdout.write(s + "\n");
const setOutput = fn => (out = fn); // serve.js collects the output of a command instead of printing it

const USAGE = `mxlocal - Mendix Model SDK offline on a local .mpr (v2)

  node mxlocal.js run <change.json|change.js> --project <app.mpr|folder>
        Dry run: computes the change, writes nothing, prints it and an approval code.
  node mxlocal.js apply --code <CODE> --project <app.mpr|folder>
        Writes the change of the last dry run (Studio Pro closed). CODE comes from that dry run.
  node mxlocal.js restore --project <app.mpr|folder> [--backup <name>] [--force]
        Undoes the last (or the given) apply. Refuses when the model changed after that apply (it would erase
        that work) unless --force.
  node mxlocal.js api <Type> [word] --project <app.mpr|folder>
                                        SDK type for the project's Mendix version: properties, enum values,
                                        createIn functions, what replaced removed types/properties
  node mxlocal.js find <text> --project <app.mpr|folder>
                                        model elements whose qualified name contains <text>
  node mxlocal.js steps <Module.Flow> --project <app.mpr|folder>
                                        the steps of a microflow/nanoflow with ids (for changeAction/deleteAction)
  node mxlocal.js widgets <Module.Page> --project <app.mpr|folder>
                                        the widget tree of a page or snippet: names, kinds, entity, where new
                                        widgets can go (for addWidgets/changeWidget/deleteWidget/moveWidget)
  node mxlocal.js widgettype [name] --project <app.mpr|folder>
                                        the pluggable widgets in widgets/*.mpk; with a name: its properties
                                        (types, defaults, values) for { "widget": "pluggable", "properties": ... }
  node mxlocal.js texts [Module|Module.Doc|menu] [--missing <lang>] --project <app.mpr|folder>
                                        translatable texts (titles, captions, labels, messages, enumeration and menu
                                        captions) in every project language (for setTranslations)
  node mxlocal.js ops [name]            the operations a change.json can use (with a name: its fields)
  node mxlocal.js serve --project ... --edits <dir> [--allow-apply]
                                        MCP server (stdio) with these commands as tools; keeps the project loaded
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

function loadChange(file, allowJs) {
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
    // A script runs with full Node rights before any approval, so it needs an explicit switch from the user.
    if (!allowJs) throw new Error(`${path.basename(file)} is a script. Scripts are off: use operations (ops). If no operation fits, record the gap and give the user the Studio Pro steps.`);
    delete require.cache[full];
    const fn = require(full);
    if (typeof fn !== "function") throw new Error(`${file} must export an async function`);
    return { fn };
}

// ctx: an already loaded project (serve.js keeps one in memory); otherwise it is loaded here.
async function run(file, mpr, allowJs, ctx) {
    const change = loadChange(file, allowJs);
    ctx = ctx || (await loadProject(mpr));
    const fingerprint = ctx.project.fingerprint();
    const client = new LocalClient(ctx);
    const model = await client.open();
    client.changeFile = path.resolve(file); // files an op reads (addImage) are relative to the export folder
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
    say(`Changes: ${s.created.length} created, ${s.updated.length} updated, ${s.deleted.length} deleted${s.moved.length ? `, ${s.moved.length} moved` : ""} unit(s)`);
    for (const x of s.created) say("  + " + x);
    for (const x of s.updated) say("  ~ " + x);
    for (const x of s.deleted) say("  - " + x);
    for (const x of s.moved) say("  > " + x);
    for (const x of s.renames) say("  rename " + x);
    for (const [rel, x] of client.extraFiles || []) say(`  ${x.before ? "~" : "+"} file ${rel}`);
    if (!s.created.length && !s.updated.length && !s.deleted.length && !s.moved.length) {
        pending.clear(client.project.dir);
        out("Nothing to write.");
        return { client };
    }
    const enc = client.encode();
    const lost = lostProperties(client, model, enc);
    const warnings = relevant(client.summary().warnings, enc);
    if (exprWarnings.length) say("EXPRESSION CHECK (Studio Pro will show these as errors; fix the change file):\n" + exprWarnings.map(w => "  ! " + w).join("\n"));
    if (lost.length) say("NOT STORED (the script set these, but this Mendix version does not keep them; use api <Type>):\n" + lost.map(w => "  ! " + w).join("\n"));
    if (s.leftovers.length) say("OLD NAME STILL USED (rename does not update expressions, XPath, Java; fix these too):\n" + s.leftovers.map(w => "  ! " + w).join("\n"));
    if (warnings.length) say("Warnings:\n" + warnings.map(w => "  ! " + w).join("\n"));
    const code = pending.save(client.project.dir, enc, { fingerprint, source: path.resolve(file), summary: lines, plan: change.plan,
        content: fs.readFileSync(path.resolve(file), "utf8") });
    out(`Dry run: nothing written. Approval code: ${code}`);
    out(`After the user approves (Studio Pro closed): apply --code ${code}`);
    return { client, code };
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
    const r = project.writeEncoded({ files: p.files, created: p.created, deleted: p.deleted, moved: p.moved || [], extra: p.extra || [] });
    // The change itself goes into the backup, so it can be run again after an undo even if edits/ was cleaned.
    fs.writeFileSync(path.join(r.backup, "change.txt"), `Source: ${p.source}\n${p.summary.join("\n")}\n`);
    if (p.content !== undefined) fs.writeFileSync(path.join(r.backup, "change" + path.extname(p.source || ".json")), p.content);
    fs.writeFileSync(path.join(r.backup, "after.json"), JSON.stringify({ fingerprint: project.fingerprint(), units: unitHashes(project), files: fileHashes(project.dir, r.files) }));
    pending.clear(project.dir);
    out(`Saved ${r.written} unit file(s), deleted ${r.deleted}${r.moved ? `, moved ${r.moved}` : ""}${r.files.length ? `, wrote ${r.files.join(", ")}` : ""}. Backup: ${path.relative(project.dir, r.backup)}`);
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

// rel -> sha256 of files apply wrote (Java/JavaScript sources), to notice later edits before an undo.
function fileHashes(dir, rels) {
    return Object.fromEntries((rels || []).map(rel => [rel, fs.existsSync(path.join(dir, rel)) ? require("crypto").createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex") : null]));
}

// UnitID -> ContentsHash of the saved model.
function unitHashes(project) {
    const fresh = new Project(project.mpr);
    return Object.fromEntries([...fresh.units.values()].map(u => [u.id, u.hash]));
}

// Units that differ between two unitHashes() results, as "Type Name" lines.
function changedUnits(project, before, now) {
    const ids = new Set([...Object.keys(before), ...Object.keys(now)]);
    const label = id => {
        try {
            const u = project.read(id);
            const unit = project.units.get(id);
            const owner = unit && unit.containerId && project.units.has(unit.containerId) ? project.read(unit.containerId).Name : null;
            return `${u.$Type} ${u.Name || (owner ? "of " + owner : id)}`;
        } catch {
            return `unit ${id}`;
        }
    };
    const lines = [];
    for (const id of ids) {
        if (before[id] === now[id]) continue;
        lines.push(!(id in before) ? `new: ${label(id)}` : !(id in now) ? `deleted: unit ${id}` : `changed: ${label(id)}`);
    }
    return lines;
}

function restoreCmd(mpr, name, force) {
    const dir = path.dirname(mpr);
    const all = backups(dir);
    const pick = name && name !== true ? name : all[all.length - 1];
    if (!pick) throw new Error("Nothing to undo: no applied change is left to restore (all were undone, or none was applied).");
    if (!all.includes(pick)) throw new Error(`No backup '${pick}' in ${path.join(dir, BACKUP_DIR)}. Backups: ${all.join(", ") || "(none)"}`);
    if (fs.existsSync(mpr + ".lock")) throw new Error("Studio Pro has this project open. Close it first.");
    const backup = path.join(dir, BACKUP_DIR, pick);
    const project = new Project(mpr);
    const afterFile = path.join(backup, "after.json");
    if (fs.existsSync(afterFile)) {
        const after = JSON.parse(fs.readFileSync(afterFile, "utf8"));
        if (after.fingerprint !== project.fingerprint() && force !== true) {
            const lines = changedUnits(project, after.units, unitHashes(project));
            throw new Error(`The model changed after this apply (Studio Pro save, pull or a later apply). Undo would erase that work:\n` +
                lines.slice(0, 15).map(l => "  " + l).join("\n") + (lines.length > 15 ? `\n  ... ${lines.length - 15} more` : "") +
                `\nUndo the later changes first (newest first), or ask the user whether to undo anyway with --force (that loses the changes above).`);
        }
    }
    // source files apply wrote and the user changed since (e.g. implemented the Java action): never lost silently
    if (fs.existsSync(afterFile)) {
        const files = JSON.parse(fs.readFileSync(afterFile, "utf8")).files || {};
        const edited = Object.keys(files).filter(rel => fileHashes(dir, [rel])[rel] !== files[rel]);
        if (edited.length && force !== true) throw new Error(`These files changed after the apply; undo would replace or remove them:\n${edited.map(e => "  " + e).join("\n")}\nSave your code elsewhere, or undo anyway with --force (the edited files are kept in the backup's orphans folder).`);
        for (const rel of edited) {
            if (!fs.existsSync(path.join(dir, rel))) continue;
            fs.mkdirSync(path.dirname(path.join(backup, "orphans", rel)), { recursive: true });
            fs.copyFileSync(path.join(dir, rel), path.join(backup, "orphans", rel));
        }
    }
    const before = new Set(project.units.keys());
    const m = restore(dir, backup);
    // Units created after this apply (e.g. by a Studio Pro save) lose their row; move their files aside, never delete.
    const restored = new Project(mpr).units;
    const orphans = [...before].filter(id => !restored.has(id) && fs.existsSync(project.unitFile(id)));
    for (const id of orphans) {
        const rel = path.relative(dir, project.unitFile(id));
        fs.mkdirSync(path.dirname(path.join(backup, "orphans", rel)), { recursive: true });
        fs.renameSync(project.unitFile(id), path.join(backup, "orphans", rel));
    }
    pending.clear(dir);
    fs.renameSync(backup, backup + ".restored");
    out(`Restored ${pick}: ${m.restore.length} unit file(s) put back, ${m.remove.length} removed, ${m.mpr} restored.` +
        (orphans.length ? ` ${orphans.length} unit file(s) of later changes moved to ${path.relative(dir, backup)}.restored/orphans.` : ""));
}

async function main() {
    const started = Date.now();
    const a = args(process.argv.slice(2));
    const cmd = a._[0];
    if (!cmd || a.help) return out(USAGE);
    if (cmd === "ops") return out(require("./ops").help(a._[1]));
    if (cmd === "doccheck") {
        const { count, problems } = require("./doccheck").doccheck();
        out(problems.length ? `DOC PROBLEMS (${problems.length}):\n` + problems.map(p => "  ! " + p).join("\n") : `Docs OK: ${count} JSON examples valid, every operation and action described.`);
        process.exitCode = problems.length ? 1 : 0;
        return;
    }
    if (cmd === "api") {
        if (!a._[1]) throw new Error("api needs a type name, e.g. api Attribute");
        const version = a.project ? new Project(findMpr(a.project)).version : require("./versions").normalize(a.version);
        if (!version) throw new Error("--project <app.mpr|folder> is required: api answers for the project's Mendix version (or give --version 10.24.0)");
        return out(inspect.api(a._.slice(1).join(" "), version));
    }
    const mpr = findMpr(a.project);
    let ok = true;
    if (cmd === "verify") ok = await verify(mpr);
    else if (cmd === "open") ok = await open(mpr);
    else if (cmd === "selftest") ok = await require("./selftest").selftest(mpr, a.keep === true, { out, relevant });
    else if (cmd === "serve") return require("./serve").serve(mpr, path.resolve(a.edits && a.edits !== true ? a.edits : "edits"), a["allow-apply"] === true);
    else if (cmd === "run") {
        if (!a._[1]) throw new Error("run needs a change file (.json or .js)");
        if (a.apply) throw new Error("run only does a dry run now. Apply with: apply --code <CODE> (the code is printed by the dry run)");
        await run(a._[1], mpr, a["allow-js"] === true);
    } else if (cmd === "apply") await apply(mpr, a.code);
    else if (cmd === "restore") restoreCmd(mpr, a.backup, a.force);
    else if (cmd === "steps") {
        if (!a._[1]) throw new Error("steps needs a microflow or nanoflow, e.g. steps Module.ACT_Save");
        const ctx = await loadProject(mpr);
        const client = new LocalClient(ctx);
        const model = await client.open();
        out(await require("./ops").bind(model, client).steps(a._[1]));
    } else if (cmd === "widgets") {
        if (!a._[1]) throw new Error("widgets needs a page or snippet, e.g. widgets Module.Customer_Edit");
        const ctx = await loadProject(mpr);
        const client = new LocalClient(ctx);
        const model = await client.open();
        out(await require("./ops").bind(model, client).widgets(a._[1]));
    } else if (cmd === "widgettype" || cmd === "widgettypes") {
        const ctx = await loadProject(mpr);
        const client = new LocalClient(ctx);
        const model = await client.open();
        out(await require("./ops").bind(model, client).widgetType(a._.slice(1).join(" ")));
    } else if (cmd === "texts") {
        const ctx = await loadProject(mpr);
        const client = new LocalClient(ctx);
        const model = await client.open();
        out(await require("./ops").bind(model, client).texts(a._[1], a.missing));
    } else if (cmd === "find") {
        if (!a._[1]) throw new Error("find needs a text, e.g. find Customer");
        const ctx = await loadProject(mpr);
        out(inspect.find(new LocalClient(ctx), a._.slice(1).join(" ")));
    } else throw new Error(`Unknown command '${cmd}'.\n\n${USAGE}`);
    if (process.exitCode === undefined) process.exitCode = ok ? 0 : 1;
    if (!["verify", "open"].includes(cmd)) process.stderr.write(`(${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
}

// Mendix version of --project for version hints (null when unknown)
function argVersion() {
    try {
        return new Project(findMpr(args(process.argv.slice(2)).project)).version;
    } catch (e) {
        return null;
    }
}
const versionHint = fallback => m => require("./versions").hintFor(m, argVersion()) || fallback;

// Known SDK/script errors -> what to do. Weak models fix errors much faster with a concrete next step.
const HINTS = [
    [/can no longer be instantiated|is not yet available in Mendix|illegal on instances of .* "createIn"|not available in this (Mendix )?version|Cannot encode value/, versionHint("Not in this Mendix version. Check with: api <Type>")],
    [/Please provide a container or model/, "createIn(parent) got undefined: the lookup before it found nothing. Check the name with: find <name>"],
    [/Cannot read propert(y|ies) of (undefined|null)/, "A lookup returned nothing (wrong name, or the unit is not loaded). Check names with find; use await ops.get(\"Module.Name\")."],
    [/is not a function/, versionHint("That function does not exist on this type. Check with: api <Type>")],
    [/is not available offline/, "Team Server, file and lock calls do not work locally. Remove that call."],
    [/Property '.*' of .* cannot be stored/, "This Mendix version has no such property. Check with: api <Type>"],
    [/not loaded|isLoaded|load\(\)/i, "Load the document first: const d = await ops.get(\"Module.Name\") (it loads for you)."],
    [/not found in the model/, "Check the exact name with: find <part of the name>"],
    [/unknown op|unknown field|unknown action|needs '/i, fieldsHint]
];

// "Fields: ops <op>" for the op, widget kind or action the message is about.
function fieldsHint(m) {
    if (/unknown op /.test(m)) return "List the operations with: ops";
    const { widgetKind } = require("./ops-pages");
    const kinds = [...m.matchAll(/\((\w+)\)|for (\w+)\b/g)].map(x => x[1] || x[2]).filter(k => widgetKind(k));
    if (/(widgets|form)\[/.test(m) && kinds.length) return `Fields of ${kinds[kinds.length - 1]}: ops ${kinds[kinds.length - 1]} (all widgets: ops createPage)`;
    const w = /unknown field '[^']*' for (\w+)/.exec(m) || /(\w+) needs '/.exec(m) || /^Op \d+ \((\w+)\)/.exec(m);
    return w ? `Fields: ops ${w[1]}` : "List the operations and their fields with: ops";
}

const MAX_MESSAGE = 400; // long SDK messages cost a weak model a whole turn and hide the useful first line

function report(e, file) {
    const full = e && e.message ? e.message : String(e);
    const msg = full.length > MAX_MESSAGE ? full.slice(0, MAX_MESSAGE) + ` ... (${full.length - MAX_MESSAGE} more characters)` : full;
    const lines = ["ERROR: " + msg];
    const stack = (e && e.stack ? e.stack : "").split("\n").slice(1);
    const own = file && stack.find(l => l.includes(path.resolve(file)));
    if (own) lines.push("  at " + own.trim().replace(/^at /, ""));
    else if (!/^(No |Nothing |Code |The model|apply needs|run needs|Studio Pro|Expected|--project|Only|This project|Unknown command|Unknown tool|Op \d|ops must be|name: |widgets: )|is a script\. Scripts are off|is not a tool here|changed since the dry run|changed after the apply/.test(msg)) lines.push(...stack.slice(0, 4).map(l => "  " + l.trim()));
    const hint = HINTS.find(([re]) => re.test(full)); // the full text: the type names may be past the cut
    if (hint) lines.push("HINT: " + (typeof hint[1] === "function" ? hint[1](full) : hint[1]));
    return lines.join("\n") + "\n";
}

module.exports = { run, apply, restoreCmd, report, setOutput, findMpr, loadChange, USAGE };

if (require.main === module) main()
    .catch(e => {
        const a = args(process.argv.slice(2));
        process.stderr.write(report(e, a._[0] === "run" ? a._[1] : null));
        process.exitCode = 1;
    })
    .finally(() => setImmediate(() => process.exit()));
