"use strict";
// Self test phase for the XPath and expression checks (xpath.js, expr.js, exprlint.js):
//  (a) every expression and XPath constraint Studio Pro stored in the project parses and checks without errors;
//  (b) deliberately wrong expressions and XPath in a change file are each caught with the expected message, the
//      dry run refuses them, and correct ones give no finding.
// Runs a dry run on the selftest's copy (nothing is written).
const { lintProject } = require("./exprlint");

// [flow, what is wrong, expected level, message pattern]; the flows are made by plan() below
function cases(mod, P, pageable) {
    const O = `${mod}.${P}Order`, C = `${mod}.${P}Customer`, A = `${mod}.${P}Order_${P}Customer`, EN = `${mod}.${P}Status`, SP = `${mod}.${P}Special`;
    const page = `${mod}.${P}Cust_Edit`;
    return {
        O, C, A, EN, SP, page, pageable,
        bad: [
            // XPath
            [{ action: "retrieve", variable: "L", entity: O, xpath: `[${A}x/${C}/Name = 'x']` }, "error", /has no association '.*Customerx'\. Did you mean: .*Order_.*Customer\?/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: "[Totl > 5]" }, "error", /has no attribute 'Totl'\. Did you mean: Total\?/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: "[Status = 'Opne']" }, "error", /'Opne' is not a value of .*Did you mean: 'Open'\?/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: `[${A}/Name = 'x']` }, "error", /after the association .* comes the entity/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: `[${A}/${O}/Name = 'x']` }, "error", /leads to .*Customer, not .*Order/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: "[contans(Note, 'a')]" }, "error", /unknown XPath function contans.*Did you mean: contains/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: "[Total > 5" }, "error", /syntax: expected '\]'/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: "[Paid = 'yes']" }, "error", /compares Boolean with String: use true\(\) or false\(\)/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: "[Created < '[%CurrentDateTim%]']" }, "error", /unknown token \[%CurrentDateTim%\]\. Did you mean: \[%CurrentDateTime%\]/],
            [{ action: "retrieve", variable: "L", entity: O, xpath: "[Total = $Totl]" }, "error", /\$Totl is not a parameter or variable here/],
            // expressions
            [{ action: "change", variable: "Order", set: { Note: `$Order/${A}/${C}/Nme` } }, "error", /has no attribute 'Nme'\. Did you mean: Name\?/],
            [{ action: "log", message: "total {1}", args: ["toString($Order/Totl)"] }, "error", /has no attribute 'Totl'\. Did you mean: Total\?/],
            [{ action: "change", variable: "Order", set: { Note: "toStrin($Order/Total)" } }, "error", /unknown function toStrin\(\.\.\.\)\. Did you mean: toString/],
            [{ action: "change", variable: "Order", set: { Total: "'abc'" } }, "error", /gives String, but Decimal is expected/],
            [{ action: "change", variable: "Order", set: { Count: "$Order/Total * 2" } }, "error", /gives Decimal, but Integer is expected \(use round/],
            [{ action: "change", variable: "Order", set: { Status: "'Open'" } }, "error", /gives String, but enumeration .* is expected/],
            [{ action: "change", variable: "Order", set: { Status: `${EN}.Opn` } }, "error", /has no value 'Opn'\. Did you mean: .*\.Open\?/],
            [{ action: "change", variable: "Order", set: { Note: `@${mod}.${P}NoSuchConstant` } }, "error", /unknown constant @/],
            [{ action: "change", variable: "Order", set: { Note: "$Ordr/Note" } }, "error", /\$Ordr is not a parameter or variable here\. Did you mean: \$Order\?/],
            [{ action: "change", variable: "Order", set: { Note: "length($Order/Note" } }, "error", /syntax: expected '\)'/],
            [{ action: "if", condition: "$Order/Total", then: [{ action: "log", message: "x" }] }, "error", /gives Decimal, but Boolean is expected/],
            [{ action: "if", condition: "$Order/Paid and $Order/Note", then: [{ action: "log", message: "x" }] }, "error", /'and' needs Boolean operands, got String/],
            [{ action: "call", microflow: `${mod}.${P}Sub`, args: { Customer: "$Order" } }, "error", /gives .*Order, but .*Customer is expected/],
            [{ action: "variable", name: "N", type: "Integer", value: "'1'" }, "error", /gives String, but Integer is expected \(use parseInteger/],
            [{ action: "change", variable: "Order", set: { Note: "someNewFunction($Order/Note)" } }, "warning", /unknown function someNewFunction.*fine if your Mendix version has it/],
            // arguments: parameter entity types with generalization, lists, pages
            [{ action: "call", microflow: `${mod}.${P}SubSpecial`, args: { Special: "$Cust" } }, "error", /gives .*Customer, but .*Special is expected \(cast it first\)/],
            [{ action: "call", microflow: `${mod}.${P}SubList`, args: { Customers: "$Cust" } }, "error", /gives .*Customer, but List of .*Customer is expected/],
            [{ action: "call", microflow: `${mod}.${P}SubList`, args: { Customers: "$Order/Total" } }, "error", /gives Decimal, but List of .*Customer is expected/],
            ...(pageable ? [[{ action: "showPage", page, args: { [`${P}Customer`]: "$Order" } }, "error", /gives .*Order, but .*Customer is expected/]] : [])
        ],
        good: [
            { action: "retrieve", variable: "G1", entity: O, xpath: `[${A}/${C}/Name = $Order/Note and Total > 5 and not(contains(Note, 'x'))]` },
            { action: "retrieve", variable: "G2", entity: O, xpath: `[${A} = $Cust][Status = 'Open' or Paid = true()][Created < '[%BeginOfCurrentDay%]'][year-from-dateTime(Created) = 2024]` },
            { action: "retrieve", variable: "G3", entity: C, xpath: `[${A}/${O}/Total >= 10][id != $Cust]` },
            { action: "variable", name: "Txt", type: "String", value: `if $Order/Total > 10 then 'big: ' + toString($Order/Total) else 'small'` },
            { action: "variable", name: "Cnt", type: "Integer", value: "round($Order/Total) + length($Order/Note) + $Order/Count" },
            { action: "variable", name: "When", type: "DateTime", value: "addDays([%BeginOfCurrentDay%], 1)" },
            { action: "change", variable: "Order", set: { Note: `getCaption($Order/Status) + ' ' + $Order/${A}/${C}/Name + formatDecimal($Order/Total, '#.00')`, Status: `${EN}.Done`, Total: "$Order/Count * 1.5", [A]: "$Cust" } },
            { action: "if", condition: `$Order/Paid and $Order/Status != ${EN}.Open and $Order/${A} != empty`, then: [{ action: "log", message: "ok {1}", args: ["$Order/Note"] }] },
            { action: "call", microflow: `${mod}.${P}Sub`, args: { Customer: "$Cust" } },
            { action: "retrieve", variable: "Sp", entity: SP, first: true },
            { action: "call", microflow: `${mod}.${P}Sub`, args: { Customer: "$Sp" } },
            { action: "retrieve", variable: "Cs", entity: C },
            { action: "call", microflow: `${mod}.${P}SubList`, args: { Customers: "$Cs" } },
            { action: "variable", name: "Lvl", type: "String", value: `$Sp/Level + ' ' + $Sp/Name` },
            ...(pageable ? [{ action: "showPage", page, args: { [`${P}Customer`]: "$Sp" } }] : [])
        ]
    };
}

function plan(mod, P, c) {
    const ops = [
        { op: "createEnumeration", module: mod, name: `${P}Status`, values: ["Open", "Done"] },
        { op: "createEntity", module: mod, name: `${P}Customer`, attributes: [{ name: "Name", type: "String(200)" }] },
        { op: "createEntity", module: mod, name: `${P}Order`, attributes: [{ name: "Total", type: "Decimal" }, { name: "Note", type: "String(200)" }, { name: "Count", type: "Integer" },
            { name: "Paid", type: "Boolean" }, { name: "Created", type: "DateTime" }, { name: "Status", type: `Enum(${c.EN})` }] },
        { op: "addAssociation", from: c.O, to: c.C },
        { op: "createEntity", module: mod, name: `${P}Special`, attributes: [{ name: "Level", type: "String(20)" }] },
        { op: "setGeneralization", entity: c.SP, generalization: c.C },
        { op: "createMicroflow", module: mod, name: `${P}Sub`, parameters: [{ name: "Customer", type: c.C }], actions: [{ action: "log", message: "sub" }] },
        { op: "createMicroflow", module: mod, name: `${P}SubSpecial`, parameters: [{ name: "Special", type: c.SP }], actions: [{ action: "log", message: "sub" }] },
        { op: "createMicroflow", module: mod, name: `${P}SubList`, parameters: [{ name: "Customers", type: `List(${c.C})` }], actions: [{ action: "log", message: "sub" }] },
    ];
    if (c.pageable) ops.push({ op: "createPage", module: mod, name: `${P}Cust_Edit`, entity: c.C });
    const params = [{ name: "Order", type: c.O }, { name: "Cust", type: c.C }];
    c.bad.forEach(([action], i) => ops.push({ op: "createMicroflow", module: mod, name: `${P}Bad${i + 1}`, parameters: params, actions: [action] }));
    ops.push({ op: "createMicroflow", module: mod, name: `${P}Good`, parameters: params, actions: c.good });
    return { ops };
}

async function phase({ src, copy, reopen, check, mod, pageable }) {
    // (a) the project as Studio Pro saved it
    const t0 = Date.now();
    const all = lintProject(src);
    const ms = Date.now() - t0;
    const errs = all.findings.filter(f => f.level === "error");
    const warns = all.findings.filter(f => f.level !== "error");
    const show = f => `${f.where}: ${f.msg} (in: ${String(f.src).replace(/\s+/g, " ").slice(0, 80)})`;
    check(`XPath + expression check on the project as Studio Pro saved it: ${all.counts.expressions} expressions, ${all.counts.xpaths} XPath constraints, no errors`,
        !errs.length, errs.length ? errs.slice(0, 5).map(show).join("; ") : `${warns.length} warning(s)${warns.length ? ": " + warns.slice(0, 3).map(show).join("; ") : ""}, ${ms} ms`);

    // (b) wrong inputs in a change file
    const P = "ZzP";
    const c = cases(mod, P, pageable);
    const s = await reopen(copy);
    const lint = await s.ops.runPlan(plan(mod, P, c), () => {});
    const found = lint.findings || [];
    const missed = [];
    c.bad.forEach(([, level, re], i) => {
        const mine = found.filter(f => f.where.startsWith(`${mod}.${P}Bad${i + 1} `));
        if (!mine.some(f => f.level === level && re.test(f.msg))) missed.push(`${P}Bad${i + 1} expected ${level} ${re} got ${mine.map(f => `${f.level}: ${f.msg}`).join(" | ") || "nothing"}`);
        else if (mine.some(f => f.level === "error" && level !== "error")) missed.push(`${P}Bad${i + 1} also gave an error: ${mine.map(f => f.msg).join(" | ")}`);
    });
    const goodFindings = found.filter(f => [`${P}Good `, `${P}Sub `, `${P}SubList `, `${P}SubSpecial `, `${P}Cust_Edit `].some(n => f.where.startsWith(`${mod}.${n}`)));
    const refusedCount = lint.length; // error lines: the dry run refuses with these
    const expectedErrors = c.bad.filter(x => x[1] === "error").length;
    check(`XPath + expression check catches ${c.bad.length} wrong inputs (did-you-mean, types, syntax) and passes ${c.good.length} correct steps (lint ${lint.ms} ms)`,
        !missed.length && !goodFindings.length && refusedCount >= expectedErrors,
        [...missed.slice(0, 4), ...goodFindings.slice(0, 3).map(f => `false finding: ${show(f)}`), refusedCount < expectedErrors ? `${refusedCount} error lines, expected ${expectedErrors}` : ""].filter(Boolean).join("; "));
}

module.exports = { phase, cases, plan };
