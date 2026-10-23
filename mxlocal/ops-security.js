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
        async revokeAccess(o) {
            const doc = await get(o.document);
            const have = doc.allowedModuleRolesQualifiedNames || doc.allowedRolesQualifiedNames || [];
            return [].concat(o.roles).filter(r => have.includes(r)).map(r => `${o.document} still allows ${r}`);
        }
    };

    return { impl, checks };
}

module.exports = { makeSecurity, SECURITY_OPS, userRoleNamed };
