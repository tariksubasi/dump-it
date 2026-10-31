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

// Bottom bar tab history. React Navigation tabs go back to the FIRST tab (Mendix does not set backBehavior),
// so the widget keeps its own history.
//   history: previous tab first (each tab once, most recent last), then the home tab, then leave the app.
//   home:    always the home tab, then leave the app (the Android guideline).
//   none:    do not handle tabs (Mendix default: first tab).
export type TabBackMode = "history" | "home" | "none";

export const MAX_TAB_HISTORY = 20;

// Each tab appears once; a revisited tab moves to the end. So A>B>A>B is [A,B], and back can never loop:
// at most (tab count) presses reach the home tab.
export function recordTabVisit(history: string[], tab: string): string[] {
    if (history[history.length - 1] === tab) {
        return history;
    }
    const next = [...history.filter(t => t !== tab), tab];
    return next.length > MAX_TAB_HISTORY ? next.slice(next.length - MAX_TAB_HISTORY) : next;
}

// The tab to go back to and the history after that move. Undefined: no previous tab (leave the app).
export function previousTab(
    history: string[],
    current: string,
    home?: string,
    mode: TabBackMode = "history"
): { tab: string; history: string[] } | undefined {
    if (mode === "none") {
        return undefined;
    }
    const rest = history.filter(t => t !== current);
    if (mode === "history" && rest.length > 0) {
        return { tab: rest[rest.length - 1], history: rest };
    }
    if (home !== undefined && home !== current) {
        return { tab: home, history: [home] };
    }
    return undefined;
}
