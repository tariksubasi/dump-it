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

## Rules

- The tool only changes calls whose `ActivityName` is empty, or that have `[autolog]` in their documentation.
- The tool adds `[autolog]` to each call it fills. If you move the activity, run the tool again and it updates the values.
- If you want to keep your own values, delete `[autolog]` from the documentation.
- After an error handler flow, the tool logs `$latestError/Message` (microflow) or `$latestError` (nanoflow).
- In about 1% of cases the type is not known (System module associations, import mapping results). The tool then fills only the names and writes `'<type unknown>'` as the value. Fix those by hand.
