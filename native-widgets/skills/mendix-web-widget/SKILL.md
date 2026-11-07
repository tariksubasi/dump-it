---
name: mendix-web-widget
description: Build Mendix 10.24 WEB (React) pluggable widgets end to end - scaffold the project, write the widget XML (every property type, data sources, linked properties, object lists, actions with variables, selection, associations), write the React component with the Mendix client API (EditableValue, DynamicValue, ActionValue, ListValue, filters, sorting, paging), style it with CSS/SCSS and Atlas classes, add npm packages, write the Studio Pro preview (editorPreview + editorConfig), test with Jest and Testing Library, lint, build the .mpk and install it. Use when the user asks for a web widget, a browser widget, a React component for a Mendix web/responsive page, a data/list/grid/chart/input widget, or to fix/build an existing web widget.
---

# Mendix 10.24 web pluggable widgets (React)

Target: Studio Pro **10.24.x** (React client), React **18**, `@mendix/pluggable-widgets-tools` **10.24.1**,
`mendix` typings **10.24**. Every XML snippet, generated type and command in this file was checked with the 10.24
XSD, the 10.24.1 typings generator and a real build (`release:web`) and test run (`test:unit:web`).

How to use this file: read sections 0 and 1 first. Follow section 2 for every task. If something is not in this file,
say **"NOT IN SKILL"** and ask; never invent an API.

---

## 0. The 25 rules that break builds most often

| # | Rule | What goes wrong otherwise |
|---|---|---|
| 1 | Node **22.18+**, npm 8+ | Tools exit: "a minimum node version ^22.18.0 is required" |
| 2 | `package.json` `widgetName` = `src/<WidgetName>.tsx` = `src/<WidgetName>.xml` = clientModule `name` | "Cannot find a widget entry file" |
| 3 | Widget id = `<packagePath>.<widgetname lower>.<WidgetName>` — never shorten it by hand (`TeiMealCard` → `tei.teimealcard.TeiMealCard`). Check every mpk with `node ../tools/check-mpk.mjs dist/<v>/<file>.mpk` | widget files not found / empty widget |
| 4 | `src/package.xml` `<file path="<packagePath>/<widgetname lower>" />` | empty widget |
| 5 | `supportedPlatform="Web"` (default) for web widgets | `Native` gives native typings |
| 6 | Element order inside `<property>` (XSD sequence): `caption`, `category?`, `description`, `attributeTypes?`, `associationTypes?`, `selectionTypes?`, `enumerationValues?`, `properties?`, `returnType?`, `translations?`, `actionVariables?` | Studio Pro: "invalid child element …" |
| 7 | Every `<property>` has a `<description>`; a `<propertyGroup>` holds either groups or properties, never both | XSD error |
| 8 | `helpUrl` only https on `*.mendix.com` or a GitHub `.md`; else leave it out | Studio Pro error |
| 9 | **No** `import { createElement }` — new JSX transform | TS6133 breaks the build |
| 10 | Component props type = `<Widget>ContainerProps` (generated); preview = `<Widget>PreviewProps` | type errors |
| 11 | Check `.status === ValueStatus.Available` before `.value` | crash while loading |
| 12 | Run actions only when `canExecute && !isExecuting` | double execution |
| 13 | In an object list, link to the parent data source with `dataSource="../ds"` | wrong type, no error |
| 14 | `onChange="actionKey"` on an attribute: Mendix runs it after `setValue`; it is **not** a prop | missing prop confusion |
| 15 | Apply `props.class` and `props.style` on the root, `tabIndex` on the focusable element. With `<systemProperty key="Label"/>`, `class`/`style` are **removed** and `id: string` is added (Mendix wraps the label) — put `id` on the input | Design properties do nothing / label not linked |
| 16 | Ref writes in `useLayoutEffect`, not in render | lint "Cannot update ref during render" |
| 17 | No synchronous `setState` in an effect body | lint `react-hooks/set-state-in-effect` |
| 18 | Prettier only on `src/**/*.{ts,tsx}` | XML broken |
| 19 | `classnames` (and any helper lib) must be in `dependencies` — the tools do not bring it | TS2307 Cannot find module |
| 20 | Do not bundle `react`, `react-dom`, `mendix`, `big.js` (external) | "Invalid hook call", huge bundle |
| 21 | CSS: import a `.css`/`.scss` file in the widget; prefix classes `widget-<name>` | style leaks into the page |
| 22 | Decimals and integers from attributes are `Big` | wrong math |
| 23 | Version in both `package.json` and `src/package.xml` | old code stays |
| 24 | Accessible markup: labels, `aria-*`, keyboard | fails WCAG, unusable without mouse |
| 25 | Never render nothing silently: loading / empty / unavailable / error states | "it shows nothing" |
| 26 | `widgetName` letters only; `packagePath` lower-case without `-` | load errors |
| 27 | Never list `react`, `react-dom`, `@types/react*` in dependencies/devDependencies | tools ask "Update dependencies?" and rewrite package.json; skip with `CI=true` |
| 28 | `release` does **not** copy to `config.projectPath`; `build` / `start` do | copy the mpk yourself |
| 29 | Untyped package / SVG import → `typings/modules.d.ts`: `declare module "pkg";` and `declare module "*.svg" { const url: string; export default url; }` | TS7016 / TS2307 |
| 30 | Rollup warnings fail build/release | fix the warning |
| 31 | LF line endings; `.prettierignore` lists `dist/` and an inside `projectPath` | lint errors |

---

### 0.1 Facts the docs get wrong (trust these)

| Docs say | Correct for 10.24 |
|---|---|
| `notEquals(...)` | `notEqual(...)` |
| `literal(10)` | `literal(new Big(10))` |
| AutoNumber → `string`, Integer expression → `number` | `Big` |
| `myWidgets(item)` | `myWidgets.get(item)` |
| no `reload` on ListValue | `reload()` exists |
| React 17 | React 18 |

### 0.2 Feature version gates

| Feature | Studio Pro |
|---|---|
| `setLabel="true"` (with `systemProperty Label`) | 10.5 |
| `selection` | 10.7 |
| `renderMode` in preview | 10.11 |
| action `defaultType` / `defaultValue` | 10.15 |
| datasource `defaultType` / `defaultValue` | 10.16 |
| `actionVariables` + `execute({...})` | 10.21 |
| hidden properties reset to default; type conversion on update | 10.24 |

## 1. Environment and versions

| Item | Value |
|---|---|
| Node.js | `^22.18.0` |
| npm | ≥ 8 |
| `@mendix/pluggable-widgets-tools` | `10.24.1` (devDependency) |
| `mendix` typings | 10.24 (inside the tools); API truth: `node_modules/mendix/index.d.ts` |
| React / React DOM | 18 (from the Mendix client; external) |
| Studio Pro | 10.24.x; F4 = synchronize app directory |
| Live reload | `npm start` with `config.mendixHost` = running app (`http://localhost:8080`) and `developmentPort` |

---

## 2. Workflow (every task)

1. Requirements table: property | XML type | required | default | why.
2. XML → `npm run validate` → `npm run build` (generates `typings/`).
3. Edge-case table (section 12).
4. Pure logic in `src/<name>Logic.ts`; UI in `src/<Widget>.tsx` + `src/components/*.tsx`; CSS in `src/ui/<Widget>.css`.
5. Studio Pro preview: `src/<Widget>.editorPreview.tsx` and `src/<Widget>.editorConfig.ts`.
6. Tests: logic + render (`@testing-library/react`).
7. Gate: `npx tsc --noEmit -p .`, `npm run lint`, `npm test`, `npm run release` → table of results.
8. Bump version (both files), report mpk path and install steps.
9. Same error 3 times → stop and show it.

---

## 3. Layout and naming

```
my-widget/
├─ package.json  tsconfig.json  .eslintrc.js  .prettierrc  .gitignore
├─ src/
│  ├─ MyWidget.xml
│  ├─ MyWidget.tsx               entry: export function MyWidget(props: MyWidgetContainerProps)
│  ├─ MyWidget.editorPreview.tsx export function preview(props) + getPreviewCss()
│  ├─ MyWidget.editorConfig.ts   getProperties / check / getPreview (structure mode)
│  ├─ package.xml
│  ├─ components/                presentational React components
│  ├─ ui/MyWidget.css            (or .scss)
│  └─ __tests__/
├─ typings/MyWidgetProps.d.ts    GENERATED
└─ dist/<version>/dumpit.MyWidget.mpk
```

| Name | Rule | Example |
|---|---|---|
| Folder / npm name | lower-case-dashes | `card-list` |
| `widgetName` | PascalCase | `CardList` |
| `packagePath` | lower-case | `dumpit` |
| id | `<packagePath>.<lower>.<Name>` | `dumpit.cardlist.CardList` |
| CSS root class | `widget-<folder name>` | `.widget-card-list` |

---

## 4. Scaffold (verified: builds, lints and tests clean)

**package.json**
```json
{
  "name": "my-widget",
  "widgetName": "MyWidget",
  "version": "1.0.0",
  "description": "What the widget does",
  "license": "Apache-2.0",
  "packagePath": "dumpit",
  "config": { "projectPath": "../../MendixProject", "mendixHost": "http://localhost:8080", "developmentPort": 3000 },
  "scripts": {
    "start": "pluggable-widgets-tools start:web",
    "build": "pluggable-widgets-tools build:web",
    "release": "npm run validate && pluggable-widgets-tools release:web",
    "lint": "pluggable-widgets-tools lint",
    "lint:fix": "pluggable-widgets-tools lint:fix",
    "test": "pluggable-widgets-tools test:unit:web",
    "validate": "xmllint --noout --schema node_modules/mendix/custom_widget.xsd src/MyWidget.xml"
  },
  "dependencies": { "classnames": "^2.5.1" },
  "devDependencies": { "@mendix/pluggable-widgets-tools": "10.24.1" }
}
```
No xmllint: `"release": "pluggable-widgets-tools release:web"`.
`config.projectPath` (or env `MX_PROJECT_PATH`, default `./tests/testProject`) is used only by `build`/`start`: they copy to
`<project>/widgets/` and unzip into `deployment/web/widgets`. `mendixHost` / `developmentPort` are not read by tools 10.24.1.

**tsconfig.json**, **.eslintrc.js**, **.prettierrc**, **.gitignore**: same as the native skill:
```json
{ "extends": "@mendix/pluggable-widgets-tools/configs/tsconfig.base.json",
  "compilerOptions": { "baseUrl": "./", "types": ["jest"] }, "include": ["./src", "./typings"] }
```
`.eslintrc.js`: `module.exports = require("@mendix/pluggable-widgets-tools/configs/eslint.ts.base.json");`
`.prettierrc`: `"@mendix/pluggable-widgets-tools/configs/prettier.base.json"` — `.gitignore`: `node_modules/`, `dist/tmp/`, `dist/coverage/` (Jest writes coverage there unless `CI=true`)

**src/package.xml**
```xml
<?xml version="1.0" encoding="utf-8" ?>
<package xmlns="http://www.mendix.com/package/1.0/">
    <clientModule name="MyWidget" version="1.0.0" xmlns="http://www.mendix.com/clientModule/1.0/">
        <widgetFiles>
            <widgetFile path="MyWidget.xml" />
        </widgetFiles>
        <files>
            <file path="dumpit/mywidget" />
        </files>
    </clientModule>
</package>
```

**src/MyWidget.xml**
```xml
<?xml version="1.0" encoding="utf-8" ?>
<widget id="dumpit.mywidget.MyWidget" pluginWidget="true" needsEntityContext="true" offlineCapable="true"
        supportedPlatform="Web"
        xmlns="http://www.mendix.com/widget/1.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.mendix.com/widget/1.0/ ../node_modules/mendix/custom_widget.xsd">
    <name>My widget</name>
    <description>Shows and edits a text attribute.</description>
    <studioProCategory>Input elements</studioProCategory>
    <properties>
        <propertyGroup caption="General">
            <propertyGroup caption="Data">
                <property key="value" type="attribute" required="true" onChange="onChangeAction">
                    <caption>Value</caption>
                    <description>The text attribute.</description>
                    <attributeTypes>
                        <attributeType name="String" />
                    </attributeTypes>
                </property>
                <property key="onChangeAction" type="action" required="false">
                    <caption>On change</caption>
                    <description>Runs after the value changes.</description>
                </property>
                <property key="placeholder" type="textTemplate" required="false">
                    <caption>Placeholder</caption>
                    <description>Shown when empty.</description>
                    <translations>
                        <translation lang="en_US">Type here</translation>
                        <translation lang="tr_TR">Buraya yazın</translation>
                    </translations>
                </property>
            </propertyGroup>
        </propertyGroup>
        <propertyGroup caption="Common">
            <systemProperty key="Name" />
            <systemProperty key="TabIndex" />
            <systemProperty key="Visibility" />
            <systemProperty key="Editability" />
        </propertyGroup>
    </properties>
</widget>
```
Generated: `MyWidgetContainerProps { name: string; class: string; style?: CSSProperties; tabIndex?: number;
value: EditableValue<string>; placeholder?: DynamicValue<string> }` — note: no `onChangeAction` prop (rule 14).

**src/MyWidget.tsx**
```tsx
import { ChangeEvent, ReactElement } from "react";
import classNames from "classnames";
import { ValueStatus } from "mendix";

import { MyWidgetContainerProps } from "../typings/MyWidgetProps";
import "./ui/MyWidget.css";

export function MyWidget(props: MyWidgetContainerProps): ReactElement {
    const { value } = props;
    const text = value.status === ValueStatus.Available ? value.value ?? "" : "";
    const placeholder = props.placeholder?.status === ValueStatus.Available ? props.placeholder.value : "";
    const onChange = (e: ChangeEvent<HTMLInputElement>): void => value.setValue(e.target.value);
    return (
        <div className={classNames("widget-my-widget", props.class)} style={props.style}>
            <input
                className="form-control"
                tabIndex={props.tabIndex}
                value={text}
                placeholder={placeholder}
                disabled={value.readOnly || value.status !== ValueStatus.Available}
                onChange={onChange}
                aria-invalid={!!value.validation}
            />
            {value.validation ? <div className="alert alert-danger mx-validation-message">{value.validation}</div> : null}
        </div>
    );
}
```

**src/MyWidget.editorPreview.tsx** (Design mode in Studio Pro)
```tsx
import { ReactElement } from "react";
import { MyWidgetPreviewProps } from "../typings/MyWidgetProps";

export function preview(props: MyWidgetPreviewProps): ReactElement {
    return <input className="form-control" readOnly value={`[${props.value || "attribute"}]`} />;
}

export function getPreviewCss(): string {
    return require("./ui/MyWidget.css");
}
```

**src/ui/MyWidget.css** — `.widget-my-widget input { width: 100%; }`

Then: `npm install` → `npm run build` → `npm run release`. The mpk contains `MyWidget.xml`, `package.xml`,
`MyWidget.editorPreview.js`, `dumpit/mywidget/MyWidget.js` + `.mjs` + `.css`, `dependencies.json` + `dependencies.txt`
(licenses of bundled packages).

Generator alternative: `npx @mendix/generator-widget@10.24-latest MyWidget` (never `@latest` = 11.x) → Web,
TypeScript, function component, empty template. Its scripts: `start` = `start:server` (same as `start:web`), `dev` =
`start:web`, `prerelease` = `npm run lint`, `test:e2e` = `npx cypress open --browser chrome --e2e` (the tools' own e2e
commands were removed).

---

## 5. Commands

| Command | Does |
|---|---|
| `npm install` | once per clone |
| `npm run build` | dev build + typings → `dist/tmp/widgets/` (and copy to `projectPath` if set) |
| `npm run release` | production build (babel, terser, licenses) → `dist/<version>/<packagePath>.<Widget>.mpk`; no copy |
| `npm start` | `start:web` = rollup watch; copies into the running app's `deployment/web/widgets` (needs `projectPath`); refresh the browser (disable cache in devtools) |
| XML changed | F4 in Studio Pro → right-click the widget → Update widget |
| `npm test` | Jest (jsdom) |
| `npm run lint` / `lint:fix` | Prettier + ESLint |
| `npx tsc --noEmit -p .` | type check |
| `unzip -l dist/<v>/*.mpk` | inspect the package |

---

## 6. Widget XML reference (verified with the 10.24 XSD)

`<widget>` attributes: `id`, `pluginWidget="true"`, `needsEntityContext` (true = inside a data view; required for
attribute/association/linked props), `offlineCapable`, `supportedPlatform="Web|Native|All"`.
Children in order: `<name>`, `<description>`, `<studioProCategory>`?, `<helpUrl>`?, `<properties>`.
Groups: `<propertyGroup caption="Tab">` → `<propertyGroup caption="Section">` → `<property>`.
`<systemProperty key="Label|Name|TabIndex|Editability|Visibility" />`.

| XML `type` | Key XML | Generated web type | Notes |
|---|---|---|---|
| `string` | `defaultValue`, `multiline="true"` | `string` | |
| `boolean` | `defaultValue` | `boolean` | |
| `integer` | `defaultValue` | `number` | |
| `decimal` | `defaultValue` | `Big` | |
| `enumeration` | `<enumerationValues><enumerationValue key="a">A</enumerationValue>` | `"a" \| "b"` | |
| `icon` | | `DynamicValue<WebIcon>` (`glyph` / `image` / `icon` + `iconClass`/`iconUrl`) | `mendix/components/web/Icon` |
| `image` | | `DynamicValue<WebImage>` (`uri`, `name?`, `altText?`) | `<img src={uri} alt={altText}>` |
| `file` | | `DynamicValue<FileValue>` (`uri`, `name?`) | download link |
| `expression` | `<returnType type="String\|Boolean\|Integer\|Decimal\|DateTime"/>` | `DynamicValue<…>` | |
| `textTemplate` | `<translations>` | `DynamicValue<string>` | |
| `attribute` | `<attributeTypes>` (String, Integer, Long, Decimal, Boolean, DateTime, Enum, HashString, AutoNumber), `onChange` | `EditableValue<string \| Big \| boolean \| Date>` | |
| `association` | `<associationTypes>` Reference/ReferenceSet, `selectableObjects="ds"` | `ReferenceValue` / `ReferenceSetValue` | |
| `action` | optional `<actionVariables><actionVariable key="x" type="String\|Integer\|Decimal\|Boolean\|DateTime" caption="X"/>` | `ActionValue` / `ActionValue<{ x: Option<string> }>` | |
| `datasource` | `isList="true"` | `ListValue` | |
| linked (`dataSource="ds"`): attribute / expression / textTemplate / action / widgets | | `ListAttributeValue` / `ListExpressionValue` / `ListExpressionValue<string>` / `ListActionValue` / `ListWidgetValue` | `.get(item)` |
| `selection` + `dataSource` | `<selectionTypes>` None/Single/Multi | `SelectionSingleValue \| SelectionMultiValue` | |
| `widgets` | | `ReactNode` | drop zone |
| `object` `isList="true"` | nested `<properties>`; parent link `dataSource="../ds"` | `<Key>Type[]` | columns, series, … |

Preview types (`<W>PreviewProps`): attribute/expression/textTemplate → `string`; integer → `number | null`;
action → `{} | null`; datasource → `{} | { caption } | { type } | null`; image → `{type:"static", imageUrl} |
{type:"dynamic", entity} | null`; widgets → `{ widgetCount, renderer }`; plus `class`, `style` (string), `styleObject`,
`readOnly`, `renderMode: "design" | "xray" | "structure"`, `translate(text)`.

Verified snippets for lists, object lists, action variables, associations and translations: see the native skill
section 6.4 (identical XML; only `supportedPlatform` differs).

---

## 7. Client API (from `mendix/index.d.ts` 10.24)

| API | Members |
|---|---|
| `ValueStatus` | `Available`, `Unavailable`, `Loading` |
| `DynamicValue<T>` | `status`, `value` |
| `EditableValue<T>` | `status`, `value`, `displayValue`, `readOnly`, `validation`, `setValue`, `setTextValue`, `setValidator`, `formatter`, `setFormatter`, `universe?` |
| `ActionValue<Args>` | `canExecute`, `isExecuting`, `execute()` / `execute({…})` |
| `ListValue` | `status`, `items?`, `offset`, `limit` (default ∞), `setOffset`, `setLimit` (`0` = lazy), `hasMoreItems?`, `totalCount?` (after `requestTotalCount(true)`), `sortOrder`, `setSortOrder` (check `sortable`), `filter`, `setFilter` (check `filterable`), `reload`. Database/XPath sources page/sort/filter on the server; others on the client. Call setters once, not every render |
| `ListAttributeValue<T>` | `get(item)` (**read-only** value), `id`, `sortable`, `filterable`, `type`, `formatter`, `universe` |
| `ListExpressionValue<T>` / `ListActionValue` / `ListWidgetValue` | `get(item)` |
| `ReferenceValue` / `ReferenceSetValue` | `value`, `setValue`, `readOnly`, `validation`, `setValidator` |
| `SelectionSingleValue` / `SelectionMultiValue` | `selection`, `setSelection`, `setKeepSelection`, `type` |
| `ObjectItem` | `id` (use as React key) |
| Filters | `mendix/filters/builders`: `attribute`, `association`, `literal`, `empty`, `equals`, `notEqual`, `greaterThan(OrEqual)`, `lessThan(OrEqual)`, `contains`, `startsWith`, `endsWith`, `dayEquals`, `dayNotEqual`, `dayGreaterThan(OrEqual)`, `dayLessThan(OrEqual)`, `and`, `or`, `not` |
| Hook | `mendix/hooks` → `usePersistentState(key, initial)` |
| Icon | `mendix/components/web/Icon` → `<Icon icon={icon.value} altText="…" />` |

### 7.1 Patterns

```tsx
// paging list
const ds = props.ds!;
// set paging once on mount, never on every render
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { ds.setLimit(20); }, []);
const items = ds.items ?? [];
return (
  <ul className={classNames("widget-card-list", props.class)} style={props.style}>
    {items.map(item => (
      <li key={item.id}>
        <button type="button" onClick={() => props.onItemClick?.get(item).execute()}>
          {props.title?.get(item).displayValue}
        </button>
        {props.content?.get(item)}
      </li>
    ))}
    {ds.hasMoreItems ? <button type="button" onClick={() => ds.setLimit(ds.limit + 20)}>More</button> : null}
  </ul>
);

// search with a filter (debounced)
ds.setFilter(query ? contains(attribute(props.title!.id), literal(query)) : undefined);

// sort
ds.setSortOrder([[props.title!.id, "desc"]]);

// action with variables
props.onSelect?.canExecute && props.onSelect.execute({ id: String(item.id) });
```

---

## 8. Studio Pro integration

| File | Exports | Purpose |
|---|---|---|
| `<W>.editorPreview.tsx` | `preview(props: <W>PreviewProps)`, `getPreviewCss()` | Design mode rendering (use static text, never call Mendix APIs) |
| `<W>.editorConfig.ts` | `getProperties(values, defaults)`, `check(values)`, `getPreview(values, isDarkMode, version)` (Structure mode), `getCustomCaption(values, platform)` | hide properties (a hidden property's value is **cleared**: never hide `required="true"` ones), validation, structure preview |

`check()` returns `{ property, severity: "error" | "warning" | "deprecation", message }[]`. Structure-mode
preview objects: `Container`, `RowLayout`, `Text`, `Image`, `Selectable`, `DropZone`.
Use `props.renderMode` in `preview` to adapt to xray/structure.
Design-mode preview may `require` only: `react`, `react-dom`, `react-dom-factories`, `prop-types`,
`mendix/components/web/Icon`, `mendix/preview/Selectable`. A widgets property in preview:
`const R = props.content.renderer; <R caption="Drop here"><div /></R>` (exactly one empty element).
Helpers: `import { hidePropertyIn, hidePropertiesIn, changePropertyIn, Properties, Problem } from "@mendix/pluggable-widgets-tools";`
(mutate, then return `defaultProperties`). Errors: Studio Pro → View → Widget Developer Console.

---

## 9. Web specifics

### 9.1 Styling

| Item | Rule |
|---|---|
| Own CSS | `import "./ui/MyWidget.css"` (or `.scss`) — bundled into `<path>/<W>.css` and loaded by Mendix |
| Scope | root class `widget-<name>`; nest all selectors under it |
| Atlas UI classes | use existing ones: `form-control`, `btn btn-primary`, `btn-default`, `alert alert-danger`, `mx-validation-message`, `spacing-outer-*`, `text-*`; they follow the app theme |
| Theme variables | prefer CSS variables / Atlas SCSS variables in the app theme over hard-coded colors |
| Design properties | `props.class` already contains the classes chosen in Studio Pro; always apply it. Define them in `themesource/<module>/web/design-properties.json` keyed by the widget id: `Toggle` (`class`), `Dropdown` (`options[{name, class \| variable}]`, `property`), `ColorPicker`, `ToggleButtonGroup` (`multiSelect`), `Spacing` (`margin`/`padding` options); CSS variables (`"variable": "--x"`) are web only |
| Inline style | `props.style` (CSSProperties) from Studio Pro Appearance → always apply it |
| Responsive | flex/grid, `minmax`, `clamp()`, container queries if supported; breakpoints like Atlas (576/768/992/1200) |
| Soft look | borders `1px solid #dfe3e8`, radius 6–12px, shadow `0 1px 3px rgba(15,30,45,.12)` |
| Dark mode | do not hard-code white backgrounds without a text color |
| z-index | keep inside the widget; popups via portals (`createPortal(…, document.body)`) with a clear layer |

### 9.2 npm packages

| Kind | How | In the mpk |
|---|---|---|
| Pure JS / React libs (`classnames`, `date-fns`, chart libs, `react-select`…) | `npm i <pkg>` (dependencies) | bundled into `<W>.js` / `.mjs`; licenses in `dependencies.txt` / `dependencies.json` |
| External (`react`, `react-dom`, `react/jsx-runtime`, `mendix`, `big.js`) | none (types come with the tools) | not bundled |
| Library with CSS | import its CSS in the widget (`import "lib/dist/style.css"`) | bundled into `<W>.css` |
| Assets | `src/assets/x.png`; in SCSS `url(../assets/x.png)`; in TS `import x from "../assets/x.svg"` (URL string, needs the `*.svg` shim) | copied, path rewritten |
| Toolbox icon | `src/<W>.icon.png` (64×64), `src/<W>.tile.png` (256×192), `*.dark.png` | copied into the mpk |
| Library that needs `window`/DOM at import time | fine on web; not in editorPreview (guard) | |
| Large library | check bundle size in `dist/tmp/widgets/**/<W>.js`; prefer tree-shakeable imports | |

A library that bundles its own React → "Invalid hook call": choose one with `react` as a peer dependency.

### 9.3 Accessibility (WCAG 2.1 AA)

| Item | Rule |
|---|---|
| Labels | `<label htmlFor>` or `aria-label`; use `systemProperty Label` for form widgets |
| Keyboard | all actions reachable with Tab/Enter/Space; visible focus ring; `tabIndex` from props |
| Roles | correct element (`button` not `div`), `role`, `aria-expanded`, `aria-selected`, `aria-live` for updates |
| Validation | `aria-invalid`, `aria-describedby` → message id |
| Contrast | 4.5:1 text, 3:1 large text/icons |
| Motion | respect `prefers-reduced-motion` |

---

## 10. React rules (lint enforced)

| Rule | Correct |
|---|---|
| Hooks at top level | no hooks after early return |
| Refs | write in `useLayoutEffect` |
| Effects | no synchronous `setState` in the body; derive, key, or set in callbacks |
| Adjust state from props | compare and set during render |
| Cleanup | remove listeners, clear timers, abort fetches (`AbortController`) |
| Keys | `item.id` |
| Memo | `useMemo` / `useCallback` / `React.memo` for lists |
| Error boundary | class component; show an error view |
| No direct DOM mutation of Mendix nodes | only inside your own root |

---

## 11. Testing (verified setup)

```tsx
import { fireEvent, render } from "@testing-library/react";
import { EditableValue, ValueStatus } from "mendix";
import { MyWidget } from "../MyWidget";

function editable(value?: string, extra: Partial<EditableValue<string>> = {}): EditableValue<string> {
    return { status: ValueStatus.Available, value, displayValue: value ?? "", readOnly: false, validation: undefined,
        setValue: jest.fn(), setTextValue: jest.fn(), setValidator: jest.fn(), setFormatter: jest.fn(),
        formatter: { format: (v?: string) => v ?? "", parse: (t: string) => ({ valid: true, value: t }) },
        universe: undefined, ...extra } as unknown as EditableValue<string>;
}

it("writes changes", () => {
    const value = editable("hi");
    const r = render(<MyWidget name="w" class="" value={value} />);
    fireEvent.change(r.getByDisplayValue("hi"), { target: { value: "yo" } });
    expect(value.setValue).toHaveBeenCalledWith("yo");
});
```
Cover: loading, unavailable, empty, read-only (disabled), validation text, action not executable, list empty,
paging (`setLimit` called), filter (`setFilter` called), keyboard (Enter/Space).

---

## 12. UX and edge-case checklist

| Case | Expected |
|---|---|
| Loading | skeleton/spinner, keep old content |
| Unavailable | empty state, not blank |
| Empty list/value | translatable empty text |
| Read-only | disabled control with readable contrast |
| Validation | message under the field, `aria-invalid` |
| Action not executable / executing | disabled / busy state |
| Double click | guard with `isExecuting` |
| Slow network | non-blocking indicator |
| Long text / long words | `overflow-wrap: anywhere`, ellipsis where needed |
| Many items | paging or virtualization |
| Small → large screens | fluid layout; labels → icons with tooltip on small screens |
| Keyboard / screen reader | section 9.3 |
| Dark mode / high contrast | readable |
| RTL | logical properties (`margin-inline-start`) |
| Nested scrolling | avoid; one scroll container |
| z-index | no clipping by parents with `overflow: hidden`; portals for popups |
| Print | sensible output if relevant |

---

## 13. Release and install

1. Bump `package.json` `version` and `src/package.xml` `version`.
2. `npm run release` → `dist/<version>/<packagePath>.<Widget>.mpk`, then `node ../tools/check-mpk.mjs <that mpk>` → must print `OK`.
3. Copy to `<Mendix project>/widgets/` (or `config.projectPath`), remove older copies, F4 in Studio Pro.
4. Run, hard-refresh the browser (Ctrl+F5) to drop cached widget files.
5. Commit the mpk; never commit `node_modules/` or `dist/tmp/`.

---

## 14. Error → fix

| Error | Fix |
|---|---|
| `a minimum node version ^22.18.0 is required` | install Node 22.18+ |
| `Cannot find a widget entry file` | `src/<widgetName>.tsx` missing / name mismatch |
| `TS6133 'createElement' is declared but never read` | remove the import |
| `TS2307 Cannot find module 'classnames'` | `npm i classnames` |
| `TS2305 no exported member '<W>Props'` | web types are `<W>ContainerProps` / `<W>PreviewProps` |
| XSD `invalid child element` | `caption`, `description` first |
| `Help url scheme must be https` | remove `helpUrl` |
| Lint ref/setState/member-ordering | see section 10 |
| Widget unchanged in browser | version bump, F4, Ctrl+F5 |
| "Invalid hook call" | a dependency bundles React; use a peer-dependency library |
| CSS not applied | CSS imported in the widget entry? class names under `widget-<name>`? |

---

## 14a. Verified recipe: card list with debounced server-side search and load on scroll

Reference widget: `native-widgets/card-list` (release, lint and 7 tests pass; columns 1/2/3/4 by widget width checked in
Chromium with no overflow). Copy its pieces:

| Piece | File | Key point |
|---|---|---|
| XML | `src/CardList.xml` | `ds` datasource + linked `title`/`subtitle`/`onClick`; object list `searchFields` with `dataSource="../ds"` |
| Filter | `src/searchLogic.ts` | `normalizeQuery` (trim, min chars), `buildSearchFilter` (every word must match one field; skip non-`filterable`), `nextLimit` |
| Debounce | `src/useDebounced.ts` | `setTimeout` in an effect, state set in the timer callback (lint-safe) |
| Apply once per text | `src/CardList.tsx` | ref `applied`: `setFilter` + `setLimit(pageSize)` only when the effective text changes; on mount keep a restored filter |
| Persist search text | `usePersistentState(props.name + ":search", "")` from `mendix/hooks` | text survives back navigation like the data source filter |
| Load on scroll | `IntersectionObserver` on a sentinel (`rootMargin: "400px"`) + "Load more" button fallback | the page is the only scroll owner |
| Cheap virtualization | CSS `content-visibility: auto; contain-intrinsic-size: auto 88px` on cards | no inner scroll container |
| States | skeleton on first load, spinner in the search box on later loads, "No items" vs "No results" | `aria-live`, `aria-busy` |
| Tests | `src/__tests__/CardList.spec.tsx` | fake timers for debounce, mocked builders, virtual `mendix/hooks` mock |

## 14b. Limits and things people forget

| # | Need | Covered? | How / workaround | Risk |
|---|---|---|---|---|
| 1 | List + search box + debounce + server-side search + load more | ✅ verified recipe | `contains`/`or`/`and` filter on **Database/XPath** sources; `setLimit` paging | low |
| 2 | Search when the data source is a microflow/nanoflow | ⚠ client-side only | The client loads all rows and filters in memory. For big data use a Database/XPath source, or a "search object" pattern: a non-persistent helper object with a `SearchText` attribute (attribute property), the widget calls `setValue` then `ds.reload()`, the microflow reads it (runtime UNVERIFIED — test it) | medium |
| 3 | Search in an attribute over an association (`Customer/Name`) | ⚠ | Depends on what Studio Pro lets you pick for the linked attribute; otherwise add a filter attribute on the entity | medium |
| 4 | Case-insensitive / accent-insensitive search | ⚠ | `contains` behavior comes from the database (most are case-insensitive); accents differ per DB — test with real data | low |
| 5 | True virtualization (10 000+ rows in the DOM / native list) | ⚠ | Web embedded: paging + `content-visibility:auto` (done). A virtualizer (react-window) needs its own scroll container → only for a full-screen widget. Native: `FlatList` only in full-screen mode | medium |
| 6 | Edit fields inside list items | ❌ via list API | `ListAttributeValue.get(item)` is read-only. Use a `widgets` property per item (Mendix inputs inside) or open an edit popup page from the item action | — |
| 7 | Get a result back from a microflow | ❌ | Actions return nothing to the widget; `actionVariables` only pass values in. Results come back as attribute values / a refreshed data source | — |
| 8 | Upload a file or image from the widget | ❌ | No binary write API; use Mendix's file/image uploader (web) or an image-picker JS action (native) | — |
| 9 | Charts | ⚠ not in skill | Web: a React chart library (bundle size!), or Mendix Charts; native: `react-native-svg` based libraries | medium |
| 10 | Live updates from other users | ⚠ | No push; `ds.reload()` on focus / on a timer / after actions | low |
| 11 | Total count ("1 234 results") | ✅ costly | `requestTotalCount(true)` only when shown; not every source supports it | low |
| 12 | Sorting UI, multi-select + bulk actions, highlight matches | ✅ API, no recipe | `setSortOrder` (check `sortable`), `selection` property, highlight = split text by the query | low |
| 13 | Unit-test filters | ✅ with care | The tools' `mendix/filters/builders` mock has `attribute, literal, or, and, equals, notEqual, contains, startsWith, endsWith, greaterThan(OrEqual), lessThan(OrEqual)` — **not** `empty`, `not`, `association`, `day*` (mock them yourself); the mocks return `undefined` until you `mockImplementation` | low |
| 14 | Unit-test `mendix/hooks` | ✅ with care | No JS file in the typings package: `jest.mock("mendix/hooks", () => ({ usePersistentState: (_k, v) => jest.requireActual("react").useState(v) }), { virtual: true })` | low |

---

## 15. Knowledge map (what the agent must know; check each before claiming "done")

| # | Area | Topic | Must know |
|---|---|---|---|
| 1 | Mendix | Pluggable widget | React component + XML definition in a `.mpk`; Studio Pro reads XML, the React client runs JS |
| 2 | Mendix | React client | 10.18+ GA (opt-in); widgets must not depend on Dojo or `mx.*` globals |
| 3 | Mendix | `widgets/` folder | F4 loads all `.mpk`; one widget id = one mpk |
| 4 | Mendix | Widget id / property keys | stable forever; renames break pages |
| 5 | Mendix | Data context | `needsEntityContext` widgets read the surrounding object |
| 6 | Mendix | List item context | inside Data grid / List view / Gallery items |
| 7 | Mendix | Page parameters | 10.23+ attribute properties without a data view |
| 8 | Mendix | Entity access | decides `readOnly`, availability, list content |
| 9 | Mendix | Editability / Visibility | system properties; Mendix applies them |
| 10 | Mendix | Validation | domain rules + one `setValidator`; show `validation` text |
| 11 | Mendix | Commit / rollback | widgets do not commit; actions do |
| 12 | Mendix | Microflow vs nanoflow | server vs client logic; actions call either |
| 13 | Mendix | Datasource kinds | Database/XPath (server paging/sort/filter), Association, Microflow, Nanoflow (client-side) |
| 14 | Mendix | Selection | 10.7+ `selection` property; drives Listen-to and expressions |
| 15 | Mendix | Enumerations | key string; caption via formatter; `universe` |
| 16 | Mendix | Big numbers | `Big` for Integer/Long/Decimal/AutoNumber |
| 17 | Mendix | DateTime | `Date`; display via formatter (locale, time zone) |
| 18 | Mendix | Associations | Reference / ReferenceSet values; `selectableObjects` |
| 19 | Mendix | Text templates & translations | `DynamicValue<string>`, `<translations>` defaults |
| 20 | Mendix | Atlas UI | Bootstrap-like classes, theme SCSS variables, spacing helpers |
| 21 | Mendix | Theme folders | `theme/web`, `themesource/<module>/web` (SCSS, design-properties.json) |
| 22 | Mendix | Design properties | classes appended to `props.class` |
| 23 | Mendix | Label system property | Mendix renders the label; widget gets `id` instead of `class`/`style` |
| 24 | Mendix | `mx-name-<name>` class | added automatically; used by tests (Selenium/Playwright) |
| 25 | Mendix | Dev loop | `npm start` (watch, copies to the running app via `projectPath`) + browser refresh |
| 26 | Mendix | Cache | browser caches widget files; Ctrl+F5 after updates |
| 27 | Mendix | Security | client code is visible; never enforce rights in the widget |
| 28 | Mendix | Logging | browser console |
| 29 | Mendix | Marketplace | publish mpk + docs, semver |
| 30 | Mendix | Built-in widgets | Data grid 2, Gallery, Combo box, … — reuse instead of rewriting |
| 31 | Tooling | tools 10.24.1 | rollup, typings, jest (jsdom), eslint, prettier |
| 32 | Tooling | Node | `^22.18.0` enforced |
| 33 | Tooling | Outputs | `<W>.js` (AMD/CJS for the client), `<W>.mjs` (ES module), `<W>.css`, `<W>.editorPreview.js`, `<W>.editorConfig.js` |
| 34 | Tooling | Externals | `react`, `react-dom`, `react/jsx-runtime`, `mendix`, `big.js` |
| 35 | Tooling | Bundled deps | everything else in `dependencies`; licenses in `dependencies.txt/json` |
| 36 | Tooling | Assets | images/fonts imported from `src` are copied to the package (`assets/`) |
| 37 | Tooling | CSS/SCSS | import in the entry; built into `<W>.css` |
| 38 | Tooling | `config.projectPath` | auto-copy into the project (build/start only) |
| 39 | Tooling | xmllint | XSD check |
| 40 | Tooling | Generator | `npx @mendix/generator-widget@10.24-latest` |
| 41 | TypeScript | strict | handle `undefined` |
| 42 | TypeScript | Narrowing | by `status`, by `ListAttributeValue.type` for unions |
| 43 | TypeScript | DOM types | `HTMLInputElement`, `KeyboardEvent`, `ChangeEvent` |
| 44 | React | Function components | entry exports `function <W>(props: <W>ContainerProps)` |
| 45 | React | JSX automatic runtime | no `createElement` import |
| 46 | React | Hooks | `useState`, `useMemo`, `useCallback`, `useRef`, `useEffect`, `useLayoutEffect`, `useId` |
| 47 | React | `useId` | stable ids for label/aria wiring |
| 48 | React | Effects | subscribe/cleanup; no sync setState in body |
| 49 | React | Derived state | compute, do not sync |
| 50 | React | Keys | `item.id` |
| 51 | React | Memo | `React.memo` rows; `useMemo` heavy lists |
| 52 | React | Portals | `createPortal` for popovers/dialogs |
| 53 | React | Error boundary | class component |
| 54 | React | Controlled inputs | value from Mendix, `setValue`/`setTextValue` on change |
| 55 | React | Debounce | search inputs before `setFilter` |
| 56 | React | Suspense/lazy | allowed for heavy parts; keep fallback small |
| 57 | React | Strict mode | effects may run twice in dev |
| 58 | Web | Semantic HTML | `button`, `label`, `table`, `ul/li`, headings |
| 59 | Web | Forms | `form-control`, `form-group`, `aria-describedby` |
| 60 | Web | CSS layout | flexbox, grid, `minmax`, `clamp`, `aspect-ratio` |
| 61 | Web | Responsive | Atlas breakpoints 576/768/992/1200; container queries |
| 62 | Web | Overflow | `min-width: 0` on flex children, `overflow-wrap: anywhere` |
| 63 | Web | Images | `max-width: 100%`, `object-fit`, `loading="lazy"`, `alt` |
| 64 | Web | Tables | responsive: scroll container or stacked cards on mobile |
| 65 | Web | Focus | visible `:focus-visible` ring; focus trap in dialogs |
| 66 | Web | Keyboard | Tab, Shift+Tab, Enter, Space, Escape, arrows for lists/menus |
| 67 | Web | ARIA | roles/states only when native HTML cannot express it |
| 68 | Web | Live regions | `aria-live="polite"` for async updates |
| 69 | Web | Color | contrast 4.5:1; not color-only signals |
| 70 | Web | Motion | `prefers-reduced-motion` |
| 71 | Web | Dark mode | `prefers-color-scheme` if the theme supports it |
| 72 | Web | z-index | stacking contexts; parents with `overflow: hidden` clip popups → portal |
| 73 | Web | Scroll | one scroll container; `overscroll-behavior: contain` for inner panels |
| 74 | Web | Virtualization | for thousands of rows (react-window etc.) |
| 75 | Web | Fetch | avoid; get data through datasources; if needed, `AbortController` |
| 76 | Web | Storage | `usePersistentState` (mendix/hooks) for view state; avoid localStorage for data |
| 77 | Web | Third-party libs | peer-dep React libs only; check size and license |
| 78 | Web | Charts/maps | wrap in a component that reacts to resize (`ResizeObserver`) |
| 79 | Web | Print | `@media print` if relevant |
| 80 | Web | i18n | text from text templates; `Intl` for numbers/dates if no formatter |
| 81 | Web | RTL | logical properties |
| 82 | Web | Touch | 44 px targets; hover is optional |
| 83 | Web | Mobile browsers | virtual keyboard resizes viewport; `100dvh` |
| 84 | Testing | jsdom | no layout; test behavior, not pixels |
| 85 | Testing | Testing Library | query by role/label/text; `fireEvent` / `userEvent` |
| 86 | Testing | Mendix mocks | plain objects with `jest.fn()` setters |
| 87 | Testing | Lists | mock `ListValue` with `items`, `setLimit`, `setFilter`, linked `get` |
| 88 | Testing | Fake timers | debounce, delays |
| 89 | Testing | E2E | `mx-name-*` classes; Playwright in a running app |
| 90 | UX | States | loading skeleton, empty, error, read-only, disabled, success |
| 91 | UX | Feedback | busy state while `isExecuting` |
| 92 | UX | Forms | label + help + error near the field |
| 93 | UX | Small screens | labels → icons with tooltip/aria-label |
| 94 | UX | Soft look | soft borders, light shadows, 8 px grid |
| 95 | UX | Consistency | Atlas classes, theme variables |
| 96 | Security | XSS | never `dangerouslySetInnerHTML` with user data unless sanitized (e.g. DOMPurify) |
| 97 | Security | Links | `rel="noopener noreferrer"` with `target="_blank"`; allow-list schemes |
| 98 | Security | Secrets | never in client code |
| 99 | Release | Semver + both version fields | `package.json`, `src/package.xml` |
| 100 | Release | Breaking XML | removing/renaming keys breaks pages |
| 101 | Release | Distribution | commit `dist/<v>/*.mpk` |
