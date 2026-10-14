"use strict";
// selftest phase pages2: attribute paths over references (classic / Data grid 2 columns, texts, inputs, sort, search,
// list views, conditions, selectors), the action model (create over an association, openLink static and from an
// attribute, signOut, sync, callWorkflow; confirm, progress, abortOnValidationErrors, maintainSelection, pageTitle) on
// buttons, grid buttons, onClick and menu items, input validation (required, custom) and formats, data view form
// settings, page variables, text box events (onEnter, onLeave, onEnterKeyPress), select page, Data grid 2 export,
// native bottom bar and home page; the refusals (to-many path, wrong path, confirm on a non-flow action, format on a
// wrong type, sync / export / native where the project has no offline profile / Data Widgets / native profile). Every
// stored key is compared with what Studio Pro writes in the project (layoutProblems), the values with the Studio
// Pro-saved samples of the test projects (Mendix 10.22-11.14), and the copy reopens with 0 errors and 0 deltas.
const bson = require("./bson");
const { lostProperties } = require("./lost");

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};
const steps = ref => (ref && ref.EntityRef && ref.EntityRef.Steps ? ref.EntityRef.Steps.map(s => s.Association) : []);
const text = t => (t && t.Items && t.Items[0] ? t.Items[0].Text : "");

// What the project offers: pages, a web menu, Data grid 2 (+ filters), combo box, Data Widgets export, offline and
// native profiles, native layouts.
async function pages2Targets(s) {
    const project = s.ctx.project, model = s.model;
    const pl = require("./pluggable");
    const sdk = require("mendixmodelsdk");
    const layouts = new Set(model.allLayouts().map(l => l.qualifiedName));
    const x = { pageable: false, web: false, grid2: false, filters: false, combo: false, exportJs: false, offline: null, nativeProfile: false, nativeLayout: false };
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Page" && u.FormCall && layouts.has(u.FormCall.Form)) x.pageable = true;
        if (u.$Type === "Forms$Layout" && u.Content && u.Content.$Type === "Forms$NativeLayoutContent") x.nativeLayout = true;
        if (u.$Type === "JavaScriptActions$JavaScriptAction" && u.Name === "Export_To_Excel" && model.allJavaScriptActions().some(j => j.qualifiedName === "DataWidgets.Export_To_Excel")) x.exportJs = true;
    }
    const nav = model.allNavigationDocuments()[0] ? await model.allNavigationDocuments()[0].load() : null;
    for (const p of nav ? nav.profiles : []) {
        if (!(p instanceof sdk.navigation.NavigationProfile)) x.nativeProfile = true;
        else if (p.name === "Responsive") x.web = true;
        if (p instanceof sdk.navigation.NavigationProfile && /offline/i.test(p.kind ? p.kind.name : "")) x.offline = p.name;
    }
    const inst = pl.installed(project.dir);
    x.grid2 = inst.has("com.mendix.widget.web.datagrid.Datagrid");
    x.filters = x.grid2 && ["datagridtextfilter.DatagridTextFilter", "datagridnumberfilter.DatagridNumberFilter"].every(f => [...inst.keys()].some(id => id.endsWith(f)));
    x.combo = inst.has("com.mendix.widget.web.combobox.Combobox");
    return x;
}

function pages2Plan(mod, T, x, userRole) {
    const E = `${mod}.${T}`, C = `${E}P2Cust`, O = `${E}P2Ord`, K = `${E}P2Country`;
    const OC = `${E}P2Ord_${T}P2Cust`, CK = `${E}P2Cust_${T}P2Country`;
    const cust = `${T}P2Cust`, ock = `${T}P2Ord_${T}P2Cust`, ckk = `${T}P2Cust_${T}P2Country`;
    const pg = n => `${E}_P2${n}`;
    const ops = [
        { op: "createEntity", module: mod, name: `${T}P2Country`, attributes: [{ name: "Name", type: "String(100)" }] },
        { op: "createEntity", module: mod, name: `${T}P2Cust`, attributes: [{ name: "Name", type: "String(200)" }, { name: "Active", type: "Boolean" }, { name: "Web", type: "String(200)" }] },
        { op: "createEntity", module: mod, name: `${T}P2Ord`, attributes: [{ name: "Number", type: "Integer" }, { name: "Total", type: "Decimal" }, { name: "Placed", type: "DateTime" },
            { name: "Note", type: "String(200)" }, { name: "St", type: `Enum(${E}Status)` }] },
        { op: "addAssociation", from: O, to: C },
        { op: "addAssociation", from: C, to: K }
    ];
    const refuse = [];
    if (x.pageable) {
        ops.push(
            { op: "createPage", module: mod, name: `${T}_P2Edit`, entity: O, folder: "ZzP2" },
            { op: "createPage", module: mod, name: `${T}_P2Select`, folder: "ZzP2", widgets: [{ widget: "dataGrid", entity: C, columns: ["Name"] }] },
            { op: "createMicroflow", module: mod, name: `${T}_P2Del`, folder: "ZzP2", parameters: [{ name: "Ord", type: O }], actions: [{ action: "delete", variable: "Ord" }] },
            { op: "createNanoflow", module: mod, name: `${T}_P2Nf`, folder: "ZzP2", parameters: [{ name: "Text", type: "String" }], actions: [] },
            { op: "createMicroflow", module: mod, name: `${T}_P2WfStep`, folder: "ZzP2", actions: [{ action: "log", message: "step" }] },
            { op: "createWorkflow", module: mod, name: `${T}_P2Wf`, folder: "ZzP2", context: C, steps: [{ step: "callMicroflow", microflow: `${E}_P2WfStep` }] },
            // G1 paths + G2 grid buttons + G5 column formats + G12 export + G11 select page
            { op: "createPage", module: mod, name: `${T}_P2Grid`, entity: O, folder: "ZzP2", widgets: [
                { widget: "dataGrid", name: "zz2Classic", columns: ["Number", `${ock}/Name`, { attribute: `${cust}/${ckk}/Name`, caption: "Country" }, { attribute: "Total", format: { decimals: 3, groupDigits: true } }, { attribute: "Placed", format: { date: "dd-MM-yyyy" } }],
                    sort: [`${OC}/Name`], search: [`${cust}/Name`, "Number"],
                    buttons: [{ action: "new", page: pg("Edit"), pageTitle: "New order", name: "zz2New" },
                        { action: "callMicroflow", microflow: `${E}_P2Del`, caption: "Delete", confirm: { question: "Delete?", proceed: "Yes", cancel: "No" }, progress: "blocking", progressMessage: "Deleting", maintainSelection: true, name: "zz2Del" },
                        { action: "openLink", caption: "Help", url: "https://docs.mendix.com", name: "zz2Help" }] },
                { widget: "dataView", name: "zz2Detail", listenTo: "zz2Classic", fields: ["Number", `${cust}/Name`], widgets: [
                    { widget: "text", name: "zz2Text", text: `Customer {${cust}/Name} in {${cust}/${ckk}/Name}: {Total}`, format: { Total: { decimals: 2 } } },
                    { widget: "container", name: "zz2Box", visible: { attribute: `${cust}/Active` }, widgets: [{ widget: "text", text: "active" }] },
                    { widget: "referenceSelector", name: "zz2Ref", association: OC, attribute: `${ock}/Name`, selectPage: pg("Select"), required: true },
                    ...(x.combo ? [{ widget: "comboBox", name: "zz2Combo", association: OC, captionAttribute: `${ckk}/Name` }] : [])],
                    footer: [{ widget: "actionButton", action: "save", closePage: false }] },
                { widget: "listView", name: "zz2List", fields: ["Number", `${cust}/Name`], search: [`${cust}/Name`], sort: [`${cust}/Name`] },
                ...(x.grid2 ? [{ widget: "dataGrid", kind: "datagrid2", name: "zz2Grid", columns: ["Number", `${cust}/Name`, { dynamicText: `{Number}: {${cust}/Name} {Total}`, caption: "Both", format: { Total: { decimals: 1 } } }],
                    filters: x.filters, sort: [{ attribute: `${cust}/Name`, direction: "desc" }], onClick: { action: "showPage", page: pg("Edit"), pageTitle: "Order" },
                    ...(x.exportJs ? { export: { fileName: "Orders", caption: "Excel" } } : {}) }] : [])] },
            // G2 on buttons in a data view and a list item
            { op: "createPage", module: mod, name: `${T}_P2Cust`, entity: C, folder: "ZzP2", widgets: [
                { widget: "dataView", name: "zz2CustDv", source: "parameter", fields: ["Name"], widgets: [
                    { widget: "actionButton", name: "zz2Create", action: "create", page: pg("Edit"), association: OC, caption: "New order", pageTitle: "New order" },
                    { widget: "actionButton", name: "zz2Web", action: "openLink", caption: "Site", url: { attribute: "Web" } },
                    { widget: "actionButton", name: "zz2Mail", action: "openLink", caption: "Mail", email: "info@example.com" },
                    { widget: "actionButton", name: "zz2Wf", action: "callWorkflow", workflow: `${E}_P2Wf`, caption: "Start", confirm: "Start it?", closePage: true },
                    { widget: "listView", name: "zz2Orders", source: "association", association: OC, widgets: [{ widget: "text", text: "{Number}" },
                        { widget: "actionButton", name: "zz2DelOrd", action: "callMicroflow", microflow: `${E}_P2Del`, caption: "Delete", confirm: true, progress: "nonBlocking", abortOnValidationErrors: false }] }],
                    footer: [{ widget: "actionButton", action: "save" }, { widget: "actionButton", name: "zz2Out", action: "signOut" }] }] },
            // G3 / G5 / G6 / G8 / G10
            { op: "createPage", module: mod, name: `${T}_P2Form`, entity: O, folder: "ZzP2", variables: [{ name: "Search", type: "String", default: "''" }, { name: "Min", type: "Integer", default: "1" }], widgets: [
                { widget: "textBox", name: "zz2Search", variable: "Search", onEnterKeyPress: { action: "callNanoflow", nanoflow: `${E}_P2Nf`, params: { Text: "$Search" } } },
                { widget: "dataView", name: "zz2Form", source: "parameter", orientation: "vertical", readOnlyStyle: "text", showFooter: true, fields: [], widgets: [
                    { widget: "textBox", name: "zz2Note", attribute: "Note", required: true, requiredMessage: "Note is needed", maxLength: 50, placeholder: "a note", readOnlyStyle: "control", inputMask: "aaa",
                        onEnter: { action: "callNanoflow", nanoflow: `${E}_P2Nf`, params: { Text: "$currentObject/Note" } }, onLeave: "save" },
                    { widget: "textBox", name: "zz2Total", attribute: "Total", validation: { expression: "$value >= 0", message: "Not negative" }, format: { decimals: 2, groupDigits: true } },
                    { widget: "datePicker", name: "zz2Placed", attribute: "Placed", required: true, format: { date: "dd-MM-yyyy HH:mm" } },
                    { widget: "dropDown", name: "zz2St", attribute: "St", required: true },
                    { widget: "referenceSelector", name: "zz2Cust", association: OC, required: true, readOnlyStyle: "text" }],
                    footer: [{ widget: "actionButton", action: "save" }] }] },
            { op: "changeWidget", page: pg("Form"), widget: "zz2Total", required: true, requiredMessage: "Total!", format: { decimals: 1 } },
            { op: "changeWidget", page: pg("Form"), widget: "zz2Form", orientation: "horizontal", labelWidth: 4, readOnlyStyle: "control" },
            { op: "changeWidget", page: pg("Form"), widget: "zz2Note", required: false, onLeave: { action: "openLink", url: "https://example.com" } },
            { op: "changeWidget", page: pg("Grid"), widget: "zz2Classic", columns: { add: [{ attribute: `${cust}/Active`, caption: "Active" }] } },
            { op: "changeWidget", page: pg("Grid"), widget: "zz2Text", text: `Who: {${cust}/Name}` },
            { op: "changeWidget", page: pg("Cust"), widget: "zz2Mail", action: { action: "openLink", phone: "+31 10 1234567" } },
            { op: "changePage", page: pg("Form"), variables: [{ name: "Min", type: "Integer", default: "5" }, { name: "Flag", type: "Boolean" }] },
            { op: "addWidgets", page: pg("Form"), into: "zz2Form", widgets: [{ widget: "checkBox", name: "zz2Flag", variable: "Flag" },
                { widget: "actionButton", name: "zz2Del2", action: "callMicroflow", microflow: `${E}_P2Del`, caption: "Del", confirm: true }] }
        );
        const page = { op: "createPage", module: mod, name: `${T}_P2Bad`, entity: O, folder: "ZzP2" };
        const dv = w => ({ ...page, widgets: [{ widget: "dataView", source: "parameter", fields: [], widgets: [w] }] });
        refuse.push(
            [{ ...page, widgets: [{ widget: "dataGrid", entity: E, columns: [`${T}Line_${T}/Text`] }] }, /leads to many .*listView or dataGrid/],
            [{ ...page, widgets: [{ widget: "dataGrid", columns: [`${cust}/Nme`] }] }, /has no attribute 'Nme'.*Did you mean: Name/],
            [{ ...page, widgets: [{ widget: "dataGrid", columns: [`${T}P2Cst/Name`] }] }, new RegExp(`no association of .*Did you mean: ${T}P2Cust`)],
            [dv({ widget: "actionButton", action: "save", confirm: true }), /confirm goes with callMicroflow, callNanoflow or callWorkflow/],
            [dv({ widget: "actionButton", action: "showPage", page: pg("Select"), caption: "x", progress: "blocking" }), /progress goes with callMicroflow or callNanoflow/],
            [dv({ widget: "textBox", attribute: "Number", format: { decimals: 2 } }), /decimals goes with a Decimal attribute/],
            [dv({ widget: "datePicker", attribute: "Placed", format: { groupDigits: true } }), /groupDigits goes with a number attribute/],
            [dv({ widget: "referenceSelector", association: OC, attribute: `${ckk}/Name` }), /follows one association/],
            [dv({ widget: "actionButton", action: "openTask", caption: "x" }), /System entities/],
            [dv({ widget: "checkBox", attribute: "Number" }), /cannot show 'Number'/],
            ...(x.grid2 && !x.exportJs ? [[{ ...page, widgets: [{ widget: "dataGrid", kind: "datagrid2", columns: ["Number"], export: true }] }, /needs the JavaScript action DataWidgets.Export_To_Excel/]] : [])
        );
    }
    if (x.web) ops.push({ op: "addMenuItem", caption: "Zz docs", action: { action: "openLink", url: "https://docs.mendix.com" } }, { op: "addMenuItem", caption: "Zz out", action: "signOut" });
    if (x.offline) ops.push({ op: "addMenuItem", caption: "Zz sync", profile: x.offline, action: "sync" });
    // refused before the plan (it may add a native profile to the copy)
    const early = [];
    if (!x.nativeProfile && x.web) early.push([{ op: "setHomePage", microflow: `${E}_Job`, profile: "Native" }, /no native navigation profile/]);
    if (!x.offline && !x.nativeProfile && x.pageable) early.push([{ op: "createPage", module: mod, name: `${T}_P2Sync`, widgets: [{ widget: "actionButton", action: "sync", caption: "Sync" }] }, /no offline or native navigation profile/]);
    // a native profile made in the copy (no test project has one): bottom bar item and home pages
    const native = x.nativeLayout && x.pageable && x.web;
    if (native) ops.push(
        { op: "createPage", module: mod, name: `${T}_P2Nat`, native: true, folder: "ZzP2", widgets: [{ widget: "text", text: "Home" }], menu: { caption: "Zz home" } },
        { op: "setHomePage", page: pg("Nat") },
        { op: "createNanoflow", module: mod, name: `${T}_P2NatStart`, folder: "ZzP2", actions: [] },
        ...(userRole ? [{ op: "setHomePage", nanoflow: `${E}_P2NatStart`, roles: [userRole] }] : []));
    return { ops, refuse, early, native };
}

// The stored values (the keys are compared by layoutProblems).
function pages2Problems(project, mod, T, x, plan) {
    const r = [];
    const E = `${mod}.${T}`, OC = `${E}P2Ord_${T}P2Cust`, CK = `${E}P2Cust_${T}P2Country`;
    const units = {};
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (typeof u.Name === "string" && u.Name.startsWith(`${T}_P2`)) units[u.Name] = u;
        if (u.$Type === "Navigation$NavigationDocument") units.nav = u;
    }
    const named = {};
    for (const u of Object.values(units)) walk(u, o => {
        if (o.Name && !named[o.Name]) named[o.Name] = o;
    });
    const say = (ok, what) => ok || r.push(what);
    if (x.pageable) {
        const g = named.zz2Classic;
        if (!g) return ["zz2Classic missing"];
        const cols = g.Columns;
        say(steps(cols[1].AttributeRef).join() === OC, "classic column over a reference: no IndirectEntityRef step");
        say(steps(cols[2].AttributeRef).join() === [OC, CK].join(), "classic column over 2 references: steps differ");
        say(cols[3].FormattingInfo.DecimalPrecision === 3 && cols[3].FormattingInfo.GroupDigits === true, "classic column format (decimals, group digits) not stored");
        say(cols[4].FormattingInfo.DateFormat === "Custom" && cols[4].FormattingInfo.CustomDateFormat === "dd-MM-yyyy", "classic column date format not stored");
        say(cols.length === 6 && steps(cols[5].AttributeRef).join() === OC, "changeWidget columns add over a reference missing");
        say(steps(g.DataSource.SortBar.SortItems[0].AttributeRef).join() === OC, "sort over a reference not stored");
        const sf = (g.DataSource.SearchBar.NewButtons || g.DataSource.SearchBar.Items || [])[0];
        say(sf && steps(sf.AttributeRef).join() === OC, "search field over a reference not stored");
        const nb = named.zz2New;
        say(nb && nb.$Type === "Forms$GridNewButton" && nb.EditFormSettings ? text(nb.EditFormSettings.TitleOverride && nb.EditFormSettings.TitleOverride.Text) === "New order" : nb && JSON.stringify(nb).includes("New order"), "new button page title missing");
        const del = named.zz2Del;
        say(del && del.MaintainSelectionAfterMicroflow === true, "grid button maintainSelection not stored");
        const ms = del && del.Action && del.Action.MicroflowSettings;
        say(ms && ms.ConfirmationInfo && text(ms.ConfirmationInfo.Question) === "Delete?" && text(ms.ConfirmationInfo.ProceedButtonCaption) === "Yes" && ms.ProgressBar === "Blocking" && text(ms.ProgressMessage) === "Deleting", "grid button confirm / progress not stored");
        say(named.zz2Help && named.zz2Help.Action.$Type === "Forms$OpenLinkClientAction" && named.zz2Help.Action.Address.Value === "https://docs.mendix.com", "grid button openLink not stored");
        const t = named.zz2Text;
        say(t && t.Content.Parameters.length === 1 && steps(t.Content.Parameters[0].AttributeRef).join() === OC, "changeWidget text over a reference: parameter differs");
        say(named.zz2Box && named.zz2Box.ConditionalVisibilitySettings && /\//.test(named.zz2Box.ConditionalVisibilitySettings.Expression) && !named.zz2Box.ConditionalVisibilitySettings.Attribute, "visible by an attribute over a reference is not an expression");
        const dv = named.zz2Detail;
        const tb = dv && dv.Widgets.find(w => w.$Type === "Forms$TextBox" && steps(w.AttributeRef).length);
        say(tb && tb.Editable === "Never", "input over a reference is not read-only");
        const ref = named.zz2Ref;
        say(ref && ref.RenderMode === "Form" && ref.PopupFormSettings.Form === `${E}_P2Select` && ref.Validation.Expression === "$value != empty" && steps(ref.AttributeRef).join() === OC, "reference selector select page / required / caption not stored");
        if (x.combo) {
            let cap = null;
            walk(named.zz2Combo || {}, o => o.$Type === "CustomWidgets$WidgetValue" && o.AttributeRef && steps(o.AttributeRef).join() === CK && (cap = o));
            say(cap, "combo box caption over a reference not stored");
        }
        const lv = named.zz2List;
        say(lv && steps(lv.DataSource.Search.SearchRefs[0]).join() === OC && steps(lv.DataSource.SortBar.SortItems[0].AttributeRef).join() === OC, "list view search / sort over a reference not stored");
        say(lv && lv.Widgets.some(w => w.$Type === "Forms$DynamicText" && w.Content.Parameters.some(p => steps(p.AttributeRef).join() === OC)), "list view field over a reference not stored");
        if (x.grid2) {
            const gr = named.zz2Grid;
            let colPath = false, dynPath = false, title = false, fmt = false;
            walk(gr || {}, o => {
                if (o.$Type === "CustomWidgets$WidgetValue" && o.AttributeRef && steps(o.AttributeRef).join() === OC) colPath = true;
                if (o.$Type === "Forms$ClientTemplateParameter" && steps(o.AttributeRef).join() === OC) dynPath = true;
                if (o.$Type === "Forms$ClientTemplateParameter" && o.FormattingInfo && o.FormattingInfo.DecimalPrecision === 1) fmt = true;
                if (o.$Type === "Forms$FormSettings" && o.TitleOverride && text(o.TitleOverride.Text) === "Order") title = true;
            });
            say(colPath && dynPath && fmt && title, `Data grid 2 over references: ${[!colPath && "column", !dynPath && "dynamic text", !fmt && "format", !title && "onClick page title"].filter(Boolean).join(", ")} missing`);
            if (x.exportJs) {
                const nf = units[`${T}_P2Grid_zz2Grid_Export`];
                say(nf && JSON.stringify(nf).includes("DataWidgets.Export_To_Excel") && JSON.stringify(nf).includes("'zz2Grid'"), "export nanoflow missing or not calling DataWidgets.Export_To_Excel for zz2Grid");
                let btn = false;
                walk(gr || {}, o => o.$Type === "Forms$ActionButton" && o.Action.$Type === "Forms$CallNanoflowClientAction" && o.Action.Nanoflow === `${E}_P2Grid_zz2Grid_Export` && (btn = true));
                say(btn, "export button missing in the Data grid 2 header");
            }
        }
        const cr = named.zz2Create && named.zz2Create.Action;
        say(cr && cr.$Type === "Forms$CreateObjectClientAction" && cr.EntityRef.$Type === "DomainModels$IndirectEntityRef" && cr.EntityRef.Steps[0].Association === OC && cr.EntityRef.Steps[0].DestinationEntity === `${E}P2Ord` && text(cr.PageSettings.TitleOverride && cr.PageSettings.TitleOverride.Text) === "New order", "create over an association / page title not stored");
        const web = named.zz2Web && named.zz2Web.Action;
        say(web && web.Address.IsDynamic === true && web.Address.AttributeRef.Attribute === `${E}P2Cust.Web` && web.LinkType === "Web", "openLink from an attribute not stored");
        say(named.zz2Mail && named.zz2Mail.Action.LinkType === "Call" && named.zz2Mail.Action.Address.Value === "+31 10 1234567", "changeWidget action openLink phone not stored");
        const wf = named.zz2Wf && named.zz2Wf.Action;
        say(wf && wf.$Type === "Forms$CallWorkflowClientAction" && wf.Workflow === `${E}_P2Wf` && wf.ClosePage === true && wf.ConfirmationInfo && text(wf.ConfirmationInfo.Question) === "Start it?", "callWorkflow not stored");
        say(named.zz2Out && named.zz2Out.Action.$Type === "Forms$SignOutClientAction", "signOut not stored");
        const dm = named.zz2DelOrd && named.zz2DelOrd.Action.MicroflowSettings;
        say(dm && dm.FormValidations === "None" && dm.ProgressBar === "NonBlocking" && dm.ConfirmationInfo, "list item button abortOnValidationErrors / progress / confirm not stored");
        const form = units[`${T}_P2Form`];
        say(form && form.Variables.map(v => `${v.Name}=${v.DefaultValue}`).join() === "Search='',Min=5,Flag=false", `page variables: ${form ? form.Variables.map(v => `${v.Name}=${v.DefaultValue}`).join() : "page missing"}`);
        const se = named.zz2Search;
        say(se && se.AttributeRef === null && se.SourceVariable && se.SourceVariable.LocalVariable === "Search" && se.OnEnterKeyPressAction.$Type === "Forms$CallNanoflowClientAction", "text box of a page variable / on Enter key not stored");
        say(named.zz2Form && named.zz2Form.LabelWidth === 4 && named.zz2Form.ReadOnlyStyle === "Control" && named.zz2Form.ShowFooter === true, "data view form settings not stored");
        const note = named.zz2Note;
        say(note && note.Validation.Expression === "" && note.MaxLengthCode === 50 && note.InputMask === "aaa" && note.ReadOnlyStyle === "Control" && note.OnEnterAction.$Type === "Forms$CallNanoflowClientAction" && note.OnLeaveAction.$Type === "Forms$OpenLinkClientAction" && text(note.PlaceholderTemplate.Template) === "a note", "text box required false / max length / mask / events / placeholder not stored");
        const tot = named.zz2Total;
        say(tot && tot.Validation.Expression === "$value != empty" && text(tot.Validation.Message) === "Total!" && tot.FormattingInfo.DecimalPrecision === 1 && tot.FormattingInfo.GroupDigits === true, "required + format of a text box not stored");
        say(named.zz2Placed && named.zz2Placed.Validation.Expression === "$value != empty" && named.zz2Placed.FormattingInfo.DateFormat === "Custom" && named.zz2Placed.FormattingInfo.CustomDateFormat === "dd-MM-yyyy HH:mm", "date picker required / format not stored");
        say(named.zz2St && named.zz2St.Validation.Expression === "$value != empty", "drop-down required not stored");
        say(named.zz2Cust && named.zz2Cust.Validation.Expression === "$value != empty" && named.zz2Cust.ReadOnlyStyle === "Text", "reference selector required / read-only style not stored");
        say(named.zz2Flag && named.zz2Flag.SourceVariable && named.zz2Flag.SourceVariable.LocalVariable === "Flag", "check box of a page variable not stored");
    }
    const navText = units.nav ? JSON.stringify(units.nav) : "";
    if (x.web) say(navText.includes("https://docs.mendix.com") && /Forms\$SignOutClientAction/.test(navText), "menu items openLink / signOut missing");
    if (x.offline) say(/Forms\$SyncClientAction/.test(navText), "sync menu item missing");
    if (plan.native) {
        const np = units.nav.Profiles.find(p => p.$Type === "Navigation$NativeNavigationProfile");
        say(np && np.BottomBarItems.some(b => b.Page === `${E}_P2Nat`), "native bottom bar item missing");
        say(np && JSON.stringify(np.NativeHomePage).includes(`${E}_P2Nat`), "native home page missing");
    }
    return r;
}

// Runs the phase on a copy: the plan, saved, reopened and checked; then the refusals (on a model thrown away).
async function pages2Phase({ s2, reopen, copy, mod, T, layout, layoutProblems, check, results, userRole }) {
    const x = await pages2Targets(s2);
    const plan = pages2Plan(mod, T, x, userRole);
    const problems = [];
    const refused = async (sess, list) => {
        for (const [o, re] of list) {
            let msg = "";
            try {
                await sess.ops.runPlan({ ops: [o] }, () => {});
            } catch (e) {
                msg = e.message;
            }
            if (!re.test(msg)) problems.push(`${o.op} ${o.name || o.page || ""} not refused with ${re}${msg ? `: ${msg.slice(0, 200)}` : " (it ran)"}`);
        }
    };
    await refused(s2, plan.early);
    let s = plan.early.length ? await reopen(copy) : s2;
    if (plan.native) {
        // no test project has a native profile: one made with Studio Pro's SDK defaults, as when one adds it
        const sdk = require("mendixmodelsdk");
        const nav = await s.model.allNavigationDocuments()[0].load();
        sdk.navigation.NativeNavigationProfile.createIn(nav).name = "Native";
    }
    const before = new Set(s.ctx.project.units.keys());
    const lint = await s.ops.runPlan({ ops: plan.ops }, () => {});
    problems.push(...lint);
    await s.model.flushChanges();
    const enc = s.client.encode();
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
    const firstUse = [...new Set(s.client.summary().warnings.filter(w => /never occurs|first use in this project/.test(w)).map(w => w.split(/[ :]/)[0]).filter(w => w.includes("$")))];
    s.client.project.writeEncoded(enc);
    s = await reopen(copy);
    problems.push(...(await s.ops.checkPlan({ ops: plan.ops })));
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => problems.push(`reopen: ${e.message}`));
    await s.model.flushChanges();
    if (s.client.log.length) problems.push(`${s.client.log.length} deltas on reopen`);
    for (const id of s.ctx.project.units.keys()) {
        if (before.has(id)) continue;
        const b = s.ctx.project.readBytes(id);
        if (!bson.encode(bson.decode(b)).equals(b)) problems.push(`unit ${id} does not roundtrip byte for byte`);
    }
    problems.push(...pages2Problems(s.ctx.project, mod, T, x, plan));
    // the refusals, on the saved model (thrown away afterwards)
    await refused(s, plan.refuse);
    const what = [x.pageable && "attribute paths in classic + Data grid 2 columns, texts, inputs (read-only), sort, search, list views, visible conditions, reference selector + combo box captions",
        x.pageable && "create over an association, openLink (static, attribute, phone), signOut, callWorkflow, confirm, progress, abortOnValidationErrors, maintainSelection, page titles on buttons, grid buttons and onClick",
        x.pageable && "required / custom validation, number and date formats, read-only styles, mask, max length, placeholder, onEnter / onLeave / onEnterKeyPress, data view orientation + label width, page variables (inputs, flow params, changePage), select page",
        x.pageable && x.grid2 && x.exportJs && "Data grid 2 export to Excel",
        x.web && "menu items openLink + signOut", x.offline && `sync (${x.offline})`, plan.native && "native bottom bar + home pages (native profile made in the copy)",
        `${plan.refuse.length + plan.early.length} refusals (to-many path, wrong path, confirm/progress on a non-flow action, format on a wrong type, selector path, openTask${x.offline ? "" : ", sync without an offline profile"}${x.grid2 && !x.exportJs ? ", export without Data Widgets" : ""}${x.nativeProfile ? "" : ", native without a native profile"})`].filter(Boolean);
    if (!x.pageable) results.push("SKIP pages2 pages: this project has no page with a layout to copy (menu items and refusals only)");
    if (x.pageable && x.grid2 && !x.exportJs) results.push("SKIP Data grid 2 export: no DataWidgets.Export_To_Excel (refusal checked)");
    if (x.pageable && !plan.native) results.push(`SKIP native bottom bar / home page: ${x.nativeLayout ? "no Responsive profile" : "no native layout"} (refusal checked)`);
    check(`pages2: ${what.join("; ")}; stored with Studio Pro's keys and values, reopen 0 errors`, !problems.length, [...new Set(problems)].slice(0, 6).join("; "));
    if (firstUse.length) results.push(`NOTE pages2: no Studio Pro sample in this project of ${firstUse.length} type(s) (SDK layout, "check it in Studio Pro" warning): ${firstUse.slice(0, 10).join(", ")}${firstUse.length > 10 ? ", ..." : ""}`);
    return reopen(copy);
}

module.exports = { pages2Phase, pages2Plan, pages2Targets, pages2Problems };
