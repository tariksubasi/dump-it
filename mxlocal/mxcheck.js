"use strict";
// STUDIO PRO CHECK: Mendix's own consistency check ("mx check", the Errors pane of Studio Pro) on a COPY of the
// project. mx writes into the project it checks (theme-cache/, deployment/, and other mx commands convert the .mpr),
// so it never runs on the user's files.
//
//   find the mx tool       explicit (--mx, MX_PATH, MENDIX_MX, "mx" in .mxlocal.json) > Studio Pro installs (Windows
//                          Program Files and per-user, macOS app bundles) > MxBuild folders (~/.mendix/mxbuild/<v>,
//                          ~/.mxcli/mxbuild/<v>, /opt/mendix/...) > "mx" on PATH (only when its path names a version);
//                          the one of the project's exact version wins; another major.minor is refused (mx check of
//                          another version converts the model or fails)
//   run                    mx check <copy.mpr> -j <file.json> -w -d (JSON report with module, document, element and
//                          unit id per problem); when that option is not understood: mx check <copy.mpr> (text)
//   parse                  JSON first; text lines "[error] [CE0117] "message" at Microflow 'M.F'"; lines it does not
//                          understand are kept as raw lines; the exit code decides when no verdict is printed
//   baseline               the result per saved model (ContentsHash fingerprint + widgets + mx), cached in
//                          .mxlocal-backup/mxcheck/, so "new since the change" subtracts the errors the project had
//
// Config (.mxlocal.json in the project folder, else ~/.mxlocal.json):
//   { "mx": "<mx binary or install folder>", "mxSearch": ["<folders with <version>/modeler/mx>"],
//     "check": false | "apply" | "all", "checkTimeout": 600 }
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const DEFAULT_TIMEOUT = 600; // seconds
const CACHE_DIR = path.join(".mxlocal-backup", "mxcheck");
const SET_MX = "set MX_PATH to Studio Pro's mx (Windows: set MX_PATH=C:\\Program Files\\Mendix\\<version>\\modeler\\mx.exe; " +
    "Mac: export MX_PATH=\"/Applications/Studio Pro <version>.app/Contents/modeler/mx\"; Linux: MxBuild's modeler/mx)";

// ------------------------------------------------------------------------------------------------ versions

// "10.24.0.73019" -> [10, 24, 0, 73019]; null when it is no version
function parts(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(v || "").trim());
    return m ? m.slice(1).filter(x => x !== undefined).map(Number) : null;
}

// The version a path names: the last path segment (or app bundle name) that holds a version.
function versionOf(p) {
    const segs = String(p).split(/[\\/]/).reverse();
    for (const s of segs) {
        const m = /(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(s);
        if (m) return m[1];
    }
    return null;
}

// How well mx version b fits project version a: "exact", "patch" (same x.y.z, other build), "minor" (same x.y,
// other patch), "other" (another major.minor), "unknown"
function fit(project, mx) {
    const a = parts(project), b = parts(mx);
    if (!a || !b) return "unknown";
    if (a[0] !== b[0] || a[1] !== b[1]) return "other";
    if (a[2] !== b[2]) return "minor";
    if (a.length === 4 && b.length === 4 && a[3] !== b[3]) return "patch";
    return "exact";
}

// ------------------------------------------------------------------------------------------------ config

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

// .mxlocal.json of the project folder over the one in the home folder
function config(projectDir, home = os.homedir()) {
    const user = (home && readJson(path.join(home, ".mxlocal.json"))) || {};
    const proj = (projectDir && readJson(path.join(projectDir, ".mxlocal.json"))) || {};
    const c = { ...user, ...proj };
    // a relative "mx" in the project's file is relative to the project folder
    if (proj.mx && !path.isAbsolute(proj.mx)) c.mx = path.resolve(projectDir, proj.mx);
    return c;
}

// When apply / run check without --check: config "check": "apply" (apply only) | "all" | true (= "apply")
function defaultCheck(cfg, cmd) {
    const v = cfg && cfg.check;
    if (v === true || v === "apply") return cmd === "apply";
    if (v === "all" || v === "always") return true;
    return false;
}

function timeoutOf(cfg, arg, env = process.env) {
    const n = Number(arg !== undefined && arg !== true ? arg : env.MXLOCAL_CHECK_TIMEOUT || (cfg && cfg.checkTimeout) || DEFAULT_TIMEOUT);
    return n > 0 ? n : DEFAULT_TIMEOUT;
}

// ------------------------------------------------------------------------------------------------ discovery

const isFile = p => {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
};
const isDir = p => {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
};
const list = d => {
    try {
        return fs.readdirSync(d);
    } catch {
        return [];
    }
};

// OS an executable is built for (magic bytes); null for scripts and unknown formats
function binaryOS(p) {
    let fd;
    try {
        fd = fs.openSync(p, "r");
        const b = Buffer.alloc(4);
        if (fs.readSync(fd, b, 0, 4, 0) < 4) return null;
        if (b[0] === 0x7f && b.toString("latin1", 1, 4) === "ELF") return "linux";
        if (b[0] === 0x4d && b[1] === 0x5a) return "win32";
        const be = b.readUInt32BE(0);
        if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(be)) return "darwin";
        return null;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

// The mx binary in a folder: <dir>/mx, <dir>/modeler/mx, an app bundle's Contents/**/mx (Windows: mx.exe)
function mxIn(dir, platform) {
    const names = platform === "win32" ? ["mx.exe", "mx"] : ["mx"];
    for (const n of names) for (const p of [path.join(dir, n), path.join(dir, "modeler", n), path.join(dir, "Contents", "modeler", n)]) if (isFile(p)) return p;
    if (/\.app$/i.test(dir) || path.basename(dir) === "Contents") return search(dir, names, 5);
    return null;
}

// breadth-first search for a file with one of the names, at most depth levels down
function search(dir, names, depth) {
    let level = [dir];
    for (let i = 0; i <= depth && level.length; i++) {
        const next = [];
        for (const d of level) {
            for (const e of list(d)) {
                const p = path.join(d, e);
                if (names.includes(e) && isFile(p)) return p;
                if (isDir(p) && !e.startsWith(".")) next.push(p);
            }
        }
        level = next;
    }
    return null;
}

// Folders that hold one install per version: <root>/<version>/modeler/mx
function versionRoots(platform, env, home) {
    const roots = [];
    if (platform === "win32") {
        for (const k of ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]) if (env[k]) roots.push(path.join(env[k], "Mendix"));
        if (env.LOCALAPPDATA) roots.push(path.join(env.LOCALAPPDATA, "Programs", "Mendix"), path.join(env.LOCALAPPDATA, "Mendix"));
        if (env.SystemDrive) roots.push(path.join(env.SystemDrive + "\\", "Program Files", "Mendix"));
    }
    if (home) roots.push(path.join(home, ".mendix", "mxbuild"), path.join(home, ".mxcli", "mxbuild"));
    if (platform !== "win32") roots.push("/opt/mendix/mxbuild", "/opt/mendix", "/usr/local/mendix");
    return [...new Set(roots)];
}

// macOS: Studio Pro app bundles ("Studio Pro 10.24.0.73019.app", "Mendix Studio Pro 11.12.2.app", ...)
function appRoots(platform, home, override) {
    if (override) return override;
    return platform === "darwin" ? ["/Applications", ...(home ? [path.join(home, "Applications")] : [])] : [];
}

// Every mx found: [{ path, version, source }]
function candidates(opts = {}) {
    const platform = opts.platform || process.platform;
    const env = opts.env || process.env;
    const home = opts.home !== undefined ? opts.home : os.homedir();
    const cfg = opts.config || {};
    const out = [];
    const seen = new Set();
    const add = (p, source, version) => {
        if (!p || seen.has(p)) return;
        seen.add(p);
        out.push({ path: p, version: version || versionOf(p), source });
    };
    const fromRoot = (root, source) => {
        for (const v of list(root)) {
            const dir = path.join(root, v);
            if (!versionOf(v) || !isDir(dir)) continue;
            add(mxIn(dir, platform), source, versionOf(v));
        }
    };
    for (const root of [...(cfg.mxSearch || []), ...versionRoots(platform, env, home)]) fromRoot(root, `in ${root}`);
    for (const root of appRoots(platform, home, opts.appRoots)) {
        for (const app of list(root).filter(a => /studio pro/i.test(a) && /\.app$/i.test(a))) add(mxIn(path.join(root, app), "darwin"), `app ${app}`, versionOf(app));
    }
    // "mx" on PATH: only when its (real) path names a version, any other "mx" may be another tool
    for (const d of String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
        for (const n of platform === "win32" ? ["mx.exe"] : ["mx"]) {
            const p = path.join(d, n);
            if (!isFile(p)) continue;
            let real = p;
            try {
                real = fs.realpathSync(p);
            } catch {
                // keep p
            }
            if (versionOf(real)) add(real, "PATH");
        }
    }
    // a binary for another OS (a Linux MxBuild download on Windows/macOS) cannot run here
    return out.filter(c => {
        const os_ = binaryOS(c.path);
        return !os_ || os_ === platform || opts.anyOS;
    });
}

// The explicit choice: --mx, MX_PATH, MENDIX_MX, "mx" of the config; a file, an install folder or a folder of versions
function explicit(opts) {
    const env = opts.env || process.env;
    const platform = opts.platform || process.platform;
    const cfg = opts.config || {};
    for (const [value, source] of [[opts.mx, "--mx"], [env.MX_PATH, "MX_PATH"], [env.MENDIX_MX, "MENDIX_MX"], [cfg.mx, ".mxlocal.json"]]) {
        if (!value || value === true) continue;
        const p = path.resolve(String(value));
        if (isFile(p)) return { path: p, version: versionOf(p), source };
        if (isDir(p)) {
            const inside = mxIn(p, platform);
            if (inside) return { path: inside, version: versionOf(inside), source };
            return { root: p, source }; // a folder with one install per version
        }
        return { missing: `${source}=${value} does not exist` };
    }
    return null;
}

// The mx for a project version: { mx, version, source, note } | { refused: "<one line>" } | { missing: "<one line>" }
function find(projectVersion, opts = {}) {
    const ex = explicit(opts);
    if (ex && ex.missing) return { missing: `mx not found: ${ex.missing}; ${SET_MX}` };
    let pool;
    if (ex && ex.path) {
        const f = fit(projectVersion, ex.version);
        if (f === "other") return { refused: `mx at ${ex.path} (${ex.source}) is Mendix ${ex.version}, the project is Mendix ${projectVersion}: mx check of another version converts the model or fails. Point ${ex.source} to Studio Pro ${short(projectVersion)}'s mx.` };
        return { mx: ex.path, version: ex.version, source: ex.source, note: note(f, projectVersion, ex.version) };
    }
    if (ex && ex.root) pool = candidates({ ...opts, config: { ...(opts.config || {}), mxSearch: [ex.root] }, env: {}, home: "", appRoots: [] }).map(c => ({ ...c, source: ex.source }));
    else pool = candidates(opts);
    const rank = { exact: 0, patch: 1, minor: 2 };
    const ok = pool.map(c => ({ ...c, fit: fit(projectVersion, c.version) })).filter(c => c.fit in rank);
    if (!ok.length) {
        const known = [...new Set(pool.map(c => c.version).filter(Boolean))];
        if (known.length) return { refused: `mx found only for Mendix ${known.join(", ")}, the project is Mendix ${projectVersion}: mx check of another version converts the model or fails. Install Studio Pro ${short(projectVersion)} or ${SET_MX}.` };
        return { missing: `mx not found (no Studio Pro ${short(projectVersion)} or MxBuild); ${SET_MX}` };
    }
    // best fit, then the nearest patch (at or above the project's first), then the newest build
    const pp = parts(projectVersion) || [0, 0, 0];
    ok.sort((a, b) => rank[a.fit] - rank[b.fit] || dist(a) - dist(b) || cmpParts(parts(b.version), parts(a.version)));
    function dist(c) {
        const v = parts(c.version);
        return v[2] >= pp[2] ? v[2] - pp[2] : 1000 + pp[2] - v[2];
    }
    const c = ok[0];
    return { mx: c.path, version: c.version, source: c.source, note: note(c.fit, projectVersion, c.version) };
}

function cmpParts(a, b) {
    for (let i = 0; i < 4; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    return 0;
}

const short = v => String(v).split(".").slice(0, 3).join(".");

function note(f, project, mx) {
    if (f === "unknown") return `the version of this mx is not in its path; it must be Mendix ${project}`;
    if (f === "minor") return `mx is Mendix ${mx}, the project ${project} (same ${short(project).split(".").slice(0, 2).join(".")}, other patch): results may differ slightly from Studio Pro ${short(project)}`;
    if (f === "patch") return `mx is build ${mx}, the project ${project}`;
    return null;
}

// ------------------------------------------------------------------------------------------------ copy

// Top-level folders mx regenerates or does not read, and folders skipped anywhere.
const SKIP_ROOT = new Set(["deployment", "releases", "theme-cache", ".mendix-cache", ".mxlocal-backup", ".mxcli", ".docker", "edits"]);
const SKIP_ANY = new Set([".git", ".svn", ".hg", "node_modules"]);

// Copies the project folder of mpr into a new temporary folder; returns { dir, mpr, cleanup }.
function copyProject(mpr, tmpRoot) {
    const src = path.dirname(path.resolve(mpr));
    const base = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), "mxcheck-"));
    const dst = path.join(base, path.basename(src));
    const real = p => {
        try {
            return fs.realpathSync(p);
        } catch {
            return p;
        }
    };
    const baseReal = real(base);
    const walk = (from, to, rel) => {
        fs.mkdirSync(to, { recursive: true });
        for (const e of fs.readdirSync(from, { withFileTypes: true })) {
            const p = path.join(from, e.name);
            if (real(p) === baseReal) continue; // TMPDIR inside the project: not the copy into itself
            if (SKIP_ANY.has(e.name) || (!rel && SKIP_ROOT.has(e.name))) continue;
            if (!rel && /\.mpr\.lock$|\.mpr\.bak$/i.test(e.name)) continue; // Studio Pro's lock: the copy is closed
            let st;
            try {
                st = fs.statSync(p); // follows links: a linked file is copied as a file
            } catch {
                continue; // dangling link
            }
            if (st.isDirectory()) walk(p, path.join(to, e.name), rel ? path.join(rel, e.name) : e.name);
            else if (st.isFile()) fs.copyFileSync(p, path.join(to, e.name));
        }
    };
    walk(src, dst, "");
    return { dir: dst, mpr: path.join(dst, path.basename(mpr)), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

// ------------------------------------------------------------------------------------------------ run + parse

// libSkiaSharp in MxBuild on Linux can crash on a stripped libfreetype ("undefined symbol: FT_Get_BDF_Property");
// preloading the system libfreetype avoids it (from mendixlabs/mxcli). No-op elsewhere.
function mxEnv(env = process.env, platform = process.platform) {
    if (platform !== "linux" || /libfreetype/.test(env.LD_PRELOAD || "") || env.MXLOCAL_NO_PRELOAD) return env;
    const dirs = ["/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/usr/lib", "/lib/x86_64-linux-gnu", "/usr/local/lib"];
    const lib = dirs.map(d => path.join(d, "libfreetype.so.6")).find(isFile);
    return lib ? { ...env, LD_PRELOAD: env.LD_PRELOAD ? `${lib}:${env.LD_PRELOAD}` : lib } : env;
}

function spawn(mx, args, timeoutSec, cwd) {
    const started = Date.now();
    const r = spawnSync(mx, args, { cwd, encoding: "utf8", timeout: timeoutSec * 1000, maxBuffer: 512 * 1024 * 1024, env: mxEnv(), windowsHide: true });
    return {
        code: r.status, signal: r.signal, error: r.error && r.error.code !== "ETIMEDOUT" ? r.error : null,
        timedOut: !!(r.error && r.error.code === "ETIMEDOUT") || (r.signal === "SIGTERM" && Date.now() - started >= timeoutSec * 1000 - 50),
        output: `${r.stdout || ""}${r.stderr ? (r.stdout ? "\n" : "") + r.stderr : ""}`, seconds: (Date.now() - started) / 1000
    };
}

// "Page 'Home'" -> { kind: "Page", name: "Home" }
function splitDoc(s) {
    const m = /^(.*?)\s*'(.*)'\s*$/.exec(String(s || ""));
    return m ? { kind: m[1], name: m[2] } : { kind: "", name: String(s || "") };
}

function item(severity, code, message, loc = {}) {
    const doc = splitDoc(loc["document-name"]);
    const mod = loc["module-name"] || "";
    const docName = doc.name ? (mod && !doc.name.startsWith(mod + ".") ? `${mod}.${doc.name}` : doc.name) : mod;
    return { severity, code: code || "", message: String(message || "").replace(/\s+/g, " ").trim(), module: mod, document: docName, kind: doc.kind,
        element: loc["element-name"] || "", unitId: loc["unit-id"] || "", elementId: loc["element-id"] || "" };
}

// mx check -j report: { errors|warnings|deprecations: [{ code, message, locations: [{ module-name, document-name,
// element-name, element-id, unit-id }] }] } (serialization_version 1, Mendix 11)
function parseJson(text) {
    const j = JSON.parse(text);
    const r = { errors: [], warnings: [], deprecations: [] };
    for (const [key, sev] of [["errors", "error"], ["warnings", "warning"], ["deprecations", "deprecation"]]) {
        for (const e of Array.isArray(j[key]) ? j[key] : []) {
            const locs = Array.isArray(e.locations) && e.locations.length ? e.locations : [{}];
            for (const l of locs) r[key].push(item(sev, e.code, e.message, l));
        }
    }
    return r;
}

const SEV = { error: "errors", warning: "warnings", deprecation: "deprecations" };

// Text output. Known: "[error] [CE0117] "Error(s) in expression." at Microflow 'M.F'" (a message may wrap over lines),
// "CE0117: message" and the verdict "The app contains: 2 errors." Anything else is kept in raw.
function parseText(text) {
    const r = { errors: [], warnings: [], deprecations: [], raw: [], summary: null };
    let open = null; // an item whose quoted message is not closed yet
    let last = null; // the last item, for an "at <element>" on its own line
    const locOf = at => {
        const el = splitDoc(at);
        // the text format names the element; a qualified name ('Module.Doc[.x]') gives the module and document
        const qn = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)/.exec(el.name);
        return { "element-name": at, ...(qn ? { "module-name": qn[1], "document-name": `${el.kind} '${qn[0]}'` } : {}) };
    };
    const finish = (sev, code, rest) => {
        let message = rest.trim(), at = "";
        const q = /^"([\s\S]*)"\s*(?:at\s+([\s\S]*))?$/.exec(message);
        if (q) [message, at] = [q[1], (q[2] || "").trim()];
        else {
            const a = /^([\s\S]*?)\s+at\s+(\S[\s\S]*'[^']*')\s*$/.exec(message);
            if (a) [message, at] = [a[1], a[2]];
        }
        last = item(sev, code, message, at ? locOf(at) : {});
        r[SEV[sev]].push(last);
    };
    const quotes = s => (s.match(/"/g) || []).length;
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, "");
        if (open) {
            open.rest += " " + line.trim();
            if (quotes(open.rest) % 2 === 0) {
                finish(open.sev, open.code, open.rest);
                open = null;
            }
            continue;
        }
        let m;
        if (last && !last.element && (m = /^\s+at\s+(\S.*'[^']*')\s*$/.exec(line))) {
            const l = item(last.severity, last.code, last.message, locOf(m[1]));
            Object.assign(last, l);
            continue;
        }
        last = null;
        if ((m = /The app contains:?\s*(.*)$/i.exec(line))) {
            const n = word => {
                const x = new RegExp(`(\\d+)\\s+${word}`, "i").exec(m[1]);
                return x ? Number(x[1]) : 0;
            };
            r.summary = { errors: n("errors?"), warnings: n("warnings?"), deprecations: n("deprecations?") };
            continue;
        }
        if ((m = /^\s*(?:-\s*)?\[(error|warning|deprecation)\]\s*(?:\[([A-Z]{2,3}\d{3,5})\])?\s*(.*)$/i.exec(line))) {
            const sev = m[1].toLowerCase(), rest = m[3];
            // an unclosed quote: the message continues on the next lines
            if (quotes(rest) % 2 === 1) open = { sev, code: m[2], rest };
            else finish(sev, m[2], rest);
            continue;
        }
        if ((m = /^\s*(?:(Error|Warning|Deprecation)\s+)?([A-Z]{2}\d{4}):\s+(.*)$/.exec(line))) {
            const sev = m[1] ? m[1].toLowerCase() : m[2].startsWith("CW") ? "warning" : m[2].startsWith("CD") ? "deprecation" : "error";
            finish(sev, m[2], m[3]);
            continue;
        }
        if (line.trim()) r.raw.push(line);
    }
    if (open) finish(open.sev, open.code, open.rest);
    return r;
}

// A finished run -> result: { status: "ok" | "errors" | "failed", errors, warnings, deprecations, counts, raw,
// reason, exitCode, format, seconds }
function interpret(run, jsonText) {
    const text = parseText(run.output);
    let parsed = null, format = "text";
    if (jsonText) {
        try {
            parsed = parseJson(jsonText);
            format = "json";
        } catch (e) {
            text.raw.push(`(the JSON report could not be read: ${e.message})`);
        }
    }
    const p = parsed || text;
    const counts = parsed ? { errors: p.errors.length, warnings: p.warnings.length, deprecations: p.deprecations.length }
        : { errors: Math.max(text.errors.length, (text.summary || {}).errors || 0), warnings: Math.max(text.warnings.length, (text.summary || {}).warnings || 0),
            deprecations: Math.max(text.deprecations.length, (text.summary || {}).deprecations || 0) };
    const res = { errors: p.errors, warnings: p.warnings, deprecations: p.deprecations, counts, raw: text.raw, exitCode: run.code, format, seconds: run.seconds, status: "ok", reason: null };
    const verdict = !!parsed || !!text.summary;
    if (run.error) [res.status, res.reason] = ["failed", `mx could not start: ${run.error.message}`];
    else if (run.timedOut) [res.status, res.reason] = ["failed", `mx check did not finish in ${run.timeout}s (raise checkTimeout / --check-timeout)`];
    else if (counts.errors > 0) res.status = "errors";
    else if (run.code !== 0) {
        // non-zero without a listed error: the model did not load (stack trace) or mx refused the project
        res.status = "failed";
        res.reason = verdict ? `mx exited with code ${run.code} although it reported no errors` : `mx exited with code ${run.code} without a verdict (the model may not load, or mx refused the project)`;
    } else if (!verdict) res.reason = "mx printed no verdict line (exit code 0 taken as no errors)";
    return res;
}

const unknownOption = out => /unknown (option|argument|switch)|unrecognized (option|argument)|invalid option|option '?-j'? .*(unknown|not)|usage:/i.test(out);

// mx check on the project folder dir (already a copy: mx may write into it).
function runCheck(mx, mprCopy, timeoutSec) {
    const jf = path.join(path.dirname(path.dirname(mprCopy)), `mxcheck-${process.pid}-${Date.now()}.json`);
    let run = spawn(mx, ["check", mprCopy, "-j", jf, "-w", "-d"], timeoutSec, path.dirname(mprCopy));
    run.timeout = timeoutSec;
    let json = isFile(jf) ? fs.readFileSync(jf, "utf8") : null;
    fs.rmSync(jf, { force: true });
    if (!json && !run.timedOut && !run.error && run.code !== 0 && unknownOption(run.output) && !/The app contains/i.test(run.output)) {
        // an mx without the JSON report: the text output
        run = spawn(mx, ["check", mprCopy], timeoutSec, path.dirname(mprCopy));
        run.timeout = timeoutSec;
        json = null;
    }
    return interpret(run, json);
}

// replace the temporary copy's folder by the project's in what mx printed
function rewrite(res, from, to) {
    const fix = s => (typeof s === "string" ? s.split(from).join(to) : s);
    for (const k of ["errors", "warnings", "deprecations"]) for (const i of res[k]) i.message = fix(i.message);
    res.raw = res.raw.map(fix);
    res.reason = fix(res.reason);
    return res;
}

// ------------------------------------------------------------------------------------------------ cache

// Identity of what mx checks: the unit table (ContentsHash per unit), the widget packages and the mx binary
function stateKey(mpr, mx) {
    const h = crypto.createHash("sha256");
    h.update(fingerprint(mpr) || "nofp:" + Date.now() + Math.random());
    const widgets = path.join(path.dirname(mpr), "widgets");
    for (const f of list(widgets).sort()) {
        try {
            const st = fs.statSync(path.join(widgets, f));
            h.update(`|${f}:${st.size}`);
        } catch {
            // gone meanwhile
        }
    }
    try {
        const st = fs.statSync(mx);
        h.update(`|${mx}:${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch {
        h.update("|" + mx);
    }
    return h.digest("hex").slice(0, 32);
}

// MPR v2: sha256 of every UnitID:ContentsHash (like Project.fingerprint); null for MPR v1
function fingerprint(mpr) {
    try {
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(mpr, { readOnly: true });
        try {
            const { guidToString } = require("./convert");
            const rows = db.prepare("select UnitID, ContentsHash from Unit").all().map(r => guidToString(Buffer.from(r.UnitID)) + ":" + r.ContentsHash).sort();
            return crypto.createHash("sha256").update(rows.join("\n")).digest("hex");
        } finally {
            db.close();
        }
    } catch {
        return null;
    }
}

// _ProductVersion of the .mpr (with the build number when it has one), also for MPR v1
function projectVersion(mpr) {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(mpr, { readOnly: true });
    try {
        return db.prepare("select _ProductVersion from _MetaData").get()._ProductVersion;
    } finally {
        db.close();
    }
}

const cacheFile = (projectDir, key) => path.join(projectDir, CACHE_DIR, key + ".json");

function cacheGet(projectDir, key) {
    const r = readJson(cacheFile(projectDir, key));
    return r && r.status ? r : null;
}

function cachePut(projectDir, key, res) {
    if (res.status === "failed") return; // a crash, timeout or refusal is no baseline: run again next time
    try {
        const dir = path.join(projectDir, CACHE_DIR);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(cacheFile(projectDir, key), JSON.stringify({ ...res, cachedAt: new Date().toISOString() }));
        // keep the newest 40
        const all = list(dir).filter(f => f.endsWith(".json")).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
        for (const x of all.slice(40)) fs.rmSync(path.join(dir, x.f), { force: true });
    } catch {
        // a read-only project folder: no cache
    }
}

// ------------------------------------------------------------------------------------------------ check

// mx check of the project mpr, on a copy. prepare(copyMpr) changes the copy first (the pending change of a dry run).
// opts: { found (find() result), timeout, tmp, keep, cache: "use" | "store" | false }
function check(mpr, opts = {}) {
    mpr = path.resolve(mpr);
    const found = opts.found;
    const projectDir = path.dirname(mpr);
    const key = !opts.prepare && opts.cache ? stateKey(mpr, found.mx) : null;
    if (key && opts.cache === "use") {
        const hit = cacheGet(projectDir, key);
        if (hit) return { ...hit, cached: true };
    }
    const copy = copyProject(mpr, opts.tmp);
    try {
        if (opts.prepare) opts.prepare(copy.mpr);
        const res = rewrite(runCheck(found.mx, copy.mpr, opts.timeout || DEFAULT_TIMEOUT), copy.dir, projectDir);
        res.mx = found.mx;
        res.mxVersion = found.version;
        if (key) cachePut(projectDir, key, res);
        if (opts.keepCopy) res.copy = copy.dir;
        return res;
    } finally {
        if (!opts.keepCopy) copy.cleanup();
    }
}

// ------------------------------------------------------------------------------------------------ baseline diff

// identity of a problem across two runs (ids of new elements differ, names do not); norm rewrites names (renames)
function signature(i, norm = s => s) {
    return [i.severity, i.code, norm(i.document), norm(i.kind), norm(i.element), norm(i.message)].join("|");
}

// Problems of after that before does not have (as a multiset), and the ones that are gone.
// When a run only gave counts (text format without parsable lines), the difference of the counts.
function diff(before, after, norm = s => s) {
    const out = { fresh: [], gone: [], freshCount: 0, unparsed: false };
    // a looser identity for a run that printed no location (text format) against one that did (JSON)
    const loose = i => [i.severity, i.code, norm(i.message)].join("|");
    for (const sev of ["errors", "warnings", "deprecations"]) {
        const b = (before[sev] || []).map(i => ({ i, used: false }));
        const a = (after[sev] || []).map(i => ({ i, used: false }));
        const exact = new Map();
        for (const x of b) exact.set(signature(x.i, norm), [...(exact.get(signature(x.i, norm)) || []), x]);
        for (const y of a) {
            const x = (exact.get(signature(y.i, norm)) || []).find(z => !z.used);
            if (x) x.used = y.used = true;
        }
        for (const y of a.filter(z => !z.used)) {
            const x = b.find(z => !z.used && loose(z.i) === loose(y.i) && (!z.i.document || !y.i.document));
            if (x) x.used = y.used = true;
        }
        out.fresh.push(...a.filter(z => !z.used).map(z => z.i));
        out.gone.push(...b.filter(z => !z.used).map(z => z.i));
    }
    out.freshCount = out.fresh.filter(i => i.severity === "error").length;
    const listedA = (after.errors || []).length, listedB = (before.errors || []).length;
    if (after.counts && before.counts && (after.counts.errors > listedA || before.counts.errors > listedB)) {
        out.unparsed = true;
        out.freshCount = Math.max(out.freshCount, after.counts.errors - before.counts.errors);
    }
    return out;
}

// ------------------------------------------------------------------------------------------------ report

function line(i, mark = "") {
    const where = [i.document && `${i.document}${i.kind ? ` (${i.kind})` : ""}`, i.element && i.element !== i.document && i.element !== `${i.kind} '${i.document}'` && `at ${i.element}`].filter(Boolean).join(" ");
    return `  ${mark}${i.severity === "error" ? "" : `(${i.severity}) `}${i.code ? `[${i.code}] ` : ""}${where ? where + ": " : ""}${i.message}`;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const countText = c => `${plural(c.errors, "error")}, ${plural(c.warnings, "warning")}, ${plural(c.deprecations, "deprecation")}`;

// The STUDIO PRO CHECK block. what: "the saved model" / "the model with this change"; before: baseline result or null
function report(res, { what, before, norm, max = 25, undo } = {}) {
    const head = `STUDIO PRO CHECK (mx check ${res.mxVersion || ""} on a copy of ${what || "the project"}${res.cached ? ", cached" : ""}):`;
    const lines = [head];
    if (res.status === "failed") {
        lines.push(`  ! mx check FAILED: ${res.reason}`);
        for (const r of res.raw.slice(-15)) lines.push("    " + r);
        if (before && before.status !== "failed") lines.push(`  ! Before the change mx check worked (${countText(before.counts)}): the change probably broke loading the model.${undo ? " " + undo : ""}`);
        return { text: lines.join("\n"), fresh: before && before.status !== "failed" ? 1 : 0, failed: true };
    }
    let fresh = 0;
    if (before && before.status !== "failed") {
        const d = diff(before, res, norm);
        fresh = d.freshCount;
        lines.push(`  ${countText(res.counts)} (before the change: ${countText(before.counts)})`);
        const newErr = d.fresh.filter(i => i.severity === "error"), newOther = d.fresh.filter(i => i.severity !== "error");
        for (const i of newErr.slice(0, max)) lines.push(line(i, "! NEW "));
        if (newErr.length > max) lines.push(`  ! ... ${newErr.length - max} more new error(s)`);
        for (const i of newOther.slice(0, 10)) lines.push(line(i, "NEW "));
        if (newOther.length > 10) lines.push(`  ... ${newOther.length - 10} more new warning(s)/deprecation(s)`);
        const goneErr = d.gone.filter(i => i.severity === "error");
        if (goneErr.length) lines.push(`  ${goneErr.length} error(s) of before the change are gone`);
        if (d.unparsed && fresh > newErr.length) lines.push(`  ! ${fresh - newErr.length} more error(s) than before that mx printed in a form this tool cannot read:`, ...res.raw.slice(-10).map(r => "    " + r));
        if (fresh) lines.push(`  ! ${fresh} NEW ERROR${fresh === 1 ? "" : "S"} in Studio Pro since this change.${undo ? " " + undo : ""}`);
        else lines.push(`  No new errors: Studio Pro shows ${res.counts.errors ? `only the ${plural(res.counts.errors, "error")} the project already had` : "no errors"}.`);
    } else {
        lines.push(`  ${countText(res.counts)}`);
        for (const i of res.errors.slice(0, max)) lines.push(line(i, "! "));
        if (res.errors.length > max) lines.push(`  ! ... ${res.errors.length - max} more error(s)`);
        for (const i of [...res.warnings, ...res.deprecations].slice(0, 10)) lines.push(line(i));
        if (res.warnings.length + res.deprecations.length > 10) lines.push(`  ... ${res.warnings.length + res.deprecations.length - 10} more warning(s)/deprecation(s)`);
        if (res.counts.errors > res.errors.length) lines.push(...res.raw.slice(-10).map(r => "    " + r));
        if (before && before.status === "failed") lines.push("  (mx check of the model before the change failed, so nothing to compare with)");
    }
    if (res.reason) lines.push(`  (${res.reason})`);
    return { text: lines.join("\n"), fresh, failed: false };
}

// ------------------------------------------------------------------------------------------------ CLI helpers

// What a command needs: { found } or { line } (the one line when mx cannot be used)
function locate(mpr, a = {}) {
    const cfg = config(path.dirname(path.resolve(mpr)));
    const version = projectVersion(mpr);
    const found = find(version, { mx: a.mx, config: cfg });
    const timeout = timeoutOf(cfg, a["check-timeout"]);
    if (found.mx) return { found, cfg, version, timeout };
    return { line: `STUDIO PRO CHECK: not run - ${found.missing || found.refused}`, cfg, version, timeout, refused: !!found.refused };
}

module.exports = { parts, versionOf, fit, config, defaultCheck, timeoutOf, candidates, explicit, find, binaryOS, copyProject, parseJson, parseText, interpret,
    runCheck, check, diff, signature, report, locate, stateKey, cacheGet, cachePut, fingerprint, projectVersion, countText, SET_MX, DEFAULT_TIMEOUT };

// node mxcheck.js version <app.mpr>   the project's full Mendix version (CI: which MxBuild to download)
// node mxcheck.js find <app.mpr>      which mx would be used, or why none
if (require.main === module) {
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emit.call(process, w, ...rest));
    const [cmd, mpr] = process.argv.slice(2);
    if (cmd === "version" && mpr) process.stdout.write(projectVersion(mpr) + "\n");
    else if (cmd === "find" && mpr) {
        const l = locate(mpr);
        process.stdout.write(l.found ? `mx ${l.found.version || "(version unknown)"} at ${l.found.mx} (${l.found.source})${l.found.note ? `; note: ${l.found.note}` : ""}\n` : l.line + "\n");
        process.exitCode = l.found ? 0 : 1;
    } else {
        process.stdout.write("usage: node mxcheck.js version|find <app.mpr>\n");
        process.exitCode = 2;
    }
}
