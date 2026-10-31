import { BackState, decide, MAX_TAB_HISTORY, previousTab, recordTabVisit, swipeAllowed } from "../backLogic";

const base: BackState = {
    enabled: true,
    focused: true,
    canGoBack: true,
    hasCustomAction: false,
    customActionBusy: false,
    rootBehavior: "system",
    hasRootAction: false,
    rootActionBusy: false,
    now: 10_000,
    lastPressAt: 0,
    debounceMs: 400,
    lastExitHintAt: 0,
    exitWindowMs: 2000
};

describe("decide", () => {
    it("goes back when there is a previous page", () => expect(decide(base)).toBe("goBack"));
    it("passes when disabled", () => expect(decide({ ...base, enabled: false })).toBe("pass"));
    it("passes when the page is not focused", () => expect(decide({ ...base, focused: false })).toBe("pass"));
    it("swallows a fast double press", () => expect(decide({ ...base, lastPressAt: 9_800 })).toBe("swallow"));
    it("allows a press after the guard", () => expect(decide({ ...base, lastPressAt: 9_500 })).toBe("goBack"));
    it("negative guard acts as zero", () =>
        expect(decide({ ...base, lastPressAt: 9_999, debounceMs: -5 })).toBe("goBack"));
    it("runs the custom action", () => expect(decide({ ...base, hasCustomAction: true })).toBe("customAction"));
    it("swallows while the custom action runs", () =>
        expect(decide({ ...base, hasCustomAction: true, customActionBusy: true })).toBe("swallow"));
    it("root + system leaves the app", () => expect(decide({ ...base, canGoBack: false })).toBe("exitApp"));
    it("root + block swallows", () =>
        expect(decide({ ...base, canGoBack: false, rootBehavior: "block" })).toBe("swallow"));
    it("root + action without action passes", () =>
        expect(decide({ ...base, canGoBack: false, rootBehavior: "action" })).toBe("pass"));
    it("root + action runs it", () =>
        expect(decide({ ...base, canGoBack: false, rootBehavior: "action", hasRootAction: true })).toBe("rootAction"));
    it("root + double press: first shows hint", () =>
        expect(decide({ ...base, canGoBack: false, rootBehavior: "doublePress" })).toBe("exitHint"));
    it("root + double press: second exits", () =>
        expect(decide({ ...base, canGoBack: false, rootBehavior: "doublePress", lastExitHintAt: 9_000 })).toBe(
            "exitApp"
        ));
    it("root + double press: late second shows hint again", () =>
        expect(decide({ ...base, canGoBack: false, rootBehavior: "doublePress", lastExitHintAt: 7_000 })).toBe(
            "exitHint"
        ));
});

describe("swipeAllowed", () => {
    const on = { iosSwipeBack: true, enabled: true, hasCustomAction: false, confirmActive: false };
    it("on by default", () => expect(swipeAllowed(on)).toBe(true));
    it("off when the property is off", () => expect(swipeAllowed({ ...on, iosSwipeBack: false })).toBe(false));
    it("off with a custom action", () => expect(swipeAllowed({ ...on, hasCustomAction: true })).toBe(false));
    it("off while confirm is active", () => expect(swipeAllowed({ ...on, confirmActive: true })).toBe(false));
    it("widget disabled keeps app default", () =>
        expect(swipeAllowed({ ...on, enabled: false, iosSwipeBack: false })).toBe(true));
});

describe("tab history", () => {
    it("records each tab once, most recent last", () => {
        let h: string[] = [];
        for (const t of ["2", "2", "3", "2", "4"]) {
            h = recordTabVisit(h, t);
        }
        expect(h).toEqual(["3", "2", "4"]);
    });
    it("keeps at most MAX_TAB_HISTORY entries", () => {
        let h: string[] = [];
        for (let i = 0; i < MAX_TAB_HISTORY + 5; i++) {
            h = recordTabVisit(h, String(i));
        }
        expect(h).toHaveLength(MAX_TAB_HISTORY);
        expect(h[h.length - 1]).toBe(String(MAX_TAB_HISTORY + 4));
    });
    it("Ana Sayfa > Profilim > Menü: back goes to Profilim", () =>
        expect(previousTab(["2", "3", "4"], "4", "2")).toEqual({ tab: "3", history: ["2", "3"] }));
    it("then Ana Sayfa, then leave the app", () => {
        expect(previousTab(["2", "3"], "3", "2")).toEqual({ tab: "2", history: ["2"] });
        expect(previousTab(["2"], "2", "2")).toBeUndefined();
    });
    it("A > B > A > B never loops: B, A, then out", () => {
        let h: string[] = [];
        for (const t of ["A", "B", "A", "B"]) {
            h = recordTabVisit(h, t);
        }
        const first = previousTab(h, "B", "A");
        expect(first).toEqual({ tab: "A", history: ["A"] });
        expect(previousTab(first!.history, "A", "A")).toBeUndefined();
    });
    it("history exhausted on a non-home tab goes to home (e.g. app opened from a deep link)", () =>
        expect(previousTab(["0"], "0", "2")).toEqual({ tab: "2", history: ["2"] }));
    it("home mode: any tab goes to home, home leaves", () => {
        expect(previousTab(["2", "3", "4"], "4", "2", "home")).toEqual({ tab: "2", history: ["2"] });
        expect(previousTab(["2"], "2", "2", "home")).toBeUndefined();
    });
    it("none mode never handles tabs", () => expect(previousTab(["2", "3"], "3", "2", "none")).toBeUndefined());
    it("unknown home and empty history: nothing", () => expect(previousTab([], "2")).toBeUndefined());
});
