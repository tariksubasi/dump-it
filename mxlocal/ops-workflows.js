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

// A timeout (Studio Pro: timer boundary event, Mendix 10.20+) on a user task, call microflow, call workflow or
// notification wait. This is the error handling workflows model: a microflow that fails has no error path in a
// workflow (the instance goes to Failed; an admin retries it, changeWorkflowState retry).
const TIMEOUT_FIELD = "optional { \"after\": \"DateTime expression\", \"steps\": [ steps ], \"interrupting\": true/false (default true: stop the activity), \"every\": \"Minute | Hour | Day | Week | Month | Year\" + \"interval\": n + \"times\": n (repeat, non-interrupting only), \"caption\": text } (Mendix 10.20+; a list of them for several)";
const TIMEOUT_KEYS = ["after", "steps", "interrupting", "every", "interval", "times", "caption"];

const STEP_FIELDS = {
    userTask: {
        doc: "a task for a user: the task page opens it, an outcome button finishes it",
        fields: {
            caption: "optional text on the activity (default: User task)", page: "R Module.Page with a System.WorkflowUserTask parameter (createPage kind userTaskPage)",
            outcomes: "R [ \"Approve\", \"Reject\" ] or { \"Approve\": [ steps ], \"Reject\": [ steps ] } (one outcome: no steps of its own; the workflow continues after the task)",
            assignee: "optional { \"userRoles\": [ \"UserRole\" ] } | { \"xpath\": \"[...]\" } on the user entity | { \"microflow\": \"Module.Flow\" } returning a list of users (default: every user may pick it up)",
            taskName: "optional task name shown in the task inbox (default the caption)", description: "optional task description", dueDate: "optional DateTime expression, e.g. addDays([%CurrentDateTime%], 3)",
            onCreated: "optional Module.Microflow run when the task is created", autoAssign: "optional true: assign the task when exactly one user is targeted",
            timeout: TIMEOUT_FIELD
        }
    },
    decision: { doc: "branch on an expression of the context", fields: { caption: "optional text (default: the condition)", condition: "R Boolean or enumeration expression, e.g. $WorkflowContext/Amount > 1000", outcomes: "R { \"true\": [ steps ], \"false\": [ steps ] } or { \"Module.Enum.Value\": [ steps ], \"\": [ steps for no value ] }" } },
    parallelSplit: { doc: "run paths at the same time; the workflow continues when all are done", fields: { caption: "optional text (default: Parallel split)", paths: "R [ [ steps ], [ steps ] ] two or more" } },
    callMicroflow: { doc: "run a microflow", fields: { caption: "optional text (default: Call microflow)", microflow: "R Module.Microflow", args: "optional { \"Param\": \"expression\" } (default: the parameter of the context entity gets $WorkflowContext)", outcomes: "optional, when the microflow returns a Boolean or enumeration: { \"true\": [ steps ], \"false\": [ steps ] } / { \"Module.Enum.Value\": [ steps ], \"\": [ steps ] }", timeout: TIMEOUT_FIELD } },
    callWorkflow: { doc: "start another workflow and wait for it", fields: { caption: "optional text (default: Call workflow)", workflow: "R Module.Workflow", context: "optional expression for its context (default $WorkflowContext)", async: "optional true: do not wait", timeout: TIMEOUT_FIELD } },
    jumpTo: { doc: "go back (or forward) to an activity; ends its path", fields: { caption: "optional text (default: Jump)", target: "R name of an activity of this workflow, e.g. userTask1" } },
    waitForTimer: { doc: "wait until a moment (Mendix 10.6+)", fields: { caption: "optional text (default: Timer)", delay: "R DateTime expression, e.g. addHours([%CurrentDateTime%], 4)" } },
    waitForNotification: { doc: "wait until a microflow notifies the workflow (notifyWorkflow)", fields: { caption: "optional text (default: Wait for notification)", timeout: TIMEOUT_FIELD } },
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
    },
    changeWorkflow: {
        doc: "Change a workflow (in this order: add, move, change, remove): add, remove or move activities, change an activity (user task page, assignee, due date, outcomes, timeout; decision condition; called microflow; timer delay; jump target), change title/description/due date and the settings (context entity, admin page, roles that open its pages). Activity names: the workflows export (userTask1, decision1, ...).",
        fields: {
            workflow: "R Module.Workflow",
            add: "optional [ { \"after\": \"activity name\" or \"start\", \"steps\": [ steps ] } | { \"before\": \"activity name\", \"steps\": [...] } | { \"into\": \"activity name\", \"outcome\": \"Approve\" / \"true\" / \"Module.Enum.Value\" / \"\" / path number of a parallel split (one more: a new path) / \"timeout\", \"steps\": [...] } ] (steps as in createWorkflow; ops userTask)",
            remove: "optional [ \"activity name\" ] removes the activity and the steps in its outcomes",
            move: "optional [ { \"activity\": \"name\", \"after\" | \"before\" | \"into\" + \"outcome\": ... } ] (with the steps in its outcomes)",
            change: "optional { \"activity name\": { field: value } }: caption; userTask: page, assignee (null: everyone), dueDate, taskName, description, onCreated (\"\": none), autoAssign, outcomes { \"add\": [ \"Escalate\" ] or { \"Escalate\": [ steps ] }, \"remove\": [ \"Reject\" ], \"rename\": { \"Approve\": \"Accept\" } } (task page buttons follow), timeout (null: none); decision: condition; callMicroflow: microflow, args, timeout; callWorkflow: context, async, timeout; waitForTimer: delay; waitForNotification: timeout; jumpTo: target",
            title: "optional new display name", description: "optional new description", dueDate: "optional DateTime expression (\"\": none)",
            context: "optional Module.Entity: a new context entity (stored); refused while an expression or a called microflow needs the old one",
            adminPage: "optional Module.Page with a System.Workflow parameter (\"\": none): the workflow admin page",
            roles: "optional [ \"Module.Role\" ] may open the admin page and every user task page of the workflow (workflow security)"
        }
    },
    deleteWorkflowActivity: {
        doc: "Delete one activity of a workflow (and the steps in its outcomes). Refused for start/end of the main flow and for a jump target still in use.",
        fields: { workflow: "R Module.Workflow", activity: "R activity name, e.g. userTask2" }
    }
};

// Fields changeWorkflow "change" takes per activity kind.
const CHANGE_FIELDS = {
    SingleUserTaskActivity: ["caption", "page", "assignee", "dueDate", "taskName", "description", "onCreated", "autoAssign", "outcomes", "timeout"],
    MultiUserTaskActivity: ["caption", "page", "dueDate", "taskName", "description", "outcomes", "timeout"],
    ExclusiveSplitActivity: ["caption", "condition"],
    CallMicroflowTask: ["caption", "microflow", "args", "timeout"],
    CallMicroflowActivity: ["caption", "microflow", "args", "timeout"],
    CallWorkflowActivity: ["caption", "context", "async", "timeout"],
    WaitForTimerActivity: ["caption", "delay"],
    WaitForNotificationActivity: ["caption", "timeout"],
    JumpToActivity: ["caption", "target"],
    ParallelSplitActivity: ["caption"],
    EndWorkflowActivity: ["caption"]
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
        spec(a) {
            const op = a.operation;
            const name = op ? op.structureTypeName.split("$")[1] : "";
            const out = { workflow: op ? op.workflowVariable : "", operation: Object.keys(OPERATIONS).find(k => OPERATIONS[k] === name) || name };
            if (op instanceof mf.AbortOperation && op.reason && typeof op.reason.text === "string" && op.reason.text) out.reason = op.reason.text;
            return out;
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
        spec: a => ({ workflow: a.workflowSelection && a.workflowSelection.workflowQualifiedName, pauseAll: a.pauseAllWorkflows }),
        describe: a => `LOCK WORKFLOW ${a.workflowSelection && a.workflowSelection.workflowQualifiedName}${a.pauseAllWorkflows ? " (pause running ones)" : ""}`
    },
    // F8: Unlock workflow as an action of its own (lockWorkflow "unlock": true still works); type() lets steps,
    // changeAction and the checks recognize an unlock step
    unlockWorkflow: {
        doc: "Unlock a workflow definition: new instances can start again (Studio Pro: Unlock workflow).",
        fields: { workflow: "R Module.Workflow", resumeAll: "optional true: also resume the instances the lock paused" },
        type: () => mf.UnlockWorkflowAction,
        async build(c, act, spec, where) {
            return WORKFLOW_ACTIONS.lockWorkflow.build(c, act, { workflow: spec.workflow, unlock: true, pauseAll: spec.resumeAll }, where);
        },
        spec: a => ({ workflow: a.workflowSelection && a.workflowSelection.workflowQualifiedName, resumeAll: a.resumeAllPausedWorkflows }),
        describe: a => `UNLOCK WORKFLOW ${a.workflowSelection && a.workflowSelection.workflowQualifiedName}${a.resumeAllPausedWorkflows ? " (resume paused ones)" : ""}`
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
        for (const t of s.timeout && typeof s.timeout === "object" ? [].concat(s.timeout) : []) if (t && Array.isArray(t.steps)) out.push(t.steps);
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
            await timeouts(st, ut, s.timeout, where, ctx);
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
            await timeouts(st, a, s.timeout, where, ctx);
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
            await timeouts(st, a, s.timeout, where, ctx);
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
        async waitForNotification(st, flow, s, where, ctx) {
            const a = activity(st, flow, wf.WaitForNotificationActivity, "waitForNotification", s.caption === undefined ? STEP_CAPTION.waitForNotification : String(s.caption), s.name);
            await timeouts(st, a, s.timeout, where, ctx);
        },
        async end(st, flow, s, where) {
            activity(st, flow, wf.EndWorkflowActivity, "end", s.caption === undefined ? STEP_CAPTION.end : String(s.caption), s.name);
        }
    };

    // Timer boundary events of an activity (spec: one timeout object, a list of them, or null/undefined for none).
    // Interrupting: the activity stops and its path runs. Non-interrupting: the path runs beside the activity, also
    // repeated (every/interval/times); it cannot end the workflow or jump.
    async function timeouts(st, a, spec, where, ctx) {
        if (spec === undefined || spec === null) return 0;
        if (!atLeast("10.20.0")) throw new Error(`${where}: a timeout (timer boundary event) needs Mendix 10.20 (this project is ${version})`);
        const list = [].concat(spec);
        for (const [i, t] of list.entries()) {
            const at = `${where} timeout${list.length > 1 ? " " + (i + 1) : ""}`;
            if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error(`${at}: timeout is { "after": "addDays([%CurrentDateTime%], 3)", "steps": [ ... ] }`);
            for (const k of Object.keys(t)) if (!TIMEOUT_KEYS.includes(k)) fail(`${at}: unknown field '${k}'`, k, TIMEOUT_KEYS);
            if (t.after === undefined || String(t.after).trim() === "") throw new Error(`${at}: needs 'after' (a DateTime expression, e.g. addDays([%CurrentDateTime%], 3))`);
            const interrupting = bool(t.interrupting, true);
            const repeat = t.every !== undefined || t.interval !== undefined || t.times !== undefined;
            if (repeat && interrupting) throw new Error(`${at}: every/interval/times repeat a non-interrupting timeout; add "interrupting": false`);
            const be = (interrupting ? wf.InterruptingTimerBoundaryEvent : wf.NonInterruptingTimerBoundaryEvent).create(model);
            a.boundaryEvents.push(be);
            be.caption = t.caption === undefined ? (interrupting ? "Timeout" : "Reminder") : String(t.caption);
            be.firstExecutionTime = checkExpr(st, t.after, `${at} after`);
            if (repeat) {
                const types = ["Second", "Minute", "Hour", "Day", "Week", "Month", "Year"];
                const every = types.find(x => x.toLowerCase() === String(t.every || "Day").toLowerCase());
                if (!every) fail(`${at}: every '${t.every}' is not one of ${types.join(" | ")}`, t.every, types);
                const r = wf.LinearRecurrence.createIn(be);
                r.intervalType = sdk.scheduledevents.IntervalType[every];
                r.interval = Number(t.interval === undefined ? 1 : t.interval);
                r.maxExecutions = Number(t.times === undefined ? 0 : t.times);
                if (!Number.isInteger(r.interval) || r.interval < 1 || !Number.isInteger(r.maxExecutions) || r.maxExecutions < 0) throw new Error(`${at}: interval is a whole number >= 1, times a whole number >= 0 (0: no limit)`);
            }
            const path = t.steps === undefined ? [] : t.steps;
            if (!interrupting) for (const s of [].concat(path)) if (s && ["end", "jumpTo"].includes(String(s.step))) throw new Error(`${at}: a non-interrupting timeout path runs beside the activity; it cannot ${s.step === "end" ? "end the workflow" : "jump"} (use "interrupting": true)`);
            await steps(st, be.flow, path, `${at} path`, { ...ctx, main: false, branch: true, boundary: true });
            st.count.timeout = (st.count.timeout || 0) + 1;
        }
        return list.length;
    }

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

    // ------------------------------------------------ changeWorkflow / deleteWorkflowActivity

    const typeOf = a => a.structureTypeName.split("$")[1];
    const label = a => `${a.name} (${typeOf(a).replace(/Activity$|Task$/, "")}${a.caption && a.caption !== a.name ? ` "${a.caption}"` : ""})`;
    const isStart = a => !!wf.StartWorkflowActivity && a instanceof wf.StartWorkflowActivity;
    const closes = a => a instanceof wf.EndWorkflowActivity || a instanceof wf.JumpToActivity;
    const subtree = a => {
        const out = [];
        a.traverse(x => x instanceof wf.WorkflowActivity && out.push(x));
        return out;
    };

    // An existing workflow as createWorkflow's build state: names in use, every activity (jump targets), the context.
    async function openState(qn, where) {
        const d = await workflowDoc(h, qn, where);
        const ctxEnt = await h.entity(contextOf(d));
        await h.loadParents(ctxEnt);
        const st = { qn, d, ctxEnt, used: new Set(), jumps: [], all: [], pages: new Set(), count: {}, userRoles: null, lines: [] };
        d.traverse(x => {
            if (x instanceof wf.WorkflowActivity) {
                st.all.push(x);
                st.used.add(x.name);
            }
        });
        return st;
    }

    function find(st, name, where) {
        const a = st.all.find(x => x.name === String(name) && !x.isDeleted && x.containerAsFlow !== undefined && alive(st, x));
        if (!a) fail(`${where}: ${st.qn} has no activity '${name}'`, String(name), st.all.filter(x => alive(st, x)).map(x => x.name));
        return a;
    }
    // still in the workflow (not removed earlier in this op)
    const alive = (st, x) => {
        for (let c = x; c; c = c.container) if (c === st.d) return true;
        return false;
    };

    // Context of a flow (main flow, inside a parallel path, a timeout path).
    function flowCtx(st, flow) {
        const ctx = { main: flow === st.d.flow, parallel: false, branch: flow !== st.d.flow, nonInterrupting: false };
        for (let c = flow.container; c && c !== st.d; c = c.container) {
            if (c instanceof wf.ParallelSplitOutcome) ctx.parallel = true;
            if (c instanceof wf.NonInterruptingTimerBoundaryEvent) ctx.nonInterrupting = true;
        }
        return ctx;
    }

    // The outcome flow of an activity: user task outcome, condition outcome (true/false/enum value/""), parallel path
    // number (one past the last: a new path), or "timeout" (its first timer boundary event).
    function outcomeFlow(st, a, key, where, create) {
        const k = key === undefined || key === null ? undefined : String(key);
        if (k !== undefined && /^timeout$/i.test(k)) {
            const be = [...(a.boundaryEvents || [])][0];
            if (!be) throw new Error(`${where}: ${a.name} has no timeout; add one with change { "${a.name}": { "timeout": { "after": ... } } }`);
            return be.flow;
        }
        const outs = a.outcomes ? [...a.outcomes] : [];
        if (a instanceof wf.ParallelSplitActivity) {
            const n = Number(k);
            if (!Number.isInteger(n) || n < 1 || n > outs.length + 1) throw new Error(`${where}: ${a.name} is a parallel split; outcome is a path number 1..${outs.length} (${outs.length + 1}: a new path)`);
            if (n === outs.length + 1) {
                if (!create) throw new Error(`${where}: ${a.name} has no path ${n}`);
                return wf.ParallelSplitOutcome.createIn(a).flow;
            }
            return outs[n - 1].flow;
        }
        if (!outs.length) throw new Error(`${where}: ${a.name} (${typeOf(a)}) has no outcomes; use "after": "${a.name}"`);
        const names = outs.map(outcomeKey);
        if (k === undefined) fail(`${where}: into ${a.name} needs "outcome": one of ${names.map(n => JSON.stringify(n)).join(", ")}`, "", names);
        const hit = outs.find(o => outcomeKey(o) === k) || outs.find(o => outcomeKey(o).toLowerCase() === k.toLowerCase()) ||
            outs.find(o => o instanceof wf.EnumerationValueConditionOutcome && outcomeKey(o).split(".").pop() === k);
        if (!hit) fail(`${where}: ${a.name} has no outcome '${k}' (outcomes: ${names.map(n => JSON.stringify(n)).join(", ")})`, k, names);
        return hit.flow;
    }
    function outcomeKey(o) {
        if (o instanceof wf.UserTaskOutcome) return String(o.value);
        if (o instanceof wf.BooleanConditionOutcome) return String(o.value);
        if (o instanceof wf.EnumerationValueConditionOutcome) return o.valueQualifiedName || "";
        if (o instanceof wf.VoidConditionOutcome) return "";
        return "?";
    }

    // Where a position spec ({ after | before | into + outcome }) points: { flow, index, text }.
    function position(st, p, where, create = true) {
        const given = ["after", "before", "into"].filter(k => p[k] !== undefined);
        if (given.length !== 1) throw new Error(`${where}: give one of "after", "before" or "into" (+ "outcome")`);
        if (p.outcome !== undefined && p.into === undefined) throw new Error(`${where}: "outcome" goes with "into": the activity whose outcome it is`);
        if (p.after !== undefined && String(p.after).toLowerCase() === "start") {
            const first = st.d.flow.activities[0];
            return { flow: st.d.flow, index: first && isStart(first) ? 1 : 0, text: "at the start" };
        }
        if (p.into !== undefined) {
            const a = find(st, p.into, where);
            return { flow: outcomeFlow(st, a, p.outcome, where, create), index: 0, text: `into ${a.name} ${/^timeout$/i.test(String(p.outcome)) ? "timeout" : `outcome ${JSON.stringify(String(p.outcome === undefined ? "" : p.outcome))}`}` };
        }
        const a = find(st, p.after !== undefined ? p.after : p.before, where);
        const flow = a.containerAsFlow;
        const i = flow.activities.indexOf(a);
        if (p.after !== undefined) {
            if (closes(a)) throw new Error(`${where}: ${a.name} ends its path; nothing can follow it (Studio Pro CE6671). Use "before": "${a.name}"`);
            return { flow, index: i + 1, text: `after ${a.name}` };
        }
        if (isStart(a)) throw new Error(`${where}: nothing goes before the start; use "after": "start"`);
        return { flow, index: i, text: `before ${a.name}` };
    }

    // Builds steps into a flow at an index (createWorkflow's builders append; the new top-level ones move to index).
    async function insertSteps(st, pos, list, where) {
        if (!Array.isArray(list) || !list.length) throw new Error(`${where}: steps is a non-empty list [ { "step": ... } ]`);
        const ctx = flowCtx(st, pos.flow);
        const lastKind = String((list[list.length - 1] || {}).step || "");
        if (["end", "jumpTo"].includes(lastKind) && pos.index < pos.flow.activities.length) throw new Error(`${where}: ${lastKind} ends its path, but activities follow ${pos.text} (Studio Pro CE6671)`);
        if (ctx.nonInterrupting && list.some(s => s && ["end", "jumpTo"].includes(String(s.step)))) throw new Error(`${where}: a non-interrupting timeout path cannot end the workflow or jump`);
        const reserve = l => {
            for (const s of l || []) {
                if (!s || typeof s !== "object") continue;
                if (s.name !== undefined) {
                    validName(s.name, "activity name");
                    if (st.used.has(s.name)) throw new Error(`${where}: the name '${s.name}' is already used in ${st.qn} (Studio Pro CE0495)`);
                    st.used.add(s.name);
                }
                for (const sub of nestedOf(s)) reserve(sub);
            }
        };
        reserve(list);
        const before = pos.flow.activities.length;
        const firstNew = st.all.length;
        await steps(st, pos.flow, list, where, ctx);
        const fresh = pos.flow.activities.slice(before);
        fresh.forEach((a, i) => {
            a.detach();
            pos.flow.activities.splice(pos.index + i, 0, a);
        });
        return st.all.slice(firstNew);
    }

    function resolveJumps(st) {
        for (const j of st.jumps) {
            const target = st.all.find(x => x.name === j.target && alive(st, x));
            if (!target) fail(`${j.where}: jumpTo target '${j.target}' is no activity of ${st.qn}`, j.target, st.all.filter(x => alive(st, x) && !closes(x)).map(x => x.name));
            if (closes(target) || isStart(target)) throw new Error(`${j.where}: cannot jump to ${j.target}, an end/jumpTo/start activity (Studio Pro CE6681)`);
            j.act.targetActivity = target;
        }
        st.jumps = [];
    }

    // Jumps outside these activities that target one of them.
    function jumpsInto(st, acts) {
        const set = new Set(acts);
        const out = [];
        st.d.traverse(x => x instanceof wf.JumpToActivity && !set.has(x) && x.targetActivity && set.has(x.targetActivity) && out.push(x));
        return out;
    }

    function removeActivity(st, a, where) {
        if (isStart(a) || (a instanceof wf.EndWorkflowActivity && a.container === st.d.flow)) throw new Error(`${where}: ${a.name} is the ${isStart(a) ? "start" : "end"} of the main flow; it cannot be removed`);
        const gone = subtree(a);
        const jumps = jumpsInto(st, gone);
        if (jumps.length) throw new Error(`${where}: ${jumps.map(j => j.name).join(", ")} jump${jumps.length > 1 ? "" : "s"} to ${[...new Set(jumps.map(j => j.targetActivity.name))].join(", ")}; change the jump target or remove the jump first`);
        const inner = gone.length - 1;
        const waits = gone.filter(x => x instanceof wf.WaitForNotificationActivity).map(x => x.name);
        a.delete();
        return `- ${label(a)}${inner ? ` with ${inner} activit${inner > 1 ? "ies" : "y"} in its outcomes: ${gone.slice(1).map(x => x.name).join(", ")}` : ""}` +
            (waits.length ? ` (NOTE: microflows that notify ${waits.join(", ")} (notifyWorkflow) now fail; change them)` : "");
    }

    // The rules createWorkflow enforces, on the whole changed workflow.
    function validateFlows(st) {
        const errs = [];
        const main = [...st.d.flow.activities];
        if (!main.length || !(main[main.length - 1] instanceof wf.EndWorkflowActivity)) errs.push("the main flow must end with its end activity");
        st.d.traverse(x => {
            if (!(x instanceof wf.Flow)) return;
            const acts = [...x.activities];
            acts.forEach((a, i) => {
                if (closes(a) && i !== acts.length - 1 && x !== st.d.flow) errs.push(`${a.name} ends its path but ${acts[i + 1].name} follows it (CE6671)`);
                if (a instanceof wf.JumpToActivity && x === st.d.flow) errs.push(`${a.name}: a jump cannot be in the main flow (CE6679)`);
                if (a instanceof wf.EndWorkflowActivity && x === st.d.flow && i !== acts.length - 1) errs.push(`${a.name}: an end in the middle of the main flow (CE6679)`);
                if (a instanceof wf.EndWorkflowActivity && flowCtx(st, x).parallel) errs.push(`${a.name}: a parallel path cannot end the workflow (CE1844)`);
            });
        });
        st.d.traverse(x => {
            if (x instanceof wf.UserTaskActivity && x.outcomes.length === 1 && x.outcomes[0].flow.activities.length) errs.push(`${x.name}: a user task with one outcome has no steps of its own (CE1876)`);
            if (x instanceof wf.UserTaskActivity && !x.outcomes.length) errs.push(`${x.name}: a user task needs an outcome`);
        });
        const inner = main.slice(0, -1);
        if (endsAll({ activities: inner.length ? inner : main })) errs.push("every path ends (end/jumpTo), so the workflow end is never reached (CE6689)");
        if (errs.length) throw new Error(`${st.qn}: ${[...new Set(errs)].join("; ")}`);
    }

    // Outcome buttons (Complete user task) of a task page: rename, remove or add one for an outcome.
    async function taskPageButtons(st, ut, change) {
        const page = ut.taskPage && ut.taskPage.page;
        if (!page) return "";
        const p = await load(page);
        const buttons = [];
        p.traverse(x => x instanceof pages.SetTaskOutcomeClientAction && buttons.push(x));
        if (!buttons.length) return ` (${p.qualifiedName} has no outcome buttons to change)`;
        if (change.rename) {
            for (const act of buttons.filter(b => b.outcomeValue === change.rename[0])) {
                act.outcomeValue = change.rename[1];
                const b = act.container;
                const cap = b.caption && b.caption.template && [...b.caption.template.translations].map(t => t.text);
                if (cap && cap.every(t => t === change.rename[0])) await h.textAll(b, "caption", change.rename[1]);
            }
            return ` (buttons on ${p.qualifiedName} follow)`;
        }
        if (change.remove) {
            const hit = buttons.filter(b => b.outcomeValue === change.remove);
            for (const act of hit) act.container.delete();
            return hit.length ? ` (its button removed from ${p.qualifiedName})` : "";
        }
        if (change.add) {
            if (buttons.some(b => b.outcomeValue === change.add)) return "";
            const model0 = buttons[buttons.length - 1].container;
            const list = model0.container;
            const copy = model0.deepCopy(model);
            const used = new Set();
            p.traverse(x => x instanceof pages.Widget && used.add(x.name));
            let n = 1;
            while (used.has(`outcome${n}Button`)) n++;
            const arr = list && (list.footerWidgets && list.footerWidgets.includes(model0) ? list.footerWidgets : list.widgets && list.widgets.includes(model0) ? list.widgets : null);
            if (!arr) return ` (add a button for ${change.add} to ${p.qualifiedName} in Studio Pro)`;
            arr.splice(arr.indexOf(model0) + 1, 0, copy);
            copy.name = `outcome${n}Button`;
            copy.buttonStyle = pages.ButtonStyle.Default;
            copy.action.outcomeValue = change.add;
            await h.textAll(copy, "caption", change.add);
            return ` (button ${copy.name} added to ${p.qualifiedName})`;
        }
        return "";
    }

    async function changeUserTaskOutcomes(st, ut, spec, where) {
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: outcomes is { "add": [...], "remove": [...], "rename": { "Old": "New" } }`);
        for (const k of Object.keys(spec)) if (!["add", "remove", "rename"].includes(k)) fail(`${where}: outcomes takes add, remove, rename, not '${k}'`, k, ["add", "remove", "rename"]);
        const out = [];
        const has = v => [...ut.outcomes].find(o => o.value === v);
        for (const [from, to] of Object.entries(spec.rename || {})) {
            const oc = has(from);
            if (!oc) fail(`${where}: ${ut.name} has no outcome '${from}'`, from, [...ut.outcomes].map(o => o.value));
            if (!String(to).trim() || has(String(to))) throw new Error(`${where}: outcome '${to}' is empty or exists already`);
            oc.value = String(to);
            out.push(`outcome ${from} -> ${to}${await taskPageButtons(st, ut, { rename: [from, String(to)] })}`);
        }
        for (const v of [].concat(spec.remove || [])) {
            const oc = has(String(v));
            if (!oc) fail(`${where}: ${ut.name} has no outcome '${v}'`, String(v), [...ut.outcomes].map(o => o.value));
            const gone = subtree(oc).filter(x => x !== oc);
            const jumps = jumpsInto(st, gone);
            if (jumps.length) throw new Error(`${where}: ${jumps.map(j => j.name).join(", ")} jump into outcome ${v}; change those jumps first`);
            oc.delete();
            out.push(`outcome ${v} removed${gone.length ? ` with ${gone.map(x => x.name).join(", ")}` : ""}${await taskPageButtons(st, ut, { remove: String(v) })}`);
        }
        const add = spec.add === undefined ? {} : Array.isArray(spec.add) ? Object.fromEntries(spec.add.map(x => [x, []])) : spec.add;
        if (typeof add !== "object") throw new Error(`${where}: outcomes add is [ "Name" ] or { "Name": [ steps ] }`);
        for (const [v, list] of Object.entries(add)) {
            if (!String(v).trim() || has(String(v))) throw new Error(`${where}: outcome '${v}' is empty or exists already`);
            const oc = wf.UserTaskOutcome.createInUserTaskActivityUnderOutcomes(ut);
            oc.value = String(v);
            if ((list || []).length) await steps(st, oc.flow, list, `${where} outcome ${v}`, { ...flowCtx(st, ut.containerAsFlow), main: false, branch: true });
            out.push(`outcome ${v} added${await taskPageButtons(st, ut, { add: String(v) })}`);
        }
        if (!ut.outcomes.length) throw new Error(`${where}: ${ut.name} would have no outcome left`);
        return out;
    }

    async function changeActivity(st, a, spec, where) {
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: change is { "${a.name}": { "caption": ... } }`);
        const allowed = CHANGE_FIELDS[typeOf(a)] || ["caption"];
        for (const k of Object.keys(spec)) if (!allowed.includes(k)) fail(`${where}: ${typeOf(a)} ${a.name} has no field '${k}' to change (fields: ${allowed.join(", ")})`, k, allowed);
        const done = [];
        const ctx = flowCtx(st, a.containerAsFlow);
        if (spec.caption !== undefined) {
            a.caption = String(spec.caption);
            done.push("caption");
        }
        if (a instanceof wf.UserTaskActivity) {
            if (spec.page !== undefined) {
                a.taskPage.page = await pageOf(spec.page, "System.WorkflowUserTask", where);
                done.push(`page ${spec.page}`);
            }
            if ("assignee" in spec) {
                await assignee(st, a, spec.assignee === null ? undefined : spec.assignee, where);
                done.push(spec.assignee === null ? "assignee: everyone" : `assignee ${Object.keys(spec.assignee)[0]}`);
            }
            if (spec.dueDate !== undefined) {
                a.dueDate = String(spec.dueDate) === "" ? "" : checkExpr(st, spec.dueDate, `${where} dueDate`);
                done.push(`dueDate ${a.dueDate || "(none)"}`);
            }
            if (spec.taskName !== undefined) (a.taskName.text = String(spec.taskName), done.push("taskName"));
            if (spec.description !== undefined) (a.taskDescription.text = String(spec.description), done.push("description"));
            if (spec.autoAssign !== undefined) (a.autoAssignSingleTargetUser = bool(spec.autoAssign, false), done.push("autoAssign"));
            if (spec.onCreated !== undefined) {
                if (!spec.onCreated) wf.NoEvent.createInUserTaskActivityUnderOnCreatedEvent(a);
                else {
                    const m = await get(spec.onCreated).catch(() => fail(`${where}: no microflow ${spec.onCreated}`, spec.onCreated, model.allMicroflows().map(x => x.qualifiedName)));
                    if (!(m instanceof mf.Microflow)) throw new Error(`${where}: onCreated ${spec.onCreated} is not a microflow`);
                    wf.MicroflowBasedEvent.createInUserTaskActivityUnderOnCreatedEvent(a).microflow = m;
                }
                done.push(`onCreated ${spec.onCreated || "(none)"}`);
            }
            if (spec.outcomes !== undefined) done.push(...(await changeUserTaskOutcomes(st, a, spec.outcomes, where)));
        }
        if (a instanceof wf.ExclusiveSplitActivity && spec.condition !== undefined) {
            const keys = [...a.outcomes].map(outcomeKey);
            const enumOut = keys.some(k => k.split(".").length === 3);
            if (enumOut && /\s(=|!=|>|<|and|or)\s|^(true|false)$/.test(String(spec.condition))) throw new Error(`${where}: ${a.name} decides on an enumeration (outcomes ${keys.filter(Boolean).join(", ")}); a Boolean condition needs a new decision (remove this one and add a decision)`);
            a.expression = checkExpr(st, spec.condition, `${where} condition`);
            done.push(`condition ${a.expression}`);
        }
        if ((a instanceof wf.CallMicroflowTask || (wf.CallMicroflowActivity && a instanceof wf.CallMicroflowActivity)) && (spec.microflow !== undefined || spec.args !== undefined)) {
            const name = spec.microflow === undefined ? a.microflowQualifiedName : spec.microflow;
            const m = await get(name).catch(() => fail(`${where}: no microflow ${name}`, name, model.allMicroflows().map(x => x.qualifiedName)));
            if (!(m instanceof mf.Microflow)) throw new Error(`${where}: ${name} is not a microflow`);
            const kind = t => (t instanceof datatypes.BooleanType ? "Boolean" : t instanceof datatypes.EnumerationType ? `Enum(${t.enumerationQualifiedName})` : "other");
            const old = a.microflow ? await load(a.microflow) : null;
            if (old && old !== m && kind(old.microflowReturnType) !== kind(m.microflowReturnType) && a.outcomes.length) throw new Error(`${where}: ${name} returns ${kind(m.microflowReturnType)}, ${a.microflowQualifiedName} returns ${kind(old.microflowReturnType)}: the outcomes differ; remove ${a.name} and add a new callMicroflow`);
            a.microflow = m;
            for (const pm of [...a.parameterMappings]) pm.delete();
            const params = m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject);
            const args = spec.args || {};
            for (const k of Object.keys(args)) if (!params.some(p => p.name === k)) fail(`${where}: ${name} has no parameter '${k}'`, k, params.map(p => p.name));
            for (const p of params) {
                let e = args[p.name];
                if (e === undefined && entityOfType(p.variableType) === st.ctxEnt.qualifiedName && !(p.variableType instanceof datatypes.ListType)) e = "$WorkflowContext";
                if (e === undefined && entityOfType(p.variableType) === "System.Workflow") e = "$Workflow";
                if (e === undefined) throw new Error(`${where}: ${name} parameter '${p.name}' needs a value in args (an expression)`);
                const pm = atLeast("11.9.0") ? wf.MicroflowCallParameterMapping.createInMicroflowBasedActivityUnderParameterMappings(a) : wf.MicroflowCallParameterMapping.createInCallMicroflowTaskUnderParameterMappings(a);
                pm.parameter = p;
                pm.expression = checkExpr(st, e, `${where} ${p.name}`);
            }
            done.push(`microflow ${name}${spec.args ? " with args" : ""}`);
        }
        if (a instanceof wf.CallWorkflowActivity) {
            if (spec.context !== undefined) {
                const pm = a.parameterMappings[0];
                if (pm) pm.expression = checkExpr(st, spec.context, `${where} context`);
                done.push("context");
            }
            if (spec.async !== undefined) (a.executeAsync = bool(spec.async, false), done.push(`async ${a.executeAsync}`));
        }
        if (a instanceof wf.WaitForTimerActivity && spec.delay !== undefined) (a.delay = checkExpr(st, spec.delay, `${where} delay`), done.push(`delay ${a.delay}`));
        if (a instanceof wf.JumpToActivity && spec.target !== undefined) {
            st.jumps.push({ act: a, target: String(spec.target), where });
            done.push(`target ${spec.target}`);
        }
        if ("timeout" in spec) {
            const old = [...a.boundaryEvents];
            const gone = old.flatMap(be => subtree(be));
            const jumps = jumpsInto(st, gone);
            if (jumps.length) throw new Error(`${where}: ${jumps.map(j => j.name).join(", ")} jump into the old timeout path; change those jumps first`);
            old.forEach(be => be.delete());
            const n = await timeouts(st, a, spec.timeout, where, ctx);
            done.push(n ? `timeout ${[].concat(spec.timeout).map(t => t.after).join(", ")}${old.length ? " (replaces the old one)" : ""}` : old.length ? `timeout removed${gone.length ? ` (with ${gone.map(x => x.name).join(", ")})` : ""}` : "no timeout");
        }
        return `~ ${a.name}: ${done.join("; ") || "nothing"}`;
    }
    // N-6: context entity and admin page of changeWorkflow
    async function workflowSettings(st, o, where) {
        const lines = [];
        if (o.context !== undefined) {
            const ent = await h.entity(o.context);
            if (!h.persistable(ent)) throw new Error(`${where}: ${o.context} is not stored (persistable); a workflow context must be a stored entity`);
            await h.loadParents(ent);
            const old = st.ctxEnt;
            const kin = e => {
                const out = [];
                for (let x = e; x; ) {
                    out.push(x.qualifiedName);
                    const g = x.generalization;
                    x = g instanceof dm.Generalization && g.generalization && g.generalization.isLoaded ? g.generalization : null;
                }
                return out;
            };
            const fits = qn => kin(ent).includes(qn);
            st.ctxEnt = ent;
            const bad = [];
            // every expression of the workflow that names $WorkflowContext/Attribute
            st.d.traverse(el => {
                for (const p of el.allProperties()) {
                    if (typeof p.qualifiedName === "function" || !p.name) continue;
                    let v;
                    try {
                        v = el[p.name];
                    } catch (e) {
                        continue;
                    }
                    if (typeof v !== "string" || !v.includes("$WorkflowContext")) continue;
                    try {
                        checkExpr(st, v, where);
                    } catch (e) {
                        bad.push(`${(el.name || (el.containerAsWorkflowActivity || {}).name || el.structureTypeName.split("$")[1])}: ${v}`);
                    }
                }
            });
            // called microflows that take the context object
            const maps = [];
            st.d.traverse(el => el instanceof wf.MicroflowCallParameterMapping && String(el.expression || "").trim() === "$WorkflowContext" && maps.push(el));
            for (const m of maps) {
                const qn = m.parameterQualifiedName || "";
                const flow = await get(qn.split(".").slice(0, 2).join(".")).catch(() => null);
                const par = flow && flow.objectCollection.objects.find(x => x instanceof mf.MicroflowParameterObject && x.name === qn.split(".").pop());
                const want = par && par.variableType && par.variableType.entityQualifiedName;
                if (want && !fits(want)) bad.push(`${qn} takes a ${want}`);
            }
            if (bad.length) {
                st.ctxEnt = old;
                throw new Error(`${where}: the workflow still needs ${old.qualifiedName}: ${[...new Set(bad)].slice(0, 5).join("; ")}. Change those first (change { activity: { ... } }), or pick an entity that has these attributes`);
            }
            st.d.parameter.entity = ent;
            lines.push(`~ context ${ent.qualifiedName} (was ${old.qualifiedName})`);
            warn(`${st.qn}: the context is now ${ent.qualifiedName}; microflows that start it (callWorkflow) pass a ${old.qualifiedName}: check them with usages ${st.qn}`);
        }
        if (o.adminPage !== undefined) {
            if (o.adminPage === "" || o.adminPage === null) {
                if (st.d.adminPage) st.d.adminPage.delete();
                lines.push("~ no admin page");
            } else {
                const ap = await pageOf(o.adminPage, "System.Workflow", `${where} adminPage`);
                (st.d.adminPage || wf.PageReference.createInWorkflowUnderAdminPage(st.d)).page = ap;
                lines.push(`~ admin page ${o.adminPage}`);
            }
        }
        return lines;
    }

    async function changeWorkflow(o) {
        const where = `changeWorkflow ${o.workflow}`;
        const st = await openState(o.workflow, where);
        const lines = [];
        if (!["add", "remove", "move", "change", "title", "description", "dueDate", "context", "adminPage", "roles"].some(k => o[k] !== undefined)) throw new Error(`${where}: nothing to change; give add, remove, move, change, title, description, dueDate, context, adminPage or roles`);
        lines.push(...(await workflowSettings(st, o, where)));
        if (o.title !== undefined) {
            st.d.title = String(o.title);
            st.d.workflowName.text = st.d.title;
            lines.push(`~ title ${st.d.title}`);
        }
        if (o.description !== undefined) (st.d.workflowDescription.text = String(o.description), lines.push("~ description"));
        if (o.dueDate !== undefined) (st.d.dueDate = String(o.dueDate) === "" ? "" : checkExpr(st, o.dueDate, `${where} dueDate`), lines.push(`~ dueDate ${st.d.dueDate || "(none)"}`));
        for (const [i, add] of [].concat(o.add || []).entries()) {
            const at = `${where} add ${i + 1}`;
            if (!add || typeof add !== "object" || Array.isArray(add)) throw new Error(`${at}: add is { "after": "activity name", "steps": [ ... ] }`);
            for (const k of Object.keys(add)) if (!["after", "before", "into", "outcome", "steps"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["after", "before", "into", "outcome", "steps"]);
            const pos = position(st, add, at);
            const made = await insertSteps(st, pos, add.steps, at);
            const top = made.filter(x => x.containerAsFlow === pos.flow);
            lines.push(`+ ${top.map(label).join(", ")} ${pos.text}${made.length > top.length ? ` (with ${made.length - top.length} activit${made.length - top.length > 1 ? "ies" : "y"} in their outcomes)` : ""}`);
        }
        for (const [i, m] of [].concat(o.move || []).entries()) {
            const at = `${where} move ${i + 1}`;
            if (!m || typeof m !== "object" || m.activity === undefined) throw new Error(`${at}: move is { "activity": "name", "after": "name" }`);
            for (const k of Object.keys(m)) if (!["activity", "after", "before", "into", "outcome"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["activity", "after", "before", "into", "outcome"]);
            const a = find(st, m.activity, at);
            if (isStart(a) || (a instanceof wf.EndWorkflowActivity && a.container === st.d.flow)) throw new Error(`${at}: ${a.name} is the start or end of the main flow; it does not move`);
            const pos = position(st, m, at);
            const inside = subtree(a);
            for (let c = pos.flow; c; c = c.container) if (inside.includes(c)) throw new Error(`${at}: cannot move ${a.name} into its own outcomes`);
            let index = pos.index;
            if (pos.flow === a.containerAsFlow && pos.flow.activities.indexOf(a) < index) index--;
            a.detach();
            pos.flow.activities.splice(index, 0, a);
            const ctx = flowCtx(st, pos.flow);
            if (ctx.nonInterrupting && inside.some(closes)) throw new Error(`${at}: a non-interrupting timeout path cannot end the workflow or jump`);
            lines.push(`> ${label(a)} moved ${pos.text}`);
        }
        if (o.change !== undefined) {
            if (!o.change || typeof o.change !== "object" || Array.isArray(o.change)) throw new Error(`${where}: change is { "activity name": { "field": value } }`);
            for (const [name, spec] of Object.entries(o.change)) lines.push(await changeActivity(st, find(st, name, `${where} change`), spec, `${where} change ${name}`));
        }
        for (const [i, name] of [].concat(o.remove || []).entries()) lines.push(removeActivity(st, find(st, name, `${where} remove ${i + 1}`), `${where} remove ${i + 1}`));
        resolveJumps(st);
        validateFlows(st);
        if (o.roles !== undefined) {
            // N-6 workflow security: the roles open the admin page and every user task page (Mendix keeps no roles on
            // the workflow itself since 9.6)
            if (!Array.isArray(o.roles) || !o.roles.length) throw new Error(`${where}: roles is [ "Module.Role", ... ]`);
            const all = new Set(st.pages);
            if (st.d.adminPage && st.d.adminPage.pageQualifiedName) all.add(st.d.adminPage.pageQualifiedName);
            st.d.traverse(x => x instanceof wf.PageReference && x.pageQualifiedName && all.add(x.pageQualifiedName));
            for (const p of all) await h.grantAccess({ document: p, roles: o.roles });
            lines.push(all.size ? `~ ${o.roles.join(", ")} may open ${[...all].join(", ")}` : `~ no pages to open (the workflow has no admin or user task page)`);
        } else if (st.pages.size && o.roles) for (const p of st.pages) await h.grantAccess({ document: p, roles: o.roles });
        return `${o.workflow}: ${lines.length} change(s)\n      ${lines.join("\n      ")}`;
    }

    async function deleteWorkflowActivity(o) {
        const where = `deleteWorkflowActivity ${o.workflow}`;
        const st = await openState(o.workflow, where);
        const line = removeActivity(st, find(st, o.activity, where), where);
        validateFlows(st);
        return `${o.workflow}: ${line}`;
    }

    // ------------------------------------------------ checks

    const checks = {
        async changeWorkflow(o) {
            const d = await get(o.workflow);
            const names = new Set();
            d.traverse(x => x instanceof wf.WorkflowActivity && names.add(x.name));
            const r = [];
            for (const n of [].concat(o.remove || [])) if (names.has(String(n))) r.push(`${o.workflow}: ${n} still exists`);
            const named = l => (l || []).flatMap(s => (s && typeof s === "object" ? [...(s.name ? [s.name] : []), ...nestedOf(s).flatMap(named)] : []));
            for (const add of [].concat(o.add || [])) for (const n of named(add && add.steps)) if (!names.has(n)) r.push(`${o.workflow}: added ${n} missing`);
            for (const [n, spec] of Object.entries(o.change || {})) {
                let a = null;
                d.traverse(x => x instanceof wf.WorkflowActivity && x.name === n && (a = x));
                if (!a) {
                    r.push(`${o.workflow}: ${n} missing`);
                    continue;
                }
                if (spec.caption !== undefined && a.caption !== String(spec.caption)) r.push(`${n} caption is '${a.caption}'`);
                if (spec.dueDate !== undefined && a.dueDate !== String(spec.dueDate)) r.push(`${n} dueDate is '${a.dueDate}'`);
                if (spec.page !== undefined && a.taskPage && a.taskPage.pageQualifiedName !== spec.page) r.push(`${n} page is ${a.taskPage.pageQualifiedName}`);
                if (spec.timeout === null && a.boundaryEvents.length) r.push(`${n} still has a timeout`);
                if (spec.timeout && a.boundaryEvents.length !== [].concat(spec.timeout).length) r.push(`${n} has ${a.boundaryEvents.length} timeout(s)`);
                const oc = spec.outcomes || {};
                const vals = a.outcomes ? [...a.outcomes].map(x => x.value) : [];
                for (const v of [].concat(oc.remove || [])) if (vals.includes(v)) r.push(`${n} still has outcome ${v}`);
                for (const v of Array.isArray(oc.add) ? oc.add : Object.keys(oc.add || {})) if (!vals.includes(v)) r.push(`${n} lacks outcome ${v}`);
                for (const v of Object.values(oc.rename || {})) if (!vals.includes(v)) r.push(`${n} lacks outcome ${v}`);
            }
            for (const m of [].concat(o.move || [])) {
                let a = null;
                d.traverse(x => x instanceof wf.WorkflowActivity && x.name === m.activity && (a = x));
                if (!a) r.push(`${m.activity} missing`);
                else if (m.after !== undefined && String(m.after) !== "start") {
                    const acts = [...a.containerAsFlow.activities];
                    const i = acts.indexOf(a);
                    if (!i || acts[i - 1].name !== String(m.after)) r.push(`${m.activity} is not after ${m.after}`);
                }
            }
            if (o.title !== undefined && d.title !== String(o.title)) r.push(`${o.workflow} title is '${d.title}'`);
            if (o.context !== undefined && d.parameter.entityQualifiedName !== String(o.context)) r.push(`${o.workflow} context is ${d.parameter.entityQualifiedName}`);
            if (o.adminPage !== undefined && ((d.adminPage && d.adminPage.pageQualifiedName) || "") !== String(o.adminPage || "")) r.push(`${o.workflow} admin page is ${(d.adminPage && d.adminPage.pageQualifiedName) || "none"}`);
            return r;
        },
        async deleteWorkflowActivity(o) {
            const d = await get(o.workflow);
            let hit = false;
            d.traverse(x => x instanceof wf.WorkflowActivity && x.name === o.activity && (hit = true));
            return hit ? [`${o.workflow}: ${o.activity} still exists`] : [];
        },
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

    return { impl: { createWorkflow, changeWorkflow, deleteWorkflowActivity }, userTaskPage, checks };
}

// A later op of the plan changes this workflow again: check only the final state (checkPlan).
function workflowChangedLater(name, o, rest) {
    const qn = name === "createWorkflow" ? `${o.module}.${o.name}` : ["changeWorkflow", "deleteWorkflowActivity"].includes(name) ? o.workflow : null;
    return !!qn && rest.some(x => ["changeWorkflow", "deleteWorkflowActivity"].includes(x.op) && x.workflow === qn);
}

module.exports = { makeWorkflows, workflowChangedLater, WORKFLOW_OPS, WORKFLOW_ACTIONS, STEP_FIELDS, STEP_COMMON, USER_TASK_PAGE_FIELDS, SYSTEM_ENTITIES, SYSTEM_ASSOCIATIONS };
