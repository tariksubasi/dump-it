"use strict";
// Keeps the agent docs in step with the code: every JSON example in docs/OPENCODE.md, agent/EDIT.txt and README.md
// must use real operations, actions and fields (with the required ones), and every operation and action must be
// described in docs/OPENCODE.md. Run: node mxlocal.js doccheck
const fs = require("fs");
const path = require("path");
const { OPS, ACTIONS } = require("./ops");
const { CONTROL, COMMON } = require("./ops-flows");
const { validate } = require("./ops-util");

const ROOT = path.join(__dirname, "..");
const DOCS = ["docs/OPENCODE.md", "agent/EDIT.txt", "README.md"];

// JSON change examples in a text: fenced ```json blocks, and { "ops": ... } objects written inline (EDIT.txt).
function examples(text) {
    const out = [];
    const fenced = /```json\n([\s\S]*?)```/g;
    let m;
    while ((m = fenced.exec(text))) out.push({ at: m.index, json: m[1] });
    for (let i = text.indexOf('{ "ops"'); i >= 0; i = text.indexOf('{ "ops"', i + 1)) {
        if (out.some(x => i >= x.at && i < x.at + x.json.length + 12)) continue;
        let depth = 0, j = i, inStr = false;
        for (; j < text.length; j++) {
            const c = text[j];
            if (inStr) {
                if (c === "\\") j++;
                else if (c === '"') inStr = false;
            } else if (c === '"') inStr = true;
            else if (c === "{" || c === "[") depth++;
            else if ((c === "}" || c === "]") && --depth === 0) break;
        }
        out.push({ at: i, json: text.slice(i, j + 1) });
    }
    return out;
}

function checkActions(list, where, problems) {
    for (const [i, a] of (list || []).entries()) {
        const w = `${where} action ${i + 1}`;
        const name = a && a.action;
        const spec = ACTIONS[name] || CONTROL[name];
        if (!spec) {
            problems.push(`${w}: unknown action '${name}'`);
            continue;
        }
        try {
            validate("action", name, ACTIONS[name] ? { fields: { ...spec.fields, ...COMMON } } : spec, a, w);
        } catch (e) {
            problems.push(e.message);
        }
        for (const k of ["actions", "then", "else", "other", "empty"]) if (Array.isArray(a[k])) checkActions(a[k], `${w}.${k}`, problems);
        if (a.cases && typeof a.cases === "object") for (const [k, list] of Object.entries(a.cases)) if (Array.isArray(list)) checkActions(list, `${w}.cases.${k}`, problems);
        if (a.onError && Array.isArray(a.onError.actions)) checkActions(a.onError.actions, `${w}.onError`, problems);
    }
}

function doccheck() {
    const problems = [];
    let count = 0;
    for (const rel of DOCS) {
        const file = path.join(ROOT, rel);
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const ex of examples(text)) {
            const line = text.slice(0, ex.at).split("\n").length;
            const where = `${rel}:${line}`;
            let plan;
            try {
                plan = JSON.parse(ex.json);
            } catch (e) {
                // a schema line like { "op": "<name>", ...fields } is not an example
                if (/"op"\s*:/.test(ex.json) && !/\.\.\./.test(ex.json)) problems.push(`${where}: not valid JSON (${e.message})`);
                continue;
            }
            const ops = Array.isArray(plan) ? plan : plan && Array.isArray(plan.ops) ? plan.ops : plan && plan.op ? [plan] : null;
            if (!ops) continue;
            count++;
            for (const [i, o] of ops.entries()) {
                const w = `${where} op ${i + 1}`;
                if (!OPS[o.op]) {
                    problems.push(`${w}: unknown op '${o.op}'`);
                    continue;
                }
                try {
                    validate("op", o.op, OPS[o.op], o, w);
                } catch (e) {
                    problems.push(e.message);
                }
                checkActions(o.actions, w, problems);
            }
        }
    }
    const manual = fs.readFileSync(path.join(ROOT, "docs/OPENCODE.md"), "utf8");
    for (const name of [...Object.keys(OPS), ...Object.keys(ACTIONS), ...Object.keys(CONTROL)]) {
        if (!manual.includes("`" + name + "`")) problems.push(`docs/OPENCODE.md does not describe \`${name}\``);
    }
    return { count, problems };
}

module.exports = { doccheck, examples };
