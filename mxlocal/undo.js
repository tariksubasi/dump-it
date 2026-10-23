"use strict";
// Selective undo: the inverse plan of one applied change (or of some of its ops), shown as a normal dry run.
// restore puts the whole model back and refuses when later work would be lost; this builds ops that undo only the
// chosen ops of that change on the model as it is now: create -> delete, add -> delete, grant <-> revoke, rename back,
// move back, change -> the previous values (read from the change's backup, the model before that apply). Ops that
// cannot be inverted (deletes, flow and page edits, ...) are listed; for those only restore helps.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { backups, restore, BACKUP_DIR } = require("./mpr");

const typeName = t => t && t.structureTypeName.split("$")[1].replace("AttributeType", "");

// The change file of a backup: { plan, name }.
function changeOf(dir, name) {
    const all = backups(dir);
    const pick = name && name !== true ? String(name) : all[all.length - 1];
    if (!pick) throw new Error("Nothing to undo: no applied change (no backup) in this project.");
    if (!all.includes(pick)) throw new Error(`No applied change '${pick}' (backups: ${all.slice(-8).join(", ") || "none"}; an undone one ends in .restored)`);
    const backup = path.join(dir, BACKUP_DIR, pick);
    const file = path.join(backup, "change.json");
    if (!fs.existsSync(file)) throw new Error(`No change file in ${pick} (a script change, or applied by an old version): only restore can undo it`);
    const plan = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!plan || !Array.isArray(plan.ops)) throw new Error(`${pick}/change.json has no ops`);
    return { plan, name: pick, backup };
}

// The model before the apply: a copy of the project with the backup put back (only when an op needs old values).
async function beforeModel(mpr, backup) {
    const dir = path.dirname(mpr);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-undo-"));
    fs.copyFileSync(mpr, path.join(tmp, path.basename(mpr)));
    if (fs.existsSync(path.join(dir, "mprcontents"))) fs.cpSync(path.join(dir, "mprcontents"), path.join(tmp, "mprcontents"), { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, "manifest.json"), "utf8"));
    // unit files only: the plain files and sources are not needed to read old values
    const units = copyBackup(backup, manifest);
    try {
        restore(tmp, units);
    } finally {
        fs.rmSync(units, { recursive: true, force: true });
    }
    const { LocalClient, loadProject } = require("./client");
    const client = new LocalClient(await loadProject(path.join(tmp, path.basename(mpr))));
    const model = await client.open();
    return { tmp, ops: require("./ops").bind(model, client) };
}

// A backup folder without the plain files and sources (restore of units and .mpr only).
function copyBackup(backup, manifest) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-undo-m-"));
    const units = manifest.restore.filter(rel => /\.mxunit$/.test(rel));
    for (const rel of units) {
        fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
        fs.copyFileSync(path.join(backup, rel), path.join(out, rel));
    }
    fs.copyFileSync(path.join(backup, manifest.mpr), path.join(out, manifest.mpr));
    fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ mpr: manifest.mpr, restore: units, remove: manifest.remove.filter(rel => /\.mxunit$/.test(rel)) }));
    return out;
}

const QN = (m, n) => `${m}.${n}`;
const del = target => ({ op: "delete", target });

// Inverse ops of one op. Returns { ops } or { reason }. old: async () => ops bound to the model before the apply.
async function invert(o, old) {
    const name = o.op;
    switch (name) {
        case "createEntity": case "createViewEntity": case "createEnumeration": case "createConstant": case "createScheduledEvent": case "createMicroflow": case "createNanoflow":
        case "createRule": case "createJavaScriptAction": case "createLayout": case "createSnippet": case "createWorkflow": case "createJsonStructure": case "createImportMapping":
        case "createExportMapping": case "createConsumedRestService": case "createMenu": case "createXmlSchema": case "createMessageDefinition": case "createXmlImportMapping":
        case "createXmlExportMapping": case "createImageCollection": case "createModuleRole":
            return { ops: [del(QN(o.module, o.name))] };
        case "createJavaAction":
            return { ops: [del(QN(o.module, o.name))], note: `its file javasource/${String(o.module).toLowerCase()}/actions/${o.name}.java stays (remove it by hand)` };
        case "createPage": {
            const ops = [del(QN(o.module, o.name))];
            if (o.kind === "userTaskPage" && o.entity) ops.push(del(QN(o.module, `${o.name}_Context`)));
            return { ops, note: o.menu ? "its menu item stays: deleteMenuItem" : undefined };
        }
        case "createUnitTest":
            return { ops: [del(QN(o.module, /^test/i.test(String(o.name)) ? String(o.name).replace(/^test_?/i, "Test_") : `Test_${o.name}`))] };
        case "addAttribute":
            return { ops: [del(`${o.entity}.${o.name}`)] };
        case "addAssociation":
            return { ops: [del(`${String(o.from).split(".")[0]}.${o.name || `${String(o.from).split(".")[1]}_${String(o.to).split(".").pop()}`}`)] };
        case "addEnumerationValue":
            return { ops: [del(`${o.enumeration}.${o.name}`)] };
        case "grantAccess":
            return { ops: [{ op: "revokeAccess", document: o.document, roles: o.roles }] };
        case "revokeAccess":
            return { ops: [{ op: "grantAccess", document: o.document, roles: o.roles }] };
        case "addValidationRule":
            return { ops: [{ op: "deleteValidationRule", entity: o.entity, attribute: o.attribute, rule: o.rule }] };
        case "addEventHandler":
            return { ops: [{ op: "deleteEventHandler", entity: o.entity, moment: o.moment, event: o.event, microflow: o.microflow }] };
        case "addIndex":
            return { ops: [{ op: "deleteIndex", entity: o.entity, index: [].concat(o.attributes).map(a => (typeof a === "string" ? a : a.name)) }] };
        case "addAccessRule":
            return { ops: [{ op: "deleteAccessRule", entity: o.entity, roles: o.roles }] };
        case "addMenuItem":
            return o.caption ? { ops: [{ op: "deleteMenuItem", item: o.caption, ...(o.profile ? { profile: o.profile } : {}), ...(o.menu ? { menu: o.menu } : {}) }] } : { reason: "a menu item without a caption: delete it by its page with deleteMenuItem" };
        case "rename": {
            const parts = String(o.target).split(".");
            return { ops: [{ op: "rename", target: parts.slice(0, -1).concat(o.newName).join("."), newName: parts[parts.length - 1] }] };
        }
        case "moveAttribute": {
            const [m, e, a] = String(o.attribute).split(".");
            return { ops: [{ op: "moveAttribute", attribute: `${o.to}.${o.newName || a}`, to: `${m}.${e}`, ...(o.newName ? { newName: a } : {}), ...(o.allowDataLoss ? { allowDataLoss: true } : {}) }], note: o.allowDataLoss ? "the dropped values do not come back (only restore of a database backup brings them)" : undefined };
        }
        case "moveDocument": {
            const doc = await (await old()).get(o.document);
            const parts = [];
            for (let c = doc.container; c && c.structureTypeName !== "Projects$Module"; c = c.container) parts.unshift(c.name);
            return { ops: [{ op: "moveDocument", document: o.document, folder: parts.join("/") }] };
        }
        case "changeAttribute": {
            const a = await (await old()).get(o.attribute);
            const t = typeName(a.type);
            const spec = t === "String" ? `String(${a.type.length === 0 ? "unlimited" : a.type.length})` : t === "Enumeration" ? `Enum(${a.type.enumerationQualifiedName})` : t;
            const calc = a.value && a.value.structureTypeName === "DomainModels$CalculatedValue";
            const back = { op: "changeAttribute", attribute: o.attribute };
            if (o.type !== undefined) back.type = spec;
            if (calc && (o.calculated !== undefined || o.stored !== undefined)) back.calculated = a.value.microflowQualifiedName;
            else if (!calc && o.calculated !== undefined) back.stored = true;
            if (!calc && (o.default !== undefined || o.type !== undefined || o.calculated !== undefined)) back.default = a.value.defaultValue;
            return { ops: [back] };
        }
        case "setGeneralization": {
            const e = await (await old()).get(o.entity);
            const g = e.generalization;
            const parent = g && g.structureTypeName === "DomainModels$Generalization" ? g.generalizationQualifiedName : null;
            return { ops: [{ op: "setGeneralization", entity: o.entity, generalization: parent || "none", ...(parent ? {} : { persistable: g.persistable }) }] };
        }
        case "changeConstant": {
            const c = await (await old()).get(o.constant);
            const back = { op: "changeConstant", constant: o.constant, default: c.defaultValue };
            if (o.type !== undefined) back.type = typeName(c.type).replace(/Type$/, "");
            if (o.exposedToClient !== undefined) back.exposedToClient = c.exposedToClient;
            return { ops: [back] };
        }
        default:
            return { reason: /^(delete|change|move|add(Actions|Widgets))/.test(name) ? "its old content is not rebuilt by an op" : "no inverse op" };
    }
}

// The inverse plan (later ops undone first) and the ops left out with the reason.
async function undoPlan(mpr, name, pickOps) {
    const dir = path.dirname(mpr);
    const { plan, name: picked, backup } = changeOf(dir, name);
    const n = plan.ops.length;
    const want = pickOps && pickOps !== true ? String(pickOps).split(",").map(s => s.trim()).filter(Boolean).map(Number) : plan.ops.map((_, i) => i + 1);
    for (const i of want) if (!Number.isInteger(i) || i < 1 || i > n) throw new Error(`Op ${i} is not in ${picked}: it has ops 1..${n} (--op 1,3)`);
    let before = null;
    const old = async () => (before = before || (await beforeModel(mpr, backup))).ops;
    const ops = [], lines = [], left = [];
    try {
        for (const i of [...new Set(want)].sort((a, b) => b - a)) {
            const o = plan.ops[i - 1];
            let r;
            try {
                r = await invert(o, old);
            } catch (e) {
                r = { reason: `old values not readable: ${e.message.split("\n")[0]}` };
            }
            if (r.ops) {
                ops.push(...r.ops);
                lines.push(`  ${i}. ${o.op} -> ${r.ops.map(x => x.op + " " + (x.target || x.attribute || x.document || x.entity || x.constant || x.item || "")).join(", ")}${r.note ? ` (NOTE: ${r.note})` : ""}`);
            } else left.push(`  ${i}. ${o.op}: ${r.reason}`);
        }
    } finally {
        if (before) fs.rmSync(before.tmp, { recursive: true, force: true });
    }
    return { plan: { ops }, lines, left, name: picked, count: n };
}

module.exports = { undoPlan, invert, changeOf };
