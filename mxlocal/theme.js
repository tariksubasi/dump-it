"use strict";
// Theme files (SCSS, CSS, design-properties.json) under theme/ and themesource/: plain files, changed through the
// same dry run (with a diff), approval code, backup and restore as the model (files.js).
const files = require("./files");
const { fail } = require("./ops-util");

const ROOTS = ["theme", "themesource"];
const EXT = /\.(scss|css|json)$/i;
const DEFAULT_CSS_FILE = "theme/web/main.scss";

const THEME_OPS = {
    editThemeFile: {
        doc: "Change a theme file (theme/web/*.scss, themesource/<module>/web/*.scss, design-properties.json): new content, find/replace edits, or text appended. Shown as a diff in the dry run; backed up and undone like model changes.",
        fields: {
            path: "R file under theme/ or themesource/, e.g. theme/web/custom-variables.scss (.scss, .css or .json)",
            content: "optional the whole new content (also creates a new file)",
            edits: "optional [ { \"find\": \"exact text\", \"replace\": \"new text\", \"all\": true/false } ]: each find must occur exactly once (or all: true)",
            append: "optional text added at the end of the file"
        }
    },
    addCssClass: {
        doc: "Add a CSS class rule to the app theme (default theme/web/main.scss), for widgets' class field.",
        fields: {
            name: "R class name without the dot, e.g. card-highlight",
            css: "R declarations: \"background-color: #fff; padding: 8px\" or { \"background-color\": \"#fff\", \"padding\": \"8px\" }",
            file: "optional theme file (default theme/web/main.scss), e.g. theme/web/custom-variables.scss or themesource/<module>/web/main.scss"
        }
    }
};

function makeTheme({ client }) {
    const dir = client.project.dir;
    const text = rel => {
        const b = files.current(client, rel);
        if (b && !files.isText(b)) throw new Error(`${rel} is not a text file`);
        return b === null ? null : b.toString("utf8");
    };
    const near = (body, find) => {
        const first = String(find).split(/\r?\n/).find(l => l.trim()) || "";
        const word = first.trim().slice(0, 30);
        const lines = body.split(/\r?\n/);
        const i = lines.findIndex(l => word && l.includes(word.split(/\s+/)[0]));
        return i >= 0 ? ` (line ${i + 1}: ${JSON.stringify(lines[i].trim().slice(0, 80))}; find must match exactly, spaces and line breaks too)` : "";
    };
    const checkJson = (rel, body) => {
        if (!/\.json$/i.test(rel)) return;
        try {
            JSON.parse(body);
        } catch (e) {
            throw new Error(`${rel} would not be valid JSON after this edit: ${e.message}`);
        }
    };
    // Unbalanced { } would break the theme compile in Studio Pro (comments and strings are skipped).
    const balanced = (rel, body) => {
        if (!/\.(scss|css)$/i.test(rel)) return;
        let depth = 0;
        const s = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
        for (const c of s) {
            if (c === "{") depth++;
            else if (c === "}" && --depth < 0) break;
        }
        if (depth !== 0) throw new Error(`${rel}: the braces { } would not balance after this edit (${depth > 0 ? "a } is missing" : "an extra }"})`);
    };
    const pathOf = (p, where) => {
        const rel = files.projectPath(dir, p, ROOTS, where);
        if (!EXT.test(rel)) throw new Error(`${where}: only .scss, .css and .json theme files can change here ('${rel}')`);
        return rel;
    };

    async function editThemeFile(o) {
        const where = `editThemeFile ${o.path}`;
        const rel = pathOf(o.path, where);
        const kinds = ["content", "edits", "append"].filter(k => o[k] !== undefined);
        if (!kinds.length) throw new Error(`${where}: give content, edits or append`);
        if (o.content !== undefined && kinds.length > 1) throw new Error(`${where}: content replaces the whole file; do not combine it with edits or append`);
        let body = text(rel);
        const created = body === null;
        if (created && o.content === undefined) {
            const scss = [...new Set(ROOTS.flatMap(r => listScss(dir, r)))].slice(0, 15);
            fail(`${where}: ${rel} does not exist (give content to create it; theme files: ${scss.join(", ") || "none"})`, rel, scss);
        }
        const done = [];
        if (o.content !== undefined) {
            body = String(o.content);
            done.push(created ? "created" : "content replaced");
        }
        if (o.edits !== undefined) {
            if (!Array.isArray(o.edits) || !o.edits.length) throw new Error(`${where}: edits is a list [ { "find": ..., "replace": ... } ]`);
            for (const [i, e] of o.edits.entries()) {
                const w = `${where} edits[${i + 1}]`;
                if (!e || typeof e !== "object" || typeof e.find !== "string" || !e.find || e.replace === undefined) throw new Error(`${w}: needs { "find": "exact text", "replace": "new text" }`);
                for (const k of Object.keys(e)) if (!["find", "replace", "all"].includes(k)) fail(`${w}: unknown field '${k}'`, k, ["find", "replace", "all"]);
                const n = body.split(e.find).length - 1;
                if (!n) throw new Error(`${w}: ${JSON.stringify(e.find.slice(0, 80))} is not in ${rel}${near(body, e.find)}`);
                if (n > 1 && e.all !== true) throw new Error(`${w}: ${JSON.stringify(e.find.slice(0, 80))} occurs ${n} times in ${rel}; make find longer so it is unique, or add "all": true`);
                body = body.split(e.find).join(String(e.replace));
                done.push(`${n} replacement(s)`);
            }
        }
        if (o.append !== undefined) {
            const add = String(o.append);
            body = body + (body && !body.endsWith("\n") ? "\n" : "") + add + (add.endsWith("\n") ? "" : "\n");
            done.push(`${add.split("\n").length} line(s) appended`);
        }
        checkJson(rel, body);
        balanced(rel, body);
        if (created && /\.scss$/i.test(rel) && !/(^|\/)(main|custom-variables)\.scss$/i.test(rel) && !/^_/.test(rel.split("/").pop())) client.warn(`${where}: Studio Pro compiles main.scss of each theme folder; @import "${rel.split("/").pop().replace(/\.scss$/, "")}" in main.scss next to it, or the new rules are not used`);
        files.stage(client, rel, body);
        return `${rel}: ${done.join(", ")}`;
    }

    async function addCssClass(o) {
        const where = `addCssClass ${o.name}`;
        const name = String(o.name).replace(/^\./, "");
        if (!/^-?[A-Za-z_][\w-]*$/.test(name)) throw new Error(`${where}: '${o.name}' is not a valid CSS class name (letters, digits, - and _; no spaces)`);
        const rel = pathOf(o.file !== undefined ? o.file : DEFAULT_CSS_FILE, where);
        if (!/\.(scss|css)$/i.test(rel)) throw new Error(`${where}: ${rel} is not a .scss or .css file`);
        const body = text(rel);
        if (body === null) {
            const scss = ROOTS.flatMap(r => listScss(dir, r)).slice(0, 15);
            throw new Error(`${where}: ${rel} does not exist${o.file === undefined ? " (this project has no theme/web/main.scss)" : ""}; give 'file' (theme files: ${scss.join(", ") || "none; create one with editThemeFile content"})`);
        }
        if (new RegExp(`\\.${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(body.replace(/\/\*[\s\S]*?\*\//g, ""))) throw new Error(`${where}: ${rel} already has a rule for .${name}; change it with editThemeFile edits`);
        let decls;
        if (o.css && typeof o.css === "object" && !Array.isArray(o.css)) decls = Object.entries(o.css).map(([k, v]) => `${k}: ${v}`);
        else decls = String(o.css).split(";").map(x => x.trim()).filter(Boolean);
        if (!decls.length) throw new Error(`${where}: css is empty`);
        for (const d of decls) if (!/^[-\w$]+\s*:\s*\S/.test(d) || /[{}]/.test(d)) throw new Error(`${where}: '${d}' is not a CSS declaration (property: value)`);
        const rule = `.${name} {\n${decls.map(d => `    ${d.replace(/\s*:\s*/, ": ")};`).join("\n")}\n}\n`;
        const out = body + (body && !body.endsWith("\n") ? "\n" : "") + (body ? "\n" : "") + rule;
        balanced(rel, out);
        files.stage(client, rel, out);
        return `${rel}: .${name} { ${decls.length} declaration(s) } (use it with "class": "${name}" on a widget)`;
    }

    const checks = {
        async editThemeFile(o) {
            const rel = files.projectPath(dir, o.path, ROOTS, "check");
            const b = files.onDisk(dir, rel);
            if (b === null) return [`${rel} is missing`];
            const s = b.toString("utf8");
            const r = [];
            // later ops of the same change may edit the file again: then its first line is enough
            const first = String(o.content || "").split("\n").find(l => l.trim()) || "";
            if (o.content !== undefined && s !== String(o.content) && !s.includes(first)) r.push(`${rel} does not have the given content`);
            for (const e of Array.isArray(o.edits) ? o.edits : []) if (e && e.replace && !s.includes(String(e.replace))) r.push(`${rel} lacks ${JSON.stringify(String(e.replace).slice(0, 60))}`);
            if (o.append !== undefined && !s.includes(String(o.append).trim())) r.push(`${rel} lacks the appended text`);
            return r;
        },
        async addCssClass(o) {
            const rel = files.projectPath(dir, o.file !== undefined ? o.file : DEFAULT_CSS_FILE, ROOTS, "check");
            const b = files.onDisk(dir, rel);
            return b && b.toString("utf8").includes(`.${String(o.name).replace(/^\./, "")} {`) ? [] : [`${rel} has no .${o.name} rule`];
        }
    };

    return { impl: { editThemeFile, addCssClass }, checks };
}

function listScss(dir, root) {
    const fs = require("fs");
    const path = require("path");
    const out = [];
    const walk = (d, rel, depth) => {
        if (depth > 4 || !fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/${e.name}`, depth + 1);
            else if (/\.scss$/.test(e.name) && /\/web(\/|$)/.test(`${rel}/`)) out.push(`${rel}/${e.name}`);
        }
    };
    walk(path.join(dir, root), root, 0);
    return out;
}

module.exports = { makeTheme, THEME_OPS };
