"use strict";
// High-level, tested model changes. An agent fills in a change.json ({ "ops": [...] }) instead of writing Model SDK
// code; every op validates its fields, explains mistakes ("did you mean"), and can check itself after apply.
const sdk = require("mendixmodelsdk");

const { domainmodels: dm, microflows: mf, datatypes, enumerations, texts, security, projects, constants, scheduledevents, rest, pages } = sdk;
const { ATTRIBUTE_TYPES, DATA_TYPES, suggest, fail, validate, bool, noDollar, enumValue, validName } = require("./ops-util");


// ---------------------------------------------------------------- op catalog (also the 'ops' help text)


const { makeFlows, ACTIONS, CONTROL, COMMON, CREATES } = require("./ops-flows");
const { makePages, PAGE_FIELDS, MENU_FIELDS, HOME_FIELDS, widgetFields, NO_MENU_ROLES } = require("./ops-pages");
const { makePageEdit, PAGE_EDIT_OPS, PAGE_EDIT_NAMES, FIELD_SYNONYMS } = require("./ops-page-edit");
const { makeSecurity, SECURITY_OPS } = require("./ops-security");
const { makeMappings, MAPPING_OPS } = require("./ops-mappings");
const { makeTexts, TEXT_OPS } = require("./ops-texts");
const { makeNav, NAV_OPS, MENU_EXTRA, extendedMenuItem } = require("./ops-nav");
const { makeTheme, THEME_OPS } = require("./theme");
const { makeMarket, MARKET_OPS } = require("./marketplace");
const { makeCode, CODE_OPS } = require("./ops-code");
const { makeFlowEdit, FLOW_EDIT_OPS } = require("./ops-flow-edit");
const { makeDomain, DOMAIN_OPS, DOMAIN_SYNONYMS, SYSTEM_PARENTS, changedLater } = require("./ops-domain");
const { makeRest, REST_OPS } = require("./ops-rest");
const { makeOData, ODATA_OPS } = require("./ops-odata");
const { makeXml, XML_OPS } = require("./ops-xml");
const { makeWorkflows, WORKFLOW_OPS, USER_TASK_PAGE_FIELDS, SYSTEM_ENTITIES, STEP_FIELDS, STEP_COMMON } = require("./ops-workflows");

const OPS = {
    createEntity: {
        doc: "Create an entity in a module's domain model.",
        fields: { module: "R module name", name: "R entity name", persistable: "optional true/false (default true)", generalization: "optional Module.ParentEntity (also System.FileDocument, System.Image, System.User)", attributes: "optional [ { \"name\": ..., \"type\": ..., \"default\": ..., \"calculated\": ... } ]" }
    },
    addAttribute: { doc: "Add an attribute to an entity (stored, or calculated by a microflow).", fields: { entity: "R Module.Entity", name: "R attribute name", type: "R " + ATTRIBUTE_TYPES, default: "optional default value (as Studio Pro shows it)", calculated: "optional Module.Microflow that computes the value (not stored): no parameter or one of the entity, returns the attribute type" } },
    changeAttribute: { doc: "Change the type, default, or stored/calculated of an attribute.", fields: { attribute: "R Module.Entity.Attribute", type: "optional new type", default: "optional new default value", calculated: "optional Module.Microflow: make it calculated (its column is dropped)", stored: "optional true: make a calculated attribute stored again" } },
    addAssociation: {
        doc: "Add an association. 'from' stores the reference: many 'from' objects point to one 'to' object (Reference), or to many (ReferenceSet).",
        fields: { from: "R Module.Entity (owner side)", to: "R Module.Entity or OtherModule.Entity", name: "optional (default From_To)", type: "optional Reference | ReferenceSet (default Reference)", owner: "optional Default | Both",
            storage: "optional Table | Column (default: the app's setting for a Reference with owner Default, else Table)", onDeleteFrom: "optional keep | delete | prevent (default keep): when a 'from' object is deleted", onDeleteTo: "optional keep | delete | prevent: when a 'to' object is deleted",
            messageFrom: "prevent on onDeleteFrom: message", messageTo: "prevent on onDeleteTo: message" }
    },
    createEnumeration: { doc: "Create an enumeration.", fields: { module: "R module name", name: "R enumeration name", values: "R [ \"Value\" or { \"name\": ..., \"caption\": ... } ]", folder: "optional folder path, e.g. Enums/Order" } },
    addEnumerationValue: { doc: "Add a value to an enumeration.", fields: { enumeration: "R Module.Enumeration", name: "R value name", caption: "optional caption (default the name)" } },
    createModule: { doc: "Create a module (with its domain model, module security and settings, as Studio Pro does).", fields: { name: "R module name, e.g. EmployeeOnboarding", roles: "optional [ \"RoleName\" ] module roles to create in it" } },
    createModuleRole: { doc: "Create a module role.", fields: { module: "R module name", name: "R role name", description: "optional" } },
    grantAccess: { doc: "Allow module roles to run a microflow/nanoflow or open a page.", fields: { document: "R Module.Microflow or Module.Page", roles: "R [ \"Module.Role\" ]" } },
    ...SECURITY_OPS,
    ...TEXT_OPS,
    addAccessRule: {
        doc: "Add an entity access rule. Members not listed in 'members' get 'access'.",
        fields: { entity: "R Module.Entity", roles: "R [ \"Module.Role\" ]", access: "optional ReadWrite | ReadOnly | None (default ReadOnly)", members: "optional { \"Attribute\": \"ReadWrite\", \"Module.Assoc\": \"ReadOnly\", \"System.FileDocument.Name\": \"ReadWrite\" }", create: "optional true/false", delete: "optional true/false", xpath: "optional XPath, e.g. [Owner = '[%CurrentUser%]']", newMembers: "optional ReadWrite | ReadOnly | None: rights of members added later (default: access)" }
    },
    ...DOMAIN_OPS,
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
        fields: { microflow: "R Module.Microflow or Module.Nanoflow", after: "optional \"start\", the variable name an existing step creates, or a step id (see: steps)", branch: "with after = a decision: which outgoing flow, e.g. \"true\" or an enumeration value", actions: "R [ actions ]" }
    },
    changeAction: {
        doc: "Change one existing step. Get its id with: steps Module.Flow. Give only the fields to change.",
        fields: {
            microflow: "R Module.Microflow or Module.Nanoflow", id: "R step id from 'steps', e.g. 3f2a9c1b",
            xpath: "retrieve: new XPath", first: "retrieve: true/false", entity: "retrieve: Module.Entity",
            set: "create/change: { \"Attr\": \"expression\" } (adds or replaces)", unset: "create/change: [ \"Attr\" ] to remove",
            commit: "create/change: true/false; callRest/importWithMapping (import mapping): yes | no | withoutEvents", refresh: "change/commit/rollback: true/false", events: "commit: true/false",
            args: "call/callJava/callJavaScript/rule decision: { \"Param\": \"expression\" }; validationFeedback: [\"expression\"]", message: "log/validationFeedback: text", level: "log: level", text: "message: text",
            type: "message: Information | Warning | Error; changeList: add | remove | replace | clear", blocking: "message: true/false",
            value: "variable/set/end/changeList: expression; listOperation find/filter: value", condition: "decision: expression", caption: "decision, ifType or action: caption",
            disabled: "action: true/false", while: "while loop: expression", over: "list loop: list variable",
            function: "aggregateList: count | sum | average | minimum | maximum | all | any", attribute: "aggregateList: attribute", expression: "aggregateList, listOperation find/filter by expression: expression",
            other: "listOperation: second list or object variable", offset: "listOperation range: expression", limit: "listOperation range: expression",
            showInBrowser: "downloadFile: true/false", url: "callRest: location text", urlArgs: "callRest: [\"expression\"]", method: "callRest: Get | Post | ...",
            headers: "callRest: { \"Name\": \"expression\" } (replaces all)", timeout: "callRest: seconds", body: "callRest: body text", bodyArgs: "callRest: [\"expression\"]",
            auth: "callRest: { \"user\": \"expression\", \"password\": \"expression\" } or \"none\"", proxy: "callRest: default | none | { host, port, user, password }", errorBody: "callRest: true/false",
            initial: "aggregateList reduce: initial value expression"
        }
    },
    deleteAction: { doc: "Delete one action or loop from a flow and reconnect the line. Get its id with: steps Module.Flow.", fields: { microflow: "R Module.Microflow or Module.Nanoflow", id: "R step id from 'steps'" } },
    ...FLOW_EDIT_OPS,
    ...CODE_OPS,
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
    createLayout: { doc: "Create a layout as a copy of an existing one (its placeholders, header, sidebar and menu widgets), to change in Studio Pro or use in createPage \"layout\".", fields: { module: "R module name", name: "R layout name", from: "R Module.Layout to copy (e.g. Atlas_Core.Atlas_Default)", folder: "optional folder path" } },
    createPage: { doc: "Create a page (or with kind userTaskPage a workflow user task page): an edit form for an entity (inputs by attribute type, Save/Cancel), an empty page, or a page from widgets (layout grids, containers, texts, data grids (classic, or a Data grid 2 built from widgets/*.mpk), data views that listen to a grid, list views, buttons, inputs), optionally with a menu item. Uses the layout the project's other pages use.", fields: { ...PAGE_FIELDS, ...USER_TASK_PAGE_FIELDS } },
    ...PAGE_EDIT_OPS,
    addMenuItem: { doc: "Add a menu item that opens a page, runs a microflow or another action (sign out, open a link, call a flow) to a navigation profile's menu or a menu document; a native page becomes a bottom bar item of the native profile.", fields: { ...MENU_FIELDS, ...MENU_EXTRA } },
    setHomePage: { doc: "Set the home page (or home microflow) of a navigation profile, for everyone or for some user roles (native profile: a native page or nanoflow).", fields: HOME_FIELDS },
    ...NAV_OPS,
    ...THEME_OPS,
    ...MARKET_OPS,
    ...MAPPING_OPS,
    ...REST_OPS,
    ...ODATA_OPS,
    ...XML_OPS,
    ...WORKFLOW_OPS,
    moveDocument: { doc: "Move a document to another folder of the same module.", fields: { document: "R Module.Document", folder: "optional folder path, e.g. Orders/Actions (missing or \"\" = the module root)" } },
    rename: { doc: "Rename a module, document, entity, attribute, association or enumeration value. Updates references, reports names left in expressions/XPath/Java.", fields: { target: "R qualified name, e.g. Module.Entity.Attribute", newName: "R new short name" } },
    delete: { doc: "Delete a document, entity, attribute, association, enumeration value or module role. Lists what still uses it.", fields: { target: "R qualified name" } }
};

// Without a name: one line per operation (short, so a small model reads it every time). With a name: the fields of
// that operation, action or flow control kind.
function help(name) {
    const groups = [["OPERATIONS", OPS], ["ACTIONS (inside \"actions\")", ACTIONS], ["FLOW CONTROL (inside \"actions\")", CONTROL]];
    const detail = (n, o) => [`${n}: ${o.doc}`, ...Object.entries(o.fields).map(([f, d]) => `    ${f}: ${d}`)];
    if (name && name !== true) {
        if (name === "all") {
            const lines = ["change.json: { \"ops\": [ { \"op\": \"<name>\", ...fields } ] }   (R = required)"];
            for (const [title, table] of groups) {
                lines.push("", title + ":");
                for (const [n, o] of Object.entries(table)) lines.push(...detail(n, o));
            }
            lines.push("Every action also takes:", ...Object.entries(COMMON).map(([f, d]) => `    ${f}: ${d}`));
            return lines.join("\n");
        }
        for (const [title, table] of groups) {
            const hit = Object.keys(table).find(n => n.toLowerCase() === String(name).toLowerCase());
            if (!hit) continue;
            const lines = detail(hit, table[hit]);
            if (table === ACTIONS) lines.push("  also: " + Object.entries(COMMON).map(([f, d]) => `${f} (${d})`).join("; "));
            if (/actions/.test(Object.keys(table[hit].fields).join(" "))) lines.push("  actions: see ops <action name>, e.g. ops retrieve; list all with: ops");
            return (table === OPS ? "op " : "action ") + lines.join("\n");
        }
        const widget = widgetFields(name);
        if (widget) return widget;
        const step = Object.keys(STEP_FIELDS).find(k => k.toLowerCase() === String(name).toLowerCase());
        if (step) return [`workflow step ${step} (inside createWorkflow "steps"): ${STEP_FIELDS[step].doc}`, ...Object.entries({ ...STEP_FIELDS[step].fields, ...STEP_COMMON }).map(([f, d]) => `    ${f}: ${d}`)].join("\n");
        const all = groups.flatMap(([, t]) => Object.keys(t));
        const s = suggest(name, all, 3);
        throw new Error(`No operation or action '${name}'.${s.length ? ` Did you mean: ${s.join(", ")}?` : ""} All names: ops (widget fields: ops createPage)`);
    }
    const lines = ["change.json: { \"ops\": [ { \"op\": \"<name>\", ...fields } ] }. Fields of one: ops <name> (all at once: ops all)"];
    for (const [title, table] of groups) {
        lines.push("", title + ":");
        for (const [n, o] of Object.entries(table)) lines.push(`  ${n.padEnd(20)} ${o.doc.split(/(?<=\.) /)[0]}`);
    }
    lines.push("", "Expressions are Mendix expressions as text: \"'Hello'\", \"$Order/Total * 2\", \"empty\", \"[%CurrentDateTime%]\".");
    lines.push("No operation fits: record the gap (mx.py gap \"<what>\") and give the user the Studio Pro steps.");
    return lines.join("\n");
}

// Deleting a stored entity, attribute or association drops database data when the app next starts.
function persistable(entity) {
    try {
        let e = entity;
        for (let i = 0; e && i < 20; i++) {
            const g = e.generalization;
            if (g instanceof dm.NoGeneralization) return g.persistable;
            e = g && g.generalization;
        }
    } catch {
        // parent entity in a document that is not loaded: assume stored, the safe side for a warning
    }
    return true;
}

function dataLoss(el) {
    if (el instanceof dm.Entity && persistable(el)) return `the table of ${el.name} and all its rows are dropped when the app next starts`;
    if (el instanceof dm.Attribute && persistable(el.containerAsEntity)) return `the column ${el.name} and its values are dropped when the app next starts`;
    if (el instanceof dm.AssociationBase) return `the links stored in ${el.name} are dropped when the app next starts`;
    return null;
}

// ---------------------------------------------------------------- bound operations

function bind(model, client) {
    let names = null;
    const allNames = () => {
        if (!names) names = [...new Set(require("./inspect").names(client).map(x => x.qn))];
        return names;
    };
    // the default language (addLanguage with default: true resets it)
    let langCode = null;
    const resetLanguage = () => (langCode = null);
    async function language() {
        if (langCode) return langCode;
        const settings = model.allProjectSettings()[0];
        const loaded = settings && (await settings.load());
        const lang = loaded && loaded.settingsParts.find(p => p instanceof sdk.settings.LanguageSettings);
        langCode = (lang && lang.defaultLanguageCode) || "en_US";
        return langCode;
    }

    function moduleNamed(name) {
        const m = model.allModules().find(x => x.name === name);
        if (m) return m;
        const mods = model.allModules().map(x => x.name);
        const s = suggest(name, mods);
        if (s.length) throw new Error(`Module '${name}' not found. Did you mean: ${s.join(", ")}?`);
        const own = model.allModules().filter(x => !x.fromAppStore).map(x => x.name);
        throw new Error(`Module '${name}' not found. Create it first: { "op": "createModule", "name": "${name}" } (modules here: ${(own.length ? own : mods).join(", ")})`);
    }

    // Any document or element by qualified name, loaded and ready to change.
    async function get(qn) {
        if (typeof qn !== "string" || !qn.trim()) throw new Error(`Expected a qualified name like "Module.Name", got ${JSON.stringify(qn)}`);
        qn = qn.trim();
        if (!qn.includes(".")) {
            if (model.allModules().some(x => x.name === qn)) return moduleNamed(qn);
            // a document or entity without its module (weak models drop it): name the full name
            const full = allNames().filter(n => n.split(".").length === 2 && n.split(".")[1].toLowerCase() === qn.toLowerCase());
            if (full.length) throw new Error(`'${qn}' needs its module: ${full.slice(0, 3).join(" or ")}?`);
            const s = suggest(qn, model.allModules().map(x => x.name));
            throw new Error(`'${qn}' not found: write the full name Module.Name (check it with: find ${qn})` + (s.length ? `; a module? Did you mean: ${s.join(", ")}?` : ""));
        }
        const unit = model.allUnits().find(u => {
            try {
                return u.qualifiedName === qn && !(dm.ViewEntitySourceDocument && u instanceof dm.ViewEntitySourceDocument); // a view entity's OQL document has its name
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
        const dflt = await language();
        const items = textOps.withPending(typeof value === "object" && value ? value : { [dflt]: String(value) }, dflt);
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
                if (SYSTEM_ENTITIES.includes(m[2])) t.__entity.updateWithRawValue(m[2]); // System module: by name
                else t.entity = await entity(m[2]);
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
        if (SYSTEM_ENTITIES.includes(s)) {
            const t = datatypes.ObjectType.create(model);
            t.__entity.updateWithRawValue(s); // System module: not in the project, stored by name
            return t;
        }
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

    const textOps = makeTexts({ model, client, get, resetLanguage });
    const translationsOf = textOps.translationsOf;
    const flows = makeFlows({ model, client, get, entity, text, dataType, attributeChain, loadParents });
    const codeOps = makeCode({ model, client, get, exists, entity, folder, createFlow: (...a) => flows.createFlow(...a) });
    const flowEdit = makeFlowEdit({ model, exists, createFlow: (o, nano) => flows.createFlow(o, nano, folder(o.module, o.folder)) }, flows);
    const pageOps = makePages({ model, client, get, exists, entity, text, translationsOf, folder, attributeChain, loadParents, persistable, dataType, grantAccess: o => impl.grantAccess(o), createNanoflow: o => createFlowOp(o, true) });
    const pageEdit = makePageEdit({ model, client, get, text, translationsOf, attributeChain, persistable }, pageOps.internals);
    const securityOps = makeSecurity({ model, get });
    const themeOps = makeTheme({ client });
    const marketOps = makeMarket({ client, model });
    const navOps = makeNav({ model, client, get, exists, text, translationsOf, folder, grantAccess: o => impl.grantAccess(o) }, pageOps.internals);
    const mappingOps = makeMappings({ model, get, exists, entity, folder, attributeChain, loadParents, impl: () => impl });
    const domainOps = makeDomain({ model, client, get, exists, entity, folder, text, attributeType, loadParents, persistable, domainModel, isFresh: qn => isFresh(qn), markFresh: qn => fresh.add(qn) });
    // a parent: a project entity, or a System entity (by name, as Studio Pro stores it)
    async function setParent(e, qn) {
        const g = dm.Generalization.createIn(e);
        if (SYSTEM_PARENTS.includes(qn)) g.__generalization.updateWithRawValue(qn);
        else g.generalization = await entity(qn);
    }
    const version = client.project.version;
    const restOps = makeRest({ model, client, get, exists, folder, version, mappingInternals: mappingOps.internals, impl: () => impl });
    const odataOps = makeOData({ model, client, get, exists, entity, folder, version, persistable, attributeChain, loadParents });
    const xmlOps = makeXml({ model, client, get, exists, entity, folder, version, attributeChain, loadParents, mappingInternals: mappingOps.internals });
    const workflowOps = makeWorkflows({ model, client, get, exists, entity, folder, version, persistable, attributeChain, loadParents, grantAccess: o => impl.grantAccess(o), impl: () => impl,
        textAll: (owner, prop, value) => pageOps.internals.templateAll(owner, prop, value, null, "", true) });

    // ------------------------------------------------ operations

    async function createFlowOp(o, nano) {
        validName(o.name, `${nano ? "nanoflow" : "microflow"} name`);
        const qn = `${o.module}.${o.name}`;
        if (await exists(qn)) throw new Error(`${qn} already exists`);
        const { count } = await flows.createFlow(o, nano, folder(o.module, o.folder));
        if (o.roles) await impl.grantAccess({ document: qn, roles: o.roles });
        return `${qn} (${count} action(s))`;
    }

    // The nested action lists of one spec: if branches, loop body, ifType cases, error handler.
    const nested = sp => [sp.then, sp.else, sp.actions, ...(sp.cases && typeof sp.cases === "object" ? Object.values(sp.cases) : []), sp.other, sp.empty, sp.onError && sp.onError.actions].filter(Array.isArray);

    // Activities (boxes) a list of action specs creates, including nested branches, loops and error handlers.
    function countActivities(specs) {
        let n = 0;
        for (const sp of specs || []) {
            if (!sp || typeof sp !== "object") continue;
            if (ACTIONS[sp.action]) n++;
            for (const list of nested(sp)) n += countActivities(list);
        }
        return n;
    }

    function createdVariables(specs, out = []) {
        for (const sp of specs || []) {
            if (!sp || typeof sp !== "object") continue;
            if (CREATES[sp.action] && sp[CREATES[sp.action]]) out.push(sp[CREATES[sp.action]]);
            if (sp.action === "loop" && sp.over) out.push(sp.item || `${noDollar(sp.over)}Item`);
            for (const list of nested(sp)) createdVariables(list, out);
        }
        return out;
    }

    // Entities, attributes and associations created by this plan: deleting or retyping them loses no stored data.
    const fresh = new Set();
    const isFresh = qn => [...fresh].some(f => qn === f || qn.startsWith(f + "."));

    const impl = {
        async createEntity(o) {
            validName(o.name, "entity name");
            fresh.add(`${o.module}.${o.name}`);
            const d = await domainModel(o.module);
            if (d.entities.some(e => e.name === o.name)) throw new Error(`${o.module}.${o.name} already exists`);
            const e = dm.Entity.createIn(d);
            e.name = o.name;
            const xs = d.entities.filter(x => x !== e).map(x => x.location.x);
            e.location = { x: xs.length ? Math.max(...xs) + 250 : 100, y: 100 };
            if (o.generalization) await setParent(e, o.generalization);
            else if (e.generalization instanceof dm.NoGeneralization) e.generalization.persistable = bool(o.persistable, true);
            const attrSpec = { fields: { name: "R attribute name", type: "R " + ATTRIBUTE_TYPES, default: "optional default value", calculated: "optional Module.Microflow" } };
            for (const [i, a] of (o.attributes || []).entries()) {
                validate("-", "attribute", attrSpec, a || {}, `${o.module}.${o.name} attribute ${i + 1}`);
                await impl.addAttribute({ entity: `${o.module}.${o.name}`, ...a }, e);
            }
            return `${o.module}.${o.name}`;
        },
        async addAttribute(o, loaded) {
            fresh.add(`${o.entity}.${o.name}`);
            const e = loaded || (await entity(o.entity));
            if (!o.name || !o.type) throw new Error(`addAttribute needs name and type (${o.entity})`);
            validName(o.name, "attribute name");
            if (e.attributes.some(a => a.name === o.name)) throw new Error(`${o.entity}.${o.name} already exists`);
            domainOps.assertOwnAttributes(e, o.entity);
            if (o.calculated !== undefined && o.default !== undefined) throw new Error(`${o.entity}.${o.name}: a calculated attribute has no default`);
            const a = dm.Attribute.createIn(e);
            a.name = o.name;
            const dflt = await attributeType(a, o.type);
            setDefault(a, o.default !== undefined ? o.default : dflt);
            if (o.calculated !== undefined) await domainOps.calculate(a, o.calculated);
            if (!loaded) await domainOps.addMemberToRules(e, a);
            return `${o.entity}.${o.name}: ${o.type}` + (o.calculated ? ` calculated by ${o.calculated}` : "");
        },
        async changeAttribute(o) {
            const a = await get(o.attribute);
            if (!(a instanceof dm.Attribute)) throw new Error(`'${o.attribute}' is not an attribute`);
            if (o.type === undefined && o.default === undefined && o.calculated === undefined && o.stored === undefined) throw new Error("changeAttribute needs 'type', 'default', 'calculated' or 'stored'");
            domainOps.assertOwnAttributes(a.containerAsEntity, o.attribute.split(".").slice(0, 2).join("."));
            if (o.calculated !== undefined && bool(o.stored, false)) throw new Error("changeAttribute: give 'calculated' or 'stored', not both");
            const wasCalc = a.value instanceof dm.CalculatedValue;
            const calcAfter = o.calculated !== undefined || (wasCalc && !bool(o.stored, false));
            if (o.default !== undefined && calcAfter) throw new Error(`${o.attribute} is calculated: it has no default (add "stored": true to store it)`);
            const before = a.type.structureTypeName;
            const oldFlow = wasCalc ? a.value.microflowQualifiedName : null;
            if (o.type !== undefined) {
                const dflt = await attributeType(a, o.type);
                if (o.default === undefined && !calcAfter) setDefault(a, dflt);
            }
            if (o.default !== undefined) setDefault(a, o.default);
            let note = "";
            if (o.calculated !== undefined) note = await domainOps.calculate(a, o.calculated);
            else if (wasCalc && o.type !== undefined && calcAfter) note = await domainOps.calculate(a, oldFlow);
            else if (wasCalc && bool(o.stored, false) && !(a.value instanceof dm.StoredValue)) setDefault(a, o.default !== undefined ? o.default : "");
            const stored = persistable(a.containerAsEntity) && !isFresh(o.attribute);
            const changed = a.type.structureTypeName !== before && stored && !wasCalc && !calcAfter;
            const lines = [];
            if (changed) lines.push(`DATA LOSS: existing values are converted on the next app start; values that do not convert to ${o.type} are lost`);
            if (!wasCalc && calcAfter && stored) lines.push(`DATA LOSS: ${a.name} is no longer stored: its column and values are dropped when the app next starts`);
            if (wasCalc && !calcAfter && stored) lines.push(`NOTE: ${a.name} is stored now: existing objects get the default value, not the calculated one`);
            return o.attribute + (calcAfter ? ` (calculated by ${a.value.microflowQualifiedName})` : wasCalc ? " (stored)" : "") + note + lines.map(l => `\n      ${l}`).join("");
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
            fresh.add(`${o.from.split(".")[0]}.${name}`);
            const { notes } = await domainOps.associationSettings(a, o, true);
            await domainOps.addMemberToRules(from, a);
            if (a.owner === dm.AssociationOwner.Both && to !== from) await domainOps.addMemberToRules(to, a);
            const extra = [a.storageFormat && a.storageFormat !== dm.AssociationStorage.Table ? `stored in a ${a.storageFormat.name.toLowerCase()}` : "", ...notes.filter(n => n.startsWith("deleting"))].filter(Boolean);
            return `${o.from.split(".")[0]}.${name}: ${o.from} -> ${o.to}` + (extra.length ? ` (${extra.join("; ")})` : "");
        },
        async createEnumeration(o) {
            validName(o.name, "enumeration name");
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
        async createModule(o) {
            validName(o.name, "module name");
            for (const r of [].concat(o.roles || [])) validName(r, "module role name");
            if (model.allModules().some(m => m.name === o.name)) throw new Error(`module ${o.name} already exists`);
            const m = projects.Module.createIn(model.allProjects()[0]);
            m.name = o.name;
            m.sortIndex = Math.floor(Math.max(0, ...model.allModules().filter(x => x !== m).map(x => x.sortIndex || 0))) + 1;
            dm.DomainModel.createIn(m);
            const sec = security.ModuleSecurity.createIn(m);
            const settings = projects.ModuleSettings.createIn(m);
            settings.version = "1.0.0"; // what Studio Pro writes for a new module
            for (const r of [].concat(o.roles || [])) security.ModuleRole.createIn(sec).name = r;
            fresh.add(o.name);
            return o.name + (o.roles && o.roles.length ? ` (roles ${[].concat(o.roles).join(", ")})` : "");
        },
        async createModuleRole(o) {
            validName(o.name, "module role name");
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

        addAccessRule: o => domainOps.impl.addAccessRule(o),
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
            if (SYSTEM_PARENTS.includes(o.generalization)) {
                await setParent(e, o.generalization);
                return `${o.entity} inherits from ${o.generalization} (check access rules and pages that use ${o.entity} in Studio Pro)`;
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
            validName(o.name, "constant name");
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
            validName(o.name, "scheduled event name");
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
        // grants o.roles, adds o.menu; URL and pop-up size as changePage does
        async createPage(o) {
            const kind = o.kind === undefined ? "" : String(o.kind);
            if (kind && kind !== "userTaskPage") fail(`createPage kind '${kind}' is not userTaskPage (leave kind out for a normal page)`, kind, ["userTaskPage"]);
            if (kind) return workflowOps.userTaskPage(o, x => pageOps.createPage(x));
            for (const k of ["outcomes", "workflow", "editable"]) if (o[k] !== undefined) throw new Error(`createPage: '${k}' only applies with "kind": "userTaskPage"`);
            const text = await pageOps.createPage(o);
            const set = Object.fromEntries(["url", "popupWidth", "popupHeight", "popupResizable"].filter(k => o[k] !== undefined).map(k => [k, o[k]]));
            if (!Object.keys(set).length) return text;
            try {
                return `${text}\n      ${(await pageEdit.changePage({ page: `${o.module}.${o.name}`, ...set })).replace(/^[^:]*: /, "")}`;
            } catch (e) {
                const p = model.allPages().find(x => x.qualifiedName === `${o.module}.${o.name}`);
                if (p) p.delete();
                throw new Error(e.message.replace(/^changePage /, "createPage "));
            }
        },
        addWidgets: o => pageEdit.addWidgets(o),
        changeWidget: o => pageEdit.changeWidget(o),
        deleteWidget: o => pageEdit.deleteWidget(o),
        moveWidget: o => pageEdit.moveWidget(o),
        changePage: o => pageEdit.changePage(o),
        addMenuItem: o => (extendedMenuItem(o) ? navOps.addMenuItem(o) : pageOps.addMenuItem(o)),
        ...navOps.impl,
        ...themeOps.impl,
        ...marketOps.impl,
        async createLayout(o) {
            validName(o.name, "layout name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const src = await get(o.from);
            if (!(src instanceof pages.Layout)) throw new Error(`'${o.from}' is not a layout`);
            const l = pages.Layout.createIn(folder(o.module, o.folder));
            l.name = o.name;
            for (const k of ["canvasWidth", "canvasHeight"]) if (l[k] !== src[k]) l[k] = src[k];
            l.content = src.content.deepCopy(model);
            if (src.appearance) l.appearance = src.appearance.deepCopy(model);
            const phs = [];
            l.traverse(el => el instanceof pages.Placeholder && phs.push(el.name));
            client.warn(`${qn}: first layout made by ops (copy of ${src.qualifiedName}); check it in Studio Pro`);
            return `${qn} (copy of ${src.qualifiedName}; placeholders ${phs.join(", ") || "none"})`;
        },
        setHomePage: o => pageOps.setHomePage(o),
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
            validName(o.newName);
            el.name = o.newName;
            return `${o.target} -> ${o.newName}`;
        },
        async delete(o) {
            const el = await get(o.target);
            const users = client.referencesTo(o.target);
            const loss = isFresh(o.target) ? null : dataLoss(el);
            el.delete();
            const nav = users.some(u => u.startsWith("Navigation")) ? `\n      NOTE: a menu item or home page still opens ${o.target}; no operation removes those: remove them in Studio Pro (App > Navigation)` : "";
            return `${o.target}` + (users.length ? `\n      STILL USED BY (fix these, or Studio Pro shows errors): ${users.join(", ")}` : "") + nav +
                (loss ? `\n      DATA LOSS: ${loss}` : "");
        },
        ...securityOps.impl,
        ...mappingOps.impl,
        ...codeOps.impl,
        ...flowEdit.impl,
        ...domainOps.impl,
        ...textOps.impl,
        ...restOps.impl,
        ...odataOps.impl,
        ...xmlOps.impl,
        ...workflowOps.impl
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
            const r = got === want ? [] : [`${o.entity}.${o.name} has type ${typeName(a.type)}, expected ${o.type}`];
            if (o.calculated !== undefined && !(a.value instanceof dm.CalculatedValue && a.value.microflowQualifiedName === o.calculated)) r.push(`${o.entity}.${o.name} is not calculated by ${o.calculated}`);
            return r;
        },
        async changeAttribute(o) {
            const a = await get(o.attribute);
            const r = [];
            if (o.default !== undefined && a.value.defaultValue !== String(o.default)) r.push(`${o.attribute} default is '${a.value.defaultValue}'`);
            if (o.calculated !== undefined && !(a.value instanceof dm.CalculatedValue && a.value.microflowQualifiedName === o.calculated)) r.push(`${o.attribute} is not calculated by ${o.calculated}`);
            if (bool(o.stored, false) && !(a.value instanceof dm.StoredValue)) r.push(`${o.attribute} is not stored`);
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
        async createModule(o) {
            const m = model.allModules().find(x => x.name === o.name);
            if (!m) return [`module ${o.name} missing`];
            const r = [];
            if (!model.allDomainModels().some(d => d.containerAsModule === m)) r.push(`${o.name} has no domain model`);
            if (!model.allModuleSecurities().some(d => d.containerAsModule === m)) r.push(`${o.name} has no module security`);
            return r;
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
        async createLayout(o) {
            return (await exists(`${o.module}.${o.name}`)) ? [] : [`${o.module}.${o.name} missing`];
        },
        ...pageEdit.checks,
        setHomePage: o => pageOps.checks.setHomePage(o),
        ...navOps.checks,
        addMenuItem: o => (extendedMenuItem(o) ? navOps.checks.addMenuItem(o) : pageOps.checks.addMenuItem(o)),
        ...themeOps.checks,
        ...marketOps.checks,
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
        },
        ...securityOps.checks,
        ...mappingOps.checks,
        ...codeOps.checks,
        ...flowEdit.checks,
        ...domainOps.checks,
        ...textOps.checks,
        ...restOps.checks,
        ...odataOps.checks,
        ...xmlOps.checks,
        createWorkflow: o => workflowOps.checks.createWorkflow(o),
        createPage: o => (o.kind === "userTaskPage" ? workflowOps.checks.userTaskPage(o) : pageOps.checks.createPage(o))
    };

    function opOf(o, i) {
        const where = `Op ${i + 1}`;
        if (!o || typeof o !== "object") throw new Error(`${where}: each op must be an object { "op": ... }`);
        const name = Object.keys(OPS).find(k => k.toLowerCase() === String(o.op).toLowerCase());
        if (!name) fail(`${where}: unknown op '${o.op}'`, o.op, Object.keys(OPS));
        if (name === "addMenuItem" && o.roles !== undefined) throw new Error(`${where} (addMenuItem): ${NO_MENU_ROLES(o.page)}`);
        for (const [k, hint] of Object.entries({ ...(DOMAIN_SYNONYMS[name] || {}), ...(FIELD_SYNONYMS[name] || {}) })) if (o[k] !== undefined && !OPS[name].fields[k]) throw new Error(`${where} (${name}): unknown field '${k}': ${hint}`);
        validate("op", name, OPS[name], o, where);
        return { name, where };
    }

    async function runPlan(plan, log) {
        plan.ops.forEach((o, i) => opOf(o, i)); // validate everything before changing anything
        for (const [i, o] of plan.ops.entries()) {
            const { name, where } = opOf(o, i);
            try {
                const what = await impl[name](name === "setTranslations" ? o : await textOps.prepare(o));
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
            const edited = qn && rest.some(x => ["addActions", "changeAction", "deleteAction", "moveAction", "extractMicroflow", "addAnnotation"].includes(x.op) && x.microflow === qn);
            const opposite = { grantAccess: "revokeAccess", revokeAccess: "grantAccess" }[name];
            const undone = opposite && rest.some(x => x.op === opposite && x.document === o.document);
            // a later page edit of the same page that deletes, moves or renames one of this op's widgets (or changes it again)
            const mine = PAGE_EDIT_NAMES.includes(name) ? pageEdit.touched(o) : [];
            const undoes = x => ["deleteWidget", "moveWidget"].includes(x.op) || (x.op === "changeWidget" && (x.name !== undefined || name === "changeWidget"));
            const reworked = mine.length && rest.some(x => x.page === o.page && undoes(x) && pageEdit.touched(x).some(n => mine.includes(n)));
            if ((later && name !== "rename" && name !== "delete") || edited || undone || reworked || changedLater(name, o, rest)) continue;
            try {
                failed.push(...(await checks[name](name === "setTranslations" ? o : await textOps.prepare(o, false))).map(f => `${i + 1}. ${name}: ${f}`));
            } catch (e) {
                failed.push(`${i + 1}. ${name}: ${e.message}`);
            }
        }
        return failed;
    }

    const api = { get, runPlan, checkPlan, dataType, folder, lintExpressions: () => flows.lintExpressions(), steps: qn => flows.steps(qn), widgets: qn => pageEdit.widgets(qn), widgetType: name => (name ? pageOps.internals.widgetType(name) : pageOps.internals.widgetTypes()), texts: (scope, missing) => textOps.list(scope, missing) };
    for (const name of Object.keys(OPS)) {
        api[name] = o => {
            validate("op", name, OPS[name], o || {}, `ops.${name}`);
            return name === "setTranslations" ? impl[name](o) : textOps.prepare(o).then(p => impl[name](p));
        };
    }
    return api;
}

module.exports = { bind, help, OPS, ACTIONS };
