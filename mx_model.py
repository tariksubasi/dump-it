"""Project loading (MPR v1 + v2), global symbol tables and small text helpers."""
import glob
import os
import pathlib
import re
import sqlite3
import uuid

from mx_bson import decode

STRUCTURAL = {"Projects$Project", "Projects$ModuleImpl", "Projects$Folder"}
FLOW_TYPES = {"Microflows$Microflow", "Microflows$Nanoflow", "Microflows$Rule"}

KIND = {
    "Microflows$Microflow": "microflow",
    "Microflows$Nanoflow": "nanoflow",
    "Microflows$Rule": "rule",
    "Forms$Page": "page",
    "Forms$Snippet": "snippet",
    "Forms$Layout": "layout",
    "JavaActions$JavaAction": "java action",
    "JavaScriptActions$JavaScriptAction": "js action",
    "DomainModels$DomainModel": "domain model",
    "ScheduledEvents$ScheduledEvent": "scheduled event",
    "Rest$PublishedRestService": "published rest",
    "ImportMappings$ImportMapping": "import mapping",
    "ExportMappings$ExportMapping": "export mapping",
    "JsonStructures$JsonStructure": "json structure",
    "Enumerations$Enumeration": "enumeration",
    "Constants$Constant": "constant",
    "DataSets$DataSet": "dataset",
    "Navigation$NavigationDocument": "navigation",
    "Settings$ProjectSettings": "project settings",
}

NOISE = {
    "RelativeMiddlePoint", "Size", "Line", "Location", "Appearance", "StableId", "GUID", "TypePointer",
    "ImageData", "IconData", "IconDataDark", "ImageDataDark", "Image", "Width", "Height", "CanvasWidth",
    "CanvasHeight", "TabIndex", "OriginControlVector", "DestinationControlVector", "OriginConnectionIndex",
    "DestinationConnectionIndex", "ParentConnection", "ChildConnection", "NewSortIndex", "ExportLevel", "Class",
    "Style", "DesignProperties", "PhoneWeight", "TabletWeight", "Weight", "PreviewWidth", "FormattingInfo",
    "NativeAccessibilitySettings", "ScreenReaderLabel", "AriaRole", "DisabledDuringExecution", "BackgroundColor",
    "AutoGenerateCaption", "HasVariableNameBeenChanged", "MarkAsUsed", "Documentation", "ErrorHandlingType",
    "RefreshInClient", "ForceFullObjects", "Excluded",
}

_WS = re.compile(r"\s*\n\s*")
_SECRET = re.compile(r"password|secret|privatekey|apikey", re.I)
_QUOTED_NAME = re.compile(r"""['"]([A-Za-z_]\w*\.[A-Za-z_]\w*)['"]""")


def _skip(key):
    return key in NOISE or key.startswith("$") or bool(_SECRET.search(key))


def kind_of(unit_type):
    return KIND.get(unit_type) or unit_type.split("$", 1)[-1].lower()


def clean(value):
    return _WS.sub(" ", value.strip()) if isinstance(value, str) else ""


def short(qualified):
    return qualified.rsplit(".", 1)[-1] if qualified else ""


def translations(value):
    """Distinct non-empty translations of a Texts$Text, en_US first."""
    if not isinstance(value, dict):
        return []
    items = [i for i in value.get("Items") or [] if isinstance(i, dict)]
    items.sort(key=lambda i: i.get("LanguageCode") != "en_US")
    out = []
    for i in items:
        t = clean(i.get("Text"))
        if t and t not in out:
            out.append(t)
    return out


def text(value):
    """All languages of a Texts$Text joined with ' / ', so UI texts can be found in any language."""
    return " / ".join(translations(value))


def template(value):
    """StringTemplate / TextTemplate / ClientTemplate -> 'text' with {1}=expr."""
    if not isinstance(value, dict):
        return ""
    raw = value.get("Text", value.get("Template"))
    body = text(raw) if isinstance(raw, dict) else clean(raw)
    params = []
    for p in value.get("Parameters") or []:
        expr = clean(p.get("Expression"))
        if not expr and isinstance(p.get("AttributeRef"), dict):
            expr = short(p["AttributeRef"].get("Attribute"))
        params.append(expr)
    out = "'%s'" % body
    if params:
        out += " with " + ", ".join("{%d}=%s" % (i, p) for i, p in enumerate(params, 1))
    return out


def dtype(value):
    """Render DataTypes$*, CodeActions$* and DomainModels$*AttributeType as a short type string."""
    if not isinstance(value, dict):
        return ""
    name = value.get("$Type", "?").split("$", 1)[-1]
    if name == "BasicParameterType":
        return dtype(value.get("Type"))
    base = re.sub(r"(AttributeType|Type)$", "", name) or name
    if value.get("Entity"):
        if base in ("Object", "ConcreteEntity"):
            return value["Entity"]
        return "%s<%s>" % (base, value["Entity"])
    if value.get("Enumeration"):
        return "Enum<%s>" % value["Enumeration"]
    if isinstance(value.get("Parameter"), dict):
        return "%s<%s>" % (base, dtype(value["Parameter"]))
    if base == "String" and "Length" in value:
        return "String(%s)" % (value["Length"] or "unlimited")
    return base


def entity_ref(value):
    if not isinstance(value, dict):
        return ""
    if value.get("Entity"):
        return value["Entity"]
    steps = value.get("Steps") or []
    return "/".join("%s/%s" % (s.get("Association"), s.get("DestinationEntity")) for s in steps)


def attr_path(attr_ref):
    path = entity_ref(attr_ref.get("EntityRef"))
    name = short(attr_ref.get("Attribute"))
    return "%s/%s" % (path, name) if path else name


def compact(value, limit=500):
    """One-line key=value summary of an unknown model element (fallback renderer)."""
    parts = []

    def walk(v, key):
        if isinstance(v, dict):
            if v.get("$Type") == "Texts$Text":
                t = text(v)
                if t:
                    parts.append("%s='%s'" % (key, t))
                return
            for k, x in v.items():
                if not _skip(k):
                    walk(x, k)
        elif isinstance(v, list):
            for x in v:
                walk(x, key)
        elif isinstance(v, str):
            s = clean(v)
            if s:
                parts.append("%s=%s" % (key, s))
        elif v is True:
            parts.append(key)

    walk(value, "")
    out = "; ".join(parts)
    return out if len(out) <= limit else out[:limit] + "..."


def dump(value, indent=0, out=None):
    """Multi-line YAML-like dump of an unknown document (fallback renderer)."""
    out = [] if out is None else out
    pad = "  " * indent
    for k, v in value.items():
        if _skip(k) or v is None or v == "" or v == [] or v is False:
            continue
        if isinstance(v, bytes):
            continue
        if isinstance(v, dict):
            if v.get("$Type") == "Texts$Text":
                t = text(v)
                if t:
                    out.append("%s%s: %s" % (pad, k, t))
                continue
            sub = dump(v, indent + 1, [])
            head = v.get("$Type", "").split("$", 1)[-1]
            if sub or head:
                out.append("%s%s: %s" % (pad, k, head))
                out.extend(sub)
        elif isinstance(v, list):
            if all(isinstance(x, str) for x in v):
                out.append("%s%s: %s" % (pad, k, ", ".join(v)))
                continue
            for i, x in enumerate(v):
                if isinstance(x, dict):
                    out.append("%s%s[%d]: %s" % (pad, k, i, x.get("$Type", "").split("$", 1)[-1]))
                    dump(x, indent + 1, out)
        elif isinstance(v, str):
            s = clean(v)
            out.append("%s%s: %s" % (pad, k, s if len(s) <= 2000 else s[:2000] + "..."))
        elif isinstance(v, (int, float)) and v not in (0, -1):
            out.append("%s%s: %s" % (pad, k, v))
    return out


def harvest(value, known, found):
    """Collect every string value that equals a known qualified name, or quotes one ('Module.Name' in expressions)."""
    if isinstance(value, dict):
        for v in value.values():
            harvest(v, known, found)
    elif isinstance(value, list):
        for v in value:
            harvest(v, known, found)
    elif isinstance(value, str) and "." in value:
        if value in known:
            found.add(value)
        elif "'" in value or '"' in value:
            found.update(n for n in _QUOTED_NAME.findall(value) if n in known)


def quoted_names(source, known):
    return {n for n in _QUOTED_NAME.findall(source) if n in known}


def collect_texts(value, found):
    """Every translation of every Texts$Text in a document."""
    if isinstance(value, dict):
        if value.get("$Type") == "Texts$Text":
            found.update(t for t in translations(value) if len(t) > 1)
            return
        for v in value.values():
            collect_texts(v, found)
    elif isinstance(value, list):
        for v in value:
            collect_texts(v, found)


class Unit:
    __slots__ = ("id", "type", "name", "container", "excluded", "module", "folder", "qn")

    def __init__(self, uid, container):
        self.id, self.container = uid, container
        self.type = self.name = self.module = self.folder = self.qn = None
        self.excluded = False


class Module:
    __slots__ = ("name", "marketplace", "version")

    def __init__(self, name, marketplace, version):
        self.name, self.marketplace, self.version = name, marketplace, version


class Project:
    """Read-only access to a Mendix project. Supports MPR v1 (blobs in SQLite) and v2 (mprcontents/)."""

    def __init__(self, path):
        path = os.path.abspath(path)
        if os.path.isdir(path):
            found = sorted(glob.glob(os.path.join(path, "*.mpr")))
            if not found:
                raise SystemExit("No .mpr file found in %s" % path)
            path = found[0]
        self.mpr = path
        self.root = os.path.dirname(path)
        self.db = sqlite3.connect(pathlib.Path(path).as_uri() + "?mode=ro", uri=True)
        columns = {r[1] for r in self.db.execute("PRAGMA table_info(Unit)")}
        self.inline = "Contents" in columns
        meta = self.db.execute("SELECT _ProductVersion FROM _MetaData").fetchone()
        self.version = meta[0] if meta else "?"
        self.units = {}
        for uid, cid in self.db.execute("SELECT UnitID, ContainerID FROM Unit"):
            u = str(uuid.UUID(bytes_le=bytes(uid)))
            c = str(uuid.UUID(bytes_le=bytes(cid))) if cid else None
            self.units[u] = Unit(u, c if c != u else None)

    @property
    def format(self):
        return "MPR v1" if self.inline else "MPR v2"

    def load(self, uid):
        if self.inline:
            row = self.db.execute("SELECT Contents FROM Unit WHERE UnitID = ?", (uuid.UUID(uid).bytes_le,)).fetchone()
            data = row[0] if row else None
        else:
            with open(os.path.join(self.root, "mprcontents", uid[0:2], uid[2:4], uid + ".mxunit"), "rb") as f:
                data = f.read()
        return decode(bytes(data)) if data else {}


class Context:
    """Global symbol tables built in a first pass over all units."""

    def __init__(self, project, warnings):
        self.project = project
        self.modules = {}
        self.docs = {}
        self.entities = set()
        self.attributes = set()
        self.assoc = {}
        self.flow_returns = {}
        self.domain_models = {}
        returns = {}
        for u in project.units.values():
            try:
                doc = project.load(u.id)
            except Exception as e:  # noqa: BLE001 - one broken unit must not stop the export
                warnings.append("Cannot read unit %s: %r" % (u.id, e))
                continue
            u.type = doc.get("$Type", "?")
            u.name = doc.get("Name") or ""
            u.excluded = bool(doc.get("Excluded"))
            if u.type == "Projects$ModuleImpl":
                self.modules[u.id] = Module(u.name, bool(doc.get("FromAppStore")), doc.get("AppStoreVersion") or "")
            elif u.type == "DomainModels$DomainModel":
                self.domain_models[u.id] = doc
            elif u.type in FLOW_TYPES:
                rt = doc.get("MicroflowReturnType") or {}
                if rt.get("Entity"):
                    returns[u.id] = rt["Entity"]
        for u in project.units.values():
            self._place(u)
        for u in project.units.values():
            u.qn = self.qualify(u)
            if u.qn and u.id in returns:
                self.flow_returns[u.qn] = returns[u.id]
            if u.qn and u.type not in STRUCTURAL:
                self.docs[u.qn] = u
        for uid, dm in self.domain_models.items():
            self._index_domain_model(project.units[uid].module, dm)
        self.proxies = {(u.module.name.lower(), u.name[0].lower() + u.name[1:]): qn
                        for qn, u in self.docs.items() if u.type == "Microflows$Microflow" and u.name}

    def _place(self, unit):
        folders, cid, seen = [], unit.container, set()
        while cid and cid not in seen:
            seen.add(cid)
            parent = self.project.units.get(cid)
            if parent is None:
                break
            if parent.type == "Projects$ModuleImpl":
                unit.module = self.modules[parent.id]
                break
            if parent.type == "Projects$Folder":
                folders.append(parent.name)
            cid = parent.container
        unit.folder = "/".join(reversed(folders))

    def qualify(self, unit):
        if unit.module is None:
            return None
        if unit.type == "DomainModels$DomainModel":
            return unit.module.name + ".DomainModel"
        return "%s.%s" % (unit.module.name, unit.name) if unit.name else None

    def _index_domain_model(self, module, dm):
        if module is None:
            return
        by_id = {}
        for e in dm.get("Entities") or []:
            qn = "%s.%s" % (module.name, e.get("Name"))
            by_id[e.get("$ID")] = qn
            self.entities.add(qn)
            for a in e.get("Attributes") or []:
                self.attributes.add("%s.%s" % (qn, a.get("Name")))
        for a in dm.get("Associations") or []:
            self.assoc["%s.%s" % (module.name, a.get("Name"))] = (by_id.get(a.get("ParentPointer")), by_id.get(a.get("ChildPointer")))
        for a in dm.get("CrossAssociations") or []:
            self.assoc["%s.%s" % (module.name, a.get("Name"))] = (by_id.get(a.get("ParentPointer")), a.get("Child"))

    def assoc_target(self, association, start_entity):
        parent, child = self.assoc.get(association, (None, None))
        return parent if start_entity and start_entity == child else child


class Index:
    """Facts collected while rendering; written out as index/*.txt."""

    def __init__(self):
        self.refs = {}
        self.entity_ops = {}
        self.attr_writes = {}
        self.attr_ui = {}
        self.effects = {}
        self.entries = {}
        self.unknown = {}
        self.access = {}
        self.texts = {}

    def ref(self, source, targets):
        self.refs.setdefault(source, set()).update(t for t in targets if t != source)

    def entity(self, entity, op, source):
        if entity:
            self.entity_ops.setdefault(entity, {}).setdefault(op, set()).add(source)

    def attr_write(self, attribute, source):
        if attribute:
            self.attr_writes.setdefault(attribute, set()).add(source)

    def attr_shown(self, attribute, source):
        if attribute:
            self.attr_ui.setdefault(attribute, set()).add(source)

    def entry(self, section, line):
        self.entries.setdefault(section, []).append(line)

    def effect(self, section, line):
        self.effects.setdefault(section, set()).add(line)

    def grant(self, module_role, kind, line):
        self.access.setdefault(module_role, {}).setdefault(kind, set()).add(line)

    def ui_text(self, value, source):
        self.texts.setdefault(value, set()).add(source)

    def unknown_type(self, type_name):
        self.unknown[type_name] = self.unknown.get(type_name, 0) + 1
