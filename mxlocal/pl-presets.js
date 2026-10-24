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
    pieChart: { id: "com.mendix.widget.web.piechart.PieChart", mpk: "Charts", doc: "a pie (or doughnut) chart: one slice per object of an entity", fields: { entity: "R Module.Entity", value: "R attribute with the slice size (a number)", caption: "R slice name, e.g. \"{Name}\"", xpath: "optional XPath constraint", hole: "optional doughnut hole radius 0-90 (default 0)" } },
    // wave 2 (W10-W12): keys from the .mpk files of the test projects (widgettype)
    webImage: { id: "com.mendix.widget.web.image.Image", mpk: "Image", doc: "the Image widget (web): a static image of an image collection or an image URL, with size, alt text and on click (classic static image: \"widget\": \"image\")", fields: { image: "optional Module.Collection.Image", url: "optional an image URL (text; {Attribute} inside a data view)", alt: "optional alternative text", width: "optional pixels (200) or \"50%\" (default auto)", height: "optional pixels or \"50%\" (default auto)", enlarge: "optional true: a click shows it enlarged", onClick: "optional an action as on actionButton", thumbnail: "optional true: show as a thumbnail" } },
    tooltip: { id: "com.mendix.widget.web.tooltip.Tooltip", mpk: "Tooltip", doc: "a tooltip around widgets (Tooltip widget): the trigger widgets and a text shown on hover / click", fields: { trigger: "R [ widgets ] the tooltip belongs to", text: "R the tooltip text ({Attribute} inside a data view)", position: "optional top | bottom | left | right (default top)", openOn: "optional hover | click | hoverFocus (default hover)" } },
    fieldset: { id: "com.mendix.widget.web.fieldset.Fieldset", mpk: "Fieldset", doc: "a fieldset with a legend around widgets (Fieldset widget; an HTML fieldset, good for screen readers)", fields: { legend: "optional legend text", widgets: "R [ widgets ] inside it" } },
    htmlElement: { id: "com.mendix.widget.web.htmlelement.HTMLElement", mpk: "HTML Element", doc: "an HTML element (HTML Element widget): a tag around widgets, or with HTML content", fields: { tag: "optional div | span | p | ul | ol | li | a | img | h1 ... h6, or another tag name (section, nav, ...) (default div)", widgets: "optional [ widgets ] inside it", html: "optional HTML content instead of widgets (sanitized by the widget)", attributes: "optional { \"aria-live\": \"polite\", \"href\": \"https://...\" } HTML attributes (text values)" } },
    timeline: { id: "com.mendix.widget.web.timeline.Timeline", mpk: "Timeline", doc: "a timeline of events (Timeline widget): one per object of an entity with a title, description and time", fields: { entity: "R Module.Entity of the events", xpath: "optional XPath constraint", title: "R title text, e.g. \"{Name}\"", description: "optional description text", time: "optional time text, e.g. \"{Date}\"", groupBy: "optional a DateTime attribute: events grouped per day" } },
    skipLink: { id: "com.mendix.widget.web.skiplink.SkipLink", mpk: "Skip link", doc: "a skip link (Skip link widget): keyboard users jump past the menu to the main content (put it in the layout)", fields: { text: "optional link text (default \"main content\")", target: "optional id of the main content element (default: the main region)" } },
    languageSelector: { id: "com.mendix.widget.web.languageselector.LanguageSelector", mpk: "Language selector", doc: "a language selector (Language selector widget): the app's languages, the user picks one; set its Data source to System.Language and Language caption to $currentObject/Description in Studio Pro (the dry run reminds you)", fields: { position: "optional bottom | top | left | right (default bottom)", openOn: "optional click | hover (default click)" } },
    richText: { id: "com.mendix.widget.custom.richtext.RichText", mpk: "Rich Text", doc: "a rich text editor (Rich Text widget) for a String attribute of the data view around it", fields: { attribute: "R String attribute (unlimited length is best)", toolbar: "optional basic | standard | full (default basic)", height: "optional pixels (default 250)" } },
    videoPlayer: { id: "com.mendix.widget.web.videoplayer.VideoPlayer", mpk: "Video Player", doc: "a video player (Video Player widget): a video URL (YouTube, Vimeo, an mp4 file)", fields: { url: "R video URL (text; {Attribute} inside a data view)", poster: "optional poster image URL", autoStart: "optional true", muted: "optional true", loop: "optional true", controls: "optional false: hide the controls" } },
    barcodeGenerator: { id: "com.mendix.widget.web.barcodegenerator.BarcodeGenerator", mpk: "Barcode Generator", doc: "a barcode or QR code of a value (Barcode Generator widget)", fields: { value: "R an expression, e.g. \"$currentObject/Code\" or \"'https://example.com'\"", format: "optional CODE128 | QRCode | DataMatrix (default CODE128)", download: "optional true: a Download button" } },
    barcodeScanner: { id: "com.mendix.widget.web.barcodescanner.BarcodeScanner", mpk: "Barcode Scanner", doc: "a barcode scanner (Barcode Scanner widget, the device camera): the result goes into a String attribute of the data view around it", fields: { attribute: "R String attribute for the scanned value", onDetect: "optional an action after a scan (as actionButton)" } },
    imageCropper: { id: "com.mendix.widget.web.imagecropper.ImageCropper", mpk: "Image Cropper", doc: "an image cropper (Image Cropper widget) for the image of the data view around it (a System.Image entity)", fields: { image: "optional Module.Collection.Image (else set the image in Studio Pro)", shape: "optional rect | circle (default rect)", aspectRatio: "optional free | square | landscape16x9 | landscape4x3 | portrait3x4 (default free)", onCrop: "optional an action after cropping" } },
    fileUploader: { id: "com.mendix.widget.web.fileuploader.FileUploader", mpk: "File uploader", doc: "a file uploader (File uploader widget; needs the FileUploader module): drop zone for files or images", fields: { mode: "optional files | images (default files)", maxFiles: "optional files per upload (default 10)", maxSize: "optional MB per file (default 25)" } },
    maps: { id: "com.mendix.widget.custom.Maps.Maps", mpk: "Maps", doc: "a map (Maps widget) with markers: fixed addresses, or one per object of an entity (an address attribute)", fields: { markers: "optional [ { \"address\": \"Rotterdam\", \"title\": \"Office\" } | { \"latitude\": \"51.9\", \"longitude\": \"4.5\" } ]", entity: "optional Module.Entity with one marker per object", address: "with entity: String attribute with the address", title: "optional with entity: String attribute shown on the marker", apiKey: "optional Google Maps API key (else OpenStreetMap)", zoom: "optional automatic | world | continent | city | street | buildings (default automatic)", height: "optional pixels (default: 75% of the width)" } },
    checkboxRadioSelection: { id: "com.mendix.widget.web.checkboxradioselection.CheckboxRadioSelection", mpk: "Checkbox Radio Selection", doc: "check boxes or radio buttons for an enumeration or Boolean attribute of the data view around it (Check box / Radio button widget)", fields: { attribute: "R enumeration attribute (a Boolean one: with \"boolean\": true)", boolean: "optional true: the attribute is a Boolean", control: "optional checkbox | radio (default radio)" } },
    selectionHelper: { id: "com.mendix.widget.web.selectionhelper.SelectionHelper", mpk: "Selection helper", doc: "a select-all check box for a gallery / Data grid 2 with selection Multi (Selection helper widget): add it to the gallery's header (addWidgets into the gallery, slot filtersPlaceholder)", fields: { caption: "optional check box caption (default none)" } },
    dropdownSort: { id: "com.mendix.widget.web.dropdownsort.DropdownSort", mpk: "Drop-down sort", doc: "a sort drop-down for a gallery (Drop-down sort widget): add it to the gallery's header (addWidgets into the gallery, slot filtersPlaceholder); the attributes to sort by", fields: { attributes: "[ \"Name\" | { \"attribute\": \"Name\", \"caption\": \"Name\" } ] of the gallery's entity (required by Drop-down sort 2.x; 1.x has none: it sorts by the gallery's sortable attributes)", emptyCaption: "optional caption without a sort" } }
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
        case "webImage": {
            if ((s.image === undefined) === (s.url === undefined)) throw new Error(`${where}: give "image" (Module.Collection.Image) or "url", one of them`);
            props = s.image !== undefined ? { datasource: "image", imageObject: String(s.image) } : { datasource: "imageUrl", imageUrl: String(s.url) };
            if (s.alt !== undefined) props.alternativeText = String(s.alt);
            for (const k of ["width", "height"]) if (s[k] !== undefined) {
                const m = /^(\d+)\s*(%|px)?$/.exec(String(s[k]).trim());
                if (!m) throw new Error(`${where}: ${k} is a number of pixels or "50%"`);
                props[`${k}Unit`] = m[2] === "%" ? "percentage" : "pixels";
                props[k] = Number(m[1]);
            }
            if (s.enlarge === true && s.onClick !== undefined) throw new Error(`${where}: give enlarge or onClick, not both`);
            if (s.enlarge === true) props.onClickType = "enlarge";
            if (s.onClick !== undefined) props.onClick = s.onClick;
            if (s.thumbnail === true) props.displayAs = "thumbnail";
            break;
        }
        case "tooltip":
            if (!Array.isArray(s.trigger) || !s.trigger.length) throw new Error(`${where}: trigger is a list of widgets [ { "widget": ... } ]`);
            props = { trigger: s.trigger, renderMethod: "text", textMessage: String(s.text) };
            if (s.position !== undefined) props.tooltipPosition = String(s.position);
            if (s.openOn !== undefined) props.openOn = String(s.openOn);
            break;
        case "fieldset":
            if (!Array.isArray(s.widgets) || !s.widgets.length) throw new Error(`${where}: widgets is a list of widgets [ { "widget": ... } ]`);
            props = { content: s.widgets, ...(s.legend !== undefined ? { legend: String(s.legend) } : {}) };
            break;
        case "htmlElement": {
            if (s.html !== undefined && s.widgets !== undefined) throw new Error(`${where}: give widgets or html, not both`);
            const tag = s.tag !== undefined ? String(s.tag).toLowerCase() : "div";
            // other tags (section, nav, ...): the custom tag
            props = /^(div|span|p|ul|ol|li|a|img|h[1-6])$/.test(tag) ? { tagName: tag } : { tagName: "__customTag__", tagNameCustom: tag };
            if (s.html !== undefined) Object.assign(props, { tagContentMode: "innerHTML", tagContentHTML: String(s.html) });
            else if (s.widgets !== undefined) props.tagContentContainer = s.widgets;
            if (s.attributes !== undefined) {
                if (!s.attributes || typeof s.attributes !== "object" || Array.isArray(s.attributes)) throw new Error(`${where}: attributes is { "name": "value" }`);
                props.attributes = Object.entries(s.attributes).map(([k, v]) => ({ attributeName: k, attributeValueType: "template", attributeValueTemplate: String(v) }));
            }
            break;
        }
        case "timeline":
            props = { data: s.xpath ? { entity: String(s.entity), xpath: String(s.xpath) } : String(s.entity), title: String(s.title), groupEvents: s.groupBy !== undefined };
            if (s.description !== undefined) props.description = String(s.description);
            if (s.time !== undefined) props.timeIndication = String(s.time);
            if (s.groupBy !== undefined) props.groupAttribute = String(s.groupBy);
            break;
        case "skipLink":
            props = { linkText: s.text !== undefined ? String(s.text) : "main content" };
            if (s.target !== undefined) props.mainContentId = String(s.target);
            break;
        case "languageSelector":
            // its data source is System.Language (caption $currentObject/Description), which the model API cannot point to
            // offline: the dry run says to set it in Studio Pro
            props = {};
            if (s.position !== undefined) props.position = String(s.position);
            if (s.openOn !== undefined) props.trigger = String(s.openOn);
            break;
        case "richText":
            props = { stringAttribute: String(s.attribute) };
            if (s.toolbar !== undefined) props.preset = String(s.toolbar);
            if (s.height !== undefined) props.height = Math.round(num(s.height, where, "height"));
            break;
        case "videoPlayer":
            props = { type: "dynamic", videoUrl: String(s.url) };
            if (s.poster !== undefined) props.posterUrl = String(s.poster);
            for (const [k, key] of [["autoStart", "autoStart"], ["muted", "muted"], ["loop", "loop"], ["controls", "showControls"]]) if (s[k] !== undefined) props[key] = !!s[k];
            break;
        case "barcodeGenerator":
            props = { codeValue: String(s.value) };
            if (s.format !== undefined) props.codeFormat = String(s.format);
            if (s.download === true) props.allowDownload = true;
            break;
        case "barcodeScanner":
            props = { datasource: String(s.attribute) };
            if (s.onDetect !== undefined) props.onDetect = s.onDetect;
            break;
        case "imageCropper":
            props = {};
            if (s.image !== undefined) props.image = String(s.image);
            if (s.shape !== undefined) props.cropShape = String(s.shape);
            if (s.aspectRatio !== undefined) props.aspectRatio = String(s.aspectRatio);
            if (s.onCrop !== undefined) props.onCropAction = s.onCrop;
            break;
        case "fileUploader":
            props = {};
            if (s.mode !== undefined) props.uploadMode = String(s.mode);
            if (s.maxFiles !== undefined) props.maxFilesPerUpload = Math.round(num(s.maxFiles, where, "maxFiles"));
            if (s.maxSize !== undefined) props.maxFileSize = Math.round(num(s.maxSize, where, "maxSize"));
            break;
        case "maps": {
            props = {};
            if (s.markers !== undefined) {
                if (!Array.isArray(s.markers)) throw new Error(`${where}: markers is [ { "address": ..., "title": ... } ]`);
                props.markers = s.markers.map((m, i) => {
                    if (!m || typeof m !== "object") throw new Error(`${where}: markers[${i + 1}] is { "address": "Rotterdam" } or { "latitude": ..., "longitude": ... }`);
                    for (const k of Object.keys(m)) if (!["address", "latitude", "longitude", "title"].includes(k)) fail(`${where}: markers[${i + 1}]: unknown field '${k}'`, k, ["address", "latitude", "longitude", "title"]);
                    const o = m.address !== undefined ? { locationType: "address", address: String(m.address) } : { locationType: "latlng", latitude: String(m.latitude), longitude: String(m.longitude) };
                    if (m.title !== undefined) o.title = String(m.title);
                    return o;
                });
            }
            if (s.entity !== undefined) {
                if (s.address === undefined) throw new Error(`${where}: with entity give "address" (a String attribute)`);
                props.dynamicMarkers = [{ markersDS: String(s.entity), locationType: "address", address: String(s.address), ...(s.title !== undefined ? { title: String(s.title) } : {}) }];
            } else if (s.address !== undefined || s.title !== undefined) throw new Error(`${where}: address / title go with "entity" (one marker per object); fixed markers: "markers"`);
            if (s.apiKey !== undefined) props.apiKey = String(s.apiKey);
            if (s.zoom !== undefined) props.zoom = String(s.zoom);
            if (s.height !== undefined) Object.assign(props, { heightUnit: "pixels", height: Math.round(num(s.height, where, "height")) });
            break;
        }
        case "checkboxRadioSelection":
            props = { source: "context", optionsSourceType: s.boolean === true ? "boolean" : "enumeration", controlType: s.control !== undefined ? String(s.control) : "radio", [s.boolean === true ? "attributeBoolean" : "attributeEnumeration"]: String(s.attribute) };
            break;
        case "selectionHelper":
            props = s.caption !== undefined ? { checkboxCaption: String(s.caption) } : {};
            break;
        case "dropdownSort": {
            // older Drop-down sort packages (1.x) have no attributes: they offer the gallery's sortable attributes
            const listed = pluggable.installed(dir).get(p.id).lines.some(l => l.startsWith("attributes "));
            if (!listed) {
                if (s.attributes !== undefined) throw new Error(`${where}: this Drop-down sort version has no attributes; it sorts by the gallery's sortable attributes (give the gallery "sort"), or update the Data Widgets module`);
                props = {};
                if (s.emptyCaption !== undefined) props.emptyOptionCaption = String(s.emptyCaption);
                break;
            }
            if (!Array.isArray(s.attributes) || !s.attributes.length) throw new Error(`${where}: attributes is [ "Name", { "attribute": "Date", "caption": "Date" } ]`);
            props = { attributes: s.attributes.map(a => (typeof a === "string" ? { attribute: a, caption: a } : { attribute: String(a.attribute), caption: String(a.caption !== undefined ? a.caption : a.attribute) })) };
            if (s.emptyCaption !== undefined) props.emptyOptionCaption = String(s.emptyCaption);
            break;
        }
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
