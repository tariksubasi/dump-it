"use strict";
// Pluggable widget presets: short widget kinds (badge, progressBar, accordion, ...) that become the generic
// { "widget": "pluggable", "type": <id>, "properties": { ... } } of ops-pages.js with values that make a working widget
// (every required property filled, the rest at the .mpk default, as Studio Pro drops it). The widget must be installed
// in widgets/*.mpk; without it the kind is refused with the Marketplace package to import.
const pluggable = require("./pluggable");
const { fail } = require("./ops-util");

const SERIES = (key, extra = {}) => ({
    doc: "a chart of one series: x and y attributes of an entity (database, optional XPath), aggregation optional",
    fields: { entity: "R Module.Entity of the points", x: "R attribute for the x axis", y: "R attribute for the y axis (a number)", xpath: "optional XPath constraint", series: "optional series name (default the entity name)", aggregation: "optional none | count | sum | avg | min | max (default none)", xLabel: "optional x axis label", yLabel: "optional y axis label", ...extra },
    key
});

const PRESETS = {
    badge: { id: "com.mendix.widget.custom.badge.Badge", mpk: "Badge", doc: "a badge or label with a short text (Badge widget); inside a data view or list item {Attribute} shows a value", fields: { text: "optional the text (default \"New\")", type: "optional badge | label (default badge)" } },
    progressBar: { id: "com.mendix.widget.custom.progressbar.ProgressBar", mpk: "Progress Bar", doc: "a progress bar (Progress Bar widget): a fixed number, or an attribute of the object around it", fields: { value: "optional a number (default 50) or { \"attribute\": \"Done\" } of the data view / list item around it", min: "optional minimum (default 0; a number)", max: "optional maximum (default 100; a number)", showLabel: "optional true: show the percentage" } },
    progressCircle: { id: "com.mendix.widget.custom.progresscircle.ProgressCircle", mpk: "Progress Circle", doc: "a progress circle (Progress Circle widget): as progressBar", fields: { value: "optional a number (default 50) or { \"attribute\": \"Done\" }", min: "optional minimum (default 0)", max: "optional maximum (default 100)", showLabel: "optional true: show the percentage" } },
    accordion: { id: "com.mendix.widget.web.accordion.Accordion", mpk: "Accordion", doc: "collapsible groups, each with a header text and its own widgets (Accordion widget)", fields: { groups: "R [ { \"header\": \"General\", \"widgets\": [ ... ], \"collapsed\": true } ]", multiple: "optional true: several groups open at once (default one)" } },
    popupMenu: { id: "com.mendix.widget.web.popupmenu.PopupMenu", mpk: "Pop-up menu", doc: "a pop-up menu: a trigger (default a button \"Menu\") and items with actions (Pop-up menu widget)", fields: { trigger: "optional [ widgets ] that open the menu (default a \"Menu\" button)", items: "R [ { \"caption\": \"Edit\", \"action\": { ... as actionButton }, \"style\": \"danger\" } | \"divider\" ]", position: "optional bottom | top | left | right (default bottom)" } },
    treeNode: { id: "com.mendix.widget.web.treenode.TreeNode", mpk: "Tree Node", doc: "a tree node per object of an entity with a header text; children goes in \"widgets\" (e.g. another treeNode over an association)", fields: { entity: "R Module.Entity", xpath: "optional XPath constraint", caption: "R header text, e.g. \"{Name}\"", widgets: "optional [ widgets ] shown when a node opens (its children)", expanded: "optional true: start expanded" } },
    lineChart: { id: "com.mendix.widget.web.linechart.LineChart", mpk: "Charts", ...SERIES("lines") },
    columnChart: { id: "com.mendix.widget.web.columnchart.ColumnChart", mpk: "Charts", ...SERIES("series") },
    barChart: { id: "com.mendix.widget.web.barchart.BarChart", mpk: "Charts", ...SERIES("series") },
    areaChart: { id: "com.mendix.widget.web.areachart.AreaChart", mpk: "Charts", ...SERIES("series") },
    pieChart: { id: "com.mendix.widget.web.piechart.PieChart", mpk: "Charts", doc: "a pie (or doughnut) chart: one slice per object of an entity", fields: { entity: "R Module.Entity", value: "R attribute with the slice size (a number)", caption: "R slice name, e.g. \"{Name}\"", xpath: "optional XPath constraint", hole: "optional doughnut hole radius 0-90 (default 0)" } }
};

const num = (v, where, k) => {
    const n = Number(v);
    if (v === "" || typeof v === "boolean" || Number.isNaN(n)) throw new Error(`${where}: ${k} is a number`);
    return n;
};

// The generic pluggable spec for preset kind (spec checked against PRESETS[kind].fields by ops-pages kindOf).
function expand(kind, spec, where, dir) {
    const p = PRESETS[kind];
    if (!pluggable.installed(dir).has(p.id)) throw new Error(`${where}: ${kind} needs the ${p.mpk} widget (widgets/*.mpk with ${p.id}); this project has none: download "${p.mpk}" from the Marketplace and add it with importWidget, or use another widget`);
    const own = Object.keys(p.fields);
    const out = { widget: "pluggable", type: p.id };
    for (const [k, v] of Object.entries(spec)) if (!own.includes(k) && k !== "widget" && k !== "type") out[k] = v; // name, class, style, design, visible, ...
    const s = spec;
    let props;
    switch (kind) {
        case "badge":
            props = { value: s.text !== undefined ? String(s.text) : "New", type: s.type !== undefined ? String(s.type) : "badge" };
            break;
        case "progressBar":
        case "progressCircle": {
            const dyn = s.value && typeof s.value === "object";
            if (dyn && (Object.keys(s.value).length !== 1 || typeof s.value.attribute !== "string")) throw new Error(`${where}: value is a number or { "attribute": "Done" }`);
            props = dyn ? { type: "dynamic", dynamicCurrentValue: s.value.attribute } : { type: "static", staticCurrentValue: s.value !== undefined ? Math.round(num(s.value, where, "value")) : 50 };
            if (s.min !== undefined) props.staticMinValue = Math.round(num(s.min, where, "min"));
            if (s.max !== undefined) props.staticMaxValue = Math.round(num(s.max, where, "max"));
            if (dyn && (s.min !== undefined || s.max !== undefined)) throw new Error(`${where}: min / max go with a fixed number value; with an attribute the widget reads its own range (set it in Studio Pro)`);
            if (s.showLabel !== undefined) {
                props.showLabel = !!s.showLabel;
                if (s.showLabel) props.labelType = "percentage";
            }
            break;
        }
        case "accordion": {
            if (!Array.isArray(s.groups) || !s.groups.length) throw new Error(`${where}: groups is [ { "header": "General", "widgets": [ ... ] } ]`);
            props = { groups: s.groups.map((g, i) => {
                if (!g || typeof g !== "object" || Array.isArray(g)) throw new Error(`${where}: groups[${i + 1}] is { "header": ..., "widgets": [ ... ], "collapsed": true }`);
                for (const k of Object.keys(g)) if (!["header", "widgets", "collapsed"].includes(k)) fail(`${where}: groups[${i + 1}]: unknown field '${k}'`, k, ["header", "widgets", "collapsed"]);
                if (g.header === undefined || g.header === "") throw new Error(`${where}: groups[${i + 1}] needs "header"`);
                const o = { headerText: String(g.header), content: Array.isArray(g.widgets) ? g.widgets : [] };
                if (g.collapsed === false) o.initialCollapsedState = "expanded";
                return o;
            }) };
            if (s.multiple === true) props.expandBehavior = "multipleExpanded";
            break;
        }
        case "popupMenu": {
            if (!Array.isArray(s.items) || !s.items.length) throw new Error(`${where}: items is [ { "caption": "Edit", "action": { "action": ... } } | "divider" ]`);
            const styles = ["default", "inverse", "primary", "info", "success", "warning", "danger"];
            props = { menuTrigger: Array.isArray(s.trigger) && s.trigger.length ? s.trigger : [{ widget: "actionButton", caption: "Menu", action: "close", icon: "glyphicon-option-vertical" }],
                basicItems: s.items.map((it, i) => {
                    if (it === "divider") return { itemType: "divider" };
                    if (!it || typeof it !== "object" || it.caption === undefined) throw new Error(`${where}: items[${i + 1}] is { "caption": ..., "action": { ... } } or "divider"`);
                    for (const k of Object.keys(it)) if (!["caption", "action", "style"].includes(k)) fail(`${where}: items[${i + 1}]: unknown field '${k}'`, k, ["caption", "action", "style"]);
                    const o = { itemType: "item", caption: String(it.caption) };
                    if (it.action !== undefined) o.action = it.action;
                    if (it.style !== undefined) {
                        const st = String(it.style).toLowerCase();
                        if (!styles.includes(st)) fail(`${where}: items[${i + 1}]: style '${it.style}' is not known (use ${styles.join(" | ")})`, st, styles);
                        o.styleClass = `${st}Style`;
                    }
                    return o;
                }) };
            if (s.position !== undefined) props.position = String(s.position);
            if (!(Array.isArray(s.trigger) && s.trigger.length) && s.trigger !== undefined) throw new Error(`${where}: trigger is a list of widgets`);
            break;
        }
        case "treeNode":
            props = { datasource: s.xpath ? { entity: String(s.entity), xpath: String(s.xpath) } : String(s.entity), headerType: "text", headerCaption: String(s.caption), hasChildren: Array.isArray(s.widgets) && s.widgets.length > 0 };
            if (props.hasChildren) props.children = s.widgets;
            if (s.expanded === true) props.startExpanded = true;
            break;
        case "pieChart":
            props = { seriesDataSource: s.xpath ? { entity: String(s.entity), xpath: String(s.xpath) } : String(s.entity), seriesName: String(s.caption), seriesValueAttribute: String(s.value) };
            // item selection came with a later Charts .mpk: set only where the installed one has it
            if (pluggable.installed(dir).get(p.id).lines.some(l => l.startsWith("seriesItemSelection "))) props.seriesItemSelection = "None";
            if (s.hole !== undefined) props.holeRadius = Math.round(num(s.hole, where, "hole"));
            break;
        default: {
            const ds = s.xpath ? { entity: String(s.entity), xpath: String(s.xpath) } : String(s.entity);
            const one = { dataSet: "static", staticDataSource: ds, staticName: s.series !== undefined ? String(s.series) : String(s.entity).split(".").pop(), staticXAttribute: String(s.x), staticYAttribute: String(s.y) };
            if (s.aggregation !== undefined) one.aggregationType = String(s.aggregation);
            props = { [p.key]: [one], gridLines: "horizontal" };
            if (s.xLabel !== undefined) props.xAxisLabel = String(s.xLabel);
            if (s.yLabel !== undefined) props.yAxisLabel = String(s.yLabel);
        }
    }
    out.properties = props;
    return out;
}

module.exports = { PRESETS, expand };
