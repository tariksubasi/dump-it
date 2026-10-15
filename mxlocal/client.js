"use strict";
// IModelServerClient implementation that serves a local MPR v2 project to the Mendix Model SDK
// and applies the SDK's deltas to an in-memory copy of the project (written only on save()).
const fs = require("fs");
const path = require("path");
const { Model } = require("mendixmodelsdk");
const { Project } = require("./mpr");
const { Schema } = require("./schema");
const { Catalog, toSdk, fromSdk, valueToPlain, complete, hinter } = require("./convert");
const { Cache } = require("./cache");

const WC = "local";
// A flow's parameter object is what call mappings name as Microflows$MicroflowParameter / NanoflowParameter / RuleParameter.
const PARAMETER_ALIAS = (type, target) => type === "Microflows$MicroflowParameterObject" && /^Microflows\$\w*Parameter$/.test(target);

async function loadProject(mprPath) {
    const project = new Project(mprPath);
    const cache = (project.cache = new Cache(project));
    const catalog = new Catalog();
    // unit order matters: merging cached fragments in this order equals learning the units in this order
    for (const [id] of project.units) catalog.merge(cache.unit(id, Catalog).types);
    const schema = await Schema.create(project.version);
    // reference-catalog.json: { "<major>": { storageType: keys } } learned from Studio Pro projects of that major version.
    // Same major: strict (added before calibration). Other major: only keys the SDK maps for this version.
    // Types the same major version's samples lack are then taken loosely from the other versions (nearest first).
    const all = require("./reference-catalog.json");
    const major = project.version.split(".")[0];
    const byDistance = Object.keys(all).sort((a, b) => Math.abs(a - major) - Math.abs(b - major) || b - a);
    if (all[major]) catalog.addReference(all[major], null, true);
    for (const other of byDistance) if (other !== major) catalog.addReference(all[other], null, false);
    const signature = catalog.signature();
    const known = cache.calibrationFor(signature);
    if (known) schema.restore(known);
    else {
        schema.calibrate(catalog); // learns storage names from the reference types too
        cache.setCalibration(signature, schema.calibration());
    }
    catalog.pruneLoose(schema);
    cache.save();
    return { project, catalog, schema };
}

class LocalClient {
    constructor({ project, catalog, schema }) {
        this.project = project;
        this.catalog = catalog;
        this.schema = schema;
        this.model = null;
        this.eventId = 1;
        this.index = new Map(); // elementId -> { obj, parent, key, unitId }
        this.indexed = new Set();
        this.detached = new Map();
        this.changes = { updated: new Set(), created: new Map(), deleted: new Set(), moved: new Map() };
        this.warnings = new Set();
        this.log = [];
        this.warn = w => this.warnings.add(w);
        // lines the reader must see first (e.g. which grid kind a page got), in the order given
        this.front = 0;
        this.warnFirst = w => {
            const rest = [...this.warnings].filter(x => x !== w);
            rest.splice(Math.min(this.front++, rest.length), 0, w);
            this.warnings = new Set(rest);
        };
    }

    async open() {
        this.model = await Model.createSdkClient({ client: this }).openWorkingCopy(WC);
        return this.model;
    }

    // ----- IModelServerClient: reading -----

    loadWorkingCopyMetaData(id, callback) {
        const m = this.project.meta;
        callback({
            id,
            metaData: { name: this.project.mpr, description: "", avatarUrl: "", projectId: WC, metaModelVersion: this.project.version },
            members: [],
            mprFileName: path.basename(this.project.mpr),
            mprMetaData: { _ProductVersion: m._ProductVersion, _BuildVersion: m._BuildVersion }
        });
    }

    unitJson(id, publicOnly) {
        const u = this.project.units.get(id);
        const plain = this.project.read(id);
        const unknown = new Set();
        const contents = toSdk(plain, this.schema, { publicOnly, unknown });
        for (const t of unknown) this.warn(`${t} is not known to the Model SDK; left untouched`);
        if (!contents) return null;
        return {
            $ID: id,
            $Type: contents.$Type,
            containerId: u.containerId,
            containmentName: u.containerId ? this.sdkContainment(u.containerId, u.containmentName) : "",
            contents
        };
    }

    sdkContainment(containerId, storageName) {
        const info = this.schema.info(this.schema.sdkType(this.project.read(containerId).$Type));
        for (const p of info.byName.values()) if (p.key === storageName) return p.name;
        return storageName[0].toLowerCase() + storageName.slice(1);
    }

    storageContainment(containerId, sdkName) {
        const info = this.schema.info(this.schema.sdkType(this.project.read(containerId).$Type));
        const p = info.byName.get(sdkName);
        if (!p) throw new Error(`Unknown containment '${sdkName}' on unit ${containerId}`);
        return p.key;
    }

    loadUnitInterfaces(id, callback, errorCallback) {
        try {
            const units = [];
            const cache = this.project.cache;
            for (const uid of this.project.units.keys()) {
                const e = cache && cache.units.get(uid);
                if (e && e.iface === undefined) {
                    e.iface = this.unitJson(uid, true); // stored contents: nothing has changed yet at open()
                    cache.dirty = true;
                }
                const j = e ? e.iface : this.unitJson(uid, true);
                if (j) units.push(j);
            }
            if (cache) cache.save();
            callback({ units, eventId: this.eventId });
        } catch (e) {
            errorCallback(e);
        }
    }

    loadUnitById(id, unitId, callback, errorCallback) {
        try {
            callback({ unit: this.unitJson(unitId, false), eventId: this.eventId });
        } catch (e) {
            errorCallback(e);
        }
    }

    getWorkingCopyEventSource() {
        return { addEventListener() {}, close() {}, readyState: 1 };
    }

    // ----- IModelServerClient: writing -----

    sendDeltas(id, deltas, callback, errorCallback) {
        try {
            for (const d of deltas) this.apply(d);
            this.eventId++;
            callback({ firstError: null, eventId: this.eventId });
        } catch (e) {
            errorCallback(e);
        }
    }

    indexUnit(unitId) {
        if (this.indexed.has(unitId)) return;
        this.indexed.add(unitId);
        this.indexTree(this.project.read(unitId), null, null, unitId);
    }

    indexTree(obj, parent, key, unitId) {
        if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
        if (Array.isArray(obj)) return obj.forEach(x => this.indexTree(x, parent, key, unitId));
        if (obj.$ID) this.index.set(obj.$ID, { obj, parent, key, unitId });
        for (const [k, v] of Object.entries(obj)) if (k[0] !== "$" && v && typeof v === "object") this.indexTree(v, obj, k, unitId);
    }

    unindexTree(obj) {
        if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
        if (Array.isArray(obj)) return obj.forEach(x => this.unindexTree(x));
        if (obj.$ID) this.index.delete(obj.$ID);
        for (const [k, v] of Object.entries(obj)) if (k[0] !== "$" && v && typeof v === "object") this.unindexTree(v);
    }

    element(unitId, elementId) {
        this.indexUnit(unitId);
        const e = this.index.get(elementId || unitId);
        if (!e) throw new Error(`Element ${elementId} not found in unit ${unitId}`);
        return e;
    }

    prop(obj, sdkName) {
        const info = this.schema.info(this.schema.sdkType(obj.$Type));
        const p = info && info.byName.get(sdkName);
        if (!p) throw new Error(`Property '${sdkName}' of ${obj.$Type} cannot be stored`);
        return p;
    }

    // Does this Mendix version store key for storage type? Unknown types (never seen anywhere) are assumed to.
    stored(type, key) {
        if (!this.catalog.types.has(type)) return true;
        if (this.catalog.reference.has(type)) {
            if (this.catalog.looseTypes.has(type)) return true;
            const info = this.schema.info(this.schema.sdkType(type));
            if (info && info.byKey.has(key)) return true; // see complete(): sample may predate this version
        }
        return !!this.catalog.get(type, key);
    }

    newTree(json) {
        const plain = fromSdk(json, this.schema);
        complete(plain, this.catalog, this.schema, this.warn);
        return plain;
    }

    insert(parent, p, value, index) {
        if (p.kind === "part") {
            if (parent[p.key]) this.unindexTree(parent[p.key]);
            parent[p.key] = value;
        } else {
            if (!Array.isArray(parent[p.key])) parent[p.key] = [];
            const list = parent[p.key];
            list.splice(this.storeIndex(list, index), 0, value);
        }
    }

    // The SDK does not see elements of types it does not know, so its list indexes skip them.
    storeIndex(list, sdkIndex) {
        if (sdkIndex === undefined) return list.length;
        let seen = 0;
        for (let i = 0; i < list.length; i++) {
            const x = list[i];
            const hidden = x && typeof x === "object" && x.$Type && !this.schema.info(this.schema.sdkType(x.$Type));
            if (hidden) continue;
            if (seen === sdkIndex) return i;
            seen++;
        }
        return list.length;
    }

    remove(entry) {
        const { obj, parent, key } = entry;
        if (Array.isArray(parent[key])) parent[key].splice(parent[key].indexOf(obj), 1);
        else parent[key] = null;
    }

    apply(d) {
        const touch = () => this.changes.updated.add(d.unitId);
        switch (d.deltaType) {
            case "UPDATE_PROPERTY_VALUE": {
                const { obj } = this.element(d.unitId, d.elementId);
                const p = this.prop(obj, d.propertyName);
                const m = d.mutator;
                const item = v => (p.kind === "primList" ? valueToPlain({ kind: "prim", prim: p.prim }, v) : v === null && p.kind === "byNameList" ? "" : v);
                const before = obj[p.key];
                if (!this.stored(obj.$Type, p.key)) {
                    this.warn(`${obj.$Type}.${p.key} is not stored by this Mendix version; the new value is not saved`);
                    break;
                }
                if (m.mutatorType === "CHANGE") {
                    if (Array.isArray(obj[p.key]) && m.updateIndex !== undefined) obj[p.key][m.updateIndex] = item(m.value);
                    else obj[p.key] = valueToPlain(p, m.value, this.schema);
                } else if (m.mutatorType === "ADD") {
                    if (!Array.isArray(obj[p.key])) obj[p.key] = [];
                    obj[p.key].splice(m.insertionIndex === undefined ? obj[p.key].length : m.insertionIndex, 0, item(m.value));
                } else if (m.mutatorType === "REMOVE") obj[p.key].splice(m.removalIndex, 1);
                touch();
                if (d.propertyName === "name" && typeof before === "string" && before && before !== obj[p.key]) this.rename(d.elementId || d.unitId, before, obj[p.key]);
                break;
            }
            case "CREATE_ELEMENT_TREE": {
                const { obj: parent } = this.element(d.unitId, d.parentId);
                const p = this.prop(parent, d.parentPropertyName);
                const tree = this.newTree(d.elementTree);
                this.insert(parent, p, tree, d.additionIndex);
                this.indexTree(tree, parent, p.key, d.unitId);
                touch();
                break;
            }
            case "DELETE_ELEMENT": {
                const e = this.element(d.unitId, d.elementId);
                this.remove(e);
                this.unindexTree(e.obj);
                touch();
                break;
            }
            case "DETACH_ELEMENT": {
                const e = this.element(d.unitId, d.elementId);
                this.remove(e);
                this.unindexTree(e.obj);
                this.detached.set(d.elementId, e.obj);
                touch();
                break;
            }
            case "ATTACH_ELEMENT": {
                const obj = this.detached.get(d.elementId);
                if (!obj) throw new Error(`Element ${d.elementId} is not detached`);
                this.detached.delete(d.elementId);
                const { obj: parent } = this.element(d.unitId, d.newParentId);
                const p = this.prop(parent, d.newParentPropertyName);
                this.insert(parent, p, obj, d.newIndex);
                this.indexTree(obj, parent, p.key, d.unitId);
                touch();
                break;
            }
            case "CREATE_UNIT_TREE": {
                const tree = this.newTree({ ...d.unitTree, $ID: d.unitId, $Type: d.contentType });
                const containmentName = this.storageContainment(d.containerId, d.containmentName);
                this.project.plain.set(d.unitId, tree);
                this.project.units.set(d.unitId, { id: d.unitId, containerId: d.containerId, containmentName });
                this.changes.created.set(d.unitId, { containerId: d.containerId, containmentName });
                this.indexed.add(d.unitId);
                this.indexTree(tree, null, null, d.unitId);
                break;
            }
            case "DELETE_UNIT": {
                const doomed = new Set([d.unitId]);
                let grew = true;
                while (grew) {
                    grew = false;
                    for (const u of this.project.units.values()) {
                        if (!doomed.has(u.id) && doomed.has(u.containerId)) {
                            doomed.add(u.id);
                            grew = true;
                        }
                    }
                }
                for (const id of doomed) {
                    this.project.units.delete(id);
                    this.changes.updated.delete(id);
                    if (this.changes.created.has(id)) this.changes.created.delete(id);
                    else this.changes.deleted.add(id);
                }
                break;
            }
            default:
                throw new Error("Unsupported delta " + d.deltaType);
        }
        this.log.push(d);
    }

    // The Model Server rewrites by-name references when something is renamed; do the same across all units.
    rename(elementId, oldName, newName) {
        const s = this.model && this.findStructure(elementId);
        if (s && /^Projects\$Module/.test(s.structureTypeName)) return this.renameModule(oldName, newName);
        const qn = s && s._getQualifiedName && s._getQualifiedName();
        if (!qn) return;
        const parts = qn.split(".");
        if (parts[parts.length - 1] !== newName) return;
        const newQn = qn;
        const oldQn = parts.slice(0, -1).concat(oldName).join(".");
        const targetType = s.structureTypeName;
        let changed = 0;
        const fix = (v, p) => {
            if (typeof v !== "string" || !v) return v;
            if (v === oldQn && (!p.target || this.schema.isSubtype(targetType, p.target) || PARAMETER_ALIAS(targetType, p.target))) return newQn;
            if (v.startsWith(oldQn + ".")) return newQn + v.slice(oldQn.length);
            return v;
        };
        const walk = (obj, unitId) => {
            if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
            if (Array.isArray(obj)) return obj.forEach(x => walk(x, unitId));
            const info = obj.$Type && this.schema.info(this.schema.sdkType(obj.$Type));
            for (const [k, v] of Object.entries(obj)) {
                if (k[0] === "$") continue;
                const p = info && info.byKey.get(k);
                if (p && (p.kind === "byName" || p.kind === "byNameList")) {
                    const nv = Array.isArray(v) ? v.map(x => fix(x, p)) : fix(v, p);
                    if (JSON.stringify(nv) !== JSON.stringify(v)) {
                        obj[k] = nv;
                        this.changes.updated.add(unitId);
                        changed++;
                    }
                } else if (v && typeof v === "object") walk(v, unitId);
            }
        };
        for (const unitId of this.project.units.keys()) walk(this.project.read(unitId), unitId);
        this.renames = (this.renames || []).concat(`${oldQn} -> ${newQn} (${changed} references)`);
        this.leftovers = (this.leftovers || []).concat(this.findText(oldQn, oldName, parts.length > 2));
    }

    // A module name prefixes every qualified name: rewrite by-name references, and "Old." in expressions and XPath
    // (unambiguous because of the dot). Code folders named after the module must be moved by hand.
    renameModule(oldName, newName) {
        let refs = 0;
        let exprs = 0;
        const prefix = oldName + ".";
        const re = new RegExp(`(^|[^A-Za-z0-9_.])${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`, "g");
        const exprKey = /expression|xpath|constraint|argument|value|formula|node|condition/i;
        const walk = (obj, unitId) => {
            if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
            if (Array.isArray(obj)) return obj.forEach(x => walk(x, unitId));
            const info = obj.$Type && this.schema.info(this.schema.sdkType(obj.$Type));
            for (const [k, v] of Object.entries(obj)) {
                if (k[0] === "$") continue;
                const p = info && info.byKey.get(k);
                const byName = p && (p.kind === "byName" || p.kind === "byNameList");
                const fix = x => {
                    if (typeof x !== "string") return x;
                    if (byName) return x === oldName ? newName : x.startsWith(prefix) ? newName + "." + x.slice(prefix.length) : x;
                    return exprKey.test(k) ? x.replace(re, (m, pre) => `${pre}${newName}.`) : x;
                };
                if (typeof v === "string" || (Array.isArray(v) && v.every(x => typeof x === "string") && v.length)) {
                    const nv = Array.isArray(v) ? v.map(fix) : fix(v);
                    if (JSON.stringify(nv) !== JSON.stringify(v)) {
                        obj[k] = nv;
                        this.changes.updated.add(unitId);
                        if (byName) refs++;
                        else exprs++;
                    }
                } else if (v && typeof v === "object") walk(v, unitId);
            }
        };
        for (const unitId of this.project.units.keys()) walk(this.project.read(unitId), unitId);
        this.renames = (this.renames || []).concat(`${oldName} -> ${newName} (${refs} references, ${exprs} expressions/XPath)`);
        const folders = ["javasource", "javascriptsource", "themesource"].map(d => path.join(this.project.dir, d, oldName.toLowerCase())).filter(d => fs.existsSync(d));
        const left = this.findText(oldName, oldName, false).filter(h => !/expression|xpath|constraint|argument|value|formula|node|condition/i.test(h.split(": ")[2] || ""));
        this.leftovers = (this.leftovers || []).concat(
            folders.map(d => `${oldName}: folder ${path.relative(this.project.dir, d)} keeps the old name; Studio Pro creates ${path.basename(d) === oldName.toLowerCase() ? newName.toLowerCase() : newName}: move the code over`),
            left.slice(0, 30)
        );
    }

    // Names inside expressions, XPath, texts and Java code are plain strings: the rename cannot update them.
    // member: the renamed thing is an attribute/association-like member (Module.Entity.Member), which expressions
    // and XPath write by its short name ($var/Member, [Member = ...]).
    findText(oldQn, oldName, member) {
        const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const qnRe = new RegExp(`(^|[^A-Za-z0-9_.])${esc(oldQn)}($|[^A-Za-z0-9_])`);
        const shortRe = new RegExp(`(?<!\\$)\\b${esc(oldName)}\\b`); // not $Var
        const hits = [];
        const walk = (obj, unitId, where) => {
            if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
            if (Array.isArray(obj)) return obj.forEach((x, i) => walk(x, unitId, where));
            const info = obj.$Type && this.schema.info(this.schema.sdkType(obj.$Type));
            for (const [k, v] of Object.entries(obj)) {
                if (k[0] === "$" || k === "Name" || k === "Documentation") continue;
                const p = info && info.byKey.get(k);
                if (typeof v === "string" && !(p && (p.kind === "byName" || p.kind === "byNameList"))) {
                    const xpathOrExpr = /xpath|expression|constraint|argument|value|formula/i.test(k) || v.startsWith("[");
                    if (qnRe.test(v) || (member && xpathOrExpr && shortRe.test(v))) {
                        hits.push(`${this.label(unitId)}: ${obj.$Type.split("$")[1]}.${k} = ${JSON.stringify(v.length > 120 ? v.slice(0, 120) + "..." : v)}`);
                    }
                } else if (v && typeof v === "object") walk(v, unitId);
            }
        };
        for (const unitId of this.project.units.keys()) walk(this.project.read(unitId), unitId);
        const java = path.join(this.project.dir, "javasource");
        const wordRe = new RegExp(`\\b${esc(oldName)}\\b`);
        const scan = d => {
            for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
                const f = path.join(d, e.name);
                if (e.isDirectory()) {
                    if (e.name !== "proxies") scan(f); // proxies are regenerated by Studio Pro
                } else if (e.name.endsWith(".java")) {
                    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
                        if (wordRe.test(line) || line.includes(oldQn)) hits.push(`${path.relative(this.project.dir, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
                    });
                }
            }
        };
        scan(java);
        return hits.map(h => `${oldQn}: ${h}`);
    }

    // Documents that refer to qn (or to something inside it) by name.
    referencesTo(qn) {
        const users = new Set();
        const hit = v => typeof v === "string" && (v === qn || v.startsWith(qn + "."));
        const walk = (obj, unitId) => {
            if (!obj || typeof obj !== "object" || Buffer.isBuffer(obj)) return;
            if (Array.isArray(obj)) return obj.forEach(x => walk(x, unitId));
            const info = obj.$Type && this.schema.info(this.schema.sdkType(obj.$Type));
            for (const [k, v] of Object.entries(obj)) {
                if (k[0] === "$") continue;
                const p = info && info.byKey.get(k);
                if (p && (p.kind === "byName" || p.kind === "byNameList")) {
                    if ([].concat(v).some(hit)) users.add(this.label(unitId));
                } else if (v && typeof v === "object") walk(v, unitId);
            }
        };
        for (const unitId of this.project.units.keys()) walk(this.project.read(unitId), unitId);
        users.delete(qn);
        return [...users].sort();
    }

    // Module/Folder/Sub for a module or folder unit id.
    folderPath(unitId) {
        const parts = [];
        for (let id = unitId; id; ) {
            const u = this.project.units.get(id);
            if (!u) break;
            const p = this.unitInfo(id);
            if (p.name) parts.unshift(p.name);
            if (/^Projects\$Module/.test(p.type)) break;
            id = u.containerId;
        }
        return parts.join("/");
    }

    // { type, name } of a unit as it is now: from the cache for units not changed in this run, without decoding.
    unitInfo(id) {
        const e = this.project.cache && this.project.cache.units.get(id);
        if (e && !this.changes.updated.has(id) && !this.project.plain.has(id)) return { type: e.type, name: e.name };
        const p = this.project.read(id);
        return { type: p.$Type, name: typeof p.Name === "string" ? p.Name : null };
    }

    // Module.Document for a unit id, for messages.
    label(unitId) {
        const names = [];
        let id = unitId;
        while (id) {
            const u = this.project.units.get(id);
            if (!u) break;
            const p = this.unitInfo(id);
            if (p.type === "Projects$Folder") {
                id = u.containerId;
                continue;
            }
            if (p.name) names.unshift(p.name);
            else if (p.type === "DomainModels$DomainModel") names.unshift("(domain model)");
            else if (p.type === "Navigation$NavigationDocument") names.unshift("Navigation (menu item / home page)");
            if (/^Projects\$Module/.test(p.type)) break;
            id = u.containerId;
        }
        return names.join(".") || unitId;
    }

    findStructure(id) {
        if (this.model._units[id]) return this.model._units[id];
        for (const u of this.model.allUnits()) {
            if (!u.isLoaded || !u.findElementById) continue;
            const e = u.findElementById(id);
            if (e) return e;
        }
        return null;
    }

    // The Model SDK cannot move a unit to another folder; Studio Pro only changes the unit's container row.
    moveUnit(unitId, containerId, containmentName = "Documents") {
        const u = this.project.units.get(unitId);
        if (!u) throw new Error(`Unit ${unitId} not found`);
        u.containerId = containerId;
        u.containmentName = containmentName;
        const created = this.changes.created.get(unitId);
        if (created) Object.assign(created, { containerId, containmentName });
        else this.changes.moved.set(unitId, { containerId, containmentName });
    }

    summary() {
        const name = id => {
            const p = this.project.plain.get(id);
            return `${p ? p.$Type : "?"} ${p && p.Name ? p.Name : ""} (${id})`;
        };
        return {
            created: [...this.changes.created.keys()].map(name),
            updated: [...this.changes.updated].filter(id => !this.changes.created.has(id)).map(name),
            deleted: [...this.changes.deleted].map(name),
            moved: [...this.changes.moved].map(([id, m]) => `${this.label(id)} -> ${this.folderPath(m.containerId)}`),
            renames: this.renames || [],
            leftovers: this.leftovers || [],
            warnings: [...this.warnings]
        };
    }

    encode() {
        if (this.detached.size) throw new Error(`${this.detached.size} element(s) were detached and never re-attached`);
        const enc = this.project.encode(this.changes, hinter(this.catalog, this.schema, this.warn));
        // files outside the model that belong to the change (Java/JavaScript action sources): { rel, bytes, before }
        if (this.extraFiles && this.extraFiles.size) enc.extra = [...this.extraFiles].map(([rel, f]) => ({ rel, bytes: f.content, before: f.before }));
        return enc;
    }

    save() {
        return this.project.writeEncoded(this.encode());
    }

    // Unhandled IModelServerClient calls: offline there is no Team Server, locking or file API.
    unsupported(name) {
        return (...args) => {
            const err = args.reverse().find(a => typeof a === "function");
            const e = new Error(`${name} is not available offline`);
            if (err) err(e);
            else throw e;
        };
    }
}

for (const name of [
    "createWorkingCopy", "createWorkingCopyFromTeamServer", "deleteWorkingCopy", "grantAccess", "setWorkingCopyMembers", "revokeAccess",
    "checkAccess", "grantAccessByProject", "revokeAccessByProject", "setProjectMembers", "exportMpk", "exportModuleMpk", "importModuleMpk",
    "filterUnitsByCustomWidgetId", "getFiles", "getFile", "putFile", "deleteFile", "getMyWorkingCopies", "getWorkingCopyByProject",
    "updateWorkingCopyByProject", "deleteWorkingCopyByProject", "lockWorkingCopy", "unlockWorkingCopy", "commitToTeamServer"
]) {
    LocalClient.prototype[name] = function (...args) {
        return this.unsupported(name)(...args);
    };
}

module.exports = { LocalClient, loadProject };
