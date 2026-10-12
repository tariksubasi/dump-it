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
    const M = `${T}Mod`; // a new module with its own roles, user role, demo user and page
    const phase1 = { ops: [
        { op: "createModule", name: M, roles: ["User", "HR"] },
        { op: "createEntity", module: M, name: "Onboarding", attributes: [{ name: "FullName", type: "String(200)" }, { name: "WFH", type: "Boolean" }] },
        { op: "addAccessRule", entity: `${M}.Onboarding`, roles: [`${M}.User`, `${M}.HR`], access: "ReadWrite", create: true, delete: true },
        { op: "createUserRole", name: "ZzHR", moduleRoles: [`${M}.HR`] },
        ...(userRole ? [{ op: "addModuleRoles", userRole, moduleRoles: [`${M}.User`] }] : []),
        { op: "createDemoUser", userName: "zz_demo_hr", userRoles: ["ZzHR"] },
        { op: "setSecurity", demoUsers: true },
        { op: "createPage", module: M, name: "Dashboard", entity: `${M}.Onboarding`, roles: [`${M}.User`, `${M}.HR`],
            widgets: [{ widget: "dataGrid", columns: ["FullName", "WFH"] }, { widget: "dataView", listenTo: "dataGrid", editable: false }] },
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
        { op: "grantAccess", document: `${E}_Rest`, roles: [role] },
        { op: "revokeAccess", document: `${E}_Rest`, roles: [role] },
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
    return { phase1, role, E, M };
}

// A page with every newer widget kind (tab container, group box, snippet call, static and dynamic image, reference
// selector, combo box, gallery) and the common fields (visible, editable, class, style). x: what the project offers
// ({ snippet, image, imageEntity, combo, gallery }); a missing one leaves its widget out (SKIP line).
function widgetPlan(mod, T, x) {
    const E = `${mod}.${T}`;
    const assoc = `${mod}.${T}Line_${T}`;
    const box = [
        { widget: "tabContainer", name: "zzTabs", tabs: [
            { caption: "Main", widgets: [{ widget: "text", text: "Visible by expression", visible: "1 = 1", class: "zz-text" }] },
            { caption: "More", name: "zzTabMore", widgets: [{ widget: "container", style: "padding: 4px;", widgets: [] }] }] },
        ...(x.snippet ? [{ widget: "snippetCall", snippet: x.snippet }] : []),
        ...(x.image ? [{ widget: "image", image: x.image, width: 120, height: "auto" }] : [])
    ];
    return { op: "createPage", module: mod, name: `${T}_Widgets`, entity: E, folder: "ZzTest", widgets: [
        { widget: "groupBox", name: "zzGroup", caption: "Details", collapsible: "expanded", class: "zz-box", style: "margin-top: 8px;", widgets: box },
        { widget: "dataView", name: "zzForm", source: "parameter", widgets: [
            { widget: "text", text: "Flagged: {Title}", visible: { attribute: "Flag" } },
            { widget: "input", attribute: "Title", editable: { attribute: "Status", values: ["Open"] } },
            { widget: "input", attribute: "Count", editable: "$currentObject/Flag", visible: { attribute: "Status", values: ["Open", "Done"] } },
            ...(x.combo ? [{ widget: "comboBox", attribute: "Status", visible: "$currentObject/Flag" }] : [])] },
        { widget: "dataView", name: "zzLineForm", entity: `${E}Line`, source: "parameter", widgets: [
            { widget: "referenceSelector", association: assoc, attribute: "Title", editable: "$currentObject/Text != empty" },
            ...(x.combo ? [{ widget: "comboBox", association: assoc, captionAttribute: "Title", label: "Item" }] : [])] },
        ...(x.gallery ? [{ widget: "gallery", name: "zzGallery", entity: E, xpath: "[Count > 0]", pageSize: 12, columns: 3, widgets: [{ widget: "text", text: "{Title}" }] },
            { widget: "dataView", listenTo: "zzGallery", editable: false, fields: ["Title"] }] : []),
        ...(x.imageEntity ? [{ widget: "dataView", name: "zzPhoto", entity: x.imageEntity, source: "parameter", editable: false, buttons: false, widgets: [{ widget: "image", height: "50%" }] }] : [])
    ] };
}

// What the project offers for widgetPlan: a snippet without parameters, an image, a System.Image entity (persistable,
// outside System), and combo box / gallery copies (pluggable.exemplars).
async function widgetTargets(model, project) {
    const sdk = require("mendixmodelsdk");
    const pl = require("./pluggable");
    const ops = require("./ops-pages");
    const out = { snippet: null, image: null, imageEntity: null };
    for (const sn of [...model.allSnippets()].sort((a, b) => (a.qualifiedName < b.qualifiedName ? -1 : 1))) {
        if (!(await sn.load()).parameters.length) {
            out.snippet = sn.qualifiedName;
            break;
        }
    }
    for (const c of model.allImageCollections()) {
        const col = await c.load();
        if (col.images.length) {
            out.image = `${col.qualifiedName}.${col.images[0].name}`;
            break;
        }
    }
    for (const d of model.allDomainModels()) {
        if (out.imageEntity) break;
        for (const e of (await d.load()).entities) {
            const g = e.generalization;
            if (g instanceof sdk.domainmodels.Generalization && g.generalizationQualifiedName === "System.Image") {
                out.imageEntity = e.qualifiedName;
                break;
            }
        }
    }
    out.comboInfo = pl.exemplars(project, ops.COMBOBOX);
    out.galleryInfo = pl.exemplars(project, ops.GALLERY);
    out.combo = out.comboInfo.exemplars.length > 0;
    out.gallery = out.galleryInfo.exemplars.length > 0;
    return out;
}

// Storage keys of the newer widget types: the same in every Studio Pro sample of the test projects (10.22-11.13).
const WIDGET_KEYS = {
    "Forms$TabControl": "ActivePageAttributeRef ActivePageOnChangeAction ActivePageSourceVariable Appearance ConditionalVisibilitySettings DefaultPagePointer Name TabIndex TabPages",
    "Forms$TabPage": "Badge Caption ConditionalVisibilitySettings Name RefreshOnShow Widgets",
    "Forms$GroupBox": "Appearance CaptionTemplate Collapsible ConditionalVisibilitySettings HeaderMode Name TabIndex Widgets",
    "Forms$SnippetCallWidget": "Appearance FormCall Name TabIndex", "Forms$SnippetCall": "Form ParameterMappings",
    "Forms$StaticImageViewer": "AlternativeText Appearance ClickAction ConditionalVisibilitySettings Height HeightUnit Image Name NativeAccessibilitySettings Responsive TabIndex Width WidthUnit",
    "Forms$ImageViewer": "AlternativeText Appearance ClickAction ConditionalVisibilitySettings DataSource DefaultImage Height HeightUnit Name NativeAccessibilitySettings OnClickEnlarge Responsive ShowAsThumbnail TabIndex Width WidthUnit",
    "Forms$ImageViewerSource": "EntityRef ForceFullObjects SourceVariable",
    "Forms$ReferenceSelector": "Appearance AttributeRef ConditionalEditabilitySettings ConditionalVisibilitySettings Editable EmptyOptionCaption FormattingInfo GotoFormSettings LabelTemplate Name NativeAccessibilitySettings OnChangeAction PopupFormSettings ReadOnlyStyle RenderMode ScreenReaderLabel SelectorSource SourceVariable TabIndex Validation",
    "Forms$SelectorXPathSource": "ConstrainedByRefs SortBar XPathConstraint",
    "Forms$ConditionalVisibilitySettings": "Attribute Conditions Expression IgnoreSecurity ModuleRoles SourceVariable",
    "Forms$ConditionalEditabilitySettings": "Attribute Conditions Expression SourceVariable"
};

// The widget page as stored: Studio Pro's keys per type, every planned kind present, the conditions, the pluggable
// copies typed like widgets/*.mpk, the gallery listened to with Single selection.
function widgetProblems(project, T, x) {
    const pluggable = require("./pluggable");
    const r = [];
    let page = null;
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Page" && u.Name === `${T}_Widgets`) page = u;
    }
    if (!page) return ["page missing"];
    const seen = new Map(), all = [];
    walkPlain(page, o => {
        all.push(o);
        seen.set(o.$Type, (seen.get(o.$Type) || 0) + 1);
        const want = WIDGET_KEYS[o.$Type];
        const have = Object.keys(o).filter(k => k[0] !== "$").sort().join(" ");
        if (want && have !== want) r.push(`${o.$Type} has keys [${have}], Studio Pro stores [${want}]`);
    });
    const need = ["Forms$TabControl", "Forms$GroupBox", "Forms$ReferenceSelector", "Forms$ConditionalVisibilitySettings", "Forms$ConditionalEditabilitySettings",
        ...(x.snippet ? ["Forms$SnippetCallWidget"] : []), ...(x.image ? ["Forms$StaticImageViewer"] : []), ...(x.imageEntity ? ["Forms$ImageViewer"] : [])];
    for (const t of need) if (!seen.has(t)) r.push(`no ${t} stored`);
    if ((seen.get("Forms$TabPage") || 0) !== 2) r.push(`${seen.get("Forms$TabPage") || 0} tab pages, expected 2`);
    if ((seen.get("Forms$ConditionalVisibilitySettings") || 0) < 3) r.push("fewer than 3 visibility conditions");
    const grp = all.find(o => o.$Type === "Forms$GroupBox");
    if (grp && (grp.Collapsible !== "YesInitiallyExpanded" || grp.Appearance.Class !== "zz-box" || grp.Appearance.Style !== "margin-top: 8px;")) r.push("group box without its collapsible / class / style");
    const rs = all.find(o => o.$Type === "Forms$ReferenceSelector");
    if (rs && (!rs.AttributeRef.EntityRef || rs.AttributeRef.EntityRef.Steps.length !== 1 || rs.Editable !== "Conditional")) r.push("reference selector without its association step or conditional editability");
    const cws = all.filter(o => o.$Type === "CustomWidgets$CustomWidget");
    for (const [id, want] of [["com.mendix.widget.web.combobox.Combobox", x.combo ? 2 : 0], ["com.mendix.widget.web.gallery.Gallery", x.gallery ? 1 : 0]]) {
        const ws = cws.filter(o => o.Type.WidgetId === id);
        if (ws.length !== want) r.push(`${ws.length} ${id.split(".").pop()}, expected ${want}`);
        const def = pluggable.installed(project.dir).get(id);
        for (const w of ws) if (!def || pluggable.typeDiff(w.Type, def).length) r.push(`${w.Name}: type differs from widgets/*.mpk`);
    }
    if (x.gallery) {
        const dv = all.find(o => o.$Type === "Forms$DataView" && o.DataSource && o.DataSource.ListenTarget === "zzGallery");
        if (!dv) r.push("no data view listens to zzGallery");
    }
    return [...new Set(r)];
}

// One flow per family of the newer actions: lists, object type decision + cast, validation feedback, rollback, home
// page (microflow and nanoflow), REST calls with text/String and, when the project has them, mappings, Java and
// JavaScript actions and a file document. t = callTargets(); a missing target leaves its action out (SKIP line).
function actionPlans(mod, T, t) {
    const E = `${mod}.${T}`;
    const lists = [
        { action: "retrieve", variable: "All", entity: E },
        { action: "createList", variable: "Picked", entity: E },
        { action: "changeList", list: "Picked", value: "$Item" },
        { action: "changeList", list: "Picked", type: "remove", value: "$Item" },
        { action: "changeList", list: "Picked", type: "clear" },
        { action: "aggregateList", variable: "N", list: "All", function: "count" },
        { action: "aggregateList", variable: "Total", list: "All", function: "sum", attribute: "Amount" },
        { action: "aggregateList", variable: "Weighted", list: "All", function: "sum", expression: "$currentObject/Amount * $currentObject/Count" },
        { action: "listOperation", variable: "Both", operation: "union", list: "All", other: "Picked" },
        { action: "listOperation", variable: "Common", operation: "intersect", list: "All", other: "Picked" },
        { action: "listOperation", variable: "Others", operation: "subtract", list: "All", other: "Picked" },
        { action: "listOperation", variable: "Same", operation: "equals", list: "All", other: "Picked" },
        { action: "listOperation", variable: "Has", operation: "contains", list: "All", other: "Item" },
        { action: "listOperation", variable: "First", operation: "head", list: "All" },
        { action: "listOperation", variable: "Rest", operation: "tail", list: "All" },
        { action: "listOperation", variable: "Found", operation: "find", list: "All", attribute: "Title", value: "'x'" },
        { action: "listOperation", variable: "Small", operation: "find", list: "All", expression: "$currentObject/Count < 10" },
        { action: "listOperation", variable: "Flagged", operation: "filter", list: "All", attribute: "Flag", value: "true" },
        { action: "listOperation", variable: "Big", operation: "filter", list: "All", expression: "$currentObject/Count > 10" },
        { action: "listOperation", variable: "Sorted", operation: "sort", list: "All", sort: ["Title", { attribute: "Count", descending: true }] },
        { action: "listOperation", variable: "Top", operation: "range", list: "Sorted", limit: "10" },
        { action: "validationFeedback", variable: "Item", member: "Title", message: "Title {1} is taken", args: ["$Item/Title"] },
        { action: "rollback", variable: "Item" }
    ];
    const ops = [
        { op: "createMicroflow", module: mod, name: `${T}_Lists`, folder: "ZzTest", parameters: [{ name: "Item", type: E }, { name: "Base", type: `${E}Base` }], actions: [...lists,
            { action: "ifType", variable: "Base", cases: { [`${E}Line`]: [{ action: "cast", variable: "Line" }, { action: "change", variable: "Line", set: { Text: "'cast'" } }] }, empty: [{ action: "showHomePage" }] }] },
        { op: "createNanoflow", module: mod, name: `${T}_NFLists`, folder: "ZzTest", parameters: [{ name: "Item", type: E }, { name: "Base", type: `${E}Base` }], actions: [
            ...lists,
            { action: "ifType", variable: "Base", cases: { [`${E}Line`]: [{ action: "cast", variable: "Line" }] }, other: [{ action: "closePage" }] },
            ...(t.js ? [{ action: "callJavaScript", jsAction: t.js.name, args: t.js.args, ...(t.js.returns ? { variable: "JsResult" } : {}) }] : [])] }
    ];
    const params = [{ name: "Item", type: E }];
    const calls = [
        { action: "callRest", url: "https://api.example.com/items/{1}", urlArgs: ["$Item/Title"], headers: { Accept: "'application/json'" }, variable: "Body" },
        { action: "callRest", method: "Post", url: "https://api.example.com/items", body: "{\"title\": \"{1}\"}", bodyArgs: ["$Item/Title"], timeout: 30, onError: "continue" }
    ];
    if (t.importMapping) {
        calls.push({ action: "callRest", url: "https://api.example.com/import", response: t.importMapping, variable: "Imported", commit: "no" });
        calls.push({ action: "importWithMapping", mapping: t.importMapping, source: "Body", variable: "Parsed" });
    }
    if (t.exportMapping) {
        params.push({ name: "Out", type: t.exportMapping.entity });
        calls.push({ action: "callRest", method: "Post", url: "https://api.example.com/export", exportMapping: t.exportMapping.name, exportObject: "Out" });
    }
    if (t.java) calls.push({ action: "callJava", javaAction: t.java.name, args: t.java.args, ...(t.java.returns ? { variable: "JavaResult" } : {}) });
    if (t.file) {
        params.push({ name: "File", type: t.file });
        calls.push({ action: "downloadFile", variable: "File", showInBrowser: true });
    }
    ops.push({ op: "createMicroflow", module: mod, name: `${T}_Calls`, folder: "ZzTest", parameters: params, actions: calls });
    return ops;
}

// Java and JavaScript actions whose parameters ops can fill (values and entity types), import and export mappings
// with a root object, and an entity that is a file document: the first of each in the project, or null.
async function callTargets(model, E) {
    const sdk = require("mendixmodelsdk");
    const { codeactions, datatypes: dt } = sdk;
    const sample = p => {
        if (p.actionParameterType instanceof codeactions.EntityTypeParameterType) return E;
        const t = p.actionParameterType.type;
        if (t instanceof codeactions.StringType) return "'x'";
        if (t instanceof codeactions.IntegerType) return "1";
        if (t instanceof codeactions.DecimalType) return "1.5";
        if (t instanceof codeactions.BooleanType) return "true";
        if (t instanceof codeactions.DateTimeType) return "[%CurrentDateTime%]";
        return "empty";
    };
    const code = async list => {
        for (const x of list.filter(u => !u.qualifiedName.startsWith("System.")).sort((a, b) => (a.qualifiedName < b.qualifiedName ? -1 : 1))) {
            const d = await x.load();
            const ps = [...d.actionParameters];
            if (d.platform && d.platform.name === "Native") continue;
            if (!ps.every(p => p.actionParameterType instanceof codeactions.BasicParameterType || p.actionParameterType instanceof codeactions.EntityTypeParameterType)) continue;
            return { name: d.qualifiedName, args: Object.fromEntries(ps.map(p => [p.name, sample(p)])), returns: !(d.actionReturnType instanceof codeactions.VoidType) };
        }
        return null;
    };
    const mapping = async (list, ok) => {
        for (const x of list.sort((a, b) => (a.qualifiedName < b.qualifiedName ? -1 : 1))) {
            const d = await x.load();
            const root = d.rootMappingElements[0];
            if (root && root.entity && ok(d, root)) return { name: d.qualifiedName, entity: root.entityQualifiedName };
        }
        return null;
    };
    const noParam = d => !d.parameterType || d.parameterType instanceof dt.UnknownType || d.parameterType instanceof dt.VoidType;
    const im = await mapping(model.allImportMappings(), noParam);
    let file = null;
    for (const d of model.allDomainModels()) {
        if (file) break;
        for (const e of (await d.load()).entities) {
            const g = e.generalization;
            if (g instanceof sdk.domainmodels.Generalization && /^System\.(FileDocument|Image)$/.test(g.generalizationQualifiedName)) {
                file = e.qualifiedName;
                break;
            }
        }
    }
    return {
        java: await code(model.allJavaActions()),
        js: await code(model.allJavaScriptActions()),
        importMapping: im && im.name,
        exportMapping: await mapping(model.allExportMappings(), (d, root) => root.maxOccurs !== -1),
        file
    };
}

// Storage keys Mendix uses (its reflection metamodel; equal to every Studio Pro sample in the test projects) for the
// types the newer actions write, also when this project never used them.
const ACTION_KEYS = {
    "Microflows$ListOperationsAction": "ErrorHandlingType NewOperation ResultVariableName",
    "Microflows$Union": "ListName SecondListOrObjectName", "Microflows$Intersect": "ListName SecondListOrObjectName", "Microflows$Subtract": "ListName SecondListOrObjectName",
    "Microflows$ListEquals": "ListName SecondListOrObjectName", "Microflows$Contains": "ListName SecondListOrObjectName", "Microflows$Filter": "Association Attribute Expression ListName", "Microflows$FindByExpression": "Expression ListName",
    "Microflows$Head": "ListName", "Microflows$Tail": "ListName", "Microflows$Find": "Association Attribute Expression ListName",
    "Microflows$FilterByExpression": "Expression ListName", "Microflows$Sort": "ListName Sortings", "Microflows$ListRange": "CustomRange ListName",
    "Microflows$AggregateAction": "AggregateFunction AggregateVariableName Attribute ErrorHandlingType Expression ReduceInitialValueExpression ReduceReturnDataType UseExpression VariableName",
    "Microflows$CreateListAction": "Entity ErrorHandlingType VariableName", "Microflows$ChangeListAction": "ChangeVariableName ErrorHandlingType Type Value",
    "Microflows$CastAction": "ErrorHandlingType VariableName", "Microflows$InheritanceSplit": "Caption Documentation RelativeMiddlePoint Size SplitVariableName",
    "Microflows$ValidationFeedbackAction": "Association Attribute ErrorHandlingType FeedbackTemplate ValidationVariableName",
    "Microflows$RollbackAction": "ErrorHandlingType RefreshInClient RollbackVariableName", "Microflows$ShowHomePageAction": "ErrorHandlingType",
    "Microflows$JavaActionCallAction": "ErrorHandlingType JavaAction ParameterMappings QueueSettings ResultVariableName UseReturnVariable", "Microflows$JavaActionParameterMapping": "Parameter Value",
    "Microflows$JavaScriptActionCallAction": "ErrorHandlingType JavaScriptAction OutputVariableName ParameterMappings UseReturnVariable", "Microflows$JavaScriptActionParameterMapping": "Parameter ParameterValue",
    "Microflows$RestCallAction": "ErrorHandlingType ErrorResultHandlingType HttpConfiguration ProxyConfiguration RequestHandling RequestHandlingType RequestProxyType ResultHandling ResultHandlingType TimeOutExpression UseRequestTimeOut",
    "Microflows$HttpConfiguration": "ClientCertificate CustomLocation CustomLocationTemplate HttpAuthenticationPassword HttpAuthenticationUserName HttpHeaderEntries HttpMethod OverrideLocation UseHttpAuthentication",
    "Microflows$CustomRequestHandling": "Template", "Microflows$MappingRequestHandling": "ContentType MappingId MappingVariableName", "Microflows$ResultHandling": "Bind ImportMappingCall ResultVariableName VariableType",
    "Microflows$ImportMappingCall": "Commit ContentType ForceSingleOccurrence ObjectHandlingBackup ParameterVariableName Range ReturnValueMapping",
    "Microflows$ImportXmlAction": "ErrorHandlingType IsValidationRequired ResultHandling XmlDocumentVariableName", "Microflows$DownloadFileAction": "ErrorHandlingType FileDocumentVariableName ShowFileInBrowser"
};

// The newer actions as stored: Mendix's keys for each type, every action of the plans present, the object type
// decision with one flow per case (specialization, the entity itself, empty) and Abort error handling in the nanoflow.
function actionProblems(project, T, plannedActions) {
    const r = [];
    const flows = {};
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (/^Microflows\$(Microflow|Nanoflow)$/.test(u.$Type) && u.Name.startsWith(`${T}_`)) flows[u.Name.slice(T.length + 1)] = u;
    }
    const seen = new Map();
    for (const name of ["Lists", "NFLists", "Calls"]) {
        const u = flows[name];
        if (!u) {
            r.push(`${T}_${name} missing`);
            continue;
        }
        walkPlain(u, o => {
            seen.set(o.$Type, (seen.get(o.$Type) || 0) + 1);
            const want = ACTION_KEYS[o.$Type];
            const have = Object.keys(o).filter(k => k[0] !== "$").sort().join(" ");
            if (want && have !== want) r.push(`${o.$Type} has keys [${have}], Mendix stores [${want}]`);
            if (name === "NFLists" && o.ErrorHandlingType && o.ErrorHandlingType !== "Abort") r.push(`${o.$Type} in a nanoflow has ErrorHandlingType ${o.ErrorHandlingType}`);
        });
        const cases = [];
        walkPlain(u.Flows, o => o.$Type === "Microflows$InheritanceCase" && cases.push(o.Value));
        if (name !== "Calls" && cases.length !== 3) r.push(`${T}_${name}: ${cases.length} object type cases, expected 3`);
    }
    for (const t of plannedActions) if (!seen.has(t)) r.push(`no ${t} stored`);
    return [...new Set(r)];
}

// The new module and security as stored: module security with its roles, the user role and demo user in project
// security, Administrator (or the first user role) with the new role, and revokeAccess undone in the flow.
function securityProblems(project, M, E, role, userRole) {
    const r = [];
    let ps = null, ms = null, rest = null;
    const mod = [...project.units.values()].find(u => /^Projects\$Module/.test(project.read(u.id).$Type) && project.read(u.id).Name === M);
    if (!mod) return [`module ${M} missing`];
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Security$ProjectSecurity") ps = u;
        if (u.$Type === "Security$ModuleSecurity" && project.units.get(id).containerId === mod.id) ms = u;
        if (u.$Type === "Microflows$Microflow" && `${E}_Rest`.endsWith("." + u.Name)) rest = u;
    }
    if (!ms || ["User", "HR"].some(n => !ms.ModuleRoles.some(x => x.Name === n))) r.push(`${M} has no module security with roles User and HR`);
    const ur = ps && ps.UserRoles.find(x => x.Name === "ZzHR");
    if (!ur || !ur.ModuleRoles.includes(`${M}.HR`) || !ur.GUID) r.push("user role ZzHR missing, without its module role or GUID");
    const admin = userRole && ps && ps.UserRoles.find(x => x.Name === userRole);
    if (userRole && (!admin || !admin.ModuleRoles.includes(`${M}.User`))) r.push(`${userRole} lacks ${M}.User`);
    const demo = ps && ps.DemoUsers.find(x => x.UserName === "zz_demo_hr");
    if (!demo || !demo.UserRoles.includes("ZzHR") || !demo.Entity) r.push("demo user zz_demo_hr missing or without role/entity");
    if (!ps || !ps.EnableDemoUsers) r.push("demo users are not on");
    if (!rest || (rest.AllowedModuleRoles || []).includes(role)) r.push(`${E}_Rest still allows ${role} after revokeAccess`);
    return r;
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
            if (/^Forms\$(TextBox|TextArea|CheckBox|DatePicker|RadioButtonGroup|DropDown)$/.test(o.$Type) && o.SourceVariable !== null) r.push(`${o.Name} in ${dv.Name} has a SourceVariable (Studio Pro writes null)`);
        });
    }
    if (!all.some(o => o.$Type === "Forms$RadioButtonGroup" && o.Name === "radioButtons1" && o.RenderHorizontal)) r.push("the enumeration Status has no radio buttons radioButtons1 (horizontal)");
    if (page.Title.Items.length !== 1) r.push(`the page title is stored in ${page.Title.Items.length} languages (Studio Pro: the default language only)`);
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

// A named data view of a page with a text box of a project attribute in it (not in a deeper data container): { dv, attr }
function dataViewIn(widgets) {
    let hit = null;
    const inside = (o, dv) => {
        if (hit || !o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(x => inside(x, dv));
        if (o.$Type === "Forms$TextBox" && o.AttributeRef && /^[^.]+\.[^.]+\.[^.]+$/.test(o.AttributeRef.Attribute || "") && !o.AttributeRef.Attribute.startsWith("System.")) hit = { dv, attr: o.AttributeRef.Attribute.split(".").pop() };
        else for (const [k, v] of Object.entries(o)) if (k !== "FooterWidgets" && v && typeof v === "object" && !(v.$Type && v.DataSource && v !== o)) inside(v, dv);
    };
    const find = o => {
        if (hit || !o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(find);
        if (o.$Type === "Forms$DataView" && o.Name) inside(o.Widgets, o.Name);
        for (const v of Object.values(o)) if (v && typeof v === "object") find(v);
    };
    find(widgets);
    return hit;
}

// A page Studio Pro saved (not one of the test's) with a layout grid in its placeholder: { id, qn, grid, column, cls, dv },
// pages with a data view (dv: for inputs) first, then the test module's own pages.
function editablePage(project, mod, T, M) {
    const pick = [];
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type !== "Forms$Page" || u.Name.startsWith(T) || !u.FormCall) continue;
        let m = project.units.get(id);
        while (m && !/^Projects\$Module/.test(project.read(m.id).$Type)) m = project.units.get(m.containerId);
        const modName = m && project.read(m.id).Name;
        if (!modName || modName === M) continue;
        for (const arg of u.FormCall.Arguments || []) {
            const g = (arg.Widgets || []).find(w => w.$Type === "Forms$LayoutGrid" && w.Rows.length && w.Rows[0].Columns.length);
            if (g) {
                pick.push({ id, qn: `${modName}.${u.Name}`, grid: g.Name, column: `${g.Name}/row 1/column 1`, cls: g.Appearance.Class, own: modName === mod, dv: dataViewIn(u.FormCall.Arguments) });
                break;
            }
        }
    }
    return pick.sort((a, b) => !!b.dv - !!a.dv || b.own - a.own || a.qn.localeCompare(b.qn))[0] || null;
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

// GetPut for one unit: its bytes before and after are equal once the elements an op may touch (ids; added and
// removed ones are found here) are cut out of both: list items dropped, parts reduced to their $ID.
const idOf = n => (n.k === 3 ? ((n.v.find(([k]) => k === "$ID") || [])[1] || {}).v : null);
const hex = v => (Buffer.isBuffer(v) ? v.toString("hex") : String(v));
function idsIn(n, out = new Set()) {
    if (n.k === 3) {
        const id = idOf(n);
        if (id !== undefined && id !== null) out.add(hex(id));
        for (const [, x] of n.v) idsIn(x, out);
    } else if (n.k === 4) n.v.slice(1).forEach(([, x]) => idsIn(x, out));
    return out;
}
function cut(n, ids) {
    const gone = x => x.k === 3 && idOf(x) !== undefined && ids.has(hex(idOf(x)));
    if (n.k === 3) return { k: 3, v: n.v.map(([k, x]) => [k, gone(x) ? { k: 3, v: x.v.filter(([kk]) => kk === "$ID") } : cut(x, ids)]) };
    if (n.k === 4) return { k: 4, v: [n.v[0], ...n.v.slice(1).filter(([, x]) => !gone(x)).map(([, x], i) => [String(i + 1), cut(x, ids)])] };
    return n;
}
function sameOutside(before, after, ids = new Set()) {
    const a = bson.decode(before), b = bson.decode(after);
    const ia = idsIn(a), ib = idsIn(b);
    const added = [...ib].filter(x => !ia.has(x)), removed = [...ia].filter(x => !ib.has(x));
    const all = new Set([...ids, ...added, ...removed]);
    const ca = cut(a, all), cb = cut(b, all);
    return { same: bson.encode(ca).equals(bson.encode(cb)), compared: idsIn(ca).size, added: added.length, removed: removed.length };
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
        const { phase1, E, M, role } = plans(mod, T, userRole, grid2.exemplars.length > 0);
        const wt = await widgetTargets(s1.model, s1.ctx.project);
        phase1.ops.push(widgetPlan(mod, T, wt));
        // pages copy a layout from the project's own pages; a project without any cannot get pages
        const layouts = new Set(s1.model.allLayouts().map(l => l.qualifiedName));
        const pageable = [...s1.ctx.project.units.keys()].some(id => {
            const p = s1.ctx.project.read(id);
            return p.$Type === "Forms$Page" && p.FormCall && layouts.has(p.FormCall.Form);
        });
        const web = s1.model.allNavigationDocuments().length && (await s1.model.allNavigationDocuments()[0].load()).profiles.some(p => p instanceof require("mendixmodelsdk").navigation.NavigationProfile && p.name === "Responsive");
        if (pageable) {
            const skips = { snippet: "snippet call (no snippet without parameters)", image: "static image (no image collection)", imageEntity: "dynamic image (no entity inheriting System.Image)" };
            for (const [k, what] of Object.entries(skips)) if (!wt[k]) results.push(`SKIP ${what}`);
            if (!wt.combo) results.push(`SKIP combo box: ${wt.comboInfo.reason}`);
            if (!wt.gallery) results.push(`SKIP gallery: ${wt.galleryInfo.reason}`);
        }
        if (!pageable) {
            phase1.ops = phase1.ops.filter(o => !["createPage", "addMenuItem", "setHomePage"].includes(o.op) && o.name !== `${T}_Open`);
            results.push("SKIP pages, dashboard and widget page: this project has no page with a layout to copy");
        } else if (!web) {
            phase1.ops = phase1.ops.filter(o => !["addMenuItem", "setHomePage"].includes(o.op));
            phase1.ops.forEach(o => delete o.menu);
            results.push("SKIP menu and home page: this project has no Responsive navigation profile");
        }
        // the newer microflow/nanoflow actions; calls to Java/JavaScript actions, mappings and file downloads only
        // where the project has something to call
        const targets = await callTargets(s1.model, E);
        const missing = { java: "callJava (no Java action with value or entity type parameters)", js: "callJavaScript (no such JavaScript action)", importMapping: "importWithMapping and a REST call with an import mapping (no import mapping without parameter)", exportMapping: "a REST call with an export mapping body (no export mapping of one object)", file: "downloadFile (no file document entity)" };
        for (const [k, what] of Object.entries(missing)) if (!targets[k]) results.push(`SKIP ${what}`);
        phase1.ops.push(...actionPlans(mod, T, targets));
        const plannedActions = ["AggregateAction", "ListOperationsAction", "CreateListAction", "ChangeListAction", "ValidationFeedbackAction", "RollbackAction", "CastAction", "InheritanceSplit", "ShowHomePageAction", "RestCallAction", "CustomRequestHandling",
            "Union", "Intersect", "Subtract", "ListEquals", "Contains", "Head", "Tail", "Find", "FindByExpression", "Filter", "FilterByExpression", "Sort", "ListRange",
            ...(targets.importMapping ? ["ImportXmlAction", "ImportMappingCall"] : []), ...(targets.exportMapping ? ["MappingRequestHandling"] : []), ...(targets.java ? ["JavaActionCallAction"] : []),
            ...(targets.js ? ["JavaScriptActionCallAction"] : []), ...(targets.file ? ["DownloadFileAction"] : [])].map(x => "Microflows$" + x);
        const layout = ownLayout(s1.ctx.catalog);
        const lint = await s1.ops.runPlan(phase1, () => {});
        const ids = {};
        const walk = coll => coll.objects.forEach(o => {
            const a = o.action;
            if (a && a.outputVariableName === "List") ids.retrieve = o.id.slice(0, 8);
            if (a && a.changeVariableName === "N") ids.setN = o.id.slice(0, 8);
            if (a && a.structureTypeName === "Microflows$ShowMessageAction" && !ids.message) ids.message = o.id.slice(0, 8);
            if (a && a.outputVariableName === "Total") ids.total = o.id.slice(0, 8);
            if (a && a.outputVariableName === "Found") ids.found = o.id.slice(0, 8);
            if (a && a.structureTypeName === "Microflows$RestCallAction" && !ids.rest) ids.rest = o.id.slice(0, 8);
            if (o.objectCollection) walk(o.objectCollection);
        });
        for (const flow of ["Main", "Lists", "Calls"]) walk((await s1.ops.get(`${E}_${flow}`)).objectCollection);
        const phase2 = { ops: [
            { op: "changeAction", microflow: `${E}_Main`, id: ids.retrieve, xpath: "[Flag = true() and Count > 0]" },
            { op: "changeAction", microflow: `${E}_Main`, id: ids.message, text: "Nothing at all", disabled: true },
            { op: "deleteAction", microflow: `${E}_Main`, id: ids.setN },
            { op: "changeAction", microflow: `${E}_Lists`, id: ids.total, function: "average", attribute: "Count" },
            { op: "changeAction", microflow: `${E}_Lists`, id: ids.found, value: "'y'" },
            { op: "changeAction", microflow: `${E}_Calls`, id: ids.rest, url: "https://api.example.com/v2/items/{1}", method: "Put", timeout: 60 }
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
        const secp = securityProblems(s2.ctx.project, M, E, role, userRole);
        check("new module, user role, demo user, addModuleRoles, revokeAccess stored", !secp.length, secp.join("; "));
        const actp = actionProblems(s2.ctx.project, T, plannedActions);
        check(`newer actions stored with Mendix's keys (${plannedActions.length} kinds: lists, aggregates, object type decision + cast, feedback, rollback, REST${targets.java ? ", Java" : ""}${targets.js ? ", JavaScript" : ""}${targets.importMapping ? ", import mapping" : ""}${targets.file ? ", download" : ""})`, !actp.length, actp.slice(0, 6).join("; "));
        if (pageable) {
            const dash = dashboardProblems(s2.ctx.project, mod, T, web ? userRole : null);
            check("dashboard stored like Studio Pro (listen target, inputs, menu, home pages)", !dash.length, dash.join("; "));
            if (grid2.exemplars.length) {
                const g2 = grid2Problems(s2.ctx.project, mod, T);
                check(`Data grid 2 ${grid2.def.version} copy (type = .mpk, Single selection, listened to, no old references)`, !g2.length, g2.slice(0, 5).join("; "));
            } else results.push(`SKIP Data grid 2 page: ${grid2.reason}`);
            const wp = widgetProblems(s2.ctx.project, T, wt);
            const kinds = ["tab container", "group box", "reference selector", wt.snippet && "snippet call", wt.image && "image", wt.imageEntity && "dynamic image", wt.combo && "combo box x2", wt.gallery && "gallery"].filter(Boolean);
            check(`widget page stored with Studio Pro's keys (${kinds.join(", ")}; visible, editable, class, style)`, !wp.length, wp.slice(0, 5).join("; "));
        }

        // phase 4 + 5: change a page Studio Pro saved (add into a column, change a caption and a class), then move the
        // text into the new container, delete that and put the class back: the page must be byte for byte what it was
        const pe = editablePage(s2.ctx.project, mod, T, M);
        if (!pe) results.push("SKIP page edit: no page of this project has a layout grid in its placeholder");
        else {
            const orig = s2.ctx.project.readBytes(pe.id);
            const phase4 = { ops: [
                { op: "addWidgets", page: pe.qn, into: pe.column, widgets: [{ widget: "text", text: "Zz edit", style: "H3", name: "zzText" },
                    { widget: "groupBox", name: "zzBox", caption: "Zz box", collapsible: "collapsed", class: "zz-edit", widgets: [{ widget: "actionButton", action: "close", name: "zzClose" },
                        { widget: "tabContainer", name: "zzTabs", tabs: [{ caption: "Zz tab", name: "zzTab", widgets: [{ widget: "text", text: "In a tab", visible: "1 = 1" }] }] }] }] },
                { op: "changeWidget", page: pe.qn, widget: "zzClose", caption: "Zz close", buttonStyle: "Primary" },
                { op: "changeWidget", page: pe.qn, widget: pe.grid, class: `${pe.cls} zz-edited`.trim() }
            ] };
            // in a data view: an input and an {Attribute} text in its entity, read-only and conditionally visible
            if (pe.dv) phase4.ops.push({ op: "addWidgets", page: pe.qn, into: pe.dv.dv, widgets: [{ widget: "input", attribute: pe.dv.attr, label: "Zz input", name: "zzInput" },
                { widget: "text", text: `Zz {${pe.dv.attr}}`, name: "zzAttrText" }] },
            { op: "changeWidget", page: pe.qn, widget: "zzInput", editable: false, visible: `$currentObject/${pe.dv.attr} != empty` });
            await s2.ops.runPlan(phase4, () => {});
            await s2.model.flushChanges();
            enc = s2.client.encode();
            const lay4 = layoutProblems(layout, enc);
            const file = enc.files.find(f => f.id === pe.id);
            const grid = s2.client.project.read(pe.id).FormCall.Arguments.flatMap(a => a.Widgets).find(w => w.Name === pe.grid);
            const gp = file ? sameOutside(orig, file.bytes, new Set([grid.Appearance.$ID].map(x => require("./convert").guidToBytes(x).toString("hex")))) : { same: false };
            const lost4 = lostProperties(s2.client, s2.model, enc);
            s2.client.project.writeEncoded(enc);
            let s4 = await reopen(copy);
            const failed4 = await s4.ops.checkPlan(phase4);
            const ok4 = !lay4.problems.length && gp.same && !failed4.length && !lost4.length;
            check(`page edit on ${pe.qn}: add a group box with a tab container into ${pe.column}${pe.dv ? ` and ${pe.dv.dv}` : ""}, change a caption, a class${pe.dv ? ", editable, visible" : ""}: stored like Studio Pro, rest unchanged`, ok4,
                [...lay4.problems.slice(0, 3), gp.same ? "" : "bytes outside the new widgets and the changed class differ", ...failed4, ...lost4].filter(Boolean).join("; ") || `${gp.added} element(s) added, ${gp.compared} unchanged`);
            if (!pe.dv) results.push("SKIP page edit in a data view: no page with a layout grid has a data view with a text box");
            // the move is proven by the delete: zzText is gone only if it was moved into zzBox
            const phase5 = { ops: [
                { op: "moveWidget", page: pe.qn, widget: "zzText", into: "zzBox" },
                { op: "deleteWidget", page: pe.qn, widget: "zzBox" },
                { op: "changeWidget", page: pe.qn, widget: pe.grid, class: pe.cls },
                ...(pe.dv ? ["zzInput", "zzAttrText"].map(w => ({ op: "deleteWidget", page: pe.qn, widget: w })) : [])
            ] };
            await s4.ops.runPlan(phase5, () => {});
            await s4.model.flushChanges();
            s4.client.project.writeEncoded(s4.client.encode());
            s4 = await reopen(copy);
            const failed5 = await s4.ops.checkPlan(phase5);
            const back = s4.ctx.project.readBytes(pe.id).equals(orig);
            check(`page edit undone by moveWidget + deleteWidget + changeWidget: ${pe.qn} byte for byte as Studio Pro saved it`, back && !failed5.length, back ? failed5.join("; ") : "the page bytes differ from the original");
            s2 = await reopen(copy);
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

module.exports = { selftest, sameOutside, layoutProblems, ownLayout };
