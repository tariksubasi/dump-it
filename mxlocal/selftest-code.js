"use strict";
// selftest phase C (w-code): entity dialog details (system members, event handlers, attribute documentation /
// localize / order, association documentation and ends, entity images, domain model annotations, validation rule
// order, access rule documentation), folders, the SDK COVERAGE TEST, module settings, app settings, security,
// languages, navigation and code actions. Every block runs its plan on its own module (`${T}Code`), stores it,
// reopens (0 errors, 0 deltas, byte roundtrip, checkPlan: integ.runPhase) and checks refusals change nothing.
const fs = require("fs");
const path = require("path");
const integ = require("./selftest-integ");

// The stored domain model unit of module m.
function domainOf(p, m) {
    for (const id of p.units.keys()) {
        const u = p.read(id);
        if (u.$Type !== "DomainModels$DomainModel") continue;
        const c = p.units.get(id).containerId;
        if (c && p.read(c).Name === m) return u;
    }
    return null;
}

// the module (name) a unit is in
function moduleOf(p, id) {
    for (let c = id; c && p.units.has(c); c = p.units.get(c).containerId) {
        const u = p.read(c);
        if (/^Projects\$Module(Impl)?$/.test(u.$Type)) return u.Name;
    }
    return null;
}
// folder paths of module m: Map "A/B" -> id
function foldersOf(p, m) {
    const out = new Map();
    for (const id of p.units.keys()) {
        if (p.read(id).$Type !== "Projects$Folder" || moduleOf(p, id) !== m) continue;
        const names = [];
        for (let c = id; c && p.read(c).$Type === "Projects$Folder"; c = p.units.get(c).containerId) names.unshift(p.read(c).Name);
        out.set(names.join("/"), id);
    }
    return out;
}

async function codePhase(x) {
    const { copy, T, layout, layoutProblems, check, results } = x;
    // files the ops read (images, module packages) live in edits/ next to the copy: the change file's folder
    const edits = path.join(path.dirname(copy), "edits");
    fs.mkdirSync(edits, { recursive: true });
    fs.writeFileSync(path.join(edits, "zz-code.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><circle cx=\"4\" cy=\"4\" r=\"4\" fill=\"#c63\"/></svg>");
    const reopen = async c => {
        const s = await x.reopen(c);
        s.client.changeFile = path.join(edits, "zz-code.json");
        return s;
    };
    let s2 = x.s2;
    s2.client.changeFile = path.join(edits, "zz-code.json");
    const env = { reopen, copy, layout, layoutProblems };
    const C = `${T}Code`;
    const problems = [];
    // a plan that must be refused with a message matching re (on a fresh session: a refused op may have changed the
    // model in memory)
    const refuse = async (plan, re, what) => {
        let msg = "";
        try {
            await s2.ops.runPlan(plan, () => {});
        } catch (e) {
            msg = e.message;
        }
        if (!re.test(msg)) problems.push(`${what} was not refused as expected${msg ? `: ${msg.slice(0, 200)}` : " (no error)"}`);
        s2 = await reopen(copy);
    };
    const entityIn = (p, name) => {
        const d = domainOf(p, C);
        return d && d.Entities.find(e => e.Name === name);
    };
    // the summary lines and warnings of a plan (dry run on a fresh session; nothing stored)
    const dry = async plan => {
        const lines = [];
        try {
            await s2.ops.runPlan(plan, l => lines.push(l));
            lines.push(...s2.client.summary().warnings);
        } catch (e) {
            lines.push(`ERROR ${e.message}`);
        }
        s2 = await reopen(copy);
        return lines.join("\n");
    };
    // runs a plan, then reports the block
    const block = async (title, plan, verify) => {
        const r = await integ.runPhase(env, s2, plan, p => verify(p) || []);
        s2 = r.s;
        check(title, !r.problems.length && !problems.length, [...r.problems, ...problems].slice(0, 5).join("; "));
        problems.length = 0;
        return r;
    };
    const only = x.only ? new Set(String(x.only).split(",")) : null;
    const want = k => !only || only.has(k);

    // ---- COVERAGE TEST (no project needed): every SDK document type and microflow action is placed
    {
        const cv = require("./coverage").coverage();
        check(`COVERAGE TEST: ${cv.documents} SDK document types (${cv.coveredDocuments} by ops) and ${cv.actions} microflow actions (${cv.coveredActions} by actions), the rest in NOT_SUPPORTED with the reason and the Studio Pro way`, !cv.problems.length, cv.problems.slice(0, 5).join("; "));
    }

    // ---- the module every block works in
    await block("phase C setup: module with entities", { ops: [
        { op: "createModule", name: C, roles: ["User"] },
        { op: "createEntity", module: C, name: "Order", attributes: [{ name: "Number", type: "Integer" }, { name: "Note", type: "String(200)" }, { name: "Due", type: "DateTime" }] },
        { op: "createEntity", module: C, name: "Line", attributes: [{ name: "Qty", type: "Integer" }] },
        { op: "createEntity", module: C, name: "Special", generalization: `${C}.Order` },
        { op: "addAccessRule", entity: `${C}.Order`, roles: [`${C}.User`], access: "ReadWrite", create: true, delete: true },
        { op: "createEntity", module: C, name: "Invoice", attributes: [{ name: "Ref", type: "String(40)" }] },
        { op: "createModule", name: `${C}X` },
        { op: "createEntity", module: `${C}X`, name: "Far" }
    ] }, () => []);

    // ---- E1 system members
    if (want("E1")) {
        await refuse({ ops: [{ op: "changeEntity", entity: `${C}.Special`, owner: true }] }, /root entity.*changeEntity.*Order/, "system member on a specialization");
        await refuse({ ops: [{ op: "createEntity", module: C, name: "Kid", generalization: `${C}.Order`, createdDate: true }] }, /root entity.*Order/, "createEntity system member with a generalization");
        await refuse({ ops: [{ op: "changeEntity", entity: `${C}.Order`, owner: "yes" }] }, /owner must be true or false/, "system member not a boolean");
        await refuse({ ops: [{ op: "changeEntity", entity: `${C}.Order`, hasOwner: true }] }, /write it as "owner"/, "hasOwner synonym");
        await block("E1 system members: createEntity/changeEntity createdDate, changedDate, owner, changedBy stored on the root entity; specializations refused (root named), turning off lists DATA LOSS", { ops: [
            { op: "createEntity", module: C, name: "Audit", createdDate: true, owner: true, attributes: [{ name: "What", type: "String(100)" }] },
            { op: "changeEntity", entity: `${C}.Order`, changedDate: true, changedBy: true, createdDate: true },
            { op: "changeEntity", entity: `${C}.Order`, createdDate: false }
        ] }, p => {
            const out = [];
            const a = entityIn(p, "Audit");
            const o = entityIn(p, "Order");
            const g = e => e && (e.MaybeGeneralization || e.Generalization);
            if (!a || !g(a).HasCreatedDateAttr || !g(a).HasOwnerAttr || g(a).HasChangedDateAttr) out.push("Audit system members not stored");
            if (!o || !g(o).HasChangedDateAttr || !g(o).HasChangedByAttr || g(o).HasCreatedDateAttr) out.push("Order system members not stored");
            return out;
        });
        // turning one off on a stored entity names the data loss
        const off = await dry({ ops: [{ op: "changeEntity", entity: `${C}.Order`, changedBy: false }] });
        check("E1 turning a system member off on a stored entity: DATA LOSS line", /changedBy off[\s\S]*DATA LOSS: changedBy/.test(off), off.slice(0, 200));
    }
    // ---- E2 changeEventHandler
    if (want("E2")) {
        const O = `${C}.Order`;
        await block("E2 setup: event handlers", { ops: [
            { op: "createMicroflow", module: C, name: "BCo_Order", parameters: [{ name: "Order", type: O }], returns: "Boolean", returnValue: "true" },
            { op: "createMicroflow", module: C, name: "ACo_Plain", actions: [{ action: "log", message: "after" }] },
            { op: "addEventHandler", entity: O, moment: "Before", event: "Commit", microflow: `${C}.BCo_Order` },
            { op: "addEventHandler", entity: O, moment: "Before", event: "Delete", microflow: `${C}.BCo_Order`, raiseErrorOnFalse: false }
        ] }, () => []);
        await refuse({ ops: [{ op: "changeEventHandler", entity: O, handler: "After Commit", event: "Create" }] }, /no After Commit handler; its handlers: 1: Before Commit/, "changeEventHandler of a missing handler");
        await refuse({ ops: [{ op: "changeEventHandler", entity: O, handler: 1, moment: "After", raiseErrorOnFalse: true }] }, /raiseErrorOnFalse applies to Before handlers only/, "raiseErrorOnFalse on an After handler");
        await refuse({ ops: [{ op: "changeEventHandler", entity: O, handler: 1, microflow: `${C}.ACo_Plain` }] }, /must have exactly one parameter/, "a microflow without the object parameter");
        await refuse({ ops: [{ op: "changeEventHandler", entity: O, handler: 3, passObject: false }] }, /has 2 event handler\(s\): 1: Before Commit/, "handler number out of range");
        await refuse({ ops: [{ op: "changeEventHandler", entity: O, handler: "Before Delete" }] }, /give what changes/, "changeEventHandler without a change");
        await block("E2 changeEventHandler: moment/event, microflow, passObject, raiseErrorOnFalse of a handler chosen by \"Before Commit\" or number; wrong microflow/parameters/missing handler refused", { ops: [
            { op: "changeEventHandler", entity: O, handler: "Before Commit", moment: "After", event: "Create", microflow: `${C}.ACo_Plain`, passObject: false },
            { op: "changeEventHandler", entity: O, handler: 2, raiseErrorOnFalse: true }
        ] }, p => {
            const hs = (entityIn(p, "Order") || {}).Events || [];
            const out = [];
            if (!(hs[0] && hs[0].Moment === "After" && hs[0].Type === "Create" && hs[0].Microflow === `${C}.ACo_Plain` && hs[0].SendInputParameter === false && hs[0].RaiseErrorOnFalse === false)) out.push(`handler 1 stored as ${JSON.stringify(hs[0])}`);
            if (!(hs[1] && hs[1].RaiseErrorOnFalse === true && hs[1].Moment === "Before")) out.push("handler 2 raiseErrorOnFalse not stored");
            return out;
        });
    }
    // ---- E4 DateTime localize, E3 attribute documentation
    if (want("E3")) {
        const O = `${C}.Order`;
        await refuse({ ops: [{ op: "addAttribute", entity: O, name: "Bad", type: "String(10)", localize: false }] }, /localize applies to DateTime attributes only \(this one is String\)/, "localize on a String attribute");
        await refuse({ ops: [{ op: "changeAttribute", attribute: `${O}.Due`, localize: "no" }] }, /localize must be true or false/, "localize not a boolean");
        await block("E3/E4 attributes: addAttribute/changeAttribute documentation (multi-line) and DateTime localize (also in createEntity attributes); localize on other types refused", { ops: [
            { op: "addAttribute", entity: O, name: "Shipped", type: "DateTime", localize: false, documentation: "When it left.\nUTC." },
            { op: "changeAttribute", attribute: `${O}.Due`, localize: false },
            { op: "changeAttribute", attribute: `${O}.Note`, documentation: "Free text for the customer" },
            { op: "createEntity", module: C, name: "Slot", attributes: [{ name: "At", type: "DateTime", localize: false, documentation: "start" }] }
        ] }, p => {
            const o = entityIn(p, "Order") || { Attributes: [] };
            const at = n => o.Attributes.find(a => a.Name === n) || {};
            const out = [];
            if (at("Shipped").NewType.LocalizeDate !== false || at("Shipped").Documentation !== "When it left.\r\nUTC.") out.push("Shipped localize/documentation not stored");
            if (at("Due").NewType.LocalizeDate !== false) out.push("Due still localized");
            if (at("Note").Documentation !== "Free text for the customer") out.push("Note documentation not stored");
            const sl = entityIn(p, "Slot");
            if (!sl || sl.Attributes[0].NewType.LocalizeDate !== false) out.push("Slot.At localize not stored");
            return out;
        });
    }
    // ---- E7 association documentation, E8 createEntity image
    if (want("E7")) {
        await block("E7/E8 association documentation (addAssociation, changeAssociation) and createEntity image", { ops: [
            { op: "createImageCollection", module: C, name: "Icons" },
            { op: "addImage", collection: `${C}.Icons`, file: "edits/zz-code.svg", name: "Dot" },
            { op: "addAssociation", from: `${C}.Line`, to: `${C}.Order`, documentation: "Each line belongs to one order" },
            { op: "createEntity", module: C, name: "Tag", image: `${C}.Icons.Dot` },
            { op: "addAssociation", from: `${C}.Tag`, to: `${C}.Order`, name: "Tag_Order" },
            { op: "changeAssociation", association: `${C}.Tag_Order`, documentation: "Tags of an order\nmany per order" }
        ] }, p => {
            const d = domainOf(p, C) || { Associations: [], Entities: [] };
            const as = n => d.Associations.find(a => a.Name === n) || {};
            const out = [];
            if (as("Line_Order").Documentation !== "Each line belongs to one order") out.push("Line_Order documentation not stored");
            if (as("Tag_Order").Documentation !== "Tags of an order\r\nmany per order") out.push("Tag_Order documentation not stored");
            if ((entityIn(p, "Tag") || {}).Image !== `${C}.Icons.Dot`) out.push("Tag image not stored");
            return out;
        });
        await refuse({ ops: [{ op: "createEntity", module: C, name: "Bad", image: `${C}.Icons.Dott` }] }, /not an image[\s\S]*Did you mean.*Icons\.Dot/i, "createEntity with a wrong image");
    }
    // ---- E5 attribute order
    if (want("E5")) {
        const O = `${C}.Line`;
        await refuse({ ops: [{ op: "addAttribute", entity: O, name: "X", type: "Integer", before: "Qtty" }] }, /no 'Qtty' to put it before[\s\S]*Qty/, "addAttribute before a missing attribute");
        await refuse({ ops: [{ op: "changeAttribute", attribute: `${O}.Qty`, position: 9 }] }, /position is 1\.\.1/, "position out of range");
        await refuse({ ops: [{ op: "changeAttribute", attribute: `${O}.Qty`, position: 1, after: "Qty" }] }, /give one of "before", "after"/, "position and after together");
        await block("E5 attribute order: addAttribute before/after, changeAttribute position/before/after (the order Studio Pro lists them in)", { ops: [
            { op: "addAttribute", entity: O, name: "Price", type: "Decimal", before: "Qty" },
            { op: "addAttribute", entity: O, name: "Code", type: "String(20)", after: "Price" },
            { op: "addAttribute", entity: O, name: "Total", type: "Decimal" },
            { op: "changeAttribute", attribute: `${O}.Total`, position: 1 },
            { op: "changeAttribute", attribute: `${O}.Price`, after: "Qty" }
        ] }, p => {
            const names = ((entityIn(p, "Line") || {}).Attributes || []).map(a => a.Name).join(",");
            return names === "Total,Code,Qty,Price" ? [] : [`Line attributes are ${names}, expected Total,Code,Qty,Price`];
        });
    }
    // ---- E6 re-point association ends
    if (want("E6")) {
        const usage = await dry({ ops: [
            { op: "createMicroflow", module: C, name: "Lines_Of", parameters: [{ name: "Order", type: `${C}.Order` }], actions: [{ action: "retrieve", variable: "Lines", from: "Order", association: `${C}.Line_Order` }] },
            { op: "changeAssociation", association: `${C}.Line_Order`, to: `${C}.Invoice` }] });
        if (!/ends \S*Line -> \S*Order became \S*Line -> \S*Invoice/.test(usage) || !/CHECK these places[^\n]*Lines_Of/.test(usage) || !/DATA LOSS: existing .*Line_Order links/.test(usage)) problems.push(`re-point summary lacks the ends, the usage of Lines_Of or DATA LOSS: ${usage.slice(200, 900)}`);
        await refuse({ ops: [{ op: "changeAssociation", association: `${C}.Line_Order`, to: `${C}X.Far` }] }, /REFUSED: .*cross-module association/, "re-pointing to an entity of another module");
        await refuse({ ops: [{ op: "changeAssociation", association: `${C}.Line_Order`, from: `${C}X.Far` }] }, /REFUSED: .*would move it/, "a new owner in another module");
        await refuse({ ops: [{ op: "changeAssociation", association: `${C}.Line_Order`, parent: `${C}.Tag` }] }, /write it as "from"/, "parent synonym");
        await block("E6 changeAssociation from/to: re-point an end (member access follows the owner; usages and DATA LOSS listed in the dry run); another module refused", { ops: [
            { op: "changeAssociation", association: `${C}.Tag_Order`, from: `${C}.Order`, to: `${C}.Invoice` }
        ] }, p => {
            const d = domainOf(p, C) || { Associations: [], Entities: [] };
            const a = d.Associations.find(y => y.Name === "Tag_Order") || {};
            const id = n => (d.Entities.find(e => e.Name === n) || {}).$ID;
            const out = [];
            if (a.ParentPointer !== id("Order") || a.ChildPointer !== id("Invoice")) out.push("Tag_Order ends not stored");
            const rule = (entityIn(p, "Order") || {}).AccessRules || [];
            if (!rule.length || !rule[0].MemberAccesses.some(m => m.Association === `${C}.Tag_Order`)) out.push("Order's access rule lacks Tag_Order");
            return out;
        });
    }
    // ---- E9 domain model annotations
    if (want("E9")) {
        await refuse({ ops: [{ op: "addDomainAnnotation", module: C, text: "x", near: `${C}X.Far` }] }, /near must be an entity of /, "an annotation next to an entity of another module");
        await refuse({ ops: [{ op: "addDomainAnnotation", module: C, text: "x", near: `${C}.Ordr` }] }, /no entity 'Ordr'[\s\S]*Order/, "an annotation next to a missing entity");
        await block("E9 domain model annotations: add (next to an entity, or below), change text/width/place by number or text start, delete", { ops: [
            { op: "addDomainAnnotation", module: C, text: "Orders come from the shop.\nOne per checkout.", near: `${C}.Order` },
            { op: "addDomainAnnotation", module: C, text: "Temporary note", width: 200 },
            { op: "addDomainAnnotation", module: C, text: "Lines note", near: `${C}.Line` },
            { op: "changeDomainAnnotation", module: C, annotation: "lines", text: "Lines belong to an order", width: 240, near: `${C}.Invoice` },
            { op: "deleteDomainAnnotation", module: C, annotation: 2 }
        ] }, p => {
            const ns = (domainOf(p, C) || {}).Annotations || [];
            const out = [];
            if (ns.length !== 2) out.push(`${ns.length} annotations stored, expected 2`);
            if (!ns.some(n => n.Caption === "Orders come from the shop.\r\nOne per checkout." && n.Width === 300 && /^\d+;\d+$/.test(n.Location))) out.push("first annotation not stored like Studio Pro (Caption, Location x;y, Width)");
            if (!ns.some(n => n.Caption === "Lines belong to an order" && n.Width === 240)) out.push("changed annotation not stored");
            return out;
        });
        await refuse({ ops: [{ op: "deleteDomainAnnotation", module: C, annotation: "Nothing like it" }] }, /no annotation starts with[\s\S]*1: "Orders come/, "deleting a missing annotation");
    }
    // ---- E10 validation rule order, access rule documentation
    if (want("E10")) {
        const O = `${C}.Order`;
        await block("E10 setup: validation rules", { ops: [
            { op: "addValidationRule", entity: O, attribute: "Number", rule: "required", message: "Number is required" },
            { op: "addValidationRule", entity: O, attribute: "Note", rule: "required", message: "Note is required" }
        ] }, () => []);
        await refuse({ ops: [{ op: "changeValidationRule", entity: O, attribute: "Note", position: 3 }] }, /position is 1\.\.2/, "validation rule position out of range");
        await block("E10 validation rule order (changeValidationRule position) and access rule documentation (addAccessRule, changeAccessRule)", { ops: [
            { op: "changeValidationRule", entity: O, attribute: "Note", position: 1 },
            { op: "changeAccessRule", entity: O, roles: [`${C}.User`], documentation: "Users manage their own orders" },
            { op: "addAccessRule", entity: `${C}.Invoice`, roles: [`${C}.User`], documentation: "Read only for users\nfinance writes" }
        ] }, p => {
            const o = entityIn(p, "Order") || {};
            const inv = entityIn(p, "Invoice") || {};
            const out = [];
            if (!(o.ValidationRules || []).length || !/\.Note$/.test(o.ValidationRules[0].Attribute)) out.push(`first rule is on ${(o.ValidationRules || [{}])[0].Attribute}`);
            if (((o.AccessRules || [])[0] || {}).Documentation !== "Users manage their own orders") out.push("Order access rule documentation not stored");
            if (((inv.AccessRules || [])[0] || {}).Documentation !== "Read only for users\r\nfinance writes") out.push("Invoice access rule documentation not stored");
            return out;
        });
    }
    // ---- N-7 folders
    if (want("N7")) {
        await block("N-7 setup: documents in folders", { ops: [
            { op: "createMicroflow", module: C, name: "Fa", folder: "Work/Sub" },
            { op: "createConstant", module: C, name: "K1", type: "String", default: "a", folder: "Work" },
            { op: "createConstant", module: C, name: "K2", type: "String", default: "b", folder: "Trash/Bin" },
            { op: "createConstant", module: C, name: "K3", type: "String", default: "c", folder: "Old" },
            { op: "moveDocument", document: `${C}.K2`, folder: "" }
        ] }, () => []);
        await refuse({ ops: [{ op: "deleteFolder", module: C, folder: "Work" }] }, /REFUSED: .*Work is not empty .*Sub\/Fa.*K1.*force/, "deleting a folder that is not empty");
        await refuse({ ops: [{ op: "renameFolder", module: C, folder: "Wrk", newName: "X" }] }, /no folder 'Wrk'[\s\S]*Did you mean: Work/, "renaming a missing folder");
        await refuse({ ops: [{ op: "moveFolder", module: C, folder: "Work", to: "Work/Sub" }] }, /cannot move into itself/, "moving a folder into itself");
        await refuse({ ops: [{ op: "moveFolder", module: C, folder: "Work", target: "Archive" }] }, /write it as "to"/, "moveFolder target synonym");
        await block("N-7 folders: renameFolder, moveFolder (with its documents, to a new folder), deleteFolder (empty; not empty refused with the list; force deletes the documents)", { ops: [
            { op: "renameFolder", module: C, folder: "Work/Sub", newName: "Inner" },
            { op: "moveFolder", module: C, folder: "Work/Inner", to: "Archive/2026" },
            { op: "deleteFolder", module: C, folder: "Trash/Bin" },
            { op: "deleteFolder", module: C, folder: "Trash" },
            { op: "deleteFolder", module: C, folder: "Old", force: true }
        ] }, p => {
            const out = [];
            const fs2 = foldersOf(p, C);
            const k3 = [...p.units.keys()].some(id => p.read(id).$Type === "Constants$Constant" && p.read(id).Name === "K3" && moduleOf(p, id) === C);
            if (!fs2.has("Archive/2026/Inner")) out.push(`Inner is not in Archive/2026 (folders: ${[...fs2.keys()].join(", ")})`);
            const left = ["Work/Sub", "Trash", "Trash/Bin", "Old"].filter(n => fs2.has(n));
            if (left.length) out.push(`folders left: ${left.join(", ")}`);
            if (k3) out.push("K3 was not deleted with its folder");
            return out;
        });
    }
    // ---- M1-M4 changeJavaScriptAction / changeJavaAction (parameters, return, platform, code; callers follow; generics)
    if (want("M")) {
        const jsFile = path.join(path.dirname(copy), "javascriptsource", C.toLowerCase(), "actions", "JS_Greet.js");
        const javaFile = n => path.join(path.dirname(copy), "javasource", C.toLowerCase(), "actions", `${n}.java`);
        const calls = (p, flow, type) => {
            const u = integ.unitsNamed(p, flow)[flow];
            const out = [];
            integ.walk(u || {}, o => o.$Type === type && out.push(o));
            return out;
        };
        await block("M setup: Java and JavaScript actions with callers (also EntityType(T) / Object(T) generics)", { ops: [
            { op: "createJavaScriptAction", module: C, name: "JS_Greet", parameters: [{ name: "Name", type: "String" }], returns: "String" },
            { op: "createNanoflow", module: C, name: "N_Use", actions: [{ action: "callJavaScript", jsAction: `${C}.JS_Greet`, args: { Name: "'x'" }, variable: "Out" }] },
            { op: "createJavaAction", module: C, name: "JA_Sum", parameters: [{ name: "A", type: "Integer" }], returns: "Integer", code: "return A;", compile: false },
            { op: "createMicroflow", module: C, name: "MF_Use", actions: [{ action: "callJava", javaAction: `${C}.JA_Sum`, args: { A: "1" }, variable: "S" }] },
            { op: "createJavaAction", module: C, name: "JA_Gen", parameters: [{ name: "Kind", type: "EntityType(T)" }, { name: "Item", type: "Object(T)" }], returns: "List(T)", compile: false },
            { op: "createMicroflow", module: C, name: "MF_Gen", parameters: [{ name: "Order", type: `${C}.Order` }], actions: [{ action: "callJava", javaAction: `${C}.JA_Gen`, args: { Kind: `${C}.Order`, Item: "$Order" }, variable: "L" }] }
        ] }, () => []);
        const J = `${C}.JS_Greet`;
        await refuse({ ops: [{ op: "changeJavaScriptAction", javaScriptAction: J, addParameters: [{ name: "Times", type: "Integer" }] }] }, /REFUSED[\s\S]*Times: give "value"[\s\S]*N_Use/, "a new parameter without value while nanoflows call it");
        await refuse({ ops: [{ op: "changeJavaScriptAction", javaScriptAction: J, returns: "Nothing" }] }, /REFUSED[\s\S]*N_Use step .*uses the result as \$Out/, "returns Nothing while a call uses the result");
        await refuse({ ops: [{ op: "changeJavaScriptAction", javaScriptAction: J, removeParameters: ["Nam"] }] }, /no parameter 'Nam'[\s\S]*Did you mean: Name/, "removing a missing parameter");
        await refuse({ ops: [{ op: "changeJavaScriptAction", javaScriptAction: J, code: "return (;" }] }, /JS CHECK: node --check found a syntax error/, "JavaScript code with a syntax error");
        await refuse({ ops: [{ op: "changeJavaAction", javaAction: J, documentation: "x" }] }, /is not a Java action \(it is a JavaScript action: use changeJavaScriptAction\)/, "changeJavaAction on a JavaScript action");
        await refuse({ ops: [{ op: "changeJavaAction", javaAction: `${C}.JA_Gen`, removeParameters: ["Kind"] }] }, /Kind declares type parameter T, which Item, the return type still use/, "removing the parameter that declares a type parameter in use");
        // M1: parameters, platform, documentation; the user code stays
        await block("M1 changeJavaScriptAction: add a parameter (the nanoflow call passes its value), platform, documentation; the .js stub renewed with the user code kept", { ops: [
            { op: "changeJavaScriptAction", javaScriptAction: J, addParameters: [{ name: "Times", type: "Integer", value: "2", description: "how often" }], platform: "Web", documentation: "Greets someone" }
        ] }, p => {
            const out = [];
            const u = integ.unitsNamed(p, "JS_Greet").JS_Greet || {};
            if ((u.Parameters || u.ActionParameters || []).length !== 2 || u.Platform !== "Web") out.push(`JS_Greet stored with ${(u.Parameters || u.ActionParameters || []).length} parameters, platform ${u.Platform}`);
            const c = calls(p, "N_Use", "Microflows$JavaScriptActionCallAction")[0];
            if (!c || c.ParameterMappings.length !== 2) out.push("N_Use call does not pass 2 arguments");
            const t = fs.existsSync(jsFile) ? fs.readFileSync(jsFile, "utf8") : "";
            if (!/export async function JS_Greet\(Name, Times\)/.test(t) || !/@param \{Big\} Times - how often/.test(t) || !/JavaScript action was not implemented/.test(t)) out.push("JS_Greet.js not renewed with the kept user code");
            return out;
        });
        // M3: code into USER CODE, syntax-checked
        await block("M3 changeJavaScriptAction code: written between BEGIN/END USER CODE (node --check; a syntax error is refused), extra code", { ops: [
            { op: "changeJavaScriptAction", javaScriptAction: J, code: "const n = Number(Times);\nreturn `${Name} x${n}`;", extra: "// helpers" }
        ] }, () => {
            const t = fs.existsSync(jsFile) ? fs.readFileSync(jsFile, "utf8") : "";
            return /\t\/\/ BEGIN USER CODE\r\n\tconst n = Number\(Times\);\r\n\treturn `\$\{Name\} x\$\{n\}`;\r\n\t\/\/ END USER CODE/.test(t) && /BEGIN EXTRA CODE\r\n\/\/ helpers\r\n\/\/ END EXTRA CODE/.test(t) ? [] : ["JS_Greet.js does not hold the code (CRLF, tab) and extra code"];
        });
        // M2: Java parameters, callers, code
        await block("M2 changeJavaAction: add and remove parameters (the microflow call follows), code; BEGIN/END USER CODE and EXTRA CODE kept", { ops: [
            { op: "changeJavaAction", javaAction: `${C}.JA_Sum`, addParameters: [{ name: "B", type: "Decimal", value: "3.5" }], removeParameters: ["A"], returns: "Decimal", code: "return B;", compile: false }
        ] }, p => {
            const out = [];
            const c = calls(p, "MF_Use", "Microflows$JavaActionCallAction")[0];
            if (!c || c.ParameterMappings.length !== 1 || !/\.B$/.test(c.ParameterMappings[0].Parameter)) out.push("MF_Use call does not pass only B");
            const t = fs.existsSync(javaFile("JA_Sum")) ? fs.readFileSync(javaFile("JA_Sum"), "utf8") : "";
            if (!/private final java\.math\.BigDecimal B;/.test(t) || /private final java\.lang\.Long A;/.test(t) || !/UserAction<java\.math\.BigDecimal>/.test(t) || !/\t\treturn B;\r\n\t\t\/\/ END USER CODE/.test(t)) out.push("JA_Sum.java not regenerated with B, Decimal and the code");
            return out;
        });
        // M4: type parameters (generics) end to end
        await block("M4 Java action type parameters: EntityType(T) + Object(T) + List(T) created, called with an entity, changed (new Object(T) parameter, returns Object(T)); the call follows", { ops: [
            { op: "changeJavaAction", javaAction: `${C}.JA_Gen`, addParameters: [{ name: "Other", type: "Object(T)", value: "$Order" }], returns: "Object(T)" }
        ] }, p => {
            const out = [];
            const u = integ.unitsNamed(p, "JA_Gen").JA_Gen || {};
            const ps = u.Parameters || u.ActionParameters || [];
            if (ps.length !== 3 || (u.TypeParameters || u.ActionTypeParameters || []).length !== 1) out.push(`JA_Gen stored with ${ps.length} parameters`);
            if (!/ParameterizedEntityType/.test(JSON.stringify(u.JavaReturnType || u.ActionReturnType || u.ReturnType || {}))) out.push("JA_Gen does not return Object(T)");
            const c = calls(p, "MF_Gen", "Microflows$JavaActionCallAction")[0];
            if (!c || c.ParameterMappings.length !== 3) out.push("MF_Gen call does not pass 3 arguments");
            const t = fs.existsSync(javaFile("JA_Gen")) ? fs.readFileSync(javaFile("JA_Gen"), "utf8") : "";
            if (!/UserAction<IMendixObject>/.test(t) || !/private final IMendixObject Other;/.test(t)) out.push("JA_Gen.java not regenerated");
            return out;
        });
    }
    // ---- M10 languages: change (default, completeness, formats), delete
    if (want("M10")) {
        const langs = p => {
            for (const id of p.units.keys()) {
                const u = p.read(id);
                if (u.$Type !== "Settings$ProjectSettings") continue;
                return (u.Settings || []).find(x => x.$Type === "Settings$LanguageSettings") || null;
            }
            return null;
        };
        const before = langs(s2.ctx.project);
        const dflt = before ? before.DefaultLanguageCode : "en_US";
        await refuse({ ops: [{ op: "deleteLanguage", code: dflt }] }, /REFUSED: .* is the default language; make another language the default first/, "deleting the default language");
        await refuse({ ops: [{ op: "changeLanguage", code: "is_IS", checkCompleteness: true }] }, /is_IS is not a project language/, "changing a language the project does not have");
        await refuse({ ops: [{ op: "changeLanguage", code: dflt, dateFormat: "nope" }] }, /has no date\/time letters/, "a date format without date letters");
        await block("M10 languages: addLanguage, changeLanguage (default, check completeness, custom date/time formats), deleteLanguage (the default refused)", { ops: [
            { op: "addLanguage", code: "is_IS" },
            { op: "addLanguage", code: "et_EE" },
            { op: "changeLanguage", code: "is_IS", checkCompleteness: true, dateFormat: "dd.MM.yyyy", timeFormat: "HH:mm" },
            { op: "deleteLanguage", code: "et_EE" }
        ] }, p => {
            const ls = langs(p) || { Languages: [] };
            const is = ls.Languages.find(l => l.Code === "is_IS");
            const out = [];
            if (!is || is.CheckCompleteness !== true || is.CustomDateFormat !== "dd.MM.yyyy" || is.CustomTimeFormat !== "HH:mm") out.push(`is_IS stored as ${JSON.stringify(is)}`);
            if (ls.Languages.some(l => l.Code === "et_EE")) out.push("et_EE not deleted");
            return out;
        });
    }
    // ---- N-9 enumeration value images (create, add, change)
    if (want("N9")) {
        await refuse({ ops: [{ op: "createEnumeration", module: C, name: "Bad", values: [{ name: "A", image: `${C}.Icons.Dott` }] }] }, /no image 'Dott'[\s\S]*Did you mean: Dot/, "an enumeration value with a missing image");
        await block("N-9 enumeration value images: createEnumeration values with image, addEnumerationValue image, changeEnumerationValue image (and \"\" = none)", { ops: [
            ...(want("E7") ? [] : [{ op: "createImageCollection", module: C, name: "Icons" }, { op: "addImage", collection: `${C}.Icons`, file: "edits/zz-code.svg", name: "Dot" }]),
            { op: "createEnumeration", module: C, name: "Level", values: [{ name: "Low", caption: "Low", image: `${C}.Icons.Dot` }, "High"] },
            { op: "addEnumerationValue", enumeration: `${C}.Level`, name: "Mid", image: `${C}.Icons.Dot` },
            { op: "changeEnumerationValue", value: `${C}.Level.High`, image: `${C}.Icons.Dot` }
        ] }, p => {
            const en = integ.unitsNamed(p, "Level").Level || { Values: [] };
            const img = n => (en.Values.find(v => v.Name === n) || {}).Image;
            return ["Low", "Mid", "High"].every(n => img(n) === `${C}.Icons.Dot`) ? [] : [`images stored as ${en.Values.map(v => `${v.Name}=${v.Image}`).join(", ")}`];
        });
    }

    // ---- M5 module settings
    if (want("M5")) {
        const settingsOf = p => {
            for (const id of p.units.keys()) if (p.read(id).$Type === "Projects$ModuleSettings" && moduleOf(p, id) === C) return p.read(id);
            return {};
        };
        await refuse({ ops: [{ op: "setModuleSettings", module: C, version: "2.1" }] }, /version is major\.minor\.patch/, "a version that is not x.y.z");
        await refuse({ ops: [{ op: "setModuleSettings", module: C, exportLevel: "solutoin" }] }, /exportLevel 'solutoin' is not known[\s\S]*Did you mean: solution/, "an unknown export level");
        await block("M5 setModuleSettings: version, export level protected add-on (warnings), solution identifier", { ops: [
            { op: "setModuleSettings", module: C, version: "2.1.0", exportLevel: "addOn" }
        ] }, p => {
            const ms = settingsOf(p);
            return ms.Version === "2.1.0" && ms.ExportLevel === "Protected" && ms.ProtectedModuleType === "AddOn" ? [] : [`module settings stored as ${ms.Version} ${ms.ExportLevel} ${ms.ProtectedModuleType}`];
        });
        await block("M5 setModuleSettings back to a source module", { ops: [{ op: "setModuleSettings", module: C, exportLevel: "source" }] }, p => (settingsOf(p).ExportLevel === "Source" ? [] : ["export level not Source again"]));
    }

    // ---- M11 security: password policy, manageable roles, anonymous users
    if (want("M11")) {
        const sec = p => {
            for (const id of p.units.keys()) if (p.read(id).$Type === "Security$ProjectSecurity") return p.read(id);
            return {};
        };
        const roles = (sec(s2.ctx.project).UserRoles || []).map(r => r.Name);
        if (!roles.length) results.push("SKIP M11 user roles: this project has no user roles");
        else {
            const R = `ZzCodeRole`;
            await refuse({ ops: [{ op: "setSecurity", passwordPolicy: { minLength: 8 } }] }, /passwordPolicy: unknown field 'minLength'[\s\S]*minimumLength/, "an unknown password policy field");
            await refuse({ ops: [{ op: "changeUserRole", role: "ZzNoSuchRole", manageAllRoles: true }] }, /no user role 'ZzNoSuchRole'/, "changing a missing user role");
            const admin = sec(s2.ctx.project).AdminUserRoleName;
            if (admin) await refuse({ ops: [{ op: "setSecurity", guestRole: admin }] }, /REFUSED: .* is the administrator's role/, "the administrator's role for anonymous users");
            await block("M11 setup: a user role and a module role", { ops: [{ op: "createUserRole", name: R, moduleRoles: [`${C}.User`] }, { op: "createModuleRole", module: C, name: "Viewer" }] }, () => []);
            await block("M11 security: password policy (setSecurity), changeUserRole (manageable roles, users without roles, module roles), anonymous users' role", { ops: [
                { op: "setSecurity", passwordPolicy: { minimumLength: 10, requireDigit: true, requireSymbol: true } },
                { op: "changeUserRole", role: R, manageableRoles: [R], manageUsersWithoutRoles: false, description: "Code test role" },
                { op: "changeUserRole", role: R, addModuleRoles: [`${C}.Viewer`], removeModuleRoles: [`${C}.User`] }
            ] }, p => {
                const ps = sec(p);
                const r = (ps.UserRoles || []).find(x => x.Name === R) || {};
                const out = [];
                const pol = ps.PasswordPolicySettings || {};
                if (pol.MinimumLength !== 10 || pol.RequireDigit !== true || pol.RequireSymbol !== true) out.push(`password policy stored as ${JSON.stringify(pol)}`);
                if (JSON.stringify(r.ManageableRoles || []).indexOf(R) < 0 || r.ManageAllRoles !== false) out.push("manageable roles not stored");
                if (!(r.ModuleRoles || []).includes(`${C}.Viewer`) || (r.ModuleRoles || []).includes(`${C}.User`)) out.push(`module roles stored as ${(r.ModuleRoles || []).join(", ")}`);
                return out;
            });
        }
    }

    // ---- M8 move a constant to another module
    if (want("M8")) {
        await block("M8 setup: a constant used in a microflow expression", { ops: [
            { op: "createConstant", module: C, name: "ApiKey", type: "String", default: "abc" },
            { op: "createMicroflow", module: C, name: "UsesKey", actions: [{ action: "log", message: "{1}", args: [`@${C}.ApiKey`] }] }
        ] }, () => []);
        await refuse({ ops: [{ op: "moveConstant", constant: `${C}.ApiKey`, module: C }] }, /is already in/, "moving a constant to its own module");
        await refuse({ ops: [{ op: "moveConstant", constant: `${C}.ApiKey`, module: `${C}Y` }] }, /Module '.*Y' not found[\s\S]*Did you mean/, "moving to a missing module");
        await refuse({ ops: [{ op: "moveConstant", constant: `${C}.Order`, module: `${C}X` }] }, /is not a constant/, "moving an entity with moveConstant");
        await block("M8 moveConstant: to another module and folder; @Module.Constant in expressions renamed, usages listed", { ops: [
            { op: "moveConstant", constant: `${C}.ApiKey`, module: `${C}X`, folder: "Settings" }
        ] }, p => {
            const out = [];
            const k = [...p.units.keys()].find(id => p.read(id).$Type === "Constants$Constant" && p.read(id).Name === "ApiKey" && moduleOf(p, id) === `${C}X`);
            if (!k) out.push(`ApiKey is not in ${C}X`);
            else if (!foldersOf(p, `${C}X`).has("Settings") || p.read(p.units.get(k).containerId).Name !== "Settings") out.push("ApiKey is not in folder Settings");
            const mfl = JSON.stringify(integ.unitsNamed(p, "UsesKey").UsesKey || {});
            if (!mfl.includes(`@${C}X.ApiKey`) || mfl.includes(`@${C}.ApiKey`)) out.push("UsesKey still names the old constant");
            return out;
        });
    }

    // ---- M9 app settings: runtime settings, certificates
    if (want("M9")) {
        const { spawnSync } = require("child_process");
        const pem = path.join(edits, "zz-ca.crt");
        const gen = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(edits, "zz-ca.key"), "-out", pem, "-days", "30", "-subj", "/CN=ZzCode Test CA"], { encoding: "utf8" });
        const cert = !gen.error && gen.status === 0;
        if (!cert) results.push("SKIP M9 certificate: no openssl to make a test certificate");
        await refuse({ ops: [{ op: "setProjectSettings", decimalScale: 99 }] }, /decimalScale is a whole number 1\.\.20/, "a decimal scale out of range");
        await refuse({ ops: [{ op: "addCertificate", file: "edits/zz-code.svg" }] }, /a certificate is a \.crt/, "an image as certificate");
        await block(`M9 app settings: runtime settings (multiple sessions, optimistic locking, scheduled event time zone)${cert ? ", addCertificate (authority) and deleteCertificate" : ""}`, { ops: [
            { op: "setProjectSettings", multipleSessions: false, scheduledEventTimeZone: "Europe/Istanbul" },
            ...(cert ? [{ op: "addCertificate", file: "edits/zz-ca.crt" }] : [])
        ] }, p => {
            const out = [];
            for (const id of p.units.keys()) {
                const u = p.read(id);
                if (u.$Type !== "Settings$ProjectSettings") continue;
                const rs = (u.Settings || []).find(x => x.$Type === "Settings$ModelSettings") || {};
                if (rs.AllowUserMultipleSessions !== false || rs.ScheduledEventTimeZoneCode !== "Europe/Istanbul") out.push(`runtime settings stored as ${rs.AllowUserMultipleSessions} ${rs.ScheduledEventTimeZoneCode}`);
                const cs = (u.Settings || []).find(x => x.$Type === "Settings$CertificateSettings") || {};
                if (cert && !(cs.Certificates || []).some(c => c.Type === "Authority" && c.Data)) out.push("certificate not stored");
            }
            return out;
        });
        if (cert) {
            await refuse({ ops: [{ op: "addCertificate", file: "edits/zz-ca.crt" }] }, /already has this certificate/, "the same certificate twice");
            await block("M9 deleteCertificate by subject", { ops: [{ op: "deleteCertificate", certificate: "ZzCode Test CA" }] }, p => {
                for (const id of p.units.keys()) {
                    const u = p.read(id);
                    if (u.$Type === "Settings$ProjectSettings" && ((u.Settings || []).find(x => x.$Type === "Settings$CertificateSettings") || { Certificates: [] }).Certificates.length) return ["certificate not deleted"];
                }
                return [];
            });
        }
    }

    // ---- M12 navigation profiles: change options, delete
    if (want("M12")) {
        const navOf = p => {
            for (const id of p.units.keys()) if (p.read(id).$Type === "Navigation$NavigationDocument") return p.read(id);
            return { Profiles: [] };
        };
        const profiles = navOf(s2.ctx.project).Profiles || [];
        const native = profiles.find(p => p.$Type === "Navigation$NativeNavigationProfile");
        await refuse({ ops: [{ op: "deleteNavigationProfile", profile: "Responsive" }] }, /REFUSED: the Responsive profile/, "deleting the Responsive profile");
        await refuse({ ops: [{ op: "changeNavigationProfile", profile: "Responsive", ota: true }] }, /option of the native profile/, "a native option on a web profile");
        // one profile per device type (Phone and PhoneOffline are the same device)
        const kind = ["Phone", "Tablet"].find(k => !profiles.some(p => String(p.Kind || "").startsWith(k)));
        if (!kind) results.push("SKIP M12 deleteNavigationProfile: this project has a phone and a tablet profile");
        if (kind) await block(`M12 setup: a ${kind} profile`, { ops: [{ op: "createNavigationProfile", kind }] }, () => []);
        await block(`M12 navigation profiles: createNavigationProfile + deleteNavigationProfile (${kind || "none free"})${native ? ", changeNavigationProfile native options (OTA, logging, timeout, transition)" : ""}`, { ops: [
            ...(kind ? [{ op: "deleteNavigationProfile", profile: kind }] : []),
            ...(native ? [{ op: "changeNavigationProfile", profile: native.Name, ota: true, logging: false, networkTimeoutMs: 20000, screenTransition: "SlideFromRightIOS" }] : [])
        ] }, p => {
            const ps = navOf(p).Profiles || [];
            const out = [];
            if (kind && ps.some(x => x.Kind === kind)) out.push(`${kind} profile not deleted`);
            const n = native && ps.find(x => x.Name === native.Name);
            if (native && (!n || n.OtaEnabled !== true || n.NetworkTimeoutMs !== 20000)) out.push(`native profile stored as ${n && n.OtaEnabled} ${n && n.NetworkTimeoutMs}`);
            return out;
        });
        if (!native) results.push("SKIP M12 native options: this project has no native profile");
    }
    // ---- M6 exportModulePackage (round trip: import into a fresh copy) and M7 updateModulePackage
    if (want("M6")) {
        const P = `${C}P`;
        await block("M6 setup: a module with an entity, a microflow, a Java and a JavaScript action", { ops: [
            { op: "createModule", name: P, roles: ["User"] },
            { op: "createEntity", module: P, name: "Item", attributes: [{ name: "Code", type: "String(20)" }] },
            { op: "createMicroflow", module: P, name: "Flow", actions: [{ action: "log", message: "p" }] },
            { op: "createJavaAction", module: P, name: "JA", parameters: [{ name: "N", type: "Integer" }], returns: "Boolean", code: "return N > 0;", compile: false },
            { op: "createJavaScriptAction", module: P, name: "JS", returns: "String" }
        ] }, () => []);
        await refuse({ ops: [{ op: "createConstant", module: P, name: "Tmp", type: "String", default: "x" }, { op: "exportModulePackage", module: P }] }, /earlier ops of this change modify/, "exporting a module the same change modifies");
        await refuse({ ops: [{ op: "exportModulePackage", module: P, file: "packages/x.zip" }] }, /must end in \.mpk/, "an export file that is not .mpk");
        const pk = n => path.join(path.dirname(copy), "packages", n);
        await block("M6 exportModulePackage: the module's units + javasource / javascriptsource files into packages/<file>.mpk (readable by importModulePackage's reader)", { ops: [
            { op: "exportModulePackage", module: P, file: "packages/P1.mpk" }
        ] }, () => {
            if (!fs.existsSync(pk("P1.mpk"))) return ["packages/P1.mpk missing"];
            const pkg = require("./marketplace").readPackage(pk("P1.mpk"));
            const want2 = [`javasource/${P.toLowerCase()}/actions/JA.java`, `javascriptsource/${P.toLowerCase()}/actions/JS.js`];
            return pkg.kind === "module" && pkg.name === P && want2.every(f => pkg.files.includes(f)) ? [] : [`P1.mpk: ${pkg.kind} ${pkg.name}, files ${pkg.files.join(", ")}`];
        });
        await block("M7 setup: version 2 of the module (a constant added, the microflow deleted), exported", { ops: [
            { op: "createConstant", module: P, name: "K", type: "String", default: "v2" },
            { op: "delete", target: `${P}.Flow` }
        ] }, () => []);
        await block("M7 setup: export version 2", { ops: [{ op: "exportModulePackage", module: P, file: "packages/P2.mpk" }] }, () => (fs.existsSync(pk("P2.mpk")) ? [] : ["P2.mpk missing"]));
        // a fresh copy of the project gets version 1, then the update
        const c2 = path.join(path.dirname(copy), "c2");
        fs.mkdirSync(path.join(c2, "edits"), { recursive: true });
        fs.copyFileSync(x.src.mpr, path.join(c2, path.basename(copy)));
        fs.cpSync(x.src.contents, path.join(c2, "mprcontents"), { recursive: true });
        for (const n of ["P1.mpk", "P2.mpk"]) if (fs.existsSync(pk(n))) fs.copyFileSync(pk(n), path.join(c2, "edits", n));
        const copy2 = path.join(c2, path.basename(copy));
        const reopen2 = async c => {
            const s = await x.reopen(c);
            s.client.changeFile = path.join(c2, "edits", "zz-code.json");
            return s;
        };
        const env2 = { reopen: reopen2, copy: copy2, layout, layoutProblems };
        let s3 = await reopen2(copy2);
        let r = await integ.runPhase(env2, s3, { ops: [{ op: "importModulePackage", file: "edits/P1.mpk" }] }, p => {
            const out = [];
            if (!integ.unitsNamed(p, "JA").JA || !integ.unitsNamed(p, "Flow").Flow) out.push("JA / Flow not imported");
            if (!fs.existsSync(path.join(c2, "javasource", P.toLowerCase(), "actions", "JA.java"))) out.push("JA.java not imported");
            return out;
        });
        s3 = r.s;
        check("M6 round trip: the exported .mpk imports into a fresh copy of the project (importModulePackage): units and files, reopen 0 errors, 0 deltas", !r.problems.length, r.problems.slice(0, 5).join("; "));
        let msg = "";
        try {
            await s3.ops.runPlan({ ops: [{ op: "updateModulePackage", file: "edits/P2.mpk" }] }, () => {});
        } catch (e) {
            msg = e.message;
        }
        const report = /REFUSED \(nothing changed\)[\s\S]*1 added, 1 removed[\s\S]*ADDED: Constant K[\s\S]*REMOVED: Microflow Flow[\s\S]*"replace": true/.test(msg);
        s3 = await reopen2(copy2);
        r = await integ.runPhase(env2, s3, { ops: [{ op: "updateModulePackage", file: "edits/P2.mpk", replace: true }] }, p => {
            const out = [];
            const k = [...p.units.keys()].some(id => p.read(id).$Type === "Constants$Constant" && p.read(id).Name === "K" && moduleOf(p, id) === P);
            const flow = [...p.units.keys()].some(id => p.read(id).Name === "Flow" && moduleOf(p, id) === P);
            if (!k) out.push("K not added");
            if (flow) out.push("Flow not removed");
            return out;
        });
        check("M7 updateModulePackage: the dry run lists added / removed / changed documents and is refused without replace; with replace the module is replaced (reopen 0 errors, 0 deltas)", report && !r.problems.length, [...(report ? [] : [`report: ${msg.slice(0, 300)}`]), ...r.problems].slice(0, 5).join("; "));
        fs.rmSync(c2, { recursive: true, force: true });
    }
    return s2;
}

module.exports = { codePhase, domainOf };
