# ClientCache (native) — React-Query-like cache for read-only microflow calls

Repeated calls of **chosen read-only microflows** (for example the ones that call REST) are answered from memory for a
few seconds instead of going to the server. Put it **once on each layout** (in the same snippet as NetworkActivity).
Package: `dist/1.0.1/dumpit.ClientCache.mpk`.

**GET only?** At HTTP level every Mendix microflow call is a `POST /xas/` (reads too), so an HTTP-GET rule would cache
nothing. "Read only" is decided by (1) your list — put there only microflows that **read** (REST **GET**) — and (2) the
answer itself: an answer that writes or has a side effect is never stored.

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
| Listed microflow (`operationId=seconds`), same params/objects, within TTL | answered from memory (no network, no NetworkActivity overlay) |
| Two identical listed calls at the same time | one server call, both get the answer |
| Listed microflow, but the answer **writes** (`commits`, `deletes`, `newpersistable`) or has a side-effect instruction (message, download, logout, show login) or a validation message | not stored; the cache is cleared when it wrote |
| Listed microflow with unsent client changes (`changes`) or async (`asyncid`) | goes to the server |
| **Any microflow that is not in the list** (default "On any other microflow") | cache cleared **before** it runs — covers saves that only call a REST POST/PUT and commit nothing in Mendix |
| Another microflow that writes (seen in its answer) — mode "Only on writes" | cache cleared |
| Refresh button / pull to refresh | add the JavaScript action below to the nanoflow before the call |
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

## Refresh buttons: JavaScript action `ClearClientCache`

Create a JavaScript action without parameters in Studio Pro and put one line between the user-code markers:

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
| Taps Refresh / pulls to refresh (with `ClearClientCache`) | fresh |
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
npm install && npm run release   # npm test: 25 tests (Mendix fetch use simulated with React Native's Response)
```
