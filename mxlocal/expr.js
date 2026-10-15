"use strict";
// Mendix expression language: tokenizer, parser and type checker (microflow/nanoflow expressions, page visibility and
// editability, widget expressions, call arguments, ...). Used by exprlint.js on the stored model; no Model SDK here.
//
//   const r = checkExpression("toString($Order/Total)", ctx, T.str)  ->  { type, problems: [{ level, msg }] }
//
// ctx (built by exprlint.js):
//   variable(name)  -> type | undefined          ($Name without the $; undefined = not defined here)
//   variables()     -> [names]                   (for did-you-mean)
//   strictVariables -> true when every variable of the context is known (microflows): unknown $Var is an error
//   currentObject   -> type of $currentObject or undefined (not available here)
//   model           -> exprlint model index (entity, attribute, association, enumeration, constant, userRole, isA)
// level "error": Studio Pro shows a consistency error for it (the dry run refuses); "warning": probably wrong, or a
// name this checker cannot verify (newer Mendix function, System member it does not know).
const { suggest: rawSuggest, distance } = require("./ops-util");

// did-you-mean: ops-util's suggest, plus near typos it leaves out (Opne -> Open), without very short names that only
// share a letter
function osa(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}
function suggest(word, options, n = 3) {
    const w = String(word);
    const near = options.filter(o => osa(o, w) <= Math.max(1, Math.min(2, Math.floor(w.length / 3))));
    const out = [...new Set([...near, ...rawSuggest(w, options, n)])].filter(o => o.length > 2 || distance(o, w) <= 1);
    return out.slice(0, n);
}

// ------------------------------------------------------------------------------------------------ types
const T = {
    any: { t: "Any" },
    empty: { t: "Empty" },
    str: { t: "String" },
    int: { t: "Integer" },
    long: { t: "Long" },
    dec: { t: "Decimal" },
    num: { t: "Numeric" }, // a number of unknown precision
    bool: { t: "Boolean" },
    date: { t: "DateTime" },
    bin: { t: "Binary" },
    void: { t: "Void" },
    obj: e => ({ t: "Object", e: e || null }),
    list: e => ({ t: "List", e: e || null }),
    enum: e => ({ t: "Enum", e: e || null })
};
const NUMERIC = new Set(["Integer", "Long", "Decimal", "Float", "Numeric"]);
const isNum = x => NUMERIC.has(x.t);
const known = x => x && x.t !== "Any";
const rank = { Integer: 1, Long: 2, Numeric: 2, Decimal: 3, Float: 3 };
function widest(a, b) {
    if (!isNum(a)) return b;
    if (!isNum(b)) return a;
    if (a.t === "Numeric" || b.t === "Numeric") return rank[a.t] >= 3 || rank[b.t] >= 3 ? T.dec : T.num;
    return rank[a.t] >= rank[b.t] ? (a.t === "Float" ? T.dec : a) : b.t === "Float" ? T.dec : b;
}

function show(x) {
    if (!x) return "?";
    if (x.t === "Object") return x.e || "object";
    if (x.t === "List") return `List of ${x.e || "objects"}`;
    if (x.t === "Enum") return x.e ? `enumeration ${x.e}` : "enumeration";
    if (x.t === "Numeric") return "number";
    if (x.t === "Float") return "Decimal";
    return x.t;
}

// Type from a stored DataTypes$* object or an attribute type ($Type DomainModels$*AttributeType).
function fromStored(dt) {
    if (!dt || !dt.$Type) return T.any;
    const k = dt.$Type.split("$")[1].replace(/AttributeType$/, "").replace(/Type$/, "");
    switch (k) {
        case "String":
        case "HashedString":
            return T.str;
        case "Integer":
            return T.int;
        case "Long":
        case "AutoNumber":
            return T.long;
        case "Decimal":
            return T.dec;
        case "Float":
            return { t: "Float" };
        case "Boolean":
            return T.bool;
        case "DateTime":
        case "Date":
            return T.date;
        case "Binary":
            return T.bin;
        case "Enumeration":
            return T.enum(dt.Enumeration || null);
        case "Object":
            return T.obj(dt.Entity || null);
        case "List":
            return T.list(dt.Entity || null);
        case "Void":
            return T.void;
        default:
            return T.any; // Unknown, parameterized (Java action type parameters), file, ...
    }
}

// Can a value of type src go where dst is expected? null = yes; { level, msg } = no.
function assignable(src, dst, model) {
    if (!known(src) || !known(dst) || src.t === "Empty") return null;
    const no = (msg, level = "error") => ({ level, msg });
    const what = `the expression gives ${show(src)}, but ${show(dst)} is expected`;
    switch (dst.t) {
        case "Void":
            return null;
        case "String":
            return src.t === "String" ? null : no(what + (isNum(src) || src.t === "DateTime" || src.t === "Boolean" ? " (use toString(...) or a format function)" : src.t === "Enum" ? " (use getCaption(...) or getKey(...))" : ""));
        case "Integer":
        case "Long":
        case "Numeric":
            if (src.t === "Decimal" || src.t === "Float") return no(what + " (use round(...), floor(...) or ceil(...))");
            return isNum(src) ? null : no(what + (src.t === "String" ? " (use parseInteger(...))" : ""));
        case "Decimal":
        case "Float":
            return isNum(src) ? null : no(what + (src.t === "String" ? " (use parseDecimal(...))" : ""));
        case "Boolean":
        case "DateTime":
        case "Binary":
            return src.t === dst.t ? null : no(what);
        case "Enum":
            if (src.t !== "Enum") return no(what + (src.t === "String" ? ` (write the value as ${dst.e || "Module.Enumeration"}.Value)` : ""));
            return src.e && dst.e && src.e !== dst.e ? no(what) : null;
        case "Object":
        case "List":
            if (src.t !== dst.t) return no(what);
            if (src.e && dst.e && model && !model.isA(src.e, dst.e)) {
                // the other way round (a generalization where its specialization is expected) needs a cast
                return model.unknownEntity(src.e) || model.unknownEntity(dst.e) ? null : no(what + (model.isA(dst.e, src.e) ? " (cast it first)" : ""));
            }
            return null;
        default:
            return null;
    }
}

// ------------------------------------------------------------------------------------------------ tokens
// XPath/expression tokens [%Name%]: type of the value they stand for.
const DATE_TOKENS = ["CurrentDateTime"];
for (const unit of ["Minute", "Hour", "Day", "Week", "Month", "Year"]) for (const be of ["BeginOf", "EndOf"]) DATE_TOKENS.push(`${be}Current${unit}`, `${be}Current${unit}UTC`);
DATE_TOKENS.push("BeginOfYesterday", "EndOfYesterday", "BeginOfTomorrow", "EndOfTomorrow", "BeginOfYesterdayUTC", "EndOfYesterdayUTC", "BeginOfTomorrowUTC", "EndOfTomorrowUTC");
const LENGTH_TOKENS = ["SecondLength", "MinuteLength", "HourLength", "DayLength", "WeekLength", "MonthLength", "YearLength"];
const TOKENS = new Map([...DATE_TOKENS.map(n => [n, T.date]), ...LENGTH_TOKENS.map(n => [n, T.long]),
    ["CurrentUser", T.obj("System.User")], ["CurrentObject", T.any], ["CurrentSession", T.obj("System.Session")]]);

// [%Token%] -> { type, problem }
function tokenType(name, model) {
    if (TOKENS.has(name)) return { type: TOKENS.get(name) };
    const role = /^UserRole_(.+)$/.exec(name);
    if (role) {
        const roles = model && model.userRoles ? model.userRoles() : null;
        if (roles && !roles.includes(role[1])) {
            const s = suggest(role[1], roles, 3);
            return { type: T.obj("System.UserRole"), problem: { level: "error", msg: `[%${name}%]: there is no user role '${role[1]}'` + (s.length ? `. Did you mean: ${s.map(r => `[%UserRole_${r}%]`).join(", ")}?` : "") } };
        }
        return { type: T.obj("System.UserRole") };
    }
    const s = suggest(name, [...TOKENS.keys()], 3);
    return { type: T.any, problem: { level: s.length && distance(s[0], name) <= 2 ? "error" : "warning", msg: `unknown token [%${name}%]` + (s.length ? `. Did you mean: ${s.map(x => `[%${x}%]`).join(", ")}?` : "") } };
}

// ------------------------------------------------------------------------------------------------ functions
// name: [min args, max args (-1 = any), return type or (argTypes) => type, argument kinds]
// kinds: S string, N number, D DateTime, B Boolean, E enumeration, O object, * anything; checked loosely (warnings)
const F = {};
const def = (names, min, max, ret, kinds = "") => names.split(" ").forEach(n => (F[n] = { min, max, ret, kinds }));
def("toUpperCase toLowerCase trim urlEncode urlDecode", 1, 1, T.str, "S");
def("length", 1, 1, T.int, "*"); // a String (and in newer versions a list)
def("substring", 2, 3, T.str, "SNN");
def("find findLast", 2, 3, T.int, "SSN");
def("contains startsWith endsWith isMatch", 2, 2, T.bool, "SS");
def("replaceAll replaceFirst", 3, 3, T.str, "SSS");
def("toString", 1, 1, T.str, "*");
def("max min", 1, -1, a => a.reduce((x, y) => widest(x, y), T.int), "N");
def("abs", 1, 1, a => (a[0] && isNum(a[0]) ? a[0] : T.num), "N");
def("round", 1, 2, a => (a.length > 1 ? T.dec : T.long), "NN");
def("floor ceil", 1, 1, T.long, "N");
def("pow", 2, 2, T.dec, "NN");
def("sqrt", 1, 1, T.dec, "N");
def("random", 0, 0, T.dec);
def("dateTime dateTimeUTC", 1, 6, T.date, "NNNNNN");
for (const unit of ["Milliseconds", "Seconds", "Minutes", "Hours", "Days", "Weeks", "Months", "Quarters", "Years"]) {
    def(`add${unit} subtract${unit}`, 2, 2, T.date, "DN");
    if (["Days", "Weeks", "Months", "Quarters", "Years"].includes(unit)) def(`add${unit}UTC subtract${unit}UTC`, 2, 2, T.date, "DN");
    def(`${unit[0].toLowerCase() + unit.slice(1)}Between`, 2, 2, T.num, "DD");
}
def("calendarMonthsBetween calendarYearsBetween calendarDaysBetween calendarWeeksBetween", 2, 2, T.num, "DD");
def("trimToSeconds trimToMinutes trimToHours trimToHoursUTC trimToDays trimToDaysUTC trimToWeeks trimToWeeksUTC trimToMonths trimToMonthsUTC trimToYears trimToYearsUTC", 1, 1, T.date, "D");
for (const p of ["Day", "Week", "Month", "Year"]) def(`beginOf${p} endOf${p} beginOf${p}UTC endOf${p}UTC`, 1, 1, T.date, "D");
def("parseInteger", 1, 2, T.long, "SN");
def("parseLong", 1, 2, T.long, "SN");
def("parseDecimal parseFloat", 1, 3, T.dec, "S*S");
def("parseDateTime parseDateTimeUTC", 2, 3, T.date, "SSD");
def("formatDateTime formatDateTimeUTC", 1, 2, T.str, "DS");
def("formatDate formatDateUTC formatTime formatTimeUTC", 1, 1, T.str, "D");
def("formatDecimal", 1, 3, T.str, "NSS");
def("formatFloat", 1, 2, T.str, "NS");
def("toFloat", 1, 1, T.dec, "*");
def("dateTimeToEpoch", 1, 1, T.long, "D");
def("epochToDateTime", 1, 1, T.date, "N");
def("getCaption getKey", 1, 1, T.str, "E");
def("isNew", 1, 1, T.bool, "O");
def("not", 1, 1, T.bool, "B");
const FUNCTIONS = Object.keys(F);

function kindOk(kind, x) {
    if (!known(x) || x.t === "Empty" || kind === "*" || !kind) return true;
    if (kind === "S") return x.t === "String";
    if (kind === "N") return isNum(x);
    if (kind === "D") return x.t === "DateTime";
    if (kind === "B") return x.t === "Boolean";
    if (kind === "E") return x.t === "Enum";
    if (kind === "O") return x.t === "Object";
    return true;
}
const KIND_NAME = { S: "String", N: "number", D: "DateTime", B: "Boolean", E: "enumeration", O: "object" };

// ------------------------------------------------------------------------------------------------ lexer
class SyntaxErr extends Error {}

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
        if (c === "/" && src[i + 1] === "/") {
            while (i < n && src[i] !== "\n") i++; // line comment (Mendix 10+)
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            const end = src.indexOf("*/", i + 2);
            if (end < 0) throw new SyntaxErr(`comment opened at ${at + 1} is not closed`);
            i = end + 2;
            continue;
        }
        if (c === "'") {
            let s = "";
            i++;
            for (;;) {
                if (i >= n) throw new SyntaxErr(`text started at position ${at + 1} has no closing '`);
                if (src[i] === "'") {
                    if (src[i + 1] === "'") {
                        s += "'";
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                s += src[i++];
            }
            out.push({ k: "str", v: s, at });
            continue;
        }
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
            const m = /^(\d*\.?\d+(?:[eE][+-]?\d+)?|\d+\.)/.exec(src.slice(i));
            out.push({ k: "num", v: m[0], at });
            i += m[0].length;
            continue;
        }
        if (c === "$") {
            const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i));
            if (!m) throw new SyntaxErr(`'$' at position ${at + 1} is not followed by a variable name`);
            out.push({ k: "var", v: m[1], at });
            i += m[0].length;
            continue;
        }
        if (c === "@") {
            const m = /^@([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)/.exec(src.slice(i));
            if (!m) throw new SyntaxErr(`'@' at position ${at + 1} is not followed by Module.Constant`);
            out.push({ k: "const", v: m[1], at });
            i += m[0].length;
            continue;
        }
        if (c === "[" && src[i + 1] === "%") {
            const end = src.indexOf("%]", i + 2);
            if (end < 0) throw new SyntaxErr(`token [% at position ${at + 1} has no closing %]`);
            out.push({ k: "token", v: src.slice(i + 2, end), at });
            i = end + 2;
            continue;
        }
        if (/[A-Za-z_]/.test(c)) {
            const m = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/.exec(src.slice(i));
            out.push({ k: "name", v: m[0], at });
            i += m[0].length;
            continue;
        }
        const two = src.slice(i, i + 2);
        if (["!=", "<=", ">=", "<>"].includes(two)) {
            out.push({ k: "op", v: two === "<>" ? "!=" : two, at });
            i += 2;
            continue;
        }
        if ("+-*:=<>(),/".includes(c)) {
            out.push({ k: "op", v: c, at });
            i++;
            continue;
        }
        throw new SyntaxErr(`unexpected character '${c}' at position ${at + 1}`);
    }
    out.push({ k: "end", v: "", at: n });
    return out;
}

// ------------------------------------------------------------------------------------------------ parser
const KEYWORDS = new Set(["and", "or", "div", "mod", "if", "then", "else", "empty", "true", "false", "not", "NaN"]);

function parse(src) {
    const toks = lex(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = v => peek().k === "op" && peek().v === v;
    const isWord = v => peek().k === "name" && peek().v === v;
    const describe = t => (t.k === "end" ? "the end" : `'${t.k === "str" ? `'${t.v}'` : t.k === "var" ? "$" + t.v : t.v}' at position ${t.at + 1}`);
    const expectOp = v => {
        if (!isOp(v)) throw new SyntaxErr(`expected '${v}' but found ${describe(peek())}`);
        return next();
    };

    function expression() {
        return orExpr();
    }
    function orExpr() {
        let l = andExpr();
        while (isWord("or")) {
            const at = next().at;
            l = { k: "bin", op: "or", l, r: andExpr(), at };
        }
        return l;
    }
    function andExpr() {
        let l = cmpExpr();
        while (isWord("and")) {
            const at = next().at;
            l = { k: "bin", op: "and", l, r: cmpExpr(), at };
        }
        return l;
    }
    function cmpExpr() {
        const l = addExpr();
        if (peek().k === "op" && ["=", "!=", "<", "<=", ">", ">="].includes(peek().v)) {
            const t = next();
            return { k: "bin", op: t.v, l, r: addExpr(), at: t.at };
        }
        return l;
    }
    function addExpr() {
        let l = mulExpr();
        while (isOp("+") || isOp("-")) {
            const t = next();
            l = { k: "bin", op: t.v, l, r: mulExpr(), at: t.at };
        }
        return l;
    }
    function mulExpr() {
        let l = unary();
        while (isOp("*") || isOp(":") || isWord("div") || isWord("mod")) {
            const t = next();
            l = { k: "bin", op: t.v === ":" ? "div" : t.v, l, r: unary(), at: t.at };
        }
        return l;
    }
    function unary() {
        if (isOp("-") || isOp("+")) {
            const t = next();
            return { k: "neg", e: unary(), at: t.at, op: t.v };
        }
        return primary();
    }
    function path() {
        const steps = [];
        while (isOp("/")) {
            next();
            const t = next();
            if (t.k !== "name") throw new SyntaxErr(`expected an attribute or association after '/' but found ${describe(t)}`);
            steps.push({ name: t.v, at: t.at });
        }
        return steps;
    }
    function primary() {
        const t = next();
        switch (t.k) {
            case "str":
                return { k: "lit", type: T.str, v: t.v, at: t.at };
            case "num":
                return { k: "lit", type: /[.eE]/.test(t.v) ? T.dec : T.int, v: t.v, at: t.at };
            case "var":
                return { k: "var", name: t.v, path: path(), at: t.at };
            case "const":
                return { k: "const", qn: t.v, at: t.at };
            case "token":
                return { k: "token", name: t.v, at: t.at };
            case "op":
                if (t.v === "(") {
                    const e = expression();
                    expectOp(")");
                    return { k: "paren", e, at: t.at };
                }
                throw new SyntaxErr(`unexpected ${describe(t)}`);
            case "name": {
                if (t.v === "empty") return { k: "lit", type: T.empty, at: t.at };
                if (t.v === "true" || t.v === "false") {
                    if (isOp("(")) {
                        next();
                        expectOp(")");
                    }
                    return { k: "lit", type: T.bool, v: t.v, at: t.at };
                }
                if (t.v === "NaN") return { k: "lit", type: T.dec, at: t.at };
                if (t.v === "if") {
                    const c = expression();
                    if (!isWord("then")) throw new SyntaxErr(`'if' at position ${t.at + 1} needs 'then', found ${describe(peek())}`);
                    next();
                    const a = expression();
                    let b = null;
                    if (isWord("else")) {
                        next();
                        b = expression();
                    }
                    return { k: "if", c, a, b, at: t.at };
                }
                if (isOp("(")) {
                    next();
                    const args = [];
                    if (!isOp(")")) {
                        args.push(expression());
                        while (isOp(",")) {
                            next();
                            args.push(expression());
                        }
                    }
                    expectOp(")");
                    return { k: "call", name: t.v, args, at: t.at };
                }
                if (KEYWORDS.has(t.v)) throw new SyntaxErr(`unexpected '${t.v}' at position ${t.at + 1}`);
                return { k: "name", qn: t.v, at: t.at }; // enumeration value Module.Enum.Value (or a mistake)
            }
            default:
                throw new SyntaxErr(`unexpected ${describe(t)}`);
        }
    }

    if (peek().k === "end") throw new SyntaxErr("the expression is empty");
    const ast = expression();
    if (peek().k !== "end") throw new SyntaxErr(`unexpected ${describe(peek())} (an operator or 'and'/'or' missing?)`);
    return ast;
}

// ------------------------------------------------------------------------------------------------ member paths
// Follow $Var/Step/Step over the model. Steps: Attribute | Module.Association [ / Module.Entity ] ...
// Returns { type, problems }. Shared with xpath.js ($Var/... in XPath).
function walkPath(start, steps, model, label) {
    const problems = [];
    let cur = start;
    let prev = null; // the association just followed (an entity step may come after it)
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const shown = `${label}/${steps.slice(0, i + 1).map(x => x.name).join("/")}`;
        if (!known(cur) || (cur.t === "Object" && !cur.e)) return { type: T.any, problems };
        if (cur.t !== "Object") {
            if (cur.t === "List") problems.push({ level: "error", msg: `${shown}: ${label}${i ? "/" + steps.slice(0, i).map(x => x.name).join("/") : ""} is a list; a member path needs an object` });
            else problems.push({ level: "error", msg: `${shown}: ${show(cur)} has no members` });
            return { type: T.any, problems };
        }
        const ent = cur.e;
        if (model.unknownEntity(ent)) return { type: T.any, problems }; // System entity this checker does not know
        if (s.name.includes(".")) {
            const asc = model.association(s.name);
            if (!asc) {
                // an entity after an association: $X/Mod.Assoc/Mod.Entity
                if (prev && model.entity(s.name)) {
                    if (!model.isA(s.name, ent) && !model.isA(ent, s.name)) problems.push({ level: "error", msg: `${shown}: ${prev} leads to ${ent}, not ${s.name}` });
                    else cur = T.obj(model.isA(s.name, ent) ? s.name : ent);
                    prev = null;
                    continue;
                }
                const opts = model.associationsOf(ent).map(a => a.qn);
                const sg = suggest(s.name, opts, 3);
                const sys = /^System\./.test(s.name) ? "warning" : "error";
                problems.push({ level: sys, msg: `${shown}: ${ent} has no association '${s.name}'` + (sg.length ? `. Did you mean: ${sg.join(", ")}?` : opts.length ? "" : ` (${ent} has no associations)`) });
                return { type: T.any, problems };
            }
            const dir = model.direction(asc, ent);
            if (!dir) {
                const opts = model.associationsOf(ent).map(a => a.qn);
                const sg = suggest(s.name, opts, 3);
                problems.push({ level: "error", msg: `${shown}: ${s.name} connects ${asc.parent} and ${asc.child}, not ${ent}` + (sg.length ? `. Did you mean: ${sg.join(", ")}?` : "") });
                return { type: T.any, problems };
            }
            const other = dir === "forward" ? asc.child : asc.parent;
            const many = dir === "forward" ? asc.type === "ReferenceSet" : asc.type === "ReferenceSet" || asc.owner !== "Both";
            if (many && i + 1 < steps.length && steps[i + 1].name.includes(".") && model.entity(steps[i + 1].name) && !model.association(steps[i + 1].name)) {
                // $X/Mod.Assoc/Mod.Entity over a reference set: the list of associated objects
                const e2 = steps[i + 1].name;
                if (!model.isA(e2, other) && !model.isA(other, e2)) problems.push({ level: "error", msg: `${shown}/${e2}: ${s.name} leads to ${other}, not ${e2}` });
                if (i + 2 < steps.length) {
                    problems.push({ level: "error", msg: `${label}/${steps.map(x => x.name).join("/")}: ${s.name} gives a list; a member path needs an object` });
                    return { type: T.any, problems };
                }
                return { type: T.list(model.isA(e2, other) ? e2 : other), problems };
            }
            if (dir === "reverse" && asc.owner !== "Both" && asc.parent !== asc.child) problems.push({ level: "warning", msg: `${shown}: ${s.name} is owned by ${asc.parent}; expressions follow an association from its owner (${asc.parent} -> ${asc.child}), use a retrieve for the other direction` });
            cur = many ? T.list(other) : T.obj(other);
            prev = s.name;
            continue;
        }
        prev = null;
        const a = model.attribute(ent, s.name);
        if (!a) {
            const sg = suggest(s.name, model.attributeNames(ent), 3);
            const lvl = model.partial(ent) ? "warning" : "error";
            problems.push({ level: lvl, msg: `${shown}: ${ent} has no attribute '${s.name}'` + (sg.length ? `. Did you mean: ${sg.join(", ")}?` : "") });
            return { type: T.any, problems };
        }
        if (i < steps.length - 1) {
            problems.push({ level: "error", msg: `${shown}: '${s.name}' is an attribute; nothing can follow it` });
            return { type: T.any, problems };
        }
        cur = a.type;
    }
    return { type: cur, problems };
}

// ------------------------------------------------------------------------------------------------ type check
function checkExpression(src, ctx, target, opts = {}) {
    const problems = [];
    let ast;
    try {
        ast = parse(String(src));
    } catch (e) {
        if (!(e instanceof SyntaxErr)) throw e;
        return { type: T.any, problems: [{ level: "error", msg: `syntax: ${e.message}` }] };
    }
    const model = ctx.model;
    const add = (level, msg) => problems.push({ level, msg });

    function variable(n) {
        if (n.name === "currentObject" && ctx.currentObject === undefined && !ctx.variable(n.name)) {
            add(ctx.strictVariables ? "error" : "warning", "$currentObject is not available here (only in list operations, aggregates and data containers on pages)");
            return T.any;
        }
        let t = n.name === "currentObject" && ctx.currentObject !== undefined ? ctx.currentObject : ctx.variable(n.name);
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

    function call(n) {
        const args = n.args.map(type);
        const f = F[n.name];
        if (!f) {
            const s = suggest(n.name, FUNCTIONS, 3);
            const close = s.length && (distance(s[0], n.name) <= 2 || s[0].toLowerCase() === n.name.toLowerCase());
            add(close ? "error" : "warning", `unknown function ${n.name}(...)` + (s.length ? `. Did you mean: ${s.join(", ")}?` : "") + (close ? "" : " (fine if your Mendix version has it)"));
            return T.any;
        }
        if (args.length < f.min || (f.max >= 0 && args.length > f.max)) {
            const want = f.min === f.max ? `${f.min}` : f.max < 0 ? `at least ${f.min}` : `${f.min} to ${f.max}`;
            add("error", `${n.name}(...) takes ${want} argument${f.min === 1 && f.max === 1 ? "" : "s"}, got ${args.length}`);
        }
        args.forEach((a, i) => {
            const kind = f.kinds[Math.min(i, f.kinds.length - 1)];
            if (!kindOk(kind, a)) add(kind === "O" || kind === "E" || (kind === "S" && a.t !== "String" && (isNum(a) || a.t === "DateTime" || a.t === "Boolean")) ? "error" : "warning",
                `${n.name}(...): argument ${i + 1} is ${show(a)}, expected ${KIND_NAME[kind]}`);
        });
        if (n.name === "length" && args[0] && known(args[0]) && !["String", "List", "Empty"].includes(args[0].t)) add("error", `length(...): argument is ${show(args[0])}, expected String`);
        return typeof f.ret === "function" ? f.ret(args) : f.ret;
    }

    function bool(n, x, what) {
        if (known(x) && x.t !== "Boolean" && x.t !== "Empty") add("error", `${what} needs Boolean operands, got ${show(x)}`);
    }

    function binary(n) {
        const l = type(n.l);
        const r = type(n.r);
        switch (n.op) {
            case "and":
            case "or":
                bool(n, l, `'${n.op}'`);
                bool(n, r, `'${n.op}'`);
                return T.bool;
            case "=":
            case "!=":
                comparable(l, r, n.op);
                return T.bool;
            case "<":
            case "<=":
            case ">":
            case ">=":
                if (known(l) && known(r) && l.t !== "Empty" && r.t !== "Empty") {
                    const ok = (isNum(l) && isNum(r)) || (l.t === r.t && ["DateTime", "String"].includes(l.t));
                    if (!ok) add("error", `'${n.op}' compares ${show(l)} with ${show(r)}`);
                }
                return T.bool;
            case "+":
                if (l.t === "String" || r.t === "String") {
                    // String + a number/date/Boolean is a text (Studio Pro converts it); an object or list is not
                    const other = l.t === "String" ? r : l;
                    if (other.t === "Object" || other.t === "List") add("error", `'+' joins String with ${show(other)}`);
                    return T.str;
                }
                return arith(n, l, r);
            case "-":
                return arith(n, l, r);
            case "*":
                return arith(n, l, r);
            case "div":
                arith(n, l, r);
                return T.dec;
            case "mod":
                return arith(n, l, r);
            default:
                return T.any;
        }
    }

    function arith(n, l, r) {
        for (const x of [l, r]) if (known(x) && !isNum(x) && x.t !== "Empty") add("error", `'${n.op}' needs numbers, got ${show(x)}`);
        return isNum(l) && isNum(r) ? widest(l, r) : isNum(l) ? l : isNum(r) ? r : T.any;
    }

    function comparable(l, r, op) {
        if (!known(l) || !known(r) || l.t === "Empty" || r.t === "Empty") return;
        if (isNum(l) && isNum(r)) return;
        if (l.t !== r.t) return add("error", `'${op}' compares ${show(l)} with ${show(r)}`);
        if (l.t === "Enum" && l.e && r.e && l.e !== r.e) add("error", `'${op}' compares ${show(l)} with ${show(r)}`);
        if ((l.t === "Object" || l.t === "List") && l.e && r.e && !model.isA(l.e, r.e) && !model.isA(r.e, l.e) && !model.unknownEntity(l.e) && !model.unknownEntity(r.e)) add("error", `'${op}' compares ${show(l)} with ${show(r)}`);
    }

    function name(n) {
        // Module.Enumeration.Value
        const parts = n.qn.split(".");
        if (parts.length === 3) {
            const enumQn = parts.slice(0, 2).join(".");
            const en = model.enumeration(enumQn);
            if (en) {
                if (!en.values.includes(parts[2])) {
                    const s = suggest(parts[2], en.values, 3);
                    add("error", `${enumQn} has no value '${parts[2]}'` + (s.length ? `. Did you mean: ${s.map(v => enumQn + "." + v).join(", ")}?` : ` (values: ${en.values.join(", ")})`));
                }
                return T.enum(enumQn);
            }
            if (parts[0] === "System" || model.unknownModule(parts[0])) return T.enum(enumQn);
            const s = suggest(enumQn, model.enumerationNames(), 3);
            add("error", `unknown enumeration ${enumQn} (in ${n.qn})` + (s.length ? `. Did you mean: ${s.join(", ")}?` : ""));
            return T.any;
        }
        if (/^[a-z]/.test(n.qn) && parts.length === 1) {
            const s = suggest(n.qn, ctx.variables(), 2);
            add("error", `'${n.qn}' is not a value: a variable needs a $` + (s.length ? ` ($${s[0]}?)` : "") + ", a text needs quotes");
            return T.any;
        }
        add("error", `'${n.qn}' is not a value (an enumeration value is written Module.Enumeration.Value, a variable $Name, a text 'quoted')`);
        return T.any;
    }

    function type(n) {
        switch (n.k) {
            case "lit":
                return n.type;
            case "paren":
                return type(n.e);
            case "var":
                return variable(n);
            case "const": {
                const c = model.constant(n.qn);
                if (c) return c;
                if (n.qn.startsWith("System.") || model.unknownModule(n.qn.split(".")[0])) return T.any;
                const s = suggest(n.qn, model.constantNames(), 3);
                add("error", `unknown constant @${n.qn}` + (s.length ? `. Did you mean: ${s.map(x => "@" + x).join(", ")}?` : ""));
                return T.any;
            }
            case "token": {
                const r = tokenType(n.name, model);
                if (r.problem) add(r.problem.level, r.problem.msg);
                return r.type;
            }
            case "call":
                return call(n);
            case "bin":
                return binary(n);
            case "neg": {
                const x = type(n.e);
                if (known(x) && !isNum(x)) add("error", `'${n.op}' needs a number, got ${show(x)}`);
                return isNum(x) ? x : T.num;
            }
            case "if": {
                const c = type(n.c);
                bool(n, c, "'if'");
                const a = type(n.a);
                if (!n.b) {
                    add("warning", "'if ... then ...' has no 'else'");
                    return a;
                }
                const b = type(n.b);
                if (a.t === "Empty") return b;
                if (b.t === "Empty") return a;
                if (!known(a) || !known(b)) return T.any;
                if (isNum(a) && isNum(b)) return widest(a, b);
                if (a.t !== b.t) {
                    add("error", `'then' gives ${show(a)} but 'else' gives ${show(b)}`);
                    return T.any;
                }
                if ((a.t === "Object" || a.t === "List") && a.e !== b.e) return model.isA(a.e, b.e) ? b : model.isA(b.e, a.e) ? a : { t: a.t, e: null };
                return a;
            }
            case "name":
                return name(n);
            default:
                return T.any;
        }
    }

    const result = type(ast);
    if (target) {
        const p = target.t === "Boolean" && result.t === "Empty" ? null : assignable(result, target, model);
        if (p) add(p.level, p.msg);
    }
    if (opts.notList && result.t === "List") add("error", `the expression gives ${show(result)}; a single value is expected`);
    return { type: result, problems, ast };
}

module.exports = { suggest, T, show, fromStored, assignable, checkExpression, parse, lex, walkPath, tokenType, isNum, known, widest, FUNCTIONS, TOKENS, SyntaxErr };
