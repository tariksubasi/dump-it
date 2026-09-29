"""mxcontext - export a Mendix project's model to plain-text files an LLM coding agent can navigate.

Usage:
    python mxcontext.py <project dir or .mpr> [-o OUT_DIR] [--include-marketplace] [--show-constant-values]

Stdlib only (Python 3.8+). Works offline, read-only, on MPR v1 and v2 projects (Mendix 9/10/11).
The output folder is regenerated on every run; open your agent (OpenCode / Claude Code) inside it.
"""
import argparse
import json
import os
import shutil
import sys
import time

from mx_docs import (PageRenderer, code_action_signature, code_refs, constant_line, enumeration_line, navigation_lines,
                     queue_line, read_source, render_code_action, render_consumed_rest, render_dataset,
                     render_domain_model, render_generic, render_json_structure, render_mapping, render_published_rest,
                     scheduled_event_line, security_lines, settings_lines)
from mx_flows import FlowRenderer, flow_signature
from mx_model import FLOW_TYPES, STRUCTURAL, Context, Index, Project, clean, collect_texts, harvest, kind_of

MARKER = ".mxcontext"
FOLDERS = {
    "Microflows$Microflow": "microflows",
    "Microflows$Nanoflow": "nanoflows",
    "Microflows$Rule": "rules",
    "Forms$Page": "pages",
    "Forms$Snippet": "pages",
    "Forms$Layout": "pages",
    "JavaActions$JavaAction": "java-actions",
    "JavaScriptActions$JavaScriptAction": "js-actions",
    "Rest$PublishedRestService": "integrations",
    "ImportMappings$ImportMapping": "integrations",
    "ExportMappings$ExportMapping": "integrations",
    "JsonStructures$JsonStructure": "integrations",
    "DataSets$DataSet": "integrations",
    "Rest$ConsumedRestService": "integrations",
}
CODE_ACTIONS = {"JavaActions$JavaAction", "JavaScriptActions$JavaScriptAction"}
UNUSED_CANDIDATES = FLOW_TYPES | CODE_ACTIONS | {"Forms$Page", "Forms$Snippet", "Forms$Layout", "ImportMappings$ImportMapping",
                                                 "ExportMappings$ExportMapping", "JsonStructures$JsonStructure", "DataSets$DataSet"}
SKIPPED = {"Forms$PageTemplate", "Forms$BuildingBlock", "Images$ImageCollection", "Projects$ModuleSettings",
           "Texts$SystemTextCollection", "Projects$ProjectConversion"}
USED_BY = {"Forms$Page", "Forms$Snippet", "Forms$Layout", "ImportMappings$ImportMapping", "ExportMappings$ExportMapping",
           "JsonStructures$JsonStructure", "DataSets$DataSet"}
ENTITY_OPS = ("create", "retrieve", "change", "commit", "delete", "page", "referenced")

GUIDE = """You are analysing a Mendix {version} app. Its model was exported to text by mxcontext; the export is
read-only (changes are made in Mendix Studio Pro). Only custom modules are exported in detail.

WHERE TO LOOK
- overview.txt: modules, user roles -> module roles, app lifecycle microflows, navigation, export warnings.
- index/documents.txt: every document -> its file. index/call-graph.txt + called-by.txt: who calls what.
- index/entity-usage.txt: which flows create/retrieve/change/commit/delete each entity and which pages show it.
- index/attributes.txt: where each attribute is written (flows) and shown/edited (pages).
- index/entry-points.txt: scheduled events, published REST operations, entity event handlers, home pages.
- index/external-effects.txt: outgoing REST calls/requests, consumed REST services, task queues, and every use of a
  marketplace module (e-mail, SSO, Excel, ... are usually marketplace modules). Signatures: index/marketplace-api.txt.
- index/security.txt: per module role, the microflows, pages, entities (rights + XPath), REST services it can access.
- index/texts.txt: every UI/message text (all languages) -> documents using it. Use it for texts quoted in bug reports.
- index/unused.txt: documents nothing in the export references (dead code candidates).
- modules/<Module>/_module.txt: module roles, enumerations, constants, scheduled events, document tree.
- modules/<Module>/domain-model.txt: entities, attributes, associations, validation, event handlers, access rules.
- modules/<Module>/<microflows|nanoflows|rules|pages|java-actions|js-actions|integrations|other>/<Name>.txt

FLOW NOTATION
- Numbered steps run top-down; indentation = inside a branch, loop or error handler.
- IF ... then [true]/[false]/[enum value] branches; they rejoin at the next step with smaller indentation.
- "L1:" marks a merge point, "-> go to L1" jumps to it. ON ERROR: custom error-handler path.
- "+ COMMIT" = object is committed by that action. XPath follows WHERE. $Name = variable.
- Texts show all languages separated by " / " (e.g. 'Save / Kaydet').
- Every file ends with CALLED BY / USED BY listing all documents that reference it (including calls from Java code).

HOW TO WORK
- Grep first (names are Module.Document; attributes appear by short name), then read only the files you need.
- Cite file path + step number for every claim. If something is not in the export, say so instead of guessing.
- For a change request: list affected entities, flows, pages, security roles and side effects (entity events,
  callers from called-by.txt, scheduled events, REST operations). For a bug: trace from the entry point.
"""


def parse_args():
    ap = argparse.ArgumentParser(description="Export a Mendix model to LLM-friendly text files.")
    ap.add_argument("project", nargs="?", default=".", help="Mendix project folder or .mpr file")
    ap.add_argument("-o", "--out", help="output folder (default: <project folder>-context next to the project)")
    ap.add_argument("--include-marketplace", action="store_true", help="also export marketplace modules in detail")
    ap.add_argument("--show-constant-values", action="store_true", help="write constant default values (may contain secrets)")
    return ap.parse_args()


def prepare_output(path):
    """Empty (not delete) the output folder, so an agent or terminal running inside it keeps working."""
    if os.path.isdir(path) and os.listdir(path):
        if not os.path.exists(os.path.join(path, MARKER)):
            raise SystemExit("Refusing to overwrite %s: it is not an mxcontext output folder." % path)
        try:
            for name in os.listdir(path):
                child = os.path.join(path, name)
                if os.path.isdir(child) and not os.path.islink(child):
                    shutil.rmtree(child)
                else:
                    os.remove(child)
        except OSError as e:
            raise SystemExit("Cannot clean %s (%s). Close programs that lock files in it and retry." % (path, e))
    os.makedirs(path, exist_ok=True)
    with open(os.path.join(path, MARKER), "w", encoding="utf-8") as f:
        f.write("Generated by mxcontext. This folder is deleted and rebuilt on every run.\n")


class Exporter:
    def __init__(self, args):
        self.args = args
        self.started = time.time()
        self.warnings = []
        self.project = Project(args.project)
        self.ctx = Context(self.project, self.warnings)
        self.index = Index()
        self.out = os.path.abspath(args.out or self.project.root.rstrip("\\/") + "-context")
        self.files = {}
        self.paths = {}
        self.modules = {}
        self.overview = []
        self.user_roles = []
        self.marketplace_api = {}
        self.with_url = set()

    def run(self):
        prepare_output(self.out)
        units = [u for u in self.project.units.values() if u.type and u.type not in STRUCTURAL and u.type not in SKIPPED]
        units.sort(key=lambda u: (u.module.name if u.module else "", u.type, u.name or ""))
        for u in units:
            if u.module is None:
                self._project_level(u)
            elif self.args.include_marketplace or not u.module.marketplace:
                self._document(u)
            elif u.type in FLOW_TYPES or u.type in CODE_ACTIONS:
                self._marketplace_signature(u)
        self._copy_java()
        self._write_documents()
        self._write_modules()
        self._write_indexes()
        self._write_overview()
        self._write("AI_GUIDE.txt", GUIDE.format(version=self.project.version))
        self._write("opencode.json", json.dumps({"$schema": "https://opencode.ai/config.json",
                                                 "instructions": ["AI_GUIDE.txt"]}, indent=2) + "\n")
        print("Exported %d documents from %d modules to %s in %.1fs (%d warnings)." % (
            len(self.files), len(self.modules), self.out, time.time() - self.started, len(self.warnings)))

    # ------------------------------------------------------------ documents

    def _section(self, module, name):
        return self.modules.setdefault(module.name, {}).setdefault(name, [])

    def _document(self, u):
        module, qn = u.module, u.qn
        self.modules.setdefault(module.name, {})
        try:
            doc = self.project.load(u.id)
        except Exception as e:  # noqa: BLE001
            self.warnings.append("%s: cannot read (%r)" % (qn or u.id, e))
            return
        if qn:
            refs, entities, texts = set(), set(), set()
            harvest(doc, self.ctx.docs, refs)
            harvest(doc, self.ctx.entities, entities)
            collect_texts(doc, texts)
            self.index.ref(qn, refs)
            for e in entities:
                self.index.entity(e, "referenced", qn)
            for t in texts:
                self.index.ui_text(t, qn)
            for role in doc.get("AllowedModuleRoles") or []:
                self.index.grant(role, kind_of(u.type) + "s", qn)
            if doc.get("Url"):
                self.with_url.add(qn)
        try:
            self._route(u, doc, module, qn)
        except Exception as e:  # noqa: BLE001 - fall back to a generic dump, never abort the export
            self.warnings.append("%s: rendered generically (%r)" % (qn, e))
            self._store(u, "other", render_generic(doc, qn))

    def _route(self, u, doc, module, qn):
        t = u.type
        if t in FLOW_TYPES:
            self._store(u, FOLDERS[t], FlowRenderer(doc, qn, u, self.ctx, self.index).render())
        elif t in ("Forms$Page", "Forms$Snippet", "Forms$Layout"):
            self._store(u, "pages", PageRenderer(doc, qn, u, self.index).render())
        elif t in CODE_ACTIONS:
            self._store(u, FOLDERS[t], render_code_action(doc, qn, u, self.project.root, module, self.ctx, self.index))
        elif t == "Rest$PublishedRestService":
            self._store(u, "integrations", render_published_rest(doc, qn, self.index))
        elif t == "Rest$ConsumedRestService":
            self._store(u, "integrations", render_consumed_rest(doc, qn, self.index))
        elif t in ("ImportMappings$ImportMapping", "ExportMappings$ExportMapping"):
            self._store(u, "integrations", render_mapping(doc, qn))
        elif t == "JsonStructures$JsonStructure":
            self._store(u, "integrations", render_json_structure(doc, qn))
        elif t == "DataSets$DataSet":
            self._store(u, "integrations", render_dataset(doc, qn, self.index))
        elif t == "DomainModels$DomainModel":
            rel = "modules/%s/domain-model.txt" % module.name
            self.files[rel] = (qn, render_domain_model(doc, module, self.index))
            self.paths[qn] = rel
        elif t == "Security$ModuleSecurity":
            roles = ["%s%s" % (r.get("Name"), " (%s)" % r["Description"] if r.get("Description") else "")
                     for r in doc.get("ModuleRoles") or []]
            self._section(module, "MODULE ROLES").append(", ".join(roles) or "(none)")
        elif t == "Enumerations$Enumeration":
            self._inline(u, "ENUMERATIONS", enumeration_line(doc, qn))
        elif t == "Constants$Constant":
            self._inline(u, "CONSTANTS", constant_line(doc, qn, self.args.show_constant_values))
        elif t == "ScheduledEvents$ScheduledEvent":
            self._inline(u, "SCHEDULED EVENTS", scheduled_event_line(doc, qn, self.index))
        elif t == "Queues$Queue":
            self._inline(u, "TASK QUEUES", queue_line(doc, qn))
        elif qn:
            self._store(u, "other", render_generic(doc, qn))

    def _store(self, u, folder, content):
        rel = "modules/%s/%s/%s.txt" % (u.module.name, folder, u.name)
        self.files[rel] = (u.qn, content)
        self.paths[u.qn] = rel

    def _inline(self, u, section, line):
        self._section(u.module, section).append(line)
        self.paths[u.qn] = "modules/%s/_module.txt" % u.module.name

    def _marketplace_signature(self, u):
        try:
            doc = self.project.load(u.id)
        except Exception as e:  # noqa: BLE001
            self.warnings.append("%s: cannot read (%r)" % (u.qn, e))
            return
        sig = flow_signature(doc) if u.type in FLOW_TYPES else code_action_signature(doc)
        line = "%s%s  [%s]" % (u.qn, sig, kind_of(u.type))
        doc_text = clean(doc.get("Documentation"))
        if doc_text:
            line += "  // " + (doc_text if len(doc_text) <= 300 else doc_text[:300] + "...")
        self.marketplace_api.setdefault(u.module.name, []).append(line)
        self.paths[u.qn] = "index/marketplace-api.txt"

    def _project_level(self, u):
        render = {"Security$ProjectSecurity": lambda d: security_lines(d),
                  "Navigation$NavigationDocument": lambda d: navigation_lines(d, self.index),
                  "Settings$ProjectSettings": lambda d: settings_lines(d, self.index)}.get(u.type)
        if render is None:
            return
        try:
            doc = self.project.load(u.id)
            source = {"Navigation$NavigationDocument": "Navigation", "Settings$ProjectSettings": "ProjectSettings"}.get(u.type)
            if source:
                refs = set()
                harvest(doc, self.ctx.docs, refs)
                self.index.ref(source, refs)
            lines = render(doc)
            if u.type == "Security$ProjectSecurity":
                self.user_roles = lines
            self.overview += [""] + lines
        except Exception as e:  # noqa: BLE001
            self.warnings.append("%s: cannot render (%r)" % (u.type, e))

    def _copy_java(self):
        """Copy hand-written Java helper classes (not proxies, not generated action wrappers) of exported modules
        and record the microflows they call."""
        for name in self.modules:
            src = os.path.join(self.project.root, "javasource", name.lower())
            for folder, dirs, names in os.walk(src):
                rel_folder = os.path.relpath(folder, src)
                if rel_folder.split(os.sep)[0] in ("proxies", "actions"):
                    continue
                for n in names:
                    if n.endswith(".java"):
                        path = os.path.join(folder, n)
                        target = os.path.join(self.out, "modules", name, "java", rel_folder, n)
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        shutil.copyfile(path, target)
                        calls = code_refs(read_source(path) or "", self.ctx)
                        if calls:
                            self.index.ref(os.path.relpath(target, self.out).replace(os.sep, "/"), calls)

    # --------------------------------------------------------------- output

    def _write(self, rel, content):
        path = os.path.join(self.out, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)

    def _label(self, source):
        unit = self.ctx.docs.get(source)
        return "%s (%s)" % (source, kind_of(unit.type)) if unit else source

    def _reverse_refs(self):
        reverse = {}
        for source, targets in self.index.refs.items():
            for t in targets:
                reverse.setdefault(t, set()).add(source)
        return reverse

    def _write_documents(self):
        reverse = self._reverse_refs()
        for rel, (qn, content) in self.files.items():
            unit = self.ctx.docs.get(qn)
            callers = sorted(reverse.get(qn, ()))
            title = "USED BY" if unit and unit.type in USED_BY else "CALLED BY"
            if unit and unit.type != "DomainModels$DomainModel":
                content += "\n%s:\n" % title + ("".join("  - %s\n" % self._label(c) for c in callers) or "  (nothing in the exported model)\n")
            self._write(rel, content)

    def _write_modules(self):
        by_module = {}
        for qn, u in self.ctx.docs.items():
            if u.module and u.module.name in self.modules and u.type != "DomainModels$DomainModel":
                by_module.setdefault(u.module.name, []).append(u)
        for name, sections in sorted(self.modules.items()):
            module = next(m for m in self.ctx.modules.values() if m.name == name)
            out = ["MODULE %s (%s)" % (name, "marketplace %s" % module.version if module.marketplace else "custom")]
            for section in ("MODULE ROLES", "ENUMERATIONS", "CONSTANTS", "SCHEDULED EVENTS", "TASK QUEUES"):
                if sections.get(section):
                    out += ["", section + ":"] + ["  " + line for line in sorted(sections[section])]
            out += ["", "DOCUMENTS BY FOLDER:"]
            current = None
            for u in sorted(by_module.get(name, []), key=lambda x: (x.folder, kind_of(x.type), x.name)):
                if u.folder != current:
                    current = u.folder
                    out.append("  [%s]" % (current or "module root"))
                out.append("    %s %s%s" % (kind_of(u.type), u.name, " (excluded)" if u.excluded else ""))
            self._write("modules/%s/_module.txt" % name, "\n".join(out) + "\n")

    def _write_indexes(self):
        docs = []
        for qn, u in sorted(self.ctx.docs.items()):
            where = self.paths.get(qn) or ("(marketplace module, not exported)" if u.module and u.module.marketplace else "-")
            docs.append("%s\t%s\t%s" % (qn, kind_of(u.type), where))
        self._write("index/documents.txt", "# document\ttype\tfile\n" + "\n".join(docs) + "\n")

        calls = ["%s -> %s" % (self._label(s), ", ".join(sorted(t))) for s, t in sorted(self.index.refs.items()) if t]
        self._write("index/call-graph.txt", "# document -> documents it references\n" + "\n".join(calls) + "\n")
        reverse = self._reverse_refs()
        called = ["%s <- %s" % (t, ", ".join(self._label(s) for s in sorted(src))) for t, src in sorted(reverse.items())]
        self._write("index/called-by.txt", "# document <- documents that reference it\n" + "\n".join(called) + "\n")

        lines = []
        for entity, ops in sorted(self.index.entity_ops.items()):
            lines.append(entity)
            explicit = set().union(*(v for k, v in ops.items() if k != "referenced"))
            for op in ENTITY_OPS:
                sources = ops.get(op, set()) - (explicit if op == "referenced" else set())
                if sources:
                    lines.append("  %s: %s" % ("shown on pages" if op == "page" else op, ", ".join(sorted(sources))))
        self._write("index/entity-usage.txt", "# entity -> documents by operation\n" + "\n".join(lines) + "\n")

        lines = []
        for attr in sorted(set(self.index.attr_writes) | set(self.index.attr_ui)):
            lines.append(attr)
            if attr in self.index.attr_writes:
                lines.append("  written by: " + ", ".join(sorted(self.index.attr_writes[attr])))
            if attr in self.index.attr_ui:
                lines.append("  on pages: " + ", ".join(sorted(self.index.attr_ui[attr])))
        self._write("index/attributes.txt", "# attribute -> flows that set it, pages that show/edit it\n" + "\n".join(lines) + "\n")

        lines = []
        for section, entries in sorted(self.index.entries.items()):
            lines += ["", section + ":"] + ["  " + e for e in sorted(entries)]
        self._write("index/entry-points.txt", "# ways execution starts outside of a user clicking through pages\n" + "\n".join(lines) + "\n")
        self._write_effects()
        self._write_marketplace_api()
        self._write_security()
        self._write_texts()
        self._write_unused(reverse)

    def _write_effects(self):
        lines = []
        for section, entries in sorted(self.index.effects.items()):
            lines += ["", section + ":"] + ["  " + e for e in sorted(entries)]
        usage = {}
        for source, targets in self.index.refs.items():
            src = self.ctx.docs.get(source)
            if src and src.module and src.module.marketplace:
                continue
            for t in targets:
                u = self.ctx.docs.get(t)
                if u and u.module and u.module.marketplace and u.type not in ("Forms$Layout", "Forms$Snippet"):
                    usage.setdefault(u.module.name, {}).setdefault(t, set()).add(source)
        if usage:
            lines += ["", "MARKETPLACE MODULE USAGE (e-mail, SSO, Excel, ... live here; signatures in marketplace-api.txt):"]
            for module, targets in sorted(usage.items()):
                lines.append("  " + module)
                for t, sources in sorted(targets.items()):
                    lines.append("    %s <- %s" % (t, ", ".join(sorted(sources))))
        self._write("index/external-effects.txt", "# side effects that leave the app or run asynchronously\n" + "\n".join(lines) + "\n")

    def _write_marketplace_api(self):
        lines = []
        for module, entries in sorted(self.marketplace_api.items()):
            lines += ["", module] + ["  " + e for e in sorted(entries)]
        self._write("index/marketplace-api.txt", "# marketplace modules (not exported in detail): callable microflows and actions\n"
                    + "\n".join(lines) + "\n")

    def _write_security(self):
        lines = self.user_roles[:]
        for role, kinds in sorted(self.index.access.items()):
            lines += ["", "MODULE ROLE " + role]
            for kind, entries in sorted(kinds.items()):
                if kind == "entities":
                    lines.append("  entities:")
                    lines += ["    " + e for e in sorted(entries)]
                else:
                    lines.append("  %s: %s" % (kind, ", ".join(sorted(entries))))
        self._write("index/security.txt", "# what each module role can access (exported modules only)\n" + "\n".join(lines) + "\n")

    def _write_texts(self):
        lines = []
        for value, sources in sorted(self.index.texts.items(), key=lambda x: x[0].lower()):
            shown = value if len(value) <= 300 else value[:300] + "..."
            lines.append("\"%s\" <- %s" % (shown, ", ".join(sorted(sources))))
        self._write("index/texts.txt", "# UI and message texts in every language -> documents that contain them\n" + "\n".join(lines) + "\n")

    def _write_unused(self, reverse):
        lines = []
        for qn, u in sorted(self.ctx.docs.items()):
            if u.type in UNUSED_CANDIDATES and u.module and u.module.name in self.modules and qn not in reverse:
                note = " (has URL, may be opened directly)" if qn in self.with_url else ""
                lines.append("%s\t%s%s" % (qn, kind_of(u.type), note))
        header = ("# documents nothing in the export references. Verify before deleting: they may still be called by name\n"
                  "# at runtime, from marketplace modules, or from outside the app.\n")
        self._write("index/unused.txt", header + "\n".join(lines) + "\n")

    def _write_overview(self):
        counts = {}
        for u in self.ctx.docs.values():
            if u.module:
                per = counts.setdefault(u.module.name, {})
                per[kind_of(u.type)] = per.get(kind_of(u.type), 0) + 1
        out = ["MENDIX APP EXPORT (mxcontext)",
               "Mendix version: %s (%s)" % (self.project.version, self.project.format),
               "Project file: %s" % os.path.basename(self.project.mpr), "", "MODULES:"]
        for m in sorted(self.ctx.modules.values(), key=lambda m: (m.marketplace, m.name)):
            state = "custom" if not m.marketplace else "marketplace %s%s" % (
                m.version, "" if self.args.include_marketplace else ", not exported")
            summary = ", ".join("%d %s" % (n, k) for k, n in sorted(counts.get(m.name, {}).items()))
            out.append("  %s (%s): %s" % (m.name, state, summary or "empty"))
        out += self.overview
        if self.index.unknown:
            out += ["", "ELEMENT TYPES WITHOUT A DEDICATED RENDERER (shown as key=value):"]
            out += ["  %s x%d" % (t, n) for t, n in sorted(self.index.unknown.items())]
        if self.warnings:
            out += ["", "WARNINGS:"] + ["  " + w for w in self.warnings]
        self._write("overview.txt", "\n".join(out) + "\n")


def main():
    args = parse_args()
    try:
        Exporter(args).run()
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
