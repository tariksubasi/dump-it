#!/usr/bin/env node
"use strict";
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emitWarning.call(process, w, ...rest));

const fs = require("fs");
const path = require("path");
const bson = require("./bson");
const { backups, restore, BACKUP_DIR } = require("./mpr");
const { toPlain, fromPlain, toSdk, fromSdk } = require("./convert");
const { LocalClient, loadProject } = require("./client");

const out = s => process.stdout.write(s + "\n");

const USAGE = `mxlocal - Mendix Model SDK offline on a local .mpr (v2)

  node mxlocal.js verify  --project <app.mpr|folder>     read-only self check (byte roundtrip + SDK mapping)
  node mxlocal.js open    --project <app.mpr|folder>     load every unit through the Model SDK, report problems
  node mxlocal.js run <script.js> --project <app.mpr|folder> [--apply]
                                                         run an SDK script; dry-run unless --apply
  node mxlocal.js restore --project <app.mpr|folder> [--backup <name>]
                                                         undo the last (or the given) --apply

  A script exports:  module.exports = async ({ model, sdk, log }) => { ... }
  'model' is a normal Model SDK model, 'sdk' is require("mendixmodelsdk"), 'log' prints a line.
  Studio Pro must be closed for --apply and restore.`;

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

async function run(script, mpr, apply) {
    const fn = require(path.resolve(script));
    if (typeof fn !== "function") throw new Error(`${script} must export an async function`);
    const { client, model, errors } = await openAll(mpr);
    if (errors.length) throw new Error(`Model did not load cleanly:\n  ${errors.join("\n  ")}`);
    await fn({ model, sdk: require("mendixmodelsdk"), log: s => out("  " + s) });
    await model.flushChanges();
    const s = client.summary();
    out(`Changes: ${s.created.length} created, ${s.updated.length} updated, ${s.deleted.length} deleted unit(s)`);
    for (const x of s.created) out("  + " + x);
    for (const x of s.updated) out("  ~ " + x);
    for (const x of s.deleted) out("  - " + x);
    for (const x of s.renames) out("  rename " + x);
    if (s.warnings.length) out("Warnings:\n" + s.warnings.map(w => "  ! " + w).join("\n"));
    if (!s.created.length && !s.updated.length && !s.deleted.length) return out("Nothing to write.");
    if (!apply) return out("Dry run: nothing written. Re-run with --apply (Studio Pro closed) to save.");
    const r = client.save();
    out(`Saved ${r.written} unit file(s), deleted ${r.deleted}. Backup: ${path.relative(client.project.dir, r.backup)}`);
    out(`Undo with: node mxlocal.js restore --project "${client.project.mpr}"`);
}

function restoreCmd(mpr, name) {
    const dir = path.dirname(mpr);
    const all = backups(dir);
    const pick = name && name !== true ? name : all[all.length - 1];
    if (!pick || !all.includes(pick)) throw new Error(`No backup '${pick || ""}' in ${path.join(dir, BACKUP_DIR)}`);
    if (fs.existsSync(mpr + ".lock")) throw new Error("Studio Pro has this project open. Close it first.");
    const m = restore(dir, path.join(dir, BACKUP_DIR, pick));
    fs.renameSync(path.join(dir, BACKUP_DIR, pick), path.join(dir, BACKUP_DIR, pick + ".restored"));
    out(`Restored ${pick}: ${m.restore.length} unit file(s) put back, ${m.remove.length} removed, ${m.mpr} restored.`);
}

async function main() {
    const a = args(process.argv.slice(2));
    const cmd = a._[0];
    if (!cmd || a.help) return out(USAGE);
    const mpr = findMpr(a.project);
    let ok = true;
    if (cmd === "verify") ok = await verify(mpr);
    else if (cmd === "open") ok = await open(mpr);
    else if (cmd === "run") {
        if (!a._[1]) throw new Error("run needs a script path");
        await run(a._[1], mpr, a.apply === true);
    } else if (cmd === "restore") restoreCmd(mpr, a.backup);
    else throw new Error(`Unknown command '${cmd}'.\n\n${USAGE}`);
    process.exitCode = ok ? 0 : 1;
}

main()
    .catch(e => {
        process.stderr.write("ERROR: " + (e && e.stack ? e.stack : String(e)) + "\n");
        process.exitCode = 1;
    })
    .finally(() => setImmediate(() => process.exit()));
