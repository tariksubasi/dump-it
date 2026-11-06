# NetworkActivity (native)

A blocking, animated loading overlay that appears **by itself** while the app waits for the server — every microflow
call, retrieve, synchronize and REST call that goes through React Native networking (`XMLHttpRequest`, also used by
`fetch`). Put it **once on each layout** (with the BackNavigation widget). Package: `dist/1.2.0/dumpit.NetworkActivity.mpk`.

| Rule | Value (default) | Why |
|---|---|---|
| Show after | 400 ms | quick requests never flash the overlay |
| Minimum visible | 500 ms | no blink |
| Slow after | 8 s | text "This takes longer than usual…" + **Hide** button; Android back also hides (the message is hidden before that unless *Show message* = Yes) |
| Hide after | 30 s | hard limit: hides even if still busy; stays hidden until all requests end |
| Forget request after | 60 s | a request that never answers no longer counts (also checked every 5 s) |
| Ends on | any HTTP status (2xx, 3xx, 4xx, 5xx — tested 200…504), network error, timeout, abort, send exception, a Mendix handler that throws | React Native fires `loadend` for all of them and catches listener errors; tested on React Native's real `XMLHttpRequest` |
| Parallel requests | counted | hidden only when all are done |
| Ignore | regex on `METHOD url body`, default `symbolicate|:8081/|keepalive` | dev tools and background pings |
| Several layouts | one overlay | only the last focused instance draws it |
| Blocking | RN `Modal` + dim backdrop; Android back blocked until "slow" | no double taps during save |
| Indicator | **Minimal (default)**: small dark iOS-style indicator (12 bars, 28 pt) on a small white card, light dim behind; same on iOS and Android; turns on the UI thread, also with Android animations off. Options: one gradient ring, or the system spinner. Size 16–64 | properties *Indicator*, *Indicator size* |
| Accessibility | `progressbar` role, label = message, live region | |

Styles (native theme, `dumpit_networkactivity_NetworkActivity`): `backdrop`, `card`, `indicator.color`, `indicator.colorEnd` (gradient end), `indicator.trackColor`, `text`,
`button`, `buttonText`.

Diagnostic mode: logs the open request count and adds a **Details** link on the overlay with the last 15 requests
(method, path, outcome, duration, body start, IGNORED). Use it to tune the ignore list.

Limits: requests made by native modules with their own HTTP stack (image loading, WebView pages, some SDKs) are not
seen; offline nanoflows make no request, so no overlay (correct). Mendix's own "blocking progress" on a button can
show at the same time — set those buttons to "None" if you rely on this widget.

```bash
npm install && npm run release   # npm test: 44 tests (20 on React Native's real XMLHttpRequest)
```
