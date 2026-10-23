"use strict";
// Domain model details and app settings: calculated attributes, full entity access rules (member rights, XPath,
// create/delete, rights for members added later, members inherited from System entities), association settings
// (type, owner, storage, delete behavior), view entities (OQL), project settings and configurations, image
// collections. Stored as Studio Pro stores them (learned from its projects, see the selftest's domain phase):
// - an access rule lists every member: own attributes, then the parents' (System.Image: PublicThumbnailPath,
//   EnableCaching, then System.FileDocument: FileID, Name, DeleteAfterDownload, Contents, HasContents, Size; read-only
//   ones never more than ReadOnly), then associations the entity owns (also the child side of an owner-Both
//   association). Members of System.User are not listed in a specialization's rules (Administration.Account).
// - DeleteBehavior: ParentDeleteBehavior applies when an object of the owner ('from') side is deleted; error messages
//   are null unless the side prevents the delete.
// - a view entity (Mendix 11): an entity with an OqlViewEntitySource pointing at a ViewEntitySourceDocument of the
//   same name in the module (Oql), Persistable true, attributes with OqlViewValue { Reference = column alias }.
// No Studio Pro sample in the test projects (SDK layout, "never occurs ... SDK defaults" warning): CalculatedValue,
// Settings$ConstantValue/SharedValue/CustomSetting, a prevent-delete error message.
const fs = require("fs");
const path = require("path");
const sdk = require("mendixmodelsdk");
const { fail, suggest, bool, validName, enumValue, setIfAvailable } = require("./ops-util");

const { domainmodels: dm, microflows: mf, datatypes, security, settings, images, texts, constants } = sdk;

const RIGHTS = "ReadWrite | ReadOnly | None";
const DELETE = "keep | delete | prevent";
const DOMAIN_OPS = {
    changeAccessRule: {
        doc: "Change an entity access rule: member rights, XPath, create/delete, rights for members added later, roles, documentation.",
        fields: {
            entity: "R Module.Entity", roles: "R [ \"Module.Role\" ] of the rule to change (as the export shows it)", rule: "optional number when several rules have these roles (1 = first rule of the entity)",
            setRoles: "optional [ \"Module.Role\" ]: the rule's new roles", access: `optional ${RIGHTS}: every member not in 'members' gets this (and members added later, unless newMembers)`,
            members: "optional { \"Attribute\": \"ReadOnly\", \"Assoc\": \"None\", \"System.FileDocument.Name\": \"ReadWrite\" }", newMembers: `optional ${RIGHTS}: rights of members added to the entity later`,
            create: "optional true/false", delete: "optional true/false", xpath: "optional XPath, e.g. [Owner = '[%CurrentUser%]'] (\"\" = no constraint)",
            documentation: "optional text: why the rule exists (\"\" = none)"
        }
    },
    deleteAccessRule: { doc: "Delete an entity access rule.", fields: { entity: "R Module.Entity", roles: "R [ \"Module.Role\" ] of the rule", rule: "optional number when several rules have these roles" } },
    changeAssociation: {
        doc: "Change an association: type, owner, storage, what happens on delete, documentation, or re-point an end (from / to; lists the places that use it).",
        fields: {
            association: "R Module.Association", type: "optional Reference | ReferenceSet", owner: "optional Default | Both", storage: "optional Table | Column (Column: Reference with owner Default only)",
            onDeleteFrom: `optional ${DELETE}: when a 'from' (owner) object is deleted: keep its 'to' objects, delete them too, or prevent the delete while linked`,
            onDeleteTo: `optional ${DELETE}: when a 'to' object is deleted`, messageFrom: "prevent on onDeleteFrom: message shown", messageTo: "prevent on onDeleteTo: message shown",
            documentation: "optional text (\"\" = none)",
            from: "optional Module.Entity: re-point the owner end (same module; existing links are dropped: DATA LOSS)", to: "optional Module.Entity: re-point the other end (same module, or any module for a cross-module association; DATA LOSS)"
        }
    },
    createViewEntity: {
        doc: "Create a view entity (Mendix 11+): a read-only entity whose objects come from an OQL query. Columns become attributes; types come from the selected attributes.",
        fields: {
            module: "R module name", name: "R view entity name", oql: "R OQL, e.g. from Sales.Order as o select o.Number as Number, o.Total as Total",
            attributes: "optional [ { \"name\": \"<column alias>\", \"type\": \"Decimal\" } ] for columns that are not a plain attribute (expressions, aggregates)", folder: "optional folder path for its OQL document"
        }
    },
    changeViewEntity: { doc: "Change the OQL of a view entity; its attributes follow the columns.", fields: { entity: "R Module.ViewEntity", oql: "R the new OQL", attributes: "optional [ { \"name\", \"type\" } ] for expression columns" } },
    setProjectSettings: {
        doc: "Set app settings (App > Settings > Runtime/Model): startup, shutdown and health check microflows, hashing, rounding, first day of week, time zones, sessions, locking, foreign keys, OQL version, Java version, decimals.",
        fields: {
            afterStartup: "optional Module.Microflow (no parameters, returns Boolean), \"\" = none", beforeShutdown: "optional Module.Microflow (no parameters), \"\" = none",
            healthCheck: "optional Module.Microflow (no parameters, returns String), \"\" = none", hashAlgorithm: "optional BCrypt | SSHA256", bcryptCost: "optional number 10..15 (BCrypt)",
            roundingMode: "optional HalfUp | HalfEven", firstDayOfWeek: "optional Default | Sunday | Monday | ... | Saturday", defaultTimeZone: "optional time zone, e.g. Europe/Istanbul (\"\" = none)",
            scheduledEventTimeZone: "optional time zone of scheduled events, e.g. Europe/Istanbul (\"\" = UTC)", multipleSessions: "optional true/false: a user may be signed in more than once",
            optimisticLocking: "optional true/false: refuse to commit an object another user changed meanwhile", backgroundSystemContext: "optional true/false: background tasks run in the system context",
            foreignKeys: "optional true/false: database foreign key constraints", oqlVersion2: "optional true/false: OQL version 2", javaVersion: "optional Java11 | Java17 | Java21 (what the version offers)",
            sslCertificateAlgorithm: "optional PKIX | SunX509", decimalScale: "optional number of decimals stored for Decimal (default 8)"
        }
    },
    setConfiguration: {
        doc: "Create or change a run configuration (App > Settings > Configurations): constant values and custom runtime settings.",
        fields: {
            name: "R configuration name, e.g. Default (a new name creates one like the first configuration)", applicationRootUrl: "optional URL",
            constants: "optional { \"Module.Constant\": \"value\" } (null = use the constant's default)", customSettings: "optional { \"SettingName\": \"value\" } (null = remove)"
        }
    },
    createImageCollection: { doc: "Create an image collection in a module.", fields: { module: "R module name", name: "R collection name, e.g. Images", folder: "optional folder path" } },
    addImage: {
        doc: "Add a PNG, JPG or SVG file to an image collection (for static image widgets and buttons).",
        fields: { collection: "R Module.ImageCollection", file: "R path of a .png/.jpg/.svg inside the export folder, e.g. edits/logo.png", name: "optional image name (default the file name)", replace: "optional true: replace an image with the same name" }
    }
};

// Field mistakes with a hint (merged into the op validation's synonyms).
const DOMAIN_SYNONYMS = {
    createEntity: {
        oql: "a view entity is made with createViewEntity { module, name, oql }",
        external: "external entities come from a consumed OData service: add them in Studio Pro (Integration pane); ops can only read them",
        service: "external entities come from a consumed OData service: add them in Studio Pro (Integration pane); ops can only read them",
        calculated: "calculated attributes: addAttribute with \"calculated\": \"Module.Microflow\"",
        color: "Mendix does not store an entity color (the domain model colors entities by kind); leave out color",
        colour: "Mendix does not store an entity color (the domain model colors entities by kind); leave out color",
        location: "new entities get a free spot next to related ones; to tidy a diagram use arrangeDomainModel { \"module\": ... }",
        position: "new entities get a free spot next to related ones; to tidy a diagram use arrangeDomainModel { \"module\": ... }",
        hasOwner: "write it as \"owner\": true", hasCreatedDate: "write it as \"createdDate\": true", hasChangedDate: "write it as \"changedDate\": true", hasChangedBy: "write it as \"changedBy\": true",
        createdBy: "the creator is the system member \"owner\": true", modifiedDate: "write it as \"changedDate\": true", modifiedBy: "write it as \"changedBy\": true"
    },
    changeEntity: {
        hasOwner: "write it as \"owner\": true", hasCreatedDate: "write it as \"createdDate\": true", hasChangedDate: "write it as \"changedDate\": true", hasChangedBy: "write it as \"changedBy\": true",
        createdBy: "the creator is the system member \"owner\"", modifiedDate: "write it as \"changedDate\"", modifiedBy: "write it as \"changedBy\"", name: "rename it with { \"op\": \"rename\" }"
    },
    addAttribute: { microflow: "use \"calculated\": \"Module.Microflow\"", calculatedBy: "use \"calculated\": \"Module.Microflow\"" },
    changeAttribute: { microflow: "use \"calculated\": \"Module.Microflow\" (or \"stored\": true to store it again)" },
    addAccessRule: { xPath: "write it as \"xpath\"", allowCreate: "write it as \"create\"", allowDelete: "write it as \"delete\"", defaultAccess: "write it as \"newMembers\"" },
    changeAccessRule: { xPath: "write it as \"xpath\"", allowCreate: "write it as \"create\"", allowDelete: "write it as \"delete\"", defaultAccess: "write it as \"newMembers\"" },
    changeAssociation: { deleteBehavior: "use onDeleteFrom / onDeleteTo: keep | delete | prevent", name: "rename it with { \"op\": \"rename\" }", parent: "write it as \"from\": \"Module.Entity\"", child: "write it as \"to\": \"Module.Entity\"" }
};

// Members of System entities as Studio Pro lists them in a specialization's access rule ([name, read-only]).
const SYSTEM_MEMBERS = {
    "System.Image": { parent: "System.FileDocument", attributes: [["PublicThumbnailPath", true], ["EnableCaching", false]] },
    "System.FileDocument": { parent: null, attributes: [["FileID", true], ["Name", false], ["DeleteAfterDownload", false], ["Contents", false], ["HasContents", true], ["Size", true]] },
    "System.User": { parent: null, attributes: [], hidden: ["Name", "Password", "LastLogin", "Blocked", "BlockedSince", "Active", "FailedLogins", "WebServiceUser", "IsAnonymous", "UserRoles", "User_Language", "User_TimeZone"] }
};
// System entities a project entity may inherit from (stored by name, as Studio Pro does).
const SYSTEM_PARENTS = ["System.FileDocument", "System.Image", "System.User"];

const DELETE_KINDS = { keep: "DeleteMeButKeepReferences", delete: "DeleteMeAndReferences", prevent: "DeleteMeIfNoReferences" };
const deleteName = v => Object.keys(DELETE_KINDS).find(k => DELETE_KINDS[k] === v) || v;
const IMAGE_LIMIT = 2 * 1024 * 1024;
const WEEKDAYS = ["Default", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const OQL_WORDS = new Set(["select", "from", "where", "join", "inner", "left", "right", "full", "outer", "on", "group", "by", "order", "having", "limit", "offset", "union", "as", "and", "or", "not", "distinct", "asc", "desc"]);

function timeZones() {
    try {
        return [...new Set([...Intl.supportedValuesOf("timeZone"), "Etc/UTC", "UTC"])];
    } catch {
        return ["Etc/UTC", "UTC", "Europe/Amsterdam", "Europe/Istanbul", "Europe/London", "America/New_York"];
    }
}

// Same text with string literals and the insides of parentheses blanked (same length), so clause keywords and
// commas are only found at the top level.
function masked(s) {
    let out = "", depth = 0, quote = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === quote) quote = null;
            out += " ";
            continue;
        }
        if (c === "'" || c === "\"") {
            quote = c;
            out += " ";
            continue;
        }
        if (c === "(") depth++;
        if (c === ")") depth = Math.max(0, depth - 1);
        out += depth > 0 || c === ")" ? (c === "(" && depth === 1 ? "(" : " ") : c;
    }
    return out;
}

// { columns: [{ alias, expr }], sources: { alias: "Module.Entity" }, entities: [qn] } of an OQL query.
function parseOql(oql) {
    const text = String(oql || "").replace(/\/\*[\s\S]*?\*\//g, m => " ".repeat(m.length)).replace(/--[^\n]*/g, m => " ".repeat(m.length));
    const mk = masked(text);
    const sel = /\bselect\b/i.exec(mk);
    if (!sel) throw new Error("the OQL has no SELECT: write e.g. from Module.Entity as e select e.Name as Name");
    const after = sel.index + sel[0].length;
    const end = /\b(from|where|group\s+by|order\s+by|having|limit|offset|union)\b/i.exec(mk.slice(after));
    const stop = end ? after + end.index : text.length;
    const columns = [];
    let start = after;
    const listMask = mk.slice(0, stop);
    for (let i = after; i <= stop; i++) {
        if (i === stop || listMask[i] === ",") {
            let item = text.slice(start, i).trim().replace(/^distinct\s+/i, "");
            start = i + 1;
            if (!item) throw new Error("the OQL select list has an empty column");
            if (item === "*" || /\.\*$/.test(item)) throw new Error("list the columns (select o.Name as Name, ...): a view entity cannot use *");
            const as = /^([\s\S]*?)\s+as\s+([A-Za-z_]\w*)$/i.exec(item);
            const dotted = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(item);
            if (as) columns.push({ alias: as[2], expr: as[1].trim() });
            else if (dotted) columns.push({ alias: dotted[2], expr: item });
            else if (/^[A-Za-z_]\w*$/.test(item)) columns.push({ alias: item, expr: item });
            else throw new Error(`column '${item}' needs a name: ${item} as Name`);
        }
    }
    const sources = {};
    const entities = [];
    const re = /\b(from|join)\s+([A-Za-z_][\w.]*(?:\/[A-Za-z_][\w.]*)*)(?:\s+(?:as\s+)?([A-Za-z_]\w*))?/gi;
    let m;
    while ((m = re.exec(mk))) {
        const segs = m[2].split("/");
        const ent = segs[segs.length - 1];
        if (!ent.includes(".")) continue;
        entities.push(ent);
        const alias = m[3] && !OQL_WORDS.has(m[3].toLowerCase()) ? m[3] : ent.split(".")[1];
        sources[alias] = ent;
    }
    if (!entities.length) throw new Error("the OQL has no FROM Module.Entity");
    return { columns, sources, entities };
}

function makeDomain(h) {
    const { model, client, get, exists, entity, folder, text, attributeType, loadParents, persistable, isFresh } = h;

    const version = () => (client && client.project ? client.project.version : "11.0.0");
    const major = () => Number(version().split(".")[0]);

    let dmsLoaded = null;
    async function allEntities() {
        if (!dmsLoaded) dmsLoaded = await Promise.all(model.allDomainModels().map(d => d.load()));
        return dmsLoaded.flatMap(d => d.entities);
    }
    async function allAssociations() {
        await allEntities();
        return dmsLoaded.flatMap(d => [...d.associations, ...d.crossAssociations]);
    }

    // The entity and its project parents (loaded), and the System parent it ends at (or null).
    async function chainOf(e) {
        await loadParents(e);
        const chain = [e];
        let sys = null;
        let g = e.generalization;
        for (let i = 0; i < 20 && g instanceof dm.Generalization; i++) {
            const p = g.generalization;
            if (!p) {
                sys = g.generalizationQualifiedName || null;
                break;
            }
            chain.push(p);
            g = p.generalization;
        }
        return { chain, sys };
    }

    const isView = e => !!(dm.OqlViewEntitySource && e.source instanceof dm.OqlViewEntitySource);
    const isExternal = e => !!(e.source && !isView(e) && /RemoteEntitySource/.test(e.source.structureTypeName));
    const sourceName = e => {
        try {
            return e.source.sourceDocumentQualifiedName || "its service";
        } catch {
            return "its service";
        }
    };

    // Ops that add or change attributes refuse view and external entities with what to do instead.
    function assertOwnAttributes(e, qn) {
        if (isView(e)) throw new Error(`${qn} is a view entity: its attributes are the columns of its OQL; change them with { "op": "changeViewEntity", "entity": "${qn}", "oql": "..." }`);
        if (isExternal(e)) throw new Error(`${qn} is an external entity (from ${sourceName(e)}): its attributes come from the OData service; change them in Studio Pro (Integration pane / the entity's properties). Ops only read external entities`);
    }

    const readOnlyAttr = a => a.type instanceof dm.AutoNumberAttributeType || a.value instanceof dm.CalculatedValue || (dm.OqlViewValue && a.value instanceof dm.OqlViewValue);

    // Every member of an access rule of e, in Studio Pro's order.
    async function membersOf(e) {
        const { chain, sys } = await chainOf(e);
        const out = [];
        for (const x of chain) for (const a of x.attributes) out.push({ kind: "attribute", qn: a.qualifiedName, name: a.name, attribute: a, readOnly: readOnlyAttr(a) || isView(e) });
        for (let s = sys; s && SYSTEM_MEMBERS[s]; s = SYSTEM_MEMBERS[s].parent) {
            for (const [n, ro] of SYSTEM_MEMBERS[s].attributes) out.push({ kind: "attribute", qn: `${s}.${n}`, name: n, system: true, readOnly: ro || isView(e) });
        }
        const owners = new Set(chain);
        for (const a of await allAssociations()) {
            let child = null;
            try {
                child = a.child;
            } catch {
                child = null;
            }
            const mine = owners.has(a.parent) || (a.owner === dm.AssociationOwner.Both && owners.has(child));
            if (mine) out.push({ kind: "association", qn: a.qualifiedName, name: a.name, association: a, readOnly: isView(e) });
        }
        return { members: out, sys };
    }

    const memberOf = ma => ma.attributeQualifiedName || ma.associationQualifiedName || "";

    // The member a key of "members" names; did you mean on the rule's members.
    function findMember(members, key, sys, qn) {
        const k = String(key);
        const hit = members.find(m => m.qn === k) || members.find(m => m.name === k) || members.find(m => m.qn.toLowerCase() === k.toLowerCase() || m.name.toLowerCase() === k.toLowerCase());
        if (hit) return hit;
        const userMember = (sys === "System.User" || /^System\.User\./.test(k)) && SYSTEM_MEMBERS["System.User"].hidden.includes(k.split(".").pop());
        if (userMember) throw new Error(`'${k}' is a member of System.User: Studio Pro does not list System.User's members in ${qn}'s access rules (the System module governs them). Give rights on ${qn}'s own members; who sees Name/Password follows the user role's System roles`);
        fail(`${qn} has no member '${k}' (members: ${members.map(m => m.name).join(", ") || "none"})`, k, members.map(m => m.name));
    }

    function right(v, what) {
        return enumValue(dm.MemberAccessRights, v, what);
    }

    function lintXpath(x) {
        const s = String(x).trim();
        if (!s) return "";
        if (!s.startsWith("[") || !s.endsWith("]")) throw new Error(`xpath must be in brackets: [${s.replace(/^\[|\]$/g, "")}]`);
        let depth = 0, quote = false;
        for (const c of s) {
            if (c === "'") quote = !quote;
            if (quote) continue;
            if (c === "[" || c === "(") depth++;
            if (c === "]" || c === ")") depth--;
            if (depth < 0) break;
        }
        if (depth !== 0 || quote) throw new Error(`xpath ${s} has unbalanced brackets or quotes`);
        return s;
    }

    async function moduleRoles(list, where) {
        const out = [];
        for (const qn of [].concat(list || [])) {
            const r = await get(qn).catch(() => null);
            if (!(r instanceof security.ModuleRole)) {
                const all = model.allModuleSecurities().flatMap(s => {
                    try {
                        return s.moduleRoles.map(x => x.qualifiedName);
                    } catch {
                        return [];
                    }
                });
                fail(`${where}'${qn}' is not a module role (Module.Role)`, qn, all);
            }
            out.push(r);
        }
        if (!out.length) throw new Error(`${where}needs at least one module role in 'roles'`);
        return out;
    }

    // Writes rights into rule r of entity e: o.access for every member not in o.members, o.members, newMembers,
    // create/delete/xpath. fresh: a new rule (every member gets a member access in order).
    async function fillRule(r, e, o, fresh) {
        const qn = e.qualifiedName;
        const view = isView(e);
        const { members, sys } = await membersOf(e);
        if (view && (bool(o.create, false) || bool(o.delete, false))) throw new Error(`${qn} is a view entity (read-only): no create or delete`);
        const access = o.access !== undefined ? right(o.access, "access") : fresh ? dm.MemberAccessRights.ReadOnly : null;
        const asked = {};
        for (const [k, v] of Object.entries(o.members || {})) {
            const m = findMember(members, k, sys, qn);
            const rr = right(v, `access of ${k}`);
            if (m.readOnly && rr === dm.MemberAccessRights.ReadWrite) throw new Error(`${k} of ${qn} is ${view ? "in a view entity" : m.system ? "set by the runtime" : "calculated or an AutoNumber"}: ReadOnly at most`);
            asked[m.qn] = rr;
        }
        const cap = (m, x) => (m.readOnly && x === dm.MemberAccessRights.ReadWrite ? dm.MemberAccessRights.ReadOnly : x);
        // keep the existing order; add missing members in Studio Pro's order
        const have = new Map(r.memberAccesses.map(ma => [memberOf(ma), ma]));
        const newDefault = o.newMembers !== undefined ? right(o.newMembers, "newMembers") : access || r.defaultMemberAccessRights;
        for (const m of members) {
            let ma = have.get(m.qn);
            if (!ma) {
                ma = dm.MemberAccess.createIn(r);
                if (m.kind === "association") ma.association = m.association;
                else if (m.system) ma.__attribute.updateWithRawValue(m.qn);
                else ma.attribute = m.attribute;
                ma.accessRights = cap(m, access || newDefault || dm.MemberAccessRights.None);
            }
            if (asked[m.qn] !== undefined) ma.accessRights = asked[m.qn];
            else if (access) ma.accessRights = cap(m, access);
        }
        if (fresh || o.newMembers !== undefined || access) r.defaultMemberAccessRights = view && newDefault === dm.MemberAccessRights.ReadWrite ? dm.MemberAccessRights.ReadOnly : newDefault;
        if (fresh || o.create !== undefined) r.allowCreate = bool(o.create, false);
        if (fresh || o.delete !== undefined) r.allowDelete = bool(o.delete, false);
        if (fresh || o.xpath !== undefined) r.xPathConstraint = lintXpath(o.xpath || "");
        return { members, sys };
    }

    // The rule of e that o.roles (and o.rule) name.
    function ruleOf(e, o) {
        const want = [].concat(o.roles || []);
        const rules = e.accessRules;
        const show = rules.map((r, i) => `rule ${i + 1} [${r.moduleRolesQualifiedNames.join(", ")}]`).join("; ");
        if (!rules.length) throw new Error(`${e.qualifiedName} has no access rules; add one with addAccessRule`);
        if (o.rule !== undefined) {
            const r = rules[Number(o.rule) - 1];
            if (!r) throw new Error(`${e.qualifiedName} has ${rules.length} rule(s): ${show}`);
            if (want.some(x => !r.moduleRolesQualifiedNames.includes(x))) throw new Error(`rule ${o.rule} of ${e.qualifiedName} is [${r.moduleRolesQualifiedNames.join(", ")}], not for ${want.join(", ")}. Rules: ${show}`);
            return r;
        }
        const same = rules.filter(r => r.moduleRolesQualifiedNames.length === want.length && want.every(x => r.moduleRolesQualifiedNames.includes(x)));
        const containing = rules.filter(r => want.every(x => r.moduleRolesQualifiedNames.includes(x)));
        const hits = same.length ? same : containing;
        if (hits.length === 1) return hits[0];
        if (!hits.length) {
            const roles = [...new Set(rules.flatMap(r => r.moduleRolesQualifiedNames))];
            const s = want.flatMap(w => suggest(w, roles, 2));
            throw new Error(`${e.qualifiedName} has no access rule for ${want.join(", ")}${s.length ? `. Did you mean: ${[...new Set(s)].join(", ")}?` : ""} Rules: ${show}`);
        }
        throw new Error(`${e.qualifiedName} has ${hits.length} rules for ${want.join(", ")}: add "rule": <number> (${show})`);
    }

    // Studio Pro gives every access rule a member access for a new attribute/association, with the rule's rights for
    // new members (never more than ReadOnly for calculated/AutoNumber attributes). Also in specializations' rules.
    async function addMemberToRules(owner, member) {
        const ents = (await allEntities()).filter(x => x === owner || x.accessRules.length);
        for (const x of ents) {
            const { chain } = await chainOf(x);
            if (!chain.includes(owner)) continue;
            for (const r of x.accessRules) {
                const qn = member.qualifiedName;
                if (r.memberAccesses.some(ma => memberOf(ma) === qn)) continue;
                const ma = dm.MemberAccess.createIn(r);
                if (member instanceof dm.Attribute) ma.attribute = member;
                else ma.association = member;
                const ro = member instanceof dm.Attribute && readOnlyAttr(member);
                ma.accessRights = ro && r.defaultMemberAccessRights === dm.MemberAccessRights.ReadWrite ? dm.MemberAccessRights.ReadOnly : r.defaultMemberAccessRights;
            }
        }
    }

    // changeAssociation from / to: a new owner (parent) or other end (child). The association stays in its domain model
    // (an owner in another module would move it: refused); member access follows the owner; the places that use it
    // are listed (their paths now start or end at another entity).
    async function repoint(a, o) {
        const qn = a.qualifiedName;
        const notes = [];
        const loss = [];
        const d = a.containerAsDomainModel;
        const oldParent = a.parent;
        const oldChild = a.child;
        const oldParentQn = oldParent ? oldParent.qualifiedName : "?";
        const oldChildQn = a instanceof dm.CrossAssociation ? a.childQualifiedName : oldChild ? oldChild.qualifiedName : "?";
        if (o.from !== undefined) {
            const e = await entity(o.from);
            if (e.containerAsDomainModel !== d) throw new Error(`REFUSED: ${qn} is stored in ${d.containerAsModule.name}'s domain model; an owner in ${e.containerAsDomainModel.containerAsModule.name} would move it. Delete it and addAssociation from ${o.from}, or moveEntity`);
            if (isView(e) || isExternal(e)) throw new Error(`${o.from} is a ${isView(e) ? "view" : "external"} entity: it cannot own an association`);
            if (e !== oldParent) a.parent = e;
        }
        if (o.to !== undefined) {
            const e = await entity(o.to);
            const cross = a instanceof dm.CrossAssociation;
            if (!cross && e.containerAsDomainModel !== d) throw new Error(`REFUSED: ${qn} links entities of ${d.containerAsModule.name}; ${o.to} is in another module (that is a cross-module association). Delete it and addAssociation to ${o.to}`);
            if (cross && e.containerAsDomainModel === d) throw new Error(`REFUSED: ${qn} is a cross-module association; ${o.to} is in its own module. Delete it and addAssociation to ${o.to}`);
            if (isExternal(e)) throw new Error(`${o.to} is an external entity: link it in Studio Pro`);
            if (e !== oldChild) a.child = e;
        }
        const newParentQn = a.parent.qualifiedName;
        const newChildQn = a instanceof dm.CrossAssociation ? a.childQualifiedName : a.child.qualifiedName;
        if (newParentQn === oldParentQn && newChildQn === oldChildQn) {
            notes.push(`ends unchanged: ${oldParentQn} -> ${oldChildQn}`);
            return { notes, loss };
        }
        // a persistable owner cannot point to a non-persistable entity
        if (persistable(a.parent) && !persistable(a.child)) throw new Error(`REFUSED: ${newParentQn} is persistable and ${newChildQn} is not; a persistable entity cannot own an association to a non-persistable one`);
        // member access: rules of entities that no longer have it lose it, the new ends' rules get it
        const ends = [a.parent, ...(a.owner === dm.AssociationOwner.Both ? [a.child] : [])];
        for (const x of await allEntities()) {
            if (!x.accessRules.length) continue;
            const { chain } = await chainOf(x);
            if (ends.some(en => chain.includes(en))) continue;
            for (const r of x.accessRules) for (const ma of [...r.memberAccesses]) if (memberOf(ma) === qn) ma.delete();
        }
        for (const en of ends) await addMemberToRules(en, a);
        notes.push(`ends ${oldParentQn} -> ${oldChildQn} became ${newParentQn} -> ${newChildQn}`);
        await model.flushChanges();
        const g = require("./refs").graph(client);
        const dmUnits = new Set(g.units.filter(u => u.type === "DomainModels$DomainModel").map(u => u.id));
        const uses = g.usesOf(qn, false).filter(u => !dmUnits.has(u.unit));
        const docs = [...new Set(uses.map(u => `${u.doc} (${u.place})`))];
        if (docs.length) notes.push(`CHECK these places that use ${qn} (paths, retrieves, data sources): ${docs.slice(0, 12).join(", ")}${docs.length > 12 ? `, and ${docs.length - 12} more` : ""}`);
        const stored = persistable(a.parent) && !isFresh(qn);
        if (stored) loss.push(`existing ${qn} links between ${oldParentQn} and ${oldChildQn} objects are dropped when the app next starts`);
        return { notes, loss };
    }

    // ReadWrite on a now read-only attribute becomes ReadOnly in every rule.
    async function capMember(attr) {
        const qn = attr.qualifiedName;
        let n = 0;
        for (const x of await allEntities()) {
            for (const r of x.accessRules) {
                for (const ma of r.memberAccesses) {
                    if (memberOf(ma) === qn && ma.accessRights === dm.MemberAccessRights.ReadWrite) {
                        ma.accessRights = dm.MemberAccessRights.ReadOnly;
                        n++;
                    }
                }
            }
        }
        return n;
    }

    // Removes the member accesses of association a from the rules of entities in `ents`.
    async function dropMember(a, keepOwners) {
        const qn = a.qualifiedName;
        for (const x of await allEntities()) {
            const { chain } = await chainOf(x);
            if (chain.some(c => keepOwners.has(c))) continue;
            for (const r of x.accessRules) for (const ma of [...r.memberAccesses]) if (memberOf(ma) === qn) ma.delete();
        }
    }

    // ------------------------------------------------ calculated attributes

    // Return type a microflow needs for attribute a ([datatype class, label]); null when it cannot be calculated.
    function wantedReturn(a) {
        const t = a.type;
        if (t instanceof dm.StringAttributeType) return [datatypes.StringType, "String"];
        if (t instanceof dm.IntegerAttributeType || t instanceof dm.LongAttributeType) return [datatypes.IntegerType, t instanceof dm.LongAttributeType ? "Long" : "Integer"];
        if (t instanceof dm.DecimalAttributeType) return [datatypes.DecimalType, "Decimal"];
        if (t instanceof dm.BooleanAttributeType) return [datatypes.BooleanType, "Boolean"];
        if (t instanceof dm.DateTimeAttributeType) return [datatypes.DateTimeType, "DateTime"];
        if (t instanceof dm.EnumerationAttributeType) return [datatypes.EnumerationType, `Enum(${t.enumerationQualifiedName})`];
        return null;
    }

    async function calculate(a, flowQn) {
        const e = a.containerAsEntity;
        const qn = `${e.qualifiedName}.${a.name}`;
        const want = wantedReturn(a);
        if (!want) throw new Error(`${qn} is ${a.type.structureTypeName.split("$")[1].replace("AttributeType", "")}: such an attribute cannot be calculated (String, Integer, Long, Decimal, Boolean, DateTime, Enum can)`);
        const flow = await get(flowQn);
        if (flow instanceof mf.Nanoflow) throw new Error(`${flowQn} is a nanoflow: a calculated attribute needs a microflow`);
        if (!(flow instanceof mf.Microflow)) throw new Error(`'${flowQn}' is not a microflow`);
        const params = flow.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject);
        if (params.length > 1) throw new Error(`${flowQn} has ${params.length} parameters; a calculated attribute's microflow has none or one: the ${e.qualifiedName} object`);
        if (params.length) {
            const t = params[0].variableType;
            const { chain, sys } = await chainOf(e);
            const okEntity = t instanceof datatypes.ObjectType && (chain.some(c => c.qualifiedName === t.entityQualifiedName) || t.entityQualifiedName === sys);
            if (!okEntity) throw new Error(`${flowQn}'s parameter '${params[0].name}' must be a ${e.qualifiedName} object (it is ${t ? t.structureTypeName.split("$")[1] : "?"}${t && t.entityQualifiedName ? " of " + t.entityQualifiedName : ""})`);
        }
        const ret = flow.microflowReturnType;
        const enumOk = !(ret instanceof datatypes.EnumerationType) || ret.enumerationQualifiedName === a.type.enumerationQualifiedName;
        if (!(ret instanceof want[0]) || !enumOk) throw new Error(`${flowQn} must return ${want[1]} for ${qn} (it returns ${ret ? ret.structureTypeName.split("$")[1].replace("Type", "") : "nothing"})`);
        const cv = dm.CalculatedValue.createIn(a);
        cv.microflow = flow;
        cv.passEntity = params.length === 1;
        const capped = await capMember(a);
        return capped ? `; ${capped} ReadWrite right(s) on it became ReadOnly` : "";
    }

    // ------------------------------------------------ associations

    async function associationSettings(a, o, fresh) {
        const notes = [];
        const loss = [];
        const qn = a.qualifiedName || o.association;
        const stored = !fresh && persistable(a.parent) && (() => {
            try {
                return persistable(a.child);
            } catch {
                return true;
            }
        })();
        const wasType = a.type;
        if (o.type !== undefined) {
            const t = enumValue(dm.AssociationType, o.type, "association type");
            if (t !== a.type) {
                a.type = t;
                if (t === dm.AssociationType.ReferenceSet && a.storageFormat === dm.AssociationStorage.Column) {
                    a.storageFormat = dm.AssociationStorage.Table;
                    notes.push("storage Column -> Table (a reference set is stored in a table)");
                }
                if (stored && !isFresh(qn)) {
                    loss.push(wasType === dm.AssociationType.ReferenceSet ? `${a.name} becomes a Reference: a '${a.parent.name}' keeps at most one '${a.child.name}'; extra links are dropped when the app next starts` :
                        `${a.name} becomes a ReferenceSet: the runtime moves the stored links on the next start; check them (back up the database first)`);
                }
            }
        }
        if (o.owner !== undefined) {
            const was = a.owner;
            a.owner = enumValue(dm.AssociationOwner, o.owner, "association owner");
            if (was !== a.owner && !fresh) {
                if (a.owner === dm.AssociationOwner.Both) await addMemberToRules(a.child, a);
                else await dropMember(a, new Set([a.parent]));
                notes.push(`access rules of ${a.child.name} ${a.owner === dm.AssociationOwner.Both ? "now list" : "no longer list"} ${a.name}`);
            }
        }
        const storageDefault = async () => {
            const ps = model.allProjectSettings()[0];
            const s = ps && (await ps.load());
            const ms = s && s.settingsParts.find(p => settings.ModelerSettings && p instanceof settings.ModelerSettings);
            try {
                return ms ? ms.defaultAssociationStorage : null;
            } catch {
                return null;
            }
        };
        let storage = o.storage !== undefined ? enumValue(dm.AssociationStorage, o.storage, "storage") : null;
        if (storage === null && fresh && a.type === dm.AssociationType.Reference && a.owner === dm.AssociationOwner.Default) storage = await storageDefault();
        if (storage) {
            if (storage === dm.AssociationStorage.Column && (a.type !== dm.AssociationType.Reference || a.owner !== dm.AssociationOwner.Default)) {
                if (o.storage !== undefined) throw new Error(`storage Column is for a Reference with owner Default (many-to-one); ${qn} is ${a.type.name} with owner ${a.owner.name}: use Table`);
            } else if (a.storageFormat !== storage) {
                if (!setIfAvailable(a, "storageFormat", storage)) {
                    if (o.storage !== undefined) throw new Error(`association storage is set in Mendix 10.21 and later; this project is ${version()}`);
                } else if (!fresh) notes.push(`storage -> ${storage.name}: the runtime moves the stored links on the next start (back up the database first)`);
            }
        }
        const db = a.deleteBehavior || dm.AssociationDeleteBehavior.createIn(a);
        for (const [side, field, msgField] of [["parent", "onDeleteFrom", "messageFrom"], ["child", "onDeleteTo", "messageTo"]]) {
            const kind = o[field];
            if (kind === undefined) {
                if (o[msgField] !== undefined && db[`${side}DeleteBehavior`] !== dm.DeletingBehavior.DeleteMeIfNoReferences) throw new Error(`${msgField} is the message of "${field}": "prevent"; add that`);
                if (o[msgField] !== undefined) await text(db[`${side}ErrorMessage`] || texts.Text[`createInAssociationDeleteBehaviorUnder${side === "parent" ? "Parent" : "Child"}ErrorMessage`](db), o[msgField]);
                continue;
            }
            const want = DELETE_KINDS[String(kind).toLowerCase()];
            if (!want) fail(`${field} must be keep | delete | prevent, got '${kind}'`, kind, Object.keys(DELETE_KINDS));
            db[`${side}DeleteBehavior`] = dm.DeletingBehavior[want];
            const msgProp = `${side}ErrorMessage`;
            if (want === "DeleteMeIfNoReferences") {
                if (o[msgField] === undefined && !db[msgProp]) throw new Error(`"${field}": "prevent" needs "${msgField}": the message shown when the delete is refused`);
                if (o[msgField] !== undefined) await text(db[msgProp] || texts.Text[`createInAssociationDeleteBehaviorUnder${side === "parent" ? "Parent" : "Child"}ErrorMessage`](db), o[msgField]);
            } else {
                if (o[msgField] !== undefined) throw new Error(`${msgField} is only for "${field}": "prevent"`);
                if (db[msgProp]) db[msgProp].delete();
            }
            const [me, other] = side === "parent" ? [a.parent.name, a.child.name] : [a.child.name, a.parent.name];
            notes.push(`deleting a ${me} ${want === "DeleteMeAndReferences" ? `also deletes its ${other} object(s)` : want === "DeleteMeIfNoReferences" ? `is refused while it has ${other} object(s)` : `keeps its ${other} object(s)`}`);
        }
        return { notes, loss };
    }

    // ------------------------------------------------ view entities

    async function attributeSpec(attr) {
        const t = attr.type;
        if (t instanceof dm.StringAttributeType) return `String(${t.length ? t.length : "unlimited"})`;
        if (t instanceof dm.AutoNumberAttributeType || t instanceof dm.LongAttributeType) return "Long";
        if (t instanceof dm.IntegerAttributeType) return "Integer";
        if (t instanceof dm.DecimalAttributeType) return "Decimal";
        if (t instanceof dm.BooleanAttributeType) return "Boolean";
        if (t instanceof dm.DateTimeAttributeType) return "DateTime";
        if (t instanceof dm.EnumerationAttributeType) return `Enum(${t.enumerationQualifiedName})`;
        return null;
    }

    // [{ alias, spec, localize }] for the columns of oql; explicit types from attrs.
    async function viewColumns(oql, attrs) {
        const { columns, sources, entities } = parseOql(oql);
        for (const qn of entities) {
            const e = await get(qn).catch(() => null);
            if (!(e instanceof dm.Entity)) {
                const all = (await allEntities()).map(x => x.qualifiedName);
                fail(`the OQL uses '${qn}', which is not an entity`, qn, all);
            }
        }
        const given = {};
        for (const [i, x] of [].concat(attrs || []).entries()) {
            if (!x || !x.name || !x.type) throw new Error(`attributes[${i}] needs name and type, e.g. { "name": "Total", "type": "Decimal" }`);
            given[x.name] = x.type;
        }
        const names = columns.map(c => c.alias);
        for (const n of Object.keys(given)) if (!names.includes(n)) fail(`attributes: '${n}' is not a column of the OQL (columns: ${names.join(", ")})`, n, names);
        const seen = new Set();
        const out = [];
        const missing = [];
        for (const c of columns) {
            validName(c.alias, "column name");
            if (seen.has(c.alias.toLowerCase())) throw new Error(`two columns are named ${c.alias}`);
            seen.add(c.alias.toLowerCase());
            let spec = given[c.alias];
            let localize;
            if (!spec) {
                const m = /^(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)$/.exec(c.expr);
                const ent = m && (m[1] ? sources[m[1]] : entities.length === 1 ? entities[0] : null);
                const e = ent && (await get(ent).catch(() => null));
                if (e instanceof dm.Entity) {
                    const { chain } = await chainOf(e);
                    const attr = chain.flatMap(x => x.attributes).find(a => a.name === m[2]);
                    if (attr) {
                        spec = await attributeSpec(attr);
                        if (!spec) throw new Error(`column ${c.alias}: ${ent}.${m[2]} is ${attr.type.structureTypeName.split("$")[1].replace("AttributeType", "")}, which a view entity cannot show`);
                        if (attr.type instanceof dm.DateTimeAttributeType) localize = attr.type.localizeDate;
                    }
                }
            }
            if (!spec) missing.push(`${c.alias} (${c.expr})`);
            out.push({ alias: c.alias, spec, localize });
        }
        if (missing.length) throw new Error(`give the type of these columns (not a plain attribute): ${missing.join(", ")}. Add "attributes": [ { "name": "${missing[0].split(" ")[0]}", "type": "Decimal" } ]`);
        return out;
    }

    function assertViewVersion() {
        const v = version();
        if (major() < 11) throw new Error(`view entities: this project is Mendix ${v}. In Mendix 10 they were a beta stored differently (no Studio Pro sample of that layout); create it in Studio Pro (right-click the module > Add other > View entity), or upgrade to Mendix 11`);
        if (!dm.ViewEntitySourceDocument || !dm.OqlViewValue) throw new Error("this Model SDK has no view entities");
    }

    async function setColumns(e, cols) {
        const keep = new Map(e.attributes.map(a => [a.name, a]));
        const removed = [];
        for (const a of [...e.attributes]) {
            if (cols.some(c => c.alias === a.name)) continue;
            const used = client.referencesTo(a.qualifiedName);
            removed.push(a.name + (used.length ? ` (STILL USED BY ${used.join(", ")})` : ""));
            a.delete();
        }
        const added = [];
        for (const c of cols) {
            let a = keep.get(c.alias);
            if (!a || removed.some(r => r.split(" ")[0] === c.alias)) {
                a = dm.Attribute.createIn(e);
                a.name = c.alias;
                added.push(c.alias);
            }
            const before = a.type ? await attributeSpec(a) : null;
            if (before !== c.spec) await attributeType(a, c.spec);
            if (c.localize !== undefined && a.type instanceof dm.DateTimeAttributeType) a.type.localizeDate = c.localize;
            const v = dm.OqlViewValue.createIn(a);
            v.reference = c.alias;
            if (added.includes(c.alias)) await addMemberToRules(e, a);
        }
        // the OQL's column order
        const order = cols.map(c => c.alias);
        const list = e.attributes;
        const sorted = [...list].sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name));
        if (sorted.some((x, i) => x !== list[i])) {
            for (const x of sorted) {
                list.remove(x);
                list.push(x);
            }
        }
        return { added, removed };
    }

    // ------------------------------------------------ settings

    async function settingsPart(cls, label) {
        const ps = model.allProjectSettings()[0];
        const s = ps && (await ps.load());
        const part = s && s.settingsParts.find(p => p instanceof cls);
        if (!part) throw new Error(`the project has no ${label} settings`);
        return part;
    }

    async function lifecycleFlow(qn, what, check) {
        if (qn === "" || qn === null) return null;
        const flow = await get(qn);
        if (!(flow instanceof mf.Microflow)) throw new Error(`${what}: '${qn}' is not a microflow`);
        if (flow.objectCollection.objects.some(x => x instanceof mf.MicroflowParameterObject)) throw new Error(`${what}: ${qn} has parameters; it must have none`);
        if (check) check(flow);
        return flow;
    }

    // ------------------------------------------------ images

    function exportFolder() {
        const f = client && client.changeFile;
        if (!f) return process.cwd();
        const dir = path.dirname(f);
        return path.basename(dir) === "edits" ? path.dirname(dir) : dir;
    }

    function imageFile(file) {
        const base = exportFolder();
        const full = path.resolve(base, String(file));
        const rel = path.relative(base, full);
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`file '${file}' is outside the export folder (${base}); copy it into the export folder (e.g. edits/) first`);
        if (!fs.existsSync(full)) {
            const dir = path.dirname(full);
            const near = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /\.(png|jpe?g|svg)$/i.test(n)) : [];
            fail(`no file '${file}' (looked in ${path.relative(base, dir) || "."}/)`, path.basename(full), near);
        }
        const bytes = fs.readFileSync(full);
        if (bytes.length > IMAGE_LIMIT) throw new Error(`${file} is ${(bytes.length / 1048576).toFixed(1)} MB; images in a collection are at most ${IMAGE_LIMIT / 1048576} MB (they ship with every page load): make it smaller`);
        const head = bytes.slice(0, 512).toString("latin1");
        let format = null;
        if (bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) format = "Png";
        else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) format = "Jpg";
        else if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) format = "Svg";
        if (!format) throw new Error(`${file} is not a PNG, JPG or SVG image (by its content)`);
        return { bytes, format, full };
    }

    async function imageCollection(qn) {
        const c = await get(qn).catch(() => null);
        if (c instanceof images.ImageCollection) return c;
        const all = model.allImageCollections().map(x => x.qualifiedName);
        fail(`'${qn}' is not an image collection${all.length ? "" : " (the project has none; createImageCollection)"}`, qn, all);
    }

    // ------------------------------------------------ operations

    const impl = {
        async addAccessRule(o) {
            const e = await entity(o.entity);
            const roles = await moduleRoles(o.roles, "");
            const rule = dm.AccessRule.createInEntityUnderAccessRules(e);
            for (const r of roles) rule.moduleRoles.push(r);
            const { members, sys } = await fillRule(rule, e, o, true);
            if (o.documentation !== undefined) rule.documentation = String(o.documentation).replace(/\r?\n/g, "\r\n");
            const sysNote = sys === "System.User" ? " (System.User's own members are not listed, as in Studio Pro)" : sys ? ` (with ${sys} members)` : "";
            return `${o.entity} for ${roles.map(r => r.qualifiedName).join(", ")}: ${members.length} member(s)${sysNote}`;
        },
        async changeAccessRule(o) {
            const e = await entity(o.entity);
            const r = ruleOf(e, o);
            const done = [];
            if (o.setRoles !== undefined) {
                const roles = await moduleRoles(o.setRoles, "setRoles: ");
                r.moduleRoles.clear();
                for (const x of roles) r.moduleRoles.push(x);
                done.push(`roles ${roles.map(x => x.qualifiedName).join(", ")}`);
            }
            const changes = ["access", "members", "newMembers", "create", "delete", "xpath"].filter(k => o[k] !== undefined);
            if (!changes.length && !done.length && o.documentation === undefined) throw new Error("changeAccessRule needs something to change: access, members, newMembers, create, delete, xpath, setRoles or documentation");
            if (changes.length || done.length) await fillRule(r, e, o, false);
            if (o.documentation !== undefined) {
                r.documentation = String(o.documentation).replace(/\r?\n/g, "\r\n");
                done.push(r.documentation ? "documentation set" : "no documentation");
            }
            if (o.access !== undefined) done.push(`every member ${o.access}`);
            if (o.members) done.push(Object.entries(o.members).map(([k, v]) => `${k} ${v}`).join(", "));
            if (o.newMembers !== undefined) done.push(`new members ${o.newMembers}`);
            if (o.create !== undefined) done.push(`create ${bool(o.create, false) ? "yes" : "no"}`);
            if (o.delete !== undefined) done.push(`delete ${bool(o.delete, false) ? "yes" : "no"}`);
            if (o.xpath !== undefined) done.push(o.xpath ? `xpath ${o.xpath}` : "no xpath");
            return `${o.entity} [${[].concat(o.roles).join(", ")}]: ${done.join("; ")}`;
        },
        async deleteAccessRule(o) {
            const e = await entity(o.entity);
            const r = ruleOf(e, o);
            const roles = r.moduleRolesQualifiedNames.join(", ");
            r.delete();
            const left = e.accessRules.filter(x => x.moduleRolesQualifiedNames.some(n => [].concat(o.roles).includes(n)));
            return `${o.entity} [${roles}]` + (left.length ? "" : `\n      NOTE: ${[].concat(o.roles).join(", ")} can no longer read or change ${o.entity}`);
        },
        async changeAssociation(o) {
            const a = await get(o.association);
            if (!(a instanceof dm.AssociationBase)) throw new Error(`'${o.association}' is not an association`);
            if (a.source) throw new Error(`${o.association} belongs to a ${isView(a.parent) ? "view entity (its OQL)" : "consumed OData service"}: change it there`);
            const keys = ["type", "owner", "storage", "onDeleteFrom", "onDeleteTo", "messageFrom", "messageTo"].filter(k => o[k] !== undefined);
            if (!keys.length && o.documentation === undefined && o.from === undefined && o.to === undefined) throw new Error("changeAssociation needs type, owner, storage, onDeleteFrom/onDeleteTo, messageFrom/messageTo, documentation, from or to");
            const ends = o.from !== undefined || o.to !== undefined ? await repoint(a, o) : { notes: [], loss: [] };
            const { notes, loss } = keys.length ? await associationSettings(a, o, false) : { notes: [], loss: [] };
            notes.unshift(...ends.notes);
            loss.unshift(...ends.loss);
            if (o.documentation !== undefined) {
                a.documentation = String(o.documentation).replace(/\r?\n/g, "\r\n");
                notes.push(a.documentation ? "documentation set" : "documentation removed");
            }
            const kind = `${a.type.name}, owner ${a.owner.name}${a.storageFormat ? ", " + a.storageFormat.name : ""}, delete ${a.parent.name}: ${deleteName(a.deleteBehavior.parentDeleteBehavior.name)}, delete ${a.child.name}: ${deleteName(a.deleteBehavior.childDeleteBehavior.name)}`;
            return `${o.association}: ${kind}` + notes.map(n => `\n      NOTE: ${n}`).join("") + loss.map(l => `\n      DATA LOSS: ${l}`).join("");
        },
        async createViewEntity(o) {
            assertViewVersion();
            validName(o.name, "view entity name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            if (model.allViewEntitySourceDocuments().some(d => d.qualifiedName === qn)) throw new Error(`${qn} already exists (its OQL document)`);
            const cols = await viewColumns(o.oql, o.attributes);
            const d = await h.domainModel(o.module);
            const doc = dm.ViewEntitySourceDocument.createIn(folder(o.module, o.folder));
            doc.name = o.name;
            doc.oql = String(o.oql);
            const e = dm.Entity.createIn(d);
            e.name = o.name;
            const xs = d.entities.filter(x => x !== e).map(x => x.location.x);
            e.location = { x: xs.length ? Math.max(...xs) + 250 : 100, y: 100 };
            if (e.generalization instanceof dm.NoGeneralization) e.generalization.persistable = true;
            const src = dm.OqlViewEntitySource.createIn(e);
            src.sourceDocument = doc;
            h.markFresh(qn);
            await setColumns(e, cols);
            client.warn(`${qn}: Studio Pro checks the OQL when it opens the app (the Model SDK marks view entities experimental); look at its Errors pane once`);
            return `${qn} (view entity: ${cols.map(c => `${c.alias} ${c.spec}`).join(", ")})`;
        },
        async changeViewEntity(o) {
            assertViewVersion();
            const e = await entity(o.entity);
            if (!isView(e)) throw new Error(`${o.entity} is not a view entity`);
            const doc = e.source.sourceDocument;
            if (!doc) throw new Error(`${o.entity} has no OQL document`);
            const cols = await viewColumns(o.oql, o.attributes);
            const d = await doc.load();
            d.oql = String(o.oql);
            const { added, removed } = await setColumns(e, cols);
            return `${o.entity}: ${cols.length} column(s)` + (added.length ? `, added ${added.join(", ")}` : "") + (removed.length ? `\n      REMOVED attributes: ${removed.join(", ")}` : "");
        },
        async setProjectSettings(o) {
            const keys = Object.keys(DOMAIN_OPS.setProjectSettings.fields).filter(k => o[k] !== undefined);
            if (!keys.length) throw new Error(`setProjectSettings needs one of: ${Object.keys(DOMAIN_OPS.setProjectSettings.fields).join(", ")}`);
            const rs = await settingsPart(settings.RuntimeSettings, "runtime");
            const done = [];
            if (o.afterStartup !== undefined) {
                rs.afterStartupMicroflow = await lifecycleFlow(o.afterStartup, "afterStartup", f => {
                    if (!(f.microflowReturnType instanceof datatypes.BooleanType)) throw new Error(`afterStartup: ${o.afterStartup} must return Boolean (true = the app starts)`);
                });
                done.push(`after startup ${o.afterStartup || "none"}`);
            }
            if (o.beforeShutdown !== undefined) {
                rs.beforeShutdownMicroflow = await lifecycleFlow(o.beforeShutdown, "beforeShutdown");
                done.push(`before shutdown ${o.beforeShutdown || "none"}`);
            }
            if (o.healthCheck !== undefined) {
                rs.healthCheckMicroflow = await lifecycleFlow(o.healthCheck, "healthCheck", f => {
                    if (!(f.microflowReturnType instanceof datatypes.StringType)) throw new Error(`healthCheck: ${o.healthCheck} must return String (empty = healthy, else the reason)`);
                });
                done.push(`health check ${o.healthCheck || "none"}`);
            }
            if (o.hashAlgorithm !== undefined) {
                const allowed = ["BCrypt", "SSHA256"];
                const hit = allowed.find(x => x.toLowerCase() === String(o.hashAlgorithm).toLowerCase());
                if (!hit) fail(`hashAlgorithm must be BCrypt or SSHA256 (SHA256 and MD5 are deprecated)`, o.hashAlgorithm, allowed);
                if (rs.hashAlgorithm.name !== hit) {
                    rs.hashAlgorithm = settings.HashAlgorithmType[hit];
                    client.warn(`hash algorithm is now ${hit}: sign in with an existing user after the next start to check that old passwords still work`);
                }
                done.push(`hash ${hit}`);
            }
            if (o.bcryptCost !== undefined) {
                const n = Number(o.bcryptCost);
                if (!Number.isInteger(n) || n < 10 || n > 15) throw new Error("bcryptCost must be a whole number 10..15 (higher = slower sign-in)");
                rs.bcryptCost = n;
                done.push(`bcrypt cost ${n}`);
            }
            if (o.roundingMode !== undefined) {
                rs.roundingMode = enumValue(settings.RoundingMode, o.roundingMode, "roundingMode");
                done.push(`rounding ${rs.roundingMode.name}`);
            }
            if (o.firstDayOfWeek !== undefined) {
                const hit = WEEKDAYS.find(x => x.toLowerCase() === String(o.firstDayOfWeek).toLowerCase());
                if (!hit) fail(`firstDayOfWeek must be ${WEEKDAYS.join(" | ")}`, o.firstDayOfWeek, WEEKDAYS);
                rs.firstDayOfWeek = settings.FirstDayOfWeekEnum[hit];
                done.push(`first day ${hit}`);
            }
            if (o.defaultTimeZone !== undefined) {
                const z = String(o.defaultTimeZone);
                const zones = timeZones();
                if (z && !zones.includes(z)) {
                    const city = zones.filter(x => x.split("/").pop().toLowerCase().replace(/_/g, " ") === z.toLowerCase().replace(/_/g, " "));
                    const s = city.length ? city : suggest(z, zones, 5);
                    throw new Error(`'${z}' is not a time zone (Region/City, e.g. Europe/Istanbul)` + (s.length ? `. Did you mean: ${s.join(", ")}?` : ""));
                }
                rs.defaultTimeZoneCode = z;
                done.push(`time zone ${z || "none"}`);
            }
            if (o.scheduledEventTimeZone !== undefined) {
                const z = String(o.scheduledEventTimeZone);
                if (z && !timeZones().includes(z)) fail(`scheduledEventTimeZone: '${z}' is not a time zone (Region/City, e.g. Europe/Istanbul)`, z, timeZones());
                rs.scheduledEventTimeZoneCode = z;
                done.push(`scheduled event time zone ${z || "UTC"}`);
            }
            const v = client.project.version;
            const setOr = (prop, value, field) => {
                if (!setIfAvailable(rs, prop, value)) throw new Error(`${field} is not a setting of Mendix ${v}`);
            };
            for (const [f, prop, what] of [["multipleSessions", "allowUserMultipleSessions", "multiple sessions"], ["optimisticLocking", "enableDataStorageOptimisticLocking", "optimistic locking"],
                ["backgroundSystemContext", "useSystemContextForBackgroundTasks", "system context for background tasks"], ["foreignKeys", "useDatabaseForeignKeyConstraints", "foreign key constraints"], ["oqlVersion2", "useOQLVersion2", "OQL version 2"]]) {
                if (o[f] === undefined) continue;
                if (o[f] !== true && o[f] !== false && o[f] !== "true" && o[f] !== "false") throw new Error(`${f} must be true or false`);
                const on = o[f] === true || o[f] === "true";
                setOr(prop, on, f);
                done.push(`${what} ${on ? "on" : "off"}`);
                if (f === "foreignKeys" && !on) client.warn("foreign key constraints off: the database no longer guards associations; only switch off for a migration that needs it");
                if (f === "oqlVersion2" && on) client.warn("OQL version 2 changes how some OQL queries behave (data sets, view entities, OQL in Java): test them after the switch");
            }
            if (o.javaVersion !== undefined) {
                if (!settings.JavaVersion) throw new Error(`javaVersion is not a setting of Mendix ${v}`);
                setOr("javaVersion", enumValue(settings.JavaVersion, o.javaVersion, "javaVersion"), "javaVersion");
                done.push(`Java ${rs.javaVersion.name}`);
                client.warn(`Java version ${rs.javaVersion.name}: the build uses that JDK; Java actions and userlib jars must compile with it`);
            }
            if (o.sslCertificateAlgorithm !== undefined) {
                setOr("sslCertificateAlgorithm", enumValue(settings.SslCertificateAlgorithm, o.sslCertificateAlgorithm, "sslCertificateAlgorithm"), "sslCertificateAlgorithm");
                done.push(`SSL certificate algorithm ${rs.sslCertificateAlgorithm.name}`);
            }
            if (o.decimalScale !== undefined) {
                const n = Number(o.decimalScale);
                if (!(Number.isInteger(n) && n >= 1 && n <= 20)) throw new Error("decimalScale is a whole number 1..20 (default 8)");
                setOr("decimalScale", n, "decimalScale");
                done.push(`decimal scale ${n}`);
                if (n < 8) client.warn(`decimal scale ${n}: stored Decimal values with more decimals are rounded when the app next starts (DATA LOSS of precision)`);
            }
            return done.join(", ");
        },
        async setConfiguration(o) {
            const cs = await settingsPart(settings.ConfigurationSettings, "configuration");
            let c = cs.configurations.find(x => x.name === o.name);
            const done = [];
            if (!c) {
                const ci = cs.configurations.find(x => x.name.toLowerCase() === String(o.name).toLowerCase());
                if (ci) throw new Error(`no configuration '${o.name}'; did you mean ${ci.name}? (names are case sensitive; a new name creates a configuration)`);
                const first = cs.configurations[0];
                c = settings.Configuration.createIn(cs);
                c.name = String(o.name);
                if (first) {
                    for (const p of ["applicationRootUrl", "runtimePortNumber", "adminPortNumber", "runtimePortOnlyLocal", "adminPortOnlyLocal", "maxJavaHeapSize", "extraJvmParameters", "databaseType", "databaseUrl", "databaseName", "databaseUseIntegratedSecurity", "databaseUserName"]) {
                        try {
                            c[p] = first[p];
                        } catch {
                            // not in this version
                        }
                    }
                    c.databasePassword = "";
                } else {
                    c.applicationRootUrl = "http://localhost:8080/";
                    c.databaseName = "default";
                }
                done.push(`new configuration${first ? ` like ${first.name}` : ""}`);
            }
            if (o.applicationRootUrl !== undefined) {
                if (o.applicationRootUrl && !/^https?:\/\/\S+$/.test(o.applicationRootUrl)) throw new Error(`applicationRootUrl must start with http:// or https://, got '${o.applicationRootUrl}'`);
                c.applicationRootUrl = String(o.applicationRootUrl);
                done.push(`root URL ${o.applicationRootUrl}`);
            }
            for (const [qn, v] of Object.entries(o.constants || {})) {
                const k = await get(qn).catch(() => null);
                if (!(k instanceof constants.Constant)) fail(`constants: '${qn}' is not a constant`, qn, model.allConstants().map(x => x.qualifiedName));
                const old = c.constantValues.find(x => x.constantQualifiedName === qn);
                if (v === null) {
                    if (old) old.delete();
                    done.push(`${qn} = its default`);
                    continue;
                }
                const val = String(v);
                const t = k.type;
                if (t instanceof datatypes.BooleanType && !/^(true|false)$/.test(val)) throw new Error(`constants: ${qn} is Boolean: write "true" or "false"`);
                if ((t instanceof datatypes.IntegerType) && !/^-?\d+$/.test(val)) throw new Error(`constants: ${qn} is a whole number: got '${val}'`);
                if (t instanceof datatypes.DecimalType && !/^-?\d+(\.\d+)?$/.test(val)) throw new Error(`constants: ${qn} is Decimal: got '${val}'`);
                const cv = old || settings.ConstantValue.create(model);
                if (!old) {
                    cv.constant = k;
                    c.constantValues.push(cv);
                }
                if (settings.SharedValue && !setIfAvailable(cv, "value", val)) {
                    const sv = settings.SharedValue.create(model);
                    sv.value = val;
                    cv.sharedOrPrivateValue = sv;
                } else if (!settings.SharedValue) cv.value = val;
                done.push(`${qn} = ${JSON.stringify(val)}`);
            }
            for (const [name, v] of Object.entries(o.customSettings || {})) {
                if (!/^[A-Za-z][\w.]*$/.test(name)) throw new Error(`customSettings: '${name}' is not a runtime setting name (e.g. ClientRequestTimeout, com.mendix.core.SessionIdCookieName)`);
                const old = c.customSettings.find(x => x.name === name);
                if (v === null) {
                    if (old) old.delete();
                    done.push(`${name} removed`);
                    continue;
                }
                const cs2 = old || settings.CustomSetting.create(model);
                if (!old) {
                    cs2.name = name;
                    c.customSettings.push(cs2);
                }
                cs2.value = String(v);
                done.push(`${name} = ${JSON.stringify(String(v))}`);
            }
            if (!done.length) throw new Error("setConfiguration needs applicationRootUrl, constants or customSettings (or a new name)");
            return `${o.name}: ${done.join(", ")}`;
        },
        async createImageCollection(o) {
            validName(o.name, "image collection name");
            const qn = `${o.module}.${o.name}`;
            if (await exists(qn)) throw new Error(`${qn} already exists`);
            const c = images.ImageCollection.createIn(folder(o.module, o.folder));
            c.name = o.name;
            return qn;
        },
        async addImage(o) {
            const c = await imageCollection(o.collection);
            const { bytes, format, full } = imageFile(o.file);
            const name = o.name || path.basename(full).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^(\d)/, "_$1");
            validName(name, "image name");
            const old = c.images.find(x => x.name === name);
            if (old && !bool(o.replace, false)) throw new Error(`${o.collection} already has an image '${name}'; add "replace": true or another "name"`);
            const img = old || images.Image.create(model);
            if (!old) {
                img.name = name;
                c.images.push(img);
            }
            img.imageData = bytes.toString("base64");
            img.imageFormat = images.MxImageFormat[format];
            return `${o.collection}.${name} (${format}, ${Math.ceil(bytes.length / 1024)} KB)${old ? " replaced" : ""}`;
        }
    };

    // ------------------------------------------------ checks (after apply)

    const rightName = r => (r && r.name) || String(r);
    const checks = {
        async changeAccessRule(o) {
            const e = await entity(o.entity);
            let r;
            try {
                r = ruleOf(e, { roles: o.setRoles || o.roles, rule: o.setRoles ? undefined : o.rule });
            } catch (err) {
                return [err.message];
            }
            const out = [];
            if (o.create !== undefined && r.allowCreate !== bool(o.create, false)) out.push(`${o.entity}: create is ${r.allowCreate}`);
            if (o.delete !== undefined && r.allowDelete !== bool(o.delete, false)) out.push(`${o.entity}: delete is ${r.allowDelete}`);
            if (o.xpath !== undefined && r.xPathConstraint !== String(o.xpath).trim()) out.push(`${o.entity}: xpath is '${r.xPathConstraint}'`);
            if (o.documentation !== undefined && r.documentation !== String(o.documentation).replace(/\r?\n/g, "\r\n")) out.push(`${o.entity}: rule documentation not set`);
            if (o.newMembers !== undefined && rightName(r.defaultMemberAccessRights).toLowerCase() !== String(o.newMembers).toLowerCase()) out.push(`${o.entity}: new members get ${rightName(r.defaultMemberAccessRights)}`);
            for (const [k, v] of Object.entries(o.members || {})) {
                const ma = r.memberAccesses.find(x => [memberOf(x), memberOf(x).split(".").pop()].includes(k));
                if (!ma || rightName(ma.accessRights).toLowerCase() !== String(v).toLowerCase()) out.push(`${o.entity}.${k} is ${ma ? rightName(ma.accessRights) : "missing"}`);
            }
            return out;
        },
        async deleteAccessRule(o) {
            const e = await entity(o.entity);
            const want = [].concat(o.roles);
            return e.accessRules.some(r => r.moduleRolesQualifiedNames.length === want.length && want.every(x => r.moduleRolesQualifiedNames.includes(x))) && o.rule === undefined ? [`${o.entity} still has a rule for ${want.join(", ")}`] : [];
        },
        async changeAssociation(o) {
            const a = await get(o.association);
            const out = [];
            if (o.type !== undefined && a.type.name.toLowerCase() !== String(o.type).toLowerCase()) out.push(`${o.association} is ${a.type.name}`);
            if (o.owner !== undefined && a.owner.name.toLowerCase() !== String(o.owner).toLowerCase()) out.push(`${o.association} owner is ${a.owner.name}`);
            if (o.storage !== undefined && a.storageFormat && a.storageFormat.name.toLowerCase() !== String(o.storage).toLowerCase()) out.push(`${o.association} storage is ${a.storageFormat.name}`);
            for (const [side, f] of [["parent", "onDeleteFrom"], ["child", "onDeleteTo"]]) {
                if (o[f] !== undefined && a.deleteBehavior[`${side}DeleteBehavior`].name !== DELETE_KINDS[String(o[f]).toLowerCase()]) out.push(`${o.association} ${f} is ${deleteName(a.deleteBehavior[`${side}DeleteBehavior`].name)}`);
            }
            if (o.documentation !== undefined && a.documentation !== String(o.documentation).replace(/\r?\n/g, "\r\n")) out.push(`${o.association} documentation not set`);
            if (o.from !== undefined && a.parent.qualifiedName !== o.from) out.push(`${o.association} is owned by ${a.parent.qualifiedName}`);
            if (o.to !== undefined && (a instanceof dm.CrossAssociation ? a.childQualifiedName : a.child.qualifiedName) !== o.to) out.push(`${o.association} points to ${a instanceof dm.CrossAssociation ? a.childQualifiedName : a.child.qualifiedName}`);
            return out;
        },
        async createViewEntity(o) {
            const e = await entity(`${o.module}.${o.name}`);
            if (!isView(e)) return [`${o.module}.${o.name} is not a view entity`];
            const cols = parseOql(o.oql).columns.map(c => c.alias);
            const have = e.attributes.map(a => a.name);
            return cols.filter(c => !have.includes(c)).map(c => `${o.module}.${o.name} lacks ${c}`);
        },
        async changeViewEntity(o) {
            const e = await entity(o.entity);
            const d = await e.source.sourceDocument.load();
            return d.oql === String(o.oql) ? [] : [`${o.entity} has another OQL`];
        },
        async setProjectSettings(o) {
            const rs = await settingsPart(settings.RuntimeSettings, "runtime");
            const out = [];
            const flowName = p => rs[`${p}QualifiedName`] || "";
            for (const [f, p] of [["afterStartup", "afterStartupMicroflow"], ["beforeShutdown", "beforeShutdownMicroflow"], ["healthCheck", "healthCheckMicroflow"]]) {
                if (o[f] !== undefined && flowName(p) !== String(o[f] || "")) out.push(`${f} is '${flowName(p)}'`);
            }
            if (o.roundingMode !== undefined && rs.roundingMode.name.toLowerCase() !== String(o.roundingMode).toLowerCase()) out.push(`rounding is ${rs.roundingMode.name}`);
            if (o.firstDayOfWeek !== undefined && rs.firstDayOfWeek.name.toLowerCase() !== String(o.firstDayOfWeek).toLowerCase()) out.push(`first day is ${rs.firstDayOfWeek.name}`);
            if (o.defaultTimeZone !== undefined && rs.defaultTimeZoneCode !== String(o.defaultTimeZone)) out.push(`time zone is '${rs.defaultTimeZoneCode}'`);
            if (o.hashAlgorithm !== undefined && rs.hashAlgorithm.name.toLowerCase() !== String(o.hashAlgorithm).toLowerCase()) out.push(`hash is ${rs.hashAlgorithm.name}`);
            for (const [f, prop] of [["multipleSessions", "allowUserMultipleSessions"], ["optimisticLocking", "enableDataStorageOptimisticLocking"], ["backgroundSystemContext", "useSystemContextForBackgroundTasks"], ["foreignKeys", "useDatabaseForeignKeyConstraints"], ["oqlVersion2", "useOQLVersion2"]]) {
                if (o[f] !== undefined && rs[prop] !== (o[f] === true || o[f] === "true")) out.push(`${f} is ${rs[prop]}`);
            }
            if (o.decimalScale !== undefined && rs.decimalScale !== Number(o.decimalScale)) out.push(`decimal scale is ${rs.decimalScale}`);
            if (o.scheduledEventTimeZone !== undefined && rs.scheduledEventTimeZoneCode !== String(o.scheduledEventTimeZone)) out.push(`scheduled event time zone is '${rs.scheduledEventTimeZoneCode}'`);
            return out;
        },
        async setConfiguration(o) {
            const cs = await settingsPart(settings.ConfigurationSettings, "configuration");
            const c = cs.configurations.find(x => x.name === o.name);
            if (!c) return [`configuration ${o.name} missing`];
            const out = [];
            const valueOf = cv => {
                try {
                    return cv.sharedOrPrivateValue && cv.sharedOrPrivateValue.value !== undefined ? cv.sharedOrPrivateValue.value : cv.value;
                } catch {
                    return undefined;
                }
            };
            for (const [qn, v] of Object.entries(o.constants || {})) {
                const cv = c.constantValues.find(x => x.constantQualifiedName === qn);
                if (v === null ? !!cv : !cv || valueOf(cv) !== String(v)) out.push(`${o.name}: ${qn} is ${cv ? JSON.stringify(valueOf(cv)) : "not set"}`);
            }
            for (const [n, v] of Object.entries(o.customSettings || {})) {
                const s = c.customSettings.find(x => x.name === n);
                if (v === null ? !!s : !s || s.value !== String(v)) out.push(`${o.name}: ${n} is ${s ? JSON.stringify(s.value) : "not set"}`);
            }
            return out;
        },
        async createImageCollection(o) {
            return (await exists(`${o.module}.${o.name}`)) ? [] : [`${o.module}.${o.name} missing`];
        },
        async addImage(o) {
            const c = await get(o.collection);
            const name = o.name || path.basename(String(o.file)).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^(\d)/, "_$1");
            const img = c.images.find(x => x.name === name);
            return img && img.imageData ? [] : [`${o.collection} has no image ${name}`];
        }
    };

    return { impl, checks, calculate, associationSettings, assertOwnAttributes, addMemberToRules, capMember, membersOf, isView, isExternal, parseOql };
}

// checkPlan: a later op of the plan that changes what this op made (only the final state is checked).
function changedLater(name, o, rest) {
    const attr = name === "addAttribute" ? `${o.entity}.${o.name}` : name === "changeAttribute" ? o.attribute : null;
    if (attr && rest.some(x => x.op === "changeAttribute" && x.attribute === attr)) return true;
    // the place in the list: later attributes of the same entity move it
    const ent = name === "addAttribute" ? o.entity : name === "changeAttribute" ? String(o.attribute).split(".").slice(0, 2).join(".") : null;
    if (ent && ["position", "before", "after"].some(k => o[k] !== undefined) && rest.some(x => (x.op === "addAttribute" && x.entity === ent) || (x.op === "changeAttribute" && String(x.attribute).startsWith(ent + ".")))) return true;
    if (["addDomainAnnotation", "changeDomainAnnotation"].includes(name) && rest.some(x => ["changeDomainAnnotation", "deleteDomainAnnotation"].includes(x.op) && x.module === o.module)) return true;
    // system members and image of a new entity changed later
    if (name === "createEntity" && rest.some(x => x.op === "changeEntity" && x.entity === `${o.module}.${o.name}`)) return true;
    if (name === "changeEntity" && rest.some(x => x.op === "changeEntity" && x.entity === o.entity)) return true;
    if (["addLanguage", "changeLanguage"].includes(name) && rest.some(x => ["changeLanguage", "deleteLanguage"].includes(x.op) && String(x.code).toLowerCase() === String(o.code).toLowerCase())) return true;
    if (["renameFolder", "moveFolder"].includes(name) && rest.some(x => ["moveFolder", "deleteFolder", "renameFolder"].includes(x.op) && x.module === o.module)) return true;
    if (name === "changeUserRole" && rest.some(x => x.op === "changeUserRole" && x.role === o.role)) return true;
    if (name === "addAccessRule" || name === "changeAccessRule") {
        const roles = [].concat(o.setRoles || o.roles || []).sort().join();
        if (rest.some(x => ["deleteAccessRule", "changeAccessRule"].includes(x.op) && x.entity === o.entity && [].concat(x.roles || []).sort().join() === roles)) return true;
    }
    if (name === "createViewEntity" && rest.some(x => x.op === "changeViewEntity" && x.entity === `${o.module}.${o.name}`)) return true;
    if (name === "changeViewEntity" && rest.some(x => x.op === "changeViewEntity" && x.entity === o.entity)) return true;
    if (name === "addAssociation" && rest.some(x => x.op === "changeAssociation")) return true;
    return false;
}

module.exports = { changedLater, makeDomain, DOMAIN_OPS, DOMAIN_SYNONYMS, SYSTEM_PARENTS, SYSTEM_MEMBERS, parseOql };
