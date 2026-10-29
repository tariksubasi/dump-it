"use strict";
// App-wide screens: dashboards, reports, settings and profile, state screens, home pages, sign-in, native mobile.
const P = require("./patterns");

const header = (c, title, sub, actions = []) => c.kit.header(title, sub, actions, c.d);
const REC = P.RECORD("Item");
const EX = { entity: "MyFirstModule.Employee" };

// ---------------------------------------------------------------- dashboards

const DASH = { ...REC, status: { ...REC.status, optional: false } };
const kpiByStatus = c => P.kpis(c, [{ label: "Total", entity: c.s.entity }, ...c.enumValues(c.s.status).slice(0, 3).map(v => ({ label: P.label(v), entity: c.s.entity, xpath: `[${c.s.status} = '${v}']` }))]);
const recent = (c, n = 5) => ({ widget: "listView", entity: c.s.entity, pageSize: n, sort: P.sortBy(c), ...(c.s.edit ? { onClick: P.open(c) } : {}), widgets: [c.kit.cols([[8, P.titleOf(c), 8, 9], [4, P.statusBadge(c), 4, 3]])] });
const dash = [
    { id: "dash.kpiList", name: "Stats + recent list", desc: "4 stat cards (total and per status) and the latest records", keywords: ["dashboard", "kpi", "stats", "özet"],
        build: c => { const k = kpiByStatus(c); return { title: "Dashboard", pre: k.pre, widgets: [header(c, "Dashboard", "At a glance"), k.widget, c.card([c.kit.h("Recent", 4), recent(c)])] }; } },
    { id: "dash.split", name: "Stats + list + actions", desc: "stats on top; recent records (8/12) and a quick actions card (4/12)", keywords: ["dashboard", "quick actions", "home"],
        build: c => { const k = kpiByStatus(c); return { title: "Dashboard", pre: k.pre, widgets: [header(c, "Dashboard"), k.widget,
            c.kit.cols([[8, c.card([c.kit.h("Recent", 4), recent(c, 8)]), 12], [4, c.card([c.kit.h("Quick actions", 4), c.kit.button({ ...P.newAction(c), class: "btn-block" })]), 12]])] }; } },
    { id: "dash.table", name: "Stats + full table", desc: "stats on top, the whole list as a table under them", keywords: ["manager", "operations", "table"],
        build: c => { const k = kpiByStatus(c); return { title: "Overview", pre: k.pre, widgets: [header(c, "Overview", null, [P.newAction(c)]), k.widget, P.table(c, { pageSize: 10 })] }; } },
    { id: "dash.statusColumns", name: "Status columns", desc: "a column per status with the latest records in it; stacked on phones", keywords: ["status board", "columns"],
        build: c => { const vals = c.enumValues(c.s.status).slice(0, 4); return { title: "Status", widgets: [header(c, "By status"),
            c.kit.cols(vals.map(v => [Math.floor(12 / vals.length), c.card([c.kit.h(P.label(v), 4), { widget: "listView", entity: c.s.entity, xpath: `[${c.s.status} = '${v}']`, pageSize: 5, widgets: P.titleOf(c) }]), 6, 12]))] }; } },
    { id: "dash.chart", name: "Stats + chart", desc: "stats on top and a column chart of the amount over the date (needs the Charts widget)", keywords: ["chart", "grafik", "trend"],
        slots: { ...DASH, date: { ...REC.date, optional: false }, amount: { ...REC.amount, optional: false } }, example: { entity: "MyFirstModule.Opportunity", status: "Stage", title: "Title" },
        build: c => { const k = kpiByStatus(c); return { title: "Dashboard", pre: k.pre, widgets: [header(c, "Dashboard"), k.widget,
            c.card([c.kit.h("Trend", 4), { widget: "columnChart", entity: c.s.entity, x: c.s.date, y: c.s.amount, aggregation: "sum" }])] }; } }
].map(x => ({ slots: DASH, example: EX, ...x }));

// ---------------------------------------------------------------- reports

const REP = { ...REC, date: { ...REC.date, optional: false }, amount: { ...REC.amount, optional: false } };
const REP_EX = { entity: "MyFirstModule.Opportunity", title: "Title" };
const reports = [
    { id: "report.columns", name: "Column chart + table", desc: "a column chart of the amount per date, the records under it with export", keywords: ["report", "rapor", "chart", "column"],
        build: c => ({ title: "Report", widgets: [header(c, "Report"), c.card([{ widget: "columnChart", entity: c.s.entity, x: c.s.date, y: c.s.amount, aggregation: "sum" }]), P.table(c, { export: true, pageSize: 10 })] }) },
    { id: "report.line", name: "Trend line", desc: "a line chart of the amount over time in a wide card", keywords: ["trend", "line", "over time"],
        build: c => ({ title: "Trend", widgets: [header(c, "Trend"), c.card([{ widget: "lineChart", entity: c.s.entity, x: c.s.date, y: c.s.amount, aggregation: "sum" }])] }) },
    { id: "report.pie", name: "Share per record", desc: "a pie chart of the amount per record next to the top list", keywords: ["pie", "share", "distribution", "dağılım"],
        build: c => ({ title: "Share", widgets: [header(c, "Share"), c.kit.cols([[6, c.card([{ widget: "pieChart", entity: c.s.entity, value: c.s.amount, caption: `{${c.s.title}}` }]), 12], [6, c.card([c.kit.h("Top", 4), recent(c, 8)]), 12]])] }) }
].map(x => ({ slots: REP, example: REP_EX, ...x }));

// ---------------------------------------------------------------- settings and profile

const PROF_EX = { entity: "MyFirstModule.Employee" };
const settings = [
    { id: "settings.profile", name: "Profile", desc: "a profile card (name, email) and the editable fields in sections", keywords: ["profile", "profil", "account", "me"], slots: REC, example: PROF_EX,
        build: c => ({ title: "Profile", entity: c.s.entity, widgets: [c.kit.h("Profile", 2), { widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: [
            c.kit.cols([[4, c.card([c.kit.text(`{${c.s.title}}`, { style: "H3" }), ...(c.s.subtitle ? [c.kit.muted(`{${c.s.subtitle}}`)] : [])], { class: "text-center" }), 12],
                [8, c.card([c.kit.h("Details", 4), c.kit.fieldPairs(P.inputsFor(c, c.s.fields.filter(f => f !== c.s.title)))]), 12]])] }] }) },
    { id: "settings.toggles", name: "Preferences (switches)", desc: "the yes/no settings as check boxes in one card, Save at the end", keywords: ["preferences", "tercihler", "settings", "ayarlar", "options"],
        slots: { entity: REC.entity, flags: { kind: "attrs", of: "entity", type: "Boolean", max: 8, desc: "the yes/no attributes", sample: ["EmailMe", "Dark"] } }, example: PROF_EX,
        build: c => ({ title: "Preferences", entity: c.s.entity, widgets: [c.kit.h("Preferences", 2), c.card([{ widget: "dataView", source: "parameter", orientation: "vertical", buttons: true, widgets: c.s.flags.map(f => c.kit.input(f, P.label(f))) }])] }) },
    { id: "settings.users", name: "User management", desc: "people in a table with search and status filter; New on top", keywords: ["users", "kullanıcılar", "admin", "people"], slots: REC, example: PROF_EX,
        build: c => ({ title: "Users", widgets: [header(c, "Users", "Who has access", [P.newAction(c, "New user")]), P.table(c)] }) }
];

// ---------------------------------------------------------------- state screens

const NONE = {};
const state = [
    ["empty", "Empty state", "nothing here yet: title, help text, one action", "Nothing here yet", "Add the first one to get started.", ["empty", "boş"]],
    ["success", "Success", "a confirmation after an action (sent, saved)", "All done", "Your request was sent. You will get an email when it is handled.", ["success", "başarılı", "confirmation", "thanks"]],
    ["error", "Something went wrong", "an error page with a way back", "Something went wrong", "Please try again. If it keeps happening, contact support.", ["error", "hata", "failed"]],
    ["noAccess", "No access", "the user may not open this", "You do not have access", "Ask your administrator for the right role.", ["forbidden", "yetkisiz", "403", "no access"]],
    ["notFound", "Not found", "the page or record does not exist", "We could not find that", "It may have been moved or deleted.", ["404", "not found", "bulunamadı"]],
    ["maintenance", "Maintenance", "the app is being updated", "We'll be right back", "The app is being updated. Please come back in a few minutes.", ["maintenance", "bakım", "offline"]]
].map(([id, name, desc, title, body, keywords]) => ({ id: `state.${id}`, name, desc, keywords, slots: NONE, example: {},
    build: c => ({ title: name, widgets: P.stateScreen(c, title, body, { action: "close", caption: "Go back", icon: "mx-icon-home" }) }) }));

// ---------------------------------------------------------------- home pages

const HOME = { greeting: { kind: "text", default: "Welcome", desc: "the greeting" }, p1: { kind: "page", optional: true, desc: "page of tile 1 (no parameters)", sample: "Orders" }, p2: { kind: "page", optional: true, desc: "page of tile 2", sample: "Customers" }, p3: { kind: "page", optional: true, desc: "page of tile 3", sample: "Reports" }, p4: { kind: "page", optional: true, desc: "page of tile 4", sample: "Settings" } };
const tiles = c => ["p1", "p2", "p3", "p4"].filter(k => c.s[k]).map(k => [3, c.card([c.kit.h(c.short(c.s[k]).replace(/_/g, " "), 4), c.kit.button({ action: "showPage", page: c.s[k], caption: "Open", class: "btn-block" })]), 6, 12]);
const home = [
    { id: "home.tiles", name: "Home with tiles", desc: "a greeting and a tile per main page (4/2/1 per row)", keywords: ["home", "ana sayfa", "start", "landing", "tiles"],
        build: c => ({ title: "Home", widgets: [c.kit.h(c.s.greeting, 1), c.kit.muted("Where do you want to go?", { class: "spacing-outer-bottom-large" }), ...(tiles(c).length ? [c.kit.cols(tiles(c))] : [c.card([c.kit.muted("Add pages to the slots p1..p4")])])] }) },
    { id: "home.navList", name: "Home with a link list", desc: "a greeting and a simple list of links (good on phones)", keywords: ["menu", "links", "navigation"],
        build: c => ({ title: "Home", widgets: [c.kit.h(c.s.greeting, 2), c.card([{ widget: "navigationList", items: ["p1", "p2", "p3", "p4"].filter(k => c.s[k]).map(k => ({ caption: c.short(c.s[k]).replace(/_/g, " "), action: { action: "showPage", page: c.s[k] } })).concat(["p1", "p2", "p3", "p4"].some(k => c.s[k]) ? [] : [{ caption: "Home" }]) }])] }) }
].map(x => ({ slots: HOME, example: { p1: "MyFirstModule.Home_Web" }, ...x }));

// ---------------------------------------------------------------- sign-in

const auth = [
    { id: "auth.login", name: "Sign-in, centred", desc: "the standard sign-in form in the middle", keywords: ["login", "giriş", "sign in", "oturum"], heading: "Sign in" },
    { id: "auth.loginWelcome", name: "Sign-in with welcome text", desc: "a welcome heading and a short help line under the form", keywords: ["welcome", "branded"], heading: "Welcome back", below: "Forgot your password? Ask your administrator." },
    { id: "auth.loginSupport", name: "Sign-in with support link", desc: "the form and a link to the support site under it", keywords: ["support", "help"], heading: "Sign in", link: true }
].map(x => ({ slots: { support: { kind: "text", default: "https://support.example.com", desc: "support site (auth.loginSupport)" } }, example: {}, ...x,
    build: c => ({ op: { op: "createLoginPage", heading: x.heading, widgets: [...(x.below ? [c.kit.muted(x.below, { class: "text-center" })] : []),
        ...(x.link ? [c.kit.button({ action: "openLink", url: c.s.support, caption: "Get help", renderType: "link" })] : [])], profile: false } }) }));

// ---------------------------------------------------------------- native mobile

const nat = [
    { id: "native.list", name: "Native list", desc: "a list; tapping an item opens its page (one tap target per item)", keywords: ["mobile", "native", "list", "telefon"],
        build: c => ({ title: `${c.short(c.s.entity)}s`, page: { native: true }, widgets: [{ widget: "listView", entity: c.s.entity, pageSize: 20, sort: P.sortBy(c), onClick: P.open(c), widgets: [c.kit.text(`{${c.s.title}}`), ...(c.s.subtitle ? [c.kit.text(`{${c.s.subtitle}}`)] : [])] }] }) },
    { id: "native.form", name: "Native form", desc: "a short form; the save button at the bottom of the form", keywords: ["mobile form", "native edit"],
        build: c => ({ title: `Edit ${c.short(c.s.entity).toLowerCase()}`, entity: c.s.entity, page: { native: true }, widgets: [{ widget: "dataView", source: "parameter", buttons: true, fields: c.s.fields.slice(0, 6) }] }) },
    { id: "native.detail", name: "Native details", desc: "a read view of the record with an Edit button", keywords: ["mobile detail"],
        build: c => ({ title: c.short(c.s.entity), entity: c.s.entity, page: { native: true }, widgets: [{ widget: "dataView", source: "parameter", editable: false, showFooter: false, widgets: [
            c.kit.text(`{${c.s.title}}`), ...c.s.fields.filter(f => f !== c.s.title).slice(0, 6).map(f => P.val(c, f)), c.kit.button({ action: "showPage", page: c.s.edit, caption: "Edit" })] }] }) }
].map(x => ({ slots: { ...REC, edit: { ...REC.edit, auto: "editNative", desc: "the native edit page (made when missing)" } }, example: EX, ...x }));
const natClock = {
    id: "native.clock", name: "Native clock in/out", desc: "two big buttons for the phone app", keywords: ["mobile", "clock", "mesai"],
    slots: { entity: { kind: "entity", desc: "time entry", sample: "TimeEntry" }, start: { kind: "attr", of: "entity", type: "DateTime", desc: "start", sample: "ClockIn" }, end: { kind: "attr", of: "entity", type: "DateTime", desc: "end", sample: "ClockOut" } },
    example: { entity: "MyFirstModule.TimeEntry" },
    build: c => ({ title: "Clock", page: { native: true }, pre: [
        { op: "createNanoflow", module: c.m, name: `${c.name}_ClockIn`, actions: [{ action: "create", entity: c.s.entity, variable: "Entry", set: { [c.s.start]: "[%CurrentDateTime%]" }, commit: true }] }],
    widgets: [c.kit.text("Time clock"), c.kit.button({ action: "callNanoflow", nanoflow: `${c.m}.${c.name}_ClockIn`, caption: "Clock in", style: "Primary" })] })
};

module.exports = { groups: [
    { category: { id: "dash", title: "Dashboards", keywords: ["dashboard", "kpi", "stats", "özet", "overview", "home"] }, templates: dash },
    { category: { id: "report", title: "Reports and charts", keywords: ["report", "rapor", "chart", "grafik", "trend", "pie"] }, templates: reports },
    { category: { id: "settings", title: "Settings, profile, users", keywords: ["settings", "ayarlar", "profile", "profil", "preferences", "users", "kullanıcı"] }, templates: settings },
    { category: { id: "state", title: "State screens", keywords: ["empty", "error", "success", "404", "no access", "maintenance", "boş", "hata"] }, templates: state },
    { category: { id: "home", title: "Home pages", keywords: ["home", "ana sayfa", "landing", "start", "menu"] }, templates: home },
    { category: { id: "auth", title: "Sign-in", keywords: ["login", "giriş", "sign in", "oturum", "password"] }, templates: auth },
    { category: { id: "native", title: "Native mobile", keywords: ["native", "mobile", "mobil", "telefon", "app"] }, templates: [...nat, natClock] }
] };
