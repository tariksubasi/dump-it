"use strict";
// COVERAGE TEST: every document type (subclass of projects.ModuleDocument) and every microflow action (subclass of
// microflows.MicroflowAction) of the Model SDK is either made / changed by an op or action of the catalogue
// (COVERED_*, checked against OPS and ACTIONS, so an entry cannot name an op that does not exist), or listed in
// NOT_SUPPORTED_* with the reason and the Studio Pro way. A new SDK version with a new type, or an op that is renamed,
// fails the check until the type is placed in one of the two maps. Abstract types (no createIn) are skipped.
// Run by doccheck (CI docs stage) and the selftest (phase C).
const sdk = require("mendixmodelsdk");

// SDK document type -> the ops that create (first) or change it
const COVERED_DOCUMENTS = {
    "constants.Constant": ["createConstant", "changeConstant", "moveConstant"],
    "domainmodels.DomainModel": ["createModule", "createEntity", "addAssociation"],
    "domainmodels.ViewEntitySourceDocument": ["createViewEntity", "changeViewEntity"],
    "enumerations.Enumeration": ["createEnumeration", "addEnumerationValue"],
    "exportmappings.ExportMapping": ["createExportMapping", "createXmlExportMapping"],
    "images.ImageCollection": ["createImageCollection", "addImage"],
    "importmappings.ImportMapping": ["createImportMapping", "createXmlImportMapping"],
    "javaactions.JavaAction": ["createJavaAction", "setJavaActionCode", "changeJavaAction"],
    "javascriptactions.JavaScriptAction": ["createJavaScriptAction", "changeJavaScriptAction"],
    "jsonstructures.JsonStructure": ["createJsonStructure"],
    "menus.MenuDocument": ["createMenu", "addMenuItem"],
    "messagedefinitions.MessageDefinitionCollection": ["createMessageDefinition"],
    "microflows.Microflow": ["createMicroflow", "changeMicroflow"],
    "microflows.Nanoflow": ["createNanoflow", "changeMicroflow"],
    "microflows.Rule": ["createRule"],
    "odatapublish.PublishedODataService2": ["publishOData"],
    "pages.BuildingBlock": ["createBuildingBlock", "changeBuildingBlock"],
    "pages.Layout": ["createLayout"],
    "pages.Page": ["createPage", "changePage", "addWidgets"],
    "pages.PageTemplate": ["createPageTemplate"],
    "pages.Snippet": ["createSnippet"],
    "projects.ModuleSettings": ["createModule", "setModuleSettings"],
    "rest.ConsumedRestService": ["createConsumedRestService", "addRestOperation"],
    "rest.PublishedRestService": ["publishRest"],
    "scheduledevents.ScheduledEvent": ["createScheduledEvent", "changeScheduledEvent"],
    "security.ModuleSecurity": ["createModule", "createModuleRole"],
    "workflows.Workflow": ["createWorkflow", "changeWorkflow"],
    "regularexpressions.RegularExpression": ["createRegularExpression"],
    "queues.Queue": ["createTaskQueue"],
    "customicons.CustomIconCollection": ["importIconCollection"],
    "datasets.DataSet": ["createDataSet"],
    "businessevents.BusinessEventService": ["createBusinessEventService"],
    "webservices.PublishedWebService": ["publishWebService"],
    "xmlschemas.XmlSchema": ["createXmlSchema"]
};

// SDK document type -> { reason, studioPro }
const NOT_SUPPORTED_DOCUMENTS = {
    "appservices.ConsumedAppService": { reason: "app services were removed in Mendix 8", studioPro: "use a consumed REST or OData service (Add other > Consumed REST service)" },
    "authentication.Authentication": { reason: "no Studio Pro sample in the test projects; its storage is not verified", studioPro: "App > Security > Authentication" },
    "businessevents.ConsumedBusinessEventService": { reason: "Studio Pro imports the AsyncAPI contract", studioPro: "right-click the module > Add other > Business event service > import the contract" },
    "businessevents.PublishedBusinessEventService": { reason: "Studio Pro generates the AsyncAPI contract", studioPro: "right-click the module > Add other > Business event service" },
    "changedatacapture.EntityChangeDataCaptureService": { reason: "Mendix 11 only, no sample to verify its storage", studioPro: "right-click the module > Add other > Change data capture service" },
    "connectorkit.Connector": { reason: "made by Studio Pro extensions (Connector Kit), not by apps", studioPro: "install the connector from the Marketplace" },
    "connectorkit.ConnectorType": { reason: "made by Studio Pro extensions (Connector Kit), not by apps", studioPro: "install the connector from the Marketplace" },
    "customblobdocuments.CustomBlobDocument": { reason: "the contents belong to a Studio Pro extension", studioPro: "use the extension that owns the document" },
    "datatransformers.DataTransformer": { reason: "Mendix 11 only, no sample to verify its storage", studioPro: "right-click the module > Add other > Data transformer" },
    "databaseconnector.DatabaseConnection": { reason: "needs the Database Connector module and a live database to read the schema", studioPro: "install Database Connector, then Add other > Database connection" },
    "documenttemplates.DocumentTemplate": { reason: "no Studio Pro sample in the test projects; its widget tree is not verified", studioPro: "right-click the module > Add other > Document template" },
    "exceldataimporter.Template": { reason: "needs the Excel importer module (Mendix 10.x) and a sample sheet", studioPro: "install Excel Importer, then Add other > Excel importer template" },
    "kafka.ConsumedKafkaService": { reason: "Kafka services are deprecated (Mendix 10)", studioPro: "use business events or a Kafka connector from the Marketplace" },
    "kafka.PublishedKafkaService": { reason: "Kafka services are deprecated (Mendix 10)", studioPro: "use business events or a Kafka connector from the Marketplace" },
    "mlmappings.MLMappingDocument": { reason: "needs the ONNX model file Studio Pro reads", studioPro: "right-click the module > Add other > ML model mapping, import the .onnx file" },
    "messagedefinitions.MessageDefinition2": { reason: "an older storage of message definitions; ops write MessageDefinitionCollection", studioPro: "Add other > Message definitions" },
    "nativepages.NativeLayout": { reason: "the old native layout type (Mendix 8); native layouts are pages.Layout now", studioPro: "copy a native layout of Atlas (createLayout from works on them)" },
    "nativepages.NativePage": { reason: "the old native page type (Mendix 8); native pages are pages.Page on a native layout (createPage)", studioPro: "Add page > native" },
    "rest.ConsumedODataService": { reason: "Studio Pro reads the $metadata and keeps the external entities in step (consumeODataService explains it)", studioPro: "right-click the module > Add other > Consumed OData service" },
    "rest.PublishedODataService": { reason: "an older storage of published OData; ops write odatapublish.PublishedODataService2 (publishOData)", studioPro: "right-click the module > Add other > Published OData service" },
    "webservices.ImportedWebService": { reason: "Studio Pro imports the WSDL and its schemas (consumeWebService explains it)", studioPro: "right-click the module > Add other > Consumed web service" },
    "webservices.PublishedAppService": { reason: "app services were removed in Mendix 8", studioPro: "publish a REST or OData service" }
};

// SDK action type -> the ACTIONS key of the microflow/nanoflow action that writes it
const COVERED_ACTIONS = {
    AggregateListAction: "aggregateList", ApplyJumpToOptionAction: "applyJumpTo", CastAction: "cast", ChangeListAction: "changeList",
    ChangeObjectAction: "change", ChangeVariableAction: "set", CloseFormAction: "closePage", CommitAction: "commit", CounterMeterAction: "metric",
    CreateListAction: "createList", CreateObjectAction: "create", CreateVariableAction: "variable", DeleteAction: "delete", DownloadFileAction: "downloadFile",
    ExportXmlAction: "exportWithMapping", GaugeMeterAction: "metric", GenerateDocumentAction: "generateDocument", GenerateJumpToOptionsAction: "generateJumpToOptions",
    GetWorkflowActivityRecordsAction: "retrieveActivityRecords", GetWorkflowDataAction: "retrieveWorkflowContext", GetWorkflowsAction: "retrieveWorkflows",
    ImportXmlAction: "importWithMapping", IncrementCounterMeterAction: "metric", JavaActionCallAction: "callJava", JavaScriptActionCallAction: "callJavaScript",
    ListOperationAction: "listOperation", LockWorkflowAction: "lockWorkflow", LogMessageAction: "log", MicroflowCallAction: "call", NanoflowCallAction: "call",
    NotifyWorkflowAction: "notifyWorkflow", OpenUserTaskAction: "openUserTask", OpenWorkflowAction: "openWorkflow", RestCallAction: "callRest",
    RestOperationCallAction: "sendRestRequest", RetrieveAction: "retrieve", RollbackAction: "rollback", SetTaskOutcomeAction: "completeUserTask",
    ShowHomePageAction: "showHomePage", ShowMessageAction: "message", ShowPageAction: "showPage", SynchronizeAction: "synchronize",
    ValidationFeedbackAction: "validationFeedback", CancelSynchronizationAction: "cancelSynchronization", ClearFromClientAction: "clearFromDevice", DeleteExternalObject: "deleteExternalObject", SendExternalObject: "sendExternalObject", CallExternalAction: "callExternalAction", WebServiceCallAction: "callWebService", SendEmailAction: "sendEmail", UnlockWorkflowAction: "unlockWorkflow", WorkflowCallAction: "callWorkflow", WorkflowOperationAction: "changeWorkflowState"
};

const NOT_SUPPORTED_ACTIONS = {
    AppServiceCallAction: { reason: "app services were removed in Mendix 8", studioPro: "call a REST or OData service instead" },
    ConnectorActionCallAction: { reason: "made by Studio Pro extensions (Connector Kit)", studioPro: "the connector's own toolbox action" },
    ExecuteDatabaseQueryAction: { reason: "needs the Database Connector module and a database connection document", studioPro: "Toolbox > Execute database query" },
    ImportExcelDataAction: { reason: "needs the Excel importer module and a template", studioPro: "Toolbox > Import data from Excel" },
    MLModelCallAction: { reason: "needs an ML model mapping (an imported .onnx file)", studioPro: "Toolbox > Call ML model" },
    PushToClientAction: { reason: "not written by ops yet", studioPro: "Toolbox > Push to client" },
    TransformJsonAction: { reason: "needs a data transformer (Mendix 11), not written by ops", studioPro: "Toolbox > Transform JSON" },
};

// concrete SDK subclasses of base: [ "ns.Name" ]
function subclasses(base, withNs = true) {
    const out = [];
    for (const [ns, m] of Object.entries(sdk)) {
        if (!m || typeof m !== "object") continue;
        for (const [n, c] of Object.entries(m)) {
            if (typeof c !== "function" || !c.prototype || !(c.prototype instanceof base) || typeof c.createIn !== "function") continue;
            out.push(withNs ? `${ns}.${n}` : n);
        }
    }
    return [...new Set(out)].sort();
}

// problems: [ text ]; empty when every type is placed and every covering op exists
function coverage() {
    const { OPS, ACTIONS } = require("./ops");
    const problems = [];
    const docs = subclasses(sdk.projects.ModuleDocument);
    const acts = subclasses(sdk.microflows.MicroflowAction, false);
    for (const t of docs) {
        const c = COVERED_DOCUMENTS[t];
        const n = NOT_SUPPORTED_DOCUMENTS[t];
        if (c && n) problems.push(`COVERAGE: ${t} is both covered and in NOT_SUPPORTED_DOCUMENTS: remove one (coverage.js)`);
        else if (!c && !n) problems.push(`COVERAGE: SDK document type ${t} has no op and is not in NOT_SUPPORTED_DOCUMENTS (with a reason and the Studio Pro way) in coverage.js`);
        if (c) for (const op of c) if (!OPS[op]) problems.push(`COVERAGE: ${t} names op '${op}', which is not in the catalogue`);
        if (n && (!n.reason || !n.studioPro)) problems.push(`COVERAGE: ${t} in NOT_SUPPORTED_DOCUMENTS needs reason and studioPro`);
    }
    for (const t of acts) {
        const c = COVERED_ACTIONS[t];
        const n = NOT_SUPPORTED_ACTIONS[t];
        if (c && n) problems.push(`COVERAGE: ${t} is both covered and in NOT_SUPPORTED_ACTIONS: remove one (coverage.js)`);
        else if (!c && !n) problems.push(`COVERAGE: SDK microflow action ${t} has no action and is not in NOT_SUPPORTED_ACTIONS (with a reason and the Studio Pro way) in coverage.js`);
        if (c && !ACTIONS[c]) problems.push(`COVERAGE: ${t} names action '${c}', which is not in ACTIONS`);
        if (n && (!n.reason || !n.studioPro)) problems.push(`COVERAGE: ${t} in NOT_SUPPORTED_ACTIONS needs reason and studioPro`);
    }
    // entries for types the SDK does not have (renamed or a typo)
    for (const t of Object.keys({ ...COVERED_DOCUMENTS, ...NOT_SUPPORTED_DOCUMENTS })) if (!docs.includes(t)) problems.push(`COVERAGE: coverage.js lists ${t}, which is not a document type of this SDK`);
    for (const t of Object.keys({ ...COVERED_ACTIONS, ...NOT_SUPPORTED_ACTIONS })) if (!acts.includes(t)) problems.push(`COVERAGE: coverage.js lists ${t}, which is not a microflow action of this SDK`);
    return { problems, documents: docs.length, actions: acts.length, coveredDocuments: docs.filter(t => COVERED_DOCUMENTS[t]).length, coveredActions: acts.filter(t => COVERED_ACTIONS[t]).length };
}

module.exports = { coverage, subclasses, COVERED_DOCUMENTS, NOT_SUPPORTED_DOCUMENTS, COVERED_ACTIONS, NOT_SUPPORTED_ACTIONS };
