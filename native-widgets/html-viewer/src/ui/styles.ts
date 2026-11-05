import { TextStyle, ViewStyle } from "react-native";
import { ContentStyle } from "../htmlDocument";

/**
 * Style keys of the widget. Set them in the native theme, for example:
 *
 * export const dumpit_htmlviewer_HtmlViewer = {
 *     container: { marginVertical: 8, padding: 12, borderRadius: 12, backgroundColor: "#fff" },
 *     content: { fontSize: 15, lineHeight: 22, color: "#1f2933", linkColor: "#1565c0" }
 * };
 */
export interface HtmlViewerStyle {
    /** The box around the HTML: margin, padding, border, background, height, minHeight, maxHeight, flex. */
    container?: ViewStyle;
    /** Text of the HTML body; padding here is inside the page. Plus "linkColor". */
    content?: ContentStyle;
    loadingIndicator?: { color?: string };
    empty?: TextStyle;
    errorContainer?: ViewStyle;
    errorText?: TextStyle;
    retryButton?: ViewStyle;
    retryText?: TextStyle;
    fullscreenButton?: ViewStyle;
    fullscreenIcon?: { color?: string };
    modal?: ViewStyle;
    modalHeader?: ViewStyle;
    closeIcon?: { color?: string };
}

type StyleKey = keyof HtmlViewerStyle;

const KEYS: StyleKey[] = [
    "container",
    "content",
    "loadingIndicator",
    "empty",
    "errorContainer",
    "errorText",
    "retryButton",
    "retryText",
    "fullscreenButton",
    "fullscreenIcon",
    "modal",
    "modalHeader",
    "closeIcon"
];

const SOFT_SHADOW: ViewStyle = {
    shadowColor: "#0b1b2b",
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3
};

export const defaultStyle: Required<HtmlViewerStyle> = {
    // No width: "100%" here: with a margin it would overflow the parent. alignSelf stretch fills it.
    container: { alignSelf: "stretch", overflow: "hidden" },
    content: { color: "#1f2933", fontSize: 16, lineHeight: 24, linkColor: "#1565c0" },
    loadingIndicator: { color: "#5f6b7a" },
    empty: { color: "#6b7785", fontSize: 14, paddingVertical: 12, textAlign: "center" },
    errorContainer: {
        alignItems: "center",
        padding: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#f1d4d4",
        backgroundColor: "#fff7f7"
    },
    errorText: { color: "#8a1c1c", fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 12 },
    retryButton: {
        minHeight: 44,
        minWidth: 120,
        paddingHorizontal: 16,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1565c0"
    },
    retryText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
    fullscreenButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.92)",
        borderWidth: 1,
        borderColor: "rgba(15,30,45,0.08)",
        ...SOFT_SHADOW
    },
    fullscreenIcon: { color: "#33414f" },
    modal: { flex: 1, backgroundColor: "#ffffff" },
    modalHeader: {
        flexDirection: "row",
        justifyContent: "flex-start",
        alignItems: "center",
        paddingHorizontal: 8,
        minHeight: 52,
        backgroundColor: "#ffffff",
        borderBottomWidth: 1,
        borderBottomColor: "#e8ecf0"
    },
    closeIcon: { color: "#33414f" }
};

/** Merge the theme, class and design property styles that Mendix passes, key by key. */
export function mergeStyles(styles: Array<HtmlViewerStyle | undefined> | undefined): Required<HtmlViewerStyle> {
    const out = {} as Record<StyleKey, Record<string, unknown>>;
    for (const key of KEYS) {
        out[key] = { ...(defaultStyle[key] as object) };
    }
    for (const style of styles ?? []) {
        if (!style || typeof style !== "object") {
            continue;
        }
        for (const key of KEYS) {
            const part = style[key];
            if (part && typeof part === "object" && !Array.isArray(part)) {
                Object.assign(out[key], part);
            }
        }
    }
    return out as unknown as Required<HtmlViewerStyle>;
}
