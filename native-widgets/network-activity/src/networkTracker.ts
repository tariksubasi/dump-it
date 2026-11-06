// Counts the HTTP requests in flight by wrapping XMLHttpRequest.prototype (React Native's fetch uses it too).
// Pure TypeScript: no React Native import, so it is unit-tested with a fake XHR class.

export interface RequestInfo {
    id: number;
    method: string;
    url: string;
    body: string; // first 300 characters, for ignore patterns and diagnostics
    startedAt: number;
}

type Listener = (busyCount: number) => void;

export interface TrackerOptions {
    /** A request still open after this time is dropped from the count (lost callback). */
    requestTimeoutMs: number;
    /** Requests whose "METHOD url body" matches one of these are not counted. */
    ignore: RegExp[];
    now: () => number;
}

export class NetworkTracker {
    private open = new Map<number, RequestInfo>();
    private listeners = new Set<Listener>();
    private nextId = 1;
    readonly recent: Array<RequestInfo & { endedAt?: number; outcome?: string; ignored?: boolean }> = [];
    options: TrackerOptions = { requestTimeoutMs: 60_000, ignore: [], now: () => Date.now() };

    get busy(): number {
        this.dropLost();
        return this.open.size;
    }

    subscribe(fn: Listener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    isIgnored(method: string, url: string, body: string): boolean {
        const text = `${method} ${url} ${body}`;
        return this.options.ignore.some(r => {
            r.lastIndex = 0;
            return r.test(text);
        });
    }

    /** Returns an id, or 0 when the request is ignored. */
    start(method: string, url: string, body: string): number {
        const info: RequestInfo = { id: this.nextId++, method, url, body, startedAt: this.options.now() };
        const ignored = this.isIgnored(method, url, body);
        this.remember({ ...info, ignored });
        if (ignored) {
            return 0;
        }
        this.open.set(info.id, info);
        this.emit();
        return info.id;
    }

    end(id: number, outcome: string): void {
        const entry = this.recent.find(r => r.id === id);
        if (entry && entry.endedAt === undefined) {
            entry.endedAt = this.options.now();
            entry.outcome = outcome;
        }
        if (id && this.open.delete(id)) {
            this.emit();
        }
    }

    /** Requests that never finished (lost native callback) must not block the app forever. */
    dropLost(): boolean {
        const limit = this.options.now() - this.options.requestTimeoutMs;
        let dropped = false;
        for (const [id, r] of this.open) {
            if (r.startedAt < limit) {
                this.open.delete(id);
                this.end(id, "dropped (timeout)");
                dropped = true;
            }
        }
        return dropped;
    }

    reset(): void {
        this.open.clear();
        this.emit();
    }

    private remember(r: RequestInfo & { ignored?: boolean }): void {
        this.recent.push(r);
        if (this.recent.length > 15) {
            this.recent.shift();
        }
    }

    private emit(): void {
        const n = this.open.size;
        this.listeners.forEach(l => {
            try {
                l(n);
            } catch {
                // a listener must never break networking
            }
        });
    }
}

/** Parse the ignore list: one regular expression per line; invalid lines are skipped. */
export function parsePatterns(text: string | undefined): RegExp[] {
    return (text ?? "")
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => {
            try {
                return new RegExp(l, "i");
            } catch {
                return undefined;
            }
        })
        .filter((r): r is RegExp => !!r);
}

function bodyText(body: unknown): string {
    if (typeof body === "string") {
        return body.slice(0, 300);
    }
    return body == null ? "" : `[${typeof body}]`;
}

const PATCHED = "__networkActivityPatched";

interface XhrLike {
    addEventListener(type: string, fn: () => void): void;
}
interface XhrClass {
    prototype: {
        open: (...args: any[]) => unknown;
        send: (...args: any[]) => unknown;
    };
}

/**
 * Wrap open/send once (idempotent). Every counted request ends exactly once, on "loadend"
 * (React Native fires it after load, error, timeout and abort) or when send throws.
 * Any error in our code is swallowed: networking always continues.
 */
export function patchXhr(Xhr: XhrClass | undefined, tracker: NetworkTracker): boolean {
    if (!Xhr || !Xhr.prototype || (Xhr.prototype as any)[PATCHED]) {
        return false;
    }
    const proto = Xhr.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    proto.open = function (this: any, ...args: any[]) {
        try {
            this.__naMethod = String(args[0] ?? "GET").toUpperCase();
            this.__naUrl = String(args[1] ?? "");
        } catch {
            // ignore
        }
        return origOpen.apply(this, args);
    };
    proto.send = function (this: XhrLike & Record<string, any>, ...args: any[]) {
        let id = 0;
        let done = false;
        const finish = (outcome: string): void => {
            if (!done) {
                done = true;
                tracker.end(id, outcome);
            }
        };
        try {
            id = tracker.start(this.__naMethod ?? "GET", this.__naUrl ?? "", bodyText(args[0]));
            if (id) {
                for (const type of ["load", "error", "timeout", "abort"]) {
                    this.addEventListener(type, () => (this.__naOutcome = type));
                }
                this.addEventListener("loadend", () => finish(this.__naOutcome ?? "loadend"));
            }
        } catch {
            // ignore: never block the request
        }
        try {
            return origSend.apply(this, args);
        } catch (e) {
            finish("send threw");
            throw e;
        }
    };
    (proto as any)[PATCHED] = true;
    return true;
}
