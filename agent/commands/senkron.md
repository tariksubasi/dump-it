---
description: Pull/merge/branch sonrası export'u yenile ve başlangıç noktası yap
---
The user pulled, merged or switched branch. Run these two commands, one at a time, and report the output briefly in
the user's language. Do not review the changes.

@PY@ mx.py refresh
@PY@ mx.py ok "sync"

If git reported merge conflicts in the .mpr file or in mprcontents, or refresh fails after a merge, do this instead:
run `@PY@ mx.py mergecheck`, show the user the TRUE CONFLICTS lines (what each side changed) and ask ours or theirs
for each document. Then `@PY@ mx.py mergefix --pick "<id>=ours|theirs"` (one pick per conflict, comma-separated),
show the dry run and its approval code, and run `@PY@ mx.py apply <CODE>` only after the user answers with that code
(Studio Pro closed). Finally tell the user to run `git add` for the .mpr and mprcontents and `git commit`.
