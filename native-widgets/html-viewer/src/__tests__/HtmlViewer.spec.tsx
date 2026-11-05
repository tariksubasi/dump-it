import { render } from "@testing-library/react-native";
import { createElement } from "react";
import { ValueStatus } from "mendix";

import { HtmlViewer } from "../HtmlViewer";
import { HtmlViewerProps } from "../../typings/HtmlViewerProps";
import { HtmlViewerStyle } from "../ui/styles";

jest.mock("react-native-webview", () => {
    const { View } = jest.requireActual("react-native");
    const { createElement: h } = jest.requireActual("react");
    return { WebView: (p: { testID?: string }) => h(View, { testID: p.testID ?? "web" }) };
});

const value = (status: ValueStatus, v?: string): any => ({ status, value: v });

function props(html: any, extra: Partial<HtmlViewerProps<HtmlViewerStyle>> = {}): HtmlViewerProps<HtmlViewerStyle> {
    return {
        name: "hv",
        style: [],
        html,
        css: "",
        allowScripts: false,
        sizeMode: "content",
        maxHeight: 0,
        wideTables: "fit",
        zoomable: true,
        fullscreenButton: true,
        maxZoom: 5,
        linkMode: "external",
        offlineCache: true,
        debugMode: true,
        ...extra
    } as HtmlViewerProps<HtmlViewerStyle>;
}

describe("HtmlViewer diagnostic mode is visible in every state", () => {
    it("loading", () => {
        const r = render(createElement(HtmlViewer, props(value(ValueStatus.Loading))));
        expect(r.getByText(/HtmlViewer 1\.0\.\d/)).toBeTruthy();
        expect(r.getByText(/still loading/)).toBeTruthy();
    });

    it("unavailable (no context, no access)", () => {
        const r = render(createElement(HtmlViewer, props(value(ValueStatus.Unavailable))));
        expect(r.getByText(/no context object/)).toBeTruthy();
        expect(r.getByText(/= EMPTY/)).toBeTruthy();
    });

    it("empty string", () => {
        const r = render(createElement(HtmlViewer, props(value(ValueStatus.Available, ""))));
        expect(r.getByText(/0 chars = EMPTY/)).toBeTruthy();
    });

    it("escaped HTML is reported", () => {
        const r = render(createElement(HtmlViewer, props(value(ValueStatus.Available, "&lt;img src=x&gt;"))));
        expect(r.getByText(/escaped YES/)).toBeTruthy();
    });

    it("base64 image counted", () => {
        const html = '<p>a</p><img src="data:image/png;base64,iVBORw0KGgo=">';
        const r = render(createElement(HtmlViewer, props(value(ValueStatus.Available, html))));
        expect(r.getByText(/<img> 1, base64 1, escaped no/)).toBeTruthy();
    });

    it("renders nothing when empty and diagnostic mode is off", () => {
        const r = render(createElement(HtmlViewer, props(value(ValueStatus.Available, ""), { debugMode: false })));
        expect(r.toJSON()).toBeNull();
    });
});
