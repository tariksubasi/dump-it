"use strict";
// Screen templates (screens/*.js): createScreen makes a whole page from a named template and the user's entity, its
// attributes guessed by type when not given (slots). A template is data + a build function over the blocks of
// screens/kit.js, so every screen follows the design rules of agent/UI_DESIGN.md; the same widgets give the text
// sketch (screens/sketch.js) the agent shows the user to choose a screen (python mx.py screens).
const { fail, validName } = require("./ops-util");
const registry = require("./screens");
const kit = require("./screens/kit");

const SCREEN_OPS = {
    createScreen: {
        doc: "Create a whole page from a screen template of the catalog (python mx.py screens: categories, sketches, slots): the template's widgets with your entity and attributes; slots not given are guessed from the attribute types; a missing edit page is made too.",
        fields: {
            module: "R module name of the new page",
            name: "R page name",
            template: "R template id from the catalog, e.g. time.clock.big",
            slots: "optional { \"entity\": \"Module.Entity\", \"<slot>\": \"Attribute\" | \"Module.Page\" | ... } (python mx.py screens <template> lists them; not given: guessed by type)",
            title: "optional page title (default: the template's)",
            density: "optional comfortable | compact (default comfortable)",
            cardClass: "optional CSS class of cards, e.g. acme-card of createComponentKit (default: Atlas background-default shadow-small spacing-inner-medium)",
            menu: "optional \"Responsive\" or { \"profile\", \"caption\", \"parent\" }: a menu item that opens the page",
            roles: "optional [ \"Module.Role\" ] that may open the page",
            folder: "optional folder path"
        }
    }
};

const NUMBER = ["Integer", "Long", "Decimal", "AutoNumber"];
const kindOf = a => a.type.structureTypeName.split("$")[1].replace("AttributeType", "");
const typeOk = (want, k) => !want || want === "Any" || [].concat(want).some(t => t === k || (t === "Number" && NUMBER.includes(k)) || (t === "Text" && ["String", "HashString"].includes(k)));

function makeScreens(h) {
    const { model, get, exists } = h;

    async function entityInfo(qn, where) {
        const e = await h.entity(qn).catch(() => fail(`${where}: no entity ${qn}`, qn, model.allDomainModels ? [] : []));
        await h.loadParents(e);
        const attrs = h.attributeChain(e).attributes.filter(a => !a.qualifiedName.startsWith("System."));
        return { e, attrs };
    }

    // slot values: given ones checked, the rest guessed (attributes by type, associations between the entities)
    async function resolve(tpl, given, where) {
        const s = {}, t = {}, guessed = [], enums = {};
        const slots = tpl.slots || {};
        for (const k of Object.keys(given)) if (!slots[k]) fail(`${where}: template ${tpl.id} has no slot '${k}'`, k, Object.keys(slots));
        const info = {};
        // entities first
        for (const [k, d] of Object.entries(slots).filter(([, d]) => d.kind === "entity")) {
            const v = given[k];
            if (v === undefined) {
                if (d.optional) continue;
                throw new Error(`${where}: template ${tpl.id} needs "slots": { "${k}": "Module.Entity" } (${d.desc || "the entity it shows"})`);
            }
            info[k] = await entityInfo(String(v), `${where} slot ${k}`);
            s[k] = info[k].e.qualifiedName;
        }
        const used = new Set();
        for (const [k, d] of Object.entries(slots)) {
            const v = given[k];
            if (d.kind === "entity") continue;
            if (d.kind === "attr" || d.kind === "attrs") {
                const of = info[d.of];
                if (!of) {
                    if (d.optional || slots[d.of].optional) continue;
                    throw new Error(`${where}: slot ${k} needs slot ${d.of}`);
                }
                const pick = name => {
                    const a = of.attrs.find(x => x.name === name) || fail(`${where} slot ${k}: ${s[d.of]} has no attribute '${name}'`, name, of.attrs.map(x => x.name));
                    if (!typeOk(d.type, kindOf(a))) throw new Error(`${where} slot ${k}: ${name} is ${kindOf(a)}; this slot takes ${[].concat(d.type).join(" or ")}`);
                    t[name] = kindOf(a);
                    if (t[name] === "Enumeration") enums[name] = a.type.enumerationQualifiedName;
                    return name;
                };
                if (d.kind === "attrs") {
                    if (v !== undefined) s[k] = [].concat(v).map(pick);
                    else {
                        s[k] = of.attrs.filter(a => typeOk(d.type, kindOf(a)) && kindOf(a) !== "Binary").slice(0, d.max || 4).map(a => pick(a.name));
                        guessed.push(`${k} = ${s[k].join(", ")}`);
                    }
                    continue;
                }
                if (v !== undefined) s[k] = pick(String(v));
                else {
                    const a = of.attrs.find(x => typeOk(d.type, kindOf(x)) && !used.has(x.name)) || of.attrs.find(x => typeOk(d.type, kindOf(x)));
                    if (!a) {
                        if (d.optional) continue;
                        throw new Error(`${where}: template ${tpl.id} needs a ${[].concat(d.type).join(" or ")} attribute of ${s[d.of]} for slot ${k} (${d.desc || k}); add one or give "slots": { "${k}": "Attribute" }`);
                    }
                    s[k] = pick(a.name);
                    guessed.push(`${k} = ${a.name}`);
                }
                used.add(s[k]);
            } else if (d.kind === "assoc") {
                if (v !== undefined) s[k] = String(v);
                else {
                    const from = info[d.from], to = info[d.to];
                    if (!from || !to) {
                        if (d.optional) continue;
                        throw new Error(`${where}: slot ${k} needs slots ${d.from} and ${d.to}`);
                    }
                    const dms = model.allDomainModels();
                    let found = null;
                    for (const dmi of dms) {
                        if (found) break;
                        const dm = dmi.isLoaded ? dmi : await dmi.load();
                        for (const a of dm.associations) if ((a.parent === from.e && a.child === to.e) || (a.parent === to.e && a.child === from.e)) found = a.qualifiedName;
                    }
                    if (!found) {
                        if (d.optional) continue;
                        throw new Error(`${where}: template ${tpl.id} needs an association between ${s[d.from]} and ${s[d.to]} (slot ${k}); add one with addAssociation or give "slots": { "${k}": "Module.Assoc" }`);
                    }
                    s[k] = found;
                    guessed.push(`${k} = ${found}`);
                }
            } else if (d.kind === "page" || d.kind === "microflow") {
                if (v !== undefined) {
                    if (!(await exists(String(v)))) fail(`${where} slot ${k}: ${v} not found`, String(v), (d.kind === "page" ? model.allPages() : model.allMicroflows()).map(x => x.qualifiedName));
                    s[k] = String(v);
                } else if (d.auto) s[k] = null; // made below
            } else if (d.kind === "text") s[k] = v !== undefined ? String(v) : d.default;
        }
        // enumeration values (for templates that set a status: approve -> Approved)
        const values = {};
        for (const [attr, qn] of Object.entries(enums)) {
            const en = await get(qn).then(x => x.load()).catch(() => null);
            values[attr] = en ? en.values.map(v => v.name) : [];
        }
        return { s, t, guessed, info, enums, values };
    }

    const impl = {
        async createScreen(o) {
            const where = `createScreen ${o.module}.${o.name}`;
            validName(o.name, "page name");
            const tpl = registry.byId.get(o.template) || fail(`${where}: no template '${o.template}' (python mx.py screens lists them)`, String(o.template), [...registry.byId.keys()]);
            if (o.density !== undefined && !["comfortable", "compact"].includes(o.density)) fail(`${where}: density is comfortable or compact`, String(o.density), ["comfortable", "compact"]);
            const given = o.slots || {};
            if (typeof given !== "object" || Array.isArray(given)) throw new Error(`${where}: slots is { "entity": "Module.Entity", ... }`);
            const { s, t, guessed, info, enums, values } = await resolve(tpl, given, where);
            const impl2 = h.impl();
            const lines = [];
            const run = async spec => {
                const { op, ...rest } = spec;
                lines.push(`${op} ${await impl2[op](rest)}`.split("\n")[0]);
            };
            // pages the template opens (an edit / details page of an entity) when the user gave none
            for (const [k, d] of Object.entries(tpl.slots || {})) {
                if (d.kind !== "page" || s[k] !== null || !d.auto) continue;
                const ent = s[d.of];
                if (!ent) continue;
                const pageName = `${ent.split(".")[1]}_${d.auto === "edit" ? "Edit" : "Details"}`;
                s[k] = `${o.module}.${pageName}`;
                if (await exists(s[k])) continue;
                const fields = info[d.of].attrs.filter(a => kindOf(a) !== "Binary" && kindOf(a) !== "AutoNumber").slice(0, 8).map(a => a.name);
                await run({ op: "createPage", module: o.module, name: pageName, title: `${d.auto === "edit" ? "Edit" : ""} ${ent.split(".")[1]}`.trim(), entity: ent, fields, ...(o.folder ? { folder: o.folder } : {}) });
            }
            const ctx = {
                s, t, m: o.module, name: o.name, d: o.density || "comfortable", kit,
                // Module.Enum.Value of an enumeration attribute: the wanted value, else the first of the others, else the first
                enumValues: attr => values[attr] || [],
                enumValue: (attr, ...wanted) => {
                    const vs = values[attr] || [];
                    const v = wanted.find(w => vs.includes(w)) || vs[0];
                    if (!v) throw new Error(`${where}: ${attr} has no enumeration values`);
                    return `${enums[attr]}.${v}`;
                },
                short: qn => String(qn).split(".").pop(),
                card: (widgets, extra = {}) => kit.card(widgets, { kitClass: o.cardClass, ...extra }),
                cardClass: o.cardClass,
                stat: (label, val) => kit.stat(label, val, { kitClass: o.cardClass })
            };
            const built = tpl.build(ctx);
            for (const pre of built.pre || []) await run(pre);
            const page = built.op || {
                op: "createPage", module: o.module, name: o.name, title: o.title || built.title || tpl.name, widgets: built.widgets,
                ...(built.entity ? { entity: built.entity } : {}), ...(built.page || {})
            };
            if (built.op && o.title) page.title = o.title;
            for (const k of ["menu", "roles", "folder"]) if (o[k] !== undefined) page[k] = o[k];
            if (built.op) Object.assign(page, { module: o.module, name: o.name });
            await run(page);
            return `${o.module}.${o.name} from ${tpl.id} (${tpl.name})` + (guessed.length ? `\n      slots guessed: ${guessed.join("; ")}` : "") + lines.map(l => "\n      " + l).join("");
        }
    };
    const checks = {
        async createScreen(o) {
            return (await exists(`${o.module}.${o.name}`)) ? [] : [`page ${o.module}.${o.name} missing`];
        }
    };
    return { impl, checks };
}

module.exports = { makeScreens, SCREEN_OPS };
