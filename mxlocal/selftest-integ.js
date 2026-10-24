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
    if (plan.changeFile) s.client.changeFile = plan.changeFile; // files of the plan (images, fonts) are relative to its folder
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
    const lint = await s.ops.runPlan(plan, env.log || (() => {}));
    problems.push(...lint);
    // ops that must be refused with a reason (they change nothing), then ops that run after them
    for (const { op, expect } of plan.reject || []) {
        let msg = "";
        try {
            await s.ops.runPlan({ ops: [op] }, () => {});
        } catch (e) {
            msg = e.message;
        }
        if (!expect.test(msg)) problems.push(`${op.op} was not refused as expected (${expect})${msg ? `: ${msg}` : ""}`);
    }
    if (plan.after) problems.push(...(await s.ops.runPlan({ ops: plan.after }, env.log || (() => {}))));
    if (plan.probe) problems.push(...(await plan.probe(s.ops)));
    await s.model.flushChanges();
    const enc = s.client.encode();
    enc.plainFiles = require("./files").encode(s.client); // files ops stage (theme, packages), as apply writes them
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
    const firstUse = [...new Set(s.client.summary().warnings.filter(w => /first use|never occurs/.test(w)).map(w => w.split(" ")[0]))];
    s.client.project.writeEncoded(enc);
    let s2 = await reopen(copy);
    problems.push(...(await s2.ops.checkPlan({ ops: [...plan.ops, ...(plan.after || [])] })));
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
        // Studio Pro resolves a parameter as Module.Service.Operation.param; without the operation the model does not load
        for (const m of [...(c.ParameterMappings || []), ...(c.QueryParameterMappings || [])]) {
            const ref = m.Parameter !== undefined ? m.Parameter : m.QueryParameter;
            if (typeof ref !== "string" || !ref.startsWith(c.Operation + ".")) r.push(`${c.Operation}: parameter mapping refers to '${ref}', not a parameter of the operation (Studio Pro cannot load it)`);
        }
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
        // a multi-user task (Mendix 10.12+): 60% of half the targeted users decide, else Reject
        ...(pageable && cmp(version, "10.12.0") >= 0 ? [{ op: "createWorkflow", module: mod, name: `${T}_Vote`, folder: "ZzWf", context: R, steps: [
            { step: "multiUserTask", name: "vote", page: `${E}_Review_Task`, outcomes: ["Approve", "Reject"], assignee: { microflow: `${E}_WfTargets` }, completion: { threshold: "60%" }, fallback: "Reject", users: { percent: 50 }, awaitAll: true }] }] : []),
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
    const vote = pageable && cmp(version, "10.12.0") >= 0 ? unitsNamed(project, `${T}_Vote`)[`${T}_Vote`] : null;
    const voteProblems = [];
    if (vote) {
        let m = null;
        walk(vote, o => o.$Type === "Workflows$MultiUserTaskActivity" && (m = o));
        if (!m || !m.CompletionCriteria || m.CompletionCriteria.$Type !== "Workflows$ThresholdCompletionCriteria" || m.CompletionCriteria.Threshold !== 60 || m.CompletionCriteria.CompletionType !== "Relative" || !m.TargetUserInput || m.TargetUserInput.$Type !== "Workflows$PercentageAmountUserInput" || m.AwaitAllUsers !== true) voteProblems.push(`multi-user task ${JSON.stringify(m && { c: m.CompletionCriteria, t: m.TargetUserInput, a: m.AwaitAllUsers })}`.slice(0, 300));
    } else if (pageable && cmp(version, "10.12.0") >= 0) voteProblems.push("workflow with a multi-user task missing");
    return [...voteProblems, ...workflowProblems0(project, T, version, pageable)];
}

function workflowProblems0(project, T, version, pageable) {
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

// ---------------------------------------------------------------- change and delete of integration documents

// A structure and mappings onto existing entities (attribute names matched loosely), then a new snippet: the mappings
// follow it (new values, a new object with its entity, a removed and a retyped value), element settings (keys, find
// with ignore, a value transform; a custom microflow handler is refused, the root as the mapping parameter), an import step passing the
// parameter, and the error-handler recipe (callRest whose handler parses $latestHttpResponse with an import mapping).
function changePlan(mod, T, dir, version) {
    const E = `${mod}.${T}`;
    const odata = cmp(version, "10.4.0") >= 0;
    const xsd2 = require("path").join(dir, "zz-order2.xsd");
    require("fs").writeFileSync(xsd2, XSD.replace('<xs:element name="Placed" type="xs:dateTime"/>', '<xs:element name="Placed" type="xs:dateTime"/>\n        <xs:element name="Status" type="xs:string" minOccurs="0"/>').replace('<xs:element name="Qty" type="xs:int"/>', '<xs:element name="Qty" type="xs:int"/>\n      <xs:element name="Price" type="xs:decimal"/>'));
    const api = `${E}_OrderApi`, pub = `${E}_Pub`; // made by the REST phase
    const map = { entity: `${E}ChOrder`, entities: { lines: `${E}ChLine` } };
    const snippet2 = "{ \"order_id\": 7, \"total\": \"2.50\", \"status\": \"open\", \"lines\": [ { \"sku\": \"A\", \"qty\": 1, \"price\": 1.5 } ], \"customer\": { \"name\": \"Ann\" } }";
    return {
        ops: [
            { op: "createEntity", module: mod, name: `${T}ChOrder`, attributes: [{ name: "OrderID", type: "Long" }, { name: "Total", type: "Decimal" }, { name: "Note", type: "String(200)" }] },
            { op: "createEntity", module: mod, name: `${T}ChLine`, attributes: [{ name: "SKU", type: "String(20)" }, { name: "Qty", type: "Integer" }] },
            { op: "addAssociation", from: `${E}ChLine`, to: `${E}ChOrder` },
            { op: "createJsonStructure", module: mod, name: `${T}_ChJson`, folder: "ZzChange", snippet: "{ \"order_id\": 7, \"total\": 2.5, \"note\": \"x\", \"lines\": [ { \"sku\": \"A\", \"qty\": 1 } ] }" },
            { op: "createImportMapping", module: mod, name: `${T}_ChImm`, folder: "ZzChange", jsonStructure: `${E}_ChJson`, ...map, keys: ["order_id"] },
            { op: "createImportMapping", module: mod, name: `${T}_ChImm2`, folder: "ZzChange", jsonStructure: `${E}_ChJson`, ...map },
            { op: "createExportMapping", module: mod, name: `${T}_ChExm`, folder: "ZzChange", jsonStructure: `${E}_ChJson`, ...map },
            { op: "changeJsonStructure", structure: `${E}_ChJson`, snippet: snippet2 },
            { op: "updateImportMapping", mapping: `${E}_ChImm`, entities: { customer: `${E}ChCust` }, createAttributes: true, create: true, prune: true },
            { op: "updateExportMapping", mapping: `${E}_ChExm`, createAttributes: true, skip: ["customer"], prune: true },
            { op: "changeMapping", mapping: `${E}_ChImm`, element: "lines", keys: ["sku"], ifNotFound: "ignore" },
            { op: "createMicroflow", module: mod, name: `${T}_ChConv`, folder: "ZzChange", parameters: [{ name: "Value", type: "String" }], returns: "Decimal", returnValue: "parseDecimal($Value)" },
            { op: "changeMapping", mapping: `${E}_ChImm`, element: "total", transform: `${E}_ChConv` },
            { op: "createMicroflow", module: mod, name: `${T}_ChFindCust`, folder: "ZzChange", parameters: [{ name: "Name", type: "String" }, { name: "Order", type: `${E}ChOrder` }], returns: `${E}ChCust`, returnValue: "empty" },
            { op: "changeMapping", mapping: `${E}_ChImm`, parameter: `${E}ChOrder` },
            { op: "changeMapping", mapping: `${E}_ChImm`, element: "", objectHandling: "parameter" },
            { op: "changeMapping", mapping: `${E}_ChExm`, element: "lines", association: `${E}ChLine_${T}ChOrder` },
            { op: "createJsonStructure", module: mod, name: `${T}_ChErrJson`, folder: "ZzChange", snippet: "{ \"code\": \"E1\", \"message\": \"bad request\" }" },
            { op: "createImportMapping", module: mod, name: `${T}_ChErrImm`, folder: "ZzChange", jsonStructure: `${E}_ChErrJson`, entity: `${E}ChApiError`, create: true, persistable: false },
            { op: "createMicroflow", module: mod, name: `${T}_ChImport`, folder: "ZzChange", parameters: [{ name: "Json", type: "String" }, { name: "Order", type: `${E}ChOrder` }], returns: "Boolean", returnValue: "true", actions: [
                { action: "importWithMapping", mapping: `${E}_ChImm`, source: "Json", parameter: "Order", variable: "Imported", commit: "no" },
                { action: "callRest", url: "https://api.example.com/orders", variable: "Body", errorBody: true, onError: { rollback: false, returnValue: "false", actions: [
                    { action: "variable", name: "ErrorBody", type: "String", value: "$latestHttpResponse/Content" },
                    { action: "importWithMapping", mapping: `${E}_ChErrImm`, source: "ErrorBody", variable: "ApiError", commit: "no" },
                    { action: "log", level: "Error", message: "API error {1}: {2}", args: ["toString($latestHttpResponse/StatusCode)", "$ApiError/Message"] }] } }] },
            // REST documents of the REST phase
            { op: "changeRestService", service: api, baseUrl: "https://api.example.com/v2/", authentication: "none" },
            { op: "changeRestOperation", operation: `${api}.GetOrder`, path: "/orders/{id}/details", headers: { "X-Trace": null, "X-Version": "2" }, timeout: 60 },
            { op: "changeRestOperation", operation: `${api}.Ping`, method: "Patch", body: "{ \"code\": \"{code}\", \"at\": \"now\" }" },
            { op: "deleteRestOperation", operation: `${api}.DeleteOrder` },
            { op: "changePublishedRestService", service: pub, version: "2.1.0" },
            { op: "changePublishedRestOperation", service: pub, resource: "orders", method: "Get", path: "{Id}", summary: "One order by id", deprecated: true },
            { op: "deletePublishedRestOperation", service: pub, resource: "orders", method: "Post", path: "{Shop}" },
            { op: "publishRest", module: mod, service: `${T}_Pub`, resource: "zztmp", method: "Get", microflow: `${E}_RestCall`, path: "{Id}", exportMapping: `${E}_RestExm` },
            { op: "deletePublishedRestResource", service: pub, resource: "zztmp" },
            // XML schema and message definition of the OData/XML phase
            { op: "changeXmlSchema", schema: `${E}_Xsd`, file: xsd2 },
            { op: "updateImportMapping", mapping: `${E}_XmlImm`, createAttributes: true },
            { op: "updateExportMapping", mapping: `${E}_XmlExm`, createAttributes: true },
            { op: "changeMessageDefinition", definition: `${E}_MD.${T}OdOrder`, associations: [`${E}OdLine_${T}OdOrder`] },
            { op: "updateImportMapping", mapping: `${E}_MdImm`, prune: true },
            { op: "updateExportMapping", mapping: `${E}_MdExm`, prune: true },
            ...(odata ? [{ op: "changePublishedOData", service: `${E}_OData`, remove: [`${E}OdCust`], entities: [{ entity: `${E}OdOrder`, key: ["Number"], insert: true, pageSize: 100 }, `${E}ChOrder`], version: "1.1.0" }] : [])
        ],
        reject: [
            { op: { op: "updateImportMapping", mapping: `${E}_ChImm2` }, expect: /no longer in .*order_id|no longer in .*note.*"prune": true/ },
            { op: { op: "updateImportMapping", mapping: `${E}_ChImm`, entities: { custmer: `${E}ChCust` } }, expect: /not in .*Did you mean: customer/ },
            { op: { op: "changeMapping", mapping: `${E}_ChImm`, element: "total", keys: ["total"] }, expect: /'keys' is for an object/ },
            { op: { op: "changeMapping", mapping: `${E}_ChExm`, element: "lines", objectHandling: "find" }, expect: /import mapping setting/ },
            { op: { op: "changeMapping", mapping: `${E}_ChImm`, element: "total", transform: `${E}_ChFindCust` }, expect: /takes one value and returns one/ },
            { op: { op: "changeMapping", mapping: `${E}_ChImm`, element: "customer", objectHandling: "custom", microflow: `${E}_ChFindCust` }, expect: /custom object handler .*not written: Studio Pro 10.24 \/ 11.12 cannot load/ },
            { op: { op: "changeMapping", mapping: `${E}_ChImm`, element: "lines", objectHandling: "find", keys: [] }, expect: /none of its values is a key/ },
            { op: { op: "createImportMapping", module: mod, name: `${T}_ChBad`, jsonStructure: `${E}_ChJson`, entity: `${E}ChOrder` }, expect: /no entity .*Lines.*create/ },
            { op: { op: "deleteRestOperation", operation: `${api}.GetOrdr` }, expect: /no operation 'GetOrdr'.*Did you mean: GetOrder/ },
            { op: { op: "changeRestOperation", operation: `${api}.GetOrder`, headers: { Accept: null } }, expect: /keeps an Accept header/ },
            { op: { op: "changeRestOperation", operation: `${api}.GetOrder` }, expect: /nothing to change/ },
            { op: { op: "deletePublishedRestOperation", service: pub, resource: "orders", method: "Put" }, expect: /no Put operation .*its operations: Get '\{Id\}'/ },
            ...(odata ? [{ op: { op: "changePublishedOData", service: `${E}_OData`, remove: [`${E}OdCustomer`] }, expect: /OdCustomer is not published in .*Did you mean/ }] : []),
            { op: { op: "updateConsumedODataService", service: `${E}_Remote` }, expect: /is not supported\. .*In Studio Pro/ },
            { op: { op: "createMicroflow", module: mod, name: `${T}_ChBadFlow`, parameters: [{ name: "Json", type: "String" }], actions: [{ action: "importWithMapping", mapping: `${E}_ChImm`, source: "Json" }] }, expect: /takes a parameter .*give "parameter"/ }
        ],
        after: [{ op: "delete", target: `${E}_ChImm2` }],
        async probe(ops) {
            const out = await ops.mappingTest(`${E}_ChImm`, "{ \"order_id\": 7, \"total\": \"2.5\", \"status\": \"open\", \"extra\": 1, \"lines\": [ { \"sku\": \"A\", \"qty\": \"many\" }, { \"sku\": \"B\", \"qty\": 2 } ] }");
            const want = [/ChOrder \(the mapping parameter\)/, /ChLine \(find by SKU = "A", if none: ignore\)/, /Total = "2.5" \(through .*_ChConv\)/, /qty: "many" is no whole number/, /extra: in the sample, not in the mapping/, /objects: 1 .*ChOrder, 2 .*ChLine/, /customer: not in the sample/];
            return want.filter(w => !w.test(out)).map(w => `mapping-test output lacks ${w}: ${out.split("\n").slice(0, 12).join(" | ")}`);
        }
    };
}

function changeProblems(project, T, version) {
    const r = [];
    const u = unitsNamed(project, `${T}_Ch`);
    const s = u[`${T}_ChJson`], imm = u[`${T}_ChImm`], exm = u[`${T}_ChExm`], flow = u[`${T}_ChImport`];
    if (!s || !imm || !exm || !flow) return ["structure, mappings or import flow missing"];
    if (u[`${T}_ChImm2`]) r.push("the deleted mapping is still there");
    const sp = [];
    walk(s.Elements, e => sp.push(e.Path));
    if (!sp.includes("(Object)|status") || sp.includes("(Object)|note") || !sp.includes("(Object)|customer|name")) r.push(`structure paths ${sp.join(", ")}`);
    const els = {};
    walk(imm.Elements, e => /MappingElement$/.test(e.$Type) && (els[e.JsonPath] = e));
    const want = { "(Object)|status": /ChOrder\.Status$/, "(Object)|lines|(Object)|price": /ChLine\.Price$/, "(Object)|order_id": /ChOrder\.OrderID$/, "(Object)|lines|(Object)|sku": /ChLine\.SKU$/ };
    for (const [p, re] of Object.entries(want)) if (!els[p] || !re.test(els[p].Attribute)) r.push(`import ${p} -> ${els[p] && els[p].Attribute}`);
    if (els["(Object)|note"]) r.push("import still maps note");
    const root = imm.Elements[0];
    if (root.ObjectHandling !== "Parameter" || imm.ParameterType.$Type !== "DataTypes$ObjectType" || !/ChOrder$/.test(imm.ParameterType.Entity)) r.push(`root ${root.ObjectHandling}, parameter ${JSON.stringify(imm.ParameterType)}`);
    const line = els["(Object)|lines|(Object)"];
    if (!line || line.ObjectHandling !== "Find" || line.ObjectHandlingBackup !== "Ignore" || !els["(Object)|lines|(Object)|sku"].IsKey) r.push("lines: not found by sku / ignore");
    const cust = els["(Object)|customer"];
    if (!cust || !/ChCust$/.test(cust.Entity) || cust.ObjectHandling === "Custom" || cust.CustomHandlerCall) r.push("customer: missing, or a custom handler was written (refused: Studio Pro cannot load it)");
    if (!els["(Object)|total"] || !/_ChConv$/.test(els["(Object)|total"].Converter) || els["(Object)|total"].XmlPrimitiveType !== "String") r.push("total: transform or retype missing");
    const order = root.Children.map(c => c.JsonPath);
    if (order.join() !== ["(Object)|order_id", "(Object)|total", "(Object)|status", "(Object)|lines|(Object)", "(Object)|customer"].join()) r.push(`import children order ${order.join(", ")}`);
    const xp = [];
    walk(exm.Elements, e => /MappingElement$/.test(e.$Type) && xp.push(e.JsonPath));
    if (!xp.includes("(Object)|status") || xp.some(p => /customer|note/.test(p)) || !xp.includes("(Object)|lines|(Object)|price")) r.push(`export paths ${xp.join(", ")}`);
    const calls = [];
    walk(flow, o => o.$Type === "Microflows$ImportMappingCall" && calls.push(o));
    if (!calls.some(c => c.ParameterVariableName === "Order")) r.push("importWithMapping does not pass the parameter");
    if (calls.length !== 2) r.push(`${calls.length} import mapping calls, expected 2 (one in the error handler)`);
    const all = unitsNamed(project, `${T}_`);
    const svc = all[`${T}_OrderApi`], pub = all[`${T}_Pub`], rc = all[`${T}_RestCall`];
    if (!svc || !pub || !rc) return [...r, "REST documents of the REST phase missing"];
    if (svc.BaseUrl.Value !== "https://api.example.com/v2" || svc.AuthenticationScheme) r.push(`service base URL ${svc.BaseUrl.Value}, authentication ${svc.AuthenticationScheme && svc.AuthenticationScheme.$Type}`);
    const get = svc.Operations.find(x => x.Name === "GetOrder"), ping = svc.Operations.find(x => x.Name === "Ping");
    if (svc.Operations.some(x => x.Name === "DeleteOrder")) r.push("DeleteOrder still there");
    if (!get || get.Path.Value !== "/orders/{id}/details" || get.Headers.some(x => x.Name === "X-Trace") || !get.Headers.some(x => x.Name === "X-Version") || get.Parameters.map(x => x.Name).join() !== "id" || get.Timeout !== 60) r.push(`GetOrder ${get && get.Path.Value} params ${get && get.Parameters.map(x => x.Name)}`);
    if (!ping || ping.Method.HttpMethod !== "Patch" || !/"at"/.test(ping.Method.Body.ValueTemplate.Value)) r.push("Ping not Patch with the new body");
    walk(rc, o => o.$Type === "Microflows$RestOperationCallAction" && /GetOrder$/.test(o.Operation) && o.ParameterMappings.some(m => /trace$/.test(m.Parameter)) && r.push("the GetOrder call still passes trace"));
    const ops = pub.Resources.flatMap(x => x.Operations);
    if (pub.Version !== "2.1.0" || ops.some(o => o.HttpMethod === "Post") || pub.Resources.some(x => x.Name === "zztmp")) r.push(`published service version ${pub.Version}, ${ops.length} operations, resources ${pub.Resources.map(x => x.Name)}`);
    const xsd = all[`${T}_Xsd`], xi = all[`${T}_XmlImm`], xe = all[`${T}_XmlExm`], mdc = all[`${T}_MD`], mi = all[`${T}_MdImm`], me = all[`${T}_MdExm`];
    if (!xsd || !xi || !xe || !mdc || !mi || !me) return [...r, "XML documents of the OData/XML phase missing"];
    if (!xsd.Entries[0].Contents.includes("Status")) r.push("XML schema not imported again");
    for (const [n, m, paths] of [["XmlImm", xi, ["Order|Status", "Order|Line|Price"]], ["XmlExm", xe, ["Order|Status", "Order|Line|Price"]]]) {
        const have = [];
        walk(m.Elements, e => have.push(e.XmlPath));
        for (const p of paths) if (!have.includes(p)) r.push(`${n} lacks ${p}`);
    }
    const mem = [];
    walk(mdc.MessageDefinitions[0].ExposedEntity, e => e.Path && mem.push(e.Path));
    if (mem.some(p => /OdCust/.test(p)) || !mem.some(p => /OdLine/.test(p))) r.push(`message definition members ${mem.join(", ")}`);
    for (const [n, m] of [["MdImm", mi], ["MdExm", me]]) walk(m.Elements, e => /OdCust/.test(e.XmlPath || "") && r.push(`${n} still maps ${e.XmlPath}`));
    const od = all[`${T}_OData`];
    if (cmp(version, "10.4.0") >= 0) {
        const types = od ? od.EntityTypes.map(t => t.Entity.split(".").pop()) : [];
        if (!od || od.Version !== "1.1.0" || types.includes(`${T}OdCust`) || !types.includes(`${T}ChOrder`) || od.EntitySets.length !== types.length || od.Enumerations.length) r.push(`published OData: version ${od && od.Version}, entities ${types}, enumerations ${od && od.Enumerations.length}`);
        const set = od && od.EntitySets.find(x => x.EntityTypePointer === (od.EntityTypes.find(t => /OdOrder$/.test(t.Entity)) || {}).$ID);
        if (!set || set.PageSize !== 100 || set.UpdateMode.$Type !== "ODataPublish$ChangeNotSupported") r.push("replaced order set settings");
    }
    const one = ops.find(o => o.HttpMethod === "Get");
    if (!one || one.Summary !== "One order by id" || !one.Deprecated || !one.ExportMapping) r.push("published Get not changed (summary, deprecated, export mapping kept)");
    return r;
}

// ---------------------------------------------------------------- integration settings and contract files

// Published REST: authentication microflow, CORS from constants, System.HttpResponse status and headers set in the
// microflow; consumed REST: bearer token header on every operation (a later operation follows), base URL parameter
// (10.17+) mapped in sendRestRequest, test values; a CRUD resource generated from an entity (generateRestResource,
// with an export mapping over a root array); published OData actions with an authentication microflow; a published
// web service with attribute selection; and the plans the contract command makes from an OpenAPI YAML, a WSDL and a
// $metadata, run as they come. Refusals: form-data body, String response, a wrong authentication microflow, CORS
// origins as text, sendRestRequest without the base URL.
const OPENAPI = T => `openapi: 3.0.0
info:
  title: ${T} Pets
  version: 1.0.0
servers:
  - url: https://pets.example.com/v1
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    ${T}Pet:
      type: object
      properties:
        id: { type: integer, format: int64 }
        name: { type: string }
        price: { type: number }
        born: { type: string, format: date-time }
paths:
  /pets:
    get:
      operationId: listPets
      parameters:
        - { name: kind, in: query, required: true, schema: { type: string } }
        - { name: X-Trace, in: header, schema: { type: string } }
      responses:
        "200":
          description: pets
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/${T}Pet" } }
    post:
      operationId: createPet
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/${T}Pet" }
      responses:
        "201": { description: created }
  /pets/{petId}:
    get:
      operationId: showPet
      parameters:
        - { name: petId, in: path, required: true, schema: { type: integer } }
      responses:
        "200":
          description: one pet
          content:
            application/json:
              schema: { $ref: "#/components/schemas/${T}Pet" }
`;
const WSDL = `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:tns="http://example.com/zzcalc" xmlns:s="http://www.w3.org/2001/XMLSchema" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" targetNamespace="http://example.com/zzcalc">
  <wsdl:types>
    <s:schema elementFormDefault="qualified" targetNamespace="http://example.com/zzcalc">
      <s:element name="Add"><s:complexType><s:sequence><s:element name="A" type="s:int" /><s:element name="B" type="s:int" /></s:sequence></s:complexType></s:element>
      <s:element name="AddResponse"><s:complexType><s:sequence><s:element name="Sum" type="s:int" /></s:sequence></s:complexType></s:element>
    </s:schema>
  </wsdl:types>
  <wsdl:message name="AddIn"><wsdl:part name="parameters" element="tns:Add" /></wsdl:message>
  <wsdl:message name="AddOut"><wsdl:part name="parameters" element="tns:AddResponse" /></wsdl:message>
  <wsdl:portType name="CalcSoap"><wsdl:operation name="Add"><wsdl:input message="tns:AddIn" /><wsdl:output message="tns:AddOut" /></wsdl:operation></wsdl:portType>
  <wsdl:binding name="CalcSoap" type="tns:CalcSoap"><soap:binding transport="http://schemas.xmlsoap.org/soap/http" />
    <wsdl:operation name="Add"><soap:operation soapAction="http://example.com/zzcalc/Add" /><wsdl:input><soap:body use="literal" /></wsdl:input><wsdl:output><soap:body use="literal" /></wsdl:output></wsdl:operation></wsdl:binding>
  <wsdl:service name="Calc"><wsdl:port name="CalcSoap" binding="tns:CalcSoap"><soap:address location="https://calc.example.com/calc.asmx" /></wsdl:port></wsdl:service>
</wsdl:definitions>
`;
const METADATA = T => `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices>
  <Schema Namespace="Shop" xmlns="http://docs.oasis-open.org/odata/ns/edm">
    <EntityType Name="${T}Cust"><Key><PropertyRef Name="Code" /></Key><Property Name="Code" Type="Edm.String" Nullable="false" /><Property Name="Credit" Type="Edm.Decimal" /><Property Name="Since" Type="Edm.DateTimeOffset" /></EntityType>
    <Action Name="Approve"><Parameter Name="Code" Type="Edm.String" /><ReturnType Type="Edm.Boolean" /></Action>
    <EntityContainer Name="C"><EntitySet Name="${T}Custs" EntityType="Shop.${T}Cust" /></EntityContainer>
  </Schema></edmx:DataServices></edmx:Edmx>
`;

function settingsPlan(mod, T, version, dir) {
    const E = `${mod}.${T}`;
    const fs = require("fs"), path = require("path");
    const { inspectContract } = require("./contract");
    const v1017 = cmp(version, "10.17.0") >= 0, odata = cmp(version, "10.4.0") >= 0;
    const files = { yaml: path.join(dir, "zz-pets.yaml"), wsdl: path.join(dir, "zz-calc.wsdl"), meta: path.join(dir, "zz-metadata.xml") };
    fs.writeFileSync(files.yaml, OPENAPI(T));
    fs.writeFileSync(files.wsdl, WSDL);
    fs.writeFileSync(files.meta, METADATA(T));
    let contract = [], contractError = null;
    try {
        contract = ["yaml", "wsdl", "meta"].flatMap(k => inspectContract(files[k], { module: mod, name: `${T}_Pets`, out: dir }).plan.ops);
    } catch (e) {
        contractError = `contract: ${e.message}`; // a problem of this phase, not the end of the selftest
    }
    const http = { name: "httpResponse", type: "System.HttpResponse" };
    return {
        ops: [
            { op: "createConstant", module: mod, name: `${T}_Origins`, type: "String", default: "https://a.example.com", folder: "ZzSet" },
            { op: "createConstant", module: mod, name: `${T}_MaxAge`, type: "Integer", default: "600", folder: "ZzSet" },
            { op: "createConstant", module: mod, name: `${T}_ApiUrl`, type: "String", default: "https://api.example.com/v3", folder: "ZzSet" },
            { op: "createEntity", module: mod, name: `${T}SetOrder`, attributes: [{ name: "Number", type: "String(20)" }, { name: "Total", type: "Decimal" }, { name: "Placed", type: "DateTime" }] },
            { op: "createMicroflow", module: mod, name: `${T}_SetAuth`, folder: "ZzSet", parameters: [{ name: "Request", type: "System.HttpRequest" }], returns: "System.User", returnValue: "empty" },
            { op: "createMicroflow", module: mod, name: `${T}_SetStatus`, folder: "ZzSet", parameters: [{ name: "Id", type: "String" }, http], returns: "String", returnValue: "'ok'", actions: [
                { action: "change", variable: "httpResponse", set: { StatusCode: "201", ReasonPhrase: "'Created'", Content: "'{}'" } },
                { action: "create", entity: "System.HttpHeader", variable: "Location", set: { Key: "'Location'", Value: "'/orders/' + $Id", "System.HttpHeaders": "$httpResponse" } }] },
            { op: "publishRest", module: mod, service: `${T}_SetPub`, resource: "orders", method: "Get", path: "{Id}", microflow: `${E}_SetStatus`, authentication: ["Microflow", "Basic"], authenticationMicroflow: `${E}_SetAuth`, folder: "ZzSet" },
            { op: "changePublishedRestService", service: `${E}_SetPub`, cors: { origins: `@${E}_Origins`, maxAge: `@${E}_MaxAge`, credentials: true } },
            { op: "createConsumedRestService", module: mod, name: `${T}_SetApi`, folder: "ZzSet", baseUrl: "https://api.example.com/v2", authentication: { bearer: "token" }, ...(v1017 ? { baseUrlParameter: "ApiUrl" } : {}),
                operations: [{ name: "GetOne", path: "/orders/{id}", parameters: { id: "Integer" }, testValues: { id: "42" } }] },
            { op: "addRestOperation", service: `${E}_SetApi`, name: "Ping", method: "Post", path: "/ping", body: "{ \"at\": \"{at}\" }" },
            { op: "changeRestOperation", operation: `${E}_SetApi.GetOne`, testValues: { token: "abc" } },
            { op: "createMicroflow", module: mod, name: `${T}_SetCall`, folder: "ZzSet", actions: [
                { action: "sendRestRequest", operation: `${E}_SetApi.GetOne`, ...(v1017 ? { baseUrl: `@${E}_ApiUrl` } : {}), args: { id: "1", token: "'t'" } },
                { action: "sendRestRequest", operation: `${E}_SetApi.Ping`, ...(v1017 ? { baseUrl: `@${E}_ApiUrl` } : {}), args: { at: "'now'", token: "'t'" } },
                { action: "callRest", url: "https://partner.example.com/orders", clientCertificate: "PartnerCert" }] },
            { op: "generateRestResource", module: mod, service: `${T}_SetCrud`, entity: `${E}SetOrder`, key: "Number", folder: "ZzSet" },
            { op: "createMicroflow", module: mod, name: `${T}_SetWsOp`, folder: "ZzSet", parameters: [{ name: "Order", type: `${E}SetOrder` }], returns: `${E}SetOrder`, returnValue: "$Order" },
            { op: "publishWebService", module: mod, name: `${T}_SetWs`, folder: "ZzSet", operations: [{ microflow: `${E}_SetWsOp`, attributes: { Order: ["Number"], result: ["Number", "Total"] } }] },
            ...(odata ? [
                { op: "createMicroflow", module: mod, name: `${T}_SetAct`, folder: "ZzSet", parameters: [{ name: "Code", type: "String" }, { name: "Order", type: `${E}SetOrder` }], returns: "Boolean", returnValue: "true" },
                { op: "createMicroflow", module: mod, name: `${T}_SetAct2`, folder: "ZzSet", returns: `List(${E}SetOrder)`, returnValue: "empty" },
                { op: "publishOData", module: mod, name: `${T}_SetOd`, folder: "ZzSet", entities: [`${E}SetOrder`], authentication: ["Microflow"], authenticationMicroflow: `${E}_SetAuth`,
                    microflows: [{ microflow: `${E}_SetAct`, exposedName: "Approve", optional: ["Code"] }, `${E}_SetAct2`] },
                { op: "changePublishedOData", service: `${E}_SetOd`, removeMicroflows: [`${T}_SetAct2`] }] : []),
            ...contract
        ],
        reject: [
            { op: { op: "addRestOperation", service: `${E}_SetApi`, name: "Up", method: "Post", path: "/up", body: { formData: { a: "1" } } }, expect: /form data, multipart and file bodies/ },
            { op: { op: "addRestOperation", service: `${E}_SetApi`, name: "Txt", path: "/t", response: "string" }, expect: /use the callRest action/ },
            { op: { op: "changePublishedRestService", service: `${E}_SetPub`, authenticationMicroflow: `${E}_SetStatus` }, expect: /returns a System\.User/ },
            { op: { op: "changePublishedRestService", service: `${E}_SetPub`, cors: { origins: "*" } }, expect: /is a constant/ },
            ...(v1017 ? [{ op: { op: "createMicroflow", module: mod, name: `${T}_SetBad`, actions: [{ action: "sendRestRequest", operation: `${E}_SetApi.GetOne`, args: { id: "1", token: "'t'" } }] }, expect: /base URL from parameter ApiUrl/ }] : [])
        ],
        probe: async () => (contractError ? [contractError] : [])
    };
}

function settingsProblems(project, T, version) {
    const r = [];
    const u = unitsNamed(project, `${T}_`);
    const pub = u[`${T}_SetPub`], api = u[`${T}_SetApi`], call = u[`${T}_SetCall`], st = u[`${T}_SetStatus`], crud = u[`${T}_SetCrud`], ws = u[`${T}_SetWs`];
    if (!pub || !api || !call || !st || !crud || !ws) return [`documents missing: ${["SetPub", "SetApi", "SetCall", "SetStatus", "SetCrud", "SetWs"].filter(n => !u[`${T}_${n}`]).join(", ")}`];
    if (!/_SetAuth$/.test(pub.AuthenticationMicroflow || "") || !pub.AuthenticationTypes.includes("Microflow")) r.push(`published REST authentication microflow ${pub.AuthenticationMicroflow}`);
    const cors = pub.CorsConfiguration;
    if (!cors || cors.$Type !== "Rest$CorsConfiguration" || !/_Origins$/.test(cors.AllowedOrigins) || !/_MaxAge$/.test(cors.MaxAge) || cors.AllowAuthentication !== true) r.push(`CORS ${JSON.stringify(cors)}`);
    const items = [];
    walk(st, o => o.$Type === "Microflows$ChangeActionItem" && items.push(`${o.Attribute || o.Association}`));
    for (const want of ["System.HttpResponse.StatusCode", "System.HttpResponse.ReasonPhrase", "System.HttpMessage.Content", "System.HttpHeader.Key", "System.HttpHeaders"]) if (!items.includes(want)) r.push(`HttpResponse microflow lacks ${want} (has ${items.join(", ")})`);
    let header = null;
    walk(st, o => o.$Type === "Microflows$CreateChangeAction" && (header = o));
    if (!header || header.Entity !== "System.HttpHeader") r.push("System.HttpHeader not created by name");
    for (const op of api.Operations) {
        if (!op.Headers.some(h => h.Name === "Authorization" && h.Value.Value === "Bearer {token}") || !op.Parameters.some(p => p.Name === "token")) r.push(`${op.Name}: no bearer header with its token parameter`);
    }
    const one = api.Operations.find(o => o.Name === "GetOne");
    const tv = n => ((one.Parameters.find(p => p.Name === n) || {}).TestValue || {}).Value;
    if (!one || tv("id") !== "42" || tv("token") !== "abc") r.push(`GetOne test values id=${one && tv("id")} token=${one && tv("token")}`);
    const v1017 = cmp(version, "10.17.0") >= 0;
    if (v1017) {
        if (!api.BaseUrlParameter || api.BaseUrlParameter.Name !== "ApiUrl" || api.BaseUrl.Value !== "{ApiUrl}" || api.BaseUrlParameter.TestValue.Value !== "https://api.example.com/v2") r.push(`base URL parameter ${JSON.stringify(api.BaseUrlParameter)} / base URL ${api.BaseUrl.Value}`);
        const maps = [];
        walk(call, o => o.$Type === "Microflows$RestOperationCallAction" && maps.push(o.BaseUrlParameterMapping));
        // by name with the service in it (Module.Service.ApiUrl), like the operation parameters
        if (maps.length !== 2 || maps.some(m => !m || m.$Type !== "Microflows$RestParameterMapping" || !new RegExp(`\\.${T}_SetApi\\.ApiUrl$`).test(m.Parameter) || !/_ApiUrl$/.test(m.Value))) r.push(`base URL mappings ${JSON.stringify(maps)}`);
    }
    let cert = null;
    walk(call, o => o.$Type === "Microflows$RestCallAction" && (cert = o.HttpConfiguration.ClientCertificate));
    if (cert !== "PartnerCert") r.push(`callRest client certificate ${cert}`);
    const ops = crud.Resources.flatMap(x => x.Operations);
    const methods = ops.map(o => `${o.HttpMethod} ${o.Path}`).sort().join(", ");
    if (methods !== "Delete {Key}, Get , Get {Key}, Post , Put {Key}") r.push(`generated resource: ${methods}`);
    const all = ops.find(o => o.HttpMethod === "Get" && o.Path === "");
    const listExm = all && unitsNamed(project, all.ExportMapping.split(".")[1])[all.ExportMapping.split(".")[1]];
    if (!listExm || listExm.Elements[0].MaxOccurs !== -1) r.push("Get all: export mapping over the root array (a list) missing");
    for (const o of ops.filter(o => o.HttpMethod === "Post" || o.HttpMethod === "Put")) if (!o.ImportMapping || !o.ExportMapping) r.push(`generated ${o.HttpMethod} lacks its mappings`);
    const imm = unitsNamed(project, `${T}_SetCrud_${T}SetOrder_Imm`)[`${T}_SetCrud_${T}SetOrder_Imm`];
    if (!imm || imm.Elements[0].ObjectHandling !== "Find") r.push("generated import mapping does not find by the key");
    const das = [];
    walk(ws, o => o.$Type === "WebServices$DataEntityImpl" && das.push(o.ChildMembers.length));
    if (das.sort().join() !== "1,2") r.push(`web service data entities with ${das.join(", ")} attribute(s), expected 1 and 2`);
    if (cmp(version, "10.4.0") >= 0) {
        const od = u[`${T}_SetOd`];
        const acts = od ? od.Microflows : [];
        if (!od || !/_SetAuth$/.test(od.AuthenticationMicroflow || "") || acts.length !== 1 || acts[0].ExposedName !== "Approve") r.push(`OData actions ${acts.map(a => a.ExposedName)} / authentication ${od && od.AuthenticationMicroflow}`);
        else {
            const ps = acts[0].Parameters;
            if (ps.length !== 2 || !ps.find(p => p.ExposedName === "Code").CanBeEmpty || !/_SetAct\.Code$/.test(ps[0].MicroflowParameter) || ps.find(p => p.ExposedName === "Order").DataType.$Type !== "DataTypes$ObjectType" || acts[0].ReturnType.$Type !== "DataTypes$BooleanType") r.push(`OData action Approve parameters ${JSON.stringify(ps.map(p => [p.ExposedName, p.MicroflowParameter, p.DataType.$Type, p.CanBeEmpty]))}`);
        }
    }
    // the contract plans
    const pets = u[`${T}_Pets`];
    if (!pets || pets.$Type !== "Rest$ConsumedRestService" || pets.Operations.length !== 3 || pets.BaseUrl.Value !== "https://pets.example.com/v1") r.push(`OpenAPI plan: service ${pets && pets.Operations.length} operation(s), base ${pets && pets.BaseUrl.Value}`);
    else {
        const list = pets.Operations.find(o => o.Name === "ListPets");
        if (!list || !list.Headers.some(h => h.Name === "X-Trace") || !list.Headers.some(h => h.Value.Value === "Bearer {token}") || !list.ResponseHandling || list.ResponseHandling.$Type !== "Rest$ImplicitMappingResponseHandling") r.push("OpenAPI ListPets: header, bearer or response mapping missing");
        const show = pets.Operations.find(o => o.Name === "ShowPet");
        if (!show || show.Path.Value !== "/pets/{petId}" || !show.Parameters.some(p => p.Name === "petId" && p.DataType.$Type === "DataTypes$IntegerType")) r.push("OpenAPI ShowPet path parameter");
        const create = pets.Operations.find(o => o.Name === "CreatePet");
        if (!create || create.Method.Body.$Type !== "Rest$ImplicitMappingBody") r.push("OpenAPI CreatePet: body mapping missing");
    }
    const xsd = Object.values(unitsNamed(project, "ZzCalc_Schema"))[0];
    if (!xsd || !xsd.Entries[0].Contents.includes("AddResponse")) r.push("WSDL plan: XML schema missing");
    const meta = unitsNamed(project, `IMM_${T}Custs`)[`IMM_${T}Custs`];
    if (!meta || !meta.Elements[0].Children.some(c => c.MaxOccurs === -1)) r.push("$metadata plan: import mapping of the entity set missing");
    return r;
}

module.exports = { runPhase, restPlan, restProblems, workflowPlan, workflowProblems, odataPlan, odataProblems, changePlan, changeProblems, settingsPlan, settingsProblems, unitsNamed, walk };
