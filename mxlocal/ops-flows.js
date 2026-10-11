"use strict";
// Microflows and nanoflows: build structured flows (actions, decisions, loops, error handlers, end/break/continue)
// laid out like Studio Pro does, list their steps with stable ids, and change or delete single steps.
const sdk = require("mendixmodelsdk");
const { DATA_TYPES, suggest, fail, validate, bool, noDollar, enumValue } = require("./ops-util");
const { MAPPING_ACTIONS, mappingAction } = require("./ops-mappings");

const { microflows: mf, domainmodels: dm, datatypes, pages } = sdk;

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
    ...MAPPING_ACTIONS
};
const COMMON = { caption: "optional caption on the box (default: generated)", onError: ON_ERROR };

// Structure (no box of their own, or a special box).
const CONTROL = {
    if: { doc: "Decision. Runs 'then' when the condition is true, otherwise 'else'. A branch may end with end/break/continue.", fields: { condition: "R boolean expression, e.g. $Order/Total > 100", then: "optional [ actions ]", else: "optional [ actions ]", caption: "optional text in the diamond (default: the condition)" } },
    loop: { doc: "Loop over a list ('over' + 'item'), or while a condition is true ('while').", fields: { over: "list variable to loop over (no $)", item: "name of the current object (default: <list>Item)", while: "boolean expression (instead of 'over')", actions: "R [ actions inside the loop ]" } },
    end: { doc: "End the flow here.", fields: { value: "return expression; required when the flow returns a value" } },
    break: { doc: "Leave the loop (only inside a loop).", fields: {} },
    continue: { doc: "Go to the next loop item (only inside a loop).", fields: {} },
    error: { doc: "End with the error again (only inside an onError handler).", fields: {} }
};

function makeFlows(h) {
    const { model } = h;
    const toLint = [];

    function expr(m, value, where) {
        toLint.push({ m, expr: String(value), where });
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

    function addCase(fl, value) {
        const Case = value === null ? mf.NoCase : mf.EnumerationCase;
        let c;
        try {
            c = Case.createInSequenceFlowUnderCaseValues(fl); // Mendix 10.15+
        } catch (e) {
            c = Case.createInSequenceFlowUnderCaseValue(fl); // older versions: one case value
        }
        if (value !== null) c.value = value;
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

    function caseOf(fl) {
        const list = fl.caseValues ? [...fl.caseValues] : fl.caseValue ? [fl.caseValue] : [];
        const c = list[0];
        if (!c || c instanceof mf.NoCase) return null;
        if (c instanceof mf.EnumerationCase) return c.value;
        return c.structureTypeName.split("$")[1];
    }

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
                for (const key of ["outputVariableName", "variableName"]) if (o.action[key]) out.set(o.action[key], o);
                const named = o.action.resultHandling || o.action.outputMethod; // import/export with mapping
                if (named && named.outputVariableName) out.set(named.outputVariableName, o);
            } else if (o instanceof mf.LoopedActivity && o.loopSource instanceof mf.IterableList && o.loopSource.variableName) out.set(o.loopSource.variableName, o);
        });
        return out;
    }

    async function entityOfVariable(m, name, where) {
        const v = variablesOf(m).get(noDollar(name));
        if (!v) fail(`${where}: no variable '${name}' before this action in ${m.qualifiedName}`, noDollar(name), [...variablesOf(m).keys()]);
        if (v instanceof mf.MicroflowParameterObject) {
            if (v.variableType && v.variableType.entity) return v.variableType.entityQualifiedName;
        } else if (v instanceof mf.LoopedActivity) {
            return entityOfVariable(m, v.loopSource.listVariableName, where);
        } else {
            const a = v.action;
            if (a.entity) return a.entityQualifiedName;
            if (a.variableType && a.variableType.entity) return a.variableType.entityQualifiedName;
            if (a.retrieveSource && a.retrieveSource.entity) return a.retrieveSource.entityQualifiedName;
            if (a.resultHandling && a.resultHandling.variableType && a.resultHandling.variableType.entity) return a.resultHandling.variableType.entityQualifiedName;
            if (a.retrieveSource && a.retrieveSource.association) {
                const assoc = a.retrieveSource.association;
                if (assoc instanceof dm.Association || assoc instanceof dm.CrossAssociation) {
                    const loaded = assoc.isLoaded ? assoc : await assoc.load();
                    return loaded.child ? loaded.child.qualifiedName || loaded.childQualifiedName : null;
                }
            }
        }
        throw new Error(`${where}: cannot tell the entity of variable '${name}'`);
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

    async function activity(f, spec, x, y, where) {
        const kind = spec.action;
        validate("action", kind, { fields: { ...ACTIONS[kind].fields, ...COMMON } }, spec, where);
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
                if (f.nano) throw new Error(`${where}: 'log' is not available in nanoflows`);
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
            case "importWithMapping":
            case "exportWithMapping":
                a = await mappingAction(h, f, act, spec, where);
                break;
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
            if (!ACTIONS[kind] && !CONTROL[kind]) fail(`${w}: unknown action '${kind}'`, kind, [...Object.keys(ACTIONS), ...Object.keys(CONTROL)]);
            if (CONTROL[kind]) validate("action", kind, CONTROL[kind], spec, w);
            switch (kind) {
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
        else if (a instanceof mf.ImportXmlAction) {
            const rh = a.resultHandling;
            s = `IMPORT $${a.xmlDocumentVariableName} WITH ${rh && rh.importMappingCall ? rh.importMappingCall.mappingQualifiedName : "?"}${rh && rh.storeInVariable ? " -> $" + rh.outputVariableName : ""}`;
        } else if (a instanceof mf.ExportXmlAction) {
            const rh = a.resultHandling;
            s = `EXPORT $${rh ? rh.mappingArgumentVariableName : "?"} WITH ${rh ? rh.mappingQualifiedName : "?"}${a.outputMethod && a.outputMethod.outputVariableName ? " -> $" + a.outputMethod.outputVariableName : ""}`;
        }
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
            else for (const x of normal) visit(x.destination, depth + 1, `[${caseOf(x)}] `);
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
            await fn(f, own[k] ? target : step, o[k], where);
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
        for (const { m, expr: e, where } of toLint) {
            const re = /\$(\w+)\/([\w.]+)/g;
            let hit;
            while ((hit = re.exec(e))) {
                const [, variable, member] = hit;
                const v = variablesOf(m).get(variable);
                if (!v) {
                    lint.push(`${where}: $${variable} is not a parameter or a variable created in ${m.qualifiedName}`);
                    continue;
                }
                let entityQn;
                try {
                    entityQn = await entityOfVariable(m, variable, where);
                } catch (err) {
                    continue; // primitive variable or unknown: nothing to check
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

module.exports = { makeFlows, ACTIONS, CONTROL, COMMON };
