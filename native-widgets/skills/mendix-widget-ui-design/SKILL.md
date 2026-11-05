---
name: mendix-widget-ui-design
description: Enterprise UI/UX rules for Mendix custom widgets (web and native) - design tokens with verified contrast, surface ladder for nested components, soft borders and Material-like shadows, typography, spacing, container-based responsive layout for every size class and orientation (small phone to large desktop), adaptive text-to-icon rules, forms that stay visible above the keyboard, one scroll owner (no nested scrolling), React Native Pressable/ScrollView rules, z-index/elevation layering without clipping or overlap, states, accessibility and a QA matrix. Use before designing or reviewing any widget UI, when a page looks ugly or cluttered, or when the user asks for responsive, clean, readable, enterprise or modern design.
---

# Enterprise UI rules for Mendix custom widgets (web + native)

Goal: every widget is **clear, calm and foolproof** on every screen from a 320 px phone to a 1920 px desktop, in
portrait and landscape. Use it together with `mendix-native-widget` or `mendix-web-widget` (how to build) and
`mendix-legacy-page-redesign` (how to turn an old page into new widgets).

Workflow for every widget UI:
1. Fill the **risk table** (section 1) for this widget: mark each row ✔ handled / – not relevant.
2. Write the **layout spec** (section 8) for compact / medium / expanded, portrait and landscape (ASCII sketches).
3. Use only the **tokens** (section 3). A new color needs a contrast check (`python tools/contrast.py fg bg`).
4. Build. Then run the **QA matrix** (section 15) and the **definition of done** (section 16).

---

## 1. Problems, risk and the chosen solution

Risk = likelihood × impact (1–10). Every row is mandatory for a widget that shows the matching element.

| # | Problem | Risk | Chosen solution | Verify |
|---|---|---|---|---|
| **Color and contrast** |||||
| 1 | Text hard to read on its background | 9 | Only token pairs from section 3 (body text ≥ 7:1, muted ≥ 4.5:1, verified) | contrast.py on every new pair |
| 2 | Nested box has the same background as its parent; edges disappear | 8 | **Surface ladder** (section 4): a child is never the parent's color; alternate `surface` ↔ `surfaceSunken` + 1 px soft border | look at nested levels in light and dark |
| 3 | Colored text on colored background (badge, banner) unreadable | 8 | Use the paired `*Bg` + `*Text` tokens (e.g. `dangerBg`/`onDanger`), never brand color text on tinted brand bg without a check | contrast.py |
| 4 | Information only by color (red = error) | 7 | Color + icon + text ("⚠ Required") | grayscale screenshot |
| 5 | Dark mode makes text invisible (hard-coded white/black) | 8 | Tokens per scheme; never a literal `#fff` text on a theme background | toggle device dark mode |
| 6 | Input border too faint to find the field | 7 | Input border `borderStrong` (≥ 3:1, WCAG non-text) ; decorative borders may be soft | contrast.py |
| 7 | Disabled looks like enabled (or unreadable) | 6 | `textDisabled` + no shadow + `opacity` never below 0.5 on text | screenshot |
| 8 | Brand color too bright for text | 6 | Brand used for fills/buttons; text links use `primary` token (≥ 4.5:1) | contrast.py |
| **Borders, shadows, depth** |||||
| 9 | Harsh black 1 px borders everywhere, nested boxes look like a grid | 8 | Soft border `#D7DEE6` (light) / `#2C3742` (dark), radius 8–12, **one** border per edge (no double borders when nested) | screenshot zoom |
| 10 | Too many shadows (every nested box floats) | 6 | Shadow only on level-1 cards, menus, dialogs; nested items use border or tone, not shadow | count shadows |
| 11 | Shadow invisible on Android or on iOS | 6 | Native: `elevation` (Android) **and** `shadowColor/Opacity/Radius/Offset` (iOS); shadowed view needs a background color | both platforms |
| 12 | `overflow: hidden` + shadow on the same native view → shadow cut (iOS) | 5 | Outer view = shadow, inner view = `overflow: hidden` + radius | iOS |
| 13 | RN `boxShadow` style used | 4 | Not reliable on old architecture; use elevation + shadow* props | build both |
| **Typography** |||||
| 14 | Text too small on phones | 8 | Body 16, min 14 for secondary, 12 only for captions | 320 px screenshot |
| 15 | Large accessibility font breaks layout | 7 | Allow font scaling; cap with `maxFontSizeMultiplier={1.4}` on dense labels; wrap, never clip | system font 200 % |
| 16 | Long words / URLs / IDs overflow | 8 | Web `overflow-wrap:anywhere`; native `flexShrink:1` on text + `numberOfLines` only where truncation is acceptable | long-text fixture |
| 17 | Truncated important info (amount, status) | 7 | Truncate in this order: description → secondary meta → label; never amounts, status, primary title | fixture |
| 18 | Too many font sizes/weights | 5 | Scale of 6 sizes, 2 weights (400/600) | review |
| **Spacing and layout** |||||
| 19 | Cramped content, no breathing room | 7 | 4/8 px grid; card padding 16 (compact) / 20–24 (expanded); gap 8–16 | screenshot |
| 20 | Wasted space on tablets/desktop (phone layout stretched) | 7 | Size classes (section 8): more columns, master-detail ≥ 840 px, max content width 1200 | 1280 px screenshot |
| 21 | Horizontal overflow / sideways scroll of the page | 9 | No fixed widths; `minWidth: 0` / `flexShrink: 1`; images `maxWidth: 100%`; tables → cards on compact | 320 px, landscape |
| 22 | `width: "100%"` + margin overflows the parent | 7 | `alignSelf: "stretch"` (native) / `width: auto` + `box-sizing` (web) | screenshot |
| 23 | Layout uses screen width, but the widget sits in a narrow column | 8 | **Container-based** breakpoints: measure the widget (`onLayout` / `ResizeObserver`) not the window | widget in a 1/3 column |
| 24 | Rotation leaves stale layout | 7 | Recompute on width change (`onLayout` / `useWindowDimensions` / ResizeObserver) | rotate during use |
| 25 | Notch / home indicator / edge-to-edge covers content | 6 | Full-screen widgets use safe-area insets; page-embedded widgets leave it to the page | iPhone + Android 15 |
| 26 | Split screen / foldables / very wide short screens | 5 | Same size classes by width; height-aware for landscape phones (< 480 tall: compact header) | landscape phone |
| **Adaptive content (text ↔ icon)** |||||
| 27 | Labels do not fit on small screens | 7 | Priority + collapse rule (section 9): label+icon → icon+short label → icon with accessibility label + tooltip/long-press | 320 px |
| 28 | Icon-only buttons nobody understands | 8 | Icon-only only for the universal set (search, close, back, add, edit, delete, share, filter, sort, more, settings, refresh, download, call, mail, map); everything else keeps a label | user test |
| 29 | Destructive action as small icon next to safe actions | 8 | Destructive: text button, separated, confirm dialog, `danger` color | review |
| 30 | Toolbars with 6+ actions on mobile | 6 | Max 3 visible on compact; rest in a "more" menu / bottom sheet | 320 px |
| **Forms and keyboard** |||||
| 31 | Keyboard covers the focused input (native) | 9 | Full-screen form widget owns a `ScrollView` + `KeyboardAvoidingView` (iOS `padding`; Android check `adjustResize`/edge-to-edge, use `padding` if covered) + `keyboardShouldPersistTaps="handled"`; inline widgets keep inputs few and high | real device, both OS, Android 15 |
| 32 | Keyboard covers input (mobile web) | 7 | On focus: `el.scrollIntoView({ block: "center" })`; layout by `100dvh`; avoid `position: fixed` bottom bars while typing | phone browser |
| 33 | Submit button hidden behind keyboard | 7 | Button directly after the last field (in the scroll content), not a fixed footer, or footer above keyboard | device |
| 34 | Placeholder used as label (disappears while typing) | 8 | Visible label above the field always; placeholder only for an example | review |
| 35 | Wrong keyboard type | 6 | `keyboardType`/`inputMode`: email, phone, numeric, decimal, url; `autoComplete`, `textContentType` | device |
| 36 | No "next" flow between fields | 5 | `returnKeyType="next"` + focus next ref; last = "done"/"go" submits | device |
| 37 | Validation message far from field / only in a toast | 8 | Message directly under the field, `danger` text + icon; summary at top for long forms | fixture |
| 38 | Input too small to tap | 7 | Height ≥ 48 (native) / 44 (web); full-width on compact | measure |
| 39 | Read-only looks editable | 6 | Read-only = plain text value, not a disabled input | review |
| **Scrolling and gestures** |||||
| 40 | Nested vertical scroll (scroll inside scroll) | 9 | **One scroll owner** (section 11): page-embedded widgets never scroll vertically; a full-screen widget owns the only scroll | swipe test |
| 41 | `FlatList` inside a `ScrollView` (VirtualizedList warning, broken virtualization) | 8 | Embedded: render items with `map` (≤ 50) or let the widget be full-screen with one `FlatList` + header/footer components | dev warnings |
| 42 | Pressable fires while the user scrolls / scroll feels sticky | 7 | Use `onPress` (never `onPressIn` for actions); no `TouchableWithoutFeedback` around a ScrollView; `Pressable` rows with feedback; `keyboardShouldPersistTaps="handled"` | scroll over buttons |
| 43 | Horizontal carousel steals vertical scroll | 6 | Horizontal `FlatList` with `nestedScrollEnabled` (Android), fixed height, snapping; vertical page scroll unaffected | diagonal swipe |
| 44 | Pull-to-refresh conflicts | 4 | Only the scroll owner has `RefreshControl` | |
| 45 | Web: inner scroll panel traps the wheel | 6 | Avoid; if needed `overscroll-behavior: contain` + visible scrollbar + fixed height | desktop |
| **Layers, z-index, clipping** |||||
| 46 | Dropdown/popover clipped by a parent with `overflow: hidden` | 8 | Web: portal to `document.body`; native: `Modal` or bottom sheet — never an absolutely positioned popup outside the widget box | open near edges |
| 47 | Android: element with higher `zIndex` still behind (elevation wins) | 7 | Give overlays both `zIndex` and a matching `elevation`; siblings only | Android |
| 48 | Android: touches outside the parent's bounds are ignored | 7 | Keep tappable children inside the parent box (no negative margins for buttons) | Android |
| 49 | Half-visible overlapping elements (badges, FABs over content) | 7 | Reserve space (padding) for floating elements; FAB only on full-screen widgets; layer scale (section 12) | screenshot |
| 50 | Widget overlay above Mendix header/dialogs | 6 | Stay below Mendix layers on web (`z-index` ≤ 10 inside the widget; portals use the scale) | open a Mendix popup |
| 51 | Sticky header covers anchors / first row | 5 | `scroll-margin-top` (web) / content inset | |
| **States and feedback** |||||
| 52 | Blank area while loading / when empty / on error | 9 | Explicit skeleton (≥ 300 ms loads), empty state (icon + text + action), error state (text + retry) | render tests |
| 53 | Double submit | 7 | Disable while `action.isExecuting`; busy indicator in the button | tap twice |
| 54 | Layout jump when data arrives | 5 | Skeleton with the final size; reserve image aspect ratio | slow network |
| 55 | Toast as the only feedback | 5 | Inline result + toast/snackbar for non-critical info | |
| **Touch and accessibility** |||||
| 56 | Tap targets too small | 8 | ≥ 44×44 (iOS) / 48×48 (Android, web touch); `hitSlop` | measure |
| 57 | Screen reader reads nothing useful | 7 | Labels/roles on every control; icon buttons have `accessibilityLabel` / `aria-label` | TalkBack / VoiceOver |
| 58 | No keyboard access (web) | 8 | Native elements, visible focus ring (`primary`, 2 px, offset 2) | Tab through |
| 59 | Motion sickness / distraction | 3 | Short (150–250 ms) transitions; respect reduced motion | |
| 60 | RTL / long translations (German, Turkish) break layout | 5 | Logical start/end; allow 40 % longer text | translated fixture |
| **Data display** |||||
| 61 | Wide tables on phones | 8 | Compact: card list (title, 2–3 key fields, chevron); medium: table with priority columns; expanded: full table | 360 px |
| 62 | Numbers misaligned / unformatted | 6 | Mendix formatter (`displayValue`), right-aligned numbers in tables, tabular figures | |
| 63 | Status shown as plain text | 5 | Status chip: tinted bg + text token pair + icon | |
| 64 | Images distort or overflow | 6 | Fixed aspect ratio box + `contain`/`cover`, placeholder on error | broken URL |

---

## 2. Strategy (3 options, scored)

| Option | Clarity | Consistency | Theme fit | Effort | Score |
|---|---|---|---|---|---|
| A. Each widget styles itself ad hoc | 4 | 2 | 3 | 8 | 4.0 |
| B. Shared token set + rules, **copied into every widget** (self-contained), overridable by the theme (native style keys / CSS variables) | 9 | 9 | 8 | 7 | **8.5** ✅ |
| C. Rely only on the Atlas theme classes | 6 | 7 | 9 | 6 | 7.0 |

Chosen: **B**, plus Atlas classes where they fit (web buttons, inputs) so pages stay consistent with Mendix widgets.
Each widget ships `src/ui/tokens.ts` (section 3) and reads overrides from the theme.

---

## 3. Design tokens (contrast verified with WCAG formula)

Contrast ratios below were computed (`tools/contrast.py`). Body text ≥ 7:1 on every surface; muted ≥ 4.5:1;
input borders ≥ 3:1.

| Token | Light | Dark | Use | Light ratio on surface / canvas |
|---|---|---|---|---|
| `canvas` | `#F3F5F8` | `#0F141A` | page background behind cards | — |
| `surface` | `#FFFFFF` | `#171E26` | cards, sheets (level 1) | — |
| `surfaceSunken` | `#F6F8FB` | `#121820` | nested area inside a surface (level 2) | — |
| `surfaceRaised` | `#FFFFFF` + shadow | `#1E2732` | menus, dialogs | — |
| `surfaceTint` | `#EEF3FB` | `#1A2635` | selected row, info area | — |
| `text` | `#1B2430` | `#E7ECF2` | body, titles | 15.7 / 14.3 |
| `textMuted` | `#4F5B69` | `#AAB4C0` | secondary text, labels | 6.9 / 6.3 |
| `textDisabled` | `#8A95A3` | `#6F7B88` | disabled only | 3.0 (exempt) |
| `primary` | `#1558B0` | `#7FB2FF` | links, focus ring, primary button bg | 6.9 / 6.3 |
| `onPrimary` | `#FFFFFF` | `#0B1A2E` | text on primary button | 6.9 |
| `danger` / `onDanger` | `#B42318` / `#FFFFFF` | `#FF8A80` / `#0B1A2E` | errors, destructive | 6.6 / 6.6 |
| `success` | `#18794E` | `#5FD39A` | success text/icons | 5.4 / 5.0 |
| `warningText` | `#8A4600` | `#FFC266` | warning text (bg `#FFF4E5` light) | 7.1 |
| `border` | `#D7DEE6` | `#2C3742` | decorative borders, dividers | 1.4 (decorative) |
| `borderStrong` | `#808C9A` | `#6C7A89` | input borders, focus-less controls | 3.4 / 3.1 (light), 3.8 (dark) |

Native (`src/ui/tokens.ts`):
```ts
import { Platform, ViewStyle } from "react-native";
export const light = {
    canvas: "#F3F5F8", surface: "#FFFFFF", surfaceSunken: "#F6F8FB", surfaceTint: "#EEF3FB",
    text: "#1B2430", textMuted: "#4F5B69", textDisabled: "#8A95A3",
    primary: "#1558B0", onPrimary: "#FFFFFF", danger: "#B42318", onDanger: "#FFFFFF",
    success: "#18794E", warningText: "#8A4600", warningBg: "#FFF4E5",
    border: "#D7DEE6", borderStrong: "#808C9A"
};
export const dark: typeof light = {
    canvas: "#0F141A", surface: "#171E26", surfaceSunken: "#121820", surfaceTint: "#1A2635",
    text: "#E7ECF2", textMuted: "#AAB4C0", textDisabled: "#6F7B88",
    primary: "#7FB2FF", onPrimary: "#0B1A2E", danger: "#FF8A80", onDanger: "#0B1A2E",
    success: "#5FD39A", warningText: "#FFC266", warningBg: "#3A2A10",
    border: "#2C3742", borderStrong: "#6C7A89"
};
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };
export const radius = { s: 6, m: 10, l: 14, pill: 999 };
export const font = { caption: 12, small: 14, body: 16, titleS: 18, title: 20, headline: 24 };
export const lineHeight = (size: number): number => Math.round(size * 1.45);
export const elevation1: ViewStyle = Platform.select<ViewStyle>({
    android: { elevation: 2 },
    default: { shadowColor: "#0B1B2B", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }
})!;
export const elevation3: ViewStyle = Platform.select<ViewStyle>({
    android: { elevation: 8 },
    default: { shadowColor: "#0B1B2B", shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }
})!;
```
Choose the scheme with `useColorScheme()`; let the theme override per style key (`props.style`).

Web (`src/ui/<Widget>.css`, overridable by the app theme):
```css
.widget-x {
  --x-canvas:#F3F5F8; --x-surface:#FFFFFF; --x-sunken:#F6F8FB; --x-tint:#EEF3FB;
  --x-text:#1B2430; --x-muted:#4F5B69; --x-disabled:#8A95A3;
  --x-primary:#1558B0; --x-on-primary:#FFFFFF; --x-danger:#B42318; --x-success:#18794E;
  --x-border:#D7DEE6; --x-border-strong:#808C9A;
  --x-shadow-1: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10);
  --x-shadow-3: 0 8px 24px rgba(16,24,40,.14), 0 2px 6px rgba(16,24,40,.08);
  --x-radius: 10px; color: var(--x-text);
}
@media (prefers-color-scheme: dark) { .widget-x { /* dark values from the table */ } }
```

---

## 4. Surface ladder (nested components never blend)

```
canvas (page)                     #F3F5F8
└─ surface (card, shadow-1)       #FFFFFF  radius 12, padding 16
   └─ sunken (section in card)    #F6F8FB  border 1px #D7DEE6, radius 10, NO shadow
      └─ surface (item in section)#FFFFFF  border 1px #D7DEE6, radius 8, NO shadow
         └─ sunken …              alternate again; max 3 nested boxes — flatten deeper levels with dividers
```

| Rule | Why |
|---|---|
| A child box never has its parent's background | edges stay visible |
| Alternate `surface` ↔ `surfaceSunken`, add a soft border from level 2 | tone alone is too weak (ratio 1.06) |
| Shadow only at level 1 and overlays | depth stays meaningful |
| Max 3 nested boxes; deeper → dividers / spacing | clarity |
| Selected/active = `surfaceTint` + `primary` left accent (3 px) | not color-only |
| Text tokens are valid on every surface (table in section 3) | readability guaranteed |

---

## 5. Borders and shadows

| Element | Border | Radius | Shadow |
|---|---|---|---|
| Card (level 1) | none or `border` 1 px | 12 | elevation1 |
| Section (level 2) | `border` 1 px | 10 | none |
| Input | `borderStrong` 1 px; focus `primary` 2 px | 8 | none |
| Button primary | none | 8 (or pill) | none (web: shadow-1 on hover only) |
| Menu / popover / sheet | `border` 1 px | 12 | elevation3 |
| Dialog | none | 16 | elevation3 + scrim `rgba(11,27,43,.45)` |
| Divider | 1 px `border` | — | — |

Never: black borders, border + shadow + different border color on nested items, double borders where two boxes touch
(use one, or gap).

---

## 6. Typography

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| headline | 24 / 32 | 600 | screen title (full-screen widgets) |
| title | 20 / 28 | 600 | card title |
| titleS | 18 / 26 | 600 | section title |
| body | 16 / 23 | 400 | main text, inputs |
| small | 14 / 20 | 400 | labels, secondary |
| caption | 12 / 17 | 400 | meta only (never for essential info) |

System fonts (`-apple-system`, `Roboto`, `Segoe UI`) unless the theme sets one. Numbers in tables: tabular figures
(`font-variant-numeric: tabular-nums` / native `fontVariant: ["tabular-nums"]`).

---

## 7. Spacing and sizing

| Item | Compact (< 600) | Medium (600–839) | Expanded (≥ 840) |
|---|---|---|---|
| Outer padding | 16 | 20 | 24 |
| Card padding | 16 | 16–20 | 20–24 |
| Gap between cards | 12 | 16 | 16–24 |
| Field height | 48 | 48 | 44 (web) / 48 (touch) |
| Max content width | — | — | 1200 (center) |
| Min tap target | 44–48 | 44–48 | 44 (pointer) |

---

## 8. Responsive layout (container-based size classes)

Measure the **widget's own width** (native `onLayout`; web `ResizeObserver`), not the screen.

| Class | Width of the widget | Typical device | Layout |
|---|---|---|---|
| `xs` | < 360 | small phones, narrow columns | 1 column, icon+short labels, stacked buttons |
| `compact` | 360–599 | phones portrait | 1 column, cards, bottom actions in content |
| `medium` | 600–839 | phones landscape, small tablets, split screen | 2 columns, labels next to icons, side-by-side fields |
| `expanded` | 840–1199 | tablets landscape, laptops | master–detail, 3 columns, tables with priority columns |
| `large` | ≥ 1200 | desktops | full table, 4 columns, max width 1200–1440 centered |

Height rule: if the widget/window height < 480 (landscape phone), shrink headers, put secondary panels behind a button.

Native hook:
```ts
export type SizeClass = "xs" | "compact" | "medium" | "expanded" | "large";
export const sizeClass = (w: number): SizeClass =>
    w < 360 ? "xs" : w < 600 ? "compact" : w < 840 ? "medium" : w < 1200 ? "expanded" : "large";
// in the component:
const [width, setWidth] = useState(0);
<View onLayout={e => setWidth(e.nativeEvent.layout.width)}>…</View>
```
Web: `new ResizeObserver(([e]) => setWidth(e.contentRect.width)).observe(rootRef.current!)` (disconnect on unmount),
or CSS container queries: `.widget-x { container-type: inline-size; } @container (min-width: 600px) { … }`.

Layout patterns per class:

| Content | xs / compact | medium | expanded / large |
|---|---|---|---|
| List of records | cards (title, 2–3 fields, status chip, chevron) | 2-column cards | table with sortable columns |
| Form | 1 column, labels above | 2 columns for short fields | 2–3 columns, sections side by side, sticky summary |
| Detail | stacked sections | 2 columns | master–detail |
| KPI tiles | 2 per row (value + label) | 3–4 per row | 4–6 per row |
| Actions | 1 primary full-width + "more" | primary + 2 secondary | toolbar with labels |
| Navigation inside widget | segmented control / tabs (≤ 4) | tabs | tabs or side list |

Write the spec as ASCII per class, e.g.:
```
compact (portrait)          expanded (landscape)
┌──────────────────┐        ┌──────────────┬─────────────────────┐
│ Title      [⋯]   │        │ List (40 %)  │ Detail (60 %)        │
│ [card]           │        │ [row] ▸      │ Title        [Edit]  │
│ [card]           │        │ [row]        │ fields (2 columns)   │
│ [Primary action] │        │              │                      │
└──────────────────┘        └──────────────┴─────────────────────┘
```

---

## 9. Adaptive content: text ↔ icon without losing meaning

| Width class | Buttons | Labels in fields | Table headers | Navigation |
|---|---|---|---|---|
| expanded / large | icon + full label | label above or beside | full | icon + label |
| medium | icon + full label (primary), icon + short label (secondary) | label above | short labels | icon + label |
| compact | primary: full label; secondary: icon + short label; rest in "more" | label above (never removed) | becomes card fields | icon + short label |
| xs | primary: short label; others icon-only **from the universal set** | label above | card fields | icon + 1-word label |

Rules: every icon-only control has an accessibility label (and a tooltip on web / long-press hint on native); never
icon-only for form labels, destructive actions or domain-specific actions; short labels are defined in the widget
(text template property `shortLabel`), not cut automatically.

---

## 10. Forms and the keyboard

| Platform | Rule |
|---|---|
| Native, full-screen form widget | `KeyboardAvoidingView` (`behavior={Platform.OS === "ios" ? "padding" : undefined}`; on Android 15+ edge-to-edge check that the focused field stays visible — if not, use `"padding"` too) around the only `ScrollView`; `keyboardShouldPersistTaps="handled"`; `keyboardDismissMode="interactive"` (iOS) |
| Native, embedded small form | ≤ 4 fields, placed high on the page; no own scroll; the page scrolls |
| Native, field focus | `returnKeyType="next"` → `nextRef.current?.focus()`; last field submits |
| Web | label above, `inputmode`, `autocomplete`; on focus on touch devices `scrollIntoView({ block: "center", behavior: "smooth" })`; avoid fixed bottom bars while an input is focused; use `100dvh` |
| Both | submit button inside the scroll content after the last field; errors under fields; disable submit while executing |
| Both | test: 320 px phone portrait + landscape, tablet portrait + landscape, with the keyboard open on every field |

---

## 11. Scrolling: one scroll owner

| Widget mode | Who scrolls | Widget rules |
|---|---|---|
| **Embedded** (most widgets: cards, forms, KPI, lists ≤ 50 rows) | the Mendix page | no vertical `ScrollView`/`FlatList`/`overflow:auto`; render rows with `map`; paging "Load more" button |
| **Full-screen** (widget fills the page; page has no scroll container) | the widget | exactly one vertical `FlatList`/`ScrollView`; headers/footers via `ListHeaderComponent`/`ListFooterComponent` |
| Horizontal strip (chips, carousel) | the strip, horizontally | fixed height, `showsHorizontalScrollIndicator={false}`, `nestedScrollEnabled` on Android |

React Native press rules: actions on `onPress` only; `Pressable` with `android_ripple` and pressed opacity; no
`TouchableWithoutFeedback` wrapping a scroll view; long lists → `FlatList` with `keyExtractor`; never a `FlatList`
inside a `ScrollView` of the same direction; dismiss keyboard on scroll with `keyboardDismissMode`.

---

## 12. Layers (z-index) and clipping

| Layer | Web z-index (inside widget) | Native | Use |
|---|---|---|---|
| base | auto | — | content |
| raised | 1 | `zIndex: 1, elevation: 1` | sticky header inside a full-screen widget |
| floating | 5 | `zIndex: 5, elevation: 6` | small badges, overlay button inside the widget box |
| popover | portal, 1060 | `Modal` / bottom sheet | menus, dropdowns, date pickers |
| dialog | portal, 1050 + scrim | `Modal` | confirmations |
| toast | portal, 1080 | `ToastAndroid` / Alert / own Modal | messages |

Rules: no absolutely positioned popup that leaves the widget box (clipped by `overflow:hidden` parents and Android
bounds); on Android a higher `elevation` draws on top — set `elevation` together with `zIndex`; reserve padding for
floating elements so they never cover text; never use global negative margins.

---

## 13. States

| State | Look |
|---|---|
| Loading (first) | skeleton blocks with the final layout, shimmer optional, spinner only for < 1 s actions |
| Loading (refresh) | keep content, small indicator |
| Empty | icon (muted), one sentence, optional primary action |
| Error | `danger` icon + sentence + Retry button; details only in diagnostic mode |
| Read-only | values as text |
| Disabled | `textDisabled`, no shadow, not focusable |
| Busy action | button shows spinner + disabled |
| Success | inline confirmation or toast; no modal for success |

---

## 14. Accessibility minimum

Labels and roles on every control; icon buttons labelled; focus visible (web); tap targets ≥ 44/48; contrast from the
token table; font scaling allowed; reading order = visual order; announce errors (`aria-live` / `accessibilityLiveRegion`).

---

## 15. QA matrix (run before "done")

| Device class | Size (portrait / landscape) | Check |
|---|---|---|
| Small phone | 320×568 / 568×320 | no overflow, labels, keyboard |
| Phone | 360×800, 390×844 / landscape | main layout |
| Large phone | 430×932 / landscape | |
| Small tablet | 600×960 / 960×600 | medium layout |
| Tablet | 768×1024, 820×1180 / landscape | expanded layout |
| Large tablet | 1024×1366 / 1366×1024 | |
| Laptop / desktop (web) | 1280×800, 1440×900, 1920×1080 | large layout, max width |

Per size: light + dark, font scale 100 % and 200 %, keyboard open on each field, long-text fixture, empty/loading/error
fixtures, Android + iOS for native. Web: `python mx.py preview <Module.Page>` gives phone/tablet/desktop pictures of the
page (approximate); widget-level screenshots with Playwright at the widths above.

---

## 16. Definition of done

| Check | ✔ |
|---|---|
| Risk table filled; every relevant row handled |  |
| Layout spec for xs/compact/medium/expanded/large + landscape written and implemented |  |
| Only tokens used; new colors checked with `tools/contrast.py` |  |
| Surface ladder respected; no black borders; shadows only on level 1/overlays |  |
| No nested vertical scroll; one scroll owner |  |
| No overlap/clipping; popups via portal/Modal |  |
| Forms visible with keyboard on phone + tablet, both orientations |  |
| Loading / empty / error / read-only / disabled states rendered and tested |  |
| Accessibility labels, tap targets, focus |  |
| QA matrix screenshots reviewed |  |
