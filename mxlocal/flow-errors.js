"use strict";
// Error handling of microflows and nanoflows: what an "onError" value means, the recipes (patterns) it can name, which
// steps are inside which custom error handler (on Model SDK objects and on plain units), and the FLOW CHECK of the dry
// run and of 'steps' (calls without a handler, commits in loops, handlers without rollback, nanoflow handlers, error
// events outside a handler).
//
// Mendix rules this follows (Studio Pro's error handling property):
//   microflow: Rollback (default: stop, undo everything), Custom (handler after a rollback), CustomWithoutRollBack,
//              Continue (ignore the error; Studio Pro does not offer it on every action, mx check settles it)
//   nanoflow:  Abort (default), CustomWithoutRollBack, Continue - a nanoflow never rolls back
//   $latestError: System.Error in a microflow ($latestError/Message, /Stacktrace, /ErrorType), the error text (String)
//   in a nanoflow; only after an error handler flow. $latestSoapFault: after the handler of a web service call.
//   $latestHttpResponse: after a REST call (also on its error handler path).
const sdk = require("mendixmodelsdk");
const { fail, validate, bool, noDollar } = require("./ops-util");

const { microflows: mf } = sdk;

// The values onError takes. The patterns are recipes that expand into a custom handler (retry: a loop around it).
const ON_ERROR_WORDS = { continue: "continue", rollback: "default", abort: "default", default: "default", none: "default" };
const PATTERN_FIELDS = {
    logAndShow: { pattern: "R", message: "optional text shown to the user (default: Something went wrong. Please try again.)", log: "optional log text before the error message (default: <flow>: <step> failed)", node: "optional log node", jsLog: "nanoflow: optional Module.JavaScriptAction with a String parameter to log with", rollback: "microflow: optional true/false (default true)", returnValue: "when the flow returns a value" },
    retry: { pattern: "R", times: "optional number of tries (default 3)", log: "optional log text when the last try failed", node: "optional log node", jsLog: "nanoflow: optional Module.JavaScriptAction to log with" },
    storeError: { pattern: "R", entity: "R Module.Entity of the error log object", set: "optional { \"Attribute\": \"expression\" } (default: Message/Stacktrace/ErrorType/Microflow/Date attributes it has)", message: "optional text shown to the user", rethrow: "optional true = end with the error again (default: end the flow)", rollback: "microflow: optional true/false (default true)", returnValue: "when the flow returns a value" },
    rethrow: { pattern: "R", log: "optional log text before the error message", node: "optional log node", jsLog: "nanoflow: optional Module.JavaScriptAction to log with", rollback: "microflow: optional true/false (default true)" }
};
const PATTERNS = Object.keys(PATTERN_FIELDS);
const CUSTOM_FIELDS = { rollback: "optional", actions: "optional", returnValue: "optional" };
const ON_ERROR_DOC = "optional \"continue\" | \"rollback\" (microflow default) | \"abort\" (nanoflow default) | a recipe \"logAndShow\" | \"rethrow\" | \"retry\", or { \"pattern\": \"logAndShow\" | \"retry\" | \"storeError\" | \"rethrow\", ... }, or { \"rollback\": true/false, \"actions\": [ ... ], \"returnValue\": \"...\" } (custom error handler)";

const NANO_ROLLBACK = "a nanoflow never rolls back (it runs in the browser or app; there is no database transaction to undo). Use \"abort\" (the default: stop the nanoflow), \"continue\", or a custom handler { \"actions\": [ ... ] } (always without rollback); to undo changes of an object, put { \"action\": \"rollback\", \"variable\": \"Obj\" } into the handler";

// onError as written -> { kind: "continue" | "default" | "custom" | "retry", rollback, actions, returnValue, spec }
// (patterns other than retry come back as custom with their actions). ctx: { nano, inLoop, qn, caption, returns,
// jsLog(qn) -> { qn, param } | null, defaultJsLog() -> same | null, entityInfo(qn) -> { attrs: Map name -> type } }
async function normalize(onError, ctx, where) {
    if (typeof onError === "string") {
        const w = ON_ERROR_WORDS[onError.toLowerCase()];
        if (w) {
            if (ctx.nano && /^rollback$/i.test(onError)) throw new Error(`${where}: onError "rollback": ${NANO_ROLLBACK}`);
            return { kind: w };
        }
        const p = PATTERNS.find(x => x.toLowerCase() === onError.toLowerCase());
        if (!p) fail(`${where}: onError '${onError}' is not known; use "continue", "rollback", "abort", a recipe (${PATTERNS.join(", ")}) or { "actions": [ ... ] }`, onError, [...Object.keys(ON_ERROR_WORDS), ...PATTERNS]);
        onError = { pattern: p };
    }
    if (!onError || typeof onError !== "object" || Array.isArray(onError)) throw new Error(`${where}: onError must be "continue", "rollback", a recipe name, or { "actions": [ ... ] } / { "pattern": ... }`);
    if (onError.pattern === undefined) {
        validate("-", "onError", { fields: CUSTOM_FIELDS }, onError, where);
        if (ctx.nano && onError.rollback !== undefined && bool(onError.rollback, false)) throw new Error(`${where}: onError rollback true: ${NANO_ROLLBACK}`);
        if (onError.actions !== undefined && !Array.isArray(onError.actions)) throw new Error(`${where}: onError.actions must be a list [ ... ]`);
        return { kind: "custom", rollback: ctx.nano ? false : bool(onError.rollback, true), actions: onError.actions || [], returnValue: onError.returnValue };
    }
    const name = PATTERNS.find(x => x.toLowerCase() === String(onError.pattern).toLowerCase());
    if (!name) fail(`${where}: onError pattern '${onError.pattern}' is not one of ${PATTERNS.join(" | ")}`, String(onError.pattern), PATTERNS);
    validate("-", `onError pattern ${name}`, { fields: PATTERN_FIELDS[name] }, { ...onError, pattern: name }, where);
    if (ctx.nano && onError.rollback !== undefined && bool(onError.rollback, false)) throw new Error(`${where}: onError rollback true: ${NANO_ROLLBACK}`);
    const rollback = ctx.nano ? false : bool(onError.rollback, true);
    const log = await logSteps(ctx, onError, where);
    const latest = ctx.nano ? "$latestError" : "$latestError/Message";
    const what = `${ctx.qn}: ${ctx.caption} failed`;
    const tail = ctx.inLoop ? [{ action: "continue" }] : []; // a handler in a loop must end with continue/break/error
    switch (name) {
        case "logAndShow": {
            const text = onError.message !== undefined ? String(onError.message) : ctx.sync ? "Synchronization failed. Your changes stay on this device; try again when you are online." : "Something went wrong. Please try again.";
            return { kind: "custom", pattern: name, rollback, returnValue: onError.returnValue, actions: [...log(onError.log || what), { action: "message", type: "Error", text }, ...tail] };
        }
        case "rethrow":
            return { kind: "custom", pattern: name, rollback, actions: [...log(onError.log || what), { action: "error" }] };
        case "storeError": {
            const set = onError.set !== undefined ? onError.set : await errorMembers(ctx, onError.entity, where);
            if (!set || typeof set !== "object" || Array.isArray(set) || !Object.keys(set).length) throw new Error(`${where}: storeError: ${onError.entity} has no attribute to keep the error in (Message, Stacktrace, ErrorType, Microflow, Date); give "set": { "Attribute": "${latest}" }`);
            const v = `${ctx.varBase || "Error"}Log`;
            const acts = [{ action: "create", variable: ctx.unique(v), entity: onError.entity, set, commit: true }];
            if (onError.message !== undefined) acts.push({ action: "message", type: "Error", text: String(onError.message) });
            if (bool(onError.rethrow, false)) acts.push({ action: "error" });
            else acts.push(...tail);
            return { kind: "custom", pattern: name, rollback, returnValue: onError.returnValue, actions: acts };
        }
        case "retry": {
            const times = onError.times === undefined ? 3 : Number(onError.times);
            if (!Number.isInteger(times) || times < 2 || times > 20) throw new Error(`${where}: retry 'times' must be a whole number from 2 to 20 (the number of tries)`);
            return { kind: "retry", times, giveUp: [...log(onError.log || `${what} after ${times} tries`), { action: "error" }] };
        }
    }
    return null;
}

// The log steps of a recipe: a log action (microflow), a JavaScript action with a String parameter (nanoflow), or none
// (a nanoflow without such an action: the recipe shows its message only).
async function logSteps(ctx, o, where) {
    if (!ctx.nano) {
        return text => [{ action: "log", level: "Error", message: `${text}: {1}`, args: ["$latestError/Message"], stackTrace: true, ...(o.node !== undefined ? { node: o.node } : {}) }];
    }
    if (o.node !== undefined) throw new Error(`${where}: 'node' is for microflows (a nanoflow has no log action); use jsLog`);
    const js = o.jsLog !== undefined ? await ctx.jsLog(o.jsLog, where) : await ctx.defaultJsLog();
    if (!js) return () => [];
    return text => [{ action: "callJavaScript", jsAction: js.qn, args: { [js.param]: `'${String(text).replace(/'/g, "''")}: ' + $latestError` } }];
}

// Default members of an error log object: the attributes it has with these names (and a fitting type).
const ERROR_MEMBERS = [
    [/^(message|errormessage|text|description)$/i, "String", "$latestError/Message", "$latestError"],
    [/^(stacktrace|stack|trace)$/i, "String", "$latestError/Stacktrace", null],
    [/^(errortype|type)$/i, "String", "$latestError/ErrorType", null],
    [/^(microflow|flow|source|origin|location)$/i, "String", "QN", "QN"],
    [/^(date|datetime|timestamp|time|createdat|occurredat|loggedat)$/i, "DateTime", "[%CurrentDateTime%]", "[%CurrentDateTime%]"]
];
async function errorMembers(ctx, entity, where) {
    const attrs = await ctx.entityInfo(entity, where);
    const set = {};
    for (const [name, type] of attrs) {
        const hit = ERROR_MEMBERS.find(([re, t]) => re.test(name) && t === type);
        if (!hit) continue;
        const v = ctx.nano ? hit[3] : hit[2];
        if (v === null || Object.values(set).includes(v === "QN" ? `'${ctx.qn}'` : v)) continue;
        set[name] = v === "QN" ? `'${ctx.qn}'` : v;
    }
    return set;
}

// The retry recipe around one action spec: a counter, a while loop, the action (its error handler: give up after the
// last try, else the next try), break after it worked. No delay between the tries (Mendix has no wait action).
function retrySpecs(spec, r, counter, where, creates) {
    if (creates) throw new Error(`${where}: onError retry runs the action inside a loop, so $${creates} would only exist inside the loop; create the variable before it (action "variable") and fill it in a step after this one, or use "logAndShow"`);
    const action = { ...spec, onError: { rollback: false, actions: [{ action: "if", condition: `$${counter} >= ${r.times}`, then: r.giveUp, else: [{ action: "continue" }] }] } };
    return [
        { action: "variable", name: counter, type: "Integer", value: "0" },
        { action: "loop", while: `$${counter} < ${r.times}`, actions: [{ action: "set", name: counter, value: `$${counter} + 1` }, action, { action: "break" }] }
    ];
}

// ------------------------------------------------------------------------------------------------ scopes
// nodes: Map id -> { kind: "start" | "loop" | "note" | "other", loop: id of the loop it is in | null }
// flows: [ { from, to, error } ] (sequence flows)
// main: ids on the normal path (from the start event, and into loops on it); handlerOf: id -> id of the activity or
// loop whose custom error handler it is in (a handler path that joins the main flow again ends there);
// afterError: ids reachable from any error handler flow (also past where it joins the main flow).
function scopes(nodes, flows) {
    const out = new Map();
    const inc = new Set();
    for (const fl of flows) {
        if (!out.has(fl.from)) out.set(fl.from, []);
        out.get(fl.from).push(fl);
        inc.add(fl.to);
    }
    const entries = new Map();
    for (const [id, n] of nodes) {
        if (!n.loop || n.kind === "note" || inc.has(id)) continue;
        if (!entries.has(n.loop)) entries.set(n.loop, []);
        entries.get(n.loop).push(id);
    }
    // stop(id): not entered; exits: past the end of a loop body go on after the loop
    const reach = (starts, stop = () => false, exits = false) => {
        const seen = new Set();
        const todo = [...starts];
        while (todo.length) {
            const id = todo.pop();
            if (id === undefined || seen.has(id) || stop(id)) continue;
            seen.add(id);
            const n = nodes.get(id);
            if (n && n.kind === "loop") todo.push(...(entries.get(id) || []));
            if (exits && n && n.loop) todo.push(n.loop, ...(out.get(n.loop) || []).filter(f => !f.error).map(f => f.to));
            for (const fl of out.get(id) || []) if (!fl.error) todo.push(fl.to);
        }
        return seen;
    };
    const starts = [...nodes].filter(([, n]) => n.kind === "start").map(([id]) => id);
    const main = reach(starts);
    const handlerOf = new Map();
    let pending = flows.filter(f => f.error);
    for (let progress = true; progress && pending.length; ) {
        progress = false;
        for (const fl of [...pending]) {
            if (!main.has(fl.from) && !handlerOf.has(fl.from)) continue;
            pending = pending.filter(x => x !== fl);
            progress = true;
            for (const id of reach([fl.to], id => main.has(id) || handlerOf.has(id))) handlerOf.set(id, fl.from);
        }
    }
    const errorFlows = flows.filter(f => f.error);
    const afterError = reach(errorFlows.map(f => f.to), () => false, true);
    // everything that runs after one of the given steps (normal and error flows; past the end of a loop)
    const after = ids => reach(flows.filter(f => ids.has(f.from)).map(f => f.to), () => false, true);
    const chain = id => {
        const r = [];
        for (let x = handlerOf.get(id); x !== undefined && !r.includes(x); x = handlerOf.get(x)) r.push(x);
        return r;
    };
    return { main, handlerOf, afterError, after, chain, out, reach, errorFlows };
}

// On Model SDK objects of a flow document.
function sdkScopes(m) {
    const nodes = new Map();
    const walk = (coll, loop) => {
        for (const o of coll.objects) {
            nodes.set(o.id, { kind: o instanceof mf.StartEvent ? "start" : o instanceof mf.LoopedActivity ? "loop" : o instanceof mf.Annotation ? "note" : "other", loop, obj: o });
            if (o instanceof mf.LoopedActivity) walk(o.objectCollection, o.id);
        }
    };
    walk(m.objectCollection, null);
    const flows = [...m.flows].filter(x => x instanceof mf.SequenceFlow && x.origin && x.destination).map(x => ({ from: x.origin.id, to: x.destination.id, error: !!x.isErrorHandler, fl: x }));
    return { ...scopes(nodes, flows), nodes, flows };
}

// On a plain flow unit (exprlint, FLOW CHECK).
function plainScopes(unit) {
    const nodes = new Map();
    const walk = (coll, loop) => {
        for (const o of (coll && coll.Objects) || []) {
            const t = o.$Type;
            nodes.set(o.$ID, { kind: t === "Microflows$StartEvent" ? "start" : t === "Microflows$LoopedActivity" ? "loop" : t === "Microflows$Annotation" ? "note" : "other", loop, obj: o });
            if (o.ObjectCollection) walk(o.ObjectCollection, o.$ID);
        }
    };
    walk(unit.ObjectCollection, null);
    const flows = (unit.Flows || []).filter(f => f.$Type === "Microflows$SequenceFlow").map(f => ({ from: f.OriginPointer, to: f.DestinationPointer, error: !!f.IsErrorHandler }));
    return { ...scopes(nodes, flows), nodes, flows };
}

// $latestError / $latestSoapFault / $latestHttpResponse: the ids where each one has a value (plain unit).
const HTTP_ACTIONS = /^Microflows\$(RestCallAction|RestOperationCallAction|WebServiceCallAction|SendRestRequestAction)$/;
function latestScopes(unit) {
    const s = plainScopes(unit);
    const typeOf = id => {
        const o = (s.nodes.get(id) || {}).obj;
        return o && o.Action ? o.Action.$Type : o ? o.$Type : "";
    };
    const soapFrom = s.errorFlows.filter(f => typeOf(f.from) === "Microflows$WebServiceCallAction").map(f => f.to);
    const http = new Set([...s.nodes.keys()].filter(id => HTTP_ACTIONS.test(typeOf(id))));
    const httpAfter = s.after(http);
    // a REST call inside a loop: the whole loop body (the next tries) has the response too
    for (const id of http) for (let n = s.nodes.get(id); n && n.loop; n = s.nodes.get(n.loop)) for (const [x, m] of s.nodes) if (m.loop === n.loop) httpAfter.add(x);
    return { latestError: s.afterError, latestSoapFault: s.reach(soapFrom, () => false, true), latestHttpResponse: httpAfter };
}

// Uses of $latestError, $latestSoapFault and $latestHttpResponse outside string literals.
function latestUses(src) {
    const code = String(src).replace(/'(?:[^']|'')*'/g, "''");
    const out = new Set();
    for (const m of code.matchAll(/\$(latestError|latestSoapFault|latestHttpResponse)\b/g)) out.add(m[1]);
    return [...out];
}
const LATEST_WHERE = {
    latestError: "only on an error handler path (after the error flow of an action with a custom error handler)",
    latestSoapFault: "only on the error handler path of a call web service action",
    latestHttpResponse: "only after a REST call (call REST service / send REST request), on its normal or error handler path"
};

// ------------------------------------------------------------------------------------------------ FLOW CHECK
const CALLS_OUT = { "Microflows$RestCallAction": "REST call", "Microflows$WebServiceCallAction": "web service call", "Microflows$JavaActionCallAction": "Java action call", "Microflows$CallExternalAction": "external action call" };
const CUSTOM = /^Custom/;
const short = id => String(id).slice(0, 8);
const commits = a => !!a && (a.$Type === "Microflows$CommitAction" || ((a.$Type === "Microflows$CreateChangeAction" || a.$Type === "Microflows$ChangeAction") && /^Yes/.test(a.Commit || "")));

// Findings { level: "warning" | "note", id, text } over a plain flow unit. fresh(obj): only report on these objects
// (the dry run: new or changed steps); default all.
function flowCheck(unit, fresh = () => true) {
    const nano = unit.$Type === "Microflows$Nanoflow";
    if (!/^Microflows\$(Microflow|Nanoflow)$/.test(unit.$Type)) return [];
    const s = plainScopes(unit);
    const out = [];
    const say = (level, o, text) => fresh(o) && out.push({ level, id: o.$ID, text: `[${short(o.$ID)}] ${text}` });
    const ehOf = o => (o.Action ? o.Action.ErrorHandlingType : o.ErrorHandlingType) || "";
    // handled: its own error handling is custom or continue, or a loop around it has a custom handler
    const handled = id => {
        for (let x = id; x; x = (s.nodes.get(x) || {}).loop) {
            const o = s.nodes.get(x).obj;
            const eh = ehOf(o);
            if (CUSTOM.test(eh) || (x === id && eh === "Continue")) return true;
        }
        return false;
    };
    const inLoop = id => !!(s.nodes.get(id) || {}).loop;
    let nanoNote = false;
    for (const [id, n] of s.nodes) {
        const o = n.obj;
        const a = o.Action;
        const eh = ehOf(o);
        const kind = a && CALLS_OUT[a.$Type];
        if (kind && !nano && !handled(id) && !s.handlerOf.has(id))
            say("warning", o, `${kind} without a custom error handler: when it fails the whole microflow stops, rolls back, and the user sees a generic error. Give it "onError": "logAndShow" (or { "pattern": "retry" } / "rethrow" / { "pattern": "storeError", ... })`);
        if (commits(a) && inLoop(id) && !handled(id))
            say("note", o, `commits inside a loop without error handling: one failing commit stops the loop and rolls back every iteration. Collect the objects in a list (changeList) and commit the list once after the loop, or give the commit an "onError"`);
        if (!nano && eh === "CustomWithoutRollBack") {
            // steps that run before this one on the normal path and commit
            const earlier = [...s.nodes].some(([x, m]) => x !== id && commits(m.obj.Action) && !s.handlerOf.has(x) && s.reach([x]).has(id));
            if (earlier || commits(a)) say("note", o, `custom error handler without rollback: what was committed before it fails stays committed${commits(a) ? " (this step commits too)" : ""}; make sure the handler leaves the data consistent, or use "rollback": true`);
        }
        if (nano && (eh === "Custom" || eh === "Rollback") && (a || n.kind === "loop")) say("warning", o, `error handling '${eh}' in a nanoflow: ${NANO_ROLLBACK}`);
        if (nano && CUSTOM.test(eh) && !nanoNote && fresh(o)) {
            nanoNote = true;
            say("note", o, "nanoflow error handlers never roll back: objects changed before the error keep their changes (put a rollback action into the handler to undo them)");
        }
        if (o.$Type === "Microflows$ErrorEvent" && !s.handlerOf.has(id) && !s.afterError.has(id)) say("warning", o, "an error event outside an error handler: Studio Pro only allows it on an error handler path; use an end event, or move it into the handler");
    }
    return out;
}

// FLOW CHECK of the dry run: the flows a change created or changed, findings on new or changed objects only.
function flowCheckChanges(client) {
    const ch = client.changes;
    if (!ch) return [];
    const { toPlain } = require("./convert");
    const bson = require("./bson");
    const out = [];
    for (const id of [...new Set([...ch.updated, ...ch.created.keys()])].filter(x => !ch.deleted.has(x))) {
        let u;
        try {
            u = client.project.read(id);
        } catch (e) {
            continue;
        }
        if (!/^Microflows\$(Microflow|Nanoflow)$/.test(u.$Type)) continue;
        const old = new Map();
        if (!ch.created.has(id)) {
            try {
                const walk = o => {
                    if (Array.isArray(o)) return o.forEach(walk);
                    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
                    if (o.$ID && o.$Type) old.set(o.$ID, JSON.stringify(o));
                    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
                };
                walk(toPlain(bson.decode(client.project.readBytes(id))));
            } catch (e) {
                /* a new unit */
            }
        }
        const fresh = o => !old.has(o.$ID) || old.get(o.$ID) !== JSON.stringify(o);
        for (const f of flowCheck(u, fresh)) out.push(`${f.level === "note" ? "(note) " : "(warning) "}${client.label(id)} ${f.text}`);
    }
    return out;
}

module.exports = { normalize, retrySpecs, scopes, sdkScopes, plainScopes, latestScopes, latestUses, LATEST_WHERE, flowCheck, flowCheckChanges, PATTERNS, PATTERN_FIELDS, ON_ERROR_DOC, NANO_ROLLBACK };
