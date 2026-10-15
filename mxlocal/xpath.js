"use strict";
// Mendix XPath constraints: tokenizer, parser and checker against the domain model. Used by exprlint.js for retrieves,
// list/grid/gallery/data grid 2 data sources, selectors, access rules, offline constraints and workflow targeting.
//
//   checkXPath("[Module.Order_Customer/Module.Customer/Name = 'x']", "Module.Order", ctx) -> { problems: [{ level, msg }] }
//
// ctx: the same shape as for expr.js (variable(name), variables(), strictVariables, model). Paths start at the
// constrained entity: Attribute | Module.Association / Module.Entity / ... (either direction; [reversed()] for an
// association from an entity to itself), System.owner / System.changedBy, id; functions contains, starts-with,
// ends-with, not, true, false, *-from-dateTime, string-length; [%Token%]s; $Variables (and $Var/Member).
const { distance } = require("./ops-util");
const { suggest, T, show, tokenType, isNum, known, walkPath } = require("./expr");

class XPathSyntax extends Error {}

const FUNCS = {
    contains: { args: [2, 2], ret: T.bool, str: true },
    "starts-with": { args: [2, 2], ret: T.bool, str: true },
    "ends-with": { args: [2, 2], ret: T.bool, str: true },
    "string-length": { args: [1, 1], ret: T.int, str: true },
    not: { args: [1, 1], ret: T.bool },
    true: { args: [0, 0], ret: T.bool },
    false: { args: [0, 0], ret: T.bool },
    "year-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "month-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "day-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "hours-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "minutes-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "seconds-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "quarter-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "day-of-year-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "weekday-from-dateTime": { args: [1, 2], ret: T.int, date: true },
    "week-from-dateTime": { args: [1, 2], ret: T.int, date: true }
};
const FUNC_NAMES = Object.keys(FUNCS);

function lex(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        const at = i;
        if (c === "'" || c === '"') {
            let s = "";
            i++;
            for (;;) {
                if (i >= n) throw new XPathSyntax(`text started at position ${at + 1} has no closing ${c}`);
                if (src[i] === c) {
                    if (src[i + 1] === c) {
                        s += c;
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                s += src[i++];
            }
            const tok = /^\[%([^%]+)%\]$/.exec(s);
            out.push(tok ? { k: "token", v: tok[1], at, quoted: true } : { k: "str", v: s, at });
            continue;
        }
        if (c === "[" && src[i + 1] === "%") {
            const end = src.indexOf("%]", i + 2);
            if (end < 0) throw new XPathSyntax(`token [% at position ${at + 1} has no closing %]`);
            out.push({ k: "token", v: src.slice(i + 2, end), at });
            i = end + 2;
            continue;
        }
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
            const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
            out.push({ k: "num", v: m[0], at });
            i += m[0].length;
            continue;
        }
        if (c === "$") {
            const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i));
            if (!m) throw new XPathSyntax(`'$' at position ${at + 1} is not followed by a variable name`);
            out.push({ k: "var", v: m[1], at });
            i += m[0].length;
            continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            let m = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/.exec(src.slice(i))[0];
            // function names with hyphens (starts-with, year-from-dateTime)
            const h = /^[A-Za-z_][\w-]*/.exec(src.slice(i))[0];
            if (h.includes("-") && FUNCS[h] !== undefined) m = h;
            else if (h.includes("-")) {
                const fn = FUNC_NAMES.find(f => h.startsWith(f) && src[i + f.length] !== "-");
                if (fn && /^\s*\(/.test(src.slice(i + fn.length))) m = fn;
                else if (/^\s*\(/.test(src.slice(i + h.length))) m = h; // unknown hyphenated function: reported later
            }
            out.push({ k: "name", v: m, at });
            i += m.length;
            continue;
        }
        const two = src.slice(i, i + 2);
        if (["!=", "<=", ">="].includes(two)) {
            out.push({ k: "op", v: two, at });
            i += 2;
            continue;
        }
        if ("[]()/=<>,+-*".includes(c)) {
            out.push({ k: "op", v: c, at });
            i++;
            continue;
        }
        throw new XPathSyntax(`unexpected character '${c}' at position ${at + 1}`);
    }
    out.push({ k: "end", v: "", at: n });
    return out;
}

// AST: { k: "or"|"and", l, r } | { k: "cmp", op, l, r } | { k: "arith", op, l, r } | { k: "neg", e }
//      | { k: "path", steps: [{ name, at, preds: [ast], reversed }] } | { k: "fn", name, args } | { k: "str"|"num"|"token"|"var"|"empty" }
function parse(src) {
    const toks = lex(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = v => peek().k === "op" && peek().v === v;
    const isWord = v => peek().k === "name" && peek().v === v;
    const describe = t => (t.k === "end" ? "the end" : `'${t.k === "str" ? `'${t.v}'` : t.k === "var" ? "$" + t.v : t.v}' at position ${t.at + 1}`);
    const expectOp = v => {
        if (!isOp(v)) throw new XPathSyntax(`expected '${v}' but found ${describe(peek())}`);
        return next();
    };

    function orExpr() {
        let l = andExpr();
        while (isWord("or")) {
            next();
            l = { k: "or", l, r: andExpr() };
        }
        return l;
    }
    function andExpr() {
        let l = cmpExpr();
        while (isWord("and")) {
            next();
            l = { k: "and", l, r: cmpExpr() };
        }
        return l;
    }
    function cmpExpr() {
        const l = addExpr();
        if (peek().k === "op" && ["=", "!=", "<", "<=", ">", ">="].includes(peek().v)) {
            const t = next();
            return { k: "cmp", op: t.v, l, r: addExpr(), at: t.at };
        }
        return l;
    }
    function addExpr() {
        let l = mulExpr();
        while (isOp("+") || isOp("-")) {
            const t = next();
            l = { k: "arith", op: t.v, l, r: mulExpr() };
        }
        return l;
    }
    function mulExpr() {
        let l = unary();
        while (isOp("*") || isWord("div") || isWord("mod")) {
            const t = next();
            l = { k: "arith", op: t.v, l, r: unary() };
        }
        return l;
    }
    function unary() {
        if (isOp("-")) {
            next();
            return { k: "neg", e: unary() };
        }
        return primary();
    }
    function step(t) {
        const s = { name: t.v, at: t.at, preds: [], reversed: false };
        while (isOp("[")) {
            next();
            if (isWord("reversed") && toks[p + 1].k === "op" && toks[p + 1].v === "(") {
                next();
                expectOp("(");
                expectOp(")");
                expectOp("]");
                s.reversed = true;
                continue;
            }
            s.preds.push(orExpr());
            expectOp("]");
        }
        return s;
    }
    function primary() {
        const t = next();
        switch (t.k) {
            case "str":
                return { k: "str", v: t.v, at: t.at };
            case "num":
                return { k: "num", v: t.v, at: t.at };
            case "token":
                return { k: "token", v: t.v, at: t.at, quoted: t.quoted };
            case "var": {
                const steps = [];
                while (isOp("/")) {
                    next();
                    const s = next();
                    if (s.k !== "name") throw new XPathSyntax(`expected a member after '/' but found ${describe(s)}`);
                    steps.push({ name: s.v, at: s.at });
                }
                return { k: "var", name: t.v, path: steps, at: t.at };
            }
            case "op":
                if (t.v === "(") {
                    const e = orExpr();
                    expectOp(")");
                    return e;
                }
                throw new XPathSyntax(`unexpected ${describe(t)}`);
            case "name": {
                if (t.v === "empty" || t.v === "NULL") return { k: "empty" };
                if (isOp("(")) {
                    next();
                    const args = [];
                    if (!isOp(")")) {
                        args.push(orExpr());
                        while (isOp(",")) {
                            next();
                            args.push(orExpr());
                        }
                    }
                    expectOp(")");
                    return { k: "fn", name: t.v, args, at: t.at };
                }
                if (["and", "or", "div", "mod"].includes(t.v)) throw new XPathSyntax(`unexpected '${t.v}' at position ${t.at + 1}`);
                const steps = [step(t)];
                while (isOp("/")) {
                    next();
                    const s = next();
                    if (s.k !== "name") throw new XPathSyntax(`expected an association, entity or attribute after '/' but found ${describe(s)}`);
                    steps.push(step(s));
                }
                return { k: "path", steps, at: t.at };
            }
            default:
                throw new XPathSyntax(`unexpected ${describe(t)}`);
        }
    }

    const constraints = [];
    if (peek().k === "end") return constraints;
    if (isOp("/") && toks[p + 1] && toks[p + 1].v === "/") throw new XPathSyntax("give only the constraint ([...]), not //Module.Entity");
    while (peek().k !== "end") {
        if (!isOp("[")) throw new XPathSyntax(`a constraint starts with '[' (found ${describe(peek())})`);
        next();
        if (isOp("]")) throw new XPathSyntax("empty constraint []");
        constraints.push(orExpr());
        expectOp("]");
    }
    return constraints;
}

// ------------------------------------------------------------------------------------------------ check
function checkXPath(src, entityQn, ctx) {
    const problems = [];
    const add = (level, msg) => problems.push({ level, msg });
    const model = ctx.model;
    let constraints;
    try {
        constraints = parse(String(src));
    } catch (e) {
        if (!(e instanceof XPathSyntax)) throw e;
        return { problems: [{ level: "error", msg: `syntax: ${e.message}` }] };
    }
    if (entityQn && !model.entity(entityQn) && !model.unknownEntity(entityQn)) return { problems };
    const root = entityQn ? T.obj(entityQn) : T.any;

    // A path from an entity. Returns the type at its end: an attribute type, Object(E) after an association/entity
    // step (a reference compared with an object or tested for existence).
    function path(n, from) {
        let cur = from;
        let viaAssoc = null;
        for (let i = 0; i < n.steps.length; i++) {
            const s = n.steps[i];
            const shown = n.steps.slice(0, i + 1).map(x => x.name).join("/");
            if (!known(cur) || !cur.e || model.unknownEntity(cur.e)) {
                for (const pr of s.preds) value(pr, T.any);
                cur = T.any;
                continue;
            }
            const ent = cur.e;
            if (s.name === "id") {
                if (i < n.steps.length - 1) add("error", `${shown}: nothing can follow 'id'`);
                return T.obj(ent);
            }
            if (s.name.includes(".")) {
                const asc = model.association(s.name);
                if (asc) {
                    let dir = model.direction(asc, ent);
                    if (asc.parent === asc.child && s.reversed) dir = "reverse";
                    else if (s.reversed && asc.parent !== asc.child) add("warning", `${shown}: [reversed()] is only needed on an association from an entity to itself`);
                    if (!dir) {
                        const sg = suggest(s.name, model.associationsOf(ent, true).map(a => a.qn), 3);
                        add("error", `${shown}: ${s.name} connects ${asc.parent} and ${asc.child}, not ${ent}` + (sg.length ? `. Did you mean: ${sg.join(", ")}?` : ""));
                        return T.any;
                    }
                    const other = dir === "forward" ? asc.child : asc.parent;
                    cur = T.obj(other);
                    viaAssoc = s.name;
                    for (const pr of s.preds) value(pr, T.any, cur);
                    continue;
                }
                const target = model.entity(s.name) || model.unknownEntity(s.name) ? s.name : null;
                if (target) {
                    if (!viaAssoc) add("error", `${shown}: an entity (${s.name}) can only follow an association`);
                    else if (!model.isA(s.name, ent) && !model.isA(ent, s.name) && !model.unknownEntity(s.name)) add("error", `${shown}: ${viaAssoc} leads to ${ent}, not ${s.name}`);
                    cur = T.obj(model.isA(s.name, ent) || model.unknownEntity(s.name) ? s.name : ent);
                    viaAssoc = null;
                    for (const pr of s.preds) value(pr, T.any, cur);
                    continue;
                }
                const opts = model.associationsOf(ent, true).map(a => a.qn);
                const sg = suggest(s.name, viaAssoc ? model.entityNames() : opts, 3);
                add(/^System\./.test(s.name) ? "warning" : "error", viaAssoc ? `${shown}: unknown entity ${s.name}` + (sg.length ? `. Did you mean: ${sg.join(", ")}?` : "")
                    : `${shown}: ${ent} has no association '${s.name}'` + (sg.length ? `. Did you mean: ${sg.join(", ")}?` : opts.length ? "" : ` (${ent} has no associations)`));
                return T.any;
            }
            if (viaAssoc) {
                // Mendix wants the entity between an association and an attribute: Assoc/Module.Entity/Attribute
                add("error", `${shown}: after the association ${viaAssoc} comes the entity (${viaAssoc}/${ent}/${s.name})`);
                viaAssoc = null;
            }
            const a = model.attribute(ent, s.name);
            if (!a) {
                const sg = suggest(s.name, model.attributeNames(ent), 3);
                add(model.partial(ent) ? "warning" : "error", `${shown}: ${ent} has no attribute '${s.name}'` + (sg.length ? `. Did you mean: ${sg.join(", ")}?` : ""));
                return T.any;
            }
            if (i < n.steps.length - 1) {
                add("error", `${shown}: '${s.name}' is an attribute; nothing can follow it`);
                return T.any;
            }
            return a.type;
        }
        return cur;
    }

    function variable(n) {
        let t = ctx.variable(n.name);
        if (n.name === "currentObject" && ctx.currentObject !== undefined) t = ctx.currentObject;
        if (t === undefined) {
            const s = suggest(n.name, ctx.variables(), 3);
            add(ctx.strictVariables ? "error" : "warning", `$${n.name} is not a parameter or variable here` + (s.length ? `. Did you mean: ${s.map(x => "$" + x).join(", ")}?` : ""));
            return T.any;
        }
        if (!n.path.length) return t;
        const r = walkPath(t, n.path, model, "$" + n.name);
        problems.push(...r.problems);
        return r.type;
    }

    // Type of a value node. ctxEnt: the entity paths start from.
    function value(n, expect, ctxEnt = root) {
        switch (n.k) {
            case "or":
            case "and":
                cond(n.l, ctxEnt);
                cond(n.r, ctxEnt);
                return T.bool;
            case "cmp":
                compare(n, ctxEnt);
                return T.bool;
            case "arith": {
                const l = value(n.l, T.any, ctxEnt);
                const r = value(n.r, T.any, ctxEnt);
                for (const x of [l, r]) if (known(x) && !isNum(x) && x.t !== "DateTime") add("error", `'${n.op}' needs numbers or dates, got ${show(x)}`);
                return l.t === "DateTime" || r.t === "DateTime" ? T.date : isNum(l) ? l : r;
            }
            case "neg":
                return value(n.e, T.any, ctxEnt);
            case "str":
                return T.str;
            case "num":
                return /\./.test(n.v) ? T.dec : T.long;
            case "empty":
                return T.empty;
            case "token": {
                const r = tokenType(n.v, model);
                if (r.problem) add(r.problem.level, r.problem.msg);
                return r.type;
            }
            case "var":
                return variable(n);
            case "path":
                return path(n, ctxEnt);
            case "fn":
                return fn(n, ctxEnt);
            default:
                return T.any;
        }
    }

    function fn(n, ctxEnt) {
        const f = FUNCS[n.name];
        if (!f) {
            const s = suggest(n.name, FUNC_NAMES, 3);
            const close = s.length && distance(s[0], n.name) <= 2;
            add(close ? "error" : "warning", `unknown XPath function ${n.name}(...)` + (s.length ? `. Did you mean: ${s.join(", ")}?` : "") + (close ? "" : " (fine if your Mendix version has it)"));
            n.args.forEach(a => value(a, T.any, ctxEnt));
            return T.any;
        }
        if (n.args.length < f.args[0] || n.args.length > f.args[1]) add("error", `${n.name}(...) takes ${f.args[0] === f.args[1] ? f.args[0] : `${f.args[0]} or ${f.args[1]}`} argument${f.args[1] === 1 ? "" : "s"}, got ${n.args.length}`);
        if (n.name === "not") {
            if (n.args[0]) cond(n.args[0], ctxEnt);
            return T.bool;
        }
        const types = n.args.map(a => value(a, T.any, ctxEnt));
        if (f.str && types[0] && known(types[0]) && types[0].t !== "String") add("error", `${n.name}(...): ${show(types[0])} is not a String attribute`);
        if (f.str && types[1] && known(types[1]) && !["String", "Empty"].includes(types[1].t)) add("error", `${n.name}(...): the second argument is ${show(types[1])}, expected a text`);
        if (f.date && types[0] && known(types[0]) && types[0].t !== "DateTime") add("error", `${n.name}(...): ${show(types[0])} is not a DateTime attribute`);
        return f.ret;
    }

    // A condition: Boolean expression, or a path tested for existence ([Module.Assoc/Module.Entity]).
    function cond(n, ctxEnt = root) {
        const t = value(n, T.bool, ctxEnt);
        if (n.k === "path" && t.t === "Object") return; // existence test
        if (known(t) && t.t !== "Boolean") add("error", `${describeNode(n)} is ${show(t)}, not a condition`);
    }

    function compare(n, ctxEnt) {
        const l = value(n.l, T.any, ctxEnt);
        const r = value(n.r, T.any, ctxEnt);
        // the attribute side decides; a literal or token on the other
        const pairs = [[l, r, n.r], [r, l, n.l]];
        for (const [a, b, bn] of pairs) {
            if (!known(a) || !known(b) || b.t === "Empty") continue;
            if (a.t === "Enum") {
                if (bn.k === "str") {
                    const en = a.e && model.enumeration(a.e);
                    if (en && !en.values.includes(bn.v)) {
                        const s = suggest(bn.v, en.values, 3);
                        add("error", `'${bn.v}' is not a value of ${a.e}` + (s.length ? `. Did you mean: ${s.map(x => `'${x}'`).join(", ")}?` : ` (values: ${en.values.join(", ")})`));
                    }
                    return;
                }
                if (b.t !== "Enum" && b.t !== "String") add("error", `'${n.op}' compares ${show(a)} with ${show(b)}`);
                return;
            }
            if (a.t === "Boolean") {
                if (b.t !== "Boolean") add("error", `'${n.op}' compares Boolean with ${show(b)}: use true() or false()`);
                return;
            }
            if (isNum(a) && bn.k === "str") {
                if (!/^\s*-?\d+(\.\d+)?\s*$/.test(bn.v)) add("error", `'${n.op}' compares ${show(a)} with the text '${bn.v}'`);
                return;
            }
            if (a.t === "DateTime" && bn.k === "str") return add("warning", `'${n.op}' compares a DateTime with the text '${bn.v}'; use a [%token%], a variable or a number`);
            if (a.t === "String" && (bn.k === "num" || isNum(b))) return add("warning", `'${n.op}' compares String with ${show(b)}; quote the text`);
            if (a.t === "Object" && (b.t === "String" || isNum(b)) && bn.k !== "str" && bn.k !== "num") return add("error", `'${n.op}' compares ${show(a)} with ${show(b)}`);
            if (a.t === "Object" && b.t === "Object" && a.e && b.e && !model.isA(a.e, b.e) && !model.isA(b.e, a.e) && !model.unknownEntity(a.e) && !model.unknownEntity(b.e)) return add("error", `'${n.op}' compares ${show(a)} with ${show(b)}`);
            if (a.t === "Object" || b.t === "Object") return;
            if (a.t !== b.t && !(isNum(a) && isNum(b)) && bn.k !== "str" && n.l.k === "path" && n.r.k === "path") return add("error", `'${n.op}' compares ${show(a)} with ${show(b)}`);
        }
    }

    const describeNode = n => (n.k === "path" ? n.steps.map(s => s.name).join("/") : n.k === "str" ? `'${n.v}'` : n.k === "num" ? n.v : n.k === "var" ? "$" + n.name : n.k);

    for (const c of constraints) cond(c);
    return { problems };
}

module.exports = { parse, lex, checkXPath, XPathSyntax, FUNCTIONS: FUNC_NAMES };
