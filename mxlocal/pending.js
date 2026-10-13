"use strict";
// A dry run stores its encoded result here; apply writes exactly that, without running the script or the SDK again.
// The approval code ties the user's "yes" to this exact change: another dry run gives another code.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { BACKUP_DIR } = require("./mpr");

const PENDING = "pending";

function dir(projectDir) {
    return path.join(projectDir, BACKUP_DIR, PENDING);
}

// enc: Project.encode() result; info: { fingerprint, source, summary: [lines], plan?, content? (the change file text) }
function save(projectDir, enc, info) {
    const d = dir(projectDir);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(path.join(d, "units"), { recursive: true });
    const h = crypto.createHash("sha256").update(info.fingerprint);
    for (const f of enc.files) {
        fs.writeFileSync(path.join(d, "units", f.id + ".mxunit"), f.bytes);
        h.update(f.id).update(f.bytes);
    }
    // plain files (theme, packages): stored under files/<n>, keyed by their path
    const plainFiles = (enc.plainFiles || []).map((f, i) => {
        if (f.bytes !== null) fs.writeFileSync(path.join(d, "units", `file${i}.bin`), f.bytes);
        h.update(f.rel).update(f.bytes === null ? "(delete)" : f.bytes).update(String(f.before));
        return { rel: f.rel, hash: f.hash, before: f.before, data: f.bytes === null ? null : `file${i}.bin` };
    });
    h.update(JSON.stringify([enc.created, enc.deleted, enc.moved || [], info.plan || null]));
    const code = h.digest("hex").slice(0, 4).toUpperCase();
    const manifest = {
        code,
        fingerprint: info.fingerprint,
        source: info.source,
        createdAt: new Date().toISOString(),
        files: enc.files.map(f => ({ id: f.id, hash: f.hash })),
        created: enc.created,
        deleted: enc.deleted,
        moved: enc.moved || [],
        plainFiles,
        summary: info.summary,
        plan: info.plan || null,
        content: info.content
    };
    fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(manifest, null, 1));
    return code;
}

function load(projectDir) {
    const d = dir(projectDir);
    const file = path.join(d, "manifest.json");
    if (!fs.existsSync(file)) return null;
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    m.files = m.files.map(f => ({ ...f, bytes: fs.readFileSync(path.join(d, "units", f.id + ".mxunit")) }));
    m.plainFiles = (m.plainFiles || []).map(f => ({ ...f, bytes: f.data === null ? null : fs.readFileSync(path.join(d, "units", f.data)) }));
    return m;
}

function clear(projectDir) {
    fs.rmSync(dir(projectDir), { recursive: true, force: true });
}

module.exports = { save, load, clear };
