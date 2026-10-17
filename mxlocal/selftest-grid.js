"use strict";
// selftest phase grid: Data grid 2 column settings (U4), association drop-down filters (R1), filters above a Data grid 2
// and a gallery (R2), page variables in data source XPath (R4), offline sync settings and the nanoflow synchronize
// action (R3), domain model placement, arrangeDomainModel and the overlap lint (R5). The stored widget types must equal
// the installed .mpk, the filters must have the same non-empty properties as the Studio Pro-saved samples of the test
// projects (DataGrid FilteringIntegration, Gallery Home_Web) where the project has one, the offline settings the keys
// of the TestApp sample; every key as Studio Pro writes it in the project (layoutProblems), reopen 0 errors / deltas.
const bson = require("./bson");
const pluggable = require("./pluggable");
const { lostProperties } = require("./lost");
const { box, overlap } = require("./ops-dmlayout");

const DG2 = "com.mendix.widget.web.datagrid.Datagrid", GALLERY = "com.mendix.widget.web.gallery.Gallery";
const F = { text: "com.mendix.widget.web.datagridtextfilter.DatagridTextFilter", dropdown: "com.mendix.widget.web.datagriddropdownfilter.DatagridDropdownFilter",
    number: "com.mendix.widget.web.datagridnumberfilter.DatagridNumberFilter", date: "com.mendix.widget.web.datagriddatefilter.DatagridDateFilter" };

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};

// key -> WidgetValue of a widget object (storage JSON), with the types of widget w
function props(w, obj) {
    const types = new Map();
    walk(w.Type, t => t.$Type === "CustomWidgets$WidgetPropertyType" && types.set(t.$ID, t.PropertyKey));
    return new Map((obj || w.Object).Properties.map(p => [types.get(p.TypePointer), p.Value]));
}
// the non-empty properties of a filter (what Studio Pro shows as set), defaults and empty values left out
function setKeys(w) {
    const def = new Map();
    walk(w.Type, t => t.$Type === "CustomWidgets$WidgetPropertyType" && def.set(t.PropertyKey, t.ValueType.DefaultValue));
    const out = [];
    for (const [k, v] of props(w)) {
        if (v.PrimitiveValue && v.PrimitiveValue !== def.get(k)) out.push(k);
        else if (v.AttributeRef || v.EntityRef || v.DataSource || (v.Objects && v.Objects.length) || (v.Expression && v.Expression !== def.get(k))) out.push(k);
    }
    // user choices left out; a caption by expression (refCaptionSource exp + refCaptionExp) counts as the caption
    const keys = out.filter(k => !["multiSelect", "placeholder", "fetchOptionsLazy", "filterable", "defaultValue"].includes(k));
    if (keys.includes("refCaptionExp")) keys.splice(0, keys.length, ...keys.filter(k => k !== "refCaptionExp" && k !== "refCaptionSource"), "refCaption");
    return keys.sort().join(",");
}

async function targets(s) {
    const project = s.ctx.project, model = s.model;
    const inst = pluggable.installed(project.dir);
    const layouts = new Set(model.allLayouts().map(l => l.qualifiedName));
    const x = { pageable: false, grid2: inst.get(DG2) || null, gallery: inst.get(GALLERY) || null, filters: Object.values(F).every(f => inst.has(f)), offline: null, samples: { ref: null, linked: null } };
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Page" && u.FormCall && layouts.has(u.FormCall.Form)) x.pageable = true;
        if (u.$Type !== "Forms$Page") continue;
        // Studio Pro-saved samples: an association drop-down and a filter above a gallery / grid with listed attributes
        walk(u, o => {
            if (o.$Type !== "CustomWidgets$CustomWidget" || !o.Type) return;
            const p = props(o);
            if (o.Type.WidgetId === F.dropdown && p.get("baseType") && p.get("baseType").PrimitiveValue === "ref" && !x.samples.ref) x.samples.ref = { page: u.Name, name: o.Name, keys: setKeys(o) };
            if (o.Type.WidgetId === F.text && p.get("attrChoice") && p.get("attrChoice").PrimitiveValue === "linked" && !x.samples.linked) x.samples.linked = { page: u.Name, name: o.Name, keys: setKeys(o) };
        });
    }
    const nav = model.allNavigationDocuments()[0] ? await model.allNavigationDocuments()[0].load() : null;
    const sdk = require("mendixmodelsdk");
    for (const p of nav ? nav.profiles : []) if (!(p instanceof sdk.navigation.NavigationProfile) || /offline/i.test(p.kind ? p.kind.name : "")) x.offline = x.offline || p.name;
    // Data Widgets 3 (association filter on the drop-down) or 2.x (on the column)
    const ddXml = x.filters ? pluggable.widgetXml(project.dir, F.dropdown) : null;
    x.refFilter = !!(ddXml && JSON.stringify(ddXml).includes("\"refEntity\""));
    x.colAssoc = !!(x.grid2 && x.grid2.lines.some(l => l.startsWith("columns/filterAssociation ")));
    x.alignment = !!(x.grid2 && x.grid2.lines.some(l => l.startsWith("columns/alignment ")));
    return x;
}

function plans(mod, T, x) {
    const E = `${mod}.${T}`, C = `${E}GCust`, O = `${E}GOrd`, A = `${T}GOrd_${T}GCust`;
    const pg = n => `${mod}.${T}_G${n}`;
    const ops = [
        { op: "createEnumeration", module: mod, name: `${T}GSt`, values: ["Open", "Done"] },
        { op: "createEntity", module: mod, name: `${T}GCust`, documentation: "Customers of the grid test", attributes: [{ name: "Name", type: "String(200)" }, { name: "Code", type: "Integer" }] },
        { op: "createEntity", module: mod, name: `${T}GOrd`, attributes: [{ name: "Number", type: "Integer" }, { name: "Note", type: "String(200)" }, { name: "Placed", type: "DateTime" }, { name: "St", type: `Enum(${E}GSt)` }] },
        { op: "createEntity", module: mod, name: `${T}GSpecial`, generalization: C },
        { op: "addAssociation", from: O, to: C }
    ];
    const refuse = [];
    const grid = x.pageable && x.grid2;
    if (grid) {
        const assocFilter = x.refFilter || x.colAssoc;
        const cols = [
            { attribute: "Number", width: 80, alignment: "right", sortable: false, hidable: "hidden", ...(x.filters ? { filter: "number" } : {}) },
            { attribute: "Note", width: "autoFit", wrapText: true, tooltip: "Order {Number}: {Note}", columnClass: "if $currentObject/Number > 10 then 'big' else ''", visible: "true", resizable: false, draggable: false },
            { attribute: `${A}/Name`, caption: "Customer", class: "cust-col", minWidth: 120, ...(x.filters && assocFilter ? { filter: { multiSelect: true, options: "[Code > 0]" } } : {}) },
            { attribute: "St", size: 2, ...(x.filters ? { filter: true } : {}) }
        ];
        if (!x.alignment) for (const c of cols) delete c.alignment;
        const header = x.filters ? [{ filter: "text", attributes: ["Note"], placeholder: "Search" }, { filter: "dropdown", attribute: "St" }, ...(x.refFilter ? [{ filter: "association", association: A, caption: "Name" }] : [])] : null;
        ops.push({ op: "createPage", module: mod, name: `${T}_GGrid`, folder: "ZzGrid", variables: [{ name: "Search", type: "String" }, { name: "Min", type: "Integer" }],
            widgets: [{ widget: "textBox", variable: "Search", name: "zzgSearch" },
                { widget: "dataGrid", kind: "datagrid2", name: "zzgGrid", entity: O, xpath: "[contains(Note, $Search) and Number >= $Min]", columns: cols, ...(header ? { headerFilters: header } : {}) },
                ...(x.gallery ? [{ widget: "gallery", name: "zzgGal", entity: O, xpath: "[Number > $Min]", ...(x.filters ? { headerFilters: [{ filter: "text", attributes: ["Note"] }, { filter: "date", attributes: ["Placed"] }] } : {}) }] : []),
                { widget: "listView", name: "zzgList", entity: O, xpath: "[Note = $Search]" },
                { widget: "dataGrid", kind: "classic", name: "zzgClassic", entity: O, columns: [{ attribute: "Number", width: 40, class: "text-right" }, "Note"] }] });
        ops.push({ op: "changeWidget", page: pg("Grid"), widget: "zzgGrid", columns: { change: [{ column: "Number", width: "autoFill", size: 3 }, { column: "Customer", hidable: false }], add: [{ attribute: "Placed", wrapText: true }] } });
        ops.push({ op: "changeWidget", page: pg("Grid"), widget: "zzgClassic", columns: { change: [{ column: "Number", width: 60 }] } });
        refuse.push(
            [{ op: "createPage", module: mod, name: `${T}_GBad1`, widgets: [{ widget: "dataGrid", kind: "datagrid2", entity: O, xpath: "[Number = $Mni]", columns: ["Number"] }], variables: [{ name: "Min", type: "Integer" }] }, /\$Mni is no page variable.*\$Min/],
            [{ op: "createPage", module: mod, name: `${T}_GBad2`, widgets: [{ widget: "dataGrid", kind: "classic", entity: O, columns: [{ attribute: "Number", alignment: "right" }] }] }, /alignment (is a Data grid 2 column setting|works only with a Data grid 2)/],
            [{ op: "createPage", module: mod, name: `${T}_GBad3`, widgets: [{ widget: "dataGrid", kind: "datagrid2", entity: O, columns: [{ attribute: "Number", headerTooltip: "x" }] }] }, /headerTooltip.*cell "tooltip" only/],
            [{ op: "createPage", module: mod, name: `${T}_GBad4`, widgets: [{ widget: "dataGrid", kind: "datagrid2", entity: O, columns: [{ attribute: "Number", alignment: "middle" }] }] }, x.alignment ? /alignment 'middle' is not known/ : /has no column alignment/],
            [{ op: "createPage", module: mod, name: `${T}_GBad5`, variables: [{ name: "Q", type: "String" }], widgets: [{ widget: "dataGrid", kind: "datagrid2", entity: O, columns: [{ attribute: "Note", filter: { variable: "Q" } }] }] }, /cannot bind it to a page variable/]);
        if (x.filters && x.refFilter) refuse.push([{ op: "createPage", module: mod, name: `${T}_GBad6`, widgets: [{ widget: "pluggable", type: "DatagridTextFilter", properties: { linkedDs: O } }] }, /links to the Data grid 2 or gallery it is placed in.*headerFilters/]);
        if (x.filters) refuse.push([{ op: "createPage", module: mod, name: `${T}_GBad7`, widgets: [{ widget: "dataGrid", kind: "datagrid2", entity: O, columns: [{ attribute: "Number", filter: "text" }] }] }, /text filter does not fit Number/]);
    }
    if (x.pageable && !x.grid2) {
        // no Data grid 2: page variables in a list view XPath only
        ops.push({ op: "createPage", module: mod, name: `${T}_GGrid`, folder: "ZzGrid", variables: [{ name: "Search", type: "String" }],
            widgets: [{ widget: "listView", name: "zzgList", entity: O, xpath: "[contains(Note, $Search)]" }] });
        refuse.push([{ op: "createPage", module: mod, name: `${T}_GBad1`, variables: [{ name: "Min", type: "Integer" }], widgets: [{ widget: "listView", entity: O, xpath: "[Number = $Mni]" }] }, /\$Mni is no page variable.*\$Min/]);
    }
    // offline (R3)
    if (x.offline) {
        ops.push({ op: "setOfflineSync", entities: { [C]: { mode: "byXPath", xpath: "[Code > 0]" }, [O]: "nothingPreserve", "System.Language": "all" } });
        ops.push({ op: "createNanoflow", module: mod, name: `${T}_GSync`, folder: "ZzGrid", parameters: [{ name: "Ord", type: O }], actions: [{ action: "synchronize", objects: ["Ord"] }, { action: "synchronize", objects: "unsynchronized" }, { action: "synchronize" }] });
    } else {
        refuse.push([{ op: "setOfflineSync", entities: { [C]: "all" } }, /no offline-first profile/],
            [{ op: "createNanoflow", module: mod, name: `${T}_GSync`, actions: [{ action: "synchronize" }] }, /synchronize synchronizes an offline-first app/]);
    }
    refuse.push([{ op: "createEntity", module: mod, name: `${T}GRed`, color: "red" }, /does not store an entity color/],
        [{ op: "arrangeDomainModel", module: mod, mode: "circle" }, /mode 'circle' is not known/]);
    return { ops, refuse, C, O, A };
}

async function gridPhase({ s2, reopen, copy, mod, T, layout, layoutProblems, check, results }) {
    const x = await targets(s2);
    const plan = plans(mod, T, x);
    const problems = [];
    let s = s2;
    const before = new Set(s.ctx.project.units.keys());
    const lint = await s.ops.runPlan({ ops: plan.ops }, () => {});
    problems.push(...lint);
    // placement (R5): the new entities do not overlap, the owner sits next to the other end, the specialization next to its parent
    const d = await (s.model.allDomainModels().find(m => m.containerAsModule.name === mod)).load();
    const ent = n => d.entities.find(e => e.name === n);
    const [cu, or, sp] = [ent(`${T}GCust`), ent(`${T}GOrd`), ent(`${T}GSpecial`)];
    for (const e of [cu, or, sp]) for (const o of d.entities) if (o !== e && overlap(box(e), box(o))) problems.push(`placement: ${e.name} overlaps ${o.name}`);
    const near = (a, b) => Math.abs(box(a).x - box(b).x) + Math.abs(box(a).y - box(b).y) < 600;
    if (!near(or, cu)) problems.push(`placement: ${or.name} is not next to ${cu.name}`);
    if (!near(sp, cu)) problems.push(`placement: ${sp.name} is not next to its parent`);
    if (cu.documentation !== "Customers of the grid test") problems.push("createEntity documentation not stored");
    // the overlap lint: a box made wider than the gap to its neighbour
    const w0 = s.client.summary().warnings.filter(w => /DOMAIN LAYOUT/.test(w)).length;
    await s.ops.runPlan({ ops: [{ op: "addAttribute", entity: plan.C, name: "AVeryLongAttributeNameThatMakesTheBoxMuchWiderThanBefore", type: "String(200)" }] }, () => {});
    const lintLines = s.client.summary().warnings.filter(w => /DOMAIN LAYOUT/.test(w));
    if (lintLines.length <= w0) problems.push("no DOMAIN LAYOUT line after a box grew over its neighbour");
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
    problems.push(...storedProblems(s, mod, T, x, plan));
    // arrangeDomainModel: no overlaps, the same positions when run again, nothing but positions changed
    const dmId = [...s.ctx.project.units.keys()].find(id => {
        const u = s.ctx.project.read(id);
        return u.$Type === "DomainModels$DomainModel" && s.model.allDomainModels().some(m => m.id === id && m.containerAsModule.name === mod);
    });
    const strip = u => JSON.stringify(u, (k, v) => (k === "Location" ? undefined : v));
    const dm0 = s.ctx.project.read(dmId);
    await s.ops.runPlan({ ops: [{ op: "arrangeDomainModel", module: mod, mode: "compact" }] }, () => {});
    await s.model.flushChanges();
    let e2 = s.client.encode();
    s.client.project.writeEncoded(e2);
    s = await reopen(copy);
    const dm1 = s.ctx.project.read(dmId);
    if (strip(dm0) !== strip(dm1)) problems.push("arrangeDomainModel changed more than positions");
    const bs = dm1.Entities.map(e => {
        const [px, py] = e.Location.split(";").map(Number);
        return { name: e.Name, x: px, y: py };
    });
    const dd = await s.model.allDomainModels().find(m => m.id === dmId).load();
    const boxes = dd.entities.map(box);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) problems.push(`arrangeDomainModel: ${dd.entities[i].name} overlaps ${dd.entities[j].name}`);
    await s.ops.runPlan({ ops: [{ op: "arrangeDomainModel", module: mod, mode: "compact" }] }, () => {});
    if (dd.entities.some(e => { const b = bs.find(x => x.name === e.name); return !b || b.x !== e.location.x || b.y !== e.location.y; })) problems.push("arrangeDomainModel is not deterministic (a second run moves entities)");
    await s.ops.runPlan({ ops: [{ op: "arrangeDomainModel", module: mod, mode: "grid" }] }, () => {});
    const gb = dd.entities.map(box);
    for (let i = 0; i < gb.length; i++) for (let j = i + 1; j < gb.length; j++) if (overlap(gb[i], gb[j])) problems.push(`arrangeDomainModel grid: ${dd.entities[i].name} overlaps ${dd.entities[j].name}`);
    // the refusals (on a fresh copy of the saved model, thrown away)
    s = await reopen(copy);
    for (const [o, re] of plan.refuse) {
        let msg = "";
        try {
            await s.ops.runPlan({ ops: [o] }, () => {});
        } catch (e) {
            msg = e.message;
        }
        if (!re.test(msg)) problems.push(`${o.op} ${o.name || ""} not refused with ${re}${msg ? `: ${msg.slice(0, 200)}` : " (it ran)"}`);
    }
    const what = [x.pageable && x.grid2 && `Data grid 2 ${x.grid2.version} column settings (width, size, min width, ${x.alignment ? "alignment, " : ""}hide, resize, reorder, sort, visible, tooltip, wrap, class) + changeWidget columns.change`,
        x.pageable && x.grid2 && x.filters && `${x.refFilter ? "association drop-down filter (Data Widgets 3)" : x.colAssoc ? "association filter of the column (Data grid 2 2.x)" : "column filters"} and filters above the grid${x.gallery ? " and the gallery" : ""}`,
        x.pageable && (x.grid2 ? "page variables in grid / gallery / list view XPath" : "page variables in list view XPath"), x.offline ? `offline sync (${x.offline}) + nanoflow synchronize` : "offline refusals (no offline profile)",
        "entity placement, overlap lint, arrangeDomainModel compact + grid", `${plan.refuse.length} refusals`].filter(Boolean);
    if (!x.pageable) results.push("SKIP grid pages: this project has no page with a layout to copy");
    else if (!x.grid2) results.push("SKIP grid Data grid 2 column settings and filters: widgets/ has no Data grid 2 .mpk");
    else if (!x.filters) results.push("SKIP grid filters: widgets/ lacks the Data Widgets filter .mpk files");
    if (x.pageable && x.grid2 && x.filters && !x.samples.ref && x.refFilter) results.push("NOTE grid: no Studio Pro-saved association filter in this project (compared with the .mpk only)");
    check(`grid: ${what.join("; ")}; stored with Studio Pro's keys${x.samples.ref ? ` (association filter as ${x.samples.ref.page}.${x.samples.ref.name})` : ""}${x.samples.linked ? ` (filter above as ${x.samples.linked.page}.${x.samples.linked.name})` : ""}, reopen 0 errors`,
        !problems.length, [...new Set(problems)].slice(0, 6).join("; "));
    if (firstUse.length) results.push(`NOTE grid: no Studio Pro sample in this project of ${firstUse.length} type(s): ${firstUse.slice(0, 8).join(", ")}`);
    return reopen(copy);
}

// what the saved model holds: widget types = .mpk, column values, filter properties as the samples, offline settings
function storedProblems(s, mod, T, x, plan) {
    const r = [];
    const project = s.ctx.project;
    let page = null, nf = null, nav = null;
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type === "Forms$Page" && u.Name === `${T}_GGrid`) page = u;
        if (u.$Type === "Microflows$Nanoflow" && u.Name === `${T}_GSync`) nf = u;
        if (u.$Type === "Navigation$NavigationDocument") nav = u;
    }
    const inst = pluggable.installed(project.dir);
    if (x.pageable && x.grid2) {
        if (!page) return [...r, "grid page missing"];
        const named = {};
        walk(page, o => o.Name && (named[o.Name] = named[o.Name] || o));
        for (const w of Object.values(named).filter(o => o.$Type === "CustomWidgets$CustomWidget")) {
            const diff = pluggable.typeDiff(w.Type, inst.get(w.Type.WidgetId));
            if (diff.length) r.push(`${w.Name}: type differs from the .mpk (${diff[0]})`);
        }
        const g = named.zzgGrid;
        const cols = props(g).get("columns").Objects.map(o => props(g, o));
        const val = (c, k) => (c.get(k) ? c.get(k).PrimitiveValue || c.get(k).Expression : undefined);
        const want = [[0, "width", "autoFill"], [0, "size", "3"], [0, "sortable", "false"], [0, "hidable", "hidden"], [1, "width", "autoFit"], [1, "wrapText", "true"], [1, "resizable", "false"], [1, "draggable", "false"],
            [1, "columnClass", "if $currentObject/Number > 10 then 'big' else ''"], [2, "columnClass", "'cust-col'"], [2, "minWidth", "manual"], [2, "minWidthLimit", "120"], [2, "hidable", "no"], [3, "size", "2"], [4, "wrapText", "true"]];
        if (x.alignment) want.push([0, "alignment", "right"]);
        for (const [i, k, v] of want) if (val(cols[i], k) !== v) r.push(`column ${i + 1} ${k} is ${val(cols[i], k)}, expected ${v}`);
        const tip = cols[1].get("tooltip").TextTemplate;
        if (!tip || tip.Parameters.length !== 2) r.push("column 2 tooltip has no {Number}/{Note} parameters");
        const ds = props(g).get("datasource").DataSource;
        if (!ds || ds.XPathConstraint !== "[contains(Note, $Search) and Number >= $Min]") r.push("Data grid 2 XPath with page variables not stored");
        const cl = named.zzgClassic;
        if (!cl || (cl.Columns[0].WidthValue !== undefined ? cl.Columns[0].WidthValue : cl.Columns[0].Width) !== 60 || cl.Columns[0].Appearance.Class !== "text-right") r.push("classic column width / class not stored");
        if (x.filters) {
            const filters = Object.values(named).filter(o => o.$Type === "CustomWidgets$CustomWidget" && Object.values(F).includes(o.Type.WidgetId));
            const ref = filters.filter(f => props(f).get("baseType") && props(f).get("baseType").PrimitiveValue === "ref");
            if (x.refFilter) {
                if (ref.length < 2) r.push(`association drop-down filters: ${ref.length}, expected 2 (column + above)`);
                for (const f of ref) {
                    const p = props(f);
                    const steps = p.get("refEntity").EntityRef && p.get("refEntity").EntityRef.Steps;
                    if (!steps || steps.length !== 1 || steps[0].Association !== `${mod}.${plan.A}`) r.push(`${f.Name}: refEntity is not ${plan.A}`);
                    if (!p.get("refOptions").DataSource || p.get("refOptions").DataSource.EntityRef.Entity !== plan.C) r.push(`${f.Name}: refOptions is not ${plan.C}`);
                    if (!p.get("refCaption").AttributeRef || p.get("refCaption").AttributeRef.Attribute !== `${plan.C}.Name`) r.push(`${f.Name}: refCaption is not Name`);
                    if (x.samples.ref && setKeys(f) !== x.samples.ref.keys) r.push(`${f.Name}: set properties ${setKeys(f)} differ from the Studio Pro sample ${x.samples.ref.page}.${x.samples.ref.name} (${x.samples.ref.keys})`);
                }
                const colRef = ref.find(f => props(f).get("refOptions").DataSource && props(f).get("refOptions").DataSource.XPathConstraint === "[Code > 0]");
                if (!colRef || props(colRef).get("multiSelect").PrimitiveValue !== "true") r.push("column association filter: options XPath / multi-select not stored");
            } else if (x.colAssoc) {
                const c = cols[2];
                if (!c.get("filterAssociation").EntityRef || !c.get("filterAssociationOptions").DataSource || c.get("filterAssociationOptionLabel").Expression !== "$currentObject/Name") r.push("Data grid 2 2.x column association filter not stored");
            }
            const linked = filters.filter(f => props(f).get("attrChoice") && props(f).get("attrChoice").PrimitiveValue === "linked");
            if (props(g).get("filterList")) {
                if (props(g).get("filterList").Objects.length < 2) r.push("2.x filterList of the grid lacks the header filter attributes");
            } else {
                const textAbove = linked.filter(f => f.Type.WidgetId === F.text);
                if (textAbove.length < (x.gallery ? 2 : 1)) r.push(`text filters above the grid/gallery: ${textAbove.length}`);
                for (const f of textAbove) {
                    const a = props(f).get("attributes").Objects.map(o => props(f, o).get("attribute").AttributeRef);
                    if (!a.length || !a[0] || a[0].Attribute !== `${plan.O}.Note`) r.push(`${f.Name}: attributes is not [Note]`);
                    if (x.samples.linked && setKeys(f) !== x.samples.linked.keys) r.push(`${f.Name}: set properties ${setKeys(f)} differ from the Studio Pro sample ${x.samples.linked.page}.${x.samples.linked.name} (${x.samples.linked.keys})`);
                }
            }
        }
    }
    if (x.pageable && !x.grid2) {
        let xp = null;
        walk(page || {}, o => o.Name === "zzgList" && o.DataSource && (xp = o.DataSource.XPathConstraint));
        if (xp !== "[contains(Note, $Search)]") r.push(`list view XPath with a page variable: ${xp}`);
    }
    if (x.offline) {
        const prof = nav && nav.Profiles.find(p => p.Name === x.offline);
        const cfg = qn => prof && (prof.OfflineEntityConfigs || []).find(c => c.Entity === qn);
        const want = [[plan.C, "Constrained", "[Code > 0]"], [plan.O, "NoneAndPreserveData", ""], ["System.Language", "All", ""]];
        for (const [qn, m, xp] of want) {
            const c = cfg(qn);
            if (!c || c.SyncMode !== m || c.Constraint !== xp) r.push(`offline ${qn}: ${c ? `${c.SyncMode} ${c.Constraint}` : "missing"}, expected ${m} ${xp}`);
            const sample = prof.OfflineEntityConfigs.find(o => o !== c);
            if (c && sample && Object.keys(c).sort().join() !== Object.keys(sample).sort().join()) r.push(`offline ${qn}: keys ${Object.keys(c).sort()} differ from Studio Pro's ${Object.keys(sample).sort()}`);
        }
        const acts = [];
        walk(nf || {}, o => o.$Type === "Microflows$SynchronizeAction" && acts.push(`${o.Type}:${(o.VariableNames || []).join("+")}`));
        if (acts.sort().join() !== ["All:", "Specific:Ord", "Unsynchronized:"].join()) r.push(`synchronize actions: ${acts.join(", ") || "none"}`);
    }
    return r;
}

module.exports = { gridPhase, targets, plans };
