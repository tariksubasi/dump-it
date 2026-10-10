# dump-it with OpenCode: the agent manual

> **Türkçe not:** Bu dosya OpenCode (veya başka bir yapay zeka ajanı) için yazıldı. Ajanlar İngilizce talimatlara
> daha iyi uyduğu için İngilizcedir. Export bu dosyayı `guides/MANUAL.md` olarak otomatik koyar; elle vermene gerek
> yok. Yine de vermek istersen OpenCode'a şunu yaz: `guides/MANUAL.md dosyasını oku ve buna göre çalış.`

You are an AI coding agent (OpenCode, Claude Code or similar) helping a Mendix developer. This manual tells you
everything you need: what the tools are, which commands to run, how to answer questions, how to change the model
safely, and what each output means. Answer the user in their own language (often Turkish).

---

## 1. The three rules

1. **Never write the model without approval.** Run `python mx.py apply <CODE>` only after the user said yes to that
   exact code, from the last dry run.
2. **Never claim without proof.** Say something is done only when a command output shows it (`Saved ...`,
   `Checked: ...`). Cite a file path and step number for every claim about the app. If something is not in the
   export, say so. Do not guess.
3. **Write only in `edits/`.** Every other file in the export folder is regenerated and must not be edited.

If you forget everything else, keep these three.

---

## 2. What the parts are

```
Mendix project (C:\Projeler\App)          Tool repo (C:\tools\dump-it)
  App.mpr + mprcontents/   <──reads──   mxcontext.py   (export: model -> text files)
           ^                             mxlocal/       (change: runs the Mendix Model SDK offline)
           │ writes (only after approval)
           │
Export folder (C:\Projeler\App-context)   <── you work HERE
  AI_GUIDE.txt      short guide, always loaded
  guides/           EDIT.txt (change protocol), CHECK.txt (check protocol), MANUAL.md (this file)
  mx.py             your short commands: python mx.py help
  edits/            your change files (kept across exports)
  modules/, index/  the exported model as text
  .git              local history: last commit = last checked model state
```

- **mxcontext.py** reads the Mendix project and writes the export folder. It never writes the project.
- **mxlocal** changes the project (`.mpr`) through the official Mendix Model SDK, offline, with a backup first.
- **mx.py** wraps both, so you never type long paths or quotes. Always use it from the export folder.

The export is a snapshot. After any change (by the user in Studio Pro or by you), run `python mx.py refresh`.

Use the Python command written in `AI_GUIDE.txt` (`python`, `py` or `python3`). This manual writes `python`.

---

## 3. Commands

Run all of these from the export folder.

| Command | What it does | Needs approval |
|---|---|---|
| `python mx.py help` | Lists the commands | no |
| `python mx.py refresh` | Re-exports the model and lists files changed since the last checked state | no |
| `python mx.py find <text>` | Lists elements whose qualified name contains `<text>`, with their SDK type | no |
| `python mx.py steps <Module.Flow>` | Lists the steps of a microflow/nanoflow with stable ids (for `changeAction`, `deleteAction`, `addActions` `after`) | no |
| `python mx.py ops [name]` | One line per operation; with a name (`ops createPage`, `ops retrieve`): its fields. `ops all`: everything | no |
| `python mx.py api <Type> [word]` | SDK type reference for this Mendix version (for `.js` files only) | no |
| `python mx.py dryrun <file>` | Computes a change from `edits/<file>`. Writes nothing. Prints an approval code | no |
| `python mx.py rerun [file]` | Dry run a change file again (after an undo). A file gone from `edits/` comes back from the backup | no |
| `python mx.py gap "<what>"` | Records a change no operation can do yet (`edits/gaps.jsonl`). Then give the user Studio Pro steps | no |
| `python mx.py apply <CODE>` | Writes the last dry run, re-exports, lists changed files, runs `mx check` when installed | **yes** |
| `python mx.py undo [--force]` | Restores the model from before the last apply, then re-exports. Refuses when the model changed after that apply; `--force` only when the user accepts losing the listed changes | **yes** |
| `python mx.py check` | Runs Studio Pro's `mx check` (only when `mx.exe` is installed) | no |
| `python mx.py ok "<summary>"` | Saves the current export as the checked state (git commit) | no |
| `python mx.py selftest` | Runs every operation on a temporary copy of the project and checks the result | no |

In OpenCode the same read-only commands also exist as tools: `mx_find`, `mx_steps`, `mx_ops`, `mx_api`,
`mx_dryrun`, `mx_rerun`, `mx_gap`, `mx_refresh`. Use the tool or the command; the result is the same. `apply` and
`undo` exist only as commands, so OpenCode (and Claude Code) asks the user before they run. Commands are lowercase.

Every dry run, apply, undo and gap is logged in `edits/journal.jsonl`. Never delete a change file that worked: after
an undo, fix it and run `python mx.py rerun <file>`.

The user can type these slash commands:

| Slash command | Your job |
|---|---|
| `/degistir <request>` | Change the model. Follow section 5 |
| `/kontrol [what it should do]` | Check the user's own Studio Pro change. Follow section 6. The refresh output is already in the message |
| `/geri-al` | Run `python mx.py undo` (Studio Pro closed) and report |
| `/senkron` | After pull/merge/branch switch: `python mx.py refresh`, then `python mx.py ok "sync"`. No review |

---

## 4. Answering questions (read-only)

1. Search first, then read only the files you need. Do not read whole folders.
2. Where to look:

| Question | File |
|---|---|
| Where is document X? | `index/documents.txt` |
| Who calls microflow X? | `index/called-by.txt`, `index/call-graph.txt` |
| Who creates, changes or deletes entity X? | `index/entity-usage.txt` |
| Who sets attribute X, which page shows it? | `index/attributes.txt` |
| REST endpoints, scheduled events, event handlers | `index/entry-points.txt` |
| Outgoing REST, e-mail, marketplace modules | `index/external-effects.txt` |
| What can role X do? | `index/security.txt` |
| Where does the text "..." appear? | `index/texts.txt` |
| Dead code | `index/unused.txt` |
| Workflows, user tasks, timers | `index/workflows.txt` |
| One document in detail | `modules/<Module>/<kind>/<Name>.txt` |
| Entities, attributes, associations, access rules | `modules/<Module>/domain-model.txt` |

3. Flow notation in microflow files: numbered steps run top-down; indentation = inside a branch, loop or error
   handler; `L1:` is a merge point, `-> go to L1` jumps there; `+ COMMIT` = the action commits; `$Name` = variable.
   Every file ends with `CALLED BY` / `USED BY`.
4. For a bug: trace from the entry point (page button, REST operation, scheduled event) step by step.
5. For a change request (when the user does it in Studio Pro): list affected entities, microflows, pages, roles and
   side effects (event handlers, callers, scheduled events, REST operations).

---

## 5. Changing the model (`/degistir`)

Follow these steps in order. Do not skip one.

**Step 1: Find the names.** Names are case-sensitive and qualified (`Module.Entity`, `Module.Entity.Attribute`).

```
python mx.py find Order
```

**Step 2: Write the change file** `edits/<short-name>.json`. Use only operations and fields from section 7
(`python mx.py ops <name>` shows the live fields). Several operations in one file run in order. If no operation
fits, run `python mx.py gap "<what>"` and give the user Studio Pro steps (section 8).

**Step 3: Dry run.**

```
python mx.py dryrun <short-name>
```

- `ERROR:` → read the `HINT:` line, fix the file, run again. After 5 failed tries, stop and show the user the error.
- `EXPRESSION CHECK` lines → fix the names in the file and run again.

**Step 4: Show the result and ask.** Use this format, then stop and wait:

```
PLAN: <1-5 bullets: what changes and why>
DRY RUN: <the numbered op lines and the "Changes:" lines>
ATTENTION: <every DATA LOSS line first, then every EXPRESSION CHECK / NOT STORED / OLD NAME STILL USED / STILL USED BY / Warnings line, or "none">
To apply: close Studio Pro and answer "yes <CODE>".
```

**Step 5: Apply.** Only after the user said yes with that code, and Studio Pro is closed:

```
python mx.py apply <CODE>
```

If it says `does not match the last dry run` or `model changed since the dry run`, go back to step 3.

**Step 6: Report.** Report the `Checked:` (or `CHECK FAILED`) line, the changed export files, and the `mx check`
result (or that it did not run). Fix `OLD NAME` / `STILL USED BY` lines with a new change (back to step 2). Tell
the user to open Studio Pro, look at the Errors pane, run the app and then commit. If the result is wrong: the user
closes Studio Pro, you run `python mx.py undo`, fix the change file and run `python mx.py rerun <file>`. If undo
says `The model changed after this apply`, show the user the listed changes and use `undo --force` only if they agree.

---

## 6. Checking the user's change (`/kontrol`)

1. Run `python mx.py refresh` (skip this if the `/kontrol` message already contains its output).
   "No model changes" → ask the user if they saved in Studio Pro (Ctrl+S).
2. Read only the changes: `git diff --cached -- <file>` for the relevant changed files.
3. Compare with the change agreed in this conversation. If none was agreed, ask what it should do. Report:

```
DONE: <what is correct, with file + step number>
MISSING: <what is still needed, or "nothing">
UNEXPECTED: <changes nobody asked for, or "none">
IMPACT: <callers, pages, roles, scheduled events affected>
```

4. Only when MISSING is "nothing" and the user agrees: `python mx.py ok "<short summary>"`. Otherwise do not save, so
   the next check sees the whole change.

Run git commands one at a time (no `&&`). Never add a git remote and never push this folder.

---

## 7. Operations reference

A change file is JSON: `{ "ops": [ { "op": "<name>", ...fields } ] }`. **R** = required. Unknown fields are errors.
The live list is `python mx.py ops`. If it differs from this table, trust the live list.

### Domain model

| Op | Fields | Notes |
|---|---|---|
| `createEntity` | **module**, **name**, persistable (default true), generalization (`Module.Parent`), attributes `[{name, type, default}]` | Placed to the right of existing entities |
| `addAttribute` | **entity**, **name**, **type**, default | Default when not given: Integer/Long/Decimal `0`, Boolean `false`, AutoNumber `1`, others empty |
| `changeAttribute` | **attribute** (`Module.Entity.Attr`), type, default | At least one of type/default |
| `addAssociation` | **from**, **to**, name (default `From_To`), type (`Reference`/`ReferenceSet`), owner (`Default`/`Both`) | `from` stores the reference: many `from` → one `to` for Reference. Other module in `to` → cross-module association |
| `setGeneralization` | **entity**, **generalization** (`Module.Parent` or `"none"`), persistable | Refuses loops. Check access rules and pages of the entity afterwards |
| `addValidationRule` | **entity**, **attribute**, **rule** (`required`/`unique`/`maxLength`/`range`/`regex`/`equals`), **message**, maxLength, min, max, regex, value | |
| `addEventHandler` | **entity**, **moment** (`Before`/`After`), **event** (`Create`/`Commit`/`Delete`/`RollBack`), **microflow**, passObject (default true), raiseErrorOnFalse | The microflow needs one parameter of the entity (when passObject) and must return Boolean for `Before` |
| `addIndex` | **entity**, **attributes** `["A", {"name":"B","ascending":false}]` | |
| `createEnumeration` | **module**, **name**, **values** (`["A", {"name":"B","caption":"Bee"}]`), folder | Captions are written in the project's default language |
| `addEnumerationValue` | **enumeration**, **name**, caption | |

Attribute types: `String(200)`, `String(unlimited)`, `String` (=200), `Integer`, `Long`, `Decimal`, `Boolean`,
`DateTime`, `AutoNumber`, `HashedString`, `Binary`, `Enum(Module.Enumeration)`.
The default of an `Enum` attribute is the value name, e.g. `"default": "Open"`.

### Security

| Op | Fields | Notes |
|---|---|---|
| `createModuleRole` | **module**, **name**, description | |
| `grantAccess` | **document** (microflow, nanoflow or page), **roles** `["Module.Role"]` | Adds to the allowed roles; existing roles stay |
| `addAccessRule` | **entity**, **roles**, access (`ReadWrite`/`ReadOnly`/`None`, default `ReadOnly`), members `{"Attr":"ReadWrite"}`, create, delete, xpath | Every attribute and owned association gets a member right. AutoNumber and calculated attributes are never more than ReadOnly |

### Microflows and nanoflows

| Op | Fields | Notes |
|---|---|---|
| `createMicroflow` | **module**, **name**, folder, parameters `[{name, type}]`, returns, returnValue (required with returns), actions, roles | Start → actions → end, with decisions, loops and error handlers. Folders are created when missing |
| `createNanoflow` | same as `createMicroflow` | Runs in the browser/app. No `log`. Can call nanoflows and microflows |
| `addActions` | **microflow** (or nanoflow), **actions**, after (`"start"`, a variable name, or a step id) | Without `after`: before the single end event. Works inside loops too. Inserted actions must not end the flow |
| `changeAction` | **microflow**, **id** (from `steps`), and the fields to change | See the table below |
| `deleteAction` | **microflow**, **id** | Deletes one action or loop and reconnects the line. Refuses steps with an error handler, decisions, merges and events |

Data types for parameters, variables and returns: `String`, `Integer`, `Long`, `Decimal`, `Boolean`, `DateTime`,
`Module.Entity` (one object), `List(Module.Entity)`, `Enum(Module.Enumeration)`.

Actions (inside `"actions": [ { "action": "<name>", ... } ]`). Every action also takes `caption` and `onError`:

| Action | Fields | Defaults |
|---|---|---|
| `retrieve` | **variable** + either entity, xpath, first (database) or from, association (over an association) | first = false (a list) |
| `create` | **variable**, **entity**, set `{"Attr":"expr", "Module.Assoc":"$Var"}`, commit | commit = false |
| `change` | **variable**, **set**, commit, refresh | commit = false |
| `commit` | **variable**, events | events = true |
| `delete` | **variable** | |
| `call` | **microflow** (a nanoflow too, inside a nanoflow), args `{"Param":"expr"}`, variable | Every parameter needs an arg. A microflow cannot call a nanoflow |
| `log` | **message** (`{1}`, `{2}` = args), args `["expr"]`, level, node | Microflows only. level Info, node = module name |
| `message` | **text**, type (`Information`/`Warning`/`Error`), blocking | blocking = true |
| `variable` | **name**, **type**, **value** | |
| `set` | **name**, **value** | |
| `showPage` | **page**, args `{"PageParameter":"$Var"}` | Every page parameter needs an arg |
| `closePage` | count | |

Flow control (also inside `"actions"`):

| Action | Fields | Notes |
|---|---|---|
| `if` | **condition**, then `[...]`, else `[...]`, caption | A branch may end with `end`, `break` or `continue`; open branches join again after the decision |
| `loop` | **actions** + either over (list variable), item (default `<List>Item`) or while (expression) | |
| `end` | value | Required `value` when the flow returns something. Not inside loops |
| `break` / `continue` | | Only inside a loop |
| `error` | | Only inside an `onError` handler: ends with the error again |

`onError` on an action: `"continue"`, or `{ "rollback": true/false, "actions": [...], "returnValue": "..." }`. A
handler path that does not end gets an end event automatically (`returnValue` when the flow returns something).
Inside a loop a handler must end with `break`, `continue` or `error`.

`changeAction` fields per kind of step:

| Step | Fields |
|---|---|
| any action | caption, disabled |
| retrieve | xpath, first, entity |
| create / change | set (adds or replaces), unset `["Attr"]`, commit, refresh |
| commit | events, refresh |
| call | args |
| log | message, level, args |
| message | text, type, blocking |
| variable / set | value |
| decision (`IF`) | condition, caption |
| loop | while (while loop), over (list loop) |
| end | value |

Variable names are written without `$` in `variable`, `from`, `over`, `item`, `after` and `name`. Expressions are
Mendix expressions as text: `"'Hello'"`, `"$Order/Total * 2"`, `"empty"`, `"[%CurrentDateTime%]"`,
`"Module.Enum.Value"`. String literals need single quotes inside the JSON string.

### Pages and navigation

| Op | Fields | Notes |
|---|---|---|
| `createPage` | **module**, **name**, title, entity, fields `["Attr"]`, buttons (default true), widgets, arrange, menu, layout, folder, roles | Without `widgets`: with `entity` an edit form (page parameter, data view, an input per attribute, Save/Cancel), without `entity` an empty page. With `widgets`: the page content from the widget list below; `entity` is then the default entity of grids and data views. `menu` (`"Responsive"` or `{profile, caption, parent}`) adds a menu item, `roles` lets module roles open the page. The layout is the one the project's own pages use most |
| `addMenuItem` | **page**, profile (default Responsive), caption (default: the page title), parent (caption of an existing menu item) | Only pages without parameters. A page is in a menu once. New items go at the end |
| `setHomePage` | **page** or **microflow**, profile (default Responsive), roles (user roles, e.g. `["Administrator"]`) | Without roles: the default home page. Only pages/microflows without parameters |

Widgets in `"widgets": [ { "widget": "<kind>", ... } ]`, top to bottom. Every widget takes `name` (default as
Studio Pro: `grid1`, `dataGrid2_1`, `dataView1`, ...). Full field list: `python mx.py ops createPage`.

| Widget | Fields | Notes |
|---|---|---|
| `layoutGrid` | columns `[8, 4]` or `[{"weight": 8, "widgets": [...]}]`, or rows `[{"columns": [...]}]`, width | Weights 1-12 or `"auto"`; `tablet`/`phone` weights per column |
| `container` | widgets, class | |
| `text` | **text**, style (`Text`, `Paragraph`, `H1`-`H6`) | Inside a data view or list view, `{Attribute}` shows the value |
| `dataGrid` | entity, columns (`"Attr"` or `{attribute, caption, width}`), xpath, search, selection (default Single), selectFirst, rows, kind | Database (XPath) source. `kind`: `classic` (default; search bar), `datagrid2` (a Data grid 2 copied from one on this project's pages; refused when the project has none or its widget differs from `widgets/*.mpk`), `auto` (datagrid2 when possible, else classic) |
| `dataView` | entity, source (`parameter`/`listen`), listenTo, editable (default true), fields, buttons, widgets, footer | `listenTo`: the name of a grid or list view, or `dataGrid` / `listView` when the page has exactly one. Without `listenTo`: a page parameter of the entity, with Save/Cancel when editable |
| `listView` | entity, xpath, fields, widgets, pageSize | A data view can listen to it |
| `actionButton` | **action** (`save`, `cancel`, `close`, `delete`, `showPage`, `callMicroflow`, `callNanoflow`), caption, page, microflow, nanoflow, style, closePage | Passes only the object of the data view or list view it is in (target with that one parameter or none) |
| `input`, `textBox`, `textArea`, `checkBox`, `datePicker`, `dropDown` | **attribute**, label | Inside a data view; `input` picks the widget by attribute type |

A grid followed by the data view that listens to it is placed side by side (layout grid 8/4); `"arrange": "rows"`
stacks them. The dry run's `Warnings` start with the grid kind that was used, then lint lines: a grid with 0
columns, a listened grid whose selection is None or Multi, page roles that are in no user role, belong to another
module or have no access rule on the shown entity, user roles that will not see the menu item, texts to translate.
A wrong or ambiguous `listenTo` is an error that lists the grids and list views on the page.

Dashboard: a grid, a read-only detail of the selected row next to it, a menu item, two roles:

```json
{ "ops": [ { "op": "createPage", "module": "EmployeeOnboarding", "name": "Dashboard", "entity": "EmployeeOnboarding.EmployeeOnboarding",
  "widgets": [ { "widget": "dataGrid", "columns": ["FullName", "WFH", "FirstDay", "PhoneModel", "LaptopModel"] },
               { "widget": "dataView", "listenTo": "dataGrid", "editable": false } ],
  "menu": "Responsive", "roles": ["EmployeeOnboarding.User", "EmployeeOnboarding.HR"] } ] }
```

Layout grid, heading, list view with an editable detail and buttons, a Data grid 2, menu item and home page:

```json
{ "ops": [
  { "op": "createPage", "module": "HR", "name": "Employee_Board", "entity": "HR.Employee", "roles": ["HR.User"],
    "widgets": [
      { "widget": "text", "text": "Employees", "style": "H2" },
      { "widget": "layoutGrid", "columns": [
        { "weight": 4, "widgets": [ { "widget": "listView", "fields": ["Name"] } ] },
        { "weight": 8, "widgets": [ { "widget": "dataView", "listenTo": "listView", "fields": ["Name", "Email", "Active"],
            "widgets": [ { "widget": "text", "text": "Started on {StartDate}" } ],
            "footer": [ { "widget": "actionButton", "action": "save", "closePage": false },
                        { "widget": "actionButton", "action": "callNanoflow", "nanoflow": "HR.NF_Employee_Check", "caption": "Check" } ] } ] } ] },
      { "widget": "dataGrid", "kind": "datagrid2", "entity": "HR.Department", "columns": ["Name", { "attribute": "Code", "caption": "Department code" }] } ] },
  { "op": "addMenuItem", "page": "HR.Employee_Board", "caption": "Employees" },
  { "op": "setHomePage", "page": "HR.Employee_Board", "roles": ["User"] }
] }
```

What pages cannot do yet (use Studio Pro, and `python mx.py gap "<what>"`):
- Change an existing page, snippet or layout: add, move, remove or edit widgets there.
- Widgets other than the ones above: tab container, group box, snippet call, image, reference selector, combo box,
  gallery and every other pluggable widget, except a Data grid 2 copied from the project.
- Data grid 2: columns show attributes only; no filters, default sorting, custom content, export, personalization or
  click actions (they are left empty). It needs a Data grid 2 on a page or snippet of this project whose widget equals
  `widgets/*.mpk` (otherwise `kind: datagrid2` is refused; use `classic`).
- Classic data grid: only the database (XPath) source and a Search button (no New/Edit/Delete buttons in the bar).
- Data views: only a page parameter or a listened grid/list view (no microflow, nanoflow or association source).
- Buttons: no parameter mappings, no create-object action; conditional visibility, styling (design properties) and
  on-change events are not set.
- Menus: web profiles only (native profiles are refused); no reordering. Texts are written as given in every project
  language (translate them in Studio Pro).

### Constants, scheduled events, REST

| Op | Fields | Notes |
|---|---|---|
| `createConstant` | **module**, **name**, **type**, **default**, exposedToClient, folder | Type String/Integer/Long/Decimal/Boolean/DateTime |
| `createScheduledEvent` | **module**, **name**, **microflow**, **every** (`Minute`/`Hour`/`Day`/`Week`), interval, at (`HH:MM`), days, enabled (default false), timeZone, onOverlap, folder | The microflow must have no parameters |
| `publishRest` | **module**, **service**, **resource**, **method**, **microflow**, path (e.g. `{Id}`), servicePath, authentication (default Basic), roles, folder | Microflow parameters become path (`{Name}` in path) or query parameters. Object/list parameters or results need mappings: refused, do those in Studio Pro. Experimental |

### Documents, rename and delete

| Op | Fields | Notes |
|---|---|---|
| `moveDocument` | **document**, folder (missing or `""` = module root) | Within the same module |
| `rename` | **target** (qualified name, or a module name), **newName** | Updates every reference. A module rename also updates `Module.` in expressions and XPath and lists code folders to move. Other renames report old names left in expressions, XPath and Java (`OLD NAME STILL USED`) |
| `delete` | **target** | Deletes a document, entity, attribute, association, enumeration value or module role. Lists documents that still use it (`STILL USED BY`) |

### Examples

Add an attribute:

```json
{ "ops": [ { "op": "addAttribute", "entity": "Sales.Order", "name": "Note", "type": "String(500)" } ] }
```

Enumeration, entity and association:

```json
{ "ops": [
  { "op": "createEnumeration", "module": "Sales", "name": "OrderStatus", "values": ["Open", "Paid", { "name": "Cancelled", "caption": "Canceled" }] },
  { "op": "createEntity", "module": "Sales", "name": "Invoice", "attributes": [
      { "name": "Number", "type": "AutoNumber" }, { "name": "Total", "type": "Decimal" },
      { "name": "Status", "type": "Enum(Sales.OrderStatus)", "default": "Open" } ] },
  { "op": "addAssociation", "from": "Sales.Invoice", "to": "Sales.Order" }
] }
```

Microflow with steps:

```json
{ "ops": [ { "op": "createMicroflow", "module": "Sales", "name": "ACT_Order_Close", "folder": "Orders",
  "parameters": [ { "name": "Order", "type": "Sales.Order" } ], "roles": ["Sales.User"],
  "actions": [
    { "action": "retrieve", "variable": "Lines", "entity": "Sales.OrderLine", "xpath": "[Sales.OrderLine_Order = $Order]" },
    { "action": "change", "variable": "Order", "set": { "Status": "Sales.OrderStatus.Paid" }, "commit": true },
    { "action": "call", "microflow": "Sales.SUB_Order_Notify", "args": { "Order": "$Order" } },
    { "action": "message", "text": "Order closed", "type": "Information" } ] } ] }
```

Decision, loop and error handler:

```json
{ "ops": [ { "op": "createMicroflow", "module": "Sales", "name": "ACT_Orders_Process",
  "actions": [
    { "action": "retrieve", "variable": "Open", "entity": "Sales.Order", "xpath": "[Paid = false()]" },
    { "action": "if", "condition": "$Open = empty", "then": [ { "action": "end" } ] },
    { "action": "loop", "over": "Open", "item": "Order", "actions": [
        { "action": "if", "condition": "$Order/Total = 0", "then": [ { "action": "continue" } ] },
        { "action": "call", "microflow": "Sales.SUB_Order_Pay", "args": { "Order": "$Order" },
          "onError": { "rollback": false, "actions": [ { "action": "log", "message": "pay failed", "level": "Error" }, { "action": "continue" } ] } } ] } ] } ] }
```

Change and delete single steps (ids from `python mx.py steps Sales.ACT_Orders_Process`):

```json
{ "ops": [
  { "op": "changeAction", "microflow": "Sales.ACT_Orders_Process", "id": "dba83c80", "xpath": "[Paid = false() and Total > 0]" },
  { "op": "deleteAction", "microflow": "Sales.ACT_Orders_Process", "id": "8d0e4a77" }
] }
```

Page and nanoflow:

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Order_Edit", "entity": "Sales.Order", "fields": ["Number", "Total", "Status"], "roles": ["Sales.User"] },
  { "op": "createNanoflow", "module": "Sales", "name": "NF_Order_Open", "parameters": [ { "name": "Order", "type": "Sales.Order" } ],
    "actions": [ { "action": "showPage", "page": "Sales.Order_Edit", "args": { "Order": "$Order" } } ] }
] }
```

Insert a step and rename:

```json
{ "ops": [
  { "op": "addActions", "microflow": "Sales.ACT_Order_Save", "after": "Customer",
    "actions": [ { "action": "log", "message": "Customer {1} saved", "args": ["$Customer/Name"] } ] },
  { "op": "rename", "target": "Sales.Order.Note", "newName": "Remark" }
] }
```

Security:

```json
{ "ops": [
  { "op": "createModuleRole", "module": "Sales", "name": "Manager" },
  { "op": "grantAccess", "document": "Sales.ACT_Order_Close", "roles": ["Sales.Manager"] },
  { "op": "addAccessRule", "entity": "Sales.Order", "roles": ["Sales.Manager"], "access": "ReadWrite", "create": true, "delete": true }
] }
```

---

## 8. When no operation fits: gap, Studio Pro steps, or (if allowed) SDK scripts

First run `python mx.py gap "<what the user wants>"`. It records the missing operation so it can be added later.
Then give the user exact Studio Pro steps. SDK scripts (`edits/<name>.js`) run only in folders exported with
`--allow-scripts`, because a script runs with full rights before the user approves anything; otherwise `dryrun`
refuses them.

Operations cannot do these things: changing existing pages, snippets or layouts (widgets can only be placed when
`createPage` creates the page), widgets outside the `createPage` list (tab containers, galleries and other pluggable
widgets; only a Data grid 2 copied from the project), modules and user roles (App Security), import/export mappings,
JSON structures, consumed REST services, workflows, REST operations with object bodies or results, inheritance
splits, and setting attributes inherited from System entities (for example `System.User.Name`). For these, write
`edits/<name>.js` with the Mendix Model SDK, or give the user Studio Pro steps. Prefer Studio Pro steps when the
change is large or risky.

```js
module.exports = async ({ model, sdk, ops, log }) => {
    const entity = await ops.get("Sales.Order");          // any document or element by qualified name, loaded
    const a = sdk.domainmodels.Attribute.createIn(entity);
    a.name = "Weight";
    sdk.domainmodels.DecimalAttributeType.createInAttributeUnderType(a);
    await ops.addAttribute({ entity: "Sales.Order", name: "Code", type: "String(20)" });  // operations work here too
    log("done");
};
```

- Before using a type, run `python mx.py api <Type>`. It answers for this project's Mendix version. Use only the
  listed properties and create functions. Anything under `NOT IN MENDIX <version>` fails; the line names the
  replacement, for example `GridDatabaseSource` → `GridXPathSource` (removed in 10.5) and `DataView.editable` →
  `editability` (removed in 10.7). `NOTE:` lines say how to fill a property, for example `listenTarget` takes a widget
  name, not an entity.
- Too many create functions are listed? Add a filter word: `python mx.py api ObjectType MicroflowParameterObject`.
- A dry run fails with `can no longer be instantiated`, `is not yet available`, `illegal ... "createIn"`,
  `is not a function` or `Cannot encode value`? Its `HINT:` line names the replacement or the valid create
  functions. Apply it, then check with `python mx.py api <Type>`.
- Microflow objects go in `mf.objectCollection`. Flows go in `mf.flows` (`SequenceFlow` with `origin`,
  `destination`).
- The same dry run, approval and apply steps apply. Fix the script until the dry run shows no `NOT STORED` lines.

---

## 9. Reading the output

### Dry run

```
  1. addAttribute Sales.Order.Note: String(500)          <- one line per operation that ran
Changes: 0 created, 1 updated, 0 deleted unit(s)           <- documents that will change
  ~ DomainModels$DomainModel  (...)
EXPRESSION CHECK ...                                       <- wrong $Var/Attribute in an expression: fix the file
NOT STORED ...                                             <- a value this Mendix version does not keep: fix the script
OLD NAME STILL USED ...                                    <- rename left old names in expressions/XPath/Java
      DATA LOSS: the column A and its values are dropped ...  <- deleting/retyping stored data: tell the user first
Warnings:
  > Module.Doc -> Module/Folder                              <- a document moved to another folder
  ! Module.Page: grid1 is a classic Data grid (...)         <- createPage: the grid kind used (always the first line)
  ! ... first use in this project ...                      <- first element of this type: ask the user to check it in Studio Pro
Dry run: nothing written. Approval code: 7F3A              <- the code the user must confirm
```

Show the user every line between `Changes:` and `Dry run:`. Do not hide warnings.

### Apply

```
Saved 2 unit file(s), deleted 0. Backup: .mxlocal-backup/<time>   <- written, with a backup
Checked: all 2 operation(s) are in the saved model.               <- verified by reading the model again
Changed since the last checked state ...                          <- export files that changed
mx check: NOT RUN (mx.exe not found) ...                          <- say this to the user; they check in Studio Pro
```

`CHECK FAILED` instead of `Checked:` means the saved model does not show an operation. Tell the user, suggest
`python mx.py undo`, then fix the change file and start again.

---

## 10. Errors and fixes

| Output | Fix |
|---|---|
| `not found in the model. Did you mean: X` | Use X. Confirm with `python mx.py find` |
| `unknown op 'a'. Did you mean: b` / `unknown field 'a'` | Use the suggested name. See `python mx.py ops` |
| `needs 'x'` | Add field x |
| `already exists` | It is already done. Remove that operation or use another name |
| `no variable 'V' before this action` | V must be a parameter or be created by an earlier action |
| `has no attribute 'A' (in $V/A). Did you mean: B` | Use B in that expression |
| `has N end events` / `has N outgoing flows` | Add `"after": "<variable name>"`, a step id, or `"after": "start"` |
| `has no step with id` | Run `python mx.py steps <Module.Flow>` and copy the id in brackets |
| `'x' cannot be changed on ...` | The message lists the fields that kind of step accepts |
| `is only allowed inside a loop` / `unreachable` | `break`/`continue` only in loops; nothing may follow `end`/`break`/`continue` |
| `it has an error handler` | `deleteAction` refuses this step; give Studio Pro steps |
| `unknown widget 'x'. Supported: ...` | Use a listed widget kind. For other widgets: `python mx.py gap "<what>"` and Studio Pro steps |
| `listenTo 'x' is no grid or list view on this page (...)` / `is ambiguous` | Use one of the grid or list view names the message lists |
| `"kind": "datagrid2" is not possible here` | Use `"kind": "classic"` (or leave `kind` out) |
| `has a page parameter; a menu item can only open a page without parameters` | Open that page from a button or microflow instead |
| `needs an import mapping` / `export mapping` | `publishRest` supports simple parameters and results only; give Studio Pro steps |
| `needs args for: P` | Add every parameter of the called microflow to `args` |
| `Studio Pro has this project open` | Ask the user to close Studio Pro, then run the same command again |
| `Code ... does not match the last dry run` | Use the code of the latest dry run (show it to the user again) |
| `The model changed since the dry run` | Run the dry run again and ask for the new code |
| `Nothing to undo` | There is no applied change left to undo |
| `The model changed after this apply ... Undo would erase that work` | Show the user the listed changes. Undo newer changes first, or `undo --force` only if the user agrees to lose them |
| `is a script. Scripts are off` | Use operations. If none fits: `python mx.py gap "<what>"` and Studio Pro steps |
| `Unknown command 'APPLY'` | Commands are lowercase |
| `No operation or action 'x'. Did you mean: y` | Use y. List all: `python mx.py ops` |
| `MPR v1 format` | This project cannot be changed by mxlocal. Give Studio Pro steps |
| `Model editing is not available` | Node.js 22.13+ is missing. Give Studio Pro steps |
| `ERROR` with `at ... edits/<name>.js:<line>` | The script failed at that line. Read the HINT |

---

## 11. One-time setup (only when the user asks for help with it)

Run these in a normal terminal, not inside the export folder. Paths are examples.

```
python C:\tools\dump-it\mxcontext.py "C:\Projeler\App"                              # export -> C:\Projeler\App-context
node C:\tools\dump-it\mxlocal\mxlocal.js verify   --project "C:\Projeler\App"        # 3 lines must say identical
node C:\tools\dump-it\mxlocal\mxlocal.js selftest --project "C:\Projeler\App"        # every line must say OK
```

Also add `.mxlocal-backup/` to the project's `.gitignore`. Requirements: Python 3.8+, Git, and for model changes
Node.js 22.13+ and an MPR v2 project (Mendix 10/11). Export options: `-o <folder>`, `--include-marketplace`,
`--show-constant-values` (may expose secrets), `--no-opencode-tools`.

---

## 12. Working well as a small model

- Do one request at a time. Split a big request into several change files and dry runs.
- Copy the shape of an example in section 7 and change only the names.
- Read the `HINT:` line before you change anything.
- If the same error comes back 3 times, stop and show it to the user.
- Keep answers short: the format of section 5 step 4, or the DONE/MISSING/UNEXPECTED/IMPACT format of section 6.

## The three rules (again)

1. No apply without the user's yes for the code of the last dry run.
2. No claim without command output or a cited file that shows it.
3. Write only in `edits/`.
