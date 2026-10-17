"""Claude Code PreToolUse hook for an mxcontext export folder (written to .claude/hooks/guard.py by mxcontext.py).

The agent may write only change files: edits/<name>.json (and edits/<name>.js when the export allows scripts).
Every other file write is denied, whatever the permission lists say:
  - Write / Edit / MultiEdit / NotebookEdit: the target path, made absolute against the session folder, backslashes
    read as separators, symlinks resolved, must lie inside edits/ (but not edits/stray/) with an allowed extension.
  - Bash / PowerShell: an interpreter (node, python, ...) started on anything but mx.py: inline code (-c, -e),
    stdin (here-documents) or a helper script. Every output redirection target (> >> &> 2> ...), tee target, Out-File / Set-Content /
    Add-Content / New-Item path and cp / mv / copy / move destination must lie inside edits/ (or be a null device).
Input: the hook JSON on stdin. Output: a JSON deny decision, or nothing (normal permission rules apply).
"""
import json
import os
import re
import sys

ALLOW_SCRIPTS = False  # set by mxcontext.py
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NULL = {"/dev/null", "nul", "$null", "/dev/stdout", "/dev/stderr", "con"}
WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
SHELL_TOOLS = {"Bash", "PowerShell"}
RULE = ("Write only change files: edits/<name>.json%s. Do not create helper scripts or other files; use python mx.py "
        "commands, and if no operation fits run python mx.py gap \"<what>\".")


def norm(path, cwd):
    path = path.strip().strip("\"'")
    if os.sep == "/":
        path = path.replace("\\", "/")
    path = os.path.expanduser(path)
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)
    return os.path.normcase(os.path.realpath(path))


def inside(path, folder):
    return path == folder or path.startswith(folder.rstrip(os.sep) + os.sep)


def allowed_file(path, cwd):
    """None when the agent may write the file, else the reason."""
    full = norm(path, cwd)
    edits = norm(os.path.join(ROOT, "edits"), ROOT)
    if not inside(full, edits) or full == edits:
        return "%s is outside edits/" % path
    if inside(full, os.path.join(edits, "stray")):
        return "edits/stray/ holds files moved away by python mx.py clean"
    ext = os.path.splitext(full)[1].lower()
    if ext == ".json" or ext == ".js" and ALLOW_SCRIPTS:
        return None
    return "%s is not a change file (.json%s)" % (path, ", .js" if ALLOW_SCRIPTS else "")


def strip_heredocs(command):
    """Drop here-document bodies: their text is data, not shell syntax."""
    out, lines, i = [], command.split("\n"), 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        ends = [m.group(2) for m in re.finditer(r"<<-?\s*(['\"]?)([A-Za-z_][\w-]*)\1", line)]
        i += 1
        for end in ends:
            while i < len(lines) and lines[i].strip() != end:
                i += 1
            i += 1
    return "\n".join(out)


def tokens(command):
    """Shell words and operators, quotes kept off the words. Rough, but on the safe side for redirections."""
    result, word, quote, i = [], "", None, 0
    def flush():
        nonlocal word
        if word:
            result.append(word)
        word = ""
    while i < len(command):
        c = command[i]
        if quote:
            if c == quote:
                quote = None
            else:
                word += c
        elif c in "\"'":
            quote = c
        elif c.isspace():
            flush()
        elif c in ";|&()" and not (c == "&" and command[i:i + 2] == "&>"):
            flush()
            result.append(c)
        elif c == ">" or c == "&" and command[i + 1:i + 2] == ">":
            # n> n>> &> >| >& : the operator, the target is the next word (or attached)
            op = ""
            if word.isdigit():
                op, word = word, ""
            flush()
            j = i
            while j < len(command) and command[j] in ">&|":
                j += 1
            op += command[i:j]
            result.append(("redirect", op))
            i = j
            continue
        else:
            word += c
        i += 1
    flush()
    return result


def shell_targets(command):
    """Files a shell command writes, as far as can be seen from its text."""
    toks = tokens(strip_heredocs(command))
    targets = []
    for k, t in enumerate(toks):
        if isinstance(t, tuple):
            nxt = toks[k + 1] if k + 1 < len(toks) else None
            if t[1].endswith("&") and isinstance(nxt, str) and (nxt.isdigit() or nxt == "-"):
                continue  # 2>&1, >&2
            if isinstance(nxt, str) and nxt not in ";|&()":
                targets.append(nxt)
    # commands: split on ; | & ( )
    cmd = []
    for t in toks + [";"]:
        if isinstance(t, tuple):
            cmd.append(None)
            continue
        if t in ";|&()":
            targets += command_targets(cmd)
            cmd = []
        else:
            cmd.append(t)
    return targets


def command_targets(raw):
    # words after a redirection operator are its target, not arguments
    args = []
    skip = False
    for w in raw:
        if w is None:
            skip = True
            continue
        if skip:
            skip = False
            continue
        args.append(w)
    while args and re.match(r"^\w+=", args[0]):
        args = args[1:]
    if not args:
        return []
    name = os.path.basename(args[0].replace("\\", "/")).lower()
    if name.endswith(".exe"):
        name = name[:-4]
    rest = args[1:]
    plain = [a for a in rest if not a.startswith("-")]
    if name == "tee":
        return plain
    if name in ("cp", "mv", "copy", "move", "xcopy", "robocopy", "copy-item", "move-item", "cpi", "mi", "install", "ln"):
        dest = [a for k, a in enumerate(rest) if k > 0 and rest[k - 1].lower() in ("-destination", "-t", "--target-directory")]
        return dest or plain[-1:]
    if name == "touch":
        return plain
    if name in ("out-file", "set-content", "add-content", "new-item", "ni", "export-csv"):
        named = [a for k, a in enumerate(rest) if k > 0 and rest[k - 1].lower() in ("-filepath", "-path", "-literalpath")]
        return named or plain[:1]
    if name == "dd":
        return [a[3:] for a in rest if a.startswith("of=")]
    if name == "sed" and any(a.startswith("-i") or a == "--in-place" for a in rest):
        return plain[1:]
    return []


INTERPRETERS = {"node", "nodejs", "deno", "bun", "tsx", "ts-node", "npx", "python", "python3", "py", "pythonw", "perl",
                "ruby", "php", "powershell", "pwsh", "cscript", "wscript"}


def helper_script(command):
    """The reason when the command runs an interpreter on anything but mx.py (inline code, stdin or a helper)."""
    words = [t for t in tokens(strip_heredocs(command)) if isinstance(t, str)]
    for k, w in enumerate(words):
        if k and words[k - 1] not in ";|&()":
            continue
        name = os.path.basename(w.replace("\\", "/")).lower()
        name = name[:-4] if name.endswith(".exe") else name
        if not re.match(r"^(python|py)(\d+(\.\d+)?)?w?$", name) and name not in INTERPRETERS:
            continue
        args = [a for a in words[k + 1:] if a not in ";|&()"][:1]
        if args and os.path.basename(args[0].replace("\\", "/")) in ("mx.py", "mxcontext.py"):
            continue
        return "%s runs %s; helper scripts and inline code are not allowed here" % (
            name, args[0] if args else "code from stdin")
    return None


def decide(event):
    tool = event.get("tool_name") or ""
    data = event.get("tool_input") or {}
    cwd = event.get("cwd") or ROOT
    if tool in WRITE_TOOLS:
        path = data.get("file_path") or data.get("notebook_path") or data.get("path") or ""
        return allowed_file(path, cwd) if path else None
    if tool in SHELL_TOOLS:
        helper = helper_script(str(data.get("command") or ""))
        if helper:
            return helper
        for target in shell_targets(str(data.get("command") or "")):
            if target.lower() in NULL:
                continue
            reason = allowed_file(target, cwd)
            if reason:
                return "the command writes a file: " + reason
    return None


def main():
    try:
        event = json.load(sys.stdin)
        reason = decide(event)
    except Exception:  # noqa: BLE001 - a broken hook must not block the session; normal permissions still apply
        return 0
    if reason:
        sys.stdout.write(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "deny",
            "permissionDecisionReason": "Blocked by the export guard: %s. %s" % (
                reason, RULE % (" (or edits/<name>.js)" if ALLOW_SCRIPTS else ""))}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
