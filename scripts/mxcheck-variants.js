"use strict";
// Diagnosis for a mx check error on the configuration constant values (CE1613 'Dummy.Constant'): prints the stored
// ConstantValues of the kept selftest copy and the constants they name, then runs mx check on variants of the copy
// (the value removed, a flat Value added, a private value, the constant by its unit name) to show which shape Studio
// Pro accepts. CI runs it only when the mx check step failed.
//
//   node scripts/mxcheck-variants.js <kept selftest copy folder>
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const bson = require("../mxlocal/bson");
const { toPlain, fromPlain } = require("../mxlocal/convert");
// kinds of the few fields a variant adds (Value: a string)
const hint = (type, key, v) => (typeof v === "string" ? { k: 0x02 } : typeof v === "boolean" ? { k: 0x08 } : typeof v === "number" ? { k: 0x10 } : undefined);
const read = f => toPlain(bson.decode(fs.readFileSync(f)));

const dir = process.argv[2];
const mpr = fs.readdirSync(dir).find(f => f.endsWith(".mpr"));
if (!mpr) throw new Error(`no .mpr in ${dir}`);
const units = [];
const walkDir = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walkDir(p);
        else if (e.name.endsWith(".mxunit")) units.push(p);
    }
};
walkDir(path.join(dir, "mprcontents"));
const show = v => JSON.stringify(v, (k, x) => (Buffer.isBuffer(x) ? `<${x.toString("hex")}>` : typeof x === "bigint" ? Number(x) : x));
const rel = f => path.relative(path.join(dir, "mprcontents"), f);
let settingsFile = null;
const constants = [];
for (const f of units) {
    const u = read(f);
    if (u.$Type === "Settings$ProjectSettings") settingsFile = f;
    if (u.$Type === "Constants$Constant") constants.push(`${u.Name} (${rel(f)})`);
}
const settings = read(settingsFile);
const confs = settings.Settings.find(s => s.$Type === "Settings$ConfigurationSettings").Configurations;
for (const c of confs) console.log(`configuration ${c.Name}: ${show(c.ConstantValues)}`);
console.log(`constants: ${constants.join(", ")}`);

const variants = {
    asStored: cv => cv,
    withoutValue: () => null,
    flatValueToo: cv => ({ ...cv, Value: cv.SharedOrPrivateValue && cv.SharedOrPrivateValue.Value !== undefined ? cv.SharedOrPrivateValue.Value : "" }),
    flatValueOnly: cv => {
        const { SharedOrPrivateValue, ...rest } = cv;
        return { ...rest, Value: SharedOrPrivateValue && SharedOrPrivateValue.Value !== undefined ? SharedOrPrivateValue.Value : "" };
    },
    privateValue: cv => ({ ...cv, SharedOrPrivateValue: { $ID: cv.SharedOrPrivateValue.$ID, $Type: "Settings$PrivateValue" } })
};
const mx = path.join(__dirname, "..", "mxlocal", "mxlocal.js");
for (const [name, fn] of Object.entries(variants)) {
    const to = path.join(path.dirname(dir), `variant-${name}`);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(to);
    fs.copyFileSync(path.join(dir, mpr), path.join(to, mpr));
    fs.cpSync(path.join(dir, "mprcontents"), path.join(to, "mprcontents"), { recursive: true });
    const s = read(settingsFile);
    for (const c of s.Settings.find(x => x.$Type === "Settings$ConfigurationSettings").Configurations) c.ConstantValues = c.ConstantValues.map(fn).filter(Boolean);
    fs.writeFileSync(path.join(to, "mprcontents", rel(settingsFile)), bson.encode(fromPlain(s, hint)));
    let out = "";
    try {
        out = execFileSync("node", [mx, "check", "--project", path.join(to, mpr)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
        out = String(e.stdout || "") + String(e.stderr || "");
    }
    const lines = out.split("\n").filter(l => /errors?,|CE\d{4}|not run|FAILED/.test(l));
    console.log(`== variant ${name}:\n${lines.slice(0, 6).join("\n")}`);
}
