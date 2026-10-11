#!/usr/bin/env node
"use strict";
// Eval: natural-language change requests (eval/requests.json) given to a real agent in an export folder, as a user
// would. For each request: a fresh copy of the project gets the base setup, is exported (MCP on), the agent works up
// to the dry run, then this script applies the pending change, re-exports and runs the checks.
//
//   node eval/run.js --project <app.mpr> [--agent claude|opencode] [--model <model>] [--only id,id] [--out <dir>]
//
// claude: Claude Code CLI (claude -p), tools limited to the mendix MCP server and read-only file tools.
// opencode: OpenCode CLI (opencode run), with the folder's own opencode.json; --model e.g. deepseek/deepseek-chat.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MXLOCAL = path.join(ROOT, "mxlocal", "mxlocal.js");
const PY = process.platform === "win32" ? "python" : "python3";

function args(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    return a;
}

const run = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

function mx(argv, mpr) {
    const r = run("node", [MXLOCAL, ...argv, "--project", mpr]);
    return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

// dry run + apply of a plan, without an agent (setup)
function applyPlan(ops, mpr, dir) {
    const file = path.join(dir, "setup.json");
    fs.writeFileSync(file, JSON.stringify({ ops }));
    const dry = mx(["run", file], mpr);
    const code = (/Approval code: (\w+)/.exec(dry.out) || [])[1];
    if (!code) throw new Error("setup dry run failed:\n" + dry.out);
    const ap = mx(["apply", "--code", code], mpr);
    if (!ap.ok) throw new Error("setup apply failed:\n" + ap.out);
}

function exportTo(mpr, ctx) {
    const r = run(PY, [path.join(ROOT, "mxcontext.py"), mpr, "-o", ctx]);
    if (r.status !== 0) throw new Error("export failed:\n" + r.stdout + r.stderr);
}

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".txt")) out.push(p);
    }
    return out;
}

const PROMPT_TAIL = "\n\n(Automated test. Do the change only up to and including the dry run, then stop and print the approval code. " +
    "Do not run apply. Do not ask me questions; choose sensible names yourself.)";

function runAgent(agent, model, ctx, text) {
    const started = Date.now();
    if (agent === "claude") {
        const allowed = ["mcp__mendix__find", "mcp__mendix__steps", "mcp__mendix__ops", "mcp__mendix__api", "mcp__mendix__plan",
            "mcp__mendix__dryrun", "mcp__mendix__gap", "Read", "Grep", "Glob"];
        const r = run("claude", ["-p", text + PROMPT_TAIL, "--output-format", "json", "--mcp-config", path.join(ctx, ".mcp.json"),
            "--strict-mcp-config", "--allowedTools", ...allowed, ...(model ? ["--model", model] : [])], { cwd: ctx, timeout: 15 * 60 * 1000 });
        let j = {};
        try {
            j = JSON.parse(r.stdout);
        } catch {
            j = { result: (r.stdout || "") + (r.stderr || "") };
        }
        return { ms: Date.now() - started, turns: j.num_turns, cost: j.total_cost_usd, answer: String(j.result || "").slice(0, 2000) };
    }
    const oc = process.env.OPENCODE || "opencode";
    const r = run(oc, ["run", text + PROMPT_TAIL, "--format", "json", ...(model ? ["--model", model] : [])], { cwd: ctx, timeout: 15 * 60 * 1000 });
    const events = (r.stdout || "").split("\n").filter(Boolean).map(l => {
        try {
            return JSON.parse(l);
        } catch {
            return null;
        }
    }).filter(Boolean);
    const tools = events.filter(e => /tool/i.test(e.type || "")).length;
    return { ms: Date.now() - started, turns: tools || undefined, answer: (r.stdout || "").slice(-2000) + (r.stderr || "").slice(-500) };
}

function check(req, mpr, ctx) {
    const c = req.checks || {};
    const fails = [];
    if (c.gap) {
        const gaps = path.join(ctx, "edits", "gaps.jsonl");
        if (!fs.existsSync(gaps)) fails.push("no gap recorded");
        if (fs.existsSync(path.join(path.dirname(mpr), ".mxlocal-backup", "pending", "manifest.json"))) fails.push("a change was planned anyway");
        return fails;
    }
    const pending = path.join(path.dirname(mpr), ".mxlocal-backup", "pending", "manifest.json");
    if (!fs.existsSync(pending)) return ["no dry run left a pending change"];
    const code = JSON.parse(fs.readFileSync(pending, "utf8")).code;
    const ap = mx(["apply", "--code", code], mpr);
    if (!ap.ok || !/Checked:/.test(ap.out)) fails.push("apply failed or check failed: " + ap.out.split("\n").slice(-4).join(" | "));
    exportTo(mpr, ctx);
    for (const name of c.find || []) {
        const r = mx(["find", name], mpr);
        if (!r.out.split("\n").some(l => l.split(/\s+/)[0] === name)) fails.push(`missing ${name}`);
    }
    for (const name of c.absent || []) {
        const r = mx(["find", name], mpr);
        if (r.out.split("\n").some(l => l.split(/\s+/)[0] === name)) fails.push(`still there: ${name}`);
    }
    const files = walk(ctx).map(f => [path.relative(ctx, f).replace(/\\/g, "/"), f]);
    for (const [pathRe, textRe] of Object.entries(c.files || {})) {
        const hits = files.filter(([rel]) => new RegExp(pathRe).test(rel));
        if (!hits.some(([, f]) => new RegExp(textRe).test(fs.readFileSync(f, "utf8")))) fails.push(`no ${pathRe} contains /${textRe}/`);
    }
    return fails;
}

function main() {
    const a = args(process.argv.slice(2));
    if (!a.project) throw new Error("--project <app.mpr> is required");
    const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "requests.json"), "utf8"));
    const only = a.only ? String(a.only).split(",") : null;
    const agent = a.agent || "claude";
    const out = path.resolve(a.out || fs.mkdtempSync(path.join(os.tmpdir(), "mxeval-")));
    const results = [];
    for (const req of spec.requests.filter(r => !only || only.includes(r.id))) {
        const dir = path.join(out, req.id);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.cpSync(path.dirname(path.resolve(a.project)), path.join(dir, "app"), { recursive: true, filter: f => !/[\\/](\.mxlocal-backup|deployment|\.mendix-cache)([\\/]|$)/.test(f) });
        const mpr = path.join(dir, "app", path.basename(a.project));
        const ctx = path.join(dir, "ctx");
        let r;
        try {
            applyPlan([...spec.baseSetup, ...(req.setup || [])], mpr, dir);
            exportTo(mpr, ctx);
            const ag = runAgent(agent, a.model, ctx, req.text);
            const fails = check(req, mpr, ctx);
            r = { id: req.id, ok: !fails.length, fails, ...ag };
        } catch (e) {
            r = { id: req.id, ok: false, fails: [e.message.split("\n")[0]] };
        }
        results.push(r);
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(r, null, 1));
        console.log(`${r.ok ? "PASS" : "FAIL"} ${req.id.padEnd(11)} ${r.turns !== undefined ? `turns ${r.turns}` : ""} ${r.ms ? `${(r.ms / 1000).toFixed(0)}s` : ""} ${r.cost ? `$${r.cost.toFixed(3)}` : ""} ${r.fails.join("; ")}`);
    }
    const pass = results.filter(r => r.ok).length;
    const turns = results.map(r => r.turns).filter(x => x !== undefined).sort((x, y) => x - y);
    console.log(`\n${pass}/${results.length} passed${turns.length ? `, median turns ${turns[Math.floor(turns.length / 2)]}` : ""}. Details: ${out}`);
    fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify({ agent, model: a.model || null, results }, null, 1));
}

try {
    main();
} catch (e) {
    console.error(e.message);
    process.exitCode = 1;
}
