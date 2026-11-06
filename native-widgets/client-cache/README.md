# ClientCache (native) — React-Query-like cache for read-only microflow calls

Repeated calls of **chosen read-only microflows** (for example the ones that call REST) are answered from memory for a
few seconds instead of going to the server. Put it **once on each layout** (in the same snippet as NetworkActivity).
Package: `dist/1.0.0/dumpit.ClientCache.mpk`.

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
| Another microflow that writes (seen in its answer) | cache cleared |
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

## Second layer: cache the REST answer on the server (all users)

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
npm install && npm run release   # npm test: 21 tests (Mendix fetch use simulated with React Native's Response)
```
