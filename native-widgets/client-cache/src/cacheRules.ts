// Pure rules of the client response cache for Mendix runtime calls (POST <app>/xas/).
// Request bodies verified in the Mendix 10.24.13 native client:
//   { action: "runtimeOperation", operationId, params, asyncid, validationGuids, changes, objects }
//   { action: "keepalive" | "commit" | "delete" | "rollback" | "synchronize_objects" | "login" | "logout" | ... }

export interface CacheRule {
    /** operationId of the microflow call (see the diagnostic list). No wildcard: a microflow can have side effects. */
    operationId: string;
    ttlMs: number;
}

export interface Decision {
    /** cache: listed read; auto: candidate in automatic mode; watch: microflow that is not cached (may change data);
     *  pass: not a microflow call; invalidate: a write action */
    kind: "cache" | "auto" | "watch" | "pass" | "invalidate";
    key?: string;
    ttlMs?: number;
    opId?: string;
    reason: string;
}

const WRITE_ACTIONS = new Set([
    "commit",
    "delete",
    "rollback",
    "synchronize_objects",
    "login",
    "logout",
    "instantiate",
    "create_guids",
    "change"
]);

const MAX_TTL_MS = 10 * 60_000;

/** "opId=30" lines (seconds); "#" comments; invalid lines skipped. */
export function parseRules(text: string | undefined): CacheRule[] {
    const out: CacheRule[] = [];
    for (const raw of (text ?? "").split(/\r?\n|;/)) {
        const line = raw.replace(/#.*/, "").trim();
        const m = /^([^=\s]+)\s*=\s*(\d+(?:\.\d+)?)\s*s?$/i.exec(line);
        if (m && m[1] !== "*") {
            // 0 = never cache this microflow (also in automatic mode)
            out.push({ operationId: m[1], ttlMs: Math.min(MAX_TTL_MS, Math.round(parseFloat(m[2]) * 1000)) });
        }
    }
    return out;
}

function isEmpty(v: unknown): boolean {
    if (v == null) {
        return true;
    }
    if (Array.isArray(v)) {
        return v.length === 0;
    }
    return typeof v === "object" && Object.keys(v as object).length === 0;
}

/** Stable JSON: object keys sorted, so equal requests give equal keys. */
export function stableStringify(v: unknown): string {
    if (v === null || typeof v !== "object") {
        return JSON.stringify(v) ?? "null";
    }
    if (Array.isArray(v)) {
        return `[${v.map(stableStringify).join(",")}]`;
    }
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
        .sort()
        .filter(k => o[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
        .join(",")}}`;
}

export function isRuntimeUrl(url: string): boolean {
    return /\/xas\/?(\?|$)/.test(url);
}

/**
 * What to do with one request.
 * cache:      a whitelisted microflow call without unsent client changes and not async.
 * invalidate: anything that can change data (non-whitelisted microflow, commit, delete, sync, login/logout).
 * pass:       everything else (keepalive, logs, OTA, files, other hosts).
 */
export interface DecideOptions {
    /** auto: every microflow is a candidate (the response decides); list: only listed microflows */
    mode: "auto" | "list";
    autoTtlMs: number;
}

export function decide(
    method: string,
    url: string,
    bodyText: string | undefined,
    rules: CacheRule[],
    options: DecideOptions = { mode: "list", autoTtlMs: 30_000 }
): Decision {
    if (method.toUpperCase() !== "POST" || !isRuntimeUrl(url)) {
        return { kind: "pass", reason: "not a runtime call" };
    }
    let body: any;
    try {
        body = typeof bodyText === "string" ? JSON.parse(bodyText) : undefined;
    } catch {
        return { kind: "pass", reason: "body is not JSON" };
    }
    const action = body?.action;
    if (typeof action !== "string") {
        return { kind: "pass", reason: "no action" };
    }
    if (action !== "runtimeOperation") {
        return WRITE_ACTIONS.has(action)
            ? { kind: "invalidate", reason: `action ${action}` }
            : { kind: "pass", reason: `action ${action}` };
    }
    const opId = String(body.operationId);
    const rule = rules.find(r => r.operationId === body.operationId);
    const auto = options.mode === "auto";
    if (rule?.ttlMs === 0) {
        return { kind: "watch", opId, reason: "excluded (=0)" };
    }
    if (!rule && !auto) {
        return { kind: "watch", opId, reason: "microflow not in the cache list" };
    }
    if (body.asyncid != null && body.asyncid !== "") {
        return auto && !rule
            ? { kind: "watch", opId, reason: "async microflow" }
            : { kind: "pass", reason: "async microflow" };
    }
    if (!isEmpty(body.changes)) {
        return { kind: "invalidate", reason: "request carries unsent changes" };
    }
    const key = stableStringify({ op: body.operationId, params: body.params ?? null, objects: body.objects ?? null });
    return rule
        ? { kind: "cache", key, ttlMs: rule.ttlMs, opId, reason: "listed" }
        : { kind: "auto", key, ttlMs: options.autoTtlMs, opId, reason: "automatic candidate" };
}

// Response fields (Mendix 10.24.13 client): actionResult, objects, changes, resets, commits, deletes, newpersistable,
// committedObjectsOmitted, instructions, datavalidation. Data-only instructions are safe to replay.
const DATA_INSTRUCTIONS = new Set(["push_to_client", "refresh_class", "refresh_object_list"]);

export interface ResponseInfo {
    json: boolean;
    write: boolean; // the server committed, deleted or created persistable objects
    sideEffects: string[]; // instruction types that are not data refreshes (message, download, logout, ...)
    validation: boolean;
}

export function inspectResponse(text: string): ResponseInfo {
    try {
        const j = JSON.parse(text);
        if (!j || typeof j !== "object") {
            return { json: false, write: false, sideEffects: [], validation: false };
        }
        const types: string[] = Array.isArray(j.instructions)
            ? j.instructions.map((i: any) => String(i?.type ?? "?"))
            : [];
        return {
            json: true,
            write:
                !isEmpty(j.commits) || !isEmpty(j.deletes) || !isEmpty(j.newpersistable) || !!j.committedObjectsOmitted,
            sideEffects: types.filter(t => !DATA_INSTRUCTIONS.has(t)),
            validation: !isEmpty(j.datavalidation)
        };
    } catch {
        return { json: false, write: false, sideEffects: [], validation: false };
    }
}

/** The microflow returned something (a value or objects). A microflow called for a side effect usually returns nothing. */
export function returnsData(text: string): boolean {
    try {
        const j = JSON.parse(text);
        const v = j?.actionResult?.value;
        const hasValue = v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
        return hasValue || (Array.isArray(j?.objects) && j.objects.length > 0);
    } catch {
        return false;
    }
}

/** Stored only when: status 200, JSON, no write, no side-effect instruction, no validation message, < 2 MB. */
export function isStorable(status: number, text: string): boolean {
    if (status !== 200 || text.length > 2_000_000) {
        return false;
    }
    const r = inspectResponse(text);
    return r.json && !r.write && r.sideEffects.length === 0 && !r.validation;
}

export interface Entry {
    text: string;
    headers: Record<string, string>;
    storedAt: number;
    expiresAt: number;
    hits: number;
}

/** TTL store with a size limit (least recently stored entries leave first). */
export class ResponseStore {
    private map = new Map<string, Entry>();
    constructor(private now: () => number = () => Date.now(), private maxEntries = 100) {}

    get(key: string): Entry | undefined {
        const e = this.map.get(key);
        if (!e) {
            return undefined;
        }
        const t = this.now();
        // expired, or the device clock went back (then the age is unknown): treat as stale
        if (e.expiresAt <= t || t < e.storedAt) {
            this.map.delete(key);
            return undefined;
        }
        e.hits++;
        return e;
    }

    set(key: string, text: string, headers: Record<string, string>, ttlMs: number): void {
        const t = this.now();
        this.map.delete(key);
        this.map.set(key, { text, headers, storedAt: t, expiresAt: t + ttlMs, hits: 0 });
        while (this.map.size > this.maxEntries) {
            const first = this.map.keys().next().value as string;
            this.map.delete(first);
        }
    }

    clear(): number {
        const n = this.map.size;
        this.map.clear();
        return n;
    }

    get size(): number {
        return this.map.size;
    }
}
