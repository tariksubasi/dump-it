/* global globalThis */
import { ReactElement, useContext, useEffect, useLayoutEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { ValueStatus } from "mendix";

import { ClientCacheProps } from "../typings/ClientCacheProps";
import { parseRules } from "./cacheRules";
import { FetchCache, isWrapped } from "./fetchCache";

const VERSION = "1.2.0";

function makeResponse(text: string, status: number, headers: Record<string, string>): any {
    const R = (globalThis as any).Response;
    if (typeof R === "function") {
        return new R(text, { status, statusText: status === 200 ? "OK" : "", headers });
    }
    // minimal fallback with what the Mendix client reads (status, ok, text/json)
    const self: any = {
        status,
        ok: status >= 200 && status < 300,
        statusText: "OK",
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null, forEach: () => undefined },
        text: async () => text,
        json: async () => JSON.parse(text),
        clone: () => makeResponse(text, status, headers)
    };
    return self;
}

export const cache = new FetchCache(makeResponse);

function install(): boolean {
    const g = globalThis as any;
    // For a JavaScript action "ClearClientCache" (refresh buttons, pull to refresh): globalThis.dumpitClientCache.clear()
    g.dumpitClientCache ??= {
        clear: (reason?: string) => cache.invalidate(reason ?? "cleared by the app"),
        stats: () => ({ ...cache.stats, entries: cache.store.size })
    };
    if (typeof g.fetch !== "function" || isWrapped(g.fetch)) {
        return false;
    }
    const original = g.fetch.bind(g);
    g.fetch = cache.wrap(original);
    if (g.window && g.window !== g && typeof g.window.fetch === "function" && !isWrapped(g.window.fetch)) {
        g.window.fetch = g.fetch;
    }
    return true;
}

function report(): string {
    const s = cache.stats;
    const seen = Array.from(s.seen.entries())
        .reverse()
        .slice(0, 12)
        .map(
            ([op, v]) =>
                `${
                    cache.learnedNever.has(op)
                        ? "NEVER (wrote / side effect)"
                        : v.clean
                        ? "clean read"
                        : "not cacheable"
                }  ${v.ms}ms  ${Math.round(v.bytes / 1024)}KB  x${v.count}\n${op}`
        )
        .join("\n\n");
    return (
        `mode ${cache.config.mode}  hits ${s.hits}  misses ${s.misses}  stored ${s.stored}  entries ${cache.store.size}\n` +
        `deduped ${s.deduped}  cleared ${s.invalidations}\n\nMicroflow calls (newest first):\n\n${
            seen || "-"
        }\n\nLog:\n${s.log.slice(-8).join("\n")}`
    );
}

export function ClientCache(props: ClientCacheProps<object>): ReactElement | null {
    const [, setTick] = useState(0);
    const navigation = useContext(NavigationContext);
    // Page opened (mount while focused) or shown again (focus, e.g. back): start the page-open window.
    useEffect(() => {
        if (!navigation || navigation.isFocused()) {
            cache.markPageOpen();
        }
        return navigation?.addListener("focus", () => cache.markPageOpen());
    }, [navigation]);
    useLayoutEffect(() => {
        const enabled = props.enabled.status !== ValueStatus.Available || props.enabled.value !== false;
        if (!enabled && cache.config.enabled) {
            cache.invalidate("disabled");
        }
        cache.config = {
            enabled,
            rules: parseRules(props.rules),
            clearOn: props.clearOn,
            useFor: props.useFor,
            pageOpenWindowMs: Math.min(10_000, Math.max(500, props.pageOpenWindowMs)),
            mode: props.mode,
            autoTtlMs: Math.min(600, Math.max(1, props.autoTtlSeconds)) * 1000
        };
    });
    useEffect(() => {
        install();
    }, []);
    const debug = props.debugMode;
    useEffect(() => {
        if (!debug) {
            return undefined;
        }
        const t = setInterval(() => setTick(n => n + 1), 2000);
        return () => clearInterval(t);
    }, [debug]);
    if (!debug) {
        return null;
    }
    return (
        <Pressable
            onPress={() => Alert.alert(`ClientCache ${VERSION}`, report())}
            accessibilityRole="button"
            style={styles.chip}
            testID={props.name}
        >
            <Text style={styles.chipText}>
                Cache {cache.stats.hits}/{cache.stats.hits + cache.stats.misses} · {cache.store.size}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    chip: {
        alignSelf: "flex-start",
        margin: 4,
        paddingHorizontal: 10,
        minHeight: 28,
        justifyContent: "center",
        borderRadius: 14,
        backgroundColor: "#EEF3FB",
        borderWidth: 1,
        borderColor: "#D7DEE6"
    },
    chipText: { fontSize: 12, color: "#1558B0", fontWeight: "600" }
});
