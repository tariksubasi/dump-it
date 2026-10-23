"use strict";
// Java actions, JavaScript actions and rules. A Java/JavaScript action also gets its source file
// (javasource/<module>/actions/<Name>.java, javascriptsource/<module>/actions/<Name>.js) exactly as Studio Pro
// generates it (CRLF, the BEGIN/END USER CODE and EXTRA CODE markers). The file is part of the change: the dry run
// shows it, apply backs it up and writes it, restore puts the old state back. An existing file keeps its import list,
// user code and extra code (only the generated part is renewed, as Studio Pro does on deploy).
// changeJavaAction / changeJavaScriptAction change parameters (add / remove / retype, type parameters), the return
// type, platform and documentation, renew the file the same way, put new code into USER CODE (JS CHECK: node --check;
// JAVA CHECK: javac) and update the microflow / nanoflow calls (added parameters get the given value).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sdk = require("mendixmodelsdk");
const { validName, fail, validate, bool } = require("./ops-util");

const { javaactions, javascriptactions, codeactions: ca, microflows: mf, enumerations } = sdk;

const PARAM_TYPES = "String | Integer | Long | Decimal | Boolean | DateTime | Module.Entity | List(Module.Entity) | Enum(Module.Enumeration) | EntityType(T) | Object(T) | List(T)";
const CODE_FIELDS = (kind, extra) => ({
    module: "R module name", name: `R ${kind} name`, folder: "optional folder path",
    parameters: `optional [ { "name": ..., "type": ${PARAM_TYPES} | ${extra}, "description": "...", "required": true/false } ] (EntityType(T) declares type parameter T; Object(T)/List(T) use it)`,
    returns: `optional return type: Nothing | String | Integer | Decimal | Boolean | DateTime | Module.Entity | List(Module.Entity) | Enum(Module.Enumeration) | Object(T) | List(T) (default Boolean)`,
    documentation: "optional text", exposed: "optional { \"caption\": ..., \"category\": ... }: show it in the toolbox as an action"
});

const CHANGE_FIELDS = extra => ({
    addParameters: `optional [ { "name": ..., "type": ${PARAM_TYPES} | ${extra}, "value": "what every caller passes (an expression; for EntityType(T) an entity name)", "description": ..., "required": true/false } ] (added at the end)`,
    removeParameters: "optional [ \"Name\" ]: also removed from every call",
    parameterTypes: "optional { \"Name\": \"new type\" }: callers keep their argument (listed to check)",
    returns: "optional new return type (Nothing for none)", documentation: "optional text"
});

const JAVA_CODE_FIELDS = {
    code: "optional Java statements of executeAction (between BEGIN USER CODE and END USER CODE), e.g. \"return input.length() > 3;\"; parameters are fields of the same name",
    imports: "optional [ \"java.util.List\" ] extra imports", extra: "optional Java members between BEGIN EXTRA CODE and END EXTRA CODE (helper methods)",
    compile: "optional false: skip the JAVA CHECK (javac with userlib/vendorlib and the Mendix runtime jars; skipped with a note when no JDK or runtime jars are found)"
};

const CODE_OPS = {
    createJavaAction: {
        doc: "Create a Java action and its Java file (javasource/<module>/actions/<Name>.java) as Studio Pro generates it; the code between BEGIN USER CODE and END USER CODE from 'code' (JAVA CHECK compiles it when a JDK and the runtime jars are there).",
        fields: { ...CODE_FIELDS("Java action", "Microflow"), ...JAVA_CODE_FIELDS }
    },
    setJavaActionCode: {
        doc: "Replace the code of an existing Java action (its file between BEGIN USER CODE and END USER CODE), with JAVA CHECK (javac) when a JDK and the Mendix runtime jars are found.",
        fields: { javaAction: "R Module.JavaAction", code: "R Java statements of executeAction", imports: JAVA_CODE_FIELDS.imports, extra: "optional Java members between BEGIN EXTRA CODE and END EXTRA CODE (replaces them)", compile: JAVA_CODE_FIELDS.compile }
    },
    createJavaScriptAction: {
        doc: "Create a JavaScript action (for nanoflows) and its file (javascriptsource/<module>/actions/<Name>.js) as Studio Pro generates it.",
        fields: { ...CODE_FIELDS("JavaScript action", "Nanoflow"), platform: "optional All | Web | Native (default All)" }
    },
    changeJavaScriptAction: {
        doc: "Change a JavaScript action: add / remove / retype parameters, return type, platform, documentation, and its code (USER CODE, syntax-checked). The .js file's generated part is renewed (imports, user and extra code kept); nanoflows that call it are updated.",
        fields: { javaScriptAction: "R Module.JavaScriptAction", ...CHANGE_FIELDS("Nanoflow"), platform: "optional All | Web | Native",
            code: "optional JavaScript statements of the function body (between BEGIN USER CODE and END USER CODE); checked with node --check (an ES module, await allowed)",
            extra: "optional JavaScript between BEGIN EXTRA CODE and END EXTRA CODE (helpers; replaces it)" }
    },
    changeJavaAction: {
        doc: "Change a Java action: add / remove / retype parameters, return type, documentation, code. The .java file's generated part is renewed (imports, BEGIN/END USER CODE and EXTRA CODE kept); microflows that call it are updated.",
        fields: { javaAction: "R Module.JavaAction", ...CHANGE_FIELDS("Microflow"), code: JAVA_CODE_FIELDS.code, imports: JAVA_CODE_FIELDS.imports, extra: "optional Java members between BEGIN EXTRA CODE and END EXTRA CODE (replaces them)", compile: JAVA_CODE_FIELDS.compile }
    },
    createRule: {
        doc: "Create a rule (a Boolean or enumeration answer for decisions: if/switch with 'rule'). Same actions as a microflow, but only retrieve, variable, set, aggregateList, listOperation, createList, changeList, if, switch, loop, end.",
        fields: { module: "R module name", name: "R rule name", folder: "optional folder path", parameters: "optional [ { \"name\": ..., \"type\": ... } ]", returns: "R Boolean | Enum(Module.Enumeration)", returnValue: "R return expression at the end", actions: "optional [ actions ]", documentation: "optional text" }
    }
};

const CRLF = s => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const lowerFirst = s => s.slice(0, 1).toLowerCase() + s.slice(1);
const proxyClass = qn => `${qn.split(".")[0].toLowerCase()}.proxies.${qn.split(".")[1]}`;

// The import list, user code and extra code of an existing generated file (null when the markers are missing).
function retained(text, js) {
    const t = text.replace(/\r\n/g, "\n");
    const user = /\/\/ BEGIN USER CODE\n([\s\S]*?)[ \t]*\/\/ END USER CODE/.exec(t);
    const extra = /\/\/ BEGIN EXTRA CODE\n([\s\S]*?)[ \t]*\/\/ END EXTRA CODE/.exec(t);
    if (!user || !extra) return null;
    const head = t.slice(0, t.search(js ? /\/\/ BEGIN EXTRA CODE/ : /\n(\/\*\*|public class)/));
    const imports = head.split("\n").filter(l => /^import\s/.test(l));
    return { imports, user: user[1], extra: extra[1] };
}

// ------------------------------------------------ Java source (mxbuild 10.24 / 11.x output)

function javaReturn(r) {
    switch (r.kind) {
        case "Void": return "java.lang.Void";
        case "Boolean": return "java.lang.Boolean";
        case "Integer": return "java.lang.Long";
        case "Decimal": return "java.math.BigDecimal";
        case "String": case "Enum": return "java.lang.String";
        case "DateTime": return "java.util.Date";
        case "Object": case "TypeObject": return "IMendixObject";
        case "List": case "TypeList": return "java.util.List<IMendixObject>";
        default: return "java.lang.Object";
    }
}
const javaArg = p => (["Microflow", "EntityType", "Enum"].includes(p.kind) ? "java.lang.String" : javaReturn(p));

function javaSource(module, name, params, ret, doc, keep) {
    const L = [];
    L.push("// This file was generated by Mendix Studio Pro.", "//", "// WARNING: Only the following code will be retained when actions are regenerated:", "// - the import list",
        "// - the code between BEGIN USER CODE and END USER CODE", "// - the code between BEGIN EXTRA CODE and END EXTRA CODE",
        "// Other code you write will be lost the next time you deploy the project.", "// Special characters, e.g., é, ö, à, etc. are supported in comments.", "",
        `package ${module.toLowerCase()}.actions;`, "");
    const needed = ["import com.mendix.systemwideinterfaces.core.IContext;", "import com.mendix.systemwideinterfaces.core.UserAction;"];
    if ([ret, ...params].some(p => /IMendixObject/.test(javaReturn(p)))) needed.push("import com.mendix.systemwideinterfaces.core.IMendixObject;");
    needed.sort();
    const imports = keep ? [...keep.imports] : [];
    for (const i of needed) if (!imports.includes(i)) imports.push(i);
    L.push(...imports, "");
    if (doc) L.push("/**", ...doc.split(/\r?\n/).map(l => ` * ${l}`.replace(/\s+$/, l ? "" : " ")), " */");
    const rt = javaReturn(ret);
    L.push(`public class ${name} extends UserAction<${rt}>`, "{");
    for (const p of params) {
        if (p.kind === "Object") {
            L.push(`\t/** @deprecated use ${p.name}.getMendixObject() instead. */`, "\t@java.lang.Deprecated(forRemoval = true)", `\tprivate final IMendixObject __${p.name};`, `\tprivate final ${proxyClass(p.entity)} ${p.name};`);
        } else if (p.kind === "List") {
            L.push(`\t/** @deprecated use com.mendix.utils.ListUtils.map(${p.name}, com.mendix.systemwideinterfaces.core.IEntityProxy::getMendixObject) instead. */`, "\t@java.lang.Deprecated(forRemoval = true)",
                `\tprivate final java.util.List<IMendixObject> __${p.name};`, `\tprivate final java.util.List<${proxyClass(p.entity)}> ${p.name};`);
        } else L.push(`\tprivate final ${p.kind === "Enum" ? proxyClass(p.enumeration) : javaArg(p)} ${p.name};`);
    }
    if (!params.length) L.push(`\tpublic ${name}(IContext context)`);
    else {
        L.push("", `\tpublic ${name}(`, "\t\tIContext context" + params.map(p => `,\n\t\t${javaArg(p)} _${lowerFirst(p.name)}`).join(""), "\t)");
    }
    L.push("\t{", "\t\tsuper(context);");
    for (const p of params) {
        const arg = "_" + lowerFirst(p.name);
        if (p.kind === "Object") L.push(`\t\tthis.__${p.name} = ${arg};`, `\t\tthis.${p.name} = ${arg} == null ? null : ${proxyClass(p.entity)}.initialize(getContext(), ${arg});`);
        else if (p.kind === "List") {
            const el = lowerFirst(p.name) + "Element";
            L.push(`\t\tthis.__${p.name} = ${arg};`, `\t\tthis.${p.name} = java.util.Optional.ofNullable(${arg})`, "\t\t\t.orElse(java.util.Collections.emptyList())", "\t\t\t.stream()",
                `\t\t\t.map(${el} -> ${proxyClass(p.entity)}.initialize(getContext(), ${el}))`, "\t\t\t.collect(java.util.stream.Collectors.toList());");
        } else if (p.kind === "Enum") L.push(`\t\tthis.${p.name} = ${arg} == null ? null : ${proxyClass(p.enumeration)}.valueOf(${arg});`);
        else L.push(`\t\tthis.${p.name} = ${arg};`);
    }
    L.push("\t}", "", "\t@java.lang.Override", `\tpublic ${rt} executeAction() throws Exception`, "\t{", "\t\t// BEGIN USER CODE");
    const user = keep ? keep.user : "\t\tthrow new com.mendix.systemwideinterfaces.MendixRuntimeException(\"Java action was not implemented\");\n";
    const out = L.join("\n") + "\n" + user + "\t\t// END USER CODE\n\t}\n\n" +
        ["\t/**", "\t * Returns a string representation of this action", "\t * @return a string representation of this action", "\t */", "\t@java.lang.Override", "\tpublic java.lang.String toString()", "\t{", `\t\treturn "${name}";`, "\t}", "", "\t// BEGIN EXTRA CODE"].join("\n") +
        "\n" + (keep ? keep.extra : "") + "\t// END EXTRA CODE\n}\n";
    return CRLF(out);
}

// ------------------------------------------------ JavaScript source

function jsType(p, ret = false) {
    switch (p.kind) {
        case "Void": return "void";
        case "Boolean": return "boolean";
        case "Integer": case "Decimal": return "Big";
        case "String": case "EntityType": return "string";
        case "DateTime": return "Date";
        case "Object": case "TypeObject": return "MxObject";
        case "List": case "TypeList": return "MxObject[]";
        case "Nanoflow": return "Nanoflow";
        case "Enum": return ["undefined", ...p.values.map(v => `"${v}"`)].join("|");
        default: return ret ? "void" : "*";
    }
}

function jsSource(name, params, ret, doc, keep) {
    const L = ["// This file was generated by Mendix Studio Pro.", "//", "// WARNING: Only the following code will be retained when actions are regenerated:", "// - the import list",
        "// - the code between BEGIN USER CODE and END USER CODE", "// - the code between BEGIN EXTRA CODE and END EXTRA CODE", "// Other code you write will be lost the next time you deploy the project."];
    const imports = keep ? [...keep.imports] : [];
    for (const i of ["import \"mx-global\";", "import { Big } from \"big.js\";"]) if (!imports.includes(i)) imports.push(i);
    L.push(...imports, "", "// BEGIN EXTRA CODE");
    let out = L.join("\n") + "\n" + (keep ? keep.extra : "") + "// END EXTRA CODE\n\n/**\n";
    if (doc) out += doc.split(/\r?\n/).map(l => ` * ${l}\n`).join("");
    for (const p of params) out += ` * @param {${jsType(p)}} ${p.name}${p.description ? ` - ${p.description}` : ""}\n`;
    out += ` * @returns {Promise.<${jsType(ret, true)}>}\n */\n`;
    out += `export async function ${name}(${params.map(p => p.name).join(", ")}) {\n\t// BEGIN USER CODE\n`;
    out += keep ? keep.user : "\tthrow new Error(\"JavaScript action was not implemented\");\n";
    out += "\t// END USER CODE\n}\n";
    return CRLF(out);
}

// ------------------------------------------------ JAVA CHECK (javac)

// The user code as it sits in the file: CRLF later, two tabs in, ending with a newline.
const userCode = code => String(code).replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n").map(l => (l.trim() ? "\t\t" + l.replace(/^\t\t/, "") : "")).join("\n") + "\n";
const extraCode = code => String(code).replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n").map(l => (l.trim() ? "\t" + l.replace(/^\t/, "") : "")).join("\n") + "\n";

// Jars javac needs: the Mendix runtime (MXLOCAL_RUNTIME_JARS: folders or jars separated by the path delimiter; else
// <mx install>/runtime/bundles of the mx the project uses), then the project's userlib and vendorlib.
function javaClasspath(dir, mpr) {
    const jarsIn = d => {
        try {
            return fs.statSync(d).isDirectory() ? fs.readdirSync(d).filter(f => f.endsWith(".jar")).map(f => path.join(d, f)) : d.endsWith(".jar") && fs.existsSync(d) ? [d] : [];
        } catch {
            return [];
        }
    };
    let runtime = [];
    let from = "";
    if (process.env.MXLOCAL_RUNTIME_JARS) {
        runtime = process.env.MXLOCAL_RUNTIME_JARS.split(path.delimiter).filter(Boolean).flatMap(jarsIn);
        from = "MXLOCAL_RUNTIME_JARS";
    } else {
        try {
            const l = require("./mxcheck").locate(mpr);
            if (l.found && l.found.mx) {
                const install = path.dirname(path.dirname(fs.realpathSync(l.found.mx)));
                runtime = jarsIn(path.join(install, "runtime", "bundles"));
                from = path.join(install, "runtime", "bundles");
            }
        } catch {
            // no mx: no runtime jars
        }
    }
    return { runtime, from, libs: [...jarsIn(path.join(dir, "userlib")), ...jarsIn(path.join(dir, "vendorlib"))] };
}

function javacPath() {
    const exe = process.platform === "win32" ? "javac.exe" : "javac";
    const dirs = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin"), ...String(process.env.PATH || "").split(path.delimiter)].filter(Boolean);
    for (const d of dirs) if (fs.existsSync(path.join(d, exe))) return path.join(d, exe);
    return null;
}

// Compiles one generated Java action file against the project. Returns { skipped } with the reason, or { errors,
// generated } (errors about classes Mendix generates on deploy, the proxies, are listed apart: not the code's fault).
function javaCheck(client, rel, content) {
    const dir = client.project.dir;
    const javac = javacPath();
    if (!javac) return { skipped: "no JDK (javac) on PATH or JAVA_HOME" };
    const cp = javaClasspath(dir, client.project.mpr);
    if (!cp.runtime.length) return { skipped: "no Mendix runtime jars (set MXLOCAL_RUNTIME_JARS to <Studio Pro>/runtime/bundles, or MX_PATH to the project's mx)" };
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "mxlocal-javac-"));
    try {
        const file = path.join(tmp, "src", rel.replace(/^javasource\//, ""));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        fs.mkdirSync(path.join(tmp, "out"));
        const argv = ["-proc:none", "-nowarn", "-encoding", "UTF-8", "-Xmaxerrs", "50", "-d", path.join(tmp, "out"), "-cp", [...cp.runtime, ...cp.libs].join(path.delimiter),
            "-sourcepath", [path.join(tmp, "src"), path.join(dir, "javasource")].join(path.delimiter), "-implicit:none", file];
        const r = require("child_process").spawnSync(javac, argv, { encoding: "utf8", timeout: 120000, env: { ...process.env, JAVA_TOOL_OPTIONS: "" } });
        if (r.error) return { skipped: `javac did not run: ${r.error.message}` };
        const lines = String(r.stderr || "").split(/\r?\n/).filter(l => /: error: /.test(l)).map(l => l.replace(/^.*?([^\\/]+\.java):/, "$1:"));
        const generated = lines.filter(l => /package [\w.]*proxies does not exist|cannot find symbol.*proxies|package [\w.]+\.proxies/.test(l));
        return { errors: lines.filter(l => !generated.includes(l)), generated, jars: cp.runtime.length + cp.libs.length, from: cp.from };
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function makeCode(h) {
    const { model, client, get, exists, folder } = h;

    // A parameter or return type spec -> { kind, entity?, enumeration?, values?, typeParameter? }
    async function parseType(spec, where, allowed, typeParams) {
        const s = String(spec === undefined ? "" : spec).trim();
        const m = /^(\w+)\s*\(\s*([\w.]+)\s*\)$/.exec(s);
        const simple = { string: "String", integer: "Integer", long: "Integer", decimal: "Decimal", boolean: "Boolean", datetime: "DateTime", nothing: "Void", void: "Void", microflow: "Microflow", nanoflow: "Nanoflow" };
        const entityOf = async qn => {
            if (/^System\./.test(qn)) return qn; // System entities are not in the project; written by name
            await h.entity(qn);
            return qn;
        };
        let t;
        if (m) {
            const k = m[1].toLowerCase();
            const arg = m[2];
            if (k === "entitytype") {
                if (arg.includes(".")) throw new Error(`${where}: EntityType(T) takes a type parameter name like T, not an entity`);
                typeParams.add(arg);
                t = { kind: "EntityType", typeParameter: arg };
            } else if ((k === "object" || k === "list") && !arg.includes(".")) {
                if (!typeParams.has(arg)) throw new Error(`${where}: type parameter ${arg} is not declared; add a parameter of type EntityType(${arg}) first`);
                t = { kind: k === "object" ? "TypeObject" : "TypeList", typeParameter: arg };
            } else if (k === "list") t = { kind: "List", entity: await entityOf(arg) };
            else if (k === "object") t = { kind: "Object", entity: await entityOf(arg) };
            else if (k === "enum" || k === "enumeration") {
                const en = await get(arg);
                if (!(en instanceof enumerations.Enumeration)) throw new Error(`${where}: '${arg}' is not an enumeration`);
                t = { kind: "Enum", enumeration: arg, values: en.values.map(v => v.name) };
            }
        } else if (simple[s.toLowerCase()]) t = { kind: simple[s.toLowerCase()] };
        else if (s.includes(".")) t = { kind: "Object", entity: await entityOf(s) };
        if (!t || !allowed.includes(t.kind)) fail(`${where}: type '${s}' is not one of ${allowed.join(", ").replace("TypeObject", "Object(T)").replace("TypeList", "List(T)").replace("EntityType", "EntityType(T)")}`, s, Object.values(simple));
        return t;
    }

    // codeactions type element for a parsed type (parameter or return)
    function codeType(t, typeParams, place, parent) {
        const create = (Cls) => {
            if (place === "return") return Cls.createInCodeActionUnderActionReturnType(parent);
            if (place === "basic") return Cls.createInBasicParameterTypeUnderType(parent);
            return Cls.createInListTypeUnderParameter(parent);
        };
        switch (t.kind) {
            case "Void": return create(ca.VoidType);
            case "Boolean": return create(ca.BooleanType);
            case "Integer": return create(ca.IntegerType);
            case "Decimal": return create(ca.DecimalType);
            case "String": return create(ca.StringType);
            case "DateTime": return create(ca.DateTimeType);
            case "Enum": {
                const e = create(ca.EnumerationType);
                e.__enumeration.updateWithRawValue(t.enumeration);
                return e;
            }
            case "Object": {
                const e = create(ca.ConcreteEntityType);
                e.__entity.updateWithRawValue(t.entity);
                return e;
            }
            case "TypeObject": {
                const e = create(ca.ParameterizedEntityType);
                e.typeParameter = typeParams.get(t.typeParameter);
                return e;
            }
            case "List": case "TypeList": {
                const l = create(ca.ListType);
                codeType({ kind: t.kind === "List" ? "Object" : "TypeObject", entity: t.entity, typeParameter: t.typeParameter }, typeParams, "list", l);
                return l;
            }
        }
        throw new Error(`internal: no code type for ${t.kind}`);
    }

    const files = () => (client.extraFiles = client.extraFiles || new Map());

    // Adds a file to the change. Existing file: keep its imports, user and extra code; no markers: refuse.
    function addFile(rel, make, js, where) {
        const full = path.join(client.project.dir, rel);
        let keep = null;
        let before = null;
        if (fs.existsSync(full)) {
            const text = fs.readFileSync(full, "utf8");
            before = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
            keep = retained(text, js);
            if (!keep) throw new Error(`${where}: ${rel} exists and has no BEGIN/END USER CODE and EXTRA CODE markers; ops does not overwrite it. Rename or remove that file first`);
        }
        const content = make(keep);
        files().set(rel, { content: Buffer.from(content, "utf8"), before });
        return keep ? ` (kept the imports, user code and extra code of the existing ${rel})` : "";
    }

    async function createCode(o, js) {
        const kind = js ? "JavaScript action" : "Java action";
        validName(o.name, `${kind} name`);
        const qn = `${o.module}.${o.name}`;
        if (await exists(qn)) throw new Error(`${qn} already exists`);
        const typeParams = new Set();
        const params = [];
        const allowed = ["String", "Integer", "Decimal", "Boolean", "DateTime", "Object", "List", "Enum", "EntityType", "TypeObject", "TypeList", js ? "Nanoflow" : "Microflow"];
        for (const [i, p] of (o.parameters || []).entries()) {
            const where = `${qn} parameter ${i + 1}`;
            if (!p || typeof p !== "object") throw new Error(`${where}: { "name": ..., "type": ... }`);
            validate("-", "parameter", { fields: { name: "R", type: "R", description: "", required: "" } }, p, where);
            validName(p.name, "parameter name");
            if (params.some(x => x.name === p.name)) throw new Error(`${where}: parameter ${p.name} twice`);
            params.push({ ...(await parseType(p.type, where, allowed, typeParams)), name: p.name, description: p.description ? String(p.description) : "", required: bool(p.required, true) });
        }
        const ret = await parseType(o.returns === undefined ? "Boolean" : o.returns, `${qn} returns`, ["Void", "String", "Integer", "Decimal", "Boolean", "DateTime", "Object", "List", "Enum", "TypeObject", "TypeList"], typeParams);
        const doc = o.documentation ? String(o.documentation) : "";
        const a = (js ? javascriptactions.JavaScriptAction : javaactions.JavaAction).createIn(folder(o.module, o.folder));
        a.name = o.name;
        a.documentation = doc.replace(/\r?\n/g, "\r\n");
        a.actionDefaultReturnName = "ReturnValueName";
        if (js) a.platform = enumOf(sdk.client.SupportedPlatform, o.platform || "All", "platform");
        const tps = new Map();
        for (const n of typeParams) {
            const tp = ca.TypeParameter.create(model);
            tp.name = n;
            a.actionTypeParameters.push(tp);
            tps.set(n, tp);
        }
        for (const p of params) {
            const ap = js ? javascriptactions.JavaScriptActionParameter.create(model) : javaactions.JavaActionParameter.create(model);
            a.actionParameters.push(ap);
            ap.name = p.name;
            ap.description = p.description.replace(/\r?\n/g, "\r\n");
            ap.category = "";
            ap.isRequired = p.required;
            if (p.kind === "EntityType") {
                const t = ca.EntityTypeParameterType.create(model);
                ap.actionParameterType = t;
                t.typeParameter = tps.get(p.typeParameter);
            } else if (p.kind === "Microflow") ap.actionParameterType = javaactions.MicroflowJavaActionParameterType.create(model);
            else if (p.kind === "Nanoflow") ap.actionParameterType = javascriptactions.NanoflowJavaScriptActionParameterType.create(model);
            else {
                const b = ca.BasicParameterType.create(model);
                ap.actionParameterType = b;
                codeType(p, tps, "basic", b);
            }
        }
        codeType(ret, tps, "return", a);
        if (o.exposed !== undefined) {
            if (!o.exposed || typeof o.exposed !== "object") throw new Error(`${qn}: exposed must be { "caption": "...", "category": "..." }`);
            validate("-", "exposed", { fields: { caption: "R", category: "" } }, o.exposed, `${qn} exposed`);
            const info = ca.MicroflowActionInfo.createInCodeActionUnderModelerActionInfo(a);
            info.caption = String(o.exposed.caption);
            info.category = String(o.exposed.category || "");
        }
        const dir = o.module.toLowerCase();
        const rel = js ? `javascriptsource/${dir}/actions/${o.name}.js` : `javasource/${dir}/actions/${o.name}.java`;
        const withCode = keep => {
            if (js || (o.code === undefined && o.imports === undefined && o.extra === undefined)) return keep;
            const k = keep ? { ...keep } : { imports: [], user: "\t\tthrow new com.mendix.systemwideinterfaces.MendixRuntimeException(\"Java action was not implemented\");\n", extra: "" };
            return withJava(k, o, qn);
        };
        const kept = addFile(rel, keep => (js ? jsSource(o.name, params, ret, doc, keep) : javaSource(o.module, o.name, params, ret, doc, withCode(keep))), js, qn);
        const check = js ? "" : compileNote(o, rel, qn);
        return `${qn} (${params.length} parameter(s)) + file ${rel}${kept}${check}`;
    }

    // keep (imports, user, extra) with the change's code, imports and extra code
    function withJava(keep, o, where) {
        const k = { ...keep, imports: [...(keep.imports || [])] };
        if (o.code !== undefined) {
            if (typeof o.code !== "string" || !o.code.trim()) throw new Error(`${where}: code is the Java statements as one text, e.g. "return true;"`);
            if (/BEGIN USER CODE|END USER CODE|BEGIN EXTRA CODE|END EXTRA CODE/.test(o.code)) throw new Error(`${where}: code is only what goes between the markers; leave out the BEGIN/END comments`);
            k.user = userCode(o.code);
        }
        if (o.extra !== undefined) k.extra = String(o.extra).trim() ? extraCode(o.extra) : "";
        for (const i of [].concat(o.imports || [])) {
            const name = String(i).replace(/^import\s+/, "").replace(/;\s*$/, "").trim();
            if (!/^[\w.]+(\.\*)?$/.test(name)) throw new Error(`${where}: import '${i}' is not a Java class name like java.util.List`);
            const line = `import ${name};`;
            if (!k.imports.includes(line)) k.imports.push(line);
        }
        return k;
    }

    // JAVA CHECK of a file the change writes: errors refuse the op (unless compile: false), a missing JDK/runtime is a note.
    function compileNote(o, rel, where) {
        if (o.compile === false || o.compile === "false") return "\n      JAVA CHECK: skipped (compile: false)";
        if (o.code === undefined && o.extra === undefined && o.imports === undefined) return "";
        const r = javaCheck(client, rel, files().get(rel).content);
        if (r.skipped) {
            client.warn(`JAVA CHECK skipped for ${rel}: ${r.skipped}`);
            return `\n      JAVA CHECK: skipped - ${r.skipped}`;
        }
        if (r.errors.length) throw new Error(`${where}: JAVA CHECK: javac found ${r.errors.length} error(s):\n  ${r.errors.slice(0, 8).join("\n  ")}${r.errors.length > 8 ? `\n  ... ${r.errors.length - 8} more` : ""}\nFix the code (or "compile": false to write it unchecked)`);
        return `\n      JAVA CHECK: compiles (javac, ${r.jars} jar(s))${r.generated.length ? `; ${r.generated.length} error(s) about generated proxies ignored (Studio Pro makes them on deploy)` : ""}`;
    }

    async function setJavaActionCode(o) {
        const a = await get(o.javaAction);
        if (!(a instanceof javaactions.JavaAction)) throw new Error(`'${o.javaAction}' is not a Java action`);
        const [module, name] = o.javaAction.split(".");
        const rel = `javasource/${module.toLowerCase()}/actions/${name}.java`;
        const full = path.join(client.project.dir, rel);
        const pendingFile = files().get(rel);
        const text = pendingFile ? pendingFile.content.toString("utf8") : fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
        if (text === null) throw new Error(`${o.javaAction}: ${rel} does not exist yet; Studio Pro writes it on the next deploy (or create the action with createJavaAction "code")`);
        const keep = retained(text, false);
        if (!keep) throw new Error(`${o.javaAction}: ${rel} has no BEGIN/END USER CODE and EXTRA CODE markers; ops does not overwrite it`);
        const k = withJava(keep, o, o.javaAction);
        const t = text.replace(/\r\n/g, "\n");
        let out = t.replace(/(\/\/ BEGIN USER CODE\n)[\s\S]*?([ \t]*\/\/ END USER CODE)/, (m, b, e) => b + k.user + e).replace(/(\/\/ BEGIN EXTRA CODE\n)[\s\S]*?([ \t]*\/\/ END EXTRA CODE)/, (m, b, e) => b + k.extra + e);
        const missing = k.imports.filter(i => !keep.imports.includes(i));
        if (missing.length) out = out.replace(/(\npackage [^\n]*\n\n)/, `$1${missing.join("\n")}\n`);
        const before = pendingFile ? pendingFile.before : crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        files().set(rel, { content: Buffer.from(CRLF(out), "utf8"), before });
        return `${o.javaAction}: file ${rel} (user code${o.extra !== undefined ? ", extra code" : ""}${missing.length ? `, ${missing.length} import(s)` : ""})${compileNote(o, rel, o.javaAction)}`;
    }

    // ------------------------------------------------ changeJavaAction / changeJavaScriptAction

    // a stored parameter or return type -> the parsed form javaSource/jsSource use
    function typeOf(t) {
        if (!t || t instanceof ca.VoidType) return { kind: "Void" };
        if (t instanceof ca.BasicParameterType) return typeOf(t.type);
        if (t instanceof ca.EntityTypeParameterType) return { kind: "EntityType", typeParameter: t.typeParameter ? t.typeParameter.name : "T" };
        if (t instanceof javaactions.MicroflowJavaActionParameterType) return { kind: "Microflow" };
        if (javascriptactions.NanoflowJavaScriptActionParameterType && t instanceof javascriptactions.NanoflowJavaScriptActionParameterType) return { kind: "Nanoflow" };
        if (t instanceof ca.BooleanType) return { kind: "Boolean" };
        if (t instanceof ca.IntegerType) return { kind: "Integer" };
        if (t instanceof ca.DecimalType) return { kind: "Decimal" };
        if (t instanceof ca.StringType) return { kind: "String" };
        if (t instanceof ca.DateTimeType) return { kind: "DateTime" };
        if (t instanceof ca.EnumerationType) {
            const qn = t.enumerationQualifiedName;
            const en = model.allEnumerations().find(e => e.qualifiedName === qn);
            return { kind: "Enum", enumeration: qn, values: en && en.isLoaded ? en.values.map(v => v.name) : [] };
        }
        if (t instanceof ca.ConcreteEntityType) return { kind: "Object", entity: t.entityQualifiedName };
        if (t instanceof ca.ParameterizedEntityType) return { kind: "TypeObject", typeParameter: t.typeParameter ? t.typeParameter.name : "T" };
        if (t instanceof ca.ListType) {
            const el = typeOf(t.parameter);
            return el.kind === "TypeObject" ? { kind: "TypeList", typeParameter: el.typeParameter } : { kind: "List", entity: el.entity };
        }
        return { kind: t.structureTypeName.split("$")[1] };
    }
    const typeLabel = t => ({ Void: "Nothing", Object: t.entity, List: `List(${t.entity})`, Enum: `Enum(${t.enumeration})`, EntityType: `EntityType(${t.typeParameter})`, TypeObject: `Object(${t.typeParameter})`, TypeList: `List(${t.typeParameter})` }[t.kind] || t.kind);

    // the parameter type element of a parsed type (a new one; the old one is replaced)
    function setParamType(ap, t, tps, js) {
        if (t.kind === "EntityType") {
            const et = ca.EntityTypeParameterType.create(model);
            ap.actionParameterType = et;
            et.typeParameter = tps.get(t.typeParameter);
        } else if (t.kind === "Microflow") ap.actionParameterType = javaactions.MicroflowJavaActionParameterType.create(model);
        else if (t.kind === "Nanoflow") ap.actionParameterType = javascriptactions.NanoflowJavaScriptActionParameterType.create(model);
        else {
            const b = ca.BasicParameterType.create(model);
            ap.actionParameterType = b;
            codeType(t, tps, "basic", b);
        }
        void js;
    }

    // calls of the action in microflows / nanoflows: [ { action, doc } ]
    async function callsOf(qn, js) {
        await model.flushChanges();
        const g = require("./refs").graph(client);
        const what = js ? "JavaScriptActionCallAction.JavaScriptAction" : "JavaActionCallAction.JavaAction";
        const docs = [...new Set(g.usesOf(qn, false).filter(e => e.what === what).map(e => e.doc))];
        const out = [];
        for (const d of docs) {
            const flow = await get(d);
            const walk = coll => {
                for (const ob of coll.objects) {
                    const a = ob.action;
                    if (a && (js ? a instanceof mf.JavaScriptActionCallAction && a.javaScriptActionQualifiedName === qn : a instanceof mf.JavaActionCallAction && a.javaActionQualifiedName === qn)) out.push({ action: a, doc: d, step: ob.id.slice(0, 8) });
                    if (ob.objectCollection) walk(ob.objectCollection);
                }
            };
            walk(flow.objectCollection);
        }
        return out;
    }

    // JS CHECK: node --check on the generated module (an ES module: the action file imports mx-global and big.js)
    function jsCheck(content, where) {
        const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "mxlocal-js-"));
        try {
            const f = path.join(tmp, "action.mjs");
            fs.writeFileSync(f, content);
            const r = require("child_process").spawnSync(process.execPath, ["--check", f], { encoding: "utf8", timeout: 60000 });
            if (r.error) return `\n      JS CHECK: skipped - ${r.error.message}`;
            if (r.status !== 0) {
                const msg = String(r.stderr || "").split(/\r?\n/).filter(l => l.trim() && !/^\s*at |^Node\.js v/.test(l)).map(l => l.replace(f, "action.js")).slice(0, 6).join("\n  ");
                throw new Error(`${where}: JS CHECK: node --check found a syntax error:\n  ${msg}\nFix the code`);
            }
            return "\n      JS CHECK: syntax ok (node --check)";
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }
    const jsUser = code => String(code).replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n").map(l => (l.trim() ? "\t" + l.replace(/^\t/, "") : "")).join("\n") + "\n";
    const jsExtra = code => String(code).replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";

    async function changeCode(o, js) {
        const qn = js ? o.javaScriptAction : o.javaAction;
        const kind = js ? "JavaScript action" : "Java action";
        const a = await get(qn);
        if (!(a instanceof (js ? javascriptactions.JavaScriptAction : javaactions.JavaAction))) throw new Error(`'${qn}' is not a ${kind}${a instanceof (js ? javaactions.JavaAction : javascriptactions.JavaScriptAction) ? ` (it is a ${js ? "Java" : "JavaScript"} action: use ${js ? "changeJavaAction" : "changeJavaScriptAction"})` : ""}`);
        const keys = ["addParameters", "removeParameters", "parameterTypes", "returns", "documentation", "code", "extra", ...(js ? ["platform"] : ["imports"])].filter(k => o[k] !== undefined);
        if (!keys.length) throw new Error(`${qn}: give what changes: addParameters, removeParameters, parameterTypes, returns, documentation, code${js ? ", extra or platform" : ", imports or extra"}`);
        const [module, name] = qn.split(".");
        const lines = [];
        const tps = new Map([...a.actionTypeParameters].map(t => [t.name, t]));
        const typeParams = new Set(tps.keys());
        const allowed = ["String", "Integer", "Decimal", "Boolean", "DateTime", "Object", "List", "Enum", "EntityType", "TypeObject", "TypeList", js ? "Nanoflow" : "Microflow"];
        const has = n => a.actionParameters.find(p => p.name === n);
        const calls = await callsOf(qn, js);
        const check = [];

        // remove
        const removes = [].concat(o.removeParameters || []).map(String);
        for (const n of removes) if (!has(n)) fail(`${qn}: no parameter '${n}' to remove`, n, a.actionParameters.map(p => p.name));
        // retype
        const retypes = o.parameterTypes || {};
        if (typeof retypes !== "object" || Array.isArray(retypes)) throw new Error(`${qn}: parameterTypes is { "Name": "new type" }`);
        for (const n of Object.keys(retypes)) {
            if (!has(n)) fail(`${qn}: no parameter '${n}' to retype`, n, a.actionParameters.map(p => p.name));
            if (removes.includes(n)) throw new Error(`${qn}: ${n} is both removed and retyped`);
        }
        // add
        const adds = [];
        for (const [i, p] of [].concat(o.addParameters || []).entries()) {
            const where = `${qn} addParameters ${i + 1}`;
            if (!p || typeof p !== "object") throw new Error(`${where}: { "name": ..., "type": ..., "value": ... }`);
            validate("-", "parameter", { fields: { name: "R", type: "R", value: "", description: "", required: "" } }, p, where);
            validName(p.name, "parameter name");
            if ((has(p.name) && !removes.includes(p.name)) || adds.some(x => x.name === p.name)) throw new Error(`${where}: ${qn} already has a parameter ${p.name}`);
            adds.push({ ...(await parseType(p.type, where, allowed, typeParams)), name: p.name, value: p.value, description: p.description ? String(p.description) : "", required: bool(p.required, true) });
        }
        const parsedRetypes = {};
        for (const [n, t] of Object.entries(retypes)) parsedRetypes[n] = await parseType(t, `${qn} parameterTypes.${n}`, allowed, typeParams);
        const ret = o.returns !== undefined ? await parseType(/^(nothing|void|none|)$/i.test(String(o.returns)) ? "Nothing" : o.returns, `${qn} returns`, ["Void", "String", "Integer", "Decimal", "Boolean", "DateTime", "Object", "List", "Enum", "TypeObject", "TypeList"], typeParams) : null;

        // callers that cannot follow
        const refused = [];
        const missingValue = adds.filter(p => p.value === undefined && p.required && p.kind !== "Microflow");
        if (calls.length && missingValue.length) refused.push(`addParameters ${missingValue.map(p => p.name).join(", ")}: give "value" (what the ${calls.length} call(s) pass: ${[...new Set(calls.map(c => c.doc))].slice(0, 5).join(", ")})`);
        for (const [n, t] of Object.entries(parsedRetypes)) {
            const was = typeOf(has(n).actionParameterType);
            const basic = k => !["EntityType", "Microflow", "Nanoflow"].includes(k);
            if (calls.length && basic(was.kind) !== basic(t.kind)) refused.push(`parameterTypes.${n}: ${typeLabel(was)} -> ${typeLabel(t)} needs another kind of argument in ${calls.length} call(s); remove the parameter and add a new one with "value"`);
        }
        if (ret && ret.kind === "Void") for (const c of calls) if (c.action.outputVariableName && c.action.useReturnVariable) refused.push(`${c.doc} step ${c.step}: uses the result as $${c.action.outputVariableName}`);
        // a type parameter still in use by what stays
        for (const n of removes) {
            const t = typeOf(has(n).actionParameterType);
            if (t.kind !== "EntityType") continue;
            const users = a.actionParameters.filter(p => !removes.includes(p.name) && p.name !== n && /TypeObject|TypeList/.test(typeOf(p.actionParameterType).kind) && typeOf(p.actionParameterType).typeParameter === t.typeParameter).map(p => p.name);
            const retUses = !ret && /TypeObject|TypeList/.test(typeOf(a.actionReturnType).kind) && typeOf(a.actionReturnType).typeParameter === t.typeParameter;
            if (users.length || retUses) refused.push(`${n} declares type parameter ${t.typeParameter}, which ${[...users, ...(retUses ? ["the return type"] : [])].join(", ")} still use${users.length + (retUses ? 1 : 0) === 1 ? "s" : ""}`);
        }
        if (refused.length) throw new Error(`REFUSED, calls or parameters that cannot follow:\n      ${refused.join("\n      ")}`);

        // type parameters new in this change
        for (const n of typeParams) {
            if (tps.has(n)) continue;
            const tp = ca.TypeParameter.create(model);
            tp.name = n;
            a.actionTypeParameters.push(tp);
            tps.set(n, tp);
            lines.push(`type parameter ${n}`);
        }
        // the action
        const removedParams = removes.map(n => has(n));
        for (const p of removedParams) p.delete();
        if (removes.length) lines.push(`removed ${removes.join(", ")}`);
        for (const [n, t] of Object.entries(parsedRetypes)) {
            const was = typeOf(has(n).actionParameterType);
            setParamType(has(n), t, tps, js);
            lines.push(`${n}: ${typeLabel(was)} -> ${typeLabel(t)}`);
        }
        for (const p of adds) {
            const ap = js ? javascriptactions.JavaScriptActionParameter.create(model) : javaactions.JavaActionParameter.create(model);
            a.actionParameters.push(ap);
            ap.name = p.name;
            ap.description = p.description.replace(/\r?\n/g, "\r\n");
            ap.category = "";
            ap.isRequired = p.required;
            setParamType(ap, p, tps, js);
        }
        if (adds.length) lines.push(`added ${adds.map(p => `${p.name} (${typeLabel(p)})`).join(", ")}`);
        if (ret) {
            const was = typeOf(a.actionReturnType);
            codeType(ret, tps, "return", a);
            lines.push(`returns ${typeLabel(was)} -> ${typeLabel(ret)}`);
        }
        // type parameters nothing declares any more
        for (const [n, tp] of [...tps]) {
            if (a.actionParameters.some(p => typeOf(p.actionParameterType).kind === "EntityType" && typeOf(p.actionParameterType).typeParameter === n)) continue;
            tp.delete();
            tps.delete(n);
            lines.push(`type parameter ${n} removed`);
        }
        if (o.documentation !== undefined) {
            a.documentation = String(o.documentation).replace(/\r?\n/g, "\r\n");
            lines.push("documentation");
        }
        if (js && o.platform !== undefined) {
            a.platform = enumOf(sdk.client.SupportedPlatform, o.platform, "platform");
            lines.push(`platform ${a.platform.name}`);
        }

        // the calls
        const under = js ? "createInJavaScriptActionParameterMappingUnderParameterValue" : "createInJavaActionParameterMappingUnderParameterValue";
        const byName = new Map([...a.actionParameters].map(p => [p.name, p]));
        for (const c of calls) {
            for (const pm of [...c.action.parameterMappings]) {
                const pn = String(pm.parameterQualifiedName || "").split(".").pop();
                if (removes.includes(pn) && !adds.some(x => x.name === pn)) pm.delete();
                else if (parsedRetypes[pn]) check.push(`${c.doc} step ${c.step}: argument of ${pn} (now ${typeLabel(parsedRetypes[pn])})`);
            }
            for (const p of adds) {
                const pm = (js ? mf.JavaScriptActionParameterMapping : mf.JavaActionParameterMapping).createIn(c.action);
                pm.parameter = byName.get(p.name);
                if (p.kind === "EntityType") {
                    if (String(p.value || "").startsWith("$")) throw new Error(`${qn}: ${p.name} takes an entity name like "Module.Entity" as value, not a variable`);
                    mf.EntityTypeCodeActionParameterValue[under](pm).entity = await h.entity(p.value);
                } else if (p.kind === "Microflow") {
                    const pv = mf.MicroflowParameterValue[under](pm);
                    if (p.value) pv.microflow = await get(String(p.value));
                } else if (p.kind === "Nanoflow") throw new Error(`${qn}: a Nanoflow parameter cannot be filled in by ops in ${c.doc}; add it in Studio Pro`);
                else mf.BasicCodeActionParameterValue[under](pm).argument = p.value === undefined ? "" : String(p.value);
            }
            if (ret && ret.kind !== "Void" && typeOf(a.actionReturnType).kind !== "Void" && c.action.outputVariableName) check.push(`${c.doc} step ${c.step}: $${c.action.outputVariableName} is now ${typeLabel(ret)}`);
        }
        if (calls.length && (adds.length || removes.length)) lines.push(`${calls.length} call(s) updated in ${[...new Set(calls.map(c => c.doc))].join(", ")}`);

        // the source file: generated part renewed, user code kept (or replaced by code)
        const params = [];
        for (const p of a.actionParameters) params.push({ ...typeOf(p.actionParameterType), name: p.name, description: p.description || "" });
        for (const p of params) if (p.kind === "Enum" && !p.values.length) p.values = (await get(p.enumeration)).values.map(v => v.name);
        const retNow = typeOf(a.actionReturnType);
        if (retNow.kind === "Enum" && !retNow.values.length) retNow.values = (await get(retNow.enumeration)).values.map(v => v.name);
        const doc = (a.documentation || "").replace(/\r\n/g, "\n");
        const rel = js ? `javascriptsource/${module.toLowerCase()}/actions/${name}.js` : `javasource/${module.toLowerCase()}/actions/${name}.java`;
        const full = path.join(client.project.dir, rel);
        const pending = files().get(rel);
        let keep = null;
        if (pending) keep = retained(pending.content.toString("utf8"), js);
        else if (fs.existsSync(full)) {
            keep = retained(fs.readFileSync(full, "utf8"), js);
            if (!keep) throw new Error(`${qn}: ${rel} has no BEGIN/END USER CODE and EXTRA CODE markers; ops does not overwrite it`);
        }
        if (o.code !== undefined || o.extra !== undefined || o.imports !== undefined) {
            if (/BEGIN USER CODE|END USER CODE|BEGIN EXTRA CODE|END EXTRA CODE/.test(String(o.code || "") + String(o.extra || ""))) throw new Error(`${qn}: code / extra is only what goes between the markers; leave out the BEGIN/END comments`);
            if (o.code !== undefined && (typeof o.code !== "string" || !o.code.trim())) throw new Error(`${qn}: code is the statements as one text`);
        }
        let k;
        if (js) {
            k = keep ? { ...keep } : { imports: [], user: "\tthrow new Error(\"JavaScript action was not implemented\");\n", extra: "" };
            if (o.code !== undefined) k.user = jsUser(o.code);
            if (o.extra !== undefined) k.extra = String(o.extra).trim() ? jsExtra(o.extra) : "";
        } else {
            k = keep || { imports: [], user: "\t\tthrow new com.mendix.systemwideinterfaces.MendixRuntimeException(\"Java action was not implemented\");\n", extra: "" };
            k = withJava(k, o, qn);
        }
        const content = js ? jsSource(name, params, retNow, doc, k) : javaSource(module, name, params, retNow, doc, k);
        const before = pending ? pending.before : fs.existsSync(full) ? crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex") : null;
        files().set(rel, { content: Buffer.from(content, "utf8"), before });
        if (o.code !== undefined) lines.push("code");
        if (o.extra !== undefined) lines.push("extra code");
        let note = "";
        if (js) note = jsCheck(content, qn);
        else if (o.code !== undefined || o.extra !== undefined || o.imports !== undefined || o.compile !== undefined) note = compileNote({ ...o, code: o.code === undefined ? "" : o.code }, rel, qn);
        return `${qn}: ${lines.join("; ")} + file ${rel} (${keep ? "imports, user and extra code kept" : "new"}${o.code !== undefined ? ", new user code" : ""})${note}` + check.map(c => `\n      CHECK: ${c}`).join("");
    }

    function enumOf(cls, v, field) {
        const hit = Object.keys(cls).find(k => cls[k] instanceof cls && k.toLowerCase() === String(v).toLowerCase());
        if (!hit) fail(`'${v}' is not a valid ${field}`, v, Object.keys(cls).filter(k => cls[k] instanceof cls));
        return cls[hit];
    }

    const impl = {
        createJavaAction: o => createCode(o, false),
        createJavaScriptAction: o => createCode(o, true),
        setJavaActionCode,
        changeJavaAction: o => changeCode(o, false),
        changeJavaScriptAction: o => changeCode(o, true),
        async createRule(o) {
            validName(o.name, "rule name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            if (o.returnValue === undefined) throw new Error(`${qn}: a rule needs 'returnValue' (the answer at its end)`);
            const { count } = await h.createFlow(o, false, folder(o.module, o.folder), true);
            return `${qn} (rule, ${count} action(s))`;
        }
    };

    const fileCheck = (o, js) => {
        const rel = js ? `javascriptsource/${o.module.toLowerCase()}/actions/${o.name}.js` : `javasource/${o.module.toLowerCase()}/actions/${o.name}.java`;
        const full = path.join(client.project.dir, rel);
        if (!fs.existsSync(full)) return [`${rel} missing`];
        const t = fs.readFileSync(full, "utf8");
        return /BEGIN USER CODE/.test(t) && t.includes(js ? `export async function ${o.name}(` : `public class ${o.name} extends`) ? [] : [`${rel} is not the generated file`];
    };
    // after changeJavaAction / changeJavaScriptAction: parameters, the file's signature and user code
    async function changedCheck(o, js) {
        const qn = js ? o.javaScriptAction : o.javaAction;
        const a = await get(qn);
        const r = [];
        const names = a.actionParameters.map(p => p.name);
        for (const n of [].concat(o.removeParameters || [])) if (names.includes(n) && ![].concat(o.addParameters || []).some(p => p.name === n)) r.push(`${qn} still has ${n}`);
        for (const p of [].concat(o.addParameters || [])) if (!names.includes(p.name)) r.push(`${qn} lacks ${p.name}`);
        const [module, name] = qn.split(".");
        const rel = js ? `javascriptsource/${module.toLowerCase()}/actions/${name}.js` : `javasource/${module.toLowerCase()}/actions/${name}.java`;
        const full = path.join(client.project.dir, rel);
        if (!fs.existsSync(full)) return [...r, `${rel} missing`];
        const t = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
        if (js && !t.includes(`export async function ${name}(${names.join(", ")})`)) r.push(`${rel} does not have the parameters ${names.join(", ")}`);
        if (!js && names.some(n => !new RegExp(`private final [^;]* ${n};`).test(t))) r.push(`${rel} does not declare every parameter`);
        if (o.code !== undefined && !t.includes((js ? jsUser(o.code) : userCode(o.code)).trim())) r.push(`${rel} does not hold the new code`);
        return r;
    }
    const checks = {
        async createJavaAction(o) {
            const a = await get(`${o.module}.${o.name}`);
            const r = a instanceof javaactions.JavaAction ? [] : [`${o.module}.${o.name} is not a Java action`];
            if (a.actionParameters && a.actionParameters.length !== (o.parameters || []).length) r.push(`${o.module}.${o.name} has ${a.actionParameters.length} parameters`);
            const code = o.code === undefined ? [] : fs.readFileSync(path.join(client.project.dir, `javasource/${o.module.toLowerCase()}/actions/${o.name}.java`), "utf8").replace(/\r\n/g, "\n").includes(userCode(o.code).trim()) ? [] : [`${o.module}.${o.name}: the file does not hold the code`];
            return [...r, ...fileCheck(o, false), ...code];
        },
        async createJavaScriptAction(o) {
            const a = await get(`${o.module}.${o.name}`);
            const r = a instanceof javascriptactions.JavaScriptAction ? [] : [`${o.module}.${o.name} is not a JavaScript action`];
            return [...r, ...fileCheck(o, true)];
        },
        async setJavaActionCode(o) {
            const [module, name] = o.javaAction.split(".");
            const rel = `javasource/${module.toLowerCase()}/actions/${name}.java`;
            const full = path.join(client.project.dir, rel);
            if (!fs.existsSync(full)) return [`${rel} missing`];
            const want = userCode(o.code).trim();
            return fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n").includes(want) ? [] : [`${rel} does not hold the new code`];
        },
        async changeJavaAction(o) {
            return changedCheck(o, false);
        },
        async changeJavaScriptAction(o) {
            return changedCheck(o, true);
        },
        async createRule(o) {
            const r = await get(`${o.module}.${o.name}`);
            return r instanceof mf.Rule ? [] : [`${o.module}.${o.name} is not a rule`];
        }
    };
    return { impl, checks };
}

module.exports = { makeCode, CODE_OPS, javaSource, jsSource, retained, javaCheck };
