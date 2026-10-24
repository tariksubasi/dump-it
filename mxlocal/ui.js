"use strict";
// UI details of widgets on createPage / addWidgets / changeWidget: dynamic classes, button icons (glyph, Atlas icon
// collection, image), icon-only buttons, render type, tooltips, accessibility (screen reader text of inputs, aria role,
// tab index, alternative text of images, hidden containers), container render mode (section, header, nav, ...) and
// on click action, layout grid row / column alignment, row and column class / style / design, page class / style, the
// drop-down button kind, and the A11Y CHECK of the dry run. Stored keys follow the Studio Pro-saved samples of the
// test projects (Mendix 10.22-11.14): Appearance.DynamicClasses (string), Button.Icon (GlyphIcon Code /
// IconCollectionIcon Image / ImageIcon Image), Button.Tooltip (Text), Button.RenderType, ActionButton.AriaRole,
// Widget.TabIndex, InputWidget.ScreenReaderLabel (ClientTemplate), AttributeWidget.AriaRequired, DivContainer.RenderMode
// / OnClickAction / ScreenReaderHidden, StaticImageViewer/DynamicImageViewer.AlternativeText, LayoutGridRow
// Vertical/HorizontalAlignment + SpacingBetweenColumns, LayoutGridColumn.VerticalAlignment. Mendix stores no column
// offset or order per device, no tooltip on inputs and no aria label on buttons: those are refused with what to use.
const sdk = require("mendixmodelsdk");
const { fail, bool, enumValue, suggest } = require("./ops-util");
const GLYPHS = require("./glyphicons.json"); // Bootstrap 3 glyphicon name -> code, as Studio Pro's icon picker

const { pages, customwidgets: cw, images, customicons } = sdk;

const ICON = "optional icon: \"glyphicon-pencil\" (glyph), \"mx-icon-add\" / \"mx-icon-lined-add\" (Atlas icon collection; default filled), an icon collection icon \"Atlas_Core.Atlas_Filled.pencil\", an image \"Module.Images.Save\", a glyph code number, or \"none\"";
const COMMON_UI = {
    dynamicClass: "optional expression for extra CSS classes, e.g. \"if $currentObject/Active then 'row-active' else ''\" ($currentObject = the object of the data view / list view around it; \"\" removes it)",
    tabIndex: "optional keyboard tab order: a whole number (0 = page order, -1 = not reachable with Tab)"
};
const BUTTON_UI = {
    icon: ICON,
    iconOnly: "optional true: only the icon, no caption (give \"tooltip\" so screen readers and mouse users know what it does)",
    renderType: "optional button | link: shown as a button or as a link",
    tooltip: "optional tooltip text (the title shown on hover; texts per language allowed)"
};
const ARIA_LABEL = "optional screen reader text (aria label) of the input, e.g. when it has no visible label";
const KIND_UI = {
    actionButton: { ...BUTTON_UI, ariaRole: "optional aria role: Button | Link | Checkbox | Radio | Tab | MenuItem | Switch | ... (default Button)" },
    container: {
        renderMode: "optional HTML element: div | section | article | header | footer | main | nav | aside | hgroup | address (default div)",
        onClick: "optional on click of the container: { \"action\": ..., ... } as on actionButton (the object around it is passed)",
        screenReaderHidden: "optional true: screen readers skip the container and what is inside it"
    },
    image: { alt: "optional alternative text for screen readers (Studio Pro: Alternative text)" },
    input: { ariaLabel: ARIA_LABEL, ariaRequired: "optional true: screen readers say a value is required (aria-required)" },
    referenceSelector: { ariaLabel: ARIA_LABEL },
    referenceSetSelector: { ariaLabel: ARIA_LABEL }
};
// layout grid rows and columns: { "columns": [...], ...ROW_UI } and { "weight": 6, "widgets": [...], ...COL_UI }
const ALIGN = "none | top | center | bottom";
const ROW_UI = { class: "CSS class(es) of the row", style: "inline CSS of the row", dynamicClass: COMMON_UI.dynamicClass.replace(/^optional /, ""), design: "design properties of the row (LayoutGridRow)",
    verticalAlignment: `align the columns vertically: ${ALIGN}`, horizontalAlignment: "align the columns horizontally: none | left | center | right", spacing: "true/false: space between the columns (default true)" };
const COL_UI = { class: "CSS class(es) of the column", style: "inline CSS of the column", dynamicClass: ROW_UI.dynamicClass, design: "design properties of the column (LayoutGridColumn)",
    verticalAlignment: `align the column's content vertically: ${ALIGN}` };
const NOT_STORED = {
    offset: "Mendix stores no column offset; put an empty column (\"weight\": N) before it",
    order: "Mendix stores no column order per device; give the column a class with a CSS order rule (addCssClass, e.g. { \"order\": \"2\" }) or change the column order",
    horizontalAlignment: "a layout grid column has no horizontal alignment; give \"horizontalAlignment\" on the row, or the Atlas design property \"Align content\" where the theme has it"
};
const INPUT_TOOLTIP = "an input has no tooltip in Mendix (Studio Pro stores none); use \"ariaLabel\" (screen reader text), \"placeholder\", or a text widget next to it";
const DROPDOWN = {
    doc: "a drop-down button: a button that opens a menu of items, each with its own action",
    fields: {
        caption: "optional the button caption (needed unless iconOnly)",
        items: "R [ { \"caption\": \"Edit\", \"action\": ..., ...action fields } ] (actions as on actionButton)",
        buttonStyle: "optional Default | Primary | Success | Info | Warning | Danger | Inverse",
        ...BUTTON_UI
    }
};
const PAGE_UI = { class: "optional CSS class(es) of the page", style: "optional inline CSS of the page" };
// changeWidget / changePage fields
const CHANGE_UI = {
    dynamicClass: "expression for extra CSS classes (\"\" = none); $currentObject is the object around the widget",
    tabIndex: "a whole number (0 = page order, -1 = not reachable with Tab)",
    icon: "button / drop-down button / grid button icon: \"glyphicon-pencil\", \"mx-icon-add\", \"Atlas_Core.Atlas_Filled.pencil\", \"Module.Images.Save\" or \"none\"",
    iconOnly: "button: true = no caption, only the icon (false needs \"caption\")",
    renderType: "button: button | link", tooltip: "button / grid button tooltip (\"\" = none); inputs have none",
    ariaLabel: "input: screen reader text (\"\" = none)", ariaRequired: "input: true/false (aria-required)", ariaRole: "button: Button | Link | ...",
    renderMode: "container: div | section | article | header | footer | main | nav | aside | hgroup | address",
    screenReaderHidden: "container: true/false", alt: "image: alternative text",
    verticalAlignment: "layout grid row or column (widget \"layoutGrid1/row 1\" or \"layoutGrid1/row 1/column 2\"): none | top | center | bottom",
    horizontalAlignment: "layout grid row: none | left | center | right", spacing: "layout grid row: true/false space between columns",
    weight: "layout grid column: 1-12 or auto", tablet: "layout grid column: tablet weight", phone: "layout grid column: phone weight"
};
const ALIGNMENTS = { none: "None", start: "Start", top: "Start", left: "Start", center: "Center", middle: "Center", end: "End", bottom: "End", right: "End" };

const has = (o, k) => {
    try {
        return o[k] !== undefined;
    } catch (e) {
        return false; // not in this Mendix version
    }
};
const kindName = el => el.structureTypeName.split("$")[1].replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const isInput = el => el instanceof pages.InputWidget || (el instanceof cw.CustomWidget && el.type && el.type.objectType && el.type.objectType.propertyTypes.some(pt => pt.key === "Editability"));

function makeUi(h, getI) {
    const { model, client } = h;
    const I = () => getI();
    const version = client.project.version;

    // ------------------------------------------------ Studio Pro samples in this project (once per run)
    let facts = null;
    function sampled() {
        if (facts) return facts;
        facts = new Set();
        const walk = o => {
            if (Array.isArray(o)) return o.forEach(walk);
            if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
            const t = o.$Type;
            if (t === "Forms$Appearance" && o.DynamicClasses) facts.add("dynamicClass");
            if (t === "Forms$DivContainer" && o.OnClickAction && o.OnClickAction.$Type !== "Forms$NoAction") facts.add("divOnClick");
            if (t === "Forms$DivContainer" && o.RenderMode && o.RenderMode !== "Div") facts.add("render:" + o.RenderMode);
            if (t === "Forms$DivContainer" && o.ScreenReaderHidden) facts.add("srHidden");
            if (o.ScreenReaderLabel) facts.add("srLabel");
            if (o.AriaRequired === true) facts.add("ariaRequired");
            if (t === "Forms$LayoutGridRow" && o.HorizontalAlignment && o.HorizontalAlignment !== "None") facts.add("rowH");
            if (t === "Forms$DesignPropertyValue" && o.Value && o.Value.$Type === "Forms$CompoundDesignPropertyValue" && (o.Value.Properties || []).some(p => p.Value && p.Value.$Type === "Forms$ToggleDesignPropertyValue")) facts.add("multiDesign");
            if (t === "Forms$DropDownButton") facts.add("dropDownButton");
            for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
        };
        for (const id of client.project.units.keys()) {
            const info = client.unitInfo(id);
            if (/^Forms\$(Page|Snippet|Layout|BuildingBlock|PageTemplate)$/.test(info.type)) walk(client.project.read(id));
        }
        return facts;
    }
    const warned = new Set();
    const firstUse = (fact, what, where) => {
        if (sampled().has(fact) || warned.has(fact)) return;
        warned.add(fact);
        client.warn(`${what} first use in this project (no Studio Pro-saved sample in this project: SDK layout): check it in Studio Pro (${where.split(": ")[0]})`);
    };

    // ------------------------------------------------ icons

    let iconColls = null;
    async function collections() {
        if (iconColls) return iconColls;
        iconColls = [];
        const list = customicons && model.allCustomIconCollections ? model.allCustomIconCollections() : [];
        for (const c of list) iconColls.push(c.isLoaded ? c : await c.load());
        return iconColls;
    }

    // An Icon element (GlyphIcon / IconCollectionIcon / ImageIcon) for v, or null for "none"; { make, text }.
    async function iconOf(v, where) {
        if (v === null || v === false || v === "" || /^none$/i.test(String(v))) return { make: () => null, text: "no icon" };
        const s = String(v).trim();
        const glyph = code => ({ make: () => Object.assign(pages.GlyphIcon.create(model), { code }), text: `icon glyph ${Object.keys(GLYPHS).find(k => GLYPHS[k] === code) || code}` });
        if (typeof v === "number" || /^\d+$/.test(s)) return glyph(Number(s));
        const g = /^(?:glyphicon\s+)?glyphicon-([a-z0-9-]+)$/i.exec(s);
        if (g) {
            const code = GLYPHS[g[1].toLowerCase()];
            if (!code) fail(`${where}: no glyph icon 'glyphicon-${g[1]}'`, `glyphicon-${g[1]}`, Object.keys(GLYPHS).map(k => "glyphicon-" + k));
            return glyph(code);
        }
        const fromCollection = (coll, icon) => ({ make: () => Object.assign(pages.IconCollectionIcon.create(model), { image: icon }), text: `icon ${coll.qualifiedName}.${icon.name}` });
        const parts = s.split(".");
        if (parts.length === 3) {
            const qn = parts.slice(0, 2).join(".");
            const coll = model.allImageCollections().find(c => c.qualifiedName === qn) || (await collections()).find(c => c.qualifiedName === qn);
            if (!coll) fail(`${where}: no icon or image collection '${qn}'`, qn, [...model.allImageCollections(), ...(await collections())].map(c => c.qualifiedName));
            if (customicons && coll instanceof customicons.CustomIconCollection) {
                const icon = coll.icons.find(x => x.name === parts[2]) || fail(`${where}: icon collection ${qn} has no icon '${parts[2]}'`, parts[2], coll.icons.map(x => x.name));
                return fromCollection(coll, icon);
            }
            const full = coll.isLoaded ? coll : await coll.load();
            const img = full.images.find(x => x.name === parts[2]) || fail(`${where}: image collection ${qn} has no image '${parts[2]}'`, parts[2], full.images.map(x => x.name));
            return { make: () => Object.assign(pages.ImageIcon.create(model), { image: img }), text: `icon image ${s}` };
        }
        // mx-icon-<name> (filled, as Studio Pro's templates), mx-icon-lined-<name>, mx-icon-filled-<name>, or a bare Atlas name
        const m = /^(?:mx-icon-(?:(lined|filled)-)?)?([a-z0-9-]+)$/i.exec(s);
        const colls = (await collections()).filter(c => c.prefix === "mx-icon" || /^mx-icon/.test(c.collectionClass || ""));
        if (m && colls.length) {
            const want = (m[1] || "filled").toLowerCase();
            const order = [...colls].sort((a, b) => Number(new RegExp(want).test(b.collectionClass)) - Number(new RegExp(want).test(a.collectionClass)));
            for (const c of order) {
                const icon = c.icons.find(x => x.name === m[2].toLowerCase());
                if (icon) return fromCollection(c, icon);
            }
        }
        const names = [...new Set([...colls.flatMap(c => c.icons.map(x => "mx-icon-" + x.name)), ...Object.keys(GLYPHS).map(k => "glyphicon-" + k)])];
        return fail(`${where}: icon '${s}' is not known${colls.length ? "" : " (this project has no Atlas icon collection: use glyphicon-... or an image)"} (use glyphicon-<name>, mx-icon-<name>, Module.Collection.Icon or Module.Images.Image)`, /^mx-icon|glyphicon/.test(s) ? s : "mx-icon-" + s, names);
    }

    // ------------------------------------------------ field setters (shared by createPage and changeWidget)

    async function setDynamicClass(el, v, dc, where) {
        if (!has(el, "appearance") || !has(el.appearance, "dynamicClasses")) throw new Error(`${where}: a ${kindName(el)} has no dynamic classes in Mendix ${version}`);
        const e = String(v).trim();
        if (e) I().exprCheck(e, dc, where);
        if (el.appearance.dynamicClasses !== e) el.appearance.dynamicClasses = e;
        if (e) firstUse("dynamicClass", "Forms$Appearance.DynamicClasses (dynamic classes)", where);
        return e ? `dynamic class ${e}` : "no dynamic class";
    }

    function setTabIndex(el, v, where) {
        if (!has(el, "tabIndex")) throw new Error(`${where}: a ${kindName(el)} has no tab index`);
        const n = Number(v);
        if (!Number.isInteger(n) || n < -1 || n > 32767) throw new Error(`${where}: tabIndex '${v}' must be a whole number from -1 to 32767 (0 = page order, -1 = skipped by Tab)`);
        if (el.tabIndex !== n) el.tabIndex = n;
        return `tab index ${n}`;
    }

    async function setTooltip(el, v, ctx, where) {
        if (!has(el, "tooltip")) {
            if (isInput(el)) throw new Error(`${where}: ${INPUT_TOOLTIP}`);
            throw new Error(`${where}: a ${kindName(el)} has no tooltip (buttons, drop-down buttons and grid buttons have one)`);
        }
        await I().textAll(el.tooltip, v === null ? "" : v, ctx);
        return v ? `tooltip "${typeof v === "object" ? Object.values(v)[0] : v}"` : "no tooltip";
    }

    async function setIcon(el, v, where) {
        if (!has(el, "icon")) throw new Error(`${where}: a ${kindName(el)} has no icon (buttons, drop-down buttons and grid buttons have one)`);
        const ic = await iconOf(v, where);
        el.icon = ic.make();
        return ic.text;
    }

    const captionOf = el => (el.caption instanceof pages.ClientTemplate ? el.caption.template : el.caption);
    async function captionEmpty(el) {
        const t = captionOf(el);
        return !t || t.translations.every(x => !x.text);
    }
    async function setIconOnly(el, v, ctx, where, caption) {
        if (!has(el, "icon") || !has(el, "caption")) throw new Error(`${where}: iconOnly is for a button with an icon`);
        if (bool(v, false)) {
            if (!el.icon) throw new Error(`${where}: iconOnly needs an icon: give "icon" (e.g. "glyphicon-pencil" or "mx-icon-add")`);
            const t = captionOf(el);
            for (const x of t.translations) if (x.text) x.text = "";
            if (!t.translations.length) await I().textAll(t, "", ctx);
            return "icon only";
        }
        if ((await captionEmpty(el)) && caption === undefined) throw new Error(`${where}: iconOnly false needs a "caption"`);
        return "";
    }

    function setRenderType(el, v, where) {
        if (!has(el, "renderType")) throw new Error(`${where}: a ${kindName(el)} has no render type (buttons have one)`);
        const m = enumValue(pages.RenderType, String(v), `renderType (${where})`);
        if (el.renderType !== m) el.renderType = m;
        return `shown as ${m.name.toLowerCase()}`;
    }

    function setAriaRole(el, v, where) {
        if (!has(el, "ariaRole")) throw new Error(`${where}: a ${kindName(el)} has no aria role in Mendix ${version} (action buttons have one)`);
        const m = enumValue(pages.ButtonAriaRoleType, String(v), `ariaRole (${where})`);
        if (el.ariaRole !== m) el.ariaRole = m;
        return `aria role ${m.name}`;
    }

    async function setAriaLabel(el, v, ctx, where) {
        if (!has(el, "screenReaderLabel")) {
            if (el instanceof pages.Button) throw new Error(`${where}: a button has no aria label in Mendix ${version}; screen readers read its caption; an icon-only button: give "tooltip"`);
            if (el instanceof pages.StaticImageViewer || el instanceof pages.DynamicImageViewer) throw new Error(`${where}: for an image use "alt" (alternative text)`);
            if (el instanceof pages.DivContainer) throw new Error(`${where}: a container has no aria label; "screenReaderHidden": true hides it from screen readers, "renderMode" gives it a meaning (nav, main, ...)`);
            throw new Error(`${where}: a ${kindName(el)} has no screen reader text in Mendix ${version} (inputs have one: "ariaLabel")`);
        }
        if (v === "" || v === null) {
            if (el.screenReaderLabel) el.screenReaderLabel = null;
            return "no screen reader text";
        }
        await I().templateAll(el, "screenReaderLabel", v, ctx, where);
        firstUse("srLabel", "InputWidget.ScreenReaderLabel (screen reader text)", where);
        return `screen reader text "${typeof v === "object" ? Object.values(v)[0] : v}"`;
    }

    function setAriaRequired(el, v, where) {
        if (!has(el, "ariaRequired")) throw new Error(`${where}: a ${kindName(el)} has no aria-required setting (text boxes, text areas, date pickers, drop-downs, ... have one)`);
        const b = bool(v, true);
        if (el.ariaRequired !== b) el.ariaRequired = b;
        if (b) firstUse("ariaRequired", "AttributeWidget.AriaRequired", where);
        return b ? "aria-required" : "not aria-required";
    }

    function setRenderMode(el, v, where) {
        if (!(el instanceof pages.DivContainer)) throw new Error(`${where}: renderMode is for a container (a text takes "style"/"textStyle" H1-H6, a group box "headerMode")`);
        const m = enumValue(pages.ContainerRenderMode, String(v), `renderMode (${where})`);
        if (el.renderMode !== m) el.renderMode = m;
        if (m.name !== "Div") firstUse("render:" + m.name, `Forms$DivContainer.RenderMode ${m.name}`, where);
        return `renders as <${m.name.toLowerCase()}>`;
    }

    function setScreenReaderHidden(el, v, where) {
        if (!has(el, "screenReaderHidden")) throw new Error(`${where}: screenReaderHidden is for a container`);
        const b = bool(v, true);
        if (el.screenReaderHidden !== b) el.screenReaderHidden = b;
        if (b) firstUse("srHidden", "Forms$DivContainer.ScreenReaderHidden", where);
        return b ? "hidden from screen readers" : "read by screen readers";
    }

    async function setContainerClick(el, v, at, ctx, where) {
        if (!(el instanceof pages.DivContainer) || !has(el, "onClickAction")) throw new Error(`${where}: onClick here is for a container`);
        if (v === null || v === "" || /^none$/i.test(String(v))) {
            el.onClickAction = pages.NoClientAction.create(model);
            return "no on click";
        }
        const t = await I().makeAction(v, at, ctx, where, a => (el.onClickAction = a));
        firstUse("divOnClick", "Forms$DivContainer.OnClickAction (a container with an on click action)", where);
        return `on click ${t}`;
    }

    async function setAlt(el, v, ctx, where) {
        if (!has(el, "alternativeText")) throw new Error(`${where}: alt (alternative text) is for an image`);
        await I().templateAll(el, "alternativeText", v === null ? "" : v, ctx, where);
        return v ? `alt "${typeof v === "object" ? Object.values(v)[0] : v}"` : "no alt text";
    }

    // ------------------------------------------------ createPage / addWidgets: the fields of a built widget

    const FIELDS = ["dynamicClass", "tabIndex", "icon", "iconOnly", "renderType", "tooltip", "ariaRole", "ariaLabel", "ariaRequired", "renderMode", "screenReaderHidden", "alt"];
    async function apply(node, el, ctx) {
        const s = node.spec || {}, out = [], where = node.where, dc = node.container || null;
        if (s.dynamicClass !== undefined) out.push(await setDynamicClass(el, s.dynamicClass, dc, `${where}: dynamicClass`));
        if (s.tabIndex !== undefined) out.push(setTabIndex(el, s.tabIndex, `${where}: tabIndex`));
        if (node.kind === "dropDownButton") return out; // its own builder took the button fields
        if (s.icon !== undefined) out.push(await setIcon(el, s.icon, `${where}: icon`));
        if (s.iconOnly !== undefined) out.push(await setIconOnly(el, s.iconOnly, ctx, `${where}: iconOnly`, s.caption));
        if (s.renderType !== undefined) out.push(setRenderType(el, s.renderType, `${where}: renderType`));
        if (s.tooltip !== undefined) out.push(await setTooltip(el, s.tooltip, ctx, `${where}: tooltip`));
        if (s.ariaRole !== undefined) out.push(setAriaRole(el, s.ariaRole, `${where}: ariaRole`));
        if (s.ariaLabel !== undefined) out.push(await setAriaLabel(el, s.ariaLabel, ctx, `${where}: ariaLabel`));
        if (s.ariaRequired !== undefined) out.push(setAriaRequired(el, s.ariaRequired, `${where}: ariaRequired`));
        if (s.renderMode !== undefined) out.push(setRenderMode(el, s.renderMode, `${where}: renderMode`));
        if (s.screenReaderHidden !== undefined) out.push(setScreenReaderHidden(el, s.screenReaderHidden, `${where}: screenReaderHidden`));
        if (s.onClick !== undefined && node.kind === "container") out.push(await setContainerClick(el, s.onClick, { container: dc, name: el.name }, ctx, `${where}: onClick`));
        if (s.alt !== undefined) out.push(await setAlt(el, s.alt, ctx, `${where}: alt`));
        return out.filter(Boolean);
    }

    // ------------------------------------------------ layout grid rows and columns

    const align = (v, where, row) => {
        const k = String(v).toLowerCase();
        const hit = ALIGNMENTS[k];
        if (!hit) fail(`${where}: '${v}' is not an alignment (${row ? "none | left | center | right" : ALIGN})`, k, Object.keys(ALIGNMENTS));
        return pages.LayoutGridAlignment[hit];
    };
    function checkKeys(spec, allowed, where, what) {
        for (const k of Object.keys(spec)) {
            if (allowed.includes(k)) continue;
            if (what === "column" && NOT_STORED[k]) throw new Error(`${where}: ${k}: ${NOT_STORED[k]}`);
            if (what === "column" && /^(tablet|phone|desktop)(Offset|Order)$|^offset|^order/i.test(k)) throw new Error(`${where}: ${k}: ${NOT_STORED[/offset/i.test(k) ? "offset" : "order"]}`);
            fail(`${where}: unknown field '${k}' of a layout grid ${what}`, k, allowed);
        }
    }
    const ROW_KEYS = ["columns", ...Object.keys(ROW_UI), "visible"];
    const COL_KEYS = ["weight", "tablet", "phone", "widgets", ...Object.keys(COL_UI)];

    // class, style, dynamicClass, design of a row or column (el has an appearance)
    async function look(el, s, dc, where, out) {
        if (s.class !== undefined && el.appearance.class !== String(s.class)) el.appearance.class = String(s.class);
        if (s.class) out.push(`class "${s.class}"`);
        if (s.style !== undefined && el.appearance.style !== String(s.style)) el.appearance.style = String(s.style);
        if (s.style) out.push(`style "${s.style}"`);
        if (s.dynamicClass !== undefined) out.push(await setDynamicClass(el, s.dynamicClass, dc, `${where}: dynamicClass`));
        if (s.design !== undefined) {
            const design = require("./design");
            out.push(`design ${design.apply(sdk, model, el, design.resolve(client.project.dir, el, s.design, `${where}: design`), client.warn) || "unchanged"}`);
        }
    }
    async function row(el, s, dc, where) {
        const out = [];
        if (!s) return out;
        await look(el, s, dc, where, out);
        if (s.verticalAlignment !== undefined) {
            el.verticalAlignment = align(s.verticalAlignment, `${where}: verticalAlignment`);
            out.push(`vertical ${el.verticalAlignment.name}`);
        }
        if (s.horizontalAlignment !== undefined) {
            el.horizontalAlignment = align(s.horizontalAlignment, `${where}: horizontalAlignment`, true);
            if (el.horizontalAlignment.name !== "None") firstUse("rowH", "Forms$LayoutGridRow.HorizontalAlignment", where);
            out.push(`horizontal ${el.horizontalAlignment.name}`);
        }
        if (s.spacing !== undefined) {
            const b = bool(s.spacing, true);
            if (el.spacingBetweenColumns !== b) el.spacingBetweenColumns = b;
            out.push(b ? "spacing between columns" : "no spacing between columns");
        }
        if (s.visible !== undefined && s.visible !== true && s.visible !== "true") {
            if (s.visible === false || s.visible === "false") throw new Error(`${where}: "visible": false hides the row for everyone; leave the row out, or give a condition`);
            const c = await I().condition(s.visible, dc, `${where}: visible`, "visible");
            el.conditionalVisibilitySettings = pages.ConditionalVisibilitySettings.create(model);
            I().fill(el.conditionalVisibilitySettings, c);
            out.push(c.text);
        } else if (s.visible === true || s.visible === "true") {
            if (el.conditionalVisibilitySettings) el.conditionalVisibilitySettings = null;
        }
        return out;
    }
    const weight = (v, where) => {
        if (/^auto$/i.test(String(v))) return -1;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error(`${where}: weight '${v}' must be 1-12 or "auto"`);
        return n;
    };
    async function column(el, s, dc, where) {
        const out = [];
        if (!s) return out;
        await look(el, s, dc, where, out);
        if (s.verticalAlignment !== undefined) {
            el.verticalAlignment = align(s.verticalAlignment, `${where}: verticalAlignment`);
            out.push(`vertical ${el.verticalAlignment.name}`);
        }
        return out;
    }

    // changeWidget on "layoutGrid1/row 1" or "layoutGrid1/row 1/column 2": { el, kind: "row" | "column" } or null
    function gridPart(P, name, where) {
        const m = /^([A-Za-z_]\w*)\s*\/\s*row\s*(\d+)(?:\s*\/\s*col(?:umn)?\s*(\d+))?$/i.exec(String(name).trim());
        if (!m) return null;
        const g = P.byName.get(m[1]);
        if (!g || !(g.el instanceof pages.LayoutGrid)) fail(`${where}: no layout grid '${m[1]}' on ${P.qn}`, m[1], P.nodes.filter(n => n.el instanceof pages.LayoutGrid).map(n => n.name));
        const r = g.el.rows[Number(m[2]) - 1];
        if (!r) throw new Error(`${where}: ${m[1]} has ${g.el.rows.length} row(s), no row ${m[2]}`);
        if (m[3] === undefined) return { el: r, kind: "row", grid: g, label: `${m[1]}/row ${m[2]}` };
        const c = r.columns[Number(m[3]) - 1];
        if (!c) throw new Error(`${where}: ${m[1]} row ${m[2]} has ${r.columns.length} column(s), no column ${m[3]}`);
        return { el: c, kind: "column", grid: g, label: `${m[1]}/row ${m[2]}/column ${m[3]}` };
    }
    const PART_CHANGE = { row: ["class", "style", "dynamicClass", "design", "verticalAlignment", "horizontalAlignment", "spacing", "visible"], column: ["class", "style", "dynamicClass", "design", "verticalAlignment", "weight", "tablet", "phone"] };
    async function changePart(part, o, dc, where) {
        const given = Object.keys(o).filter(k => !["op", "page", "widget"].includes(k));
        for (const k of given) if (!PART_CHANGE[part.kind].includes(k)) {
            if (part.kind === "column" && NOT_STORED[k]) throw new Error(`${where}: ${k}: ${NOT_STORED[k]}`);
            fail(`${where}: a layout grid ${part.kind} takes ${PART_CHANGE[part.kind].join(", ")}; not '${k}'`, k, PART_CHANGE[part.kind]);
        }
        if (!given.length) throw new Error(`${where}: give what to change: ${PART_CHANGE[part.kind].join(", ")}`);
        const spec = Object.fromEntries(given.map(k => [k, o[k]]));
        const out = part.kind === "row" ? await row(part.el, spec, dc, where) : await column(part.el, spec, dc, where);
        if (part.kind === "column") for (const [k, p] of [["weight", "weight"], ["tablet", "tabletWeight"], ["phone", "phoneWeight"]]) {
            if (spec[k] === undefined) continue;
            const n = weight(spec[k], `${where}: ${k}`);
            if (part.el[p] !== n) part.el[p] = n;
            out.push(`${k} ${n === -1 ? "auto" : n}`);
        }
        return `${part.label}: ${out.join(", ") || "unchanged"}`;
    }

    // ------------------------------------------------ changeWidget fields (one widget)

    async function change(f, el, v, { dc, ctx, where, caption, at }) {
        switch (f) {
            case "dynamicClass": return setDynamicClass(el, v, dc, where);
            case "tabIndex": return setTabIndex(el, v, where);
            case "icon": return setIcon(el, v, where);
            case "iconOnly": return setIconOnly(el, v, ctx, where, caption);
            case "renderType": return setRenderType(el, v, where);
            case "tooltip": return setTooltip(el, v, ctx, where);
            case "ariaRole": return setAriaRole(el, v, where);
            case "ariaLabel": return setAriaLabel(el, v, ctx, where);
            case "ariaRequired": return setAriaRequired(el, v, where);
            case "renderMode": return setRenderMode(el, v, where);
            case "screenReaderHidden": return setScreenReaderHidden(el, v, where);
            case "alt": return setAlt(el, v, ctx, where);
            case "onClick": return setContainerClick(el, v, at, ctx, where);
            default:
                if (["verticalAlignment", "horizontalAlignment", "spacing", "weight", "tablet", "phone"].includes(f)) throw new Error(`${where}: ${f} is for a layout grid row or column: "widget": "<grid>/row 1" or "<grid>/row 1/column 2"`);
                throw new Error(`${where}: unknown field ${f}`);
        }
    }

    // ------------------------------------------------ page class / style

    function pageLook(page, o, where) {
        const out = [];
        for (const k of ["class", "style"]) {
            if (o[k] === undefined) continue;
            if (page.appearance[k] !== String(o[k])) page.appearance[k] = String(o[k]);
            out.push(o[k] ? `page ${k} "${o[k]}"` : `no page ${k}`);
        }
        return out.join(", ");
    }

    // ------------------------------------------------ drop-down button (kind dropDownButton)

    async function dropDownButton(node, target, ctx) {
        const s = node.spec;
        if (!pages.DropDownButton) throw new Error(`${node.where}: Mendix ${version} has no drop-down button`);
        // mx check of Studio Pro 10.24 and 11.12 cannot load Forms$DropDownButton (unknown type) and no project has a sample
        // of the stored name: refused in every version
        throw new Error(`${node.where}: a drop-down button is not written: Studio Pro 10.24 / 11.12 cannot load the type this tool would store; use a pop-up menu: { "widget": "popupMenu", ... } (Pop-up menu widget from the Marketplace), or action buttons in a container`);
        const items = Array.isArray(s.items) ? s.items : null;
        if (!items || !items.length) throw new Error(`${node.where}: items is a list [ { "caption": "Edit", "action": "showPage", "page": "Module.Page" }, ... ]`);
        if ((s.caption === undefined || s.caption === "") && !bool(s.iconOnly, false)) throw new Error(`${node.where}: a drop-down button needs "caption" (or "icon" with "iconOnly": true)`);
        const b = pages.DropDownButton.create(model);
        target.push(b);
        b.name = node.name || ctx.names.next("dropDownButton");
        if (s.buttonStyle !== undefined) b.buttonStyle = enumValue(pages.ButtonStyle, String(s.buttonStyle), `buttonStyle (${node.where})`);
        await I().templateAll(b, "caption", s.caption === undefined ? "" : s.caption, ctx, node.where);
        const bits = [];
        for (const [i, it] of items.entries()) {
            const w = `${node.where} item ${i + 1}`;
            if (!it || typeof it !== "object" || Array.isArray(it) || it.caption === undefined) throw new Error(`${w}: an item is { "caption": "Edit", "action": ..., ... }`);
            const x = pages.DropDownButtonItem.create(model);
            b.items.push(x);
            await I().textAll(x.caption, it.caption, ctx);
            const { caption, ...spec } = it;
            const t = await I().makeAction(spec, node, ctx, w, a => (x.action = a));
            bits.push(`"${caption}": ${t}`);
        }
        const extra = [];
        if (s.icon !== undefined) extra.push(await setIcon(b, s.icon, `${node.where}: icon`));
        if (s.iconOnly !== undefined) extra.push(await setIconOnly(b, s.iconOnly, ctx, `${node.where}: iconOnly`, s.caption));
        if (s.renderType !== undefined) extra.push(setRenderType(b, s.renderType, `${node.where}: renderType`));
        if (s.tooltip !== undefined) extra.push(await setTooltip(b, s.tooltip, ctx, `${node.where}: tooltip`));
        firstUse("dropDownButton", "Forms$DropDownButton", node.where);
        return `${b.name} (drop-down "${s.caption}"${extra.length ? `, ${extra.filter(Boolean).join(", ")}` : ""}: ${bits.join("; ")})`;
    }

    return { apply, change, changePart, gridPart, row, column, iconOf, pageLook, dropDownButton, checkKeys, ROW_KEYS, COL_KEYS, FIELDS };
}

// ------------------------------------------------------------------------------------------------ A11Y CHECK
// Accessibility lint over the pages, snippets and layouts a change created or changed (plain units, only widgets that
// are new or changed): a button without caption and tooltip, an image without alternative text, an input without
// label and screen reader text, heading levels that skip one (H1 then H3). Warnings: nothing is refused.
const INPUT_TYPES = /^Forms\$(TextBox|TextArea|DatePicker|CheckBox|RadioButtonGroup|DropDown|ReferenceSelector|ReferenceSetSelector|InputReferenceSetSelector)$/;
const words = t => (t && Array.isArray(t.Items) ? t.Items.map(i => i.Text || "").join("").trim() : "");
const tplWords = c => (c && c.Template ? words(c.Template) : "");

function a11yLint(client) {
    const ch = client.changes;
    if (!ch) return [];
    const { toPlain } = require("./convert");
    const bson = require("./bson");
    const out = [];
    const ids = [...new Set([...ch.updated, ...ch.created.keys()])].filter(id => !ch.deleted.has(id));
    for (const id of ids) {
        let u;
        try {
            u = client.project.read(id);
        } catch (e) {
            continue;
        }
        if (!/^Forms\$(Page|Snippet|Layout)$/.test(u.$Type)) continue;
        const old = new Map();
        if (!ch.created.has(id)) {
            try {
                const walk = o => {
                    if (Array.isArray(o)) return o.forEach(walk);
                    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
                    if (o.$ID && o.$Type) old.set(o.$ID, JSON.stringify(o));
                    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
                };
                walk(toPlain(bson.decode(client.project.readBytes(id))));
            } catch (e) {
                /* a new unit */
            }
        }
        const name = `${client.label(id)}`;
        const fresh = o => !old.has(o.$ID) || old.get(o.$ID) !== JSON.stringify(o);
        const headings = [];
        const walk = o => {
            if (Array.isArray(o)) return o.forEach(walk);
            if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
            const t = o.$Type || "";
            const at = `${name} ${o.Name || ""}`.trim();
            if (/^Forms\$(ActionButton|DropDownButton|LinkButton)$/.test(t) && fresh(o) && !tplWords(o.CaptionTemplate || o.Caption) && !words(o.Tooltip)) out.push(`${at}: the button has no caption and no tooltip, so screen readers announce nothing; give "caption", or "tooltip" with "iconOnly"`);
            if (/^Forms\$(Static|Dynamic)ImageViewer$/.test(t) && fresh(o) && !tplWords(o.AlternativeText)) out.push(`${at}: the image has no alternative text; give "alt" (or "alt": "" is not possible: a decorative image goes in a container with "screenReaderHidden": true)`);
            if (INPUT_TYPES.test(t) && fresh(o) && !tplWords(o.LabelTemplate) && !tplWords(o.ScreenReaderLabel)) out.push(`${at}: the input has no label and no screen reader text; give "label" or "ariaLabel"`);
            if (t === "Forms$DynamicText" && /^H[1-6]$/.test(o.RenderMode || "")) headings.push({ level: Number(o.RenderMode[1]), name: o.Name, fresh: fresh(o) });
            for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
        };
        walk(u.FormCall || u.LayoutCall || u.Widgets || u.Content || u);
        let prev = 0;
        for (const hd of headings) {
            if (hd.fresh && prev && hd.level > prev + 1) out.push(`${name} ${hd.name}: heading H${hd.level} follows H${prev}; screen reader users miss a level (use H${prev + 1})`);
            prev = hd.level;
        }
    }
    return [...new Set(out)];
}

module.exports = { makeUi, a11yLint, COMMON_UI, KIND_UI, ROW_UI, COL_UI, PAGE_UI, CHANGE_UI, DROPDOWN, NOT_STORED, INPUT_TOOLTIP, GLYPHS, suggest };
