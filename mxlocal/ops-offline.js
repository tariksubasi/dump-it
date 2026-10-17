"use strict";
// Offline-first apps (R3):
//   setOfflineSync   per entity sync configuration of an offline navigation profile (Responsive offline, tablet / phone
//                    offline, native): all objects, by XPath, nothing (clear or keep the data), never, online; stored as
//                    Navigation$OfflineEntityConfig, as the Studio Pro 11.14 sample (mxcli TestApp, TabletOffline)
//   synchronize      nanoflow action (Microflows$SynchronizeAction): all objects, unsynchronized objects or the given
//                    object / list variables
// Refused with the reason in an app without an offline profile, and in Mendix versions without these settings.
const sdk = require("mendixmodelsdk");
const { fail } = require("./ops-util");
const { cmp } = require("./versions");

const { navigation, microflows: mf } = sdk;

// mode -> OfflineEntitySyncMode (Studio Pro's names in the Navigation editor)
const MODES = { all: "All", allobjects: "All", byxpath: "Constrained", xpath: "Constrained", constrained: "Constrained", nothing: "None", nothingclear: "None", none: "None",
    nothingpreserve: "NoneAndPreserveData", preserve: "NoneAndPreserveData", keep: "NoneAndPreserveData", never: "Never", online: "Online" };
const MODE_TEXT = { All: "all objects", Constrained: "by XPath", None: "nothing (clear data)", NoneAndPreserveData: "nothing (preserve data)", Never: "never", Online: "online" };
const MODE_NAMES = ["all", "byXPath", "nothing", "nothingPreserve", "never", "online", "default"];

const OFFLINE_OPS = {
    setOfflineSync: {
        doc: "Set how entities synchronize in an offline-first navigation profile (Responsive offline, tablet / phone offline or native): all objects, by XPath, nothing, never or online; \"default\" removes the entity's setting (Studio Pro's default applies).",
        fields: {
            profile: "optional navigation profile name (default: the app's only offline / native profile)",
            entities: "R { \"Module.Entity\": \"all\" | \"byXPath\" | \"nothing\" | \"nothingPreserve\" | \"never\" | \"online\" | \"default\" | { \"mode\": \"byXPath\", \"xpath\": \"[Owner = '[%CurrentUser%]']\" } }"
        }
    }
};

const SYNC_ACTION = {
    synchronize: {
        doc: "Synchronize the offline database with the server (nanoflows in an offline-first app): all objects, the unsynchronized ones, or the given objects / lists.",
        fields: { objects: "optional all | unsynchronized | [ \"Variable\", ... ] (default all)" },
        only: "nano",
        type: () => mf.SynchronizeAction,
        async build(c, act, spec, where) {
            const why = await offlineReason(c.model);
            if (why) throw new Error(`${where}: synchronize ${why}`);
            const a = mf.SynchronizeAction.createIn(act);
            const o = spec.objects === undefined ? "all" : spec.objects;
            if (Array.isArray(o)) {
                if (!o.length) throw new Error(`${where}: objects is a list of object or list variables, e.g. [ "Order" ]`);
                a.type = mf.SynchronizationType.Specific;
                for (const v of o) {
                    const name = String(v).replace(/^\$/, "");
                    const info = await c.variableInfo(name, where);
                    if (!info || !info.entity) throw new Error(`${where}: $${name} is not an object or list; synchronize takes object and list variables`);
                    a.variableNames.push(name);
                }
            } else {
                const t = { all: "All", unsynchronized: "Unsynchronized", unsynced: "Unsynchronized" }[String(o).toLowerCase()];
                if (!t) fail(`${where}: objects '${o}' is not known (use all | unsynchronized | [ "Variable" ])`, String(o), ["all", "unsynchronized"]);
                a.type = mf.SynchronizationType[t];
            }
            if (c.h.client) c.h.client.warnFirst("Microflows$SynchronizeAction: first use by ops (no Studio Pro sample in the test projects); check the nanoflow in Studio Pro");
            return a;
        },
        vars: () => [],
        describe: a => `SYNCHRONIZE ${a.type && a.type.name === "Specific" ? a.variableNames.map(v => "$" + v).join(", ") : a.type ? a.type.name.toLowerCase() : "all"}`
    }
};

const isOffline = p => !(p instanceof navigation.NavigationProfile) || /offline/i.test(p.kind ? p.kind.name : "");

// "" when the app has an offline / native profile, else why synchronizing makes no sense
async function offlineReason(model) {
    const doc = model.allNavigationDocuments()[0];
    if (!doc) return "needs an offline-first app; this project has no navigation document";
    const nav = doc.isLoaded ? doc : await doc.load();
    if (nav.profiles.some(isOffline)) return "";
    return `synchronizes an offline-first app; this project has no offline or native navigation profile (${nav.profiles.map(p => p.name).join(", ") || "none"}; add one in Studio Pro: App > Navigation)`;
}

function makeOffline(h) {
    const { model, client } = h;

    async function profileOf(name, where) {
        const doc = model.allNavigationDocuments()[0];
        if (!doc) throw new Error(`${where}: this project has no navigation document`);
        const nav = await doc.load();
        const all = nav.profiles;
        if (name !== undefined) {
            const p = all.find(x => x.name === String(name)) || all.find(x => x.name.toLowerCase() === String(name).toLowerCase());
            if (!p) fail(`${where}: no navigation profile '${name}'`, String(name), all.map(x => x.name));
            if (!isOffline(p)) throw new Error(`${where}: ${p.name} is an online profile (${p.kind ? p.kind.name : "?"}); sync settings are for an offline profile (${all.filter(isOffline).map(x => x.name).join(", ") || "none here: make the profile offline in Studio Pro, App > Navigation"})`);
            return p;
        }
        const off = all.filter(isOffline);
        if (!off.length) throw new Error(`${where}: this app has no offline-first profile (profiles: ${all.map(x => `${x.name} ${x.kind ? x.kind.name : ""}`.trim()).join(", ")}); entities sync only in an offline / native profile: add one in Studio Pro (App > Navigation), then run this again`);
        if (off.length > 1) throw new Error(`${where}: this app has ${off.length} offline profiles (${off.map(x => x.name).join(", ")}); give "profile"`);
        return off[0];
    }

    async function setOfflineSync(o) {
        const where = "setOfflineSync";
        const p = await profileOf(o.profile, where);
        if (cmp(client.project.version, "9.24.0") < 0) throw new Error(`${where}: Mendix ${client.project.version} stores the older download modes; set the sync configuration in Studio Pro`);
        const ents = o.entities;
        if (!ents || typeof ents !== "object" || Array.isArray(ents) || !Object.keys(ents).length) throw new Error(`${where}: entities is { "Module.Entity": "all" | "byXPath" | ... }`);
        const out = [];
        for (const [qn, raw] of Object.entries(ents)) {
            const at = `${where} ${qn}`;
            const spec = typeof raw === "string" ? { mode: raw } : raw;
            if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${at}: give a mode (${MODE_NAMES.join(" | ")}) or { "mode": "byXPath", "xpath": "[...]" }`);
            for (const k of Object.keys(spec)) if (!["mode", "xpath"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["mode", "xpath"]);
            const low = String(spec.mode === undefined ? (spec.xpath !== undefined ? "byxpath" : "") : spec.mode).toLowerCase().replace(/[\s_()-]/g, "");
            if (low === "default") {
                // by name: also a setting of an entity that is gone
                const old = p.offlineEntityConfigs.find(c => c.entityQualifiedName === qn);
                if (old) old.delete();
                else await h.entity(qn);
                out.push(`${qn.split(".").pop()} default${old ? " (setting removed)" : " (had none)"}`);
                continue;
            }
            // System entities (System.Language, ...) are stored by name, as Studio Pro does
            const sys = /^System\.\w+$/.test(qn);
            const e = sys ? { qualifiedName: qn, name: qn.split(".").pop() } : await h.entity(qn);
            if (!sys && !h.persistable(e)) throw new Error(`${at}: ${qn} is not persistable; only persistable entities synchronize`);
            let cfg = p.offlineEntityConfigs.find(c => c.entityQualifiedName === e.qualifiedName);
            const mode = MODES[low];
            if (!mode) fail(`${at}: mode '${spec.mode}' is not known (use ${MODE_NAMES.join(" | ")})`, String(spec.mode), MODE_NAMES);
            if (!navigation.OfflineEntitySyncMode[mode]) throw new Error(`${at}: mode ${mode} is not in Mendix ${client.project.version}`);
            if (mode === "Constrained") {
                const xp = String(spec.xpath || "").trim();
                if (!/^\[[\s\S]*\]$/.test(xp)) throw new Error(`${at}: byXPath needs "xpath": "[...]" (an XPath on ${e.name} in brackets)`);
            } else if (spec.xpath !== undefined) throw new Error(`${at}: xpath goes with mode byXPath`);
            const isNew = !cfg;
            if (!cfg) {
                cfg = navigation.OfflineEntityConfig.createIn(p);
                if (sys) cfg.__entity.updateWithRawValue(qn);
                else cfg.entity = e;
            }
            cfg.syncMode = navigation.OfflineEntitySyncMode[mode];
            cfg.constraint = mode === "Constrained" ? String(spec.xpath).trim() : "";
            out.push(`${e.name} ${MODE_TEXT[mode]}${mode === "Constrained" ? ` ${cfg.constraint}` : ""}${isNew ? "" : " (changed)"}`);
        }
        return `${p.name} profile: ${out.join(", ")}`;
    }

    const checks = {
        async setOfflineSync(o) {
            const p = await profileOf(o.profile, "setOfflineSync");
            const r = [];
            for (const [qn, raw] of Object.entries(o.entities)) {
                const spec = typeof raw === "string" ? { mode: raw } : raw;
                const low = String(spec.mode === undefined ? "byxpath" : spec.mode).toLowerCase().replace(/[\s_()-]/g, "");
                const cfg = p.offlineEntityConfigs.find(c => c.entityQualifiedName === qn);
                if (low === "default") {
                    if (cfg) r.push(`${qn} still has a sync setting`);
                } else if (!cfg || cfg.syncMode.name !== MODES[low]) r.push(`${qn} does not sync ${MODES[low]}`);
            }
            return r;
        }
    };
    return { impl: { setOfflineSync }, checks };
}

module.exports = { makeOffline, OFFLINE_OPS, SYNC_ACTION, offlineReason };
