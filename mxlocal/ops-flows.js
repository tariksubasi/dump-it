"use strict";
// Microflows and nanoflows: build structured flows (actions, decisions, loops, error handlers, end/break/continue)
// laid out like Studio Pro does, list their steps with stable ids, and change or delete single steps.
const sdk = require("mendixmodelsdk");
const { DATA_TYPES, suggest, fail, validate, bool, noDollar, enumValue } = require("./ops-util");
const { makeFlowExtras, RETRIEVE_FIELDS, MEMBER_FIELDS } = require("./ops-flow-extras");
const L = require("./flow-layout");
const FE = require("./flow-errors");

const { microflows: mf, domainmodels: dm, datatypes, pages, codeactions, javaactions, javascriptactions, importmappings, exportmappings, services } = sdk;

const X_STEP = 190; // horizontal distance between steps
const LANE = 150; // vertical distance between branches

const ON_ERROR = FE.ON_ERROR_DOC;

// Activities (one box each). They also accept 'caption' and 'onError'.
const ACTIONS = {
    retrieve: {
        doc: "Retrieve from the database, or over an association when 'from' is set.",
        fields: { variable: "R result variable name", entity: "database retrieve: Module.Entity", xpath: "optional XPath, e.g. [Active = true()]", first: "optional true = single object", from: "association retrieve: variable name, e.g. Order", association: "association retrieve: Module.Association", ...RETRIEVE_FIELDS }
    },
    create: { doc: "Create an object.", fields: { variable: "R new variable name", entity: "R Module.Entity", set: "optional { \"Attribute\": \"expression\", \"Module.Assoc\": \"$Var\" }", ...MEMBER_FIELDS, commit: "optional true/false (default false)" } },
    change: { doc: "Change members of an object.", fields: { variable: "R variable to change (no $)", set: "{ \"Attribute\": \"expression\", \"Module.Assoc\": \"$Var\" } (set, add or remove is required)", ...MEMBER_FIELDS, commit: "optional true/false", refresh: "optional true/false" } },
    commit: { doc: "Commit an object or list.", fields: { variable: "R variable (no $)", events: "optional false = without events" } },
    delete: { doc: "Delete an object or list.", fields: { variable: "R variable (no $)" } },
    call: { doc: "Call a microflow. In a nanoflow: a nanoflow or a microflow.", fields: { microflow: "R Module.Microflow or Module.Nanoflow", args: "optional { \"ParamName\": \"expression\" }", variable: "optional result variable name" } },
    log: { doc: "Write a log line (microflows only).", fields: { message: "R text; {1} {2} are filled from args", args: "optional [\"expression\", ...]", level: "optional Info | Warning | Error | Debug | Trace | Critical", node: "optional log node name (default the module name)", stackTrace: "optional true = add the stack trace of $latestError (in an error handler)" } },
    message: { doc: "Show a message to the user.", fields: { text: "R message text", type: "optional Information | Warning | Error", blocking: "optional true/false" } },
    variable: { doc: "Create a variable.", fields: { name: "R variable name", type: "R " + DATA_TYPES, value: "R initial value expression, e.g. 0 or 'text' or empty" } },
    set: { doc: "Change a variable.", fields: { name: "R variable name (no $)", value: "R expression" } },
    showPage: { doc: "Open a page.", fields: { page: "R Module.Page", args: "optional { \"PageParameter\": \"$Variable\" } (every page parameter needs one)" } },
    closePage: { doc: "Close the current page.", fields: { count: "optional number of pages to close" } },
    showHomePage: { doc: "Open the home page (microflows only).", fields: {} },
    callJava: {
        doc: "Call a Java action (microflows only).",
        fields: { javaAction: "Module.JavaAction (required, unless preset)", args: "optional { \"Param\": \"expression\" } (every required parameter needs one; an entity type parameter takes \"Module.Entity\")", variable: "optional result variable name (when the Java action returns something)",
            preset: "optional publishBusinessEvent: the publish Java action of the Marketplace Business Events module (no javaAction needed)", event: "with preset publishBusinessEvent: the object variable of the business event to publish (a specialization of BusinessEvents.PublishedBusinessEvent)" }
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
        doc: "Count, sum, average, minimum or maximum of a list; all/any test a Boolean; reduce folds the list into one value.",
        fields: { variable: "R result variable name", list: "R list variable (no $)", function: "R count | sum | average | minimum | maximum | all | any | reduce", attribute: "attribute to aggregate (not for count/reduce)", expression: "instead of attribute: expression on $currentObject, e.g. $currentObject/Price * $currentObject/Quantity; reduce: on $currentResult and $currentObject, e.g. $currentResult + $currentObject/Amount",
            initial: "reduce: initial value expression, e.g. 0", type: "reduce: result type String | Integer | Long | Decimal | Boolean | DateTime | Enum(Module.Enumeration) (required when it cannot be told from initial)" }
    },
    listOperation: {
        doc: "Combine, search, filter, sort or cut a list.",
        fields: {
            variable: "R result variable name", operation: "R union | intersect | subtract | contains | head | tail | find | filter | sort | range", list: "R list variable (no $)",
            other: "union/intersect/subtract: second list variable; contains: object variable", attribute: "find/filter: attribute name or Module.Association", value: "find/filter: expression the attribute must equal",
            expression: "find/filter instead of attribute + value: condition on $currentObject", sort: "sort: [ \"Attribute\" or { \"attribute\": \"Attribute\", \"descending\": true } ]",
            offset: "range: index of the first item, expression (default 0)", limit: "range: number of items, expression"
        }
    },
    cast: { doc: "Use the object of an ifType case as that case's entity. Only as the first action of a case.", fields: { variable: "R new variable name" } },
    downloadFile: { doc: "Send a file document to the user's browser (microflows only).", fields: { variable: "R object variable of a System.FileDocument specialization (no $)", showInBrowser: "optional true/false (default false: download)" } },
    callRest: {
        doc: "Call a REST service (microflows only). Body: text, form data, a file (binary) or an export mapping. Response: ignored, a String, a file document or an import mapping.",
        fields: {
            url: "R location; {1} {2} are filled from urlArgs, e.g. https://api.example.com/orders/{1}", urlArgs: "optional [\"expression\", ...]", method: "optional Get | Post | Put | Patch | Delete | Head | Options (default Get)",
            headers: "optional { \"Header-Name\": \"expression\" }", timeout: "optional seconds (default 300)", body: "optional request body text; {1} {2} are filled from bodyArgs", bodyArgs: "optional [\"expression\", ...]",
            exportMapping: "optional Module.ExportMapping for the body (instead of body)", exportObject: "with exportMapping: variable to export (no $)",
            formData: "optional form-data body { \"key\": \"expression\" } (instead of body)", binaryBody: "optional file document to send as the body, e.g. $File (instead of body)",
            auth: "optional basic authentication { \"user\": \"expression\", \"password\": \"expression\" }, e.g. { \"user\": \"@Module.ApiUser\", \"password\": \"@Module.ApiPassword\" }",
            proxy: "optional default | none | { \"host\": \"expression\", \"port\": \"expression\", \"user\": \"expression\", \"password\": \"expression\" } (default: default = the app's proxy settings)",
            response: "optional none | string | file | Module.ImportMapping (default: string when variable is set, else none)", variable: "result variable: the response text, the file document or the import mapping result",
            fileEntity: "with response file: Module.Entity that inherits from System.FileDocument (default System.FileDocument)",
            commit: "with an import mapping: yes | no | withoutEvents (default withoutEvents)", errorBody: "optional true/false: on an error keep the response in $latestHttpResponse (default true)"
        }
    },
    importWithMapping: {
        doc: "Import JSON or XML text with an import mapping (microflows only).",
        fields: { mapping: "R Module.ImportMapping", source: "R String variable with the JSON/XML (no $)", variable: "optional result variable name", commit: "optional yes | no | withoutEvents (default withoutEvents)" }
    },
    exportWithMapping: {
        doc: "Export an object (or list) to JSON or XML text with an export mapping (microflows only).",
        fields: { mapping: "R Module.ExportMapping", object: "R variable to export (no $)", variable: "R new String variable for the text" }
    },
    metric: {
        doc: "Record an app metric (microflows only): a counter, an increment by 1, or a gauge value.",
        fields: { type: "R counter | increment | gauge", name: "R metric name, e.g. orders.created", value: "counter/gauge: number expression (counter default 1)", description: "optional text", tags: "optional { \"tag\": \"expression\" }" }
    },
    generateDocument: {
        doc: "Generate a document from a document template (microflows only; only in projects that already use this action, document templates are deprecated).",
        fields: { template: "R Module.DocumentTemplate", variable: "R file document variable to fill (no $)", args: "optional { \"Parameter\": \"$Variable\" }", type: "optional PDF | HTML | DOCX | DOC | RTF | ODT (default PDF)" }
    }
};
// Mendix actions ops cannot write: refused with the way out (no Studio Pro sample, or the Model SDK cannot write them).
const REFUSED = {
    publishBusinessEvent: "publishing a business event is the Java action of the Business Events module: { \"action\": \"callJava\", \"preset\": \"publishBusinessEvent\", \"event\": \"MyEvent\" } (ops callJava)",
    callMLModel: "calling an ML model is not supported: it needs an ML mapping document that only Studio Pro creates. Add it in Studio Pro (Toolbox > Machine learning > Call ML model)",
    callML: "see callMLModel: add it in Studio Pro",
    reduce: "reduce is a function of aggregateList: { \"action\": \"aggregateList\", \"function\": \"reduce\", \"initial\": \"0\", \"expression\": \"$currentResult + $currentObject/Amount\", ... }",
    annotation: "an annotation is not a step: put \"note\": \"text\" on an action, or use the op addAnnotation",
    while: "a while loop is { \"action\": \"loop\", \"while\": \"condition\", \"actions\": [ ... ] }"
};
// Actions defined next to their documents (consumed REST, workflows): { doc, fields, only: "micro" | "nano", creates,
// type: () => SDK action class, build(c, act, spec, where) -> action, info(a, c) -> { entity, list }, vars(a) -> [names],
// describe(a) -> text }. c: { f, h, model, expr, variableInfo, needVariable, fillTemplate }.
const FA = require("./ops-flow-actions");
const EXTRA_ACTIONS = { ...require("./ops-rest").REST_ACTIONS, ...require("./ops-workflows").WORKFLOW_ACTIONS, ...require("./ops-offline").SYNC_ACTION, ...FA.FLOW_ACTIONS };
for (const [old, now] of Object.entries(FA.ALIASES)) REFUSED[old] = `the action is called ${now}: { "action": "${now}", ... } (ops ${now})`;
const { SYSTEM_ASSOCIATIONS } = require("./ops-workflows");
Object.assign(ACTIONS, EXTRA_ACTIONS);
// Which field of an action names the variable it creates.
const CREATES = { retrieve: "variable", create: "variable", call: "variable", variable: "name", callJava: "variable", callJavaScript: "variable", createList: "variable", aggregateList: "variable", listOperation: "variable", cast: "variable", callRest: "variable", importWithMapping: "variable", exportWithMapping: "variable" };
for (const [n, x] of Object.entries(EXTRA_ACTIONS)) if (x.creates) CREATES[n] = x.creates;
const extraOf = a => a && Object.values(EXTRA_ACTIONS).find(x => a instanceof x.type());
const COMMON = { caption: "optional caption on the box (default: generated)", onError: ON_ERROR, note: "optional annotation text attached to this action" };

// Structure (no box of their own, or a special box).
const CONTROL = {
    if: {
        doc: "Decision. Runs 'then' when the condition (or a Boolean rule) is true, otherwise 'else'. A branch may end with end/break/continue.",
        fields: { condition: "boolean expression, e.g. $Order/Total > 100 (or 'rule')", rule: "instead of condition: Module.Rule that returns a Boolean", args: "with rule: { \"Param\": \"expression\" } (every rule parameter)", then: "optional [ actions ]", else: "optional [ actions ]", caption: "optional text in the diamond (default: the condition or the rule name)" }
    },
    switch: {
        doc: "Enumeration decision: one path per enumeration value (several values may share one: \"A, B\"), 'other' for the values not listed, 'empty' when there is no value. Open paths join again after it.",
        fields: { value: "enumeration expression, e.g. $Order/Status (or 'rule')", rule: "instead of value: Module.Rule that returns an enumeration", args: "with rule: { \"Param\": \"expression\" }", enumeration: "optional Module.Enumeration when it cannot be told from value", cases: "R { \"Value\": [ actions ], \"Value2, Value3\": [ actions ] }", other: "optional [ actions ] for the values not in cases (default: they go straight on)", empty: "optional [ actions ] when the value is empty (default: straight on)", caption: "optional text in the diamond" }
    },
    ifType: {
        doc: "Object type decision: runs the case of the object's specialization (start a case with 'cast' to use it as that entity), 'other' for any other type, 'empty' when there is no object.",
        fields: { variable: "R object variable (no $)", cases: "R { \"Module.Specialization\": [ actions ] }", other: "optional [ actions ]", empty: "optional [ actions ]", caption: "optional text in the diamond" }
    },
    loop: { doc: "Loop over a list ('over' + 'item'), or while a condition is true ('while').", fields: { over: "list variable to loop over (no $)", item: "name of the current object (default: <list>Item)", while: "boolean expression (instead of 'over')", actions: "R [ actions inside the loop ]", onError: "optional \"rollback\" / \"abort\" (default), a recipe (logAndShow, rethrow, storeError) or { \"actions\": [ ... ] }: error handling of the whole loop" } },
    end: { doc: "End the flow here.", fields: { value: "return expression; required when the flow returns a value" } },
    break: { doc: "Leave the loop (only inside a loop).", fields: {} },
    continue: { doc: "Go to the next loop item (only inside a loop).", fields: {} },
    error: { doc: "End with the error again (only inside an onError handler). With 'message': log that text first (microflow: Error level with the stack trace; nanoflow: with a JavaScript log action, jsLog).", fields: { message: "optional text to log before the error; {1} {2} are filled from args", args: "optional [\"expression\", ...], e.g. [\"$latestError/Message\"]", node: "optional log node (microflow)", jsLog: "nanoflow: optional Module.JavaScriptAction with a String parameter" } }
};

function makeFlows(h) {
    const { model } = h;
    const extras = makeFlowExtras(h, { expr: (...a) => expr(...a), variableInfo: (...a) => variableInfo(...a), entityOfVariable: (...a) => entityOfVariable(...a) });

    // an expression as stored; exprlint.js checks every stored expression after the plan (EXPRESSION CHECK)
    function expr(m, value) {
        return String(value);
    }

    const point = (el, x, y) => (el.relativeMiddlePoint = { x: Math.round(x), y: Math.round(y) });
    const size = (el, width, height) => (el.size = { width: Math.round(width), height: Math.round(height) });
    const short = o => o.id.slice(0, 8);
    const isFlowDoc = d => d instanceof mf.Microflow || d instanceof mf.Nanoflow || d instanceof mf.Rule;
    const errorDefault = f => (f.nano ? mf.ErrorHandlingType.Abort : mf.ErrorHandlingType.Rollback);
    const returnsValue = m => !!m.microflowReturnType && !(m.microflowReturnType instanceof datatypes.VoidType);

    // flow documents this plan opened, with their layout before the first change (LAYOUT CHECK, --preview)
    const layoutSeen = new Map();
    async function flowDoc(qn) {
        const d = await h.get(qn);
        if (!isFlowDoc(d)) throw new Error(`'${qn}' is not a microflow, nanoflow or rule`);
        if (!layoutSeen.has(d.id)) layoutSeen.set(d.id, { m: d, before: L.snapshot(d) });
        return d;
    }
    // { qn, before, after (snapshots; before null for a new flow), issues, fresh (issues the change added) } of every
    // flow document the plan created or changed
    function layoutReport() {
        const out = [];
        for (const { m, before } of layoutSeen.values()) {
            if (m.isDeleted) continue;
            const after = L.snapshot(m);
            if (before && JSON.stringify(before) === JSON.stringify(after)) continue;
            const issues = L.lint(after);
            const was = before ? L.lint(before) : [];
            out.push({ qn: m.qualifiedName, before, after, issues, was, fresh: L.newIssues(was, issues) });
        }
        return out.sort((a, b) => (a.qn < b.qn ? -1 : 1));
    }

    // ------------------------------------------------ flows (lines)

    // value: null (no case), "true"/"Enum value", [ "Enum value", ... ] (several values on one flow), or
    // { type: Module.Entity | System.X | "" } (object type decision)
    function addCase(fl, value) {
        if (Array.isArray(value)) {
            let many = true;
            try {
                many = !!fl.caseValues;
            } catch (e) {
                many = false; // before Mendix 10.15 a flow has one case value
            }
            if (value.length > 1 && !many) throw new Error("this Mendix version takes one value per flow of a decision; give each value its own case");
            for (const v of value) addCase(fl, v);
            return;
        }
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
        L.defaultLine(fl); // Studio Pro's Bezier vectors for these sides
        return fl;
    }

    // tail = an open end the next object connects to: { obj, originIndex, caseValue, errorHandler }
    const connect = (f, tail, to, destIndex = 3) =>
        flow(f.m, tail.obj, to, { originIndex: tail.originIndex || 1, destIndex: tail.errorHandler ? 0 : destIndex, caseValue: tail.caseValue === undefined ? null : tail.caseValue, errorHandler: !!tail.errorHandler });

    // The case of a flow, as addCase takes it
    function caseOf(fl) {
        const list = fl.caseValues ? [...fl.caseValues] : fl.caseValue ? [fl.caseValue] : [];
        if (list.length > 1 && list.every(c => c instanceof mf.EnumerationCase)) return list.map(c => c.value);
        const c = list[0];
        if (!c || c instanceof mf.NoCase) return null;
        if (c instanceof mf.EnumerationCase) return c.value;
        if (c instanceof mf.InheritanceCase) return { type: c.valueQualifiedName || "" };
        return c.structureTypeName.split("$")[1];
    }
    const caseLabel = fl => {
        const c = caseOf(fl);
        return Array.isArray(c) ? c.join(", ") : c && typeof c === "object" ? c.type || "empty" : c;
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
                const x = extraOf(a);
                if (x && x.vars) for (const v of x.vars(a)) out.set(v, o);
            } else if (o instanceof mf.LoopedActivity && o.loopSource instanceof mf.IterableList && o.loopSource.variableName) out.set(o.loopSource.variableName, o);
        });
        return out;
    }

    const load = async x => (x && !x.isLoaded && x.load ? x.load() : x);
    const ofType = t => ({ entity: (t && (t.entity ? t.entityQualifiedName : "entityQualifiedName" in t && t.entityQualifiedName)) || null, list: t instanceof datatypes.ListType }); // System entities: by name only

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
        if (n === "latestHttpResponse") return { entity: "System.HttpResponse", list: false }; // after a REST call
        const vars = variablesOf(m);
        const v = vars.get(n);
        if (!v) fail(`${where}: no variable '${name}' before this action in ${m.qualifiedName}`, n, [...vars.keys()]);
        if (v instanceof mf.MicroflowParameterObject) return ofType(v.variableType);
        if (v instanceof mf.LoopedActivity) return { entity: (await variableInfo(m, v.loopSource.listVariableName, where)).entity, list: false };
        const a = v.action;
        if (a instanceof mf.RetrieveAction) {
            const src = a.retrieveSource;
            if (src instanceof mf.DatabaseRetrieveSource) return { entity: src.entityQualifiedName, list: !(src.range instanceof mf.ConstantRange && src.range.singleObject) };
            const sys = SYSTEM_ASSOCIATIONS[src.associationQualifiedName];
            if (sys) return { entity: sys[1], list: sys[2] }; // System association, from its owner
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
        const x = extraOf(a);
        if (x && x.info) return x.info(a, { h, model, m });
        return { entity: null, list: false };
    }

    // A data type as ops write it: "String", "Module.Entity", "List(Module.Entity)", "Enum(Module.Enumeration)"; null
    // when unknown.
    function typeSpec(t) {
        if (!t) return null;
        if (t instanceof datatypes.ListType) return t.entityQualifiedName ? `List(${t.entityQualifiedName})` : null;
        if (t instanceof datatypes.ObjectType) return t.entityQualifiedName || null;
        if (t instanceof datatypes.EnumerationType) return t.enumerationQualifiedName ? `Enum(${t.enumerationQualifiedName})` : null;
        const n = t.structureTypeName.split("$")[1].replace(/Type$/, "");
        return ["String", "Integer", "Long", "Decimal", "Boolean", "DateTime", "Binary"].includes(n) ? n : null;
    }

    // The same for a code action (Java/JavaScript) type.
    function codeTypeSpec(t) {
        if (!t) return null;
        if (t instanceof codeactions.EnumerationType) return `Enum(${t.enumerationQualifiedName})`;
        const n = t.structureTypeName.split("$")[1].replace(/Type$/, "");
        return ["String", "Integer", "Decimal", "Boolean", "DateTime"].includes(n) ? n : null;
    }

    // The data type of a variable before this point, as typeSpec gives it; null when ops cannot tell.
    async function typeOfVariable(m, name, where) {
        const n = noDollar(name);
        const v = variablesOf(m).get(n);
        if (!v) return null;
        if (v instanceof mf.MicroflowParameterObject) return typeSpec(v.variableType);
        const a = v.action;
        if (a instanceof mf.CreateVariableAction) return typeSpec(a.variableType);
        if (a instanceof mf.AggregateListAction) {
            const fn = a.aggregateFunction.name;
            if (fn === "Count") return "Integer";
            if (fn === "All" || fn === "Any") return "Boolean";
            if (fn === "Average") return "Decimal";
            if (fn === "Reduce") return typeSpec(a.reduceReturnDataType);
            const attr = a.attribute;
            if (!attr) return null;
            const t = attr.type.structureTypeName.split("$")[1].replace("AttributeType", "");
            return t === "AutoNumber" ? "Long" : t;
        }
        if (a instanceof mf.ListOperationAction && (a.operation instanceof mf.Contains || a.operation instanceof mf.ListEquals)) return "Boolean";
        if (a instanceof mf.MicroflowCallAction || a instanceof mf.NanoflowCallAction) {
            const target = await load(a.microflowCall ? a.microflowCall.microflow : a.nanoflowCall.nanoflow);
            return target ? typeSpec(target.microflowReturnType) : null;
        }
        if (a instanceof mf.JavaActionCallAction || a instanceof mf.JavaScriptActionCallAction) {
            const target = await load(a.javaAction || a.javaScriptAction);
            const own = target && codeTypeSpec(target.actionReturnType);
            if (own) return own;
        }
        if (a instanceof mf.ExportXmlAction) return "String";
        if (a && a.resultHandling && a.resultHandling.variableType && !(a.resultHandling.variableType instanceof datatypes.ObjectType || a.resultHandling.variableType instanceof datatypes.ListType)) return typeSpec(a.resultHandling.variableType);
        const info = await variableInfo(m, n, where).catch(() => ({ entity: null }));
        if (!info.entity) return null;
        return info.list ? `List(${info.entity})` : info.entity;
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
    // N-8 callJava presets: a Java action of a Marketplace module, found by name, with its arguments filled in.
    const PRESETS = ["publishBusinessEvent"];
    async function javaPreset(f, spec, where) {
        if (spec.javaAction !== undefined) throw new Error(`${where}: give preset or javaAction, not both`);
        if (!PRESETS.includes(spec.preset)) fail(`${where}: preset '${spec.preset}' is not known`, String(spec.preset), PRESETS);
        if (spec.event === undefined) throw new Error(`${where}: preset publishBusinessEvent needs "event": the object variable of the business event (e.g. "OrderShipped")`);
        const actions = model.allJavaActions().filter(j => /^BusinessEvents\./.test(j.qualifiedName) && /^publish/i.test(j.name) && /event/i.test(j.name));
        if (!actions.length) throw new Error(`${where}: this project has no Business Events module (Marketplace) with a publish Java action. Studio Pro: Marketplace > Business Events (import it, or importModulePackage with its .mpk), add a published business event service (Add other > Business event service) for the event entity, then use this preset`);
        const target = actions.length > 1 ? actions.find(j => /^PublishBusinessEvent$/i.test(j.name)) || actions[0] : actions[0];
        const ja = target.isLoaded ? target : await target.load();
        const ent = await needVariable(f.m, spec.event, false, where);
        const base = await h.entity("BusinessEvents.PublishedBusinessEvent").catch(() => null);
        if (base && !(await isA(ent, base.qualifiedName))) throw new Error(`${where}: $${noDollar(spec.event)} is a ${ent}, which is no published business event (a specialization of ${base.qualifiedName}); create it from the event entity of your business event service`);
        const objParams = [...ja.actionParameters].filter(p => p.actionParameterType instanceof codeactions.BasicParameterType && p.actionParameterType.type instanceof codeactions.EntityType);
        if (!objParams.length) throw new Error(`${where}: ${ja.qualifiedName} has no object parameter for the event; call it with javaAction and args`);
        const args = { ...(spec.args || {}), [objParams[0].name]: `$${noDollar(spec.event)}` };
        if (h.client) h.client.warnFirst(`${where.split(" ")[0]}: callJava preset publishBusinessEvent calls ${ja.qualifiedName} (${objParams[0].name} = $${noDollar(spec.event)}); no Studio Pro sample of it in the test projects: check the call in Studio Pro`);
        const { preset, event, ...rest } = spec;
        return { ...rest, javaAction: ja.qualifiedName, args };
    }

    async function codeCall(f, act, spec, where, js) {
        const qn = js ? spec.jsAction : spec.javaAction;
        if (!qn) throw new Error(`${where}: ${js ? "callJavaScript needs jsAction" : "callJava needs javaAction (Module.JavaAction) or a preset (publishBusinessEvent)"}`);
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
            else if (t instanceof javaactions.MicroflowJavaActionParameterType && !js) {
                const pv = mf.MicroflowParameterValue[under](pm);
                if (p.name in args && v !== "" && v !== "empty") {
                    const target = await h.get(String(v).replace(/^'|'$/g, ""));
                    if (!(target instanceof mf.Microflow)) throw new Error(`${where}: parameter '${p.name}' of ${qn} takes a microflow name like "Module.Microflow"`);
                    pv.microflow = target;
                }
            } else throw new Error(`${where}: parameter '${p.name}' of ${qn} takes a ${t.structureTypeName.split("$")[1].replace(/(JavaScript|Java)?ActionParameterType$|ParameterType$/, "").toLowerCase() || "value"} argument, which ops cannot fill in; add this call in Studio Pro`);
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
        if (how === "file") {
            if (!variable) throw new Error(`${where}: response "file" needs 'variable' (the name for the new file document)`);
            const qn = spec.fileEntity || "System.FileDocument";
            const t = datatypes.ObjectType.create(model);
            if (qn === "System.FileDocument") t.__entity.updateWithRawValue(qn);
            else {
                if (!(await isA(qn, "System.FileDocument")) && !(await isA(qn, "System.Image"))) throw new Error(`${where}: fileEntity ${qn} does not inherit from System.FileDocument`);
                t.entity = await h.entity(qn);
            }
            r.variableType = t;
            return "FileDocument";
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
    const ONLY = { log: "micro", showHomePage: "micro", callJava: "micro", downloadFile: "micro", callRest: "micro", importWithMapping: "micro", exportWithMapping: "micro", metric: "micro", generateDocument: "micro", callJavaScript: "nano",
        ...Object.fromEntries(Object.entries(EXTRA_ACTIONS).filter(([, x]) => x.only).map(([n, x]) => [n, x.only])) };
    // What a rule may do: read and compute, no changes, pages or calls out.
    const RULE_ACTIONS = ["retrieve", "variable", "set", "aggregateList", "listOperation", "createList", "changeList"];
    const METRICS = { counter: "CounterMeterAction", increment: "IncrementCounterMeterAction", gauge: "GaugeMeterAction" };
    const AGGREGATE = { count: "Count", sum: "Sum", average: "Average", avg: "Average", minimum: "Minimum", min: "Minimum", maximum: "Maximum", max: "Maximum", all: "All", any: "Any", reduce: "Reduce" };
    const LIST_OPS = {
        union: "Union", intersect: "Intersect", subtract: "Subtract", contains: "Contains", equals: "ListEquals",
        head: "Head", tail: "Tail", find: "Find", filter: "Filter", sort: "Sort", range: "ListRange"
    };
    const CHANGE_LIST = { add: "Add", remove: "Remove", replace: "Set", set: "Set", clear: "Clear" };
    // Known to Mendix, but not written by ops: refused with the way out.
    // equals: the SDK writes Microflows$ListEquals, which mx check of Studio Pro 10.24 and 11.12 cannot load (unknown type)
    const NOT_STORED = { equals: "list operation 'equals' is not written: Studio Pro 10.24 / 11.12 cannot load the type this tool would store; compare with aggregateList count of 'subtract' both ways (0 and 0 = equal), or add the operation in Studio Pro" };

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

    // The result type of a reduce from its initial value, when the expression says it; null when it does not.
    async function literalType(m, value, where) {
        const v = String(value).trim();
        if (/^-?\d+$/.test(v)) return "Integer";
        if (/^-?\d+\.\d+$/.test(v)) return "Decimal";
        if (/^'([^']|'')*'$/.test(v)) return "String";
        if (/^(true|false)$/i.test(v)) return "Boolean";
        if (/^\[%(CurrentDateTime|BeginOf\w+|EndOf\w+)%\]$|^(dateTime|dateTimeUTC|parseDateTime)\(/.test(v)) return "DateTime";
        const e = /^([A-Z]\w*)\.(\w+)\.(\w+)$/.exec(v); // Module.Enumeration.Value
        if (e && model.findEnumerationByQualifiedName && model.findEnumerationByQualifiedName(`${e[1]}.${e[2]}`)) return `Enum(${e[1]}.${e[2]})`;
        const one = /^\$(\w+)$/.exec(v);
        if (one && variablesOf(m).has(one[1])) return typeOfVariable(m, one[1], where).catch(() => null);
        return null;
    }

    async function aggregate(f, a, spec, where) {
        const fn = AGGREGATE[String(spec.function).toLowerCase()];
        if (!fn) fail(`${where}: function '${spec.function}' is not one of count | sum | average | minimum | maximum | all | any | reduce`, spec.function, Object.keys(AGGREGATE));
        const ent = await needVariable(f.m, spec.list, true, where);
        if (fn !== "Reduce" && (spec.initial !== undefined || spec.type !== undefined)) throw new Error(`${where}: 'initial' and 'type' only apply to reduce`);
        a.inputListVariableName = noDollar(spec.list);
        a.aggregateFunction = mf.AggregateFunctionEnum[fn];
        a.attribute = null;
        a.useExpression = false;
        a.expression = "";
        if (fn === "Reduce") {
            if (spec.attribute !== undefined) throw new Error(`${where}: reduce takes 'expression' (on $currentResult and $currentObject), not 'attribute'`);
            if (spec.initial === undefined || spec.expression === undefined) throw new Error(`${where}: reduce needs 'initial' (start value) and 'expression', e.g. "initial": "0", "expression": "$currentResult + $currentObject/Amount"`);
            if (!/\$currentResult\b/.test(String(spec.expression))) throw new Error(`${where}: a reduce expression combines $currentResult (the value so far) with $currentObject, e.g. $currentResult + $currentObject/Amount`);
            const type = spec.type || (await literalType(f.m, spec.initial, where));
            if (!type) throw new Error(`${where}: cannot tell the result type of reduce from initial '${spec.initial}'; add "type": "Decimal" (String | Integer | Long | Decimal | Boolean | DateTime | Enum(Module.Enumeration))`);
            const dt = await h.dataType(type);
            if (dt instanceof datatypes.ObjectType || dt instanceof datatypes.ListType || dt instanceof datatypes.VoidType) throw new Error(`${where}: reduce returns a value (String, Integer, Decimal, ...), not ${type}`);
            a.useExpression = true;
            a.expression = expr(f.m, spec.expression, where, ent);
            a.reduceInitialValueExpression = expr(f.m, spec.initial, where);
            a.reduceReturnDataType = dt;
            return;
        }
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

    // An expression field of a REST call (header value, user, password, proxy host): weak models write plain text.
    function restExpr(f, v, where) {
        if (!/['$@(]|^\s*(-?\d+(\.\d+)?|empty|true|false)\s*$/.test(String(v))) throw new Error(`${where} is an expression: write '${v}' in single quotes (or a constant @Module.Name, or a $variable)`);
        return expr(f.m, v, where);
    }

    function restAuth(f, http, v, where) {
        if (v === false || v === null || v === "none") {
            http.useAuthentication = false;
            http.httpAuthenticationUserName = "";
            http.authenticationPassword = "";
            return;
        }
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: auth must be { "user": "expression", "password": "expression" }`);
        validate("-", "auth", { fields: { user: "R expression", password: "R expression" } }, v, `${where} auth`);
        http.useAuthentication = true;
        http.httpAuthenticationUserName = restExpr(f, v.user, `${where} auth user`);
        http.authenticationPassword = restExpr(f, v.password, `${where} auth password`);
    }

    function restProxy(f, a, v, where) {
        const old = a.proxyConfiguration;
        if (v === undefined || v === "default") {
            a.requestProxyType = mf.RequestProxyType.DefaultProxy;
            if (old) old.delete();
            return;
        }
        if (v === "none" || v === false) {
            a.requestProxyType = mf.RequestProxyType.NoProxy;
            if (old) old.delete();
            return;
        }
        if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${where}: proxy must be "default", "none" or { "host": ..., "port": ..., "user": ..., "password": ... }`, v, ["default", "none"]);
        validate("-", "proxy", { fields: { host: "R expression", port: "R expression", user: "optional expression", password: "optional expression" } }, v, `${where} proxy`);
        a.requestProxyType = mf.RequestProxyType.Override;
        const p = old || mf.ProxyConfiguration.createInRestCallActionUnderProxyConfiguration(a);
        p.hostExpression = restExpr(f, v.host, `${where} proxy host`);
        p.portExpression = restExpr(f, v.port, `${where} proxy port`);
        p.usernameExpression = v.user === undefined ? "" : restExpr(f, v.user, `${where} proxy user`);
        p.passwordExpression = v.password === undefined ? "" : restExpr(f, v.password, `${where} proxy password`);
        p.useConfigurationExpression = "true";
    }

    // The body of a REST call: text template, form data, a file document (binary) or an export mapping.
    async function restBody(f, a, spec, where) {
        const kinds = ["body", "exportMapping", "formData", "binaryBody"].filter(k => spec[k] !== undefined);
        if (kinds.length > 1) throw new Error(`${where}: give one body: ${kinds.join(" or ")}`);
        if (spec.bodyArgs !== undefined && spec.body === undefined) throw new Error(`${where}: bodyArgs fill {1} {2} in 'body'; add body`);
        if (spec.exportMapping) {
            const map = await h.get(spec.exportMapping);
            if (!(map instanceof exportmappings.ExportMapping)) throw new Error(`${where}: '${spec.exportMapping}' is not an export mapping`);
            await variableInfo(f.m, spec.exportObject, where);
            const rq = mf.MappingRequestHandling.createInRestCallActionUnderRequestHandling(a);
            rq.mapping = map;
            rq.mappingArgumentVariableName = noDollar(spec.exportObject);
            rq.contentType = contentType(map);
            a.requestHandlingType = mf.RequestHandlingType.Mapping;
        } else if (spec.formData !== undefined) {
            if (!spec.formData || typeof spec.formData !== "object" || Array.isArray(spec.formData) || !Object.keys(spec.formData).length) throw new Error(`${where}: formData must be { "key": "expression", ... }`);
            const rq = mf.FormDataRequestHandling.createInRestCallActionUnderRequestHandling(a);
            for (const [k, v] of Object.entries(spec.formData)) {
                const part = mf.FormDataPart.createIn(rq);
                part.key = k;
                part.value = restExpr(f, v, `${where} formData ${k}`);
            }
            a.requestHandlingType = mf.RequestHandlingType.FormData;
        } else if (spec.binaryBody !== undefined) {
            const m = /^\s*\$(\w+)\s*$/.exec(String(spec.binaryBody));
            if (m) {
                const ent = await needVariable(f.m, m[1], false, where);
                if (!(await isA(ent, "System.FileDocument")) && !(await isA(ent, "System.Image"))) throw new Error(`${where}: binaryBody $${m[1]} is ${ent}, not a file document (an entity that inherits from System.FileDocument)`);
            }
            const rq = mf.BinaryRequestHandling.createInRestCallActionUnderRequestHandling(a);
            rq.expression = expr(f.m, spec.binaryBody, `${where} binaryBody`);
            a.requestHandlingType = mf.RequestHandlingType.Binary;
        } else {
            const rq = mf.CustomRequestHandling.createInRestCallActionUnderRequestHandling(a);
            fillTemplate(f, rq.template || mf.StringTemplate.createInCustomRequestHandlingUnderTemplate(rq), spec.body || "", spec.bodyArgs, `${where} body`, true);
            a.requestHandlingType = mf.RequestHandlingType.Custom;
        }
    }

    async function restCall(f, act, spec, where) {
        if (!spec.exportMapping !== !spec.exportObject) throw new Error(`${where}: 'exportMapping' and 'exportObject' go together`);
        if (spec.headers !== undefined && (typeof spec.headers !== "object" || Array.isArray(spec.headers) || !spec.headers)) throw new Error(`${where}: headers must be { "Name": "expression" }`);
        // weak models mix up the text template (url, body) and expressions (args, header values)
        if (/^\s*['@$]/.test(spec.url)) throw new Error(`${where}: url is text, not an expression: write https://... and put expressions in urlArgs, e.g. "url": "{1}/orders/{2}", "urlArgs": ["@Module.BaseUrl", "$Order/Id"]`);
        const a = mf.RestCallAction.createIn(act);
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
            e.value = restExpr(f, v, `${where}: header ${k}`);
        }
        if (spec.auth !== undefined) restAuth(f, http, spec.auth, where);
        a.useRequestTimeOut = true;
        a.timeOutExpression = expr(f.m, spec.timeout === undefined ? "300" : spec.timeout, `${where} timeout`);
        a.errorResultHandlingType = bool(spec.errorBody, true) ? mf.ErrorResultHandlingType.HttpResponse : mf.ErrorResultHandlingType.None;
        restProxy(f, a, spec.proxy, where);
        await restBody(f, a, spec, where);
        const response = spec.response === undefined ? (spec.variable ? "string" : "none") : String(spec.response);
        const how = /^none$/i.test(response) ? "none" : /^string$/i.test(response) ? "string" : /^file$/i.test(response) ? "file" : "mapping";
        if (how === "mapping" && !response.includes(".")) fail(`${where}: response '${response}' is not none, string, file or an import mapping (Module.Mapping)`, response, ["none", "string", "file"]);
        if (spec.fileEntity !== undefined && how !== "file") throw new Error(`${where}: fileEntity only applies to response "file"`);
        const r = a.resultHandling || mf.ResultHandling.createInRestCallActionUnderResultHandling(a);
        a.resultHandlingType = mf.ResultHandlingType[await resultHandling(f, r, how, { ...spec, mapping: response }, where)];
        return a;
    }

    async function activity(f, spec, x, y, where) {
        const kind = spec.action;
        validate("action", kind, { fields: { ...ACTIONS[kind].fields, ...COMMON } }, spec, where);
        if (ONLY[kind] === "micro" && f.nano) throw new Error(`${where}: '${kind}' is not available in nanoflows${kind === "callJava" ? "; call a microflow that calls the Java action" : ""}`);
        if (ONLY[kind] === "nano" && !f.nano) throw new Error(`${where}: '${kind}' only works in nanoflows${kind === "callJavaScript" ? " (JavaScript runs in the browser); in a microflow use callJava" : " (it acts on the device); call a nanoflow"}`);
        if (f.rule && !RULE_ACTIONS.includes(kind)) throw new Error(`${where}: '${kind}' is not allowed in a rule (a rule only reads and computes: ${RULE_ACTIONS.join(", ")}, if, switch, loop, end)`);
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
                    if (SYSTEM_ASSOCIATIONS[spec.association]) src.__association.updateWithRawValue(spec.association); // not in the project
                    else src.association = await h.get(spec.association);
                } else {
                    if (!spec.entity) throw new Error(`${where}: retrieve needs 'entity' (database) or 'from' + 'association'`);
                    const src = mf.DatabaseRetrieveSource.createIn(a);
                    src.entity = await h.entity(spec.entity);
                    src.xPathConstraint = spec.xpath || "";
                    const range = mf.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
                    range.singleObject = bool(spec.first, false);
                }
                await extras.retrieveExtras(f, a, spec, where);
                break;
            }
            case "create":
                a = mf.CreateObjectAction.createIn(act);
                a.entity = await h.entity(spec.entity);
                a.outputVariableName = noDollar(spec.variable);
                a.commit = bool(spec.commit, false) ? mf.CommitEnum.Yes : mf.CommitEnum.No;
                await memberChanges(f, a, spec.entity, spec.set, where);
                await extras.addRemove(f, a, spec.entity, spec, where);
                break;
            case "change":
                a = mf.ChangeObjectAction.createIn(act);
                a.changeVariableName = noDollar(spec.variable);
                a.commit = bool(spec.commit, false) ? mf.CommitEnum.Yes : mf.CommitEnum.No;
                a.refreshInClient = bool(spec.refresh, false);
                if (spec.set === undefined && spec.add === undefined && spec.remove === undefined) throw new Error(`${where}: change needs "set", "add" or "remove"`);
                await memberChanges(f, a, await entityOfVariable(f.m, spec.variable, where), spec.set, where);
                await extras.addRemove(f, a, await entityOfVariable(f.m, spec.variable, where), spec, where);
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
                if (spec.stackTrace !== undefined) a.includeLatestStackTrace = bool(spec.stackTrace, false);
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
                a = await codeCall(f, act, kind === "callJava" && spec.preset !== undefined ? await javaPreset(f, spec, where) : spec, where, kind === "callJavaScript");
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
            case "callRest":
                a = await restCall(f, act, spec, where);
                break;
            case "metric":
                a = metricAction(f, act, spec, where);
                break;
            case "generateDocument":
                a = await generateDocument(f, act, spec, where);
                break;
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
            default: {
                const c = { f, h, model, expr: (v, w) => expr(f.m, v, w), variableInfo: (n, w) => variableInfo(f.m, n, w), needVariable: (n, l, w) => needVariable(f.m, n, l, w), fillTemplate: (t, text, args, w) => fillTemplate(f, t, text, args, w) };
                a = await EXTRA_ACTIONS[kind].build(c, act, spec, where);
            }
        }
        a.errorHandlingType = errorDefault(f);
        if (spec.caption) {
            act.caption = String(spec.caption);
            act.autoGenerateCaption = false;
        }
        if (spec.note !== undefined) annotate(f.m, f.coll, String(spec.note), act);
        return act;
    }

    // An annotation (a note on the canvas), attached to obj with an annotation flow when obj is given; placed above it.
    function annotate(m, coll, text, obj, at = null) {
        if (!text.trim()) throw new Error("an annotation needs text");
        const note = mf.Annotation.createIn(coll);
        const lines = text.split(/\r?\n/);
        const width = Math.min(400, Math.max(150, 7 * Math.max(...lines.map(l => l.length)) + 20));
        size(note, width, Math.max(50, 20 * lines.length + 10));
        const p = at || (obj ? { x: obj.relativeMiddlePoint.x, y: obj.relativeMiddlePoint.y - 120 } : { x: 100, y: 50 });
        point(note, p.x, p.y);
        note.caption = text.replace(/\r?\n/g, "\r\n");
        if (obj) {
            const fl = mf.AnnotationFlow.createIn(m);
            fl.origin = note;
            fl.destination = obj;
            fl.originConnectionIndex = 2;
            fl.destinationConnectionIndex = 0;
            L.defaultLine(fl);
        }
        return note;
    }

    function metricAction(f, act, spec, where) {
        const t = METRICS[String(spec.type).toLowerCase()];
        if (!t) fail(`${where}: metric type '${spec.type}' is not one of counter | increment | gauge`, spec.type, Object.keys(METRICS));
        if (!mf[t]) throw new Error(`${where}: metrics are not in this Mendix version`);
        if (t === "IncrementCounterMeterAction" && spec.value !== undefined) throw new Error(`${where}: increment adds 1 and takes no 'value'; use type counter to add a value`);
        if (t === "GaugeMeterAction" && spec.value === undefined) throw new Error(`${where}: a gauge needs 'value' (the number to record)`);
        if (!/^[A-Za-z][\w.\-]*$/.test(String(spec.name))) throw new Error(`${where}: metric name '${spec.name}' must be plain text like orders.created (letters, digits, . _ -), not an expression`);
        if (spec.tags !== undefined && (!spec.tags || typeof spec.tags !== "object" || Array.isArray(spec.tags))) throw new Error(`${where}: tags must be { "tag": "expression" }`);
        const a = mf[t].createIn(act);
        a.name = String(spec.name);
        a.description = spec.description === undefined ? "" : String(spec.description);
        if (t !== "IncrementCounterMeterAction") a.value = expr(f.m, spec.value === undefined ? "1" : spec.value, `${where} value`);
        for (const [k, v] of Object.entries(spec.tags || {})) {
            const tag = mf.MeterTagMapping.createIn(a);
            tag.key = k;
            tag.value = expr(f.m, v, `${where} tag ${k}`);
        }
        return a;
    }

    // Only where Studio Pro already wrote one in this project: document templates are deprecated and no test project
    // has a sample, so the stored layout cannot be checked otherwise.
    async function generateDocument(f, act, spec, where) {
        const cat = h.client && h.client.catalog;
        const own = cat && cat.types.has("Microflows$GenerateDocumentAction") && !(cat.reference && cat.reference.has("Microflows$GenerateDocumentAction"));
        if (!own) throw new Error(`${where}: generateDocument is only written in projects that already use a 'Generate document' action (document templates are deprecated; no sample here). Add it in Studio Pro`);
        const tpl = await h.get(spec.template);
        if (!(tpl instanceof sdk.documenttemplates.DocumentTemplate)) throw new Error(`${where}: '${spec.template}' is not a document template`);
        const ent = await needVariable(f.m, spec.variable, false, where);
        if (!(await isA(ent, "System.FileDocument")) && !(await isA(ent, "System.Image"))) throw new Error(`${where}: $${noDollar(spec.variable)} is ${ent}, not a file document`);
        const a = mf.GenerateDocumentAction.createIn(act);
        a.documentTemplate = tpl;
        a.fileVariableName = noDollar(spec.variable);
        a.documentType = enumValue(mf.TargetDocumentType, spec.type || "PDF", "document type");
        a.languageSetting = mf.LanguageSettingType.CurrentUser;
        // the template's top-level data widgets are its parameters (by widget name)
        const params = [...tpl.toplevels].filter(w => w.name && /\$(DataView|DataGrid|TemplateGrid)$/.test(w.structureTypeName));
        for (const [name, value] of Object.entries(spec.args || {})) {
            const p = params.find(x => x.name === name);
            if (!p) fail(`${where}: ${spec.template} has no parameter '${name}'`, name, params.map(x => x.name));
            const pm = mf.DocumentTemplateParameterMapping.createIn(a);
            pm.widgetName = name;
            pm.argument = expr(f.m, value, where);
        }
        const missing = params.filter(p => !(p.name in (spec.args || {})));
        if (missing.length) throw new Error(`${where}: ${spec.template} needs args for: ${missing.map(p => p.name).join(", ")}`);
        return a;
    }

    // ------------------------------------------------ structured sequences

    // The condition of a decision: an expression (field 'condition' or 'value'), or a rule call ('rule' + 'args').
    // enumerated: the decision branches on an enumeration (switch); Boolean otherwise. Returns { label, enumeration }.
    async function decision(f, split, spec, field, where, enumerated) {
        if ((spec[field] === undefined) === (spec.rule === undefined)) throw new Error(`${where}: give '${field}' (an expression) or 'rule' (Module.Rule), one of them`);
        if (spec.args !== undefined && spec.rule === undefined) throw new Error(`${where}: 'args' go with 'rule'`);
        if (spec.rule === undefined) {
            const cond = mf.ExpressionSplitCondition.createIn(split);
            cond.expression = expr(f.m, spec[field], where);
            return { label: String(spec[field]), enumeration: enumerated ? spec.enumeration || (await enumOfExpression(f.m, spec[field], where)) : null };
        }
        const rule = await h.get(spec.rule);
        if (!(rule instanceof mf.Rule)) throw new Error(`${where}: '${spec.rule}' is not a rule` + (isFlowDoc(rule) ? " (a microflow: call it first and decide on its result)" : ""));
        const rt = rule.microflowReturnType;
        const isEnum = rt instanceof datatypes.EnumerationType;
        if (enumerated && !isEnum) throw new Error(`${where}: rule ${spec.rule} returns ${rt ? rt.structureTypeName.split("$")[1].replace("Type", "") : "nothing"}; a switch needs a rule that returns an enumeration (use if for a Boolean rule)`);
        if (!enumerated && !(rt instanceof datatypes.BooleanType)) throw new Error(`${where}: rule ${spec.rule} returns ${isEnum ? "an enumeration: use switch with rule" : "no Boolean"}`);
        const args = spec.args || {};
        if (typeof args !== "object" || Array.isArray(args)) throw new Error(`${where}: args must be { "Param": "expression" }`);
        const params = rule.objectCollection.objects.filter(o => o instanceof mf.MicroflowParameterObject);
        for (const name of Object.keys(args)) if (!params.some(p => p.name === name)) fail(`${where}: rule ${spec.rule} has no parameter '${name}'`, name, params.map(p => p.name));
        const missing = params.filter(p => !(p.name in args));
        if (missing.length) throw new Error(`${where}: rule ${spec.rule} needs args for: ${missing.map(p => p.name).join(", ")}`);
        const cond = mf.RuleSplitCondition.createIn(split);
        const call = mf.RuleCall.createIn(cond);
        call.rule = rule;
        for (const p of params) {
            const pm = mf.RuleCallParameterMapping.createIn(call);
            pm.__parameter.updateWithRawValue(`${rule.qualifiedName}.${p.name}`); // Studio Pro stores the rule parameter by name
            pm.argument = expr(f.m, args[p.name], where);
        }
        return { label: rule.name, enumeration: isEnum ? rt.enumerationQualifiedName : null };
    }

    // The enumeration an expression gives: $Var (parameter or variable of an enumeration type) or $Var/Attribute.
    async function enumOfExpression(m, value, where) {
        const v = String(value).trim();
        const hit = /^\$(\w+)(?:\/(\w+))?$/.exec(v);
        const why = `cannot tell the enumeration of '${v}'; add "enumeration": "Module.Enumeration"`;
        if (!hit) throw new Error(`${where}: ${why}`);
        if (!hit[2]) {
            const t = await typeOfVariable(m, hit[1], where);
            const e = /^Enum\((.+)\)$/.exec(t || "");
            if (!e) throw new Error(`${where}: $${hit[1]} is ${t || "not an enumeration"}; a switch needs an enumeration value`);
            return e[1];
        }
        const ent = await entityOfVariable(m, hit[1], where);
        const { attribute } = await memberOf(ent, hit[2], where);
        if (!attribute || !(attribute.type instanceof dm.EnumerationAttributeType)) throw new Error(`${where}: ${ent}.${hit[2]} is no enumeration attribute; a switch needs an enumeration value (use if for other values)`);
        return attribute.type.enumerationQualifiedName;
    }

    // Enumeration decision: one flow per case (several values on one flow), the rest, and empty; joined by a merge.
    async function enumSwitch(f, spec, x, y, w) {
        const split = mf.ExclusiveSplit.createIn(f.coll);
        point(split, x, y);
        size(split, 130, 80);
        split.errorHandlingType = errorDefault(f);
        const { label, enumeration } = await decision(f, split, spec, "value", w, true);
        split.caption = String(spec.caption || label);
        const en = await h.get(enumeration);
        if (!(en instanceof sdk.enumerations.Enumeration)) throw new Error(`${w}: '${enumeration}' is not an enumeration`);
        const values = en.values.map(v => v.name);
        const cases = spec.cases && typeof spec.cases === "object" && !Array.isArray(spec.cases) ? Object.entries(spec.cases) : [];
        if (!cases.length) throw new Error(`${w}: switch needs cases: { "${values[0] || "Value"}": [ actions ] }`);
        const used = new Set();
        const branches = [];
        for (const [key, acts] of cases) {
            const names = key.split(",").map(x => x.trim()).filter(Boolean).map(x => x.replace(/^.*\./, "")); // Module.Enum.Value works too
            for (const n of names) {
                if (/^\(?empty\)?$/i.test(n)) throw new Error(`${w}: put the empty case in "empty": [ ... ], not in cases`);
                if (!values.includes(n)) fail(`${w}: ${enumeration} has no value '${n}'`, n, values);
                if (used.has(n)) throw new Error(`${w}: value ${n} is in two cases`);
                used.add(n);
            }
            if (!Array.isArray(acts)) throw new Error(`${w}: case ${key} must be a list of actions [ ... ]`);
            branches.push({ values: names, acts, label: key });
        }
        const rest = values.filter(v => !used.has(v));
        if (spec.other !== undefined && !rest.length) throw new Error(`${w}: every value of ${enumeration} has a case; remove 'other'`);
        if (rest.length) branches.push({ values: rest, acts: spec.other || [], label: "other" });
        branches.push({ values: ["(empty)"], acts: spec.empty || [], label: "empty" }); // Studio Pro's value for no value
        let cursor = x + X_STEP;
        let laneY = y;
        let width = 0;
        const open = [];
        for (const [bi, b] of branches.entries()) {
            const seg = await buildSeq(f, b.acts, cursor, laneY, { obj: split, originIndex: bi ? 2 : 1, caseValue: b.values.length > 1 ? b.values : b.values[0] }, `${w} ${b.label}`);
            if (seg.tail) open.push(seg.tail);
            width = Math.max(width, seg.width);
            laneY += LANE * Math.max(1, seg.height);
        }
        cursor += width;
        let tail = null;
        if (open.length > 1) {
            const merge = mf.ExclusiveMerge.createIn(f.coll);
            point(merge, cursor, y);
            size(merge, 60, 60);
            open.forEach((t, k) => connect(f, t, merge, k ? 2 : 3));
            tail = { obj: merge, originIndex: 1 };
            cursor += X_STEP;
        } else if (open.length === 1) tail = open[0];
        return { split, tail, cursor, height: (laneY - y) / LANE };
    }

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
            if (REFUSED[kind]) throw new Error(`${w}: ${REFUSED[kind]}`);
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
                case "switch": {
                    const sw = await enumSwitch(f, spec, cursor, y, w);
                    link(sw.split);
                    cursor = sw.cursor;
                    height = Math.max(height, sw.height);
                    tail = sw.tail;
                    if (!tail) ended = true;
                    break;
                }
                case "if": {
                    const split = mf.ExclusiveSplit.createIn(f.coll);
                    point(split, cursor, y);
                    size(split, 130, 80);
                    split.errorHandlingType = errorDefault(f);
                    const { label } = await decision(f, split, spec, "condition", w, false);
                    split.caption = String(spec.caption || label);
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
                    const loopLanes = Math.ceil(loopHeight / LANE);
                    if (spec.onError !== undefined) height = Math.max(height, loopLanes + (await errorHandler(f, loop, spec.onError, cursor - 60 + width / 2, y + LANE * loopLanes, `${w} loop`)));
                    cursor += width + 70;
                    height = Math.max(height, loopLanes);
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
                    if (!f.inHandler) throw new Error(`${w}: 'error' is only allowed inside an onError handler (an error event re-raises the error the handler caught; to stop a flow on purpose, show a message and use 'end')`);
                    if (spec.message !== undefined) {
                        // H9: an error event has no text of its own: log the custom text first, then end with the error
                        const logs = await errorLog(f, spec, w);
                        const seg = await buildSeq(f, logs, cursor, y, tail, w);
                        if (!first) first = seg.first;
                        tail = seg.tail;
                        cursor += seg.width;
                    } else if (spec.args !== undefined || spec.node !== undefined || spec.jsLog !== undefined) throw new Error(`${w}: args, node and jsLog go with 'message' (the text to log before the error)`);
                    const ev = mf.ErrorEvent.createIn(f.coll);
                    point(ev, cursor, y);
                    size(ev, 20, 20);
                    link(ev);
                    tail = null;
                    ended = true;
                    break;
                }
                default: {
                    if (isRetry(spec.onError)) {
                        // the retry recipe: a counter and a while loop around the action (flow-errors.js)
                        const r = await FE.normalize(spec.onError, errorCtx(f, null, w), w);
                        const specs2 = FE.retrySpecs(spec, r, uniqueVar(f.m, "RetryCount"), w, CREATES[kind] && spec[CREATES[kind]] ? noDollar(spec[CREATES[kind]]) : null);
                        const seg = await buildSeq(f, specs2, cursor, y, tail, w);
                        if (!first) first = seg.first;
                        tail = seg.tail;
                        cursor += seg.width;
                        height = Math.max(height, seg.height);
                        break;
                    }
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

    const isRetry = v => String(typeof v === "string" ? v : v && typeof v === "object" ? v.pattern : "").toLowerCase() === "retry";

    // A variable name no step of m uses yet: base, base2, base3, ...
    function uniqueVar(m, base) {
        const used = variablesOf(m);
        for (let i = 1; ; i++) if (!used.has(i === 1 ? base : `${base}${i}`)) return i === 1 ? base : `${base}${i}`;
    }

    // A JavaScript action to log with in a nanoflow: { qn, param } (its first String parameter; no other required one)
    async function jsLogOf(qn, where) {
        const target = await h.get(qn);
        if (!(target instanceof javascriptactions.JavaScriptAction)) throw new Error(`${where}: jsLog '${qn}' is not a JavaScript action`);
        const params = [...target.actionParameters];
        const p = params.find(x => x.actionParameterType instanceof codeactions.BasicParameterType && x.actionParameterType.type instanceof datatypes.StringType);
        if (!p) throw new Error(`${where}: jsLog ${qn} has no String parameter to pass the text in`);
        const other = params.filter(x => x !== p && required(x));
        if (other.length) throw new Error(`${where}: jsLog ${qn} needs more parameters (${other.map(x => x.name).join(", ")}); use a JavaScript action with one String parameter`);
        return { qn, param: p.name };
    }
    let defaultJs; // undefined: not looked for yet
    async function defaultJsLog() {
        if (defaultJs !== undefined) return defaultJs;
        defaultJs = null;
        for (const j of model.allJavaScriptActions().filter(x => /^(js_?)?(log|logmessage|logerror|writelog|consolelog|log_?message)$/i.test(x.name))) {
            try {
                defaultJs = await jsLogOf(j.qualifiedName, "jsLog");
                break;
            } catch (e) {
                /* not usable: look further */
            }
        }
        return defaultJs;
    }
    const ATTR_TYPE = t => t.structureTypeName.split("$")[1].replace(/AttributeType$/, "");
    async function entityInfo(qn, where) {
        const e = await h.entity(qn);
        if (!e) throw new Error(`${where}: no entity ${qn}`);
        return [...e.attributes].map(a => [a.name, ATTR_TYPE(a.type)]);
    }
    // What flow-errors.normalize needs to know about the place of a handler (owner: the activity or loop; null: retry)
    function errorCtx(f, owner, where) {
        const caption = !owner ? "step" : owner instanceof mf.ActionActivity && !owner.autoGenerateCaption && owner.caption ? owner.caption : describe(owner).replace(/[{}]/g, "").slice(0, 60);
        return { nano: f.nano, inLoop: f.inLoop, qn: f.m.qualifiedName, caption, returns: f.returns, sync: !!(owner && owner.action instanceof mf.SynchronizeAction),
            jsLog: (qn, w) => jsLogOf(qn, w || where), defaultJsLog, entityInfo, unique: base => uniqueVar(f.m, base), varBase: "Error" };
    }
    // The steps that log the text of an 'error' with 'message' (microflow: log action; nanoflow: JavaScript log action)
    async function errorLog(f, spec, where) {
        if (!f.nano) return [{ action: "log", level: "Error", message: String(spec.message), ...(spec.args !== undefined ? { args: spec.args } : {}), ...(spec.node !== undefined ? { node: spec.node } : {}), stackTrace: true }];
        if (spec.node !== undefined) throw new Error(`${where}: 'node' is for microflows; a nanoflow logs with a JavaScript action (jsLog)`);
        const js = spec.jsLog !== undefined ? await jsLogOf(spec.jsLog, where) : await defaultJsLog();
        if (!js) throw new Error(`${where}: a nanoflow has no log action and this project has no JavaScript log action; give "jsLog": "Module.JS_Log" (a JavaScript action with a String parameter), or put { "action": "message", "type": "Error", "text": "..." } before { "action": "error" }`);
        if (spec.args !== undefined) throw new Error(`${where}: in a nanoflow 'args' is not supported: write the whole text in 'message' (the error text is added after it)`);
        return [{ action: "callJavaScript", jsAction: js.qn, args: { [js.param]: `'${String(spec.message).replace(/'/g, "''")}: ' + $latestError` } }];
    }

    // owner: an ActionActivity or a LoopedActivity. Returns the lanes it used.
    async function errorHandler(f, owner, onError, x, y, where) {
        const loop = owner instanceof mf.LoopedActivity;
        const target = loop ? owner : owner.action;
        if (f.rule) throw new Error(`${where}: a rule has no error handling (it only reads and computes); remove onError`);
        const on = await FE.normalize(onError, errorCtx(f, owner, where), where);
        if (on.kind === "retry") throw new Error(`${where}: onError retry wraps one action in a loop; ${loop ? "a loop cannot be retried: put the retry on the action inside it" : "add the action again with it (deleteAction, then addActions)"}`);
        if (on.kind === "default") {
            target.errorHandlingType = errorDefault(f);
            return 0;
        }
        if (on.kind === "continue") {
            if (loop) throw new Error(`${where}: a loop takes "rollback"/"abort" (default) or a custom handler { "actions": [ ... ] }, not "continue"; put "continue" on the actions inside the loop`);
            target.errorHandlingType = mf.ErrorHandlingType.Continue;
            return 0;
        }
        if (loop) h.client && h.client.warnFirst(`Microflows$LoopedActivity custom error handler first use (no Studio Pro sample of an error flow from a loop): check ${f.m.qualifiedName} in Studio Pro`);
        target.errorHandlingType = on.rollback ? mf.ErrorHandlingType.Custom : mf.ErrorHandlingType.CustomWithoutRollBack;
        const hf = { ...f, inHandler: true };
        const seg = await buildSeq(hf, on.actions, x, y, { obj: owner, originIndex: 2, errorHandler: true }, `${where} onError`);
        if (seg.tail) {
            if (f.inLoop) throw new Error(`${where}: an error handler inside a loop must end with 'break', 'continue' or 'error'`);
            const end = mf.EndEvent.createIn(f.coll);
            point(end, x + Math.max(seg.width, X_STEP / 2), y);
            size(end, 20, 20);
            if (f.returns) {
                if (on.returnValue === undefined) throw new Error(`${where}: this flow returns a value; onError needs 'returnValue'${on.pattern ? ` ({ "pattern": "${on.pattern}", "returnValue": "..." })` : ""}`);
                end.returnValue = expr(f.m, on.returnValue, where);
            } else if (on.returnValue !== undefined) throw new Error(`${where}: this flow returns nothing; remove onError.returnValue`);
            connect(hf, seg.tail, end);
        } else if (on.returnValue !== undefined) throw new Error(`${where}: the handler ends with ${on.actions.length ? "error/break/continue" : "nothing"}; returnValue is only for a handler that ends the flow`);
        return seg.height;
    }

    // ------------------------------------------------ create / insert

    // rule: a rule document (returns a Boolean or an enumeration; only reads and computes)
    async function createFlow(o, nano, container, rule = false) {
        const qn = `${o.module}.${o.name}`;
        const m = (rule ? mf.Rule : nano ? mf.Nanoflow : mf.Microflow).createIn(container);
        m.name = o.name;
        layoutSeen.set(m.id, { m, before: null });
        const f = { m, coll: m.objectCollection, nano, rule, inLoop: false, inHandler: false, returns: false };
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
        if (rule && !(m.microflowReturnType instanceof datatypes.BooleanType || m.microflowReturnType instanceof datatypes.EnumerationType)) throw new Error(`${qn}: a rule returns Boolean or Enum(Module.Enumeration), not ${o.returns || "nothing"}`);
        if (o.documentation !== undefined) m.documentation = String(o.documentation);
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

    function flowsOf(m) {
        return [...m.flows].filter(x => x instanceof mf.SequenceFlow);
    }

    // The flow new steps go on: after "start", the step that creates a variable, or a step id (branch: which outgoing
    // flow of a decision, e.g. "true" or an enumeration value); without 'after' the one flow into the single end event.
    function anchorOf(m, after, branch, where) {
        const sequence = flowsOf(m).filter(x => !x.isErrorHandler);
        if (!after) {
            if (branch !== undefined) throw new Error(`${where}: 'branch' goes with 'after' (the id of a decision)`);
            const ends = [];
            walkObjects(m.objectCollection, x => x instanceof mf.EndEvent && ends.push(x));
            if (ends.length !== 1) throw new Error(`${where}: ${m.qualifiedName} has ${ends.length} end events; say where with "after": "start", a variable name, or a step id (see: steps ${m.qualifiedName})`);
            const into = sequence.filter(x => x.destination === ends[0]);
            if (into.length !== 1) throw new Error(`${where}: ${into.length} flows reach the end event; use "after"`);
            return into[0];
        }
        const anchor = after === "start" ? m.objectCollection.objects.find(x => x instanceof mf.StartEvent) : variablesOf(m).get(noDollar(after)) || findStep(m, after, true);
        if (!anchor || anchor instanceof mf.MicroflowParameterObject) fail(`${where}: no step creates variable '${after}' and no step has that id`, noDollar(after), ["start", ...variablesOf(m).keys()]);
        const out = sequence.filter(x => x.origin === anchor);
        if (branch !== undefined) {
            const labels = out.map(caseLabel).map(String);
            const hit = out.filter(x => String(caseLabel(x)).split(", ").some(l => l.toLowerCase() === String(branch).toLowerCase() || (String(branch).toLowerCase() === "empty" && /^\(empty\)$|^empty$/.test(l))));
            if (hit.length !== 1) fail(`${where}: '${after}' has no outgoing flow '${branch}' (it has: ${labels.join(" | ") || "none"})`, String(branch), labels);
            return hit[0];
        }
        if (out.length !== 1) throw new Error(`${where}: '${after}' has ${out.length} outgoing flows; ${out.length > 1 ? `say which with "branch": ${out.map(x => JSON.stringify(String(caseLabel(x)))).join(" | ")}` : "pick another point"} (see: steps ${m.qualifiedName})`);
        return out[0];
    }

    // The new steps go on the anchor flow; only what follows them moves (flow-layout.js): the anchor flow keeps its id,
    // case and origin side and runs into the first new step; the last new step takes over its destination side.
    async function insertSteps(m, anchor, build, where) {
        const lay = L.begin(m);
        const geo = lay.prepare(lay.insertGeometry(anchor));
        const { from, to, coll } = geo;
        // inside a custom error handler (also a loop in one): 'error' is allowed there
        const sc = FE.sdkScopes(m);
        const inHandler = anchor.isErrorHandler || sc.handlerOf.has(from.id);
        const f = { m, coll, nano: m instanceof mf.Nanoflow, rule: m instanceof mf.Rule, inLoop: coll.container instanceof mf.LoopedActivity, inHandler, returns: returnsValue(m) };
        const tail = { obj: from, originIndex: anchor.originConnectionIndex, caseValue: caseOf(anchor), errorHandler: anchor.isErrorHandler };
        const objsBefore = new Set(coll.objects.map(x => x.id));
        const flowsBefore = new Set([...m.flows].map(x => x.id));
        const donor = L.sideOf(anchor, "dest");
        const seg = await build(f, geo, tail);
        if (!seg.tail) throw new Error(`${where}: inserted actions must not end the flow (end/break/continue/error); the steps after them would be cut off`);
        const first = [...m.flows].find(x => !flowsBefore.has(x.id) && x.origin === from && x.destination === seg.first);
        lay.redirect(anchor, seg.first, first ? L.sideOf(first, "dest") : null);
        if (first) first.delete();
        lay.inserted(geo, [...coll.objects].filter(x => !objsBefore.has(x.id) || (seg.objs || []).includes(x)), seg.width);
        lay.adopt(connect(f, seg.tail, to, donor.idx), donor);
        lay.finish();
        return seg;
    }

    async function addActions(o) {
        const m = await flowDoc(o.microflow);
        if (!Array.isArray(o.actions) || !o.actions.length) throw new Error("addActions needs actions: [ ... ]");
        let anchor;
        if (o.handlerOf !== undefined) {
            // the start of a step's custom error handler: on its error flow
            if (o.after !== undefined || o.branch !== undefined) throw new Error(`${o.microflow}: 'handlerOf' puts the actions at the start of that step's error handler and goes without 'after'/'branch'; to add later in the handler use "after": "<id of a step in the handler>" (see: steps ${o.microflow})`);
            const step = findStep(m, o.handlerOf);
            const efl = flowsOf(m).filter(x => x.isErrorHandler && x.origin === step);
            if (!efl.length) {
                const t = (step instanceof mf.ActionActivity ? step.action : step).errorHandlingType;
                throw new Error(`${o.microflow}: [${o.handlerOf}] ${describe(step)} has no custom error handler (its error handling is ${t ? t.name : "none"}); give it one first: { "op": "changeAction", "microflow": "${o.microflow}", "id": "${o.handlerOf}", "onError": { "actions": [ ... ] } }`);
            }
            anchor = efl[0];
        } else anchor = anchorOf(m, o.after, o.branch, o.microflow);
        await insertSteps(m, anchor, (f, geo, tail) => buildSeq(f, o.actions, geo.x0, geo.y0, tail, o.microflow), o.microflow);
        return `${o.microflow}: ${o.actions.length} action(s) ${o.handlerOf !== undefined ? `at the start of the error handler of [${o.handlerOf}]` : `after ${o.after || "the last step"}${o.branch !== undefined ? ` [${o.branch}]` : ""}`}`;
    }

    // Removes the custom error handler of owner: its error flow and the steps only that handler reaches (with the
    // handlers inside it); a handler path that joined the main flow again keeps the main flow (a merge left with one
    // way in and one way out goes too). Returns the number of steps removed.
    function removeHandler(m, owner, lay) {
        const sc = FE.sdkScopes(m);
        const doomed = new Set([...sc.handlerOf.keys()].filter(id => sc.handlerOf.get(id) === owner.id || sc.chain(id).includes(owner.id)));
        const efl = flowsOf(m).filter(x => x.isErrorHandler && x.origin === owner);
        if (!efl.length && !doomed.size) return 0;
        // notes attached to removed steps go with them
        for (const fl of [...m.flows]) if (fl instanceof mf.AnnotationFlow && fl.destination && doomed.has(fl.destination.id) && fl.origin instanceof mf.Annotation) doomed.add(fl.origin.id);
        const joins = new Set();
        for (const fl of [...m.flows]) {
            const from = fl.origin && fl.origin.id;
            const to = fl.destination && fl.destination.id;
            if (efl.includes(fl) || doomed.has(from) || doomed.has(to)) {
                if (fl instanceof mf.SequenceFlow && doomed.has(from) && !doomed.has(to) && fl.destination instanceof mf.ExclusiveMerge) joins.add(fl.destination);
                fl.delete();
            }
        }
        let n = 0;
        for (const id of doomed) {
            const node = sc.nodes.get(id);
            if (!node || (node.loop && doomed.has(node.loop))) continue; // goes with its loop
            if (node.obj instanceof mf.ActionActivity) n++;
            node.obj.delete();
        }
        for (const mg of joins) {
            const inc = flowsOf(m).filter(x => x.destination === mg);
            const out = flowsOf(m).filter(x => x.origin === mg);
            if (inc.length !== 1 || out.length !== 1) continue;
            lay.redirect(inc[0], out[0].destination, L.sideOf(out[0], "dest"));
            out[0].delete();
            mg.delete();
        }
        lay.invalidate();
        return n;
    }

    // changeAction onError: replaces the error handling of an action or loop (the old custom handler goes first).
    async function setOnError(m, step, onError, where) {
        if (!(step instanceof mf.ActionActivity || step instanceof mf.LoopedActivity) || (step instanceof mf.ActionActivity && !step.action)) throw new Error(`${where}: onError applies to an action or a loop, not to ${describe(step)} (the error handling of a decision: set it in Studio Pro)`);
        if (m instanceof mf.Rule) throw new Error(`${where}: a rule has no error handling`);
        if (isRetry(onError)) throw new Error(`${where}: onError retry wraps the action in a loop, which changeAction cannot do; delete the step (deleteAction) and add it again with "onError": { "pattern": "retry" } (addActions "after" the step before it)`);
        const coll = step.container;
        const sc = FE.sdkScopes(m);
        const f = { m, coll, nano: m instanceof mf.Nanoflow, rule: false, inLoop: coll.container instanceof mf.LoopedActivity, inHandler: sc.handlerOf.has(step.id), returns: returnsValue(m) };
        const lay = L.begin(m);
        const removed = removeHandler(m, step, lay);
        const before = new Set(coll.objects.map(x => x.id));
        const p = step.relativeMiddlePoint;
        await errorHandler(f, step, onError, p.x, p.y + step.size.height / 2 + LANE - 30, where);
        const added = [...coll.objects].filter(x => !before.has(x.id));
        if (added.length) {
            // the first free lane below the step
            const others = [...coll.objects].filter(x => before.has(x.id) && x !== step && !(x instanceof mf.Annotation));
            const hit = () => added.some(a => others.some(o => L.overlaps(L.rect(a), L.rect(o))));
            for (let k = 0; k < 30 && hit(); k++) lay.shift(coll, added, 0, LANE);
            lay.mark(coll, added);
        }
        lay.finish();
        const t = (step instanceof mf.ActionActivity ? step.action : step).errorHandlingType.name;
        return `onError ${t}${removed ? ` (old handler removed: ${removed} action(s))` : ""}${added.length ? ` (handler: ${added.filter(x => x instanceof mf.ActionActivity).length} action(s))` : ""}`;
    }

    // ------------------------------------------------ steps (ids), change, delete

    function describe(o) {
        if (o instanceof mf.StartEvent) return "START";
        if (o instanceof mf.EndEvent) return "END" + (o.returnValue ? ` return ${o.returnValue}` : "");
        if (o instanceof mf.MicroflowParameterObject) return `PARAMETER $${o.name}`;
        if (o instanceof mf.ExclusiveSplit) {
            const c = o.splitCondition;
            if (c instanceof mf.RuleSplitCondition) return `IF RULE ${c.ruleCall ? c.ruleCall.ruleQualifiedName : "?"}(${c.ruleCall ? [...c.ruleCall.parameterMappings].map(pm => `${String(pm.parameterQualifiedName).split(".").pop()} = ${pm.argument}`).join(", ") : ""})`;
            return `IF ${c instanceof mf.ExpressionSplitCondition ? c.expression : o.caption}`;
        }
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
                ? `RETRIEVE $${a.outputVariableName} = ${src.range instanceof mf.ConstantRange && src.range.singleObject ? "FIRST " : ""}${src.entityQualifiedName}${src.xPathConstraint ? " " + src.xPathConstraint : ""}${extras.describeRetrieve(src)}`
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
        } else if (a instanceof mf.MeterAction) s = `METRIC ${t.replace(/MeterAction$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()} ${a.name}${a.value ? " " + a.value : ""}`;
        else if (a instanceof mf.GenerateDocumentAction) s = `GENERATE DOCUMENT ${a.documentTemplateQualifiedName} -> $${a.fileVariableName}`;
        else if (extraOf(a) && extraOf(a).describe) s = extraOf(a).describe(a);
        else s = t.replace(/Action$/, "").toUpperCase();
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
        const lines = [`${m instanceof mf.Nanoflow ? "NANOFLOW" : "MICROFLOW"} ${qn}   (ids are stable; use them in changeAction / deleteAction / addActions "after"; addActions "handlerOf" adds at the start of an error handler)`];
        const seen = new Set();
        const sc = FE.sdkScopes(m);
        // the error handling of a step, when it is not the default
        const EH = { Continue: "continue", Custom: "custom handler with rollback", CustomWithoutRollBack: "custom handler without rollback" };
        const ehOf = o => {
            const t = o instanceof mf.ActionActivity ? o.action && o.action.errorHandlingType : o instanceof mf.LoopedActivity ? o.errorHandlingType : null;
            return t && EH[t.name] ? `   {on error: ${EH[t.name]}}` : "";
        };
        // handler: id of the step whose error handler this branch is (a step on the main flow ends the branch there)
        const visit = (o, depth, label, handler = null) => {
            const pad = "  ".repeat(depth);
            if (handler && sc.main.has(o.id)) return lines.push(`${pad}${label}-> [${short(o)}] ${describe(o)} (back on the main flow)`);
            if (seen.has(o.id)) return lines.push(`${pad}${label}-> [${short(o)}] ${describe(o)} (above)`);
            seen.add(o.id);
            lines.push(`${pad}${label}[${short(o)}] ${describe(o)}${ehOf(o)}`);
            if (o instanceof mf.LoopedActivity) {
                for (const x of o.objectCollection.objects) if (!incoming.has(x.id) && !(x instanceof mf.Annotation)) visit(x, depth + 2, "", handler);
            }
            const outs = byOrigin.get(o.id) || [];
            const normal = outs.filter(x => !x.isErrorHandler);
            for (const x of outs.filter(x => x.isErrorHandler)) visit(x.destination, depth + 1, `[on error of ${short(o)}] `, o.id);
            if (normal.length === 1 && caseOf(normal[0]) === null) visit(normal[0].destination, depth, "", handler);
            else for (const x of normal) visit(x.destination, depth + 1, `[${caseLabel(x)}] `, handler);
        };
        for (const p of m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject)) visit(p, 0, "");
        const start = m.objectCollection.objects.find(x => x instanceof mf.StartEvent);
        if (start) visit(start, 0, "");
        const rest = all.filter(o => !seen.has(o.id) && !(o instanceof mf.Annotation));
        if (rest.length) {
            lines.push("NOT CONNECTED:");
            for (const o of rest) visit(o, 1, "");
        }
        const notes = all.filter(o => o instanceof mf.Annotation);
        if (notes.length) {
            lines.push("NOTES (annotations):");
            const to = new Map([...m.flows].filter(x => x instanceof mf.AnnotationFlow).map(x => [x.origin && x.origin.id, x.destination]));
            for (const n of notes) lines.push(`  [${short(n)}] "${n.caption.replace(/\r?\n/g, " ").slice(0, 80)}"${to.get(n.id) ? ` -> [${short(to.get(n.id))}]` : ""}`);
        }
        // FLOW CHECK on the stored flow (error handling advice; the dry run shows it for new steps)
        if (h.client && h.client.project && (m instanceof mf.Microflow || m instanceof mf.Nanoflow)) {
            let findings = [];
            try {
                findings = FE.flowCheck(h.client.project.read(m.id));
            } catch (e) {
                findings = [];
            }
            if (findings.length) {
                lines.push("FLOW CHECK (error handling):");
                for (const x of findings) lines.push(`  ${x.level === "note" ? "(note)" : "(warning)"} ${x.text}`);
            }
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
            },
            ...extras.retrieveChanges
        },
        members: {
            set: async (f, a, v, where) => {
                const entityQn = a instanceof mf.CreateObjectAction ? a.entityQualifiedName : await entityOfVariable(f.m, a.changeVariableName, where);
                const ent = await h.entity(entityQn);
                await h.loadParents(ent);
                for (const [member, value] of Object.entries(v || {})) {
                    const existing = [...a.items].find(mc => mc.type === mf.ChangeActionItemType.Set && (member.includes(".") ? mc.associationQualifiedName : mc.attribute && mc.attribute.name) === member);
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
            refresh: (f, a, v) => (a.refreshInClient = bool(v, false)),
            ...extras.memberChanges
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
                    else if (pv instanceof mf.MicroflowParameterValue) {
                        const target = await h.get(String(value).replace(/^'|'$/g, ""));
                        if (!(target instanceof mf.Microflow)) throw new Error(`${where}: parameter '${name}' takes a microflow name like "Module.Microflow"`);
                        pv.microflow = target;
                    }
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
                if ((fn === "Reduce") !== (a.aggregateFunction === mf.AggregateFunctionEnum.Reduce)) throw new Error(`${where}: changing to or from reduce changes the result type; delete the step (deleteAction) and add a new aggregateList (addActions)`);
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
            initial: (f, a, v, where) => {
                if (a.aggregateFunction !== mf.AggregateFunctionEnum.Reduce) throw new Error(`${where}: 'initial' only applies to reduce`);
                a.reduceInitialValueExpression = expr(f.m, v, where);
            },
            expression: async (f, a, v, where) => {
                if (a.aggregateFunction === mf.AggregateFunctionEnum.Count) throw new Error(`${where}: count takes no expression; change 'function' first`);
                if (a.aggregateFunction === mf.AggregateFunctionEnum.Reduce && !/\$currentResult\b/.test(String(v))) throw new Error(`${where}: a reduce expression combines $currentResult with $currentObject`);
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
            commit: (f, a, v) => importCommit(a.resultHandling, v),
            auth: (f, a, v, where) => restAuth(f, a.httpConfiguration, v, where),
            proxy: (f, a, v, where) => restProxy(f, a, v, where),
            errorBody: (f, a, v) => (a.errorResultHandlingType = bool(v, true) ? mf.ErrorResultHandlingType.HttpResponse : mf.ErrorResultHandlingType.None)
        },
        ImportXmlAction: { commit: (f, a, v) => importCommit(a.resultHandling, v) },
        InheritanceSplit: { caption: (f, o, v) => (o.caption = String(v)) },
        CreateVariableAction: { value: (f, a, v, where) => (a.initialValue = expr(f.m, v, where)) },
        ChangeVariableAction: { value: (f, a, v, where) => (a.value = expr(f.m, v, where)) },
        ExclusiveSplit: {
            condition: (f, o, v, where) => {
                if (!(o.splitCondition instanceof mf.ExpressionSplitCondition)) throw new Error("this decision calls a rule: change its 'args', or replace the decision in Studio Pro");
                o.splitCondition.expression = expr(f.m, v, where);
            },
            args: (f, o, v, where) => {
                const call = o.splitCondition instanceof mf.RuleSplitCondition ? o.splitCondition.ruleCall : null;
                if (!call) throw new Error("'args' only applies to a decision that calls a rule; this one has a condition");
                if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: args must be { "Param": "expression" }`);
                for (const [name, value] of Object.entries(v)) {
                    const pm = [...call.parameterMappings].find(x => String(x.parameterQualifiedName).split(".").pop() === name);
                    if (!pm) fail(`${where}: the rule call has no parameter '${name}'`, name, [...call.parameterMappings].map(x => String(x.parameterQualifiedName).split(".").pop()));
                    pm.argument = expr(f.m, value, where);
                }
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
        const f = { m, nano: m instanceof mf.Nanoflow, rule: m instanceof mf.Rule, returns: returnsValue(m) };
        const { target, own, common } = changeTable(step);
        const handles = step instanceof mf.ActionActivity || step instanceof mf.LoopedActivity;
        const names = () => [...Object.keys(own), ...Object.keys(common), ...(handles ? ["onError"] : [])];
        const fields = Object.keys(o).filter(k => !["op", "microflow", "id"].includes(k));
        if (!fields.length) throw new Error(`changeAction needs at least one field to change. For this step: ${names().join(", ") || "(nothing can be changed)"}`);
        const where = `${o.microflow} [${o.id}]`;
        const done = [];
        // an action of EXTRA_ACTIONS with spec(): its own fields change by building it again from the stored fields
        // plus the new ones, in one go (the action keeps its box, caption and error handling)
        const x = step instanceof mf.ActionActivity && step.action && !Object.keys(own).length ? extraOf(step.action) : null;
        if (x && x.spec) {
            const mine = fields.filter(k => k in x.fields);
            if (mine.length) {
                done.push(await rebuildExtra(f, step, x, o, mine, where));
                fields.splice(0, fields.length, ...fields.filter(k => !mine.includes(k)));
            }
            for (const k of fields) if (!(k in x.fields) && !common[k] && !(k === "onError" && handles)) fail(`${where}: '${k}' cannot be changed on ${describe(step)}. Fields for this step: ${[...Object.keys(x.fields), ...Object.keys(common), "onError"].join(", ")}`, k, [...Object.keys(x.fields), ...Object.keys(common)]);
        }
        for (const k of fields) {
            if (k === "onError" && handles) {
                done.push(await setOnError(m, step, o.onError, where));
                continue;
            }
            const fn = own[k] || common[k];
            if (!fn) fail(`${where}: '${k}' cannot be changed on ${describe(step)}. Fields for this step: ${names().join(", ") || "none"}`, k, names());
            await fn(f, own[k] ? target : step, o[k], where, o);
            done.push(k);
        }
        return `${where} ${describe(step)}: ${done.join(", ")}`;
    }

    // changeAction on an action of EXTRA_ACTIONS: the stored fields (x.spec) with the given ones on top; an object field
    // ({ "param": ... }) merges, null removes a field; a new operation / service drops the old args and query.
    async function rebuildExtra(f, step, x, o, keys, where) {
        const a = step.action;
        const kind = Object.keys(EXTRA_ACTIONS).find(n => EXTRA_ACTIONS[n] === x);
        const old = x.spec(a);
        const next = { ...old };
        const plain = v => v && typeof v === "object" && !Array.isArray(v);
        for (const k of keys) {
            const v = o[k];
            if (v === null) delete next[k];
            else if (plain(v) && plain(old[k])) next[k] = Object.fromEntries(Object.entries({ ...old[k], ...v }).filter(([, y]) => y !== null));
            else next[k] = v;
        }
        if (["operation", "service", "name"].some(k => keys.includes(k) && o[k] !== old[k])) for (const k of ["args", "query"]) if (!keys.includes(k)) delete next[k];
        const errorType = a.errorHandlingType;
        const c = { f, h, model, expr: (v, w) => expr(f.m, v, w), variableInfo: (n, w) => variableInfo(f.m, n, w), needVariable: (n, l, w) => needVariable(f.m, n, l, w), fillTemplate: (t, text, args, w) => fillTemplate(f, t, text, args, w) };
        validate("action", kind, { fields: { ...x.fields, ...COMMON } }, { action: kind, ...next }, where);
        const made = await x.build(c, step, { action: kind, ...next }, where);
        made.errorHandlingType = errorType;
        const was = old[CREATES[kind]];
        if (CREATES[kind] && was && next[CREATES[kind]] !== was && h.client) h.client.warn(`${where}: the result is now ${next[CREATES[kind]] ? "$" + next[CREATES[kind]] : "not stored"} (was $${was}); check the steps that use $${was}`);
        return keys.join(", ");
    }

    async function deleteAction(o) {
        const m = await flowDoc(o.microflow);
        const step = findStep(m, o.id);
        const where = `${o.microflow} [${o.id}] ${describe(step)}`;
        if (!(step instanceof mf.ActionActivity) && !(step instanceof mf.LoopedActivity)) throw new Error(`${where}: only actions and loops can be deleted; change decisions, merges and events in Studio Pro`);
        const doomed = new Set([step.id]);
        if (step instanceof mf.LoopedActivity) walkObjects(step.objectCollection, x => doomed.add(x.id));
        const normalOut = flowsOf(m).filter(x => x.origin.id === step.id && !x.isErrorHandler);
        if (normalOut.length > 1) throw new Error(`${where}: it has ${normalOut.length} outgoing flows`);
        // its custom error handler goes with it (the steps only that handler reaches)
        const lay = L.begin(m);
        const removed = removeHandler(m, step, lay);
        const flows = flowsOf(m);
        const incoming = flows.filter(x => x.destination.id === step.id);
        const outgoing = flows.filter(x => x.origin.id === step.id);
        const next = outgoing[0];
        // close the gap for what follows (flow-layout.js): add + delete gives the old positions back
        const coll = step.container;
        const gap = next ? lay.gapOf(step) : null;
        for (const x of incoming) {
            if (next) lay.redirect(x, next.destination, L.sideOf(next, "dest"));
            else x.delete();
        }
        if (next) next.delete();
        for (const x of flowsOf(m)) if (doomed.has(x.origin.id) || doomed.has(x.destination.id)) x.delete();
        step.delete();
        lay.invalidate();
        if (gap) lay.closeGap(gap);
        lay.mark(coll, []);
        lay.finish();
        return where + (removed ? ` (with its error handler: ${removed} action(s))` : "");
    }

    // for ops-flow-edit.js (moveAction, extractMicroflow, addAnnotation)
    const internals = { flowDoc, findStep, flowsOf, walkObjects, variablesOf, typeOfVariable, variableInfo, anchorOf, insertSteps, connect, flow, caseOf, caseLabel, activity, annotate, describe, point, size, returnsValue, errorDefault, removeHandler, X_STEP, LANE };
    return { createFlow, addActions, changeAction, deleteAction, steps, describe, variablesOf, walkObjects, flowDoc, findStep, layoutReport, internals };
}

module.exports = { makeFlows, ACTIONS, CONTROL, COMMON, CREATES };
