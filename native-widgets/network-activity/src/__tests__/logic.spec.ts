import { NetworkTracker, parsePatterns, patchXhr } from "../networkTracker";
import { OverlayController, OverlayState } from "../overlayController";
import * as registry from "../registry";
import { FakeXhr } from "./fakeXhr";

function setup(): { tracker: NetworkTracker; Xhr: typeof FakeXhr; t: { now: number } } {
    const t = { now: 0 };
    const tracker = new NetworkTracker();
    tracker.options = { requestTimeoutMs: 60_000, ignore: parsePatterns("symbolicate|keepalive"), now: () => t.now };
    class Xhr extends FakeXhr {}
    expect(patchXhr(Xhr as any, tracker)).toBe(true);
    return { tracker, Xhr, t };
}

function request(Xhr: typeof FakeXhr, url = "https://app/xas/", body = '{"action":"executeaction"}'): FakeXhr {
    const x = new Xhr();
    x.open("POST", url);
    x.send(body);
    return x;
}

describe("NetworkTracker + patchXhr", () => {
    it.each(["load", "error", "timeout", "abort"] as const)("counts a request until loadend after %s", outcome => {
        const { tracker, Xhr } = setup();
        const x = request(Xhr);
        expect(tracker.busy).toBe(1);
        x.finish(outcome);
        expect(tracker.busy).toBe(0);
        expect(tracker.recent[0].outcome).toBe(outcome);
    });

    it("counts parallel requests and ends each once", () => {
        const { tracker, Xhr } = setup();
        const a = request(Xhr);
        const b = request(Xhr);
        expect(tracker.busy).toBe(2);
        a.finish("load");
        a.fire("loadend"); // duplicate event: ignored
        expect(tracker.busy).toBe(1);
        b.finish("error");
        expect(tracker.busy).toBe(0);
    });

    it("ignores matching requests (url or body)", () => {
        const { tracker, Xhr } = setup();
        request(Xhr, "http://10.0.2.2:8081/symbolicate");
        request(Xhr, "https://app/xas/", '{"action":"keepalive"}');
        expect(tracker.busy).toBe(0);
        expect(tracker.recent.filter(r => r.ignored)).toHaveLength(2);
    });

    it("ends the request when send throws, and rethrows", () => {
        const { tracker, Xhr } = setup();
        const x = new Xhr();
        x.throwOnSend = true;
        x.open("GET", "https://app/x");
        expect(() => x.send()).toThrow("send failed");
        expect(tracker.busy).toBe(0);
    });

    it("forgets a request that never answers", () => {
        const { tracker, Xhr, t } = setup();
        request(Xhr);
        t.now = 59_000;
        expect(tracker.busy).toBe(1);
        t.now = 61_000;
        expect(tracker.busy).toBe(0);
        expect(tracker.recent[0].outcome).toBe("dropped (timeout)");
    });

    it("patches only once and survives a throwing listener", () => {
        const { tracker, Xhr } = setup();
        expect(patchXhr(Xhr as any, tracker)).toBe(false);
        tracker.subscribe(() => {
            throw new Error("bad listener");
        });
        const x = request(Xhr);
        expect(() => x.finish("load")).not.toThrow();
        expect(tracker.busy).toBe(0);
    });

    it("parses patterns, skips invalid ones", () => {
        expect(parsePatterns("a\n(\n\n b ").map(r => r.source)).toEqual(["a", "b"]);
        expect(parsePatterns(undefined)).toEqual([]);
    });
});

describe("OverlayController", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function make(): { c: OverlayController; states: OverlayState[] } {
        const states: OverlayState[] = [];
        const c = new OverlayController(
            { showDelayMs: 400, minVisibleMs: 500, slowAfterMs: 8000, maxVisibleMs: 30000 },
            s => states.push(s),
            () => Date.now()
        );
        return { c, states };
    }

    it("never shows for a quick request", () => {
        const { c, states } = make();
        c.setBusy(true);
        jest.advanceTimersByTime(399);
        c.setBusy(false);
        jest.advanceTimersByTime(5000);
        expect(states).toEqual([]);
    });

    it("shows after the delay and stays the minimum time", () => {
        const { c, states } = make();
        c.setBusy(true);
        jest.advanceTimersByTime(400);
        expect(c.state.phase).toBe("visible");
        jest.advanceTimersByTime(100);
        c.setBusy(false);
        jest.advanceTimersByTime(399);
        expect(c.state.phase).toBe("visible");
        jest.advanceTimersByTime(1);
        expect(c.state.phase).toBe("hidden");
        expect(states.map(s => s.phase)).toEqual(["visible", "hidden"]);
    });

    it("a new request during the minimum time keeps it visible", () => {
        const { c } = make();
        c.setBusy(true);
        jest.advanceTimersByTime(400);
        c.setBusy(false);
        jest.advanceTimersByTime(200);
        c.setBusy(true);
        jest.advanceTimersByTime(1000);
        expect(c.state.phase).toBe("visible");
    });

    it("slow text after 8 s, hard hide after 30 s, hidden until idle, then works again", () => {
        const { c } = make();
        c.setBusy(true);
        jest.advanceTimersByTime(400 + 8000);
        expect(c.state.phase).toBe("slow");
        jest.advanceTimersByTime(30000);
        expect(c.state).toEqual({ phase: "hidden", suppressed: true });
        jest.advanceTimersByTime(60000);
        expect(c.state.phase).toBe("hidden"); // still busy, stays hidden
        c.setBusy(false);
        expect(c.state.suppressed).toBe(false);
        c.setBusy(true);
        jest.advanceTimersByTime(400);
        expect(c.state.phase).toBe("visible");
    });

    it("user dismiss hides until idle", () => {
        const { c } = make();
        c.setBusy(true);
        jest.advanceTimersByTime(9000);
        c.dismiss();
        expect(c.state).toEqual({ phase: "hidden", suppressed: true });
    });
});

describe("registry", () => {
    it("the last focused instance leads; falls back to the last registered", () => {
        registry.register(101, true);
        registry.register(102, false);
        expect(registry.leader()).toBe(101);
        registry.setFocused(102, true);
        expect(registry.leader()).toBe(102);
        registry.setFocused(102, false);
        expect(registry.leader()).toBe(101);
        registry.unregister(101);
        expect(registry.leader()).toBe(102);
        registry.unregister(102);
        expect(registry.leader()).toBeUndefined();
    });
});
