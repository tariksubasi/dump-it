---
name: mendix-readonly-widgets
description: Catalog of reusable, configurable READ-ONLY display widgets for Mendix 10.24 (web and native) that replace ugly default detail, overview, dashboard and list pages fast - section card that wraps existing widgets, detail header, field list (key/value), status chip, KPI tiles, timeline, card list, info banner, empty state, avatar/image header, progress steps, attachment list, HTML viewer. Gives each widget's property contract (XML), layout per size class, states, and the order to build them. Use when the user wants to make existing pages nicer without editing logic, build display/detail/dashboard widgets, or asks which widgets to build first.
---

# Read-only display widgets: few widgets, most of the app

Idea: legacy pages repeat the same few display patterns. Build **10–12 configurable widgets once** and reuse them on
every page. No business logic changes, low risk (no editing, no commits). Combine with `mendix-widget-ui-design`
(look), `mendix-web-widget` / `mendix-native-widget` (build) and `mendix-legacy-page-redesign` (process).

## 1. The catalog (build in this order — value/effort)

| # | Widget | Replaces on old pages | Value | Effort | Build order |
|---|---|---|---|---|---|
| 1 | **SectionCard** | group boxes, plain containers with a title | 10 | 2 | 1st — wraps existing Mendix widgets in a clean card: instant improvement everywhere |
| 2 | **FieldList** (key/value) | read-only data views with label + text rows | 10 | 4 | 2nd — most detail pages |
| 3 | **DetailHeader** | page title + a few texts + buttons on top | 9 | 4 | 3rd |
| 4 | **StatusChip** | status text/enum shown as plain text | 8 | 2 | with FieldList |
| 5 | **KpiTiles** | dashboards with numbers in containers | 8 | 3 | 4th |
| 6 | **CardList** (exists: `native-widgets/card-list`, web) | list views / grids used only for browsing | 9 | done | reuse |
| 7 | **Timeline** | history/audit list views | 7 | 4 | 5th |
| 8 | **InfoBanner** | alert texts, warnings in containers | 7 | 2 | any time |
| 9 | **EmptyState** | "no data" texts | 6 | 1 | inside 2, 6, 7 |
| 10 | **AvatarHeader / ImageHeader** | images + name blocks | 6 | 3 | later |
| 11 | **ProgressSteps** | status flows (Draft → Approved → Done) | 6 | 3 | later |
| 12 | **AttachmentList** | file document lists with download buttons | 5 | 3 | later |
| 13 | **HtmlViewer** (exists, native) | rich text / HTML fields | 7 | done | reuse |

Rule: a widget is generic when its properties are **expressions and object lists**, not page-specific attributes.

## 2. Contracts (XML properties) — copy, then adjust

| Widget | Properties (key: type) | Notes |
|---|---|---|
| SectionCard | `title: textTemplate`, `subtitle: textTemplate?`, `icon: icon?`, `content: widgets`, `headerActions: widgets?`, `collapsible: boolean`, `startCollapsed: boolean`, `tone: enumeration(default, info, success, warning, danger)`, `padding: enumeration(compact, normal, roomy)` | `content` = drop zone: existing Mendix inputs/grids stay inside and keep working; only the frame changes. Tone = left accent + tinted header, never a full colored background |
| FieldList | `fields: object list { label: textTemplate, value: expression(String), icon: icon?, emphasis: enumeration(normal, strong, muted), hideWhenEmpty: boolean, span: enumeration(auto, full), copyable: boolean, onClick: action? }`, `columns: enumeration(auto, one, two, three)`, `labelPosition: enumeration(auto, top, side)`, `emptyValueText: textTemplate` | One widget replaces a whole read-only data view. Values come from expressions (`$currentObject/...`, formatted with `formatDecimal`, `formatDateTime`). `auto`: 1 col compact, 2 medium, 3 expanded; labels on top when compact, beside when wide. Long values wrap; `span full` for notes |
| DetailHeader | `title: expression`, `subtitle: expression?`, `meta: object list { icon, text: expression }`, `status: expression?` + `statusTone: expression?` (returns key: info/success/warning/danger/neutral), `image: image?`, `primaryAction: action?` + `primaryCaption: textTemplate`, `secondaryActions: object list { caption, icon, action, destructive: boolean }` | compact: title, status chip below, primary action full width, others in "more"; wide: one row with actions on the right |
| StatusChip | `text: expression`, `tone: expression` (key) or `toneMap: object list { value, tone }`, `icon: icon?`, `size: enumeration(small, medium)` | text + tinted background token pair + icon (not color-only) |
| KpiTiles | `tiles: object list { label: textTemplate, value: expression(String), trend: expression(Decimal)?, trendGoodWhen: enumeration(up, down), icon: icon?, onClick: action?, hint: textTemplate? }` | 2 per row compact, 3–4 medium, 4–6 wide; value never truncated (font steps down), label wraps |
| Timeline | `ds: datasource`, `time: attribute(DateTime) [ds]`, `title: expression [ds]`, `text: expression [ds]?`, `tone: expression [ds]?`, `onItemClick: action [ds]?`, `pageSize: integer`, `emptyText: textTemplate` | groups by day ("Today", "Yesterday", date); "Load more"; embedded (page scrolls) |
| InfoBanner | `text: textTemplate`, `tone: enumeration`, `icon: icon?`, `action: action?` + `actionCaption`, `dismissible: boolean` | inline, not a toast |
| EmptyState | `icon: icon?`, `title: textTemplate`, `text: textTemplate?`, `action: action?` + caption | used inside lists or alone |
| AvatarHeader | `image: image?`, `initialsFrom: expression`, `title`, `subtitle`, `badges: object list { text, tone }` | initials fallback when no image; image cached |
| ProgressSteps | `steps: object list { label: textTemplate, key: string }`, `current: expression(String)` (= a key), `failedKey: expression?` | horizontal on wide, vertical on compact; current step bold + `primary` |
| AttachmentList | `ds: datasource`, `name: attribute [ds]`, `size: attribute(Long) [ds]?`, `file: file? / onOpen: action [ds]` | open/download via action (Mendix file download); icon by extension |

Shared props for all: `debugMode: boolean` (diagnostic dialog, see `native-widgets/html-viewer`) and the Common group
(`Name`, `Visibility`).

## 3. Why read-only first (and the traps)

| Point | Detail |
|---|---|
| Low risk | no `setValue`, no commit, no validation; actions only call existing flows |
| Fast | contracts above are reused; one page often needs only SectionCard + FieldList + DetailHeader |
| Formatting | do formatting in the expression (Studio Pro, language-aware) or with `formatter` when you read attributes |
| Conditions | visibility stays Mendix's (Common → Visibility); do not rebuild role checks in the widget |
| Trap: data view context | read-only widgets still need the data view / list item around them for `$currentObject` |
| Trap: hidden empty fields | `hideWhenEmpty` must not hide fields people need to see as "-" (ask) |
| Trap: copying values | `copyable` on web uses the Clipboard API (https only); native needs a clipboard module (not in Native Template 14 by default) — leave it out on native unless the app has one |
| Trap: images | always a fixed aspect-ratio box and a fallback (initials / icon) |
| Trap: dates and numbers | never `toString()`; use expressions or formatters |

## 4. Page recipes (combine the widgets)

| Old page type | New structure |
|---|---|
| Detail (read-only data view) | DetailHeader → SectionCard("Details", FieldList) → SectionCard("History", Timeline) |
| Detail with a few edit buttons | DetailHeader (actions call the existing edit page/flows) + FieldList |
| Overview list | DetailHeader-like page title + CardList (web) / searchable list (native recipe) |
| Dashboard | KpiTiles → SectionCard per chart/list → InfoBanner for alerts |
| Profile | AvatarHeader → SectionCard(FieldList) → AttachmentList |
| Mixed edit page | keep the Mendix inputs, wrap groups in SectionCard (frame only) — big visual gain, zero logic risk |

## 5. Definition of done per widget

All rows of `mendix-widget-ui-design` section 16, plus: contract table matches the XML; one page uses it; added to
`WIDGETS.md`; screenshots in xs/compact/medium/expanded portrait + landscape.
