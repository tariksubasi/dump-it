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
const { ClientCache } = require("../ClientCache");

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

it("wraps the global fetch: the second call within the TTL does not reach the server", async () => {
    const r = render(
        <ClientCache
            name="cc"
            style={[]}
            enabled={{ status: ValueStatus.Available, value: true }}
            rules={"opRest=30"}
            debugMode
        />
    );
    const a = await (await call()).text();
    const b = await (await call()).text();
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
