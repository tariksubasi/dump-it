"use strict";
// MCP server: the mxlocal commands as typed tools for any MCP client (Claude Code, Claude Desktop, OpenCode, an LLM
// API app). stdio transport: one JSON-RPC 2.0 message per line. No dependencies.
// The project stays loaded between calls, so a dry run costs a fraction of a second; every call first checks the
// model fingerprint and reloads after a Studio Pro save, pull or apply.
//   node mxlocal.js serve --project <app.mpr|folder> --edits <export folder>/edits [--allow-apply]
// Writing the model needs the user's approval code. apply/undo are tools only with --allow-apply; otherwise the user
// runs them as commands (python mx.py apply <CODE>), where the client asks for permission.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const cli = require("./mxlocal");
const { loadProject, LocalClient } = require("./client");
const { Project } = require("./mpr");
const inspect = require("./inspect");

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Mendix model tools for one local project (Studio Pro app).
Change protocol: 1) find the exact names (find; widget names of a page: widgets; texts to translate: texts); 2) pick operations (ops, then ops with a name for its fields);
3) plan = write the change and dry-run it (nothing is written; it returns an approval code);
4) show the user the dry run (every DATA LOSS / EXPRESSION CHECK / Warnings line) and ask them to close Studio Pro and
answer "yes <CODE>"; 5) only then apply with that code. Never invent operations or fields. No operation fits: gap,
then give the user Studio Pro steps.`;

const str = description => ({ type: "string", description });

function tools(allowApply) {
    const list = [
        { name: "find", description: "Model elements (documents, entities, attributes, associations, roles, ...) whose qualified name contains the text, with their types. Use before writing a change: names are case-sensitive.",
            inputSchema: { type: "object", properties: { text: str("part of a name, e.g. Order or Sales.Customer") }, required: ["text"] } },
        { name: "steps", description: "Steps of a microflow or nanoflow with stable ids (for changeAction, deleteAction, addActions 'after').",
            inputSchema: { type: "object", properties: { flow: str("qualified name, e.g. Sales.ACT_Order_Save") }, required: ["flow"] } },
        { name: "widgets", description: "Widget tree of a page or snippet: names, kinds, entity of each data view / list view, and where new widgets can go ([into]). Use before addWidgets, changeWidget, deleteWidget, moveWidget.",
            inputSchema: { type: "object", properties: { page: str("qualified name, e.g. Sales.Customer_Edit") }, required: ["page"] } },
        { name: "texts", description: "Translatable texts (page titles, widget captions/labels, messages, enumeration and menu captions) with their text in every project language. Use before setTranslations; missing lists only texts without that language.",
            inputSchema: { type: "object", properties: { scope: str("optional Module, Module.Document or menu (default: the project's own modules and menus)"), missing: str("optional language code, e.g. tr_TR: only texts without it") } } },
        { name: "ops", description: "Without a name: one line per operation. With a name (e.g. createPage, addAttribute, retrieve): its fields. Use only these operations and fields.",
            inputSchema: { type: "object", properties: { name: str("optional operation or action name") } } },
        { name: "api", description: "Model SDK type reference for this project's Mendix version (only for SDK scripts).",
            inputSchema: { type: "object", properties: { type: str("SDK type, e.g. DataView"), word: str("optional filter word") }, required: ["type"] } },
        { name: "plan", description: "Save a change as edits/<name>.json and dry-run it. Writes nothing to the model; returns what would change and the approval code.",
            inputSchema: { type: "object", properties: {
                name: str("short file name, e.g. add-note"),
                ops: { type: "array", description: "operations, e.g. [{\"op\": \"addAttribute\", \"entity\": \"Sales.Order\", \"name\": \"Note\", \"type\": \"String(200)\"}]", items: { type: "object" } } },
            required: ["name", "ops"] } },
        { name: "dryrun", description: "Dry-run a change file that is already in edits/ (e.g. after an undo). Writes nothing; returns the approval code.",
            inputSchema: { type: "object", properties: { file: str("file name in edits/, e.g. add-note.json") }, required: ["file"] } },
        { name: "gap", description: "Record a change that no operation can do yet (edits/gaps.jsonl). Then give the user Studio Pro steps.",
            inputSchema: { type: "object", properties: { need: str("what the user wants, in one sentence") }, required: ["need"] } }
    ];
    if (allowApply) {
        list.push({ name: "apply", description: "Write the last dry run to the model. ONLY after the user answered \"yes <CODE>\" for that dry run and closed Studio Pro.",
            inputSchema: { type: "object", properties: { code: str("the approval code the user confirmed") }, required: ["code"] } });
        list.push({ name: "undo", description: "Restore the model from before the last apply (Studio Pro closed). Refuses when the model changed after that apply.",
            inputSchema: { type: "object", properties: {} } });
    }
    return list;
}

class Server {
    constructor(mpr, editsDir, allowApply) {
        this.mpr = mpr;
        this.edits = editsDir;
        this.allowApply = allowApply;
        this.ctx = null;
        this.fingerprint = null;
        this.queue = Promise.resolve(); // one call at a time: they share the loaded project
    }

    // The loaded project, reloaded when the saved model changed since it was loaded.
    async project() {
        const fp = (this.ctx ? this.ctx.project : new Project(this.mpr)).fingerprint();
        if (!this.ctx || fp !== this.fingerprint) {
            this.ctx = await loadProject(this.mpr);
            this.fingerprint = fp;
        }
        return this.ctx;
    }

    // After a dry run: forget the in-memory edits, keep the decoded units it did not touch.
    settle(client) {
        if (!client) return;
        const c = client.changes;
        const touched = new Set([...c.updated, ...c.created.keys(), ...c.deleted, ...c.moved.keys()]);
        const old = this.ctx.project;
        const fresh = new Project(this.mpr);
        for (const [id, p] of old.plain) if (!touched.has(id)) fresh.plain.set(id, p);
        fresh.cache = old.cache;
        fresh.cache.project = fresh;
        this.ctx = { ...this.ctx, project: fresh };
    }

    journal(entry) {
        fs.mkdirSync(this.edits, { recursive: true });
        const time = new Date().toISOString().slice(0, 19);
        fs.appendFileSync(path.join(this.edits, "journal.jsonl"), JSON.stringify({ time, ...entry, via: "mcp" }) + "\n");
    }

    async dryrun(file) {
        const ctx = await this.project();
        let r;
        try {
            r = await cli.run(file, this.mpr, false, ctx);
        } catch (e) {
            this.ctx = null; // a failed run may leave edits in memory: load fresh next time
            this.journal({ cmd: "dryrun", file: path.relative(path.dirname(this.edits), file), code: null, ok: false });
            throw e;
        }
        this.settle(r.client);
        this.journal({ cmd: "dryrun", file: path.relative(path.dirname(this.edits), file), code: (r && r.code) || null, ok: true });
    }

    async call(name, a) {
        const lines = [];
        cli.setOutput(s => lines.push(String(s)));
        let file = null;
        try {
            switch (name) {
                case "find": {
                    const ctx = await this.project();
                    lines.push(inspect.find(new LocalClient(ctx), String(a.text || "")));
                    break;
                }
                case "steps": {
                    const ctx = await this.project();
                    const client = new LocalClient(ctx);
                    const model = await client.open();
                    try {
                        lines.push(await require("./ops").bind(model, client).steps(String(a.flow || "")));
                    } finally {
                        this.settle(client);
                    }
                    break;
                }
                case "widgets": {
                    const ctx = await this.project();
                    const client = new LocalClient(ctx);
                    const model = await client.open();
                    try {
                        lines.push(await require("./ops").bind(model, client).widgets(String(a.page || "")));
                    } finally {
                        this.settle(client);
                    }
                    break;
                }
                case "texts": {
                    const ctx = await this.project();
                    const client = new LocalClient(ctx);
                    const model = await client.open();
                    try {
                        lines.push(await require("./ops").bind(model, client).texts(a.scope ? String(a.scope) : "", a.missing ? String(a.missing) : null));
                    } finally {
                        this.settle(client);
                    }
                    break;
                }
                case "ops":
                    lines.push(require("./ops").help(a.name || undefined));
                    break;
                case "api": {
                    const version = new Project(this.mpr).version;
                    lines.push(inspect.api([a.type, a.word].filter(Boolean).join(" "), version));
                    break;
                }
                case "plan": {
                    const base = String(a.name || "").replace(/\.json$/, "");
                    if (!/^[\w.-]+$/.test(base)) throw new Error("name: letters, digits, '-', '_' and '.' only, e.g. add-note");
                    if (!Array.isArray(a.ops) || !a.ops.length) throw new Error("ops must be a non-empty list of operations; see the ops tool");
                    file = path.join(this.edits, base + ".json");
                    const text = JSON.stringify({ ops: a.ops }, null, 2) + "\n";
                    fs.mkdirSync(this.edits, { recursive: true });
                    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== text) {
                        // never lose a change file: keep the earlier version next to it
                        const hist = path.join(this.edits, ".history");
                        fs.mkdirSync(hist, { recursive: true });
                        fs.copyFileSync(file, path.join(hist, `${base}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
                    }
                    fs.writeFileSync(file, text);
                    await this.dryrun(file);
                    break;
                }
                case "dryrun": {
                    const f = String(a.file || "");
                    file = path.join(this.edits, path.basename(f).endsWith(".json") ? path.basename(f) : path.basename(f) + ".json");
                    if (!fs.existsSync(file)) throw new Error(`No change file '${f}' in edits/. Use the plan tool to write one.`);
                    await this.dryrun(file);
                    break;
                }
                case "gap": {
                    fs.mkdirSync(this.edits, { recursive: true });
                    const gaps = path.join(this.edits, "gaps.jsonl");
                    const n = fs.existsSync(gaps) ? fs.readFileSync(gaps, "utf8").split("\n").filter(Boolean).length + 1 : 1;
                    fs.appendFileSync(gaps, JSON.stringify({ time: new Date().toISOString().slice(0, 19), need: String(a.need || "") }) + "\n");
                    this.journal({ cmd: "gap", need: String(a.need || "") });
                    lines.push(`Recorded as gap #${n}. Tell the user that no operation does this yet and give the exact Studio Pro steps.`);
                    break;
                }
                case "apply":
                    if (!this.allowApply) throw new Error("apply is not a tool here; the user runs: python mx.py apply <CODE>");
                    await cli.apply(this.mpr, a.code);
                    this.journal({ cmd: "apply", code: a.code, ok: true });
                    break;
                case "undo":
                    if (!this.allowApply) throw new Error("undo is not a tool here; the user runs: python mx.py undo");
                    cli.restoreCmd(this.mpr, null, false);
                    this.journal({ cmd: "undo", ok: true });
                    break;
                default:
                    throw new Error(`Unknown tool '${name}'`);
            }
            return { content: [{ type: "text", text: lines.join("\n") || "(no output)" }] };
        } catch (e) {
            const text = lines.join("\n") + (lines.length ? "\n" : "") + cli.report(e, file);
            return { content: [{ type: "text", text }], isError: true };
        } finally {
            process.exitCode = undefined; // apply sets it for the CLI; the server keeps running
        }
    }

    async handle(msg) {
        const { id, method, params } = msg;
        if (method === "initialize") {
            const asked = params && params.protocolVersion;
            return { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "mendix-mxlocal", version: require("./package.json").version || "0" }, instructions: INSTRUCTIONS };
        }
        if (method === "ping") return {};
        if (method === "tools/list") return { tools: tools(this.allowApply) };
        if (method === "tools/call") {
            const run = this.queue.then(() => this.call(params.name, params.arguments || {}));
            this.queue = run.catch(() => {});
            return run;
        }
        if (id === undefined) return undefined; // notifications (initialized, cancelled): nothing to answer
        const err = new Error(`Method not found: ${method}`);
        err.code = -32601;
        throw err;
    }
}

async function serve(mpr, editsDir, allowApply) {
    // stdout carries the protocol only; anything else printed goes to stderr
    console.log = console.info = console.warn = (...x) => process.stderr.write(x.join(" ") + "\n");
    const server = new Server(mpr, editsDir, allowApply);
    const send = m => process.stdout.write(JSON.stringify(m) + "\n");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", line => {
        if (!line.trim()) return;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        }
        Promise.resolve()
            .then(() => server.handle(msg))
            .then(result => {
                if (msg.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: msg.id, result });
            })
            .catch(e => {
                if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32603, message: e.message } });
            });
    });
    // load the project now, so the first call is fast too
    server.project().catch(e => process.stderr.write(`mxlocal serve: ${e.message}\n`));
    await new Promise(resolve => rl.on("close", resolve));
}

module.exports = { serve, Server };
