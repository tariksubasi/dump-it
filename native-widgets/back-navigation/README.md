# Back navigation — Mendix native widget

Android hardware back + iOS swipe back. Put it on a page. No UI.

- There is a previous page → go to it.
- There is no previous page → normal system behavior (or the option you select).

Previous page means (Android back):

1. Close the open pop-up or the page opened with *Show page* inside the current tab.
2. **Back between tabs** (property):
   - *Previous tab, then home tab* (default): Ana Sayfa → Profilim → Menü → back → Profilim → back → Ana Sayfa → back → leave.
     Each tab is in the history once (A→B→A→B is A, B), so back never loops and ends in at most 5 presses.
   - *Home tab*: any tab → Ana Sayfa → leave (Android guideline).
   - *Mendix default*: React Navigation goes to the FIRST tab (Görevlerim), because Mendix sets no backBehavior.
3. On the home tab: the "On the first page" behavior (normal leave, press twice, block, or an action).

The home tab is the first tab the app shows (the Mendix home page). Put the widget on the bottom bar **layout**
so every tab visit is recorded.

Built for: Mendix 10.24.x, Native Template 14.x (React Native 0.77), React Navigation 6/7 API.

## Install

1. Copy `dist/1.0.5/dumpit.BackNavigation.mpk` to `<your app>/widgets/`.
2. In Studio Pro: **App → Synchronize App Directory** (F4).
3. Drag **Back navigation** (category *Navigation*) onto a native page or onto the native layout.
   Put it on the layout to cover every page with one widget.
4. Build the app again (Native Builder or `native-template` + Android Studio / Xcode).
   A JS-only widget needs no new native dependencies, so the Make It Native app also works.

## Properties

| Property | Default | Meaning |
|---|---|---|
| Enabled | `true` | `false` → widget does nothing |
| Custom back action | empty | Runs instead of "previous page". iOS swipe is off while set |
| iOS swipe back | yes | Edge swipe on iOS goes back |
| Repeat guard (ms) | 400 | Ignore a second press inside this time |
| On the first page | Normal system | System / Press twice / Do nothing / Run an action |
| First page action | empty | For "Run an action" (Studio Pro shows an error if empty) |
| Exit hint | "Press back again to exit" | Toast for "Press twice" |
| Ask before leaving | `false` | Expression, e.g. `$currentObject/HasChanges`. iOS swipe is off while true |
| Title / Message / Leave / Stay | TR + EN | Confirm dialog texts |

## Edge cases

| Case | Behavior |
|---|---|
| Widget on many pages in the stack | Only the focused page reacts (subscribe on focus, remove on blur) |
| Widget on layout + page | Last focused handler wins; both do the same, no double back |
| Fast double press | Repeat guard swallows the second press |
| Custom action still running | Press is swallowed, no second run |
| Custom action has no access | Falls back to normal back |
| Dialog already open | Back press is swallowed; Android back closes the dialog (cancelable) |
| No navigator context | Widget returns `false` → Mendix default runs |
| Any runtime error | Caught, logged, default behavior runs |
| Expression still loading | Treated as default (enabled, no confirm) |
| Pop-up page | `goBack()` closes the pop-up |
| Bottom tabs | Tab stack first, then the previous tab, then the home tab, then leave |
| Tab visited again (A→B→A→B) | Kept once, back cannot loop |
| App opened on a non-home tab (deep link, push notification) | History runs out → home tab → leave |
| A tab has open pages when you leave it | Coming back shows them; back closes them first |
| A tab page without the widget | Its visit is not recorded; put the widget on the layout |
| Logout / new bottom bar | Tab history resets |
| iOS header back button | Not intercepted (Mendix handles it) |
| Save button "close page" | Not intercepted (no false confirm after save) |

## Develop

```
npm install
npm test      # 20 unit tests for the decision logic
npm run lint
npm run release   # → dist/1.0.5/dumpit.BackNavigation.mpk
```
