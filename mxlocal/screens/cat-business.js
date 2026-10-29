"use strict";
// Business areas: leave requests, tasks, customers (CRM), products and orders, documents, notifications.
const P = require("./patterns");

const header = (c, title, sub, actions = []) => c.kit.header(title, sub, actions, c.d);
// two microflows that set an enumeration attribute of the object around the button and commit it
function setStatusFlows(c, attr, pairs) {
    return pairs.map(([suffix, value]) => ({
        op: "createMicroflow", module: c.m, name: `${c.name}_${suffix}`, parameters: [{ name: "Item", type: c.s.entity }],
        actions: [{ action: "change", variable: "Item", set: { [attr]: c.enumValue(attr, value) }, commit: true }]
    }));
}
const flowBtn = (c, suffix, caption, icon, style) => c.kit.button({ action: "callMicroflow", microflow: `${c.m}.${c.name}_${suffix}`, caption, icon, ...(style ? { style } : {}) });

// ---------------------------------------------------------------- leave / requests

const REQ = { ...P.RECORD("Request"), status: { kind: "attr", of: "entity", type: "Enumeration", desc: "request status (Draft / Submitted / Approved / Rejected)", sample: "Status" },
    date: { kind: "attr", of: "entity", type: "DateTime", desc: "first day", sample: "FromDate" } };
const REQ_EX = { entity: "MyFirstModule.LeaveRequest", title: "Reason" };
const leave = [
    { id: "request.form", name: "Request form", desc: "a request with dates and reason; Submit sets the status", keywords: ["leave", "izin", "request", "talep", "form"],
        build: c => ({ title: "New request", entity: c.s.entity, pre: setStatusFlows(c, c.s.status, [["Submit", "Submitted"]]), widgets: [
            c.kit.h("New request", 2), c.kit.muted("Fill in the dates and the reason, then submit.", { class: "spacing-outer-bottom-large" }),
            c.card([{ widget: "dataView", source: "parameter", orientation: "vertical", buttons: false, widgets: [c.kit.fieldPairs(P.inputsFor(c, c.s.fields.filter(f => f !== c.s.status)))],
                footer: [c.kit.button({ action: "cancel", caption: "Cancel" }), flowBtn(c, "Submit", "Submit", "mx-icon-checkmark", "Primary")] }])] }) },
    { id: "request.mine", name: "My requests", desc: "my requests as cards with their status label; New request on top", keywords: ["my requests", "taleplerim", "status"],
        build: c => ({ title: "My requests", widgets: [header(c, "My requests", null, [P.newAction(c, "New request")]), P.cards(c, { columns: { desktop: 3, tablet: 2, phone: 1 } })] }) },
    { id: "request.approve", name: "Approve requests", desc: "submitted requests as rows with Approve and Reject buttons", keywords: ["approve", "onay", "reject", "manager", "inbox"],
        build: c => ({ title: "Approvals", pre: setStatusFlows(c, c.s.status, [["Approve", "Approved"], ["Reject", "Rejected"]]), widgets: [header(c, "Approvals", "Requests waiting for you"),
            c.card([{ widget: "listView", entity: c.s.entity, pageSize: 20, xpath: `[${c.s.status} = '${c.enumValue(c.s.status, "Submitted").split(".").pop()}']`, sort: P.sortBy(c), widgets: [
                c.kit.cols([[6, P.titleOf(c), 6, 12], [3, P.meta(c), 3, 12], [3, [flowBtn(c, "Approve", "Approve", "mx-icon-checkmark", "Success"), flowBtn(c, "Reject", "Reject")], 3, 12]])] }])] }) },
    { id: "request.overview", name: "Requests by status", desc: "counts per status on top (stat cards), all requests below in a table", keywords: ["overview", "counts", "hr"],
        build: c => {
            const vals = c.enumValues(c.s.status).slice(0, 4);
            const k = P.kpis(c, vals.map(v => ({ label: P.label(v), entity: c.s.entity, xpath: `[${c.s.status} = '${v}']` })));
            return { title: "Requests", pre: k.pre, widgets: [header(c, "Requests", null, [P.newAction(c, "New request")]), k.widget, P.table(c)] };
        } }
].map(x => ({ slots: REQ, example: REQ_EX, ...x }));

// ---------------------------------------------------------------- tasks

const TASK = { ...P.RECORD("Task"), done: { kind: "attr", of: "entity", type: "Boolean", desc: "done or not", sample: "Done" },
    priority: { kind: "attr", of: "entity", type: "Enumeration", optional: true, desc: "priority", sample: "Priority" } };
const TASK_EX = { entity: "MyFirstModule.WorkTask", status: "TaskPriority" };
const doneFlow = c => ({ op: "createMicroflow", module: c.m, name: `${c.name}_Toggle`, parameters: [{ name: "Item", type: c.s.entity }], actions: [{ action: "change", variable: "Item", set: { [c.s.done]: `not($Item/${c.s.done})` }, commit: true }] });
const tasks = [
    { id: "task.inbox", name: "Task inbox", desc: "open tasks as rows with a ✓ button; done ones hidden", keywords: ["tasks", "görev", "todo", "inbox"],
        build: c => ({ title: "Tasks", pre: [doneFlow(c)], widgets: [header(c, "My tasks", "What is open", [P.newAction(c, "New task")]),
            c.card([{ widget: "listView", entity: c.s.entity, xpath: `[${c.s.done} = false()]`, pageSize: 20, sort: P.sortBy(c), widgets: [
                c.kit.cols([[9, P.titleOf(c), 9, 9], [3, [c.kit.button({ action: "callMicroflow", microflow: `${c.m}.${c.name}_Toggle`, caption: "Done", icon: "mx-icon-checkmark", iconOnly: true })], 3, 3]])] }])] }) },
    { id: "task.board", name: "Task board by priority", desc: "a column per priority (as a board), each with its open tasks; stacked on phones", keywords: ["board", "kanban", "priority"],
        slots: { ...TASK, priority: { ...TASK.priority, optional: false } }, example: { entity: "MyFirstModule.WorkTask", priority: "TaskPriority", status: "TaskPriority" },
        build: c => {
            const vals = c.enumValues(c.s.priority).slice(0, 4);
            return { title: "Board", widgets: [header(c, "Board", null, [P.newAction(c, "New task")]),
                c.kit.cols(vals.map(v => [Math.floor(12 / vals.length), c.card([c.kit.h(P.label(v), 4), { widget: "listView", entity: c.s.entity, xpath: `[${c.s.priority} = '${v}'][${c.s.done} = false()]`, pageSize: 10, widgets: [c.card(P.titleOf(c), { class: "background-secondary" })] }]), 6, 12]))] };
        } },
    { id: "task.today", name: "Due soon", desc: "tasks due in the next 7 days, sorted by date", keywords: ["due", "deadline", "today", "upcoming"],
        build: c => ({ title: "Due soon", widgets: [header(c, "Due soon", "The next 7 days"),
            c.card([{ widget: "listView", entity: c.s.entity, xpath: c.s.date ? `[${c.s.date} <= '[%EndOfCurrentDay%] + 7 * [%DayLength%]'][${c.s.done} = false()]` : `[${c.s.done} = false()]`, pageSize: 20, sort: P.sortBy(c), widgets: [c.kit.cols([[8, P.titleOf(c), 8, 12], [4, P.meta(c), 4, 12]])] }])] }) }
].map(x => ({ slots: TASK, example: TASK_EX, ...x }));

// ---------------------------------------------------------------- CRM

const CUST_EX = { entity: "MyFirstModule.Customer" };
const OPP = { ...P.RECORD("Deal"), stage: { kind: "attr", of: "entity", type: "Enumeration", desc: "pipeline stage", sample: "Stage" } };
const OPP_EX = { entity: "MyFirstModule.Opportunity", status: "Stage", stage: "Stage" };
const crm = [
    { id: "crm.customers", name: "Customer table", desc: "customers with search, segment filter and export", keywords: ["customers", "müşteri", "crm", "accounts"], slots: P.RECORD("Customer"), example: CUST_EX,
        build: c => ({ title: "Customers", widgets: [header(c, "Customers", null, [P.newAction(c, "New customer")]), P.table(c, { export: true })] }) },
    { id: "crm.customerCards", name: "Customer cards", desc: "customers as contact cards (3/2/1)", keywords: ["contacts", "cards"], slots: P.RECORD("Customer"), example: CUST_EX,
        build: c => ({ title: "Customers", widgets: [header(c, "Customers", null, [P.newAction(c, "New customer")]), P.cards(c)] }) },
    { id: "crm.pipeline", name: "Pipeline by stage", desc: "a column per stage with its deals as cards (a board); stacked on phones", keywords: ["pipeline", "funnel", "deals", "stages", "satış"], slots: OPP, example: OPP_EX,
        build: c => {
            const vals = c.enumValues(c.s.stage).slice(0, 4);
            return { title: "Pipeline", widgets: [header(c, "Pipeline", null, [P.newAction(c, "New deal")]),
                c.kit.cols(vals.map(v => [Math.floor(12 / vals.length), c.card([c.kit.h(P.label(v), 4), { widget: "listView", entity: c.s.entity, xpath: `[${c.s.stage} = '${v}']`, pageSize: 10, onClick: P.open(c), widgets: [c.card([...P.titleOf(c), ...P.meta(c)], { class: "background-secondary" })] }]), 6, 12]))] };
        } },
    { id: "crm.deals", name: "Deals with stage tabs", desc: "deals in tabs per stage, each a table", keywords: ["deals", "opportunities", "tabs"], slots: OPP, example: OPP_EX,
        build: c => ({ title: "Deals", widgets: [header(c, "Deals", null, [P.newAction(c, "New deal")]), { widget: "tabContainer", tabs: c.enumValues(c.s.stage).slice(0, 5).map(v => ({ caption: P.label(v), widgets: [P.table(c, { xpath: `[${c.s.stage} = '${v}']`, statusFilter: false })] })) }] }) }
];

// ---------------------------------------------------------------- products and orders

const PROD_EX = { entity: "MyFirstModule.Product", amount: "Price" };
const ORDER_EX = { entity: "MyFirstModule.SalesOrder", title: "Number" };
const shop = [
    { id: "shop.catalog", name: "Product catalog", desc: "products as cards with price; search on top", keywords: ["products", "catalog", "ürün", "katalog", "shop"], slots: P.RECORD("Product"), example: PROD_EX,
        build: c => ({ title: "Products", widgets: [header(c, "Products", null, [P.newAction(c, "New product")]), P.cards(c, { columns: { desktop: 4, tablet: 2, phone: 1 }, pageSize: 16 })] }) },
    { id: "shop.stock", name: "Stock table", desc: "products with stock and price in a table; export", keywords: ["stock", "stok", "inventory", "warehouse"], slots: P.RECORD("Product"), example: PROD_EX,
        build: c => ({ title: "Stock", widgets: [header(c, "Stock", "Products and quantities"), P.table(c, { export: true })] }) },
    { id: "shop.orders", name: "Order table", desc: "orders with number, date, total and status; status filter", keywords: ["orders", "sipariş", "sales"], slots: P.RECORD("Order"), example: ORDER_EX,
        build: c => ({ title: "Orders", widgets: [header(c, "Orders", null, [P.newAction(c, "New order")]), P.table(c)] }) },
    { id: "shop.order", name: "Order with lines", desc: "an order header (number, date, status) and its lines below", keywords: ["order detail", "lines", "invoice", "fatura"],
        slots: { ...P.RECORD("Order"), child: { kind: "entity", desc: "the lines", sample: "OrderLine" }, link: { kind: "assoc", from: "child", to: "entity", desc: "line to order" }, lineText: { kind: "attr", of: "child", type: "Any", desc: "line text", sample: "Description" }, lineAmount: { kind: "attr", of: "child", type: "Number", optional: true, desc: "line amount", sample: "Price" } },
        example: { entity: "MyFirstModule.SalesOrder", title: "Number", child: "MyFirstModule.OrderLine", lineText: "Description", lineAmount: "Price" },
        build: c => ({ title: "Order", entity: c.s.entity, widgets: [{ widget: "dataView", source: "parameter", editable: false, showFooter: false, widgets: [
            c.kit.cols([[8, [c.kit.text(`{${c.s.title}}`, { style: "H2" }), ...P.meta(c)], 8, 12], [4, P.statusBadge(c), 4, 12]]),
            c.card([c.kit.h("Lines", 4), { widget: "listView", association: c.s.link, pageSize: 20, widgets: [c.kit.cols([[8, P.val(c, c.s.lineText), 8, 8], [4, c.s.lineAmount ? [P.val(c, c.s.lineAmount, { class: "text-right" })] : [], 4, 4]])] }])] }] }) }
];

// ---------------------------------------------------------------- documents and notifications

const DOC = { ...P.RECORD("Document") };
const DOC_EX = { entity: "MyFirstModule.Attachment", title: "Title" };
const docs = [
    { id: "doc.list", name: "Document list", desc: "documents in a table; a row opens the document page", keywords: ["documents", "files", "doküman", "dosya"], slots: DOC, example: DOC_EX,
        build: c => ({ title: "Documents", widgets: [header(c, "Documents", null, [P.newAction(c, "Upload")]), P.table(c, { columns: c.s.cols.filter(x => !/^(Size|Contents|HasContents|DeleteAfterDownload)$/.test(x)).slice(0, 4) })] }) },
    { id: "doc.upload", name: "Upload a document", desc: "title, category and the file upload in one card", keywords: ["upload", "yükle", "attach"], slots: DOC, example: DOC_EX,
        build: c => ({ title: "Upload", entity: c.s.entity, widgets: [c.kit.h("Upload a document", 2), c.card([{ widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: [
            ...P.inputsFor(c, c.s.fields.filter(f => !/^(Name|Size|Contents|HasContents|DeleteAfterDownload)$/.test(f)).slice(0, 3)), { widget: "fileManager", type: "upload", label: "File" }] }])] }) }
];

const NOTE = { ...P.RECORD("Notice"), seen: { kind: "attr", of: "entity", type: "Boolean", desc: "read or not", sample: "Seen" } };
const NOTE_EX = { entity: "MyFirstModule.Notice", title: "Message" };
const notify = [
    { id: "notice.center", name: "Notification center", desc: "tabs Unread / All; a ✓ marks one as read", keywords: ["notifications", "bildirim", "messages", "alerts"], slots: NOTE, example: NOTE_EX,
        build: c => ({ title: "Notifications", pre: [{ op: "createMicroflow", module: c.m, name: `${c.name}_Read`, parameters: [{ name: "Item", type: c.s.entity }], actions: [{ action: "change", variable: "Item", set: { [c.s.seen]: "true" }, commit: true }] }],
            widgets: [header(c, "Notifications"), { widget: "tabContainer", tabs: [[`Unread`, `[${c.s.seen} = false()]`], ["All", null]].map(([cap, xp]) => ({ caption: cap, widgets: [c.card([{ widget: "listView", entity: c.s.entity, ...(xp ? { xpath: xp } : {}), pageSize: 20, sort: P.sortBy(c), widgets: [
                c.kit.cols([[10, [...P.titleOf(c), ...P.meta(c)], 10, 9], [2, [c.kit.button({ action: "callMicroflow", microflow: `${c.m}.${c.name}_Read`, caption: "Mark as read", icon: "mx-icon-checkmark", iconOnly: true })], 2, 3]])] }])] })) }] }) }
];

module.exports = { groups: [
    { category: { id: "request", title: "Requests and approvals (leave, expenses, purchases)", keywords: ["leave", "izin", "request", "talep", "approve", "onay", "reject", "vacation"] }, templates: leave },
    { category: { id: "task", title: "Tasks and to-dos", keywords: ["tasks", "görev", "todo", "board", "kanban", "due", "deadline"] }, templates: tasks },
    { category: { id: "crm", title: "Customers and sales (CRM)", keywords: ["customers", "müşteri", "crm", "pipeline", "deals", "fırsat", "sales"] }, templates: crm },
    { category: { id: "shop", title: "Products, stock and orders", keywords: ["products", "ürün", "catalog", "stock", "stok", "orders", "sipariş", "invoice"] }, templates: shop },
    { category: { id: "doc", title: "Documents and files", keywords: ["documents", "doküman", "files", "dosya", "upload", "yükle"] }, templates: docs },
    { category: { id: "notice", title: "Notifications", keywords: ["notifications", "bildirim", "messages", "alerts", "inbox"] }, templates: notify }
] };
