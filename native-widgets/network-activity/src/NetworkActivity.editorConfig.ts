import { NetworkActivityPreviewProps } from "../typings/NetworkActivityProps";

type Problem = { property?: string; severity: "error" | "warning" | "deprecation"; message: string };

export function check(values: NetworkActivityPreviewProps): Problem[] {
    const problems: Problem[] = [];
    const n = (v: number | null): number => v ?? 0;
    if (n(values.slowAfterMs) >= n(values.maxVisibleMs)) {
        problems.push({
            property: "slowAfterMs",
            severity: "warning",
            message: '"Slow after" should be less than "Hide after".'
        });
    }
    if (n(values.maxVisibleMs) > n(values.requestTimeoutMs)) {
        problems.push({
            property: "maxVisibleMs",
            severity: "warning",
            message: '"Hide after" should not exceed "Forget request after".'
        });
    }
    for (const line of (values.ignorePatterns ?? "").split(/\r?\n/).filter(l => l.trim())) {
        try {
            new RegExp(line.trim());
        } catch {
            problems.push({
                property: "ignorePatterns",
                severity: "error",
                message: `Invalid regular expression: ${line}`
            });
        }
    }
    return problems;
}

export function getPreview(): object {
    return {
        type: "Container",
        borders: true,
        borderRadius: 6,
        padding: 6,
        children: [
            {
                type: "Text",
                content: "⟳ Network activity overlay (no UI on the page)",
                fontColor: "#5f6b7a",
                fontSize: 9
            }
        ]
    };
}
