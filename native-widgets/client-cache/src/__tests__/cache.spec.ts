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
    cache.config = {
        enabled: true,
        rules: parseRules("opRead=30\nopRead2=5"),
        clearOn: "otherMicroflows",
        useFor: "always",
        pageOpenWindowMs: 3000,
        mode: "list",
        autoTtlMs: 30000
    };
    return { cache, fetch: cache.wrap(server), server, t };
}

describe("rules", () => {
    it("parses opId=seconds (0 = never), ignores wildcard and junk, caps at 600 s", () => {
        expect(parseRules("a=30\n* = 10\nb = 5s # comment\nbad\nc=99999;d=0")).toEqual([
            { operationId: "a", ttlMs: 30000 },
            { operationId: "b", ttlMs: 5000 },
            { operationId: "c", ttlMs: 600000 },
            { operationId: "d", ttlMs: 0 }
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
        cache.config = {
            enabled: true,
            rules: parseRules("opRead=30"),
            clearOn: "otherMicroflows",
            useFor: "always",
            pageOpenWindowMs: 3000,
            mode: "list",
            autoTtlMs: 30000
        };
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

describe("use the cache only for page opens (default)", () => {
    function pageSetup(): ReturnType<typeof setup> {
        const r = setup({ opRead: CLEAN, opRead2: CLEAN });
        r.cache.config = { ...r.cache.config, useFor: "pageOpen", pageOpenWindowMs: 3000 };
        return r;
    }
    const ops = (server: jest.Mock): string[] => server.mock.calls.map(c => JSON.parse(c[1].body).operationId);

    it("page open loads come from the cache; a refresh tap on the open page goes to the server", async () => {
        const { fetch, server, cache, t } = pageSetup();
        cache.markPageOpen(); // first visit
        await mendixPost(fetch, op("opRead")); // miss, stored
        t.now = 10_000;
        cache.markPageOpen(); // user goes back to the page
        await mendixPost(fetch, op("opRead")); // hit
        expect(ops(server)).toEqual(["opRead"]);
        t.now = 15_000; // later: user taps "Refresh data" in a pop-up
        await mendixPost(fetch, op("opRead"));
        expect(ops(server)).toEqual(["opRead", "opRead"]);
    });

    it("the same call twice right after opening: the second is a refresh and goes to the server", async () => {
        const { fetch, server, cache, t } = pageSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opRead"));
        t.now = 20_000;
        cache.markPageOpen();
        await mendixPost(fetch, op("opRead")); // hit
        t.now = 20_500;
        await mendixPost(fetch, op("opRead")); // pull to refresh right away
        expect(ops(server)).toEqual(["opRead", "opRead"]);
    });

    it("several different loads of one page all use the cache", async () => {
        const { fetch, server, cache, t } = pageSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opRead2"));
        t.now = 4_000; // within the 5 s TTL of opRead2
        cache.markPageOpen();
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opRead2"));
        expect(ops(server)).toEqual(["opRead", "opRead2"]);
    });

    it("without a page open nothing is answered from the cache", async () => {
        const { fetch, server } = pageSetup();
        await mendixPost(fetch, op("opRead"));
        await mendixPost(fetch, op("opRead"));
        expect(server).toHaveBeenCalledTimes(2);
    });

    it("parallel identical loads still go to the server once", async () => {
        const { fetch, server, cache } = pageSetup();
        cache.markPageOpen();
        await Promise.all([mendixPost(fetch, op("opRead")), mendixPost(fetch, op("opRead"))]);
        expect(server).toHaveBeenCalledTimes(1);
    });
});

describe("automatic mode (no list)", () => {
    const VOID = JSON.stringify({ objects: [] });
    const MESSAGE = JSON.stringify({
        actionResult: { type: "string", value: "x" },
        instructions: [{ type: "text_message", args: {} }]
    });
    function autoSetup(extra: Record<string, string> = {}, rules = ""): ReturnType<typeof setup> {
        const r = setup({ opA: CLEAN, opB: CLEAN, opVoid: VOID, opWrite: WRITE, opMsg: MESSAGE, ...extra });
        r.cache.config = {
            ...r.cache.config,
            mode: "auto",
            rules: parseRules(rules),
            useFor: "always",
            autoTtlMs: 30000
        };
        return r;
    }
    const ops = (server: jest.Mock): string[] => server.mock.calls.map(c => JSON.parse(c[1].body).operationId);

    it("page-open loads that return data are cached without any list", async () => {
        const { fetch, server, cache, t } = autoSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opA"));
        await mendixPost(fetch, op("opB"));
        t.now = 10_000;
        cache.markPageOpen();
        await mendixPost(fetch, op("opA"));
        await mendixPost(fetch, op("opB"));
        expect(ops(server)).toEqual(["opA", "opB"]);
    });

    it("ignores 'Always': only page-open loads use the cache", async () => {
        const { fetch, server, cache } = autoSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opA"));
        // no page open now: a later call is a user action
        (cache as any).windowUntil = -1;
        await mendixPost(fetch, op("opA"));
        expect(ops(server)).toEqual(["opA", "opA"]);
    });

    it("any microflow call on an open page (user action) clears the cache first", async () => {
        const { fetch, server, cache, t } = autoSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opA"));
        t.now = 8_000; // page is open, user taps a button that calls opB (e.g. REST POST behind it)
        await mendixPost(fetch, op("opB"));
        t.now = 9_000;
        cache.markPageOpen(); // goes to another page and back
        await mendixPost(fetch, op("opA"));
        expect(ops(server)).toEqual(["opA", "opB", "opA"]);
    });

    it("a page-load microflow that returns nothing is not cached and clears the cache", async () => {
        const { fetch, server, cache, t } = autoSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opA"));
        await mendixPost(fetch, op("opVoid"));
        t.now = 5_000;
        cache.markPageOpen();
        await mendixPost(fetch, op("opA"));
        await mendixPost(fetch, op("opVoid"));
        expect(ops(server)).toEqual(["opA", "opVoid", "opA", "opVoid"]);
    });

    it("a microflow that wrote once is never cached again in the session", async () => {
        let first = true;
        const { cache, t } = autoSetup();
        const server = jest.fn(async (_u: string, init: any) => {
            const b = JSON.parse(init.body);
            const text = b.operationId === "opFlaky" ? (first ? WRITE : CLEAN) : CLEAN;
            if (b.operationId === "opFlaky") {
                first = false;
            }
            return new WhatwgResponse(text, { status: 200 });
        });
        const f = cache.wrap(server);
        for (let i = 0; i < 3; i++) {
            t.now = i * 5_000;
            cache.markPageOpen();
            await mendixPost(f, op("opFlaky"));
        }
        expect(server).toHaveBeenCalledTimes(3);
        expect(cache.learnedNever.has("opFlaky")).toBe(true);
    });

    it("a microflow that shows a message is learned as never-cache", async () => {
        const { fetch, server, cache, t } = autoSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opMsg"));
        t.now = 5_000;
        cache.markPageOpen();
        await mendixPost(fetch, op("opMsg"));
        expect(ops(server)).toEqual(["opMsg", "opMsg"]);
        expect(cache.learnedNever.has("opMsg")).toBe(true);
    });

    it("opId=0 excludes a microflow; opId=60 keeps it longer", async () => {
        const { fetch, server, cache, t } = autoSetup({}, "opA=0\nopB=60");
        cache.markPageOpen();
        await mendixPost(fetch, op("opA"));
        await mendixPost(fetch, op("opB"));
        t.now = 45_000; // after the 30 s default, within opB's 60 s
        cache.markPageOpen();
        await mendixPost(fetch, op("opB"));
        await mendixPost(fetch, op("opA"));
        expect(ops(server)).toEqual(["opA", "opB", "opA"]);
    });

    it("errors and unsent changes are handled as in list mode", async () => {
        const { fetch, server, cache } = autoSetup();
        cache.markPageOpen();
        await mendixPost(fetch, op("opA", { changes: { g1: { Name: { value: "x" } } } }));
        await mendixPost(fetch, op("opA", { changes: { g1: { Name: { value: "x" } } } }));
        expect(server).toHaveBeenCalledTimes(2);
    });
});
