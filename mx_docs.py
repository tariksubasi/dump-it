"""Renderers for non-flow documents: domain model, pages, code actions, integrations, project settings."""
import os
import re

from mx_model import attr_path, clean, compact, dtype, dump, entity_ref, field, quoted_names, short, template, text

# --------------------------------------------------------------------------- domain model

DEFAULT_DELETE = "DeleteMeButKeepReferences"


def render_domain_model(dm, module, index):
    qn_by_id, attr_by_id = {}, {}
    for e in dm.get("Entities") or []:
        qn = "%s.%s" % (module.name, e.get("Name"))
        qn_by_id[e.get("$ID")] = qn
        for a in e.get("Attributes") or []:
            attr_by_id[a.get("$ID")] = a.get("Name")
    source = module.name + ".DomainModel"
    out = ["DOMAIN MODEL %s" % module.name]
    if clean(dm.get("Documentation")):
        out.append("DOC: " + clean(dm["Documentation"]))
    for note in dm.get("Annotations") or []:
        out.append("NOTE: " + clean(note.get("Caption")))
    for e in dm.get("Entities") or []:
        out.append("")
        out.extend(_entity(e, qn_by_id[e.get("$ID")], attr_by_id, index, source))
    assocs = [(a, qn_by_id.get(a.get("ChildPointer"))) for a in dm.get("Associations") or []]
    assocs += [(a, a.get("Child")) for a in dm.get("CrossAssociations") or []]
    if assocs:
        out += ["", "ASSOCIATIONS (parent -> child; parent side stores the reference):"]
        for a, child in assocs:
            multiplicity = {("Reference", "Default"): "many-to-one", ("Reference", "Both"): "one-to-one",
                            ("ReferenceSet", "Default"): "many-to-many", ("ReferenceSet", "Both"): "many-to-many (both own)"}
            kind = multiplicity.get((a.get("Type"), a.get("Owner")), "%s/%s" % (a.get("Type"), a.get("Owner")))
            line = "  %s.%s: %s -> %s [%s]" % (module.name, a.get("Name"), qn_by_id.get(a.get("ParentPointer")), child, kind)
            db = a.get("DeleteBehavior") or {}
            rules = ["%s=%s" % (side, db.get(side + "DeleteBehavior")) for side in ("Parent", "Child")
                     if db.get(side + "DeleteBehavior") not in (None, DEFAULT_DELETE)]
            if rules:
                line += " on delete: " + ", ".join(rules)
            if clean(a.get("Documentation")):
                line += "  // " + clean(a["Documentation"])
            out.append(line)
    return "\n".join(out) + "\n"


def _entity(e, qn, attr_by_id, index, source):
    gen = e.get("MaybeGeneralization") or {}
    head = "ENTITY " + qn
    if gen.get("Generalization"):
        head += " extends " + gen["Generalization"]
    elif gen.get("Persistable") is False:
        head += " (non-persistable)"
    out = [head]
    system = [n for k, n in (("HasCreatedDateAttr", "createdDate"), ("HasChangedDateAttr", "changedDate"),
                             ("HasOwnerAttr", "owner"), ("HasChangedByAttr", "changedBy")) if gen.get(k)]
    if system:
        out.append("  system members: " + ", ".join(system))
    if clean(e.get("Documentation")):
        out.append("  DOC: " + clean(e["Documentation"]))
    for a in e.get("Attributes") or []:
        line = "  - %s: %s" % (a.get("Name"), dtype(a.get("NewType")))
        value = a.get("Value") or {}
        if value.get("Microflow"):
            line += " (calculated by %s)" % value["Microflow"]
            index.entry("CALCULATED ATTRIBUTES", "%s.%s -> %s" % (qn, a.get("Name"), value["Microflow"]))
        elif value.get("DefaultValue") not in (None, ""):
            line += " = " + clean(value["DefaultValue"])
        if clean(a.get("Documentation")):
            line += "  // " + clean(a["Documentation"])
        out.append(line)
    for r in e.get("ValidationRules") or []:
        rule = (r.get("RuleInfo") or {}).get("$Type", "").split("$", 1)[-1].replace("RuleInfo", "")
        out.append("  VALIDATION %s %s: %s" % (short(r.get("Attribute")), rule, text(r.get("Message"))))
    for ev in e.get("Events") or []:
        line = "  EVENT %s %s -> %s" % (ev.get("Moment"), ev.get("Type"), ev.get("Microflow"))
        if ev.get("RaiseErrorOnFalse"):
            line += " (false = abort)"
        out.append(line)
        index.entry("ENTITY EVENT HANDLERS", "%s %s %s -> %s" % (qn, ev.get("Moment"), ev.get("Type"), ev.get("Microflow")))
    for ix in e.get("Indexes") or []:
        cols = ", ".join(attr_by_id.get(c.get("AttributePointer"), "?") for c in ix.get("Attributes") or [])
        out.append("  INDEX (%s)" % cols)
    for rule in e.get("AccessRules") or []:
        out.extend(_access_rule(rule, qn, index))
    return out


def _access_rule(rule, entity, index):
    rights = []
    if rule.get("AllowCreate"):
        rights.append("create")
    if rule.get("AllowDelete"):
        rights.append("delete")
    default = rule.get("DefaultMemberAccessRights") or "None"
    xpath = clean(rule.get("XPathConstraint"))
    summary = " ".join(rights + ["default=" + default] + (["WHERE " + xpath] if xpath else []))
    for role in rule.get("AllowedModuleRoles") or []:
        index.grant(role, "entities", "%s: %s" % (entity, summary))
    out = ["  ACCESS [%s] %s" % (", ".join(rule.get("AllowedModuleRoles") or []), summary)]
    deviations = {}
    for m in rule.get("MemberAccesses") or []:
        if m.get("AccessRights") != default:
            member = short(m.get("Attribute")) or m.get("Association")
            deviations.setdefault(m.get("AccessRights"), []).append(member)
    for right, members in sorted(deviations.items()):
        out.append("    %s: %s" % (right, ", ".join(members)))
    return out


# --------------------------------------------------------------------------- pages

WIDGET_PREFIXES = ("Forms$", "CustomWidgets$CustomWidget")
NOT_WIDGETS = {"Forms$PageParameter", "Forms$SnippetParameter", "Forms$LocalVariable", "Forms$PageVariable"}
TRANSPARENT = {"LayoutGrid", "DivContainer", "ScrollContainer", "Table", "TableRow", "TableCell", "GroupBox",
               "LayoutGridRow", "LayoutGridColumn", "Placeholder", "TabControl", "Header", "Footer"}
CUSTOM = "CustomWidgets$CustomWidget"
PAGE_HEADINGS = {"Forms$Page": "PAGE", "Forms$Snippet": "SNIPPET", "Forms$Layout": "LAYOUT"}


def _is_widget(value):
    return (isinstance(value, dict) and "Name" in value and value.get("$Type", "").startswith(WIDGET_PREFIXES)
            and value["$Type"] not in NOT_WIDGETS)


def _event_label(key):
    if key in ("Action", "ClickAction", "OnClickAction"):
        return "on click"
    words = re.sub(r"([a-z])([A-Z])", r"\1 \2", key.replace("Action", "")).lower().strip()
    return words or "action"


def page_var(var):
    if not isinstance(var, dict):
        return ""
    for key, prefix in (("PageParameter", "$"), ("SnippetParameter", "$"), ("LocalVariable", "$"), ("Widget", "widget ")):
        if var.get(key):
            return prefix + var[key]
    return ""


class PageRenderer:
    def __init__(self, doc, qn, unit, index):
        self.doc, self.qn, self.unit, self.index = doc, qn, unit, index
        self.lines = []

    def render(self):
        d = self.doc
        out = ["%s %s" % (PAGE_HEADINGS.get(d["$Type"], d["$Type"]), self.qn)]
        if self.unit.excluded:
            out.append("EXCLUDED: yes (not part of the build)")
        if self.unit.folder:
            out.append("FOLDER: " + self.unit.folder)
        if text(d.get("Title")):
            out.append("TITLE: " + text(d["Title"]))
        layout = (d.get("FormCall") or {}).get("Form")
        if layout:
            out.append("LAYOUT: " + layout)
        if "AllowedModuleRoles" in d:
            out.append("ALLOWED ROLES: " + (", ".join(d["AllowedModuleRoles"]) or "(none)"))
        if d.get("Url"):
            out.append("URL: " + d["Url"])
        params = d.get("Parameters") or []
        if params:
            out.append("PARAMETERS:")
            for p in params:
                out.append("  $%s: %s" % (p.get("Name"), dtype(p.get("ParameterType"))))
        for v in d.get("Variables") or []:
            out.append("VARIABLE $%s: %s = %s" % (v.get("Name"), dtype(v.get("VariableType")), clean(v.get("DefaultValue"))))
        if clean(d.get("Documentation")):
            out.append("DOC: " + clean(d["Documentation"]))
        roots = []
        for k, v in d.items():
            if k not in ("Parameters", "Variables", "Title"):
                self._collect_widgets(v, roots)
        self._widgets(roots, 1)
        return "\n".join(out + ["", "WIDGETS:"] + (self.lines or ["  (none)"])) + "\n"

    def _collect_widgets(self, value, found):
        if isinstance(value, list):
            for v in value:
                self._collect_widgets(v, found)
        elif isinstance(value, dict):
            if _is_widget(value):
                found.append(value)
                return
            for v in value.values():
                self._collect_widgets(v, found)

    def _children(self, widget):
        found = []
        for k, v in widget.items():
            if not (widget["$Type"] == CUSTOM and k == "Type"):
                self._collect_widgets(v, found)
        return found

    def _widgets(self, widgets, indent):
        for w in widgets:
            kind = w["$Type"].split("$", 1)[-1]
            if w["$Type"] == CUSTOM:
                kind = (w.get("Type") or {}).get("WidgetName") or kind
            facts = self._facts(w)
            caption = self._caption(w)
            kids = self._children(w)
            if not facts and not caption and (kind in TRANSPARENT or not kids):
                self._widgets(kids, indent)
                continue
            line = "%s- %s %s" % ("  " * indent, kind, w.get("Name"))
            if caption:
                line += " \"%s\"" % caption
            self.lines.append(line + "".join(" | " + f for f in facts))
            self._widgets(kids, indent + 1)

    def _caption(self, w):
        for key in ("CaptionTemplate", "LabelTemplate", "Content"):
            value = w.get(key)
            if isinstance(value, dict):
                s = template(value)
                if s and s != "''":
                    return s.strip("'") if s.startswith("'") and " with " not in s else s
        return text(w.get("Caption"))

    def _facts(self, w):
        out = []
        if w["$Type"] == CUSTOM:
            keys = {}
            self._property_keys(w.get("Type"), keys)
            self._widget_object(w.get("Object"), keys, "", out)
            for k in ("ConditionalVisibilitySettings", "ConditionalEditabilitySettings"):
                self._scan(w.get(k), k, out)
            return out
        for k, v in w.items():
            if k not in ("CaptionTemplate", "LabelTemplate", "Caption", "Content"):
                self._scan(v, k, out)
        return out

    def _scan(self, value, key, out):
        if isinstance(value, list):
            for v in value:
                self._scan(v, key, out)
            return
        if not isinstance(value, dict) or _is_widget(value):
            return
        t = value.get("$Type", "")
        name = t.split("$", 1)[-1]
        if t == "DomainModels$AttributeRef":
            if value.get("Attribute"):
                out.append("attr " + attr_path(value))
                self.index.attr_shown(value["Attribute"], self.qn)
        elif name.endswith("Source") and t.startswith(("Forms$", "CustomWidgets$")):
            out.append("data: " + self._source(value))
        elif name in ("ConditionalVisibilitySettings", "ConditionalEditabilitySettings"):
            cond = self._condition(value)
            if cond:
                out.append(("visible if " if "Visibility" in name else "editable if ") + cond)
        elif name == "NoAction":
            return
        elif t.startswith("Forms$") and name.endswith("Action"):
            described = action_text(value)
            out.append("%s: %s" % (_event_label(key), described))
            if "Workflow" in name or "Task" in name:
                self.index.workflow_ops.add("%s <- %s (page)" % (described, self.qn))
        elif name == "SnippetCall":
            out.append("snippet " + (value.get("Form") or ""))
        elif name == "WidgetValidation":
            if clean(value.get("Expression")):
                out.append("validation " + clean(value["Expression"]))
        elif name not in ("Text", "ClientTemplate", "FormattingInfo"):
            for k, v in value.items():
                if not k.startswith("$"):
                    self._scan(v, k, out)

    def _property_keys(self, value, keys):
        if isinstance(value, dict):
            if value.get("$Type") == "CustomWidgets$WidgetPropertyType":
                keys[value.get("$ID")] = value.get("PropertyKey")
            for v in value.values():
                self._property_keys(v, keys)
        elif isinstance(value, list):
            for v in value:
                self._property_keys(v, keys)

    def _widget_object(self, obj, keys, prefix, out):
        for p in (obj or {}).get("Properties") or []:
            key = prefix + (keys.get(p.get("TypePointer")) or "?")
            v = p.get("Value") or {}
            act = v.get("Action") or {}
            if act and not act.get("$Type", "").endswith("NoAction"):
                out.append("%s: %s" % (key, action_text(act)))
            if isinstance(v.get("DataSource"), dict):
                out.append("%s: data %s" % (key, self._source(v["DataSource"])))
            ref = v.get("AttributeRef")
            if isinstance(ref, dict) and ref.get("Attribute"):
                out.append("%s: attr %s" % (key, attr_path(ref)))
                self.index.attr_shown(ref["Attribute"], self.qn)
            if clean(v.get("Expression")):
                out.append("%s: %s" % (key, clean(v["Expression"])))
            for k in ("Microflow", "Nanoflow", "Form"):
                if v.get(k):
                    out.append("%s: %s %s" % (key, k.lower(), v[k]))
            if clean(v.get("XPathConstraint")):
                out.append("%s: where %s" % (key, clean(v["XPathConstraint"])))
            if isinstance(v.get("TextTemplate"), dict):
                s = template(v["TextTemplate"])
                if s and s != "''":
                    out.append("%s: %s" % (key, s))
            for i, o in enumerate(v.get("Objects") or []):
                self._widget_object(o, keys, "%s[%d]." % (key, i), out)

    def _source(self, ds):
        name = ds.get("$Type", "").split("$", 1)[-1]
        settings = ds.get("MicroflowSettings") or ds.get("DataSourceMicroflowSettings")
        if isinstance(settings, dict):
            return "microflow %s(%s)" % (settings.get("Microflow"), params_text(settings.get("ParameterMappings")))
        if ds.get("Nanoflow"):
            return "nanoflow %s(%s)" % (ds["Nanoflow"], params_text(ds.get("ParameterMappings")))
        if name == "ListenTargetSource":
            return "selection of widget " + str(ds.get("ListenTarget"))
        entity = entity_ref(ds.get("EntityRef"))
        if entity and "/" not in entity:
            self.index.entity(entity, "page", self.qn)
        kind = {"AssociationSource": "association", "DataViewSource": "context"}.get(name, "database" if "XPath" in name else name)
        parts = [kind, page_var(ds.get("SourceVariable")), entity]
        xpath = clean(ds.get("XPathConstraint"))
        if xpath:
            parts.append("WHERE " + xpath)
        return " ".join(p for p in parts if p)

    def _condition(self, c):
        parts = []
        if clean(c.get("Expression")):
            parts.append(clean(c["Expression"]))
        if c.get("Attribute"):
            values = [x.get("AttributeValue") for x in c.get("Conditions") or [] if x.get("EditableVisible")]
            parts.append("%s in [%s]" % (short(c["Attribute"]), ", ".join(values)))
        if c.get("ModuleRoles"):
            parts.append("user has role " + " or ".join(c["ModuleRoles"]))
        return " and ".join(parts)


def params_text(mappings):
    out = []
    for m in mappings or []:
        value = clean(m.get("Expression") or m.get("Argument")) or page_var(m.get("Variable"))
        out.append("%s=%s" % (short(m.get("Parameter")), value))
    return ", ".join(out)


def action_text(a):
    name = a.get("$Type", "").split("$", 1)[-1]
    if name == "MicroflowAction":
        s = a.get("MicroflowSettings") or {}
        line = "microflow %s(%s)" % (s.get("Microflow"), params_text(s.get("ParameterMappings")))
        return line + (" (asks confirmation)" if s.get("ConfirmationInfo") else "")
    if name == "CallNanoflowClientAction":
        return "nanoflow %s(%s)" % (a.get("Nanoflow"), params_text(a.get("ParameterMappings")))
    if name == "FormAction":
        fs = a.get("FormSettings") or {}
        return "open page %s(%s)" % (fs.get("Form"), params_text(fs.get("ParameterMappings")))
    if name == "CreateObjectClientAction":
        page = (a.get("PageSettings") or a.get("FormSettings") or {}).get("Form")
        return "create %s, open page %s" % (entity_ref(a.get("EntityRef")) or a.get("Entity"), page)
    simple = {"SaveChangesClientAction": "save changes", "CancelChangesClientAction": "cancel changes",
              "DeleteClientAction": "delete object", "ClosePageClientAction": "close page",
              "SignOutClientAction": "sign out"}
    if name in simple:
        return simple[name] + (" and close page" if a.get("ClosePage") else "")
    if name == "OpenLinkClientAction":
        addr = a.get("Address") or {}
        return "open link " + (addr.get("Value") or attr_path(addr.get("AttributeRef") or {}))
    close = " and close page" if field(a, "ClosePage") else ""
    if name == "SetTaskOutcomeClientAction":
        return "complete user task with outcome '%s'%s" % (field(a, "OutcomeValue") or short(str(field(a, "Outcome") or "?")), close)
    if name == "CallWorkflowClientAction":
        return "start workflow %s%s" % (field(a, "Workflow"), close)
    if name == "OpenUserTaskClientAction":
        return "open user task" + (" (assign on open)" if field(a, "AssignOnOpen") else "")
    if name == "OpenWorkflowClientAction":
        return "open workflow" + (" (default page %s)" % field(a, "DefaultPage") if field(a, "DefaultPage") else "")
    return "%s %s" % (name, compact(a, 200))


# --------------------------------------------------------------------------- code actions

_PROXY_CALL = re.compile(r"(?:\b(\w+)\.proxies\.microflows\.)?\bMicroflows\.(\w+)\s*\(")
_PROXY_IMPORT = re.compile(r"import\s+(\w+)\.proxies\.microflows\.Microflows\s*;")


def read_source(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def code_refs(source, ctx):
    """Documents called from Java/JS: "Module.Name" literals (Core.microflowCall, mx.data.action) and generated proxies."""
    found = quoted_names(source, ctx.docs)
    imported = _PROXY_IMPORT.findall(source)
    for package, method in _PROXY_CALL.findall(source):
        for p in [package] if package else imported:
            qn = ctx.proxies.get((p, method))
            if not qn and method.endswith("Builder"):
                qn = ctx.proxies.get((p, method[:-len("Builder")]))
            if qn:
                found.add(qn)
    return found


def _sections(source, markers):
    out = {}
    for label, begin, end in markers:
        i, j = source.find(begin), source.find(end)
        if 0 <= i < j:
            body = source[i + len(begin):j].strip("\r\n")
            if body.strip():
                out[label] = body
    out["IMPORTS"] = "\n".join(line for line in source.splitlines() if line.startswith("import "))
    return out


def code_action_signature(doc):
    params = ["%s: %s" % (p.get("Name"), dtype(p.get("ParameterType"))) for p in doc.get("Parameters") or []]
    ret = dtype(doc.get("JavaReturnType") or doc.get("ReturnType"))
    return "(%s)%s" % (", ".join(params), " -> " + ret if ret and ret != "Void" else "")


def render_code_action(doc, qn, unit, project_root, module, ctx, index):
    is_java = doc["$Type"] == "JavaActions$JavaAction"
    folder = "javasource" if is_java else "javascriptsource"
    rel = "%s/%s/actions/%s.%s" % (folder, module.name.lower(), doc.get("Name"), "java" if is_java else "js")
    out = ["%s %s" % ("JAVA ACTION" if is_java else "JAVASCRIPT ACTION", qn)]
    if unit.folder:
        out.append("FOLDER: " + unit.folder)
    if doc.get("Platform"):
        out.append("PLATFORM: " + doc["Platform"])
    if clean(doc.get("Documentation")):
        out.append("DOC: " + clean(doc["Documentation"]))
    info = doc.get("MicroflowActionInfo") or {}
    if info.get("Caption"):
        out.append("TOOLBOX: %s / %s" % (info.get("Category"), info.get("Caption")))
    type_params = {t.get("$ID"): t.get("Name") for t in doc.get("TypeParameters") or []}
    params = doc.get("Parameters") or []
    if params:
        out.append("PARAMETERS:")
        for p in params:
            t = dtype(p.get("ParameterType"))
            pointer = _find_key(p.get("ParameterType"), "TypeParameterPointer")
            if pointer in type_params:
                t = "%s (type parameter %s)" % (t, type_params[pointer])
            line = "  %s: %s%s" % (p.get("Name"), t, "" if p.get("IsRequired", True) else " (optional)")
            if clean(p.get("Description")):
                line += "  // " + clean(p["Description"])
            out.append(line)
    ret = dtype(doc.get("JavaReturnType") or doc.get("ReturnType"))
    if ret and ret != "Void":
        out.append("RETURNS: " + ret)
    out.append("SOURCE: " + rel)
    markers = [("USER CODE", "// BEGIN USER CODE", "// END USER CODE"),
               ("EXTRA CODE", "// BEGIN EXTRA CODE", "// END EXTRA CODE")]
    source = read_source(os.path.join(project_root, *rel.split("/")))
    if source is None:
        out.append("(source file not found)")
    else:
        calls = sorted(code_refs(source, ctx) - {qn})
        if calls:
            index.ref(qn, calls)
            out.append("CALLS FROM CODE: " + ", ".join(calls))
        sections = _sections(source, markers)
        for label in ("IMPORTS", "USER CODE", "EXTRA CODE"):
            if sections.get(label):
                out += ["", "--- %s ---" % label, sections[label]]
    return "\n".join(out) + "\n"


def _find_key(value, key):
    if isinstance(value, dict):
        if value.get(key):
            return value[key]
        for v in value.values():
            found = _find_key(v, key)
            if found:
                return found
    return None


# --------------------------------------------------------------------------- integrations

def render_published_rest(doc, qn, index):
    base = "/" + (doc.get("Path") or "").strip("/")
    out = ["PUBLISHED REST SERVICE %s" % qn, "PATH: %s  VERSION: %s" % (base, doc.get("Version"))]
    out.append("ALLOWED ROLES: " + ", ".join(doc.get("AllowedRoles") or []))
    for role in doc.get("AllowedRoles") or []:
        index.grant(role, "published rest services", "%s (%s)" % (qn, base))
    auth = doc.get("AuthenticationTypes") or []
    out.append("AUTHENTICATION: " + (", ".join(str(a) for a in auth) or "none"))
    if doc.get("AuthenticationMicroflow"):
        out.append("AUTH MICROFLOW: " + doc["AuthenticationMicroflow"])
    if clean(doc.get("Documentation")):
        out.append("DOC: " + clean(doc["Documentation"]))
    for res in doc.get("Resources") or []:
        out += ["", "RESOURCE %s" % res.get("Name")]
        for op in res.get("Operations") or []:
            path = "/".join(p for p in (base, res.get("Name"), (op.get("Path") or "").strip("/")) if p)
            line = "  %s /%s -> %s" % ((op.get("HttpMethod") or "").upper(), path.strip("/"), op.get("Microflow"))
            index.entry("PUBLISHED REST OPERATIONS", line.strip())
            for k in ("ImportMapping", "ExportMapping"):
                if op.get(k):
                    line += " %s=%s" % (k, op[k])
            if op.get("Deprecated"):
                line += " (deprecated)"
            out.append(line)
            for p in op.get("Parameters") or []:
                out.append("      param %s (%s): %s" % (p.get("Name"), p.get("ParameterType"), dtype(p.get("Type"))))
            if clean(op.get("Summary") or op.get("Documentation")):
                out.append("      // " + clean(op.get("Summary") or op.get("Documentation")))
    return "\n".join(out) + "\n"


def render_mapping(doc, qn):
    is_import = doc["$Type"].startswith("ImportMappings")
    out = ["%s %s" % ("IMPORT MAPPING" if is_import else "EXPORT MAPPING", qn)]
    for k in ("JsonStructure", "MessageDefinition", "XmlSchema"):
        if doc.get(k):
            out.append("%s: %s" % (k.upper(), doc[k]))
    if doc.get("ParameterType") and dtype(doc["ParameterType"]) not in ("Unknown", ""):
        out.append("PARAMETER: " + dtype(doc["ParameterType"]))
    if clean(doc.get("Documentation")):
        out.append("DOC: " + clean(doc["Documentation"]))
    out.append("ELEMENTS (json path -> model):")

    def walk(elements, indent):
        for e in elements or []:
            path = (e.get("JsonPath") or e.get("XmlPath") or "").split("|")[-1] or e.get("ExposedName")
            if e.get("Entity") or e.get("$Type", "").endswith("ObjectMappingElement"):
                line = "%s%s -> %s" % ("  " * indent, path, e.get("Entity") or "(no entity)")
                if e.get("Association"):
                    line += " via " + e["Association"]
                line += " [%s]" % e.get("ObjectHandling")
                handler = (e.get("CustomHandlerCall") or {}).get("Microflow")
                if handler:
                    line += " handler " + handler
            else:
                line = "%s%s -> %s: %s" % ("  " * indent, path, short(e.get("Attribute")) or "(none)", dtype(e.get("Type")))
                if e.get("IsKey"):
                    line += " [key]"
            out.append(line)
            walk(e.get("Children"), indent + 1)

    walk(doc.get("Elements"), 1)
    return "\n".join(out) + "\n"


def render_json_structure(doc, qn):
    snippet = doc.get("JsonSnippet") or ""
    if len(snippet) > 6000:
        snippet = snippet[:6000] + "\n... (truncated)"
    return "JSON STRUCTURE %s\n\n%s\n" % (qn, snippet)


def render_dataset(doc, qn, index):
    out = ["DATASET %s" % qn]
    for p in doc.get("Parameters") or []:
        out.append("PARAMETER %s: %s" % (p.get("Name"), dtype(p.get("ParameterType"))))
    roles = [r.get("ModuleRole") for r in (doc.get("DataSetAccess") or {}).get("ModuleRoleAccessList") or []]
    if roles:
        out.append("ALLOWED ROLES: " + ", ".join(roles))
    for role in roles:
        index.grant(role, "datasets", qn)
    src = doc.get("Source") or {}
    if src.get("Query"):
        out += ["", "OQL:", src["Query"].strip()]
    elif src:
        out += dump(src)
    return "\n".join(out) + "\n"


def _value(v):
    if isinstance(v, dict):
        return template(v) if ("Text" in v or "Template" in v) else compact(v, 200)
    return clean(v) if isinstance(v, str) else ""


def render_consumed_rest(doc, qn, index):
    """Mendix 10 Consumed REST Service: best-effort summary followed by the full raw dump."""
    base = _value(doc.get("BaseUrl") or doc.get("BaseUrlTemplate") or doc.get("Location"))
    out = ["CONSUMED REST SERVICE %s" % qn, "BASE URL: " + (base or "?")]
    if clean(doc.get("Documentation")):
        out.append("DOC: " + clean(doc["Documentation"]))
    index.effect("CONSUMED REST SERVICES", "%s base %s" % (qn, base or "?"))
    for op in doc.get("Operations") or []:
        m = op.get("Method")
        method = op.get("HttpMethod") or (m.get("HttpMethod") if isinstance(m, dict) else m)
        path = _value(op.get("Path") or op.get("PathTemplate"))
        out.append("  OPERATION %s: %s %s" % (op.get("Name"), str(method or "?").upper(), path))
        index.effect("CONSUMED REST SERVICES", "%s.%s %s %s%s" % (qn, op.get("Name"), str(method or "?").upper(), base, path))
    return "\n".join(out + ["", "RAW MODEL (for fields not summarised above):"] + dump(doc, 1)) + "\n"


def render_generic(doc, qn):
    return "\n".join(["%s %s" % (doc.get("$Type", "?").split("$", 1)[-1].upper(), qn)] + dump(doc)) + "\n"


# --------------------------------------------------------------------------- module-level one-liners

def enumeration_line(doc, qn):
    values = []
    for v in doc.get("Values") or []:
        caption = text(v.get("Caption"))
        values.append(v.get("Name") + (" \"%s\"" % caption if caption and caption != v.get("Name") else ""))
    return "%s: %s" % (qn, ", ".join(values))


def constant_line(doc, qn, show_values):
    value = clean(doc.get("DefaultValue")) if show_values else "***"
    line = "%s: %s = %s" % (qn, dtype(doc.get("Type")), value)
    return line + (" (exposed to client)" if doc.get("ExposedToClient") else "")


def scheduled_event_line(doc, qn, index):
    schedule = doc.get("Schedule")
    if isinstance(schedule, dict):
        fields = ", ".join("%s=%s" % (k, v) for k, v in schedule.items()
                           if not k.startswith("$") and isinstance(v, (str, int, float)) and v not in ("", None))
        when = "%s schedule %s" % (schedule.get("$Type", "").split("$", 1)[-1].replace("Schedule", "").lower(), fields)
    else:
        when = "every %s %s" % (doc.get("Interval"), doc.get("IntervalType"))
    line = "%s -> %s (%s, %s)" % (qn, doc.get("Microflow"), when, "enabled" if doc.get("Enabled") else "DISABLED")
    index.entry("SCHEDULED EVENTS", line)
    return line


def queue_line(doc, qn):
    return "%s: %s" % (qn, compact(doc.get("Config"), 120))


# --------------------------------------------------------------------------- project level (overview.txt)

def security_lines(doc):
    """User roles and security level only. Passwords, admin user and demo users are never exported."""
    out = ["SECURITY: level=%s, guest access=%s%s" % (doc.get("SecurityLevel"), "on" if doc.get("EnableGuestAccess") else "off",
                                                      " (guest role %s)" % doc.get("GuestUserRole") if doc.get("EnableGuestAccess") else "")]
    out.append("USER ROLES -> MODULE ROLES:")
    for r in doc.get("UserRoles") or []:
        line = "  %s -> %s" % (r.get("Name"), ", ".join(r.get("ModuleRoles") or []))
        if clean(r.get("Description")):
            line += "  // " + clean(r["Description"])
        out.append(line)
    return out


def navigation_lines(doc, index):
    out = ["NAVIGATION:"]
    for profile in doc.get("Profiles") or []:
        out.append("  PROFILE %s (%s)" % (profile.get("Name"), profile.get("Kind")))
        home = profile.get("HomePage") or {}
        target = home.get("Page") or home.get("Microflow")
        if target:
            out.append("    default home: " + target)
            index.entry("HOME PAGES", "%s default -> %s" % (profile.get("Name"), target))
        for item in profile.get("HomeItems") or []:
            target = item.get("Page") or item.get("Microflow")
            out.append("    home for role %s: %s" % (item.get("UserRole"), target))
            index.entry("HOME PAGES", "%s role %s -> %s" % (profile.get("Name"), item.get("UserRole"), target))
        login = (profile.get("LoginPageSettings") or {}).get("Form")
        if login:
            out.append("    login page: " + login)
        _menu((profile.get("Menu") or {}).get("Items"), 2, out)
    return out


def _menu(items, indent, out):
    for item in items or []:
        act = item.get("Action") or {}
        target = "" if act.get("$Type", "").endswith("NoAction") else " -> " + action_text(act)
        out.append("%smenu \"%s\"%s" % ("  " * indent, text(item.get("Caption")), target))
        _menu(item.get("Items"), indent + 1, out)


def settings_lines(doc, index):
    out = []
    for part in doc.get("Settings") or []:
        if part.get("$Type") == "Settings$WorkflowsProjectSettingsPart":
            out.append("WORKFLOW SETTINGS: user entity=%s, task parallelism=%s, engine parallelism=%s" % (
                field(part, "UserEntity"), field(part, "DefaultTaskParallelism"), field(part, "WorkflowEngineParallelism")))
            for label, key in (("workflow state change", "WorkflowOnStateChangeEvent"), ("user task state change", "UsertaskOnStateChangeEvent")):
                mf = field(field(part, key), "Microflow")
                if mf:
                    out.append("  %s -> %s" % (label, mf))
                    index.entry("WORKFLOW EVENT HANDLERS (project)", "%s -> %s" % (label, mf))
            for handler in field(part, "OnWorkflowEvent") or []:
                mf = field(field(handler, "MicroflowEventHandler"), "Microflow") or field(handler, "Microflow")
                out.append("  on %s -> %s" % (", ".join(str(t) for t in field(handler, "EventTypes") or []) or "workflow event", mf))
                index.entry("WORKFLOW EVENT HANDLERS (project)", "on workflow event -> %s" % mf)
            continue
        if part.get("$Type") != "Settings$ModelSettings":
            continue
        for key, label in (("AfterStartupMicroflow", "AFTER STARTUP"), ("BeforeShutdownMicroflow", "BEFORE SHUTDOWN"),
                           ("HealthCheckMicroflow", "HEALTH CHECK")):
            if part.get(key):
                out.append("%s MICROFLOW: %s" % (label, part[key]))
                index.entry("APP LIFECYCLE", "%s -> %s" % (label, part[key]))
        out.append("TIME ZONE: default=%s, scheduled events=%s" % (part.get("DefaultTimeZoneCode"), part.get("ScheduledEventTimeZoneCode")))
    return out
