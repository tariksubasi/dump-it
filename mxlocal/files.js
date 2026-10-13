"use strict";
// Plain project files (theme SCSS, design properties, Java sources, widget packages, ...) changed by an operation.
// They go through the same dry run, approval code, backup and restore as model units: an op stages the new content
// here, the dry run shows a diff, pending.js stores it, Project.writeEncoded writes it with a backup of the old file.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sha = b => (b === null || b === undefined ? null : crypto.createHash("sha256").update(b).digest("base64"));

// Map rel -> { before: Buffer|null (null = did not exist), after: Buffer|null (null = delete) } of a LocalClient.
function staged(client) {
    if (!client.fileChanges) client.fileChanges = new Map();
    return client.fileChanges;
}

function onDisk(dir, rel) {
    const f = path.join(dir, ...rel.split("/"));
    return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f) : null;
}

// Current content of rel: what an earlier op of this change staged, else the file on disk (null when missing).
function current(client, rel) {
    const e = staged(client).get(rel);
    return e ? e.after : onDisk(client.project.dir, rel);
}

function stage(client, rel, bytes) {
    const m = staged(client);
    const e = m.get(rel);
    m.set(rel, { before: e ? e.before : onDisk(client.project.dir, rel), after: bytes === null ? null : Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8") });
}

// rel (forward slashes, relative to the project folder) of a path given by an agent. Refuses paths outside the
// project, outside the allowed top folders (roots), and paths through a symbolic link that leads elsewhere.
function projectPath(dir, p, roots, where) {
    if (typeof p !== "string" || !p.trim()) throw new Error(`${where}: path is empty`);
    let s = p.trim().replace(/\\/g, "/");
    if (path.isAbsolute(s) || /^[A-Za-z]:\//.test(s)) s = path.relative(dir, path.resolve(s)).replace(/\\/g, "/");
    const rel = path.posix.normalize(s.replace(/^\.\//, ""));
    const allowed = roots.map(r => r + "/").join(", ");
    if (rel === ".." || rel.startsWith("../") || path.posix.isAbsolute(rel)) throw new Error(`${where}: '${p}' is outside the project folder; only files under ${allowed} can change`);
    if (!roots.some(r => rel.startsWith(r + "/"))) throw new Error(`${where}: '${p}' is not under ${allowed}; only those files can change here`);
    if (rel.split("/").some(x => x === ".mxlocal-backup" || x === ".git")) throw new Error(`${where}: '${p}' is a backup or git file`);
    // the deepest existing part must resolve inside the project folder (no symlink out of it)
    let cur = path.join(dir, ...rel.split("/"));
    while (!fs.existsSync(cur) && cur !== dir) cur = path.dirname(cur);
    const real = fs.realpathSync(cur), base = fs.realpathSync(dir);
    if (real !== base && !real.startsWith(base + path.sep)) throw new Error(`${where}: '${p}' leads outside the project folder (symbolic link)`);
    return rel;
}

// Staged files that really change: [{ rel, bytes (null = delete), hash, before (hash or null) }]
function encode(client) {
    const out = [];
    for (const [rel, e] of client.fileChanges || []) {
        if ((e.before === null && e.after === null) || (e.before && e.after && e.before.equals(e.after))) continue;
        out.push({ rel, bytes: e.after, hash: sha(e.after), before: sha(e.before) });
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const isText = b => b && !b.includes(0) && b.length < 2 * 1024 * 1024;

// A short unified-style diff of two texts: changed lines with up to 2 lines of context, at most max lines.
function diff(a, b, max = 60) {
    const x = a.split(/\r?\n/), y = b.split(/\r?\n/);
    let pre = 0;
    while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
    let suf = 0;
    while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
    const xs = x.slice(pre, x.length - suf), ys = y.slice(pre, y.length - suf);
    let body;
    if (xs.length * ys.length > 4e6) body = [...xs.map(l => "- " + l), ...ys.map(l => "+ " + l)];
    else {
        // LCS on the changed middle
        const n = xs.length, m = ys.length;
        const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = xs[i] === ys[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        body = [];
        let i = 0, j = 0;
        while (i < n || j < m) {
            if (i < n && j < m && xs[i] === ys[j]) {
                body.push("  " + xs[i]);
                i++;
                j++;
            } else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) body.push("- " + xs[i++]);
            else body.push("+ " + ys[j++]);
        }
    }
    const lines = [...x.slice(Math.max(0, pre - 2), pre).map(l => "  " + l), ...body, ...x.slice(x.length - suf, x.length - suf + 2).map(l => "  " + l)];
    const head = `@@ line ${Math.max(1, pre - 1)} @@`;
    return [head, ...lines.slice(0, max), ...(lines.length > max ? [`  ... ${lines.length - max} more line(s)`] : [])];
}

// Dry-run lines for the staged files.
function describe(client, files) {
    const out = [];
    for (const f of files) {
        const e = client.fileChanges.get(f.rel);
        const what = e.before === null ? "new file" : e.after === null ? "deleted" : "changed";
        out.push(`  ${what === "new file" ? "+" : what === "deleted" ? "-" : "~"} file ${f.rel} (${what}${e.after ? `, ${e.after.length} bytes` : ""})`);
        if (e.after && isText(e.after) && (e.before === null || isText(e.before)) && (e.before !== null || e.after.length < 4000)) {
            out.push(...diff(e.before ? e.before.toString("utf8") : "", e.after.toString("utf8")).map(l => "      " + l));
        }
    }
    return out;
}

// Hashes of files now on disk (for after.json and the restore check).
function hashes(dir, rels) {
    return Object.fromEntries(rels.map(rel => [rel, sha(onDisk(dir, rel))]));
}

module.exports = { staged, current, stage, projectPath, encode, describe, diff, hashes, sha, onDisk, isText };
