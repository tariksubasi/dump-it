# ClientCache (native) — automatic client cache for Mendix microflow calls

Put it **once on each layout** (in the same snippet as NetworkActivity). Nothing else: no list, no JavaScript action,
no change to pages or flows. Package: `dist/1.1.1/dumpit.ClientCache.mpk`.

## Automatic mode (default) — what the user gets

| Moment | Result |
|---|---|
| Opens a page again / goes back / switches tab within 30 s | its data loads come from memory: instant, no spinner |
| Taps anything on an open page (save, "Refresh data" in a pop-up, any button that calls a microflow) | the cache is cleared first, the call goes to the server: always fresh |
| Pull to refresh right after opening | the same call a second time goes to the server |
| Saves, syncs, logs in or out | cache cleared |
| Server error, no network | the same error as without the cache |

How it decides (no configuration):

| Rule | Why it is safe |
|---|---|
| Only loads in the first 3 s after a page opens use the cache | side effects (save, e-mail, REST POST) come from taps, not from page loads |
| Only microflows that **return data** are cached | microflows called for a side effect usually return nothing |
| Only clean reads (no commit/delete/new object, no message/download/logout instruction, no validation) | checked in every answer |
| A microflow that **once** writes, shows a message or a validation error is never cached again in the session | learns by itself |
| A page-load microflow that returns nothing clears the cache | it may have changed something |
| Any microflow call on an open page clears the cache before it runs | the user always sees fresh data after doing something |
| Memory only, max 100 answers, 2 MB each, kept 30 s (setting *Keep answers*) | |

Optional, normally empty (*Advanced → Exceptions*): `operationId=0` never caches that microflow, `operationId=60` keeps it 60 s.
List mode (*Mode = Only listed microflows*) keeps the 1.0 behavior.

## How it works (verified in the Mendix 10.24.13 native client source)

| Fact from the client code | Use |
|---|---|
| Every runtime call is `window.fetch(<app>/xas/, POST JSON)`, read as status 200 → `response.text()` → `JSON.parse` | the widget wraps `fetch` once and can answer with a stored text |
| A microflow call body is `{ action: "runtimeOperation", operationId, params, asyncid, validationGuids, changes, objects }` | cache key = operationId + params + objects (stable JSON) |
| The response has `actionResult`, `objects`, `instructions`, `commits`, `deletes`, `newpersistable`, `datavalidation` | a response is replayable only when it is a clean read (below) |
| The client adds response objects to its cache per call and releases them after | caching the *response* (not JS object references) is the safe level |
| `keepalive` runs on a timer | never cached, never counted |

## Rules

| Situation | What happens |
|---|---|
| Page opens / user goes back (first 3 s, setting *Page open window*), listed microflow, same params/objects, within TTL | answered from memory (no network, no NetworkActivity overlay) |
| The same call again right after opening (pull to refresh) | server — a call is answered from the cache at most once per page opening |
| A tap later on an open page (refresh button, also in a pop-up) | server, fresh |
| Setting *Use the cache for = Always* | every listed call within the TTL comes from memory (then use the optional JS action below for refresh buttons) |
| Two identical listed calls at the same time | one server call, both get the answer |
| Listed microflow, but the answer **writes** (`commits`, `deletes`, `newpersistable`) or has a side-effect instruction (message, download, logout, show login) or a validation message | not stored; the cache is cleared when it wrote |
| Listed microflow with unsent client changes (`changes`) or async (`asyncid`) | goes to the server |
| **Any microflow that is not in the list** (default "On any other microflow") | cache cleared **before** it runs — covers saves that only call a REST POST/PUT and commit nothing in Mendix |
| Another microflow that writes (seen in its answer) — mode "Only on writes" | cache cleared |
| Refresh button / pull to refresh | fresh by default (page-open rule); nothing to add |
| Device clock set back | entry treated as stale |
| `commit`, `delete`, `rollback`, `synchronize_objects`, `login`, `logout` | cache cleared |
| Server error, network error | passed to Mendix unchanged; nothing stored, nothing invented |
| An answer that arrives after a clear | not stored |
| App restart | memory only: empty cache |
| Limits | TTL max 600 s, 100 entries, 2 MB per answer |

Not cached on purpose: microflows you did not list (they may send e-mails or call write APIs on the server — that
is not visible in the answer), so there is **no wildcard**.

## Setup

1. Put the widget in the layout snippet; **Diagnostic mode = Yes**.
2. Run the app, use the screen that calls the REST microflow twice.
3. Tap the **Cache** label: the list shows each microflow call with its `operationId`, time, size and
   `clean read` / `NOT cacheable`.
4. Copy the ids marked `clean read` into **Cached microflows**, one per line: `3f2a…=30`.
5. Diagnostic mode = No before release.

## Optional (only with *Use the cache for = Always*): JavaScript action `ClearClientCache`

Not needed with the default. Create a JavaScript action without parameters and put one line between the markers:

```js
export async function ClearClientCache() {
	// BEGIN USER CODE
	globalThis.dumpitClientCache?.clear("refresh");
	// END USER CODE
}
```

Call it first in the nanoflow of a refresh button or a pull-to-refresh, then call the microflow: the user always gets
fresh data when they ask for it. Without the ClientCache widget the line does nothing.

## What the user experiences (edge cases)

| Situation | Experience |
|---|---|
| Opens a screen again within the TTL | instant, no spinner |
| Saved something (any other microflow, commit, sync) | next read is fresh |
| Taps Refresh / pulls to refresh, also in a pop-up | fresh (default) |
| Another user changed the data | visible after the TTL at the latest — keep TTL short (10–30 s) on screens where this matters |
| Server error / no network | the same error as without the cache (no old data pretending to be new) |
| Log out / log in as someone else | cache cleared |
| Validation message from the microflow | never cached, always shown |
| Answers with a message, download or page change | never cached |
| Something looks wrong | `Enabled = false` (or an expression) turns it off at once |

## Second layer: cache the REST answer on the server (all users)

Only for REST **GET** (or other idempotent reads). Never cache POST/PUT/PATCH/DELETE calls.

`Call REST` runs in a microflow on the server, so the external API can be cached there too, with standard Mendix only:

| Step | Microflow action |
|---|---|
| 1 | Entity `RestCacheEntry` (persistable): `Key` (String 400, indexed), `Body` (String unlimited), `ExpiresAt` (DateTime) |
| 2 | Retrieve `RestCacheEntry[Key = $Key and ExpiresAt > '[%CurrentDateTime%]']` (first) |
| 3 | Found → `Import with mapping` from `$Entry/Body` (String) → return |
| 4 | Not found → `Call REST` with **response: store in a String** → create/commit `RestCacheEntry` (`ExpiresAt = addSeconds([%CurrentDateTime%], 30)`) → `Import with mapping` from the String |
| 5 | Scheduled event: delete expired entries |
| Key | URL + query + body; add the user (or token) when the API answers per user |

dump-it can build this (`createEntity`, `callRest` with `"response": "string"`, `importWithMapping` from a String
variable) through the normal dry run + approval code.

```bash
npm install && npm run release   # npm test: 40 tests (Mendix fetch use simulated with React Native's Response)
```
