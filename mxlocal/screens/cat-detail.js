"use strict";
// One record: read views and edit forms.
const P = require("./patterns");

const SLOTS = P.RECORD("Item");
const EX = { entity: "MyFirstModule.Employee" };
const view = (c, widgets) => ({ widget: "dataView", source: "parameter", editable: false, showFooter: false, widgets });
const editBtn = c => (c.s.edit ? [c.kit.button({ action: "showPage", page: c.s.edit, caption: "Edit", icon: "mx-icon-pencil", style: "Primary" })] : []);
const half = (arr, i) => arr.filter((x, k) => (k < Math.ceil(arr.length / 2)) === (i === 0));

const detail = [
    { id: "detail.sections", name: "Details in cards", desc: "title and status on top, the fields as label/value rows in a card", keywords: ["details", "view", "read"],
        build: c => ({ title: c.short(c.s.entity), entity: c.s.entity, widgets: [view(c, [
            c.kit.cols([[8, [c.kit.text(`{${c.s.title}}`, { style: "H2" }), ...P.statusBadge(c)], 8, 12], [4, editBtn(c), 4, 12]]),
            c.card([c.kit.h("Details", 4), ...P.readRows(c, c.s.fields.filter(f => f !== c.s.title))])])] }) },
    { id: "detail.twoCards", name: "Details in two cards", desc: "the fields split over two cards side by side; one under the other on phones", keywords: ["two columns", "cards"],
        build: c => ({ title: c.short(c.s.entity), entity: c.s.entity, widgets: [view(c, [
            c.kit.text(`{${c.s.title}}`, { style: "H2" }),
            c.kit.cols([[6, c.card([c.kit.h("General", 4), ...P.readRows(c, half(c.s.fields, 0))]), 12], [6, c.card([c.kit.h("More", 4), ...P.readRows(c, half(c.s.fields, 1))]), 12]]),
            ...editBtn(c)])] }) },
    { id: "detail.tabs", name: "Details with tabs", desc: "a header and tabs: Overview (the main fields) and Details (the rest)", keywords: ["tabs", "sections"],
        build: c => ({ title: c.short(c.s.entity), entity: c.s.entity, widgets: [view(c, [
            c.kit.cols([[8, [c.kit.text(`{${c.s.title}}`, { style: "H2" }), ...(c.s.subtitle ? [c.kit.muted(`{${c.s.subtitle}}`)] : [])], 8, 12], [4, editBtn(c), 4, 12]]),
            { widget: "tabContainer", tabs: [{ caption: "Overview", widgets: [c.card(P.readRows(c, half(c.s.fields, 0)))] }, { caption: "Details", widgets: [c.card(P.readRows(c, half(c.s.fields, 1)))] }] }])] }) },
    { id: "detail.side", name: "Details with side summary", desc: "the fields left (8/12), a summary card right with status, date and amount (4/12)", keywords: ["summary", "side panel"],
        build: c => ({ title: c.short(c.s.entity), entity: c.s.entity, widgets: [view(c, [
            c.kit.text(`{${c.s.title}}`, { style: "H2" }),
            c.kit.cols([[8, c.card(P.readRows(c, c.s.fields)), 12], [4, c.card([c.kit.h("Summary", 4), ...P.statusBadge(c), ...P.meta(c), ...editBtn(c)]), 12]])])] }) },
    { id: "detail.related", name: "Details with related list", desc: "the record on top and the records linked to it below (e.g. a customer and its orders)", keywords: ["related", "children", "lines", "360"],
        slots: { ...SLOTS, child: { kind: "entity", desc: "the linked records", sample: "Line" }, link: { kind: "assoc", from: "child", to: "entity", desc: "association between them" }, childTitle: { kind: "attr", of: "child", type: "Any", desc: "text of a linked record", sample: "LineName" } },
        example: { entity: "MyFirstModule.Customer", child: "MyFirstModule.Opportunity" },
        build: c => ({ title: c.short(c.s.entity), entity: c.s.entity, widgets: [view(c, [
            c.kit.text(`{${c.s.title}}`, { style: "H2" }), ...P.statusBadge(c),
            c.kit.cols([[5, c.card([c.kit.h("Details", 4), ...P.readRows(c, c.s.fields.filter(f => f !== c.s.title).slice(0, 5))]), 12],
                [7, c.card([c.kit.h(`${c.short(c.s.child)}s`, 4), { widget: "listView", association: c.s.link, pageSize: 10, widgets: [P.val(c, c.s.childTitle)] }]), 12]])])] }) }
];

const forms = [
    { id: "form.twoColumns", name: "Form, two columns", desc: "fields in pairs (one per row on phones), labels on top, Save / Cancel", keywords: ["form", "edit", "create", "two columns"],
        build: c => ({ title: `Edit ${c.short(c.s.entity).toLowerCase()}`, entity: c.s.entity, widgets: [c.kit.h(`Edit ${c.short(c.s.entity).toLowerCase()}`, 2), c.card([P.form(c)])] }) },
    { id: "form.single", name: "Form, one column", desc: "one field per row everywhere; short forms and phones", keywords: ["simple form", "one column"],
        build: c => ({ title: `Edit ${c.short(c.s.entity).toLowerCase()}`, entity: c.s.entity, widgets: [c.kit.cols([[2, [], 1, 12], [8, [c.kit.h(`Edit ${c.short(c.s.entity).toLowerCase()}`, 2), c.card([P.form(c, { single: true })])], 10, 12], [2, [], 1, 12]])] }) },
    { id: "form.sections", name: "Form in sections", desc: "the fields in titled cards (General / Details), Save at the end", keywords: ["sections", "long form"],
        build: c => ({ title: `Edit ${c.short(c.s.entity).toLowerCase()}`, entity: c.s.entity, widgets: [c.kit.h(`Edit ${c.short(c.s.entity).toLowerCase()}`, 2),
            { widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: [
                c.card([c.kit.h("General", 4), c.kit.fieldPairs(P.inputsFor(c, half(c.s.fields, 0)))]),
                c.card([c.kit.h("Details", 4), c.kit.fieldPairs(P.inputsFor(c, half(c.s.fields, 1)))])] }] }) },
    { id: "form.help", name: "Form with help panel", desc: "the form left (8/12) and a help card right (4/12) that explains the fields", keywords: ["help", "guidance", "explain"],
        slots: { ...SLOTS, help: { kind: "text", default: "Fill in the fields marked with * and press Save.", desc: "the help text" } },
        build: c => ({ title: `Edit ${c.short(c.s.entity).toLowerCase()}`, entity: c.s.entity, widgets: [c.kit.h(`Edit ${c.short(c.s.entity).toLowerCase()}`, 2),
            c.kit.cols([[8, c.card([P.form(c)]), 12], [4, c.kit.tile([c.kit.h("Help", 4), c.kit.muted(c.s.help)]), 12]])] }) },
    { id: "form.steps", name: "Form in numbered steps", desc: "the fields grouped as 1, 2, 3 on one page (step boxes), Save at the end", keywords: ["wizard", "steps", "adım"],
        build: c => {
            const groups = [0, 1, 2].map(i => c.s.fields.filter((f, k) => k % 3 === i)).filter(g => g.length);
            return { title: `New ${c.short(c.s.entity).toLowerCase()}`, entity: c.s.entity, widgets: [c.kit.h(`New ${c.short(c.s.entity).toLowerCase()}`, 2),
                { widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: groups.map((g, i) => c.card([c.kit.h(`${i + 1}. ${["Basics", "Details", "Extra"][i]}`, 4), c.kit.fieldPairs(P.inputsFor(c, g))])) }] };
        } },
    { id: "form.popup", name: "Quick edit pop-up", desc: "a pop-up (600 px, height auto) with a short form; for small edits", keywords: ["popup", "modal", "quick edit"],
        build: c => ({ title: `Edit ${c.short(c.s.entity).toLowerCase()}`, entity: c.s.entity, page: { layout: "Atlas_Core.PopupLayout", popupWidth: 600, popupHeight: 0 }, widgets: [P.form(c, { single: true, fields: c.s.fields.slice(0, 5) })] }) }
];

const templates = [...detail, ...forms].map(x => ({ slots: SLOTS, example: EX, ...x }));
module.exports = { category: { id: "record", title: "One record: details and forms", keywords: ["detail", "details", "form", "edit", "create", "view", "detay", "form", "düzenle"] }, templates };
