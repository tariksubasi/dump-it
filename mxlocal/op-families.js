"use strict";
// Op families: which area of the app an op changes (for eval coverage, eval/run.js --coverage, and selftest phase G).
// A family is named after the catalogue the op comes from; the ops ops.js defines itself are listed here by name.
// An op of a catalogue not listed below (a newer one) is family "other" until it is added.

const CATALOGUES = [
    ["./ops-domain", "DOMAIN_OPS", "domain"], ["./ops-entity", "ENTITY_OPS", "domain"], ["./ops-dmlayout", "DMLAYOUT_OPS", "domain"],
    ["./ops-security", "SECURITY_OPS", "security"], ["./ops-texts", "TEXT_OPS", "texts"],
    ["./ops-flow-edit", "FLOW_EDIT_OPS", "flows"], ["./ops-refs", "REF_OPS", "flows"], ["./ops-code", "CODE_OPS", "code"],
    ["./ops-page-edit", "PAGE_EDIT_OPS", "data widgets"], ["./ops-scaffold", "SCAFFOLD_OPS", "data widgets"], ["./widget-edit", "WIDGET_EDIT_OPS", "data widgets"],
    ["./ops-nav", "NAV_OPS", "navigation"], ["./theme", "THEME_OPS", "design system"], ["./marketplace", "MARKET_OPS", "marketplace"],
    ["./ops-mappings", "MAPPING_OPS", "mapping"], ["./ops-xml", "XML_OPS", "mapping"], ["./ops-rest", "REST_OPS", "rest"], ["./ops-odata", "ODATA_OPS", "odata"],
    ["./ops-workflows", "WORKFLOW_OPS", "workflows"], ["./ops-small", "SMALL_OPS", "small changes"], ["./ops-offline", "OFFLINE_OPS", "native"],
    ["./ops-copy", "COPY_OPS", "refactor"], ["./ops-general", "GENERAL_OPS", "refactor"], ["./ops-docs", "DOCS_OPS", "app"], ["./ops-services", "SERVICE_OPS", "services"]
];

const CORE = {
    createEntity: "domain", addAttribute: "domain", changeAttribute: "domain", addAssociation: "domain", createEnumeration: "domain", addEnumerationValue: "domain",
    setGeneralization: "domain", addValidationRule: "domain", addEventHandler: "domain", addIndex: "domain",
    createModule: "security", createModuleRole: "security", grantAccess: "security", addAccessRule: "security",
    createMicroflow: "flows", createNanoflow: "flows", addActions: "flows", changeAction: "flows", deleteAction: "flows",
    createConstant: "app", createScheduledEvent: "app", createLayout: "data widgets", createPage: "data widgets",
    addMenuItem: "navigation", setHomePage: "navigation", moveDocument: "refactor", rename: "refactor", delete: "refactor"
};

// Ops that test a family the catalogue does not show (error handling lives in flows and workflows).
const ALSO = { createUnitTest: "tests", changeWorkflow: "error handling", setOfflineSync: "native" };

let table = null;
function families() {
    if (table) return table;
    table = new Map(Object.entries(CORE));
    for (const [mod, name, family] of CATALOGUES) {
        let cat = {};
        try {
            cat = require(mod)[name] || {};
        } catch {
            cat = {};
        }
        for (const op of Object.keys(cat)) if (!table.has(op)) table.set(op, family);
    }
    return table;
}

// The family of an op ("other" for an op of a catalogue not listed here).
const familyOf = op => families().get(op) || "other";
// Every family an op counts for (its own, and e.g. "error handling" for changeWorkflow).
const familiesOf = op => [familyOf(op), ...(ALSO[op] ? [ALSO[op]] : [])];

module.exports = { familyOf, familiesOf, families };
