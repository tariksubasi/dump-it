"""Files in an mxcontext export folder that the export did not write (agents' helper scripts, notes, edited exports).

The export lists every file it writes in the .mxcontext marker file. Everything else outside edits/, .git/,
.opencode/ and .claude/ is stray. Export files changed after the export (git: modified in the work tree) are stray
too. Used by mxcontext.py (before it empties the folder) and by mx.py clean. Stdlib only.
"""
import datetime
import os
import shutil
import subprocess

MARKER = ".mxcontext"
FILES_HEADER = "FILES WRITTEN BY THE EXPORT:"
KEEP = {".git", "edits", ".opencode", ".claude"}  # survive re-exports: history, change files, agents' own files
SCRIPTS = (".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".ps1", ".bat", ".cmd")


def written(root):
    """The files the last export wrote (relative, '/'), or None for an export without a file list."""
    try:
        with open(os.path.join(root, MARKER), encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return None
    if FILES_HEADER not in lines:
        return None
    return set(lines[lines.index(FILES_HEADER) + 1:]) | {MARKER}


def _git_changes(root):
    """{path: 'changed' | 'deleted' | 'new'} from git status, export folders kept out."""
    git = shutil.which("git")
    if not git or not os.path.isdir(os.path.join(root, ".git")):
        return {}
    try:
        out = subprocess.run([git, "status", "--porcelain", "-z", "--untracked-files=all"], cwd=root,
                             capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    except OSError:
        return {}
    found, entries, i = {}, out.split("\0"), 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        xy, path = entry[:2], entry[3:]
        if xy[0] in "RC":
            i += 1  # the old name follows
        if path.split("/")[0] in KEEP:
            continue
        if xy == "??":
            found[path] = "new"
        elif xy[1] in "MT":
            found[path] = "changed"
        elif xy[1] == "D":
            found[path] = "deleted"
    return found


def stray_files(root):
    """[(path, kind)] sorted; kind: new (the export did not write it), changed (an export file edited after the
    export), deleted (an export file removed after the export)."""
    known = written(root)
    found = _git_changes(root)
    for folder, dirs, names in os.walk(root):
        rel_folder = os.path.relpath(folder, root).replace(os.sep, "/")
        if rel_folder == ".":
            rel_folder = ""
            dirs[:] = [d for d in dirs if d not in KEEP]
        for name in names:
            rel = rel_folder + "/" + name if rel_folder else name
            if name in KEEP and not rel_folder:
                continue
            if known is not None:
                if rel not in known:
                    found[rel] = "new"
            elif not rel_folder and name.lower().endswith(SCRIPTS) and name != "mx.py":
                found[rel] = "new"  # old export without a file list: at least the helper scripts on top
    if known is not None:
        found = {p: k for p, k in found.items() if k != "new" or p not in known}
    return sorted(found.items())


def move_stray(root, files, stamp=None):
    """Move new/changed files to edits/stray/<stamp>/ (never delete); changed export files get their exported
    content back from git. Returns the target folder (relative)."""
    stamp = stamp or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = os.path.join(root, "edits", "stray", stamp)
    git = shutil.which("git")
    for rel, kind in files:
        if kind == "deleted":
            continue
        src = os.path.join(root, *rel.split("/"))
        dst = os.path.join(target, *rel.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if kind == "changed":
            shutil.copy2(src, dst)
            if git:
                subprocess.run([git, "checkout-index", "-f", "--", rel], cwd=root, capture_output=True)
            continue
        shutil.move(src, dst)
        parent = os.path.dirname(src)
        while os.path.normcase(parent) != os.path.normcase(root) and os.path.isdir(parent) and not os.listdir(parent):
            os.rmdir(parent)
            parent = os.path.dirname(parent)
    return "edits/stray/" + stamp
