"use strict";
// XML integration: XML schema documents from an .xsd file, message definitions from entities, and import/export
// mappings over an XML schema (one root element) or a message definition, in the style of ops-mappings.js.
// Message definitions and mappings over them follow the Studio Pro sample of Mendix 8.18 (Charts: MD_DataPoints,
// EM_ExportSeries): a list root "<Entity>s" with items "<Entity>", members "<Parent>|<Name>", many-associations as
// "<Child>s|<Child>". No Studio Pro-saved XML schema or XML mapping exists in the test projects: the schema stores the
// .xsd text as Studio Pro does (XmlSchemaEntry), and XML mapping paths are the element names joined with | (the
// convention of the message definition sample); the dry run says to check them in Studio Pro.
const fs = require("fs");
const path = require("path");
const sdk = require("mendixmodelsdk");
const { fail, validName, bool } = require("./ops-util");

const { xmlschemas, messagedefinitions: md, mappings: mp, importmappings: im, exportmappings: em, datatypes, domainmodels: dm, microflows: mf } = sdk;

const XML_MAP_FIELDS = {
    module: "R module name of the mapping", name: "R mapping name, e.g. IMM_OrderXml",
    xmlSchema: "Module.XmlSchema (with rootElement), or use messageDefinition", rootElement: "with xmlSchema: the global element to map, e.g. Order (default the first)",
    messageDefinition: "Module.Collection.Definition (createMessageDefinition), instead of xmlSchema",
    entity: "optional root entity (default <module>.<root element name>)", entities: "optional { \"path\": \"Module.Entity\" } (paths: element names joined with /, from the root, e.g. Order/Lines/Line)",
    attributes: "optional { \"path\": \"AttributeName\" }", skip: "optional [ \"path\" ]", create: "optional true: create missing entities, attributes and associations", persistable: "optional true/false for created entities", folder: "optional folder path"
};

const XML_OPS = {
    createXmlSchema: {
        doc: "Create an XML schema document from an .xsd file (one file: xs:import/xs:include are refused).",
        fields: { module: "R module name", name: "R schema name, e.g. XSD_Order", file: "R path of the .xsd file (relative: to the current folder, then the project folder)", folder: "optional folder path" }
    },
    createMessageDefinition: {
        doc: "Create a message definition (collection with one definition) of an entity, its attributes and associations; map it with createXmlImportMapping / createXmlExportMapping.",
        fields: { module: "R module name", name: "R collection name, e.g. MD_Orders", entity: "R Module.Entity", definition: "optional definition name (default the entity name)", attributes: "optional [ \"Attr\" ] (default all but binary)", associations: "optional [ \"Module.Assoc\" ] exposed with all their attributes", folder: "optional folder path" }
    },
    createXmlImportMapping: { doc: "Create an import mapping (XML -> objects) from an XML schema element or a message definition.", fields: { ...XML_MAP_FIELDS, keys: "optional [ \"path\" ] values that identify their object" } },
    createXmlExportMapping: { doc: "Create an export mapping (objects -> XML) from an XML schema element or a message definition.", fields: XML_MAP_FIELDS },
    changeXmlSchema: {
        doc: "Import an XML schema again from its (changed) .xsd file: the dry run lists added and removed elements and the mappings to update with updateImportMapping / updateExportMapping.",
        fields: { schema: "R Module.XmlSchema", file: "optional .xsd path (default: the file it was imported from)" }
    },
    changeMessageDefinition: {
        doc: "Rebuild a message definition from its entity: attributes and associations (what is not given stays); lists the mappings to update.",
        fields: { definition: "R Module.Collection.Definition (or Module.Collection with one definition)", attributes: "optional [ \"Attr\" ], or \"all\" (all but binary; default: the ones exposed now that still exist)", associations: "optional [ \"Module.Assoc\" ] (default: the ones exposed now)" }
    }
};

// ---------------------------------------------------------------- a small XML reader (enough for XSD files)

function parseXml(text) {
    const s = String(text).replace(/^﻿/, "");
    let i = 0;
    const root = { name: "#doc", attrs: {}, children: [] };
    const stack = [root];
    const err = what => {
        throw new Error(`not well-formed XML: ${what} at line ${s.slice(0, i).split("\n").length}`);
    };
    while (i < s.length) {
        const lt = s.indexOf("<", i);
        if (lt < 0) break;
        i = lt;
        if (s.startsWith("<!--", i)) {
            const e = s.indexOf("-->", i);
            if (e < 0) err("unclosed comment");
            i = e + 3;
        } else if (s.startsWith("<?", i)) {
            const e = s.indexOf("?>", i);
            if (e < 0) err("unclosed <?");
            i = e + 2;
        } else if (s.startsWith("<![CDATA[", i)) {
            const e = s.indexOf("]]>", i);
            i = e + 3;
        } else if (s.startsWith("<!", i)) {
            const e = s.indexOf(">", i);
            i = e + 1;
        } else if (s[i + 1] === "/") {
            const e = s.indexOf(">", i);
            const name = s.slice(i + 2, e).trim();
            const top = stack.pop();
            if (!top || top.name !== name) err(`</${name}> does not close <${top && top.name}>`);
            i = e + 1;
        } else {
            const m = /^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(s.slice(i));
            if (!m) err("bad tag");
            const el = { name: m[1], attrs: {}, children: [] };
            for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = (a[2] !== undefined ? a[2] : a[3]).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
            stack[stack.length - 1].children.push(el);
            if (!m[3]) stack.push(el);
            i += m[0].length;
        }
    }
    if (stack.length !== 1) err(`<${stack[stack.length - 1].name}> is not closed`);
    const top = root.children[0];
    if (!top) err("no root element");
    return top;
}

const local = n => String(n).split(":").pop();
const kids = (el, name) => el.children.filter(c => local(c.name) === name);

// xs: built-in type -> XmlPrimitiveType
const XS_PRIM = {
    string: "String", normalizedString: "String", token: "String", anyURI: "String", ID: "String", IDREF: "String", NMTOKEN: "String", Name: "String", NCName: "String", language: "String", QName: "String",
    int: "Integer", integer: "Integer", short: "Integer", byte: "Integer", nonNegativeInteger: "Integer", positiveInteger: "Integer", nonPositiveInteger: "Integer", negativeInteger: "Integer",
    unsignedInt: "Integer", unsignedShort: "Integer", unsignedByte: "Integer", long: "Long", unsignedLong: "Long",
    decimal: "Decimal", float: "Float", double: "Float", boolean: "Boolean", dateTime: "DateTime", date: "Date", time: "Time", base64Binary: "Binary", hexBinary: "Binary", anyType: "AnyType"
};

// The element tree of one global element of an XSD, as plain nodes for ops-mappings (path: names joined with |).
function xsdTree(xsdText, rootName, where) {
    const schema = parseXml(xsdText);
    if (local(schema.name) !== "schema") throw new Error(`${where}: the file is not an XML schema (root <${schema.name}>)`);
    for (const k of ["import", "include", "redefine"]) if (kids(schema, k).length) throw new Error(`${where}: the schema uses xs:${k}; a schema spread over several files: import it in Studio Pro`);
    const types = new Map([...kids(schema, "complexType"), ...kids(schema, "simpleType")].map(t => [t.attrs.name, t]));
    const globals = kids(schema, "element");
    if (!globals.length) throw new Error(`${where}: the schema has no global element`);
    const top = rootName ? globals.find(e => e.attrs.name === rootName) : globals[0];
    if (!top) fail(`${where}: no global element '${rootName}'`, rootName, globals.map(e => e.attrs.name));
    const occurs = (el, k, d) => (el.attrs[k] === undefined ? d : el.attrs[k] === "unbounded" ? -1 : Number(el.attrs[k]));
    const unsupported = what => {
        throw new Error(`${where}: the schema uses ${what}; ops map sequences and all-groups of elements with built-in types: map this schema in Studio Pro`);
    };
    const prim = (typeName, el) => {
        const t = local(typeName);
        if (XS_PRIM[t] && /^(xs|xsd)?:?/.test(typeName)) return XS_PRIM[t];
        const st = types.get(t);
        if (st && local(st.name) === "simpleType") {
            const r = kids(st, "restriction")[0];
            if (r && r.attrs.base) return prim(r.attrs.base, el);
        }
        return null;
    };
    const seen = new Set();
    function node(el, parentPath, depth) {
        if (el.attrs.ref) unsupported("element references (ref=)");
        const name = el.attrs.name;
        const p = parentPath ? `${parentPath}|${name}` : name;
        const min = occurs(el, "minOccurs", 1), max = occurs(el, "maxOccurs", 1);
        const base = { name, path: p, xmlPath: p, jsonPath: "", min, max, nillable: el.attrs.nillable === "true", maxLength: -1, children: [] };
        let complex = kids(el, "complexType")[0];
        if (!complex && el.attrs.type) {
            const pr = prim(el.attrs.type, el);
            if (pr) {
                if (max !== 1) unsupported(`a repeated simple element (${p})`);
                return { ...base, kind: "Value", prim: pr };
            }
            complex = types.get(local(el.attrs.type));
            if (!complex) unsupported(`the type ${el.attrs.type} (${p})`);
            if (seen.has(complex) || depth > 12) unsupported(`a recursive type (${p})`);
        }
        if (!complex) return { ...base, kind: "Value", prim: "String" };
        if (kids(complex, "attribute").length || kids(complex, "simpleContent").length || kids(complex, "complexContent").length || complex.attrs.mixed === "true") unsupported(`attributes, extensions or mixed content (${p})`);
        const group = [...kids(complex, "sequence"), ...kids(complex, "all")];
        if (kids(complex, "choice").length || group.some(g => kids(g, "choice").length || kids(g, "any").length || kids(g, "group").length || kids(g, "sequence").length)) unsupported(`xs:choice, xs:any or nested groups (${p})`);
        seen.add(complex);
        const children = group.flatMap(g => kids(g, "element")).map(c => node(c, p, depth + 1));
        seen.delete(complex);
        return { ...base, kind: "Object", prim: "Unknown", children };
    }
    const tree = node(top, "", 0);
    if (tree.kind !== "Object") throw new Error(`${where}: the element ${tree.name} holds a single value; map an element with child elements`);
    return { tree, targetNamespace: schema.attrs.targetNamespace || "", root: tree.name };
}

// ---------------------------------------------------------------- bound operations

function makeXml(h) {
    const { model, get, exists, folder } = h;
    const warn = w => h.client && h.client.warn(w);

    const PRIM_OF = { String: "String", HashedString: "String", Enumeration: "String", Integer: "Integer", Long: "Long", AutoNumber: "Long", Decimal: "Decimal", Boolean: "Boolean", DateTime: "DateTime", Binary: "Binary" };
    const kindOf = a => a.type.structureTypeName.split("$")[1].replace("AttributeType", "");

    function readFile(file, where) {
        const cands = [path.resolve(String(file)), path.resolve(h.client.project.dir, String(file))];
        const hit = cands.find(f => fs.existsSync(f) && fs.statSync(f).isFile());
        if (!hit) throw new Error(`${where}: file '${file}' not found (looked in ${[...new Set(cands)].join(", ")})`);
        return { full: hit, text: fs.readFileSync(hit, "utf8") };
    }

    // members of a message definition element: attributes of entity, then the associations' entities
    function setCommon(e, x) {
        e.elementType = mp.ElementType[x.kind];
        e.primitiveType = xmlschemas.XmlPrimitiveType[x.prim];
        e.path = x.path;
        e.isDefaultType = false;
        e.minOccurs = x.min;
        e.maxOccurs = x.max;
        e.nillable = true;
        e.exposedName = x.exposedName;
        e.exposedItemName = x.itemName || "";
        e.maxLength = -1;
        e.fractionDigits = -1;
        e.totalDigits = -1;
        e.errorMessage = "";
        e.warningMessage = "";
        e.documentation = "";
        e.example = "";
        e.originalName = x.originalName;
    }

    async function attributesOf(ent, list, where) {
        await h.loadParents(ent);
        const all = h.attributeChain(ent).attributes;
        if (list === undefined) return all.filter(a => kindOf(a) !== "Binary");
        return [].concat(list).map(n => {
            const a = all.find(x => x.name === n);
            if (!a) fail(`${where}: ${ent.qualifiedName} has no attribute '${n}'`, n, all.map(x => x.name));
            if (kindOf(a) === "Binary") throw new Error(`${where}: binary attribute ${n} cannot be in a message definition`);
            return a;
        });
    }

    // The plain node tree of a message definition (from the stored definition), for ops-mappings' planMapping.
    function definitionTree(def) {
        const conv = (e, jsonParent, xmlParent) => {
            const isAttr = e instanceof md.ExposedAttribute;
            const many = e.maxOccurs === -1;
            let jsonPath, xmlPath;
            if (!jsonParent) {
                jsonPath = many ? "(Array)|(Object)" : "(Object)";
                xmlPath = many ? `${e.exposedName}|${e.exposedItemName}` : e.exposedName;
            } else if (isAttr) {
                jsonPath = `${jsonParent}|${e.exposedName}`;
                xmlPath = `${xmlParent}|${e.exposedName}`;
            } else {
                jsonPath = many ? `${jsonParent}|${e.exposedName}|(Object)` : `${jsonParent}|${e.exposedName}`;
                xmlPath = many ? `${xmlParent}|${e.exposedName}|${e.exposedItemName}` : `${xmlParent}|${e.exposedName}`;
            }
            const n = {
                kind: isAttr ? "Value" : "Object", name: isAttr ? e.attribute.name : e.exposedName, path: jsonPath, jsonPath, xmlPath, prim: isAttr ? e.primitiveType.name : "Unknown",
                min: e.minOccurs, max: e.maxOccurs, nillable: e.nillable, maxLength: e.maxLength, children: []
            };
            if (!isAttr) {
                n.entity = e.entityQualifiedName;
                n.children = [...e.children].map(c => conv(c, jsonPath, xmlPath));
            }
            return n;
        };
        return conv(def.exposedEntity, null, null);
    }

    async function source(o, where) {
        if (!!o.xmlSchema === !!o.messageDefinition) throw new Error(`${where}: give xmlSchema (with rootElement) or messageDefinition`);
        if (o.messageDefinition) {
            const parts = String(o.messageDefinition).split(".");
            if (parts.length !== 3) throw new Error(`${where}: messageDefinition is Module.Collection.Definition`);
            const coll = await get(parts.slice(0, 2).join(".")).catch(() => fail(`${where}: no message definition collection ${parts.slice(0, 2).join(".")}`, parts.slice(0, 2).join("."), model.allMessageDefinitionCollections().map(x => x.qualifiedName)));
            if (!(coll instanceof md.MessageDefinitionCollection)) throw new Error(`${where}: ${parts.slice(0, 2).join(".")} is not a message definition collection`);
            const def = coll.messageDefinitions.find(d => d.name === parts[2]);
            if (!def) fail(`${where}: ${parts.slice(0, 2).join(".")} has no definition '${parts[2]}'`, parts[2], coll.messageDefinitions.map(d => d.name));
            const tree = definitionTree(def);
            // the definition says the entities: map onto exactly those
            const entities = {};
            const walk = (n, root) => {
                if (n.kind !== "Object") return;
                const p = n.path.split("|").filter(x => !/^\((Object|Array)\)$/.test(x)).join("/");
                if (!root) entities[p] = n.entity;
                n.children.forEach(c => walk(c, false));
            };
            walk(tree, true);
            return { def, tree, entity: tree.entity, entities };
        }
        if (o.rootElement !== undefined && !o.xmlSchema) throw new Error(`${where}: rootElement goes with xmlSchema`);
        const schema = await get(o.xmlSchema).catch(() => fail(`${where}: no XML schema ${o.xmlSchema}`, o.xmlSchema, model.allXmlSchemas().map(x => x.qualifiedName)));
        if (!(schema instanceof xmlschemas.XmlSchema)) throw new Error(`${where}: ${o.xmlSchema} is not an XML schema`);
        if (schema.entries.length !== 1) throw new Error(`${where}: ${o.xmlSchema} has ${schema.entries.length} schema files; map it in Studio Pro`);
        const x = xsdTree(schema.entries[0].contents, o.rootElement, where);
        return { schema, tree: x.tree, root: x.root };
    }

    async function createXmlMapping(o, imp) {
        const where = `${imp ? "import" : "export"} mapping ${o.module}.${o.name}`;
        validName(o.name, "mapping name");
        if (await exists(`${o.module}.${o.name}`)) throw new Error(`${o.module}.${o.name} already exists`);
        if (o.messageDefinition && (o.entity || o.entities || o.create)) throw new Error(`${where}: a message definition says its entities; leave out entity, entities and create`);
        const src = await source(o, where);
        const spec = { ...o, jsonStructure: o.xmlSchema || o.messageDefinition, ...(src.entity ? { entity: src.entity, entities: src.entities } : {}) };
        const plan = h.mappingInternals.planMapping(spec, src.tree, imp);
        const created = await h.mappingInternals.resolve(plan, spec, imp);
        const doc = (imp ? im.ImportMapping : em.ExportMapping).createIn(folder(o.module, o.folder));
        doc.name = o.name;
        if (src.def) doc.messageDefinition = src.def;
        else {
            doc.xmlSchema = src.schema;
            doc.rootElementName = src.root;
        }
        if (imp) doc.parameterType = datatypes.UnknownType.create(model);
        else doc.nullValueOption = mf.NullValueOption.LeaveOutElement;
        h.mappingInternals.writeMapping(doc, plan, imp);
        warn(`${imp ? "ImportMappings$ImportMapping" : "ExportMappings$ExportMapping"} first use over ${src.def ? "a message definition (layout of the Mendix 8.18 sample)" : "an XML schema (no Studio Pro sample: element paths are names joined with |)"}: check ${o.module}.${o.name} in Studio Pro`);
        let values = 0;
        const count = n => (n.children ? n.children.forEach(count) : values++);
        count(plan.top);
        return `${o.module}.${o.name}: ${plan.top.entity} over ${o.xmlSchema ? `${o.xmlSchema} <${src.root}>` : o.messageDefinition} (${values} value(s))` + (created.length ? `\n      created: ${created.join(", ")}` : "");
    }

    // The exposed entity of a definition: a list of the entity, its attributes, per association the other entity.
    async function buildDefinition(def, ent, attributes, associations, qn) {
        const o = { attributes, associations, entity: ent.qualifiedName };
        const root = md.ExposedEntity.createInEntityMessageDefinitionUnderExposedEntity(def);
        root.entity = ent;
        setCommon(root, { kind: "Object", prim: "Unknown", path: ent.name, min: 0, max: -1, exposedName: `${ent.name}s`, itemName: ent.name, originalName: ent.name });
        const addAttrs = async (owner, e, list, p) => {
            for (const a of await attributesOf(e, list, qn)) {
                const x = md.ExposedAttribute.createInElementUnderChildren(owner);
                x.attribute = a;
                setCommon(x, { kind: "Value", prim: PRIM_OF[kindOf(a)] || "String", path: `${p}|${a.name}`, min: 0, max: 1, exposedName: a.name, originalName: a.name });
            }
        };
        await addAttrs(root, ent, o.attributes, ent.name);
        for (const an of [].concat(o.associations || [])) {
            const assoc = await get(an);
            if (!(assoc instanceof dm.AssociationBase)) throw new Error(`${qn}: ${an} is not an association`);
            const parent = assoc.parent, child = assoc.child;
            let other, many;
            if (parent === ent) {
                other = child;
                many = assoc.type === dm.AssociationType.ReferenceSet;
            } else if (child === ent) {
                other = parent;
                many = true;
            } else throw new Error(`${qn}: ${an} does not connect ${o.entity}`);
            if (!other || !other.qualifiedName) throw new Error(`${qn}: ${an} goes to an entity outside the project`);
            const x = md.ExposedAssociation.createInElementUnderChildren(root);
            x.association = assoc;
            x.entity = other;
            const p = many ? `${ent.name}|${other.name}s|${other.name}` : `${ent.name}|${other.name}`;
            setCommon(x, { kind: "Object", prim: "Unknown", path: p, min: 0, max: many ? -1 : 1, exposedName: many ? `${other.name}s` : other.name, itemName: many ? other.name : "", originalName: other.name });
            await addAttrs(x, other, undefined, p);
        }
        return root;
    }

    const impl = {
        async createXmlSchema(o) {
            validName(o.name, "schema name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const { full, text } = readFile(o.file, qn);
            const x = parseXml(text);
            if (local(x.name) !== "schema") throw new Error(`${qn}: ${o.file} is not an XML schema (root <${x.name}>)`);
            for (const k of ["import", "include", "redefine"]) if (kids(x, k).length) throw new Error(`${qn}: ${o.file} uses xs:${k}; a schema of several files: import it in Studio Pro`);
            const s = xmlschemas.XmlSchema.createIn(folder(o.module, o.folder));
            s.name = o.name;
            s.filePath = full;
            const e = xmlschemas.XmlSchemaEntry.createInXmlSchemaUnderEntries(s);
            e.targetNamespace = x.attrs.targetNamespace || "";
            e.location = path.basename(full);
            e.contents = text;
            e.localizedLocationFormat = "";
            e.localizedContentsFormat = "";
            warn(`XmlSchemas$XmlSchema first use by ops (no Studio Pro sample in the test projects): check ${qn} in Studio Pro`);
            return `${qn} (${path.basename(full)}, elements ${kids(x, "element").map(el => el.attrs.name).join(", ") || "none"})`;
        },
        async createMessageDefinition(o) {
            validName(o.name, "collection name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const ent = await h.entity(o.entity);
            const coll = md.MessageDefinitionCollection.createIn(folder(o.module, o.folder));
            coll.name = o.name;
            const def = md.EntityMessageDefinition.createIn(coll);
            def.name = o.definition === undefined ? ent.name : String(o.definition);
            validName(def.name, "definition name");
            const root = await buildDefinition(def, ent, o.attributes, o.associations, qn);
            warn(`MessageDefinitions$MessageDefinitionCollection first use by ops (layout of the Mendix 8.18 sample, no Mendix 10/11 sample): check ${qn} in Studio Pro`);
            return `${qn}.${def.name} (${o.entity}, ${root.children.length} member(s))`;
        },
        createXmlImportMapping: o => createXmlMapping(o, true),
        createXmlExportMapping: o => createXmlMapping(o, false),
        async changeXmlSchema(o) {
            const where = `changeXmlSchema ${o.schema}`;
            const schema = await get(o.schema).catch(() => fail(`${where}: no XML schema ${o.schema}`, o.schema, model.allXmlSchemas().map(x => x.qualifiedName)));
            if (!(schema instanceof xmlschemas.XmlSchema)) fail(`${where}: ${o.schema} is not an XML schema`, o.schema, model.allXmlSchemas().map(x => x.qualifiedName));
            if (schema.entries.length !== 1) throw new Error(`${where}: ${o.schema} has ${schema.entries.length} schema files; update it in Studio Pro (right-click > Update)`);
            if (o.file === undefined && !schema.filePath) throw new Error(`${where}: ${o.schema} does not say which file it came from; give "file"`);
            const { full, text } = readFile(o.file === undefined ? schema.filePath : o.file, where);
            const x = parseXml(text);
            if (local(x.name) !== "schema") throw new Error(`${where}: ${full} is not an XML schema (root <${x.name}>)`);
            for (const k of ["import", "include", "redefine"]) if (kids(x, k).length) throw new Error(`${where}: ${full} uses xs:${k}; a schema of several files: update it in Studio Pro`);
            const entry = schema.entries[0];
            const oldText = entry.contents;
            const names = t => kids(parseXml(t), "element").map(e => e.attrs.name);
            const before = names(oldText), after = names(text);
            const lines = [];
            const added = after.filter(n => !before.includes(n)), removed = before.filter(n => !after.includes(n));
            if (added.length) lines.push(`elements added: ${added.join(", ")}`);
            if (removed.length) lines.push(`elements removed: ${removed.join(", ")}`);
            // per mapping over this schema: the paths of its root element that changed
            const { treeDiff, mappingsOf } = h.mappingInternals;
            for (const m of await mappingsOf(d => d.xmlSchemaQualifiedName === o.schema)) {
                const root = m.rootElementName;
                if (!after.includes(root)) {
                    lines.push(`${m.qualifiedName}: its root element <${root}> is gone; delete the mapping and create it again`);
                    continue;
                }
                let d;
                try {
                    d = treeDiff(xsdTree(oldText, root, where).tree, xsdTree(text, root, where).tree);
                } catch (e) {
                    throw new Error(`${where}: ${e.message.replace(/^.*?: /, "")} (element <${root}> of ${m.qualifiedName})`);
                }
                const what = [d.added.length && `added ${d.added.join(", ")}`, d.removed.length && `removed ${d.removed.join(", ")}`, d.retyped.length && `retyped ${d.retyped.join(", ")}`].filter(Boolean);
                if (what.length) lines.push(`${m.qualifiedName} <${root}>: ${what.join("; ")}; UPDATE IT: { "op": "${m instanceof im.ImportMapping ? "updateImportMapping" : "updateExportMapping"}", "mapping": "${m.qualifiedName}"${d.removed.length ? ", \"prune\": true" : ""} }`);
            }
            entry.contents = text;
            entry.targetNamespace = x.attrs.targetNamespace || "";
            entry.location = path.basename(full);
            schema.filePath = full;
            return `${o.schema} (${path.basename(full)}${text === oldText ? ", unchanged" : ""}, elements ${after.join(", ") || "none"})` + lines.map(l => "\n      " + l).join("");
        },
        async changeMessageDefinition(o) {
            const where = `changeMessageDefinition ${o.definition}`;
            const parts = String(o.definition).split(".");
            if (parts.length < 2 || parts.length > 3) throw new Error(`${where}: definition is Module.Collection.Definition`);
            const cq = parts.slice(0, 2).join(".");
            const coll = await get(cq).catch(() => fail(`${where}: no message definition collection ${cq}`, cq, model.allMessageDefinitionCollections().map(x => x.qualifiedName)));
            if (!(coll instanceof md.MessageDefinitionCollection)) throw new Error(`${where}: ${cq} is not a message definition collection`);
            if (parts.length === 2 && coll.messageDefinitions.length !== 1) throw new Error(`${where}: ${cq} has ${coll.messageDefinitions.length} definitions; name one: ${coll.messageDefinitions.map(d => `${cq}.${d.name}`).join(", ")}`);
            const def = parts.length === 2 ? coll.messageDefinitions[0] : coll.messageDefinitions.find(d => d.name === parts[2]) || fail(`${where}: ${cq} has no definition '${parts[2]}'`, parts[2], coll.messageDefinitions.map(d => d.name));
            if (!(def instanceof md.EntityMessageDefinition) || !def.exposedEntity) throw new Error(`${where}: ${cq}.${def.name} is not a definition of an entity`);
            const defQn = `${cq}.${def.name}`;
            const old = def.exposedEntity;
            const ent = await h.entity(old.entityQualifiedName);
            await h.loadParents(ent);
            const have = h.attributeChain(ent).attributes.map(a => a.name);
            const nowAttrs = old.children.filter(c => c instanceof md.ExposedAttribute).map(c => String(c.attributeQualifiedName).split(".").pop());
            const attrs = o.attributes === "all" ? undefined : o.attributes !== undefined ? [].concat(o.attributes) : nowAttrs.filter(n => have.includes(n));
            const assocs = o.associations !== undefined ? [].concat(o.associations) : old.children.filter(c => c instanceof md.ExposedAssociation).map(c => c.associationQualifiedName);
            const lost = nowAttrs.filter(n => !have.includes(n));
            const before = definitionTree(def);
            old.delete();
            await buildDefinition(def, ent, attrs, assocs, defQn);
            const d = h.mappingInternals.treeDiff(before, definitionTree(def));
            const lines = [];
            if (d.added.length) lines.push(`added: ${d.added.join(", ")}`);
            if (d.removed.length) lines.push(`removed: ${d.removed.join(", ")}`);
            if (lost.length) lines.push(`attributes no longer in ${ent.qualifiedName}: ${lost.join(", ")}`);
            const notExposed = have.filter(n => !(attrs || have).includes(n) && kindOf(ent.attributes.find(a => a.name === n) || { type: { structureTypeName: "x$StringAttributeType" } }) !== "Binary");
            if (o.attributes === undefined && notExposed.length) lines.push(`not exposed (add with "attributes"): ${notExposed.join(", ")}`);
            if (d.added.length || d.removed.length) {
                for (const m of await h.mappingInternals.mappingsOf(x => x.messageDefinitionQualifiedName === defQn)) lines.push(`UPDATE ${m.qualifiedName}: { "op": "${m instanceof im.ImportMapping ? "updateImportMapping" : "updateExportMapping"}", "mapping": "${m.qualifiedName}"${d.removed.length ? ", \"prune\": true" : ""} }`);
            }
            return `${defQn} (${ent.qualifiedName}, ${def.exposedEntity.children.length} member(s))` + lines.map(l => "\n      " + l).join("");
        }
    };

    const mappingCheck = async (o, T) => {
        const d = await get(`${o.module}.${o.name}`);
        if (!(d instanceof T)) return [`${o.module}.${o.name} is not a mapping`];
        const r = [];
        if (!d.rootMappingElements.length) r.push(`${o.module}.${o.name} has no elements`);
        if (o.xmlSchema && d.xmlSchemaQualifiedName !== o.xmlSchema) r.push(`${o.module}.${o.name} uses schema ${d.xmlSchemaQualifiedName}`);
        return r;
    };
    const checks = {
        async createXmlSchema(o) {
            const s = await get(`${o.module}.${o.name}`);
            return s instanceof xmlschemas.XmlSchema && s.entries.length === 1 && s.entries[0].contents ? [] : [`${o.module}.${o.name} has no schema contents`];
        },
        async createMessageDefinition(o) {
            const c = await get(`${o.module}.${o.name}`);
            return c instanceof md.MessageDefinitionCollection && c.messageDefinitions.length === 1 && c.messageDefinitions[0].exposedEntity ? [] : [`${o.module}.${o.name} has no definition`];
        },
        async changeXmlSchema(o) {
            const s = await get(o.schema);
            return s.entries.length === 1 && s.entries[0].contents && parseXml(s.entries[0].contents) ? [] : [`${o.schema} has no schema contents`];
        },
        async changeMessageDefinition(o) {
            const parts = o.definition.split(".");
            const c = await get(parts.slice(0, 2).join("."));
            const def = parts[2] ? c.messageDefinitions.find(d => d.name === parts[2]) : c.messageDefinitions[0];
            const r = def && def.exposedEntity ? [] : [`${o.definition} has no exposed entity`];
            if (def && Array.isArray(o.attributes)) for (const a of o.attributes) if (!def.exposedEntity.children.some(x => x instanceof md.ExposedAttribute && String(x.attributeQualifiedName).endsWith("." + a))) r.push(`${o.definition} does not expose ${a}`);
            return r;
        },
        createXmlImportMapping: o => mappingCheck(o, im.ImportMapping),
        createXmlExportMapping: o => mappingCheck(o, em.ExportMapping)
    };
    return { impl, checks, internals: { source, definitionTree } };
}

module.exports = { makeXml, XML_OPS, parseXml, xsdTree };
