import { decide, inspectResponse, isStorable, parseRules, stableStringify } from "../cacheRules";
import { FetchCache } from "../fetchCache";

// React Native's own fetch polyfill classes (the same Response the app has)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Response: WhatwgResponse } = require("whatwg-fetch");

const URL = "https://app.example.com/xas/";
const body = (o: object): string => JSON.stringify(o);
const op = (id: string, extra: object = {}): string =>
    body({ action: "runtimeOperation", operationId: id, params: { q: "x" }, changes: {}, objects: [], ...extra });
const CLEAN = JSON.stringify({
    actionResult: { type: "list", value: ["g1"] },
    objects: [{ guid: "g1", objectType: "M.Npe", attributes: {} }],
    instructions: [{ type: "push_to_client", args: { guids: ["g1"] } }]
});
const WRITE = JSON.stringify({ commits: ["g9"], objects: [] });

function makeResponse(text: string, status: number, headers: Record<string, string>): any {
    return new WhatwgResponse(text, { status, headers });
}

/** What the Mendix 10.24 client does with fetch (doFetch + ensureJsonResponse). */
async function mendixPost(fetchFn: any, payload: string): Promise<any> {
    const response = await fetchFn(URL, { method: "post", body: payload, headers: {} });
    if (response.status !== 200) {
        throw new Error(`server ${response.status}`);
    }
    return JSON.parse(await response.text());
}

function setup(
    responses: Record<string, string> = {},
    status = 200
): { cache: FetchCache; fetch: any; server: jest.Mock; t: { now: number } } {
    const t = { now: 0 };
    const server = jest.fn(async (_url: string, init: any) => {
        const b = JSON.parse(init.body);
        const text = responses[b.operationId ?? b.action] ?? "{}";
        return new WhatwgResponse(text, { status, headers: { "content-type": "application/json" } });
    });
    const cache = new FetchCache(makeResponse, () => t.now);
    cache.config = { enabled: true, rules: parseRules("opRead=30\nopRead2=5"), clearOn: "otherMicroflows" };
    return { cache, fetch: cache.wrap(server), server, t };
}

describe("rules", () => {
    it("parses opId=seconds, ignores wildcard, junk and caps at 600 s", () => {
        expect(parseRules("a=30\n* = 10\nb = 5s # comment\nbad\nc=99999;d=0")).toEqual([
            { operationId: "a", ttlMs: 30000 },
            { operationId: "b", ttlMs: 5000 },
            { operationId: "c", ttlMs: 600000 }
        ]);
    });

    it("decides per request", () => {
        const rules = parseRules("opRead=30");
        expect(decide("POST", URL, op("opRead"), rules).kind).toBe("cache");
        expect(decide("POST", URL, op("other"), rules).kind).toBe("watch");
        expect(decide("POST", URL, op("opRead", { changes: { g1: { Name: { value: "x" } } } }), rules).kind).toBe(
            "invalidate"
        );
        expect(decide("POST", URL, op("opRead", { asyncid: "a1" }), rules).kind).toBe("pass");
        expect(decide("POST", URL, body({ action: "keepalive", params: {} }), rules).kind).toBe("pass");
        for (const a of ["commit", "delete", "rollback", "synchronize_objects", "login", "logout"]) {
            expect(decide("POST", URL, body({ action: a }), rules).kind).toBe("invalidate");
        }
        expect(decide("GET", URL, undefined, rules).kind).toBe("pass");
        expect(decide("POST", "https://api.other.com/x", op("opRead"), rules).kind).toBe("pass");
        expect(decide("POST", URL, "not json", rules).kind).toBe("pass");
    });

    it("same request in another key order gives the same key", () => {
        const a = decide(
            "POST",
            URL,
            body({ action: "runtimeOperation", operationId: "opRead", params: { a: 1, b: 2 } }),
            parseRules("opRead=1")
        ).key;
        const b = decide(
            "POST",
            URL,
            body({ params: { b: 2, a: 1 }, operationId: "opRead", action: "runtimeOperation" }),
            parseRules("opRead=1")
        ).key;
        expect(a).toBe(b);
        expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    });

    it("only clean reads are storable", () => {
        expect(isStorable(200, CLEAN)).toBe(true);
        expect(isStorable(200, WRITE)).toBe(false);
        expect(isStorable(200, JSON.stringify({ instructions: [{ type: "text_message", args: {} }] }))).toBe(false);
        expect(isStorable(200, JSON.stringify({ instructions: [{ type: "download_file", args: {} }] }))).toBe(false);
        expect(isStorable(200, JSON.stringify({ datavalidation: [{ guid: "g" }] }))).toBe(false);
        expect(isStorable(500, CLEAN)).toBe(false);
        expect(isStorable(200, "<html>")).toBe(false);
        expect(inspectResponse(JSON.stringify({ newpersistable: ["g"] })).write).toBe(true);
    });
});

describe("FetchCache with the Mendix client's fetch use", () => {
    it("second call within TTL comes from memory, same JSON; after TTL goes to the server", async () => {
        const { fetch, server, t, cache } = setup({ opRead: CLEAN });
        const a = await mendixPost(fetch, op("opRead"));
        t.now = 29_000;
        const b = await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(1);
        expect(b).toEqual(a);
        expect(cache.stats.hits).toBe(1);
        t.now = 30_001;
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(2);
    });

    it("different parameters are different cache entries", async () => {
        const { fetch, server } = setup({ opRead: CLEAN });
        await mendixPost(fetch, op("opRead", { params: { q: "a" } }));
        await mendixPost(fetch, op("opRead", { params: { q: "b" } }));
        expect(server).toHaveBeenCalledTimes(2);
    });

    it("parallel identical calls go to the server once", async () => {
        const { fetch, server, cache } = setup({ opRead: CLEAN });
        const [a, b] = await Promise.all([mendixPost(fetch, op("opRead")), mendixPost(fetch, op("opRead"))]);
        expect(server).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
        expect(cache.stats.deduped).toBe(1);
    });

    it("a listed microflow that writes is never stored", async () => {
        const { fetch, server } = setup({ opRead: WRITE });
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(2);
    });

    it("writes mode: another microflow that writes clears the cache; one that only reads keeps it", async () => {
        const { fetch, server, cache } = setup({ opRead: CLEAN, opSave: WRITE, opOther: CLEAN });
        cache.config = { ...cache.config, clearOn: "writes" };
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opOther"));
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(2); // opRead, opOther; the second opRead came from the cache
        await mendixPost(fetch, op("opSave"));
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(4); // opSave wrote data: the cache was cleared, opRead went to the server
    });

    it("default: any other microflow clears first (a REST POST/PUT save without a Mendix commit)", async () => {
        const { fetch, server } = setup({ opRead: CLEAN, opRestSave: CLEAN });
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opRead")); // from the cache
        await mendixPost(fetch, op("opRestSave")); // answer looks clean, but it is not in the list
        await mendixPost(fetch, op("opRead")); // must be fresh
        expect(server.mock.calls.map(c => JSON.parse(c[1].body).operationId)).toEqual([
            "opRead",
            "opRestSave",
            "opRead"
        ]);
    });

    it("the app can clear the cache (refresh button, pull to refresh)", async () => {
        const { fetch, server, cache } = setup({ opRead: CLEAN });
        await mendixPost(fetch, op("opRead"));
        cache.invalidate("refresh button");
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(2);
    });

    it("device clock going back makes the entry stale", async () => {
        const { fetch, server, t } = setup({ opRead: CLEAN });
        t.now = 100_000;
        await mendixPost(fetch, op("opRead"));
        t.now = 50_000;
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(2);
    });

    it.each(["commit", "delete", "synchronize_objects", "login", "logout"])("%s clears the cache", async action => {
        const { fetch, server } = setup({ opRead: CLEAN });
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, body({ action, params: {} }));
        await mendixPost(fetch, op("opRead"));
        expect(server.mock.calls.filter(c => JSON.parse(c[1].body).operationId === "opRead")).toHaveLength(2);
    });

    it("server errors are not stored and reach Mendix as before", async () => {
        const { fetch, server } = setup({ opRead: CLEAN }, 500);
        await expect(mendixPost(fetch, op("opRead"))).rejects.toThrow("server 500");
        await expect(mendixPost(fetch, op("opRead"))).rejects.toThrow("server 500");
        expect(server).toHaveBeenCalledTimes(2);
    });

    it("network failure is passed through (no stale answer invented)", async () => {
        const { cache } = setup();
        const failing = cache.wrap(async () => {
            throw new TypeError("Network request failed");
        });
        await expect(mendixPost(failing, op("opRead"))).rejects.toThrow("Network request failed");
    });

    it("a response that arrives after an invalidation is not stored", async () => {
        const t = { now: 0 };
        let release: (v?: unknown) => void = () => undefined;
        let blocked = false;
        const server = jest.fn(async (_u: string, init: any) => {
            const b = JSON.parse(init.body);
            if (b.operationId === "opRead" && !blocked) {
                blocked = true; // only the first call is slow
                await new Promise(r => (release = r));
            }
            return new WhatwgResponse(b.action === "commit" ? "{}" : CLEAN, { status: 200 });
        });
        const cache = new FetchCache(makeResponse, () => t.now);
        cache.config = { enabled: true, rules: parseRules("opRead=30"), clearOn: "otherMicroflows" };
        const f = cache.wrap(server);
        const slow = mendixPost(f, op("opRead"));
        await mendixPost(f, body({ action: "commit" }));
        release();
        await slow;
        await mendixPost(f, op("opRead"));
        expect(server.mock.calls.filter(c => JSON.parse(c[1].body).operationId === "opRead")).toHaveLength(2);
    });

    it("disabled: everything goes to the server", async () => {
        const { fetch, server, cache } = setup({ opRead: CLEAN });
        cache.config = { ...cache.config, enabled: false };
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(2);
    });

    it("records seen microflows for the diagnostic list", async () => {
        const { fetch, cache } = setup({ opRead: CLEAN, opOther: WRITE });
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opOther"));
        expect(cache.stats.seen.get("opRead")?.clean).toBe(true);
        expect(cache.stats.seen.get("opOther")?.clean).toBe(false);
    });
});
