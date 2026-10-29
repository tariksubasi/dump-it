# UI recipes: whole enterprise pages for Mendix, ready to copy

Optional. The principles and atoms are in guides/UI_DESIGN.md (read that first). Open this file only when the user
wants one of these screens and you want to copy it whole. Do not read guides/MANUAL.md for page design.

## How to use this file (5 steps)

1. Find the recipe in the **Recipe list** whose sketch looks like what the user wants.
2. Copy its JSON into `edits/<name>.json`.
3. Change ONLY the names: module, entity, attributes, page names, captions. Keep every other key.
4. Run `python mx.py dryrun <name>.json`. Fix what the output says. Then show the user the summary and the approval code.
5. After apply, run `python mx.py preview <Module.Page>` and show the user the picture.

Combine recipes by putting their widgets one after another in one `widgets` list. Do not invent keys:
every key you may use is in this file or in `python mx.py ops createPage`.

## The 12 design rules (always)

| # | Rule | How (what to write) |
|---|---|---|
| 1 | Nested boxes never have the same background as their parent | Page = no class. Section = `"class": "background-secondary"`. Card inside = `"class": "acme-card"` (white, soft shadow). Never two `acme-card` inside each other |
| 2 | Text is always readable | Never write colours in `style`. Use only `text-muted` (secondary text), `text-primary`, `text-danger`, `text-success`, `text-warning` and the default text colour |
| 3 | No hard black borders | Never write `border` in `style`. Cards get their soft border and shadow from `acme-card` or `shadow-small` |
| 4 | One scroll only | Never put a list view, gallery or data grid inside a container with a fixed height. Use paging (`pageSize`, `paging`) instead of a scrolling box |
| 5 | Phone: one column | Every layout grid column gets `"phone": 12`; tablet usually `"tablet": 6` or `12` |
| 6 | Phone: icons instead of long button texts | Use the **two-button pattern** (below): caption + icon on tablet/desktop, icon only on phone, both with the same action |
| 7 | Forms stay usable with the keyboard open | Labels on top (`"orientation": "vertical"`), one field per row on phones, Save/Cancel in the data view footer (in the page flow, never fixed to the bottom of the screen) |
| 8 | Touch targets are big enough | Buttons, not small links, for actions on phones. Never `"style": "height: ..."` on buttons or inputs |
| 9 | Nothing overlaps | Never write `position`, `z-index`, `top`, `left`, `margin-top: -` in `style`. Use pop-up pages and the Pop-up menu widget for things that float |
| 10 | Pop-ups fit on phones | Pop-up pages: `"popupWidth": 600` at most, `"popupHeight": 0` (auto). Long forms are full pages, not pop-ups |
| 11 | One main action per screen | Exactly one button with `"style": "Primary"` per page or card. Other buttons: `"style": "Default"` |
| 12 | Calm spacing | Spacing only with Atlas classes: `spacing-outer-bottom-medium`, `spacing-outer-bottom-large`, `spacing-inner-medium`, `spacing-inner-large`. Never pixel margins in `style` |

### The two-button pattern (rule 6)

```
tablet / desktop:  [ + New employee ]        phone:  [ + ]
```

Two buttons with the same action; Atlas hides one per device:

| Button | class | caption | iconOnly |
|---|---|---|---|
| Wide | `hide-phone` | "New employee" | no |
| Narrow | `hide-tablet hide-desktop` | "New employee" (screen readers read it) | `true` + `tooltip` |

## Mendix widget map (what each part is in Mendix)

| You need | Mendix widget | `"widget"` kind | Key fields |
|---|---|---|---|
| Page title, section title | Text (H1..H6) | `text` | `text`, `style`: `H1`..`H4` |
| Secondary text | Text | `text` | `text`, `class`: `text-muted` |
| A box around things | Container | `container` | `widgets`, `class`, `renderMode` (`section`, `header`, `footer`) |
| Columns that stack on phones | Layout grid | `layoutGrid` | `rows`: `[ { "columns": [ { "weight": 8, "tablet": 12, "phone": 12, "widgets": [...] } ] } ]` |
| One object (form or details) | Data view | `dataView` | `source`, `entity`, `widgets`, `footer`, `orientation` |
| Text input | Text box | `input` (String attribute) | `attribute`, `label`, `placeholder`, `required` |
| Long text | Text area | `input` (String attribute) + `"widget": "textArea"` | `attribute`, `label` |
| Number | Text box | `input` (Integer / Decimal) | `attribute`, `format`: `{ "decimals": 2 }` |
| Date / time | Date picker | `input` (DateTime) | `attribute`, `format`: `{ "date": "date" }` or `"dateTime"` |
| Yes / no | Check box | `input` (Boolean) | `attribute` |
| One of a list of values | Radio buttons or Combo box | `input` (Enumeration) or `comboBox` | `attribute` |
| Pick a related object | Combo box / Reference selector | `comboBox` (`association`) or `referenceSelector` | `association`, `captionAttribute` / `attribute` |
| Button | Action button | `actionButton` | `action`, `caption`, `style`, `icon`, `iconOnly`, `tooltip` |
| Table (admin, many columns) | Data grid 2 | `dataGrid` + `"kind": "datagrid2"` | `columns`, `headerFilters`, `paging`, `onClick` |
| Cards that wrap (users, phones) | Gallery | `gallery` | `widgets`, `columns`: `{ "desktop": 3, "tablet": 2, "phone": 1 }` |
| Simple list | List view | `listView` | `widgets`, `pageSize`, `onClick` |
| Tabs | Tab container | `tabContainer` | `tabs`: `[ { "caption": ..., "widgets": [...] } ]` |
| Status label | Badge | `badge` | `text` (`{Status}`), `type`: `label` |
| Row actions menu (⋮) | Pop-up menu | `popupMenu` | `items`, `trigger` |
| Collapsible sections | Accordion | `accordion` | `groups` |
| Big number | Text H2 in a card | `text` | `text`: `{Total}`, `style`: `H2` |

**Icons:** only names that exist in the project's Atlas icon set: `mx-icon-add`, `mx-icon-pencil`, `mx-icon-trash-can`,
`mx-icon-search`, `mx-icon-home`, `mx-icon-user`, `mx-icon-checkmark`, `mx-icon-play-circle`, `mx-icon-controls-stop`,
`mx-icon-time-clock`, `mx-icon-calendar`, `mx-icon-logout`. An unknown name is refused with "Did you mean" in the dry run: take one of its suggestions.

## Example domain (used by every recipe)

Replace these names with the user's own. If the entities do not exist yet, create them first:

```json
{ "ops": [
  { "op": "createEnumeration", "module": "MyFirstModule", "name": "EmpStatus", "values": ["Active", "OnLeave", "Left"] },
  { "op": "createEntity", "module": "MyFirstModule", "name": "Employee", "attributes": [
      { "name": "FullName", "type": "String(100)" }, { "name": "Email", "type": "String(200)" },
      { "name": "Department", "type": "String(100)" }, { "name": "StartDate", "type": "DateTime" },
      { "name": "Salary", "type": "Decimal" }, { "name": "Remote", "type": "Boolean" },
      { "name": "Status", "type": "Enum(MyFirstModule.EmpStatus)" }, { "name": "Notes", "type": "String(unlimited)" } ] },
  { "op": "createEntity", "module": "MyFirstModule", "name": "TimeEntry", "attributes": [
      { "name": "ClockIn", "type": "DateTime" }, { "name": "ClockOut", "type": "DateTime" }, { "name": "Hours", "type": "Decimal" } ] },
  { "op": "addAssociation", "from": "MyFirstModule.TimeEntry", "to": "MyFirstModule.Employee" },
  { "op": "addAccessRule", "entity": "MyFirstModule.Employee", "roles": ["MyFirstModule.User"], "access": "ReadWrite", "create": true, "delete": true },
  { "op": "addAccessRule", "entity": "MyFirstModule.TimeEntry", "roles": ["MyFirstModule.User"], "access": "ReadWrite", "create": true, "delete": true },
  { "op": "createComponentKit", "module": "MyFirstModule", "prefix": "acme", "kit": ["card", "emptyState"], "withStyles": true }
] }
```

`createComponentKit` with `withStyles` adds the classes `acme-card` (white surface, soft border, soft shadow, rounded) and more. Run it once per app; use your company prefix instead of `acme`.

## Recipe list

| # | Recipe | Use it for |
|---|---|---|
| R1 | Page header with actions | The top of every page |
| R2 | Card | Any group of information |
| R3 | KPI row | Numbers at the top of a dashboard |
| R4 | Edit form | Create / edit one object |
| R5 | Searchable table | Admin overview with many columns |
| R6 | Card list | Overview that must look good on phones |
| R7 | Master-detail | List left, details right |
| R8 | Detail page with tabs | One object with many fields |
| R9 | Empty state | When a list has nothing |
| R10 | Status badge + row menu | Status per row, actions in a ⋮ menu |
| R11 | Sign-in page | Custom login |
| R12 | Time clock (clock in / out) | Employee check-in screen |
| R13 | Dashboard | KPIs + list + chart area |
| R14 | Pop-up edit | Small quick edit |
| R15 | Native mobile list and form | Native phone app |

---

## R1 Page header with actions

```
PHONE                          DESKTOP
┌────────────────────────┐     ┌──────────────────────────────────────────────┐
│ Employees         [+]  │     │ Employees                    [ + New employee ]│
│ 128 people             │     │ 128 people                                     │
└────────────────────────┘     └──────────────────────────────────────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Title | Text H2 | |
| Subtitle | Text, `text-muted` | |
| Action | Two action buttons (two-button pattern) | Primary |
| Layout | Layout grid 8/4, phone 8/4 | the button stays right of the title on phones |

```json
{ "widget": "layoutGrid", "class": "spacing-outer-bottom-large", "rows": [ { "columns": [
    { "weight": 8, "tablet": 8, "phone": 8, "widgets": [
        { "widget": "text", "text": "Employees", "style": "H2" },
        { "widget": "text", "text": "Everyone in the company", "class": "text-muted" } ] },
    { "weight": 4, "tablet": 4, "phone": 4, "class": "text-right", "widgets": [
        { "widget": "actionButton", "action": "create", "entity": "MyFirstModule.Employee", "page": "MyFirstModule.Employee_Edit", "caption": "New employee", "icon": "mx-icon-add", "style": "Primary", "class": "hide-phone" },
        { "widget": "actionButton", "action": "create", "entity": "MyFirstModule.Employee", "page": "MyFirstModule.Employee_Edit", "caption": "New employee", "icon": "mx-icon-add", "iconOnly": true, "tooltip": "New employee", "style": "Primary", "class": "hide-tablet hide-desktop" } ] } ] } ] }
```

## R2 Card

```
┌─────────────────────────────┐   white surface, soft border, soft shadow, rounded corners
│ Contact                      │   title H4
│ anna@acme.com                │   text
│ Sales · Remote               │   text-muted
└─────────────────────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Card | Container `acme-card` | never put a card in a card (rule 1) |
| Title | Text H4 | |
| Lines | Text, `text-muted` for secondary | inside a data view `{Attribute}` shows a value |

```json
{ "widget": "container", "class": "acme-card spacing-outer-bottom-medium", "widgets": [
    { "widget": "text", "text": "Contact", "style": "H4" },
    { "widget": "text", "text": "{Email}" },
    { "widget": "text", "text": "{Department}", "class": "text-muted" } ] }
```

## R3 KPI row

```
PHONE                 DESKTOP
┌────────────┐        ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Employees  │        │Employees │ │ Remote   │ │ On leave │
│ 128        │        │ 128      │ │ 42       │ │ 5        │
└────────────┘        └──────────┘ └──────────┘ └──────────┘
┌────────────┐
│ Remote 42  │   (stacked on phones)
└────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Row | Layout grid 4/4/4, tablet 4, phone 12 | |
| Tile | Container `acme-card` | |
| Label | Text, `text-muted` | |
| Value | Text H2 | a fixed number here; for live numbers put a data view with `"source": "microflow"` in the tile and `{Count}` in the text |

```json
{ "widget": "layoutGrid", "class": "spacing-outer-bottom-large", "rows": [ { "columns": [
    { "weight": 4, "tablet": 4, "phone": 12, "widgets": [ { "widget": "container", "class": "acme-card", "widgets": [
        { "widget": "text", "text": "Employees", "class": "text-muted" }, { "widget": "text", "text": "128", "style": "H2" } ] } ] },
    { "weight": 4, "tablet": 4, "phone": 12, "widgets": [ { "widget": "container", "class": "acme-card", "widgets": [
        { "widget": "text", "text": "Remote", "class": "text-muted" }, { "widget": "text", "text": "42", "style": "H2" } ] } ] },
    { "weight": 4, "tablet": 4, "phone": 12, "widgets": [ { "widget": "container", "class": "acme-card", "widgets": [
        { "widget": "text", "text": "On leave", "class": "text-muted" }, { "widget": "text", "text": "5", "style": "H2" } ] } ] } ] } ] }
```

## R4 Edit form

```
PHONE                          DESKTOP
┌────────────────────────┐     ┌──────────────────────────────────────────────┐
│ Edit employee          │     │ Edit employee                                │
│ Full name *            │     │ Full name *               Email *            │
│ [___________________]  │     │ [___________________]     [_________________] │
│ Email *                │     │ Department                Start date         │
│ [___________________]  │     │ [___________________]     [______📅_________] │
│ Department             │     │ Salary                    Status             │
│ [___________________]  │     │ [___________________]     ( ) Active (•) ... │
│ Start date             │     │ [x] Remote                                   │
│ [__________📅_______]  │     │ Notes                                        │
│ ...                    │     │ [___________________________________________] │
│ [ Cancel ] [  Save  ]  │     │                              [Cancel] [Save]  │
└────────────────────────┘     └──────────────────────────────────────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Form | Data view, source parameter, `orientation: vertical` | labels on top: good for phones and the keyboard |
| Two columns | Layout grid 6/6, phone 12 | one column on phones |
| FullName, Email, Department | Text box (`input`) | `required` on the must-have fields |
| StartDate | Date picker (`input`, DateTime) | `"format": { "date": "date" }` |
| Salary | Text box (Decimal) | `"format": { "decimals": 2 }` |
| Status | Radio buttons (`input`, enumeration) | ≤ 4 values: radio; more: `comboBox` |
| Remote | Check box (`input`, Boolean) | |
| Notes | Text area | full width |
| Save / Cancel | Footer buttons (`"buttons": true`) | in the page flow, not fixed to the bottom |

```json
{ "ops": [
  { "op": "createPage", "module": "MyFirstModule", "name": "Employee_Edit", "title": "Edit employee", "entity": "MyFirstModule.Employee", "widgets": [
    { "widget": "dataView", "source": "parameter", "orientation": "vertical", "buttons": true, "widgets": [
      { "widget": "layoutGrid", "rows": [
        { "columns": [
          { "weight": 6, "tablet": 6, "phone": 12, "widgets": [ { "widget": "input", "attribute": "FullName", "label": "Full name", "required": true, "placeholder": "Anna Smith" } ] },
          { "weight": 6, "tablet": 6, "phone": 12, "widgets": [ { "widget": "input", "attribute": "Email", "label": "Email", "required": true, "placeholder": "anna@acme.com" } ] } ] },
        { "columns": [
          { "weight": 6, "tablet": 6, "phone": 12, "widgets": [ { "widget": "input", "attribute": "Department", "label": "Department" } ] },
          { "weight": 6, "tablet": 6, "phone": 12, "widgets": [ { "widget": "input", "attribute": "StartDate", "label": "Start date", "format": { "date": "date" } } ] } ] },
        { "columns": [
          { "weight": 6, "tablet": 6, "phone": 12, "widgets": [ { "widget": "input", "attribute": "Salary", "label": "Salary", "format": { "decimals": 2 } } ] },
          { "weight": 6, "tablet": 6, "phone": 12, "widgets": [ { "widget": "input", "attribute": "Status", "label": "Status" } ] } ] },
        { "columns": [
          { "weight": 12, "widgets": [
            { "widget": "input", "attribute": "Remote", "label": "Works remote" },
            { "widget": "textArea", "attribute": "Notes", "label": "Notes" } ] } ] } ] } ] } ] }
] }
```

## R5 Searchable table (Data grid 2)

```
PHONE                              DESKTOP
┌────────────────────────────┐     ┌──────────────────────────────────────────────────┐
│ [🔍 Search name, email   ] │     │ [🔍 Search name, email        ]  Status [ All ▾ ] │
│ Name        Status         │     │ Name          Email            Department  Status  │
│ Anna Smith  Active         │     │ Anna Smith    anna@acme.com    Sales       Active  │
│ ...                        │     │ ...                                                │
│      ‹ 1 2 3 ›             │     │                                   ‹ 1 2 3 ›        │
└────────────────────────────┘     └──────────────────────────────────────────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Table | Data grid 2 (`dataGrid`, `kind: datagrid2`) | admin screens; for users on phones prefer R6 |
| Search | Header text filter over several attributes | one box, not a filter per column |
| Status filter | Header drop-down filter | |
| Paging | Buttons, 20 rows | never a scrolling box (rule 4) |
| Row click | Opens the edit page | |

```json
{ "widget": "dataGrid", "kind": "datagrid2", "entity": "MyFirstModule.Employee",
  "columns": [ "FullName", "Email", "Department", "Status" ],
  "headerFilters": [ { "filter": "text", "attributes": ["FullName", "Email"], "placeholder": "Search name, email" }, { "filter": "dropdown", "attribute": "Status" } ],
  "paging": { "mode": "buttons", "pageSize": 20 }, "sort": [ "FullName" ],
  "emptyMessage": "No employees yet",
  "onClick": { "action": "showPage", "page": "MyFirstModule.Employee_Edit" } }
```

## R6 Card list (Gallery)

```
PHONE (1 per row)        TABLET (2)                    DESKTOP (3)
┌──────────────────┐     ┌──────────┐ ┌──────────┐     ┌────────┐ ┌────────┐ ┌────────┐
│ Anna Smith       │     │ Anna     │ │ Ben      │     │ Anna   │ │ Ben    │ │ Cleo   │
│ Sales   [Active] │     │ Sales    │ │ IT       │     │ Sales  │ │ IT     │ │ HR     │
└──────────────────┘     └──────────┘ └──────────┘     └────────┘ └────────┘ └────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| List | Gallery | 3 / 2 / 1 columns |
| Item | Container `acme-card` inside the item | |
| Status | Badge `label` | |
| Search | Header text filter | |

```json
{ "widget": "gallery", "entity": "MyFirstModule.Employee", "columns": { "desktop": 3, "tablet": 2, "phone": 1 },
  "headerFilters": [ { "filter": "text", "attributes": ["FullName", "Department"], "placeholder": "Search" } ],
  "paging": { "mode": "buttons", "pageSize": 12 }, "emptyMessage": "No employees yet",
  "onClick": { "action": "showPage", "page": "MyFirstModule.Employee_Edit" },
  "widgets": [ { "widget": "container", "class": "acme-card", "widgets": [
      { "widget": "text", "text": "{FullName}", "style": "H4" },
      { "widget": "text", "text": "{Department}", "class": "text-muted" },
      { "widget": "badge", "text": "{Status}", "type": "label" } ] } ] }
```

## R7 Master-detail

```
PHONE (stacked)               DESKTOP
┌──────────────────────┐      ┌───────────────┬──────────────────────────────┐
│ Anna Smith           │      │ Anna Smith  ◀ │ Anna Smith                   │
│ Ben Jones            │      │ Ben Jones     │ anna@acme.com · Sales        │
├──────────────────────┤      │ Cleo Park     │ Start date 01-02-2024        │
│ Anna Smith           │      │               │                    [ Edit ]  │
│ anna@acme.com        │      └───────────────┴──────────────────────────────┘
└──────────────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Grid | Layout grid 4/8, phone 12 | |
| List | List view with `pageSize` | no scrolling box |
| Details | Data view `listenTo` the list, not editable | |

```json
{ "widget": "layoutGrid", "rows": [ { "columns": [
    { "weight": 4, "tablet": 12, "phone": 12, "widgets": [
        { "widget": "listView", "name": "people", "entity": "MyFirstModule.Employee", "pageSize": 10, "sort": ["FullName"], "widgets": [
            { "widget": "text", "text": "{FullName}" }, { "widget": "text", "text": "{Department}", "class": "text-muted" } ] } ] },
    { "weight": 8, "tablet": 12, "phone": 12, "widgets": [
        { "widget": "dataView", "listenTo": "people", "editable": false, "showFooter": false, "class": "acme-card", "widgets": [
            { "widget": "text", "text": "{FullName}", "style": "H3" },
            { "widget": "text", "text": "{Email} · {Department}", "class": "text-muted" },
            { "widget": "actionButton", "action": "showPage", "page": "MyFirstModule.Employee_Edit", "caption": "Edit", "icon": "mx-icon-pencil" } ] } ] } ] } ] }
```

## R8 Detail page with tabs

```
┌──────────────────────────────────────────────┐
│ Anna Smith                         [ Edit ]   │
│ [ General ] [ Time ] [ Notes ]                │
│ Email     anna@acme.com                       │
│ Status    Active                              │
└──────────────────────────────────────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Object | Data view, parameter, read-only | |
| Tabs | Tab container | max 5 tabs; on phones tabs wrap |
| Related list | List view over the association | inside a tab |

```json
{ "ops": [
  { "op": "createPage", "module": "MyFirstModule", "name": "Employee_Details", "title": "Employee", "entity": "MyFirstModule.Employee", "widgets": [
    { "widget": "dataView", "source": "parameter", "editable": false, "showFooter": false, "widgets": [
      { "widget": "text", "text": "{FullName}", "style": "H2" },
      { "widget": "tabContainer", "tabs": [
        { "caption": "General", "widgets": [
          { "widget": "text", "text": "{Email}" }, { "widget": "text", "text": "{Department}", "class": "text-muted" } ] },
        { "caption": "Time", "widgets": [
          { "widget": "listView", "association": "MyFirstModule.TimeEntry_Employee", "pageSize": 10, "widgets": [
            { "widget": "text", "text": "{ClockIn} – {ClockOut}" } ] } ] },
        { "caption": "Notes", "widgets": [ { "widget": "text", "text": "{Notes}" } ] } ] } ] } ] }
] }
```

## R9 Empty state

```
┌──────────────────────────────────────┐
│              (icon)                  │
│        No employees yet              │
│  Add the first one to get started.   │
│        [ + Add employee ]            │
└──────────────────────────────────────┘
```

Use the kit's building block (made by `createComponentKit` with `"emptyState"`), or write it:

```json
{ "widget": "container", "class": "acme-card text-center spacing-inner-large", "widgets": [
    { "widget": "text", "text": "No employees yet", "style": "H3" },
    { "widget": "text", "text": "Add the first one to get started.", "class": "text-muted" },
    { "widget": "actionButton", "action": "create", "entity": "MyFirstModule.Employee", "page": "MyFirstModule.Employee_Edit", "caption": "Add employee", "icon": "mx-icon-add", "style": "Primary" } ] }
```

## R10 Status badge + row menu (⋮)

```
┌──────────────────────────────────────────────┐
│ Anna Smith      Sales      [Active]      ⋮   │──▶ ┌──────────┐
└──────────────────────────────────────────────┘    │ Edit     │
                                                    │ ──────── │
                                                    │ Delete   │ (red)
                                                    └──────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Row | List view item, layout grid 6/4/2 | phone: 8 / 0 (hidden) / 4 |
| Status | Badge, type label | |
| Menu | Pop-up menu (Marketplace widget) | the drop-down button is NOT used (Studio Pro cannot load it) |

```json
{ "widget": "listView", "entity": "MyFirstModule.Employee", "pageSize": 20, "widgets": [
    { "widget": "layoutGrid", "rows": [ { "columns": [
        { "weight": 6, "tablet": 6, "phone": 8, "widgets": [ { "widget": "text", "text": "{FullName}" } ] },
        { "weight": 4, "tablet": 4, "phone": 12, "class": "hide-phone", "widgets": [ { "widget": "badge", "text": "{Status}", "type": "label" } ] },
        { "weight": 2, "tablet": 2, "phone": 4, "class": "text-right", "widgets": [
            { "widget": "popupMenu", "items": [
                { "caption": "Edit", "action": { "action": "showPage", "page": "MyFirstModule.Employee_Edit" } },
                "divider",
                { "caption": "Delete", "action": { "action": "delete" }, "style": "danger" } ] } ] } ] } ] } ] }
```

## R11 Sign-in page

```
PHONE                       DESKTOP
┌────────────────────┐      ┌──────────────────────────────────────┐
│     Sign in        │      │              Sign in                 │
│ [ User name     ]  │      │         [ User name          ]       │
│ [ Password      ]  │      │         [ Password           ]       │
│ [    Sign in    ]  │      │         [       Sign in      ]       │
└────────────────────┘      └──────────────────────────────────────┘
```

One op makes the whole page with Studio Pro's sign-in widgets and sets it as the sign-in page:

```json
{ "ops": [ { "op": "createLoginPage", "module": "MyFirstModule", "name": "Login", "title": "Sign in", "heading": "Welcome back" } ] }
```

## R12 Time clock (clock in / out)

```
PHONE                          DESKTOP
┌────────────────────────┐     ┌────────────────────────────────────────────┐
│ Good morning, Anna     │     │ Good morning, Anna                         │
│ Today                  │     ├──────────────────┬─────────────────────────┤
├────────────────────────┤     │ [ ▶ Clock in   ] │ Today                   │
│ [   ▶  Clock in     ]  │     │ [ ■ Clock out  ] │ 08:58 – 12:30           │
│ [   ■  Clock out    ]  │     │                  │ 13:15 –                 │
├────────────────────────┤     └──────────────────┴─────────────────────────┘
│ Today                  │
│ 08:58 – 12:30          │
└────────────────────────┘
```

| Part | Mendix widget | Notes |
|---|---|---|
| Greeting | Text H2 + text-muted | |
| Buttons | Two action buttons, big (`btn-block`), clock in = Primary | each calls a microflow (create / close a TimeEntry) |
| Today list | List view of TimeEntry, newest first | |
| Layout | Layout grid 5/7, phone 12 | |

The two microflows come first (make them with createMicroflow; this sketch only creates / changes the entry):

```json
{ "ops": [
  { "op": "createMicroflow", "module": "MyFirstModule", "name": "ACT_ClockIn", "actions": [
      { "action": "create", "entity": "MyFirstModule.TimeEntry", "variable": "Entry", "set": { "ClockIn": "[%CurrentDateTime%]" }, "commit": true } ] },
  { "op": "createMicroflow", "module": "MyFirstModule", "name": "ACT_ClockOut", "actions": [
      { "action": "retrieve", "variable": "Open", "entity": "MyFirstModule.TimeEntry", "xpath": "[ClockOut = empty]", "first": true },
      { "action": "if", "condition": "$Open != empty", "then": [
          { "action": "change", "variable": "Open", "set": { "ClockOut": "[%CurrentDateTime%]" }, "commit": true } ] } ] },
  { "op": "createPage", "module": "MyFirstModule", "name": "TimeClock", "title": "Time clock", "widgets": [
    { "widget": "text", "text": "Good morning", "style": "H2" },
    { "widget": "text", "text": "Clock in when you start, clock out when you stop.", "class": "text-muted spacing-outer-bottom-large" },
    { "widget": "layoutGrid", "rows": [ { "columns": [
      { "weight": 5, "tablet": 12, "phone": 12, "widgets": [ { "widget": "container", "class": "acme-card spacing-outer-bottom-medium", "widgets": [
          { "widget": "actionButton", "action": "callMicroflow", "microflow": "MyFirstModule.ACT_ClockIn", "caption": "Clock in", "icon": "mx-icon-play-circle", "style": "Primary", "class": "btn-block btn-lg spacing-outer-bottom-medium", "progress": "blocking" },
          { "widget": "actionButton", "action": "callMicroflow", "microflow": "MyFirstModule.ACT_ClockOut", "caption": "Clock out", "icon": "mx-icon-controls-stop", "class": "btn-block btn-lg", "progress": "blocking" } ] } ] },
      { "weight": 7, "tablet": 12, "phone": 12, "widgets": [ { "widget": "container", "class": "acme-card", "widgets": [
          { "widget": "text", "text": "Today", "style": "H4" },
          { "widget": "listView", "entity": "MyFirstModule.TimeEntry", "pageSize": 10, "sort": [ { "attribute": "ClockIn", "direction": "desc" } ], "widgets": [
              { "widget": "text", "text": "{ClockIn} – {ClockOut}", "format": { "ClockIn": { "date": "HH:mm" }, "ClockOut": { "date": "HH:mm" } } } ] } ] } ] } ] } ] } ] }
] }
```

## R13 Dashboard

```
DESKTOP
┌──────────────────────────────────────────────────────────────┐
│ Dashboard                                                    │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│ │ KPI      │ │ KPI      │ │ KPI      │        (R3)           │
│ └──────────┘ └──────────┘ └──────────┘                       │
│ ┌─────────────────────────────┐ ┌──────────────────────────┐ │
│ │ Recent employees  (R6/R5)   │ │ Quick actions            │ │
│ └─────────────────────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
PHONE: the same boxes stacked, one per row.
```

Build it from R1 + R3 + a layout grid 8/4 (phone 12) with R6 left and a card with buttons right:

```json
{ "ops": [
  { "op": "createPage", "module": "MyFirstModule", "name": "Dashboard", "title": "Dashboard", "widgets": [
    { "widget": "text", "text": "Dashboard", "style": "H2" },
    { "widget": "layoutGrid", "rows": [ { "columns": [
      { "weight": 8, "tablet": 12, "phone": 12, "widgets": [ { "widget": "container", "class": "acme-card", "widgets": [
          { "widget": "text", "text": "Recent employees", "style": "H4" },
          { "widget": "listView", "entity": "MyFirstModule.Employee", "pageSize": 5, "sort": [ { "attribute": "StartDate", "direction": "desc" } ], "widgets": [
              { "widget": "text", "text": "{FullName}" }, { "widget": "text", "text": "{Department}", "class": "text-muted" } ] } ] } ] },
      { "weight": 4, "tablet": 12, "phone": 12, "widgets": [ { "widget": "container", "class": "acme-card", "widgets": [
          { "widget": "text", "text": "Quick actions", "style": "H4" },
          { "widget": "actionButton", "action": "showPage", "page": "MyFirstModule.TimeClock", "caption": "Time clock", "icon": "mx-icon-time-clock", "class": "btn-block spacing-outer-bottom-medium" },
          { "widget": "actionButton", "action": "create", "entity": "MyFirstModule.Employee", "page": "MyFirstModule.Employee_Edit", "caption": "New employee", "icon": "mx-icon-add", "style": "Primary", "class": "btn-block" } ] } ] } ] } ] } ] }
] }
```

## R14 Pop-up edit

Small quick edits only (≤ 6 fields). A pop-up layout, width 600, height auto:

```json
{ "ops": [
  { "op": "createPage", "module": "MyFirstModule", "name": "Employee_QuickEdit", "title": "Quick edit", "entity": "MyFirstModule.Employee",
    "layout": "Atlas_Core.PopupLayout", "popupWidth": 600, "popupHeight": 0,
    "widgets": [ { "widget": "dataView", "source": "parameter", "orientation": "vertical", "buttons": true, "fields": ["FullName", "Department", "Status"] } ] }
] }
```

## R15 Native mobile list and form

Native pages take: text, container, actionButton, dataView, listView, inputs, image, layoutGrid, tabContainer, snippetCall,
scrollContainer, title, pluggable (native .mpk). No data grid, gallery, combo box or pop-up menu (the dry run says what to use).

```
┌──────────────────────┐
│ Employees            │
│ Anna Smith        >  │   list item: tap opens the form (one tap target: no button inside the item)
│ Ben Jones         >  │
└──────────────────────┘
```

```json
{ "ops": [
  { "op": "createPage", "module": "MyFirstModule", "name": "Employee_EditNative", "title": "Employee", "native": true, "entity": "MyFirstModule.Employee",
    "widgets": [ { "widget": "dataView", "source": "parameter", "buttons": true, "fields": ["FullName", "Email", "Department", "StartDate", "Remote"] } ] },
  { "op": "createPage", "module": "MyFirstModule", "name": "Employees_Native", "title": "Employees", "native": true, "widgets": [
    { "widget": "listView", "entity": "MyFirstModule.Employee", "pageSize": 20,
      "onClick": { "action": "showPage", "page": "MyFirstModule.Employee_EditNative" },
      "widgets": [ { "widget": "text", "text": "{FullName}" }, { "widget": "text", "text": "{Department}" } ] } ] }
] }
```

Native rules: no button inside a tappable list item (the item is the tap target); no list inside a scroll container;
keep forms short (the keyboard covers half the screen) and put the save button in the data view footer.

---

## Before you show the user the dry run, check

- [ ] Every layout grid column has `"phone": 12` (or a deliberate phone width).
- [ ] No `style` with colour, border, position, z-index, height or negative margins.
- [ ] No `acme-card` inside another `acme-card`.
- [ ] No list, grid or gallery inside a container with a fixed height.
- [ ] At most one `"style": "Primary"` button per page or card.
- [ ] Long button texts use the two-button pattern on phones.
- [ ] The dry run shows no A11Y CHECK, STYLE CHECK or LAYOUT CHECK error.
