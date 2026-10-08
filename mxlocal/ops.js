"use strict";
// High-level, tested model changes. An agent fills in a change.json ({ "ops": [...] }) instead of writing Model SDK
// code; every op validates its fields, explains mistakes ("did you mean"), and can check itself after apply.
const sdk = require("mendixmodelsdk");

const { domainmodels: dm, microflows: mf, datatypes, enumerations, texts, security, projects, constants, scheduledevents, rest } = sdk;
const { ATTRIBUTE_TYPES, DATA_TYPES, suggest, fail, validate, bool, noDollar, enumValue } = require("./ops-util");


// ---------------------------------------------------------------- op catalog (also the 'ops' help text)


const { makeFlows, ACTIONS, CONTROL, COMMON } = require("./ops-flows");
const { makePages, PAGE_FIELDS } = require("./ops-pages");

const OPS = {
    createEntity: {
        doc: "Create an entity in a module's domain model.",
        fields: { module: "R module name", name: "R entity name", persistable: "optional true/false (default true)", generalization: "optional Module.ParentEntity", attributes: "optional [ { \"name\": ..., \"type\": ..., \"default\": ... } ]" }
    },
    addAttribute: { doc: "Add an attribute to an entity.", fields: { entity: "R Module.Entity", name: "R attribute name", type: "R " + ATTRIBUTE_TYPES, default: "optional default value (as Studio Pro shows it)" } },
    changeAttribute: { doc: "Change the type and/or default of an attribute.", fields: { attribute: "R Module.Entity.Attribute", type: "optional new type", default: "optional new default value" } },
    addAssociation: {
        doc: "Add an association. 'from' stores the reference: many 'from' objects point to one 'to' object (Reference), or to many (ReferenceSet).",
        fields: { from: "R Module.Entity (owner side)", to: "R Module.Entity or OtherModule.Entity", name: "optional (default From_To)", type: "optional Reference | ReferenceSet (default Reference)", owner: "optional Default | Both" }
    },
    createEnumeration: { doc: "Create an enumeration.", fields: { module: "R module name", name: "R enumeration name", values: "R [ \"Value\" or { \"name\": ..., \"caption\": ... } ]", folder: "optional folder path, e.g. Enums/Order" } },
    addEnumerationValue: { doc: "Add a value to an enumeration.", fields: { enumeration: "R Module.Enumeration", name: "R value name", caption: "optional caption (default the name)" } },
    createModuleRole: { doc: "Create a module role.", fields: { module: "R module name", name: "R role name", description: "optional" } },
    grantAccess: { doc: "Allow module roles to run a microflow/nanoflow or open a page.", fields: { document: "R Module.Microflow or Module.Page", roles: "R [ \"Module.Role\" ]" } },
    addAccessRule: {
        doc: "Add an entity access rule. Members not listed in 'members' get 'access'.",
        fields: { entity: "R Module.Entity", roles: "R [ \"Module.Role\" ]", access: "optional ReadWrite | ReadOnly | None (default ReadOnly)", members: "optional { \"Attribute\": \"ReadWrite\", \"Module.Assoc\": \"ReadOnly\" }", create: "optional true/false", delete: "optional true/false", xpath: "optional XPath, e.g. [Owner = '[%CurrentUser%]']" }
    },
    createMicroflow: {
        doc: "Create a microflow: start -> actions (with if/loop/onError) -> end.",
        fields: { module: "R module name", name: "R microflow name", folder: "optional folder path", parameters: "optional [ { \"name\": ..., \"type\": " + JSON.stringify(DATA_TYPES) + " } ]", returns: "optional return type (default nothing)", returnValue: "required when returns is set: return expression", actions: "optional [ actions, see ACTIONS ]", roles: "optional [ \"Module.Role\" ]" }
    },
    createNanoflow: {
        doc: "Create a nanoflow (runs in the browser/app). Same fields and actions as createMicroflow; no 'log'.",
        fields: { module: "R module name", name: "R nanoflow name", folder: "optional folder path", parameters: "optional [ { \"name\": ..., \"type\": ... } ]", returns: "optional return type", returnValue: "required when returns is set", actions: "optional [ actions ]", roles: "optional [ \"Module.Role\" ]" }
    },
    addActions: {
        doc: "Insert actions into an existing microflow or nanoflow. Default: just before the end event (needs exactly one end event).",
        fields: { microflow: "R Module.Microflow or Module.Nanoflow", after: "optional \"start\", the variable name an existing step creates, or a step id (see: steps)", actions: "R [ actions ]" }
    },
    changeAction: {
        doc: "Change one existing step. Get its id with: steps Module.Flow. Give only the fields to change.",
        fields: {
            microflow: "R Module.Microflow or Module.Nanoflow", id: "R step id from 'steps', e.g. 3f2a9c1b",
            xpath: "retrieve: new XPath", first: "retrieve: true/false", entity: "retrieve: Module.Entity",
            set: "create/change: { \"Attr\": \"expression\" } (adds or replaces)", unset: "create/change: [ \"Attr\" ] to remove",
            commit: "create/change: true/false", refresh: "change/commit: true/false", events: "commit: true/false",
            args: "call: { \"Param\": \"expression\" }", message: "log: text", level: "log: level", text: "message: text",
            type: "message: Information | Warning | Error", blocking: "message: true/false", value: "variable/set/end: expression",
            condition: "decision: expression", caption: "decision or action: caption", disabled: "action: true/false",
            while: "while loop: expression", over: "list loop: list variable"
        }
    },
    deleteAction: { doc: "Delete one action or loop from a flow and reconnect the line. Get its id with: steps Module.Flow.", fields: { microflow: "R Module.Microflow or Module.Nanoflow", id: "R step id from 'steps'" } },
    setGeneralization: { doc: "Make an entity inherit from another entity, or from none.", fields: { entity: "R Module.Entity", generalization: "R Module.Parent, or \"\" / \"none\" for no parent", persistable: "optional true/false when there is no parent (default true)" } },
    addValidationRule: {
        doc: "Add a validation rule to an attribute.",
        fields: { entity: "R Module.Entity", attribute: "R attribute name", rule: "R required | unique | maxLength | range | regex | equals", message: "R error message shown to the user", maxLength: "maxLength: number", min: "range: minimum value", max: "range: maximum value", regex: "regex: Module.RegularExpression", value: "equals: value" }
    },
    addEventHandler: {
        doc: "Run a microflow before/after an entity is created, committed, deleted or rolled back.",
        fields: { entity: "R Module.Entity", moment: "R Before | After", event: "R Create | Commit | Delete | RollBack", microflow: "R Module.Microflow (one parameter of the entity when passObject is true; returns Boolean for Before)", passObject: "optional true/false (default true)", raiseErrorOnFalse: "optional true/false (Before only, default true)" }
    },
    addIndex: { doc: "Add a database index.", fields: { entity: "R Module.Entity", attributes: "R [ \"Attr\" or { \"name\": \"Attr\", \"ascending\": false } ]" } },
    createConstant: { doc: "Create a constant.", fields: { module: "R module name", name: "R constant name", type: "R String | Integer | Long | Decimal | Boolean | DateTime", default: "R default value as text, e.g. 'https://...' is written without quotes: https://...", exposedToClient: "optional true/false (default false)", folder: "optional folder path" } },
    createScheduledEvent: {
        doc: "Run a microflow (without parameters) on a schedule.",
        fields: { module: "R module name", name: "R event name", microflow: "R Module.Microflow", every: "R Minute | Hour | Day | Week", interval: "optional number for Minute/Hour (default 1)", at: "optional time HH:MM for Day/Week, minutes MM for Hour (default 00:00)", days: "Week: [ \"Monday\", ... ]", enabled: "optional true/false (default false)", timeZone: "optional UTC | Server (default UTC)", onOverlap: "optional DelayNext | SkipNext (default DelayNext)", folder: "optional folder path" }
    },
    createPage: { doc: "Create a page: an edit form for an entity (inputs by attribute type, Save/Cancel), or an empty page. Uses the layout the project's other pages use.", fields: PAGE_FIELDS },
    publishRest: {
        doc: "Publish a microflow as a REST operation (creates the service and resource when missing). Microflow parameters become path parameters when the path has {Name}, otherwise query parameters. Object parameters/results need mappings: do those in Studio Pro.",
        fields: { module: "R module name", service: "R service name, e.g. OrderAPI", resource: "R resource name, e.g. orders", method: "R Get | Post | Put | Patch | Delete", microflow: "R Module.Microflow", path: "optional operation path, e.g. {OrderId} (default empty)", servicePath: "optional base path for a new service (default rest/<service>/v1)", authentication: "optional [ \"Basic\" | \"Session\" | \"Microflow\" | \"None\" ] for a new service (default [\"Basic\"])", roles: "optional [ \"Module.Role\" ] allowed to call the service", folder: "optional folder path for a new service" }
    },
    moveDocument: { doc: "Move a document to another folder of the same module.", fields: { document: "R Module.Document", folder: "optional folder path, e.g. Orders/Actions (missing or \"\" = the module root)" } },
    rename: { doc: "Rename a module, document, entity, attribute, association or enumeration value. Updates references, reports names left in expressions/XPath/Java.", fields: { target: "R qualified name, e.g. Module.Entity.Attribute", newName: "R new short name" } },
    delete: { doc: "Delete a document, entity, attribute, association, enumeration value or module role. Lists what still uses it.", fields: { target: "R qualified name" } }
};

function help() {
    const lines = ["OPERATIONS for change.json: { \"ops\": [ { \"op\": \"<name>\", ...fields } ] }   (R = required)", ""];
    for (const [name, o] of Object.entries(OPS)) {
        lines.push(`${name}: ${o.doc}`);
        for (const [f, d] of Object.entries(o.fields)) lines.push(`    ${f}: ${d}`);
    }
    lines.push("", "ACTIONS (inside \"actions\": [ { \"action\": \"<name>\", ...fields } ]):");
    for (const [name, o] of Object.entries(ACTIONS)) {
        lines.push(`${name}: ${o.doc}`);
        for (const [f, d] of Object.entries(o.fields)) lines.push(`    ${f}: ${d}`);
    }
    lines.push("Every action above also takes:");
    for (const [f, d] of Object.entries(COMMON)) lines.push(`    ${f}: ${d}`);
    lines.push("", "FLOW CONTROL (also inside \"actions\"):");
    for (const [name, o] of Object.entries(CONTROL)) {
        lines.push(`${name}: ${o.doc}`);
        for (const [f, d] of Object.entries(o.fields)) lines.push(`    ${f}: ${d}`);
    }
    lines.push("", "Expressions are Mendix expressions as text: \"'Hello'\", \"$Order/Total * 2\", \"empty\", \"[%CurrentDateTime%]\".");
    lines.push("Anything not covered here: write a change.js with the Model SDK (use: api <Type>).");
    return lines.join("\n");
}

// ---------------------------------------------------------------- bound operations

function bind(model, client) {
    let names = null;
    const allNames = () => {
        if (!names) names = [...new Set(require("./inspect").names(client).map(x => x.qn))];
        return names;
    };
    const language = (() => {
        let code = null;
        return async () => {
            if (code) return code;
            const settings = model.allProjectSettings()[0];
            const loaded = settings && (await settings.load());
            const lang = loaded && loaded.settingsParts.find(p => p instanceof sdk.settings.LanguageSettings);
            code = (lang && lang.defaultLanguageCode) || "en_US";
            return code;
        };
    })();

    function moduleNamed(name) {
        const m = model.allModules().find(x => x.name === name);
        if (!m) fail(`Module '${name}' not found`, name, model.allModules().map(x => x.name));
        return m;
    }

    // Any document or element by qualified name, loaded and ready to change.
    async function get(qn) {
        if (typeof qn !== "string" || !qn.trim()) throw new Error(`Expected a qualified name like "Module.Name", got ${JSON.stringify(qn)}`);
        qn = qn.trim();
        if (!qn.includes(".")) return moduleNamed(qn);
        const unit = model.allUnits().find(u => {
            try {
                return u.qualifiedName === qn;
            } catch (e) {
                return false;
            }
        });
        if (unit) return unit.load();
        for (const finder of ["findEntityByQualifiedName", "findAttributeByQualifiedName", "findAssociationBaseByQualifiedName",
            "findEnumerationValueByQualifiedName", "findModuleRoleByQualifiedName", "findMicroflowParameterByQualifiedName"]) {
            const x = model[finder](qn);
            if (x) return x.load();
        }
        return fail(`'${qn}' not found in the model`, qn, allNames());
    }

    async function exists(qn) {
        try {
            await get(qn);
            return true;
        } catch (e) {
            return false;
        }
    }

    async function domainModel(moduleName) {
        const d = model.allDomainModels().find(x => x.containerAsModule.name === moduleName);
        if (!d) moduleNamed(moduleName);
        return d.load();
    }

    async function moduleSecurity(moduleName) {
        const s = model.allModuleSecurities().find(x => x.containerAsModule.name === moduleName);
        if (!s) moduleNamed(moduleName);
        return s.load();
    }

    async function entity(qn) {
        const e = await get(qn);
        if (!(e instanceof dm.Entity)) throw new Error(`'${qn}' is not an entity`);
        return e;
    }

    // "Folder/Sub" under a module; created when missing.
    function folder(moduleName, path) {
        let cur = moduleNamed(moduleName);
        for (const part of String(path || "").split(/[/\\]/).filter(Boolean)) {
            let next = cur.folders.find(f => f.name === part);
            if (!next) {
                next = projects.Folder.createIn(cur);
                next.name = part;
            }
            cur = next;
        }
        return cur;
    }

    async function text(owner, value) {
        const t = owner instanceof texts.Text ? owner : null;
        if (!t) throw new Error("internal: text() needs a Texts$Text");
        const items = typeof value === "object" && value ? value : { [await language()]: String(value) };
        for (const [code, v] of Object.entries(items)) {
            let tr = t.translations.find(x => x.languageCode === code);
            if (!tr) {
                tr = texts.Translation.createIn(t);
                tr.languageCode = code;
            }
            tr.text = String(v);
        }
    }

    async function attributeType(attr, spec) {
        const m = /^\s*([A-Za-z]+)\s*(?:\(\s*([^)]*?)\s*\))?\s*$/.exec(String(spec));
        if (!m) throw new Error(`Bad attribute type '${spec}'. Use ${ATTRIBUTE_TYPES}`);
        const kind = m[1].toLowerCase();
        const arg = m[2];
        let t;
        let dflt = "";
        switch (kind) {
            case "string":
                t = dm.StringAttributeType.createInAttributeUnderType(attr);
                t.length = !arg ? 200 : /^unlimited$/i.test(arg) ? 0 : Number(arg);
                if (Number.isNaN(t.length)) throw new Error(`Bad string length in '${spec}'`);
                break;
            case "integer":
                t = dm.IntegerAttributeType.createInAttributeUnderType(attr);
                dflt = "0";
                break;
            case "long":
                t = dm.LongAttributeType.createInAttributeUnderType(attr);
                dflt = "0";
                break;
            case "decimal":
                t = dm.DecimalAttributeType.createInAttributeUnderType(attr);
                dflt = "0";
                break;
            case "boolean":
                t = dm.BooleanAttributeType.createInAttributeUnderType(attr);
                dflt = "false";
                break;
            case "datetime":
                t = dm.DateTimeAttributeType.createInAttributeUnderType(attr);
                t.localizeDate = true;
                break;
            case "autonumber":
                t = dm.AutoNumberAttributeType.createInAttributeUnderType(attr);
                dflt = "1";
                break;
            case "hashedstring":
                t = dm.HashedStringAttributeType.createInAttributeUnderType(attr);
                break;
            case "binary":
                t = dm.BinaryAttributeType.createInAttributeUnderType(attr);
                break;
            case "enum":
            case "enumeration": {
                if (!arg) throw new Error(`Enum type needs the enumeration: Enum(Module.Enumeration)`);
                const en = await get(arg);
                if (!(en instanceof enumerations.Enumeration)) throw new Error(`'${arg}' is not an enumeration`);
                t = dm.EnumerationAttributeType.createInAttributeUnderType(attr);
                t.enumeration = en;
                break;
            }
            default:
                fail(`Unknown attribute type '${spec}'. Use ${ATTRIBUTE_TYPES}`, m[1], ["String", "Integer", "Long", "Decimal", "Boolean", "DateTime", "AutoNumber", "HashedString", "Binary", "Enum"]);
        }
        return dflt;
    }

    function setDefault(attr, value) {
        if (!(attr.value instanceof dm.StoredValue)) attr.value = dm.StoredValue.create(model);
        attr.value.defaultValue = String(value);
    }

    // Microflow data type from "String", "Module.Entity", "List(Module.Entity)", "Enum(Module.Enum)", ...
    async function dataType(spec) {
        const s = String(spec).trim();
        const m = /^(\w+)\s*\(\s*([\w.]+)\s*\)$/.exec(s);
        const simple = {
            string: datatypes.StringType, integer: datatypes.IntegerType, long: datatypes.IntegerType, decimal: datatypes.DecimalType,
            boolean: datatypes.BooleanType, datetime: datatypes.DateTimeType, void: datatypes.VoidType, nothing: datatypes.VoidType, binary: datatypes.BinaryType
        };
        if (m) {
            const kind = m[1].toLowerCase();
            if (kind === "list") {
                const t = datatypes.ListType.create(model);
                t.entity = await entity(m[2]);
                return t;
            }
            if (kind === "enum" || kind === "enumeration") {
                const t = datatypes.EnumerationType.create(model);
                t.enumeration = await get(m[2]);
                return t;
            }
            if (kind === "object") {
                const t = datatypes.ObjectType.create(model);
                t.entity = await entity(m[2]);
                return t;
            }
        }
        if (simple[s.toLowerCase()]) return simple[s.toLowerCase()].create(model);
        if (s.includes(".")) {
            const t = datatypes.ObjectType.create(model);
            t.entity = await entity(s);
            return t;
        }
        return fail(`Unknown type '${spec}'. Use ${DATA_TYPES}`, s, Object.keys(simple));
    }

    function allAttributes(ent) {
        return attributeChain(ent).attributes;
    }

    // Own + inherited attributes; complete = false when a parent is not in the project (System.User, ...).
    function attributeChain(ent) {
        const attributes = [...ent.attributes];
        let complete = true;
        let g = ent.generalization;
        for (let i = 0; i < 10 && g instanceof dm.Generalization; i++) {
            const parent = g.generalization;
            if (!parent || !parent.isLoaded) {
                complete = false;
                break;
            }
            attributes.push(...parent.attributes);
            g = parent.generalization;
        }
        return { attributes, complete };
    }

    // Load the generalization chain so attributeChain can see inherited attributes.
    async function loadParents(ent) {
        let g = ent.generalization;
        for (let i = 0; i < 10 && g instanceof dm.Generalization && g.generalization; i++) {
            const parent = g.generalization.isLoaded ? g.generalization : await g.generalization.load();
            g = parent.generalization;
        }
    }

    const flows = makeFlows({ model, get, entity, text, dataType, attributeChain, loadParents });
    const pageOps = makePages({ model, client, get, exists, entity, text, folder, attributeChain, loadParents });

    // ------------------------------------------------ operations

    async function createFlowOp(o, nano) {
        const qn = `${o.module}.${o.name}`;
        if (await exists(qn)) throw new Error(`${qn} already exists`);
        const { count } = await flows.createFlow(o, nano, folder(o.module, o.folder));
        if (o.roles) await impl.grantAccess({ document: qn, roles: o.roles });
        return `${qn} (${count} action(s))`;
    }

    // Activities (boxes) a list of action specs creates, including nested branches, loops and error handlers.
    function countActivities(specs) {
        let n = 0;
        for (const sp of specs || []) {
            if (!sp || typeof sp !== "object") continue;
            if (sp.action === "if") n += countActivities(sp.then) + countActivities(sp.else);
            else if (sp.action === "loop") n += countActivities(sp.actions);
            else if (ACTIONS[sp.action]) n += 1 + (sp.onError && sp.onError.actions ? countActivities(sp.onError.actions) : 0);
        }
        return n;
    }

    function createdVariables(specs, out = []) {
        for (const sp of specs || []) {
            if (!sp || typeof sp !== "object") continue;
            if (["retrieve", "create", "call"].includes(sp.action) && sp.variable) out.push(sp.variable);
            if (sp.action === "variable") out.push(sp.name);
            if (sp.action === "loop" && sp.over) out.push(sp.item || `${noDollar(sp.over)}Item`);
            createdVariables(sp.then, out);
            createdVariables(sp.else, out);
            createdVariables(sp.actions, out);
            if (sp.onError && sp.onError.actions) createdVariables(sp.onError.actions, out);
        }
        return out;
    }

    const impl = {
        async createEntity(o) {
            const d = await domainModel(o.module);
            if (d.entities.some(e => e.name === o.name)) throw new Error(`${o.module}.${o.name} already exists`);
            const e = dm.Entity.createIn(d);
            e.name = o.name;
            const xs = d.entities.filter(x => x !== e).map(x => x.location.x);
            e.location = { x: xs.length ? Math.max(...xs) + 250 : 100, y: 100 };
            if (o.generalization) {
                const g = dm.Generalization.createIn(e);
                g.generalization = await entity(o.generalization);
            } else if (e.generalization instanceof dm.NoGeneralization) e.generalization.persistable = bool(o.persistable, true);
            const attrSpec = { fields: { name: "R attribute name", type: "R " + ATTRIBUTE_TYPES, default: "optional default value" } };
            for (const [i, a] of (o.attributes || []).entries()) {
                validate("-", "attribute", attrSpec, a || {}, `${o.module}.${o.name} attribute ${i + 1}`);
                await impl.addAttribute({ entity: `${o.module}.${o.name}`, ...a }, e);
            }
            return `${o.module}.${o.name}`;
        },
        async addAttribute(o, loaded) {
            const e = loaded || (await entity(o.entity));
            if (!o.name || !o.type) throw new Error(`addAttribute needs name and type (${o.entity})`);
            if (e.attributes.some(a => a.name === o.name)) throw new Error(`${o.entity}.${o.name} already exists`);
            const a = dm.Attribute.createIn(e);
            a.name = o.name;
            const dflt = await attributeType(a, o.type);
            setDefault(a, o.default !== undefined ? o.default : dflt);
            return `${o.entity}.${o.name}: ${o.type}`;
        },
        async changeAttribute(o) {
            const a = await get(o.attribute);
            if (!(a instanceof dm.Attribute)) throw new Error(`'${o.attribute}' is not an attribute`);
            if (o.type === undefined && o.default === undefined) throw new Error("changeAttribute needs 'type' and/or 'default'");
            if (o.type !== undefined) {
                const dflt = await attributeType(a, o.type);
                if (o.default === undefined) setDefault(a, dflt);
            }
            if (o.default !== undefined) setDefault(a, o.default);
            return o.attribute;
        },
        async addAssociation(o) {
            const from = await entity(o.from);
            const to = await entity(o.to);
            const d = from.containerAsDomainModel;
            const name = o.name || `${from.name}_${to.name}`;
            if (d.associations.some(a => a.name === name) || d.crossAssociations.some(a => a.name === name)) throw new Error(`${o.from.split(".")[0]}.${name} already exists`);
            const cross = to.containerAsDomainModel !== d;
            const a = cross ? dm.CrossAssociation.createIn(d) : dm.Association.createIn(d);
            a.name = name;
            a.parent = from;
            a.child = to;
            a.type = enumValue(dm.AssociationType, o.type || "Reference", "association type");
            a.owner = enumValue(dm.AssociationOwner, o.owner || "Default", "association owner");
            return `${o.from.split(".")[0]}.${name}: ${o.from} -> ${o.to}`;
        },
        async createEnumeration(o) {
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const en = enumerations.Enumeration.createIn(folder(o.module, o.folder));
            en.name = o.name;
            if (!Array.isArray(o.values) || !o.values.length) throw new Error(`createEnumeration ${qn} needs values: ["A", "B"]`);
            for (const v of o.values) {
                const val = enumerations.EnumerationValue.createIn(en);
                val.name = typeof v === "string" ? v : v.name;
                await text(val.caption, typeof v === "string" ? v : v.caption || v.name);
            }
            return qn;
        },
        async addEnumerationValue(o) {
            const en = await get(o.enumeration);
            if (!(en instanceof enumerations.Enumeration)) throw new Error(`'${o.enumeration}' is not an enumeration`);
            if (en.values.some(v => v.name === o.name)) throw new Error(`${o.enumeration}.${o.name} already exists`);
            const val = enumerations.EnumerationValue.createIn(en);
            val.name = o.name;
            await text(val.caption, o.caption || o.name);
            return `${o.enumeration}.${o.name}`;
        },
        async createModuleRole(o) {
            const s = await moduleSecurity(o.module);
            if (s.moduleRoles.some(r => r.name === o.name)) throw new Error(`${o.module}.${o.name} already exists`);
            const r = security.ModuleRole.createIn(s);
            r.name = o.name;
            r.description = o.description || "";
            return `${o.module}.${o.name}`;
        },
        async grantAccess(o) {
            const doc = await get(o.document);
            const list = doc.allowedModuleRoles || doc.allowedRoles; // microflows/nanoflows | pages
            if (!list) throw new Error(`'${o.document}' has no allowed roles (only microflows, nanoflows, pages)`);
            for (const qn of [].concat(o.roles)) {
                const r = await get(qn);
                if (!(r instanceof security.ModuleRole)) throw new Error(`'${qn}' is not a module role`);
                if (!list.includes(r)) list.push(r);
            }
            return `${o.document} <- ${[].concat(o.roles).join(", ")}`;
        },

        async addAccessRule(o) {
            const e = await entity(o.entity);
            await loadParents(e);
            const rule = dm.AccessRule.createInEntityUnderAccessRules(e);
            for (const qn of [].concat(o.roles)) {
                const r = await get(qn);
                if (!(r instanceof security.ModuleRole)) throw new Error(`'${qn}' is not a module role`);
                rule.moduleRoles.push(r);
            }
            const dflt = enumValue(dm.MemberAccessRights, o.access || "ReadOnly", "access");
            rule.defaultMemberAccessRights = dflt;
            rule.allowCreate = bool(o.create, false);
            rule.allowDelete = bool(o.delete, false);
            rule.xPathConstraint = o.xpath || "";
            const members = { ...(o.members || {}) };
            const readOnlyTypes = [dm.AutoNumberAttributeType];
            for (const a of allAttributes(e)) {
                const ma = dm.MemberAccess.createIn(rule);
                ma.attribute = a;
                let r = members[a.name] !== undefined ? enumValue(dm.MemberAccessRights, members[a.name], `access of ${a.name}`) : dflt;
                const readOnly = readOnlyTypes.some(t => a.type instanceof t) || a.value instanceof dm.CalculatedValue;
                if (readOnly && r === dm.MemberAccessRights.ReadWrite) r = dm.MemberAccessRights.ReadOnly;
                ma.accessRights = r;
                delete members[a.name];
            }
            const d = e.containerAsDomainModel;
            for (const assoc of [...d.associations, ...d.crossAssociations].filter(x => x.parent === e)) {
                const ma = dm.MemberAccess.createIn(rule);
                ma.association = assoc;
                const key = Object.keys(members).find(k => k === assoc.name || k === assoc.qualifiedName);
                ma.accessRights = key ? enumValue(dm.MemberAccessRights, members[key], `access of ${key}`) : dflt;
                if (key) delete members[key];
            }
            if (Object.keys(members).length) throw new Error(`addAccessRule ${o.entity}: unknown members ${Object.keys(members).join(", ")}`);
            return `${o.entity} for ${[].concat(o.roles).join(", ")}`;
        },
        async createMicroflow(o) {
            return createFlowOp(o, false);
        },
        async createNanoflow(o) {
            return createFlowOp(o, true);
        },
        addActions: o => flows.addActions(o),
        changeAction: o => flows.changeAction(o),
        deleteAction: o => flows.deleteAction(o),
        async setGeneralization(o) {
            const e = await entity(o.entity);
            const none = !o.generalization || /^none$/i.test(o.generalization);
            if (none) {
                const g = dm.NoGeneralization.createIn(e);
                g.persistable = bool(o.persistable, true);
                return `${o.entity}: no parent`;
            }
            const parent = await entity(o.generalization);
            for (let p = parent, i = 0; p && i < 20; i++) {
                if (p === e) throw new Error(`${o.generalization} already inherits from ${o.entity}: that would be a loop`);
                const g = p.generalization;
                p = g instanceof dm.Generalization && g.generalization ? (g.generalization.isLoaded ? g.generalization : await g.generalization.load()) : null;
            }
            const g = dm.Generalization.createIn(e);
            g.generalization = parent;
            return `${o.entity} inherits from ${o.generalization} (check access rules and pages that use ${o.entity} in Studio Pro)`;
        },
        async addValidationRule(o) {
            const e = await entity(o.entity);
            const attr = e.attributes.find(a => a.name === o.attribute);
            if (!attr) fail(`${o.entity} has no attribute '${o.attribute}'`, o.attribute, e.attributes.map(a => a.name));
            const rules = { required: dm.RequiredRuleInfo, unique: dm.UniqueRuleInfo, maxlength: dm.MaxLengthRuleInfo, range: dm.RangeRuleInfo, regex: dm.RegExRuleInfo, equals: dm.EqualsToRuleInfo };
            const kind = String(o.rule).toLowerCase();
            if (!rules[kind]) fail(`'${o.rule}' is not a rule (use required | unique | maxLength | range | regex | equals)`, o.rule, Object.keys(rules));
            const need = { maxlength: ["maxLength"], range: [], regex: ["regex"], equals: ["value"] }[kind] || [];
            for (const f of need) if (o[f] === undefined) throw new Error(`addValidationRule ${kind} needs '${f}'`);
            if (kind === "range" && o.min === undefined && o.max === undefined) throw new Error("addValidationRule range needs 'min' and/or 'max'");
            const vr = dm.ValidationRule.createIn(e);
            vr.attribute = attr;
            await text(vr.errorMessage, o.message);
            const info = rules[kind].createIn(vr);
            if (kind === "maxlength") info.maxLength = Number(o.maxLength);
            if (kind === "range") {
                info.useMinValue = o.min !== undefined;
                info.useMaxValue = o.max !== undefined;
                if (o.min !== undefined) info.minValue = String(o.min);
                if (o.max !== undefined) info.maxValue = String(o.max);
                info.typeOfRange = o.min !== undefined && o.max !== undefined ? dm.RangeType.Between : o.min !== undefined ? dm.RangeType.GreaterThanOrEqualTo : dm.RangeType.SmallerThanOrEqualTo;
            }
            if (kind === "regex") {
                const re = await get(o.regex);
                if (!(re instanceof sdk.regularexpressions.RegularExpression)) throw new Error(`'${o.regex}' is not a regular expression document`);
                info.regularExpression = re;
            }
            if (kind === "equals") {
                info.useValue = true;
                info.equalsToValue = String(o.value);
            }
            return `${o.entity}.${o.attribute}: ${kind}`;
        },
        async addEventHandler(o) {
            const e = await entity(o.entity);
            const mfl = await get(o.microflow);
            if (!(mfl instanceof mf.Microflow)) throw new Error(`'${o.microflow}' is not a microflow`);
            const moment = enumValue(dm.ActionMoment, o.moment, "moment");
            const event = enumValue(dm.EventType, o.event, "event");
            const pass = bool(o.passObject, true);
            const params = mfl.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject);
            if (pass && params.length !== 1) throw new Error(`${o.microflow} must have exactly one parameter (the ${o.entity} object), it has ${params.length}; or set "passObject": false`);
            if (!pass && params.length) throw new Error(`${o.microflow} has parameters, but passObject is false`);
            if (moment === dm.ActionMoment.Before && !(mfl.microflowReturnType instanceof datatypes.BooleanType)) throw new Error(`a Before handler microflow must return Boolean; ${o.microflow} does not`);
            const eh = dm.EventHandler.createIn(e);
            eh.moment = moment;
            eh.event = event;
            eh.microflow = mfl;
            eh.passEventObject = pass;
            eh.raiseErrorOnFalse = moment === dm.ActionMoment.Before ? bool(o.raiseErrorOnFalse, true) : false;
            return `${o.entity}: ${o.moment} ${o.event} -> ${o.microflow}`;
        },
        async addIndex(o) {
            const e = await entity(o.entity);
            if (!Array.isArray(o.attributes) || !o.attributes.length) throw new Error("addIndex needs attributes: [ \"Attr\" ]");
            const idx = dm.Index.createIn(e);
            for (const spec of o.attributes) {
                const name = typeof spec === "string" ? spec : spec && spec.name;
                const attr = e.attributes.find(a => a.name === name);
                if (!attr) fail(`${o.entity} has no attribute '${name}'`, name, e.attributes.map(a => a.name));
                const ia = dm.IndexedAttribute.createIn(idx);
                ia.type = dm.IndexedAttributeType.Normal;
                ia.attribute = attr;
                ia.ascending = typeof spec === "object" ? bool(spec.ascending, true) : true;
            }
            return `${o.entity}(${o.attributes.map(a => (typeof a === "string" ? a : a.name)).join(", ")})`;
        },
        async createConstant(o) {
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const allowed = ["string", "integer", "long", "decimal", "boolean", "datetime"];
            if (!allowed.includes(String(o.type).toLowerCase())) fail(`constant type '${o.type}' is not allowed`, o.type, ["String", "Integer", "Long", "Decimal", "Boolean", "DateTime"]);
            const c = constants.Constant.createIn(folder(o.module, o.folder));
            c.name = o.name;
            c.type = await dataType(o.type);
            c.defaultValue = String(o.default);
            c.exposedToClient = bool(o.exposedToClient, false);
            return qn;
        },
        async createScheduledEvent(o) {
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const target = await get(o.microflow);
            if (!(target instanceof mf.Microflow)) throw new Error(`'${o.microflow}' is not a microflow`);
            if (target.objectCollection.objects.some(x => x instanceof mf.MicroflowParameterObject)) throw new Error(`${o.microflow} has parameters; a scheduled event needs a microflow without parameters`);
            const unit = String(o.every).toLowerCase();
            const interval = Number(o.interval === undefined ? 1 : o.interval);
            if (!(interval >= 1)) throw new Error("interval must be a number >= 1");
            const at = /^(\d{1,2}):(\d{2})$/.exec(String(o.at || "00:00")) || /^()(\d{1,2})$/.exec(String(o.at));
            if (!at) throw new Error(`'at' must look like 02:30 (or 15 for minutes past the hour), got '${o.at}'`);
            const hour = Number(at[1] || 0);
            const minute = Number(at[2]);
            if (hour > 23 || minute > 59) throw new Error(`'at' ${o.at} is not a valid time`);
            const ev = scheduledevents.ScheduledEvent.createIn(folder(o.module, o.folder));
            ev.name = o.name;
            ev.microflow = target;
            ev.enabled = bool(o.enabled, false);
            ev.timeZone = enumValue(scheduledevents.TimeZoneEnum, o.timeZone || "UTC", "timeZone");
            ev.onOverlap = enumValue(scheduledevents.OverlapStrategy, o.onOverlap || "DelayNext", "onOverlap");
            const se = scheduledevents;
            if (unit === "minute") {
                se.MinuteSchedule.createIn(ev).multiplier = interval;
                ev.interval = interval;
                ev.intervalType = se.IntervalType.Minute;
            } else if (unit === "hour") {
                const s = se.HourSchedule.createIn(ev);
                s.multiplier = interval;
                s.minuteOffset = minute;
                ev.interval = interval;
                ev.intervalType = se.IntervalType.Hour;
            } else if (unit === "day") {
                const s = se.DaySchedule.createIn(ev);
                s.hourOfDay = hour;
                s.minuteOfHour = minute;
                ev.interval = 1;
                ev.intervalType = se.IntervalType.Day;
            } else if (unit === "week") {
                const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                const days = [].concat(o.days || []).map(d => String(d).toLowerCase());
                if (!days.length) throw new Error("every Week needs days: [ \"Monday\", ... ]");
                const s = se.WeekSchedule.createIn(ev);
                for (const d of days) {
                    if (!names.includes(d)) fail(`'${d}' is not a weekday`, d, names);
                    s[d] = true;
                }
                s.hourOfDay = hour;
                s.minuteOfHour = minute;
                ev.interval = 1;
                ev.intervalType = se.IntervalType.Week;
            } else fail(`'every' must be Minute | Hour | Day | Week, got '${o.every}'`, o.every, ["Minute", "Hour", "Day", "Week"]);
            return `${qn}: every ${unit === "minute" || unit === "hour" ? interval + " " : ""}${unit}${unit === "day" || unit === "week" ? " at " + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") : ""} -> ${o.microflow}${ev.enabled ? "" : " (disabled)"}`;
        },
        createPage: async o => {
            const r = await pageOps.createPage(o);
            if (o.roles) await impl.grantAccess({ document: `${o.module}.${o.name}`, roles: o.roles });
            return r;
        },
        async publishRest(o) {
            const mfl = await get(o.microflow);
            if (!(mfl instanceof mf.Microflow)) throw new Error(`'${o.microflow}' is not a microflow`);
            const special = t => t && t.entity && ["System.HttpRequest", "System.HttpResponse"].includes(t.entityQualifiedName);
            const ret = mfl.microflowReturnType;
            if (ret && (ret instanceof datatypes.ObjectType || ret instanceof datatypes.ListType) && !special(ret)) throw new Error(`${o.microflow} returns an object/list; that needs an export mapping. Return a String or System.HttpResponse, or publish it in Studio Pro`);
            const qn = `${o.module}.${o.service}`;
            let svc;
            if (await exists(qn)) {
                svc = await get(qn);
                if (!(svc instanceof rest.PublishedRestService)) throw new Error(`${qn} exists and is not a published REST service`);
            } else {
                svc = rest.PublishedRestService.createIn(folder(o.module, o.folder));
                svc.name = o.service;
                svc.serviceName = o.service;
                svc.version = "1.0.0";
                svc.path = o.servicePath || `rest/${o.service.toLowerCase()}/v1`;
                svc.authenticationTypes.clear();
                for (const a of [].concat(o.authentication || ["Basic"])) svc.authenticationTypes.push(enumValue(rest.RestAuthenticationType, a, "authentication"));
            }
            for (const r of [].concat(o.roles || [])) {
                const role = await get(r);
                if (!(role instanceof security.ModuleRole)) throw new Error(`'${r}' is not a module role`);
                if (!svc.allowedRoles.includes(role)) svc.allowedRoles.push(role);
            }
            let res = svc.resources.find(x => x.name === o.resource);
            if (!res) {
                res = rest.PublishedRestServiceResource.createIn(svc);
                res.name = o.resource;
            }
            const method = enumValue(sdk.services.HttpMethod, o.method, "method");
            const path = String(o.path || "");
            if (res.operations.some(x => x.httpMethod === method && x.path === path)) throw new Error(`${qn}/${o.resource}: ${o.method} '${path}' already exists`);
            const op = rest.PublishedRestServiceOperation.createIn(res);
            op.httpMethod = method;
            op.path = path;
            op.microflow = mfl;
            op.commit = mf.CommitEnum.No;
            const inPath = new Set([...path.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
            for (const p of mfl.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject)) {
                const t = p.variableType;
                if (special(t)) continue; // System.HttpRequest/HttpResponse are passed by the runtime
                if (t instanceof datatypes.ObjectType || t instanceof datatypes.ListType) throw new Error(`${o.microflow} parameter '${p.name}' is an object/list; that needs an import mapping. Publish it in Studio Pro`);
                const rp = rest.RestOperationParameter.createInPublishedRestServiceOperationUnderParameters(op);
                rp.name = p.name;
                rp.microflowParameter = p;
                rp.parameterType = inPath.has(p.name) ? rest.RestOperationParameterType.Path : rest.RestOperationParameterType.Query;
                const copy = sdk.datatypes[t.structureTypeName.split("$")[1]].create(model);
                if (copy instanceof datatypes.EnumerationType) copy.enumeration = t.enumeration;
                rp.type = copy;
                inPath.delete(p.name);
            }
            if (inPath.size) throw new Error(`path has {${[...inPath].join("}, {")}} but ${o.microflow} has no such parameter`);
            return `${qn}: ${o.method.toUpperCase()} /${svc.path}/${o.resource}${path ? "/" + path : ""} -> ${o.microflow} (experimental: check in Studio Pro)`;
        },
        async moveDocument(o) {
            const doc = await get(o.document);
            if (!(doc instanceof projects.Document)) throw new Error(`'${o.document}' is not a document`);
            const module = o.document.split(".")[0];
            const target = folder(module, o.folder);
            client.moveUnit(doc.id, target.id, "Documents");
            return `${o.document} -> ${module}${o.folder ? "/" + o.folder : " (module root)"}`;
        },
        async rename(o) {
            const el = await get(o.target);
            if (!("name" in el)) throw new Error(`'${o.target}' cannot be renamed`);
            if (/[^A-Za-z0-9_]/.test(o.newName) || /^\d/.test(o.newName)) throw new Error(`'${o.newName}' is not a valid Mendix name (letters, digits, _; no leading digit)`);
            el.name = o.newName;
            return `${o.target} -> ${o.newName}`;
        },
        async delete(o) {
            const el = await get(o.target);
            const users = client.referencesTo(o.target);
            el.delete();
            return `${o.target}` + (users.length ? `\n      STILL USED BY (fix these, or Studio Pro shows errors): ${users.join(", ")}` : "");
        }
    };

    // ------------------------------------------------ checks (run after apply on a freshly loaded model)

    const typeName = t => t && t.structureTypeName.split("$")[1].replace("AttributeType", "");
    const checks = {
        async createEntity(o) {
            const e = await entity(`${o.module}.${o.name}`);
            const missing = (o.attributes || []).filter(a => !e.attributes.some(x => x.name === a.name));
            return missing.length ? [`${o.module}.${o.name} lacks attributes ${missing.map(a => a.name).join(", ")}`] : [];
        },
        async addAttribute(o) {
            const a = await get(`${o.entity}.${o.name}`);
            const want = String(o.type).replace(/\(.*$/, "").toLowerCase().replace("enumeration", "enum");
            const got = typeName(a.type).toLowerCase().replace("enumeration", "enum");
            return got === want ? [] : [`${o.entity}.${o.name} has type ${typeName(a.type)}, expected ${o.type}`];
        },
        async changeAttribute(o) {
            const a = await get(o.attribute);
            const r = [];
            if (o.default !== undefined && a.value.defaultValue !== String(o.default)) r.push(`${o.attribute} default is '${a.value.defaultValue}'`);
            return r;
        },
        async addAssociation(o) {
            const from = await entity(o.from);
            const name = o.name || `${from.name}_${o.to.split(".").pop()}`;
            return (await exists(`${o.from.split(".")[0]}.${name}`)) ? [] : [`association ${name} missing`];
        },
        async createEnumeration(o) {
            const en = await get(`${o.module}.${o.name}`);
            const want = o.values.map(v => (typeof v === "string" ? v : v.name));
            const missing = want.filter(v => !en.values.some(x => x.name === v));
            return missing.length ? [`${o.module}.${o.name} lacks values ${missing.join(", ")}`] : [];
        },
        async addEnumerationValue(o) {
            return (await exists(`${o.enumeration}.${o.name}`)) ? [] : [`${o.enumeration}.${o.name} missing`];
        },
        async createModuleRole(o) {
            return (await exists(`${o.module}.${o.name}`)) ? [] : [`role ${o.module}.${o.name} missing`];
        },
        async grantAccess(o) {
            const doc = await get(o.document);
            const have = doc.allowedModuleRolesQualifiedNames || doc.allowedRolesQualifiedNames || [];
            return [].concat(o.roles).filter(r => !have.includes(r)).map(r => `${o.document} does not allow ${r}`);
        },

        async addAccessRule(o) {
            const e = await entity(o.entity);
            const ok = e.accessRules.some(r => [].concat(o.roles).every(x => r.moduleRolesQualifiedNames.includes(x)));
            return ok ? [] : [`${o.entity} has no access rule for ${[].concat(o.roles).join(", ")}`];
        },
        async createMicroflow(o) {
            const m = await get(`${o.module}.${o.name}`);
            let acts = 0;
            let params = 0;
            flows.walkObjects(m.objectCollection, x => {
                if (x instanceof mf.ActionActivity) acts++;
                if (x instanceof mf.MicroflowParameterObject) params++;
            });
            const r = [];
            const want = countActivities(o.actions);
            if (acts !== want) r.push(`${o.module}.${o.name} has ${acts} actions, expected ${want}`);
            if (params !== (o.parameters || []).length) r.push(`${o.module}.${o.name} has ${params} parameters, expected ${(o.parameters || []).length}`);
            return r;
        },
        async createNanoflow(o) {
            const m = await get(`${o.module}.${o.name}`);
            if (!(m instanceof mf.Nanoflow)) return [`${o.module}.${o.name} is not a nanoflow`];
            return checks.createMicroflow(o);
        },
        async addActions(o) {
            const m = await get(o.microflow);
            const vars = flows.variablesOf(m);
            return createdVariables(o.actions).filter(v => !vars.has(noDollar(v))).map(v => `${o.microflow}: no action creates '${v}'`);
        },
        async changeAction(o) {
            const m = await get(o.microflow);
            return flows.findStep(m, o.id, true) ? [] : [`${o.microflow}: step ${o.id} is missing`];
        },
        async deleteAction(o) {
            const m = await get(o.microflow);
            return flows.findStep(m, o.id, true) ? [`${o.microflow}: step ${o.id} still exists`] : [];
        },
        async setGeneralization(o) {
            const e = await entity(o.entity);
            const none = !o.generalization || /^none$/i.test(o.generalization);
            const g = e.generalization;
            if (none) return g instanceof dm.NoGeneralization ? [] : [`${o.entity} still has a parent`];
            return g instanceof dm.Generalization && g.generalizationQualifiedName === o.generalization ? [] : [`${o.entity} does not inherit from ${o.generalization}`];
        },
        async addValidationRule(o) {
            const e = await entity(o.entity);
            return e.validationRules.some(r => r.attributeQualifiedName === `${o.entity}.${o.attribute}`) ? [] : [`${o.entity}.${o.attribute} has no validation rule`];
        },
        async addEventHandler(o) {
            const e = await entity(o.entity);
            return e.eventHandlers.some(x => x.microflowQualifiedName === o.microflow) ? [] : [`${o.entity} has no event handler for ${o.microflow}`];
        },
        async addIndex(o) {
            const e = await entity(o.entity);
            return e.indexes.length ? [] : [`${o.entity} has no index`];
        },
        async createConstant(o) {
            const c = await get(`${o.module}.${o.name}`);
            return c.defaultValue === String(o.default) ? [] : [`${o.module}.${o.name} default is '${c.defaultValue}'`];
        },
        async createScheduledEvent(o) {
            const ev = await get(`${o.module}.${o.name}`);
            return ev.microflowQualifiedName === o.microflow && ev.schedule ? [] : [`${o.module}.${o.name} is incomplete`];
        },
        async createPage(o) {
            const page = await get(`${o.module}.${o.name}`);
            const r = [];
            if (o.entity && !page.parameters.length) r.push(`${o.module}.${o.name} has no page parameter`);
            return r;
        },
        async publishRest(o) {
            const svc = await get(`${o.module}.${o.service}`);
            const res = svc.resources.find(x => x.name === o.resource);
            const ok = res && res.operations.some(x => x.microflowQualifiedName === o.microflow);
            return ok ? [] : [`${o.module}.${o.service}/${o.resource} has no operation for ${o.microflow}`];
        },
        async moveDocument(o) {
            const doc = await get(o.document);
            const path = [];
            for (let c = doc.container; c && !(c instanceof projects.Module); c = c.container) path.unshift(c.name);
            const want = String(o.folder || "").split(/[/\\]/).filter(Boolean).join("/");
            return path.join("/") === want ? [] : [`${o.document} is in '${path.join("/")}', expected '${want}'`];
        },
        async rename(o) {
            const parts = o.target.split(".");
            const newQn = parts.slice(0, -1).concat(o.newName).join(".");
            const r = [];
            if (!(await exists(newQn))) r.push(`${newQn} missing`);
            if (await exists(o.target)) r.push(`${o.target} still exists`);
            return r;
        },
        async delete(o) {
            return (await exists(o.target)) ? [`${o.target} still exists`] : [];
        }
    };

    function opOf(o, i) {
        const where = `Op ${i + 1}`;
        if (!o || typeof o !== "object") throw new Error(`${where}: each op must be an object { "op": ... }`);
        const name = Object.keys(OPS).find(k => k.toLowerCase() === String(o.op).toLowerCase());
        if (!name) fail(`${where}: unknown op '${o.op}'`, o.op, Object.keys(OPS));
        validate("op", name, OPS[name], o, where);
        return { name, where };
    }

    async function runPlan(plan, log) {
        plan.ops.forEach((o, i) => opOf(o, i)); // validate everything before changing anything
        for (const [i, o] of plan.ops.entries()) {
            const { name, where } = opOf(o, i);
            try {
                const what = await impl[name](o);
                log(`${i + 1}. ${name} ${what}`);
            } catch (e) {
                e.message = `${where} (${name}): ${e.message}`;
                throw e;
            }
        }
        return flows.lintExpressions();
    }

    async function checkPlan(plan) {
        const failed = [];
        for (const [i, o] of plan.ops.entries()) {
            const { name } = opOf(o, i);
            // ops later in the plan can undo earlier ones (rename, delete) or edit the same flow; check final states only
            const rest = plan.ops.slice(i + 1);
            const later = rest.some(x => ["rename", "delete"].includes(x.op));
            const qn = o.module && o.name ? `${o.module}.${o.name}` : null;
            const edited = qn && rest.some(x => ["addActions", "changeAction", "deleteAction"].includes(x.op) && x.microflow === qn);
            if ((later && name !== "rename" && name !== "delete") || edited) continue;
            try {
                failed.push(...(await checks[name](o)).map(f => `${i + 1}. ${name}: ${f}`));
            } catch (e) {
                failed.push(`${i + 1}. ${name}: ${e.message}`);
            }
        }
        return failed;
    }

    const api = { get, runPlan, checkPlan, dataType, folder, lintExpressions: () => flows.lintExpressions(), steps: qn => flows.steps(qn) };
    for (const name of Object.keys(OPS)) {
        api[name] = o => {
            validate("op", name, OPS[name], o || {}, `ops.${name}`);
            return impl[name](o);
        };
    }
    return api;
}

module.exports = { bind, help, OPS, ACTIONS };
