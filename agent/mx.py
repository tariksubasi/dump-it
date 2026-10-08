"""mx - short commands for an AI agent working in an mxcontext export folder.

Copied into the export folder by mxcontext.py with CONFIG filled in, so the agent never types long paths or quotes:

    python mx.py refresh              re-export the model and show what changed since the last checked state
    python mx.py find <text>          model elements whose name contains <text>
    python mx.py ops                  the operations a change file can use
    python mx.py api <Type> [word]    Model SDK type details (for .js change files)
    python mx.py dryrun <file>        compute a change from edits/<file> (.json or .js); writes nothing
    python mx.py apply <CODE>         write the last dry run (user approved, Studio Pro closed), re-export, check
    python mx.py undo                 restore the model from before the last apply (Studio Pro closed), re-export
    python mx.py check                run Studio Pro's mx check on the project (when mx.exe is installed)
    python mx.py ok "<summary>"       mark the current export as the checked state (git commit)
    python mx.py selftest             run every operation on a temporary copy of the project
"""
import json
import os
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


def say(text):
    sys.stdout.write(text if text.endswith("\n") else text + "\n")
    sys.stdout.flush()


def run(cmd, cwd=HERE):
    """Run a command, print its output, return its exit code."""
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
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


def mx_check():
    exe = CONFIG.get("mx_exe")
    if not exe or not os.path.isfile(exe):
        say("mx check: NOT RUN (mx.exe not found%s). Ask the user to open the app in Studio Pro and look at the "
            "Errors pane." % (" at " + exe if exe else ""))
        return 0
    if os.path.exists(CONFIG["mpr"] + ".lock"):
        say("mx check: NOT RUN (Studio Pro has the project open). Ask the user to check the Errors pane in Studio Pro.")
        return 0
    say("mx check (Studio Pro's own validation):")
    return run([exe, "check", CONFIG["mpr"]])


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
    cmd, rest = argv[0].lower(), argv[1:]
    if cmd == "refresh":
        return refresh()
    if cmd == "find":
        if not rest:
            say("Usage: python mx.py find <part of a name>")
            return 1
        return mxlocal("find", " ".join(rest))
    if cmd == "ops":
        return mxlocal("ops", project=False)
    if cmd == "api":
        if not rest:
            say("Usage: python mx.py api <Type> [filter word], e.g. python mx.py api Attribute")
            return 1
        return mxlocal("api", *rest)
    if cmd == "dryrun":
        if not rest:
            say("Usage: python mx.py dryrun <file in edits/>")
            return 1
        return mxlocal("run", change_file(rest[0]))
    if cmd == "apply":
        if not rest:
            say("Usage: python mx.py apply <CODE>  (the code from the dry run, after the user approved it)")
            return 1
        code = mxlocal("apply", "--code", rest[0])
        if code:
            return code
        say("")
        refresh()
        say("")
        mx_check()
        return 0
    if cmd == "undo":
        code = mxlocal("restore")
        if code:
            return code
        return refresh()
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
    if cmd == "selftest":
        return mxlocal("selftest")
    say("Unknown command '%s'.\n%s" % (cmd, __doc__))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
