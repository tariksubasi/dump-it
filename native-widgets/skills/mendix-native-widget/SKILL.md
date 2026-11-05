---
name: mendix-native-widget
description: Build Mendix 10.24 NATIVE (React Native) pluggable widgets end to end - scaffold the project, write the widget XML (every property type, data sources, linked properties, object lists, actions with variables, selection, associations), write the React Native component with the Mendix client API (EditableValue, DynamicValue, ActionValue, ListValue, filters, sorting), style it with the native theme, add npm packages (pure JS or native modules), test with Jest, lint, build the .mpk and install it in Studio Pro / Make It Native. Use when the user asks for a native widget, a mobile widget, a React Native component for Mendix, a .mpk for a native page, or to fix/build an existing native widget.
---

# Mendix 10.24 native pluggable widgets (React Native)

Target: Studio Pro **10.24.x**, Native Template **14.x** (React Native **0.77.3**, React **18.3.1**, React Navigation **7**),
`@mendix/pluggable-widgets-tools` **10.24.1**, `mendix` typings **10.24**. Every XML snippet and generated type in this
file was checked with the 10.24 XSD and the 10.24.1 typings generator.

How to use this file: read section 0 and 1 first. Then follow section 2 (workflow) for every task. Look up the other
sections when a step needs them. If something is not in this file, say **"NOT IN SKILL"** and ask; never invent an API.

---

## 0. The 25 rules that break builds most often

| # | Rule | What goes wrong otherwise |
|---|---|---|
| 1 | Node **22.18+** (`node -v`). npm 8+. | Tools exit: "a minimum node version ^22.18.0 is required" |
| 2 | `package.json` `widgetName` = file name `src/<WidgetName>.tsx` = `src/<WidgetName>.xml` = clientModule `name` | "Cannot find a widget entry file" |
| 3 | Widget id = `<packagePath>.<widgetname lower>.<WidgetName>`, e.g. `dumpit.hellonative.HelloNative` | Studio Pro cannot find the widget files |
| 4 | `src/package.xml` `<file path="<packagePath>/<widgetname lower>" />` | Empty widget at runtime |
| 5 | `supportedPlatform="Native"` for native-only widgets | `"All"` generates WEB typings (`ContainerProps`) even in a native build |
| 6 | Element order inside `<property>` (XSD sequence): `caption`, `category?`, `description`, `attributeTypes?`, `associationTypes?`, `selectionTypes?`, `enumerationValues?`, `properties?`, `returnType?`, `translations?`, `actionVariables?` | Studio Pro: "invalid child element …" |
| 7 | Every `<property>` has a `<description>`; a `<propertyGroup>` holds **either** groups **or** properties, never both | XSD error |
| 8 | `helpUrl`: leave it out, or https on `*.mendix.com` / a GitHub `.md` URL | Studio Pro: "Help url scheme must be https…" |
| 9 | Do **not** `import { createElement }` (new JSX transform) | TS6133 "declared but never read" breaks the build |
| 10 | No `any` in props; use the generated `typings/<Widget>Props.d.ts` | Silent runtime errors |
| 11 | Always check `.status === ValueStatus.Available` before `.value` | Crash on `undefined` while loading |
| 12 | Run an action only when `action?.canExecute && !action.isExecuting` | Double execution, warnings |
| 13 | Inside an object list (`type="object" isList="true"`), link to a parent data source with `dataSource="../ds"` | `dataSource="ds"` builds but gives the wrong type (`EditableValue` instead of `ListAttributeValue`) |
| 14 | `onChange="actionKey"` on an attribute property: Mendix runs that action after `setValue`; the action is **not** a prop | Looking for a prop that does not exist |
| 15 | Ref writes go in `useLayoutEffect`, never in the render body | Lint error "Cannot update ref during render" |
| 16 | No synchronous `setState` in `useEffect` body; derive state, use keys, or set in callbacks/timers | Lint error `react-hooks/set-state-in-effect` |
| 17 | Format only `src/**/*.{ts,tsx}` with Prettier | Prettier breaks the XML files |
| 18 | Change version in **both** `package.json` and `src/package.xml` for every new mpk | Studio Pro / Make It Native keeps the old code |
| 19 | A package with native code (has `android/`, `ios/` or a `.podspec`) must exist in the **app** (Native Template / Make It Native) | App crashes at start ("TurboModuleRegistry … could not be found") |
| 20 | Pure-JS npm packages go in `dependencies`; they are bundled into the widget file | Missing module at runtime |
| 21 | Do not bundle `react`, `react-native`, `mendix`, `big.js`, React Navigation, gesture-handler, reanimated, svg, safe-area-context, vector-icons, fast-image — they are external and come from the app | Duplicate React → "Invalid hook call" |
| 22 | Decimals are `Big` (big.js), not `number`; integers from attributes are `Big` too | Wrong math, type errors |
| 23 | `textTemplate` / `expression` values are `DynamicValue<string>`; they can be `Loading` or `Unavailable` | Empty text, crash |
| 24 | Native style is an **array** of style objects (`props.style: Style[]`); merge it key by key | Theme styles ignored |
| 25 | Never leave a widget invisible: render loading / empty / unavailable / error states explicitly | "It shows nothing" with no clue why |
| 26 | `widgetName` letters only; `packagePath` lower-case without `-` | runtime load errors |
| 27 | Never put `react`, `react-native`, `@types/react*` in dependencies/devDependencies | every tools command asks "Update dependencies?" (default Yes) and rewrites package.json; skip with env `CI=true` |
| 28 | `release` does **not** copy to `config.projectPath`; only `build` / `start` do | copy the mpk yourself |
| 29 | Untyped npm package → `typings/modules.d.ts` with `declare module "pkg";` (or `@types/pkg`) | TS7016 breaks the build |
| 30 | Rollup warnings are errors in build/release (except circular, this-is-undefined, unused external import) | build exits 1 |
| 31 | LF line endings | lint fails on CRLF (Windows: `git config core.autocrlf input`) |
| 32 | `.prettierignore` must list `config.projectPath` when it is inside the widget (`tests/testProject/`) and `dist/` | hundreds of lint errors |

---

### 0.1 Facts the docs get wrong (trust these)

| Docs say | Correct for 10.24 (typings + generator) |
|---|---|
| `notEquals(...)` | `notEqual(...)` |
| `literal(10)` | `literal(new Big(10))` — plain numbers are rejected |
| AutoNumber → `string` | `Big` |
| Integer expression → `number` | `DynamicValue<Big>` |
| `myWidgets(item)` | `myWidgets.get(item)` (direct call removed in 10.0) |
| `ListValue` has no `reload` | `reload()` exists |
| default `limit` undefined | `Number.POSITIVE_INFINITY` |
| `<objects><properties>` in object lists | `<properties>` directly under the object property |
| React 17 / RN 0.63 | React 18.3.1 / RN 0.77.3 (Native Template 14) |

### 0.2 Feature version gates (Studio Pro must be at least)

| Feature | Version |
|---|---|
| `setLabel="true"` on attribute/association | 10.5 |
| `selection` property type | 10.7 |
| `renderMode` in preview props | 10.11 |
| action `defaultType` (`None`, `OpenPage`, `CallNanoflow`, `CallMicroflow`) + `defaultValue="Module.Doc"` | 10.15 |
| datasource `defaultType` (`Database`, `Association`, `Microflow`, `Nanoflow`) + `defaultValue` (both required) | 10.16 |
| `<actionVariables>` + `execute({ ... })` (every key present, values may be `undefined`) | 10.21 |
| page parameters for attribute properties without a data view | 10.23 |
| property type conversion on widget update; hidden properties reset to default | 10.24 |

## 1. Environment and versions

| Item | Value | Check / note |
|---|---|---|
| Node.js | `^22.18.0` (required by tools 10.24.1) | `node -v` |
| npm | ≥ 8 | `npm -v` |
| `@mendix/pluggable-widgets-tools` | `10.24.1` (devDependency, exact) | matches Studio Pro 10.24 |
| `mendix` typings | `10.24.x` (comes with the tools) | `node_modules/mendix/index.d.ts` is the API truth |
| React / React Native | 18.3.1 / 0.77.3 (from the app) | do not add them to `dependencies` |
| React Navigation | 7.x (from the app) | types only, if needed: devDependency |
| TypeScript | from the tools | `npx tsc --noEmit -p .` |
| xmllint (optional) | libxml2 | `xmllint --noout --schema node_modules/mendix/custom_widget.xsd src/<W>.xml` |
| Studio Pro | 10.24.x | F4 = synchronize app directory |
| Test app | Make It Native (Mendix app) or your own build of Native Template 14 | Make It Native only has the native modules Mendix built into it |

---

## 2. Workflow (follow for every task)

1. **Requirements table**: property | XML type | required | default | why. Pick the smallest set of properties.
2. **XML first**, then `npm run validate` (or `xmllint`), then `npm run build` once to generate `typings/`.
3. **Edge-case table** before code (section 13): loading, unavailable, empty, read-only, validation, no access, slow
   network, offline, long text, many items, small/large screen, portrait/landscape, dark mode, RTL, accessibility,
   Android back, keyboard.
4. **Code**: pure logic in `src/<name>Logic.ts` (unit-testable, no React Native import); UI in `src/<Widget>.tsx`.
5. **Tests**: unit tests for logic + render tests for loading/empty/unavailable/error (section 12).
6. **Quality gate** (all must pass, show a table): `npx tsc --noEmit -p .`, `npm run lint`, `npm test`, `npm run release`.
7. **Version bump** in `package.json` + `src/package.xml`. Remove old `dist/<old version>` if the repo keeps only the latest.
8. **Report**: what changed, mpk path, how to install (section 15), what to test on a device.
9. Same error 3 times → stop and show the full error.

---

## 3. Project layout and naming

```
my-widget/                      folder: lower-case-with-dashes
├─ package.json                 widgetName "MyWidget", packagePath "dumpit"
├─ tsconfig.json
├─ .eslintrc.js
├─ .prettierrc
├─ .gitignore                   node_modules/  dist/tmp/
├─ src/
│  ├─ MyWidget.xml              Studio Pro definition (properties)
│  ├─ MyWidget.tsx              entry: export function MyWidget(props)
│  ├─ MyWidget.editorConfig.ts  optional: hide properties, checks, structure-mode preview
│  ├─ package.xml               clientModule name + version
│  ├─ myWidgetLogic.ts          pure functions (tested)
│  ├─ ui/styles.ts              default styles + merge
│  └─ __tests__/*.spec.ts(x)
├─ typings/MyWidgetProps.d.ts   GENERATED from the XML — never edit
└─ dist/<version>/dumpit.MyWidget.mpk   the package for Studio Pro
```

| Name | Rule | Example |
|---|---|---|
| Folder / npm `name` | lower-case, dashes | `back-navigation` |
| `widgetName` | PascalCase, no spaces | `BackNavigation` |
| `packagePath` | lower-case, dots allowed | `dumpit` or `com.company.widgets` |
| Widget id | `<packagePath>.<widgetName lower>.<WidgetName>` | `dumpit.backnavigation.BackNavigation` |
| mpk file | `<packagePath>.<WidgetName>.mpk` | `dumpit.BackNavigation.mpk` |
| Theme style export | id with dots → underscores | `export const dumpit_backnavigation_BackNavigation = {…}` |

---

## 4. Scaffold (create these files exactly)

Replace `MyWidget` / `mywidget` / `my-widget`. Then run `npm install`, `npm run build`, `npm run release`.

**package.json**
```json
{
  "name": "my-widget",
  "widgetName": "MyWidget",
  "version": "1.0.0",
  "description": "What the widget does",
  "license": "Apache-2.0",
  "packagePath": "dumpit",
  "config": {
    "projectPath": "../../MendixProject",
    "mendixHost": "http://localhost:8080",
    "developmentPort": 3000
  },
  "scripts": {
    "start": "pluggable-widgets-tools start:native",
    "build": "pluggable-widgets-tools build:native",
    "release": "npm run validate && pluggable-widgets-tools release:native",
    "lint": "pluggable-widgets-tools lint",
    "lint:fix": "pluggable-widgets-tools lint:fix",
    "test": "pluggable-widgets-tools test:unit:native",
    "validate": "xmllint --noout --schema node_modules/mendix/custom_widget.xsd src/MyWidget.xml"
  },
  "dependencies": {},
  "devDependencies": {
    "@mendix/pluggable-widgets-tools": "10.24.1"
  }
}
```
No xmllint (Windows)? Use `"release": "pluggable-widgets-tools release:native"`.
`config.projectPath`: path to the Mendix project (or env `MX_PROJECT_PATH`; default `./tests/testProject`). Only
`build` and `start` copy into `<project>/widgets/` and `deployment/native/widgets`; `release` does not.
`mendixHost` and `developmentPort` are not read by tools 10.24.1 (harmless).

**tsconfig.json**
```json
{
    "extends": "@mendix/pluggable-widgets-tools/configs/tsconfig.base.json",
    "compilerOptions": { "baseUrl": "./", "types": ["jest"] },
    "include": ["./src", "./typings"]
}
```

**.eslintrc.js** — `module.exports = require("@mendix/pluggable-widgets-tools/configs/eslint.ts.base.json");`
**.prettierrc** — `"@mendix/pluggable-widgets-tools/configs/prettier.base.json"`
**.gitignore** — `node_modules/` and `dist/tmp/`

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
        supportedPlatform="Native"
        xmlns="http://www.mendix.com/widget/1.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.mendix.com/widget/1.0/ ../node_modules/mendix/custom_widget.xsd">
    <name>My widget</name>
    <description>One sentence.</description>
    <studioProCategory>Display</studioProCategory>
    <properties>
        <propertyGroup caption="General">
            <propertyGroup caption="Data">
                <property key="value" type="attribute" required="true">
                    <caption>Value</caption>
                    <description>The attribute to show.</description>
                    <attributeTypes>
                        <attributeType name="String" />
                    </attributeTypes>
                </property>
                <property key="onPress" type="action" required="false">
                    <caption>On press</caption>
                    <description>Runs on tap.</description>
                </property>
            </propertyGroup>
        </propertyGroup>
    </properties>
</widget>
```

**src/MyWidget.tsx**
```tsx
import { ReactElement } from "react";
import { Pressable, Text, TextStyle, ViewStyle } from "react-native";
import { ValueStatus } from "mendix";

import { MyWidgetProps } from "../typings/MyWidgetProps";

export interface MyWidgetStyle {
    container?: ViewStyle;
    text?: TextStyle;
}

export function MyWidget(props: MyWidgetProps<MyWidgetStyle>): ReactElement {
    const container = Object.assign({}, ...props.style.map(s => s?.container ?? {}));
    const text = Object.assign({ fontSize: 16, color: "#1f2933" }, ...props.style.map(s => s?.text ?? {}));
    const v = props.value.status === ValueStatus.Available ? props.value.value ?? "" : "";
    const action = props.onPress;
    const onPress = action?.canExecute && !action.isExecuting ? () => action.execute() : undefined;
    return (
        <Pressable style={container} onPress={onPress} disabled={!onPress} accessibilityRole="button" testID={props.name}>
            <Text style={text}>{v || "-"}</Text>
        </Pressable>
    );
}
```

Copy-from-existing alternative: copy `native-widgets/back-navigation`, then rename in: folder, `package.json`
(`name`, `widgetName`, `validate` script), `src/<W>.xml` (file name + `id` + `<name>`), `src/<W>.tsx` (file +
function name + typings import), `src/<W>.editorConfig.ts`, `src/package.xml` (`name`, `widgetFile`, `file path`),
delete `typings/` and `dist/`, then `npm install && npm run release`.

Generator alternative (needs internet): `npx @mendix/generator-widget@10.24-latest MyWidget` (never `@latest`, that is
11.x) → choose Native, TypeScript, function component, empty template. It creates the files above plus README, LICENSE,
`prettier.config.js`, `.prettierignore`, `.gitattributes` (LF), tests. Its scripts: `start` = `start:native`,
`test` = `test:unit:native --no-cache --ci`, `prerelease` = `npm run lint`.

---

## 5. Commands

| Command | Does | Output |
|---|---|---|
| `npm install` | install tools + dependencies (once per clone) | `node_modules/` |
| `npm run build` | dev build, regenerates typings | `dist/tmp/widgets/…`, `typings/` |
| `npm run release` | XSD check + production build (minified, licenses) + mpk; **no copy** to the project | `dist/<version>/<packagePath>.<Widget>.mpk` |
| XML changed | save → typings regenerate → Studio Pro F4 → right-click widget → **Update widget** (or Update all widgets) | |
| `npm start` | `start:native` = rollup watch; copies to `projectPath` (`widgets/` + `deployment/native/widgets`); then reload the app | — |
| `npm test` | Jest (react-native preset) | — |
| `npm run lint` / `lint:fix` | Prettier check + ESLint | — |
| `npx prettier --write "src/**/*.{ts,tsx}"` | format TS only | — |
| `npx tsc --noEmit -p .` | type check | — |
| `unzip -l dist/<v>/*.mpk` | inspect the package | XML, package.xml, `<path>/<W>.android.js`, `.ios.js`, `<W>.json` (native deps), `node_modules/<native pkg>` |

Native build output: **two** bundles, `<Widget>.android.js` and `<Widget>.ios.js`. Use `Platform.OS` in code or
`*.android.tsx` / `*.ios.tsx` files.

---

## 6. Widget XML reference (checked against the 10.24 XSD)

### 6.1 `<widget>` attributes

| Attribute | Values | Note |
|---|---|---|
| `id` | `<packagePath>.<lower>.<Name>` | unique |
| `pluginWidget` | `true` | always |
| `needsEntityContext` | `true` / `false` | `true` = must be inside a data view/list; needed for `attribute`, `association`, linked props |
| `offlineCapable` | `true` / `false` | `true` for native (offline-first apps) |
| `supportedPlatform` | `Native` / `Web` / `All` | native widget: `Native` (rule 5) |

Children in order: `<name>`, `<description>`, optional `<studioProCategory>` (Toolbox group, e.g. Display, Input
elements, Data, Navigation), optional `<helpUrl>`, `<properties>`.

### 6.2 Structure

`<properties>` holds `<propertyGroup caption="Tab">` → `<propertyGroup caption="Group">` → `<property>`.
Top-level groups are tabs in the properties dialog; second-level groups are sections. `<systemProperty key="…"/>`
adds Mendix standard properties (`Name`, `Visibility`, `TabIndex`, `Editability`, `Label`) — put them in a
"Common" group.

### 6.3 Property types and the generated native types

| XML `type` | Key XML | Generated prop type (native) | Notes |
|---|---|---|---|
| `string` | `defaultValue`, `multiline="true"` | `string` | static text from Studio Pro |
| `boolean` | `defaultValue="true"` (required) | `boolean` | |
| `integer` | `defaultValue="3"` (required) | `number` | |
| `decimal` | `defaultValue="1.5"` | `Big` | `import { Big } from "big.js"` |
| `enumeration` | `<enumerationValues><enumerationValue key="a">A</enumerationValue>…` | `"a" \| "b"` (type `<Key>Enum`) | `defaultValue` = a key |
| `icon` | `required="false"` | `DynamicValue<NativeIcon>` | render with `mendix/components/native/Icon` |
| `image` | | `DynamicValue<NativeImage>` | render with `mendix/components/native/Image` |
| `file` | | `DynamicValue<FileValue>` (`uri`, `name`) | |
| `expression` | `<returnType type="String\|Boolean\|Integer\|Decimal\|DateTime"/>`, `defaultValue="'x'"` | `DynamicValue<string \| boolean \| Big \| Date>` | read-only, recomputed |
| `textTemplate` | optional `<translations><translation lang="en_US">…` | `DynamicValue<string>` | translatable text with parameters |
| `attribute` | `<attributeTypes><attributeType name="String\|Integer\|Long\|Decimal\|Boolean\|DateTime\|Enum\|HashString\|AutoNumber"/>` , optional `onChange="actionKey"` | `EditableValue<string \| Big \| boolean \| Date>` | Integer/Long/Decimal → `Big`; Enum → `string` key |
| `association` | `<associationTypes><associationType name="Reference\|ReferenceSet"/>`, `selectableObjects="dsKey"` | `ReferenceValue` / `ReferenceSetValue` | `value: ObjectItem` / `ObjectItem[]` |
| `action` | optional `<actionVariables><actionVariable key="url" type="String" caption="URL"/>` | `ActionValue` or `ActionValue<{ url: Option<string> }>` | variable types: Boolean, Integer, DateTime, String, Decimal |
| `datasource` | `isList="true"` | `ListValue` | list of objects |
| `attribute` + `dataSource="ds"` | | `ListAttributeValue<T>` | `.get(item)` → `EditableValue<T>` |
| `expression` + `dataSource="ds"` | `<returnType …/>` | `ListExpressionValue<T>` | `.get(item)` → `DynamicValue<T>` |
| `textTemplate` + `dataSource="ds"` | | `ListExpressionValue<string>` | |
| `action` + `dataSource="ds"` | | `ListActionValue` | `.get(item)` → `ActionValue` |
| `widgets` + `dataSource="ds"` | | `ListWidgetValue` | `.get(item)` → `ReactNode` (Studio Pro drop zone per item) |
| `widgets` | | `ReactNode` | drop zone for child widgets |
| `selection` + `dataSource="ds"` | `<selectionTypes><selectionType name="None\|Single\|Multi"/>` | `SelectionSingleValue \| SelectionMultiValue` | |
| `object` | `isList="true"`, nested `<properties><propertyGroup>…` | `<Key>Type[]` | e.g. columns; inside, use `dataSource="../ds"` (rule 13) |

Optionality: `action` props are **always** optional; `string` and `object` never; others optional if
`required="false"` or linked to a datasource with `required="false"`. If the datasource is not configured, all linked
props are **omitted**. Static `integer` is `number`; every attribute/expression integer is `Big`.
Standard native props: `name` (pass it to `testID` yourself) and `style: Style[]`; native gets **no** `class`, no
`tabIndex`. Expression `returnType` can use `assignableTo="attrKey"` instead of `type` (never both).
`required="false"` makes the prop optional (`?`). `boolean`, `integer`, `enumeration` need a `defaultValue`.
The generator also creates `<Widget>PreviewProps` (Studio Pro side): attribute/expression → `string`, action → `{} | null`,
datasource → `{} | { caption } | { type } | null`, widgets → `{ widgetCount, renderer }`, integer → `number | null`.

### 6.4 Verified XML snippets

```xml
<!-- list with linked properties and selection -->
<property key="ds" type="datasource" isList="true" required="false"><caption>Data source</caption><description>Items.</description></property>
<property key="title" type="attribute" dataSource="ds" required="false"><caption>Title</caption><description>Per item.</description>
    <attributeTypes><attributeType name="String" /></attributeTypes></property>
<property key="subtitle" type="expression" dataSource="ds" required="false"><caption>Subtitle</caption><description>Per item.</description><returnType type="String" /></property>
<property key="onItemPress" type="action" dataSource="ds" required="false"><caption>On item press</caption><description>Per item.</description></property>
<property key="itemContent" type="widgets" dataSource="ds" required="false"><caption>Item content</caption><description>Widgets per item.</description></property>
<property key="selection" type="selection" dataSource="ds"><caption>Selection</caption><description>Select items.</description>
    <selectionTypes><selectionType name="None" /><selectionType name="Single" /><selectionType name="Multi" /></selectionTypes></property>

<!-- object list (e.g. columns) linked to the parent data source -->
<property key="columns" type="object" isList="true" required="false"><caption>Columns</caption><description>Columns.</description>
    <properties>
        <propertyGroup caption="Column">
            <property key="header" type="textTemplate" required="false"><caption>Header</caption><description>Header.</description></property>
            <property key="attribute" type="attribute" dataSource="../ds" required="false"><caption>Attribute</caption><description>Value.</description>
                <attributeTypes><attributeType name="String" /><attributeType name="Integer" /></attributeTypes></property>
            <property key="width" type="integer" defaultValue="100"><caption>Width</caption><description>Width.</description></property>
        </propertyGroup>
    </properties>
</property>

<!-- action that receives values from the widget -->
<property key="onLink" type="action" required="false"><caption>On link</caption><description>Gets the URL.</description>
    <actionVariables><actionVariable key="url" type="String" caption="Tapped URL" /></actionVariables></property>

<!-- association with selectable objects -->
<property key="ref" type="association" required="false" selectableObjects="options"><caption>Reference</caption><description>Pick one.</description>
    <associationTypes><associationType name="Reference" /></associationTypes></property>
<property key="options" type="datasource" isList="true" required="false"><caption>Options</caption><description>Choices.</description></property>

<!-- translatable text with defaults -->
<property key="emptyText" type="textTemplate" required="false"><caption>Empty text</caption><description>No items.</description>
    <translations><translation lang="en_US">No items</translation><translation lang="tr_TR">Kayıt yok</translation></translations></property>
```

---

## 7. Client API (from `node_modules/mendix/index.d.ts` 10.24)

| API | Members | Use |
|---|---|---|
| `ValueStatus` | `Available = "available"`, `Unavailable = "unavailable"`, `Loading = "loading"` | `import { ValueStatus } from "mendix"` |
| `DynamicValue<T>` | `{status: Available, value: T}` \| `{status: Unavailable, value: undefined}` \| `{status: Loading, value: T \| undefined}` | Loading may keep the previous value |
| `EditableValue<T>` | `status`, `value`, `displayValue`, `readOnly`, `validation`, `setValue(v)`, `setTextValue(s)`, `setValidator(fn)`, `formatter`, `setFormatter(f)`, `universe?` (enum/boolean values), `isList: false` | inputs |
| `ActionValue<Args>` | `canExecute`, `isExecuting`, `execute()` or `execute({…variables})` | buttons, events |
| `ListValue` | `status`, `items?: ObjectItem[]`, `offset`, `limit` (default ∞), `setOffset`, `setLimit` (`0` = lazy, no request), `hasMoreItems?`, `totalCount?` (only after `requestTotalCount(true)`, expensive), `sortOrder`, `setSortOrder([[attr.id, "asc"]])` (check `attr.sortable`), `filter`, `setFilter(cond)` (check `filterable`), `reload()` | call setters once (mount / user event), never every render; Unavailable = parent has no object; Loading keeps old `items`; view state is restored on back navigation |
| `ObjectItem` | `id: GUID` | key for React lists: `key={item.id}` |
| `ListAttributeValue<T>` | `get(item) → EditableValue<T>` (**always read-only**: you cannot edit list items through the list), `id`, `sortable`, `filterable`, `type` (runtime attribute type name), `formatter`, `universe` | per-item attribute |
| `ListExpressionValue<T>` | `get(item) → DynamicValue<T>` | per-item expression/text |
| `ListActionValue` | `get(item) → ActionValue` | per-item action |
| `ListWidgetValue` | `get(item) → ReactNode` | per-item child widgets |
| `ReferenceValue` / `ReferenceSetValue` | `value: ObjectItem` / `ObjectItem[]`, `setValue`, `readOnly`, `validation`, `setValidator` | association editors |
| `SelectionSingleValue` | `selection: ObjectItem \| undefined`, `setSelection(item)`, `setKeepSelection(pred)`, `type: "Single"` | |
| `SelectionMultiValue` | `selection: ObjectItem[]`, `setSelection(items)`, `type: "Multi"` | |
| `FileValue` | `uri`, `name?` | |
| `NativeImage` | `ImageURISource & {name?}` \| `string` \| `number` | `<Image source={…}/>` |
| `NativeIcon` | `{type:"glyph", iconClass}` \| `{type:"image", iconUrl}` \| `undefined` | |
| Formatter | `formatter.format(value) → string`, `formatter.parse(text) → {valid, value}`; Number/DateTime formatters have `withConfig` | locale-correct display |
| Filters | Not filterable: Binary, EnumSet, references. `contains`/`startsWith`/`endsWith` take a **string** literal. `literal()` accepts `string`, `boolean`, `Date`, `Big`, `ObjectItem`, `ObjectItem[]`, `undefined`. `import { attribute, literal, equals, notEqual, contains, startsWith, endsWith, greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, dayEquals, dayGreaterThan, …, and, or, not, empty, association } from "mendix/filters/builders"` | `ds.setFilter(contains(attribute(titleAttr.id), literal("abc")))` (attribute must be `filterable`) |
| Hook | `import { usePersistentState } from "mendix/hooks"` | state that survives page re-render |
| Icon component | `import { Icon } from "mendix/components/native/Icon"` → `<Icon icon={icon.value} size={20} color="#333" />` | |
| Image component | `import { Image } from "mendix/components/native/Image"` → `<Image source={img.value} style={…} />` | handles SVG |

### 7.1 Patterns

```tsx
// read safely
const text = props.title.status === ValueStatus.Available ? props.title.value : undefined;

// edit an attribute with validation
const v = props.value;
const editable = v.status === ValueStatus.Available && !v.readOnly;
<TextInput value={v.displayValue} editable={editable} onChangeText={t => v.setTextValue(t)} />
{v.validation ? <Text style={styles.error}>{v.validation}</Text> : null}
// set ONE custom validator, once (it adds to the built-in validation)
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { props.value.setValidator(x => (!x ? "Required" : undefined)); }, []);

// action with variables (10.24)
if (props.onLink?.canExecute && !props.onLink.isExecuting) props.onLink.execute({ url });

// list paging
const ds = props.ds;
if (ds.status === ValueStatus.Loading && !ds.items) return <ActivityIndicator />;
const items = ds.items ?? [];
const loadMore = () => ds.hasMoreItems && ds.setLimit(ds.limit + 20);
<FlatList data={items} keyExtractor={i => i.id} onEndReached={loadMore} renderItem={({ item }) => (
    <Text>{props.title?.get(item).displayValue}</Text>)} />

// sort and filter
ds.setSortOrder([[props.title!.id, "asc"]]);
ds.setFilter(props.title!.filterable ? contains(attribute(props.title!.id), literal(query)) : undefined);
```

Big numbers: `new Big(v).plus(1)`, `Number(big)` only for display/maths that can lose precision; set with
`setValue(new Big(n))`.

---

## 8. Studio Pro integration (`src/<W>.editorConfig.ts`)

Export these functions (all optional). Types come from `typings/<W>Props.d.ts` (`<W>PreviewProps`).

| Function | Purpose |
|---|---|
| `getProperties(values, defaultProperties)` | hide properties. A hidden property's **value is cleared** (reset to default in 10.24): never hide a `required="true"` property — make it optional and validate in `check` |
| `check(values)` | return `[{ property, severity: "error" \| "warning" \| "deprecation", message, url? }]`; object-list path `cols/1/attr` (1-based) |
| `getPreview(values, isDarkMode, version)` | structure-mode preview: `Container` (children, borders, borderRadius, backgroundColor, borderWidth, padding), `RowLayout` (+ `columnSize: "fixed" \| "grow"`), `Text` (content, fontSize, fontColor, bold, italic), `Image` (document SVG or data base64, width, height), `DropZone` (property, placeholder), `Selectable` (object, child), `Datasource` (property, child); `grow` inside RowLayout |
| `getCustomCaption(values, platform)` | caption in the Page Explorer |

`values` are **preview values**, not runtime objects: attribute = path string, action = `{}` or `null`, style = string.
Helpers (verified to build): `import { hidePropertyIn, hidePropertiesIn, hideNestedPropertiesIn, changePropertyIn,
transformGroupsIntoTabs, moveProperty, Properties, Problem } from "@mendix/pluggable-widgets-tools";` — they mutate
`defaultProperties`; return it afterwards. Errors in these functions appear in Studio Pro → View → Widget Developer Console.

```ts
export function getProperties(values: MyWidgetPreviewProps, defaultProperties: Properties): Properties {
    const hidden = values.linkMode !== "action" ? ["onLink"] : [];
    return hide(defaultProperties, hidden); // see native-widgets/html-viewer/src/HtmlViewer.editorConfig.ts
}
export function getPreview(): object {
    return { type: "Container", borders: true, borderRadius: 6, padding: 6,
        children: [{ type: "Text", content: "My widget", fontColor: "#5f6b7a", fontSize: 9 }] };
}
```

---

## 9. Native specifics

### 9.1 Styling (theme + props.style)

| Item | Rule |
|---|---|
| Default theme style | in the app theme `theme/native/main.js`: `export const dumpit_mywidget_MyWidget = { container: {…}, text: {…} };` (widget id, dots → `_`; verify on a device that it applies) |
| Theme variables | copy from `themesource/atlas_core/native/variables.js` to `theme/native/custom-variables.js`; never edit `atlas_core` |
| Custom fonts | belong to the app (Native Template), not the widget; use one `fontFamily` per weight file |
| Per instance | Studio Pro → Appearance → Class `myClass`; theme: `export const myClass = { container: {…} }` |
| In code | `props.style` is `Style[]` (default → class → design props → inline). Merge each key in order |
| Merge helper | `import { mergeNativeStyles } from "@mendix/pluggable-widgets-tools"` → `mergeNativeStyles(defaultStyle, props.style)` (verified: bundles fine, ~6 KB) or `Object.assign({}, defaults.container, ...props.style.map(s => s?.container ?? {}))` |
| Design properties | `themesource/<module>/native/design-properties.json`: `{ "<widget id>": [ { "name", "type": "Toggle" \| "Dropdown" \| "ToggleButtonGroup" \| "ColorPicker" \| "Spacing", "description", "class" \| "options" } ] }`; the class names resolve to theme style objects merged into `props.style`. CSS variables are web only |
| Style keys | define a `MyWidgetStyle` interface: `container`, `text`, `icon`, `button`, … document them |
| Never | `width: "100%"` together with margin (overflow) — use `alignSelf: "stretch"` |
| Colors | soft borders `#dfe3e8`, text `#1f2933`, secondary `#5f6b7a`, error `#8a1c1c` on `#fff7f7`; Material shadow: `elevation` (Android) + `shadowColor/Opacity/Radius/Offset` (iOS) |
| Touch targets | ≥ 44×44 (use `hitSlop`) |
| Dark mode | `useColorScheme()` or theme variables; never hard-code white text on white |

### 9.2 React Native building blocks

| Need | Use | Watch out |
|---|---|---|
| Layout | `View` + flexbox (column by default) | `flex: 1` needs a bounded parent; inside a scroll view it becomes 0 |
| Text | `Text` (all strings must be inside `<Text>`) | `numberOfLines`, `ellipsizeMode` |
| Press | `Pressable` (`({pressed}) => style`), `hitSlop` | not `TouchableOpacity` inside lists with gestures |
| Lists | `FlatList` (`keyExtractor`, `onEndReached`, `initialNumToRender`, `getItemLayout`) | never nest a vertical list in a vertical `ScrollView` |
| Scroll | `ScrollView` (`nestedScrollEnabled` on Android) | Mendix pages already scroll: avoid nested vertical scroll |
| Input | `TextInput` (`keyboardType`, `returnKeyType`, `onSubmitEditing`, `secureTextEntry`) | keyboard covers inputs: `KeyboardAvoidingView` (`behavior="padding"` on iOS) |
| Images | `Image` (`resizeMode="contain"`), or `mendix/components/native/Image` | give a size; remote images need https; `import x from "./img.png"` in native code is **inlined as base64** (big bundle) — prefer `image`/`icon` properties |
| Toolbox icon | `src/<W>.icon.png` (64×64), `src/<W>.tile.png` (256×192), `*.dark.png` variants | copied into the mpk automatically |
| Modal | `Modal` (`onRequestClose` = Android back, `supportedOrientations` for iOS landscape, `statusBarTranslucent`) | |
| Spinner | `ActivityIndicator` | delay ~250 ms to avoid flicker |
| Alerts | `Alert.alert(title, message, buttons)` | Android `ToastAndroid` is 2 lines max on Android 12+ |
| Platform | `Platform.OS`, `Platform.Version`, `Platform.select({ios, android})` | |
| Size / rotation | `useWindowDimensions()` | re-layout on rotation, split screen |
| App state | `AppState.addEventListener("change", s => …)` → `.remove()` | refresh when the app returns |
| Back button | `BackHandler.addEventListener("hardwareBackPress", fn)` → return `true` to consume | Android 16 predictive back: app manifest `android:enableOnBackInvokedCallback="false"` with RN 0.77 |
| Links | `Linking.openURL(url).catch(…)` | |
| Animations | `Animated` (core) or `react-native-reanimated` (external, in the app) | |
| Gestures | `react-native-gesture-handler` (external) | |
| SVG | `react-native-svg` (external) | |
| Safe area | `react-native-safe-area-context` (external) or `SafeAreaView` (iOS only) | NT 14 uses edge-to-edge on Android |
| Navigation | `useContext(NavigationContext)` from `@react-navigation/native` (does not throw outside a navigator) | Mendix: Drawer → BottomTabs/Stack; see `native-widgets/back-navigation` |
| Accessibility | `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, `accessible` | screen readers |

### 9.3 npm packages

| Package kind | How to add | Result in mpk | App needs |
|---|---|---|---|
| Pure JS (e.g. `date-fns`, `lodash-es`) | `npm i date-fns` (dependencies) | bundled inside `<W>.android.js` / `.ios.js` | nothing |
| External libs (react, react-native, mendix, big.js, @react-navigation/*, gesture-handler, reanimated, fast-image, svg, vector-icons, safe-area-context) | devDependency for types only, or none | not bundled | already in the app |
| Native module (has `android/`, `ios/`, `.podspec`) e.g. `react-native-webview` | `npm i react-native-webview@<version the app has>` (dependencies, exact) | copied to `node_modules/` inside the mpk + `<W>.json` `{ "nativeDependencies": { "pkg": "ver" } }` | must be compiled into the app (see below) |

**Make It Native for 10.24** (the preview app; Mendix docs: for Mendix 10 build your own from the `mendix/make-it-native`
repository, branch `mx/10.24`, or use a custom developer app) contains these native modules (React Native 0.77.3):
`@gorhom/bottom-sheet ^5.1.1`, `@op-engineering/op-sqlite 9.2.7`, `@react-native-async-storage/async-storage 2.0.0`,
`@react-native-camera-roll/camera-roll 7.4.0`, `@react-native-community/datetimepicker 8.2.0`,
`@react-native-community/geolocation 3.4.0`, `@react-native-community/netinfo 11.4.1`,
`@react-native-community/push-notification-ios 1.10.1`, `@react-native-firebase/{app,analytics,crashlytics,messaging,ml} 20.1.0`,
`@react-native-masked-view/masked-view 0.3.1`, `@react-native-picker/picker 2.11.0`, `@swan-io/react-native-browser 0.4.1`,
`react-native-ble-plx 2.0.3`, `react-native-blob-util 0.21.2`, `react-native-calendar-events 2.1.0`,
`react-native-device-info 13.0.0`, `react-native-edge-to-edge 1.7.0`, `react-native-fast-image 8.6.3`,
`react-native-file-viewer 2.1.5`, `react-native-geocoder 0.5.0`, `react-native-gesture-handler 2.23.1`,
`react-native-image-picker 7.2.3`, `react-native-inappbrowser-reborn 3.6.3`, `react-native-linear-gradient 2.5.6`,
`react-native-localize 3.2.1`, `react-native-maps 1.14.0`, `react-native-pager-view 6.4.1`, `react-native-permissions 4.1.5`,
`react-native-push-notification 8.1.1`, `react-native-reanimated 3.16.1`, `react-native-safe-area-context 5.2.0`,
`react-native-screens 4.6.0`, `react-native-sound 0.11.0`, `react-native-svg 15.11.1`, `react-native-system-navigation-bar 2.6.3`,
`react-native-tab-view 3.5.2`, `react-native-touch-id 4.4.1`, `react-native-vector-icons 10.2.0`, `react-native-video 6.10.0`,
`react-native-view-shot 4.0.3`, `react-native-vision-camera 4.7.3`, `react-native-webview 13.13.2`.
Pin the **same versions** in your widget. A module that is not in this list does not work in Make It Native.

Native Template 14.1.x (your production app base) already contains (usable without a rebuild, import normally):
`@react-native-async-storage/async-storage 2.0.0`, `@react-native-camera-roll/camera-roll 7.4.0`,
`@react-native-community/datetimepicker 8.2.0`, `@react-native-community/push-notification-ios 1.10.1`,
`@react-native-masked-view/masked-view 0.3.1`, `@react-native-picker/picker 2.11.0`, `@react-navigation/native 7.0.14`,
`@gorhom/bottom-sheet ^5.1.1`, `@op-engineering/op-sqlite 9.2.7`, `@swan-io/react-native-browser 0.4.1`,
`react-native-blob-util 0.21.2`, `react-native-device-info 13.0.0`, `react-native-edge-to-edge 1.7.0`,
`react-native-fast-image 8.6.3`, `react-native-gesture-handler 2.23.1`, `react-native-image-picker 7.2.3`,
`react-native-localize 3.2.1`, `react-native-pager-view 6.4.1`, `react-native-permissions 4.1.5`,
`react-native-push-notification 8.1.1`, `react-native-reanimated 3.16.1`, `react-native-safe-area-context 5.2.0`,
`react-native-screens 4.6.0`, `react-native-svg 15.11.1`, `react-native-tab-view 3.5.2`,
`react-native-vector-icons 10.2.0`, `react-native-video 6.10.0`.
For these, use the **same version** in your `package.json` (or a devDependency for types) to avoid two copies.

Adding a native module that is NOT in the app:
1. `npm i <pkg>@<exact version>` in the widget; check its peer dependencies match RN 0.77.
2. Build the mpk; `<W>.json` lists it. Studio Pro "Build Native Mobile App" adds it to the app.
3. Own build / custom dev app: add it to the Native Template `package.json`, `npm install`, `cd ios && pod install`,
   rebuild the app.
4. **Make It Native cannot load new native code.** Test such widgets in a custom dev app.
5. If the same package comes from another widget (e.g. Native Mobile Resources), keep one version.

### 9.4 Mendix native runtime facts

| Fact | Consequence |
|---|---|
| Widget props update on every data change | keep heavy work in `useMemo`; compare primitive values |
| `needsEntityContext="true"` widget outside a data view | attribute values are `Unavailable` |
| Data view without an object | children may not render at all |
| Offline-first apps | data comes from the device database; sync settings decide what is there; attributes can be empty on the device |
| Entity access | no read access → value empty/unavailable |
| Navigation | pages are React Navigation screens; a page that is not focused still exists (subscribe on focus) |
| Progress overlay | "blocking" progress swallows the Android back press |
| Make It Native | Run Locally; shake / dev menu → Reload; JS errors show a red screen in dev |

---

## 10. React rules (lint enforced)

| Rule | Correct |
|---|---|
| Hooks at top level, same order every render | no hooks after an early `return` |
| No ref writes during render | `useLayoutEffect(() => { ref.current = value; });` |
| No synchronous `setState` in an effect body | derive values; store state "for a key" (`readyFor === key`); set in callbacks/timers |
| Adjust state from props | `if (incoming !== html) setHtml(incoming);` during render (React pattern) |
| Effects clean up | return a cleanup that removes listeners/timers |
| Stable callbacks for child props | `useCallback` + read latest props through a ref |
| Class members order | instance members before `static getDerivedStateFromError` (lint `member-ordering`) |
| `__DEV__` | add `/* global __DEV__ */` at the top of the file |
| Lists | `key={item.id}` |
| Error boundary | class component with `getDerivedStateFromError` + `componentDidCatch`; show an error view with retry |

---

## 11. Performance

| Item | Rule |
|---|---|
| Re-renders | `useMemo` for derived data, `React.memo` for list rows |
| Lists | `FlatList` with `keyExtractor`, `windowSize`, `removeClippedSubviews` on Android |
| Data source | `setLimit` paging; `requestTotalCount(true)` only when you show a total |
| Images | fixed size, `resizeMode`, avoid huge base64 strings in props |
| Timers / listeners | always clear |
| Bundle | avoid large pure-JS libs (moment, full lodash); prefer `date-fns`, `lodash-es` single imports |

---

## 12. Testing

| Item | How |
|---|---|
| Runner | `npm test` → Jest with the tools' react-native preset |
| Pure logic | `src/__tests__/<logic>.spec.ts` — no React Native imports in the logic file |
| Render | `import { render } from "@testing-library/react-native"`; `render(createElement(MyWidget, props))` or JSX in `.spec.tsx` |
| Mendix values | build plain objects: `{ status: ValueStatus.Available, value: "x" } as any` (typed via a helper) |
| Native module | `jest.mock("react-native-webview", () => ({ WebView: (p) => h(View, { testID: "web" }) }))` |
| Timers | `jest.useFakeTimers(); jest.advanceTimersByTime(4000)` |
| Alert | `jest.spyOn(Alert, "alert").mockImplementation(() => undefined)` |
| What to cover | loading, unavailable, empty, read-only, validation text, action not executable, list empty, list paging |

---

## 13. UX and edge-case checklist (make a table, mark each)

| Case | Expected |
|---|---|
| Loading | spinner after 250 ms, keep previous content if any |
| Unavailable (no context / no access) | clear empty state, never a blank box |
| Empty value / empty list | empty text (translatable) |
| Read-only | disabled look, no edit, readable contrast |
| Validation error | message under the field, `accessibilityLiveRegion` |
| Action cannot execute | disabled button |
| Double tap | guard with `isExecuting` / debounce |
| Slow network | non-blocking spinner, timeout fallback |
| Offline | cached data or clear message, retry when back |
| Long text / long words | `numberOfLines` or wrap; no overflow |
| Many items | paging / virtualized list |
| Phone, tablet, portrait, landscape, split screen | `useWindowDimensions`, flex, no fixed widths |
| Keyboard | inputs stay visible (`KeyboardAvoidingView`) |
| Android back | closes your modal first (`onRequestClose`) |
| Dark mode | readable colors |
| RTL | use `start`/`end` instead of `left`/`right` where possible |
| Accessibility | roles, labels, 44 px targets, font scaling |
| Z-order | overlays only inside the widget box; no global `zIndex` fights |
| Nested scrolling | avoid; `nestedScrollEnabled` only when a fixed-height inner scroll is required |
| Diagnostics | optional `debugMode` boolean property: show version + status values in one `Alert` (see `html-viewer`) |

---

## 14. Debugging on a device

| Symptom | Check |
|---|---|
| Widget shows nothing | diagnostic mode: value status, length; widget inside a data view? visibility? |
| Old behavior | version bumped? old mpk removed from `widgets/`? app fully restarted? |
| Red screen "Invalid hook call" | React bundled twice (a dependency brought its own react) — make it external / peer |
| Red screen native module not found | native package not in the app build (section 9.3) |
| Works in Make It Native, not in own build (or reverse) | different native module versions; align |
| Layout 0 height | `flex: 1` inside a scroll container; give a height or use content size |

---

## 15. Release and install

1. Bump `version` in `package.json` and `src/package.xml`.
2. `npm run release` → `dist/<version>/<packagePath>.<Widget>.mpk`.
3. Copy to `<Mendix project>/widgets/` (or set `config.projectPath`), delete older mpk of the same widget.
4. Studio Pro: F4 → place the widget → Run Locally → reload the app.
5. Commit the mpk (the repo keeps `dist/<version>/` for users without npm), not `dist/tmp/` and not `node_modules/`.

---

## 16. Error → fix

| Error | Fix |
|---|---|
| `a minimum node version ^22.18.0 is required` | install Node 22.18+ |
| `Cannot find a widget entry file` | `src/<widgetName>.tsx` missing / name mismatch |
| `TS6133 'createElement' is declared but its value is never read` | remove the import |
| `TS2307 Cannot find module 'x'` | `npm i x` (dependencies) |
| `TS2305 … has no exported member '<W>Props'` | `supportedPlatform="All"` gives `<W>ContainerProps`; use `Native` |
| XSD: `invalid child element` | order `caption`, `description`, then the rest |
| Studio Pro: `Help url scheme must be https` | remove `helpUrl` |
| Studio Pro: property missing after update | F4; check XML key spelling; restart Studio Pro |
| Lint `Cannot update ref during render` | `useLayoutEffect` |
| Lint `set-state-in-effect` | derive / key / callback (section 10) |
| Lint `member-ordering` | instance members before static |
| Prettier errors | `npx prettier --write "src/**/*.{ts,tsx}"` |
| Typings outdated | `npm run build` (regenerates from XML) |
| `TurboModuleRegistry.getEnforcing(...): 'X' could not be found` | native module missing in the app |

---

## 17. Reference implementations in this repo

| Widget | Shows how to |
|---|---|
| `native-widgets/back-navigation` | `NavigationContext`, `BackHandler`, focus/blur subscription, editorConfig hide/check, pure logic + tests |
| `native-widgets/html-viewer` | native npm dependency (`react-native-webview`), style merge, error boundary, modal, diagnostic dialog, render tests with mocks, browser tests of generated HTML |

---

## 18. Knowledge map (what the agent must know; check each before claiming "done")

| # | Area | Topic | Must know |
|---|---|---|---|
| 1 | Mendix | Pluggable widget | A React (Native) component + XML definition packaged as `.mpk`; Studio Pro reads the XML, the client runs the JS |
| 2 | Mendix | `widgets/` folder | Studio Pro loads every `.mpk` there on F4; duplicates of one widget id conflict |
| 3 | Mendix | Widget id | Unique, stable; changing it breaks every page that uses the widget |
| 4 | Mendix | Property key | Becomes the prop name; renaming it loses the configured value on pages |
| 5 | Mendix | Data view context | `needsEntityContext="true"` widgets read attributes from the surrounding object |
| 6 | Mendix | List context | Inside a list/gallery item, the context object is that item |
| 7 | Mendix | Page parameters | 10.23+: attribute properties may use page parameters without a data view |
| 8 | Mendix | Entity access | Read/write rights per attribute decide `readOnly` and availability |
| 9 | Mendix | Editability | Conditional editability sets every `EditableValue.readOnly` |
| 10 | Mendix | Visibility | Mendix hides the whole widget; no prop needed |
| 11 | Mendix | Validation | Domain-model rules + `setValidator` (one custom validator) show in `validation` |
| 12 | Mendix | Commit | Widgets never commit; a microflow/nanoflow action does |
| 13 | Mendix | Microflow vs nanoflow | Native/offline logic runs in nanoflows; microflows need the server |
| 14 | Mendix | Offline-first | Native apps use a local database; synchronization decides what data exists on the device |
| 15 | Mendix | Sync settings | Navigation → Native → offline sync per entity (all objects / by XPath / nothing) |
| 16 | Mendix | Enumerations | Value = key string; caption via `formatter.format(value)`; `universe` lists keys |
| 17 | Mendix | Decimal precision | `Big` keeps precision; never convert money to `number` for maths |
| 18 | Mendix | DateTime | JS `Date`; time zone = device/user; use the formatter for display |
| 19 | Mendix | Associations | `ReferenceValue` / `ReferenceSetValue`; options come from `selectableObjects` datasource |
| 20 | Mendix | Datasource kinds | Database/XPath (server paging), Association, Microflow, Nanoflow (client-side processing) |
| 21 | Mendix | Listen to / selection | Selection values can drive other widgets (10.4+), expressions (10.6+) |
| 22 | Mendix | Text templates | Translatable, may include parameters; value can be Loading |
| 23 | Mendix | Languages | Translations per `lang` code in XML (`en_US`, `tr_TR`, `nl_NL`) |
| 24 | Mendix | Native navigation | Pages are React Navigation screens (stack per tab, popups) |
| 25 | Mendix | Progress | Blocking progress overlays the page and swallows back |
| 26 | Mendix | Make It Native | Test app with a fixed set of native modules (list in 9.3, built from `mendix/make-it-native` branch `mx/10.24`); reload JS from Studio Pro |
| 27 | Mendix | Custom dev app | Built from Native Template; needed for new native modules |
| 28 | Mendix | Native Template | The React Native project Mendix builds; `package.json` = available native modules |
| 29 | Mendix | Build Native Mobile App | Studio Pro/Native Builder adds `nativeDependencies` from widgets |
| 30 | Mendix | Theme (native) | JS style objects exported from `theme/native` / `themesource/<module>/native` |
| 31 | Mendix | Atlas native | Default design system; reuse its variables (colors, spacing, font sizes) |
| 32 | Mendix | Design properties | JSON per module; classes → style objects |
| 33 | Mendix | Marketplace | Publish `.mpk` with docs; versioning semver |
| 34 | Mendix | Native Mobile Resources | Mendix's widget set (Web view, Bottom sheet, …); avoid duplicating them |
| 35 | Mendix | Security | Widget code runs on the device; never trust it for authorization |
| 36 | Mendix | Logging | `console.info/warn/error` → Studio Pro console / Metro / device log |
| 37 | Mendix | Errors | A thrown render error shows a red box in dev; use an error boundary |
| 38 | Mendix | Version mapping | tools 10.24.1 ↔ Studio Pro 10.24 ↔ NT 14 ↔ RN 0.77 |
| 39 | Tooling | `pluggable-widgets-tools` | Rollup build, typings generator, jest/eslint/prettier presets |
| 40 | Tooling | Typings generator | Reads XML; writes `typings/<W>Props.d.ts` on build |
| 41 | Tooling | Rollup externals | Native: mendix, react, react-native, big.js, @react-navigation, gesture-handler, reanimated, fast-image, svg, vector-icons, safe-area-context |
| 42 | Tooling | Bundling | Pure-JS dependencies are inlined into `<W>.android.js`/`.ios.js` |
| 43 | Tooling | Native deps | Copied into the mpk + `<W>.json` `nativeDependencies` (exact versions) |
| 44 | Tooling | Licenses | `dependencies.txt` / `.json` list bundled package licenses |
| 45 | Tooling | `config.projectPath` | Auto-copy to the Mendix project (build/start only, not release) |
| 46 | Tooling | Node engine | `^22.18.0` enforced |
| 47 | Tooling | xmllint | Validates XML against `node_modules/mendix/custom_widget.xsd` |
| 48 | Tooling | Custom rollup | `rollup.config.mjs` in the widget root can change the default config (advanced) |
| 49 | Tooling | Generator | `npx @mendix/generator-widget@10.24-latest` scaffolds a project |
| 50 | Tooling | Git | Commit sources, typings, `dist/<v>/*.mpk`; ignore `node_modules`, `dist/tmp` |
| 51 | TypeScript | Strict mode | Base tsconfig is strict; handle `undefined` |
| 52 | TypeScript | Union narrowing | `status` narrows `DynamicValue.value` |
| 53 | TypeScript | `Option<T>` | `T \| undefined` |
| 54 | TypeScript | `as const`, literal types | for enum props |
| 55 | TypeScript | Generics | `Props<Style>` for native |
| 56 | TypeScript | `unknown` over `any` | lint discourages `any` |
| 57 | TypeScript | Type-only imports | `import type { X }` for types from native modules |
| 58 | React | Function components | One exported component per widget entry |
| 59 | React | JSX transform | automatic runtime; no `createElement` import |
| 60 | React | `useState` | local UI state only; Mendix values come from props |
| 61 | React | `useMemo` | derived data (merged styles, filtered items) |
| 62 | React | `useCallback` | stable handlers for lists/children |
| 63 | React | `useRef` | latest props for listeners; DOM/native refs |
| 64 | React | `useLayoutEffect` | write refs; measure layout |
| 65 | React | `useEffect` | subscribe/unsubscribe; no sync setState in body |
| 66 | React | Effect cleanup | remove listeners, clear timers |
| 67 | React | Derived state | compute from props instead of syncing |
| 68 | React | Keys | `item.id`, never index for dynamic lists |
| 69 | React | `React.memo` | pure rows |
| 70 | React | Error boundaries | class component only |
| 71 | React | Context | `NavigationContext` read with `useContext` |
| 72 | React | Strict effects | effects may run twice in dev; make them idempotent |
| 73 | React | Controlled inputs | value from `EditableValue`, write with `setValue`/`setTextValue` |
| 74 | React | Batching | several setState calls in one event render once |
| 75 | React | Concurrent safety | no side effects in render |
| 76 | React Native | Core components | View, Text, Image, TextInput, Pressable, ScrollView, FlatList, SectionList, Modal, ActivityIndicator, Switch, KeyboardAvoidingView |
| 77 | React Native | Flexbox | column default, `flex`, `alignItems`, `justifyContent`, `flexWrap`, `gap` |
| 78 | React Native | Units | density-independent pixels; no `%` for font sizes |
| 79 | React Native | Text rules | text only inside `<Text>`; nested Text inherits style |
| 80 | React Native | StyleSheet | `StyleSheet.create`, arrays merge left→right |
| 81 | React Native | Platform code | `Platform.OS`, `Platform.select`, `.android.tsx` / `.ios.tsx` |
| 82 | React Native | Dimensions | `useWindowDimensions` (updates on rotation) |
| 83 | React Native | Safe areas | notch/home indicator; NT 14 Android edge-to-edge |
| 84 | React Native | Keyboard | `Keyboard` events, `KeyboardAvoidingView`, `keyboardShouldPersistTaps` |
| 85 | React Native | Touch | `Pressable`, `hitSlop`, `pressRetentionOffset`, `delayLongPress` |
| 86 | React Native | Gesture conflicts | Pressable inside ScrollView: keep taps short; avoid nested scroll |
| 87 | React Native | Lists | `FlatList` virtualization props, `onEndReachedThreshold`, `ListEmptyComponent` |
| 88 | React Native | Images | `resizeMode`, caching, remote https, `onError` fallback |
| 89 | React Native | Animations | `Animated` with `useNativeDriver: true` for transform/opacity |
| 90 | React Native | Reanimated | external; worklets; version 3.16 in NT 14 |
| 91 | React Native | Gesture handler | external; `GestureDetector` |
| 92 | React Native | Modal | `onRequestClose`, `supportedOrientations`, `statusBarTranslucent`, `transparent` |
| 93 | React Native | Alert / Toast | `Alert.alert` cross-platform; `ToastAndroid` Android only, short |
| 94 | React Native | Linking | `openURL`, `canOpenURL` (Android 11 package visibility) |
| 95 | React Native | AppState | foreground/background events |
| 96 | React Native | BackHandler | Android hardware back; subscribe on focus |
| 97 | React Native | Accessibility | roles, labels, `accessibilityState`, font scaling (`allowFontScaling`) |
| 98 | React Native | Color scheme | `useColorScheme()` |
| 99 | React Native | i18n / RTL | `I18nManager.isRTL`; logical `start`/`end` |
| 100 | React Native | Performance | avoid inline heavy work, large images, many re-renders; use the profiler |
| 101 | React Native | New architecture | TurboModules/Fabric; a missing native module fails at import |
| 102 | React Native | Native module versions | JS and native versions must match (app vs widget) |
| 103 | React Native | WebView | `react-native-webview` (not in NT 14 by default; NMR adds it) |
| 104 | React Native | SVG | `react-native-svg` external |
| 105 | React Native | Vector icons | `react-native-vector-icons` external; Mendix icons via `mendix/components/native/Icon` |
| 106 | React Native | Storage | `@react-native-async-storage/async-storage` in NT 14 |
| 107 | React Native | Permissions | `react-native-permissions` in NT 14; ask with a clear reason |
| 108 | React Native | Device info | `react-native-device-info` in NT 14 |
| 109 | React Native | Date picker | `@react-native-community/datetimepicker` in NT 14 |
| 110 | React Native | Bottom sheet | `@gorhom/bottom-sheet` in NT 14 |
| 111 | React Native | Video | `react-native-video` in NT 14 |
| 112 | React Native | Pager / tabs | `react-native-pager-view`, `react-native-tab-view` in NT 14 |
| 113 | React Native | Android 16 back | predictive back needs `enableOnBackInvokedCallback="false"` with RN 0.77 |
| 114 | React Native | iOS gestures | swipe back = navigator `gestureEnabled` |
| 115 | Testing | Jest preset | tools' native preset; `@testing-library/react-native` |
| 116 | Testing | Mocks | `jest.mock` native modules; plain objects for Mendix values |
| 117 | Testing | Fake timers | debounce, delayed spinners, timeouts |
| 118 | Testing | Snapshot | avoid large snapshots; assert text/roles |
| 119 | Testing | Coverage | logic files near 100%; states in render tests |
| 120 | Testing | Device test | acceptance steps on Android + iOS, portrait + landscape |
| 121 | UX | States | loading, empty, error, success, read-only, disabled |
| 122 | UX | Feedback | press feedback, progress, toasts for non-blocking info |
| 123 | UX | Touch size | ≥ 44 px |
| 124 | UX | Contrast | text 4.5:1 |
| 125 | UX | Spacing | 4/8 px grid; soft borders; Material elevation |
| 126 | UX | Overflow | no horizontal overflow; wrap long words |
| 127 | UX | Orientation | layouts adapt to portrait/landscape/tablet |
| 128 | UX | Keyboard | inputs visible, next/done keys |
| 129 | UX | Nested scroll | avoid |
| 130 | UX | Z-order | overlays inside the widget; modals for full screen |
| 131 | UX | Icons vs labels | icons with accessibility labels on small screens |
| 132 | UX | Diagnostics | optional debug mode showing versions and value status |
| 133 | Security | Untrusted HTML/text | never execute it; sanitize; CSP in web views |
| 134 | Security | Secrets | never in widget code or XML defaults |
| 135 | Security | Links | allow-list schemes (https, mailto, tel); block `javascript:`, `file:`, `intent:` |
| 136 | Release | Semver | patch = fix, minor = feature, major = breaking XML change |
| 137 | Release | Two version fields | `package.json` and `src/package.xml` |
| 138 | Release | Changelog | note behavior and XML changes |
| 139 | Release | Breaking XML changes | renaming/removing keys or types breaks pages; 10.24 converts some types automatically |
| 140 | Release | Distribution | commit `dist/<v>/*.mpk`; users copy to `widgets/` |
