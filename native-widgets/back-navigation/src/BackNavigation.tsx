import { ReactElement, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { Alert, BackHandler, Platform, ToastAndroid } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { ActionValue, DynamicValue, ValueStatus } from "mendix";

import { BackNavigationProps } from "../typings/BackNavigationProps";
import { decide, Decision, swipeAllowed } from "./backLogic";

const EXIT_WINDOW_MS = 2000;

function boolOf(value: DynamicValue<boolean> | undefined, fallback: boolean): boolean {
    return value?.status === ValueStatus.Available && typeof value.value === "boolean" ? value.value : fallback;
}

function textOf(value: DynamicValue<string> | undefined, fallback: string): string {
    return value?.status === ValueStatus.Available && value.value ? value.value : fallback;
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

        const goBackOrExit = (): void => {
            const nav = navRef.current;
            if (nav?.canGoBack()) {
                nav.goBack();
            } else {
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
                    navRef.current?.goBack();
                    return true;
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
                    return false; // let the OS close the app the normal way
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
                    canGoBack: nav ? nav.canGoBack() : false,
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
