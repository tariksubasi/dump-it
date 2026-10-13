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
| `python mx.py widgets <Module.Page>` | Lists the widget tree of a page or snippet: names, kinds, entity of each data view / list view, and where new widgets can go (`[into]`, layout grid column paths). For `addWidgets`, `changeWidget`, `deleteWidget`, `moveWidget` | no |
| `python mx.py texts [Module\|Module.Doc\|menu] [--missing <lang>]` | Lists translatable texts (page titles, widget captions/texts/labels/placeholders, enumeration captions, show-message and validation feedback texts, validation messages, menu captions) as `where [part]` with their text in every project language; `--missing tr_TR`: only those without Turkish. For `setTranslations` | no |
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

The same lookups also exist as tools of the `mendix` MCP server (in OpenCode: `mendix_find`, in Claude Code:
`mcp__mendix__find`): `find`, `steps`, `widgets`, `texts`, `ops`, `api`, `dryrun`, `gap` and **`plan`**. `plan` takes a short name and the
ops list, saves `edits/<name>.json` and dry-runs it in one call; the server keeps the model loaded, so this takes a
fraction of a second. Use the tool or the command; the result is the same. `apply` and `undo` exist only as commands,
so OpenCode (and Claude Code) asks the user before they run. Commands are lowercase. (Folders exported with
`--no-mcp` have OpenCode tools named `mx_find`, `mx_ops`, ... instead.)

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
| `createModule` | **name**, roles `["RoleName"]` | New module with its domain model, module security and settings (as Studio Pro makes them). Then `addModuleRoles` to give its roles to user roles. A plan that needs a module that does not exist yet starts with this op |
| `createModuleRole` | **module**, **name**, description | |
| `grantAccess` | **document** (microflow, nanoflow or page), **roles** `["Module.Role"]` | Adds to the allowed roles; existing roles stay |
| `addAccessRule` | **entity**, **roles**, access (`ReadWrite`/`ReadOnly`/`None`, default `ReadOnly`), members `{"Attr":"ReadWrite"}`, create, delete, xpath | Every attribute and owned association gets a member right. AutoNumber and calculated attributes are never more than ReadOnly |
| `revokeAccess` | **document**, **roles** | The opposite of `grantAccess` |
| `createUserRole` | **name**, **moduleRoles** `["Module.Role"]`, description, manageAllRoles | Project-level role that users get. Gets its own GUID, checks security. `System.User` / `System.Administrator` are accepted (written by name, as Studio Pro stores them) |
| `addModuleRoles` | **userRole** (e.g. `Administrator`), **moduleRoles** | Typical after a new module role: give it to the user roles that need it |
| `createDemoUser` | **userName**, **userRoles** `["UserRole"]`, entity, password | Entity defaults to the one the other demo users use (`System.User` when there are none). Says so when demo users are off |
| `setSecurity` | level (`Off`/`Prototype`/`Production`), demoUsers, guestRole (`""` = guest access off) | At least one field |

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
| `showHomePage` | | Microflows only |
| `createList` | **variable**, **entity** | An empty list |
| `changeList` | **list**, type (`add`/`remove`/`replace`/`clear`), value (object or list expression; not for clear) | type = add |
| `aggregateList` | **variable**, **list**, **function** (`count`/`sum`/`average`/`minimum`/`maximum`/`all`/`any`), attribute or expression | count takes neither; the others one of them. sum/average need a number attribute, minimum/maximum a number or date, all/any a Boolean. expression uses `$currentObject`, e.g. `$currentObject/Price * $currentObject/Quantity`. `reduce` is refused |
| `listOperation` | **variable**, **operation**, **list**, other, attribute + value, expression, sort, offset, limit | `union`/`intersect`/`subtract`/`equals` (Boolean): other = second list; `contains` (Boolean): other = object; `head`/`tail`; `find` (one object)/`filter` (a list): attribute (or `Module.Assoc`) + value, or expression on `$currentObject`; `sort`: `["Attr", {"attribute":"B","descending":true}]`; `range`: limit, offset (default 0) |
| `validationFeedback` | **variable** (object), **member** (attribute or `Module.Assoc`), **message** (`{1}` = args), args | Text in the default language |
| `rollback` | **variable** (object or list), refresh | refresh = false |
| `callJava` | **javaAction** (`Module.JavaAction`), args `{"Param":"expr"}`, variable | Microflows only. Every required parameter needs an arg (`"empty"` for none); an entity type parameter takes `"Module.Entity"`. variable only when the action returns something. Parameters that take a microflow, mapping or file are refused |
| `callJavaScript` | **jsAction** (`Module.JSAction`), args, variable | Nanoflows only; same rules as `callJava` |
| `callRest` | **url** (`{1}` = urlArgs), urlArgs, method (default `Get`), headers `{"Name":"expr"}`, timeout (s, default 300), body (`{1}` = bodyArgs) or exportMapping + exportObject, response (`none`/`string`/`Module.ImportMapping`), variable, commit | Microflows only. Write the body as plain text, e.g. `{"name": "{1}"}`: braces are escaped for Mendix. response defaults to `string` with variable, else `none`. An import mapping response gets an object or list of the mapping's root entity; commit `yes`/`no`/`withoutEvents` (default). Authentication, proxy, form data and binary bodies: Studio Pro |
| `importWithMapping` | **mapping** (`Module.ImportMapping`), **source** (String variable with JSON/XML), variable, commit | Microflows only. Mappings that take a parameter are refused |
| `exportWithMapping` | **mapping** (`Module.ExportMapping`), **object** (variable to export), **variable** (new String) | Microflows only. The object must be the mapping's root entity |
| `downloadFile` | **variable** (object of a `System.FileDocument` specialization), showInBrowser | Microflows only. showInBrowser = false |
| `cast` | **variable** | Only as the first action of an `ifType` case: the object as that case's entity |
| `metric` | **type** (`counter`/`increment`/`gauge`), **name** (plain text, e.g. `orders.created`), value (counter: default 1; gauge: required), description, tags `{"tag":"expr"}` | Microflows only. First use in a project: check it in Studio Pro |
| `generateDocument` | **template** (`Module.DocumentTemplate`), **variable** (file document), args `{"Widget":"$Var"}`, type (`PDF` default) | Microflows only, and only in projects that already have a Generate document action (document templates are deprecated); otherwise refused |

Flow control (also inside `"actions"`):

| Action | Fields | Notes |
|---|---|---|
| `if` | **condition**, then `[...]`, else `[...]`, caption | A branch may end with `end`, `break` or `continue`; open branches join again after the decision |
| `switch` | **cases** `{"Value": [...], "A, B": [...]}`, value (enumeration expression) or rule + args, enumeration, other `[...]`, empty `[...]`, caption | Enumeration decision: one path per case, `other` for the values not listed, `empty` for no value. Open paths join again |
| `ifType` | **variable** (object), **cases** `{"Module.Specialization": [...]}`, other `[...]`, empty `[...]`, caption | Object type decision. One path per specialization in cases, `other` for any other type (the variable's own entity), `empty` when there is no object. Start a case with `cast` to use the object as that entity. `currentUser` works as variable (`System.User`) |
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
| callJava / callJavaScript | args |
| validationFeedback | message, args |
| rollback | refresh |
| changeList | type, value |
| aggregateList | function, attribute, expression |
| listOperation | value (find/filter on an attribute), expression (find/filter by expression), other, offset, limit |
| callRest | url, urlArgs, method, headers (replaces all), timeout, body, bodyArgs, commit |
| importWithMapping | commit |
| downloadFile | showInBrowser |
| decision (`IF`) | condition, caption |
| object type decision (`IF TYPE OF`) | caption |
| loop | while (while loop), over (list loop) |
| end | value |

Variable names are written without `$` in `variable`, `list`, `other`, `source`, `exportObject`, `from`, `over`,
`item`, `after` and `name`. Expressions are
Mendix expressions as text: `"'Hello'"`, `"$Order/Total * 2"`, `"empty"`, `"[%CurrentDateTime%]"`,
`"Module.Enum.Value"`. String literals need single quotes inside the JSON string.

### Pages and navigation

| Op | Fields | Notes |
|---|---|---|
| `createPage` | **module**, **name**, title, entity, fields `["Attr"]`, buttons (default true), widgets, arrange, menu, layout, folder, roles | Without `widgets`: with `entity` an edit form (page parameter, data view, an input per attribute, Save/Cancel), without `entity` an empty page. With `widgets`: the page content from the widget list below; `entity` is then the default entity of grids and data views. `menu` (`"Responsive"` or `{profile, caption, parent}`) adds a menu item, `roles` lets module roles open the page. The layout is the one the project's own pages use most |
| `addMenuItem` | **page**, profile (default Responsive), caption (default: the page title), parent (caption of an existing menu item) | Only pages without parameters. A page is in a menu once. New items go at the end. A menu item has no roles of its own: it shows for the user roles that may open the page (change that with `grantAccess` / `revokeAccess` on the page). The dry-run line ends with `seen by: <user roles>` |
| `addWidgets` | **page**, **widgets**, into, slot, after, before, entity | Adds `createPage` widgets (list below) to an existing page or snippet. `into`: a container, data view, list view, group box, tab page, the placeholder (`Main`) or a layout grid column `"layoutGrid1/row 1/column 2"`; `"slot": "footer"` = a data view's footer. `after`/`before`: a widget name in that list (default: at the end). Inputs and `{Attribute}` texts use the entity of the data view or list view around them. New names as Studio Pro gives them (`text3`, `actionButton2`). A new data view listens to a grid or list view (`listenTo`, also one already on the page) or shows the page's own parameter; no op adds a page parameter |
| `changeWidget` | **page**, **widget**, caption, text, label, placeholder, editable, visible, class, style, textStyle, buttonStyle, columns, xpath, name, action, onClick, onChange | Only the given fields change. `editable`: true/false, or (inputs) an expression or `{"attribute": "Status", "values": ["Open"]}`; `visible`: true, false, an expression `"$currentObject/Active"` or `{"attribute": ...}`. `columns`: `{"add": [...], "remove": [...]}` of a classic grid or Data grid 2. `name` renames; data views listening to it follow. `action` (a button, also a classic grid button), `onClick` (Data grid 2, gallery) and `onChange` (inputs, selectors, combo box) replace the old action: `{"action": "showPage", "page": ..., "params": ...}`. Texts change in the default language only (the dry run warns about other languages) |
| `deleteWidget` | **page**, **widget** | Deletes the widget with everything in it (also a classic grid column, grid button or tab page). Refused while a data view listens to it or a widget elsewhere refers to it by name |
| `moveWidget` | **page**, **widget**, into, slot, after, before | Same page only. A widget that shows attributes or acts on the object stays in the same data view or list view |
| `setHomePage` | **page** or **microflow**, profile (default Responsive), roles (user roles, e.g. `["Administrator"]`) | Without roles: the default home page. Only pages/microflows without parameters |

Widgets in `"widgets": [ { "widget": "<kind>", ... } ]`, top to bottom. Every widget takes `name` (default as
Studio Pro: `grid1`, `dataGrid2_1`, `dataView1`, ...) and the common fields `visible` (an expression
`"$currentObject/Active"`, or `{"attribute": "Status", "values": ["Open"]}` of the data view / list view / gallery
around it; a Boolean attribute alone = visible when true), `class` and `style` (inline CSS; for `text` and
`actionButton` `style` is the text / button style unless it contains `:`). Inputs, `referenceSelector` and `comboBox`
also take `editable` (true, false or a condition like `visible`). Full field list: `python mx.py ops createPage`.

| Widget | Fields | Notes |
|---|---|---|
| `layoutGrid` | columns `[8, 4]` or `[{"weight": 8, "widgets": [...]}]`, or rows `[{"columns": [...]}]`, width | Weights 1-12 or `"auto"`; `tablet`/`phone` weights per column |
| `container` | widgets, class | |
| `text` | **text**, style (`Text`, `Paragraph`, `H1`-`H6`) | Inside a data view or list view, `{Attribute}` shows the value. `{1}` is refused (a Mendix placeholder). `"widget": "heading"` = a text with style H2 |
| `dataGrid` | entity, source, association, microflow, nanoflow, columns (`"Attr"` or `{attribute, caption, width}`; Data grid 2 also `{dynamicText, caption}` and `{widgets, caption}`), xpath, search, selection (default Single), selectFirst, rows, kind, buttons (classic), onClick (Data grid 2) | Data source: see the source table below; the database source needs a persistable entity, search only with it. `kind`: `classic` (default; search bar), `datagrid2` (a Data grid 2 copied from one on this project's pages; refused when the project has none or its widget differs from `widgets/*.mpk`), `auto` (datagrid2 when possible, else classic; also classic when a column type does not fit a Data grid 2). `width`: whole numbers (weights, 100 in total). Classic `buttons`: `[{"action": "new" \| "edit", "page": ...}, {"action": "delete"}, {"action": "callMicroflow", "microflow": ..., "params": ...}]` (+ caption, style, name); a flow gets the selected row, a List parameter the selected rows (`"selection": "Multi"`); edit is the default (double-click) button; export buttons are refused. Data grid 2: `onClick` (an action, the row is passed), dynamic text columns (`{Attribute}`) and custom content columns (widgets per row; a button that opens a page gets the row mapped, as Studio Pro stores it) |
| `dataView` | entity, source, listenTo, association, microflow, nanoflow, editable (default true), fields, buttons, widgets, footer | Data source: see the source table below. `listenTo`: the name of a grid or list view, or `dataGrid` / `listView` when the page has exactly one (a Data grid 2 needs selection Single). A page parameter (Save/Cancel when editable) only outside list items. An editable data view without a save button (also none in a data view around it) gets a warning |
| `listView` | entity, source, association, microflow, nanoflow, xpath, fields, widgets, pageSize (whole number) | Data source: see the source table below. Each item is an object: inputs, reference selectors and data views (source context) go inside (an editable list). A data view can listen to it |
| `actionButton` | **action** (`save`, `cancel`, `close`, `delete`, `showPage`, `callMicroflow`, `callNanoflow`), caption, page, microflow, nanoflow, params, style, closePage | Without `params` it passes the objects around it (a target whose parameters are all such objects, or none); `params` maps each parameter (table below). save/cancel `closePage` default: true in a parameter data view, false in a listening one (the dashboard stays open; Studio Pro's own default is true). `close` = `closePageButton1` "Close page" |
| `input`, `textBox`, `textArea`, `checkBox`, `datePicker`, `radioButtons`, `dropDown` | **attribute**, label, editable, onChange | Inside a data view or a list view / gallery item; `input` picks the widget by attribute type (an enumeration gets radio buttons, as on Studio Pro's pages) |
| `tabContainer` | **tabs** `[{"caption": "General", "widgets": [...], "name": ...}]` | Tab pages `tabPage1`, ...; addWidgets `into` a tab page by its name |
| `groupBox` | caption, collapsible (`no`/`expanded`/`collapsed`), headerMode (`Div`, `H1`-`H6`), widgets | `{Attribute}` in the caption inside a data view or list view |
| `snippetCall` | **snippet**, params | An existing snippet (`Did you mean`); its object parameters get the objects around it, or `params` |
| `image` | image, association, width, height | `image`: a static image `Module.Collection.Image` (`Did you mean`). Without it: the image of the object around it (data view, list view or gallery of an entity that inherits `System.Image`, or over `association`). Size: pixels `200`, `"50%"` or `"auto"` |
| `referenceSelector` | **association**, attribute, label, xpath, selectableMicroflow, editable, onChange | Inside a data view whose entity owns the reference (`Module.Order_Customer` in a data view of Order); `attribute` of the other entity (default: its first String attribute). `selectableMicroflow`: a microflow that returns the selectable objects (instead of `xpath`) |
| `referenceSetSelector` | **association**, attribute, label, xpath, selectableMicroflow, editable, onChange | Several objects of a reference set the entity around it owns (Studio Pro's input reference set selector) |
| `comboBox` | attribute or association, captionAttribute, label, editable, onChange | Combo box (pluggable) for an enumeration/Boolean attribute or a reference, copied from a Studio Pro-saved combo box of this project whose widget equals `widgets/*.mpk`, every setting back to its default. Otherwise refused with the classic alternative (`referenceSelector`, `dropDown`, `checkBox`) |
| `templateGrid` | entity, source, association, microflow, nanoflow, xpath, widgets (per tile), columns (tiles per row, default 2), rows (default 3), selection, selectFirst, buttons | Classic template grid (as the Studio Pro 10.24 / 11.12 samples store it): tiles with their own widgets (inputs too), control bar `buttons` as `dataGrid`; a data view can listen to it; addWidgets `into` it |
| `gallery` | entity, source, association, microflow, nanoflow, xpath, widgets (per item), selection (default Single), pageSize, columns (desktop 1-12), onClick | Gallery (pluggable), data source as `listView`, copied like `comboBox`; a data view can listen to it (`listenTo`). Without one to copy it is refused: use `listView` |

Data sources (`"source"`; `association` / `microflow` / `nanoflow` alone also pick it). The object around a widget is
the one of the nearest data view or list view / gallery item it sits in (through containers, group boxes, tabs and
layout grids); every level keeps its own object, so lists and data views nest as deep as needed:

| source | on | gives | Notes |
|---|---|---|---|
| `database` (default of lists) | dataGrid, listView, gallery | every object of `entity`, filtered by `xpath` | Inside a data view without `xpath` the dry run suggests `association` when one links the two; `[%CurrentObject%]` in `xpath` shows only committed objects (the dry run says so) |
| `association` | all | over `"association": "Module.Assoc"` from the object around it | Lists: a reference set the object owns, or the reference another entity has to it (`Sales.OrderLine_Order` in a data view of Order gives its lines, new ones too). Data views: a reference the object owns (a path `A/B` of references), or the other side of a one-to-one. The wrong direction is an error that says which widget fits |
| `microflow` / `nanoflow` | all | what `"microflow": "Module.DS_X"` returns | A data view needs one object, a list a list (else an error). Parameters: the objects around it are passed as Studio Pro does (each object parameter must match one of them) |
| `context` (default of a data view inside a list item) | dataView | the object around it | E.g. a data view per list view item; `entity` may be left out |
| `parameter` (default of a data view elsewhere) | dataView | a page parameter of `entity` | Never inside a list item; an existing page gets no new parameter |
| `listen` | dataView | the selected row of `listenTo` | |

Parameters (`"params": { "<Parameter>": "<value>" }` on `actionButton` showPage / callMicroflow / callNanoflow,
`snippetCall`, and data widgets with a microflow / nanoflow source). Parameters left out get the objects around the
widget, as Studio Pro passes them (no mapping is stored); a primitive parameter must be given. Every value is type
checked (entity, also a specialization; object or list); a wrong name is an error that lists the variables here:

| value | is | Notes |
|---|---|---|
| `"$currentObject"` | the object of the nearest data view or list item around it | |
| `"$<dataView>"` | the object of a data view around it, or of one that listens (anywhere on the page) | |
| `"$<grid>.selection"` | the selected row of a grid, list view or gallery | A List parameter needs `"selection": "Multi"`; a Multi selection to an object parameter is an error |
| `"$<Parameter>"` | a page (or snippet) parameter | A new page's parameters are named after their entity |
| any other text | an expression (`"'Open'"`, `"$currentObject/Total * 2"`) | Flow parameters only (a page or snippet parameter of an object takes a variable) |

Actions in `onClick` / `onChange` / changeWidget `action`: `{"action": "showPage" | "callMicroflow" | "callNanoflow" |
"save" | "cancel" | "close" | "delete", "page" / "microflow" / "nanoflow", "params", "closePage"}`; the object around
the widget (the row for onClick) is passed, `params` as above.

Pages may have several parameters (one per data view with source parameter and entity); a button that opens such a
page maps each one.

A grid followed by the data view that listens to it is placed side by side (layout grid 8/4); `"arrange": "rows"`
stacks them. The dry run's `Warnings` start with the grid kind that was used, then lint lines: a grid with 0
columns, a listened classic grid whose selection is None or Multi, an editable data view without a save button,
page roles that are in no user role (with the `addModuleRoles` to fix it), belong to another module or have no
access rule on the shown entity, user roles that will not see the menu item, texts that exist only in the default
language. A wrong or ambiguous `listenTo` is an error that lists the grids and list views on the page.

`xpath` of a grid or list view is checked lightly: it must be in brackets, and the first step of every path must be
an attribute or association of the entity (`Did you mean`). Inside a data view, `'[%CurrentObject%]'` is the data
view's object. Deeper path steps and functions are not checked: look at the page in Studio Pro.

Existing pages and snippets: first `python mx.py widgets Sales.Customer_Edit` (or the `widgets` tool). It prints one
line per widget, indented by nesting: `name  kind, details  [into]  {Entity}`. Use those names in `widget`, `after`,
`before` and `into`; a layout grid column is named by its path (`layoutGrid1/row 1/column 2`). A wrong name is an
error that lists the page's widget names (`Did you mean`). Only what an op touches changes: every other byte of the
page stays as Studio Pro saved it.

Add an input and a button to the data view of an edit page, rename a label, hide a field for closed orders, move a
button, delete a widget, and add a column to a grid:

```json
{ "ops": [
  { "op": "addWidgets", "page": "Sales.Order_Edit", "into": "dataView1", "after": "textBox2",
    "widgets": [ { "widget": "input", "attribute": "Note", "label": "Remark" }, { "widget": "text", "text": "Order {Number}", "style": "H4" } ] },
  { "op": "addWidgets", "page": "Sales.Order_Edit", "into": "dataView1", "slot": "footer",
    "widgets": [ { "widget": "actionButton", "action": "callMicroflow", "microflow": "Sales.ACT_Order_Close", "caption": "Close order" } ] },
  { "op": "changeWidget", "page": "Sales.Order_Edit", "widget": "textBox1", "label": "Order number", "editable": false },
  { "op": "changeWidget", "page": "Sales.Order_Edit", "widget": "textBox3", "visible": { "attribute": "Status", "values": ["Open"] } },
  { "op": "moveWidget", "page": "Sales.Order_Edit", "widget": "actionButton2", "before": "actionButton1" },
  { "op": "deleteWidget", "page": "Sales.Order_Edit", "widget": "datePicker1" },
  { "op": "changeWidget", "page": "Sales.Order_Overview", "widget": "dataGrid1", "columns": { "add": ["Status"], "remove": ["Note"] }, "xpath": "[Status != 'Cancelled']" }
] }
```

Dashboard in a new module: the module with two roles, the entity and its access rules, a user role HR, the new roles
for the existing user roles, and the page (a grid, a read-only detail of the selected row next to it, a menu item):

```json
{ "ops": [
  { "op": "createModule", "name": "EmployeeOnboarding", "roles": ["User", "HR"] },
  { "op": "createEntity", "module": "EmployeeOnboarding", "name": "EmployeeOnboarding", "attributes": [
      { "name": "FullName", "type": "String(200)" }, { "name": "WFH", "type": "Boolean" }, { "name": "FirstDay", "type": "DateTime" },
      { "name": "PhoneModel", "type": "String(200)" }, { "name": "LaptopModel", "type": "String(200)" } ] },
  { "op": "addAccessRule", "entity": "EmployeeOnboarding.EmployeeOnboarding", "roles": ["EmployeeOnboarding.User"], "access": "ReadOnly" },
  { "op": "addAccessRule", "entity": "EmployeeOnboarding.EmployeeOnboarding", "roles": ["EmployeeOnboarding.HR"], "access": "ReadWrite", "create": true, "delete": true },
  { "op": "createUserRole", "name": "HR", "moduleRoles": ["EmployeeOnboarding.HR", "System.User"] },
  { "op": "addModuleRoles", "userRole": "User", "moduleRoles": ["EmployeeOnboarding.User"] },
  { "op": "addModuleRoles", "userRole": "Administrator", "moduleRoles": ["EmployeeOnboarding.HR"] },
  { "op": "createPage", "module": "EmployeeOnboarding", "name": "Dashboard", "entity": "EmployeeOnboarding.EmployeeOnboarding",
    "widgets": [ { "widget": "dataGrid", "columns": ["FullName", "WFH", "FirstDay", "PhoneModel", "LaptopModel"] },
                 { "widget": "dataView", "listenTo": "dataGrid", "editable": false } ],
    "menu": "Responsive", "roles": ["EmployeeOnboarding.User", "EmployeeOnboarding.HR"] }
] }
```

Master-detail: customers in a grid; the selected customer's details and, inside that data view, a list of its orders
(`Sales.Order_Customer` goes from Order to Customer):

```json
{ "ops": [ { "op": "createPage", "module": "Sales", "name": "Customer_Orders", "entity": "Sales.Customer", "roles": ["Sales.User"],
  "widgets": [
    { "widget": "dataGrid", "columns": ["Name", "City"] },
    { "widget": "dataView", "listenTo": "dataGrid", "editable": false, "fields": ["Name", "Email"],
      "widgets": [ { "widget": "text", "text": "Orders", "style": "H4" },
                   { "widget": "listView", "entity": "Sales.Order", "fields": ["Number", "Total"],
                     "xpath": "[Sales.Order_Customer = '[%CurrentObject%]']" } ] } ] } ] }
```

Relational order entry: orders in a grid; the selected order with its customer (over the reference), an editable
list of its lines (an input per line, a data view per line with a product picker whose choices come from a microflow
and an on-change microflow), a grid of the lines with a button that passes the selected lines (Multi selection) to a
microflow, a button that opens a page with two parameters, a data view filled by a nanoflow, and a snippet of the
customer (`Sales.OrderLine_Order` goes from OrderLine to Order, `Sales.Order_Customer` from Order to Customer):

```json
{ "ops": [ { "op": "createPage", "module": "Sales", "name": "Order_Entry", "entity": "Sales.Order", "roles": ["Sales.User"],
  "widgets": [
    { "widget": "dataGrid", "name": "ordersGrid", "columns": ["Number", "Date"],
      "buttons": [ { "action": "new", "page": "Sales.Order_Edit" }, { "action": "edit", "page": "Sales.Order_Edit" }, { "action": "delete" } ] },
    { "widget": "dataView", "name": "orderView", "listenTo": "ordersGrid", "widgets": [
      { "widget": "dataView", "name": "customerView", "association": "Sales.Order_Customer", "editable": false, "fields": ["Name"],
        "widgets": [ { "widget": "snippetCall", "snippet": "Sales.Customer_Card", "params": { "Customer": "$currentObject" } } ] },
      { "widget": "listView", "name": "lineList", "association": "Sales.OrderLine_Order", "widgets": [
        { "widget": "input", "attribute": "Quantity" },
        { "widget": "dataView", "widgets": [
          { "widget": "referenceSelector", "association": "Sales.OrderLine_Product", "attribute": "Name",
            "selectableMicroflow": "Sales.DS_Products_Active",
            "onChange": { "action": "callMicroflow", "microflow": "Sales.OCH_OrderLine_Product" } } ] } ] },
      { "widget": "dataGrid", "name": "lineGrid", "association": "Sales.OrderLine_Order", "selection": "Multi", "columns": ["Quantity", "Price"] },
      { "widget": "actionButton", "action": "callMicroflow", "microflow": "Sales.ACT_OrderLines_Split", "caption": "Split lines",
        "params": { "Lines": "$lineGrid.selection" } },
      { "widget": "actionButton", "action": "showPage", "page": "Sales.Order_Customer_Compare", "caption": "Compare",
        "params": { "Order": "$orderView", "Customer": "$customerView" } },
      { "widget": "dataView", "nanoflow": "Sales.DS_Order_Totals", "params": { "Order": "$orderView" }, "editable": false, "fields": ["Total"] } ],
      "footer": [ { "widget": "actionButton", "action": "save", "closePage": false } ] } ] } ] }
```

Wrong: `"params": { "Customer": "$customerView" }` on a button outside `customerView` (a sibling data view's object is
not reachable; the error lists the variables there), and a data view with `"source": "parameter"` inside `lineList`
(a list item never adds a page parameter).

Tabs, a group box, a snippet, a logo, a reference selector, a combo box, a gallery with its selected item next to it,
and conditional visibility and editability (`Sales.Order_Customer` goes from Order to Customer):

```json
{ "ops": [ { "op": "createPage", "module": "Sales", "name": "Order_Detail", "entity": "Sales.Order", "roles": ["Sales.User"],
  "widgets": [
    { "widget": "image", "image": "Sales.Images.Logo", "width": 120 },
    { "widget": "dataView", "source": "parameter", "widgets": [
      { "widget": "tabContainer", "tabs": [
        { "caption": "General", "widgets": [
          { "widget": "input", "attribute": "Number", "editable": false },
          { "widget": "referenceSelector", "association": "Sales.Order_Customer", "attribute": "Name" },
          { "widget": "comboBox", "attribute": "Status" },
          { "widget": "input", "attribute": "CancelReason", "visible": { "attribute": "Status", "values": ["Cancelled"] } } ] },
        { "caption": "Notes", "widgets": [
          { "widget": "groupBox", "caption": "Internal", "collapsible": "collapsed", "class": "card",
            "widgets": [ { "widget": "input", "attribute": "Note", "editable": "$currentObject/Status != 'Closed'" } ] } ] } ] },
      { "widget": "snippetCall", "snippet": "Sales.OrderFooter" } ] },
    { "widget": "gallery", "entity": "Sales.Product", "columns": 3, "widgets": [ { "widget": "text", "text": "{Name}", "style": "H4" } ] },
    { "widget": "dataView", "listenTo": "gallery", "editable": false, "fields": ["Name", "Price"] } ] } ] }
```

A page in the menu for one role only: the menu item shows for the user roles that may open the page, so give the page
that role and take the others away:

```json
{ "ops": [
  { "op": "grantAccess", "document": "Sales.Order_List", "roles": ["Sales.Manager"] },
  { "op": "revokeAccess", "document": "Sales.Order_List", "roles": ["Sales.User"] },
  { "op": "addMenuItem", "page": "Sales.Order_List", "caption": "Orders" }
] }
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
- Layouts (only pages and snippets are edited), page parameters, page titles, and widgets inside an existing pluggable
  widget (Data grid 2 columns only through `changeWidget` `columns`; a new gallery gets its item widgets when it is
  made) or a template grid.
- `changeWidget`: no change of a data source (other than `xpath`), an input's attribute, design properties, on-enter /
  on-leave events or the visibility by module role. `moveWidget`: within one page; a widget that shows
  attributes stays in its data view or list view. Renaming a widget does not change `$widgetName` in expressions
  (the dry run lists them).
- Template grid: no search fields (the database source gets no search bar). Grid buttons: no export, no inline new rows.
- Widgets other than the ones above: file manager, image uploader, navigation
  list, scroll container, and every other pluggable widget (only Data grid 2, combo box and gallery, each copied from
  a Studio Pro-saved one of this project whose widget equals `widgets/*.mpk`).
- Primitive page parameters (no Studio Pro sample stores one; a mapping to one on an existing page is written with a
  "first use" warning); tab pages with visibility, badges or a default tab; images with an on-click
  action or a default image; design properties (the Atlas toggles); visibility by module role.
- Combo box: only the context source with an enumeration, Boolean or reference (no database / static source, reference
  set, custom content or footer). Gallery: no filters, sorting, empty message or personalization (left empty).
- Data grid 2: no filters, default sorting, export or personalization (left empty); `buttons` are classic only. It needs a Data grid 2 on a page or snippet of this project whose widget equals
  `widgets/*.mpk` (otherwise `kind: datagrid2` is refused; use `classic`).
- Classic data grid: no export buttons and no inline (in-grid) new rows; search only with the database source.
- Data sources: a list over an association takes one association (a longer path: a microflow source or XPath); no
  reverse of a reference set that the other side owns; data views with source context or association have no Studio
  Pro 10/11 sample in the test projects (the dry run says "first use": check them in Studio Pro).
- Buttons: no create-object action, no design properties.
- Menus: web profiles only (native profiles are refused); no reordering, and no op removes a menu item or home page
  (deleting a page that one opens says so).
- Texts (labels, titles, captions, headers, menu captions) given as plain text are written in the default language
  only, as Studio Pro does; the dry run counts the ones other project languages lack. Give them per language
  (`"caption": {"en_US": "Save", "tr_TR": "Kaydet"}`) or translate them later (Languages and translations). Studio
  Pro's own button captions (Save, Cancel, Search, Delete, Close page) also get their Dutch text when the project has nl_NL.
- Attributes inherited from System entities (e.g. `Name` of `Administration.Account`) cannot be shown.

### Languages and translations

| Op | Fields | Notes |
|---|---|---|
| `addLanguage` | **code** (e.g. `tr_TR`), default (true = make it the default language) | Adds the language as Studio Pro does (Settings > Languages). Existing texts keep their languages: list the untranslated ones with `texts --missing tr_TR`. A wrong code gets a did-you-mean (`Turkish`, `tr` -> `tr_TR`) |
| `setTranslations` | **translations** `[{"where", "language", "text"}]`, language (for items without one) | `where` as `texts` lists it: `Module.Page [title]`, `Module.Page.widget [caption\|text\|label\|placeholder\|...]`, `Module.Enumeration.Value`, `Module.Flow.<step id>` (show message / validation feedback), `Module.Entity.Attribute [required\|unique\|maxLength\|range\|regex\|equals]` (validation message), `menu:Responsive/Caption/Sub`. The `[part]` may be left out when the place has one text. `{Attribute}` shows the same value as in the default text. `"text": {"tr_TR": ..., "de_DE": ...}` sets several languages at once |

Per-language texts in every op: wherever an op takes a text (captions, titles, texts, labels, placeholders,
enumeration captions, messages, validation messages, menu captions), it also takes
`{"en_US": "Save", "tr_TR": "Kaydet"}`. A plain string is the default language, as before. The object needs the
default language; every language must be a project language (`addLanguage` first, also earlier in the same file).
Studio Pro stores a translation per language in the text; the order is the order written.

```json
{ "ops": [
  { "op": "addLanguage", "code": "tr_TR" },
  { "op": "createPage", "module": "HR", "name": "Employee_View", "entity": "HR.Employee",
    "title": { "en_US": "Employee", "tr_TR": "Çalışan" },
    "widgets": [ { "widget": "dataView", "widgets": [ { "widget": "text", "text": { "en_US": "Name: {FullName}", "tr_TR": "Ad: {FullName}" } } ] } ] },
  { "op": "setTranslations", "language": "tr_TR", "translations": [
    { "where": "HR.Status.Active", "text": "Aktif" },
    { "where": "HR.Employee.Email [required]", "text": "E-posta gerekli" },
    { "where": "menu:Responsive/Employees", "text": "Çalışanlar" } ] }
] }
```

Pluggable widget texts are listed and translated by path, e.g. `Module.Page.dataGrid1 [columns[2].header]`. Not
supported: removing a language, menu captions of native navigation profiles, system texts (Studio Pro's App >
Language > System texts) and the date/time formats of a language.

### Constants, scheduled events, REST

| Op | Fields | Notes |
|---|---|---|
| `createConstant` | **module**, **name**, **type**, **default**, exposedToClient, folder | Type String/Integer/Long/Decimal/Boolean/DateTime |
| `createScheduledEvent` | **module**, **name**, **microflow**, **every** (`Minute`/`Hour`/`Day`/`Week`), interval, at (`HH:MM`), days, enabled (default false), timeZone, onOverlap, folder | The microflow must have no parameters |
| `publishRest` | **module**, **service**, **resource**, **method**, **microflow**, path (e.g. `{Id}`), servicePath, authentication (default Basic), roles, folder | Microflow parameters become path (`{Name}` in path) or query parameters. Object/list parameters or results need mappings: refused, do those in Studio Pro. Experimental |

### JSON structures and mappings

| Op | Fields | Notes |
|---|---|---|
| `createJsonStructure` | **module**, **name**, **snippet** (JSON text), folder | Elements as Studio Pro derives them: root `Root`, keys capitalized (`orderId` -> `OrderId`, reserved `id`/`class` -> `_id`/`_class`), arrays of objects -> `<Name>Item`, arrays of values -> a wrapper per item, ISO dates -> DateTime, `1.0` -> Decimal, `null` -> Unknown. Uses the first item of each array. Give the snippet as a string |
| `createImportMapping` | **module**, **name**, **jsonStructure**, entity (root), entities `{"json/path":"Module.Entity"}`, attributes `{"json/path/key":"Attr"}`, skip `[paths]`, keys `[paths]`, create, persistable, folder | One entity per JSON object, an attribute per value (the element name), child -> parent associations (`Child_Parent`). Arrays: the item maps straight under its parent (many children). Paths are the JSON keys joined with `/` (`lines/sku`, `[]` may be written). keys: the object is found by those values, else created. Default `create: false`: maps onto existing entities/attributes/associations by name and says "did you mean"; `create: true` creates what is missing (strings unlimited, integers Long). Root arrays are fine |
| `createExportMapping` | same fields, no keys | The root entity is the parameter; nested objects are found over the association. Export over a JSON structure whose root is an array: Studio Pro |

Typical plan: structure, import mapping that creates the entities, export mapping on the same entities, then a flow:

```json
{ "ops": [
  { "op": "createJsonStructure", "module": "Sales", "name": "JSON_Order", "snippet": "{ \"orderId\": 12, \"total\": 10.5, \"lines\": [ { \"sku\": \"A1\", \"qty\": 2 } ] }" },
  { "op": "createImportMapping", "module": "Sales", "name": "IMM_Order", "jsonStructure": "Sales.JSON_Order", "entity": "Sales.OrderIn", "entities": { "lines": "Sales.OrderLineIn" }, "keys": ["orderId"], "create": true },
  { "op": "createExportMapping", "module": "Sales", "name": "EXM_Order", "jsonStructure": "Sales.JSON_Order", "entity": "Sales.OrderIn", "entities": { "lines": "Sales.OrderLineIn" } },
  { "op": "createMicroflow", "module": "Sales", "name": "ACT_Order_Echo", "parameters": [ { "name": "Json", "type": "String" } ], "returns": "String", "returnValue": "$Out",
    "actions": [ { "action": "importWithMapping", "mapping": "Sales.IMM_Order", "source": "Json", "variable": "Order", "commit": "no" },
                 { "action": "exportWithMapping", "mapping": "Sales.EXM_Order", "object": "Order", "variable": "Out" } ] } ] }
```

The export shows a structure as `json/path: Name type` lines and a mapping as `json/path -> Entity via Association [Create/Find/Parameter]`; use those paths in `entities`, `attributes`, `skip`, `keys`. Custom handlers, converters, XML schemas and message definitions: Studio Pro.

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

Lists and aggregates:

```json
{ "ops": [ { "op": "createMicroflow", "module": "Sales", "name": "SUB_Order_Summary",
  "parameters": [ { "name": "Customer", "type": "Sales.Customer" } ], "returns": "Decimal", "returnValue": "$Total",
  "actions": [
    { "action": "retrieve", "variable": "Orders", "entity": "Sales.Order", "xpath": "[Sales.Order_Customer = $Customer]" },
    { "action": "aggregateList", "variable": "Total", "list": "Orders", "function": "sum", "attribute": "Total" },
    { "action": "aggregateList", "variable": "Open", "list": "Orders", "function": "count" },
    { "action": "listOperation", "variable": "Big", "operation": "filter", "list": "Orders", "expression": "$currentObject/Total > 1000" },
    { "action": "listOperation", "variable": "Newest", "operation": "sort", "list": "Big", "sort": [ { "attribute": "Date", "descending": true } ] },
    { "action": "listOperation", "variable": "Top", "operation": "range", "list": "Newest", "limit": "5" },
    { "action": "createList", "variable": "ToMail", "entity": "Sales.Order" },
    { "action": "changeList", "list": "ToMail", "value": "$Top" } ] } ] }
```

REST call, import mapping, Java action and validation feedback (microflow):

```json
{ "ops": [ { "op": "createMicroflow", "module": "Sales", "name": "ACT_Customer_Check",
  "parameters": [ { "name": "Customer", "type": "Sales.Customer" } ],
  "actions": [
    { "action": "callJava", "javaAction": "Sales.JA_ValidateEmail", "args": { "Email": "$Customer/Email" }, "variable": "EmailOk" },
    { "action": "if", "condition": "not($EmailOk)", "then": [
        { "action": "validationFeedback", "variable": "Customer", "member": "Email", "message": "Not a valid e-mail address" },
        { "action": "end" } ] },
    { "action": "callRest", "url": "https://api.example.com/customers/{1}", "urlArgs": ["$Customer/Code"],
      "headers": { "Accept": "'application/json'" }, "timeout": 30, "variable": "Json",
      "onError": { "actions": [ { "action": "log", "message": "lookup failed", "level": "Error" } ] } },
    { "action": "importWithMapping", "mapping": "Sales.IMM_Customer", "source": "Json", "variable": "Remote" },
    { "action": "callRest", "method": "Post", "url": "https://api.example.com/audit", "body": "{\"customer\": \"{1}\"}", "bodyArgs": ["$Customer/Code"], "response": "none" } ] } ] }
```

Object type decision with cast, and a nanoflow with a JavaScript action:

```json
{ "ops": [
  { "op": "createMicroflow", "module": "Sales", "name": "ACT_Party_Open", "parameters": [ { "name": "Party", "type": "Sales.Party" } ],
    "actions": [ { "action": "ifType", "variable": "Party",
      "cases": { "Sales.Company": [ { "action": "cast", "variable": "Company" }, { "action": "showPage", "page": "Sales.Company_Edit", "args": { "Company": "$Company" } } ] },
      "other": [ { "action": "showPage", "page": "Sales.Party_Edit", "args": { "Party": "$Party" } } ],
      "empty": [ { "action": "message", "text": "Nothing selected", "type": "Warning" } ] } ] },
  { "op": "createNanoflow", "module": "Sales", "name": "NF_Order_Remember", "parameters": [ { "name": "Order", "type": "Sales.Order" } ],
    "actions": [ { "action": "callJavaScript", "jsAction": "Sales.JS_SetStorageItem", "args": { "Key": "'lastOrder'", "Value": "$Order/Number" } },
                 { "action": "rollback", "variable": "Order" } ] }
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

Operations cannot do these things: changing layouts, page parameters, button actions or data sources of existing
widgets (pages and snippets take `addWidgets`, `changeWidget`, `deleteWidget`, `moveWidget`), widgets outside the
`createPage` list (template grids, reference set selectors, file managers and pluggable widgets other than a Data
grid 2, combo box or gallery copied from the project), snippet calls with parameters, design properties, import/export mappings,
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
| `no widget 'x' on Module.Page (widgets here: ...)` | Use a listed name; all of them: `python mx.py widgets Module.Page` |
| `shows or uses the object of dataView1` | That widget can move only inside dataView1 (`moveWidget`) |
| `has no page parameter of ...` | `addWidgets` adds no page parameter: give the new data view `listenTo`, or put it in an existing data view |
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
