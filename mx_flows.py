"""Render microflows, nanoflows and rules as structured, numbered pseudo-code."""
from mx_model import clean, compact, dtype, short, template, text

START = "Microflows$StartEvent"
MERGE = "Microflows$ExclusiveMerge"
LOOP = "Microflows$LoopedActivity"
ANNOTATION = "Microflows$Annotation"
SPLITS = {"Microflows$ExclusiveSplit", "Microflows$InheritanceSplit"}
EXIT = "__exit__"
HEADINGS = {"Microflows$Microflow": "MICROFLOW", "Microflows$Nanoflow": "NANOFLOW", "Microflows$Rule": "RULE"}
ON_ERROR = {
    "Continue": "[on error: continue]",
    "Custom": "[on error: custom handler, rollback]",
    "CustomWithoutRollback": "[on error: custom handler, no rollback]",
}
COMMIT = {"Yes": " + COMMIT", "YesWithoutEvents": " + COMMIT (no events)"}


def _is_parameter(obj):
    t = obj.get("$Type", "")
    return t.startswith("Microflows$") and t.endswith("Parameter")


def flow_signature(doc):
    params = ["%s: %s" % (o.get("Name"), dtype(o.get("VariableType") or o.get("ParameterType")))
              for o in (doc.get("ObjectCollection") or {}).get("Objects") or [] if _is_parameter(o)]
    ret = dtype(doc.get("MicroflowReturnType"))
    return "(%s)%s" % (", ".join(params), " -> " + ret if ret and ret != "Void" else "")


class FlowRenderer:
    def __init__(self, doc, qn, unit, ctx, index):
        self.doc, self.qn, self.unit, self.ctx, self.index = doc, qn, unit, ctx, index
        self.objs, self.scopes = {}, {}
        self._collect(doc.get("ObjectCollection"), None)
        self.succ, self.preds, self.notes = {}, {}, {}
        attached = set()
        for f in doc.get("Flows") or []:
            origin, dest = f.get("OriginPointer"), f.get("DestinationPointer")
            if origin not in self.objs or dest not in self.objs:
                continue
            if f.get("$Type") == "Microflows$AnnotationFlow":
                note, target = (origin, dest) if self.objs[origin]["$Type"] == ANNOTATION else (dest, origin)
                self.notes.setdefault(target, []).append(clean(self.objs[note].get("Caption")))
                attached.add(note)
            else:
                self.succ.setdefault(origin, []).append((dest, f))
                self.preds.setdefault(dest, []).append(origin)
        self.free_notes = [clean(o.get("Caption")) for i, o in self.objs.items()
                           if o["$Type"] == ANNOTATION and i not in attached]
        self.params = [o for o in self.objs.values() if _is_parameter(o)]
        self.ipdom = {}
        for nodes in self.scopes.values():
            self.ipdom.update(self._post_dominators(nodes))
        self.labels = {}

    def _collect(self, collection, scope):
        for o in (collection or {}).get("Objects") or []:
            oid = o.get("$ID")
            self.objs[oid] = o
            if o["$Type"] != ANNOTATION and not _is_parameter(o):
                self.scopes.setdefault(scope, []).append(oid)
            if o["$Type"] == LOOP:
                self.scopes.setdefault(oid, [])
                self._collect(o.get("ObjectCollection"), oid)

    def _post_dominators(self, nodes):
        members = set(nodes)
        succ = {n: [d for d, _ in self.succ.get(n, []) if d in members] or [EXIT] for n in nodes}
        full = members | {EXIT}
        pdom = {n: set(full) for n in nodes}
        pdom[EXIT] = {EXIT}
        changed = True
        while changed:
            changed = False
            for n in reversed(nodes):
                new = set.intersection(*(pdom[s] for s in succ[n])) | {n}
                if new != pdom[n]:
                    pdom[n], changed = new, True
        result = {}
        for n in nodes:
            if pdom[n] == full:
                continue
            strict = pdom[n] - {n}
            for d in strict:
                if pdom[d] == strict:
                    result[n] = d
                    break
        return result

    # ---------------------------------------------------------------- output

    def render(self):
        self._walk()
        order = [n for n in self.order if n in self.jump_targets]
        self.labels = {n: "L%d" % i for i, n in enumerate(order, 1)}
        self._walk()
        return "\n".join(self._header() + ["", "FLOW:"] + self.lines) + "\n"

    def _header(self):
        d, u = self.doc, self.unit
        out = ["%s %s" % (HEADINGS.get(d["$Type"], d["$Type"]), self.qn)]
        if u.excluded:
            out.append("EXCLUDED: yes (not part of the build)")
        if u.folder:
            out.append("FOLDER: " + u.folder)
        if "AllowedModuleRoles" in d:
            out.append("ALLOWED ROLES: " + (", ".join(d["AllowedModuleRoles"]) or "(none - callable only from other flows)"))
        if "ApplyEntityAccess" in d:
            out.append("APPLY ENTITY ACCESS: " + ("yes" if d["ApplyEntityAccess"] else "no"))
        if d.get("AllowConcurrentExecution") is False:
            handler = d.get("ConcurrencyErrorMicroflow") or text(d.get("ConcurrenyErrorMessage"))
            out.append("CONCURRENT EXECUTION: disallowed (on conflict: %s)" % (handler or "error"))
        if d.get("Url"):
            out.append("URL: " + d["Url"])
        ret = dtype(d.get("MicroflowReturnType"))
        if ret and ret != "Void":
            out.append("RETURNS: " + ret + (" as $" + d["ReturnVariableName"] if d.get("ReturnVariableName") else ""))
        if self.params:
            out.append("PARAMETERS:")
            for p in self.params:
                line = "  $%s: %s" % (p.get("Name"), dtype(p.get("VariableType") or p.get("ParameterType")))
                if p.get("Documentation"):
                    line += "  // " + clean(p["Documentation"])
                out.append(line)
        if clean(d.get("Documentation")):
            out.append("DOC: " + clean(d["Documentation"]))
        for n in self.free_notes:
            out.append("NOTE: " + n)
        return out

    def _emit(self, indent, line):
        self.lines.append("  " * indent + line)

    def _label(self, node):
        return self.labels.get(node, "?")

    # --------------------------------------------------------------- walking

    def _walk(self):
        self.lines, self.done, self.order, self.step = [], set(), [], 0
        self.jump_targets = set()
        self.var_types = {}
        for p in self.params:
            t = p.get("VariableType") or {}
            if t.get("Entity"):
                self.var_types[p.get("Name")] = t["Entity"]
        top = self.scopes.get(None, [])
        starts = [n for n in top if self.objs[n]["$Type"] == START] or [n for n in top if n not in self.preds]
        for s in starts:
            self._seq(s, None, 1)
        self._orphans(top, 1)

    def _orphans(self, nodes, indent):
        left = [n for n in nodes if n not in self.done and self.objs[n]["$Type"] != START]
        if left:
            self._emit(indent, "UNREACHABLE (not connected to the flow):")
            for n in left:
                if n not in self.done:
                    self._seq(n, None, indent + 1)

    def _seq(self, node, stop, indent):
        """Render a path until `stop`. Returns True if the path reached `stop`."""
        while node is not None and node != EXIT:
            if node == stop:
                return True
            if node in self.done:
                self.jump_targets.add(node)
                self._emit(indent, "-> go to " + self._label(node))
                return False
            self.done.add(node)
            self.order.append(node)
            obj = self.objs[node]
            kind = obj["$Type"]
            outs = self.succ.get(node, [])
            normal = [(d, f) for d, f in outs if not f.get("IsErrorHandler")]
            errors = [(d, f) for d, f in outs if f.get("IsErrorHandler")]
            if kind in (MERGE, START):
                if node in self.labels:
                    self._emit(indent, self._label(node) + ":")
                node = normal[0][0] if normal else None
                continue
            if kind in SPLITS:
                self._node(node, obj, indent)
                join = self.ipdom.get(node)
                for dest, flow in sorted(normal, key=lambda x: self._case_order(x[1])):
                    self._emit(indent + 1, "[%s]" % self._case(flow))
                    self._seq(dest, join, indent + 2)
                self._error_branch(node, errors, indent)
                node = join if join not in (None, EXIT) else None
                continue
            self._node(node, obj, indent)
            self._error_branch(node, errors, indent)
            node = normal[0][0] if normal else None
        return False

    def _error_branch(self, node, errors, indent):
        if not errors:
            return
        join = self.ipdom.get(node)
        self._emit(indent + 1, "ON ERROR:")
        if self._seq(errors[0][0], join, indent + 2) and join not in (None, EXIT):
            self.jump_targets.add(join)
            self._emit(indent + 2, "-> continue main flow at " + self._label(join))

    def _case(self, flow):
        labels = []
        for c in flow.get("CaseValues") or []:
            t = c.get("$Type", "")
            if t.endswith("NoCase"):
                labels.append("(empty/other)")
            else:
                labels.append(str(c.get("Value")) if c.get("Value") not in (None, "") else "(empty)")
        return " | ".join(labels) or "(default)"

    def _case_order(self, flow):
        label = self._case(flow)
        return ({"true": 0, "false": 1}.get(label, 3 if label.startswith("(") else 2), label)

    # ----------------------------------------------------------------- nodes

    def _node(self, node, obj, indent):
        kind = obj["$Type"]
        self.step += 1
        prefix = "%s%d. " % (self._label(node) + ": " if node in self.labels else "", self.step)
        sub = []
        if kind == "Microflows$ActionActivity":
            action = obj.get("Action") or {}
            line, sub = self._action(action)
            if obj.get("Disabled"):
                line = "[DISABLED] " + line
            flag = ON_ERROR.get(action.get("ErrorHandlingType"))
            if flag:
                line += " " + flag
            caption = clean(obj.get("Caption"))
            if not obj.get("AutoGenerateCaption", True) and caption:
                line += "  \"%s\"" % caption
        elif kind in SPLITS:
            line = self._split(obj)
        elif kind == LOOP:
            line = self._loop_head(obj)
        elif kind == "Microflows$EndEvent":
            ret = clean(obj.get("ReturnValue"))
            line = "RETURN " + ret if ret else "END"
        elif kind == "Microflows$ErrorEvent":
            line = "THROW ERROR (re-raise $latestError)"
        elif kind == "Microflows$BreakEvent":
            line = "BREAK LOOP"
        elif kind == "Microflows$ContinueEvent":
            line = "CONTINUE LOOP"
        else:
            self.index.unknown_type(kind)
            line = "%s %s" % (kind.split("$", 1)[-1].upper(), compact(obj))
        doc = clean(obj.get("Documentation"))
        if doc:
            line += "  // " + doc
        self._emit(indent, prefix + line)
        for s in sub:
            self._emit(indent + 2, s)
        for n in self.notes.get(node, []):
            self._emit(indent + 2, "NOTE: " + n)
        if kind == LOOP:
            body = self.scopes.get(node, [])
            members = set(body)
            starts = [c for c in body if not any(p in members for p in self.preds.get(c, []))]
            for s in starts:
                self._seq(s, None, indent + 1)
            self._orphans(body, indent + 1)

    def _split(self, obj):
        caption = clean(obj.get("Caption"))
        suffix = "  \"%s\"" % caption if caption else ""
        if obj["$Type"] == "Microflows$InheritanceSplit":
            return "SPLIT ON TYPE OF $%s%s" % (obj.get("SplitVariableName"), suffix)
        cond = obj.get("SplitCondition") or {}
        if cond.get("$Type", "").endswith("RuleSplitCondition"):
            call = cond.get("RuleCall") or {}
            return "IF RULE %s(%s)%s" % (call.get("Microflow"), self._args(call.get("ParameterMappings")), suffix)
        return "IF %s%s" % (clean(cond.get("Expression")), suffix)

    def _loop_head(self, obj):
        src = obj.get("LoopSource") or {}
        if src.get("$Type", "").endswith("WhileLoopCondition"):
            return "WHILE %s" % clean(src.get("WhileExpression"))
        item, lst = src.get("VariableName"), src.get("ListVariableName")
        if lst in self.var_types:
            self.var_types[item] = self.var_types[lst]
        return "FOR EACH $%s IN $%s" % (item, lst)

    # --------------------------------------------------------------- actions

    def _args(self, mappings):
        out = []
        for m in mappings or []:
            value = m.get("Argument")
            if value is None:
                v = m.get("Value") or m.get("ParameterValue") or {}
                value = v.get("Argument") or v.get("Entity") or v.get("Microflow") or v.get("Nanoflow") or compact(v)
            out.append("%s=%s" % (short(m.get("Parameter")), clean(value)))
        return ", ".join(out)

    def _items(self, items):
        out = []
        for it in items or []:
            op = {"Set": "=", "Add": "+=", "Remove": "-="}.get(it.get("Type"), it.get("Type"))
            if it.get("Attribute"):
                target = short(it["Attribute"])
                self.index.attr_write(it["Attribute"], self.qn)
            else:
                target = it.get("Association")
            out.append("%s %s %s" % (target, op, clean(it.get("Value"))))
        return out

    def _result(self, name, entity=None):
        if entity:
            self.var_types[name] = entity
        return "$%s = " % name if name else ""

    def _action(self, a):
        kind = a.get("$Type", "").split("$", 1)[-1]
        handler = getattr(self, "_a_" + kind, None)
        if handler:
            return handler(a)
        self.index.unknown_type(a.get("$Type"))
        self.index.effect("ACTIONS WITHOUT A DEDICATED RENDERER (may call external systems, check the flow file)",
                          "%s: %s %s" % (self.qn, kind, compact(a, 200)))
        return "%s %s" % (kind.upper(), compact(a)), []

    def _a_RetrieveAction(self, a):
        src = a.get("RetrieveSource") or {}
        res = a.get("ResultVariableName")
        if src.get("$Type", "").endswith("AssociationRetrieveSource"):
            start, assoc = src.get("StartVariableName"), src.get("AssociationId")
            target = self.ctx.assoc_target(assoc, self.var_types.get(start))
            self.index.entity(target, "retrieve", self.qn)
            return "%sRETRIEVE $%s/%s (over association)" % (self._result(res, target), start, assoc), []
        entity = src.get("Entity")
        self.index.entity(entity, "retrieve", self.qn)
        rng = src.get("Range") or {}
        if rng.get("$Type", "").endswith("CustomRange"):
            amount = "limit %s offset %s" % (clean(rng.get("LimitExpression")) or "-", clean(rng.get("OffsetExpression")) or "0")
        else:
            amount = "FIRST" if rng.get("SingleObject") else "ALL"
        line = "%sRETRIEVE %s %s FROM DATABASE" % (self._result(res, entity), amount, entity)
        xpath = clean(src.get("XpathConstraint"))
        if xpath:
            line += " WHERE " + xpath
        sorts = [(s.get("AttributeRef") or {}).get("Attribute") for s in (src.get("NewSortings") or {}).get("Sortings") or []]
        if sorts:
            line += " SORT BY " + ", ".join(short(s) for s in sorts if s)
        return line, []

    def _a_CreateChangeAction(self, a):
        entity, var = a.get("Entity"), a.get("VariableName")
        self.index.entity(entity, "create", self.qn)
        if a.get("Commit") in COMMIT:
            self.index.entity(entity, "commit", self.qn)
        line = "%sCREATE %s%s" % (self._result(var, entity), entity, COMMIT.get(a.get("Commit"), ""))
        return line, self._items(a.get("Items"))

    def _a_ChangeAction(self, a):
        var = a.get("ChangeVariableName")
        entity = self.var_types.get(var)
        self.index.entity(entity, "change", self.qn)
        if a.get("Commit") in COMMIT:
            self.index.entity(entity, "commit", self.qn)
        line = "CHANGE $%s%s%s" % (var, " (%s)" % entity if entity else "", COMMIT.get(a.get("Commit"), ""))
        return line, self._items(a.get("Items"))

    def _a_CommitAction(self, a):
        var = a.get("CommitVariableName")
        self.index.entity(self.var_types.get(var), "commit", self.qn)
        return "COMMIT $%s%s" % (var, "" if a.get("WithEvents", True) else " (without events)"), []

    def _a_DeleteAction(self, a):
        var = a.get("DeleteVariableName")
        self.index.entity(self.var_types.get(var), "delete", self.qn)
        return "DELETE $%s" % var, []

    def _a_RollbackAction(self, a):
        return "ROLLBACK $%s" % a.get("RollbackVariableName"), []

    def _a_CreateVariableAction(self, a):
        return "DECLARE $%s: %s = %s" % (a.get("VariableName"), dtype(a.get("VariableType")), clean(a.get("InitialValue"))), []

    def _a_ChangeVariableAction(self, a):
        return "SET $%s = %s" % (a.get("ChangeVariableName"), clean(a.get("Value"))), []

    def _a_CreateListAction(self, a):
        return "%sNEW LIST OF %s" % (self._result(a.get("VariableName"), a.get("Entity")), a.get("Entity")), []

    def _a_ChangeListAction(self, a):
        return "LIST %s $%s %s" % ((a.get("Type") or "").upper(), a.get("ChangeVariableName"), clean(a.get("Value"))), []

    def _a_ListOperationsAction(self, a):
        op = a.get("NewOperation") or {}
        name = op.get("$Type", "").split("$", 1)[-1]
        lst = op.get("ListName")
        args = ["$%s" % lst]
        if op.get("SecondListOrObjectName"):
            args.append("$" + op["SecondListOrObjectName"])
        member = short(op.get("Attribute")) or op.get("Association")
        expr = clean(op.get("Expression"))
        if member:
            args.append("%s = %s" % (member, expr))
        elif expr:
            args.append("where " + expr)
        sorts = (op.get("Sortings") or {}).get("Sortings") or []
        if sorts:
            args.append("by " + ", ".join("%s %s" % (short((s.get("AttributeRef") or {}).get("Attribute")),
                                                     "asc" if s.get("SortOrder") == "Ascending" else "desc") for s in sorts))
        res = self._result(a.get("ResultVariableName"), self.var_types.get(lst))
        return "%sLIST %s(%s)" % (res, name.upper(), ", ".join(args)), []

    def _a_AggregateAction(self, a):
        target = "$" + (a.get("AggregateVariableName") or "")
        if a.get("Attribute"):
            target += "/" + short(a["Attribute"])
        if a.get("UseExpression"):
            target += " expr " + clean(a.get("Expression"))
        return "$%s = %s(%s)" % (a.get("VariableName"), (a.get("AggregateFunction") or "").upper(), target), []

    def _call(self, word, target, mappings, result, use_result=True, queue=None):
        ret = self.ctx.flow_returns.get(target)
        line = "%sCALL %s %s(%s)" % (self._result(result, ret) if use_result and result else "", word, target, self._args(mappings))
        if queue and queue.get("Queue"):
            line += " [RUN IN TASK QUEUE %s]" % queue["Queue"]
            self.index.effect("TASK QUEUE SUBMISSIONS", "%s -> %s in queue %s" % (self.qn, target, queue["Queue"]))
        return line, []

    def _a_MicroflowCallAction(self, a):
        c = a.get("MicroflowCall") or {}
        return self._call("MICROFLOW", c.get("Microflow"), c.get("ParameterMappings"), a.get("ResultVariableName"),
                          a.get("UseReturnVariable", True), c.get("QueueSettings"))

    def _a_NanoflowCallAction(self, a):
        c = a.get("NanoflowCall") or {}
        return self._call("NANOFLOW", c.get("Nanoflow"), c.get("ParameterMappings"), a.get("OutputVariableName") or a.get("ResultVariableName"),
                          a.get("UseReturnVariable", True))

    def _a_JavaActionCallAction(self, a):
        return self._call("JAVA", a.get("JavaAction"), a.get("ParameterMappings"), a.get("ResultVariableName"),
                          a.get("UseReturnVariable", True), a.get("QueueSettings"))

    def _a_JavaScriptActionCallAction(self, a):
        return self._call("JAVASCRIPT", a.get("JavaScriptAction"), a.get("ParameterMappings"), a.get("OutputVariableName"),
                          a.get("UseReturnVariable", True))

    def _a_RestCallAction(self, a):
        http = a.get("HttpConfiguration") or {}
        url = template(http.get("CustomLocationTemplate")) if http.get("OverrideLocation") else clean(http.get("CustomLocation"))
        method = (http.get("HttpMethod") or "").upper()
        self.index.effect("REST CALLS (Call REST service action)", "%s -> %s %s" % (self.qn, method, url))
        sub = ["header %s: %s" % (h.get("Key"), clean(h.get("Value"))) for h in http.get("HttpHeaderEntries") or []]
        req = a.get("RequestHandling") or {}
        if req.get("MappingId"):
            sub.append("body: export mapping %s of $%s" % (req["MappingId"], req.get("MappingVariableName")))
        elif req:
            body = template(req.get("Template") or req.get("CustomBody") or {}) or compact(req, 200)
            if body:
                sub.append("body: " + body)
        res = a.get("ResultHandling") or {}
        imp = res.get("ImportMappingCall") or {}
        var = res.get("ResultVariableName")
        entity = (res.get("VariableType") or {}).get("Entity")
        line = "%sREST %s %s" % (self._result(var, entity) if var else "", method, url)
        if imp.get("ReturnValueMapping"):
            line += " -> import mapping %s" % imp["ReturnValueMapping"]
        if a.get("TimeOutExpression") and a.get("UseRequestTimeOut", True):
            line += " (timeout %ss)" % clean(a["TimeOutExpression"])
        return line, sub

    def _a_RestOperationCallAction(self, a):
        """'Send REST request' (Mendix 10 consumed REST service). Unknown fields are kept as key=value."""
        operation = a.get("Operation") or a.get("RestOperation") or ""
        out = a.get("OutputVariable") or {}
        var = (out.get("VariableName") if isinstance(out, dict) else None) or a.get("OutputVariableName")
        body = a.get("BodyVariable") or {}
        body_var = body.get("VariableName") if isinstance(body, dict) else None
        self.index.effect("REST REQUESTS (Send REST request action)", "%s -> %s" % (self.qn, operation or compact(a, 150)))
        line = "%sSEND REST REQUEST %s(%s)" % ("$%s = " % var if var else "", operation, self._args(a.get("ParameterMappings")))
        if body_var:
            line += " body=$" + body_var
        known = {"$ID", "$Type", "Operation", "RestOperation", "OutputVariable", "OutputVariableName", "BodyVariable",
                 "ParameterMappings", "ErrorHandlingType"}
        rest = compact({k: v for k, v in a.items() if k not in known}, 300)
        return line, ["details: " + rest] if rest else []

    def _a_ImportXmlAction(self, a):
        res = a.get("ResultHandling") or {}
        imp = res.get("ImportMappingCall") or {}
        entity = (res.get("VariableType") or {}).get("Entity")
        line = "%sIMPORT $%s WITH MAPPING %s" % (self._result(res.get("ResultVariableName"), entity) if res.get("ResultVariableName") else "",
                                                 a.get("XmlDocumentVariableName"), imp.get("ReturnValueMapping"))
        if imp.get("Commit") in COMMIT:
            line += COMMIT[imp["Commit"]]
        return line, []

    def _a_ExportXmlAction(self, a):
        res = a.get("ResultHandling") or {}
        out = a.get("OutputMethod") or {}
        target = out.get("OutputVariableName") or out.get("FileDocumentVariableName") or ""
        return "%sEXPORT $%s WITH MAPPING %s" % ("$%s = " % target if target else "", res.get("MappingVariableName"), res.get("MappingId")), []

    def _a_LogMessageAction(self, a):
        node = clean(a.get("Node"))
        return "LOG %s [%s] %s" % ((a.get("Level") or "").upper(), node, template(a.get("MessageTemplate"))), []

    def _a_ShowMessageAction(self, a):
        return "SHOW %s MESSAGE %s" % ((a.get("Type") or "").upper(), template(a.get("Template"))), []

    def _a_ShowFormAction(self, a):
        fs = a.get("FormSettings") or {}
        return "SHOW PAGE %s(%s)" % (fs.get("Form"), self._args(fs.get("ParameterMappings"))), []

    _a_ShowPageAction = _a_ShowFormAction

    def _a_CloseFormAction(self, a):
        return "CLOSE PAGE", []

    _a_ClosePageAction = _a_CloseFormAction

    def _a_ValidationFeedbackAction(self, a):
        member = short(a.get("Attribute")) or a.get("Association")
        return "VALIDATION FEEDBACK $%s/%s: %s" % (a.get("ValidationVariableName"), member, template(a.get("FeedbackTemplate"))), []

    def _a_DownloadFileAction(self, a):
        return "DOWNLOAD FILE $%s" % a.get("FileDocumentVariableName"), []

    def _a_CastAction(self, a):
        return "$%s = CAST (specialization from type split)" % a.get("VariableName"), []
