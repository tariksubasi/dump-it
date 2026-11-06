import { act, fireEvent, render } from "@testing-library/react-native";
import { AccessibilityInfo, Animated } from "react-native";
import { ValueStatus } from "mendix";
import { FakeXhr } from "./fakeXhr";

class Xhr extends FakeXhr {}
(globalThis as any).XMLHttpRequest = Xhr; // eslint-disable-line no-undef

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NetworkActivity } = require("../NetworkActivity");

const props = {
    name: "na",
    style: [],
    enabled: { status: ValueStatus.Available, value: true },
    showDelayMs: 400,
    minVisibleMs: 500,
    slowAfterMs: 8000,
    maxVisibleMs: 30000,
    requestTimeoutMs: 60000,
    ignorePatterns: "symbolicate",
    debugMode: false,
    spinner: "ringPulse"
};

function req(): FakeXhr {
    const x = new Xhr();
    x.open("POST", "https://app/xas/");
    x.send("{}");
    return x;
}

it("shows the overlay for a slow request and hides it on error, with slow state and Hide", () => {
    jest.useFakeTimers();
    const r = render(<NetworkActivity {...props} />);
    let x = req();
    act(() => jest.advanceTimersByTime(399));
    expect(r.queryByText("Loading…")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(r.getByText("Loading…")).toBeTruthy();
    act(() => x.finish("error"));
    act(() => jest.advanceTimersByTime(500));
    expect(r.queryByText("Loading…")).toBeNull();

    x = req();
    act(() => jest.advanceTimersByTime(400 + 8000));
    expect(r.getByText("This takes longer than usual…")).toBeTruthy();
    act(() => fireEvent.press(r.getByText("Hide")));
    expect(r.queryByText("This takes longer than usual…")).toBeNull();
    act(() => x.finish("load"));
    jest.useRealTimers();
});

it("enabled = false shows nothing", () => {
    jest.useFakeTimers();
    const r = render(<NetworkActivity {...props} enabled={{ status: ValueStatus.Available, value: false }} />);
    const x = req();
    act(() => jest.advanceTimersByTime(1000));
    expect(r.queryByText("Loading…")).toBeNull();
    act(() => x.finish("load"));
    act(() => jest.advanceTimersByTime(1000));
    jest.useRealTimers();
});

describe("animation", () => {
    function showWith(extra: object): ReturnType<typeof render> {
        const r = render(<NetworkActivity {...props} {...extra} />);
        const x = req();
        act(() => jest.advanceTimersByTime(400));
        (r as any).finishRequest = () => x.finish("load");
        return r;
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("spinning ring by default, and its rotation loop starts", () => {
        const loop = jest.spyOn(Animated, "loop");
        const r = showWith({});
        expect(r.getByTestId("network-activity-ring")).toBeTruthy();
        expect(r.queryByTestId("network-activity-native")).toBeNull();
        expect(loop).toHaveBeenCalled();
        act(() => (r as any).finishRequest());
        act(() => jest.advanceTimersByTime(1000));
        loop.mockRestore();
    });

    it("system spinner when chosen", () => {
        const r = showWith({ spinner: "native" });
        expect(r.getByTestId("network-activity-native")).toBeTruthy();
        expect(r.queryByTestId("network-activity-ring")).toBeNull();
        act(() => (r as any).finishRequest());
        act(() => jest.advanceTimersByTime(1000));
    });

    it("reduced motion (animations off) still shows the spinning ring, only without the pulse", async () => {
        const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
        const r = showWith({ spinner: "ring" });
        await act(async () => {
            await Promise.resolve();
        });
        expect(r.getByTestId("network-activity-ring")).toBeTruthy();
        expect(r.queryByTestId("network-activity-native")).toBeNull();
        act(() => (r as any).finishRequest());
        act(() => jest.advanceTimersByTime(1000));
        spy.mockRestore();
    });
});
