# HTML viewer (Mendix native pluggable widget)

Shows HTML on a Mendix native page (Mendix 10.24, Native Template 14, React Native 0.77).

- Images, tables, code and long words fit the width. The page never scrolls sideways.
- Works on phones and tablets, in portrait and landscape. A rotation measures the content again.
- Pinch zoom, and an optional full screen view with zoom.
- Size, padding, margin and text style come from the native theme (JS style).
- It survives network loss, broken images, crashes of the web process and bad HTML.

Package: `dist/1.0.5/dumpit.HtmlViewer.mpk`. Copy it to the `widgets` folder of the app, then press F4 in Studio Pro.

## Native dependency

The widget uses `react-native-webview` **13.15.0** (supports React Native 0.77). The mpk declares it, so the Mendix build adds it. Native Mobile Resources' "Web view" widget declares 13.13.2 or 13.16.1, depending on its version: when both are in the app, keep one version in the native template (see below).

| Where you run the app | What to do |
|---|---|
| Make It Native app | Nothing. The Web view module is in it. |
| Your own build (Build Native Mobile App) | Nothing. The build reads the dependency from the mpk. |
| Your own dev app / Native Template repo | Check that `react-native-webview` is in `package.json`. If not: `npm i react-native-webview@13.15.0`, `cd ios && pod install`, and build the app again. |

## Properties

| Group | Property | Default | Notes |
|---|---|---|---|
| Content | HTML | (required) | Expression. A fragment or a full document. |
| Content | Base URL | empty | For relative image and link addresses. |
| Content | Extra CSS | empty | Comes after the built-in CSS, so it wins. |
| Content | Run scripts in the HTML | No | No = scripts and `onclick` attributes are blocked by a nonce CSP. The viewer's own script still runs. |
| Size | Height | Fit content | Fit content: grows with the HTML, the page scrolls, **no nested scroll**. Fill parent: takes the parent or style height, scrolls inside. |
| Size | Maximum height | 0 | Fit content only. Taller content scrolls inside. |
| Size | Wide tables | Fit | Fit: columns shrink. Scroll sideways: the table box scrolls; the page does not. |
| Zoom | Zoom | Yes | Fill parent: pinch in place. Fit content: zoom in full screen. |
| Zoom | Full screen button | Yes | Always shown when Fit content + Zoom. |
| Zoom | Maximum zoom | 5 | 1 to 10 (clamped). |
| Links | On link tap | Open in the browser or app | Or: run an action (URL in "Store link in"), or do nothing. The viewer never navigates away. |
| Events | On load / On error | — | On load runs once per new HTML. |
| Network | Use cached images offline | Yes | Android cache mode `LOAD_CACHE_ELSE_NETWORK`. |
| Diagnostics | Diagnostic mode | No | After 4 s one dialog with everything (stays until OK; "Again in 5 s"); a render error also opens a dialog. Plus a yellow box above the content in every state (also loading, empty, no access): version, HTML status, size, HTML length, `<img>` and base64 count, escaped HTML, load and message counts, errors. |
| Texts | Empty, error, retry, link error, labels | en_US + tr_TR | Translatable. |

## Style (native theme)

```js
// theme/native/custom-variables.js or main.js
export const dumpit_htmlviewer_HtmlViewer = {
    container: { marginVertical: 8, padding: 12, borderRadius: 12, backgroundColor: "#fff",
                 elevation: 2, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    content: { fontSize: 15, lineHeight: 22, color: "#1f2933", linkColor: "#1565c0", padding: 0 },
    loadingIndicator: { color: "#5f6b7a" }
};
// One instance: a class in Studio Pro (Appearance > Class), e.g. "htmlCard":
export const htmlCard = { container: { height: 320 } }; // with Height = Fill parent
```

| Key | Type | Used for |
|---|---|---|
| `container` | ViewStyle | Margin, padding, border, background, shadow, `height` / `minHeight` / `maxHeight` / `flex`. Do not set `width: "100%"` with a margin (overflow); the default `alignSelf: "stretch"` fills the parent. |
| `content` | text style → CSS | `color`, `backgroundColor`, `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`, all `padding*`, plus `linkColor`. Unsafe values are dropped. |
| `loadingIndicator`, `empty`, `errorContainer`, `errorText`, `retryButton`, `retryText`, `fullscreenButton`, `fullscreenIcon`, `modal`, `modalHeader`, `closeIcon` | | The states and the full screen view. |

## Edge cases and errors

| # | Case | What the widget does | Proof |
|---|---|---|---|
| 1 | Image wider than the screen (attribute, CSS or inline px) | `max-width:100%`. With both sizes the ratio stays; `object-fit:contain` never stretches. | browser test, 5 sizes |
| 2 | Icon with only `height="20"` | Keeps 20 px (not blown up to the natural size). | browser test |
| 3 | `<div style="width:1200px">`, long URL, long word, `<pre>` line | `max-width`, `overflow-wrap:anywhere`, `pre-wrap`. | browser test |
| 4 | Wide table | Fit: fixed layout. Scroll: own sideways box. | browser test |
| 5 | iframe / video embed | Full width, 16:9, loads (iframe navigation allowed). | browser test |
| 6 | Rotation, split screen, tablet | New width → the page measures again → new height. | browser test |
| 7 | Content sized in `vh` (height loop) | `HeightGuard` stops after 30 changes in 3 s and keeps the height. | unit test |
| 8 | Fill parent inside a scroll container (no height) | Falls back to Fit content, warns in the log. | code |
| 9 | Widget width 0 at first | The web view mounts only after a real width, so no wrong first height. | code |
| 10 | Empty HTML, only `<p></p>` or `&nbsp;` | Shows the empty text, or nothing (takes no space). | unit test |
| 11 | HTML value still loading | Keeps the last HTML (no blink); spinner only the first time. | code |
| 12 | No context object | Treated as empty. | code |
| 13 | Full document with its own `<head>`, no doctype | Viewer head goes first, doctype added (standards mode). | unit + browser test |
| 14 | `<script>`, `onclick`, `javascript:` links | Blocked by a nonce CSP (scripts off). | browser test |
| 15 | Meta refresh, redirect, form post | Top-frame navigation is always blocked. | code |
| 16 | Link tap | Browser/app, or action with URL; double report → one action (1 s); `#anchor` stays in the page. | browser + unit test |
| 17 | `file:`, `intent:`, `data:` links, link without app | Not opened; a toast/alert says it cannot be opened. | unit test |
| 18 | No network: images fail | Grey box with alt text; retries at 3, 6, 12 … 60 s, on `online`, when the app comes to the front, and on tap. Android shows cached images offline. | browser test |
| 19 | Slow load | Spinner after 250 ms, never longer than 8 s. | code |
| 20 | Web process killed (Android `onRenderProcessGone`, iOS `onContentProcessDidTerminate`) | Reloads up to 3 times a minute, then error + retry button. The app does not crash. | code |
| 21 | Document load error | Error text + retry button + "On error" action. iOS cancel codes (-999, 102) are ignored. | code |
| 22 | JavaScript error inside the HTML | Logged as a warning, no crash. | code |
| 23 | Render error in the widget | Error boundary: error view + retry; the Mendix page stays alive. | code |
| 24 | Nested scrolling | Fit content: the web view does not scroll; zoom in full screen. Fill parent: `nestedScrollEnabled`. | design |
| 25 | Android back in full screen | Closes the full screen first (`onRequestClose`). | code |
| 26 | Full screen on iOS in landscape | `supportedOrientations` = all. | code |
| 27 | Status bar in full screen (Android edge-to-edge) | Header padded by the status bar height. | code |
| 28 | Full screen button over content | Small 36 px, soft shadow, top right, only after load; own `zIndex` inside the widget only. | design |
| 29 | Dark mode on the device | `color-scheme: light`; colors from the theme. | code |
| 30 | Files behind Mendix login (`/file?guid=`) | Not loaded (no session in the web view). Use public URLs or base64 `data:` images. | limit |
| 31a | The page never reports its height (script blocked, old WebView) | Measures again at load end, +1.5 s, +4 s; after 5 s shows the content in a scrollable box of 60 % of the screen, never an empty box. | code |
| 31b | Parent gives no width (row container) | Uses the screen width and warns. | code |
| 31 | Very large HTML (several MB) | Works, but slow on old phones. Keep it under 1 MB. | limit |

## Commands

```bash
npm install
npm run release        # XSD check + build -> dist/1.0.5/dumpit.HtmlViewer.mpk
npm test               # 54 unit + render tests
npm run test:browser   # 110 checks in Chromium at 320, 360, 768, 800 (landscape) and 1280 px
npm run lint
```
