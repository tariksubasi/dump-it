"use strict";
// JSON integration: JSON structures built from a snippet the way Studio Pro builds them (element names, paths,
// primitive types, occurrences), and import/export mappings from a structure onto entities (optionally creating the
// missing entities, attributes and associations). The steps that run them are in ops-flows.js. Layout and naming rules
// learned from Studio Pro-saved structures and mappings (Mendix 10.24-11.13) and from mxcli's measurements.
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, setIfAvailable, suggest } = require("./ops-util");

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
    createAttributes: "optional true: create missing attributes only (entities and associations must exist)",
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
        fields: { ...MAP_FIELDS, keys: "optional [ \"json/path/key\" ] values that identify their object: it is found by them, else created",
            parameter: "optional mapping parameter: Module.Entity or String | Integer | Long | Decimal | Boolean | DateTime (importWithMapping passes it with \"parameter\")" }
    },
    createExportMapping: {
        doc: "Create an export mapping (objects -> JSON) from a JSON structure; the root entity is the parameter, nested objects are retrieved over associations.",
        fields: MAP_FIELDS
    },
    changeJsonStructure: {
        doc: "Give a JSON structure a new snippet: its elements are rebuilt in the same document (mappings keep pointing to it). The dry run lists added, removed and retyped paths and the mappings to update with updateImportMapping / updateExportMapping.",
        fields: { structure: "R Module.JsonStructure", snippet: "R the new JSON text (best as a string), or a JSON object/array" }
    },
    updateImportMapping: { doc: "Bring an import mapping in step with its changed JSON structure, XML schema or message definition: new values map to attributes of the same name, new objects to entities; mapped paths that are gone are refused unless prune: true.", fields: {} },
    updateExportMapping: { doc: "Bring an export mapping in step with its changed JSON structure, XML schema or message definition (like updateImportMapping, no keys).", fields: {} },
    changeMapping: {
        doc: "Change one element of an import/export mapping (key attributes, how the object is found or created, if no object is found, a custom microflow, a value transform microflow, the attribute, the association) or the import mapping's parameter.",
        fields: {
            mapping: "R Module.ImportMapping or Module.ExportMapping",
            element: "path of the element, as in createImportMapping (\"\" = the root); needed for every field but parameter",
            keys: "import object: [ \"value path or name\" ] values that identify the object ([] = none); sets objectHandling find when it was create",
            objectHandling: "import object: create | find | findOrCreate | custom | parameter (parameter: the root, when the mapping parameter is its entity)",
            ifNotFound: "import object with find: create | ignore | error (default with find: error)",
            microflow: "with objectHandling custom: Module.Microflow that returns the object; its parameters: a value of this object by name, or an object of a parent element's entity",
            transform: "value: Module.Microflow that converts the value (one parameter; import: returns the attribute type; export: takes it), \"\" removes it",
            attribute: "value: another attribute of the object's entity",
            association: "object (not the root): Module.Association between its entity and the parent's",
            parameter: "import mapping: Module.Entity | String | Integer | Long | Decimal | Boolean | DateTime | none (the mapping parameter)"
        }
    }
};
const UPDATE_FIELDS = {
    mapping: "R the mapping, Module.Name",
    entities: "optional { \"path\": \"Module.Entity\" } for new objects (default <module>.<element name>)",
    attributes: "optional { \"path\": \"Attr\" } for new values (default the element name, matched case-insensitively)",
    skip: "optional [ \"path\" ] new paths to leave out; a path that is mapped now is removed from the mapping",
    createAttributes: "optional true: create missing attributes for new values",
    create: "optional true: also create missing entities and associations for new objects",
    persistable: "optional true/false for created entities",
    prune: "optional true: remove mapped paths that are no longer in the structure (entities and attributes stay); default: refused"
};
MAPPING_OPS.updateImportMapping.fields = { ...UPDATE_FIELDS, mapping: "R Module.ImportMapping", keys: "optional [ \"path\" ] values that identify their object (sets find)" };
MAPPING_OPS.updateExportMapping.fields = { ...UPDATE_FIELDS, mapping: "R Module.ExportMapping" };

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
const normPath = p => String(p).replace(/\[\]/g, "").replace(/^\(root\)$/i, "").replace(/^\$?\/?(Root\/|Root$)?/, "").replace(/\/+$/, "");

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

    // Attribute by name: exact, then ignoring case, then ignoring case and _ (order_id -> OrderId)
    const lc = x => String(x).toLowerCase();
    const loose = x => lc(x).replace(/[^a-z0-9]/g, "");
    const findAttribute = (list, name) => list.find(x => x.name === name) || list.find(x => lc(x.name) === lc(name)) || list.find(x => loose(x.name) === loose(name)) || null;
    // Entity by qualified name, else the one that differs only in case
    function findEntity(qn) {
        const e = model.findEntityByQualifiedName(qn);
        if (e) return e;
        for (const d of model.allDomainModels()) for (const x of d.entities) if (lc(`${d.containerAsModule.name}.${x.name}`) === lc(qn)) return x;
        return null;
    }
    const entityNames = () => model.allDomainModels().flatMap(d => d.entities.map(e => `${d.containerAsModule.name}.${e.name}`));

    // Entities, attributes and associations the plan needs: found by name, else created (create: true), else an error.
    // plan.matched lists names found another way than exactly (case, _).
    async function resolve(plan, o, imp) {
        const create = bool(o.create, false);
        const createAttrs = create || bool(o.createAttributes, false);
        const impl = h.impl();
        const created = [];
        plan.matched = [];
        const hint = `; add "create": true to create it, or name an existing one with "entities"/"attributes"`;
        const objects = [];
        const walk = (n, parent) => {
            if (n.entity !== undefined && n.entity !== null) objects.push({ n, parent });
            for (const c of n.children || []) if (c.children) walk(c, n.entity ? n : parent);
        };
        walk(plan.top, null);
        for (const { n } of objects) {
            const found = findEntity(n.entity);
            if (found) {
                const fq = `${found.containerAsDomainModel.containerAsModule.name}.${found.name}`;
                if (fq !== n.entity) plan.matched.push(`${userPath(n.schema.path) || "(root)"} -> ${fq}`);
                n.entity = fq;
                continue;
            }
            const [m, name] = n.entity.split(".");
            const field = n === plan.top ? `"entity"` : `"entities": { "${userPath(n.schema.path)}": "Module.Entity" }`;
            if (!create) fail(`${plan.where}: no entity ${n.entity} (for JSON '${userPath(n.schema.path) || "(root)"}'); add "create": true to create it, or name an existing one with ${field}`, n.entity, entityNames());
            validName(name, "entity name");
            await impl.createEntity({ module: m, name, persistable: o.persistable });
            created.push(n.entity);
        }
        for (const { n, parent } of objects) {
            n.entityObj = await h.entity(n.entity);
            await h.loadParents(n.entityObj);
            for (const v of n.children.filter(c => !c.children)) {
                const chain = h.attributeChain(n.entityObj);
                let a = findAttribute(chain.attributes, v.attribute);
                if (a && a.name !== v.attribute) plan.matched.push(`${userPath(v.schema.path)} -> ${n.entity}.${a.name}`);
                if (!a) {
                    if (!createAttrs) fail(`${plan.where}: ${n.entity} has no attribute '${v.attribute}' (for JSON '${userPath(v.schema.path)}'); add "createAttributes": true to create it, name an existing one with "attributes", or "skip" it`, v.attribute, chain.attributes.map(x => x.name));
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
                if (!create) throw new Error(`${plan.where}: no association between ${n.entity} and ${parent.entity} (for JSON '${userPath(n.schema.path)}'); add "create": true to create it, or add it first: { "op": "addAssociation", "from": "${n.entity}", "to": "${parent.entity}" }`);
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

    // One plan node (and its children) as mapping elements in container; returns the new element. rootCreate: makes
    // the root element somewhere else than a mapping document (a consumed REST operation's inline response or body)
    function writeNode(container, n, imp, isRoot, rootCreate = null) {
        const OBJ = imp ? im.ImportObjectMappingElement : em.ExportObjectMappingElement;
        const VAL = imp ? im.ImportValueMappingElement : em.ExportValueMappingElement;
        const common = (el, s) => {
            el.exposedName = s.name;
            el.jsonPath = s.jsonPath !== undefined ? s.jsonPath : s.path; // XML schemas and message definitions: own paths
            el.xmlPath = s.xmlPath || "";
            el.minOccurs = s.min;
            el.maxOccurs = s.max;
            el.nillable = s.nillable;
            el.elementType = mp.ElementType[s.kind];
            el.documentation = "";
        };
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
            return v;
        }
        const el = isRoot ? (rootCreate ? rootCreate(OBJ) : OBJ.createInMappingDocumentUnderRootMappingElements(container)) : OBJ.createInObjectMappingElementUnderChildren(container);
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
        for (const c of n.children) writeNode(el, c, imp, false);
        return el;
    }

    function writeMapping(doc, plan, imp, rootCreate = null) {
        writeNode(doc, plan.top, imp, true, rootCreate);
    }

    // The mapping parameter type from "Module.Entity", a primitive name, or "none".
    const PARAM_TYPES = { string: datatypes.StringType, integer: datatypes.IntegerType, long: datatypes.IntegerType, decimal: datatypes.DecimalType, boolean: datatypes.BooleanType, datetime: datatypes.DateTimeType };
    async function parameterType(spec, where) {
        const s = String(spec).trim();
        if (!s || /^none$/i.test(s)) return datatypes.UnknownType.create(model);
        if (PARAM_TYPES[s.toLowerCase()]) return PARAM_TYPES[s.toLowerCase()].create(model);
        if (!/^\w+\.\w+$/.test(s)) fail(`${where}: parameter '${s}' is not Module.Entity, String, Integer, Long, Decimal, Boolean, DateTime or none`, s, ["String", "Integer", "Long", "Decimal", "Boolean", "DateTime", "none"]);
        const e = findEntity(s);
        if (!e) fail(`${where}: no entity ${s} for the parameter`, s, entityNames());
        const t = datatypes.ObjectType.create(model);
        t.entity = e;
        return t;
    }
    const describeParam = t => (!t || t instanceof datatypes.UnknownType || t instanceof datatypes.VoidType ? "none" : t instanceof datatypes.ObjectType ? t.entityQualifiedName : t.structureTypeName.split("$")[1].replace("Type", ""));

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
        if (imp) doc.parameterType = o.parameter === undefined ? datatypes.UnknownType.create(model) : await parameterType(o.parameter, qn);
        else doc.nullValueOption = mf.NullValueOption.LeaveOutElement;
        writeMapping(doc, plan, imp);
        let values = 0, objects = 0;
        const count = n => (n.children ? (n.entityObj && objects++, n.children.forEach(count)) : values++);
        count(plan.top);
        return `${qn}: ${plan.top.entity} (${objects} object(s), ${values} value(s))` + (imp && o.parameter !== undefined ? `, parameter ${describeParam(doc.parameterType)}` : "") +
            (plan.matched.length ? `\n      matched: ${plan.matched.join(", ")}` : "") + (created.length ? `\n      created: ${created.join(", ")}` : "");
    }

    // ------------------------------------------------ change: structures and mappings

    // Path of a tree node / mapping element as the mapping stores it (JSON: jsonPath; XML schema: xmlPath)
    const nodeKey = n => (n.jsonPath !== undefined && n.jsonPath !== "" ? n.jsonPath : n.xmlPath || n.path);
    const elKey = el => el.jsonPath || el.xmlPath;
    const isObjEl = el => el instanceof mp.ObjectMappingElement;
    const shownEl = el => `${userPath(elKey(el)) || "(root)"} -> ${isObjEl(el) ? el.entityQualifiedName || "(array)" : el.attributeQualifiedName || "?"}`;

    async function mappingDocument(name, imp, where) {
        const list = imp === undefined ? [...model.allImportMappings(), ...model.allExportMappings()] : imp ? model.allImportMappings() : model.allExportMappings();
        const what = imp === undefined ? "mapping" : imp ? "import mapping" : "export mapping";
        const d = await get(name).catch(() => fail(`${where}: no ${what} ${name}`, name, list.map(x => x.qualifiedName)));
        const ok = imp === undefined ? d instanceof im.ImportMapping || d instanceof em.ExportMapping : d instanceof (imp ? im.ImportMapping : em.ExportMapping);
        if (!ok) fail(`${where}: ${name} is not an ${what}`, name, list.map(x => x.qualifiedName));
        return d;
    }

    // The element tree a mapping follows: its JSON structure, XML schema element or message definition.
    async function sourceOf(doc, where) {
        if (doc.jsonStructureQualifiedName) {
            const s = await get(doc.jsonStructureQualifiedName);
            if (!s.elements.length) throw new Error(`${where}: ${s.qualifiedName} has no elements`);
            return { name: s.qualifiedName, tree: plainTree(s.elements[0]) };
        }
        if (doc.xmlSchemaQualifiedName) {
            const x = await h.xml().source({ xmlSchema: doc.xmlSchemaQualifiedName, rootElement: doc.rootElementName || undefined }, where);
            return { name: `${doc.xmlSchemaQualifiedName} <${x.root}>`, tree: x.tree };
        }
        if (doc.messageDefinitionQualifiedName) {
            const x = await h.xml().source({ messageDefinition: doc.messageDefinitionQualifiedName }, where);
            return { name: doc.messageDefinitionQualifiedName, tree: x.tree };
        }
        throw new Error(`${where}: ${doc.qualifiedName} follows no JSON structure, XML schema or message definition (a web service mapping: update it in Studio Pro)`);
    }

    // Mappings (documents) that follow a structure/schema/definition, loaded.
    async function mappingsOf(test) {
        const out = [];
        for (const m of [...model.allImportMappings(), ...model.allExportMappings()]) {
            const d = await m.load();
            if (test(d)) out.push(d);
        }
        return out;
    }

    // Added / removed / retyped paths between two element trees (shown as user paths).
    function treeDiff(before, after) {
        const flat = t => {
            const m = new Map();
            const w = n => (m.set(nodeKey(n), n), n.children.forEach(w));
            if (t) w(t);
            return m;
        };
        const a = flat(before), b = flat(after);
        const show = n => userPath(n.path) || "(root)";
        const uniq = list => [...new Set(list)];
        return {
            added: uniq([...b].filter(([k]) => !a.has(k)).map(([, n]) => `${show(n)} (${n.kind === "Value" ? n.prim : n.kind})`)),
            removed: uniq([...a].filter(([k]) => !b.has(k)).map(([, n]) => show(n))),
            retyped: uniq([...b].filter(([k, n]) => a.has(k) && (a.get(k).kind !== n.kind || a.get(k).prim !== n.prim)).map(([k, n]) => `${show(n)}: ${a.get(k).kind === "Value" ? a.get(k).prim : a.get(k).kind} -> ${n.kind === "Value" ? n.prim : n.kind}`)),
            gone: new Set([...a.keys()].filter(k => !b.has(k) || a.get(k).kind !== b.get(k).kind))
        };
    }
    const listLine = (label, list) => (list.length ? `\n      ${label}: ${list.join(", ")}` : "");

    async function changeJsonStructure(o) {
        const where = `changeJsonStructure ${o.structure}`;
        const s = await get(o.structure).catch(() => fail(`${where}: no JSON structure ${o.structure}`, o.structure, model.allJsonStructures().map(x => x.qualifiedName)));
        if (!(s instanceof js.JsonStructure)) fail(`${where}: ${o.structure} is not a JSON structure`, o.structure, model.allJsonStructures().map(x => x.qualifiedName));
        const text = typeof o.snippet === "string" ? o.snippet : JSON.stringify(o.snippet, null, 4);
        const tree = snippetTree(text);
        const old = s.elements.length ? plainTree(s.elements[0]) : null;
        const d = treeDiff(old, tree);
        for (const e of [...s.elements]) e.delete();
        s.jsonSnippet = text.replace(/\r?\n/g, "\r\n");
        writeElement(s, tree, true);
        let n = 0;
        const count = x => (n++, x.children.forEach(count));
        count(tree);
        const users = await mappingsOf(m => m.jsonStructureQualifiedName === o.structure);
        const notes = users.map(m => {
            const imp = m instanceof im.ImportMapping;
            const lost = [];
            const w = el => (d.gone.has(elKey(el)) ? lost.push(shownEl(el)) : isObjEl(el) && el.children.forEach(w));
            m.rootMappingElements.forEach(w);
            return `${m.qualifiedName}: { "op": "${imp ? "updateImportMapping" : "updateExportMapping"}", "mapping": "${m.qualifiedName}"${lost.length ? `, "prune": true }  (maps paths that are gone: ${lost.join(", ")})` : " }"}`;
        });
        const same = !d.added.length && !d.removed.length && !d.retyped.length;
        return `${o.structure} (${n} elements${same ? ", same paths and types" : ""})` + listLine("added", d.added) + listLine("removed", d.removed) + listLine("retyped", d.retyped) +
            (notes.length && !same ? `\n      UPDATE THE MAPPINGS (same change or the next): ${notes.join("; ")}` : "");
    }

    // Sync a mapping with its source tree, in place: elements of paths still there keep their settings.
    async function updateMapping(o, imp) {
        const where = `${imp ? "updateImportMapping" : "updateExportMapping"} ${o.mapping}`;
        const doc = await mappingDocument(o.mapping, imp, where);
        const src = await sourceOf(doc, where);
        const mod = o.mapping.split(".")[0];
        const create = bool(o.create, false), createAttrs = create || bool(o.createAttributes, false), prune = bool(o.prune, false);
        const impl = h.impl();
        const nodes = new Map();
        const walkTree = n => (nodes.set(nodeKey(n), n), n.children.forEach(walkTree));
        walkTree(src.tree);
        const elements = [];
        const walkEl = (el, parent) => (elements.push({ el, parent }), isObjEl(el) && el.children.forEach(c => walkEl(c, el)));
        doc.rootMappingElements.forEach(r => walkEl(r, null));
        const paths = [...new Set([...nodes.values()].map(n => userPath(n.path)).filter(Boolean))];
        const mappedPaths = elements.map(x => userPath(elKey(x.el))).filter(Boolean);
        const known = (p, field, orMapped) => {
            const q = normPath(p);
            if (q !== "" && !paths.includes(q) && !(orMapped && mappedPaths.includes(q))) fail(`${where}: '${field}' names '${p}', which is not in ${src.name} (paths are keys joined with /)`, q, paths);
            return q;
        };
        const entities = new Map(Object.entries(o.entities || {}).map(([p, e]) => [known(p, "entities"), e]));
        const attributes = new Map(Object.entries(o.attributes || {}).map(([p, a]) => [known(p, "attributes"), a]));
        const skip = new Set([].concat(o.skip || []).map(p => known(p, "skip", true)));
        const keys = new Set([].concat(o.keys || []).map(p => known(p, "keys")));
        const root = doc.rootMappingElements[0];
        if (!root) throw new Error(`${where}: ${o.mapping} has no elements; delete it and create it again`);
        const top = src.tree.kind === "Array" && imp ? src.tree.children[0] : src.tree;
        if (!top) throw new Error(`${where}: ${src.name} is an empty array; give the snippet one item`);
        if (nodeKey(top) !== elKey(root)) throw new Error(`${where}: the root of ${src.name} changed (${elKey(root)} -> ${nodeKey(top)}); make a new mapping: delete this one, then create it again`);
        // mapped paths that are gone (or changed between value and object): refused before anything changes, unless prune
        const kindOk = (el, n) => n && (n.kind === "Value") === !isObjEl(el);
        const gone = elements.filter(({ el, parent }) => !kindOk(el, nodes.get(elKey(el))) && (!parent || kindOk(parent, nodes.get(elKey(parent)))));
        if (gone.length && !prune) throw new Error(`${where}: these mapped paths are no longer in ${src.name}: ${gone.map(x => shownEl(x.el)).join(", ")}. Add "prune": true to remove them from the mapping (the entities and attributes stay), or change the structure back; nothing was changed`);
        const report = { added: [], retyped: [], unmapped: [], created: [], removed: [], keys: [] };
        const seen = new Set();
        const updateSchema = (el, n) => {
            el.exposedName = n.name;
            el.minOccurs = n.min;
            el.maxOccurs = n.max;
            el.nillable = n.nillable;
            el.elementType = mp.ElementType[n.kind];
        };
        const loadedEntity = async qn => {
            if (!qn) return null;
            const e = await h.entity(qn);
            await h.loadParents(e);
            return e;
        };

        async function planValue(c, ent) {
            const p = userPath(c.path);
            if (!ent) return null;
            const name = attributes.get(p) || c.name;
            const chain = h.attributeChain(ent).attributes;
            let a = findAttribute(chain, name);
            if (!a) {
                if (!createAttrs) {
                    const s = suggest(name, chain.map(x => x.name), 3);
                    report.unmapped.push(`${p} (no attribute ${ent.qualifiedName}.${name}${s.length ? `; did you mean ${s.join(", ")}?` : ""})`);
                    return null;
                }
                validName(name, "attribute name");
                await impl.addAttribute({ entity: ent.qualifiedName, name, type: PRIM_TYPE[c.prim] || "String(unlimited)" }, ent);
                a = ent.attributes.find(x => x.name === name);
                report.created.push(`${ent.qualifiedName}.${name}`);
            }
            const kind = attrKind(a);
            if (kind === "Binary" || (FITS[c.prim] && !FITS[c.prim].includes(kind))) {
                if (attributes.has(p)) throw new Error(`${where}: '${p}' is ${c.prim}, but ${ent.qualifiedName}.${a.name} is ${kind}`);
                report.unmapped.push(`${p} (${c.prim}, but ${ent.qualifiedName}.${a.name} is ${kind})`);
                return null;
            }
            report.added.push(`${p} -> ${ent.qualifiedName}.${a.name}`);
            return { schema: c, attribute: a.name, attributeObj: a, key: imp && keys.has(p) };
        }
        async function planObject(n, parentEnt) {
            const p = userPath(n.path);
            const qn = entities.get(p) || n.entity || `${mod}.${n.name}`; // n.entity: message definitions say it
            let e = findEntity(qn);
            if (!e) {
                if (!create) {
                    report.unmapped.push(`${p} (no entity ${qn}: give "entities": { "${p}": "Module.Entity" }, or "create": true)`);
                    return null;
                }
                const [m, name] = qn.split(".");
                validName(name, "entity name");
                await impl.createEntity({ module: m, name, persistable: o.persistable });
                report.created.push(qn);
                e = findEntity(qn);
            }
            const entityObj = await loadedEntity(`${e.containerAsDomainModel.containerAsModule.name}.${e.name}`);
            let assocObj = null;
            if (parentEnt) {
                assocObj = associationBetween(entityObj, parentEnt);
                if (!assocObj) {
                    if (!create) {
                        report.unmapped.push(`${p} (no association between ${entityObj.qualifiedName} and ${parentEnt.qualifiedName}: add one with addAssociation, or "create": true)`);
                        return null;
                    }
                    const name = `${entityObj.name}_${parentEnt.name}`;
                    await impl.addAssociation({ from: entityObj.qualifiedName, to: parentEnt.qualifiedName, name });
                    assocObj = associationBetween(entityObj, parentEnt);
                    report.created.push(`${entityObj.qualifiedName.split(".")[0]}.${name}`);
                }
            }
            report.added.push(`${p} -> ${entityObj.qualifiedName}`);
            const node = { schema: n, entity: entityObj.qualifiedName, entityObj, assocObj, key: false, children: [] };
            for (const c of n.children) {
                const x = await planNew(c, entityObj);
                if (!x) continue;
                node.children.push(x);
                if (x.key) node.key = true;
            }
            return node;
        }
        async function planNew(c, ent) {
            if (skip.has(userPath(c.path))) return null;
            if (c.kind === "Value") return planValue(c, ent);
            if (c.kind === "Array") {
                const item = c.children[0];
                const inner = item && (await planObject(item, ent));
                if (!inner) return null;
                return imp ? inner : { schema: c, entity: null, children: [inner] };
            }
            return planObject(c, ent);
        }
        // Keep the structure's order: wanted elements first, in order (elements of removed paths after them).
        const reorder = (list, wanted) => {
            wanted.forEach((el, i) => {
                if (list[i] === el) return;
                el.detach();
                list.splice(i, 0, el);
            });
        };
        async function syncValue(el, c, ent) {
            seen.add(el);
            const p = userPath(c.path);
            const before = el.xmlPrimitiveType.name;
            const prim = c.prim === "Unknown" ? "String" : c.prim;
            updateSchema(el, c);
            if (before !== prim) {
                const a = ent && findAttribute(h.attributeChain(ent).attributes, String(el.attributeQualifiedName || "").split(".").pop());
                if (a && FITS[c.prim] && !FITS[c.prim].includes(attrKind(a))) throw new Error(`${where}: '${p}' is now ${c.prim}, but it is mapped to ${ent.qualifiedName}.${a.name} (${attrKind(a)}); change the attribute (changeAttribute), map it to another one (changeMapping "attribute"), or "skip" it`);
                el.xmlPrimitiveType = xmlschemas.XmlPrimitiveType[prim];
                report.retyped.push(`${p}: ${before} -> ${prim}`);
            }
            el.maxLength = c.maxLength;
            if (imp && keys.has(p) && !el.isKey) {
                el.isKey = true;
                report.keys.push(p);
            }
        }
        async function syncObject(el, n) {
            seen.add(el);
            updateSchema(el, n);
            const ent = await loadedEntity(el.entityQualifiedName);
            const wanted = [];
            for (const c of n.children) {
                if (skip.has(userPath(c.path))) continue;
                const target = c.kind === "Array" && imp ? c.children[0] : c; // import: the item sits under its parent
                if (!target) continue;
                const ex = elements.find(x => x.parent === el && elKey(x.el) === nodeKey(target) && kindOk(x.el, target));
                if (ex) {
                    if (c.kind === "Value") await syncValue(ex.el, c, ent);
                    else if (c.kind === "Array" && !imp) await syncContainer(ex.el, c, ent);
                    else await syncObject(ex.el, target);
                    wanted.push(ex.el);
                    continue;
                }
                const plan = await planNew(c, ent);
                if (plan) wanted.push(writeNode(el, plan, imp, false));
            }
            reorder(el.children, wanted);
            if (imp && el.objectHandling === mp.ObjectHandlingEnum.Create && el.children.some(x => !isObjEl(x) && x.isKey)) el.objectHandling = mp.ObjectHandlingEnum.Find;
        }
        // export: the element of an array holds its item
        async function syncContainer(el, c, parentEnt) {
            seen.add(el);
            updateSchema(el, c);
            const item = c.children[0];
            if (!item) return;
            const ex = elements.find(x => x.parent === el && elKey(x.el) === nodeKey(item) && isObjEl(x.el));
            if (ex) return syncObject(ex.el, item);
            const plan = await planObject(item, parentEnt);
            if (plan) writeNode(el, plan, imp, false);
        }
        await syncObject(root, top);
        for (const { el, parent } of elements) {
            if (seen.has(el) || (parent && !seen.has(parent))) continue;
            report.removed.push(shownEl(el) + (skip.has(userPath(elKey(el))) ? " (skip)" : ""));
            el.delete();
        }
        const changed = Object.values(report).some(l => l.length);
        return `${o.mapping} over ${src.name}${changed ? "" : ": already in step"}` + listLine("added", report.added) + listLine("retyped", report.retyped) + listLine("removed", report.removed) +
            listLine("keys", report.keys) + listLine("created", report.created) + listLine("NOT MAPPED (add them with createAttributes/create/entities/attributes, or skip them)", report.unmapped);
    }

    // The element of a mapping at a user path ("" = the root), with its ancestors (nearest first).
    function elementAt(doc, path, where) {
        const want = normPath(path);
        const hits = [];
        const all = [];
        const w = (el, up) => {
            const p = userPath(elKey(el));
            all.push(p || "(root)");
            if (p === want) hits.push({ el, up });
            if (isObjEl(el)) el.children.forEach(c => w(c, [el, ...up]));
        };
        doc.rootMappingElements.forEach(r => w(r, []));
        if (!hits.length) fail(`${where}: ${doc.qualifiedName} has no element '${path}' (paths are keys joined with /, "" is the root)`, want, [...new Set(all)]);
        // an export array has a container and an item with the same path: the item (it has the entity)
        return hits.find(x => isObjEl(x.el) && x.el.entityQualifiedName) || hits[0];
    }

    const flowParams = m => m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject);
    async function microflowNamed(qn, where) {
        const m = await get(qn).catch(() => fail(`${where}: no microflow ${qn}`, qn, model.allMicroflows().map(x => x.qualifiedName)));
        if (!(m instanceof mf.Microflow)) fail(`${where}: ${qn} is not a microflow`, qn, model.allMicroflows().map(x => x.qualifiedName));
        return m;
    }
    // data type class name an attribute kind is passed as
    const TYPE_OF_KIND = { String: "StringType", HashedString: "StringType", Integer: "IntegerType", Long: "IntegerType", AutoNumber: "IntegerType", Decimal: "DecimalType", Boolean: "BooleanType", DateTime: "DateTimeType", Enumeration: "EnumerationType" };
    const typeName = t => (t ? t.structureTypeName.split("$")[1] : "nothing");

    async function changeMapping(o) {
        const where = `changeMapping ${o.mapping}`;
        const doc = await mappingDocument(o.mapping, undefined, where);
        const imp = doc instanceof im.ImportMapping;
        const lines = [];
        const warn = w => h.client && h.client.warn(w);
        if (o.parameter !== undefined) {
            if (!imp) throw new Error(`${where}: only an import mapping has a parameter (an export mapping's parameter is its root object)`);
            doc.parameterType = await parameterType(o.parameter, where);
            lines.push(`parameter ${describeParam(doc.parameterType)}`);
            const users = h.client ? h.client.referencesTo(o.mapping).filter(u => u !== o.mapping) : [];
            if (users.length) lines.push(`CHECK the import steps that use it pass the parameter ("parameter" of importWithMapping): ${users.join(", ")}`);
        }
        const elFields = ["keys", "objectHandling", "ifNotFound", "microflow", "transform", "attribute", "association"];
        const given = elFields.filter(k => o[k] !== undefined);
        if (o.element === undefined) {
            if (given.length) throw new Error(`${where}: ${given.join(", ")} change one element: give "element", its path ("" = the root)`);
            if (o.parameter === undefined) throw new Error(`${where}: nothing to change: give "element" with ${elFields.join(", ")}, or "parameter"`);
            return `${o.mapping}: ${lines.join("; ")}`;
        }
        if (!given.length) throw new Error(`${where}: nothing to change for element '${o.element}': give ${elFields.join(", ")}`);
        const { el, up } = elementAt(doc, o.element, where);
        const p = userPath(elKey(el)) || "(root)";
        const obj = isObjEl(el);
        for (const k of given) {
            if (obj && ["transform", "attribute"].includes(k)) throw new Error(`${where}: '${k}' is for a value; '${p}' is an object (${el.entityQualifiedName || "array"}); give the path of one of its values`);
            if (!obj && !["transform", "attribute"].includes(k)) throw new Error(`${where}: '${k}' is for an object; '${p}' is a value (-> ${el.attributeQualifiedName}); give the path of its object: '${userPath(elKey(up[0])) || ""}'`);
            if (!imp && ["keys", "objectHandling", "ifNotFound", "microflow"].includes(k)) throw new Error(`${where}: '${k}' is an import mapping setting; an export mapping gets its objects from the parameter and over associations`);
        }
        const owner = up.find(x => x.entityQualifiedName); // the object element of a value; the parent object of an object
        if (obj) {
            if (!el.entityQualifiedName) throw new Error(`${where}: '${p}' is an array element without an entity; change its item instead`);
            const values = el.children.filter(c => !isObjEl(c));
            // everything is checked first: a refused change leaves the mapping as it was
            let chosen = null;
            if (o.keys !== undefined) {
                if (!Array.isArray(o.keys)) throw new Error(`${where}: keys is [ "value path or name" ]`);
                const names = values.map(v => userPath(elKey(v)));
                const pick = k => values.find(v => userPath(elKey(v)) === normPath(k)) || values.find(v => lc(userPath(elKey(v)).split("/").pop()) === lc(k)) ||
                    values.find(v => lc(String(v.attributeQualifiedName).split(".").pop()) === lc(k)) || fail(`${where}: '${p}' has no value '${k}' to be a key`, k, names);
                chosen = o.keys.map(pick);
            }
            let hnd = null;
            if (o.objectHandling !== undefined) {
                const HANDLING = { create: ["Create", "Create"], find: ["Find", null], findorcreate: ["Find", "Create"], custom: ["Custom", null], parameter: ["Parameter", null] };
                hnd = HANDLING[lc(o.objectHandling).replace(/[^a-z]/g, "")];
                if (!hnd) fail(`${where}: objectHandling '${o.objectHandling}' is not create | find | findOrCreate | custom | parameter`, o.objectHandling, ["create", "find", "findOrCreate", "custom", "parameter"]);
                if (hnd[0] === "Parameter") {
                    const t = doc.parameterType;
                    if (up.length) throw new Error(`${where}: only the root can be the mapping parameter`);
                    if (!(t instanceof datatypes.ObjectType) || t.entityQualifiedName !== el.entityQualifiedName) throw new Error(`${where}: the root is the parameter only when the mapping parameter is ${el.entityQualifiedName}; first set "parameter": "${el.entityQualifiedName}" (now: ${describeParam(t)})`);
                }
                if (hnd[0] === "Custom" && o.microflow === undefined && !el.mappingMicroflowCall) throw new Error(`${where}: objectHandling custom needs "microflow": a microflow that returns ${el.entityQualifiedName}`);
            }
            const finalHandling = hnd ? hnd[0] : chosen && chosen.length && el.objectHandling.name === "Create" ? "Find" : el.objectHandling.name;
            const finalKeys = chosen || values.filter(v => v.isKey);
            const backup = o.ifNotFound === undefined ? null : { create: "Create", ignore: "Ignore", error: "Error" }[lc(o.ifNotFound)];
            if (o.ifNotFound !== undefined && !backup) fail(`${where}: ifNotFound '${o.ifNotFound}' is not create | ignore | error`, o.ifNotFound, ["create", "ignore", "error"]);
            if (backup && finalHandling !== "Find") throw new Error(`${where}: ifNotFound applies when the object is found by keys; set "objectHandling": "find" (now ${finalHandling.toLowerCase()})`);
            if (imp && finalHandling === "Find" && !finalKeys.length) throw new Error(`${where}: '${p}' is found by keys but none of its values is a key; give "keys": [ "${values.length ? userPath(elKey(values[0])).split("/").pop() : "name"}" ]`);
            if (o.microflow !== undefined && finalHandling !== "Custom") throw new Error(`${where}: microflow goes with "objectHandling": "custom"`);
            let handler = null;
            if (o.microflow !== undefined) {
                const m = await microflowNamed(o.microflow, where);
                const ret = m.microflowReturnType;
                if (!(ret instanceof datatypes.ObjectType) || ret.entityQualifiedName !== el.entityQualifiedName) throw new Error(`${where}: ${o.microflow} must return a ${el.entityQualifiedName} object (it returns ${ret instanceof datatypes.ObjectType ? ret.entityQualifiedName : typeName(ret)})`);
                handler = { m, params: [] };
                for (const prm of flowParams(m)) {
                    const t = prm.variableType;
                    if (t instanceof datatypes.ObjectType) {
                        const level = up.findIndex(x => x.entityQualifiedName === t.entityQualifiedName);
                        if (level < 0) throw new Error(`${where}: parameter ${prm.name} of ${o.microflow} is a ${t.entityQualifiedName}, which is not the entity of a parent element of '${p}'`);
                        handler.params.push({ prm, level: level + 1, text: `${prm.name} = parent ${t.entityQualifiedName}` });
                    } else {
                        const v = values.find(x => lc(userPath(elKey(x)).split("/").pop()) === lc(prm.name) || lc(x.exposedName) === lc(prm.name) || lc(String(x.attributeQualifiedName).split(".").pop()) === lc(prm.name));
                        if (!v) fail(`${where}: parameter ${prm.name} of ${o.microflow} matches no value of '${p}' (name it like one of them)`, prm.name, values.map(x => userPath(elKey(x)).split("/").pop()));
                        handler.params.push({ prm, level: -1, v, text: `${prm.name} = ${userPath(elKey(v))}` });
                    }
                }
            }
            let assoc = null;
            if (o.association !== undefined) {
                if (!owner) throw new Error(`${where}: the root has no association`);
                assoc = await get(o.association).catch(() => fail(`${where}: no association ${o.association}`, o.association, model.allDomainModels().flatMap(d => d.associations.map(x => `${d.containerAsModule.name}.${x.name}`))));
                if (!(assoc instanceof dm.AssociationBase)) throw new Error(`${where}: ${o.association} is not an association`);
                const ends = [assoc.parentQualifiedName || (assoc.parent && assoc.parent.qualifiedName), assoc.childQualifiedName || (assoc.child && assoc.child.qualifiedName)];
                if (!(ends.includes(el.entityQualifiedName) && ends.includes(owner.entityQualifiedName))) throw new Error(`${where}: ${o.association} connects ${ends.join(" and ")}, not ${el.entityQualifiedName} and ${owner.entityQualifiedName}`);
            }
            // apply
            if (chosen) {
                for (const v of values) v.isKey = chosen.includes(v);
                lines.push(`keys ${chosen.map(v => String(v.attributeQualifiedName).split(".").pop()).join(", ") || "none"}`);
            }
            if (finalHandling !== el.objectHandling.name || hnd) {
                el.objectHandling = mp.ObjectHandlingEnum[finalHandling];
                el.objectHandlingBackup = mp.ObjectHandlingBackupEnum[finalHandling === "Find" ? backup || (hnd && hnd[1]) || "Error" : "Create"];
                if (finalHandling !== "Custom" && el.mappingMicroflowCall) el.mappingMicroflowCall.delete();
                if (finalHandling === "Parameter") warn(`ImportMappings$ObjectMappingElement ObjectHandling Parameter first use by ops (no Studio Pro sample in the test projects): check ${o.mapping} in Studio Pro`);
                lines.push(`objectHandling ${finalHandling}`);
            }
            if (backup) {
                el.objectHandlingBackup = mp.ObjectHandlingBackupEnum[backup];
                lines.push(`if no object is found: ${backup.toLowerCase()}`);
            }
            if (handler) {
                if (el.mappingMicroflowCall) el.mappingMicroflowCall.delete();
                const call = mp.MappingMicroflowCall.createIn(el);
                call.microflow = handler.m;
                for (const x of handler.params) {
                    const pm = mp.MappingMicroflowParameter.createIn(call);
                    pm.parameter = x.prm;
                    pm.levelOfParent = x.level;
                    if (x.v) {
                        pm.jsonValueElementPath = x.v.jsonPath;
                        pm.xmlValueElementPath = x.v.xmlPath;
                    }
                }
                warn(`Mappings$MappingMicroflowCall first use by ops (no Studio Pro sample of a custom object handler in the test projects): check ${o.mapping} in Studio Pro`);
                lines.push(`custom microflow ${o.microflow}(${handler.params.map(x => x.text).join(", ")})`);
            }
            if (assoc) {
                el.association = assoc;
                lines.push(`association ${o.association}`);
            }
        } else {
            const ent = await h.entity(owner.entityQualifiedName);
            await h.loadParents(ent);
            const chain = h.attributeChain(ent).attributes;
            let attr = findAttribute(chain, String(el.attributeQualifiedName).split(".").pop());
            if (o.attribute !== undefined) {
                const name = String(o.attribute).split(".").pop();
                attr = findAttribute(chain, name) || fail(`${where}: ${ent.qualifiedName} has no attribute '${o.attribute}'`, name, chain.map(x => x.name));
                const kind = attrKind(attr);
                const prim = el.xmlPrimitiveType.name;
                if (kind === "Binary" || (FITS[prim] && !FITS[prim].includes(kind))) throw new Error(`${where}: '${p}' is ${prim}, but ${ent.qualifiedName}.${attr.name} is ${kind}`);
            }
            let conv;
            if (o.transform !== undefined && o.transform !== "" && !/^none$/i.test(o.transform)) {
                conv = await microflowNamed(o.transform, where);
                const ps = flowParams(conv);
                const want = attr && TYPE_OF_KIND[attrKind(attr)];
                const ret = conv.microflowReturnType;
                const sig = imp ? `(Value: ${el.xmlPrimitiveType.name}) -> ${want ? want.replace("Type", "") : "the attribute type"}` : `(Value: ${want ? want.replace("Type", "") : "the attribute type"}) -> String`;
                const bad = ps.length !== 1 || ps[0].variableType instanceof datatypes.ObjectType || ps[0].variableType instanceof datatypes.ListType || !ret || ret instanceof datatypes.VoidType ||
                    (want && (imp ? typeName(ret) !== want : typeName(ps[0].variableType) !== want));
                if (bad) throw new Error(`${where}: a transform microflow of '${p}' takes one value and returns one: ${sig}; ${o.transform} is (${ps.map(x => `${x.name}: ${typeName(x.variableType).replace("Type", "")}`).join(", ")}) -> ${typeName(ret).replace("Type", "")}`);
            }
            if (o.attribute !== undefined) {
                el.attribute = attr;
                el.type = valueType(attr);
                lines.push(`attribute ${ent.qualifiedName}.${attr.name}`);
            }
            if (o.transform !== undefined) {
                el.converter = conv || null;
                lines.push(conv ? `transform ${o.transform}` : "no transform");
            }
        }
        return `${o.mapping} ${p}: ${lines.join("; ")}`;
    }

    // ------------------------------------------------ mapping-test: what a sample JSON would produce (no runtime)

    async function mappingTest(name, text) {
        const where = `mapping-test ${name}`;
        const doc = await mappingDocument(name, true, where);
        if (!doc.jsonStructureQualifiedName) throw new Error(`${where}: mapping-test simulates JSON import mappings; ${name} maps XML (try it in the running app)`);
        const sample = parseJson(text);
        const out = [`${name} with the sample (static simulation: no database, no microflows run):`];
        const counts = new Map();
        const notes = [];
        const lits = v => (v.t === "string" ? JSON.stringify(v.v) : v.t === "number" ? v.raw : v.t === "boolean" ? v.v : "empty");
        const ents = new Map();
        const entityOf = async qn => ents.get(qn) || (ents.set(qn, qn && (await h.entity(qn).then(async e => (await h.loadParents(e), e)).catch(() => null))), ents.get(qn));
        // key of a child element under its parent's JSON object
        const keyOf = el => {
            const parts = elKey(el).split("|");
            const last = parts[parts.length - 1];
            return last === "(Object)" || last === "(Wrapper)" ? parts[parts.length - 2] : last;
        };
        const check = (v, a, p, attrName) => {
            if (!a) return;
            const kind = attrKind(a);
            if (v.t === "null") return;
            if (["Integer", "Long", "AutoNumber"].includes(kind)) {
                if (v.t !== "number" && !(v.t === "string" && /^-?\d+$/.test(v.v))) notes.push(`${p}: ${lits(v)} is no whole number for ${attrName} (${kind}): runtime error`);
                else if (kind === "Integer" && Math.abs(Number(v.raw || v.v)) > 2147483647) notes.push(`${p}: ${lits(v)} is too large for ${attrName} (Integer; use Long)`);
                else if (v.t === "number" && /[.eE]/.test(v.raw)) notes.push(`${p}: ${v.raw} has decimals; ${attrName} is ${kind}`);
            } else if (kind === "Decimal" && v.t !== "number" && !(v.t === "string" && /^-?\d+(\.\d+)?$/.test(v.v))) notes.push(`${p}: ${lits(v)} is no number for ${attrName} (Decimal): runtime error`);
            else if (kind === "Boolean" && v.t !== "boolean" && !(v.t === "string" && /^(true|false)$/.test(v.v))) notes.push(`${p}: ${lits(v)} is no true/false for ${attrName}: runtime error`);
            else if (kind === "DateTime" && !(v.t === "string" && ISO_DATE.test(v.v)) && v.t !== "number") notes.push(`${p}: ${lits(v)} is no date (ISO 8601, e.g. 2024-05-01T10:00:00Z) for ${attrName}: runtime error`);
            else if (kind === "String" && v.t === "string" && a.type.length > 0 && v.v.length > a.type.length) notes.push(`${p}: ${v.v.length} characters, ${attrName} holds ${a.type.length}`);
            else if (kind === "Enumeration" && v.t === "string" && a.type.enumeration && a.type.enumeration.values && !a.type.enumeration.values.some(x => x.name === v.v)) notes.push(`${p}: ${lits(v)} is no value of ${a.type.enumerationQualifiedName}: runtime error`);
        };
        async function objectFor(el, v, depth, via) {
            const pad = "  ".repeat(depth);
            const p = userPath(elKey(el)) || "(root)";
            const ent = await entityOf(el.entityQualifiedName);
            if (v.t === "null") return void out.push(`${pad}${p}: null -> no ${el.entityQualifiedName} object`);
            if (v.t !== "object" && el.elementType.name !== "Wrapper") return void notes.push(`${p}: the sample has ${v.t}, the mapping expects an object`);
            const values = el.children.filter(c => !isObjEl(c));
            const entries = v.t === "object" ? new Map(v.entries) : new Map([["(Value)", v]]);
            const keyVals = values.filter(x => x.isKey).map(x => `${String(x.attributeQualifiedName).split(".").pop()} = ${entries.has(keyOf(x)) ? lits(entries.get(keyOf(x))) : "empty"}`);
            const how = { Create: "create", Find: `find by ${keyVals.join(", ") || "(no keys!)"}, if none: ${el.objectHandlingBackup.name.toLowerCase()}`, Custom: `from microflow ${el.mappingMicroflowCall ? el.mappingMicroflowCall.microflowQualifiedName : "?"}`, Parameter: "the mapping parameter" }[el.objectHandling.name];
            counts.set(el.entityQualifiedName, (counts.get(el.entityQualifiedName) || 0) + 1);
            out.push(`${pad}${el.entityQualifiedName} (${how})${via ? ` via ${via}` : ""}`);
            for (const x of values) {
                const k = keyOf(x);
                const attrName = String(x.attributeQualifiedName).split(".").pop();
                const a = ent && findAttribute(h.attributeChain(ent).attributes, attrName);
                const vp = userPath(elKey(x)) || p;
                if (!entries.has(k)) {
                    out.push(`${pad}  ${attrName} = (not in the sample: stays empty/default)`);
                    continue;
                }
                const val = entries.get(k);
                if (val.t === "object" || val.t === "array") {
                    notes.push(`${vp}: the sample has ${val.t === "object" ? "an object" : "an array"}, the mapping expects a value`);
                    continue;
                }
                out.push(`${pad}  ${attrName} = ${lits(val)}${x.converterQualifiedName ? ` (through ${x.converterQualifiedName})` : ""}${x.isKey ? " [key]" : ""}`);
                if (!x.converterQualifiedName) check(val, a, vp, `${el.entityQualifiedName}.${attrName}`);
            }
            if (v.t === "object") {
                const mappedKeys = new Set(el.children.map(keyOf));
                for (const [k] of v.entries) if (!mappedKeys.has(k)) notes.push(`${p === "(root)" ? "" : p + "/"}${k}: in the sample, not in the mapping (ignored)`);
            }
            for (const c of el.children.filter(isObjEl)) {
                const k = keyOf(c);
                if (!entries.has(k)) {
                    out.push(`${pad}  ${userPath(elKey(c))}: not in the sample (no ${c.entityQualifiedName})`);
                    continue;
                }
                const cv = entries.get(k);
                const many = c.maxOccurs === -1;
                const assoc = c.associationQualifiedName;
                if (many) {
                    if (cv.t === "null") continue;
                    if (cv.t !== "array") {
                        notes.push(`${userPath(elKey(c))}: the sample has ${cv.t}, the mapping expects an array`);
                        continue;
                    }
                    for (const item of cv.items) await objectFor(c, item, depth + 1, assoc);
                } else await objectFor(c, cv, depth + 1, assoc);
            }
        }
        const root = doc.rootMappingElements[0];
        if (!root) throw new Error(`${where}: ${name} has no elements`);
        if (root.maxOccurs === -1 || elKey(root).startsWith("(Array)")) {
            if (sample.t !== "array") throw new Error(`${where}: ${name} reads an array [ ... ]; the sample is ${sample.t === "object" ? "an object" : sample.t}`);
            out.push(`list of ${sample.items.length}:`);
            for (const item of sample.items) await objectFor(root, item, 1, null);
        } else {
            if (sample.t !== "object") throw new Error(`${where}: ${name} reads an object { ... }; the sample is ${sample.t === "array" ? "an array" : sample.t}`);
            await objectFor(root, sample, 1, null);
        }
        out.push("", `objects: ${[...counts].map(([e, n]) => `${n} ${e}`).join(", ") || "none"}`);
        out.push(notes.length ? `PROBLEMS / NOTES (${notes.length}):\n${notes.map(n => "  " + n).join("\n")}` : "no problems found");
        const pt = doc.parameterType;
        if (pt && !(pt instanceof datatypes.UnknownType)) out.push(`the mapping takes a parameter (${describeParam(pt)}): pass it with importWithMapping "parameter"`);
        return out.join("\n");
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
        createExportMapping: o => createMapping(o, false),
        changeJsonStructure,
        updateImportMapping: o => updateMapping(o, true),
        updateExportMapping: o => updateMapping(o, false),
        changeMapping
    };

    // ------------------------------------------------ checks (after apply, on a reloaded model)

    // Every element has its entity / attribute; with keys: every element path is in the source tree.
    async function elementProblems(doc, tree) {
        const r = [];
        const keys = new Set();
        if (tree) {
            const w = n => (keys.add(nodeKey(n)), n.children.forEach(w));
            w(tree);
        }
        const walk = el => {
            if (tree && !keys.has(elKey(el))) r.push(`${elKey(el)} is not in the source any more`);
            if (el instanceof mp.ObjectMappingElement) {
                if (el.entityQualifiedName && !model.findEntityByQualifiedName(el.entityQualifiedName)) r.push(`${el.jsonPath}: entity ${el.entityQualifiedName} missing`);
                if (!el.entityQualifiedName && el.elementType.name !== "Array") r.push(`${el.jsonPath} has no entity`);
                el.children.forEach(walk);
            } else if (!el.attributeQualifiedName) r.push(`${el.jsonPath} has no attribute`);
        };
        doc.rootMappingElements.forEach(walk);
        return r;
    }

    async function mappingProblems(o, imp) {
        const qn = `${o.module}.${o.name}`;
        const doc = await get(qn);
        const want = imp ? im.ImportMapping : em.ExportMapping;
        if (!(doc instanceof want)) return [`${qn} is not an ${imp ? "import" : "export"} mapping`];
        const r = [];
        if (doc.jsonStructureQualifiedName !== o.jsonStructure) r.push(`${qn} uses structure ${doc.jsonStructureQualifiedName}`);
        if (!doc.rootMappingElements.length) r.push(`${qn} has no elements`);
        if (imp && o.parameter !== undefined && describeParam(doc.parameterType).toLowerCase() !== String(o.parameter).toLowerCase()) r.push(`${qn} parameter is ${describeParam(doc.parameterType)}`);
        r.push(...(await elementProblems(doc, null)));
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
        createExportMapping: o => mappingProblems(o, false),
        changeJsonStructure: o => checks.createJsonStructure({ ...o, module: o.structure.split(".")[0], name: o.structure.split(".")[1] }),
        async updateImportMapping(o) {
            const doc = await get(o.mapping);
            return elementProblems(doc, (await sourceOf(doc, o.mapping)).tree);
        },
        updateExportMapping: o => checks.updateImportMapping(o),
        async changeMapping(o) {
            const doc = await get(o.mapping);
            const r = [];
            if (o.parameter !== undefined && describeParam(doc.parameterType).toLowerCase() !== (/^none$|^$/i.test(o.parameter) ? "none" : String(o.parameter).toLowerCase())) r.push(`parameter is ${describeParam(doc.parameterType)}`);
            if (o.element === undefined) return r;
            const { el } = elementAt(doc, o.element, "check");
            if (o.transform !== undefined && (el.converterQualifiedName || "") !== (/^none$/i.test(o.transform) ? "" : o.transform)) r.push(`${o.element}: transform is ${el.converterQualifiedName}`);
            if (o.attribute !== undefined && String(el.attributeQualifiedName).split(".").pop().toLowerCase() !== String(o.attribute).split(".").pop().toLowerCase()) r.push(`${o.element}: attribute is ${el.attributeQualifiedName}`);
            if (o.association !== undefined && el.associationQualifiedName !== o.association) r.push(`${o.element}: association is ${el.associationQualifiedName}`);
            if (o.microflow !== undefined && (!el.mappingMicroflowCall || el.mappingMicroflowCall.microflowQualifiedName !== o.microflow)) r.push(`${o.element}: no custom microflow ${o.microflow}`);
            if (o.keys !== undefined && el.children.filter(c => !isObjEl(c) && c.isKey).length !== o.keys.length) r.push(`${o.element}: keys differ`);
            return r;
        }
    };

    // planMapping/resolve/writeMapping for mappings outside a mapping document (ops-rest.js)
    return { impl, checks, mappingTest, internals: { planMapping, resolve, writeMapping, treeDiff, mappingsOf, nodeKey, elKey } };
}

// A later op of the plan changes what an earlier one made: the earlier op's check would see the later state.
function integChangedLater(name, o, rest) {
    const qn = o.module && o.name ? `${o.module}.${o.name}` : null;
    if (name === "createJsonStructure" && rest.some(x => x.op === "changeJsonStructure" && x.structure === qn)) return true;
    if (name === "changeJsonStructure" && rest.some(x => x.op === "changeJsonStructure" && x.structure === o.structure)) return true;
    if (/^create(Xml)?(Import|Export)Mapping$/.test(name) && rest.some(x => ["updateImportMapping", "updateExportMapping", "changeMapping"].includes(x.op) && x.mapping === qn)) return true;
    if (/^update(Import|Export)Mapping$|^changeMapping$/.test(name) && rest.some(x => ["updateImportMapping", "updateExportMapping", "changeMapping"].includes(x.op) && x.mapping === o.mapping)) return true;
    // consumed and published REST: later changes and deletes of the same service
    const svcQn = name === "createConsumedRestService" ? qn : name === "addRestOperation" ? o.service : null;
    if (svcQn && rest.some(x => ["changeRestService", "changeRestOperation", "deleteRestOperation"].includes(x.op) && String(x.service || x.operation || "").startsWith(svcQn))) return true;
    const pub = name === "publishRest" ? `${o.module}.${o.service}` : name === "changePublishedRestOperation" ? o.service : null;
    if (pub && rest.some(x => ["changePublishedRestOperation", "deletePublishedRestOperation", "deletePublishedRestResource", "changePublishedRestService"].includes(x.op) && x.service === pub)) return true;
    if (name === "publishOData" && rest.some(x => x.op === "changePublishedOData" && x.service === qn)) return true;
    if (name === "changeRestOperation" && rest.some(x => ["changeRestOperation", "deleteRestOperation"].includes(x.op) && x.operation === o.operation)) return true;
    return false;
}

module.exports = { makeMappings, MAPPING_OPS, snippetTree, parseJson, userPath, integChangedLater };
