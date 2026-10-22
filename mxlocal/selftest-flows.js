"use strict";
// selftest phase F: Java/JavaScript actions with their source files, rules and rule decisions, enumeration switch,
// reduce, metrics, REST options, annotations, moveAction and extractMicroflow. Checks the stored keys against Studio
// Pro samples (Mendix's keys where the test projects have none), the generated files byte for byte, that an existing
// file keeps its user code, that restore removes and puts back the files, and a clean reopen.
const fs = require("fs");
const path = require("path");
const { restore } = require("./mpr");
const { lostProperties } = require("./lost");

// Keys Studio Pro stores (Studio Pro samples in the test projects; mendixlabs/mxcli measurements for rules).
const KEYS = {
    "JavaActions$JavaAction": "ActionDefaultReturnName Documentation Excluded ExportLevel JavaReturnType MicroflowActionInfo Name Parameters TypeParameters",
    "JavaScriptActions$JavaScriptAction": "ActionDefaultReturnName Documentation Excluded ExportLevel JavaReturnType MicroflowActionInfo Name Parameters Platform TypeParameters",
    "JavaActions$JavaActionParameter": "Category Description IsRequired Name ParameterType",
    "JavaScriptActions$JavaScriptActionParameter": "Category Description IsRequired Name ParameterType",
    "CodeActions$MicroflowActionInfo": "Caption Category IconData IconDataDark ImageData ImageDataDark",
    "CodeActions$EntityTypeParameterType": "TypeParameterPointer", "CodeActions$TypeParameter": "Name",
    "Microflows$Rule": "ApplyEntityAccess Documentation Excluded ExportLevel Flows MarkAsUsed MicroflowReturnType Name ObjectCollection ReturnVariableName",
    "Microflows$RuleSplitCondition": "RuleCall", "Microflows$RuleCall": "Microflow ParameterMappings", "Microflows$RuleCallParameterMapping": "Argument Parameter",
    "Microflows$Annotation": "Caption RelativeMiddlePoint Size",
    "Microflows$AnnotationFlow": "DestinationConnectionIndex DestinationPointer Line OriginConnectionIndex OriginPointer",
    "Microflows$EnumerationCase": "Value",
    "Microflows$HttpConfiguration": "ClientCertificate CustomLocation CustomLocationTemplate HttpAuthenticationPassword HttpAuthenticationUserName HttpHeaderEntries HttpMethod OverrideLocation UseHttpAuthentication",
    "Microflows$AggregateAction": "AggregateFunction AggregateVariableName Attribute ErrorHandlingType Expression ReduceInitialValueExpression ReduceReturnDataType UseExpression VariableName"
};

function walk(n, fn) {
    if (!n || typeof n !== "object" || Buffer.isBuffer(n)) return;
    if (Array.isArray(n)) return n.forEach(x => walk(x, fn));
    if (n.$Type) fn(n);
    for (const v of Object.values(n)) walk(v, fn);
}

function plan(mod, T, file) {
    const E = `${mod}.${T}`;
    const ops = [
        { op: "createJavaAction", module: mod, name: `${T}_Java`, folder: "ZzTest", documentation: "Zz test action", exposed: { caption: "Zz Java", category: "Zz" }, parameters: [
            { name: "S", type: "String" }, { name: "I", type: "Integer" }, { name: "D", type: "Decimal" }, { name: "B", type: "Boolean" }, { name: "W", type: "DateTime" },
            { name: "Obj", type: E }, { name: "Objs", type: `List(${E})` }, { name: "C", type: `Enum(${E}Status)` }, { name: "EntityType", type: "EntityType(TP)" },
            { name: "Gen", type: "Object(TP)" }, { name: "Gens", type: "List(TP)" }, { name: "Cb", type: "Microflow", required: false }] },
        { op: "createJavaAction", module: mod, name: `${T}_Java2`, folder: "ZzTest", returns: `List(${E})` },
        { op: "createJavaAction", module: mod, name: `${T}_Java3`, folder: "ZzTest", parameters: [{ name: "Text", type: "String" }, { name: "Item", type: E }], returns: "Nothing" },
        { op: "createJavaScriptAction", module: mod, name: `${T}_Js`, folder: "ZzTest", platform: "Web", exposed: { caption: "Zz JS", category: "Zz" }, parameters: [
            { name: "text", type: "String", description: "Some text" }, { name: "num", type: "Decimal" }, { name: "c", type: `Enum(${E}Status)` }, { name: "obj", type: E },
            { name: "objs", type: `List(${E})` }, { name: "nf", type: "Nanoflow" }], returns: "String" },
        { op: "createRule", module: mod, name: `${T}_Rule`, folder: "ZzTest", parameters: [{ name: "Item", type: E }], returns: "Boolean",
            actions: [{ action: "if", condition: "$Item/Count > 100", then: [{ action: "end", value: "true" }] }], returnValue: "$Item/Flag" },
        { op: "createRule", module: mod, name: `${T}_RuleEnum`, folder: "ZzTest", parameters: [{ name: "Item", type: E }], returns: `Enum(${E}Status)`, returnValue: "$Item/Status" },
        { op: "createMicroflow", module: mod, name: `${T}_Flows`, folder: "ZzTest", parameters: [{ name: "Item", type: E }, ...(file ? [{ name: "File", type: file }] : [])], actions: [
            { action: "if", rule: `${E}_Rule`, args: { Item: "$Item" }, then: [{ action: "log", message: "big" }], else: [{ action: "log", message: "small" }] },
            { action: "switch", value: "$Item/Status", cases: { Open: [{ action: "log", message: "open", note: "the open ones" }], "Done, Cancelled": [{ action: "log", message: "closed" }] }, empty: [{ action: "log", message: "no status" }] },
            { action: "switch", rule: `${E}_RuleEnum`, args: { Item: "$Item" }, cases: { Done: [{ action: "log", message: "rule done" }] }, other: [{ action: "log", message: "rule other" }] },
            { action: "retrieve", variable: "All", entity: E },
            { action: "aggregateList", variable: "Sum", list: "All", function: "reduce", initial: "0", expression: "$currentResult + $currentObject/Count" },
            { action: "aggregateList", variable: "Titles", list: "All", function: "reduce", initial: "''", expression: "$currentResult + $currentObject/Title" },
            { action: "metric", type: "counter", name: "zz.counted", value: "$Sum", tags: { kind: "'zz'" } },
            { action: "metric", type: "increment", name: "zz.calls" },
            { action: "metric", type: "gauge", name: "zz.size", value: "$Sum" },
            { action: "callRest", method: "Post", url: "https://api.example.com/form", auth: { user: "'zz'", password: "'secret'" }, headers: { Accept: "'*/*'" }, timeout: 20, proxy: "none",
                formData: { title: "$Item/Title", n: "toString($Sum)" }, response: "file", variable: "Got", errorBody: false },
            { action: "callRest", url: "https://api.example.com/p", proxy: { host: "'proxy.local'", port: "8080" }, variable: "Txt" },
            ...(file ? [{ action: "callRest", method: "Put", url: "https://api.example.com/upload", binaryBody: "$File" }] : []),
            { action: "callJava", javaAction: `${E}_Java2`, variable: "Listed" },
            { action: "variable", name: "N", type: "Integer", value: "1" },
            { action: "set", name: "N", value: "$N + $Sum" },
            { action: "log", message: "n {1}", args: ["toString($N)"] }] }
    ];
    return { ops };
}

// The Java file Studio Pro (mxbuild 10.24 / 11.x) writes for <T>_Java3, a new action without user code.
function java3(mod, T) {
    const m = mod.toLowerCase();
    return ["// This file was generated by Mendix Studio Pro.", "//", "// WARNING: Only the following code will be retained when actions are regenerated:", "// - the import list",
        "// - the code between BEGIN USER CODE and END USER CODE", "// - the code between BEGIN EXTRA CODE and END EXTRA CODE",
        "// Other code you write will be lost the next time you deploy the project.", "// Special characters, e.g., é, ö, à, etc. are supported in comments.", "",
        `package ${m}.actions;`, "", "import com.mendix.systemwideinterfaces.core.IContext;", "import com.mendix.systemwideinterfaces.core.IMendixObject;",
        "import com.mendix.systemwideinterfaces.core.UserAction;", "", `public class ${T}_Java3 extends UserAction<java.lang.Void>`, "{", "\tprivate final java.lang.String Text;",
        "\t/** @deprecated use Item.getMendixObject() instead. */", "\t@java.lang.Deprecated(forRemoval = true)", "\tprivate final IMendixObject __Item;", `\tprivate final ${m}.proxies.${T} Item;`, "",
        `\tpublic ${T}_Java3(`, "\t\tIContext context,", "\t\tjava.lang.String _text,", "\t\tIMendixObject _item", "\t)", "\t{", "\t\tsuper(context);", "\t\tthis.Text = _text;",
        "\t\tthis.__Item = _item;", `\t\tthis.Item = _item == null ? null : ${m}.proxies.${T}.initialize(getContext(), _item);`, "\t}", "", "\t@java.lang.Override",
        "\tpublic java.lang.Void executeAction() throws Exception", "\t{", "\t\t// BEGIN USER CODE",
        "\t\tthrow new com.mendix.systemwideinterfaces.MendixRuntimeException(\"Java action was not implemented\");", "\t\t// END USER CODE", "\t}", "", "\t/**",
        "\t * Returns a string representation of this action", "\t * @return a string representation of this action", "\t */", "\t@java.lang.Override",
        "\tpublic java.lang.String toString()", "\t{", `\t\treturn "${T}_Java3";`, "\t}", "", "\t// BEGIN EXTRA CODE", "\t// END EXTRA CODE", "}", ""].join("\r\n");
}

function js(T) {
    return ["// This file was generated by Mendix Studio Pro.", "//", "// WARNING: Only the following code will be retained when actions are regenerated:", "// - the import list",
        "// - the code between BEGIN USER CODE and END USER CODE", "// - the code between BEGIN EXTRA CODE and END EXTRA CODE", "// Other code you write will be lost the next time you deploy the project.",
        "import \"mx-global\";", "import { Big } from \"big.js\";", "", "// BEGIN EXTRA CODE", "// END EXTRA CODE", "", "/**", " * @param {string} text - Some text", " * @param {Big} num",
        " * @param {undefined|\"Open\"|\"Done\"|\"Cancelled\"} c", " * @param {MxObject} obj", " * @param {MxObject[]} objs", " * @param {Nanoflow} nf", " * @returns {Promise.<string>}", " */",
        `export async function ${T}_Js(text, num, c, obj, objs, nf) {`, "\t// BEGIN USER CODE", "\tthrow new Error(\"JavaScript action was not implemented\");", "\t// END USER CODE", "}", ""].join("\r\n");
}

// The steps the second plan moves, annotates and extracts, found by what they do.
async function editPlan(s, mod, T) {
    const qn = `${mod}.${T}_Flows`;
    const lines = (await s.ops.steps(qn)).split("\n");
    const id = re => {
        const l = lines.find(x => re.test(x));
        if (!l) throw new Error(`selftest: no step ${re} in ${qn}`);
        return /\[([0-9a-f]{8})\]/.exec(l.replace(/^\s*\[(true|false|[\w, ()]+)\] (?=\[)/, ""))[1];
    };
    return { ops: [
        { op: "moveAction", microflow: qn, id: id(/METRIC INCREMENT/), after: id(/IF RULE .*_Rule\(/), branch: "false" },
        { op: "addAnnotation", microflow: qn, text: "Zz free note" },
        { op: "addAnnotation", microflow: qn, text: "Zz REST note", to: id(/REST POST/) },
        { op: "extractMicroflow", microflow: qn, from: id(/RETRIEVE \$All/), to: id(/\$Titles = REDUCE/), name: `${T}_SumSub`, folder: "ZzTest" },
        { op: "extractMicroflow", microflow: qn, from: id(/VARIABLE \$N/), to: id(/SET \$N/), name: `${T}_NSub`, folder: "ZzTest" }
    ] };
}

async function flowsPhase({ copy, mod, T, reopen, layout, layoutProblems, file }) {
    const problems = [];
    const dir = path.dirname(copy);
    const m = mod.toLowerCase();
    const rel = n => `javasource/${m}/actions/${T}_${n}.java`;
    // an existing Java file with user code, extra code and an own import: they must survive
    const own = path.join(dir, rel("Java2"));
    fs.mkdirSync(path.dirname(own), { recursive: true });
    const ownText = `// old\r\npackage ${m}.actions;\r\n\r\nimport java.util.Map;\r\n\r\npublic class ${T}_Java2\r\n{\r\n\t\t// BEGIN USER CODE\r\n\t\treturn null; // zz user code\r\n\t\t// END USER CODE\r\n\t// BEGIN EXTRA CODE\r\n\tprivate static int zz = 1;\r\n\t// END EXTRA CODE\r\n}\r\n`;
    fs.writeFileSync(own, ownText);
    let s = await reopen(copy);
    const p1 = plan(mod, T, file);
    const lint = await s.ops.runPlan(p1, () => {});
    const p2 = await editPlan(s, mod, T);
    const lint2 = await s.ops.runPlan({ ops: p2.ops }, () => {});
    await s.model.flushChanges();
    const enc = s.client.encode();
    const lay = layoutProblems(layout, enc);
    const lost = lostProperties(s.client, s.model, enc);
    problems.push(...[...lint, ...lint2].map(l => "lint: " + l), ...lay.problems.slice(0, 5), ...lost);
    if ((enc.extra || []).length !== 4) problems.push(`${(enc.extra || []).length} source files in the change, expected 4`);
    const r = s.client.project.writeEncoded(enc);
    // files: generated byte for byte, the existing one keeps its code
    const read = f => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : null);
    if (read(rel("Java3")) !== java3(mod, T)) problems.push(`${rel("Java3")} differs from what Studio Pro generates`);
    const jsRel = `javascriptsource/${m}/actions/${T}_Js.js`;
    if (read(jsRel) !== js(T)) problems.push(`${jsRel} differs from what Studio Pro generates`);
    const j2 = read(rel("Java2")) || "";
    if (!j2.includes("return null; // zz user code") || !j2.includes("private static int zz = 1;") || !j2.includes("import java.util.Map;") || !j2.includes(`extends UserAction<java.util.List<IMendixObject>>`)) problems.push(`${rel("Java2")} lost the user code, extra code or import, or was not regenerated`);
    const j1 = read(rel("Java")) || "";
    for (const want of [`private final ${m}.proxies.${T}Status C;`, "private final java.util.List<IMendixObject> Gens;", "private final java.lang.String Cb;", "/**\r\n * Zz test action\r\n */"]) if (!j1.includes(want)) problems.push(`${rel("Java")} lacks ${JSON.stringify(want)}`);
    // stored model
    s = await reopen(copy);
    const failed = await s.ops.checkPlan({ ops: [...p1.ops, ...p2.ops] });
    problems.push(...failed);
    const seen = new Map();
    const cases = new Set();
    for (const id of s.ctx.project.units.keys()) {
        const u = s.ctx.project.read(id);
        if (!String(u.Name || "").startsWith(`${T}_`)) continue;
        walk(u, o => {
            seen.set(o.$Type, o);
            const want = KEYS[o.$Type];
            const have = Object.keys(o).filter(k => k[0] !== "$").sort().join(" ");
            if (want && have !== want) problems.push(`${o.$Type} has keys [${have}], Studio Pro stores [${want}]`);
            if (o.$Type === "Microflows$EnumerationCase") cases.add(o.Value);
        });
    }
    for (const t of ["Microflows$Rule", "Microflows$RuleSplitCondition", "Microflows$CounterMeterAction", "Microflows$IncrementCounterMeterAction", "Microflows$GaugeMeterAction",
        "Microflows$FormDataRequestHandling", "Microflows$ProxyConfiguration", "Microflows$Annotation", "Microflows$AnnotationFlow", "JavaActions$MicroflowJavaActionParameterType",
        "JavaScriptActions$NanoflowJavaScriptActionParameterType", "CodeActions$ParameterizedEntityType", ...(file ? ["Microflows$BinaryRequestHandling"] : [])]) if (!seen.has(t)) problems.push(`no ${t} stored`);
    for (const v of ["Open", "Done", "Cancelled", "(empty)"]) if (!cases.has(v)) problems.push(`no enumeration case ${v}`);
    const info = seen.get("CodeActions$MicroflowActionInfo");
    if (info && !["IconData", "IconDataDark", "ImageData", "ImageDataDark"].every(k => Buffer.isBuffer(info[k]))) problems.push("MicroflowActionInfo icons are not (empty) binaries like Studio Pro writes");
    // a move that puts a step before the variable it changes is refused (on the extracted flow; not saved)
    const subSteps = (await s.ops.steps(`${mod}.${T}_NSub`)).split("\n");
    const setLine = subSteps.find(l => /SET \$N/.test(l));
    try {
        await s.ops.runPlan({ ops: [{ op: "moveAction", microflow: `${mod}.${T}_NSub`, id: /\[([0-9a-f]{8})\]/.exec(setLine)[1], after: "start" }] }, () => {});
        problems.push("moveAction of SET $N before VARIABLE $N was not refused");
    } catch (e) {
        if (!/made after it/.test(e.message)) problems.push(`moveAction refusal: ${e.message}`);
    }
    s = await reopen(copy);
    const errs = [];
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => errs.push(e.message));
    await s.model.flushChanges();
    if (s.client.log.length) errs.push(`${s.client.log.length} deltas on open`);
    problems.push(...errs.slice(0, 3));
    // undo: the new files go, the existing one comes back as it was
    restore(dir, r.backup);
    if (read(rel("Java")) !== null || read(jsRel) !== null) problems.push("restore left the new source files");
    if (read(rel("Java2")) !== ownText) problems.push("restore did not put the existing Java file back");
    fs.rmSync(own);
    return { problems: [...new Set(problems)], ops: p1.ops.length + p2.ops.length };
}

// ------------------------------------------------ phase E: error handling (flow-errors.js)
// Handlers on actions and loops, the recipes (logAndShow, retry, storeError, rethrow), 'error' with a message, then
// changeAction onError (replace, remove), addActions into a handler (handlerOf, after a step in it), deleteAction of a
// step with a handler and of a step inside one; refusals (nanoflow rollback, error outside a handler, $latestError
// outside a handler, retry of a step that makes a variable, continue on a loop, handlerOf without handler); steps
// shows the handler branches and FLOW CHECK; the dry run FLOW CHECK; stored, reopened with 0 errors and 0 deltas.
function errorPlan(mod, T) {
    const E = `${mod}.${T}`;
    const rest = (extra = {}) => ({ action: "callRest", url: "https://api.example.com/err", ...extra });
    return { ops: [
        { op: "createEntity", module: mod, name: `${T}ErrLog`, attributes: [{ name: "Message", type: "String(2000)" }, { name: "Stacktrace", type: "String(unlimited)" }, { name: "ErrorType", type: "String" }, { name: "Microflow", type: "String" }, { name: "Date", type: "DateTime" }] },
        { op: "createEntity", module: mod, name: `${T}ErrItem`, attributes: [{ name: "Name", type: "String" }] },
        { op: "createMicroflow", module: mod, name: `${T}_ErrSub`, folder: "ZzErr", actions: [{ action: "log", message: "sub" }] },
        { op: "createMicroflow", module: mod, name: `${T}_Err`, folder: "ZzErr", actions: [
            { action: "retrieve", variable: "All", entity: `${E}ErrItem` },
            rest({ onError: "logAndShow", caption: "Zz rest show" }),
            { action: "loop", over: "All", item: "It", actions: [{ action: "commit", variable: "It" }], onError: { actions: [{ action: "log", message: "loop failed {1}", args: ["$latestError/Message"], level: "Error" }] } },
            { action: "loop", over: "All", item: "It2", actions: [{ action: "commit", variable: "It2" }] },
            rest({ onError: { pattern: "retry", times: 3, log: "zz gave up" }, caption: "Zz rest retry" }),
            { action: "call", microflow: `${E}_ErrSub`, onError: { pattern: "storeError", entity: `${E}ErrLog` }, caption: "Zz call store" },
            { action: "commit", variable: "All", onError: "rethrow", caption: "Zz commit rethrow" },
            { action: "log", message: "zz main", caption: "Zz log custom", onError: { rollback: false, actions: [{ action: "log", message: "zz {1}", args: ["$latestError/Message"], stackTrace: true }, { action: "error", message: "zz custom fail {1}", args: ["$latestError/Stacktrace"] }] } },
            rest({ caption: "Zz rest bare" })] },
        { op: "createNanoflow", module: mod, name: `${T}_ErrNano`, folder: "ZzErr", actions: [
            { action: "create", variable: "N", entity: `${E}ErrItem`, commit: true, onError: "logAndShow" },
            { action: "call", microflow: `${E}_ErrSub`, onError: { pattern: "storeError", entity: `${E}ErrLog`, message: "Zz saved the error" } },
            { action: "commit", variable: "N", onError: { actions: [{ action: "message", type: "Warning", text: "zz nano failed" }] } }] }
    ] };
}

async function errorsPhase({ copy, mod, T, reopen, layout, layoutProblems }) {
    const problems = [];
    const E = `${mod}.${T}`;
    const qn = `${E}_Err`;
    let s = await reopen(copy);
    const p1 = errorPlan(mod, T);
    const lint1 = await s.ops.runPlan(p1, () => {});
    // the steps of the new flow: ids by what they do
    const idIn = (text, re, after = null) => {
        const lines = text.split("\n");
        const from = after ? lines.findIndex(l => after.test(l)) : 0;
        const l = lines.slice(Math.max(0, from)).find(x => re.test(x));
        if (!l) throw new Error(`selftest: no step ${re} in ${qn}:\n${text}`);
        return [...l.matchAll(/\[([0-9a-f]{8})\]/g)].pop()[1];
    };
    const st1 = await s.ops.steps(qn);
    for (const want of [/\[on error of [0-9a-f]{8}\] /, /\{on error: custom handler with rollback\}/, /\{on error: custom handler without rollback\}/, /WHILE \$RetryCount < 3/, /ERROR$/m])
        if (!want.test(st1)) problems.push(`steps ${qn} lacks ${want}`);
    const ids = {
        restShow: idIn(st1, /REST GET .*\{on error/),
        showMsg: idIn(st1, /MESSAGE Error/),
        loop: idIn(st1, /LOOP \$It IN \$All/),
        loopLog: idIn(st1, /LOG Error 'loop failed/),
        call: idIn(st1, /CALL .*_ErrSub/),
        commit: idIn(st1, /COMMIT \$All/),
        logCustom: idIn(st1, /LOG Info 'zz main'/),
        retrieve: idIn(st1, /RETRIEVE \$All/)
    };
    const p2 = { ops: [
        { op: "changeAction", microflow: qn, id: ids.commit, onError: "continue" },
        { op: "changeAction", microflow: qn, id: ids.logCustom, onError: { actions: [{ action: "message", type: "Warning", text: "zz replaced handler" }] } },
        { op: "changeAction", microflow: qn, id: ids.retrieve, onError: "logAndShow" },
        { op: "addActions", microflow: qn, handlerOf: ids.restShow, actions: [{ action: "log", message: "zz first in handler {1}", args: ["$latestError/Message"] }] },
        { op: "addActions", microflow: qn, after: ids.showMsg, actions: [{ action: "log", message: "zz after message" }] },
        { op: "deleteAction", microflow: qn, id: ids.call },
        { op: "deleteAction", microflow: qn, id: ids.loopLog }
    ] };
    const lint2 = await s.ops.runPlan(p2, () => {});
    await s.model.flushChanges();
    const fc = require("./flow-errors").flowCheckChanges(s.client);
    if (!fc.some(l => /REST call without a custom error handler/.test(l))) problems.push(`dry run FLOW CHECK misses the REST call without handler: ${fc.join(" / ").slice(0, 300)}`);
    if (!fc.some(l => /commits inside a loop/.test(l))) problems.push(`dry run FLOW CHECK misses the commit in a loop: ${fc.join(" / ").slice(0, 300)}`);
    if (!fc.some(l => /nanoflow error handlers never roll back/.test(l))) problems.push("dry run FLOW CHECK misses the nanoflow note");
    const enc = s.client.encode();
    const lay = layoutProblems(layout, enc);
    const lost = lostProperties(s.client, s.model, enc);
    problems.push(...[...lint1, ...lint2].map(l => "lint: " + l), ...lay.problems.slice(0, 5), ...lost);
    s.client.project.writeEncoded(enc);
    // stored
    s = await reopen(copy);
    problems.push(...(await s.ops.checkPlan({ ops: [...p1.ops, ...p2.ops] })));
    const st2 = await s.ops.steps(qn);
    if (/_ErrSub/.test(st2) || /ErrLog/.test(st2.split("FLOW CHECK")[0])) problems.push("deleteAction left the call or its storeError handler");
    if (/loop failed/.test(st2)) problems.push("deleteAction of a step inside a loop handler left it");
    if (!/zz first in handler[\s\S]*MESSAGE Error[\s\S]*zz after message/.test(st2)) problems.push(`addActions into the handler: wrong order or missing:\n${st2}`);
    if (!/FLOW CHECK \(error handling\):/.test(st2)) problems.push("steps shows no FLOW CHECK");
    const units = [...s.ctx.project.units.keys()].map(id => s.ctx.project.read(id)).filter(u => String(u.Name || "").startsWith(`${T}_Err`));
    const main = units.find(u => u.Name === `${T}_Err`);
    const nano = units.find(u => u.Name === `${T}_ErrNano`);
    const seen = { stack: 0, errEv: 0, loopFlow: 0, create: 0 };
    const mainText = JSON.stringify(main, (k, v) => (Buffer.isBuffer(v) ? undefined : v));
    if (!mainText.includes("zz replaced handler") || mainText.includes("zz custom fail")) problems.push("changeAction onError did not replace the custom handler");
    walk(main, o => {
        if (o.$Type === "Microflows$LogMessageAction" && o.IncludeLatestStackTrace === true) seen.stack++;
        if (o.$Type === "Microflows$ErrorEvent") seen.errEv++;
    });
    const loopObj = [];
    walk(main, o => o.$Type === "Microflows$LoopedActivity" && o.LoopSource && o.LoopSource.$Type === "Microflows$IterableList" && loopObj.push(o));
    if (!loopObj.length || loopObj[0].ErrorHandlingType !== "Custom" || !main.Flows.some(f => f.IsErrorHandler && f.OriginPointer === loopObj[0].$ID)) problems.push("the loop has no custom error handler with an error flow");
    if (seen.stack < 2) problems.push(`${seen.stack} log actions with IncludeLatestStackTrace, expected 2+ (logAndShow, retry give-up, the custom log)`);
    if (seen.errEv !== 1) problems.push(`${seen.errEv} error events, expected 1 (retry give-up; rethrow handler removed, custom error replaced)`);
    let commitEH = null;
    walk(main, o => o.$Type === "Microflows$CommitAction" && o.CommitVariableName === "All" && (commitEH = o.ErrorHandlingType));
    if (commitEH !== "Continue") problems.push(`COMMIT $All error handling ${commitEH}, expected Continue`);
    walk(nano || {}, o => o.$Type === "Microflows$CreateChangeAction" && o.Items && o.Items.some(i => /\$latestError\b/.test(i.Value || "") && !/\$latestError\//.test(i.Value)) && seen.create++);
    if (!seen.create) problems.push("the nanoflow storeError does not write $latestError (the error text) into the log object");
    walk(nano || {}, o => o.Action && /^Custom$|^Rollback$/.test(o.Action.ErrorHandlingType) && problems.push(`nanoflow action with error handling ${o.Action.ErrorHandlingType}`));
    // refusals (dry run on a fresh copy, nothing saved)
    const refused = async (what, plan, re) => {
        const r = await reopen(copy);
        try {
            const lint = await r.ops.runPlan(plan, () => {});
            if (lint.length && lint.some(l => re.test(l))) return;
            problems.push(`${what} was not refused${lint.length ? `: ${lint.join("; ")}` : ""}`);
        } catch (e) {
            if (!re.test(e.message)) problems.push(`${what}: ${e.message}`);
        }
        await r.model.flushChanges().catch(() => {});
    };
    const flow = (name, actions, nanoflow = false) => ({ ops: [{ op: nanoflow ? "createNanoflow" : "createMicroflow", module: mod, name: `${T}_${name}`, actions }] });
    await refused("nanoflow onError rollback", flow("ErrR1", [{ action: "variable", name: "X", type: "Integer", value: "1", onError: "rollback" }], true), /never rolls back/);
    await refused("nanoflow rollback: true", flow("ErrR2", [{ action: "variable", name: "X", type: "Integer", value: "1", onError: { rollback: true, actions: [] } }], true), /never rolls back/);
    await refused("error outside a handler", flow("ErrR3", [{ action: "error" }]), /only allowed inside an onError handler/);
    await refused("$latestError outside a handler", flow("ErrR4", [{ action: "log", message: "x {1}", args: ["$latestError/Message"] }]), /\$latestError has no value here/);
    await refused("$latestHttpResponse before a REST call", flow("ErrR5", [{ action: "log", message: "x {1}", args: ["toString($latestHttpResponse/StatusCode)"] }]), /\$latestHttpResponse has no value here/);
    await refused("retry of a step that makes a variable", flow("ErrR6", [{ action: "callRest", url: "https://x.example.com", variable: "Txt", onError: "retry" }]), /would only exist inside the loop/);
    await refused("continue on a loop", flow("ErrR7", [{ action: "createList", variable: "L", entity: `${E}ErrItem` }, { action: "loop", over: "L", actions: [{ action: "log", message: "x" }], onError: "continue" }]), /not "continue"/);
    await refused("handlerOf without a handler", { ops: [{ op: "addActions", microflow: qn, handlerOf: ids.retrieve === ids.restShow ? "x" : idIn(st2, /REST GET .*Zz rest bare|REST GET https:\/\/api.example.com\/err$/m), actions: [{ action: "log", message: "x" }] }] }, /has no custom error handler/);
    await refused("changeAction onError retry", { ops: [{ op: "changeAction", microflow: qn, id: ids.logCustom, onError: { pattern: "retry" } }] }, /cannot do; delete the step/);
    await refused("unknown recipe", flow("ErrR8", [{ action: "log", message: "x", onError: "logAndShw" }]), /Did you mean: logAndShow/);
    await refused("storeError without entity", flow("ErrR9", [{ action: "log", message: "x", onError: "storeError" }]), /needs 'entity'|entity/);
    // reopen: 0 errors, 0 deltas
    s = await reopen(copy);
    const errs = [];
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => errs.push(e.message));
    await s.model.flushChanges();
    if (s.client.log.length) errs.push(`${s.client.log.length} deltas on open`);
    problems.push(...errs.slice(0, 3));
    return { problems: [...new Set(problems)], ops: p1.ops.length + p2.ops.length };
}

module.exports = { flowsPhase, errorsPhase };
