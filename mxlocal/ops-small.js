"use strict";
// Changing and deleting what the create/add ops make: constants, scheduled events, validation rules (also their
// order), event handlers (changeEventHandler: moment, event, microflow, options), indexes, and enumeration values
// (order, captions per language, images). The elements keep the keys
// Studio Pro stored for them (or the add op wrote); only values change. Samples: Constants$Constant in every test
// project; DomainModels$EntityIndex (DataGrid, ImageCropper); no Studio Pro sample of a scheduled event, a domain
// model validation rule, an event handler or an enumeration value with an image (Image "" everywhere): their
// first use is reported.
const sdk = require("mendixmodelsdk");
const { fail, bool, enumValue, reorder } = require("./ops-util");

const { domainmodels: dm, microflows: mf, constants, scheduledevents: se, enumerations } = sdk;

const RULES = { required: "RequiredRuleInfo", unique: "UniqueRuleInfo", maxlength: "MaxLengthRuleInfo", range: "RangeRuleInfo", regex: "RegExRuleInfo", equals: "EqualsToRuleInfo" };
const RULE_NAMES = ["required", "unique", "maxLength", "range", "regex", "equals"];
const INDEX = "R which index: its attributes in order [ \"Title\", \"Count\" ] or a number (1 = the entity's first index)";

const SMALL_OPS = {
    changeConstant: {
        doc: "Change a constant: default value, type, exposed to the client.",
        fields: { constant: "R Module.Constant", default: "optional new default value as text (also: value)", value: "optional same as default", type: "optional String | Integer | Long | Decimal | Boolean | DateTime", exposedToClient: "optional true/false" }
    },
    changeScheduledEvent: {
        doc: "Change a scheduled event: its microflow, schedule (every, interval, at, days), enabled, time zone, overlap.",
        fields: {
            event: "R Module.ScheduledEvent", microflow: "optional Module.Microflow (no parameters)", every: "optional Minute | Hour | Day | Week (a new schedule; default: the current kind)",
            interval: "optional number for Minute/Hour", at: "optional time HH:MM for Day/Week, minutes MM for Hour", days: "optional Week: [ \"Monday\", ... ]",
            enabled: "optional true/false", timeZone: "optional UTC | Server", onOverlap: "optional DelayNext | SkipNext"
        }
    },
    changeValidationRule: {
        doc: "Change a validation rule of an attribute: its message, its values (max length, range, regular expression, value) or its place in the entity's list of rules.",
        fields: {
            entity: "R Module.Entity", attribute: "R attribute name", rule: `optional ${RULE_NAMES.join(" | ")}: which rule (needed when the attribute has several)`,
            message: "optional new error message (text, or { \"en_US\": ..., \"nl_NL\": ... })", maxLength: "maxLength: number", min: "range: minimum (null = none)", max: "range: maximum (null = none)",
            regex: "regex: Module.RegularExpression", value: "equals: value",
            position: "optional number: its place among the entity's validation rules (1 = first; the order the messages are checked in)"
        }
    },
    deleteValidationRule: { doc: "Delete a validation rule of an attribute.", fields: { entity: "R Module.Entity", attribute: "R attribute name", rule: `optional ${RULE_NAMES.join(" | ")} (needed when the attribute has several)` } },
    deleteEventHandler: {
        doc: "Delete an event handler of an entity (the microflow stays).",
        fields: { entity: "R Module.Entity", moment: "optional Before | After", event: "optional Create | Commit | Delete | RollBack", microflow: "optional Module.Microflow (what it runs)" }
    },
    changeEventHandler: {
        doc: "Change an event handler of an entity: when it runs (moment, event), the microflow, pass the object, raise an error on false. Give only what changes.",
        fields: { entity: "R Module.Entity", handler: "R which handler: \"Before Commit\" (moment and event) or a number (1 = the entity's first handler)",
            moment: "optional new Before | After", event: "optional new Create | Commit | Delete | RollBack", microflow: "optional new Module.Microflow",
            passObject: "optional true/false: pass the object as the microflow's parameter", raiseErrorOnFalse: "optional true/false (Before only)" }
    },
    changeIndex: { doc: "Change the attributes of a database index.", fields: { entity: "R Module.Entity", index: INDEX, attributes: "R new attributes [ \"Attr\" or { \"name\": \"Attr\", \"ascending\": false } ]" } },
    deleteIndex: { doc: "Delete a database index.", fields: { entity: "R Module.Entity", index: INDEX } },
    moveEnumerationValue: {
        doc: "Move an enumeration value to another place in the list (the order drop-downs and radio buttons show).",
        fields: { value: "R Module.Enumeration.Value", before: "optional name of the value it goes before", after: "optional name of the value it goes after", position: "optional number: 1 = first" }
    },
    changeEnumerationValue: {
        doc: "Change the caption (per language) or image of an enumeration value. Rename it with { \"op\": \"rename\" }.",
        fields: { value: "R Module.Enumeration.Value", caption: "optional caption: text, or { \"en_US\": \"Open\", \"nl_NL\": \"Open\" }", image: "optional Module.ImageCollection.Image (\"\" = none)" }
    }
};

const SMALL_SYNONYMS = {
    changeConstant: { name: "rename it with { \"op\": \"rename\" }", exposed: "write it as \"exposedToClient\"", defaultValue: "write it as \"default\"" },
    changeScheduledEvent: { start: "write the start time as \"at\": \"HH:MM\" (Day/Week) or \"MM\" (Hour)", startDateTime: "write the start time as \"at\": \"HH:MM\"", name: "rename it with { \"op\": \"rename\" }", schedule: "use \"every\", \"interval\", \"at\" and \"days\"" },
    changeValidationRule: { type: "the kind of rule cannot change: deleteValidationRule, then addValidationRule", errorMessage: "write it as \"message\"" },
    deleteIndex: { attributes: "name the index with \"index\": [ \"Attr\", ... ]" },
    changeEventHandler: { index: "write it as \"handler\": 1", passEventObject: "write it as \"passObject\"", raiseError: "write it as \"raiseErrorOnFalse\"", when: "write it as \"moment\": \"Before\" | \"After\"" },
    changeEnumerationValue: { name: "rename it with { \"op\": \"rename\", \"target\": \"Module.Enum.Value\", \"newName\": ... }", newName: "rename it with { \"op\": \"rename\" }" },
    moveEnumerationValue: { to: "use \"position\" (1 = first), \"before\" or \"after\"", index: "use \"position\" (1 = first)" },
    delete: {
        rule: "a validation rule is deleted with deleteValidationRule { entity, attribute, rule }", moment: "an event handler is deleted with deleteEventHandler { entity, moment, event }",
        event: "an event handler is deleted with deleteEventHandler { entity, moment, event }", index: "an index is deleted with deleteIndex { entity, index }"
    }
};

const strict = (v, field, where) => {
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    throw new Error(`${where}: ${field} must be true or false, not ${JSON.stringify(v)}`);
};

// x: { model, client, get, entity, text, dataType, exists }
function makeSmall(x) {
    const { client } = x;
    const kindOf = info => {
        const t = info && info.structureTypeName.split("$")[1];
        return Object.keys(RULES).find(k => RULES[k] === t);
    };
    const ruleName = k => RULE_NAMES.find(n => n.toLowerCase() === k) || k;

    async function ownEntity(qn) {
        const e = await x.entity(qn);
        if (!e) throw new Error(`'${qn}' is not an entity`);
        return e;
    }

    // ------------------------------------------------ constants

    function checkConstValue(type, v, where) {
        const s = String(v);
        const t = String(type).toLowerCase();
        const ok = t === "integer" || t === "long" ? /^-?\d+$/.test(s) : t === "decimal" ? /^-?\d+(\.\d+)?$/.test(s) : t === "boolean" ? /^(true|false)$/.test(s) : true;
        if (!ok) throw new Error(`${where}: '${s}' is not ${/^[AEIOU]/.test(type) ? "an" : "a"} ${type} value${t === "boolean" ? " (true or false)" : ""}`);
    }

    async function changeConstant(o) {
        const c = await x.get(o.constant);
        if (!(c instanceof constants.Constant)) throw new Error(`'${o.constant}' is not a constant`);
        if (o.default !== undefined && o.value !== undefined) throw new Error(`changeConstant ${o.constant}: give "default" or "value", not both`);
        const value = o.default !== undefined ? o.default : o.value;
        if (value === undefined && o.type === undefined && o.exposedToClient === undefined) throw new Error(`changeConstant ${o.constant} needs "default", "type" or "exposedToClient"`);
        const done = [];
        const allowed = ["String", "Integer", "Long", "Decimal", "Boolean", "DateTime"];
        const cur = c.type ? c.type.structureTypeName.split("$")[1].replace("Type", "") : "String";
        const type = o.type !== undefined ? allowed.find(a => a.toLowerCase() === String(o.type).toLowerCase()) : cur;
        if (!type) fail(`changeConstant ${o.constant}: type '${o.type}' is not allowed`, o.type, allowed);
        checkConstValue(type, value !== undefined ? value : c.defaultValue, `changeConstant ${o.constant}`);
        if (o.type !== undefined && type !== cur) {
            c.type = await x.dataType(type);
            done.push(`type ${cur} -> ${type}`);
            client.warn(`${o.constant}: the type changed; values set for it in configurations (App > Settings, setConfiguration) and expressions that use @${o.constant} may need a change`);
        }
        if (value !== undefined) {
            c.defaultValue = String(value);
            done.push(`default ${JSON.stringify(String(value))}`);
        }
        if (o.exposedToClient !== undefined) {
            c.exposedToClient = bool(o.exposedToClient, false);
            done.push(c.exposedToClient ? "exposed to the client" : "not exposed to the client");
        }
        return `${o.constant}: ${done.join(", ")}`;
    }

    // ------------------------------------------------ scheduled events

    function at(o, unit) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(o.at)) || /^()(\d{1,2})$/.exec(String(o.at));
        if (!m) throw new Error(`'at' must look like 02:30 (or 15 for minutes past the hour), got '${o.at}'`);
        const hour = Number(m[1] || 0), minute = Number(m[2]);
        if (hour > 23 || minute > 59) throw new Error(`'at' ${o.at} is not a valid time`);
        if (unit === "minute") throw new Error("'at' does not apply to every Minute");
        return { hour, minute };
    }

    async function changeScheduledEvent(o) {
        const ev = await x.get(o.event);
        if (!(ev instanceof se.ScheduledEvent)) throw new Error(`'${o.event}' is not a scheduled event`);
        const fields = ["microflow", "every", "interval", "at", "days", "enabled", "timeZone", "onOverlap"].filter(k => o[k] !== undefined);
        if (!fields.length) throw new Error(`changeScheduledEvent ${o.event}: give what to change: microflow, every, interval, at, days, enabled, timeZone, onOverlap`);
        const done = [];
        if (o.microflow !== undefined) {
            const target = await x.get(o.microflow);
            if (!(target instanceof mf.Microflow)) throw new Error(`'${o.microflow}' is not a microflow`);
            if (target.objectCollection.objects.some(p => p instanceof mf.MicroflowParameterObject)) throw new Error(`${o.microflow} has parameters; a scheduled event needs a microflow without parameters`);
            ev.microflow = target;
            done.push(`runs ${o.microflow}`);
        }
        if (["every", "interval", "at", "days"].some(k => o[k] !== undefined)) {
            const s = ev.schedule;
            const curUnit = s instanceof se.MinuteSchedule ? "minute" : s instanceof se.HourSchedule ? "hour" : s instanceof se.DaySchedule ? "day" : s instanceof se.WeekSchedule ? "week" : s ? "other" : null;
            const units = ["Minute", "Hour", "Day", "Week"];
            const unit = o.every !== undefined ? String(o.every).toLowerCase() : curUnit;
            if (!["minute", "hour", "day", "week"].includes(unit)) {
                if (o.every !== undefined) fail(`'every' must be Minute | Hour | Day | Week, got '${o.every}'`, o.every, units);
                throw new Error(`${o.event} has a ${curUnit === "other" ? s.structureTypeName.split("$")[1] : "legacy"} schedule; give "every": Minute | Hour | Day | Week for a new one`);
            }
            const same = unit === curUnit;
            const keep = (k, d) => (same && s[k] !== undefined ? s[k] : d);
            const interval = Number(o.interval !== undefined ? o.interval : keep("multiplier", 1));
            if ((unit === "minute" || unit === "hour") && !(interval >= 1)) throw new Error("interval must be a number >= 1");
            if ((unit === "day" || unit === "week") && o.interval !== undefined) throw new Error(`'interval' applies to every Minute or Hour, not ${unit}`);
            const t = o.at !== undefined ? at(o, unit) : { hour: keep("hourOfDay", 0), minute: unit === "hour" ? keep("minuteOffset", 0) : keep("minuteOfHour", 0) };
            if (o.days !== undefined && unit !== "week") throw new Error("'days' applies to every Week");
            const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
            let days = o.days !== undefined ? [].concat(o.days).map(d => String(d).toLowerCase()) : same && unit === "week" ? names.filter(d => s[d]) : [];
            for (const d of days) if (!names.includes(d)) fail(`'${d}' is not a weekday`, d, names);
            if (unit === "week" && !days.length) throw new Error("every Week needs days: [ \"Monday\", ... ]");
            if (unit === "minute") {
                se.MinuteSchedule.createIn(ev).multiplier = interval;
                ev.interval = interval;
                ev.intervalType = se.IntervalType.Minute;
            } else if (unit === "hour") {
                const n = se.HourSchedule.createIn(ev);
                n.multiplier = interval;
                n.minuteOffset = t.minute;
                ev.interval = interval;
                ev.intervalType = se.IntervalType.Hour;
            } else if (unit === "day") {
                const n = se.DaySchedule.createIn(ev);
                n.hourOfDay = t.hour;
                n.minuteOfHour = t.minute;
                ev.interval = 1;
                ev.intervalType = se.IntervalType.Day;
            } else {
                const n = se.WeekSchedule.createIn(ev);
                for (const d of days) n[d] = true;
                n.hourOfDay = t.hour;
                n.minuteOfHour = t.minute;
                ev.interval = 1;
                ev.intervalType = se.IntervalType.Week;
            }
            const hhmm = `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
            done.push(unit === "minute" ? `every ${interval} minute(s)` : unit === "hour" ? `every ${interval} hour(s) at :${String(t.minute).padStart(2, "0")}` : unit === "day" ? `every day at ${hhmm}` : `every ${days.join(", ")} at ${hhmm}`);
        }
        if (o.enabled !== undefined) {
            ev.enabled = bool(o.enabled, false);
            done.push(ev.enabled ? "enabled" : "disabled");
        }
        if (o.timeZone !== undefined) {
            ev.timeZone = enumValue(se.TimeZoneEnum, o.timeZone, "timeZone");
            done.push(`time zone ${o.timeZone}`);
        }
        if (o.onOverlap !== undefined) {
            ev.onOverlap = enumValue(se.OverlapStrategy, o.onOverlap, "onOverlap");
            done.push(`on overlap ${o.onOverlap}`);
        }
        return `${o.event}: ${done.join(", ")}`;
    }

    // ------------------------------------------------ validation rules, event handlers, indexes

    function rulesOf(e, o, where) {
        const attr = e.attributes.find(a => a.name === o.attribute);
        if (!attr) fail(`${where}: ${o.entity} has no attribute '${o.attribute}'`, o.attribute, e.attributes.map(a => a.name));
        const all = e.validationRules.filter(r => r.attribute === attr || r.attributeQualifiedName === `${o.entity}.${o.attribute}`);
        if (!all.length) throw new Error(`${where}: ${o.entity}.${o.attribute} has no validation rule${e.validationRules.length ? ` (rules of ${o.entity}: ${[...new Set(e.validationRules.map(r => `${(r.attributeQualifiedName || "?").split(".").pop()} ${ruleName(kindOf(r.ruleInfo))}`))].join(", ")})` : ""}`);
        let hits = all;
        if (o.rule !== undefined) {
            const k = String(o.rule).toLowerCase();
            if (!RULES[k]) fail(`${where}: '${o.rule}' is not a rule (use ${RULE_NAMES.join(" | ")})`, o.rule, RULE_NAMES);
            hits = all.filter(r => kindOf(r.ruleInfo) === k);
            if (!hits.length) throw new Error(`${where}: ${o.entity}.${o.attribute} has no ${ruleName(k)} rule; its rules: ${all.map(r => ruleName(kindOf(r.ruleInfo))).join(", ")}`);
        }
        if (hits.length > 1) throw new Error(`${where}: ${o.entity}.${o.attribute} has ${hits.length} rules (${hits.map(r => ruleName(kindOf(r.ruleInfo))).join(", ")}); say which with "rule"`);
        return hits[0];
    }

    async function changeValidationRule(o) {
        const where = `changeValidationRule ${o.entity}.${o.attribute}`;
        const e = await ownEntity(o.entity);
        const r = rulesOf(e, o, where);
        const kind = kindOf(r.ruleInfo);
        const allowed = { maxlength: ["maxLength"], range: ["min", "max"], regex: ["regex"], equals: ["value"] }[kind] || [];
        const given = ["maxLength", "min", "max", "regex", "value"].filter(k => o[k] !== undefined);
        for (const k of given) if (!allowed.includes(k)) throw new Error(`${where}: '${k}' does not apply to a ${ruleName(kind)} rule${allowed.length ? ` (it takes ${allowed.join(", ")})` : ""}; to change the kind: deleteValidationRule, then addValidationRule`);
        if (o.message === undefined && !given.length && o.position === undefined) throw new Error(`${where}: give "message"${allowed.length ? `, ${allowed.join(", ")}` : ""} or "position"`);
        const info = r.ruleInfo;
        const done = [];
        if (o.message !== undefined) {
            await x.text(r.errorMessage, o.message);
            done.push("message");
        }
        if (kind === "maxlength" && o.maxLength !== undefined) {
            const n = Number(o.maxLength);
            if (!(Number.isInteger(n) && n > 0)) throw new Error(`${where}: maxLength must be a whole number > 0`);
            info.maxLength = n;
            done.push(`max length ${n}`);
        }
        if (kind === "range" && (o.min !== undefined || o.max !== undefined)) {
            const min = o.min !== undefined ? o.min : info.useMinValue ? info.minValue : null;
            const max = o.max !== undefined ? o.max : info.useMaxValue ? info.maxValue : null;
            if (min === null && max === null) throw new Error(`${where}: a range rule needs a minimum or a maximum`);
            for (const [k, v] of [["min", min], ["max", max]]) if (v !== null && !/^-?\d+(\.\d+)?$/.test(String(v))) throw new Error(`${where}: ${k} '${v}' is not a number`);
            info.useMinValue = min !== null;
            info.useMaxValue = max !== null;
            info.minValue = min !== null ? String(min) : "";
            info.maxValue = max !== null ? String(max) : "";
            info.typeOfRange = min !== null && max !== null ? dm.RangeType.Between : min !== null ? dm.RangeType.GreaterThanOrEqualTo : dm.RangeType.SmallerThanOrEqualTo;
            done.push(`range ${min !== null ? min : ""}..${max !== null ? max : ""}`);
        }
        if (kind === "regex" && o.regex !== undefined) {
            const re = await x.get(o.regex);
            if (!(re instanceof sdk.regularexpressions.RegularExpression)) throw new Error(`'${o.regex}' is not a regular expression document`);
            info.regularExpression = re;
            done.push(`regex ${o.regex}`);
        }
        if (kind === "equals" && o.value !== undefined) {
            info.useValue = true;
            info.equalsToValue = String(o.value);
            done.push(`equals ${o.value}`);
        }
        if (o.position !== undefined) {
            const label = y => `${(y.attributeQualifiedName || "?").split(".").pop()} ${ruleName(kindOf(y.ruleInfo))}`;
            done.push(reorder(e.validationRules, r, { position: o.position }, where, label) + ` (${[...e.validationRules].map(label).join(", ")})`);
        }
        return `${o.entity}.${o.attribute} ${ruleName(kind)}: ${done.join(", ")}`;
    }

    async function deleteValidationRule(o) {
        const e = await ownEntity(o.entity);
        const r = rulesOf(e, o, `deleteValidationRule ${o.entity}.${o.attribute}`);
        const kind = kindOf(r.ruleInfo);
        r.delete();
        return `${o.entity}.${o.attribute}: ${ruleName(kind)} rule deleted`;
    }

    const handlerText = h => `${h.moment.name} ${h.event.name} -> ${h.microflowQualifiedName || "?"}`;
    function handlersOf(e, o, where) {
        let hits = [...e.eventHandlers];
        if (!hits.length) throw new Error(`${where}: ${o.entity} has no event handlers`);
        const all = hits;
        if (o.moment !== undefined) {
            const m = enumValue(dm.ActionMoment, o.moment, "moment");
            hits = hits.filter(h => h.moment === m);
        }
        if (o.event !== undefined) {
            const ev = enumValue(dm.EventType, o.event, "event");
            hits = hits.filter(h => h.event === ev);
        }
        if (o.microflow !== undefined) {
            const names = all.map(h => h.microflowQualifiedName).filter(Boolean);
            if (!names.includes(o.microflow)) fail(`${where}: no event handler of ${o.entity} runs ${o.microflow}`, o.microflow, names);
            hits = hits.filter(h => h.microflowQualifiedName === o.microflow);
        }
        const list = all.map(handlerText).join("; ");
        if (!hits.length) throw new Error(`${where}: no event handler of ${o.entity} matches; its handlers: ${list}`);
        if (hits.length > 1) throw new Error(`${where}: ${hits.length} event handlers match (${hits.map(handlerText).join("; ")}); give moment, event and/or microflow`);
        return hits[0];
    }

    async function deleteEventHandler(o) {
        const e = await ownEntity(o.entity);
        const h = handlersOf(e, o, `deleteEventHandler ${o.entity}`);
        const t = handlerText(h);
        h.delete();
        return `${o.entity}: ${t} deleted (the microflow stays)`;
    }

    // handler: "Before Commit" or a number (1-based)
    function handlerBy(e, o, where) {
        const all = [...e.eventHandlers];
        if (!all.length) throw new Error(`${where}: ${o.entity} has no event handlers (add one with addEventHandler)`);
        const list = all.map((h, i) => `${i + 1}: ${handlerText(h)}`).join("; ");
        if (typeof o.handler === "number" || /^\d+$/.test(String(o.handler))) {
            const n = Number(o.handler);
            if (n < 1 || n > all.length) throw new Error(`${where}: ${o.entity} has ${all.length} event handler(s): ${list}`);
            return all[n - 1];
        }
        const m = /^\s*(\w+)\s+(\w+)\s*$/.exec(String(o.handler || ""));
        if (!m) throw new Error(`${where}: handler is "Before Commit" (moment and event) or a number; ${o.entity} has: ${list}`);
        const moment = enumValue(dm.ActionMoment, m[1], "moment");
        const event = enumValue(dm.EventType, m[2], "event");
        const hits = all.filter(h => h.moment === moment && h.event === event);
        if (!hits.length) throw new Error(`${where}: ${o.entity} has no ${moment.name} ${event.name} handler; its handlers: ${list}`);
        if (hits.length > 1) throw new Error(`${where}: ${hits.length} ${moment.name} ${event.name} handlers; give its number: ${list}`);
        return hits[0];
    }

    async function changeEventHandler(o) {
        const where = `changeEventHandler ${o.entity}`;
        const e = await ownEntity(o.entity);
        const h = handlerBy(e, o, where);
        const before = handlerText(h);
        const keys = ["moment", "event", "microflow", "passObject", "raiseErrorOnFalse"].filter(k => o[k] !== undefined);
        if (!keys.length) throw new Error(`${where}: give what changes: moment, event, microflow, passObject or raiseErrorOnFalse`);
        const moment = o.moment !== undefined ? enumValue(dm.ActionMoment, o.moment, "moment") : h.moment;
        const event = o.event !== undefined ? enumValue(dm.EventType, o.event, "event") : h.event;
        const pass = o.passObject !== undefined ? strict(o.passObject, "passObject", where) : h.passEventObject;
        let flow = h.microflow;
        if (o.microflow !== undefined) {
            flow = await x.get(o.microflow);
            if (!(flow instanceof mf.Microflow)) throw new Error(`${where}: '${o.microflow}' is not a microflow`);
        }
        if (!flow) throw new Error(`${where}: the handler's microflow ${h.microflowQualifiedName || ""} is missing; give "microflow"`);
        if (!flow.isLoaded) flow = await flow.load();
        const fq = flow.qualifiedName;
        const params = flow.objectCollection.objects.filter(y => y instanceof mf.MicroflowParameterObject);
        if (pass && params.length !== 1) throw new Error(`${where}: ${fq} must have exactly one parameter (the ${o.entity} object), it has ${params.length}; or set "passObject": false`);
        if (!pass && params.length) throw new Error(`${where}: ${fq} has parameters, but passObject is false`);
        if (moment === dm.ActionMoment.Before && !(flow.microflowReturnType instanceof sdk.datatypes.BooleanType)) throw new Error(`${where}: a Before handler microflow must return Boolean; ${fq} does not`);
        if (o.raiseErrorOnFalse !== undefined && moment !== dm.ActionMoment.Before) throw new Error(`${where}: raiseErrorOnFalse applies to Before handlers only (this one runs After)`);
        if (e.eventHandlers.some(y => y !== h && y.moment === moment && y.event === event && y.microflow === flow)) throw new Error(`${where}: ${o.entity} already has ${moment.name} ${event.name} -> ${fq}`);
        h.moment = moment;
        h.event = event;
        if (flow !== h.microflow) h.microflow = flow;
        h.passEventObject = pass;
        h.raiseErrorOnFalse = moment === dm.ActionMoment.Before ? (o.raiseErrorOnFalse !== undefined ? strict(o.raiseErrorOnFalse, "raiseErrorOnFalse", where) : h.raiseErrorOnFalse) : false;
        return `${o.entity}: ${before} -> ${handlerText(h)}${h.passEventObject ? "" : " (no object passed)"}${moment === dm.ActionMoment.Before ? `, raise an error on false: ${h.raiseErrorOnFalse}` : ""}`;
    }

    const attrsOf = (e, ix) => ix.attributes.map(a => (a.attribute ? a.attribute.name : (a.attributeQualifiedName || "?").split(".").pop()));
    function indexOf(e, o, where) {
        const all = [...e.indexes];
        const desc = all.map((ix, i) => `${i + 1}: (${attrsOf(e, ix).join(", ")})`).join("; ");
        if (!all.length) throw new Error(`${where}: ${o.entity} has no indexes`);
        if (typeof o.index === "number" || /^\d+$/.test(String(o.index))) {
            const n = Number(o.index);
            if (n < 1 || n > all.length) throw new Error(`${where}: ${o.entity} has ${all.length} index(es): ${desc}`);
            return all[n - 1];
        }
        const want = [].concat(o.index).map(a => (typeof a === "object" && a ? a.name : String(a)));
        const hits = all.filter(ix => attrsOf(e, ix).join() === want.join());
        if (!hits.length) throw new Error(`${where}: ${o.entity} has no index on (${want.join(", ")}); its indexes: ${desc}`);
        if (hits.length > 1) throw new Error(`${where}: ${hits.length} indexes on (${want.join(", ")}); give its number: ${desc}`);
        return hits[0];
    }

    async function changeIndex(o) {
        const where = `changeIndex ${o.entity}`;
        const e = await ownEntity(o.entity);
        const ix = indexOf(e, o, where);
        if (!Array.isArray(o.attributes) || !o.attributes.length) throw new Error(`${where}: attributes is a list [ "Attr" or { "name": "Attr", "ascending": false } ]`);
        const before = attrsOf(e, ix);
        const specs = o.attributes.map(spec => {
            const name = typeof spec === "string" ? spec : spec && spec.name;
            const attr = e.attributes.find(a => a.name === name);
            if (!attr) fail(`${where}: ${o.entity} has no attribute '${name}'`, name, e.attributes.map(a => a.name));
            return { attr, ascending: typeof spec === "object" ? bool(spec.ascending, true) : true };
        });
        if (new Set(specs.map(s => s.attr)).size !== specs.length) throw new Error(`${where}: an attribute is in the list twice`);
        // keep the stored IndexedAttribute elements where they fit (only their values change)
        const old = [...ix.attributes];
        for (const [i, s] of specs.entries()) {
            const ia = old[i] || dm.IndexedAttribute.createIn(ix);
            if (!old[i]) ia.type = dm.IndexedAttributeType.Normal;
            ia.attribute = s.attr;
            ia.ascending = s.ascending;
        }
        for (const extra of old.slice(specs.length)) extra.delete();
        return `${o.entity}: index (${before.join(", ")}) -> (${specs.map(s => s.attr.name + (s.ascending ? "" : " desc")).join(", ")})`;
    }

    async function deleteIndex(o) {
        const e = await ownEntity(o.entity);
        const ix = indexOf(e, o, `deleteIndex ${o.entity}`);
        const t = attrsOf(e, ix).join(", ");
        ix.delete();
        return `${o.entity}: index (${t}) deleted`;
    }

    // ------------------------------------------------ enumeration values

    async function valueOf(qn, where) {
        const parts = String(qn).split(".");
        if (parts.length !== 3) throw new Error(`${where}: write the value as Module.Enumeration.Value, got '${qn}'`);
        const en = await x.get(parts.slice(0, 2).join("."));
        if (!(en instanceof enumerations.Enumeration)) throw new Error(`${where}: '${parts.slice(0, 2).join(".")}' is not an enumeration`);
        const v = en.values.find(y => y.name === parts[2]);
        if (!v) fail(`${where}: ${en.qualifiedName} has no value '${parts[2]}'`, parts[2], en.values.map(y => y.name));
        return { en, v };
    }

    async function imageOf(qn, where) {
        const parts = String(qn).split(".");
        if (parts.length !== 3) throw new Error(`${where}: write the image as Module.ImageCollection.Image, got '${qn}'`);
        const colls = x.model.allImageCollections();
        const c = colls.find(y => y.qualifiedName === parts.slice(0, 2).join("."));
        if (!c) fail(`${where}: no image collection '${parts.slice(0, 2).join(".")}'`, parts.slice(0, 2).join("."), colls.map(y => y.qualifiedName));
        const full = c.isLoaded ? c : await c.load();
        const img = full.images.find(y => y.name === parts[2]);
        if (!img) fail(`${where}: ${c.qualifiedName} has no image '${parts[2]}' (add it with addImage)`, parts[2], full.images.map(y => y.name));
        return img;
    }

    // addEnumerationValue / changeEnumerationValue "image"
    async function setImage(v, qn, where) {
        if (qn === "" || qn === null) {
            v.image = null;
            return "no image";
        }
        v.image = await imageOf(qn, where);
        client.warnFirst(`Enumerations$EnumerationValue image first use (no Studio Pro sample has one): check ${v.containerAsEnumeration.qualifiedName} in Studio Pro`);
        return `image ${qn}`;
    }

    async function changeEnumerationValue(o) {
        const where = `changeEnumerationValue ${o.value}`;
        const { v } = await valueOf(o.value, where);
        if (o.caption === undefined && o.image === undefined) throw new Error(`${where}: give "caption" or "image"`);
        const done = [];
        if (o.caption !== undefined) {
            if (o.caption === "" || (typeof o.caption === "object" && (!o.caption || !Object.keys(o.caption).length))) throw new Error(`${where}: the caption is empty`);
            await x.text(v.caption, o.caption);
            done.push(`caption ${typeof o.caption === "object" ? Object.keys(o.caption).join(", ") : JSON.stringify(o.caption)}`);
        }
        if (o.image !== undefined) done.push(await setImage(v, o.image, where));
        return `${o.value}: ${done.join(", ")}`;
    }

    async function moveEnumerationValue(o) {
        const where = `moveEnumerationValue ${o.value}`;
        const { en, v } = await valueOf(o.value, where);
        const given = ["before", "after", "position"].filter(k => o[k] !== undefined);
        if (given.length !== 1) throw new Error(`${where}: give one of "before", "after" (a value name) or "position" (1 = first)`);
        const names = en.values.map(y => y.name);
        let index;
        if (o.position !== undefined) {
            const n = Number(o.position);
            if (!(Number.isInteger(n) && n >= 1 && n <= names.length)) throw new Error(`${where}: position is 1..${names.length}`);
            index = n - 1;
        } else {
            const other = String(o.before !== undefined ? o.before : o.after).split(".").pop();
            if (other === v.name) throw new Error(`${where}: a value cannot move ${given[0]} itself`);
            if (!names.includes(other)) fail(`${where}: ${en.qualifiedName} has no value '${other}'`, other, names);
            const rest = names.filter(n => n !== v.name);
            index = rest.indexOf(other) + (o.after !== undefined ? 1 : 0);
        }
        if (names.indexOf(v.name) === index) return `${o.value} stays at position ${index + 1}`;
        v.detach();
        en.values.splice(index, 0, v);
        return `${o.value} -> position ${index + 1} (${en.values.map(y => y.name).join(", ")})`;
    }

    // ------------------------------------------------ checks (after apply)

    const checks = {
        async changeConstant(o) {
            const c = await x.get(o.constant);
            const value = o.default !== undefined ? o.default : o.value;
            const r = [];
            if (value !== undefined && c.defaultValue !== String(value)) r.push(`${o.constant} default is ${c.defaultValue}`);
            if (o.exposedToClient !== undefined && c.exposedToClient !== bool(o.exposedToClient, false)) r.push(`${o.constant} exposedToClient is ${c.exposedToClient}`);
            if (o.type !== undefined && !c.type.structureTypeName.toLowerCase().includes(String(o.type).toLowerCase())) r.push(`${o.constant} type is ${c.type.structureTypeName}`);
            return r;
        },
        async changeScheduledEvent(o) {
            const ev = await x.get(o.event);
            const r = [];
            if (o.microflow !== undefined && ev.microflowQualifiedName !== o.microflow) r.push(`${o.event} runs ${ev.microflowQualifiedName}`);
            if (o.enabled !== undefined && ev.enabled !== bool(o.enabled, false)) r.push(`${o.event} enabled is ${ev.enabled}`);
            if (o.every !== undefined && !(ev.schedule && ev.schedule.structureTypeName.toLowerCase().includes(String(o.every).toLowerCase()))) r.push(`${o.event} schedule is ${ev.schedule ? ev.schedule.structureTypeName : "none"}`);
            return r;
        },
        async changeValidationRule(o) {
            const e = await ownEntity(o.entity);
            const r = rulesOf(e, o, "check");
            const out = [];
            if (o.maxLength !== undefined && r.ruleInfo.maxLength !== Number(o.maxLength)) out.push(`max length is ${r.ruleInfo.maxLength}`);
            if (o.min !== undefined && o.min !== null && r.ruleInfo.minValue !== String(o.min)) out.push(`minimum is ${r.ruleInfo.minValue}`);
            if (o.max !== undefined && o.max !== null && r.ruleInfo.maxValue !== String(o.max)) out.push(`maximum is ${r.ruleInfo.maxValue}`);
            if (o.position !== undefined && [...e.validationRules].indexOf(r) !== Number(o.position) - 1) out.push(`${o.entity}.${o.attribute} rule is at position ${[...e.validationRules].indexOf(r) + 1}`);
            return out;
        },
        async deleteValidationRule(o) {
            const e = await ownEntity(o.entity);
            const k = o.rule !== undefined ? String(o.rule).toLowerCase() : null;
            const left = e.validationRules.filter(r => r.attributeQualifiedName === `${o.entity}.${o.attribute}` && (!k || kindOf(r.ruleInfo) === k));
            return left.length ? [`${o.entity}.${o.attribute} still has ${left.length} such rule(s)`] : [];
        },
        async deleteEventHandler(o) {
            const e = await ownEntity(o.entity);
            const left = e.eventHandlers.filter(h => (o.moment === undefined || h.moment.name.toLowerCase() === String(o.moment).toLowerCase()) && (o.event === undefined || h.event.name.toLowerCase() === String(o.event).toLowerCase()) && (o.microflow === undefined || h.microflowQualifiedName === o.microflow));
            return left.length ? [`${o.entity} still has ${left.map(handlerText).join("; ")}`] : [];
        },
        async changeEventHandler(o) {
            const e = await ownEntity(o.entity);
            const ok = e.eventHandlers.some(h => (o.moment === undefined || h.moment.name.toLowerCase() === String(o.moment).toLowerCase()) && (o.event === undefined || h.event.name.toLowerCase() === String(o.event).toLowerCase()) && (o.microflow === undefined || h.microflowQualifiedName === o.microflow)
                && (o.passObject === undefined || h.passEventObject === bool(o.passObject, true)) && (o.raiseErrorOnFalse === undefined || h.raiseErrorOnFalse === bool(o.raiseErrorOnFalse, true)));
            return ok ? [] : [`${o.entity} has no handler ${[o.moment, o.event, o.microflow].filter(Boolean).join(" ")} as changed; its handlers: ${e.eventHandlers.map(handlerText).join("; ")}`];
        },
        async changeIndex(o) {
            const e = await ownEntity(o.entity);
            const want = o.attributes.map(a => (typeof a === "string" ? a : a.name)).join();
            return e.indexes.some(ix => attrsOf(e, ix).join() === want) ? [] : [`${o.entity} has no index on (${want})`];
        },
        async deleteIndex() {
            return []; // the index is found by what it was; nothing names it afterwards
        },
        async changeEnumerationValue(o) {
            const { v } = await valueOf(o.value, "check");
            const r = [];
            if (o.image !== undefined && (v.imageQualifiedName || "") !== (o.image || "")) r.push(`${o.value} image is ${v.imageQualifiedName || "none"}`);
            if (typeof o.caption === "string" && !v.caption.translations.some(t => t.text === o.caption)) r.push(`${o.value} caption is not ${o.caption}`);
            return r;
        },
        async moveEnumerationValue(o) {
            const { en, v } = await valueOf(o.value, "check");
            const names = en.values.map(y => y.name);
            const i = names.indexOf(v.name);
            if (o.position !== undefined) return i === Number(o.position) - 1 ? [] : [`${o.value} is at position ${i + 1}`];
            const other = names.indexOf(String(o.before !== undefined ? o.before : o.after).split(".").pop());
            return (o.before !== undefined ? i === other - 1 : i === other + 1) ? [] : [`${o.value} is at position ${i + 1} (${names.join(", ")})`];
        }
    };

    return { impl: { changeConstant, changeScheduledEvent, changeValidationRule, deleteValidationRule, deleteEventHandler, changeEventHandler, changeIndex, deleteIndex, moveEnumerationValue, changeEnumerationValue }, checks, setImage };
}

// checkPlan: a later op of the plan changes what this op made (only the final state is checked)
function smallChangedLater(name, o, rest) {
    const qn = o.module && o.name ? `${o.module}.${o.name}` : null;
    const later = (ops, f) => rest.some(x => ops.includes(x.op) && f(x));
    if (name === "createConstant" || name === "changeConstant") return later(["changeConstant"], x => x.constant === (qn && name === "createConstant" ? qn : o.constant));
    if (name === "createScheduledEvent" || name === "changeScheduledEvent") return later(["changeScheduledEvent"], x => x.event === (name === "createScheduledEvent" ? qn : o.event));
    if (["addValidationRule", "changeValidationRule"].includes(name)) return later(["changeValidationRule", "deleteValidationRule"], x => x.entity === o.entity && x.attribute === o.attribute);
    if (["addEventHandler", "changeEventHandler"].includes(name)) return later(["deleteEventHandler", "changeEventHandler"], x => x.entity === o.entity);
    if (["addIndex", "changeIndex"].includes(name)) return later(["changeIndex", "deleteIndex"], x => x.entity === o.entity);
    const enumQn = name === "createEnumeration" ? qn : name === "addEnumerationValue" ? o.enumeration : ["moveEnumerationValue", "changeEnumerationValue"].includes(name) ? String(o.value).split(".").slice(0, 2).join(".") : null;
    if (enumQn) return later(["moveEnumerationValue", "changeEnumerationValue"], x => String(x.value).startsWith(enumQn + "."));
    return false;
}

module.exports = { makeSmall, smallChangedLater, SMALL_OPS, SMALL_SYNONYMS };
