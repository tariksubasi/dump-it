"use strict";
// selftest phase L: the layout engine (flow-layout.js) on every Studio Pro-saved microflow, nanoflow and rule of the
// project (at most CAP of them), on a copy of its own:
//   (a) 3 actions added after a step in the middle (main line, or a branch / loop / error handler path), then deleted
//       again: the document is byte for byte what Studio Pro saved (positions, sides, Bezier vectors, ids)
//   (b) right after the add, LAYOUT CHECK finds no overlap or object outside its loop that was not there before
//   (c) a constructed flow: actions inserted in a loop and right after it: the loop holds its content, nothing overlaps
//   (d) formatMicroflow: twice gives the same bytes, LAYOUT CHECK has no errors on the result, reopen 0 errors
const fs = require("fs");
const path = require("path");
const L = require("./flow-layout");

const CAP = 60;
const sdk = require("mendixmodelsdk");
const { microflows: mf } = sdk;

function unitBytes(s, id) {
    // the bytes this unit would be written with now (only this unit encoded)
    const saved = s.client.changes;
    s.client.changes = { updated: new Set([id]), created: new Map(), deleted: new Set(), moved: new Map() };
    try {
        const enc = s.client.encode();
        return enc.files[0] ? enc.files[0].bytes : null;
    } finally {
        s.client.changes = saved;
    }
}

// a step in the middle of the flow to add after: an activity with one normal outgoing flow; branchy = prefer one
// that is not on the main line (a branch, a loop, an error handler path)
function middleStep(m, branchy) {
    const g = L.graph(m);
    const start = [...m.objectCollection.objects].find(o => o instanceof mf.StartEvent);
    const all = [];
    L.walk(m.objectCollection, o => {
        if (!(o instanceof mf.ActionActivity)) return;
        const out = (g.out.get(o.id) || []).filter(f => !f.isErrorHandler);
        if (out.length === 1 && out[0].destination) all.push(o);
    });
    if (!all.length) return null;
    const off = all.filter(o => o.container !== m.objectCollection || !start || o.relativeMiddlePoint.y !== start.relativeMiddlePoint.y);
    const list = branchy && off.length ? off : all;
    return list[Math.floor(list.length / 2)];
}

const errorsOf = issues => issues.filter(i => i.level === "error");

async function layoutPhase({ src, reopen, check, tmp, out }) {
    const dir = path.join(tmp, "layout");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src.mpr, path.join(dir, path.basename(src.mpr)));
    fs.cpSync(src.contents, path.join(dir, "mprcontents"), { recursive: true });
    const copy = path.join(dir, path.basename(src.mpr));
    let s = await reopen(copy);
    const docs = [...s.model.allMicroflows(), ...s.model.allNanoflows(), ...(s.model.allRules ? s.model.allRules() : [])]
        .filter(d => d.qualifiedName).sort((a, b) => (a.qualifiedName < b.qualifiedName ? -1 : 1));
    // spread over the project: every k-th document up to CAP
    const step = Math.max(1, Math.ceil(docs.length / CAP));
    const picked = docs.filter((d, i) => i % step === 0).slice(0, CAP);
    const rt = { tried: 0, same: 0, fails: [], repaired: [], newErr: [], main: 0, off: 0 };
    let vars = 0;
    for (const [i, d] of picked.entries()) {
        const m = await d.load();
        const qn = m.qualifiedName;
        const original = s.ctx.project.readBytes(m.id);
        if (!unitBytes(s, m.id).equals(original)) continue; // not as Studio Pro saved it (should not happen)
        const startY = ([...m.objectCollection.objects].find(o => o instanceof mf.StartEvent) || { relativeMiddlePoint: { y: NaN } }).relativeMiddlePoint.y;
        // one step on the main line and one in a branch / loop / error handler path (when there is one)
        const anchors = [...new Set([middleStep(m, i % 2 === 1), middleStep(m, i % 2 === 0)].filter(Boolean))];
        const before = L.lint(L.snapshot(m));
        const broken = errorsOf(before).length > 0; // the engine repairs these (a loop grows round its content)
        for (const anchor of anchors) {
            rt.tried++;
            if (anchor.container === m.objectCollection && anchor.relativeMiddlePoint.y === startY) rt.main++;
            else rt.off++;
            const ids = new Set();
            L.walk(m.objectCollection, o => ids.add(o.id));
            try {
                await s.ops.addActions({ microflow: qn, after: anchor.id, actions: [1, 2, 3].map(k => ({ action: "variable", name: `ZzLayout${++vars}`, type: "Integer", value: String(k) })) });
                const added = [];
                L.walk(m.objectCollection, o => !ids.has(o.id) && added.push(o));
                await s.model.flushChanges();
                if (added.length !== 3 || unitBytes(s, m.id).equals(original)) throw new Error(`the add changed nothing (${added.length} new objects)`);
                const fresh = errorsOf(L.newIssues(before, L.lint(L.snapshot(m))));
                if (fresh.length) rt.newErr.push(`${qn} after [${anchor.id.slice(0, 8)}]: ${fresh.slice(0, 2).map(x => x.text).join("; ")}`);
                for (const o of added) await s.ops.deleteAction({ microflow: qn, id: o.id });
                await s.model.flushChanges();
                if (unitBytes(s, m.id).equals(original)) rt.same++;
                else if (broken) rt.repaired.push(qn);
                else rt.fails.push(`${qn} after [${anchor.id.slice(0, 8)}]`);
            } catch (e) {
                rt.fails.push(`${qn}: ${e.message.split("\n")[0]}`);
            }
            if (broken) break; // repaired: the next round starts from another layout
        }
    }
    check(`layout (a): 3 actions added after a middle step and deleted again ${rt.tried} times in ${picked.length} Studio Pro flows (${rt.main} after a step on the main line, ${rt.off} in a branch/loop/error path): byte-identical`, rt.tried > 0 && !rt.fails.length, `${rt.same}/${rt.tried}${rt.repaired.length ? ` (${rt.repaired.length} had layout errors before and were repaired: ${rt.repaired.slice(0, 3).join(", ")})` : ""}${rt.fails.length ? "; differ: " + rt.fails.slice(0, 4).join(", ") : ""}`);
    check(`layout (b): no new overlap / object outside its loop after the add (LAYOUT CHECK)`, !rt.newErr.length, rt.newErr.slice(0, 3).join(" | "));
    // (c) a constructed flow with nested loops: a two-row block into the outer loop, steps into the inner loop and
    // right after the outer loop, a step out of the inner loop deleted again
    const mod = s.model.allModules().filter(x => !x.fromAppStore).map(x => x.name).sort()[0];
    const v = (name, value = "1") => ({ action: "variable", name, type: "Integer", value });
    const qn = `${mod}.ZzLayoutLoops`;
    const cProblems = [];
    try {
        await s.ops.createMicroflow({ module: mod, name: "ZzLayoutLoops", actions: [v("I", "0"),
            { action: "loop", while: "$I < 3", actions: [{ action: "set", name: "I", value: "$I + 1" }, { action: "loop", while: "$I < 2", actions: [v("K"), v("K2")] }, v("J", "$I")] }, v("Z")] });
        const m = await (s.model.allMicroflows().find(x => x.qualifiedName === qn)).load();
        const find = (pred) => {
            let r = null;
            L.walk(m.objectCollection, o => !r && pred(o) && (r = o));
            return r;
        };
        const named = n => find(o => o.action && o.action.variableName === n);
        const outer = find(o => o instanceof mf.LoopedActivity && o.container === m.objectCollection);
        const inner = find(o => o instanceof mf.LoopedActivity && o !== outer);
        const setStep = find(o => o.action instanceof mf.ChangeVariableAction);
        const size0 = { outer: { ...outer.size }, inner: { ...inner.size } };
        await s.ops.addActions({ microflow: qn, after: setStep.id, actions: [{ action: "if", condition: "$I > 1", then: [v("A1")], else: [v("B1"), v("B2")] }, v("D1")] });
        await s.ops.addActions({ microflow: qn, after: named("K").id, actions: [v("K3"), v("K4"), v("K5")] });
        await s.ops.addActions({ microflow: qn, after: outer.id, actions: [v("Y1"), v("Y2"), v("Y3")] });
        await s.ops.deleteAction({ microflow: qn, id: named("K2").id });
        const issues = L.lint(L.snapshot(m));
        for (const i of errorsOf(issues)) cProblems.push(i.text);
        if (!(outer.size.height > size0.outer.height && outer.size.width > size0.outer.width)) cProblems.push(`the outer loop did not grow round the two-row block (${size0.outer.width}x${size0.outer.height} -> ${outer.size.width}x${outer.size.height})`);
        if (!(inner.size.width > size0.inner.width)) cProblems.push("the inner loop did not grow");
        const right = L.rect(outer).r;
        for (const n of ["Y1", "Y2", "Y3"]) if (L.rect(named(n)).l <= right) cProblems.push(`${n} is not right of the loop (${L.rect(named(n)).l} <= ${right})`);
        if (L.rect(named("Z")).l <= L.rect(named("Y3")).r) cProblems.push("Z did not move right of the new steps");
    } catch (e) {
        cProblems.push(e.message.split("\n")[0]);
    }
    check(`layout (c): two-row block into a loop, steps into a nested loop and right after a loop, a delete in the nested loop: loops hold their content (grown up to the outermost), nothing overlaps`, !cProblems.length, cProblems.slice(0, 4).join("; "));
    // (d) formatMicroflow on the Studio Pro flows: twice gives the same bytes, no LAYOUT CHECK errors, reopen 0 errors
    const fmt = { done: 0, same: 0, errs: [], notSame: [], before: 0, after: 0, warnBefore: 0, warnAfter: 0 };
    for (const d of picked) {
        const m = await d.load();
        const qn = m.qualifiedName;
        try {
            const was = L.lint(L.snapshot(m));
            await s.ops.formatMicroflow({ microflow: qn });
            await s.model.flushChanges();
            const once = unitBytes(s, m.id);
            await s.ops.formatMicroflow({ microflow: qn });
            await s.model.flushChanges();
            const twice = unitBytes(s, m.id);
            fmt.done++;
            if (once.equals(twice)) fmt.same++;
            else fmt.notSame.push(qn);
            const now = L.lint(L.snapshot(m));
            fmt.before += errorsOf(was).length;
            fmt.warnBefore += was.length - errorsOf(was).length;
            fmt.after += errorsOf(now).length;
            fmt.warnAfter += now.length - errorsOf(now).length;
            for (const i of errorsOf(now)) fmt.errs.push(`${qn}: ${i.text}`);
        } catch (e) {
            fmt.errs.push(`${qn}: ${e.message.split("\n")[0]}`);
        }
    }
    await s.model.flushChanges();
    s.client.project.writeEncoded(s.client.encode());
    const s2 = await reopen(copy);
    const errors = [];
    for (const u of s2.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) {
        try {
            await s2.model.loadUnitById(u.id, false);
        } catch (e) {
            errors.push(e.message);
        }
    }
    await s2.model.flushChanges();
    const reopenOk = !errors.length && !s2.client.log.length;
    check(`layout (d): formatMicroflow on ${fmt.done} Studio Pro flows: idempotent, no LAYOUT CHECK errors (before ${fmt.before} errors / ${fmt.warnBefore} warnings, after ${fmt.after} / ${fmt.warnAfter}), reopen 0 errors`,
        fmt.done > 0 && fmt.same === fmt.done && !fmt.errs.length && reopenOk,
        [fmt.notSame.length ? "not idempotent: " + fmt.notSame.slice(0, 3).join(", ") : "", fmt.errs.slice(0, 3).join("; "), reopenOk ? "" : errors[0] || `${s2.client.log.length} deltas on open`].filter(Boolean).join(" | "));
    s = s2;
    return { s, copy };
}

module.exports = { layoutPhase, middleStep, unitBytes };

// node selftest-layout.js <app.mpr>: this phase alone
if (require.main === module) {
    (async () => {
        const os = require("os");
        const { Project } = require("./mpr");
        const { reopen } = require("./selftest");
        const src = new Project(process.argv[2]);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-layout-"));
        const results = [];
        const check = (name, ok, detail) => results.push(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
        try {
            await layoutPhase({ src, reopen, check, tmp, out: console.log });
        } catch (e) {
            results.push("FAIL " + e.stack);
        }
        console.log(results.map(r => "  " + r).join("\n"));
        fs.rmSync(tmp, { recursive: true, force: true });
    })();
}
