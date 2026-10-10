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
        doc: "Set the project security level, demo users and guest access.",
        fields: { level: "optional Off | Prototype | Production", demoUsers: "optional true/false", guestRole: "optional user role for anonymous users, or \"\" to switch guest access off" }
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
                    userRole(ps, o.guestRole);
                    ps.enableGuestAccess = true;
                    ps.guestUserRoleName = o.guestRole;
                    done.push(`guest access as ${o.guestRole}`);
                }
            }
            if (!done.length) throw new Error("setSecurity needs 'level', 'demoUsers' and/or 'guestRole'");
            return done.join(", ");
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
