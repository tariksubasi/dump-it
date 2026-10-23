"use strict";
// Multilingual texts: project languages (addLanguage), translations of existing texts (setTranslations), per-language
// text objects in every other op ("caption": { "en_US": "Save", "tr_TR": "Kaydet" }) and the texts listing.
// Stored as Studio Pro stores them (learned from its projects): a Texts$Language { Code, CheckCompleteness false, empty
// custom formats } appended to the language settings; a Texts$Translation { LanguageCode, Text } appended to the
// Texts$Text in the order the languages were translated; a text keeps the languages it had.
const sdk = require("mendixmodelsdk");
const { fail, suggest, bool } = require("./ops-util");

const { pages, texts, enumerations, microflows: mf, domainmodels: dm, navigation, menus, customwidgets: cw } = sdk;

// Language codes Studio Pro offers (Java locales with a country), with English and own names for "did you mean".
const LANGUAGES = {
    af_ZA: "Afrikaans", ar_AE: "Arabic (UAE)", ar_DZ: "Arabic (Algeria)", ar_EG: "Arabic (Egypt)", ar_MA: "Arabic (Morocco)", ar_SA: "Arabic (Saudi Arabia)",
    az_AZ: "Azerbaijani Azərbaycan", be_BY: "Belarusian", bg_BG: "Bulgarian", bn_IN: "Bengali", bs_BA: "Bosnian", ca_ES: "Catalan Català",
    cs_CZ: "Czech Čeština", cy_GB: "Welsh", da_DK: "Danish Dansk", de_AT: "German (Austria)", de_CH: "German (Switzerland)", de_DE: "German Deutsch",
    el_GR: "Greek", en_AU: "English (Australia)", en_CA: "English (Canada)", en_GB: "English (UK)", en_IE: "English (Ireland)", en_IN: "English (India)",
    en_NZ: "English (New Zealand)", en_US: "English (US)", en_ZA: "English (South Africa)", es_AR: "Spanish (Argentina)", es_CO: "Spanish (Colombia)",
    es_ES: "Spanish Español", es_MX: "Spanish (Mexico)", et_EE: "Estonian Eesti", eu_ES: "Basque Euskara", fa_IR: "Persian Farsi", fi_FI: "Finnish Suomi",
    fil_PH: "Filipino", fr_BE: "French (Belgium)", fr_CA: "French (Canada)", fr_CH: "French (Switzerland)", fr_FR: "French Français", ga_IE: "Irish",
    gl_ES: "Galician", he_IL: "Hebrew", hi_IN: "Hindi", hr_HR: "Croatian Hrvatski", hu_HU: "Hungarian Magyar", hy_AM: "Armenian", id_ID: "Indonesian",
    is_IS: "Icelandic", it_CH: "Italian (Switzerland)", it_IT: "Italian Italiano", ja_JP: "Japanese", ka_GE: "Georgian", kk_KZ: "Kazakh", ko_KR: "Korean",
    lt_LT: "Lithuanian", lv_LV: "Latvian", mk_MK: "Macedonian", ms_MY: "Malay", mt_MT: "Maltese", nb_NO: "Norwegian Bokmål Norsk", nl_BE: "Dutch (Belgium) Vlaams",
    nl_NL: "Dutch Nederlands", pl_PL: "Polish Polski", pt_BR: "Portuguese (Brazil)", pt_PT: "Portuguese Português", ro_RO: "Romanian Română", ru_RU: "Russian",
    sk_SK: "Slovak", sl_SI: "Slovenian", sq_AL: "Albanian Shqip", sr_RS: "Serbian", sv_SE: "Swedish Svenska", sw_KE: "Swahili", ta_IN: "Tamil", th_TH: "Thai",
    tr_TR: "Turkish Türkçe", uk_UA: "Ukrainian", ur_PK: "Urdu", uz_UZ: "Uzbek", vi_VN: "Vietnamese", zh_CN: "Chinese (Simplified)", zh_HK: "Chinese (Hong Kong)",
    zh_TW: "Chinese (Traditional)"
};
const CODE = /^[a-z]{2,3}_[A-Z]{2}$/;

const TEXT_OPS = {
    addLanguage: {
        doc: "Add a language to the project (Settings > Languages), optionally as the default language. Existing texts keep their languages: translate them with setTranslations (list: texts --missing <code>).",
        fields: { code: "R language code, e.g. tr_TR, de_DE, nl_NL", default: "optional true: make it the default language (the language plain-string texts are written in)" }
    },
    changeLanguage: {
        doc: "Change a project language (Settings > Languages): make it the default, check completeness, custom date / time formats.",
        fields: { code: "R language code of the project, e.g. nl_NL", default: "optional true: make it the default language", checkCompleteness: "optional true/false: Studio Pro reports texts missing in this language",
            dateFormat: "optional custom date format, e.g. dd-MM-yyyy (\"\" = the language's own)", timeFormat: "optional custom time format, e.g. HH:mm", dateTimeFormat: "optional custom date-time format" }
    },
    deleteLanguage: {
        doc: "Delete a project language (not the default one: make another default first with changeLanguage). Texts keep their translations in that language (unused).",
        fields: { code: "R language code of the project" }
    },
    setTranslations: {
        doc: "Translate existing texts: page titles, widget captions/texts/labels/placeholders, enumeration captions, show-message and validation-feedback texts, validation rule messages, menu captions, system texts. Find them with: texts Module[.Document] | system [--missing <code>].",
        fields: {
            translations: "R [ { \"where\": \"<as texts lists it, e.g. Sales.Order_Edit.saveButton [caption]>\", \"language\": \"tr_TR\", \"text\": \"Kaydet\" } ]; where: Module.Page (title), Module.Page.widget [part], Module.Enumeration.Value, Module.Flow.<step id from steps>, Module.Entity.Attribute [rule], menu:Responsive/Caption, system:<key> (system texts, e.g. system:mendix.signin.username; list: texts system); {Attribute} shows a value as in the default text; \"text\" may also be { \"tr_TR\": ..., \"de_DE\": ... } without language",
            language: "optional language for items without one"
        }
    }
};

// A per-language text: { "en_US": "Save", "tr_TR": "Kaydet" } (every key a language code, every value text).
function isPerLanguage(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const keys = Object.keys(v);
    return keys.length > 0 && keys.every(k => CODE.test(k)) && Object.values(v).every(x => typeof x === "string" || typeof x === "number");
}

// {Attribute} -> {n} in the order of the default text (as the page builders do).
const NAMED = /\{([A-Za-z_][\w.]*(?:\/[A-Za-z_][\w.]*)*)\}/g; // {Attribute} or {Assoc/Attribute}
function namesIn(s) {
    const used = [];
    String(s).replace(NAMED, (m, a) => (used.includes(a) || used.push(a), m));
    return used;
}
const numbered = (s, used) => String(s).replace(NAMED, (m, a) => `{${used.indexOf(a) + 1}}`);
const short = s => (String(s).length > 60 ? String(s).slice(0, 57) + "..." : String(s));
const quote = s => JSON.stringify(String(s));
const isA = (el, ...cls) => cls.some(c => c && el instanceof c);
const NAMED_PARTS = [pages.Widget, pages.TabPage, pages.GridColumn, pages.ControlBarItem, pages.SearchField].filter(Boolean);
const WRAPPERS = ["template", "textTemplate", "value", "object", "properties", "objects", "arguments", "widgets", "layoutCall", "formCall"];
const SKIP = [cw && cw.CustomWidgetType, pages.Appearance, dm.MemberRef, dm.EntityRef].filter(Boolean);
const RULES = [["RequiredRuleInfo", "required"], ["UniqueRuleInfo", "unique"], ["MaxLengthRuleInfo", "maxLength"], ["RangeRuleInfo", "range"], ["RegExRuleInfo", "regex"], ["EqualsToRuleInfo", "equals"]];
const ruleKind = vr => (RULES.find(([c]) => dm[c] && vr.ruleInfo instanceof dm[c]) || [null, "rule"])[1];

function makeTexts(h) {
    const { model, get, client } = h;

    async function languageSettings() {
        const s = model.allProjectSettings()[0];
        const loaded = s && (await s.load());
        const ls = loaded && loaded.settingsParts.find(p => p instanceof sdk.settings.LanguageSettings);
        if (!ls) throw new Error("the project has no language settings");
        return ls;
    }

    // [default, ...other project languages]
    async function languages() {
        const ls = await languageSettings();
        const d = ls.defaultLanguageCode || "en_US";
        return [d, ...ls.languages.map(l => l.code).filter(c => c !== d)];
    }

    // A code Studio Pro offers; "tr", "turkish", "tr-tr" lead to tr_TR.
    function languageCode(input, where = "") {
        const raw = String(input === undefined ? "" : input).trim();
        const norm = raw.replace("-", "_").replace(/^([A-Za-z]{2,3})_([A-Za-z]{2})$/, (m, a, b) => `${a.toLowerCase()}_${b.toUpperCase()}`);
        if (LANGUAGES[norm]) return norm;
        const low = raw.toLowerCase();
        const hits = Object.keys(LANGUAGES).filter(c => c.split("_")[0] === low || LANGUAGES[c].toLowerCase().split(/[\s()]+/).includes(low));
        const s = hits.length ? hits.slice(0, 5) : suggest(norm, Object.keys(LANGUAGES), 5);
        throw new Error(`${where}'${raw}' is not a language code (language_COUNTRY, e.g. tr_TR, en_US, nl_NL)` + (s.length ? `. Did you mean: ${s.join(", ")}?` : ""));
    }

    // A language of this project; the error says how to add it.
    async function projectLanguage(input, where = "") {
        const ls = await languages();
        if (ls.includes(input)) return input;
        let code;
        try {
            code = languageCode(input, where);
        } catch (e) {
            throw new Error(`${e.message} Project languages: ${ls.join(", ")}`);
        }
        if (ls.includes(code)) return code;
        throw new Error(`${where}${code} is not a language of this project (${ls.join(", ")}); add it first: { "op": "addLanguage", "code": "${code}" }`);
    }

    // ------------------------------------------------ per-language objects in other ops

    // default-language text -> { other code: text } for the op being run; also the {1}-numbered form page templates write
    let pending = new Map();

    // A copy of op o with every per-language object replaced by its default-language text; the other languages are
    // written by text() when that default text is written (h.text hook). register = false: for checks only.
    async function prepare(o, register = true) {
        if (register) pending = new Map();
        if (!JSON.stringify(o || {}).includes("_")) return o;
        let ls = null;
        const conv = async (v, path) => {
            if (Array.isArray(v)) return Promise.all(v.map((x, i) => conv(x, `${path}[${i}]`)));
            if (!v || typeof v !== "object") return v;
            if (!isPerLanguage(v)) {
                const out = {};
                for (const [k, x] of Object.entries(v)) out[k] = await conv(x, path ? `${path}.${k}` : k);
                return out;
            }
            ls = ls || (await languages());
            if (!register) return v[ls[0]] !== undefined ? String(v[ls[0]]) : v;
            const items = {};
            for (const [k, x] of Object.entries(v)) items[await projectLanguage(k, `${path}: `)] = String(x);
            const dflt = items[ls[0]];
            if (dflt === undefined) throw new Error(`${path}: needs the text in the default language ${ls[0]} too (${JSON.stringify(v)})`);
            const others = Object.fromEntries(Object.entries(items).filter(([k]) => k !== ls[0]));
            if (dflt === "" || !Object.keys(others).length) return dflt;
            const used = namesIn(dflt);
            const keyed = [[dflt, others]];
            if (used.length) {
                for (const [k, x] of Object.entries(others)) {
                    const extra = namesIn(x).filter(n => !used.includes(n));
                    if (extra.length) throw new Error(`${path}: the ${k} text uses {${extra[0]}}, which the ${ls[0]} text does not show (both show the same values: ${used.map(n => `{${n}}`).join(", ")})`);
                }
                keyed.push([numbered(dflt, used), Object.fromEntries(Object.entries(others).map(([k, x]) => [k, numbered(x, used)]))]);
            }
            for (const [key, tr] of keyed) {
                const had = pending.get(key);
                if (had && JSON.stringify(had) !== JSON.stringify(tr)) throw new Error(`${path}: two texts say ${quote(key)} in ${ls[0]} with different translations; give them in two ops, or translate one with setTranslations`);
                pending.set(key, tr);
            }
            return dflt;
        };
        return conv(o, "");
    }

    // The other languages of a default-language text given per language in the current op (or null).
    const translationsOf = value => (value === undefined || value === null ? null : pending.get(String(value)) || null);

    // h.text hook: items written in the default language only get the op's other languages too.
    function withPending(items, dflt) {
        const keys = Object.keys(items);
        if (keys.length !== 1 || keys[0] !== dflt) return items;
        const tr = translationsOf(items[dflt]);
        return tr ? { ...items, ...tr } : items;
    }

    // ------------------------------------------------ translatable texts of a document

    function setTranslation(t, code, value) {
        let tr = t.translations.find(x => x.languageCode === code);
        if (!tr) {
            tr = texts.Translation.createIn(t);
            tr.languageCode = code;
        }
        tr.text = String(value);
    }

    // { where, part, t, ct } of every Texts$Text below el; parts named by the property path ("caption", "label",
    // "columns[2].header"); named widgets (and tab pages, columns, grid buttons) start a where of their own.
    function pageTexts(doc, qn) {
        const out = [];
        const seg = (name, el) => {
            if (el instanceof cw.WidgetProperty) return el.type ? el.type.key : "property";
            return { content: "text", labelTemplate: "label" }[name] || name;
        };
        const walk = (el, where, path) => {
            if (isA(el, ...SKIP)) return;
            if (el instanceof texts.Text) {
                const ct = el.container instanceof pages.ClientTemplate ? el.container : null;
                out.push({ where, part: path.filter(Boolean).join(".") || "text", t: el, ct });
                return;
            }
            for (const p of el.allProperties()) {
                const kind = p.constructor.name;
                if (kind !== "PartProperty" && kind !== "PartListProperty") continue;
                let v;
                try {
                    v = p.get();
                } catch {
                    continue;
                }
                if (!v) continue;
                const items = kind === "PartListProperty" ? [...v] : [v];
                items.forEach((x, i) => {
                    if (!x || typeof x.allProperties !== "function") return;
                    if (isA(x, ...NAMED_PARTS) && x.name) return walk(x, `${qn}.${x.name}`, []);
                    const next = [...path];
                    if (x instanceof cw.WidgetProperty) next.push(seg(p.name, x));
                    else if (!WRAPPERS.includes(p.name)) next.push(seg(p.name, x));
                    if (kind === "PartListProperty" && items.length > 1 && !(x instanceof cw.WidgetProperty)) {
                        if (next.length) next[next.length - 1] += `[${i + 1}]`;
                        else next.push(`[${i + 1}]`);
                    }
                    walk(x, where, next);
                });
            }
        };
        walk(doc, qn, []);
        return out;
    }

    function flowTexts(doc, qn) {
        const out = [];
        doc.traverse(el => {
            if (!(el instanceof mf.ActionActivity) || !el.action) return;
            const a = el.action;
            const where = `${qn}.${el.id.slice(0, 8)}`;
            if (a instanceof mf.ShowMessageAction && a.template) out.push({ where, part: "text", t: a.template.text, ct: null });
            if (a instanceof mf.ValidationFeedbackAction && a.feedbackTemplate) out.push({ where, part: "message", t: a.feedbackTemplate.text, ct: null });
        });
        return out;
    }

    function entityTexts(ent) {
        const out = [];
        const seen = new Map();
        for (const vr of ent.validationRules) {
            const attr = vr.attributeQualifiedName ? vr.attributeQualifiedName.split(".").pop() : "?";
            const where = `${ent.qualifiedName}.${attr}`;
            let part = ruleKind(vr);
            const n = (seen.get(where + part) || 0) + 1;
            seen.set(where + part, n);
            if (n > 1) part += n;
            out.push({ where, part, t: vr.errorMessage, ct: null });
        }
        return out;
    }

    const captionOf = (t, ls) => {
        if (!t) return "";
        const tr = t.translations.find(x => x.languageCode === ls[0] && x.text) || t.translations.find(x => x.text);
        return tr ? tr.text : "";
    };
    function menuTexts(items, prefix, ls, out = []) {
        for (const it of items) {
            const where = `${prefix}/${captionOf(it.caption, ls) || "(no caption)"}`;
            if (it.caption) out.push({ where, part: "caption", t: it.caption, ct: null });
            menuTexts(it.items, where, ls, out);
        }
        return out;
    }

    async function navigationTexts(ls) {
        const out = [];
        for (const d of model.allNavigationDocuments()) {
            const nav = await d.load();
            for (const p of nav.profiles) if (p instanceof navigation.NavigationProfile && p.menuItemCollection) menuTexts(p.menuItemCollection.items, `menu:${p.name}`, ls, out);
        }
        return out;
    }

    async function documentTexts(doc, ls) {
        const qn = doc.qualifiedName;
        if (isA(doc, pages.Page, pages.Snippet, pages.Layout)) return pageTexts(doc, qn);
        if (doc instanceof enumerations.Enumeration) return doc.values.map(v => ({ where: `${qn}.${v.name}`, part: "caption", t: v.caption, ct: null }));
        if (doc instanceof mf.MicroflowBase) return flowTexts(doc, qn);
        if (doc instanceof dm.DomainModel) return doc.entities.flatMap(entityTexts);
        if (doc instanceof dm.Entity) return entityTexts(doc);
        if (menus && doc instanceof menus.MenuDocument) return menuTexts(doc.itemCollection.items, qn, ls);
        return [];
    }

    const moduleOf = u => {
        let c = u.container;
        while (c && !(c instanceof sdk.projects.Module)) c = c.container;
        return c;
    };
    const TEXT_UNITS = u => isA(u, pages.Page, pages.Snippet, pages.Layout, enumerations.Enumeration, mf.MicroflowBase, dm.DomainModel, menus && menus.MenuDocument);

    // System texts (App > Languages > System texts) by key: where "system:mendix.signin.username".
    async function systemTexts() {
        const out = [];
        for (const c of model.allSystemTextCollections ? model.allSystemTextCollections() : []) {
            const col = await c.load();
            for (const st of col.systemTexts) if (st.text) out.push({ where: `system:${st.key}`, part: "text", t: st.text, ct: null });
        }
        return out;
    }

    // The texts of a scope: nothing = the project's own modules and the menus, "Module", "Module.Document",
    // "Module.Entity", "menu" (navigation), "system" (system texts).
    async function textsIn(scope, ls) {
        const s = String(scope || "").trim();
        if (/^system(:.*)?$/i.test(s)) return systemTexts();
        if (/^(menu|navigation)(:.*)?$/i.test(s)) return navigationTexts(ls);
        if (s.includes(".")) {
            const doc = await get(s.split("/")[0]);
            const all = await documentTexts(doc, ls);
            if (!all.length && !TEXT_UNITS(doc) && !(doc instanceof dm.Entity)) throw new Error(`'${s}' has no translatable texts (pages, snippets, layouts, enumerations, microflows/nanoflows, entities, menus have)`);
            return all;
        }
        const mods = model.allModules().filter(m => (s ? m.name === s : !m.fromAppStore));
        if (s && !mods.length) fail(`no module '${s}'`, s, model.allModules().map(m => m.name));
        const out = [];
        for (const u of model.allUnits()) {
            if (!TEXT_UNITS(u)) continue;
            const m = moduleOf(u);
            if (!m || !mods.includes(m)) continue;
            out.push(...(await documentTexts(await u.load(), ls)));
        }
        if (!s) out.push(...(await navigationTexts(ls)));
        return out;
    }

    // {n} -> {Attribute} for showing; and back for writing
    const paramNames = ct => (ct ? ct.parameters.map(p => (p.attributeRef && p.attributeRef.attributeQualifiedName ? p.attributeRef.attributeQualifiedName.split(".").pop() : null)) : []);
    const shown = (s, ct) => {
        const names = paramNames(ct);
        return String(s).replace(/\{(\d+)\}/g, (m, n) => (names[n - 1] ? `{${names[n - 1]}}` : m));
    };
    function stored(value, e, where) {
        const names = paramNames(e.ct);
        return String(value).replace(/\{([A-Za-z_][A-Za-z0-9_]*|\d+)\}/g, (m, a) => {
            if (/^\d+$/.test(a)) {
                if (e.ct && Number(a) >= 1 && Number(a) <= e.ct.parameters.length) return m;
                if (!e.ct) return m; // microflow message texts: {1} = the action's arguments
                throw new Error(`${where}: {${a}}: this text shows ${e.ct.parameters.length} value(s)`);
            }
            const i = names.indexOf(a);
            if (!e.ct) return m;
            if (i < 0) throw new Error(`${where}: {${a}} is not a value this text shows (${names.filter(Boolean).map(n => `{${n}}`).join(", ") || "none"}); new values: change the default text with changeWidget`);
            return `{${i + 1}}`;
        });
    }

    const label = e => `${e.where} [${e.part}]`;

    // The texts entry an item points at; did you mean on the document's texts.
    async function resolve(whereIn, partIn, ls, where) {
        const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(String(whereIn || "").trim());
        const at = m ? m[1] : String(whereIn || "").trim();
        const part = partIn || (m && m[2]);
        if (!at) throw new Error(`${where}: needs "where" (as the texts command lists it)`);
        let scope;
        if (/^system:/i.test(at)) {
            const all = await textsIn("system", ls);
            const key = at.replace(/^system:\s*/i, "");
            const hit = all.find(e => e.where.toLowerCase() === `system:${key}`.toLowerCase()) || all.find(e => e.where.toLowerCase() === `system:mendix.${key}`.toLowerCase());
            if (hit) return hit;
            const keys = all.map(e => e.where.slice(7));
            const s = suggest(key, keys, 5).length ? suggest(key, keys, 5) : keys.filter(k => k.toLowerCase().includes(key.toLowerCase().split(".").pop())).slice(0, 5);
            throw new Error(`${where}: no system text '${key}'` + (s.length ? `. Did you mean: ${s.map(k => "system:" + k).join(", ")}?` : ` (texts system lists the ${keys.length} keys)`));
        }
        if (/^menu:/i.test(at)) scope = "menu";
        else {
            const parts = at.split("/")[0].split(".");
            if (parts.length < 2) throw new Error(`${where}: '${at}': write Module.Document (a page title), Module.Page.widget, Module.Enumeration.Value, Module.Flow.<step id>, Module.Entity.Attribute or menu:Profile/Caption`);
            scope = parts.slice(0, 2).join(".");
        }
        const all = await textsIn(scope, ls);
        const norm = s => s.replace(/^menu:/i, "menu:").toLowerCase();
        let hits = all.filter(e => norm(e.where) === norm(at));
        if (/^menu:/i.test(at) && !hits.length) hits = all.filter(e => norm(e.where).replace(/^menu:[^/]*/, "") === norm(at).replace(/^menu:[^/]*/, "") && /^menu:[^/]*$/i.test(at.split("/")[0]));
        if (!hits.length && /^[0-9a-f]{4,}$/i.test(at.split(".").pop())) hits = all.filter(e => e.where.startsWith(scope + ".") && e.where.split(".").pop().startsWith(at.split(".").pop().toLowerCase()));
        if (!hits.length) {
            const s = suggest(at, [...new Set(all.map(e => e.where))], 5);
            throw new Error(`${where}: no translatable text at '${at}'` + (s.length ? `. Did you mean: ${s.join(", ")}?` : all.length ? ` (texts ${scope} lists them)` : ` (${scope} has none)`));
        }
        if (part) {
            const p = hits.filter(e => e.part.toLowerCase() === String(part).toLowerCase());
            if (p.length === 1) return p[0];
            fail(`${where}: ${at} has no text [${part}] (it has: ${hits.map(e => e.part).join(", ")})`, part, hits.map(e => e.part));
        }
        const filled = hits.filter(e => e.t.translations.some(x => x.text));
        if (hits.length > 1 && filled.length === 1) return filled[0];
        if (hits.length > 1) throw new Error(`${where}: ${at} has ${hits.length} texts; name one: ${hits.map(label).join(", ")}`);
        return hits[0];
    }

    // [{ e, code, text }] of a setTranslations op
    async function items(o) {
        if (!Array.isArray(o.translations) || !o.translations.length) throw new Error(`"translations" must be a list of { "where", "language", "text" }`);
        const ls = await languages();
        const out = [];
        for (const [i, it] of o.translations.entries()) {
            const where = `translations[${i}]`;
            if (!it || typeof it !== "object") throw new Error(`${where}: each item is { "where": ..., "language": ..., "text": ... }`);
            const unknown = Object.keys(it).filter(k => !["where", "part", "language", "text"].includes(k));
            if (unknown.length) fail(`${where}: unknown field '${unknown[0]}'`, unknown[0], ["where", "part", "language", "text"]);
            const e = await resolve(it.where, it.part, ls, where);
            const pairs = isPerLanguage(it.text) ? Object.entries(it.text) : [[it.language || o.language, it.text]];
            for (const [lang, text] of pairs) {
                if (lang === undefined) throw new Error(`${where}: needs "language" (e.g. tr_TR)`);
                if (text === undefined || text === null || typeof text === "object") throw new Error(`${where}: needs "text" (the translation)`);
                const code = await projectLanguage(lang, `${where}: `);
                out.push({ e, code, text: stored(text, e, `${where} (${label(e)})`), raw: String(text), dflt: code === ls[0] });
            }
        }
        return out;
    }

    const impl = {
        async addLanguage(o) {
            const code = languageCode(o.code);
            const ls = await languageSettings();
            const done = [];
            if (!ls.languages.some(l => l.code === code)) {
                const l = sdk.settings.Language.createIn(ls);
                l.code = code;
                l.checkCompleteness = false;
                l.customDateFormat = "";
                l.customTimeFormat = "";
                l.customDateTimeFormat = "";
                done.push(`${code} (${LANGUAGES[code].split(/ (?=[^(]*$)/)[0]}) added`);
            } else done.push(`${code} is already a project language`);
            if (bool(o.default, false) && ls.defaultLanguageCode !== code) {
                const was = ls.defaultLanguageCode;
                ls.defaultLanguageCode = code;
                if (h.resetLanguage) h.resetLanguage();
                done.push(`default language ${was} -> ${code}`);
                client.warn(`default language is now ${code}: plain-string texts in later ops are written in ${code}; texts that exist only in ${was} need a ${code} text (texts --missing ${code})`);
            }
            if (!done[0].endsWith("added") && done.length === 1) return done[0];
            return done.join(", ") + (done[0].endsWith("added") ? `; translate existing texts with setTranslations (list: texts --missing ${code})` : "");
        },
        async changeLanguage(o) {
            const code = languageCode(o.code);
            const ls = await languageSettings();
            const l = ls.languages.find(x => x.code === code);
            if (!l) fail(`changeLanguage: ${code} is not a project language (add it with addLanguage)`, code, ls.languages.map(x => x.code));
            const done = [];
            if (["default", "checkCompleteness", "dateFormat", "timeFormat", "dateTimeFormat"].every(k => o[k] === undefined)) throw new Error("changeLanguage: give default, checkCompleteness, dateFormat, timeFormat or dateTimeFormat");
            if (o.default !== undefined) {
                if (!bool(o.default, false)) throw new Error(`changeLanguage: "default": false is not a change; make another language the default`);
                if (ls.defaultLanguageCode !== code) {
                    const was = ls.defaultLanguageCode;
                    ls.defaultLanguageCode = code;
                    if (h.resetLanguage) h.resetLanguage();
                    done.push(`default language ${was} -> ${code}`);
                    client.warn(`default language is now ${code}: plain-string texts in later ops are written in ${code}; texts that exist only in ${was} need a ${code} text (texts --missing ${code})`);
                } else done.push(`${code} is already the default`);
            }
            if (o.checkCompleteness !== undefined) {
                l.checkCompleteness = bool(o.checkCompleteness, false);
                done.push(`check completeness ${l.checkCompleteness}`);
            }
            for (const [k, prop] of [["dateFormat", "customDateFormat"], ["timeFormat", "customTimeFormat"], ["dateTimeFormat", "customDateTimeFormat"]]) {
                if (o[k] === undefined) continue;
                const f = String(o[k]);
                if (f && !/[dMyHhmsaEu]/.test(f)) throw new Error(`changeLanguage: ${k} '${f}' has no date/time letters (d, M, y, H, h, m, s, a), e.g. dd-MM-yyyy or HH:mm`);
                l[prop] = f;
                done.push(`${k} ${f || "(language default)"}`);
            }
            return `${code}: ${done.join(", ")}`;
        },
        async deleteLanguage(o) {
            const code = languageCode(o.code);
            const ls = await languageSettings();
            const l = ls.languages.find(x => x.code === code);
            if (!l) fail(`deleteLanguage: ${code} is not a project language`, code, ls.languages.map(x => x.code));
            if (ls.defaultLanguageCode === code) throw new Error(`REFUSED: ${code} is the default language; make another language the default first: { "op": "changeLanguage", "code": "${ls.languages.find(x => x.code !== code) ? ls.languages.find(x => x.code !== code).code : "en_US"}", "default": true }`);
            l.delete();
            return `${code} deleted (${ls.languages.length} language(s) left: ${ls.languages.map(x => x.code).join(", ")}); texts keep their ${code} translations, unused`;
        },
        async setTranslations(o) {
            const list = await items(o);
            for (const x of list) setTranslation(x.e.t, x.code, x.text);
            const byLang = {};
            for (const x of list) byLang[x.code] = (byLang[x.code] || 0) + 1;
            const changedDefault = list.filter(x => x.dflt);
            if (changedDefault.length) client.warn(`setTranslations changed ${changedDefault.length} default-language text(s) (${changedDefault.map(x => label(x.e)).slice(0, 3).join(", ")})`);
            return Object.entries(byLang).map(([k, n]) => `${n} ${k}`).join(", ") + ": " + list.map(x => `${label(x.e)} ${x.code} ${quote(short(x.raw))}`).join("; ");
        }
    };

    const checks = {
        async addLanguage(o) {
            const code = languageCode(o.code);
            const ls = await languageSettings();
            const r = [];
            if (!ls.languages.some(l => l.code === code)) r.push(`${code} is not a project language`);
            if (bool(o.default, false) && ls.defaultLanguageCode !== code) r.push(`default language is ${ls.defaultLanguageCode}`);
            return r;
        },
        async changeLanguage(o) {
            const code = languageCode(o.code);
            const ls = await languageSettings();
            const l = ls.languages.find(x => x.code === code);
            const r = [];
            if (!l) return [`${code} is not a project language`];
            if (bool(o.default, false) && ls.defaultLanguageCode !== code) r.push(`default language is ${ls.defaultLanguageCode}`);
            if (o.checkCompleteness !== undefined && l.checkCompleteness !== bool(o.checkCompleteness, false)) r.push(`${code} check completeness is ${l.checkCompleteness}`);
            if (o.dateFormat !== undefined && l.customDateFormat !== String(o.dateFormat)) r.push(`${code} date format is ${l.customDateFormat}`);
            return r;
        },
        async deleteLanguage(o) {
            const ls = await languageSettings();
            return ls.languages.some(x => x.code === languageCode(o.code)) ? [`${o.code} is still a project language`] : [];
        },
        async setTranslations(o) {
            const r = [];
            for (const x of await items(o)) {
                const tr = x.e.t.translations.find(y => y.languageCode === x.code);
                if (!tr || tr.text !== x.text) r.push(`${label(x.e)} ${x.code} is ${tr ? quote(tr.text) : "missing"}`);
            }
            return r;
        }
    };

    // texts [scope] [--missing <code>]: one line per text with its translations
    async function list(scope, missing, limit = 400) {
        const ls = await languages();
        const want = missing && missing !== true ? await projectLanguage(missing) : null;
        const all = (await textsIn(scope, ls)).filter(e => e.t && e.t.translations.some(x => x.text));
        const has = (e, c) => e.t.translations.some(x => x.languageCode === c && x.text);
        const rows = want ? all.filter(e => has(e, ls[0]) && !has(e, want)) : all;
        const head = `Texts in ${scope || "the project's own modules and menus"} (languages: ${ls[0]} (default)${ls.length > 1 ? ", " + ls.slice(1).join(", ") : ""}): ${all.length}` +
            (want ? `, ${rows.length} without ${want}` : ls.length > 1 ? `, ${all.filter(e => ls.some(c => !has(e, c))).length} not in every language` : "");
        const lines = rows.slice(0, limit).map(e => {
            const tr = ls.map(c => {
                const x = e.t.translations.find(y => y.languageCode === c);
                return `${c}: ${x && x.text ? quote(shown(x.text, e.ct)) : "-"}`;
            });
            return `${label(e)}  ${tr.join(" | ")}`;
        });
        if (rows.length > limit) lines.push(`... ${rows.length - limit} more (narrow it: texts Module.Document)`);
        const tail = rows.length ? `\nTranslate: { "op": "setTranslations", "translations": [ { "where": "${label(rows[0])}", "language": "${want || ls[1] || "tr_TR"}", "text": "..." } ] }` : "";
        return [head, ...lines].join("\n") + tail;
    }

    return { impl, checks, prepare, translationsOf, withPending, list, languages };
}

module.exports = { makeTexts, TEXT_OPS, LANGUAGES, isPerLanguage };
