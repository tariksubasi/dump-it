import { act, fireEvent, render } from "@testing-library/react-native";
import { AccessibilityInfo, Animated } from "react-native";
import { ValueStatus } from "mendix";
import { FakeXhr } from "./fakeXhr";

jest.mock("react-native-svg", () => {
    const { View } = jest.requireActual("react-native");
    const { createElement: h } = jest.requireActual("react");
    const C = (p: any): any => h(View, p);
    return { __esModule: true, default: C, Svg: C, Circle: C, Defs: C, LinearGradient: C, Stop: C };
});

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
    spinner: "minimal",
    spinnerSize: 28,
    showMessage: true
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

describe("indicator", () => {
    function showWith(extra: object): ReturnType<typeof render> {
        const r = render(<NetworkActivity {...props} {...extra} />);
        const x = req();
        act(() => jest.advanceTimersByTime(400));
        (r as any).finish = () => {
            act(() => x.finish("load"));
            act(() => jest.advanceTimersByTime(1000));
        };
        return r;
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("default: one minimal iOS-style indicator, 12 bars, one native-driver loop in 12 steps", () => {
        const timing = jest.spyOn(Animated, "timing");
        const loop = jest.spyOn(Animated, "loop");
        const r = showWith({});
        const spinner = r.getByTestId("network-activity-minimal");
        expect(spinner).toBeTruthy();
        expect(spinner.props.style.width).toBe(28);
        expect(spinner.children).toHaveLength(12);
        expect(loop).toHaveBeenCalledTimes(1);
        const cfg = timing.mock.calls[0][1] as any;
        expect(cfg.useNativeDriver).toBe(true);
        expect([0.05, 0.5, 0.99].map(cfg.easing)).toEqual([0, 6 / 12, 11 / 12]); // steps, like iOS
        expect(r.queryByTestId("network-activity-ring")).toBeNull();
        (r as any).finish();
        timing.mockRestore();
        loop.mockRestore();
    });

    it("message hidden by default; the slow text and Hide appear when it takes long", () => {
        const r = showWith({ showMessage: false });
        expect(r.queryByText("Loading…")).toBeNull();
        act(() => jest.advanceTimersByTime(8000));
        expect(r.getByText("This takes longer than usual…")).toBeTruthy();
        expect(r.getByText("Hide")).toBeTruthy();
        (r as any).finish();
    });

    it("size is limited to 16..64", () => {
        const big = showWith({ spinnerSize: 200 });
        expect(big.getByTestId("network-activity-minimal").props.style.width).toBe(64);
        (big as any).finish();
    });

    it("ring option draws one ring", () => {
        const loop = jest.spyOn(Animated, "loop");
        const r = showWith({ spinner: "ring" });
        expect(r.getByTestId("network-activity-ring")).toBeTruthy();
        expect(loop).toHaveBeenCalledTimes(1);
        (r as any).finish();
        loop.mockRestore();
    });

    it("system spinner when chosen", () => {
        const r = showWith({ spinner: "native" });
        expect(r.getByTestId("network-activity-native")).toBeTruthy();
        (r as any).finish();
    });

    it("reduced motion still shows the minimal indicator", async () => {
        const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
        const r = showWith({});
        await act(async () => {
            await Promise.resolve();
        });
        expect(r.getByTestId("network-activity-minimal")).toBeTruthy();
        (r as any).finish();
        spy.mockRestore();
    });
});
