"use strict";
// Read/write a Mendix MPR v2 project: <name>.mpr (SQLite: _MetaData, Unit, _Transaction) + mprcontents/xx/yy/<guid>.mxunit
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const bson = require("./bson");
const { toPlain, fromPlain, guidToBytes, guidToString } = require("./convert");

const BACKUP_DIR = ".mxlocal-backup";

class Project {
    constructor(mprPath) {
        this.mpr = path.resolve(mprPath);
        this.dir = path.dirname(this.mpr);
        this.contents = path.join(this.dir, "mprcontents");
        const db = new DatabaseSync(this.mpr, { readOnly: true });
        try {
            this.meta = db.prepare("select * from _MetaData").get();
            if (this.meta._FormatVersion !== 2 || !fs.existsSync(this.contents)) {
                throw new Error("Only MPR v2 projects (with an mprcontents folder) are supported.");
            }
            this.units = new Map();
            for (const r of db.prepare("select UnitID, ContainerID, ContainmentName, ContentsHash from Unit").all()) {
                const id = guidToString(Buffer.from(r.UnitID));
                const containerId = r.ContainerID ? guidToString(Buffer.from(r.ContainerID)) : null;
                this.units.set(id, { id, containerId: containerId === id ? null : containerId, containmentName: r.ContainmentName, hash: r.ContentsHash });
            }
        } finally {
            db.close();
        }
        this.plain = new Map();
    }

    get version() {
        return this.meta._ProductVersion.split(".").slice(0, 3).join(".");
    }

    unitFile(id) {
        return path.join(this.contents, id.slice(0, 2), id.slice(2, 4), id + ".mxunit");
    }

    readBytes(id) {
        return fs.readFileSync(this.unitFile(id));
    }

    // Plain (storage-named) contents of a unit; cached.
    read(id) {
        let p = this.plain.get(id);
        if (!p) {
            p = toPlain(bson.decode(this.readBytes(id)));
            this.plain.set(id, p);
        }
        return p;
    }

    lockFile() {
        return this.mpr + ".lock";
    }

    assertClosed() {
        if (fs.existsSync(this.lockFile())) {
            throw new Error(`Studio Pro has this project open (${path.basename(this.lockFile())} exists). Close Studio Pro and try again.`);
        }
    }

    // changes: { updated: Set<id>, created: Map<id,{containerId, containmentName}>, deleted: Set<id> }; contents come from this.plain.
    write(changes, hint) {
        this.assertClosed();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backup = path.join(this.dir, BACKUP_DIR, stamp);
        fs.mkdirSync(backup, { recursive: true });
        fs.copyFileSync(this.mpr, path.join(backup, path.basename(this.mpr)));
        const manifest = { mpr: path.basename(this.mpr), restore: [], remove: [] };
        const touched = [...changes.updated, ...changes.deleted].filter(id => !changes.created.has(id));
        for (const id of touched) {
            const rel = path.relative(this.dir, this.unitFile(id));
            fs.mkdirSync(path.dirname(path.join(backup, rel)), { recursive: true });
            fs.copyFileSync(this.unitFile(id), path.join(backup, rel));
            manifest.restore.push(rel);
        }
        for (const id of changes.created.keys()) if (!changes.deleted.has(id)) manifest.remove.push(path.relative(this.dir, this.unitFile(id)));
        fs.writeFileSync(path.join(backup, "manifest.json"), JSON.stringify(manifest, null, 1));

        const hashes = new Map();
        try {
            for (const id of new Set([...changes.updated, ...changes.created.keys()])) {
                if (changes.deleted.has(id)) continue;
                const bytes = bson.encode(fromPlain(this.read(id), hint));
                const file = this.unitFile(id);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file + ".tmp", bytes);
                fs.renameSync(file + ".tmp", file);
                hashes.set(id, crypto.createHash("sha256").update(bytes).digest("base64"));
            }
            const db = new DatabaseSync(this.mpr);
            let open = false;
            try {
                db.exec("BEGIN IMMEDIATE");
                open = true;
                const upd = db.prepare("update Unit set ContentsHash = ? where UnitID = ?");
                const ins = db.prepare("insert into Unit (UnitID, ContainerID, ContainmentName, TreeConflict, ContentsHash, ContentsConflicts) values (?, ?, ?, 0, ?, '')");
                const del = db.prepare("delete from Unit where UnitID = ?");
                for (const [id, hash] of hashes) {
                    const c = changes.created.get(id);
                    if (c) ins.run(guidToBytes(id), guidToBytes(c.containerId), c.containmentName, hash);
                    else upd.run(hash, guidToBytes(id));
                }
                for (const id of changes.deleted) if (!changes.created.has(id)) del.run(guidToBytes(id));
                db.prepare("update _Transaction set LastTransactionID = ?").run(crypto.randomUUID());
                db.exec("COMMIT");
                open = false;
            } catch (e) {
                if (open) db.exec("ROLLBACK");
                throw e;
            } finally {
                db.close();
            }
            for (const id of changes.deleted) if (fs.existsSync(this.unitFile(id))) fs.unlinkSync(this.unitFile(id));
        } catch (e) {
            restore(this.dir, backup);
            throw new Error(`Write failed and the project was restored from ${backup}: ${e.message}`);
        }
        return { backup, written: hashes.size, deleted: changes.deleted.size };
    }
}

function backups(dir) {
    const root = path.join(dir, BACKUP_DIR);
    return fs.existsSync(root) ? fs.readdirSync(root).filter(n => !n.endsWith(".restored")).sort() : [];
}

function restore(dir, backup) {
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, "manifest.json"), "utf8"));
    for (const rel of manifest.remove) if (fs.existsSync(path.join(dir, rel))) fs.unlinkSync(path.join(dir, rel));
    for (const rel of manifest.restore) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.copyFileSync(path.join(backup, rel), path.join(dir, rel));
    }
    fs.copyFileSync(path.join(backup, manifest.mpr), path.join(dir, manifest.mpr));
    return manifest;
}

module.exports = { Project, backups, restore, BACKUP_DIR };
