import { BackNavigationPreviewProps } from "../typings/BackNavigationProps";

type Problem = { property?: string; severity: "error" | "warning" | "deprecation"; message: string };
type Properties = Array<{ caption: string; properties?: Array<{ key: string }>; propertyGroups?: Properties }>;

function hide(groups: Properties, keys: string[]): Properties {
    return groups.map(g => ({
        ...g,
        properties: g.properties?.filter(p => !keys.includes(p.key)),
        propertyGroups: g.propertyGroups ? hide(g.propertyGroups, keys) : undefined
    }));
}

export function getProperties(values: BackNavigationPreviewProps, defaultProperties: Properties): Properties {
    const hidden: string[] = [];
    if (values.rootBehavior !== "action") {
        hidden.push("onRootBack");
    }
    if (values.rootBehavior !== "doublePress") {
        hidden.push("exitHint");
    }
    if ((values.confirmWhen ?? "").trim() === "false") {
        hidden.push("confirmTitle", "confirmMessage", "confirmYes", "confirmNo");
    }
    return hide(defaultProperties, hidden);
}

export function check(values: BackNavigationPreviewProps): Problem[] {
    const problems: Problem[] = [];
    if (values.rootBehavior === "action" && !values.onRootBack) {
        problems.push({
            property: "onRootBack",
            severity: "error",
            message: 'Select a "First page action", or change "On the first page".'
        });
    }
    if (values.debounceMs !== null && (values.debounceMs < 0 || values.debounceMs > 3000)) {
        problems.push({ property: "debounceMs", severity: "warning", message: "Use a value from 0 to 3000 ms." });
    }
    return problems;
}

export function getPreview(): object {
    return {
        type: "Container",
        borders: true,
        borderRadius: 6,
        padding: 6,
        children: [{ type: "Text", content: "↩ Back navigation (no UI)", fontColor: "#5f6b7a", fontSize: 9 }]
    };
}
