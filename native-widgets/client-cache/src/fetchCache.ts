// Wraps window.fetch once. The Mendix 10.24 client calls window.fetch(url, init) for every runtime request
// (doFetch in the client), reads status 200 and then response.text() -> JSON.parse.
import { CacheRule, decide, inspectResponse, isStorable, ResponseStore } from "./cacheRules";

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
    config: CacheConfig = { enabled: true, rules: [] };
    private inflight = new Map<string, Promise<{ status: number; text: string; headers: Record<string, string> }>>();
    private generation = 0; // bumps on every invalidation: late responses of older requests are not stored

    constructor(
        private makeResponse: (text: string, status: number, headers: Record<string, string>) => any,
        private now: () => number = () => Date.now()
    ) {
        this.store = new ResponseStore(now);
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
                decision = this.config.enabled ? decide(method, url, body, this.config.rules) : undefined;
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
                // another microflow: run it, then clear the cache if its response shows a write
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
            const hit = this.store.get(key);
            if (hit) {
                this.stats.hits++;
                this.note(`HIT ${shortKey(key)} (${hit.hits})`);
                return this.makeResponse(hit.text, 200, hit.headers);
            }
            const pending = this.inflight.get(key);
            if (pending) {
                this.stats.deduped++;
                const r = await pending;
                return this.makeResponse(r.text, r.status, r.headers);
            }
            this.stats.misses++;
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
                if (gen === this.generation && isStorable(res.status, text)) {
                    this.store.set(key, text, headers, decision.ttlMs as number);
                    this.stats.stored++;
                    this.note(`STORE ${shortKey(key)} ${Math.round((decision.ttlMs as number) / 1000)}s`);
                } else {
                    const info = inspectResponse(text);
                    if (info.write) {
                        this.invalidate("cached microflow wrote data");
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
