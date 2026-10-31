import { ReactElement, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { Alert, BackHandler, Platform, ToastAndroid } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { ActionValue, DynamicValue, ValueStatus } from "mendix";

import { BackNavigationProps } from "../typings/BackNavigationProps";
import { decide, Decision, previousTab, recordTabVisit, swipeAllowed, TabBackMode } from "./backLogic";

const EXIT_WINDOW_MS = 2000;

function boolOf(value: DynamicValue<boolean> | undefined, fallback: boolean): boolean {
    return value?.status === ValueStatus.Available && typeof value.value === "boolean" ? value.value : fallback;
}

function textOf(value: DynamicValue<string> | undefined, fallback: string): string {
    return value?.status === ValueStatus.Available && value.value ? value.value : fallback;
}

type NavState = { key?: string; type?: string; index?: number; routes?: Array<{ name?: string }> };
type NavLike = {
    getState?: () => NavState | undefined;
    getParent?: () => NavLike | undefined;
    canGoBack?: () => boolean;
    goBack?: () => void;
    navigate?: (name: string) => void;
};

const MAX_DEPTH = 8;

function stateOf(nav: NavLike | undefined): NavState | undefined {
    try {
        return nav?.getState?.();
    } catch {
        return undefined;
    }
}

// Mendix: Drawer > BottomTabs > (per tab) Stack [STACK, POPUP] > Popup stack.
// A page (or the popup it is in) can be closed when one of the stacks above it, up to the tabs, has history.
function stackHasHistory(nav: NavLike | undefined): boolean {
    let cur = nav;
    for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
        const st = stateOf(cur);
        if (st?.type !== "stack") {
            return false;
        }
        if ((st.index ?? 0) > 0) {
            return true;
        }
        cur = cur.getParent?.();
    }
    return false;
}

function findTabNavigator(nav: NavLike | undefined): NavLike | undefined {
    let cur = nav;
    for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
        if (stateOf(cur)?.type === "tab") {
            return cur;
        }
        cur = cur.getParent?.();
    }
    return undefined;
}

function currentTabName(tabNav: NavLike | undefined): string | undefined {
    const st = stateOf(tabNav);
    return st?.routes?.[st.index ?? 0]?.name;
}

// Bottom bar tab history, shared by all pages (Mendix has one bottom bar).
let tabHistory: string[] = [];
let tabHistoryOwner: string | undefined;
// Home tab: the first tab seen after the bottom bar mounts (Mendix opens the home page's tab first).
let homeTab: string | undefined;
let tabBackMode: TabBackMode = "history";

function syncTabHistory(tabNav: NavLike | undefined): void {
    const key = stateOf(tabNav)?.key;
    if (key !== tabHistoryOwner) {
        tabHistory = []; // new bottom bar (e.g. after logout and login)
        tabHistoryOwner = key;
        homeTab = undefined;
    }
}

function recordCurrentTab(nav: NavLike | undefined): void {
    const tabNav = findTabNavigator(nav);
    const tab = currentTabName(tabNav);
    if (tabNav && tab !== undefined) {
        syncTabHistory(tabNav);
        homeTab ??= tab;
        tabHistory = recordTabVisit(tabHistory, tab);
    }
}

// Close this page, or go to the previously visited tab. False when there is no previous page.
function goBackOwn(nav: NavLike | undefined): boolean {
    if (stackHasHistory(nav)) {
        nav?.goBack?.();
        return true;
    }
    const tabNav = findTabNavigator(nav);
    const tab = currentTabName(tabNav);
    if (tabNav && tab !== undefined) {
        syncTabHistory(tabNav);
        const prev = previousTab(tabHistory, tab, homeTab, tabBackMode);
        if (prev) {
            tabHistory = prev.history;
            tabNav.navigate?.(prev.tab);
            return true;
        }
    }
    return false;
}

function hasOwnHistory(nav: NavLike | undefined): boolean {
    if (stackHasHistory(nav)) {
        return true;
    }
    const tabNav = findTabNavigator(nav);
    const tab = currentTabName(tabNav);
    if (!tabNav || tab === undefined) {
        return false;
    }
    syncTabHistory(tabNav);
    return previousTab(tabHistory, tab, homeTab, tabBackMode) !== undefined;
}

// One line per navigator, from the page up to the root, plus the tab history.
function describeNavigation(nav: NavLike | undefined): string {
    if (!nav) {
        return "NO NAVIGATION CONTEXT";
    }
    const parts: string[] = [];
    let cur: NavLike | undefined = nav;
    for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
        const st = stateOf(cur);
        const names = (st?.routes ?? []).map(r => r.name ?? "?").join(",");
        parts.push(`${st?.type ?? "?"} ${st?.index ?? "?"}/${st?.routes?.length ?? 0} (${names})`);
        cur = cur.getParent?.();
    }
    return `${parts.join(" › ")}\ntabs: ${tabHistory.join(">") || "-"} home=${
        homeTab ?? "-"
    } mode=${tabBackMode} own=${hasOwnHistory(nav)}`;
}

function runAction(action: ActionValue | undefined): boolean {
    if (action?.canExecute && !action.isExecuting) {
        action.execute();
        return true;
    }
    return false;
}

export function BackNavigation(props: BackNavigationProps<undefined>): ReactElement | null {
    // useContext does not throw when the page has no navigator (unlike useNavigation).
    const navigation = useContext(NavigationContext);

    // The back handler reads the latest props through refs, so it never re-subscribes on render.
    const propsRef = useRef(props);
    const navRef = useRef(navigation);
    useLayoutEffect(() => {
        propsRef.current = props;
        navRef.current = navigation;
        tabBackMode = props.tabBackMode ?? "history";
    });

    const lastPressAt = useRef(0);
    const lastExitHintAt = useRef(0);
    const dialogOpen = useRef(false);

    const enabled = boolOf(props.enabled, true);
    const confirmActive = boolOf(props.confirmWhen, false);
    const hasCustomAction = !!props.onBack;

    // ---- Android hardware back ------------------------------------------------
    useEffect(() => {
        if (Platform.OS !== "android") {
            return undefined;
        }

        const nav = (): NavLike | undefined => navRef.current as unknown as NavLike | undefined;
        const goBackOrExit = (): void => {
            if (!goBackOwn(nav())) {
                BackHandler.exitApp();
            }
        };

        const perform = (d: Decision): boolean => {
            const p = propsRef.current;
            switch (d) {
                case "pass":
                    return false;
                case "swallow":
                    return true;
                case "customAction":
                    // No access or not executable: fall back to the normal back.
                    if (!runAction(p.onBack)) {
                        goBackOrExit();
                    }
                    return true;
                case "goBack":
                    return goBackOwn(nav());
                case "rootAction":
                    if (!runAction(p.onRootBack)) {
                        return false;
                    }
                    return true;
                case "exitHint":
                    lastExitHintAt.current = Date.now();
                    ToastAndroid.show(textOf(p.exitHint, "Press back again to exit"), ToastAndroid.SHORT);
                    return true;
                case "exitApp":
                    lastExitHintAt.current = 0;
                    BackHandler.exitApp(); // the default Android back of the activity
                    return true;
                default:
                    return false;
            }
        };

        const onHardwareBack = (): boolean => {
            try {
                if (dialogOpen.current) {
                    return true; // the dialog is the active layer
                }
                const p = propsRef.current;
                const nav = navRef.current;
                const now = Date.now();
                const decision = decide({
                    enabled: boolOf(p.enabled, true),
                    focused: nav ? nav.isFocused() : true,
                    canGoBack: hasOwnHistory(nav as unknown as NavLike),
                    hasCustomAction: !!p.onBack,
                    customActionBusy: !!p.onBack?.isExecuting,
                    rootBehavior: p.rootBehavior,
                    hasRootAction: !!p.onRootBack,
                    rootActionBusy: !!p.onRootBack?.isExecuting,
                    now,
                    lastPressAt: lastPressAt.current,
                    debounceMs: p.debounceMs ?? 400,
                    lastExitHintAt: lastExitHintAt.current,
                    exitWindowMs: EXIT_WINDOW_MS
                });
                if (p.debugMode) {
                    const info = `BackNavigation\nfocused=${
                        nav ? nav.isFocused() : "-"
                    } decision=${decision}\n${describeNavigation(nav as unknown as NavLike)}`;
                    console.info(info);
                    // Hold the decision until the dialog is read; otherwise "exitApp" closes it at once.
                    dialogOpen.current = true;
                    const close = (): void => {
                        dialogOpen.current = false;
                    };
                    Alert.alert(
                        "BackNavigation (diagnostic)",
                        info,
                        [
                            { text: "Cancel", style: "cancel", onPress: close },
                            {
                                text: "Run",
                                onPress: () => {
                                    close();
                                    lastPressAt.current = 0;
                                    if (decision !== "pass") {
                                        perform(decision);
                                    }
                                }
                            }
                        ],
                        { cancelable: true, onDismiss: close }
                    );
                    return true;
                }
                if (decision === "pass") {
                    return false;
                }
                lastPressAt.current = now;

                const leaving = decision !== "swallow" && decision !== "exitHint";
                if (leaving && boolOf(p.confirmWhen, false)) {
                    dialogOpen.current = true;
                    const close = (): void => {
                        dialogOpen.current = false;
                    };
                    Alert.alert(
                        textOf(p.confirmTitle, "Leave this page?"),
                        textOf(p.confirmMessage, "Your changes are not saved."),
                        [
                            { text: textOf(p.confirmNo, "Stay"), style: "cancel", onPress: close },
                            {
                                text: textOf(p.confirmYes, "Leave"),
                                style: "destructive",
                                onPress: () => {
                                    close();
                                    if (!perform(decision)) {
                                        // "pass" decisions cannot be returned to the OS after a dialog.
                                        goBackOrExit();
                                    }
                                }
                            }
                        ],
                        { cancelable: true, onDismiss: close }
                    );
                    return true;
                }
                return perform(decision);
            } catch (e) {
                console.warn("BackNavigation: back press failed, using default behavior.", e);
                return false;
            }
        };

        let subscription: { remove: () => void } | undefined;
        const subscribe = (): void => {
            subscription?.remove();
            // Re-adding on focus puts this page's handler on top of the stack.
            subscription = BackHandler.addEventListener("hardwareBackPress", onHardwareBack);
            recordCurrentTab(nav());
            if (propsRef.current.debugMode) {
                ToastAndroid.show(`BackNavigation active\n${describeNavigation(nav())}`, ToastAndroid.LONG);
            }
        };
        const unsubscribe = (): void => {
            subscription?.remove();
            subscription = undefined;
        };

        if (!navigation) {
            subscribe();
            return unsubscribe;
        }
        if (navigation.isFocused()) {
            subscribe();
        }
        const offFocus = navigation.addListener("focus", subscribe);
        const offBlur = navigation.addListener("blur", () => {
            unsubscribe();
            dialogOpen.current = false;
        });
        return () => {
            offFocus();
            offBlur();
            unsubscribe();
        };
    }, [navigation]);

    // ---- iOS swipe back ---------------------------------------------------------
    useEffect(() => {
        if (Platform.OS !== "ios" || !navigation) {
            return;
        }
        try {
            navigation.setOptions({
                gestureEnabled: swipeAllowed({
                    iosSwipeBack: props.iosSwipeBack,
                    enabled,
                    hasCustomAction,
                    confirmActive
                })
            });
        } catch (e) {
            console.warn("BackNavigation: could not set iOS swipe option.", e);
        }
    }, [navigation, props.iosSwipeBack, enabled, hasCustomAction, confirmActive]);

    return null;
}
