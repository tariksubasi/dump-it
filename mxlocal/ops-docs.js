"use strict";
// App documents of Studio Pro's "Add other" menu that have no op elsewhere: regular expressions (used by validation
// rules), task queues (a microflow or Java action call runs in one), and more below. None of them has a Studio
// Pro-saved sample in the test projects: each op warns "check it in Studio Pro" (first use) and the types are written
// from the SDK metamodel (structure type names as the SDK and mxcli name them).
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, enumValue } = require("./ops-util");
const { cmp } = require("./versions");

const { regularexpressions: rx, queues, microflows: mf, domainmodels: dm } = sdk;

const DOCS_OPS = {
    createRegularExpression: {
        doc: "Create a regular expression document (Java regex syntax) for validation rules: addValidationRule rule regex uses it.",
        fields: {
            module: "R module name", name: "R document name, e.g. EmailFormat", pattern: "R the regular expression, e.g. ^[0-9]{4} ?[A-Z]{2}$ (the whole value must match)",
            examples: "optional { \"valid\": [ \"text\" ], \"invalid\": [ \"text\" ] } checked against the pattern before anything is written", folder: "optional folder path"
        }
    },
    changeRegularExpression: {
        doc: "Change the pattern of a regular expression document; the dry run lists the validation rules that use it.",
        fields: { regularExpression: "R Module.RegularExpression", pattern: "R the new regular expression", examples: "optional { \"valid\": [ ... ], \"invalid\": [ ... ] } checked against the new pattern" }
    },
    createTaskQueue: {
        doc: "Create a task queue: microflow calls (call) and Java action calls (callJava) with \"queue\" run in the background on it, a few at a time.",
        fields: {
            module: "R module name", name: "R queue name, e.g. OrderQueue", threads: "optional how many run at once: a number or an expression like @Module.Constant (default 1)",
            scope: "optional node | cluster: threads per app node, or for the whole cluster (default node)", folder: "optional folder path"
        }
    },
    changeTaskQueue: {
        doc: "Change the threads or scope of a task queue; the dry run lists the calls that run in it.",
        fields: { queue: "R Module.Queue", threads: "optional number or expression", scope: "optional node | cluster" }
    }
};

// Field mistakes with a hint (merged into the op validation's synonyms).
const DOCS_SYNONYMS = {
    createRegularExpression: { regex: "the expression goes in \"pattern\"", expression: "the expression goes in \"pattern\"", value: "the expression goes in \"pattern\"" },
    changeRegularExpression: { regex: "the document goes in \"regularExpression\", the new expression in \"pattern\"", name: "the document goes in \"regularExpression\": Module.Name" },
    createTaskQueue: { parallelism: "use \"threads\"", clusterWide: "use \"scope\": \"cluster\"" },
    changeTaskQueue: { parallelism: "use \"threads\"", clusterWide: "use \"scope\": \"cluster\"", name: "the queue goes in \"queue\": Module.Queue" }
};

// Java regex constructs JavaScript does not parse; a pattern with them is checked by Studio Pro only.
const JAVA_ONLY = /\(\?[imsux-]+\)|\\[AZz]|[*+?}]\+|\\p\{(?:Alpha|Digit|Alnum|Upper|Lower|Punct|Space|L[ultmo]?|javaLowerCase)\}|\\Q|\\E/;

// Checks a pattern: { re (JS RegExp of a full match) or null when only Java parses it, note }.
function checkPattern(pattern, where) {
    if (typeof pattern !== "string" || !pattern) throw new Error(`${where}: pattern is the regular expression as text, e.g. "^[0-9]+$"`);
    if (/^\/.*\/[a-z]*$/.test(pattern)) throw new Error(`${where}: write the pattern without /slashes/ and flags: ${pattern.replace(/^\/|\/[a-z]*$/g, "")}`);
    try {
        return { re: new RegExp(`^(?:${pattern})$`, "u"), note: "" };
    } catch (e) {
        // without "u" JavaScript reads a stray { as a letter; Java refuses it ("Illegal repetition")
        const strayBrace = /(^|[^\\])\{(?!\d+(,\d*)?\})/.test(pattern.replace(/\[(?:\\.|[^\]])*\]/g, ""));
        try {
            if (strayBrace) throw e;
            return { re: new RegExp(`^(?:${pattern})$`), note: "" };
        } catch {
            if (JAVA_ONLY.test(pattern)) return { re: null, note: " (Java-only syntax: examples not checked, Studio Pro checks it)" };
            throw new Error(`${where}: '${pattern}' is not a valid regular expression: ${e.message.replace(/^Invalid regular expression: /, "")}`);
        }
    }
}

function checkExamples(re, examples, where) {
    if (examples === undefined || !re) return "";
    if (!examples || typeof examples !== "object" || Array.isArray(examples)) throw new Error(`${where}: examples is { "valid": [ "text" ], "invalid": [ "text" ] }`);
    for (const k of Object.keys(examples)) if (!["valid", "invalid"].includes(k)) fail(`${where}: unknown examples field '${k}'`, k, ["valid", "invalid"]);
    const bad = [];
    for (const v of [].concat(examples.valid || [])) if (!re.test(String(v))) bad.push(`"${v}" does not match but is in valid`);
    for (const v of [].concat(examples.invalid || [])) if (re.test(String(v))) bad.push(`"${v}" matches but is in invalid`);
    if (bad.length) throw new Error(`${where}: ${bad.join("; ")} (the whole value must match, as in a validation rule)`);
    const n = [].concat(examples.valid || []).length + [].concat(examples.invalid || []).length;
    return n ? `, ${n} example(s) checked` : "";
}

// Threads of a queue: a whole number of at least 1, or an expression (a constant).
function threadsExpression(v, where) {
    if (v === undefined) return "1";
    if (typeof v === "number" || /^\s*\d+\s*$/.test(String(v))) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: threads is a whole number of at least 1`);
        return String(n);
    }
    const s = String(v).trim();
    if (!s) throw new Error(`${where}: threads is a number or an expression like @Module.Constant`);
    return s;
}

const SCOPES = ["node", "cluster"];
function scopeOf(v, where) {
    const s = String(v).toLowerCase().replace(/[^a-z]/g, "");
    if (["node", "pernode", "local"].includes(s)) return false;
    if (["cluster", "clusterwide"].includes(s)) return true;
    return fail(`${where}: scope '${v}' is node or cluster`, v, SCOPES);
}

// "queue" / "retry" of a call action (call: the MicroflowCall, callJava: the JavaActionCallAction). Used by ops-flows.
// retry: { "retries": 3, "interval": 10, "unit": "Seconds" } (fixed) or { "retries", "initialInterval", "maximumInterval", "unit" } (exponential).
const RETRY_KEYS = ["retries", "interval", "initialInterval", "maximumInterval", "unit"];
async function setQueue(h, owner, spec, where) {
    const isJava = owner instanceof mf.JavaActionCallAction;
    if (spec.queue === undefined && spec.retry === undefined) return "";
    if (spec.queue === null || spec.queue === "" || spec.queue === "none") {
        if (owner.queueSettings) owner.queueSettings.delete();
        return "not in a task queue";
    }
    const old = owner.queueSettings;
    const qn = spec.queue === undefined ? old && old.queueQualifiedName : spec.queue;
    if (!qn) throw new Error(`${where}: retry needs a "queue": "Module.Queue"`);
    const q = await h.get(qn).catch(() => fail(`${where}: no task queue ${qn}${h.model.allQueues().length ? "" : " (the project has none: createTaskQueue)"}`, qn, h.model.allQueues().map(x => x.qualifiedName)));
    if (!(q instanceof queues.Queue)) throw new Error(`${where}: ${qn} is not a task queue (make one with createTaskQueue)`);
    const s = old || (isJava ? queues.QueueSettings.createInJavaActionCallActionUnderQueueSettings(owner) : queues.QueueSettings.createInMicroflowCallUnderQueueSettings(owner));
    s.queue = q;
    let what = `in task queue ${qn}`;
    if (spec.retry !== undefined) {
        if (s.retry) s.retry.delete();
        if (spec.retry && spec.retry !== "none") {
            const r = spec.retry;
            if (typeof r !== "object") throw new Error(`${where}: retry is { "retries": 3, "interval": 10, "unit": "Seconds" } or { "retries": 3, "initialInterval": 10, "maximumInterval": 600, "unit": "Seconds" }`);
            for (const k of Object.keys(r)) if (!RETRY_KEYS.includes(k)) fail(`${where}: unknown retry field '${k}'`, k, RETRY_KEYS);
            const num = (k, d) => {
                const n = r[k] === undefined ? d : Number(r[k]);
                if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: retry ${k} is a whole number of at least 1`);
                return n;
            };
            const exp = r.initialInterval !== undefined || r.maximumInterval !== undefined;
            if (exp && r.interval !== undefined) throw new Error(`${where}: retry has interval (fixed) or initialInterval + maximumInterval (exponential), not both`);
            const unit = enumValue(queues.QueueRetryIntervalType, r.unit || "Seconds", "retry unit");
            const t = exp ? queues.QueueExponentialRetry.create(h.model) : queues.QueueFixedRetry.create(h.model);
            t.retries = num("retries", 3);
            t.intervalType = unit;
            if (exp) {
                t.initialInterval = num("initialInterval", 10);
                t.maximumInterval = num("maximumInterval", 600);
                if (t.maximumInterval < t.initialInterval) throw new Error(`${where}: retry maximumInterval is smaller than initialInterval`);
            } else t.interval = num("interval", 10);
            s.retry = t;
            what += `, retry ${t.retries}x ${exp ? `${t.initialInterval}..${t.maximumInterval}` : t.interval} ${unit.name.toLowerCase()}`;
        }
    }
    h.client && h.client.warnFirst && h.client.warnFirst(`Queues$QueueSettings by ops (no Studio Pro sample in the test projects): check the queued call ${where} in Studio Pro`);
    return what;
}

// A queued call returns nothing to the caller (Studio Pro: CE error); the queued target's own rules.
function queuedCallProblem(spec, target, where) {
    if (spec.queue === undefined || spec.queue === null || spec.queue === "" || spec.queue === "none") return;
    if (spec.variable) throw new Error(`${where}: a call in a task queue runs later and returns nothing here; drop "variable" (store the result in the database inside ${target.qualifiedName})`);
}

function makeDocs(h) {
    const { model, get, exists, folder, version } = h;
    const atLeast = v => cmp(version, v) >= 0;
    const warn = w => h.client && h.client.warn(w);
    const firstUse = (type, qn) => warn(`${type} by ops (no Studio Pro sample in the test projects): check ${qn} in Studio Pro`);

    async function regexDoc(qn, where) {
        const all = () => model.allRegularExpressions().map(x => x.qualifiedName);
        const looksLikePattern = typeof qn === "string" && /[\^$\\[\]()*+?{}|]/.test(qn);
        if (looksLikePattern) throw new Error(`${where}: '${qn}' looks like a pattern; a regular expression document is used by name. Make one first: { "op": "createRegularExpression", "module": "...", "name": "...", "pattern": ${JSON.stringify(qn)} }`);
        const d = await get(qn).catch(() => fail(`${where}: no regular expression ${qn}${all().length ? "" : " (the project has none: createRegularExpression)"}`, qn, all()));
        if (!(d instanceof rx.RegularExpression)) throw new Error(`${where}: '${qn}' is not a regular expression document`);
        return d;
    }

    // Validation rules that use a regular expression document: [ "Module.Entity.Attr" ]
    async function regexUsers(qn) {
        const out = [];
        for (const d of model.allDomainModels()) {
            const dl = d.isLoaded ? d : await d.load();
            for (const e of dl.entities) for (const vr of e.validationRules) {
                if (vr.ruleInfo instanceof dm.RegExRuleInfo && vr.ruleInfo.regularExpressionQualifiedName === qn) out.push(`${e.qualifiedName}.${vr.attributeQualifiedName ? vr.attributeQualifiedName.split(".").pop() : "?"}`);
            }
        }
        return out;
    }

    async function queueOf(qn, where) {
        const all = () => model.allQueues().map(x => x.qualifiedName);
        const q = await get(qn).catch(() => fail(`${where}: no task queue ${qn}${all().length ? "" : " (the project has none: createTaskQueue)"}`, qn, all()));
        if (!(q instanceof queues.Queue)) throw new Error(`${where}: '${qn}' is not a task queue`);
        return q;
    }

    // Calls that run in a queue: [ "Module.Flow (call Module.Target)" ]
    async function queueUsers(qn) {
        const out = [];
        for (const m of model.allMicroflows()) {
            const ml = m.isLoaded ? m : await m.load();
            for (const a of ml.objectCollection.objects) {
                const act = a instanceof mf.ActionActivity ? a.action : null;
                const s = act instanceof mf.MicroflowCallAction ? act.microflowCall && act.microflowCall.queueSettings : act instanceof mf.JavaActionCallAction ? act.queueSettings : null;
                if (s && s.queueQualifiedName === qn) out.push(`${ml.qualifiedName} (${act instanceof mf.JavaActionCallAction ? act.javaActionQualifiedName : act.microflowCall.microflowQualifiedName})`);
            }
        }
        return out;
    }

    function setConfig(q, o, where) {
        const c = q.config instanceof queues.BasicQueueConfig ? q.config : queues.BasicQueueConfig.createIn(q);
        const lines = [];
        if (o.threads !== undefined || !(q.config && q.config.parallelismExpression)) {
            const t = threadsExpression(o.threads, where);
            if (atLeast("9.12.0")) c.parallelismExpression = t;
            else if (/^\d+$/.test(t)) c.parallelism = Number(t);
            else throw new Error(`${where}: threads as an expression needs Mendix 9.12 (this project is ${version}); give a number`);
            lines.push(`${t} thread(s)`);
        }
        if (o.scope !== undefined || !q.config) {
            const cw = o.scope === undefined ? false : scopeOf(o.scope, where);
            if (atLeast("9.13.0")) c.clusterWide = cw;
            else if (cw) throw new Error(`${where}: scope cluster needs Mendix 9.13 (this project is ${version})`);
            lines.push(cw ? "per cluster" : "per node");
        }
        return lines;
    }

    const impl = {
        async createRegularExpression(o) {
            validName(o.name, "regular expression name");
            const qn = `${o.module}.${o.name}`;
            const where = `createRegularExpression ${qn}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const { re, note } = checkPattern(o.pattern, where);
            const ex = checkExamples(re, o.examples, where);
            const d = rx.RegularExpression.createIn(folder(o.module, o.folder));
            d.name = o.name;
            d.regEx = o.pattern;
            firstUse("RegularExpressions$RegularExpression", qn);
            return `${qn}: ${o.pattern}${ex}${note}`;
        },
        async changeRegularExpression(o) {
            const where = `changeRegularExpression ${o.regularExpression}`;
            const d = await regexDoc(o.regularExpression, where);
            const { re, note } = checkPattern(o.pattern, where);
            const ex = checkExamples(re, o.examples, where);
            const old = d.regEx;
            d.regEx = o.pattern;
            const users = await regexUsers(d.qualifiedName);
            return `${d.qualifiedName}: ${old} -> ${o.pattern}${ex}${note}` + (users.length ? `\n      used by the validation rules of: ${users.join(", ")}` : "\n      no validation rule uses it yet (addValidationRule rule regex)");
        },
        async createTaskQueue(o) {
            validName(o.name, "task queue name");
            const qn = `${o.module}.${o.name}`;
            const where = `createTaskQueue ${qn}`;
            if (!atLeast("9.0.0")) throw new Error(`${where}: task queues need Mendix 9 (this project is ${version})`);
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            threadsExpression(o.threads, where);
            if (o.scope !== undefined) scopeOf(o.scope, where);
            const q = queues.Queue.createIn(folder(o.module, o.folder));
            q.name = o.name;
            const lines = setConfig(q, o, where);
            firstUse("Queues$Queue", qn);
            return `${qn} (${lines.join(", ")}); run a call in it: { "action": "call", "microflow": "...", "queue": "${qn}" }`;
        },
        async changeTaskQueue(o) {
            const where = `changeTaskQueue ${o.queue}`;
            const q = await queueOf(o.queue, where);
            if (o.threads === undefined && o.scope === undefined) throw new Error(`${where}: nothing to change (threads, scope)`);
            const lines = setConfig(q, o, where);
            const users = await queueUsers(q.qualifiedName);
            return `${q.qualifiedName}: ${lines.join(", ")}` + (users.length ? `\n      calls in it: ${users.join(", ")}` : "");
        }
    };

    const checks = {
        async createRegularExpression(o) {
            const d = await get(`${o.module}.${o.name}`).catch(() => null);
            return d instanceof rx.RegularExpression && d.regEx === o.pattern ? [] : [`${o.module}.${o.name} is not a regular expression with the pattern`];
        },
        async changeRegularExpression(o) {
            const d = await get(o.regularExpression);
            return d.regEx === o.pattern ? [] : [`${o.regularExpression} has pattern ${d.regEx}`];
        },
        async createTaskQueue(o) {
            const q = await get(`${o.module}.${o.name}`).catch(() => null);
            if (!(q instanceof queues.Queue) || !(q.config instanceof queues.BasicQueueConfig)) return [`${o.module}.${o.name} is not a task queue`];
            return checkConfig(q, o);
        },
        async changeTaskQueue(o) {
            return checkConfig(await get(o.queue), o);
        }
    };

    function checkConfig(q, o) {
        const c = q.config;
        const r = [];
        if (o.threads !== undefined && atLeast("9.12.0") && c.parallelismExpression !== threadsExpression(o.threads, "")) r.push(`${q.qualifiedName} threads ${c.parallelismExpression}`);
        if (o.scope !== undefined && atLeast("9.13.0") && c.clusterWide !== scopeOf(o.scope, "")) r.push(`${q.qualifiedName} scope ${c.clusterWide ? "cluster" : "node"}`);
        return r;
    }

    return { impl, checks, regexDoc };
}

// checkPlan: a later op of the plan that changes what this op made (only the final state is checked).
function docsChangedLater(name, o, rest) {
    if (name === "createRegularExpression") return rest.some(x => x.op === "changeRegularExpression" && x.regularExpression === `${o.module}.${o.name}`);
    if (name === "changeRegularExpression") return rest.some(x => x.op === "changeRegularExpression" && x.regularExpression === o.regularExpression);
    if (name === "createTaskQueue") return rest.some(x => x.op === "changeTaskQueue" && x.queue === `${o.module}.${o.name}`);
    if (name === "changeTaskQueue") return rest.some(x => x.op === "changeTaskQueue" && x.queue === o.queue);
    return false;
}

module.exports = { makeDocs, DOCS_OPS, DOCS_SYNONYMS, docsChangedLater, setQueue, queuedCallProblem, checkPattern };
