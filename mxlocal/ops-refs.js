"use strict";
// Ops that change something many documents refer to, using the reference graph (refs.js) to find every user:
//   changeMicroflow  parameters (add / remove / rename / type), return type and value of a microflow, nanoflow or
//                    rule; every caller is updated (call steps, rule decisions, page buttons, data sources, on-change)
//                    or the change is refused with the callers that cannot follow.
const sdk = require("mendixmodelsdk");
const { validName, fail, noDollar } = require("./ops-util");
const refs = require("./refs");

const { microflows: mf, pages, datatypes, codeactions: ca } = sdk;
// changeMicroflow settings (F1/F2), in the order they apply
const SETTINGS = ["allowConcurrentExecution", "concurrencyErrorMessage", "concurrencyErrorMicroflow", "applyEntityAccess", "markAsUsed", "url", "toolbox", "workflowToolbox"];

const REF_OPS = {
    changeMicroflow: {
        doc: "Change the parameters, return type or return value of a microflow, nanoflow or rule and update every caller; also its settings (concurrent execution, entity access, mark as used, URL, toolbox action) (call steps, rule decisions, page buttons, data sources, on-change). Run usages first; rename the flow itself with rename.",
        fields: {
            microflow: "R Module.Microflow, Module.Nanoflow or Module.Rule",
            addParameters: "optional [ { \"name\": ..., \"type\": ..., \"value\": \"expression every caller passes\" } ] (value required when it has callers)",
            removeParameters: "optional [ \"Name\" ]: also dropped from every caller (refused while the flow still uses it)",
            renameParameters: "optional { \"Old\": \"New\" }: callers and $Old in the flow follow",
            parameterTypes: "optional { \"Name\": \"new type\" }: callers keep their argument (listed to check)",
            returns: "optional new return type (Nothing for none)",
            returnValue: "optional expression every end event returns (required when returns gives a value)",
            allowConcurrentExecution: "optional microflow: true/false (false: a second call while one runs gets the error message or the error microflow)",
            concurrencyErrorMessage: "optional microflow with allowConcurrentExecution false: text shown to the user (instead of an error microflow)",
            concurrencyErrorMicroflow: "optional microflow with allowConcurrentExecution false: Module.Microflow run instead (\"\" = none)",
            applyEntityAccess: "optional microflow or rule: true/false (true: the access rules of the user apply in this flow)",
            markAsUsed: "optional true/false: the flow counts as used (no 'unused' warning)",
            url: "optional microflow (Mendix 10.1+): URL that runs it, e.g. \"/orders/{Order}\" (\"\" = none)",
            toolbox: "optional microflow: { \"caption\": ..., \"category\": ..., \"icon\": \"Module.Images.Name\" (a PNG of an image collection; 16x16 looks best) } shows it in the Studio Pro toolbox as an action of other microflows; \"none\" removes it",
            workflowToolbox: "optional microflow: the same as toolbox, for the workflow toolbox (a call microflow activity)"
        }
    }
};

// Caller kinds by the edge that names the flow: storage Type.Key -> what can be updated
const CALLS = {
    "MicroflowCall.Microflow": "call step",
    "NanoflowCall.Nanoflow": "call step",
    "RuleCall.Microflow": "rule decision",
    "MicroflowSettings.Microflow": "page",
    "CallNanoflowClientAction.Nanoflow": "page",
    "NanoflowSource.Nanoflow": "data source"
};
const PAGE_UNIT = /^Forms\$(Page|Snippet|Layout)$/;

function makeRefOps(h, flows) {
    const { model, client, get, text } = h;
    const x = flows.internals;
    const short = o => o.id.slice(0, 8);
    const typeText = t => !t || t instanceof datatypes.VoidType ? "Nothing" : t instanceof datatypes.ObjectType ? t.entityQualifiedName : t instanceof datatypes.ListType ? `List(${t.entityQualifiedName})` : t instanceof datatypes.EnumerationType ? `Enum(${t.enumerationQualifiedName})` : t.structureTypeName.split("$")[1].replace(/Type$/, "");

    // The graph of the model as it is now (after the ops before this one).
    async function graph() {
        await model.flushChanges();
        return refs.graph(client);
    }

    // Name of the widget (or step) an element sits in, for messages.
    function placeOf(el) {
        for (let c = el; c; c = c.container) {
            if (c instanceof mf.ActionActivity || c instanceof mf.ExclusiveSplit || c instanceof mf.LoopedActivity) return `step ${short(c)}`;
            if (c instanceof mf.EndEvent) return `end event ${short(c)}`;
            if (c instanceof pages.Widget && c.name) return `widget ${c.name}`;
            if (c.structureTypeName && /^(Pages|Forms)\$/.test(c.structureTypeName) && typeof c.name === "string" && c.name && !(c instanceof pages.Page)) return `widget ${c.name}`;
        }
        return "";
    }

    // Elements in a loaded document that call qn: { el (holds parameterMappings), kind, action (call step), place }
    function callsIn(doc, qn) {
        const out = [];
        doc.traverse(el => {
            if (el instanceof mf.MicroflowCall && el.microflowQualifiedName === qn) out.push({ el, kind: "call", action: el.container, place: placeOf(el), Mapping: mf.MicroflowCallParameterMapping, value: "argument" });
            else if (el instanceof mf.NanoflowCall && el.nanoflowQualifiedName === qn) out.push({ el, kind: "call", action: el.container, place: placeOf(el), Mapping: mf.NanoflowCallParameterMapping, value: "argument" });
            else if (el instanceof mf.RuleCall && el.ruleQualifiedName === qn) out.push({ el, kind: "rule", place: placeOf(el), Mapping: mf.RuleCallParameterMapping, value: "argument" });
            else if (el instanceof pages.MicroflowSettings && el.microflowQualifiedName === qn) out.push({ el, kind: el.container instanceof pages.MicroflowSource ? "source" : "button", place: placeOf(el), Mapping: pages.MicroflowParameterMapping, value: "expression" });
            else if ((el instanceof pages.CallNanoflowClientAction || el instanceof pages.NanoflowSource) && el.nanoflowQualifiedName === qn) out.push({ el, kind: el instanceof pages.NanoflowSource ? "source" : "button", place: placeOf(el), Mapping: pages.NanoflowParameterMapping, value: "expression" });
        });
        return out;
    }

    // $Old -> $New (and variable-name fields equal to Old) in every string property of the flow.
    function renameVariable(flow, from, to) {
        let n = 0;
        const re = new RegExp(`\\$${from}(?![A-Za-z0-9_])`, "g");
        flow.traverse(el => {
            if (el === flow) return;
            for (const p of el.allProperties()) {
                if (typeof p.qualifiedName === "function" || typeof p.qualifiedNames === "function" || !p.name) continue;
                let v;
                try {
                    v = el[p.name];
                } catch (e) {
                    continue;
                }
                if (typeof v !== "string" || !v || /^(name|documentation|caption)$/.test(p.name)) continue;
                let nv = v;
                if (/VariableName$/.test(p.name)) nv = v === from ? to : v;
                else if (v.includes("$" + from)) nv = v.replace(re, "$" + to);
                if (nv !== v) {
                    el[p.name] = nv;
                    n++;
                }
            }
        });
        return n;
    }

    // Steps of the flow that still use $name.
    function usesOfVariable(flow, name, newReturn) {
        const re = new RegExp(`\\$${name}(?![A-Za-z0-9_])`);
        const hits = new Set();
        flow.traverse(el => {
            if (el instanceof mf.MicroflowParameterObject) return;
            for (const p of el.allProperties()) {
                if (newReturn && el instanceof mf.EndEvent && p.name === "returnValue") continue; // replaced by this op
                if (typeof p.qualifiedName === "function" || typeof p.qualifiedNames === "function" || !p.name || /^(name|documentation|caption)$/.test(p.name)) continue;
                let v;
                try {
                    v = el[p.name];
                } catch (e) {
                    continue;
                }
                if (typeof v === "string" && (re.test(v) || (/VariableName$/.test(p.name) && v === name))) hits.add(placeOf(el) || "the flow");
            }
        });
        return [...hits];
    }

    // F1/F2: the settings of the flow (Properties pane): concurrency, entity access, mark as used, URL, toolbox.
    // Applied first: a refused setting changes nothing.
    async function settings(flow, kind, o, qn) {
        const given = SETTINGS.filter(k => o[k] !== undefined);
        if (!given.length) return [];
        const micro = kind === "microflow";
        const only = { allowConcurrentExecution: micro, concurrencyErrorMessage: micro, concurrencyErrorMicroflow: micro, url: micro, toolbox: micro, workflowToolbox: micro, applyEntityAccess: kind !== "nanoflow", markAsUsed: true };
        for (const k of given) if (!only[k]) throw new Error(`${qn}: a ${kind} has no '${k}' (${k === "applyEntityAccess" ? "a nanoflow always runs with the access rules of the user" : "only microflows have it"})`);
        const yes = (k, v) => {
            if (typeof v === "boolean") return v;
            if (/^(true|false)$/i.test(String(v))) return /^true$/i.test(String(v));
            throw new Error(`${qn}: ${k} is true or false, got ${JSON.stringify(v)}`);
        };
        const lines = [];
        // concurrency: the message and the microflow exclude each other (Studio Pro shows one of them)
        const allow = o.allowConcurrentExecution === undefined ? flow.allowConcurrentExecution : yes("allowConcurrentExecution", o.allowConcurrentExecution);
        if ((o.concurrencyErrorMessage !== undefined || (o.concurrencyErrorMicroflow !== undefined && o.concurrencyErrorMicroflow !== "")) && allow) throw new Error(`${qn}: concurrencyErrorMessage / concurrencyErrorMicroflow apply only when concurrent execution is not allowed: add "allowConcurrentExecution": false`);
        if (o.concurrencyErrorMessage !== undefined && o.concurrencyErrorMicroflow) throw new Error(`${qn}: give concurrencyErrorMessage or concurrencyErrorMicroflow, not both (Studio Pro: "Show message" or "Call microflow")`);
        let errorFlow;
        if (o.concurrencyErrorMicroflow) {
            errorFlow = await get(String(o.concurrencyErrorMicroflow));
            if (!(errorFlow instanceof mf.Microflow)) throw new Error(`${qn}: concurrencyErrorMicroflow must be a microflow, ${o.concurrencyErrorMicroflow} is not`);
            if (errorFlow === flow) throw new Error(`${qn}: concurrencyErrorMicroflow cannot be the microflow itself`);
            const ps = errorFlow.objectCollection.objects.filter(p => p instanceof mf.MicroflowParameterObject);
            const mine = new Map(flow.objectCollection.objects.filter(p => p instanceof mf.MicroflowParameterObject).map(p => [p.name, typeText(p.variableType)]));
            const odd = ps.filter(p => mine.get(p.name) !== typeText(p.variableType));
            if (odd.length) throw new Error(`${qn}: ${o.concurrencyErrorMicroflow} gets the parameters of ${qn} by name and type; it has ${odd.map(p => `$${p.name} (${typeText(p.variableType)})`).join(", ")} that ${qn} does not have`);
        }
        let url;
        if (o.url !== undefined) {
            url = String(o.url).trim();
            if (url && !/^\/?[A-Za-z0-9_\-./{}~]+$/.test(url)) throw new Error(`${qn}: url '${o.url}' may hold letters, digits, - _ . / ~ and {Parameter} only, e.g. "/orders/{Order}"`);
            if (url && !url.startsWith("/")) url = "/" + url;
            const names = new Set(flow.objectCollection.objects.filter(p => p instanceof mf.MicroflowParameterObject).map(p => p.name));
            for (const m of url.matchAll(/\{([^}]*)\}/g)) {
                const n = m[1].split("/")[0];
                if (!names.has(n)) fail(`${qn}: url names {${m[1]}}, but ${qn} has no parameter '${n}'`, n, [...names]);
            }
        }
        const boxes = {};
        for (const k of ["toolbox", "workflowToolbox"]) {
            const v = o[k];
            if (v === undefined) continue;
            if (v === null || v === "none" || v === false) {
                boxes[k] = null;
                continue;
            }
            if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${qn}: ${k} is { "caption": "...", "category": "...", "icon": "Module.Images.Name" } or "none"`);
            for (const f of Object.keys(v)) if (!["caption", "category", "icon"].includes(f)) fail(`${qn}: ${k} has no field '${f}'`, f, ["caption", "category", "icon"]);
            if (!String(v.caption || "").trim()) throw new Error(`${qn}: ${k} needs a caption (the name in the toolbox)`);
            boxes[k] = { caption: String(v.caption), category: String(v.category || ""), icon: v.icon ? await imageOf(String(v.icon), `${qn} ${k}`) : null };
        }
        // all checked: apply
        if (o.allowConcurrentExecution !== undefined) {
            flow.allowConcurrentExecution = allow;
            lines.push(`concurrent execution ${allow ? "allowed" : "not allowed"}`);
            if (allow) flow.concurrencyErrorMicroflow = null;
        }
        if (o.concurrencyErrorMessage !== undefined) {
            await text(flow.concurrencyErrorMessage, o.concurrencyErrorMessage);
            flow.concurrencyErrorMicroflow = null;
            lines.push(`on a second call: message '${typeof o.concurrencyErrorMessage === "object" ? Object.values(o.concurrencyErrorMessage)[0] : o.concurrencyErrorMessage}'`);
        }
        if (o.concurrencyErrorMicroflow !== undefined) {
            flow.concurrencyErrorMicroflow = errorFlow || null;
            if (errorFlow) await text(flow.concurrencyErrorMessage, "");
            lines.push(errorFlow ? `on a second call: ${errorFlow.qualifiedName}` : "no concurrency error microflow");
        }
        if (o.applyEntityAccess !== undefined) {
            flow.applyEntityAccess = yes("applyEntityAccess", o.applyEntityAccess);
            lines.push(`apply entity access ${flow.applyEntityAccess ? "on" : "off"}`);
        }
        if (o.markAsUsed !== undefined) {
            flow.markAsUsed = yes("markAsUsed", o.markAsUsed);
            lines.push(`mark as used ${flow.markAsUsed ? "on" : "off"}`);
        }
        if (url !== undefined) {
            flow.url = url;
            lines.push(url ? `URL ${url}` : "no URL");
            if (url) client.warnFirst(`${qn}: microflow URL first use by ops (no Studio Pro sample in the test projects); check it in Studio Pro`);
        }
        for (const [k, b] of Object.entries(boxes)) {
            const prop = k === "toolbox" ? "microflowActionInfo" : "workflowActionInfo";
            if (!b) {
                if (flow[prop]) flow[prop].delete();
                lines.push(`not in the ${k === "toolbox" ? "" : "workflow "}toolbox`);
                continue;
            }
            const info = flow[prop] || (k === "toolbox" ? ca.MicroflowActionInfo.createInMicroflowUnderMicroflowActionInfo(flow) : ca.MicroflowActionInfo.createInMicroflowUnderWorkflowActionInfo(flow));
            info.caption = b.caption;
            info.category = b.category;
            // the icon: the PNG bytes of an image of an image collection (Studio Pro keeps the bytes, not the image)
            if (b.icon) {
                if (!/png/i.test(b.icon.imageFormat ? b.icon.imageFormat.name : "")) throw new Error(`${qn}: ${k} icon must be a PNG image (${b.icon.qualifiedName} is ${b.icon.imageFormat ? b.icon.imageFormat.name : "?"})`);
                info.iconData = info.imageData = b.icon.imageData;
            }
            lines.push(`${k === "toolbox" ? "" : "workflow "}toolbox action '${b.caption}'${b.category ? ` in ${b.category}` : ""}`);
            client.warnFirst(`${qn}: CodeActions$MicroflowActionInfo on a microflow: first use by ops (the test projects have it only on Java actions); check the toolbox in Studio Pro`);
        }
        return lines;
    }

    async function imageOf(qn, where) {
        const parts = qn.split(".");
        const all = [];
        for (const c of model.allImageCollections()) {
            const col = c.isLoaded ? c : await c.load();
            for (const img of col.images) {
                if (`${col.qualifiedName}.${img.name}` === qn) return img;
                all.push(`${col.qualifiedName}.${img.name}`);
            }
        }
        return fail(`${where}: no image '${qn}'${parts.length !== 3 ? " (write Module.ImageCollection.Image)" : ""}`, qn, all);
    }

    async function changeMicroflow(o) {
        const qn = String(o.microflow);
        const flow = await flows.flowDoc(qn);
        const kind = flow instanceof mf.Rule ? "rule" : flow instanceof mf.Nanoflow ? "nanoflow" : "microflow";
        const params = new Map(flow.objectCollection.objects.filter(p => p instanceof mf.MicroflowParameterObject).map(p => [p.name, p]));
        const names = [...params.keys()];
        const adds = [].concat(o.addParameters || []);
        const removes = [].concat(o.removeParameters || []).map(noDollar);
        const renames = Object.entries(o.renameParameters || {}).map(([a, b]) => [noDollar(a), noDollar(b)]);
        const retypes = Object.entries(o.parameterTypes || {}).map(([a, b]) => [noDollar(a), b]);
        const settingsLines = await settings(flow, kind, o, qn);
        if (!adds.length && !removes.length && !renames.length && !retypes.length && o.returns === undefined && o.returnValue === undefined) {
            if (settingsLines.length) return `${qn} (${kind}): ${settingsLines.join("; ")}`;
            throw new Error(`nothing to change: give addParameters, removeParameters, renameParameters, parameterTypes, returns or returnValue, or a setting (${SETTINGS.join(", ")})`);
        }
        const has = n => params.has(n) || fail(`${qn} has no parameter '${n}'`, n, names);
        removes.forEach(has);
        renames.forEach(([a]) => has(a));
        retypes.forEach(([a]) => has(a));
        const after = new Set(names.filter(n => !removes.includes(n)).map(n => (renames.find(r => r[0] === n) || [n, n])[1]));
        for (const [, b] of renames) {
            validName(b, "parameter name");
            if (names.includes(b) && !renames.some(r => r[0] === b) && !removes.includes(b)) throw new Error(`${qn} already has a parameter '${b}'`);
        }
        for (const [i, a] of adds.entries()) {
            if (!a || typeof a !== "object" || !a.name || !a.type) throw new Error(`addParameters[${i + 1}] needs name and type, e.g. { "name": "Note", "type": "String", "value": "''" }`);
            validName(a.name, "parameter name");
            if (after.has(a.name)) throw new Error(`${qn} already has a parameter '${a.name}'${removes.includes(a.name) ? " (removed and added again: use parameterTypes to change its type)" : ""}`);
            after.add(a.name);
        }
        // the flow must not use a parameter it loses
        for (const r of removes) {
            const used = usesOfVariable(flow, r, o.returnValue !== undefined);
            if (used.length) throw new Error(`${qn} still uses $${r} (${used.slice(0, 5).join(", ")}): change those steps first (steps ${qn}), then remove it`);
        }

        // callers from the graph
        const g = await graph();
        const edges = g.usesOf(qn, false).filter(e => e.unit !== (g.unitOf(qn) || {}).id || e.what in CALLS);
        const paramChange = adds.length || removes.length;
        const refused = [];
        const docs = new Map();
        for (const e of edges) {
            const u = g.units.find(x => x.id === e.unit);
            const short2 = e.what;
            const updatable = CALLS[short2] && (u.type.startsWith("Microflows$") || PAGE_UNIT.test(u.type));
            if (updatable) {
                if (!docs.has(u.label)) docs.set(u.label, u);
                continue;
            }
            if (paramChange) refused.push(`${e.doc}${e.place ? " " + e.place : ""} (${short2}): ${/Menus|Navigation/.test(u.type) ? "a menu item or home page passes no parameters" : /ScheduledEvent/.test(short2) ? "a scheduled event passes no parameters" : /Settings/.test(u.type) ? "after-startup / before-shutdown flows take no parameters" : /DomainModel/.test(u.type) ? "an event handler or calculated attribute passes only its object" : "it maps parameters by itself"}`);
        }
        const unsetValue = adds.filter(a => a.value === undefined);
        if (unsetValue.length && docs.size) refused.push(`addParameters ${unsetValue.map(a => a.name).join(", ")}: give "value" (the expression ${docs.size} calling document(s) pass: ${[...docs.keys()].slice(0, 5).join(", ")})`);

        // return type
        let newType = null;
        if (o.returns !== undefined) {
            newType = /^(nothing|void|none|)$/i.test(String(o.returns)) ? datatypes.VoidType.create(model) : await h.dataType(o.returns);
            if (kind === "rule" && !(newType instanceof datatypes.BooleanType || newType instanceof datatypes.EnumerationType)) throw new Error(`${qn}: a rule returns Boolean or Enum(Module.Enumeration)`);
            if (!(newType instanceof datatypes.VoidType) && o.returnValue === undefined) throw new Error(`${qn}: returns ${o.returns}, so returnValue is required (every end event returns it)`);
        }
        const loaded = new Map();
        for (const [label] of docs) loaded.set(label, await get(label));
        const callSites = [];
        for (const [label, doc] of loaded) for (const c of callsIn(doc, qn)) callSites.push({ ...c, doc: label });
        if (newType) {
            const was = typeText(flow.microflowReturnType);
            const now = typeText(newType);
            if (was !== now) {
                for (const c of callSites) {
                    if (c.kind === "source") refused.push(`${c.doc} ${c.place}: a data source needs ${was} (returns ${now} would break it)`);
                    if (c.kind === "call" && now === "Nothing" && c.action.useReturnVariable) refused.push(`${c.doc} ${c.place}: uses the result as $${c.action.outputVariableName}`);
                }
                for (const e of edges) if (/DomainModel/.test((g.units.find(u => u.id === e.unit) || {}).type || "")) refused.push(`${e.doc} ${e.place}: an event handler or calculated attribute needs its return type`);
            }
        }
        if (refused.length) throw new Error(`REFUSED, callers that cannot follow (change them in Studio Pro or pick another flow):\n      ${[...new Set(refused)].join("\n      ")}`);

        // the flow itself
        const lines = [];
        for (const [a, b] of renames) {
            const p = params.get(a);
            p.name = b; // by-name references (callers' mappings, URL parameters) follow: client.rename
            const n = renameVariable(flow, a, b);
            lines.push(`renamed $${a} -> $${b} (${n} expression(s) in the flow)`);
        }
        for (const [a, t] of retypes) {
            const p = params.get((renames.find(r => r[0] === a) || [a, a])[1]) || params.get(a);
            p.variableType = await h.dataType(t);
            lines.push(`$${a} is now ${t}`);
        }
        for (const r of removes) params.get(r).delete();
        if (removes.length) lines.push(`removed ${removes.map(r => "$" + r).join(", ")}`);
        const existing = flow.objectCollection.objects.filter(p => p instanceof mf.MicroflowParameterObject);
        let xMax = Math.max(100, ...existing.map(p => p.relativeMiddlePoint.x));
        const created = [];
        for (const a of adds) {
            const po = mf.MicroflowParameterObject.createIn(flow.objectCollection);
            po.name = a.name;
            po.variableType = await h.dataType(a.type);
            xMax += 120;
            x.point(po, xMax, existing.length ? existing[0].relativeMiddlePoint.y : 80);
            x.size(po, 30, 30);
            created.push(po);
        }
        if (adds.length) lines.push(`added ${adds.map(a => `$${a.name} (${a.type})`).join(", ")}`);
        if (newType) {
            flow.microflowReturnType = newType;
            lines.push(`returns ${typeText(newType)}`);
        }
        if (o.returnValue !== undefined || (newType && newType instanceof datatypes.VoidType)) {
            const ends = [];
            x.walkObjects(flow.objectCollection, el => el instanceof mf.EndEvent && ends.push(el));
            for (const end of ends) end.returnValue = newType instanceof datatypes.VoidType ? "" : String(o.returnValue);
            if (o.returnValue !== undefined && !(newType instanceof datatypes.VoidType)) lines.push(`returns ${o.returnValue} at ${ends.length} end event(s)`);
        }

        // callers
        const changed = [];
        for (const c of callSites) {
            const what = [];
            for (const r of removes) {
                for (const m of [...c.el.parameterMappings].filter(m => m.parameterQualifiedName === `${qn}.${r}`)) m.delete();
                what.push(`-${r}`);
            }
            for (const [i, a] of adds.entries()) {
                const m = c.Mapping.create(model);
                c.el.parameterMappings.push(m);
                m.parameter = created[i];
                m[c.value] = String(a.value);
                what.push(`+${a.name} = ${a.value}`);
            }
            for (const [a, b] of renames) if (c.el.parameterMappings.some(m => m.parameterQualifiedName === `${qn}.${b}`)) what.push(`${a}->${b}`);
            for (const [a] of retypes) what.push(`check the argument of ${a}`);
            if (newType && c.kind === "call" && c.action.useReturnVariable) what.push(`check $${c.action.outputVariableName} (now ${typeText(newType)})`);
            if (what.length) changed.push(`${c.doc} ${c.place} (${c.kind}): ${what.join(", ")}`);
        }
        if (adds.some(a => a.value !== undefined) && callSites.some(c => c.kind === "button" || c.kind === "source")) {
            client.warn(`${qn}: page parameter mappings with an expression: check the new arguments of the page callers in Studio Pro`);
        }
        lines.push(...settingsLines);
        return `${qn} (${kind}): ${lines.join("; ")}` + (changed.length ? `\n      CALLERS UPDATED (${changed.length}):\n        ${changed.join("\n        ")}` : "\n      no callers to update");
    }

    // After apply: the parameters and every caller's mappings match.
    async function checkChangeMicroflow(o) {
        const qn = String(o.microflow);
        const flow = await flows.flowDoc(qn);
        const names = flow.objectCollection.objects.filter(p => p instanceof mf.MicroflowParameterObject).map(p => p.name).sort();
        const want = new Set(names);
        const r = [];
        const flag = (k, prop) => o[k] !== undefined && flow[prop] !== /^true$/i.test(String(o[k])) && r.push(`${qn} ${k} is ${flow[prop]}`);
        flag("allowConcurrentExecution", "allowConcurrentExecution");
        flag("applyEntityAccess", "applyEntityAccess");
        flag("markAsUsed", "markAsUsed");
        if (o.concurrencyErrorMicroflow !== undefined && (flow.concurrencyErrorMicroflowQualifiedName || "") !== String(o.concurrencyErrorMicroflow)) r.push(`${qn} concurrency error microflow is ${flow.concurrencyErrorMicroflowQualifiedName || "none"}`);
        if (typeof o.concurrencyErrorMessage === "string" && !flow.concurrencyErrorMessage.translations.some(t => t.text === o.concurrencyErrorMessage)) r.push(`${qn} concurrency error message is not '${o.concurrencyErrorMessage}'`);
        if (o.url !== undefined && flow.url.replace(/^\//, "") !== String(o.url).trim().replace(/^\//, "")) r.push(`${qn} url is '${flow.url}'`);
        for (const [k, prop] of [["toolbox", "microflowActionInfo"], ["workflowToolbox", "workflowActionInfo"]]) {
            if (o[k] === undefined) continue;
            const info = flow[prop];
            if (typeof o[k] === "object" && o[k] ? !info || info.caption !== String(o[k].caption) || info.category !== String(o[k].category || "") : info) r.push(`${qn} ${k} is ${info ? `'${info.caption}'` : "none"}`);
        }
        for (const a of o.addParameters || []) if (!want.has(a.name)) r.push(`${qn} lacks $${a.name}`);
        for (const n of o.removeParameters || []) if (want.has(noDollar(n))) r.push(`${qn} still has $${n}`);
        for (const [, b] of Object.entries(o.renameParameters || {})) if (!want.has(noDollar(b))) r.push(`${qn} lacks $${b}`);
        const g = refs.graph(client);
        const docs = new Set(g.usesOf(qn, false).filter(e => e.what in CALLS).map(e => e.doc));
        for (const label of docs) {
            let doc;
            try {
                doc = await get(label);
            } catch (e) {
                continue;
            }
            for (const c of callsIn(doc, qn)) {
                const mapped = c.el.parameterMappings.map(m => String(m.parameterQualifiedName).split(".").pop()).sort();
                const extra = mapped.filter(m => !want.has(m));
                const lacking = c.kind === "call" || c.kind === "rule" || (o.addParameters || []).length ? names.filter(n => !mapped.includes(n) && (o.addParameters || []).some(a => a.name === n)) : [];
                if (extra.length || lacking.length) r.push(`${label} ${c.place}: maps ${mapped.join(", ") || "nothing"}, parameters are ${names.join(", ") || "none"}`);
            }
        }
        return r;
    }

    return { impl: { changeMicroflow }, checks: { changeMicroflow: checkChangeMicroflow } };
}

module.exports = { makeRefOps, REF_OPS };
