"use strict";
// EXPRESSION CHECK / XPATH CHECK: finds every expression and XPath constraint in the stored model (plain units, as
// mpr.js reads them) and checks it with expr.js / xpath.js in its context: the microflow's parameters and variables,
// the page's parameters, variables and data containers ($currentObject), the entity a retrieve, data source, selector
// or access rule constrains, and the type the value must have (attribute, variable, parameter, return value,
// Boolean condition). Runs on the units a change file created or changed (only expressions it wrote or changed) and,
// for the selftest, on a whole project (Studio Pro's own expressions must give no errors).
const bson = require("./bson");
const { toPlain } = require("./convert");
const { T, show, fromStored, assignable, checkExpression } = require("./expr");
const { checkXPath } = require("./xpath");

// ------------------------------------------------------------------------------------------------ System module
// The System module is not stored in the project. Entities marked partial may have members this table lacks
// (newer Mendix versions): a member not found there is a warning, not an error.
const S = "String";
const SYSTEM_ENTITIES = {
    "System.User": { attrs: { Name: S, Password: S, LastLogin: "DateTime", Blocked: "Boolean", BlockedSince: "DateTime", Active: "Boolean", FailedLogins: "Integer", WebServiceUser: "Boolean", IsAnonymous: "Boolean" } },
    "System.UserRole": { attrs: { Name: S, ModelGUID: S, Description: S } },
    "System.Language": { attrs: { Code: S, Description: S } },
    "System.TimeZone": { attrs: { Code: S, Description: S, RawOffset: "Integer" } },
    "System.Session": { attrs: { SessionId: S, CSRFToken: S, LastActive: "DateTime", ReadOnlyHashKey: S }, partial: true },
    "System.FileDocument": { attrs: { FileID: "Long", Name: S, DeleteAfterDownload: "Boolean", Contents: "Binary", HasContents: "Boolean", Size: "Long" } },
    "System.Image": { gen: "System.FileDocument", attrs: { PublicThumbnailPath: S, EnableCaching: "Boolean" } },
    "System.Thumbnail": { gen: "System.Image", attrs: {}, partial: true },
    "System.Error": { attrs: { ErrorType: S, Message: S, Stacktrace: S } },
    "System.SoapFault": { gen: "System.Error", attrs: { Code: S, Reason: S, Node: S, Role: S, Detail: S } },
    "System.HttpMessage": { attrs: { HttpVersion: S, Content: S } },
    "System.HttpRequest": { gen: "System.HttpMessage", attrs: { Uri: S } },
    "System.HttpResponse": { gen: "System.HttpMessage", attrs: { StatusCode: "Integer", ReasonPhrase: S } },
    "System.HttpHeader": { attrs: { Key: S, Value: S } },
    "System.ScheduledEventInformation": { attrs: { Name: S, Description: S, StartTime: "DateTime", EndTime: "DateTime", Status: "Enum:System.EventStatus" }, partial: true },
    "System.Paging": { attrs: { PageNumber: "Long", IsSortable: "Boolean", SortAttribute: S, SortAscending: "Boolean", HasMoreData: "Boolean" }, partial: true },
    "System.XASInstance": { attrs: { XASId: S, LastUpdate: "DateTime", AllowedNumberOfConcurrentUsers: "Integer", PartnerName: S, CustomerName: S }, partial: true },
    "System.Workflow": { attrs: { Name: S, Description: S, StartTime: "DateTime", EndTime: "DateTime", DueDate: "DateTime", CanBeRestarted: "Boolean", CanBeContinued: "Boolean", State: "Enum:System.WorkflowState", Reason: S }, partial: true },
    "System.WorkflowUserTask": { attrs: { Name: S, Description: S, StartTime: "DateTime", DueDate: "DateTime", EndTime: "DateTime", Outcome: S, State: "Enum:System.WorkflowUserTaskState" }, partial: true }
};
const SYSTEM_ASSOCIATIONS = {
    "System.UserRoles": ["System.User", "System.UserRole", "ReferenceSet"],
    "System.grantableRoles": ["System.UserRole", "System.UserRole", "ReferenceSet"],
    "System.User_Language": ["System.User", "System.Language", "Reference"],
    "System.User_TimeZone": ["System.User", "System.TimeZone", "Reference"],
    "System.Session_User": ["System.Session", "System.User", "Reference"],
    "System.HttpHeaders": ["System.HttpHeader", "System.HttpMessage", "Reference"],
    "System.owner": ["*", "System.User", "Reference"],
    "System.changedBy": ["*", "System.User", "Reference"]
};
const BUILTIN_VARIABLES = {
    currentUser: T.obj("System.User"),
    currentSession: T.obj("System.Session"),
    latestError: T.obj("System.Error"),
    latestSoapFault: T.obj("System.SoapFault"),
    latestHttpResponse: T.obj("System.HttpResponse"),
    currentDeviceType: T.enum("System.DeviceType"),
    currentIndex: T.int // the iteration number inside a loop (Mendix 10+)
};

function systemType(s) {
    if (s.startsWith("Enum:")) return T.enum(s.slice(5));
    return { String: T.str, Integer: T.int, Long: T.long, Boolean: T.bool, DateTime: T.date, Binary: T.bin, Decimal: T.dec }[s] || T.any;
}

// Type of a CodeActions$* type (Java / JavaScript action parameters and return types).
function codeType(ct) {
    if (!ct || !ct.$Type) return T.any;
    const k = ct.$Type.split("$")[1];
    if (k === "BasicParameterType") return fromStored(ct.Type);
    if (k === "ConcreteEntityType") return T.obj(ct.Entity);
    if (k === "ListType") {
        const inner = codeType(ct.Parameter);
        return inner.t === "Object" ? T.list(inner.e) : T.any;
    }
    if (k === "EntityTypeParameterType" || k === "ParameterizedEntityType" || k === "TypeParameter") return T.any;
    if (/^(String|Integer|Long|Decimal|Boolean|DateTime|Void|Float)Type$/.test(k)) return fromStored({ $Type: "DataTypes$" + k });
    if (k === "EnumerationType") return T.enum(ct.Enumeration || null);
    return T.any;
}

// ------------------------------------------------------------------------------------------------ model index
class ModelIndex {
    constructor(project) {
        this.project = project;
        this.entities = new Map();
        this.associations = new Map();
        this.enumerations = new Map();
        this.constants = new Map();
        this.docs = new Map(); // qn -> unit id (flows, pages, snippets, Java/JavaScript actions, rules)
        this.docCache = new Map();
        this.modules = new Set();
        this.roles = null;
        this.build();
    }

    info(id) {
        const pr = this.project;
        const e = pr.cache && !pr.plain.has(id) && pr.cache.units.get(id);
        if (e && pr.units.get(id) && e.hash === pr.units.get(id).hash) return { type: e.type, name: e.name };
        const p = pr.read(id);
        return { type: p.$Type, name: typeof p.Name === "string" ? p.Name : null };
    }

    moduleOf(id) {
        const pr = this.project;
        for (let cur = id, n = 0; cur && n < 50; n++) {
            const inf = this.info(cur);
            if (/^Projects\$Module/.test(inf.type)) return inf.name;
            cur = pr.units.get(cur) && pr.units.get(cur).containerId;
        }
        return null;
    }

    build() {
        const pr = this.project;
        const domainModels = [];
        for (const [id] of pr.units) {
            const inf = this.info(id);
            if (/^Projects\$Module/.test(inf.type)) {
                this.modules.add(inf.name);
                continue;
            }
            if (inf.type === "DomainModels$DomainModel") domainModels.push(id);
            else if (inf.type === "Security$ProjectSecurity") this.securityUnit = id;
            else if (inf.name && /^(Enumerations\$Enumeration|Constants\$Constant|Microflows\$(Microflow|Nanoflow|Rule)|Forms\$(Page|Snippet|Layout)|JavaActions\$JavaAction|JavaScriptActions\$JavaScriptAction|Workflows\$Workflow)$/.test(inf.type)) {
                const mod = this.moduleOf(id);
                if (!mod) continue;
                const qn = `${mod}.${inf.name}`;
                if (inf.type === "Enumerations$Enumeration") {
                    const u = pr.read(id);
                    this.enumerations.set(qn, { values: (u.Values || []).map(v => v.Name) });
                } else if (inf.type === "Constants$Constant") this.constants.set(qn, id);
                else this.docs.set(qn, { id, type: inf.type });
            }
        }
        const byId = new Map();
        const pending = [];
        for (const id of domainModels) {
            const mod = this.moduleOf(id);
            const dm = pr.read(id);
            for (const e of dm.Entities || []) {
                const qn = `${mod}.${e.Name}`;
                byId.set(e.$ID, qn);
                const g = e.MaybeGeneralization || {};
                const attrs = new Map();
                for (const a of e.Attributes || []) attrs.set(a.Name, { name: a.Name, type: fromStored(a.NewType) });
                this.entities.set(qn, { qn, attrs, gen: g.$Type === "DomainModels$Generalization" ? g.Generalization || null : null,
                    flags: { owner: !!g.HasOwnerAttr, changedBy: !!g.HasChangedByAttr, createdDate: !!g.HasCreatedDateAttr, changedDate: !!g.HasChangedDateAttr },
                    view: !!(e.Source && /View/.test(e.Source.$Type || "")) });
            }
            pending.push([mod, dm]);
        }
        for (const [mod, dm] of pending) {
            for (const a of dm.Associations || []) this.associations.set(`${mod}.${a.Name}`, { qn: `${mod}.${a.Name}`, parent: byId.get(a.ParentPointer), child: byId.get(a.ChildPointer), type: a.Type || "Reference", owner: a.Owner || "Default" });
            for (const a of dm.CrossAssociations || []) this.associations.set(`${mod}.${a.Name}`, { qn: `${mod}.${a.Name}`, parent: byId.get(a.ParentPointer), child: a.Child, type: a.Type || "Reference", owner: a.Owner || "Default" });
        }
        for (const [qn, [parent, child, type]] of Object.entries(SYSTEM_ASSOCIATIONS)) this.associations.set(qn, { qn, parent, child, type, owner: "Default", system: true });
    }

    // ---- entities
    entity(qn) {
        if (!qn) return null;
        const e = this.entities.get(qn);
        if (e) return e;
        const s = SYSTEM_ENTITIES[qn];
        if (!s) return null;
        const se = { qn, gen: s.gen || null, attrs: new Map(Object.entries(s.attrs).map(([n, t]) => [n, { name: n, type: systemType(t) }])), flags: {}, system: true, partialSystem: !!s.partial };
        this.entities.set(qn, se);
        return se;
    }
    // An entity this checker cannot see (System entity not in the table, module not in the project): no member checks.
    unknownEntity(qn) {
        return !!qn && !this.entity(qn) && (qn.startsWith("System.") || !this.modules.has(qn.split(".")[0]));
    }
    unknownModule(name) {
        return name !== "System" && !this.modules.has(name);
    }
    chain(qn) {
        const out = [];
        for (let cur = qn, n = 0; cur && n < 30; n++) {
            out.push(cur);
            const e = this.entity(cur);
            cur = e ? e.gen : null;
        }
        return out;
    }
    root(qn) {
        const c = this.chain(qn);
        return c[c.length - 1];
    }
    // Members may exist that this checker does not know (inherits from an unknown or partial System entity).
    partial(qn) {
        return this.chain(qn).some(x => {
            const e = this.entity(x);
            return !e || e.partialSystem;
        });
    }
    isA(sub, sup) {
        if (!sub || !sup || sub === sup) return true;
        return this.chain(sub).includes(sup);
    }
    flags(qn) {
        const r = this.entity(this.root(qn));
        if (!r || r.system || !this.entities.has(r.qn)) return { owner: true, changedBy: true, createdDate: true, changedDate: true, unknown: true };
        return r.flags;
    }
    attribute(qn, name) {
        for (const x of this.chain(qn)) {
            const e = this.entity(x);
            if (e && e.attrs.has(name)) return e.attrs.get(name);
        }
        const f = this.flags(qn);
        if ((name === "createdDate" && f.createdDate) || (name === "changedDate" && f.changedDate)) return { name, type: T.date };
        return null;
    }
    attributeNames(qn) {
        const names = [];
        for (const x of this.chain(qn)) {
            const e = this.entity(x);
            if (e) names.push(...e.attrs.keys());
        }
        const f = this.flags(qn);
        if (f.createdDate && !f.unknown) names.push("createdDate");
        if (f.changedDate && !f.unknown) names.push("changedDate");
        return names;
    }
    entityNames() {
        return [...this.entities.keys()].filter(q => !this.entities.get(q).system);
    }
    // ---- associations
    association(qn) {
        return this.associations.get(qn) || null;
    }
    // "forward" (from parent to child), "reverse", or null when the association does not touch qn.
    direction(asc, qn) {
        if (asc.parent === "*") {
            const f = this.flags(qn);
            return (asc.qn === "System.owner" ? f.owner : f.changedBy) ? "forward" : this.entities.has(qn) && !this.partial(qn) ? null : "forward";
        }
        if (!asc.parent || !asc.child) return "forward"; // a side that is not in this project
        if (this.isA(qn, asc.parent)) return "forward";
        if (this.isA(qn, asc.child)) return "reverse";
        if (this.unknownEntity(asc.parent) || this.unknownEntity(asc.child)) return "forward";
        return null;
    }
    associationsOf(qn, both = false) {
        const out = [];
        for (const a of this.associations.values()) {
            if (a.parent === "*") {
                if (this.direction(a, qn)) out.push(a);
                continue;
            }
            if (this.isA(qn, a.parent) || (both && this.isA(qn, a.child))) out.push(a);
        }
        return out;
    }
    // ---- other names
    enumeration(qn) {
        return this.enumerations.get(qn) || null;
    }
    enumerationNames() {
        return [...this.enumerations.keys()];
    }
    constant(qn) {
        const id = this.constants.get(qn);
        if (!id) return null;
        const c = this.project.read(id);
        return fromStored(c.Type || c.DataType);
    }
    constantNames() {
        return [...this.constants.keys()];
    }
    userRoles() {
        if (this.roles) return this.roles;
        if (!this.securityUnit) return null;
        const s = this.project.read(this.securityUnit);
        this.roles = (s.UserRoles || []).map(r => r.Name);
        return this.roles;
    }
    // ---- documents (lazy)
    doc(qn) {
        if (!qn) return null;
        if (this.docCache.has(qn)) return this.docCache.get(qn);
        const d = this.docs.get(qn);
        let r = null;
        if (d && this.project.units.has(d.id)) {
            const u = this.project.read(d.id);
            r = { type: d.type, unit: u, params: new Map() };
            if (/^Microflows\$/.test(d.type)) {
                r.returns = fromStored(u.MicroflowReturnType || u.ReturnType);
                for (const o of (u.ObjectCollection && u.ObjectCollection.Objects) || []) if (/Parameter/.test(o.$Type) && o.Name) r.params.set(o.Name, fromStored(o.VariableType));
            } else if (/^Forms\$/.test(d.type)) {
                for (const p of u.Parameters || []) r.params.set(p.Name, fromStored(p.ParameterType));
            } else if (/Java(Script)?Actions/.test(d.type)) {
                r.returns = codeType(u.JavaReturnType);
                for (const p of u.Parameters || []) r.params.set(p.Name, codeType(p.ParameterType));
            }
        }
        this.docCache.set(qn, r);
        return r;
    }
    // type of the parameter "Module.Doc.Param"
    parameter(qn) {
        if (!qn) return null;
        const i = qn.lastIndexOf(".");
        const d = this.doc(qn.slice(0, i));
        return d && d.params.has(qn.slice(i + 1)) ? d.params.get(qn.slice(i + 1)) : null;
    }
}

// ------------------------------------------------------------------------------------------------ helpers
const entityOfRef = ref => {
    if (!ref || !ref.$Type) return null;
    if (ref.Entity) return ref.Entity;
    const steps = ref.Steps || [];
    return steps.length ? steps[steps.length - 1].DestinationEntity || null : null;
};
const elementType = t => (t && (t.t === "List" || t.t === "Object") ? t.e : null);
const short = id => String(id || "").slice(0, 8);
function textOf(t) {
    if (!t) return "";
    if (typeof t === "string") return t;
    const items = t.Items || t.Translations || [];
    return items.length ? items[0].Text || "" : "";
}

// ------------------------------------------------------------------------------------------------ flows
const FLOW_DESCRIBE = {
    "Microflows$RetrieveAction": a => `retrieve ${a.ResultVariableName}`,
    "Microflows$ChangeAction": a => `change ${a.ChangeVariableName}`,
    "Microflows$CreateChangeAction": a => `create ${a.VariableName}`,
    "Microflows$CreateVariableAction": a => `variable ${a.VariableName}`,
    "Microflows$ChangeVariableAction": a => `set ${a.ChangeVariableName}`,
    "Microflows$LogMessageAction": () => "log message",
    "Microflows$ShowMessageAction": () => "message",
    "Microflows$MicroflowCallAction": a => `call ${(a.MicroflowCall || {}).Microflow || ""}`,
    "Microflows$NanoflowCallAction": a => `call ${(a.NanoflowCall || {}).Nanoflow || ""}`,
    "Microflows$JavaActionCallAction": a => `call ${a.JavaAction || ""}`,
    "Microflows$JavaScriptActionCallAction": a => `call ${a.JavaScriptAction || ""}`,
    "Microflows$ShowPageAction": a => `show page ${(a.PageSettings || a.FormSettings || {}).Form || ""}`,
    "Microflows$ShowFormAction": a => `show page ${(a.PageSettings || a.FormSettings || {}).Form || ""}`,
    "Microflows$AggregateAction": a => `aggregate ${a.VariableName}`,
    "Microflows$ListOperationsAction": a => `list operation ${a.ResultVariableName}`,
    "Microflows$ChangeListAction": a => `change list ${a.ChangeVariableName}`,
    "Microflows$RestCallAction": () => "call REST",
    "Microflows$ValidationFeedbackAction": () => "validation feedback"
};

function flowContext(unit, model) {
    const vars = new Map();
    const objects = [];
    const flows = [];
    const collect = coll => {
        for (const o of (coll && coll.Objects) || []) {
            objects.push(o);
            if (o.ObjectCollection) collect(o.ObjectCollection);
        }
    };
    collect(unit.ObjectCollection);
    flows.push(...(unit.Flows || []));
    const byId = new Map(objects.map(o => [o.$ID, o]));
    // cast: the specialization of the inheritance split case that leads to it
    const castType = act => {
        for (const f of flows) {
            if (f.DestinationPointer !== act.$ID) continue;
            const from = byId.get(f.OriginPointer);
            const c = (f.CaseValues || []).find(x => x.$Type === "Microflows$InheritanceCase");
            if (from && from.$Type === "Microflows$InheritanceSplit" && c && c.Value) return T.obj(c.Value);
        }
        return T.obj(null);
    };
    // pass 1: names (every key that defines a variable), pass 2..: types that depend on other variables
    const defs = [];
    for (const o of objects) {
        if (/Parameter$/.test(o.$Type) && o.Name) {
            vars.set(o.Name, fromStored(o.VariableType));
            continue;
        }
        if (o.$Type === "Microflows$LoopedActivity" && o.LoopSource && o.LoopSource.VariableName) defs.push({ name: o.LoopSource.VariableName, kind: "iterator", src: o.LoopSource });
        const a = o.Action;
        if (!a) continue;
        const walk = x => {
            if (!x || typeof x !== "object") return;
            if (Array.isArray(x)) return x.forEach(walk);
            for (const k of ["ResultVariableName", "OutputVariableName", "VariableName"]) if (typeof x[k] === "string" && x[k] && !(x === a && a.UseReturnVariable === false)) defs.push({ name: x[k], kind: x.$Type, src: x, act: o });
            for (const v of Object.values(x)) if (v && typeof v === "object" && !Buffer.isBuffer(v)) walk(v);
        };
        walk(a);
    }
    for (const d of defs) if (!vars.has(d.name)) vars.set(d.name, T.any);
    const typeOf = d => {
        const x = d.src;
        switch (d.kind) {
            case "iterator":
                return T.obj(elementType(vars.get(x.ListVariableName)));
            case "Microflows$CreateVariableAction":
                return fromStored(x.VariableType);
            case "Microflows$CreateChangeAction":
                return T.obj(x.Entity);
            case "Microflows$CreateListAction":
                return T.list(x.Entity);
            case "Microflows$RetrieveAction": {
                const s = x.RetrieveSource || {};
                if (s.$Type === "Microflows$DatabaseRetrieveSource") return s.Range && s.Range.SingleObject ? T.obj(s.Entity) : T.list(s.Entity);
                if (s.$Type === "Microflows$AssociationRetrieveSource") {
                    const asc = model.association(s.AssociationId);
                    const start = elementType(vars.get(s.StartVariableName));
                    if (!asc || !start) return T.any;
                    const dir = model.direction(asc, start);
                    if (dir === "forward") return asc.type === "ReferenceSet" ? T.list(asc.child) : T.obj(asc.child);
                    if (dir === "reverse") return asc.type === "Reference" && asc.owner === "Both" ? T.obj(asc.parent) : T.list(asc.parent);
                }
                return T.any;
            }
            case "Microflows$MicroflowCallAction": {
                const doc = model.doc((x.MicroflowCall || {}).Microflow);
                return doc ? doc.returns : T.any;
            }
            case "Microflows$NanoflowCallAction": {
                const doc = model.doc((x.NanoflowCall || {}).Nanoflow);
                return doc ? doc.returns : T.any;
            }
            case "Microflows$JavaActionCallAction":
            case "Microflows$JavaScriptActionCallAction": {
                const doc = model.doc(x.JavaAction || x.JavaScriptAction);
                return doc && doc.returns && doc.returns.t !== "Any" ? doc.returns : T.any;
            }
            case "Microflows$AggregateAction": {
                const fn = x.AggregateFunction;
                if (fn === "Count") return T.int;
                if (fn === "Average") return T.dec;
                if (x.UseExpression || fn === "Reduce") return x.ReduceReturnDataType && fn === "Reduce" ? fromStored(x.ReduceReturnDataType) : T.any;
                if (x.Attribute) {
                    const p = x.Attribute.split(".");
                    const at = model.attribute(p.slice(0, 2).join("."), p[2]);
                    if (at) return fn === "Sum" && at.type.t === "Integer" ? T.long : at.type;
                }
                return T.num;
            }
            case "Microflows$ListOperationsAction": {
                const op = x.NewOperation || x.Operation || {};
                const ent = elementType(vars.get(op.ListName || op.ListVariableName));
                const k = (op.$Type || "").split("$")[1] || "";
                if (/^(Head|Find|FindByExpression|FindByAssociation|FindByAttribute)$/.test(k)) return T.obj(ent);
                if (/^(Contains|Equals|ListEquals)$/.test(k)) return T.bool;
                return T.list(ent);
            }
            case "Microflows$CastAction":
                return castType(d.act);
            case "Microflows$ResultHandling":
                return x.VariableType ? fromStored(x.VariableType) : T.any;
            default:
                return x.VariableType ? fromStored(x.VariableType) : T.any;
        }
    };
    for (let round = 0; round < 3; round++) for (const d of defs) vars.set(d.name, typeOf(d));
    return { vars, objects, flows, byId };
}

// ------------------------------------------------------------------------------------------------ checker
class Linter {
    constructor(project, opts = {}) {
        this.project = project;
        this.model = opts.model || new ModelIndex(project);
        this.findings = [];
        this.skip = opts.skip || null; // Set of "elementId|key|value" that existed before the change: not reported
        this.counts = { expressions: 0, xpaths: 0 };
    }

    report(kind, level, where, src, msg) {
        this.findings.push({ kind, level, where, src, msg });
    }

    skipped(el, key) {
        return this.skip && this.skip.has(`${el.$ID}|${key}|${el[key]}`);
    }

    ctx(vars, strict, currentObject) {
        const model = this.model;
        return {
            model,
            strictVariables: strict,
            currentObject,
            variable: n => (vars.has(n) ? vars.get(n) : BUILTIN_VARIABLES[n]),
            variables: () => [...vars.keys(), ...Object.keys(BUILTIN_VARIABLES)]
        };
    }

    expr(el, key, ctx, target, where, opts) {
        const src = el[key];
        if (typeof src !== "string" || !src.trim() || this.skipped(el, key)) return null;
        this.counts.expressions++;
        const r = checkExpression(src, ctx, target, opts);
        for (const p of r.problems) this.report("expression", p.level, where, src, p.msg);
        return r;
    }

    xpath(el, key, entity, ctx, where) {
        const src = el[key];
        if (typeof src !== "string" || !src.trim() || this.skipped(el, key)) return;
        this.counts.xpaths++;
        const r = checkXPath(src, entity, ctx);
        for (const p of r.problems) this.report("xpath", p.level, where, src, p.msg);
    }

    unit(id) {
        const u = this.project.read(id);
        const t = u.$Type;
        const mod = this.model.moduleOf(id);
        const qn = mod && u.Name ? `${mod}.${u.Name}` : mod || id;
        if (/^Microflows\$(Microflow|Nanoflow|Rule)$/.test(t)) return this.flow(u, qn, t);
        if (/^Forms\$(Page|Snippet|Layout)$/.test(t)) return this.page(u, qn);
        if (t === "DomainModels$DomainModel") return this.domain(u, mod);
        if (t === "Navigation$NavigationDocument") return this.navigation(u);
        if (/^Workflows\$Workflow$/.test(t)) return this.generic(u, qn);
        return null;
    }

    // ---- microflows, nanoflows, rules
    flow(u, qn, type) {
        const fc = flowContext(u, this.model);
        const base = this.ctx(fc.vars, true);
        const returns = fromStored(u.MicroflowReturnType || u.ReturnType);
        const nano = type === "Microflows$Nanoflow";
        for (const o of fc.objects) {
            const w = what => `${qn} [${short(o.$ID)}] ${what}`;
            const a = o.Action;
            if (o.$Type === "Microflows$ExclusiveSplit" && o.SplitCondition && o.SplitCondition.$Type === "Microflows$ExpressionSplitCondition") {
                const cases = fc.flows.filter(f => f.OriginPointer === o.$ID).flatMap(f => f.CaseValues || []).filter(c => c.$Type === "Microflows$EnumerationCase").map(c => c.Value);
                const boolCases = cases.length && cases.every(v => v === "true" || v === "false");
                const r = this.expr(o.SplitCondition, "Expression", base, boolCases ? T.bool : null, w(`decision '${o.Caption || ""}'`));
                if (r && !boolCases && r.type && !["Boolean", "Enum", "Any", "Empty"].includes(r.type.t)) this.report("expression", "error", w(`decision '${o.Caption || ""}'`), o.SplitCondition.Expression, `a decision needs a Boolean or an enumeration, the expression gives ${show(r.type)}`);
            }
            if (o.$Type === "Microflows$EndEvent" && returns.t !== "Void") this.expr(o, "ReturnValue", base, returns, w("end event (return value)"));
            if (o.$Type === "Microflows$LoopedActivity" && o.LoopSource && o.LoopSource.WhileExpression !== undefined) this.expr(o.LoopSource, "WhileExpression", base, T.bool, w("while loop"));
            if (!a) continue;
            const desc = (FLOW_DESCRIBE[a.$Type] || (x => x.$Type.split("$")[1]))(a);
            const where = w(desc);
            this.action(a, fc, base, where, nano);
        }
    }

    action(a, fc, base, where, nano) {
        const model = this.model;
        const varType = n => fc.vars.get(n) || T.any;
        switch (a.$Type) {
            case "Microflows$RetrieveAction": {
                const s = a.RetrieveSource || {};
                if (s.$Type === "Microflows$DatabaseRetrieveSource") {
                    this.xpath(s, "XpathConstraint", s.Entity, base, where);
                    this.xpath(s, "XPathConstraint", s.Entity, base, where);
                    if (s.Range && s.Range.$Type === "Microflows$CustomRange") {
                        this.expr(s.Range, "LimitExpression", base, T.long, where + " (limit)");
                        this.expr(s.Range, "OffsetExpression", base, T.long, where + " (offset)");
                    }
                }
                break;
            }
            case "Microflows$ChangeAction":
            case "Microflows$CreateChangeAction": {
                const ent = a.$Type === "Microflows$CreateChangeAction" ? a.Entity : elementType(varType(a.ChangeVariableName));
                for (const it of a.Items || []) {
                    const member = it.Attribute || it.Association || "";
                    const at = `${where} (${member.split(".").pop()})`;
                    if (it.Attribute) {
                        const p = it.Attribute.split(".");
                        const attr = model.attribute(p.slice(0, -1).join("."), p[p.length - 1]);
                        this.expr(it, "Value", base, attr ? attr.type : null, at);
                    } else if (it.Association) {
                        const asc = model.association(it.Association);
                        let target = null;
                        if (asc && ent) {
                            const dir = model.direction(asc, ent);
                            const other = dir === "reverse" ? asc.parent : asc.child;
                            // a reference set takes an object or a list (set, add and remove)
                            target = asc.type === "ReferenceSet" ? { either: [T.obj(other), T.list(other)] } : T.obj(other);
                        }
                        this.either(it, "Value", base, target, at);
                    } else this.expr(it, "Value", base, null, at);
                }
                break;
            }
            case "Microflows$CreateVariableAction":
                this.expr(a, "InitialValue", base, fromStored(a.VariableType), where);
                break;
            case "Microflows$ChangeVariableAction":
                this.expr(a, "Value", base, fc.vars.has(a.ChangeVariableName) ? varType(a.ChangeVariableName) : null, where);
                break;
            case "Microflows$ChangeListAction": {
                const ent = elementType(varType(a.ChangeVariableName));
                const target = a.Type === "Set" ? T.list(ent) : { either: [T.obj(ent), T.list(ent)] };
                if (a.Type !== "Clear") this.either(a, "Value", base, target, where);
                break;
            }
            case "Microflows$LogMessageAction":
                this.expr(a, "Node", base, T.str, where + " (log node)");
                this.template(a.MessageTemplate, base, where);
                break;
            case "Microflows$ShowMessageAction":
            case "Microflows$ValidationFeedbackAction":
                this.template(a.Template || a.FeedbackTemplate, base, where);
                break;
            case "Microflows$AggregateAction": {
                const cur = T.obj(elementType(varType(a.AggregateVariableName)));
                const ctx = { ...base, currentObject: cur };
                if (a.UseExpression || a.AggregateFunction === "Reduce") {
                    const init = this.expr(a, "ReduceInitialValueExpression", ctx, a.AggregateFunction === "Reduce" ? fromStored(a.ReduceReturnDataType) : null, where + " (initial value)");
                    const vars = new Map([...(init ? [] : []), ["currentResult", a.AggregateFunction === "Reduce" ? fromStored(a.ReduceReturnDataType) : T.any]]);
                    const ctx2 = { ...ctx, variable: n => (vars.has(n) ? vars.get(n) : base.variable(n)), variables: () => [...base.variables(), ...vars.keys()] };
                    this.expr(a, "Expression", ctx2, a.AggregateFunction === "Reduce" ? fromStored(a.ReduceReturnDataType) : null, where + " (expression)");
                }
                break;
            }
            case "Microflows$ListOperationsAction": {
                const op = a.NewOperation || a.Operation || {};
                const cur = T.obj(elementType(varType(op.ListName || op.ListVariableName)));
                const ctx = { ...base, currentObject: cur };
                const k = (op.$Type || "").split("$")[1];
                if (op.Expression !== undefined) {
                    if (/^(FindByExpression|FilterByExpression)$/.test(k)) this.expr(op, "Expression", ctx, T.bool, where);
                    else if (op.Attribute || op.Association) {
                        // find/filter by member: the value has the member's type
                        let target = null;
                        if (op.Attribute) {
                            const p = op.Attribute.split(".");
                            const at = model.attribute(p.slice(0, -1).join("."), p[p.length - 1]);
                            target = at ? at.type : null;
                        }
                        this.expr(op, "Expression", base, target, where);
                    } else this.expr(op, "Expression", ctx, null, where);
                }
                if (op.CustomRange) {
                    this.expr(op.CustomRange, "LimitExpression", base, T.long, where + " (limit)");
                    this.expr(op.CustomRange, "OffsetExpression", base, T.long, where + " (offset)");
                }
                break;
            }
            case "Microflows$MicroflowCallAction":
            case "Microflows$NanoflowCallAction": {
                const call = a.MicroflowCall || a.NanoflowCall || {};
                for (const m of call.ParameterMappings || []) {
                    const pt = model.parameter(m.Parameter);
                    this.expr(m, "Argument", base, pt, `${where} (argument ${String(m.Parameter || "").split(".").pop()})`);
                }
                break;
            }
            case "Microflows$JavaActionCallAction":
            case "Microflows$JavaScriptActionCallAction":
                for (const m of a.ParameterMappings || []) {
                    const v = m.Value || m.ParameterValue;
                    const pt = model.parameter(m.Parameter);
                    if (v && v.$Type === "Microflows$BasicCodeActionParameterValue") this.expr(v, "Argument", base, pt && pt.t !== "Any" ? pt : null, `${where} (argument ${String(m.Parameter || "").split(".").pop()})`);
                    else if (m.Argument !== undefined) this.expr(m, "Argument", base, null, `${where} (argument ${String(m.Parameter || "").split(".").pop()})`);
                }
                break;
            case "Microflows$ShowPageAction":
            case "Microflows$ShowFormAction": {
                const s = a.PageSettings || a.FormSettings || {};
                for (const m of s.ParameterMappings || []) this.expr(m, "Argument", base, model.parameter(m.Parameter), `${where} (argument ${String(m.Parameter || "").split(".").pop()})`);
                break;
            }
            case "Microflows$RestCallAction":
                this.expr(a, "TimeOutExpression", base, T.long, where + " (timeout)");
                for (const hd of (a.HttpConfiguration && a.HttpConfiguration.HttpHeaderEntries) || []) this.expr(hd, "Value", base, T.str, `${where} (header ${hd.Key || ""})`);
                this.generic(a, where, base);
                break;
            default:
                this.generic(a, where, base);
        }
    }

    // a target with alternatives (reference set add/remove: an object or a list)
    either(el, key, ctx, target, where) {
        if (!target || !target.either) return this.expr(el, key, ctx, target, where);
        const src = el[key];
        if (typeof src !== "string" || !src.trim() || this.skipped(el, key)) return null;
        this.counts.expressions++;
        const r = checkExpression(src, ctx, null);
        for (const p of r.problems) this.report("expression", p.level, where, src, p.msg);
        if (!target.either.some(t => !assignable(r.type, t, this.model))) {
            const p = assignable(r.type, target.either[0], this.model);
            this.report("expression", p.level, where, src, `the expression gives ${show(r.type)}, but ${target.either.map(show).join(" or ")} is expected`);
        }
        return r;
    }

    template(tpl, ctx, where) {
        if (!tpl) return;
        for (const p of tpl.Parameters || tpl.Arguments || []) this.expr(p, "Expression", ctx, null, `${where} (text parameter)`, { notList: true });
    }

    // Expression/XPath fields this checker has no specific rule for: names are checked, no target type.
    generic(obj, where, ctx) {
        const base = ctx || this.ctx(new Map(), false);
        const walk = x => {
            if (!x || typeof x !== "object" || Buffer.isBuffer(x)) return;
            if (Array.isArray(x)) return x.forEach(walk);
            for (const [k, v] of Object.entries(x)) {
                if (typeof v === "string") {
                    if (/^(Expression|Argument|TimeOutExpression|ValueExpression)$/.test(k) && x.$Type !== "CustomWidgets$WidgetValue") this.expr(x, k, base, null, where);
                    else if (/^X[Pp]ath(Constraint)?$/.test(k)) this.xpath(x, k, x.Entity || entityOfRef(x.EntityRef) || null, base, where);
                } else if (v && typeof v === "object") walk(v);
            }
        };
        walk(obj);
    }

    // ---- domain model: access rule XPath constraints
    domain(dm, mod) {
        const ctx = this.ctx(new Map(), false);
        for (const e of dm.Entities || []) {
            for (const r of e.AccessRules || []) this.xpath(r, "XPathConstraint", `${mod}.${e.Name}`, ctx, `${mod}.${e.Name} access rule (${(r.AllowedModuleRoles || []).join(", ")})`);
        }
    }

    navigation(nav) {
        const ctx = this.ctx(new Map(), false);
        const walk = x => {
            if (!x || typeof x !== "object" || Buffer.isBuffer(x)) return;
            if (Array.isArray(x)) return x.forEach(walk);
            if (x.$Type === "Navigation$OfflineEntityConfig") this.xpath(x, "Constraint", x.Entity, ctx, `Navigation offline constraint (${x.Entity})`);
            for (const v of Object.values(x)) if (v && typeof v === "object") walk(v);
        };
        walk(nav);
    }

    // ---- pages, snippets, layouts
    page(u, qn) {
        const model = this.model;
        const vars = new Map();
        for (const p of u.Parameters || []) vars.set(p.Name, fromStored(p.ParameterType));
        for (const v of u.Variables || []) vars.set(v.Name, fromStored(v.VariableType));
        // every data container by widget name ($dataView1 in newer versions); its entity
        const widgetEntity = new Map();
        const sourceEntity = src => {
            if (!src) return null;
            const e = entityOfRef(src.EntityRef);
            if (e) return e;
            const flow = (src.MicroflowSettings && src.MicroflowSettings.Microflow) || src.Microflow || (src.NanoflowSettings && src.NanoflowSettings.Nanoflow) || src.Nanoflow;
            if (flow) {
                const d = model.doc(flow);
                return d ? elementType(d.returns) : null;
            }
            if (src.ListenTarget) return widgetEntity.get(src.ListenTarget) || null;
            const sv = src.SourceVariable;
            if (sv) {
                const n = (sv.PageParameter || sv.SnippetParameter || sv.LocalVariable || "").split(".").pop();
                return n && vars.has(n) ? elementType(vars.get(n)) : sv.Widget ? widgetEntity.get(sv.Widget) || null : null;
            }
            return null;
        };
        const containerEntity = w => {
            if (w.DataSource) return sourceEntity(w.DataSource);
            return null;
        };
        const pre = x => {
            if (!x || typeof x !== "object" || Buffer.isBuffer(x)) return;
            if (Array.isArray(x)) return x.forEach(pre);
            if (x.Name && x.DataSource && /^Forms\$/.test(x.$Type)) {
                const e = containerEntity(x);
                if (e) widgetEntity.set(x.Name, e);
            }
            if (x.$Type === "CustomWidgets$CustomWidget" && x.Name) {
                const ds = this.widgetSources(x, sourceEntity);
                if (ds.size === 1) widgetEntity.set(x.Name, [...ds.values()][0]);
            }
            for (const v of Object.values(x)) if (v && typeof v === "object") pre(v);
        };
        // two passes so listen targets defined later in the page resolve
        pre(u);
        pre(u);
        const pageVars = new Map(vars);
        for (const [n, e] of widgetEntity) if (!pageVars.has(n)) pageVars.set(n, T.obj(e));
        let top = u.Entity ? T.obj(u.Entity) : undefined; // old snippets with an entity
        if (u.$Type === "Forms$Snippet" && top === undefined) top = T.any;
        if (u.$Type === "Forms$Layout") top = T.any;
        const strict = u.$Type !== "Forms$Layout";
        for (const v of u.Variables || []) this.expr(v, "DefaultValue", this.ctx(pageVars, strict, undefined), fromStored(v.VariableType), `${qn} variable $${v.Name} (default value)`);
        this.widgets(u, qn, { vars: pageVars, strict, current: top, widget: null, sourceEntity });
    }

    // entities of a custom widget's data source properties: TypePointer of the WidgetPropertyType -> entity
    widgetSources(cw, sourceEntity) {
        const out = new Map();
        const walk = x => {
            if (!x || typeof x !== "object" || Buffer.isBuffer(x)) return;
            if (Array.isArray(x)) return x.forEach(walk);
            if (x.$Type === "CustomWidgets$WidgetProperty" && x.Value && x.Value.DataSource) {
                const e = sourceEntity(x.Value.DataSource);
                if (e) out.set(x.TypePointer, e);
            }
            if (x.$Type === "CustomWidgets$CustomWidgetType") return;
            for (const v of Object.values(x)) if (v && typeof v === "object") walk(v);
        };
        walk(cw.Object);
        return out;
    }

    widgets(node, qn, st) {
        if (!node || typeof node !== "object" || Buffer.isBuffer(node)) return;
        if (Array.isArray(node)) return node.forEach(n => this.widgets(n, qn, st));
        const t = node.$Type || "";
        if (t === "CustomWidgets$CustomWidgetType" || t === "Forms$PageParameter" || t === "Forms$LocalVariable" || t === "Forms$SnippetParameter") return;
        if (t === "CustomWidgets$CustomWidget") return this.customWidget(node, qn, st);
        const name = node.Name && /^Forms\$/.test(t) && t !== "Forms$Page" && t !== "Forms$Snippet" && t !== "Forms$Layout" ? node.Name : st.widget;
        const label = what => `${qn} ${name || ""}${what ? ` (${what})` : ""}`.replace(/ +\(/, " (");
        const ctx = this.ctx(st.vars, st.strict, st.current);
        // properties of this widget, in the enclosing data container's context
        if (node.ConditionalVisibilitySettings) this.expr(node.ConditionalVisibilitySettings, "Expression", ctx, T.bool, label("visible"));
        if (node.ConditionalEditabilitySettings) this.expr(node.ConditionalEditabilitySettings, "Expression", ctx, T.bool, label("editable"));
        if (node.Validation && node.Validation.$Type === "Forms$WidgetValidation") {
            const attr = node.AttributeRef && node.AttributeRef.Attribute;
            let vt = T.any;
            if (attr) {
                const p = attr.split(".");
                const a = this.model.attribute(p.slice(0, -1).join("."), p[p.length - 1]);
                if (a) vt = a.type;
            }
            const vctx = { ...ctx, variable: n => (n === "value" ? vt : ctx.variable(n)), variables: () => [...ctx.variables(), "value"] };
            this.expr(node.Validation, "Expression", vctx, T.bool, label("validation"));
        }
        // data source XPath of this container: its own entity
        const src = node.DataSource;
        let inner = st.current;
        if (src && /^Forms\$/.test(t)) {
            const e = st.sourceEntity(src);
            for (const k of ["XPathConstraint", "XpathConstraint"]) this.xpath(src, k, e, ctx, label("data source XPath"));
            if (src.SearchBar) this.searchBar(src.SearchBar, e, ctx, label);
            this.mappings(src, ctx, label);
            inner = e ? T.obj(e) : T.any;
        }
        if (node.SelectorSource && node.SelectorSource.$Type === "Forms$SelectorXPathSource") {
            const attr = node.AttributeRef && node.AttributeRef.Attribute;
            const e = attr ? attr.split(".").slice(0, -1).join(".") : entityOfRef(node.AttributeRef && node.AttributeRef.EntityRef);
            this.xpath(node.SelectorSource, "XPathConstraint", e || null, ctx, label("selectable objects XPath"));
        }
        const sub = { ...st, current: inner, widget: name };
        for (const [k, v] of Object.entries(node)) {
            if (["ConditionalVisibilitySettings", "ConditionalEditabilitySettings", "Validation", "SelectorSource"].includes(k) || !v || typeof v !== "object") continue;
            if (k === "DataSource") continue;
            if (v.$Type === "Forms$ClientTemplate" || (v.$Type && /Template$/.test(v.$Type) && v.Parameters)) {
                for (const p of v.Parameters || []) this.expr(p, "Expression", ctx, null, label("text parameter"), { notList: true });
                continue;
            }
            // actions and the widget's own settings run with the enclosing object; child widgets with this container's
            const child = /Widgets$|^(Rows|Columns|Arguments|TabPages|Items|Objects|FooterWidgets|Contents)$/.test(k) ? sub : { ...st, widget: name };
            if (/Settings$|Action$/.test(k) && v.$Type) this.mappings(v, ctx, label);
            this.widgets(v, qn, child);
        }
    }

    // parameter mappings of page actions (call microflow/nanoflow, show page) and data source flows
    mappings(x, ctx, label) {
        const walk = y => {
            if (!y || typeof y !== "object" || Buffer.isBuffer(y)) return;
            if (Array.isArray(y)) return y.forEach(walk);
            if (/ParameterMapping$/.test(y.$Type || "")) {
                const key = y.Expression !== undefined ? "Expression" : "Argument";
                if (!y.__seen) {
                    Object.defineProperty(y, "__seen", { value: true, enumerable: false });
                    this.expr(y, key, ctx, this.model.parameter(y.Parameter), label(`argument ${String(y.Parameter || "").split(".").pop()}`));
                }
                return;
            }
            for (const v of Object.values(y)) if (v && typeof v === "object") walk(v);
        };
        walk(x);
    }

    searchBar(bar, entity, ctx, label) {
        const walk = y => {
            if (!y || typeof y !== "object" || Buffer.isBuffer(y)) return;
            if (Array.isArray(y)) return y.forEach(walk);
            if (y.XPathConstraint && y.AttributeRef) {
                const attr = y.AttributeRef.Attribute || "";
                this.xpath(y, "XPathConstraint", attr.split(".").slice(0, -1).join(".") || entity, ctx, label(`search field ${y.Name || ""}`));
            }
            for (const v of Object.values(y)) if (v && typeof v === "object") walk(v);
        };
        walk(bar);
    }

    customWidget(cw, qn, st) {
        const types = new Map();
        const collect = x => {
            if (!x || typeof x !== "object" || Buffer.isBuffer(x)) return;
            if (Array.isArray(x)) return x.forEach(collect);
            if (x.$ID && /^CustomWidgets\$Widget(Property|Value)Type$/.test(x.$Type)) types.set(x.$ID, x);
            for (const v of Object.values(x)) if (v && typeof v === "object") collect(v);
        };
        collect(cw.Type);
        const name = cw.Name || st.widget;
        const label = what => `${qn} ${name || ""} (${what})`;
        const outer = this.ctx(st.vars, st.strict, st.current);
        if (cw.ConditionalVisibilitySettings) this.expr(cw.ConditionalVisibilitySettings, "Expression", outer, T.bool, label("visible"));
        if (cw.ConditionalEditabilitySettings) this.expr(cw.ConditionalEditabilitySettings, "Expression", outer, T.bool, label("editable"));
        // an object (the widget, or one item of an object list such as a data grid 2 column), with its parent objects
        const object = (obj, parents) => {
            const props = new Map(); // property key -> { prop, ptype }
            for (const p of (obj && obj.Properties) || []) {
                const pt = types.get(p.TypePointer);
                if (pt) props.set(pt.PropertyKey, { prop: p, ptype: pt });
            }
            const scope = [props, ...parents];
            const find = ref => {
                let key = ref;
                let level = 0;
                while (key.startsWith("../")) {
                    key = key.slice(3);
                    level++;
                }
                const m = scope[level];
                return m ? m.get(key) : null;
            };
            const dsEntity = ref => {
                const p = ref && find(ref);
                return p && p.prop.Value && p.prop.Value.DataSource ? st.sourceEntity(p.prop.Value.DataSource) : null;
            };
            for (const [key, { prop, ptype }] of props) {
                const vt = ptype.ValueType || {};
                const v = prop.Value;
                if (!v) continue;
                const linked = vt.DataSourceProperty ? dsEntity(vt.DataSourceProperty) : null;
                const cur = vt.DataSourceProperty ? (linked ? T.obj(linked) : T.any) : st.current;
                const ctx = this.ctx(st.vars, st.strict, cur);
                const where = label(key);
                if (vt.Type === "Expression") {
                    let target = null;
                    const rt = vt.ReturnType;
                    if (rt && !rt.IsList) {
                        if (rt.Type && rt.Type !== "None") target = fromStored({ $Type: `DataTypes$${rt.Type}Type` });
                        else if (rt.AssignableTo) {
                            const other = find(rt.AssignableTo);
                            const attr = other && other.prop.Value && other.prop.Value.AttributeRef && other.prop.Value.AttributeRef.Attribute;
                            if (attr) {
                                const p = attr.split(".");
                                const a = this.model.attribute(p.slice(0, -1).join("."), p[p.length - 1]);
                                if (a) target = a.type;
                            }
                        }
                    }
                    if (rt && rt.IsList) target = null;
                    this.expr(v, "Expression", ctx, target && target.t !== "Any" ? target : null, where);
                } else if (vt.Type === "TextTemplate" && v.TextTemplate) {
                    for (const p of v.TextTemplate.Parameters || []) this.expr(p, "Expression", ctx, null, where + " text parameter", { notList: true });
                } else if (vt.Type === "DataSource" && v.DataSource) {
                    const e = st.sourceEntity(v.DataSource);
                    for (const k of ["XPathConstraint", "XpathConstraint"]) this.xpath(v.DataSource, k, e, outer, label(`${key} XPath`));
                    this.mappings(v.DataSource, outer, label);
                } else if (vt.Type === "Action" && v.Action) {
                    this.mappings(v.Action, ctx, w => label(`${key} ${w}`));
                } else if (vt.Type === "Widgets") {
                    this.widgets(v.Widgets, qn, { ...st, current: cur, widget: name });
                } else if (vt.Type === "Object") {
                    for (const o of v.Objects || []) object(o, scope);
                } else if (vt.Type === "Association" || vt.Type === "Selection") {
                    if (v.XPathConstraint) this.xpath(v, "XPathConstraint", null, outer, label(`${key} XPath`));
                }
            }
        };
        object(cw.Object, []);
    }
}

// ------------------------------------------------------------------------------------------------ entry points
const UNIT_TYPES = /^(Microflows\$(Microflow|Nanoflow|Rule)|Forms\$(Page|Snippet|Layout)|DomainModels\$DomainModel|Navigation\$NavigationDocument|Workflows\$Workflow)$/;

function lintIds(project, ids, opts = {}) {
    const lint = new Linter(project, opts);
    for (const id of ids) {
        if (!project.units.has(id)) continue;
        const inf = lint.model.info(id);
        if (!UNIT_TYPES.test(inf.type)) continue;
        try {
            lint.unit(id);
        } catch (e) {
            lint.report("expression", "warning", lint.model.moduleOf(id) + "." + (inf.name || id), "", `could not check this document: ${e.message}`);
        }
    }
    return { findings: lint.findings, counts: lint.counts, model: lint.model };
}

// Whole project (selftest): every expression and XPath Studio Pro stored.
function lintProject(project) {
    return lintIds(project, [...project.units.keys()]);
}

// The units a change created or changed; on changed units only expressions and XPath that are new or different.
function lintChanges(client) {
    const project = client.project;
    const ch = client.changes;
    const ids = [...new Set([...ch.updated, ...ch.created.keys()])].filter(id => !ch.deleted.has(id));
    const skip = new Set();
    for (const id of ch.updated) {
        if (ch.created.has(id)) continue;
        let before;
        try {
            before = toPlain(bson.decode(project.readBytes(id)));
        } catch {
            continue;
        }
        const walk = x => {
            if (!x || typeof x !== "object" || Buffer.isBuffer(x)) return;
            if (Array.isArray(x)) return x.forEach(walk);
            for (const [k, v] of Object.entries(x)) {
                if (typeof v === "string" && x.$ID && v) skip.add(`${x.$ID}|${k}|${v}`);
                else if (v && typeof v === "object") walk(v);
            }
        };
        walk(before);
    }
    return lintIds(project, ids, { skip });
}

// "where: message" lines, errors first
function format(findings) {
    const line = f => `${f.where}: ${f.msg}${f.src && f.src.length <= 160 ? `   in: ${f.src.replace(/\s*\n\s*/g, " ")}` : ""}`;
    return {
        xpath: findings.filter(f => f.kind === "xpath").sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)).map(f => (f.level === "error" ? "" : "(warning) ") + line(f)),
        expression: findings.filter(f => f.kind === "expression").sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)).map(f => (f.level === "error" ? "" : "(warning) ") + line(f))
    };
}

// For ops.runPlan / ops.lintExpressions: error lines ("where: message"), with .findings (warnings too) and .ms.
function planLint(client) {
    const t0 = Date.now();
    const r = lintChanges(client);
    const out = r.findings.filter(f => f.level === "error").map(f => `${f.where}: ${f.msg}`);
    out.findings = r.findings;
    out.ms = Date.now() - t0;
    return out;
}

module.exports = { ModelIndex, Linter, lintProject, lintChanges, lintIds, planLint, format, flowContext, SYSTEM_ENTITIES, BUILTIN_VARIABLES };
