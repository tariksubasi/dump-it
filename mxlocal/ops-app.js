"use strict";
// App-level settings and moves that are not part of one document's editor:
//   setModuleSettings        module version and export level (source / protected add-on / protected solution)
//   moveConstant             a constant to another module; every reference (by name, @Module.Constant in expressions,
//                            configurations) is renamed, the usages are listed
//   addCertificate / deleteCertificate   App > Settings > Certificates (authority or client certificates)
//   changeNavigationProfile  native profile options and the offline sync error setting of a profile
//   deleteNavigationProfile  a web or native navigation profile (not the Responsive one)
// Samples: Projects$ModuleSettings in every test project (all "Source" / "AddOn"); no Studio Pro sample of a
// protected module, a certificate or a native profile option change: their first use is reported.
const fs = require("fs");
const path = require("path");
const sdk = require("mendixmodelsdk");
const { fail, setIfAvailable } = require("./ops-util");
const refs = require("./refs");
const { eachString } = require("./ops-copy");

const { projects, settings, navigation } = sdk;

const LEVELS = ["source", "protected", "addOn", "solution"];
const APP_OPS = {
    setModuleSettings: {
        doc: "Set a module's version and export level (App Explorer > module > Settings): source (default), or protected as an add-on module or a solution module (Marketplace / solution vendors). Protecting a module hides its documents from the apps that use it.",
        fields: { module: "R module name", version: "optional version x.y.z, e.g. 1.2.0", exportLevel: "optional source | protected | addOn | solution (protected = addOn)", solutionIdentifier: "optional text (solution modules)" }
    },
    moveConstant: {
        doc: "Move a constant to another module (and folder): every reference is renamed (expressions @Module.Constant, configurations, calls). Run usages first; Java code that reads it is listed.",
        fields: { constant: "R Module.Constant", module: "R target module", folder: "optional folder path in the target module" }
    },
    addCertificate: {
        doc: "Add a certificate to the app (App > Settings > Certificates): an authority (CA) certificate the app trusts, or a client certificate for outgoing calls.",
        fields: { file: "R path of a .crt/.cer/.pem (authority) or .p12/.pfx (client) inside the export folder, e.g. edits/ca.crt", type: "optional Authority | Client (default: Authority for .crt/.cer/.pem, Client for .p12/.pfx)" }
    },
    deleteCertificate: { doc: "Delete a certificate of the app (App > Settings > Certificates).", fields: { certificate: "R its number (1 = the first, as listed by the error message) or the start of its subject" } },
    changeNavigationProfile: {
        doc: "Change a navigation profile's options: for the native profile OTA updates, logging, database / file / cookie encryption, transitions, network timeout; for offline profiles the partial sync error (Mendix 11.12+).",
        fields: { profile: "R profile name, e.g. Native or ResponsiveOffline", ota: "optional true/false (native)", logging: "optional true/false (native)", encryptDatabase: "optional true/false (native)",
            encryptFiles: "optional true/false (native)", encryptCookies: "optional true/false (native)", networkTimeoutMs: "optional number of milliseconds (native)",
            screenTransition: "optional SystemDefault | SlideFromRightIOS | ScaleFromCenterAndroid (native)", popupTransition: "optional SystemDefault | ModalPresentationIOS | BottomSheetAndroid (native)",
            applyScreenTransition: "optional true/false (native)", throwPartialSyncError: "optional true/false: a partial synchronization raises an error (offline / native, Mendix 11.12+)" }
    },
    deleteNavigationProfile: { doc: "Delete a navigation profile (its menu and home pages go with it). The Responsive profile cannot be deleted.", fields: { profile: "R profile name, e.g. Phone or Native" } }
};

const APP_SYNONYMS = {
    setModuleSettings: { protected: "write it as \"exportLevel\": \"protected\"", type: "write it as \"exportLevel\": \"addOn\" or \"solution\"", moduleType: "write it as \"exportLevel\": \"addOn\" or \"solution\"" },
    moveConstant: { to: "write the target module as \"module\"", target: "write the target module as \"module\"" },
    deleteNavigationProfile: { name: "write it as \"profile\"" },
    changeNavigationProfile: { name: "write it as \"profile\"", otaEnabled: "write it as \"ota\"", timeout: "write it as \"networkTimeoutMs\"" }
};

const NATIVE_FIELDS = { ota: "otaEnabled", logging: "loggingEnabled", encryptDatabase: "encryptionDbEnabled", encryptFiles: "localFileEncryptionEnabled", encryptCookies: "sessionCookieEncryptionEnabled", applyScreenTransition: "applyScreenTransition" };
const strictBool = (v, field) => {
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    throw new Error(`${field} must be true or false, not ${JSON.stringify(v)}`);
};

// h: { model, client, get, folder, moduleNamed }
function makeApp(h) {
    const { model, client, get } = h;

    // files the ops read sit in the export folder: the change file's folder (its parent when that is edits/)
    h.exportFolder = h.exportFolder || (() => {
        const f = client && client.changeFile;
        if (!f) return process.cwd();
        const dir = path.dirname(f);
        return path.basename(dir) === "edits" ? path.dirname(dir) : dir;
    });

    // ------------------------------------------------ module settings

    async function moduleSettingsOf(name) {
        const m = h.moduleNamed(name);
        const ms = model.allModuleSettings ? model.allModuleSettings().find(x => x.containerAsModule === m) : m.moduleSettings;
        if (!ms) throw new Error(`${name} has no module settings document`);
        return { m, ms: ms.isLoaded ? ms : await ms.load() };
    }

    async function setModuleSettings(o) {
        const where = `setModuleSettings ${o.module}`;
        const { m, ms } = await moduleSettingsOf(o.module);
        if (["version", "exportLevel", "solutionIdentifier"].every(k => o[k] === undefined)) throw new Error(`${where}: give version, exportLevel or solutionIdentifier`);
        const done = [];
        if (o.version !== undefined) {
            const v = String(o.version).trim();
            if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`${where}: version is major.minor.patch, e.g. 1.2.0 (not '${v}')`);
            ms.version = v;
            done.push(`version ${v}`);
        }
        if (o.exportLevel !== undefined) {
            const want = LEVELS.find(l => l.toLowerCase() === String(o.exportLevel).replace(/[-_ ]/g, "").toLowerCase());
            if (!want) fail(`${where}: exportLevel '${o.exportLevel}' is not known`, String(o.exportLevel), LEVELS);
            if (m.fromAppStore) throw new Error(`REFUSED: ${o.module} is a Marketplace module; its export level comes from the package (only the module's publisher changes it)`);
            const was = ms.exportLevel.name === "Source" ? "source" : ms.protectedModuleType && ms.protectedModuleType.name === "Solution" ? "solution" : "addOn";
            if (want === "source") ms.exportLevel = projects.ModuleExportLevel.Source;
            else {
                ms.exportLevel = projects.ModuleExportLevel.Protected;
                const type = want === "solution" ? "Solution" : "AddOn";
                if (!setIfAvailable(ms, "protectedModuleType", projects.ProtectedModuleType[type])) throw new Error(`${where}: add-on / solution modules came with Mendix 9.12; this is ${client.project.version}`);
                client.warnFirst(`Projects$ModuleSettings ExportLevel Protected first use (no Studio Pro sample is protected): open ${o.module} > Settings in Studio Pro and check it`);
                client.warn(`${o.module} is protected (${type === "Solution" ? "solution" : "add-on"} module): an app that imports its .mpk sees only documents with export level API and cannot change it; export it with Studio Pro (right-click the module > Export ${type === "Solution" ? "solution" : "add-on"} module)`);
            }
            const now = want === "protected" ? "addOn" : want;
            done.push(`export level ${was} -> ${now}`);
            if (was !== "source" && now === "source") client.warn(`${o.module} is a source module again: apps that import it see and can change everything in it`);
        }
        if (o.solutionIdentifier !== undefined) {
            if (!setIfAvailable(ms, "solutionIdentifier", String(o.solutionIdentifier))) throw new Error(`${where}: solutionIdentifier came with Mendix 10.0`);
            done.push(`solution identifier ${o.solutionIdentifier || "(none)"}`);
        }
        return `${o.module}: ${done.join(", ")}`;
    }

    // ------------------------------------------------ moveConstant

    async function moveConstant(o) {
        await model.flushChanges();
        const g = refs.graph(client);
        const src = refs.known(g, String(o.constant));
        if (g.names.get(src) !== "Constants$Constant") throw new Error(`'${src}' is not a constant`);
        const [from, name] = src.split(".");
        const to = String(o.module || "");
        h.moduleNamed(to);
        if (to === from) throw new Error(`${src} is already in ${to} (moveDocument moves it to another folder)`);
        const target = model.allModules().find(x => x.name === to);
        if (target.fromAppStore) throw new Error(`${to} is a Marketplace module: an update would remove ${name}; move it to one of the app's own modules`);
        const dst = `${to}.${name}`;
        if (g.names.has(dst)) throw new Error(`${dst} already exists`);
        const unit = g.units.find(u => u.type === "Constants$Constant" && `${u.module}.${client.project.read(u.id).Name}` === src);
        if (!unit) throw new Error(`${src}: its unit is not found`);
        const uses = g.usesOf(src, false);
        // move the unit
        const f = h.folder(to, o.folder);
        client.moveUnit(unit.id, f.id, "Documents");
        // rename every reference (by name; in expressions as @Module.Constant)
        const units = new Set(uses.map(e => e.unit));
        const re = new RegExp(`(?<![\\w.$])${from}\\.${name}(?![\\w])`, "g");
        let count = 0;
        const docs = new Set();
        for (const id of units) {
            const tree = client.project.read(id);
            let n = 0;
            eachString(tree, (v, key) => {
                if (!key || /^(Name|Documentation|Caption|Text|Title)$/.test(key)) return v;
                const nv = v === src ? dst : v.replace(re, dst);
                if (nv !== v) n++;
                return nv;
            });
            if (n) {
                client.changes.updated.add(id);
                (client.rawUnits = client.rawUnits || new Set()).add(id);
                client.indexed.delete(id);
                client.indexUnit(id);
                docs.add(client.label(id));
            }
            count += n;
        }
        const lines = [`${count} reference(s) renamed in ${docs.size} document(s)${docs.size ? `: ${[...docs].slice(0, 10).join(", ")}${docs.size > 10 ? ", ..." : ""}` : ""}`];
        const code = refs.codeText(client.project.dir);
        const java = new RegExp(`\\b${from.toLowerCase()}\\.proxies\\.constants\\.Constants\\.get${name}\\b`);
        if (code && java.test(code)) client.warn(`${src}: Java code reads it as ${from.toLowerCase()}.proxies.constants.Constants.get${name}(); after Studio Pro regenerates the proxies it is ${to.toLowerCase()}.proxies.constants.Constants.get${name}()`);
        lines.push("its value in every configuration stays (configurations refer to it by name)");
        return `${src} -> ${dst}${o.folder ? ` (folder ${o.folder})` : ""}\n      ${lines.join("\n      ")}`;
    }

    // ------------------------------------------------ certificates

    async function certificateSettings() {
        const ps = model.allProjectSettings()[0];
        const loaded = ps && (await ps.load());
        const cs = loaded && loaded.settingsParts.find(p => p instanceof settings.CertificateSettings);
        if (!cs) throw new Error("the project has no certificate settings");
        return cs;
    }
    // what the certificate says about itself (PEM/DER X.509): subject and validity, or the file name
    function describe(bytes, file) {
        try {
            const pem = bytes.toString("latin1").includes("-----BEGIN CERTIFICATE-----") ? bytes.toString("latin1") : null;
            const x = new (require("crypto").X509Certificate)(pem || bytes);
            return { subject: x.subject.replace(/\n/g, ", "), validTo: x.validTo };
        } catch {
            return { subject: path.basename(file), validTo: null };
        }
    }
    async function addCertificate(o) {
        const where = `addCertificate ${o.file}`;
        const base = h.exportFolder();
        const full = path.resolve(base, String(o.file || ""));
        const rel = path.relative(base, full);
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${where}: the file is outside the export folder (${base}); copy it into edits/ first`);
        if (!fs.existsSync(full)) fail(`${where}: no file '${o.file}'`, path.basename(full), fs.existsSync(path.dirname(full)) ? fs.readdirSync(path.dirname(full)) : []);
        const ext = path.extname(full).toLowerCase();
        const client12 = [".p12", ".pfx"].includes(ext);
        if (![".crt", ".cer", ".pem", ".der", ".p12", ".pfx"].includes(ext)) throw new Error(`${where}: a certificate is a .crt, .cer, .pem, .der (authority) or .p12 / .pfx (client) file`);
        const type = o.type !== undefined ? ["Authority", "Client"].find(t => t.toLowerCase() === String(o.type).toLowerCase()) : client12 ? "Client" : "Authority";
        if (!type) fail(`${where}: type '${o.type}' is Authority or Client`, String(o.type), ["Authority", "Client"]);
        if (type === "Authority" && client12) throw new Error(`${where}: a .p12 / .pfx holds a client certificate with its key; give "type": "Client"`);
        const bytes = fs.readFileSync(full);
        if (bytes.length > 1048576) throw new Error(`${where}: ${(bytes.length / 1048576).toFixed(1)} MB is not a certificate`);
        const info = type === "Authority" ? describe(bytes, full) : { subject: path.basename(full), validTo: null };
        if (type === "Authority" && info.validTo && new Date(info.validTo) < new Date()) client.warn(`${o.file}: the certificate expired on ${info.validTo}`);
        const cs = await certificateSettings();
        const data = bytes.toString("base64");
        if (cs.certificates.some(c => c.data === data)) throw new Error(`${where}: the app already has this certificate`);
        const c = settings.Certificate.createIn(cs);
        c.type = settings.CertificateType[type];
        c.data = data;
        client.warnFirst(`Settings$Certificate first use (no Studio Pro sample has a certificate): check App > Settings > Certificates in Studio Pro`);
        if (type === "Client") client.warn(`${path.basename(full)}: a client certificate also needs its password and an identifier in the configuration's custom runtime settings (ClientCertificates, ClientCertificatePasswords) on the server`);
        return `${type} certificate ${info.subject}${info.validTo ? ` (valid to ${info.validTo})` : ""} (${cs.certificates.length} certificate(s))`;
    }
    async function deleteCertificate(o) {
        const cs = await certificateSettings();
        const all = [...cs.certificates];
        const label = (c, i) => `${i + 1}: ${c.type.name} ${c.type.name === "Authority" ? describe(Buffer.from(c.data || "", "base64"), "?").subject : "client certificate"}`;
        const list = all.map(label).join("; ");
        if (!all.length) throw new Error("deleteCertificate: the app has no certificates");
        let hit;
        if (typeof o.certificate === "number" || /^\d+$/.test(String(o.certificate))) hit = all[Number(o.certificate) - 1];
        else {
            const s = String(o.certificate || "").toLowerCase();
            const hits = all.filter((c, i) => label(c, i).toLowerCase().includes(s));
            hit = hits.length === 1 ? hits[0] : null;
        }
        if (!hit) throw new Error(`deleteCertificate: no single certificate '${o.certificate}'; give its number: ${list}`);
        const t = label(hit, all.indexOf(hit));
        hit.delete();
        return `certificate ${t.replace(/^\d+: /, "")} deleted`;
    }

    // ------------------------------------------------ navigation profiles

    async function profileNamed(name, where) {
        const doc = model.allNavigationDocuments()[0];
        if (!doc) throw new Error(`${where}: the project has no navigation document`);
        const nav = await doc.load();
        const want = String(name || "");
        const hit = nav.profiles.find(p => p.name.toLowerCase() === want.toLowerCase()) || nav.profiles.find(p => p.kind && p.kind.name.toLowerCase() === want.toLowerCase());
        if (!hit) fail(`${where}: no navigation profile '${want}'`, want, nav.profiles.map(p => p.name));
        return { nav, p: hit };
    }
    async function deleteNavigationProfile(o) {
        const where = `deleteNavigationProfile ${o.profile}`;
        const { nav, p } = await profileNamed(o.profile, where);
        if (p instanceof navigation.NavigationProfile && p.kind === navigation.ProfileKind.Responsive) throw new Error(`REFUSED: the Responsive profile is the app's web navigation; it cannot be deleted (delete its menu items with deleteMenuItem)`);
        const name = p.name;
        const items = p instanceof navigation.NavigationProfile && p.menuItemCollection ? p.menuItemCollection.items.length : 0;
        p.delete();
        return `${name} deleted (${items} menu item(s) with it; ${nav.profiles.length} profile(s) left: ${nav.profiles.map(x => x.name).join(", ")})`;
    }
    async function changeNavigationProfile(o) {
        const where = `changeNavigationProfile ${o.profile}`;
        const { p } = await profileNamed(o.profile, where);
        const native = p instanceof navigation.NativeNavigationProfile;
        const keys = Object.keys(APP_OPS.changeNavigationProfile.fields).filter(k => k !== "profile" && o[k] !== undefined);
        if (!keys.length) throw new Error(`${where}: give what changes: ${Object.keys(APP_OPS.changeNavigationProfile.fields).filter(k => k !== "profile").join(", ")}`);
        const done = [];
        for (const k of keys) {
            if (k === "throwPartialSyncError") {
                const offline = native || /Offline/.test(p.kind ? p.kind.name : "");
                if (!offline) throw new Error(`${where}: throwPartialSyncError applies to offline and native profiles; ${p.name} is online`);
                if (!setIfAvailable(p, "throwPartialSyncError", strictBool(o[k], k))) throw new Error(`${where}: throwPartialSyncError came with Mendix 11.12; this is ${client.project.version}`);
                done.push(`partial sync error ${o[k]}`);
                continue;
            }
            if (!native) throw new Error(`${where}: ${k} is an option of the native profile; ${p.name} is a web profile`);
            const set = (prop, v) => {
                if (!setIfAvailable(p, prop, v)) throw new Error(`${where}: ${k} is not an option of a native profile in Mendix ${client.project.version}`);
            };
            if (NATIVE_FIELDS[k]) {
                set(NATIVE_FIELDS[k], strictBool(o[k], k));
                done.push(`${k} ${p[NATIVE_FIELDS[k]]}`);
                if (k === "encryptDatabase" && !p.encryptionDbEnabled) client.warn("database encryption off: data on the device is stored unencrypted");
            } else if (k === "networkTimeoutMs") {
                const n = Number(o[k]);
                if (!(Number.isInteger(n) && n >= 1000 && n <= 600000)) throw new Error(`${where}: networkTimeoutMs is 1000..600000 milliseconds`);
                set("networkTimeoutMs", n);
                done.push(`network timeout ${n} ms`);
            } else if (k === "screenTransition" || k === "popupTransition") {
                const cls = k === "screenTransition" ? navigation.ScreenNavigationTransition : navigation.PopupNavigationTransition;
                const names = Object.keys(cls).filter(x => cls[x] instanceof cls);
                const hit = names.find(x => x.toLowerCase() === String(o[k]).toLowerCase());
                if (!hit) fail(`${where}: ${k} '${o[k]}' is not known`, String(o[k]), names);
                set(k === "screenTransition" ? "screenNavigationTransition" : "popupNavigationTransition", cls[hit]);
                done.push(`${k} ${hit}`);
            }
        }
        if (native) client.warnFirst(`Navigation$NativeNavigationProfile option change first use (no Studio Pro sample changes them): check App > Navigation > Native in Studio Pro`);
        return `${p.name}: ${done.join(", ")}`;
    }

    // ------------------------------------------------ checks

    const checks = {
        async setModuleSettings(o) {
            const { ms } = await moduleSettingsOf(o.module);
            const r = [];
            if (o.version !== undefined && ms.version !== String(o.version).trim()) r.push(`${o.module} version is ${ms.version}`);
            if (o.exportLevel !== undefined) {
                const w = String(o.exportLevel).toLowerCase() === "source" ? "Source" : "Protected";
                if (ms.exportLevel.name !== w) r.push(`${o.module} export level is ${ms.exportLevel.name}`);
            }
            return r;
        },
        async moveConstant(o) {
            const g = refs.graph(client);
            const dst = `${o.module}.${String(o.constant).split(".").pop()}`;
            const r = [];
            if (g.names.get(dst) !== "Constants$Constant") r.push(`${dst} missing`);
            if (g.names.has(o.constant)) r.push(`${o.constant} still exists`);
            const left = g.edges.filter(e => e.to === o.constant);
            if (left.length) r.push(`${left.length} reference(s) still name ${o.constant}: ${left.slice(0, 3).map(e => `${e.doc} ${e.place}`).join(", ")}`);
            return r;
        },
        async addCertificate() {
            const cs = await certificateSettings();
            return cs.certificates.length ? [] : ["no certificate stored"];
        },
        async deleteCertificate() {
            return [];
        },
        async deleteNavigationProfile(o) {
            const nav = await model.allNavigationDocuments()[0].load();
            return nav.profiles.some(p => p.name === o.profile) ? [`profile ${o.profile} still exists`] : [];
        },
        async changeNavigationProfile(o) {
            const { p } = await profileNamed(o.profile, "check");
            const r = [];
            for (const [k, prop] of Object.entries(NATIVE_FIELDS)) if (o[k] !== undefined && p[prop] !== strictBool(o[k], k)) r.push(`${p.name} ${k} is ${p[prop]}`);
            if (o.networkTimeoutMs !== undefined && p.networkTimeoutMs !== Number(o.networkTimeoutMs)) r.push(`${p.name} network timeout is ${p.networkTimeoutMs}`);
            return r;
        }
    };

    void get;
    return { impl: { setModuleSettings, moveConstant, addCertificate, deleteCertificate, changeNavigationProfile, deleteNavigationProfile }, checks };
}

module.exports = { makeApp, APP_OPS, APP_SYNONYMS };
