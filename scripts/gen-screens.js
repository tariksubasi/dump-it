"use strict";
// Writes the screen catalog for agents from mxlocal/screens: agent/screens/INDEX.md (the router: categories and
// keywords) and agent/screens/<category>.md (its templates with phone/desktop sketches, slots and an example
// createScreen), each with skill front matter so OpenCode / Claude Code can find it by its description.
//
//   node scripts/gen-screens.js            write the files
//   node scripts/gen-screens.js --check    fail when a file is not up to date (CI)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const reg = require(path.join(ROOT, "mxlocal", "screens"));
const OUT = path.join(ROOT, "agent", "screens");

const front = (name, desc) => `---\nname: ${name}\ndescription: ${desc.replace(/\n/g, " ")}\n---\n\n`;
const files = {};
files["INDEX.md"] = front("mendix-screens", "Catalog of ready Mendix screen templates (createScreen) - the router: which category has which screens. Use it when the user asks for a screen or page; then open the category file and let the user pick a sketch.") +
    "# Screen catalog\n\n" + reg.catalog() + "\n\n" + [
    "## How to use it (always these steps)",
    "",
    "1. Find the category of the request in the table above (its keywords).",
    "2. Open guides/screens/<category>.md (or run `python mx.py screens <category>`).",
    "3. Show the user 3-5 of its sketches, numbered, each with its one-line description. Ask which one (or ask about two",
    "   that differ most first). Never build before the user picked a number.",
    "4. Write `edits/<name>.json` with one createScreen: the template id, the user's module and page name, and the slots",
    "   (at least the entity; attributes left out are guessed by type and listed in the dry run).",
    "5. `python mx.py dryrun <name>.json`. Show the user the summary (and the guessed slots). After apply:",
    "   `python mx.py preview <Module.Page>`.",
    "",
    "Options of every template: \"density\": \"compact\" (tighter spacing), \"cardClass\": \"acme-card\" (the company kit's card),",
    "\"menu\": \"Responsive\" (a menu item), \"roles\": [\"Module.Role\"]."
].join("\n") + "\n";
for (const c of reg.categories) {
    files[`${c.id}.md`] = front(`mendix-screens-${c.id}`, `${c.title} - ${c.templates.length} ready Mendix screen templates with sketches (createScreen). Keywords: ${c.keywords.join(", ")}.`) + reg.categoryText(c.id) + "\n";
}

const check = process.argv.includes("--check");
const problems = [];
if (!check) fs.mkdirSync(OUT, { recursive: true });
for (const [f, text] of Object.entries(files)) {
    const p = path.join(OUT, f);
    if (check) {
        if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== text) problems.push(`agent/screens/${f} is not up to date: run node scripts/gen-screens.js`);
    } else fs.writeFileSync(p, text);
}
const extra = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => !files[f]) : [];
for (const f of extra) {
    if (check) problems.push(`agent/screens/${f} belongs to no category: run node scripts/gen-screens.js`);
    else fs.rmSync(path.join(OUT, f));
}
if (problems.length) {
    console.log(problems.join("\n"));
    process.exit(1);
}
const size = Object.values(files).reduce((a, t) => a + t.length, 0);
console.log(`${check ? "screen catalog up to date" : "wrote"}: ${Object.keys(files).length} files, ${reg.byId.size} templates, ${(size / 1024).toFixed(0)} KB`);
