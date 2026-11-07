#!/usr/bin/env node
// Checks a widget .mpk before you put it in a Mendix app. No npm install needed (Node 18+).
// Usage: node tools/check-mpk.mjs path/to/widget.mpk [more.mpk ...]
// Catches "Unable to resolve module ../widgets/<a>/<b>/<Name>" (Metro red screen) and empty web widgets:
// the widget id in the XML must match the folder and file names inside the mpk.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

function readZip(path) {
    const buf = readFileSync(path);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error("not a zip file (an .mpk is a zip)");
    }
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const entries = new Map();
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) {
            throw new Error("broken zip directory");
        }
        const method = buf.readUInt16LE(p + 10);
        const size = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
        entries.set(name, () => {
            const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            const raw = buf.subarray(start, start + size);
            return (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
        });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

function attr(xml, tag, name) {
    const m = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(xml);
    return m ? m[1] : undefined;
}

function check(mpk) {
    const problems = [];
    const entries = readZip(mpk);
    const names = [...entries.keys()];
    const pkg = entries.get("package.xml");
    if (!pkg) {
        return [`package.xml is missing. Build with "npm run release", do not zip by hand.`];
    }
    const pkgXml = pkg();
    const widgetFiles = [...pkgXml.matchAll(/<widgetFile\s+path="([^"]+)"/g)].map(m => m[1]);
    const filePaths = [...pkgXml.matchAll(/<file\s+path="([^"]+)"/g)].map(m => m[1].replace(/\/$/, ""));
    if (widgetFiles.length === 0) {
        problems.push("package.xml lists no <widgetFile>.");
    }
    for (const wf of widgetFiles) {
        const read = entries.get(wf);
        if (!read) {
            problems.push(`package.xml names ${wf}, but the mpk has no such file.`);
            continue;
        }
        const xml = read();
        const id = attr(xml, "widget", "id");
        const platform = attr(xml, "widget", "supportedPlatform") ?? "Web";
        if (!id) {
            problems.push(`${wf}: <widget id="..."> is missing.`);
            continue;
        }
        const parts = id.split(".");
        const name = parts[parts.length - 1];
        const folder = parts.slice(0, -1).join("/");
        const base = `${folder}/${name}`;
        console.log(`  widget ${id} (${platform}) -> expects ${base}.*`);
        const expected = name.toLowerCase();
        if (parts[parts.length - 2] !== expected) {
            const fixed = [...parts.slice(0, -2), expected, name].join(".");
            problems.push(
                `id "${id}": the part before the name must be "${expected}" (widgetName in lower case). ` +
                    `The build tool writes the files to ${[...parts.slice(0, -2), expected].join("/")}/. ` +
                    `Fix: id="${fixed}" in the XML and <file path="${[...parts.slice(0, -2), expected].join("/")}"/> ` +
                    `in package.xml, rebuild, then in Studio Pro delete the old widget from the pages and place the new one.`
            );
        }
        if (!filePaths.includes(folder)) {
            problems.push(`package.xml <file path> is [${filePaths.join(", ")}], but the id needs "${folder}".`);
        }
        const native = platform === "Native" || platform === "All";
        const web = platform === "Web" || platform === "All";
        if (native) {
            for (const os of ["android", "ios"]) {
                if (!names.includes(`${base}.${os}.js`) && !names.includes(`${base}.js`)) {
                    problems.push(`native: ${base}.${os}.js is missing -> Metro "Unable to resolve module ../widgets/${base}".`);
                }
            }
        }
        if (web && platform !== "All" && !names.includes(`${base}.js`) && !names.includes(`${base}.mjs`)) {
            problems.push(`web: ${base}.js is missing -> the widget is empty in the browser.`);
        }
        if (platform === "Web" && names.some(n => n.endsWith(".android.js"))) {
            problems.push(`supportedPlatform is Web, but the mpk has native files. Use "Native" in the XML.`);
        }
    }
    const js = names.filter(n => /\.(android\.js|ios\.js|js|mjs)$/.test(n) && n.includes("/"));
    if (problems.length) {
        console.log(`  files in the mpk: ${js.join(", ") || "(no widget code files)"}`);
    }
    return problems;
}

const files = process.argv.slice(2);
if (files.length === 0) {
    console.log("Usage: node tools/check-mpk.mjs path/to/widget.mpk");
    process.exit(2);
}
let failed = false;
for (const f of files) {
    console.log(f);
    let problems;
    try {
        problems = check(f);
    } catch (e) {
        problems = [String(e.message ?? e)];
    }
    if (problems.length) {
        failed = true;
        problems.forEach(p => console.log(`  FAIL ${p}`));
    } else {
        console.log("  OK");
    }
}
process.exit(failed ? 1 : 0);
