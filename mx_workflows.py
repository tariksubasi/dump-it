"""Render Mendix workflows (Mendix 9.x-11.x) as numbered, indented pseudo-code.

Workflows are stored as nested flows (activity -> outcomes -> flow -> activities), so they are rendered as a tree.
Field names are read case-insensitively because storage casing differs between Mendix versions.
"""
import re

from mx_model import clean, compact, field, short, template, type_name

_STEP = re.compile(r"\{\{STEP:([^}]*)\}\}")
SIMPLE = {
    "StartWorkflowActivity": "START",
    "EndWorkflowActivity": "END WORKFLOW",
    "EndOfParallelSplitPathActivity": "END OF PARALLEL PATH",
    "EndOfBoundaryEventPathActivity": "END OF EVENT PATH",
    "MergeActivity": "MERGE",
}


def _page(ref):
    return field(ref, "Page") if isinstance(ref, dict) else ref


def _microflow(value):
    return field(value, "Microflow") or field(field(value, "MicroflowEventHandler"), "Microflow")


class WorkflowRenderer:
    def __init__(self, doc, qn, unit, index):
        self.doc, self.qn, self.unit, self.index = doc, qn, unit, index
        self.lines, self.step, self.steps = [], 0, {}
        self.names = {}
        self._collect_ids(doc)
        self.summary = []
        self.waits = []

    def _collect_ids(self, value):
        if isinstance(value, dict):
            label = field(value, "Name") or field(value, "Value")
            if value.get("$ID") and label is not None and type_name(value) != "Workflow":
                self.names[value["$ID"]] = str(label)
            for v in value.values():
                self._collect_ids(v)
        elif isinstance(value, list):
            for v in value:
                self._collect_ids(v)

    def _ref(self, value):
        """Resolve a by-id / by-name reference to an activity or outcome name."""
        if isinstance(value, dict):
            value = field(value, "Activity", "Name", "Value") or compact(value, 80)
        value = str(value or "?")
        return self.names.get(value) or short(value)

    # ------------------------------------------------------------------ output

    def render(self):
        d, u = self.doc, self.unit
        out = ["WORKFLOW " + self.qn]
        if u.excluded:
            out.append("EXCLUDED: yes (not part of the build)")
        if u.folder:
            out.append("FOLDER: " + u.folder)
        param = field(d, "Parameter")
        entity = field(param, "Entity") or field(d, "ContextEntity", "WorkflowEntity")
        if entity:
            out.append("CONTEXT: $%s: %s" % (field(param, "Name") or "WorkflowContext", entity))
            self.summary.append("context: " + entity)
        for label, key in (("TITLE", "Title"), ("DUE DATE", "DueDate")):
            if clean(field(d, key)):
                out.append("%s: %s" % (label, clean(field(d, key))))
        for label, key in (("NAME", "WorkflowName"), ("DESCRIPTION", "WorkflowDescription")):
            t = template(field(d, key))
            if t and t != "''":
                out.append("%s: %s" % (label, t))
        admin = _page(field(d, "AdminPage")) or field(d, "OverviewPage")
        if admin:
            out.append("ADMIN PAGE: " + admin)
        if field(d, "AllowedModuleRoles"):
            out.append("ALLOWED ROLES: " + ", ".join(field(d, "AllowedModuleRoles")))
        events = []
        for label, key in (("workflow state change", "WorkflowOnStateChangeEvent"), ("user task state change", "UsertaskOnStateChangeEvent")):
            mf = _microflow(field(d, key))
            if mf:
                events.append("%s -> %s" % (label, mf))
        for handler in field(d, "OnWorkflowEvent") or []:
            types = field(handler, "EventTypes")
            events.append("on %s -> %s" % (", ".join(str(t) for t in types) if types else "workflow event", _microflow(handler)))
        if events:
            out.append("EVENT HANDLERS:")
            out += ["  " + e for e in events]
        note = field(field(d, "Annotation"), "Description")
        if note:
            out.append("NOTE: " + clean(note))
        if clean(d.get("Documentation")):
            out.append("DOC: " + clean(d["Documentation"]))

        out += ["", "FLOW:"]
        self._flow(field(d, "Flow"), 1)
        for sub in field(d, "EventSubProcesses") or []:
            self.lines += ["", "EVENT SUB-PROCESS %s:" % (field(sub, "Caption", "Name") or type_name(sub))]
            self._flow(field(sub, "Flow"), 1)
        body = _STEP.sub(lambda m: str(self.steps.get(m.group(1), "?")), "\n".join(self.lines))
        self.index.workflows[self.qn] = self.summary
        self.index.wait_points[self.qn] = self.waits
        return "\n".join(out) + "\n" + body + "\n"

    def _emit(self, indent, line):
        self.lines.append("  " * indent + line)

    def _flow(self, flow, indent):
        for activity in field(flow, "Activities") or []:
            self._activity(activity, indent)

    # --------------------------------------------------------------- activities

    def _activity(self, a, indent):
        kind = type_name(a)
        name = field(a, "Name") or ""
        caption = clean(field(a, "Caption"))
        label = name + (" \"%s\"" % caption if caption and caption != name else "")
        self.step += 1
        number = self.step
        if name:
            self.steps.setdefault(name, number)
        sub = []
        handler = getattr(self, "_a_" + kind, None)
        if kind in SIMPLE:
            line = SIMPLE[kind]
        elif handler:
            line, sub = handler(a, label)
        elif "UserTask" in kind:
            line, sub = self._user_task(a, label, kind)
        else:
            self.index.unknown_type(a.get("$Type"))
            line = "%s %s %s" % (kind.upper(), label, compact({k: v for k, v in a.items() if k.lower() not in ("outcomes", "boundaryevents")}, 300))
        self._emit(indent, "%d. %s" % (number, line.rstrip()))
        for s in sub:
            self._emit(indent + 2, s)
        note = field(field(a, "Annotation"), "Description")
        if note:
            self._emit(indent + 2, "NOTE: " + clean(note))
        for event in field(a, "BoundaryEvents") or []:
            self._boundary(event, indent + 1)
        for i, outcome in enumerate(field(a, "Outcomes") or [], 1):
            self._emit(indent + 1, "[%s]" % self._outcome_label(outcome, i))
            if field(field(outcome, "Flow"), "Activities"):
                self._flow(field(outcome, "Flow"), indent + 2)
            else:
                self._emit(indent + 2, "(no steps: continues after step %d)" % number)

    def _outcome_label(self, outcome, i):
        kind = type_name(outcome)
        if kind == "ParallelSplitOutcome":
            return "path %d" % i
        if kind == "VoidConditionOutcome":
            return "(empty)"
        value = field(outcome, "Value", "Name", "Caption")
        if isinstance(value, bool) or kind == "BooleanConditionOutcome":
            return "true" if value else "false"
        return short(str(value)) if kind == "EnumerationValueConditionOutcome" else str(value or kind)

    def _boundary(self, event, indent):
        kind = type_name(event)
        if "Timer" in kind:
            what = "timer %s" % (clean(field(event, "Delay", "FirstExecutionTime")) or "(time not set)")
            recurrence = field(event, "Recurrence")
            if isinstance(recurrence, dict):
                what += " repeating %s" % compact(recurrence, 120)
        else:
            what = "notification %s" % (field(event, "Name") or "")
        mode = "interrupting" if kind.startswith("Interrupting") or field(event, "IsInterrupting") else "non-interrupting"
        caption = clean(field(event, "Caption"))
        self._emit(indent, "ON %s (%s boundary event)%s:" % (what, mode, " \"%s\"" % caption if caption else ""))
        self._flow(field(event, "Flow"), indent + 1)

    def _user_task(self, a, label, kind):
        multi = "Multi" in kind
        sub = []
        page = _page(field(a, "TaskPage"))
        if page:
            sub.append("page: " + page)
        for key, text_label in (("TaskName", "task name"), ("TaskDescription", "task description")):
            t = template(field(a, key))
            if t and t != "''":
                sub.append("%s: %s" % (text_label, t))
        if clean(field(a, "DueDate")):
            sub.append("due: " + clean(field(a, "DueDate")))
        assigned = self._assignment(field(a, "UserTargeting", "UserSource"))
        sub.append("assigned to: " + assigned)
        if field(a, "AutoAssignSingleTargetUser"):
            sub.append("auto-assign when exactly one user qualifies")
        created = _microflow(field(a, "OnCreatedEvent"))
        if created:
            sub.append("on created: " + created)
        completion = field(a, "Completion")
        criteria = field(a, "CompletionCriteria") or field(completion, "CompletionCriteria")
        if multi or criteria:
            sub.append("completion: " + self._criteria(criteria, a, completion))
        outcomes = [self._outcome_label(o, i) for i, o in enumerate(field(a, "Outcomes") or [], 1)]
        self.summary.append("user task %s: assigned to %s%s; outcomes %s" % (
            label, assigned, "; page " + page if page else "", ", ".join(outcomes) or "-"))
        return "%s %s" % ("MULTI-USER TASK" if multi else "USER TASK", label), sub

    def _assignment(self, source):
        if not isinstance(source, dict):
            return "(not set)"
        kind = type_name(source)
        group = "groups" if "Group" in kind else "users"
        xpath = clean(field(source, "XPathConstraint"))
        microflow = field(source, "Microflow")
        if xpath:
            return "%s matching XPath %s" % (group, xpath)
        if microflow:
            return "%s returned by microflow %s" % (group, microflow)
        if kind.startswith(("No", "Empty")):
            return "nobody (assigned later)"
        return "%s %s" % (kind, compact(source, 150))

    def _criteria(self, criteria, task, completion):
        if not isinstance(criteria, dict):
            return "(not set)"
        kind = type_name(criteria).replace("CompletionCriteria", "").lower() or "?"
        parts = [kind]
        for key, label in (("VetoOutcome", "veto outcome"), ("FallbackOutcome", "fallback outcome")):
            ref = field(criteria, key + "Pointer", key)
            if ref:
                parts.append("%s %s" % (label, self._ref(ref)))
        if field(criteria, "Threshold") is not None:
            parts.append("threshold %s %s" % (field(criteria, "Threshold"), field(criteria, "CompletionType") or ""))
        if field(criteria, "Microflow"):
            parts.append("decided by microflow " + field(criteria, "Microflow"))
        if field(task, "AwaitAllUsers") or field(completion, "AwaitAllUsers"):
            parts.append("waits for all users")
        target = field(task, "TargetUserInput") or field(completion, "TargetUserInput")
        if target:
            parts.append("users needed: %s %s" % (type_name(target).replace("UserInput", ""), compact(target, 80)))
        return ", ".join(p.strip() for p in parts)

    def _mappings(self, a):
        return ", ".join("%s=%s" % (short(str(field(m, "Parameter") or "?")), clean(field(m, "Expression")))
                         for m in field(a, "ParameterMappings") or [])

    def _a_CallMicroflowTask(self, a, label):
        mf = field(a, "Microflow")
        return "CALL MICROFLOW %s(%s) %s" % (mf, self._mappings(a), label), []

    _a_CallMicroflowActivity = _a_CallMicroflowTask

    def _a_ExclusiveSplitActivity(self, a, label):
        return "DECISION %s: %s" % (label, clean(field(a, "Expression"))), []

    def _a_ParallelSplitActivity(self, a, label):
        return "PARALLEL SPLIT %s (all paths run)" % label, []

    def _a_JumpToActivity(self, a, label):
        target = self._ref(field(a, "TargetActivityPointer", "TargetActivity"))
        return "JUMP TO %s (step {{STEP:%s}}) %s" % (target, target, label), []

    def _a_WaitForTimerActivity(self, a, label):
        delay = clean(field(a, "Delay"))
        self.summary.append("timer %s: %s" % (label, delay))
        return "WAIT FOR TIMER %s: %s" % (label, delay), []

    def _a_WaitForNotificationActivity(self, a, label):
        name = field(a, "Name") or label
        self.waits.append(name)
        return "WAIT FOR NOTIFICATION %s (see NOTIFIED BY at the end)" % label, []

    def _a_CallWorkflowActivity(self, a, label):
        wf = field(a, "Workflow")
        mappings = self._mappings(a) or clean(field(a, "ParameterExpression"))
        self.summary.append("calls workflow %s" % wf)
        return "CALL WORKFLOW %s(%s)%s %s" % (wf, mappings, " [async]" if field(a, "ExecuteAsync") else "", label), []
