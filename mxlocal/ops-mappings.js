"use strict";
// JSON integration: JSON structures built from a snippet the way Studio Pro builds them (element names, paths,
// primitive types, occurrences), and import/export mappings from a structure onto entities (optionally creating the
// missing entities, attributes and associations). The steps that run them are in ops-flows.js. Layout and naming rules
// learned from Studio Pro-saved structures and mappings (Mendix 10.24-11.13) and from mxcli's measurements.
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, setIfAvailable } = require("./ops-util");

const { jsonstructures: js, importmappings: im, exportmappings: em, mappings: mp, domainmodels: dm, datatypes, microflows: mf, xmlschemas } = sdk;

const MAP_FIELDS = {
    module: "R module name of the mapping",
    name: "R mapping name, e.g. IMM_Order",
    jsonStructure: "R Module.JsonStructure",
    entity: "optional root entity Module.Entity (default <module>.<root element name>, e.g. Root)",
    entities: "optional { \"json/path\": \"Module.Entity\" } for nested objects and array items (default <module>.<element name>)",
    attributes: "optional { \"json/path/key\": \"AttributeName\" } (default the element name, e.g. orderId -> OrderId)",
    skip: "optional [ \"json/path\" ] values or objects to leave out",
    create: "optional true: create missing entities, attributes and associations (default false: map onto existing ones)",
    persistable: "optional true/false for created entities (default true)",
    folder: "optional folder path"
};

const MAPPING_OPS = {
    createJsonStructure: {
        doc: "Create a JSON structure from a JSON snippet: elements, names, paths and types as Studio Pro derives them.",
        fields: { module: "R module name", name: "R structure name, e.g. JSON_Order", snippet: "R JSON text (best as a string: keeps 1.0 a decimal), or a JSON object/array", folder: "optional folder path" }
    },
    createImportMapping: {
        doc: "Create an import mapping (JSON -> objects) from a JSON structure: one entity per JSON object, an attribute per value, associations from child to parent. Arrays become many child objects.",
        fields: { ...MAP_FIELDS, keys: "optional [ \"json/path/key\" ] values that identify their object: it is found by them, else created" }
    },
    createExportMapping: {
        doc: "Create an export mapping (objects -> JSON) from a JSON structure; the root entity is the parameter, nested objects are retrieved over associations.",
        fields: MAP_FIELDS
    }
};

// ---------------------------------------------------------------- snippet -> element tree

// JSON parser that keeps key order (also for "1": ...) and number text (1.0 is a decimal).
function parseJson(text) {
    let i = 0;
    const s = String(text);
    const err = what => {
        const line = s.slice(0, i).split("\n").length;
        throw new Error(`snippet is not valid JSON: ${what} at line ${line} (near '${s.slice(Math.max(0, i - 10), i + 10).replace(/\s+/g, " ")}')`);
    };
    const ws = () => {
        while (i < s.length && /\s/.test(s[i])) i++;
    };
    const str = () => {
        const m = /^"(?:[^"\\\u0000-\u001f]|\\.)*"/.exec(s.slice(i));
        if (!m) err("bad string");
        i += m[0].length;
        return JSON.parse(m[0]);
    };
    function value() {
        ws();
        const c = s[i];
        if (c === "{") {
            i++;
            const entries = [];
            ws();
            if (s[i] === "}") return i++, { t: "object", entries };
            for (;;) {
                ws();
                if (s[i] !== '"') err("expected a key in quotes");
                const k = str();
                ws();
                if (s[i++] !== ":") err("expected ':'");
                entries.push([k, value()]);
                ws();
                if (s[i] === ",") i++;
                else if (s[i] === "}") return i++, { t: "object", entries };
                else err("expected ',' or '}'");
            }
        }
        if (c === "[") {
            i++;
            const items = [];
            ws();
            if (s[i] === "]") return i++, { t: "array", items };
            for (;;) {
                items.push(value());
                ws();
                if (s[i] === ",") i++;
                else if (s[i] === "]") return i++, { t: "array", items };
                else err("expected ',' or ']'");
            }
        }
        if (c === '"') return { t: "string", v: str() };
        const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i));
        if (!m) err("unexpected character");
        i += m[0].length;
        if (m[0] === "true" || m[0] === "false") return { t: "boolean", v: m[0] };
        if (m[0] === "null") return { t: "null" };
        return { t: "number", raw: m[0] };
    }
    const v = value();
    ws();
    if (i < s.length) err("text after the end");
    return v;
}

// Names Studio Pro will not use as is: it puts _ before the key (id -> _id). Java keywords, system members.
const RESERVED = new Set(("id type object owner changeddate createddate changedby currentuser guid abstract assert boolean break byte case catch char " +
    "class const continue default do double else enum extends false final finally float for goto if implements import instanceof int " +
    "interface long native new null package private protected public return short static strictfp super switch synchronized this throw " +
    "throws transient true try void volatile while").split(" "));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function exposedName(key) {
    let k = String(key).replace(/[^A-Za-z0-9_]/g, "_");
    if (/^\d/.test(k)) k = "_" + k;
    if (!k) k = "_";
    const name = k[0].toUpperCase() + k.slice(1);
    return RESERVED.has(name.toLowerCase()) ? "_" + k : name;
}

// .NET-style date text with 7 fraction digits, as Studio Pro stores the sample value.
function dotnetDate(v) {
    const m = /^(.{19})(?:\.(\d+))?(.*)$/.exec(v);
    if (!m || m[1].length < 19) return v + ".0000000";
    return `${m[1]}.${((m[2] || "") + "0000000").slice(0, 7)}${m[3]}`;
}

const node = (kind, name, path, extra = {}) => ({ kind, name, path, prim: "Unknown", min: 0, max: 1, nillable: true, maxLength: -1, original: "", children: [], ...extra });

function valueNode(name, path, v) {
    if (v.t === "string") {
        const date = ISO_DATE.test(v.v);
        return node("Value", name, path, { prim: date ? "DateTime" : "String", maxLength: date ? -1 : 0, original: JSON.stringify(date ? dotnetDate(v.v) : v.v) });
    }
    if (v.t === "number") {
        const n = Number(v.raw);
        const int = /^-?\d+$/.test(v.raw) && Math.abs(n) <= 2 ** 53;
        return node("Value", name, path, { prim: int ? "Integer" : "Decimal", original: int ? String(BigInt(v.raw)) : String(n) });
    }
    if (v.t === "boolean") return node("Value", name, path, { prim: "Boolean", original: v.v });
    return node("Value", name, path); // null: type unknown, no sample
}

function objectNode(name, path, v) {
    const n = node("Object", name, path);
    const seen = new Map();
    for (const [key, child] of v.entries) {
        let nm = exposedName(key);
        seen.set(nm, (seen.get(nm) || 0) + 1);
        if (seen.get(nm) > 1) nm += "_" + seen.get(nm);
        n.children.push(anyNode(nm, `${path}|${key}`, child));
    }
    return n;
}

function arrayNode(name, path, v) {
    const n = node("Array", name, path);
    const first = v.items[0];
    if (!first) return n;
    if (first.t === "object") n.children.push({ ...objectNode(name + "Item", path + "|(Object)", first), max: -1 });
    else if (first.t === "array") throw new Error(`'${path.replace(/\(\w+\)\|?/g, "")}' is an array of arrays: Studio Pro cannot map that; wrap the inner arrays in objects`);
    else {
        // array of plain values: a wrapper per item (singular name) holding the value
        const w = node("Wrapper", name.length > 1 && name.endsWith("s") ? name.slice(0, -1) : name, path + "|(Wrapper)", { max: -1 });
        w.children.push(valueNode("Value", path + "|(Wrapper)|(Value)", first));
        n.children.push(w);
    }
    return n;
}

const anyNode = (name, path, v) => (v.t === "object" ? objectNode(name, path, v) : v.t === "array" ? arrayNode(name, path, v) : valueNode(name, path, v));

// The element tree Studio Pro builds from a snippet: root "Root" at (Object), or at (Array) with items "JsonObject".
function snippetTree(text) {
    const v = parseJson(text);
    if (v.t === "object") return { ...objectNode("Root", "(Object)", v), min: 1 };
    if (v.t !== "array") throw new Error("the snippet must be a JSON object { ... } or array [ ... ]");
    const root = { ...node("Array", "Root", "(Array)"), min: 1 };
    const first = v.items[0];
    if (first && first.t !== "object") throw new Error("a snippet that is an array of plain values cannot be mapped; use an array of objects, or an object around the array");
    if (first) root.children.push({ ...objectNode("JsonObject", "(Array)|(Object)", first), max: -1 });
    return root;
}

// The path a user writes: the JSON keys joined with / (array and item markers left out); "" for the root.
const userPath = p => p.split("|").filter(x => !/^\((Object|Array|Wrapper|Value)\)$/.test(x)).join("/");
const normPath = p => String(p).replace(/\[\]/g, "").replace(/^\$?\/?(Root\/|Root$)?/, "").replace(/\/+$/, "");

// ---------------------------------------------------------------- bound operations

function makeMappings(h) {
    const { model, get, exists, folder } = h;

    // A loaded structure (or a fresh one) as plain nodes.
    function plainTree(e) {
        return {
            kind: e.elementType.name, name: e.exposedName, path: e.path, prim: e.primitiveType.name, min: e.minOccurs, max: e.maxOccurs,
            nillable: e.nillable, maxLength: e.maxLength, fd: e.fractionDigits, td: e.totalDigits, children: [...e.children].map(plainTree)
        };
    }

    async function structure(qn) {
        const s = await get(qn);
        if (!(s instanceof js.JsonStructure)) throw new Error(`'${qn}' is not a JSON structure (create one with createJsonStructure)`);
        if (!s.elements.length) throw new Error(`${qn} has no elements: give it a snippet in Studio Pro, or create it with createJsonStructure`);
        return plainTree(s.elements[0]);
    }

    function writeElement(container, n, top) {
        const e = top ? js.JsonElement.createInJsonStructureUnderElements(container) : js.JsonElement.createInElementUnderChildren(container);
        e.elementType = mp.ElementType[n.kind];
        e.primitiveType = xmlschemas.XmlPrimitiveType[n.prim];
        e.path = n.path;
        e.exposedName = n.name;
        e.minOccurs = n.min;
        e.maxOccurs = n.max;
        e.nillable = n.nillable;
        e.maxLength = n.maxLength;
        e.fractionDigits = -1;
        e.totalDigits = -1;
        e.isDefaultType = false;
        e.originalValue = n.original;
        for (const c of n.children) writeElement(e, c, false);
        return e;
    }

    // ------------------------------------------------ mapping plan: which entity/attribute/association per element

    const PRIM_TYPE = { String: "String(unlimited)", Integer: "Long", Decimal: "Decimal", Boolean: "Boolean", DateTime: "DateTime", Unknown: "String(unlimited)" };
    // attribute kinds a JSON value of each primitive type can go into (import and export)
    const FITS = {
        Integer: ["Integer", "Long", "AutoNumber", "Decimal", "String"], Decimal: ["Decimal", "String"], Boolean: ["Boolean", "String"],
        DateTime: ["DateTime", "String"], String: ["String", "HashedString", "Enumeration", "Integer", "Long", "Decimal", "Boolean", "DateTime"]
    };
    const attrKind = a => a.type.structureTypeName.split("$")[1].replace("AttributeType", "");

    function planMapping(o, root, imp) {
        const mod = o.module;
        const where = `${imp ? "import" : "export"} mapping ${mod}.${o.name}`;
        const all = [];
        const walkAll = n => (all.push(n), n.children.forEach(walkAll));
        walkAll(root);
        const paths = [...new Set(all.map(n => userPath(n.path)).filter(Boolean))];
        const known = (p, field) => {
            const q = normPath(p);
            if (q !== "" && !paths.includes(q)) fail(`${where}: '${field}' names '${p}', which is not in the JSON structure (paths are keys joined with /, e.g. lines/sku)`, q, paths);
            return q;
        };
        const entities = new Map(Object.entries(o.entities || {}).map(([p, e]) => [known(p, "entities"), e]));
        const attributes = new Map(Object.entries(o.attributes || {}).map(([p, a]) => [known(p, "attributes"), a]));
        const skip = new Set([].concat(o.skip || []).map(p => known(p, "skip")));
        const keys = new Set([].concat(o.keys || []).map(p => known(p, "keys")));
        const used = new Map();
        const entityFor = (n, isRoot) => {
            const p = userPath(n.path);
            let qn = isRoot && o.entity ? o.entity : entities.get(p);
            if (!qn) {
                // default: the element name in the mapping's module, unique within this mapping
                let base = `${mod}.${n.name}`;
                used.set(base, (used.get(base) || 0) + 1);
                qn = used.get(base) > 1 ? `${base}_${used.get(base)}` : base;
            }
            if (!/^\w+\.\w+$/.test(qn)) throw new Error(`${where}: '${qn}' is not Module.Entity`);
            return qn;
        };
        const obj = (n, isRoot) => ({ schema: n, entity: entityFor(n, isRoot), children: [], key: false });
        function fill(target, n) {
            for (const c of n.children) {
                const p = userPath(c.path);
                if (skip.has(p)) continue;
                if (c.kind === "Value") {
                    const v = { schema: c, attribute: attributes.get(p) || c.name, key: keys.has(p) };
                    if (v.key) target.key = true;
                    target.children.push(v);
                } else if (c.kind === "Object") {
                    const child = obj(c, false);
                    fill(child, c);
                    target.children.push(child);
                } else if (c.kind === "Array") {
                    const item = c.children[0];
                    if (!item) continue; // empty array in the snippet: nothing to map
                    const child = obj(item, false);
                    fill(child, item);
                    // import: the item sits right under its parent; export: inside a container for the array
                    target.children.push(imp ? child : { schema: c, entity: null, children: [child] });
                }
            }
            return target;
        }
        if (root.kind === "Array") {
            if (!imp) throw new Error(`${where}: the root of ${o.jsonStructure} is an array; export mappings over a root array are not supported here (do it in Studio Pro, or use an object around the array)`);
            if (!root.children[0]) throw new Error(`${where}: ${o.jsonStructure} is an empty array; give the snippet one item`);
            return { where, top: fill(obj(root.children[0], true), root.children[0]) };
        }
        return { where, top: fill(obj(root, true), root) };
    }

    // Entities, attributes and associations the plan needs: found by name, else created (create: true), else an error.
    async function resolve(plan, o, imp) {
        const create = bool(o.create, false);
        const impl = h.impl();
        const created = [];
        const hint = `; add "create": true to create it, or name an existing one with "entities"/"attributes"`;
        const objects = [];
        const walk = (n, parent) => {
            if (n.entity !== undefined && n.entity !== null) objects.push({ n, parent });
            for (const c of n.children || []) if (c.children) walk(c, n.entity ? n : parent);
        };
        walk(plan.top, null);
        for (const { n } of objects) {
            if (model.findEntityByQualifiedName(n.entity)) continue;
            const [m, name] = n.entity.split(".");
            if (!create) fail(`${plan.where}: no entity ${n.entity} (for JSON '${userPath(n.schema.path) || "root"}')${hint}`, n.entity, model.allDomainModels().flatMap(d => d.entities.map(e => `${d.containerAsModule.name}.${e.name}`)));
            validName(name, "entity name");
            await impl.createEntity({ module: m, name, persistable: o.persistable });
            created.push(n.entity);
        }
        for (const { n, parent } of objects) {
            n.entityObj = await h.entity(n.entity);
            await h.loadParents(n.entityObj);
            for (const v of n.children.filter(c => !c.children)) {
                const chain = h.attributeChain(n.entityObj);
                let a = chain.attributes.find(x => x.name === v.attribute) || chain.attributes.find(x => x.name.toLowerCase() === v.attribute.toLowerCase());
                if (!a) {
                    if (!create) fail(`${plan.where}: ${n.entity} has no attribute '${v.attribute}' (for JSON '${userPath(v.schema.path)}')${hint}, or "skip" it`, v.attribute, chain.attributes.map(x => x.name));
                    validName(v.attribute, "attribute name");
                    await impl.addAttribute({ entity: n.entity, name: v.attribute, type: PRIM_TYPE[v.schema.prim] || "String(unlimited)" }, n.entityObj);
                    a = n.entityObj.attributes.find(x => x.name === v.attribute);
                    created.push(`${n.entity}.${v.attribute}`);
                }
                const kind = attrKind(a);
                if (kind === "Binary") throw new Error(`${plan.where}: ${n.entity}.${a.name} is Binary; binary attributes cannot be mapped (skip '${userPath(v.schema.path)}')`);
                const fits = FITS[v.schema.prim];
                if (fits && !fits.includes(kind)) throw new Error(`${plan.where}: JSON '${userPath(v.schema.path)}' is ${v.schema.prim}, but ${n.entity}.${a.name} is ${kind}; map it to another attribute ("attributes") or "skip" it`);
                v.attributeObj = a;
            }
            if (!parent) continue;
            n.assocObj = associationBetween(n.entityObj, parent.entityObj);
            if (!n.assocObj) {
                const name = `${n.entityObj.name}_${parent.entityObj.name}`;
                if (!create) throw new Error(`${plan.where}: no association between ${n.entity} and ${parent.entity} (for JSON '${userPath(n.schema.path)}')${hint.replace(" or name an existing one with \"entities\"/\"attributes\"", ` or add it first: { "op": "addAssociation", "from": "${n.entity}", "to": "${parent.entity}" }`)}`);
                await impl.addAssociation({ from: n.entity, to: parent.entity, name });
                n.assocObj = associationBetween(n.entityObj, parent.entityObj);
                created.push(`${n.entity.split(".")[0]}.${name}`);
            }
        }
        return created;
    }

    // An association between two entities (either direction); prefers Child_Parent.
    function associationBetween(child, parent) {
        const list = [];
        for (const d of new Set([child.containerAsDomainModel, parent.containerAsDomainModel])) {
            for (const a of [...d.associations, ...d.crossAssociations]) {
                const p = a.parent, c = a.child;
                if ((p === child && c === parent) || (p === parent && c === child)) list.push(a);
            }
        }
        return list.find(a => a.name === `${child.name}_${parent.name}`) || list[0] || null;
    }

    function valueType(a) {
        const t = a.type;
        if (t instanceof dm.EnumerationAttributeType) {
            const e = datatypes.EnumerationType.create(model);
            e.enumeration = t.enumeration;
            return e;
        }
        const kind = attrKind(a);
        const T = { Integer: datatypes.IntegerType, Long: datatypes.IntegerType, AutoNumber: datatypes.IntegerType, Decimal: datatypes.DecimalType, Boolean: datatypes.BooleanType, DateTime: datatypes.DateTimeType }[kind] || datatypes.StringType;
        return T.create(model);
    }

    function writeMapping(doc, plan, imp) {
        const OBJ = imp ? im.ImportObjectMappingElement : em.ExportObjectMappingElement;
        const VAL = imp ? im.ImportValueMappingElement : em.ExportValueMappingElement;
        const common = (el, s) => {
            el.exposedName = s.name;
            el.jsonPath = s.path;
            el.xmlPath = "";
            el.minOccurs = s.min;
            el.maxOccurs = s.max;
            el.nillable = s.nillable;
            el.elementType = mp.ElementType[s.kind];
            el.documentation = "";
        };
        const write = (container, n, isRoot) => {
            if (!n.children) {
                const v = VAL.createIn(container);
                common(v, n.schema);
                v.attribute = n.attributeObj;
                v.type = valueType(n.attributeObj);
                v.xmlPrimitiveType = xmlschemas.XmlPrimitiveType[n.schema.prim === "Unknown" ? "String" : n.schema.prim];
                v.maxLength = n.schema.maxLength;
                v.fractionDigits = -1;
                v.totalDigits = -1;
                v.isKey = !!n.key;
                setIfAvailable(v, "originalValue", "");
                return;
            }
            const el = isRoot ? OBJ.createInMappingDocumentUnderRootMappingElements(container) : OBJ.createInObjectMappingElementUnderChildren(container);
            common(el, n.schema);
            el.isDefaultType = false;
            if (n.entityObj) el.entity = n.entityObj;
            if (n.assocObj) el.association = n.assocObj;
            if (imp) {
                el.objectHandling = n.key ? mp.ObjectHandlingEnum.Find : mp.ObjectHandlingEnum.Create;
                el.objectHandlingBackup = mp.ObjectHandlingBackupEnum.Create;
            } else {
                el.objectHandling = isRoot ? mp.ObjectHandlingEnum.Parameter : mp.ObjectHandlingEnum.Find;
                el.objectHandlingBackup = mp.ObjectHandlingBackupEnum.Error;
            }
            for (const c of n.children) write(el, c, false);
        };
        write(doc, plan.top, true);
    }

    async function createMapping(o, imp) {
        validName(o.name, "mapping name");
        const qn = `${o.module}.${o.name}`;
        if (await exists(qn)) throw new Error(`${qn} already exists`);
        const s = await get(o.jsonStructure).catch(e => fail(`'${o.jsonStructure}' not found: name a JSON structure (create one with createJsonStructure)`, o.jsonStructure, model.allJsonStructures().map(x => x.qualifiedName)));
        if (!(s instanceof js.JsonStructure)) fail(`'${o.jsonStructure}' is not a JSON structure`, o.jsonStructure, model.allJsonStructures().map(x => x.qualifiedName));
        const plan = planMapping(o, await structure(o.jsonStructure), imp);
        const created = await resolve(plan, o, imp);
        const doc = (imp ? im.ImportMapping : em.ExportMapping).createIn(folder(o.module, o.folder));
        doc.name = o.name;
        doc.jsonStructure = s;
        if (imp) doc.parameterType = datatypes.UnknownType.create(model);
        else doc.nullValueOption = mf.NullValueOption.LeaveOutElement;
        writeMapping(doc, plan, imp);
        let values = 0, objects = 0;
        const count = n => (n.children ? (n.entityObj && objects++, n.children.forEach(count)) : values++);
        count(plan.top);
        return `${qn}: ${plan.top.entity} (${objects} object(s), ${values} value(s))` + (created.length ? `\n      created: ${created.join(", ")}` : "");
    }

    const impl = {
        async createJsonStructure(o) {
            validName(o.name, "JSON structure name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const text = typeof o.snippet === "string" ? o.snippet : JSON.stringify(o.snippet, null, 4);
            const tree = snippetTree(text);
            const s = js.JsonStructure.createIn(folder(o.module, o.folder));
            s.name = o.name;
            s.jsonSnippet = text.replace(/\r?\n/g, "\r\n");
            writeElement(s, tree, true);
            let n = 0;
            const count = x => (n++, x.children.forEach(count));
            count(tree);
            return `${qn} (${n} elements)`;
        },
        createImportMapping: o => createMapping(o, true),
        createExportMapping: o => createMapping(o, false)
    };

    // ------------------------------------------------ checks (after apply, on a reloaded model)

    async function mappingProblems(o, imp) {
        const qn = `${o.module}.${o.name}`;
        const doc = await get(qn);
        const want = imp ? im.ImportMapping : em.ExportMapping;
        if (!(doc instanceof want)) return [`${qn} is not an ${imp ? "import" : "export"} mapping`];
        const r = [];
        if (doc.jsonStructureQualifiedName !== o.jsonStructure) r.push(`${qn} uses structure ${doc.jsonStructureQualifiedName}`);
        if (!doc.rootMappingElements.length) r.push(`${qn} has no elements`);
        const walk = el => {
            if (el instanceof mp.ObjectMappingElement) {
                if (el.entityQualifiedName && !model.findEntityByQualifiedName(el.entityQualifiedName)) r.push(`${el.jsonPath}: entity ${el.entityQualifiedName} missing`);
                if (!el.entityQualifiedName && el.elementType.name !== "Array") r.push(`${el.jsonPath} has no entity`);
                el.children.forEach(walk);
            } else if (!el.attributeQualifiedName) r.push(`${el.jsonPath} has no attribute`);
        };
        doc.rootMappingElements.forEach(walk);
        return r;
    }

    const checks = {
        async createJsonStructure(o) {
            const s = await get(`${o.module}.${o.name}`);
            const text = typeof o.snippet === "string" ? o.snippet : JSON.stringify(o.snippet, null, 4);
            let want = 0, have = 0;
            const count = x => (want++, x.children.forEach(count));
            count(snippetTree(text));
            const countHave = x => (have++, [...x.children].forEach(countHave));
            s.elements.forEach(countHave);
            return have === want ? [] : [`${o.module}.${o.name} has ${have} elements, expected ${want}`];
        },
        createImportMapping: o => mappingProblems(o, true),
        createExportMapping: o => mappingProblems(o, false)
    };

    return { impl, checks };
}

module.exports = { makeMappings, MAPPING_OPS, snippetTree, parseJson, userPath };
