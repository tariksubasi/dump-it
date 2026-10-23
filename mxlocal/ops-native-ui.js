"use strict";
// Native mobile pages (G20 / N1, N4, N15): which widget kinds and button actions a native page takes, and what to use
// instead of a web-only one. createPage ("native": true) and addWidgets on a native page check their widget nodes
// here; makeAction (ops-pages.js) checks the action of every button / on click / menu item on a native page, and that
// showPage does not mix native and web pages. A native page is one whose layout is a native layout (theme-native.js
// isNativeDoc); the widgets are the same Forms$ types as on web pages (Studio Pro stores them the same way), React
// Native renders them.
const { isNativeDoc } = require("./theme-native");

// widget kinds of createPage / addWidgets that native pages have (core widgets; pluggable: a native .mpk)
const NATIVE_KINDS = ["text", "container", "actionButton", "dataView", "listView", "input", "textBox", "textArea", "checkBox", "datePicker", "radioButtons", "dropDown",
    "referenceSelector", "image", "tabContainer", "layoutGrid", "snippetCall", "pluggable"];
// web-only kinds -> what a native page uses instead
const INSTEAD = {
    dataGrid: "use a listView (one item per object; a list view item can open a page) — native pages have no data grids",
    templateGrid: "use a listView with the item widgets — native pages have no template grids",
    gallery: "use a listView (\"widgets\" per item); for columns give the list view a native style class with flexDirection: \"row\" and flexWrap: \"wrap\"",
    comboBox: "use \"dropDown\" (an enumeration or Boolean attribute) or \"referenceSelector\" (an association)",
    referenceSetSelector: "native pages have no reference set selector: list the associated objects in a listView and add / remove them with nanoflow buttons",
    fileManager: "native pages have no file manager: take or pick a picture with the NativeMobileResources JavaScript actions (TakePicture) in a nanoflow, and show it with an image",
    imageUploader: "native pages have no image uploader: use the NativeMobileResources TakePicture / TakePictureAdvanced JavaScript action in a nanoflow, then an image of the object",
    groupBox: "use a container (with a heading text), or the native Group box pluggable widget (com.mendix.widget.native.groupbox.GroupBox) when it is in widgets/",
    dropDownButton: "use the native Pop-up menu or Bottom sheet pluggable widget (widgets/*.mpk), or several buttons"
};
// button actions on native pages
const ACTION_NOTES = {
    callWorkflow: "native pages cannot start a workflow: call a microflow (online) that starts it",
    openTask: "native pages cannot open a workflow task page",
    openWorkflow: "native pages cannot open a workflow page"
};

// throws when a node of a native page is a web-only kind (with what to use instead)
function checkNativeNodes(nodes) {
    for (const n of nodes) {
        if (NATIVE_KINDS.includes(n.kind)) continue;
        const hint = INSTEAD[n.kind];
        throw new Error(`${n.where}: a native page has no ${n.kind}${hint ? `; ${hint}` : ` (native pages take ${NATIVE_KINDS.join(", ")})`}`);
    }
}

// Is the page with qualified name qn native? (saved unit: its layout's content; a page of this change: the SDK)
function isNativePageQn(client, model, qn) {
    const p = model.allPages().find(x => x.qualifiedName === qn);
    if (!p) return null;
    if (p.isLoaded) return isNativeDoc(client, p);
    if (!client.project.units.has(p.id)) return null;
    const u = client.project.read(p.id);
    const form = u.FormCall && u.FormCall.Form;
    const l = form && model.allLayouts().find(x => x.qualifiedName === form);
    if (!l || !client.project.units.has(l.id)) return false;
    const lu = client.project.read(l.id);
    return !!(lu.Content && lu.Content.$Type === "Forms$NativeLayoutContent");
}

// The button / on click / menu action on a page: refusals for native pages, the native / web mix of showPage, and the
// warning for microflows (they need a connection)
function checkAction(client, model, page, action, spec, where) {
    if (!page) return;
    const native = isNativeDoc(client, page);
    if (native && ACTION_NOTES[action]) throw new Error(`${where}: ${ACTION_NOTES[action]}`);
    if (action === "showPage" && spec && spec.page) {
        const target = isNativePageQn(client, model, String(spec.page));
        if (target === true && !native) throw new Error(`${where}: ${spec.page} is a native page; a web page cannot open it (open a web page, or put the button on a native page)`);
        if (target === false && native) throw new Error(`${where}: ${spec.page} is a web page; a native page opens only native pages (createPage "native": true)`);
    }
    if (native && action === "callMicroflow") client.warn(`${where}: a microflow on a native page runs on the server: it fails without a connection; prefer a nanoflow (callNanoflow), and call the microflow from the nanoflow only where the app is online`);
}

// A detached icon for a bottom bar item: a glyph code, Module.IconCollection.icon or Module.ImageCollection.image
// (as menu items take them). { icon, text }
async function iconOf(h, model, v, where) {
    const { pages, images, customicons } = require("mendixmodelsdk");
    const { fail } = require("./ops-util");
    if (typeof v === "number" || /^\d+$/.test(String(v))) {
        const g = pages.GlyphIcon.create(model);
        g.code = Number(v);
        return { icon: g, text: `glyph ${v}` };
    }
    const parts = String(v).split(".");
    if (parts.length !== 3) throw new Error(`${where}: icon '${v}' must be Module.Collection.Icon (icon collection or image collection) or a glyph code number`);
    const coll = await h.get(parts.slice(0, 2).join("."));
    if (customicons && coll instanceof customicons.CustomIconCollection) {
        const icon = coll.icons.find(x => x.name === parts[2]) || fail(`${where}: icon collection ${coll.qualifiedName} has no icon '${parts[2]}'`, parts[2], coll.icons.map(x => x.name));
        const ic = pages.IconCollectionIcon.create(model);
        ic.image = icon;
        return { icon: ic, text: `icon ${v}` };
    }
    if (coll instanceof images.ImageCollection) {
        const img = coll.images.find(x => x.name === parts[2]) || fail(`${where}: image collection ${coll.qualifiedName} has no image '${parts[2]}'`, parts[2], coll.images.map(x => x.name));
        const ic = pages.ImageIcon.create(model);
        ic.image = img;
        return { icon: ic, text: `image ${v}` };
    }
    throw new Error(`${where}: '${parts.slice(0, 2).join(".")}' is neither an icon collection nor an image collection`);
}

module.exports = { iconOf, NATIVE_KINDS, INSTEAD, checkNativeNodes, checkAction, isNativePageQn };
