"use strict";
// Workflows: workflow documents (context parameter, user tasks with task page, targeting and outcomes, decisions,
// parallel splits, call microflow / call workflow, jumps, timers, notification waits, ends), user task pages (a
// WorkflowUserTask parameter, the context object through a data source microflow, one button per outcome), and the
// microflow actions that drive workflows (call, complete a task, change the state, retrieve the context, jump-to
// options, lock, notify, open).
// No Studio Pro-saved workflow exists in the test projects: everything here is built from the Model SDK's metamodel for
// the project's Mendix version (the SDK's defaults are what Studio Pro writes for a new element), shaped by Studio
// Pro's rules as mxcli measured them on mxbuild: the context parameter is WorkflowContext, activities are named by
// type and ordinal (userTask1, decision1, ...), every outcome has a flow, a single-outcome user task keeps its flow
// empty (CE1876), a decision on an enumeration has an outcome per value plus an empty one (CE6686), task pages take
// System.WorkflowUserTask (CE7412), a jump target is an activity name, and an end or jump closes its path.
const sdk = require("mendixmodelsdk");
const { fail, bool, validName, noDollar, suggest, setIfAvailable } = require("./ops-util");
const { cmp } = require("./versions");

const { workflows: wf, microflows: mf, pages, datatypes, domainmodels: dm, enumerations, security } = sdk;

// System module members ops may name (the System module is not stored in the project).
const SYSTEM_ENTITIES = ["User", "UserRole", "Workflow", "WorkflowUserTask", "WorkflowDefinition", "WorkflowUserTaskDefinition", "WorkflowJumpToDetails", "WorkflowActivityRecord",
    "WorkflowGroup", "FileDocument", "Image", "HttpRequest", "HttpResponse", "Language", "TimeZone", "Session"].map(n => "System." + n);
// System associations: owner (parent) -> child, and Reference or ReferenceSet
const SYSTEM_ASSOCIATIONS = {
    "System.WorkflowUserTask_Workflow": ["System.WorkflowUserTask", "System.Workflow", false],
    "System.WorkflowUserTask_Assignees": ["System.WorkflowUserTask", "System.User", true],
    "System.WorkflowUserTask_TargetUsers": ["System.WorkflowUserTask", "System.User", true],
    "System.WorkflowUserTask_WorkflowUserTaskDefinition": ["System.WorkflowUserTask", "System.WorkflowUserTaskDefinition", false],
    "System.Workflow_WorkflowDefinition": ["System.Workflow", "System.WorkflowDefinition", false],
    "System.Workflow_ParentWorkflow": ["System.Workflow", "System.Workflow", false],
    "System.UserRoles": ["System.User", "System.UserRole", true]
};

const STEP_FIELDS = {
    userTask: {
        doc: "a task for a user: the task page opens it, an outcome button finishes it",
        fields: {
            caption: "optional text on the activity (default: User task)", page: "R Module.Page with a System.WorkflowUserTask parameter (createPage kind userTaskPage)",
            outcomes: "R [ \"Approve\", \"Reject\" ] or { \"Approve\": [ steps ], \"Reject\": [ steps ] } (one outcome: no steps of its own; the workflow continues after the task)",
            assignee: "optional { \"userRoles\": [ \"UserRole\" ] } | { \"xpath\": \"[...]\" } on the user entity | { \"microflow\": \"Module.Flow\" } returning a list of users (default: every user may pick it up)",
            taskName: "optional task name shown in the task inbox (default the caption)", description: "optional task description", dueDate: "optional DateTime expression, e.g. addDays([%CurrentDateTime%], 3)",
            onCreated: "optional Module.Microflow run when the task is created", autoAssign: "optional true: assign the task when exactly one user is targeted"
        }
    },
    decision: { doc: "branch on an expression of the context", fields: { caption: "optional text (default: the condition)", condition: "R Boolean or enumeration expression, e.g. $WorkflowContext/Amount > 1000", outcomes: "R { \"true\": [ steps ], \"false\": [ steps ] } or { \"Module.Enum.Value\": [ steps ], \"\": [ steps for no value ] }" } },
    parallelSplit: { doc: "run paths at the same time; the workflow continues when all are done", fields: { caption: "optional text (default: Parallel split)", paths: "R [ [ steps ], [ steps ] ] two or more" } },
    callMicroflow: { doc: "run a microflow", fields: { caption: "optional text (default: Call microflow)", microflow: "R Module.Microflow", args: "optional { \"Param\": \"expression\" } (default: the parameter of the context entity gets $WorkflowContext)", outcomes: "optional, when the microflow returns a Boolean or enumeration: { \"true\": [ steps ], \"false\": [ steps ] } / { \"Module.Enum.Value\": [ steps ], \"\": [ steps ] }" } },
    callWorkflow: { doc: "start another workflow and wait for it", fields: { caption: "optional text (default: Call workflow)", workflow: "R Module.Workflow", context: "optional expression for its context (default $WorkflowContext)", async: "optional true: do not wait" } },
    jumpTo: { doc: "go back (or forward) to an activity; ends its path", fields: { caption: "optional text (default: Jump)", target: "R name of an activity of this workflow, e.g. userTask1" } },
    waitForTimer: { doc: "wait until a moment (Mendix 10.6+)", fields: { caption: "optional text (default: Timer)", delay: "R DateTime expression, e.g. addHours([%CurrentDateTime%], 4)" } },
    waitForNotification: { doc: "wait until a microflow notifies the workflow (notifyWorkflow)", fields: { caption: "optional text (default: Wait for notification)" } },
    end: { doc: "end the whole workflow here (last step of a user task outcome or decision branch; not in a parallel path)", fields: { caption: "optional text (default: End)" } }
};
const STEP_COMMON = { step: "R the step kind", name: "optional activity name (default Studio Pro style: userTask1, decision1, ...); jumpTo targets it" };

const WORKFLOW_OPS = {
    createWorkflow: {
        doc: "Create a workflow: context entity, then steps (user tasks with page, assignee and outcomes, decisions, parallel splits, call microflow/workflow, jumps, timers, notification waits, ends).",
        fields: {
            module: "R module name", name: "R workflow name", context: "R Module.Entity the workflow is about (stored, e.g. Sales.Order); in expressions $WorkflowContext",
            steps: "R [ { \"step\": \"userTask | decision | parallelSplit | callMicroflow | callWorkflow | jumpTo | waitForTimer | waitForNotification | end\", ... } ] (fields: ops <step kind>, e.g. ops userTask)",
            title: "optional display name (default from the name)", description: "optional workflow description", dueDate: "optional DateTime expression",
            adminPage: "optional Module.Page with a System.Workflow parameter (the workflow admin page)",
            roles: "optional [ \"Module.Role\" ] may open the task pages and the admin page", folder: "optional folder path"
        }
    }
};

const USER_TASK_PAGE_FIELDS = {
    kind: "optional userTaskPage: a workflow user task page (parameter WorkflowUserTask, a button per outcome; title, folder, layout, roles as usual)",
    outcomes: "userTaskPage: R [ \"Approve\", \"Reject\" ] the user task's outcomes, one button each (Studio Pro: Complete user task)",
    workflow: "userTaskPage with entity: the Module.Workflow whose context the page shows (may be created later in the same plan)",
    editable: "userTaskPage with entity: true/false the context fields (default false)"
};

const STEP_PREFIX = { userTask: "userTask", decision: "decision", parallelSplit: "parallelSplit", callMicroflow: "callMicroflow", callWorkflow: "callWorkflow", jumpTo: "jumpTo", waitForTimer: "waitForTimer", waitForNotification: "waitForNotification", end: "end" };
const STEP_CAPTION = { userTask: "User task", parallelSplit: "Parallel split", callMicroflow: "Call microflow", callWorkflow: "Call workflow", jumpTo: "Jump", waitForTimer: "Timer", waitForNotification: "Wait for notification", end: "End" };

const humanize = s => String(s).replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
const load = async x => (x && !x.isLoaded && x.load ? x.load() : x);
const entityOfType = t => (t && (t.entityQualifiedName || (t.entity && t.entity.qualifiedName))) || null;

// ---------------------------------------------------------------- microflow actions (ops-flows.js)

// c: { f, h, model, expr, variableInfo, needVariable }. A System.X object variable, or an object of entity.
async function systemVar(c, name, entity, where) {
    const info = await c.variableInfo(name, where);
    if (info.list || info.entity !== entity) throw new Error(`${where}: '${noDollar(name)}' must be a ${entity} object (it is ${info.list ? "a list of " : ""}${info.entity || "not an object"})`);
    return noDollar(name);
}

// Workflows a user task page's data source microflow names before createWorkflow (later in the plan) makes them.
const LATE = new WeakMap();
const lateWorkflows = model => LATE.get(model) || LATE.set(model, new Set()).get(model);

async function workflowDoc(h, name, where, late = false) {
    const all = () => h.model.allWorkflows().map(x => x.qualifiedName);
    if (late && lateWorkflows(h.model).has(name) && !h.model.allWorkflows().some(x => x.qualifiedName === name)) return null;
    const d = await h.get(name).catch(() => fail(`${where}: no workflow ${name}`, name, all()));
    if (!(d instanceof wf.Workflow)) fail(`${where}: ${name} is not a workflow`, name, all());
    return d;
}

const contextOf = d => d.parameter && d.parameter.entityQualifiedName;
const named = v => ({ entity: v, list: false });

const OPERATIONS = { abort: "AbortOperation", continue: "ContinueOperation", pause: "PauseOperation", unpause: "UnpauseOperation", restart: "RestartOperation", retry: "RetryOperation" };

const WORKFLOW_ACTIONS = {
    callWorkflow: {
        doc: "Start a workflow for a context object (microflows only); 'variable' gets the System.Workflow.",
        fields: { workflow: "R Module.Workflow", context: "R object variable of the workflow's context entity (no $)", variable: "optional System.Workflow result variable" },
        only: "micro", creates: "variable", type: () => mf.WorkflowCallAction,
        async build(c, act, spec, where) {
            const d = await workflowDoc(c.h, spec.workflow, where);
            const ent = await c.needVariable(spec.context, false, where);
            if (contextOf(d) && ent !== contextOf(d)) throw new Error(`${where}: ${spec.workflow} takes ${contextOf(d)}, but $${noDollar(spec.context)} is ${ent}`);
            const a = mf.WorkflowCallAction.createIn(act);
            a.workflow = d;
            a.workflowContextVariable = noDollar(spec.context);
            a.useReturnVariable = !!spec.variable;
            a.outputVariableName = spec.variable ? noDollar(spec.variable) : "";
            return a;
        },
        info: () => named("System.Workflow"),
        describe: a => `CALL WORKFLOW ${a.workflowQualifiedName} WITH $${a.workflowContextVariable}${a.useReturnVariable && a.outputVariableName ? " -> $" + a.outputVariableName : ""}`
    },
    completeUserTask: {
        doc: "Complete a user task with one of its outcomes (Studio Pro: Complete user task; the task must be assigned to the current user).",
        fields: { task: "R System.WorkflowUserTask variable (no $)", outcome: "R outcome of the user task, e.g. Approve" },
        type: () => mf.SetTaskOutcomeAction,
        async build(c, act, spec, where) {
            const a = mf.SetTaskOutcomeAction.createIn(act);
            a.workflowTaskVariable = await systemVar(c, spec.task, "System.WorkflowUserTask", where);
            if (!String(spec.outcome).trim()) throw new Error(`${where}: outcome is the name of an outcome of the user task`);
            a.outcomeValue = String(spec.outcome);
            return a;
        },
        describe: a => `COMPLETE TASK $${a.workflowTaskVariable} '${a.outcomeValue}'`
    },
    changeWorkflowState: {
        doc: "Abort, pause, unpause, continue, restart or retry a workflow (Studio Pro: Change workflow state).",
        fields: { workflow: "R System.Workflow variable (no $)", operation: "R abort | pause | unpause | continue | restart | retry", reason: "abort: optional reason text" },
        type: () => mf.WorkflowOperationAction,
        async build(c, act, spec, where) {
            const name = OPERATIONS[String(spec.operation).toLowerCase()];
            if (!name) fail(`${where}: operation '${spec.operation}' is not one of ${Object.keys(OPERATIONS).join(" | ")}`, spec.operation, Object.keys(OPERATIONS));
            if (spec.reason !== undefined && name !== "AbortOperation") throw new Error(`${where}: 'reason' only applies to abort`);
            const variable = await systemVar(c, spec.workflow, "System.Workflow", where);
            const a = mf.WorkflowOperationAction.createIn(act);
            const op = mf[name].createIn(a);
            op.workflowVariable = variable;
            if (name === "AbortOperation") c.fillTemplate(op.reason, spec.reason || "", [], where);
            return a;
        },
        describe: a => `WORKFLOW ${a.operation ? a.operation.structureTypeName.split("$")[1].replace("Operation", "").toUpperCase() : "?"} $${a.operation ? a.operation.workflowVariable : "?"}`
    },
    retrieveWorkflowContext: {
        doc: "Get the context object of a workflow (Studio Pro: Retrieve workflow context).",
        fields: { workflow: "R System.Workflow variable (no $)", definition: "R Module.Workflow (says the context entity)", variable: "R result variable" },
        creates: "variable", type: () => mf.GetWorkflowDataAction,
        async build(c, act, spec, where) {
            const d = await workflowDoc(c.h, spec.definition, where, true);
            const a = mf.GetWorkflowDataAction.createIn(act);
            a.workflowVariable = await systemVar(c, spec.workflow, "System.Workflow", where);
            if (d) a.workflow = d;
            else a.__workflow.updateWithRawValue(spec.definition); // created later in this plan
            a.outputVariableName = noDollar(spec.variable);
            return a;
        },
        async info(a) {
            const d = await load(a.workflow);
            return named(d ? contextOf(d) : null);
        },
        describe: a => `RETRIEVE CONTEXT $${a.outputVariableName} OF $${a.workflowVariable} (${a.workflowQualifiedName})`
    },
    retrieveWorkflows: {
        doc: "Get the workflows of a context object (Mendix 10.4+, Studio Pro: Retrieve workflows).",
        fields: { context: "R object variable (no $)", variable: "R result list of System.Workflow" },
        creates: "variable", type: () => mf.GetWorkflowsAction,
        async build(c, act, spec, where) {
            await c.needVariable(spec.context, false, where);
            const a = mf.GetWorkflowsAction.createIn(act);
            a.workflowContextVariableName = noDollar(spec.context);
            a.outputVariableName = noDollar(spec.variable);
            return a;
        },
        info: () => ({ entity: "System.Workflow", list: true }),
        describe: a => `RETRIEVE WORKFLOWS $${a.outputVariableName} OF $${a.workflowContextVariableName}`
    },
    retrieveActivityRecords: {
        doc: "Get the activity records of a workflow (Mendix 10.4+, Studio Pro: Retrieve workflow activity records).",
        fields: { workflow: "R System.Workflow variable (no $)", variable: "R result list of System.WorkflowActivityRecord" },
        creates: "variable", type: () => mf.GetWorkflowActivityRecordsAction,
        async build(c, act, spec, where) {
            const a = mf.GetWorkflowActivityRecordsAction.createIn(act);
            a.workflowVariable = await systemVar(c, spec.workflow, "System.Workflow", where);
            a.outputVariableName = noDollar(spec.variable);
            return a;
        },
        info: () => ({ entity: "System.WorkflowActivityRecord", list: true }),
        describe: a => `RETRIEVE ACTIVITY RECORDS $${a.outputVariableName} OF $${a.workflowVariable}`
    },
    generateJumpToOptions: {
        doc: "Make the jump-to options of a workflow, to let an admin pick where it continues (Studio Pro: Generate jump-to options).",
        fields: { workflow: "R System.Workflow variable (no $)", variable: "R result System.WorkflowJumpToDetails variable" },
        creates: "variable", type: () => mf.GenerateJumpToOptionsAction,
        async build(c, act, spec, where) {
            const a = mf.GenerateJumpToOptionsAction.createIn(act);
            a.workflowVariable = await systemVar(c, spec.workflow, "System.Workflow", where);
            a.outputVariableName = noDollar(spec.variable);
            return a;
        },
        info: () => named("System.WorkflowJumpToDetails"),
        describe: a => `GENERATE JUMP-TO OPTIONS $${a.outputVariableName} OF $${a.workflowVariable}`
    },
    applyJumpTo: {
        doc: "Move a workflow to the chosen jump-to option (Studio Pro: Apply jump-to option).",
        fields: { details: "R System.WorkflowJumpToDetails variable (no $)", variable: "optional result System.Workflow variable" },
        creates: "variable", type: () => mf.ApplyJumpToOptionAction,
        async build(c, act, spec, where) {
            const a = mf.ApplyJumpToOptionAction.createIn(act);
            a.workflowJumpToDetailsVariable = await systemVar(c, spec.details, "System.WorkflowJumpToDetails", where);
            a.outputVariableName = spec.variable ? noDollar(spec.variable) : "";
            return a;
        },
        info: () => named("System.Workflow"),
        describe: a => `APPLY JUMP-TO $${a.workflowJumpToDetailsVariable}${a.outputVariableName ? " -> $" + a.outputVariableName : ""}`
    },
    lockWorkflow: {
        doc: "Lock (or unlock) a workflow definition: no new instances start (Studio Pro: Lock/Unlock workflow).",
        fields: { workflow: "R Module.Workflow", unlock: "optional true: unlock", pauseAll: "optional true: lock pauses running instances, unlock resumes the paused ones" },
        type: () => mf.LockWorkflowAction,
        async build(c, act, spec, where) {
            const d = await workflowDoc(c.h, spec.workflow, where);
            const unlock = bool(spec.unlock, false);
            const a = (unlock ? mf.UnlockWorkflowAction : mf.LockWorkflowAction).createIn(act);
            const sel = unlock ? wf.WorkflowDefinitionNameSelection.createInUnlockWorkflowActionUnderWorkflowSelection(a) : wf.WorkflowDefinitionNameSelection.createInLockWorkflowActionUnderWorkflowSelection(a);
            sel.workflow = d;
            if (unlock) a.resumeAllPausedWorkflows = bool(spec.pauseAll, false);
            else a.pauseAllWorkflows = bool(spec.pauseAll, false);
            return a;
        },
        describe: a => `LOCK WORKFLOW ${a.workflowSelection && a.workflowSelection.workflowQualifiedName}`
    },
    notifyWorkflow: {
        doc: "Let a workflow continue at its waitForNotification step (Studio Pro: Notify workflow); 'variable' gets true when it did.",
        fields: { workflow: "R System.Workflow variable (no $)", definition: "R Module.Workflow", activity: "R name of its waitForNotification step", variable: "optional Boolean result variable" },
        creates: "variable", type: () => mf.NotifyWorkflowAction,
        async build(c, act, spec, where) {
            const d = await workflowDoc(c.h, spec.definition, where);
            const waits = [];
            d.traverse(x => x instanceof wf.WaitForNotificationActivity && waits.push(x));
            const target = waits.find(x => x.name === spec.activity);
            if (!target) fail(`${where}: ${spec.definition} has no waitForNotification step '${spec.activity}'`, spec.activity, waits.map(x => x.name));
            const a = mf.NotifyWorkflowAction.createIn(act);
            a.workflowVariable = await systemVar(c, spec.workflow, "System.Workflow", where);
            if (cmp(String(c.model.metaModelVersion), "11.7.0") >= 0) {
                const t = wf.NotifyWaitForNotificationActivityTarget.create(c.model);
                a.notifyTarget = t;
                t.activity = target;
            }
            else a.activity = target;
            a.outputVariableName = spec.variable ? noDollar(spec.variable) : "";
            return a;
        },
        info: () => ({ entity: null, list: false }),
        describe: a => `NOTIFY WORKFLOW $${a.workflowVariable}${a.outputVariableName ? " -> $" + a.outputVariableName : ""}`
    },
    openUserTask: {
        doc: "Open the page of a user task (Studio Pro: Show user task page).",
        fields: { task: "R System.WorkflowUserTask variable (no $)", assign: "optional true/false: assign it to the current user when opened (default true)" },
        type: () => mf.OpenUserTaskAction,
        async build(c, act, spec, where) {
            const a = mf.OpenUserTaskAction.createIn(act);
            a.userTaskVariable = await systemVar(c, spec.task, "System.WorkflowUserTask", where);
            a.assignOnOpen = bool(spec.assign, true);
            a.openWhenAssigned = true;
            return a;
        },
        describe: a => `OPEN USER TASK $${a.userTaskVariable}`
    },
    openWorkflow: {
        doc: "Open the admin page of a workflow (Studio Pro: Show workflow admin page).",
        fields: { workflow: "R System.Workflow variable (no $)" },
        type: () => mf.OpenWorkflowAction,
        async build(c, act, spec, where) {
            const a = mf.OpenWorkflowAction.createIn(act);
            a.workflowVariable = await systemVar(c, spec.workflow, "System.Workflow", where);
            return a;
        },
        describe: a => `OPEN WORKFLOW $${a.workflowVariable}`
    }
};

// ---------------------------------------------------------------- bound operations

function makeWorkflows(h) {
    const { model, get, exists, folder, version } = h;
    const atLeast = v => cmp(version, v) >= 0;
    const warn = w => h.client && h.client.warn(w);

    const pageParamEntities = page => [...(page.parameters || [])].map(p => entityOfType(p.parameterType));

    async function pageOf(name, wantEntity, where) {
        const p = await get(name).catch(() => fail(`${where}: no page ${name}`, name, model.allPages().map(x => x.qualifiedName)));
        if (!(p instanceof pages.Page)) throw new Error(`${where}: ${name} is not a page`);
        const ents = pageParamEntities(p);
        if (!ents.includes(wantEntity)) throw new Error(`${where}: ${name} needs a parameter of ${wantEntity}${wantEntity === "System.WorkflowUserTask" ? ` (Studio Pro CE7412); make one with createPage "kind": "userTaskPage"` : ""} (its parameters: ${ents.join(", ") || "none"})`);
        return p;
    }

    async function userRoleNames() {
        const ps = model.allProjectSecurities()[0];
        return ps ? (await ps.load()).userRoles.map(r => r.name) : [];
    }

    // ------------------------------------------------ createWorkflow

    async function createWorkflow(o) {
        validName(o.name, "workflow name");
        const qn = `${o.module}.${o.name}`;
        if (await exists(qn)) throw new Error(`${qn} already exists`);
        const ctxEnt = await h.entity(o.context);
        if (!h.persistable(ctxEnt)) throw new Error(`${o.context} is not stored (persistable); a workflow context must be a stored entity`);
        if (!Array.isArray(o.steps) || !o.steps.length) throw new Error(`${qn} needs steps: [ { "step": "userTask", ... } ]`);
        const settings = model.allProjectSettings()[0];
        const ws = settings && (await settings.load()).settingsParts.find(p => p instanceof sdk.settings.WorkflowsProjectSettingsPart);
        if (!ws || !ws.userEntityQualifiedName) warn(`App settings > Workflows has no user entity: set it in Studio Pro (usually System.User) before running ${qn}`);
        await h.loadParents(ctxEnt);
        const d = wf.Workflow.createIn(folder(o.module, o.folder));
        d.name = o.name;
        lateWorkflows(model).delete(qn);
        d.title = o.title === undefined ? humanize(o.name) : String(o.title);
        d.workflowName.text = d.title;
        d.workflowDescription.text = String(o.description || "");
        d.dueDate = String(o.dueDate || "");
        d.parameter.name = "WorkflowContext";
        d.parameter.entity = ctxEnt;
        if (o.adminPage) {
            const ap = await pageOf(o.adminPage, "System.Workflow", `${qn} adminPage`);
            wf.PageReference.createInWorkflowUnderAdminPage(d).page = ap;
        }
        const st = { qn, d, ctxEnt, names: new Map(), used: new Set(), jumps: [], all: [], pages: new Set(o.adminPage ? [o.adminPage] : []), count: {}, userRoles: null };
        // names given by the plan first, so generated ones (userTask1, ...) do not take them
        const reserve = (list, where) => {
            for (const [i, s] of (list || []).entries()) {
                if (!s || typeof s !== "object") continue;
                if (s.name !== undefined) {
                    validName(s.name, "activity name");
                    if (st.used.has(s.name)) throw new Error(`${where} step ${i + 1}: the name '${s.name}' is used twice (Studio Pro CE0495)`);
                    st.used.add(s.name);
                }
                for (const sub of nestedOf(s)) reserve(sub, where);
            }
        };
        reserve(o.steps, qn);
        // the main flow's start and end are start1 / end1 (Studio Pro's names), branch ends end2, ...
        const mainEnd = st.used.has("end1") ? null : "end1";
        if (mainEnd) st.used.add(mainEnd);
        if (atLeast("11.1.0")) activity(st, d.flow, wf.StartWorkflowActivity, "start", "Start", st.used.has("start1") ? null : "start1");
        await steps(st, d.flow, o.steps, qn, { parallel: false, main: true });
        const last = d.flow.activities[d.flow.activities.length - 1];
        if (last instanceof wf.EndWorkflowActivity || last instanceof wf.JumpToActivity) throw new Error(`${qn}: the main flow cannot end with an end or jumpTo step (it ends by itself; CE6679)`);
        if (endsAll(d.flow)) throw new Error(`${qn}: every path ends (end/jumpTo), so the workflow end is never reached (Studio Pro CE6689); let one path continue`);
        activity(st, d.flow, wf.EndWorkflowActivity, "end", "End", mainEnd);
        for (const j of st.jumps) {
            const target = st.all.find(x => x.name === j.target);
            if (!target) fail(`${j.where}: jumpTo target '${j.target}' is no activity of ${qn}`, j.target, st.all.filter(x => !(x instanceof wf.JumpToActivity) && !(x instanceof wf.EndWorkflowActivity)).map(x => x.name));
            if (target instanceof wf.EndWorkflowActivity || target instanceof wf.JumpToActivity || target instanceof wf.StartWorkflowActivity) throw new Error(`${j.where}: cannot jump to ${j.target}, an end/jumpTo/start activity (Studio Pro CE6681)`);
            j.act.targetActivity = target;
        }
        if (o.roles) for (const p of st.pages) await h.grantAccess({ document: p, roles: o.roles });
        warn(`Workflows$Workflow first use by ops (no Studio Pro sample in the test projects; built from the Model SDK metamodel of Mendix ${version}): open ${qn} in Studio Pro and check it`);
        const kinds = Object.entries(st.count).map(([k, n]) => `${n} ${k}`).join(", ");
        return `${qn} (context ${o.context}; ${kinds})`;
    }

    const nestedOf = s => {
        const out = [];
        if (s.outcomes && typeof s.outcomes === "object" && !Array.isArray(s.outcomes)) out.push(...Object.values(s.outcomes).filter(Array.isArray));
        if (Array.isArray(s.paths)) out.push(...s.paths.filter(Array.isArray));
        return out;
    };

    // Does every path of this flow end in an end or jump?
    function endsAll(flow) {
        const acts = [...flow.activities];
        const last = acts[acts.length - 1];
        if (!last) return false;
        if (last instanceof wf.EndWorkflowActivity || last instanceof wf.JumpToActivity) return true;
        for (const a of acts) {
            const outs = a.outcomes ? [...a.outcomes] : [];
            if (outs.length > 1 && !(a instanceof wf.ParallelSplitActivity) && outs.every(x => endsAll(x.flow))) return true;
        }
        return false;
    }

    function activity(st, flow, T, kind, caption, name) {
        const a = T.createInFlowUnderActivities(flow);
        if (!name) {
            for (let i = 1; ; i++) {
                const n = `${STEP_PREFIX[kind] || kind}${i}`;
                if (!st.used.has(n)) {
                    name = n;
                    break;
                }
            }
        }
        st.used.add(name);
        a.name = name;
        a.caption = caption;
        st.all.push(a);
        st.count[kind] = (st.count[kind] || 0) + 1;
        return a;
    }

    // $WorkflowContext/Attribute paths of an expression: the attribute must exist (Studio Pro CE0117 otherwise)
    function checkExpr(st, e, where) {
        const s = String(e);
        for (const m of s.matchAll(/\$(\w+)/g)) {
            if (!["WorkflowContext", "Workflow", "currentUser", "currentObject"].includes(m[1])) fail(`${where}: $${m[1]} is not available in a workflow; use $WorkflowContext (the ${st.ctxEnt.qualifiedName}) or $Workflow`, m[1], ["WorkflowContext", "Workflow"]);
        }
        const chain = h.attributeChain(st.ctxEnt);
        for (const m of s.matchAll(/\$WorkflowContext\/(\w+)(?![.\w])/g)) {
            if (!chain.complete) break;
            if (!chain.attributes.some(a => a.name === m[1])) fail(`${where}: ${st.ctxEnt.qualifiedName} has no attribute '${m[1]}'`, m[1], chain.attributes.map(a => a.name));
        }
        return s;
    }

    // The type an expression decides on: { kind: "boolean" } or { kind: "enum", enumeration } (from the outcome keys).
    async function outcomeKind(keys, where) {
        const k = keys.map(String);
        if (k.every(x => /^(true|false)$/i.test(x))) return { kind: "boolean" };
        const qns = k.filter(x => x !== "");
        if (!qns.length || qns.some(x => x.split(".").length !== 3)) throw new Error(`${where}: outcomes are { "true": [...], "false": [...] } or { "Module.Enumeration.Value": [...], "": [...] } (the full enumeration value name)`);
        const enumQn = qns[0].split(".").slice(0, 2).join(".");
        const en = await get(enumQn).catch(() => fail(`${where}: no enumeration ${enumQn}`, enumQn, model.allEnumerations().map(x => x.qualifiedName)));
        if (!(en instanceof enumerations.Enumeration)) throw new Error(`${where}: ${enumQn} is not an enumeration`);
        for (const q of qns) {
            if (!q.startsWith(enumQn + ".")) throw new Error(`${where}: outcomes mix enumerations (${enumQn} and ${q})`);
            if (!en.values.some(v => v.name === q.split(".")[2])) fail(`${where}: ${enumQn} has no value '${q.split(".")[2]}'`, q.split(".")[2], en.values.map(v => v.name));
        }
        return { kind: "enum", enumeration: en };
    }

    // Condition outcomes of a decision or a call microflow: true/false both, or every enumeration value and the empty one.
    async function conditionOutcomes(st, a, spec, outcomes, ctx, where) {
        const keys = Object.keys(outcomes);
        const ok = await outcomeKind(keys, where);
        const branch = async (oc, key) => {
            await steps(st, oc.flow, outcomes[key] || [], `${where} outcome ${key || "(empty)"}`, { ...ctx, branch: true });
        };
        if (ok.kind === "boolean") {
            for (const v of [true, false]) {
                const oc = wf.BooleanConditionOutcome.createIn(a);
                oc.value = v;
                await branch(oc, keys.find(k => k.toLowerCase() === String(v)));
            }
            return ok;
        }
        for (const v of ok.enumeration.values) {
            const oc = wf.EnumerationValueConditionOutcome.createIn(a);
            oc.value = v;
            await branch(oc, keys.find(k => k === `${ok.enumeration.qualifiedName}.${v.name}`));
        }
        await branch(wf.VoidConditionOutcome.createIn(a), keys.find(k => k === ""));
        return ok;
    }

    async function steps(st, flow, list, where, ctx) {
        if (!Array.isArray(list)) throw new Error(`${where}: steps are a list [ { "step": ... } ]`);
        for (const [i, s] of list.entries()) {
            const at = `${where} step ${i + 1}`;
            if (!s || typeof s !== "object") throw new Error(`${at}: each step is { "step": "userTask", ... }`);
            const kind = Object.keys(STEP_FIELDS).find(k => k.toLowerCase() === String(s.step).toLowerCase());
            if (!kind) fail(`${at}: unknown step '${s.step}'`, s.step, Object.keys(STEP_FIELDS));
            const fields = { ...STEP_FIELDS[kind].fields, ...STEP_COMMON };
            for (const k of Object.keys(s)) if (!fields[k]) fail(`${at} (${kind}): unknown field '${k}'`, k, Object.keys(fields));
            for (const [k, d] of Object.entries(fields)) if (d.startsWith("R ") && (s[k] === undefined || s[k] === "")) throw new Error(`${at} (${kind}): needs '${k}' (${d.slice(2)})`);
            const closes = kind === "end" || kind === "jumpTo";
            if (closes && i !== list.length - 1) throw new Error(`${at}: ${kind} ends its path; nothing may follow it (Studio Pro CE6671)`);
            if (closes && ctx.main) throw new Error(`${at}: ${kind} cannot be a step of the main flow; put it at the end of an outcome branch (Studio Pro CE6679)`);
            if (kind === "end" && ctx.parallel) throw new Error(`${at}: a parallel path cannot end the workflow (Studio Pro CE1844); let the path finish`);
            await STEPS[kind](st, flow, s, `${at} (${kind}${s.name ? " " + s.name : ""})`, ctx);
        }
    }

    const STEPS = {
        async userTask(st, flow, s, where, ctx) {
            const ut = activity(st, flow, wf.SingleUserTaskActivity, "userTask", s.caption === undefined ? STEP_CAPTION.userTask : String(s.caption), s.name);
            const page = await pageOf(s.page, "System.WorkflowUserTask", where);
            ut.taskPage.page = page;
            st.pages.add(s.page);
            ut.taskName.text = s.taskName === undefined ? ut.caption : String(s.taskName);
            ut.taskDescription.text = String(s.description || "");
            ut.dueDate = s.dueDate === undefined ? "" : checkExpr(st, s.dueDate, `${where} dueDate`);
            ut.autoAssignSingleTargetUser = bool(s.autoAssign, false);
            await assignee(st, ut, s.assignee, where);
            if (s.onCreated) {
                const m = await get(s.onCreated);
                if (!(m instanceof mf.Microflow)) throw new Error(`${where}: onCreated ${s.onCreated} is not a microflow`);
                wf.MicroflowBasedEvent.createInUserTaskActivityUnderOnCreatedEvent(ut).microflow = m;
            }
            const outs = Array.isArray(s.outcomes) ? Object.fromEntries(s.outcomes.map(x => [x, []])) : s.outcomes;
            if (!outs || typeof outs !== "object" || !Object.keys(outs).length) throw new Error(`${where}: outcomes is [ "Approve", "Reject" ] or { "Approve": [ steps ], ... }`);
            const keys = Object.keys(outs);
            if (keys.length === 1 && (outs[keys[0]] || []).length) throw new Error(`${where}: a user task with one outcome has no steps of its own (Studio Pro CE1876); put them after the task`);
            for (const k of keys) {
                if (!String(k).trim()) throw new Error(`${where}: an outcome needs a name`);
                const oc = wf.UserTaskOutcome.createInUserTaskActivityUnderOutcomes(ut);
                oc.value = String(k);
                await steps(st, oc.flow, outs[k] || [], `${where} outcome ${k}`, { ...ctx, branch: true, main: false });
            }
        },
        async decision(st, flow, s, where, ctx) {
            const a = activity(st, flow, wf.ExclusiveSplitActivity, "decision", s.caption === undefined ? String(s.condition) : String(s.caption), s.name);
            a.expression = checkExpr(st, s.condition, `${where} condition`);
            if (typeof s.outcomes !== "object" || Array.isArray(s.outcomes)) throw new Error(`${where}: outcomes is { "true": [ steps ], "false": [ steps ] }`);
            await conditionOutcomes(st, a, s, s.outcomes, { ...ctx, main: false }, where);
        },
        async parallelSplit(st, flow, s, where, ctx) {
            if (!Array.isArray(s.paths) || s.paths.length < 2) throw new Error(`${where}: paths is [ [ steps ], [ steps ] ] (two or more)`);
            const a = activity(st, flow, wf.ParallelSplitActivity, "parallelSplit", s.caption === undefined ? STEP_CAPTION.parallelSplit : String(s.caption), s.name);
            for (const [i, p] of s.paths.entries()) {
                const oc = wf.ParallelSplitOutcome.createIn(a);
                await steps(st, oc.flow, p, `${where} path ${i + 1}`, { ...ctx, parallel: true, main: false });
            }
        },
        async callMicroflow(st, flow, s, where, ctx) {
            const m = await get(s.microflow).catch(() => fail(`${where}: no microflow ${s.microflow}`, s.microflow, model.allMicroflows().map(x => x.qualifiedName)));
            if (!(m instanceof mf.Microflow)) throw new Error(`${where}: ${s.microflow} is not a microflow`);
            const T = atLeast("11.9.0") ? wf.CallMicroflowActivity : wf.CallMicroflowTask;
            const a = activity(st, flow, T, "callMicroflow", s.caption === undefined ? STEP_CAPTION.callMicroflow : String(s.caption), s.name);
            a.microflow = m;
            const params = m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject);
            const args = s.args || {};
            if (typeof args !== "object" || Array.isArray(args)) throw new Error(`${where}: args is { "Param": "expression" }`);
            for (const k of Object.keys(args)) if (!params.some(p => p.name === k)) fail(`${where}: ${s.microflow} has no parameter '${k}'`, k, params.map(p => p.name));
            for (const p of params) {
                let e = args[p.name];
                if (e === undefined && entityOfType(p.variableType) === st.ctxEnt.qualifiedName && !(p.variableType instanceof datatypes.ListType)) e = "$WorkflowContext";
                if (e === undefined && entityOfType(p.variableType) === "System.Workflow") e = "$Workflow";
                if (e === undefined) throw new Error(`${where}: ${s.microflow} parameter '${p.name}' needs a value in args (an expression)`);
                const pm = atLeast("11.9.0") ? wf.MicroflowCallParameterMapping.createInMicroflowBasedActivityUnderParameterMappings(a) : wf.MicroflowCallParameterMapping.createInCallMicroflowTaskUnderParameterMappings(a);
                pm.parameter = p;
                pm.expression = checkExpr(st, e, `${where} ${p.name}`);
            }
            const ret = m.microflowReturnType;
            const branches = ret instanceof datatypes.BooleanType || ret instanceof datatypes.EnumerationType;
            if (s.outcomes !== undefined) {
                if (!branches) throw new Error(`${where}: outcomes need a microflow that returns a Boolean or an enumeration (${s.microflow} does not)`);
                if (typeof s.outcomes !== "object" || Array.isArray(s.outcomes)) throw new Error(`${where}: outcomes is { "true": [ steps ], "false": [ steps ] }`);
                const ok = await conditionOutcomes(st, a, s, s.outcomes, { ...ctx, main: false }, where);
                if (ok.kind === "boolean" && !(ret instanceof datatypes.BooleanType)) throw new Error(`${where}: ${s.microflow} returns an enumeration; outcomes are its values`);
                if (ok.kind === "enum" && !(ret instanceof datatypes.EnumerationType && ret.enumerationQualifiedName === ok.enumeration.qualifiedName)) throw new Error(`${where}: ${s.microflow} does not return ${ok.enumeration.qualifiedName}`);
            } else if (branches) {
                // Studio Pro makes the outcomes of the return type (CE6686 otherwise); without steps of their own
                const keys = ret instanceof datatypes.BooleanType ? ["true", "false"] : [...(await load(ret.enumeration)).values].map(v => `${ret.enumerationQualifiedName}.${v.name}`).concat("");
                await conditionOutcomes(st, a, s, Object.fromEntries(keys.map(k => [k, []])), { ...ctx, main: false }, where);
            }
        },
        async callWorkflow(st, flow, s, where, ctx) {
            const target = await workflowDoc(h, s.workflow, where);
            const a = activity(st, flow, wf.CallWorkflowActivity, "callWorkflow", s.caption === undefined ? STEP_CAPTION.callWorkflow : String(s.caption), s.name);
            a.workflow = target;
            a.executeAsync = bool(s.async, false);
            if (s.context === undefined && contextOf(target) !== st.ctxEnt.qualifiedName) throw new Error(`${where}: ${s.workflow} takes ${contextOf(target)}; give "context": an expression of that entity`);
            const pm = wf.WorkflowCallParameterMapping.create(model);
            a.parameterMappings.push(pm);
            pm.parameter = target.parameter;
            pm.expression = checkExpr(st, s.context === undefined ? "$WorkflowContext" : s.context, `${where} context`);
        },
        async jumpTo(st, flow, s, where) {
            const a = activity(st, flow, wf.JumpToActivity, "jumpTo", s.caption === undefined ? STEP_CAPTION.jumpTo : String(s.caption), s.name);
            st.jumps.push({ act: a, target: String(s.target), where });
        },
        async waitForTimer(st, flow, s, where) {
            if (!atLeast("10.6.0")) throw new Error(`${where}: waitForTimer needs Mendix 10.6 (this project is ${version})`);
            const a = activity(st, flow, wf.WaitForTimerActivity, "waitForTimer", s.caption === undefined ? STEP_CAPTION.waitForTimer : String(s.caption), s.name);
            a.delay = checkExpr(st, s.delay, `${where} delay`);
        },
        async waitForNotification(st, flow, s, where) {
            activity(st, flow, wf.WaitForNotificationActivity, "waitForNotification", s.caption === undefined ? STEP_CAPTION.waitForNotification : String(s.caption), s.name);
        },
        async end(st, flow, s, where) {
            activity(st, flow, wf.EndWorkflowActivity, "end", s.caption === undefined ? STEP_CAPTION.end : String(s.caption), s.name);
        }
    };

    // Who sees the task: user roles (an XPath on the user entity), an XPath, a microflow, or everyone.
    async function assignee(st, ut, spec, where) {
        const v11 = atLeast("11.2.0");
        if (spec === undefined || spec === null) {
            if (v11) wf.NoUserTargeting.createIn(ut);
            else wf.EmptyUserSource.createInUserTaskActivityUnderUserSource(ut);
            return;
        }
        if (typeof spec !== "object" || Array.isArray(spec) || Object.keys(spec).length !== 1) throw new Error(`${where}: assignee is { "userRoles": [ ... ] }, { "xpath": "[...]" } or { "microflow": "Module.Flow" }`);
        const [k, v] = Object.entries(spec)[0];
        if (k === "userRoles") {
            const all = st.userRoles || (st.userRoles = await userRoleNames());
            const roles = [].concat(v);
            for (const r of roles) if (!all.includes(r)) fail(`${where}: no user role '${r}' (user roles are project-wide, e.g. Administrator)`, r, all);
            const xpath = "[" + roles.map(r => `System.UserRoles = '[%UserRole_${r}%]'`).join(" or ") + "]";
            if (v11) wf.XPathUserTargeting.createIn(ut).xPathConstraint = xpath;
            else wf.XPathBasedUserSource.createInUserTaskActivityUnderUserSource(ut).xPathConstraint = xpath;
        } else if (k === "xpath") {
            const x = String(v).trim();
            if (!/^\[.*\]$/s.test(x)) throw new Error(`${where}: assignee xpath is a constraint in brackets, e.g. [Active = true()]`);
            if (v11) wf.XPathUserTargeting.createIn(ut).xPathConstraint = x;
            else wf.XPathBasedUserSource.createInUserTaskActivityUnderUserSource(ut).xPathConstraint = x;
        } else if (k === "microflow") {
            const m = await get(v).catch(() => fail(`${where}: no microflow ${v}`, v, model.allMicroflows().map(x => x.qualifiedName)));
            if (!(m instanceof mf.Microflow)) throw new Error(`${where}: ${v} is not a microflow`);
            const ret = m.microflowReturnType;
            if (!(ret instanceof datatypes.ListType)) throw new Error(`${where}: ${v} must return a list of users (List(System.User) or the app's user entity)`);
            for (const p of m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject)) {
                const e = entityOfType(p.variableType);
                if (e !== st.ctxEnt.qualifiedName && e !== "System.Workflow") throw new Error(`${where}: ${v} parameter '${p.name}' must be the context (${st.ctxEnt.qualifiedName}) or System.Workflow (Studio Pro CE6677)`);
            }
            if (v11) wf.MicroflowUserTargeting.createIn(ut).microflow = m;
            else wf.MicroflowBasedUserSource.createInUserTaskActivityUnderUserSource(ut).microflow = m;
        } else fail(`${where}: assignee '${k}' is not userRoles, xpath or microflow`, k, ["userRoles", "xpath", "microflow"]);
    }

    // ------------------------------------------------ user task page

    // createPage kind userTaskPage: the page from createPage (layout, title, roles), then a WorkflowUserTask parameter,
    // a data view of it with one Complete user task button per outcome and a Close button, and (with entity) the
    // context object in a data view inside it, from a microflow that retrieves the workflow context.
    async function userTaskPage(o, createPage) {
        const where = `${o.module}.${o.name}`;
        const outcomes = [].concat(o.outcomes || []);
        if (!outcomes.length) throw new Error(`${where}: a userTaskPage needs outcomes: [ "Approve", "Reject" ] (the user task's outcomes)`);
        if (o.widgets !== undefined) throw new Error(`${where}: a userTaskPage takes entity and fields, not widgets`);
        if (o.entity && !o.workflow) throw new Error(`${where}: a userTaskPage with entity needs "workflow": the Module.Workflow whose context it shows`);
        let ds = null, known = false;
        if (o.entity) {
            const ent = await h.entity(o.entity);
            ds = `${o.module}.${o.name}_Context`;
            if (await exists(ds)) throw new Error(`${where}: ${ds} (the page's data source microflow) already exists`);
            known = await exists(o.workflow);
            if (known) {
                const d = await workflowDoc(h, o.workflow, where);
                if (contextOf(d) !== ent.qualifiedName) throw new Error(`${where}: ${o.workflow} is about ${contextOf(d)}, not ${o.entity}`);
            } else if (!/^\w+\.\w+$/.test(String(o.workflow))) throw new Error(`${where}: workflow is Module.Workflow`);
        }
        const inner = o.entity ? [{ widget: "dataView", name: "contextDataView", entity: o.entity, source: "parameter", editable: bool(o.editable, false), buttons: false, ...(o.fields !== undefined ? { fields: o.fields } : {}) }] : [{ widget: "text", text: "Complete the task", name: "zzTaskText" }];
        const base = { module: o.module, name: o.name, title: o.title === undefined ? humanize(o.name) : o.title, folder: o.folder, layout: o.layout, roles: o.roles, widgets: inner };
        Object.keys(base).forEach(k => base[k] === undefined && delete base[k]);
        const made = await createPage(base);
        if (o.entity) {
            if (!known) lateWorkflows(model).add(String(o.workflow));
            await h.impl().createMicroflow({ module: o.module, name: `${o.name}_Context`, folder: o.folder, parameters: [{ name: "WorkflowUserTask", type: "System.WorkflowUserTask" }],
                returns: o.entity, returnValue: "$Context", actions: [
                    { action: "retrieve", variable: "Workflow", from: "WorkflowUserTask", association: "System.WorkflowUserTask_Workflow" },
                    { action: "retrieveWorkflowContext", workflow: "Workflow", definition: o.workflow, variable: "Context" }] });
        }
        const page = await get(where);
        const arg = page.layoutCall.arguments[0];
        const top = [...arg.widgets];
        const ctxDv = top.find(w => w.name === "contextDataView") || null;
        // the task's data view
        const p = pages.PageParameter.createIn(page);
        p.name = "WorkflowUserTask";
        const pt = datatypes.ObjectType.create(model);
        p.parameterType = pt;
        pt.__entity.updateWithRawValue("System.WorkflowUserTask");
        setIfAvailable(p, "isRequired", true);
        const dv = pages.DataView.create(model);
        arg.widgets.push(dv);
        dv.name = "taskDataView";
        const src = pages.DataViewSource.createInEntityWidgetUnderDataSource(dv);
        dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).__entity.updateWithRawValue("System.WorkflowUserTask");
        const sv = pages.PageVariable.create(model);
        src.sourceVariable = sv;
        sv.pageParameter = p;
        if (!setIfAvailable(dv, "editability", pages.EditableEnum.Never)) setIfAvailable(dv, "editable", false);
        for (const w of top) {
            w.detach();
            dv.widgets.push(w);
        }
        if (ctxDv) {
            // the context data view: from the data source microflow, given the task
            const old = ctxDv.dataSource;
            const ctxParam = old.sourceVariable && old.sourceVariable.pageParameter;
            const ms = pages.MicroflowSource.createInEntityWidgetUnderDataSource(ctxDv);
            const settings = ms.microflowSettings;
            settings.microflow = await get(ds);
            const dsFlow = await get(ds);
            const dsParam = dsFlow.objectCollection.objects.find(x => x instanceof mf.MicroflowParameterObject);
            const pm = pages.MicroflowParameterMapping.createIn(settings);
            pm.parameter = dsParam;
            pm.expression = "$WorkflowUserTask"; // the page parameter, as Studio Pro stores flow arguments (an expression)
            ctxDv.traverse(x => {
                if (x instanceof pages.AttributeWidget && x.sourceVariable) x.sourceVariable = null;
            });
            if (ctxParam) ctxParam.delete();
        }
        const caps = [];
        for (const oc of outcomes) {
            const b = pages.ActionButton.create(model);
            dv.footerWidgets.push(b);
            b.name = `outcome${caps.length + 1}Button`;
            b.buttonStyle = caps.length === 0 ? pages.ButtonStyle.Success : pages.ButtonStyle.Default;
            const act = pages.SetTaskOutcomeClientAction.createInActionButtonUnderAction(b);
            act.outcomeValue = String(oc);
            act.closePage = true;
            act.commit = true;
            await h.textAll(b, "caption", String(oc));
            caps.push(String(oc));
        }
        const close = pages.ActionButton.create(model);
        dv.footerWidgets.push(close);
        close.name = "closeButton";
        close.buttonStyle = pages.ButtonStyle.Default;
        pages.ClosePageClientAction.createInActionButtonUnderAction(close);
        await h.textAll(close, "caption", "Close");
        warn(`Forms$SetTaskOutcomeClientAction first use by ops (no Studio Pro sample of a user task page in the test projects): check ${where} in Studio Pro`);
        return `${where} (user task page: parameter WorkflowUserTask, buttons ${caps.join(", ")}${ds ? `, context ${o.entity} from ${ds}` : ""})` + made.replace(/^[^\n]*/, "");
    }

    // ------------------------------------------------ checks

    const checks = {
        async createWorkflow(o) {
            const d = await get(`${o.module}.${o.name}`);
            if (!(d instanceof wf.Workflow)) return [`${o.module}.${o.name} is not a workflow`];
            const r = [];
            if (contextOf(d) !== o.context) r.push(`${o.module}.${o.name} context is ${contextOf(d)}`);
            let want = 0;
            const count = list => (list || []).forEach(s => {
                want++;
                nestedOf(s).forEach(count);
            });
            count(o.steps);
            let have = 0;
            d.traverse(x => {
                if (x instanceof wf.WorkflowActivity && !(x instanceof wf.EndWorkflowActivity && x.container === d.flow) && !(wf.StartWorkflowActivity && x instanceof wf.StartWorkflowActivity)) have++;
            });
            if (have !== want) r.push(`${o.module}.${o.name} has ${have} activities, expected ${want}`);
            return r;
        },
        async userTaskPage(o) {
            const p = await get(`${o.module}.${o.name}`);
            const r = [];
            if (!pageParamEntities(p).includes("System.WorkflowUserTask")) r.push(`${o.module}.${o.name} has no WorkflowUserTask parameter`);
            const have = [];
            p.traverse(x => x instanceof pages.SetTaskOutcomeClientAction && have.push(x.outcomeValue));
            for (const oc of [].concat(o.outcomes)) if (!have.includes(String(oc))) r.push(`${o.module}.${o.name} has no button for outcome ${oc}`);
            return r;
        }
    };

    return { impl: { createWorkflow }, userTaskPage, checks };
}

module.exports = { makeWorkflows, WORKFLOW_OPS, WORKFLOW_ACTIONS, STEP_FIELDS, STEP_COMMON, USER_TASK_PAGE_FIELDS, SYSTEM_ENTITIES, SYSTEM_ASSOCIATIONS };
