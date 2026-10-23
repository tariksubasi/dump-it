"use strict";
// selftest phases for the integration and workflow documents (consumed/published REST, OData, XML, message
// definitions, workflows). None of these has a Studio Pro-saved sample in the test projects, so each phase checks what
// can be checked without one: every op shows after a reload, nothing is lost on save, types the project does have keep
// Studio Pro's layout, the new units reopen in the Model SDK with 0 errors and 0 deltas and roundtrip byte for byte,
// and the rules Studio Pro enforces on load or build (as mxcli measured them) hold in the stored BSON.
const bson = require("./bson");
const { lostProperties } = require("./lost");
const { cmp } = require("./versions");

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};

// Units of the project whose Name starts with prefix: { name: plain unit }
function unitsNamed(project, prefix) {
    const out = {};
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (typeof u.Name === "string" && u.Name.startsWith(prefix)) out[u.Name] = u;
    }
    return out;
}

// Runs a plan on session s, saves, reopens and checks. Returns { s (reopened), problems, firstUse }.
async function runPhase(env, s, plan, verify) {
    const { reopen, copy, layout, layoutProblems } = env;
    const problems = [];
    const before = new Set(s.ctx.project.units.keys());
    // ops that must be refused (with the Studio Pro steps) and change nothing
    for (const o of plan.refuse || []) {
        let msg = "";
        try {
            await s.ops.runPlan({ ops: [o] }, () => {});
        } catch (e) {
            msg = e.message;
        }
        if (!/is not supported\. .*In Studio Pro/.test(msg)) problems.push(`${o.op} was not refused with the Studio Pro steps${msg ? `: ${msg}` : ""}`);
    }
    const lint = await s.ops.runPlan(plan, () => {});
    problems.push(...lint);
    await s.model.flushChanges();
    const enc = s.client.encode();
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
    const firstUse = [...new Set(s.client.summary().warnings.filter(w => /first use|never occurs/.test(w)).map(w => w.split(" ")[0]))];
    s.client.project.writeEncoded(enc);
    let s2 = await reopen(copy);
    problems.push(...(await s2.ops.checkPlan(plan)));
    for (const u of s2.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s2.model.loadUnitById(u.id, false).catch(e => problems.push(`reopen: ${e.message}`));
    await s2.model.flushChanges();
    if (s2.client.log.length) problems.push(`${s2.client.log.length} deltas on reopen`);
    let created = 0;
    for (const id of s2.ctx.project.units.keys()) {
        if (before.has(id)) continue;
        created++;
        const b = s2.ctx.project.readBytes(id);
        if (!bson.encode(bson.decode(b)).equals(b)) problems.push(`unit ${id} does not roundtrip byte for byte`);
    }
    problems.push(...verify(s2.ctx.project));
    s2 = await reopen(copy);
    return { s: s2, problems: [...new Set(problems)], created, firstUse };
}

// ---------------------------------------------------------------- REST

function restPlan(mod, T, version) {
    const E = `${mod}.${T}`;
    const v11 = cmp(version, "11.0.0") >= 0;
    return { ops: [
        { op: "createConstant", module: mod, name: `${T}_ApiPwd`, type: "String", default: "secret", folder: "ZzRest" },
        { op: "createConsumedRestService", module: mod, name: `${T}_OrderApi`, folder: "ZzRest", baseUrl: "https://api.example.com/v1/",
            authentication: { username: "api", password: `@${E}_ApiPwd` },
            operations: [
                { name: "GetOrder", path: "/orders/{id}", parameters: { id: "Integer" }, headers: { "X-Trace": "{trace}" },
                    response: { snippet: "{ \"number\": \"A1\", \"total\": 10.5, \"lines\": [ { \"sku\": \"S1\", \"qty\": 2 } ] }", entity: `${E}RestOrder`, entities: { lines: `${E}RestLine` }, keys: ["number"], create: true } },
                { name: "ListOrders", path: "/orders", query: v11 ? { status: {}, page: { required: false } } : ["status"] },
                { name: "CreateOrder", method: "Post", path: "/orders", body: { snippet: "{ \"number\": \"A1\", \"total\": 10.5 }", entity: `${E}RestOrder` } },
                { name: "Ping", method: "Put", path: "/ping/{code}", body: "{ \"code\": \"{code}\" }", timeout: 30 }] },
        { op: "addRestOperation", service: `${E}_OrderApi`, name: "DeleteOrder", method: "Delete", path: "/orders/{id}" },
        { op: "createMicroflow", module: mod, name: `${T}_RestCall`, folder: "ZzRest", parameters: [{ name: "Id", type: "Integer" }], returns: `${E}RestOrder`, returnValue: "$Order", actions: [
            { action: "sendRestRequest", operation: `${E}_OrderApi.GetOrder`, args: { id: "$Id", trace: "'zz'" }, variable: "Order" },
            { action: "sendRestRequest", operation: `${E}_OrderApi.ListOrders`, query: { status: "'open'" } },
            { action: "sendRestRequest", operation: `${E}_OrderApi.CreateOrder`, body: "Order" },
            { action: "sendRestRequest", operation: `${E}_OrderApi.Ping`, args: { code: "toString($Order/Total)" } },
            { action: "log", message: "status {1}", args: ["toString($latestHttpResponse/StatusCode)"] }] },
        { op: "createJsonStructure", module: mod, name: `${T}_RestJson`, folder: "ZzRest", snippet: "{ \"number\": \"A1\", \"total\": 10.5 }" },
        { op: "createImportMapping", module: mod, name: `${T}_RestImm`, folder: "ZzRest", jsonStructure: `${E}_RestJson`, entity: `${E}RestOrder` },
        { op: "createExportMapping", module: mod, name: `${T}_RestExm`, folder: "ZzRest", jsonStructure: `${E}_RestJson`, entity: `${E}RestOrder` },
        { op: "createModuleRole", module: mod, name: "ZzApiUser" },
        { op: "publishRest", module: mod, service: `${T}_Pub`, resource: "orders", method: "Post", path: "{Shop}", microflow: `${E}_PubCreate`, create: true, headers: ["Token"], query: ["Mode"],
            importMapping: `${E}_RestImm`, exportMapping: `${E}_RestExm`, commit: "no", summary: "Create an order", roles: [`${mod}.ZzApiUser`], version: "2.0.0", folder: "ZzRest" },
        { op: "publishRest", module: mod, service: `${T}_Pub`, resource: "orders", method: "Get", path: "{Id}", microflow: `${E}_RestCall`, exportMapping: `${E}_RestExm`, description: "One order" }
    ] };
}

function restProblems(project, T) {
    const r = [];
    const u = unitsNamed(project, `${T}_`);
    const svc = u[`${T}_OrderApi`], flow = u[`${T}_RestCall`], pub = u[`${T}_Pub`];
    if (!svc || svc.$Type !== "Rest$ConsumedRestService") return ["consumed REST service missing"];
    if (!flow || !pub) return ["REST microflow or published service missing"];
    if (svc.Operations.length !== 5) r.push(`${svc.Operations.length} operations, expected 5`);
    if (!svc.AuthenticationScheme || svc.AuthenticationScheme.$Type !== "Rest$BasicAuthenticationScheme" || svc.AuthenticationScheme.Password.$Type !== "Rest$ConstantValue") r.push("Basic authentication with a constant password missing");
    for (const op of svc.Operations) {
        if (!op.Headers.some(h => h.Name === "Accept")) r.push(`${op.Name} has no Accept header (CE7062)`);
        const body = op.Method.Body;
        if (/^(Post|Put|Patch)$/.test(op.Method.HttpMethod) && !body) r.push(`${op.Name} has no body (CE7064)`);
        const used = new Set([op.Path.Value, ...op.Headers.map(h => h.Value.Value), body && body.ValueTemplate ? body.ValueTemplate.Value : ""].flatMap(t => [...String(t).matchAll(/\{(\w+)\}/g)].map(m => m[1])));
        const declared = op.Parameters.map(p => p.Name);
        if ([...used].some(n => !declared.includes(n)) || declared.some(n => !used.has(n))) r.push(`${op.Name}: placeholders ${[...used]} vs parameters ${declared} (CE7056)`);
        walk(body, o => /ObjectMappingElement$/.test(o.$Type) && o.$Type.startsWith("ExportMappings") && o !== body.RootMappingElement && o.ObjectHandling === "Create" && r.push(`${op.Name} body: nested export element with Create (Studio Pro cannot load it)`));
    }
    const calls = [];
    walk(flow, o => o.$Type === "Microflows$RestOperationCallAction" && calls.push(o));
    if (calls.length !== 4) r.push(`${calls.length} send REST request actions, expected 4`);
    for (const c of calls) {
        for (const m of c.ParameterMappings || []) if (m.$Type !== "Microflows$RestOperationParameterMapping") r.push(`parameter mapping stored as ${m.$Type} (Studio Pro cannot load it)`);
        if (c.BodyVariable && !/CreateOrder$/.test(c.Operation)) r.push(`${c.Operation} has a BodyVariable without a mapping body (CE7067)`);
        if (c.ErrorHandlingType === "Custom" || c.ErrorHandlingType === "CustomWithoutRollBack") r.push("send REST request with custom error handling (CE6035)");
    }
    const ops = pub.Resources.flatMap(x => x.Operations);
    const post = ops.find(o => o.HttpMethod === "Post");
    if (!post || !post.ImportMapping || !post.ExportMapping) r.push("published Post operation lacks its mappings");
    else {
        const kinds = Object.fromEntries(post.Parameters.map(p => [p.Name, p.ParameterType]));
        if (kinds.Shop !== "Path" || kinds.Token !== "Header" || kinds.Mode !== "Query" || !Object.values(kinds).includes("Body")) r.push(`published Post parameters ${JSON.stringify(kinds)}`);
    }
    if (pub.Version !== "2.0.0" || !pub.AllowedRoles.length) r.push("published service version or roles missing");
    return r;
}

// ---------------------------------------------------------------- workflows

function workflowPlan(mod, T, version, pageable, userRole) {
    const E = `${mod}.${T}`;
    const R = `${E}WfReq`;
    const task = (page, outcomes, extra = {}) => (pageable ? [{ step: "userTask", page, outcomes, ...extra }] : []);
    return { ops: [
        { op: "createEnumeration", module: mod, name: `${T}WfLevel`, values: ["Low", "High"], folder: "ZzWf" },
        { op: "createEntity", module: mod, name: `${T}WfReq`, attributes: [{ name: "Amount", type: "Decimal" }, { name: "Reason", type: "String(200)" }, { name: "Level", type: `Enum(${E}WfLevel)` }] },
        { op: "createModuleRole", module: mod, name: "ZzApprover" },
        ...(pageable ? [
            { op: "createPage", kind: "userTaskPage", module: mod, name: `${T}_Review_Task`, folder: "ZzWf", entity: R, workflow: `${E}_Approval`, fields: ["Amount", "Reason"], outcomes: ["Approve", "Reject"] },
            { op: "createPage", kind: "userTaskPage", module: mod, name: `${T}_Confirm_Task`, folder: "ZzWf", outcomes: ["Done"], title: "Confirm" }] : []),
        { op: "createMicroflow", module: mod, name: `${T}_WfIsBig`, folder: "ZzWf", parameters: [{ name: "Request", type: R }], returns: "Boolean", returnValue: "$Request/Amount > 1000" },
        { op: "createMicroflow", module: mod, name: `${T}_WfNotify`, folder: "ZzWf", parameters: [{ name: "Request", type: R }], actions: [{ action: "log", message: "notify" }] },
        { op: "createMicroflow", module: mod, name: `${T}_WfTargets`, folder: "ZzWf", parameters: [{ name: "Request", type: R }], returns: "List(System.User)", returnValue: "empty" },
        { op: "createWorkflow", module: mod, name: `${T}_SubWf`, folder: "ZzWf", context: R, steps: [{ step: "callMicroflow", microflow: `${E}_WfNotify` }] },
        { op: "createWorkflow", module: mod, name: `${T}_Approval`, folder: "ZzWf", context: R, title: "Request approval", description: "Approve a request", dueDate: "addDays([%CurrentDateTime%], 7)", roles: [`${mod}.ZzApprover`],
            steps: [
                ...task(`${E}_Review_Task`, { Approve: [], Reject: [{ step: "callMicroflow", microflow: `${E}_WfNotify`, caption: "Tell the requester" }, { step: "end", caption: "Rejected" }] },
                    { name: "review", caption: "Review", dueDate: "addDays([%CurrentDateTime%], 2)", ...(userRole ? { assignee: { userRoles: [userRole] } } : {}) }),
                { step: "decision", name: "bigCheck", condition: "$WorkflowContext/Amount > 1000", outcomes: { true: task(`${E}_Confirm_Task`, ["Done"], { assignee: { microflow: `${E}_WfTargets` } }), false: [] } },
                { step: "decision", condition: "$WorkflowContext/Level", outcomes: { [`${E}WfLevel.High`]: [{ step: "waitForTimer", delay: "addHours([%CurrentDateTime%], 1)" }], "": [] } },
                { step: "callMicroflow", microflow: `${E}_WfIsBig`, outcomes: { true: [{ step: "jumpTo", target: "bigCheck" }], false: [] } },
                { step: "parallelSplit", paths: [[{ step: "callMicroflow", microflow: `${E}_WfNotify` }], [{ step: "callWorkflow", workflow: `${E}_SubWf` }, { step: "waitForNotification", name: "waitDocs" }]] }] },
        { op: "createMicroflow", module: mod, name: `${T}_WfActions`, folder: "ZzWf", parameters: [{ name: "Request", type: R }, { name: "Task", type: "System.WorkflowUserTask" }], actions: [
            { action: "callWorkflow", workflow: `${E}_Approval`, context: "Request", variable: "Wf" },
            { action: "retrieveWorkflowContext", workflow: "Wf", definition: `${E}_Approval`, variable: "Ctx" },
            { action: "log", message: "amount {1}", args: ["toString($Ctx/Amount)"] },
            { action: "notifyWorkflow", workflow: "Wf", definition: `${E}_Approval`, activity: "waitDocs", variable: "Notified" },
            ...(cmp(version, "10.4.0") >= 0 ? [{ action: "retrieveWorkflows", context: "Request", variable: "Wfs" }, { action: "retrieveActivityRecords", workflow: "Wf", variable: "Records" }] : []),
            { action: "generateJumpToOptions", workflow: "Wf", variable: "Options" },
            { action: "applyJumpTo", details: "Options" },
            { action: "changeWorkflowState", workflow: "Wf", operation: "pause" },
            { action: "changeWorkflowState", workflow: "Wf", operation: "abort", reason: "Cancelled" },
            { action: "lockWorkflow", workflow: `${E}_Approval`, pauseAll: true },
            { action: "lockWorkflow", workflow: `${E}_Approval`, unlock: true },
            { action: "retrieve", variable: "TaskWf", from: "Task", association: "System.WorkflowUserTask_Workflow" },
            { action: "openUserTask", task: "Task" },
            { action: "completeUserTask", task: "Task", outcome: "Approve" },
            { action: "openWorkflow", workflow: "TaskWf" }] }
    ] };
}

const WF_ACTIONS = ["WorkflowCallAction", "GetWorkflowDataAction", "NotifyWorkflowAction", "GenerateJumpToOptionsAction", "ApplyJumpToOptionAction", "WorkflowOperationAction",
    "LockWorkflowAction", "UnlockWorkflowAction", "OpenUserTaskAction", "SetTaskOutcomeAction", "OpenWorkflowAction"];

function workflowProblems(project, T, version, pageable) {
    const r = [];
    const u = unitsNamed(project, `${T}_`);
    const w = u[`${T}_Approval`], flow = u[`${T}_WfActions`];
    if (!w || w.$Type !== "Workflows$Workflow" || !flow) return ["workflow or its microflow missing"];
    if (w.Parameter.Name !== "WorkflowContext" || !/WfReq$/.test(w.Parameter.Entity)) r.push(`context parameter ${w.Parameter.Name}: ${w.Parameter.Entity}`);
    const main = w.Flow.Activities;
    const v11 = cmp(version, "11.1.0") >= 0;
    if (v11 && (main[0].$Type !== "Workflows$StartWorkflowActivity" || main[0].Name !== "start1")) r.push("main flow does not start with start1");
    if (main[main.length - 1].$Type !== "Workflows$EndWorkflowActivity" || main[main.length - 1].Name !== "end1") r.push("main flow does not end with end1");
    const names = [];
    walk(w.Flow, o => {
        if (/Activity$|Task$/.test(o.$Type) && o.Name !== undefined) names.push(o.Name);
        if (o.Outcomes) for (const oc of o.Outcomes) if (!oc.Flow || !oc.PersistentId) r.push(`${o.Name}: an outcome without flow or persistent id`);
        if (o.$Type === "Workflows$JumpToActivity" && o.TargetActivity !== "bigCheck") r.push(`jump target ${o.TargetActivity}`);
        if (o.$Type === "Workflows$ExclusiveSplitActivity" && /Level$/.test(o.Expression) && (o.Outcomes.length !== 3 || !o.Outcomes.some(x => x.$Type === "Workflows$VoidConditionOutcome"))) r.push("enumeration decision lacks an outcome per value plus the empty one (CE6686)");
        if (/UserTaskActivity$/.test(o.$Type)) {
            if (!o.TaskPage || !o.TaskPage.Page) r.push(`${o.Name} has no task page (CE1834)`);
            if (o.Outcomes.length === 1 && o.Outcomes[0].Flow.Activities.length) r.push(`${o.Name}: single outcome with steps (CE1876)`);
        }
    });
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) r.push(`duplicate activity names ${dup} (CE0495)`);
    if (pageable) {
        for (const p of [`${T}_Review_Task`, `${T}_Confirm_Task`]) {
            const page = u[p];
            if (!page || !page.Parameters.some(x => x.ParameterType.Entity === "System.WorkflowUserTask")) r.push(`${p} has no WorkflowUserTask parameter (CE7412)`);
            const buttons = [];
            walk(page, o => o.$Type === "Forms$SetTaskOutcomeClientAction" && buttons.push(o.OutcomeValue));
            if (!buttons.length) r.push(`${p} has no outcome buttons`);
        }
        if (!u[`${T}_Review_Task_Context`]) r.push("user task page data source microflow missing");
    }
    const seen = new Set();
    walk(flow, o => seen.add(o.$Type.split("$")[1]));
    for (const t of WF_ACTIONS) if (!seen.has(t)) r.push(`no ${t} stored`);
    return r;
}

// ---------------------------------------------------------------- OData, XML schema, message definitions

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="http://example.com/zzorder" elementFormDefault="qualified">
  <xs:element name="Order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Number" type="xs:string"/>
        <xs:element name="Total" type="xs:decimal" minOccurs="0"/>
        <xs:element name="Placed" type="xs:dateTime"/>
        <xs:element name="Line" type="LineType" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="LineType">
    <xs:sequence>
      <xs:element name="Sku" type="xs:string"/>
      <xs:element name="Qty" type="xs:int"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>
`;

function odataPlan(mod, T, version, dir) {
    const E = `${mod}.${T}`;
    const xsd = require("path").join(dir, "zz-order.xsd");
    require("fs").writeFileSync(xsd, XSD);
    const odata = cmp(version, "10.4.0") >= 0;
    return { refuse: [{ op: "consumeODataService", module: mod, metadata: "metadata.xml" }, { op: "consumeWebService", module: mod }, { op: "createBusinessEvent", module: mod }],
        ops: [
            { op: "createEnumeration", module: mod, name: `${T}OdKind`, values: ["A", "B"], folder: "ZzXml" },
            { op: "createEntity", module: mod, name: `${T}OdCust`, attributes: [{ name: "Name", type: "String(100)" }, { name: "Kind", type: `Enum(${E}OdKind)` }] },
            { op: "createEntity", module: mod, name: `${T}OdOrder`, attributes: [{ name: "Number", type: "String(20)" }, { name: "Total", type: "Decimal" }, { name: "Placed", type: "DateTime" }] },
            { op: "addAssociation", from: `${E}OdOrder`, to: `${E}OdCust` },
            { op: "createModuleRole", module: mod, name: "ZzODataUser" },
            { op: "createMicroflow", module: mod, name: `${T}_OdUpdate`, folder: "ZzXml", parameters: [{ name: "Order", type: `${E}OdOrder` }], actions: [{ action: "commit", variable: "Order" }] },
            ...(odata ? [{ op: "publishOData", module: mod, name: `${T}_OData`, folder: "ZzXml", roles: [`${mod}.ZzODataUser`],
                entities: [`${E}OdCust`, { entity: `${E}OdOrder`, insert: true, update: `${E}_OdUpdate`, delete: true, pageSize: 500, key: ["Number"] }] }] : []),
            { op: "createXmlSchema", module: mod, name: `${T}_Xsd`, folder: "ZzXml", file: xsd },
            { op: "createXmlImportMapping", module: mod, name: `${T}_XmlImm`, folder: "ZzXml", xmlSchema: `${E}_Xsd`, rootElement: "Order", entity: `${E}OdOrder`, entities: { "Order/Line": `${E}OdLine` }, create: true },
            { op: "createXmlExportMapping", module: mod, name: `${T}_XmlExm`, folder: "ZzXml", xmlSchema: `${E}_Xsd`, entity: `${E}OdOrder`, entities: { "Order/Line": `${E}OdLine` }, skip: ["Order/Total"] },
            { op: "createMessageDefinition", module: mod, name: `${T}_MD`, folder: "ZzXml", entity: `${E}OdOrder`, associations: [`${E}OdOrder_${T}OdCust`, `${E}OdLine_${T}OdOrder`] },
            { op: "createXmlImportMapping", module: mod, name: `${T}_MdImm`, folder: "ZzXml", messageDefinition: `${E}_MD.${T}OdOrder` },
            { op: "createXmlExportMapping", module: mod, name: `${T}_MdExm`, folder: "ZzXml", messageDefinition: `${E}_MD.${T}OdOrder` },
            { op: "createMicroflow", module: mod, name: `${T}_XmlFlow`, folder: "ZzXml", parameters: [{ name: "Xml", type: "String" }], returns: "String", returnValue: "$Out", actions: [
                { action: "importWithMapping", mapping: `${E}_XmlImm`, source: "Xml", variable: "Order", commit: "no" },
                { action: "exportWithMapping", mapping: `${E}_XmlExm`, object: "Order", variable: "Out" }] }
        ] };
}

function odataProblems(project, T, version) {
    const r = [];
    const u = unitsNamed(project, `${T}_`);
    if (cmp(version, "10.4.0") >= 0) {
        const s = u[`${T}_OData`];
        if (!s || s.$Type !== "ODataPublish$PublishedODataService2") r.push("published OData service missing");
        else {
            if (s.EntityTypes.length !== 2 || s.EntitySets.length !== 2) r.push(`${s.EntityTypes.length} entity types, ${s.EntitySets.length} sets`);
            if (!s.Enumerations.length) r.push("the enumeration of Kind is not published");
            const ord = s.EntityTypes.find(t => /OdOrder$/.test(t.Entity));
            if (!ord || !ord.ChildMembers.some(m => m.IsPartOfKey && /Number$/.test(m.Attribute || ""))) r.push("Number is not the key of the order");
            if (!ord || !ord.ChildMembers.some(m => m.$Type === "ODataPublish$PublishedAssociationEnd")) r.push("the association to the customer is not published");
            const cust = s.EntityTypes.find(t => /OdCust$/.test(t.Entity));
            if (!cust || !cust.ChildMembers.some(m => m.$Type === "ODataPublish$PublishedId" && m.IsPartOfKey)) r.push("the customer has no ID key");
            const set = s.EntitySets.find(x => x.EntityTypePointer === (ord && ord.$ID));
            if (!set || set.InsertMode.$Type !== "ODataPublish$ChangeSource" || set.UpdateMode.$Type !== "ODataPublish$CallMicroflowToChange" || set.PageSize !== 500) r.push("order set capabilities");
        }
    }
    const x = u[`${T}_Xsd`];
    if (!x || x.Entries.length !== 1 || !/zzorder/.test(x.Entries[0].TargetNamespace) || !x.Entries[0].Contents.includes("LineType")) r.push("XML schema missing or without its contents");
    for (const [n, root, paths] of [["XmlImm", "Order", ["Order|Number", "Order|Line|Sku"]], ["XmlExm", "Order", ["Order|Number", "Order|Line|Qty"]], ["MdImm", null, [`${T}OdOrders|${T}OdOrder|Number`]], ["MdExm", null, [`${T}OdOrders|${T}OdOrder|${T}OdCust|Name`]]]) {
        const m = u[`${T}_${n}`];
        if (!m) {
            r.push(`${n} missing`);
            continue;
        }
        if (root && (m.XsdRootElementName !== root || !m.XmlSchema)) r.push(`${n}: root element ${m.XsdRootElementName}`);
        if (!root && !m.MessageDefinition) r.push(`${n} has no message definition`);
        const have = [];
        walk(m.Elements, e => have.push(e.XmlPath));
        for (const p of paths) if (!have.includes(p)) r.push(`${n} lacks element ${p}`);
        walk(m.Elements, e => /ExportMappings\$ObjectMappingElement/.test(e.$Type) && e.ObjectHandling === "Create" && r.push(`${n}: export element with Create`));
    }
    const md = u[`${T}_MD`];
    if (!md || md.MessageDefinitions[0].ExposedEntity.ExposedName !== `${T}OdOrders`) r.push("message definition root is not the list <Entity>s");
    return r;
}

module.exports = { runPhase, restPlan, restProblems, workflowPlan, workflowProblems, odataPlan, odataProblems, unitsNamed, walk };
