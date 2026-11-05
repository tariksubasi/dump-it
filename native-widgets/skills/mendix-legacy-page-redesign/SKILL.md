---
name: mendix-legacy-page-redesign
description: Redesign an existing (legacy) Mendix page with custom pluggable widgets end to end - read the page, its data sources, microflows, nanoflows, entities and security from a dump-it export (mx.py), inventory every widget and behavior, decide what becomes a custom widget, write the widget contracts (XML properties bound to the existing attributes and actions), design the responsive layout for every size class and orientation, build the widgets (.mpk), place them on the page (web: dump-it pluggable op with approval; native: Studio Pro steps), and prove behavior parity and UI quality. Use when the user gives a page (name or text context) and asks to make it nicer, modern, responsive, cleaner, or to rebuild it with custom widgets.
---

# Redesign a legacy Mendix page with custom widgets

You do the whole job: understand → plan → design → build → place → verify. The user only answers questions and approves.
Skills used together: `mendix-widget-ui-design` (look and layout rules), `mendix-web-widget` / `mendix-native-widget`
(how to build), and the dump-it export guide (`AI_GUIDE.txt`, `guides/MANUAL.md`, `guides/EDIT.txt`).

## 0. Rules

| # | Rule |
|---|---|
| 1 | **Behavior parity first**: every data source, action, condition, validation and role check of the old page keeps working. A parity table proves it (section 5). |
| 2 | Do not change entities, microflows or nanoflows unless the user asks. Widgets bind to what exists. |
| 3 | Reuse Mendix widgets where they are already good (Data grid 2, Combo box, Date picker, data views for editing). Build custom widgets for presentation: cards, headers, KPI tiles, status chips, list rows, empty states, form sections, toolbars. |
| 4 | Never edit the model without the dump-it protocol: `edits/<name>.json` → `python mx.py dryrun <name> --check` → user says the approval code → `python mx.py apply <CODE>`. |
| 5 | One page at a time. Small widgets, many uses; no "god widget" that re-implements the page. |
| 6 | Every claim cites a source: file + step, or a command output. Unknown → ask (max 5 questions). |
| 7 | Same error 3 times → stop and show it. |
| 8 | Privacy: the model text and data samples go to the LLM service; mask customer data in samples. |

## 1. Inputs to collect (ask only what is missing)

| Input | Example | Why |
|---|---|---|
| Export folder | `C:/work/App-context` | where `mx.py` and `modules/` are |
| Widget repo folder | `.../native-widgets` | where new widgets are built |
| Page | `Orders.Order_Overview` | the target |
| Platform | web / native / both | decides the skill and the placing method |
| Users and devices | field staff on phones, office on desktop | priorities per size class |
| Brand colors / theme | Atlas default or company colors | tokens (check contrast) |
| Must-keep elements | "the export button", "this filter" | scope |

## 2. Read the page (commands, in order)

| Step | Command / file | Output you write |
|---|---|---|
| 1 | `python mx.py refresh` | the export is current |
| 2 | `python mx.py widgets <Module.Page>` | widget tree: names, kinds, entity, data sources, conditions |
| 3 | `modules/<Module>/pages/<Page>.txt` | layout, parameters, texts |
| 4 | for each microflow/nanoflow used: `python mx.py steps <Module.Flow>` | what each button/event does |
| 5 | `modules/<Module>/domain-model.txt` | entities, attributes (types, lengths), associations, validation rules |
| 6 | `python mx.py security <Module>` | which roles see/edit what |
| 7 | `python mx.py usages <Module.Page> --depth 2` | who opens this page (parameters!) |
| 8 | `python mx.py texts <Module.Page>` | captions in all languages |
| 9 | `python mx.py widgettype` | pluggable widgets already in `widgets/` (and your new ones after copying the mpk) |
| 10 | `python mx.py preview <Module.Page>` | approximate picture today (web) — the "before" |

## 3. Inventory table (one row per widget of the old page)

| # | Old widget (name, kind) | Shows / edits | Data (entity, attribute, source) | Actions (flow) | Conditions (visible/editable, roles) | Validation | Keep / replace / remove | New widget |
|---|---|---|---|---|---|---|---|---|

Decision score per row (0–10 each, replace when the total ≥ 20):

| Criterion | Question |
|---|---|
| Visual gain | does a custom widget make it much clearer? |
| Reuse | can the widget be used on other pages? |
| Risk (inverse) | low behavior risk? (editing complex validation = risk) |
| Effort (inverse) | quick to build? |

## 4. Widget contracts (before any code)

For each new widget:

| Item | Content |
|---|---|
| Name / id | `CardList` / `dumpit.cardlist.CardList` |
| Purpose | one sentence |
| Context | inside a data view of `Orders.Order`? list? page parameter? |
| Properties | table: key, XML type, bound to (attribute/flow/expression), required, default |
| Actions | which existing microflow/nanoflow each action property calls (configured in Studio Pro) |
| States | loading, empty, error, read-only, disabled texts (translatable) |
| Size classes | layout per class (ASCII, see the design skill section 8) |
| Reuse | other pages that can use it |

Prefer generic widgets with properties (title attribute, subtitle expression, status attribute, item action) over
page-specific widgets.

## 5. Behavior parity table (must be all ✔ at the end)

| # | Old behavior (source) | New place (widget/property) | How to test | Result |
|---|---|---|---|---|
| 1 | "Save" runs `ACT_Order_Save` (page Order_Edit, button save1) | `OrderForm.onSave` → `ACT_Order_Save` | edit + save, check DB | |
| 2 | Field "Discount" visible only for role Manager | Mendix visibility on the widget (system property) or expression property | log in as both roles | |
| … | | | | |

## 6. Design

1. Apply `mendix-widget-ui-design`: fill its risk table for the page.
2. Layout spec for xs / compact / medium / expanded / large, portrait and landscape (ASCII per class).
3. Decide the scroll owner (page or one full-screen widget) and the layers (dialogs via Modal/portal).
4. Content priority list (what shrinks first, which labels become icons).
5. Show the user: before (preview), the layout sketches, the widget list, the parity table. Ask for approval.

## 7. Build

For each widget: follow the build skill workflow (XML → typings → logic → UI → tests → lint → release). Use the design
tokens. Version 1.0.0. Output: `dist/1.0.0/<packagePath>.<Widget>.mpk`.

## 8. Place on the page

| Platform | How |
|---|---|
| Web | copy the mpk to `<app>/widgets/`, `python mx.py refresh`, `python mx.py widgettype <Widget>` (shows its keys), write `edits/<name>.json` with `addWidgets` + `{ "widget": "pluggable", "type": "<Widget>", "properties": { … } }` (and `deleteWidget` / `moveWidget` for old widgets), `python mx.py dryrun <name> --check`, show the result + code, wait for the user's code, `python mx.py apply <CODE>`. Limits: no icon properties, no linked data sources via the op (do those in Studio Pro). |
| Native | the op cannot place native pluggable widgets: give exact Studio Pro steps (Toolbox → category → drag into the data view `X` → set properties table), and `python mx.py gap "place native widget <W> on <Page>"` |
| Both | after placing: Studio Pro F4, run, then section 9 |

Rollback: `python mx.py undoplan` / `python mx.py undo` (approval code) for model changes; keep the old widgets in a
hidden container until the user accepts, then delete them in a second change.

## 9. Verify

| Check | How |
|---|---|
| Studio Pro errors | `python mx.py check` → no NEW errors |
| Parity | every row of section 5 tested ✔ |
| UI | design skill QA matrix (sizes × orientations × light/dark × font 200 %) |
| Keyboard | each input visible with the keyboard open (phone + tablet) |
| Roles | each role sees/edits what it did before |
| Performance | page opens as fast as before (data source paging, no extra retrieves) |
| Done | `python mx.py ok "<summary>"` |

## 10. Final report (one table)

| Page | New widgets (mpk + version) | Old widgets removed | Parity (n/n ✔) | QA sizes passed | Open risks | Next page |
|---|---|---|---|---|---|---|
