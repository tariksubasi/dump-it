/* global globalThis */
import { fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { ValueStatus } from "mendix";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Response: WhatwgResponse } = require("whatwg-fetch");

const CLEAN = JSON.stringify({ actionResult: { type: "string", value: "ok" }, objects: [] });
const server = jest.fn(async () => new WhatwgResponse(CLEAN, { status: 200 }));
(globalThis as any).fetch = server;
(globalThis as any).Response = WhatwgResponse;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ClientCache, cache } = require("../ClientCache");

const call = (): Promise<any> =>
    (globalThis as any).fetch("https://app/xas/", {
        method: "post",
        body: JSON.stringify({
            action: "runtimeOperation",
            operationId: "opRest",
            params: {},
            changes: {},
            objects: []
        })
    });

it("wraps the global fetch: a page opened again within the TTL gets its data from the cache", async () => {
    const r = render(
        <ClientCache
            name="cc"
            style={[]}
            enabled={{ status: ValueStatus.Available, value: true }}
            rules={"opRest=30"}
            clearOn="otherMicroflows"
            useFor="pageOpen"
            mode="list"
            autoTtlSeconds={30}
            pageOpenWindowMs={3000}
            debugMode
        />
    );
    const a = await (await call()).text(); // page opened on mount: miss, stored
    cache.markPageOpen(); // user comes back to the page
    const b = await (await call()).text(); // from the cache
    expect(a).toBe(CLEAN);
    expect(b).toBe(CLEAN);
    expect(server).toHaveBeenCalledTimes(1);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    fireEvent.press(r.getByTestId("cc"));
    expect(alert.mock.calls[0][1]).toMatch(/clean read[\s\S]*opRest/);
    alert.mockRestore();
});

it("enabled = false sends every call to the server", async () => {
    server.mockClear();
    render(
        <ClientCache
            name="cc"
            style={[]}
            enabled={{ status: ValueStatus.Available, value: false }}
            rules={"opRest=30"}
            debugMode={false}
        />
    );
    await call();
    await call();
    expect(server).toHaveBeenCalledTimes(2);
});

it("a JavaScript action can clear the cache through globalThis.dumpitClientCache", async () => {
    server.mockClear();
    render(
        <ClientCache
            name="cc"
            style={[]}
            enabled={{ status: ValueStatus.Available, value: true }}
            rules={"opRest=30"}
            clearOn="otherMicroflows"
            useFor="pageOpen"
            mode="list"
            autoTtlSeconds={30}
            pageOpenWindowMs={3000}
            debugMode={false}
        />
    );
    await call();
    cache.markPageOpen();
    await call();
    expect(server).toHaveBeenCalledTimes(1);
    (globalThis as any).dumpitClientCache.clear("pull to refresh");
    cache.markPageOpen();
    await call();
    expect(server).toHaveBeenCalledTimes(2);
});

it("a focus event of the page (back navigation, tab switch) opens the cache window; a later tap goes to the server", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] } as any);
    server.mockClear();
    (globalThis as any).dumpitClientCache.clear("test");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NavigationContext } = require("@react-navigation/native");
    const listeners: Array<() => void> = [];
    const navigation = {
        isFocused: () => false,
        addListener: (_e: string, fn: () => void) => {
            listeners.push(fn);
            return () => undefined;
        }
    };
    render(
        <NavigationContext.Provider value={navigation}>
            <ClientCache
                name="cc"
                style={[]}
                enabled={{ status: ValueStatus.Available, value: true }}
                rules={"opRest=30"}
                clearOn="otherMicroflows"
                useFor="pageOpen"
                mode="list"
                autoTtlSeconds={30}
                pageOpenWindowMs={3000}
                debugMode={false}
            />
        </NavigationContext.Provider>
    );
    listeners.forEach(l => l()); // page shown
    await call(); // miss, stored
    jest.advanceTimersByTime(10_000);
    listeners.forEach(l => l()); // user comes back to the page
    await call(); // from the cache
    expect(server).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5_000); // later: taps "Refresh data" in a pop-up
    await call();
    expect(server).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
});

it("automatic mode works without any list", async () => {
    server.mockClear();
    (globalThis as any).dumpitClientCache.clear("test");
    render(
        <ClientCache
            name="cc"
            style={[]}
            enabled={{ status: ValueStatus.Available, value: true }}
            rules={""}
            clearOn="otherMicroflows"
            useFor="pageOpen"
            pageOpenWindowMs={3000}
            mode="auto"
            autoTtlSeconds={30}
            debugMode={false}
        />
    );
    const anyOp = (): Promise<any> =>
        (globalThis as any).fetch("https://app/xas/", {
            method: "post",
            body: JSON.stringify({
                action: "runtimeOperation",
                operationId: "opUnlisted",
                params: {},
                changes: {},
                objects: []
            })
        });
    await anyOp(); // page opened on mount: miss, stored (returns data)
    cache.markPageOpen();
    await anyOp(); // from the cache
    expect(server).toHaveBeenCalledTimes(1);
});
