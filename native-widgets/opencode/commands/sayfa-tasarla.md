---
description: Eski bir Mendix sayfasını özel widget'larla responsive ve kurumsal tasarımla yeniden yap
---
Redesign this Mendix page with custom pluggable widgets:

$ARGUMENTS

(Format: `<Module.Page> [web|native] [notes]`.)

Load these skills and follow them exactly:
1. `mendix-legacy-page-redesign` — the process (sections 0–10). It drives everything.
2. `mendix-widget-ui-design` — every look, layout, keyboard, scroll and layer rule; fill its risk table.
3. `mendix-web-widget` or `mendix-native-widget` — how to build each widget.

Before building, read `WIDGETS.md` in the widget repo: reuse or extend an existing widget before making a new one,
and add every new widget to it at the end.

Answer in Turkish, short sentences, mostly tables. You do the analysis, design and building yourself.
Stop and wait for the user only:
- to ask for missing inputs (process section 1, max 5 questions; remember the answers in `edits/redesign-notes.md`),
- after the design step (inventory, parity table, layout sketches per size class, widget list) for approval,
- before every `python mx.py apply <CODE>` (the user must say the code).
Never change entities, microflows or nanoflows unless the user asks. Never apply without the code.
