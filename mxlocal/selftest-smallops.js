"use strict";
// selftest phase S (small ops): retrieve sort (also over a reference) + custom range + first with sort, reference set
// add/remove in create/change steps and changeAction (sort, range, add, remove), createSnippet (entity shorthand,
// two parameters with data views), createCrud (overview + NewEdit, Data grid 2 or classic, access rule, menu),
// changeConstant, changeScheduledEvent, changeValidationRule / deleteValidationRule, deleteEventHandler, changeIndex /
// deleteIndex, moveEnumerationValue / changeEnumerationValue / addEnumerationValue with an image; and the refusals.
// Stored keys are compared with what Studio Pro writes in the project (layoutProblems) and with the Studio Pro
// samples of the test projects (SAMPLE), values with what was asked; the copy reopens with 0 errors and 0 deltas.
const { lostProperties } = require("./lost");

// Keys Studio Pro writes (samples: BubbleChart/ImageViewer/Maps 10.24, RichText/TreeView 11.12, TestApp 11.14 for
// sorting and range; every project for ChangeActionItem (Add/Remove: only a Mendix 8 sample, same keys); Badge /
// RichText 11.12 for SnippetParameter; every project for EnumerationValue).
const SAMPLE = {
    "Microflows$SortingsList": ["Sortings"],
    "Microflows$RetrieveSorting": ["AttributeRef", "SortOrder"],
    "Microflows$CustomRange": ["LimitExpression", "OffsetExpression"],
    "Microflows$ChangeActionItem": ["Association", "Attribute", "Type", "Value"],
    "Forms$SnippetParameter": ["Name", "ParameterType"],
    "Enumerations$EnumerationValue": ["Caption", "Image", "Name", "RemoteValue"]
};

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};
const keysOf = o => Object.keys(o).filter(k => k[0] !== "$").sort().join(",");
const text = t => (t && t.Items ? t.Items.map(i => i.Text) : []);

function plan(mod, T, role, x) {
    const E = `${mod}.${T}`;
    const owner = `${mod}.${T}_${T}Sown`, tags = `${mod}.${T}_${T}Stag`;
    const ops = [
        { op: "createEntity", module: mod, name: `${T}Sown`, attributes: [{ name: "Name", type: "String(100)" }, { name: "Rank", type: "Integer" }] },
        { op: "createEntity", module: mod, name: `${T}Stag`, attributes: [{ name: "Label", type: "String(50)" }] },
        { op: "addAssociation", from: E, to: `${E}Sown` },
        { op: "addAssociation", from: E, to: `${E}Stag`, type: "ReferenceSet" },
        { op: "createMicroflow", module: mod, name: `${T}_Small`, folder: "ZzTest", returns: `List(${E})`, returnValue: "$Top", actions: [
            { action: "retrieve", variable: "Top", entity: E, sort: [{ attribute: "Count", descending: true }, `${T}_${T}Sown/Name`], range: { offset: "0", limit: "10" } },
            { action: "retrieve", variable: "Best", entity: E, first: true, sort: ["Title"] },
            { action: "retrieve", variable: "Tags", entity: `${E}Stag`, xpath: "[Label != empty]" },
            { action: "if", condition: "$Best = empty", then: [{ action: "end", value: "$Top" }] },
            { action: "change", variable: "Best", add: { [tags]: "$Tags" }, set: { Title: "'best'" } },
            { action: "create", variable: "Fresh", entity: E, set: { Title: "'new'" }, add: { [tags]: "$Tags" } },
            { action: "change", variable: "Fresh", remove: { [tags]: "$Tags" } }] },
        { op: "createSnippet", module: mod, name: `${T}Card`, folder: "ZzTest", entity: E, fields: ["Title", "Count"] },
        { op: "createSnippet", module: mod, name: `${T}Bits`, folder: "ZzTest", parameters: [{ name: "Item", entity: E }, { name: "Tag", entity: `${E}Stag` }],
            widgets: [{ widget: "text", text: "Zz bits", style: "H4" }, { widget: "dataView", source: "parameter", entity: E, widgets: [{ widget: "input", attribute: "Title" }] },
                { widget: "dataView", source: "parameter", entity: `${E}Stag`, editable: false, fields: ["Label"] }] },
        { op: "changeConstant", constant: `${E}_Url`, default: "https://zz.example.org", exposedToClient: true },
        { op: "changeScheduledEvent", event: `${E}_Nightly`, at: "03:45", enabled: true },
        { op: "changeScheduledEvent", event: `${E}_Poll`, every: "Hour", interval: 2, at: "15" },
        { op: "changeValidationRule", entity: E, attribute: "Count", rule: "range", max: 500, message: "0..500" },
        { op: "deleteValidationRule", entity: E, attribute: "Title", rule: "maxLength" },
        { op: "deleteEventHandler", entity: E, moment: "Before", event: "Commit" },
        { op: "changeIndex", entity: E, index: ["Title", "Count"], attributes: ["Count", { name: "Title", ascending: false }] },
        { op: "addIndex", entity: E, attributes: ["When"] },
        { op: "deleteIndex", entity: E, index: ["When"] },
        { op: "addEnumerationValue", enumeration: `${E}Status`, name: "Hold", image: `${E}Images.Icon` },
        { op: "moveEnumerationValue", value: `${E}Status.Cancelled`, position: 1 },
        { op: "moveEnumerationValue", value: `${E}Status.Hold`, before: "Open" },
        { op: "changeEnumerationValue", value: `${E}Status.Open`, caption: "Open now", image: `${E}Images.zz_logo` }
    ];
    if (x.pageable) {
        ops.push({ op: "createCrud", entity: `${E}Sown`, roles: [role], ...(x.web ? { menu: "Responsive" } : {}) });
        ops.push({ op: "createCrud", entity: `${E}Stag`, grid: "classic", overview: `${T}Stags`, edit: `${T}StagEdit`, folder: "ZzTest" });
        ops.push({ op: "addWidgets", page: `${E}Sown_NewEdit`, into: "dataView1", widgets: [{ widget: "text", text: "Zz crud" }] });
    }
    // refused, each on its own (nothing of them is kept)
    const refusals = [
        [{ op: "createMicroflow", module: mod, name: `${T}_Bad1`, parameters: [{ name: "It", type: E }], actions: [{ action: "retrieve", variable: "L", from: "It", association: tags, sort: ["Label"] }] }, /association retrieve has no sorting or range/],
        [{ op: "createMicroflow", module: mod, name: `${T}_Bad2`, actions: [{ action: "retrieve", variable: "L", entity: E, first: true, range: { limit: "3" } }] }, /"first": true .* or "range"/],
        [{ op: "createMicroflow", module: mod, name: `${T}_Bad3`, actions: [{ action: "retrieve", variable: "L", entity: `${E}Sown`, sort: [`${T}_${T}Sown/Title`] }] }, /leads to many/],
        [{ op: "createMicroflow", module: mod, name: `${T}_Bad4`, parameters: [{ name: "It", type: E }, { name: "O", type: `${E}Sown` }], actions: [{ action: "change", variable: "It", add: { [owner]: "$O" } }] }, /is a reference .*only works on a reference set/],
        [{ op: "createMicroflow", module: mod, name: `${T}_Bad5`, parameters: [{ name: "It", type: E }], actions: [{ action: "change", variable: "It", add: { [tags]: "$It" } }] }, /this association takes .*Stag objects/],
        [{ op: "createSnippet", module: mod, name: `${T}Bad6`, widgets: [{ widget: "dataView", source: "parameter", entity: E }] }, /cannot add a parameter/],
        [{ op: "changeValidationRule", entity: E, attribute: "Count", rule: "range", maxLength: 3 }, /does not apply to a range rule/],
        [{ op: "deleteIndex", entity: E, index: ["Nope"] }, /no index on \(Nope\)/],
        [{ op: "moveEnumerationValue", value: `${E}Status.Open`, before: "Dne" }, /Did you mean: Done/],
        [{ op: "delete", target: `${E}.Count`, rule: "range" }, /deleteValidationRule/]
    ];
    return { ops, refusals, E };
}

async function smallPhase({ s2, reopen, copy, mod, T, role, layout, layoutProblems, check, results, src }) {
    const sdk = require("mendixmodelsdk");
    const layouts = new Set(s2.model.allLayouts().map(l => l.qualifiedName));
    const x = { pageable: false, web: false };
    for (const id of s2.ctx.project.units.keys()) {
        const u = s2.ctx.project.read(id);
        if (u.$Type === "Forms$Page" && u.FormCall && layouts.has(u.FormCall.Form)) x.pageable = true;
    }
    const nav = s2.model.allNavigationDocuments()[0] ? await s2.model.allNavigationDocuments()[0].load() : null;
    x.web = !!nav && nav.profiles.some(p => p instanceof sdk.navigation.NavigationProfile && p.name === "Responsive");
    const { ops, refusals, E } = plan(mod, T, role, x);
    const problems = [];
    let s = s2;
    const lint = await s.ops.runPlan({ ops }, () => {});
    problems.push(...lint);
    // changeAction on the new steps (ids from the model, as 'steps' shows them)
    const flow = await s.ops.get(`${E}_Small`);
    const ids = {};
    flow.objectCollection.objects.forEach(o => {
        const a = o.action;
        if (a && a.outputVariableName === "Top") ids.top = o.id.slice(0, 8);
        if (a && a.outputVariableName === "Best") ids.best = o.id.slice(0, 8);
        if (a && a.changeVariableName === "Fresh") ids.fresh = o.id.slice(0, 8);
    });
    const tags = `${mod}.${T}_${T}Stag`;
    const edits = { ops: [
        { op: "changeAction", microflow: `${E}_Small`, id: ids.top, sort: ["Title", { attribute: `${T}_${T}Sown/Rank`, descending: true }], range: { offset: "5", limit: "20" } },
        { op: "changeAction", microflow: `${E}_Small`, id: ids.best, sort: [] },
        { op: "changeAction", microflow: `${E}_Small`, id: ids.fresh, add: { [tags]: "$Tags" } }
    ] };
    await s.ops.runPlan(edits, () => {});
    await s.model.flushChanges();
    const enc = s.client.encode();
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
    s.client.project.writeEncoded(enc);
    s = await reopen(copy);
    problems.push(...(await s.ops.checkPlan({ ops: [...ops, ...edits.ops] })));
    const errs = [];
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => errs.push(e.message));
    await s.model.flushChanges();
    if (s.client.log.length) errs.push(`${s.client.log.length} deltas on open`);
    problems.push(...errs);

    // refusals (on what the plan made), each on a fresh session
    for (const [o, re] of refusals) {
        let msg = "";
        try {
            await s.ops.runPlan({ ops: [o] }, () => {});
        } catch (e) {
            msg = e.message;
        }
        if (!re.test(msg)) problems.push(`${o.op} not refused with ${re}${msg ? `: ${msg.slice(0, 160)}` : " (it ran)"}`);
        s = await reopen(copy);
    }

    // stored keys and values
    const p = s.ctx.project;
    const found = {};
    const docs = {};
    let ent = null, owner = null, en = null, constant = null, nightly = null, poll = null;
    for (const id of p.units.keys()) {
        const u = p.read(id);
        if (u.Name) docs[u.Name] = u;
        walk(u, o => {
            if (SAMPLE[o.$Type]) (found[o.$Type] = found[o.$Type] || []).push(o);
            if (o.$Type === "DomainModels$EntityImpl" && o.Name === T) ent = o;
            if (o.$Type === "DomainModels$EntityImpl" && o.Name === `${T}Sown`) owner = o;
        });
        if (u.$Type === "Enumerations$Enumeration" && u.Name === `${T}Status`) en = u;
        if (u.$Type === "Constants$Constant" && u.Name === `${T}_Url`) constant = u;
        if (u.$Type === "ScheduledEvents$ScheduledEvent" && u.Name === `${T}_Nightly`) nightly = u;
        if (u.$Type === "ScheduledEvents$ScheduledEvent" && u.Name === `${T}_Poll`) poll = u;
    }
    for (const [t, keys] of Object.entries(SAMPLE)) {
        if (!(found[t] || []).length) problems.push(`no ${t} stored`);
        for (const o of found[t] || []) if (keysOf(o) !== [...keys].sort().join(",")) problems.push(`${t} keys ${keysOf(o)} (Studio Pro: ${keys.join(",")})`);
    }
    // the flow
    const small = docs[`${T}_Small`];
    const srcs = [], items = [];
    walk(small, o => {
        if (o.$Type === "Microflows$DatabaseRetrieveSource") srcs.push(o);
        if (o.$Type === "Microflows$ChangeActionItem" && o.Type !== "Set") items.push(`${o.Type}:${o.Association}:${o.Value}`);
    });
    const sortText = src => src.NewSortings.Sortings.map(x => [...(x.AttributeRef.EntityRef ? x.AttributeRef.EntityRef.Steps.map(st => st.Association.split(".").pop()) : []), x.AttributeRef.Attribute.split(".").pop()].join("/") + (x.SortOrder === "Descending" ? " desc" : "")).join(", ");
    const top = srcs.find(x => x.Entity === E && x.Range.$Type === "Microflows$CustomRange");
    if (!top || sortText(top) !== `Title, ${T}_${T}Sown/Rank desc` || top.Range.OffsetExpression !== "5" || top.Range.LimitExpression !== "20") problems.push(`retrieve Top not stored as changed (${top ? `${sortText(top)}; ${top.Range.OffsetExpression}, ${top.Range.LimitExpression}` : "no custom range"})`);
    if (top && top.AttributeRef) problems.push("sort item has a stray AttributeRef");
    const best = srcs.find(x => x.Entity === E && x.Range.SingleObject === true);
    if (!best || best.NewSortings.Sortings.length) problems.push("retrieve Best (first) still sorted after sort: []");
    const want = [`Add:${tags}:$Tags`, `Add:${tags}:$Tags`, `Remove:${tags}:$Tags`, `Add:${tags}:$Tags`];
    if (items.sort().join() !== want.sort().join()) problems.push(`reference set changes stored as ${items.join(", ")}`);
    // snippets
    const card = docs[`${T}Card`], bits = docs[`${T}Bits`];
    if (!card || card.$Type !== "Forms$Snippet" || card.Parameters.map(x => `${x.Name}:${x.ParameterType.Entity}`).join() !== `${T}:${E}`) problems.push(`${T}Card parameters not stored`);
    if (!bits || bits.Parameters.map(x => x.Name).join() !== "Item,Tag") problems.push(`${T}Bits parameters not stored`);
    const vars = [];
    walk(bits, o => o.$Type === "Forms$PageVariable" && vars.push(`${o.SnippetParameter}:${o.Widget}`));
    if (!vars.includes("Item:") || !vars.includes("Item:dataView1") || !vars.includes("Tag:")) problems.push(`${T}Bits data views / inputs not on the snippet parameters (${vars.join(", ")})`);
    // crud
    if (x.pageable) {
        const ov = docs[`${T}Sown_Overview`], ed = docs[`${T}Sown_NewEdit`], tg = docs[`${T}Stags`];
        if (!ov || !ed || !tg || !docs[`${T}StagEdit`]) problems.push("createCrud pages missing");
        let grid = null;
        walk(ov, o => {
            if (o.$Type === "Forms$DataGrid" || (o.$Type === "CustomWidgets$CustomWidget" && JSON.stringify(o.Type || {}).includes("Datagrid"))) grid = grid || o.$Type;
        });
        if (!grid) problems.push(`${T}Sown_Overview has no data grid`);
        const opens = JSON.stringify(ov || {}).split(`"${E}Sown_NewEdit"`).length - 1;
        if (opens < 2) problems.push(`${T}Sown_Overview opens ${E}Sown_NewEdit ${opens} time(s) (New and Edit)`);
        if (!owner || !owner.AccessRules.some(r => r.AllowedModuleRoles.includes(role) && r.AllowCreate && r.AllowDelete)) problems.push(`${T}Sown has no ReadWrite access rule for ${role}`);
        results.push(`NOTE createCrud built ${T}Sown_Overview with ${grid === "Forms$DataGrid" ? "a classic Data grid (no Data grid 2 to build here)" : "a Data grid 2"}`);
    } else results.push("SKIP createCrud: this project has no page with a layout to copy");
    // domain changes
    if (!constant || constant.DefaultValue !== "https://zz.example.org" || constant.ExposedToClient !== true) problems.push("changeConstant not stored");
    if (!nightly || !nightly.Enabled || nightly.Schedule.HourOfDay !== 3 || nightly.Schedule.MinuteOfHour !== 45) problems.push("changeScheduledEvent (day) not stored");
    if (!poll || poll.Schedule.$Type !== "ScheduledEvents$HourSchedule" || poll.Schedule.Multiplier !== 2 || poll.Schedule.MinuteOffset !== 15) problems.push(`changeScheduledEvent (hour) not stored (${poll && poll.Schedule.$Type})`);
    const rules = ent ? ent.ValidationRules.map(r => `${r.Attribute.split(".").pop()}:${r.RuleInfo.$Type.split("$")[1]}`) : [];
    if (rules.includes("Title:MaxLengthRuleInfo") || !rules.includes("Title:RequiredRuleInfo")) problems.push(`validation rules after delete: ${rules.join(", ")}`);
    const range = ent && ent.ValidationRules.find(r => r.RuleInfo.$Type === "DomainModels$RangeRuleInfo");
    if (!range || range.RuleInfo.MaxValue !== "500" || !text(range.Message).includes("0..500")) problems.push("changeValidationRule not stored");
    if (ent && ent.Events.some(e => e.Moment === "Before" && e.Type === "Commit")) problems.push("deleteEventHandler left the handler");
    const attrIds = ent ? Object.fromEntries(ent.Attributes.map(a => [a.$ID, a.Name])) : {};
    const ix = ent ? ent.Indexes.map(i => i.Attributes.map(a => attrIds[a.AttributePointer] + (a.Ascending ? "" : " desc")).join("+")) : [];
    if (ix.join() !== "Count+Title desc") problems.push(`indexes stored as ${ix.join(", ")}`);
    const order = en ? en.Values.map(v => v.Name).join() : "";
    if (!order.startsWith("Cancelled,Hold,Open,Done")) problems.push(`enumeration order ${order}`);
    const open = en && en.Values.find(v => v.Name === "Open");
    const hold = en && en.Values.find(v => v.Name === "Hold");
    if (!open || open.Image !== `${E}Images.zz_logo` || !text(open.Caption).includes("Open now") || !hold || hold.Image !== `${E}Images.Icon`) problems.push("enumeration value caption / images not stored");
    check(`small ops: retrieve sort (also over a reference), custom range, first + sort, changeAction sort/range/add; reference set add/remove; createSnippet (entity shorthand, 2 parameters); ${x.pageable ? "createCrud (Data grid 2 or classic, access, menu); " : ""}change constant, scheduled events, validation rule, index; delete validation rule, event handler, index; enumeration value order, caption, images; ${refusals.length} refusals; keys as Studio Pro's samples, reopen 0 errors`,
        !problems.length, problems.slice(0, 6).join("; "));
    return s;
}

module.exports = { smallPhase, SAMPLE };
