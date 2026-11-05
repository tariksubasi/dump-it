// Pure functions: no React Native imports, so the unit tests run in plain Node.

export type SizeMode = "content" | "parent";

/** The text style keys that the widget style "content" can give to the HTML body. */
export interface ContentStyle {
    color?: string;
    backgroundColor?: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string | number;
    lineHeight?: number;
    letterSpacing?: number;
    textAlign?: string;
    padding?: number;
    paddingHorizontal?: number;
    paddingVertical?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    /** Not a React Native key: the color of links. */
    linkColor?: string;
}

export interface DocumentOptions {
    html: string;
    css?: string;
    content?: ContentStyle;
    /** "content": the page measures itself and reports its height. */
    sizeMode: SizeMode;
    /** Allow pinch zoom inside the web view. */
    zoom: boolean;
    maxZoom: number;
    allowScripts: boolean;
    /** fit: columns shrink to the width. scroll: a wide table scrolls sideways in its own box. */
    tables?: "fit" | "scroll";
    /** Random per document; only the viewer's own script may run when scripts are off. */
    nonce: string;
}

// ---- value cleaning ----------------------------------------------------------

const SAFE_CSS_VALUE = /^[#a-zA-Z0-9(),.%\s+-]+$/;

/** A CSS value from a style, or undefined if it could break out of the declaration. */
export function cssValue(value: unknown): string | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? `${value}px` : undefined;
    }
    if (typeof value === "string") {
        const v = value.trim();
        return v && SAFE_CSS_VALUE.test(v) ? v : undefined;
    }
    return undefined;
}

function fontFamilyValue(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const names = value
        .split(",")
        .map(n => n.replace(/["';{}<>\\]/g, "").trim())
        .filter(Boolean);
    return names.length ? names.map(n => `"${n}"`).join(", ") : undefined;
}

export function clampZoom(value: number | undefined | null): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 5;
    }
    return Math.min(10, Math.max(1, Math.round(value)));
}

/** Stops user CSS from closing the style element. */
export function cleanCss(css: string | undefined): string {
    return (css ?? "").replace(/<\/(style)/gi, "<\\/$1");
}

/** React Native text style -> CSS declarations for the body. */
export function contentStyleToCss(style: ContentStyle | undefined): string {
    if (!style) {
        return "";
    }
    const out: string[] = [];
    const add = (prop: string, value: string | undefined): void => {
        if (value !== undefined) {
            out.push(`${prop}:${value}`);
        }
    };
    add("color", cssValue(style.color));
    add("background-color", cssValue(style.backgroundColor));
    add("font-size", cssValue(style.fontSize));
    add("font-family", fontFamilyValue(style.fontFamily));
    add("font-weight", cssValue(typeof style.fontWeight === "number" ? String(style.fontWeight) : style.fontWeight));
    add("line-height", cssValue(style.lineHeight));
    add("letter-spacing", cssValue(style.letterSpacing));
    add("text-align", cssValue(style.textAlign));

    const all = style.padding;
    const v = style.paddingVertical ?? all;
    const h = style.paddingHorizontal ?? all;
    add("padding-top", cssValue(style.paddingTop ?? v));
    add("padding-bottom", cssValue(style.paddingBottom ?? v));
    add("padding-left", cssValue(style.paddingLeft ?? h));
    add("padding-right", cssValue(style.paddingRight ?? h));
    return out.join(";");
}

// ---- document ------------------------------------------------------------------

/** True when the HTML shows nothing: no text and no media. */
export function isEmptyHtml(html: string | undefined | null): boolean {
    if (!html || !html.trim()) {
        return true;
    }
    if (/<(img|svg|video|audio|iframe|canvas|object|embed|picture|hr|input|table)\b/i.test(html)) {
        return false;
    }
    const text = html
        .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
        .trim();
    return text.length === 0;
}

export function isFullDocument(html: string): boolean {
    return /<html[\s>]|<body[\s>]|<head[\s>]/i.test(html);
}

export function makeNonce(random: () => number = Math.random): string {
    let s = "";
    for (let i = 0; i < 4; i++) {
        s += Math.floor(random() * 0xffffffff)
            .toString(36)
            .padStart(7, "0");
    }
    return s;
}

/** The built-in CSS: nothing may be wider than the screen. */
export function baseCss(opts: Pick<DocumentOptions, "sizeMode" | "content" | "tables">): string {
    const link = cssValue(opts.content?.linkColor);
    const sizeRules =
        opts.sizeMode === "content"
            ? // The page reports its own height: it must not depend on the web view height.
              "html,body{height:auto!important;min-height:0!important}"
            : "html,body{min-height:100%}";
    return [
        ":root{color-scheme:light}",
        "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
        "html,body{margin:0;padding:0;max-width:100%;overflow-x:hidden;background:transparent}",
        // flow-root keeps child margins inside the body, so the measured height is exact.
        "body{display:flow-root;overflow-wrap:anywhere;word-wrap:break-word;-webkit-tap-highlight-color:rgba(0,0,0,0.08);" +
            "font-family:-apple-system,system-ui,Roboto,'Segoe UI',Arial,sans-serif}",
        sizeRules,
        "*,*::before,*::after{box-sizing:border-box;max-width:100%}",
        // Shrink wide media; object-fit stops a fixed height from stretching a shrunk image.
        "img,svg,video,canvas,picture,object,embed{max-width:100%!important}",
        "img{border:0;vertical-align:middle;object-fit:contain}",
        // Both sizes given: keep the ratio when the width shrinks. Height only (an icon): keep it.
        "img[width][height],video,canvas,object,embed{height:auto}",
        // Inline width and height (for example from an editor): the inline height must give way too.
        "img[style*='width'][style*='height']{height:auto!important}",
        "iframe{max-width:100%!important;width:100%;border:0;aspect-ratio:16/9;height:auto}",
        ...(opts.tables === "scroll"
            ? [
                  // The table box scrolls sideways; the page itself never does.
                  "table{display:block;max-width:100%!important;width:auto!important;overflow-x:auto;" +
                      "-webkit-overflow-scrolling:touch;border-collapse:collapse}",
                  "td,th{overflow-wrap:normal;word-break:normal;min-width:72px;vertical-align:top}"
              ]
            : [
                  "table{width:100%!important;max-width:100%;table-layout:fixed;border-collapse:collapse}",
                  "td,th{word-break:break-word;overflow-wrap:anywhere;vertical-align:top}"
              ]),
        "pre,code,kbd,samp{white-space:pre-wrap!important;word-break:break-word;overflow-wrap:anywhere}",
        "[style*='width']{max-width:100%!important}",
        "a{word-break:break-word}",
        link ? `a{color:${link}}` : "",
        // A broken image keeps a visible, tappable box with its alt text.
        "img.hv-broken{display:inline-block;min-width:64px;min-height:64px;width:auto;background:#f1f3f5;" +
            "border:1px solid #dfe3e8;border-radius:8px;color:#5f6b7a;font-size:13px;padding:8px;object-fit:none}"
    ]
        .filter(Boolean)
        .join("\n");
}

/** The viewer script. It runs inside the web view; keep it plain ES5. */
export function bootstrapScript(sizeMode: SizeMode): string {
    return `(function(){
if (window.__hv) { window.__hv.report(true); return; }
var measure = ${sizeMode === "content" ? "true" : "false"};
function post(m){ try { if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } } catch (e) {} }
var last = -1, pending = 0;
function height(){
  var b = document.body, d = document.documentElement;
  if (!b || !d) { return 0; }
  var cs = window.getComputedStyle ? getComputedStyle(b) : null;
  var m = cs ? (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0) : 0;
  return Math.ceil(Math.max(d.getBoundingClientRect().height, b.scrollHeight + m, b.getBoundingClientRect().height + m));
}
function report(force){
  if (!measure) { return; }
  if (pending) { return; }
  var run = function(){ pending = 0; var h = height(); if (force || Math.abs(h - last) >= 1) { last = h; post({ t: "h", v: h }); } };
  pending = 1;
  var done = false, once = function(){ if (!done) { done = true; run(); } };
  if (window.requestAnimationFrame) { requestAnimationFrame(once); }
  setTimeout(once, 100); // a hidden web view may pause animation frames
}
var tries = 0, timer = 0;
function broken(){ return document.querySelectorAll ? document.querySelectorAll("img.hv-broken") : []; }
function retry(reset){
  if (reset) { tries = 0; }
  var list = broken();
  for (var i = 0; i < list.length; i++) {
    var img = list[i], src = img.getAttribute("src"), set = img.getAttribute("srcset");
    if (set) { img.removeAttribute("srcset"); img.setAttribute("srcset", set); }
    if (src) { img.removeAttribute("src"); img.setAttribute("src", src); }
  }
}
function schedule(){
  if (timer || tries >= 8) { return; }
  var wait = Math.min(60000, 3000 * Math.pow(2, tries));
  timer = setTimeout(function(){ timer = 0; tries++; if (broken().length) { retry(false); schedule(); } }, wait);
}
document.addEventListener("error", function(e){
  var t = e.target;
  if (t && t.tagName === "IMG") { if (t.classList) { t.classList.add("hv-broken"); } schedule(); report(); }
}, true);
document.addEventListener("load", function(e){
  var t = e.target;
  if (t && t.tagName === "IMG" && t.classList) { t.classList.remove("hv-broken"); }
  report();
}, true);
window.addEventListener("online", function(){ retry(true); });
window.addEventListener("error", function(e){ if (e && e.target === window) { post({ t: "jsError", m: String(e.message || "") }); } });
document.addEventListener("click", function(e){
  var t = e.target;
  if (t && t.tagName === "IMG" && t.classList && t.classList.contains("hv-broken")) {
    e.preventDefault(); e.stopPropagation(); retry(true); return;
  }
  var a = t && t.closest ? t.closest("a[href]") : null;
  if (!a) { return; }
  var raw = (a.getAttribute("href") || "").trim();
  if (raw === "" || raw.charAt(0) === "#") { return; }
  e.preventDefault();
  post({ t: "link", href: a.href || raw });
}, true);
function init(){
  var b = document.body;
  if (!b) { return; }
  if (measure) {
    if (window.ResizeObserver) { var ro = new ResizeObserver(function(){ report(); }); ro.observe(b); ro.observe(document.documentElement); }
    if (window.MutationObserver) { new MutationObserver(function(){ report(); }).observe(b, { childList: true, subtree: true, attributes: true, characterData: true }); }
    window.addEventListener("resize", function(){ report(); });
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function(){ report(); }); }
    var waits = [50, 300, 1000, 3000];
    for (var i = 0; i < waits.length; i++) { setTimeout(function(){ report(); }, waits[i]); }
  }
  var imgs = document.images || [];
  for (var j = 0; j < imgs.length; j++) {
    if (imgs[j].complete && imgs[j].getAttribute("src") && imgs[j].naturalWidth === 0) { imgs[j].classList.add("hv-broken"); schedule(); }
  }
  report(true);
  post({ t: "ready" });
}
window.__hv = { report: report, retry: retry };
if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
window.addEventListener("load", function(){ report(true); });
})();`;
}

/** The full HTML document for the web view. */
export function buildDocument(opts: DocumentOptions): string {
    const zoomMax = opts.zoom ? clampZoom(opts.maxZoom) : 1;
    const viewport =
        `width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=${zoomMax},` +
        `user-scalable=${opts.zoom ? "yes" : "no"},viewport-fit=cover`;
    const csp = opts.allowScripts
        ? ""
        : `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${opts.nonce}'; object-src 'none'">`;
    const bodyCss = contentStyleToCss(opts.content);
    const head =
        `<meta charset="utf-8"><meta name="viewport" content="${viewport}">${csp}` +
        `<meta name="format-detection" content="telephone=no">` +
        `<style>${baseCss(opts)}${bodyCss ? `\nbody{${bodyCss}}` : ""}</style>` +
        (opts.css ? `<style>${cleanCss(opts.css)}</style>` : "") +
        `<script nonce="${opts.nonce}">${bootstrapScript(opts.sizeMode)}</script>`;

    const html = opts.html ?? "";
    if (!isFullDocument(html)) {
        return `<!DOCTYPE html><html><head>${head}</head><body>${html}</body></html>`;
    }
    // A full document: put the viewer head first, so the document's own CSS can still win.
    let doc = /<!doctype/i.test(html) ? html : `<!DOCTYPE html>${html}`;
    if (/<head[^>]*>/i.test(doc)) {
        doc = doc.replace(/<head[^>]*>/i, m => m + head);
    } else if (/<html[^>]*>/i.test(doc)) {
        doc = doc.replace(/<html[^>]*>/i, m => `${m}<head>${head}</head>`);
    } else {
        doc = doc.replace(/<!doctype[^>]*>/i, m => `${m}<head>${head}</head>`);
    }
    return doc;
}

// ---- links ---------------------------------------------------------------------------

export type LinkKind = "inside" | "open" | "blocked";

const OPEN_SCHEMES = /^(https?|mailto|tel|sms|geo|maps|whatsapp|market|itms-apps):/i;

function stripHash(url: string): string {
    const i = url.indexOf("#");
    return i < 0 ? url : url.slice(0, i);
}

/**
 * inside: the document itself (first load, in-page anchor) -> let the web view load it.
 * open: a real link -> hand it to the app or the browser.
 * blocked: unsafe or unknown scheme (javascript:, file:, intent:, data: ...).
 */
export function classifyLink(url: string | undefined, baseUrl?: string): LinkKind {
    const u = (url ?? "").trim();
    if (!u) {
        return "blocked";
    }
    if (/^about:(blank|srcdoc)/i.test(u)) {
        return "inside";
    }
    if (baseUrl && stripHash(u).replace(/\/$/, "") === stripHash(baseUrl.trim()).replace(/\/$/, "")) {
        return "inside";
    }
    return OPEN_SCHEMES.test(u) ? "open" : "blocked";
}

// ---- height ------------------------------------------------------------------------

/**
 * Accepts height reports from the page. Stops a resize loop (for example content sized in vh),
 * which would otherwise grow without end.
 */
export class HeightGuard {
    private stamps: number[] = [];
    frozen = false;

    constructor(private readonly maxChanges = 30, private readonly windowMs = 3000) {}

    /** The new height to use, or undefined to keep the current one. */
    next(current: number | undefined, reported: unknown, now: number): number | undefined {
        if (this.frozen || typeof reported !== "number" || !Number.isFinite(reported) || reported < 0) {
            return undefined;
        }
        const h = Math.min(Math.ceil(reported), 1_000_000);
        if (current !== undefined && Math.abs(h - current) < 1) {
            return undefined;
        }
        this.stamps = this.stamps.filter(t => now - t < this.windowMs);
        this.stamps.push(now);
        if (this.stamps.length > this.maxChanges) {
            this.frozen = true;
            return undefined;
        }
        return h;
    }

    reset(): void {
        this.stamps = [];
        this.frozen = false;
    }
}

/** Height of the viewer box in "Fit content" mode. */
export function boxHeight(content: number | undefined, maxHeight: number, placeholder: number): number {
    const h = content === undefined ? placeholder : Math.max(1, content);
    return maxHeight > 0 ? Math.min(h, maxHeight) : h;
}

/** Parse a message from the page. Never throws. */
export function parseMessage(data: unknown): { t: string; v?: number; href?: string; m?: string } | undefined {
    if (typeof data !== "string" || data.length > 100_000) {
        return undefined;
    }
    try {
        const msg = JSON.parse(data);
        return msg && typeof msg.t === "string" ? msg : undefined;
    } catch {
        return undefined;
    }
}
