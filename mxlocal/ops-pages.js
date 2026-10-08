"use strict";
// Pages: create a page with a data view form for an entity (inputs per attribute type, Save/Cancel), or an empty page.
// The layout and its placeholder are learned from the project's own pages, so the result looks like its other pages.
const sdk = require("mendixmodelsdk");
const { fail, bool, setIfAvailable } = require("./ops-util");

const { pages, domainmodels: dm, datatypes } = sdk;

const PAGE_FIELDS = {
    module: "R module name",
    name: "R page name",
    title: "optional page title (default: the name)",
    entity: "optional Module.Entity: adds a page parameter and a data view form for it",
    fields: "optional [ \"Attribute\", ... ] inputs in the form (default: all attributes of the entity)",
    buttons: "optional true/false: Save and Cancel buttons under the form (default true)",
    layout: "optional Module.Layout (default: the layout most pages of this kind use)",
    folder: "optional folder path",
    roles: "optional [ \"Module.Role\" ] that may open the page"
};

function makePages(h) {
    const { model, client } = h;

    // Layout use of the project's pages: { layout, placeholder, withParameter } per page.
    function layoutUse() {
        const out = [];
        for (const id of client.project.units.keys()) {
            const p = client.project.read(id);
            if (p.$Type !== "Forms$Page" || !p.FormCall || !p.FormCall.Form) continue;
            const arg = (p.FormCall.Arguments || []).find(a => a.Parameter);
            if (!arg) continue;
            out.push({ layout: p.FormCall.Form, placeholder: arg.Parameter, withParameter: (p.Parameters || []).length > 0 });
        }
        return out;
    }

    function pickLayout(wanted, withParameter) {
        const known = new Set(model.allLayouts().map(l => l.qualifiedName));
        const uses = layoutUse().filter(u => known.has(u.layout)); // a page may refer to a layout whose module is gone
        if (wanted) {
            const hit = uses.find(u => u.layout === wanted);
            if (!hit) fail(`no page in the project uses layout '${wanted}', so its placeholder is unknown`, wanted, [...new Set(uses.map(u => u.layout))]);
            return hit;
        }
        // a page without an object is usually a full page: prefer layouts that are not popups
        let pool = uses.filter(u => u.withParameter === withParameter);
        if (!withParameter && pool.some(u => !/popup/i.test(u.layout))) pool = pool.filter(u => !/popup/i.test(u.layout));
        const counts = new Map();
        for (const u of pool.length ? pool : uses) counts.set(u.layout + "|" + u.placeholder, (counts.get(u.layout + "|" + u.placeholder) || 0) + 1);
        const best = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (!best) throw new Error("the project has no page with a layout to copy; create the first page in Studio Pro");
        const [layout, placeholder] = best[0].split("|");
        return { layout, placeholder };
    }

    function clientTemplate(owner, prop, value) {
        const t = pages.ClientTemplate.create(model);
        owner[prop] = t;
        return h.text(t.template, value);
    }

    const humanize = s => s.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

    async function input(dv, attr, param, n, where) {
        const t = attr.type;
        let w;
        if (t instanceof dm.BooleanAttributeType) w = pages.CheckBox.createInDataViewUnderWidgets(dv);
        else if (t instanceof dm.DateTimeAttributeType) w = pages.DatePicker.createInDataViewUnderWidgets(dv);
        else if (t instanceof dm.EnumerationAttributeType) w = pages.DropDown.createInDataViewUnderWidgets(dv);
        else if (t instanceof dm.BinaryAttributeType) throw new Error(`${where}: '${attr.name}' is binary; it cannot be shown in a text input`);
        else {
            w = pages.TextBox.createInDataViewUnderWidgets(dv);
            if (t instanceof dm.HashedStringAttributeType) w.isPasswordBox = true;
        }
        const kind = w.structureTypeName.split("$")[1];
        w.name = kind[0].toLowerCase() + kind.slice(1) + n;
        const ref = dm.AttributeRef.create(model);
        ref.attribute = attr;
        w.attributeRef = ref;
        await clientTemplate(w, "labelTemplate", humanize(attr.name));
        const v = pages.PageVariable.createInAttributeWidgetUnderSourceVariable(w);
        v.pageParameter = param;
        v.widget = dv;
        return w;
    }

    async function createPage(o) {
        const qn = `${o.module}.${o.name}`;
        if (await h.exists(qn)) throw new Error(`${qn} already exists`);
        const { layout, placeholder } = pickLayout(o.layout, !!o.entity);
        const layoutDoc = await h.get(layout);
        const page = pages.Page.createIn(h.folder(o.module, o.folder));
        page.name = o.name;
        if (pages.Autofocus && pages.Autofocus.DesktopOnly) setIfAvailable(page, "autofocus", pages.Autofocus.DesktopOnly); // Studio Pro's default (11.1+)
        await h.text(page.title, o.title || humanize(o.name));
        const call = pages.LayoutCall.createInPageUnderLayoutCall(page);
        call.layout = layoutDoc;
        const arg = pages.LayoutCallArgument.createIn(call);
        const short = placeholder.split(".").pop();
        let lp = null;
        layoutDoc.traverse(el => {
            if (!lp && el instanceof pages.Placeholder && el.name === short) lp = el;
        });
        if (!lp) throw new Error(`layout ${layout} has no placeholder '${short}'`);
        arg.parameter = lp;
        let inputs = 0;
        if (o.entity) {
            const ent = await h.entity(o.entity);
            await h.loadParents(ent);
            const param = pages.PageParameter.createIn(page);
            param.name = ent.name;
            const pt = datatypes.ObjectType.create(model);
            pt.entity = ent;
            param.parameterType = pt;
            setIfAvailable(param, "isRequired", true); // 11.5+
            const dv = pages.DataView.createInLayoutCallArgumentUnderWidgets(arg);
            dv.name = "dataView1";
            const src = pages.DataViewSource.createInEntityWidgetUnderDataSource(dv);
            const er = dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src);
            er.entity = ent;
            const sv = pages.PageVariable.create(model);
            src.sourceVariable = sv; // attach first: the parameter reference is local to the page
            sv.pageParameter = param;
            const attrs = h.attributeChain(ent).attributes;
            const wanted = o.fields || attrs.filter(a => !(a.type instanceof dm.BinaryAttributeType)).map(a => a.name);
            for (const [i, name] of wanted.entries()) {
                const attr = attrs.find(a => a.name === name);
                if (!attr) fail(`${qn}: ${o.entity} has no attribute '${name}'`, name, attrs.map(a => a.name));
                await input(dv, attr, param, i + 1, qn);
                inputs++;
            }
            if (bool(o.buttons, true)) {
                const save = pages.ActionButton.createInDataViewUnderFooterWidgets(dv);
                save.name = "saveButton1";
                save.buttonStyle = pages.ButtonStyle.Success;
                pages.SaveChangesClientAction.createInActionButtonUnderAction(save).closePage = true;
                await clientTemplate(save, "caption", "Save");
                const cancel = pages.ActionButton.createInDataViewUnderFooterWidgets(dv);
                cancel.name = "cancelButton1";
                cancel.buttonStyle = pages.ButtonStyle.Default;
                pages.CancelChangesClientAction.createInActionButtonUnderAction(cancel).closePage = true;
                await clientTemplate(cancel, "caption", "Cancel");
            }
        } else if (o.fields) throw new Error(`${qn}: 'fields' needs 'entity'`);
        return `${qn} (layout ${layout}${o.entity ? `, form for ${o.entity} with ${inputs} input(s)` : ""})`;
    }

    return { createPage };
}

module.exports = { makePages, PAGE_FIELDS };
