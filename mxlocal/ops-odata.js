"use strict";
// Published OData services (Mendix 10.4+ PublishedODataService2): entities with their attributes, keys, associations
// between published entities, enumerations, and capabilities (insert, update, delete, count, top/skip, paging), after
// the Studio Pro sample in mxcli's TestApp (11.14: CarOdataApi). Consumed OData services, consumed SOAP web services and
// business events are refused with the Studio Pro steps: they come from a contract ($metadata, WSDL, AsyncAPI) that
// Studio Pro reads, validates and keeps in sync, which ops cannot do reliably.
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, enumValue } = require("./ops-util");
const { cmp } = require("./versions");

const { odatapublish: od, domainmodels: dm, security, microflows: mf, rest } = sdk;

const ENTITY_FIELDS = "[ \"Module.Entity\" or { \"entity\": ..., \"exposedName\": ..., \"attributes\": [ \"Attr\" ], \"key\": \"ID\" | [ \"Attr\" ], \"insert\": true | \"Module.Microflow\", \"update\": ..., \"delete\": ..., \"count\": true, \"topSkip\": true, \"pageSize\": number } ]";

const ODATA_OPS = {
    publishOData: {
        doc: "Publish entities in an OData service (Mendix 10.4+): attributes, key, associations between them, enumerations, insert/update/delete.",
        fields: {
            module: "R module name", name: "R service name, e.g. OrderOData", entities: "R " + ENTITY_FIELDS,
            path: "optional location (default odata/<name>/v1/)", version: "optional (default 1.0.0)", namespace: "optional (default DefaultNamespace)",
            authentication: "optional [ \"Basic\" | \"Session\" | \"Microflow\" | \"Guest\" ] (default [\"Basic\"])", roles: "optional [ \"Module.Role\" ] allowed to use the service",
            associations: "optional true/false: publish associations between published entities (default true)", summary: "optional", description: "optional", folder: "optional folder path"
        }
    },
    changePublishedOData: {
        doc: "Change a published OData service: add or replace entities (same fields as publishOData), change one (add/remove attributes, insert/update/delete, count, top/skip, paging), remove entities, version, path, roles, authentication, summary, description. Navigation properties are made again.",
        fields: {
            service: "R Module.Service", entities: "optional entities to add, or to replace when already published: " + ENTITY_FIELDS, remove: "optional [ \"Module.Entity\" ] to stop publishing",
            change: "optional [ { \"entity\": \"Module.Entity\", \"addAttributes\": [ \"Attr\" ], \"removeAttributes\": [ \"Attr\" ], \"insert\" / \"update\" / \"delete\": true | false | \"Module.Microflow\", \"count\", \"topSkip\", \"pageSize\": number | null, \"exposedName\", \"key\" } ]: change a published entity, the rest stays",
            version: "optional", path: "optional location", authentication: "optional [ \"Basic\" | \"Session\" | \"Microflow\" | \"Guest\" ] (replaces)", roles: "optional [ \"Module.Role\" ] (replaces)",
            summary: "optional", description: "optional"
        }
    },
    updateConsumedODataService: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): refresh a consumed OData service from a new $metadata, add external entities.",
        fields: { service: "optional Module.Service", metadata: "optional $metadata file" }
    },
    consumeODataService: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): consume an OData service from its $metadata.",
        fields: { module: "optional module name", name: "optional service name", metadata: "optional $metadata file" }
    },
    consumeWebService: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): consume a SOAP web service from its WSDL.",
        fields: { module: "optional module name", name: "optional", wsdl: "optional WSDL file or URL" }
    },
    createBusinessEvent: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): publish or consume business events (define events: createBusinessEventService).",
        fields: { module: "optional module name", name: "optional", entity: "optional", consume: "optional" }
    }
};

const REFUSALS = {
    updateConsumedODataService: "A consumed OData service is updated by Studio Pro from the new $metadata (or the Catalog): it compares the contract, changes the external entities, their attributes, keys and associations and stores the new contract; no test project has a Studio Pro-saved consumed OData service to build that from. In Studio Pro: open the consumed OData service document, click Update (or Update from file for a $metadata file), review the changes, then drag new external entities from the Integration pane into the domain model. Removing an external entity works with ops: { \"op\": \"delete\", \"target\": \"Module.Entity\" }.",
    consumeODataService: "Consumed OData services are not written by ops: Studio Pro reads the $metadata, stores it, makes the external entities with their remote types and keys and keeps them in step; a hand-made copy breaks on the first update. In Studio Pro: right-click the module > Add other > Consumed OData service, choose the $metadata file (or the Catalog), then drag the external entities from the Integration pane into the domain model and give module roles access.",
    consumeWebService: "Consumed SOAP web services are not written by ops: Studio Pro imports the WSDL and its schemas and builds the operations from them. In Studio Pro: right-click the module > Add other > Consumed web service, import the WSDL, then call an operation with the 'Call web service' microflow action and map the result with an import mapping (createXmlImportMapping works on its XML schema too).",
    createBusinessEvent: "Publishing or consuming business events is not written by ops: it needs the Business Events module from the Marketplace, and Studio Pro makes the event entities (they inherit from BusinessEvents.PublishedBusinessEvent / ConsumedBusinessEvent) and imports contracts of other apps (AsyncAPI). Ops can define the events of this app: createBusinessEventService / changeBusinessEventService. In Studio Pro: add the Business Events module, open the business event service, tick Publish / Subscribe per event (or Add other > Business event service > use an existing contract), and publish with the 'Publish business event' action."
};

const EDM = { String: "Edm.String", HashedString: null, Integer: "Edm.Int32", Long: "Edm.Int64", AutoNumber: "Edm.Int64", Decimal: "Edm.Decimal", Boolean: "Edm.Boolean", DateTime: "Edm.DateTimeOffset", Binary: null };

function makeOData(h) {
    const { model, get, exists, folder, version } = h;
    const atLeast = v => cmp(version, v) >= 0;
    const warn = w => h.client && h.client.warn(w);
    const kindOf = a => a.type.structureTypeName.split("$")[1].replace("AttributeType", "");

    async function changeMode(set, which, v, where) {
        const under = `createInEntitySetUnder${which}Mode`;
        if (v === undefined || v === false) return void od.ChangeNotSupported[under](set);
        if (v === true) return void od.ChangeSource[under](set);
        const m = await get(v).catch(() => fail(`${where}: no microflow ${v}`, v, model.allMicroflows().map(x => x.qualifiedName)));
        if (!(m instanceof mf.Microflow)) throw new Error(`${where}: ${v} is not a microflow`);
        od.CallMicroflowToChange[under](set).microflow = m;
    }

    // One published entity (type and set) of a service; published: entity qn -> entity type, enums: enumeration qn -> published one
    async function publishEntity(svc, raw, where, published, enums) {
        const spec = typeof raw === "string" ? { entity: raw } : raw;
        if (!spec || !spec.entity) throw new Error(`${where}: ${ENTITY_FIELDS}`);
        const known = ["entity", "exposedName", "attributes", "key", "insert", "update", "delete", "count", "topSkip", "pageSize"];
        for (const k of Object.keys(spec)) if (!known.includes(k)) fail(`${where}: unknown field '${k}'`, k, known);
        const ent = await h.entity(spec.entity);
        if (published.has(ent.qualifiedName)) throw new Error(`${where}: ${spec.entity} is published twice`);
        await h.loadParents(ent);
        const stored = h.persistable(ent);
        const et = od.EntityType.createIn(svc);
        et.entity = ent;
        et.exposedName = spec.exposedName || ent.name;
        validName(et.exposedName, "exposed name");
        published.set(ent.qualifiedName, et);
        const all = h.attributeChain(ent).attributes;
        const names = spec.attributes === undefined ? all.filter(a => EDM[kindOf(a)] !== null).map(a => a.name) : [].concat(spec.attributes);
        const key = spec.key === undefined ? (stored ? "ID" : null) : spec.key;
        if (!key) throw new Error(`${where}: ${spec.entity} is not stored; give "key": [ "Attr" ] (attributes that identify an object)`);
        const keyAttrs = key === "ID" ? [] : [].concat(key);
        if (key === "ID" && !stored) throw new Error(`${where}: only a stored entity has the ID key; give "key": [ "Attr" ]`);
        if (key === "ID") {
            const id = od.PublishedId.createIn(et);
            id.exposedName = "ID";
            id.isPartOfKey = true;
        }
        for (const n of keyAttrs) if (!names.includes(n)) names.unshift(n);
        for (const n of names) {
            const a = all.find(x => x.name === n);
            if (!a) fail(`${where}: ${spec.entity} has no attribute '${n}'`, n, all.map(x => x.name));
            const k = kindOf(a);
            if (EDM[k] === null) throw new Error(`${where}: ${n} is ${k}, which an OData service does not publish`);
            const pa = od.PublishedAttribute.createIn(et);
            pa.attribute = a;
            pa.exposedName = a.name;
            const isKey = keyAttrs.includes(n);
            pa.isPartOfKey = isKey;
            pa.canBeEmpty = !isKey;
            pa.filterable = true;
            pa.sortable = true;
            pa.enumerationAsString = false;
            let edm = EDM[k];
            if (k === "Enumeration") {
                const en = a.type.enumeration;
                if (!enums.has(en.qualifiedName)) {
                    const pe = od.PublishedEnumeration.createIn(svc);
                    pe.enumeration = en;
                    pe.exposedName = en.name;
                    for (const v of en.values) {
                        const pv = od.PublishedEnumerationValue.createIn(pe);
                        pv.enumerationValue = v;
                        pv.exposedName = v.name;
                    }
                    enums.set(en.qualifiedName, pe);
                }
                edm = `${svc.namespace}.${en.name}`;
            }
            if (atLeast("11.12.0")) pa.edmType = edm;
        }
        const set = od.EntitySet.createIn(svc);
        set.entityType = et;
        set.exposedName = `${et.exposedName}s`;
        set.usePaging = spec.pageSize !== undefined;
        set.pageSize = spec.pageSize === undefined ? 10000 : Number(spec.pageSize);
        od.ReadSource.createIn(set);
        await changeMode(set, "Insert", spec.insert, where);
        await changeMode(set, "Update", spec.update, where);
        await changeMode(set, "Delete", spec.delete, where);
        const q = set.queryOptions || od.QueryOptions.createIn(set);
        q.countable = bool(spec.count, true);
        q.topSupported = bool(spec.topSkip, true);
        q.skipSupported = bool(spec.topSkip, true);
        return `${set.exposedName} (${ent.qualifiedName}, key ${key === "ID" ? "ID" : keyAttrs.join("+")}, ${names.length} attribute(s)${spec.insert || spec.update || spec.delete ? ", writable" : ""})`;
    }

    // Navigation properties for the associations between published entities (the owner's entity type).
    async function publishAssociations(svc, published, lines) {
        for (const [eqn, et] of published) {
            const ent = et.entity;
            for (const d of model.allDomainModels()) {
                const dmLoaded = d.isLoaded ? d : await d.load();
                for (const a of [...dmLoaded.associations, ...dmLoaded.crossAssociations]) {
                    if (a.parent !== ent) continue;
                    const child = a.child;
                    if (!child || !child.qualifiedName || !published.has(child.qualifiedName)) continue;
                    const pe = od.PublishedAssociationEnd.createIn(et);
                    pe.association = a;
                    pe.entity = child;
                    pe.exposedName = a.name;
                    pe.exposedAssociationName = a.name;
                    pe.canBeEmpty = true;
                    if (atLeast("11.12.0")) pe.isMany = a.type === dm.AssociationType.ReferenceSet;
                    lines.push(`association ${a.qualifiedName} (${eqn} -> ${child.qualifiedName})`);
                }
            }
        }
    }

    // The publishOData spec of an entity as it is published now (to change part of it and publish it again).
    function currentSpec(svc, t) {
        const set = svc.entitySets.find(x => x.entityType === t);
        const attrs = t.childMembers.filter(m => m instanceof od.PublishedAttribute).map(m => m.attributeQualifiedName.split(".").pop());
        const keyAttrs = t.childMembers.filter(m => m instanceof od.PublishedAttribute && m.isPartOfKey).map(m => m.attributeQualifiedName.split(".").pop());
        const mode = m => (m instanceof od.CallMicroflowToChange ? m.microflowQualifiedName : m instanceof od.ChangeSource);
        const spec = { entity: t.entityQualifiedName, exposedName: t.exposedName, attributes: attrs, key: t.childMembers.some(m => m instanceof od.PublishedId) ? "ID" : keyAttrs };
        if (set) {
            Object.assign(spec, { insert: mode(set.insertMode), update: mode(set.updateMode), delete: mode(set.deleteMode) });
            if (set.queryOptions) Object.assign(spec, { count: set.queryOptions.countable, topSkip: set.queryOptions.topSupported });
            if (set.usePaging) spec.pageSize = set.pageSize;
        }
        return spec;
    }

    const CHANGE_KEYS = ["entity", "addAttributes", "removeAttributes", "insert", "update", "delete", "count", "topSkip", "pageSize", "exposedName", "key"];
    function changedSpec(svc, t, c, where) {
        for (const k of Object.keys(c)) if (!CHANGE_KEYS.includes(k)) fail(`${where}: unknown change field '${k}'`, k, CHANGE_KEYS);
        const spec = currentSpec(svc, t);
        const had = [...spec.attributes];
        for (const a of [].concat(c.removeAttributes || [])) {
            if (!had.includes(a)) fail(`${where}: ${c.entity} does not publish attribute '${a}'`, a, had);
            if (Array.isArray(spec.key) && spec.key.includes(a) && c.key === undefined) throw new Error(`${where}: ${a} is part of the key of ${c.entity}; give a new "key" too`);
        }
        spec.attributes = had.filter(a => ![].concat(c.removeAttributes || []).includes(a));
        for (const a of [].concat(c.addAttributes || [])) {
            if (had.includes(a)) throw new Error(`${where}: ${c.entity} already publishes '${a}'`);
            spec.attributes.push(a);
        }
        for (const k of ["insert", "update", "delete", "count", "topSkip", "exposedName", "key"]) if (c[k] !== undefined) spec[k] = c[k];
        if (c.pageSize !== undefined) {
            if (c.pageSize === null || c.pageSize === false) delete spec.pageSize;
            else spec.pageSize = c.pageSize;
        }
        return spec;
    }

    const impl = {
        async publishOData(o) {
            if (!atLeast("10.4.0")) throw new Error(`published OData services of this kind need Mendix 10.4 (this project is ${version}); publish it in Studio Pro`);
            validName(o.name, "service name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            if (!Array.isArray(o.entities) || !o.entities.length) throw new Error(`${qn}: entities is ${ENTITY_FIELDS}`);
            const svc = od.PublishedODataService2.createIn(folder(o.module, o.folder));
            svc.name = o.name;
            svc.serviceName = o.name;
            svc.version = o.version === undefined ? "1.0.0" : String(o.version);
            svc.path = o.path || `odata/${o.name.toLowerCase()}/v1/`;
            svc.namespace = o.namespace || "DefaultNamespace";
            svc.summary = String(o.summary || "");
            svc.description = String(o.description || "");
            svc.publishAssociations = bool(o.associations, true);
            svc.oDataVersion = od.PublishedODataVersion.OData4;
            svc.authenticationTypes.clear();
            for (const a of [].concat(o.authentication || ["Basic"])) svc.authenticationTypes.push(enumValue(rest.RestAuthenticationType, a, "authentication"));
            for (const r of [].concat(o.roles || [])) {
                const role = await get(r);
                if (!(role instanceof security.ModuleRole)) throw new Error(`'${r}' is not a module role`);
                svc.allowedModuleRoles.push(role);
            }
            const published = new Map(); // entity qn -> entity type
            const enums = new Map();
            const lines = [];
            for (const [i, raw] of o.entities.entries()) lines.push(await publishEntity(svc, raw, `${qn} entity ${i + 1}`, published, enums));
            if (svc.publishAssociations) await publishAssociations(svc, published, lines);
            warn(`ODataPublish$PublishedODataService2 by ops (layout of the one Studio Pro sample, TestApp 11.14; associations, enumerations and write modes have no sample): check ${qn} in Studio Pro`);
            return `${qn} (/${svc.path}, version ${svc.version})` + lines.map(l => "\n      " + l).join("");
        },
        async changePublishedOData(o) {
            const where = `changePublishedOData ${o.service}`;
            const svc = await get(o.service).catch(() => fail(`${where}: no published OData service ${o.service}`, o.service, model.allPublishedODataServices ? model.allPublishedODataServices().map(x => x.qualifiedName) : []));
            if (!(svc instanceof od.PublishedODataService2)) throw new Error(`${where}: ${o.service} is not a published OData service of Mendix 10.4+ (change it in Studio Pro)`);
            const lines = [];
            const qnOf = t => t.entityQualifiedName;
            const known = new Map(svc.entityTypes.map(t => [qnOf(t), t]));
            const removeType = qn => {
                const t = known.get(qn);
                for (const set of svc.entitySets.filter(x => x.entityType === t)) set.delete();
                t.delete();
                known.delete(qn);
            };
            const specs = [].concat(o.entities || []).map(raw => (typeof raw === "string" ? { entity: raw } : raw));
            for (const [i, c] of [].concat(o.change || []).entries()) {
                const w = `${where} change ${i + 1}`;
                if (!c || !c.entity) throw new Error(`${w}: { "entity": "Module.Entity", ... }`);
                if (!known.has(c.entity)) fail(`${w}: ${c.entity} is not published in ${o.service}; add it with "entities"`, c.entity, [...known.keys()]);
                if (specs.some(x => x && x.entity === c.entity)) throw new Error(`${w}: ${c.entity} is both in entities and change`);
                specs.push(changedSpec(svc, known.get(c.entity), c, w));
            }
            for (const r of [].concat(o.remove || [])) {
                if (!known.has(r)) fail(`${where}: ${r} is not published in ${o.service}`, r, [...known.keys()]);
                if (specs.some(x => x && x.entity === r)) throw new Error(`${where}: ${r} is both in entities and remove`);
            }
            if (!specs.length && !o.remove && !o.change && ["version", "path", "authentication", "roles", "summary", "description"].every(k => o[k] === undefined)) throw new Error(`${where}: nothing to change`);
            for (const r of [].concat(o.remove || [])) {
                removeType(r);
                lines.push(`removed ${r}`);
            }
            for (const spec of specs) if (spec && known.has(spec.entity)) {
                removeType(spec.entity);
                lines.push(`replaced ${spec.entity}:`);
            }
            // navigation properties and enumerations are made again for the entities that stay
            for (const t of svc.entityTypes) for (const m of [...t.childMembers]) if (m instanceof od.PublishedAssociationEnd) m.delete();
            const published = new Map(svc.entityTypes.map(t => [qnOf(t), t]));
            const enums = new Map(svc.enumerations.map(e => [e.enumerationQualifiedName, e]));
            for (const [i, spec] of specs.entries()) lines.push(await publishEntity(svc, spec, `${where} entity ${i + 1}`, published, enums));
            const usedEnums = new Set();
            for (const t of svc.entityTypes) {
                const ent = await h.entity(t.entityQualifiedName);
                await h.loadParents(ent);
                const attrs = h.attributeChain(ent).attributes;
                for (const m of t.childMembers) {
                    const a = m instanceof od.PublishedAttribute && attrs.find(x => x.qualifiedName === m.attributeQualifiedName);
                    if (a && a.type instanceof dm.EnumerationAttributeType) usedEnums.add(a.type.enumerationQualifiedName);
                }
            }
            for (const e of [...svc.enumerations]) if (!usedEnums.has(e.enumerationQualifiedName)) e.delete();
            if (svc.publishAssociations) await publishAssociations(svc, published, lines);
            if (o.version !== undefined) (svc.version = String(o.version)), lines.push(`version ${svc.version}`);
            if (o.path !== undefined) (svc.path = String(o.path)), lines.push(`path ${svc.path}`);
            if (o.summary !== undefined) svc.summary = String(o.summary);
            if (o.description !== undefined) svc.description = String(o.description);
            if (o.authentication !== undefined) {
                const list = [].concat(o.authentication).map(a => enumValue(rest.RestAuthenticationType, a, "authentication"));
                svc.authenticationTypes.clear();
                for (const a of list) svc.authenticationTypes.push(a);
                lines.push(`authentication ${list.map(a => a.name).join(", ")}`);
            }
            if (o.roles !== undefined) {
                const roles = [];
                for (const r of [].concat(o.roles)) {
                    const role = await get(r);
                    if (!(role instanceof security.ModuleRole)) throw new Error(`'${r}' is not a module role`);
                    roles.push(role);
                }
                svc.allowedModuleRoles.clear();
                for (const r of roles) svc.allowedModuleRoles.push(r);
                lines.push(`roles ${[].concat(o.roles).join(", ") || "none"}`);
            }
            if (!svc.entityTypes.length) throw new Error(`${where}: no entity would be left; delete the service instead: { "op": "delete", "target": "${o.service}" }`);
            return `${o.service} (${svc.entityTypes.length} entities)` + lines.map(l => "\n      " + l).join("");
        },
        ...Object.fromEntries(Object.entries(REFUSALS).map(([n, why]) => [n, async () => {
            throw new Error(`${n} is not supported. ${why} Record it with: mx.py gap "${n}"`);
        }]))
    };

    const checks = {
        async publishOData(o) {
            const s = await get(`${o.module}.${o.name}`);
            if (!(s instanceof od.PublishedODataService2)) return [`${o.module}.${o.name} is not a published OData service`];
            const want = o.entities.map(x => (typeof x === "string" ? x : x.entity));
            const have = s.entityTypes.map(t => t.entityQualifiedName);
            return want.filter(w => !have.includes(w)).map(w => `${o.module}.${o.name} does not publish ${w}`);
        },
        async changePublishedOData(o) {
            const s = await get(o.service);
            const have = s.entityTypes.map(t => t.entityQualifiedName);
            const r = [].concat(o.remove || []).filter(x => have.includes(x)).map(x => `${o.service} still publishes ${x}`);
            for (const x of [].concat(o.entities || [])) if (!have.includes(typeof x === "string" ? x : x.entity)) r.push(`${o.service} does not publish ${typeof x === "string" ? x : x.entity}`);
            for (const c of [].concat(o.change || [])) {
                const t = s.entityTypes.find(x => x.entityQualifiedName === c.entity);
                if (!t) {
                    r.push(`${o.service} does not publish ${c.entity}`);
                    continue;
                }
                const names = t.childMembers.filter(m => m instanceof od.PublishedAttribute).map(m => m.attributeQualifiedName.split(".").pop());
                for (const a of [].concat(c.addAttributes || [])) if (!names.includes(a)) r.push(`${c.entity}: ${a} is not published`);
                for (const a of [].concat(c.removeAttributes || [])) if (names.includes(a)) r.push(`${c.entity}: ${a} is still published`);
            }
            if (s.entitySets.length !== s.entityTypes.length) r.push(`${o.service}: ${s.entityTypes.length} entity types, ${s.entitySets.length} sets`);
            return r;
        },
        ...Object.fromEntries(Object.keys(REFUSALS).map(n => [n, async () => []]))
    };
    return { impl, checks };
}

module.exports = { makeOData, ODATA_OPS };
