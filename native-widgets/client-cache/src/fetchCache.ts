// Wraps window.fetch once. The Mendix 10.24 client calls window.fetch(url, init) for every runtime request
// (doFetch in the client), reads status 200 and then response.text() -> JSON.parse.
import { CacheRule, decide, fingerprint, inspectResponse, isStorable, ResponseStore, returnsData } from "./cacheRules";

export interface CacheStats {
    hits: number;
    misses: number;
    stored: number;
    invalidations: number;
    deduped: number;
    log: string[]; // last 20 decisions (for the diagnostic dialog)
    /** microflow calls seen: operationId -> last duration, size and whether the response was a clean read */
    seen: Map<string, { ms: number; bytes: number; clean: boolean; count: number }>;
}

export interface CacheConfig {
    enabled: boolean;
    rules: CacheRule[];
    /** otherMicroflows (safest): any microflow that is not in the list clears the cache before it runs.
     *  writes: only when its answer shows a write (commits, deletes, new objects). */
    clearOn: "otherMicroflows" | "writes";
    /** pageOpen: answer from the cache only for loads right after a page opens or the user goes back; a call made
     *  later on an open page (a refresh button, also in a pop-up) always goes to the server.
     *  always: within the TTL every listed call is answered from the cache. */
    useFor: "pageOpen" | "always";
    /** pageOpen: how long after a page opens its loads may use the cache */
    pageOpenWindowMs: number;
    /** auto: no list needed - page-open loads of microflows that return data and only read are cached;
     *  anything the user does on an open page clears the cache. list: only the listed microflows. */
    mode: "auto" | "list";
    autoTtlMs: number;
}

type FetchFn = (input: any, init?: any) => Promise<any>;

const PATCHED = "__clientCachePatched";

export class FetchCache {
    readonly store: ResponseStore;
    readonly stats: CacheStats = {
        hits: 0,
        misses: 0,
        stored: 0,
        invalidations: 0,
        deduped: 0,
        log: [],
        seen: new Map()
    };
    config: CacheConfig = {
        enabled: true,
        rules: [],
        clearOn: "otherMicroflows",
        useFor: "pageOpen",
        pageOpenWindowMs: 3000,
        mode: "auto",
        autoTtlMs: 30_000
    };
    /** microflows that wrote, had a side effect or a validation message: never cached again in this session */
    readonly learnedNever = new Set<string>();
    /** automatic mode: last answer fingerprint per request, and requests that answered the same twice */
    private fingerprints = new Map<string, string>();
    private provenKeys = new Set<string>();
    private windowUntil = Number.NEGATIVE_INFINITY;
    private servedInWindow = new Set<string>();
    private inflight = new Map<string, Promise<{ status: number; text: string; headers: Record<string, string> }>>();
    private generation = 0; // bumps on every invalidation: late responses of older requests are not stored

    constructor(
        private makeResponse: (text: string, status: number, headers: Record<string, string>) => any,
        private now: () => number = () => Date.now()
    ) {
        this.store = new ResponseStore(now);
    }

    /** A page opened or the user went back: its first loads may come from the cache. */
    markPageOpen(): void {
        this.windowUntil = this.now() + this.config.pageOpenWindowMs;
        this.servedInWindow.clear();
    }

    private inPageOpenWindow(): boolean {
        return this.now() <= this.windowUntil;
    }

    private mayServe(key: string, auto: boolean): boolean {
        if (!auto && this.config.useFor === "always") {
            return true;
        }
        // once per page opening: a second identical call right after opening is a refresh
        return this.inPageOpenWindow() && !this.servedInWindow.has(key);
    }

    private remember(opId: string | undefined, ms: number, status: number, text: string): void {
        if (!opId) {
            return;
        }
        const prev = this.stats.seen.get(opId);
        this.stats.seen.set(opId, {
            ms,
            bytes: text.length,
            clean: isStorable(status, text),
            count: (prev?.count ?? 0) + 1
        });
        if (this.stats.seen.size > 50) {
            this.stats.seen.delete(this.stats.seen.keys().next().value as string);
        }
    }

    note(line: string): void {
        this.stats.log.push(line);
        if (this.stats.log.length > 20) {
            this.stats.log.shift();
        }
    }

    invalidate(reason: string): void {
        this.generation++;
        const n = this.store.clear();
        this.inflight.clear();
        this.stats.invalidations++;
        if (n) {
            this.note(`cleared ${n} (${reason})`);
        }
    }

    /** Returns the wrapped fetch. */
    wrap(original: FetchFn): FetchFn {
        const wrapped: FetchFn = async (input, init) => {
            let decision;
            try {
                const url = typeof input === "string" ? input : String(input?.url ?? "");
                const method = String(init?.method ?? input?.method ?? "GET");
                const body = typeof init?.body === "string" ? init.body : undefined;
                decision = this.config.enabled
                    ? decide(method, url, body, this.config.rules, {
                          mode: this.config.mode,
                          autoTtlMs: this.config.autoTtlMs
                      })
                    : undefined;
                if (decision?.kind === "auto" && this.learnedNever.has(decision.opId as string)) {
                    decision = { kind: "watch", opId: decision.opId, reason: "learned: not a pure read" };
                }
            } catch {
                decision = undefined; // never break networking
            }
            if (!decision || decision.kind === "pass") {
                return original(input, init);
            }
            if (decision.kind === "invalidate") {
                this.invalidate(decision.reason);
                return original(input, init);
            }
            if (decision.kind === "watch") {
                // another microflow: it may change data on the server or in an external system (REST POST/PUT)
                if (this.config.mode === "auto" || this.config.clearOn === "otherMicroflows") {
                    this.invalidate(`microflow ${String(decision.opId).slice(0, 12)} is not in the list`);
                }
                const started = this.now();
                const res = await original(input, init);
                try {
                    const text: string = await res.clone().text();
                    this.remember(decision.opId, this.now() - started, res.status, text);
                    const info = inspectResponse(text);
                    if (info.write) {
                        this.invalidate(`microflow ${String(decision.opId).slice(0, 12)} wrote data`);
                    }
                } catch {
                    // a response we cannot read: be safe
                    this.invalidate("unreadable microflow response");
                }
                return res;
            }
            const key = decision.key as string;
            const auto = decision.kind === "auto";
            const pageLoad = this.inPageOpenWindow();
            if (auto && !pageLoad) {
                // a call on an open page = something the user did (save, refresh, a pop-up button): start clean
                this.invalidate("user action on an open page");
            }
            const hit = this.mayServe(key, auto) ? this.store.get(key) : undefined;
            if (hit) {
                this.servedInWindow.add(key);
                this.stats.hits++;
                this.note(`HIT ${shortKey(key)} (${hit.hits})`);
                return this.makeResponse(hit.text, 200, hit.headers);
            }
            // merge identical parallel calls only when they are proven reads (never two creates into one)
            const mayMerge = !auto || (pageLoad && this.provenKeys.has(key));
            const pending = mayMerge ? this.inflight.get(key) : undefined;
            if (pending) {
                this.stats.deduped++;
                const r = await pending;
                return this.makeResponse(r.text, r.status, r.headers);
            }
            this.stats.misses++;
            this.servedInWindow.add(key);
            const gen = this.generation;
            const started = this.now();
            const run = (async () => {
                const res = await original(input, init);
                const text: string = await res.text();
                this.remember(decision.opId, this.now() - started, res.status, text);
                const headers: Record<string, string> = {};
                try {
                    res.headers?.forEach?.((v: string, k: string) => (headers[k] = v));
                } catch {
                    // ignore
                }
                let storable = isStorable(res.status, text) && (!auto || returnsData(text));
                if (auto && storable) {
                    // automatic mode: cache only after the same request answered the same twice (a stable read)
                    const fp = fingerprint(text);
                    const stable = this.fingerprints.get(key) === fp;
                    this.fingerprints.delete(key);
                    this.fingerprints.set(key, fp);
                    if (this.fingerprints.size > 300) {
                        this.fingerprints.delete(this.fingerprints.keys().next().value as string);
                    }
                    if (stable) {
                        this.provenKeys.add(key);
                    } else {
                        this.provenKeys.delete(key);
                        storable = false;
                        this.note(`LEARN ${shortKey(key)} (needs the same answer twice)`);
                    }
                }
                if (gen === this.generation && storable) {
                    this.store.set(key, text, headers, decision.ttlMs as number);
                    this.stats.stored++;
                    this.note(`STORE ${shortKey(key)} ${Math.round((decision.ttlMs as number) / 1000)}s`);
                } else {
                    const info = inspectResponse(text);
                    if (info.write || info.sideEffects.length > 0 || info.validation) {
                        this.learnedNever.add(decision.opId as string);
                    }
                    if (info.write) {
                        this.invalidate("cached microflow wrote data");
                    } else if (auto && pageLoad && res.status === 200 && !returnsData(text)) {
                        // a page-load microflow that returns nothing may have done something: be safe
                        this.invalidate(`microflow ${String(decision.opId).slice(0, 12)} returned nothing`);
                    }
                    this.note(`MISS ${shortKey(key)} not stored (status ${res.status}${info.write ? ", write" : ""})`);
                }
                return { status: res.status, text, headers };
            })();
            this.inflight.set(key, run);
            try {
                const r = await run;
                return this.makeResponse(r.text, r.status, r.headers);
            } finally {
                this.inflight.delete(key);
            }
        };
        (wrapped as any)[PATCHED] = true;
        return wrapped;
    }
}

export function isWrapped(fn: unknown): boolean {
    return typeof fn === "function" && !!(fn as any)[PATCHED];
}

function shortKey(key: string): string {
    const m = /"op":"([^"]+)"/.exec(key);
    return m ? m[1].slice(0, 12) : key.slice(0, 12);
}
