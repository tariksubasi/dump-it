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
    consumeODataService: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): consume an OData service from its $metadata.",
        fields: { module: "optional module name", name: "optional service name", metadata: "optional $metadata file" }
    },
    consumeWebService: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): consume a SOAP web service from its WSDL.",
        fields: { module: "optional module name", name: "optional", wsdl: "optional WSDL file or URL" }
    },
    createBusinessEvent: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): publish or consume business events.",
        fields: { module: "optional module name", name: "optional", entity: "optional", consume: "optional" }
    }
};

const REFUSALS = {
    consumeODataService: "Consumed OData services are not written by ops: Studio Pro reads the $metadata, stores it, makes the external entities with their remote types and keys and keeps them in step; a hand-made copy breaks on the first update. In Studio Pro: right-click the module > Add other > Consumed OData service, choose the $metadata file (or the Catalog), then drag the external entities from the Integration pane into the domain model and give module roles access.",
    consumeWebService: "Consumed SOAP web services are not written by ops: Studio Pro imports the WSDL and its schemas and builds the operations from them. In Studio Pro: right-click the module > Add other > Consumed web service, import the WSDL, then call an operation with the 'Call web service' microflow action and map the result with an import mapping (createXmlImportMapping works on its XML schema too).",
    createBusinessEvent: "Business events are not written by ops: they need the Business Events module from the Marketplace and an AsyncAPI contract that Studio Pro generates (published) or imports (consumed). In Studio Pro: add the Business Events module, right-click your module > Add other > Business event service, define the events (entities inherit from BusinessEvents.PublishedBusinessEvent / ConsumedBusinessEvent) and publish them with the 'Publish business event' action."
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
            for (const [i, raw] of o.entities.entries()) {
                const spec = typeof raw === "string" ? { entity: raw } : raw;
                const where = `${qn} entity ${i + 1}`;
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
                lines.push(`${set.exposedName} (${ent.qualifiedName}, key ${key === "ID" ? "ID" : keyAttrs.join("+")}, ${names.length} attribute(s)${spec.insert || spec.update || spec.delete ? ", writable" : ""})`);
            }
            // associations between published entities: a navigation property on the owner's entity type
            if (svc.publishAssociations) {
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
            warn(`ODataPublish$PublishedODataService2 by ops (layout of the one Studio Pro sample, TestApp 11.14; associations, enumerations and write modes have no sample): check ${qn} in Studio Pro`);
            return `${qn} (/${svc.path}, version ${svc.version})` + lines.map(l => "\n      " + l).join("");
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
        ...Object.fromEntries(Object.keys(REFUSALS).map(n => [n, async () => []]))
    };
    return { impl, checks };
}

module.exports = { makeOData, ODATA_OPS };
