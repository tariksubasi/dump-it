import { ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type {
    ShouldStartLoadRequest,
    WebViewErrorEvent,
    WebViewMessageEvent,
    WebViewOpenWindowEvent
} from "react-native-webview/lib/WebViewTypes";

/* global __DEV__ */

import { bootstrapScript, classifyLink, parseMessage, SizeMode } from "./htmlDocument";

export interface FrameMessage {
    t: string;
    v?: number;
    href?: string;
    m?: string;
}

export interface HtmlFrameProps {
    doc: string;
    baseUrl?: string;
    mode: SizeMode;
    /** Pinch zoom inside the web view. */
    zoom: boolean;
    /** The web view scrolls by itself (Fill parent, full screen, or taller than the maximum height). */
    scrollable: boolean;
    offlineCache: boolean;
    onMessage: (msg: FrameMessage) => void;
    onLoadEnd: () => void;
    onLink: (url: string) => void;
    onFail: (reason: string) => void;
    testID?: string;
}

const MAX_RECOVERIES = 3;
const RECOVERY_WINDOW_MS = 60_000;
// iOS reports these when a navigation is cancelled (also when this widget blocks a link). Not a failure.
const IGNORED_ERRORS = new Set([-999, 102, 204]);

const RETRY_SCRIPT = "window.__hv&&(window.__hv.retry(true),window.__hv.report(true));true;";

/** One web view. Recovers by itself when the web content process dies. */
export function HtmlFrame(props: HtmlFrameProps): ReactElement {
    const ref = useRef<WebView>(null);
    const [generation, setGeneration] = useState(0);
    const recoveries = useRef<number[]>([]);
    const latest = useRef(props);
    useLayoutEffect(() => {
        latest.current = props;
    });

    // The app comes back to the front: the network may be back, and the size may have changed.
    useEffect(() => {
        const sub = AppState.addEventListener("change", state => {
            if (state === "active") {
                ref.current?.injectJavaScript(RETRY_SCRIPT);
            }
        });
        return () => sub.remove();
    }, []);

    const recover = useCallback((reason: string) => {
        const now = Date.now();
        recoveries.current = recoveries.current.filter(t => now - t < RECOVERY_WINDOW_MS);
        recoveries.current.push(now);
        if (recoveries.current.length > MAX_RECOVERIES) {
            latest.current.onFail(reason);
        } else {
            console.warn(`HtmlViewer: ${reason}, loading again.`);
            setGeneration(g => g + 1);
        }
    }, []);

    const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest): boolean => {
        if (req.isTopFrame === false) {
            return true; // an iframe (for example a video) loads its own page
        }
        const kind = classifyLink(req.url, latest.current.baseUrl);
        if (kind === "inside") {
            return true;
        }
        // The page script reports taps itself. This catches a tap it missed (iOS only says "click").
        if (kind === "open" && Platform.OS === "ios" && req.navigationType === "click") {
            latest.current.onLink(req.url);
        }
        return false; // never leave the HTML: no redirects, form posts or meta refresh
    }, []);

    const onMessage = useCallback((e: WebViewMessageEvent) => {
        const msg = parseMessage(e.nativeEvent.data);
        if (!msg) {
            return;
        }
        if (msg.t === "link" && typeof msg.href === "string") {
            latest.current.onLink(msg.href);
        } else {
            if (msg.t === "jsError") {
                console.warn("HtmlViewer: script error in the HTML:", msg.m);
            }
            latest.current.onMessage(msg);
        }
    }, []);

    const onError = useCallback((e: WebViewErrorEvent) => {
        const { code, description, url } = e.nativeEvent;
        if (IGNORED_ERRORS.has(code)) {
            return;
        }
        const kind = classifyLink(url, latest.current.baseUrl);
        if (url && kind !== "inside") {
            return; // a blocked link or a sub-resource, not the document
        }
        latest.current.onFail(`load error ${code}: ${description}`);
    }, []);

    const onOpenWindow = useCallback((e: WebViewOpenWindowEvent) => {
        latest.current.onLink(e.nativeEvent.targetUrl);
    }, []);

    // Measure again after the load, also when the page script started too early or not at all.
    const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);
    const onLoadEnd = useCallback(() => {
        const script = `${bootstrapScript(latest.current.mode)}\ntrue;`;
        ref.current?.injectJavaScript(script);
        timers.current.forEach(clearTimeout);
        timers.current = [1500, 4000].map(ms => setTimeout(() => ref.current?.injectJavaScript(script), ms));
        latest.current.onLoadEnd();
    }, []);

    const { scrollable, zoom } = props;
    return (
        <WebView
            key={generation}
            ref={ref}
            testID={props.testID}
            source={{ html: props.doc, baseUrl: props.baseUrl }}
            originWhitelist={["*"]}
            style={styles.web}
            containerStyle={styles.web}
            injectedJavaScript={`${bootstrapScript(props.mode)}\ntrue;`}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            onOpenWindow={onOpenWindow}
            onLoadEnd={onLoadEnd}
            onError={onError}
            onRenderProcessGone={() => recover("Android web view process stopped")}
            onContentProcessDidTerminate={() => recover("iOS web content process stopped")}
            // scrolling and zoom
            scrollEnabled={scrollable}
            nestedScrollEnabled={scrollable}
            bounces={scrollable}
            overScrollMode={scrollable ? "content" : "never"}
            showsVerticalScrollIndicator={scrollable}
            showsHorizontalScrollIndicator={false}
            setBuiltInZoomControls={zoom}
            setDisplayZoomControls={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            // network and cache
            cacheEnabled
            cacheMode={props.offlineCache ? "LOAD_CACHE_ELSE_NETWORK" : "LOAD_DEFAULT"}
            mixedContentMode="compatibility"
            // safety: no files, no storage, no new windows, no location
            javaScriptEnabled
            domStorageEnabled={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            setSupportMultipleWindows={false}
            geolocationEnabled={false}
            allowsLinkPreview={false}
            dataDetectorTypes="none"
            // media
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            allowsFullscreenVideo
            textInteractionEnabled
            webviewDebuggingEnabled={typeof __DEV__ !== "undefined" && __DEV__}
        />
    );
}

const styles = StyleSheet.create({
    web: { flex: 1, backgroundColor: "transparent" }
});
