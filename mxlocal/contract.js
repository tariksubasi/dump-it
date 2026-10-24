"use strict";
// contract: read an API contract file (OpenAPI 2/3 JSON or YAML, a SOAP WSDL, an OData $metadata) and say what it
// holds, read-only. For OpenAPI it also writes a change plan (createConsumedRestService with every operation:
// path, query and header parameters, bearer/basic/API key authentication, JSON body and response mappings from the
// schemas) for a dry run: ops writes a REST client document of its own, not the one Studio Pro imports from the file
// (its OpenApiFile link has no Studio Pro sample). A WSDL or $metadata cannot be imported by ops (Studio Pro reads,
// validates and keeps those documents in sync); for them the output lists the operations / entities, writes the XML
// schemas of a WSDL as .xsd files (createXmlSchema reads them) and, for OData, a plan of JSON structures and import
// mappings that read the entity sets through callRest, next to the Studio Pro steps.
const fs = require("fs");
const path = require("path");
const { parseXml } = require("./ops-xml");

const local = n => String(n).split(":").pop();
const kids = (el, name) => el.children.filter(c => local(c.name) === name);
const ident = (s, fallback) => {
    let n = String(s || "").replace(/[^A-Za-z0-9_]+(.)?/g, (m, c) => (c ? c.toUpperCase() : "")).replace(/^[^A-Za-z]+/, "");
    if (!n) n = fallback;
    return n[0].toUpperCase() + n.slice(1);
};

// ---------------------------------------------------------------- a YAML subset (what OpenAPI files use)

// Block mappings and sequences by indentation, plain / quoted scalars, flow [a, b] and {} on one line, | and > text.
function parseYaml(text) {
    const lines = String(text).replace(/\r/g, "").split("\n").map((raw, n) => ({ raw, n: n + 1 }));
    const rows = [];
    for (const l of lines) {
        if (/^\s*(#.*)?$/.test(l.raw) || /^(---|\.\.\.)\s*$/.test(l.raw)) continue;
        rows.push({ ind: l.raw.match(/^ */)[0].length, text: l.raw.trim(), n: l.n, raw: l.raw });
    }
    let i = 0;
    const fail = (r, what) => {
        throw new Error(`YAML line ${r ? r.n : "end"}: ${what} (this reader knows the YAML OpenAPI files use; convert the file to JSON if it fails)`);
    };
    const stripComment = s => {
        let q = null;
        for (let k = 0; k < s.length; k++) {
            const c = s[k];
            if (q) {
                if (c === q && s[k - 1] !== "\\") q = null;
            } else if (c === "'" || c === '"') q = c;
            else if (c === "#" && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k).trimEnd();
        }
        return s;
    };
    const scalar = s => {
        s = stripComment(s).trim();
        if (s === "" || s === "~" || s === "null") return null;
        if (s.startsWith('"')) return JSON.parse(s.replace(/\\'/g, "'"));
        if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
        if (s.startsWith("[") || s.startsWith("{")) return flow(s);
        if (s === "true") return true;
        if (s === "false") return false;
        if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
        return s;
    };
    // flow collections on one line: [a, "b", {c: d}]
    const flow = s => {
        let k = 0;
        const ws = () => {
            while (/\s/.test(s[k] || "")) k++;
        };
        const val = () => {
            ws();
            if (s[k] === "[") {
                k++;
                const out = [];
                for (ws(); s[k] !== "]"; ws()) {
                    out.push(val());
                    ws();
                    if (s[k] === ",") k++;
                    else if (s[k] !== "]") throw new Error(`YAML flow sequence: ${s}`);
                }
                k++;
                return out;
            }
            if (s[k] === "{") {
                k++;
                const out = {};
                for (ws(); s[k] !== "}"; ws()) {
                    const key = atom(":");
                    k++;
                    out[key] = val();
                    ws();
                    if (s[k] === ",") k++;
                    else if (s[k] !== "}") throw new Error(`YAML flow mapping: ${s}`);
                }
                k++;
                return out;
            }
            return scalarAtom();
        };
        const atom = stop => {
            ws();
            if (s[k] === '"' || s[k] === "'") {
                const q = s[k];
                const e = s.indexOf(q, k + 1);
                const r = s.slice(k + 1, e);
                k = e + 1;
                ws();
                return r;
            }
            const st = k;
            while (k < s.length && !(stop.includes(s[k]))) k++;
            return s.slice(st, k).trim();
        };
        const scalarAtom = () => {
            const st = k;
            if (s[k] === '"' || s[k] === "'") {
                const q = s[k];
                k = s.indexOf(q, k + 1) + 1;
                return scalar(s.slice(st, k));
            }
            while (k < s.length && !",]}".includes(s[k])) k++;
            return scalar(s.slice(st, k));
        };
        return val();
    };
    // the key of "key: value" (quoted keys allowed); null when the row is no mapping entry
    const keyOf = t => {
        if (t.startsWith("{") || t.startsWith("[")) return null; // a flow collection, not "key: value"
        const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^'"#][^#]*?)\s*:(\s|$)/.exec(t);
        if (!m) return null;
        return { key: String(scalar(m[1])), rest: t.slice(m[0].length) };
    };
    // | keeps the lines, > folds them (blank lines inside are dropped: descriptions only)
    const block = (ind, style) => {
        const out = [];
        const at = i < rows.length ? rows[i].ind : 0;
        while (i < rows.length && rows[i].ind > ind) out.push(rows[i++].raw.slice(at));
        return style.startsWith("|") ? out.join("\n") + "\n" : out.map(l => l.trim()).join(" ") + "\n";
    };
    const node = ind => {
        const r = rows[i];
        if (!r || r.ind < ind) return null;
        if (r.text.startsWith("- ") || r.text === "-") return seq(r.ind);
        if (keyOf(r.text)) return map(r.ind);
        i++;
        return scalar(r.text);
    };
    const value = (rest, ind) => {
        rest = stripComment(rest).trim();
        if (rest === "") return i < rows.length && rows[i].ind > ind ? node(rows[i].ind) : i < rows.length && rows[i].ind === ind && rows[i].text.startsWith("-") ? seq(ind) : null;
        if (/^[|>][-+]?$/.test(rest)) return block(ind, rest);
        if (rest.startsWith("&") || rest.startsWith("*")) fail(rows[i - 1], "anchors and aliases are not read");
        return scalar(rest);
    };
    const map = ind => {
        const out = {};
        while (i < rows.length && rows[i].ind === ind && !rows[i].text.startsWith("- ")) {
            const r = rows[i];
            const kv = keyOf(r.text);
            if (!kv) fail(r, "expected key: value");
            i++;
            out[kv.key] = value(kv.rest, ind);
        }
        if (i < rows.length && rows[i].ind > ind) fail(rows[i], "bad indentation");
        return out;
    };
    const seq = ind => {
        const out = [];
        while (i < rows.length && rows[i].ind === ind && (rows[i].text.startsWith("- ") || rows[i].text === "-")) {
            const r = rows[i];
            const rest = r.text === "-" ? "" : r.text.slice(2);
            if (rest.trim() === "") {
                i++;
                out.push(i < rows.length && rows[i].ind > ind ? node(rows[i].ind) : null);
                continue;
            }
            const kv = keyOf(rest);
            if (kv) {
                // "- key: value" starts a mapping indented at the key
                const at = ind + 2 + (rest.length - rest.trimStart().length);
                rows[i] = { ...r, ind: at, text: rest.trim() };
                out.push(map(at));
            } else {
                i++;
                out.push(scalar(rest));
            }
        }
        return out;
    };
    const top = node(0);
    if (i < rows.length) fail(rows[i], "unexpected text");
    return top;
}

// ---------------------------------------------------------------- OpenAPI

const PRIM = (s = {}) => {
    const t = Array.isArray(s.type) ? s.type.find(x => x !== "null") : s.type;
    if (t === "integer") return s.format === "int64" ? "Long" : "Integer";
    if (t === "number") return "Decimal";
    if (t === "boolean") return "Boolean";
    if (t === "string" && (s.format === "date-time" || s.format === "date")) return "DateTime";
    return "String";
};

function openApi(doc, file, o) {
    const v3 = !!doc.openapi;
    const resolve = (x, seen = new Set()) => {
        if (!x || typeof x !== "object" || !x.$ref) return x;
        if (seen.has(x.$ref)) return {};
        if (!x.$ref.startsWith("#/")) throw new Error(`${file}: reference ${x.$ref} points into another file; put the API into one file`);
        let t = doc;
        for (const p of x.$ref.slice(2).split("/")) t = t && t[p.replace(/~1/g, "/").replace(/~0/g, "~")];
        if (!t) throw new Error(`${file}: reference ${x.$ref} not found`);
        seen.add(x.$ref);
        return resolve(t, seen);
    };
    const refName = x => (x && x.$ref ? x.$ref.split("/").pop() : null);
    // an example JSON value for a schema (examples first), depth-limited; allOf merged, oneOf/anyOf: the first
    const sample = (s, depth = 0) => {
        s = resolve(s) || {};
        if (s.example !== undefined) return s.example;
        if (s.allOf) return Object.assign({}, ...s.allOf.map(x => sample(x, depth)).filter(x => x && typeof x === "object" && !Array.isArray(x)));
        if (s.oneOf || s.anyOf) return sample((s.oneOf || s.anyOf)[0], depth);
        const t = Array.isArray(s.type) ? s.type.find(x => x !== "null") : s.type;
        if (t === "array" || s.items) return depth > 4 ? [] : [sample(s.items || {}, depth + 1)];
        if (t === "object" || s.properties) {
            if (depth > 4) return {};
            const out = {};
            for (const [k, p] of Object.entries(s.properties || {})) out[k] = sample(p, depth + 1);
            return out;
        }
        if (s.enum && s.enum.length) return s.enum[0];
        return { Integer: 1, Long: 1, Decimal: 1.5, Boolean: true, DateTime: "2024-01-01T00:00:00Z" }[PRIM(s)] ?? "text";
    };
    let base = "";
    if (v3) base = (doc.servers && doc.servers[0] && doc.servers[0].url) || "";
    else if (doc.host) base = `${(doc.schemes && doc.schemes[0]) || "https"}://${doc.host}${doc.basePath || ""}`;
    const notes = [];
    if (v3 && doc.servers && doc.servers[0] && doc.servers[0].variables) for (const [k, v] of Object.entries(doc.servers[0].variables)) base = base.replace(`{${k}}`, v.default);
    if (!/^https?:\/\//.test(base)) {
        notes.push(`the file has no absolute server URL${base ? ` (${base})` : ""}: the plan uses https://api.example.com${base.startsWith("/") ? base : ""}; change baseUrl`);
        base = `https://api.example.com${base.startsWith("/") ? base : ""}`;
    }
    // authentication: the first security scheme ops can write
    const schemes = v3 ? (doc.components && doc.components.securitySchemes) || {} : doc.securityDefinitions || {};
    let auth = null, apiKey = null;
    const M = o.module || "MyModule";
    const constants = [];
    for (const [name, sc] of Object.entries(schemes)) {
        const s = resolve(sc);
        if (!auth && !apiKey && ((s.type === "http" && /^bearer$/i.test(s.scheme)) || s.type === "oauth2" || s.type === "openIdConnect")) {
            auth = { bearer: "token" };
            if (s.type !== "http") notes.push(`${name} is ${s.type}: the plan sends a bearer token parameter; getting the token (OAuth flow) stays your microflow's work`);
        } else if (!auth && !apiKey && ((s.type === "http" && /^basic$/i.test(s.scheme)) || s.type === "basic")) {
            auth = { username: `@${M}.${ident(o.name || "Api")}User`, password: `@${M}.${ident(o.name || "Api")}Password` };
            constants.push(`${ident(o.name || "Api")}User`, `${ident(o.name || "Api")}Password`);
        } else if (!auth && !apiKey && s.type === "apiKey") {
            if (s.in === "header") apiKey = { header: s.name, param: ident(s.name, "ApiKey").replace(/^./, c => c.toLowerCase()) };
            else notes.push(`${name}: an API key in the ${s.in} is not written by the plan; add it as a query parameter`);
        }
    }
    const ops = [];
    const used = new Set();
    const lines = [];
    for (const [p, item] of Object.entries(doc.paths || {})) {
        const shared = item.parameters || [];
        for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
            const op = item[method];
            if (!op) continue;
            let name = ident(op.operationId || `${method}_${p}`, "Operation");
            for (let k = 2; used.has(name); k++) name = `${name.replace(/\d+$/, "")}${k}`;
            used.add(name);
            const params = [...shared, ...(op.parameters || [])].map(x => resolve(x));
            const spec = { name, method: method[0].toUpperCase() + method.slice(1), path: p.replace(/\{([^}]+)\}/g, (m, n) => `{${ident(n, "p").replace(/^./, c => c.toLowerCase())}}`) };
            const types = {}, query = {}, headers = {};
            const skipped = [];
            for (const x of params) {
                const n = ident(x.name, "p").replace(/^./, c => c.toLowerCase());
                const t = PRIM(x.schema || x);
                if (x.in === "path") types[n] = t;
                else if (x.in === "query") query[n] = x.required ? {} : { required: false };
                else if (x.in === "header" && !(apiKey && x.name === apiKey.header) && !/^(accept|content-type|authorization)$/i.test(x.name)) {
                    headers[x.name] = `{${n}}`;
                    types[n] = t;
                } else if (x.in === "formData" || x.in === "cookie") skipped.push(`${x.name} (${x.in})`);
            }
            if (apiKey) headers[apiKey.header] = `{${apiKey.param}}`;
            if (Object.keys(types).length) spec.parameters = types;
            if (Object.keys(query).length) spec.query = query;
            if (Object.keys(headers).length) spec.headers = headers;
            // body: JSON object -> an export mapping over the schema's entity; else a text template
            const body = v3 ? op.requestBody && resolve(op.requestBody) : params.find(x => x.in === "body");
            if (body && ["Post", "Put", "Patch"].includes(spec.method)) {
                const schema = v3 ? (body.content && (body.content["application/json"] || Object.values(body.content)[0]) || {}).schema : body.schema;
                const ex = schema ? sample(schema) : null;
                const json = v3 ? body.content && body.content["application/json"] : true;
                if (json && ex && typeof ex === "object" && !Array.isArray(ex) && Object.keys(ex).length && o.mappings !== false) spec.body = { snippet: JSON.stringify(ex), entity: `${M}.${ident(refName(schema) || `${name}Request`, "Request")}`, create: true, persistable: false };
                else {
                    spec.body = "{body}";
                    spec.parameters = { ...(spec.parameters || {}), body: "String" };
                    if (!json) skipped.push(`a ${Object.keys(body.content || {})[0]} body (sent as the text parameter body)`);
                }
            } else if (spec.method !== "Get" && ["Post", "Put", "Patch"].includes(spec.method)) spec.body = "{}";
            // response: the first 2xx JSON object/array -> an import mapping
            const resp = Object.entries(op.responses || {}).find(([c]) => /^2/.test(c));
            const rs = resp && resolve(resp[1]);
            const rschema = rs && (v3 ? (rs.content && rs.content["application/json"] || {}).schema : rs.schema);
            if (rschema && o.mappings !== false) {
                const ex = sample(rschema);
                const r = resolve(rschema);
                const item = r && (r.items || (r.type === "array" ? {} : null));
                const ename = ident(refName(item) || refName(rschema) || `${name}Result`, "Result");
                if (ex && typeof ex === "object" && Object.keys(Array.isArray(ex) ? ex[0] || {} : ex).length) spec.response = { snippet: JSON.stringify(ex), entity: `${M}.${ename}`, create: true, persistable: false };
            }
            ops.push(spec);
            lines.push(`  ${spec.method.toUpperCase().padEnd(6)} ${p}  ->  ${name}${spec.query ? `  query: ${Object.keys(spec.query).join(", ")}` : ""}${spec.response ? `  response: ${spec.response.entity}` : ""}${skipped.length ? `  (not written: ${skipped.join(", ")})` : ""}`);
        }
    }
    if (!ops.length) throw new Error(`${file}: no operations under "paths"`);
    const svcName = ident(o.name || (doc.info && doc.info.title) || "Api", "Api").slice(0, 40);
    const plan = { ops: [
        ...constants.map(c => ({ op: "createConstant", module: M, name: c, type: "String", default: "set-per-environment", folder: svcName })),
        { op: "createConsumedRestService", module: M, name: svcName, folder: svcName, baseUrl: base.replace(/\/+$/, ""), ...(auth ? { authentication: auth } : {}), operations: ops }
    ] };
    if (ops.some(x => x.query && Object.values(x.query).some(q => q.required === false))) notes.push("optional query parameters (\"required\": false) need Mendix 11; for Mendix 10 drop them or make them required in the plan");
    if (auth && auth.bearer) notes.push("every operation gets the header Authorization: Bearer {token}; give token in sendRestRequest args");
    if (apiKey) notes.push(`every operation gets the header ${apiKey.header}: {${apiKey.param}}; give ${apiKey.param} in sendRestRequest args (keep the key in a constant)`);
    if (constants.length) notes.push(`fill the constants ${constants.map(c => `${M}.${c}`).join(", ")} (createConstant default, or per environment)`);
    notes.push("entities of body and response mappings are created non-persistable (persistable: false): review their names in the dry run");
    return {
        text: [`OpenAPI ${doc.openapi || doc.swagger} "${(doc.info && doc.info.title) || ""}" ${(doc.info && doc.info.version) || ""}: ${ops.length} operation(s), base URL ${base}`, ...lines, "", "Notes:", ...notes.map(n => "  - " + n)].join("\n"),
        plan,
        steps: "Studio Pro (10.21+) can also import the file itself: Add other > Consumed REST service > Import OpenAPI file. The plan below writes the same REST client document by ops."
    };
}

// ---------------------------------------------------------------- WSDL

function wsdl(text, file, o) {
    const x = parseXml(text);
    if (local(x.name) !== "definitions" && local(x.name) !== "description") throw new Error(`${file}: the root element is <${x.name}>, not a WSDL <definitions>`);
    const tns = x.attrs.targetNamespace || "";
    const messages = Object.fromEntries(kids(x, "message").map(m => [m.attrs.name, kids(m, "part").map(p => p.attrs.element || `${p.attrs.name}: ${local(p.attrs.type || "")}`)]));
    const portTypes = kids(x, "portType").map(pt => ({
        name: pt.attrs.name,
        ops: kids(pt, "operation").map(op => {
            const msg = el => {
                const e = kids(op, el)[0];
                return e ? (messages[local(e.attrs.message)] || [local(e.attrs.message)]).map(local) : [];
            };
            return { name: op.attrs.name, input: msg("input"), output: msg("output"), faults: kids(op, "fault").map(f => f.attrs.name) };
        })
    }));
    const actions = {};
    for (const b of kids(x, "binding")) for (const op of kids(b, "operation")) for (const so of op.children.filter(c => local(c.name) === "operation" && c !== op)) if (so.attrs.soapAction !== undefined) actions[op.attrs.name] = so.attrs.soapAction;
    const services = kids(x, "service").map(s => ({ name: s.attrs.name, ports: kids(s, "port").map(p => ({ name: p.attrs.name, address: ((p.children.find(c => local(c.name) === "address") || { attrs: {} }).attrs.location) || "" })) }));
    // the XML schemas inside <types>, with the namespace declarations of the root, as .xsd files
    const xsds = [];
    const rootNs = Object.entries(x.attrs).filter(([k]) => k.startsWith("xmlns"));
    const body = String(text).replace(/<!--[\s\S]*?-->/g, "");
    for (const m of body.matchAll(/<((?:[\w.-]+:)?schema)\b([^>]*[^/])?>([\s\S]*?)<\/\1>/g)) {
        let open = m[2] || "";
        for (const [k, v] of rootNs) if (!new RegExp(`\\s${k.replace(".", "\\.")}\\s*=`).test(open)) open += ` ${k}="${v}"`;
        xsds.push(`<?xml version="1.0" encoding="UTF-8"?>\n<${m[1]}${open}>${m[3]}</${m[1]}>\n`);
    }
    const lines = [`WSDL ${path.basename(file)}: target namespace ${tns || "(none)"}`];
    for (const s of services) for (const p of s.ports) lines.push(`  service ${s.name}, port ${p.name}: ${p.address || "(no address)"}`);
    for (const pt of portTypes) for (const op of pt.ops) lines.push(`  operation ${op.name}${actions[op.name] ? ` (SOAPAction ${actions[op.name]})` : ""}: in ${op.input.join(", ") || "-"}; out ${op.output.join(", ") || "-"}${op.faults.length ? `; faults ${op.faults.join(", ")}` : ""}`);
    const files = [];
    if (o.out && xsds.length) {
        for (const [k, s] of xsds.entries()) {
            const f = path.join(o.out, `${path.basename(file).replace(/\.\w+$/, "")}${xsds.length > 1 ? `-${k + 1}` : ""}.xsd`);
            fs.writeFileSync(f, s);
            files.push(f);
        }
    }
    const M = o.module || "MyModule";
    const plan = files.length && o.module ? { ops: files.map((f, k) => ({ op: "createXmlSchema", module: M, name: `${ident(path.basename(file).replace(/\.\w+$/, ""), "Wsdl")}_Schema${files.length > 1 ? k + 1 : ""}`, file: f })) } : null;
    if (xsds.length) lines.push("", `${xsds.length} XML schema(s) in <types>${files.length ? `: written to ${files.join(", ")}` : " (give --out <folder> to write them as .xsd files)"}`);
    return {
        text: lines.join("\n"),
        plan,
        steps: "ops does not import a WSDL (consumeWebService is refused): in Studio Pro, Add other > Consumed web service > Import, choose the file (or URL) and the operations, then Call web service in a microflow (ops can add callWebService with simple parameters once the service is there; complex requests and responses use the mappings Studio Pro makes). The plan only adds the XML schemas (createXmlSchema), for XML import/export mappings of the messages."
    };
}

// ---------------------------------------------------------------- OData $metadata

const EDM = { "Edm.String": "String", "Edm.Int32": "Integer", "Edm.Int16": "Integer", "Edm.Byte": "Integer", "Edm.SByte": "Integer", "Edm.Int64": "Long", "Edm.Decimal": "Decimal", "Edm.Double": "Decimal", "Edm.Single": "Decimal", "Edm.Boolean": "Boolean", "Edm.DateTimeOffset": "DateTime", "Edm.DateTime": "DateTime", "Edm.Date": "DateTime", "Edm.Guid": "String" };
const EDM_SAMPLE = { String: "text", Integer: 1, Long: 1, Decimal: 1.5, Boolean: true, DateTime: "2024-01-01T00:00:00Z" };

function metadata(text, file, o) {
    const x = parseXml(text);
    if (local(x.name) !== "Edmx") throw new Error(`${file}: the root element is <${x.name}>, not an OData <edmx:Edmx> ($metadata)`);
    const schemas = [];
    const walk = el => {
        if (local(el.name) === "Schema") schemas.push(el);
        el.children.forEach(walk);
    };
    walk(x);
    const types = {}, sets = [], actions = [];
    for (const s of schemas) {
        for (const t of kids(s, "EntityType")) types[`${s.attrs.Namespace}.${t.attrs.Name}`] = {
            name: t.attrs.Name,
            key: kids(t, "Key").flatMap(k => kids(k, "PropertyRef").map(p => p.attrs.Name)),
            props: kids(t, "Property").map(p => ({ name: p.attrs.Name, type: p.attrs.Type, prim: EDM[p.attrs.Type] || (/^Collection\(/.test(p.attrs.Type) ? null : "String") })),
            nav: kids(t, "NavigationProperty").map(p => `${p.attrs.Name} -> ${(p.attrs.Type || p.attrs.ToRole || "").replace(/^Collection\((.*)\)$/, "$1[]")}`)
        };
        for (const a of [...kids(s, "Action"), ...kids(s, "Function")]) actions.push(`${local(a.name).toLowerCase()} ${a.attrs.Name}(${kids(a, "Parameter").map(p => `${p.attrs.Name}: ${p.attrs.Type}`).join(", ")})${kids(a, "ReturnType")[0] ? ` -> ${kids(a, "ReturnType")[0].attrs.Type}` : ""}`);
        for (const c of kids(s, "EntityContainer")) for (const es of kids(c, "EntitySet")) sets.push({ name: es.attrs.Name, type: es.attrs.EntityType });
    }
    const version = x.attrs.Version || "";
    const lines = [`OData ${version === "4.0" ? "v4" : version || "?"} $metadata ${path.basename(file)}: ${sets.length} entity set(s), ${Object.keys(types).length} entity type(s), ${actions.length} action(s)/function(s)`];
    for (const s of sets) {
        const t = types[s.type] || { name: s.type, key: [], props: [], nav: [] };
        lines.push(`  ${s.name} (${t.name}; key ${t.key.join(", ") || "?"}): ${t.props.map(p => `${p.name} ${p.prim || p.type}`).join(", ")}${t.nav.length ? `; navigation ${t.nav.join(", ")}` : ""}`);
    }
    for (const a of actions) lines.push(`  ${a}`);
    let plan = null;
    if (o.module) {
        const M = o.module;
        const opsList = [];
        for (const s of sets) {
            const t = types[s.type];
            if (!t || !t.props.length) continue;
            const item = Object.fromEntries(t.props.filter(p => p.prim).map(p => [p.name, EDM_SAMPLE[p.prim]]));
            const E = ident(t.name, "Entity");
            opsList.push({ op: "createJsonStructure", module: M, name: `JSON_${ident(s.name, "Set")}`, folder: "OData", snippet: JSON.stringify(version === "4.0" ? { value: [item] } : { d: { results: [item] } }) });
            opsList.push({ op: "createImportMapping", module: M, name: `IMM_${ident(s.name, "Set")}`, folder: "OData", jsonStructure: `${M}.JSON_${ident(s.name, "Set")}`, entity: `${M}.${E}Page`, entities: { [version === "4.0" ? "value" : "d/results"]: `${M}.${E}` }, keys: t.key.filter(k => item[k] !== undefined).map(k => `${version === "4.0" ? "value" : "d/results"}/${k}`), create: true, persistable: false });
        }
        plan = opsList.length ? { ops: opsList } : null;
    }
    return {
        text: lines.join("\n"),
        plan,
        steps: "ops does not import a $metadata (consumeODataService is refused): in Studio Pro, Add other > Consumed OData service, choose the file (or the service URL / Catalog), then drag the entity sets into the domain model as external entities; ops can then call its actions (callExternalAction) and send/delete external objects. The plan instead makes non-persistable entities, JSON structures and import mappings that read each entity set as JSON: call <service URL>/<EntitySet> with callRest (headers Accept: application/json) and import the response with IMM_<EntitySet>."
    };
}

// ---------------------------------------------------------------- entry

function inspectContract(file, o = {}) {
    if (!fs.existsSync(file)) throw new Error(`contract: file ${file} not found`);
    const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    const t = text.trimStart();
    let r;
    if (t.startsWith("<")) {
        const head = t.slice(0, 2000);
        if (/<(?:\w+:)?Edmx\b/.test(head)) r = metadata(text, file, o);
        else if (/<(?:\w+:)?(definitions|description)\b/.test(head)) r = wsdl(text, file, o);
        else throw new Error(`contract: ${file} is XML but neither a WSDL nor an OData $metadata`);
    } else {
        let doc;
        try {
            doc = t.startsWith("{") ? JSON.parse(text) : parseYaml(text);
        } catch (e) {
            throw new Error(`contract: ${file} is no JSON or YAML OpenAPI file: ${e.message}`);
        }
        if (!doc || (!doc.openapi && !doc.swagger)) throw new Error(`contract: ${file} has no "openapi" or "swagger" field; is it an OpenAPI file?`);
        r = openApi(doc, file, o);
    }
    const out = [r.text, "", r.steps];
    if (r.plan && o.out) {
        const f = path.join(o.out, `${path.basename(file).replace(/\.\w+$/, "")}-plan.json`);
        fs.writeFileSync(f, JSON.stringify(r.plan, null, 2) + "\n");
        out.push("", `Plan (${r.plan.ops.length} op(s)) written to ${f}: review it, then dry run it like any change file.`);
    } else if (r.plan) out.push("", "Plan (give --out <folder> to write it as a file):", JSON.stringify(r.plan, null, 2));
    else if (!o.module) out.push("", "Give --module <Module> for a change plan.");
    return { text: out.join("\n"), plan: r.plan };
}

module.exports = { inspectContract, parseYaml };
