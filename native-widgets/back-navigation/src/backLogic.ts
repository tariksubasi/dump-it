// Pure decision logic. No React Native imports, so it is unit-testable.

export type RootBehavior = "system" | "doublePress" | "block" | "action";

export type Decision =
    | "pass" // return false: let Mendix / the OS handle back
    | "swallow" // return true: do nothing
    | "customAction"
    | "goBack"
    | "rootAction"
    | "exitHint" // first press of "press twice"
    | "exitApp";

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
            return "pass";
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
