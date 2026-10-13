// OpenCode custom tools for an mxcontext export folder (written there by mxcontext.py).
// Read-only lookups and the dry run only: apply and undo stay shell commands, so OpenCode asks the user first.
// Arguments use plain JSON Schema, so no npm package is needed. OpenCode makes every such argument required, so
// optional ones take "" for "none".
import { execFile } from "node:child_process";
import path from "node:path";

const PYTHON = @PYTHON_JSON@; // filled in by mxcontext.py

function mx(context, args) {
    const dir = context.directory || context.worktree || process.cwd();
    return new Promise(resolve => {
        execFile(PYTHON, [path.join(dir, "mx.py"), ...args], { cwd: dir, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
            (err, stdout, stderr) => {
                const text = `${stdout || ""}${stderr || ""}`.trim();
                resolve(text || (err ? `failed: ${err.message}` : "(no output)"));
            });
    });
}

const text = description => ({ type: "string", description });

export const find = {
    description: "Find Mendix model elements (documents, entities, attributes, associations, enumeration values, roles, " +
        "parameters) whose qualified name contains the text. Returns exact names and SDK types. Use before writing a change.",
    args: { text: text("part of the name, e.g. Order or Sales.Customer") },
    execute: (args, context) => mx(context, ["find", args.text])
};

export const steps = {
    description: "Steps of a microflow or nanoflow in order, with stable ids. Use the ids in changeAction, deleteAction " +
        "and addActions 'after'.",
    args: { flow: text("qualified name, e.g. Sales.ACT_Order_Save") },
    execute: (args, context) => mx(context, ["steps", args.flow])
};

export const widgets = {
    description: "Widget tree of a page or snippet: widget names, kinds, the entity of each data view and list view, " +
        "and where new widgets can go. Use the names in addWidgets, changeWidget, deleteWidget and moveWidget.",
    args: { page: text("qualified name of the page or snippet, e.g. Sales.Customer_Edit") },
    execute: (args, context) => mx(context, ["widgets", args.page])
};

export const texts = {
    description: "Translatable texts (page titles, widget captions/labels, messages, enumeration and menu captions) " +
        "with their text in every project language. Use the listed where [part] in setTranslations.",
    args: {
        scope: text("Module, Module.Document or menu; \"\" for the project's own modules and menus"),
        missing: text("language code such as tr_TR to list only texts without it, or \"\" for all")
    },
    execute: (args, context) => mx(context, ["texts", ...(args.scope ? [String(args.scope)] : []), ...(args.missing ? ["--missing", String(args.missing)] : [])])
};

export const ops = {
    description: "Without a name: one line per operation a change file edits/<name>.json can use. With a name " +
        "(e.g. createPage, retrieve): the fields of that operation or action.",
    args: { name: text("an operation or action name, or \"\" for the list of all") },
    execute: (args, context) => mx(context, ["ops", ...(args.name ? [String(args.name)] : [])])
};

export const api = {
    description: "Model SDK type reference for this Mendix version: properties, enum values, createIn functions. " +
        "Only needed for .js change files.",
    args: { type: text("SDK type name, optionally followed by a filter word, e.g. Attribute or ObjectType Microflow") },
    execute: (args, context) => mx(context, ["api", ...String(args.type).split(/\s+/).filter(Boolean)])
};

export const dryrun = {
    description: "Dry run of a change file in edits/: shows what would change and the approval code. " +
        "Writes nothing to the model.",
    args: { file: text("file name in edits/, e.g. add-note.json") },
    execute: (args, context) => mx(context, ["dryrun", args.file])
};

export const refresh = {
    description: "Re-export the Mendix model and list the files that changed since the last checked state.",
    args: {},
    execute: (args, context) => mx(context, ["refresh"])
};

export const rerun = {
    description: "Dry run a change file again, e.g. after an undo. Without a file: the last applied change. A file " +
        "that is gone from edits/ is brought back from the backup.",
    args: { file: text("file name in edits/, or \"\" for the last applied change") },
    execute: (args, context) => mx(context, ["rerun", ...(args.file ? [String(args.file)] : [])])
};

export const gap = {
    description: "Record a change that no operation can do yet. Then give the user the Studio Pro steps instead.",
    args: { need: text("what the user wants, in one sentence") },
    execute: (args, context) => mx(context, ["gap", args.need])
};

export const mergecheck = {
    description: "After a git merge of the Mendix app (conflicts in the .mpr or mprcontents): which documents each " +
        "branch changed, which are resolved automatically, and the true conflicts with what each side changed. Read-only.",
    args: {},
    execute: (args, context) => mx(context, ["mergecheck"])
};

export const mergefix = {
    description: "Dry run of the merge fix: merged unit files and a rebuilt .mpr unit table; writes nothing, prints an " +
        "approval code for python mx.py apply. Every true conflict needs a side.",
    args: {
        pick: text("\"<unit id or Module.Document>=ours|theirs\" (several comma-separated), or \"\""),
        all: text("ours or theirs for every remaining conflict, or \"\"")
    },
    execute: (args, context) => mx(context, ["mergefix", ...(args.pick ? ["--pick", String(args.pick)] : []), ...(args.all ? ["--all", String(args.all)] : [])])
};
