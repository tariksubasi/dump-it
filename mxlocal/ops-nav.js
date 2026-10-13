"use strict";
// Navigation: menu items of navigation profiles and menu documents (add with a microflow or icon, change, move,
// delete), menu documents, the menu a menu widget shows, and new web navigation profiles. Stored as Studio Pro does:
// a menu item is Menus$MenuItem { Caption, Icon, Action (Forms$FormAction | Forms$MicroflowAction | Forms$NoAction),
// Items }; a menu document is Menus$MenuDocument { ItemCollection }; a menu widget has a Forms$MenuDocumentSource or
// Forms$NavigationSource.
const sdk = require("mendixmodelsdk");
const { pages, menus, navigation, microflows: mf, projects, customicons, images } = sdk;
const { fail, validName, enumValue, bool } = require("./ops-util");

const WHERE = {
    profile: "optional navigation profile: Responsive, Tablet, Phone or its name (default Responsive)",
    menu: "optional Module.Menu: a menu document instead of a navigation profile"
};
const ITEM = "R the menu item: its caption (any language), a path \"Parent/Child\", or the page or microflow it opens";
const ICON = "optional icon: an icon collection icon \"Atlas_Core.Atlas_Filled.home\", an image \"Module.Images.Logo\", a glyph code number (57377), or \"none\"";
const MAX_DEPTH = 3; // Studio Pro: menus have at most three levels

const NAV_OPS = {
    changeMenuItem: {
        doc: "Change a menu item of a navigation profile or menu document: caption (per language), what it opens, icon, who may open its page.",
        fields: {
            item: ITEM, ...WHERE,
            caption: "optional new caption (text, or { \"en_US\": ..., \"nl_NL\": ... } per language)",
            page: "optional Module.Page (without parameters) to open instead", microflow: "optional Module.Microflow (without parameters) to run instead",
            action: "optional \"none\": the item opens nothing (a parent of sub-items)",
            icon: ICON,
            roles: "optional [ \"Module.Role\" ]: module roles that may open the item's page or microflow (menu items have no roles of their own; added with grantAccess)"
        }
    },
    moveMenuItem: {
        doc: "Move a menu item (with its sub-items) within a menu: under another item, to the top level, or before/after a sibling (re-order).",
        fields: {
            item: ITEM, ...WHERE,
            parent: "optional new parent menu item (caption or path); \"\" = top level (default: stays under its parent)",
            after: "optional caption of the sibling to put it after", before: "optional caption of the sibling to put it before",
            position: "optional first | last"
        }
    },
    deleteMenuItem: { doc: "Delete a menu item (and its sub-items) from a navigation profile or menu document.", fields: { item: ITEM, ...WHERE } },
    createMenu: {
        doc: "Create a menu document (for a menu bar or navigation tree widget, see useMenu).",
        fields: {
            module: "R module name", name: "R menu name, e.g. Admin_Menu", folder: "optional folder path",
            items: "optional [ { \"caption\": ..., \"page\" or \"microflow\": ..., \"icon\": ..., \"items\": [ sub-items ] } ]"
        }
    },
    useMenu: {
        doc: "Make a menu widget (menu bar, navigation tree, simple menu bar) of a layout, page or snippet show a menu document or a navigation profile.",
        fields: {
            document: "R Module.Layout, Module.Page or Module.Snippet with the menu widget",
            widget: "optional name of the menu widget (default: the only one)",
            menu: "Module.Menu to show (or use profile)", profile: "navigation profile to show, e.g. Responsive (or use menu)"
        }
    },
    createNavigationProfile: {
        doc: "Add a web navigation profile for a device type the project does not have yet (as Studio Pro: App > Navigation > Add navigation profile).",
        fields: {
            kind: "R Responsive | Tablet | Phone | ResponsiveOffline | TabletOffline | PhoneOffline",
            homePage: "optional Module.Page or Module.Microflow without parameters (default: the Responsive profile's home page)",
            copyMenu: "optional true/false: copy the Responsive profile's menu items (default false)"
        }
    }
};

// Extra fields of addMenuItem handled here (ops-pages.js does the classic page-in-a-profile case).
const MENU_EXTRA = {
    page: "Module.Page without parameters (or use microflow)",
    microflow: "optional Module.Microflow without parameters to run instead of a page",
    menu: WHERE.menu,
    icon: ICON,
    after: "optional caption of a sibling to put it after (default: at the end)", before: "optional caption of a sibling to put it before"
};
const extendedMenuItem = o => o.page === undefined || ["menu", "microflow", "icon", "after", "before"].some(k => o[k] !== undefined);

function makeNav(h, pi) {
    const { model, client } = h;
    const captionOf = t => (t && t.translations.length ? t.translations[0].text : "");
    const humanize = s => s.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

    async function navDoc(where) {
        const doc = model.allNavigationDocuments()[0];
        if (!doc) throw new Error(`${where}: the project has no navigation document`);
        return doc.load();
    }

    async function profileNamed(name, where) {
        const nav = await navDoc(where);
        const want = String(name || "Responsive");
        const label = p => `${p.name} (${p.kind ? p.kind.name : "native"})`;
        const hit = nav.profiles.find(p => p.name.toLowerCase() === want.toLowerCase()) ||
            nav.profiles.find(p => p.kind && String(p.kind.name).toLowerCase() === want.toLowerCase());
        if (!hit) fail(`${where}: no navigation profile '${want}' (profiles: ${nav.profiles.map(label).join(", ")}; add one with createNavigationProfile)`, want, nav.profiles.map(p => p.name));
        if (!(hit instanceof navigation.NavigationProfile)) throw new Error(`${where}: '${hit.name}' is a native profile; its menu is not supported here (use Studio Pro)`);
        return hit;
    }

    // The menu an op works on: { label, items (MenuItemCollection.items), profile | doc }
    async function menuOf(o, where) {
        if (o.menu !== undefined && o.profile !== undefined) throw new Error(`${where}: give 'menu' (a menu document) or 'profile', not both`);
        if (o.menu !== undefined) {
            const d = await h.get(String(o.menu));
            if (!(d instanceof menus.MenuDocument)) {
                const docs = model.allMenuDocuments().map(x => x.qualifiedName);
                fail(`${where}: '${o.menu}' is not a menu document (menus: ${docs.join(", ") || "none"})`, o.menu, docs);
            }
            return { label: `menu ${d.qualifiedName}`, items: d.itemCollection.items, doc: d };
        }
        const p = await profileNamed(o.profile, where);
        return { label: `${p.name} menu`, items: p.menuItemCollection.items, profile: p };
    }

    // Every item with its list, depth and caption path.
    function flatten(items, out = [], depth = 0, prefix = "") {
        for (const it of items) {
            const path = prefix ? `${prefix}/${captionOf(it.caption)}` : captionOf(it.caption);
            out.push({ item: it, list: items, depth, path });
            flatten(it.items, out, depth + 1, path);
        }
        return out;
    }
    const height = it => 1 + Math.max(0, ...it.items.map(height));

    function targetOf(it) {
        const a = it.action;
        if (a instanceof pages.PageClientAction && a.pageSettings) return a.pageSettings.pageQualifiedName;
        if (a instanceof pages.MicroflowClientAction && a.microflowSettings) return a.microflowSettings.microflowQualifiedName;
        return null;
    }

    function findItem(m, spec, where, field = "item") {
        if (spec === undefined || spec === null || String(spec).trim() === "") throw new Error(`${where}: '${field}' is empty`);
        const s = String(spec).trim().toLowerCase();
        const all = flatten(m.items);
        const norm = p => p.toLowerCase().replace(/\s*(\/|>)\s*/g, "/");
        let hits = all.filter(x => norm(x.path) === norm(s));
        if (!hits.length) hits = all.filter(x => x.item.caption.translations.some(t => t.text.toLowerCase() === s));
        if (!hits.length) hits = all.filter(x => (targetOf(x.item) || "").toLowerCase() === s);
        if (!hits.length) fail(`${where}: no menu item '${spec}' in the ${m.label} (items: ${all.map(x => x.path).join(", ") || "none"})`, spec, all.map(x => x.path));
        if (hits.length > 1) throw new Error(`${where}: '${spec}' matches ${hits.length} menu items of the ${m.label}: ${hits.map(x => `"${x.path}"`).join(", ")}; give the path`);
        return hits[0];
    }

    async function target(o, where) {
        if (o.page !== undefined && o.microflow !== undefined) throw new Error(`${where}: give 'page' or 'microflow', not both`);
        if (o.page !== undefined) {
            const p = await h.get(String(o.page));
            if (!(p instanceof pages.Page)) throw new Error(`${where}: '${o.page}' is not a page`);
            if (p.parameters.length) throw new Error(`${where}: ${p.qualifiedName} has a page parameter (${p.parameters.map(x => x.name).join(", ")}); a menu item can only open a page without parameters`);
            return { page: p, qn: p.qualifiedName, name: captionOf(p.title) || humanize(p.name) };
        }
        if (o.microflow !== undefined) {
            const f = await h.get(String(o.microflow));
            if (!(f instanceof mf.Microflow)) throw new Error(`${where}: '${o.microflow}' is not a microflow (nanoflows: use a page button)`);
            if (f.objectCollection.objects.some(x => x instanceof mf.MicroflowParameterObject)) throw new Error(`${where}: ${f.qualifiedName} has parameters; a menu item can only run a microflow without parameters`);
            return { flow: f, qn: f.qualifiedName, name: humanize(f.name.replace(/^(ACT|SUB|DS|OCh|IVK)_/, "")) };
        }
        return null;
    }

    function setAction(it, t) {
        let a;
        if (!t) a = pages.NoClientAction.createInMenuItemUnderAction(it);
        else if (t.page) {
            a = pages.PageClientAction.createInMenuItemUnderAction(it);
            a.pageSettings.page = t.page;
        } else {
            a = pages.MicroflowClientAction.createInMenuItemUnderAction(it);
            a.microflowSettings.microflow = t.flow;
        }
        a.disabledDuringExecution = false; // what Studio Pro writes for menu items
    }

    async function setIcon(it, v, where) {
        if (v === null || /^none$/i.test(String(v)) || v === "") {
            it.icon = null;
            return "no icon";
        }
        if (typeof v === "number" || /^\d+$/.test(String(v))) {
            const g = pages.GlyphIcon.createInMenuItemUnderIcon(it);
            g.code = Number(v);
            return `glyph ${v}`;
        }
        const parts = String(v).split(".");
        if (parts.length !== 3) throw new Error(`${where}: icon '${v}' must be Module.Collection.Icon (icon collection or image collection), a glyph code number or "none"`);
        const coll = await h.get(parts.slice(0, 2).join("."));
        if (customicons && coll instanceof customicons.CustomIconCollection) {
            const icon = coll.icons.find(x => x.name === parts[2]);
            if (!icon) fail(`${where}: icon collection ${coll.qualifiedName} has no icon '${parts[2]}'`, parts[2], coll.icons.map(x => x.name));
            const ic = pages.IconCollectionIcon.createInMenuItemUnderIcon(it);
            ic.image = icon;
            return `icon ${v}`;
        }
        if (coll instanceof images.ImageCollection) {
            const img = coll.images.find(x => x.name === parts[2]);
            if (!img) fail(`${where}: image collection ${coll.qualifiedName} has no image '${parts[2]}'`, parts[2], coll.images.map(x => x.name));
            const ic = pages.ImageIcon.createInMenuItemUnderIcon(it);
            ic.image = img;
            return `image ${v}`;
        }
        throw new Error(`${where}: '${parts.slice(0, 2).join(".")}' is neither an icon collection nor an image collection`);
    }

    // Who sees an item: the user roles with a module role that may open its target.
    async function seenBy(t) {
        if (!t) return "";
        const allowed = t.page ? t.page.allowedRolesQualifiedNames : t.flow.allowedModuleRolesQualifiedNames;
        const s = model.allProjectSecurities()[0];
        const sec = s && (await s.load());
        if (!sec) return "";
        const off = sec.securityLevel === sdk.security.SecurityLevel.CheckNothing;
        const seen = sec.userRoles.filter(u => u.moduleRolesQualifiedNames.some(r => allowed.includes(r))).map(u => u.name);
        if (!seen.length && !off) client.warn(`${t.qn} allows no module role that a user role has, so its menu item is hidden for every user (grantAccess, or changeMenuItem roles)`);
        return off ? " (seen by everyone while app security is off)" : ` (seen by: ${seen.join(", ") || "nobody"})`;
    }

    async function languageNote(where, value, oldText) {
        const ls = await pi.languages();
        const tr = h.translationsOf && h.translationsOf(value);
        if (ls.length > 1 && !(tr && ls.slice(1).every(c => c in tr)) && oldText !== value) client.warn(`${where}: the caption changed in ${ls[0]} only; the other languages (${ls.slice(1).join(", ")}) keep their text (give the caption per language, or setTranslations)`);
    }

    // Index in list for after/before/position (default: the end).
    function slot(list, o, where, self) {
        const set = ["after", "before", "position"].filter(k => o[k] !== undefined);
        if (set.length > 1) throw new Error(`${where}: give only one of after, before, position`);
        const sibs = list.filter(x => x !== self);
        if (o.position !== undefined) {
            if (/^first$/i.test(o.position)) return 0;
            if (/^last$/i.test(o.position)) return sibs.length;
            throw new Error(`${where}: position is first or last`);
        }
        const key = o.after !== undefined ? "after" : o.before !== undefined ? "before" : null;
        if (!key) return sibs.length;
        const want = String(o[key]).toLowerCase();
        const i = sibs.findIndex(x => x.caption.translations.some(t => t.text.toLowerCase() === want) || (targetOf(x) || "").toLowerCase() === want);
        if (i < 0) fail(`${where}: no sibling '${o[key]}' at that level (siblings: ${sibs.map(x => captionOf(x.caption)).join(", ") || "none"})`, o[key], sibs.map(x => captionOf(x.caption)));
        return key === "after" ? i + 1 : i;
    }

    // Insert item into list at index (index counts the list without item).
    function place(list, item, index) {
        list.splice(index, 0, item);
    }

    async function newItem(spec, list, index, where) {
        if (!spec || typeof spec !== "object") throw new Error(`${where}: a menu item is { "caption": ..., "page" or "microflow": ..., "icon": ..., "items": [...] }`);
        for (const k of Object.keys(spec)) if (!["caption", "page", "microflow", "icon", "items"].includes(k)) fail(`${where}: unknown menu item field '${k}'`, k, ["caption", "page", "microflow", "icon", "items"]);
        const t = await target(spec, where);
        if (spec.caption === undefined && !t) throw new Error(`${where}: a menu item needs a caption, or a page or microflow`);
        const it = menus.MenuItem.create(model);
        place(list, it, index === undefined ? list.length : index);
        const caption = spec.caption !== undefined ? String(spec.caption) : t.name;
        await h.text(it.caption, caption);
        setAction(it, t);
        const bits = [];
        if (spec.icon !== undefined) bits.push(await setIcon(it, spec.icon, where));
        for (const [i, sub] of (spec.items || []).entries()) await newItem(sub, it.items, undefined, `${where}.items[${i + 1}]`);
        return { it, t, caption, bits };
    }

    // ------------------------------------------------ operations

    // addMenuItem with menu / microflow / icon / after / before
    async function addMenuItem(o) {
        const where = `addMenuItem ${o.page || o.microflow || ""}`.trim();
        if (o.page === undefined && o.microflow === undefined) throw new Error(`${where}: give 'page' or 'microflow'`);
        const m = await menuOf(o, where);
        const t = await target(o, where);
        const all = flatten(m.items);
        const dup = all.find(x => targetOf(x.item) === t.qn);
        if (dup && t.page) throw new Error(`${where}: ${t.qn} is already in the ${m.label} ("${dup.path}")`);
        if (dup) client.warn(`${where}: menu item "${dup.path}" also runs ${t.qn}`);
        let list = m.items, under = "";
        if (o.parent !== undefined && o.parent !== "") {
            const p = findItem(m, o.parent, where, "parent");
            if (p.depth >= MAX_DEPTH - 1) throw new Error(`${where}: '${o.parent}' is already ${MAX_DEPTH} levels deep; pick a higher menu item`);
            list = p.item.items;
            under = ` > ${p.path}`;
        }
        const r = await newItem({ caption: o.caption, page: o.page, microflow: o.microflow, icon: o.icon }, list, slot(list, o, where), where);
        return `${m.label}${under}: "${r.caption}" -> ${t.qn}${r.bits.length ? ` [${r.bits.join(", ")}]` : ""}${await seenBy(t)}`;
    }

    async function changeMenuItem(o) {
        const where = `changeMenuItem ${o.item}`;
        const m = await menuOf(o, where);
        const x = findItem(m, o.item, where);
        const it = x.item;
        const set = ["caption", "page", "microflow", "action", "icon", "roles"].filter(k => o[k] !== undefined);
        if (!set.length) throw new Error(`${where}: nothing to change (give caption, page, microflow, action, icon or roles)`);
        if (o.action !== undefined && !/^none$/i.test(String(o.action))) throw new Error(`${where}: action is "none" (to open a page or run a microflow give page or microflow)`);
        if (o.action !== undefined && (o.page !== undefined || o.microflow !== undefined)) throw new Error(`${where}: give action "none" or a page/microflow, not both`);
        const done = [];
        if (o.caption !== undefined) {
            const old = captionOf(it.caption);
            await h.text(it.caption, String(o.caption));
            await languageNote(where, String(o.caption), old);
            done.push(`caption "${old}" -> "${o.caption}"`);
        }
        let t = null;
        if (o.page !== undefined || o.microflow !== undefined) {
            t = await target(o, where);
            const dup = flatten(m.items).find(y => y.item !== it && targetOf(y.item) === t.qn);
            if (dup) client.warn(`${where}: ${t.qn} is also opened by menu item "${dup.path}"`);
            setAction(it, t);
            done.push(`opens ${t.qn}`);
        } else if (o.action !== undefined) {
            setAction(it, null);
            done.push("opens nothing");
        }
        if (o.icon !== undefined) done.push(await setIcon(it, o.icon, where));
        if (o.roles !== undefined) {
            const qn = t ? t.qn : targetOf(it);
            if (!qn) throw new Error(`${where}: the item opens no page or microflow, so there is nothing to give roles to`);
            await h.grantAccess({ document: qn, roles: [].concat(o.roles) });
            if (!t) t = await target(it.action instanceof pages.PageClientAction ? { page: qn } : { microflow: qn }, where);
            done.push(`${qn} may be opened by ${[].concat(o.roles).join(", ")}`);
        }
        if (!t && (o.caption !== undefined || o.icon !== undefined) && targetOf(it)) t = await target(it.action instanceof pages.PageClientAction ? { page: targetOf(it) } : { microflow: targetOf(it) }, where).catch(() => null);
        return `${m.label}: "${x.path}": ${done.join("; ")}${t ? await seenBy(t) : ""}`;
    }

    async function moveMenuItem(o) {
        const where = `moveMenuItem ${o.item}`;
        const m = await menuOf(o, where);
        const x = findItem(m, o.item, where);
        if (["parent", "after", "before", "position"].every(k => o[k] === undefined)) throw new Error(`${where}: give parent, after, before or position`);
        let list = x.list, depth = x.depth, under = null;
        if (o.parent !== undefined) {
            if (o.parent === "" || o.parent === null) {
                list = m.items;
                depth = 0;
                under = "top level";
            } else {
                const p = findItem(m, o.parent, where, "parent");
                if (p.item === x.item || flatten(x.item.items).some(y => y.item === p.item)) throw new Error(`${where}: cannot move a menu item under itself or its own sub-item`);
                list = p.item.items;
                depth = p.depth + 1;
                under = p.path;
            }
        }
        if (depth + height(x.item) > MAX_DEPTH) throw new Error(`${where}: there it would be more than ${MAX_DEPTH} levels deep (with its ${height(x.item) - 1} level(s) of sub-items)`);
        const index = slot(list, o, where, x.item);
        x.item.detach();
        place(list, x.item, index);
        const sibs = list.map(i => captionOf(i.caption));
        return `${m.label}: "${x.path}" -> ${under ? `under ${under}, ` : ""}position ${index + 1} of ${list.length} (${sibs.join(", ")})`;
    }

    async function deleteMenuItem(o) {
        const where = `deleteMenuItem ${o.item}`;
        const m = await menuOf(o, where);
        const x = findItem(m, o.item, where);
        const subs = flatten(x.item.items);
        if (subs.length) client.warn(`${where}: its ${subs.length} sub-item(s) are deleted too: ${subs.map(s => s.path).join(", ")}`);
        x.item.delete();
        return `${m.label}: "${x.path}" deleted${subs.length ? ` with ${subs.length} sub-item(s)` : ""}`;
    }

    async function createMenu(o) {
        validName(o.name, "menu name");
        const qn = `${o.module}.${o.name}`;
        if (await h.exists(qn)) throw new Error(`${qn} already exists`);
        if (o.items !== undefined && !Array.isArray(o.items)) throw new Error(`createMenu ${qn}: items is a list [ { "caption": ..., "page": ... } ]`);
        const doc = menus.MenuDocument.createIn(h.folder(o.module, o.folder));
        doc.name = o.name;
        let n = 0;
        for (const [i, spec] of (o.items || []).entries()) {
            await newItem(spec, doc.itemCollection.items, undefined, `createMenu ${qn} items[${i + 1}]`);
            n++;
        }
        const total = flatten(doc.itemCollection.items).length;
        if (flatten(doc.itemCollection.items).some(x => x.depth >= MAX_DEPTH)) throw new Error(`createMenu ${qn}: items are more than ${MAX_DEPTH} levels deep`);
        return `${qn} (${total} item(s)${total > n ? `, ${n} at the top level` : ""}; show it with useMenu)`;
    }

    function menuWidgets(doc) {
        const out = [];
        doc.traverse(el => {
            if (el instanceof pages.MenuWidget) out.push(el);
        });
        return out;
    }

    async function useMenu(o) {
        const where = `useMenu ${o.document}`;
        if ((o.menu === undefined) === (o.profile === undefined)) throw new Error(`${where}: give 'menu' (Module.Menu) or 'profile', one of them`);
        const doc = await h.get(String(o.document));
        if (!(doc instanceof pages.FormBase)) throw new Error(`${where}: '${o.document}' is not a layout, page or snippet`);
        const ws = menuWidgets(doc);
        const kind = w => w.structureTypeName.split("$")[1];
        if (!ws.length) throw new Error(`${where}: ${doc.qualifiedName} has no menu bar, navigation tree or simple menu bar`);
        let w;
        if (o.widget !== undefined) {
            w = ws.find(x => x.name === String(o.widget));
            if (!w) fail(`${where}: no menu widget '${o.widget}' (menu widgets: ${ws.map(x => `${x.name} (${kind(x)})`).join(", ")})`, o.widget, ws.map(x => x.name));
        } else if (ws.length > 1) throw new Error(`${where}: ${ws.length} menu widgets (${ws.map(x => `${x.name} (${kind(x)})`).join(", ")}); give 'widget'`);
        else w = ws[0];
        let what;
        if (o.menu !== undefined) {
            const md = await h.get(String(o.menu));
            if (!(md instanceof menus.MenuDocument)) throw new Error(`${where}: '${o.menu}' is not a menu document`);
            pages.MenuDocumentSource.createIn(w).menu = md;
            what = `menu ${md.qualifiedName}`;
        } else {
            const p = await profileNamed(o.profile, where);
            pages.NavigationSource.createIn(w).navigationProfile = p;
            what = `navigation profile ${p.name}`;
        }
        if (doc instanceof pages.Layout) client.warn(`${where}: every page that uses layout ${doc.qualifiedName} now shows the ${what}`);
        return `${doc.qualifiedName} ${w.name} (${kind(w)}) shows the ${what}`;
    }

    const DEVICE = k => k.replace(/Offline$/, "");

    function cloneItem(src, list, where) {
        const it = menus.MenuItem.create(model);
        list.push(it);
        for (const tr of src.caption.translations) {
            const x = sdk.texts.Translation.createIn(it.caption);
            x.languageCode = tr.languageCode;
            x.text = tr.text;
        }
        const qn = targetOf(src);
        if (src.action instanceof pages.PageClientAction && src.action.pageSettings.page) setAction(it, { page: src.action.pageSettings.page });
        else if (src.action instanceof pages.MicroflowClientAction && src.action.microflowSettings.microflow) setAction(it, { flow: src.action.microflowSettings.microflow });
        else {
            setAction(it, null);
            if (!(src.action instanceof pages.NoClientAction)) client.warn(`${where}: menu item "${captionOf(src.caption)}" ${qn ? `(${qn}) ` : ""}has a ${src.action.structureTypeName.split("$")[1]} action, copied as no action; set it in Studio Pro`);
        }
        const ic = src.icon;
        if (ic instanceof pages.GlyphIcon) pages.GlyphIcon.createInMenuItemUnderIcon(it).code = ic.code;
        else if (customicons && pages.IconCollectionIcon && ic instanceof pages.IconCollectionIcon && ic.image) pages.IconCollectionIcon.createInMenuItemUnderIcon(it).image = ic.image;
        else if (ic instanceof pages.ImageIcon && ic.image) pages.ImageIcon.createInMenuItemUnderIcon(it).image = ic.image;
        for (const sub of src.items) cloneItem(sub, it.items, where);
    }

    async function createNavigationProfile(o) {
        const where = `createNavigationProfile ${o.kind}`;
        const kind = enumValue(navigation.ProfileKind, o.kind, "navigation profile kind");
        const nav = await navDoc(where);
        const web = nav.profiles.filter(p => p instanceof navigation.NavigationProfile);
        const same = web.find(p => p.kind && DEVICE(p.kind.name) === DEVICE(kind.name));
        if (same) throw new Error(`${where}: the project already has the ${same.kind.name} profile '${same.name}' for this device type (one profile per device type; change it with setHomePage / addMenuItem)`);
        const resp = web.find(p => p.kind && p.kind.name === "Responsive");
        const p = navigation.NavigationProfile.createIn(nav);
        p.name = kind.name;
        p.kind = kind;
        if (resp) for (const tr of resp.appTitle.translations) {
            const x = sdk.texts.Translation.createIn(p.appTitle);
            x.languageCode = tr.languageCode;
            x.text = tr.text;
        }
        let home;
        if (o.homePage !== undefined) {
            const d = await h.get(String(o.homePage));
            if (d instanceof pages.Page) {
                if (d.parameters.length) throw new Error(`${where}: ${d.qualifiedName} has a page parameter; a home page cannot have one`);
                p.homePage.page = d;
            } else if (d instanceof mf.Microflow) {
                if (d.objectCollection.objects.some(x => x instanceof mf.MicroflowParameterObject)) throw new Error(`${where}: ${d.qualifiedName} has parameters; a home microflow cannot have any`);
                p.homePage.microflow = d;
            } else throw new Error(`${where}: homePage '${o.homePage}' is not a page or microflow`);
            home = d.qualifiedName;
        } else if (resp && (resp.homePage.page || resp.homePage.microflow)) {
            p.homePage.page = resp.homePage.page;
            p.homePage.microflow = resp.homePage.microflow;
            home = resp.homePage.pageQualifiedName || resp.homePage.microflowQualifiedName;
        } else client.warn(`${where}: no home page; Studio Pro reports an error until you set one (setHomePage with profile ${kind.name})`);
        let copied = 0;
        if (bool(o.copyMenu, false)) {
            if (!resp) throw new Error(`${where}: copyMenu needs a Responsive profile`);
            for (const it of resp.menuItemCollection.items) cloneItem(it, p.menuItemCollection.items, where);
            copied = flatten(p.menuItemCollection.items).length;
        }
        if (/Offline$/.test(kind.name)) client.warn(`${where}: an offline profile only allows pages and nanoflows that work offline; Studio Pro lists what does not`);
        if (kind.name !== "Responsive" && !home) client.warn(`${where}: pages for ${DEVICE(kind.name).toLowerCase()} usually use a ${DEVICE(kind.name)} layout (Atlas_Core.${DEVICE(kind.name)}_Default)`);
        return `${p.name} profile (home ${home || "none"}${copied ? `, ${copied} menu item(s) copied from Responsive` : ""})`;
    }

    // ------------------------------------------------ checks after apply

    async function findIn(o, spec) {
        const m = await menuOf(o, "check");
        try {
            return { m, x: findItem(m, spec, "check") };
        } catch (e) {
            return { m, x: null, error: e.message };
        }
    }

    const checks = {
        async addMenuItem(o) {
            const m = await menuOf(o, "check");
            const qn = o.page || o.microflow;
            return flatten(m.items).some(x => targetOf(x.item) === qn) ? [] : [`${qn} is not in the ${m.label}`];
        },
        async changeMenuItem(o) {
            const { x, error } = await findIn(o, o.caption !== undefined ? String(o.caption) : o.page || o.microflow || o.item);
            if (!x) return [error];
            const r = [];
            const qn = o.page || o.microflow;
            if (qn && targetOf(x.item) !== qn) r.push(`"${x.path}" opens ${targetOf(x.item) || "nothing"}, expected ${qn}`);
            if (o.action !== undefined && !(x.item.action instanceof pages.NoClientAction)) r.push(`"${x.path}" still opens something`);
            if (o.icon !== undefined && /^none$/i.test(String(o.icon)) !== !x.item.icon) r.push(`"${x.path}" icon is not ${o.icon}`);
            return r;
        },
        async moveMenuItem(o) {
            // the path changes with the move: look for the item's own caption (or target) under its new parent
            const m = await menuOf(o, "check");
            const last = String(o.item).split(/\s*(?:\/|>)\s*/).pop().toLowerCase();
            const under = o.parent === undefined ? null : String(o.parent).toLowerCase().replace(/\s*(\/|>)\s*/g, "/");
            const cands = flatten(m.items).filter(y => (y.item.caption.translations.some(t => t.text.toLowerCase() === last) || (targetOf(y.item) || "").toLowerCase() === last) &&
                (under === null || (under === "" ? y.depth === 0 : y.path.toLowerCase().slice(0, -(captionOf(y.item.caption).length + 1)).endsWith(under))));
            if (cands.length !== 1) return [`${cands.length ? "more than one" : "no"} menu item '${o.item}'${under === null ? "" : under === "" ? " at the top level" : ` under ${o.parent}`}`];
            const x = cands[0];
            const i = x.list.indexOf(x.item);
            const cap = it => it && it.caption.translations.some(t => t.text.toLowerCase() === String(o.after || o.before).toLowerCase());
            if (o.after !== undefined && !cap(x.list[i - 1])) return [`"${x.path}" is not after ${o.after}`];
            if (o.before !== undefined && !cap(x.list[i + 1])) return [`"${x.path}" is not before ${o.before}`];
            if (/^first$/i.test(o.position || "") && i !== 0) return [`"${x.path}" is not first`];
            if (/^last$/i.test(o.position || "") && i !== x.list.length - 1) return [`"${x.path}" is not last`];
            return [];
        },
        async deleteMenuItem(o) {
            const { x } = await findIn(o, o.item);
            return x ? [`"${x.path}" is still in the menu`] : [];
        },
        async createMenu(o) {
            const d = await h.get(`${o.module}.${o.name}`);
            const want = (function count(list) {
                return (list || []).reduce((n, s) => n + 1 + count(s && s.items), 0);
            })(o.items);
            const have = flatten(d.itemCollection.items).length;
            return have >= want ? [] : [`${d.qualifiedName} has ${have} item(s), expected ${want}`]; // later ops may add more
        },
        async useMenu(o) {
            const doc = await h.get(String(o.document));
            const ws = menuWidgets(doc).filter(w => o.widget === undefined || w.name === String(o.widget));
            const ok = ws.some(w => (o.menu !== undefined ? w.menuSource instanceof pages.MenuDocumentSource && w.menuSource.menuQualifiedName === o.menu : w.menuSource instanceof pages.NavigationSource && String(w.menuSource.navigationProfileQualifiedName || "").toLowerCase().endsWith(String(o.profile).toLowerCase())));
            return ok ? [] : [`${o.document}: the menu widget does not show ${o.menu || o.profile}`];
        },
        async createNavigationProfile(o) {
            const nav = await navDoc("check");
            return nav.profiles.some(p => p.kind && p.kind.name.toLowerCase() === String(o.kind).toLowerCase()) ? [] : [`no ${o.kind} navigation profile`];
        }
    };

    return { impl: { changeMenuItem, moveMenuItem, deleteMenuItem, createMenu, useMenu, createNavigationProfile }, addMenuItem, checks };
}

module.exports = { makeNav, NAV_OPS, MENU_EXTRA, extendedMenuItem };
