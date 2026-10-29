---
name: mendix-ui-design
description: How to design any Mendix page (web or native) - principles, the atoms (exact widget JSON), how atoms compose into molecules and organisms, responsive rules for phone / tablet / desktop in portrait and landscape, and how to choose the right widget. Use it for every page, form, list, dashboard or "make it nicer" request.
---

# Designing Mendix pages: principles + atoms

You design the page yourself from small parts. This file gives you three things:
1. **Principles** - what a good page is. Each has a test you can check.
2. **Atoms** - the exact JSON of every small part. Copy atoms; never invent keys.
3. **Composition** - how atoms become bigger parts, and how the layout changes per screen size.

Full example pages are in guides/UI_RECIPES.md. Open it only when you want to copy a whole screen.

## First: is there a ready screen?

For a whole screen (clock in / out, a customer list, a dashboard, a sign-in page, a request form, ...) use the screen
catalog first: `guides/screens/INDEX.md` (or `python mx.py screens`) routes to a category; show the user 3-5 numbered
thumbnails of it, let them pick, then one `createScreen` builds the page (and its microflows) with their entity.
Design the page yourself with the rest of this file only when no template fits, or to change a page afterwards.

```json
{ "ops": [ { "op": "createScreen", "module": "MyFirstModule", "name": "TimeClock", "template": "time.clock.big", "slots": { "entity": "MyFirstModule.TimeEntry" } } ] }
```

## Workflow (do this every time)

1. Write the page as a tree in plain words first: `page > header > [title, action] ; section > card > form`.
2. Pick an atom for every leaf. Pick a molecule / organism for every group (below).
3. Write `edits/<name>.json` with one `createPage` (or `addWidgets` for an existing page).
4. `python mx.py dryrun <name>.json`. Read every line with `!`. Fix and repeat (max 3 times, then ask the user).
5. After apply: `python mx.py preview <Module.Page>` and look at the phone and desktop pictures.

## 1. Principles (each one is testable)

| # | Principle | Test before dry run |
|---|---|---|
| P1 | **Layers are visible.** Every nesting level changes surface: page → section (`background-secondary`) → card (`acme-card`). Never the same surface twice in a row | No `acme-card` directly inside `acme-card`; no `background-secondary` inside `background-secondary` |
| P2 | **Text is always readable.** Only theme colours | No `color`, `background` in `style`; text colour only through `text-muted`, `text-primary`, `text-danger`, `text-success`, `text-warning` |
| P3 | **Soft, not hard.** Depth with shadow, not lines | No `border` in `style`; cards use `acme-card` or `shadow-small` |
| P4 | **One scroll.** The page scrolls; nothing inside it scrolls | No `height` / `max-height` / `overflow` in `style`; long lists use paging |
| P5 | **Mobile first.** Every column becomes full width on phones | Every layout grid column has `"phone": 12` (or a deliberate small pair like 8/4 for title + icon) |
| P6 | **Show less on small screens, never lose meaning.** Long captions become icons on phones; the caption stays as tooltip / screen reader text | Every icon-only button has `"tooltip"` |
| P7 | **Forms survive the keyboard.** Labels on top, one field per row on phones, buttons in the flow | `"orientation": "vertical"`; Save/Cancel via `"buttons": true` or in `footer`; nothing fixed to the screen bottom |
| P8 | **Nothing overlaps.** Floating things are pages or widgets made for it | No `position`, `z-index`, `top`, `left`, negative margins in `style` |
| P9 | **One main action.** The eye needs one target | At most one `"style": "Primary"` button per page or card |
| P10 | **Rhythm.** Space from the scale only | Spacing only with `spacing-outer-*-medium/large`, `spacing-inner-medium/large` classes |
| P11 | **Say what it is.** Every input has a label; every image has alt text; every list has an empty message | `label` on inputs; `alt` on images; `emptyMessage` on grids and galleries |
| P12 | **Native: one tap target.** A tappable list item has no button inside it; no list inside a scroll container | `onClick` on the list item and no `actionButton` in its `widgets` |

The dry run also runs A11Y CHECK, STYLE CHECK (theme compile, contrast of the theme's colour pairs), LAYOUT CHECK and,
on native pages, NATIVE STYLE CHECK (nested scrolling, taps inside taps). A line with `!` is something to fix.

## 2. Atoms (copy these; change only names and texts)

Every atom also takes `"name"`, `"class"`, `"visible"`, `"design"`, `"dynamicClass"`.

| Atom | JSON |
|---|---|
| Page title | `{ "widget": "text", "text": "Employees", "style": "H2" }` |
| Section title | `{ "widget": "text", "text": "Contact", "style": "H4" }` |
| Body text | `{ "widget": "text", "text": "Everyone in the company" }` |
| Secondary text | `{ "widget": "text", "text": "{Department}", "class": "text-muted" }` |
| Value with format | `{ "widget": "text", "text": "{Salary}", "format": { "Salary": { "decimals": 2, "groupDigits": true } } }` |
| Date text | `{ "widget": "text", "text": "{StartDate}", "format": { "StartDate": { "date": "dd-MM-yyyy" } } }` |
| Text box | `{ "widget": "input", "attribute": "FullName", "label": "Full name", "required": true, "placeholder": "Anna Smith" }` |
| Text area | `{ "widget": "textArea", "attribute": "Notes", "label": "Notes" }` |
| Number | `{ "widget": "input", "attribute": "Salary", "label": "Salary", "format": { "decimals": 2 } }` |
| Date picker | `{ "widget": "input", "attribute": "StartDate", "label": "Start date", "format": { "date": "date" } }` |
| Check box | `{ "widget": "input", "attribute": "Remote", "label": "Works remote" }` |
| Radio buttons (enum, ≤ 4 values) | `{ "widget": "input", "attribute": "Status", "label": "Status" }` |
| Combo box (enum > 4 values, or a reference) | `{ "widget": "comboBox", "association": "MyFirstModule.Employee_Department", "captionAttribute": "Name", "label": "Department" }` |
| Reference selector (no Combo box widget) | `{ "widget": "referenceSelector", "association": "MyFirstModule.Employee_Department", "attribute": "Name", "label": "Department" }` |
| Primary button | `{ "widget": "actionButton", "action": "save", "caption": "Save", "style": "Primary" }` |
| Button with icon (open a page for the object around it: put it in a data view or list item) | `{ "widget": "actionButton", "action": "showPage", "page": "MyFirstModule.Employee_Edit", "caption": "Edit", "icon": "mx-icon-pencil" }` |
| Icon-only button | `{ "widget": "actionButton", "action": "delete", "caption": "Delete", "icon": "mx-icon-trash-can", "iconOnly": true, "tooltip": "Delete" }` |
| Create button | `{ "widget": "actionButton", "action": "create", "entity": "MyFirstModule.Employee", "page": "MyFirstModule.Employee_Edit", "caption": "New employee", "icon": "mx-icon-add" }` |
| Call a microflow | `{ "widget": "actionButton", "action": "callMicroflow", "microflow": "MyFirstModule.ACT_ClockIn", "caption": "Clock in", "progress": "blocking" }` |
| Confirm before | `{ "widget": "actionButton", "action": "callMicroflow", "microflow": "MyFirstModule.ACT_Archive", "caption": "Archive", "confirm": { "question": "Archive this employee?", "proceed": "Archive", "cancel": "Keep" } }` |
| Status label | `{ "widget": "badge", "text": "{Status}", "type": "label" }` |
| Image (a real image name: `python mx.py find logo`) | `{ "widget": "image", "image": "Atlas_Core.Layout.logo", "width": 120, "alt": "Company logo" }` |

**Icons** that exist in Atlas: `mx-icon-add`, `mx-icon-pencil`, `mx-icon-trash-can`, `mx-icon-search`, `mx-icon-home`,
`mx-icon-user`, `mx-icon-checkmark`, `mx-icon-play-circle`, `mx-icon-controls-stop`, `mx-icon-time-clock`,
`mx-icon-calendar`, `mx-icon-logout`. For another one, try it: the dry run suggests real names.

**Choosing the input** (the attribute type decides; you only choose for enumerations and references):

| Attribute | Atom |
|---|---|
| String ≤ 200 | Text box |
| String unlimited / long | Text area |
| Integer, Long, Decimal | Number |
| DateTime | Date picker |
| Boolean | Check box |
| Enumeration with ≤ 4 values | Radio buttons |
| Enumeration with > 4 values | Combo box (`"attribute"`) |
| Reference (one object) | Combo box (`"association"`), else Reference selector |
| Reference set | `referenceSetSelector` |

## 3. Molecules (atoms in a box)

| Molecule | Structure | Rules |
|---|---|---|
| **Card** | `container` `acme-card` > [section title, texts / inputs, buttons] | P1: never a card in a card |
| **Field pair** | `layoutGrid` row with two columns `{ "weight": 6, "tablet": 6, "phone": 12 }`, one input each | P5, P7 |
| **Header** | `layoutGrid` row 8/4 (`phone` 8/4) > [title + secondary text] / [actions, `class` `text-right`] | P9: the header action is the page's one Primary |
| **Responsive action** | two buttons with the same action: wide one `class: hide-phone`; icon-only one `class: hide-tablet hide-desktop` with `tooltip` | P6 |
| **Button bar** | a `container` with buttons; Primary last | P9 |
| **Stat** | card > [secondary text label, H2 value] | |
| **Empty state** | card `text-center spacing-inner-large` > [H3, secondary text, one Primary button] | P11 |

```json
{ "widget": "layoutGrid", "rows": [ { "columns": [
  { "weight": 8, "tablet": 8, "phone": 8, "widgets": [ { "widget": "text", "text": "Employees", "style": "H2" } ] },
  { "weight": 4, "tablet": 4, "phone": 4, "class": "text-right", "widgets": [
    { "widget": "actionButton", "action": "create", "entity": "MyFirstModule.Employee", "page": "MyFirstModule.Employee_Edit", "caption": "New employee", "icon": "mx-icon-add", "style": "Primary", "class": "hide-phone" },
    { "widget": "actionButton", "action": "create", "entity": "MyFirstModule.Employee", "page": "MyFirstModule.Employee_Edit", "caption": "New employee", "icon": "mx-icon-add", "iconOnly": true, "tooltip": "New employee", "style": "Primary", "class": "hide-tablet hide-desktop" } ] } ] } ] }
```

## 4. Organisms (molecules with data)

| Organism | Mendix widget | Choose it when | Keys that matter |
|---|---|---|---|
| **Form** | `dataView` `source: parameter`, `orientation: vertical`, `buttons: true` | create / edit one object | `widgets`: field pairs |
| **Read view** | `dataView` `editable: false`, `showFooter: false` | show one object | |
| **Table** | `dataGrid` `kind: datagrid2` | admin, many columns, sorting, export | `columns` (≤ 5), `headerFilters`, `paging`, `emptyMessage`, `onClick` |
| **Card grid** | `gallery` | users, phones, pictures | `columns: { "desktop": 3, "tablet": 2, "phone": 1 }`, `emptyMessage`, `onClick` |
| **Simple list** | `listView` | short lists, native, inside a card | `pageSize`, `onClick`, `sort` |
| **Master-detail** | layout grid 4/8 (phone 12): `listView` `name` + `dataView` `listenTo` | browse and read side by side | |
| **Sections** | `tabContainer` (≤ 5 tabs) or `accordion` | one object with many fields | |
| **Row menu** | `popupMenu` with `items` | 3+ row actions | never the drop-down button |

**Lists: which one?**

| Need | Pick |
|---|---|
| > 5 columns, admin, export to Excel | Table |
| End users, phones, a picture or a status per item | Card grid |
| ≤ 20 items, inside a card, or a native page | Simple list |

## 5. Templates (page skeletons)

Pick one skeleton, then fill its slots with organisms.

```
LIST PAGE                     DETAIL PAGE                  DASHBOARD
header (title + action)       header (title + Edit)        header
filters (headerFilters)       tabs / sections              row of stats (4/4/4, phone 12)
table or card grid            cards                        8/4: list card | actions card
```

```
FORM PAGE                     SIGN-IN (createLoginPage)    NATIVE
header (title)                heading                      list (listView, onClick)
card > form (field pairs)     user name, password          or form (dataView, fields)
Save / Cancel (footer)        Sign in                      Save in the footer
```

## 6. Responsive rules (phone, tablet, desktop; portrait and landscape)

| Screen | Columns | Navigation | Buttons | Lists |
|---|---|---|---|---|
| Phone portrait (< 576 px) | 1 (`phone: 12`) | menu behind the toggle | icon-only for secondary actions (P6) | card grid 1 column, simple list |
| Phone landscape | 1-2 | same | same | card grid 2 columns at most |
| Tablet (576-992 px) | 2 (`tablet: 6`) | side bar can open | caption + icon | card grid 2 columns |
| Desktop (> 992 px) | up to 3-4 (`weight`) | side bar / top bar open | caption + icon | table or card grid 3 |

Atlas classes for per-device visibility: `hide-phone`, `hide-tablet`, `hide-desktop` (they work in portrait and
landscape). Columns: `weight` (desktop), `tablet`, `phone` on every layout grid column.

## 7. Native pages

Native widgets: text, container, actionButton, dataView, listView, inputs (textBox, textArea, checkBox, datePicker,
radioButtons, dropDown), referenceSelector, image, layoutGrid, tabContainer, snippetCall, scrollContainer, title,
pluggable (native .mpk). No table, card grid, combo box or pop-up menu: the dry run says what to use instead.
Rules: P12; short forms (the keyboard takes half the screen); one main action at the bottom of the form footer.

## 8. When something is refused

| Dry run says | Do |
|---|---|
| `icon 'x' is not known ... Did you mean` | take one of the suggested names |
| `needs the ... widget (widgets/*.mpk ...)` | use the fallback named in the message (Table → Simple list, Combo box → Reference selector, Pop-up menu → buttons) |
| `paging mode 'x' is not known` | use `buttons` |
| A11Y CHECK `!` | add the missing label / alt / tooltip |
| LAYOUT / STYLE CHECK `!` | follow the principle it names; remove the inline `style` |
