"use strict";
// Project security: user roles and their module roles, demo users, security level and guest access, and taking
// access away again. Defaults are what Studio Pro writes (learned from its projects): a new user role checks security,
// manages no other roles and has its own GUID; a demo user uses the entity the other demo users use.
const crypto = require("crypto");
const sdk = require("mendixmodelsdk");
const { fail, suggest, bool, validName } = require("./ops-util");

const { security, domainmodels: dm } = sdk;

const SECURITY_OPS = {
    createUserRole: {
        doc: "Create a user role (project security) made of module roles.",
        fields: { name: "R user role name, e.g. HRManager", moduleRoles: "R [ \"Module.Role\" ]", description: "optional text", manageAllRoles: "optional true/false: may manage users of every role (default false)" }
    },
    addModuleRoles: {
        doc: "Add module roles to an existing user role, such as giving Administrator the role of a new module.",
        fields: { userRole: "R user role name, e.g. Administrator", moduleRoles: "R [ \"Module.Role\" ]" }
    },
    createDemoUser: {
        doc: "Create a demo user, to sign in as that role while demo users are switched on.",
        fields: { userName: "R user name, e.g. demo_hr", userRoles: "R [ \"UserRole\" ]", entity: "optional Module.Entity of the user (default: the entity the other demo users use, else System.User)", password: "optional (default: generated)" }
    },
    setSecurity: {
        doc: "Set the project security level, demo users, guest access (anonymous users) and the password policy.",
        fields: { level: "optional Off | Prototype | Production", demoUsers: "optional true/false", guestRole: "optional user role for anonymous users, or \"\" to switch guest access off",
            passwordPolicy: "optional { \"minimumLength\": 8, \"requireDigit\": true, \"requireMixedCase\": true, \"requireSymbol\": false } (give only what changes)" }
    },
    changeUserRole: {
        doc: "Change a user role: which user roles its users may manage (user management, e.g. in the Administration module), users without roles, description, module roles to add or remove.",
        fields: { role: "R user role name, e.g. Administrator", manageAllRoles: "optional true/false: may manage users of every role", manageableRoles: "optional [ \"UserRole\" ]: the roles it may manage (sets manageAllRoles false)",
            manageUsersWithoutRoles: "optional true/false", description: "optional text", addModuleRoles: "optional [ \"Module.Role\" ]", removeModuleRoles: "optional [ \"Module.Role\" ]" }
    },
    setAdministrator: {
        doc: "Set the administrator account Studio Pro makes when the app starts with an empty database (App > Security > Administrator): user name, password, user role.",
        fields: { userName: "optional user name, e.g. MxAdmin", password: "optional password (production: also set it per environment; the policy applies)", role: "optional user role, e.g. Administrator" }
    },
    renameUserRole: {
        doc: "Rename a user role: demo users, manageable roles, the administrator and guest role and role-based home pages follow; XPath and expressions with [%UserRole_<old>%] are listed (refused unless force: change them first).",
        fields: { role: "R user role name", newName: "R new name", force: "optional true: rename although [%UserRole_<old>%] tokens remain (they break; fix them after)" }
    },
    deleteUserRole: {
        doc: "Delete a user role: it leaves demo users (a demo user left without roles is deleted), manageable roles and role-based home pages; refused for the administrator's or guest role (pick another first) and while [%UserRole_<name>%] tokens use it (unless force).",
        fields: { role: "R user role name", force: "optional true: delete although [%UserRole_<name>%] tokens remain" }
    },
    changeDemoUser: {
        doc: "Change a demo user: user name, password, user roles (replace), entity.",
        fields: { userName: "R current user name", newUserName: "optional", password: "optional", userRoles: "optional [ \"UserRole\" ] (replaces)", entity: "optional Module.Entity of the user (System.User or a specialization)" }
    },
    deleteDemoUser: { doc: "Delete a demo user.", fields: { userName: "R user name" } },
    revokeAccess: {
        doc: "Stop module roles from running a microflow/nanoflow or opening a page (the opposite of grantAccess).",
        fields: { document: "R Module.Document", roles: "R [ \"Module.Role\" ]" }
    }
};

// A user role of project security ps by name; the error lists the user roles (and who has a module role given by mistake).
function userRoleNamed(ps, name, where = "") {
    const r = ps.userRoles.find(x => x.name === name);
    if (r) return r;
    const all = ps.userRoles.map(x => x.name);
    if (String(name).includes(".")) {
        const holders = ps.userRoles.filter(u => u.moduleRolesQualifiedNames.includes(name)).map(u => u.name);
        throw new Error(`${where}'${name}' is a module role; this takes user roles (project-wide: ${all.join(", ") || "none"}). ` +
            (holders.length ? `User roles with ${name}: ${holders.join(", ")}` : `No user role has ${name} yet (addModuleRoles)`));
    }
    const s = suggest(name, all);
    throw new Error(`${where}no user role '${name}'. ${s.length ? `Did you mean: ${s.join(", ")}? ` : ""}User roles (project-wide): ${all.join(", ") || "none"}`);
}

const SYSTEM_ROLES = ["System.User", "System.Administrator"];

// Off/Prototype/Production as Studio Pro shows them, and the stored names.
const LEVELS = { Off: "CheckNothing", Prototype: "CheckFormsAndMicroflows", Production: "CheckEverything" };

function makeSecurity(h) {
    const { model, get } = h;
    const client = h.client || { warn() {} };

    async function projectSecurity() {
        const ps = model.allProjectSecurities()[0];
        if (!ps) throw new Error("the project has no project security document");
        return ps.load();
    }

    const userRole = (ps, name) => userRoleNamed(ps, name);

    // Module roles: objects, or the name of a System module role (the System module is built into Studio Pro, so it is
    // not in the project; such references are written by name, as Studio Pro stores them).
    async function moduleRoles(list) {
        const out = [];
        for (const qn of [].concat(list || [])) {
            if (SYSTEM_ROLES.includes(qn)) {
                out.push(qn);
                continue;
            }
            const r = await get(qn);
            if (!(r instanceof security.ModuleRole)) throw new Error(`'${qn}' is not a module role (Module.Role)`);
            out.push(r);
        }
        return out;
    }

    // Adds module roles to user role ur; returns the names it did not have yet.
    function addRoles(ur, roles) {
        const added = [];
        for (const m of roles) {
            const qn = typeof m === "string" ? m : m.qualifiedName;
            if (ur.moduleRolesQualifiedNames.includes(qn)) continue;
            if (typeof m === "string") ur.__moduleRoles.updateWithRawValue([...ur.moduleRolesQualifiedNames, m]);
            else ur.moduleRoles.push(m);
            added.push(qn);
        }
        return added;
    }

    // Units whose stored text uses the token [%UserRole_<name>%] (XPath of access rules and retrieves, expressions)
    function tokenUsers(name) {
        const p = client.project;
        if (!p || !p.units) return [];
        const token = `[%UserRole_${name}%]`;
        const out = [];
        for (const id of p.units.keys()) {
            let u;
            try {
                u = p.read(id);
            } catch (e) {
                continue;
            }
            if (JSON.stringify(u).includes(token)) out.push(u.Name || u.$Type.split("$")[1]);
        }
        return out;
    }

    // Role-based home pages of every navigation profile that point at user role r: [ { list, item } ]
    async function homePagesOf(r) {
        const out = [];
        for (const n of model.allNavigationDocuments()) {
            const nav = await n.load();
            for (const prof of nav.profiles) for (const k of ["roleBasedHomePages", "roleBasedNativeHomePages"]) {
                let list;
                try {
                    list = prof[k];
                } catch (e) {
                    continue; // not in this version / kind of profile
                }
                if (list) for (const item of [...list]) if (item.userRoleQualifiedName === r.name || item.userRole === r) out.push({ profile: prof.name, item });
            }
        }
        return out;
    }

    const password = () => crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "x").slice(0, 12);

    const impl = {
        async createUserRole(o) {
            const ps = await projectSecurity();
            validName(o.name, "user role name");
            if (ps.userRoles.some(x => x.name === o.name)) throw new Error(`user role ${o.name} already exists`);
            const roles = await moduleRoles(o.moduleRoles);
            if (!roles.length) throw new Error("createUserRole needs at least one module role in 'moduleRoles'");
            const r = security.UserRole.createIn(ps);
            r.name = o.name;
            r.guid = crypto.randomUUID();
            r.description = o.description || "";
            r.checkSecurity = true;
            r.manageAllRoles = bool(o.manageAllRoles, false);
            r.manageUsersWithoutRoles = false;
            return `${o.name}: ${addRoles(r, roles).join(", ")}`;
        },
        async addModuleRoles(o) {
            const ps = await projectSecurity();
            const r = userRole(ps, o.userRole);
            const added = addRoles(r, await moduleRoles(o.moduleRoles));
            return `${o.userRole} + ${added.join(", ") || "(had them all)"}`;
        },
        async createDemoUser(o) {
            const ps = await projectSecurity();
            if (ps.demoUsers.some(x => x.userName === o.userName)) throw new Error(`demo user ${o.userName} already exists`);
            const roles = [].concat(o.userRoles || []).map(n => userRole(ps, n));
            if (!roles.length) throw new Error("createDemoUser needs at least one user role in 'userRoles'");
            // default: the entity the other demo users use, when it still exists (a removed Administration module
            // leaves demo users pointing at Administration.Account); else System.User
            let entityName = o.entity || (ps.demoUsers.length && ps.demoUsers[0].entityQualifiedName) || "System.User";
            if (!o.entity && entityName !== "System.User") entityName = await get(entityName).then(() => entityName, () => "System.User");
            const e = entityName === "System.User" ? null : await get(entityName);
            if (e && !(e instanceof dm.Entity)) throw new Error(`'${entityName}' is not an entity`);
            const d = security.DemoUser.createIn(ps);
            d.userName = o.userName;
            d.password = o.password || password();
            if (e) d.entity = e;
            else d.__entity.updateWithRawValue(entityName); // System.User: by name (not in the project)
            for (const r of roles) d.userRoles.push(r);
            return `${o.userName} (${roles.map(r => r.name).join(", ")}; ${entityName})` + (ps.enableDemoUsers ? "" : "\n      NOTE: demo users are switched off; turn them on with setSecurity demoUsers: true");
        },
        async setSecurity(o) {
            const ps = await projectSecurity();
            const done = [];
            if (o.level !== undefined) {
                const stored = LEVELS[o.level];
                if (!stored) fail(`level must be Off | Prototype | Production, got '${o.level}'`, o.level, Object.keys(LEVELS));
                ps.securityLevel = security.SecurityLevel[stored];
                done.push(`level ${o.level}`);
            }
            if (o.demoUsers !== undefined) {
                ps.enableDemoUsers = bool(o.demoUsers, false);
                done.push(`demo users ${ps.enableDemoUsers ? "on" : "off"}`);
            }
            if (o.guestRole !== undefined) {
                if (o.guestRole === "") {
                    ps.enableGuestAccess = false;
                    done.push("guest access off");
                } else {
                    const gr = userRole(ps, o.guestRole);
                    if (o.guestRole === ps.adminUserRoleName) throw new Error(`REFUSED: ${o.guestRole} is the administrator's role; anonymous users get a role of their own (createUserRole, e.g. Anonymous, with only what visitors may see)`);
                    if (gr.manageAllRoles || gr.manageableRoles.length) client.warn(`guest access: ${o.guestRole} may manage users; anonymous visitors should not (changeUserRole "manageAllRoles": false, "manageableRoles": [])`);
                    ps.enableGuestAccess = true;
                    ps.guestUserRoleName = o.guestRole;
                    done.push(`guest access as ${o.guestRole}`);
                }
            }
            if (o.passwordPolicy !== undefined) {
                const pp = o.passwordPolicy;
                if (!pp || typeof pp !== "object" || Array.isArray(pp)) throw new Error("passwordPolicy is { \"minimumLength\": 8, \"requireDigit\": true, \"requireMixedCase\": true, \"requireSymbol\": true }");
                const keys = ["minimumLength", "requireDigit", "requireMixedCase", "requireSymbol"];
                for (const k of Object.keys(pp)) if (!keys.includes(k)) fail(`passwordPolicy: unknown field '${k}'`, k, keys);
                const pol = ps.passwordPolicySettings;
                if (pp.minimumLength !== undefined) {
                    const n = Number(pp.minimumLength);
                    if (!(Number.isInteger(n) && n >= 1 && n <= 128)) throw new Error("passwordPolicy.minimumLength is a whole number 1..128");
                    pol.minimumLength = n;
                    if (n < 8) client.warn(`password policy: a minimum length of ${n} is weak; 8 or more is advised`);
                }
                for (const k of keys.slice(1)) {
                    if (pp[k] === undefined) continue;
                    if (pp[k] !== true && pp[k] !== false && pp[k] !== "true" && pp[k] !== "false") throw new Error(`passwordPolicy.${k} must be true or false`);
                    pol[k] = pp[k] === true || pp[k] === "true";
                }
                done.push(`password policy: at least ${pol.minimumLength} characters${pol.requireDigit ? ", a digit" : ""}${pol.requireMixedCase ? ", mixed case" : ""}${pol.requireSymbol ? ", a symbol" : ""}`);
            }
            if (!done.length) throw new Error("setSecurity needs 'level', 'demoUsers', 'guestRole' and/or 'passwordPolicy'");
            return done.join(", ");
        },
        async changeUserRole(o) {
            const ps = await projectSecurity();
            const where = `changeUserRole ${o.role}: `;
            const r = userRoleNamed(ps, o.role, where);
            const done = [];
            const keys = ["manageAllRoles", "manageableRoles", "manageUsersWithoutRoles", "description", "addModuleRoles", "removeModuleRoles"].filter(k => o[k] !== undefined);
            if (!keys.length) throw new Error(`${where}give manageAllRoles, manageableRoles, manageUsersWithoutRoles, description, addModuleRoles or removeModuleRoles`);
            if (o.manageAllRoles !== undefined && o.manageableRoles !== undefined && bool(o.manageAllRoles, false)) throw new Error(`${where}give manageAllRoles true or a list of manageableRoles, not both`);
            if (o.manageAllRoles !== undefined) {
                r.manageAllRoles = bool(o.manageAllRoles, false);
                if (r.manageAllRoles) r.manageableRoles.clear();
                done.push(r.manageAllRoles ? "manages every role" : "does not manage every role");
            }
            if (o.manageableRoles !== undefined) {
                const list = [].concat(o.manageableRoles).map(n => userRoleNamed(ps, n, `${where}manageableRoles: `));
                r.manageAllRoles = false;
                r.manageableRoles.clear();
                for (const m of list) r.manageableRoles.push(m);
                done.push(list.length ? `manages ${list.map(m => m.name).join(", ")}` : "manages no roles");
            }
            if (o.manageUsersWithoutRoles !== undefined) {
                r.manageUsersWithoutRoles = bool(o.manageUsersWithoutRoles, false);
                done.push(`users without roles: ${r.manageUsersWithoutRoles ? "yes" : "no"}`);
            }
            if (o.description !== undefined) {
                r.description = String(o.description);
                done.push("description");
            }
            for (const [k, add] of [["addModuleRoles", true], ["removeModuleRoles", false]]) {
                if (o[k] === undefined) continue;
                const names = [].concat(o[k]).map(String);
                if (add) addRoles(r, await moduleRoles(names));
                else {
                    for (const n of names) {
                        const i = r.moduleRolesQualifiedNames.indexOf(n);
                        if (i < 0) fail(`${where}${o.role} does not have module role '${n}'`, n, r.moduleRolesQualifiedNames);
                        r.moduleRoles.splice(i, 1);
                    }
                }
                done.push(`${add ? "added" : "removed"} ${names.join(", ")}`);
            }
            if (r.name === ps.guestUserRoleName && ps.enableGuestAccess && (r.manageAllRoles || r.manageableRoles.length)) client.warn(`${r.name} is the anonymous users' role and may now manage users`);
            return `${o.role}: ${done.join(", ")}`;
        },
        async setAdministrator(o) {
            const ps = await projectSecurity();
            const done = [];
            if (["userName", "password", "role"].every(k => o[k] === undefined)) throw new Error("setAdministrator needs userName, password and/or role");
            if (o.userName !== undefined) {
                if (!/^\S+$/.test(String(o.userName))) throw new Error("setAdministrator: userName is one word without spaces, e.g. MxAdmin");
                ps.adminUserName = String(o.userName);
                done.push(`user name ${ps.adminUserName}`);
            }
            if (o.password !== undefined) {
                const pw = String(o.password);
                const pol = ps.passwordPolicySettings;
                const bad = [pw.length < pol.minimumLength && `at least ${pol.minimumLength} characters`, pol.requireDigit && !/\d/.test(pw) && "a digit", pol.requireMixedCase && !(/[a-z]/.test(pw) && /[A-Z]/.test(pw)) && "upper and lower case", pol.requireSymbol && !/[^A-Za-z0-9]/.test(pw) && "a symbol"].filter(Boolean);
                if (bad.length) throw new Error(`setAdministrator: the password policy needs ${bad.join(", ")}`);
                ps.adminPassword = pw;
                done.push("password");
                client.warn("the administrator password is in the model (and in git): set another one per environment in the Cloud Portal / runtime settings");
            }
            if (o.role !== undefined) {
                const r = userRole(ps, o.role);
                if (!r.manageAllRoles) client.warn(`${o.role} does not manage every role: the administrator cannot make other users (changeUserRole "manageAllRoles": true)`);
                ps.adminUserRoleName = r.name;
                done.push(`role ${r.name}`);
            }
            return `administrator: ${done.join(", ")}`;
        },
        async renameUserRole(o) {
            const ps = await projectSecurity();
            const where = `renameUserRole ${o.role}: `;
            const r = userRoleNamed(ps, o.role, where);
            validName(o.newName, "user role name");
            if (ps.userRoles.some(x => x.name === o.newName)) throw new Error(`${where}user role ${o.newName} already exists`);
            const users = tokenUsers(o.role);
            if (users.length && !bool(o.force, false)) throw new Error(`${where}[%UserRole_${o.role}%] is used in ${users.join(", ")}; change those XPath / expressions to [%UserRole_${o.newName}%] after the rename, or first: add "force": true to rename anyway`);
            const homes = await homePagesOf(r); // loads the navigation, so its references follow the rename
            r.name = String(o.newName);
            for (const { item } of homes) if (item.userRoleQualifiedName !== r.name) item.__userRole.updateWithRawValue(r.name);
            const lines = [];
            if (ps.adminUserRoleName === o.role) (ps.adminUserRoleName = r.name), lines.push("administrator role");
            if (ps.guestUserRoleName === o.role) (ps.guestUserRoleName = r.name), lines.push("guest role");
            if (homes.length) lines.push(`home pages of ${[...new Set(homes.map(x => x.profile))].join(", ")}`);
            if (users.length) lines.push(`STILL [%UserRole_${o.role}%] in ${users.join(", ")}: change it to [%UserRole_${o.newName}%]`);
            return `${o.role} -> ${r.name}${lines.length ? ` (${lines.join("; ")})` : ""}`;
        },
        async deleteUserRole(o) {
            const ps = await projectSecurity();
            const where = `deleteUserRole ${o.role}: `;
            const r = userRoleNamed(ps, o.role, where);
            if (ps.adminUserRoleName === o.role) throw new Error(`${where}it is the administrator's role; give the administrator another role first: { "op": "setAdministrator", "role": "..." }`);
            if (ps.guestUserRoleName === o.role && ps.enableGuestAccess) throw new Error(`${where}it is the anonymous users' role; pick another or switch guest access off first: { "op": "setSecurity", "guestRole": "" }`);
            if (ps.userRoles.length === 1) throw new Error(`${where}it is the last user role`);
            const users = tokenUsers(o.role);
            if (users.length && !bool(o.force, false)) throw new Error(`${where}[%UserRole_${o.role}%] is used in ${users.join(", ")}; change those XPath / expressions first, or add "force": true`);
            const lines = [];
            for (const d of [...ps.demoUsers]) {
                if (!d.userRoles.includes(r)) continue;
                d.userRoles.remove(r);
                if (!d.userRoles.length) {
                    lines.push(`demo user ${d.userName} deleted (no role left)`);
                    d.delete();
                } else lines.push(`demo user ${d.userName}: role removed`);
            }
            for (const u of ps.userRoles) if (u !== r && u.manageableRoles.includes(r)) (u.manageableRoles.remove(r), lines.push(`${u.name} no longer manages it`));
            for (const { profile, item } of await homePagesOf(r)) (item.delete(), lines.push(`home page for it in ${profile} removed`));
            if (ps.guestUserRoleName === o.role) ps.guestUserRoleName = "";
            r.delete();
            if (users.length) lines.push(`STILL [%UserRole_${o.role}%] in ${users.join(", ")}: these break, fix them`);
            return `${o.role} deleted${lines.length ? "\n      " + lines.join("\n      ") : ""}`;
        },
        async changeDemoUser(o) {
            const ps = await projectSecurity();
            const d = ps.demoUsers.find(x => x.userName === o.userName) || fail(`no demo user '${o.userName}'`, o.userName, ps.demoUsers.map(x => x.userName));
            const done = [];
            if (["newUserName", "password", "userRoles", "entity"].every(k => o[k] === undefined)) throw new Error("changeDemoUser needs newUserName, password, userRoles and/or entity");
            if (o.newUserName !== undefined) {
                if (ps.demoUsers.some(x => x !== d && x.userName === o.newUserName)) throw new Error(`demo user ${o.newUserName} already exists`);
                d.userName = String(o.newUserName);
                done.push(`name ${d.userName}`);
            }
            if (o.password !== undefined) (d.password = String(o.password)), done.push("password");
            if (o.userRoles !== undefined) {
                const roles = [].concat(o.userRoles).map(n => userRole(ps, n));
                if (!roles.length) throw new Error("changeDemoUser: a demo user needs at least one user role (deleteDemoUser removes it)");
                d.userRoles.clear();
                for (const x of roles) d.userRoles.push(x);
                done.push(`roles ${roles.map(x => x.name).join(", ")}`);
            }
            if (o.entity !== undefined) {
                if (o.entity === "System.User") d.__entity.updateWithRawValue("System.User");
                else {
                    const e = await get(o.entity);
                    if (!(e instanceof dm.Entity)) throw new Error(`'${o.entity}' is not an entity`);
                    d.entity = e;
                }
                done.push(`entity ${o.entity}`);
            }
            return `${o.userName}: ${done.join(", ")}`;
        },
        async deleteDemoUser(o) {
            const ps = await projectSecurity();
            const d = ps.demoUsers.find(x => x.userName === o.userName) || fail(`no demo user '${o.userName}'`, o.userName, ps.demoUsers.map(x => x.userName));
            d.delete();
            return `${o.userName} deleted`;
        },
        async revokeAccess(o) {
            const doc = await get(o.document);
            const list = doc.allowedModuleRoles || doc.allowedRoles;
            if (!list) throw new Error(`'${o.document}' has no allowed roles (only microflows, nanoflows, pages)`);
            const removed = [];
            for (const r of await moduleRoles(o.roles)) {
                if (!list.includes(r)) continue;
                list.remove(r);
                removed.push(r.qualifiedName);
            }
            return `${o.document} -/- ${removed.join(", ") || "(none had access)"}`;
        }
    };

    const checks = {
        async createUserRole(o) {
            const ps = await projectSecurity();
            const r = ps.userRoles.find(x => x.name === o.name);
            if (!r) return [`user role ${o.name} missing`];
            const have = r.moduleRolesQualifiedNames;
            return [].concat(o.moduleRoles).filter(m => !have.includes(m)).map(m => `${o.name} lacks ${m}`);
        },
        async addModuleRoles(o) {
            const ps = await projectSecurity();
            const r = ps.userRoles.find(x => x.name === o.userRole);
            const have = r ? r.moduleRolesQualifiedNames : [];
            return [].concat(o.moduleRoles).filter(m => !have.includes(m)).map(m => `${o.userRole} lacks ${m}`);
        },
        async createDemoUser(o) {
            const ps = await projectSecurity();
            return ps.demoUsers.some(x => x.userName === o.userName) ? [] : [`demo user ${o.userName} missing`];
        },
        async setSecurity(o) {
            const ps = await projectSecurity();
            const r = [];
            if (o.level !== undefined && ps.securityLevel.name !== LEVELS[o.level]) r.push(`security level is ${ps.securityLevel.name}`);
            if (o.demoUsers !== undefined && ps.enableDemoUsers !== bool(o.demoUsers, false)) r.push("demo users not set");
            if (o.guestRole !== undefined && ps.enableGuestAccess !== (o.guestRole !== "")) r.push("guest access not set");
            if (o.passwordPolicy && o.passwordPolicy.minimumLength !== undefined && ps.passwordPolicySettings.minimumLength !== Number(o.passwordPolicy.minimumLength)) r.push(`password minimum length is ${ps.passwordPolicySettings.minimumLength}`);
            for (const k of ["requireDigit", "requireMixedCase", "requireSymbol"]) if (o.passwordPolicy && o.passwordPolicy[k] !== undefined && ps.passwordPolicySettings[k] !== (o.passwordPolicy[k] === true || o.passwordPolicy[k] === "true")) r.push(`password policy ${k} is ${ps.passwordPolicySettings[k]}`);
            return r;
        },
        async changeUserRole(o) {
            const ps = await projectSecurity();
            const u = ps.userRoles.find(x => x.name === o.role);
            if (!u) return [`user role ${o.role} missing`];
            const r = [];
            if (o.manageAllRoles !== undefined && u.manageAllRoles !== bool(o.manageAllRoles, false)) r.push(`${o.role} manageAllRoles is ${u.manageAllRoles}`);
            if (o.manageableRoles !== undefined && u.manageableRoles.map(x => x.name).sort().join() !== [].concat(o.manageableRoles).sort().join()) r.push(`${o.role} manages ${u.manageableRoles.map(x => x.name).join(", ") || "nothing"}`);
            for (const n of [].concat(o.addModuleRoles || [])) if (!u.moduleRolesQualifiedNames.includes(n)) r.push(`${o.role} lacks ${n}`);
            for (const n of [].concat(o.removeModuleRoles || [])) if (u.moduleRolesQualifiedNames.includes(n)) r.push(`${o.role} still has ${n}`);
            return r;
        },
        async setAdministrator(o) {
            const ps = await projectSecurity();
            const r = [];
            if (o.userName !== undefined && ps.adminUserName !== String(o.userName)) r.push(`administrator is ${ps.adminUserName}`);
            if (o.role !== undefined && ps.adminUserRoleName !== o.role) r.push(`administrator role is ${ps.adminUserRoleName}`);
            return r;
        },
        async renameUserRole(o) {
            const ps = await projectSecurity();
            return ps.userRoles.some(x => x.name === o.newName) && !ps.userRoles.some(x => x.name === o.role) ? [] : [`user role ${o.role} not renamed to ${o.newName}`];
        },
        async deleteUserRole(o) {
            const ps = await projectSecurity();
            const r = [];
            if (ps.userRoles.some(x => x.name === o.role)) r.push(`user role ${o.role} still exists`);
            for (const d of ps.demoUsers) if (d.userRoles.some(x => !x)) r.push(`demo user ${d.userName} has an empty role`);
            return r;
        },
        async changeDemoUser(o) {
            const ps = await projectSecurity();
            const d = ps.demoUsers.find(x => x.userName === (o.newUserName || o.userName));
            if (!d) return [`demo user ${o.newUserName || o.userName} missing`];
            return o.userRoles !== undefined && d.userRoles.map(x => x.name).sort().join() !== [].concat(o.userRoles).sort().join() ? [`${d.userName} roles ${d.userRoles.map(x => x.name)}`] : [];
        },
        async deleteDemoUser(o) {
            const ps = await projectSecurity();
            return ps.demoUsers.some(x => x.userName === o.userName) ? [`demo user ${o.userName} still exists`] : [];
        },
        async revokeAccess(o) {
            const doc = await get(o.document);
            const have = doc.allowedModuleRolesQualifiedNames || doc.allowedRolesQualifiedNames || [];
            return [].concat(o.roles).filter(r => have.includes(r)).map(r => `${o.document} still allows ${r}`);
        }
    };

    // ------------------------------------------------ security report (read-only)

    // What a production security level would complain about, and what is easy to miss: per user role its module
    // roles; persistable entities without an access rule; pages, microflows and nanoflows no module role may use
    // (unused ones are fine; ones on a menu, button or page are not); module roles no user role has.
    async function report(scope) {
        const ps = await projectSecurity();
        const own = model.allModules().filter(m => !m.fromAppStore && !m.appStoreGuid && (!scope || m.name === scope));
        if (scope && !own.length) fail(`security: no own module '${scope}'`, scope, model.allModules().filter(m => !m.fromAppStore && !m.appStoreGuid).map(m => m.name));
        const levelName = Object.keys(LEVELS).find(k => LEVELS[k] === ps.securityLevel.name) || ps.securityLevel.name;
        const out = [`SECURITY ${levelName}; administrator ${ps.adminUserName} (${ps.adminUserRoleName}); guest access ${ps.enableGuestAccess ? `as ${ps.guestUserRoleName}` : "off"}; demo users ${ps.enableDemoUsers ? "on" : "off"} (${ps.demoUsers.map(d => d.userName).join(", ") || "none"})`,
            `password policy: at least ${ps.passwordPolicySettings.minimumLength} characters${ps.passwordPolicySettings.requireDigit ? ", a digit" : ""}${ps.passwordPolicySettings.requireMixedCase ? ", mixed case" : ""}${ps.passwordPolicySettings.requireSymbol ? ", a symbol" : ""}`, "", "USER ROLES"];
        const held = new Set();
        for (const u of ps.userRoles) {
            for (const m of u.moduleRolesQualifiedNames) held.add(m);
            out.push(`  ${u.name}: ${u.moduleRolesQualifiedNames.join(", ") || "(no module roles)"}${u.manageAllRoles ? "; manages every role" : u.manageableRoles.length ? `; manages ${u.manageableRoles.map(x => x.name).join(", ")}` : ""}`);
        }
        const issues = [];
        if (ps.enableGuestAccess && ps.guestUserRoleName === ps.adminUserRoleName) issues.push(`guest access uses ${ps.guestUserRoleName}, the administrator's role: every visitor is an administrator (createUserRole Anonymous, then setSecurity "guestRole": "Anonymous")`);
        const guest = ps.enableGuestAccess && ps.userRoles.find(u => u.name === ps.guestUserRoleName);
        if (guest && (guest.manageAllRoles || guest.manageableRoles.length)) issues.push(`guest role ${guest.name} may manage users (changeUserRole "manageAllRoles": false, "manageableRoles": [])`);
        // who calls from the client: pages, snippets, layouts, navigation (microflows calling microflows need no role)
        const clientSide = new Set([...model.allPages(), ...model.allSnippets(), ...model.allLayouts()].map(x => x.qualifiedName));
        const navIds = new Set(model.allNavigationDocuments().map(x => x.id));
        for (const mod of own) {
            const ms = await mod.moduleSecurity.load();
            for (const r of ms.moduleRoles) if (!held.has(r.qualifiedName)) issues.push(`module role ${r.qualifiedName}: no user role has it (addModuleRoles)`);
            const dmod = await mod.domainModel.load();
            for (const e of dmod.entities) {
                const pers = !e.generalization || !(e.generalization instanceof dm.NoGeneralization) || e.generalization.persistable;
                if (!e.accessRules.length && pers !== false) issues.push(`entity ${mod.name}.${e.name}: no access rule (nobody can read it at production level; addAccessRule)`);
            }
            for (const d of [...model.allPages(), ...model.allMicroflows(), ...model.allNanoflows()]) {
                if (d.qualifiedName.split(".")[0] !== mod.name) continue;
                const l = await d.load();
                const roles = l.allowedRoles || l.allowedModuleRoles;
                if (!roles || roles.length) continue;
                const isPage = l instanceof sdk.pages.Page;
                const users = (client.referencesTo ? client.referencesTo(d.qualifiedName) : []).filter(x => x !== d.qualifiedName && (isPage || clientSide.has(x) || navIds.has(x)));
                if (users.length) issues.push(`${l.structureTypeName.split("$")[1].toLowerCase()} ${d.qualifiedName}: used by ${users.slice(0, 3).join(", ")}${users.length > 3 ? ", ..." : ""} but no module role may ${isPage ? "open" : "run"} it (grantAccess)`);
            }
        }
        out.push("", issues.length ? `ISSUES (${issues.length})` : "ISSUES: none found", ...issues.map(x => "  ! " + x));
        if (levelName !== "Production") out.push("", `NOTE: the level is ${levelName}; a cloud deployment needs Production (setSecurity "level": "Production")`);
        return out.join("\n");
    }

    return { impl, checks, report };
}

// A later op of the plan renames or deletes what an earlier one made or changed: its check would see the later state.
function securityChangedLater(name, o, rest) {
    const role = { createUserRole: o.name, addModuleRoles: o.userRole, changeUserRole: o.role, renameUserRole: o.newName }[name];
    if (role && rest.some(x => ["renameUserRole", "deleteUserRole"].includes(x.op) && x.role === role)) return true;
    const user = { createDemoUser: o.userName, changeDemoUser: o.newUserName || o.userName }[name];
    if (user && rest.some(x => ["changeDemoUser", "deleteDemoUser"].includes(x.op) && x.userName === user)) return true;
    if (name === "createDemoUser" && rest.some(x => x.op === "deleteUserRole" && [].concat(o.userRoles || []).includes(x.role))) return true;
    return false;
}

module.exports = { makeSecurity, SECURITY_OPS, userRoleNamed, securityChangedLater };
