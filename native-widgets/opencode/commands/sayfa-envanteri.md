---
description: Uygulamadaki sayfaları tara, salt okunur olanları bul, yeniden tasarım için öncelik listesi çıkar
---
Make a redesign backlog for this Mendix app. Scope (module name, or empty = all modules):

$ARGUMENTS

Read only. Change nothing. Answer in Turkish, short sentences, tables.

1. List pages: `index/documents.txt` (pages, not snippets/layouts) in the scope. Platform per page: web or native
   (from its layout; ask once if unclear).
2. For each page run `python mx.py widgets <Module.Page>` and classify:
   - **read-only**: no input widgets (text box, text area, drop-down, date picker, check box, radio buttons,
     reference (set) selector, combo box, file/image uploader) and no Save/commit buttons;
   - **mostly read-only**: inputs only inside a few sections;
   - **edit**: a form.
   Count: widgets, nesting depth, data views, list views/grids, buttons.
3. Usage: how often the page is opened (`index/called-by.txt` / `python mx.py usages <page>`), menu/home page entries.
4. Score each page (1–10): `usage × 0.4 + ugliness × 0.3 + read-only × 0.3` where ugliness = nesting depth,
   many plain containers/group boxes, label+text rows, no responsive classes. Explain the score in one line.
5. For the top 10: which widgets of `mendix-readonly-widgets` (section 1) cover it (SectionCard, FieldList,
   DetailHeader, StatusChip, KpiTiles, CardList, Timeline, …) and which widgets already exist (`WIDGETS.md`).
6. Output:
   | # | Page | Platform | Type | Opened from (count) | Score | Widgets needed | New widgets to build |
   then "Build order": the widgets that cover the most top-10 pages first.
Stop there. The user picks the next step (`/widget-yap` or `/sayfa-tasarla`).
