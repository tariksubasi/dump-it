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

async function refsPhase(x) {
    await usagesPhase(x);
    return unusedPhase(x);
}

module.exports = { refsPhase, sdkPairs };
