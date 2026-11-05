import { HtmlViewerPreviewProps } from "../typings/HtmlViewerProps";

type Problem = { property?: string; severity: "error" | "warning" | "deprecation"; message: string };
type Properties = Array<{ caption: string; properties?: Array<{ key: string }>; propertyGroups?: Properties }>;

function hide(groups: Properties, keys: string[]): Properties {
    return groups.map(g => ({
        ...g,
        properties: g.properties?.filter(p => !keys.includes(p.key)),
        propertyGroups: g.propertyGroups ? hide(g.propertyGroups, keys) : undefined
    }));
}

export function getProperties(values: HtmlViewerPreviewProps, defaultProperties: Properties): Properties {
    const hidden: string[] = [];
    if (values.sizeMode !== "content") {
        hidden.push("maxHeight");
    }
    if (!values.zoomable) {
        hidden.push("maxZoom");
    }
    if (values.linkMode !== "action") {
        hidden.push("linkAttribute", "onLinkPress");
    }
    if (values.linkMode === "none") {
        hidden.push("linkErrorText");
    }
    return hide(defaultProperties, hidden);
}

export function check(values: HtmlViewerPreviewProps): Problem[] {
    const problems: Problem[] = [];
    if (values.linkMode === "action" && !values.onLinkPress) {
        problems.push({
            property: "onLinkPress",
            severity: "error",
            message: 'Select a "Link action", or change "On link tap".'
        });
    }
    if (values.maxZoom !== null && (values.maxZoom < 1 || values.maxZoom > 10)) {
        problems.push({
            property: "maxZoom",
            severity: "warning",
            message: "Use a value from 1 to 10. Outside values are clamped."
        });
    }
    if (values.maxHeight !== null && values.maxHeight < 0) {
        problems.push({ property: "maxHeight", severity: "error", message: "Use 0 (no limit) or a positive value." });
    }
    if (values.allowScripts) {
        problems.push({
            property: "allowScripts",
            severity: "warning",
            message: "Scripts in the HTML run. Use this only for HTML you trust, never for user input."
        });
    }
    return problems;
}

export function getPreview(values: HtmlViewerPreviewProps): object {
    const source = (values.html || "").trim();
    return {
        type: "Container",
        borders: true,
        borderRadius: 8,
        padding: 8,
        children: [
            { type: "Text", content: "</> HTML viewer", fontColor: "#33414f", fontSize: 10, bold: true },
            {
                type: "Text",
                content: source ? source.slice(0, 80) : "Set the HTML property",
                fontColor: source ? "#5f6b7a" : "#b42318",
                fontSize: 9
            }
        ]
    };
}
