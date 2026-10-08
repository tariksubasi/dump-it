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
| `python mx.py ops` | Lists all operations and fields for change files | no |
| `python mx.py api <Type> [word]` | SDK type reference for this Mendix version (for `.js` files only) | no |
| `python mx.py dryrun <file>` | Computes a change from `edits/<file>`. Writes nothing. Prints an approval code | no |
| `python mx.py apply <CODE>` | Writes the last dry run, re-exports, lists changed files, runs `mx check` when installed | **yes** |
| `python mx.py undo` | Restores the model from before the last apply, then re-exports | **yes** |
| `python mx.py check` | Runs Studio Pro's `mx check` (only when `mx.exe` is installed) | no |
| `python mx.py ok "<summary>"` | Saves the current export as the checked state (git commit) | no |
| `python mx.py selftest` | Runs every operation on a temporary copy of the project and checks the result | no |

In OpenCode the same read-only commands also exist as tools: `mx_find`, `mx_ops`, `mx_api`, `mx_dryrun`,
`mx_refresh`. Use the tool or the command; the result is the same. `apply` and `undo` exist only as commands, so
OpenCode asks the user before they run.

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

**Step 2: Write the change file** `edits/<short-name>.json`. Use only operations and fields from section 7.
Several operations in one file run in order.

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
ATTENTION: <every EXPRESSION CHECK / NOT STORED / OLD NAME STILL USED / STILL USED BY / Warnings line, or "none">
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
closes Studio Pro, you run `python mx.py undo`.

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

### Microflows

| Op | Fields | Notes |
|---|---|---|
| `createMicroflow` | **module**, **name**, folder, parameters `[{name, type}]`, returns, returnValue (required with returns), actions, roles | Straight line: start → actions → end. Folders are created when missing |
| `addActions` | **microflow**, **actions**, after (`"start"` or a variable name) | Without `after`: before the single end event. Inserts on the main line only (not inside loops) |

Data types for parameters, variables and returns: `String`, `Integer`, `Long`, `Decimal`, `Boolean`, `DateTime`,
`Module.Entity` (one object), `List(Module.Entity)`, `Enum(Module.Enumeration)`.

Actions (inside `"actions": [ { "action": "<name>", ... } ]`):

| Action | Fields | Defaults |
|---|---|---|
| `retrieve` | **variable** + either entity, xpath, first (database) or from, association (over an association) | first = false (a list) |
| `create` | **variable**, **entity**, set `{"Attr":"expr", "Module.Assoc":"$Var"}`, commit | commit = false |
| `change` | **variable**, **set**, commit, refresh | commit = false |
| `commit` | **variable**, events | events = true |
| `delete` | **variable** | |
| `call` | **microflow**, args `{"Param":"expr"}`, variable | Every parameter needs an arg |
| `log` | **message** (`{1}`, `{2}` = args), args `["expr"]`, level, node | level Info, node = module name |
| `message` | **text**, type (`Information`/`Warning`/`Error`), blocking | blocking = true |
| `variable` | **name**, **type**, **value** | |
| `set` | **name**, **value** | |

Variable names are written without `$` in `variable`, `from`, `after` and `name`. Expressions are Mendix
expressions as text: `"'Hello'"`, `"$Order/Total * 2"`, `"empty"`, `"[%CurrentDateTime%]"`,
`"Module.Enum.Value"`. String literals need single quotes inside the JSON string.

### Rename and delete

| Op | Fields | Notes |
|---|---|---|
| `rename` | **target** (qualified name), **newName** | Updates every reference. Reports old names left in expressions, XPath and Java (`OLD NAME STILL USED`); fix those with another change |
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

## 8. When no operation fits: SDK scripts

Operations cannot do these things: pages and snippets, nanoflow actions, decisions, loops and error handlers in
microflows, REST/OData services, workflows, setting attributes inherited from System entities (for example
`System.User.Name`). For these, write `edits/<name>.js` with the Mendix Model SDK, or give the user Studio Pro
steps. Prefer Studio Pro steps when the change is small or risky.

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

- Before using a type, run `python mx.py api <Type>`. Use only the listed properties. Properties under
  `NOT IN THIS MENDIX VERSION` fail.
- Too many create functions are listed? Add a filter word: `python mx.py api ObjectType MicroflowParameterObject`.
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
Warnings:
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
| `has N end events` / `has N outgoing flows` | Add `"after": "<variable name>"` or `"after": "start"` |
| `needs args for: P` | Add every parameter of the called microflow to `args` |
| `Studio Pro has this project open` | Ask the user to close Studio Pro, then run the same command again |
| `Code ... does not match the last dry run` | Use the code of the latest dry run (show it to the user again) |
| `The model changed since the dry run` | Run the dry run again and ask for the new code |
| `Nothing to undo` | There is no applied change left to undo |
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
