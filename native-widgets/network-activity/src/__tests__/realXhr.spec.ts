// Uses React Native's real XMLHttpRequest class (0.77.3) with the native networking module mocked by jest.
import { NetworkTracker, patchXhr } from "../networkTracker";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const xhrModule = require("react-native/Libraries/Network/XMLHttpRequest");
const RealXhr = xhrModule.default ?? xhrModule;

const tracker = new NetworkTracker();
tracker.options = { ...tracker.options, ignore: [] };
patchXhr(RealXhr, tracker);

let nextRequestId = 1000;
function sent(): any {
    const x = new RealXhr();
    x.open("POST", "https://app.example.com/xas/");
    x.send('{"action":"executeaction"}');
    x._requestId = ++nextRequestId; // what the native module would give back
    return x;
}

describe("real React Native XMLHttpRequest", () => {
    it.each([200, 204, 302, 304, 400, 401, 403, 404, 409, 413, 429, 500, 502, 503, 504])(
        "HTTP %i ends the request (no endless overlay)",
        status => {
            const x = sent();
            expect(tracker.busy).toBe(1);
            x.__didReceiveResponse(x._requestId, status, {}, "https://app.example.com/xas/");
            x.__didCompleteResponse(x._requestId, "", false);
            expect(tracker.busy).toBe(0);
            expect(x.status).toBe(status);
            expect(tracker.recent[tracker.recent.length - 1].outcome).toBe("load");
        }
    );

    it("network error (offline, DNS, TLS) ends the request", () => {
        const x = sent();
        x.__didCompleteResponse(x._requestId, "The Internet connection appears to be offline.", false);
        expect(tracker.busy).toBe(0);
        expect(tracker.recent[tracker.recent.length - 1].outcome).toBe("error");
    });

    it("timeout ends the request", () => {
        const x = sent();
        x.__didCompleteResponse(x._requestId, "timeout", true);
        expect(tracker.busy).toBe(0);
        expect(tracker.recent[tracker.recent.length - 1].outcome).toBe("timeout");
    });

    it("abort after send ends the request", () => {
        const x = sent();
        x.abort();
        expect(tracker.busy).toBe(0);
        expect(tracker.recent[tracker.recent.length - 1].outcome).toBe("abort");
    });

    it("a Mendix handler that throws does not keep the overlay", () => {
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const x = sent();
        x.onload = () => {
            throw new Error("handler crashed");
        };
        x.onreadystatechange = () => {
            throw new Error("handler crashed too");
        };
        x.__didReceiveResponse(x._requestId, 500, {}, "https://app.example.com/xas/");
        x.__didCompleteResponse(x._requestId, "", false);
        expect(tracker.busy).toBe(0);
        errors.mockRestore();
    });

    it("a late duplicate completion does not count twice", () => {
        const x = sent();
        const id = x._requestId;
        x.__didCompleteResponse(id, "", false);
        x.__didCompleteResponse(id, "", false); // ignored by React Native (request id cleared)
        expect(tracker.busy).toBe(0);
    });
});
