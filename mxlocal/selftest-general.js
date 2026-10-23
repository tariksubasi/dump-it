"use strict";
// selftest phase G: one plan that chains many op families on names it creates itself (a later op uses what an
// earlier one made, no $prev), changing a stored workflow (add/move/change/remove activities, timeouts), unit tests,
// moving an attribute in its generalization chain, Java action code with the JAVA CHECK (javac against a stub runtime
// jar when a JDK is there), and selective undo (the inverse plan of an applied change). Every plan is stored,
// reopened (0 errors, 0 deltas), byte-roundtripped and checked with checkPlan (integ.runPhase); refusals change nothing.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const integ = require("./selftest-integ");

// The stored domain model units of a project.
function domainModels(p) {
    const out = [];
    for (const id of p.units.keys()) {
        const u = p.read(id);
        if (u.$Type === "DomainModels$DomainModel") out.push(u);
    }
    return out;
}

// A tiny runtime jar (IContext, UserAction) so javac can compile a generated Java action; null without a JDK.
function stubRuntime(tmp) {
    const javac = spawnSync("javac", ["-version"], { encoding: "utf8" });
    const jar = spawnSync("jar", ["--version"], { encoding: "utf8" });
    if (javac.error || javac.status !== 0 || jar.error) return null;
    const dir = fs.mkdtempSync(path.join(tmp, "stubrt-"));
    const pkg = path.join(dir, "src", "com", "mendix", "systemwideinterfaces", "core");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "IContext.java"), "package com.mendix.systemwideinterfaces.core;\npublic interface IContext {}\n");
    fs.writeFileSync(path.join(pkg, "IMendixObject.java"), "package com.mendix.systemwideinterfaces.core;\npublic interface IMendixObject {}\n");
    fs.writeFileSync(path.join(pkg, "UserAction.java"), "package com.mendix.systemwideinterfaces.core;\npublic abstract class UserAction<R> { private final IContext c; public UserAction(IContext c) { this.c = c; } public IContext getContext() { return c; } public abstract R executeAction() throws Exception; }\n");
    const env = { ...process.env, JAVA_TOOL_OPTIONS: "" };
    const c = spawnSync("javac", ["-d", path.join(dir, "out"), ...fs.readdirSync(pkg).map(f => path.join(pkg, f))], { encoding: "utf8", env });
    if (c.status !== 0) return null;
    const j = spawnSync("jar", ["cf", path.join(dir, "mx-stub.jar"), "-C", path.join(dir, "out"), "."], { encoding: "utf8", env });
    return j.status === 0 ? path.join(dir, "mx-stub.jar") : null;
}

// The chain: every op uses a name an earlier op of the same plan created.
function chainPlan(mod, T, pageable, web, java) {
    const C = `${T}Chain`;
    const E = `${C}.Item`;
    const pagesOps = pageable ? [
        { op: "createSnippet", module: C, name: "Item_Card", entity: E },
        { op: "createPage", module: C, name: "Item_Edit", entity: E, roles: [`${C}.User`] },
        { op: "createPage", module: C, name: "Item_Overview", entity: E, roles: [`${C}.User`], widgets: [{ widget: "dataGrid", columns: ["Amount", "Status"] }] },
        { op: "addWidgets", page: `${C}.Item_Overview`, widgets: [{ widget: "actionButton", action: "callMicroflow", microflow: `${C}.ACT_Job`, caption: "Run" }] },
        ...(web ? [{ op: "addMenuItem", page: `${C}.Item_Overview`, caption: `${T} items` }] : []),
        { op: "createMenu", module: C, name: "Admin_Menu", items: [{ caption: "Items", page: `${C}.Item_Overview` }] },
        { op: "createPage", kind: "userTaskPage", module: C, name: "Review_Task", outcomes: ["Approve", "Reject"], roles: [`${C}.User`] }] : [];
    const wfSteps = pageable ? [{ step: "userTask", name: "review", page: `${C}.Review_Task`, outcomes: ["Approve", "Reject"] }] : [{ step: "waitForNotification", name: "review" }];
    return { ops: [
        { op: "createModule", name: C, roles: ["User"] },
        { op: "createEnumeration", module: C, name: "Status", values: ["Open", "Done"] },
        { op: "createEntity", module: C, name: "Item", attributes: [{ name: "Amount", type: "Decimal" }, { name: "Status", type: `Enum(${C}.Status)`, default: "Open" }] },
        { op: "createEntity", module: C, name: "Base", attributes: [{ name: "Code", type: "String(20)" }] },
        { op: "createEntity", module: C, name: "Child", generalization: `${C}.Base`, attributes: [{ name: "Note", type: "String(200)" }] },
        { op: "addAccessRule", entity: E, roles: [`${C}.User`], access: "ReadWrite", create: true, delete: true },
        { op: "addAccessRule", entity: `${C}.Child`, roles: [`${C}.User`], access: "ReadWrite", create: true },
        { op: "addValidationRule", entity: `${C}.Child`, attribute: "Note", rule: "required", message: "Note is required" },
        { op: "createConstant", module: C, name: "ApiUrl", type: "String", default: "https://example.com" },
        { op: "createJsonStructure", module: C, name: "JSON_Item", snippet: "{ \"amount\": 1.5 }" },
        { op: "createImportMapping", module: C, name: "IMM_Item", jsonStructure: `${C}.JSON_Item`, entity: E },
        { op: "createJavaAction", module: C, name: "JA_Check", parameters: [{ name: "Limit", type: "Integer" }], returns: "Boolean", code: "return Limit != null && Limit > 0;", ...(java ? {} : { compile: false }) },
        { op: "createMicroflow", module: C, name: "ACT_Item_New", roles: [`${C}.User`], returns: E, returnValue: "$Item", actions: [
            { action: "create", variable: "Item", entity: E, set: { Status: `${C}.Status.Open` } },
            { action: "callJava", javaAction: `${C}.JA_Check`, args: { Limit: "3" }, variable: "Ok" },
            { action: "create", variable: "Kid", entity: `${C}.Child`, set: { Note: "'x'" } },
            { action: "log", message: "{1}", args: [`@${C}.ApiUrl`] }] },
        { op: "createMicroflow", module: C, name: "ACT_Job", actions: [{ action: "call", microflow: `${C}.ACT_Item_New`, variable: "New" }] },
        { op: "createScheduledEvent", module: C, name: "SE_Job", microflow: `${C}.ACT_Job`, every: "Day" },
        ...pagesOps,
        { op: "createWorkflow", module: C, name: "WF_Item", context: E, steps: wfSteps },
        { op: "changeWorkflow", workflow: `${C}.WF_Item`, add: [{ after: "review", steps: [{ step: "callMicroflow", name: "job", microflow: `${C}.ACT_Job` }] }] },
        { op: "zzUnitTesting" }, // generalPhase puts the UnitTesting module here (or leaves it out when the project has one)
        { op: "createUnitTest", module: C, name: "NewItem", actions: [{ action: "call", microflow: `${C}.ACT_Item_New`, variable: "New" }], asserts: [{ that: `$New/Status = ${C}.Status.Open`, message: "a new item is open" }, "$New != empty"] },
        { op: "moveDocument", document: `${C}.ACT_Job`, folder: "Jobs" },
        { op: "rename", target: `${E}.Amount`, newName: "Total" }
    ] };
}

async function generalPhase({ s2, reopen, copy, mod, T, layout, layoutProblems, check, results, pageable, web, tmp }) {
    const env = { reopen, copy, layout, layoutProblems };
    const C = `${T}Chain`;
    const problems = [];
    // refusals on the model as it is (each on a fresh session: a refused op may have changed the model in memory)
    const refuse = async (s, plan, re, what) => {
        let msg = "";
        try {
            await s.ops.runPlan(plan, () => {});
        } catch (e) {
            msg = e.message;
        }
        if (!re.test(msg)) problems.push(`${what} was not refused as expected${msg ? `: ${msg.slice(0, 160)}` : " (no error)"}`);
        return reopen(copy);
    };

    // ---- unit tests: refused without the UnitTesting module (with the import hint)
    const hasUT = s2.model.allModules().some(m => m.name === "UnitTesting");
    if (!hasUT) s2 = await refuse(s2, { ops: [{ op: "createUnitTest", module: mod, name: "Nothing", asserts: ["true"] }] }, /UnitTesting module is not in this project.*importModulePackage/, "createUnitTest without UnitTesting");
    else results.push("SKIP createUnitTest refusal: this project has a UnitTesting module");

    // ---- the chain (plus a UnitTesting module with an AssertTrue2 Java action, so the test uses asserts)
    const stub = stubRuntime(tmp);
    const saved = process.env.MXLOCAL_RUNTIME_JARS;
    if (stub) process.env.MXLOCAL_RUNTIME_JARS = stub;
    else results.push("SKIP JAVA CHECK compile: no JDK (javac/jar) on this machine; the Java code is written unchecked");
    try {
        const chain = chainPlan(mod, T, pageable, web, !!stub);
        const at = chain.ops.findIndex(o => o.op === "zzUnitTesting");
        chain.ops.splice(at, 1, ...(hasUT ? [] : [{ op: "createModule", name: "UnitTesting" },
            { op: "createJavaAction", module: "UnitTesting", name: "AssertTrue2", parameters: [{ name: "valueToAssert", type: "Boolean" }, { name: "message", type: "String" }], code: "return valueToAssert;", ...(stub ? {} : { compile: false }) }]));
        const families = new Set(chain.ops.map(o => require("./op-families").familyOf(o.op)));
        // 10 families with pages; a project without a page with a layout cannot have the page-only ones (pages, menus)
        const famOf = ops => new Set(ops.map(o => require("./op-families").familyOf(o.op)));
        const pageOnly = pageable ? [] : [...famOf(chainPlan(mod, T, true, web, !!stub).ops)].filter(f => !families.has(f) && !famOf(chainPlan(mod, T, false, web, !!stub).ops).has(f));
        const need = 10 - pageOnly.length;
        const r = await integ.runPhase(env, s2, chain, p => {
            const out = [];
            const u = integ.unitsNamed(p, "Test_NewItem")["Test_NewItem"];
            if (!u) out.push("Test_NewItem missing");
            const javaFile = path.join(path.dirname(copy), "javasource", C.toLowerCase(), "actions", "JA_Check.java");
            if (!fs.existsSync(javaFile) || !fs.readFileSync(javaFile, "utf8").includes("return Limit != null && Limit > 0;")) out.push("JA_Check.java lacks the code");
            return out;
        });
        s2 = r.s;
        check(`chained plan: ${chain.ops.length} ops of ${families.size} op families (${need}+ required${pageOnly.length ? `; no page with a layout: ${pageOnly.join(", ")} need pages` : ""}), each later op using names created earlier in the plan (no $prev); stored, reopen 0 errors, roundtrip`, !r.problems.length && families.size >= need, r.problems.slice(0, 5).join("; ") || (families.size < need ? `only ${families.size} families` : ""));
        // JAVA CHECK: bad code is refused (dry run only)
        if (stub) s2 = await refuse(s2, { ops: [{ op: "setJavaActionCode", javaAction: `${C}.JA_Check`, code: "retrun 1;" }] }, /JAVA CHECK: javac found/, "setJavaActionCode with bad Java");
        const jr = await integ.runPhase(env, s2, { ops: [{ op: "setJavaActionCode", javaAction: `${C}.JA_Check`, code: "int n = 2;\nreturn Limit != null && Limit > n;", imports: ["java.util.List"], extra: "// helper space", ...(stub ? {} : { compile: false }) }] }, () => {
            const t = fs.readFileSync(path.join(path.dirname(copy), "javasource", C.toLowerCase(), "actions", "JA_Check.java"), "utf8");
            return /\t\tint n = 2;\r\n\t\treturn Limit != null && Limit > n;\r\n\t\t\/\/ END USER CODE/.test(t) && /import java\.util\.List;/.test(t) ? [] : ["JA_Check.java does not hold the new code and import (CRLF, tabs)"];
        });
        s2 = jr.s;
        check(`Java action code: createJavaAction code, setJavaActionCode code/imports/extra${stub ? ", JAVA CHECK with javac (bad code refused)" : ""}`, !jr.problems.length && !problems.length, [...jr.problems, ...problems].slice(0, 4).join("; "));
    } finally {
        if (stub) {
            if (saved === undefined) delete process.env.MXLOCAL_RUNTIME_JARS;
            else process.env.MXLOCAL_RUNTIME_JARS = saved;
        }
    }
    problems.length = 0;

    // ---- moveAttribute on stored entities: data loss refused, then allowed; not in the chain refused
    s2 = await refuse(s2, { ops: [{ op: "moveAttribute", attribute: `${C}.Child.Note`, to: `${C}.Base` }] }, /drops its stored values.*allowDataLoss/, "moveAttribute of a stored attribute");
    s2 = await refuse(s2, { ops: [{ op: "moveAttribute", attribute: `${C}.Child.Note`, to: `${C}.Item`, allowDataLoss: true }] }, /not in the generalization chain/, "moveAttribute outside the chain");
    const moveOps = { ops: [{ op: "moveAttribute", attribute: `${C}.Child.Note`, to: `${C}.Base`, newName: "Remark", allowDataLoss: true }, { op: "changeConstant", constant: `${C}.ApiUrl`, default: "https://example.org" }] };
    let r = await integ.runPhase(env, s2, moveOps, p => {
        const dmu = domainModels(p).find(u => u.Entities.some(e => e.Name === "Base" && e.Attributes.some(a => a.Name === "Remark")));
        if (!dmu) return ["Base.Remark not stored"];
        const base = dmu.Entities.find(e => e.Name === "Base");
        return base.ValidationRules.length === 1 ? [] : ["the validation rule did not move with the attribute"];
    });
    s2 = r.s;
    check("moveAttribute: up to the parent with a new name (validation rule and member access follow, usages listed); stored data refused without allowDataLoss, outside the chain refused", !r.problems.length && !problems.length, [...r.problems, ...problems].slice(0, 4).join("; "));
    problems.length = 0;

    // ---- selective undo: the inverse plan of that change (as apply leaves it: change.json in its backup)
    {
        const root = path.join(path.dirname(copy), ".mxlocal-backup");
        const last = require("./mpr").backups(path.dirname(copy)).pop();
        fs.writeFileSync(path.join(root, last, "change.json"), JSON.stringify(moveOps));
        const u = await require("./undo").undoPlan(copy, null, null);
        const want = ["changeConstant", "moveAttribute"];
        if (u.plan.ops.map(o => o.op).join() !== want.join()) problems.push(`undo plan is ${u.plan.ops.map(o => o.op).join(", ")}, expected ${want.join(", ")}`);
        const back = u.plan.ops.find(o => o.op === "changeConstant");
        if (!back || back.default !== "https://example.com") problems.push(`undo does not restore the constant's old value (${back && back.default})`);
        r = await integ.runPhase(env, s2, u.plan, p => {
            const dmu = domainModels(p).find(x => x.Entities.some(e => e.Name === "Child" && e.Attributes.some(a => a.Name === "Note")));
            return dmu ? [] : ["Child.Note is not back"];
        });
        s2 = r.s;
        const none = await require("./undo").invert({ op: "deleteAction", microflow: "X.Y", id: "1" }, null);
        if (!none.reason) problems.push("deleteAction got an inverse");
        check("undo: inverse plan of an applied change (moveAttribute back, constant from the backup's before state), applied and checked; non-invertible ops listed", !r.problems.length && !problems.length, [...r.problems, ...problems].slice(0, 4).join("; "));
        problems.length = 0;
    }

    // ---- workflows: build one, then change it (add/move/change/remove, timeouts, outcomes), then delete an activity
    {
        const W = `${C}.WF_Change`;
        const notify = `${C}.WF_Notify`;
        const create = { ops: [
            { op: "createMicroflow", module: C, name: "WF_Notify", parameters: [{ name: "Item", type: `${C}.Item` }], actions: [{ action: "log", message: "notify" }] },
            ...(pageable ? [{ op: "createPage", kind: "userTaskPage", module: C, name: "Check_Task", outcomes: ["Approve", "Reject"] }] : []),
            { op: "createWorkflow", module: C, name: "WF_Change", context: `${C}.Item`, steps: [
                ...(pageable ? [{ step: "userTask", name: "gReview", page: `${C}.Check_Task`, outcomes: ["Approve", "Reject"], timeout: { after: "addDays([%CurrentDateTime%], 3)", steps: [{ step: "callMicroflow", name: "gEscalate", microflow: notify }] } }] : []),
                { step: "callMicroflow", name: "gCall", microflow: notify, timeout: { after: "addHours([%CurrentDateTime%], 1)", interrupting: false, every: "Hour", interval: 2, times: 3, steps: [{ step: "callMicroflow", microflow: notify }] } },
                { step: "waitForNotification", name: "gWait", timeout: { after: "addDays([%CurrentDateTime%], 1)", steps: [{ step: "end", caption: "Gave up" }] } },
                { step: "decision", name: "gDec", condition: "$WorkflowContext/Total > 1", outcomes: { true: [{ step: "waitForTimer", name: "gTimer", delay: "addHours([%CurrentDateTime%], 1)" }], false: [] } }] }] };
        r = await integ.runPhase(env, s2, create, p => {
            const w = integ.unitsNamed(p, "WF_Change").WF_Change;
            const types = new Set();
            integ.walk(w || {}, o => types.add(o.$Type));
            return ["Workflows$InterruptingTimerBoundaryEvent", "Workflows$NonInterruptingTimerBoundaryEvent", "Workflows$LinearRecurrence"].filter(t => !types.has(t)).map(t => `${t} not stored`);
        });
        s2 = r.s;
        const firstProblems = r.problems;
        // refusals on the stored workflow
        const wfRefusals = [
            [{ op: "changeWorkflow", workflow: W, remove: ["end1"] }, /end of the main flow/, "removing the main end"],
            [{ op: "changeWorkflow", workflow: W, add: [{ after: "gCall", steps: [{ step: "end" }] }] }, /CE6679|CE6671/, "an end in the main flow"],
            [{ op: "changeWorkflow", workflow: W, remove: ["gCal"] }, /Did you mean: gCall/, "an unknown activity"],
            [{ op: "changeWorkflow", workflow: W, change: { gDec: { page: "X.Y" } } }, /has no field 'page'/, "a field the activity does not have"],
            [{ op: "changeWorkflow", workflow: W, change: { gWait: { timeout: { after: "[%CurrentDateTime%]", every: "Day" } } } }, /non-interrupting/, "a repeating interrupting timeout"],
            [{ op: "changeWorkflow", workflow: W, move: [{ activity: "gDec", into: "gDec", outcome: "true" }] }, /its own outcomes/, "a move into itself"],
            [{ op: "deleteWorkflowActivity", workflow: W, activity: "start1" }, /start of the main flow|has no activity/, "deleting the start"]
        ];
        for (const [o, re, what] of wfRefusals) s2 = await refuse(s2, { ops: [o] }, re, `changeWorkflow: ${what}`);
        const change = { ops: [{ op: "changeWorkflow", workflow: W, title: "Changed workflow", dueDate: "addDays([%CurrentDateTime%], 9)",
            add: [{ after: "gCall", steps: [{ step: "callMicroflow", name: "gAdded", microflow: notify }] }, { into: "gDec", outcome: "false", steps: [{ step: "jumpTo", name: "gBack", target: "gCall" }] }],
            move: [{ activity: "gWait", into: "gDec", outcome: "true" }],
            change: { gCall: { caption: "Notify now", timeout: null }, gTimer: { delay: "addHours([%CurrentDateTime%], 2)" },
                ...(pageable ? { gReview: { dueDate: "addDays([%CurrentDateTime%], 2)", assignee: null, outcomes: { add: ["Escalate"], rename: { Approve: "Accept" } } } } : {}) } }] };
        r = await integ.runPhase(env, s2, change, p => {
            const out = [];
            const w = integ.unitsNamed(p, "WF_Change").WF_Change;
            let jump = null, recurrence = false;
            integ.walk(w || {}, o => {
                if (o.$Type === "Workflows$JumpToActivity") jump = o;
                if (o.$Type === "Workflows$LinearRecurrence") recurrence = true;
            });
            if (!jump || jump.TargetActivity !== "gCall") out.push(`jump target ${jump && jump.TargetActivity}`);
            if (recurrence) out.push("gCall's timeout was not removed");
            if (pageable) {
                const page = integ.unitsNamed(p, "Check_Task").Check_Task;
                const vals = [];
                integ.walk(page || {}, o => o.$Type === "Forms$SetTaskOutcomeClientAction" && vals.push(o.OutcomeValue));
                if (vals.sort().join() !== "Accept,Escalate,Reject") out.push(`task page buttons: ${vals.join(", ")}`);
            }
            return out;
        });
        s2 = r.s;
        // the jump now targets gCall: removing gCall is refused; delete the timer instead
        s2 = await refuse(s2, { ops: [{ op: "deleteWorkflowActivity", workflow: W, activity: "gCall" }] }, /jump.*change the jump target/, "deleting a jump target");
        const del = await integ.runPhase(env, s2, { ops: [{ op: "deleteWorkflowActivity", workflow: W, activity: "gTimer" }] }, () => []);
        s2 = del.s;
        const all = [...firstProblems, ...r.problems, ...del.problems, ...problems];
        check(`changeWorkflow: timeouts (interrupting with an end, non-interrupting repeating), add after/into an outcome, jump, move into a decision outcome, change caption/delay/timeout${pageable ? "/user task due date, assignee, outcomes (task page buttons follow)" : ""}, ${wfRefusals.length + 1} refusals; deleteWorkflowActivity; stored, reopen 0 errors`, !all.length, all.slice(0, 5).join("; "));
    }
    return s2;
}

module.exports = { generalPhase, chainPlan, stubRuntime };
