"use strict";
// selftest phases for the app documents of ops-docs.js (regular expressions, task queues, ...). No test project has
// a Studio Pro-saved sample of these types, so each phase checks (with selftest-integ.js runPhase) that every op shows
// after a reload, the new units reopen with 0 errors and 0 deltas and roundtrip byte for byte, refusals change
// nothing, and the stored BSON has the shape the ops promise.
const { unitsNamed, walk } = require("./selftest-integ");
const { cmp } = require("./versions");

// ---------------------------------------------------------------- regular expressions and task queues

function regexQueuePlan(mod, T) {
    const E = `${mod}.${T}`;
    return {
        ops: [
            { op: "createRegularExpression", module: mod, name: `${T}_Zip`, folder: "ZzDocs", pattern: "^[0-9]{4} ?[A-Z]{2}$", examples: { valid: ["1234 AB", "1234AB"], invalid: ["12345"] } },
            { op: "createRegularExpression", module: mod, name: `${T}_Ci`, folder: "ZzDocs", pattern: "(?i)^[a-z]+$" },
            { op: "createEntity", module: mod, name: `${T}DocAddr`, attributes: [{ name: "Zip", type: "String(10)" }, { name: "Code", type: "String(10)" }] },
            { op: "addValidationRule", entity: `${E}DocAddr`, attribute: "Zip", rule: "regex", regex: `${E}_Zip`, message: "Postcode like 1234 AB" },
            { op: "changeRegularExpression", regularExpression: `${E}_Zip`, pattern: "^[0-9]{4}[A-Z]{2}$", examples: { valid: ["1234AB"] } },
            { op: "createTaskQueue", module: mod, name: `${T}_Queue`, folder: "ZzDocs", threads: 3, scope: "cluster" },
            { op: "createTaskQueue", module: mod, name: `${T}_Queue2`, folder: "ZzDocs" },
            { op: "createMicroflow", module: mod, name: `${T}_QWork`, folder: "ZzDocs", parameters: [{ name: "Addr", type: `${E}DocAddr` }], actions: [{ action: "commit", variable: "Addr" }] },
            { op: "createMicroflow", module: mod, name: `${T}_QEnqueue`, folder: "ZzDocs", parameters: [{ name: "Addr", type: `${E}DocAddr` }], actions: [
                { action: "call", microflow: `${E}_QWork`, args: { Addr: "$Addr" }, queue: `${E}_Queue`, retry: { retries: 2, initialInterval: 5, maximumInterval: 60 } },
                { action: "call", microflow: `${E}_QWork`, args: { Addr: "$Addr" } }] },
            { op: "changeTaskQueue", queue: `${E}_Queue`, threads: 2 }
        ],
        reject: [
            { op: { op: "createRegularExpression", module: mod, name: `${T}_Bad`, pattern: "^[0-9]{4" }, expect: /is not a valid regular expression/ },
            { op: { op: "createRegularExpression", module: mod, name: `${T}_Bad`, pattern: "^[0-9]+$", examples: { valid: ["12a"] } }, expect: /"12a" does not match but is in valid/ },
            { op: { op: "createRegularExpression", module: mod, name: `${T}_Bad`, regex: "^a$" }, expect: /unknown field 'regex'.*pattern/ },
            { op: { op: "addValidationRule", entity: `${E}DocAddr`, attribute: "Code", rule: "regex", regex: "^[A-Z]+$", message: "x" }, expect: /looks like a pattern.*createRegularExpression/ },
            { op: { op: "addValidationRule", entity: `${E}DocAddr`, attribute: "Code", rule: "regex", regex: `${E}_Zp`, message: "x" }, expect: /Did you mean: .*_Zip/ },
            { op: { op: "changeRegularExpression", regularExpression: `${E}_Zipp`, pattern: "^a$" }, expect: /Did you mean: .*_Zip/ },
            { op: { op: "createTaskQueue", module: mod, name: `${T}_QBad`, threads: 0 }, expect: /whole number of at least 1/ },
            { op: { op: "createTaskQueue", module: mod, name: `${T}_QBad`, scope: "global" }, expect: /scope 'global' is node or cluster/ },
            { op: { op: "changeTaskQueue", queue: `${E}_Queu`, threads: 2 }, expect: /Did you mean: .*_Queue/ },
            { op: { op: "createMicroflow", module: mod, name: `${T}_QBad`, parameters: [{ name: "Addr", type: `${E}DocAddr` }], actions: [{ action: "call", microflow: `${E}_QWork`, args: { Addr: "$Addr" }, queue: `${E}_Queue`, variable: "R" }] }, expect: /returns nothing here; drop "variable"/ },
            { op: { op: "createMicroflow", module: mod, name: `${T}_QBad2`, parameters: [{ name: "Addr", type: `${E}DocAddr` }], actions: [{ action: "call", microflow: `${E}_QWork`, args: { Addr: "$Addr" }, queue: `${E}_Queue`, retry: { retries: 2, every: 3 } }] }, expect: /unknown retry field 'every'/ }
        ],
        // changeAction: the second call goes into the second queue with a fixed retry, the first one out of its queue
        probe: async ops => {
            const steps = (await ops.steps(`${E}_QEnqueue`)).split("\n").filter(l => /call/i.test(l)).map(l => (/\[?([0-9a-f]{8})\]?/.exec(l) || [])[1]).filter(Boolean);
            if (steps.length !== 2) return [`steps of ${E}_QEnqueue: ${steps.length} calls found`];
            const r = await ops.runPlan({ ops: [
                { op: "changeAction", microflow: `${E}_QEnqueue`, id: steps[1], queue: `${E}_Queue2`, retry: { retries: 4, interval: 2, unit: "Minutes" } },
                { op: "changeAction", microflow: `${E}_QEnqueue`, id: steps[0], queue: "none" }
            ] }, () => {});
            return r;
        }
    };
}

function regexQueueProblems(project, T, version) {
    const r = [];
    const u = unitsNamed(project, `${T}_`);
    const zip = u[`${T}_Zip`];
    if (!zip || zip.$Type !== "RegularExpressions$RegularExpression" || zip.RegEx !== "^[0-9]{4}[A-Z]{2}$") r.push(`regular expression ${T}_Zip: ${zip ? zip.RegEx : "missing"}`);
    if (!u[`${T}_Ci`] || u[`${T}_Ci`].RegEx !== "(?i)^[a-z]+$") r.push("Java-only pattern (?i) not stored");
    let rule = null;
    for (const id of project.units.keys()) {
        const x = project.read(id);
        if (x.$Type === "DomainModels$DomainModel") walk(x, o => o.$Type === "DomainModels$RegExRuleInfo" && /_Zip$/.test(o.RegExIdentifier || "") && (rule = o));
    }
    if (!rule) r.push("no validation rule with the regular expression (RegExIdentifier)");
    const q = u[`${T}_Queue`];
    if (!q || q.$Type !== "Queues$Queue" || !q.Config || q.Config.$Type !== "Queues$BasicQueueConfig") r.push("task queue missing");
    else {
        if (cmp(version, "9.12.0") >= 0 && q.Config.ParallelismExpression !== "2") r.push(`queue threads ${q.Config.ParallelismExpression}`);
        if (cmp(version, "9.13.0") >= 0 && q.Config.ClusterWide !== true) r.push("queue is not cluster wide");
    }
    const f = u[`${T}_QEnqueue`];
    const settings = [];
    if (f) walk(f, o => o.$Type === "Queues$QueueSettings" && settings.push(o));
    if (settings.length !== 1) r.push(`${settings.length} queued calls in ${T}_QEnqueue (expected 1 after changeAction)`);
    else {
        const s = settings[0];
        if (!/_Queue2$/.test(s.Queue || "")) r.push(`queued call in ${s.Queue}`);
        if (!s.Retry || s.Retry.$Type !== "Queues$QueueFixedRetry" || s.Retry.Retries !== 4 || s.Retry.Interval !== 2 || s.Retry.IntervalType !== "Minutes") r.push(`retry ${JSON.stringify(s.Retry && { t: s.Retry.$Type, n: s.Retry.Retries, i: s.Retry.Interval, u: s.Retry.IntervalType })}`);
    }
    return r;
}

module.exports = { regexQueuePlan, regexQueueProblems };

// ---------------------------------------------------------------- published OData: change part of an entity

function odataChangePlan(mod, T, version) {
    const E = `${mod}.${T}`;
    if (cmp(version, "10.4.0") < 0) return { ops: [{ op: "createModuleRole", module: mod, name: "ZzDocOdNone" }] };
    return {
        ops: [
            { op: "createEntity", module: mod, name: `${T}DocOdA`, attributes: [{ name: "Code", type: "String(20)" }, { name: "Qty", type: "Integer" }, { name: "Note", type: "String(200)" }] },
            { op: "createMicroflow", module: mod, name: `${T}_DocOdIns`, folder: "ZzDocs", parameters: [{ name: "A", type: `${E}DocOdA` }], actions: [{ action: "commit", variable: "A" }] },
            { op: "publishOData", module: mod, name: `${T}_DocOd`, folder: "ZzDocs", entities: [{ entity: `${E}DocOdA`, attributes: ["Code", "Qty"], pageSize: 100, update: true }] },
            { op: "changePublishedOData", service: `${E}_DocOd`, change: [{ entity: `${E}DocOdA`, addAttributes: ["Note"], removeAttributes: ["Qty"], insert: `${E}_DocOdIns`, pageSize: null, count: false }] }
        ],
        reject: [
            { op: { op: "changePublishedOData", service: `${E}_DocOd`, change: [{ entity: `${E}DocOdA`, removeAttributes: ["Notee"] }] }, expect: /does not publish attribute 'Notee'.*Did you mean: Note/ },
            { op: { op: "changePublishedOData", service: `${E}_DocOd`, change: [{ entity: `${E}DocOdA`, addAttributes: ["Code"] }] }, expect: /already publishes 'Code'/ },
            { op: { op: "changePublishedOData", service: `${E}_DocOd`, change: [{ entity: `${E}DocOdB` }] }, expect: /is not published in .*add it with "entities"/ },
            { op: { op: "changePublishedOData", service: `${E}_DocOd`, change: [{ entity: `${E}DocOdA`, insrt: true }] }, expect: /unknown change field 'insrt'.*Did you mean: insert/ }
        ]
    };
}

function odataChangeProblems(project, T, version) {
    if (cmp(version, "10.4.0") < 0) return [];
    const s = unitsNamed(project, `${T}_`)[`${T}_DocOd`];
    if (!s) return ["published OData service missing"];
    const r = [];
    const t = s.EntityTypes[0];
    const attrs = t.ChildMembers.filter(m => m.$Type === "ODataPublish$PublishedAttribute").map(m => m.Attribute.split(".").pop());
    if (attrs.join(",") !== "Code,Note") r.push(`published attributes ${attrs.join(",")}`);
    const set = s.EntitySets[0];
    if (!set || set.InsertMode.$Type !== "ODataPublish$CallMicroflowToChange" || set.UpdateMode.$Type !== "ODataPublish$ChangeSource" || set.UsePaging !== false || set.QueryOptions.Countable !== false) r.push("entity set capabilities after change");
    return r;
}

// ---------------------------------------------------------------- business events, published / consumed web services

const WSDL = `<?xml version="1.0"?>
<definitions name="Orders" targetNamespace="urn:zz" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:zz">
  <portType name="OrdersPort">
    <operation name="GetOrder"/>
    <!-- <operation name="Commented"/> -->
    <operation name="CancelOrder"/>
  </portType>
</definitions>`;

function servicesPlan(mod, T, version, dir) {
    const E = `${mod}.${T}`;
    const wsdl = require("path").join(dir, "zz-orders.wsdl");
    require("fs").writeFileSync(wsdl, WSDL);
    const be = cmp(version, "10.0.0") >= 0;
    return {
        refuse: [{ op: "createBusinessEvent", module: mod }],
        ops: [
            ...(be ? [
                { op: "createBusinessEventService", module: mod, name: `${T}_Events`, folder: "ZzDocs", summary: "Order events", events: [
                    { name: "OrderPlaced", attributes: { OrderId: "String", Total: "Decimal", Placed: "DateTime" } },
                    { name: "OrderCancelled", attributes: { OrderId: "String", Reason: "String" }, subscribe: false }] },
                { op: "changeBusinessEventService", service: `${E}_Events`, addEvents: [{ name: "OrderShipped", attributes: { OrderId: "String", Count: "Integer" } }], removeEvents: ["OrderCancelled"],
                    addAttributes: { OrderPlaced: { Paid: "Boolean" } }, removeAttributes: { OrderPlaced: ["Placed"] } }] : []),
            { op: "createEntity", module: mod, name: `${T}DocWs`, attributes: [{ name: "Number", type: "String(20)" }, { name: "Total", type: "Decimal" }] },
            { op: "createMicroflow", module: mod, name: `${T}_WsGet`, folder: "ZzDocs", parameters: [{ name: "Number", type: "String" }], returns: `${E}DocWs`, returnValue: "$Order", actions: [
                { action: "retrieve", variable: "Order", entity: `${E}DocWs`, xpath: "[Number = $Number]", first: true }] },
            { op: "createMicroflow", module: mod, name: `${T}_WsList`, folder: "ZzDocs", parameters: [{ name: "Max", type: "Integer" }], returns: `List(${E}DocWs)`, returnValue: "$List", actions: [
                { action: "retrieve", variable: "List", entity: `${E}DocWs` }] },
            { op: "createMicroflow", module: mod, name: `${T}_WsCount`, folder: "ZzDocs", returns: "Integer", returnValue: "1", actions: [] },
            { op: "publishWebService", module: mod, name: `${T}_Ws`, folder: "ZzDocs", namespace: "urn:zz", operations: [`${E}_WsGet`, { microflow: `${E}_WsList`, name: "ListOrders", optional: ["Max"] }] },
            { op: "changeWebService", service: `${E}_Ws`, operations: [`${E}_WsCount`], remove: ["ListOrders"], authentication: "None", validate: true }
        ],
        reject: [
            ...(be ? [
                { op: { op: "changeBusinessEventService", service: `${E}_Events`, removeEvents: ["OrderPlacd"] }, expect: /no event 'OrderPlacd'.*Did you mean: OrderPlaced/ },
                { op: { op: "changeBusinessEventService", service: `${E}_Events`, addAttributes: { OrderPlaced: { Note: "Text" } } }, expect: /type 'Text'/ },
                { op: { op: "changeBusinessEventService", service: `${E}_Events`, addEvents: [{ name: "OrderShipped", attributes: { A: "String" } }] }, expect: /event 'OrderShipped' already exists/ },
                { op: { op: "changeBusinessEventService", service: `${E}_Events`, removeAttributes: { OrderShipped: ["OrderId", "Count"] } }, expect: /would have no attributes/ },
                { op: { op: "changeBusinessEventService", service: `${E}_Evnts`, summary: "x" }, expect: /Did you mean: .*_Events/ },
                { op: { op: "createBusinessEventService", module: mod, name: `${T}_EvBad`, events: [{ name: "E1", attrs: {} }] }, expect: /unknown event field 'attrs'/ }] : []),
            { op: { op: "publishWebService", module: mod, name: `${T}_WsBad`, operations: [{ microflow: `${E}_WsGet`, optional: ["Numbr"] }] }, expect: /has no parameter 'Numbr'.*Did you mean: Number/ },
            { op: { op: "changeWebService", service: `${E}_Ws`, remove: [`${T}_WsGt`] }, expect: /no operation .*_WsGt.*Did you mean: .*_WsGet/ },
            { op: { op: "changeWebService", service: `${E}_Ws`, authentication: "Custom" }, expect: /Custom needs "headerMicroflow"/ },
            { op: { op: "updateConsumedWebService", service: `${E}_Ws`, wsdl }, expect: /is not a consumed web service/ }
        ],
        // a consumed web service (a bare fixture, deleted again before the save) compared with a new WSDL
        probe: async ops => {
            const sdk = require("mendixmodelsdk");
            const { webservices: w, projects } = sdk;
            const m = (await ops.get(`${E}_WsGet`)).model;
            const mod0 = m.allModules().find(x => x.name === mod);
            const iws = w.ImportedWebService.createIn(mod0);
            iws.name = `${T}_WsIn`;
            const d = w.WsdlDescription.createInImportedWebServiceUnderWsdlDescription(iws);
            const si = w.ServiceInfo.createIn(d);
            for (const n of ["GetOrder", "DeleteOrder"]) w.OperationInfo.createIn(si).name = n;
            let msg = "";
            try {
                await ops.runPlan({ ops: [{ op: "updateConsumedWebService", service: `${E}_WsIn`, wsdl }] }, () => {});
            } catch (e) {
                msg = e.message;
            }
            iws.delete();
            void projects;
            return /added: CancelOrder.*removed: DeleteOrder.*In Studio Pro/.test(msg) && !/Commented/.test(msg) ? [] : [`updateConsumedWebService diff: ${msg}`];
        }
    };
}

function servicesProblems(project, T, version) {
    const r = [];
    const u = unitsNamed(project, `${T}_`);
    if (cmp(version, "10.0.0") >= 0) {
        const s = u[`${T}_Events`];
        if (!s || s.$Type !== "BusinessEvents$BusinessEventService" || !s.Definition) r.push("business event service missing");
        else {
            const msgs = [];
            walk(s.Definition, o => o.$Type === "BusinessEvents$Message" && msgs.push(o));
            const names = msgs.map(m => m.MessageName).sort().join(",");
            if (names !== "OrderPlaced,OrderShipped") r.push(`events ${names}`);
            const placed = msgs.find(m => m.MessageName === "OrderPlaced");
            const attrs = placed ? placed.Attributes.map(a => `${a.AttributeName}:${a.AttributeType.$Type.split("$")[1]}`).join(",") : "";
            if (attrs !== "OrderId:StringAttributeType,Total:DecimalAttributeType,Paid:BooleanAttributeType") r.push(`OrderPlaced attributes ${attrs}`);
            if (s.Definition.Channels.length !== 2) r.push(`${s.Definition.Channels.length} channels (one per event)`);
        }
    }
    const w = u[`${T}_Ws`];
    if (!w || !/^WebServices\$Published(Web)?Service$/.test(w.$Type)) r.push(`published web service ${w ? w.$Type : "missing"}`);
    else {
        const vs = w.VersionedServices[0];
        const ops = vs.Operations.map(o => o.Name).sort().join(",");
        if (ops !== "ZzMxlocalTest_WsCount,ZzMxlocalTest_WsGet".replace(/ZzMxlocalTest/g, T)) r.push(`operations ${ops}`);
        if (vs.HeaderAuthentication !== "None" || vs.Validate !== true || vs.TargetNamespace !== "urn:zz") r.push(`service settings ${vs.HeaderAuthentication} ${vs.Validate} ${vs.TargetNamespace}`);
        const get = vs.Operations.find(o => /WsGet$/.test(o.Name));
        if (!get || get.Parameters.length !== 1 || !get.DataEntity || !/DocWs$/.test(get.DataEntity.Entity || "") || get.DataEntity.ChildMembers.length < 2) r.push("WsGet: parameter or returned object");
    }
    if (u[`${T}_WsIn`]) r.push("the consumed web service fixture was not removed");
    return r;
}

// name -> [ plan(mod, T, version, dir), problems(project, T, version) ] (selftest.js runs them in this order)
module.exports.PHASES = {
    "regex/queues": [(mod, T) => regexQueuePlan(mod, T), regexQueueProblems],
    "OData change": [(mod, T, version) => odataChangePlan(mod, T, version), odataChangeProblems],
    services: [servicesPlan, servicesProblems]
};
// name -> what the phase covers (the selftest line)
module.exports.WHAT = {
    "regex/queues": "regular expressions (create with examples, Java-only syntax, change; a validation rule using one), task queues (threads, cluster scope, change), a call in a queue with exponential retry, changeAction moving a call to another queue with a fixed retry and one out of its queue; refusals (bad pattern, failing example, a pattern given as rule regex, did-you-mean names, threads 0, bad scope, queued call with a result variable, unknown retry field)",
    "OData change": "changePublishedOData change: add and remove attributes of a published entity, insert by microflow, paging off, count off, update kept (Mendix 10.4+); refusals (unknown attribute, already published, entity not published, unknown change field)",
    services: "business event service (Mendix 10+: events with attributes, add/remove events and attributes), published web service (object, list and primitive operations, optional parameter; change: add, remove, authentication, validate), consumed web service compared with a new WSDL (added/removed operations, refused with the Studio Pro steps); refusals with did-you-mean"
};
