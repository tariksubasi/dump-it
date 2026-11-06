import { ReactElement, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextStyle,
    View,
    ViewStyle
} from "react-native";
import { NavigationContext } from "@react-navigation/native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { DynamicValue, ValueStatus } from "mendix";

import { NetworkActivityProps } from "../typings/NetworkActivityProps";
import { NetworkTracker, parsePatterns, patchXhr } from "./networkTracker";
import { OverlayController, OverlayState } from "./overlayController";
import * as registry from "./registry";

export interface NetworkActivityStyle {
    backdrop?: ViewStyle;
    card?: ViewStyle;
    indicator?: { color?: string; colorEnd?: string; trackColor?: string };
    text?: TextStyle;
    button?: ViewStyle;
    buttonText?: TextStyle;
}

const VERSION = "1.1.0";

// ---- one tracker and one controller for the whole app ----------------------------
export const tracker = new NetworkTracker();
let overlayState: OverlayState = { phase: "hidden", suppressed: false };
const overlayListeners = new Set<(s: OverlayState) => void>();
const controller = new OverlayController(
    { showDelayMs: 400, minVisibleMs: 500, slowAfterMs: 8000, maxVisibleMs: 30000 },
    s => {
        overlayState = s;
        overlayListeners.forEach(l => l(s));
    }
);
let watchdog: ReturnType<typeof setInterval> | undefined;

function install(): void {
    patchXhr(typeof XMLHttpRequest === "undefined" ? undefined : (XMLHttpRequest as any), tracker);
    tracker.subscribe(n => controller.setBusy(n > 0));
    // drop lost requests even when nothing else happens
    watchdog ??= setInterval(() => {
        if (tracker.dropLost()) {
            controller.setBusy(tracker.busy > 0);
        }
    }, 5000);
}
let installed = false;

function textOf(v: DynamicValue<string> | undefined, fallback: string): string {
    return v?.status === ValueStatus.Available && v.value ? v.value : fallback;
}

function merge(styles: NetworkActivityStyle[] | undefined): Required<NetworkActivityStyle> {
    const out: Required<NetworkActivityStyle> = {
        backdrop: { backgroundColor: "rgba(11,27,43,0.45)" },
        card: {},
        indicator: { color: "#1558B0" },
        text: {},
        button: {},
        buttonText: {}
    };
    for (const s of styles ?? []) {
        for (const k of Object.keys(out) as Array<keyof NetworkActivityStyle>) {
            if (s?.[k]) {
                Object.assign(out[k], s[k]);
            }
        }
    }
    return out;
}

function describeRecent(): string {
    const now = Date.now();
    return tracker.recent
        .slice()
        .reverse()
        .map(r => {
            const path = r.url.replace(/^https?:\/\/[^/]+/, "");
            const ms = (r.endedAt ?? now) - r.startedAt;
            const body = r.body.replace(/\s+/g, " ").slice(0, 60);
            return `${r.ignored ? "IGNORED " : ""}${r.method} ${path} ${r.outcome ?? "open"} ${ms}ms ${body}`;
        })
        .join("\n");
}

let nextInstance = 1;

type SpinnerKind = "ring" | "ringPulse" | "native";

let gradientSeq = 0;

/** Start a looping native-driver animation synchronously after mount (not in a passive effect: while the Mendix
 *  client is busy with the response, a passive effect can run too late). The loop then runs on the UI thread. */
function useLoop(value: Animated.Value, make: () => Animated.CompositeAnimation, enabled = true): void {
    useLayoutEffect(() => {
        if (!enabled) {
            return undefined;
        }
        let anim: Animated.CompositeAnimation | undefined;
        try {
            anim = Animated.loop(make());
            anim.start();
        } catch (e) {
            console.warn("NetworkActivity: animation could not start", e);
        }
        return () => anim?.stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, enabled]);
}

/** A gradient arc on a light track, drawn with react-native-svg (in Make It Native and Native Template 14). */
function GradientRing(props: {
    size: number;
    stroke: number;
    from: string;
    to: string;
    track?: string;
    arc: number; // part of the circle, 0..1
    durationMs: number;
    reverse?: boolean;
    testID?: string;
}): ReactElement {
    const [spin] = useState(() => new Animated.Value(0));
    const [gid] = useState(() => `naGrad${++gradientSeq}`);
    useLoop(spin, () =>
        Animated.timing(spin, { toValue: 1, duration: props.durationMs, easing: Easing.linear, useNativeDriver: true })
    );
    const rotate = spin.interpolate({
        inputRange: [0, 1],
        outputRange: props.reverse ? ["360deg", "0deg"] : ["0deg", "360deg"]
    });
    const { size, stroke } = props;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    return (
        <Animated.View
            testID={props.testID}
            style={{ position: "absolute", width: size, height: size, transform: [{ rotate }] }}
        >
            <Svg width={size} height={size}>
                <Defs>
                    <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0" stopColor={props.to} stopOpacity="1" />
                        <Stop offset="1" stopColor={props.from} stopOpacity="1" />
                    </LinearGradient>
                </Defs>
                {props.track ? (
                    <Circle cx={size / 2} cy={size / 2} r={r} stroke={props.track} strokeWidth={stroke} fill="none" />
                ) : null}
                <Circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={`url(#${gid})`}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${c * props.arc} ${c}`}
                    fill="none"
                />
            </Svg>
        </Animated.View>
    );
}

function Spinner(props: {
    kind: SpinnerKind;
    color?: string;
    colorEnd?: string;
    track?: string;
    reduceMotion: boolean;
}): ReactElement {
    const from = props.color ?? "#1558B0";
    const to = props.colorEnd ?? "#38BDF8";
    const track = props.track ?? "rgba(21,88,176,0.12)";
    const [pulse] = useState(() => new Animated.Value(0));
    const pulsing = props.kind === "ringPulse" && !props.reduceMotion;
    useLoop(
        pulse,
        () =>
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true
                }),
                Animated.timing(pulse, {
                    toValue: 0,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true
                })
            ]),
        pulsing
    );
    // "native" only when chosen. Reduced motion keeps the rings (a progress indicator is essential motion) and only
    // drops the pulse; the system spinner stands still on Android when animations are turned off.
    if (props.kind === "native") {
        return (
            <View style={styles.pulseBox}>
                <ActivityIndicator size="large" color={from} testID="network-activity-native" />
            </View>
        );
    }
    const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.1] });
    const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.04] });
    return (
        <View style={styles.pulseBox} testID="network-activity-ring">
            {pulsing ? (
                <Animated.View style={[styles.halo, { backgroundColor: to, opacity, transform: [{ scale }] }]} />
            ) : null}
            <GradientRing size={60} stroke={6} from={from} to={to} track={track} arc={0.3} durationMs={900} />
            <GradientRing size={40} stroke={3} from={to} to={from} arc={0.22} durationMs={1500} reverse />
        </View>
    );
}

export function NetworkActivity(props: NetworkActivityProps<NetworkActivityStyle>): ReactElement | null {
    const navigation = useContext(NavigationContext);
    const id = useRef(0);
    const [isLeader, setIsLeader] = useState(false);
    const [state, setState] = useState<OverlayState>(overlayState);
    const [reduceMotion, setReduceMotion] = useState(false);
    const s = merge(props.style);

    // configuration from the latest props (all instances share one controller)
    useLayoutEffect(() => {
        controller.timing = {
            showDelayMs: Math.max(0, props.showDelayMs),
            minVisibleMs: Math.max(0, props.minVisibleMs),
            slowAfterMs: Math.max(1000, props.slowAfterMs),
            maxVisibleMs: Math.max(2000, props.maxVisibleMs)
        };
        tracker.options = {
            ...tracker.options,
            requestTimeoutMs: Math.max(5000, props.requestTimeoutMs),
            ignore: parsePatterns(props.ignorePatterns)
        };
    });

    useEffect(() => {
        if (!installed) {
            installed = true;
            install();
        }
        id.current = nextInstance++;
        const me = id.current;
        registry.register(me, navigation ? navigation.isFocused() : true);
        const update = (): void => setIsLeader(registry.leader() === me);
        const offRegistry = registry.subscribe(update);
        update();
        const offFocus = navigation?.addListener("focus", () => registry.setFocused(me, true));
        const offBlur = navigation?.addListener("blur", () => registry.setFocused(me, false));
        overlayListeners.add(setState);
        // never let this break the overlay: some platforms or mocks return nothing or throw
        try {
            Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
                .then(v => setReduceMotion(v === true))
                .catch(() => undefined);
        } catch {
            // ignore
        }
        return () => {
            overlayListeners.delete(setState);
            offFocus?.();
            offBlur?.();
            offRegistry();
            registry.unregister(me);
        };
    }, [navigation]);

    const debug = props.debugMode;
    useEffect(() => {
        if (!debug) {
            return undefined;
        }
        return tracker.subscribe(n => console.info(`NetworkActivity: ${n} request(s) open`));
    }, [debug]);

    const enabled = props.enabled.status !== ValueStatus.Available || props.enabled.value !== false;
    const visible = isLeader && enabled && state.phase !== "hidden";
    if (!visible) {
        return null;
    }
    const slow = state.phase === "slow";
    const spinnerInfo = `animation ${props.spinner}, reduce motion ${reduceMotion ? "on (no pulse)" : "off"}`;
    const message = slow
        ? textOf(props.slowMessage, "This takes longer than usual…")
        : textOf(props.message, "Loading…");

    return (
        <Modal
            transparent
            visible
            animationType="fade"
            statusBarTranslucent
            supportedOrientations={[
                "portrait",
                "portrait-upside-down",
                "landscape",
                "landscape-left",
                "landscape-right"
            ]}
            onRequestClose={() => slow && controller.dismiss()} // Android back: blocked until slow
        >
            <View style={[styles.backdrop, s.backdrop]} accessibilityViewIsModal>
                <View
                    style={[styles.card, s.card]}
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel={message}
                    accessibilityLiveRegion="polite"
                >
                    <Spinner
                        kind={props.spinner}
                        color={s.indicator.color}
                        colorEnd={s.indicator.colorEnd}
                        track={s.indicator.trackColor}
                        reduceMotion={reduceMotion}
                    />
                    <Text style={[styles.text, s.text]}>{message}</Text>
                    {slow ? (
                        <Pressable
                            onPress={() => controller.dismiss()}
                            accessibilityRole="button"
                            hitSlop={8}
                            style={({ pressed }) => [styles.button, s.button, pressed && { opacity: 0.8 }]}
                        >
                            <Text style={[styles.buttonText, s.buttonText]}>{textOf(props.hideText, "Hide")}</Text>
                        </Pressable>
                    ) : null}
                    {debug ? (
                        <Pressable
                            onPress={() =>
                                Alert.alert(
                                    `NetworkActivity ${VERSION}`,
                                    `${spinnerInfo}\n\n${describeRecent() || "no requests"}`
                                )
                            }
                            hitSlop={8}
                            style={styles.details}
                        >
                            <Text style={styles.detailsText}>Details ({tracker.busy} open)</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    card: {
        minWidth: 160,
        maxWidth: 320,
        alignItems: "center",
        paddingVertical: 24,
        paddingHorizontal: 28,
        borderRadius: 16,
        backgroundColor: "#FFFFFF",
        ...Platform.select<ViewStyle>({
            android: { elevation: 8 },
            default: {
                shadowColor: "#0B1B2B",
                shadowOpacity: 0.18,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 }
            }
        })
    },
    pulseBox: { width: 76, height: 76, alignItems: "center", justifyContent: "center" },
    halo: { position: "absolute", width: 76, height: 76, borderRadius: 38 },
    text: { marginTop: 12, fontSize: 16, lineHeight: 23, color: "#1B2430", textAlign: "center" },
    button: {
        marginTop: 16,
        minHeight: 44,
        minWidth: 120,
        paddingHorizontal: 16,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "#808C9A"
    },
    buttonText: { fontSize: 15, fontWeight: "600", color: "#1B2430" },
    details: { marginTop: 12, padding: 6 },
    detailsText: { fontSize: 12, color: "#4F5B69", textDecorationLine: "underline" }
});
