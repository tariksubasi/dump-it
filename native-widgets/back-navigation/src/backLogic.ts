// Pure decision logic. No React Native imports, so it is unit-testable.

export type RootBehavior = "system" | "doublePress" | "block" | "action";

export type Decision =
    | "pass" // return false: let Mendix / the OS handle back
    | "swallow" // return true: do nothing
    | "customAction"
    | "goBack"
    | "rootAction"
    | "exitHint" // first press of "press twice"
    | "exitApp"; // the normal system back on the first page (app goes to the background)

export interface BackState {
    enabled: boolean;
    focused: boolean;
    canGoBack: boolean;
    hasCustomAction: boolean;
    customActionBusy: boolean;
    rootBehavior: RootBehavior;
    hasRootAction: boolean;
    rootActionBusy: boolean;
    now: number;
    lastPressAt: number;
    debounceMs: number;
    lastExitHintAt: number;
    exitWindowMs: number;
}

export function decide(s: BackState): Decision {
    if (!s.enabled || !s.focused) {
        return "pass";
    }
    if (s.now - s.lastPressAt < Math.max(0, s.debounceMs)) {
        return "swallow";
    }
    if (s.hasCustomAction) {
        return s.customActionBusy ? "swallow" : "customAction";
    }
    if (s.canGoBack) {
        return "goBack";
    }
    switch (s.rootBehavior) {
        case "block":
            return "swallow";
        case "action":
            if (!s.hasRootAction) {
                return "pass";
            }
            return s.rootActionBusy ? "swallow" : "rootAction";
        case "doublePress":
            return s.now - s.lastExitHintAt < s.exitWindowMs ? "exitApp" : "exitHint";
        default:
            // Do not return "pass" here: React Navigation's own handler would then jump to the FIRST bottom bar
            // tab instead of leaving the app.
            return "exitApp";
    }
}

// iOS has no back key. The swipe must not skip a custom action or a confirm dialog.
export function swipeAllowed(opts: {
    iosSwipeBack: boolean;
    enabled: boolean;
    hasCustomAction: boolean;
    confirmActive: boolean;
}): boolean {
    if (!opts.enabled) {
        return true; // widget off: do not change the app default
    }
    return opts.iosSwipeBack && !opts.hasCustomAction && !opts.confirmActive;
}

// Bottom bar tab history. React Navigation tabs go back to the FIRST tab, not the previous one,
// so the widget keeps the order the user visited the tabs in.
export const MAX_TAB_HISTORY = 20;

export function recordTabVisit(history: string[], tab: string): string[] {
    if (history[history.length - 1] === tab) {
        return history;
    }
    const next = [...history, tab];
    return next.length > MAX_TAB_HISTORY ? next.slice(next.length - MAX_TAB_HISTORY) : next;
}

// The tab to go back to, and the history without the current tab. Undefined when there is none.
export function previousTab(history: string[], current: string): { tab: string; history: string[] } | undefined {
    const rest = history[history.length - 1] === current ? history.slice(0, -1) : [...history];
    while (rest.length > 0 && rest[rest.length - 1] === current) {
        rest.pop();
    }
    if (rest.length === 0) {
        return undefined;
    }
    return { tab: rest[rest.length - 1], history: rest };
}
