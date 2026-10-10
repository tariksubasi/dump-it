"use strict";
// selftest: runs every operation on a temporary copy of a project and checks the result the way a reviewer would:
// saved without loss, every op visible after a fresh reload, the same BSON layout Studio Pro writes for each type in
// this project, a byte-identical roundtrip, a clean reopen in the Model SDK, and a module rename that leaves no old
// references. Nothing touches the real project.
const fs = require("fs");
const os = require("os");
const path = require("path");
const bson = require("./bson");
const { Project } = require("./mpr");
const { LocalClient, loadProject } = require("./client");
const { lostProperties } = require("./lost");

function plans(mod, T, userRole, grid2) {
    const role = `${mod}.ZzRole`;
    const E = `${mod}.${T}`;
    const phase1 = { ops: [
        { op: "createEnumeration", module: mod, name: `${T}Status`, values: ["Open", { name: "Done", caption: "Done!" }] },
        { op: "createEntity", module: mod, name: T, attributes: [
            { name: "Title", type: "String(100)" }, { name: "Count", type: "Integer" }, { name: "Big", type: "Long" },
            { name: "Amount", type: "Decimal" }, { name: "Flag", type: "Boolean" }, { name: "When", type: "DateTime" },
            { name: "Status", type: `Enum(${mod}.${T}Status)`, default: "Open" }, { name: "No", type: "AutoNumber" }] },
        { op: "createEntity", module: mod, name: `${T}Base`, attributes: [{ name: "CreatedNote", type: "String(200)" }] },
        { op: "createEntity", module: mod, name: `${T}Line`, persistable: true },
        { op: "setGeneralization", entity: `${E}Line`, generalization: `${E}Base` },
        { op: "addAttribute", entity: `${E}Line`, name: "Text", type: "String(unlimited)" },
        { op: "addAssociation", from: `${E}Line`, to: E },
        { op: "addEnumerationValue", enumeration: `${E}Status`, name: "Cancelled" },
        { op: "changeAttribute", attribute: `${E}.Title`, type: "String(200)" },
        { op: "createModuleRole", module: mod, name: "ZzRole" },
        { op: "addAccessRule", entity: E, roles: [role], access: "ReadWrite", create: true, members: { Count: "ReadOnly" } },
        { op: "addValidationRule", entity: E, attribute: "Title", rule: "required", message: "Title is required" },
        { op: "addValidationRule", entity: E, attribute: "Count", rule: "range", min: 0, max: 1000, message: "0..1000" },
        { op: "addValidationRule", entity: E, attribute: "Title", rule: "maxLength", maxLength: 150, message: "Too long" },
        { op: "addIndex", entity: E, attributes: ["Title", { name: "Count", ascending: false }] },
        { op: "createConstant", module: mod, name: `${T}_Url`, type: "String", default: "https://example.com", folder: "ZzTest" },
        { op: "createMicroflow", module: mod, name: `${T}_Sub`, folder: "ZzTest", parameters: [{ name: "Item", type: E }],
            returns: "Boolean", returnValue: "true", actions: [{ action: "log", message: "sub {1}", args: ["$Item/Title"] }] },
        { op: "addEventHandler", entity: E, moment: "Before", event: "Commit", microflow: `${E}_Sub` },
        { op: "createMicroflow", module: mod, name: `${T}_Main`, folder: "ZzTest", roles: [role], actions: [
            { action: "variable", name: "N", type: "Integer", value: "0" },
            { action: "retrieve", variable: "List", entity: E, xpath: "[Flag = true()]" },
            { action: "retrieve", variable: "One", entity: E, first: true },
            { action: "if", condition: "$One = empty", then: [{ action: "message", text: "Nothing found", type: "Warning" }, { action: "end" }] },
            { action: "create", variable: "New", entity: E, set: { Title: "'x'", Count: "1" } },
            { action: "change", variable: "New", set: { Flag: "true" } },
            { action: "loop", over: "List", item: "It", actions: [
                { action: "if", condition: "$It/Count > 10", then: [{ action: "continue" }] },
                { action: "change", variable: "It", set: { Count: "$It/Count + 1" }, commit: true },
                { action: "call", microflow: `${E}_Sub`, args: { Item: "$It" }, variable: "Ok",
                    onError: { rollback: false, actions: [{ action: "log", message: "failed", level: "Error" }, { action: "continue" }] } }] },
            { action: "loop", while: "$N < 3", actions: [{ action: "set", name: "N", value: "$N + 1" }] },
            { action: "commit", variable: "New", onError: { actions: [{ action: "log", message: "commit failed", level: "Error" }] } },
            { action: "call", microflow: `${E}_Sub`, args: { Item: "$New" }, onError: "continue" },
            { action: "message", text: "Done", type: "Information" },
            { action: "delete", variable: "New" }] },
        { op: "addActions", microflow: `${E}_Main`, after: "One", actions: [{ action: "log", message: "inserted" }] },
        { op: "addActions", microflow: `${E}_Main`, after: "New", actions: [{ action: "log", message: "after create" }] },
        { op: "createMicroflow", module: mod, name: `${T}_Job`, folder: "ZzTest", actions: [{ action: "log", message: "job" }] },
        { op: "createScheduledEvent", module: mod, name: `${T}_Nightly`, microflow: `${E}_Job`, every: "Day", at: "02:30", folder: "ZzTest" },
        { op: "createScheduledEvent", module: mod, name: `${T}_Poll`, microflow: `${E}_Job`, every: "Minute", interval: 15, folder: "ZzTest" },
        { op: "createPage", module: mod, name: `${T}_Edit`, entity: E, title: "Edit", folder: "ZzTest", roles: [role] },
        { op: "createPage", module: mod, name: `${T}_Home`, folder: "ZzTest" },
        { op: "createMicroflow", module: mod, name: `${T}_Open`, folder: "ZzTest", actions: [
            { action: "create", variable: "Obj", entity: E },
            { action: "showPage", page: `${E}_Edit`, args: { [T]: "$Obj" } }] },
        { op: "createNanoflow", module: mod, name: `${T}_NF`, folder: "ZzTest", parameters: [{ name: "Item", type: E }], actions: [
            { action: "if", condition: "$Item/Flag", then: [{ action: "message", text: "Flagged" }],
                else: [{ action: "call", microflow: `${E}_Sub`, args: { Item: "$Item" }, variable: "Ok" }] },
            { action: "closePage" }] },
        { op: "createMicroflow", module: mod, name: `${T}_Rest`, folder: "ZzTest", parameters: [{ name: "Id", type: "Long" }], returns: "String", returnValue: "'ok'" },
        { op: "publishRest", module: mod, service: `${T}API`, resource: "items", method: "Get", path: "{Id}", microflow: `${E}_Rest`, roles: [role], folder: "ZzTest" },
        { op: "grantAccess", document: `${E}_Sub`, roles: [role] },
        // dashboard: grid + read-only data view listening to it (side by side), texts, a layout grid with a list view and
        // its data view, buttons, a menu item and home pages
        { op: "createPage", module: mod, name: `${T}_Dash`, entity: E, folder: "ZzTest", roles: [role], menu: "Responsive", widgets: [
            { widget: "text", text: "Dashboard", style: "H2" },
            { widget: "dataGrid", columns: ["Title", "Count", "Status", "When", "Flag"] },
            { widget: "dataView", listenTo: "dataGrid", editable: false },
            { widget: "layoutGrid", columns: [
                { weight: 6, widgets: [{ widget: "listView", fields: ["Title"] }] },
                { weight: 6, widgets: [{ widget: "dataView", listenTo: "listView", fields: ["Title", "Amount"], widgets: [{ widget: "text", text: "Count: {Count}" }],
                    footer: [{ widget: "actionButton", action: "save", closePage: false }, { widget: "actionButton", action: "callNanoflow", nanoflow: `${E}_NF`, caption: "Check" }] }] }] },
            { widget: "container", widgets: [{ widget: "actionButton", action: "showPage", page: `${E}_Home`, caption: "Home" }] }] },
        // Data grid 2 copied from the project's own pages, with a data view listening to it
        ...(grid2 ? [{ op: "createPage", module: mod, name: `${T}_Dash2`, entity: E, folder: "ZzTest", roles: [role], widgets: [
            { widget: "dataGrid", kind: "datagrid2", columns: ["Title", "Count", "Big", "Amount", "Flag", "When", "Status", { attribute: "No", caption: "Number" }], xpath: "[Count > 0]", rows: 15 },
            { widget: "dataView", listenTo: "dataGrid", editable: false }] }] : []),
        { op: "addMenuItem", page: `${E}_Home`, caption: "Zz home" },
        { op: "setHomePage", page: `${E}_Dash` },
        ...(userRole ? [{ op: "setHomePage", page: `${E}_Home`, roles: [userRole] }] : []),
        { op: "moveDocument", document: `${E}_Job`, folder: "ZzTest/Moved" }
    ] };
    return { phase1, role, E };
}

const walkPlain = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walkPlain(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walkPlain(v, fn);
};

// The dashboard as stored: listening data views point at a grid/list view by name, their inputs have SourceVariable
// null (as Studio Pro writes them), the grid has an XPath source, and the menu and home pages open the new pages.
function dashboardProblems(project, mod, T, userRole) {
    const r = [];
    let page = null, nav = null;
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Page" && u.Name === `${T}_Dash`) page = u;
        if (u.$Type === "Navigation$NavigationDocument") nav = u;
    }
    if (!page) return ["page missing"];
    const all = [];
    walkPlain(page, o => all.push(o));
    const named = new Map(all.filter(o => o.Name).map(o => [o.Name, o]));
    const listens = all.filter(o => o.$Type === "Forms$DataView" && o.DataSource && o.DataSource.$Type === "Forms$ListenTargetSource");
    if (listens.length !== 2) r.push(`${listens.length} listening data views, expected 2`);
    for (const dv of listens) {
        const t = named.get(dv.DataSource.ListenTarget);
        if (!t || !/^Forms\$(DataGrid|ListView)$/.test(t.$Type)) r.push(`${dv.Name} listens to '${dv.DataSource.ListenTarget}', which is no grid or list view`);
        walkPlain(dv.Widgets, o => {
            if (/^Forms\$(TextBox|TextArea|CheckBox|DatePicker|DropDown)$/.test(o.$Type) && o.SourceVariable !== null) r.push(`${o.Name} in ${dv.Name} has a SourceVariable (Studio Pro writes null)`);
        });
    }
    const grid = all.find(o => o.$Type === "Forms$DataGrid");
    if (!grid || grid.Columns.length !== 5 || grid.DataSource.$Type !== "Forms$GridXPathSource") r.push("no 5-column grid with an XPath source");
    const prof = nav && nav.Profiles.find(p => p.Kind === "Responsive");
    if (!prof) return r.concat("no Responsive navigation profile");
    const items = [];
    walkPlain(prof.Menu, o => o.$Type === "Forms$FormAction" && items.push(o.FormSettings.Form));
    for (const p of [`${T}_Dash`, `${T}_Home`]) if (!items.includes(`${mod}.${p}`)) r.push(`menu has no item for ${p}`);
    if (prof.HomePage.Page !== `${mod}.${T}_Dash`) r.push(`home page is ${prof.HomePage.Page}`);
    if (userRole && !(prof.HomeItems || []).some(h => h.UserRole === userRole && h.Page === `${mod}.${T}_Home`)) r.push(`no home page for ${userRole}`);
    return r;
}

// The copied Data grid 2: type = installed .mpk, Single selection, the listening data view, 8 columns on the test
// entity, and no reference left to what the original showed (other entities, pages, flows, filter widgets).
function grid2Problems(project, mod, T) {
    const pluggable = require("./pluggable");
    const r = [];
    let page = null;
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Page" && u.Name === `${T}_Dash2`) page = u;
    }
    if (!page) return ["page missing"];
    let grid = null, dv = null;
    walkPlain(page, o => {
        if (o.$Type === "CustomWidgets$CustomWidget" && o.Type.WidgetId === "com.mendix.widget.web.datagrid.Datagrid") grid = o;
        if (o.$Type === "Forms$DataView") dv = o;
    });
    if (!grid) return ["no Data grid 2 on the page"];
    const def = pluggable.installed(project.dir).get(grid.Type.WidgetId);
    const diff = def ? pluggable.typeDiff(grid.Type, def) : ["no .mpk"];
    if (diff.length) r.push(`type differs from widgets/*.mpk: ${diff[0]}`);
    const key = new Map();
    walkPlain(grid.Type, x => x.$Type === "CustomWidgets$WidgetPropertyType" && key.set(x.$ID, x.PropertyKey));
    const prop = (obj, k) => obj.Properties.find(p => key.get(p.TypePointer) === k).Value;
    if (prop(grid.Object, "itemSelection").Selection !== "Single") r.push("selection is not Single");
    if (prop(grid.Object, "columns").Objects.length !== 8) r.push(`${prop(grid.Object, "columns").Objects.length} columns, expected 8`);
    const ds = prop(grid.Object, "datasource").DataSource;
    if (!ds || ds.EntityRef.Entity !== `${mod}.${T}` || ds.XPathConstraint !== "[Count > 0]") r.push("data source is not the test entity with its XPath");
    if (!dv || !dv.DataSource || dv.DataSource.ListenTarget !== grid.Name) r.push(`the data view does not listen to ${grid.Name}`);
    walkPlain(grid.Object, o => {
        if (o.$Type === "DomainModels$AttributeRef" && !o.Attribute.startsWith(`${mod}.${T}.`)) r.push(`refers to ${o.Attribute}`);
        if (o.$Type === "DomainModels$DirectEntityRef" && o.Entity !== `${mod}.${T}`) r.push(`refers to ${o.Entity}`);
        if (/^(Forms|CustomWidgets)\$/.test(o.$Type) && o.Name !== undefined && o !== grid) r.push(`still holds widget ${o.Name}`);
        for (const k of ["Form", "Microflow", "Nanoflow", "Image"]) if (o.$Type === "CustomWidgets$WidgetValue" && o[k]) r.push(`still opens ${o[k]}`);
        if (o.$Type === "CustomWidgets$WidgetValue" && o.Action && o.Action.$Type !== "Forms$NoAction") r.push(`still has action ${o.Action.$Type}`);
    });
    return [...new Set(r)];
}

// Keys and BSON kinds Studio Pro writes per type, from this project's own data (before the change).
function ownLayout(catalog) {
    const layout = new Map();
    for (const [type, keys] of catalog.types) {
        if (catalog.reference && catalog.reference.has(type)) continue;
        layout.set(type, new Map([...keys].filter(([k]) => k[0] !== "$").map(([k, d]) => [k, d.k])));
    }
    return layout;
}

function layoutProblems(layout, enc) {
    const problems = new Set();
    let checked = 0;
    const walk = n => {
        if (n.k !== 3) return;
        const t = n.v.find(([k]) => k === "$Type");
        const want = t && layout.get(t[1].v);
        if (want) {
            checked++;
            const have = new Map(n.v.map(([k, x]) => [k, x.k]));
            for (const k of want.keys()) if (!have.has(k)) problems.add(`${t[1].v} lacks ${k}`);
            for (const [k, kind] of have) {
                if (k[0] === "$") continue;
                if (!want.has(k)) problems.add(`${t[1].v} has extra ${k}`);
                else if (want.get(k) !== kind && kind !== 0x0a && want.get(k) !== 0x0a) problems.add(`${t[1].v}.${k} kind ${kind} (Studio Pro: ${want.get(k)})`);
            }
        }
        for (const [, x] of n.v) {
            if (x.k === 3) walk(x);
            if (x.k === 4) x.v.slice(1).forEach(([, y]) => walk(y));
        }
    };
    for (const f of enc.files) walk(bson.decode(f.bytes));
    return { problems: [...problems], checked };
}

async function reopen(copy) {
    const ctx = await loadProject(copy);
    const client = new LocalClient(ctx);
    const model = await client.open();
    return { ctx, client, model, ops: require("./ops").bind(model, client) };
}

async function selftest(mpr, keep, { out, relevant }) {
    const src = new Project(mpr);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mxlocal-selftest-"));
    const results = [];
    const check = (name, ok, detail) => results.push(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
    try {
        fs.copyFileSync(src.mpr, path.join(tmp, path.basename(src.mpr)));
        fs.cpSync(src.contents, path.join(tmp, "mprcontents"), { recursive: true });
        if (fs.existsSync(path.join(src.dir, "widgets"))) fs.cpSync(path.join(src.dir, "widgets"), path.join(tmp, "widgets"), { recursive: true });
        const copy = path.join(tmp, path.basename(src.mpr));
        const T = "ZzMxlocalTest";

        // phase 1 + 2: every create/change op, then step edits with real step ids
        let s1 = await reopen(copy);
        const custom = s1.model.allModules().filter(m => !m.fromAppStore);
        const mod = (custom.find(m => m.name === "MyFirstModule") || custom[0] || s1.model.allModules()[0]).name;
        const sec = s1.model.allProjectSecurities()[0];
        const userRoles = sec ? (await sec.load()).userRoles.map(u => u.name) : [];
        const userRole = userRoles.includes("Administrator") ? "Administrator" : userRoles[0];
        const grid2 = require("./pluggable").exemplars(s1.ctx.project, "com.mendix.widget.web.datagrid.Datagrid");
        const { phase1, E } = plans(mod, T, userRole, grid2.exemplars.length > 0);
        // pages copy a layout from the project's own pages; a project without any cannot get pages
        const layouts = new Set(s1.model.allLayouts().map(l => l.qualifiedName));
        const pageable = [...s1.ctx.project.units.keys()].some(id => {
            const p = s1.ctx.project.read(id);
            return p.$Type === "Forms$Page" && p.FormCall && layouts.has(p.FormCall.Form);
        });
        const web = s1.model.allNavigationDocuments().length && (await s1.model.allNavigationDocuments()[0].load()).profiles.some(p => p instanceof require("mendixmodelsdk").navigation.NavigationProfile && p.name === "Responsive");
        if (!pageable) {
            phase1.ops = phase1.ops.filter(o => !["createPage", "addMenuItem", "setHomePage"].includes(o.op) && o.name !== `${T}_Open`);
            results.push("SKIP pages and dashboard: this project has no page with a layout to copy");
        } else if (!web) {
            phase1.ops = phase1.ops.filter(o => !["addMenuItem", "setHomePage"].includes(o.op));
            phase1.ops.forEach(o => delete o.menu);
            results.push("SKIP menu and home page: this project has no Responsive navigation profile");
        }
        const layout = ownLayout(s1.ctx.catalog);
        const lint = await s1.ops.runPlan(phase1, () => {});
        const main = await s1.ops.get(`${E}_Main`);
        const ids = {};
        const walk = coll => coll.objects.forEach(o => {
            const a = o.action;
            if (a && a.outputVariableName === "List") ids.retrieve = o.id.slice(0, 8);
            if (a && a.changeVariableName === "N") ids.setN = o.id.slice(0, 8);
            if (a && a.structureTypeName === "Microflows$ShowMessageAction" && !ids.message) ids.message = o.id.slice(0, 8);
            if (o.objectCollection) walk(o.objectCollection);
        });
        walk(main.objectCollection);
        const phase2 = { ops: [
            { op: "changeAction", microflow: `${E}_Main`, id: ids.retrieve, xpath: "[Flag = true() and Count > 0]" },
            { op: "changeAction", microflow: `${E}_Main`, id: ids.message, text: "Nothing at all", disabled: true },
            { op: "deleteAction", microflow: `${E}_Main`, id: ids.setN }
        ] };
        await s1.ops.runPlan(phase2, () => {});
        await s1.model.flushChanges();
        let enc = s1.client.encode();
        const lost = lostProperties(s1.client, s1.model, enc);
        const sum = s1.client.summary();
        const firstUse = relevant(sum.warnings, enc).filter(w => /first use|never occurs/.test(w));
        const lay = layoutProblems(layout, enc);
        s1.client.project.writeEncoded(enc);
        check(`dry run + apply of ${phase1.ops.length + phase2.ops.length} ops`, !lint.length, lint.length ? lint.join("; ") : `${sum.created.length} created, ${sum.updated.length} updated, ${sum.moved.length} moved unit(s)`);
        check("nothing lost on save", !lost.length, lost.join("; "));
        check("same layout as Studio Pro writes in this project", !lay.problems.length, lay.problems.length ? lay.problems.slice(0, 8).join("; ") : `${lay.checked} elements`);

        let s2 = await reopen(copy);
        const failed = await s2.ops.checkPlan({ ops: [...phase1.ops, ...phase2.ops] });
        check("saved model shows every op", !failed.length, failed.join("; "));
        if (pageable) {
            const dash = dashboardProblems(s2.ctx.project, mod, T, web ? userRole : null);
            check("dashboard stored like Studio Pro (listen target, inputs, menu, home pages)", !dash.length, dash.join("; "));
            if (grid2.exemplars.length) {
                const g2 = grid2Problems(s2.ctx.project, mod, T);
                check(`Data grid 2 ${grid2.def.version} copy (type = .mpk, Single selection, listened to, no old references)`, !g2.length, g2.slice(0, 5).join("; "));
            } else results.push(`SKIP Data grid 2 page: ${grid2.reason}`);
        }

        // phase 3: attribute rename + module rename
        const phase3 = { ops: [{ op: "rename", target: `${E}.Flag`, newName: "Active" }, { op: "rename", target: mod, newName: `${mod}Zz` }] };
        await s2.ops.runPlan(phase3, () => {});
        await s2.model.flushChanges();
        enc = s2.client.encode();
        s2.client.project.writeEncoded(enc);
        const s3 = await reopen(copy);
        const stale = s3.client.referencesTo(mod);
        const renamed = await s3.ops.checkPlan({ ops: [{ op: "rename", target: mod, newName: `${mod}Zz` }] });
        check("module rename updates every reference", !stale.length && !renamed.length, [...renamed, ...stale.slice(0, 5).map(x => "still refers to " + mod + ": " + x)].join("; "));

        let bytes = 0;
        for (const [id] of s3.ctx.project.units) if (bson.encode(bson.decode(s3.ctx.project.readBytes(id))).equals(s3.ctx.project.readBytes(id))) bytes++;
        check("byte roundtrip", bytes === s3.ctx.project.units.size, `${bytes}/${s3.ctx.project.units.size}`);
        const errors = [];
        for (const u of s3.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) {
            try {
                await s3.model.loadUnitById(u.id, false);
            } catch (e) {
                errors.push(e.message);
            }
        }
        await s3.model.flushChanges();
        check("reopen with the Model SDK", !errors.length && !s3.client.log.length, errors.length ? errors[0] : s3.client.log.length ? `${s3.client.log.length} deltas on open` : "");
        const vr = require("./versions").checkRules();
        const dv = require("./inspect").api("DataView", src.version);
        const apiOk = /editability/.test(dv) && /ListenTargetSource/.test(dv) && !/^\s+editable: boolean/m.test(dv);
        check(`api for Mendix ${src.version} + version rules`, !vr.problems.length && apiOk, vr.problems.length ? vr.problems.slice(0, 5).join("; ") : apiOk ? `${vr.rules} rules match the SDK` : "api DataView lacks editability/ListenTargetSource");

        out(`Self test on a copy (module ${mod}, Mendix ${src.meta._ProductVersion}):`);
        out(results.map(r => "  " + r).join("\n"));
        if (firstUse.length) out("  Note: first use of these types in this project (layout from other projects or SDK defaults; check the copy in Studio Pro with --keep): " + [...new Set(firstUse.map(w => w.split(" ")[0]))].join(", "));
        const ok = results.every(r => !r.startsWith("FAIL"));
        if (ok && !keep) fs.rmSync(tmp, { recursive: true, force: true });
        else out(`Copy kept: ${tmp} (open it in Studio Pro to inspect, then delete it)`);
        return ok;
    } catch (e) {
        if (results.length) out(results.map(r => "  " + r).join("\n"));
        out(`Self test FAILED: ${e.message}\nCopy kept for inspection: ${tmp}`);
        return false;
    }
}

module.exports = { selftest };
