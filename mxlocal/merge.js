"use strict";
// Git merge helper for MPR v2. A Mendix MPR v2 app is <app>.mpr (SQLite: the Unit table with every unit's container
// and ContentsHash) plus mprcontents/xx/yy/<unit>.mxunit (one BSON file per document). Git cannot merge either: after
// a merge of two branches that both changed the model, the .mpr is in conflict (git keeps ours) and so is every unit
// file both sides changed. Per unit there is a 3-way answer: unchanged on one side -> take the other side; changed the
// same way -> either; changed differently -> a true conflict the user decides (ours / theirs). The Unit table is then
// rebuilt from the merged unit files (ContentsHash = sha256 of the file, base64) and the merged container rows.
//   mergecheck: read-only report.  mergefix: dry run of the fix (approval code), written by apply --code.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const bson = require("./bson");
const { toPlain, guidToString } = require("./convert");
const { Project } = require("./mpr");

const sha = b => crypto.createHash("sha256").update(b).digest("base64");

function git(cwd, args, opts = {}) {
    return execFileSync("git", args, { cwd, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], ...opts });
}
const gitText = (cwd, args) => git(cwd, args).toString("utf8").trim();
function gitTry(cwd, args) {
    try {
        return gitText(cwd, args);
    } catch {
        return null;
    }
}

// Unit rows of a .mpr (file or bytes): Map id -> { containerId, containmentName, hash }, and the Mendix version.
function tableOf(bytes) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-merge-")), "app.mpr");
    fs.writeFileSync(tmp, bytes);
    try {
        const db = new DatabaseSync(tmp, { readOnly: true });
        try {
            const rows = new Map();
            for (const r of db.prepare("select UnitID, ContainerID, ContainmentName, ContentsHash from Unit").all()) {
                const id = guidToString(Buffer.from(r.UnitID));
                const c = r.ContainerID ? guidToString(Buffer.from(r.ContainerID)) : null;
                rows.set(id, { containerId: c === id ? null : c, containmentName: r.ContainmentName, hash: r.ContentsHash });
            }
            return { rows, version: db.prepare("select _ProductVersion from _MetaData").get()._ProductVersion };
        } finally {
            db.close();
        }
    } finally {
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
}

// unit id -> blob sha of mprcontents in a commit
function blobsOf(repo, commit, prefix) {
    const out = new Map();
    const text = git(repo, ["ls-tree", "-r", commit, "--", `${prefix}mprcontents`]).toString("utf8");
    for (const line of text.split("\n")) {
        const m = /^\d+ blob ([0-9a-f]+)\t.*\/([0-9a-f-]{36})\.mxunit$/.exec(line);
        if (m) out.set(m[2], m[1]);
    }
    return out;
}

const rowKey = r => (r ? `${r.containerId}|${r.containmentName}` : null);

// 3-way pick: "same" | "ours" | "theirs" | "conflict"
function threeWay(b, o, t) {
    if (o === t) return "same";
    if (o === b) return "theirs";
    if (t === b) return "ours";
    return "conflict";
}

// ---------------------------------------------------------------- what each side changed in a unit (for conflicts)

// $ID -> { type, name, path, props } of a plain unit
function elements(plain) {
    const out = new Map();
    const walk = (o, where, parent = null) => {
        if (Array.isArray(o)) return o.forEach(x => walk(x, where, parent));
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
        const here = o.$Type ? (o.Name ? `${where ? where + "/" : ""}${o.Name}` : where) : where;
        if (o.$ID) {
            const props = {};
            for (const [k, v] of Object.entries(o)) {
                if (k[0] === "$") continue;
                if (v && typeof v === "object" && !Buffer.isBuffer(v)) {
                    if (Array.isArray(v)) props[k] = `[${v.map(x => (x && x.$ID ? "#" : JSON.stringify(x))).join(",")}]#${v.length}`;
                    continue;
                }
                props[k] = Buffer.isBuffer(v) ? `<${v.length} bytes>` : v;
            }
            out.set(String(o.$ID), { type: String(o.$Type || "").split("$").pop(), name: o.Name || "", path: here, props, parent });
        }
        for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, here, o.$ID ? String(o.$ID) : parent);
    };
    walk(plain, "");
    return out;
}

const short = v => {
    const s = typeof v === "string" ? JSON.stringify(v) : String(v);
    return s.length > 60 ? s.slice(0, 57) + "...\"" : s;
};

// Lines describing what changed from base to side (both plain units, either may be null)
function changes(base, side, max = 8) {
    if (!side) return ["deleted the document"];
    if (!base) return ["created the document"];
    const a = elements(base), b = elements(side);
    const lines = [];
    const label = e => `${e.type}${e.name ? ` '${e.name}'` : ""}${e.path && e.path !== e.name ? ` (in ${e.path.split("/").slice(0, -1).join("/") || e.path})` : ""}`;
    // an added (removed) element with everything in it: one line
    for (const [id, e] of b) if (!a.has(id) && !(e.parent && !a.has(e.parent))) lines.push(`added ${label(e)}`);
    for (const [id, e] of a) if (!b.has(id) && !(e.parent && !b.has(e.parent))) lines.push(`removed ${label(e)}`);
    for (const [id, e] of b) {
        const old = a.get(id);
        if (!old) continue;
        for (const k of new Set([...Object.keys(old.props), ...Object.keys(e.props)])) {
            if (old.props[k] === e.props[k]) continue;
            if (String(old.props[k]).includes("#") && String(e.props[k]).includes("#") && /\]#\d+$/.test(String(e.props[k]))) {
                if (String(old.props[k]).split("]#")[1] === String(e.props[k]).split("]#")[1]) lines.push(`reordered ${k} of ${label(e)}`);
                continue; // added/removed list items are reported as elements
            }
            lines.push(`${label(e)}: ${k} ${short(old.props[k])} -> ${short(e.props[k])}`);
        }
    }
    return lines.length > max ? [...lines.slice(0, max), `... ${lines.length - max} more change(s)`] : lines.length ? lines : ["no visible change (same content, other bytes)"];
}

// ---------------------------------------------------------------- analysis

function analyse(mprPath) {
    const project = new Project(mprPath);
    const dir = project.dir;
    const repo = gitTry(dir, ["rev-parse", "--show-toplevel"]);
    const r = { project, dir, repo, merging: false, units: [], conflicts: [], notes: [] };
    // the table and the unit files of the working tree must agree in any case
    const disk = new Map();
    if (fs.existsSync(project.contents)) {
        for (const a of fs.readdirSync(project.contents).filter(x => fs.statSync(path.join(project.contents, x)).isDirectory())) for (const b of fs.readdirSync(path.join(project.contents, a)).filter(x => fs.statSync(path.join(project.contents, a, x)).isDirectory())) {
            for (const f of fs.readdirSync(path.join(project.contents, a, b))) {
                const m = /^([0-9a-f-]{36})\.mxunit$/.exec(f);
                if (m) disk.set(m[1], path.join(project.contents, a, b, f));
            }
        }
    }
    r.disk = disk;
    if (!repo) {
        r.notes.push("not a git repository: only the unit table is checked against mprcontents");
        return consistency(r);
    }
    const head = gitTry(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    if (!head) {
        r.notes.push("no merge in progress (no MERGE_HEAD): only the unit table is checked against mprcontents");
        return consistency(r);
    }
    r.merging = true;
    const realRepo = fs.realpathSync(repo);
    let prefix = path.relative(realRepo, fs.realpathSync(dir)).replace(/\\/g, "/");
    prefix = prefix ? prefix + "/" : "";
    const mprRel = prefix + path.basename(project.mpr);
    const base = gitText(repo, ["merge-base", "HEAD", "MERGE_HEAD"]);
    r.commits = { base, ours: gitText(repo, ["rev-parse", "HEAD"]), theirs: gitText(repo, ["rev-parse", "MERGE_HEAD"]) };
    r.branch = { ours: gitTry(repo, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD", theirs: (gitTry(repo, ["name-rev", "--name-only", "MERGE_HEAD"]) || "MERGE_HEAD").replace(/~\d+$/, "") };
    const show = c => git(repo, ["show", `${c}:${mprRel}`]);
    const tB = tableOf(show(base)), tO = tableOf(show("HEAD")), tT = tableOf(show("MERGE_HEAD"));
    r.versions = { base: tB.version, ours: tO.version, theirs: tT.version };
    if (tO.version !== tT.version) r.notes.push(`the branches use different Mendix versions (${tO.version} / ${tT.version}): merge in Studio Pro after upgrading both to the same version`);
    const bB = blobsOf(repo, base, prefix), bO = blobsOf(repo, "HEAD", prefix), bT = blobsOf(repo, "MERGE_HEAD", prefix);
    r.unmerged = gitText(repo, ["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
    const ids = new Set([...bB.keys(), ...bO.keys(), ...bT.keys(), ...tO.rows.keys(), ...tT.rows.keys()]);
    const blob = id => ({ b: bB.get(id) || null, o: bO.get(id) || null, t: bT.get(id) || null });
    const plainCache = new Map();
    r.plainOf = sha1 => {
        if (!sha1) return null;
        if (!plainCache.has(sha1)) plainCache.set(sha1, toPlain(bson.decode(git(repo, ["cat-file", "blob", sha1]))));
        return plainCache.get(sha1);
    };
    r.bytesOf = sha1 => (sha1 ? git(repo, ["cat-file", "blob", sha1]) : null);
    // names: Module/Folder/Doc from the rows of any side
    const rowOf = id => tO.rows.get(id) || tT.rows.get(id) || tB.rows.get(id);
    const nameCache = new Map();
    const nameOf = id => {
        if (nameCache.has(id)) return nameCache.get(id);
        let p = null;
        const x = blob(id);
        try {
            p = r.plainOf(x.o || x.t || x.b);
        } catch {
            p = null;
        }
        const row = rowOf(id);
        const parts = [];
        for (let c = row && row.containerId, i = 0; c && i < 30; i++) {
            const cr = rowOf(c);
            const cx = blob(c);
            let cp = null;
            try {
                cp = r.plainOf(cx.o || cx.t || cx.b);
            } catch {
                cp = null;
            }
            if (cp && cp.Name && cp.$Type !== "Projects$Project") parts.unshift(cp.Name);
            c = cr && cr.containerId;
        }
        const own = p ? p.Name || (row ? row.containmentName : "") : id;
        const label = `${p ? p.$Type : "unit"} ${[...parts, own].filter(Boolean).join(".")}`.trim();
        nameCache.set(id, label);
        return label;
    };
    r.nameOf = nameOf;
    for (const id of ids) {
        const x = blob(id);
        const rows = { b: tB.rows.get(id), o: tO.rows.get(id), t: tT.rows.get(id) };
        const content = threeWay(x.b, x.o, x.t);
        const row = threeWay(rowKey(rows.b), rowKey(rows.o), rowKey(rows.t));
        if (content === "same" && row === "same" && x.o === x.b) continue; // untouched by both
        const u = { id, label: nameOf(id), content, row, blobs: x, rows };
        if (content === "conflict" || row === "conflict") {
            u.conflict = true;
            r.conflicts.push(u);
        }
        r.units.push(u);
    }
    return r;
}

// Without a merge: rows vs files of the working tree.
function consistency(r) {
    const { project, disk } = r;
    r.mismatch = [];
    for (const [id, u] of project.units) {
        const f = disk.get(id);
        if (!f) r.mismatch.push({ id, kind: "missing", text: `row without unit file: ${id}` });
        else {
            const h = sha(fs.readFileSync(f));
            if (h !== u.hash) r.mismatch.push({ id, kind: "hash", hash: h, text: `ContentsHash differs from the file: ${label(project, id)}` });
        }
    }
    for (const [id, f] of disk) if (!project.units.has(id)) r.mismatch.push({ id, kind: "orphan", text: `unit file without a row: ${path.relative(r.dir, f)}` });
    return r;
}

function label(project, id) {
    try {
        const p = project.read(id);
        return `${p.$Type} ${p.Name || id}`;
    } catch {
        return id;
    }
}

const SIDE = { ours: "ours (this branch)", theirs: "theirs (merged branch)" };

function report(r) {
    const out = [];
    out.push(`Project: ${r.project.mpr} (Mendix ${r.project.meta._ProductVersion})`);
    for (const n of r.notes) out.push("Note: " + n);
    if (!r.merging) {
        if (!r.mismatch.length) out.push("Unit table and mprcontents agree: nothing to fix.");
        else {
            out.push(`${r.mismatch.length} problem(s):`);
            out.push(...r.mismatch.slice(0, 30).map(m => "  ! " + m.text));
            const fixable = r.mismatch.filter(m => m.kind === "hash").length;
            if (fixable) out.push(`mergefix rebuilds the ContentsHash of ${fixable} unit(s) from their files.`);
            if (r.mismatch.some(m => m.kind !== "hash")) out.push("Rows without files and files without rows need the other branch or Studio Pro: restore the files from git, or open the app in Studio Pro.");
        }
        return out.join("\n");
    }
    out.push(`Merge in progress: ${r.branch.ours} (ours) <- ${r.branch.theirs} (theirs), base ${r.commits.base.slice(0, 8)}`);
    if (r.unmerged.length) out.push(`git reports ${r.unmerged.length} conflicted file(s) (${r.unmerged.filter(f => f.endsWith(".mpr")).length} .mpr, ${r.unmerged.filter(f => f.endsWith(".mxunit")).length} unit files)`);
    const auto = r.units.filter(u => !u.conflict);
    const fromTheirs = auto.filter(u => u.content === "theirs" || (u.content === "same" && u.row === "theirs"));
    const fromOurs = auto.filter(u => u.content === "ours" || (u.content === "same" && u.row === "ours"));
    const both = auto.filter(u => u.content === "same" && u.row === "same");
    const what = u => {
        const x = u.blobs;
        const c = u.content === "theirs" ? (x.t ? (x.b ? "changed" : "new") : "deleted") : u.content === "ours" ? (x.o ? (x.b ? "changed" : "new") : "deleted") : "moved";
        return `${c}: ${u.label}`;
    };
    out.push(`Resolved automatically (only one side changed them): ${auto.length} unit(s)`);
    if (fromTheirs.length) out.push(`  from theirs (${fromTheirs.length}):`, ...fromTheirs.slice(0, 20).map(u => "    " + what(u)), ...(fromTheirs.length > 20 ? [`    ... ${fromTheirs.length - 20} more`] : []));
    if (fromOurs.length) out.push(`  kept from ours (${fromOurs.length}):`, ...fromOurs.slice(0, 20).map(u => "    " + what(u)), ...(fromOurs.length > 20 ? [`    ... ${fromOurs.length - 20} more`] : []));
    if (both.length) out.push(`  same change on both sides: ${both.length}`);
    if (!r.conflicts.length) out.push("True conflicts: none.");
    else {
        out.push(`TRUE CONFLICTS (both sides changed the same document): ${r.conflicts.length}`);
        for (const u of r.conflicts) {
            out.push(`  ${u.id.slice(0, 8)} ${u.label}${u.content !== "conflict" ? " (moved to different folders)" : ""}`);
            if (u.content === "conflict") {
                let b = null, o = null, t = null;
                try {
                    [b, o, t] = [r.plainOf(u.blobs.b), r.plainOf(u.blobs.o), r.plainOf(u.blobs.t)];
                } catch (e) {
                    out.push(`      (cannot read: ${e.message})`);
                }
                out.push(`    ours (${r.branch.ours}):`, ...changes(b, o).map(l => "      " + l));
                out.push(`    theirs (${r.branch.theirs}):`, ...changes(b, t).map(l => "      " + l));
            }
        }
        out.push(`Pick a side per conflict: mergefix --pick "${r.conflicts[0].id.slice(0, 8)}=ours" (several: "id=ours,id2=theirs"; a document name works too), or --all ours|theirs.`,
            "The other side's change to that document is lost: redo it in Studio Pro after the merge if both are needed.");
    }
    if (r.notes.some(n => /different Mendix versions/.test(n))) out.push("mergefix is refused while the versions differ.");
    else out.push("Next: mergefix (dry run, approval code), then apply --code <CODE>, then git add the .mpr and mprcontents and commit the merge.");
    return out.join("\n");
}

function parsePicks(r, pick, all) {
    const picks = new Map();
    for (const part of String(pick && pick !== true ? pick : "").split(",").map(x => x.trim()).filter(Boolean)) {
        const m = /^(.+?)\s*=\s*(ours|theirs)$/i.exec(part);
        if (!m) throw new Error(`--pick '${part}': write <unit id or document name>=ours|theirs`);
        const key = m[1].toLowerCase();
        const hits = r.conflicts.filter(u => u.id.startsWith(key) || u.label.toLowerCase().endsWith(" " + key) || u.label.toLowerCase().endsWith("." + key));
        if (hits.length !== 1) throw new Error(`--pick '${m[1]}' matches ${hits.length} conflicts (conflicts: ${r.conflicts.map(u => `${u.id.slice(0, 8)} ${u.label}`).join(", ") || "none"})`);
        picks.set(hits[0].id, m[2].toLowerCase());
    }
    if (all && all !== true) {
        if (!/^(ours|theirs)$/i.test(all)) throw new Error("--all is ours or theirs");
        for (const u of r.conflicts) if (!picks.has(u.id)) picks.set(u.id, all.toLowerCase());
    }
    return picks;
}

// The encoded change (Project.writeEncoded format) that makes the working tree the merged model.
function plan(r, picks) {
    const { project } = r;
    const enc = { files: [], created: [], deleted: [], moved: [] };
    const lines = [];
    if (!r.merging) {
        for (const m of r.mismatch.filter(x => x.kind === "hash")) {
            enc.files.push({ id: m.id, bytes: fs.readFileSync(r.disk.get(m.id)), hash: m.hash });
            lines.push(`  ~ ContentsHash of ${label(project, m.id)}`);
        }
        return { enc, lines };
    }
    if (r.notes.some(n => /different Mendix versions/.test(n))) throw new Error("The branches use different Mendix versions; merge in Studio Pro.");
    const open = r.conflicts.filter(u => !picks.has(u.id));
    if (open.length) throw new Error(`${open.length} true conflict(s) need a side: ${open.map(u => `${u.id.slice(0, 8)} ${u.label}`).join(", ")}. Run mergecheck to see both changes, then mergefix --pick "<id>=ours|theirs" or --all ours|theirs`);
    const counts = { ours: 0, theirs: 0 };
    // every unit any side has: its final content and row
    for (const u of r.units) {
        const side = u.conflict ? picks.get(u.id) : null;
        const pickC = side || (u.content === "theirs" ? "theirs" : "ours");
        const pickR = side || (u.row === "theirs" ? "theirs" : "ours");
        const sha1 = pickC === "theirs" ? u.blobs.t : u.blobs.o;
        const row = pickR === "theirs" ? u.rows.t : u.rows.o;
        const cur = project.units.get(u.id);
        if (side) counts[side]++;
        if (!sha1 || !row) {
            if (cur || r.disk.has(u.id)) {
                enc.deleted.push(u.id); // the row (if any) and the unit file git may have left
                lines.push(`  - ${u.label}${side ? ` (${side})` : ""}`);
            }
            continue;
        }
        const bytes = r.bytesOf(sha1);
        const hash = sha(bytes);
        const onDisk = r.disk.has(u.id) ? fs.readFileSync(r.disk.get(u.id)) : null;
        if (!cur) {
            enc.files.push({ id: u.id, bytes, hash });
            enc.created.push({ id: u.id, containerId: row.containerId || u.id, containmentName: row.containmentName });
            lines.push(`  + ${u.label}${side ? ` (${side})` : ""}`);
            continue;
        }
        if (cur.hash !== hash || !onDisk || !onDisk.equals(bytes)) {
            enc.files.push({ id: u.id, bytes, hash });
            lines.push(`  ~ ${u.label}${side ? ` (${side})` : " (" + (pickC === "theirs" ? "theirs" : "ours") + ")"}`);
        }
        if (rowKey(cur) !== rowKey(row) && row.containerId) {
            enc.moved.push({ id: u.id, containerId: row.containerId, containmentName: row.containmentName });
            lines.push(`  > ${u.label}`);
        }
    }
    return { enc, lines, counts };
}

function mergecheck(mpr) {
    return report(analyse(mpr));
}

// Dry run of the fix: stores it as the pending change (apply --code writes it, with a backup; restore undoes it).
function mergefix(mpr, pick, all) {
    const r = analyse(mpr);
    const out = [report(r), ""];
    const picks = r.merging ? parsePicks(r, pick, all) : new Map();
    const { enc, lines, counts } = plan(r, picks);
    const pending = require("./pending");
    if (!enc.files.length && !enc.created.length && !enc.deleted.length && !enc.moved.length) {
        pending.clear(r.dir);
        out.push("Nothing to write: the unit table and mprcontents already are the merged model.");
        return { text: out.join("\n"), code: null };
    }
    const summary = [`mergefix: ${enc.files.length} unit file(s) written, ${enc.created.length} row(s) added, ${enc.deleted.length} removed, ${enc.moved.length} moved${counts && (counts.ours || counts.theirs) ? `; conflicts: ${counts.ours} ours, ${counts.theirs} theirs` : ""}`, ...lines.slice(0, 200)];
    out.push(...summary);
    const content = JSON.stringify({ mergefix: { pick: pick && pick !== true ? pick : null, all: all && all !== true ? all : null, commits: r.commits || null } }, null, 1);
    const code = pending.save(r.dir, enc, { fingerprint: r.project.fingerprint(), source: path.join(r.dir, "mergefix.json"), summary, plan: null, content });
    out.push(`Dry run: nothing written. Approval code: ${code}`);
    out.push(`After the user approves (Studio Pro closed): apply --code ${code}`);
    if (r.merging) out.push(`Then: git add "${path.basename(r.project.mpr)}" mprcontents && git commit (finishes the merge).`);
    return { text: out.join("\n"), code };
}

module.exports = { mergecheck, mergefix, analyse, changes, threeWay };
