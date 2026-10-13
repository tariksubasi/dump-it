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
    if (!svc.AuthenticationScheme || svc.AuthenticationScheme.$Type !== "Rest$BasicAuthentication" || svc.AuthenticationScheme.Password.$Type !== "Rest$ConstantValue") r.push("Basic authentication with a constant password missing");
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

module.exports = { runPhase, restPlan, restProblems, unitsNamed, walk };
