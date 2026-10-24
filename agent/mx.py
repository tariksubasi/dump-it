"""mx - short commands for an AI agent working in an mxcontext export folder.

Copied into the export folder by mxcontext.py with CONFIG filled in, so the agent never types long paths or quotes:

    python mx.py refresh              re-export the model and show what changed since the last checked state
    python mx.py find <text>          model elements whose name contains <text>
    python mx.py usages <Module.Name> [--depth n]
                                      who uses it (by name, expressions, XPath), grouped by document with the place;
                                      run it before rename, delete, moveEntity or changeMicroflow
    python mx.py unused [Module]      documents/entities/attributes/enumeration values nobody references (probably)
    python mx.py steps <Module.Flow>  steps of a microflow/nanoflow with ids (for changeAction / deleteAction)
    python mx.py widgets <Module.Page> widgets of a page or snippet: names, kinds, entity, where new ones go
                                      (for addWidgets / changeWidget / deleteWidget / moveWidget)
    python mx.py preview <Module.Page> approximate picture of a page with the compiled theme: edits/preview/<page>.html
                                      (+ phone/tablet/desktop .png when Playwright is installed)
    python mx.py widgettype [name]   pluggable widgets in widgets/*.mpk; with a name: its properties, types, defaults
                                      (for { "widget": "pluggable", "type": ..., "properties": ... })
    python mx.py mapping-test <Module.ImportMapping> <sample.json>
                                      what a sample JSON would make with an import mapping (objects, values, find or
                                      create, type problems); static, read-only; the file may be in edits/
    python mx.py texts [Module[.Doc]] [--missing <lang>]
                                      translatable texts in every project language (for setTranslations)
    python mx.py ops [name]           the operations a change file can use; with a name: its fields
    python mx.py api <Type> [word]    Model SDK type details (for .js change files)
    python mx.py dryrun <file> [--check]
                                      compute a change from edits/<file>; writes nothing; --check also runs Studio
                                      Pro's check (mx check) on a temporary copy with the change: NEW errors
    python mx.py rerun [file]         dry run a change file again (after undo); brings it back from the backup if gone
    python mx.py gap "<what>"         record a change no operation can do yet (then give the user Studio Pro steps)
    python mx.py apply <CODE>         write the last dry run (user approved, Studio Pro closed), re-export, check
                                      (STUDIO PRO CHECK: mx check on a copy, errors the change added are NEW)
    python mx.py undo [--force]       restore the model from before the last apply (Studio Pro closed), re-export;
                                      --force only when the user agrees to lose later changes it lists
    python mx.py undoplan [backup] [--op 2,5]
                                      selective undo: the inverse ops of the last (or given) apply, or of some of its
                                      ops, as edits/undo-<backup>.json and a dry run (approval code); later work stays
    python mx.py check                STUDIO PRO CHECK: Studio Pro's own consistency check (mx check, the Errors pane)
                                      on a temporary copy of the saved model; read-only (needs Studio Pro / MX_PATH)
    python mx.py ok "<summary>"       mark the current export as the checked state (git commit)
    python mx.py clean [--move]       files outside edits/ the export did not write (helper scripts, notes, edited
                                      exports); --move puts them into edits/stray/<time>/ (nothing is deleted)
    python mx.py selftest             run every operation on a temporary copy of the project
    python mx.py mergecheck           after a git merge of the app: which documents each side changed, which
                                      are resolved automatically, true conflicts with both changes
    python mx.py mergefix [--pick "<id|Doc>=ours|theirs,..."] [--all ours|theirs]
                                      dry run of the merge fix (merged unit files + rebuilt unit table); prints
                                      an approval code for apply
"""
import datetime
import glob
import json
import os
import re
import shutil
import subprocess
import sys

CONFIG = None  # filled in by mxcontext.py

HERE = os.path.dirname(os.path.abspath(__file__))

# Agents read this output through a pipe; on Windows that would use the ANSI code page and fail on Turkish letters.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
EDITS = os.path.join(HERE, "edits")
COMMANDS = ("refresh", "find", "usages", "unused", "steps", "widgets", "preview", "widgettype", "mapping-test", "texts", "ops", "api", "dryrun", "rerun", "gap", "apply", "undo", "undoplan", "check", "ok",
            "selftest", "mergecheck", "mergefix", "clean")
last_output = ""


def say(text):
    sys.stdout.write(text if text.endswith("\n") else text + "\n")
    sys.stdout.flush()


def run(cmd, cwd=HERE):
    """Run a command, print its output, return its exit code."""
    global last_output
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = last_output = (p.stdout or "") + (p.stderr or "")
    lines = [line for line in out.splitlines() if "ExperimentalWarning" not in line and "--trace-warnings" not in line]
    if lines:
        say("\n".join(lines))
    return p.returncode


def node_cmd():
    node = shutil.which("node")
    if not node or not os.path.isfile(CONFIG["mxlocal"]):
        say("Model editing is not available: install Node.js 22.13+ (node on PATH) and keep mxlocal next to mxcontext.py.")
        sys.exit(1)
    return [node, CONFIG["mxlocal"]]


def mxlocal(*args, project=True):
    return run(node_cmd() + list(args) + (["--project", CONFIG["mpr"]] if project else []))


def refresh():
    code = run([sys.executable, CONFIG["mxcontext"], CONFIG["mpr"], "-o", HERE] + CONFIG["export_flags"])
    if code:
        return code
    git = shutil.which("git")
    if git:
        p = subprocess.run([git, "diff", "--cached", "--stat"], cwd=HERE, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        lines = p.stdout.splitlines()
        if lines:
            say("Changed since the last checked state (read details with: git diff --cached -- <file>):")
            say("\n".join(lines[:40] + (["... %d more" % (len(lines) - 40)] if len(lines) > 40 else [])))
        else:
            say("No model changes since the last checked state.")
    return 0


def mx_args():
    """--mx <Studio Pro's mx> when the export found one; otherwise mxlocal looks itself (MX_PATH, Studio Pro, MxBuild)."""
    exe = CONFIG.get("mx_exe")
    return ["--mx", exe] if exe and os.path.isfile(exe) else []


def mx_check():
    """STUDIO PRO CHECK on a temporary copy (mx writes into the project it checks, so never on the user's files)."""
    return mxlocal("check", *mx_args())


def journal(**entry):
    """edits/journal.jsonl: every dry run, apply, undo and gap, so work can be found again after an undo."""
    os.makedirs(EDITS, exist_ok=True)
    entry = dict(time=datetime.datetime.now().isoformat(timespec="seconds"), **entry)
    with open(os.path.join(EDITS, "journal.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def backup_root():
    return os.path.join(os.path.dirname(CONFIG["mpr"]), ".mxlocal-backup")


def stray():
    sys.path.insert(0, os.path.dirname(CONFIG["mxcontext"]))
    import mx_stray
    return mx_stray


def clean(move):
    """List (and with --move: move to edits/stray/) the files outside edits/ that the export did not write."""
    found = stray().stray_files(HERE)
    if not found:
        say("Clean: no files outside edits/ besides the export.")
        return 0
    label = {"new": "not written by the export", "changed": "export file edited after the export",
             "deleted": "export file deleted (python mx.py refresh brings it back)"}
    say("%d file(s) outside edits/ that are not the export:" % len(found))
    say("\n".join("  %s  (%s)" % (rel, label[kind]) for rel, kind in found))
    if not move:
        say("Change files belong in edits/<name>.json only. Move these away (nothing is deleted): python mx.py clean --move")
        return 0
    where = stray().move_stray(HERE, found)
    journal(cmd="clean", moved=[rel for rel, kind in found if kind != "deleted"], to=where)
    say("Moved to %s/ (edited export files got their exported content back)." % where)
    return 0


def stray_warning():
    try:
        n = len(stray().stray_files(HERE))
    except Exception:  # noqa: BLE001 - a warning must never break the dry run
        return
    if n:
        say("WARNING: %d file(s) outside edits/: run python mx.py clean" % n)


def dryrun(path, check=False):
    if path.endswith(".js") and not CONFIG.get("allow_scripts"):
        say("ERROR: %s is a script, and scripts are off in this folder (they run with full rights before the user "
            "approves anything).\nUse operations: python mx.py ops. If no operation fits: python mx.py gap \"<what is "
            "missing>\", then give the user the Studio Pro steps.\n(The user can switch scripts on by exporting with "
            "--allow-scripts.)" % os.path.basename(path))
        return 1
    code = mxlocal("run", path, *(["--allow-js"] if path.endswith(".js") else []), *(["--check"] + mx_args() if check else []))
    m = re.search(r"Approval code: (\w+)", last_output)
    journal(cmd="dryrun", file=os.path.relpath(path, HERE), code=m.group(1) if m else None, ok=code == 0)
    stray_warning()
    return code


def rerun(name):
    """Dry run a change file again. Without a name: the change of the newest backup (the last apply, undone or not).
    A file that is gone from edits/ is written back from the backup first."""
    if name:
        for c in [os.path.join(EDITS, name), os.path.join(EDITS, name + ".json"), os.path.join(EDITS, name + ".js")]:
            if os.path.isfile(c):
                return dryrun(c)
    for b in sorted(glob.glob(os.path.join(backup_root(), "[0-9]*")), reverse=True):
        source = os.path.join(b, "change.txt")
        saved = [f for f in glob.glob(os.path.join(b, "change.*")) if not f.endswith(".txt")]
        if not saved or not os.path.isfile(source):
            continue
        with open(source, encoding="utf-8") as f:
            original = f.readline().partition("Source: ")[2].strip()
        base = os.path.basename(original) or os.path.basename(saved[0])
        if name and os.path.splitext(base)[0] != os.path.splitext(name)[0]:
            continue
        target = os.path.join(EDITS, base)
        if not os.path.isfile(target):
            os.makedirs(EDITS, exist_ok=True)
            shutil.copyfile(saved[0], target)
            say("Brought back edits/%s from backup %s." % (base, os.path.basename(b)))
        return dryrun(target)
    say("No change file '%s' in edits/ or in the backups." % name if name else "No applied change found in the backups.")
    return 1


def gap(text):
    os.makedirs(EDITS, exist_ok=True)
    gaps = os.path.join(EDITS, "gaps.jsonl")
    n = sum(1 for _ in open(gaps, encoding="utf-8")) + 1 if os.path.isfile(gaps) else 1
    with open(gaps, "a", encoding="utf-8") as f:
        f.write(json.dumps({"time": datetime.datetime.now().isoformat(timespec="seconds"), "need": text},
                           ensure_ascii=False) + "\n")
    journal(cmd="gap", need=text)
    say("Recorded as gap #%d in edits/gaps.jsonl. Tell the user that no operation does this yet and give the exact "
        "Studio Pro steps (menu names, which document, which property)." % n)
    return 0


def change_file(name):
    candidates = [name, os.path.join(EDITS, name)]
    if not os.path.splitext(name)[1]:
        candidates += [os.path.join(EDITS, name + ".json"), os.path.join(EDITS, name + ".js")]
    for c in candidates:
        full = c if os.path.isabs(c) else os.path.join(HERE, c)
        if os.path.isfile(full):
            return full
    existing = sorted(os.listdir(EDITS)) if os.path.isdir(EDITS) else []
    say("No change file '%s'. Write it to edits/<name>.json first. Files in edits/: %s" % (name, ", ".join(existing) or "(none)"))
    sys.exit(1)


def main(argv):
    if CONFIG is None:
        say("This is the template of mx.py. Use the copy that mxcontext.py writes into the export folder.")
        return 1
    if not argv or argv[0] in ("-h", "--help", "help"):
        say(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd not in COMMANDS:
        hint = " Commands are lowercase: python mx.py %s" % cmd.lower() if cmd.lower() in COMMANDS else ""
        say("Unknown command '%s'.%s\n%s" % (cmd, hint, __doc__))
        return 1
    if cmd == "refresh":
        return refresh()
    if cmd == "find":
        if not rest:
            say("Usage: python mx.py find <part of a name>")
            return 1
        return mxlocal("find", " ".join(rest))
    if cmd == "usages":
        names = [a for i, a in enumerate(rest) if not a.startswith("--") and (i == 0 or rest[i - 1] != "--depth")]
        if not names:
            say("Usage: python mx.py usages <Module.Name> [--depth n]")
            return 1
        depth = rest[rest.index("--depth") + 1:rest.index("--depth") + 2] if "--depth" in rest else []
        return mxlocal("usages", names[0], *(["--depth"] + depth if depth else []))
    if cmd == "unused":
        return mxlocal("unused", *rest[:1])
    if cmd == "steps":
        if not rest:
            say("Usage: python mx.py steps <Module.Microflow>")
            return 1
        return mxlocal("steps", rest[0])
    if cmd == "widgets":
        if not rest:
            say("Usage: python mx.py widgets <Module.Page or Module.Snippet>")
            return 1
        return mxlocal("widgets", rest[0])
    if cmd == "preview":
        if not rest:
            say("Usage: python mx.py preview <Module.Page>")
            return 1
        return mxlocal("preview", rest[0], "--out", os.path.join(EDITS, "preview", rest[0] + ".html"))
    if cmd == "widgettype":
        return mxlocal("widgettype", *([" ".join(rest)] if rest else []))
    if cmd == "mapping-test":
        if len(rest) < 2:
            say("Usage: python mx.py mapping-test <Module.ImportMapping> <sample.json> (the file may be in edits/)")
            return 1
        return mxlocal("mapping-test", rest[0], "--json", change_file(rest[1]))
    if cmd == "texts":
        missing = rest[rest.index("--missing") + 1:rest.index("--missing") + 2] if "--missing" in rest else []
        scope = [a for i, a in enumerate(rest) if not a.startswith("--") and (i == 0 or rest[i - 1] != "--missing")][:1]
        return mxlocal("texts", *scope, *(["--missing"] + missing if missing else []))
    if cmd == "ops":
        return mxlocal("ops", *rest[:1], project=False)
    if cmd == "api":
        if not rest:
            say("Usage: python mx.py api <Type> [filter word], e.g. python mx.py api Attribute")
            return 1
        return mxlocal("api", *rest)
    if cmd == "dryrun":
        names = [a for a in rest if not a.startswith("--")]
        if not names:
            say("Usage: python mx.py dryrun <file in edits/> [--check]")
            return 1
        return dryrun(change_file(names[0]), "--check" in rest)
    if cmd == "rerun":
        return rerun(rest[0] if rest else None)
    if cmd == "gap":
        if not rest:
            say('Usage: python mx.py gap "<what the user wants that no operation can do>"')
            return 1
        return gap(" ".join(rest))
    if cmd == "apply":
        if not rest:
            say("Usage: python mx.py apply <CODE>  (the code from the dry run, after the user approved it)")
            return 1
        code = mxlocal("apply", "--code", rest[0], "--check", *mx_args())
        m = re.search(r"Backup: (\S+)", last_output)
        journal(cmd="apply", code=rest[0], backup=m.group(1) if m else None, ok=code == 0)
        if not m:  # nothing written
            return code
        # written: the export must follow the model even when CHECK FAILED or the STUDIO PRO CHECK found new errors
        say("")
        refresh()
        return code
    if cmd == "undo":
        code = mxlocal("restore", *(["--force"] if "--force" in rest else []))
        journal(cmd="undo", ok=code == 0)
        if code:
            return code
        return refresh()
    if cmd == "undoplan":
        names = [a for a in rest if not a.startswith("--")]
        op = rest[rest.index("--op") + 1] if "--op" in rest and rest.index("--op") + 1 < len(rest) else None
        if op in names:
            names.remove(op)
        code = mxlocal("undo", *names[:1], *(["--op", op] if op else []), "--out", os.path.join(EDITS, "undo-%s.json" % (names[0] if names else "last")))
        m = re.search(r"Approval code: (\w+)", last_output)
        journal(cmd="undoplan", backup=names[0] if names else None, ops=op, code=m.group(1) if m else None, ok=code == 0)
        return code
    if cmd == "check":
        return mx_check()
    if cmd == "ok":
        git = shutil.which("git")
        if not git:
            say("git not found")
            return 1
        code = run([git, "commit", "-q", "-m", " ".join(rest) or "checked"])
        if code == 0:
            say("Saved as the checked state.")
        return code
    if cmd == "clean":
        return clean("--move" in rest)
    if cmd == "selftest":
        return mxlocal("selftest")
    if cmd == "mergecheck":
        return mxlocal("mergecheck")
    if cmd == "mergefix":
        args = []
        for flag in ("--pick", "--all"):
            if flag in rest and rest.index(flag) + 1 < len(rest):
                args += [flag, rest[rest.index(flag) + 1]]
        code = mxlocal("mergefix", *args)
        m = re.search(r"Approval code: (\w+)", last_output)
        journal(cmd="mergefix", code=m.group(1) if m else None, ok=code == 0)
        return code
    say("Unknown command '%s'.\n%s" % (cmd, __doc__))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
