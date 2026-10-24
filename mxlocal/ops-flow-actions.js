"use strict";
// Flow actions of the Studio Pro toolbox that need a document or a version the basic catalogue (ops-flows.js) does not
// assume: send email (Mendix 11.2+), call web service (an imported SOAP web service), call external action and
// send / delete external object (a consumed OData service), synchronize to / clear from device (offline), cancel
// synchronization (11.8+). Same shape as EXTRA_ACTIONS in ops-flows.js: { doc, fields, only, creates, type, build,
// vars, info, describe, spec }. spec(a) gives the fields of a stored action back, so changeAction can change any
// of its fields by building it again (ops-flows.js changeAction).
//
// None of these storage types has a Studio Pro sample in the test projects: each build warns "first use" (check
// the flow in Studio Pro), and the selftest (phase W) stores and reopens the ones a test project can hold.
const sdk = require("mendixmodelsdk");
const { fail, bool, noDollar } = require("./ops-util");
const { cmp } = require("./versions");

const { microflows: mf, datatypes, webservices: ws } = sdk;

const version = c => String(c.model.metaModelVersion);
const atLeast = (c, v) => cmp(version(c), v) >= 0;
function needVersion(c, v, what, where) {
    if (!atLeast(c, v)) throw new Error(`${where}: ${what} needs Mendix ${v} or newer (this project is ${version(c)}); upgrade the project or do it another way`);
}
const firstUse = (c, type, where) => c.h.client && c.h.client.warnFirst(`Microflows$${type}: first use by ops (no Studio Pro sample in the test projects); check ${where.split(" ")[0]} in Studio Pro`);


// ---------------------------------------------------------------- send email (F3)

const SECURITY = { none: "None", ssl: "SSL", tls: "TLS", starttls: "TLS" };

async function sendEmail(c, act, spec, where) {
    needVersion(c, "11.2.0", "the send email action", where);
    if (!spec.to) throw new Error(`${where}: sendEmail needs 'to': an expression, e.g. "$Customer/Email" or "'info@example.com'"`);
    if (!spec.server || typeof spec.server !== "object") throw new Error(`${where}: sendEmail needs 'server': { "host": "@Module.SmtpHost", "port": "587", "from": "'noreply@example.com'", "security": "tls", "user": "@Module.SmtpUser", "password": "@Module.SmtpPassword" }`);
    const known = ["host", "port", "from", "security", "user", "password", "checkIdentity", "timeout"];
    for (const k of Object.keys(spec.server)) if (!known.includes(k)) fail(`${where}: server has no field '${k}'`, k, known);
    for (const k of ["host", "port", "from"]) if (spec.server[k] === undefined) throw new Error(`${where}: server needs '${k}' (an expression; a constant like "@Module.SmtpHost" keeps it out of the model)`);
    const a = mf.SendEmailAction.createIn(act);
    const cc = a.emailConnectionConfig || mf.EmailConnectionConfig.createIn(a);
    cc.protocol = mf.ProtocolType.SMTP;
    cc.host = c.expr(spec.server.host, `${where} host`);
    cc.port = c.expr(String(spec.server.port), `${where} port`);
    cc.emailId = c.expr(spec.server.from, `${where} from`);
    const sec = SECURITY[String(spec.server.security || "tls").toLowerCase()];
    if (!sec) fail(`${where}: security '${spec.server.security}' is none, ssl or tls`, String(spec.server.security), Object.keys(SECURITY));
    cc.securityType = mf.SecurityType[sec];
    cc.checkServerIdentity = bool(spec.server.checkIdentity, sec !== "None");
    cc.connectionTimeout = Number(spec.server.timeout === undefined ? 30 : spec.server.timeout);
    if (!Number.isInteger(cc.connectionTimeout) || cc.connectionTimeout <= 0) throw new Error(`${where}: server timeout is a number of seconds`);
    if (spec.server.user !== undefined || spec.server.password !== undefined) {
        if (spec.server.user === undefined || spec.server.password === undefined) throw new Error(`${where}: server 'user' and 'password' go together`);
        const auth = mf.BasicAuthConfig.createIn(a);
        auth.username = c.expr(spec.server.user, `${where} user`);
        auth.password = c.expr(spec.server.password, `${where} password`);
    }
    const msg = a.emailMessage || mf.EmailMessage.createInSendEmailActionUnderEmailMessage(a);
    msg.to = c.expr(spec.to, `${where} to`);
    msg.cc = spec.cc === undefined ? "" : c.expr(spec.cc, `${where} cc`);
    msg.bcc = spec.bcc === undefined ? "" : c.expr(spec.bcc, `${where} bcc`);
    if (spec.subject === undefined) throw new Error(`${where}: sendEmail needs 'subject' (text; {1} {2} from subjectArgs)`);
    if (spec.body === undefined && spec.html === undefined) throw new Error(`${where}: sendEmail needs 'body' (plain text) and/or 'html' (text; {1} {2} from bodyArgs)`);
    // 11.12+: text templates with arguments; before: one expression each
    if (atLeast(c, "11.12.0")) {
        c.fillTemplate(msg.subjectTemplate || mf.StringTemplate.createInEmailMessageUnderSubjectTemplate(msg), String(spec.subject), spec.subjectArgs, `${where} subject`);
        c.fillTemplate(msg.messageBodyPlainTextTemplate || mf.StringTemplate.createInEmailMessageUnderMessageBodyPlainTextTemplate(msg), String(spec.body || ""), spec.body === undefined ? [] : spec.bodyArgs, `${where} body`);
        c.fillTemplate(msg.messageBodyHtmlTemplate || mf.StringTemplate.createInEmailMessageUnderMessageBodyHtmlTemplate(msg), String(spec.html || ""), spec.html === undefined ? [] : spec.bodyArgs, `${where} html`);
        // Studio Pro writes the Test Email tab empty
        if (!a.testEmailMessage) mf.EmailMessage.createInSendEmailActionUnderTestEmailMessage(a);
        for (const t of ["subjectTemplate", "messageBodyPlainTextTemplate", "messageBodyHtmlTemplate"]) if (!a.testEmailMessage[t]) mf.StringTemplate[`createInEmailMessageUnder${t[0].toUpperCase()}${t.slice(1)}`](a.testEmailMessage);
    } else {
        if (spec.subjectArgs || spec.bodyArgs) throw new Error(`${where}: before Mendix 11.12 subject and body are expressions, without {1} arguments: write e.g. "'Order ' + toString($Order/Number)"`);
        msg.subject = c.expr(spec.subject, `${where} subject`);
        msg.messageBodyPlainText = spec.body === undefined ? "" : c.expr(spec.body, `${where} body`);
        msg.messageBodyHtml = spec.html === undefined ? "" : c.expr(spec.html, `${where} html`);
    }
    if (spec.attachment !== undefined) {
        needVersion(c, "11.3.0", "an email attachment", where);
        const info = await c.variableInfo(noDollar(spec.attachment), where);
        if (!info || !info.entity) throw new Error(`${where}: attachment is a System.FileDocument (or list) variable, $${noDollar(spec.attachment)} is not`);
        msg.attachment = noDollar(spec.attachment);
    }
    if (spec.headers !== undefined) {
        needVersion(c, "11.11.0", "custom email headers", where);
        if (typeof spec.headers !== "object" || Array.isArray(spec.headers)) throw new Error(`${where}: headers is { "Name": "expression" }`);
        for (const [k, v] of Object.entries(spec.headers)) {
            const hd = mf.EmailCustomHeader.createIn(msg);
            hd.name = k;
            hd.value = c.expr(v, `${where} header ${k}`);
        }
    }
    firstUse(c, "SendEmailAction", where);
    return a;
}

function emailSpec(a) {
    const m = a.emailMessage || {};
    const cc = a.emailConnectionConfig || {};
    const tplText = t => (t ? t.text : undefined);
    const tplArgs = t => (t && t.arguments.length ? t.arguments.map(x => x.expression) : undefined);
    const auth = a.emailAuthenticationConfig instanceof mf.BasicAuthConfig ? { user: a.emailAuthenticationConfig.username, password: a.emailAuthenticationConfig.password } : {};
    const out = {
        to: m.to, server: { host: cc.host, port: cc.port, from: cc.emailId, security: cc.securityType ? cc.securityType.name.toLowerCase() : "tls", checkIdentity: cc.checkServerIdentity, timeout: cc.connectionTimeout, ...auth }
    };
    if (m.cc) out.cc = m.cc;
    if (m.bcc) out.bcc = m.bcc;
    let tpl = false;
    try {
        tpl = !!m.subjectTemplate;
    } catch (e) {
        tpl = false;
    }
    if (tpl) {
        out.subject = tplText(m.subjectTemplate);
        out.subjectArgs = tplArgs(m.subjectTemplate);
        if (tplText(m.messageBodyPlainTextTemplate)) out.body = tplText(m.messageBodyPlainTextTemplate);
        if (tplText(m.messageBodyHtmlTemplate)) out.html = tplText(m.messageBodyHtmlTemplate);
        out.bodyArgs = tplArgs(m.messageBodyPlainTextTemplate) || tplArgs(m.messageBodyHtmlTemplate);
    } else {
        out.subject = m.subject;
        if (m.messageBodyPlainText) out.body = m.messageBodyPlainText;
        if (m.messageBodyHtml) out.html = m.messageBodyHtml;
    }
    try {
        if (m.attachment) out.attachment = m.attachment;
        if (m.customHeaders && m.customHeaders.length) out.headers = Object.fromEntries(m.customHeaders.map(h => [h.name, h.value]));
    } catch (e) {
        /* older versions */
    }
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
}

// ---------------------------------------------------------------- call web service (N-1)

// XML schema simple types -> Mendix result type of a one-part response
const XS = { string: "String", normalizedString: "String", token: "String", int: "Integer", integer: "Integer", short: "Integer", long: "Long", boolean: "Boolean", decimal: "Decimal", double: "Decimal", float: "Decimal", dateTime: "DateTime", date: "DateTime" };

async function importedService(c, qn, where) {
    const all = c.model.allImportedWebServices ? c.model.allImportedWebServices() : [];
    if (!all.length) throw new Error(`${where}: this project has no consumed (imported) web service. Studio Pro: right-click a module > Add other > Consumed web service, import the WSDL; then call it with callWebService (ops cannot import a WSDL)`);
    const doc = all.find(d => d.qualifiedName === qn);
    if (!doc) fail(`${where}: no consumed web service '${qn}'`, String(qn), all.map(d => d.qualifiedName));
    return doc.isLoaded ? doc : doc.load();
}

function operationsOf(svc) {
    const out = [];
    for (const s of (svc.wsdlDescription && svc.wsdlDescription.services) || []) for (const op of s.operations) out.push({ service: s, op, name: op.name, full: `${s.name}/${op.name}` });
    return out;
}

const partsOf = el => (el ? [...el.messagePartElements] : []);

async function callWebService(c, act, spec, where) {
    const svc = await importedService(c, spec.service, where);
    const ops = operationsOf(svc);
    const hits = ops.filter(x => x.name === spec.operation || x.full === spec.operation);
    if (!hits.length) fail(`${where}: ${spec.service} has no operation '${spec.operation}'`, String(spec.operation), ops.map(x => x.name));
    if (hits.length > 1) throw new Error(`${where}: '${spec.operation}' is in ${hits.length} services of ${spec.service}: write "Service/Operation" (${hits.map(x => x.full).join(", ")})`);
    const { service, op } = hits[0];
    if (op.requestHeaderElementName || partsOf(op.requestHeaderRpcElement).length) throw new Error(`${where}: ${op.name} has a request header; map it in Studio Pro (ops maps simple body parameters only)`);
    const parts = partsOf(op.requestBodyRpcElement);
    if (!parts.length && op.requestBodyElementName) throw new Error(`${where}: ${op.name} takes a document (${op.requestBodyElementName}), which needs an export mapping; add this call in Studio Pro (ops maps simple RPC parameters only)`);
    const args = spec.args || {};
    if (typeof args !== "object" || Array.isArray(args)) throw new Error(`${where}: args is { "parameter": "expression" }`);
    for (const k of Object.keys(args)) if (!parts.some(p => p.partName === k)) fail(`${where}: ${op.name} has no parameter '${k}'`, k, parts.map(p => p.partName));
    const missing = parts.filter(p => !(p.partName in args));
    if (missing.length) throw new Error(`${where}: ${op.name} needs args for: ${missing.map(p => p.partName).join(", ")} ("empty" sends nothing)`);
    const a = mf.WebServiceCallAction.createIn(act);
    a.importedWebService = svc;
    a.serviceName = service.name;
    a.operationName = op.name;
    a.useRequestTimeOut = spec.timeout !== undefined;
    a.timeOutExpression = spec.timeout === undefined ? "" : c.expr(String(spec.timeout), `${where} timeout`);
    mf.SimpleRequestHandling.createInWebServiceCallActionUnderRequestHeaderHandling(a);
    const body = mf.SimpleRequestHandling.createInWebServiceCallActionUnderRequestBodyHandling(a);
    for (const p of parts) {
        const m = mf.WebServiceOperationSimpleParameterMapping.createIn(body);
        m.parameterName = p.partName;
        m.parameterPath = p.partName;
        m.isChecked = true;
        m.argument = c.expr(args[p.partName], `${where} ${p.partName}`);
    }
    const http = a.httpConfiguration || mf.HttpConfiguration.createInWebServiceCallActionUnderHttpConfiguration(a);
    if (spec.location !== undefined) {
        http.overrideLocation = true;
        c.fillTemplate(http.customLocationTemplate || mf.StringTemplate.createInHttpConfigurationUnderCustomLocationTemplate(http), String(spec.location), spec.locationArgs, `${where} location`);
    }
    const r = a.resultHandling || mf.ResultHandling.createInWebServiceCallActionUnderResultHandling(a);
    const out = partsOf(op.responseBodyRpcElement);
    if (spec.variable) {
        const xs = out.length === 1 ? XS[String(out[0].typeName).split(":").pop()] : null;
        if (!xs) throw new Error(`${where}: ${op.name} answers ${out.length ? out.map(p => `${p.partName} (${p.typeName})`).join(", ") : "a document"}; a result variable needs an import mapping, add the call in Studio Pro (or leave out 'variable')`);
        r.storeInVariable = true;
        r.outputVariableName = noDollar(spec.variable);
        r.variableType = datatypes[`${xs}Type`].create(c.model);
    } else {
        r.storeInVariable = false;
        r.variableType = datatypes.VoidType.create(c.model);
    }
    firstUse(c, "WebServiceCallAction (stored as Microflows$CallWebServiceAction)", where);
    return a;
}

// ---------------------------------------------------------------- external actions and objects (F4, F5)

async function odataService(c, qn, where) {
    const all = c.model.allConsumedODataServices ? c.model.allConsumedODataServices() : [];
    if (!all.length) throw new Error(`${where}: this project has no consumed OData service. Studio Pro: Add other > Consumed OData service (or from the Catalog), then call its actions with callExternalAction`);
    const doc = all.find(d => d.qualifiedName === qn);
    if (!doc) fail(`${where}: no consumed OData service '${qn}'`, String(qn), all.map(d => d.qualifiedName));
    return doc.isLoaded ? doc : doc.load();
}

// The actions of the service's $metadata (OData v4 <Action Name=...><Parameter Name Type Nullable/></Action>).
function actionsOf(svc) {
    const xml = String(svc.metadata || "");
    const out = [];
    for (const m of xml.matchAll(/<Action\s+([^>]*?)(\/>|>([\s\S]*?)<\/Action>)/g)) {
        const attr = (s, n) => ((new RegExp(`${n}="([^"]*)"`)).exec(s) || [])[1];
        const params = [...(m[3] || "").matchAll(/<Parameter\s+([^>]*?)\/?>/g)].map(p => ({ name: attr(p[1], "Name"), type: attr(p[1], "Type"), nullable: attr(p[1], "Nullable") !== "false" }));
        const ret = /<ReturnType\s+([^>]*?)\/?>/.exec(m[3] || "");
        out.push({ name: attr(m[1], "Name"), bound: attr(m[1], "IsBound") === "true", params, returns: ret ? attr(ret[1], "Type") : null });
    }
    return out;
}

const EDM = { "Edm.String": "String", "Edm.Boolean": "Boolean", "Edm.Int32": "Integer", "Edm.Int16": "Integer", "Edm.Byte": "Integer", "Edm.Int64": "Long", "Edm.Decimal": "Decimal", "Edm.Double": "Decimal", "Edm.Single": "Decimal", "Edm.DateTimeOffset": "DateTime", "Edm.Date": "DateTime" };

async function callExternalAction(c, act, spec, where) {
    needVersion(c, "10.2.0", "call external action with parameters", where);
    const svc = await odataService(c, spec.service, where);
    const all = actionsOf(svc);
    const x = all.find(y => y.name === spec.name);
    if (!x) fail(`${where}: ${spec.service} has no action '${spec.name}'${all.length ? "" : " (its metadata lists no OData actions; functions cannot be called)"}`, String(spec.name), all.map(y => y.name));
    if (x.bound) throw new Error(`${where}: ${spec.name} is bound to an entity set; Studio Pro calls only unbound actions (CE7251)`);
    const args = spec.args || {};
    for (const k of Object.keys(args)) if (!x.params.some(p => p.name === k)) fail(`${where}: ${spec.name} has no parameter '${k}'`, k, x.params.map(p => p.name));
    const a = mf.CallExternalAction.createIn(act);
    a.consumedODataService = svc;
    a.name = x.name;
    for (const p of x.params) {
        const prim = EDM[p.type];
        if (!prim) throw new Error(`${where}: parameter ${p.name} is ${p.type} (an entity or collection); map it in Studio Pro (ops passes primitive parameters only)`);
        if (!(p.name in args) && !p.nullable) throw new Error(`${where}: ${spec.name} needs a value for ${p.name} (not nullable)`);
        const m = mf.ExternalActionParameterMapping.createIn(a);
        m.parameterName = p.name;
        m.parameterType = datatypes[`${prim}Type`].create(c.model);
        m.canBeEmpty = p.nullable; // compared with the contract on every build (CE7252 when it differs)
        m.argument = p.name in args ? c.expr(args[p.name], `${where} ${p.name}`) : "empty";
    }
    if (spec.variable) {
        const prim = x.returns && EDM[x.returns];
        if (!prim) throw new Error(`${where}: ${spec.name} returns ${x.returns || "nothing"}; ${x.returns ? "an entity result needs Studio Pro" : "leave out 'variable'"}`);
        a.variableName = noDollar(spec.variable);
        a.variableDataType = datatypes[`${prim}Type`].create(c.model);
    } else a.variableDataType = datatypes.VoidType.create(c.model);
    firstUse(c, "CallExternalAction", where);
    return a;
}

// An object variable of an external entity (from a consumed OData service).
async function externalObject(c, name, verb, where) {
    const info = await c.variableInfo(noDollar(name), where);
    if (!info || !info.entity || info.list) throw new Error(`${where}: ${verb} takes an object variable of an external entity; $${noDollar(name)} is ${info && info.list ? "a list" : "not an object"}`);
    const ent = await c.h.entity(info.entity);
    const src = ent.source;
    if (!src || !/ODataRemoteEntitySource/.test(src.structureTypeName)) throw new Error(`${where}: ${verb} only works on external entities (from a consumed OData service); ${info.entity} is a normal entity: use ${verb === "sendExternalObject" ? "commit" : "delete"}`);
    return ent;
}

// ---------------------------------------------------------------- the actions

const FLOW_ACTIONS = {
    sendEmail: {
        doc: "Send an email over SMTP (Mendix 11.2+, Studio Pro: Send email; before 11.12 subject and body are expressions).",
        fields: {
            to: "R expression: address(es), e.g. \"$Customer/Email\"", cc: "optional expression", bcc: "optional expression",
            subject: "R text (11.12+: {1} from subjectArgs; before: an expression)", subjectArgs: "optional [\"expression\"] (11.12+)",
            body: "plain text body (body and/or html)", html: "HTML body", bodyArgs: "optional [\"expression\"] for {1} in body/html (11.12+)",
            server: "required: { \"host\": expr, \"port\": expr, \"from\": expr, \"security\": none|ssl|tls, \"user\": expr, \"password\": expr, \"checkIdentity\": true/false, \"timeout\": seconds } (constants keep secrets out of the model: \"@Module.SmtpPassword\")",
            attachment: "optional FileDocument variable (11.3+)", headers: "optional { \"Name\": \"expression\" } (11.11+)"
        },
        only: "micro",
        type: () => mf.SendEmailAction,
        build: sendEmail,
        spec: emailSpec,
        describe: a => `SEND EMAIL to ${a.emailMessage ? a.emailMessage.to : "?"}`
    },
    callWebService: {
        doc: "Call an operation of a consumed (imported) SOAP web service with simple parameters (Studio Pro: Call web service; the service itself is imported in Studio Pro).",
        fields: {
            service: "R Module.ImportedWebService", operation: "R operation name (or Service/Operation)", args: "{ \"parameter\": \"expression\" } (every parameter)",
            timeout: "optional seconds (expression)", location: "optional text: another address ({1} from locationArgs)", locationArgs: "optional [\"expression\"]",
            variable: "optional result variable (a response of one simple value)"
        },
        only: "micro",
        creates: "variable",
        type: () => mf.WebServiceCallAction,
        build: callWebService,
        vars: a => (a.resultHandling && a.resultHandling.storeInVariable && a.resultHandling.outputVariableName ? [a.resultHandling.outputVariableName] : []),
        spec: a => {
            const out = { service: a.importedWebServiceQualifiedName, operation: `${a.serviceName}/${a.operationName}`, args: {} };
            const body = a.requestBodyHandling;
            if (body instanceof mf.SimpleRequestHandling) for (const m of body.parameterMappings) out.args[m.parameterName] = m.argument;
            if (a.useRequestTimeOut) out.timeout = a.timeOutExpression;
            const http = a.httpConfiguration;
            if (http && http.overrideLocation && http.customLocationTemplate) {
                out.location = http.customLocationTemplate.text;
                out.locationArgs = http.customLocationTemplate.arguments.map(x => x.expression);
            }
            if (a.resultHandling && a.resultHandling.storeInVariable) out.variable = a.resultHandling.outputVariableName;
            return out;
        },
        describe: a => `CALL WEB SERVICE ${a.importedWebServiceQualifiedName || "?"} ${a.operationName}`
    },
    callExternalAction: {
        doc: "Call an action of a consumed OData service (Mendix 10.2+, Studio Pro: Call external action); primitive parameters and results.",
        fields: { service: "R Module.ConsumedODataService", name: "R action name (from its $metadata)", args: "optional { \"Parameter\": \"expression\" } (a nullable parameter left out gets empty)", variable: "optional result variable (a primitive result)" },
        creates: "variable",
        type: () => mf.CallExternalAction,
        build: callExternalAction,
        vars: a => (a.variableName ? [a.variableName] : []),
        spec: a => ({ service: a.consumedODataServiceQualifiedName, name: a.name, args: Object.fromEntries(a.parameterMappings.filter(m => m.argument !== "empty").map(m => [m.parameterName, m.argument])), ...(a.variableName ? { variable: a.variableName } : {}) }),
        describe: a => `CALL EXTERNAL ACTION ${a.consumedODataServiceQualifiedName || "?"}.${a.name}${a.variableName ? " -> $" + a.variableName : ""}`
    },
    sendExternalObject: {
        doc: "Send the changes of an external object to its OData service (Studio Pro: Send external object).",
        fields: { variable: "R object variable of an external entity (no $)", refresh: "optional true/false: refresh in client" },
        type: () => mf.SendExternalObject,
        async build(c, act, spec, where) {
            await externalObject(c, spec.variable, "sendExternalObject", where);
            const a = mf.SendExternalObject.createIn(act);
            a.variableNameToBeSent = noDollar(spec.variable);
            a.refreshInClient = bool(spec.refresh, false);
            firstUse(c, "SendExternalObject", where);
            return a;
        },
        spec: a => ({ variable: a.variableNameToBeSent, refresh: a.refreshInClient }),
        describe: a => `SEND EXTERNAL OBJECT $${a.variableNameToBeSent}`
    },
    deleteExternalObject: {
        doc: "Delete an external object in its OData service (Studio Pro: Delete external object).",
        fields: { variable: "R object variable of an external entity (no $)", refresh: "optional true/false: refresh in client" },
        type: () => mf.DeleteExternalObject,
        async build(c, act, spec, where) {
            await externalObject(c, spec.variable, "deleteExternalObject", where);
            const a = mf.DeleteExternalObject.createIn(act);
            a.deleteVariableName = noDollar(spec.variable);
            a.refreshInClient = bool(spec.refresh, false);
            firstUse(c, "DeleteExternalObject", where);
            return a;
        },
        spec: a => ({ variable: a.deleteVariableName, refresh: a.refreshInClient }),
        describe: a => `DELETE EXTERNAL OBJECT $${a.deleteVariableName}`
    },
    synchronizeToDevice: {
        doc: "Mark an object or list to go to the offline device on the next synchronization (microflows, Studio Pro: Synchronize to device).",
        fields: { variable: "R object or list variable (no $)" },
        only: "micro",
        type: () => mf.PushToClientAction,
        async build(c, act, spec, where) {
            const info = await c.variableInfo(noDollar(spec.variable), where);
            if (!info || !info.entity) throw new Error(`${where}: synchronizeToDevice takes an object or list variable; $${noDollar(spec.variable)} is not one`);
            const a = mf.PushToClientAction.createIn(act);
            a.dataVariableName = noDollar(spec.variable);
            firstUse(c, "PushToClientAction", where);
            return a;
        },
        spec: a => ({ variable: a.dataVariableName }),
        describe: a => `SYNCHRONIZE TO DEVICE $${a.dataVariableName}`
    },
    clearFromDevice: {
        doc: "Remove the objects of an entity from the offline device database (nanoflows, Studio Pro: Clear from device); 11.14+ also all objects or given variables.",
        fields: { entity: "Module.Entity (all its objects)", objects: "11.14+: all | [ \"Variable\", ... ] instead of entity" },
        only: "nano",
        type: () => mf.ClearFromClientAction,
        async build(c, act, spec, where) {
            if ((spec.entity === undefined) === (spec.objects === undefined)) throw new Error(`${where}: clearFromDevice needs 'entity' or 'objects' (one of them)`);
            const a = mf.ClearFromClientAction.createIn(act);
            if (spec.entity !== undefined) {
                a.entity = await c.h.entity(spec.entity);
                if (atLeast(c, "11.14.0")) a.clearType = mf.ClearFromClientType.Specific;
            } else {
                needVersion(c, "11.14.0", "clearFromDevice 'objects'", where);
                if (String(spec.objects).toLowerCase() === "all") a.clearType = mf.ClearFromClientType.All;
                else {
                    if (!Array.isArray(spec.objects) || !spec.objects.length) throw new Error(`${where}: objects is "all" or [ "Variable", ... ]`);
                    a.clearType = mf.ClearFromClientType.Specific;
                    for (const v of spec.objects) {
                        const info = await c.variableInfo(noDollar(v), where);
                        if (!info || !info.entity) throw new Error(`${where}: $${noDollar(v)} is not an object or list`);
                        a.variableNames.push(noDollar(v));
                    }
                }
            }
            firstUse(c, "ClearFromClientAction", where);
            return a;
        },
        spec: a => (a.entityQualifiedName ? { entity: a.entityQualifiedName } : { objects: a.clearType && a.clearType.name === "All" ? "all" : [...a.variableNames] }),
        describe: a => `CLEAR FROM DEVICE ${a.entityQualifiedName || "objects"}`
    },
    cancelSynchronization: {
        doc: "Stop a running synchronization (nanoflows in an offline-first app, Mendix 11.8+, Studio Pro: Cancel synchronization).",
        fields: {},
        only: "nano",
        type: () => mf.CancelSynchronizationAction,
        async build(c, act, spec, where) {
            needVersion(c, "11.8.0", "cancelSynchronization", where);
            const why = await require("./ops-offline").offlineReason(c.model);
            if (why) throw new Error(`${where}: cancelSynchronization ${why}`);
            const a = mf.CancelSynchronizationAction.createIn(act);
            firstUse(c, "CancelSynchronizationAction", where);
            return a;
        },
        spec: () => ({}),
        describe: () => "CANCEL SYNCHRONIZATION"
    }
};

// Old names weak models use for these actions
const ALIASES = { pushToClient: "synchronizeToDevice", clearFromClient: "clearFromDevice", sendMail: "sendEmail", email: "sendEmail" };

module.exports = { FLOW_ACTIONS, ALIASES, actionsOf };
