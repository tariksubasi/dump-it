"use strict";
// SDK metamodel introspection + SDK-name <-> BSON storage-name mapping.
// storage-names.json holds only the names that differ from the default rule
// (type name identical, property key = PascalCase(sdkName)); it is derived from mxcli's generated metamodel.
const { Model } = require("mendixmodelsdk");
const props = require("mendixmodelsdk/src/sdk/internal/properties");
const overrides = require("./storage-names.json");

const PROBE_ROOT = "00000000-0000-0000-0000-000000000001";
const PROBE_ID = "00000000-0000-0000-0000-000000000002";
const up = s => s[0].toUpperCase() + s.slice(1);

function kindOf(p) {
    if (p instanceof props.StructuralChildListProperty) return "structList";
    if (p instanceof props.StructuralChildProperty) return "struct";
    if (p instanceof props.PartListProperty) return "partList";
    if (p instanceof props.PartProperty) return "part";
    if (p instanceof props.ByIdReferenceProperty) return "byId";
    if (p instanceof props.ByNameReferenceListProperty) return "byNameList";
    if (p instanceof props.ByNameReferenceProperty) return "byName";
    if (p instanceof props.LocalByNameReferenceProperty) return "localByName";
    if (p instanceof props.EnumListProperty) return "enumList";
    if (p instanceof props.EnumProperty) return "enum";
    if (p instanceof props.PrimitiveListProperty) return "primList";
    if (p instanceof props.PrimitiveProperty) return "prim";
    throw new Error("Unknown SDK property class " + p.constructor.name);
}

async function openProbe(metaModelVersion) {
    const client = {
        loadWorkingCopyMetaData: (id, cb) =>
            cb({ id, metaData: { metaModelVersion }, mprMetaData: { _ProductVersion: metaModelVersion }, members: [], mprFileName: "" }),
        loadUnitInterfaces: (id, cb) =>
            cb({ units: [{ $ID: PROBE_ROOT, $Type: "Projects$Project", containerId: null, containmentName: "", contents: {} }], eventId: 0 }),
        getWorkingCopyEventSource: () => ({ addEventListener() {}, close() {} })
    };
    return Model.createSdkClient({ client }).openWorkingCopy("probe");
}

class Schema {
    constructor(probe) {
        this.probe = probe;
        this.classes = probe._allModelClasses();
        this.cache = new Map();
        this.sdkToStorage = {};
        this.storageToSdk = {};
        for (const [sdkType, o] of Object.entries(overrides)) {
            if (o.$) {
                this.sdkToStorage[sdkType] = o.$;
                this.storageToSdk[o.$] = sdkType;
            }
        }
    }

    static async create(metaModelVersion) {
        return new Schema(await openProbe(metaModelVersion));
    }

    storageType(sdkType) {
        return this.sdkToStorage[sdkType] || sdkType;
    }

    // null when this storage type has no SDK counterpart
    sdkType(storageType) {
        const t = this.storageToSdk[storageType];
        return t === undefined ? storageType : t;
    }

    cls(sdkType) {
        if (!sdkType) return undefined;
        const i = sdkType.indexOf("$");
        const ns = this.classes[sdkType.slice(0, i).toLowerCase()];
        return ns && ns[sdkType.slice(i + 1)];
    }

    isSubtype(sdkType, baseType) {
        const a = this.cls(sdkType), b = this.cls(baseType);
        return !!a && !!b && (a === b || b.isPrototypeOf(a));
    }

    // Fit the mapping to what this project's BSON actually contains (catalog = every key seen per storage type).
    // Mendix writes every property of an element, so a type's key set in the catalog is complete for this version.
    calibrate(catalog) {
        // Storage namespaces map onto SDK namespaces (Forms -> Pages, ...); collect SDK types per namespace.
        const nsMap = new Map();
        const typesByNs = new Map();
        for (const ns of Object.values(this.classes)) {
            for (const cls of Object.values(ns)) {
                if (typeof cls !== "function" || !cls.structureTypeName || !this.info(cls.structureTypeName)) continue;
                const t = cls.structureTypeName;
                const sdkNs = t.split("$")[0];
                if (!typesByNs.has(sdkNs)) typesByNs.set(sdkNs, []);
                typesByNs.get(sdkNs).push(t);
                const stNs = this.storageType(t).split("$")[0];
                if (!nsMap.has(stNs)) nsMap.set(stNs, new Set());
                nsMap.get(stNs).add(sdkNs);
            }
        }
        const fitOf = (st, t) => {
            const keys = catalog.keys(st).filter(k => k[0] !== "$");
            const info = this.info(t);
            const free = keys.filter(k => !info.byKey.has(k));
            const freeProps = [...info.byName.values()].filter(p => !keys.includes(p.key) && p.kind !== "struct" && p.kind !== "structList");
            const pairs = pairUp(free, freeProps, k => catalog.get(st, k).k);
            const hit = keys.length - free.length;
            return { fit: keys.length ? (hit + 0.9 * pairs.length) / keys.length : 1, hit, pairs };
        };
        const options = [];
        for (const st of catalog.types.keys()) {
            const [stNs, short] = st.split("$");
            const nss = new Set([stNs, ...(nsMap.get(stNs) || [])]);
            for (const ns of nss) {
                for (const t of typesByNs.get(ns) || []) {
                    const tShort = t.split("$")[1];
                    const claimed = this.storageType(t) === st;
                    const related = claimed || tShort === short || tShort.startsWith(short);
                    const { fit, hit } = fitOf(st, t);
                    if (related ? fit < 0.5 : fit < 0.9 || hit < 2) continue;
                    options.push({ st, t, score: fit + (claimed || tShort === short ? 0.2 : 0) + (claimed ? 0.02 : 0) + (related ? 0.01 : 0) });
                }
            }
        }
        options.sort((a, b) => b.score - a.score);
        const takenSt = new Set(), takenT = new Set();
        this.pairs = [];
        for (const { st, t } of options) {
            if (takenSt.has(st) || takenT.has(t)) continue;
            takenSt.add(st);
            takenT.add(t);
            if (this.storageType(t) !== st) this.pairs.push(`${st} = ${t}`);
            this.storageToSdk[st] = t;
            this.sdkToStorage[t] = st;
        }
        for (const st of catalog.types.keys()) {
            if (!takenSt.has(st)) {
                this.storageToSdk[st] = null;
                continue;
            }
            const t = this.storageToSdk[st];
            const info = this.info(t);
            for (const [key, p] of fitOf(st, t).pairs) {
                info.byKey.delete(p.key);
                p.key = key;
                info.byKey.set(key, p);
                this.pairs.push(`${st}.${key} = ${t}.${p.name}`);
            }
        }
    }

    // { byName: Map<sdkName, info>, byKey: Map<storageKey, info> } for an SDK type, or null if unknown.
    info(sdkType) {
        if (!sdkType) return null;
        if (this.cache.has(sdkType)) return this.cache.get(sdkType);
        const cls = this.cls(sdkType);
        let result = null;
        let inst = null;
        if (cls && cls.structureTypeName === sdkType) {
            try {
                inst = new cls(this.probe, sdkType, PROBE_ID, false, null, null);
            } catch (e) {
                inst = null; // type not available in this Mendix version
            }
        }
        if (inst) {
            const names = (overrides[sdkType] && overrides[sdkType].p) || {};
            const byName = new Map(), byKey = new Map();
            for (const p of inst.allProperties()) {
                if (!p.isAvailable) continue;
                const entry = {
                    name: p.name,
                    key: names[p.name] || up(p.name),
                    kind: kindOf(p),
                    prim: p.primitiveType !== undefined ? props.PrimitiveTypeEnum[p.primitiveType] : undefined,
                    target: p._targetType || p.targetType,
                    isPublic: p.isPublic
                };
                byName.set(entry.name, entry);
                byKey.set(entry.key, entry);
            }
            result = { byName, byKey, isUnit: !!inst.isLoadable || inst.unit === inst };
        }
        this.cache.set(sdkType, result);
        return result;
    }
}

// BSON kind -> compatibility class, SDK property -> classes it can be stored as.
const BSON_CLASS = { 0x02: "str", 0x08: "bool", 0x12: "int", 0x10: "int", 0x01: "dbl", 0x05: "bin", 0x03: "part", 0x04: "list", 0x09: "date", 0x0a: "null" };
function propClasses(p) {
    switch (p.kind) {
        case "part":
            return ["part", "null"];
        case "byId":
            return ["bin", "null"];
        case "partList":
        case "primList":
        case "enumList":
        case "byNameList":
            return ["list"];
        case "prim":
            return {
                Boolean: ["bool"],
                Integer: ["int"],
                Double: ["dbl", "int"],
                Guid: ["bin"],
                Blob: ["bin", "null"],
                DateTime: ["date", "str"]
            }[p.prim] || ["str"];
        default:
            return ["str"];
    }
}

// Mendix renamed Form to Page; storage keys kept the old word.
const words = s => s.replace(/^_+/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(" ").map(w => (w === "form" ? "page" : w));

// 0+ = extra words when one name's words contain the other's, 1.5 = one word swapped, null = unrelated.
function wordDistance(a, b) {
    const x = words(a), y = words(b);
    if (y.every(w => x.includes(w)) || x.every(w => y.includes(w))) return Math.abs(x.length - y.length);
    if (x.length === y.length && x.length > 1 && x.filter(w => !y.includes(w)).length === 1) return 1.5;
    return null;
}

// Pair unmatched BSON keys with unmatched SDK properties of a compatible kind. A key and a property pair when
// they are each other's only compatible option, or each other's unique closest match by words; repeated until
// stable. Ties stay unpaired: a wrong pair (e.g. admin vs runtime port) is worse than an invisible key.
function pairUp(keys, propsList, kindOfKey) {
    let options = [];
    for (const k of keys) {
        const cls = BSON_CLASS[kindOfKey(k)];
        for (const p of propsList) if (propClasses(p).includes(cls)) options.push({ k, p, d: wordDistance(k, p.name) });
    }
    const closest = (o, same) => {
        const rel = options.filter(x => same(x) && x.d !== null);
        const min = Math.min(...rel.map(x => x.d));
        return o.d === min && rel.filter(x => x.d === min).length === 1;
    };
    const result = [];
    for (;;) {
        const found = options.filter(o => {
            if (options.filter(x => x.k === o.k).length === 1 && options.filter(x => x.p === o.p).length === 1) return true;
            return o.d !== null && closest(o, x => x.k === o.k) && closest(o, x => x.p === o.p);
        });
        if (!found.length) return result;
        for (const o of found) result.push([o.k, o.p]);
        options = options.filter(x => !found.some(o => o.k === x.k || o.p === x.p));
    }
}

module.exports = { Schema };
