// OpenCode custom tools for an mxcontext export folder (written there by mxcontext.py).
// Read-only lookups and the dry run only: apply and undo stay shell commands, so OpenCode asks the user first.
// Arguments use plain JSON Schema, so no npm package is needed.
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

export const ops = {
    description: "List the operations (and their fields) that a change file edits/<name>.json can use.",
    args: {},
    execute: (args, context) => mx(context, ["ops"])
};

export const api = {
    description: "Model SDK type reference for this Mendix version: properties, enum values, createIn functions. " +
        "Only needed for .js change files.",
    args: { type: text("SDK type name, optionally followed by a filter word, e.g. Attribute or ObjectType Microflow") },
    execute: (args, context) => mx(context, ["api", ...String(args.type).split(/\s+/).filter(Boolean)])
};

export const dryrun = {
    description: "Dry run of a change file in edits/ (.json or .js): shows what would change and the approval code. " +
        "Writes nothing to the model.",
    args: { file: text("file name in edits/, e.g. add-note.json") },
    execute: (args, context) => mx(context, ["dryrun", args.file])
};

export const refresh = {
    description: "Re-export the Mendix model and list the files that changed since the last checked state.",
    args: {},
    execute: (args, context) => mx(context, ["refresh"])
};
