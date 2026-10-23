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
3. **Write only `edits/<name>.json`** (and `edits/<name>.js` only when scripts are allowed). Never create helper
   scripts (`.js`, `.py`, `.ts`, `.sh`) or any other file elsewhere: not in the export folder, not in the Mendix
   project; no `>` or `tee`. If no operation fits, run `python mx.py gap "<what>"`. The export folder is guarded:
   such writes are denied, and `python mx.py clean` lists files that do not belong there.

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
| `python mx.py usages <Module.Name> [--depth n]` | Who uses a document, entity, attribute, association, enumeration value, constant, role, ...: by name and in expressions/XPath, grouped by document with the place (`widget saveButton`, `step 3f2a9c1b (MicroflowCallAction)`, `widget grid1 column 2`, `Order access rule`). `--depth 2`: also who uses those. **Run it before every `rename`, `delete`, `moveEntity`, `changeMicroflow`** and show the user what will change. Java/JavaScript code is not searched | no |
| `python mx.py unused [Module]` | Documents, entities, attributes and enumeration values nobody references, with the reason (default: the app's own modules). Entry points are not listed (menus, home pages, scheduled events, published services, after-startup, event handlers, flows named in Java/JavaScript code, pages with a URL, toolbox actions, "mark as used"). Only "probably unused": never delete without `usages` and the user's yes | no |
| `python mx.py steps <Module.Flow>` | Lists the steps of a microflow/nanoflow with stable ids (for `changeAction`, `deleteAction`, `addActions` `after`) | no |
| `python mx.py widgets <Module.Page>` | Lists the widget tree of a page or snippet: names, kinds, entity of each data view / list view, and where new widgets can go (`[into]`, layout grid column paths). For `addWidgets`, `changeWidget`, `deleteWidget`, `moveWidget` | no |
| `python mx.py texts [Module\|Module.Doc\|menu] [--missing <lang>]` | Lists translatable texts (page titles, widget captions/texts/labels/placeholders, enumeration captions, show-message and validation feedback texts, validation messages, menu captions) as `where [part]` with their text in every project language; `--missing tr_TR`: only those without Turkish. For `setTranslations` | no |
| `python mx.py ops [name]` | One line per operation; with a name (`ops createPage`, `ops retrieve`): its fields. `ops all`: everything | no |
| `python mx.py api <Type> [word]` | SDK type reference for this Mendix version (for `.js` files only) | no |
| `python mx.py dryrun <file> [--check]` | Computes a change from `edits/<file>`. Writes nothing. Prints an approval code. `--check`: also runs the STUDIO PRO CHECK on a temporary copy with the change (about a minute; errors the change would add are `NEW`) | no |
| `python mx.py rerun [file]` | Dry run a change file again (after an undo). A file gone from `edits/` comes back from the backup | no |
| `python mx.py gap "<what>"` | Records a change no operation can do yet (`edits/gaps.jsonl`). Then give the user Studio Pro steps | no |
| `python mx.py apply <CODE>` | Writes the last dry run, re-exports, lists changed files, runs the STUDIO PRO CHECK (`mx check` on a copy) when Studio Pro / MxBuild is found | **yes** |
| `python mx.py undo [--force]` | Restores the model from before the last apply, then re-exports. Refuses when the model changed after that apply; `--force` only when the user accepts losing the listed changes | **yes** |
| `python mx.py check` | STUDIO PRO CHECK: Mendix's own consistency check (`mx check`, the same as Studio Pro's Errors pane) on a temporary copy of the saved model. Read-only. Lists errors with document names (section 9). Without Studio Pro of the project's version: one line saying how to set `MX_PATH` | no |
| `python mx.py ok "<summary>"` | Saves the current export as the checked state (git commit) | no |
| `python mx.py clean [--move]` | Lists files outside `edits/` that the export did not write (helper scripts, notes, edited export files); `--move` moves them to `edits/stray/<time>/`, nothing is deleted. Every dry run warns when there are such files | no (`--move`: asks) |
| `python mx.py selftest` | Runs every operation on a temporary copy of the project and checks the result | no |
| `python mx.py mergecheck` | After a `git merge` of the app with conflicts in the `.mpr` or `mprcontents/*.mxunit`: per document, which side changed it (resolved automatically) and the **true conflicts** (both sides changed the same document) with what each side changed. Without a merge: checks the `.mpr` unit table against `mprcontents` | no |
| `python mx.py mergefix [--pick "<id or Module.Doc>=ours\|theirs,..."] [--all ours\|theirs]` | Dry run of the merge fix: writes nothing, prints the merged documents and an approval code. Every true conflict needs a side (the other side's change to that document is lost; tell the user to redo it in Studio Pro). Then `python mx.py apply <CODE>` writes the merged unit files and rebuilds the unit table; the user finishes with `git add <app>.mpr mprcontents` and `git commit` | no (apply: **yes**) |

The same lookups also exist as tools of the `mendix` MCP server (in OpenCode: `mendix_find`, in Claude Code:
`mcp__mendix__find`): `find`, `usages`, `unused`, `steps`, `widgets`, `texts`, `ops`, `api`, `dryrun`, `check`, `gap`, `mergecheck` and **`plan`**
(`plan` and `dryrun` take `"check": "yes"` for the STUDIO PRO CHECK of the change). `plan` takes a short name and the
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
| `/senkron` | After pull/merge/branch switch: `python mx.py refresh`, then `python mx.py ok "sync"`. No review. If git reports conflicts in the `.mpr` or `mprcontents`, or the export fails after a merge: `python mx.py mergecheck` first, show the user the true conflicts, ask ours or theirs per document, `python mx.py mergefix --pick ...`, and apply only with the user's code |

---

## 4. Answering questions (read-only)

1. Search first, then read only the files you need. Do not read whole folders.
2. Where to look:

| Question | File |
|---|---|
| Where is document X? | `index/documents.txt` |
| Who calls microflow X? Who uses entity / attribute / page X (exact places)? | `python mx.py usages <Module.X>` (live model), `index/called-by.txt`, `index/call-graph.txt` |
| Who creates, changes or deletes entity X? | `index/entity-usage.txt` |
| Who sets attribute X, which page shows it? | `index/attributes.txt` |
| REST endpoints, scheduled events, event handlers | `index/entry-points.txt` |
| Outgoing REST, e-mail, marketplace modules | `index/external-effects.txt` |
| What can role X do? | `index/security.txt` |
| Where does the text "..." appear? | `index/texts.txt` |
| Dead code | `python mx.py unused [Module]` (with reasons), `index/unused.txt` |
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

Before a `rename`, `delete`, `moveEntity`, `changeMicroflow` or `copyDocument` with `entity`: run
`python mx.py usages <Module.Name>` and put what it lists into the plan (which pages, flows and rules follow).

**Step 2: Write the change file** `edits/<short-name>.json`. Use only operations and fields from section 7
(`python mx.py ops <name>` shows the live fields). Several operations in one file run in order. If no operation
fits, run `python mx.py gap "<what>"` and give the user Studio Pro steps (section 8).

**Step 3: Dry run.**

```
python mx.py dryrun <short-name>
```

- `ERROR:` → read the `HINT:` line, fix the file, run again. After 5 failed tries, stop and show the user the error.
- `XPATH CHECK` / `EXPRESSION CHECK` lines → the dry run refused (no approval code): fix the file and run again
  (section 9 says how). Lines marked `(warning)` alone do not stop it: show them to the user.

**Step 4: Show the result and ask.** Use this format, then stop and wait:

```
PLAN: <1-5 bullets: what changes and why>
DRY RUN: <the numbered op lines and the "Changes:" lines>
ATTENTION: <every DATA LOSS line first, then every XPATH CHECK / EXPRESSION CHECK / NOT STORED / OLD NAME STILL USED / STILL USED BY / Warnings line, or "none">
To apply: close Studio Pro and answer "yes <CODE>".
```

**Step 5: Apply.** Only after the user said yes with that code, and Studio Pro is closed:

```
python mx.py apply <CODE>
```

If it says `does not match the last dry run` or `model changed since the dry run`, go back to step 3.

**Step 6: Report.** Report the `Checked:` (or `CHECK FAILED`) line, the changed export files, and the `STUDIO PRO
CHECK` block (or its one `not run` line). `NEW` errors there are errors this change added: show them, suggest
`python mx.py undo`, fix the change file and dry run again (with `--check`). Fix `OLD NAME` / `STILL USED BY` lines
with a new change (back to step 2). When the check ran without new errors, the "first use" warnings are settled: say
so. Tell the user to open Studio Pro, run the app and then commit (when the check did not run: look at the Errors pane
first). If the result is wrong: the user
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

Then run `python mx.py check` (read-only) and add `ERRORS: <the errors it lists, or "none", or "check not available">`.

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
| `createEntity` | **module**, **name**, persistable (default true), generalization (`Module.Parent`, or `System.FileDocument` / `System.Image` / `System.User`), attributes `[{name, type, default, calculated}]`, documentation | Placed on a free spot of the diagram (no overlap): next to its parent in the same module, and an entity of the same plan moves next to the other end of its first `addAssociation`; else right of the diagram. `color` is refused (Mendix stores none). Boxes that overlap after a plan (also when `addAttribute` makes a box bigger): `DOMAIN LAYOUT` lines in the dry run |
| `arrangeDomainModel` | **module**, mode (`compact` default: rows, boxes at their own size; `grid`: equal cells) | Tidies the module's diagram: every entity a new position, related entities (associations, parent) next to each other, largest group first; the same model always gives the same positions. Only positions change; annotations stay where they are |
| `addAttribute` | **entity**, **name**, **type**, default, calculated (`Module.Microflow`) | Default when not given: Integer/Long/Decimal `0`, Boolean `false`, AutoNumber `1`, others empty. `calculated`: the value comes from the microflow (not stored, no default); it has no parameter or one of the entity and returns the attribute's type (Long/Integer: Integer). Existing access rules get the new member with their "new members" rights |
| `changeAttribute` | **attribute** (`Module.Entity.Attr`), type, default, calculated, stored (`true`) | At least one field. `calculated` makes a stored attribute calculated (`DATA LOSS`: its column is dropped); `"stored": true` stores a calculated one again (existing objects get the default). ReadWrite rights on a now calculated attribute become ReadOnly |
| `addAssociation` | **from**, **to**, name (default `From_To`), type (`Reference`/`ReferenceSet`), owner (`Default`/`Both`), storage (`Table`/`Column`), onDeleteFrom, onDeleteTo (`keep`/`delete`/`prevent`), messageFrom, messageTo | `from` stores the reference: many `from` → one `to` for Reference. Other module in `to` → cross-module association. Storage default: the app's setting (Mendix 11 apps: Column) for a Reference with owner Default, else Table |
| `changeAssociation` | **association**, type, owner, storage, onDeleteFrom, onDeleteTo, messageFrom, messageTo | `onDeleteFrom`: what happens when a `from` (owner) object is deleted: `keep` its `to` objects (default), `delete` them too, or `prevent` the delete while linked (needs `messageFrom`, the text shown). `onDeleteTo` the same for a `to` object. Changing the type prints `DATA LOSS` (ReferenceSet → Reference keeps one link per object). Column storage: Reference with owner Default only (a reference set moves to Table). Owner Both adds the association to the `to` entity's access rules. Rename with `rename`; the two ends cannot change |
| `createViewEntity` | **module**, **name**, **oql**, attributes `[{name, type}]`, folder | Mendix 11+ (Mendix 10 refuses: create it in Studio Pro). A read-only entity whose objects come from the OQL query, with an OQL document of the same name. Every column needs a name (`x.Total * 2 as Twice`); columns that select an attribute (`o.Total as Total`) take its type (AutoNumber → Long), the others need `attributes`. Studio Pro checks the OQL itself when it opens the app |
| `changeViewEntity` | **entity**, **oql**, attributes | New OQL; attributes follow the columns (new ones added, missing ones removed with `STILL USED BY`) |
| `setGeneralization` | **entity**, **generalization** (`Module.Parent` or `"none"`), persistable | Refuses loops. Check access rules and pages of the entity afterwards |
| `addValidationRule` | **entity**, **attribute**, **rule** (`required`/`unique`/`maxLength`/`range`/`regex`/`equals`), **message**, maxLength, min, max, regex, value | |
| `addEventHandler` | **entity**, **moment** (`Before`/`After`), **event** (`Create`/`Commit`/`Delete`/`RollBack`), **microflow**, passObject (default true), raiseErrorOnFalse | The microflow needs one parameter of the entity (when passObject) and must return Boolean for `Before` |
| `addIndex` | **entity**, **attributes** `["A", {"name":"B","ascending":false}]` | |
| `changeValidationRule` | **entity**, **attribute**, rule (which one, when the attribute has several), message, maxLength, min, max, regex, value | Only the values of the rule's own kind (a range rule takes min/max; `null` removes one). Another kind: `deleteValidationRule`, then `addValidationRule` |
| `deleteValidationRule` | **entity**, **attribute**, rule | |
| `deleteEventHandler` | **entity**, moment, event, microflow | Enough of them to name one handler; the microflow stays |
| `changeIndex` | **entity**, **index** (its attributes in order `["A","B"]` or a number, 1 = first), **attributes** (new list as in addIndex) | |
| `deleteIndex` | **entity**, **index** | |
| `createEnumeration` | **module**, **name**, **values** (`["A", {"name":"B","caption":"Bee"}]`), folder | Captions are written in the project's default language |
| `addEnumerationValue` | **enumeration**, **name**, caption (text or `{"en_US": ..., "nl_NL": ...}`), image (`Module.Images.Name`) | |
| `moveEnumerationValue` | **value** (`Module.Enum.Value`), before / after (a value name) or position (1 = first) | The order drop-downs and radio buttons show |
| `changeEnumerationValue` | **value**, caption (text or per language), image (`""` = none) | Rename a value with `rename`. An image on a value: first use, check it in Studio Pro |
| `changeEntity` | **entity**, persistable, documentation, image (`Module.Images.Name`, `""` none) | `persistable: false` drops the table: `DATA LOSS` line. Refused for an entity with a parent (it inherits persistability) or when a persistable entity owns an association to it. `color` is refused (Mendix does not store one) |
| `moveEntity` | **entity**, **module**, roles `{"Old.Role": "New.Role"}` | Moves the entity to another module. Associations it owns move with it (`Old.Assoc` becomes `New.Assoc`; cross-module when the other end stays), associations of other entities to it become cross-module ones (or regular ones when they are in the target module). Access rule roles: `roles`, else the same role name in the target module, else refused. Every reference (by name, expressions, XPath, OQL) is renamed. Data stays (same entity id). Java code that names it is listed in Warnings |

Attribute types: `String(200)`, `String(unlimited)`, `String` (=200), `Integer`, `Long`, `Decimal`, `Boolean`,
`DateTime`, `AutoNumber`, `HashedString`, `Binary`, `Enum(Module.Enumeration)`.
The default of an `Enum` attribute is the value name, e.g. `"default": "Open"`.

### Security

| Op | Fields | Notes |
|---|---|---|
| `createModule` | **name**, roles `["RoleName"]` | New module with its domain model, module security and settings (as Studio Pro makes them). Then `addModuleRoles` to give its roles to user roles. A plan that needs a module that does not exist yet starts with this op |
| `createModuleRole` | **module**, **name**, description | |
| `grantAccess` | **document** (microflow, nanoflow or page), **roles** `["Module.Role"]` | Adds to the allowed roles; existing roles stay |
| `addAccessRule` | **entity**, **roles**, access (`ReadWrite`/`ReadOnly`/`None`, default `ReadOnly`), members `{"Attr":"ReadWrite"}`, create, delete, xpath, newMembers | Every member gets a right, in Studio Pro's order: own attributes, parents' attributes, owned associations (also the `to` side of an owner-Both association). Members of `System.FileDocument`/`System.Image` parents are listed too (`"Name"` or `"System.FileDocument.Name"`; FileID, HasContents, Size, PublicThumbnailPath read-only). `System.User` members (Name, Password, ...) are not part of a specialization's rule (Studio Pro does not list them either): refused with that reason. AutoNumber, calculated and view entity attributes are never more than ReadOnly. `newMembers`: rights of attributes/associations added later (default: access). A view entity rule cannot create/delete |
| `changeAccessRule` | **entity**, **roles** (of the rule), rule (number, when several rules have these roles), setRoles, access, members, newMembers, create, delete, xpath | Changes only the given fields; `access` sets every member not in `members` (and the rights of members added later, unless `newMembers`). `xpath: ""` removes the constraint. XPath must be in brackets. Errors list the rules (`rule 2 [Module.User]`) |
| `deleteAccessRule` | **entity**, **roles**, rule | Says when the roles lose all access to the entity |
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
| `moveAction` | **microflow**, **id**, **after** (`"start"`, a variable, a step id), branch (with a decision: `"true"`, `"false"`, an enumeration value, `"empty"`) | Moves one action or loop (keeps its id), also into a branch or a loop. Refused when the step then uses a variable made after it, or has an error handler |
| `extractMicroflow` | **microflow**, **from** (step id), to (step id, default from), **name**, module, folder | The steps from..to (one line, no decisions or error handlers) go into a new microflow (nanoflow in a nanoflow) that the old place calls. Parameters = the variables they use; returns the one variable they make that is used later (more than one: refused) |
| `addAnnotation` | **microflow**, **text**, to (step id) | A note, attached to a step or free. On a new action use `"note": "text"` instead |
| `formatMicroflow` | **microflow** (also a nanoflow or rule), keepAnnotations (`true`: notes stay put) | Lays the whole flow out again as Studio Pro draws it: main path on one line at the start event's height, branches and error handlers as lanes below, merges after their branches, loops sized to their content, every flow on Studio Pro's sides. Only positions, sizes and flow sides change (steps and ids stay). Formatting twice gives the same result. Use it when LAYOUT CHECK shows errors or the user calls a flow unreadable |
| `createJavaAction` | **module**, **name**, folder, parameters `[{name, type, description, required}]`, returns (default `Boolean`; `Nothing` for none), documentation, exposed `{caption, category}` | Also writes `javasource/<module>/actions/<Name>.java` as Studio Pro generates it. Types: `String`, `Integer`/`Long`, `Decimal`, `Boolean`, `DateTime`, `Module.Entity`, `List(Module.Entity)`, `Enum(Module.Enum)`, `EntityType(T)` (declares type parameter T), `Object(T)`, `List(T)`, `Microflow`. A file that exists keeps its imports, user code and extra code |
| `createJavaScriptAction` | same as `createJavaAction`, platform (`All`/`Web`/`Native`) | Writes `javascriptsource/<module>/actions/<Name>.js`. `Nanoflow` instead of `Microflow` as parameter type |
| `changeMicroflow` | **microflow** (also a nanoflow or rule), addParameters `[{name, type, value}]`, removeParameters `["Name"]`, renameParameters `{"Old": "New"}`, parameterTypes `{"Name": "type"}`, returns, returnValue | Updates every caller found by `usages`: call steps, rule decisions, page buttons, data sources, on-change (`value` = the argument they pass, required when there are callers). The dry run lists `CALLERS UPDATED`. Refused with the list: callers that pass no parameters (scheduled events, menu items, home pages, after-startup), event handlers / calculated attributes, published services and workflows; removing a parameter the flow still uses; `returns` Nothing while a caller uses the result; a new return type for a data source. Renaming a parameter also renames `$Old` in the flow. Rename the flow itself with `rename` |
| `createRule` | **module**, **name**, **returns** (`Boolean` or `Enum(...)`), **returnValue**, parameters, actions, folder, documentation | Rules only read and compute: retrieve, variable, set, aggregateList, listOperation, createList, changeList, if, switch, loop, end. Use it in `if`/`switch` with `"rule"` + `"args"` |

Data types for parameters, variables and returns: `String`, `Integer`, `Long`, `Decimal`, `Boolean`, `DateTime`,
`Module.Entity` (one object), `List(Module.Entity)`, `Enum(Module.Enumeration)`.

Actions (inside `"actions": [ { "action": "<name>", ... } ]`). Every action also takes `caption` and `onError`:

| Action | Fields | Defaults |
|---|---|---|
| `retrieve` | **variable** + either entity, xpath, first, sort, range (database) or from, association (over an association) | first = false (a list). sort `["Attr", {"attribute":"B","descending":true}]`, also over references to one object `"Order_Customer/Name"`; range `{"offset":"0","limit":"10"}` (expressions; not with first). An association retrieve has no sort or range (as in Studio Pro): retrieve from the database with `xpath` or sort with `listOperation` |
| `create` | **variable**, **entity**, set `{"Attr":"expr", "Module.Assoc":"$Var"}`, add, remove, commit | commit = false |
| `change` | **variable**, set, add `{"Module.Assoc":"$Obj or $List"}`, remove, commit, refresh | One of set/add/remove. add/remove change some objects of a reference set the entity owns (set replaces all); a reference (one object) only takes set |
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
| `aggregateList` | **variable**, **list**, **function** (`count`/`sum`/`average`/`minimum`/`maximum`/`all`/`any`), attribute or expression | count takes neither; the others one of them. sum/average need a number attribute, minimum/maximum a number or date, all/any a Boolean. expression uses `$currentObject`, e.g. `$currentObject/Price * $currentObject/Quantity`. `reduce`: initial + expression on `$currentResult` and `$currentObject` (e.g. `$currentResult + $currentObject/Amount`); result type from initial (`0` Integer, `0.0` Decimal, `''` String, `true`, a date, `Module.Enum.Value`, a variable) or `type` |
| `listOperation` | **variable**, **operation**, **list**, other, attribute + value, expression, sort, offset, limit | `union`/`intersect`/`subtract`/`equals` (Boolean): other = second list; `contains` (Boolean): other = object; `head`/`tail`; `find` (one object)/`filter` (a list): attribute (or `Module.Assoc`) + value, or expression on `$currentObject`; `sort`: `["Attr", {"attribute":"B","descending":true}]`; `range`: limit, offset (default 0) |
| `validationFeedback` | **variable** (object), **member** (attribute or `Module.Assoc`), **message** (`{1}` = args), args | Text in the default language |
| `rollback` | **variable** (object or list), refresh | refresh = false |
| `callJava` | **javaAction** (`Module.JavaAction`), args `{"Param":"expr"}`, variable | Microflows only. Every required parameter needs an arg (`"empty"` for none); an entity type parameter takes `"Module.Entity"`. variable only when the action returns something. Parameters that take a microflow, mapping or file are refused |
| `callJavaScript` | **jsAction** (`Module.JSAction`), args, variable | Nanoflows only; same rules as `callJava` |
| `synchronize` | objects (`all` default, `unsynchronized`, or `["Order", "Lines"]` object/list variables) | Nanoflows only, and only in an app with an offline or native navigation profile (else refused). No Studio Pro sample: check it in Studio Pro |
| `callRest` | **url** (`{1}` = urlArgs), urlArgs, method (default `Get`), headers `{"Name":"expr"}`, timeout (s, default 300), body (`{1}` = bodyArgs) or exportMapping + exportObject, response (`none`/`string`/`Module.ImportMapping`), variable, commit | Microflows only. Write the body as plain text, e.g. `{"name": "{1}"}`: braces are escaped for Mendix. response defaults to `string` with variable, else `none`. An import mapping response gets an object or list of the mapping's root entity; commit `yes`/`no`/`withoutEvents` (default). auth `{"user": "@Module.User", "password": "@Module.Password"}` (expressions, basic authentication); proxy `default`/`none`/`{host, port, user, password}`; formData `{"key": "expr"}` or binaryBody `"$File"` instead of body; response `file` + variable (+ fileEntity, default `System.FileDocument`); errorBody false = do not keep the error response in `$latestHttpResponse` |
| `importWithMapping` | **mapping** (`Module.ImportMapping`), **source** (String variable with JSON/XML), variable, commit | Microflows only. Mappings that take a parameter are refused |
| `exportWithMapping` | **mapping** (`Module.ExportMapping`), **object** (variable to export), **variable** (new String) | Microflows only. The object must be the mapping's root entity |
| `downloadFile` | **variable** (object of a `System.FileDocument` specialization), showInBrowser | Microflows only. showInBrowser = false |
| `sendRestRequest` | **operation** (`Module.Service.Operation`), args, query, body, variable | Microflows only. Calls an operation of a consumed REST service, see REST services below |
| `cast` | **variable** | Only as the first action of an `ifType` case: the object as that case's entity |
| `metric` | **type** (`counter`/`increment`/`gauge`), **name** (plain text, e.g. `orders.created`), value (counter: default 1; gauge: required), description, tags `{"tag":"expr"}` | Microflows only. First use in a project: check it in Studio Pro |
| `generateDocument` | **template** (`Module.DocumentTemplate`), **variable** (file document), args `{"Widget":"$Var"}`, type (`PDF` default) | Microflows only, and only in projects that already have a Generate document action (document templates are deprecated); otherwise refused |

Flow control (also inside `"actions"`):

| Action | Fields | Notes |
|---|---|---|
| `if` | **condition** (or rule + args), then `[...]`, else `[...]`, caption | A branch may end with `end`, `break` or `continue`; open branches join again after the decision. `"rule": "Module.Rule", "args": {"Param": "expr"}` decides with a Boolean rule |
| `switch` | **cases** `{"Value": [...], "A, B": [...]}`, value (enumeration expression) or rule + args, enumeration, other `[...]`, empty `[...]`, caption | Enumeration decision: one path per case, `other` for the values not listed, `empty` for no value. Open paths join again |
| `ifType` | **variable** (object), **cases** `{"Module.Specialization": [...]}`, other `[...]`, empty `[...]`, caption | Object type decision. One path per specialization in cases, `other` for any other type (the variable's own entity), `empty` when there is no object. Start a case with `cast` to use the object as that entity. `currentUser` works as variable (`System.User`) |
| `loop` | **actions** + either over (list variable), item (default `<List>Item`) or while (expression) | |
| `end` | value | Required `value` when the flow returns something. Not inside loops |
| `break` / `continue` | | Only inside a loop |
| `error` | | Only inside an `onError` handler: ends with the error again |

`"note": "text"` on any action attaches an annotation to it (see also the op `addAnnotation`). `while` loops:
`{ "action": "loop", "while": "$N < 10", "actions": [...] }` (Mendix 10+; every supported version).

`onError` on an action: `"continue"`, or `{ "rollback": true/false, "actions": [...], "returnValue": "..." }`. A
handler path that does not end gets an end event automatically (`returnValue` when the flow returns something).
Inside a loop a handler must end with `break`, `continue` or `error`.

`changeAction` fields per kind of step:

| Step | Fields |
|---|---|
| any action | caption, disabled |
| retrieve | xpath, first, entity, sort (replaces it; `[]` = none), range (or `"all"`) |
| create / change | set (adds or replaces), unset `["Attr"]`, add, remove (replace the add/remove of that association), commit, refresh |
| commit | events, refresh |
| call | args |
| log | message, level, args |
| message | text, type, blocking |
| variable / set | value |
| callJava / callJavaScript | args |
| validationFeedback | message, args |
| rollback | refresh |
| changeList | type, value |
| aggregateList | function, attribute, expression, initial (reduce; to or from reduce: delete and add again) |
| listOperation | value (find/filter on an attribute), expression (find/filter by expression), other, offset, limit |
| callRest | url, urlArgs, method, headers (replaces all), timeout, body, bodyArgs, commit, auth (or `"none"`), proxy, errorBody |
| importWithMapping | commit |
| downloadFile | showInBrowser |
| decision (`IF`, also an enumeration decision) | condition, caption; a decision that calls a rule (`IF RULE`): args, caption |
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
| `createPage` | **module**, **name**, title, entity, fields `["Attr"]`, buttons (default true), widgets, arrange, menu, layout, folder, roles, url, popupWidth, popupHeight, popupResizable, from, native, variables, design, class, style | `class` / `style`: CSS class(es) and inline CSS of the page itself. `variables` (Mendix 10+): page variables `[{"name": "Search", "type": "String", "default": "''"}]` (types Boolean, Integer, Long, Decimal, String, DateTime, `Enum(Module.E)`; `default` is an expression): an input takes `"variable": "Search"` instead of an attribute (anywhere on the page), expressions, XPath and flow `params` use `$Search`. `design`: design properties of the page itself (Atlas `Form orientation`, `Label width` where the theme has them). `from`: a page template or building block of the project (`"Dashboard_Action_Center"`, its display name or `Module.Name`): its widgets are copied first, data widgets in it stay unconfigured (the dry run lists them), then `widgets`. `native: true`: a native mobile page on the project's NativePhone layout (text, container, actionButton, dataView, listView, inputs; refused without a native layout). `layout` may also be a layout no page uses yet (its placeholder `Main`). Without `widgets`: with `entity` an edit form (page parameter, data view, an input per attribute, Save/Cancel), without `entity` an empty page. With `widgets`: the page content from the widget list below; `entity` is then the default entity of grids and data views. `menu` (`"Responsive"` or `{profile, caption, parent}`) adds a menu item, `roles` lets module roles open the page. The layout is the one the project's own pages use most |
| `createLayout` | **module**, **name**, **from** (a layout), folder | A copy of an existing layout (placeholders, header, sidebar, menu widgets) to change in Studio Pro; `createPage` takes it in `layout` (the content goes in its placeholder `Main`, or its only one). Its own widgets (header, sidebar, menu bar) change with `addWidgets` / `changeWidget` / `moveWidget` / `deleteWidget` and `"page": "Module.Layout"` (`widgets Module.Layout` lists them and its placeholders); a placeholder that pages fill cannot be deleted or renamed (the error lists the pages) |
| `createSnippet` | **module**, **name**, folder, parameters `[{"name":"Order","entity":"Sales.Order"}]`, entity (shorthand: one parameter of it; without widgets a form of it, fields), widgets | Widgets as in `createPage`; a data view with `"source": "parameter"` shows a snippet parameter (no Save/Cancel unless `"buttons": true`). Pages show it with `snippetCall` (parameters from `params` or the objects around it). `addWidgets`/`changeWidget` work on snippets too. A data view on a snippet parameter: first use, check it in Studio Pro |
| `createCrud` | **entity**, module, folder, grid (`auto`/`datagrid2`/`classic`), columns, fields, overview, edit, menu, roles, access | Studio Pro's "Generate overview pages": `<Entity>_NewEdit` (form, Save/Cancel) and `<Entity>_Overview` (a New button + Data grid 2 with Edit/Delete per row when the project can build one, else a classic grid with New/Edit/Delete). `roles` may open both pages and get an access rule on the entity when they have none (`access`: `ReadWrite` default with create/delete, `ReadOnly`, `none`). `menu` adds a menu item to the overview |
| `addMenuItem` | **page** or **microflow**, profile (default Responsive) or menu (a menu document `Module.Menu`), caption (default: the page title), parent (caption or path of an existing item), after / before (a sibling caption), icon | Only pages without parameters. A page is in a menu once. New items go at the end unless after/before. A menu item has no roles of its own: it shows for the user roles that may open the page (change that with `grantAccess` / `revokeAccess` on the page, or `changeMenuItem` roles). The dry-run line ends with `seen by: <user roles>`. `icon`: an icon collection icon `"Atlas_Core.Atlas_Filled.home"`, an image `"Module.Images.Logo"`, a glyph code number (`57377`). With `action` instead of `page`/`microflow`: what the item does, as on `actionButton` (`"signOut"`, `{"action": "openLink", "url": ...}`, `{"action": "callMicroflow", ...}` without object parameters, `create`, `sync` in an offline profile); needs `caption`. A native page (or `"profile": "Native"`) becomes a bottom bar item of the native profile (refused when the project has none: add one in Studio Pro). |
| `addWidgets` | **page**, **widgets**, into, slot, after, before, entity | Adds `createPage` widgets (list below) to an existing page, snippet or layout (a layout: into its content, a container, or a scroll container region with `"slot": "center"` / `"left"` / ...). `into`: a container, data view, list view, group box, tab page, the placeholder (`Main`), a layout grid column `"layoutGrid1/row 1/column 2"`, or a pluggable widget (gallery, Data grid 2, ...) with `slot` = its widget list (`"content"`, `"emptyPlaceholder"`, `"columns 2/content"`; `widgets` lists them); `"slot": "footer"` = a data view's footer. `after`/`before`: a widget name in that list (default: at the end). Inputs and `{Attribute}` texts use the entity of the data view or list view around them. New names as Studio Pro gives them (`text3`, `actionButton2`). A new data view listens to a grid or list view (`listenTo`, also one already on the page) or shows the page's own parameter; no op adds a page parameter |
| `changeWidget` | **page**, **widget**, caption, text, label, placeholder, editable, visible, class, design, style, textStyle, buttonStyle, source, columns, headerFilters, paging, selection, emptyMessage, onClickTrigger, sort, template, export, xpath, name, action, onClick, onChange, onEnter, onLeave, onEnterKeyPress, required, requiredMessage, validation, format, readOnlyStyle, inputMask, maxLength, orientation, labelWidth, showFooter, selectPage, dynamicClass, tabIndex, icon, iconOnly, renderType, tooltip, ariaLabel, ariaRequired, ariaRole, renderMode, screenReaderHidden, alt, verticalAlignment, horizontalAlignment, spacing, weight, tablet, phone | Look and accessibility as in createPage (below): `dynamicClass`, `tabIndex`, a button's `icon` (`"none"` removes it) / `iconOnly` / `renderType` / `tooltip` / `ariaRole`, an input's `ariaLabel` / `ariaRequired`, an image's `alt`, a container's `renderMode` / `onClick` / `screenReaderHidden`. A layout grid row or column is `"widget": "layoutGrid1/row 1"` or `"layoutGrid1/row 1/column 2"` with `class`, `style`, `dynamicClass`, `design`, `verticalAlignment`, a row also `horizontalAlignment`, `spacing`, `visible`, a column `weight` / `tablet` / `phone`. Works on layouts too (`"page": "Module.Layout"`). Inputs: `required` true/false (false removes the validation), `validation`, `format`, `readOnlyStyle`, `inputMask`, `maxLength`, events `onEnter` / `onLeave` / `onEnterKeyPress` (text box) as in createPage; a classic grid column takes `format`; a data view `orientation`, `labelWidth`, `readOnlyStyle`, `showFooter`; a reference (set) selector `selectPage`. `action` takes the whole action model (create, openLink, confirm, progress, pageTitle, ...). Only the given fields change. `design`: Atlas design properties (below); given keys change, `null` removes one. `visible` also `{"roles": ["Module.Role"]}`. `editable`: true/false, or (inputs) an expression or `{"attribute": "Status", "values": ["Open"]}`; `visible`: true, false, an expression `"$currentObject/Active"` or `{"attribute": ...}`. `columns`: `{"add": [...], "remove": [...], "change": [{"column": "Total", "alignment": "right", "width": 120}]}` of a classic grid (width, class) or Data grid 2 (the column settings and `filter` of `dataGrid`). `columns.add` also takes `{"type": "dynamicText", "text": ..., "params": [...]}` and `{"type": "customContent", "widgets": [...]}` (Data grid 2); `columns.change` also `caption`; `columns.move`: `[{"column": "Note", "before": "Number"}]` (or `"after"`, or `"position": 1`) reorders (there is no `moveColumn` op). A gallery's `columns`: `{"desktop": 3, "tablet": 2, "phone": 1}`. `headerFilters` (Data grid 2, gallery): filters to add above it. Lists: `paging` (Data grid 2 / gallery as in createPage; list view and classic grid only `{"pageSize": 20}`), `selection` (Data grid 2 / gallery `Single` / `Multi` / `None`; refused while a data view listens and it is not Single), `emptyMessage` (`""` removes it), `onClickTrigger`, `sort` (replaces the order of a database source; `[]` = none), `template` (list view, gallery, template grid: the new item widgets replace the old ones; refused while a data view listens to one of them), `export` (Data grid 2: an Export to Excel button + nanoflow), `editable` / `onClick` of a list view. `source`: `{"source": "database" \| "microflow" \| "nanoflow" \| "association", "entity", "xpath", "microflow", "nanoflow", "association", "params"}`: columns and item widgets stay when the entity stays (or is a specialization; a database XPath is kept when no new one is given); another entity is refused with what would break (columns, widgets, listening data views): remove them first or add a new list. `name` renames; data views listening to it follow. `action` (a button, also a classic grid button), `onClick` (Data grid 2, gallery) and `onChange` (inputs, selectors, combo box) replace the old action: `{"action": "showPage", "page": ..., "params": ...}`. Texts change in the default language only (the dry run warns about other languages) |
| `changePage` | **page**, title, url, popupWidth, popupHeight, popupResizable, addParameter `{name, type, required}`, removeParameter, renameParameter `{from, to}`, variables, design, class, style, layout | `layout`: another layout; each placeholder's content moves to the placeholder of the same name, empty ones without a counterpart are dropped, and a placeholder with content that the new layout lacks refuses the change (the error lists it and the new placeholders: move that content first). `class` / `style` of the page (`""` = none). `variables`: page variables to add, or to change (same name: new type / default). Page settings and parameters of an existing page. `url`: `"orders"` or `"order/{Order/Id}"` (a parameter's attribute; unique in the app). Parameters only when no caller breaks: a new required parameter is refused while a button, menu item, grid or microflow opens the page (the error lists them; Mendix 11.5+: `"required": false`); `removeParameter` is refused while a widget or the URL uses it, and removes the callers' mappings of it; `renameParameter` keeps callers, widgets and the URL in step. `createPage` takes `url` and the pop-up fields too |
| `convertGrid` | **page**, **widget**, name, strict | A classic data grid becomes a Data grid 2 with the same name (data views listening to it keep listening): data source, XPath, sort, columns (weights as `size`, class), search fields as column filters (or filters above it), selection, rows, buttons: New and buttons without the row in a container above it, Edit / Delete / a flow of the row in an actions column, the default (double-click) button as `onClick`. The dry run lists what is not carried over (formats, aggregates, range search, a flow with a List parameter, a tooltip page, ...); `"strict": true` refuses then. Refused while a widget passes the grid's selection by name (change that first) and without the Data grid 2 .mpk |
| `deleteWidget` | **page**, **widget** | Deletes the widget with everything in it (also a classic grid column, grid button or tab page; on a layout its own widgets). Refused while a data view listens to it or a widget elsewhere refers to it by name, and for a layout placeholder that pages fill |
| `moveWidget` | **page**, **widget**, into, slot, after, before | Same page only. A widget that shows attributes or acts on the object stays in the same data view or list view |
| `setOfflineSync` | **entities** `{"Module.Entity": "all" \| "byXPath" \| "nothing" \| "nothingPreserve" \| "never" \| "online" \| "default" \| {"mode": "byXPath", "xpath": "[...]"}}`, profile | How entities synchronize in the offline profile (Responsive / tablet / phone offline, native): all objects, by XPath, nothing (clear data), nothing (preserve data), never, online; `default` removes the setting. `profile`: needed when the app has several offline profiles. Refused in an app without an offline profile (add one in Studio Pro, App > Navigation) and before Mendix 9.24. System entities (`System.Language`) by name |
| `setHomePage` | **page**, **microflow** or (native) **nanoflow**, profile (default Responsive; `Native`), roles (user roles, e.g. `["Administrator"]`) | Without roles: the default home page. Only pages/flows without parameters. A native page or a nanoflow sets the native profile's home page (refused when the project has no native profile) |
| `changeMenuItem` | **item**, profile or menu, caption, page, microflow, action (`"none"`), icon (`"none"` removes it), roles | `item` = the caption (any language), a path `"Parent/Child"`, or the page/microflow the item opens. Only the given fields change. `caption` as text changes the default language only (per language: `{"en_US": ..., "nl_NL": ...}`). `roles` (module roles) are given to the item's page or microflow, since menu items have no roles of their own |
| `moveMenuItem` | **item**, profile or menu, parent (`""` = top level), after / before (a sibling caption), position (`first` / `last`) | Moves the item with its sub-items: re-order within its parent, or under another item. At most 3 levels; an item cannot go under itself |
| `deleteMenuItem` | **item**, profile or menu | Deletes the item and its sub-items (the dry run lists them) |
| `createMenu` | **module**, **name**, folder, items (`[{"caption", "page" or "microflow", "icon", "items": [...]}]`) | A menu document (`Menus$MenuDocument`), as used by menu bars and navigation trees. Show it with `useMenu` |
| `useMenu` | **document** (layout, page or snippet), widget (the menu widget name; default the only one), menu or profile | Points a menu bar, navigation tree or simple menu bar at a menu document or a navigation profile. On a layout this changes every page that uses it (the dry run says so) |
| `createNavigationProfile` | **kind** (`Responsive`, `Tablet`, `Phone`, `ResponsiveOffline`, `TabletOffline`, `PhoneOffline`), homePage, copyMenu | A web navigation profile for a device type the project does not have yet (one per device type). Home page default: the Responsive one. `copyMenu: true` copies the Responsive menu. Native mobile profiles: Studio Pro |

Widgets in `"widgets": [ { "widget": "<kind>", ... } ]`, top to bottom. Every widget takes `name` (default as
Studio Pro: `grid1`, `dataGrid2_1`, `dataView1`, ...) and the common fields `visible` (an expression
`"$currentObject/Active"`, or `{"attribute": "Status", "values": ["Open"]}` of the data view / list view / gallery
around it; a Boolean attribute alone = visible when true; `{"roles": ["Sales.Manager"]}` = only for users with one of these
module roles, also together with `attribute` / `expression`), `design` (Atlas design properties of the theme's
`themesource/*/web/design-properties.json` for that widget type: `{"Spacing": {"margin-top": "M"}, "Spacing top": "Large",
"Full width": true, "Style": "Primary"}`; a wrong name or option is an error with the valid ones), `class` and `style` (inline CSS; for `text` and
`actionButton` `style` is the text / button style unless it contains `:`), `dynamicClass` (an expression for extra classes,
`"if $currentObject/Active then 'on' else 'off'"`; checked like `visible`, and by EXPRESSION CHECK as a String) and
`tabIndex` (0 = page order, -1 = skipped by Tab). `design` also takes several options of a multi-select property
(`{"Hide on": ["Phone", "Tablet"]}`; `[]` removes it) and a colour of its own on a ColorPicker
(`{"Background color": "#ff0000"}`); older Atlas names are understood. Inputs, `referenceSelector` and `comboBox`
also take `editable` (true, false or a condition like `visible`). Full field list: `python mx.py ops createPage`.

| Widget | Fields | Notes |
|---|---|---|
| `layoutGrid` | columns `[8, 4]` or `[{"weight": 8, "widgets": [...]}]`, or rows `[{"columns": [...]}]`, width | Weights 1-12 or `"auto"`; `tablet`/`phone` weights per column. A row also takes `class`, `style`, `dynamicClass`, `design`, `verticalAlignment` (`none`/`top`/`center`/`bottom`), `horizontalAlignment` (`none`/`left`/`center`/`right`), `spacing` (false = no space between columns), `visible`; a column `class`, `style`, `dynamicClass`, `design`, `verticalAlignment`. Mendix stores no column offset or order per device (refused with the alternative: an empty column, or a class with a CSS `order`) |
| `container` | widgets, class, renderMode, onClick, screenReaderHidden | `renderMode`: the HTML element (`div`, `section`, `article`, `header`, `footer`, `main`, `nav`, `aside`, `hgroup`, `address`); `onClick`: an action as on `actionButton` (the object around it is passed); `screenReaderHidden: true` hides it and its content from screen readers |
| `text` | **text**, style (`Text`, `Paragraph`, `H1`-`H6`), format | Inside a data view or list view, `{Attribute}` shows the value, `{Order_Customer/Name}` one over references. `format` per `{Attribute}`: `{"Total": {"decimals": 2, "groupDigits": true}, "Date": {"date": "dd-MM-yyyy"}}`. `{1}` is refused (a Mendix placeholder). `"widget": "heading"` = a text with style H2 |
| `dataGrid` | entity, source, association, microflow, nanoflow, columns (`"Attr"`, `"Order_Customer/Name"` or `{attribute, caption, width, format}`; Data grid 2 also `{attribute, filter}`, `{type, text, params, widgets, caption}` with the column settings below), xpath, search, sort, selection (default Single), selectFirst, rows, kind, buttons (classic), onClick, onClickTrigger, filters, headerFilters, paging, emptyMessage, selectionMethod, rowClass, configAttribute, export (Data grid 2) | Data grid 2 column types in one field: `{"type": "attribute", "attribute": "Total"}`, `{"type": "dynamicText", "text": "{1} - {2}", "params": ["Number", "Note"]}` (or `"text": "{Number} - {Note}"`), `{"type": "customContent", "widgets": [...]}` (the old `dynamicText` / `widgets` fields still work). Export to Excel per column: `exportValue` (a text with `{Attribute}`), `exportType` `default` / `number` / `date` / `boolean`, `exportNumberFormat` / `exportDateFormat` (a String expression, `"'#,##0.00'"`; only with that type; Data Widgets 3.11+). `paging`: `"loadMore"` or `{"mode": "buttons", "pageSize": 20, "showButtons": "auto", "position": "both", "showTotal": true, "loadMoreCaption": "More", "pageSizeAttribute": "PageSize"}` (`pageSizeAttribute`: an Integer attribute of the data view around it; put an input for it next to the grid = a page size selector; there is no other one). `emptyMessage`: a text when there are no rows. `onClickTrigger`: `single` / `double`. | Columns, `sort` and `search` take attribute paths over references (below). `format` (classic columns; a Data grid 2 shows an attribute column in its own format: use a `dynamicText` column with `format`). Data grid 2 `export`: `true` or `{"caption", "fileName", "sheetName", "headers"}` adds an Export to Excel button in the grid's header and a nanoflow `<Page>_<grid>_Export` that calls `DataWidgets.Export_To_Excel` (as the Data Widgets sample; refused when the project lacks the Data Widgets module). Data source: see the source table below; the database source needs a persistable entity, search and `sort` (`[{"attribute": "Date", "direction": "desc"}, "Name"]`, the default order) only with it. Classic `search`: true or `["Attr"]`. `kind`: `classic` (default; search bar), `datagrid2` (a Data grid 2 built from `widgets/*.mpk` with Studio Pro's defaults; a copy of one on the project's pages when the .mpk cannot be read; refused without the .mpk), `auto` (datagrid2 when possible, else classic; also classic when a column type does not fit a Data grid 2). Data grid 2: `filters: true` puts a text / number / date / drop-down filter (by attribute type, from `widgets/*.mpk`) in every attribute column header (`filter` per column), `paging` `buttons` / `virtualScrolling` / `loadMore`, `selectionMethod` `rowClick` / `checkbox`, `rowClass` an expression, `configAttribute` a String attribute of the data view around it (personalization). `width`: whole numbers (weights, 100 in total). Classic `buttons`: `[{"action": "new" \| "edit", "page": ...}, {"action": "delete"}, {"action": "callMicroflow", "microflow": ..., "params": ...}]` or any action below (+ caption, style, name and the action options; `"maintainSelection": true` keeps the selection after a flow); a flow gets the selected row, a List parameter the selected rows (`"selection": "Multi"`); edit is the default (double-click) button. Data grid 2: `onClick` (an action, the row is passed), dynamic text columns (`{Attribute}`) and custom content columns (widgets per row; a button that opens a page gets the row mapped, as Studio Pro stores it) Data grid 2 column settings (the keys of the installed datagrid .mpk; one this version lacks is refused with what it has): `width` `autoFill` / `autoFit` / `manual` or a number (= manual, that size), `size`, `minWidth` (`auto` / `minContent` / px), `alignment` `left` / `center` / `right`, `hidable` true / false / `"hidden"` (hidden by default), `resizable`, `draggable`, `sortable`, `wrapText`, `visible` (an expression for the whole column), `tooltip` (text with `{Attribute}` of the row), `class` (a fixed cell class) or `columnClass` (an expression per row), `rowEvents`. Column `filter`: `true` (by type; a column over a reference `"Order_Customer/Name"` gets a drop-down of the customers: Data Widgets 3 "Filter by association" as the DataGrid sample, Data grid 2 2.x its column's filter association), `"text"` / `"number"` / `"date"` / `"dropdown"` / `"association"`, or `{"filter": ..., "multiSelect": true, "caption": "Name", "options": "[Active = true()]", "placeholder": ..., "default": ..., "operator": "startsWith"}`. `headerFilters`: filters above the grid (its header), `[{"filter": "text", "attributes": ["Number", "Note"], "placeholder": "Search"}, {"filter": "dropdown", "attribute": "Status"}, {"filter": "association", "association": "Sales.Order_Customer", "caption": "Name", "multiSelect": true}]` (Data Widgets 3: the filter lists its attributes; 2.x: the grid's filter list; association drop-downs above a 2.x grid are refused: use a column). A filter cannot sit elsewhere on the page and filter the grid (Data Widgets links a filter to the grid it is in; nothing is stored for a link) and cannot be bound to a page variable: for a search on a page variable use a `textBox` with `"variable"` and `"xpath": "[contains(Name, $Search)]"`. Classic columns: `width` (a weight) and `class`; Data grid 2 settings on a classic column are refused. |
| `dataView` | entity, source, listenTo, association, microflow, nanoflow, editable (default true), fields, buttons, widgets, footer, orientation, labelWidth, readOnlyStyle, showFooter | `orientation` `horizontal` / `vertical` (stored as label width 0, as Studio Pro does), `labelWidth` 1-11, `readOnlyStyle` `control` / `text`, `showFooter`. `fields` take paths (`"Order_Customer/Name"`: a read-only input). Data source: see the source table below. `listenTo`: the name of a grid or list view, or `dataGrid` / `listView` when the page has exactly one (a Data grid 2 needs selection Single). A page parameter (Save/Cancel when editable) only outside list items. An editable data view without a save button (also none in a data view around it) gets a warning |
| `listView` | entity, source, association, microflow, nanoflow, xpath, fields, widgets, pageSize (whole number), search `["Attr"]`, sort, editable, onClick | `editable: true`: the list view's Editable setting (inputs in its items). `onClick`: an action on an item click (the item is passed). `fields`, `search` and `sort` take paths (`"Order_Customer/Name"`). Data source: see the source table below; `search` (a search box over those attributes) and `sort` with the database source. Each item is an object: inputs, reference selectors and data views (source context) go inside (an editable list). A data view can listen to it |
| `actionButton` | **action** (table below), caption, page, microflow, nanoflow, workflow, params, entity, association, url, email, phone, sms, confirm, progress, progressMessage, abortOnValidationErrors, pageTitle, style, closePage, icon, iconOnly, renderType, tooltip, ariaRole | `icon`: `"glyphicon-pencil"`, an Atlas icon `"mx-icon-add"` (`mx-icon-lined-add` for the lined set; default filled, as Studio Pro's templates), `"Atlas_Core.Atlas_Filled.pencil"`, an image `"Module.Images.Save"` (wrong names: `Did you mean`). `iconOnly: true` leaves the caption empty (give `tooltip`: it is what screen readers and hovering users get). `renderType`: `button` / `link`; `ariaRole`: `Button`, `Link`, `Switch`, ... A button has no aria label in Mendix (refused: the caption or tooltip is read). Without `params` it passes the objects around it (a target whose parameters are all such objects, or none); `params` maps each parameter (table below). save/cancel `closePage` default: true in a parameter data view, false in a listening one (the dashboard stays open; Studio Pro's own default is true). `close` = `closePageButton1` "Close page" |
| `input`, `textBox`, `textArea`, `checkBox`, `datePicker`, `radioButtons`, `dropDown` | **attribute** (or variable), label, editable, onChange, onEnter, onLeave, onEnterKeyPress, required, requiredMessage, validation, format, readOnlyStyle, placeholder, inputMask, maxLength, ariaLabel, ariaRequired | `ariaLabel`: screen reader text (an input without a visible label); `ariaRequired: true` = aria-required. Inputs have no tooltip in Mendix (refused: use `ariaLabel`, `placeholder` or a text next to it). Inside a data view or a list view / gallery item (an input of a page `variable` anywhere); `input` picks the widget by attribute type (an enumeration gets radio buttons, as on Studio Pro's pages). `attribute` may be a path (`"Order_Customer/Name"`): read-only, as Studio Pro shows it, unless `editable` is given. `required: true` (+ `requiredMessage`) = Studio Pro's validation Required (`$value != empty`); `validation: {"expression": "$value > 0", "message": "..."}` a custom one (one of the two). `format`: numbers `{"decimals": 2, "groupDigits": true}` (decimals: Decimal only), dates `{"date": "date" \| "time" \| "dateTime" \| "dd-MM-yyyy HH:mm"}`. `readOnlyStyle` `inherit` / `control` / `text`. Text box / text area: `maxLength` (`"attribute"`, `"unlimited"`, a number), `inputMask` (text box). `onEnter` / `onLeave` (focus), `onEnterKeyPress` (text box): actions as on `actionButton` |
| `dropDownButton` | caption (or icon + iconOnly), **items** `[{"caption": "Edit", "action": ..., ...}]`, buttonStyle, icon, iconOnly, renderType, tooltip | A button that opens a menu; each item has its own action (as on `actionButton`). No Studio Pro sample in the test projects: first use, check it in Studio Pro |
| `tabContainer` | **tabs** `[{"caption": "General", "widgets": [...], "name": ...}]` | Tab pages `tabPage1`, ...; addWidgets `into` a tab page by its name |
| `groupBox` | caption, collapsible (`no`/`expanded`/`collapsed`), headerMode (`Div`, `H1`-`H6`), widgets | `{Attribute}` in the caption inside a data view or list view |
| `snippetCall` | **snippet**, params | An existing snippet (`Did you mean`); its object parameters get the objects around it, or `params` |
| `image` | image, association, width, height, alt | `alt`: alternative text for screen readers. `image`: a static image `Module.Collection.Image` (`Did you mean`). Without it: the image of the object around it (data view, list view or gallery of an entity that inherits `System.Image`, or over `association`). Size: pixels `200`, `"50%"` or `"auto"` |
| `referenceSelector` | **association**, attribute, label, xpath, selectableMicroflow, selectPage, required, requiredMessage, validation, readOnlyStyle, editable, onChange, ariaLabel | Inside a data view whose entity owns the reference (`Module.Order_Customer` in a data view of Order); `attribute` of the other entity (default: its first String attribute; `"Order_Customer/Name"` is the same; a longer path is refused: Studio Pro follows one association). `selectableMicroflow`: a microflow that returns the selectable objects (instead of `xpath`). `selectPage`: a page without parameters that lists the objects to pick (Studio Pro: Select using Page; the dry run warns when it shows no grid of them) |
| `referenceSetSelector` | **association**, attribute, label, xpath, selectableMicroflow, selectPage, readOnlyStyle, editable, onChange | Several objects of a reference set the entity around it owns (Studio Pro's input reference set selector) |
| `comboBox` | attribute or association, captionAttribute, label, editable, onChange | `captionAttribute` may be a path from the other entity (`"City_Country/Name"`). Combo box (pluggable) for an enumeration/Boolean attribute or a reference, built from `widgets/*.mpk` with Studio Pro's defaults (other modes: `pluggable` with `properties`). Without the .mpk refused with the classic alternative (`referenceSelector`, `dropDown`, `checkBox`) |
| `templateGrid` | entity, source, association, microflow, nanoflow, xpath, widgets (per tile), columns (tiles per row, default 2), rows (default 3), selection, selectFirst, buttons, search (true or `["Attr"]`), sort | Classic template grid (as the Studio Pro 10.24 / 11.12 samples store it): tiles with their own widgets (inputs too), control bar `buttons` as `dataGrid`; a data view can listen to it; addWidgets `into` it |
| `gallery` | entity, source, association, microflow, nanoflow, xpath, widgets (per item), selection (default Single), pageSize, columns (desktop 1-12, or `{"desktop": 3, "tablet": 2, "phone": 1}`), paging, emptyMessage, onClick, onClickTrigger, sort, headerFilters (as `dataGrid`) | `paging`, `emptyMessage`, `onClickTrigger` as `dataGrid`. Gallery (pluggable), data source as `listView`, built from `widgets/*.mpk` like `comboBox`; a data view can listen to it (`listenTo`). Without the .mpk it is refused: use `listView` |
| `pluggable` | **type** (widget id or short name: `Datagrid`, `"Data grid 2"`, `Badge`), properties, label, editable | Any pluggable widget of `widgets/*.mpk`, built from its definition exactly as Studio Pro drops it (every property at its default, texts in the project's languages). `python mx.py widgettype` lists the installed widgets, `python mx.py widgettype <name>` their property keys, types, defaults and values. `properties` by type: boolean, number, string, enumeration key (or caption), expression, text with `{Attribute}`, attribute name (of the widget's data source, else of the data view around it), `Module.Assoc`, `Module.Entity`, an image, an action as on `actionButton`, selection `Single`/`Multi`/`None`, data source `"Module.Entity"` or `{entity, xpath}` (the first one also `association` / `microflow` / `nanoflow` + `params`), `widgets` lists (inside the data source's item when linked to it), object lists `[{key: value}]`. Wrong keys and values: error with `Did you mean`. Required properties left empty: a warning. A data view can `listenTo` it when it has a selection set to `Single`. Icons and linked data sources (filters outside a grid): Studio Pro |
| `fileManager` | type (`upload`/`download`/`both`), label, maxFileSize (MB, default 5), allowedExtensions, showInBrowser, editable | In a data view of an entity that inherits `System.FileDocument` (an image entity too) |
| `imageUploader` | label (default "Upload image"), maxFileSize (MB, default 5), allowedExtensions, thumbnail (`"100x75"`), editable | In a data view of an entity that inherits `System.Image` |

Data sources (`"source"`; `association` / `microflow` / `nanoflow` alone also pick it). The object around a widget is
the one of the nearest data view or list view / gallery item it sits in (through containers, group boxes, tabs and
layout grids); every level keeps its own object, so lists and data views nest as deep as needed:

| source | on | gives | Notes |
|---|---|---|---|
| `database` (default of lists) | dataGrid, listView, gallery | every object of `entity`, filtered by `xpath` | Inside a data view without `xpath` the dry run suggests `association` when one links the two; `[%CurrentObject%]` in `xpath` shows only committed objects (the dry run says so) |
| `association` | all | over `"association": "Module.Assoc"` from the object around it | Lists: a reference set the object owns, or the reference another entity has to it (`Sales.OrderLine_Order` in a data view of Order gives its lines, new ones too); a path `"Sales.Order_Customer/Sales.Address_Customer"` whose steps go to one object and the last to many (the addresses of the order's customer); the reverse of a reference set the other side owns (with a "check it in Studio Pro" warning). Data views: a reference the object owns (a path `A/B` of references), or the other side of a one-to-one. The wrong direction is an error that says which widget fits |
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

Actions: one model for `actionButton`, classic grid `buttons`, `onClick` (Data grid 2, gallery), `onChange` /
`onEnter` / `onLeave` / `onEnterKeyPress` (inputs), `addMenuItem` `action` and changeWidget `action`:
`{"action": ..., ...}` (or just `"save"`); the object around the widget (the row for onClick) is passed, `params` as above.

| action | takes | Notes |
|---|---|---|
| `showPage` | **page**, params, pageTitle, closePage | `pageTitle`: a title instead of the page's own (texts per language allowed); `closePage`: true or a number of pages to close first |
| `callMicroflow` / `callNanoflow` | **microflow** / **nanoflow**, params, confirm, progress, progressMessage, abortOnValidationErrors (microflow), maintainSelection (grid buttons) | `confirm`: true, a question, or `{"question", "proceed", "cancel"}`; `progress`: `none` / `nonBlocking` / `blocking` (+ `progressMessage`); `abortOnValidationErrors`: true (default) / `"widget"` / false |
| `create` | **page**, entity, association, pageTitle, closePage | A new object (default entity: the page's parameter entity) shown on `page`; `association` links it to the object of the data view or list item around the button (Studio Pro: Entity (path) over an association, e.g. a new Order in a Customer data view over `Sales.Order_Customer`) |
| `openLink` | one of url, email, phone, sms | A text, or `{"attribute": "Website"}` (also a path) of the object around it |
| `save` / `cancel` / `delete` | closePage | |
| `close`, `signOut` | | |
| `sync` | | Offline apps only: refused without an offline or native navigation profile |
| `callWorkflow` | **workflow**, confirm, closePage | Starts the workflow for the object around the button (its context entity) |

`confirm` and `progress` go with flow calls only (Studio Pro asks only before those; a delete with a question is a
microflow that deletes). `openTask` / `openWorkflow` are refused (they need a data view of a System workflow entity):
call a microflow with `openUserTask` / `openWorkflow`.

Attribute paths: everywhere an attribute is taken (grid and Data grid 2 columns, `fields`, inputs, `sort`, `search`,
Data grid 2 filters, `{...}` in texts, `visible` / `editable` by attribute, selector captions, pluggable attribute
properties linked to a data source, `openLink` attributes) a path over references to one object works:
`"Order_Customer/Name"`, `"Sales.Order_Customer/Name"`, the entity's name `"Customer/Name"` (when one reference
leads there) or several steps `"Order_Customer/Customer_Country/Name"`. They are stored as Studio Pro stores them (an
`AttributeRef` with the association steps). A step to many objects is refused with the list widget that shows them
(`listView` / `dataGrid` with `"source": "association"`); a wrong step or attribute says `Did you mean`. `visible` /
`editable` `{"attribute": "Customer/Active"}` becomes the expression `$currentObject/Sales.Order_Customer/Active` (a
condition by attribute takes the object's own attributes in Studio Pro).

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

A Data grid 2 with filters, default sort and load-more paging, a pluggable widget by its definition, a design
property, a section only managers see, and page settings (`python mx.py widgettype Badge` lists the badge's keys):

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Order_Board", "entity": "Sales.Order", "url": "orders", "roles": ["Sales.User"],
    "widgets": [
      { "widget": "dataGrid", "kind": "datagrid2", "columns": ["Number", "Date", "Total", "Status"], "filters": true,
        "sort": [ { "attribute": "Date", "direction": "desc" } ], "paging": "loadMore", "rowClass": "if $currentObject/Paid then 'paid' else ''" },
      { "widget": "pluggable", "type": "Badge", "properties": { "type": "label", "value": "New" }, "design": { "Spacing top": "Large" } },
      { "widget": "container", "visible": { "roles": ["Sales.Manager"] }, "widgets": [ { "widget": "text", "text": "Manager tools", "style": "H3" } ] } ] },
  { "op": "addWidgets", "page": "Sales.Order_Board", "into": "dataGrid2_1", "slot": "emptyPlaceholder", "widgets": [ { "widget": "text", "text": "No orders" } ] },
  { "op": "changePage", "page": "Sales.Order_Edit", "popupWidth": 600, "popupHeight": 400, "renameParameter": { "from": "Order", "to": "SalesOrder" } }
] }
```

Attribute paths (G1): customer and country columns on an order grid, sorted and searched by customer name, and the
customer's name in the selected order's detail (`Sales.Order_Customer` goes from Order to Customer,
`Sales.Customer_Country` from Customer to Country):

```json
{ "ops": [ { "op": "createPage", "module": "Sales", "name": "Order_Overview2", "entity": "Sales.Order", "widgets": [
    { "widget": "dataGrid", "name": "orders", "columns": ["Number", "Order_Customer/Name", { "attribute": "Customer/Customer_Country/Name", "caption": "Country" }],
      "sort": ["Customer/Name"], "search": ["Customer/Name"] },
    { "widget": "dataView", "listenTo": "orders", "editable": false, "fields": ["Number", "Customer/Name"],
      "widgets": [ { "widget": "text", "text": "Ordered by {Customer/Name}", "visible": { "attribute": "Customer/Active" } } ] } ] } ] }
```

Actions (G2, G9): a new order for the customer on its page (linked over the association), its website from an
attribute, a delete with a question and a progress bar, a page opened with another title, and a sign-out menu item:

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Customer_Card", "entity": "Sales.Customer", "widgets": [
    { "widget": "dataView", "source": "parameter", "fields": ["Name"], "widgets": [
      { "widget": "actionButton", "action": "create", "page": "Sales.Order_Edit", "association": "Sales.Order_Customer", "caption": "New order", "pageTitle": "New order" },
      { "widget": "actionButton", "action": "openLink", "url": { "attribute": "Website" }, "caption": "Website" },
      { "widget": "listView", "association": "Sales.Order_Customer", "widgets": [ { "widget": "text", "text": "{Number}" },
        { "widget": "actionButton", "action": "callMicroflow", "microflow": "Sales.ACT_Order_Delete", "caption": "Delete", "style": "Danger",
          "confirm": { "question": "Delete this order?", "proceed": "Delete", "cancel": "Keep" }, "progress": "blocking", "progressMessage": "Deleting..." } ] } ] } ] },
  { "op": "addMenuItem", "caption": "Sign out", "action": "signOut" }
] }
```

Validation and formats (G3, G5): a required note with its message, a custom check on the total, number and date
formats, a required reference with a select page; then a change on an existing page:

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Order_Form", "entity": "Sales.Order", "widgets": [
    { "widget": "dataView", "source": "parameter", "fields": [], "widgets": [
      { "widget": "textBox", "attribute": "Note", "required": true, "requiredMessage": "Please give a note", "maxLength": 100 },
      { "widget": "textBox", "attribute": "Total", "validation": { "expression": "$value >= 0", "message": "The total cannot be negative" }, "format": { "decimals": 2, "groupDigits": true } },
      { "widget": "datePicker", "attribute": "Date", "required": true, "format": { "date": "dd-MM-yyyy" } },
      { "widget": "referenceSelector", "association": "Sales.Order_Customer", "selectPage": "Sales.Customer_Select", "required": true } ] } ] },
  { "op": "changeWidget", "page": "Sales.Order_Edit", "widget": "textBox2", "required": true, "format": { "decimals": 0 } }
] }
```

Form settings (G6): a vertical, text-style read-only form; then a wider label column on an existing one:

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Order_Summary", "entity": "Sales.Order", "widgets": [
    { "widget": "dataView", "source": "parameter", "editable": false, "orientation": "vertical", "readOnlyStyle": "text", "showFooter": false, "fields": ["Number", "Total"] } ] },
  { "op": "changeWidget", "page": "Sales.Order_Edit", "widget": "dataView1", "orientation": "horizontal", "labelWidth": 4 }
] }
```

Page variables and input events (G8, G10): a search text box bound to a page variable that runs a nanoflow on Enter,
and an input that saves when it loses the focus:

```json
{ "ops": [ { "op": "createPage", "module": "Sales", "name": "Order_Search", "entity": "Sales.Order", "variables": [ { "name": "Query", "type": "String", "default": "''" } ],
  "widgets": [
    { "widget": "textBox", "variable": "Query", "label": "Search", "onEnterKeyPress": { "action": "callNanoflow", "nanoflow": "Sales.NF_Search", "params": { "Text": "$Query" } } },
    { "widget": "dataView", "source": "parameter", "fields": [], "widgets": [ { "widget": "input", "attribute": "Note", "onLeave": "save" } ] } ] } ] }
```

Data grid 2 columns and filters (U4, R1, R2, R4): widths, alignment, a hidden-by-default column, a customer drop-down
in the column over `Order_Customer`, a search box over two attributes above the grid, and a page variable in the XPath:

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Order_Filtered", "variables": [ { "name": "MinTotal", "type": "Decimal", "default": "0" } ],
    "widgets": [
      { "widget": "dataGrid", "kind": "datagrid2", "entity": "Sales.Order", "xpath": "[Total >= $MinTotal]",
        "headerFilters": [ { "filter": "text", "attributes": ["Note", "Reference"], "placeholder": "Search" } ],
        "columns": [ { "attribute": "Number", "width": "autoFit", "alignment": "right", "filter": true },
                     { "attribute": "Order_Customer/Name", "caption": "Customer", "filter": { "multiSelect": true } },
                     { "attribute": "Total", "width": 120, "alignment": "right", "hidable": "hidden", "tooltip": "Total of {Number}" } ] } ] },
  { "op": "changeWidget", "page": "Sales.Order_Overview", "widget": "dataGrid2_1", "columns": { "change": [ { "column": "Total", "alignment": "right", "sortable": false } ] } }
] }
```

Lists on existing pages: column types and order, paging, an empty message, a new data source, a new item template, and a
classic grid turned into a Data grid 2:

```json
{ "ops": [
  { "op": "changeWidget", "page": "Sales.Order_Overview", "widget": "dataGrid2_1",
    "columns": { "add": [ { "type": "dynamicText", "text": "{1} ({2})", "params": ["Number", "Order_Customer/Name"], "caption": "Order", "exportValue": "{Number}" } ],
                 "move": [ { "column": "Total", "position": 1 } ] },
    "paging": { "mode": "loadMore", "pageSize": 25 }, "emptyMessage": "No orders yet" },
  { "op": "changeWidget", "page": "Sales.Order_Overview", "widget": "listView1", "source": { "source": "microflow", "microflow": "Sales.DS_OpenOrders" },
    "template": [ { "widget": "text", "text": "{Number}: {Total}" } ] },
  { "op": "convertGrid", "page": "Sales.Customer_Overview", "widget": "grid1" }
] }
```

Offline sync (only with an offline or native profile), a nanoflow that synchronizes, and a tidy domain model:

```json
{ "ops": [
  { "op": "setOfflineSync", "entities": { "Sales.Order": { "mode": "byXPath", "xpath": "[Sales.Order_Customer/Sales.Customer/Active = true()]" }, "Sales.AuditLog": "never" } },
  { "op": "createNanoflow", "module": "Sales", "name": "NF_SyncOrder", "parameters": [ { "name": "Order", "type": "Sales.Order" } ], "actions": [ { "action": "synchronize", "objects": ["Order"] } ] },
  { "op": "arrangeDomainModel", "module": "Sales", "mode": "compact" }
] }
```

Data grid 2 export (G12) and native navigation (G13; only when the project has a native profile):

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Order_Export", "widgets": [
    { "widget": "dataGrid", "kind": "datagrid2", "entity": "Sales.Order", "columns": ["Number", "Customer/Name", "Total"], "export": { "fileName": "Orders" } } ] },
  { "op": "createPage", "module": "Sales", "name": "Home_Native", "native": true, "widgets": [ { "widget": "text", "text": "Orders" } ], "menu": { "caption": "Home" } },
  { "op": "setHomePage", "page": "Sales.Home_Native" }
] }
```

What pages cannot do yet (use Studio Pro, and `python mx.py gap "<what>"`):
- Layouts: `createLayout` copies one; changing a layout's own widgets and placeholders is Studio Pro. Building blocks /
  page templates are only read (`from`); data widgets copied from them stay unconfigured.
- `changeWidget`: no change of a data view's data source (lists: `source`), an input's attribute, or a pluggable widget's other
  properties (add it again with `pluggable`). `moveWidget`: within one page, not into or
  out of a pluggable widget. Renaming a widget does not change `$widgetName` in expressions (the dry run lists them).
- Page parameters: `changePage` refuses a new required parameter while anything opens the page (optional ones need
  Mendix 11.5+), a removed parameter that a widget or the URL uses; primitive page parameters are not made (use page
  `variables`). Page variables: no removal; a type change is not checked against the widgets that use them.
- Pluggable widgets (`pluggable`): no icon properties, no linked data sources (a filter outside its grid: refused, use `headerFilters`), only the
  first data source takes association / microflow / nanoflow (others: database); Studio Pro's editor hides properties
  by other values, ops does not (a required-but-hidden property only gives a warning). Native widgets of
  `widgets/*.mpk` (on native pages) are refused.
- Data grid 2: export is Excel through the Data Widgets module (`export`; no CSV, refused without Data Widgets; column
  export settings need Data Widgets 3.11+); `buttons` are classic only (`convertGrid` turns them into actions); no page
  size selector of its own (`paging.pageSizeAttribute` + an input); an attribute column has no `format` (use a dynamic text column).
  Gallery: no personalization fields (use `pluggable` properties); filters with `headerFilters`.
- Filters: only in a column or above the grid / gallery (`headerFilters`), never linked from elsewhere on the page or
  to a page variable; an association filter goes over one association; filters over a path column (text filter on
  `Order_Customer/Name`) and the Data grid 2 2.x association filter have no Studio Pro sample: check them.
- Data source XPath may use page variables and parameters (`[contains(Name, $Search)]`; an unknown `$Name` is an
  error with `Did you mean`, a type that does not fit an XPATH CHECK warning); no Studio Pro sample: check it.
- Classic data grid: no export buttons and no inline (in-grid) new rows; search only with the database source; a
  column over a reference set (Studio Pro lists its values) is refused like every to-many path.
- Native pages: only text, container, action button, data view, list view and inputs; no native pluggable widgets.
  Native navigation (bottom bar items, home page) only when the project has a native profile (adding one is Studio
  Pro); bottom bar icons are not set.
- Actions: `openTask` / `openWorkflow` (use a microflow); confirmation, progress bars, select pages, create over an
  association, page title overrides, closing pages first, page variables other than a text box, input masks and
  custom maximum lengths have no Studio Pro sample in the test projects: the dry run says "first use"; check them in
  Studio Pro.
- Tab pages with visibility, badges or a default tab; images with an on-click action or a default image; design
  properties that take several options (`Hide on`) or a custom colour.
- Combo box: only the context source with an enumeration, Boolean or reference (other modes: `pluggable` with
  `properties`).
- Data views with source context or association, list view search attributes, visibility by module role, file
  managers and native pages have no Studio Pro sample in the test projects: the dry run says "first use"; check them
  in Studio Pro.
- Menus: no reordering, and no op removes a menu item, bottom bar item or home page (deleting a page that one opens
  says so).
- Texts (labels, titles, captions, headers, menu captions) given as plain text are written in the default language
  only, as Studio Pro does; the dry run counts the ones other project languages lack. Give them per language
  (`"caption": {"en_US": "Save", "tr_TR": "Kaydet"}`) or translate them later (Languages and translations). Studio
  Pro's own button captions (Save, Cancel, Search, Delete, Close page, Upload image) also get their Dutch text when the
  project has nl_NL.
- Attributes inherited from System entities (e.g. `Name` of `Administration.Account`) cannot be shown.

### Languages and translations

| Op | Fields | Notes |
|---|---|---|
| `addLanguage` | **code** (e.g. `tr_TR`), default (true = make it the default language) | Adds the language as Studio Pro does (Settings > Languages). Existing texts keep their languages: list the untranslated ones with `texts --missing tr_TR`. A wrong code gets a did-you-mean (`Turkish`, `tr` -> `tr_TR`) |
| `setTranslations` | **translations** `[{"where", "language", "text"}]`, language (for items without one) | `where` as `texts` lists it: `Module.Page [title]`, `Module.Page.widget [caption\|text\|label\|placeholder\|...]`, `Module.Enumeration.Value`, `Module.Flow.<step id>` (show message / validation feedback), `Module.Entity.Attribute [required\|unique\|maxLength\|range\|regex\|equals]` (validation message), `menu:Responsive/Caption/Sub`, `system:mendix.signin.username` (system texts: `texts system` lists the keys; `mendix.` may be left out). The `[part]` may be left out when the place has one text. `{Attribute}` shows the same value as in the default text. `"text": {"tr_TR": ..., "de_DE": ...}` sets several languages at once |

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
supported: removing a language, menu captions of native navigation profiles, pluggable widget system texts and the
date/time formats of a language. System texts (App > Language > System texts) are translated by key:

```json
{ "ops": [ { "op": "setTranslations", "language": "tr_TR", "translations": [
  { "where": "system:mendix.signin.username", "text": "Kullanıcı adı" },
  { "where": "system:mendix.signin.password", "text": "Parola" } ] } ] }
```

### App settings, configurations, images

| Op | Fields | Notes |
|---|---|---|
| `setProjectSettings` | afterStartup, beforeShutdown, healthCheck (`Module.Microflow`, `""` = none), hashAlgorithm (`BCrypt`/`SSHA256`), bcryptCost (10..15), roundingMode (`HalfUp`/`HalfEven`), firstDayOfWeek (`Default`/`Sunday`..`Saturday`), defaultTimeZone (e.g. `Europe/Istanbul`, `""` = none) | App > Settings. The microflows have no parameters; after startup returns Boolean, health check returns String. A wrong time zone gets a did-you-mean (`istanbul` -> `Europe/Istanbul`) |
| `setConfiguration` | **name**, applicationRootUrl, constants `{"Module.Constant": "value"}` (`null` = use the default), customSettings `{"Name": "value"}` (`null` = remove) | App > Settings > Configurations. A new name creates a configuration like the first one (without its database password). Database settings: Studio Pro |
| `createImageCollection` | **module**, **name**, folder | |
| `addImage` | **collection**, **file**, name (default the file name), replace | A PNG, JPG or SVG file inside the export folder (e.g. copy it to `edits/logo.png`), at most 2 MB; the kind is read from the content. Use it in a static image widget or button by `Module.Collection.Image` |

### Constants, scheduled events, REST

| Op | Fields | Notes |
|---|---|---|
| `createConstant` | **module**, **name**, **type**, **default**, exposedToClient, folder | Type String/Integer/Long/Decimal/Boolean/DateTime |
| `createScheduledEvent` | **module**, **name**, **microflow**, **every** (`Minute`/`Hour`/`Day`/`Week`), interval, at (`HH:MM`), days, enabled (default false), timeZone, onOverlap, folder | The microflow must have no parameters |
| `changeConstant` | **constant**, default (or value), type, exposedToClient | The value must fit the type. A new type: check configuration values and `@Module.Constant` uses |
| `changeScheduledEvent` | **event**, microflow, every, interval, at, days, enabled, timeZone, onOverlap | A schedule field gives a new schedule of `every` (default: the current kind; what is not given is kept). Start time = `at` |
| `publishRest` | see REST services below | |

### REST services (consumed and published)

No Studio Pro-saved consumed REST service, published REST service with mappings, user task page or workflow exists in
the test projects. These documents are built from the Model SDK metamodel of the project's Mendix version; the dry run
says `first use ... check it in Studio Pro`. Tell the user to open them in Studio Pro once and look at the
error list.

| Op | Fields | Notes |
|---|---|---|
| `createConsumedRestService` | **module**, **name**, **baseUrl**, **operations**, authentication (`"none"` or `{username, password}`; a value `"@Module.Constant"` uses a constant), folder | Mendix 10.1+ REST client document. Each operation: **name**, **path** (`/orders/{id}`, after the base URL), method (default Get), parameters `{"id": "Integer"}` (types of the `{name}` placeholders in path, headers and body; default String), query `["status"]` or `{"page": {"required": false}}` (Mendix 11; on Mendix 10 they go into the path as `?status={status}`, optional ones are refused), headers `{"Name": "value {param}"}`, body (Post/Put/Patch: a text template with `{param}`, or `{snippet, entity, entities, attributes, skip, create}` = an export mapping of one object), response (`"none"`, or `{snippet, entity, entities, attributes, skip, keys, create}` = an import mapping like `createImportMapping`), timeout (s, 300). Added for Studio Pro's rules: `Accept: application/json` on every operation, `Content-Type: application/json` and a `{}` body for Post/Put/Patch without one |
| `addRestOperation` | **service** (`Module.Service`) + the operation fields above | Adds one operation to an existing consumed REST service |
| `publishRest` | **module**, **service**, **resource**, **method**, **microflow**, path (`{Id}`), headers `["Param"]`, importMapping, exportMapping, commit, summary, description, deprecated, create, query, servicePath, version, authentication, roles, folder | Creates the service (version default 1.0.0, shown in its OpenAPI document; authentication default `["Basic"]`) and resource when missing. Microflow parameters: `{Name}` in the path -> path, listed in `headers` -> header, an object/list -> the body (needs `importMapping` of that entity; commit `yes`/`no`/`withoutEvents`, default yes), `System.HttpRequest`/`HttpResponse` -> none, others -> query. An object/list result needs `exportMapping`. `create: true` makes the microflow when it is missing (String parameters from path, headers and `query`, the import mapping's entity, returns String or the export mapping's entity). `roles` may call the service |

Action `sendRestRequest` calls an operation: `{ "action": "sendRestRequest", "operation": "Module.Service.Operation",
"args": { "id": "$Id" }, "query": { "status": "'open'" }, "body": "Order", "variable": "Result" }`. Every `{param}`
needs an arg; required query parameters need a value. `body` only for an operation with a mapping body, `variable`
only for one with a response mapping (an object, or a list for an array). Otherwise the response is in
`$latestHttpResponse` (`$latestHttpResponse/Content`, `$latestHttpResponse/StatusCode`). No `onError` (Studio Pro
does not allow a custom error handler here); use `callRest` when the call needs one.

```json
{ "ops": [
  { "op": "createConsumedRestService", "module": "Sales", "name": "OrderApi", "baseUrl": "https://api.example.com/v1",
    "authentication": { "username": "api", "password": "@Sales.ApiPassword" },
    "operations": [
      { "name": "GetOrder", "path": "/orders/{id}", "parameters": { "id": "Integer" },
        "response": { "snippet": "{ \"number\": \"A1\", \"total\": 10.5 }", "entity": "Sales.RemoteOrder", "create": true } },
      { "name": "CreateOrder", "method": "Post", "path": "/orders", "body": "{ \"number\": \"{number}\" }" } ] },
  { "op": "createMicroflow", "module": "Sales", "name": "ACT_Order_Fetch", "parameters": [ { "name": "Id", "type": "Integer" } ],
    "returns": "Sales.RemoteOrder", "returnValue": "$Order",
    "actions": [ { "action": "sendRestRequest", "operation": "Sales.OrderApi.GetOrder", "args": { "id": "$Id" }, "variable": "Order" } ] }
] }
```

Publish an operation with a body and a result (the mappings first, see JSON structures below):

```json
{ "ops": [
  { "op": "publishRest", "module": "Sales", "service": "OrderService", "resource": "orders", "method": "Post", "path": "{Shop}",
    "microflow": "Sales.PRS_Order_Create", "create": true, "headers": ["Token"], "importMapping": "Sales.IMM_Order",
    "exportMapping": "Sales.EXM_Order", "roles": ["Sales.ApiUser"], "version": "2.0.0" } ] }
```

### Workflows

| Op | Fields | Notes |
|---|---|---|
| `createWorkflow` | **module**, **name**, **context** (a stored `Module.Entity`), **steps**, title, description, dueDate, adminPage, roles, folder | The context is `$WorkflowContext` in every expression (`$WorkflowContext/Amount > 1000`); `$Workflow` is the `System.Workflow`. `roles` may open the task pages and the admin page (workflow security: who sees a task is the step's `assignee`). Steps run top to bottom; the end of the main flow is added (`end1`, and on Mendix 11 a `start1`). Activities get Studio Pro's names (`userTask1`, `decision1`, `parallelSplit1`, `callMicroflow1`, ...) unless the step has `name`. The fields of one step kind: `ops userTask` |
| `createPage` with `"kind": "userTaskPage"` | **module**, **name**, **outcomes** `["Approve","Reject"]`, entity + **workflow** + fields + editable, title, folder, layout, roles | The page a user task opens: parameter `WorkflowUserTask` (`System.WorkflowUserTask`), a data view of it with one Complete-user-task button per outcome and a Close button. With `entity`: the context object read-only (`editable: true` to edit) in a data view inside it, from a new microflow `<Page>_Context` that retrieves the workflow context; `workflow` may be created later in the same plan |

Steps (`{ "step": "<kind>", "name": "optional", ... }`):

| Step | Fields | Notes |
|---|---|---|
| `userTask` | **page** (a user task page), **outcomes** `["Approve","Reject"]` or `{"Approve": [steps], "Reject": [steps]}`, assignee, caption, taskName, description, dueDate, onCreated, autoAssign | assignee: `{"userRoles": ["HRManager"]}` (user roles of the project), `{"xpath": "[...]"}` on the user entity, or `{"microflow": "Module.Flow"}` (parameters: the context or `System.Workflow`; returns a list of users). Without: every user may pick it up. One outcome: no steps of its own (the workflow continues after the task) |
| `decision` | **condition**, **outcomes** `{"true": [...], "false": [...]}` or `{"Module.Enum.Value": [...], "": [...]}` | Boolean: both outcomes are made. Enumeration: one outcome per value and one for no value (`""`), as Studio Pro requires; leave values out to give them no steps |
| `parallelSplit` | **paths** `[[steps], [steps]]` | Two or more paths; the workflow continues when all are done. A path cannot `end` the workflow |
| `callMicroflow` | **microflow**, args `{"Param": "expression"}`, outcomes | The parameter of the context entity gets `$WorkflowContext` (System.Workflow: `$Workflow`). A microflow returning a Boolean or enumeration gets its outcomes (give steps in `outcomes`) |
| `callWorkflow` | **workflow**, context (default `$WorkflowContext`), async | |
| `jumpTo` | **target** (an activity name) | Last step of a branch. Not to an end, jump or start |
| `waitForTimer` | **delay** (DateTime expression) | Mendix 10.6+ |
| `waitForNotification` | | A microflow continues it with `notifyWorkflow` (give the step a `name`) |
| `end` | | Ends the workflow; last step of a user task outcome or decision branch, not in a parallel path |

Workflow actions (in microflows; System variables are written by name, e.g. a parameter of type
`System.WorkflowUserTask` or `System.Workflow`):

| Action | Fields | Notes |
|---|---|---|
| `callWorkflow` | **workflow**, **context** (object variable), variable | Starts the workflow; variable gets the `System.Workflow` |
| `completeUserTask` | **task** (`System.WorkflowUserTask` variable), **outcome** | Studio Pro: Complete user task. The task must be assigned to the current user (open it with `openUserTask`, or a task page) |
| `changeWorkflowState` | **workflow**, **operation** (`abort`/`pause`/`unpause`/`continue`/`restart`/`retry`), reason (abort) | |
| `retrieveWorkflowContext` | **workflow** (`System.Workflow` variable), **definition** (`Module.Workflow`), **variable** | The context object |
| `retrieveWorkflows` | **context**, **variable** | Mendix 10.4+: the workflows of an object (a list) |
| `retrieveActivityRecords` | **workflow**, **variable** | Mendix 10.4+: list of `System.WorkflowActivityRecord` |
| `generateJumpToOptions` | **workflow**, **variable** | A `System.WorkflowJumpToDetails` to pick the jump target in |
| `applyJumpTo` | **details**, variable | Moves the workflow to the chosen option |
| `lockWorkflow` | **workflow** (`Module.Workflow`), unlock, pauseAll | Lock: no new instances (pauseAll pauses running ones); unlock: true (pauseAll resumes them) |
| `notifyWorkflow` | **workflow**, **definition**, **activity** (name of a `waitForNotification` step), variable | variable: Boolean, true when it continued |
| `openUserTask` | **task**, assign (default true) | Opens the task page |
| `openWorkflow` | **workflow** | Opens the workflow admin page |

`retrieve` also follows System associations: `{ "action": "retrieve", "variable": "Wf", "from": "Task", "association":
"System.WorkflowUserTask_Workflow" }`.

```json
{ "ops": [
  { "op": "createPage", "kind": "userTaskPage", "module": "Sales", "name": "Order_Approve_Task", "entity": "Sales.Order",
    "workflow": "Sales.WF_OrderApproval", "fields": ["Number", "Total"], "outcomes": ["Approve", "Reject"], "roles": ["Sales.Manager"] },
  { "op": "createWorkflow", "module": "Sales", "name": "WF_OrderApproval", "context": "Sales.Order", "title": "Order approval",
    "steps": [
      { "step": "userTask", "caption": "Approve order", "page": "Sales.Order_Approve_Task", "assignee": { "userRoles": ["Manager"] },
        "outcomes": { "Approve": [], "Reject": [ { "step": "callMicroflow", "microflow": "Sales.ACT_Order_Reject" }, { "step": "end" } ] } },
      { "step": "decision", "condition": "$WorkflowContext/Total > 1000",
        "outcomes": { "true": [ { "step": "userTask", "page": "Sales.Order_Approve_Task", "outcomes": ["Approve", "Reject"], "assignee": { "userRoles": ["Director"] } } ], "false": [] } },
      { "step": "callMicroflow", "microflow": "Sales.ACT_Order_Confirm" } ] },
  { "op": "createMicroflow", "module": "Sales", "name": "ACT_Order_StartApproval", "parameters": [ { "name": "Order", "type": "Sales.Order" } ],
    "actions": [ { "action": "callWorkflow", "workflow": "Sales.WF_OrderApproval", "context": "Order" } ] }
] }
```

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

The export shows a structure as `json/path: Name type` lines and a mapping as `json/path -> Entity via Association [Create/Find/Parameter]`; use those paths in `entities`, `attributes`, `skip`, `keys`. Custom handlers and converters: Studio Pro. XML schemas and message definitions: see below.

### OData, XML schemas, message definitions

| Op | Fields | Notes |
|---|---|---|
| `publishOData` | **module**, **name**, **entities**, path (default `odata/<name>/v1/`), version (1.0.0), namespace (DefaultNamespace), authentication (`["Basic"]`), roles, associations (default true), summary, description, folder | Mendix 10.4+. Each entity: `"Module.Entity"` or `{entity, exposedName, attributes, key, insert, update, delete, count, topSkip, pageSize}`. key: `"ID"` (default for stored entities) or `["Attr"]` (required for non-stored entities). insert/update/delete: `true` (write to the database) or `"Module.Microflow"`; default read-only. Enumeration attributes publish their enumeration; associations between published entities become navigation properties. Binary and hashed string attributes are left out. Layout as the one Studio Pro sample (TestApp 11.14); check associations, enumerations and write modes in Studio Pro |
| `createXmlSchema` | **module**, **name**, **file** (`.xsd` path, relative to the current or the project folder), folder | Stores the XSD as Studio Pro does. One file only: `xs:import`/`xs:include` are refused |
| `createMessageDefinition` | **module**, **name** (collection), **entity**, definition (default the entity name), attributes, associations `["Module.Assoc"]`, folder | A list of the entity (`<Entity>s` with items `<Entity>`), its attributes (all but binary) and per association the other entity with its attributes. Layout of the Mendix 8.18 sample |
| `createXmlImportMapping` | **module**, **name**, xmlSchema + rootElement, or messageDefinition (`Module.Collection.Definition`), entity, entities, attributes, skip, keys, create, persistable, folder | Like `createImportMapping`, over an XML schema element or a message definition. Paths are the element names joined with `/` from the root: `Order/Line/Sku`. A message definition says its entities (no entity/entities/create). XSD support: sequences/all-groups of elements with built-in types, named and anonymous complex types, repeated complex elements; attributes, choices, extensions and repeated simple elements are refused |
| `createXmlExportMapping` | same fields, no keys | Like `createExportMapping` |
| `consumeODataService`, `consumeWebService`, `createBusinessEvent` | | Not supported: refused with the Studio Pro steps (consumed OData from `$metadata`, consumed SOAP web services from a WSDL, business events). They are contracts Studio Pro reads and keeps in sync |

Mappings over XML schemas have no Studio Pro sample in the test projects: the dry run says to check them in Studio
Pro (if a path does not match, Studio Pro shows an error on the mapping; right-click it and choose to update it).

```json
{ "ops": [
  { "op": "publishOData", "module": "Sales", "name": "SalesOData", "roles": ["Sales.ApiUser"],
    "entities": [ "Sales.Customer", { "entity": "Sales.Order", "insert": true, "update": "Sales.ACT_Order_Update", "pageSize": 500 } ] },
  { "op": "createXmlSchema", "module": "Sales", "name": "XSD_Order", "file": "order.xsd" },
  { "op": "createXmlImportMapping", "module": "Sales", "name": "IMM_OrderXml", "xmlSchema": "Sales.XSD_Order", "rootElement": "Order",
    "entity": "Sales.OrderIn", "entities": { "Order/Line": "Sales.OrderLineIn" }, "create": true },
  { "op": "createMessageDefinition", "module": "Sales", "name": "MD_Orders", "entity": "Sales.Order", "associations": ["Sales.Order_Customer"] },
  { "op": "createXmlExportMapping", "module": "Sales", "name": "EXM_OrdersXml", "messageDefinition": "Sales.MD_Orders.Order" }
] }
```

### Theme files (SCSS)

| Op | Fields | Notes |
|---|---|---|
| `editThemeFile` | **path** (under `theme/` or `themesource/`; `.scss`, `.css`, `.json`), content, edits (`[{"find", "replace", "all"}]`), append | Plain files, not model documents, but the same dry run (it shows a diff), approval code, backup and undo. `find` must match exactly once (or `"all": true`). `content` replaces the whole file or creates it. Refused: paths outside those two folders, a JSON file that would not parse, SCSS whose braces would not balance. Studio Pro compiles `main.scss` of each folder: `@import` a new file there |
| `addCssClass` | **name** (without the dot), **css** (`"color: #fff; padding: 8px"` or an object), file (default `theme/web/main.scss`) | Appends `.name { ... }`. Refused when the file already has a rule for that class. Use the class with `"class": "name"` on a widget |
| `addDesignProperty` | **widgetType** (`Widget`, `DivContainer`, `ActionButton`, `DynamicText`, `LayoutGridRow`, ... or a pluggable widget id), **name**, **type** (`Toggle`, `Dropdown`, `ToggleButtonGroup`, `ColorPicker`), options `[{"name", "class", "css"}]`, class + css (Toggle), multiSelect, description, category, module | A design property of your own in `themesource/<module>/web/design-properties.json` (default: the app module that has a themesource folder) and the rules of its classes in that folder's `main.scss` (Studio Pro compiles it). Later ops of the same change can use it in `design`. Diff in the dry run, backup and undo as for theme files. Refused: an unknown widget type (`Did you mean`), a name the type already has, bad class names |
| `setThemeVariable` | **variables** `{"brand-primary": "#264ae5", "font-family-base": "'Inter', sans-serif", "spacing-medium": "16px"}`, file (default `theme/web/custom-variables.scss`), new | Sets SCSS variables: one already in the file gets the new value (its `!default` and comment kept), an Atlas variable not there yet is added. Values are checked: colours for `brand-*` / `*-color` / `*-bg`, sizes for `*-size` / `spacing-*` / `*-radius` ..., no `;` `{` `}`, balanced brackets. An unknown name is refused with `Did you mean` (`"new": true` for a variable of your own) |

### Marketplace packages (.mpk)

| Op | Fields | Notes |
|---|---|---|
| `importWidget` | **file** (a `.mpk` inside the export folder, e.g. `downloads/Badge.mpk`), replace | Copies a widget package into `widgets/` and reports its widget id, name and type (pluggable or classic, web or native). Refused when that widget is installed already; `"replace": true` swaps the installed package (another version). Studio Pro loads it when the app opens (or F4) |
| `importModulePackage` | **file** (a module `.mpk` inside the export folder) | Adds the module's documents with their own ids (as Studio Pro's *Import module package*) and copies its `javasource/`, `userlib/`, `vendorlib/`, `themesource/` and `widgets/` files. Refused: a module of that name exists (updating a module: Studio Pro), the package is for a newer Mendix version, an older package whose documents this Mendix version stores differently (Studio Pro converts those), files that exist with other contents. Widgets the app has already stay as they are. Put it alone in a change; later changes can use the module |

### Documents, rename and delete

| Op | Fields | Notes |
|---|---|---|
| `moveDocument` | **document**, folder (missing or `""` = module root) | Within the same module |
| `copyDocument` | **document** (page, snippet, layout, microflow, nanoflow, rule, enumeration or entity), name, module, folder, entity `{"Module.Source": "Module.Target"}`, skipUnmatched, roles `{"Old.Role": "New.Role"}`, associations | Copies what Studio Pro stored, with new ids; references inside the copy point to the copy. `entity`: the copy works on Target: attributes and associations by name; names Target lacks are listed and refused, or with `"skipUnmatched": true` the widgets / member changes showing them are left out (not steps or expressions: refused). In another module the module roles map by `roles`, else by the same role name, else refused. An entity copy takes its attributes, validation rules, access rules, indexes and event handlers; `"associations": true` also the associations it owns. A page URL is not copied. Ops after it in the same file cannot change the copy: put them in a second change |
| `rename` | **target** (qualified name, or a module name), **newName** | Run `usages` first. Updates every reference (flow parameters too: callers' mappings follow). A module rename also updates `Module.` in expressions and XPath and lists code folders to move. Other renames report old names left in expressions, XPath and Java (`OLD NAME STILL USED`) |
| `delete` | **target** | Run `usages` first (and `unused` to find candidates). Deletes a document (also a constant, scheduled event, snippet), entity, attribute, association, enumeration value or module role. Lists documents that still use it (`STILL USED BY`). Not by name: validation rules `deleteValidationRule`, event handlers `deleteEventHandler`, indexes `deleteIndex`, access rules `deleteAccessRule`, widgets `deleteWidget`, flow steps `deleteAction` |

### Examples

Domain model details: a calculated attribute, an association that deletes its lines and refuses to delete a
customer with orders, a view entity, and access rules (with a System.Image specialization):

```json
{ "ops": [
  { "op": "createMicroflow", "module": "Sales", "name": "CAL_Order_Total", "parameters": [ { "name": "Order", "type": "Sales.Order" } ], "returns": "Decimal", "returnValue": "$Order/Amount * 1.2" },
  { "op": "addAttribute", "entity": "Sales.Order", "name": "TotalVat", "type": "Decimal", "calculated": "Sales.CAL_Order_Total" },
  { "op": "changeAssociation", "association": "Sales.OrderLine_Order", "onDeleteTo": "delete" },
  { "op": "changeAssociation", "association": "Sales.Order_Customer", "onDeleteTo": "prevent", "messageTo": { "en_US": "This customer still has orders", "tr_TR": "Bu müşterinin siparişleri var" } },
  { "op": "createViewEntity", "module": "Sales", "name": "CustomerTotals", "oql": "from Sales.Order as o\nselect o/Sales.Order_Customer/Sales.Customer/Name as Customer, sum(o.Amount) as Total\ngroup by o/Sales.Order_Customer/Sales.Customer/Name", "attributes": [ { "name": "Customer", "type": "String(200)" }, { "name": "Total", "type": "Decimal" } ] },
  { "op": "createEntity", "module": "Sales", "name": "ProductPhoto", "generalization": "System.Image" },
  { "op": "addAccessRule", "entity": "Sales.ProductPhoto", "roles": ["Sales.User"], "access": "ReadWrite", "create": true, "members": { "Name": "ReadOnly" } },
  { "op": "changeAccessRule", "entity": "Sales.Order", "roles": ["Sales.User"], "xpath": "[Sales.Order_Owner = '[%CurrentUser%]']", "members": { "Amount": "ReadOnly" }, "delete": false, "newMembers": "None" },
  { "op": "deleteAccessRule", "entity": "Sales.Order", "roles": ["Sales.Guest"] }
] }
```

App settings, a test configuration, an image:

```json
{ "ops": [
  { "op": "setProjectSettings", "afterStartup": "Sales.ASU_Startup", "healthCheck": "Sales.HC_Database", "firstDayOfWeek": "Monday", "defaultTimeZone": "Europe/Istanbul", "roundingMode": "HalfEven" },
  { "op": "setConfiguration", "name": "Test", "applicationRootUrl": "https://test.example.com/", "constants": { "Sales.ApiUrl": "https://api-test.example.com" }, "customSettings": { "ClientRequestTimeout": "60000" } },
  { "op": "createImageCollection", "module": "Sales", "name": "Images" },
  { "op": "addImage", "collection": "Sales.Images", "file": "edits/logo.png" }
] }
```

Sorted top 10 and a reference set: the ten largest orders (by total, then customer name), the newest one, and tags
added to an order:

```json
{ "ops": [
  { "op": "createMicroflow", "module": "Sales", "name": "ACT_TopOrders", "parameters": [ { "name": "Tags", "type": "List(Sales.Tag)" } ], "returns": "List(Sales.Order)", "returnValue": "$Top", "actions": [
    { "action": "retrieve", "variable": "Top", "entity": "Sales.Order", "xpath": "[Status = 'Open']", "sort": [ { "attribute": "Total", "descending": true }, "Order_Customer/Name" ], "range": { "offset": "0", "limit": "10" } },
    { "action": "retrieve", "variable": "Newest", "entity": "Sales.Order", "first": true, "sort": [ { "attribute": "CreatedDate", "descending": true } ] },
    { "action": "change", "variable": "Newest", "add": { "Sales.Order_Tag": "$Tags" }, "commit": true } ] }
] }
```

Generated pages, a snippet, and changing what is there (a constant, a schedule, a rule, an index, an enumeration):

```json
{ "ops": [
  { "op": "createCrud", "entity": "Sales.Customer", "roles": ["Sales.User"], "menu": "Responsive" },
  { "op": "createSnippet", "module": "Sales", "name": "CustomerCard", "entity": "Sales.Customer", "fields": ["Name", "Email"] },
  { "op": "changeConstant", "constant": "Sales.ApiUrl", "default": "https://api.example.com/v2", "exposedToClient": false },
  { "op": "changeScheduledEvent", "event": "Sales.SE_Cleanup", "every": "Day", "at": "03:00", "enabled": true },
  { "op": "changeValidationRule", "entity": "Sales.Order", "attribute": "Total", "rule": "range", "max": 100000, "message": "At most 100000" },
  { "op": "deleteEventHandler", "entity": "Sales.Order", "moment": "Before", "event": "Commit" },
  { "op": "changeIndex", "entity": "Sales.Order", "index": ["Number"], "attributes": ["Number", { "name": "CreatedDate", "ascending": false }] },
  { "op": "moveEnumerationValue", "value": "Sales.OrderStatus.Cancelled", "position": 1 },
  { "op": "changeEnumerationValue", "value": "Sales.OrderStatus.Open", "caption": { "en_US": "Open", "tr_TR": "Açık" } }
] }
```

Add a parameter to a microflow that a page button and another microflow call (both get `'web'`), and rename
one ($Order in the flow follows):

```json
{ "ops": [ { "op": "changeMicroflow", "microflow": "Sales.ACT_Order_Submit", "addParameters": [ { "name": "Channel", "type": "String", "value": "'web'" } ], "renameParameters": { "Order": "SalesOrder" } } ] }
```

Copy a page for another entity (attributes by name), a microflow into another module, and move an entity:

```json
{ "ops": [
  { "op": "copyDocument", "document": "Sales.Order_Edit", "name": "Invoice_Edit", "entity": { "Sales.Order": "Sales.Invoice" } },
  { "op": "copyDocument", "document": "Sales.ACT_Order_Submit", "module": "Billing", "roles": { "Sales.User": "Billing.User" } },
  { "op": "changeEntity", "entity": "Sales.OrderDraft", "persistable": false, "documentation": "Only on screen" },
  { "op": "moveEntity", "entity": "Sales.Invoice", "module": "Billing", "roles": { "Sales.User": "Billing.User" } }
] }
```

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

Rule, enumeration switch and reduce:

```json
{ "ops": [
  { "op": "createRule", "module": "Sales", "name": "RUL_Order_IsLarge", "parameters": [ { "name": "Order", "type": "Sales.Order" } ],
    "returns": "Boolean", "returnValue": "$Order/Total > 1000" },
  { "op": "createMicroflow", "module": "Sales", "name": "ACT_Order_Route", "parameters": [ { "name": "Order", "type": "Sales.Order" } ],
    "actions": [
      { "action": "if", "rule": "Sales.RUL_Order_IsLarge", "args": { "Order": "$Order" }, "then": [ { "action": "log", "message": "large order" } ] },
      { "action": "switch", "value": "$Order/Status", "cases": { "Open": [ { "action": "log", "message": "open", "note": "still to pay" } ], "Paid, Cancelled": [ { "action": "log", "message": "done" } ] },
        "empty": [ { "action": "log", "message": "no status" } ] },
      { "action": "retrieve", "variable": "Lines", "entity": "Sales.OrderLine", "xpath": "[Sales.OrderLine_Order = $Order]" },
      { "action": "aggregateList", "variable": "Codes", "list": "Lines", "function": "reduce", "initial": "''", "expression": "$currentResult + $currentObject/Code + ';'" } ] } ] }
```

Java action with its file, a REST call with authentication and form data, then restructuring (ids from `steps`):

```json
{ "ops": [
  { "op": "createJavaAction", "module": "Sales", "name": "JA_Order_Sign", "parameters": [ { "name": "Order", "type": "Sales.Order" }, { "name": "Key", "type": "String" } ],
    "returns": "String", "exposed": { "caption": "Sign order", "category": "Sales" } },
  { "op": "addActions", "microflow": "Sales.ACT_Order_Close", "actions": [
      { "action": "callRest", "method": "Post", "url": "{1}/sign", "urlArgs": ["@Sales.ApiUrl"], "auth": { "user": "@Sales.ApiUser", "password": "@Sales.ApiPassword" },
        "formData": { "order": "toString($Order/Number)" }, "timeout": 30, "response": "string", "variable": "Signed" } ] },
  { "op": "moveAction", "microflow": "Sales.ACT_Order_Close", "id": "3f2a9c1b", "after": "7c0d11e2", "branch": "true" },
  { "op": "extractMicroflow", "microflow": "Sales.ACT_Order_Close", "from": "5b6e0a7d", "to": "9e8f1c2a", "name": "SUB_Order_Totals" }
] }
```

Lay out a messy flow again and draw it before/after (`"preview": true`, or `run ... --preview`):

```json
{ "preview": true, "ops": [
  { "op": "formatMicroflow", "microflow": "Sales.ACT_Order_Close" }
] }
```

Layout of edits: new steps go where the anchor is (on the main line, in the branch lane, inside the loop); only
what follows them moves right, a loop grows (width and height, up to the outermost loop) round what is put in it,
objects in the way are pushed aside, a note attached to a step moves with it, parameters and free notes stay.
`deleteAction`, `moveAction` and `extractMicroflow` close the gap again.

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

Menus and navigation: re-order the Responsive menu, rename an item in two languages, a menu document shown by the
phone layout's menu bar, and a phone profile:

```json
{ "ops": [
  { "op": "moveMenuItem", "item": "Orders", "position": "first" },
  { "op": "moveMenuItem", "item": "Reports/Monthly", "parent": "Orders", "after": "Open orders" },
  { "op": "changeMenuItem", "item": "Home", "caption": { "en_US": "Start", "nl_NL": "Begin" }, "icon": "Atlas_Core.Atlas_Filled.home" },
  { "op": "deleteMenuItem", "item": "Old stuff" },
  { "op": "createMenu", "module": "Sales", "name": "Phone_Menu", "items": [ { "caption": "Orders", "page": "Sales.Order_List" }, { "caption": "Sync", "microflow": "Sales.ACT_Sync", "icon": 57377 } ] },
  { "op": "addMenuItem", "menu": "Sales.Phone_Menu", "page": "Sales.Customer_List", "caption": "Customers", "before": "Sync" },
  { "op": "useMenu", "document": "Atlas_Core.Phone_Default", "menu": "Sales.Phone_Menu" },
  { "op": "createNavigationProfile", "kind": "Phone", "homePage": "Sales.Order_List" }
] }
```

Theme: a CSS class for widgets and a new brand color:

```json
{ "ops": [
  { "op": "addCssClass", "name": "card-highlight", "css": { "background-color": "#fff8e1", "border-left": "4px solid $brand-warning" } },
  { "op": "editThemeFile", "path": "theme/web/custom-variables.scss", "edits": [ { "find": "$brand-primary: #264ae5;", "replace": "$brand-primary: #0a7d32;" } ] }
] }
```

Marketplace: a module the user downloaded into the export folder, then a widget:

```json
{ "ops": [ { "op": "importModulePackage", "file": "downloads/ExternalDatabaseConnector-v6.3.0.mpk" } ] }
```

```json
{ "ops": [ { "op": "importWidget", "file": "downloads/com.mendix.widget.web.Badge.mpk" } ] }
```

Look and accessibility: an icon-only button with a tooltip, a `<nav>` container that hides on phones, a row with
centred columns, a labelled input, a drop-down button, then the same on an existing page and a layout switch:

```json
{ "ops": [
  { "op": "createPage", "module": "Sales", "name": "Order_Card", "entity": "Sales.Order", "class": "order-card", "widgets": [
    { "widget": "container", "renderMode": "nav", "design": { "Hide on": ["Phone"] }, "widgets": [
      { "widget": "actionButton", "action": "close", "icon": "mx-icon-close", "iconOnly": true, "tooltip": "Close" },
      { "widget": "dropDownButton", "caption": "More", "icon": "glyphicon-cog", "items": [ { "caption": "Docs", "action": "openLink", "url": "https://docs.mendix.com" } ] } ] },
    { "widget": "layoutGrid", "rows": [ { "verticalAlignment": "center", "class": "card-row", "columns": [ 8, { "weight": 4, "verticalAlignment": "bottom" } ] } ] },
    { "widget": "dataView", "source": "parameter", "fields": [], "widgets": [
      { "widget": "textBox", "attribute": "Note", "label": "", "ariaLabel": "Order note", "dynamicClass": "if $currentObject/Paid then 'paid' else ''" } ] } ] },
  { "op": "changeWidget", "page": "Sales.Order_Overview", "widget": "layoutGrid1/row 1/column 2", "verticalAlignment": "top" },
  { "op": "changeWidget", "page": "Sales.Order_Overview", "widget": "actionButton2", "icon": "glyphicon-trash", "tooltip": "Delete" },
  { "op": "changePage", "page": "Sales.Order_Overview", "layout": "Atlas_Core.Atlas_TopBar" } ] }
```

Theme: a design property of your own (with its CSS), used on a container, and the brand colour:

```json
{ "ops": [
  { "op": "addDesignProperty", "module": "Sales", "widgetType": "DivContainer", "name": "Card style", "type": "ToggleButtonGroup",
    "options": [ { "name": "Flat", "class": "card-flat", "css": "box-shadow: none" }, { "name": "Raised", "class": "card-raised", "css": "box-shadow: 0 2px 4px #0003" } ] },
  { "op": "addWidgets", "page": "Sales.Order_Card", "widgets": [ { "widget": "container", "design": { "Card style": "Raised" }, "widgets": [] } ] },
  { "op": "setThemeVariable", "variables": { "brand-primary": "#0b5fff", "font-family-base": "'Inter', sans-serif" } } ] }
```

---

## 8. When no operation fits: gap, Studio Pro steps, or (if allowed) SDK scripts

First run `python mx.py gap "<what the user wants>"`. It records the missing operation so it can be added later.
Then give the user exact Studio Pro steps. SDK scripts (`edits/<name>.js`) run only in folders exported with
`--allow-scripts`, because a script runs with full rights before the user approves anything; otherwise `dryrun`
refuses them.

Usages, unused, `changeMicroflow`, `copyDocument`, `changeEntity` and `moveEntity` work on what the model stores:
names built at runtime (Java/JavaScript code, reflection, `Core.microflowCall` with a computed name) are not seen, and
`$Var/Attr` paths are followed only where the variable's entity is known (parameters, created/retrieved objects,
loop items, `$currentObject` of a data widget). Moving a view or external entity, copying documents other than pages,
snippets, layouts, flows, rules, enumerations and entities, and callers that map parameters themselves (workflows,
published services) are Studio Pro work.

Operations cannot do these things: native layouts, Data grid 2 export
without the Data Widgets module (or to CSV), icon properties and linked data sources of pluggable widgets (a Data
grid 2 filter outside the grid: put it in `headerFilters`), filters bound to page variables, offline sync settings
in an app without an offline profile (adding the profile is Studio Pro) or before Mendix 9.24, entity colors (Mendix
stores none), moving domain model annotations, adding a
native navigation profile and native pluggable widgets, open user task / open workflow buttons, a
column offset or order per device, a tooltip on an input or an aria label on a button (Mendix stores none: the
refusal names the alternative), alternative text with `{Attribute}` (plain text only), consumed OData services, consumed SOAP web services and business events
(refused with the Studio Pro steps), XML schemas of several files or with attributes/choices/extensions, OpenAPI
imports of consumed REST services, multi-user tasks, boundary events and event sub-processes of workflows, changing
an existing workflow (only `createWorkflow`), custom mapping handlers and converters, and setting attributes inherited
from System entities (for example `System.User.Name`). In flows: calling an ML model (refused with the Studio Pro
steps), generate document in a project that has no Generate document action yet, moving or extracting steps that have
a custom error handler or a decision in between, extracting steps that make more than one variable used later,
sorting or a range on an association retrieve (Studio Pro has none either: retrieve from the database or sort with
`listOperation`), add/remove on a reference (one object: `set`),
changing a Java/JavaScript action after it was created (ops keep the user code when a file exists), and renaming or
deleting a Java action's file (`rename`/`delete` change the model only). In the domain model: view entities in
Mendix 10 (Mendix 11 has `createViewEntity`), creating or changing external entities (the export only shows them),
database settings of a configuration, access rules of System module entities, changing the kind of a validation
rule (delete it and add the new one), and changing what an event handler does (delete it and add a new one). Pages:
widgets of a snippet that use a parameter without a data view around them (put them in a data view with
`"source": "parameter"`), and Studio Pro's other page generators (only `createCrud`: overview + NewEdit). For these, write
`edits/<name>.js` with the Mendix Model SDK, or give the user Studio Pro steps. Prefer Studio Pro steps when the
change is large or risky.

Navigation, theme and packages: native mobile navigation profiles, menu items of native profiles and native layouts are
Studio Pro work (web layouts' own widgets: `addWidgets` / `changeWidget` / `deleteWidget` / `moveWidget` on the layout). A module package that `importModulePackage` refuses (an older
Mendix version stored differently, an update of an installed module, a whole-app package) is imported in Studio Pro:
App Explorer > right-click the app > *Import module package*. Theme files other than `.scss`, `.css` and `.json`
under `theme/` and `themesource/` (images, fonts, `login.html`) are copied by the user.

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
  The XPath and expression check (section 9) also runs on everything a script wrote.
- The XPath/expression check is sure it is right only for names and types it can see. When Studio Pro accepts
  something it refuses (a function or System member of a newer Mendix version that it calls an error), add
  `"expressionCheck": "warn"` at the top of the change file (next to `"ops"`): the lines stay, the dry run gives a
  code. Tell the user, and record it with `python mx.py gap "expression check: <the line>"`.

---

## 9. Reading the output

### Dry run

```
  1. addAttribute Sales.Order.Note: String(500)          <- one line per operation that ran
Changes: 0 created, 1 updated, 0 deleted unit(s)           <- documents that will change
  ~ DomainModels$DomainModel  (...)
XPATH CHECK ...                                            <- wrong name/value in an XPath constraint: fix the file
EXPRESSION CHECK ...                                       <- wrong name/type in an expression: fix the file
NOT STORED ...                                             <- a value this Mendix version does not keep: fix the script
OLD NAME STILL USED ...                                    <- rename left old names in expressions/XPath/Java
LAYOUT CHECK (...)                                         <- per changed flow: layout errors/warnings, before -> after
  Sales.ACT_Order_Close: 0 error(s), 1 warning(s) (before: 0 error(s), 0 warning(s))
  ! (warning) the flow [3f2a9c1b] ... runs through [7c0d11e2] ...   <- '!' = new since the change
PREVIEW: 1 flow(s) drawn in .../edits/preview              <- only with --preview or "preview": true
A11Y CHECK (...)                                           <- accessibility of new/changed widgets (warnings)
  ! Sales.Order_Edit actionButton3: the button has no caption and no tooltip, ...
      DATA LOSS: the column A and its values are dropped ...  <- deleting/retyping stored data: tell the user first
Warnings:
  > Module.Doc -> Module/Folder                              <- a document moved to another folder
  ! Module.Page: grid1 is a classic Data grid (...)         <- createPage: the grid kind used (always the first line)
  ! ... first use in this project ...                      <- first element of this type: the STUDIO PRO CHECK settles it
STUDIO PRO CHECK (...)                                     <- only with --check: see "STUDIO PRO CHECK" below
Dry run: nothing written. Approval code: 7F3A              <- the code the user must confirm
```

Show the user every line between `Changes:` and `Dry run:`. Do not hide warnings.

LAYOUT CHECK lines (never a reason to refuse): errors are objects that overlap and objects outside their loop;
warnings are a flow running through an object, two steps closer than 15 px on a line, a note covering a step and a
main line wider than 3800 px (about 20 steps: suggest `extractMicroflow`). A new error after your change: add
`{ "op": "formatMicroflow", "microflow": "..." }` to the plan and run again. With `--preview` (or `"preview": true` in
the plan) the dry run also writes `edits/preview/<Module.Flow>.before.svg` and `.after.svg` (boxes, captions, flows;
errors in red): give the user these paths when they want to see the change.

A11Y CHECK lines (never a reason to refuse) name new or changed widgets that screen readers cannot use well: a
button without caption and tooltip (`iconOnly` without `tooltip`), an image without `alt`, an input without label and
`ariaLabel`, a heading that skips a level (H1 then H3). Fix them in the change file unless the user wants it so.

### XPATH CHECK and EXPRESSION CHECK

Every XPath constraint and expression the change wrote or changed is parsed and checked against the model, in its
place: retrieves, data sources of grids, list views, galleries and Data grid 2, selectable objects, search fields,
access rules; conditions, change/create values, variables, return values, log and message texts, list operations,
aggregates, call / show page / button arguments, visibility, editability, validation and widget expressions. Each
line is `<document> [<step id>] <step>` (or `<page> <widget> (<property>)`), the problem, and `in: <the text>`.

```
XPATH CHECK (...):
  ! Sales.ACT_X [9d1d21c0] retrieve L: Sales.Order_Customr: Sales.Order has no association 'Sales.Order_Customr'. Did you mean: Sales.Order_Customer?   in: [...]
EXPRESSION CHECK (...):
  ! Sales.ACT_X [403fd4d8] change Order (Total): the expression gives String, but Decimal is expected (use parseDecimal(...))   in: 'abc'
  ! (warning) Sales.ACT_X [d332e42c] change Order (Note): unknown function newFn(...) (fine if your Mendix version has it)
Refused: 2 XPATH CHECK / EXPRESSION CHECK error(s) above ... no approval code.
```

- A line without `(warning)` is an error Studio Pro would show: the dry run gives **no code**. Fix the change file.
- `Did you mean: X` → use X (attribute, association, entity, variable, function, enumeration value, constant, token).
- `the expression gives A, but B is expected` → the value has the wrong type for the attribute, variable, parameter,
  return value or condition. Use the hint: `toString(...)` / `formatDecimal(...)` for text, `round(...)` for a
  whole number, `parseInteger(...)` / `parseDecimal(...)` from text, `Module.Enum.Value` for an enumeration,
  `true()`/`false()` in XPath. `(cast it first)`: a generalization goes where its specialization is needed: use
  `ifType` + `cast`.
- XPath paths name the entity after each association: `[Module.Order_Customer/Module.Customer/Name = 'x']`.
  Expressions use `$Order/Module.Order_Customer/Name` (or `.../Module.Customer/Name`).
- `syntax: ...` → a missing `)`, `]` or quote; the position is in the message.
- `(warning)` lines (newer functions, members of System entities this check does not know, an association followed
  against its owner) do not stop the dry run: show them under ATTENTION.
- Only what the change wrote is checked; mistakes already in the project are not reported.

### Apply

```
Saved 2 unit file(s), deleted 0. Backup: .mxlocal-backup/<time>   <- written, with a backup
Checked: all 2 operation(s) are in the saved model.               <- verified by reading the model again
STUDIO PRO CHECK (mx check 10.24.0.73019 on a copy of the saved model):   <- Studio Pro's own check, see below
  1 error, 0 warnings, 0 deprecations (before the change: 1 error, ...)
  No new errors: Studio Pro shows only the 1 error the project already had.
Changed since the last checked state ...                          <- export files that changed
```

`CHECK FAILED` instead of `Checked:` means the saved model does not show an operation. Tell the user, suggest
`python mx.py undo`, then fix the change file and start again.

### STUDIO PRO CHECK

Mendix's own consistency check (`mx check`, the same rules as Studio Pro's Errors pane), run on a temporary copy of
the project (mx writes into the project it checks, so never into the user's files). `apply` runs it after writing;
`python mx.py check` runs it on the saved model; `python mx.py dryrun <file> --check` on a copy with the change.
Errors the project already had before the change (the baseline, kept per saved model) are subtracted:

```
STUDIO PRO CHECK (mx check 10.24.0.73019 on a copy of the saved model):
  3 errors, 1 warning, 0 deprecations (before the change: 1 error, 1 warning, 0 deprecations)
  ! NEW [CE0117] Sales.ACT_Order_Close (Microflow) at Change object 'Order': Error(s) in expression.
  ! NEW [CE1613] Sales.Order_Overview (Page) at Data grid 2 'grid1': The selected attribute 'Sales.Order.Total' no longer exists.
  ! 2 NEW ERRORS in Studio Pro since this change. Undo with restore (python mx.py undo), fix the change, dry run again.
```

- `! NEW [code] <document> (<kind>) at <element>: <message>`: an error this change added. Tell the user, suggest
  `python mx.py undo`, fix the change file (the document and element say where) and dry run again with `--check`.
- `No new errors: ...`: Studio Pro shows no error the change added; the "first use" warnings of the dry run are
  settled. Errors the project already had are not yours: mention their number only.
- `mx check FAILED: ...` with raw lines: mx could not load or check the model. When it says "Before the change mx
  check worked", the change broke the model: undo.
- `STUDIO PRO CHECK: not run - mx not found ...` / `... converts the model or fails`: no Studio Pro (or MxBuild) of
  the project's exact Mendix version. Tell the user once that they can set `MX_PATH` (section 11); until then they
  check the Errors pane in Studio Pro.
- Without `-j` support (older mx) the result comes from the text output; lines it cannot read are shown raw.

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
| `XPATH CHECK` / `EXPRESSION CHECK` ... `Did you mean: B` | Use B in that XPath or expression (section 9) |
| `the expression gives A, but B is expected` | Convert the value as the hint says, or pass the right variable |
| `after the association X comes the entity` | XPath: write `X/Module.Entity/Attribute` |
| `is not a parameter or variable here` | Use a parameter, a variable made by an earlier step, or a page parameter / `$currentObject` |
| `Refused: N XPATH CHECK / EXPRESSION CHECK error(s)` | Fix those lines; `"expressionCheck": "warn"` only when you are sure Studio Pro accepts it (section 8) |
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

STUDIO PRO CHECK (`mx check`): found by itself when Studio Pro of the project's exact version is installed
(Windows `C:\Program Files\Mendix\<version>\modeler\mx.exe` or the per-user install under
`%LOCALAPPDATA%\Programs\Mendix`, Mac `/Applications/Studio Pro <version>.app`, Linux MxBuild in
`~/.mendix/mxbuild/<version>/modeler/mx`). Otherwise the user sets `MX_PATH` (a file or an install folder), or
`"mx"` in `.mxlocal.json` in the project folder; `"check": "apply"` there runs it on every apply, `"all"` also on
every dry run, `"checkTimeout": 900` (seconds) for big apps. Another major.minor version is refused (it would
convert the model). Check the setup with `node C:\tools\dump-it\mxlocal\mxlocal.js check --project "C:\Projeler\App"`.

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
