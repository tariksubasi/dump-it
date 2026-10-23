"use strict";
// selftest phase W (selftest-wflows.js): flow and workflow editing beyond the basics, one step per feature:
// microflow settings (concurrency, entity access, mark as used, URL, toolbox action), and the steps added after it.
// Each step runs its plan through selftest-integ runPhase (stores, reopens with 0 errors and 0 deltas, new units
// roundtrip byte for byte, checkPlan), checks the stored BSON, then its refusals (each on a fresh reopen: a refused op
// changes nothing). None of the stored shapes here has a Studio Pro sample in the test projects unless a step says so.
const integ = require("./selftest-integ");

const { cmp } = require("./versions");

const named = (p, name) => integ.unitsNamed(p, name)[name];
const objectsOf = flow => {
    const out = [];
    const walk = coll => (coll.Objects || []).forEach(o => (out.push(o), o.ObjectCollection && walk(o.ObjectCollection)));
    if (flow) walk(flow.ObjectCollection);
    return out;
};
const actionsOf = flow => objectsOf(flow).filter(o => o.Action).map(o => o.Action);
// The 8-character id of the first step of a flow (SDK, as 'steps' shows them) that matches
async function idOf(s, qn, pred) {
    const flow = await s.ops.get(qn);
    const hits = [];
    const walk = coll => coll.objects.forEach(o => {
        if (pred(o)) hits.push(o.id.slice(0, 8));
        if (o.objectCollection) walk(o.objectCollection);
    });
    walk(flow.objectCollection);
    if (!hits.length) throw new Error(`${qn}: no step for ${pred}`);
    return hits[0];
}
const logOf = text => o => o.action && o.action.messageTemplate && o.action.messageTemplate.text === text;
const text = t => (t && t.Items ? t.Items.map(i => i.Text) : []);

function steps(mod, T, version) {
    const E = `${mod}.${T}`;
    const F = `${T}_W`;
    const M = n => `${mod}.${F}${n}`;
    const v = x => cmp(version, x) >= 0;
    return [
        {
            name: "F1/F2 microflow settings (concurrency + error microflow / message, entity access, mark as used, URL, toolbox action)",
            ops: [
                { op: "createMicroflow", module: mod, name: `${F}Busy`, folder: "ZzW", parameters: [{ name: "Item", type: E }], actions: [{ action: "log", message: "busy" }] },
                { op: "createMicroflow", module: mod, name: `${F}Run`, folder: "ZzW", parameters: [{ name: "Item", type: E }], actions: [{ action: "log", message: "run" }] },
                { op: "createMicroflow", module: mod, name: `${F}Msg`, folder: "ZzW", actions: [{ action: "log", message: "msg" }] },
                { op: "createNanoflow", module: mod, name: `${F}Nano`, folder: "ZzW", actions: [] },
                { op: "changeMicroflow", microflow: `${mod}.${F}Run`, allowConcurrentExecution: false, concurrencyErrorMicroflow: `${mod}.${F}Busy`, applyEntityAccess: true, markAsUsed: true,
                    url: "run/{Item}", toolbox: { caption: "Zz run", category: "Zz", icon: `${E}Images.zz_logo` }, workflowToolbox: { caption: "Zz run (workflow)" } },
                { op: "changeMicroflow", microflow: `${mod}.${F}Msg`, allowConcurrentExecution: false, concurrencyErrorMessage: "Busy, try again" },
                { op: "changeMicroflow", microflow: `${mod}.${F}Nano`, markAsUsed: true }
            ],
            verify(p) {
                const r = [];
                const run = named(p, `${F}Run`), msg = named(p, `${F}Msg`), nano = named(p, `${F}Nano`);
                if (!run || run.AllowConcurrentExecution !== false || run.ConcurrencyErrorMicroflow !== `${mod}.${F}Busy` || run.ApplyEntityAccess !== true || run.MarkAsUsed !== true) r.push(`${F}Run settings not stored (${run && [run.AllowConcurrentExecution, run.ConcurrencyErrorMicroflow, run.ApplyEntityAccess, run.MarkAsUsed]})`);
                if (run && run.Url !== "/run/{Item}") r.push(`${F}Run Url is ${run.Url}`);
                const info = run && run.MicroflowActionInfo;
                if (!info || info.$Type !== "CodeActions$MicroflowActionInfo" || info.Caption !== "Zz run" || info.Category !== "Zz" || !info.IconData || !info.ImageData) r.push("toolbox action info not stored");
                if (!run || !run.WorkflowActionInfo || run.WorkflowActionInfo.Caption !== "Zz run (workflow)") r.push("workflow toolbox action info not stored");
                if (!msg || msg.AllowConcurrentExecution !== false || !text(msg.ConcurrenyErrorMessage).includes("Busy, try again") || msg.ConcurrencyErrorMicroflow) r.push("concurrency error message not stored");
                if (!nano || nano.MarkAsUsed !== true) r.push("nanoflow mark as used not stored");
                return r;
            },
            refusals: [
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Nano`, allowConcurrentExecution: false }, /a nanoflow has no 'allowConcurrentExecution'/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Nano`, applyEntityAccess: true }, /always runs with the access rules/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Busy`, concurrencyErrorMessage: "x" }, /add "allowConcurrentExecution": false/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Busy`, allowConcurrentExecution: false, concurrencyErrorMessage: "x", concurrencyErrorMicroflow: `${mod}.${F}Msg` }, /not both/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Msg`, allowConcurrentExecution: false, concurrencyErrorMicroflow: `${mod}.${F}Run` }, /gets the parameters of/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Msg`, url: "x/{Nope}" }, /has no parameter 'Nope'/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Msg`, toolbox: { caption: "x", icon: `${E}Images.Icon` } }, /must be a PNG/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Msg`, toolbox: { caption: "x", catgory: "y" } }, /Did you mean: category/],
                [{ op: "changeMicroflow", microflow: `${mod}.${F}Msg`, markAsUsed: "maybe" }, /true or false/]
            ]
        },
        {
            name: `new actions: ${v("11.2.0") ? "F3 send email, " : ""}F6 synchronize to device / clear from device; refusals of N-1 call web service, F4 call external action, F5 external objects, F7 cancel synchronization, F14 list equals`,
            ops: [
                { op: "createMicroflow", module: mod, name: `${F}Mail`, folder: "ZzW", parameters: [{ name: "Item", type: E }], actions: [
                    ...(v("11.2.0") ? [{ action: "sendEmail", to: "$Item/Title", cc: "'cc@example.com'", subject: v("11.12.0") ? "Item {1}" : "'Item ' + $Item/Title", ...(v("11.12.0") ? { subjectArgs: ["$Item/Title"] } : {}),
                        body: v("11.12.0") ? "Hello" : "'Hello'", server: { host: "'smtp.example.com'", port: "587", from: "'zz@example.com'", security: "tls", user: "'zz'", password: "'secret'" } }] : []),
                    { action: "synchronizeToDevice", variable: "Item" }] },
                { op: "createNanoflow", module: mod, name: `${F}Clear`, folder: "ZzW", actions: [{ action: "clearFromDevice", entity: E }] }
            ],
            verify(p) {
                const r = [];
                const acts = actionsOf(named(p, `${F}Mail`));
                const mail = acts.find(a => a.$Type === "Microflows$SendEmailAction");
                if (v("11.2.0")) {
                    if (!mail || !mail.EmailMessage || mail.EmailMessage.To !== "$Item/Title" || !mail.EmailConnectionConfig || mail.EmailConnectionConfig.Host !== "'smtp.example.com'") r.push(`send email not stored (${mail && Object.keys(mail).join(",")})`);
                    else if (v("11.12.0") ? !mail.EmailMessage.SubjectTemplate || mail.EmailMessage.SubjectTemplate.Text !== "Item {1}" : mail.EmailMessage.Subject !== "'Item ' + $Item/Title") r.push("send email subject not stored");
                    if (mail && (!mail.EmailAuthenticationConfig || mail.EmailAuthenticationConfig.$Type !== "Microflows$BasicAuthConfig")) r.push("send email authentication not stored");
                }
                if (!acts.some(a => a.$Type === "Microflows$PushToClientAction" && a.DataVariableName === "Item")) r.push("synchronize to device not stored");
                if (!actionsOf(named(p, `${F}Clear`)).some(a => a.$Type === "Microflows$ClearFromClientAction" && a.Entity === E)) r.push("clear from device not stored");
                return r;
            },
            refusals: [
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "callWebService", service: `${mod}.NoSuchService`, operation: "Ping" }] }, /no consumed \(imported\) web service|no consumed web service/],
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "callExternalAction", service: `${mod}.NoSuchOData`, name: "Ping" }] }, v("10.2.0") ? /no consumed OData service/ : /needs Mendix 10.2.0/],
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "sendExternalObject", variable: "Item" }] }, /only works on external entities/],
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "deleteExternalObject", variable: "Item" }] }, /use delete/],
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "clearFromDevice", entity: E }] }, /only works in nanoflows/],
                [{ op: "addActions", microflow: M("Clear"), actions: [{ action: "synchronizeToDevice", variable: "x" }] }, /not available in nanoflows/],
                // 11.8+ with an offline profile it runs (not saved: refusals are dry); otherwise refused
                [{ op: "addActions", microflow: M("Clear"), actions: [{ action: "cancelSynchronization" }] }, v("11.8.0") ? /offline/ : /needs Mendix 11.8.0/, v("11.8.0")],
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "sendEmail", to: "'a@b.c'", subject: "'x'", body: "'y'" }] }, v("11.2.0") ? /needs 'server'/ : /needs Mendix 11.2.0/],
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "pushToClient", variable: "Item" }] }, /called synchronizeToDevice/],
                [{ op: "addActions", microflow: M("Mail"), actions: [{ action: "retrieve", variable: "All", entity: E }, { action: "listOperation", variable: "Same", operation: "equals", list: "All", other: "All" }] }, /not written/]
            ]
        },
        {
            name: "F9 changeAction on built actions: send REST request (operation, args, variable)" + (v("11.2.0") ? ", send email (subject, server merge)" : "") + ", unlock workflow",
            ops: [
                { op: "createConsumedRestService", module: mod, name: `${F}Api`, folder: "ZzW", baseUrl: "https://api.example.com/", operations: [
                    { name: "Ping", method: "Put", path: "/ping/{code}", body: "{ \"code\": \"{code}\" }" },
                    { name: "Echo", method: "Put", path: "/echo/{text}/{n}", body: "{ \"t\": \"{text}\" }" }] },
                { op: "createMicroflow", module: mod, name: `${F}Rest`, folder: "ZzW", parameters: [{ name: "Item", type: E }], actions: [
                    { action: "sendRestRequest", operation: `${mod}.${F}Api.Ping`, args: { code: "$Item/Title" } },
                    { action: "log", message: "sent" }] }
            ],
            async then(s) {
                const out = [{ op: "changeAction", microflow: M("Rest"), id: await idOf(s, M("Rest"), o => o.action && /RestOperationCall/.test(o.action.structureTypeName)), operation: `${mod}.${F}Api.Echo`, args: { text: "$Item/Title", n: "toString($Item/Count)" }, caption: "Echo it" }];
                if (v("11.2.0")) out.push({ op: "changeAction", microflow: M("Mail"), id: await idOf(s, M("Mail"), o => o.action && /SendEmail/.test(o.action.structureTypeName)), ...(v("11.12.0") ? { subject: "Order {1} shipped" } : { subject: "'Order shipped'" }), server: { port: "465", security: "ssl" } });
                return out;
            },
            verify(p) {
                const r = [];
                const rest = actionsOf(named(p, `${F}Rest`)).find(a => a.$Type === "Microflows$RestOperationCallAction");
                if (!rest || rest.Operation !== `${mod}.${F}Api.Echo` || (rest.ParameterMappings || []).length !== 2) r.push(`sendRestRequest not changed (${rest && rest.Operation}, ${rest && (rest.ParameterMappings || []).length} mappings)`);
                const box = objectsOf(named(p, `${F}Rest`)).find(o => o.Action && o.Action.$Type === "Microflows$RestOperationCallAction");
                if (!box || box.Caption !== "Echo it") r.push("caption of the changed REST step not kept");
                if (v("11.2.0")) {
                    const mail = actionsOf(named(p, `${F}Mail`)).find(a => a.$Type === "Microflows$SendEmailAction");
                    const cc = mail && mail.EmailConnectionConfig;
                    if (!cc || cc.Port !== "465" || cc.SecurityType !== "SSL" || cc.Host !== "'smtp.example.com'") r.push(`send email server not merged (${cc && [cc.Port, cc.SecurityType, cc.Host]})`);
                    const subj = mail && mail.EmailMessage && (v("11.12.0") ? mail.EmailMessage.SubjectTemplate.Text : mail.EmailMessage.Subject);
                    if (subj !== (v("11.12.0") ? "Order {1} shipped" : "'Order shipped'")) r.push(`send email subject is ${subj}`);
                }
                return r;
            },
            refusals: [
                [{ op: "changeAction", microflow: M("Rest"), id: "@rest", operation: `${mod}.${F}Api.Nope` }, /has no operation|not found|Did you mean/],
                [{ op: "changeAction", microflow: M("Rest"), id: "@rest", args: { nope: "1" } }, /has no parameter 'nope'/],
                [{ op: "changeAction", microflow: M("Rest"), id: "@rest", servr: {} }, /unknown field 'servr'/]
            ]
        },
        {
            name: "F10 moveAction and extractMicroflow with a custom error handler (the handler goes along)",
            ops: [
                { op: "createMicroflow", module: mod, name: `${F}Err`, folder: "ZzW", actions: [
                    { action: "variable", name: "N", type: "Integer", value: "1" },
                    { action: "log", message: "a" },
                    { action: "set", name: "N", value: "$N + 1", onError: { actions: [{ action: "log", message: "set failed", level: "Error" }, { action: "error" }] } },
                    { action: "log", message: "b" },
                    { action: "log", message: "c", onError: { actions: [{ action: "log", message: "c failed" }] } },
                    { action: "log", message: "d" }] }
            ],
            async then(s) {
                const flow = M("Err");
                const setId = await idOf(s, flow, o => o.action && o.action.structureTypeName === "Microflows$ChangeVariableAction");
                return [
                    { op: "moveAction", microflow: flow, id: await idOf(s, flow, logOf("c")), after: await idOf(s, flow, logOf("a")) },
                    { op: "extractMicroflow", microflow: flow, from: setId, to: await idOf(s, flow, logOf("b")), name: `${F}ErrSub`, folder: "ZzW" }
                ];
            },
            verify(p) {
                const r = [];
                const sub = named(p, `${F}ErrSub`);
                const main = named(p, `${F}Err`);
                const subTypes = actionsOf(sub).map(a => a.$Type);
                if (!sub || !subTypes.includes("Microflows$ChangeVariableAction") || !objectsOf(sub).some(o => o.$Type === "Microflows$ErrorEvent") || !(sub.Flows || []).some(f => f.IsErrorHandler)) r.push(`the extracted flow lacks the step with its error handler (${subTypes.join(", ")})`);
                if (main && actionsOf(main).some(a => a.$Type === "Microflows$ChangeVariableAction")) r.push("the set step is still in the main flow");
                if (main && (main.Flows || []).filter(f => f.IsErrorHandler).length !== 1) r.push("the moved log 'c' lost its error handler");
                return r;
            },
            refusals: [
                [{ op: "moveAction", microflow: M("Err"), id: "@handlerStep", after: "start" }, /first step of an error handler/],
                [{ op: "extractMicroflow", microflow: M("Err"), from: "@c", name: `${F}ErrSub2` }, /ends the flow \(an end event\)/]
            ]
        },
        {
            name: "F11/F12 decisions: change condition and caption, delete a branch (an if goes, a switch keeps its other ways), reroute a branch (merge in front, orphans deleted)",
            ops: [
                { op: "createMicroflow", module: mod, name: `${F}Dec`, folder: "ZzW", parameters: [{ name: "Item", type: E }], actions: [
                    { action: "if", condition: "$Item/Count > 1", caption: "Big?", then: [{ action: "log", message: "big" }, { action: "log", message: "big2" }], else: [{ action: "log", message: "small" }] },
                    { action: "switch", value: "$Item/Status", cases: { Open: [{ action: "log", message: "open" }], Done: [{ action: "log", message: "done" }] }, other: [{ action: "log", message: "other" }] },
                    { action: "log", message: "after" },
                    { action: "if", condition: "$Item/Flag", then: [{ action: "log", message: "flag" }], else: [{ action: "log", message: "no flag" }] },
                    { action: "log", message: "last" }] }
            ],
            async then(s) {
                const flow = M("Dec");
                const splits = [];
                const fl = await s.ops.get(flow);
                fl.objectCollection.objects.forEach(o => /Split$/.test(o.structureTypeName) && splits.push(o));
                const byCond = c => splits.find(o => o.splitCondition && o.splitCondition.expression === c).id.slice(0, 8);
                return [
                    { op: "changeAction", microflow: flow, id: byCond("$Item/Flag"), condition: "$Item/Flag = true", caption: "Flagged?" },
                    { op: "deleteBranch", microflow: flow, id: byCond("$Item/Count > 1"), branch: "false" },
                    { op: "deleteBranch", microflow: flow, id: byCond("$Item/Status"), branch: "Done" },
                    { op: "rerouteBranch", microflow: flow, id: byCond("$Item/Flag"), branch: "false", to: await idOf(s, flow, logOf("last")), deleteOrphans: true }
                ];
            },
            verify(p) {
                const r = [];
                const f = named(p, `${F}Dec`);
                const logs = actionsOf(f).filter(a => a.$Type === "Microflows$LogMessageAction").map(a => a.MessageTemplate && a.MessageTemplate.Text);
                for (const gone of ["small", "done", "no flag"]) if (logs.includes(gone)) r.push(`'${gone}' is still there`);
                for (const kept of ["big", "big2", "open", "other", "after", "flag", "last"]) if (!logs.includes(kept)) r.push(`'${kept}' was deleted`);
                const splits = objectsOf(f).filter(o => o.$Type === "Microflows$ExclusiveSplit");
                if (splits.some(o => /Count/.test(JSON.stringify(o.SplitCondition)))) r.push("the if on Count is still there (one branch left)");
                if (!splits.some(o => /Flag = true/.test(JSON.stringify(o.SplitCondition)) && o.Caption === "Flagged?")) r.push("changed condition / caption not stored");
                if (splits.length !== 2) r.push(`${splits.length} decisions left (want: the switch and the Flag if)`);
                // no object without a line in (but the start)
                const into = new Set((f.Flows || []).filter(x => x.$Type === "Microflows$SequenceFlow").map(x => x.DestinationPointer));
                const lonely = objectsOf(f).filter(o => !/StartEvent|Annotation|MicroflowParameter/.test(o.$Type) && !into.has(o.$ID));
                if (lonely.length) r.push(`${lonely.length} object(s) without a line in: ${lonely.map(o => o.$Type.split("$")[1]).join(", ")}`);
                return r;
            },
            refusals: [
                [{ op: "deleteBranch", microflow: M("Dec"), id: "@flagIf", branch: "maybe" }, /has no outgoing flow 'maybe'/],
                [{ op: "rerouteBranch", microflow: M("Dec"), id: "@flagIf", branch: "true", to: "@after" }, /makes a cycle/],
                [{ op: "rerouteBranch", microflow: M("Dec"), id: "@flagIf", branch: "true", to: "@last" }, /deleteOrphans/],
                [{ op: "deleteBranch", microflow: M("Dec"), id: "@after", branch: "true" }, /not a decision/]
            ]
        },
        {
            name: "F13 nanoflow calls a nanoflow: object, list and primitive parameters, a result, changeMicroflow updates the callers",
            ops: [
                { op: "createNanoflow", module: mod, name: `${F}NSub`, folder: "ZzW", parameters: [{ name: "Text", type: "String" }, { name: "Item", type: E }, { name: "Items", type: `List(${E})` }], returns: "Integer", returnValue: "length($Text)", actions: [] },
                { op: "createNanoflow", module: mod, name: `${F}NMain`, folder: "ZzW", parameters: [{ name: "Item", type: E }], actions: [
                    { action: "createList", variable: "All", entity: E },
                    { action: "call", microflow: M("NSub"), args: { Text: "$Item/Title", Item: "$Item", Items: "$All" }, variable: "Len" },
                    { action: "variable", name: "Twice", type: "Integer", value: "$Len * 2" }] }
            ],
            then: async () => [{ op: "changeMicroflow", microflow: M("NSub"), addParameters: [{ name: "Flag", type: "Boolean", value: "true" }], renameParameters: { Text: "Label" } }],
            verify(p) {
                const r = [];
                const call = actionsOf(named(p, `${F}NMain`)).find(a => a.$Type === "Microflows$NanoflowCallAction");
                const maps = call && call.NanoflowCall ? call.NanoflowCall.ParameterMappings.map(m => m.Parameter.split(".").pop()).sort().join() : "";
                if (!call || call.NanoflowCall.Nanoflow !== M("NSub") || call.OutputVariableName !== "Len" || maps !== "Flag,Item,Items,Label") r.push(`nanoflow call stored as ${call && call.NanoflowCall && call.NanoflowCall.Nanoflow} -> ${call && call.OutputVariableName} (${maps})`);
                return r;
            },
            refusals: [
                [{ op: "createNanoflow", module: mod, name: `${F}NBad`, actions: [{ action: "call", microflow: M("NSub"), args: { Txt: "'a'" } }] }, /Did you mean: Item|has no parameter 'Txt'/],
                [{ op: "createNanoflow", module: mod, name: `${F}NBad`, actions: [{ action: "call", microflow: M("NSub"), args: { Label: "'a'" } }] }, /needs args for/],
                [{ op: "createMicroflow", module: mod, name: `${F}NBad`, actions: [{ action: "call", microflow: M("NSub"), args: {} }] }, /cannot call a nanoflow/]
            ]
        },
        {
            name: "N-6 workflow settings (context entity, roles) and F8 lock / unlock workflow and workflow operations with changeAction",
            ops: [
                { op: "createEntity", module: mod, name: `${T}WCase`, attributes: [{ name: "Count", type: "Integer" }] },
                { op: "createEntity", module: mod, name: `${T}WOther`, attributes: [{ name: "Note", type: "String(100)" }] },
                { op: "createModuleRole", module: mod, name: "ZzWfRole" },
                { op: "createWorkflow", module: mod, name: `${F}Flow`, folder: "ZzW", context: E, steps: [
                    { step: "decision", name: "big", condition: "$WorkflowContext/Count > 10", outcomes: { true: [{ step: "waitForNotification", name: "wait" }], false: [] } }] },
                { op: "changeWorkflow", workflow: M("Flow"), context: `${E}WCase`, roles: [`${mod}.ZzWfRole`], title: "Zz flow" },
                { op: "createMicroflow", module: mod, name: `${F}Lock`, folder: "ZzW", parameters: [{ name: "Wf", type: "System.Workflow" }], actions: [
                    { action: "lockWorkflow", workflow: M("Flow"), pauseAll: true },
                    { action: "unlockWorkflow", workflow: M("Flow"), resumeAll: true },
                    { action: "changeWorkflowState", workflow: "Wf", operation: "pause" }] }
            ],
            async then(s) {
                return [
                    { op: "changeAction", microflow: M("Lock"), id: await idOf(s, M("Lock"), o => o.action && /UnlockWorkflow/.test(o.action.structureTypeName)), resumeAll: false },
                    { op: "changeAction", microflow: M("Lock"), id: await idOf(s, M("Lock"), o => o.action && /WorkflowOperation/.test(o.action.structureTypeName)), operation: "abort", reason: "stopped" }
                ];
            },
            verify(p) {
                const r = [];
                const w = named(p, `${F}Flow`);
                if (!w || !w.Parameter || w.Parameter.Entity !== `${E}WCase`) r.push(`workflow context is ${w && w.Parameter && w.Parameter.Entity}`);
                const acts = actionsOf(named(p, `${F}Lock`));
                const unlock = acts.find(a => a.$Type === "Microflows$UnlockWorkflowAction");
                if (!unlock || unlock.ResumeAllPausedWorkflows !== false) r.push("unlock workflow not stored / changed");
                if (!acts.some(a => a.$Type === "Microflows$LockWorkflowAction" && a.PauseAllWorkflows === true)) r.push("lock workflow not stored");
                const op = acts.find(a => a.$Type === "Microflows$WorkflowOperationAction");
                if (!op || !op.Operation || op.Operation.$Type !== "Microflows$AbortOperation") r.push(`workflow operation is ${op && op.Operation && op.Operation.$Type}`);
                return r;
            },
            refusals: [
                [{ op: "changeWorkflow", workflow: M("Flow"), context: `${E}WOther` }, /still needs .*Count/],
                [{ op: "changeWorkflow", workflow: M("Flow"), adminPage: `${mod}.NoSuchPage` }, /no page|not found/],
                [{ op: "changeWorkflow", workflow: M("Flow"), roles: [] }, /roles is/],
                [{ op: "addActions", microflow: M("Lock"), actions: [{ action: "changeWorkflowState", workflow: "Wf", operation: "resume" }] }, /Did you mean|not one of/]
            ]
        },
        {
            name: "N-8 callJava preset publishBusinessEvent (a Business Events module with its publish Java action)",
            ops: [
                { op: "createModule", name: "BusinessEvents" },
                { op: "createEntity", module: "BusinessEvents", name: "PublishedBusinessEvent", attributes: [{ name: "Topic", type: "String(200)" }] },
                { op: "createJavaAction", module: "BusinessEvents", name: "PublishBusinessEvent", parameters: [{ name: "businessEvent", type: "BusinessEvents.PublishedBusinessEvent" }], returns: "Boolean", compile: false },
                { op: "createEntity", module: mod, name: `${T}Shipped`, generalization: "BusinessEvents.PublishedBusinessEvent", attributes: [{ name: "OrderNo", type: "String(20)" }] },
                { op: "createMicroflow", module: mod, name: `${F}Pub`, folder: "ZzW", parameters: [{ name: "Ev", type: `${E}Shipped` }], actions: [{ action: "callJava", preset: "publishBusinessEvent", event: "Ev", variable: "Sent" }] }
            ],
            verify(p) {
                const call = actionsOf(named(p, `${F}Pub`)).find(a => a.$Type === "Microflows$JavaActionCallAction");
                const arg = call && call.ParameterMappings && call.ParameterMappings[0];
                return call && call.JavaAction === "BusinessEvents.PublishBusinessEvent" && arg && arg.Value && arg.Value.Argument === "$Ev" && call.ResultVariableName === "Sent" ? [] : [`publish business event call stored as ${JSON.stringify(call).slice(0, 200)}`];
            },
            refusals: [
                [{ op: "addActions", microflow: M("Pub"), actions: [{ action: "callJava", preset: "publishBusinessEvent", event: "Ev", javaAction: "BusinessEvents.PublishBusinessEvent" }] }, /not both/],
                [{ op: "addActions", microflow: M("Pub"), actions: [{ action: "create", variable: "X", entity: E }, { action: "callJava", preset: "publishBusinessEvent", event: "X" }] }, /no published business event/],
                [{ op: "addActions", microflow: M("Pub"), actions: [{ action: "callJava", preset: "sendEvent", event: "Ev" }] }, /preset 'sendEvent' is not known/]
            ]
        }
    ];
}

// Refusal fields "@name": a step id of the plan's flow, looked up when the refusal runs.
async function placeholders(s, o, mod, T) {
    const at = Object.entries(o).filter(([, v]) => typeof v === "string" && v.startsWith("@") && !v.includes("."));
    if (!at.length) return o;
    const qn = o.microflow;
    const find = {
        rest: x => x.action && /RestOperationCall/.test(x.action.structureTypeName),
        handlerStep: logOf("c failed"),
        c: logOf("c"),
        after: logOf("after"),
        last: logOf("last"),
        flagIf: x => x.splitCondition && x.splitCondition.expression === "$Item/Flag = true"
    };
    const out = { ...o };
    for (const [k, v] of at) out[k] = await idOf(s, qn, find[v.slice(1)]);
    return out;
}

async function wflowsPhase({ s2, reopen, copy, mod, T, layout, layoutProblems, check, results }) {
    const env = { reopen, copy, layout, layoutProblems };
    let s = s2;
    const firstUse = new Set();
    for (const st of steps(mod, T, String(s.model.metaModelVersion))) {
        const problems = [];
        if (st.skip && st.skip(s)) {
            results.push(`SKIP ${st.name}: ${st.skip(s)}`);
            continue;
        }
        let r;
        try {
            // a step that changes what its plan made (ids from the model) runs that in a second plan
            let ops = st.ops;
            if (st.then) {
                r = await integ.runPhase(env, s, { ops }, () => []);
                if (r.problems.length) throw new Error(r.problems.join("; "));
                s = r.s;
                ops = await st.then(s);
            }
            r = await integ.runPhase(env, s, { ops }, p => st.verify(p));
        } catch (e) {
            problems.push(`plan failed: ${e.message.split("\n")[0]}`);
            s = await reopen(copy);
            check(`flows W: ${st.name}`, false, problems.join("; "));
            continue;
        }
        s = r.s;
        problems.push(...r.problems);
        r.firstUse.forEach(w => firstUse.add(w));
        for (const [o0, re, mayRun] of st.refusals || []) {
            let msg = "";
            try {
                const o = await placeholders(s, o0, mod, T);
                await s.ops.runPlan({ ops: [o] }, () => {});
            } catch (e) {
                msg = e.message;
            }
            if (!re.test(msg) && !(mayRun && !msg)) problems.push(`${o0.op} not refused with ${re}${msg ? `: ${msg.slice(0, 160)}` : " (it ran)"}`);
            s = await reopen(copy);
        }
        check(`flows W: ${st.name}; ${(st.refusals || []).length} refusals; reopen 0 errors / 0 deltas`, !problems.length, problems.slice(0, 6).join("; "));
    }
    if (firstUse.size) results.push(`NOTE flows W first use (no Studio Pro sample): ${[...firstUse].join(", ")}`);
    return s;
}

module.exports = { wflowsPhase };
