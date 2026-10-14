"use strict";
// selftest phase D: domain model details and app settings (ops-domain.js) on the selftest's copy. Runs calculated
// attributes, access rule edits (also members inherited from System.Image), association settings, view entities
// (Mendix 11; Mendix 10 must refuse), project settings, configurations, image collections and a system text
// translation; then checks the stored keys against Studio Pro's samples, the values, and a clean reopen.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Keys Studio Pro writes for a view entity (testapp-views, Mendix 11.14.0, saved by Studio Pro).
const VIEW_SAMPLE = {
    "DomainModels$ViewEntitySourceDocument": ["Documentation", "Excluded", "ExportLevel", "Name", "Oql"],
    "DomainModels$OqlViewEntitySource": ["SourceDocument"],
    "DomainModels$OqlViewValue": ["Reference"]
};
// No Studio Pro sample in the test projects: the Model SDK's keys.
const SDK_LAYOUT = {
    "DomainModels$CalculatedValue": ["Microflow", "PassEntity"],
    "Settings$ConstantValue": ["Constant", "SharedOrPrivateValue"],
    "Settings$SharedValue": ["Value"],
    "Settings$CustomSetting": ["Name", "Value"]
};
// System.Image members as Studio Pro lists them in a specialization's access rule (Gallery, ImageCropper, ...).
const IMAGE_MEMBERS = ["System.Image.PublicThumbnailPath", "System.Image.EnableCaching", "System.FileDocument.FileID", "System.FileDocument.Name",
    "System.FileDocument.DeleteAfterDownload", "System.FileDocument.Contents", "System.FileDocument.HasContents", "System.FileDocument.Size"];

function png() {
    const crc = b => {
        let c = ~0;
        for (const x of b) {
            c ^= x;
            for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
        }
        return (~c) >>> 0;
    };
    const chunk = (t, d) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(d.length);
        const td = Buffer.concat([Buffer.from(t), d]);
        const c = Buffer.alloc(4);
        c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};
const keysOf = o => Object.keys(o).filter(k => k[0] !== "$").sort().join(",");

async function domainPhase(x) {
    const { reopen, copy, tmp, mod, T, E, role, layout, check, results, layoutProblems, lostProperties, src } = x;
    let s2 = x.s2;
    const v11 = Number(src.version.split(".")[0]) >= 11;
    const cs = (await (await s2.model.allProjectSettings()[0].load()).settingsParts.find(p => p instanceof require("mendixmodelsdk").settings.ConfigurationSettings));
    const config = cs && cs.configurations.length ? cs.configurations[0].name : "Default";
    const edits = path.join(tmp, "edits");
    fs.mkdirSync(edits, { recursive: true });
    const pngBytes = png();
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><rect width=\"8\" height=\"8\" fill=\"#36c\"/></svg>";
    fs.writeFileSync(path.join(edits, "zz-logo.png"), pngBytes);
    fs.writeFileSync(path.join(edits, "zz-icon.svg"), svg);
    s2.client.changeFile = path.join(edits, "zz-domain.json");
    const assoc = `${mod}.${T}Line_${T}`;
    const phaseD = { ops: [
        { op: "createMicroflow", module: mod, name: `${T}_Calc`, folder: "ZzTest", parameters: [{ name: "Item", type: E }], returns: "Integer", returnValue: "$Item/Count * 2" },
        { op: "addAttribute", entity: E, name: "Twice", type: "Integer", calculated: `${E}_Calc` },
        { op: "addAttribute", entity: E, name: "Tmp", type: "Integer", calculated: `${E}_Calc` },
        { op: "changeAttribute", attribute: `${E}.Tmp`, stored: true },
        { op: "createModuleRole", module: mod, name: "ZzRole2" },
        { op: "addAccessRule", entity: E, roles: [`${mod}.ZzRole2`], access: "ReadOnly", xpath: "[Count > 0]", newMembers: "None" },
        { op: "changeAccessRule", entity: E, roles: [role], members: { Twice: "ReadOnly", Title: "ReadOnly" }, delete: true, xpath: "[Count >= 0]", newMembers: "ReadOnly" },
        { op: "addAccessRule", entity: E, roles: [role, `${mod}.ZzRole2`], access: "None" },
        { op: "deleteAccessRule", entity: E, roles: [role, `${mod}.ZzRole2`] },
        { op: "createEntity", module: mod, name: `${T}Img`, generalization: "System.Image", attributes: [{ name: "Caption", type: "String(100)" }] },
        { op: "addAccessRule", entity: `${E}Img`, roles: [role], access: "ReadWrite", create: true, members: { Name: "ReadOnly" } },
        { op: "addAssociation", from: `${E}Line`, to: `${E}Img`, onDeleteFrom: "delete" },
        { op: "changeAssociation", association: assoc, type: "ReferenceSet", owner: "Both", onDeleteTo: "prevent", messageTo: "Still has lines" },
        ...(v11 ? [
            { op: "createViewEntity", module: mod, name: `${T}View`, folder: "ZzTest", oql: `from ${E} as x\nselect x.Title as Title, x.No as No, x.Count * 2 as Twice2`, attributes: [{ name: "Twice2", type: "Integer" }] },
            { op: "changeViewEntity", entity: `${E}View`, oql: `from ${E} as x\nselect x.Title as Title, x.Count * 2 as Twice2, x.Amount as Amount`, attributes: [{ name: "Twice2", type: "Integer" }] },
            { op: "addAccessRule", entity: `${E}View`, roles: [role], access: "ReadOnly" }] : []),
        { op: "createMicroflow", module: mod, name: `${T}_Start`, folder: "ZzTest", returns: "Boolean", returnValue: "true" },
        { op: "createMicroflow", module: mod, name: `${T}_Health`, folder: "ZzTest", returns: "String", returnValue: "''" },
        { op: "setProjectSettings", afterStartup: `${E}_Start`, healthCheck: `${E}_Health`, roundingMode: "HalfEven", firstDayOfWeek: "Monday", defaultTimeZone: "Europe/Amsterdam" },
        { op: "setConfiguration", name: config, constants: { [`${E}_Url`]: "https://zz.example.com" }, customSettings: { ClientRequestTimeout: "60000" } },
        { op: "setConfiguration", name: "ZzAcceptance", applicationRootUrl: "https://zz-acc.example.com/" },
        { op: "createImageCollection", module: mod, name: `${T}Images`, folder: "ZzTest" },
        { op: "addImage", collection: `${E}Images`, file: "edits/zz-logo.png" },
        { op: "addImage", collection: `${E}Images`, file: "edits/zz-icon.svg", name: "Icon" },
        { op: "setTranslations", language: "tr_TR", translations: [{ where: "system:mendix.signin.username", text: "Kullanıcı adı" }] }
    ] };
    const problems = [];
    if (!v11) {
        const refused = await s2.ops.createViewEntity({ module: mod, name: `${T}View`, oql: `from ${E} as x select x.Title as Title` }).then(() => null, e => e.message);
        if (!refused || !/Mendix 10/.test(refused)) problems.push(`createViewEntity on Mendix ${src.version} did not refuse (${refused})`);
    }
    const lint = await s2.ops.runPlan(phaseD, () => {});
    await s2.model.flushChanges();
    const enc = s2.client.encode();
    const lay = layoutProblems(layout, enc);
    const lost = lostProperties(s2.client, s2.model, enc);
    s2.client.project.writeEncoded(enc);
    s2 = await reopen(copy);
    const failed = await s2.ops.checkPlan(phaseD);
    const errs = [];
    for (const u of s2.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s2.model.loadUnitById(u.id, false).catch(e => errs.push(e.message));
    await s2.model.flushChanges();
    if (s2.client.log.length) errs.push(`${s2.client.log.length} deltas on open`);

    // stored values and keys
    const p = s2.ctx.project;
    const found = {};
    let ent = null, img = null, line = null, view = null, viewDoc = null, ms = null, conf = null, coll = null, sys = null, studioImageRule = null;
    for (const id of p.units.keys()) {
        const u = p.read(id);
        walk(u, o => {
            for (const t of [...Object.keys(SDK_LAYOUT), ...Object.keys(VIEW_SAMPLE)]) if (o.$Type === t) (found[t] = found[t] || []).push(o);
            if (o.$Type === "DomainModels$EntityImpl") {
                if (o.Name === T) ent = o;
                if (o.Name === `${T}Img`) img = o;
                if (o.Name === `${T}View`) view = o;
                const g = o.MaybeGeneralization && o.MaybeGeneralization.Generalization;
                if (g === "System.Image" && o.Name !== `${T}Img` && o.AccessRules.length && !studioImageRule) studioImageRule = o.AccessRules[0];
            }
            if (o.$Type === "DomainModels$Association" && o.Name === `${T}Line_${T}`) line = o;
            if (o.$Type === "DomainModels$ViewEntitySourceDocument" && o.Name === `${T}View`) viewDoc = o;
            if (o.$Type === "Settings$ModelSettings") ms = o;
            if (o.$Type === "Settings$ServerConfiguration" && o.Name === config) conf = o;
            if (o.$Type === "Images$ImageCollection" && o.Name === `${T}Images`) coll = o;
            if (o.$Type === "Texts$SystemText" && o.InternalKey === "mendix.signin.username") sys = o;
        });
    }
    for (const [t, keys] of Object.entries({ ...SDK_LAYOUT, ...(v11 ? VIEW_SAMPLE : {}) })) {
        const list = found[t] || [];
        if (!list.length && !(t === "DomainModels$OqlViewEntitySource" && !v11)) problems.push(`no ${t} stored`);
        for (const o of list) if (keysOf(o) !== [...keys].sort().join(",")) problems.push(`${t} keys ${keysOf(o)} (expected ${keys.join(",")})`);
    }
    const twice = ent && ent.Attributes.find(a => a.Name === "Twice");
    if (!twice || twice.Value.$Type !== "DomainModels$CalculatedValue" || twice.Value.Microflow !== `${E}_Calc` || twice.Value.PassEntity !== true) problems.push("Twice is not calculated by _Calc with the object");
    const tmpA = ent && ent.Attributes.find(a => a.Name === "Tmp");
    if (!tmpA || tmpA.Value.$Type !== "DomainModels$StoredValue") problems.push("Tmp is not stored again");
    const rule = ent && ent.AccessRules.find(r => r.AllowedModuleRoles.length === 1 && r.AllowedModuleRoles[0] === role);
    const right = (r, m) => (r.MemberAccesses.find(x => (x.Attribute || x.Association) === m) || {}).AccessRights;
    if (!rule || !rule.AllowDelete || rule.XPathConstraint !== "[Count >= 0]" || rule.DefaultMemberAccessRights !== "ReadOnly" || right(rule, `${E}.Title`) !== "ReadOnly" || right(rule, `${E}.Twice`) !== "ReadOnly") problems.push(`changed access rule of ${E} not stored as asked`);
    const r2 = ent && ent.AccessRules.find(r => r.AllowedModuleRoles.join() === `${mod}.ZzRole2`);
    if (!r2 || right(r2, `${E}.Twice`) !== "ReadOnly" || r2.DefaultMemberAccessRights !== "None") problems.push("second rule: calculated attribute not ReadOnly or new members not None");
    if (ent && ent.AccessRules.some(r => r.AllowedModuleRoles.length === 2)) problems.push("deleteAccessRule left the rule");
    if (rule && ent && ent.Attributes.some(a => !rule.MemberAccesses.some(m => m.Attribute === `${E}.${a.Name}`))) problems.push(`access rule of ${E} misses members of new attributes`);
    const imgRule = img && img.AccessRules[0];
    const sysMembers = imgRule ? imgRule.MemberAccesses.map(m => m.Attribute).filter(a => a && a.startsWith("System.")) : [];
    if (sysMembers.join() !== IMAGE_MEMBERS.join()) problems.push(`${T}Img rule lists System members ${sysMembers.join(", ")}`);
    if (imgRule && (right(imgRule, "System.FileDocument.Name") !== "ReadOnly" || right(imgRule, "System.FileDocument.Size") !== "ReadOnly" || right(imgRule, "System.FileDocument.Contents") !== "ReadWrite")) problems.push(`${T}Img System member rights not as asked (read-only members capped)`);
    if (imgRule && imgRule.MemberAccesses[0].Attribute !== `${E}Img.Caption`) problems.push(`${T}Img rule does not list its own attribute first`);
    if (studioImageRule) {
        const theirs = studioImageRule.MemberAccesses.map(m => m.Attribute).filter(a => a && a.startsWith("System."));
        if (theirs.join() !== IMAGE_MEMBERS.join()) problems.push(`Studio Pro's System.Image rule lists ${theirs.join(", ")}`);
    }
    const db = line && line.DeleteBehavior;
    if (!line || line.Type !== "ReferenceSet" || line.Owner !== "Both" || db.ChildDeleteBehavior !== "DeleteMeIfNoReferences" || !db.ChildErrorMessage || db.ParentErrorMessage !== null) problems.push(`${T}Line_${T} not stored as ReferenceSet/Both/prevent with message`);
    if (line && line.StorageFormat && line.StorageFormat !== "Table") problems.push("reference set not stored in a table");
    if (v11) {
        if (!view || view.Source.SourceDocument !== `${E}View` || !viewDoc || view.Attributes.map(a => `${a.Name}:${a.Value.Reference}`).join() !== "Title:Title,Twice2:Twice2,Amount:Amount") problems.push(`view entity ${T}View not stored like Studio Pro's (${view ? view.Attributes.map(a => a.Name).join(",") : "missing"})`);
        if (view && (view.MaybeGeneralization.Persistable !== true || view.Attributes.find(a => a.Name === "Amount").NewType.$Type !== "DomainModels$DecimalAttributeType")) problems.push("view entity: Persistable or inferred Decimal type wrong");
        if (view && view.AccessRules[0] && view.AccessRules[0].MemberAccesses.some(m => m.AccessRights === "ReadWrite")) problems.push("view entity rule has ReadWrite");
    }
    if (!ms || ms.AfterStartupMicroflow !== `${E}_Start` || ms.HealthCheckMicroflow !== `${E}_Health` || ms.RoundingMode !== "HalfEven" || ms.FirstDayOfWeek !== "Monday" || ms.DefaultTimeZoneCode !== "Europe/Amsterdam") problems.push("project settings not stored");
    if (!conf || !conf.ConstantValues.some(c => c.Constant === `${E}_Url` && c.SharedOrPrivateValue && c.SharedOrPrivateValue.Value === "https://zz.example.com") || !conf.CustomSettings.some(c => c.Name === "ClientRequestTimeout")) problems.push(`configuration ${config} lacks the constant value or custom setting`);
    const logo = coll && coll.Images.find(i => i.Name === "zz_logo");
    const icon = coll && coll.Images.find(i => i.Name === "Icon");
    if (!logo || logo.ImageFormat !== "Png" || !Buffer.from(logo.Image).equals(pngBytes) || !icon || icon.ImageFormat !== "Svg" || Buffer.from(icon.Image).toString() !== svg) problems.push("images not stored byte for byte");
    if (!sys || !sys.Text.Items.some(i => i.LanguageCode === "tr_TR" && i.Text === "Kullanıcı adı")) problems.push("system text translation missing");
    const all = [...lint, ...lay.problems.slice(0, 4), ...lost, ...failed, ...problems, ...errs];
    check(`domain: calculated attribute (and back to stored), access rules changed/added/deleted with member rights, XPath, new-member rights, System.Image members; association type/owner/delete behavior with message; ${v11 ? "view entity created and changed" : `view entity refused on Mendix ${src.version}`}; project settings, configurations (constant value, custom setting, new one), image collection with PNG + SVG, system text translation; keys as Studio Pro's samples (SDK keys where none: CalculatedValue, ConstantValue, CustomSetting), reopen 0 errors`,
        !all.length, all.slice(0, 6).join("; "));
    if (!studioImageRule) results.push("SKIP System.Image members compared with a Studio Pro rule: no access rule on a System.Image specialization in this project (compared with the members Studio Pro lists elsewhere)");
    return s2;
}

module.exports = { domainPhase, VIEW_SAMPLE, IMAGE_MEMBERS };
