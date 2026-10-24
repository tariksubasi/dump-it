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
    timeout: "optional seconds (default 300)",
    testValues: "optional { \"param\": \"value\" } test values of the parameters (Studio Pro: Test value; used by its Send request button)"
};

const REST_OPS = {
    createConsumedRestService: {
        doc: "Create a consumed REST service (REST client document, Mendix 10.1+) with its operations; call them with the sendRestRequest action.",
        fields: {
            module: "R module name", name: "R service name, e.g. OrderApi", baseUrl: "R base URL, e.g. https://api.example.com/v1",
            authentication: "optional \"none\" (default), { \"username\": \"text or @Module.Constant\", \"password\": \"text or @Module.Constant\" } (Basic) or { \"bearer\": \"token\" } (every operation gets the header Authorization: Bearer {token} and a String parameter token, filled in sendRestRequest args)",
            baseUrlParameter: "optional name of a String parameter for the base URL (Mendix 10.17+), e.g. ApiUrl: sendRestRequest gives it in \"baseUrl\"; baseUrl is then its test value",
            operations: "R [ { \"name\": ..., \"method\": ..., \"path\": ..., \"parameters\": ..., \"query\": ..., \"headers\": ..., \"body\": ..., \"response\": ..., \"timeout\": ... } ] (ops addRestOperation lists the fields)",
            folder: "optional folder path"
        }
    },
    addRestOperation: { doc: "Add an operation to an existing consumed REST service.", fields: { service: "R Module.Service", ...OPERATION_FIELDS } },
    changeRestService: {
        doc: "Change a consumed REST service: base URL, base URL parameter and authentication.",
        fields: {
            service: "R Module.Service", baseUrl: "optional new base URL, e.g. https://api.example.com/v2",
            authentication: "optional \"none\", { \"username\": ..., \"password\": ... } (Basic; values text or @Module.Constant) or { \"bearer\": \"token\" } (Authorization: Bearer {token} header on every operation)",
            baseUrlParameter: "optional name of a String parameter for the base URL (Mendix 10.17+), or \"none\" to remove it (only when no sendRestRequest maps it)"
        }
    },
    changeRestOperation: {
        doc: "Change an operation of a consumed REST service: method, path, parameters, query, headers, body, response mapping, timeout. Give only what changes; {placeholders} are recomputed and the sendRestRequest steps that call it are listed.",
        fields: {
            operation: "R Module.Service.Operation", method: "optional new method", path: "optional new path after the base URL",
            parameters: "optional { \"name\": \"type\" } types of {name} parameters (others keep theirs, new ones default String)",
            query: "optional query parameters, replaces them all (as in addRestOperation)", headers: "optional { \"Name\": \"value\" } added or changed; { \"Name\": null } removes one (not Accept)",
            body: "optional new body: text template or { \"snippet\": ..., \"entity\": ... } export mapping (Post/Put/Patch)", response: "optional new response: \"none\" or { \"snippet\": ..., \"entity\": ... } import mapping",
            timeout: "optional seconds", testValues: "optional { \"param\": \"value\" } test values (Studio Pro: Test value)"
        }
    },
    deleteRestOperation: { doc: "Delete an operation of a consumed REST service; lists the sendRestRequest steps that still call it.", fields: { operation: "R Module.Service.Operation" } },
    changePublishedRestService: {
        doc: "Change a published REST service: path, version, authentication (with the authentication microflow), allowed roles, CORS.",
        fields: {
            service: "R Module.Service", path: "optional base path, e.g. rest/orders/v2", version: "optional version, e.g. 2.0.0", authentication: "optional [ \"Basic\" | \"Session\" | \"Microflow\" | \"Guest\" ] (replaces)",
            authenticationMicroflow: "with Microflow authentication: Module.Microflow that returns the System.User (optional parameter of type System.HttpRequest); \"\" removes",
            roles: "optional [ \"Module.Role\" ] (replaces)",
            cors: "optional \"none\" or { \"origins\": \"@Module.Constant\" (String constant: allowed origins, e.g. https://a.example.com,https://b.example.com or *), \"maxAge\": \"@Module.Constant\" (Integer constant, seconds; optional), \"credentials\": true/false (allow authentication, default false) }"
        }
    },
    changePublishedRestOperation: {
        doc: "Change an operation of a published REST service (found by resource, method and path): new method, path, microflow, mappings, summary. Its parameters are made again from the microflow.",
        fields: {
            service: "R Module.Service", resource: "R resource name", method: "R current method", path: "optional current operation path (default empty)",
            newMethod: "optional", newPath: "optional", microflow: "optional Module.Microflow", importMapping: "optional Module.ImportMapping, \"\" removes", exportMapping: "optional Module.ExportMapping, \"\" removes",
            commit: "optional yes | no | withoutEvents", headers: "optional [ \"MicroflowParameter\" ] passed as headers (replaces)", summary: "optional", description: "optional", deprecated: "optional true/false"
        }
    },
    deletePublishedRestOperation: { doc: "Delete an operation of a published REST service (found by resource, method and path).", fields: { service: "R Module.Service", resource: "R resource name", method: "R Get | Post | Put | Patch | Delete", path: "optional operation path (default empty)" } },
    deletePublishedRestResource: { doc: "Delete a resource of a published REST service with all its operations.", fields: { service: "R Module.Service", resource: "R resource name" } },
    generateRestResource: {
        doc: "Publish an entity as a REST resource with CRUD operations, like Studio Pro's Generate on a published REST service: JSON structures, an import mapping (found by key, else created) and export mappings, one microflow per operation (GET all, GET by key, POST, PUT, DELETE; 404 when the key is not found), then publishRest for each.",
        fields: {
            module: "R module name for the service, mappings and microflows", service: "R service name, e.g. OrderAPI (created when missing)", entity: "R persistable Module.Entity",
            key: "R attribute that identifies an object in the URL, e.g. OrderNumber (String, Integer, Long or AutoNumber)",
            resource: "optional resource name (default the entity name in lower case + s, e.g. orders)",
            operations: "optional [ \"getAll\" | \"getByKey\" | \"post\" | \"put\" | \"delete\" ] (default all five)",
            attributes: "optional [ \"Attr\" ] attributes in the JSON (default every attribute of the entity except binary ones; the key is always in)",
            folder: "optional folder for the new documents (default the service name)",
            servicePath: "optional base path of a new service", version: "optional version of a new service", authentication: "optional [ \"Basic\" | \"Session\" | \"Microflow\" | \"Guest\" ] for a new service",
            authenticationMicroflow: "optional, with Microflow authentication of a new service", roles: "optional [ \"Module.Role\" ] allowed to call the service"
        }
    },
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
            authentication: "optional [ \"Basic\" | \"Session\" | \"Microflow\" | \"Guest\" ] for a new service (default [\"Basic\"])", authenticationMicroflow: "with Microflow authentication of a new service: Module.Microflow that returns the System.User", roles: "optional [ \"Module.Role\" ] allowed to call the service", folder: "optional folder path for a new service"
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
            variable: "optional result variable: the object or list the response mapping creates",
            baseUrl: "with a base URL parameter on the service: expression for it, e.g. @Module.ApiUrl (required then)"
        },
        only: "micro",
        creates: "variable",
        type: () => mf.RestOperationCallAction,
        async build(c, act, spec, where) {
            if (spec.onError !== undefined) throw new Error(`${where}: sendRestRequest has no custom error handling in Mendix (CE6035); check $latestHttpResponse/StatusCode after it, or use callRest`);
            const op = await operationOf(c.h, spec.operation, where);
            const a = mf.RestOperationCallAction.createIn(act);
            a.operation = op;
            // the base URL parameter of the service (Mendix 10.17+): stored by name, like the operation parameters
            const bup = op.containerAsConsumedRestService.baseUrlParameter;
            if (bup) {
                if (spec.baseUrl === undefined || spec.baseUrl === "") throw new Error(`${where}: ${qn(op.containerAsConsumedRestService)} takes its base URL from parameter ${bup.name}: give "baseUrl": an expression, e.g. @Module.ApiUrl`);
                const bm = mf.RestParameterMapping.createIn(a);
                bm.__parameter.updateWithRawValue(`${qn(op.containerAsConsumedRestService)}.${bup.name}`);
                bm.value = c.expr(spec.baseUrl, `${where} baseUrl`);
            } else if (spec.baseUrl !== undefined) throw new Error(`${where}: ${qn(op.containerAsConsumedRestService)} has no base URL parameter; add one: { "op": "changeRestService", "service": "${qn(op.containerAsConsumedRestService)}", "baseUrlParameter": "ApiUrl" }`);
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
                // by name with the operation in it (Module.Service.Operation.param): the SDK leaves the operation out and
                // Studio Pro then cannot resolve the parameter (mx check 10.24 / 11.12: the model does not load)
                pm.__parameter.updateWithRawValue(`${op.qualifiedName}.${p.name}`);
                pm.value = c.expr(args[p.name], `${where} ${p.name}`);
            }
            const qps = queryParamsOf(op) || [];
            for (const k of Object.keys(query)) if (!qps.some(q => q.name === k)) fail(`${where}: ${spec.operation} has no query parameter '${k}'`, k, qps.map(q => q.name));
            for (const q of qps) {
                const required = q.parameterUsage instanceof rest.RequiredQueryParameterUsage;
                if (required && !(q.name in query)) throw new Error(`${where}: ${spec.operation} needs a value for query parameter '${q.name}' (in "query")`);
                const qm = mf.QueryParameterMapping.createIn(a);
                qm.__queryParameter.updateWithRawValue(`${op.qualifiedName}.${q.name}`); // as the path parameters above
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
            const name = (ref, qn) => (ref && ref.name) || String(qn || "").split(".").pop();
            const out = { operation: a.operationQualifiedName, args: Object.fromEntries(a.parameterMappings.map(m => [name(m.parameter, m.parameterQualifiedName), m.value])) };
            if (a.baseUrlParameterMapping) out.baseUrl = a.baseUrlParameterMapping.value;
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

    // The bearer token parameter all operations of a service share (Authorization: Bearer {token}), or null
    function bearerOf(ops) {
        const names = ops.map(op => {
            const hd = op.headers.find(x => x.name.toLowerCase() === "authorization");
            const m = hd && /^Bearer \{(\w+)\}$/.exec(hd.value.value);
            return m ? m[1] : null;
        });
        return names.length && names.every(n => n && n === names[0]) ? names[0] : null;
    }

    // What the REST client document cannot store (the callRest action can)
    function unsupportedBodyOrResponse(o, where) {
        if (o.body && typeof o.body === "object" && ["formData", "form", "file", "binary", "multipart"].some(k => k in o.body)) throw new Error(`${where}: a consumed REST operation sends a text template or a mapping body; form data, multipart and file bodies are not part of it in Mendix ${version}. Use the callRest action: "formData": { "key": "expression" } or "binaryBody": "$File"`);
        if (typeof o.response === "string" && !/^none$/i.test(o.response)) throw new Error(`${where}: a consumed REST operation stores no response (the text is in $latestHttpResponse/Content) or an import mapping; "${o.response}" is not one. For a String or a file document result use the callRest action: "response": "string" | "file"`);
    }

    async function addOperation(svc, o, where) {
        validName(o.name, "operation name");
        unsupportedBodyOrResponse(o, where);
        if (svc.operations.some(x => x.name === o.name)) throw new Error(`${where}: ${qn(svc)} already has an operation ${o.name}`);
        for (const k of Object.keys(o)) if (!OPERATION_FIELDS[k] && !["service", "op", "bearer"].includes(k)) fail(`${where}: unknown field '${k}' for an operation`, k, Object.keys(OPERATION_FIELDS));
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
        // bearer authentication: the header every operation of the service has (a new operation follows the others)
        const bearer = o.bearer || bearerOf(svc.operations.filter(x => x !== op));
        if (bearer && !hasHeader("Authorization")) headers.Authorization = `Bearer {${bearer}}`;
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
        const tests = o.testValues || {};
        if (typeof tests !== "object" || Array.isArray(tests)) throw new Error(`${where}: testValues is { "param": "value" }`);
        const queryNames = atLeast("11.0.0") ? Object.keys(query) : [];
        for (const k of Object.keys(tests)) if (!used.includes(k) && !queryNames.includes(k)) fail(`${where}: testValues names '${k}', which is not a parameter of the operation`, k, [...used, ...queryNames]);
        for (const n of used) {
            validName(n, "parameter name");
            const p = rest.OperationParameter.createIn(op);
            p.name = n;
            p.dataType = dataType(types[n], `${where} parameter ${n}`);
            await value(p, "testValue", tests[n] === undefined ? "" : tests[n], where);
        }
        if (atLeast("11.0.0")) {
            for (const [n, q] of Object.entries(query)) {
                validName(n, "query parameter name");
                if (used.includes(n)) throw new Error(`${where}: '${n}' is both a {placeholder} and a query parameter`);
                const qp = rest.QueryParameter.createIn(op);
                qp.name = n;
                qp.testValue = tests[n] === undefined ? "" : String(tests[n]);
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

    // Basic authentication (or none) of a consumed REST service. Bearer is no scheme of the document: a header with
    // a parameter on every operation (returns the parameter name; the caller writes the headers).
    async function setAuthentication(svc, auth, name) {
        if (auth === undefined) return null;
        if (/^none$/i.test(String(auth))) {
            svc.authenticationScheme = null;
            return null;
        }
        if (auth && typeof auth === "object" && auth.bearer !== undefined) {
            for (const k of Object.keys(auth)) if (k !== "bearer") fail(`${name}: unknown authentication field '${k}' (bearer takes only the parameter name)`, k, ["bearer"]);
            validName(auth.bearer, "bearer token parameter name");
            svc.authenticationScheme = null;
            return String(auth.bearer);
        }
        if (typeof auth !== "object" || auth.username === undefined || auth.password === undefined) throw new Error(`${name}: authentication is "none", { "username": ..., "password": ... } (Basic) or { "bearer": "token" }`);
        for (const k of Object.keys(auth)) if (!["username", "password"].includes(k)) fail(`${name}: unknown authentication field '${k}'`, k, ["username", "password"]);
        const b = rest.BasicAuthenticationScheme.create(model);
        svc.authenticationScheme = b;
        await value(b, "username", auth.username, `${name} username`);
        await value(b, "password", auth.password, `${name} password`);
        return null;
    }

    // The base URL parameter (Mendix 10.17+): a String parameter whose test value is the base URL
    async function setBaseUrlParameter(svc, p, where) {
        if (/^none$/i.test(String(p))) {
            if (!svc.baseUrlParameter) throw new Error(`${where}: ${qn(svc)} has no base URL parameter`);
            const users = (await Promise.all(svc.operations.map(op => callersOf(`${qn(svc)}.${op.name}`)))).flatMap(x => x.actions).filter(x => x.a.baseUrlParameterMapping);
            if (users.length) throw new Error(`${where}: ${[...new Set(users.map(x => x.flow))].join(", ")} still map the base URL parameter; delete those sendRestRequest steps (deleteAction) or keep the parameter`);
            const tv = svc.baseUrlParameter.testValue;
            svc.baseUrl.value = tv instanceof rest.StringValue && /^https?:/.test(tv.value) ? tv.value : svc.baseUrl.value;
            svc.baseUrlParameter = null;
            return `no base URL parameter (base URL ${svc.baseUrl.value})`;
        }
        if (!atLeast("10.17.0")) throw new Error(`${where}: a base URL parameter needs Mendix 10.17 (this project is ${version}); put the URL in a constant and use the callRest action, or change baseUrl per environment`);
        validName(p, "base URL parameter name");
        if (svc.operations.some(op => op.parameters.some(x => x.name === p))) throw new Error(`${where}: an operation already has a parameter '${p}'; pick another name`);
        const old = svc.baseUrlParameter;
        const url = old && old.testValue instanceof rest.StringValue ? old.testValue.value : svc.baseUrl.value;
        const bp = rest.RestParameter.create(model);
        svc.baseUrlParameter = bp;
        bp.name = String(p);
        bp.dataType = datatypes.StringType.create(model);
        // the base URL is the parameter; the URL stays as its test value (Studio Pro's Send request uses it)
        await value(bp, "testValue", url, where);
        svc.baseUrl.value = `{${p}}`;
        return `base URL parameter ${p}${old ? ` (was ${old.name}: CHECK the sendRestRequest steps)` : ""} (sendRestRequest: "baseUrl": expression)`;
    }

    // The microflows that call an operation with sendRestRequest (from the stored model) and their action objects (loaded).
    async function callersOf(opQn) {
        const users = h.client ? h.client.referencesTo(opQn).filter(u => u !== opQn.split(".").slice(0, 2).join(".")) : [];
        // also flows already loaded in this change (new ones, or changed by earlier ops): the saved index does not know their steps
        for (const m of model.allMicroflows()) if (m.isLoaded && !users.includes(m.qualifiedName)) {
            let hit = false;
            m.objectCollection.traverse(x => { if (x instanceof mf.RestOperationCallAction && x.operationQualifiedName === opQn) hit = true; });
            if (hit) users.push(m.qualifiedName);
        }
        const actions = [];
        for (const u of users) {
            const m = model.allMicroflows().find(x => x.qualifiedName === u);
            if (!m) continue;
            const loaded = await m.load();
            loaded.objectCollection.traverse(x => {
                if (x instanceof mf.RestOperationCallAction && x.operationQualifiedName === opQn) actions.push({ flow: u, a: x });
            });
        }
        return { users, actions };
    }

    const bodyText = op => {
        const b = op.method instanceof rest.RestOperationMethodWithBody ? op.method.body : null;
        return b instanceof rest.StringBody ? b.valueTemplate.value : null;
    };

    // Change an operation in place: what is not given stays.
    async function changeOperation(svc, op, o, where) {
        const lines = [];
        let created = [];
        const opQn = `${qn(svc)}.${op.name}`;
        const oldMethod = op.method.httpMethod;
        const httpMethod = o.method === undefined ? oldMethod : enumValue(sdk.services.HttpMethod, o.method, `${where} method`);
        const withBody = ["Post", "Put", "Patch"].includes(httpMethod.name);
        if (!withBody && o.body !== undefined) throw new Error(`${where}: a ${httpMethod.name} request has no body (use Post, Put or Patch)`);
        if (o.parameters !== undefined && (typeof o.parameters !== "object" || Array.isArray(o.parameters))) throw new Error(`${where}: parameters is { "name": "String" }`);
        if (o.headers !== undefined && (typeof o.headers !== "object" || Array.isArray(o.headers) || !o.headers)) throw new Error(`${where}: headers is { "Name": "value" } (null removes one)`);
        if (o.headers) for (const [k, v] of Object.entries(o.headers)) if (v === null && k.toLowerCase() === "accept") throw new Error(`${where}: every operation keeps an Accept header (Studio Pro CE7062); give it another value instead`);
        if (o.path !== undefined && /^https?:/i.test(String(o.path))) throw new Error(`${where}: path is the part after the base URL (${svc.baseUrl.value}), e.g. /orders/{id}`);
        unsupportedBodyOrResponse(o, where);
        const callers = await callersOf(opQn);
        // method (and body)
        if (withBody !== (op.method instanceof rest.RestOperationMethodWithBody)) {
            const m = (withBody ? rest.RestOperationMethodWithBody : rest.RestOperationMethodWithoutBody).create(model);
            op.method = m;
            m.httpMethod = httpMethod;
            if (withBody && o.body === undefined) {
                const b = rest.StringBody.create(model);
                m.body = b;
                b.valueTemplate.value = "{}";
            }
            if (!withBody) lines.push("body removed");
        } else op.method.httpMethod = httpMethod;
        if (httpMethod !== oldMethod) lines.push(`method ${oldMethod.name} -> ${httpMethod.name}`);
        if (o.body !== undefined) {
            if (typeof o.body === "object" && o.body !== null) {
                const b = rest.ImplicitMappingBody.create(model);
                op.method.body = b;
                created = created.concat((await inlineMapping(o.body, false, qn(svc), op.name, `${where} body`, OBJ => OBJ.createInImplicitMappingBodyUnderRootMappingElement(b))).created);
                if (b.rootMappingElement.maxOccurs === -1) throw new Error(`${where}: the body snippet is an array; send one object (an object around the array)`);
                await value(b, "testValue", "", where);
                lines.push(`body: mapping of ${b.rootMappingElement.entityQualifiedName}`);
            } else {
                const b = rest.StringBody.create(model);
                op.method.body = b;
                b.valueTemplate.value = String(o.body);
                lines.push("body: text template");
            }
        }
        // headers: merged; null removes
        if (o.headers) {
            for (const [k, v] of Object.entries(o.headers)) {
                const hd = op.headers.find(x => x.name.toLowerCase() === k.toLowerCase());
                if (v === null) {
                    if (!hd) fail(`${where}: no header '${k}' to remove`, k, op.headers.map(x => x.name));
                    hd.delete();
                    lines.push(`header ${k} removed`);
                } else if (hd) {
                    hd.value.value = String(v);
                    lines.push(`header ${hd.name} changed`);
                } else {
                    const n = rest.HeaderWithValueTemplate.createIn(op);
                    n.name = k;
                    n.value.value = String(v);
                    lines.push(`header ${k} added`);
                }
            }
        }
        if (withBody && !op.headers.some(x => x.name.toLowerCase() === "content-type")) {
            const n = rest.HeaderWithValueTemplate.createIn(op);
            n.name = "Content-Type";
            n.value.value = "application/json";
        }
        // path and query
        let path = op.path.value;
        if (o.path !== undefined) {
            path = String(o.path);
            if (path && !path.startsWith("/")) path = "/" + path;
        }
        if (o.query !== undefined) {
            const query = Array.isArray(o.query) ? Object.fromEntries(o.query.map(n => [n, {}])) : o.query || {};
            if (typeof query !== "object") throw new Error(`${where}: query is [ "name" ] or { "name": { "required": false } }`);
            if (!atLeast("11.0.0")) {
                if (Object.values(query).some(q => q && q.required === false)) throw new Error(`${where}: optional query parameters need Mendix 11 (this project is ${version})`);
                path = path.replace(/\?.*$/, "");
                if (Object.keys(query).length) path += "?" + Object.keys(query).map(n => `${n}={${n}}`).join("&");
            } else {
                for (const q of [...op.queryParameters]) q.delete();
                for (const [n, q] of Object.entries(query)) {
                    validName(n, "query parameter name");
                    const qp = rest.QueryParameter.createIn(op);
                    qp.name = n;
                    qp.testValue = "";
                    if (q && q.required === false) rest.OptionalQueryParameterUsage.createIn(qp).included = true;
                    else rest.RequiredQueryParameterUsage.createIn(qp);
                }
            }
            lines.push(`query ${Object.keys(query).join(", ") || "none"}`);
        }
        if (path !== op.path.value) {
            lines.push(`path ${op.path.value} -> ${path}`);
            op.path.value = path;
        }
        if (o.timeout !== undefined) {
            const t = Number(o.timeout);
            if (!Number.isInteger(t) || t < 0) throw new Error(`${where}: timeout is a number of seconds`);
            op.timeout = t;
            lines.push(`timeout ${t}s`);
        }
        // response
        if (o.response !== undefined) {
            if (/^none$/i.test(String(o.response))) {
                const r = rest.NoResponseHandling.create(model);
                op.responseHandling = r;
                r.statusCode = 200;
                r.contentType = "application/json";
                lines.push("response: none");
            } else {
                if (typeof o.response !== "object") throw new Error(`${where}: response is "none" or { "snippet": ..., "entity": ... }`);
                const r = rest.ImplicitMappingResponseHandling.create(model);
                op.responseHandling = r;
                r.statusCode = 200;
                r.contentType = "application/json";
                created = created.concat((await inlineMapping(o.response, true, qn(svc), op.name, `${where} response`, OBJ => OBJ.createInImplicitMappingResponseHandlingUnderRootMappingElement(r))).created);
                const res = responseOf(op);
                lines.push(`response: ${res.list ? "list of " : ""}${res.entity}`);
            }
            if (callers.actions.some(x => x.a.outputVariable)) lines.push(`CHECK the steps that keep the response in a variable: ${[...new Set(callers.actions.filter(x => x.a.outputVariable).map(x => x.flow))].join(", ")}`);
        }
        // parameters: every {name} in path, headers and body (CE7056); existing ones keep their type
        const types = o.parameters || {};
        const used = [...new Set([...placeholders(path), ...op.headers.map(x => x.value.value).flatMap(placeholders), ...placeholders(bodyText(op))])];
        for (const k of Object.keys(types)) if (!used.includes(k)) fail(`${where}: parameters names '${k}', which is not a {placeholder} in path, headers or body`, k, used);
        const removed = [], added = [];
        for (const p of [...op.parameters]) {
            if (used.includes(p.name)) continue;
            removed.push(p.name);
            for (const { a } of callers.actions) for (const pm of [...a.parameterMappings]) if (pm.parameterQualifiedName === `${opQn}.${p.name}` || (pm.parameter && pm.parameter.name === p.name)) pm.delete();
            p.delete();
        }
        for (const n of used) {
            let p = op.parameters.find(x => x.name === n);
            if (!p) {
                validName(n, "parameter name");
                p = rest.OperationParameter.createIn(op);
                p.name = n;
                p.dataType = dataType(types[n], `${where} parameter ${n}`);
                await value(p, "testValue", "", where);
                added.push(n);
            } else if (types[n] !== undefined) {
                p.dataType = dataType(types[n], `${where} parameter ${n}`);
                lines.push(`parameter ${n}: ${types[n]}`);
            }
        }
        if (atLeast("11.0.0")) for (const q of op.queryParameters) if (used.includes(q.name)) throw new Error(`${where}: '${q.name}' is both a {placeholder} and a query parameter`);
        if (o.testValues !== undefined) {
            if (!o.testValues || typeof o.testValues !== "object" || Array.isArray(o.testValues)) throw new Error(`${where}: testValues is { "param": "value" }`);
            const qps = atLeast("11.0.0") ? [...op.queryParameters] : [];
            for (const [k, v] of Object.entries(o.testValues)) {
                const p = op.parameters.find(x => x.name === k), q = qps.find(x => x.name === k);
                if (p) await value(p, "testValue", v, where);
                else if (q) q.testValue = String(v);
                else fail(`${where}: testValues names '${k}', which is not a parameter of the operation`, k, [...op.parameters.map(x => x.name), ...qps.map(x => x.name)]);
            }
            lines.push(`test values: ${Object.keys(o.testValues).join(", ")}`);
        }
        if (removed.length) lines.push(`parameters removed: ${removed.join(", ")}${callers.actions.length ? " (and their values in the calling steps)" : ""}`);
        if (added.length) lines.push(`parameters added: ${added.join(", ")}` + (callers.actions.length ? `\n      STILL USED BY (these calls need a value for ${added.join(", ")}: delete the step with deleteAction and add it again with args): ${[...new Set(callers.actions.map(x => x.flow))].join(", ")}` : ""));
        if (!lines.length) throw new Error(`${where}: nothing to change; give method, path, parameters, query, headers, body, response, timeout or testValues`);
        if (created.length) lines.push(`created: ${created.join(", ")}`);
        return lines;
    }

    async function operationNamed(name, where) {
        const op = await operationOf(h, name, where);
        return { svc: op.containerAsConsumedRestService, op };
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

    // The export mapping a microflow's object/list result needs, and the import mapping of its body parameter.
    async function mappingsFor(o, mfl, where) {
        const ret = mfl.microflowReturnType;
        let em = null, im = null;
        if (o.exportMapping) {
            em = await mappingDoc(o.exportMapping, false, where);
            if (!ret || !isObj(ret) || special(ret)) throw new Error(`${o.microflow} returns no object or list; exportMapping only applies to an object/list result`);
            if (ret.entityQualifiedName !== em.entity || (ret instanceof datatypes.ListType) !== em.list) throw new Error(`${o.exportMapping} exports ${em.list ? "a list of " : ""}${em.entity}, but ${o.microflow} returns ${ret instanceof datatypes.ListType ? "a list of " : ""}${ret.entityQualifiedName}`);
        } else if (ret && isObj(ret) && !special(ret)) throw new Error(`${o.microflow} returns an object/list; give "exportMapping": an export mapping of ${ret.entityQualifiedName} (create one with createExportMapping)`);
        if (o.importMapping) im = await mappingDoc(o.importMapping, true, where);
        return { em, im };
    }

    // The operation of a published REST resource for a microflow; its parameters from the microflow's parameters.
    function publishedOperation(svc, res, o, mfl, em, im, name) {
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
        return kinds;
    }

    // The authentication microflow of a published REST or OData service (Microflow authentication): it returns the
    // System.User and takes at most a System.HttpRequest (Studio Pro's rule). Used by ops-odata.js too.
    async function authenticationMicroflow(svc, name, where) {
        if (name === "" || name === null) {
            svc.authenticationMicroflow = null;
            return "no authentication microflow";
        }
        const m = await get(name).catch(() => fail(`${where}: no microflow ${name}`, name, model.allMicroflows().map(qn)));
        if (!(m instanceof mf.Microflow)) throw new Error(`${where}: ${name} is not a microflow`);
        const rt = m.microflowReturnType;
        if (!(rt instanceof datatypes.ObjectType) || rt.entityQualifiedName !== "System.User") throw new Error(`${where}: an authentication microflow returns a System.User (the user of the request, empty = refused); ${name} returns ${rt instanceof datatypes.ObjectType ? rt.entityQualifiedName : rt.structureTypeName.split("$")[1].replace("Type", "")}`);
        const params = m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject);
        const bad = params.filter(p => !(p.variableType instanceof datatypes.ObjectType && p.variableType.entityQualifiedName === "System.HttpRequest"));
        if (bad.length) throw new Error(`${where}: an authentication microflow takes only a System.HttpRequest parameter; ${name} has ${bad.map(p => p.name).join(", ")}`);
        if (!svc.authenticationTypes.includes(rest.RestAuthenticationType.Microflow)) svc.authenticationTypes.push(rest.RestAuthenticationType.Microflow);
        svc.authenticationMicroflow = m;
        return `authentication microflow ${name}`;
    }

    // CORS of a published REST service: allowed origins and max age come from constants (per environment)
    async function setCors(svc, cors, where) {
        if (/^none$/i.test(String(cors))) {
            svc.corsConfiguration = null;
            return "no CORS";
        }
        if (!cors || typeof cors !== "object" || Array.isArray(cors)) throw new Error(`${where}: cors is "none" or { "origins": "@Module.Constant", "maxAge": "@Module.Constant", "credentials": true }`);
        for (const k of Object.keys(cors)) if (!["origins", "maxAge", "credentials"].includes(k)) fail(`${where}: unknown cors field '${k}'`, k, ["origins", "maxAge", "credentials"]);
        const constant = async (v, type, what) => {
            const n = String(v || "");
            if (!n.startsWith("@")) throw new Error(`${where}: cors ${what} is a constant ("@Module.Constant", so each environment sets its own); create one with createConstant (type ${type})`);
            const c = await get(n.slice(1)).catch(() => fail(`${where}: no constant ${n.slice(1)}`, n.slice(1), model.allConstants().map(qn)));
            if (!(c instanceof sdk.constants.Constant)) throw new Error(`${where}: ${n.slice(1)} is not a constant`);
            const t = await c.load().then(x => x.type);
            if (!(t instanceof datatypes[`${type}Type`])) throw new Error(`${where}: cors ${what} needs a ${type} constant; ${n.slice(1)} is ${t.structureTypeName.split("$")[1].replace("Type", "")}`);
            return c;
        };
        if (cors.origins === undefined) throw new Error(`${where}: cors needs "origins": "@Module.Constant" (a String constant: comma-separated origins, or *)`);
        const origins = await constant(cors.origins, "String", "origins");
        const maxAge = cors.maxAge === undefined ? null : await constant(cors.maxAge, "Integer", "maxAge");
        const c = rest.CorsConfiguration.create(model);
        svc.corsConfiguration = c;
        c.allowedOrigins = origins;
        if (maxAge) c.maxAge = maxAge;
        c.allowAuthentication = bool(cors.credentials, false);
        return `CORS origins ${cors.origins}${maxAge ? `, max age ${cors.maxAge}` : ""}${c.allowAuthentication ? ", with credentials" : ""}`;
    }

    async function publishedService(name, where) {
        const all = model.allPublishedRestServices().map(qn);
        const svc = await get(name).catch(() => fail(`${where}: no published REST service ${name}`, name, all));
        if (!(svc instanceof rest.PublishedRestService)) fail(`${where}: ${name} is not a published REST service`, name, all);
        return svc;
    }
    // The operation of a resource by method and path
    function publishedOp(svc, o, where) {
        const res = svc.resources.find(x => x.name === o.resource) || fail(`${where}: no resource '${o.resource}'`, o.resource, svc.resources.map(x => x.name));
        const method = enumValue(sdk.services.HttpMethod, o.method, "method");
        const path = String(o.path || "");
        const op = res.operations.find(x => x.httpMethod === method && x.path === path);
        if (!op) throw new Error(`${where}/${o.resource}: no ${method.name} operation with path '${path}' (its operations: ${res.operations.map(x => `${x.httpMethod.name} '${x.path}'`).join(", ") || "none"})`);
        return { res, op };
    }

    // ------------------------------------------------ generated CRUD resource

    const CRUD = ["getAll", "getByKey", "post", "put", "delete"];
    const SAMPLE = { String: "\"text\"", Integer: "1", Long: "1", AutoNumber: "1", Decimal: "1.5", Boolean: "true", DateTime: "\"2024-01-01T00:00:00.000Z\"", Enumeration: null, HashString: "\"text\"" };
    const kindOf = a => a.type.structureTypeName.split("$")[1].replace("AttributeType", "");

    async function generateResource(o) {
        const where = `generateRestResource ${o.module}.${o.service}`;
        const ent = await h.entity(o.entity);
        await h.loadParents(ent);
        if (!h.persistable(ent)) throw new Error(`${where}: ${o.entity} is not persistable; a generated resource retrieves and commits it (publish a non-persistable entity with publishRest and your own microflows)`);
        const own = h.attributeChain(ent).attributes.filter(a => !a.qualifiedName.startsWith("System."));
        const key = own.find(a => a.name === o.key) || fail(`${where}: ${o.entity} has no attribute '${o.key}'`, o.key, own.map(a => a.name));
        const kk = kindOf(key);
        if (!["String", "Integer", "Long", "AutoNumber"].includes(kk)) throw new Error(`${where}: the key ${o.key} is ${kk}; a URL key is String, Integer, Long or AutoNumber`);
        let attrs = own.filter(a => SAMPLE[kindOf(a)] !== undefined);
        if (o.attributes !== undefined) {
            if (!Array.isArray(o.attributes)) throw new Error(`${where}: attributes is [ "Attr" ]`);
            for (const n of o.attributes) if (!own.some(a => a.name === n)) fail(`${where}: ${o.entity} has no attribute '${n}'`, n, own.map(a => a.name));
            attrs = attrs.filter(a => a === key || o.attributes.includes(a.name));
        }
        const ops = o.operations === undefined ? CRUD : [].concat(o.operations);
        for (const x of ops) if (!CRUD.includes(x)) fail(`${where}: unknown operation '${x}'`, x, CRUD);
        if (!ops.length) throw new Error(`${where}: operations is a non-empty list of ${CRUD.join(", ")}`);
        const E = ent.name, M = o.module, P = `${o.service}_${E}`, folderPath = o.folder === undefined ? o.service : o.folder;
        const res = o.resource || `${E.toLowerCase()}s`;
        for (const n of ["Json", "ListJson", "Imm", "Exm", "ListExm", ...ops.map(x => x[0].toUpperCase() + x.slice(1))]) if (await exists(`${M}.${P}_${n}`)) throw new Error(`${where}: ${M}.${P}_${n} already exists (an earlier generate?); delete it or pick another service name`);
        const sample = a => kindOf(a) === "Enumeration" ? JSON.stringify(a.type.enumeration ? (a.type.enumeration.values[0] || { name: "Value" }).name : "Value") : SAMPLE[kindOf(a)];
        const snippet = `{ ${attrs.map(a => `${JSON.stringify(a.name)}: ${sample(a)}`).join(", ")} }`;
        const doc = (op, rest) => ({ op, module: M, folder: folderPath, ...rest });
        const impl = h.impl();
        const out = [];
        const run = async (name, spec) => out.push(`${name}: ${await impl[name](spec)}`);
        // enumerations: their values are read for the sample; load once
        for (const a of attrs) if (kindOf(a) === "Enumeration" && a.type.enumeration) await a.type.enumeration.load();
        await run("createJsonStructure", doc("createJsonStructure", { name: `${P}_Json`, snippet }));
        await run("createJsonStructure", doc("createJsonStructure", { name: `${P}_ListJson`, snippet: `[ ${snippet} ]` }));
        const map = { entity: o.entity };
        await run("createImportMapping", doc("createImportMapping", { name: `${P}_Imm`, jsonStructure: `${M}.${P}_Json`, ...map, keys: [key.name] }));
        await run("createExportMapping", doc("createExportMapping", { name: `${P}_Exm`, jsonStructure: `${M}.${P}_Json`, ...map }));
        await run("createExportMapping", doc("createExportMapping", { name: `${P}_ListExm`, jsonStructure: `${M}.${P}_ListJson`, ...map }));
        const xpath = `[${key.name} = ${kk === "String" ? "$Key" : "parseInteger($Key)"}]`;
        // found: the steps; not found: 404 (the flow returns $E, which is empty then)
        const status = (code, text) => ({ action: "change", variable: "httpResponse", set: { StatusCode: String(code), ReasonPhrase: `'${text}'` } });
        const byKey = (steps = []) => [
            { action: "retrieve", variable: E, entity: o.entity, xpath, first: true },
            { action: "if", condition: `$${E} != empty`, caption: "found?", then: steps, else: [status(404, "Not Found")] }];
        const same = kk === "String" ? `$${E}/${key.name} = $Key` : `toString($${E}/${key.name}) = $Key`;
        const http = { name: "httpResponse", type: "System.HttpResponse" };
        const flows = {
            getAll: { parameters: [], returns: `List(${o.entity})`, returnValue: `$${E}List`, actions: [{ action: "retrieve", variable: `${E}List`, entity: o.entity }], method: "Get", path: "", exportMapping: `${M}.${P}_ListExm`, summary: `All ${E} objects` },
            getByKey: { parameters: [{ name: "Key", type: "String" }, http], returns: o.entity, returnValue: `$${E}`, actions: byKey(), method: "Get", path: "{Key}", exportMapping: `${M}.${P}_Exm`, summary: `One ${E} by ${key.name}` },
            post: { parameters: [{ name: E, type: o.entity }], returns: o.entity, returnValue: `$${E}`, actions: [{ action: "commit", variable: E }], method: "Post", path: "", importMapping: `${M}.${P}_Imm`, exportMapping: `${M}.${P}_Exm`, commit: "no", summary: `Create (or update by ${key.name}) a ${E}` },
            put: { parameters: [{ name: "Key", type: "String" }, { name: E, type: o.entity }, http], returns: o.entity, returnValue: `$${E}`,
                actions: [{ action: "if", condition: same, caption: "key matches?", then: [{ action: "commit", variable: E }], else: [status(400, "The key in the URL and in the body differ")] }],
                method: "Put", path: "{Key}", importMapping: `${M}.${P}_Imm`, exportMapping: `${M}.${P}_Exm`, commit: "no", summary: `Update a ${E} by ${key.name}` },
            delete: { parameters: [{ name: "Key", type: "String" }, http], actions: byKey([{ action: "delete", variable: E }]), method: "Delete", path: "{Key}", summary: `Delete a ${E} by ${key.name}` }
        };
        let first = true;
        for (const x of ops) {
            const f = flows[x], name = `${P}_${x[0].toUpperCase()}${x.slice(1)}`;
            await run("createMicroflow", { module: M, name, folder: folderPath, parameters: f.parameters, ...(f.returns ? { returns: f.returns, returnValue: f.returnValue } : {}), actions: f.actions });
            const pub = { module: M, service: o.service, resource: res, method: f.method, path: f.path, microflow: `${M}.${name}`, summary: f.summary };
            for (const k of ["importMapping", "exportMapping", "commit"]) if (f[k]) pub[k] = f[k];
            if (first) for (const k of ["servicePath", "version", "authentication", "authenticationMicroflow", "folder"]) if (o[k] !== undefined) pub[k] = o[k];
            if (first && o.roles) pub.roles = o.roles;
            first = false;
            await run("publishRest", pub);
        }
        return `${M}.${o.service}/${res}: ${ops.join(", ")} for ${o.entity} (key ${key.name})` + out.map(l => "\n      " + l.split("\n")[0]).join("");
    }

    const impl = {
        generateRestResource: generateResource,
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
            const bearer = await setAuthentication(svc, o.authentication, name);
            const lines = [];
            if (o.baseUrlParameter !== undefined) lines.push(await setBaseUrlParameter(svc, o.baseUrlParameter, name));
            for (const [i, op] of o.operations.entries()) {
                if (!op || typeof op !== "object") throw new Error(`${name} operation ${i + 1}: { "name": ..., "path": ... }`);
                lines.push(`${op.name}: ${await addOperation(svc, { ...op, ...(bearer ? { bearer } : {}) }, `${name} operation ${i + 1} (${op.name})`)}`);
            }
            warn(`Rest$ConsumedRestService first use by ops (no Studio Pro sample in the test projects; built from the Model SDK metamodel of Mendix ${version}): check ${name} in Studio Pro`);
            return `${name} (${svc.baseUrl.value}${svc.authenticationScheme ? ", Basic authentication" : bearer ? `, bearer token {${bearer}}` : ""})` + lines.map(l => "\n      " + l).join("");
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
            const { em, im } = await mappingsFor(o, mfl, where);
            if (o.commit !== undefined && !im) throw new Error("'commit' only applies with importMapping");
            const name = `${o.module}.${o.service}`;
            let svc;
            if (await exists(name)) {
                svc = await get(name);
                if (!(svc instanceof rest.PublishedRestService)) throw new Error(`${name} exists and is not a published REST service`);
                if (o.authenticationMicroflow !== undefined) throw new Error(`${where}: ${name} exists; set its authentication microflow with changePublishedRestService`);
            } else {
                svc = rest.PublishedRestService.createIn(folder(o.module, o.folder));
                svc.name = o.service;
                svc.serviceName = o.service;
                svc.version = o.version === undefined ? "1.0.0" : String(o.version);
                svc.path = o.servicePath || `rest/${o.service.toLowerCase()}/v1`;
                svc.authenticationTypes.clear();
                for (const a of [].concat(o.authentication || ["Basic"])) svc.authenticationTypes.push(enumValue(rest.RestAuthenticationType, a, "authentication"));
                if (o.authenticationMicroflow !== undefined) await authenticationMicroflow(svc, o.authenticationMicroflow, where);
                if (svc.authenticationTypes.includes(rest.RestAuthenticationType.Microflow) && !svc.authenticationMicroflow) throw new Error(`${where}: Microflow authentication needs "authenticationMicroflow": "Module.Microflow" (returns System.User)`);
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
            const kinds = publishedOperation(svc, res, o, mfl, em, im, name);
            const path = String(o.path || "");
            return `${name}: ${o.method.toUpperCase()} /${svc.path}/${o.resource}${path ? "/" + path : ""} -> ${o.microflow}${kinds.length ? ` (${kinds.join(", ")})` : ""}${em ? `, result by ${o.exportMapping}` : ""}${made ? `\n      microflow ${made}` : ""}`;
        },
        async changeRestService(o) {
            const svc = await service(o.service, "changeRestService");
            const lines = [];
            if (o.baseUrl !== undefined) {
                const u = String(o.baseUrl);
                if (!/^https?:\/\/\S+$/i.test(u)) throw new Error(`baseUrl must be an http(s) URL, e.g. https://api.example.com/v1 (got '${u}')`);
                if (svc.baseUrlParameter) await value(svc.baseUrlParameter, "testValue", u.replace(/\/+$/, ""), o.service);
                else svc.baseUrl.value = u.replace(/\/+$/, "");
                lines.push(svc.baseUrlParameter ? `test value of the base URL parameter ${svc.baseUrlParameter.name}: ${u.replace(/\/+$/, "")}` : `base URL ${u.replace(/\/+$/, "")}`);
            }
            if (o.authentication !== undefined) {
                const old = bearerOf(svc.operations);
                const bearer = await setAuthentication(svc, o.authentication, o.service);
                // the Authorization header of every operation follows: added for bearer, removed when it goes
                if (old !== bearer) for (const op of [...svc.operations]) {
                    const headers = {};
                    if (old) headers[op.headers.find(x => x.name.toLowerCase() === "authorization").name] = null;
                    if (bearer) headers.Authorization = `Bearer {${bearer}}`;
                    lines.push(...(await changeOperation(svc, op, { headers }, `${o.service}.${op.name}`)).map(l => `${op.name}: ${l}`));
                }
                lines.unshift(svc.authenticationScheme ? "Basic authentication" : bearer ? `bearer token {${bearer}} on every operation` : "no authentication");
            }
            if (o.baseUrlParameter !== undefined) lines.push(await setBaseUrlParameter(svc, o.baseUrlParameter, `changeRestService ${o.service}`));
            if (!lines.length) throw new Error(`changeRestService ${o.service}: nothing to change; give baseUrl, baseUrlParameter or authentication`);
            return `${o.service}: ${lines.join("; ")}`;
        },
        async changeRestOperation(o) {
            const { svc, op } = await operationNamed(o.operation, "changeRestOperation");
            const lines = await changeOperation(svc, op, o, o.operation);
            const res = responseOf(op);
            return `${o.operation}: ${op.method.httpMethod.name.toUpperCase()} ${op.path.value}${res ? ` -> ${res.list ? "list of " : ""}${res.entity}` : ""}` + lines.map(l => "\n      " + l).join("");
        },
        async deleteRestOperation(o) {
            const { svc, op } = await operationNamed(o.operation, "deleteRestOperation");
            if (svc.operations.length === 1) throw new Error(`deleteRestOperation: ${o.operation} is the last operation of ${qn(svc)}; delete the service instead: { "op": "delete", "target": "${qn(svc)}" }`);
            const { users } = await callersOf(o.operation);
            // deleting it would leave the steps' parameter mappings without a parameter: Studio Pro then cannot load the flow
            if (users.length) throw new Error(`deleteRestOperation: ${o.operation} is still called by ${users.join(", ")}; delete those sendRestRequest steps first (deleteAction, ids from: steps <flow>), then the operation`);
            op.delete();
            return o.operation;
        },
        async changePublishedRestService(o) {
            const svc = await publishedService(o.service, "changePublishedRestService");
            const lines = [];
            if (o.path !== undefined) {
                svc.path = String(o.path).replace(/^\/+|\/+$/g, "");
                lines.push(`path /${svc.path}`);
            }
            if (o.version !== undefined) {
                svc.version = String(o.version);
                lines.push(`version ${svc.version}`);
            }
            if (o.authentication !== undefined) {
                const list = [].concat(o.authentication).map(a => enumValue(rest.RestAuthenticationType, a, "authentication"));
                svc.authenticationTypes.clear();
                for (const a of list) svc.authenticationTypes.push(a);
                lines.push(`authentication ${list.map(a => a.name).join(", ")}`);
            }
            if (o.authenticationMicroflow !== undefined) lines.push(await authenticationMicroflow(svc, o.authenticationMicroflow, `changePublishedRestService ${o.service}`));
            if (svc.authenticationTypes.includes(rest.RestAuthenticationType.Microflow) && !svc.authenticationMicroflow) throw new Error(`changePublishedRestService ${o.service}: Microflow authentication needs "authenticationMicroflow": "Module.Microflow" (returns System.User)`);
            if (o.cors !== undefined) lines.push(await setCors(svc, o.cors, `changePublishedRestService ${o.service}`));
            if (o.roles !== undefined) {
                const roles = [];
                for (const r of [].concat(o.roles)) {
                    const role = await get(r).catch(() => fail(`no module role ${r}`, r, model.allModuleSecurities().flatMap(m => m.moduleRoles.map(x => x.qualifiedName))));
                    if (!(role instanceof security.ModuleRole)) throw new Error(`'${r}' is not a module role`);
                    roles.push(role);
                }
                svc.allowedRoles.clear();
                for (const r of roles) svc.allowedRoles.push(r);
                lines.push(`roles ${[].concat(o.roles).join(", ") || "none"}`);
            }
            if (!lines.length) throw new Error(`changePublishedRestService ${o.service}: nothing to change; give path, version, authentication, authenticationMicroflow, roles or cors`);
            return `${o.service}: ${lines.join("; ")}`;
        },
        async changePublishedRestOperation(o) {
            const where = `changePublishedRestOperation ${o.service}`;
            const svc = await publishedService(o.service, where);
            const { res, op } = publishedOp(svc, o, where);
            const keep = ["newMethod", "newPath", "microflow", "importMapping", "exportMapping", "commit", "headers", "summary", "description", "deprecated"];
            if (!keep.some(k => o[k] !== undefined)) throw new Error(`${where}: nothing to change; give ${keep.join(", ")}`);
            const spec = {
                resource: o.resource,
                method: o.newMethod !== undefined ? o.newMethod : op.httpMethod.name,
                path: o.newPath !== undefined ? String(o.newPath) : op.path,
                microflow: o.microflow !== undefined ? o.microflow : op.microflowQualifiedName,
                importMapping: o.importMapping !== undefined ? o.importMapping || undefined : op.importMappingQualifiedName || undefined,
                exportMapping: o.exportMapping !== undefined ? o.exportMapping || undefined : op.exportMappingQualifiedName || undefined,
                commit: o.commit !== undefined ? o.commit : { Yes: "yes", No: "no", YesWithoutEvents: "withoutEvents" }[op.commit.name],
                headers: o.headers !== undefined ? o.headers : op.parameters.filter(p => p.parameterType === rest.RestOperationParameterType.Header).map(p => p.name),
                summary: o.summary !== undefined ? o.summary : op.summary,
                description: o.description !== undefined ? o.description : op.documentation,
                deprecated: o.deprecated !== undefined ? o.deprecated : op.deprecated
            };
            const mfl = await get(spec.microflow).catch(() => fail(`${where}: no microflow ${spec.microflow}`, spec.microflow, model.allMicroflows().map(qn)));
            if (!(mfl instanceof mf.Microflow)) throw new Error(`${where}: '${spec.microflow}' is not a microflow`);
            const { em, im } = await mappingsFor(spec, mfl, where);
            if (!im) spec.commit = undefined;
            const index = res.operations.indexOf(op);
            op.delete();
            const kinds = publishedOperation(svc, res, spec, mfl, em, im, o.service);
            const made = res.operations[res.operations.length - 1];
            if (index < res.operations.length - 1) {
                made.detach();
                res.operations.splice(index, 0, made);
            }
            return `${o.service}: ${spec.method.toUpperCase()} /${svc.path}/${o.resource}${spec.path ? "/" + spec.path : ""} -> ${spec.microflow}${kinds.length ? ` (${kinds.join(", ")})` : ""}`;
        },
        async deletePublishedRestOperation(o) {
            const where = `deletePublishedRestOperation ${o.service}`;
            const svc = await publishedService(o.service, where);
            const { res, op } = publishedOp(svc, o, where);
            op.delete();
            return `${o.service}/${o.resource}: ${o.method.toUpperCase()} '${o.path || ""}' deleted${res.operations.length ? "" : ` (the resource ${o.resource} has no operations left: deletePublishedRestResource removes it)`}`;
        },
        async deletePublishedRestResource(o) {
            const where = `deletePublishedRestResource ${o.service}`;
            const svc = await publishedService(o.service, where);
            const res = svc.resources.find(x => x.name === o.resource) || fail(`${where}: no resource '${o.resource}'`, o.resource, svc.resources.map(x => x.name));
            const n = res.operations.length;
            res.delete();
            return `${o.service}: resource ${o.resource} deleted (${n} operation(s))`;
        }
    };

    const checks = {
        async changeRestService(o) {
            const svc = await get(o.service);
            const r = [];
            const url = svc.baseUrlParameter && svc.baseUrlParameter.testValue ? svc.baseUrlParameter.testValue.value : svc.baseUrl.value;
            if (o.baseUrl !== undefined && url !== String(o.baseUrl).replace(/\/+$/, "")) r.push(`${o.service} base URL is ${url}`);
            if (o.baseUrlParameter !== undefined && !!svc.baseUrlParameter === /^none$/i.test(String(o.baseUrlParameter))) r.push(`${o.service} base URL parameter not as asked`);
            if (o.authentication !== undefined && !!svc.authenticationScheme === /^none$/i.test(String(o.authentication))) r.push(`${o.service} authentication not as asked`);
            return r;
        },
        async changeRestOperation(o) {
            const op = await operationOf(h, o.operation, "check");
            const r = [];
            if (o.method !== undefined && op.method.httpMethod.name.toLowerCase() !== String(o.method).toLowerCase()) r.push(`${o.operation} method is ${op.method.httpMethod.name}`);
            const used = new Set([...placeholders(op.path.value), ...op.headers.map(x => x.value.value).flatMap(placeholders), ...placeholders(bodyText(op))]);
            const declared = op.parameters.map(p => p.name);
            if (declared.length !== used.size || declared.some(n => !used.has(n))) r.push(`${o.operation}: parameters ${declared} vs placeholders ${[...used]}`);
            if (!op.headers.some(x => x.name === "Accept")) r.push(`${o.operation} has no Accept header`);
            return r;
        },
        async deleteRestOperation(o) {
            const svc = await get(o.operation.split(".").slice(0, 2).join("."));
            return svc.operations.some(x => x.name === o.operation.split(".")[2]) ? [`${o.operation} still exists`] : [];
        },
        async changePublishedRestService(o) {
            const svc = await get(o.service);
            const r = [];
            if (o.version !== undefined && svc.version !== String(o.version)) r.push(`${o.service} version ${svc.version}`);
            if (o.roles !== undefined && svc.allowedRolesQualifiedNames.length !== [].concat(o.roles).length) r.push(`${o.service} roles ${svc.allowedRolesQualifiedNames}`);
            return r;
        },
        async changePublishedRestOperation(o) {
            const svc = await get(o.service);
            const res = svc.resources.find(x => x.name === o.resource);
            const method = String(o.newMethod || o.method).toLowerCase();
            const path = o.newPath !== undefined ? String(o.newPath) : String(o.path || "");
            const op = res && res.operations.find(x => x.httpMethod.name.toLowerCase() === method && x.path === path);
            if (!op) return [`${o.service}/${o.resource} has no ${method} '${path}'`];
            return o.microflow && op.microflowQualifiedName !== o.microflow ? [`operation runs ${op.microflowQualifiedName}`] : [];
        },
        async deletePublishedRestOperation(o) {
            const svc = await get(o.service);
            const res = svc.resources.find(x => x.name === o.resource);
            return res && res.operations.some(x => x.httpMethod.name.toLowerCase() === String(o.method).toLowerCase() && x.path === String(o.path || "")) ? [`${o.method} '${o.path || ""}' still exists`] : [];
        },
        async deletePublishedRestResource(o) {
            const svc = await get(o.service);
            return svc.resources.some(x => x.name === o.resource) ? [`resource ${o.resource} still exists`] : [];
        },
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
        async generateRestResource(o) {
            const svc = await get(`${o.module}.${o.service}`);
            const res = svc.resources.find(x => x.name === (o.resource || `${o.entity.split(".")[1].toLowerCase()}s`));
            const want = (o.operations || CRUD).length;
            return res && res.operations.length >= want ? [] : [`${o.module}.${o.service} has ${res ? res.operations.length : 0} generated operation(s), expected ${want}`];
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

    return { impl, checks, authenticationMicroflow };
}

module.exports = { makeRest, REST_OPS, REST_ACTIONS };
