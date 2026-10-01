"use strict";
// IModelServerClient implementation that serves a local MPR v2 project to the Mendix Model SDK
// and applies the SDK's deltas to an in-memory copy of the project (written only on save()).
const path = require("path");
const { Model } = require("mendixmodelsdk");
const { Project } = require("./mpr");
const { Schema } = require("./schema");
const { Catalog, toSdk, fromSdk, valueToPlain, complete, hinter } = require("./convert");

const WC = "local";

async function loadProject(mprPath) {
    const project = new Project(mprPath);
    const catalog = new Catalog();
    for (const [id] of project.units) catalog.learn(project.read(id));
    const schema = await Schema.create(project.version);
    schema.calibrate(catalog);
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
        this.changes = { updated: new Set(), created: new Map(), deleted: new Set() };
        this.warnings = new Set();
        this.log = [];
        this.warn = w => this.warnings.add(w);
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
            for (const uid of this.project.units.keys()) {
                const j = this.unitJson(uid, true);
                if (j) units.push(j);
            }
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
            if (v === oldQn && (!p.target || this.schema.isSubtype(targetType, p.target))) return newQn;
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

    summary() {
        const name = id => {
            const p = this.project.plain.get(id);
            return `${p ? p.$Type : "?"} ${p && p.Name ? p.Name : ""} (${id})`;
        };
        return {
            created: [...this.changes.created.keys()].map(name),
            updated: [...this.changes.updated].filter(id => !this.changes.created.has(id)).map(name),
            deleted: [...this.changes.deleted].map(name),
            renames: this.renames || [],
            warnings: [...this.warnings]
        };
    }

    save() {
        if (this.detached.size) throw new Error(`${this.detached.size} element(s) were detached and never re-attached`);
        return this.project.write(this.changes, hinter(this.catalog, this.schema, this.warn));
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
