"use strict";
// More templates for the categories of the other files (loaded last: they join those categories).
const P = require("./patterns");

const header = (c, title, sub, actions = []) => c.kit.header(title, sub, actions, c.d);
const REC = P.RECORD("Item");
const EX = { entity: "MyFirstModule.Employee" };
const cat = id => ({ id, title: id, keywords: [] });
const view = (c, widgets) => ({ widget: "dataView", source: "parameter", editable: false, showFooter: false, widgets });
const editBtn = (c, style) => (c.s.edit ? [c.kit.button({ action: "showPage", page: c.s.edit, caption: "Edit", icon: "mx-icon-pencil", ...(style ? { style } : {}) })] : []);
const recent = (c, n = 5, entityKey = "entity", title = "title") => ({ widget: "listView", entity: c.s[entityKey], pageSize: n, widgets: [c.kit.text(`{${c.s[title]}}`)] });

// ---------------------------------------------------------------- time
const SHIFT = { entity: { kind: "entity", desc: "a shift", sample: "Shift" }, title: { kind: "attr", of: "entity", type: "Text", desc: "role or name", sample: "Role" },
    start: { kind: "attr", of: "entity", type: "DateTime", desc: "start", sample: "StartTime" }, end: { kind: "attr", of: "entity", type: "DateTime", desc: "end", sample: "EndTime" } };
const shiftText = c => [c.kit.text(`{${c.s.title}}`, { style: "H4" }), c.kit.muted(`{${c.s.start}} – {${c.s.end}}`, { format: { [c.s.start]: { date: "EEE dd-MM HH:mm" }, [c.s.end]: { date: "HH:mm" } } })];
const time = [
    { id: "time.shift.cards", name: "Shifts as cards", desc: "upcoming shifts as cards (3/2/1), soonest first", keywords: ["shift", "vardiya", "roster", "schedule"], slots: SHIFT, example: { entity: "MyFirstModule.Shift" },
        build: c => ({ title: "Shifts", widgets: [header(c, "Shifts", "Upcoming"), { widget: "gallery", entity: c.s.entity, columns: { desktop: 3, tablet: 2, phone: 1 }, paging: { mode: "buttons", pageSize: 12 }, sort: [c.s.start], emptyMessage: "No shifts planned", widgets: [c.card(shiftText(c))] }] }) },
    { id: "time.shift.table", name: "Shift roster table", desc: "all shifts in a table with a date filter and export", keywords: ["roster", "plan", "table"], slots: SHIFT, example: { entity: "MyFirstModule.Shift" },
        build: c => ({ title: "Roster", widgets: [header(c, "Roster"), { widget: "dataGrid", kind: "datagrid2", entity: c.s.entity, columns: [c.s.title, c.s.start, c.s.end], headerFilters: [{ filter: "date", attribute: c.s.start }], paging: { mode: "buttons", pageSize: 20 }, sort: [c.s.start], export: { caption: "Export to Excel", fileName: "Roster" }, emptyMessage: "No shifts" }] }) },
    { id: "time.shift.list", name: "Shift list (compact)", desc: "shifts as compact rows in one card; good inside a dashboard", keywords: ["compact", "list"], slots: SHIFT, example: { entity: "MyFirstModule.Shift" },
        build: c => ({ title: "Shifts", widgets: [header(c, "My shifts"), c.card([{ widget: "listView", entity: c.s.entity, pageSize: 10, sort: [c.s.start], widgets: [c.kit.cols([[6, c.kit.text(`{${c.s.title}}`), 6, 12], [6, c.kit.muted(`{${c.s.start}} – {${c.s.end}}`, { format: { [c.s.start]: { date: "dd-MM HH:mm" }, [c.s.end]: { date: "HH:mm" } } }), 6, 12]])] }])] }) }
];

// ---------------------------------------------------------------- lists
const lists = [
    { id: "list.searchHero", name: "Search first", desc: "a big title and search on top, cards under it; for finding one record fast", keywords: ["search", "ara", "find", "directory"],
        build: c => ({ title: c.short(c.s.entity), widgets: [c.kit.h(`Find ${c.short(c.s.entity).toLowerCase()}`, 1), c.kit.muted("Type a name to search", { class: "spacing-outer-bottom-large" }), P.cards(c)] }) },
    { id: "list.plainRows", name: "Plain rows", desc: "rows without a card or menu; the lightest list", keywords: ["simple", "plain", "minimal"],
        build: c => ({ title: c.short(c.s.entity), widgets: [header(c, `${c.short(c.s.entity)}s`, null, [P.newAction(c)]), P.rows(c, { menu: false })] }) },
    { id: "list.tableSide", name: "Table + help card", desc: "the table (9/12) and a card with a short explanation and New (3/12)", keywords: ["sidebar", "help", "table"],
        build: c => ({ title: c.short(c.s.entity), widgets: [c.kit.h(`${c.short(c.s.entity)}s`, 2), c.kit.cols([[9, P.table(c), 12], [3, c.card([c.kit.h("About", 4), c.kit.muted(`All ${c.short(c.s.entity).toLowerCase()}s. Click a row to open it.`), c.kit.button({ ...P.newAction(c), class: "btn-block" })]), 12]])] }) }
].map(x => ({ slots: REC, example: EX, ...x }));

// ---------------------------------------------------------------- one record
const record = [
    { id: "detail.hero", name: "Details with header band", desc: "a coloured header band with title, status and Edit; the fields in a card below", keywords: ["hero", "banner", "header"],
        build: c => ({ title: c.short(c.s.entity), entity: c.s.entity, widgets: [view(c, [
            c.kit.section([c.kit.cols([[8, [c.kit.text(`{${c.s.title}}`, { style: "H1" }), ...(c.s.subtitle ? [c.kit.muted(`{${c.s.subtitle}}`)] : []), ...P.statusBadge(c)], 8, 12], [4, editBtn(c, "Primary"), 4, 12]])], { class: "spacing-outer-bottom-large" }),
            c.card(P.readRows(c, c.s.fields.filter(f => f !== c.s.title)))])] }) },
    { id: "form.review", name: "Review before confirm", desc: "a read-only summary of the record with Back and Confirm", keywords: ["review", "confirm", "summary", "onayla"],
        build: c => ({ title: "Review", entity: c.s.entity, widgets: [c.kit.h("Please review", 2), c.kit.muted("Check the details, then confirm.", { class: "spacing-outer-bottom-large" }),
            c.card([{ widget: "dataView", source: "parameter", editable: false, widgets: P.readRows(c, c.s.fields), footer: [c.kit.button({ action: "cancel", caption: "Back" }), c.kit.button({ action: "save", caption: "Confirm", style: "Primary" })] }])] }) },
    { id: "form.editableList", name: "Edit many at once", desc: "an editable list: each row has inputs for its fields and a ✓ that saves the row", keywords: ["bulk edit", "inline", "grid edit", "toplu"],
        build: c => ({ title: `Edit ${c.short(c.s.entity).toLowerCase()}s`,
            pre: [{ op: "createMicroflow", module: c.m, name: `${c.name}_SaveRow`, parameters: [{ name: "Item", type: c.s.entity }], actions: [{ action: "commit", variable: "Item" }] }],
            widgets: [header(c, `Edit ${c.short(c.s.entity).toLowerCase()}s`), c.card([{ widget: "listView", entity: c.s.entity, editable: true, pageSize: 10, sort: P.sortBy(c),
                widgets: [c.kit.cols([...c.s.fields.slice(0, 3).map(f => [3, c.kit.input(f, P.label(f), { type: c.t[f] }), 3, 12]), [3, c.kit.button({ action: "callMicroflow", microflow: `${c.m}.${c.name}_SaveRow`, caption: "Save", icon: "mx-icon-checkmark", iconOnly: true }), 3, 12]])] }])] }) }
].map(x => ({ slots: REC, example: EX, ...x }));

// ---------------------------------------------------------------- requests, tasks
const REQ = { ...REC, status: { kind: "attr", of: "entity", type: "Enumeration", desc: "request status", sample: "Status" }, date: { kind: "attr", of: "entity", type: "DateTime", desc: "first day", sample: "FromDate" } };
const request = [
    { id: "request.history", name: "Request history", desc: "all my requests as rows: dates, status label; newest first", keywords: ["history", "geçmiş", "timeline"],
        build: c => ({ title: "History", widgets: [header(c, "Request history", null, [P.newAction(c, "New request")]), c.card([P.rows(c, { menu: false })])] }) },
    { id: "request.table", name: "Requests table (HR)", desc: "every request in a table with status filter and export; for HR", keywords: ["hr", "all requests", "export"],
        build: c => ({ title: "Requests", widgets: [header(c, "All requests"), P.table(c, { export: true })] }) }
].map(x => ({ slots: REQ, example: { entity: "MyFirstModule.LeaveRequest", title: "Reason" }, ...x }));
const TASK = { ...REC, done: { kind: "attr", of: "entity", type: "Boolean", desc: "done or not", sample: "Done" } };
const task = [
    { id: "task.cards", name: "Tasks as cards", desc: "open tasks as cards with their due date (3/2/1)", keywords: ["cards", "tasks"],
        build: c => ({ title: "Tasks", widgets: [header(c, "Tasks", null, [P.newAction(c, "New task")]), P.cards(c, { xpath: `[${c.s.done} = false()]` })] }) },
    { id: "task.detail", name: "Task details", desc: "a task with its description and a Done check box; Save", keywords: ["task detail", "description"],
        build: c => ({ title: "Task", entity: c.s.entity, widgets: [{ widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: [
            c.kit.text(`{${c.s.title}}`, { style: "H2" }), ...P.meta(c), c.card(P.inputsFor(c, c.s.fields.filter(f => f !== c.s.title)))] }] }) }
].map(x => ({ slots: TASK, example: { entity: "MyFirstModule.WorkTask", status: "TaskPriority" }, ...x }));

// ---------------------------------------------------------------- crm, shop, docs, notices
const crm = [
    { id: "crm.customer360", name: "Customer 360", desc: "customer details, its deals and a New deal button on one page", keywords: ["360", "customer detail", "account"],
        slots: { ...REC, child: { kind: "entity", desc: "linked records (deals, orders)", sample: "Deal" }, link: { kind: "assoc", from: "child", to: "entity", desc: "link to the customer" }, childTitle: { kind: "attr", of: "child", type: "Any", desc: "text of a linked record", sample: "Title" } },
        example: { entity: "MyFirstModule.Customer", child: "MyFirstModule.Opportunity", childTitle: "Title" },
        build: c => ({ title: "Customer", entity: c.s.entity, widgets: [view(c, [
            c.kit.cols([[8, [c.kit.text(`{${c.s.title}}`, { style: "H1" }), ...P.statusBadge(c)], 8, 12], [4, editBtn(c, "Primary"), 4, 12]]),
            c.kit.cols([[4, c.card([c.kit.h("Contact", 4), ...P.readRows(c, c.s.fields.filter(f => f !== c.s.title).slice(0, 4))]), 12],
                [8, c.card([c.kit.h(`${c.short(c.s.child)}s`, 4), { widget: "listView", association: c.s.link, pageSize: 10, widgets: [P.val(c, c.s.childTitle)] }]), 12]])])] }) },
    { id: "crm.dealForm", name: "Deal form", desc: "a deal: title, amount, stage and close date in pairs", keywords: ["deal", "opportunity", "form"], slots: REC, example: { entity: "MyFirstModule.Opportunity", title: "Title" },
        build: c => ({ title: "Deal", entity: c.s.entity, widgets: [c.kit.h("Deal", 2), c.card([P.form(c)])] }) }
];
const PROD = { ...REC, amount: { kind: "attr", of: "entity", type: "Number", desc: "price", sample: "Price" }, qty: { kind: "attr", of: "entity", type: "Number", desc: "stock quantity", sample: "Stock" } };
const shop = [
    { id: "shop.product", name: "Product page", desc: "product name, big price, stock and the details; Edit", keywords: ["product detail", "ürün detay"], slots: PROD, example: { entity: "MyFirstModule.Product", amount: "Price", qty: "Stock" },
        build: c => ({ title: "Product", entity: c.s.entity, widgets: [view(c, [c.kit.cols([[7, [c.kit.text(`{${c.s.title}}`, { style: "H1" }), ...(c.s.subtitle ? [c.kit.muted(`{${c.s.subtitle}}`)] : [])], 7, 12],
            [5, c.card([P.val(c, c.s.amount, { style: "H2" }), c.kit.muted(`In stock: {${c.s.qty}}`), ...editBtn(c, "Primary")]), 5, 12]]), c.card(P.readRows(c, c.s.fields))])] }) },
    { id: "shop.lowStock", name: "Low stock", desc: "products with fewer than 10 in stock, as rows", keywords: ["low stock", "reorder", "alert"], slots: PROD, example: { entity: "MyFirstModule.Product", amount: "Price", qty: "Stock" },
        build: c => ({ title: "Low stock", widgets: [header(c, "Low stock", "Fewer than 10 left"), c.card([{ widget: "listView", entity: c.s.entity, xpath: `[${c.s.qty} < 10]`, pageSize: 20, sort: [c.s.qty], widgets: [c.kit.cols([[8, P.titleOf(c), 8, 8], [4, P.val(c, c.s.qty, { class: "text-danger text-right" }), 4, 4]])] }])] }) },
    { id: "shop.orderCards", name: "Orders as cards", desc: "orders as cards with total and status (3/2/1)", keywords: ["orders", "cards"], slots: REC, example: { entity: "MyFirstModule.SalesOrder", title: "Number" },
        build: c => ({ title: "Orders", widgets: [header(c, "Orders", null, [P.newAction(c, "New order")]), P.cards(c)] }) }
];
const doc = [{ id: "doc.cards", name: "Documents as cards", desc: "documents as cards with their category", keywords: ["cards", "files"], slots: REC, example: { entity: "MyFirstModule.Attachment", title: "Title" },
    build: c => ({ title: "Documents", widgets: [header(c, "Documents", null, [P.newAction(c, "Upload")]), P.cards(c)] }) }];
const notice = [{ id: "notice.feed", name: "Notification feed", desc: "the newest notifications as a simple feed", keywords: ["feed", "activity"], slots: REC, example: { entity: "MyFirstModule.Notice", title: "Message" },
    build: c => ({ title: "Activity", widgets: [header(c, "Activity"), c.card([P.rows(c, { menu: false, pageSize: 30 })])] }) }];

// ---------------------------------------------------------------- dashboards, reports, settings, home, native
const PERSONAL = { entity: { kind: "entity", desc: "first list (tasks)", sample: "Task" }, title: { kind: "attr", of: "entity", type: "Text", desc: "its text", sample: "Title" },
    second: { kind: "entity", desc: "second list (notifications)", sample: "Notice" }, secondTitle: { kind: "attr", of: "second", type: "Text", desc: "its text", sample: "Message" } };
const dash = [
    { id: "dash.personal", name: "My day", desc: "two cards side by side: my open items and my latest notifications", keywords: ["my day", "personal", "today", "bugün"], slots: PERSONAL,
        example: { entity: "MyFirstModule.WorkTask", second: "MyFirstModule.Notice", secondTitle: "Message" },
        build: c => ({ title: "My day", widgets: [header(c, "My day"), c.kit.cols([[6, c.card([c.kit.h(`${c.short(c.s.entity)}s`, 4), recent(c, 8)]), 12], [6, c.card([c.kit.h(`${c.short(c.s.second)}s`, 4), recent(c, 8, "second", "secondTitle")]), 12]])] }) },
    { id: "dash.statsOnly", name: "Big stats", desc: "only stat cards (total and per status), large and clear", keywords: ["kpi", "numbers", "wallboard"], slots: { ...REC, status: { ...REC.status, optional: false } }, example: EX,
        build: c => { const k = P.kpis(c, [{ label: "Total", entity: c.s.entity }, ...c.enumValues(c.s.status).slice(0, 3).map(v => ({ label: P.label(v), entity: c.s.entity, xpath: `[${c.s.status} = '${v}']` }))]); return { title: "Numbers", pre: k.pre, widgets: [header(c, "Numbers"), k.widget] }; } }
];
const REP = { ...REC, date: { ...REC.date, optional: false }, amount: { ...REC.amount, optional: false } };
const report = [
    { id: "report.area", name: "Area chart", desc: "an area chart of the amount over time", keywords: ["area", "volume"], slots: REP, example: { entity: "MyFirstModule.Opportunity", title: "Title" },
        build: c => ({ title: "Volume", widgets: [header(c, "Volume"), c.card([{ widget: "areaChart", entity: c.s.entity, x: c.s.date, y: c.s.amount, aggregation: "sum" }])] }) },
    { id: "report.bar", name: "Bar chart + list", desc: "a bar chart and the records next to it", keywords: ["bar", "compare"], slots: REP, example: { entity: "MyFirstModule.Opportunity", title: "Title" },
        build: c => ({ title: "Compare", widgets: [header(c, "Compare"), c.kit.cols([[7, c.card([{ widget: "barChart", entity: c.s.entity, x: c.s.date, y: c.s.amount, aggregation: "sum" }]), 12], [5, c.card([c.kit.h("Records", 4), recent(c, 8)]), 12]])] }) }
];
const settings = [{ id: "settings.accordion", name: "Settings in groups", desc: "the settings in collapsible groups (accordion), Save at the end", keywords: ["accordion", "groups", "advanced"], slots: REC, example: EX,
    build: c => ({ title: "Settings", entity: c.s.entity, widgets: [c.kit.h("Settings", 2), { widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: [{ widget: "accordion", groups: [
        { header: "General", widgets: P.inputsFor(c, c.s.fields.slice(0, 4)) }, { header: "Advanced", collapsed: true, widgets: P.inputsFor(c, c.s.fields.slice(4, 8)) }] }] }] }) }];
const home = [{ id: "home.welcome", name: "Welcome with shortcuts", desc: "a greeting band and shortcut buttons as a row (stacked on phones)", keywords: ["welcome", "shortcuts", "hoş geldin"],
    slots: { greeting: { kind: "text", default: "Good morning", desc: "greeting" }, p1: { kind: "page", optional: true, desc: "shortcut 1", sample: "Orders" }, p2: { kind: "page", optional: true, desc: "shortcut 2", sample: "Customers" }, p3: { kind: "page", optional: true, desc: "shortcut 3", sample: "Reports" } },
    example: { p1: "MyFirstModule.Home_Web" },
    build: c => ({ title: "Home", widgets: [c.kit.section([c.kit.h(c.s.greeting, 1), c.kit.muted("What do you want to do today?")], { class: "spacing-outer-bottom-large" }),
        c.kit.cols(["p1", "p2", "p3"].filter(k => c.s[k]).map(k => [4, c.kit.button({ action: "showPage", page: c.s[k], caption: c.short(c.s[k]).replace(/_/g, " "), class: "btn-block btn-lg" }), 4, 12]))] }) }];
const native = [{ id: "native.home", name: "Native home buttons", desc: "big full-width buttons to the main native pages", keywords: ["mobile home", "menu"],
    slots: { p1: { kind: "page", optional: true, desc: "native page 1", sample: "Orders" }, p2: { kind: "page", optional: true, desc: "native page 2", sample: "Tasks" } }, example: {},
    build: c => ({ title: "Home", page: { native: true }, widgets: [c.kit.text("Home"), ...["p1", "p2"].filter(k => c.s[k]).map(k => c.kit.button({ action: "showPage", page: c.s[k], caption: c.short(c.s[k]).replace(/_/g, " ") }))] }) }];

module.exports = { groups: [
    { category: cat("time"), templates: time }, { category: cat("list"), templates: lists }, { category: cat("record"), templates: record },
    { category: cat("request"), templates: request }, { category: cat("task"), templates: task }, { category: cat("crm"), templates: crm },
    { category: cat("shop"), templates: shop }, { category: cat("doc"), templates: doc }, { category: cat("notice"), templates: notice },
    { category: cat("dash"), templates: dash }, { category: cat("report"), templates: report }, { category: cat("settings"), templates: settings },
    { category: cat("home"), templates: home }, { category: cat("native"), templates: native }
] };
