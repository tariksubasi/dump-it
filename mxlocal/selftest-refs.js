"use strict";
// selftest phase R: the reference graph (refs.js) and the ops built on it, on the selftest's copy.
//   usages: every by-name reference the Model SDK sees in every unit must be in the graph; known expression and
//           XPath references of the selftest's own flows; timings (cold, warm)
//   unused: a new orphan microflow / attribute / enumeration value is listed, used and entry-point ones are not
// Later phases of this file add changeMicroflow, copyDocument and moveEntity.
const refs = require("./refs");

// Every (unit, qualified name) pair of by-name references the Model SDK sees.
async function sdkPairs(model) {
    const pairs = new Set();
    for (const u of model.allUnits()) {
        if (!u.isLoadable || /^Projects\$(Folder|Module|Project)/.test(u.structureTypeName)) continue;
        const full = u.isLoaded ? u : await u.load();
        full.traverse(el => {
            for (const p of el.allProperties()) {
                if (typeof p.qualifiedName === "function") {
                    const q = p.qualifiedName();
                    if (q) pairs.add(`${el.unit.id}|${q}`);
                } else if (typeof p.qualifiedNames === "function") for (const q of p.qualifiedNames()) if (q) pairs.add(`${el.unit.id}|${q}`);
            }
        });
    }
    return pairs;
}

function timed(fn) {
    const t = process.hrtime.bigint();
    const r = fn();
    return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 };
}

async function usagesPhase(x) {
    const { reopen, copy, mod, T, check } = x;
    const E = `${mod}.${T}`;
    const problems = [];
    // cold: no cached references (refs dropped from the cache), then warm: a new process would read them from cache.bin
    const s = await reopen(copy);
    for (const e of s.ctx.project.cache.units.values()) delete e.refs;
    const cold = timed(() => new refs.Graph(s.client));
    const s2 = await reopen(copy);
    const warm = timed(() => new refs.Graph(s2.client));
    const g = warm.r;
    const have = new Set(g.edges.filter(e => e.kind === "ref").map(e => `${e.unit}|${e.to}`));
    const sdk = await sdkPairs(s2.model);
    const missing = [...sdk].filter(p => !have.has(p));
    if (missing.length) problems.push(`${missing.length} by-name reference(s) the SDK sees are missing, e.g. ${missing.slice(0, 3).map(p => `${s2.client.label(p.split("|")[0])} -> ${p.split("|")[1]}`).join(", ")}`);
    const q = timed(() => refs.usages(s2.client, `${E}.Count`));
    const text = q.r;
    const expect = [
        [`${E}.Count`, `${E}_Main`, /expression ChangeActionItem\.Value|expression ExpressionSplitCondition/], // $It/Count: loop variable over a retrieve
        [`${E}.Flag`, `${E}_Main`, /xpath DatabaseRetrieveSource/], // [Flag = true()]
        [`${E}_Sub`, `${E}_Main`, /step \w{8} \(MicroflowCallAction\): MicroflowCall\.Microflow/],
        [`${E}_Sub`, `${mod} [DomainModel]`, /event handler/],
        [`${E}_Job`, `${E}_Nightly`, /ScheduledEvent\.Microflow/],
        [`${E}Status.Open`, null, null]
    ];
    for (const [target, doc, place] of expect) {
        let out;
        try {
            out = refs.usages(s2.client, target);
        } catch (e) {
            problems.push(`usages ${target}: ${e.message}`);
            continue;
        }
        if (!doc) continue;
        const lines = out.split("\n");
        const i = lines.findIndex(l => l.startsWith(doc));
        const block = i < 0 ? [] : lines.slice(i + 1).filter((l, j, a) => a.slice(0, j + 1).every(y => y.startsWith("    ")));
        if (i < 0 || !block.some(l => place.test(l))) problems.push(`usages ${target} lacks ${doc} ${place}`);
    }
    try {
        refs.usages(s2.client, `${E}.Cuont`);
        problems.push("usages of a misspelt name did not fail");
    } catch (e) {
        if (!/Did you mean: .*\.Count/.test(e.message)) problems.push(`misspelt name: ${e.message}`);
    }
    const deep = refs.usages(s2.client, `${E}_Sub`, 2);
    if (!/used by /.test(deep)) problems.push("usages --depth 2 shows no second level");
    check(`usages: ${sdk.size} by-name references the Model SDK sees are all in the graph (${g.edges.length} edges, ${g.edges.filter(e => e.kind !== "ref").length} from expressions/XPath); $Var/Attr paths, XPath members, calls, event handler, scheduled event, did-you-mean, depth 2; graph cold ${cold.ms.toFixed(0)} ms, warm ${warm.ms.toFixed(0)} ms, query ${q.ms.toFixed(0)} ms`,
        !problems.length && /Usages of/.test(text), problems.slice(0, 5).join("; "));
    return s2;
}

async function unusedPhase(x) {
    const { reopen, copy, mod, T, check } = x;
    const E = `${mod}.${T}`;
    let s = await reopen(copy);
    const plan = { ops: [
        { op: "createMicroflow", module: mod, name: `${T}_Orphan`, folder: "ZzTest", actions: [{ action: "log", message: "nobody calls me" }] },
        { op: "addAttribute", entity: E, name: "ZzNobody", type: "String(20)" },
        { op: "addEnumerationValue", enumeration: `${E}Status`, name: "ZzNever" }
    ] };
    await s.ops.runPlan(plan, () => {});
    await s.model.flushChanges();
    s.client.project.writeEncoded(s.client.encode());
    s = await reopen(copy);
    const text = refs.unused(s.client, mod);
    const listed = n => text.split("\n").some(l => l.trim().startsWith(n + " ") || l.trim() === n);
    const problems = [];
    for (const n of [`${E}_Orphan`, `${E}.ZzNobody`, `${E}Status.ZzNever`]) if (!listed(n)) problems.push(`${n} not listed`);
    for (const n of [`${E}_Sub`, `${E}_Job`, `${E}.Count`, `${E}.Flag`, `${E}.Title`, E]) if (listed(n)) problems.push(`${n} listed although used`);
    try {
        refs.unused(s.client, `${mod}x`);
        problems.push("unused of a wrong module did not fail");
    } catch (e) {
        if (!/Did you mean/.test(e.message)) problems.push(e.message);
    }
    check("unused: new orphan microflow, attribute and enumeration value listed with reasons; called, scheduled, event-handler, expression- and XPath-used ones not; wrong module: did-you-mean", !problems.length, problems.join("; "));
    return s;
}

// write a plan on the copy; returns { s (reopened), failed (checkPlan), lay, lost, lines }
async function runApply(x, s, plan) {
    const lines = [];
    await s.ops.runPlan(plan, l => lines.push(l));
    await s.model.flushChanges();
    const enc = s.client.encode();
    const lay = x.layoutProblems(x.layout, enc);
    const lost = x.lostProperties(s.client, s.model, enc);
    const warnings = s.client.summary().warnings;
    s.client.project.writeEncoded(enc);
    const s2 = await x.reopen(x.copy);
    const failed = await s2.ops.checkPlan(plan);
    return { s: s2, failed, lay: lay.problems, lost, lines, warnings };
}

// every unit loads with the Model SDK, opening changes nothing
async function reopenErrors(s) {
    const errs = [];
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => errs.push(e.message));
    await s.model.flushChanges();
    if (s.client.log.length) errs.push(`${s.client.log.length} deltas on open`);
    return errs;
}

async function refused(s, plan, re) {
    try {
        await s.ops.runPlan(plan, () => {});
        return `not refused: ${JSON.stringify(plan.ops[0]).slice(0, 120)}`;
    } catch (e) {
        return re.test(e.message) ? null : `wrong refusal for ${plan.ops[0].op}: ${e.message.slice(0, 200)}`;
    }
}

// changeMicroflow: a parameter added (value given to a call step and a page button), one renamed ($Item in the flow
// follows), return type and value changed; then removed again; refusals for callers that cannot follow
async function changeMicroflowPhase(x) {
    const { reopen, copy, mod, T, check, results } = x;
    const E = `${mod}.${T}`;
    let s = await reopen(copy);
    const pageable = await s.ops.get(`${E}_Edit`).then(() => true, () => false);
    const setup = { ops: [
        { op: "createMicroflow", module: mod, name: `${T}_Callee`, folder: "ZzTest", parameters: [{ name: "Item", type: E }], returns: "Boolean", returnValue: "$Item/Count > 0",
            actions: [{ action: "log", message: "callee {1}", args: ["$Item/Title"] }, { action: "change", variable: "Item", set: { Count: "$Item/Count + 1" } }] },
        { op: "createMicroflow", module: mod, name: `${T}_Caller`, folder: "ZzTest", parameters: [{ name: "Thing", type: E }], actions: [{ action: "call", microflow: `${E}_Callee`, args: { Item: "$Thing" }, variable: "Ok" }] },
        ...(pageable ? [{ op: "createPage", module: mod, name: `${T}_Calls`, entity: E, folder: "ZzTest", widgets: [{ widget: "dataView", widgets: [{ widget: "actionButton", name: "zzCallBtn", action: "callMicroflow", microflow: `${E}_Callee`, caption: "Call" }] }] }] : [])
    ] };
    let r = await runApply(x, s, setup);
    const problems = [...r.failed];
    s = r.s;
    const change = { ops: [{ op: "changeMicroflow", microflow: `${E}_Callee`, addParameters: [{ name: "Note", type: "String", value: "'from caller'" }], renameParameters: { Item: "Obj" }, returns: "String", returnValue: "$Obj/Title + $Note" }] };
    r = await runApply(x, s, change);
    s = r.s;
    problems.push(...r.failed, ...r.lay.slice(0, 3), ...r.lost);
    const out = r.lines.join("\n");
    if (!/CALLERS UPDATED \(\d+\)/.test(out) || !out.includes(`${E}_Caller`) || (pageable && !out.includes("zzCallBtn"))) problems.push(`dry run lacks the callers: ${out.slice(0, 300)}`);
    const plain = name => {
        for (const [id] of s.ctx.project.units) {
            const p = s.ctx.project.read(id);
            if (p.Name === name && /Microflows\$Microflow|Forms\$Page/.test(p.$Type)) return p;
        }
        return null;
    };
    const json = o => JSON.stringify(o || {});
    const callee = json(plain(`${T}_Callee`));
    if (!callee.includes("$Obj/Title") || callee.includes("$Item") || !/"Name":"Note"/.test(callee) || !callee.includes("DataTypes$StringType")) problems.push("callee: parameters, $Item -> $Obj or return type not stored");
    const caller = json(plain(`${T}_Caller`));
    if (!caller.includes(`"Parameter":"${E}_Callee.Obj"`) || !caller.includes(`"Argument":"'from caller'"`) || !caller.includes(`"Parameter":"${E}_Callee.Note"`)) problems.push("caller call step lacks the Obj / Note mappings");
    if (pageable) {
        const page = json(plain(`${T}_Calls`));
        // the object of the data view is passed implicitly (Studio Pro stores no mapping for it)
        if (!page.includes(`"Parameter":"${E}_Callee.Note"`) || !page.includes(`"Expression":"'from caller'"`)) problems.push("page button lacks the Note mapping");
    }
    // remove it again; refusals
    const back = { ops: [{ op: "changeMicroflow", microflow: `${E}_Callee`, removeParameters: ["Note"], returns: "String", returnValue: "$Obj/Title" }] };
    r = await runApply(x, s, back);
    s = r.s;
    problems.push(...r.failed);
    if (json(plain(`${T}_Caller`)).includes(`${E}_Callee.Note`)) problems.push("removed parameter still mapped by the caller");
    const refusals = [
        [{ op: "changeMicroflow", microflow: `${E}_Job`, addParameters: [{ name: "X", type: "String", value: "''" }] }, /scheduled event passes no parameters/],
        [{ op: "changeMicroflow", microflow: `${E}_Sub`, addParameters: [{ name: "X", type: "String", value: "''" }] }, /event handler/],
        [{ op: "changeMicroflow", microflow: `${E}_Callee`, addParameters: [{ name: "X", type: "String" }] }, /give "value"/],
        [{ op: "changeMicroflow", microflow: `${E}_Callee`, removeParameters: ["Obj"] }, /still uses \$Obj/],
        [{ op: "changeMicroflow", microflow: `${E}_Callee`, renameParameters: { Objj: "Y" } }, /no parameter 'Objj'.*Did you mean: Obj/],
        [{ op: "changeMicroflow", microflow: `${E}_Callee`, returns: "Nothing" }, /uses the result as \$Ok/]
    ];
    for (const [op, re] of refusals) {
        const p = await refused(await reopen(copy), { ops: [op] }, re);
        if (p) problems.push(p);
    }
    problems.push(...(await reopenErrors(await reopen(copy))));
    check(`changeMicroflow: parameter added (value passed by a call step${pageable ? " and a page button" : ""}), renamed ($Item in the flow follows), return type + value changed, then removed again from every caller; ${refusals.length} refusals (scheduled event, event handler, no value, still used, did-you-mean, result used); stored with Studio Pro's keys, reopen 0 errors`, !problems.length, problems.slice(0, 6).join("; "));
    if (!pageable) results.push("SKIP changeMicroflow page button caller: this project has no page with a layout to copy");
    return s;
}

// copyDocument: an entity (same module, and with associations + roles into another module), a page for that entity
// (attributes by name), a page for an entity that lacks them (refused, then skipUnmatched), a microflow into another
// module (roles refused, then mapped), an enumeration
async function copyPhase(x) {
    const { reopen, copy, mod, T, check, results } = x;
    const E = `${mod}.${T}`;
    const M = `${T}Mod`;
    let s = await reopen(copy);
    const pageable = await s.ops.get(`${E}_Edit`).then(() => true, () => false);
    const problems = [];
    const plan = { ops: [
        { op: "copyDocument", document: E, name: `${T}Twin` },
        { op: "copyDocument", document: `${E}Line`, module: M, name: "ZzLine", associations: true },
        { op: "copyDocument", document: E, module: M, name: "ZzCopied", roles: { [`${mod}.ZzRole`]: `${M}.HR` } },
        { op: "copyDocument", document: `${E}_Main`, module: M, roles: { [`${mod}.ZzRole`]: `${M}.User` } },
        { op: "copyDocument", document: `${E}Status`, name: `${T}Status2` }
    ] };
    let r = await runApply(x, s, plan);
    s = r.s;
    problems.push(...r.failed, ...r.lay.slice(0, 3), ...r.lost);
    if (pageable) {
        r = await runApply(x, s, { ops: [{ op: "copyDocument", document: `${E}_Edit`, name: `${T}Twin_Edit`, entity: { [E]: `${E}Twin` } }] });
        s = r.s;
        problems.push(...r.failed, ...r.lay.slice(0, 3), ...r.lost);
        const g = refs.graph(s.client);
        const twin = g.units.find(u => u.label === `${E}Twin_Edit`);
        const own = twin ? g.edges.filter(e => e.unit === twin.id) : [];
        if (!own.some(e => e.to === `${E}Twin.Title`) || own.some(e => e.to === E || e.to.startsWith(E + "."))) problems.push(`page copy for ${E}Twin: ${own.map(e => e.to).filter(t => t.startsWith(E)).slice(0, 5).join(", ")}`);
    } else results.push("SKIP copyDocument of a page: this project has no page with a layout to copy");
    const g = refs.graph(s.client);
    for (const n of [`${E}Twin.Title`, `${M}.ZzCopied.Count`, `${M}.ZzLine.Text`, `${E}Status2.Done`, `${M}.${T}_Main`]) if (!g.names.has(n) && !g.units.some(u => u.label === n)) problems.push(`${n} missing`);
    const dm = s.ctx.project.read(g.units.find(u => u.type === "DomainModels$DomainModel" && u.module === M).id);
    const copied = dm.Entities.find(e => e.Name === "ZzCopied");
    const rules = JSON.stringify(copied || {});
    if (!copied || !rules.includes(`"${M}.ZzCopied.Title"`) || rules.includes(`${E}.`) || !rules.includes(`"${M}.HR"`)) problems.push("ZzCopied: validation/access rules not re-bound to the copy and the role");
    const orig = s.ctx.project.read(g.units.find(u => u.type === "DomainModels$DomainModel" && u.module === mod).id).Entities.find(e => e.Name === T);
    if (copied && orig && (copied.$ID === orig.$ID || copied.GUID === orig.GUID || copied.Attributes[0].$ID === orig.Attributes[0].$ID)) problems.push("ZzCopied kept the ids of the original");
    const refusals = [
        [{ op: "copyDocument", document: `${E}_Main`, module: M, name: "ZzMain2" }, /module roles .* no match in .*ZzRole.*"roles"/],
        [{ op: "copyDocument", document: E, name: `${T}Twin` }, /already exists/],
        [{ op: "copyDocument", document: `${E}_Nightly`, name: "ZzNightly" }, /copies pages, snippets/],
        [{ op: "copyDocument", document: `${E}_Mian`, name: "X" }, /Did you mean: .*_Main/],
        ...(pageable ? [[{ op: "copyDocument", document: `${E}_Edit`, name: `${T}On_Edit`, module: M, entity: { [E]: `${M}.Onboarding` }, roles: { [`${mod}.ZzRole`]: `${M}.User` } }, /lacks: .*Title.*skipUnmatched/]] : [])
    ];
    for (const [op, re] of refusals) {
        const p = await refused(await reopen(copy), { ops: [op] }, re);
        if (p) problems.push(p);
    }
    if (pageable) {
        r = await runApply(x, await reopen(copy), { ops: [{ op: "copyDocument", document: `${E}_Edit`, name: `${T}On_Edit`, module: M, entity: { [E]: `${M}.Onboarding` }, roles: { [`${mod}.ZzRole`]: `${M}.User` }, skipUnmatched: true }] });
        s = r.s;
        problems.push(...r.failed, ...r.lay.slice(0, 3), ...r.lost);
        if (!/left out \d+ widget/.test(r.lines.join("\n"))) problems.push("skipUnmatched did not list what it left out");
    }
    problems.push(...(await reopenErrors(await reopen(copy))));
    check(`copyDocument: entity (attributes, validation + access rules re-bound, fresh ids; into another module with roles mapped and its association as a cross-module one), ${pageable ? "page for another entity (attributes by name, nothing left on the original), page for an entity lacking attributes (refused, then skipUnmatched), " : ""}microflow into another module (roles mapped), enumeration; ${refusals.length} refusals; reopen 0 errors`, !problems.length, problems.slice(0, 6).join("; "));
    return s;
}

// changeEntity (persistable off with DATA LOSS and back, documentation, image) and moveEntity of the selftest's
// entity (used by pages, flows, rules, an event handler, an association owned by another entity) into another module
// and back: no reference left on the old name, the same number of references on the new one, reopen 0 errors
async function entityPhase(x) {
    const { reopen, copy, mod, T, check } = x;
    const E = `${mod}.${T}`;
    const M = `${T}Mod`;
    let s = await reopen(copy);
    const problems = [];
    const g0 = refs.graph(s.client);
    const image = [...g0.names].find(([, t]) => t === "Images$Image");
    const count = (g, qn) => g.edges.filter(e => e.to === qn || e.to.startsWith(qn + ".")).length;
    const before = count(g0, E);
    await s.ops.createEntity({ module: mod, name: `${T}Temp`, attributes: [{ name: "Note", type: "String(20)" }] });
    await s.model.flushChanges();
    s.client.project.writeEncoded(s.client.encode());
    s = await reopen(copy);
    let r = await runApply(x, s, { ops: [{ op: "changeEntity", entity: `${E}Temp`, persistable: false, documentation: "Zz temp", ...(image ? { image: image[0] } : {}) }] });
    s = r.s;
    problems.push(...r.failed, ...r.lay.slice(0, 3), ...r.lost);
    if (!/DATA LOSS: the table of/.test(r.lines.join("\n"))) problems.push("persistable off without a DATA LOSS line");
    r = await runApply(x, s, { ops: [{ op: "changeEntity", entity: `${E}Temp`, persistable: true }] });
    s = r.s;
    problems.push(...r.failed);
    // move into the new module and back
    r = await runApply(x, s, { ops: [{ op: "moveEntity", entity: E, module: M, roles: { [`${mod}.ZzRole`]: `${M}.User` } }] });
    s = r.s;
    problems.push(...r.failed, ...r.lay.slice(0, 3), ...r.lost);
    const out = r.lines.join("\n");
    if (!/reference\(s\) renamed in \d+ document/.test(out) || !/now cross-module/.test(out)) problems.push(`moveEntity dry run: ${out.slice(0, 200)}`);
    let g = refs.graph(s.client);
    const moved = `${M}.${T}`;
    if (count(g, E) || count(g, moved) !== before) problems.push(`after the move: ${count(g, E)} reference(s) to ${E}, ${count(g, moved)} to ${moved} (was ${before})`);
    if (!g.assocs.has(`${mod}.${T}Line_${T}`) || g.assocs.get(`${mod}.${T}Line_${T}`).child !== moved) problems.push(`${mod}.${T}Line_${T} does not point to ${moved}`);
    problems.push(...(await reopenErrors(await reopen(copy))));
    r = await runApply(x, await reopen(copy), { ops: [{ op: "moveEntity", entity: moved, module: mod, roles: { [`${M}.User`]: `${mod}.ZzRole` } }] });
    s = r.s;
    problems.push(...r.failed, ...r.lay.slice(0, 3), ...r.lost);
    g = refs.graph(s.client);
    if (count(g, moved) || count(g, E) !== before) problems.push(`after moving back: ${count(g, E)} reference(s) to ${E} (was ${before})`);
    if (!/no longer cross-module/.test(r.lines.join("\n"))) problems.push("moving back did not make the association regular again");
    const refusals = [
        [{ op: "changeEntity", entity: `${E}Line`, persistable: false }, /inherits from/],
        [{ op: "changeEntity", entity: E, persistable: false }, /REFUSED: persistable entities own associations/],
        [{ op: "changeEntity", entity: E, color: "red" }, /does not store an entity color/],
        [{ op: "moveEntity", entity: E, module: M }, /REFUSED: access rules .*ZzRole/],
        [{ op: "moveEntity", entity: E, module: `${M}x` }, /Did you mean: .*Mod/],
        [{ op: "moveEntity", entity: E, module: mod }, /already in/]
    ];
    for (const [op, re] of refusals) {
        const p = await refused(await reopen(copy), { ops: [op] }, re);
        if (p) problems.push(p);
    }
    problems.push(...(await reopenErrors(await reopen(copy))));
    check(`changeEntity (persistable off with DATA LOSS and on again, documentation${image ? ", image" : ""}) and moveEntity of an entity with ${before} references (pages, flows, XPath, event handler, access rules with roles mapped, an association of another entity made cross-module) into another module and back: every reference follows, none left; ${refusals.length} refusals; reopen 0 errors`, !problems.length, problems.slice(0, 6).join("; "));
    return s;
}

async function refsPhase(x) {
    const only = x.only ? x.only.split(",") : null;
    const run = n => !only || only.includes(n);
    if (run("usages")) await usagesPhase(x);
    if (run("unused")) await unusedPhase(x);
    if (run("changeMicroflow")) await changeMicroflowPhase(x);
    if (run("copy")) await copyPhase(x);
    if (run("entity")) await entityPhase(x);
    return x.reopen(x.copy);
}

module.exports = { refsPhase, sdkPairs };
