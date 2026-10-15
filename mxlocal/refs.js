"use strict";
// Model-wide reference graph from the raw units (no Model SDK load): every by-name reference (entities, attributes,
// associations, documents, enumeration values, roles, ...) and the qualified names, $Var/Attribute paths and XPath
// members written in expressions and XPath. Per unit the candidate references are cached by its ContentsHash
// (cache.js); names are resolved per query against the model as it is now, so a cached unit never goes stale.
//   usages <qualifiedName> [--depth n]   who uses it, grouped by document, with the place
//   unused [Module]                      documents, entities, attributes, enumeration values nobody references
const fs = require("fs");
const path = require("path");

const SELF = "~"; // module of a module-level unit (domain model, module security), filled in per query
const EXPR_KEY = /expression|xpath|constraint|argument|value|formula|node|condition|oql|initial|return|template|default/i;
const XPATH_KEY = /xpath|constraint/i;
const QN = /(?<![\w.$%])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g;
const KEYWORDS = new Set(["and", "or", "not", "true", "false", "empty", "div", "mod", "id", "reversed", "if", "then", "else", "contains", "starts-with", "ends-with", "avg", "count", "max", "min", "sum", "length", "year-from-dateTime", "NULL", "null"]);
const TOP = { MicroflowReturnType: "return type", FormCall: "layout", Parameters: "parameters", AllowedModuleRoles: "allowed roles", Variables: "page variables", Flows: "flow line" };
const PARAM = { Parameters: "parameter", Variables: "variable" };
const SUB = { AccessRules: "access rule", ValidationRules: "validation rule", Events: "event handler", Indexes: "index" };
const short = t => String(t || "").split("$").pop();
const id8 = id => String(id || "").slice(0, 8);

// Entity of a data source / reference: { EntityRef: Direct | Indirect } or { Entity }.
function entityOf(o) {
    if (!o || typeof o !== "object") return null;
    if (typeof o.Entity === "string" && o.Entity) return o.Entity;
    const r = o.EntityRef;
    if (r && typeof r === "object") {
        if (typeof r.Entity === "string" && r.Entity) return r.Entity;
        const steps = Array.isArray(r.Steps) ? r.Steps : [];
        const last = steps[steps.length - 1];
        if (last && last.DestinationEntity) return last.DestinationEntity;
    }
    if (o.DataSource && typeof o.DataSource === "object") return entityOf(o.DataSource);
    return null;
}

// Entity a pluggable widget's own data source property lists (not those of its column objects).
function widgetEntity(w) {
    if (w.$Type === "CustomWidgets$CustomWidget") {
        for (const p of (w.Object && w.Object.Properties) || []) {
            const e = p && p.Value && entityOf(p.Value.DataSource);
            if (e) return e;
        }
        return null;
    }
    return w.DataSource ? entityOf(w.DataSource) : null;
}

// Variables of a flow or page with an entity type: name -> Module.Entity.
function variables(plain) {
    const vars = new Map();
    const typeEntity = t => (t && typeof t === "object" && typeof t.Entity === "string" && t.Entity) || null;
    const lists = new Map();
    const walk = o => {
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
        if (Array.isArray(o)) return o.forEach(walk);
        const t = o.$Type || "";
        if (/MicroflowParameter$|NanoflowParameter$|RuleParameter$|MicroflowParameterObject$/.test(t) && typeof o.Name === "string") {
            const e = typeEntity(o.VariableType || o.ParameterType);
            if (e) vars.set(o.Name, e);
        } else if (t === "Forms$PageParameter" || t === "Forms$SnippetParameter") {
            const e = typeEntity(o.ParameterType);
            if (e) vars.set(o.Name, e);
        } else if (/CreateChangeAction$|CreateObjectAction$/.test(t) && o.VariableName && o.Entity) vars.set(o.VariableName, o.Entity);
        else if (/RetrieveAction$/.test(t) && o.ResultVariableName) {
            const e = o.RetrieveSource && entityOf(o.RetrieveSource);
            if (e) vars.set(o.ResultVariableName, e);
        } else if (t === "Microflows$CreateListAction" && o.VariableName && o.Entity) lists.set(o.VariableName, o.Entity);
        for (const [k, v] of Object.entries(o)) if (k[0] !== "$" && v && typeof v === "object") walk(v);
    };
    walk(plain);
    // loop variables: the entity of the list they iterate
    const loops = o => {
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
        if (Array.isArray(o)) return o.forEach(loops);
        if (o.$Type === "Microflows$IterableList" && o.VariableName && (vars.get(o.ListVariableName) || lists.get(o.ListVariableName))) vars.set(o.VariableName, vars.get(o.ListVariableName) || lists.get(o.ListVariableName));
        for (const [k, v] of Object.entries(o)) if (k[0] !== "$" && v && typeof v === "object") loops(v);
    };
    loops(plain);
    return vars;
}

// Paths in an expression: $Var/Seg/Seg (Seg: Module.Assoc, Module.Entity or a member name).
function exprPaths(text) {
    const out = [];
    const re = /\$(\w+)((?:\/[A-Za-z_][\w.]*)+)/g;
    let m;
    while ((m = re.exec(text))) out.push({ v: m[1], segs: m[2].split("/").filter(Boolean) });
    return out;
}

// Member paths of an XPath constraint, relative to its entity: [Attr = 1], [Mod.Assoc/Mod.Entity/Attr = ..],
// nested predicates relative to the path before them.
function xpathPaths(text) {
    const out = [];
    const stack = [[]];
    let i = 0;
    let last = [];
    while (i < text.length) {
        const c = text[i];
        if (c === "'" || c === '"') {
            const j = text.indexOf(c, i + 1);
            i = j < 0 ? text.length : j + 1;
            continue;
        }
        if (c === "%") {
            const j = text.indexOf("%", i + 1);
            i = j < 0 ? text.length : j + 1;
            continue;
        }
        if (c === "$") {
            const m = /^\$\w+(?:\/[A-Za-z_][\w.]*)*/.exec(text.slice(i));
            i += m ? m[0].length : 1;
            continue;
        }
        if (c === "[") {
            stack.push(stack[stack.length - 1].concat(last));
            last = [];
            i++;
            continue;
        }
        if (c === "]") {
            if (stack.length > 1) stack.pop();
            last = [];
            i++;
            continue;
        }
        const m = /^[A-Za-z_][\w.-]*(?:\/[A-Za-z_][\w.]*)*/.exec(text.slice(i));
        if (m) {
            const after = text.slice(i + m[0].length).trimStart();
            const segs = m[0].split("/");
            if (!(after[0] === "(") && !KEYWORDS.has(segs[0]) && !/^\d/.test(segs[0])) {
                out.push(stack[stack.length - 1].concat(segs));
                last = segs;
            } else last = [];
            i += m[0].length;
            continue;
        }
        if (c === "/" && /^\/[A-Za-z_]/.test(text.slice(i))) {
            i++;
            continue;
        }
        i++;
    }
    return out;
}

// Candidate references of one unit (cached): { c: [[kind, to, what, place, extra]], assocs, gens, owner }
// kind: r = by name, e = qualified name in an expression/XPath, p = member path (to = root entity, extra = segments).
// Names "~.X" are relative to the unit's module.
function extract(plain, schema) {
    const c = [];
    const assocs = [];
    const gens = [];
    const type = plain.$Type;
    const moduleLevel = type === "DomainModels$DomainModel" || /Security\$ModuleSecurity/.test(type);
    const page = /^Forms\$(Page|Snippet|Layout)$/.test(type);
    const flow = /^Microflows\$(Microflow|Nanoflow|Rule)$/.test(type);
    const vars = /^(Microflows\$(Microflow|Nanoflow|Rule)|Forms\$(Page|Snippet))$/.test(type) ? variables(plain) : new Map();
    const idName = new Map();
    if (type === "DomainModels$DomainModel") for (const e of plain.Entities || []) if (e && e.Name) idName.set(e.$ID, `${SELF}.${e.Name}`);
    const infoOf = t => t && schema.info(schema.sdkType(t));

    const walk = (o, ctx, key) => {
        if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
        if (Array.isArray(o)) {
            let n = 0;
            for (const x of o) {
                if (x && x.$Type === "CustomWidgets$WidgetObject") n++;
                walk(x, x && x.$Type === "CustomWidgets$WidgetObject" ? { ...ctx, item: n } : ctx, key);
            }
            return;
        }
        const t = o.$Type || "";
        let next = ctx;
        if (o !== plain && typeof o.Name === "string" && o.Name && t) {
            next = { ...next, names: next.names.concat(o.Name), item: 0 };
            if (moduleLevel && next.names.length === 1) next.owner = `${SELF}.${o.Name}`;
        }
        if (flow && key === "Objects" && t) {
            const action = o.Action && o.Action.$Type ? short(o.Action.$Type) : short(t);
            next = { ...next, step: /Parameter/.test(t) ? `parameter ${o.Name}` : `step ${id8(o.$ID)} (${action})` };
        }
        if (t === "DomainModels$EntityImpl" || t === "DomainModels$Entity") next = { ...next, entity: `${SELF}.${o.Name}` };
        if (t === "CustomWidgets$CustomWidget") next = { ...next, cw: (o.Type && o.Type.WidgetId) || "", item: 0 };
        const we = widgetEntity(o);
        if (we && !moduleLevel) next = { ...next, entity: we, widgetEntity: true };
        const info = infoOf(t);
        const place = () => {
            const named = next.names[next.names.length - 1];
            const where = next.step || (next.names.length ? (moduleLevel || !page ? next.names.join(".") : PARAM[next.top] ? `${PARAM[next.top]} ${named}` : `widget ${named}`) : TOP[next.top] || next.top || "");
            return where + (next.item ? ` ${/datagrid/i.test(next.cw || "") ? "column" : "item"} ${next.item}` : "");
        };
        for (const [k, v] of Object.entries(o)) {
            if (k[0] === "$") continue;
            const p = info && info.byKey.get(k);
            const what = `${short(t)}.${k}`;
            if (p && (p.kind === "byName" || p.kind === "byNameList")) {
                for (const x of [].concat(v)) if (typeof x === "string" && x) c.push(["r", x, what, place()]);
                if (t === "DomainModels$Generalization" && typeof v === "string" && v && ctx.entity) gens.push([ctx.entity, v]);
                continue;
            }
            if (typeof v === "string" && v) {
                if (!p && !info && /^[A-Za-z_]\w*(\.[A-Za-z_]\w*){1,2}$/.test(v) && k !== "Name") c.push(["e", v, what, place()]); // unknown type: exact names only
                if (t === "Microflows$EnumerationCase") {
                    c.push(["q", v, what, place()]);
                    continue;
                }
                if (!EXPR_KEY.test(k) || /^Texts\$/.test(t) || k === "Documentation" || (p && p.kind === "byId")) continue;
                if (!/[A-Za-z_]\w*\.[A-Za-z_]|\$\w+\/|^\s*\[|[A-Za-z_]/.test(v)) continue;
                const xp = XPATH_KEY.test(k) || /^\s*\[/.test(v);
                const at = place();
                for (const m of v.match(QN) || []) if (!/^\d/.test(m)) c.push(["e", m, what, at]);
                for (const ep of exprPaths(v)) {
                    const root = ep.v === "currentObject" ? next.entity : vars.get(ep.v);
                    if (root) c.push(["p", root, what, at, ep.segs]);
                }
                if (xp) {
                    for (const q of v.match(/'[^'%]*'/g) || []) if (q.length > 2) c.push(["q", q.slice(1, -1), what, at]);
                    const root = entityOf(o) || (moduleLevel ? next.entity : null) || next.entity;
                    if (root) for (const segs of xpathPaths(v)) c.push(["p", root, what, at, segs]);
                }
                continue;
            }
            if (v && typeof v === "object") walk(v, o === plain ? { ...next, top: k } : SUB[k] && next.names.length === 1 && moduleLevel ? { ...next, names: [`${next.names[0]} ${SUB[k]}`] } : next, k);
        }
        if (t === "DomainModels$Association" || t === "DomainModels$CrossAssociation") {
            const parent = idName.get(o.ParentPointer) || null;
            const child = t === "DomainModels$Association" ? idName.get(o.ChildPointer) || null : o.Child || null;
            assocs.push([`${SELF}.${o.Name}`, parent, child]);
            if (parent) c.push(["r", parent, `${short(t)}.Parent`, o.Name]);
            if (child && t === "DomainModels$Association") c.push(["r", child, `${short(t)}.Child`, o.Name]);
        }
    };
    walk(plain, { names: [], item: 0, entity: null, owner: null }, null);
    return { c, assocs, gens };
}

// The graph of the model as the client holds it now (changed units read fresh, the rest from the cache).
class Graph {
    constructor(client) {
        this.client = client;
        const project = client.project;
        const cache = project.cache;
        const changed = id => project.plain.has(id) && (client.changes.updated.has(id) || client.changes.created.has(id));
        this.names = new Map();
        for (const n of require("./inspect").names(client)) if (!this.names.has(n.qn)) this.names.set(n.qn, n.type);
        this.units = [];
        let dirty = false;
        for (const id of project.units.keys()) {
            const e = cache && cache.units.get(id);
            let x = e && !changed(id) ? e.refs : undefined;
            if (x === undefined) {
                x = extract(project.read(id), client.schema);
                if (e && !changed(id)) {
                    e.refs = x;
                    dirty = true;
                }
            }
            const info = client.unitInfo(id);
            let label = client.label(id);
            if (label === id) label = `(${short(info.type).replace(/Impl$/, "")})`;
            this.units.push({ id, type: info.type, name: info.name, label, module: label.split(".")[0], x });
        }
        if (dirty && cache) {
            cache.dirty = true;
            cache.save();
        }
        this.assocs = new Map();
        this.parents = new Map();
        for (const u of this.units) {
            const abs = n => (n && n.startsWith(SELF + ".") ? u.module + n.slice(1) : n);
            for (const [a, p, ch] of u.x.assocs) this.assocs.set(abs(a), { parent: abs(p), child: abs(ch) });
            for (const [e, p] of u.x.gens) this.parents.set(abs(e), abs(p));
        }
        this.edges = [];
        this.literals = new Set();
        for (const u of this.units) {
            const abs = n => (n && n.startsWith(SELF + ".") ? u.module + n.slice(1) : n);
            const doc = /^(DomainModels\$DomainModel|Security\$ModuleSecurity)/.test(u.type) ? u.module : u.label;
            for (const [kind, to, what, place, extra] of u.x.c) {
                if (kind === "r") this.edges.push({ unit: u.id, doc, to: abs(to), kind: "ref", what, place });
                else if (kind === "e") {
                    if (this.names.has(to)) this.edges.push({ unit: u.id, doc, to, kind: /xpath|constraint/i.test(what) ? "xpath" : "expression", what, place });
                } else if (kind === "q") this.literals.add(to);
                else if (kind === "p") {
                    for (const m of this.members(abs(to), extra)) this.edges.push({ unit: u.id, doc, to: m, kind: /xpath|constraint/i.test(what) ? "xpath" : "expression", what, place });
                }
            }
        }
        this.byTarget = new Map();
        for (const e of this.edges) {
            const list = this.byTarget.get(e.to);
            if (list) list.push(e);
            else this.byTarget.set(e.to, [e]);
        }
    }

    // Attribute (or association) of an entity or one of its parents.
    member(entity, name) {
        for (let e = entity, i = 0; e && i < 12; e = this.parents.get(e), i++) if (this.names.has(`${e}.${name}`)) return `${e}.${name}`;
        return null;
    }

    // Members a path names, walking associations and entity steps from root.
    members(root, segs) {
        const out = [];
        let cur = root;
        for (const s of segs) {
            if (!cur && !s.includes(".")) break;
            if (s.includes(".")) {
                const a = this.assocs.get(s);
                if (a) cur = cur && cur === a.child && a.parent !== a.child ? a.parent : a.child || null;
                else if (this.names.get(s) === "DomainModels$Entity") cur = s;
                else cur = null;
                continue;
            }
            const m = this.member(cur, s);
            if (m) {
                out.push(m);
                if (this.assocs.has(m)) {
                    const a = this.assocs.get(m);
                    cur = cur === a.child && a.parent !== a.child ? a.parent : a.child;
                    continue;
                }
            }
            cur = null;
        }
        return out;
    }

    // Edges to qn (and with members: to anything inside it), without the target's own definition.
    usesOf(qn, members = true) {
        const out = [];
        const own = this.unitOf(qn);
        for (const [to, list] of this.byTarget) {
            if (to !== qn && !(members && to.startsWith(qn + "."))) continue;
            for (const e of list) {
                if (own && e.unit === own.id && to !== qn) continue; // its own parameters, attributes, ...
                if (own && e.unit === own.id && /^(DomainModels\$DomainModel|Security\$ModuleSecurity)/.test(own.type) && e.place.split(".")[0] === qn.split(".").slice(1).join(".").split(".")[0] && to !== qn) continue;
                out.push(e);
            }
        }
        return out;
    }

    // The unit that defines qn (a document, or the domain model of an entity).
    unitOf(qn) {
        const parts = qn.split(".");
        const doc = this.units.find(u => u.label === qn);
        if (doc) return doc;
        for (let n = parts.length - 1; n >= 2; n--) {
            const d = this.units.find(u => u.label === parts.slice(0, n).join("."));
            if (d) return d;
        }
        if (this.names.has(qn)) return this.units.find(u => u.module === parts[0] && u.type === "DomainModels$DomainModel") || null;
        return null;
    }

    // The element that holds an edge: the document, or the entity / association of a domain model.
    owner(e) {
        const u = this.units.find(x => x.id === e.unit);
        if (u && /^(DomainModels\$DomainModel|Security\$ModuleSecurity)/.test(u.type)) {
            const first = String(e.place).split(/[. ]/)[0];
            return first && this.names.has(`${u.module}.${first}`) ? `${u.module}.${first}` : u.module;
        }
        return e.doc;
    }
}

const graphs = new WeakMap();
function graph(client) {
    let g = graphs.get(client);
    const stamp = client.log.length + ":" + client.changes.updated.size + ":" + client.changes.created.size + ":" + client.changes.deleted.size;
    if (!g || g.stamp !== stamp) {
        g = new Graph(client);
        g.stamp = stamp;
        graphs.set(client, g);
    }
    return g;
}

// Nearest names by edit distance (case-insensitive), at most n, none far off.
function closest(word, pool, n) {
    const w = word.toLowerCase();
    const dist = (a, b) => {
        if (Math.abs(a.length - b.length) > 6) return 99;
        let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
        return prev[b.length];
    };
    const limit = Math.max(2, Math.floor(w.length / 4));
    const scored = pool.map(o => ({ o, d: dist(w, o.toLowerCase()) })).filter(x => x.d <= limit).sort((a, b) => a.d - b.d);
    return scored.length ? scored.slice(0, n).map(x => x.o) : require("./ops-util").suggest(word, pool, n);
}

// A name the model knows, or a did-you-mean error.
function known(g, qn) {
    qn = String(qn || "").trim();
    if (!qn) throw new Error("usages needs a qualified name, e.g. usages Sales.Order or usages Sales.ACT_Order_Save");
    if (g.names.has(qn) || g.units.some(u => u.label === qn)) return qn;
    const lower = qn.toLowerCase();
    const same = [...g.names.keys()].filter(n => n.toLowerCase() === lower);
    if (same.length) throw new Error(`'${qn}' not found; names are case-sensitive: ${same[0]}?`);
    const parent = qn.split(".").slice(0, -1).join(".");
    const pool = g.names.has(parent) ? [...g.names.keys()].filter(n => n.startsWith(parent + ".")) : [...g.names.keys()];
    const s = closest(qn, pool, 3);
    throw new Error(`'${qn}' not found in the model.${s.length ? ` Did you mean: ${s.join(", ")}?` : ""} Check it with: find ${qn.split(".").pop()}`);
}

function typeOf(g, qn) {
    const t = g.names.get(qn) || (g.units.find(u => u.label === qn) || {}).type || "";
    return short(t).replace(/Impl$/, "");
}

// usages text: users grouped by document, each with its places; depth > 1 adds who uses those users.
function usages(client, qn, depth = 1) {
    const g = graph(client);
    qn = known(g, qn);
    depth = Math.max(1, Math.min(5, Number(depth) || 1));
    const lines = [];
    const seen = new Set([qn]);
    const shown = new Set();
    let level = [qn];
    let total = 0;
    for (let d = 1; d <= depth && level.length; d++) {
        const nextLevel = [];
        const shownNow = new Set();
        for (const target of level) {
            const uses = g.usesOf(target).filter(e => d === 1 || !shown.has(e.unit));
            for (const e of uses) shownNow.add(e.unit);
            const byDoc = new Map();
            for (const e of uses) {
                const k = e.unit;
                if (!byDoc.has(k)) byDoc.set(k, []);
                byDoc.get(k).push(e);
            }
            if (d === 1) {
                total = uses.length;
                lines.push(`Usages of ${qn} (${typeOf(g, qn)}): ${uses.length} place(s) in ${byDoc.size} document(s)` + (uses.length ? "" : " - nothing in the model refers to it" + (/^(Page|Microflow|Nanoflow)$/.test(typeOf(g, qn)) ? " (check also: unused)" : "")));
            } else if (byDoc.size) lines.push(`${"  ".repeat(d - 1)}used by ${target}:`);
            const pad = "  ".repeat(d - 1);
            for (const [, list] of [...byDoc].sort((a, b) => a[1][0].doc.localeCompare(b[1][0].doc))) {
                const u = g.units.find(x => x.id === list[0].unit);
                const doc = list[0].doc;
                lines.push(doc.startsWith("(") ? pad + doc : `${pad}${doc} [${short(u && u.type).replace(/Impl$/, "")}]`);
                const places = new Map();
                for (const e of list) {
                    const k = `${e.place || "(document)"}: ${e.kind === "ref" ? "" : e.kind + " "}${e.what}${e.to !== target ? " -> " + e.to.slice(target.length + 1) : ""}`;
                    places.set(k, (places.get(k) || 0) + 1);
                }
                const shown = [...places].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })).slice(0, 40);
                for (const [k, n] of shown) lines.push(`${pad}    ${k}${n > 1 ? ` (x${n})` : ""}`);
                if (places.size > shown.length) lines.push(`${pad}    ... ${places.size - shown.length} more`);
                for (const e of list) {
                    const o = g.owner(e);
                    if (!seen.has(o) && !qn.startsWith(o + ".")) {
                        seen.add(o);
                        nextLevel.push(o);
                    }
                }
            }
        }
        for (const id of shownNow) shown.add(id);
        level = nextLevel;
    }
    if (total && depth === 1) lines.push("(by name, and names in expressions/XPath; Java/JavaScript code is not searched)");
    return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------ unused

// Document types that only matter when something refers to them (entry points like scheduled events, published
// services, navigation, settings and security are never listed).
const CHECKED = /^(Forms\$(Page|Snippet|Layout)|Microflows\$(Microflow|Nanoflow|Rule)|Enumerations\$Enumeration|Constants\$Constant|JavaActions\$JavaAction|JavaScriptActions\$JavaScriptAction|ImportMappings\$ImportMapping|ExportMappings\$ExportMapping|JsonStructures\$JsonStructure|XmlSchemas\$XmlSchema|RegularExpressions\$RegularExpression|Menus\$MenuDocument|Workflows\$Workflow|MessageDefinitions\$MessageDefinitionCollection|Rest\$ConsumedRestService|DocumentTemplates\$DocumentTemplate|Images\$ImageCollection)$/;

// Text of the project's own Java and JavaScript code (not the generated proxies), to find names called from code.
function codeText(dir) {
    const parts = [];
    const scan = (d, ext, depth) => {
        let list = [];
        try {
            list = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of list) {
            const f = path.join(d, e.name);
            if (e.isDirectory()) {
                if (e.name !== "proxies" && e.name !== "node_modules" && depth < 12) scan(f, ext, depth + 1);
            } else if (ext.test(e.name)) {
                try {
                    parts.push(fs.readFileSync(f, "utf8"));
                } catch {
                    // unreadable file: skip
                }
            }
        }
    };
    scan(path.join(dir, "javasource"), /\.java$/, 0);
    scan(path.join(dir, "javascriptsource"), /\.(js|mjs|ts)$/, 0);
    return parts.join("\n");
}

function modulesOf(client) {
    const out = [];
    for (const [id] of client.project.units) {
        const info = client.unitInfo(id);
        if (!/^Projects\$Module(Impl)?$/.test(info.type)) continue;
        const p = client.project.read(id);
        out.push({ id, name: p.Name, appStore: !!p.FromAppStore });
    }
    return out;
}

// Documents, entities, attributes and enumeration values nobody refers to. Never deletes anything.
function unused(client, moduleName) {
    const g = graph(client);
    const mods = modulesOf(client);
    let scope;
    if (moduleName && moduleName !== true) {
        const m = mods.find(x => x.name === moduleName);
        if (!m) {
            const s = require("./ops-util").suggest(moduleName, mods.map(x => x.name), 3);
            throw new Error(`'${moduleName}' not found: no such module.${s.length ? ` Did you mean: ${s.join(", ")}?` : ` Modules: ${mods.filter(x => !x.appStore).map(x => x.name).join(", ")}`}`);
        }
        scope = new Set([m.name]);
    } else scope = new Set(mods.filter(x => !x.appStore).map(x => x.name));
    const code = codeText(client.project.dir);
    const fromOthers = (qn, unitId) => g.usesOf(qn).filter(e => e.unit !== unitId);
    const docs = [], entities = [], attrs = [], values = [];
    const entry = new Map();
    const skip = (why) => entry.set(why, (entry.get(why) || 0) + 1);
    for (const u of g.units) {
        if (!scope.has(u.module) || !CHECKED.test(u.type) || !u.name) continue;
        const qn = u.label;
        if (fromOthers(qn, u.id).length) continue;
        const p = client.project.read(u.id);
        if (p.MarkAsUsed) {
            skip("marked as used");
            continue;
        }
        if (typeof p.Url === "string" && p.Url) {
            skip("page with a URL");
            continue;
        }
        if (p.MicroflowActionInfo) {
            skip("exposed as a toolbox action");
            continue;
        }
        if (code.includes(qn)) {
            skip("named in Java/JavaScript code");
            continue;
        }
        const kind = short(u.type).replace(/Impl$/, "");
        const self = g.usesOf(qn).some(e => e.unit === u.id && e.to === qn);
        docs.push(`${qn} [${kind}]${p.Excluded ? " (excluded from the project)" : ""} - ${self ? "only calls itself" : "nothing refers to it"}${/Microflow|Nanoflow/.test(kind) ? "; not in a menu, home page, scheduled event, published service, event handler, after-startup or button" : /Page/.test(kind) ? "; not opened by a menu, button, microflow or home page, no URL" : ""}`);
    }
    for (const u of g.units) {
        if (!scope.has(u.module) || u.type !== "DomainModels$DomainModel") continue;
        const dm = client.project.read(u.id);
        const childOf = new Set();
        for (const [e, p] of g.parents) if (p) childOf.add(p);
        for (const e of dm.Entities || []) {
            if (!e || !e.Name) continue;
            const qn = `${u.module}.${e.Name}`;
            const parent = g.parents.get(qn);
            const others = fromOthers(qn, u.id);
            const inDm = g.usesOf(qn).filter(x => x.unit === u.id && !String(x.place).startsWith(e.Name + " ") && String(x.place) !== e.Name && !String(x.place).startsWith(e.Name + "."));
            const viaCode = code.includes(qn) || new RegExp(`\\b${u.module.toLowerCase()}\\.proxies\\.${e.Name}\\b`).test(code);
            const isUser = (() => {
                for (let x = parent, i = 0; x && i < 12; x = g.parents.get(x), i++) if (x === "System.User") return true;
                return false;
            })();
            if (!others.length && !viaCode && !childOf.has(qn) && !isUser) {
                const links = [...new Set(inDm.map(x => String(x.place).split(/[ .]/)[0]))];
                entities.push(`${qn} - ${links.length ? `only its own domain model refers to it (${links.slice(0, 4).join(", ")})` : "nothing refers to it"}${parent ? `; inherits ${parent}` : ""}`);
            }
            for (const a of e.Attributes || []) {
                if (!a || !a.Name) continue;
                const aq = `${qn}.${a.Name}`;
                const users = g.usesOf(aq).filter(x => x.unit !== u.id);
                if (users.length) continue;
                const calc = a.Value && /CalculatedValue/.test(a.Value.$Type || "");
                const java = new RegExp(`MemberNames\\.${a.Name}\\b|\\b[gs]et${a.Name}\\(`).test(code);
                if (java) {
                    skip("attribute used in Java code");
                    continue;
                }
                attrs.push(`${aq}${calc ? " (calculated)" : ""} - no reference by name, in expressions or XPath${others.length || childOf.has(qn) ? "" : " (its entity is unused too)"}`);
            }
        }
    }
    for (const u of g.units) {
        if (!scope.has(u.module) || u.type !== "Enumerations$Enumeration") continue;
        if (!fromOthers(u.label, u.id).length) continue; // the whole enumeration is listed above
        const en = client.project.read(u.id);
        for (const v of en.Values || []) {
            if (!v || !v.Name) continue;
            const vq = `${u.label}.${v.Name}`;
            if (g.usesOf(vq).some(e => e.unit !== u.id) || g.literals.has(v.Name) || code.includes(vq) || code.includes(`.${v.Name})`)) continue;
            values.push(`${vq} - no ${vq} in expressions, no decision case or XPath text '${v.Name}' (users may still pick it in a drop-down)`);
        }
    }
    const scopeText = moduleName && moduleName !== true ? moduleName : `the app's own modules (${[...scope].join(", ")})`;
    const lines = [`Probably unused in ${scopeText}: ${docs.length} document(s), ${entities.length} entit(ies), ${attrs.length} attribute(s), ${values.length} enumeration value(s).`,
        "Nothing is deleted. Before a delete: usages <name> (code, reflection and dynamic names cannot be seen), and ask the user."];
    const block = (title, list) => {
        if (!list.length) return;
        lines.push(`${title}:`);
        for (const l of list.sort().slice(0, 150)) lines.push("  " + l);
        if (list.length > 150) lines.push(`  ... ${list.length - 150} more (narrow it: unused <Module>)`);
    };
    block("Documents", docs);
    block("Entities", entities);
    block("Attributes", attrs);
    block("Enumeration values", values);
    if (entry.size) lines.push(`Not listed (entry points): ${[...entry].map(([k, n]) => `${n} ${k}`).join(", ")}; menus, home pages, scheduled events, published services, after-startup and event handlers count as references.`);
    return lines.join("\n");
}

module.exports = { unused, CHECKED, codeText, extract, Graph, graph, usages, known, xpathPaths, exprPaths, SELF };
