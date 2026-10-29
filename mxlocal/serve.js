"use strict";
// MCP server: the mxlocal commands as typed tools for any MCP client (Claude Code, Claude Desktop, OpenCode, an LLM
// API app). stdio transport: one JSON-RPC 2.0 message per line. No dependencies.
// The project stays loaded between calls, so a dry run costs a fraction of a second; every call first checks the
// model fingerprint and reloads after a Studio Pro save, pull or apply.
//   node mxlocal.js serve --project <app.mpr|folder> --edits <export folder>/edits [--allow-apply] [--mx <Studio Pro's mx>]
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
Change protocol: 1) find the exact names (find; who uses something: usages, before every rename/delete/move; widget names of a page: widgets; texts to translate: texts); 2) pick operations (ops, then ops with a name for its fields);
3) plan = write the change and dry-run it (nothing is written; it returns an approval code);
4) show the user the dry run (every DATA LOSS / EXPRESSION CHECK / Warnings line) and ask them to close Studio Pro and
answer "yes <CODE>"; 5) only then apply with that code; 6) check (Studio Pro's own mx check, when installed) shows
errors the change added. Never invent operations or fields. No operation fits: gap, then give the user Studio Pro steps.`;

const str = description => ({ type: "string", description });

function tools(allowApply) {
    const list = [
        { name: "find", description: "Model elements (documents, entities, attributes, associations, roles, ...) whose qualified name contains the text, with their types. Use before writing a change: names are case-sensitive.",
            inputSchema: { type: "object", properties: { text: str("part of a name, e.g. Order or Sales.Customer") }, required: ["text"] } },
        { name: "usages", description: "Who uses a document, entity, attribute, association, enumeration value, constant, ... (by name and in expressions/XPath), grouped by document with the place (widget, step id, column). Run it before rename, delete, moveEntity or changeMicroflow.",
            inputSchema: { type: "object", properties: { name: str("qualified name, e.g. Sales.Order or Sales.ACT_Order_Save"), depth: str("optional 1-5: also who uses those users (default 1)") }, required: ["name"] } },
        { name: "unused", description: "Documents, entities, attributes and enumeration values nobody references (entry points excluded), with reasons. Probably unused: never delete without usages and the user's yes.",
            inputSchema: { type: "object", properties: { module: str("optional module name (default: the app's own modules)") } } },
        { name: "steps", description: "Steps of a microflow or nanoflow with stable ids (for changeAction, deleteAction, addActions 'after').",
            inputSchema: { type: "object", properties: { flow: str("qualified name, e.g. Sales.ACT_Order_Save") }, required: ["flow"] } },
        { name: "widgets", description: "Widget tree of a page or snippet: names, kinds, entity of each data view / list view, and where new widgets can go ([into]). Use before addWidgets, changeWidget, deleteWidget, moveWidget.",
            inputSchema: { type: "object", properties: { page: str("qualified name, e.g. Sales.Customer_Edit") }, required: ["page"] } },
        { name: "mapping_test", description: "What a sample JSON would make with an import mapping: objects (create / find by keys / custom / parameter), attribute values, type problems, sample keys the mapping ignores. A static simulation, read-only.",
            inputSchema: { type: "object", properties: { mapping: str("import mapping, e.g. Sales.IMM_Order"), json: str("the sample JSON text") }, required: ["mapping", "json"] } },
        { name: "screens", description: "The screen template catalog (no project needed): no argument = categories with keywords; a category = its templates with thumbnails to show the user; a template id = phone/desktop sketches, slots and an example createScreen.",
            inputSchema: { type: "object", properties: { name: str("optional category (e.g. time) or template id (e.g. time.clock.big)") } } },
        { name: "security", description: "Security overview, read-only: level, administrator, guest access, demo users, user roles with their module roles, and issues: entities without access rules, pages/flows used from the client that no module role may use, module roles no user role has, guest = administrator.",
            inputSchema: { type: "object", properties: { module: str("optional own module to check, e.g. Sales") } } },
        { name: "contract", description: "An API contract file, read-only: OpenAPI 2/3 (JSON or YAML) -> its operations and a createConsumedRestService plan; WSDL -> its operations, SOAPActions and XML schemas; OData $metadata -> entity sets, keys, actions and a JSON structure / import mapping plan. Dry run the plan like any change.",
            inputSchema: { type: "object", properties: { file: str("path of the .json/.yaml/.wsdl/.xml file"), module: str("optional module for the plan, e.g. Sales") }, required: ["file"] } },
        { name: "widgettype", description: "Pluggable widgets installed in widgets/*.mpk; with a name (e.g. Datagrid, \"Data grid 2\", Badge): its properties with types, defaults and values, for { \"widget\": \"pluggable\", \"type\": ..., \"properties\": { ... } } in createPage / addWidgets.",
            inputSchema: { type: "object", properties: { name: str("optional widget id or short name, e.g. Datagrid") } } },
        { name: "texts", description: "Translatable texts (page titles, widget captions/labels, messages, enumeration and menu captions) with their text in every project language. Use before setTranslations; missing lists only texts without that language.",
            inputSchema: { type: "object", properties: { scope: str("optional Module, Module.Document or menu (default: the project's own modules and menus)"), missing: str("optional language code, e.g. tr_TR: only texts without it") } } },
        { name: "ops", description: "Without a name: one line per operation. With a name (e.g. createPage, addAttribute, retrieve): its fields. Use only these operations and fields.",
            inputSchema: { type: "object", properties: { name: str("optional operation or action name") } } },
        { name: "api", description: "Model SDK type reference for this project's Mendix version (only for SDK scripts).",
            inputSchema: { type: "object", properties: { type: str("SDK type, e.g. DataView"), word: str("optional filter word") }, required: ["type"] } },
        { name: "plan", description: "Save a change as edits/<name>.json and dry-run it. Writes nothing to the model; returns what would change and the approval code.",
            inputSchema: { type: "object", properties: {
                name: str("short file name, e.g. add-note"),
                ops: { type: "array", description: "operations, e.g. [{\"op\": \"addAttribute\", \"entity\": \"Sales.Order\", \"name\": \"Note\", \"type\": \"String(200)\"}]", items: { type: "object" } },
                check: str("optional \"yes\": also run Studio Pro's mx check on a temporary copy with the change (slow: about a minute)") },
            required: ["name", "ops"] } },
        { name: "dryrun", description: "Dry-run a change file that is already in edits/ (e.g. after an undo). Writes nothing; returns the approval code.",
            inputSchema: { type: "object", properties: { file: str("file name in edits/, e.g. add-note.json"), check: str("optional \"yes\": also run Studio Pro's mx check on a temporary copy with the change") }, required: ["file"] } },
        { name: "check", description: "STUDIO PRO CHECK: Mendix's own consistency check (mx check = the Errors pane of Studio Pro) of the saved model, on a temporary copy. Read-only. Run it after an apply; errors with document names. Needs Studio Pro or MxBuild of the project's version (else one line how to set MX_PATH).",
            inputSchema: { type: "object", properties: {} } },
        { name: "mergecheck", description: "After a git merge of the Mendix app: per-document 3-way analysis of mprcontents and the .mpr unit table (resolved automatically / true conflicts with what each side changed). Read-only; the fix is the command python mx.py mergefix (dry run) then apply.",
            inputSchema: { type: "object", properties: {} } },
        { name: "clean", description: "Files outside edits/ that the export did not write (helper scripts, notes, edited export files). Read-only list; the user moves them with python mx.py clean --move. Never create such files: change files go through plan only.",
            inputSchema: { type: "object", properties: {} } },
        { name: "undoplan", description: "Selective undo: the inverse ops of the last applied change (or the given backup), or only of some of its ops, saved as edits/undo-<backup>.json and dry-run (approval code). Later work stays. Lists the ops that cannot be inverted (only a full undo/restore brings those back).",
            inputSchema: { type: "object", properties: { backup: str("optional backup name (the apply's 'Backup:' folder name; default the last apply)"), ops: str("optional op numbers of that change, e.g. \"2,5\" (default all)") } } },
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
    constructor(mpr, editsDir, allowApply, mx) {
        this.mpr = mpr;
        this.mx = mx && mx !== true ? mx : undefined; // --mx: Studio Pro's mx for the check tool (else found by mxcheck.js)
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

    async dryrun(file, check) {
        const ctx = await this.project();
        let r;
        try {
            r = await cli.run(file, this.mpr, false, ctx, { check: /^(yes|true|1|on)$/i.test(String(check || "")), mx: this.mx });
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
                case "usages":
                case "unused": {
                    const ctx = await this.project();
                    const client = new LocalClient(ctx);
                    const refs = require("./refs");
                    lines.push(name === "usages" ? refs.usages(client, String(a.name || ""), a.depth) : refs.unused(client, a.module ? String(a.module) : undefined));
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
                case "mapping_test": {
                    const ctx = await this.project();
                    const client = new LocalClient(ctx);
                    const model = await client.open();
                    try {
                        lines.push(await require("./ops").bind(model, client).mappingTest(String(a.mapping || ""), String(a.json || "")));
                    } finally {
                        this.settle(client);
                    }
                    break;
                }
                case "screens": {
                    const reg = require("./screens");
                    lines.push(a.name ? reg.categoryText(String(a.name)) || reg.templateText(String(a.name)) || `no category or template '${a.name}'` : reg.catalog());
                    break;
                }
                case "security": {
                    const ctx = await this.project();
                    const client = new LocalClient(ctx);
                    const model = await client.open();
                    try {
                        lines.push(await require("./ops").bind(model, client).securityReport(a.module ? String(a.module) : undefined));
                    } finally {
                        this.settle(client);
                    }
                    break;
                }
                case "contract": {
                    lines.push(require("./contract").inspectContract(require("path").resolve(String(a.file || "")), { module: a.module ? String(a.module) : undefined }).text);
                    break;
                }
                case "widgettype": {
                    const ctx = await this.project();
                    const client = new LocalClient(ctx);
                    const model = await client.open();
                    try {
                        lines.push(await require("./ops").bind(model, client).widgetType(String(a.name || "")));
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
                    await this.dryrun(file, a.check);
                    lines.push(require("./stray").warning(path.dirname(this.edits)));
                    break;
                }
                case "dryrun": {
                    const f = String(a.file || "");
                    file = path.join(this.edits, path.basename(f).endsWith(".json") ? path.basename(f) : path.basename(f) + ".json");
                    if (!fs.existsSync(file)) throw new Error(`No change file '${f}' in edits/. Use the plan tool to write one.`);
                    await this.dryrun(file, a.check);
                    lines.push(require("./stray").warning(path.dirname(this.edits)));
                    break;
                }
                case "undoplan": {
                    const u = await require("./undo").undoPlan(this.mpr, a.backup || null, a.ops || null);
                    lines.push(`UNDO ${u.name} (${u.count} op(s)): the inverse ops, last op first:`, ...u.lines);
                    if (u.left.length) lines.push(`NOT INVERTIBLE (only a full undo of ${u.name} brings these back):`, ...u.left);
                    if (!u.plan.ops.length) {
                        lines.push("Nothing to undo with ops. No approval code.");
                        break;
                    }
                    fs.mkdirSync(this.edits, { recursive: true });
                    file = path.join(this.edits, `undo-${u.name}.json`);
                    fs.writeFileSync(file, JSON.stringify(u.plan, null, 1) + "\n");
                    await this.dryrun(file);
                    break;
                }
                case "mergecheck":
                    lines.push(require("./merge").mergecheck(this.mpr));
                    break;
                case "check":
                    cli.checkCmd(this.mpr, { mx: this.mx });
                    break;
                case "clean":
                    lines.push(require("./stray").report(path.dirname(this.edits)));
                    break;
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
                    await cli.apply(this.mpr, a.code, { check: true, mx: this.mx });
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
            return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") || "(no output)" }] };
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

async function serve(mpr, editsDir, allowApply, mx) {
    // stdout carries the protocol only; anything else printed goes to stderr
    console.log = console.info = console.warn = (...x) => process.stderr.write(x.join(" ") + "\n");
    const server = new Server(mpr, editsDir, allowApply, mx);
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
