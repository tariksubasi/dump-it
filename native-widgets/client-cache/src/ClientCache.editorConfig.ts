import { ClientCachePreviewProps } from "../typings/ClientCacheProps";

type Problem = { property?: string; severity: "error" | "warning" | "deprecation"; message: string };
type Properties = Array<{ caption: string; properties?: Array<{ key: string }>; propertyGroups?: Properties }>;

function hide(groups: Properties, keys: string[]): Properties {
    return groups.map(g => ({
        ...g,
        properties: g.properties?.filter(p => !keys.includes(p.key)),
        propertyGroups: g.propertyGroups ? hide(g.propertyGroups, keys) : undefined
    }));
}

export function getProperties(values: ClientCachePreviewProps, defaultProperties: Properties): Properties {
    // automatic mode has its own safe rules; these two only apply to list mode
    return values.mode === "auto"
        ? hide(defaultProperties, ["useFor", "clearOn"])
        : hide(defaultProperties, ["autoTtlSeconds"]);
}

export function check(values: ClientCachePreviewProps): Problem[] {
    const problems: Problem[] = [];
    const ttl = values.autoTtlSeconds ?? 30;
    if (values.mode === "auto" && (ttl < 1 || ttl > 600)) {
        problems.push({ property: "autoTtlSeconds", severity: "warning", message: "Use 1 to 600 seconds." });
    }
    if (values.mode === "list" && !(values.rules ?? "").trim()) {
        problems.push({
            property: "rules",
            severity: "warning",
            message: "List mode without microflows caches nothing."
        });
    }
    return problems;
}

export function getPreview(): object {
    return {
        type: "Container",
        borders: true,
        borderRadius: 6,
        padding: 6,
        children: [{ type: "Text", content: "⚡ Client cache (no UI)", fontColor: "#5f6b7a", fontSize: 9 }]
    };
}
