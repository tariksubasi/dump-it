import {
    Component,
    Fragment,
    ReactElement,
    ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";
import {
    ActivityIndicator,
    Alert,
    LayoutChangeEvent,
    Linking,
    Modal,
    Platform,
    Pressable,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    ToastAndroid,
    useWindowDimensions,
    View
} from "react-native";
import { ActionValue, DynamicValue, ValueStatus } from "mendix";

import { HtmlViewerProps } from "../typings/HtmlViewerProps";
import { FrameMessage, HtmlFrame } from "./HtmlFrame";
import { boxHeight, buildDocument, classifyLink, HeightGuard, isEmptyHtml, makeNonce, SizeMode } from "./htmlDocument";
import { HtmlViewerStyle, mergeStyles } from "./ui/styles";

const VERSION = "1.0.4"; // shown in diagnostic mode: proves which build the app runs
const PLACEHOLDER_HEIGHT = 48;
const DIAG_DELAY_MS = 4000; // wait for load and height first
const SPINNER_DELAY_MS = 250;
const READY_TIMEOUT_MS = 8000;
const LINK_REPEAT_MS = 1000;
// No height from the page after this time: show the content in a scrollable box instead of an empty one.
const NO_HEIGHT_MS = 5000;
const ORIENTATIONS: Array<"portrait" | "portrait-upside-down" | "landscape" | "landscape-left" | "landscape-right"> = [
    "portrait",
    "portrait-upside-down",
    "landscape",
    "landscape-left",
    "landscape-right"
];

type Styles = Required<HtmlViewerStyle>;

function textOf(value: DynamicValue<string> | undefined, fallback: string): string {
    return value?.status === ValueStatus.Available && value.value ? value.value : fallback;
}

function runAction(action: ActionValue | undefined): void {
    if (action?.canExecute && !action.isExecuting) {
        action.execute();
    }
}

function notify(message: string): void {
    if (Platform.OS === "android") {
        ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
        Alert.alert(message);
    }
}

// ---- small drawn icons (no icon font needed) -------------------------------------------

function ExpandIcon({ color }: { color?: string }): ReactElement {
    const c = color ?? "#33414f";
    const corner = { position: "absolute" as const, width: 6, height: 6, borderColor: c };
    return (
        <View style={{ width: 16, height: 16 }}>
            <View style={[corner, { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 }]} />
            <View style={[corner, { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 }]} />
            <View style={[corner, { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 }]} />
            <View style={[corner, { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 }]} />
        </View>
    );
}

function CloseIcon({ color }: { color?: string }): ReactElement {
    const bar = { position: "absolute" as const, top: 8, left: -1, width: 20, height: 2, borderRadius: 1 };
    return (
        <View style={{ width: 18, height: 18 }}>
            <View style={[bar, { backgroundColor: color ?? "#33414f", transform: [{ rotate: "45deg" }] }]} />
            <View style={[bar, { backgroundColor: color ?? "#33414f", transform: [{ rotate: "-45deg" }] }]} />
        </View>
    );
}

function ErrorView(props: { styles: Styles; text: string; retryText: string; onRetry: () => void }): ReactElement {
    return (
        <View style={props.styles.errorContainer} accessibilityRole="alert">
            <Text style={props.styles.errorText}>{props.text}</Text>
            <Pressable
                onPress={props.onRetry}
                accessibilityRole="button"
                accessibilityLabel={props.retryText}
                hitSlop={8}
                style={({ pressed }) => [props.styles.retryButton, pressed && { opacity: 0.8 }]}
            >
                <Text style={props.styles.retryText}>{props.retryText}</Text>
            </Pressable>
        </View>
    );
}

// ---- crash guard: a render error never breaks the Mendix page ----------------------

interface BoundaryProps {
    debugMode: boolean;
    styles: Styles;
    text: string;
    retryText: string;
    children: ReactNode;
}

class Boundary extends Component<BoundaryProps, { error?: Error; generation: number }> {
    state: { error?: Error; generation: number } = { generation: 0 };

    componentDidCatch(error: Error): void {
        console.error("HtmlViewer: render failed.", error);
        if (this.props.debugMode) {
            const stack = (error.stack ?? "").split("\n").slice(0, 8).join("\n");
            Alert.alert(`HtmlViewer ${VERSION} render error`, `${error.message}\n\n${stack}`);
        }
    }

    render(): ReactNode {
        if (this.state.error) {
            return (
                <ErrorView
                    styles={this.props.styles}
                    text={this.props.text}
                    retryText={this.props.retryText}
                    onRetry={() => this.setState(s => ({ error: undefined, generation: s.generation + 1 }))}
                />
            );
        }
        return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
    }

    static getDerivedStateFromError(error: Error): { error: Error } {
        return { error };
    }
}

// ---- full screen ------------------------------------------------------------------------

interface FullscreenProps {
    visible: boolean;
    onClose: () => void;
    styles: Styles;
    makeDoc: () => string;
    baseUrl?: string;
    zoom: boolean;
    offlineCache: boolean;
    onLink: (url: string) => void;
    closeLabel: string;
    errorText: string;
    retryText: string;
}

function Fullscreen(props: FullscreenProps): ReactElement {
    return (
        <Modal
            visible={props.visible}
            animationType="slide"
            presentationStyle="fullScreen"
            statusBarTranslucent
            supportedOrientations={ORIENTATIONS}
            onRequestClose={props.onClose} // Android back closes the full screen first
        >
            <View
                style={[props.styles.modal, Platform.OS === "android" && { paddingTop: StatusBar.currentHeight ?? 0 }]}
            >
                <SafeAreaView style={styles.flex}>
                    <View style={props.styles.modalHeader}>
                        <Pressable
                            onPress={props.onClose}
                            accessibilityRole="button"
                            accessibilityLabel={props.closeLabel}
                            hitSlop={10}
                            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                        >
                            <CloseIcon color={props.styles.closeIcon.color} />
                        </Pressable>
                    </View>
                    {props.visible ? <FullscreenBody {...props} /> : null}
                </SafeAreaView>
            </View>
        </Modal>
    );
}

// Mounted only while the modal is open: every opening starts without an old error.
function FullscreenBody(props: FullscreenProps): ReactElement {
    const [failed, setFailed] = useState(false);
    const [generation, setGeneration] = useState(0);
    const { makeDoc } = props;
    const doc = useMemo(() => makeDoc(), [makeDoc]);
    return (
        <Fragment>
            {!failed && doc ? (
                <HtmlFrame
                    key={generation}
                    doc={doc}
                    baseUrl={props.baseUrl}
                    mode="parent"
                    zoom={props.zoom}
                    scrollable
                    offlineCache={props.offlineCache}
                    onMessage={() => undefined}
                    onLoadEnd={() => undefined}
                    onLink={props.onLink}
                    onFail={() => setFailed(true)}
                />
            ) : null}
            {failed ? (
                <View style={styles.modalError}>
                    <ErrorView
                        styles={props.styles}
                        text={props.errorText}
                        retryText={props.retryText}
                        onRetry={() => {
                            setFailed(false);
                            setGeneration(g => g + 1);
                        }}
                    />
                </View>
            ) : null}
        </Fragment>
    );
}

// ---- the widget --------------------------------------------------------------------------

type Props = HtmlViewerProps<HtmlViewerStyle>;

function Viewer(props: Props & { styles: Styles }): ReactElement | null {
    const { styles: s } = props;
    const propsRef = useRef(props);
    useLayoutEffect(() => {
        propsRef.current = props;
    });

    // Keep the last HTML while a new value loads, so the content does not blink.
    const status = props.html.status;
    const incoming =
        status === ValueStatus.Available ? props.html.value ?? "" : status === ValueStatus.Unavailable ? "" : undefined;
    const [html, setHtml] = useState<string | undefined>(incoming);
    if (incoming !== undefined && incoming !== html) {
        setHtml(incoming);
    }

    const baseUrl =
        props.baseUrl?.status === ValueStatus.Available && props.baseUrl.value?.trim()
            ? props.baseUrl.value.trim()
            : undefined;

    const win = useWindowDimensions();
    const [width, setWidth] = useState(0);
    const [forcedWidth, setForcedWidth] = useState(0); // the parent gave no width (a row container)
    const [fallback, setFallback] = useState(false); // "Fill parent" without a parent height
    const mode: SizeMode = props.sizeMode === "parent" && !fallback ? "parent" : "content";
    const maxHeight = mode === "content" && props.maxHeight > 0 ? props.maxHeight : 0;

    const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
    const guard = useRef(new HeightGuard());
    const heightRef = useRef<number | undefined>(undefined);
    const [generation, setGeneration] = useState(0);
    // State is stored "for" one load (document + retry count), so new content starts clean by itself.
    const [readyFor, setReadyFor] = useState("");
    const [spinnerFor, setSpinnerFor] = useState("");
    const [failedFor, setFailedFor] = useState("");
    const [fullscreen, setFullscreen] = useState(false);
    const [noHeightFor, setNoHeightFor] = useState("");
    const heightFor = useRef("");
    // Diagnostic mode counters
    type Diag = { msgs: number; last: string; loadEnd: number; jsError: string; fail: string };
    const [diag, setDiag] = useState<Diag>({ msgs: 0, last: "-", loadEnd: 0, jsError: "-", fail: "-" });
    const note = useCallback((change: (d: Diag) => Partial<Diag>) => {
        if (propsRef.current.debugMode) {
            setDiag(d => ({ ...d, ...change(d) }));
        }
    }, []);

    const nonce = useMemo(() => makeNonce(), []);
    const empty = html !== undefined && isEmptyHtml(html);

    const doc = useMemo(
        () =>
            html === undefined || empty
                ? ""
                : buildDocument({
                      html,
                      css: props.css,
                      content: s.content,
                      sizeMode: mode,
                      zoom: props.zoomable && mode === "parent",
                      maxZoom: props.maxZoom,
                      allowScripts: props.allowScripts,
                      tables: props.wideTables,
                      nonce
                  }),
        [
            html,
            empty,
            props.css,
            s.content,
            mode,
            props.zoomable,
            props.maxZoom,
            props.allowScripts,
            props.wideTables,
            nonce
        ]
    );

    const makeFullscreenDoc = useCallback(
        () =>
            buildDocument({
                html: html ?? "",
                css: props.css,
                content: s.content,
                sizeMode: "parent",
                zoom: props.zoomable,
                maxZoom: props.maxZoom,
                allowScripts: props.allowScripts,
                tables: props.wideTables,
                nonce
            }),
        [html, props.css, s.content, props.zoomable, props.maxZoom, props.allowScripts, props.wideTables, nonce]
    );

    const loadKey = doc ? `${generation}|${doc}` : "";
    const loadKeyRef = useRef(loadKey);
    useLayoutEffect(() => {
        loadKeyRef.current = loadKey;
    });
    const ready = loadKey !== "" && readyFor === loadKey;
    const failed = loadKey !== "" && failedFor === loadKey;
    const spinner = !ready && spinnerFor === loadKey;
    const markReady = useCallback(() => setReadyFor(loadKeyRef.current), []);

    // New content: show the spinner only when loading is slow, and never forever.
    useEffect(() => {
        guard.current.reset();
        if (!loadKey) {
            return undefined;
        }
        const spin = setTimeout(() => setSpinnerFor(loadKey), SPINNER_DELAY_MS);
        const giveUp = setTimeout(() => setReadyFor(loadKey), READY_TIMEOUT_MS);
        const noHeight = setTimeout(() => {
            if (mode === "content" && heightFor.current !== loadKey) {
                console.warn("HtmlViewer: the page did not report its height. Showing it in a scrollable box.");
                setNoHeightFor(loadKey);
            }
        }, NO_HEIGHT_MS);
        return () => {
            clearTimeout(spin);
            clearTimeout(giveUp);
            clearTimeout(noHeight);
        };
    }, [loadKey, mode]);

    useEffect(() => {
        if (ready) {
            runAction(propsRef.current.onLoad);
        }
    }, [ready]);

    const onMessage = useCallback(
        (msg: FrameMessage) => {
            note(d => ({
                msgs: d.msgs + 1,
                last: msg.t === "h" ? `h=${msg.v}` : msg.t,
                jsError: msg.t === "jsError" ? String(msg.m ?? "").slice(0, 120) : d.jsError
            }));
            if (msg.t === "h") {
                heightFor.current = loadKeyRef.current;
                const next = guard.current.next(heightRef.current, msg.v, Date.now());
                if (next !== undefined) {
                    heightRef.current = next;
                    setContentHeight(next);
                } else if (guard.current.frozen) {
                    console.warn("HtmlViewer: the content keeps changing its height (vh units?). Height is fixed now.");
                }
                markReady();
            } else if (msg.t === "ready" && mode === "parent") {
                markReady();
            }
        },
        [mode, markReady, note]
    );

    const lastLink = useRef({ url: "", at: 0 });
    const onLink = useCallback((url: string) => {
        const now = Date.now();
        if (lastLink.current.url === url && now - lastLink.current.at < LINK_REPEAT_MS) {
            return; // one tap, one action (the page and the web view can both report it)
        }
        lastLink.current = { url, at: now };
        const p = propsRef.current;
        if (p.linkMode === "none") {
            return;
        }
        if (classifyLink(url) !== "open") {
            notify(textOf(p.linkErrorText, "This link cannot be opened."));
            return;
        }
        if (p.linkMode === "action") {
            if (p.linkAttribute?.status === ValueStatus.Available && !p.linkAttribute.readOnly) {
                p.linkAttribute.setValue(url);
            }
            runAction(p.onLinkPress);
            return;
        }
        Linking.openURL(url).catch(() => notify(textOf(p.linkErrorText, "This link cannot be opened.")));
    }, []);

    const onFail = useCallback(
        (reason: string) => {
            console.warn(`HtmlViewer: ${reason}`);
            note(() => ({ fail: reason }));
            setFailedFor(loadKeyRef.current);
            runAction(propsRef.current.onError);
        },
        [note]
    );

    const onBoxLayout = useCallback(
        (e: LayoutChangeEvent) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            if (w < 1 && forcedWidth === 0) {
                console.warn("HtmlViewer: the parent gives no width (row container?). Using the screen width.");
                setForcedWidth(win.width);
            }
            if (Math.abs(w - width) >= 1) {
                guard.current.reset(); // rotation or a new parent width: the height changes for real
                setWidth(w);
            }
            if (props.sizeMode === "parent" && !fallback && w > 0 && h < 2) {
                console.warn(
                    'HtmlViewer: "Fill parent" has no parent height here (inside a scroll container?). Using "Fit content".'
                );
                setFallback(true);
            }
        },
        [width, fallback, forcedWidth, win.width, props.sizeMode]
    );

    // ---- render ----
    const errorText = textOf(props.errorText, "The content cannot be shown.");
    const retryText = textOf(props.retryText, "Try again");

    const noHeight = mode === "content" && noHeightFor === loadKey;
    const fallbackHeight = Math.round(win.height * 0.6);
    const contentBox = noHeight
        ? maxHeight > 0
            ? Math.min(fallbackHeight, maxHeight)
            : fallbackHeight
        : boxHeight(contentHeight, maxHeight, PLACEHOLDER_HEIGHT);
    const box = [
        mode === "parent" ? styles.flex : { height: contentBox },
        forcedWidth > 0 ? { width: forcedWidth } : null
    ];
    const scrollable = mode === "parent" || noHeight || (maxHeight > 0 && (contentHeight ?? 0) > maxHeight);
    const showButton = props.fullscreenButton || (props.zoomable && mode === "content");

    // Diagnostic mode: shown in every state, also when there is nothing to show.
    const h = html ?? "";
    const statusHint =
        status === ValueStatus.Unavailable
            ? " (no context object, wrong attribute or no read access)"
            : status === ValueStatus.Loading
            ? " (still loading)"
            : "";
    const diagText = [
        `HtmlViewer ${VERSION} ${Platform.OS} ${Platform.Version} mode=${mode}${fallback ? " (fill->fit)" : ""}`,
        `html status ${status}${statusHint}, ${html === undefined ? "no value" : `${h.length} chars`}${
            empty ? " = EMPTY" : ""
        }`,
        `<img> ${(h.match(/<img\b/gi) ?? []).length}, base64 ${
            (h.match(/data:[^"')\s]*;base64,/gi) ?? []).length
        }, escaped ${/&lt;\s*img/i.test(h) ? "YES" : "no"}, starts "${h.slice(0, 40).replace(/\s+/g, " ")}"`,
        `box ${Math.round(width)}${forcedWidth ? "(forced)" : ""} x ${
            mode === "parent" ? "flex" : Math.round(contentBox)
        } content h=${contentHeight ?? "-"}${noHeight ? " NO HEIGHT" : ""}`,
        `loadEnd ${diag.loadEnd} msgs ${diag.msgs} last ${diag.last} ready ${ready ? "yes" : "no"} failed ${
            failed ? "yes" : "no"
        }`,
        `jsError ${diag.jsError} fail ${diag.fail}`,
        `settings height=${props.sizeMode} zoom=${props.zoomable ? "on" : "off"} scripts=${
            props.allowScripts ? "on" : "off"
        } baseUrl=${baseUrl ? "set" : "-"} screen ${Math.round(win.width)}x${Math.round(win.height)}`
    ].join("\n");
    const diagBox = props.debugMode ? (
        <Text style={styles.diag} selectable>
            {diagText}
        </Text>
    ) : null;

    // Diagnostic mode: everything in one dialog that stays until OK, so a screenshot is easy.
    const diagRef = useRef(diagText);
    useLayoutEffect(() => {
        diagRef.current = diagText;
    });
    const debugMode = props.debugMode;
    useEffect(() => {
        if (!debugMode) {
            return undefined;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const show = (): void => {
            Alert.alert(`HtmlViewer ${VERSION} diagnostic`, diagRef.current, [
                { text: "Again in 5 s", onPress: () => (timer = setTimeout(show, 5000)) },
                { text: "OK", style: "cancel" }
            ]);
        };
        timer = setTimeout(show, DIAG_DELAY_MS);
        return () => clearTimeout(timer);
    }, [debugMode]);

    if (html === undefined) {
        return (
            <View style={s.container} testID={props.name}>
                {diagBox}
                <View style={[styles.center, { minHeight: PLACEHOLDER_HEIGHT }]}>
                    <ActivityIndicator color={s.loadingIndicator.color} accessibilityLabel="Loading" />
                </View>
            </View>
        );
    }
    if (empty) {
        const text = textOf(props.emptyText, "");
        return text || diagBox ? (
            <View style={s.container} testID={props.name}>
                {diagBox}
                {text ? <Text style={s.empty}>{text}</Text> : null}
            </View>
        ) : null;
    }
    if (failed) {
        return (
            <View style={s.container} testID={props.name}>
                {diagBox}
                <ErrorView
                    styles={s}
                    text={errorText}
                    retryText={retryText}
                    onRetry={() => setGeneration(g => g + 1)}
                />
            </View>
        );
    }

    return (
        <View style={[s.container, mode === "parent" && styles.flex]} testID={props.name}>
            {diagBox}
            <View style={box} onLayout={onBoxLayout}>
                {width > 0 ? (
                    <HtmlFrame
                        key={generation}
                        doc={doc}
                        baseUrl={baseUrl}
                        mode={mode}
                        zoom={props.zoomable && mode === "parent"}
                        scrollable={scrollable}
                        offlineCache={props.offlineCache}
                        onMessage={onMessage}
                        onLoadEnd={() => {
                            note(d => ({ loadEnd: d.loadEnd + 1 }));
                            if (mode === "parent") {
                                markReady();
                            }
                        }}
                        onLink={onLink}
                        onFail={onFail}
                        testID={`${props.name}$web`}
                    />
                ) : null}
                {!ready && spinner ? (
                    <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
                        <ActivityIndicator color={s.loadingIndicator.color} accessibilityLabel="Loading" />
                    </View>
                ) : null}
                {showButton && ready ? (
                    <Pressable
                        onPress={() => setFullscreen(true)}
                        accessibilityRole="button"
                        accessibilityLabel={textOf(props.openLabel, "Open full screen")}
                        hitSlop={8}
                        style={({ pressed }) => [styles.expand, s.fullscreenButton, pressed && styles.pressed]}
                    >
                        <ExpandIcon color={s.fullscreenIcon.color} />
                    </Pressable>
                ) : null}
            </View>
            {showButton ? (
                <Fullscreen
                    visible={fullscreen}
                    onClose={() => setFullscreen(false)}
                    styles={s}
                    makeDoc={makeFullscreenDoc}
                    baseUrl={baseUrl}
                    zoom={props.zoomable}
                    offlineCache={props.offlineCache}
                    onLink={onLink}
                    closeLabel={textOf(props.closeLabel, "Close")}
                    errorText={errorText}
                    retryText={retryText}
                />
            ) : null}
        </View>
    );
}

export function HtmlViewer(props: Props): ReactElement {
    const merged = useMemo(() => mergeStyles(props.style), [props.style]);
    return (
        <Boundary
            debugMode={props.debugMode}
            styles={merged}
            text={textOf(props.errorText, "The content cannot be shown.")}
            retryText={textOf(props.retryText, "Try again")}
        >
            <Viewer {...props} styles={merged} />
        </Boundary>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    center: { alignItems: "center", justifyContent: "center" },
    expand: { position: "absolute", top: 8, right: 8, zIndex: 2 },
    pressed: { opacity: 0.7 },
    closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
    modalError: { flex: 1, padding: 16, justifyContent: "center" },
    diag: {
        marginBottom: 6,
        padding: 8,
        borderRadius: 6,
        backgroundColor: "#fff8e1",
        color: "#5d4300",
        fontSize: 11,
        lineHeight: 15,
        fontFamily: Platform.select({ ios: "Menlo", default: "monospace" })
    }
});
