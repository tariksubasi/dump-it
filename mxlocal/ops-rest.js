"use strict";
// REST integration documents: consumed REST services (Mendix 10.1+ REST client documents: base URL, Basic
// authentication, operations with method, path, parameters, query parameters, headers, body and response mapping), the
// sendRestRequest step that calls one of their operations, and published REST services (resources, operations with
// path/query/header/body parameters, import/export mappings, a microflow per operation, roles, version).
// No Studio Pro-saved consumed REST service exists in the test projects: these documents are built from the Model SDK's
// metamodel for the project's Mendix version (every property set as Studio Pro's defaults), and Studio Pro's own
// rules from mxcli's measurements (Accept header CE7062, a body for Post/Put/Patch CE7064, template parameters CE7056,
// no custom error handling on the call CE6035, BodyVariable only for a mapping body CE7067). Published REST services
// follow the Studio Pro samples of Mendix 8.18 (Charts) and mxcli's TestApp measurements.
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, noDollar, enumValue } = require("./ops-util");
const { snippetTree } = require("./ops-mappings");
const { cmp } = require("./versions");

const { rest, datatypes, microflows: mf, security, importmappings, exportmappings, mappings: mp } = sdk;

const OPERATION_FIELDS = {
    name: "R operation name, e.g. GetOrder",
    method: "optional Get | Post | Put | Patch | Delete | Head | Options (default Get)",
    path: "R path after the base URL; {name} is a parameter, e.g. /orders/{id}",
    parameters: "optional { \"name\": \"String | Integer | Long | Decimal | Boolean | DateTime\" } types of the {name} parameters in path, headers and body (default String)",
    query: "optional [ \"name\" ] or { \"name\": { \"required\": false } } query parameters (Mendix 10: added to the path as ?name={name})",
    headers: "optional { \"Name\": \"value template, {param} allowed\" } (default Accept: application/json; Content-Type: application/json with a body)",
    body: "Post/Put/Patch: a text template with {param} placeholders, or { \"snippet\": JSON, \"entity\": ..., \"entities\": ..., \"attributes\": ..., \"skip\": ..., \"create\": ... } (an export mapping of an object, like createExportMapping) (default \"{}\")",
    response: "optional \"none\" (default: the response is in $latestHttpResponse) or { \"snippet\": JSON, \"entity\": ..., \"entities\": ..., \"attributes\": ..., \"skip\": ..., \"keys\": ..., \"create\": ... } (an import mapping, like createImportMapping)",
    timeout: "optional seconds (default 300)"
};

const REST_OPS = {
    createConsumedRestService: {
        doc: "Create a consumed REST service (REST client document, Mendix 10.1+) with its operations; call them with the sendRestRequest action.",
        fields: {
            module: "R module name", name: "R service name, e.g. OrderApi", baseUrl: "R base URL, e.g. https://api.example.com/v1",
            authentication: "optional \"none\" (default) or { \"username\": \"text or @Module.Constant\", \"password\": \"text or @Module.Constant\" } (Basic)",
            operations: "R [ { \"name\": ..., \"method\": ..., \"path\": ..., \"parameters\": ..., \"query\": ..., \"headers\": ..., \"body\": ..., \"response\": ..., \"timeout\": ... } ] (ops addRestOperation lists the fields)",
            folder: "optional folder path"
        }
    },
    addRestOperation: { doc: "Add an operation to an existing consumed REST service.", fields: { service: "R Module.Service", ...OPERATION_FIELDS } },
    publishRest: {
        doc: "Publish a microflow as a REST operation (creates the service and resource when missing). Parameters: {Name} in the path -> path, object/list -> body (needs importMapping), System.HttpRequest/HttpResponse -> none, others query (or header). An object/list result needs exportMapping.",
        fields: {
            module: "R module name", service: "R service name, e.g. OrderAPI", resource: "R resource name, e.g. orders", method: "R Get | Post | Put | Patch | Delete", microflow: "R Module.Microflow",
            path: "optional operation path, e.g. {OrderId} (default empty)", headers: "optional [ \"MicroflowParameter\" ] passed as HTTP headers instead of query parameters",
            importMapping: "optional Module.ImportMapping for the object/list body parameter", exportMapping: "optional Module.ExportMapping for an object/list result",
            commit: "optional with importMapping: yes | no | withoutEvents (default yes)", summary: "optional operation summary (OpenAPI)", description: "optional operation description (OpenAPI)", deprecated: "optional true/false",
            create: "optional true: create the microflow when it does not exist (parameters from the path, headers, query and importMapping; returns String or the exportMapping's entity)",
            query: "with create: [ \"name\" ] String query parameters of the new microflow",
            servicePath: "optional base path for a new service (default rest/<service>/v1)", version: "optional service version for a new service, shown in its OpenAPI document (default 1.0.0)",
            authentication: "optional [ \"Basic\" | \"Session\" | \"Microflow\" | \"Guest\" ] for a new service (default [\"Basic\"])", roles: "optional [ \"Module.Role\" ] allowed to call the service", folder: "optional folder path for a new service"
        }
    }
};

const TYPES = { string: datatypes.StringType, integer: datatypes.IntegerType, long: datatypes.IntegerType, decimal: datatypes.DecimalType, boolean: datatypes.BooleanType, datetime: datatypes.DateTimeType };
const placeholders = text => [...String(text || "").matchAll(/\{(\w+)\}/g)].map(m => m[1]);
const qn = o => o.qualifiedName;
// Query parameters of an operation, or null before Mendix 11 (they are part of the path template there)
function queryParamsOf(op) {
    try {
        return op.queryParameters ? [...op.queryParameters] : null;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------- sendRestRequest (an action in ops-flows.js)

// The operation of "Module.Service.Operation", loaded.
async function operationOf(h, name, where) {
    const parts = String(name || "").split(".");
    if (parts.length !== 3) throw new Error(`${where}: operation is Module.Service.Operation, got '${name}'`);
    const svcQn = parts.slice(0, 2).join(".");
    const svc = await h.get(svcQn).catch(() => fail(`${where}: no consumed REST service ${svcQn}`, svcQn, h.model.allConsumedRestServices().map(qn)));
    if (!(svc instanceof rest.ConsumedRestService)) throw new Error(`${where}: ${svcQn} is not a consumed REST service`);
    const op = svc.operations.find(x => x.name === parts[2]);
    if (!op) fail(`${where}: ${svcQn} has no operation '${parts[2]}'`, parts[2], svc.operations.map(x => x.name));
    return op;
}

// Entity and list-ness of what an operation's response mapping creates, or null.
function responseOf(op) {
    const r = op.responseHandling;
    if (!(r instanceof rest.ImplicitMappingResponseHandling) || !r.rootMappingElement) return null;
    return { entity: r.rootMappingElement.entityQualifiedName, list: r.rootMappingElement.maxOccurs === -1 };
}

const REST_ACTIONS = {
    sendRestRequest: {
        doc: "Call an operation of a consumed REST service (microflows only). The response is in $latestHttpResponse; with a response mapping, 'variable' gets the object (or list).",
        fields: {
            operation: "R Module.Service.Operation",
            args: "optional { \"param\": \"expression\" } for the {param} parameters of path, headers and body (every parameter needs one)",
            query: "optional { \"name\": \"expression\" } query parameters (every required one; Mendix 10: give them in args)",
            body: "with a mapping body: the object variable to send (no $)",
            variable: "optional result variable: the object or list the response mapping creates"
        },
        only: "micro",
        creates: "variable",
        type: () => mf.RestOperationCallAction,
        async build(c, act, spec, where) {
            if (spec.onError !== undefined) throw new Error(`${where}: sendRestRequest has no custom error handling in Mendix (CE6035); check $latestHttpResponse/StatusCode after it, or use callRest`);
            const op = await operationOf(c.h, spec.operation, where);
            const a = mf.RestOperationCallAction.createIn(act);
            a.operation = op;
            let args = spec.args || {};
            let query = spec.query || {};
            // Mendix 10: query parameters are parameters of the path template
            if (!queryParamsOf(op) && typeof query === "object" && !Array.isArray(query)) {
                args = { ...query, ...args };
                query = {};
            }
            for (const [k, v] of [["args", args], ["query", query]]) if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: ${k} must be { "name": "expression" }`);
            const params = [...op.parameters];
            for (const k of Object.keys(args)) if (!params.some(p => p.name === k)) fail(`${where}: ${spec.operation} has no parameter '${k}'${(queryParamsOf(op) || []).some(q => q.name === k) ? " (it is a query parameter: put it in \"query\")" : ""}`, k, params.map(p => p.name));
            const missing = params.filter(p => !(p.name in args));
            if (missing.length) throw new Error(`${where}: ${spec.operation} needs args for: ${missing.map(p => p.name).join(", ")}`);
            for (const p of params) {
                const pm = mf.RestOperationParameterMapping.createIn(a);
                pm.parameter = p;
                pm.value = c.expr(args[p.name], `${where} ${p.name}`);
            }
            const qps = queryParamsOf(op) || [];
            for (const k of Object.keys(query)) if (!qps.some(q => q.name === k)) fail(`${where}: ${spec.operation} has no query parameter '${k}'`, k, qps.map(q => q.name));
            for (const q of qps) {
                const required = q.parameterUsage instanceof rest.RequiredQueryParameterUsage;
                if (required && !(q.name in query)) throw new Error(`${where}: ${spec.operation} needs a value for query parameter '${q.name}' (in "query")`);
                const qm = mf.QueryParameterMapping.createIn(a);
                qm.queryParameter = q;
                qm.value = q.name in query ? c.expr(query[q.name], `${where} query ${q.name}`) : "";
                qm.included = q.name in query ? (required ? mf.IncludedOption.Yes : mf.IncludedOption.WhenNotNull) : mf.IncludedOption.No;
            }
            const method = op.method;
            const mapped = method instanceof rest.RestOperationMethodWithBody && method.body instanceof rest.ImplicitMappingBody;
            if (mapped) {
                if (!spec.body) throw new Error(`${where}: ${spec.operation} sends an object: give "body": the variable of ${method.body.rootMappingElement ? method.body.rootMappingElement.entityQualifiedName : "its entity"}`);
                const want = method.body.rootMappingElement && method.body.rootMappingElement.entityQualifiedName;
                const have = await c.needVariable(spec.body, false, where);
                if (want && have !== want) throw new Error(`${where}: ${spec.operation} sends ${want}, but $${noDollar(spec.body)} is ${have}`);
                mf.BodyVariable.createIn(a).variableName = noDollar(spec.body);
            } else if (spec.body !== undefined) throw new Error(`${where}: ${spec.operation} has no mapping body; its body template is filled from args`);
            const res = responseOf(op);
            if (spec.variable) {
                if (!res) throw new Error(`${where}: ${spec.operation} has no response mapping; the response is in $latestHttpResponse (remove 'variable', or give the operation a "response" mapping)`);
                mf.OutputVariable.createIn(a).variableName = noDollar(spec.variable);
            }
            return a;
        },
        vars: a => (a.outputVariable && a.outputVariable.variableName ? [a.outputVariable.variableName] : []),
        info: a => responseOf(a.operation) || { entity: null, list: false },
        // the stored fields, for changeAction (operation, args, query, body, variable)
        spec(a) {
            if (a.baseUrlParameterMapping) throw new Error(`SEND REST ${a.operationQualifiedName}: it maps the base URL parameter, which ops does not write; change it in Studio Pro`);
            const name = (ref, qn) => (ref && ref.name) || String(qn || "").split(".").pop();
            const out = { operation: a.operationQualifiedName, args: Object.fromEntries(a.parameterMappings.map(m => [name(m.parameter, m.parameterQualifiedName), m.value])) };
            let q = [];
            try {
                q = a.queryParameterMappings.filter(m => m.included && m.included.name !== "No");
            } catch (e) {
                q = []; // Mendix 10: query parameters are path parameters (args)
            }
            if (q.length) out.query = Object.fromEntries(q.map(m => [name(m.queryParameter, m.queryParameterQualifiedName), m.value]));
            if (a.bodyVariable && a.bodyVariable.variableName) out.body = a.bodyVariable.variableName;
            if (a.outputVariable && a.outputVariable.variableName) out.variable = a.outputVariable.variableName;
            return out;
        },
        describe: a => `SEND REST ${a.operationQualifiedName || "?"}${a.outputVariable ? " -> $" + a.outputVariable.variableName : ""}`
    }
};

// ---------------------------------------------------------------- bound operations

function makeRest(h) {
    const { model, get, exists, folder, version } = h;
    const atLeast = v => cmp(version, v) >= 0;
    const warn = w => h.client && h.client.warn(w);

    // rest.Value: "@Module.Constant" -> constant, else text
    async function value(owner, prop, v, where) {
        const s = String(v === undefined || v === null ? "" : v);
        if (s.startsWith("@")) {
            const c = await get(s.slice(1)).catch(() => fail(`${where}: no constant ${s.slice(1)}`, s.slice(1), model.allConstants().map(qn)));
            if (!(c instanceof sdk.constants.Constant)) throw new Error(`${where}: ${s.slice(1)} is not a constant`);
            const cv = rest.ConstantValue.create(model);
            owner[prop] = cv;
            cv.value = c;
        } else {
            const sv = rest.StringValue.create(model);
            owner[prop] = sv;
            sv.value = s;
        }
    }

    function dataType(spec, where) {
        const T = TYPES[String(spec || "String").toLowerCase()];
        if (!T) fail(`${where}: type '${spec}' is not String, Integer, Long, Decimal, Boolean or DateTime`, spec, ["String", "Integer", "Long", "Decimal", "Boolean", "DateTime"]);
        return T.create(model);
    }

    // An inline mapping of a snippet onto entities (import: the response; export: the body), like createImportMapping.
    async function inlineMapping(spec, imp, svcQn, opName, where, rootCreate) {
        const m = svcQn.split(".")[0];
        for (const k of Object.keys(spec)) if (!["snippet", "entity", "entities", "attributes", "skip", "keys", "create", "persistable"].includes(k) || (!imp && k === "keys")) fail(`${where}: unknown field '${k}' in the ${imp ? "response" : "body"} mapping`, k, ["snippet", "entity", "entities", "attributes", "skip", ...(imp ? ["keys"] : []), "create", "persistable"]);
        if (spec.snippet === undefined) throw new Error(`${where}: a ${imp ? "response" : "body"} mapping needs "snippet": a JSON example`);
        const text = typeof spec.snippet === "string" ? spec.snippet : JSON.stringify(spec.snippet, null, 4);
        const tree = snippetTree(text);
        const o = { ...spec, module: m, name: `${svcQn.split(".")[1]}.${opName}`, jsonStructure: "the snippet" };
        const plan = h.mappingInternals.planMapping(o, tree, imp);
        const created = await h.mappingInternals.resolve(plan, o, imp);
        h.mappingInternals.writeMapping(null, plan, imp, rootCreate);
        return { plan, created };
    }

    async function addOperation(svc, o, where) {
        validName(o.name, "operation name");
        if (svc.operations.some(x => x.name === o.name)) throw new Error(`${where}: ${qn(svc)} already has an operation ${o.name}`);
        for (const k of Object.keys(o)) if (!OPERATION_FIELDS[k] && k !== "service" && k !== "op") fail(`${where}: unknown field '${k}' for an operation`, k, Object.keys(OPERATION_FIELDS));
        for (const [k, d] of Object.entries(OPERATION_FIELDS)) if (d.startsWith("R ") && (o[k] === undefined || o[k] === "")) throw new Error(`${where}: an operation needs '${k}' (${d.slice(2)})`);
        const httpMethod = enumValue(sdk.services.HttpMethod, o.method || "Get", `${where} method`);
        const withBody = ["Post", "Put", "Patch"].includes(httpMethod.name);
        if (!withBody && o.body !== undefined) throw new Error(`${where}: a ${httpMethod.name} request has no body (use Post, Put or Patch)`);
        const op = rest.RestOperation.createIn(svc);
        op.name = o.name;
        let path = String(o.path);
        if (/^https?:/i.test(path)) throw new Error(`${where}: path is the part after the base URL (${svc.baseUrl.value}), e.g. /orders/{id}`);
        if (path && !path.startsWith("/")) path = "/" + path;
        // query parameters: own elements from Mendix 11; before that part of the path template
        const query = Array.isArray(o.query) ? Object.fromEntries(o.query.map(n => [n, {}])) : o.query || {};
        if (typeof query !== "object") throw new Error(`${where}: query is [ "name" ] or { "name": { "required": false } }`);
        const types = o.parameters || {};
        if (typeof types !== "object" || Array.isArray(types)) throw new Error(`${where}: parameters is { "name": "String" }`);
        if (!atLeast("11.0.0") && Object.keys(query).length) {
            if (Object.values(query).some(q => q && q.required === false)) throw new Error(`${where}: optional query parameters need Mendix 11 (this project is ${version}); make them required or add them in Studio Pro`);
            path += (path.includes("?") ? "&" : "?") + Object.keys(query).map(n => `${n}={${n}}`).join("&");
        }
        op.path.value = path;
        op.timeout = o.timeout === undefined ? 300 : Number(o.timeout);
        if (!Number.isInteger(op.timeout) || op.timeout < 0) throw new Error(`${where}: timeout is a number of seconds`);
        const headers = { ...(o.headers || {}) };
        if (typeof o.headers === "object" && Array.isArray(o.headers)) throw new Error(`${where}: headers is { "Name": "value" }`);
        const hasHeader = n => Object.keys(headers).some(k => k.toLowerCase() === n.toLowerCase());
        if (!hasHeader("Accept")) headers.Accept = "application/json"; // CE7062: every operation has an Accept header
        // body: Studio Pro wants one for Post/Put/Patch (CE7064)
        let bodyText = null;
        const method = (withBody ? rest.RestOperationMethodWithBody : rest.RestOperationMethodWithoutBody).create(model);
        op.method = method;
        method.httpMethod = httpMethod;
        let created = [];
        if (withBody) {
            if (o.body !== undefined && typeof o.body === "object" && o.body !== null) {
                const b = rest.ImplicitMappingBody.create(model);
                method.body = b;
                created = created.concat((await inlineMapping(o.body, false, qn(svc), o.name, `${where} body`, OBJ => OBJ.createInImplicitMappingBodyUnderRootMappingElement(b))).created);
                if (b.rootMappingElement.maxOccurs === -1) throw new Error(`${where}: the body snippet is an array; send one object (an object around the array)`);
                await value(b, "testValue", "", where);
            } else {
                bodyText = o.body === undefined ? "{}" : String(o.body);
                const b = rest.StringBody.create(model);
                method.body = b;
                b.valueTemplate.value = bodyText;
            }
            if (!hasHeader("Content-Type")) headers["Content-Type"] = "application/json";
        }
        for (const [k, v] of Object.entries(headers)) {
            const hd = rest.HeaderWithValueTemplate.createIn(op);
            hd.name = k;
            hd.value.value = String(v);
        }
        // parameters: every {name} in path, headers and body (CE7056); query parameters of Mendix 11 are separate
        const used = [...new Set([...placeholders(path), ...Object.values(headers).flatMap(placeholders), ...placeholders(bodyText)])];
        for (const k of Object.keys(types)) if (!used.includes(k)) fail(`${where}: parameters names '${k}', which is not a {placeholder} in path, headers or body`, k, used);
        for (const n of used) {
            validName(n, "parameter name");
            const p = rest.OperationParameter.createIn(op);
            p.name = n;
            p.dataType = dataType(types[n], `${where} parameter ${n}`);
            await value(p, "testValue", "", where);
        }
        if (atLeast("11.0.0")) {
            for (const [n, q] of Object.entries(query)) {
                validName(n, "query parameter name");
                if (used.includes(n)) throw new Error(`${where}: '${n}' is both a {placeholder} and a query parameter`);
                const qp = rest.QueryParameter.createIn(op);
                qp.name = n;
                qp.testValue = "";
                if (q && q.required === false) rest.OptionalQueryParameterUsage.createIn(qp).included = true;
                else rest.RequiredQueryParameterUsage.createIn(qp);
            }
        }
        if (o.response === undefined || /^none$/i.test(String(o.response))) {
            const r = rest.NoResponseHandling.create(model);
            op.responseHandling = r;
            r.statusCode = 200;
            r.contentType = "application/json";
        } else {
            if (typeof o.response !== "object") throw new Error(`${where}: response is "none" or { "snippet": ..., "entity": ... }`);
            const r = rest.ImplicitMappingResponseHandling.create(model);
            op.responseHandling = r;
            r.statusCode = 200;
            r.contentType = "application/json";
            created = created.concat((await inlineMapping(o.response, true, qn(svc), o.name, `${where} response`, OBJ => OBJ.createInImplicitMappingResponseHandlingUnderRootMappingElement(r))).created);
        }
        const res = responseOf(op);
        return `${httpMethod.name.toUpperCase()} ${path}` + (res ? ` -> ${res.list ? "list of " : ""}${res.entity}` : "") + (created.length ? ` (created: ${created.join(", ")})` : "");
    }

    async function service(name, where) {
        const svc = await get(name).catch(() => fail(`${where}: no consumed REST service ${name}`, name, model.allConsumedRestServices().map(qn)));
        if (!(svc instanceof rest.ConsumedRestService)) throw new Error(`${where}: ${name} is not a consumed REST service`);
        return svc;
    }

    // ------------------------------------------------ published REST

    const special = t => t && ["System.HttpRequest", "System.HttpResponse"].includes(t.entityQualifiedName);
    const isObj = t => t instanceof datatypes.ObjectType || t instanceof datatypes.ListType;
    const copyType = t => {
        const c = sdk.datatypes[t.structureTypeName.split("$")[1]].create(model);
        if (t instanceof datatypes.EnumerationType) c.enumeration = t.enumeration;
        if (isObj(t)) c.entity = t.entity;
        return c;
    };

    async function mappingDoc(name, imp, where) {
        const T = imp ? importmappings.ImportMapping : exportmappings.ExportMapping;
        const all = (imp ? model.allImportMappings() : model.allExportMappings()).map(qn);
        const d = await get(name).catch(() => fail(`${where}: no ${imp ? "import" : "export"} mapping ${name}`, name, all));
        if (!(d instanceof T)) fail(`${where}: ${name} is not an ${imp ? "import" : "export"} mapping`, name, all);
        const root = d.rootMappingElements[0];
        if (!root || !root.entityQualifiedName) throw new Error(`${where}: ${name} has no root entity (finish it in Studio Pro)`);
        return { d, entity: root.entityQualifiedName, list: root.maxOccurs === -1 };
    }

    // A microflow for an operation that does not exist yet: its parameters from the path, headers, query and import mapping.
    async function newMicroflow(o, where) {
        const params = [];
        for (const n of placeholders(o.path)) params.push({ name: n, type: "String" });
        for (const n of [].concat(o.query || [], o.headers || [])) if (!params.some(p => p.name === n)) params.push({ name: n, type: "String" });
        if (o.importMapping) {
            const im = await mappingDoc(o.importMapping, true, where);
            params.push({ name: im.entity.split(".")[1], type: im.list ? `List(${im.entity})` : im.entity });
        }
        let returns = "String", returnValue = "''";
        if (o.exportMapping) {
            const em = await mappingDoc(o.exportMapping, false, where);
            returns = em.list ? `List(${em.entity})` : em.entity;
            returnValue = "empty";
        }
        const [m, name] = o.microflow.split(".");
        await h.impl().createMicroflow({ module: m, name, folder: o.folder, parameters: params, returns, returnValue, actions: [] });
        return `${o.microflow} (new: ${params.map(p => `${p.name}: ${p.type}`).join(", ") || "no parameters"} -> ${returns})`;
    }

    const impl = {
        async createConsumedRestService(o) {
            if (!atLeast("10.1.0")) throw new Error(`consumed REST services need Mendix 10.1 (this project is ${version}); use the callRest action`);
            validName(o.name, "service name");
            const name = `${o.module}.${o.name}`;
            if (await exists(name)) throw new Error(`${name} already exists`);
            if (!/^https?:\/\/\S+$/i.test(String(o.baseUrl))) throw new Error(`baseUrl must be an http(s) URL, e.g. https://api.example.com/v1 (got '${o.baseUrl}')`);
            if (!Array.isArray(o.operations) || !o.operations.length) throw new Error(`${name} needs operations: [ { "name": ..., "path": ... } ]`);
            const svc = rest.ConsumedRestService.createIn(folder(o.module, o.folder));
            svc.name = o.name;
            svc.baseUrl.value = String(o.baseUrl).replace(/\/+$/, "");
            const auth = o.authentication;
            if (auth !== undefined && !/^none$/i.test(String(auth))) {
                if (typeof auth !== "object" || auth.username === undefined || auth.password === undefined) throw new Error(`${name}: authentication is "none" or { "username": ..., "password": ... } (Basic)`);
                for (const k of Object.keys(auth)) if (!["username", "password"].includes(k)) fail(`${name}: unknown authentication field '${k}'`, k, ["username", "password"]);
                const b = rest.BasicAuthenticationScheme.create(model);
                svc.authenticationScheme = b;
                await value(b, "username", auth.username, `${name} username`);
                await value(b, "password", auth.password, `${name} password`);
            }
            const lines = [];
            for (const [i, op] of o.operations.entries()) {
                if (!op || typeof op !== "object") throw new Error(`${name} operation ${i + 1}: { "name": ..., "path": ... }`);
                lines.push(`${op.name}: ${await addOperation(svc, op, `${name} operation ${i + 1} (${op.name})`)}`);
            }
            warn(`Rest$ConsumedRestService first use by ops (no Studio Pro sample in the test projects; built from the Model SDK metamodel of Mendix ${version}): check ${name} in Studio Pro`);
            return `${name} (${svc.baseUrl.value}${svc.authenticationScheme ? ", Basic authentication" : ""})` + lines.map(l => "\n      " + l).join("");
        },
        async addRestOperation(o) {
            const svc = await service(o.service, "addRestOperation");
            const { service: _s, ...spec } = o;
            const line = await addOperation(svc, spec, `${o.service}.${o.name}`);
            warn(`Rest$RestOperation first use by ops (no Studio Pro sample in the test projects): check ${o.service}.${o.name} in Studio Pro`);
            return `${o.service}.${o.name}: ${line}`;
        },
        async publishRest(o) {
            const where = `${o.module}.${o.service}`;
            let made = null;
            if (!(await exists(o.microflow))) {
                if (!bool(o.create, false)) fail(`${o.microflow} not found; add "create": true to create it`, o.microflow, model.allMicroflows().map(qn));
                made = await newMicroflow(o, where);
            } else if (o.query !== undefined) throw new Error(`'query' only applies with "create": true (the microflow's own parameters are used)`);
            const mfl = await get(o.microflow);
            if (!(mfl instanceof mf.Microflow)) throw new Error(`'${o.microflow}' is not a microflow`);
            const ret = mfl.microflowReturnType;
            let em = null, im = null;
            if (o.exportMapping) {
                em = await mappingDoc(o.exportMapping, false, where);
                if (!ret || !isObj(ret) || special(ret)) throw new Error(`${o.microflow} returns no object or list; exportMapping only applies to an object/list result`);
                if (ret.entityQualifiedName !== em.entity || (ret instanceof datatypes.ListType) !== em.list) throw new Error(`${o.exportMapping} exports ${em.list ? "a list of " : ""}${em.entity}, but ${o.microflow} returns ${ret instanceof datatypes.ListType ? "a list of " : ""}${ret.entityQualifiedName}`);
            } else if (ret && isObj(ret) && !special(ret)) throw new Error(`${o.microflow} returns an object/list; give "exportMapping": an export mapping of ${ret.entityQualifiedName} (create one with createExportMapping)`);
            if (o.importMapping) im = await mappingDoc(o.importMapping, true, where);
            if (o.commit !== undefined && !im) throw new Error("'commit' only applies with importMapping");
            const name = `${o.module}.${o.service}`;
            let svc;
            if (await exists(name)) {
                svc = await get(name);
                if (!(svc instanceof rest.PublishedRestService)) throw new Error(`${name} exists and is not a published REST service`);
            } else {
                svc = rest.PublishedRestService.createIn(folder(o.module, o.folder));
                svc.name = o.service;
                svc.serviceName = o.service;
                svc.version = o.version === undefined ? "1.0.0" : String(o.version);
                svc.path = o.servicePath || `rest/${o.service.toLowerCase()}/v1`;
                svc.authenticationTypes.clear();
                for (const a of [].concat(o.authentication || ["Basic"])) svc.authenticationTypes.push(enumValue(rest.RestAuthenticationType, a, "authentication"));
            }
            for (const r of [].concat(o.roles || [])) {
                const role = await get(r);
                if (!(role instanceof security.ModuleRole)) throw new Error(`'${r}' is not a module role`);
                if (!svc.allowedRoles.includes(role)) svc.allowedRoles.push(role);
            }
            let res = svc.resources.find(x => x.name === o.resource);
            if (!res) {
                res = rest.PublishedRestServiceResource.createIn(svc);
                res.name = o.resource;
            }
            const method = enumValue(sdk.services.HttpMethod, o.method, "method");
            const path = String(o.path || "");
            if (res.operations.some(x => x.httpMethod === method && x.path === path)) throw new Error(`${name}/${o.resource}: ${o.method} '${path}' already exists`);
            const op = rest.PublishedRestServiceOperation.createIn(res);
            op.httpMethod = method;
            op.path = path;
            op.microflow = mfl;
            op.summary = String(o.summary || "");
            op.documentation = String(o.description || "");
            op.deprecated = bool(o.deprecated, false);
            op.commit = mf.CommitEnum.No;
            if (em) op.exportMapping = em.d;
            if (im) {
                op.importMapping = im.d;
                const c = { yes: "Yes", no: "No", withoutevents: "YesWithoutEvents" }[String(o.commit === undefined ? "yes" : o.commit).toLowerCase()];
                if (!c) fail(`commit '${o.commit}' is not one of yes | no | withoutEvents`, o.commit, ["yes", "no", "withoutEvents"]);
                op.commit = mf.CommitEnum[c];
            }
            const inPath = new Set(placeholders(path));
            const headers = new Set([].concat(o.headers || []));
            let body = 0;
            const kinds = [];
            for (const p of mfl.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject)) {
                const t = p.variableType;
                if (special(t)) continue; // System.HttpRequest/HttpResponse are passed by the runtime
                let kind;
                if (isObj(t)) {
                    if (!im) throw new Error(`${o.microflow} parameter '${p.name}' is an object/list: give "importMapping" (an import mapping of ${t.entityQualifiedName}) to fill it from the request body`);
                    if (t.entityQualifiedName !== im.entity) throw new Error(`${o.importMapping} imports ${im.entity}, but parameter '${p.name}' is ${t.entityQualifiedName}`);
                    if (++body > 1) throw new Error(`${o.microflow} has more than one object/list parameter; only one can be the body`);
                    kind = rest.RestOperationParameterType.Body;
                } else if (inPath.has(p.name)) kind = rest.RestOperationParameterType.Path;
                else if (headers.has(p.name)) kind = rest.RestOperationParameterType.Header;
                else kind = rest.RestOperationParameterType.Query;
                const rp = rest.RestOperationParameter.createInPublishedRestServiceOperationUnderParameters(op);
                rp.name = p.name;
                rp.microflowParameter = p;
                rp.parameterType = kind;
                rp.type = copyType(t);
                inPath.delete(p.name);
                headers.delete(p.name);
                kinds.push(`${p.name}: ${kind.name.toLowerCase()}`);
            }
            if (inPath.size) throw new Error(`path has {${[...inPath].join("}, {")}} but ${o.microflow} has no such parameter`);
            if (headers.size) throw new Error(`headers names ${[...headers].join(", ")}, which ${o.microflow} has no parameter for`);
            if (im && !body) throw new Error(`${o.microflow} has no object/list parameter of ${im.entity} for the importMapping body`);
            return `${name}: ${o.method.toUpperCase()} /${svc.path}/${o.resource}${path ? "/" + path : ""} -> ${o.microflow}${kinds.length ? ` (${kinds.join(", ")})` : ""}${em ? `, result by ${o.exportMapping}` : ""}${made ? `\n      microflow ${made}` : ""}`;
        }
    };

    const checks = {
        async createConsumedRestService(o) {
            const svc = await get(`${o.module}.${o.name}`);
            if (!(svc instanceof rest.ConsumedRestService)) return [`${o.module}.${o.name} is not a consumed REST service`];
            const missing = o.operations.filter(x => !svc.operations.some(y => y.name === x.name)).map(x => x.name);
            return missing.length ? [`${o.module}.${o.name} lacks operations ${missing.join(", ")}`] : [];
        },
        async addRestOperation(o) {
            const svc = await get(o.service);
            return svc.operations && svc.operations.some(y => y.name === o.name) ? [] : [`${o.service} has no operation ${o.name}`];
        },
        async publishRest(o) {
            const svc = await get(`${o.module}.${o.service}`);
            const res = svc.resources.find(x => x.name === o.resource);
            const op = res && res.operations.find(x => x.microflowQualifiedName === o.microflow);
            if (!op) return [`${o.module}.${o.service}/${o.resource} has no operation for ${o.microflow}`];
            const r = [];
            if (o.exportMapping && op.exportMappingQualifiedName !== o.exportMapping) r.push(`${o.microflow} operation has export mapping ${op.exportMappingQualifiedName}`);
            if (o.importMapping && op.importMappingQualifiedName !== o.importMapping) r.push(`${o.microflow} operation has import mapping ${op.importMappingQualifiedName}`);
            return r;
        }
    };

    return { impl, checks };
}

module.exports = { makeRest, REST_OPS, REST_ACTIONS };
