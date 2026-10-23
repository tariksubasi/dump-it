"use strict";
// The ES module JavaScript of the native theme (theme/native/custom-variables.js, themesource/<module>/native/main.js)
// read and changed WITHOUT running it: a small tokenizer (strings, template literals, comments, regular expressions)
// finds the `export const name = <expression>` statements, the properties of object literals in them (nested too),
// the import lines; edits replace exactly the span of one value, add a property, an export or an imported name.
// Anything the editor does not understand (a spread, a computed key, a function as value) is refused with what to do
// instead, never guessed. syntaxCheck runs `node --check` on a temporary .mjs copy (an ES module parse, nothing runs).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// tokens: { t: "id" | "num" | "str" | "tpl" | "punct" | "regex", v, s (start), e (end) } (comments are skipped)
function tokenize(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    const regexOk = () => {
        const p = out[out.length - 1];
        if (!p) return true;
        if (p.t === "punct") return !/^[)\]}]$/.test(p.v);
        return p.t === "id" && /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(p.v);
    };
    const tplStack = []; // brace depth at which a ${ ... } of a template literal ends
    let depth = 0;
    const readTemplate = start => {
        // from just after ` or }: up to the closing ` (returns { end, open: true when it stopped at ${ })
        let j = start;
        while (j < n) {
            const c = src[j];
            if (c === "\\") j += 2;
            else if (c === "`") return { end: j + 1, open: false };
            else if (c === "$" && src[j + 1] === "{") return { end: j + 2, open: true };
            else j++;
        }
        throw new Error(`unterminated template literal at offset ${start}`);
    };
    while (i < n) {
        const c = src[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (c === "/" && src[i + 1] === "/") {
            const e = src.indexOf("\n", i);
            i = e < 0 ? n : e;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            const e = src.indexOf("*/", i + 2);
            if (e < 0) throw new Error(`unterminated comment at line ${lineOf(src, i)}`);
            i = e + 2;
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && src[j] !== c) {
                if (src[j] === "\\") j++;
                else if (src[j] === "\n") throw new Error(`unterminated string at line ${lineOf(src, i)}`);
                j++;
            }
            if (j >= n) throw new Error(`unterminated string at line ${lineOf(src, i)}`);
            out.push({ t: "str", v: src.slice(i, j + 1), s: i, e: j + 1 });
            i = j + 1;
            continue;
        }
        if (c === "`" || (c === "}" && tplStack.length && tplStack[tplStack.length - 1] === depth)) {
            if (c === "}") tplStack.pop();
            const r = readTemplate(i + 1);
            out.push({ t: "tpl", v: src.slice(i, r.end), s: i, e: r.end });
            if (r.open) tplStack.push(depth);
            i = r.end;
            continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            let j = i + 1;
            while (j < n && /[\w$]/.test(src[j])) j++;
            out.push({ t: "id", v: src.slice(i, j), s: i, e: j });
            i = j;
            continue;
        }
        if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] || ""))) {
            const m = /^(0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(\d[\d_]*)?\.?\d[\d_]*([eE][+-]?\d+)?n?)/.exec(src.slice(i));
            const len = m ? m[0].length : 1;
            out.push({ t: "num", v: src.slice(i, i + len), s: i, e: i + len });
            i += len;
            continue;
        }
        if (c === "/" && regexOk()) {
            let j = i + 1, cls = false;
            while (j < n) {
                const d = src[j];
                if (d === "\\") j++;
                else if (d === "[") cls = true;
                else if (d === "]") cls = false;
                else if (d === "/" && !cls) break;
                else if (d === "\n") throw new Error(`unterminated regular expression at line ${lineOf(src, i)}`);
                j++;
            }
            j++;
            while (j < n && /\w/.test(src[j])) j++;
            out.push({ t: "regex", v: src.slice(i, j), s: i, e: j });
            i = j;
            continue;
        }
        const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
        const p = ["...", "===", "!==", "**=", "<<=", ">>=", "&&=", "||=", "??="].includes(three) ? three : ["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "**"].includes(two) ? two : c;
        if (p === "{" || p === "(" || p === "[") depth++;
        else if (p === "}" || p === ")" || p === "]") depth--;
        out.push({ t: "punct", v: p, s: i, e: i + p.length });
        i += p.length;
    }
    return out;
}

function lineOf(src, at) {
    return src.slice(0, at).split("\n").length;
}

// index of the token that closes the bracket at index i
function closing(toks, i) {
    const open = toks[i].v, close = { "{": "}", "(": ")", "[": "]" }[open];
    let d = 0;
    for (let j = i; j < toks.length; j++) {
        if (toks[j].t !== "punct") continue;
        if (/^[{([]$/.test(toks[j].v)) d++;
        else if (/^[})\]]$/.test(toks[j].v) && --d === 0) {
            if (toks[j].v !== close) throw new Error(`a '${open}' is closed by '${toks[j].v}'`);
            return j;
        }
    }
    throw new Error(`a '${open}' is never closed (braces do not balance)`);
}

const STATEMENT = /^(export|import|const|let|var|function|class|if|for|while|return)$/;

// Where an expression that starts at token i ends: the token index after it (stops at ; , or } on its own level,
// or at a statement keyword on a new line at the top level).
function exprEnd(toks, i, stopAtComma) {
    let j = i;
    while (j < toks.length) {
        const k = toks[j];
        if (k.t === "punct") {
            if (/^[{([]$/.test(k.v)) {
                j = closing(toks, j) + 1;
                continue;
            }
            if (k.v === ";" || /^[})\]]$/.test(k.v) || (stopAtComma && k.v === ",")) return j;
        }
        if (j > i && !stopAtComma && k.t === "id" && STATEMENT.test(k.v)) return j;
        j++;
    }
    return j;
}

// The module: { toks, imports: [{ s, e, names: [..], from, braces }], exports: Map name -> { kind, s, e, valS, valE, obj? },
// decls: top-level const / let that are not exported directly (same shape) }
// kind: "const" (export const x = ...), "let", "function", "class", "star" (export * from), "list" (export { a, b }).
function parse(src) {
    const toks = tokenize(src);
    // the whole file must balance
    let d = 0;
    for (const t of toks) if (t.t === "punct") {
        if (/^[{([]$/.test(t.v)) d++;
        else if (/^[})\]]$/.test(t.v) && --d < 0) throw new Error(`an extra '${t.v}' at line ${lineOf(src, t.s)}`);
    }
    if (d !== 0) throw new Error("the brackets { } ( ) [ ] do not balance");
    const imports = [], exports = new Map(), decls = new Map(), stars = [], other = [];
    let i = 0;
    while (i < toks.length) {
        const t = toks[i];
        if (t.t === "punct" && /^[{([]$/.test(t.v)) {
            i = closing(toks, i) + 1;
            continue;
        }
        if (t.t === "id" && t.v === "import" && !(toks[i + 1] && /^[(.]$/.test(toks[i + 1].v))) {
            // import "x"; import a from "x"; import * as a from "x"; import { a, b as c } from "x"; import a, { b } from "x"
            let j = i + 1;
            const names = [];
            let braces = null, from = null;
            if (toks[j] && toks[j].t === "str") from = toks[j].v.slice(1, -1);
            else {
                for (; j < toks.length && !(toks[j].t === "id" && toks[j].v === "from"); j++) {
                    const k = toks[j];
                    if (k.v === "{") {
                        const c = closing(toks, j);
                        braces = { open: j, close: c };
                        let seg = [];
                        for (let q = j + 1; q <= c; q++) {
                            if (toks[q].v === "," || q === c) {
                                if (seg.length) names.push(seg[seg.length - 1]);
                                seg = [];
                            } else if (toks[q].t === "id" && toks[q].v !== "as") seg.push(toks[q].v);
                        }
                        j = c;
                    } else if (k.t === "id" && k.v !== "as") names.push(k.v);
                }
                from = toks[j + 1] && toks[j + 1].t === "str" ? toks[j + 1].v.slice(1, -1) : null;
                j++;
            }
            let e = j + 1;
            if (toks[e] && toks[e].v === ";") e++;
            imports.push({ s: t.s, e: toks[e - 1].e, names, from, braces });
            i = e;
            continue;
        }
        if (t.t === "id" && /^(const|let)$/.test(t.v) && (i === 0 || toks[i - 1].v !== "export") && toks[i + 1] && toks[i + 1].t === "id" && toks[i + 2] && toks[i + 2].v === "=") {
            // a top-level const / let (Atlas core variables.js: let brand = { ... }; export { brand })
            const vs = i + 3, ve = exprEnd(toks, vs, true);
            const x = { kind: t.v, s: t.s, valS: toks[vs].s, valE: toks[ve - 1].e, line: lineOf(src, t.s) };
            if (toks[vs].v === "{" && closing(toks, vs) === ve - 1) x.obj = objectAt(src, toks, vs);
            if (!decls.has(toks[i + 1].v)) decls.set(toks[i + 1].v, x);
            i = ve;
            continue;
        }
        if (t.t === "id" && t.v === "export") {
            const k = toks[i + 1];
            if (k && k.t === "id" && /^(const|let|var)$/.test(k.v)) {
                const name = toks[i + 2], eq = toks[i + 3];
                if (!name || name.t !== "id" || !eq || eq.v !== "=") throw new Error(`line ${lineOf(src, t.s)}: export ${k.v} without a plain "name = value" (destructuring is not supported here)`);
                const vs = i + 4, ve = exprEnd(toks, vs, true);
                if (toks[ve] && toks[ve].v === ",") throw new Error(`line ${lineOf(src, t.s)}: several names in one export ${k.v}; give each its own export`);
                let end = ve;
                if (toks[end] && toks[end].v === ";") end++;
                const x = { kind: k.v, s: t.s, e: toks[end - 1].e, valS: toks[vs].s, valE: toks[ve - 1].e, tokS: vs, tokE: ve, line: lineOf(src, t.s) };
                if (toks[vs].v === "{" && closing(toks, vs) === ve - 1) x.obj = objectAt(src, toks, vs);
                if (exports.has(name.v)) throw new Error(`line ${x.line}: ${name.v} is exported twice`);
                exports.set(name.v, x);
                i = end;
                continue;
            }
            if (k && k.v === "*") {
                const f = toks.slice(i, i + 6).find(x => x.t === "str");
                stars.push(f ? f.v.slice(1, -1) : "");
            } else if (k && k.v === "{") {
                const c = closing(toks, i + 1);
                for (let j = i + 2; j < c; j++) if (toks[j].t === "id" && toks[j].v !== "as" && (toks[j + 1] || {}).v !== "as") exports.set(toks[j].v, { kind: "list", s: toks[j].s, e: toks[j].e, line: lineOf(src, toks[j].s) });
                    else if (toks[j].t === "id" && toks[j - 1].v === "as") exports.set(toks[j].v, { kind: "list", s: toks[j].s, e: toks[j].e, line: lineOf(src, toks[j].s) });
            } else if (k && k.t === "id" && /^(function|class)$/.test(k.v) && toks[i + 2]) exports.set(toks[i + 2].v, { kind: k.v, s: t.s, e: t.e, line: lineOf(src, t.s) });
            else if (k && k.v === "default") other.push("default");
        }
        i++;
    }
    return { src, toks, imports, exports, decls, stars, other };
}

// The properties of the object literal whose "{" is token o: { s, e, open, close, props: [ { key, keyS, valS, valE, tokS, tokE, comma: bool, obj? } ], odd: [ reasons ] }
function objectAt(src, toks, o) {
    const c = closing(toks, o);
    const props = [], odd = [];
    let j = o + 1;
    while (j < c) {
        const k = toks[j];
        if (k.v === "...") {
            odd.push(`a spread (...) at line ${lineOf(src, k.s)}`);
            j = exprEnd(toks, j + 1, true);
            if (toks[j] && toks[j].v === ",") j++;
            continue;
        }
        if (k.v === "[") {
            odd.push(`a computed key [...] at line ${lineOf(src, k.s)}`);
            j = closing(toks, j) + 1;
            continue;
        }
        const colon = toks[j + 1];
        if (!(k.t === "id" || k.t === "str" || k.t === "num") || !colon || colon.v !== ":") {
            // shorthand { a, b } or a method a() { }
            odd.push(`'${k.v}' without "key: value" at line ${lineOf(src, k.s)}`);
            j = exprEnd(toks, j, true);
            if (toks[j] && toks[j].v === ",") j++;
            continue;
        }
        const key = k.t === "str" ? k.v.slice(1, -1) : k.v;
        const vs = j + 2, ve = exprEnd(toks, vs, true);
        if (ve <= vs) throw new Error(`line ${lineOf(src, k.s)}: ${key} has no value`);
        const p = { key, keyS: k.s, valS: toks[vs].s, valE: toks[ve - 1].e, tokS: vs, tokE: ve, comma: !!(toks[ve] && toks[ve].v === ","), line: lineOf(src, k.s) };
        if (toks[vs].v === "{" && closing(toks, vs) === ve - 1) p.obj = objectAt(src, toks, vs);
        props.push(p);
        j = p.comma ? ve + 1 : ve;
    }
    return { s: toks[o].s, e: toks[c].e, open: o, close: c, props, odd };
}

// the indentation of the line that holds offset at
const indentAt = (src, at) => /^[ \t]*/.exec(src.slice(src.lastIndexOf("\n", at - 1) + 1))[0];

// Text with key path (["brand", "primary"]) set to the JS expression value. An export that does not exist is
// appended; a missing property is added to its object (nested objects made as needed). Throws with the reason when
// the place is not a plain object literal.
function setPath(src, keys, value, opts = {}) {
    const m = parse(src);
    const [root, ...rest] = keys;
    const x = m.exports.get(root);
    const unit = opts.indent || detectIndent(src);
    if (!x) {
        const body = rest.length ? objectText(rest, value, "", unit) : value;
        const sep = src.length && !src.endsWith("\n") ? "\n" : "";
        return { text: `${src}${sep}export const ${root} = ${body};\n`, old: null, how: "added export" };
    }
    if (x.kind !== "const" && x.kind !== "let") throw new Error(`${root} is exported as ${x.kind === "list" ? "a name in export { ... }" : `a ${x.kind}`} (line ${x.line}); change it in the file itself (editThemeFile)`);
    if (!rest.length) return { text: src.slice(0, x.valS) + value + src.slice(x.valE), old: src.slice(x.valS, x.valE), how: "changed" };
    if (!x.obj) throw new Error(`${root} (line ${x.line}) is not an object literal { ... } but ${JSON.stringify(src.slice(x.valS, x.valE).slice(0, 60))}; set the whole value (key "${root}") or change the file with editThemeFile`);
    return setIn(src, x.obj, rest, value, root, unit);
}

function setIn(src, obj, keys, value, where, unit) {
    const [k, ...rest] = keys;
    const hits = obj.props.filter(p => p.key === k);
    if (hits.length > 1) throw new Error(`${where}.${k} is set ${hits.length} times (lines ${hits.map(p => p.line).join(", ")}); remove the extra one first (editThemeFile)`);
    const p = hits[0];
    if (p) {
        if (!rest.length) return { text: src.slice(0, p.valS) + value + src.slice(p.valE), old: src.slice(p.valS, p.valE), how: "changed" };
        if (!p.obj) throw new Error(`${where}.${k} (line ${p.line}) is ${JSON.stringify(src.slice(p.valS, p.valE).slice(0, 60))}, not an object literal { ... }; set ${where}.${k} as a whole`);
        return setIn(src, p.obj, rest, value, `${where}.${k}`, unit);
    }
    if (obj.odd.length) throw new Error(`${where} has ${obj.odd[0]}: ${k} might come from there, so it is not added here; change the file with editThemeFile`);
    // add the property before the closing }
    const last = obj.props[obj.props.length - 1];
    const keyText = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    if (!last) {
        // empty object: { } -> {\n<ind+unit>key: value\n<ind>}
        const base = indentAt(src, obj.s);
        const inner = base + unit;
        const body = rest.length ? objectText(rest, value, inner, unit) : value;
        const text = src.slice(0, obj.s) + `{\n${inner}${keyText}: ${body}\n${base}}` + src.slice(obj.e);
        return { text, old: null, how: "added" };
    }
    const ind = indentAt(src, last.keyS);
    const body = rest.length ? objectText(rest, value, ind, unit) : value;
    // after the last value (and its comma, which keeps the trailing comma style)
    if (last.comma) {
        const commaEnd = src.indexOf(",", last.valE) + 1;
        const text = src.slice(0, commaEnd) + `\n${ind}${keyText}: ${body},` + src.slice(commaEnd);
        return { text, old: null, how: "added" };
    }
    const text = src.slice(0, last.valE) + `,\n${ind}${keyText}: ${body}` + src.slice(last.valE);
    return { text, old: null, how: "added" };
}

// { a: { b: value } } as text for key path [a, b], indented below ind
function objectText(keys, value, ind, unit) {
    if (!keys.length) return value;
    const [k, ...rest] = keys;
    const keyText = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    return `{\n${ind}${unit}${keyText}: ${objectText(rest, value, ind + unit, unit)}\n${ind}}`;
}

function detectIndent(src) {
    const m = /\n([ \t]+)[A-Za-z_"']/.exec(src);
    return m ? (m[1].startsWith("\t") ? "\t" : m[1].length >= 4 ? "    " : m[1]) : "    ";
}

// The text with name imported from module from (added to an existing import { ... } of it, or a new import line after
// the last import). Default and namespace imports of that module are left alone.
function addImport(src, name, from) {
    const m = parse(src);
    if (m.imports.some(i => i.names.includes(name))) return src;
    const same = m.imports.find(i => i.from === from && i.braces);
    if (same) {
        const close = m.toks[same.braces.close], prev = m.toks[same.braces.close - 1];
        if (prev.v === "{") return src.slice(0, close.s) + ` ${name} ` + src.slice(close.s);
        return src.slice(0, prev.e) + (prev.v === "," ? ` ${name}` : `, ${name}`) + src.slice(prev.e);
    }
    const line = `import { ${name} } from "${from}";\n`;
    const last = m.imports[m.imports.length - 1];
    if (!last) {
        // after the comment lines at the top of the file
        const head = /^(?:[ \t]*\/\/[^\n]*\n)*/.exec(src)[0];
        return src.slice(0, head.length) + line + src.slice(head.length);
    }
    const at = src.indexOf("\n", last.e);
    return at < 0 ? `${src}\n${line}` : src.slice(0, at + 1) + line + src.slice(at + 1);
}

// The value text at key path keys (["brand", "primary"]), or null when the file does not have it
function getPath(src, keys) {
    const m = parse(src);
    const x = m.exports.get(keys[0]);
    if (!x || x.valS === undefined) return null;
    if (keys.length === 1) return src.slice(x.valS, x.valE);
    let obj = x.obj, q = null;
    for (const k of keys.slice(1)) {
        q = obj && obj.props.find(p => p.key === k);
        if (!q) return null;
        obj = q.obj;
    }
    return src.slice(q.valS, q.valE);
}

// "" when text parses as an ES module (node --check on a temporary .mjs copy), else the error (first lines).
function syntaxCheck(text) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mxnative-"));
    const f = path.join(dir, "check.mjs");
    try {
        fs.writeFileSync(f, text);
        const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8", timeout: 20000 });
        if (r.status === 0) return "";
        const msg = String(r.stderr || r.error || "parse failed").split("\n").filter(l => l.trim() && !/^\s*at |^Node\.js v/.test(l));
        return msg.slice(0, 4).join(" | ").replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "file");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Plain data of an object literal's value text (numbers, strings, booleans, nested objects): for the style checks.
// Other expressions come back as { expr: "text" }.
function valueOf(src, p) {
    if (p.obj) return Object.fromEntries(p.obj.props.map(q => [q.key, valueOf(src, q)]));
    const t = src.slice(p.valS, p.valE).trim();
    if (/^-?\d*\.?\d+$/.test(t)) return Number(t);
    if (/^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.)*'$/.test(t)) return t.slice(1, -1);
    if (t === "true" || t === "false") return t === "true";
    return { expr: t };
}

module.exports = { tokenize, parse, objectAt, setPath, getPath, addImport, syntaxCheck, valueOf, detectIndent, lineOf };
