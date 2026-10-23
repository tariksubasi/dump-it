"use strict";
// Pages: create a page with a data view form for an entity (inputs per attribute type, Save/Cancel), an empty page, or a
// page from a widget list (layout grids, containers, texts, data views, data grids, list views, buttons, inputs), plus
// menu items and home pages. The layout and its placeholder are learned from the project's own pages; widget names,
// defaults and storage follow what Studio Pro writes (checked against Studio Pro-saved pages of Mendix 10.22-11.13).
// Pluggable widgets (Data grid 2, gallery, combo box, any other) are built from widgets/*.mpk with Studio Pro's defaults (see pluggable.js).
const sdk = require("mendixmodelsdk");
const { fail, suggest, bool, setIfAvailable, enumValue, validName } = require("./ops-util");
const { toSdk } = require("./convert");
const pluggable = require("./pluggable");
const design = require("./design");
const ui = require("./ui");
const { userRoleNamed } = require("./ops-security");
const gridExtras = require("./grid-extras");

const { pages, domainmodels: dm, datatypes, menus, navigation, microflows: mf, customwidgets: cw, enumerations } = sdk;

const PARAMS = "optional { \"<Parameter>\": \"$currentObject\" | \"$<dataView>\" (one around it, or one that listens) | \"$<grid>.selection\" (a List parameter gets a Multi selection) | \"$<PageParameter>\" | an expression for other parameters } (default: the objects around it, as Studio Pro passes them)";
const ACTION = "{ \"action\": ..., ... } as on actionButton (showPage, callMicroflow, callNanoflow, create, openLink, save, cancel, close, delete, signOut, sync, callWorkflow; with confirm, progress, pageTitle, ...)";
const ASSOC_ONE = "with source association: Module.Assoc (or a path A/B) from the object around it to one object: a reference it owns (Order_Customer in a data view of Order)";
const HEADER_FILTERS = "optional, Data grid 2 / gallery: filters above it (its header) [ { \"filter\": \"text\", \"attributes\": [\"Name\", \"Email\"], \"placeholder\": \"Search\" } (one search box over several attributes; also number / date) | { \"filter\": \"dropdown\", \"attribute\": \"Status\" } | { \"filter\": \"association\", \"association\": \"Module.Order_Customer\", \"caption\": \"Name\", \"multiSelect\": true, \"options\": \"[XPath]\" } ]; a filter is linked to the grid or gallery it sits in, so a filter elsewhere on the page cannot filter it";
// source fields of the list kinds (dataGrid, listView, gallery)
const LIST_SOURCE = {
    source: "optional database | association | microflow | nanoflow (default database; association / microflow / nanoflow when that field is given)",
    association: "with source association: Module.Assoc from the object around it (data view, list view or gallery item) to many objects: a reference set it owns, or the reference another entity has to it (OrderLine_Order in a data view of Order); also a path A/B whose steps go to one object and the last to many (OrderLine_Order/Order_Customer... e.g. \"Sales.Order_Customer/Sales.Address_Customer\": the addresses of the order's customer), and the reverse of a reference set the other side owns",
    microflow: "with source microflow: Module.Microflow that returns a list (of entity)",
    nanoflow: "with source nanoflow: Module.Nanoflow that returns a list",
    params: "with source microflow / nanoflow: its parameters, " + PARAMS.slice(9)
};
const ON_CHANGE = "optional on change " + ACTION + " (the object around it is passed)";
// attribute paths over references to one object: everywhere an attribute is taken
const PATH = "Attribute, or a path over references to one object: \"Order_Customer/Name\" (also Module.Assoc, the entity name \"Customer/Name\", or several steps \"Order_Customer/Customer_Country/Name\"); a step to many objects is refused (use a list widget over the association)";
// validation, format, look of inputs (text box, text area, date picker, drop-down, radio buttons; selectors: required, readOnlyStyle)
const INPUT_MORE = {
    required: "optional true: a value is required (Studio Pro validation Required, $value != empty)",
    requiredMessage: "optional with required: the message (default \"<Label> is required.\")",
    validation: "optional custom validation { \"expression\": \"$value > 0\", \"message\": \"Must be positive\" } ($value = the input's value; texts per language allowed)",
    format: "optional numbers: { \"decimals\": 2 (Decimal), \"groupDigits\": true }; dates: { \"date\": \"date\" | \"time\" | \"dateTime\" | a pattern \"dd-MM-yyyy HH:mm\" }",
    readOnlyStyle: "optional inherit | control | text: how it shows when read-only (default inherit: the data view's)",
    placeholder: "optional placeholder text (text box, text area, date picker)",
    inputMask: "optional text box of a String: a mask, e.g. \"99-99-9999\"",
    maxLength: "optional text box / text area of a String: \"attribute\" (default) | \"unlimited\" | a number of characters",
    onEnter: "optional when it gets the focus: " + ACTION, onLeave: "optional when it loses the focus: " + ACTION, onEnterKeyPress: "optional text box: on the Enter key: " + ACTION
};
const EDITABLE = "optional true | false | an expression \"$currentObject/Open\" | { \"attribute\": \"Status\", \"values\": [\"Open\"] } (editable only then)";
// Widget kinds of createPage "widgets" (also the help text). Every widget also takes "name" and COMMON_FIELDS.
const WIDGETS = {
    layoutGrid: {
        doc: "rows of columns; weights 1-12 per row",
        fields: { rows: "[ { \"columns\": [ 8, { \"weight\": 4, \"tablet\": 12, \"phone\": 12, \"widgets\": [...] } ] } ]", columns: "one row: [ 8, 4 ] or [ { \"weight\": 8, \"widgets\": [...] }, ... ]", width: "optional full | fixed (default full)" }
    },
    container: { doc: "a container around widgets", fields: { widgets: "[ widgets ]", class: "optional CSS class" } },
    text: { doc: "a text or heading. Inside a data view or list view {Attribute} shows its value, {Order_Customer/Name} one over references", fields: { text: "R the text", style: "optional Text | Paragraph | H1 | H2 | H3 | H4 | H5 | H6 (default Text; \"widget\": \"heading\" = H2)", format: "optional per {Attribute} of the text: { \"Amount\": { \"decimals\": 2, \"groupDigits\": true }, \"When\": { \"date\": \"dd-MM-yyyy\" } }" } },
    dataView: {
        doc: "shows one object: a page parameter (source parameter), the selected row of a grid/list view (listenTo), the object around it (context: the item of a list view / gallery, or the data view around it), one object over an association, or what a microflow/nanoflow returns",
        fields: {
            entity: "optional Module.Entity (default: the page entity; with listenTo: the grid's entity; with context / association / microflow: what it gives)",
            source: "optional parameter | listen | context | association | microflow | nanoflow (default: listen with listenTo; association / microflow / nanoflow when that field is given; context inside a list view or gallery item; else parameter = adds a page parameter; never inside a list item)",
            listenTo: "optional name of a grid/list view on this page, or dataGrid / listView when the page has one",
            association: ASSOC_ONE,
            microflow: "with source microflow: Module.Microflow that returns one object (of entity)",
            nanoflow: "with source nanoflow: Module.Nanoflow that returns one object",
            params: "with source microflow / nanoflow: its parameters, " + PARAMS.slice(9),
            editable: "optional true/false (default true; an editable data view needs a save button: \"buttons\": true or one in footer, or one in a data view around it)",
            fields: "optional [ \"Attribute\" ] inputs by attribute type (also paths \"Order_Customer/Name\": read-only; default: all attributes, unless widgets is given)",
            buttons: "optional true/false: Save/Cancel in the footer (default: true for an editable parameter data view)",
            widgets: "optional [ widgets ] inside the data view (after the fields)",
            footer: "optional [ widgets ] in the footer, e.g. buttons",
            orientation: "optional horizontal | vertical: labels beside or above the inputs (vertical: label width 0, as Studio Pro stores it)",
            labelWidth: "optional horizontal form: label width 1-11 (of 12; default 3)",
            readOnlyStyle: "optional control | text: read-only inputs as disabled controls or as text",
            showFooter: "optional true/false (default true)"
        }
    },
    dataGrid: {
        doc: "data grid (objects from the database, over an association or from a microflow/nanoflow) with single selection: a classic Data grid with a search bar, or with kind datagrid2 a Data grid 2 built from widgets/*.mpk",
        fields: {
            entity: "optional Module.Entity (default: the page entity; with association / microflow: what it gives)",
            ...LIST_SOURCE,
            columns: "optional [ \"Attribute\" or { \"attribute\": ..., \"caption\": ..., \"width\": 25, \"format\": { \"decimals\": 2 } } ] (default: all attributes; width as a weight, format: classic only; a classic column also takes \"class\"); the attribute is " + PATH + "; Data grid 2 column settings: " + Object.entries(gridExtras.COLUMN_SETTINGS).map(([k, d]) => `${k} (${d})`).join(", ") + ", and \"filter\": true | \"text\" | \"number\" | \"date\" | \"dropdown\" | \"association\" | { \"filter\": ..., \"multiSelect\": true, \"caption\": \"Name\", \"options\": \"[XPath]\", \"placeholder\": ..., \"default\": ..., \"operator\": ... } (a column over a reference \"Order_Customer/Name\" with true: a drop-down of the customers); Data grid 2 also { \"dynamicText\": \"{Name} ({Order_Customer/Name})\", \"caption\": ..., \"format\": { \"<Attribute>\": { ... } } } and { \"widgets\": [ widgets per row ], \"caption\": ... } (custom content)",
            buttons: "optional, classic only: control bar buttons [ { \"action\": \"new\" | \"edit\", \"page\": \"Module.Page\" } | { \"action\": \"delete\" } | { \"action\": \"callMicroflow\" | \"callNanoflow\", \"microflow\" / \"nanoflow\": ..., \"params\": ... } | any other actionButton action ], each with optional caption, style, name and the action options (confirm, progress, pageTitle, \"maintainSelection\": true keeps the selection after a flow); a flow gets the selected row (a List parameter: the selected rows with selection Multi)",
            onClick: "optional, Data grid 2 only: on a row click " + ACTION + "; the row is passed",
            xpath: "optional XPath constraint (source database), e.g. [Active = true()]; inside a data view [Module.Assoc = '[%CurrentObject%]'] shows the committed objects linked to its object (source association also shows new ones)",
            search: "optional true/false or [ \"Attribute\" ]: classic only, source database: Search button + search fields for text, number and enumeration columns, or for the listed attributes (default true)",
            sort: "optional default sort order (source database): [ \"Attribute\" | { \"attribute\": \"Name\", \"direction\": \"desc\" } ] (default direction asc; also paths \"Order_Customer/Name\")",
            export: "optional, Data grid 2: true or { \"caption\": \"Export to Excel\", \"fileName\": \"Orders\", \"sheetName\": \"Orders\", \"headers\": true }: an Export to Excel button above the grid and a nanoflow <Page>_<grid>_Export calling DataWidgets.Export_To_Excel (the Data Widgets module must be in the project)",
            filters: "optional, Data grid 2: true = a filter in every attribute column header (text, number, date or drop-down filter by attribute type, from widgets/*.mpk; a column over a reference: a drop-down of the objects it refers to); per column { \"attribute\": ..., \"filter\": true / false / ... }",
            headerFilters: HEADER_FILTERS,
            paging: "optional, Data grid 2: buttons | virtualScrolling | loadMore (default buttons)",
            selectionMethod: "optional, Data grid 2: rowClick | checkbox (default rowClick for Single, checkbox for Multi)",
            rowClass: "optional, Data grid 2: expression for a CSS class per row, e.g. \"if $currentObject/Active then 'row-active' else ''\"",
            configAttribute: "optional, Data grid 2: String attribute of the data view around the grid that stores the user's column settings (personalization)",
            selection: "optional Single | SingleAndMaintain | Multi | SimpleMulti | None (default Single; Data grid 2: Single | Multi | None)",
            selectFirst: "optional true/false (default false)",
            rows: "optional rows per page (default 20)",
            kind: "optional classic | datagrid2 | auto (default classic). datagrid2 builds a Data grid 2 from widgets/*.mpk with Studio Pro's defaults (a copy of one on the project's pages when the .mpk cannot be read); auto = datagrid2 when that is possible, else classic. \"widget\": \"dataGrid2\" = kind datagrid2"
        }
    },
    listView: {
        doc: "list of objects (from the database, over an association or from a microflow/nanoflow), each item with its own widgets (also inputs: an editable list); a data view can listen to it",
        fields: { entity: "optional Module.Entity (default: the page entity; with association / microflow: what it gives)", ...LIST_SOURCE, xpath: "optional XPath constraint (see dataGrid)", fields: "optional [ \"Attribute\" ] one text per attribute (also paths \"Order_Customer/Name\"; default: all attributes, unless widgets is given)", widgets: "optional [ widgets ] per item", pageSize: "optional (default 10)",
            search: "optional [ \"Attribute\" ] (source database): a search box over these attributes", sort: "optional default sort order (source database): [ \"Attribute\" | { \"attribute\": \"Name\", \"direction\": \"desc\" } ] (default direction asc)" }
    },
    actionButton: {
        doc: "a button; its action is the one action model of buttons, grid buttons, onClick, onChange, onEnter, onLeave and onEnterKeyPress",
        fields: {
            action: "R save | cancel | close | delete | showPage | callMicroflow | callNanoflow | create | openLink | signOut | sync | callWorkflow",
            caption: "optional (default Save/Cancel/Close page/Delete/New/Sign out; required for the others)",
            page: "showPage: Module.Page; create: the page that shows the new object (one parameter of its entity)", microflow: "callMicroflow: Module.Microflow", nanoflow: "callNanoflow: Module.Nanoflow",
            params: "showPage / callMicroflow / callNanoflow: page or flow parameters, " + PARAMS.slice(9),
            entity: "create: Module.Entity of the new object (default: the page's parameter entity)",
            association: "create: Module.Assoc that links the new object to the object of the data view or list item around the button (Studio Pro: Entity (path) over an association), e.g. Sales.Order_Customer for a new Order in a Customer data view",
            url: "openLink: a web address \"https://...\" or { \"attribute\": \"Website\" } of the object around it (also a path Assoc/Attr)", email: "openLink: an e-mail address (text or { \"attribute\": ... })", phone: "openLink: a phone number to call (text or { \"attribute\": ... })", sms: "openLink: a phone number to text (text or { \"attribute\": ... })",
            workflow: "callWorkflow: Module.Workflow started for the object around the button (its context entity)",
            confirm: "optional callMicroflow / callNanoflow / callWorkflow: true, a question, or { \"question\": \"Delete it?\", \"proceed\": \"Delete\", \"cancel\": \"Keep\" } (texts per language allowed)",
            progress: "optional callMicroflow / callNanoflow: none | nonBlocking | blocking (a progress bar while it runs)", progressMessage: "optional with progress: the text it shows",
            abortOnValidationErrors: "optional callMicroflow: true (default: all validation errors of the page stop it) | \"widget\" | false",
            pageTitle: "optional showPage / create: a title instead of the page's own",
            style: "optional Default | Primary | Success | Info | Warning | Danger | Inverse",
            closePage: "optional save / cancel / delete / callWorkflow: true/false (default: true in a parameter data view; false in a listening data view, which stays on the page; Studio Pro's own default is true); showPage / create: true or a number of pages to close first"
        }
    },
    input: { doc: "input for an attribute, inside a data view or a list view / gallery item (an editable list): text box, text area, check box, date picker or radio buttons (enumeration) by attribute type (or use textBox, textArea, checkBox, datePicker, radioButtons, dropDown); or for a page variable (\"variable\", anywhere on the page)", fields: { attribute: PATH + "; over references the input is read-only (as Studio Pro shows it) unless \"editable\" says otherwise", variable: "a page variable (createPage \"variables\") instead of attribute", label: "optional label (default: the attribute name)", editable: EDITABLE, onChange: ON_CHANGE, ...INPUT_MORE } },
    tabContainer: { doc: "tabs, each with its own widgets", fields: { tabs: "R [ { \"caption\": \"General\", \"widgets\": [...], \"name\": optional } ]" } },
    groupBox: { doc: "a box with a caption around widgets", fields: { caption: "optional caption; {Attribute} inside a data view or list view", collapsible: "optional no | expanded | collapsed (default no)", headerMode: "optional Div | H1 ... H6 (default as Studio Pro)", widgets: "[ widgets ]" } },
    snippetCall: { doc: "shows an existing snippet; its parameters get the objects around it, or \"params\"", fields: { snippet: "R Module.Snippet", params: "snippet parameters, " + PARAMS.slice(9) } },
    image: {
        doc: "a static image from an image collection (\"image\"), or without it the image of the object around it (data view / list view / gallery of an entity that inherits System.Image, or over \"association\")",
        fields: { image: "optional Module.Collection.Image (static image)", association: "optional Module.Assoc from the object around it to a System.Image entity (dynamic image)", width: "optional pixels (200) or percent (\"50%\"); default auto", height: "optional pixels or percent; default auto" }
    },
    referenceSelector: {
        doc: "drop-down to pick the object of a reference (association from the entity of the data view or list item around it)",
        fields: { association: "R Module.Assoc (a reference from the data view's entity)", attribute: "optional attribute of the other entity to show (default: its first String attribute; \"Assoc/Name\" is the same, a longer path is refused: Studio Pro follows one association)", label: "optional label (default: the other entity's name)", xpath: "optional XPath constraint on the selectable objects", selectableMicroflow: "optional Module.Microflow that returns the selectable objects (a list of the other entity), instead of xpath",
            selectPage: "optional Module.Page without parameters that lists the objects to pick (a grid of the other entity with a Select button): Studio Pro's Select using Page", required: INPUT_MORE.required, requiredMessage: INPUT_MORE.requiredMessage, validation: INPUT_MORE.validation, readOnlyStyle: INPUT_MORE.readOnlyStyle, editable: EDITABLE, onChange: ON_CHANGE }
    },
    referenceSetSelector: {
        doc: "picks several objects of a reference set (association the entity of the data view or list item around it owns, or one owned by both)",
        fields: { association: "R Module.Assoc (a reference set)", attribute: "optional attribute of the other entity to show (default: its first String attribute)", label: "optional label (default: the other entity's name)", xpath: "optional XPath constraint on the selectable objects", selectableMicroflow: "optional Module.Microflow that returns the selectable objects, instead of xpath", selectPage: "optional Module.Page without parameters that lists the objects to pick", readOnlyStyle: INPUT_MORE.readOnlyStyle, editable: EDITABLE, onChange: ON_CHANGE }
    },
    comboBox: {
        doc: "Combo box (pluggable, built from widgets/*.mpk like Data grid 2) for an enumeration or Boolean attribute, or a reference (association + caption attribute), inside a data view. Without the .mpk it is refused: use referenceSelector (association) or dropDown / radioButtons (enumeration)",
        fields: { attribute: "enumeration or Boolean attribute (or use association)", association: "Module.Assoc reference from the data view's entity", captionAttribute: "optional with association: String attribute of the other entity (default: its first; also a path from it, e.g. \"City_Country/Name\")", label: "optional label", editable: EDITABLE, onChange: ON_CHANGE }
    },
    templateGrid: {
        doc: "template grid (classic): objects (database, association or microflow/nanoflow, as listView) as tiles in rows and columns, each with its own widgets, with a control bar like a classic grid; a data view can listen to it",
        fields: { entity: "optional Module.Entity (default: the page entity)", ...LIST_SOURCE, xpath: "optional XPath constraint (source database)", widgets: "optional [ widgets ] per item (default: one text per attribute)",
            columns: "optional tiles per row 1-12 (default 2)", rows: "optional rows per page (default 3)", selection: "optional None | Single | SingleAndMaintain | Multi | SimpleMulti (default Single)", selectFirst: "optional true/false (default false)",
            buttons: "optional control bar buttons, as dataGrid (new, edit, delete, callMicroflow, callNanoflow)",
            search: "optional true / [ \"Attribute\" ] (source database): Search button + search fields (true: the text, number and enumeration attributes)", sort: "optional default sort order (source database): [ \"Attribute\" | { \"attribute\": \"Name\", \"direction\": \"desc\" } ] (default direction asc)" }
    },
    fileManager: {
        doc: "upload / download the file of the data view around it (classic file manager; its entity inherits System.FileDocument)",
        fields: { type: "optional upload | download | both (default both)", label: "optional label (default: File)", maxFileSize: "optional MB (default 5)", allowedExtensions: "optional e.g. \"pdf;docx\" (default: any)", showInBrowser: "optional true/false: open in the browser instead of downloading (default false)", editable: EDITABLE }
    },
    imageUploader: {
        doc: "upload the image of the data view around it (classic image uploader; its entity inherits System.Image)",
        fields: { label: "optional label (default: Upload image)", maxFileSize: "optional MB (default 5)", allowedExtensions: "optional e.g. \"png;jpg\" (default: any image)", thumbnail: "optional thumbnail size \"100x75\" (default)", editable: EDITABLE }
    },
    pluggable: {
        doc: "any pluggable widget installed in widgets/*.mpk (Data grid 2, Gallery, Combo box, filters, charts, ...), built from its definition with every property at its default, exactly as Studio Pro drops it; then the given properties. widgettype <name> (CLI, MCP tool) lists a widget's properties, types and defaults",
        fields: {
            type: "R widget id or short name: com.mendix.widget.web.datagrid.Datagrid, Datagrid, \"Data grid 2\" (see widgettype)",
            properties: "optional { \"<key>\": value } by property type: boolean true/false, integer/decimal a number, string, enumeration a key (or caption), expression \"$currentObject/Price > 0\", textTemplate a text with {Attribute}, attribute \"Name\" (of its data source, else of the data view around it), association Module.Assoc, entity Module.Entity, image Module.Collection.Image, action " + ACTION + ", selection Single | Multi | None, datasource \"Module.Entity\" or { \"entity\", \"xpath\" } (also { \"association\" } / { \"microflow\", \"params\" } / { \"nanoflow\" } for the first one), widgets [ widgets ] (inside a data source item when linked to it), object list [ { key: value } ] (non-list object { key: value })",
            label: "optional label (widgets with a Label; default: the widget name, as Studio Pro)",
            editable: EDITABLE
        }
    },
    gallery: {
        doc: "Gallery (pluggable, built from widgets/*.mpk like Data grid 2): objects (database, association or microflow/nanoflow, as listView) as tiles, each item with its own widgets; a data view can listen to it. Without the .mpk it is refused: use listView",
        fields: { entity: "optional Module.Entity (default: the page entity)", ...LIST_SOURCE, xpath: "optional XPath constraint", widgets: "optional [ widgets ] per item (default: one text per attribute)", selection: "optional Single | Multi | None (default Single)", pageSize: "optional (default 20)", columns: "optional desktop columns 1-12 (default 1)", headerFilters: HEADER_FILTERS, onClick: "optional: on an item click " + ACTION + "; the item is passed", sort: "optional default sort order (source database): [ \"Attribute\" | { \"attribute\": \"Name\", \"direction\": \"desc\" } ] (default direction asc)" }
    }
};
// Fields every widget kind takes (style: inline CSS, but for text and actionButton it is the text / button style
// unless it contains ':').
const COMMON_FIELDS = {
    visible: "optional true | an expression \"$currentObject/Active\" | { \"attribute\": \"Status\", \"values\": [\"Open\"] } (Boolean attribute: visible when true); the attribute is of the data view / list view / gallery around the widget; { \"roles\": [\"Module.Role\"] } shows it only to users with one of these module roles (also with attribute / expression)",
    design: "optional Atlas design properties of the theme (themesource/*/web/design-properties.json): { \"Spacing\": { \"margin-top\": \"M\" }, \"Spacing top\": \"Large\", \"Full width\": true, \"Style\": \"Primary\" }; null / false removes one",
    class: "optional CSS class(es)",
    style: "optional inline CSS, e.g. \"margin-top: 8px;\"",
    ...ui.COMMON_UI
};
// UI details per kind (ui.js): button icons, tooltips, aria, container render mode and on click, image alt text; the drop-down button kind
WIDGETS.dropDownButton = ui.DROPDOWN;
for (const [k, f] of Object.entries(ui.KIND_UI)) Object.assign(WIDGETS[k].fields, f);

const INPUTS = { textBox: "TextBox", textArea: "TextArea", checkBox: "CheckBox", datePicker: "DatePicker", radioButtons: "RadioButtonGroup", dropDown: "DropDown" };
const ALIASES = { button: "actionButton", grid: "dataGrid", datagrid: "dataGrid", datagrid2: "dataGrid", list: "listView", heading: "text", div: "container", radiobuttongroup: "radioButtons",
    tabs: "tabContainer", tabcontrol: "tabContainer", snippet: "snippetCall", referencesetselector: "referenceSetSelector", inputreferencesetselector: "referenceSetSelector", staticimage: "image", dynamicimage: "image", imageviewer: "image", reference: "referenceSelector", combo: "comboBox" };
// fields a weak model takes from a neighbouring widget kind -> what to write instead
const MASTER_DETAIL = `to show objects linked to the selected row, put a listView or dataGrid inside the listening dataView with "source": "association", "association": "Module.Assoc"`;
const SYNONYMS = {
    dataGrid: { fields: "use \"columns\"", pageSize: "use \"rows\"", listenTo: `a grid cannot listen; ${MASTER_DETAIL}` },
    listView: { columns: "use \"fields\"", rows: "use \"pageSize\"", listenTo: `a list view cannot listen; ${MASTER_DETAIL}` },
    dataView: { columns: "use \"fields\"", readOnly: "use \"editable\": false", readonly: "use \"editable\": false", xpath: "a data view shows one object: use \"source\": \"association\" (from the object around it), \"listenTo\" or a microflow", path: "use \"association\": \"A/B\"" },
    layoutGrid: { widgets: "a layout grid holds widgets in its columns: \"columns\": [ { \"weight\": 6, \"widgets\": [...] }, { \"weight\": 6, \"widgets\": [...] } ]" },
    tabContainer: { widgets: "a tab container holds widgets in its tabs: \"tabs\": [ { \"caption\": \"General\", \"widgets\": [...] } ]", pages: "use \"tabs\"" },
    groupBox: { title: "use \"caption\"", header: "use \"caption\"" },
    image: { entity: "a dynamic image shows the object of the data view / list view / gallery around it (or over \"association\")", attribute: "a dynamic image shows the whole System.Image object around it; leave out attribute" },
    referenceSelector: { entity: "the entity is the data view's; give \"association\"", captionAttribute: "use \"attribute\"" },
    comboBox: { caption: "use \"captionAttribute\" (the attribute of the other entity) or \"label\"",
        required: "a combo box (pluggable) has no validation in Studio Pro; use a referenceSelector or dropDown with \"required\", or check it in the save microflow",
        validation: "a combo box (pluggable) has no validation in Studio Pro; use a referenceSelector or dropDown with \"validation\"", format: "a combo box shows its caption attribute as it is" },
    input: { tooltip: ui.INPUT_TOOLTIP, ...Object.fromEntries(["helpText", "help", "hint", "title"].map(k => [k, ui.INPUT_TOOLTIP])) },
    actionButton: { ariaLabel: "a button has no aria label in Mendix; screen readers read its caption; an icon-only button: give \"tooltip\"", image: "use \"icon\" (an image as icon: \"Module.Images.Save\")", glyph: "use \"icon\": \"glyphicon-<name>\"" },
    image: { alternativeText: "use \"alt\"", altText: "use \"alt\"", ariaLabel: "use \"alt\"" },
    container: { tag: "use \"renderMode\"", element: "use \"renderMode\"", action: "use \"onClick\": { \"action\": ... }" },
    gallery: { fields: "use \"widgets\" (per item)", rows: "use \"pageSize\"", listenTo: `a gallery cannot listen; ${MASTER_DETAIL}` }
};
const KINDS = [...Object.keys(WIDGETS), ...Object.keys(INPUTS)];
const PREFIX = { fileManager: "fileManager", imageUploader: "imageUploader", pluggable: "widget", layoutGrid: "layoutGrid", container: "container", text: "text", dataView: "dataView", dataGrid: "grid", listView: "listView", actionButton: "actionButton",
    tabContainer: "tabControl", groupBox: "groupBox", dropDownButton: "dropDownButton", snippetCall: "snippetCall", referenceSelector: "referenceSelector", referenceSetSelector: "referenceSetSelector", templateGrid: "templateGrid", comboBox: "comboBox", gallery: "gallery" };
// enumValue with the widget location in the message
function choice(cls, value, field, where) {
    try {
        return enumValue(cls, value, field);
    } catch (e) {
        e.message = `${where}: ${e.message}`;
        throw e;
    }
}
const NO_MENU_ROLES = page => `menu items have no roles: who sees one = the user roles that may open ${page} (grantAccess / revokeAccess on the page)`;
const LISTENABLE = { datagrid: "dataGrid", grid: "dataGrid", listview: "listView", list: "listView", gallery: "gallery", templategrid: "templateGrid" };
const LISTENS = ["dataGrid", "listView", "gallery", "templateGrid"]; // kinds a data view can listen to
const ITEM_KINDS = ["listView", "gallery", "templateGrid", "pluggable", "dataGrid"]; // dataGrid: a Data grid 2 custom content column // each item is an object (also existing ones: pluggable)
const OBJECT_KINDS = ["dataView", "listView", "gallery", "templateGrid", "dataGrid", "pluggable"];
const ROW_KINDS = ["dataGrid", "gallery", "templateGrid", "pluggable"]; // a page opened from a row gets it mapped explicitly (Studio Pro stores Widget = the grid) // inputs and {Attribute} use their object
const DV_SOURCES = ["parameter", "listen", "context", "association", "microflow", "nanoflow"];
const LIST_SOURCES = ["database", "association", "microflow", "nanoflow"];
const DATAGRID2 = "com.mendix.widget.web.datagrid.Datagrid";
const COMBOBOX = "com.mendix.widget.web.combobox.Combobox";
const GALLERY = "com.mendix.widget.web.gallery.Gallery";
// Studio Pro's own captions for buttons it creates, in Dutch (the only other language in the test projects)
const NL = { "Upload image": "Upload afbeelding", Search: "Zoeken", Save: "Opslaan", Cancel: "Annuleren", "Close page": "Pagina sluiten", Delete: "Verwijderen", New: "Nieuw", Edit: "Bewerken" };

const widgetHelp = () => Object.entries(WIDGETS).map(([k, w]) => `\n        ${k}: ${w.doc}` + Object.entries(w.fields).map(([f, d]) => `\n            ${f}: ${d}`).join("")).join("") +
    "\n        every kind also takes:" + Object.entries(COMMON_FIELDS).map(([f, d]) => `\n            ${f}: ${d}`).join("");

// The kind of a widget name (dataGrid, grid, heading, textBox, ...) or null.
function widgetKind(name) {
    const low = String(name).toLowerCase();
    return KINDS.find(k => k.toLowerCase() === low) || ALIASES[low] || null;
}

// ops <widget kind>: the fields of one widget kind.
function widgetFields(name) {
    const kind = widgetKind(name);
    if (!kind) return null;
    const w = WIDGETS[kind] || WIDGETS.input;
    return [`widget ${kind} (inside createPage "widgets"): ${w.doc}`, ...Object.entries(w.fields).map(([f, d]) => `    ${f}: ${d}`),
        "    name: optional widget name (default as Studio Pro)", ...Object.entries(COMMON_FIELDS).filter(([f]) => !w.fields[f]).map(([f, d]) => `    ${f}: ${d}`), "  all widget kinds: ops createPage"].join("\n");
}

const PAGE_FIELDS = {
    module: "R module name",
    name: "R page name",
    title: "optional page title (default: the name)",
    entity: "optional Module.Entity: without widgets, a page parameter and a data view form for it; with widgets, the default entity of grids and data views (no page parameter unless a data view uses source parameter)",
    fields: "optional [ \"Attribute\", ... ] inputs in the form (default: all attributes of the entity); not with widgets",
    buttons: "optional true/false: Save and Cancel buttons under the form (default true); not with widgets",
    widgets: "optional [ { \"widget\": \"<kind>\", ...fields } ] the page content, top to bottom; every widget takes \"name\" (default: Studio Pro style grid1 / dataGrid2_1, dataView1, ...). A grid followed by a data view that listens to it is placed side by side (layout grid 8/4). Kinds:" + widgetHelp(),
    arrange: "optional auto | rows: rows stacks every top-level widget, also a grid and its listening data view (default auto)",
    menu: "optional \"Responsive\" (navigation profile) or { \"profile\": ..., \"caption\": ..., \"parent\": \"<menu item caption>\" }: a menu item that opens the page",
    layout: "optional Module.Layout (default: the layout most pages of this kind use)",
    url: "optional page URL, e.g. \"orders\" or \"order/{Order/Id}\" (a parameter's attribute); unique in the app",
    popupWidth: "optional pop-up width in pixels (0 = auto)", popupHeight: "optional pop-up height in pixels (0 = auto)", popupResizable: "optional true/false (pop-up layouts)",
    folder: "optional folder path",
    roles: "optional [ \"Module.Role\" ] that may open the page",
    from: "optional page template or building block of the project (Module.Name or its display name): its widgets are copied first (data widgets in it stay unconfigured, as in Studio Pro), then \"widgets\"",
    variables: "optional page variables (Mendix 10+): [ { \"name\": \"Search\", \"type\": \"String\" | \"Boolean\" | \"Integer\" | \"Decimal\" | \"DateTime\" | \"Enum(Module.E)\", \"default\": \"''\" (an expression) } ]; an input takes \"variable\": \"Search\" instead of an attribute, expressions, XPath and flow \"params\" use $Search",
    design: "optional design properties of the page (Atlas FormBase: { \"Form orientation\": \"Horizontal\", \"Label width\": \"3\" }) where the theme has them",
    ...ui.PAGE_UI,
    native: "optional true: a native mobile page (a NativePhone layout of the project), or the kind of native page: popup (a pop-up page: NativePhone_PopOver), fullPage, topBarOnly, sideMenu, default; widgets: text, container, actionButton, dataView, listView, inputs (textBox, textArea, checkBox, datePicker, radioButtons, dropDown), referenceSelector, image, tabContainer, layoutGrid, snippetCall, native pluggable widgets; refused when the project has no native layout"
};
const MENU_FIELDS = {
    page: "Module.Page (without page parameters); a native page becomes a bottom bar item of the native profile",
    action: "optional instead of page: the menu item's action, as on actionButton: \"signOut\", { \"action\": \"openLink\", \"url\": \"https://...\" }, { \"action\": \"callMicroflow\", \"microflow\": ... } (no object around it), create, sync; needs caption",
    profile: "optional navigation profile: Responsive, Tablet, Phone, Native or its name (default Responsive; a native page: the native profile)",
    caption: "optional (default: the page title)",
    parent: "optional caption of an existing menu item to put it under"
};
const HOME_FIELDS = {
    page: "Module.Page without parameters (or use microflow); a native page goes to the native profile",
    microflow: "Module.Microflow without parameters, instead of a page",
    nanoflow: "native profile: Module.Nanoflow without parameters, instead of a page",
    profile: "optional navigation profile (default Responsive; \"Native\": the native mobile profile, refused when the project has none)",
    roles: "optional [ \"UserRole\" ] (user roles, e.g. Administrator): home page for these roles only; without: the default home page"
};

function makePages(h) {
    const { model, client } = h;

    // Layout use of the project's pages: { layout, placeholder, withParameter } per page.
    function layoutUse() {
        const out = [];
        for (const id of client.project.units.keys()) {
            const p = client.project.read(id);
            if (p.$Type !== "Forms$Page" || !p.FormCall || !p.FormCall.Form) continue;
            const arg = (p.FormCall.Arguments || []).find(a => a.Parameter);
            if (!arg) continue;
            out.push({ layout: p.FormCall.Form, placeholder: arg.Parameter, withParameter: (p.Parameters || []).length > 0 });
        }
        return out;
    }

    function pickLayout(wanted, withParameter) {
        const known = new Set(model.allLayouts().map(l => l.qualifiedName));
        const uses = layoutUse().filter(u => known.has(u.layout)); // a page may refer to a layout whose module is gone
        if (wanted) {
            const hit = uses.find(u => u.layout === wanted);
            if (hit) return hit;
            if (!known.has(wanted)) fail(`no layout '${wanted}'`, wanted, [...known]);
            // a layout no page uses yet: its own placeholders (Main, or the only one)
            const info = layoutInfo(wanted);
            const ph = info.placeholders.includes("Main") ? "Main" : info.placeholders.length === 1 ? info.placeholders[0] : null;
            if (!ph) throw new Error(`layout '${wanted}' has placeholders ${info.placeholders.join(", ") || "none"}; no page uses it, so the one for the content is unknown: create the first page with it in Studio Pro`);
            client.warn(`layout ${wanted}: no page of the project uses it yet; the content goes in its placeholder ${ph} (check the page in Studio Pro)`);
            return { layout: wanted, placeholder: `${wanted}.${ph}` };
        }
        // a page without an object is usually a full page: prefer layouts that are not popups
        let pool = uses.filter(u => u.withParameter === withParameter);
        if (!withParameter && pool.some(u => !/popup/i.test(u.layout))) pool = pool.filter(u => !/popup/i.test(u.layout));
        const counts = new Map();
        for (const u of pool.length ? pool : uses) counts.set(u.layout + "|" + u.placeholder, (counts.get(u.layout + "|" + u.placeholder) || 0) + 1);
        const best = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (!best) throw new Error("the project has no page with a layout to copy; create the first page in Studio Pro");
        const [layout, placeholder] = best[0].split("|");
        return { layout, placeholder };
    }

    // { native, placeholders } of a layout, read from the saved model (or the SDK for a new one)
    function layoutInfo(qn) {
        const l = model.allLayouts().find(x => x.qualifiedName === qn);
        if (!l) return { native: false, placeholders: [] };
        if (client.project.units.has(l.id)) {
            const u = client.project.read(l.id);
            const phs = [];
            const walk = o => {
                if (Array.isArray(o)) return o.forEach(walk);
                if (!o || typeof o !== "object" || Buffer.isBuffer(o)) return;
                if (o.$Type === "Forms$Placeholder" && o.Name) phs.push(o.Name);
                for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
            };
            walk(u.Content);
            return { native: !!(u.Content && u.Content.$Type === "Forms$NativeLayoutContent"), placeholders: phs };
        }
        const phs = [];
        if (l.isLoaded) l.traverse(el => el instanceof pages.Placeholder && phs.push(el.name));
        return { native: !!(l.isLoaded && l.content instanceof pages.NativeLayoutContent), placeholders: phs };
    }
    const nativeLayouts = () => model.allLayouts().map(l => l.qualifiedName).filter(qn => layoutInfo(qn).native);
    // the LayoutType of a saved layout (Default, Popup, ...), or null
    const layoutTypeOf = qn => {
        const l = model.allLayouts().find(x => x.qualifiedName === qn);
        if (!l || !client.project.units.has(l.id)) return null;
        const u = client.project.read(l.id);
        return (u.Content && u.Content.LayoutType) || null;
    };

    const humanize = s => s.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

    // A unit by qualified name, without the "did you mean" search of h.get (slow on big projects).
    const unitNamed = qn => model.allUnits().find(u => {
        try {
            return u.qualifiedName === qn;
        } catch (e) {
            return false;
        }
    });

    // ------------------------------------------------ texts

    let langs = null;
    async function languages() {
        const s = model.allProjectSettings()[0];
        const loaded = s && (await s.load());
        const ls = loaded && loaded.settingsParts.find(p => p instanceof sdk.settings.LanguageSettings);
        const dflt = (ls && ls.defaultLanguageCode) || "en_US";
        langs = [dflt, ...(ls ? ls.languages.map(l => l.code) : []).filter(c => c !== dflt)];
        return langs;
    }

    // Writes value in the default language, as Studio Pro does for typed texts; builtin = one of Studio Pro's own button
    // captions, which it also writes in English and Dutch. Counts texts that other project languages still lack.
    async function textAll(t, value, ctx, builtin) {
        const ls = await languages();
        const items = { [ls[0]]: String(value) };
        const own = builtin && NL[value];
        if (own) for (const c of ls) if (c === "nl_NL" || /^en_/.test(c)) items[c] = c === "nl_NL" ? NL[value] : String(value);
        const tr = h.translationsOf && h.translationsOf(value);
        if (ctx && value !== "" && ls.length > 1 && !own && !(tr && ls.slice(1).every(c => c in tr))) ctx.untranslated++;
        return h.text(t, items);
    }

    // {1} in a client template is a Mendix placeholder: a literal one would show a parameter (or point at none).
    function noPlaceholder(value, where) {
        const m = /\{\d+\}/.exec(String(value));
        if (m) throw new Error(`${where}: ${m[0]} is a Mendix placeholder; write {AttributeName} to show a value (in a data view or list view), or leave out the braces`);
    }

    async function templateAll(owner, prop, value, ctx, where, builtin) {
        noPlaceholder(value, where);
        if (!owner[prop]) owner[prop] = pages.ClientTemplate.create(model);
        await textAll(owner[prop].template, value, ctx, builtin);
        return owner[prop];
    }

    // ------------------------------------------------ the widget list: validate, name, resolve listenTo

    function kindOf(spec, where) {
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: each widget is an object { "widget": "<kind>", ... }`);
        const raw = spec.widget !== undefined ? spec.widget : spec.type;
        if (raw === undefined) throw new Error(`${where}: missing "widget". Supported: ${KINDS.join(", ")}`);
        if (typeof raw !== "string") throw new Error(`${where}: "widget" must be a kind name such as "text" (supported: ${KINDS.join(", ")})`);
        const kind = widgetKind(raw);
        if (!kind) fail(`${where}: unknown widget '${raw}'. Supported: ${KINDS.join(", ")} (other pluggable widgets: "widget": "pluggable", "type": ... ; see widgettype)`, raw, KINDS);
        const own = [...new Set([...Object.keys((WIDGETS[kind] || WIDGETS.input).fields), ...Object.keys(COMMON_FIELDS)])];
        const known = ["widget", "type", "name", ...own];
        for (const k of Object.keys(spec)) {
            if (known.includes(k)) continue;
            const syn = (SYNONYMS[kind] || {})[k] || (INPUTS[kind] || /^(referenceS|comboBox)/.test(kind) ? SYNONYMS.input[k] : undefined);
            if (syn) throw new Error(`${where}: unknown field '${k}' for ${kind}: ${syn}`);
            const s = suggest(k, own);
            throw new Error(`${where}: unknown field '${k}' for ${kind}. ` + (s.length ? `Did you mean: ${s.join(", ")}?` : `Fields of ${kind}: ${own.join(", ")}, name`));
        }
        for (const [k, d] of Object.entries((WIDGETS[kind] || WIDGETS.input).fields)) if (d.startsWith("R ") && (spec[k] === undefined || spec[k] === "")) throw new Error(`${where}: ${kind} needs '${k}' (${d.slice(2)})`);
        if (spec.name !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(spec.name))) throw new Error(`${where}: name '${spec.name}' is not valid (letters, digits, _)`);
        return kind;
    }

    const list = (v, where) => {
        if (v === undefined) return [];
        if (!Array.isArray(v)) throw new Error(`${where} must be a list [ ... ]`);
        return v;
    };

    function weight(v, where, dflt) {
        if (v === undefined) return dflt;
        if (/^auto$/i.test(String(v))) return -1;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error(`${where}: weight '${v}' must be 1-12 or "auto"`);
        return n;
    }

    // the platform of the page the widgets of a scan go on ("native": native pluggable widgets allowed, web ones refused)
    let scanPlatform = "web";
    function setPlatform(p) {
        const was = scanPlatform;
        scanPlatform = p;
        return was;
    }
    // Spec tree -> node tree. container: nearest data view / list view node around this one.
    function scan(specs, where, container, nodes) {
        return list(specs, where).map((spec, i) => {
            const at = `${where}[${i + 1}]`;
            const kind = kindOf(spec, at);
            const node = { kind, spec, where: `${at} (${kind})`, container, name: spec.name !== undefined ? String(spec.name) : null, heading: /^heading$/i.test(spec.widget || spec.type) };
            nodes.push(node);
            if (kind === "layoutGrid") {
                if (spec.rows !== undefined && spec.columns !== undefined) throw new Error(`${node.where}: give rows or columns, not both`);
                const rows = spec.rows !== undefined ? list(spec.rows, `${node.where}.rows`) : [{ columns: spec.columns }];
                if (!rows.length) throw new Error(`${node.where}: needs rows or columns`);
                node.rows = rows.map((r, ri) => {
                    const rw = `${node.where} row ${ri + 1}`;
                    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error(`${rw}: a row is { "columns": [ ... ] }`);
                    uiFns().checkKeys(r, uiFns().ROW_KEYS, rw, "row");
                    const cols = list(r.columns, `${rw}.columns`);
                    if (!cols.length) throw new Error(`${rw}: needs columns, e.g. [ 8, 4 ]`);
                    const out = cols.map((c, ci) => {
                        const at = `${rw} column ${ci + 1}`;
                        const col = typeof c === "object" && c ? c : { weight: c };
                        uiFns().checkKeys(col, uiFns().COL_KEYS, at, "column");
                        return { weight: weight(col.weight, at, -1), tablet: weight(col.tablet, at, -1), phone: weight(col.phone, at, -1), widgets: scan(col.widgets, `${at}.widgets`, container, nodes), spec: col, where: at };
                    });
                    if (out.reduce((s, c) => s + Math.max(c.weight, 0), 0) > 12) client.warn(`layout grid ${rw}: column weights add up to more than 12; the columns wrap`);
                    out.spec = r;
                    out.where = rw;
                    return out;
                });
            } else if (kind === "container") node.widgets = scan(spec.widgets, `${node.where}.widgets`, container, nodes);
            else if (kind === "dataGrid" && Array.isArray(spec.columns)) {
                // Data grid 2 custom content: widgets per row, in the row's object
                node.colNodes = spec.columns.map((c, ci) => (c && typeof c === "object" && c.widgets !== undefined ? scan(c.widgets, `${node.where} column ${ci + 1}.widgets`, node, nodes) : null));
            }
            else if (kind === "pluggable") plScan(node, container, nodes);
            else if (kind === "dataView") {
                node.widgets = scan(spec.widgets, `${node.where}.widgets`, node, nodes);
                node.footer = scan(spec.footer, `${node.where}.footer`, node, nodes);
            } else if (kind === "listView" || kind === "gallery" || kind === "templateGrid") node.widgets = scan(spec.widgets, `${node.where}.widgets`, node, nodes);
            else if (kind === "groupBox") node.widgets = scan(spec.widgets, `${node.where}.widgets`, container, nodes);
            else if (kind === "tabContainer") {
                const tabs = list(spec.tabs, `${node.where}.tabs`);
                if (!tabs.length) throw new Error(`${node.where}: needs at least one tab: "tabs": [ { "caption": "General", "widgets": [...] } ]`);
                node.tabs = tabs.map((t, ti) => {
                    const at = `${node.where} tab ${ti + 1}`;
                    if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error(`${at}: a tab is { "caption": "General", "widgets": [...] }`);
                    for (const k of Object.keys(t)) if (!["caption", "widgets", "name"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["caption", "widgets", "name"]);
                    if (t.caption === undefined || t.caption === "") throw new Error(`${at}: needs "caption"`);
                    if (t.name !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(t.name))) throw new Error(`${at}: name '${t.name}' is not valid (letters, digits, _)`);
                    return { caption: String(t.caption), name: t.name !== undefined ? String(t.name) : null, where: at, widgets: scan(t.widgets, `${at}.widgets`, container, nodes) };
                });
            }
            if (!((INPUTS[kind] || kind === "input") && spec.variable !== undefined) && (INPUTS[kind] || kind === "input" || kind === "fileManager" || kind === "imageUploader" || kind === "referenceSelector" || kind === "referenceSetSelector" || kind === "comboBox") && (!container || !OBJECT_KINDS.includes(container.kind))) throw new Error(`${node.where}: inputs go inside a dataView (its "widgets" or "fields"), or a listView / gallery item (an editable list); an input of a page variable ("variable") goes anywhere`);
            if (kind === "actionButton") {
                const a = String(spec.action).toLowerCase();
                if (["save", "cancel"].includes(a) && !around(node, "dataView")) throw new Error(`${node.where}: a ${a} button goes inside a dataView (or a list item inside one)`);
                if (a === "delete" && !container) throw new Error(`${node.where}: a delete button goes inside a dataView or listView`);
            }
            return node;
        });
    }

    // the nearest node of kind around n (through list items and nested data views), or null
    function around(n, kind) {
        for (let c = n.container; c; c = c.container) if (c.kind === kind) return c;
        return null;
    }
    // the list item n sits in (list view, gallery, template grid; also deeper, in a data view inside it), or null
    function inItem(n) {
        for (let c = n.container; c; c = c.container) if (ITEM_KINDS.includes(c.kind)) return c;
        return null;
    }

    // taken: names already on the page (an existing page keeps its widget names)
    function names(taken = []) {
        const used = new Set(taken);
        return {
            reserve(n, where) {
                if (used.has(n)) throw new Error(`${where}: the name '${n}' is used twice on this page`);
                used.add(n);
            },
            next(prefix) {
                for (let i = 1; ; i++) {
                    if (!used.has(prefix + i)) {
                        used.add(prefix + i);
                        return prefix + i;
                    }
                }
            }
        };
    }

    // ------------------------------------------------ model lookups

    const entities = new Map();
    async function entityOf(qn, where) {
        if (!qn) throw new Error(`${where}: needs 'entity' (or a page-level "entity")`);
        if (!entities.has(qn)) {
            const e = await h.entity(qn);
            await h.loadParents(e);
            entities.set(qn, e);
        }
        return entities.get(qn);
    }

    function attributeOf(ent, name, where) {
        const chain = h.attributeChain(ent);
        const a = chain.attributes.find(x => x.name === name);
        if (a) return a;
        // a parent in a module that is not in the project (System.User, ...): its attributes are unknown here
        if (!chain.complete) fail(`${where}: '${name}' is not an attribute of ${ent.qualifiedName} itself; attributes inherited from System entities cannot be shown by ops (add that column or input in Studio Pro). Attributes here: ${chain.attributes.map(x => x.name).join(", ") || "none"}`, name, chain.attributes.map(x => x.name));
        return fail(`${where}: ${ent.qualifiedName} has no attribute '${name}'`, name, chain.attributes.map(x => x.name));
    }

    const shown = ent => h.attributeChain(ent).attributes.filter(a => !(a.type instanceof dm.BinaryAttributeType)).map(a => a.name);

    // ------------------------------------------------ attribute paths over associations ("Order_Customer/Name")

    // Every association of the project (all domain models loaded): prepareAssocs at the start of an op, so that paths
    // resolve without waiting (the builders that take attributes are synchronous).
    let ASSOCS = null;
    async function prepareAssocs(ctx) {
        ASSOCS = await allAssociations(ctx);
        return ASSOCS;
    }
    const entityLoaded = qn => {
        const e = model.findEntityByQualifiedName(qn);
        return e && e.isLoaded ? e : null;
    };
    // One step of an attribute path from cur: an association (Module.Assoc or its name) or the name of the entity it
    // leads to, over a reference to one object. { assoc, to (entity), text }
    function stepOf(cur, tok, where, full) {
        const all = ASSOCS || [];
        const touching = all.filter(a => isA(cur, ends(a).from) || isA(cur, ends(a).to));
        const toOne = a => {
            const { from, to } = ends(a), set = a.type === dm.AssociationType.ReferenceSet;
            return isA(cur, from) && !set ? to : isA(cur, to) && !set && a.owner === dm.AssociationOwner.Both ? from : null;
        };
        let a = all.find(x => x.qualifiedName === tok) || null;
        if (!a && !tok.includes(".")) {
            const c = touching.filter(x => x.name === tok);
            if (c.length > 1) throw new Error(`${where}: '${tok}' in ${full} names ${c.length} associations of ${cur.qualifiedName} (${c.map(x => x.qualifiedName).join(", ")}); write Module.Assoc`);
            a = c[0] || null;
        }
        if (!a) {
            // the name of the entity it refers to (Customer in "Customer/Name" from an Order)
            const other = x => (isA(cur, ends(x).from) ? ends(x).to : ends(x).from);
            const c = touching.filter(x => other(x) === tok || short(other(x)) === tok);
            const one = c.filter(toOne);
            if (one.length > 1) throw new Error(`${where}: '${tok}' in ${full}: ${cur.name} refers to ${tok} over ${one.map(x => x.qualifiedName).join(" and ")}; name the association`);
            a = one[0] || c[0] || null;
        }
        if (!a) {
            const names = touching.map(x => x.name);
            const ents = touching.filter(toOne).map(x => short(isA(cur, ends(x).from) ? ends(x).to : ends(x).from));
            fail(`${where}: '${tok}' in ${full} is no association of ${cur.qualifiedName} (nor an entity it refers to)${names.length ? `; its associations: ${touching.map(x => x.qualifiedName).join(", ")}` : " (it has none)"}`, tok, [...ents, ...names, ...touching.map(x => x.qualifiedName)]);
        }
        const { from, to } = ends(a);
        if (!isA(cur, from) && !isA(cur, to)) throw new Error(`${where}: ${a.qualifiedName} in ${full} links ${from} and ${to}, not ${cur.qualifiedName}` + (touching.length ? `; associations of ${cur.qualifiedName}: ${touching.map(x => x.qualifiedName).join(", ")}` : ""));
        const dest = toOne(a);
        if (!dest) {
            const many = isA(cur, from) ? to : from;
            const why = isA(cur, from) ? "a reference set" : `the reverse of a reference: a ${short(many)} refers to a ${short(cur.qualifiedName)}, so a ${short(cur.qualifiedName)} has many`;
            throw new Error(`${where}: ${full}: ${a.name} leads to many ${short(many)} (${why}); an attribute path follows references to one object. To show the ${short(many)} objects use a listView or dataGrid with "source": "association", "association": "${a.qualifiedName}" (inside a data view or list item of ${short(cur.qualifiedName)})`);
        }
        const ent = entityLoaded(dest);
        if (!ent) throw new Error(`${where}: ${full}: ${a.qualifiedName} leads to ${dest}, which ops cannot read (System module); show it in Studio Pro`);
        return { assoc: a, to: ent };
    }
    // "Attr", "Assoc/Attr", "Module.Assoc/Attr", "Entity/Attr", "A/B/Attr" from ent: { attr, steps, ent (of the
    // attribute), text ("Assoc/Attr" as written back), name (the attribute's) }
    function pathOf(ent, spec, where) {
        if (spec && typeof spec === "object" && spec.attr) return spec;
        const raw = String(spec).trim();
        const parts = raw.split("/").map(s => s.trim());
        if (parts.length === 1) {
            const attr = attributeOf(ent, raw, where);
            return { attr, steps: [], ent, text: attr.name, name: attr.name };
        }
        if (parts.some(p => !/^[A-Za-z_][\w.]*$/.test(p))) throw new Error(`${where}: '${raw}' is not an attribute path; write Assoc/Attribute, e.g. "Order_Customer/Name"`);
        if (!ASSOCS) throw new Error(`${where}: attribute paths are not available here`);
        const steps = [];
        let cur = ent;
        for (const tok of parts.slice(0, -1)) {
            const st = stepOf(cur, tok, where, raw);
            steps.push(st);
            cur = st.to;
        }
        const attr = attributeOf(cur, parts[parts.length - 1], `${where} (${raw})`);
        return { attr, steps, ent: cur, text: [...steps.map(s => s.assoc.name), attr.name].join("/"), name: attr.name };
    }
    // An AttributeRef for path p (its steps in an IndirectEntityRef, as Studio Pro stores an attribute over references)
    function attrRefOf(p) {
        const ref = dm.AttributeRef.create(model);
        ref.attribute = p.attr;
        if (p.steps && p.steps.length) {
            const er = dm.IndirectEntityRef.createInMemberRefUnderEntityRef(ref);
            for (const st of p.steps) {
                const x = dm.EntityRefStep.createIn(er);
                x.association = st.assoc;
                x.destinationEntity = st.to;
            }
        }
        return ref;
    }
    const NOTES = new WeakMap(); // dry-run notes of built widgets (an input over references is read-only)
    const asPath = x => (x && x.attr ? x : { attr: x, steps: [], ent: null, text: x.name, name: x.name });
    // "{Name}", "{Order_Customer/Name}" in a text template
    const TEMPLATE_RE = /\{([A-Za-z_][\w.]*(?:\/[A-Za-z_][\w.]*)*)\}/g;

    // ent is (a specialization of) the entity named qn
    function isA(ent, qn) {
        for (let e = ent, i = 0; e && i < 20; i++) {
            if (e.qualifiedName === qn) return true;
            const g = e.generalization;
            e = g instanceof dm.Generalization && g.generalization && g.generalization.isLoaded ? g.generalization : null;
        }
        return false;
    }

    // The objects around a node, nearest first: [{ name, ent, node }] of the data views and list items it sits in.
    function objectsAround(node) {
        const out = [];
        for (let c = node.container; c; c = c.container) if (c.ent) out.push({ name: c.name || (c.widget && c.widget.name) || c.kind, ent: c.ent, node: c });
        return out;
    }

    // Studio Pro passes the objects around a button or data source implicitly (no parameter mapping is stored): a page
    // or flow can have no parameters, or object parameters of the data view / list item it is in (or one around that).
    function implicitOnly(params, node, what) {
        if (!params.length) return;
        const objs = objectsAround(node);
        const bad = params.filter(p => !(p.entity && objs.some(o => isA(o.ent, p.entity))) && !(p.list && node.selectionList && isA(node.selectionList, p.list)));
        if (!bad.length) return;
        const list = params.map(p => `${p.name} (${p.type || p.entity || "?"})`).join(", ");
        throw new Error(`${node.where}: ${what} has parameter(s) ${list}. Without "params" only the object of the data view or list item around it is passed` +
            (objs.length ? ` (${objs.map(o => `${o.name}: ${o.ent.qualifiedName}`).join(", ")})` : " (it is in none)") + `; ${bad[0].entity ? `${bad[0].name} (${bad[0].entity}) matches none of them` : bad[0].list ? `${bad[0].name} is a List of ${bad[0].list}: give "params": { "${bad[0].name}": "$<grid>.selection" } (a grid of ${short(bad[0].list)} with "selection": "Multi")` : `${bad[0].name} is ${bad[0].type}: give it in "params"`}`);
    }

    // ------------------------------------------------ explicit parameter mapping ("params")

    // Variables a widget can pass: [{ name ("$x"), kind, ent, list (Multi selection), node/widget, text }].
    // $currentObject = the object around it; enclosing data views by name and data views that listen; grid
    // selections; page and snippet parameters.
    async function reachable(node, ctx) {
        const out = [];
        const objs = objectsAround(node);
        if (objs.length) out.push({ name: "$currentObject", kind: "object", ent: objs[0].ent, node: objs[0].node, text: `the ${objs[0].ent.name} of ${objs[0].name}` });
        for (const o of objs) if (o.node.kind === "dataView" && o.name) out.push({ name: "$" + o.name, kind: "object", ent: o.ent, node: o.node, text: `data view ${o.name} (${o.ent.qualifiedName})` });
        for (const n of ctx.scope || []) {
            if (!n.name || !n.ent) continue;
            if (n.kind === "dataView" && n.source === "listen" && !out.some(x => x.name === "$" + n.name)) out.push({ name: "$" + n.name, kind: "object", ent: n.ent, node: n, text: `data view ${n.name} (${n.ent.qualifiedName}, listens to ${n.target ? n.target.name : "a grid"})` });
            if (LISTENS.includes(n.kind) || n.kind === "templateGrid") {
                const sel = String((n.spec && n.spec.selection) || "Single").toLowerCase();
                if (sel === "none") continue;
                out.push({ name: `$${n.name}.selection`, kind: "selection", ent: n.ent, list: /multi/.test(sel), node: n, text: `the ${/multi/.test(sel) ? "selected rows (a list)" : "selected row"} of ${n.name} (${n.ent.qualifiedName})` });
            }
        }
        const params = ctx.page ? [...(ctx.page.parameters || [])] : [];
        for (const p of ctx.params ? ctx.params.values() : []) if (!params.includes(p)) params.push(p);
        const snip = ctx.page instanceof pages.Snippet;
        for (const p of params) {
            const t = p.parameterType;
            const ent = t instanceof datatypes.ObjectType ? await entityOf(t.entityQualifiedName, node.where).catch(() => null) : null;
            out.push({ name: "$" + p.name, kind: snip ? "snippetParameter" : "pageParameter", el: p, ent, type: typeText(t), text: `${snip ? "snippet" : "page"} parameter ${p.name} (${typeText(t)})` });
        }
        for (const [n, lv] of ctx.vars || []) out.push({ name: "$" + n, kind: "variable", type: typeText(lv.variableType), text: `page variable ${n} (${typeText(lv.variableType)})` });
        // parameters a new page gets from its data views (source parameter), named after their entity
        for (const n of ctx.scope || []) {
            if (n.kind !== "dataView" || n.source !== "parameter" || !n.ent || ctx.existing || out.some(x => x.kind === "pageParameter" && x.ent === n.ent)) continue;
            out.push({ name: "$" + n.ent.name, kind: "pageParameter", el: null, ent: n.ent, type: n.ent.qualifiedName, text: `page parameter ${n.ent.name} (${n.ent.qualifiedName})` });
        }
        return out;
    }
    const SYSTEM_VARS = /^\$(currentUser|currentSession|currentDeviceType)\b/;

    // The "params" of a page, flow or snippet call: [{ p, v (a reachable variable) | expr }] for the given ones; the
    // rest must be objects around the widget (passed implicitly, as Studio Pro does). target: page | flow | snippet.
    async function mapParams(given, params, node, ctx, what, target) {
        if (given === undefined) {
            implicitOnly(params, node, what);
            return rowParams(params, node, target);
        }
        if (!given || typeof given !== "object" || Array.isArray(given)) throw new Error(`${node.where}: params is { "<Parameter>": "$currentObject" | "$dataView1" | "$grid1.selection" | "$Parameter" | expression }`);
        const vars = await reachable(node, ctx);
        const list = () => vars.length ? vars.map(v => `${v.name} = ${v.text}`).join("; ") : "none (the widget is in no data view or list item, and the page has no grid or parameter)";
        const out = [];
        for (const [k, raw] of Object.entries(given)) {
            const p = params.find(x => x.name === k);
            if (!p) fail(`${node.where}: ${what} has no parameter '${k}'${params.length ? ` (parameters: ${params.map(x => `${x.name} (${x.type || x.entity})`).join(", ")})` : " (it has none)"}`, k, params.map(x => x.name));
            const val = String(raw).trim();
            const at = `${node.where}: params.${k}`;
            if (!val) throw new Error(`${at}: empty; give a variable (${vars.map(v => v.name).join(", ") || "none here"}) or an expression`);
            const m = /^\$([A-Za-z_]\w*)(\.selection)?$/.exec(val);
            let v = m && !SYSTEM_VARS.test(val) ? vars.find(x => x.name === val) : null;
            if (m && !v && !SYSTEM_VARS.test(val)) {
                if (m[2]) fail(`${at}: no grid, list view or gallery '${m[1]}' with a selection on this page. Variables here: ${list()}`, val, vars.map(x => x.name));
                // $name of something else: an error with what is there (an expression would not find it either)
                fail(`${at}: '${val}' is no variable here. Variables here: ${list()}`, val, vars.map(x => x.name));
            }
            if (v && v.kind === "variable") {
                if (p.entity || p.list) throw new Error(`${at}: ${val} is a ${v.type} page variable; ${p.name} takes ${p.list ? "a List of " + p.list : p.entity}`);
                out.push({ p, expr: val, text: `${k} = ${val}` });
                continue;
            }
            if (v && v.kind === "selection" && /\.selection$/.test(val) && !v.list && p.list) throw new Error(`${at}: ${val} is one object (selection ${(v.node.spec || {}).selection || "Single"}); ${p.name} is a List of ${p.list}: give the grid "selection": "Multi"`);
            if (v && v.list && !p.list) throw new Error(`${at}: ${val} is a list (Multi selection); ${p.name} takes ${p.type || p.entity}: use a List parameter, or "selection": "Single"`);
            if (v) {
                const need = p.entity || p.list;
                if (!need) throw new Error(`${at}: ${val} is an object (${v.ent ? v.ent.qualifiedName : v.type}); ${p.name} is ${p.type}: give an expression, e.g. "${val}/<Attribute>"`);
                if (v.ent && !isA(v.ent, need)) throw new Error(`${at}: ${val} is ${v.ent.qualifiedName}; ${p.name} takes ${p.list ? "a List of " : ""}${need}. Variables here: ${list()}`);
                if (!v.ent && v.type !== need) throw new Error(`${at}: ${val} is ${v.type}; ${p.name} takes ${need}`);
                out.push({ p, v, text: `${k} = ${val}` });
            } else {
                if (p.list) throw new Error(`${at}: ${p.name} is a List of ${p.list}: pass a grid selection "$<grid>.selection" (selection Multi). Variables here: ${list()}`);
                if (target === "page" && p.entity) throw new Error(`${at}: a page parameter of an object takes a variable (${vars.filter(x => x.ent).map(x => x.name).join(", ") || "none here"}), not an expression`);
                if (target === "snippet") throw new Error(`${at}: a snippet parameter takes a variable (${vars.filter(x => x.ent).map(x => x.name).join(", ") || "none here"})`);
                if (/\$currentObject/i.test(val) && !objectsAround(node).length) throw new Error(`${at}: $currentObject is the object around the widget, and it is in none`);
                out.push({ p, expr: val, text: `${k} = ${val}` });
            }
        }
        const rest = params.filter(x => !(x.name in given));
        if (rest.length) implicitOnly(rest, node, `${what} (parameters not in "params")`);
        return [...out, ...rowParams(rest, node, target)];
    }
    // A page opened from a grid row or gallery item: Studio Pro stores the row's mapping (Widget = the grid) itself.
    function rowParams(params, node, target) {
        const row = node.container;
        if (target !== "page" || !row || !ROW_KINDS.includes(row.kind)) return [];
        return params.filter(p => p.entity && row.ent && isA(row.ent, p.entity)).map(p => ({ p, v: { name: "$currentObject", kind: "object", ent: row.ent, node: row }, text: `${p.name} = the row of ${row.name}` }));
    }

    // ------------------------------------------------ the action model of buttons, grid buttons, onClick, onChange,
    // onEnter, onLeave, onEnterKeyPress (and menu items): one spec, as Studio Pro's "On click" settings

    const ACTION_NAMES = { save: "save", cancel: "cancel", close: "close", closepage: "close", delete: "delete", showpage: "showPage", callmicroflow: "callMicroflow", callnanoflow: "callNanoflow",
        create: "create", createobject: "create", openlink: "openLink", signout: "signOut", logout: "signOut", sync: "sync", synchronize: "sync", callworkflow: "callWorkflow",
        opentask: "openTask", openusertask: "openTask", openworkflow: "openWorkflow" };
    const ACTION_LIST = [...new Set(Object.values(ACTION_NAMES))];
    // the fields each action takes (besides "action")
    const ACTION_FIELDS = {
        save: ["closePage"], cancel: ["closePage"], delete: ["closePage"], close: [], signOut: [], sync: [],
        showPage: ["page", "params", "pageTitle", "closePage"],
        callMicroflow: ["microflow", "params", "confirm", "progress", "progressMessage", "abortOnValidationErrors", "maintainSelection"],
        callNanoflow: ["nanoflow", "params", "confirm", "progress", "progressMessage", "maintainSelection"],
        create: ["entity", "page", "association", "pageTitle", "closePage"],
        openLink: ["url", "email", "phone", "sms"],
        callWorkflow: ["workflow", "confirm", "closePage"],
        openTask: [], openWorkflow: []
    };
    const ACTION_KEYS = ["action", ...new Set(Object.values(ACTION_FIELDS).flat())];
    const FLOW_ONLY = { confirm: "callMicroflow, callNanoflow or callWorkflow (Studio Pro asks only before those)", progress: "callMicroflow or callNanoflow", progressMessage: "callMicroflow or callNanoflow",
        abortOnValidationErrors: "callMicroflow", maintainSelection: "callMicroflow or callNanoflow on a grid button", pageTitle: "showPage or create", params: "showPage, callMicroflow or callNanoflow" };

    // A client action from an action spec (see ACTION_DOC). at: the node whose objects it gets (its container chain),
    // assign(a) attaches the new action. opts: { button (keep Studio Pro's DisabledDuringExecution of a button),
    // grid (the GridActionButton, for maintainSelection) }. Returns how the dry run describes it.
    async function makeAction(spec, at, ctx, where, assign, opts = {}) {
        if (typeof spec === "string") spec = { action: spec };
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: an action is { "action": "showPage", "page": "Module.Page" } or { "action": "callMicroflow", "microflow": "Module.Flow" } (actions: ${ACTION_LIST.join(", ")})`);
        for (const k of Object.keys(spec)) if (!ACTION_KEYS.includes(k)) fail(`${where}: unknown field '${k}' in the action`, k, ACTION_KEYS);
        const action = ACTION_NAMES[String(spec.action).toLowerCase().replace(/[\s_-]/g, "")];
        if (!action) fail(`${where}: action '${spec.action}' is not known (use ${ACTION_LIST.join(" | ")})`, String(spec.action), ACTION_LIST);
        if (action === "openTask" || action === "openWorkflow") throw new Error(`${where}: ${action} opens the ${action === "openTask" ? "System.WorkflowUserTask" : "System.Workflow"} of the data view around it, and ops cannot build data views of System entities; call a microflow with the action ${action === "openTask" ? "openUserTask" : "openWorkflow"} instead (or add the button in Studio Pro)`);
        const allowed = ACTION_FIELDS[action];
        for (const k of Object.keys(spec)) {
            if (k === "action" || allowed.includes(k)) continue;
            if (FLOW_ONLY[k]) throw new Error(`${where}: ${k} goes with ${FLOW_ONLY[k]}, not ${action}${k === "confirm" && ["delete", "save", "create", "showPage"].includes(action) ? `; for a ${action} with a question call a microflow or nanoflow that does it ("action": "callMicroflow", "confirm": { ... })` : ""}`);
            throw new Error(`${where}: '${k}' does not go with action ${action} (it takes ${allowed.join(", ") || "nothing else"})`);
        }
        require("./ops-native-ui").checkAction(client, model, ctx && ctx.page, action, spec, where);
        const need = { showPage: "page", callMicroflow: "microflow", callNanoflow: "nanoflow", callWorkflow: "workflow" }[action];
        if (need && !spec[need]) throw new Error(`${where}: action ${action} needs '${need}'`);
        if (spec.maintainSelection !== undefined && !opts.grid) throw new Error(`${where}: maintainSelection goes with a grid button (classic or template grid control bar) that calls a flow`);
        const node = { where, container: at.container, spec, name: at.name, selectionList: at.selectionList };
        let a, text;
        const extra = [];
        if (action === "save" || action === "cancel" || action === "delete") {
            a = (action === "save" ? pages.SaveChangesClientAction : action === "cancel" ? pages.CancelChangesClientAction : pages.DeleteClientAction).create(model);
            assign(a);
            a.closePage = bool(spec.closePage, opts.closePage !== undefined ? opts.closePage : false);
            text = `${action}${a.closePage ? ", closes the page" : ""}`;
        } else if (action === "close") {
            assign((a = pages.ClosePageClientAction.create(model)));
            text = "close page";
        } else if (action === "signOut") {
            assign((a = pages.SignOutClientAction.create(model)));
            text = "sign out";
            if (!await hasClientAction("Forms$SignOutClientAction")) client.warnFirst(`Forms$SignOutClientAction first use in this project (Studio Pro 11.14 sample: menu item): check ${ctx.qn} in Studio Pro`);
        } else if (action === "sync") {
            const why = await offlineProfile();
            if (!why) throw new Error(`${where}: sync synchronizes an offline-first app; this project has no offline or native navigation profile (add one in Studio Pro: App > Navigation)`);
            assign((a = pages.SyncClientAction.create(model)));
            text = `synchronize (${why})`;
            client.warnFirst(`Forms$SyncClientAction first use by ops (no Studio Pro sample): check ${ctx.qn} in Studio Pro`);
        } else if (action === "openLink") {
            const kinds = ["url", "email", "phone", "sms"].filter(k => spec[k] !== undefined);
            if (kinds.length !== 1) throw new Error(`${where}: openLink needs one of "url", "email", "phone", "sms": a text, or { "attribute": "Website" } of the object around it`);
            const k = kinds[0], v = spec[k];
            assign((a = pages.OpenLinkClientAction.create(model)));
            a.linkType = pages.LinkType[{ url: "Web", email: "Email", phone: "Call", sms: "Text" }[k]];
            const addr = a.address || pages.StaticOrDynamicString.createInOpenLinkClientActionUnderAddress(a);
            if (v && typeof v === "object" && !Array.isArray(v)) {
                for (const x of Object.keys(v)) if (x !== "attribute") fail(`${where}: ${k} is a text or { "attribute": ... }`, x, ["attribute"]);
                const obj = objectsAround(node)[0];
                if (!obj) throw new Error(`${where}: ${k} { "attribute": ... } is an attribute of the object around the widget, and it is in no data view or list item; give a text`);
                const path = pathOf(obj.ent, String(v.attribute), `${where}: ${k}`);
                if (typeOf(path.attr) !== "String") throw new Error(`${where}: ${k}: ${path.text} is ${typeOf(path.attr)}; the link is a String attribute`);
                addr.isDynamic = true;
                addr.attributeRef = attrRefOf(path);
                text = `open ${k} from ${path.text}`;
            } else {
                const val = String(v).trim();
                if (!val) throw new Error(`${where}: ${k} is empty`);
                if (k === "url" && !/^[a-z][\w+.-]*:/i.test(val)) client.warn(`${where}: url '${val}' has no scheme; the browser opens it relative to the app (write https://${val})`);
                if (k === "email" && !/@/.test(val)) client.warn(`${where}: email '${val}' has no @`);
                addr.isDynamic = false;
                addr.value = val;
                text = `open ${k} ${val}`;
            }
        } else if (action === "showPage") {
            const page = await h.get(spec.page);
            if (!(page instanceof pages.Page)) throw new Error(`${where}: '${spec.page}' is not a page`);
            const mapped = await mapParams(spec.params, pageParams(page), node, ctx, spec.page, "page");
            assign((a = pages.PageClientAction.create(model)));
            a.pageSettings.page = page;
            writeMappings(a.pageSettings.parameterMappings, mapped, "page", node, ctx);
            text = `opens ${spec.page}${mapText(mapped)}`;
            extra.push(...(await pageExtras(a, a.pageSettings, spec, where, ctx)));
        } else if (action === "create") {
            text = await createAction(spec, node, ctx, where, x => assign((a = x)));
            extra.push(...(await pageExtras(a, a.pageSettings, spec, where, ctx)));
        } else if (action === "callWorkflow") {
            const wf = await h.get(spec.workflow);
            if (!(wf instanceof sdk.workflows.Workflow)) throw new Error(`${where}: '${spec.workflow}' is not a workflow`);
            const cqn = wf.parameter && wf.parameter.entityQualifiedName;
            const obj = objectsAround(node)[0];
            if (!obj) throw new Error(`${where}: callWorkflow starts ${wf.qualifiedName} for the object of the data view or list item around it (its context ${cqn || "entity"}); this widget is in none`);
            if (cqn && !isA(obj.ent, cqn)) throw new Error(`${where}: ${wf.qualifiedName} takes a ${cqn} as context; the object around it is ${obj.ent.qualifiedName} (${obj.name})`);
            assign((a = pages.CallWorkflowClientAction.create(model)));
            a.workflow = wf;
            a.closePage = bool(spec.closePage, false);
            text = `starts workflow ${wf.qualifiedName} for the ${obj.ent.name}${a.closePage ? ", closes the page" : ""}`;
            client.warnFirst(`Forms$CallWorkflowClientAction first use by ops (no Studio Pro sample in the test projects): check ${ctx.qn} in Studio Pro`);
            if (spec.confirm !== undefined) extra.push(await confirmInto(a, spec.confirm, where, ctx));
        } else {
            const nano = action === "callNanoflow";
            const { f, params } = await flowParams(spec[need], nano ? mf.Nanoflow : mf.Microflow, need, node);
            const mapped = await mapParams(spec.params, params, node, ctx, f.qualifiedName, "flow");
            assign((a = (nano ? pages.CallNanoflowClientAction : pages.MicroflowClientAction).create(model)));
            const settings = nano ? a : a.microflowSettings;
            if (nano) a.nanoflow = f;
            else a.microflowSettings.microflow = f;
            writeMappings(nano ? a.parameterMappings : a.microflowSettings.parameterMappings, mapped, nano ? "nanoflow" : "microflow", node, ctx);
            text = `calls ${f.qualifiedName}${mapText(mapped)}`;
            if (spec.confirm !== undefined) extra.push(await confirmInto(settings, spec.confirm, where, ctx));
            if (spec.progress !== undefined || spec.progressMessage !== undefined) {
                const raw = spec.progress !== undefined ? String(spec.progress) : "blocking";
                const pb = { none: "None", nonblocking: "NonBlocking", blocking: "Blocking" }[raw.toLowerCase().replace(/[\s_-]/g, "")];
                if (!pb) fail(`${where}: progress '${raw}' is not known (use none | nonBlocking | blocking)`, raw, ["none", "nonBlocking", "blocking"]);
                settings.progressBar = pages.ProgressBarType[pb];
                if (spec.progressMessage !== undefined) {
                    if (pb === "None") throw new Error(`${where}: progressMessage goes with progress nonBlocking or blocking`);
                    if (!settings.progressMessage) settings.progressMessage = sdk.texts.Text.create(model);
                    await textAll(settings.progressMessage, String(spec.progressMessage), ctx);
                }
                extra.push(`progress ${pb}${spec.progressMessage !== undefined ? ` "${spec.progressMessage}"` : ""}`);
                if (pb !== "None") client.warnFirst(`Forms progress bar first use by ops (no Studio Pro sample sets one): check ${ctx.qn} in Studio Pro`);
            }
            if (spec.abortOnValidationErrors !== undefined) {
                const v = spec.abortOnValidationErrors;
                const fv = v === true || v === "true" || /^all$/i.test(String(v)) ? "All" : v === false || v === "false" || /^none$/i.test(String(v)) ? "None" : /^widgets?$/i.test(String(v)) ? "Widget" : null;
                if (!fv) fail(`${where}: abortOnValidationErrors is true (all), "widget" (this widget's) or false`, String(v), ["true", "widget", "false"]);
                a.microflowSettings.formValidations = pages.FormValidations[fv];
                extra.push(fv === "All" ? "aborts on validation errors" : fv === "Widget" ? "aborts on this widget's validation errors" : "ignores validation errors");
            }
            if (spec.maintainSelection !== undefined) {
                opts.grid.maintainSelectionAfterMicroflow = bool(spec.maintainSelection, false);
                extra.push(opts.grid.maintainSelectionAfterMicroflow ? "keeps the selection" : "clears the selection");
            }
        }
        if (!opts.button) a.disabledDuringExecution = false; // as Studio Pro stores on-click / on-change actions
        return text + (extra.length ? `; ${extra.join("; ")}` : "");
    }
    const ACTION_DOC = `{ "action": ${ACTION_LIST.filter(x => !/^open(Task|Workflow)$/.test(x)).join(" | ")}, ... }: showPage "page" (+ "params", "pageTitle"); callMicroflow / callNanoflow "microflow" / "nanoflow" (+ "params", "confirm": { "question", "proceed", "cancel" }, "progress": none | nonBlocking | blocking, "progressMessage", "abortOnValidationErrors" (microflow), "maintainSelection" (grid buttons)); create "entity" + "page" (the new object; "association": Module.Assoc links it to the object around it; "pageTitle"); openLink "url" | "email" | "phone" | "sms": text or { "attribute": ... }; save | cancel | delete ("closePage"); close; signOut; sync (offline apps); callWorkflow "workflow" (+ "confirm", "closePage")`;

    // "confirm" of a flow / workflow call: true, a question, or { question, proceed, cancel } (texts per language allowed)
    async function confirmInto(owner, c, where, ctx) {
        if (c === false || c === "false") return "no confirmation";
        const o = c === true || c === "true" ? {} : typeof c === "string" ? { question: c } : c;
        if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error(`${where}: confirm is true, a question, or { "question": "Delete it?", "proceed": "Delete", "cancel": "Keep" }`);
        for (const k of Object.keys(o)) if (!["question", "proceed", "cancel"].includes(k)) fail(`${where}: unknown field '${k}' in confirm`, k, ["question", "proceed", "cancel"]);
        const ci = pages.ConfirmationInfo.create(model);
        owner.confirmationInfo = ci;
        const q = o.question !== undefined ? String(o.question) : "Are you sure?";
        await textAll(ci.question, q, ctx);
        await textAll(ci.proceedButtonCaption, o.proceed !== undefined ? String(o.proceed) : "Proceed", ctx);
        await textAll(ci.cancelButtonCaption, o.cancel !== undefined ? String(o.cancel) : "Cancel", ctx);
        client.warnFirst(`Forms$ConfirmationInfo first use by ops (no Studio Pro sample asks a confirmation): check ${ctx.qn} in Studio Pro`);
        return `asks "${q}"`;
    }

    // "pageTitle" (a title instead of the page's own) and "closePage" (close this page first) of a showPage / create
    async function pageExtras(a, ps, spec, where, ctx) {
        const out = [];
        if (spec.pageTitle !== undefined) {
            if (!has(ps, "titleOverride")) throw new Error(`${where}: this Mendix version has no page title override`);
            const t = mf.TextTemplate.create(model);
            ps.titleOverride = t;
            noPlaceholder(spec.pageTitle, `${where}: pageTitle`);
            await textAll(t.text, String(spec.pageTitle), ctx);
            out.push(`title "${spec.pageTitle}"`);
        }
        if (spec.closePage !== undefined && spec.closePage !== false && spec.closePage !== "false") {
            const n = spec.closePage === true || spec.closePage === "true" ? 1 : Number(spec.closePage);
            if (!Number.isInteger(n) || n < 1) throw new Error(`${where}: closePage is true or a number of pages to close first`);
            a.numberOfPagesToClose2 = String(n);
            out.push(`closes ${n} page${n > 1 ? "s" : ""} first`);
            client.warnFirst(`NumberOfPagesToClose2 first use by ops (no Studio Pro sample closes pages before opening one): check ${ctx.qn} in Studio Pro`);
        }
        return out;
    }

    // create: a new object of entity (optionally linked over association to the object around it) shown on page
    async function createAction(spec, node, ctx, where, assign) {
        if (!spec.page) throw new Error(`${where}: create needs "page": the page that shows the new object (one parameter of its entity)`);
        const page = await h.get(spec.page);
        if (!(page instanceof pages.Page)) throw new Error(`${where}: '${spec.page}' is not a page`);
        const ps = pageParams(page);
        let ent = spec.entity !== undefined ? await entityOf(String(spec.entity), where) : ps.length === 1 && ps[0].entity ? await entityOf(ps[0].entity, where).catch(() => null) : null;
        if (!ent) throw new Error(`${where}: create needs "entity" (Module.Entity)`);
        if (ps.length !== 1 || !ps[0].entity || !isA(ent, ps[0].entity)) throw new Error(`${where}: create opens a page with one parameter of ${ent.qualifiedName} (it gets the new object); ${spec.page} has ${ps.map(p => `${p.name} (${p.type})`).join(", ") || "none"}`);
        if (!h.persistable(ent) && spec.association === undefined) client.warn(`${where}: ${ent.qualifiedName} is non-persistable; the new object lives only while the page is open`);
        const a = pages.CreateObjectClientAction.create(model);
        assign(a);
        let how = `new ${ent.name}`;
        if (spec.association !== undefined) {
            const obj = objectsAround(node)[0];
            if (!obj) throw new Error(`${where}: association links the new ${ent.name} to the object of the data view or list item around the button, and it is in none`);
            const all = await allAssociations(ctx);
            const qn = String(spec.association);
            const cands = all.filter(x => (x.qualifiedName === qn || x.name === qn));
            const links = x => (isA(ent, ends(x).from) && isA(obj.ent, ends(x).to)) || (isA(obj.ent, ends(x).from) && isA(ent, ends(x).to));
            const asc = cands.find(links);
            const mine = all.filter(links).map(x => x.qualifiedName);
            if (!asc) {
                if (cands.length) throw new Error(`${where}: ${cands[0].qualifiedName} links ${ends(cands[0]).from} and ${ends(cands[0]).to}, not the new ${ent.name} and the ${obj.ent.name} around it${mine.length ? ` (associations between them: ${mine.join(", ")})` : ""}`);
                fail(`${where}: no association '${qn}'${mine.length ? ` (between ${ent.name} and ${obj.ent.name}: ${mine.join(", ")})` : ` (${ent.name} and ${obj.ent.name} have none)`}`, qn, mine);
            }
            const ref = dm.IndirectEntityRef.createInCreateObjectClientActionUnderEntityRef(a);
            const st = dm.EntityRefStep.createIn(ref);
            st.association = asc;
            st.destinationEntity = ent;
            how += ` linked to the ${obj.ent.name} of ${obj.name} over ${asc.name}`;
            client.warnFirst(`Forms$CreateObjectClientAction over an association: first use by ops (Studio Pro samples create plain objects): check ${ctx.qn} in Studio Pro`);
        } else {
            dm.DirectEntityRef.createInCreateObjectClientActionUnderEntityRef(a).entity = ent;
        }
        a.pageSettings.page = page;
        return `${how}, opens ${spec.page}`;
    }

    // a navigation profile that synchronizes: an offline web profile or a native one (its name), else ""
    async function offlineProfile() {
        const doc = model.allNavigationDocuments()[0];
        if (!doc) return "";
        const nav = await doc.load();
        const p = nav.profiles.find(x => !(x instanceof navigation.NavigationProfile) || /offline/i.test(x.kind ? x.kind.name : ""));
        return p ? `${p.name} profile` : "";
    }
    // a client action type Studio Pro saved in this project
    const sampled = new Map();
    async function hasClientAction(type) {
        if (!sampled.has(type)) {
            let hit = false;
            for (const id of client.project.units.keys()) {
                const u = client.project.read(id);
                if (/^(Forms|Menus|Navigation)\$/.test(u.$Type) && JSON.stringify(u).includes(`"${type}"`)) {
                    hit = true;
                    break;
                }
            }
            sampled.set(type, hit);
        }
        return sampled.get(type);
    }

    // Writes mappings (from mapParams) into list after every widget exists (a variable may name a widget built later).
    // kind: microflow | nanoflow | page | snippet
    function writeMappings(list, mapped, kind, node, ctx) {
        if (!mapped.length) return;
        const cls = { microflow: pages.MicroflowParameterMapping, nanoflow: pages.NanoflowParameterMapping, page: pages.PageParameterMapping, snippet: pages.SnippetParameterMapping }[kind];
        ctx.after.push(() => {
            for (const m of mapped) {
                const x = cls.create(model);
                list.push(x);
                x.parameter = m.p.el;
                const flowExpr = (kind === "microflow" || kind === "nanoflow") && m.v && m.v.kind !== "selection";
                if (m.expr !== undefined || flowExpr) {
                    // flows: an expression ($currentObject, $dataView1, $Param or any), as Studio Pro stores them
                    if (kind === "page" || kind === "snippet") setIfAvailable(x, "argument", m.expr);
                    else x.expression = m.expr !== undefined ? m.expr : m.v.name;
                    continue;
                }
                const v = pages.PageVariable.create(model);
                x.variable = v; // attach first: the references are local to the page
                if (m.v.kind === "pageParameter") v.pageParameter = m.v.el || ctx.params.get(m.v.ent.qualifiedName);
                else if (m.v.kind === "snippetParameter") v.snippetParameter = m.v.el;
                else {
                    const w = m.v.node.widget;
                    if (!w) throw new Error(`${node.where}: ${m.v.name} names a widget that was not built`);
                    v.widget = w;
                }
            }
            if (kind === "page" && mapped.some(m => m.expr !== undefined)) client.warn(`Forms$PageParameterMapping first use with an argument expression (no Studio Pro sample has primitive page parameters): check ${ctx.qn} ${node.name || node.where} in Studio Pro`);
            if (kind === "snippet") client.warn(`Forms$SnippetParameterMapping first use (no Studio Pro sample maps snippet parameters explicitly): check ${ctx.qn} ${node.name || node.where} in Studio Pro`);
        });
    }
    const mapText = mapped => (mapped.length ? `(${mapped.map(m => m.text).join(", ")})` : "");

    // parameters of a page or snippet as flowParams gives them
    const pageParams = page => page.parameters.map(p => ({ name: p.name, el: p, type: typeText(p.parameterType),
        entity: p.parameterType instanceof datatypes.ObjectType ? p.parameterType.entityQualifiedName : null, list: null }));
    const typeText = t => !t ? "nothing" : t instanceof datatypes.ObjectType ? t.entityQualifiedName : t instanceof datatypes.ListType ? `List of ${t.entityQualifiedName}` : t.structureTypeName.split("$")[1].replace(/Type$/, "");

    // A flow and its parameters: [{ name, entity (object parameter), list (entity of a list parameter), type, el }].
    async function flowParams(qn, cls, kind, node) {
        const f = await h.get(qn);
        if (!(f instanceof cls)) throw new Error(`${node.where}: '${qn}' is ${f instanceof mf.Nanoflow ? "a nanoflow" : f instanceof mf.Microflow ? "a microflow" : `a ${f.structureTypeName.split("$")[1]}`}, not a ${kind}`);
        const params = f.objectCollection.objects.filter(x => x instanceof mf.MicroflowParameterObject).map(p => ({ name: p.name, el: p, type: typeText(p.variableType),
            entity: p.variableType instanceof datatypes.ObjectType ? p.variableType.entityQualifiedName : null, list: p.variableType instanceof datatypes.ListType ? p.variableType.entityQualifiedName : null }));
        return { f, params };
    }

    // ------------------------------------------------ data sources (dataView, dataGrid, listView, gallery)

    const short = qn => String(qn).split(".").pop();
    // both ends of an association: { from (owner side, parent), to }
    const ends = a => ({ from: a.parent ? a.parent.qualifiedName : null, to: a instanceof dm.CrossAssociation ? a.childQualifiedName : a.child ? a.child.qualifiedName : null });
    async function allAssociations(ctx) {
        if (ctx && ctx.assocs) return ctx.assocs;
        const out = [];
        for (const d of model.allDomainModels()) {
            const full = d.isLoaded ? d : await d.load();
            out.push(...full.associations, ...full.crossAssociations);
        }
        if (ctx) ctx.assocs = out;
        return out;
    }

    // The steps of "association" from ent: [{ assoc, to (entity) }]. One object (many false): references ent owns (a
    // path A/B), or the other side of a one-to-one; many: one reference set ent owns, or a reference to ent (reverse).
    async function assocSteps(ent, spec, where, many, ctx) {
        const names = String(spec).split("/").map(x => x.trim()).filter(Boolean);
        if (!names.length) throw new Error(`${where}: association is empty; give Module.Assoc`);
        const all = await allAssociations(ctx);
        const steps = [];
        let cur = ent;
        for (const [i, name] of names.entries()) {
            const last = i === names.length - 1;
            const mine = all.filter(a => isA(cur, ends(a).from) || isA(cur, ends(a).to)).map(a => a.qualifiedName);
            const a = all.find(x => x.qualifiedName === name);
            if (!a) fail(`${where}: no association '${name}'${mine.length ? ` (associations of ${cur.qualifiedName}: ${mine.join(", ")})` : ` (${cur.qualifiedName} has no association)`}`, name, mine);
            const { from, to } = ends(a);
            const set = a.type === dm.AssociationType.ReferenceSet, both = a.owner === dm.AssociationOwner.Both;
            const fwd = isA(cur, from), rev = isA(cur, to);
            if (!fwd && !rev) throw new Error(`${where}: ${name} links ${from} and ${to}, not the ${cur.qualifiedName} around it` + (mine.length ? `; associations of ${cur.qualifiedName}: ${mine.join(", ")}` : ""));
            let dest;
            if (many && last) {
                if (fwd && set) dest = to;
                else if (rev && !set) dest = from;
                else if (rev && set && both) dest = from;
                else if (fwd) throw new Error(`${where}: ${name} is a reference: a ${short(from)} has one ${short(to)}; show it in a dataView with "source": "association", "association": "${name}"${names.length > 1 ? " (in a path every step but the last goes to one object, the last to many)" : ""}`);
                else {
                    // the reverse of a reference set the other side owns: Studio Pro 10+ lists it in the association source
                    dest = from;
                    client.warn(`${where}: ${name} is a reference set owned by ${short(from)}, listed from the ${short(to)} side: first use by ops (no Studio Pro sample); check it in Studio Pro`);
                }
            } else {
                if (fwd && !set) dest = to;
                else if (rev && !set && both) dest = from;
                else if (set) throw new Error(`${where}: ${name} is a reference set (many ${short(fwd ? to : from)}); ${many ? "in a path every step but the last goes to one object" : `a data view shows one object: use a listView or dataGrid with "source": "association", "association": "${name}"`}`);
                else throw new Error(`${where}: ${name} goes from ${from} to ${to}: a ${short(to)} has many ${short(from)}; ${many ? "in a path every step but the last goes to one object" : `a data view shows one object: use a listView or dataGrid with "source": "association", "association": "${name}"`}`);
            }
            const other = await entityOf(dest, where).catch(() => {
                throw new Error(`${where}: ${name} leads to ${dest}, which ops cannot read (System module); use a microflow source`);
            });
            steps.push({ assoc: a, to: other });
            cur = other;
        }
        return steps;
    }

    // Associations that give the objects of list entity ent from the object around (an association source would do).
    async function listAssocs(outer, ent, ctx) {
        const all = await allAssociations(ctx);
        return all.filter(a => {
            const { from, to } = ends(a), set = a.type === dm.AssociationType.ReferenceSet;
            return (set && isA(outer, from) && isA(ent, to)) || (!set && isA(ent, from) && isA(outer, to));
        }).map(a => a.qualifiedName);
    }

    // The source a data widget node asked for (or its default); checks the fields that go with it.
    function sourceOf(n) {
        const s = n.spec, dv = n.kind === "dataView";
        const all = dv ? DV_SOURCES : LIST_SOURCES;
        let src = s.source !== undefined ? String(s.source).toLowerCase() : null;
        if (src === "entity" && dv) src = "parameter";
        if (src === "xpath" && !dv) src = "database";
        if (src !== null && !all.includes(src)) fail(`${n.where}: source '${s.source}' is not known (use ${all.join(" | ")})`, s.source, all);
        if (s.parameter !== undefined) throw new Error(`${n.where}: use "source": "parameter"`);
        const given = ["association", "microflow", "nanoflow"].filter(k => s[k] !== undefined);
        if (given.length > 1) throw new Error(`${n.where}: give one of ${given.join(", ")} (each is a source of its own)`);
        if (given.length && src && src !== given[0]) throw new Error(`${n.where}: "${given[0]}" goes with "source": "${given[0]}", not ${src}`);
        if (dv && s.listenTo !== undefined && (src || given[0]) && (src || given[0]) !== "listen") throw new Error(`${n.where}: listenTo goes with source listen, not ${src || given[0]}`);
        if (!dv && s.xpath !== undefined && (src || given[0] || "database") !== "database") throw new Error(`${n.where}: xpath goes with source database; a ${src || given[0]} source gives its own objects`);
        const out = src || given[0] || (dv ? (s.listenTo !== undefined ? "listen" : inItem(n) ? "context" : "parameter") : "database");
        if (["association", "microflow", "nanoflow"].includes(out) && (s[out] === undefined || s[out] === "")) throw new Error(`${n.where}: source ${out} needs "${out}": ${out === "association" ? "Module.Assoc" : `Module.${out === "microflow" ? "Microflow" : "Nanoflow"}`}`);
        if (out === "listen" && s.listenTo === undefined) throw new Error(`${n.where}: source listen needs listenTo (a grid or list view on this page)`);
        return out;
    }

    // A microflow / nanoflow source: { f, nano, params, ent }; the return type must be one object (data view) or a list.
    async function flowSource(n) {
        const nano = n.source === "nanoflow", dv = n.kind === "dataView";
        const { f, params } = await flowParams(String(n.spec[n.source]), nano ? mf.Nanoflow : mf.Microflow, n.source, n);
        const rt = f.microflowReturnType;
        if (dv && !(rt instanceof datatypes.ObjectType)) throw new Error(`${n.where}: ${f.qualifiedName} returns ${typeText(rt)}; a data view's ${n.source} returns one object${rt instanceof datatypes.ListType ? " (for a list: a listView or dataGrid)" : ""}`);
        if (!dv && !(rt instanceof datatypes.ListType)) throw new Error(`${n.where}: ${f.qualifiedName} returns ${typeText(rt)}; a ${n.kind}'s ${n.source} returns a list${rt instanceof datatypes.ObjectType ? " (for one object: a dataView)" : ""}`);
        const ent = await entityOf(rt.entityQualifiedName, n.where);
        if (n.spec.entity && !isA(ent, String(n.spec.entity))) throw new Error(`${n.where}: ${f.qualifiedName} returns ${typeText(rt)}, not ${n.spec.entity}; leave out entity`);
        return { f, nano, params, ent };
    }

    // Entities and data sources of the data widgets in nodes, outer before inner (an association or context needs the
    // object around it; a listening data view its target). o: { dflt (entity), extra (listen targets already on the
    // page), snippet, ctx }. prepare() first: the entity of lists that do not depend on what is around them, so that
    // names can be given in page order before anything else.
    function prepare(nodes) {
        for (const n of nodes) if (n.kind === "dataView" || LISTENS.includes(n.kind) || n.kind === "templateGrid" || (n.kind === "pluggable" && n.dsKey)) n.source = sourceOf(n);
    }
    async function listEntity(n, o) {
        if (n.ent || n.source === "association") return;
        if (n.source === "database") {
            n.ent = await entityOf(n.spec.entity || o.dflt, n.where);
            if (!h.persistable(n.ent)) throw new Error(`${n.where}: ${n.ent.qualifiedName} is non-persistable; a ${n.kind} over the database needs a persistable entity (give it a microflow / nanoflow or association source, or show it in a data view)`);
        } else {
            n.flow = await flowSource(n);
            n.ent = n.flow.ent;
        }
    }
    async function resolveSources(nodes, o) {
        const ctx = o.ctx;
        const resolve = async n => {
            if (n.done || n.existing || !n.source) return;
            if (n.resolving) throw new Error(`${n.where}: its data source depends on itself (listenTo / association go round in a circle)`);
            n.resolving = true;
            const c = n.container;
            if (c && !c.existing) await resolve(c);
            const s = n.spec, dv = n.kind === "dataView";
            const outer = c && c.ent ? c : null;
            const around = outer && (outer.name || `the ${outer.kind === "dataView" ? "data view" : outer.kind} of ${outer.ent.name}`);
            if (n.source === "listen") {
                n.target = listenTarget(n, [...nodes, ...(o.extra || []).filter(e => !nodes.some(x => x.name === e.name))]);
                await resolve(n.target);
                if (!n.target.ent) throw new Error(`${n.where}: the entity of ${n.target.name} is not known here; add this data view in Studio Pro`);
                if (s.entity && s.entity !== n.target.ent.qualifiedName) throw new Error(`${n.where}: listens to ${n.target.name} (${n.target.ent.qualifiedName}), but entity is ${s.entity}; ${MASTER_DETAIL}`);
                n.ent = n.target.ent;
                if (n.target.kind === "pluggable") {
                    const v = (n.target.pspec.properties || {})[n.target.selKey];
                    if (String(v).toLowerCase() !== "single") throw new Error(`${n.where}: listenTo ${n.target.name} needs its "${n.target.selKey}": "Single" (in its properties)`);
                }
                const sel = String(n.target.kind === "pluggable" ? "single" : n.target.spec.selection || "Single").toLowerCase();
                if ((n.target.gridKind === "datagrid2" || n.target.kind === "gallery") && sel !== "single") throw new Error(`${n.where}: listenTo needs a ${n.target.kind === "gallery" ? "gallery" : "Data grid 2"} with selection Single (${n.target.name} has ${n.target.spec.selection}); leave out "selection"`);
                if (n.target.kind === "dataGrid" && sel === "none") client.warn(`${ctx.qn}: ${n.name || "the data view"} listens to ${n.target.name}, whose selection is None; select Single so it can show a row`);
                else if (n.target.kind === "dataGrid" && /multi/.test(sel)) client.warn(`${ctx.qn}: ${n.target.name} allows multi-selection; the listening data view shows one of the selected rows (Single is usual)`);
            } else if (n.source === "parameter") {
                const item = inItem(n);
                if (item) throw new Error(`${n.where}: a data view inside ${item.name || item.kind} (a list item) cannot add a page parameter; leave out "source" to show the ${item.ent ? item.ent.name : "item"} itself ("source": "context"), or use "source": "association"`);
                n.ent = await entityOf(s.entity || o.dflt, n.where);
                // a snippet: only a parameter it has (createSnippet "parameters"); a new one would break its callers
                if (o.snippet && !(o.ctx && o.ctx.params.has(n.ent.qualifiedName))) throw new Error(`${n.where}: on a snippet a new data view cannot add a parameter (this snippet has none of ${n.ent.qualifiedName}); give it "listenTo", or "source": "context" / "association" / "microflow"`);
            } else if (n.source === "context") {
                if (!outer) throw new Error(`${n.where}: source context is the object of the data view or list item around it, and this data view is in none; use "source": "parameter", "listenTo" or "microflow"`);
                if (s.entity && !isA(outer.ent, String(s.entity))) {
                    const via = await assocBetween(outer.ent, String(s.entity), ctx);
                    throw new Error(`${n.where}: the object around it is the ${outer.ent.qualifiedName} of ${around}, not ${s.entity}` + (via.length ? `; to show the ${short(s.entity)} it refers to: "source": "association", "association": "${via[0]}"` : ""));
                }
                n.ent = outer.ent;
            } else if (n.source === "association") {
                if (!outer) throw new Error(`${n.where}: source association starts at the object of the data view or list item around it, and this ${n.kind} is in none; use ${dv ? `"source": "parameter" or "listenTo"` : `"source": "database"`}, or put it inside a data view`);
                n.path = await assocSteps(outer.ent, s.association, n.where, !dv, ctx);
                n.ent = n.path[n.path.length - 1].to;
                if (s.entity && !isA(n.ent, String(s.entity))) throw new Error(`${n.where}: ${s.association} gives ${n.ent.qualifiedName}, not ${s.entity}; leave out entity`);
            } else if (n.source === "microflow" || n.source === "nanoflow") {
                if (!n.flow) n.flow = await flowSource(n);
                n.ent = n.flow.ent;
            } else {
                await listEntity(n, o);
                // lints: a list inside an object that does not use it
                const via = outer ? await listAssocs(outer.ent, n.ent, ctx) : [];
                const xp = String(s.xpath || "");
                if (via.length && !xp) client.warn(`${ctx.qn}: ${n.name || n.kind} inside ${around} shows every ${n.ent.name} in the database; for the ${n.ent.name} objects of its ${outer.ent.name} use "source": "association", "association": "${via[0]}"`);
                else if (via.length && /\[%CurrentObject%\]/i.test(xp)) client.warn(`${ctx.qn}: ${n.name || n.kind} shows ${n.ent.name} objects by XPath [%CurrentObject%]: only committed ones; ${n.ent.name} objects created on this page stay hidden until saved. "source": "association", "association": "${via[0]}" shows them too`);
            }
            n.resolving = false;
            n.done = true;
        };
        for (const n of nodes) await resolve(n);
        // flow parameters: once every object on the page is known (a parameter may take a data view or grid elsewhere)
        for (const n of nodes) if (n.flow && n.done) n.mapped = await mapParams(n.spec.params, n.flow.params, n, ctx, n.flow.f.qualifiedName, "flow");
    }
    // associations between ent and the entity qn, either way (for messages)
    async function assocBetween(ent, qn, ctx) {
        return (await allAssociations(ctx)).filter(a => (isA(ent, ends(a).from) && ends(a).to === qn) || (isA(ent, ends(a).to) && ends(a).from === qn)).map(a => a.qualifiedName);
    }

    // Writes node's list source into owner (a classic grid / list view, or the datasource value of a pluggable widget);
    // returns how the dry run describes it.
    function listSource(node, owner, pluggableValue, ctx) {
        const s = node.spec, ent = node.ent;
        const at = (cls) => (pluggableValue ? cls.createInWidgetValueUnderDataSource(owner) : cls.createInEntityWidgetUnderDataSource(owner));
        if (node.source === "database") {
            let src;
            if (pluggableValue) src = cw.CustomWidgetXPathSource.createInWidgetValueUnderDataSource(owner);
            else {
                src = owner.dataSource; // GridXPathSource / ListViewXPathSource from Mendix 10.5 (the "Database" source in Studio Pro)
                if (!(src instanceof pages.GridXPathSource || src instanceof pages.ListViewXPathSource)) throw new Error(`${node.where}: this Mendix version gives a ${src.structureTypeName} source; only the XPath source (10.5+) is supported`);
            }
            dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = ent;
            if (s.xpath) {
                checkXPath(node, ent);
                GX().xpathVariables(String(s.xpath), ctx, node.where);
                src.xPathConstraint = String(s.xpath);
            }
            return `${ent.qualifiedName}${s.xpath ? ", XPath " + s.xpath : ""}`;
        }
        if (node.source === "association") {
            stepsInto(at(pages.AssociationSource), node.path);
            return `${ent.qualifiedName} over ${s.association} of ${node.container.name}`;
        }
        flowInto(node.source === "nanoflow" ? at(pages.NanoflowSource) : at(pages.MicroflowSource), node, ctx);
        return `${ent.qualifiedName} from ${node.source} ${node.flow.f.qualifiedName}${mapText(node.mapped || [])}`;
    }
    function stepsInto(src, steps) {
        const er = dm.IndirectEntityRef.createInEntityPathSourceUnderEntityRef(src);
        for (const st of steps) {
            const x = dm.EntityRefStep.createIn(er);
            x.association = st.assoc;
            x.destinationEntity = st.to;
        }
    }
    // a microflow / nanoflow source: the flow (parameters: implicit, as Studio Pro stores them)
    function flowInto(src, node, ctx) {
        if (node.flow.nano) src.nanoflow = node.flow.f;
        else src.microflowSettings.microflow = node.flow.f;
        writeMappings(node.flow.nano ? src.parameterMappings : src.microflowSettings.parameterMappings, node.mapped || [], node.flow.nano ? "nanoflow" : "microflow", node, ctx);
    }

    // A pluggable widget on the project's pages and snippets: { exemplars (copyable: type = installed .mpk), stale, def, reason }.
    const plCache = new Map();
    const plInfo = id => plCache.get(id) || plCache.set(id, pluggable.exemplars(client.project, id)).get(id);
    const dg2Info = () => plInfo(DATAGRID2);
    // ... only those still in the model: a plan may delete the page one sits on before it creates a page
    function plLive(id) {
        const info = plInfo(id);
        const ids = new Set(model.allUnits().map(u => u.id));
        const exemplars = info.exemplars.filter(e => ids.has(e.unitId));
        let fresh = false;
        try {
            fresh = !!(info.def && plDef(id, id));
        } catch (e) {
            fresh = false; // an .mpk this builder cannot read: copy one from the project's pages instead
        }
        const ok = fresh || exemplars.length > 0;
        return { ...info, exemplars, fresh, ok, reason: ok ? "" : info.exemplars.length && !exemplars.length ? "the pages with one to copy from are deleted earlier in this plan" : info.reason };
    }
    const dg2Live = () => plLive(DATAGRID2);
    // attribute types a Data grid 2 column can show (from widgets/*.mpk)
    function dg2Types(info) {
        const l = info.def && info.def.lines.find(x => x.startsWith("columns/attribute "));
        const m = l && / attr=([^ ]*)/.exec(l);
        return m && m[1] ? m[1].split(",") : [];
    }

    // classic | datagrid2 for a dataGrid node ("auto" picks datagrid2 when the project has a copyable one and no
    // classic-only field is used); a datagrid2 that cannot be copied is refused before anything is built.
    function gridKind(node) {
        const s = node.spec;
        const raw = s.kind !== undefined ? String(s.kind) : /^datagrid2$/i.test(String(s.widget !== undefined ? s.widget : s.type)) ? "datagrid2" : "classic";
        const asked = { classic: "classic", datagrid: "classic", datagrid1: "classic", datagrid2: "datagrid2", dg2: "datagrid2", auto: "auto" }[raw.toLowerCase().replace(/[\s_-]/g, "")];
        if (!asked) fail(`${node.where}: kind '${raw}' is not known (use classic | datagrid2 | auto)`, raw, ["classic", "datagrid2", "auto"]);
        const cols = Array.isArray(s.columns) ? s.columns : [];
        const numWidth = c => c && typeof c === "object" && c.width !== undefined && /^\d+$/.test(String(c.width));
        const dg2Set = Object.keys(gridExtras.COLUMN_SETTINGS).filter(k => k !== "class" && k !== "width");
        const dg2Only = [cols.some(c => c && typeof c === "object" && (c.widgets !== undefined || c.dynamicText !== undefined)) && "dynamic text / custom content columns", s.onClick !== undefined && "onClick",
            ...["filters", "headerFilters", "paging", "selectionMethod", "rowClass", "configAttribute", "export"].filter(k => s[k] !== undefined), cols.some(c => c && typeof c === "object" && c.filter !== undefined) && "column filter",
            ...dg2Set.filter(k => cols.some(c => c && typeof c === "object" && c[k] !== undefined)).map(k => `column ${k}`), cols.some(c => c && typeof c === "object" && c.width !== undefined && !numWidth(c)) && "column width autoFill / autoFit / manual"].filter(Boolean);
        const dg2Asked = /^(datagrid2|dg2)$/i.test(String(s.kind !== undefined ? s.kind : s.widget !== undefined ? s.widget : s.type).replace(/[\s_-]/g, ""));
        const classicOnly = [(Array.isArray(s.search) || bool(s.search, false)) && "search", !dg2Asked && cols.some(numWidth) && "column width", s.buttons !== undefined && "control bar buttons",
            s.selection !== undefined && !/^(single|multi|none)$/i.test(String(s.selection)) && `selection ${s.selection}`].filter(Boolean);
        node.kindAsked = asked;
        node.gridKind = "classic";
        if (asked === "classic" && dg2Only.length) throw new Error(`${node.where}: ${dg2Only.join(" and ")} ${dg2Only.length > 1 ? "work" : "works"} only with a Data grid 2 ("kind": "datagrid2"); a classic grid shows attributes and has control bar "buttons"`);
        if (dg2Only.length && classicOnly.length) throw new Error(`${node.where}: ${dg2Only.join(", ")} (Data grid 2) and ${classicOnly.join(", ")} (classic) do not go together`);
        if (asked === "classic") return;
        const info = dg2Live();
        if (bool(s.selectFirst, false) && info.def && !info.def.lines.some(l => l.startsWith("autoSelect "))) classicOnly.push(`selectFirst (Data grid 2 ${info.def.version} has no autoSelect)`);
        if (asked === "datagrid2") {
            if (!info.ok) throw new Error(`${node.where}: "kind": "datagrid2" is not possible here: ${info.reason}. Use "kind": "classic" (a classic Data grid, works in every project)`);
            if (classicOnly.length) throw new Error(`${node.where}: ${classicOnly.join(", ")} ${classicOnly.length > 1 ? "work" : "works"} only with "kind": "classic" (a Data grid 2 gets column filters in Studio Pro; its selection is Single, Multi or None)`);
        }
        // auto: columns a Data grid 2 cannot show (HashedString, ...) make it a classic grid
        if (asked === "auto" && info.ok && !classicOnly.length && Array.isArray(s.columns) && node.ent) {
            try {
                dg2Cols(node, dg2Types(info));
            } catch (e) {
                const m = /cannot show '([^']+)' \(([^)]+)\)/.exec(e.message);
                classicOnly.push(m ? `column ${m[1]} (${m[2]})` : e.message.slice(node.where.length + 2));
            }
        }
        if (asked === "auto" && dg2Only.length && !info.ok) throw new Error(`${node.where}: ${dg2Only.join(" and ")} need a Data grid 2, which is not possible here: ${info.reason}`);
        if (info.ok && !classicOnly.length) node.gridKind = "datagrid2";
        else node.autoWhy = info.ok ? `${classicOnly.join(", ")} ${classicOnly.length > 1 ? "are" : "is"} classic only` : info.reason;
    }

    // ------------------------------------------------ conditions (visible / editable)

    function exprCheck(expr, dc, where) {
        const e = String(expr);
        if (!e.trim()) throw new Error(`${where}: the expression is empty`);
        if (/\$currentObject/i.test(e) && !dc) throw new Error(`${where}: $currentObject is the object of the data view or list view around the widget, and it is in none`);
        if (!dc) return;
        const chain = h.attributeChain(dc.ent);
        const d = dc.ent.containerAsDomainModel;
        const assocs = [...d.associations, ...d.crossAssociations].map(a => a.qualifiedName);
        for (const m of e.matchAll(/\$currentObject\/([A-Za-z_][\w.]*)/gi)) {
            const step = m[1];
            if (step.includes(".")) {
                if (!step.startsWith("System.") && !model.findAssociationBaseByQualifiedName(step)) fail(`${where}: no association '${step}'`, step, assocs);
            } else if (!chain.attributes.some(a => a.name === step)) {
                const s = suggest(step, chain.attributes.map(a => a.name), 3);
                if (!chain.complete) client.warn(`${where}: '${step}' is no attribute of ${dc.ent.qualifiedName} itself (inherited from a System entity?${s.length ? ` or did you mean ${s.join(", ")}?` : ""}); check the expression in Studio Pro`);
                else fail(`${where}: ${dc.ent.qualifiedName} has no attribute '${step}' (in $currentObject/${step})`, step, chain.attributes.map(a => a.name));
            }
        }
    }

    // { attribute (dm.Attribute|null), values: [[value, on]], expression } of a visible/editable spec; text = for messages
    async function condition(spec, dc, where, what) {
        if (typeof spec === "string") {
            exprCheck(spec, dc, where);
            return { attribute: null, values: [], expression: spec, text: `${what} if ${spec}` };
        }
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: ${what} is true, false, an expression "$currentObject/Active", or { "attribute": "Status", "values": ["Open"] }`);
        const ckeys = what === "visible" ? ["attribute", "values", "expression", "roles"] : ["attribute", "values", "expression"];
        for (const k of Object.keys(spec)) if (!ckeys.includes(k)) fail(`${where}: unknown field '${k}' in ${what}${k === "roles" ? " (module roles: only for visible)" : ""}`, k, ckeys);
        if (spec.roles !== undefined) {
            // visible for these module roles (Studio Pro: "Visible ... Module roles"), with or without a condition
            const roles = [].concat(spec.roles).map(String);
            if (!roles.length) throw new Error(`${where}: roles needs at least one module role, e.g. ["Sales.Manager"]`);
            const known = [];
            for (const ms of model.allModuleSecurities()) {
                const l = ms.isLoaded ? ms : await ms.load();
                for (const r of l.moduleRoles) known.push(r);
            }
            const picked = roles.map(r => known.find(x => x.qualifiedName === r) || fail(`${where}: ${what}: no module role '${r}'`, r, known.map(x => x.qualifiedName)));
            const rest = { ...spec };
            delete rest.roles;
            const c = Object.keys(rest).length ? await condition(rest, dc, where, what) : { attribute: null, values: [], expression: "", text: what };
            c.roles = picked;
            c.text = `${c.text === what ? what : c.text} for ${roles.join(" or ")}`;
            return c;
        }
        if (spec.expression !== undefined) {
            if (spec.attribute !== undefined) throw new Error(`${where}: ${what}: give attribute or expression, not both`);
            return condition(String(spec.expression), dc, where, what);
        }
        if (spec.attribute === undefined) throw new Error(`${where}: ${what} needs "attribute" (with "values") or "expression"`);
        if (!dc) throw new Error(`${where}: ${what} by attribute needs a data view or list view around the widget; use an expression`);
        if (!String(spec.attribute).includes("/") && !h.attributeChain(dc.ent).attributes.some(a => a.name === String(spec.attribute)) && !h.attributeChain(dc.ent).complete) {
            throw new Error(`${where}: '${spec.attribute}' is not an attribute of ${dc.ent.qualifiedName} itself (inherited from a System entity?); use an expression: "$currentObject/${spec.attribute}"`);
        }
        const path = pathOf(dc.ent, String(spec.attribute), where);
        const attr = path.attr;
        const t = attr.type;
        let all;
        if (t instanceof dm.BooleanAttributeType) all = ["true", "false"];
        else if (t instanceof dm.EnumerationAttributeType) {
            const en = t.enumeration.isLoaded ? t.enumeration : await t.enumeration.load();
            all = en.values.map(v => v.name);
        } else throw new Error(`${where}: ${what} by attribute needs a Boolean or enumeration attribute; ${attr.name} is ${t.structureTypeName.split("$")[1].replace("AttributeType", "")}. Use an expression, e.g. "$currentObject/${attr.name} != empty"`);
        let want = spec.values === undefined ? (all[0] === "true" ? ["true"] : null) : [].concat(spec.values).map(String);
        if (!want) throw new Error(`${where}: ${what}: give "values" of ${attr.name}, e.g. ["${all[0]}"] (values: ${all.join(", ")})`);
        for (const v of want) if (!all.includes(v)) fail(`${where}: ${what}: '${v}' is no value of ${attr.name}`, v, all);
        if (path.steps.length) {
            // Studio Pro conditions by attribute take the object's own attributes: over references it is an expression
            const x = `$currentObject/${path.steps.map(st => st.assoc.qualifiedName).join("/")}/${attr.name}`;
            const en = t instanceof dm.EnumerationAttributeType ? t.enumerationQualifiedName : null;
            const expr = want.length === all.length ? "true" : en ? want.map(v => `${x} = ${en}.${v}`).join(" or ") : want[0] === "true" ? x : `not(${x})`;
            return { attribute: null, values: [], expression: expr, text: `${what} if ${path.text} = ${want.join(" or ")} (as the expression ${expr}: a condition by attribute takes the object's own attributes)` };
        }
        return { attribute: attr, values: all.map(v => [v, want.includes(v)]), expression: "", text: `${what} if ${attr.name} = ${want.join(" or ")}` };
    }

    const sameCondition = (s, c) => !!s && (s.attributeQualifiedName || null) === (c.attribute ? c.attribute.qualifiedName : null) && s.expression === c.expression &&
        (!has(s, "moduleRoles") || s.moduleRolesQualifiedNames.join() === (c.roles || []).map(r => r.qualifiedName).join()) &&
        s.conditions.length === c.values.length && s.conditions.every((x, i) => x.attributeValue === c.values[i][0] && x.editableVisible === c.values[i][1]);

    // Fills ConditionalVisibility/EditabilitySettings s from condition c.
    function fill(s, c) {
        if (c.roles || (has(s, "moduleRoles") && s.moduleRoles.length)) {
            const want = (c.roles || []).map(r => r.qualifiedName);
            if (s.moduleRolesQualifiedNames.join() !== want.join()) {
                s.moduleRoles.clear();
                for (const r of c.roles || []) s.moduleRoles.push(r);
            }
            if (c.roles) client.warn("Forms$ConditionalVisibilitySettings with module roles: first use by ops (no Studio Pro sample in the test projects); check it in Studio Pro");
        }
        if ((s.attributeQualifiedName || null) !== (c.attribute ? c.attribute.qualifiedName : null)) s.attribute = c.attribute;
        if (s.expression !== c.expression) s.expression = c.expression;
        // the same values: only the on/off flags change (as when one ticks them in Studio Pro)
        if (s.conditions.length === c.values.length && s.conditions.every((x, i) => x.attributeValue === c.values[i][0])) {
            s.conditions.forEach((x, i) => x.editableVisible !== c.values[i][1] && (x.editableVisible = c.values[i][1]));
            return;
        }
        if (s.conditions.length) s.conditions.clear();
        for (const [value, on] of c.values) {
            const x = enumerations.Condition.create(model);
            s.conditions.push(x);
            x.attributeValue = value;
            x.editableVisible = on;
        }
    }

    // ------------------------------------------------ widget builders

    // A client template from text: {Attribute} or {Assoc/Attribute} -> {1}, ... with one parameter each (format:
    // { "<attribute or path>": { decimals, groupDigits, date } } per parameter)
    async function textTemplate(ct, text, node, ctx, format) {
        noPlaceholder(text, node.where);
        const used = [];
        const out = String(text).replace(TEMPLATE_RE, (m, attr) => {
            if (!used.includes(attr)) used.push(attr);
            return `{${used.indexOf(attr) + 1}}`;
        });
        if (used.length && !node.container) throw new Error(`${node.where}: {${used[0]}} needs a dataView or listView around the text`);
        const fmt = format === undefined ? {} : format;
        if (!fmt || typeof fmt !== "object" || Array.isArray(fmt)) throw new Error(`${node.where}: format of a text is { "<Attribute>": { "decimals": 2, "groupDigits": true, "date": "date" } } per {Attribute} in it`);
        for (const k of Object.keys(fmt)) if (!used.includes(k)) fail(`${node.where}: format '${k}' is no {Attribute} of the text`, k, used);
        const paths = used.map(name => pathOf(node.container.ent, name, node.where));
        for (const [i, p] of paths.entries()) {
            const x = pages.ClientTemplateParameter.create(model);
            ct.parameters.push(x);
            x.attributeRef = attrRefOf(p);
            if (fmt[used[i]] !== undefined) formatInto(x, p.attr, fmt[used[i]], `${node.where}: format.${used[i]}`);
        }
        await textAll(ct.template, out, ctx);
        return paths;
    }

    // "format" of a number or date value (FormattingInfo of a text box, date picker, grid column or {Attribute} of a
    // text): { "decimals": 2, "groupDigits": true } for numbers, { "date": "date" | "time" | "dateTime" | "<pattern>" }
    // for dates. Returns a short text.
    const FORMAT_KEYS = ["decimals", "groupDigits", "date"];
    function formatInto(owner, attr, spec, where) {
        const fi = has(owner, "formattingInfo") ? owner.formattingInfo : undefined;
        if (!fi) throw new Error(`${where}: this widget has no format`);
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${where}: format is { "decimals": 2, "groupDigits": true } (numbers) or { "date": "date" | "time" | "dateTime" | "dd-MM-yyyy" } (dates)`);
        for (const k of Object.keys(spec)) if (!FORMAT_KEYS.includes(k)) fail(`${where}: unknown format field '${k}'`, k, FORMAT_KEYS);
        const t = typeOf(attr), num = ["Integer", "Long", "Decimal", "AutoNumber"].includes(t), out = [];
        if (spec.decimals !== undefined) {
            if (t !== "Decimal") throw new Error(`${where}: decimals goes with a Decimal attribute; ${attr.name} is ${t}${num ? " (whole numbers have no decimals)" : ""}`);
            const n = Number(spec.decimals);
            if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error(`${where}: decimals is a whole number 0-20`);
            if (fi.decimalPrecision !== n) fi.decimalPrecision = n;
            out.push(`${n} decimals`);
        }
        if (spec.groupDigits !== undefined) {
            if (!num) throw new Error(`${where}: groupDigits goes with a number attribute; ${attr.name} is ${t}`);
            const on = bool(spec.groupDigits, false);
            if (fi.groupDigits !== on) fi.groupDigits = on;
            out.push(on ? "group digits" : "no digit grouping");
        }
        if (spec.date !== undefined) {
            if (t !== "DateTime") throw new Error(`${where}: date goes with a Date and time attribute; ${attr.name} is ${t}${num ? ` (numbers take "decimals" / "groupDigits")` : ""}`);
            const v = String(spec.date).trim();
            const k = { date: "Date", time: "Time", datetime: "DateTime" }[v.toLowerCase()];
            if (!v) throw new Error(`${where}: date is "date", "time", "dateTime" or a pattern such as "dd-MM-yyyy HH:mm"`);
            if (!k && !/[dMyHhmsaEw]/.test(v)) throw new Error(`${where}: date '${v}' is no format (use date | time | dateTime, or a pattern of d M y H h m s a E, e.g. "dd-MM-yyyy")`);
            fi.dateFormat = pages.DateFormat[k || "Custom"];
            if (!k) fi.customDateFormat = v;
            out.push(`date ${k ? k.toLowerCase() : `"${v}"`}`);
        }
        return out.join(", ");
    }

    // Form settings of a data view (G6): orientation (vertical = LabelWidth 0, as Studio Pro stores it), labelWidth,
    // readOnlyStyle (control | text), showFooter. Returns texts for the dry run.
    function dvSettings(dv, s, where) {
        const out = [];
        if (s.orientation !== undefined) {
            const o = String(s.orientation).toLowerCase();
            if (!["horizontal", "vertical"].includes(o)) fail(`${where}: orientation '${s.orientation}' is not known (use horizontal | vertical)`, String(s.orientation), ["horizontal", "vertical"]);
            if (o === "vertical" && s.labelWidth !== undefined) throw new Error(`${where}: labelWidth goes with orientation horizontal (vertical forms put the label above the input)`);
            if (o === "vertical") dv.labelWidth = 0;
            else if (s.labelWidth === undefined && dv.labelWidth === 0) dv.labelWidth = 3; // Studio Pro's default width
            out.push(`${o} form`);
        }
        if (s.labelWidth !== undefined) {
            const n = Number(s.labelWidth);
            if (!Number.isInteger(n) || n < 1 || n > 11) throw new Error(`${where}: labelWidth is a weight 1-11 (of 12; the input gets the rest)`);
            dv.labelWidth = n;
            out.push(`label width ${n}`);
        }
        if (s.readOnlyStyle !== undefined) {
            const v = { control: "Control", text: "Text" }[String(s.readOnlyStyle).toLowerCase()];
            if (!v) fail(`${where}: readOnlyStyle of a data view is control | text`, String(s.readOnlyStyle), ["control", "text"]);
            dv.readOnlyStyle = pages.DataViewReadOnlyStyle[v];
            out.push(`read-only style ${v.toLowerCase()}`);
        }
        if (s.showFooter !== undefined) {
            dv.showFooter = bool(s.showFooter, true);
            out.push(dv.showFooter ? "footer shown" : "no footer");
        }
        return out;
    }

    // ------------------------------------------------ page variables (Mendix 10+: Forms$LocalVariable on a page)

    const VAR_TYPES = "Boolean | Integer | Long | Decimal | String | DateTime | Enum(Module.Enumeration)";
    // createPage / changePage "variables": [{ name, type, default }] on page (or snippet); existing names change.
    async function pageVariables(page, list, where, ctx) {
        if (!has(page, "variables")) throw new Error(`${where}: page variables need Mendix 10 or newer (this project is ${client.project.version})`);
        if (!Array.isArray(list) || !list.length) throw new Error(`${where}: variables is [ { "name": "Search", "type": "String", "default": "''" } ]`);
        const out = [];
        for (const [i, v] of list.entries()) {
            const at = `${where}: variables[${i + 1}]`;
            if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${at}: a variable is { "name": ..., "type": ${JSON.stringify(VAR_TYPES)}, "default": "<expression>" }`);
            for (const k of Object.keys(v)) if (!["name", "type", "default"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["name", "type", "default"]);
            const name = validName(v.name, "variable name");
            if (page.parameters && page.parameters.some(p => p.name === name)) throw new Error(`${at}: ${name} is a parameter of the page; give the variable another name`);
            const raw = String(v.type || "");
            if (!/^(boolean|integer|long|decimal|string|datetime|enum(eration)?\s*\(\s*[\w.]+\s*\))$/i.test(raw.trim())) fail(`${at}: type '${raw}' is not possible for a page variable (use ${VAR_TYPES})`, raw, ["Boolean", "Integer", "Long", "Decimal", "String", "DateTime", "Enum(Module.Enumeration)"]);
            const t = await h.dataType(raw);
            const dflt = v.default !== undefined ? String(v.default) : { BooleanType: "false", IntegerType: "0", DecimalType: "0", StringType: "''" }[t.structureTypeName.split("$")[1]] || "empty";
            if (/^string$/i.test(raw) && v.default !== undefined && !/^'.*'$|^\$|\(|^empty$/.test(dflt.trim())) client.warn(`${at}: default ${dflt} is an expression; a text is written in quotes: '${dflt}'`);
            let lv = page.variables.find(x => x.name === name);
            const isNew = !lv;
            if (!lv) {
                lv = pages.LocalVariable.create(model);
                page.variables.push(lv);
                lv.name = name;
            }
            lv.variableType = t;
            if (lv.defaultValue !== dflt) lv.defaultValue = dflt;
            if (ctx && ctx.vars) ctx.vars.set(name, lv);
            out.push(`${isNew ? "" : "changed "}${name} (${raw}, default ${dflt})`);
        }
        client.warnFirst(`Forms$LocalVariable: page variables as the Studio Pro 10.22 / 10.24 samples (a String with default, an Integer bound to a text box): check ${ctx && ctx.qn ? ctx.qn : "the page"} in Studio Pro`);
        return `variables ${out.join(", ")}`;
    }
    // an input bound to a page variable (no attribute; Studio Pro: SourceVariable = the variable)
    async function varInput(node, target, ctx) {
        const s = node.spec, name = String(s.variable);
        const vars = ctx.vars || new Map();
        const lv = vars.get(name);
        if (!lv) fail(`${node.where}: no page variable '${name}'${vars.size ? ` (variables: ${[...vars.keys()].join(", ")})` : ` (give the page "variables": [ { "name": "${name}", "type": "String" } ])`}`, name, [...vars.keys()]);
        const kind = inputKind(node.kind, lv.variableType, name, node.where);
        const w = pages[INPUTS[kind]].create(model);
        target.push(w);
        w.name = node.name || ctx.names.next(kind);
        await inputDefaults(w, kind);
        if (kind === "textBox" || kind === "textArea") w.maxLengthCode = 0; // as Studio Pro stores a text box of a variable
        await templateAll(w, "labelTemplate", s.label !== undefined ? s.label : name, ctx, node.where);
        const pv = pages.PageVariable.createInAttributeWidgetUnderSourceVariable(w);
        pv.localVariable = lv;
        if (kind !== "textBox") client.warnFirst(`Forms$${INPUTS[kind]} of a page variable: first use by ops (the Studio Pro sample binds a text box): check ${ctx.qn} ${w.name} in Studio Pro`);
        ctx.count.inputs++;
        return w;
    }

    // An input in data view node dv (Studio Pro names: textBox1, checkBox1, ...). attr: an attribute or a path
    // (pathOf); an input over references is read-only unless "editable" says otherwise (as Studio Pro shows it).
    async function attrInput(kind, list, attr, dv, where, ctx, label, name) {
        const p = asPath(attr);
        attr = p.attr;
        const t = attr.type;
        if (t instanceof dm.BinaryAttributeType) throw new Error(`${where}: '${attr.name}' is binary; no input shows it (use an image or file widget in Studio Pro)`);
        kind = inputKind(kind, t, attr.name, where);
        const w = pages[INPUTS[kind]].create(model);
        list.push(w);
        w.name = name || ctx.names.next(kind);
        w.attributeRef = attrRefOf(p);
        if (kind === "textBox" && t instanceof dm.HashedStringAttributeType) w.isPasswordBox = true;
        await inputDefaults(w, kind);
        await templateAll(w, "labelTemplate", label || humanize(attr.name), ctx, where);
        inputSource(w, dv);
        if (p.steps.length) {
            w.editable = pages.EditableEnum.Never;
            NOTES.set(w, `read-only: ${p.text} is over ${p.steps.length > 1 ? "references" : "a reference"} (as Studio Pro shows it; "editable": true to change that)`);
        }
        ctx.count.inputs++;
        return w;
    }
    // The input kind for an attribute type ("input" picks one as Studio Pro does); refuses a kind that cannot show it.
    function inputKind(kind, t, what, where) {
        if (kind === "input") {
            if (t instanceof dm.BooleanAttributeType || t instanceof datatypes.BooleanType) kind = "checkBox";
            else if (t instanceof dm.DateTimeAttributeType || t instanceof datatypes.DateTimeType) kind = "datePicker";
            else if (t instanceof dm.EnumerationAttributeType || t instanceof datatypes.EnumerationType) kind = "radioButtons"; // what Studio Pro-saved pages use (no Forms$DropDown in 10.22-11.13)
            else if (t instanceof dm.StringAttributeType && t.length === 0) kind = "textArea";
            else kind = "textBox";
        }
        const en = t instanceof dm.EnumerationAttributeType || t instanceof datatypes.EnumerationType;
        const fits = {
            checkBox: t instanceof dm.BooleanAttributeType || t instanceof datatypes.BooleanType, datePicker: t instanceof dm.DateTimeAttributeType || t instanceof datatypes.DateTimeType, radioButtons: en, dropDown: en,
            textArea: t instanceof dm.StringAttributeType || t instanceof datatypes.StringType, textBox: true
        };
        if (!fits[kind]) throw new Error(`${where}: a ${kind} cannot show '${what}' (${t.structureTypeName.split("$")[1].replace(/(Attribute)?Type$/, "")}); use "widget": "input" to pick by type`);
        return kind;
    }
    // what Studio Pro writes for a new input of kind
    async function inputDefaults(w, kind) {
        if (kind === "radioButtons") w.renderHorizontal = true; // Studio Pro's default
        // empty messages: Studio Pro stores one empty text in the default language
        if (kind === "textArea") for (const k of ["counterMessage", "textTooLongMessage"]) if (w[k]) await h.text(w[k], "");
        if (kind === "checkBox" && w.validation) await h.text(w.validation.message, "");
    }

    // How input w refers to the object of data view dv: a parameter data view: Studio Pro writes the parameter + data
    // view; a listening data view: SourceVariable null. An existing data view (ops-page-edit) says itself.
    function inputSource(w, dv) {
        if (dv.inputVariable) return dv.inputVariable(w);
        if (dv.source !== "parameter") return;
        let v = null;
        if (w instanceof pages.AttributeWidget) v = pages.PageVariable.createInAttributeWidgetUnderSourceVariable(w);
        else w.sourceVariable = v = pages.PageVariable.create(model); // attach first: the parameter reference is local to the page
        if (dv.param instanceof pages.SnippetParameter) v.snippetParameter = dv.param;
        else v.pageParameter = dv.param;
        v.widget = dv.widget;
    }

    async function pageParameter(ent, ctx) {
        if (ctx.params.has(ent.qualifiedName)) return ctx.params.get(ent.qualifiedName);
        // a new parameter on an existing page would break every button, menu item and flow that opens it
        if (ctx.existing) throw new Error(`${ctx.qn} has no ${ctx.page instanceof pages.Snippet ? "snippet" : "page"} parameter of ${ent.qualifiedName}, and adding one would break everything that opens it. Give the data view "listenTo" (a grid or list view on the page), or put it inside a data view of ${ent.qualifiedName}`);
        const p = pages.PageParameter.createIn(ctx.page);
        let n = ent.name;
        for (let i = 2; ctx.page.parameters.some(x => x !== p && x.name === n); i++) n = ent.name + i;
        p.name = n;
        const pt = datatypes.ObjectType.create(model);
        pt.entity = ent;
        p.parameterType = pt;
        setIfAvailable(p, "isRequired", true); // 11.5+
        ctx.params.set(ent.qualifiedName, p);
        return p;
    }

    async function button(list, caption, action, style, closePage, ctx) {
        const b = pages.ActionButton.create(model);
        list.push(b);
        b.name = ctx.names.next(action === "save" ? "saveButton" : "cancelButton");
        b.buttonStyle = style;
        const cls = action === "save" ? pages.SaveChangesClientAction : pages.CancelChangesClientAction;
        cls.createInActionButtonUnderAction(b).closePage = closePage;
        await templateAll(b, "caption", caption, ctx, "", true);
        return b;
    }

    // ------------------------------------------------ Data grid 2 (built from widgets/*.mpk, else copied from the project's own pages)

    const ATTR_TYPES = { String: "String", HashedString: "HashString", AutoNumber: "AutoNumber", Boolean: "Boolean", DateTime: "DateTime",
        Decimal: "Decimal", Enumeration: "Enum", Integer: "Integer", Long: "Long", Binary: "Binary" };
    const PRIMITIVE = ["Boolean", "Integer", "Decimal", "String", "Enumeration"];

    // Writes only what differs: every SDK write is a model change, and a Data grid 2 has ~70 values to reset.
    function put(o, k, v) {
        let cur;
        try {
            cur = o[k];
        } catch (e) {
            if (/not yet available|no longer|can no longer/.test(e.message)) return;
            throw e;
        }
        if (cur !== v) setIfAvailable(o, k, v);
    }

    // A property value as Studio Pro creates it: the type's default and no model references. shape: a value of the same
    // property whose text template / translatable text (null or not) is copied as empty.
    // fresh: texts become the widget's default texts in the project's languages (as when Studio Pro drops the widget).
    async function blank(v, pt, shape, fresh) {
        const vt = pt.valueType, t = vt.type.name;
        put(v, "primitiveValue", PRIMITIVE.includes(t) ? vt.defaultValue : "");
        put(v, "expression", t === "Expression" ? vt.defaultValue : "");
        for (const k of ["attributeRef", "entityRef", "page", "microflow", "nanoflow", "image", "icon", "sourceVariable", "dataSource"]) put(v, k, null);
        for (const k of ["xPathConstraint", "entityPath", "attributePath"]) put(v, k, "");
        const sels = (vt.selectionTypes || []).map(x => x.name);
        put(v, "selection", cw.CustomWidgetSelectionType[sels.length && !sels.includes("None") ? sels[0] : "None"]);
        if (!(v.action instanceof pages.NoClientAction)) pages.NoClientAction.createInWidgetValueUnderAction(v);
        if (v.widgets.length) v.widgets.clear();
        if (v.objects.length) v.objects.clear();
        const tt = shape ? shape.textTemplate : v.textTemplate;
        if (!tt) put(v, "textTemplate", null);
        else if (shape || fresh || tt.parameters.length) v.textTemplate = pages.ClientTemplate.create(model);
        if (shape && shape.translatableValue) v.translatableValue = shape.translatableValue.deepCopy(model);
        if (fresh && t === "TextTemplate" && v.textTemplate && vt.translations.length) {
            const ls = await languages();
            const items = Object.fromEntries(vt.translations.filter(x => ls.includes(x.languageCode)).map(x => [x.languageCode, x.text]));
            if (Object.keys(items).length) await h.text(v.textTemplate.template, items);
        }
        // a required text gets the widget's own default texts (as when Studio Pro drops the widget)
        if (t === "TextTemplate" && vt.required && (!v.textTemplate || !v.textTemplate.template.translations.some(x => x.text))) {
            if (!v.textTemplate) v.textTemplate = pages.ClientTemplate.create(model);
            await h.text(v.textTemplate.template, Object.fromEntries(vt.translations.map(x => [x.languageCode, x.text])));
        }
    }

    const isPl = (el, id) => el instanceof cw.CustomWidget && !!el.type && el.type.widgetId === id;
    const isGrid2 = el => isPl(el, DATAGRID2);
    const valueOf = (obj, key) => {
        const p = obj && obj.properties.find(x => x.type && x.type.key === key);
        return p ? p.value : null;
    };

    // A new object (e.g. a column) of the given object type, every property blank, shaped like pattern (may be null).
    async function blankObject(objType, pattern) {
        const o = cw.WidgetObject.create(model);
        o.type = objType;
        for (const pt of objType.propertyTypes) {
            const p = cw.WidgetProperty.create(model);
            o.properties.push(p);
            p.type = pt;
            const v = cw.WidgetValue.create(model);
            p.value = v;
            v.type = pt.valueType;
            await blank(v, pt, valueOf(pattern, pt.key) || { textTemplate: null });
        }
        return o;
    }

    const typeOf = attr => ATTR_TYPES[attr.type.structureTypeName.split("$")[1].replace("AttributeType", "")] || "?";

    // A Data grid 2 attribute column (not attached yet), shaped like pattern (an attribute column of the same grid type).
    async function dg2Column(colType, pattern, attr, caption, ctx, where) {
        const col = await blankObject(colType, pattern);
        const show = valueOf(col, "showContentAs");
        if (show) show.primitiveValue = "attribute";
        valueOf(col, "attribute").attributeRef = attrRefOf(asPath(attr));
        const header = valueOf(col, "header");
        if (header) await templateAll(header, "textTemplate", caption, ctx, where);
        return col;
    }

    // A control bar button of a classic grid: new (opens a page with a new object), edit (the selected row), delete,
    // or a flow that gets the selected row (a List parameter: the selected rows, selection Multi).
    const GRID_BUTTONS = { new: ["newButton", "New"], edit: ["editButton", "Edit"], delete: ["deleteButton", "Delete"], callmicroflow: ["microflowButton"], callnanoflow: ["nanoflowButton"] };
    async function gridButton(grid, b, node, ctx, where) {
        if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error(`${where}: a grid button is { "action": "new" | "edit" | "delete" | "callMicroflow" | "callNanoflow" | another action of actionButton, ... }`);
        const keys = [...new Set(["caption", "style", "name", ...ACTION_KEYS])];
        for (const k of Object.keys(b)) if (!keys.includes(k)) fail(`${where}: unknown field '${k}' for a grid button`, k, keys);
        const act = String(b.action).toLowerCase().replace(/[\s_-]/g, "");
        if (/export|excel|csv/.test(act)) throw new Error(`${where}: a classic grid has no export button; a Data grid 2 ("kind": "datagrid2") takes "export": true (an Export to Excel button)`);
        const other = !GRID_BUTTONS[act] && ACTION_NAMES[act];
        const def = GRID_BUTTONS[act] || (other ? [`${other}Button`] : null);
        if (!def) fail(`${where}: grid button action '${b.action}' is not known (use new | edit | delete | callMicroflow | callNanoflow, or ${ACTION_LIST.join(" | ")})`, String(b.action), ["new", "edit", ...ACTION_LIST]);
        const caption = b.caption !== undefined ? String(b.caption) : def[1];
        if (caption === undefined) throw new Error(`${where}: a ${b.action} button needs 'caption'`);
        if ((act === "new" || act === "edit") && !b.page) throw new Error(`${where}: a ${act} button needs 'page' (a page with a parameter of ${node.ent.qualifiedName})`);
        if (act === "new") for (const k of Object.keys(b)) if (!["action", "caption", "style", "name", "page", "pageTitle"].includes(k)) throw new Error(`${where}: '${k}' does not go with a new button (it takes page, pageTitle)`);
        if (b.name !== undefined) {
            validName(b.name, "button name");
            ctx.names.reserve(String(b.name), where);
        }
        const ent = node.ent, multi = /multi/i.test(String(node.spec.selection || ""));
        let x, text;
        if (act === "new") {
            const page = await h.get(b.page);
            if (!(page instanceof pages.Page)) throw new Error(`${where}: '${b.page}' is not a page`);
            const ps = pageParams(page);
            if (b.params !== undefined || ps.length !== 1 || !ps[0].entity || !isA(ent, ps[0].entity)) throw new Error(`${where}: a new button opens a page with one parameter of ${ent.qualifiedName} (it gets the new object); ${b.page} has ${ps.map(p => `${p.name} (${p.type})`).join(", ") || "none"}`);
            x = pages.GridNewButton.create(model);
            grid.controlBar.items.push(x);
            x.entity = ent;
            x.pageSettings.page = page;
            text = `new ${ent.name}, opens ${b.page}`;
            const more = await pageExtras(null, x.pageSettings, { pageTitle: b.pageTitle }, where, ctx);
            if (more.length) text += `; ${more.join("; ")}`;
        } else {
            x = pages.GridActionButton.create(model);
            grid.controlBar.items.push(x);
            const pass = Object.fromEntries(Object.entries(b).filter(([k]) => !["action", "caption", "style", "name"].includes(k)));
            const spec = act === "edit" ? { ...pass, action: "showPage" } : { ...pass, action: other || b.action };
            if (act === "callmicroflow" || act === "callnanoflow") {
                const { params } = await flowParams(b.microflow || b.nanoflow, act === "callnanoflow" ? mf.Nanoflow : mf.Microflow, act === "callnanoflow" ? "nanoflow" : "microflow", { where });
                for (const p of params) if (p.entity && multi && isA(ent, p.entity) && !(b.params && p.name in b.params)) throw new Error(`${where}: ${node.name} has selection ${node.spec.selection}: the selected rows are a list; ${p.name} takes one ${p.entity}: make it a List parameter, or "selection": "Single"`);
            }
            if (act === "edit" && multi) throw new Error(`${where}: an edit button opens one row; ${node.name} has selection ${node.spec.selection}`);
            text = await makeAction(spec, { container: node, name: node.name, selectionList: multi ? ent : null }, ctx, where, a => (x.action = a), { grid: x });
            if (act === "edit" && !grid.controlBar.defaultButton) grid.controlBar.defaultButton = x; // Studio Pro: double-click edits
        }
        x.name = b.name !== undefined ? String(b.name) : ctx.names.next(def[0]);
        x.buttonStyle = choice(pages.ButtonStyle, b.style || "Default", "style", where);
        await templateAll(x, "caption", caption, ctx, where, b.caption === undefined);
        return `${x.name} (${text})`;
    }

    // A Data grid 2 dynamic text or custom content column (filled after the copy is checked for leftovers).
    async function dg2Other(colType, pattern, c, ctx, where) {
        const col = await blankObject(colType, pattern);
        const show = valueOf(col, "showContentAs");
        if (!show || !show.type.enumerationValues.some(e => e.key === c.kind)) throw new Error(`${where}: this Data grid 2 has no ${c.kind} columns`);
        show.primitiveValue = c.kind;
        const header = valueOf(col, "header");
        if (header && c.caption) await templateAll(header, "textTemplate", c.caption, ctx, where);
        return col;
    }

    // Fills a default column object (made with a fresh Data grid 2) for column c of dg2Cols.
    async function dg2Fill(col, c, ctx, where) {
        const show = valueOf(col, "showContentAs");
        if (c.kind !== "attribute" && (!show || !show.type.enumerationValues.some(e => e.key === c.kind))) throw new Error(`${where}: this Data grid 2 has no ${c.kind} columns`);
        if (show && show.primitiveValue !== c.kind) show.primitiveValue = c.kind;
        if (c.kind === "attribute") valueOf(col, "attribute").attributeRef = attrRefOf(c.path || asPath(c.attr));
        const header = valueOf(col, "header");
        if (header && c.caption) await templateAll(header, "textTemplate", c.caption, ctx, where);
        return col;
    }

    // onClick of a Data grid 2 or gallery: the row / item is passed (a page gets it mapped, as Studio Pro stores it)
    async function pluggableClick(node, props, ctx) {
        if (!props.has("onClick")) throw new Error(`${node.where}: this ${node.kind === "gallery" ? "gallery" : "Data grid 2"} has no onClick property`);
        const v = props.get("onClick").value;
        return makeAction(node.spec.onClick, { container: node, name: node.name }, ctx, `${node.where}: onClick`, a => (v.action = a));
    }

    // A classic grid column at the end of grid.columns; width is a weight (Studio Pro: WidthUnit Weight).
    async function classicColumn(grid, attr, caption, width, ctx) {
        const col = pages.GridColumn.create(model);
        grid.columns.push(col);
        col.name = ctx.names.next("column");
        col.attributeRef = attrRefOf(asPath(attr));
        await textAll(col.caption, caption, ctx);
        await textAll(col.aggregateCaption, "", ctx);
        col.width = width;
        return col;
    }

    // Data grid 2 columns { cols: [{ attr, caption }], dropped }: without "columns" every attribute it can show.
    function dg2Cols(node, allowed) {
        const ent = node.ent;
        const ok = attr => !allowed.length || allowed.includes(typeOf(attr));
        if (node.spec.columns === undefined) {
            const attrs = shown(ent).map(n => attributeOf(ent, n, node.where));
            return { cols: attrs.filter(ok).map(attr => ({ kind: "attribute", attr, caption: humanize(attr.name) })), dropped: attrs.filter(a => !ok(a)).map(a => `${a.name} (${typeOf(a)})`) };
        }
        const cols = list(node.spec.columns, `${node.where}.columns`).map((c, i) => {
            const s = typeof c === "string" ? { attribute: c } : c;
            const at = `${node.where} column ${i + 1}`;
            const shape = s && typeof s === "object" ? ["attribute", "dynamicText", "widgets"].filter(k => s[k] !== undefined) : [];
            if (shape.length !== 1) throw new Error(`${at}: use "Attribute", { "attribute": ..., "caption": ... }, { "dynamicText": "{Name}", "caption": ... } or { "widgets": [...], "caption": ... }`);
            const own = [shape[0], "caption", ...(shape[0] === "attribute" ? ["filter", "format"] : shape[0] === "dynamicText" ? ["format"] : []), ...Object.keys(gridExtras.COLUMN_SETTINGS)];
            if (shape[0] === "attribute" && s.format !== undefined) throw new Error(`${at}: a Data grid 2 attribute column shows the attribute with its own format; for a format use { "dynamicText": "{${s.attribute}}", "format": { "${s.attribute}": { ... } } }`);
            GX().checkColumnFields(s, own, at);
            if (shape[0] === "dynamicText") return { kind: "dynamicText", text: s.dynamicText, caption: s.caption !== undefined ? String(s.caption) : "", format: s.format, spec: s };
            if (shape[0] === "widgets") return { kind: "customContent", nodes: (node.colNodes || [])[i] || [], caption: s.caption !== undefined ? String(s.caption) : "", spec: s };
            const path = pathOf(ent, s.attribute, node.where);
            const attr = path.attr;
            if (!ok(attr)) throw new Error(`${node.where}: a Data grid 2 column cannot show '${attr.name}' (${typeOf(attr)}); it shows ${allowed.join(", ")}`);
            return { kind: "attribute", attr, path, caption: s.caption !== undefined ? String(s.caption) : humanize(attr.name), filter: s.filter, spec: s };
        });
        return { cols, dropped: [] };
    }

    // A copy of exemplar pick (a pluggable widget on the project's pages) at the end of target, named and with the
    // original's appearance, conditions and label references reset: { w, props (key -> property), doc }.
    async function copyPluggable(pick, node, target, ctx, what, alt) {
        const unit = model.allUnits().find(u => u.id === pick.unitId);
        const doc = await unit.load();
        let src = null;
        doc.traverse(el => {
            if (!src && el.id === pick.id) src = el;
        });
        if (!(src instanceof cw.CustomWidget)) throw new Error(`${node.where}: the ${what} on ${pick.unitName} could not be loaded; ${alt}`);
        const w = src.deepCopy(model);
        w.name = node.name = node.name || ctx.names.next(PREFIX[node.kind]);
        target.push(w);
        node.widget = w;
        // the copy's object must point into the copy's own type
        const root = w.object && w.object.type;
        if (!root || root.containerAsCustomWidgetType !== w.type) throw new Error(`${node.where}: copying the ${what} kept links to the original; ${alt}`);
        const ap = w.appearance;
        for (const k of ["class", "style", "dynamicClasses"]) put(ap, k, "");
        if (ap.designProperties.length) ap.designProperties.clear();
        for (const k of ["conditionalVisibilitySettings", "conditionalEditabilitySettings"]) put(w, k, null);
        put(w, "tabIndex", 0);
        if (w.labelTemplate && w.labelTemplate.parameters.length) w.labelTemplate = null;
        return { w, props: new Map(w.object.properties.map(p => [p.type.key, p])), doc };
    }

    // A new pluggable widget of id at the end of target: built from widgets/*.mpk with Studio Pro's defaults (counts:
    // { objectListKey: n } default objects made with it), or else a copy of one on the project's pages.
    // { w, props, doc (the copy's page, or null), fresh, from (for messages) }
    async function basePluggable(info, id, node, target, ctx, what, alt, counts = {}) {
        if (info.fresh) {
            const d = plDef(id, node.where);
            const langs = await languages();
            const name = node.name || ctx.names.next(PREFIX[node.kind] || plPrefix(d.type));
            const json = pluggable.widgetJson(d.xml, name, langs, t => client.catalog.keys(t));
            for (const [k, n] of Object.entries(counts)) {
                const pt = json.Type.ObjectType.PropertyTypes.find(x => x.PropertyKey === k);
                json.Object.Properties.find(x => x.TypePointer === pt.$ID).Value.Objects = Array.from({ length: n }, () => pluggable.objectJson(pt.ValueType.ObjectType, langs));
            }
            const w = sdk.createElementFromJSON(model, toSdk(json, client.schema));
            target.push(w);
            node.widget = w;
            w.name = node.name = name;
            return { w, props: new Map(w.object.properties.map(p => [p.type.key, p])), doc: null, fresh: true, from: `built from widgets/${d.file} with Studio Pro's defaults` };
        }
        const pick = info.exemplars[0];
        if (!pick) throw new Error(`${node.where}: a ${what} is not possible here: ${info.reason}; ${alt}`);
        const r = await copyPluggable(pick, node, target, ctx, what, alt);
        return { ...r, fresh: false, from: `copied from ${r.doc.qualifiedName}.${pick.name} with every setting back to its default` };
    }

    // Refuses a pluggable widget copy that still refers to something of the original: widgets, other entities and
    // attributes than those of ents, actions, page variables, documents.
    function leftovers(w, ents, where, what, alt) {
        const okAttrs = new Set(ents.flatMap(e => h.attributeChain(e).attributes.map(a => a.qualifiedName)));
        const okEnts = new Set(ents.map(e => e.qualifiedName));
        const left = [];
        w.traverse(el => {
            if (el === w) return;
            if (el instanceof pages.Widget) left.push(`widget ${el.name}`);
            else if (el instanceof dm.AttributeRef && !okAttrs.has(el.attributeQualifiedName)) left.push(el.attributeQualifiedName);
            else if (el instanceof dm.DirectEntityRef && !okEnts.has(el.entityQualifiedName)) left.push("entity path");
            else if (el instanceof dm.EntityRefStep && !okEnts.has(el.destinationEntityQualifiedName)) left.push("entity path");
            else if (el instanceof pages.ClientAction && !(el instanceof pages.NoClientAction)) left.push(el.structureTypeName);
            else if (el instanceof pages.ClientTemplateParameter || el instanceof pages.PageVariable) left.push(el.structureTypeName);
            else if (el instanceof cw.WidgetValue && (el.pageQualifiedName || el.microflowQualifiedName || el.nanoflowQualifiedName || el.imageQualifiedName)) left.push("document link");
        });
        if (left.length) throw new Error(`${where}: the ${what} copy still refers to ${[...new Set(left)].slice(0, 3).join(", ")}; ${alt}`);
    }

    // "sort": the default sort order of a database source (Forms$GridSortBar of its XPath source)
    function sortOrder(node, src, ent) {
        const s = node.spec.sort;
        if (s === undefined) return "";
        if (node.source !== "database") throw new Error(`${node.where}: sort goes with source database (a ${node.source} source gives its own order)`);
        if (!src || !src.sortBar) throw new Error(`${node.where}: this ${node.kind} has no sort order here`);
        const out = [];
        for (const [i, x] of list(Array.isArray(s) ? s : [s], `${node.where}.sort`).entries()) {
            const o = typeof x === "string" ? { attribute: x } : x;
            const at = `${node.where} sort ${i + 1}`;
            if (!o || typeof o !== "object" || o.attribute === undefined) throw new Error(`${at}: use "Attribute" or { "attribute": "Name", "direction": "asc" | "desc" }`);
            for (const k of Object.keys(o)) if (!["attribute", "direction"].includes(k)) fail(`${at}: unknown field '${k}'`, k, ["attribute", "direction"]);
            const path = pathOf(ent, String(o.attribute), at);
            const attr = path.attr;
            node.pathEnts = [...(node.pathEnts || []), ...path.steps.map(st => st.to)];
            const dir = { asc: "Ascending", ascending: "Ascending", desc: "Descending", descending: "Descending" }[String(o.direction || "asc").toLowerCase()];
            if (!dir) fail(`${at}: direction '${o.direction}' is not known (use asc | desc)`, String(o.direction), ["asc", "desc"]);
            const item = pages.GridSortItem.create(model);
            src.sortBar.sortItems.push(item);
            item.attributeRef = attrRefOf(path);
            item.sortDirection = pages.SortDirection[dir];
            out.push(`${path.text} ${dir === "Ascending" ? "asc" : "desc"}`);
        }
        return `, sorted by ${out.join(", ")}`;
    }

    // Search fields of a classic grid / template grid search bar: one per text, number or enumeration attribute
    // (Studio Pro's generated grids); asked: true or a list of attribute names.
    async function searchFields(src, ent, asked, cols, node, ctx) {
        const attrs = Array.isArray(asked) ? asked.map(a => {
            const path = pathOf(ent, String(a), node.where);
            return { attr: path.attr, path, caption: humanize(path.attr.name) };
        }) : cols;
        let fields = 0;
        for (const c of attrs) {
            const t = c.attr.type;
            const text = t instanceof dm.StringAttributeType;
            const num = [dm.IntegerAttributeType, dm.LongAttributeType, dm.DecimalAttributeType, dm.AutoNumberAttributeType].some(k => t instanceof k);
            const en = t instanceof dm.EnumerationAttributeType;
            if (!text && !num && !en) {
                if (Array.isArray(asked)) throw new Error(`${node.where}: search on ${c.attr.name} (${typeOf(c.attr)}) is not possible; search fields take text, number and enumeration attributes`);
                continue;
            }
            const f = (en ? pages.DropDownSearchField : pages.ComparisonSearchField).create(model);
            src.searchBar.items.push(f);
            f.name = ctx.names.next("searchField");
            f.attributeRef = attrRefOf(c.path || asPath(c.attr));
            f.operator = text ? pages.SearchFieldOperator.Contains : pages.SearchFieldOperator.Equal;
            await textAll(f.caption, c.caption, ctx);
            fields++;
        }
        return fields;
    }

    // Data grid 2 column filters: the filter widget per attribute type (from widgets/*.mpk)
    const FILTERS = { text: "com.mendix.widget.web.datagridtextfilter.DatagridTextFilter", number: "com.mendix.widget.web.datagridnumberfilter.DatagridNumberFilter",
        date: "com.mendix.widget.web.datagriddatefilter.DatagridDateFilter", dropdown: "com.mendix.widget.web.datagriddropdownfilter.DatagridDropdownFilter" };
    function filterKind(attr) {
        const t = typeOf(attr);
        return ["String", "HashString"].includes(t) ? "text" : ["Integer", "Long", "Decimal", "AutoNumber"].includes(t) ? "number" : t === "DateTime" ? "date" : ["Enum", "Boolean"].includes(t) ? "dropdown" : null;
    }
    async function dg2Filter(col, attr, node, ctx, where) {
        const kind = filterKind(attr);
        if (!kind) throw new Error(`${where}: no column filter for ${attr.name} (${typeOf(attr)})`);
        const fv = valueOf(col, "filter");
        if (!fv) throw new Error(`${where}: this Data grid 2 has no column filters`);
        const fnode = { kind: "pluggable", spec: { widget: "pluggable", type: FILTERS[kind] }, where: `${where} filter`, container: node.container, name: null };
        if (!pluggable.installed(client.project.dir).get(FILTERS[kind])) throw new Error(`${where}: a ${kind} filter needs widgets/${FILTERS[kind].split(".").slice(0, -1).join(".").replace(/\.\w+$/, "")}.${FILTERS[kind].split(".").pop()}.mpk (Data Widgets); install it in Studio Pro or leave out the filter`);
        plScan(fnode, node.container, []);
        await BUILD.pluggable(fnode, fv.widgets, ctx);
        return `${kind} filter ${fnode.name}`;
    }

    async function dataGrid2(node, target, ctx) {
        const ent = node.ent;
        const info = dg2Live();
        if (!info.ok) throw new Error(`${node.where}: "kind": "datagrid2" is not possible here: ${info.reason}. Use "kind": "classic"`);
        // columns first: a refused column must not leave a half-made copy on the page
        const { cols, dropped } = dg2Cols(node, dg2Types(info));
        if (!cols.length) throw new Error(`${node.where}: a Data grid 2 needs at least one column`);
        const base = await basePluggable(info, DATAGRID2, node, target, ctx, "Data grid 2", `use "kind": "classic"`, { columns: cols.length });
        const { w: grid, props } = base;
        for (const k of ["datasource", "columns", "itemSelection"]) if (!props.has(k)) throw new Error(`${node.where}: this Data grid 2 version has no '${k}' property; use "kind": "classic"`);
        const colProp = props.get("columns");
        const colType = colProp.type.valueType.objectType;
        if (dropped.length) client.warn(`${ctx.qn}: ${grid.name} leaves out ${dropped.join(", ")}: a Data grid 2 column cannot show that type (give "columns", or "kind": "classic")`);
        const made = [];
        if (base.fresh) {
            // the columns came with the widget, each at its defaults
            for (const [i, c] of cols.entries()) made.push(await dg2Fill(colProp.value.objects[i], c, ctx, node.where));
        } else {
            // columns: one per attribute, shaped like an attribute column of the original
            const olds = [...colProp.value.objects];
            const pattern = olds.find(o => (valueOf(o, "showContentAs") || {}).primitiveValue === "attribute") || olds[0] || null;
            for (const c of cols) made.push(c.kind === "attribute" ? await dg2Column(colType, pattern, c.attr, c.caption, ctx, node.where) : await dg2Other(colType, pattern, c, ctx, node.where));
            // everything else back to the widget's defaults, without the original's references
            for (const p of grid.object.properties) if (p.type.key !== "columns") await blank(p.value, p.type, null);
            colProp.value.objects.clear();
            for (const col of made) colProp.value.objects.push(col);
        }
        const shows = listSource(node, props.get("datasource").value, true, ctx);
        // selection (Single: row click, as Studio Pro's own master-detail grids)
        const selName = { single: "Single", multi: "Multi", none: "None" }[String(node.spec.selection || "Single").toLowerCase()];
        const selVal = props.get("itemSelection").value;
        if (!selVal.type.selectionTypes.some(x => x.name === selName)) throw new Error(`${node.where}: this Data grid 2 has no selection ${selName}`);
        selVal.selection = cw.CustomWidgetSelectionType[selName];
        const method = valueOf(grid.object, "itemSelectionMethod");
        if (selName === "Single" && node.spec.onClick === undefined && method && method.type.enumerationValues.some(e => e.key === "rowClick")) method.primitiveValue = "rowClick";
        if (node.spec.rows !== undefined) {
            const n = Number(node.spec.rows);
            if (!Number.isInteger(n) || n < 1) throw new Error(`${node.where}: rows must be a number >= 1`);
            valueOf(grid.object, "pageSize").primitiveValue = String(n);
        }
        if (bool(node.spec.selectFirst, false)) valueOf(grid.object, "autoSelect").primitiveValue = "true"; // checked in gridKind
        const more = [];
        const enumProp = (key, v, field) => {
            const pv = valueOf(grid.object, key);
            if (!pv) throw new Error(`${node.where}: Data grid 2 ${info.def.version} has no ${field}`);
            const all = pv.type.enumerationValues.map(e => e.key);
            const hit = all.find(k => k.toLowerCase() === String(v).toLowerCase());
            if (!hit) fail(`${node.where}: ${field} '${v}' is not known (use ${all.join(" | ")})`, String(v), all);
            pv.primitiveValue = hit;
            more.push(`${field} ${hit}`);
        };
        if (node.spec.paging !== undefined) enumProp("pagination", node.spec.paging, "paging");
        if (node.spec.selectionMethod !== undefined) {
            if (selName === "None") throw new Error(`${node.where}: selectionMethod goes with selection Single or Multi`);
            enumProp("itemSelectionMethod", node.spec.selectionMethod, "selectionMethod");
        } else if (selName === "Multi" && method) method.primitiveValue = "checkbox";
        if (node.spec.rowClass !== undefined) {
            const v = valueOf(grid.object, "rowClass");
            if (!v) throw new Error(`${node.where}: Data grid 2 ${info.def.version} has no rowClass`);
            exprCheck(String(node.spec.rowClass), { ent }, `${node.where}: rowClass`);
            v.expression = String(node.spec.rowClass);
            more.push(`row class ${node.spec.rowClass}`);
        }
        if (node.spec.configAttribute !== undefined) {
            const v = valueOf(grid.object, "configurationAttribute");
            if (!v) throw new Error(`${node.where}: Data grid 2 ${info.def.version} has no personalization attribute`);
            const dv = node.container;
            if (!dv || !dv.ent || dv.kind !== "dataView") throw new Error(`${node.where}: configAttribute is a String attribute of the data view around the grid (e.g. a settings object of the user); put the grid in such a data view`);
            const a = attributeOf(dv.ent, String(node.spec.configAttribute), node.where);
            if (typeOf(a) !== "String") throw new Error(`${node.where}: configAttribute ${a.name} is ${typeOf(a)}; it must be a String attribute (unlimited length is best)`);
            const ref = dm.AttributeRef.create(model);
            ref.attribute = a;
            v.attributeRef = ref;
            more.push(`settings in ${dv.ent.name}.${a.name}`);
        }
        const sorted = sortOrder(node, props.get("datasource").value.dataSource, ent);
        // the copy may refer to nothing but this entity (and the data view's, for the settings attribute)
        const pathEnts = cols.flatMap(c => (c.path ? c.path.steps.map(st => st.to) : []));
        leftovers(grid, [ent, ...pathEnts, ...(node.pathEnts || []), ...(node.spec.configAttribute !== undefined ? [node.container.ent] : [])], node.where, "Data grid 2", `use "kind": "classic"`);
        // what may refer to widgets, texts and actions: after the leftovers check
        const extra = [];
        for (const [i, c] of cols.entries()) {
            if (c.kind === "dynamicText") {
                const v = valueOf(made[i], "dynamicText");
                v.textTemplate = pages.ClientTemplate.create(model);
                const ps = await textTemplate(v.textTemplate, c.text, { where: `${node.where} column ${i + 1}`, container: node }, ctx, c.format);
                pathEnts.push(...ps.flatMap(x => x.steps.map(st => st.to)));
                extra.push(`dynamic text "${c.text}"`);
            } else if (c.kind === "customContent") {
                const inner = [];
                for (const ch of c.nodes) inner.push(await build(ch, valueOf(made[i], "content").widgets, ctx));
                extra.push(`custom content [${inner.join(", ")}]`);
            }
        }
        // column settings (width, alignment, ...), then the filters (by type, or over the column's association)
        const g = { grid, ent, dc: node.container && node.container.ent ? node.container : null };
        for (const [i, c] of cols.entries()) {
            const set = c.spec ? await GX().columnSettings(made[i], c.spec, g, ctx, `${node.where} column ${i + 1}`) : [];
            if (set.length) extra.push(`column ${i + 1}: ${set.join(", ")}`);
        }
        for (const [i, c] of cols.entries()) {
            if (c.kind !== "attribute") continue;
            const f = c.filter !== undefined ? c.filter : bool(node.spec.filters, false) ? true : undefined;
            const made1 = f !== undefined ? await GX().columnFilter(made[i], { ...c, filter: f }, node, ctx, `${node.where} column ${i + 1}`) : null;
            if (made1) extra.push(`column ${i + 1}: ${made1}`);
        }
        if (node.spec.headerFilters !== undefined) extra.push(...(await GX().headerFilters(grid, ent, node.spec.headerFilters, node, ctx, `${node.where}`)));
        if (node.spec.onClick !== undefined) extra.push("on click: " + (await pluggableClick(node, props, ctx)));
        if (node.spec.export !== undefined && node.spec.export !== false) extra.push(await dg2Export(node, grid, props, target, ctx));
        extra.push(...more);
        const why = node.kindAsked === "auto" ? `"kind": "auto"` : `"kind": "datagrid2"`;
        client.warnFirst(`${ctx.qn}: ${grid.name} is a Data grid 2 ${info.def.version} (${why}), ${base.from}; "kind": "classic" for a classic Data grid`);
        return `${grid.name} (Data grid 2 ${info.def.version}, ${shows}${sorted}, ${cols.length} column(s), selection ${selName}${extra.length ? "; " + extra.join("; ") : ""})`;
    }

    // "export" of a Data grid 2 (G12): Studio Pro's way (Data Widgets): a nanoflow that calls the JavaScript action
    // DataWidgets.Export_To_Excel with the grid's name, and a button in the grid's header (filtersPlaceholder) that calls it.
    const EXPORT_JS = "DataWidgets.Export_To_Excel";
    async function dg2Export(node, grid, props, target, ctx) {
        const e = node.spec.export === true || node.spec.export === "true" ? {} : node.spec.export;
        const where = `${node.where}: export`;
        if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error(`${where}: export is true or { "caption": "Export to Excel", "fileName": "Orders", "sheetName": "Orders", "headers": true }`);
        const keys = ["caption", "fileName", "sheetName", "headers", "nanoflow"];
        for (const k of Object.keys(e)) if (!keys.includes(k)) fail(`${where}: unknown field '${k}'`, k, keys);
        const js = unitNamed(EXPORT_JS);
        if (!js) throw new Error(`${where}: an export needs the JavaScript action ${EXPORT_JS} of the Data Widgets module (Marketplace); this project has none. Add Data Widgets in Studio Pro, or leave out "export"`);
        const full = js.isLoaded ? js : await js.load();
        const params = full.actionParameters.map(p => p.name);
        const [mod, pageName] = [ctx.qn.split(".")[0], ctx.qn.split(".").slice(1).join(".")];
        let flow = e.nanoflow !== undefined ? String(e.nanoflow) : `${mod}.${pageName}_${grid.name}_Export`;
        if (!flow.includes(".")) flow = `${mod}.${flow}`;
        if (unitNamed(flow)) throw new Error(`${where}: ${flow} exists already; give "nanoflow": "<a new name>"`);
        const file = e.fileName !== undefined ? String(e.fileName) : node.ent.name;
        const vals = { datagridName: `'${grid.name}'`, fileName: `'${file.replace(/'/g, "''")}'`, sheetName: `'${String(e.sheetName !== undefined ? e.sheetName : file).replace(/'/g, "''")}'`, includeColumnHeaders: String(bool(e.headers, true)), chunkSize: "100" };
        const args = Object.fromEntries(params.filter(p => vals[p] !== undefined).map(p => [p, vals[p]]));
        const missing = params.filter(p => vals[p] === undefined);
        if (missing.length) throw new Error(`${where}: ${EXPORT_JS} has parameter(s) ${missing.join(", ")} this version of ops does not know; build the export nanoflow in Studio Pro`);
        await h.createNanoflow({ module: mod, name: flow.split(".").slice(1).join("."), folder: ctx.folder, returns: "Boolean", returnValue: "$ExportSuccess",
            actions: [{ action: "callJavaScript", jsAction: EXPORT_JS, args, variable: "ExportSuccess" }] });
        (ctx.flows = ctx.flows || []).push(flow);
        const b = pages.ActionButton.create(model);
        const header = props.has("filtersPlaceholder") ? props.get("filtersPlaceholder").value.widgets : null;
        if (header) header.push(b);
        else target.push(b);
        b.name = ctx.names.next("exportButton");
        b.buttonStyle = pages.ButtonStyle.Default;
        const a = pages.CallNanoflowClientAction.createInActionButtonUnderAction(b);
        a.nanoflow = await h.get(flow);
        await templateAll(b, "caption", e.caption !== undefined ? String(e.caption) : "Export to Excel", ctx, where);
        client.warnFirst(`${ctx.qn}: ${grid.name} export: a nanoflow ${flow} calls ${EXPORT_JS} (as the Data Widgets sample page ExportingExcel); give it the page's roles (grantAccess) if they differ`);
        return `export: ${b.name} "${e.caption !== undefined ? e.caption : "Export to Excel"}" ${header ? "in its header " : ""}calls new nanoflow ${flow} (${EXPORT_JS} ${Object.entries(args).map(([k, v]) => `${k} ${v}`).join(", ")})`;
    }

    // Light XPath check: brackets, and the first step of each top-level path is an attribute or association of ent.
    const XPATH_WORDS = new Set(["and", "or", "div", "mod", "empty", "true", "false", "createdDate", "changedDate", "id"]);
    function checkXPath(node, ent) {
        const xp = String(node.spec.xpath).trim();
        if (!/^\[[\s\S]*\]$/.test(xp)) throw new Error(`${node.where}: xpath must be in brackets: [${xp.replace(/^\[|\]$/g, "")}]`);
        if (/\[%CurrentObject%\]/i.test(xp) && !node.container) throw new Error(`${node.where}: '[%CurrentObject%]' is the object of the data view or list view around this ${node.kind}, and it is in none`);
        const body = xp.replace(/'(?:[^']|'')*'/g, "''").replace(/\[%\w+%\]/g, "''");
        const chain = h.attributeChain(ent);
        const d = ent.containerAsDomainModel;
        const assocs = [...d.associations, ...d.crossAssociations].map(a => a.qualifiedName);
        let depth = 0;
        for (let i = 0; i < body.length; i++) {
            const c = body[i];
            if (c === "[") depth++;
            else if (c === "]") depth--;
            if (depth !== 1 || !/[A-Za-z_]/.test(c) || /[\w.$/\]-]/.test(body[i - 1] || "")) continue;
            const m = /^[A-Za-z_][\w.-]*(?:\/[\w.-]+)*/.exec(body.slice(i));
            i += m[0].length - 1;
            if (body.slice(i + 1).trimStart()[0] === "(") continue; // a function
            const first = m[0].split("/")[0];
            if (XPATH_WORDS.has(first) || /^\d/.test(first)) continue;
            if (first.includes(".")) {
                if (!first.startsWith("System.") && !model.findAssociationBaseByQualifiedName(first)) fail(`${node.where}: xpath: no association '${first}'`, first, assocs);
            } else if (!chain.attributes.some(a => a.name === first) && !chain.complete) {
                client.warn(`${node.where}: xpath name '${first}' is no attribute of ${ent.qualifiedName} itself (inherited from a System entity?); check the XPath in Studio Pro`);
            } else if (!chain.attributes.some(a => a.name === first)) {
                fail(`${node.where}: xpath: ${ent.qualifiedName} has no attribute '${first}' (an association is written Module.Assoc)`, first, [...chain.attributes.map(a => a.name), ...assocs]);
            }
        }
    }

    // ------------------------------------------------ helpers of the newer widget kinds

    const has = (o, k) => {
        try {
            return o[k] !== undefined;
        } catch (e) {
            return false; // not in this Mendix version
        }
    };
    const sysProps = w => (w.type && w.type.objectType ? w.type.objectType.propertyTypes.filter(pt => pt.valueType && pt.valueType.type === cw.WidgetValueTypeEnum.System).map(pt => pt.key) : []);
    const typeName = attr => attr.type.structureTypeName.split("$")[1].replace("AttributeType", "");

    // ent is (a specialization of) qn, also when qn is a System entity outside the project
    function inherits(ent, qn) {
        for (let e = ent, i = 0; e && i < 20; i++) {
            if (e.qualifiedName === qn) return true;
            const g = e.generalization;
            if (!(g instanceof dm.Generalization)) return false;
            if (g.generalizationQualifiedName === qn) return true;
            e = g.generalization && g.generalization.isLoaded ? g.generalization : null;
        }
        return false;
    }

    // A reference (one object) from ent: { assoc, other (the entity it points to, loaded) }.
    async function reference(ent, qn, where, what) {
        const d = ent.containerAsDomainModel;
        const mine = [...d.associations, ...d.crossAssociations].filter(a => a.parent === ent || (a.parent && a.parent.qualifiedName === ent.qualifiedName));
        const assoc = model.findAssociationBaseByQualifiedName(String(qn));
        if (!assoc) return fail(`${where}: no association '${qn}'${mine.length ? "" : ` (${ent.qualifiedName} has no association of its own)`}`, String(qn), mine.map(a => a.qualifiedName));
        const from = assoc.parent ? assoc.parent.qualifiedName : "?";
        const to = assoc instanceof dm.CrossAssociation ? assoc.childQualifiedName : assoc.child ? assoc.child.qualifiedName : "?";
        if (from !== ent.qualifiedName && !isA(ent, from)) {
            const s = mine.map(a => a.qualifiedName);
            throw new Error(`${where}: ${qn} goes from ${from} to ${to}; ${what} sits in a data view of ${from} (the side that owns the reference)` + (s.length ? `. References of ${ent.qualifiedName}: ${s.join(", ")}` : ""));
        }
        if (assoc.type === dm.AssociationType.ReferenceSet) throw new Error(`${where}: ${qn} is a reference set (many objects); ${what} picks one object. Use a reference set selector in Studio Pro`);
        return { assoc, other: await entityOf(to, where) };
    }

    // The attribute of other a selector shows: the named one, or the first String attribute.
    // assoc (a selector's own association): "Assoc/Name" is the same as "Name" (the path Studio Pro shows); further
    // steps are refused (a selector's attribute path follows its one association). paths: allow steps (a combo box
    // caption, linked to its options' data source).
    function captionAttr(other, name, where, types = [dm.StringAttributeType], assoc = null, paths = false) {
        if (name !== undefined) {
            let n = String(name);
            const parts = n.split("/").map(x => x.trim());
            if (assoc && parts.length > 1 && (parts[0] === assoc.qualifiedName || parts[0] === assoc.name)) n = parts.slice(1).join("/");
            if (n.includes("/") && !paths) throw new Error(`${where}: '${name}': a selector shows an attribute of the ${other.name} it selects (Studio Pro: its path follows one association, ${assoc ? assoc.name : "its own"}); give one of ${other.name}'s attributes`);
            const p = pathOf(other, n, where), a = p.attr;
            if (!types.some(t => a.type instanceof t)) throw new Error(`${where}: ${a.name} is ${typeName(a)}; the caption is a String attribute of ${p.ent.qualifiedName}`);
            return paths ? p : a;
        }
        const a = h.attributeChain(other).attributes.find(x => types.some(t => x.type instanceof t));
        if (!a) throw new Error(`${where}: ${other.qualifiedName} has no String attribute to show; give "attribute"`);
        return paths ? asPath(a) : a;
    }

    // A static image by qualified name (Module.Collection.Image), with "did you mean".
    async function imageNamed(qn, where) {
        const all = [];
        for (const c of model.allImageCollections()) {
            const col = c.isLoaded ? c : await c.load();
            for (const img of col.images) {
                const name = `${col.qualifiedName}.${img.name}`;
                if (name === qn) return img;
                all.push(name);
            }
        }
        return fail(`${where}: no image '${qn}'${all.length ? "" : " (this project has no image collection)"}`, qn, all);
    }

    // width / height of an image: 200 (pixels), "50%" (percent) or "auto"
    function imageSize(w, v, k, where) {
        if (v === undefined) return "";
        const m = /^\s*(\d+)\s*(%|px)?\s*$/i.exec(String(v));
        const unit = k === "width" ? "widthUnit" : "heightUnit";
        if (/^\s*auto\s*$/i.test(String(v))) w[unit] = pages.ImageSizeUnit.Auto;
        else if (m && Number(m[1]) > 0) {
            w[unit] = m[2] === "%" ? pages.ImageSizeUnit.Percentage : pages.ImageSizeUnit.Pixels;
            w[k] = Number(m[1]);
        } else throw new Error(`${where}: ${k} '${v}' must be pixels (200), a percentage ("50%") or "auto"`);
        return ` ${k} ${v}`;
    }

    // Editable true/false/condition on an input (Forms input or pluggable with Editability).
    async function editability(w, v, dc, where) {
        const E = pages.EditableEnum;
        if (typeof v === "boolean" || /^(true|false)$/.test(String(v))) {
            const want = bool(v, true) ? E.Always : E.Never;
            if (w.editable !== want) w.editable = want;
            return want === E.Always ? "" : "read-only";
        }
        const c = await condition(v, dc, where, "editable");
        w.editable = E.Conditional;
        w.conditionalEditabilitySettings = pages.ConditionalEditabilitySettings.create(model);
        fill(w.conditionalEditabilitySettings, c);
        return c.text;
    }

    const INPUT_KINDS = ["input", ...Object.keys(INPUTS), "referenceSelector", "referenceSetSelector", "comboBox", "pluggable", "fileManager", "imageUploader"];
    // "style": inline CSS, except for a text (text style) and a button (button style) unless it holds CSS (a ':')
    const cssOf = node => (node.spec.style !== undefined && (!["text", "actionButton"].includes(node.kind) || /:/.test(String(node.spec.style))) ? String(node.spec.style) : undefined);

    // The fields every kind takes (visible, class, style; editable on inputs) on the widget w built for node.
    async function common(node, w, ctx) {
        const s = node.spec, out = [];
        const dc = node.container || null;
        const css = cssOf(node);
        // a native page (G20): no inline CSS; design properties of the native theme
        const native = require("./theme-native").isNativeDoc(client, ctx && ctx.page);
        if (native && css !== undefined) throw new Error(`${node.where}: ${require("./theme-native").NATIVE_STYLE_REFUSAL}`);
        if (s.class !== undefined || css !== undefined) {
            if (!has(w, "appearance")) throw new Error(`${node.where}: a ${node.kind} has no CSS class or style`);
            if (s.class !== undefined && w.appearance.class !== String(s.class)) w.appearance.class = String(s.class);
            if (css !== undefined && w.appearance.style !== css) w.appearance.style = css;
            if (s.class) out.push(`class "${s.class}"`);
            if (css) out.push(`style "${css}"`);
        }
        if (s.design !== undefined) {
            if (!has(w, "appearance")) throw new Error(`${node.where}: a ${node.kind} has no design properties`);
            const t = design.apply(sdk, model, w, design.resolve(client.project.dir, w, s.design, `${node.where}: design`, native ? "native" : "web"), client.warn);
            if (t) out.push(`design ${t}`);
        }
        if (s.visible !== undefined && s.visible !== true && s.visible !== "true") {
            if (s.visible === false || s.visible === "false") throw new Error(`${node.where}: "visible": false hides the widget for everyone; leave the widget out, or give a condition`);
            if (!has(w, "conditionalVisibilitySettings") || (w instanceof cw.CustomWidget && !sysProps(w).includes("Visibility"))) {
                throw new Error(`${node.where}: a ${node.kind} has no visibility setting; put it in a container with "visible"`);
            }
            const c = await condition(s.visible, dc, `${node.where}: visible`, "visible");
            w.conditionalVisibilitySettings = pages.ConditionalVisibilitySettings.create(model);
            fill(w.conditionalVisibilitySettings, c);
            out.push(c.text);
        }
        out.push(...(await uiFns().apply(node, w, ctx)));
        if (s.editable !== undefined && INPUT_KINDS.includes(node.kind)) {
            if (!has(w, "editable") || (w instanceof cw.CustomWidget && !sysProps(w).includes("Editability"))) throw new Error(`${node.where}: this ${node.kind} has no editability setting`);
            const t = await editability(w, s.editable, dc, `${node.where}: editable`);
            if (t) out.push(t);
        }
        return out;
    }

    // The selectable objects of a reference (set) selector: an XPath, or a microflow that returns them.
    async function selectable(w, node, other, ctx) {
        const s = node.spec;
        if (s.xpath !== undefined && s.selectableMicroflow !== undefined) throw new Error(`${node.where}: give xpath or selectableMicroflow, not both`);
        if (s.selectableMicroflow === undefined) {
            if (!(w.selectorSource instanceof pages.SelectorXPathSource)) pages.SelectorXPathSource.createIn(w);
            if (s.xpath) {
                checkXPath(node, other);
                w.selectorSource.xPathConstraint = String(s.xpath);
            }
            return s.xpath ? `, XPath ${s.xpath}` : "";
        }
        const { f, params } = await flowParams(String(s.selectableMicroflow), mf.Microflow, "microflow", node);
        const rt = f.microflowReturnType;
        const re = rt instanceof datatypes.ListType ? await entityOf(rt.entityQualifiedName, node.where) : null;
        if (!re || !isA(re, other.qualifiedName)) throw new Error(`${node.where}: ${f.qualifiedName} returns ${typeText(rt)}; the selectable objects are a List of ${other.qualifiedName}`);
        implicitOnly(params, { where: node.where, container: node.container }, f.qualifiedName);
        const src = pages.SelectorMicroflowSource.createIn(w);
        src.dataSourceMicroflowSettings.microflow = f;
        src.dataSourceMicroflowSettings.formValidations = pages.FormValidations.None; // as Studio Pro
        return `, selectable from ${f.qualifiedName}`;
    }

    // "selectPage" of a reference (set) selector (G11): the objects are picked on a page (Studio Pro: Select using Page)
    async function selectPage(w, node, other, ctx) {
        const s = node.spec;
        if (s.selectPage === undefined) return "";
        if (!has(w, "selectPageSettings")) throw new Error(`${node.where}: a ${node.kind} has no select page`);
        const page = await h.get(String(s.selectPage));
        if (!(page instanceof pages.Page)) throw new Error(`${node.where}: '${s.selectPage}' is not a page`);
        if (page.parameters.length) throw new Error(`${node.where}: a select page opens without parameters; ${page.qualifiedName} has ${page.parameters.map(p => p.name).join(", ")}`);
        // Studio Pro: the page lists the selectable objects (a grid of the other entity with a Select button)
        let list = false;
        page.traverse(el => {
            const src = el instanceof pages.DataGrid || el instanceof pages.TemplateGrid || el instanceof pages.ListView ? el.dataSource : null;
            const er = src && has(src, "entityRef") ? src.entityRef : null;
            if (er && er instanceof dm.DirectEntityRef && isA(other, er.entityQualifiedName)) list = true;
        });
        if (!list) client.warn(`${node.where}: ${page.qualifiedName} shows no grid or list of ${other.qualifiedName}; a select page lists the objects to pick (a data grid of ${other.name} with a Select button)`);
        if (has(w, "renderMode")) w.renderMode = pages.ReferenceSelectorRenderModeType.Form;
        w.selectPageSettings.page = page;
        client.warnFirst(`Forms reference selector with a select page: first use by ops (Studio Pro samples use drop-downs): check ${ctx.qn} ${w.name} in Studio Pro`);
        return `, selected on ${page.qualifiedName}`;
    }

    // A reference set the entity (around the selector) owns, or one owned by both: { assoc, other }.
    async function referenceSet(ent, qn, where, ctx) {
        const all = await allAssociations(ctx);
        const sets = all.filter(a => a.type === dm.AssociationType.ReferenceSet && (isA(ent, ends(a).from) || (a.owner === dm.AssociationOwner.Both && isA(ent, ends(a).to))));
        const a = all.find(x => x.qualifiedName === String(qn));
        if (!a) return fail(`${where}: no association '${qn}'${sets.length ? ` (reference sets of ${ent.qualifiedName}: ${sets.map(x => x.qualifiedName).join(", ")})` : ` (${ent.qualifiedName} owns no reference set)`}`, String(qn), sets.map(x => x.qualifiedName));
        if (a.type !== dm.AssociationType.ReferenceSet) throw new Error(`${where}: ${qn} is a reference (one object); use a referenceSelector`);
        const { from, to } = ends(a);
        const fwd = isA(ent, from);
        if (!fwd && !(a.owner === dm.AssociationOwner.Both && isA(ent, to))) throw new Error(`${where}: ${qn} is owned by ${from}; a reference set selector sits in a data view of ${from}` + (sets.length ? `. Reference sets of ${ent.qualifiedName}: ${sets.map(x => x.qualifiedName).join(", ")}` : ""));
        return { assoc: a, other: await entityOf(fwd ? to : from, where) };
    }

    // "onChange", "onEnter", "onLeave", "onEnterKeyPress" of an input or selector: client actions (the object around it
    // is passed)
    const EVENTS = { onChange: ["onChangeAction", "on change"], onEnter: ["onEnterAction", "on enter"], onLeave: ["onLeaveAction", "on leave"], onEnterKeyPress: ["onEnterKeyPressAction", "on Enter key"] };
    async function onChange(node, w, ctx) {
        let out = "";
        for (const [k, [prop, label]] of Object.entries(EVENTS)) {
            if (node.spec[k] === undefined) continue;
            if (!has(w, prop)) throw new Error(`${node.where}: a ${node.kind} has no ${label} event${k === "onEnterKeyPress" ? " (a text box has one)" : ""}`);
            out += `, ${label}: ` + (await makeAction(node.spec[k], node, ctx, `${node.where}: ${k}`, a => (w[prop] = a)));
            if (k !== "onChange") client.warnFirst(`Forms ${label} action: first use by ops (one Studio Pro sample, a text box on enter in Mendix 10.24): check ${ctx.qn} ${w.name} in Studio Pro`);
        }
        return out;
    }

    // Validation, format, read-only style, placeholder, mask and maximum length of an input or selector w (G3, G5, G6).
    // attr: its attribute (null for a page variable), type: the value type. Returns texts for the dry run.
    async function inputExtras(node, w, attr, ctx, label) {
        const s = node.spec, out = [];
        const where = node.where;
        const t = attr ? typeOf(attr) : null;
        if (s.required !== undefined || s.validation !== undefined || s.requiredMessage !== undefined) {
            if (!has(w, "validation") || !w.validation) throw new Error(`${where}: a ${node.kind} has no validation (text box, text area, date picker, drop-down, radio buttons, reference selector have one)`);
            if (s.requiredMessage !== undefined && !bool(s.required, false)) throw new Error(`${where}: requiredMessage goes with "required": true`);
            const req = bool(s.required, false);
            if (req && s.validation !== undefined) throw new Error(`${where}: give required or validation (an input has one validation); for both write one expression, e.g. "$value != empty and $value > 0"`);
            if (req && (t === "Boolean" || (!attr && w instanceof pages.CheckBox))) throw new Error(`${where}: a check box is never empty; to require it to be ticked use "validation": { "expression": "$value", "message": "..." }`);
            let expr, msg;
            if (req) {
                expr = "$value != empty"; // what Studio Pro stores for validation type Required
                msg = s.requiredMessage !== undefined ? String(s.requiredMessage) : `${label || "This field"} is required.`;
                out.push("required");
            } else if (s.validation !== undefined) {
                const v = s.validation;
                if (!v || typeof v !== "object" || Array.isArray(v) || v.expression === undefined) throw new Error(`${where}: validation is { "expression": "$value > 0", "message": "Must be positive" } ($value is the input's value)`);
                for (const k of Object.keys(v)) if (!["expression", "message"].includes(k)) fail(`${where}: unknown field '${k}' in validation`, k, ["expression", "message"]);
                expr = String(v.expression).trim();
                if (!expr) throw new Error(`${where}: validation expression is empty`);
                exprCheck(expr, node.container && node.container.ent ? node.container : null, `${where}: validation`);
                if (!/\$value\b/.test(expr)) client.warn(`${where}: the validation ${expr} does not use $value (the input's value)`);
                msg = v.message !== undefined ? String(v.message) : "";
                if (!msg) client.warn(`${where}: the validation has no message; the user sees no reason`);
                out.push(`validation ${expr}`);
            }
            if (expr !== undefined) {
                w.validation.expression = expr;
                await textAll(w.validation.message, msg, ctx);
            }
        }
        if (s.format !== undefined) {
            if (!attr) throw new Error(`${where}: format goes with an attribute input`);
            out.push(`format ${formatInto(w, attr, s.format, `${where}: format`)}`);
        }
        if (s.readOnlyStyle !== undefined) {
            if (!has(w, "readOnlyStyle")) throw new Error(`${where}: a ${node.kind} has no read-only style`);
            const v = { inherit: "Inherit", control: "Control", text: "Text" }[String(s.readOnlyStyle).toLowerCase()];
            if (!v) fail(`${where}: readOnlyStyle '${s.readOnlyStyle}' is not known (use inherit | control | text)`, String(s.readOnlyStyle), ["inherit", "control", "text"]);
            w.readOnlyStyle = pages.ReadOnlyStyle[v];
            out.push(`read-only style ${v.toLowerCase()}`);
        }
        if (s.placeholder !== undefined) {
            const pt = has(w, "placeholderTemplate") ? w.placeholderTemplate : undefined;
            if (pt === undefined) throw new Error(`${where}: a ${node.kind} has no placeholder (text box, text area and date picker have one)`);
            await textTemplate(pt, String(s.placeholder), node, ctx);
            out.push(`placeholder "${s.placeholder}"`);
        }
        if (s.inputMask !== undefined) {
            if (!has(w, "inputMask")) throw new Error(`${where}: inputMask goes with a text box`);
            if (t && t !== "String") throw new Error(`${where}: inputMask goes with a String attribute; ${attr.name} is ${t}`);
            w.inputMask = String(s.inputMask);
            out.push(`mask "${s.inputMask}"`);
            client.warnFirst(`Forms$TextBox input mask: first use by ops (no Studio Pro sample sets one): check ${ctx.qn} ${w.name} in Studio Pro`);
        }
        if (s.maxLength !== undefined) {
            if (!has(w, "maxLengthCode")) throw new Error(`${where}: maxLength goes with a text box or text area`);
            if (t && t !== "String") throw new Error(`${where}: maxLength goes with a String attribute; ${attr.name} is ${t}`);
            const v = String(s.maxLength).toLowerCase();
            const n = v === "attribute" ? -1 : v === "unlimited" ? 0 : Number(s.maxLength);
            if (!Number.isInteger(n) || n < -1) throw new Error(`${where}: maxLength is "attribute", "unlimited" or a number of characters`);
            const len = attr && attr.type instanceof dm.StringAttributeType ? attr.type.length : 0;
            if (n > 0 && len > 0 && n > len) throw new Error(`${where}: maxLength ${n} is more than ${attr.name} holds (${len})`);
            w.maxLengthCode = n;
            out.push(n === -1 ? "max length of the attribute" : n === 0 ? "no max length" : `max length ${n}`);
            if (n > 0) client.warnFirst(`Forms maximum length ${n}: first use by ops (Studio Pro samples keep the attribute's length): check ${ctx.qn} ${w.name} in Studio Pro`);
        }
        return out;
    }

    // ------------------------------------------------ any pluggable widget, built from its widgets/*.mpk definition

    const plDefs = new Map();
    // { id, xml, type (CustomWidgetType storage JSON), version, file } of a widget by id or short name
    function plDef(name, where) {
        const dir = client.project.dir;
        const { id, all } = pluggable.findWidget(dir, name);
        if (!id) return fail(`${where}: no pluggable widget '${name}' in widgets/*.mpk${all.length ? " (widgettype lists them)" : " (this project has none)"}`, String(name), [...all.map(x => x.split(".").pop()), ...all]);
        if (!plDefs.has(id)) {
            const xml = pluggable.widgetXml(dir, id);
            const inst = pluggable.installed(dir).get(id);
            plDefs.set(id, { id, xml, type: pluggable.typeJson(xml, t => client.catalog.keys(t)), version: inst.version, file: inst.file });
        }
        return plDefs.get(id);
    }
    const plProps = objType => new Map(objType.PropertyTypes.map(pt => [pt.PropertyKey, pt]));
    const PL_DS_KEYS = ["entity", "xpath", "source", "association", "microflow", "nanoflow", "params"];
    // "../datasource" from the object at depth -> { depth, key } of the data source property it names
    function dsRef(dsp, depth) {
        let p = String(dsp), d = depth;
        while (p.startsWith("../")) {
            p = p.slice(3);
            d--;
        }
        return { depth: d, key: p };
    }
    // ops widgettype: the properties of a widget (one line each, nested object properties indented)
    function plLines(objType, indent = "    ") {
        const out = [];
        for (const pt of objType.PropertyTypes) {
            const v = pt.ValueType, t = v.Type;
            if (t === "System") continue;
            const bits = [t === "Object" ? (v.IsList ? "object list" : "object") : t.toLowerCase() + (v.IsList ? " list" : "")];
            if (v.Required && !["Boolean", "Enumeration", "Integer", "Decimal"].includes(t)) bits.push("required");
            if (v.DefaultValue !== "") bits.push(`default ${v.DefaultValue}`);
            if (v.EnumerationValues.length) bits.push(`values ${v.EnumerationValues.map(e => e._Key).join(" | ")}`);
            if (v.SelectionTypes.length) bits.push(`selection ${v.SelectionTypes.join(" | ")}`);
            if (v.AllowedTypes.length) bits.push(`types ${v.AllowedTypes.join(", ")}`);
            if (v.DataSourceProperty) bits.push(`of data source ${v.DataSourceProperty}`);
            if (v.ReturnType) bits.push(`returns ${v.ReturnType.Type}${v.ReturnType.IsList ? " list" : ""}`);
            if (v.Translations.length) bits.push(`text "${v.Translations[0].Text}"`);
            out.push(`${indent}${pt.PropertyKey}: ${bits.join(", ")} - ${pt.Caption} [${pt.Category}]`);
            if (v.ObjectType) out.push(...plLines(v.ObjectType, indent + "    "));
        }
        return out;
    }
    function widgetType(name) {
        const d = plDef(name, "widgettype");
        const t = d.type;
        const sys = t.ObjectType.PropertyTypes.filter(pt => pt.ValueType.Type === "System").map(pt => pt.PropertyKey);
        return [`${t.WidgetName} ${d.version} (${t.WidgetId}, widgets/${d.file}; ${t.SupportedPlatform}${t.WidgetPluginWidget ? "" : ", not pluggable"})`,
            `  system properties: ${sys.join(", ") || "none"} (Label -> "label", Visibility -> "visible", Editability -> "editable")`,
            "  properties (\"properties\": { key: value }):", ...plLines(t.ObjectType),
            `  use: { "widget": "pluggable", "type": "${t.WidgetId.split(".").pop()}", "properties": { ... } }`].join("\n");
    }
    function widgetTypes() {
        const all = [...pluggable.installed(client.project.dir)].map(([id, x]) => `  ${id} ${x.version} (widgets/${x.file})`);
        return all.length ? `Pluggable widgets in widgets/*.mpk (${all.length}):\n${all.join("\n")}\n  details: widgettype <name>` : "This project has no widgets/*.mpk.";
    }

    // Checks the properties of a pluggable node against its definition (keys, value shapes, enumeration keys) and
    // scans its widget lists; the first data source becomes the node's own source (database / association / flow).
    function plScan(node, container, nodes) {
        const s = node.spec;
        node.pl = plDef(s.type, node.where);
        if (node.pl.type.SupportedPlatform === "Native" && scanPlatform !== "native") throw new Error(`${node.where}: ${node.pl.type.WidgetName} is a native widget; it goes on a native page`);
        if (node.pl.type.SupportedPlatform !== "Native" && scanPlatform === "native") throw new Error(`${node.where}: ${node.pl.type.WidgetName} is a web widget; a native page takes native pluggable widgets (widgets/*.mpk with platform Native: widgettype lists them)`);
        node.pspec = s;
        node.plWidgets = new Map();
        const t = node.pl.type, wname = t.WidgetName;
        const sys = t.ObjectType.PropertyTypes.filter(pt => pt.ValueType.Type === "System").map(pt => pt.PropertyKey);
        if (s.label !== undefined && !sys.includes("Label")) throw new Error(`${node.where}: ${wname} has no label`);
        if (s.editable !== undefined && !sys.includes("Editability")) throw new Error(`${node.where}: ${wname} has no editability setting`);
        const props = s.properties === undefined ? {} : s.properties;
        if (!props || typeof props !== "object" || Array.isArray(props)) throw new Error(`${node.where}: properties is { "<key>": value } (widgettype ${t.WidgetId.split(".").pop()})`);
        // the first top-level data source with a value is the node's source
        for (const pt of t.ObjectType.PropertyTypes) {
            if (pt.ValueType.Type !== "DataSource" || props[pt.PropertyKey] === undefined) continue;
            if (pt.ValueType.IsLinked) throw new Error(gridExtras.FILTER_IDS.includes(t.WidgetId) ? gridExtras.outsideFilterMessage(t.WidgetId, node.where, node.pl.version) : `${node.where}: ${pt.PropertyKey} links to the data source of another widget; inside a Data grid 2 / gallery header a filter needs none, elsewhere set it in Studio Pro`);
            const v = props[pt.PropertyKey];
            const ds = typeof v === "string" ? { entity: v } : v;
            if (!ds || typeof ds !== "object" || Array.isArray(ds)) throw new Error(`${node.where}: ${pt.PropertyKey} is "Module.Entity" or { "entity": ..., "xpath": ... } (or "association" / "microflow" / "nanoflow")`);
            for (const k of Object.keys(ds)) if (!PL_DS_KEYS.includes(k)) fail(`${node.where}: unknown field '${k}' in ${pt.PropertyKey}`, k, PL_DS_KEYS);
            if (!pt.ValueType.IsList) throw new Error(`${node.where}: ${pt.PropertyKey} is a single-object data source; set it in Studio Pro`);
            node.dsKey = pt.PropertyKey;
            const sel = t.ObjectType.PropertyTypes.find(x => x.ValueType.Type === "Selection" && x.ValueType.DataSourceProperty === pt.PropertyKey && x.ValueType.SelectionTypes.includes("Single"));
            node.selKey = sel ? sel.PropertyKey : null;
            node.spec = { ...s, ...ds };
            delete node.spec.properties;
            break;
        }
        const check = (objType, values, where, depth, linkedDepth0) => {
            const map = plProps(objType);
            const keys = [...map.keys()].filter(k => map.get(k).ValueType.Type !== "System");
            for (const [k, v] of Object.entries(values)) {
                const pt = map.get(k), at = `${where}.${k}`;
                if (!pt) fail(`${where}: ${wname} has no property '${k}'`, k, keys);
                const vt = pt.ValueType, ty = vt.Type;
                if (ty === "System") throw new Error(`${at}: ${k} is a system property; use "${{ Label: "label", Visibility: "visible", Editability: "editable", Name: "name" }[k] || k}" on the widget`);
                const bad = want => {
                    throw new Error(`${at}: ${ty.toLowerCase()} property; give ${want}`);
                };
                const linked = vt.DataSourceProperty ? (r => r.depth === 0 && r.key === node.dsKey)(dsRef(vt.DataSourceProperty, depth)) : false;
                switch (ty) {
                    case "Boolean":
                        if (!(typeof v === "boolean" || /^(true|false)$/.test(String(v)))) bad("true or false");
                        break;
                    case "Integer":
                        if (!Number.isInteger(Number(v)) || v === "" || typeof v === "boolean") bad("a whole number");
                        break;
                    case "Decimal":
                        if (v === "" || typeof v === "boolean" || Number.isNaN(Number(v))) bad("a number");
                        break;
                    case "Enumeration": {
                        const all = vt.EnumerationValues.map(e => e._Key);
                        if (!vt.EnumerationValues.some(e => e._Key === String(v) || e._Key.toLowerCase() === String(v).toLowerCase() || e.Caption.toLowerCase() === String(v).toLowerCase())) fail(`${at}: '${v}' is not a value (values: ${all.join(" | ")})`, String(v), all);
                        break;
                    }
                    case "Selection":
                        if (!vt.SelectionTypes.some(x => x.toLowerCase() === String(v).toLowerCase())) fail(`${at}: selection '${v}' is not possible (use ${vt.SelectionTypes.join(" | ")})`, String(v), vt.SelectionTypes);
                        break;
                    case "String": case "Expression": case "TextTemplate": case "TranslatableString": case "EntityConstraint":
                        if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") bad("a text");
                        break;
                    case "Attribute": case "Association": case "Entity": case "Image": case "Form": case "Microflow": case "Nanoflow":
                        if (typeof v !== "string" || !v) bad(ty === "Attribute" ? "an attribute name" : ty === "Image" ? "Module.Collection.Image" : "Module.Name");
                        break;
                    case "DataSource":
                        if (k === node.dsKey && depth === 0) break;
                        if (!(typeof v === "string" || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(x => x === "entity" || x === "xpath")))) bad(`"Module.Entity" or { "entity": ..., "xpath": ... } (only the first data source of a widget takes association / microflow / nanoflow)`);
                        break;
                    case "Action":
                        if (!(typeof v === "string" || (v && typeof v === "object" && !Array.isArray(v)))) bad(ACTION);
                        break;
                    case "Widgets":
                        node.plWidgets.set(v, scan(v, at, linked ? node : container, nodes));
                        break;
                    case "Object":
                        if (vt.IsList) {
                            if (!Array.isArray(v)) bad("a list [ { key: value }, ... ]");
                            v.forEach((o, i) => {
                                if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error(`${at}[${i + 1}]: each item is { key: value }`);
                                check(vt.ObjectType, o, `${at}[${i + 1}]`, depth + 1);
                            });
                        } else {
                            if (!v || typeof v !== "object" || Array.isArray(v)) bad("{ key: value }");
                            check(vt.ObjectType, v, at, depth + 1);
                        }
                        break;
                    default:
                        throw new Error(`${at}: ${ty.toLowerCase()} properties are not supported here; set it in Studio Pro`);
                }
            }
        };
        check(t.ObjectType, props, `${node.where}.properties`, 0);
    }

    // Studio Pro's name for a dropped widget: its name in camel case + number ("Data grid 2" -> dataGrid2_1)
    const plPrefix = t => {
        const words = String(t.WidgetName).replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
        const n = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join("") || "widget";
        return /\d$/.test(n) ? n + "_" : n;
    };

    // Sets the given properties on WidgetObject obj (frames: data source entities per object depth, outer first).
    async function plApply(node, obj, values, frames, ctx, where) {
        const props = new Map(obj.properties.map(p => [p.type.key, p]));
        const depth = frames.length;
        const frame = new Map();
        frames = [...frames, frame];
        const out = [];
        const entityFor = (vt, at) => {
            if (vt.dataSourceProperty) {
                const r = dsRef(vt.dataSourceProperty, depth);
                const f = frames[r.depth];
                const ent = f && f.get(r.key);
                if (!ent) throw new Error(`${at}: give its data source '${vt.dataSourceProperty.replace(/^(\.\.\/)+/, "")}' first`);
                return ent;
            }
            const c = node.container;
            if (!c || !c.ent) throw new Error(`${at}: needs the object of a data view or list item around the widget`);
            return c.ent;
        };
        // data sources first: attributes and texts of the items refer to them
        const order = [...Object.keys(values)].sort((a, b) => (props.get(b) && props.get(b).type.valueType.type.name === "DataSource") - (props.get(a) && props.get(a).type.valueType.type.name === "DataSource"));
        for (const k of order) {
            const v = values[k], p = props.get(k), vt = p.type.valueType, ty = vt.type.name, val = p.value, at = `${where}.${k}`;
            const shows = x => out.push(`${k} ${x}`);
            switch (ty) {
                case "Boolean":
                    val.primitiveValue = String(v === true || v === "true");
                    shows(val.primitiveValue);
                    break;
                case "Integer": case "Decimal": case "String":
                    val.primitiveValue = String(v);
                    shows(JSON.stringify(String(v)));
                    break;
                case "Enumeration": {
                    const e = vt.enumerationValues.find(x => x.key === String(v)) || vt.enumerationValues.find(x => x.key.toLowerCase() === String(v).toLowerCase() || x.caption.toLowerCase() === String(v).toLowerCase());
                    val.primitiveValue = e.key;
                    shows(e.key);
                    break;
                }
                case "Selection": {
                    const n = vt.selectionTypes.map(x => x.name).find(x => x.toLowerCase() === String(v).toLowerCase());
                    val.selection = cw.CustomWidgetSelectionType[n];
                    shows(n);
                    break;
                }
                case "Expression": {
                    const ent = vt.dataSourceProperty ? entityFor(vt, at) : node.container && node.container.ent;
                    exprCheck(String(v), ent ? { ent } : null, at);
                    val.expression = String(v);
                    shows(String(v));
                    break;
                }
                case "TextTemplate": {
                    const ent = vt.dataSourceProperty ? entityFor(vt, at) : null;
                    val.textTemplate = pages.ClientTemplate.create(model);
                    await textTemplate(val.textTemplate, String(v), { where: at, container: ent ? { ent } : node.container }, ctx);
                    shows(JSON.stringify(String(v)));
                    break;
                }
                case "TranslatableString":
                    if (!val.translatableValue) val.translatableValue = sdk.texts.Text.create(model);
                    await textAll(val.translatableValue, String(v), ctx);
                    shows(JSON.stringify(String(v)));
                    break;
                case "EntityConstraint":
                    val.xPathConstraint = String(v);
                    shows(String(v));
                    break;
                case "Attribute": {
                    const ent = entityFor(vt, at);
                    const path = pathOf(ent, String(v), at), attr = path.attr;
                    const allowed = vt.attributeTypes.map(x => x.name);
                    if (allowed.length && !allowed.includes(typeOf(attr))) throw new Error(`${at}: ${attr.name} is ${typeOf(attr)}; ${k} takes ${allowed.join(", ")}`);
                    if (path.steps.length && !vt.dataSourceProperty) throw new Error(`${at}: ${path.text}: an attribute over references is only possible in a property linked to a data source (a column, an item); here use one of ${ent.name}'s own attributes`);
                    val.attributeRef = attrRefOf(path);
                    shows(`${ent.name}.${path.text}`);
                    break;
                }
                case "Association": {
                    const ent = entityFor(vt, at);
                    const all = await allAssociations(ctx);
                    const a = all.find(x => x.qualifiedName === String(v));
                    const mine = all.filter(x => isA(ent, ends(x).from)).map(x => x.qualifiedName);
                    if (!a) fail(`${at}: no association '${v}'`, String(v), mine);
                    if (!isA(ent, ends(a).from)) throw new Error(`${at}: ${v} goes from ${ends(a).from}; ${k} starts at ${ent.qualifiedName}` + (mine.length ? ` (its associations: ${mine.join(", ")})` : ""));
                    const kinds = vt.associationTypes.map(x => x.name);
                    const kind = a.type === dm.AssociationType.ReferenceSet ? "ReferenceSet" : "Reference";
                    if (kinds.length && !kinds.includes(kind)) throw new Error(`${at}: ${v} is a ${kind}; ${k} takes ${kinds.join(", ")}`);
                    const st = dm.EntityRefStep.createIn(dm.IndirectEntityRef.createInWidgetValueUnderEntityRef(val));
                    st.association = a;
                    st.destinationEntity = await entityOf(ends(a).to, at);
                    shows(String(v));
                    break;
                }
                case "Entity": {
                    const ent = await entityOf(String(v), at);
                    dm.DirectEntityRef.createInWidgetValueUnderEntityRef(val).entity = ent;
                    frame.set(k, ent);
                    shows(ent.qualifiedName);
                    break;
                }
                case "Image":
                    val.image = await imageNamed(String(v), at);
                    shows(String(v));
                    break;
                case "Form": case "Microflow": case "Nanoflow": {
                    const d = await h.get(String(v));
                    const want = { Form: pages.Page, Microflow: mf.Microflow, Nanoflow: mf.Nanoflow }[ty];
                    if (!(d instanceof want)) throw new Error(`${at}: '${v}' is not a ${ty === "Form" ? "page" : ty.toLowerCase()}`);
                    val[ty === "Form" ? "page" : ty.toLowerCase()] = d;
                    shows(String(v));
                    break;
                }
                case "DataSource": {
                    if (depth === 0 && k === node.dsKey) {
                        frame.set(k, node.ent);
                        shows(listSource(node, val, true, ctx));
                        break;
                    }
                    const ds = typeof v === "string" ? { entity: v } : v;
                    const ent = await entityOf(String(ds.entity), at);
                    if (!h.persistable(ent)) throw new Error(`${at}: ${ent.qualifiedName} is non-persistable; a database source needs a persistable entity`);
                    const src = cw.CustomWidgetXPathSource.createInWidgetValueUnderDataSource(val);
                    dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = ent;
                    if (ds.xpath) {
                        checkXPath({ where: at, spec: { xpath: ds.xpath }, container: node.container }, ent);
                        src.xPathConstraint = String(ds.xpath);
                    }
                    frame.set(k, ent);
                    shows(`${ent.qualifiedName}${ds.xpath ? " " + ds.xpath : ""}`);
                    break;
                }
                case "Action": {
                    const linked = vt.dataSourceProperty && dsRef(vt.dataSourceProperty, depth);
                    const item = linked && linked.depth === 0 && linked.key === node.dsKey;
                    shows(await makeAction(v, { container: item ? node : node.container, name: node.name }, ctx, at, a => (val.action = a)));
                    break;
                }
                case "Widgets": {
                    const inner = [];
                    for (const ch of node.plWidgets.get(v) || []) inner.push(await build(ch, val.widgets, ctx));
                    shows(`[${inner.join(", ")}]`);
                    break;
                }
                case "Object": {
                    // the objects themselves are made with the widget (plPrefill)
                    const items = vt.isList ? v : [v];
                    const texts = [];
                    for (const [i, o] of items.entries()) {
                        const inner = await plApply(node, val.objects[i], o, frames, ctx, vt.isList ? `${at}[${i + 1}]` : at);
                        texts.push(`{${inner.join(", ")}}`);
                    }
                    shows(vt.isList ? `[${texts.join(", ")}]` : texts[0]);
                    break;
                }
                default:
                    throw new Error(`${at}: ${ty} properties are not supported here; set it in Studio Pro`);
            }
        }
        return out;
    }
    // The objects of object properties given in values, made in the widget's storage JSON (objJson of objType)
    function plPrefill(objJson, objType, values, langs) {
        for (const [k, v] of Object.entries(values || {})) {
            const pt = objType.PropertyTypes.find(x => x.PropertyKey === k);
            if (!pt || pt.ValueType.Type !== "Object") continue;
            const prop = objJson.Properties.find(x => x.TypePointer === pt.$ID);
            prop.Value.Objects = (pt.ValueType.IsList ? v : [v]).map(o => {
                const oj = pluggable.objectJson(pt.ValueType.ObjectType, langs);
                plPrefill(oj, pt.ValueType.ObjectType, o, langs);
                return oj;
            });
        }
    }

    // Required properties left at an empty default (Studio Pro reports those it shows as errors).
    function plMissing(obj) {
        const miss = [];
        for (const p of obj.properties) {
            const vt = p.type.valueType, v = p.value, t = vt.type.name;
            if (!vt.required || vt.isLinked) continue;
            const empty = { Attribute: !v.attributeRef, Association: !v.entityRef, Entity: !v.entityRef, DataSource: !v.dataSource, Image: !v.imageQualifiedName,
                Expression: !v.expression, TextTemplate: !v.textTemplate || !v.textTemplate.template.translations.some(x => x.text), Object: vt.isList && !v.objects.length, Action: v.action instanceof pages.NoClientAction }[t];
            if (empty) miss.push(p.type.key);
        }
        return miss;
    }

    // file manager / image uploader in a data view of a System.FileDocument / System.Image specialization
    async function fileWidget(node, target, ctx, image) {
        const s = node.spec, dv = node.container, base = image ? "System.Image" : "System.FileDocument";
        if (!dv || dv.kind !== "dataView") throw new Error(`${node.where}: a${image ? "n image uploader" : " file manager"} goes in a data view (of an entity that inherits ${base})`);
        if (!inherits(dv.ent, base) && !(!image && inherits(dv.ent, "System.Image"))) throw new Error(`${node.where}: ${dv.ent.qualifiedName} does not inherit ${base}; a${image ? "n image uploader" : " file manager"} needs a data view of such an entity${image ? "" : " (an image entity is a file document too)"}`);
        const w = (image ? pages.ImageUploader : pages.FileManager).create(model);
        target.push(w);
        w.name = node.name || ctx.names.next(PREFIX[node.kind]);
        node.widget = w;
        const bits = [];
        if (s.maxFileSize !== undefined) {
            const n = Number(s.maxFileSize);
            if (!(n > 0)) throw new Error(`${node.where}: maxFileSize is a number of MB > 0`);
            w.maxFileSize = n;
            bits.push(`max ${n} MB`);
        } else if (w.maxFileSize !== 5) w.maxFileSize = 5; // Studio Pro's default
        if (s.allowedExtensions !== undefined) {
            w.allowedExtensions = String(s.allowedExtensions).replace(/[,\s]+/g, ";").replace(/\.(\w)/g, "$1");
            bits.push(`extensions ${w.allowedExtensions}`);
        }
        if (image) {
            const m = s.thumbnail !== undefined ? /^\s*(\d+)\s*[x;*,]\s*(\d+)\s*$/i.exec(String(s.thumbnail)) : ["", "100", "75"];
            if (!m) throw new Error(`${node.where}: thumbnail is "<width>x<height>", e.g. "100x75"`);
            w.thumbnailSize = { width: Number(m[1]), height: Number(m[2]) };
        } else {
            const t = { upload: "Upload", download: "Download", both: "Both" }[String(s.type || "both").toLowerCase()];
            if (!t) fail(`${node.where}: type '${s.type}' is not known (use upload | download | both)`, String(s.type), ["upload", "download", "both"]);
            w.type = pages.FileManagerType[t];
            w.showFileInBrowser = bool(s.showInBrowser, false);
            bits.push(t.toLowerCase());
        }
        await templateAll(w, "labelTemplate", s.label !== undefined ? s.label : image ? "Upload image" : "File", ctx, node.where, s.label === undefined && image);
        ctx.count.inputs++;
        if (!image) client.warn(`Forms$FileManager first use by ops (no Studio Pro sample in the test projects): check ${ctx.qn} ${w.name} in Studio Pro`);
        return `${w.name} (${image ? "image uploader" : "file manager"} of ${dv.ent.name}${bits.length ? ", " + bits.join(", ") : ""})`;
    }

    const BUILD = {
        fileManager: (node, target, ctx) => fileWidget(node, target, ctx, false),
        imageUploader: (node, target, ctx) => fileWidget(node, target, ctx, true),
        async pluggable(node, target, ctx) {
            const d = node.pl, s = node.pspec;
            const langs = await languages();
            const name = node.name || ctx.names.next(plPrefix(d.type));
            const json = pluggable.widgetJson(d.xml, name, langs, t => client.catalog.keys(t));
            plPrefill(json.Object, json.Type.ObjectType, s.properties, langs);
            const w = sdk.createElementFromJSON(model, toSdk(json, client.schema));
            target.push(w);
            node.widget = w;
            node.name = name;
            if (s.label !== undefined) await textAll(w.labelTemplate.template, String(s.label), ctx);
            const set = await plApply(node, w.object, s.properties || {}, [], ctx, `${node.where}.properties`);
            const miss = plMissing(w.object);
            if (miss.length && !node.quiet) client.warn(`${ctx.qn}: ${name} (${d.type.WidgetName}) leaves required ${miss.join(", ")} empty; Studio Pro reports the ones it shows (widgettype ${d.id.split(".").pop()})`);
            if (!pluggable.exemplars(client.project, d.id).exemplars.length) client.warnFirst(`${ctx.qn}: ${name} is the first ${d.type.WidgetName} ${d.version} in this project (built from widgets/${d.file}): check it in Studio Pro`);
            return `${name} (${d.type.WidgetName} ${d.version}${set.length ? `: ${set.join(", ")}` : ""})`;
        },
        async layoutGrid(node, target, ctx) {
            const lg = pages.LayoutGrid.create(model);
            target.push(lg);
            lg.name = node.name || ctx.names.next("layoutGrid");
            if (node.spec.width) lg.width = choice(pages.ContainerWidth, /^fixed$/i.test(node.spec.width) ? "FixedWidth" : /^full$/i.test(node.spec.width) ? "FullWidth" : node.spec.width, "width", node.where);
            const parts = [];
            for (const r of node.rows) {
                const row = pages.LayoutGridRow.create(model);
                lg.rows.push(row);
                const rowLook = await uiFns().row(row, r.spec, node.container || null, r.where || node.where);
                if (rowLook.length) parts.push(`row ${lg.rows.length} {${rowLook.join("; ")}}`);
                for (const c of r) {
                    const col = pages.LayoutGridColumn.create(model);
                    row.columns.push(col);
                    col.weight = c.weight;
                    col.tabletWeight = c.tablet;
                    col.phoneWeight = c.phone;
                    const colLook = await uiFns().column(col, c.spec, node.container || null, c.where || node.where);
                    const inner = [];
                    for (const ch of c.widgets) inner.push(await build(ch, col.widgets, ctx));
                    parts.push(`${c.weight === -1 ? "auto" : c.weight}${colLook.length ? ` {${colLook.join("; ")}}` : ""}: ${inner.join(", ") || "empty"}`);
                }
            }
            return `${lg.name} [${parts.join(" | ")}]`;
        },
        async container(node, target, ctx) {
            const d = pages.DivContainer.create(model);
            target.push(d);
            d.name = node.name || ctx.names.next("container");
            const inner = [];
            for (const ch of node.widgets) inner.push(await build(ch, d.widgets, ctx));
            return `${d.name} [${inner.join(", ")}]`;
        },
        async text(node, target, ctx) {
            const t = pages.DynamicText.create(model);
            target.push(t);
            t.name = node.name || ctx.names.next("text");
            const style = (node.spec.style !== undefined && cssOf(node) === undefined && node.spec.style) || (node.heading ? "H2" : "Text");
            t.renderMode = choice(pages.TextRenderMode, style, "text style", node.where);
            const ps = await textTemplate(t.content, node.spec.text, node, ctx, node.spec.format);
            const over = ps.filter(x => x.steps.length).map(x => x.text);
            const bits = [...(/^text$/i.test(style) ? [] : [t.renderMode.name]), ...(over.length ? [`{${over.join("}, {")}} over references`] : []), ...(node.spec.format ? [`formats ${Object.keys(node.spec.format).join(", ")}`] : [])];
            return t.name + (bits.length ? ` (${bits.join("; ")})` : "");
        },
        async dataView(node, target, ctx) {
            const dv = pages.DataView.create(model);
            target.push(dv);
            dv.name = node.name = node.name || ctx.names.next("dataView");
            const ent = node.ent;
            node.widget = dv;
            let how;
            if (node.source === "listen") {
                pages.ListenTargetSource.createInEntityWidgetUnderDataSource(dv).listenTarget = node.target.name;
                how = `listens to ${node.target.name}`;
            } else if (node.source === "parameter") {
                node.param = await pageParameter(ent, ctx);
                const src = pages.DataViewSource.createInEntityWidgetUnderDataSource(dv);
                dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = ent;
                const sv = pages.PageVariable.create(model);
                src.sourceVariable = sv; // attach first: the parameter reference is local to the page
                if (node.param instanceof pages.SnippetParameter) {
                    sv.snippetParameter = node.param;
                    client.warnFirst(`Forms$DataViewSource on a snippet parameter first use (no Studio Pro sample has one): check ${ctx.qn} ${dv.name} in Studio Pro`);
                } else sv.pageParameter = node.param;
                how = `parameter ${node.param.name}`;
            } else if (node.source === "context" || node.source === "association") {
                // the object around it (SourceVariable null, as inputs in a listening data view), or over references from it
                const src = pages.DataViewSource.createInEntityWidgetUnderDataSource(dv);
                if (node.source === "context") dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = ent;
                else stepsInto(src, node.path);
                how = node.source === "context" ? `the ${ent.name} of ${node.container.name}` : `over ${node.spec.association} of ${node.container.name}`;
                client.warn(`Forms$DataViewSource first use with source ${node.source} (no Studio Pro 10/11 sample in the test projects has one): check ${ctx.qn} ${dv.name} in Studio Pro`);
            } else {
                flowInto((node.source === "nanoflow" ? pages.NanoflowSource : pages.MicroflowSource).createInEntityWidgetUnderDataSource(dv), node, ctx);
                how = `${node.source} ${node.flow.f.qualifiedName}${mapText(node.mapped || [])}`;
            }
            const editable = bool(node.spec.editable, true);
            // Mendix 10.7+: editability; older: editable
            if (!setIfAvailable(dv, "editability", editable ? pages.EditableEnum.Always : pages.EditableEnum.Never)) setIfAvailable(dv, "editable", editable);
            const fields = node.spec.fields !== undefined ? list(node.spec.fields, `${node.where}.fields`) : node.widgets.length ? [] : shown(ent);
            const inner = [];
            const before = ctx.count.inputs;
            const buttons = bool(node.spec.buttons, editable && node.source === "parameter" && !node.footer.length);
            const saves = [...node.widgets, ...node.footer].some(function has(n) {
                return (n.kind === "actionButton" && /^save$/i.test(n.spec.action)) || [...(n.widgets || []), ...(n.tabs || []).flatMap(t => t.widgets), ...(n.rows || []).flat().flatMap(c => c.widgets)].some(has);
            });
            node.saves = buttons || saves; // a Save button saves the changes of the data views inside too
            for (const f of fields) {
                const w = await attrInput("input", dv.widgets, pathOf(ent, f, node.where), node, node.where, ctx);
                inner.push(w.name + (NOTES.has(w) ? ` (${NOTES.get(w)})` : ""));
            }
            for (const ch of node.widgets) inner.push(await build(ch, dv.widgets, ctx));
            let saved = node.saves;
            for (let c = node.container; c && !saved; c = c.container) saved = !!c.saves || !!c.existing;
            if (editable && ctx.count.inputs > before && !saved && !(ctx.page instanceof pages.Snippet)) client.warn(`${ctx.qn}: ${dv.name} is editable but has no Save button: add "buttons": true (or a save actionButton in "footer"), or "editable": false`);
            const foot = [];
            if (buttons) {
                foot.push((await button(dv.footerWidgets, "Save", "save", pages.ButtonStyle.Success, node.source === "parameter", ctx)).name);
                foot.push((await button(dv.footerWidgets, "Cancel", "cancel", pages.ButtonStyle.Default, node.source === "parameter", ctx)).name);
            }
            for (const ch of node.footer) foot.push(await build(ch, dv.footerWidgets, ctx));
            if (!dv.widgets.length) client.warn(`${ctx.qn}: ${dv.name} has no widgets and shows nothing`);
            const form = dvSettings(dv, node.spec, node.where);
            if (node.spec.showFooter === false && dv.footerWidgets.length) client.warn(`${ctx.qn}: ${dv.name} has footer widgets but "showFooter": false hides them`);
            return `${dv.name} (${ent.qualifiedName}, ${how}, ${editable ? "editable" : "read-only"}${form.length ? ", " + form.join(", ") : ""}) [${inner.join(", ")}${foot.length ? " | footer: " + foot.join(", ") : ""}]`;
        },
        async dataGrid(node, target, ctx) {
            if (node.gridKind === "datagrid2") return dataGrid2(node, target, ctx);
            const ent = node.ent;
            const grid = pages.DataGrid.create(model);
            grid.columns.clear(); // the SDK adds an empty column
            target.push(grid);
            grid.name = node.name;
            node.widget = grid;
            const db = node.source === "database";
            if (!db && bool(node.spec.search, false)) throw new Error(`${node.where}: search works with source database only (a ${node.source} source has no search bar)`);
            const shows = listSource(node, grid, false, ctx);
            const src = grid.dataSource;
            grid.selectionMode = choice(pages.GridSelectionMode, node.spec.selection || "Single", "selection", node.where);
            grid.selectFirst = bool(node.spec.selectFirst, false);
            if (node.spec.rows !== undefined) {
                const n = Number(node.spec.rows);
                if (!Number.isInteger(n) || n < 1) throw new Error(`${node.where}: rows must be a number >= 1`);
                grid.numberOfRows = n;
            }
            const specs = node.spec.columns !== undefined ? list(node.spec.columns, `${node.where}.columns`) : shown(ent);
            const cols = specs.map((c, i) => {
                const s = typeof c === "string" ? { attribute: c } : c;
                if (!s || typeof s !== "object" || !s.attribute) throw new Error(`${node.where} column ${i + 1}: use "Attribute" or { "attribute": ..., "caption": ..., "width": ... }`);
                for (const k of Object.keys(s)) if (!["attribute", "caption", "width", "format", "class"].includes(k)) {
                    if (gridExtras.COLUMN_SETTINGS[k]) throw new Error(`${node.where} column ${i + 1}: ${k} is a Data grid 2 column setting; a classic grid column has caption, width (a weight), format and class (e.g. a theme class for the alignment). Use "kind": "datagrid2" for ${k}`);
                    fail(`${node.where} column ${i + 1}: unknown field '${k}'`, k, ["attribute", "caption", "width", "format", "class"]);
                }
                const path = pathOf(ent, s.attribute, node.where), attr = path.attr;
                if (attr.type instanceof dm.BinaryAttributeType) throw new Error(`${node.where}: '${attr.name}' is binary; a grid column cannot show it`);
                if (s.width !== undefined && !(Number.isInteger(Number(s.width)) && Number(s.width) > 0)) throw new Error(`${node.where} column ${i + 1}: width must be a whole number > 0 (a weight; all columns add up to 100)`);
                if (s.class !== undefined && !/^[\w\s-]*$/.test(String(s.class))) throw new Error(`${node.where} column ${i + 1}: class '${s.class}' is not a CSS class list`);
                return { attr, path, caption: s.caption !== undefined ? String(s.caption) : humanize(attr.name), width: s.width, format: s.format, cls: s.class };
            });
            // widths are weights (Studio Pro: WidthUnit Weight, 100 in total)
            const given = cols.filter(c => c.width !== undefined).reduce((s, c) => s + Number(c.width), 0);
            const open = cols.filter(c => c.width === undefined);
            const share = open.length ? Math.max(1, Math.floor(Math.max(100 - given, open.length) / open.length)) : 0;
            const colFormats = [];
            for (const [i, c] of cols.entries()) {
                const last = open.length && c === open[open.length - 1];
                const width = c.width !== undefined ? Number(c.width) : last ? Math.max(1, 100 - given - share * (open.length - 1)) : share;
                if (!(width > 0)) throw new Error(`${node.where} column ${i + 1}: width must be a number > 0`);
                const col = await classicColumn(grid, c.path, c.caption, width, ctx);
                if (c.format !== undefined) colFormats.push(`${c.path.text}: ${formatInto(col, c.attr, c.format, `${node.where} column ${i + 1}: format`)}`);
                if (c.cls !== undefined) col.appearance.class = String(c.cls);
            }
            // search: Studio Pro's generated grids have a Search button and one search field per text/number/enum column
            const asked = node.spec.search;
            if (Array.isArray(asked) && !db) throw new Error(`${node.where}: search works with source database only`);
            const fields = db && (Array.isArray(asked) || bool(asked, true)) ? await searchFields(src, ent, asked, cols, node, ctx) : 0;
            const sorted = sortOrder(node, db ? src : null, ent);
            if (fields) {
                const b = pages.GridSearchButton.create(model);
                grid.controlBar.items.push(b);
                b.name = ctx.names.next("searchButton");
                await textAll(b.caption.template, "Search", ctx, true);
            } else if (db) src.searchBar.type = pages.SearchBarTypeEnum.None;
            const bar = [];
            for (const [i, b] of list(node.spec.buttons, `${node.where}.buttons`).entries()) bar.push(await gridButton(grid, b, node, ctx, `${node.where} button ${i + 1}`));
            if (!cols.length) client.warn(`${ctx.qn}: ${grid.name} has 0 columns; it shows empty rows (give "columns")`);
            let why = node.kindAsked === "auto" ? `"kind": "auto" picks classic: ${node.autoWhy}` : `"kind": "classic"`;
            if (node.kindAsked === "classic") {
                const d2 = dg2Info();
                if (d2.exemplars.length) why += `; this project uses Data grid 2 (${d2.exemplars.length + d2.stale}x), "kind": "datagrid2" makes one`;
                else if (d2.def) why += `; widgets/ has Data grid 2 ${d2.def.version}, "kind": "datagrid2" makes one`;
            }
            client.warnFirst(`${ctx.qn}: ${grid.name} is a classic Data grid (${why})`);
            return `${grid.name} (classic Data grid, ${shows}${sorted}, ${cols.length} column(s)${cols.some(c => c.path.steps.length) ? ` (${cols.filter(c => c.path.steps.length).map(c => c.path.text).join(", ")} over references)` : ""}${colFormats.length ? `, formats ${colFormats.join("; ")}` : ""}${fields ? `, ${fields} search field(s)` : ""}${bar.length ? `, buttons: ${bar.join(", ")}` : ""})`;
        },
        async listView(node, target, ctx) {
            const ent = node.ent;
            const lv = pages.ListView.create(model);
            target.push(lv);
            lv.name = node.name;
            node.widget = lv;
            const shows = listSource(node, lv, false, ctx);
            let lvMore = sortOrder(node, node.source === "database" ? lv.dataSource : null, ent);
            if (node.spec.search !== undefined) {
                if (node.source !== "database") throw new Error(`${node.where}: search works with source database only`);
                const names = list(node.spec.search, `${node.where}.search`);
                if (!names.length) throw new Error(`${node.where}: search needs attributes: [ "Name", ... ]`);
                for (const n of names) {
                    const path = pathOf(ent, String(n), node.where), a = path.attr;
                    if (!["String", "Integer", "Long", "Decimal", "AutoNumber", "Enum"].includes(typeOf(a))) throw new Error(`${node.where}: search on ${a.name} (${typeOf(a)}) is not possible; a list view searches text, number and enumeration attributes`);
                    lv.dataSource.search.searchRefs.push(attrRefOf(path));
                }
                client.warn(`Forms$ListViewSearch with attributes: first use by ops (SDK layout, no Studio Pro sample); check ${ctx.qn} ${lv.name} in Studio Pro`);
                lvMore += `, search ${names.join(", ")}`;
            }
            if (node.spec.pageSize !== undefined) {
                const n = Number(node.spec.pageSize);
                if (!Number.isInteger(n) || n < 1) throw new Error(`${node.where}: pageSize must be a whole number >= 1`);
                lv.pageSize = n;
            }
            const fields = node.spec.fields !== undefined ? list(node.spec.fields, `${node.where}.fields`) : node.widgets.length ? [] : shown(ent);
            const inner = [];
            for (const f of fields) {
                const path = pathOf(ent, f, node.where);
                inner.push(await build({ kind: "text", spec: { text: `{${path.text}}` }, where: node.where, container: node }, lv.widgets, ctx));
            }
            for (const ch of node.widgets) inner.push(await build(ch, lv.widgets, ctx));
            return `${lv.name} (${shows}${lvMore}) [${inner.join(", ")}]`;
        },
        async actionButton(node, target, ctx) {
            const s = node.spec;
            const action = ACTION_NAMES[String(s.action).toLowerCase().replace(/[\s_-]/g, "")];
            if (!action) fail(`${node.where}: action '${s.action}' is not known (use ${ACTION_LIST.join(" | ")})`, String(s.action), ACTION_LIST);
            const caption = s.caption !== undefined ? String(s.caption) : { save: "Save", cancel: "Cancel", close: "Close page", delete: "Delete", create: "New", signOut: "Sign out" }[action];
            if (caption === undefined) throw new Error(`${node.where}: a ${s.action} button needs 'caption'`);
            const b = pages.ActionButton.create(model);
            target.push(b);
            b.name = node.name || ctx.names.next(action === "close" ? "closePageButton" : "actionButton");
            b.buttonStyle = choice(pages.ButtonStyle, (cssOf(node) === undefined && s.style) || (action === "save" ? "Success" : "Default"), "style", node.where);
            // closes the page by default, except in a data view that listens to a grid (it stays on the page)
            const dvParam = node.container && node.container.kind === "dataView" && !["listen", "context", "association"].includes(node.container.source);
            const spec = Object.fromEntries(Object.entries(s).filter(([k]) => ACTION_KEYS.includes(k)));
            const opts = { button: true, closePage: action === "save" || action === "cancel" ? !!dvParam : false };
            let what = await makeAction(spec, node, ctx, node.where, a => (b.action = a), opts);
            if ((action === "save" || action === "cancel") && !/closes the page/.test(what)) what = what.replace(/^(save|cancel)/, "$1, stays on the page");
            await templateAll(b, "caption", caption, ctx, node.where, s.caption === undefined);
            return `${b.name} (${what})`;
        },
        async dropDownButton(node, target, ctx) {
            return uiFns().dropDownButton(node, target, ctx);
        },
        async tabContainer(node, target, ctx) {
            const tc = pages.TabContainer.create(model);
            if (tc.tabPages.length) tc.tabPages.clear();
            target.push(tc);
            tc.name = node.name || ctx.names.next("tabControl");
            const parts = [];
            for (const t of node.tabs) {
                const tp = pages.TabPage.create(model);
                tc.tabPages.push(tp);
                tp.name = t.name || ctx.names.next("tabPage");
                await textAll(tp.caption, t.caption, ctx);
                const inner = [];
                for (const ch of t.widgets) inner.push(await build(ch, tp.widgets, ctx));
                parts.push(`${tp.name} "${t.caption}": ${inner.join(", ") || "empty"}`);
            }
            return `${tc.name} [${parts.join(" | ")}]`;
        },
        async groupBox(node, target, ctx) {
            const s = node.spec;
            const g = pages.GroupBox.create(model);
            target.push(g);
            g.name = node.name || ctx.names.next("groupBox");
            if (s.caption !== undefined && s.caption !== "") {
                if (!g.caption) g.caption = pages.ClientTemplate.create(model);
                await textTemplate(g.caption, s.caption, node, ctx);
            }
            if (s.collapsible !== undefined) {
                const c = { no: "No", false: "No", expanded: "YesInitiallyExpanded", true: "YesInitiallyExpanded", collapsed: "YesInitiallyCollapsed" }[String(s.collapsible).toLowerCase()];
                if (!c) fail(`${node.where}: collapsible '${s.collapsible}' is not known (use no | expanded | collapsed)`, String(s.collapsible), ["no", "expanded", "collapsed"]);
                g.collapsible = pages.GroupBoxCollapsible[c];
            }
            if (s.headerMode !== undefined) g.headerMode = choice(pages.GroupBoxRenderMode, s.headerMode, "headerMode", node.where);
            const inner = [];
            for (const ch of node.widgets) inner.push(await build(ch, g.widgets, ctx));
            return `${g.name}${s.caption ? ` "${s.caption}"` : ""}${g.collapsible.name !== "No" ? `, collapsible (${g.collapsible.name === "YesInitiallyCollapsed" ? "collapsed" : "expanded"})` : ""} [${inner.join(", ")}]`;
        },
        async snippetCall(node, target, ctx) {
            const qn = String(node.spec.snippet);
            const sn = unitNamed(qn);
            const snippets = () => model.allSnippets().map(x => x.qualifiedName);
            if (!sn) return fail(`${node.where}: no snippet '${qn}'`, qn, snippets());
            if (!(sn instanceof pages.Snippet)) return fail(`${node.where}: '${qn}' is a ${sn.structureTypeName.split("$")[1]}, not a snippet`, qn, snippets());
            if (ctx.page === sn) throw new Error(`${node.where}: a snippet cannot show itself`);
            const full = sn.isLoaded ? sn : await sn.load();
            // native pages show native snippets, web pages web ones
            const tn = require("./theme-native");
            if (ctx.page && tn.isNativeDoc(client, ctx.page) !== tn.isNativeDoc(client, full)) throw new Error(`${node.where}: ${qn} is a ${tn.isNativeDoc(client, full) ? "native" : "web"} snippet; a ${tn.isNativeDoc(client, ctx.page) ? "native" : "web"} ${ctx.page instanceof pages.Snippet ? "snippet" : "page"} shows only ${tn.isNativeDoc(client, ctx.page) ? "native snippets (createSnippet \"native\": true)" : "web snippets"}`);
            const params = pageParams(full);
            if (params.some(p => !p.entity) && node.spec.params === undefined) throw new Error(`${node.where}: ${qn} has parameter(s) ${params.map(p => `${p.name} (${p.type})`).join(", ")}; give "params"`);
            const mapped = await mapParams(node.spec.params, params, node, ctx, qn, "snippet");
            const w = pages.SnippetCallWidget.create(model);
            target.push(w);
            w.name = node.name || ctx.names.next("snippetCall");
            if (!w.snippetCall) pages.SnippetCall.createIn(w);
            w.snippetCall.snippet = sn;
            writeMappings(w.snippetCall.parameterMappings, mapped, "snippet", node, ctx);
            return `${w.name} (snippet ${qn}${params.length ? `, ${mapped.length ? mapText(mapped).slice(1, -1) : `${params.map(p => p.name).join(", ")} from the object around it`}` : ""})`;
        },
        async image(node, target, ctx) {
            const s = node.spec;
            if (s.image !== undefined && s.association !== undefined) throw new Error(`${node.where}: give "image" (a static image) or "association" (the image of a referenced object), not both`);
            let w, what;
            if (s.image !== undefined) {
                const img = await imageNamed(String(s.image), node.where);
                w = pages.StaticImageViewer.create(model);
                target.push(w);
                w.name = node.name || ctx.names.next("staticImage");
                w.image = img;
                what = `static ${s.image}`;
            } else {
                const dc = node.container;
                if (!dc || !dc.ent) throw new Error(`${node.where}: give "image": "Module.Images.Logo" (a static image), or put the image in a data view, list view or gallery of an entity that inherits System.Image`);
                let other = null, assoc = null;
                if (s.association !== undefined) {
                    ({ assoc, other } = await reference(dc.ent, s.association, node.where, "an image over an association"));
                    if (!inherits(other, "System.Image")) throw new Error(`${node.where}: ${other.qualifiedName} does not inherit System.Image, so it has no image to show`);
                } else if (!inherits(dc.ent, "System.Image")) throw new Error(`${node.where}: ${dc.ent.qualifiedName} does not inherit System.Image; give "association" to an image entity, or "image": "Module.Images.Logo" for a static image`);
                w = pages.DynamicImageViewer.create(model);
                target.push(w);
                w.name = node.name || ctx.names.next("imageViewer");
                if (w.clickAction) w.clickAction.disabledDuringExecution = false; // as Studio Pro
                if (s.width === undefined) {
                    w.widthUnit = pages.ImageSizeUnit.Percentage; // Studio Pro's default: 100%
                    w.width = 100;
                }
                const src = pages.ImageViewerSource.createInEntityWidgetUnderDataSource(w);
                if (assoc) {
                    const er = dm.IndirectEntityRef.createInEntityPathSourceUnderEntityRef(src);
                    const st = dm.EntityRefStep.createIn(er);
                    st.association = assoc;
                    st.destinationEntity = other;
                    what = `image of ${s.association}`;
                } else {
                    dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(src).entity = dc.ent;
                    what = `image of the ${dc.ent.name}`;
                }
            }
            what += imageSize(w, s.width, "width", node.where) + imageSize(w, s.height, "height", node.where);
            return `${w.name} (${what})`;
        },
        async referenceSelector(node, target, ctx) {
            const s = node.spec, dv = node.container;
            const { assoc, other } = await reference(dv.ent, s.association, node.where, "a reference selector");
            const attr = captionAttr(other, s.attribute, node.where, [dm.StringAttributeType, dm.EnumerationAttributeType, dm.IntegerAttributeType, dm.LongAttributeType, dm.DecimalAttributeType, dm.AutoNumberAttributeType, dm.DateTimeAttributeType, dm.BooleanAttributeType], assoc);
            const w = pages.ReferenceSelector.create(model);
            target.push(w);
            w.name = node.name || ctx.names.next("referenceSelector");
            const ref = dm.AttributeRef.create(model);
            w.attributeRef = ref;
            ref.attribute = attr;
            const st = dm.EntityRefStep.createIn(dm.IndirectEntityRef.createInMemberRefUnderEntityRef(ref));
            st.association = assoc;
            st.destinationEntity = other;
            const sel = await selectable(w, node, other, ctx) + (await selectPage(w, node, other, ctx));
            if (w.validation) await h.text(w.validation.message, ""); // Studio Pro stores one empty text
            if (w.onChangeAction) w.onChangeAction.disabledDuringExecution = false; // as Studio Pro
            const label = s.label !== undefined ? s.label : humanize(other.name);
            await templateAll(w, "labelTemplate", label, ctx, node.where);
            inputSource(w, dv);
            ctx.count.inputs++;
            const more = await inputExtras(node, w, null, ctx, String(label));
            return `${w.name} (${s.association} -> ${other.name}.${attr.name}${sel}${more.length ? ", " + more.join(", ") : ""}${await onChange(node, w, ctx)})`;
        },
        async referenceSetSelector(node, target, ctx) {
            const s = node.spec, dv = node.container;
            const { assoc, other } = await referenceSet(dv.ent, s.association, node.where, ctx);
            const attr = captionAttr(other, s.attribute, node.where, [dm.StringAttributeType, dm.EnumerationAttributeType, dm.IntegerAttributeType, dm.LongAttributeType, dm.DecimalAttributeType, dm.AutoNumberAttributeType, dm.DateTimeAttributeType, dm.BooleanAttributeType], assoc);
            const w = pages.InputReferenceSetSelector.create(model);
            target.push(w);
            w.name = node.name || ctx.names.next("referenceSetSelector");
            const ref = dm.AttributeRef.create(model);
            w.attributeRef = ref;
            ref.attribute = attr;
            const st = dm.EntityRefStep.createIn(dm.IndirectEntityRef.createInMemberRefUnderEntityRef(ref));
            st.association = assoc;
            st.destinationEntity = other;
            const sel = await selectable(w, node, other, ctx) + (await selectPage(w, node, other, ctx));
            if (w.onChangeAction) w.onChangeAction.disabledDuringExecution = false; // as Studio Pro
            await templateAll(w, "labelTemplate", s.label !== undefined ? s.label : humanize(other.name), ctx, node.where);
            inputSource(w, dv);
            ctx.count.inputs++;
            return `${w.name} (reference set ${s.association} -> ${other.name}.${attr.name}${sel}${await onChange(node, w, ctx)})`;
        },
        async comboBox(node, target, ctx) {
            const s = node.spec, dv = node.container;
            if ((s.attribute === undefined) === (s.association === undefined)) throw new Error(`${node.where}: give "attribute" (an enumeration or Boolean) or "association" (a reference), one of them`);
            if (s.captionAttribute !== undefined && s.association === undefined) throw new Error(`${node.where}: captionAttribute goes with association`);
            let mode, attr = null, assoc = null, other = null, cap = null;
            if (s.attribute !== undefined) {
                attr = attributeOf(dv.ent, s.attribute, node.where);
                mode = attr.type instanceof dm.EnumerationAttributeType ? "enumeration" : attr.type instanceof dm.BooleanAttributeType ? "boolean" : null;
                if (!mode) throw new Error(`${node.where}: a combo box shows an enumeration or Boolean attribute, or a reference ("association"); ${attr.name} is ${typeName(attr)}. Use "widget": "input"`);
            } else {
                ({ assoc, other } = await reference(dv.ent, s.association, node.where, "a combo box"));
                cap = captionAttr(other, s.captionAttribute, node.where, [dm.StringAttributeType], null, true);
                mode = "association";
            }
            const alt = `use "widget": "${mode === "association" ? "referenceSelector" : mode === "boolean" ? "checkBox" : "dropDown"}" (a classic widget, works in every project)`;
            const info = plLive(COMBOBOX);
            if (!info.ok) throw new Error(`${node.where}: a combo box is not possible here: ${info.reason}; ${alt}`);
            const base = await basePluggable(info, COMBOBOX, node, target, ctx, "combo box", alt);
            const { w, props } = base;
            const key = { enumeration: "attributeEnumeration", boolean: "attributeBoolean", association: "attributeAssociation" }[mode];
            for (const k of ["optionsSourceType", key, ...(other ? ["optionsSourceAssociationDataSource", "optionsSourceAssociationCaptionAttribute"] : [])]) if (!props.has(k)) throw new Error(`${node.where}: Combo box ${info.def.version} has no '${k}' property; ${alt}`);
            if (!base.fresh) for (const p of w.object.properties) await blank(p.value, p.type, null, true);
            const type = props.get("optionsSourceType").value;
            if (!type.type.enumerationValues.some(e => e.key === mode)) throw new Error(`${node.where}: Combo box ${info.def.version} has no ${mode} mode; ${alt}`);
            type.primitiveValue = mode;
            const attrRef = (v, a) => {
                const r = dm.AttributeRef.create(model);
                v.attributeRef = r;
                r.attribute = a;
            };
            if (attr) attrRef(props.get(key).value, attr);
            else {
                const st = dm.EntityRefStep.createIn(dm.IndirectEntityRef.createInWidgetValueUnderEntityRef(props.get(key).value));
                st.association = assoc;
                st.destinationEntity = other;
                const ds = cw.CustomWidgetXPathSource.createInWidgetValueUnderDataSource(props.get("optionsSourceAssociationDataSource").value);
                dm.DirectEntityRef.createInEntityPathSourceUnderEntityRef(ds).entity = other;
                props.get("optionsSourceAssociationCaptionAttribute").value.attributeRef = attrRefOf(cap);
            }
            put(w, "editable", pages.EditableEnum.Always);
            if (sysProps(w).includes("Label")) w.labelTemplate = pages.ClientTemplate.create(model); // not the original's texts
            if (sysProps(w).includes("Label")) await templateAll(w, "labelTemplate", s.label !== undefined ? s.label : humanize(attr ? attr.name : other.name), ctx, node.where);
            leftovers(w, [dv.ent, ...(other ? [other] : []), ...(cap ? cap.steps.map(st => st.to) : [])], node.where, "combo box", alt);
            ctx.count.inputs++;
            let oc = "";
            if (s.onChange !== undefined) {
                if (!props.has("onChangeEvent")) throw new Error(`${node.where}: Combo box ${info.def.version} has no on change event`);
                const v = props.get("onChangeEvent").value;
                oc = ", on change: " + (await makeAction(s.onChange, node, ctx, `${node.where}: onChange`, a => (v.action = a)));
            }
            client.warnFirst(`${ctx.qn}: ${w.name} is a Combo box ${info.def.version}, ${base.from}`);
            return `${w.name} (Combo box ${info.def.version}, ${attr ? attr.name : `${s.association} -> ${other.name}.${cap.text}`}${oc})`;
        },
        async templateGrid(node, target, ctx) {
            const s = node.spec, ent = node.ent;
            const tg = pages.TemplateGrid.create(model);
            target.push(tg);
            tg.name = node.name;
            node.widget = tg;
            const shows = listSource(node, tg, false, ctx);
            const tgSearch = s.search !== undefined && (Array.isArray(s.search) || bool(s.search, false));
            if (tgSearch && node.source !== "database") throw new Error(`${node.where}: search works with source database only`);
            let tgFields = 0;
            if (tgSearch) {
                const all = h.attributeChain(ent).attributes.map(a => ({ attr: a, caption: humanize(a.name) }));
                tgFields = await searchFields(tg.dataSource, ent, Array.isArray(s.search) ? s.search : true, all, node, ctx);
                if (!tgFields) throw new Error(`${node.where}: ${ent.qualifiedName} has no text, number or enumeration attribute to search on`);
            } else if (node.source === "database") tg.dataSource.searchBar.type = pages.SearchBarTypeEnum.None; // no search fields
            const tgSorted = sortOrder(node, node.source === "database" ? tg.dataSource : null, ent);
            const num = (v, k, max) => {
                const n = Number(v);
                if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${node.where}: ${k} must be a whole number 1-${max}`);
                return n;
            };
            tg.numberOfColumns = s.columns !== undefined ? num(s.columns, "columns", 12) : 2; // Studio Pro's default
            tg.numberOfRows = s.rows !== undefined ? num(s.rows, "rows", 1000) : 3;
            tg.selectionMode = choice(pages.GridSelectionMode, s.selection || "Single", "selection", node.where);
            tg.selectFirst = bool(s.selectFirst, false);
            const fields = node.widgets.length ? [] : shown(ent);
            const inner = [];
            for (const f of fields) inner.push(await build({ kind: "text", spec: { text: `{${f}}` }, where: node.where, container: node }, tg.contents.widgets, ctx));
            for (const ch of node.widgets) inner.push(await build(ch, tg.contents.widgets, ctx));
            const bar = [];
            if (tgFields) {
                const b = pages.GridSearchButton.create(model);
                tg.controlBar.items.push(b);
                b.name = ctx.names.next("searchButton");
                await textAll(b.caption.template, "Search", ctx, true);
                bar.push(`${b.name} (search, ${tgFields} field(s))`);
            }
            for (const [i, b] of list(s.buttons, `${node.where}.buttons`).entries()) bar.push(await gridButton(tg, b, node, ctx, `${node.where} button ${i + 1}`));
            if (!bar.length) tg.isControlBarVisible = false;
            client.warn(`Forms$TemplateGrid first use by ops: layout as the Studio Pro 10.24 / 11.12 samples; check ${ctx.qn} ${tg.name} in Studio Pro`);
            return `${tg.name} (template grid, ${shows}${tgSorted}, ${tg.numberOfColumns} x ${tg.numberOfRows}, selection ${tg.selectionMode.name}${bar.length ? `, buttons: ${bar.join(", ")}` : ""}) [${inner.join(", ")}]`;
        },
        async gallery(node, target, ctx) {
            const s = node.spec, ent = node.ent;
            const info = plLive(GALLERY);
            const alt = `use "widget": "listView" (works in every project)`;
            if (!info.ok) throw new Error(`${node.where}: a gallery is not possible here: ${info.reason}; ${alt}`);
            const selName = { single: "Single", multi: "Multi", none: "None" }[String(s.selection || "Single").toLowerCase()];
            if (!selName) fail(`${node.where}: selection '${s.selection}' is not known (use Single | Multi | None)`, String(s.selection), ["Single", "Multi", "None"]);
            const num = (v, k, max) => {
                const n = Number(v);
                if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${node.where}: ${k} must be a whole number 1-${max}`);
                return String(n);
            };
            const pageSize = s.pageSize !== undefined ? num(s.pageSize, "pageSize", 10000) : null;
            const cols = s.columns !== undefined ? num(s.columns, "columns", 12) : null;
            if (s.xpath) checkXPath(node, ent);
            const base = await basePluggable(info, GALLERY, node, target, ctx, "gallery", alt);
            const { w, props } = base;
            for (const k of ["datasource", "content", "itemSelection"]) if (!props.has(k)) throw new Error(`${node.where}: Gallery ${info.def.version} has no '${k}' property; ${alt}`);
            if (!base.fresh) for (const p of w.object.properties) await blank(p.value, p.type, null, true);
            const shows = listSource(node, props.get("datasource").value, true, ctx) + sortOrder(node, props.get("datasource").value.dataSource, ent);
            const sel = props.get("itemSelection").value;
            if (!sel.type.selectionTypes.some(x => x.name === selName)) throw new Error(`${node.where}: this gallery has no selection ${selName}`);
            sel.selection = cw.CustomWidgetSelectionType[selName];
            if (pageSize && props.has("pageSize")) props.get("pageSize").value.primitiveValue = pageSize;
            if (cols && props.has("desktopItems")) props.get("desktopItems").value.primitiveValue = cols;
            leftovers(w, [ent], node.where, "gallery", alt);
            // the content: one text per attribute, or the given widgets, in the context of an item
            const content = props.get("content").value.widgets;
            const fields = node.widgets.length ? [] : shown(ent);
            const inner = [];
            for (const f of fields) inner.push(await build({ kind: "text", spec: { text: `{${f}}` }, where: node.where, container: node }, content, ctx));
            for (const ch of node.widgets) inner.push(await build(ch, content, ctx));
            const click = s.onClick !== undefined ? `, on click: ${await pluggableClick(node, props, ctx)}` : "";
            const hf = s.headerFilters !== undefined ? await GX().headerFilters(w, ent, s.headerFilters, node, ctx, node.where) : [];
            client.warnFirst(`${ctx.qn}: ${w.name} is a Gallery ${info.def.version}, ${base.from}`);
            return `${w.name} (Gallery ${info.def.version}, ${shows}, selection ${selName}${click}${hf.length ? "; " + hf.join("; ") : ""}) [${inner.join(", ")}]`;
        },
        async input(node, target, ctx) {
            const s = node.spec;
            let w, attr = null, what;
            if (s.variable !== undefined) {
                if (s.attribute !== undefined) throw new Error(`${node.where}: give attribute or variable, not both`);
                w = await varInput(node, target, ctx);
                what = `page variable ${s.variable}`;
            } else {
                if (s.attribute === undefined || s.attribute === "") throw new Error(`${node.where}: ${node.kind} needs 'attribute' (or "variable": a page variable)`);
                const path = pathOf(node.container.ent, s.attribute, node.where);
                attr = path.attr;
                w = await attrInput(node.kind, target, path, node.container, node.where, ctx, s.label, node.name);
                what = path.steps.length ? path.text : "";
            }
            const bits = what ? [what] : [];
            if (NOTES.has(w) && s.editable === undefined) bits.push(NOTES.get(w));
            bits.push(...(await inputExtras(node, w, attr, ctx, s.label !== undefined ? String(s.label) : humanize(attr ? attr.name : String(s.variable)))));
            const oc = await onChange(node, w, ctx);
            if (oc) bits.push(oc.slice(2));
            return bits.length ? `${w.name} (${bits.join("; ")})` : w.name;
        }
    };
    for (const k of Object.keys(INPUTS)) BUILD[k] = BUILD.input;

    // Builds node into target, then its common fields (visible, class, style, editable) on the widget it made.
    async function build(node, target, ctx) {
        let first = null;
        const at = { push: w => (first = first || w, target.push(w)) };
        const text = await BUILD[node.kind](node, at, ctx);
        const extra = first && node.spec ? await common(node, first, ctx) : [];
        return extra.length ? `${text} {${extra.join("; ")}}` : text;
    }

    // ------------------------------------------------ navigation

    // A navigation profile by name or kind (Responsive, Tablet, Phone, ...; "native" = the native mobile profile).
    // native: a native profile is allowed (bottom bar, native home page), else refused.
    async function navProfile(name, where, native = false) {
        const doc = model.allNavigationDocuments()[0];
        if (!doc) throw new Error(`${where}: the project has no navigation document`);
        const nav = await doc.load();
        const want = String(name || "Responsive");
        const isNative = p => !(p instanceof navigation.NavigationProfile);
        const label = p => `${p.name} (${p.kind ? p.kind.name : "native"})`;
        const hit = nav.profiles.find(p => p.name.toLowerCase() === want.toLowerCase()) ||
            nav.profiles.find(p => p.kind && String(p.kind.name).toLowerCase() === want.toLowerCase()) ||
            (/^native/i.test(want) ? nav.profiles.find(isNative) : null);
        if (!hit && /^native/i.test(want)) throw new Error(`${where}: this project has no native navigation profile (profiles: ${nav.profiles.map(label).join(", ")}); add one in Studio Pro (App > Navigation > Add navigation profile > Native mobile) with a native layout, then give "profile": "Native"`);
        if (!hit) fail(`${where}: no navigation profile '${want}' (profiles: ${nav.profiles.map(label).join(", ")})`, want, nav.profiles.map(p => p.name));
        if (isNative(hit) && !native) throw new Error(`${where}: '${hit.name}' is a native profile; it has bottom bar items and a native home page (addMenuItem / setHomePage with a native page), not this`);
        return hit;
    }
    const isNativePage = page => !!(page.layoutCall && layoutInfo(page.layoutCall.layoutQualifiedName).native);

    const captionOf = t => (t && t.translations.length ? t.translations[0].text : "");
    function menuItems(items, out = [], depth = 0) {
        for (const it of items) {
            out.push({ item: it, depth });
            menuItems(it.items, out, depth + 1);
        }
        return out;
    }
    const opens = (it, qn) => it.action instanceof pages.PageClientAction && it.action.pageSettings && it.action.pageSettings.pageQualifiedName === qn;

    async function menuItem(o, where, ctx) {
        if (o.action !== undefined) return actionMenuItem(o, where, ctx);
        if (o.page === undefined && !o.pageObj) throw new Error(`${where}: give "page" (the page it opens) or "action" (e.g. "signOut", { "action": "openLink", "url": "https://..." })`);
        const page = o.pageObj || (await h.get(o.page));
        if (!(page instanceof pages.Page)) throw new Error(`${where}: '${o.page}' is not a page`);
        if (page.parameters.length) throw new Error(`${where}: ${page.qualifiedName} has a page parameter (${page.parameters.map(p => p.name).join(", ")}); a menu item can only open a page without parameters`);
        const native = isNativePage(page);
        const profile = await navProfile(o.profile !== undefined ? o.profile : native ? "native" : undefined, where, true);
        if (!(profile instanceof navigation.NavigationProfile)) return bottomBarItem(profile, page, o, where, ctx);
        if (native) throw new Error(`${where}: ${page.qualifiedName} is a native page; it goes in the native profile's bottom bar ("profile": "Native")`);
        const all = menuItems(profile.menuItemCollection.items);
        if (all.some(x => opens(x.item, page.qualifiedName))) throw new Error(`${where}: ${page.qualifiedName} is already in the ${profile.name} menu`);
        let items = profile.menuItemCollection.items;
        let under = "";
        if (o.parent) {
            const p = all.find(x => x.item.caption.translations.some(t => t.text.toLowerCase() === String(o.parent).toLowerCase()));
            if (!p) fail(`${where}: no menu item '${o.parent}' in the ${profile.name} menu`, o.parent, all.map(x => captionOf(x.item.caption)).filter(Boolean));
            if (p.depth >= 2) throw new Error(`${where}: '${o.parent}' is already 3 levels deep; pick a higher menu item`);
            items = p.item.items;
            under = ` > ${captionOf(p.item.caption)}`;
            if (!(p.item.action instanceof pages.NoClientAction)) client.warn(`${where}: menu item '${o.parent}' opens something itself; menu items with sub-items usually have no action`);
        }
        const item = menus.MenuItem.create(model);
        items.push(item);
        const caption = o.caption !== undefined ? String(o.caption) : captionOf(page.title) || humanize(page.name);
        await textAll(item.caption, caption, ctx);
        const a = pages.PageClientAction.createInMenuItemUnderAction(item);
        a.disabledDuringExecution = false; // what Studio Pro writes for menu items
        a.pageSettings.page = page;
        const seen = await menuRoleLint(where, page, caption);
        return `${profile.name} menu${under}: "${caption}" -> ${page.qualifiedName} (${seen})`;
    }

    // A menu item with another action than opening a page: sign out, open a link, call a flow without object
    // parameters, create an object, sync (the action model of buttons; nothing is around a menu item)
    async function actionMenuItem(o, where, ctx) {
        if (o.page !== undefined) throw new Error(`${where}: give page or action, not both (an action "showPage" takes its own "page")`);
        if (o.caption === undefined) throw new Error(`${where}: a menu item with an action needs "caption"`);
        const profile = await navProfile(o.profile, where);
        const all = menuItems(profile.menuItemCollection.items);
        let items = profile.menuItemCollection.items, under = "";
        if (o.parent) {
            const p = all.find(x => x.item.caption.translations.some(t => t.text.toLowerCase() === String(o.parent).toLowerCase()));
            if (!p) fail(`${where}: no menu item '${o.parent}' in the ${profile.name} menu`, o.parent, all.map(x => captionOf(x.item.caption)).filter(Boolean));
            if (p.depth >= 2) throw new Error(`${where}: '${o.parent}' is already 3 levels deep; pick a higher menu item`);
            items = p.item.items;
            under = ` > ${captionOf(p.item.caption)}`;
        }
        const c = ctx || { qn: `${profile.name} menu`, untranslated: 0, after: [], names: names(), params: new Map(), vars: new Map(), scope: [], count: { inputs: 0 } };
        const item = menus.MenuItem.create(model);
        items.push(item);
        await textAll(item.caption, String(o.caption), c);
        const text = await makeAction(o.action, { container: null, name: String(o.caption) }, c, where, a => (item.action = a), { button: true });
        for (const f of c.after) f();
        return `${profile.name} menu${under}: "${o.caption}" -> ${text}`;
    }

    // A bottom bar item of a native profile (G13): caption + a native page (Studio Pro: Navigation > Native > Bottom bar)
    async function bottomBarItem(profile, page, o, where, ctx) {
        if (!isNativePage(page)) throw new Error(`${where}: ${page.qualifiedName} is a web page; the native bottom bar opens native pages (createPage "native": true)`);
        if (o.parent !== undefined) throw new Error(`${where}: a native bottom bar has no sub-items; leave out parent`);
        if (profile.bottomBarItems.some(b => b.pageQualifiedName === page.qualifiedName)) throw new Error(`${where}: ${page.qualifiedName} is already in the ${profile.name} bottom bar`);
        // the place: after / before the item with that caption (default: at the end)
        const items = profile.bottomBarItems;
        const capOf = b => captionOf(b.caption) || (b.pageQualifiedName || "").split(".").pop();
        let at = items.length;
        for (const k of ["after", "before"]) {
            if (o[k] === undefined) continue;
            if (o.after !== undefined && o.before !== undefined) throw new Error(`${where}: give after or before, not both`);
            const i = items.findIndex(b => capOf(b).toLowerCase() === String(o[k]).toLowerCase());
            if (i < 0) fail(`${where}: the ${profile.name} bottom bar has no item '${o[k]}'`, String(o[k]), items.map(capOf));
            at = k === "after" ? i + 1 : i;
        }
        const item = sdk.nativepages.BottomBarItem.create(model);
        items.splice(at, 0, item);
        const caption = o.caption !== undefined ? String(o.caption) : captionOf(page.title) || humanize(page.name);
        await textAll(item.caption, caption, ctx);
        item.page = page;
        const icon = o.icon !== undefined ? await require("./ops-native-ui").iconOf(h, model, o.icon, where) : null;
        if (icon) item.icon = icon.icon;
        client.warnFirst(`NativePages$BottomBarItem first use by ops (no Studio Pro sample in the test projects): check the ${profile.name} profile in Studio Pro`);
        const seen = await menuRoleLint(where, page, caption);
        return `${profile.name} bottom bar: "${caption}" -> ${page.qualifiedName}${icon ? `, ${icon.text}` : ""}${at < items.length - 1 ? `, place ${at + 1} of ${items.length}` : ""} (${seen})`;
    }

    async function projectSecurity() {
        const s = model.allProjectSecurities()[0];
        return s ? s.load() : null;
    }

    const securityOff = sec => !sec || sec.securityLevel === sdk.security.SecurityLevel.CheckNothing;

    // A menu item shows only for users whose user role has one of the page's module roles (everyone while app
    // security is off). Returns "seen by: ..." for the dry-run line.
    async function menuRoleLint(where, page, caption) {
        const pr = page.allowedRolesQualifiedNames;
        const sec = await projectSecurity();
        const later = securityOff(sec) ? " once app security is on" : "";
        const users = sec ? sec.userRoles : [];
        const seen = users.filter(u => u.moduleRolesQualifiedNames.some(r => pr.includes(r))).map(u => u.name);
        const hidden = users.filter(u => !seen.includes(u.name)).map(u => u.name);
        if (!pr.length) client.warn(`${where}: ${page.qualifiedName} allows no module roles, so the menu item "${caption}" is hidden for every user${later} (give the page roles: grantAccess)`);
        else if (users.length && !seen.length) client.warn(`${where}: no user role has ${pr.join(" or ")}, so the menu item "${caption}" is hidden for every user${later} (addModuleRoles: { "userRole": "${users[0].name}", "moduleRoles": ["${pr[0]}"] })`);
        else if (hidden.length) client.warn(`${where}: the menu item "${caption}" shows only for user roles with ${pr.join(" or ")}; it is hidden for ${hidden.join(", ")}${later}`);
        return later ? `seen by: everyone while app security is off; then ${seen.join(", ") || "nobody"}` : `seen by: ${seen.join(", ") || "nobody"}`;
    }

    // Lints for the roles of a new page: roles of its own module, that reach users and read the entities the page shows.
    async function roleLints(qn, roles, ents) {
        if (!roles.length) return;
        const sec = await projectSecurity();
        const off = sec && securityOff(sec) ? " once app security is on" : "";
        const mod = qn.split(".")[0];
        for (const r of roles) {
            if (!r.startsWith(mod + ".")) client.warn(`${qn}: ${r} is a role of another module; Studio Pro lets a page use only roles of its own module (${mod}.*)`);
            if (sec && !sec.userRoles.some(u => u.moduleRolesQualifiedNames.includes(r))) client.warn(`${qn}: module role ${r} is in no user role, so no user can open the page${off} (addModuleRoles: { "userRole": "${(sec.userRoles[0] || { name: "Administrator" }).name}", "moduleRoles": ["${r}"] })`);
            for (const e of ents) {
                let ok = false, unknown = false;
                for (let x = e, i = 0; x && i < 20 && !ok; i++) {
                    ok = x.accessRules.some(a => a.moduleRolesQualifiedNames.includes(r));
                    const g = x.generalization;
                    if (g instanceof dm.Generalization && g.generalization && !g.generalization.isLoaded) unknown = true;
                    x = g instanceof dm.Generalization && g.generalization && g.generalization.isLoaded ? g.generalization : null;
                }
                if (!ok && !unknown) client.warn(`${qn}: ${r} has no access rule on ${e.qualifiedName}; with production security the page shows no ${e.name} data for it (addAccessRule)`);
            }
        }
    }

    // ------------------------------------------------ operations

    let madeFlows = []; // nanoflows a createPage made (Data grid 2 export), removed when it fails
    async function createPage(o) {
        validName(o.name, "page name");
        const qn = `${o.module}.${o.name}`;
        if (unitNamed(qn)) throw new Error(`${qn} already exists`);
        // folders of o.folder that exist now: a failed createPage removes the ones it made (and the page)
        const existed = new Set();
        let f = model.allModules().find(m => m.name === o.module);
        for (const part of String(o.folder || "").split(/[/\\]/).filter(Boolean)) if ((f = f && f.folders.find(x => x.name === part))) existed.add(f);
        const leaf = h.folder(o.module, o.folder); // fails with "did you mean" for a wrong module before anything is created
        try {
            madeFlows = [];
            const r = await widgetPage(o, qn);
            if (o.roles) await h.grantAccess({ document: qn, roles: o.roles });
            if (o.roles) for (const f of r.ctx.flows || []) await h.grantAccess({ document: f, roles: o.roles });
            const extra = [];
            if (o.menu !== undefined && o.menu !== false) {
                const m = o.menu === true ? {} : typeof o.menu === "string" ? { profile: o.menu } : o.menu;
                if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error(`${qn}: menu is "Responsive" or { "profile": ..., "caption": ..., "parent": ... }`);
                if (m.roles !== undefined) throw new Error(`${qn}: ${NO_MENU_ROLES(qn)}`);
                for (const k of Object.keys(m)) if (!["profile", "caption", "parent"].includes(k)) fail(`${qn}: unknown menu field '${k}'`, k, ["profile", "caption", "parent"]);
                extra.push("menu: " + (await menuItem({ ...m, page: qn, pageObj: await h.get(qn) }, `${qn} menu`, r.ctx)));
            }
            await roleLints(qn, [].concat(o.roles || []), r.ctx.ents);
            const ls = await languages();
            if (r.ctx.untranslated && ls.length > 1) client.warn(`${qn}: ${r.ctx.untranslated} text(s) are not in every project language (${ls.join(", ")}); give them per language ({ "${ls[0]}": "...", "${ls[1]}": "..." }) or translate them with setTranslations (texts ${qn} --missing ${ls[1]})`);
            return r.text + extra.map(x => "\n      " + x).join("");
        } catch (e) {
            const p = unitNamed(qn);
            if (p) p.delete();
            for (const f of madeFlows) if (unitNamed(f)) unitNamed(f).delete();
            for (let x = leaf; x instanceof sdk.projects.Folder && !existed.has(x);) {
                const up = x.container;
                x.delete();
                x = up;
            }
            throw e;
        }
    }

    // A page from a widget list; without "widgets": an edit form (one data view of the entity) or an empty page.
    async function widgetPage(o, qn) {
        const form = o.widgets === undefined && o.from === undefined;
        if (form && o.fields !== undefined && !o.entity) throw new Error(`${qn}: 'fields' needs 'entity'`);
        if (!form) for (const k of ["fields", "buttons"]) if (o[k] !== undefined) throw new Error(`${qn}: '${k}' goes in a dataView widget when 'widgets' is given`);
        if (o.arrange !== undefined && !/^(auto|rows)$/i.test(String(o.arrange))) fail(`${qn}: arrange must be auto or rows`, o.arrange, ["auto", "rows"]);
        const specs = !form ? o.widgets || [] : !o.entity ? [] : [{ widget: "dataView", ...(o.fields !== undefined ? { fields: o.fields } : {}), ...(o.buttons !== undefined ? { buttons: o.buttons } : {}) }];
        const nodes = [];
        // native pages: a native layout and the widgets native pages have (ops-native-ui.js)
        // "native": true, or the kind of native layout: popup | fullPage | topBarOnly | sideMenu | default
        const NATIVE_LAYOUTS = { popup: /NativePhone_PopOver$|PopOver$|Popup$/i, fullpage: /FullPage$/i, topbaronly: /TopBarOnly$/i, sidemenu: /SideMenu$/i, default: /NativePhone_Default$/i };
        const nativeKind = typeof o.native === "string" && !/^(true|false)$/i.test(o.native) ? String(o.native).toLowerCase().replace(/[\s_-]/g, "") : null;
        if (nativeKind && !NATIVE_LAYOUTS[nativeKind]) fail(`${qn}: native '${o.native}' is not a native page kind (true, popup, fullPage, topBarOnly, sideMenu, default)`, String(o.native), ["popup", "fullPage", "topBarOnly", "sideMenu", "default"]);
        if (nativeKind && o.layout !== undefined) throw new Error(`${qn}: give "native": "${o.native}" or "layout", not both`);
        const nativeAsked = !!nativeKind || bool(o.native, false) || (o.layout !== undefined && layoutInfo(String(o.layout)).native);
        const wasPlatform = setPlatform(nativeAsked ? "native" : "web");
        let top;
        try {
            top = scan(specs, form ? "form" : "widgets", null, nodes);
        } finally {
            setPlatform(wasPlatform);
        }
        if (!top.length && !form && o.from === undefined) throw new Error(`${qn}: 'widgets' is empty; leave it out for an empty page`);
        if (nativeAsked) {
            require("./ops-native-ui").checkNativeNodes(nodes);

            if (o.from !== undefined) throw new Error(`${qn}: "from" makes web pages; leave it out for a native page`);
        }
        const ctx = { qn, names: names(), params: new Map(), vars: new Map(), count: { inputs: 0 }, untranslated: 0, ents: new Set(), scope: nodes, after: [], folder: o.folder, flows: [] };
        madeFlows = ctx.flows;
        await prepareAssocs(ctx);
        // sources; entities of lists that do not depend on the object around them, grid kinds, names (given ones first,
        // also tab pages; then grids, list views and galleries in page order, which listenTo needs); then every source
        prepare(nodes);
        for (const n of nodes) if (LISTENS.includes(n.kind)) await listEntity(n, { dflt: o.entity });
        for (const n of nodes) if (n.kind === "dataGrid") gridKind(n);
        for (const n of nodes) if (n.name) ctx.names.reserve(n.name, n.where);
        for (const n of nodes) for (const t of n.tabs || []) if (t.name) ctx.names.reserve(t.name, t.where);
        for (const n of nodes) if (!n.name && LISTENS.includes(n.kind)) n.name = ctx.names.next(n.gridKind === "datagrid2" ? "dataGrid2_" : PREFIX[n.kind]);
        await resolveSources(nodes, { dflt: o.entity, ctx });
        for (const n of nodes) if (n.ent) ctx.ents.add(n.ent);
        // a grid or list view followed by the data view that listens to it: side by side (8/4)
        let arranged = top;
        if (!/^rows$/i.test(String(o.arrange || ""))) {
            arranged = [];
            for (let i = 0; i < top.length; i++) {
                const a = top[i], b = top[i + 1];
                if (b && b.kind === "dataView" && b.target === a) {
                    arranged.push({ kind: "layoutGrid", spec: {}, where: `${a.where} + ${b.where}`, rows: [[{ weight: 8, tablet: -1, phone: -1, widgets: [a] }, { weight: 4, tablet: -1, phone: -1, widgets: [b] }]] });
                    i++;
                } else arranged.push(a);
            }
        }
        const withParameter = nodes.some(n => n.kind === "dataView" && n.source === "parameter");
        const tpl = o.from !== undefined ? await templateOf(String(o.from), qn) : null;
        let wantLayout = o.layout !== undefined ? String(o.layout) : tpl && tpl.layout ? tpl.layout : undefined;
        if (nativeAsked && !wantLayout) {
            const natives = nativeLayouts();
            if (!natives.length) throw new Error(`${qn}: this project has no native layout (Atlas NativePhone_*), so it has no native pages; add a native navigation profile and layout in Studio Pro`);
            const used = layoutUse().filter(u => natives.includes(u.layout)).map(u => u.layout);
            if (nativeKind) {
                // a pop-up: the native layout whose LayoutType is Popup (Atlas NativePhone_PopOver), else by name
                const popup = nativeKind === "popup" ? natives.find(l => layoutTypeOf(l) === "Popup") : null;
                wantLayout = popup || natives.find(l => NATIVE_LAYOUTS[nativeKind].test(l)) || null;
                if (!wantLayout) throw new Error(`${qn}: this project has no ${o.native} native layout (native layouts: ${natives.join(", ")}); give "layout" with one of them`);
            } else wantLayout = used[0] || natives.find(l => /NativePhone_Default$/.test(l)) || natives[0];
        }
        if (nativeAsked) {
            arranged = top; // no layout grids on native pages
            client.warn(`${qn}: native page (layout ${wantLayout}): first use by ops (no Studio Pro-saved native page in the test projects); check it in Studio Pro`);
        } else if (wantLayout && layoutInfo(wantLayout).native) throw new Error(`${qn}: ${wantLayout} is a native layout; give "native": true`);
        const { layout, placeholder } = pickLayout(wantLayout, withParameter);
        const layoutDoc = await h.get(layout);
        const page = pages.Page.createIn(h.folder(o.module, o.folder));
        ctx.page = page;
        page.name = o.name;
        if (!nativeAsked && pages.Autofocus && pages.Autofocus.DesktopOnly) setIfAvailable(page, "autofocus", pages.Autofocus.DesktopOnly); // Studio Pro's default (11.1+)
        await textAll(page.title, o.title || humanize(o.name), ctx);
        const call = pages.LayoutCall.createInPageUnderLayoutCall(page);
        call.layout = layoutDoc;
        const arg = pages.LayoutCallArgument.createIn(call);
        const short = placeholder.split(".").pop();
        let lp = null;
        layoutDoc.traverse(el => {
            if (!lp && el instanceof pages.Placeholder && el.name === short) lp = el;
        });
        if (!lp) throw new Error(`layout ${layout} has no placeholder '${short}'`);
        arg.parameter = lp;
        const parts = [];
        if (o.variables !== undefined) parts.push(await pageVariables(page, o.variables, qn, ctx));
        if (nativeAsked && o.style !== undefined) throw new Error(`${qn}: ${require("./theme-native").NATIVE_STYLE_REFUSAL.replace("widget", "page")}`);
        if (o.design !== undefined) parts.push(`design ${design.apply(sdk, model, page, design.resolve(client.project.dir, page, o.design, `${qn}: design`, nativeAsked ? "native" : "web"), client.warn)}`);
        if (o.class !== undefined || o.style !== undefined) parts.push(uiFns().pageLook(page, o, qn));
        if (tpl) parts.push(await copyTemplate(tpl, call, arg, layoutDoc, ctx));
        for (const n of arranged) parts.push(await build(n, arg.widgets, ctx));
        for (const f of ctx.after) f(); // parameter mappings: every widget they name exists now
        if (form && !tpl) return { ctx, text: `${qn} (layout ${layout}${o.entity ? `, form for ${o.entity} with ${ctx.count.inputs} input(s)` : ""})` };
        return { ctx, text: `${qn} (layout ${layout}${ctx.params.size ? `, parameter ${[...ctx.params.values()].map(p => p.name).join(", ")}` : ""})\n      widgets: ${parts.join("; ")}` };
    }

    // A page template or building block by qualified or display name: { doc, kind, layout (template's) }
    async function templateOf(name, where) {
        const all = [...model.allPageTemplates(), ...model.allBuildingBlocks()];
        const norm = x => String(x).toLowerCase().replace(/[\s_-]+/g, "");
        const want = norm(name);
        let u = all.find(x => x.qualifiedName === name) || all.find(x => norm(x.qualifiedName) === want || norm(x.name) === want);
        if (!u) {
            for (const x of all) {
                const d = client.project.units.has(x.id) ? client.project.read(x.id).DisplayName : null;
                if (d && norm(d) === want) u = x;
            }
        }
        if (!u) fail(`${where}: no page template or building block '${name}'${all.length ? "" : " (this project has none)"}`, name, all.map(x => x.qualifiedName));
        const doc = await u.load();
        const kind = doc instanceof pages.PageTemplate ? "page template" : "building block";
        if (doc instanceof pages.BuildingBlock && doc.platform && doc.platform.name === "Native") throw new Error(`${where}: ${doc.qualifiedName} is a native building block; give "native": true is not supported for "from"`);
        return { doc, kind, layout: doc instanceof pages.PageTemplate && doc.layoutCall ? doc.layoutCall.layoutQualifiedName : null };
    }

    // Copies the widgets of a template (per placeholder) or building block into the new page.
    async function copyTemplate(tpl, call, mainArg, layoutDoc, ctx) {
        const copied = [];
        const put = (list, widgets) => {
            for (const w of widgets) {
                const c = w.deepCopy(model);
                list.push(c);
                copied.push(c);
            }
        };
        if (tpl.doc instanceof pages.PageTemplate) {
            for (const a of tpl.doc.layoutCall.arguments) {
                const ph = String(a.parameterQualifiedName || "").split(".").pop();
                let arg = call.arguments.find(x => String(x.parameterQualifiedName || "").split(".").pop() === ph);
                if (!arg) {
                    let lp = null;
                    layoutDoc.traverse(el => {
                        if (!lp && el instanceof pages.Placeholder && el.name === ph) lp = el;
                    });
                    if (!lp) {
                        client.warn(`${ctx.qn}: ${tpl.doc.qualifiedName} fills placeholder ${ph}, which ${layoutDoc.qualifiedName} lacks; left out`);
                        continue;
                    }
                    arg = pages.LayoutCallArgument.createIn(call);
                    arg.parameter = lp;
                }
                put(arg.widgets, a.widgets);
            }
        } else put(mainArg.widgets, tpl.doc.widgets);
        // names stay unique on the page; data widgets without an entity wait for Studio Pro (as after "new page from template")
        const open = [];
        for (const c of copied) {
            c.traverse(el => {
                if (el instanceof pages.Widget && el.name) {
                    try {
                        ctx.names.reserve(el.name, ctx.qn);
                    } catch (e) {
                        const base = el.name.replace(/\d+$/, "");
                        el.name = ctx.names.next(base || "widget");
                    }
                }
                const src = el instanceof pages.EntityWidget || el instanceof pages.ListView || el instanceof pages.DataView ? el.dataSource : null;
                if (el instanceof pages.Widget && (el instanceof pages.DataView || el instanceof pages.ListView || el instanceof pages.TemplateGrid || el instanceof pages.DataGrid) && (!src || !src.entityRef)) open.push(el.name);
            });
        }
        if (open.length) client.warn(`${ctx.qn}: from ${tpl.doc.qualifiedName}: ${open.join(", ")} still need${open.length > 1 ? "" : "s"} a data source and entity (set them in Studio Pro, or build them with "widgets")`);
        return `${copied.length} widget(s) from ${tpl.kind} ${tpl.doc.qualifiedName}`;
    }

    function listenTarget(n, nodes) {
        const want = String(n.spec.listenTo);
        const listenable = nodes.filter(x => LISTENS.includes(x.kind) || (x.kind === "pluggable" && x.selKey));
        const cands = listenable.length ? `grids, list views and galleries on this page: ${listenable.map(x => `${x.name} (${x.kind})`).join(", ")}` : `this page has no dataGrid, listView or gallery; add one to "widgets"`;
        const named = nodes.find(x => x.name === want);
        if (named) {
            if (!listenable.includes(named)) throw new Error(`${n.where}: listenTo '${want}' is a ${named.kind}; a data view listens to a dataGrid, listView or gallery (${cands})`);
            return named;
        }
        const kind = LISTENABLE[want.toLowerCase()];
        if (kind) {
            const c = listenable.filter(x => x.kind === kind);
            if (c.length === 1) return c[0];
            if (!c.length) throw new Error(`${n.where}: listenTo '${want}': there is no ${kind} on this page (${cands})`);
            throw new Error(`${n.where}: listenTo '${want}' is ambiguous: ${c.length} ${kind}s on this page (${c.map(x => x.name).join(", ")}); give the name of the one to follow`);
        }
        return fail(`${n.where}: listenTo '${want}' is no grid, list view or gallery on this page (${cands})`, want, listenable.map(x => x.name).concat(["dataGrid", "listView", "gallery"]));
    }

    async function addMenuItem(o) {
        return menuItem(o, `addMenuItem ${o.page}`, null);
    }

    async function setHomePage(o) {
        const where = "setHomePage";
        if ([o.page, o.microflow, o.nanoflow].filter(Boolean).length !== 1) throw new Error(`${where} needs 'page', 'microflow' or (native profile) 'nanoflow' (one of them)`);
        let page = null, flow = null;
        if (o.nanoflow) {
            flow = await h.get(o.nanoflow);
            if (!(flow instanceof mf.Nanoflow)) throw new Error(`${where}: '${o.nanoflow}' is not a nanoflow`);
            return nativeHome(await navProfile(o.profile !== undefined ? o.profile : "native", where, true), null, flow, o, where);
        }
        if (o.page) {
            page = await h.get(o.page);
            if (!(page instanceof pages.Page)) throw new Error(`${where}: '${o.page}' is not a page`);
            if (page.parameters.length) throw new Error(`${where}: ${o.page} has a page parameter; a home page cannot have one`);
        } else {
            flow = await h.get(o.microflow);
            if (!(flow instanceof mf.Microflow)) throw new Error(`${where}: '${o.microflow}' is not a microflow`);
            if (flow.objectCollection.objects.some(x => x instanceof mf.MicroflowParameterObject)) throw new Error(`${where}: ${o.microflow} has parameters; a home microflow cannot have any`);
        }
        const profile = await navProfile(o.profile !== undefined ? o.profile : page && isNativePage(page) ? "native" : undefined, where, true);
        if (!(profile instanceof navigation.NavigationProfile)) return nativeHome(profile, page, flow, o, where);
        if (page && isNativePage(page)) throw new Error(`${where}: ${page.qualifiedName} is a native page; it is the home page of the native profile ("profile": "Native")`);
        const target = page ? page.qualifiedName : flow.qualifiedName;
        const roles = [].concat(o.roles || []);
        const pageRoles = page ? page.allowedRolesQualifiedNames : flow.allowedModuleRolesQualifiedNames;
        const sec = await projectSecurity();
        const later = securityOff(sec) ? " once app security is on" : "";
        if (!roles.length) {
            profile.homePage.page = page;
            profile.homePage.microflow = flow;
            if (!pageRoles.length) client.warn(`${where}: ${target} allows no module roles; users get an error instead of the home page${later} (give it roles: grantAccess)`);
            return `${profile.name} home page -> ${target}`;
        }
        if (!sec) throw new Error(`${where}: the project has no project security, so it has no user roles`);
        for (const name of roles) {
            const ur = userRoleNamed(sec, name, `${where}: `);
            let rb = profile.roleBasedHomePages.find(x => x.userRoleQualifiedName === ur.qualifiedName);
            if (!rb) {
                rb = navigation.RoleBasedHomePage.create(model);
                profile.roleBasedHomePages.push(rb);
                rb.userRole = ur;
            }
            rb.page = page;
            rb.microflow = flow;
            if (!ur.moduleRolesQualifiedNames.some(r => pageRoles.includes(r))) client.warn(`${where}: user role ${name} has none of the roles that may open ${target} (${pageRoles.join(", ") || "none"})${later}`);
        }
        return `${profile.name} home page for ${roles.join(", ")} -> ${target}`;
    }

    // home page of a native profile: a native page or a nanoflow, for everyone or per user role
    async function nativeHome(profile, page, flow, o, where) {
        if (profile instanceof navigation.NavigationProfile) throw new Error(`${where}: a home nanoflow is for the native profile; ${profile.name} takes a page or microflow`);
        if (flow && !(flow instanceof mf.Nanoflow)) throw new Error(`${where}: the native profile starts a page or a nanoflow, not a microflow`);
        if (page && !isNativePage(page)) throw new Error(`${where}: ${page.qualifiedName} is a web page; the native home page is a native page (createPage "native": true)`);
        const target = page ? page.qualifiedName : flow.qualifiedName;
        const roles = [].concat(o.roles || []);
        client.warnFirst(`Navigation native home page: first use by ops (no Studio Pro sample in the test projects): check the ${profile.name} profile in Studio Pro`);
        if (!roles.length) {
            profile.nativeHomePage.homePagePage = page;
            profile.nativeHomePage.homePageNanoflow = flow;
            return `${profile.name} home page -> ${target}`;
        }
        const sec = await projectSecurity();
        if (!sec) throw new Error(`${where}: the project has no project security, so it has no user roles`);
        for (const name of roles) {
            const ur = userRoleNamed(sec, name, `${where}: `);
            let rb = profile.roleBasedNativeHomePages.find(x => x.userRoleQualifiedName === ur.qualifiedName);
            if (!rb) {
                rb = navigation.RoleBasedNativeHomePage.create(model);
                profile.roleBasedNativeHomePages.push(rb);
                rb.userRole = ur;
            }
            rb.homePagePage = page;
            rb.homePageNanoflow = flow;
        }
        return `${profile.name} home page for ${roles.join(", ")} -> ${target}`;
    }

    // ------------------------------------------------ checks after apply (fresh model)

    function countSpecs(specs, out = {}) {
        for (const s of specs || []) {
            if (!s || typeof s !== "object") continue;
            const raw = String(s.widget !== undefined ? s.widget : s.type).toLowerCase();
            const kind = KINDS.find(k => k.toLowerCase() === raw) || ALIASES[raw];
            out[kind] = (out[kind] || 0) + 1;
            countSpecs(s.widgets, out);
            countSpecs(s.footer, out);
            if (kind === "tabContainer") for (const t of Array.isArray(s.tabs) ? s.tabs : []) if (t && typeof t === "object") countSpecs(t.widgets, out);
            if (kind === "layoutGrid") for (const r of [].concat(s.rows || [{ columns: s.columns }])) for (const c of (r && r.columns) || []) if (c && typeof c === "object") countSpecs(c.widgets, out);
        }
        return out;
    }

    // The data source kind of a saved data widget: database | association | context | parameter | listen | microflow | nanoflow | other
    function sourceKind(w) {
        let src = null;
        if (w instanceof cw.CustomWidget) {
            for (const p of w.object ? w.object.properties : []) if (p.value && p.value.dataSource) src = src || p.value.dataSource;
        } else {
            try {
                src = w.dataSource;
            } catch (e) {
                src = null;
            }
        }
        if (!src) return null;
        if (src instanceof pages.ListenTargetSource) return "listen";
        if (src instanceof pages.MicroflowSource) return "microflow";
        if (src instanceof pages.NanoflowSource) return "nanoflow";
        if (src instanceof pages.AssociationSource) return "association";
        if (src instanceof pages.DataViewSource) return src.sourceVariable && src.sourceVariable.pageParameter ? "parameter" : src.entityRef instanceof dm.IndirectEntityRef ? "association" : "context";
        if (src instanceof pages.GridXPathSource || src instanceof pages.ListViewXPathSource || src instanceof cw.CustomWidgetXPathSource) return "database";
        return "other";
    }
    // [{ name, source }] of the named data widgets of specs that ask for a source
    function namedSources(specs, out = []) {
        for (const s of specs || []) {
            if (!s || typeof s !== "object") continue;
            const kind = widgetKind(s.widget !== undefined ? s.widget : s.type);
            const want = !["dataView", "dataGrid", "listView", "gallery", "templateGrid"].includes(kind) ? null : s.source !== undefined ? String(s.source).toLowerCase() : ["association", "microflow", "nanoflow"].find(k => s[k] !== undefined) || (s.listenTo !== undefined ? "listen" : null);
            if (s.name && want) out.push({ name: String(s.name), source: want === "entity" ? "parameter" : want === "xpath" ? "database" : want });
            namedSources(s.widgets, out);
            namedSources(s.footer, out);
            for (const t of Array.isArray(s.tabs) ? s.tabs : []) if (t) namedSources(t.widgets, out);
            if (kind === "layoutGrid") for (const r of [].concat(s.rows || [{ columns: s.columns }])) for (const c of (r && Array.isArray(r.columns) && r.columns) || []) if (c && typeof c === "object") namedSources(c.widgets, out);
        }
        return out;
    }

    async function menuHas(profileName, qn) {
        const page = await h.get(qn).catch(() => null);
        const profile = await navProfile(profileName !== undefined ? profileName : page && isNativePage(page) ? "native" : undefined, "check", true);
        if (!(profile instanceof navigation.NavigationProfile)) return profile.bottomBarItems.some(b => b.pageQualifiedName === qn);
        return menuItems(profile.menuItemCollection.items).some(x => opens(x.item, qn));
    }

    const checks = {
        async createPage(o) {
            const qn = `${o.module}.${o.name}`;
            const page = await h.get(qn);
            const r = [];
            if (o.widgets === undefined) {
                if (o.entity && !page.parameters.length) r.push(`${qn} has no page parameter`);
            } else {
                const want = countSpecs(o.widgets);
                const have = {};
                const names = new Map();
                const listens = [];
                page.traverse(el => {
                    const k = el instanceof pages.DataGrid || isGrid2(el) ? "dataGrid" : el instanceof pages.DataView ? "dataView" : el instanceof pages.ListView ? "listView" : el instanceof pages.ActionButton ? "actionButton" : el instanceof pages.LayoutGrid ? "layoutGrid" :
                        el instanceof pages.TabContainer ? "tabContainer" : el instanceof pages.GroupBox ? "groupBox" : el instanceof pages.SnippetCallWidget ? "snippetCall" : el instanceof pages.StaticImageViewer || el instanceof pages.DynamicImageViewer ? "image" :
                            el instanceof pages.TemplateGrid ? "templateGrid" : el instanceof pages.ReferenceSelector ? "referenceSelector" : el instanceof pages.InputReferenceSetSelector ? "referenceSetSelector" : isPl(el, COMBOBOX) ? "comboBox" : isPl(el, GALLERY) ? "gallery" : null;
                    if (k) have[k] = (have[k] || 0) + 1;
                    if (el instanceof pages.Widget) names.set(el.name, el);
                    if (el instanceof pages.ListenTargetSource) listens.push(el.listenTarget);
                });
                for (const k of ["dataGrid", "dataView", "listView", "layoutGrid", "actionButton", "tabContainer", "groupBox", "snippetCall", "image", "referenceSelector", "referenceSetSelector", "comboBox", "gallery", "templateGrid"]) if ((have[k] || 0) < (want[k] || 0)) r.push(`${qn} has ${have[k] || 0} ${k}(s), expected at least ${want[k]}`);
                for (const x of namedSources(o.widgets)) {
                    const w = names.get(x.name), got = w && sourceKind(w);
                    if (w && got !== x.source) r.push(`${qn}: ${x.name} has a ${got || "no"} source, expected ${x.source}`);
                }
                for (const t of listens) {
                    const w = names.get(t);
                    if (!(w instanceof pages.DataGrid || w instanceof pages.TemplateGrid || w instanceof pages.ListView || isGrid2(w) || isPl(w, GALLERY))) r.push(`${qn}: a data view listens to '${t}', which is no grid, list view or gallery on the page`);
                    else if ((isGrid2(w) || isPl(w, GALLERY)) && valueOf(w.object, "itemSelection").selection !== cw.CustomWidgetSelectionType.Single) r.push(`${qn}: ${t} is listened to but its selection is not Single`);
                }
            }
            if (o.menu !== undefined && o.menu !== false) {
                const m = typeof o.menu === "string" ? { profile: o.menu } : o.menu === true ? {} : o.menu;
                if (!(await menuHas(m.profile, qn))) r.push(`${qn} is not in the ${m.profile || "Responsive"} menu`);
            }
            return r;
        },
        async addMenuItem(o) {
            if (o.action !== undefined) {
                const profile = await navProfile(o.profile, "check");
                return menuItems(profile.menuItemCollection.items).some(x => captionOf(x.item.caption) === String(o.caption) && !(x.item.action instanceof pages.NoClientAction)) ? [] : [`the ${profile.name} menu has no item "${o.caption}" with an action`];
            }
            return (await menuHas(o.profile, o.page)) ? [] : [`${o.page} is not in the ${o.profile || "Responsive"} menu`];
        },
        async setHomePage(o) {
            const page = o.page ? await h.get(o.page).catch(() => null) : null;
            const profile = await navProfile(o.profile !== undefined ? o.profile : o.nanoflow || (page && isNativePage(page)) ? "native" : undefined, "check", true);
            const target = o.page || o.microflow || o.nanoflow;
            const roles = [].concat(o.roles || []);
            if (!(profile instanceof navigation.NavigationProfile)) {
                const at = hp => hp && (hp.homePagePageQualifiedName === target || hp.homePageNanoflowQualifiedName === target);
                if (!roles.length) return at(profile.nativeHomePage) ? [] : [`${profile.name} home page is not ${target}`];
                return roles.filter(r => !at(profile.roleBasedNativeHomePages.find(x => x.userRoleQualifiedName === r))).map(r => `${profile.name} home page for ${r} is not ${target}`);
            }
            const at = hp => hp && (hp.pageQualifiedName === target || hp.microflowQualifiedName === target);
            if (!roles.length) return at(profile.homePage) ? [] : [`${profile.name} home page is not ${target}`];
            return roles.filter(r => !at(profile.roleBasedHomePages.find(x => x.userRoleQualifiedName === r))).map(r => `${profile.name} home page for ${r} is not ${target}`);
        }
    };

    // Data grid 2 / gallery column settings, filters and header filters (grid-extras.js)
    let gx = null;
    function GX() {
        return gx || (gx = gridExtras.makeGridExtras(internals, h));
    }
    // the builders and lookups ops-page-edit.js uses on existing pages
    const internals = { scan, setPlatform, build, gridKind, entityOf, attributeOf, pathOf, attrRefOf, prepareAssocs, formatInto, pageVariables, dvSettings, inputExtras, onChange, selectPage, ACTION_DOC, names, textAll, templateAll, noPlaceholder, checkXPath, dg2Info,
        isGrid2, isPl, valueOf, humanize, condition, sameCondition, fill, languages, shown, listenTarget, classicColumn, dg2Column, typeOf, isA, list, unitNamed,
        prepare, listEntity, resolveSources, sourceKind, makeAction, plDef, plApply, plScan, widgetType, widgetTypes,
        blankObject, exprCheck, textTemplate, buildPluggable: (n, t, c) => BUILD.pluggable(n, t, c), associations: () => ASSOCS || [], gridExtras: () => GX(), ui: () => uiFns() };
    let uiMade = null;
    function uiFns() {
        return uiMade || (uiMade = ui.makeUi(h, () => internals));
    }
    return { createPage, addMenuItem, setHomePage, checks, internals };
}

module.exports = { makePages, PAGE_FIELDS, MENU_FIELDS, HOME_FIELDS, WIDGETS, COMMON_FIELDS, INPUTS, PREFIX, MASTER_DETAIL, DATAGRID2, COMBOBOX, GALLERY, widgetKind, widgetFields, NO_MENU_ROLES };
