"use strict";
// Files in an mxcontext export folder that the export did not write (same rules as mx_stray.py, read-only here):
// everything outside edits/, .git/, .opencode/, .claude/ that is not in the file list of the .mxcontext marker, plus
// export files changed or deleted after the export (git status). Moving them is python mx.py clean --move.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MARKER = ".mxcontext";
const FILES_HEADER = "FILES WRITTEN BY THE EXPORT:";
const KEEP = new Set([".git", "edits", ".opencode", ".claude"]);
const SCRIPTS = /\.(js|mjs|cjs|ts|py|sh|ps1|bat|cmd)$/i;

function written(root) {
    let lines;
    try {
        lines = fs.readFileSync(path.join(root, MARKER), "utf8").split(/\r?\n/);
    } catch {
        return null;
    }
    const at = lines.indexOf(FILES_HEADER);
    return at < 0 ? null : new Set([...lines.slice(at + 1).filter(Boolean), MARKER]);
}

function gitChanges(root) {
    const found = new Map();
    if (!fs.existsSync(path.join(root, ".git"))) return found;
    const r = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: root, encoding: "utf8", windowsHide: true });
    if (r.status !== 0 || !r.stdout) return found;
    const entries = r.stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.length < 4) continue;
        const xy = e.slice(0, 2), p = e.slice(3);
        if ("RC".includes(xy[0])) i++;
        if (KEEP.has(p.split("/")[0])) continue;
        if (xy === "??") found.set(p, "new");
        else if ("MT".includes(xy[1])) found.set(p, "changed");
        else if (xy[1] === "D") found.set(p, "deleted");
    }
    return found;
}

// [[path, kind]] sorted; kind: new | changed | deleted
function strayFiles(root) {
    const known = written(root);
    const found = gitChanges(root);
    const walk = (dir, rel) => {
        let items;
        try {
            items = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const d of items) {
            if (!rel && KEEP.has(d.name)) continue;
            const r = rel ? `${rel}/${d.name}` : d.name;
            if (d.isDirectory()) walk(path.join(dir, d.name), r);
            else if (known ? !known.has(r) : !rel && SCRIPTS.test(d.name) && d.name !== "mx.py") found.set(r, "new");
        }
    };
    walk(root, "");
    if (known) for (const [p, k] of found) if (k === "new" && known.has(p)) found.delete(p);
    return [...found].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const LABEL = { new: "not written by the export", changed: "export file edited after the export", deleted: "export file deleted (refresh brings it back)" };

function report(root) {
    const found = strayFiles(root);
    if (!found.length) return "Clean: no files outside edits/ besides the export.";
    return [`${found.length} file(s) outside edits/ that are not the export:`, ...found.map(([p, k]) => `  ${p}  (${LABEL[k]})`),
        "Change files belong in edits/<name>.json only. The user moves these away (nothing is deleted): python mx.py clean --move"].join("\n");
}

function warning(root) {
    try {
        const n = strayFiles(root).length;
        return n ? `WARNING: ${n} file(s) outside edits/: run python mx.py clean` : "";
    } catch {
        return "";
    }
}

module.exports = { strayFiles, report, warning };
