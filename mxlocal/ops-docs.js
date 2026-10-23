"use strict";
// App documents of Studio Pro's "Add other" menu that have no op elsewhere: regular expressions (used by validation
// rules), task queues (a microflow or Java action call runs in one), and more below. None of them has a Studio
// Pro-saved sample in the test projects: each op warns "check it in Studio Pro" (first use) and the types are written
// from the SDK metamodel (structure type names as the SDK and mxcli name them).
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, enumValue } = require("./ops-util");
const { cmp } = require("./versions");

const { regularexpressions: rx, queues, microflows: mf, domainmodels: dm, images, customicons: ci } = sdk;
const fs = require("fs");
const path = require("path");

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
    deleteImage: {
        doc: "Delete an image from an image collection; lists the widgets, buttons and enumeration values that still show it. (Replace an image: addImage with \"replace\": true.)",
        fields: { image: "R Module.Collection.Image" }
    },
    importIconCollection: {
        doc: "Import a custom icon collection (icon font) from a .ttf/.otf file and a name -> character code map; the icons are used like Atlas icons (icon fields: Module.Collection.icon).",
        fields: {
            module: "R module name", name: "R collection name, e.g. BrandIcons", font: "R path of the .ttf or .otf file inside the export folder, e.g. edits/brand.ttf",
            icons: "R path of a JSON file, or the map itself: { \"home\": \"e900\", \"cart\": 59649 } (hex or number); an IcoMoon selection.json works too",
            prefix: "optional CSS class prefix of the icons (default the collection name in lower case)", class: "optional CSS class of the collection (default prefix-icons)",
            tags: "optional { \"home\": [ \"house\" ] } search words in Studio Pro", folder: "optional folder path"
        }
    },
    createDocumentTemplate: {
        doc: "NOT SUPPORTED (refused with the Studio Pro steps): create a document template for the generateDocument action (document templates are deprecated).",
        fields: { module: "optional module name", name: "optional", widgets: "optional", header: "optional", footer: "optional", folder: "optional" }
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
    deleteImage: { name: "the image goes in \"image\": Module.Collection.Image", collection: "the image goes in \"image\": Module.Collection.Image" },
    importIconCollection: { file: "the font goes in \"font\", the name -> code map in \"icons\"", map: "the name -> code map goes in \"icons\"" },
    createTaskQueue: { parallelism: "use \"threads\"", clusterWide: "use \"scope\": \"cluster\"" },
    changeTaskQueue: { parallelism: "use \"threads\"", clusterWide: "use \"scope\": \"cluster\"", name: "the queue goes in \"queue\": Module.Queue" }
};

const DOCUMENT_TEMPLATE_WHY = "Document templates are deprecated in Studio Pro, and no test project has one: every widget of a template stores a style with colors (DocumentTemplates$Style.FontColor, BackgroundColor, border colors), a value type with no Studio Pro sample anywhere, so ops cannot write one Studio Pro is sure to load. In Studio Pro: right-click the module > Add other > Document template, add a data view or data grid (its name is the parameter), then call it with the 'Generate document' action (generateDocument works in projects that already use that action). For new work use the Document Generation module from the Marketplace (PDF from a page). Record it with: mx.py gap \"createDocumentTemplate\"";

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

// Character codes of a TrueType / OpenType font (its cmap: format 4 and 12 subtables). null when it cannot be read.
function fontCodes(buf) {
    try {
        const n = buf.readUInt16BE(4);
        let cmap = -1;
        for (let i = 0; i < n; i++) if (buf.toString("latin1", 12 + i * 16, 16 + i * 16) === "cmap") cmap = buf.readUInt32BE(12 + i * 16 + 8);
        if (cmap < 0) return null;
        const codes = new Set();
        const subs = buf.readUInt16BE(cmap + 2);
        for (let i = 0; i < subs; i++) {
            const at = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
            const format = buf.readUInt16BE(at);
            if (format === 4) {
                const segs = buf.readUInt16BE(at + 6) / 2;
                for (let k = 0; k < segs; k++) {
                    const end = buf.readUInt16BE(at + 14 + k * 2);
                    const start = buf.readUInt16BE(at + 16 + segs * 2 + k * 2);
                    if (start === 0xffff) continue;
                    for (let c = start; c <= end && end - start < 70000; c++) codes.add(c);
                }
            } else if (format === 12) {
                const groups = buf.readUInt32BE(at + 12);
                for (let k = 0; k < groups; k++) {
                    const start = buf.readUInt32BE(at + 16 + k * 12);
                    const end = buf.readUInt32BE(at + 20 + k * 12);
                    for (let c = start; c <= end && end - start < 70000; c++) codes.add(c);
                }
            }
        }
        return codes;
    } catch {
        return null;
    }
}

// { name: code } from { "home": "e900" | 59648 | "\ue900" } or an IcoMoon selection.json.
function iconMap(raw, where) {
    if (raw && Array.isArray(raw.icons)) {
        const out = {};
        for (const ic of raw.icons) {
            const p = ic.properties || {};
            for (const n of String(p.name || "").split(",").map(x => x.trim()).filter(Boolean)) out[n] = p.code;
        }
        return iconMap(out, where);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${where}: icons is { "home": "e900", ... } or a JSON file with that map`);
    const out = {};
    for (const [n, v] of Object.entries(raw)) {
        let code = typeof v === "number" ? v : /^(0x|u\+|\\u|&#x)?[0-9a-f]{2,6};?$/i.test(String(v)) ? parseInt(String(v).replace(/^(0x|u\+|\\u|&#x)/i, ""), 16) : [...String(v)].length === 1 ? String(v).codePointAt(0) : NaN;
        if (!Number.isInteger(code) || code < 32 || code > 0x10ffff) throw new Error(`${where}: icon ${n}: '${v}' is not a character code (hex like "e900" or a number)`);
        const name = String(n).trim();
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`${where}: icon name '${n}': letters, digits, - and _`);
        out[name] = code;
    }
    if (!Object.keys(out).length) throw new Error(`${where}: icons is empty`);
    return out;
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

    async function imageOf(qn, where) {
        const parts = String(qn).split(".");
        if (parts.length !== 3) throw new Error(`${where}: image is Module.Collection.Image, e.g. MyFirstModule.Images.logo`);
        const cols = model.allImageCollections();
        const c = cols.find(x => x.qualifiedName === parts.slice(0, 2).join("."));
        if (!c) fail(`${where}: no image collection ${parts.slice(0, 2).join(".")}`, parts.slice(0, 2).join("."), cols.map(x => x.qualifiedName));
        const full = c.isLoaded ? c : await c.load();
        const img = full.images.find(x => x.name === parts[2]);
        if (!img) fail(`${where}: ${full.qualifiedName} has no image '${parts[2]}'`, parts[2], full.images.map(x => x.name));
        return img;
    }

    function exportFile(file, where) {
        const f = h.client && h.client.changeFile;
        const dir = f ? path.dirname(f) : process.cwd();
        const base = path.basename(dir) === "edits" ? path.dirname(dir) : dir;
        const full = path.resolve(base, String(file));
        const rel = path.relative(base, full);
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${where}: file '${file}' is outside the export folder (${base}); copy it into the export folder (e.g. edits/) first`);
        if (!fs.existsSync(full)) fail(`${where}: no file '${file}'`, path.basename(full), fs.existsSync(path.dirname(full)) ? fs.readdirSync(path.dirname(full)) : []);
        return full;
    }

    const impl = {
        async createDocumentTemplate() {
            throw new Error(`createDocumentTemplate is not supported. ${DOCUMENT_TEMPLATE_WHY}`);
        },
        async importIconCollection(o) {
            validName(o.name, "icon collection name");
            const qn = `${o.module}.${o.name}`;
            const where = `importIconCollection ${qn}`;
            if (!atLeast("9.22.0")) throw new Error(`${where}: custom icon collections need Mendix 9.22 (this project is ${version})`);
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const font = fs.readFileSync(exportFile(o.font, where));
            const magic = font.slice(0, 4).toString("hex");
            if (["774f4646", "774f4632"].includes(magic)) throw new Error(`${where}: ${o.font} is a WOFF web font; give the .ttf (or .otf) of the icon font`);
            if (!["00010000", "4f54544f", "74727565"].includes(magic)) throw new Error(`${where}: ${o.font} is not a TrueType or OpenType font (by its content)`);
            if (font.length > 2 * 1048576) throw new Error(`${where}: ${o.font} is ${(font.length / 1048576).toFixed(1)} MB; an icon font is at most 2 MB`);
            let raw = o.icons;
            if (typeof raw === "string") {
                try {
                    raw = JSON.parse(fs.readFileSync(exportFile(raw, where), "utf8"));
                } catch (e) {
                    if (/JSON|Unexpected/.test(e.message)) throw new Error(`${where}: ${o.icons} is not JSON: ${e.message}`);
                    throw e;
                }
            }
            const map = iconMap(raw, where);
            const codes = fontCodes(font);
            const missing = codes ? Object.entries(map).filter(([, c]) => !codes.has(c)) : [];
            if (missing.length) throw new Error(`${where}: the font has no glyph for ${missing.slice(0, 8).map(([n, c]) => `${n} (${c.toString(16)})`).join(", ")}${missing.length > 8 ? ", ..." : ""}; check the map`);
            const dup = Object.entries(map).filter(([, c], i, all) => all.findIndex(x => x[1] === c) !== i);
            const tags = o.tags || {};
            for (const n of Object.keys(tags)) if (!(n in map)) fail(`${where}: tags: no icon '${n}'`, n, Object.keys(map));
            const prefix = o.prefix === undefined ? o.name.toLowerCase() : String(o.prefix);
            if (!/^[a-z_-][a-z0-9_-]*$/i.test(prefix)) throw new Error(`${where}: prefix '${prefix}' is not a CSS class name`);
            const c = ci.CustomIconCollection.createIn(folder(o.module, o.folder));
            c.name = o.name;
            c.prefix = prefix;
            c.collectionClass = o.class === undefined ? `${prefix}-icons` : String(o.class);
            c.fontData = font.toString("base64");
            for (const [n, code] of Object.entries(map)) {
                const ic = ci.CustomIcon.createIn(c);
                ic.name = n;
                ic.characterCode = code;
                for (const t of [].concat(tags[n] || [])) ic.tags.push(String(t));
            }
            return `${qn}: ${Object.keys(map).length} icon(s), font ${Math.ceil(font.length / 1024)} KB, class ${c.collectionClass}, icons as ${prefix}-<name>` + (codes ? "" : " (glyphs not checked: the font's character map could not be read)") + (dup.length ? `\n      NOTE: same code for ${dup.map(([n]) => n).join(", ")}` : "");
        },
        async deleteImage(o) {
            const where = `deleteImage ${o.image}`;
            const img = await imageOf(o.image, where);
            const users = h.client && h.client.referencesTo ? h.client.referencesTo(o.image) : [];
            img.delete();
            return o.image + (users.length ? `\n      STILL USED BY (fix these, or Studio Pro shows errors; pick another image with changeWidget / changeEnumerationValue): ${users.join(", ")}` : "");
        },
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
        async createDocumentTemplate() {
            return [];
        },
        async importIconCollection(o) {
            const c = await get(`${o.module}.${o.name}`).catch(() => null);
            return c instanceof ci.CustomIconCollection && c.icons.length && c.fontData ? [] : [`${o.module}.${o.name} is not an icon collection with icons and a font`];
        },
        async deleteImage(o) {
            return (await imageOf(o.image, "").then(() => true, () => false)) ? [`${o.image} still exists`] : [];
        },
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
    const deleted = rest.filter(x => x.op === "deleteImage").map(x => x.image);
    if (name === "addImage" && deleted.includes(`${o.collection}.${o.name || ""}`)) return true;
    if (name === "changeEnumerationValue" && o.image && deleted.includes(o.image)) return true;
    if (name === "createRegularExpression") return rest.some(x => x.op === "changeRegularExpression" && x.regularExpression === `${o.module}.${o.name}`);
    if (name === "changeRegularExpression") return rest.some(x => x.op === "changeRegularExpression" && x.regularExpression === o.regularExpression);
    if (name === "createTaskQueue") return rest.some(x => x.op === "changeTaskQueue" && x.queue === `${o.module}.${o.name}`);
    if (name === "changeTaskQueue") return rest.some(x => x.op === "changeTaskQueue" && x.queue === o.queue);
    return false;
}

module.exports = { makeDocs, DOCS_OPS, DOCS_SYNONYMS, docsChangedLater, setQueue, queuedCallProblem, checkPattern, fontCodes, iconMap };
