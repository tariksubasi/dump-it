"use strict";
// Pluggable widgets: the definitions in the project's widgets/*.mpk and the type every instance embeds. An instance
// whose type differs from the installed .mpk makes Studio Pro ask to update the widget (CE0463), so a widget is only
// copied from an instance of the same project whose type matches its .mpk exactly.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Files of a zip archive (stored or deflated): name -> () => Buffer.
function unzip(file) {
    const b = fs.readFileSync(file);
    let e = b.length - 22;
    while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
    if (e < 0) throw new Error(`${path.basename(file)} is not a zip file`);
    const out = new Map();
    for (let i = 0, p = b.readUInt32LE(e + 16); i < b.readUInt16LE(e + 10) && b.readUInt32LE(p) === 0x02014b50; i++) {
        const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), off = b.readUInt32LE(p + 42);
        const name = b.toString("utf8", p + 46, p + 46 + nl);
        const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
        const data = b.subarray(start, start + size);
        out.set(name, () => (method === 8 ? zlib.inflateRawSync(data) : data));
        p += 46 + nl + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
    }
    return out;
}

const ENT = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) => (c[0] === "#" ? String.fromCodePoint(c[1] === "x" || c[1] === "X" ? parseInt(c.slice(2), 16) : Number(c.slice(1))) : ENT[c] || m));

// Small XML reader for widget definitions: { tag, attrs, children, text }.
function parseXml(s) {
    const root = { tag: "#root", attrs: {}, children: [], text: "" };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    for (let m; (m = re.exec(s));) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) top.text += m[1];
        else if (m[6] !== undefined) top.text += decode(m[6]);
        else if (m[3]) {
            const tag = m[3].split(":").pop();
            if (m[2]) {
                if (stack.length > 1) stack.pop();
                continue;
            }
            const attrs = {};
            for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].split(":").pop()] = decode(a[2] !== undefined ? a[2] : a[3]);
            const el = { tag, attrs, children: [], text: "" };
            top.children.push(el);
            if (!m[5]) stack.push(el);
        }
    }
    return root;
}

const kid = (el, tag) => el.children.find(c => c.tag === tag);
const kids = (el, tag) => el.children.filter(c => c.tag === tag);
const txt = el => (el ? el.text.trim() : "");

// One line per property (nested object properties under "parent/"), from the .mpk XML ...
function xmlLines(props, prefix = "", group = []) {
    const out = [];
    for (const c of props.children) {
        if (c.tag === "propertyGroup") out.push(...xmlLines(c, prefix, [...group, c.attrs.caption || ""]));
        else if (c.tag === "systemProperty") out.push(`${prefix}${c.attrs.key} system [${group.join("::")}]`);
        else if (c.tag === "property") {
            const a = c.attrs;
            const list = (t, item, k) => (kid(c, t) ? kids(kid(c, t), item).map(x => x.attrs[k] + (k === "key" ? "=" + txt(x) : "")) : []);
            const rt = kid(c, "returnType");
            const tr = kid(c, "translations") ? kids(kid(c, "translations"), "translation").map(x => `${x.attrs.lang}=${txt(x)}`) : [];
            out.push(`${prefix}${a.key} ${String(a.type).toLowerCase()} list=${a.isList === "true"} required=${a.required !== "false"} default=${a.defaultValue || ""}` +
                ` [${kid(c, "category") ? txt(kid(c, "category")) : group.join("::")}] "${txt(kid(c, "caption"))}" enum=${list("enumerationValues", "enumerationValue", "key")} sel=${list("selectionTypes", "selectionType", "name")}` +
                ` attr=${list("attributeTypes", "attributeType", "name")} ret=${rt ? (rt.attrs.type || "None") + (rt.attrs.isList === "true" ? "[]" : "") : ""} ds=${a.dataSource || ""} tr=${tr}`);
            if (a.type === "object" && kid(c, "properties")) out.push(...xmlLines(kid(c, "properties"), `${prefix}${a.key}/`));
        }
    }
    return out;
}

// ... and from the type a widget instance embeds (storage JSON).
function typeLines(objectType, prefix = "") {
    const out = [];
    for (const pt of objectType.PropertyTypes || []) {
        const v = pt.ValueType;
        if (v.Type === "System") {
            out.push(`${prefix}${pt.PropertyKey} system [${pt.Category}]`);
            continue;
        }
        const rt = v.ReturnType;
        out.push(`${prefix}${pt.PropertyKey} ${String(v.Type).toLowerCase()} list=${v.IsList} required=${v.Required} default=${v.DefaultValue}` +
            ` [${pt.Category}] "${pt.Caption}" enum=${(v.EnumerationValues || []).map(x => x._Key + "=" + x.Caption)} sel=${v.SelectionTypes || []}` +
            ` attr=${v.AllowedTypes || []} ret=${rt ? rt.Type + (rt.IsList ? "[]" : "") : ""} ds=${v.DataSourceProperty || ""} tr=${(v.Translations || []).map(x => `${x.LanguageCode}=${x.Text}`)}`);
        if (v.ObjectType) out.push(...typeLines(v.ObjectType, `${prefix}${pt.PropertyKey}/`));
    }
    return out;
}

// widgetId -> { file, version, lines } for every widget in <project>/widgets/*.mpk (cached per folder).
const cache = new Map();
function installed(dir) {
    if (cache.has(dir)) return cache.get(dir);
    const out = new Map();
    const wd = path.join(dir, "widgets");
    for (const f of fs.existsSync(wd) ? fs.readdirSync(wd).filter(x => x.endsWith(".mpk")) : []) {
        try {
            const z = unzip(path.join(wd, f));
            const pkg = parseXml(z.get("package.xml")().toString("utf8"));
            const cm = pkg.children[0] && kid(pkg.children[0], "clientModule");
            for (const wf of cm && kid(cm, "widgetFiles") ? kids(kid(cm, "widgetFiles"), "widgetFile") : []) {
                const read = z.get(wf.attrs.path);
                if (!read) continue;
                const w = parseXml(read().toString("utf8")).children.find(c => c.tag === "widget");
                if (w && w.attrs.id) out.set(w.attrs.id, { file: f, version: cm.attrs.version || "", lines: xmlLines(kid(w, "properties") || { children: [] }) });
            }
        } catch (e) {
            // an unreadable .mpk only means its widgets cannot be copied
        }
    }
    cache.set(dir, out);
    return out;
}

// Differences between an embedded type (storage JSON) and the installed definition; [] = in sync.
function typeDiff(type, def) {
    const have = typeLines(type.ObjectType || {}), want = def.lines;
    const a = new Set(have), b = new Set(want);
    return [...want.filter(l => !a.has(l)).map(l => "mpk: " + l), ...have.filter(l => !b.has(l)).map(l => "instance: " + l)];
}

const walk = (o, fn) => {
    if (Array.isArray(o)) return o.forEach(x => walk(x, fn));
    if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
    if (o.$Type) fn(o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, fn);
};

// Instances of widgetId on the project's pages and snippets whose type matches the installed .mpk:
// { exemplars: [{ unitId, unitName, id, name }], def, reason } (reason says why there is none).
function exemplars(project, widgetId) {
    const def = installed(project.dir).get(widgetId);
    const found = [], stale = [];
    for (const id of project.units.keys()) {
        const u = project.read(id);
        if (u.$Type !== "Forms$Page" && u.$Type !== "Forms$Snippet") continue;
        walk(u, o => {
            if (o.$Type !== "CustomWidgets$CustomWidget" || !o.Type || o.Type.WidgetId !== widgetId) return;
            const x = { unitId: id, unitName: u.Name, id: o.$ID, name: o.Name };
            if (def && !typeDiff(o.Type, def).length) found.push(x);
            else stale.push(x);
        });
    }
    let reason = "";
    if (!def) reason = `widgets/ has no .mpk for ${widgetId}`;
    else if (!found.length && stale.length) reason = `the project's ${stale.length} instance(s) do not match widgets/${def.file} (${def.version}); in Studio Pro run App > Update all widgets`;
    else if (!found.length) reason = "no page or snippet of the project uses it (add one in Studio Pro to copy from)";
    return { exemplars: found, stale: stale.length, def, reason };
}

module.exports = { unzip, parseXml, installed, typeDiff, exemplars, typeLines };

// ------------------------------------------------------------------------------------------------ generic builder
// What Studio Pro stores when a pluggable widget is dropped on a page, built from its widgets/*.mpk definition:
// the CustomWidgets$CustomWidgetType (every property type of the XML, with its group path as Category) and a
// CustomWidgets$WidgetObject with every (non-system) property at its default. Storage JSON (as in the .mpr).
const { randomUUID } = require("crypto");
const VALUE_TYPES = { action: "Action", association: "Association", attribute: "Attribute", boolean: "Boolean", datasource: "DataSource", decimal: "Decimal", entity: "Entity",
    entityconstraint: "EntityConstraint", enumeration: "Enumeration", expression: "Expression", file: "File", form: "Form", icon: "Icon", image: "Image", integer: "Integer",
    microflow: "Microflow", nanoflow: "Nanoflow", object: "Object", selection: "Selection", string: "String", texttemplate: "TextTemplate", translatablestring: "TranslatableString", widgets: "Widgets" };
const cap1 = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

function valueTypeJson(p, xmlType) {
    const a = p ? p.attrs : {};
    const names = (t, item) => (p && kid(p, t) ? kids(kid(p, t), item).map(x => x.attrs.name) : []);
    const rt = p && kid(p, "returnType");
    const props = p && kid(p, "properties");
    return {
        $ID: randomUUID(), $Type: "CustomWidgets$WidgetValueType",
        ActionVariables: p && kid(p, "actionVariables") ? kids(kid(p, "actionVariables"), "actionVariable").map(v => ({ $ID: randomUUID(), $Type: "CustomWidgets$WidgetActionVariable", Caption: v.attrs.caption || "", Key: v.attrs.key, Type: v.attrs.type })) : [],
        AllowedTypes: names("attributeTypes", "attributeType"),
        AllowNonPersistableEntities: a.allowNonPersistableEntities === "true",
        AllowUpload: a.allowUpload === "true",
        AssociationTypes: names("associationTypes", "associationType"),
        DataSourceProperty: a.dataSource || "",
        DefaultType: a.defaultType || "None",
        DefaultValue: a.defaultValue !== undefined ? a.defaultValue : "",
        EntityProperty: a.entityProperty || "",
        EnumerationValues: p && kid(p, "enumerationValues") ? kids(kid(p, "enumerationValues"), "enumerationValue").map(v => ({ $ID: randomUUID(), $Type: "CustomWidgets$WidgetEnumerationValue", _Key: v.attrs.key, Caption: txt(v) })) : [],
        IsLinked: a.isLinked === "true",
        IsList: a.isList === "true",
        IsMetaData: a.isMetaData === "true",
        IsPath: cap1(a.isPath || "no"),
        Multiline: a.multiline === "true",
        ObjectType: props ? { $ID: randomUUID(), $Type: "CustomWidgets$WidgetObjectType", PropertyTypes: propertyTypesJson(props, []) } : null,
        OnChangeProperty: a.onChange || "",
        ParameterIsList: a.parameterIsList === "true",
        PathType: cap1(a.pathType || "none"),
        Required: p ? a.required !== "false" : false,
        ReturnType: rt ? { $ID: randomUUID(), $Type: "CustomWidgets$WidgetReturnType", AssignableTo: rt.attrs.assignableTo || "", EntityProperty: rt.attrs.entityProperty || "", IsList: rt.attrs.isList === "true", Type: rt.attrs.type || "None" } : null,
        SelectableObjectsProperty: a.selectableObjects || "",
        SelectionTypes: names("selectionTypes", "selectionType"),
        SetLabel: a.setLabel === "true",
        Translations: p && kid(p, "translations") ? kids(kid(p, "translations"), "translation").map(t => ({ $ID: randomUUID(), $Type: "CustomWidgets$WidgetTranslation", LanguageCode: t.attrs.lang, Text: txt(t) })) : [],
        Type: xmlType
    };
}

function propertyTypesJson(props, group) {
    const out = [];
    for (const c of props.children) {
        if (c.tag === "propertyGroup") out.push(...propertyTypesJson(c, [...group, c.attrs.caption || ""]));
        else if (c.tag === "systemProperty" || c.tag === "property") {
            const sys = c.tag === "systemProperty";
            const t = sys ? "System" : VALUE_TYPES[String(c.attrs.type).toLowerCase()];
            if (!t) throw new Error(`property ${c.attrs.key}: unknown type '${c.attrs.type}'`);
            out.push({
                $ID: randomUUID(), $Type: "CustomWidgets$WidgetPropertyType",
                Caption: sys ? `<system:${c.attrs.key}>` : txt(kid(c, "caption")),
                Category: kid(c, "category") ? txt(kid(c, "category")) : group.join("::"),
                Description: sys || !kid(c, "description") ? "" : kid(c, "description").text, // not trimmed, as Studio Pro
                IsDefault: false,
                PropertyKey: c.attrs.key,
                ValueType: valueTypeJson(sys ? null : c, t)
            });
        }
    }
    return out;
}

// Keeps only the keys keys(storageType) lists (what this Mendix version stores; null = all).
function onlyKeys(o, keys) {
    if (Array.isArray(o)) return o.forEach(x => onlyKeys(x, keys));
    if (!o || typeof o !== "object") return;
    const ks = o.$Type && keys(o.$Type);
    if (ks && ks.length) for (const k of Object.keys(o)) if (k[0] !== "$" && !ks.includes(k)) delete o[k];
    for (const v of Object.values(o)) if (v && typeof v === "object") onlyKeys(v, keys);
}

// <widget> element -> CustomWidgets$CustomWidgetType (storage JSON, fresh ids); keys: see onlyKeys.
function typeJson(w, keys) {
    const t = typeJsonAll(w);
    if (keys) onlyKeys(t, keys);
    return t;
}
function typeJsonAll(w) {
    const a = w.attrs;
    return {
        $ID: randomUUID(), $Type: "CustomWidgets$CustomWidgetType",
        HelpUrl: txt(kid(w, "helpUrl")),
        ObjectType: { $ID: randomUUID(), $Type: "CustomWidgets$WidgetObjectType", PropertyTypes: propertyTypesJson(kid(w, "properties") || { children: [] }, []) },
        OfflineCapable: a.offlineCapable === "true",
        StudioCategory: txt(kid(w, "studioCategory")),
        StudioProCategory: txt(kid(w, "studioProCategory")),
        SupportedPlatform: a.supportedPlatform || "Web",
        WidgetDescription: txt(kid(w, "description")),
        WidgetId: a.id,
        WidgetName: txt(kid(w, "name")),
        WidgetNeedsEntityContext: a.needsEntityContext === "true",
        WidgetPluginWidget: a.pluginWidget === "true"
    };
}

// widgetId -> <widget> element of the installed .mpk (or null).
function widgetXml(dir, widgetId) {
    const def = installed(dir).get(widgetId);
    if (!def) return null;
    const z = unzip(path.join(dir, "widgets", def.file));
    const pkg = parseXml(z.get("package.xml")().toString("utf8"));
    const cm = kid(pkg.children[0], "clientModule");
    for (const wf of kids(kid(cm, "widgetFiles"), "widgetFile")) {
        const read = z.get(wf.attrs.path);
        const w = read && parseXml(read().toString("utf8")).children.find(c => c.tag === "widget");
        if (w && w.attrs.id === widgetId) return w;
    }
    return null;
}

const PRIMITIVES = ["Boolean", "Integer", "Decimal", "String", "Enumeration"];
const text = items => ({ $ID: randomUUID(), $Type: "Texts$Text", Items: items.map(([c, t]) => ({ $ID: randomUUID(), $Type: "Texts$Translation", LanguageCode: c, Text: t })) });
const clientTemplate = items => ({ $ID: randomUUID(), $Type: "Forms$ClientTemplate", Fallback: text([]), Parameters: [], Template: text(items) });

// The value of one property as Studio Pro writes it when the widget is dropped: the type's default (texts: the
// widget's own translations in the project's languages), no references, a No action; a non-list object gets one
// object with its defaults.
function valueJson(vt, langs) {
    const t = vt.Type;
    const sels = vt.SelectionTypes || [];
    return {
        $ID: randomUUID(), $Type: "CustomWidgets$WidgetValue",
        Action: { $ID: randomUUID(), $Type: "Forms$NoAction", DisabledDuringExecution: true },
        AttributeRef: null, DataSource: null, EntityRef: null,
        Expression: t === "Expression" ? vt.DefaultValue : "",
        Form: "", Icon: null, Image: "", Microflow: "", Nanoflow: "",
        Objects: t === "Object" && !vt.IsList && vt.ObjectType ? [objectJson(vt.ObjectType, langs)] : [],
        PrimitiveValue: PRIMITIVES.includes(t) ? vt.DefaultValue : "",
        Selection: sels.length && !sels.includes("None") ? sels[0] : "None",
        SourceVariable: null,
        TextTemplate: t === "TextTemplate" ? clientTemplate((vt.Translations || []).filter(x => langs.includes(x.LanguageCode)).map(x => [x.LanguageCode, x.Text])) : null,
        TranslatableValue: t === "TranslatableString" ? text((vt.Translations || []).filter(x => langs.includes(x.LanguageCode)).map(x => [x.LanguageCode, x.Text])) : null,
        TypePointer: vt.$ID,
        Widgets: [],
        XPathConstraint: ""
    };
}

// A CustomWidgets$WidgetObject of objectType (storage JSON) with every non-system property at its default.
function objectJson(objectType, langs) {
    return {
        $ID: randomUUID(), $Type: "CustomWidgets$WidgetObject",
        Properties: objectType.PropertyTypes.filter(pt => pt.ValueType.Type !== "System").map(pt => ({ $ID: randomUUID(), $Type: "CustomWidgets$WidgetProperty", TypePointer: pt.$ID, Value: valueJson(pt.ValueType, langs) })),
        TypePointer: objectType.$ID
    };
}

// A whole CustomWidgets$CustomWidget as dropped from the toolbox (storage JSON): langs = project languages, default
// first; keys: see onlyKeys. The label (system property Label) is the widget's name, as in Studio Pro.
function widgetJson(w, name, langs, keys) {
    const type = typeJson(w, keys);
    const sys = type.ObjectType.PropertyTypes.filter(pt => pt.ValueType.Type === "System").map(pt => pt.PropertyKey);
    const out = {
        $ID: randomUUID(), $Type: "CustomWidgets$CustomWidget",
        Appearance: { $ID: randomUUID(), $Type: "Forms$Appearance", Class: "", DesignProperties: [], DynamicClasses: "", Style: "" },
        ConditionalEditabilitySettings: null, ConditionalVisibilitySettings: null,
        Editable: "Always",
        LabelTemplate: sys.includes("Label") ? clientTemplate([[langs[0], type.WidgetName]]) : null,
        Name: name,
        Object: objectJson(type.ObjectType, langs),
        TabIndex: 0,
        Type: type
    };
    if (keys) onlyKeys(out, keys);
    return out;
}

// Short name -> widget ids of the installed .mpk files: "Datagrid", "Data grid 2", "datagrid", the full id.
function findWidget(dir, name) {
    const all = [...installed(dir).keys()];
    const low = String(name).toLowerCase().replace(/[\s_-]/g, "");
    const hit = all.filter(id => id.toLowerCase() === String(name).toLowerCase() || id.split(".").pop().toLowerCase() === low);
    if (hit.length) return { id: hit[0], all };
    for (const id of all) {
        const w = widgetXml(dir, id);
        if (w && txt(kid(w, "name")).toLowerCase().replace(/[\s_-]/g, "") === low) return { id, all };
    }
    return { id: null, all };
}

module.exports.typeJson = typeJson;
module.exports.objectJson = objectJson;
module.exports.widgetJson = widgetJson;
module.exports.findWidget = findWidget;
module.exports.onlyKeys = onlyKeys;
module.exports.widgetXml = widgetXml;
