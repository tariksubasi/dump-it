#!/usr/bin/env python3
"""
autolog - fills the parameters of LogActivity (Java) / JS_LogActivity (JavaScript) calls
in a Mendix 10 project (MPR v2: <app>.mpr + mprcontents/) straight from the model.

For every log call it finds the activity that runs just before it and writes:
  FlowName      'Module.MicroflowOrNanoflowName'
  ActivityName  caption of the previous activity (or a generated caption)
  VariableName  the variable that activity produced / changed ('' if void)
  VariableValue toString(...) / getKey(...) / $Var expression for primitives
  VariableObject $Var for objects
  VariableList   $Var for lists

Usage (close Studio Pro first, commit your work first):
  python autolog.py <app-dir>                       # dry run, prints what it would do
  python autolog.py <app-dir> --apply               # writes the model
  python autolog.py <app-dir> --java-action Logging.LogActivity --js-action Logging.JS_LogActivity

Journal mode (one FlushJournal call is all you add by hand):
  python autolog.py <app-dir> --insert [--deep] [--flow Mod.MF] [--apply]
  For every microflow with a FlushJournal call (plus the --flow ones; --deep: plus all they call) it puts
  StartJournal after the start event, a filled LogActivity after every activity, decision branch and loop
  (also on error-handler paths and at the start and end of each loop turn) and FlushJournal before every
  end/error event. Inserted activities are marked [autolog:auto]; each --insert run replaces them, and
  python autolog.py <app-dir> --remove [--apply] deletes them again.

Only calls whose ActivityName argument is empty ('' or 'empty') or whose activity
documentation contains [autolog] are touched. Touched calls get [autolog] in their
documentation, so a later run refreshes them after you move them. Remove the marker
to keep manual values.
"""
import argparse
import base64
import glob
import hashlib
import os
import re
import sqlite3
import sys
import uuid

try:
    import bson
except ImportError:
    sys.exit("autolog needs the 'bson' module: pip install pymongo")

MARKER = "[autolog]"
EMPTY_ARGS = ("", "empty")
P_FLOW, P_ACTIVITY, P_VARNAME, P_VALUE, P_OBJECT, P_LIST, P_NODE, P_LEVEL = (
    "FlowName", "ActivityName", "VariableName", "VariableValue",
    "VariableObject", "VariableList", "LogNodeName", "Level")


def short(t):
    return t.split("$", 1)[-1] if t else ""


def as_bytes(v):
    if isinstance(v, str):
        return bytes.fromhex(v)
    return bytes(v)


def items(lst):
    # BSON arrays in MPR start with an int "kind" marker; skip it.
    return [x for x in (lst or []) if isinstance(x, dict)]


def walk(o, fn):
    if isinstance(o, dict):
        fn(o)
        for v in o.values():
            walk(v, fn)
    elif isinstance(o, list):
        for v in o:
            walk(v, fn)


# ---------------------------------------------------------------- project model

class Project:
    def __init__(self, app_dir):
        mprs = glob.glob(os.path.join(app_dir, "*.mpr"))
        if len(mprs) != 1:
            sys.exit("expected exactly one .mpr in %s, found %d" % (app_dir, len(mprs)))
        self.mpr = mprs[0]
        self.units = {}            # uuid -> (path, doc)
        for path in glob.glob(os.path.join(app_dir, "mprcontents", "**", "*.mxunit"), recursive=True):
            uid = os.path.basename(path)[:-len(".mxunit")]
            with open(path, "rb") as fh:
                self.units[uid] = (path, bson.decode(fh.read()))
        if not self.units:
            sys.exit("no mprcontents/*.mxunit found: only MPR v2 (Mendix 10.18+) is supported")
        self._load_containers()
        self._index()

    def _load_containers(self):
        self.parent = {}
        db = sqlite3.connect("file:%s?mode=ro" % self.mpr, uri=True)
        for unit_id, container_id in db.execute("SELECT UnitID, ContainerID FROM Unit"):
            for conv in (lambda b: str(uuid.UUID(bytes_le=bytes(b))), lambda b: str(uuid.UUID(bytes=bytes(b)))):
                uid = conv(unit_id)
                if uid in self.units:
                    self.parent[uid] = conv(container_id) if container_id else None
                    break
        db.close()

    def module_of(self, uid):
        seen = 0
        while uid and seen < 64:
            path_doc = self.units.get(uid)
            if path_doc and path_doc[1]["$Type"] == "Projects$ModuleImpl":
                return path_doc[1]["Name"]
            uid = self.parent.get(uid)
            seen += 1
        return "?"

    def _index(self):
        self.flow_returns = {}     # 'Mod.Flow' -> kind
        self.code_returns = {}     # 'Mod.Action' -> kind
        self.code_params = {}      # 'Mod.Action' -> set of param names
        self.entities = {}         # entity $ID bytes -> 'Mod.Entity'
        self.associations = {}     # 'Mod.Assoc' -> (type, parent entity, child entity)
        domain_models = []
        for uid, (_, doc) in self.units.items():
            t = doc["$Type"]
            if t in ("Microflows$Microflow", "Microflows$Nanoflow"):
                self.flow_returns[self.module_of(uid) + "." + doc["Name"]] = kind_of_datatype(doc.get("MicroflowReturnType"))
            elif t in ("JavaActions$JavaAction", "JavaScriptActions$JavaScriptAction"):
                qn = self.module_of(uid) + "." + doc["Name"]
                self.code_returns[qn] = kind_of_codetype(doc.get("JavaReturnType"))
                self.code_params[qn] = {p["Name"] for p in items(doc.get("Parameters"))}
            elif t == "DomainModels$DomainModel":
                domain_models.append((self.module_of(uid), doc))
        self.generalization = {}   # 'Mod.Entity' -> 'Mod.Parent'
        for mod, doc in domain_models:
            for e in items(doc.get("Entities")):
                self.entities[as_bytes(e["$ID"])] = mod + "." + e["Name"]
                gen = e.get("MaybeGeneralization") or {}
                if gen.get("Generalization"):
                    self.generalization[mod + "." + e["Name"]] = gen["Generalization"]
        for mod, doc in domain_models:
            for a in items(doc.get("Associations")):
                self.associations[mod + "." + a["Name"]] = (
                    a.get("Type"), self.entities.get(as_bytes(a["ParentPointer"])), self.entities.get(as_bytes(a["ChildPointer"])))
            for a in items(doc.get("CrossAssociations")):
                self.associations[mod + "." + a["Name"]] = (
                    a.get("Type"), self.entities.get(as_bytes(a["ParentPointer"])), a.get("Child"))

    def is_a(self, entity, ancestor):
        seen = 0
        while entity and seen < 32:
            if entity == ancestor:
                return True
            entity = self.generalization.get(entity)
            seen += 1
        return False

    def save(self, uid, doc):
        path, _ = self.units[uid]
        data = bson.encode(doc)
        with open(path, "wb") as fh:
            fh.write(data)
        digest = base64.b64encode(hashlib.sha256(data).digest()).decode()
        db = sqlite3.connect(self.mpr)
        n = 0
        for key in (uuid.UUID(uid).bytes_le, uuid.UUID(uid).bytes):
            n += db.execute("UPDATE Unit SET ContentsHash = ? WHERE UnitID = ?", (digest, key)).rowcount
        db.commit()
        db.close()
        if n != 1:
            raise RuntimeError("could not update ContentsHash for unit %s" % uid)


# ---------------------------------------------------------------- types

# kind: (category, entity) with category in string|number|boolean|datetime|enum|object|list|void|unknown
def kind_of_datatype(dt):
    t = short((dt or {}).get("$Type"))
    return {
        "StringType": ("string", None), "IntegerType": ("number", None), "DecimalType": ("number", None),
        "LongType": ("number", None), "FloatType": ("number", None), "BooleanType": ("boolean", None),
        "DateTimeType": ("datetime", None), "EnumerationType": ("enum", None),
        "ObjectType": ("object", (dt or {}).get("Entity")), "ListType": ("list", (dt or {}).get("Entity")),
        "VoidType": ("void", None),
    }.get(t, ("unknown", None))


def kind_of_codetype(ct):
    t = short((ct or {}).get("$Type"))
    if t in ("ListType",):
        return ("list", None)
    if t in ("ConcreteEntityType", "ParameterizedEntityType", "EntityType"):
        return ("object", (ct or {}).get("Entity"))
    return kind_of_datatype({"$Type": "DataTypes$" + t})


def value_args(var, kind, is_nanoflow):
    """Expressions for (VariableValue, VariableObject, VariableList)."""
    cat = kind[0]
    v = "$" + var
    if cat == "string":
        return v, "empty", "empty"
    if cat == "boolean":
        return "toString(%s)" % v, "empty", "empty"
    if cat in ("number", "datetime"):
        return "if %s = empty then 'empty' else toString(%s)" % (v, v), "empty", "empty"
    if cat == "enum":
        return "if %s = empty then 'empty' else getKey(%s)" % (v, v), "empty", "empty"
    if cat == "object":
        return "empty", v, "empty"
    if cat == "list":
        return "empty", "empty", v
    return "'<type unknown>'", "empty", "empty"


# ---------------------------------------------------------------- flow analysis

CAPTION_VERBS = {
    "JavaActionCallAction": "Call Java action", "JavaScriptActionCallAction": "Call JavaScript action",
    "MicroflowCallAction": "Call microflow", "NanoflowCallAction": "Call nanoflow",
    "CreateChangeAction": "Create object", "ChangeAction": "Change object",
    "CreateVariableAction": "Create variable", "ChangeVariableAction": "Change variable",
    "AggregateAction": "Aggregate list", "ListOperationsAction": "List operation",
}


def humanize(type_name):
    if short(type_name) in CAPTION_VERBS:
        return CAPTION_VERBS[short(type_name)]
    words = re.sub(r"(?<!^)(?=[A-Z])", " ", short(type_name).replace("Action", "")).split()
    return " ".join(words).capitalize()


class Flow:
    def __init__(self, project, uid, doc):
        self.p = project
        self.doc = doc
        self.is_nanoflow = doc["$Type"] == "Microflows$Nanoflow"
        self.name = project.module_of(uid) + "." + doc["Name"]
        self.objects = {}          # $ID -> object
        self.loop_of = {}          # inner object $ID -> loop object
        self._collect(doc["ObjectCollection"], None)
        self.incoming = {}
        for f in items(doc.get("Flows")):
            if f["$Type"] == "Microflows$SequenceFlow":
                self.incoming.setdefault(as_bytes(f["DestinationPointer"]), []).append(f)
        self.vars = {}
        self._infer_vars()

    def _collect(self, coll, loop):
        for o in items(coll.get("Objects")):
            oid = as_bytes(o["$ID"])
            self.objects[oid] = o
            if loop is not None:
                self.loop_of[oid] = loop
            if o["$Type"] == "Microflows$LoopedActivity":
                self._collect(o["ObjectCollection"], o)

    def _infer_vars(self):
        for o in self.objects.values():
            t = short(o["$Type"])
            if t == "MicroflowParameter" or t == "MicroflowParameterObject":
                self.vars[o["Name"]] = kind_of_datatype(o.get("VariableType"))
        # Fixed-point passes: a declaration may depend on another one (retrieve over an
        # association needs the start variable's entity, a loop needs its list's entity).
        for _ in range(4):
            for o in self.objects.values():
                if o["$Type"] == "Microflows$LoopedActivity":
                    src = o.get("LoopSource") or {}
                    if src.get("VariableName"):
                        self.vars[src["VariableName"]] = ("object", self.entity_of(src.get("ListVariableName")))
                elif o["$Type"] == "Microflows$ActionActivity":
                    name, kind = self.produced(o["Action"])
                    if name and (kind[0] != "unknown" or name not in self.vars):
                        self.vars[name] = kind

    def entity_of(self, var):
        return self.vars.get(var, ("unknown", None))[1]

    def produced(self, a):
        """(variable name, kind) a new variable this action creates, else (None, None)."""
        t = short(a["$Type"])
        p = self.p
        if t == "RetrieveAction":
            src = a.get("RetrieveSource") or {}
            if short(src.get("$Type")) == "DatabaseRetrieveSource":
                single = (src.get("Range") or {}).get("SingleObject") is True
                return a["ResultVariableName"], ("object" if single else "list", src.get("Entity"))
            assoc = p.associations.get(src.get("AssociationId"))
            start = self.entity_of(src.get("StartVariableName"))
            if assoc:
                kind, parent, child = assoc
                if kind == "ReferenceSet":
                    return a["ResultVariableName"], ("list", child if p.is_a(start, parent) else parent)
                if start and p.is_a(start, parent):
                    return a["ResultVariableName"], ("object", child)
                if start and p.is_a(start, child):
                    return a["ResultVariableName"], ("list", parent)
            return a["ResultVariableName"], ("unknown", None)
        if t == "CreateChangeAction":
            return a["VariableName"], ("object", a.get("Entity"))
        if t == "CreateListAction":
            return a["VariableName"], ("list", a.get("Entity"))
        if t == "CreateVariableAction":
            return a["VariableName"], kind_of_datatype(a.get("VariableType"))
        if t == "CastAction":
            return a["VariableName"], ("object", None)
        if t == "AggregateAction":
            return a["VariableName"], ("number", None)
        if t == "ListOperationsAction":
            op_doc = a.get("NewOperation") or a.get("Operation") or {}
            op = short(op_doc.get("$Type"))
            entity = self.entity_of(op_doc.get("ListName") or op_doc.get("ListVariableName"))
            if op in ("Head", "Find", "FindByExpression"):
                return a["ResultVariableName"], ("object", entity)
            if op in ("Contains", "ListEquals", "Equals"):
                return a["ResultVariableName"], ("boolean", None)
            return a["ResultVariableName"], ("list", entity)
        if t == "MicroflowCallAction" and a.get("UseReturnVariable"):
            target = (a.get("MicroflowCall") or {}).get("Microflow")
            return a["ResultVariableName"], p.flow_returns.get(target, ("unknown", None))
        if t == "NanoflowCallAction" and a.get("UseReturnVariable"):
            target = (a.get("NanoflowCall") or {}).get("Nanoflow")
            return a["OutputVariableName"], p.flow_returns.get(target, ("unknown", None))
        if t == "JavaActionCallAction" and a.get("UseReturnVariable"):
            return a["ResultVariableName"], p.code_returns.get(a.get("JavaAction"), ("unknown", None))
        if t == "JavaScriptActionCallAction" and a.get("UseReturnVariable"):
            return a["OutputVariableName"], p.code_returns.get(a.get("JavaScriptAction"), ("unknown", None))
        for key in ("ResultVariableName", "OutputVariableName"):
            if a.get(key) and a.get("UseReturnVariable", True):
                return a[key], ("unknown", None)
        return None, None

    def touched(self, a):
        """Variable an action works on without creating it (commit, change, delete...)."""
        for key in ("ChangeVariableName", "CommitVariableName", "DeleteVariableName", "RollbackVariableName"):
            if a.get(key):
                return a[key]
        return None

    def caption_of(self, o):
        t = short(o["$Type"])
        if t == "ActionActivity":
            a = o["Action"]
            if not o.get("AutoGenerateCaption", True) and o.get("Caption"):
                return o["Caption"]
            target = (a.get("JavaAction") or a.get("JavaScriptAction")
                      or (a.get("MicroflowCall") or {}).get("Microflow")
                      or (a.get("NanoflowCall") or {}).get("Nanoflow")
                      or self.produced(a)[0] or self.touched(a) or "")
            return (humanize(a["$Type"]) + " " + target).strip()
        if t == "ExclusiveSplit" or t == "InheritanceSplit":
            return "Decision " + (o.get("Caption") or "")
        if t == "LoopedActivity":
            return "Loop over " + ((o.get("LoopSource") or {}).get("ListVariableName") or "")
        return humanize(o["$Type"])

    def describe_predecessor(self, log_obj):
        """(activity caption, variable name or None, kind)"""
        lid = as_bytes(log_obj["$ID"])
        inc = self.incoming.get(lid, [])
        if not inc:
            loop = self.loop_of.get(lid)
            if loop is not None:
                it = (loop.get("LoopSource") or {}).get("VariableName")
                return self.caption_of(loop) + " (iteration start)", it, self.vars.get(it, ("object", None))
            return "<no incoming flow>", None, None
        if len(inc) > 1:
            return "<multiple incoming flows>", None, None
        flow = inc[0]
        src = self.objects.get(as_bytes(flow["OriginPointer"]))
        if src is None:
            return "<unknown predecessor>", None, None
        caption = self.caption_of(src)
        if flow.get("IsErrorHandler"):
            if self.is_nanoflow:
                return "Error in " + caption, "latestError", ("string", None)
            return "Error in " + caption, "latestError/Message", ("string", None)
        t = short(src["$Type"])
        if t in ("ExclusiveSplit", "InheritanceSplit"):
            cases = [c.get("Value") for c in items(flow.get("CaseValues")) if c.get("Value") is not None]
            return caption + (" = " + cases[0] if cases else ""), None, None
        if t == "ExclusiveMerge":
            return "<after merge>", None, None
        if t == "StartEvent":
            return "<start>", None, None
        if t != "ActionActivity":
            return caption, None, None
        a = src["Action"]
        var, kind = self.produced(a)
        if not var:
            var = self.touched(a)
            kind = self.vars.get(var, ("unknown", None)) if var else None
        return caption, var, kind


# ---------------------------------------------------------------- rewrite

def new_id():
    return uuid.uuid4().bytes


def set_argument(action, qualified_action, param, expr, is_js):
    value_key = "ParameterValue" if is_js else "Value"
    map_type = "Microflows$JavaScriptActionParameterMapping" if is_js else "Microflows$JavaActionParameterMapping"
    qn = qualified_action + "." + param
    for m in items(action.get("ParameterMappings")):
        if m.get("Parameter") == qn:
            if m[value_key]["Argument"] == expr:
                return False
            m[value_key]["Argument"] = expr
            return True
    mappings = action.setdefault("ParameterMappings", [2])
    mappings.append({
        "$ID": new_id(), "$Type": map_type, "Parameter": qn,
        value_key: {"$ID": new_id(), "$Type": "Microflows$BasicCodeActionParameterValue", "Argument": expr},
    })
    return True


def get_argument(action, qualified_action, param, is_js):
    value_key = "ParameterValue" if is_js else "Value"
    for m in items(action.get("ParameterMappings")):
        if m.get("Parameter") == qualified_action + "." + param:
            return m[value_key]["Argument"]
    return ""


def quote(s):
    return "'" + (s or "").replace("'", "''") + "'"


def process(project, java_action, js_action, default_level_java, default_level_js, report_only):
    changed_units = {}
    report = []
    for uid, (path, doc) in sorted(project.units.items(), key=lambda kv: kv[1][0]):
        if doc["$Type"] not in ("Microflows$Microflow", "Microflows$Nanoflow"):
            continue
        flow = None
        for o in list(_all_objects(doc)):
            if o["$Type"] != "Microflows$ActionActivity":
                continue
            a = o["Action"]
            is_js = a["$Type"] == "Microflows$JavaScriptActionCallAction"
            target = a.get("JavaScriptAction") if is_js else a.get("JavaAction")
            if target not in (java_action, js_action) or not target:
                continue
            flow = flow or Flow(project, uid, doc)
            if report_only:
                caption, var, kind = flow.describe_predecessor(o)
                report.append((flow.name, caption, var, kind and kind[0], None))
                continue
            owned = MARKER in (o.get("Documentation") or "")
            if not owned and get_argument(a, target, P_ACTIVITY, is_js).strip() not in EMPTY_ARGS:
                continue
            caption, var, kind = flow.describe_predecessor(o)
            if var:
                value, obj, lst = value_args(var, kind, flow.is_nanoflow) if "/" not in var else ("$" + var, "empty", "empty")
            else:
                value, obj, lst = "empty", "empty", "empty"
            known = project.code_params.get(target, set())
            wanted = {P_FLOW: quote(flow.name), P_ACTIVITY: quote(caption), P_VARNAME: quote(var or ""),
                      P_VALUE: value, P_OBJECT: obj, P_LIST: lst}
            dirty = False
            for param, expr in wanted.items():
                if known and param not in known:
                    continue
                dirty |= set_argument(a, target, param, expr, is_js)
            for param, default in ((P_NODE, "empty"), (P_LEVEL, default_level_js if is_js else default_level_java)):
                if (not known or param in known) and get_argument(a, target, param, is_js).strip() == "":
                    dirty |= set_argument(a, target, param, default, is_js)
            if not owned:
                o["Documentation"] = ((o.get("Documentation") or "") + "\n" + MARKER).strip()
                dirty = True
            report.append((flow.name, caption, var, kind and kind[0], value if value != "empty" else (obj if obj != "empty" else lst)))
            if dirty:
                changed_units[uid] = doc
    return changed_units, report


def _all_objects(doc):
    out = []

    def rec(coll):
        for o in items(coll.get("Objects")):
            out.append(o)
            if o["$Type"] == "Microflows$LoopedActivity":
                rec(o["ObjectCollection"])
    rec(doc["ObjectCollection"])
    return out


# ---------------------------------------------------------------- insert / remove

AUTO = "[autolog:auto]"        # activities the tool inserted itself; --remove and every --insert run delete them
GAP = 30                       # free space between inserted activities
ACT_W, ACT_H = 120, 60
CONTROL = {0: "0;-30", 1: "30;0", 2: "0;30", 3: "-30;0"}   # connection index (top/right/bottom/left) -> curve vector
SKIP_MOVE = ("MicroflowParameter", "MicroflowParameterObject", "Annotation")


def pt(s):
    x, y = (s or "0;0").split(";")
    return [float(x), float(y)]


def fmt(p):
    return "%d;%d" % (round(p[0]), round(p[1]))


def call_target(o):
    if o["$Type"] != "Microflows$ActionActivity":
        return None
    a = o.get("Action") or {}
    return a.get("JavaAction") or a.get("JavaScriptAction")


class Layout:
    """Object positions per collection, and room-making that widens the loops around a collection."""

    def __init__(self, doc):
        self.doc = doc
        self.coll_of = {}          # object $ID -> collection
        self.up = {}               # id(collection) -> (loop, parent collection)
        self._index(doc["ObjectCollection"])

    def _index(self, coll):
        for o in items(coll.get("Objects")):
            self.coll_of[as_bytes(o["$ID"])] = coll
            if o["$Type"] == "Microflows$LoopedActivity":
                self.up[id(o["ObjectCollection"])] = (o, coll)
                self._index(o["ObjectCollection"])

    def add(self, coll, o):
        coll["Objects"].append(o)
        self.coll_of[as_bytes(o["$ID"])] = coll

    def make_room(self, coll, axis, at, delta, sign, skip=None):
        """Moves everything past 'at' on 'axis' (in direction 'sign') by delta; grows the enclosing loops."""
        if delta <= 0:
            return
        for o in items(coll.get("Objects")):
            if o is skip or short(o["$Type"]) in SKIP_MOVE:
                continue
            p = pt(o.get("RelativeMiddlePoint"))
            if (p[axis] - at) * sign > 0:
                p[axis] += delta * sign
                o["RelativeMiddlePoint"] = fmt(p)
        if id(coll) in self.up:
            loop, parent = self.up[id(coll)]
            center = pt(loop["RelativeMiddlePoint"])
            self.make_room(parent, axis, center[axis], delta, sign, skip=loop)
            size = pt(loop["Size"])
            size[axis] += delta
            center[axis] += delta / 2.0 * sign
            loop["Size"], loop["RelativeMiddlePoint"] = fmt(size), fmt(center)


def new_activity(action_qn, p):
    return {
        "$ID": new_id(), "$Type": "Microflows$ActionActivity",
        "Action": {"$ID": new_id(), "$Type": "Microflows$JavaActionCallAction", "ErrorHandlingType": "Rollback",
                   "JavaAction": action_qn, "ParameterMappings": [2], "QueueSettings": None,
                   "ResultVariableName": "", "UseReturnVariable": False},
        "AutoGenerateCaption": True, "BackgroundColor": "Default", "Caption": "Activity", "Disabled": False,
        "Documentation": AUTO, "RelativeMiddlePoint": fmt(p), "Size": "%d;%d" % (ACT_W, ACT_H),
    }


def new_flow(origin, dest, oi, di, cases=None, error=False):
    return {
        "$ID": new_id(), "$Type": "Microflows$SequenceFlow", "CaseValues": cases or [2],
        "DestinationConnectionIndex": di, "DestinationPointer": dest, "IsErrorHandler": error,
        "Line": {"$ID": new_id(), "$Type": "Microflows$BezierCurve",
                 "DestinationControlVector": CONTROL[di], "OriginControlVector": CONTROL[oi]},
        "OriginConnectionIndex": oi, "OriginPointer": origin,
    }


def set_dest(flow, dest, di):
    flow["DestinationPointer"], flow["DestinationConnectionIndex"] = dest, di
    if isinstance(flow.get("Line"), dict) and "DestinationControlVector" in flow["Line"]:
        flow["Line"]["DestinationControlVector"] = CONTROL[di]


def remove_auto(doc):
    """Deletes the activities an earlier --insert added and joins the flows around them. Returns (removed, kept)."""
    flows = doc.setdefault("Flows", [3])
    removed = kept = 0
    for coll in _collections(doc["ObjectCollection"]):
        for o in [x for x in items(coll.get("Objects")) if AUTO in (x.get("Documentation") or "")]:
            oid = as_bytes(o["$ID"])
            seq = [f for f in items(flows) if f["$Type"] == "Microflows$SequenceFlow"]
            inc = [f for f in seq if as_bytes(f["DestinationPointer"]) == oid]
            out = [f for f in seq if as_bytes(f["OriginPointer"]) == oid]
            if len(out) > 1 or len(inc) > 1 or not (inc or out):
                kept += 1          # someone wired it differently by hand: leave it
                continue
            if inc and out:
                set_dest(inc[0], out[0]["DestinationPointer"], out[0]["DestinationConnectionIndex"])
            gone = out[0] if out else inc[0]   # loop-start logs have no incoming flow, loop-end logs no outgoing one
            for f in [x for x in items(flows) if oid in (as_bytes(x.get("OriginPointer", b"")), as_bytes(x.get("DestinationPointer", b"")))
                      and (x is gone or x["$Type"] == "Microflows$AnnotationFlow")]:
                flows.remove(f)
            coll["Objects"].remove(o)
            removed += 1
    return removed, kept


def _collections(coll):
    out = [coll]
    for o in items(coll.get("Objects")):
        if o["$Type"] == "Microflows$LoopedActivity":
            out.extend(_collections(o["ObjectCollection"]))
    return out


def insert_steps(project, doc, names):
    """Puts StartJournal after the start event, LogActivity after every activity, decision branch and loop
    (also on error-handler paths and at the start of each loop turn), and FlushJournal before every end/error event.
    names: dict with keys log, start, flush (qualified Java action names)."""
    calls = {names["log"], names["start"], names["flush"]}
    flows = doc.setdefault("Flows", [3])
    lay = Layout(doc)
    objects = {}
    for coll in _collections(doc["ObjectCollection"]):
        for o in items(coll.get("Objects")):
            objects[as_bytes(o["$ID"])] = o
    seq = [f for f in items(flows) if f["$Type"] == "Microflows$SequenceFlow"]

    def wants_log(o):
        t = short(o["$Type"])
        if t == "ActionActivity":
            return not o.get("Disabled") and call_target(o) not in calls
        return t in ("ExclusiveSplit", "InheritanceSplit", "LoopedActivity")

    added = 0
    # 1. loop bodies: a log in front of the first object (start of every turn) and after the last activity,
    #    which has no outgoing flow
    targets = {as_bytes(f["DestinationPointer"]) for f in seq}
    origins = {as_bytes(f["OriginPointer"]) for f in seq}
    for coll in _collections(doc["ObjectCollection"])[1:]:
        loop = lay.up[id(coll)][0]
        firsts = [o for o in items(coll.get("Objects")) if short(o["$Type"]) not in SKIP_MOVE
                  and as_bytes(o["$ID"]) not in targets]
        if len(firsts) == 1 and call_target(firsts[0]) not in calls:
            first = firsts[0]
            fp, fs = pt(first["RelativeMiddlePoint"]), pt(first.get("Size"))
            lay.make_room(coll, 0, fp[0] - fs[0] / 2.0 - 1, ACT_W + 2 * GAP - (fp[0] - fs[0] / 2.0), 1)
            fp = pt(first["RelativeMiddlePoint"])
            log = new_activity(names["log"], (fp[0] - fs[0] / 2.0 - GAP - ACT_W / 2.0, fp[1]))
            lay.add(coll, log)
            flows.append(new_flow(log["$ID"], first["$ID"], 1, 3))
            added += 1
        for last in [o for o in items(coll.get("Objects")) if wants_log(o) and as_bytes(o["$ID"]) not in origins]:
            lp, ls = pt(last["RelativeMiddlePoint"]), pt(last.get("Size"))
            spot = lp[0] + ls[0] / 2.0 + GAP + ACT_W / 2.0
            lay.make_room(coll, 0, lp[0], spot + ACT_W / 2.0 + GAP - pt(loop["Size"])[0], 1)
            log = new_activity(names["log"], (spot, free_lane(coll, 0, [spot], lp[1], 1)))
            lay.add(coll, log)
            flows.append(new_flow(last["$ID"], log["$ID"], 1, 3))
            added += 1

    # 2. every sequence flow: open it and put the chain of new activities on it
    for f in seq:
        x, y = objects.get(as_bytes(f["OriginPointer"])), objects.get(as_bytes(f["DestinationPointer"]))
        if x is None or y is None:
            continue
        chain = []
        if short(x["$Type"]) == "StartEvent":
            chain.append(names["start"])
        if wants_log(x) and call_target(y) != names["log"]:
            chain.append(names["log"])
        if short(y["$Type"]) in ("EndEvent", "ErrorEvent") and call_target(x) != names["flush"]:
            chain.append(names["flush"])
        if not chain:
            continue
        coll = lay.coll_of[as_bytes(x["$ID"])]
        xp, yp = pt(x["RelativeMiddlePoint"]), pt(y["RelativeMiddlePoint"])
        axis = 0 if abs(yp[0] - xp[0]) >= abs(yp[1] - xp[1]) else 1
        sign = 1 if yp[axis] >= xp[axis] else -1
        half_x = pt(x.get("Size"))[axis] / 2.0
        half_y = pt(y.get("Size"))[axis] / 2.0
        step = (ACT_W if axis == 0 else ACT_H) + GAP
        need = half_x + GAP + len(chain) * step + half_y
        lay.make_room(coll, axis, xp[axis], need - abs(yp[axis] - xp[axis]), sign)
        yp = pt(y["RelativeMiddlePoint"])
        # branches (decision cases, error handlers) line up with where they go, plain flows with where they come from
        other = yp[1 - axis] if (short(x["$Type"]) in ("ExclusiveSplit", "InheritanceSplit") or f.get("IsErrorHandler")) else xp[1 - axis]
        out_i, in_i = ((1, 3) if sign > 0 else (3, 1)) if axis == 0 else ((2, 0) if sign > 0 else (0, 2))
        spots = [xp[axis] + sign * (half_x + GAP + step / 2.0 + i * step) for i in range(len(chain))]
        other = free_lane(coll, axis, spots, other, f.get("OriginConnectionIndex"))
        new = []
        for i, qn in enumerate(chain):
            p = [0, 0]
            p[axis] = spots[i]
            p[1 - axis] = other
            new.append(new_activity(qn, p))
            lay.add(coll, new[-1])
        old_dest, old_di = f["DestinationPointer"], f["DestinationConnectionIndex"]
        set_dest(f, new[0]["$ID"], in_i)
        for a, b in zip(new, new[1:]):
            flows.append(new_flow(a["$ID"], b["$ID"], out_i, in_i))
        flows.append(new_flow(new[-1]["$ID"], old_dest, out_i, old_di))
        added += len(new)
    return added


def free_lane(coll, axis, spots, other, origin_index):
    """A cross-axis position where activities at 'spots' overlap nothing: first 'other' itself, then lanes moving
    to the side the flow leaves its origin (below for a bottom exit, above for a top one), then the other side."""
    size = (ACT_W, ACT_H)
    lane = size[1 - axis] + GAP
    first = -1 if origin_index in (0, 3) else 1
    boxes = []
    for o in items(coll.get("Objects")):
        if short(o["$Type"]) in SKIP_MOVE:
            continue
        p, s = pt(o.get("RelativeMiddlePoint")), pt(o.get("Size"))
        boxes.append((p, s))

    def free(c):
        for at in spots:
            q = [0, 0]
            q[axis], q[1 - axis] = at, c
            for p, s in boxes:
                if abs(p[0] - q[0]) < (s[0] + ACT_W) / 2.0 + GAP / 2.0 and abs(p[1] - q[1]) < (s[1] + ACT_H) / 2.0 + GAP / 2.0:
                    return False
        return True
    for k in range(0, 7):
        for c in ((other,) if k == 0 else (other + first * k * lane, other - first * k * lane)):
            if free(c):
                return c
    return other


def fill_defaults(project, doc, qn, level):
    """Arguments for StartJournal / FlushJournal calls: Level gets the default, every other parameter 'empty'."""
    for o in _all_objects(doc):
        if call_target(o) == qn and AUTO in (o.get("Documentation") or ""):
            for param in sorted(project.code_params.get(qn, ())):
                if get_argument(o["Action"], qn, param, False).strip() == "":
                    set_argument(o["Action"], qn, param, level if param == P_LEVEL else "empty", False)


def journal_flows(project, names, wanted, deep):
    """Microflows to journal: those with a FlushJournal call, the ones named with --flow, and (deep) all they call."""
    by_name = {}
    for uid, (_, doc) in project.units.items():
        if doc["$Type"] == "Microflows$Microflow":
            by_name[project.module_of(uid) + "." + doc["Name"]] = uid
    picked = set(wanted)
    for qn, uid in by_name.items():
        if any(call_target(o) == names["flush"] and AUTO not in (o.get("Documentation") or "")
               for o in _all_objects(project.units[uid][1])):
            picked.add(qn)
    missing = sorted(q for q in picked if q not in by_name)
    todo = sorted(q for q in picked if q in by_name)
    while deep and todo:
        qn = todo.pop()
        for o in _all_objects(project.units[by_name[qn]][1]):
            a = o.get("Action") or {}
            callee = (a.get("MicroflowCall") or {}).get("Microflow") if a.get("$Type") == "Microflows$MicroflowCallAction" else None
            if callee in by_name and callee not in picked:
                picked.add(callee)
                todo.append(callee)
    return {q: by_name[q] for q in picked if q in by_name}, missing


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("app_dir")
    ap.add_argument("--java-action", default="Logging.LogActivity")
    ap.add_argument("--js-action", default="Logging.JS_LogActivity")
    ap.add_argument("--level", default="CommunityCommons.LogLevel.Info", help="Java Level argument when empty")
    ap.add_argument("--js-level", default="'Info'", help="JS Level argument when empty")
    ap.add_argument("--apply", action="store_true", help="write the model (default: dry run)")
    ap.add_argument("--report-only", action="store_true",
                    help="only print what would be resolved for every call of the given actions (any action, nothing is written)")
    ap.add_argument("--insert", action="store_true",
                    help="journal mode: put StartJournal, a LogActivity after every activity and FlushJournal before every end "
                         "into each microflow that has a FlushJournal call (and the --flow ones)")
    ap.add_argument("--remove", action="store_true", help="delete everything --insert added (only from --flow ones, if given)")
    ap.add_argument("--flow", action="append", default=[], metavar="Mod.Microflow", help="also journal this microflow (repeatable)")
    ap.add_argument("--deep", action="store_true", help="with --insert: also journal every microflow they call, all the way down")
    ap.add_argument("--start-action", default="Logging.StartJournal")
    ap.add_argument("--flush-action", default="Logging.FlushJournal")
    ap.add_argument("--insert-level", default="CommunityCommons.LogLevel.Debug", help="Level of the calls --insert adds")
    args = ap.parse_args()
    if args.insert and args.remove:
        sys.exit("use --insert or --remove, not both")

    project = Project(args.app_dir)
    for qn in (args.java_action, args.js_action):
        if qn not in project.code_params:
            print("note: %s is not defined in this project" % qn)

    changed = {}
    if args.insert or args.remove:
        names = {"log": args.java_action, "start": args.start_action, "flush": args.flush_action}
        if args.insert:
            absent = [qn for qn in names.values() if qn not in project.code_params]
            if absent:
                sys.exit("create these Java actions in Studio Pro first (see tools/autolog/README.md): " + ", ".join(absent))
            targets, missing = journal_flows(project, names, args.flow, args.deep)
            if missing:
                sys.exit("no such microflow: " + ", ".join(missing))
            if not targets:
                print("no microflow to journal: put a FlushJournal call before the end event of one, or pass --flow Mod.Microflow")
        else:
            targets = {}
            for uid, (_, doc) in project.units.items():
                if doc["$Type"] == "Microflows$Microflow" and any(AUTO in (o.get("Documentation") or "") for o in _all_objects(doc)):
                    targets[project.module_of(uid) + "." + doc["Name"]] = uid
            if args.flow:
                targets = {q: u for q, u in targets.items() if q in args.flow}
        for qn in sorted(targets):
            uid = targets[qn]
            doc = project.units[uid][1]
            removed, kept = remove_auto(doc)
            added = 0
            if args.insert:
                added = insert_steps(project, doc, names)
                fill_defaults(project, doc, args.start_action, args.insert_level)
                fill_defaults(project, doc, args.flush_action, args.insert_level)
                for o in _all_objects(doc):
                    if call_target(o) == args.java_action and AUTO in (o.get("Documentation") or ""):
                        set_argument(o["Action"], args.java_action, P_LEVEL, args.insert_level, False)
            if removed or added:
                changed[uid] = doc
            print("%-55s | %s%s" % (qn, ("+%d activities" % added) if args.insert else "", (" (-%d old)" % removed) if removed else "")
                  + (" | %d auto activities re-wired by hand, left as they are" % kept if kept else ""))
        print()
        if args.remove:
            report = []
        else:
            filled, report = process(project, args.java_action, args.js_action, args.level, args.js_level, False)
            changed.update(filled)
    else:
        changed, report = process(project, args.java_action, args.js_action, args.level, args.js_level, args.report_only)

    for flow, caption, var, kind, value in report:
        print("%-55s | %-45s | %-25s | %-8s | %s" % (flow, caption[:45], var or "<void>", kind or "-", value or ""))
    unknown = sum(1 for r in report if r[3] == "unknown")
    print("\n%d log call(s), %d unit(s) to change, %d with unknown variable type" % (len(report), len(changed), unknown))
    if args.report_only or not changed:
        return
    if not args.apply:
        print("dry run: nothing written. Close Studio Pro, commit, then re-run with --apply.")
        return
    for uid, doc in changed.items():
        project.save(uid, doc)
    print("written. Open the app in Studio Pro and check the Errors pane (F4 / consistency check).")


if __name__ == "__main__":
    main()
