"use strict";
// Per-project cache in .mxlocal-backup/cache.bin, so a command does not decode every unit again.
// Per unit, keyed by its ContentsHash: what the catalog learned from it, its $Type and Name, the names inside it and its
// public SDK interface, its candidate references (refs.js). Per project: the schema calibration, reused while the catalog's keys and kinds stay the same.
// A Studio Pro save changes only the hashes of the units it saved, so only those are decoded again.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const v8 = require("v8");

const FRAGMENT_CAP = 256; // distinct sample values per key in one unit; see Catalog.merge

// Code and data files whose change makes every cached entry stale.
const SOURCES = ["bson.js", "convert.js", "schema.js", "client.js", "cache.js", "storage-names.json", "reference-catalog.json", "list-markers.json", "refs.js"];
let codeKey = null;
function code() {
    if (!codeKey) {
        const h = crypto.createHash("sha256").update(require("mendixmodelsdk/package.json").version);
        for (const f of SOURCES) {
            const file = path.join(__dirname, f);
            if (fs.existsSync(file)) h.update(fs.readFileSync(file));
        }
        codeKey = h.digest("base64");
    }
    return codeKey;
}

class Cache {
    constructor(project) {
        this.project = project;
        this.file = path.join(project.dir, ".mxlocal-backup", "cache.bin");
        this.key = code() + "|" + project.meta._ProductVersion;
        this.units = new Map();
        this.calibration = null;
        this.dirty = false;
        try {
            const c = v8.deserialize(fs.readFileSync(this.file));
            if (c.key === this.key) {
                this.units = c.units;
                this.calibration = c.calibration;
            }
        } catch {
            // no cache yet, or unreadable: start empty
        }
        // forget units that are gone or changed
        for (const [id, e] of this.units) {
            const u = project.units.get(id);
            if (!u || u.hash !== e.hash) this.units.delete(id);
        }
    }

    // Cached entry of a unit, created from its stored contents when missing.
    unit(id, Catalog) {
        let e = this.units.get(id);
        if (!e) {
            const plain = this.project.read(id);
            const frag = new Catalog(FRAGMENT_CAP);
            frag.learn(plain);
            e = { hash: this.project.units.get(id).hash, types: frag.types, type: plain.$Type, name: typeof plain.Name === "string" ? plain.Name : null, names: localNames(plain), iface: undefined };
            this.units.set(id, e);
            this.dirty = true;
        }
        return e;
    }

    // Calibration of the last run, when the catalog signature is the same.
    calibrationFor(signature) {
        return this.calibration && this.calibration.signature === signature ? this.calibration.result : null;
    }

    setCalibration(signature, result) {
        this.calibration = { signature, result };
        for (const e of this.units.values()) e.iface = undefined; // interfaces depend on the storage names
        this.dirty = true;
    }

    save() {
        if (!this.dirty) return;
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.${process.pid}.tmp`; // two commands at once must not share a temp file
            fs.writeFileSync(tmp, v8.serialize({ key: this.key, units: this.units, calibration: this.calibration }));
            fs.renameSync(tmp, this.file);
            this.dirty = false;
        } catch {
            // read-only folder: work without a cache
        }
    }
}

// Names inside a unit, relative to the unit (documents) or to its module (domain model, module security), with the
// storage $Type of each element. inspect.names() adds the prefix.
function localNames(plain) {
    const items = [];
    const walk = (obj, prefix, depth) => {
        if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
        if (Array.isArray(obj)) return obj.forEach(x => walk(x, prefix, depth));
        let next = prefix;
        if (obj.$Type && typeof obj.Name === "string" && obj.Name && depth > 0) {
            next = prefix ? `${prefix}.${obj.Name}` : obj.Name;
            items.push([next, obj.$Type]);
        }
        for (const [k, v] of Object.entries(obj)) if (k[0] !== "$" && v && typeof v === "object") walk(v, next, depth + 1);
    };
    if (plain.$Type === "DomainModels$DomainModel" || /Security\$ModuleSecurity/.test(plain.$Type)) {
        walk(plain, "", 0);
        return { base: "module", items };
    }
    if (/Enumeration|Microflow|Nanoflow|ImageCollection/.test(plain.$Type)) walk(plain, "", 0);
    return { base: "unit", items };
}

module.exports = { Cache, localNames };
