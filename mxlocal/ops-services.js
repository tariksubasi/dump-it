"use strict";
// Service documents of Studio Pro's "Add other" menu: business event services this app defines (events and their
// attributes), published SOAP web services (operations over microflows), and the refresh check of a consumed SOAP web
// service against a new WSDL. No test project has a Studio Pro-saved sample of any of them: the types are written from
// the SDK metamodel (storage names from storage-names.json) and each op warns "check it in Studio Pro" (first use).
// Business events that come from another app (a consumed service: an AsyncAPI contract) and the Publish / Subscribe
// implementations (entities Studio Pro generates from BusinessEvents.PublishedBusinessEvent / ConsumedBusinessEvent)
// stay in Studio Pro.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, enumValue } = require("./ops-util");
const { cmp } = require("./versions");

const { businessevents: be, webservices: ws, domainmodels: dm, microflows: mf, datatypes } = sdk;

const EVENT_TYPES = ["String", "Integer", "Long", "Decimal", "Boolean", "DateTime"];
const EVENT_FIELDS = "[ { \"name\": \"OrderPlaced\", \"attributes\": { \"OrderId\": \"String\", \"Total\": \"Decimal\" }, \"description\": \"...\", \"publish\": true, \"subscribe\": true } ]";
const OPERATION_FIELDS = "[ \"Module.Microflow\" or { \"microflow\": \"Module.Microflow\", \"name\": \"GetOrder\", \"description\": \"...\", \"optional\": [ \"Param\" ] } ]";

const SERVICE_OPS = {
    createBusinessEventService: {
        doc: "Define business events in a business event service of this app (Mendix 10+): events with their attributes (String, Integer, Long, Decimal, Boolean, DateTime). Publishing or subscribing (the event entities) is done in Studio Pro.",
        fields: {
            module: "R module name", name: "R document name, e.g. OrderEvents", events: "R " + EVENT_FIELDS, serviceName: "optional (default the document name)",
            eventNamePrefix: "optional prefix of the event names in the contract (default \"\")", summary: "optional", description: "optional", folder: "optional folder path"
        }
    },
    changeBusinessEventService: {
        doc: "Change a business event service this app defines: add or remove events, add or remove attributes of an event, summary, description. The dry run lists the Studio Pro implementations (entities) to bring in step.",
        fields: {
            service: "R Module.Service", addEvents: "optional " + EVENT_FIELDS, removeEvents: "optional [ \"EventName\" ]",
            addAttributes: "optional { \"EventName\": { \"Attr\": \"String\" } }", removeAttributes: "optional { \"EventName\": [ \"Attr\" ] }",
            summary: "optional", description: "optional", force: "optional true: remove an event that this app implements (Studio Pro then shows errors to fix)"
        }
    },
    publishWebService: {
        doc: "Publish microflows as operations of a SOAP web service (Studio Pro: Published web service). Parameters and results of primitive types, objects and lists (all attributes of the entity).",
        fields: {
            module: "R module name", name: "R service name, e.g. OrderService", operations: "R " + OPERATION_FIELDS, namespace: "optional target namespace (default http://www.example.com/)",
            authentication: "optional None | UsernamePassword | Custom (default UsernamePassword)", headerMicroflow: "optional Custom: Module.Microflow that checks the request",
            description: "optional", validate: "optional true/false: validate the request against the WSDL (default false)", folder: "optional folder path"
        }
    },
    changeWebService: {
        doc: "Change a published SOAP web service: add or replace operations (same fields as publishWebService), remove operations, namespace, authentication, description, validate.",
        fields: {
            service: "R Module.Service", operations: "optional operations to add, or to replace when an operation has that name: " + OPERATION_FIELDS, remove: "optional [ \"OperationName\" ]",
            namespace: "optional", authentication: "optional None | UsernamePassword | Custom", headerMicroflow: "optional", description: "optional", validate: "optional true/false"
        }
    },
    updateConsumedWebService: {
        doc: "Compare a consumed SOAP web service with a new WSDL: lists added and removed operations and the 'Call web service' actions that use them, then refuses with the Studio Pro steps (Studio Pro imports the WSDL).",
        fields: { service: "R Module.Service", wsdl: "R path of the new .wsdl file" }
    }
};

const SERVICE_SYNONYMS = {
    createBusinessEventService: { messages: "the events go in \"events\"" },
    changeBusinessEventService: { events: "use \"addEvents\" / \"removeEvents\"", name: "the service goes in \"service\": Module.Name" },
    publishWebService: { microflows: "the microflows go in \"operations\"" },
    changeWebService: { removeOperations: "use \"remove\": [ \"OperationName\" ]", name: "the service goes in \"service\": Module.Name" },
    updateConsumedWebService: { file: "the new WSDL goes in \"wsdl\"" }
};

function makeServices(h) {
    const { model, get, exists, folder, version } = h;
    const atLeast = v => cmp(version, v) >= 0;
    const warn = w => h.client && h.client.warn(w);
    const firstUse = (type, qn) => warn(`${type} by ops (no Studio Pro sample in the test projects): check ${qn} in Studio Pro`);

    // ------------------------------------------------ business events

    async function eventService(qn, where) {
        const all = () => model.allBusinessEventServices().map(x => x.qualifiedName);
        const s = await get(qn).catch(() => fail(`${where}: no business event service ${qn}`, qn, all()));
        if (!(s instanceof be.BusinessEventService)) throw new Error(`${where}: '${qn}' is not a business event service`);
        if (!s.definition) throw new Error(`${where}: ${qn} is consumed from another app (its contract is an AsyncAPI document) and is not supported. In Studio Pro: open ${qn}, click Update (or import the new AsyncAPI file), then fix the consumed event entities and handlers it lists.`);
        return s;
    }

    function attributeTypeIn(ma, type, where) {
        const t = EVENT_TYPES.find(x => x.toLowerCase() === String(type).toLowerCase());
        if (!t) fail(`${where}: type '${type}' (event attributes are ${EVENT_TYPES.join(" | ")})`, type, EVENT_TYPES);
        const cls = { String: dm.StringAttributeType, Integer: dm.IntegerAttributeType, Long: dm.LongAttributeType, Decimal: dm.DecimalAttributeType, Boolean: dm.BooleanAttributeType, DateTime: dm.DateTimeAttributeType }[t];
        const at = cls.createInMessageAttributeUnderAttributeType(ma);
        if (t === "String") at.length = 0;
        return t;
    }

    function addAttributes(msg, attrs, where) {
        if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) throw new Error(`${where}: attributes is { "Attr": "String", ... }`);
        const out = [];
        for (const [n, t] of Object.entries(attrs)) {
            validName(n, "event attribute name");
            if (msg.attributes.some(a => a.attributeName === n)) throw new Error(`${where}: ${msg.messageName} already has attribute '${n}'`);
            if (!EVENT_TYPES.some(x => x.toLowerCase() === String(t).toLowerCase())) fail(`${where}: type '${t}' of ${n} (event attributes are ${EVENT_TYPES.join(" | ")})`, t, EVENT_TYPES);
            const ma = be.MessageAttribute.createIn(msg);
            ma.attributeName = n;
            out.push(`${n} ${attributeTypeIn(ma, t, where)}`);
        }
        return out;
    }

    const EVENT_KEYS = ["name", "attributes", "description", "publish", "subscribe"];
    function addEvent(def, spec, where) {
        if (!spec || typeof spec !== "object") throw new Error(`${where}: an event is ${EVENT_FIELDS}`);
        for (const k of Object.keys(spec)) if (!EVENT_KEYS.includes(k)) fail(`${where}: unknown event field '${k}'`, k, EVENT_KEYS);
        validName(spec.name, "event name");
        if (allMessages(def).some(m => m.messageName === spec.name)) throw new Error(`${where}: event '${spec.name}' already exists`);
        const ch = be.Channel.createIn(def);
        ch.channelName = crypto.randomBytes(16).toString("hex");
        const msg = be.Message.createIn(ch);
        msg.messageName = spec.name;
        msg.description = String(spec.description || "");
        msg.canPublish = bool(spec.publish, true);
        msg.canSubscribe = bool(spec.subscribe, true);
        const attrs = addAttributes(msg, spec.attributes || {}, `${where} ${spec.name}`);
        if (!attrs.length) throw new Error(`${where}: event ${spec.name} needs at least one attribute`);
        return `event ${spec.name} (${attrs.join(", ")})`;
    }

    const allMessages = def => def.channels.flatMap(c => [...c.messages]);
    function messageOf(def, name, where) {
        const m = allMessages(def).find(x => x.messageName === name);
        if (!m) fail(`${where}: no event '${name}'`, name, allMessages(def).map(x => x.messageName));
        return m;
    }

    // ------------------------------------------------ published web services

    const PRIMITIVE = [datatypes.StringType, datatypes.IntegerType, datatypes.DecimalType, datatypes.BooleanType, datatypes.DateTimeType, datatypes.EnumerationType];

    // A data entity of an object or list type: the entity with all its attributes.
    async function dataEntityFor(de, type, where) {
        if (!(type instanceof datatypes.ObjectType || type instanceof datatypes.ListType)) return "";
        const ent = await h.entity(type.entityQualifiedName).catch(() => {
            throw new Error(`${where}: ${type.entityQualifiedName} is not an entity of this project; publish it in Studio Pro`);
        });
        await h.loadParents(ent);
        de.entity = ent;
        de.exposedName = ent.name;
        de.exposedItemName = ent.name;
        const attrs = h.attributeChain(ent).attributes;
        for (const a of attrs) {
            const da = ws.DataAttribute.createIn(de);
            da.attribute = a;
            da.exposedName = a.name;
            da.isNillable = true;
        }
        return ` ${type instanceof datatypes.ListType ? "list of " : ""}${ent.name} (${attrs.length} attribute(s))`;
    }

    // A copy of a microflow data type (the operation keeps its own).
    function copyType(t) {
        const c = t.constructor.create(model);
        if (t instanceof datatypes.ObjectType || t instanceof datatypes.ListType) c.__entity.updateWithRawValue(t.entityQualifiedName);
        if (t instanceof datatypes.EnumerationType) c.__enumeration.updateWithRawValue(t.enumerationQualifiedName);
        return c;
    }

    const OP_KEYS = ["microflow", "name", "description", "optional"];
    async function addOperation(vs, raw, where) {
        const spec = typeof raw === "string" ? { microflow: raw } : raw;
        if (!spec || !spec.microflow) throw new Error(`${where}: an operation is ${OPERATION_FIELDS}`);
        for (const k of Object.keys(spec)) if (!OP_KEYS.includes(k)) fail(`${where}: unknown operation field '${k}'`, k, OP_KEYS);
        const m = await get(spec.microflow).catch(() => fail(`${where}: no microflow ${spec.microflow}`, spec.microflow, model.allMicroflows().map(x => x.qualifiedName)));
        if (!(m instanceof mf.Microflow)) throw new Error(`${where}: ${spec.microflow} is not a microflow`);
        const name = spec.name || m.name;
        validName(name, "operation name");
        if (vs.operations.some(o => o.name === name)) throw new Error(`${where}: operation '${name}' already exists`);
        const op = ws.PublishedOperation.createIn(vs);
        op.name = name;
        op.microflow = m;
        op.description = String(spec.description || "");
        const ok = t => PRIMITIVE.some(c => t instanceof c) || t instanceof datatypes.ObjectType || t instanceof datatypes.ListType || t instanceof datatypes.VoidType;
        const params = m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject);
        const optional = [].concat(spec.optional || []);
        for (const n of optional) if (!params.some(p => p.name === n)) fail(`${where}: ${spec.microflow} has no parameter '${n}'`, n, params.map(p => p.name));
        const parts = [];
        for (const p of params) {
            if (!ok(p.variableType)) throw new Error(`${where}: parameter ${p.name} of ${spec.microflow} is ${p.variableType.structureTypeName.split("$")[1]}, which a web service cannot take`);
            const pp = ws.PublishedParameter.createIn(op);
            pp.parameter = p;
            pp.parameterType = copyType(p.variableType);
            pp.isOptional = optional.includes(p.name);
            pp.isNillable = true;
            const de = ws.DataEntity.createInPublishedParameterUnderDataEntity(pp);
            parts.push(`${p.name}${await dataEntityFor(de, p.variableType, where)}`);
        }
        const rt = m.microflowReturnType;
        if (!ok(rt)) throw new Error(`${where}: ${spec.microflow} returns ${rt.structureTypeName.split("$")[1]}, which a web service cannot return`);
        op.operationReturnType = copyType(rt);
        op.returnTypeIsNillable = true;
        const de = ws.DataEntity.createInPublishedResourceUnderDataEntity(op);
        const ret = await dataEntityFor(de, rt, where);
        return `operation ${name} (${parts.join(", ") || "no parameters"})${rt instanceof datatypes.VoidType ? "" : ` -> ${ret.trim() || rt.structureTypeName.split("$")[1].replace("Type", "")}`}`;
    }

    async function serviceSettings(vs, o, where) {
        const lines = [];
        // check first: a refused change leaves the service as it was
        const auth = o.authentication === undefined ? vs.headerAuthentication : enumValue(ws.HeaderAuthentication, o.authentication, "authentication");
        if (auth === ws.HeaderAuthentication.Custom && !vs.headerMicroflow && o.headerMicroflow === undefined) throw new Error(`${where}: authentication Custom needs "headerMicroflow": "Module.Microflow"`);
        if (o.namespace !== undefined) (vs.targetNamespace = String(o.namespace)), lines.push(`namespace ${vs.targetNamespace}`);
        if (o.description !== undefined) vs.description = String(o.description);
        if (o.validate !== undefined) vs.validate = bool(o.validate, false);
        if (o.authentication !== undefined) {
            vs.headerAuthentication = enumValue(ws.HeaderAuthentication, o.authentication, "authentication");
            lines.push(`authentication ${vs.headerAuthentication.name}`);
        }
        if (o.headerMicroflow !== undefined) {
            const m = await get(o.headerMicroflow);
            if (!(m instanceof mf.Microflow)) throw new Error(`${where}: ${o.headerMicroflow} is not a microflow`);
            vs.headerMicroflow = m;
        }
        return lines;
    }

    async function webService(qn, where) {
        const all = () => model.allPublishedWebServices().map(x => x.qualifiedName);
        const s = await get(qn).catch(() => fail(`${where}: no published web service ${qn}`, qn, all()));
        if (!(s instanceof ws.PublishedWebService)) throw new Error(`${where}: '${qn}' is not a published web service`);
        if (s.versionedServices.length !== 1) throw new Error(`${where}: ${qn} has ${s.versionedServices.length} versions; change it in Studio Pro`);
        return s;
    }

    // ------------------------------------------------ consumed web services: WSDL operations

    // Operation names of a WSDL text (the portType operations; binding operations when there is no portType).
    function wsdlOperations(text) {
        const ops = new Set();
        const body = String(text).replace(/<!--[\s\S]*?-->/g, "");
        const section = /<(?:\w+:)?portType\b[\s\S]*?<\/(?:\w+:)?portType>/g;
        let m;
        let found = false;
        while ((m = section.exec(body))) {
            found = true;
            for (const op of m[0].matchAll(/<(?:\w+:)?operation\b[^>]*\bname\s*=\s*["']([^"']+)["']/g)) ops.add(op[1]);
        }
        if (!found) for (const op of body.matchAll(/<(?:\w+:)?operation\b[^>]*\bname\s*=\s*["']([^"']+)["']/g)) ops.add(op[1]);
        return [...ops];
    }

    // Call web service actions per operation name: { op: [ "Module.Flow" ] }
    async function webServiceCalls(qn) {
        const out = {};
        for (const m of model.allMicroflows()) {
            const ml = m.isLoaded ? m : await m.load();
            for (const x of ml.objectCollection.objects) {
                const a = x instanceof mf.ActionActivity ? x.action : null;
                if (!(a instanceof mf.WebServiceCallAction) || a.importedWebServiceQualifiedName !== qn) continue;
                (out[a.operationName] = out[a.operationName] || []).push(ml.qualifiedName);
            }
        }
        return out;
    }

    const impl = {
        async createBusinessEventService(o) {
            validName(o.name, "service name");
            const qn = `${o.module}.${o.name}`;
            const where = `createBusinessEventService ${qn}`;
            if (!atLeast("10.0.0")) throw new Error(`${where}: business event services of this kind need Mendix 10 (this project is ${version}); define them in Studio Pro`);
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            if (!Array.isArray(o.events) || !o.events.length) throw new Error(`${where}: events is ${EVENT_FIELDS}`);
            const s = be.BusinessEventService.createIn(folder(o.module, o.folder));
            s.name = o.name;
            const def = be.BusinessEventDefinition.createIn(s);
            def.serviceName = o.serviceName || o.name;
            def.eventNamePrefix = String(o.eventNamePrefix || "");
            def.summary = String(o.summary || "");
            def.description = String(o.description || "");
            const lines = o.events.map((e, i) => addEvent(def, e, `${where} event ${i + 1}`));
            firstUse("BusinessEvents$BusinessEventService", qn);
            warn(`${qn}: to publish or subscribe, open it in Studio Pro (needs the Business Events module from the Marketplace): it makes the event entities`);
            return qn + lines.map(l => "\n      " + l).join("");
        },
        async changeBusinessEventService(o) {
            const where = `changeBusinessEventService ${o.service}`;
            const s = await eventService(o.service, where);
            const def = s.definition;
            const lines = [];
            const implemented = name => s.operationImplementations.filter(x => x.messageName === name);
            if (["addEvents", "removeEvents", "addAttributes", "removeAttributes", "summary", "description"].every(k => o[k] === undefined)) throw new Error(`${where}: nothing to change`);
            for (const n of [].concat(o.removeEvents || [])) {
                const msg = messageOf(def, n, where);
                const impls = implemented(n);
                if (impls.length && !bool(o.force, false)) throw new Error(`${where}: this app implements event ${n} (${impls.map(x => `${x.operation} ${x.entityQualifiedName}`).join(", ")}); remove the implementation in Studio Pro first, or add "force": true`);
                const ch = msg.containerAsChannel;
                msg.delete();
                if (!ch.messages.length) ch.delete();
                lines.push(`removed event ${n}${impls.length ? ` (implemented by ${impls.map(x => x.entityQualifiedName).join(", ")}: fix it in Studio Pro)` : ""}`);
            }
            for (const [i, e] of [].concat(o.addEvents || []).entries()) lines.push(addEvent(def, e, `${where} event ${i + 1}`));
            for (const [n, attrs] of Object.entries(o.removeAttributes || {})) {
                const msg = messageOf(def, n, where);
                for (const a of [].concat(attrs)) {
                    const ma = msg.attributes.find(x => x.attributeName === a);
                    if (!ma) fail(`${where}: event ${n} has no attribute '${a}'`, a, msg.attributes.map(x => x.attributeName));
                    ma.delete();
                }
                if (!msg.attributes.length) throw new Error(`${where}: event ${n} would have no attributes; remove the event instead`);
                lines.push(`event ${n}: removed ${[].concat(attrs).join(", ")}`);
            }
            for (const [n, attrs] of Object.entries(o.addAttributes || {})) {
                const msg = messageOf(def, n, where);
                lines.push(`event ${n}: added ${addAttributes(msg, attrs, `${where} ${n}`).join(", ")}`);
            }
            if (o.summary !== undefined) def.summary = String(o.summary);
            if (o.description !== undefined) def.description = String(o.description);
            const touched = new Set([...Object.keys(o.addAttributes || {}), ...Object.keys(o.removeAttributes || {})]);
            for (const n of touched) for (const x of implemented(n)) lines.push(`  bring ${x.entityQualifiedName} (${x.operation}) in step with event ${n}: open ${o.service} in Studio Pro`);
            firstUse("BusinessEvents$BusinessEventService", o.service);
            return o.service + lines.map(l => "\n      " + l).join("");
        },
        async publishWebService(o) {
            validName(o.name, "service name");
            const qn = `${o.module}.${o.name}`;
            const where = `publishWebService ${qn}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            if (!Array.isArray(o.operations) || !o.operations.length) throw new Error(`${where}: operations is ${OPERATION_FIELDS}`);
            const s = ws.PublishedWebService.createIn(folder(o.module, o.folder));
            s.name = o.name;
            const vs = ws.VersionedService.createIn(s);
            vs.versionNumber = 1;
            vs.caption = o.name;
            vs.targetNamespace = "http://www.example.com/";
            vs.headerAuthentication = ws.HeaderAuthentication.UsernamePassword;
            const lines = await serviceSettings(vs, { authentication: "UsernamePassword", ...o }, where);
            for (const [i, raw] of o.operations.entries()) lines.push(await addOperation(vs, raw, `${where} operation ${i + 1}`));
            firstUse("WebServices$PublishedWebService", qn);
            return qn + lines.map(l => "\n      " + l).join("");
        },
        async changeWebService(o) {
            const where = `changeWebService ${o.service}`;
            const s = await webService(o.service, where);
            const vs = s.versionedServices[0];
            if (["operations", "remove", "namespace", "authentication", "headerMicroflow", "description", "validate"].every(k => o[k] === undefined)) throw new Error(`${where}: nothing to change`);
            const lines = [];
            const specs = [].concat(o.operations || []).map(x => (typeof x === "string" ? { microflow: x } : x));
            for (const n of [].concat(o.remove || [])) {
                const op = vs.operations.find(x => x.name === n);
                if (!op) fail(`${where}: no operation '${n}'`, n, vs.operations.map(x => x.name));
                op.delete();
                lines.push(`removed operation ${n}`);
            }
            for (const [i, spec] of specs.entries()) {
                const name = spec && (spec.name || String(spec.microflow || "").split(".").pop());
                const old = vs.operations.find(x => x.name === name);
                if (old) old.delete();
                lines.push((old ? "replaced " : "") + (await addOperation(vs, spec, `${where} operation ${i + 1}`)));
            }
            lines.push(...(await serviceSettings(vs, o, where)));
            if (!vs.operations.length) throw new Error(`${where}: no operation would be left; delete the service instead: { "op": "delete", "target": "${o.service}" }`);
            firstUse("WebServices$PublishedWebService", o.service);
            return `${o.service} (${vs.operations.length} operation(s))` + lines.map(l => "\n      " + l).join("");
        },
        async updateConsumedWebService(o) {
            const where = `updateConsumedWebService ${o.service}`;
            const all = () => model.allImportedWebServices().map(x => x.qualifiedName);
            const s = await get(o.service).catch(() => fail(`${where}: no consumed web service ${o.service}`, o.service, all()));
            if (!(s instanceof ws.ImportedWebService)) throw new Error(`${where}: '${o.service}' is not a consumed web service`);
            const file = [o.wsdl, path.resolve(o.wsdl)].find(f => fs.existsSync(f));
            if (!file) throw new Error(`${where}: WSDL file ${o.wsdl} not found`);
            const now = wsdlOperations(fs.readFileSync(file, "utf8"));
            if (!now.length) throw new Error(`${where}: ${o.wsdl} has no operations (is it a WSDL?)`);
            const before = s.wsdlDescription ? s.wsdlDescription.services.flatMap(x => x.operations.map(y => y.name)) : [];
            const calls = await webServiceCalls(s.qualifiedName);
            const added = now.filter(x => !before.includes(x));
            const removed = before.filter(x => !now.includes(x));
            const lines = [`operations now ${before.length}, in the new WSDL ${now.length}`];
            if (added.length) lines.push(`added: ${added.join(", ")}`);
            if (removed.length) lines.push(`removed: ${removed.join(", ")}` + (removed.some(r => calls[r]) ? `; Call web service actions to change: ${removed.filter(r => calls[r]).map(r => `${r} in ${calls[r].join(", ")}`).join("; ")}` : ""));
            const kept = before.filter(x => now.includes(x) && calls[x]);
            if (kept.length) lines.push(`check the mappings of: ${kept.map(r => `${r} (${calls[r].join(", ")})`).join("; ")}`);
            throw new Error(`updateConsumedWebService is not supported. ${lines.join(". ")}. A consumed web service is imported by Studio Pro (WSDL, its schemas, every operation's messages). In Studio Pro: open ${o.service}, click Update from file (or URL) with the new WSDL, then fix the Call web service actions and mappings listed above. Record it with: mx.py gap "updateConsumedWebService"`);
        }
    };

    const checks = {
        async createBusinessEventService(o) {
            const s = await get(`${o.module}.${o.name}`).catch(() => null);
            if (!(s instanceof be.BusinessEventService) || !s.definition) return [`${o.module}.${o.name} is not a business event service`];
            const have = allMessages(s.definition).map(m => m.messageName);
            return o.events.filter(e => !have.includes(e.name)).map(e => `${o.module}.${o.name} lacks event ${e.name}`);
        },
        async changeBusinessEventService(o) {
            const s = await get(o.service);
            const msgs = allMessages(s.definition);
            const r = [];
            for (const n of [].concat(o.removeEvents || [])) if (msgs.some(m => m.messageName === n)) r.push(`${o.service} still has event ${n}`);
            for (const e of [].concat(o.addEvents || [])) if (!msgs.some(m => m.messageName === e.name)) r.push(`${o.service} lacks event ${e.name}`);
            for (const [n, attrs] of Object.entries(o.addAttributes || {})) {
                const m = msgs.find(x => x.messageName === n);
                for (const a of Object.keys(attrs)) if (!m || !m.attributes.some(x => x.attributeName === a)) r.push(`event ${n} lacks ${a}`);
            }
            for (const [n, attrs] of Object.entries(o.removeAttributes || {})) {
                const m = msgs.find(x => x.messageName === n);
                for (const a of [].concat(attrs)) if (m && m.attributes.some(x => x.attributeName === a)) r.push(`event ${n} still has ${a}`);
            }
            return r;
        },
        async publishWebService(o) {
            const s = await get(`${o.module}.${o.name}`).catch(() => null);
            if (!(s instanceof ws.PublishedWebService)) return [`${o.module}.${o.name} is not a published web service`];
            const have = s.versionedServices[0].operations.map(x => x.name);
            return o.operations.map(x => (typeof x === "string" ? x.split(".").pop() : x.name || x.microflow.split(".").pop())).filter(n => !have.includes(n)).map(n => `${o.module}.${o.name} lacks operation ${n}`);
        },
        async changeWebService(o) {
            const s = await get(o.service);
            const have = s.versionedServices[0].operations.map(x => x.name);
            const r = [].concat(o.remove || []).filter(n => have.includes(n) && ![].concat(o.operations || []).some(x => (typeof x === "string" ? x.split(".").pop() : x.name || x.microflow.split(".").pop()) === n)).map(n => `${o.service} still has operation ${n}`);
            for (const x of [].concat(o.operations || [])) {
                const n = typeof x === "string" ? x.split(".").pop() : x.name || x.microflow.split(".").pop();
                if (!have.includes(n)) r.push(`${o.service} lacks operation ${n}`);
            }
            return r;
        },
        async updateConsumedWebService() {
            return [];
        }
    };

    return { impl, checks, wsdlOperations };
}

// checkPlan: a later op of the plan that changes what this op made (only the final state is checked).
function servicesChangedLater(name, o, rest) {
    const qn = o.module && o.name ? `${o.module}.${o.name}` : o.service;
    if (name === "createBusinessEventService" || name === "changeBusinessEventService") return rest.some(x => x.op === "changeBusinessEventService" && x.service === qn);
    if (name === "publishWebService" || name === "changeWebService") return rest.some(x => x.op === "changeWebService" && x.service === qn);
    return false;
}

module.exports = { makeServices, SERVICE_OPS, SERVICE_SYNONYMS, servicesChangedLater };
