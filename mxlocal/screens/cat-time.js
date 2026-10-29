"use strict";
// Time: clock in / out, breaks, timesheets, shifts, manual entries.
const SLOTS = {
    entity: { kind: "entity", desc: "a time entry (one row per work period)", sample: "TimeEntry" },
    start: { kind: "attr", of: "entity", type: "DateTime", desc: "when it started", sample: "ClockIn" },
    end: { kind: "attr", of: "entity", type: "DateTime", desc: "when it ended (empty while running)", sample: "ClockOut" },
    hours: { kind: "attr", of: "entity", type: "Decimal", optional: true, desc: "hours, filled at clock out", sample: "Hours" },
    kind: { kind: "attr", of: "entity", type: "Enumeration", optional: true, desc: "work / break kind", sample: "Kind" }
};
const EX = { entity: "MyFirstModule.TimeEntry" };

// the microflows of the clock buttons: start a new entry; close the running one
function clockFlows(c) {
    const { s, m, name } = c;
    const E = s.entity;
    const set = extra => ({ [s.start]: "[%CurrentDateTime%]", ...extra });
    const flows = [
        { op: "createMicroflow", module: m, name: `${name}_ClockIn`, actions: [{ action: "create", entity: E, variable: "Entry", set: set(), commit: true }] },
        { op: "createMicroflow", module: m, name: `${name}_ClockOut`, actions: [
            { action: "retrieve", variable: "Open", entity: E, xpath: `[${s.end} = empty]`, first: true, sort: [{ attribute: s.start, descending: true }] },
            { action: "if", condition: "$Open != empty", caption: "running?", then: [
                { action: "change", variable: "Open", set: { [s.end]: "[%CurrentDateTime%]", ...(s.hours ? { [s.hours]: `secondsBetween($Open/${s.start}, [%CurrentDateTime%]) div 3600` } : {}) }, commit: true }] }] }
    ];
    return flows;
}
const clockButtons = (c, big = true) => [
    c.kit.button({ action: "callMicroflow", microflow: `${c.m}.${c.name}_ClockIn`, caption: "Clock in", icon: "mx-icon-play-circle", style: "Primary", class: `btn-block${big ? " btn-lg" : ""} spacing-outer-bottom-medium`, progress: "blocking" }),
    c.kit.button({ action: "callMicroflow", microflow: `${c.m}.${c.name}_ClockOut`, caption: "Clock out", icon: "mx-icon-controls-stop", class: `btn-block${big ? " btn-lg" : ""}`, progress: "blocking" })
];
const todayList = (c, size = 10) => ({
    widget: "listView", entity: c.s.entity, pageSize: size, sort: [{ attribute: c.s.start, direction: "desc" }],
    widgets: [c.kit.text(`{${c.s.start}} – {${c.s.end}}`, { format: { [c.s.start]: { date: "dd-MM HH:mm" }, [c.s.end]: { date: "HH:mm" } } })]
});

const templates = [
    {
        id: "time.clock.big", name: "Clock in/out with today's list", desc: "two big buttons left, today's entries right; stacked on phones",
        keywords: ["clock in", "clock out", "mesai", "giriş çıkış", "punch"], slots: SLOTS, example: EX,
        build: c => ({ title: "Time clock", pre: clockFlows(c), widgets: [
            c.kit.h("Time clock", 2), c.kit.muted("Clock in when you start, clock out when you stop.", { class: "spacing-outer-bottom-large" }),
            c.kit.cols([[5, c.card(clockButtons(c)), 12], [7, c.card([c.kit.h("Today", 4), todayList(c)]), 12]])] })
    },
    {
        id: "time.clock.kiosk", name: "Kiosk: two huge buttons", desc: "a shared screen at the door: only two large buttons, centred",
        keywords: ["kiosk", "terminal", "door", "shared device"], slots: SLOTS, example: EX,
        build: c => ({ title: "Clock in / out", pre: clockFlows(c), widgets: [
            c.kit.cols([[3, [], 2, 12], [6, c.card([c.kit.h("Welcome", 1, { class: "text-center" }), c.kit.muted("Tap to clock in or out", { class: "text-center spacing-outer-bottom-large" }), ...clockButtons(c)], { class: "text-center" }), 8, 12], [3, [], 2, 12]])] })
    },
    {
        id: "time.clock.compact", name: "Compact clock bar", desc: "a slim bar with both buttons side by side and the last entries under it",
        keywords: ["compact", "bar", "small"], slots: SLOTS, example: EX,
        build: c => ({ title: "Time", pre: clockFlows(c), widgets: [
            c.kit.header("Time", "Your entries today", [], c.d),
            c.card([c.kit.cols([[6, clockButtons(c, false)[0], 6, 6], [6, clockButtons(c, false)[1], 6, 6]])]),
            c.card([c.kit.h("Latest", 4), todayList(c, 5)])] })
    },
    {
        id: "time.clock.summary", name: "Clock with hours summary", desc: "buttons, a card with the entries and their hours, a link to the full timesheet",
        keywords: ["hours", "summary", "total", "week"], slots: { ...SLOTS, hours: { ...SLOTS.hours, optional: false } }, example: EX,
        build: c => ({ title: "My time", pre: clockFlows(c), widgets: [
            c.kit.header("My time", "Clock in and see your hours", [], c.d),
            c.kit.cols([[4, c.card(clockButtons(c)), 12], [8, c.card([c.kit.h("Entries", 4), {
                widget: "listView", entity: c.s.entity, pageSize: 10, sort: [{ attribute: c.s.start, direction: "desc" }],
                widgets: [c.kit.cols([[8, c.kit.text(`{${c.s.start}}`, { format: { [c.s.start]: { date: "EEE dd-MM HH:mm" } } }), 8, 8], [4, c.kit.text(`{${c.s.hours}} h`, { class: "text-right", format: { [c.s.hours]: { decimals: 2 } } }), 4, 4]])]
            }]), 12]])] })
    },
    {
        id: "time.timesheet.table", name: "Timesheet table", desc: "all entries in a Data grid 2 with a date filter, hours column and export to Excel",
        keywords: ["timesheet", "puantaj", "table", "export"], slots: { ...SLOTS, hours: { ...SLOTS.hours, optional: false } }, example: EX,
        build: c => ({ title: "Timesheet", widgets: [
            c.kit.header("Timesheet", "All time entries", [], c.d),
            { widget: "dataGrid", kind: "datagrid2", entity: c.s.entity, columns: [c.s.start, c.s.end, c.s.hours, ...(c.s.kind ? [c.s.kind] : [])],
                headerFilters: [{ filter: "date", attribute: c.s.start }], paging: { mode: "buttons", pageSize: 20 }, sort: [{ attribute: c.s.start, direction: "desc" }], emptyMessage: "No time entries yet" }] })
    },
    {
        id: "time.timesheet.cards", name: "Timesheet as cards", desc: "entries as cards (3 / 2 / 1 per row), good on phones",
        keywords: ["cards", "mobile", "timesheet"], slots: SLOTS, example: EX,
        build: c => ({ title: "Timesheet", widgets: [
            c.kit.header("Timesheet", null, [], c.d),
            { widget: "gallery", entity: c.s.entity, columns: { desktop: 3, tablet: 2, phone: 1 }, paging: { mode: "buttons", pageSize: 12 }, emptyMessage: "No time entries yet", sort: [{ attribute: c.s.start, direction: "desc" }],
                widgets: [c.card([c.kit.text(`{${c.s.start}}`, { style: "H4", format: { [c.s.start]: { date: "EEE dd MMM" } } }), c.kit.muted(`{${c.s.start}} – {${c.s.end}}`, { format: { [c.s.start]: { date: "HH:mm" }, [c.s.end]: { date: "HH:mm" } } }), ...(c.s.kind ? [c.kit.badge(c.s.kind)] : [])])] }] })
    },
    {
        id: "time.entry.form", name: "Manual time entry", desc: "a form to add or correct an entry: start, end, kind; labels on top",
        keywords: ["manual", "correct", "add entry", "form"], slots: SLOTS, example: EX,
        build: c => ({ title: "Time entry", entity: c.s.entity, widgets: [
            c.kit.h("Time entry", 2),
            c.card([{ widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: [c.kit.fieldPairs([
                c.kit.input(c.s.start, "Start", { type: "DateTime", dateTime: true, required: true }), c.kit.input(c.s.end, "End", { type: "DateTime", dateTime: true }),
                ...(c.s.kind ? [c.kit.input(c.s.kind, "Kind")] : [])])] }])] })
    }
];

module.exports = { category: { id: "time", title: "Time and attendance", keywords: ["clock in", "clock out", "mesai", "giriş çıkış", "timesheet", "puantaj", "hours", "shift"] }, templates };
