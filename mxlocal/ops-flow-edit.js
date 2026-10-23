"use strict";
// Restructuring existing microflows/nanoflows: move a step to another place or branch, extract a run of steps into a
// new sub-microflow (parameters = the variables it uses, return value = the one variable it creates that is used
// later) and annotations. Steps keep their ids; the line is reconnected as Studio Pro does when you drag a step.
const sdk = require("mendixmodelsdk");
const { validName, noDollar } = require("./ops-util");
const L = require("./flow-layout");
const FE = require("./flow-errors");

const { microflows: mf } = sdk;

const FLOW_EDIT_OPS = {
    moveAction: {
        doc: "Move one action or loop to another place in the same flow (also into a decision branch or a loop). Get ids with: steps Module.Flow.",
        fields: { microflow: "R Module.Microflow or Module.Nanoflow", id: "R step id from 'steps'", after: "R \"start\", the variable name a step creates, or a step id: the step goes right after it", branch: "with after = a decision: which outgoing flow, e.g. \"true\", \"false\" or an enumeration value" }
    },
    extractMicroflow: {
        doc: "Move a run of steps (from .. to, one after the other) into a new microflow (nanoflow in a nanoflow) and call it in their place. Parameters: the variables the steps use; returns the one variable they create that is used later.",
        fields: { microflow: "R Module.Microflow or Module.Nanoflow", from: "R id of the first step", to: "optional id of the last step (default: from)", name: "R name of the new flow", module: "optional module (default: the module of microflow)", folder: "optional folder path (default: the module root)" }
    },
    formatMicroflow: {
        doc: "Lay out a whole microflow, nanoflow or rule again, the way Studio Pro draws it: the main path on one line, branches and error handlers as lanes below, merges after their branches, loops sized to their content, every flow on Studio Pro's sides. Steps, flows and ids stay; only positions, sizes and flow sides change. Formatting twice gives the same result.",
        fields: { microflow: "R Module.Microflow, Module.Nanoflow or Module.Rule", keepAnnotations: "optional true: annotations stay exactly where they are (default: an attached note moves with its step)" }
    },
    deleteBranch: {
        doc: "Delete one outgoing branch of a decision with the steps only that branch reaches, and reconnect: an if (or a decision left with one way) goes away and its other branch joins the line; a merge left with one incoming flow goes too. Get ids with: steps Module.Flow.",
        fields: { microflow: "R Module.Microflow or Module.Nanoflow", id: "R id of the decision (if, switch, ifType)", branch: "R which outgoing flow: \"true\", \"false\", an enumeration value, \"empty\", \"other\" or a specialization" }
    },
    rerouteBranch: {
        doc: "Point an outgoing flow (a decision branch, or the line after a step) at another step of the same flow; a step that already has an incoming line gets a merge in front. Steps nobody reaches any more are refused unless deleteOrphans. Get ids with: steps Module.Flow.",
        fields: { microflow: "R Module.Microflow or Module.Nanoflow", id: "R id of the decision or step the flow starts at", branch: "with a decision: which outgoing flow (\"true\", \"false\", an enumeration value, ...)", to: "R id of the step the flow goes to now (same level: not into or out of a loop)", deleteOrphans: "optional true: delete the steps only the old path reached (default: refused, they are listed)" }
    },
    addAnnotation: {
        doc: "Add an annotation (a note) to a flow, attached to a step or free.",
        fields: { microflow: "R Module.Microflow, Module.Nanoflow or Module.Rule", text: "R note text", to: "optional step id to attach it to (default: free, top left)" }
    }
};

// Variables an expression names ($Var), without the built-in ones.
const BUILTIN = new Set(["currentObject", "currentUser", "currentSession", "latestError", "latestSoapFault", "latestHttpResponse", "currentResult", "currentDeviceType"]);
const DEFINES = new Set(["outputVariableName", "variableName"]);

function makeFlowEdit(h, flows) {
    const x = flows.internals;
    const { flowsOf, walkObjects, findStep, describe } = x;
    const { model } = h;
    const short = o => o.id.slice(0, 8);

    // { uses, defs } of one object (a loop: its body too; variables made inside a loop stay inside it).
    function varsOf(o) {
        const uses = new Set();
        const defs = new Set();
        const scan = (json, own) => {
            if (!json || typeof json !== "object") return;
            if (Array.isArray(json)) return json.forEach(j => scan(j, own));
            for (const [k, v] of Object.entries(json)) {
                if (typeof v === "string") {
                    if (DEFINES.has(k)) {
                        if (own && v) defs.add(v);
                    } else if (/VariableName$/.test(k)) {
                        if (v) uses.add(v);
                    } else for (const m of v.matchAll(/\$([A-Za-z_]\w*)/g)) if (!BUILTIN.has(m[1])) uses.add(m[1]);
                } else if (v && typeof v === "object" && !/^(objectCollection|relativeMiddlePoint|size)$/.test(k)) scan(v, own);
            }
        };
        if (o instanceof mf.ActionActivity && o.action) {
            const a = o.action;
            const json = a.toJSON();
            // a call that does not keep its result defines nothing
            if (a.useReturnVariable === false) delete json.outputVariableName;
            if (a.resultHandling && !a.resultHandling.storeInVariable) delete (json.resultHandling || {}).outputVariableName;
            scan(json, true);
        } else if (o instanceof mf.LoopedActivity) {
            const inner = new Set();
            if (o.loopSource) scan(o.loopSource.toJSON(), false);
            if (o.loopSource instanceof mf.IterableList) inner.add(o.loopSource.variableName);
            walkObjects(o.objectCollection, y => {
                const v = varsOf(y);
                v.defs.forEach(d => inner.add(d));
                v.uses.forEach(u => uses.add(u));
            });
            for (const d of inner) uses.delete(d);
        } else if (o instanceof mf.ExclusiveSplit && o.splitCondition) scan(o.splitCondition.toJSON(), false);
        else if (o instanceof mf.InheritanceSplit) uses.add(o.splitVariableName);
        else if (o instanceof mf.EndEvent && o.returnValue) scan({ returnValue: o.returnValue }, false);
        return { uses, defs };
    }

    // Objects reachable from obj against (dir = "back") or along (dir = "fwd") the flows; a loop body's first step
    // continues at its loop.
    function reach(m, obj, dir) {
        const fl = flowsOf(m);
        const seen = new Set();
        const todo = [obj];
        while (todo.length) {
            const o = todo.pop();
            const next = dir === "back" ? fl.filter(f => f.destination === o).map(f => f.origin) : fl.filter(f => f.origin === o).map(f => f.destination);
            if (!next.length && o.container && o.container.container instanceof mf.LoopedActivity) next.push(o.container.container);
            for (const n of next) {
                if (seen.has(n.id)) continue;
                seen.add(n.id);
                todo.push(n);
            }
        }
        return seen;
    }

    // After a move: what the step uses must be made before it, what it makes must not be used before it.
    function orderProblems(m, step) {
        const before = reach(m, step, "back");
        const after = reach(m, step, "fwd");
        const known = new Set();
        let loopItem = step.container && step.container.container instanceof mf.LoopedActivity ? step.container.container : null;
        for (; loopItem; loopItem = loopItem.container && loopItem.container.container instanceof mf.LoopedActivity ? loopItem.container.container : null) {
            if (loopItem.loopSource instanceof mf.IterableList) known.add(loopItem.loopSource.variableName);
        }
        walkObjects(m.objectCollection, o => {
            if (o instanceof mf.MicroflowParameterObject) known.add(o.name);
            else if (before.has(o.id)) varsOf(o).defs.forEach(d => known.add(d));
        });
        const own = varsOf(step);
        const r = [];
        for (const u of own.uses) if (!known.has(u) && x.variablesOf(m).has(u)) r.push(`$${u} is used by the step but made after it`);
        walkObjects(m.objectCollection, o => {
            if (o === step || after.has(o.id) || o instanceof mf.Annotation) return;
            for (const d of own.defs) if (varsOf(o).uses.has(d)) r.push(`$${d} is made by the step but used before it by [${short(o)}] ${describe(o)}`);
        });
        return r;
    }

    const normalOut = (m, o) => flowsOf(m).filter(f => f.origin === o && !f.isErrorHandler);
    const movable = o => o instanceof mf.ActionActivity || o instanceof mf.LoopedActivity;

    // Moves obj (and its annotations) into coll, keeping its id.
    // The custom error handler of a step: its objects (top level of the handler; a loop takes its body along), the
    // notes attached to them, whether it goes back to the main line (joins) and whether it has an end event.
    function handlerOf(m, step) {
        if (!flowsOf(m).some(f => f.isErrorHandler && f.origin === step)) return null;
        const sc = FE.sdkScopes(m);
        const ids = new Set([...sc.handlerOf.keys()].filter(id => sc.handlerOf.get(id) === step.id || sc.chain(id).includes(step.id)));
        for (const fl of [...m.flows]) if (fl instanceof mf.AnnotationFlow && fl.destination && ids.has(fl.destination.id) && fl.origin instanceof mf.Annotation) ids.add(fl.origin.id);
        const objs = [...ids].map(id => sc.nodes.get(id)).filter(n => n && !(n.loop && ids.has(n.loop))).map(n => n.obj);
        const inside = new Set(ids);
        for (const o of objs) if (o instanceof mf.LoopedActivity) walkObjects(o.objectCollection, y => inside.add(y.id));
        const joins = flowsOf(m).filter(f => inside.has(f.origin.id) && !inside.has(f.destination.id) && f.destination !== step).map(f => f.destination);
        let ends = false;
        for (const o of objs) if (o instanceof mf.EndEvent) ends = true;
        return { ids: inside, objs, joins, ends };
    }

    // Moves the objects of a handler by (dx, dy) into coll.
    function carry(handler, coll, dx, dy) {
        for (const o of handler.objs) {
            moveInto(o, coll);
            x.point(o, o.relativeMiddlePoint.x + dx, o.relativeMiddlePoint.y + dy);
        }
    }

    // After moving a step with its handler: when the layout got new problems (the handler lane over other steps or
    // flows), the flow is laid out again as formatMicroflow does.
    function relayoutIfWorse(m, before) {
        if (L.lint(L.snapshot(m)).length > before) {
            L.format(m, {});
            return true;
        }
        return false;
    }

    function moveInto(obj, coll) {
        if (obj.container === coll) return;
        obj.detach();
        coll.objects.push(obj);
    }

    async function moveAction(o) {
        const m = await x.flowDoc(o.microflow);
        const step = findStep(m, o.id);
        const where = `${o.microflow} [${o.id}] ${describe(step)}`;
        if (!movable(step)) throw new Error(`${where}: only actions and loops can be moved; decisions, merges and events stay (move the steps around them)`);
        const fl = flowsOf(m);
        if (fl.some(f => f.isErrorHandler && f.destination === step)) throw new Error(`${where}: it is the first step of an error handler; move the step that owns the handler, or change the handler with changeAction onError`);
        // F10: a custom error handler moves along (its lane keeps its place under the step)
        const handler = handlerOf(m, step);
        if (handler && handler.joins.length) throw new Error(`${where}: its error handler goes back to the main line at ${handler.joins.map(j => `[${short(j)}] ${describe(j)}`).join(", ")}; such a step cannot move (the handler would continue at the old place). End the handler (an end or error event) first, or move the steps around it`);
        const errorsBefore = handler ? L.lint(L.snapshot(m)).length : 0;
        const was = { x: step.relativeMiddlePoint.x, y: step.relativeMiddlePoint.y };
        const incoming = fl.filter(f => f.destination === step);
        const outgoing = fl.filter(f => f.origin === step && !f.isErrorHandler);
        if (outgoing.length !== 1 || !incoming.length) throw new Error(`${where}: it has ${incoming.length} incoming and ${outgoing.length} outgoing flows; only a step on a line can be moved`);
        const anchorStep = o.after && o.after !== "start" ? x.variablesOf(m).get(noDollar(o.after)) || findStep(m, o.after, true) : null;
        if (anchorStep === step) throw new Error(`${where}: 'after' is the step itself`);
        if (step instanceof mf.LoopedActivity && anchorStep) {
            let inside = false;
            walkObjects(step.objectCollection, y => (inside = inside || y === anchorStep));
            if (inside) throw new Error(`${where}: a loop cannot move into itself`);
        }
        // take it off the line: what came in goes on to what came after it; the gap closes (flow-layout.js)
        const next = outgoing[0];
        const lay = L.begin(m);
        const gap = lay.gapOf(step);
        for (const f of incoming) lay.redirect(f, next.destination, L.sideOf(next, "dest"));
        next.delete();
        lay.invalidate();
        lay.closeGap(gap);
        lay.mark(step.container, []);
        lay.finish();
        // then in at the new place, making room for it there
        await x.insertSteps(m, x.anchorOf(m, o.after, o.branch, where), (f, geo, tail) => {
            moveInto(step, geo.coll);
            const r = L.rect(step);
            const w = r.r - r.l;
            const left = geo.mode === "t" ? L.rect(geo.to).l : geo.x0 - 60;
            x.point(step, left + w / 2, geo.y0);
            x.connect(f, tail, step);
            return { first: step, tail: { obj: step, originIndex: 1 }, width: w + L.GAP, objs: [step] };
        }, where);
        const problems = orderProblems(m, step);
        if (problems.length) throw new Error(`${where}: after the move ${problems.slice(0, 3).join("; ")}. Pick another place`);
        let extra = "";
        if (handler) {
            carry(handler, step.container, step.relativeMiddlePoint.x - was.x, step.relativeMiddlePoint.y - was.y);
            extra = ` with its error handler (${handler.objs.filter(y => y instanceof mf.ActionActivity || y instanceof mf.LoopedActivity).length} step(s))${relayoutIfWorse(m, errorsBefore) ? "; the flow was laid out again" : ""}`;
        }
        return `${where} -> after ${o.after}${o.branch !== undefined ? ` [${o.branch}]` : ""}${extra}`;
    }

    // The run of steps from .. to: one line, no branches or error handlers in between.
    function chainOf(m, from, to, where) {
        const chain = [];
        let cur = from;
        for (let i = 0; i < 500; i++) {
            if (!movable(cur)) throw new Error(`${where}: [${short(cur)}] ${describe(cur)} is not an action or loop; extract a run of actions/loops`);
            const fl = flowsOf(m);
            const hd = handlerOf(m, cur);
            if (hd && hd.joins.length) throw new Error(`${where}: [${short(cur)}] ${describe(cur)} has an error handler that goes back to the main line; extract the steps before or after it, or end the handler first`);
            if (hd && hd.ends) throw new Error(`${where}: [${short(cur)}] ${describe(cur)} has an error handler that ends the flow (an end event); in a sub-microflow it would end only the sub-microflow. Make the handler end with an error event ({ "action": "error" }) or extract the steps around it`);
            chain.push(cur);
            const out = normalOut(m, cur);
            if (out.length !== 1) throw new Error(`${where}: [${short(cur)}] has ${out.length} outgoing flows`);
            if (cur === to) return { chain, exit: out[0] };
            const nextObj = out[0].destination;
            if (fl.filter(f => f.destination === nextObj).length !== 1) throw new Error(`${where}: a merge or a second line reaches [${short(nextObj)}] ${describe(nextObj)}; 'to' must come after 'from' on one line`);
            cur = nextObj;
        }
        throw new Error(`${where}: [${short(to)}] does not follow [${short(from)}] on one line (see: steps ${m.qualifiedName})`);
    }

    async function extractMicroflow(o) {
        const m = await x.flowDoc(o.microflow);
        if (m instanceof mf.Rule) throw new Error(`${o.microflow} is a rule; a rule cannot call a microflow`);
        const nano = m instanceof mf.Nanoflow;
        const where = `${o.microflow} [${o.from}${o.to ? ".." + o.to : ""}]`;
        validName(o.name, `${nano ? "nanoflow" : "microflow"} name`);
        const module = o.module || m.qualifiedName.split(".")[0];
        const qn = `${module}.${o.name}`;
        if (await h.exists(qn)) throw new Error(`${qn} already exists`);
        const from = findStep(m, o.from);
        const to = o.to ? findStep(m, o.to) : from;
        const { chain, exit } = chainOf(m, from, to, where);
        const inChain = new Set();
        const handlerObjs = []; // F10: custom error handlers (ending in an error event) go into the new flow too
        for (const c of chain) {
            inChain.add(c.id);
            if (c instanceof mf.LoopedActivity) walkObjects(c.objectCollection, y => inChain.add(y.id));
            const hd = handlerOf(m, c);
            if (hd) {
                hd.ids.forEach(id => inChain.add(id));
                handlerObjs.push(...hd.objs);
            }
        }
        const entry = flowsOf(m).filter(f => f.destination === from);
        if (entry.some(f => f.isErrorHandler)) throw new Error(`${where}: [${short(from)}] is the start of an error handler path; extract steps on the normal line`);
        // what the steps use from before (parameters) and what they make that is used after (the return value)
        const uses = [];
        const defs = new Set();
        for (const c of [...chain, ...handlerObjs.filter(y => !(y instanceof mf.Annotation))]) {
            const v = varsOf(c);
            for (const u of v.uses) if (!defs.has(u) && !uses.includes(u)) uses.push(u);
            v.defs.forEach(d => defs.add(d));
        }
        const vars = x.variablesOf(m);
        const params = [];
        for (const u of uses.filter(u => vars.has(u) && !defs.has(u))) {
            const type = await x.typeOfVariable(m, u, where);
            if (!type) throw new Error(`${where}: cannot tell the type of $${u}, which the steps use; extract fewer steps or add a variable with a clear type first`);
            params.push({ name: u, type });
        }
        const later = new Set();
        walkObjects(m.objectCollection, y => {
            if (inChain.has(y.id) || y instanceof mf.Annotation) return;
            varsOf(y).uses.forEach(u => defs.has(u) && later.add(u));
        });
        if (later.size > 1) throw new Error(`${where}: the steps make ${[...later].map(v => "$" + v).join(", ")}, all used later; a flow returns one value. Extract fewer steps`);
        const result = later.size ? [...later][0] : null;
        const returns = result ? await x.typeOfVariable(m, result, where) : null;
        if (result && !returns) throw new Error(`${where}: cannot tell the type of $${result}, which the steps make and later steps use`);
        // the new flow: start -> the steps (moved, same ids) -> end
        const created = await h.createFlow({ module, name: o.name, folder: o.folder, parameters: params, returns: returns || undefined, returnValue: result ? `$${result}` : undefined, actions: [] }, nano);
        const sub = created.m;
        const startToEnd = flowsOf(sub)[0];
        const end = startToEnd.destination;
        const start = startToEnd.origin;
        startToEnd.delete();
        // flows between the moved steps (also inside their loops) and notes attached to them
        const inner = [...m.flows].filter(f => f.origin && f.destination && inChain.has(f.origin.id) && inChain.has(f.destination.id));
        const keep = inner.map(f => ({ f, origin: f.origin, destination: f.destination, note: f instanceof mf.AnnotationFlow }));
        const notes = [...m.flows].filter(f => f instanceof mf.AnnotationFlow && f.destination && inChain.has(f.destination.id) && f.origin && !inChain.has(f.origin.id));
        // the call replaces the steps (its left edge where the first one began); the line runs through it and what
        // follows closes up (flow-layout.js)
        const lay = L.begin(m);
        const gap = { coll: from.container, dx: Math.max(0, L.rect(to).r - (L.rect(from).l + 120)), side: 1, bound: from.relativeMiddlePoint.x, starts: [exit.destination], ids: inChain };
        const fx = L.rect(from).l + 60;
        const fy = from.relativeMiddlePoint.y;
        const f = { m, coll: from.container, nano, inLoop: from.container.container instanceof mf.LoopedActivity, inHandler: false, returns: x.returnsValue(m) };
        const call = await x.activity(f, { action: "call", microflow: qn, args: Object.fromEntries(params.map(p => [p.name, `$${p.name}`])), ...(result ? { variable: result } : {}) }, fx, fy, where);
        for (const e of entry) lay.redirect(e, call, null);
        exit.origin = call;
        L.setOriginSide(exit, 1);
        lay.touched.add(exit);
        const shift = { x: 100 + x.X_STEP - fx, y: 200 - fy };
        const records = keep.map(k => ({ origin: k.origin, destination: k.destination, note: k.note, oi: k.f.originConnectionIndex, di: k.f.destinationConnectionIndex, cv: k.note ? null : x.caseOf(k.f), eh: k.note ? false : k.f.isErrorHandler }));
        keep.forEach(k => k.f.delete());
        const noteObjs = notes.map(n => ({ note: n.origin, to: n.destination }));
        notes.forEach(n => n.delete());
        // copies in the new flow (another document: elements cannot move between units), then the originals go
        const map = new Map();
        const copyInto = o => {
            const { copy, idMap } = o.deepCopyWithIdMap(model);
            sub.objectCollection.objects.push(copy);
            for (const [id, el] of Object.entries(idMap)) map.set(id, el);
            map.set(o.id, copy);
            x.point(copy, o.relativeMiddlePoint.x + shift.x, o.relativeMiddlePoint.y + shift.y);
            return copy;
        };
        let right = 100 + x.X_STEP;
        const copies = chain.map(c => {
            const k = copyInto(c);
            right = Math.max(right, k.relativeMiddlePoint.x + (k.size ? k.size.width / 2 : 60));
            return k;
        });
        for (const hobj of handlerObjs) copyInto(hobj);
        for (const n of noteObjs) {
            const note = map.get(n.note.id) || copyInto(n.note);
            const af = mf.AnnotationFlow.createIn(sub);
            af.origin = note;
            af.destination = map.get(n.to.id);
            af.originConnectionIndex = 2;
            af.destinationConnectionIndex = 0;
        }
        for (const r of records) {
            r.origin = map.get(r.origin.id);
            r.destination = map.get(r.destination.id);
        }
        for (const n of noteObjs) if (!n.note.isDeleted) n.note.delete();
        for (const c of [...handlerObjs, ...chain]) c.delete();
        for (const r of records) {
            if (r.note) {
                const af = mf.AnnotationFlow.createIn(sub);
                af.origin = r.origin;
                af.destination = r.destination;
                af.originConnectionIndex = r.oi;
                af.destinationConnectionIndex = r.di;
            } else x.flow(sub, r.origin, r.destination, { originIndex: r.oi, destIndex: r.di, caseValue: r.cv, errorHandler: r.eh });
        }
        lay.invalidate();
        lay.closeGap(gap);
        lay.mark(call.container, [call]);
        lay.finish();
        x.point(end, right + 80, 200);
        const sf = { m: sub };
        x.connect(sf, { obj: start, originIndex: 1 }, copies[0]);
        x.connect(sf, { obj: copies[copies.length - 1], originIndex: 1 }, end);
        if (handlerObjs.length) L.format(sub, {}); // the handler lanes as Studio Pro draws them
        const handlerSteps = handlerObjs.filter(y => y instanceof mf.ActionActivity || y instanceof mf.LoopedActivity).length;
        return `${qn} (${copies.length} step(s)${handlerObjs.length ? `, with their error handler${handlerSteps ? ` (${handlerSteps} step(s))` : ""}` : ""}${params.length ? `, parameters ${params.map(p => `${p.name}: ${p.type}`).join(", ")}` : ""}${result ? `, returns $${result}` : ""}); ${o.microflow} calls it at [${short(call)}]`;
    }

    // ------------------------------------------------ F11 / F12: decision branches

    const isSplit = o => o instanceof mf.ExclusiveSplit || o instanceof mf.InheritanceSplit;
    const sequenceOut = (m, o) => flowsOf(m).filter(f => f.origin === o && !f.isErrorHandler);

    // Objects reachable from the starts (incl. themselves) along every flow, not going through 'stop'.
    function reachFrom(m, starts, stop) {
        const fl = flowsOf(m);
        const seen = new Set();
        const todo = starts.filter(Boolean).filter(o => o !== stop);
        todo.forEach(o => seen.add(o.id));
        while (todo.length) {
            const o = todo.pop();
            for (const f of fl) if (f.origin === o && f.destination !== stop && !seen.has(f.destination.id)) {
                seen.add(f.destination.id);
                todo.push(f.destination);
            }
        }
        return seen;
    }

    // Objects (not start, parameter or note) no line reaches: at the top level from the start event, in a loop body
    // from its first object (the one without an incoming flow; a body has one).
    function orphansOf(m) {
        const out = [];
        const scan = (coll, roots) => {
            const seen = reachFrom(m, roots, null);
            for (const o of coll.objects) {
                if (o instanceof mf.StartEvent || o instanceof mf.MicroflowParameterObject || o instanceof mf.Annotation) continue;
                if (!seen.has(o.id)) out.push(o);
                else if (o instanceof mf.LoopedActivity) {
                    const fl = flowsOf(m);
                    const firsts = o.objectCollection.objects.filter(y => !(y instanceof mf.Annotation) && !fl.some(f => f.destination === y));
                    scan(o.objectCollection, firsts.slice(0, 1));
                }
            }
        };
        scan(m.objectCollection, m.objectCollection.objects.filter(y => y instanceof mf.StartEvent));
        return out;
    }

    // Deletes objects (a loop with its body) with their flows and attached notes; merges left with one way in and
    // one way out go too (the line runs straight through).
    function deleteObjects(m, objs) {
        const ids = new Set(objs.map(y => y.id));
        for (const o of objs) if (o instanceof mf.LoopedActivity) walkObjects(o.objectCollection, y => ids.add(y.id));
        for (const fl of [...m.flows]) if (fl instanceof mf.AnnotationFlow && fl.destination && ids.has(fl.destination.id) && fl.origin instanceof mf.Annotation) {
            const others = [...m.flows].filter(g => g instanceof mf.AnnotationFlow && g.origin === fl.origin && !ids.has(g.destination.id));
            if (!others.length) objs.push(fl.origin), ids.add(fl.origin.id);
        }
        const touched = new Set();
        for (const fl of [...m.flows]) if (fl.origin && fl.destination && (ids.has(fl.origin.id) || ids.has(fl.destination.id))) {
            if (!ids.has(fl.destination.id)) touched.add(fl.destination);
            fl.delete();
        }
        let n = 0;
        for (const o of objs) if (!o.isDeleted) {
            if (o instanceof mf.ActionActivity || o instanceof mf.LoopedActivity) n++;
            o.delete();
        }
        for (const t of touched) dropMerge(m, t);
        return n;
    }

    function dropMerge(m, mg) {
        if (!(mg instanceof mf.ExclusiveMerge) || mg.isDeleted) return false;
        const inc = flowsOf(m).filter(f => f.destination === mg);
        const out = flowsOf(m).filter(f => f.origin === mg);
        if (inc.length !== 1 || out.length !== 1) return false;
        inc[0].destination = out[0].destination;
        inc[0].destinationConnectionIndex = out[0].destinationConnectionIndex;
        out[0].delete();
        mg.delete();
        return true;
    }

    async function deleteBranch(o) {
        const m = await x.flowDoc(o.microflow);
        const split = findStep(m, o.id);
        const where = `${o.microflow} [${o.id}] ${describe(split)}`;
        if (!isSplit(split)) throw new Error(`${where}: not a decision; give the id of an if, switch or ifType (steps ${o.microflow})`);
        if (o.branch === undefined) throw new Error(`${where}: say which branch: ${sequenceOut(m, split).map(f => JSON.stringify(String(x.caseLabel(f)))).join(" | ")}`);
        const before = L.lint(L.snapshot(m)).length;
        const gone = x.anchorOf(m, o.id, o.branch, where);
        const others = sequenceOut(m, split).filter(f => f !== gone);
        // the branch's own steps: reached from it, not from the other branches
        const mine = reachFrom(m, [gone.destination], split);
        const shared = reachFrom(m, others.map(f => f.destination), split);
        const doomed = [];
        walkObjects(m.objectCollection, y => mine.has(y.id) && !shared.has(y.id) && y.container === split.container && doomed.push(y));
        if (doomed.some(y => y instanceof mf.StartEvent)) throw new Error(`${where}: the branch runs back to the start; change it in Studio Pro`);
        gone.delete();
        const n = deleteObjects(m, doomed);
        const lines = [`branch '${o.branch}' deleted${n ? ` with ${n} step(s)` : ""}`];
        // a decision with one way left is no decision: the line runs straight on
        const left = sequenceOut(m, split);
        if (left.length === 1) {
            const keep = left[0];
            const label = x.caseLabel(keep);
            for (const f of flowsOf(m).filter(y => y.destination === split)) {
                f.destination = keep.destination;
                f.destinationConnectionIndex = keep.destinationConnectionIndex;
            }
            keep.delete();
            for (const fl of [...m.flows]) if (fl instanceof mf.AnnotationFlow && fl.destination === split) fl.delete();
            split.delete();
            lines.push(`the decision is gone; its '${label}' branch is now the line`);
        } else if (split instanceof mf.ExclusiveSplit && left.length) lines.push(`the decision keeps ${left.length} branches (${left.map(f => x.caseLabel(f)).join(", ")}); check that every value still has a way in Studio Pro`);
        const orphans = orphansOf(m);
        if (orphans.length) throw new Error(`${where}: deleting the branch would leave ${orphans.map(y => `[${short(y)}] ${describe(y)}`).join(", ")} without a line in; change the flow in Studio Pro`);
        if (relayoutIfWorse(m, before)) lines.push("the flow was laid out again");
        return `${where}: ${lines.join("; ")}`;
    }

    async function rerouteBranch(o) {
        const m = await x.flowDoc(o.microflow);
        const from = findStep(m, o.id);
        const where = `${o.microflow} [${o.id}] ${describe(from)}`;
        const target = findStep(m, o.to);
        if (target instanceof mf.StartEvent || target instanceof mf.MicroflowParameterObject || target instanceof mf.Annotation) throw new Error(`${where}: a flow cannot go to ${describe(target)}`);
        if (target === from) throw new Error(`${where}: 'to' is the step itself`);
        if (target.container !== from.container) throw new Error(`${where}: [${o.to}] is ${target.container.container instanceof mf.LoopedActivity ? "inside a loop" : "outside the loop"} of [${o.id}]; a flow stays on its level (into a loop: through the loop itself)`);
        const fl = x.anchorOf(m, o.id, o.branch, where);
        if (fl.destination === target) throw new Error(`${where}: the flow already goes to [${o.to}]`);
        if (reachFrom(m, [target], null).has(from.id)) throw new Error(`${where}: [${o.to}] ${describe(target)} leads back to [${o.id}]: that makes a cycle; use a loop ({ "action": "loop", "while": ... })`);
        const before = L.lint(L.snapshot(m)).length;
        const old = fl.destination;
        // a step with a line in already gets a merge in front (Studio Pro joins lines with a merge)
        let dest = target;
        const into = flowsOf(m).filter(f => f.destination === target && !f.isErrorHandler);
        if (into.length && !(target instanceof mf.ExclusiveMerge)) {
            const mg = mf.ExclusiveMerge.createIn(target.container);
            const p = target.relativeMiddlePoint;
            const w = target.size ? target.size.width : 120;
            x.point(mg, p.x - w / 2 - 60, p.y);
            x.size(mg, 60, 60);
            for (const f of into) f.destination = mg;
            x.flow(m, mg, target, { originIndex: 1, destIndex: 3 });
            dest = mg;
        }
        fl.destination = dest;
        const lines = [`'${o.branch !== undefined ? o.branch : "the line"}' now goes to [${o.to}] ${describe(target)}${dest !== target ? " (through a new merge)" : ""}`];
        // what the old path reached and nobody reaches now
        const orphans = orphansOf(m);
        if (orphans.length) {
            if (o.deleteOrphans !== true) throw new Error(`${where}: then nothing reaches ${orphans.map(y => `[${short(y)}] ${describe(y)}`).join(", ")}; add "deleteOrphans": true to delete them, or reroute another flow to them first`);
            lines.push(`deleted ${deleteObjects(m, orphans)} step(s) nobody reaches`);
        }
        dropMerge(m, old);
        // the variables the steps after the target use must exist on the new way too
        const after = reachFrom(m, [target], null);
        const problems = [];
        walkObjects(m.objectCollection, y => {
            if (after.has(y.id) && y.container === target.container && movable(y)) problems.push(...orderProblems(m, y));
        });
        if (problems.length) throw new Error(`${where}: on the new way ${[...new Set(problems)].slice(0, 3).join("; ")}`);
        if (relayoutIfWorse(m, before)) lines.push("the flow was laid out again");
        return `${where}: ${lines.join("; ")}`;
    }

    async function addAnnotation(o) {
        const m = await x.flowDoc(o.microflow);
        // the note moves up until it covers nothing (flow-layout.js)
        const lay = L.begin(m);
        if (o.to) {
            const step = findStep(m, o.to);
            const note = x.annotate(m, step.container, String(o.text), step);
            lay.mark(step.container, [note]);
            lay.finish();
            return `${o.microflow}: note on [${o.to}] ${describe(step)}`;
        }
        const objs = m.objectCollection.objects.filter(y => !(y instanceof mf.Annotation));
        const minX = Math.min(...objs.map(y => y.relativeMiddlePoint.x), 100);
        const minY = Math.min(...objs.map(y => y.relativeMiddlePoint.y), 200);
        const note = x.annotate(m, m.objectCollection, String(o.text), null, { x: minX + 100, y: minY - 100 });
        lay.mark(m.objectCollection, [note]);
        lay.finish();
        return `${o.microflow}: free note`;
    }

    async function formatMicroflow(o) {
        const m = await x.flowDoc(o.microflow);
        const before = L.lint(L.snapshot(m));
        L.format(m, { keepAnnotations: o.keepAnnotations === true });
        const after = L.lint(L.snapshot(m));
        const n = list => `${list.filter(i => i.level === "error").length} error(s), ${list.filter(i => i.level === "warning").length} warning(s)`;
        return `${o.microflow}: laid out again (LAYOUT CHECK before ${n(before)}, after ${n(after)})`;
    }

    const impl = { moveAction, extractMicroflow, addAnnotation, formatMicroflow, deleteBranch, rerouteBranch };

    const checks = {
        async deleteBranch(o) {
            const m = await x.flowDoc(o.microflow);
            const split = findStep(m, o.id, true);
            const r = orphansOf(m).map(y => `${o.microflow}: [${short(y)}] ${describe(y)} has no line in`);
            if (split && isSplit(split) && sequenceOut(m, split).some(f => String(x.caseLabel(f)).split(", ").some(l => l.toLowerCase() === String(o.branch).toLowerCase()))) r.push(`${o.microflow}: [${o.id}] still has branch '${o.branch}'`);
            return r;
        },
        async rerouteBranch(o) {
            const m = await x.flowDoc(o.microflow);
            const target = findStep(m, o.to, true);
            const r = orphansOf(m).map(y => `${o.microflow}: [${short(y)}] ${describe(y)} has no line in`);
            if (!target) r.push(`${o.microflow}: step ${o.to} is missing`);
            else if (!flowsOf(m).some(f => f.destination === target || (f.destination instanceof mf.ExclusiveMerge && flowsOf(m).some(g => g.origin === f.destination && g.destination === target)))) r.push(`${o.microflow}: nothing goes to [${o.to}]`);
            return r;
        },
        async moveAction(o) {
            const m = await x.flowDoc(o.microflow);
            const step = findStep(m, o.id, true);
            if (!step) return [`${o.microflow}: step ${o.id} is missing`];
            const fl = flowsOf(m);
            return fl.some(f => f.destination === step) && fl.some(f => f.origin === step) ? [] : [`${o.microflow}: step ${o.id} is not on a line`];
        },
        async extractMicroflow(o) {
            const m = await x.flowDoc(o.microflow);
            const qn = `${o.module || o.microflow.split(".")[0]}.${o.name}`;
            if (!(await h.exists(qn))) return [`${qn} missing`];
            let calls = false;
            walkObjects(m.objectCollection, y => {
                const a = y.action;
                const c = a && (a.microflowCall || a.nanoflowCall);
                if (c && (c.microflowQualifiedName || c.nanoflowQualifiedName) === qn) calls = true;
            });
            return calls ? [] : [`${o.microflow} does not call ${qn}`];
        },
        async formatMicroflow(o) {
            const m = await x.flowDoc(o.microflow);
            return L.lint(L.snapshot(m)).filter(i => i.level === "error").map(i => `${o.microflow}: ${i.text}`);
        },
        async addAnnotation(o) {
            const m = await x.flowDoc(o.microflow);
            const text = String(o.text).replace(/\r?\n/g, "\r\n");
            let found = false;
            walkObjects(m.objectCollection, y => (found = found || (y instanceof mf.Annotation && y.caption === text)));
            return found ? [] : [`${o.microflow} has no note '${String(o.text).slice(0, 30)}'`];
        }
    };

    return { impl, checks, varsOf };
}

module.exports = { makeFlowEdit, FLOW_EDIT_OPS };
