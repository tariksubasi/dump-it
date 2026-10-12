"use strict";
// Microflows and nanoflows: build structured flows (actions, decisions, loops, error handlers, end/break/continue)
// laid out like Studio Pro does, list their steps with stable ids, and change or delete single steps.
const sdk = require("mendixmodelsdk");
const { DATA_TYPES, suggest, fail, validate, bool, noDollar, enumValue } = require("./ops-util");

const { microflows: mf, domainmodels: dm, datatypes, pages, codeactions, javaactions, javascriptactions, importmappings, exportmappings, services } = sdk;

const X_STEP = 190; // horizontal distance between steps
const LANE = 150; // vertical distance between branches

const ON_ERROR = "optional \"continue\", or { \"rollback\": true/false, \"actions\": [ ... ], \"returnValue\": \"...\" } (custom error handler)";

// Activities (one box each). They also accept 'caption' and 'onError'.
const ACTIONS = {
    retrieve: {
        doc: "Retrieve from the database, or over an association when 'from' is set.",
        fields: { variable: "R result variable name", entity: "database retrieve: Module.Entity", xpath: "optional XPath, e.g. [Active = true()]", first: "optional true = single object", from: "association retrieve: variable name, e.g. Order", association: "association retrieve: Module.Association" }
    },
    create: { doc: "Create an object.", fields: { variable: "R new variable name", entity: "R Module.Entity", set: "optional { \"Attribute\": \"expression\", \"Module.Assoc\": \"$Var\" }", commit: "optional true/false (default false)" } },
    change: { doc: "Change members of an object.", fields: { variable: "R variable to change (no $)", set: "R { \"Attribute\": \"expression\" }", commit: "optional true/false", refresh: "optional true/false" } },
    commit: { doc: "Commit an object or list.", fields: { variable: "R variable (no $)", events: "optional false = without events" } },
    delete: { doc: "Delete an object or list.", fields: { variable: "R variable (no $)" } },
    call: { doc: "Call a microflow. In a nanoflow: a nanoflow or a microflow.", fields: { microflow: "R Module.Microflow or Module.Nanoflow", args: "optional { \"ParamName\": \"expression\" }", variable: "optional result variable name" } },
    log: { doc: "Write a log line (microflows only).", fields: { message: "R text; {1} {2} are filled from args", args: "optional [\"expression\", ...]", level: "optional Info | Warning | Error | Debug | Trace | Critical", node: "optional log node name (default the module name)" } },
    message: { doc: "Show a message to the user.", fields: { text: "R message text", type: "optional Information | Warning | Error", blocking: "optional true/false" } },
    variable: { doc: "Create a variable.", fields: { name: "R variable name", type: "R " + DATA_TYPES, value: "R initial value expression, e.g. 0 or 'text' or empty" } },
    set: { doc: "Change a variable.", fields: { name: "R variable name (no $)", value: "R expression" } },
    showPage: { doc: "Open a page.", fields: { page: "R Module.Page", args: "optional { \"PageParameter\": \"$Variable\" } (every page parameter needs one)" } },
    closePage: { doc: "Close the current page.", fields: { count: "optional number of pages to close" } },
    showHomePage: { doc: "Open the home page (microflows only).", fields: {} },
    callJava: {
        doc: "Call a Java action (microflows only).",
        fields: { javaAction: "R Module.JavaAction", args: "optional { \"Param\": \"expression\" } (every required parameter needs one; an entity type parameter takes \"Module.Entity\")", variable: "optional result variable name (when the Java action returns something)" }
    },
    callJavaScript: {
        doc: "Call a JavaScript action (nanoflows only).",
        fields: { jsAction: "R Module.JavaScriptAction", args: "optional { \"Param\": \"expression\" } (every required parameter needs one; an entity type parameter takes \"Module.Entity\")", variable: "optional result variable name (when the action returns something)" }
    },
    validationFeedback: {
        doc: "Show a validation message below the input of an attribute or association of an object.",
        fields: { variable: "R object variable (no $)", member: "R attribute name, or Module.Association", message: "R text; {1} {2} are filled from args", args: "optional [\"expression\", ...]" }
    },
    rollback: { doc: "Undo the uncommitted changes of an object or list.", fields: { variable: "R variable (no $)", refresh: "optional true/false (default false)" } },
    createList: { doc: "Create an empty list.", fields: { variable: "R new list variable name", entity: "R Module.Entity" } },
    changeList: {
        doc: "Add to, remove from, replace or clear a list.",
        fields: { list: "R list variable (no $)", type: "optional add | remove | replace | clear (default add)", value: "object or list expression, e.g. $NewOrder (not for clear)" }
    },
    aggregateList: {
        doc: "Count, sum, average, minimum or maximum of a list; all/any test a Boolean.",
        fields: { variable: "R result variable name", list: "R list variable (no $)", function: "R count | sum | average | minimum | maximum | all | any", attribute: "attribute to aggregate (not for count)", expression: "instead of attribute: expression on $currentObject, e.g. $currentObject/Price * $currentObject/Quantity" }
    },
    listOperation: {
        doc: "Combine, search, filter, sort or cut a list.",
        fields: {
            variable: "R result variable name", operation: "R union | intersect | subtract | contains | equals | head | tail | find | filter | sort | range", list: "R list variable (no $)",
            other: "union/intersect/subtract/equals: second list variable; contains: object variable", attribute: "find/filter: attribute name or Module.Association", value: "find/filter: expression the attribute must equal",
            expression: "find/filter instead of attribute + value: condition on $currentObject", sort: "sort: [ \"Attribute\" or { \"attribute\": \"Attribute\", \"descending\": true } ]",
            offset: "range: index of the first item, expression (default 0)", limit: "range: number of items, expression"
        }
    },
    cast: { doc: "Use the object of an ifType case as that case's entity. Only as the first action of a case.", fields: { variable: "R new variable name" } },
    downloadFile: { doc: "Send a file document to the user's browser (microflows only).", fields: { variable: "R object variable of a System.FileDocument specialization (no $)", showInBrowser: "optional true/false (default false: download)" } },
    callRest: {
        doc: "Call a REST service (microflows only). Body: text or an export mapping. Response: ignored, a String, or an import mapping.",
        fields: {
            url: "R location; {1} {2} are filled from urlArgs, e.g. https://api.example.com/orders/{1}", urlArgs: "optional [\"expression\", ...]", method: "optional Get | Post | Put | Patch | Delete | Head | Options (default Get)",
            headers: "optional { \"Header-Name\": \"expression\" }", timeout: "optional seconds (default 300)", body: "optional request body text; {1} {2} are filled from bodyArgs", bodyArgs: "optional [\"expression\", ...]",
            exportMapping: "optional Module.ExportMapping for the body (instead of body)", exportObject: "with exportMapping: variable to export (no $)",
            response: "optional none | string | Module.ImportMapping (default: string when variable is set, else none)", variable: "result variable: the response text, or the import mapping result",
            commit: "with an import mapping: yes | no | withoutEvents (default withoutEvents)"
        }
    },
    importWithMapping: {
        doc: "Import JSON or XML text with an import mapping (microflows only).",
        fields: { mapping: "R Module.ImportMapping", source: "R String variable with the JSON/XML (no $)", variable: "optional result variable name", commit: "optional yes | no | withoutEvents (default withoutEvents)" }
    },
    exportWithMapping: {
        doc: "Export an object (or list) to JSON or XML text with an export mapping (microflows only).",
        fields: { mapping: "R Module.ExportMapping", object: "R variable to export (no $)", variable: "R new String variable for the text" }
    }
};
// Which field of an action names the variable it creates.
const CREATES = { retrieve: "variable", create: "variable", call: "variable", variable: "name", callJava: "variable", callJavaScript: "variable", createList: "variable", aggregateList: "variable", listOperation: "variable", cast: "variable", callRest: "variable", importWithMapping: "variable", exportWithMapping: "variable" };
const COMMON = { caption: "optional caption on the box (default: generated)", onError: ON_ERROR };

// Structure (no box of their own, or a special box).
const CONTROL = {
    if: { doc: "Decision. Runs 'then' when the condition is true, otherwise 'else'. A branch may end with end/break/continue.", fields: { condition: "R boolean expression, e.g. $Order/Total > 100", then: "optional [ actions ]", else: "optional [ actions ]", caption: "optional text in the diamond (default: the condition)" } },
    ifType: {
        doc: "Object type decision: runs the case of the object's specialization (start a case with 'cast' to use it as that entity), 'other' for any other type, 'empty' when there is no object.",
        fields: { variable: "R object variable (no $)", cases: "R { \"Module.Specialization\": [ actions ] }", other: "optional [ actions ]", empty: "optional [ actions ]", caption: "optional text in the diamond" }
    },
    loop: { doc: "Loop over a list ('over' + 'item'), or while a condition is true ('while').", fields: { over: "list variable to loop over (no $)", item: "name of the current object (default: <list>Item)", while: "boolean expression (instead of 'over')", actions: "R [ actions inside the loop ]" } },
    end: { doc: "End the flow here.", fields: { value: "return expression; required when the flow returns a value" } },
    break: { doc: "Leave the loop (only inside a loop).", fields: {} },
    continue: { doc: "Go to the next loop item (only inside a loop).", fields: {} },
    error: { doc: "End with the error again (only inside an onError handler).", fields: {} }
};

function makeFlows(h) {
    const { model } = h;
    const toLint = [];

    // current: the entity $currentObject stands for (list operations and aggregates)
    function expr(m, value, where, current = null) {
        toLint.push({ m, expr: String(value), where, current });
        return String(value);
    }

    const point = (el, x, y) => (el.relativeMiddlePoint = { x: Math.round(x), y: Math.round(y) });
    const size = (el, width, height) => (el.size = { width: Math.round(width), height: Math.round(height) });
    const short = o => o.id.slice(0, 8);
    const isFlowDoc = d => d instanceof mf.Microflow || d instanceof mf.Nanoflow;
    const errorDefault = f => (f.nano ? mf.ErrorHandlingType.Abort : mf.ErrorHandlingType.Rollback);
    const returnsValue = m => !!m.microflowReturnType && !(m.microflowReturnType instanceof datatypes.VoidType);

    async function flowDoc(qn) {
        const d = await h.get(qn);
        if (!isFlowDoc(d)) throw new Error(`'${qn}' is not a microflow or nanoflow`);
        return d;
    }

    // ------------------------------------------------ flows (lines)

    // value: null (no case), "true"/"Enum value", or { type: Module.Entity | System.X | "" } (object type decision)
    function addCase(fl, value) {
        const typed = value !== null && typeof value === "object";
        const Case = value === null ? mf.NoCase : typed ? mf.InheritanceCase : mf.EnumerationCase;
        let c;
        try {
            c = Case.createInSequenceFlowUnderCaseValues(fl); // Mendix 10.15+
        } catch (e) {
            c = Case.createInSequenceFlowUnderCaseValue(fl); // older versions: one case value
        }
        if (!typed) {
            if (value !== null) c.value = value;
        } else if (value.type) {
            const e = model.findEntityByQualifiedName(value.type);
            if (e) c.value = e;
            else c.__value.updateWithRawValue(value.type); // System.* entities are not in the project
        }
    }

    function flow(m, from, to, { originIndex = 1, destIndex = 3, caseValue = null, errorHandler = false } = {}) {
        const fl = mf.SequenceFlow.createIn(m);
        fl.origin = from;
        fl.destination = to;
        fl.originConnectionIndex = originIndex;
        fl.destinationConnectionIndex = destIndex;
        fl.isErrorHandler = errorHandler;
        addCase(fl, caseValue);
        return fl;
    }

    // tail = an open end the next object connects to: { obj, originIndex, caseValue, errorHandler }
    const connect = (f, tail, to, destIndex = 3) =>
        flow(f.m, tail.obj, to, { originIndex: tail.originIndex || 1, destIndex: tail.errorHandler ? 0 : destIndex, caseValue: tail.caseValue === undefined ? null : tail.caseValue, errorHandler: !!tail.errorHandler });

    // The case of a flow, as addCase takes it
    function caseOf(fl) {
        const list = fl.caseValues ? [...fl.caseValues] : fl.caseValue ? [fl.caseValue] : [];
        const c = list[0];
        if (!c || c instanceof mf.NoCase) return null;
        if (c instanceof mf.EnumerationCase) return c.value;
        if (c instanceof mf.InheritanceCase) return { type: c.valueQualifiedName || "" };
        return c.structureTypeName.split("$")[1];
    }
    const caseLabel = fl => {
        const c = caseOf(fl);
        return c && typeof c === "object" ? c.type || "empty" : c;
    };

    // ------------------------------------------------ variables

    function walkObjects(coll, fn, parent = null) {
        for (const o of coll.objects) {
            fn(o, coll, parent);
            if (o instanceof mf.LoopedActivity) walkObjects(o.objectCollection, fn, o);
        }
    }

    function variablesOf(m) {
        const out = new Map();
        walkObjects(m.objectCollection, o => {
            if (o instanceof mf.MicroflowParameterObject) out.set(o.name, o);
            else if (o instanceof mf.ActionActivity && o.action) {
                const a = o.action;
                if (a.outputVariableName && a.useReturnVariable !== false) out.set(a.outputVariableName, o);
                if (a.variableName) out.set(a.variableName, o);
                const r = a.resultHandling; // REST call, import with mapping
                if (r && r.storeInVariable && r.outputVariableName) out.set(r.outputVariableName, o);
                if (a.outputMethod && a.outputMethod.outputVariableName) out.set(a.outputMethod.outputVariableName, o); // export with mapping
            } else if (o instanceof mf.LoopedActivity && o.loopSource instanceof mf.IterableList && o.loopSource.variableName) out.set(o.loopSource.variableName, o);
        });
        return out;
    }

    const load = async x => (x && !x.isLoaded && x.load ? x.load() : x);
    const ofType = t => ({ entity: t && t.entity ? t.entityQualifiedName : null, list: t instanceof datatypes.ListType });

    // What a code action (Java/JavaScript) call returns.
    async function codeResult(a) {
        const target = await load(a.javaAction || a.javaScriptAction);
        const t = target && target.actionReturnType;
        const concrete = async x => {
            if (x instanceof codeactions.ConcreteEntityType) return x.entityQualifiedName;
            if (!(x instanceof codeactions.ParameterizedEntityType)) return null;
            // the entity passed for the type parameter
            for (const pm of a.parameterMappings) {
                const p = await load(pm.parameter);
                if (p && p.actionParameterType instanceof codeactions.EntityTypeParameterType && p.actionParameterType.typeParameter === x.typeParameter && pm.parameterValue instanceof mf.EntityTypeCodeActionParameterValue) return pm.parameterValue.entityQualifiedName;
            }
            return null;
        };
        if (t instanceof codeactions.ListType) return { entity: await concrete(t.parameter), list: true };
        return { entity: await concrete(t), list: false };
    }

    // What a variable holds: { entity: "Module.Entity" or null for a value (String, Integer, ...), list }.
    async function variableInfo(m, name, where) {
        const n = noDollar(name);
        if (n === "currentUser") return { entity: "System.User", list: false };
        const vars = variablesOf(m);
        const v = vars.get(n);
        if (!v) fail(`${where}: no variable '${name}' before this action in ${m.qualifiedName}`, n, [...vars.keys()]);
        if (v instanceof mf.MicroflowParameterObject) return ofType(v.variableType);
        if (v instanceof mf.LoopedActivity) return { entity: (await variableInfo(m, v.loopSource.listVariableName, where)).entity, list: false };
        const a = v.action;
        if (a instanceof mf.RetrieveAction) {
            const src = a.retrieveSource;
            if (src instanceof mf.DatabaseRetrieveSource) return { entity: src.entityQualifiedName, list: !(src.range instanceof mf.ConstantRange && src.range.singleObject) };
            const assoc = await load(src.association);
            const end = k => (assoc && assoc[k] ? assoc[k].qualifiedName : null) || (assoc && assoc[k + "QualifiedName"]) || null; // cross associations: child by name
            if (!end("parent")) return { entity: null, list: false };
            const from = (await variableInfo(m, src.startVariableName, where)).entity;
            // from the owner (parent) side: the child, a list for a reference set; from the other side: the owners
            if (from === end("parent")) return { entity: end("child"), list: assoc.type === dm.AssociationType.ReferenceSet };
            return { entity: end("parent"), list: true };
        }
        if (a instanceof mf.CreateObjectAction) return { entity: a.entityQualifiedName, list: false };
        if (a instanceof mf.CreateListAction) return { entity: a.entityQualifiedName, list: true };
        if (a instanceof mf.CreateVariableAction) return ofType(a.variableType);
        if (a instanceof mf.AggregateListAction) return { entity: null, list: false };
        if (a instanceof mf.ListOperationAction) {
            const op = a.operation;
            if (op instanceof mf.Contains || op instanceof mf.ListEquals) return { entity: null, list: false };
            const base = await variableInfo(m, op.listVariableName, where);
            return { entity: base.entity, list: !(op instanceof mf.Head || op instanceof mf.Find || op instanceof mf.FindByExpression) };
        }
        if (a instanceof mf.CastAction) {
            const into = flowsOf(m).find(fl => fl.destination === v);
            const c = into && caseOf(into);
            return { entity: c && typeof c === "object" ? c.type : null, list: false };
        }
        if (a instanceof mf.JavaActionCallAction || a instanceof mf.JavaScriptActionCallAction) return codeResult(a);
        if (a instanceof mf.MicroflowCallAction || a instanceof mf.NanoflowCallAction) {
            const target = await load(a.microflowCall ? a.microflowCall.microflow : a.nanoflowCall.nanoflow);
            return ofType(target && target.microflowReturnType);
        }
        if (a.resultHandling) return ofType(a.resultHandling.variableType);
        return { entity: null, list: false };
    }

    async function entityOfVariable(m, name, where) {
        const info = await variableInfo(m, name, where);
        if (!info.entity) throw new Error(`${where}: cannot tell the entity of variable '${name}'`);
        return info.entity;
    }

    // An object (list = false) or list (list = true) variable; returns its entity.
    async function needVariable(m, name, list, where) {
        const info = await variableInfo(m, name, where);
        if (!info.entity || info.list !== list) throw new Error(`${where}: '${noDollar(name)}' is ${info.list ? "a list" : info.entity ? "an object" : "not an object or list"}; this needs ${list ? "a list" : "an object"} variable`);
        return info.entity;
    }

    async function memberChange(f, action, ent, entityQn, member, value, where) {
        const mc = mf.MemberChange.createIn(action);
        mc.type = mf.ChangeActionItemType.Set;
        mc.value = expr(f.m, value, where);
        if (member.includes(".")) {
            const assoc = await h.get(member);
            if (!(assoc instanceof dm.AssociationBase)) throw new Error(`${where}: '${member}' is not an association`);
            mc.association = assoc;
        } else {
            const chain = h.attributeChain(ent);
            const attr = chain.attributes.find(a => a.name === member);
            if (!attr && !chain.complete) throw new Error(`${where}: '${member}' is not an own attribute of ${entityQn}; attributes inherited from System entities cannot be set by ops (use a .js script or Studio Pro)`);
            if (!attr) fail(`${where}: ${entityQn} has no attribute '${member}'`, member, chain.attributes.map(a => a.name));
            mc.attribute = attr;
        }
        return mc;
    }

    async function memberChanges(f, action, entityQn, set, where) {
        const ent = await h.entity(entityQn);
        await h.loadParents(ent);
        for (const [member, value] of Object.entries(set || {})) await memberChange(f, action, ent, entityQn, member, value, where);
    }

    // ------------------------------------------------ activities

    async function callAction(f, act, spec, where) {
        const target = await h.get(spec.microflow);
        const isNanoTarget = target instanceof mf.Nanoflow;
        if (!(target instanceof mf.Microflow) && !isNanoTarget) throw new Error(`${where}: '${spec.microflow}' is not a microflow or nanoflow`);
        if (isNanoTarget && !f.nano) throw new Error(`${where}: a microflow cannot call a nanoflow ('${spec.microflow}')`);
        const a = isNanoTarget ? mf.NanoflowCallAction.createIn(act) : mf.MicroflowCallAction.createIn(act);
        const call = isNanoTarget ? mf.NanoflowCall.createIn(a) : mf.MicroflowCall.createIn(a);
        if (isNanoTarget) call.nanoflow = target;
        else call.microflow = target;
        const params = target.objectCollection.objects.filter(o => o instanceof mf.MicroflowParameterObject);
        for (const [name, value] of Object.entries(spec.args || {})) {
            const p = params.find(x => x.name === name);
            if (!p) fail(`${where}: ${spec.microflow} has no parameter '${name}'`, name, params.map(x => x.name));
            const pm = isNanoTarget ? mf.NanoflowCallParameterMapping.createIn(call) : mf.MicroflowCallParameterMapping.createIn(call);
            pm.parameter = p;
            pm.argument = expr(f.m, value, where);
        }
        const missing = params.filter(p => !(p.name in (spec.args || {})));
        if (missing.length) throw new Error(`${where}: ${spec.microflow} needs args for: ${missing.map(p => p.name).join(", ")}`);
        a.useReturnVariable = !!spec.variable;
        a.outputVariableName = spec.variable ? noDollar(spec.variable) : "";
        return a;
    }

    async function pageMappings(f, settings, page, args, where) {
        const params = page.parameters ? [...page.parameters] : [];
        for (const [name, value] of Object.entries(args || {})) {
            const p = params.find(x => x.name === name);
            if (!p) fail(`${where}: page ${page.qualifiedName} has no parameter '${name}'`, name, params.map(x => x.name));
            const pm = pages.PageParameterMapping.createIn(settings);
            pm.parameter = p;
            pm.argument = expr(f.m, value, where);
            try {
                pm.variable = pages.PageVariable.create(model);
            } catch (e) {
                // older versions have no page variable here
            }
        }
        const missing = params.filter(p => !(p.name in (args || {})));
        if (missing.length) throw new Error(`${where}: page ${page.qualifiedName} needs args for: ${missing.map(p => p.name).join(", ")}`);
    }

    // An attribute (own or inherited) or an association of an entity, by name.
    async function memberOf(entityQn, name, where) {
        const parts = String(name).split(".");
        if (parts.length === 2) {
            const assoc = await h.get(name);
            if (!(assoc instanceof dm.AssociationBase)) throw new Error(`${where}: '${name}' is not an association`);
            return { association: assoc };
        }
        const short = parts.pop(); // Module.Entity.Attribute works too
        const ent = await h.entity(entityQn);
        await h.loadParents(ent);
        const chain = h.attributeChain(ent);
        const attr = chain.attributes.find(a => a.name === short);
        if (!attr && !chain.complete) throw new Error(`${where}: '${short}' is not an own attribute of ${entityQn}; attributes inherited from System entities cannot be used by ops (use Studio Pro)`);
        if (!attr) fail(`${where}: ${entityQn} has no attribute '${short}'`, short, chain.attributes.map(a => a.name));
        return { attribute: attr };
    }

    // Does entityQn inherit from base (e.g. System.FileDocument)?
    async function isA(entityQn, base) {
        let e = await h.entity(entityQn);
        for (let i = 0; i < 20; i++) {
            if (e.qualifiedName === base) return true;
            const g = e.generalization;
            if (!(g instanceof dm.Generalization)) return false;
            if (g.generalizationQualifiedName === base) return true;
            if (!g.generalization) return false;
            e = await load(g.generalization);
        }
        return false;
    }

    // Entities that inherit (directly or not) from entityQn, by qualified name.
    async function specializationsOf(entityQn) {
        const parent = new Map();
        for (const d of model.allDomainModels()) {
            for (const e of (await load(d)).entities) if (e.generalization instanceof dm.Generalization) parent.set(e.qualifiedName, e.generalization.generalizationQualifiedName);
        }
        const out = [];
        for (const qn of parent.keys()) {
            for (let p = parent.get(qn), i = 0; p && i < 20; p = parent.get(p), i++) {
                if (p === entityQn) {
                    out.push(qn);
                    break;
                }
            }
        }
        return out.sort();
    }

    // Template text with {1} {2} placeholders, filled from args (expressions). brace: write a literal { as {{ (REST
    // location and body templates).
    // text null: keep the text (only the arguments change).
    function fillTemplate(f, tpl, text, args, where, brace = false) {
        const own = tpl instanceof mf.StringTemplate; // a TextTemplate's text is a translated Texts$Text (h.text)
        const s = text === null ? (own ? tpl.text : "") : String(text === undefined ? "" : text);
        if (args !== undefined && !Array.isArray(args)) throw new Error(`${where}: template arguments must be a list [ "expression", ... ]`);
        const used = Math.max(0, ...[...s.matchAll(/\{(\d+)\}/g)].map(x => Number(x[1])));
        if (used > (args || []).length) throw new Error(`${where}: the text uses {${used}} but there ${(args || []).length === 1 ? "is 1 argument" : `are ${(args || []).length} arguments`}`);
        if (own && text !== null) tpl.text = brace && !s.includes("{{") ? s.replace(/\{(?!\d+\})/g, "{{") : s;
        for (const old of [...tpl.arguments]) old.delete();
        for (const e of args || []) mf.TemplateArgument.createIn(tpl).expression = expr(f.m, e, where);
    }

    const required = p => {
        try {
            return p.isRequired !== false;
        } catch (e) {
            return true; // versions without optional parameters
        }
    };

    // Java action (microflows) or JavaScript action (nanoflows) call: one mapping per parameter, in parameter order.
    async function codeCall(f, act, spec, where, js) {
        const qn = js ? spec.jsAction : spec.javaAction;
        const target = await h.get(qn);
        const [want, other] = js ? [javascriptactions.JavaScriptAction, javaactions.JavaAction] : [javaactions.JavaAction, javascriptactions.JavaScriptAction];
        if (!(target instanceof want)) throw new Error(`${where}: '${qn}' is not a ${js ? "JavaScript" : "Java"} action` + (target instanceof other ? ` but a ${js ? "Java action: use callJava in a microflow" : "JavaScript action: use callJavaScript in a nanoflow"}` : ""));
        const a = (js ? mf.JavaScriptActionCallAction : mf.JavaActionCallAction).createIn(act);
        if (js) a.javaScriptAction = target;
        else a.javaAction = target;
        const params = [...target.actionParameters];
        const args = spec.args || {};
        if (typeof args !== "object" || Array.isArray(args)) throw new Error(`${where}: args must be { "Param": "expression" }`);
        for (const name of Object.keys(args)) if (!params.some(p => p.name === name)) fail(`${where}: ${qn} has no parameter '${name}'`, name, params.map(p => p.name));
        const missing = params.filter(p => !(p.name in args) && required(p));
        if (missing.length) throw new Error(`${where}: ${qn} needs args for: ${missing.map(p => p.name).join(", ")} (an expression; "empty" for no value)`);
        const under = js ? "createInJavaScriptActionParameterMappingUnderParameterValue" : "createInJavaActionParameterMappingUnderParameterValue";
        for (const p of params) {
            const pm = (js ? mf.JavaScriptActionParameterMapping : mf.JavaActionParameterMapping).createIn(a);
            pm.parameter = p;
            const t = p.actionParameterType;
            const v = args[p.name];
            if (t instanceof codeactions.EntityTypeParameterType) {
                if (String(v).startsWith("$")) throw new Error(`${where}: parameter '${p.name}' of ${qn} takes an entity name like "Module.Entity", not a variable`);
                mf.EntityTypeCodeActionParameterValue[under](pm).entity = await h.entity(v);
            } else if (t instanceof codeactions.BasicParameterType) mf.BasicCodeActionParameterValue[under](pm).argument = p.name in args ? expr(f.m, v, where) : "";
            else throw new Error(`${where}: parameter '${p.name}' of ${qn} takes a ${t.structureTypeName.split("$")[1].replace(/(JavaScript|Java)?ActionParameterType$|ParameterType$/, "").toLowerCase() || "value"} argument, which ops cannot fill in; add this call in Studio Pro`);
        }
        const isVoid = target.actionReturnType instanceof codeactions.VoidType;
        if (spec.variable && isVoid) throw new Error(`${where}: ${qn} returns nothing; remove 'variable'`);
        a.useReturnVariable = isVoid || !!spec.variable; // Studio Pro keeps true for actions that return nothing
        a.outputVariableName = spec.variable ? noDollar(spec.variable) : "";
        return a;
    }

    const COMMIT = { yes: "Yes", no: "No", withoutevents: "YesWithoutEvents", yeswithoutevents: "YesWithoutEvents" };
    const contentType = mapping => (mapping.jsonStructureQualifiedName ? mf.ContentType.Json : mf.ContentType.Xml);

    // Where a REST response or an import goes: { how: "none" | "string" | "mapping", variable, mapping, commit }.
    // Returns the ResultHandlingType name.
    async function resultHandling(f, r, how, spec, where) {
        const variable = spec.variable ? noDollar(spec.variable) : "";
        if (how === "none" && variable) throw new Error(`${where}: response "none" stores nothing; remove 'variable' or use response "string"`);
        if (how === "string" && !variable) throw new Error(`${where}: response "string" needs 'variable' (the name for the response text)`);
        if (how !== "mapping" && spec.commit !== undefined) throw new Error(`${where}: 'commit' only applies to an import mapping`);
        r.storeInVariable = !!variable;
        r.outputVariableName = variable;
        if (how === "string") {
            r.variableType = datatypes.StringType.create(model);
            return "String";
        }
        if (how === "none") {
            r.variableType = datatypes.VoidType.create(model);
            return "None";
        }
        const map = await h.get(spec.mapping);
        if (!(map instanceof importmappings.ImportMapping)) throw new Error(`${where}: '${spec.mapping}' is not an import mapping`);
        const pt = map.parameterType;
        if (pt && !(pt instanceof datatypes.UnknownType) && !(pt instanceof datatypes.VoidType)) throw new Error(`${where}: import mapping ${spec.mapping} takes a parameter, which ops cannot pass; add this call in Studio Pro`);
        const root = map.rootMappingElements[0];
        if (!root || !root.entity) throw new Error(`${where}: import mapping ${spec.mapping} has no root object (finish it in Studio Pro)`);
        const call = mf.ImportMappingCall.createIn(r);
        call.mapping = map;
        importCommit(r, spec.commit || "withoutEvents");
        call.contentType = contentType(map);
        call.objectHandlingBackup = sdk.mappings.ObjectHandlingBackupEnum.Create;
        call.forceSingleOccurrence = false;
        mf.ConstantRange.createInImportMappingCallUnderRange(call).singleObject = false;
        if (variable) {
            const t = (root.maxOccurs === -1 ? datatypes.ListType : datatypes.ObjectType).create(model);
            t.entity = root.entity;
            r.variableType = t;
        } else r.variableType = datatypes.VoidType.create(model);
        return "Mapping";
    }

    function importCommit(r, v) {
        if (!r || !r.importMappingCall) throw new Error("'commit' only applies to a result with an import mapping");
        const c = COMMIT[String(v).toLowerCase()];
        if (!c) fail(`commit '${v}' is not one of yes | no | withoutEvents`, v, Object.keys(COMMIT));
        r.importMappingCall.commit = mf.CommitEnum[c];
    }

    // Microflow-only and nanoflow-only actions.
    const ONLY = { log: "micro", showHomePage: "micro", callJava: "micro", downloadFile: "micro", callRest: "micro", importWithMapping: "micro", exportWithMapping: "micro", callJavaScript: "nano" };
    const AGGREGATE = { count: "Count", sum: "Sum", average: "Average", avg: "Average", minimum: "Minimum", min: "Minimum", maximum: "Maximum", max: "Maximum", all: "All", any: "Any" };
    const LIST_OPS = {
        union: "Union", intersect: "Intersect", subtract: "Subtract", contains: "Contains", equals: "ListEquals",
        head: "Head", tail: "Tail", find: "Find", filter: "Filter", sort: "Sort", range: "ListRange"
    };
    const CHANGE_LIST = { add: "Add", remove: "Remove", replace: "Set", set: "Set", clear: "Clear" };
    // Known to Mendix, but not written by ops: refused with the way out.
    const NOT_STORED = {
        reduce: "aggregate function 'reduce' is not supported (its return type cannot be set exactly); add it in Studio Pro"
    };

    // An attribute the aggregate function works on: numbers for sum/average, numbers or dates for minimum/maximum,
    // Booleans for all/any.
    async function aggregateAttribute(fn, entityQn, name, where) {
        if (fn === "Count") throw new Error(`${where}: count takes no attribute`);
        const { attribute } = await memberOf(entityQn, name, where);
        if (!attribute) throw new Error(`${where}: aggregate an attribute, not an association`);
        const t = attribute.type;
        const numeric = t instanceof dm.IntegerAttributeType || t instanceof dm.LongAttributeType || t instanceof dm.DecimalAttributeType || t instanceof dm.AutoNumberAttributeType;
        const ok = fn === "All" || fn === "Any" ? t instanceof dm.BooleanAttributeType : fn === "Sum" || fn === "Average" ? numeric : numeric || t instanceof dm.DateTimeAttributeType;
        if (!ok) throw new Error(`${where}: ${fn.toLowerCase()} does not work on ${attribute.name} (${t.structureTypeName.split("$")[1].replace("AttributeType", "")})`);
        return attribute;
    }

    async function aggregate(f, a, spec, where) {
        if (NOT_STORED[String(spec.function).toLowerCase()]) throw new Error(`${where}: ${NOT_STORED[String(spec.function).toLowerCase()]}`);
        const fn = AGGREGATE[String(spec.function).toLowerCase()];
        if (!fn) fail(`${where}: function '${spec.function}' is not one of count | sum | average | minimum | maximum | all | any`, spec.function, Object.keys(AGGREGATE));
        const ent = await needVariable(f.m, spec.list, true, where);
        a.inputListVariableName = noDollar(spec.list);
        a.aggregateFunction = mf.AggregateFunctionEnum[fn];
        a.attribute = null;
        a.useExpression = false;
        a.expression = "";
        if (fn === "Count") {
            if (spec.attribute !== undefined || spec.expression !== undefined) throw new Error(`${where}: count takes no attribute or expression`);
        } else if ((spec.attribute === undefined) === (spec.expression === undefined)) throw new Error(`${where}: ${spec.function} needs either 'attribute' or 'expression'`);
        else if (spec.attribute !== undefined) a.attribute = await aggregateAttribute(fn, ent, spec.attribute, where);
        else {
            a.useExpression = true;
            a.expression = expr(f.m, spec.expression, where, ent);
        }
        // what Studio Pro stores when the function is not reduce
        a.reduceInitialValueExpression = "";
        a.reduceReturnDataType = datatypes.BooleanType.create(model);
    }

    async function listOperation(f, a, spec, where) {
        if (NOT_STORED[String(spec.operation).toLowerCase()]) throw new Error(`${where}: ${NOT_STORED[String(spec.operation).toLowerCase()]}`);
        const name = LIST_OPS[String(spec.operation).toLowerCase()];
        if (!name) fail(`${where}: operation '${spec.operation}' is not one of ${Object.keys(LIST_OPS).join(" | ")}`, spec.operation, Object.keys(LIST_OPS));
        const ent = await needVariable(f.m, spec.list, true, where);
        const allowed = {
            Union: ["other"], Intersect: ["other"], Subtract: ["other"], Contains: ["other"], ListEquals: ["other"], Head: [], Tail: [],
            Find: ["attribute", "value", "expression"], Filter: ["attribute", "value", "expression"], Sort: ["sort"], ListRange: ["offset", "limit"]
        }[name];
        for (const k of ["other", "attribute", "value", "expression", "sort", "offset", "limit"]) {
            if (spec[k] !== undefined && !allowed.includes(k)) throw new Error(`${where}: '${k}' does not apply to ${spec.operation}${allowed.length ? ` (it takes ${allowed.join(", ")})` : ""}`);
        }
        let op;
        if (allowed.includes("other")) {
            if (!spec.other) throw new Error(`${where}: ${spec.operation} needs 'other' (${name === "Contains" ? "an object" : "a second list"} variable)`);
            await needVariable(f.m, spec.other, name !== "Contains", where);
            op = mf[name].createIn(a);
            op.secondListOrObjectVariableName = noDollar(spec.other);
        } else if (name === "Find" || name === "Filter") {
            if (spec.expression !== undefined) {
                if (spec.attribute !== undefined || spec.value !== undefined) throw new Error(`${where}: use 'attribute' + 'value' or 'expression', not both`);
                op = mf[name + "ByExpression"].createIn(a);
                op.expression = expr(f.m, spec.expression, where, ent);
            } else {
                if (spec.attribute === undefined || spec.value === undefined) throw new Error(`${where}: ${spec.operation} needs 'attribute' and 'value', or 'expression'`);
                const mem = await memberOf(ent, spec.attribute, where);
                op = mf[name].createIn(a);
                if (mem.attribute) op.attribute = mem.attribute;
                else op.association = mem.association;
                op.expression = expr(f.m, spec.value, where);
            }
        } else if (name === "Sort") {
            if (!Array.isArray(spec.sort) || !spec.sort.length) throw new Error(`${where}: sort needs sort: [ "Attribute" or { "attribute": "Attribute", "descending": true } ]`);
            op = mf.Sort.createIn(a);
            const items = mf.SortItemList.createInSortUnderSortItemList(op);
            for (const s of spec.sort) {
                const o = typeof s === "string" ? { attribute: s } : s || {};
                const { attribute } = await memberOf(ent, o.attribute, where);
                if (!attribute) throw new Error(`${where}: sort on an attribute, not an association`);
                const item = mf.SortItem.createIn(items);
                dm.AttributeRef.createInSortItemUnderAttributeRef(item).attribute = attribute;
                item.sortOrder = bool(o.descending, false) ? mf.SortOrderEnum.Descending : mf.SortOrderEnum.Ascending;
            }
        } else if (name === "ListRange") {
            if (spec.limit === undefined) throw new Error(`${where}: range needs 'limit' (number of items) and optionally 'offset'`);
            op = mf.ListRange.createIn(a);
            const r = mf.CustomRange.createInListRangeUnderCustomRange(op);
            r.offsetExpression = expr(f.m, spec.offset === undefined ? "0" : spec.offset, where);
            r.limitExpression = expr(f.m, spec.limit, where);
        } else op = mf[name].createIn(a);
        op.listVariableName = noDollar(spec.list);
    }

    async function activity(f, spec, x, y, where) {
        const kind = spec.action;
        validate("action", kind, { fields: { ...ACTIONS[kind].fields, ...COMMON } }, spec, where);
        if (ONLY[kind] === "micro" && f.nano) throw new Error(`${where}: '${kind}' is not available in nanoflows${kind === "callJava" ? "; call a microflow that calls the Java action" : ""}`);
        if (ONLY[kind] === "nano" && !f.nano) throw new Error(`${where}: '${kind}' only works in nanoflows (JavaScript runs in the browser); in a microflow use callJava`);
        const act = mf.ActionActivity.createIn(f.coll);
        point(act, x, y);
        size(act, 120, 60);
        let a;
        switch (kind) {
            case "retrieve": {
                a = mf.RetrieveAction.createIn(act);
                a.outputVariableName = noDollar(spec.variable);
                if (spec.from || spec.association) {
                    if (!spec.from || !spec.association) throw new Error(`${where}: association retrieve needs both 'from' and 'association'`);
                    const src = mf.AssociationRetrieveSource.createIn(a);
                    src.startVariableName = noDollar(spec.from);
                    src.association = await h.get(spec.association);
                } else {
                    if (!spec.entity) throw new Error(`${where}: retrieve needs 'entity' (database) or 'from' + 'association'`);
                    const src = mf.DatabaseRetrieveSource.createIn(a);
                    src.entity = await h.entity(spec.entity);
                    src.xPathConstraint = spec.xpath || "";
                    const range = mf.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
                    range.singleObject = bool(spec.first, false);
                }
                break;
            }
            case "create":
                a = mf.CreateObjectAction.createIn(act);
                a.entity = await h.entity(spec.entity);
                a.outputVariableName = noDollar(spec.variable);
                a.commit = bool(spec.commit, false) ? mf.CommitEnum.Yes : mf.CommitEnum.No;
                await memberChanges(f, a, spec.entity, spec.set, where);
                break;
            case "change":
                a = mf.ChangeObjectAction.createIn(act);
                a.changeVariableName = noDollar(spec.variable);
                a.commit = bool(spec.commit, false) ? mf.CommitEnum.Yes : mf.CommitEnum.No;
                a.refreshInClient = bool(spec.refresh, false);
                await memberChanges(f, a, await entityOfVariable(f.m, spec.variable, where), spec.set, where);
                break;
            case "commit":
                a = mf.CommitAction.createIn(act);
                a.commitVariableName = noDollar(spec.variable);
                a.withEvents = bool(spec.events, true);
                break;
            case "delete":
                a = mf.DeleteAction.createIn(act);
                a.deleteVariableName = noDollar(spec.variable);
                break;
            case "call":
                a = await callAction(f, act, spec, where);
                break;
            case "log":
                a = mf.LogMessageAction.createIn(act);
                a.level = enumValue(mf.LogLevel, spec.level || "Info", "log level");
                a.node = `'${String(spec.node || f.m.qualifiedName.split(".")[0]).replace(/'/g, "''")}'`;
                a.messageTemplate.text = String(spec.message);
                for (const e of spec.args || []) mf.TemplateArgument.createIn(a.messageTemplate).expression = expr(f.m, e, where);
                break;
            case "message":
                a = mf.ShowMessageAction.createIn(act);
                a.type = enumValue(mf.ShowMessageType, spec.type || "Information", "message type");
                a.blocking = bool(spec.blocking, true);
                await h.text(a.template.text, spec.text);
                break;
            case "variable":
                a = mf.CreateVariableAction.createIn(act);
                a.variableName = noDollar(spec.name);
                a.variableType = await h.dataType(spec.type);
                a.initialValue = expr(f.m, spec.value, where);
                break;
            case "set":
                a = mf.ChangeVariableAction.createIn(act);
                a.changeVariableName = noDollar(spec.name);
                a.value = expr(f.m, spec.value, where);
                break;
            case "showPage": {
                const page = await h.get(spec.page);
                if (!(page instanceof pages.Page)) throw new Error(`${where}: '${spec.page}' is not a page`);
                a = mf.ShowPageAction.createIn(act);
                const settings = pages.PageSettings.createInShowPageActionUnderPageSettings(a);
                settings.page = page;
                await pageMappings(f, settings, page, spec.args, where);
                break;
            }
            case "closePage":
                a = mf.CloseFormAction.createIn(act);
                a.numberOfPagesToClose = spec.count === undefined ? "" : String(spec.count);
                break;
            case "showHomePage":
                a = mf.ShowHomePageAction.createIn(act);
                break;
            case "callJava":
            case "callJavaScript":
                a = await codeCall(f, act, spec, where, kind === "callJavaScript");
                break;
            case "validationFeedback": {
                const ent = await needVariable(f.m, spec.variable, false, where);
                const mem = await memberOf(ent, spec.member, where);
                a = mf.ValidationFeedbackAction.createIn(act);
                a.objectVariableName = noDollar(spec.variable);
                if (mem.attribute) a.attribute = mem.attribute;
                else a.association = mem.association;
                fillTemplate(f, a.feedbackTemplate, spec.message, spec.args, where);
                await h.text(a.feedbackTemplate.text, spec.message);
                break;
            }
            case "rollback": {
                const info = await variableInfo(f.m, spec.variable, where);
                if (!info.entity) throw new Error(`${where}: '${noDollar(spec.variable)}' is not an object or list`);
                a = mf.RollbackAction.createIn(act);
                a.rollbackVariableName = noDollar(spec.variable);
                a.refreshInClient = bool(spec.refresh, false);
                break;
            }
            case "createList":
                a = mf.CreateListAction.createIn(act);
                a.entity = await h.entity(spec.entity);
                a.outputVariableName = noDollar(spec.variable);
                break;
            case "changeList": {
                const type = CHANGE_LIST[String(spec.type || "add").toLowerCase()];
                if (!type) fail(`${where}: type '${spec.type}' is not one of add | remove | replace | clear`, spec.type, Object.keys(CHANGE_LIST));
                await needVariable(f.m, spec.list, true, where);
                if (type === "Clear" && spec.value !== undefined) throw new Error(`${where}: clear takes no 'value'`);
                if (type !== "Clear" && (spec.value === undefined || spec.value === "")) throw new Error(`${where}: ${spec.type || "add"} needs 'value' (an object or list expression, e.g. $NewOrder)`);
                a = mf.ChangeListAction.createIn(act);
                a.changeVariableName = noDollar(spec.list);
                a.type = mf.ChangeListActionType[type];
                a.value = type === "Clear" ? "" : expr(f.m, spec.value, where);
                break;
            }
            case "aggregateList":
                a = mf.AggregateListAction.createIn(act);
                a.outputVariableName = noDollar(spec.variable);
                await aggregate(f, a, spec, where);
                break;
            case "listOperation":
                a = mf.ListOperationAction.createIn(act);
                a.outputVariableName = noDollar(spec.variable);
                await listOperation(f, a, spec, where);
                break;
            case "cast":
                a = mf.CastAction.createIn(act);
                a.outputVariableName = noDollar(spec.variable);
                break;
            case "downloadFile": {
                const ent = await needVariable(f.m, spec.variable, false, where);
                if (!(await isA(ent, "System.FileDocument")) && !(await isA(ent, "System.Image"))) throw new Error(`${where}: ${ent} is no file document; downloadFile needs an object of an entity that inherits from System.FileDocument`);
                a = mf.DownloadFileAction.createIn(act);
                a.fileDocumentVariableName = noDollar(spec.variable);
                a.showFileInBrowser = bool(spec.showInBrowser, false);
                break;
            }
            case "callRest": {
                if (spec.body !== undefined && spec.exportMapping) throw new Error(`${where}: give 'body' or 'exportMapping', not both`);
                if (!spec.exportMapping !== !spec.exportObject) throw new Error(`${where}: 'exportMapping' and 'exportObject' go together`);
                if (spec.headers !== undefined && (typeof spec.headers !== "object" || Array.isArray(spec.headers))) throw new Error(`${where}: headers must be { "Name": "expression" }`);
                // weak models mix up the text template (url, body) and expressions (args, header values)
                if (/^\s*['@$]/.test(spec.url)) throw new Error(`${where}: url is text, not an expression: write https://... and put expressions in urlArgs, e.g. "url": "{1}/orders/{2}", "urlArgs": ["@Module.BaseUrl", "$Order/Id"]`);
                for (const [k, v] of Object.entries(spec.headers || {})) {
                    if (!/['$@(]|^\s*(-?\d+(\.\d+)?|empty|true|false)\s*$/.test(String(v))) throw new Error(`${where}: header ${k} is an expression: write '${v}' in single quotes`);
                }
                a = mf.RestCallAction.createIn(act);
                const http = a.httpConfiguration || mf.HttpConfiguration.createInRestCallActionUnderHttpConfiguration(a);
                http.overrideLocation = true;
                fillTemplate(f, http.customLocationTemplate || mf.StringTemplate.createInHttpConfigurationUnderCustomLocationTemplate(http), spec.url, spec.urlArgs, `${where} url`, true);
                try {
                    http.newHttpMethod = enumValue(services.HttpMethod, spec.method || "Get", "HTTP method");
                } catch (e) {
                    throw new Error(`${where}: ${e.message}`);
                }
                for (const [k, v] of Object.entries(spec.headers || {})) {
                    const e = mf.HttpHeaderEntry.createInHttpConfigurationUnderHeaderEntries(http);
                    e.key = k;
                    e.value = expr(f.m, v, `${where} header ${k}`);
                }
                a.useRequestTimeOut = true;
                a.timeOutExpression = expr(f.m, spec.timeout === undefined ? "300" : spec.timeout, `${where} timeout`);
                a.errorResultHandlingType = mf.ErrorResultHandlingType.HttpResponse;
                a.requestProxyType = mf.RequestProxyType.DefaultProxy;
                if (spec.exportMapping) {
                    const map = await h.get(spec.exportMapping);
                    if (!(map instanceof exportmappings.ExportMapping)) throw new Error(`${where}: '${spec.exportMapping}' is not an export mapping`);
                    await variableInfo(f.m, spec.exportObject, where);
                    const rq = mf.MappingRequestHandling.createInRestCallActionUnderRequestHandling(a);
                    rq.mapping = map;
                    rq.mappingArgumentVariableName = noDollar(spec.exportObject);
                    rq.contentType = contentType(map);
                    a.requestHandlingType = mf.RequestHandlingType.Mapping;
                } else {
                    const rq = mf.CustomRequestHandling.createInRestCallActionUnderRequestHandling(a);
                    fillTemplate(f, rq.template || mf.StringTemplate.createInCustomRequestHandlingUnderTemplate(rq), spec.body || "", spec.bodyArgs, `${where} body`, true);
                    a.requestHandlingType = mf.RequestHandlingType.Custom;
                }
                const response = spec.response === undefined ? (spec.variable ? "string" : "none") : String(spec.response);
                const how = /^none$/i.test(response) ? "none" : /^string$/i.test(response) ? "string" : "mapping";
                if (how === "mapping" && !response.includes(".")) fail(`${where}: response '${response}' is not none, string or an import mapping (Module.Mapping)`, response, ["none", "string"]);
                const r = a.resultHandling || mf.ResultHandling.createInRestCallActionUnderResultHandling(a);
                a.resultHandlingType = mf.ResultHandlingType[await resultHandling(f, r, how, { ...spec, mapping: response }, where)];
                break;
            }
            case "importWithMapping": {
                const src = await variableInfo(f.m, spec.source, where);
                if (src.entity) throw new Error(`${where}: source must be a String variable with the JSON/XML text, not ${src.list ? "a list" : "an object"}`);
                a = mf.ImportXmlAction.createIn(act);
                a.xmlDocumentVariableName = noDollar(spec.source);
                a.isValidationRequired = false;
                await resultHandling(f, a.resultHandling || mf.ResultHandling.createInImportXmlActionUnderResultHandling(a), "mapping", spec, where);
                break;
            }
            case "exportWithMapping": {
                const map = await h.get(spec.mapping);
                if (!(map instanceof exportmappings.ExportMapping)) throw new Error(`${where}: '${spec.mapping}' is not an export mapping`);
                const obj = await variableInfo(f.m, spec.object, where);
                const root = map.rootMappingElements[0];
                const want = root && root.entityQualifiedName;
                if (want && obj.entity && obj.entity !== want) throw new Error(`${where}: ${spec.mapping} exports ${want}, but $${noDollar(spec.object)} is ${obj.entity}`);
                a = mf.ExportXmlAction.createIn(act);
                a.isValidationRequired = false;
                const rq = mf.MappingRequestHandling.createInExportXmlActionUnderResultHandling(a);
                rq.mapping = map;
                rq.mappingArgumentVariableName = noDollar(spec.object);
                rq.contentType = contentType(map);
                mf.VariableExport.createIn(a).outputVariableName = noDollar(spec.variable);
                break;
            }
        }
        a.errorHandlingType = errorDefault(f);
        if (spec.caption) {
            act.caption = String(spec.caption);
            act.autoGenerateCaption = false;
        }
        return act;
    }

    // ------------------------------------------------ structured sequences

    // f: { m, coll, nano, inLoop, inHandler, returns }. Places specs left to right from (x, y), connecting from prev.
    // Returns { first, tail (null when the sequence ended), width, height (in lanes) }.
    async function buildSeq(f, specs, x, y, prev, where) {
        if (!Array.isArray(specs)) throw new Error(`${where}: expected a list of actions [ ... ]`);
        const castable = f.castable; // first action of an ifType case: may be a cast
        f = { ...f, castable: null };
        let cursor = x;
        let height = 1;
        let first = null;
        let tail = prev;
        let ended = false;
        const link = obj => {
            if (tail) connect(f, tail, obj);
            if (!first) first = obj;
        };
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            const w = `${where} action ${i + 1}`;
            if (!spec || typeof spec !== "object") throw new Error(`${w}: each action must be an object { "action": ... }`);
            if (ended) throw new Error(`${w}: unreachable: an earlier action already ended this path (end/break/continue/error)`);
            const kind = spec.action;
            if (/^call(Microflow|Nanoflow)$/i.test(kind)) throw new Error(`${w}: unknown action '${kind}'; use "call" with "microflow": "Module.Flow" (microflows and nanoflows)`);
            if (!ACTIONS[kind] && !CONTROL[kind]) fail(`${w}: unknown action '${kind}'`, kind, [...Object.keys(ACTIONS), ...Object.keys(CONTROL)]);
            if (CONTROL[kind]) validate("action", kind, CONTROL[kind], spec, w);
            if (kind === "cast" && !(i === 0 && castable)) throw new Error(`${w}: 'cast' must be the first action of a case of an ifType (it casts the object to that case's entity)`);
            switch (kind) {
                case "ifType": {
                    const entityQn = await needVariable(f.m, spec.variable, false, w);
                    const cases = spec.cases && typeof spec.cases === "object" && !Array.isArray(spec.cases) ? Object.entries(spec.cases) : [];
                    if (!cases.length) throw new Error(`${w}: ifType needs cases: { "Module.Specialization": [ actions ] }`);
                    const specs = await specializationsOf(entityQn);
                    if (!specs.length) throw new Error(`${w}: no entity inherits from ${entityQn}, so there is no type to decide on`);
                    for (const [qn, list] of cases) {
                        if (!specs.includes(qn)) fail(`${w}: ${qn} is not a specialization of ${entityQn}`, qn, specs);
                        if (!Array.isArray(list)) throw new Error(`${w}: case ${qn} must be a list of actions [ ... ]`);
                    }
                    const split = mf.InheritanceSplit.createIn(f.coll);
                    point(split, cursor, y);
                    size(split, 60, 40);
                    split.splitVariableName = noDollar(spec.variable);
                    split.caption = spec.caption ? String(spec.caption) : "";
                    link(split);
                    cursor += X_STEP;
                    // one flow per case, then the variable's own entity (any other type), then empty
                    const branches = [...cases.map(([qn, acts]) => ({ type: qn, acts, castable: qn })), { type: entityQn, acts: spec.other || [] }, { type: "", acts: spec.empty || [] }];
                    let laneY = y;
                    let width = 0;
                    const open = [];
                    for (const [bi, b] of branches.entries()) {
                        const seg = await buildSeq({ ...f, castable: b.castable || null }, b.acts, cursor, laneY, { obj: split, originIndex: bi ? 2 : 1, caseValue: { type: b.type } }, `${w} ${b.type || "empty"}`);
                        if (seg.tail) open.push(seg.tail);
                        width = Math.max(width, seg.width);
                        laneY += LANE * seg.height;
                    }
                    cursor += width;
                    height = Math.max(height, (laneY - y) / LANE);
                    if (open.length > 1) {
                        const merge = mf.ExclusiveMerge.createIn(f.coll);
                        point(merge, cursor, y);
                        size(merge, 60, 60);
                        open.forEach((t, k) => connect(f, t, merge, k ? 2 : 3));
                        tail = { obj: merge, originIndex: 1 };
                        cursor += X_STEP;
                    } else if (open.length === 1) tail = open[0];
                    else {
                        tail = null;
                        ended = true;
                    }
                    break;
                }
                case "if": {
                    const split = mf.ExclusiveSplit.createIn(f.coll);
                    point(split, cursor, y);
                    size(split, 130, 80);
                    split.caption = String(spec.caption || spec.condition);
                    split.errorHandlingType = errorDefault(f);
                    const cond = mf.ExpressionSplitCondition.createIn(split);
                    cond.expression = expr(f.m, spec.condition, w);
                    link(split);
                    cursor += X_STEP;
                    const thenSeg = await buildSeq(f, spec.then || [], cursor, y, { obj: split, originIndex: 1, caseValue: "true" }, `${w} then`);
                    const elseY = y + LANE * Math.max(thenSeg.height, height);
                    const elseSeg = await buildSeq(f, spec.else || [], cursor, elseY, { obj: split, originIndex: 2, caseValue: "false" }, `${w} else`);
                    cursor += Math.max(thenSeg.width, elseSeg.width);
                    height = Math.max(height, (elseY - y) / LANE + elseSeg.height);
                    const open = [thenSeg.tail, elseSeg.tail].filter(Boolean);
                    if (open.length === 2) {
                        const merge = mf.ExclusiveMerge.createIn(f.coll);
                        point(merge, cursor, y);
                        size(merge, 60, 60);
                        connect(f, thenSeg.tail, merge, 3);
                        connect(f, elseSeg.tail, merge, 2);
                        tail = { obj: merge, originIndex: 1 };
                        cursor += X_STEP;
                    } else if (open.length === 1) tail = open[0];
                    else {
                        tail = null;
                        ended = true;
                    }
                    break;
                }
                case "loop": {
                    if (!spec.over === !spec.while) throw new Error(`${w}: loop needs either 'over' (a list variable) or 'while' (a condition)`);
                    const loop = mf.LoopedActivity.createIn(f.coll);
                    loop.errorHandlingType = errorDefault(f);
                    if (spec.over) {
                        const src = mf.IterableList.createIn(loop);
                        src.listVariableName = noDollar(spec.over);
                        src.variableName = noDollar(spec.item || `${noDollar(spec.over)}Item`);
                        if (!variablesOf(f.m).has(src.listVariableName)) fail(`${w}: no list variable '${spec.over}' before this loop`, src.listVariableName, [...variablesOf(f.m).keys()]);
                    } else {
                        const src = mf.WhileLoopCondition.createIn(loop);
                        src.whileExpression = expr(f.m, spec.while, w);
                    }
                    if (!Array.isArray(spec.actions) || !spec.actions.length) throw new Error(`${w}: loop needs actions: [ ... ]`);
                    const inner = { ...f, coll: loop.objectCollection, inLoop: true };
                    const seg = await buildSeq(inner, spec.actions, 100, 80, null, `${w} loop`);
                    const width = Math.max(300, seg.width + 80);
                    const loopHeight = Math.max(160, 80 + LANE * seg.height);
                    size(loop, width, loopHeight);
                    point(loop, cursor - 60 + width / 2, y - 80 + loopHeight / 2);
                    link(loop);
                    tail = { obj: loop, originIndex: 1 };
                    cursor += width + 70;
                    height = Math.max(height, Math.ceil(loopHeight / LANE));
                    break;
                }
                case "end": {
                    if (f.inLoop) throw new Error(`${w}: 'end' is not allowed inside a loop; use 'break'`);
                    const end = mf.EndEvent.createIn(f.coll);
                    point(end, cursor, y);
                    size(end, 20, 20);
                    if (f.returns) {
                        if (spec.value === undefined) throw new Error(`${w}: this flow returns a value; 'end' needs 'value'`);
                        end.returnValue = expr(f.m, spec.value, w);
                    } else if (spec.value !== undefined) throw new Error(`${w}: this flow returns nothing; remove 'value'`);
                    link(end);
                    tail = null;
                    ended = true;
                    break;
                }
                case "break":
                case "continue": {
                    if (!f.inLoop) throw new Error(`${w}: '${kind}' is only allowed inside a loop`);
                    const ev = (kind === "break" ? mf.BreakEvent : mf.ContinueEvent).createIn(f.coll);
                    point(ev, cursor, y);
                    size(ev, 20, 20);
                    link(ev);
                    tail = null;
                    ended = true;
                    break;
                }
                case "error": {
                    if (!f.inHandler) throw new Error(`${w}: 'error' is only allowed inside an onError handler`);
                    const ev = mf.ErrorEvent.createIn(f.coll);
                    point(ev, cursor, y);
                    size(ev, 20, 20);
                    link(ev);
                    tail = null;
                    ended = true;
                    break;
                }
                default: {
                    const act = await activity(f, spec, cursor, y, w);
                    link(act);
                    tail = { obj: act, originIndex: 1 };
                    if (spec.onError !== undefined) height += await errorHandler(f, act, spec.onError, cursor, y + LANE * height, w);
                    cursor += X_STEP;
                }
            }
        }
        return { first, tail: ended ? null : tail, width: cursor - x, height };
    }

    // Returns the lanes it used.
    async function errorHandler(f, act, onError, x, y, where) {
        const a = act.action;
        if (onError === "continue") {
            a.errorHandlingType = mf.ErrorHandlingType.Continue;
            return 0;
        }
        if (!onError || typeof onError !== "object" || Array.isArray(onError)) throw new Error(`${where}: onError must be "continue" or { "rollback": ..., "actions": [ ... ] }`);
        validate("-", "onError", { fields: { rollback: "optional", actions: "optional", returnValue: "optional" } }, onError, where);
        const rollback = f.nano ? false : bool(onError.rollback, true);
        a.errorHandlingType = rollback ? mf.ErrorHandlingType.Custom : mf.ErrorHandlingType.CustomWithoutRollBack;
        const hf = { ...f, inHandler: true };
        const seg = await buildSeq(hf, onError.actions || [], x, y, { obj: act, originIndex: 2, errorHandler: true }, `${where} onError`);
        if (seg.tail) {
            if (f.inLoop) throw new Error(`${where}: an error handler inside a loop must end with 'break', 'continue' or 'error'`);
            const end = mf.EndEvent.createIn(f.coll);
            point(end, x + Math.max(seg.width, X_STEP / 2), y);
            size(end, 20, 20);
            if (f.returns) {
                if (onError.returnValue === undefined) throw new Error(`${where}: this flow returns a value; onError needs 'returnValue'`);
                end.returnValue = expr(f.m, onError.returnValue, where);
            }
            connect(hf, seg.tail, end);
        }
        return seg.height;
    }

    // ------------------------------------------------ create / insert

    async function createFlow(o, nano, container) {
        const qn = `${o.module}.${o.name}`;
        const m = (nano ? mf.Nanoflow : mf.Microflow).createIn(container);
        m.name = o.name;
        const f = { m, coll: m.objectCollection, nano, inLoop: false, inHandler: false, returns: false };
        const start = mf.StartEvent.createIn(m.objectCollection);
        point(start, 100, 200);
        size(start, 20, 20);
        for (const [i, p] of (o.parameters || []).entries()) {
            if (!p || !p.name || !p.type) throw new Error(`${qn}: parameter ${i + 1} needs name and type`);
            const po = mf.MicroflowParameterObject.createIn(m.objectCollection);
            po.name = p.name;
            po.variableType = await h.dataType(p.type);
            point(po, 100 + i * 120, 80);
            size(po, 30, 30);
        }
        if (o.returns) {
            m.microflowReturnType = await h.dataType(o.returns);
            f.returns = returnsValue(m);
        }
        const seg = await buildSeq(f, o.actions || [], 100 + X_STEP, 200, { obj: start, originIndex: 1 }, qn);
        if (seg.tail) {
            const end = mf.EndEvent.createIn(m.objectCollection);
            point(end, 100 + X_STEP + seg.width, 200);
            size(end, 20, 20);
            if (f.returns) {
                if (o.returnValue === undefined) throw new Error(`${qn}: returns is set, so returnValue is required`);
                end.returnValue = expr(m, o.returnValue, `${qn} returnValue`);
            }
            connect(f, seg.tail, end);
        }
        let count = 0;
        walkObjects(m.objectCollection, x => x instanceof mf.ActionActivity && count++);
        return { m, count };
    }

    // Moves everything right of x in coll by dx (only the objects in 'only', when given) and widens the loops around it.
    function makeRoom(coll, x, dx, only = null) {
        for (const o of coll.objects) {
            if (o instanceof mf.MicroflowParameterObject || o instanceof mf.Annotation) continue;
            if (only && !only.has(o.id)) continue;
            if (o.relativeMiddlePoint.x > x) point(o, o.relativeMiddlePoint.x + dx, o.relativeMiddlePoint.y);
        }
        const loop = coll.container;
        if (loop instanceof mf.LoopedActivity) {
            const p = loop.relativeMiddlePoint;
            size(loop, loop.size.width + dx, loop.size.height);
            point(loop, p.x + dx / 2, p.y);
            makeRoom(loop.container, p.x, dx);
        }
    }

    function flowsOf(m) {
        return [...m.flows].filter(x => x instanceof mf.SequenceFlow);
    }

    async function addActions(o) {
        const m = await flowDoc(o.microflow);
        if (!Array.isArray(o.actions) || !o.actions.length) throw new Error("addActions needs actions: [ ... ]");
        const sequence = flowsOf(m).filter(x => !x.isErrorHandler);
        let anchorFlow;
        if (!o.after) {
            const ends = [];
            walkObjects(m.objectCollection, x => x instanceof mf.EndEvent && ends.push(x));
            if (ends.length !== 1) throw new Error(`${o.microflow} has ${ends.length} end events; say where with "after": "start", a variable name, or a step id (see: steps ${o.microflow})`);
            const into = sequence.filter(x => x.destination === ends[0]);
            if (into.length !== 1) throw new Error(`${o.microflow}: ${into.length} flows reach the end event; use "after"`);
            anchorFlow = into[0];
        } else {
            const anchor = o.after === "start" ? m.objectCollection.objects.find(x => x instanceof mf.StartEvent) : variablesOf(m).get(noDollar(o.after)) || findStep(m, o.after, true);
            if (!anchor || anchor instanceof mf.MicroflowParameterObject) fail(`${o.microflow}: no step creates variable '${o.after}' and no step has that id`, noDollar(o.after), ["start", ...variablesOf(m).keys()]);
            const out = sequence.filter(x => x.origin === anchor);
            if (out.length !== 1) throw new Error(`${o.microflow}: '${o.after}' has ${out.length} outgoing flows; pick another point (see: steps ${o.microflow})`);
            anchorFlow = out[0];
        }
        const from = anchorFlow.origin;
        const to = anchorFlow.destination;
        const coll = from.container;
        const f = { m, coll, nano: m instanceof mf.Nanoflow, inLoop: coll.container instanceof mf.LoopedActivity, inHandler: false, returns: returnsValue(m) };
        const fx = from.relativeMiddlePoint.x;
        const y = from.relativeMiddlePoint.y;
        const tail = { obj: from, originIndex: anchorFlow.originConnectionIndex, caseValue: caseOf(anchorFlow), errorHandler: anchorFlow.isErrorHandler };
        const destIndex = anchorFlow.destinationConnectionIndex;
        const before = new Set(coll.objects.map(x => x.id));
        anchorFlow.delete();
        const seg = await buildSeq(f, o.actions, fx + X_STEP, y, tail, o.microflow);
        if (!seg.tail) throw new Error(`${o.microflow}: inserted actions must not end the flow (end/break/continue); the steps after them would be cut off`);
        makeRoom(coll, fx, seg.width, before);
        connect(f, seg.tail, to, destIndex);
        return `${o.microflow}: ${o.actions.length} action(s) after ${o.after || "the last step"}`;
    }

    // ------------------------------------------------ steps (ids), change, delete

    function describe(o) {
        if (o instanceof mf.StartEvent) return "START";
        if (o instanceof mf.EndEvent) return "END" + (o.returnValue ? ` return ${o.returnValue}` : "");
        if (o instanceof mf.MicroflowParameterObject) return `PARAMETER $${o.name}`;
        if (o instanceof mf.ExclusiveSplit) return `IF ${o.splitCondition instanceof mf.ExpressionSplitCondition ? o.splitCondition.expression : o.caption}`;
        if (o instanceof mf.InheritanceSplit) return `IF TYPE OF $${o.splitVariableName}`;
        if (o instanceof mf.ExclusiveMerge) return "MERGE";
        if (o instanceof mf.BreakEvent) return "BREAK";
        if (o instanceof mf.ContinueEvent) return "CONTINUE";
        if (o instanceof mf.ErrorEvent) return "ERROR";
        if (o instanceof mf.LoopedActivity) {
            const s = o.loopSource;
            return s instanceof mf.IterableList ? `LOOP $${s.variableName} IN $${s.listVariableName}` : `WHILE ${s ? s.whileExpression : "?"}`;
        }
        if (!(o instanceof mf.ActionActivity)) return o.structureTypeName.split("$")[1];
        const a = o.action;
        const off = o.disabled ? " (disabled)" : "";
        if (!a) return "EMPTY ACTIVITY" + off;
        const t = a.structureTypeName.split("$")[1];
        let s;
        if (a instanceof mf.RetrieveAction) {
            const src = a.retrieveSource;
            s = src instanceof mf.DatabaseRetrieveSource
                ? `RETRIEVE $${a.outputVariableName} = ${src.range instanceof mf.ConstantRange && src.range.singleObject ? "FIRST " : ""}${src.entityQualifiedName}${src.xPathConstraint ? " " + src.xPathConstraint : ""}`
                : `RETRIEVE $${a.outputVariableName} = $${src.startVariableName}/${src.associationQualifiedName}`;
        } else if (a instanceof mf.CreateObjectAction) s = `CREATE $${a.outputVariableName} = ${a.entityQualifiedName}`;
        else if (a instanceof mf.ChangeObjectAction) s = `CHANGE $${a.changeVariableName}`;
        else if (a instanceof mf.CommitAction) s = `COMMIT $${a.commitVariableName}`;
        else if (a instanceof mf.DeleteAction) s = `DELETE $${a.deleteVariableName}`;
        else if (a instanceof mf.MicroflowCallAction) s = `CALL ${a.microflowCall.microflowQualifiedName}${a.useReturnVariable ? " -> $" + a.outputVariableName : ""}`;
        else if (a instanceof mf.NanoflowCallAction) s = `CALL ${a.nanoflowCall.nanoflowQualifiedName}${a.useReturnVariable ? " -> $" + a.outputVariableName : ""}`;
        else if (a instanceof mf.LogMessageAction) s = `LOG ${a.level.name} '${a.messageTemplate.text}'`;
        else if (a instanceof mf.ShowMessageAction) s = `MESSAGE ${a.type.name}`;
        else if (a instanceof mf.CreateVariableAction) s = `VARIABLE $${a.variableName} = ${a.initialValue}`;
        else if (a instanceof mf.ChangeVariableAction) s = `SET $${a.changeVariableName} = ${a.value}`;
        else if (a instanceof mf.ShowPageAction) s = `SHOW PAGE ${a.pageSettings ? a.pageSettings.pageQualifiedName : "?"}`;
        else if (a instanceof mf.CloseFormAction) s = "CLOSE PAGE";
        else if (a instanceof mf.ShowHomePageAction) s = "SHOW HOME PAGE";
        else if (a instanceof mf.JavaActionCallAction || a instanceof mf.JavaScriptActionCallAction) {
            const js = a instanceof mf.JavaScriptActionCallAction;
            s = `CALL ${js ? "JAVASCRIPT" : "JAVA"} ${js ? a.javaScriptActionQualifiedName : a.javaActionQualifiedName}${a.useReturnVariable && a.outputVariableName ? " -> $" + a.outputVariableName : ""}`;
        } else if (a instanceof mf.ValidationFeedbackAction) s = `VALIDATION FEEDBACK $${a.objectVariableName}/${a.attributeQualifiedName ? a.attributeQualifiedName.split(".").pop() : a.associationQualifiedName}`;
        else if (a instanceof mf.RollbackAction) s = `ROLLBACK $${a.rollbackVariableName}`;
        else if (a instanceof mf.CreateListAction) s = `CREATE LIST $${a.outputVariableName} OF ${a.entityQualifiedName}`;
        else if (a instanceof mf.ChangeListAction) s = `CHANGE LIST $${a.changeVariableName} ${a.type.name.toUpperCase()}${a.value ? " " + a.value : ""}`;
        else if (a instanceof mf.AggregateListAction) s = `AGGREGATE $${a.outputVariableName} = ${a.aggregateFunction.name.toUpperCase()}($${a.inputListVariableName}${a.useExpression ? ", " + a.expression : a.attributeQualifiedName ? "/" + a.attributeQualifiedName.split(".").pop() : ""})`;
        else if (a instanceof mf.ListOperationAction) {
            const op = a.operation;
            const detail = !op ? "" : op.secondListOrObjectVariableName ? `, $${op.secondListOrObjectVariableName}`
                : op instanceof mf.Find || op instanceof mf.Filter ? `, ${op.attributeQualifiedName ? op.attributeQualifiedName.split(".").pop() : op.associationQualifiedName} = ${op.expression}`
                : op.expression !== undefined ? `, ${op.expression}` : op instanceof mf.ListRange && op.customRange ? `, ${op.customRange.offsetExpression}, ${op.customRange.limitExpression}` : "";
            s = `LIST $${a.outputVariableName} = ${op ? op.structureTypeName.split("$")[1].toUpperCase() : "?"}($${op ? op.listVariableName : "?"}${detail})`;
        } else if (a instanceof mf.CastAction) s = `CAST -> $${a.outputVariableName}`;
        else if (a instanceof mf.DownloadFileAction) s = `DOWNLOAD $${a.fileDocumentVariableName}`;
        else if (a instanceof mf.RestCallAction) {
            const http = a.httpConfiguration;
            const r = a.resultHandling;
            s = `REST ${http ? http.newHttpMethod.name.toUpperCase() : "?"} ${http && http.customLocationTemplate ? http.customLocationTemplate.text : "?"}${r && r.storeInVariable ? " -> $" + r.outputVariableName : ""}`;
        } else if (a instanceof mf.ImportXmlAction) {
            const r = a.resultHandling;
            s = `IMPORT $${a.xmlDocumentVariableName} WITH ${r && r.importMappingCall ? r.importMappingCall.mappingQualifiedName : "?"}${r && r.storeInVariable ? " -> $" + r.outputVariableName : ""}`;
        } else if (a instanceof mf.ExportXmlAction) {
            const r = a.resultHandling;
            s = `EXPORT $${r ? r.mappingArgumentVariableName : "?"} WITH ${r ? r.mappingQualifiedName : "?"}${a.outputMethod && a.outputMethod.outputVariableName ? " -> $" + a.outputMethod.outputVariableName : ""}`;
        } else s = t.replace(/Action$/, "").toUpperCase();
        return s + off;
    }

    async function steps(qn) {
        const m = await flowDoc(qn);
        const all = [];
        walkObjects(m.objectCollection, o => all.push(o));
        const flows = flowsOf(m);
        const byOrigin = new Map();
        const incoming = new Set();
        for (const fl of flows) {
            if (!byOrigin.has(fl.origin.id)) byOrigin.set(fl.origin.id, []);
            byOrigin.get(fl.origin.id).push(fl);
            incoming.add(fl.destination.id);
        }
        const lines = [`${m instanceof mf.Nanoflow ? "NANOFLOW" : "MICROFLOW"} ${qn}   (ids are stable; use them in changeAction / deleteAction / addActions "after")`];
        const seen = new Set();
        const visit = (o, depth, label) => {
            const pad = "  ".repeat(depth);
            if (seen.has(o.id)) return lines.push(`${pad}${label}-> [${short(o)}] ${describe(o)} (above)`);
            seen.add(o.id);
            lines.push(`${pad}${label}[${short(o)}] ${describe(o)}`);
            if (o instanceof mf.LoopedActivity) {
                for (const x of o.objectCollection.objects) if (!incoming.has(x.id) && !(x instanceof mf.Annotation)) visit(x, depth + 2, "");
            }
            const outs = byOrigin.get(o.id) || [];
            const normal = outs.filter(x => !x.isErrorHandler);
            for (const x of outs.filter(x => x.isErrorHandler)) visit(x.destination, depth + 1, "[on error] ");
            if (normal.length === 1 && caseOf(normal[0]) === null) visit(normal[0].destination, depth, "");
            else for (const x of normal) visit(x.destination, depth + 1, `[${caseLabel(x)}] `);
        };
        for (const p of m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject)) visit(p, 0, "");
        const start = m.objectCollection.objects.find(x => x instanceof mf.StartEvent);
        if (start) visit(start, 0, "");
        const rest = all.filter(o => !seen.has(o.id) && !(o instanceof mf.Annotation));
        if (rest.length) {
            lines.push("NOT CONNECTED:");
            for (const o of rest) visit(o, 1, "");
        }
        return lines.join("\n");
    }

    function findStep(m, id, quiet) {
        const want = String(id).toLowerCase().replace(/^\[|\]$/g, "");
        const hits = [];
        walkObjects(m.objectCollection, o => o.id.startsWith(want) && hits.push(o));
        if (hits.length === 1) return hits[0];
        if (quiet) return null;
        if (!hits.length) throw new Error(`${m.qualifiedName} has no step with id '${id}'. List the ids with: steps ${m.qualifiedName}`);
        throw new Error(`id '${id}' matches ${hits.length} steps in ${m.qualifiedName}; use more characters`);
    }

    // Field -> how to apply it, per kind of step. Each returns nothing; throws on bad input.
    const CHANGES = {
        activity: {
            caption: (f, o, v) => {
                o.caption = String(v);
                o.autoGenerateCaption = false;
            },
            disabled: (f, o, v) => (o.disabled = bool(v, false))
        },
        RetrieveAction: {
            xpath: (f, a, v) => {
                if (!(a.retrieveSource instanceof mf.DatabaseRetrieveSource)) throw new Error("xpath only applies to a database retrieve");
                a.retrieveSource.xPathConstraint = String(v);
            },
            first: (f, a, v) => {
                if (!(a.retrieveSource instanceof mf.DatabaseRetrieveSource)) throw new Error("first only applies to a database retrieve");
                const range = mf.ConstantRange.createInDatabaseRetrieveSourceUnderRange(a.retrieveSource);
                range.singleObject = bool(v, false);
            },
            entity: async (f, a, v) => {
                if (!(a.retrieveSource instanceof mf.DatabaseRetrieveSource)) throw new Error("entity only applies to a database retrieve");
                a.retrieveSource.entity = await h.entity(v);
            }
        },
        members: {
            set: async (f, a, v, where) => {
                const entityQn = a instanceof mf.CreateObjectAction ? a.entityQualifiedName : await entityOfVariable(f.m, a.changeVariableName, where);
                const ent = await h.entity(entityQn);
                await h.loadParents(ent);
                for (const [member, value] of Object.entries(v || {})) {
                    const existing = [...a.items].find(mc => (member.includes(".") ? mc.associationQualifiedName : mc.attribute && mc.attribute.name) === member);
                    if (existing) existing.value = expr(f.m, value, where);
                    else await memberChange(f, a, ent, entityQn, member, value, where);
                }
            },
            unset: (f, a, v) => {
                for (const member of [].concat(v)) {
                    const existing = [...a.items].find(mc => (member.includes(".") ? mc.associationQualifiedName : mc.attribute && mc.attribute.name) === member);
                    if (!existing) throw new Error(`no change of '${member}' to remove`);
                    existing.delete();
                }
            },
            commit: (f, a, v) => (a.commit = bool(v, false) ? mf.CommitEnum.Yes : mf.CommitEnum.No),
            refresh: (f, a, v) => (a.refreshInClient = bool(v, false))
        },
        CommitAction: { events: (f, a, v) => (a.withEvents = bool(v, true)), refresh: (f, a, v) => (a.refreshInClient = bool(v, false)) },
        call: {
            args: (f, a, v, where) => {
                const call = a.microflowCall || a.nanoflowCall;
                for (const [name, value] of Object.entries(v || {})) {
                    const pm = [...call.parameterMappings].find(x => x.parameterQualifiedName.split(".").pop() === name);
                    if (!pm) fail(`${where}: the call has no parameter '${name}'`, name, [...call.parameterMappings].map(x => x.parameterQualifiedName.split(".").pop()));
                    pm.argument = expr(f.m, value, where);
                }
            }
        },
        LogMessageAction: {
            message: (f, a, v) => (a.messageTemplate.text = String(v)),
            level: (f, a, v) => (a.level = enumValue(mf.LogLevel, v, "log level")),
            args: (f, a, v, where) => {
                for (const old of [...a.messageTemplate.arguments]) old.delete();
                for (const e of [].concat(v)) mf.TemplateArgument.createIn(a.messageTemplate).expression = expr(f.m, e, where);
            }
        },
        ShowMessageAction: {
            text: (f, a, v) => h.text(a.template.text, v),
            type: (f, a, v) => (a.type = enumValue(mf.ShowMessageType, v, "message type")),
            blocking: (f, a, v) => (a.blocking = bool(v, true))
        },
        code: {
            args: async (f, a, v, where) => {
                for (const [name, value] of Object.entries(v || {})) {
                    const pm = [...a.parameterMappings].find(x => x.parameterQualifiedName.split(".").pop() === name);
                    if (!pm) fail(`${where}: the call has no parameter '${name}'`, name, [...a.parameterMappings].map(x => x.parameterQualifiedName.split(".").pop()));
                    const pv = pm.parameterValue;
                    if (pv instanceof mf.EntityTypeCodeActionParameterValue) pv.entity = await h.entity(value);
                    else if (pv instanceof mf.BasicCodeActionParameterValue) pv.argument = expr(f.m, value, where);
                    else throw new Error(`${where}: parameter '${name}' takes no expression; change it in Studio Pro`);
                }
            }
        },
        ValidationFeedbackAction: {
            message: (f, a, v) => h.text(a.feedbackTemplate.text, v),
            args: (f, a, v, where) => fillTemplate(f, a.feedbackTemplate, null, [].concat(v), where)
        },
        RollbackAction: { refresh: (f, a, v) => (a.refreshInClient = bool(v, false)) },
        ChangeListAction: {
            type: (f, a, v) => {
                const type = CHANGE_LIST[String(v).toLowerCase()];
                if (!type) fail(`type '${v}' is not one of add | remove | replace | clear`, v, Object.keys(CHANGE_LIST));
                a.type = mf.ChangeListActionType[type];
                if (type === "Clear") a.value = "";
            },
            value: (f, a, v, where) => {
                if (a.type === mf.ChangeListActionType.Clear) throw new Error("clear takes no value; change 'type' first");
                a.value = expr(f.m, v, where);
            }
        },
        AggregateListAction: {
            function: async (f, a, v, where, o) => {
                const fn = AGGREGATE[String(v).toLowerCase()];
                if (!fn) fail(`function '${v}' is not one of count | sum | average | minimum | maximum | all | any`, v, Object.keys(AGGREGATE));
                a.aggregateFunction = mf.AggregateFunctionEnum[fn];
                if (fn === "Count") {
                    a.attribute = null;
                    a.useExpression = false;
                    a.expression = "";
                } else if (o.attribute === undefined && o.expression === undefined) {
                    // keep what it aggregates when that still fits the new function
                    if (!a.useExpression && !a.attributeQualifiedName) throw new Error(`${where}: ${v} needs 'attribute' or 'expression' too`);
                    if (!a.useExpression) await aggregateAttribute(fn, await needVariable(f.m, a.inputListVariableName, true, where), a.attributeQualifiedName, where);
                }
            },
            attribute: async (f, a, v, where) => {
                a.attribute = await aggregateAttribute(a.aggregateFunction.name, await needVariable(f.m, a.inputListVariableName, true, where), v, where);
                a.useExpression = false;
                a.expression = "";
            },
            expression: async (f, a, v, where) => {
                if (a.aggregateFunction === mf.AggregateFunctionEnum.Count) throw new Error(`${where}: count takes no expression; change 'function' first`);
                a.expression = expr(f.m, v, where, await needVariable(f.m, a.inputListVariableName, true, where));
                a.useExpression = true;
                a.attribute = null;
            }
        },
        ListOperationAction: {
            value: (f, a, v, where) => {
                if (!(a.operation instanceof mf.Find || a.operation instanceof mf.Filter)) throw new Error("'value' only applies to find/filter on an attribute");
                a.operation.expression = expr(f.m, v, where);
            },
            expression: async (f, a, v, where) => {
                if (!(a.operation instanceof mf.FindByExpression || a.operation instanceof mf.FilterByExpression)) throw new Error("'expression' only applies to find/filter by expression");
                a.operation.expression = expr(f.m, v, where, await needVariable(f.m, a.operation.listVariableName, true, where));
            },
            other: (f, a, v) => {
                if (a.operation.secondListOrObjectVariableName === undefined) throw new Error("'other' only applies to union, intersect, subtract, contains and equals");
                a.operation.secondListOrObjectVariableName = noDollar(v);
            },
            offset: (f, a, v, where) => {
                if (!(a.operation instanceof mf.ListRange)) throw new Error("'offset' only applies to range");
                a.operation.customRange.offsetExpression = expr(f.m, v, where);
            },
            limit: (f, a, v, where) => {
                if (!(a.operation instanceof mf.ListRange)) throw new Error("'limit' only applies to range");
                a.operation.customRange.limitExpression = expr(f.m, v, where);
            }
        },
        DownloadFileAction: { showInBrowser: (f, a, v) => (a.showFileInBrowser = bool(v, false)) },
        RestCallAction: {
            url: (f, a, v, where) => fillTemplate(f, a.httpConfiguration.customLocationTemplate, v, [...a.httpConfiguration.customLocationTemplate.arguments].map(x => x.expression), where, true),
            urlArgs: (f, a, v, where) => fillTemplate(f, a.httpConfiguration.customLocationTemplate, null, [].concat(v), where),
            method: (f, a, v) => (a.httpConfiguration.newHttpMethod = enumValue(services.HttpMethod, v, "HTTP method")),
            headers: (f, a, v, where) => {
                if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: headers must be { "Name": "expression" } (it replaces all headers)`);
                for (const old of [...a.httpConfiguration.headerEntries]) old.delete();
                for (const [k, x] of Object.entries(v)) {
                    const e = mf.HttpHeaderEntry.createInHttpConfigurationUnderHeaderEntries(a.httpConfiguration);
                    e.key = k;
                    e.value = expr(f.m, x, where);
                }
            },
            timeout: (f, a, v, where) => {
                a.useRequestTimeOut = true;
                a.timeOutExpression = expr(f.m, v, where);
            },
            body: (f, a, v, where) => {
                if (!(a.requestHandling instanceof mf.CustomRequestHandling)) throw new Error("'body' only applies to a call with a text body (this one uses a mapping or form data)");
                fillTemplate(f, a.requestHandling.template, v, [...a.requestHandling.template.arguments].map(x => x.expression), where, true);
            },
            bodyArgs: (f, a, v, where) => {
                if (!(a.requestHandling instanceof mf.CustomRequestHandling)) throw new Error("'bodyArgs' only applies to a call with a text body");
                fillTemplate(f, a.requestHandling.template, null, [].concat(v), where);
            },
            commit: (f, a, v) => importCommit(a.resultHandling, v)
        },
        ImportXmlAction: { commit: (f, a, v) => importCommit(a.resultHandling, v) },
        InheritanceSplit: { caption: (f, o, v) => (o.caption = String(v)) },
        CreateVariableAction: { value: (f, a, v, where) => (a.initialValue = expr(f.m, v, where)) },
        ChangeVariableAction: { value: (f, a, v, where) => (a.value = expr(f.m, v, where)) },
        ExclusiveSplit: {
            condition: (f, o, v, where) => {
                if (!(o.splitCondition instanceof mf.ExpressionSplitCondition)) throw new Error("this decision uses a rule; change it in Studio Pro");
                o.splitCondition.expression = expr(f.m, v, where);
            },
            caption: (f, o, v) => (o.caption = String(v))
        },
        LoopedActivity: {
            while: (f, o, v, where) => {
                if (!(o.loopSource instanceof mf.WhileLoopCondition)) throw new Error("'while' only applies to a while loop");
                o.loopSource.whileExpression = expr(f.m, v, where);
            },
            over: (f, o, v) => {
                if (!(o.loopSource instanceof mf.IterableList)) throw new Error("'over' only applies to a list loop");
                o.loopSource.listVariableName = noDollar(v);
            }
        },
        EndEvent: {
            value: (f, o, v, where) => {
                if (!f.returns) throw new Error("this flow returns nothing");
                o.returnValue = expr(f.m, v, where);
            }
        }
    };

    function changeTable(o) {
        if (o instanceof mf.ActionActivity) {
            const a = o.action;
            const own =
                a instanceof mf.RetrieveAction ? CHANGES.RetrieveAction
                : a instanceof mf.CreateObjectAction || a instanceof mf.ChangeObjectAction ? CHANGES.members
                : a instanceof mf.MicroflowCallAction || a instanceof mf.NanoflowCallAction ? CHANGES.call
                : a instanceof mf.JavaActionCallAction || a instanceof mf.JavaScriptActionCallAction ? CHANGES.code
                : CHANGES[a && a.structureTypeName.split("$")[1]] || {};
            return { target: a, own, common: CHANGES.activity };
        }
        const t = o.structureTypeName.split("$")[1];
        return { target: o, own: CHANGES[t] || {}, common: {} };
    }

    async function changeAction(o) {
        const m = await flowDoc(o.microflow);
        const step = findStep(m, o.id);
        const f = { m, nano: m instanceof mf.Nanoflow, returns: returnsValue(m) };
        const { target, own, common } = changeTable(step);
        const fields = Object.keys(o).filter(k => !["op", "microflow", "id"].includes(k));
        if (!fields.length) throw new Error(`changeAction needs at least one field to change. For this step: ${[...Object.keys(own), ...Object.keys(common)].join(", ") || "(nothing can be changed)"}`);
        const where = `${o.microflow} [${o.id}]`;
        for (const k of fields) {
            const fn = own[k] || common[k];
            if (!fn) fail(`${where}: '${k}' cannot be changed on ${describe(step)}. Fields for this step: ${[...Object.keys(own), ...Object.keys(common)].join(", ") || "none"}`, k, [...Object.keys(own), ...Object.keys(common)]);
            await fn(f, own[k] ? target : step, o[k], where, o);
        }
        return `${where} ${describe(step)}: ${fields.join(", ")}`;
    }

    async function deleteAction(o) {
        const m = await flowDoc(o.microflow);
        const step = findStep(m, o.id);
        const where = `${o.microflow} [${o.id}] ${describe(step)}`;
        if (!(step instanceof mf.ActionActivity) && !(step instanceof mf.LoopedActivity)) throw new Error(`${where}: only actions and loops can be deleted; change decisions, merges and events in Studio Pro`);
        const doomed = new Set([step.id]);
        if (step instanceof mf.LoopedActivity) walkObjects(step.objectCollection, x => doomed.add(x.id));
        const flows = flowsOf(m);
        if (flows.some(x => x.isErrorHandler && x.origin.id === step.id)) throw new Error(`${where}: it has an error handler; remove that in Studio Pro first`);
        const incoming = flows.filter(x => x.destination.id === step.id);
        const outgoing = flows.filter(x => x.origin.id === step.id);
        if (outgoing.length > 1) throw new Error(`${where}: it has ${outgoing.length} outgoing flows`);
        const next = outgoing[0];
        for (const x of incoming) {
            if (next) {
                x.destination = next.destination;
                x.destinationConnectionIndex = next.destinationConnectionIndex;
            } else x.delete();
        }
        if (next) next.delete();
        for (const x of flowsOf(m)) if (doomed.has(x.origin.id) || doomed.has(x.destination.id)) x.delete();
        step.delete();
        return where;
    }

    // ------------------------------------------------ expression check ($Var/Member paths)

    async function lintExpressions() {
        const lint = [];
        for (const { m, expr: e, where, current } of toLint) {
            const re = /\$(\w+)\/([\w.]+)/g;
            let hit;
            while ((hit = re.exec(e))) {
                const [, variable, member] = hit;
                let entityQn;
                if (variable === "currentObject") {
                    if (!current) {
                        lint.push(`${where}: $currentObject only exists in an aggregate or list operation expression`);
                        continue;
                    }
                    entityQn = current;
                } else if (variable === "currentUser") continue;
                else {
                    const v = variablesOf(m).get(variable);
                    if (!v) {
                        lint.push(`${where}: $${variable} is not a parameter or a variable created in ${m.qualifiedName}`);
                        continue;
                    }
                    try {
                        entityQn = await entityOfVariable(m, variable, where);
                    } catch (err) {
                        continue; // primitive variable or unknown: nothing to check
                    }
                }
                if (!entityQn) continue;
                const ent = await h.entity(entityQn);
                await h.loadParents(ent);
                const first = member.split("/")[0];
                if (first.includes(".")) continue; // association path: Module.Assoc
                const chain = h.attributeChain(ent);
                if (!chain.complete) continue; // inherits from an entity outside the project (System.User, ...)
                const names = chain.attributes.map(a => a.name);
                if (!names.includes(first)) {
                    const s = suggest(first, names, 3);
                    lint.push(`${where}: ${entityQn} has no attribute '${first}' (in $${variable}/${member})` + (s.length ? `. Did you mean: ${s.join(", ")}?` : ""));
                }
            }
        }
        return lint;
    }

    return { createFlow, addActions, changeAction, deleteAction, steps, describe, variablesOf, walkObjects, flowDoc, lintExpressions, findStep };
}

module.exports = { makeFlows, ACTIONS, CONTROL, COMMON, CREATES };
