"use strict";
// selftest --mxcheck: Mendix's own consistency check (mx check) of the selftest copy after all phases, against the
// unchanged project (the baseline, cached per saved model). New errors are reported per document; the selftest's own
// documents are named Zz.../in folder ZzTest, every other document was changed by an op of the selftest.
const fs = require("fs");
const path = require("path");
const C = require("./mxcheck");

// Copies the selftest's model (the .mpr, mprcontents and every file it wrote) over a full copy of the project.
function overlay(tmp, dir) {
    fs.rmSync(path.join(dir, "mprcontents"), { recursive: true, force: true });
    const walk = (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        for (const e of fs.readdirSync(from, { withFileTypes: true })) {
            if ([".mxlocal-backup", ".git", "node_modules"].includes(e.name) || /^mxcheck-.*\.json$/.test(e.name)) continue;
            const p = path.join(from, e.name);
            if (e.isDirectory()) walk(p, path.join(to, e.name));
            else if (e.isFile()) fs.copyFileSync(p, path.join(to, e.name));
        }
    };
    walk(tmp, dir);
}

// mx check cannot resolve a configuration constant value at all: whatever constant it names (one the selftest made,
// one Studio Pro made, or no constant) it reports CE1613 "The selected constant 'Dummy.Constant' no longer exists"
// (measured on 10.24 and 11.12 with scripts/mxcheck-variants.js). Such an error is set aside only when every constant
// value of every configuration names a constant that exists in the copy; it is reported as a NOTE.
const DUMMY_CONSTANT = i => i.code === "CE1613" && /'Dummy\.Constant'/.test(i.message || "") && /Settings/.test(i.document || "");
function constantValuesResolve(tmp) {
    const { toPlain } = require("./convert");
    const bson = require("./bson");
    const units = [];
    const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".mxunit")) units.push(toPlain(bson.decode(fs.readFileSync(p))));
        }
    };
    walk(path.join(tmp, "mprcontents"));
    const constants = new Set(units.filter(u => u.$Type === "Constants$Constant").map(u => u.Name));
    const settings = units.find(u => u.$Type === "Settings$ProjectSettings");
    const confs = settings ? (settings.Settings.find(x => x.$Type === "Settings$ConfigurationSettings") || { Configurations: [] }).Configurations : [];
    const refs = confs.flatMap(c => c.ConstantValues.map(v => v.Constant));
    const missing = refs.filter(r => !constants.has(String(r).split(".").pop()));
    return { refs, missing };
}

const selftestDoc = i => /(^|\.)Zz|ZzTest|zz[A-Z_]/.test(`${i.document} ${i.element}`);

// -> { ran: boolean }; pushes an OK/FAIL/SKIP line and the details into results
function phase(env) {
    try {
        return run(env);
    } catch (e) {
        env.check("mx check of the selftest copy", false, `could not run: ${e.message}`);
        return { ran: true };
    }
}

function run({ src, tmp, mod, check, results, opts = {} }) {
    const l = C.locate(src.mpr, { mx: opts.mx, "check-timeout": opts.timeout });
    if (!l.found) {
        results.push(`SKIP mx check: ${l.line.replace(/^STUDIO PRO CHECK: not run - /, "")}`);
        return { ran: false };
    }
    const base = { found: l.found, timeout: l.timeout };
    const before = C.check(src.mpr, { ...base, cache: "use" });
    const after = C.check(src.mpr, { ...base, prepare: m => overlay(tmp, path.dirname(m)) });
    for (const [n, r] of [["before", before], ["after", after]]) {
        try {
            fs.writeFileSync(path.join(tmp, `mxcheck-${n}.json`), JSON.stringify(r, null, 1));
        } catch {
            // the report is enough
        }
    }
    // phase 3 renames the module to <mod>Zz: compare its documents under the old name
    const re = new RegExp(`\\b${mod}Zz\\b`, "g");
    const norm = s => String(s || "").replace(re, mod);
    const what = `mx check ${l.found.version} of the selftest copy (all phases) against the unchanged project`;
    if (before.status === "failed") {
        check(what, false, `mx check of the unchanged project failed: ${before.reason}; ${C.excerpt(before.raw, 4).join(" | ")}`);
        return { ran: true };
    }
    if (after.status === "failed") {
        check(what, false, `mx check of the selftest copy failed (before: ${C.countText(before.counts)}): ${after.reason}; ${C.excerpt(after.raw, 6).join(" | ")}`);
        return { ran: true };
    }
    const d = C.diff(before, after, norm);
    let fresh = d.fresh.filter(i => i.severity === "error");
    const dummy = fresh.filter(DUMMY_CONSTANT);
    if (dummy.length) {
        const cv = constantValuesResolve(tmp);
        if (!cv.missing.length && cv.refs.length) {
            fresh = fresh.filter(i => !DUMMY_CONSTANT(i));
            d.freshCount -= dummy.length;
            results.push(`NOTE mx check: ${dummy.length} CE1613 'Dummy.Constant' on configuration constant values set aside (mx check resolves no configuration constant value; the selftest checked that ${cv.refs.join(", ")} exist): check constant overrides in Studio Pro`);
        } else if (cv.missing.length) results.push(`  configuration constant values name constants that do not exist: ${cv.missing.join(", ")}`);
    }
    const byDoc = new Map();
    for (const i of fresh) {
        const k = norm(i.document) || "(no document)";
        byDoc.set(k, [...(byDoc.get(k) || []), i]);
    }
    const own = [...byDoc.keys()].filter(k => byDoc.get(k).some(selftestDoc)).length;
    check(`${what}: ${C.countText(after.counts)} (unchanged project: ${C.countText(before.counts)})`, d.freshCount === 0,
        d.freshCount ? `${d.freshCount} NEW error(s) in ${byDoc.size} document(s) (${own} selftest document(s), ${byDoc.size - own} existing document(s) changed by an op)` : "");
    for (const [doc, list] of [...byDoc].sort((a, b) => b[1].length - a[1].length)) {
        results.push(`  ${doc} (${list[0].kind || "?"}, ${list.some(selftestDoc) ? "selftest document" : "existing document"}): ${list.length} new error(s)`);
        for (const i of list.slice(0, 5)) results.push(`    ! ${i.code ? `[${i.code}] ` : ""}${i.element && norm(i.element) !== `${i.kind} '${doc}'` ? `at ${norm(i.element)}: ` : ""}${norm(i.message)}`);
        if (list.length > 5) results.push(`    ! ... ${list.length - 5} more`);
    }
    if (d.unparsed && d.freshCount > fresh.length) results.push(`  ${d.freshCount - fresh.length} more new error(s) in output this tool could not read: ${after.raw.slice(-5).join(" | ")}`);
    const newWarn = d.fresh.filter(i => i.severity !== "error");
    if (newWarn.length) results.push(`NOTE mx check: ${newWarn.length} new warning(s)/deprecation(s): ${[...new Set(newWarn.map(i => `${i.code} ${norm(i.document)}`))].slice(0, 8).join(", ")}`);
    if (l.found.note) results.push(`NOTE mx check: ${l.found.note}`);
    return { ran: true };
}

module.exports = { phase, overlay };
