# autolog: activity logging with no manual parameters

Drag `LogActivity` (microflow) or `JS_LogActivity` (nanoflow) after any activity, leave the parameters empty, and run one command. The tool reads the model and fills in these values:

| Parameter | Value written |
|---|---|
| `FlowName` | `'Module.MF_or_NF_Name'` |
| `ActivityName` | Caption of the previous activity (a generated caption if Studio Pro auto-generates it) |
| `VariableName` | The variable that activity creates or changes (`''` if it is void) |
| `VariableValue` | `$S` / `toString($X)` / `getKey($Enum)`, depending on the type |
| `VariableObject` | `$Obj` (only for objects) |
| `VariableList` | `$List` (only for lists) |

At runtime, the Java action also adds the timestamp and the call chain (`MF_A > SUB_B`).

## Setup (once)

1. In the `Logging` module, create the Java action `LogActivity` with the parameters listed in `LogActivity.java`. Paste in the USER CODE and EXTRA CODE blocks.
2. Create the JS action `JS_LogActivity` from `JS_LogActivity.js`. Also create the `ClientLogEntry` NPE and the `ACT_ClientLogEntry_Write` microflow.
3. Install the BSON module: `pip install pymongo`

## Usage

```bash
# 1. Close Studio Pro and commit your work
# 2. Dry run: changes nothing, prints what it would do
python C:\tools\dump-it\tools\autolog\autolog.py "C:\Projeler\BenimProje"
# 3. Write the changes
python C:\tools\dump-it\tools\autolog\autolog.py "C:\Projeler\BenimProje" --apply
# 4. Open Studio Pro and press F4 (consistency check)
```

The argument is the app folder (the folder with the `.mpr` file and `mprcontents/`).

To use other module or action names, pass `--java-action Mod.Name --js-action Mod.Name`.

## Journal mode: log every activity automatically

### Object logging

When `VariableObject` is set, `LogActivityFixed` uses `Journal.describeObject` to render the full object state `Type[id=...] {Attr=value}` instead of leaving `Value` empty. For generic use, create `LogObjectState` Java action with type parameter `T` and call it from `LogActivityFixed` when `VariableObject != null`. This ensures object fields are logged in both Activity and ObjectState lines.

## Journal mode: log every activity automatically

You add **one** activity by hand: a `FlushJournal` call before the end event of the microflow. The tool adds the rest.

```bash
python C:\tools\dump-it\tools\autolog\autolog.py "C:\Projeler\BenimProje" --insert            # dry run
python C:\tools\dump-it\tools\autolog\autolog.py "C:\Projeler\BenimProje" --insert --apply    # write
```

For each microflow that has a `FlushJournal` call, the tool:

| Where | What it adds |
|---|---|
| After the start event | `StartJournal` |
| After every activity, decision branch and loop (also on error-handler paths) | A filled `LogActivity` |
| At the start and at the end of every loop turn | A filled `LogActivity` (iterator / last activity) |
| Before every other end event and error event | `FlushJournal` |

At runtime, every step goes into a buffer. `FlushJournal` writes all steps as one block:

```
Journal | cid=7f3a | flow=Sales.ACT_Order_Save | steps=4 | 38 ms
  1. 10:15:02.101  [Retrieve Customer] Customer = Sales.Customer[id=12] {Name=Ali, City=Ankara}
  2. 10:15:02.110  [Change Order] Order = Sales.Order[id=40] {Status=Draft -> Approved, Total=150.00}
    > Sales.SUB_Order_Validate
    3. 10:15:02.120  [Retrieve Lines] LineList = list[3] Sales.Line[id=7], ...
    < end Sales.SUB_Order_Validate
  4. 10:15:02.131  [Commit Order] Order = Sales.Order[id=40] {Status=Approved, Total=150.00}
```

- Void activities (commit, change, delete, rollback) log the object they work on. Changed attributes show `old -> new`.
- Attribute names with `password`, `secret`, `token` or `apikey` show `***`.
- A loop logs each activity for its first 20 turns. After that, the block shows a count (`... 9980 more step(s)`).
- A sub-microflow joins the journal of its caller and shows indented. `--deep` also journals every microflow that the selected ones call.
- `--flow Mod.Microflow` (repeatable) journals a microflow that has no `FlushJournal` call.
- The added calls use the `Debug` level (`--insert-level` changes it). In production `Debug` is usually off, and then the calls return at once.
- Each `--insert` run deletes its earlier additions and adds them again. `--remove --apply` deletes them all. The tool marks them `[autolog:auto]` in the documentation.
- The tool moves the next activities to make room. `--remove` does not move them back.

### Journal setup (once)

1. Copy `Journal.java` to `javasource/logging/Journal.java`, next to `LogSink.java` and `TraceContext.java`.
2. Paste the new `LogActivity.java` USER CODE and EXTRA CODE blocks. They write into the journal when one is open, else they log at once, as before.
3. In the `Logging` module, create two Java actions and paste their USER CODE blocks:
   - `StartJournal`: no parameters, returns Nothing (`StartJournal.java`)
   - `FlushJournal`: `LogNodeName` String, `Level` Enumeration `CommunityCommons.LogLevel`, returns Nothing (`FlushJournal.java`)

### Journal limits

| Case | What happens |
|---|---|
| An uncaught error stops the microflow before `FlushJournal` | The next journal on the same thread writes the old one with `NOT CLOSED` at `Warning` level. Activities with a custom error handler get a `FlushJournal` on their error path. |
| A step after a `delete` | The step shows the values of the object in memory. |
| Nanoflows | Not supported in journal mode. Use `JS_LogActivity` as before. |
| More than 1000 steps | The block stops at 1000 steps and shows the count of the rest. |

## Rules

- The tool only changes calls whose `ActivityName` is empty, or that have `[autolog]` in their documentation.
- The tool adds `[autolog]` to each call it fills. If you move the activity, run the tool again and it updates the values.
- If you want to keep your own values, delete `[autolog]` from the documentation.
- After an error handler flow, the tool logs `$latestError/Message` (microflow) or `$latestError` (nanoflow).
- In about 1% of cases the type is not known (System module associations, import mapping results). The tool then fills only the names and writes `'<type unknown>'` as the value. Fix those by hand.
