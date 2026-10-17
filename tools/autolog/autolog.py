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
    args = ap.parse_args()

    project = Project(args.app_dir)
    for qn in (args.java_action, args.js_action):
        if qn not in project.code_params:
            print("note: %s is not defined in this project" % qn)
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
