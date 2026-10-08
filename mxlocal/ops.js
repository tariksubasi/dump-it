"use strict";
// High-level, tested model changes. An agent fills in a change.json ({ "ops": [...] }) instead of writing Model SDK
// code; every op validates its fields, explains mistakes ("did you mean"), and can check itself after apply.
const sdk = require("mendixmodelsdk");

const { domainmodels: dm, microflows: mf, datatypes, enumerations, texts, security, projects } = sdk;

// ---------------------------------------------------------------- op catalog (also the 'ops' help text)

const ATTRIBUTE_TYPES = "String(200) | String(unlimited) | Integer | Long | Decimal | Boolean | DateTime | AutoNumber | HashedString | Binary | Enum(Module.Enumeration)";
const DATA_TYPES = "String | Integer | Long | Decimal | Boolean | DateTime | Module.Entity | List(Module.Entity) | Enum(Module.Enumeration)";

const ACTIONS = {
    retrieve: {
        doc: "Retrieve from the database, or over an association when 'from' is set.",
        fields: { variable: "R result variable name", entity: "database retrieve: Module.Entity", xpath: "optional XPath, e.g. [Active = true()]", first: "optional true = single object", from: "association retrieve: variable name, e.g. Order", association: "association retrieve: Module.Association" }
    },
    create: { doc: "Create an object.", fields: { variable: "R new variable name", entity: "R Module.Entity", set: "optional { \"Attribute\": \"expression\", \"Module.Assoc\": \"$Var\" }", commit: "optional true/false (default false)" } },
    change: { doc: "Change members of an object.", fields: { variable: "R variable to change (no $)", set: "R { \"Attribute\": \"expression\" }", commit: "optional true/false", refresh: "optional true/false" } },
    commit: { doc: "Commit an object or list.", fields: { variable: "R variable (no $)", events: "optional false = without events" } },
    delete: { doc: "Delete an object or list.", fields: { variable: "R variable (no $)" } },
    call: { doc: "Call a microflow.", fields: { microflow: "R Module.Microflow", args: "optional { \"ParamName\": \"expression\" }", variable: "optional result variable name" } },
    log: { doc: "Write a log line.", fields: { message: "R text; {1} {2} are filled from args", args: "optional [\"expression\", ...]", level: "optional Info | Warning | Error | Debug | Trace | Critical", node: "optional log node name (default the module name)" } },
    message: { doc: "Show a message to the user.", fields: { text: "R message text", type: "optional Information | Warning | Error", blocking: "optional true/false" } },
    variable: { doc: "Create a variable.", fields: { name: "R variable name", type: "R " + DATA_TYPES, value: "R initial value expression, e.g. 0 or 'text' or empty" } },
    set: { doc: "Change a variable.", fields: { name: "R variable name (no $)", value: "R expression" } }
};

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
        doc: "Create a microflow: start -> actions in order -> end.",
        fields: { module: "R module name", name: "R microflow name", folder: "optional folder path", parameters: "optional [ { \"name\": ..., \"type\": " + JSON.stringify(DATA_TYPES) + " } ]", returns: "optional return type (default nothing)", returnValue: "required when returns is set: return expression", actions: "optional [ actions, see ACTIONS ]", roles: "optional [ \"Module.Role\" ]" }
    },
    addActions: {
        doc: "Insert actions into an existing microflow. Default: just before the end event (needs exactly one end event).",
        fields: { microflow: "R Module.Microflow", after: "optional \"start\" or the variable name an existing action creates", actions: "R [ actions, see ACTIONS ]" }
    },
    rename: { doc: "Rename a document, entity, attribute, association, enumeration value. Updates references, reports names left in expressions/XPath/Java.", fields: { target: "R qualified name, e.g. Module.Entity.Attribute", newName: "R new short name" } },
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
    lines.push("", "Expressions are Mendix expressions as text: \"'Hello'\", \"$Order/Total * 2\", \"empty\", \"[%CurrentDateTime%]\".");
    lines.push("Anything not covered here: write a change.js with the Model SDK (use: api <Type>).");
    return lines.join("\n");
}

// ---------------------------------------------------------------- helpers

function distance(a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
}

function suggest(word, options, n = 5) {
    const w = String(word).toLowerCase();
    const last = w.split(".").pop();
    return options
        .map(o => {
            const l = o.toLowerCase();
            const score = l === w ? 0 : l.split(".").pop() === last ? 1 : l.includes(last) || last.includes(l.split(".").pop()) ? 2 : 3 + distance(l, w) / Math.max(l.length, w.length);
            return { o, score };
        })
        .filter(x => x.score < 3.5)
        .sort((a, b) => a.score - b.score)
        .slice(0, n)
        .map(x => x.o);
}

function fail(msg, word, options) {
    const s = word !== undefined && options ? suggest(word, options) : [];
    throw new Error(msg + (s.length ? `. Did you mean: ${s.join(", ")}?` : ""));
}

function validate(kind, name, spec, obj, where) {
    const known = Object.keys(spec.fields);
    for (const k of Object.keys(obj)) {
        if (k === kind) continue;
        if (!known.includes(k)) fail(`${where}: unknown field '${k}' for ${name}`, k, known);
    }
    for (const [k, d] of Object.entries(spec.fields)) {
        if (d.startsWith("R ") && (obj[k] === undefined || obj[k] === "")) throw new Error(`${where}: ${name} needs '${k}' (${d.slice(2)})`);
    }
}

const bool = (v, dflt) => (v === undefined || v === null ? dflt : v === true || v === "true" || v === "yes");
const noDollar = v => String(v).replace(/^\$/, "");

function enumValue(enumCls, value, field) {
    const names = Object.keys(enumCls).filter(k => enumCls[k] && enumCls[k] instanceof enumCls);
    const hit = names.find(n => n.toLowerCase() === String(value).toLowerCase());
    if (!hit) fail(`'${value}' is not a valid ${field} (use ${names.join(" | ")})`, value, names);
    return enumCls[hit];
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

    // ------------------------------------------------ microflow building

    const X_STEP = 190;

    function point(el, x, y) {
        el.relativeMiddlePoint = { x, y };
    }

    function flow(m, from, to) {
        const f = mf.SequenceFlow.createIn(m);
        f.origin = from;
        f.destination = to;
        f.originConnectionIndex = 1;
        f.destinationConnectionIndex = 3;
        return f;
    }

    function variablesOf(m) {
        const out = new Map();
        for (const o of m.objectCollection.objects) {
            if (o instanceof mf.MicroflowParameterObject) out.set(o.name, o);
            const a = o instanceof mf.ActionActivity && o.action;
            if (!a) continue;
            for (const key of ["outputVariableName", "variableName"]) if (a[key]) out.set(a[key], o);
        }
        return out;
    }

    async function memberChanges(action, entityQn, set, where) {
        const ent = await entity(entityQn);
        for (const [member, value] of Object.entries(set || {})) {
            const mc = mf.MemberChange.createIn(action);
            mc.type = mf.ChangeActionItemType.Set;
            mc.value = String(value);
            if (member.includes(".")) {
                const assoc = await get(member);
                if (!(assoc instanceof dm.AssociationBase)) throw new Error(`${where}: '${member}' is not an association`);
                mc.association = assoc;
            } else {
                const attr = allAttributes(ent).find(a => a.name === member);
                if (!attr) fail(`${where}: ${entityQn} has no attribute '${member}'`, member, allAttributes(ent).map(a => a.name));
                mc.attribute = attr;
            }
        }
    }

    function allAttributes(ent) {
        const out = [...ent.attributes];
        let g = ent.generalization;
        for (let i = 0; i < 10 && g instanceof dm.Generalization && g.generalization; i++) {
            const parent = g.generalization;
            if (!parent.isLoaded) break;
            out.push(...parent.attributes);
            g = parent.generalization;
        }
        return out;
    }

    // Entity of an object variable in microflow m (parameter, retrieve, create).
    async function entityOfVariable(m, name, where) {
        const v = variablesOf(m).get(noDollar(name));
        if (!v) fail(`${where}: no variable '${name}' before this action in ${m.qualifiedName}`, noDollar(name), [...variablesOf(m).keys()]);
        if (v instanceof mf.MicroflowParameterObject) {
            if (v.variableType && v.variableType.entity) return v.variableType.entityQualifiedName;
        } else {
            const a = v.action;
            if (a.entity) return a.entityQualifiedName;
            if (a.retrieveSource && a.retrieveSource.entity) return a.retrieveSource.entityQualifiedName;
            if (a.retrieveSource && a.retrieveSource.association) {
                const assoc = a.retrieveSource.association;
                return assoc.child ? (assoc.child.qualifiedName || assoc.childQualifiedName) : null;
            }
        }
        throw new Error(`${where}: cannot tell the entity of variable '${name}'`);
    }

    async function action(m, spec, x, y, where) {
        const kind = spec.action;
        const def = ACTIONS[kind];
        if (!def) fail(`${where}: unknown action '${kind}'`, kind, Object.keys(ACTIONS));
        validate("action", kind, def, spec, where);
        const act = mf.ActionActivity.createIn(m.objectCollection);
        point(act, x, y);
        act.size = { width: 120, height: 60 };
        switch (kind) {
            case "retrieve": {
                const a = mf.RetrieveAction.createIn(act);
                a.outputVariableName = noDollar(spec.variable);
                if (spec.from || spec.association) {
                    if (!spec.from || !spec.association) throw new Error(`${where}: association retrieve needs both 'from' and 'association'`);
                    const src = mf.AssociationRetrieveSource.createIn(a);
                    src.startVariableName = noDollar(spec.from);
                    src.association = await get(spec.association);
                } else {
                    if (!spec.entity) throw new Error(`${where}: retrieve needs 'entity' (database) or 'from' + 'association'`);
                    const src = mf.DatabaseRetrieveSource.createIn(a);
                    src.entity = await entity(spec.entity);
                    src.xPathConstraint = spec.xpath || "";
                    const range = mf.ConstantRange.createInDatabaseRetrieveSourceUnderRange(src);
                    range.singleObject = bool(spec.first, false);
                }
                break;
            }
            case "create": {
                const a = mf.CreateObjectAction.createIn(act);
                a.entity = await entity(spec.entity);
                a.outputVariableName = noDollar(spec.variable);
                a.commit = bool(spec.commit, false) ? mf.CommitEnum.Yes : mf.CommitEnum.No;
                await memberChanges(a, spec.entity, spec.set, where);
                break;
            }
            case "change": {
                const a = mf.ChangeObjectAction.createIn(act);
                a.changeVariableName = noDollar(spec.variable);
                a.commit = bool(spec.commit, false) ? mf.CommitEnum.Yes : mf.CommitEnum.No;
                a.refreshInClient = bool(spec.refresh, false);
                await memberChanges(a, await entityOfVariable(m, spec.variable, where), spec.set, where);
                break;
            }
            case "commit": {
                const a = mf.CommitAction.createIn(act);
                a.commitVariableName = noDollar(spec.variable);
                a.withEvents = bool(spec.events, true);
                break;
            }
            case "delete": {
                const a = mf.DeleteAction.createIn(act);
                a.deleteVariableName = noDollar(spec.variable);
                break;
            }
            case "call": {
                const target = await get(spec.microflow);
                if (!(target instanceof mf.Microflow)) throw new Error(`${where}: '${spec.microflow}' is not a microflow`);
                const a = mf.MicroflowCallAction.createIn(act);
                const call = mf.MicroflowCall.createIn(a);
                call.microflow = target;
                const params = target.objectCollection.objects.filter(o => o instanceof mf.MicroflowParameterObject);
                for (const [name, value] of Object.entries(spec.args || {})) {
                    const p = params.find(x => x.name === name);
                    if (!p) fail(`${where}: ${spec.microflow} has no parameter '${name}'`, name, params.map(x => x.name));
                    const pm = mf.MicroflowCallParameterMapping.createIn(call);
                    pm.parameter = p;
                    pm.argument = String(value);
                }
                const missing = params.filter(p => !(p.name in (spec.args || {})));
                if (missing.length) throw new Error(`${where}: ${spec.microflow} needs args for: ${missing.map(p => p.name).join(", ")}`);
                a.useReturnVariable = !!spec.variable;
                a.outputVariableName = spec.variable ? noDollar(spec.variable) : "";
                break;
            }
            case "log": {
                const a = mf.LogMessageAction.createIn(act);
                a.level = enumValue(mf.LogLevel, spec.level || "Info", "log level");
                a.node = `'${String(spec.node || m.qualifiedName.split(".")[0]).replace(/'/g, "''")}'`;
                a.messageTemplate.text = String(spec.message);
                for (const e of spec.args || []) mf.TemplateArgument.createIn(a.messageTemplate).expression = String(e);
                break;
            }
            case "message": {
                const a = mf.ShowMessageAction.createIn(act);
                a.type = enumValue(mf.ShowMessageType, spec.type || "Information", "message type");
                a.blocking = bool(spec.blocking, true);
                await text(a.template.text, spec.text);
                break;
            }
            case "variable": {
                const a = mf.CreateVariableAction.createIn(act);
                a.variableName = noDollar(spec.name);
                a.variableType = await dataType(spec.type);
                a.initialValue = String(spec.value);
                break;
            }
            case "set": {
                const a = mf.ChangeVariableAction.createIn(act);
                a.changeVariableName = noDollar(spec.name);
                a.value = String(spec.value);
                break;
            }
        }
        return act;
    }

    async function buildChain(m, specs, x, y, where) {
        const list = [];
        for (let i = 0; i < specs.length; i++) list.push(await action(m, specs[i], x + i * X_STEP, y, `${where} action ${i + 1}`));
        return list;
    }

    // ------------------------------------------------ operations

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
            for (const a of o.attributes || []) await impl.addAttribute({ entity: `${o.module}.${o.name}`, ...a }, e);
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
            if (!doc.allowedModuleRoles) throw new Error(`'${o.document}' has no allowed roles (only microflows, nanoflows, pages)`);
            for (const qn of [].concat(o.roles)) {
                const r = await get(qn);
                if (!(r instanceof security.ModuleRole)) throw new Error(`'${qn}' is not a module role`);
                if (!doc.allowedModuleRoles.includes(r)) doc.allowedModuleRoles.push(r);
            }
            return `${o.document} <- ${[].concat(o.roles).join(", ")}`;
        },
        async addAccessRule(o) {
            const e = await entity(o.entity);
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
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const m = mf.Microflow.createIn(folder(o.module, o.folder));
            m.name = o.name;
            const start = mf.StartEvent.createIn(m.objectCollection);
            point(start, 100, 200);
            start.size = { width: 20, height: 20 };
            (o.parameters || []).forEach((p, i) => {
                if (!p || !p.name || !p.type) throw new Error(`createMicroflow ${qn}: parameter ${i + 1} needs name and type`);
            });
            for (const [i, p] of (o.parameters || []).entries()) {
                const po = mf.MicroflowParameterObject.createIn(m.objectCollection);
                po.name = p.name;
                po.variableType = await dataType(p.type);
                point(po, 100 + i * 120, 80);
                po.size = { width: 30, height: 30 };
            }
            if (o.returns) {
                m.microflowReturnType = await dataType(o.returns);
                if (o.returnValue === undefined) throw new Error(`createMicroflow ${qn}: returns is set, so returnValue is required`);
            }
            const acts = await buildChain(m, o.actions || [], 100 + X_STEP, 200, qn);
            const end = mf.EndEvent.createIn(m.objectCollection);
            point(end, 100 + (acts.length + 1) * X_STEP, 200);
            end.size = { width: 20, height: 20 };
            end.returnValue = o.returns ? String(o.returnValue) : "";
            const chain = [start, ...acts, end];
            for (let i = 0; i + 1 < chain.length; i++) flow(m, chain[i], chain[i + 1]);
            if (o.roles) await impl.grantAccess({ document: qn, roles: o.roles });
            return `${qn} (${acts.length} action(s))`;
        },
        async addActions(o) {
            const m = await get(o.microflow);
            if (!(m instanceof mf.Microflow)) throw new Error(`'${o.microflow}' is not a microflow`);
            if (!Array.isArray(o.actions) || !o.actions.length) throw new Error("addActions needs actions: [ ... ]");
            const objects = m.objectCollection.objects;
            const sequence = m.flows.filter(f => f instanceof mf.SequenceFlow && !f.isErrorHandler);
            let anchorFlow;
            if (!o.after) {
                const ends = objects.filter(x => x instanceof mf.EndEvent);
                if (ends.length !== 1) throw new Error(`${o.microflow} has ${ends.length} end events; say where with "after": "start" or a variable name`);
                const into = sequence.filter(f => f.destination === ends[0]);
                if (into.length !== 1) throw new Error(`${o.microflow}: ${into.length} flows reach the end event; use "after"`);
                anchorFlow = into[0];
            } else {
                const anchor = o.after === "start" ? objects.find(x => x instanceof mf.StartEvent) : variablesOf(m).get(noDollar(o.after));
                if (!anchor || anchor instanceof mf.MicroflowParameterObject) fail(`${o.microflow}: no action creates variable '${o.after}'`, noDollar(o.after), ["start", ...[...variablesOf(m).keys()]]);
                const out = sequence.filter(f => f.origin === anchor);
                if (out.length !== 1) throw new Error(`${o.microflow}: '${o.after}' has ${out.length} outgoing flows; pick another point`);
                anchorFlow = out[0];
            }
            const from = anchorFlow.origin;
            const to = anchorFlow.destination;
            const fx = from.relativeMiddlePoint.x;
            const y = from.relativeMiddlePoint.y;
            const shift = o.actions.length * X_STEP;
            for (const x of objects) if (x.relativeMiddlePoint.x > fx && !(x instanceof mf.MicroflowParameterObject)) x.relativeMiddlePoint = { x: x.relativeMiddlePoint.x + shift, y: x.relativeMiddlePoint.y };
            const acts = await buildChain(m, o.actions, fx + X_STEP, y, o.microflow);
            anchorFlow.destination = acts[0];
            for (let i = 0; i + 1 < acts.length; i++) flow(m, acts[i], acts[i + 1]);
            flow(m, acts[acts.length - 1], to);
            return `${o.microflow}: ${acts.length} action(s) after ${o.after || "the last step"}`;
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
            const have = doc.allowedModuleRolesQualifiedNames;
            return [].concat(o.roles).filter(r => !have.includes(r)).map(r => `${o.document} does not allow ${r}`);
        },
        async addAccessRule(o) {
            const e = await entity(o.entity);
            const ok = e.accessRules.some(r => [].concat(o.roles).every(x => r.moduleRolesQualifiedNames.includes(x)));
            return ok ? [] : [`${o.entity} has no access rule for ${[].concat(o.roles).join(", ")}`];
        },
        async createMicroflow(o) {
            const m = await get(`${o.module}.${o.name}`);
            const acts = m.objectCollection.objects.filter(x => x instanceof mf.ActionActivity).length;
            const params = m.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject).length;
            const r = [];
            if (acts !== (o.actions || []).length) r.push(`${o.module}.${o.name} has ${acts} actions, expected ${(o.actions || []).length}`);
            if (params !== (o.parameters || []).length) r.push(`${o.module}.${o.name} has ${params} parameters, expected ${(o.parameters || []).length}`);
            return r;
        },
        async addActions(o) {
            const m = await get(o.microflow);
            const vars = variablesOf(m);
            return o.actions
                .map(a => (["retrieve", "create", "call"].includes(a.action) ? a.variable : a.action === "variable" ? a.name : null))
                .filter(v => v && !vars.has(noDollar(v)))
                .map(v => `${o.microflow}: no action creates '${v}'`);
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
    }

    async function checkPlan(plan) {
        const failed = [];
        for (const [i, o] of plan.ops.entries()) {
            const { name } = opOf(o, i);
            // ops later in the plan can undo earlier ones (rename, delete); only check the final state of each name
            const later = plan.ops.slice(i + 1).some(x => ["rename", "delete"].includes(x.op));
            if (later && name !== "rename" && name !== "delete") continue;
            try {
                failed.push(...(await checks[name](o)).map(f => `${i + 1}. ${name}: ${f}`));
            } catch (e) {
                failed.push(`${i + 1}. ${name}: ${e.message}`);
            }
        }
        return failed;
    }

    const api = { get, runPlan, checkPlan, dataType, folder };
    for (const name of Object.keys(OPS)) {
        api[name] = o => {
            validate("op", name, OPS[name], o || {}, `ops.${name}`);
            return impl[name](o);
        };
    }
    return api;
}

module.exports = { bind, help, OPS, ACTIONS };
