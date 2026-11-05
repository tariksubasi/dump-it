import {
    boxHeight,
    buildDocument,
    classifyLink,
    clampZoom,
    cleanCss,
    contentStyleToCss,
    cssValue,
    DocumentOptions,
    HeightGuard,
    isEmptyHtml,
    isFullDocument,
    makeNonce,
    parseMessage
} from "../htmlDocument";
import { mergeStyles } from "../ui/styles";

const base: DocumentOptions = {
    html: "<p>Hi</p>",
    sizeMode: "content",
    zoom: false,
    maxZoom: 5,
    allowScripts: false,
    nonce: "n0nce"
};

describe("buildDocument", () => {
    it("wraps a fragment in a full document with viewport and charset", () => {
        const doc = buildDocument(base);
        expect(doc.startsWith("<!DOCTYPE html><html><head>")).toBe(true);
        expect(doc).toContain('<meta charset="utf-8">');
        expect(doc).toContain("width=device-width");
        expect(doc).toContain("<body><p>Hi</p></body>");
    });

    it("blocks HTML scripts with a nonce CSP but keeps the viewer script", () => {
        const doc = buildDocument(base);
        expect(doc).toContain("script-src 'nonce-n0nce'");
        expect(doc).toContain('<script nonce="n0nce">');
    });

    it("has no CSP when scripts are allowed", () => {
        expect(buildDocument({ ...base, allowScripts: true })).not.toContain("Content-Security-Policy");
    });

    it("turns zoom off or on in the viewport", () => {
        expect(buildDocument(base)).toContain("maximum-scale=1,user-scalable=no");
        expect(buildDocument({ ...base, zoom: true, maxZoom: 3 })).toContain("maximum-scale=3,user-scalable=yes");
    });

    it("measures height only in Fit content mode", () => {
        expect(buildDocument(base)).toContain("var measure = true");
        expect(buildDocument({ ...base, sizeMode: "parent" })).toContain("var measure = false");
        expect(buildDocument(base)).toContain("height:auto!important");
    });

    it("injects the head into a full document and adds a doctype", () => {
        const doc = buildDocument({
            ...base,
            html: '<html lang="tr"><head><title>T</title></head><body>x</body></html>'
        });
        expect(doc.startsWith("<!DOCTYPE html><html")).toBe(true);
        expect(doc).toMatch(/<head><meta charset="utf-8">[\s\S]*<title>T<\/title>/);
        expect(doc.match(/<head/g)?.length).toBe(1);
    });

    it("creates a head when a full document has none", () => {
        const doc = buildDocument({ ...base, html: "<!doctype html><html><body>x</body></html>" });
        expect(doc).toMatch(/<html><head><meta charset/);
        const noHtml = buildDocument({ ...base, html: "<body>x</body>" });
        expect(noHtml).toMatch(/^<!DOCTYPE html><head><meta charset/);
    });

    it("keeps user CSS last and cannot close the style element", () => {
        const doc = buildDocument({ ...base, css: "h1{color:red}</style><script>alert(1)</script>" });
        expect(doc).toContain("h1{color:red}<\\/style><script>alert(1)</script></style>");
        expect(doc.indexOf("h1{color:red}")).toBeGreaterThan(doc.indexOf("max-width:100%"));
    });

    it("lets wide tables scroll in their own box when asked", () => {
        expect(buildDocument(base)).toContain("table-layout:fixed");
        const doc = buildDocument({ ...base, tables: "scroll" });
        expect(doc).toContain("overflow-x:auto");
        expect(doc).not.toContain("table-layout:fixed");
    });

    it("has the no-overflow rules", () => {
        const doc = buildDocument(base);
        for (const rule of [
            "overflow-x:hidden",
            "max-width:100%",
            "table-layout:fixed",
            "pre-wrap",
            "overflow-wrap:anywhere"
        ]) {
            expect(doc).toContain(rule);
        }
    });
});

describe("style to CSS", () => {
    it("converts numbers to px and keeps safe strings", () => {
        expect(cssValue(16)).toBe("16px");
        expect(cssValue("#fff")).toBe("#fff");
        expect(cssValue("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
        expect(cssValue(NaN)).toBeUndefined();
        expect(cssValue("red;}body{display:none")).toBeUndefined();
        expect(cssValue("")).toBeUndefined();
    });

    it("maps content style keys and padding shortcuts", () => {
        const css = contentStyleToCss({
            color: "#111",
            fontSize: 15,
            lineHeight: 22,
            padding: 8,
            paddingHorizontal: 12,
            paddingTop: 2
        });
        expect(css).toContain("color:#111");
        expect(css).toContain("font-size:15px");
        expect(css).toContain("line-height:22px");
        expect(css).toContain("padding-top:2px");
        expect(css).toContain("padding-bottom:8px");
        expect(css).toContain("padding-left:12px");
    });

    it("quotes font names and strips unsafe characters", () => {
        expect(contentStyleToCss({ fontFamily: 'Open Sans, "x;}"' })).toBe('font-family:"Open Sans", "x"');
    });

    it("adds the link color", () => {
        expect(buildDocument({ ...base, content: { linkColor: "#0055aa" } })).toContain("a{color:#0055aa}");
    });

    it("cleans css and clamps zoom", () => {
        expect(cleanCss(undefined)).toBe("");
        expect(clampZoom(0)).toBe(1);
        expect(clampZoom(99)).toBe(10);
        expect(clampZoom(null)).toBe(5);
        expect(clampZoom(2.6)).toBe(3);
    });
});

describe("isEmptyHtml", () => {
    it.each([
        [undefined, true],
        ["", true],
        ["   ", true],
        ["<p></p>", true],
        ["<p>&nbsp;</p><br>", true],
        ["<!-- c --><style>p{}</style>", true],
        ["<p>a</p>", false],
        ['<img src="x.png">', false],
        ["<hr>", false],
        ["<table></table>", false]
    ])("%p -> %p", (html, empty) => {
        expect(isEmptyHtml(html as string | undefined)).toBe(empty);
    });
});

describe("isFullDocument", () => {
    it("detects documents", () => {
        expect(isFullDocument("<HTML><BODY>x</BODY></HTML>")).toBe(true);
        expect(isFullDocument("<p>body text</p>")).toBe(false);
        expect(isFullDocument("<bodyguard>")).toBe(false);
    });
});

describe("classifyLink", () => {
    it.each([
        ["https://example.com/a", undefined, "open"],
        ["http://example.com", undefined, "open"],
        ["mailto:a@b.c", undefined, "open"],
        ["tel:+905551112233", undefined, "open"],
        ["about:blank", undefined, "inside"],
        ["https://cdn.x.com/#top", "https://cdn.x.com", "inside"],
        ["https://cdn.x.com/page", "https://cdn.x.com/", "open"],
        ["javascript:alert(1)", undefined, "blocked"],
        ["file:///etc/passwd", undefined, "blocked"],
        ["intent://scan/#Intent;end", undefined, "blocked"],
        ["data:text/html,hi", undefined, "blocked"],
        ["", undefined, "blocked"],
        [undefined, undefined, "blocked"]
    ])("%p (base %p) -> %p", (url, baseUrl, kind) => {
        expect(classifyLink(url as string | undefined, baseUrl)).toBe(kind);
    });
});

describe("HeightGuard", () => {
    it("accepts real changes and ignores tiny ones and bad values", () => {
        const g = new HeightGuard();
        expect(g.next(undefined, 120.2, 0)).toBe(121);
        expect(g.next(121, 120.6, 1)).toBeUndefined();
        expect(g.next(121, -5, 2)).toBeUndefined();
        expect(g.next(121, "x", 3)).toBeUndefined();
        expect(g.next(121, Infinity, 4)).toBeUndefined();
        expect(g.next(121, 300, 5)).toBe(300);
    });

    it("freezes a resize loop and resets", () => {
        const g = new HeightGuard(5, 1000);
        let h = 100;
        for (let i = 0; i < 5; i++) {
            h = g.next(h, h + 50, i) ?? h;
        }
        expect(g.next(h, h + 50, 6)).toBeUndefined();
        expect(g.frozen).toBe(true);
        g.reset();
        expect(g.next(h, h + 50, 7)).toBe(h + 50);
    });

    it("allows slow changes forever", () => {
        const g = new HeightGuard(3, 1000);
        let h = 0;
        for (let i = 0; i < 20; i++) {
            const n = g.next(h, h + 10, i * 600);
            expect(n).toBe(h + 10);
            h = n as number;
        }
    });
});

describe("helpers", () => {
    it("box height uses placeholder, minimum 1 and the maximum", () => {
        expect(boxHeight(undefined, 0, 48)).toBe(48);
        expect(boxHeight(0, 0, 48)).toBe(1);
        expect(boxHeight(900, 300, 48)).toBe(300);
        expect(boxHeight(200, 300, 48)).toBe(200);
    });

    it("parses messages safely", () => {
        expect(parseMessage('{"t":"h","v":10}')).toEqual({ t: "h", v: 10 });
        expect(parseMessage("not json")).toBeUndefined();
        expect(parseMessage('{"v":1}')).toBeUndefined();
        expect(parseMessage(42)).toBeUndefined();
        expect(parseMessage("null")).toBeUndefined();
    });

    it("makes different nonces of safe characters", () => {
        const a = makeNonce();
        expect(a).toMatch(/^[a-z0-9]+$/);
        expect(a).not.toBe(makeNonce());
    });

    it("merges Mendix style arrays key by key", () => {
        const s = mergeStyles([
            { container: { padding: 4 } },
            undefined,
            { container: { margin: 2 }, content: { fontSize: 20 } }
        ]);
        expect(s.container).toMatchObject({ alignSelf: "stretch", padding: 4, margin: 2 });
        expect(s.content.fontSize).toBe(20);
        expect(s.content.linkColor).toBe("#1565c0");
        expect(mergeStyles(undefined).retryButton.minHeight).toBe(44);
    });
});
