"use strict";
// Snippets and generated pages, built with the createPage machinery (ops-pages.js, ops-page-edit.js):
// - createSnippet: a Forms$Snippet (Type Web) with Forms$SnippetParameter { Name, ParameterType DataTypes$ObjectType }
//   as Studio Pro 11.12 stores them (Badge, RichText); widgets are added like addWidgets does. A data view with
//   "source": "parameter" uses the snippet parameter (PageVariable.SnippetParameter; no Studio Pro sample of a data
//   view on a snippet parameter: "first use" warning).
// - createCrud: Studio Pro's "Generate overview pages": <Entity>_Overview (a Data grid 2 when the project can build
//   one, else a classic Data grid, with New / Edit / Delete) and <Entity>_NewEdit (a form with Save / Cancel), an
//   optional menu item, page access and an entity access rule for module roles.
const sdk = require("mendixmodelsdk");
const { fail, validName } = require("./ops-util");

const { pages, datatypes } = sdk;

const SCAFFOLD_OPS = {
    createSnippet: {
        doc: "Create a snippet (reusable widgets shown by snippetCall on pages) with object parameters and widgets as in createPage. A data view with \"source\": \"parameter\" shows a snippet parameter.",
        fields: {
            module: "R module name", name: "R snippet name", folder: "optional folder path",
            parameters: "optional [ { \"name\": \"Order\", \"entity\": \"Module.Entity\" } ] object parameters (a page passes them in snippetCall \"params\", or the objects around it)",
            entity: "optional Module.Entity: shorthand for one parameter of it (named like the entity); without widgets: a data view form of it (inputs for its attributes, no buttons)",
            fields: "optional with entity and no widgets: [ \"Attribute\", ... ] inputs of the form (default all)",
            widgets: "optional [ { \"widget\": \"<kind>\", ... } ] as in createPage (ops createPage); a data view on a parameter: { \"widget\": \"dataView\", \"source\": \"parameter\", \"entity\": ..., \"widgets\": [...] } (no Save/Cancel unless \"buttons\": true)",
            native: "optional true: a native snippet (for native pages; its widgets as on a native page)"
        }
    },
    createCrud: {
        doc: "Generate overview and edit pages for an entity, like Studio Pro's Generate overview pages: <Entity>_Overview (data grid with New, Edit and Delete; a Data grid 2 when the project can build one, else a classic grid) and <Entity>_NewEdit (a form with Save and Cancel), optionally a menu item and access for module roles.",
        fields: {
            entity: "R Module.Entity", module: "optional module of the pages (default: the entity's)", folder: "optional folder path for both pages",
            grid: "optional auto | datagrid2 | classic (default auto: Data grid 2 when widgets/*.mpk has it)", columns: "optional [ \"Attribute\" or \"Assoc/Attr\" ] grid columns (default: all attributes)",
            fields: "optional [ \"Attribute\" ] inputs of the edit page (default: all attributes)", overview: "optional overview page name (default <Entity>_Overview)", edit: "optional edit page name (default <Entity>_NewEdit)",
            menu: "optional \"Responsive\" or { \"profile\", \"caption\", \"parent\" }: a menu item that opens the overview page",
            roles: "optional [ \"Module.Role\" ] that may open both pages", access: "optional with roles: ReadWrite | ReadOnly | none: an entity access rule for roles without one (default ReadWrite, with create and delete; none = leave access rules alone)"
        }
    }
};

const SCAFFOLD_SYNONYMS = {
    createSnippet: { params: "use \"parameters\": [ { \"name\": ..., \"entity\": ... } ]", parameter: "use \"parameters\": [ { \"name\": ..., \"entity\": ... } ] or \"entity\"", title: "a snippet has no title", layout: "a snippet has no layout", roles: "a snippet has no access of its own: the pages that show it do" },
    createCrud: { kind: "use \"grid\": auto | datagrid2 | classic", page: "use \"overview\" / \"edit\" for the page names", name: "use \"overview\" / \"edit\" for the page names", attributes: "use \"columns\" (grid) and \"fields\" (form)" }
};

// x: { model, client, get, exists, entity, folder, impl: () => ops impl, pageOps, pageEdit }
function makeScaffold(x) {
    const { model, client } = x;
    const I = () => x.pageOps.internals;

    async function createSnippet(o) {
        validName(o.name, "snippet name");
        const qn = `${o.module}.${o.name}`;
        if (await x.exists(qn)) throw new Error(`${qn} already exists`);
        const params = [];
        if (o.parameters !== undefined) {
            if (!Array.isArray(o.parameters)) throw new Error(`createSnippet ${qn}: parameters is a list [ { "name": "Order", "entity": "Module.Order" } ]`);
            for (const [i, p] of o.parameters.entries()) {
                if (!p || typeof p !== "object") throw new Error(`createSnippet ${qn}: parameter ${i + 1} is { "name": ..., "entity": "Module.Entity" }`);
                for (const k of Object.keys(p)) if (!["name", "entity"].includes(k)) fail(`createSnippet ${qn}: parameter field '${k}' is unknown (snippet parameters are objects: name, entity)`, k, ["name", "entity"]);
                if (!p.entity) throw new Error(`createSnippet ${qn}: parameter ${i + 1} needs "entity" (snippet parameters are objects of an entity)`);
                params.push({ entity: String(p.entity), name: p.name });
            }
        }
        if (o.entity !== undefined && !params.some(p => p.entity === o.entity)) params.unshift({ entity: String(o.entity) });
        if (o.fields !== undefined && (o.entity === undefined || o.widgets !== undefined)) throw new Error(`createSnippet ${qn}: "fields" goes with "entity" and no "widgets" (the generated form); with widgets give a dataView "fields"`);
        const ents = [];
        for (const p of params) {
            const e = await x.entity(p.entity);
            p.name = p.name === undefined ? e.name : p.name;
            validName(p.name, "snippet parameter name");
            if (ents.some(q => q.name === p.name)) throw new Error(`createSnippet ${qn}: two parameters named ${p.name}`);
            if (ents.some(q => q.ent === e)) throw new Error(`createSnippet ${qn}: two parameters of ${e.qualifiedName}; data views and inputs could not tell them apart`);
            ents.push({ name: p.name, ent: e });
        }
        const native = o.native !== undefined && require("./ops-util").bool(o.native, false);
        const sn = pages.Snippet.createIn(x.folder(o.module, o.folder));
        sn.name = o.name;
        if (native) {
            // Forms$Snippet Type Native (G20; no Studio Pro sample of a native snippet in the test projects)
            if (!pages.SnippetType || !pages.SnippetType.Native || !("type" in sn)) {
                sn.delete();
                throw new Error(`createSnippet ${qn}: this Mendix version has no native snippets`);
            }
            sn.type = pages.SnippetType.Native;
            client.warnFirst(`Forms$Snippet Type Native: first use by ops (no Studio Pro-saved native snippet in the test projects): check ${qn} in Studio Pro`);
        }
        for (const p of ents) {
            const sp = pages.SnippetParameter.createIn(sn);
            sp.name = p.name;
            const t = datatypes.ObjectType.create(model);
            t.entity = p.ent;
            sp.parameterType = t;
        }
        let widgets = o.widgets;
        if (widgets === undefined && o.entity !== undefined) widgets = [{ widget: "dataView", source: "parameter", entity: String(o.entity), buttons: false, ...(o.fields !== undefined ? { fields: o.fields } : {}) }];
        if (Array.isArray(widgets)) widgets = widgets.map(w => (w && typeof w === "object" && /^dataview$/i.test(String(w.widget)) && w.source === "parameter" && w.buttons === undefined ? { ...w, buttons: false } : w));
        const bits = [`${native ? "native, " : ""}${ents.length ? `parameters ${ents.map(p => `${p.name} (${p.ent.qualifiedName})`).join(", ")}` : "no parameters"}`];
        if (widgets !== undefined) {
            if (!Array.isArray(widgets) || !widgets.length) throw new Error(`createSnippet ${qn}: widgets is a list [ { "widget": "<kind>", ... } ]`);
            try {
                const text = await x.pageEdit.addWidgets({ page: qn, widgets, ...(ents.length === 1 ? { entity: ents[0].ent.qualifiedName } : {}) });
                bits.push(text.replace(/^[^:]*: /, "").replace(/ -> [^(]*$/, ""));
            } catch (e) {
                sn.delete();
                throw new Error(e.message.replace(/^addWidgets /, "createSnippet "));
            }
        }
        return `${qn} (${bits.join("; ")})`;
    }

    async function createCrud(o) {
        const ent = await x.entity(o.entity);
        const module = o.module || o.entity.split(".")[0];
        const overview = o.overview || `${ent.name}_Overview`;
        const edit = o.edit || `${ent.name}_NewEdit`;
        validName(overview, "page name");
        validName(edit, "page name");
        if (overview === edit) throw new Error(`createCrud: overview and edit page need different names (${overview})`);
        for (const n of [overview, edit]) if (await x.exists(`${module}.${n}`)) throw new Error(`${module}.${n} already exists; give "overview" / "edit" another name, or delete it first`);
        const access = o.access === undefined ? "ReadWrite" : String(o.access);
        const ACCESS = ["ReadWrite", "ReadOnly", "none"];
        if (!ACCESS.some(a => a.toLowerCase() === access.toLowerCase())) fail(`createCrud: access '${o.access}' is not ReadWrite | ReadOnly | none`, access, ACCESS);
        if (o.access !== undefined && !o.roles) throw new Error("createCrud: \"access\" goes with \"roles\" (the module roles that get the pages)");
        await x.pageOps.internals.prepareAssocs(null);
        // which grid: as createPage decides "kind": "auto" (the columns a Data grid 2 cannot show make it classic)
        const P = I();
        const cols = o.columns !== undefined ? o.columns : P.shown(ent);
        if (!Array.isArray(cols) || !cols.length) throw new Error(`createCrud: ${o.entity} has no attributes to show; give "columns"`);
        const node = { spec: { kind: o.grid === undefined ? "auto" : String(o.grid), columns: cols }, where: `createCrud ${o.entity} grid`, ent };
        P.gridKind(node);
        const grid2 = node.gridKind === "datagrid2";
        const roles = o.roles ? [].concat(o.roles) : undefined;
        const impl = x.impl();
        const out = [];
        // entity access for roles that have no rule yet (first: the pages check it)
        if (roles && access.toLowerCase() !== "none") {
            const bare = [];
            for (const r of roles) if (!ent.accessRules.some(rule => rule.moduleRolesQualifiedNames.includes(r))) bare.push(r);
            const rw = access.toLowerCase() === "readwrite";
            for (const r of bare) out.push(await impl.addAccessRule({ entity: o.entity, roles: [r], access: rw ? "ReadWrite" : "ReadOnly", create: rw, delete: rw }));
            if (bare.length < roles.length) out.push(`access rules of ${roles.filter(r => !bare.includes(r)).join(", ")} on ${o.entity} left as they are`);
        }
        // the edit page first: the overview opens it
        out.push(await impl.createPage({ module, name: edit, entity: o.entity, title: `Edit ${ent.name}`, ...(o.fields !== undefined ? { fields: o.fields } : {}), ...(o.folder ? { folder: o.folder } : {}), ...(roles ? { roles } : {}) }));
        const pageQn = `${module}.${edit}`;
        const gridSpec = grid2
            ? { widget: "dataGrid", kind: "datagrid2", entity: o.entity, name: "dataGrid2_1", columns: [...cols, { caption: " ", widgets: [
                { widget: "actionButton", action: "showPage", page: pageQn, caption: "Edit", name: "editButton1" },
                { widget: "actionButton", action: "delete", caption: "Delete", style: "Danger", name: "deleteButton1" }] }] }
            : { widget: "dataGrid", kind: "classic", entity: o.entity, columns: cols, buttons: [
                { action: "new", page: pageQn, caption: "New", style: "Primary" }, { action: "edit", page: pageQn, caption: "Edit" }, { action: "delete", caption: "Delete" }] };
        const widgets = grid2 ? [{ widget: "actionButton", action: "create", entity: o.entity, page: pageQn, caption: "New", style: "Primary", name: "newButton1" }, gridSpec] : [gridSpec];
        out.push(await impl.createPage({ module, name: overview, title: `${ent.name} Overview`, widgets, arrange: "rows", ...(o.folder ? { folder: o.folder } : {}), ...(roles ? { roles } : {}), ...(o.menu !== undefined ? { menu: o.menu } : {}) }));
        if (!grid2 && node.autoWhy && o.grid === undefined) out.push(`classic Data grid: ${node.autoWhy}`);
        return `${o.entity}: ${module}.${overview} (${grid2 ? "Data grid 2" : "classic Data grid"}, New/Edit/Delete), ${pageQn} (form, Save/Cancel)` + out.map(t => `\n      ${t}`).join("");
    }

    const checks = {
        async createSnippet(o) {
            const qn = `${o.module}.${o.name}`;
            const sn = await x.get(qn);
            if (!(sn instanceof pages.Snippet)) return [`${qn} is not a snippet`];
            const r = [];
            const want = [...(o.parameters || []).map(p => p.entity), ...(o.entity ? [o.entity] : [])];
            for (const e of new Set(want)) if (!sn.parameters.some(p => p.parameterType instanceof datatypes.ObjectType && p.parameterType.entityQualifiedName === e)) r.push(`${qn} has no parameter of ${e}`);
            if ((o.widgets || o.entity) && !sn.widgets.length) r.push(`${qn} has no widgets`);
            return r;
        },
        async createCrud(o) {
            const module = o.module || o.entity.split(".")[0];
            const ent = o.entity.split(".")[1];
            const r = [];
            for (const n of [o.overview || `${ent}_Overview`, o.edit || `${ent}_NewEdit`]) if (!(await x.exists(`${module}.${n}`))) r.push(`${module}.${n} missing`);
            return r;
        }
    };

    return { impl: { createSnippet, createCrud }, checks };
}

module.exports = { makeScaffold, SCAFFOLD_OPS, SCAFFOLD_SYNONYMS };
