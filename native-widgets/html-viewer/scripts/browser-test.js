// Real browser test of the generated HTML (Android WebView is Chromium). Run: npm run test:browser
const { chromium } = require("playwright");
const { buildDocument } = require("../dist/browser/htmlDocument.js");
const svg = (w, h) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#69c"/></svg>`);
const html = `
<h1>Başlık çok uzun kelime: Pneumonoultramicroscopicsilicovolcanoconiosis_ve_https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</h1>
<p>Geniş resim:</p><img id="wide" src="${svg(3000, 1000)}">
<p>Attr resim:</p><img id="attr" src="${svg(2000, 1000)}" width="2000" height="1000">
<p>Inline px: <img id="inline" src="${svg(1600, 800)}" style="width:1600px;height:800px"></p>
<p>İkon <img id="icon" src="${svg(512, 512)}" height="20"> metin</p>
<p>Kırık: <img id="broken" src="http://127.0.0.1:9/x.png" alt="resim yok"></p>
<div id="wdiv" style="width:1200px;background:#eee">1200px div</div>
<table id="tbl" border="1"><tr>${Array.from({length: 12}, (_, i) => `<td>Kolon ${i} uzunuzunuzunuzunuzunmetin</td>`).join("")}</tr></table>
<pre id="pre">const x = "${"a".repeat(400)}";</pre>
<iframe id="ifr" srcdoc="<p>iframe</p>" width="1000" height="600"></iframe>
<p><a id="lnk" href="https://www.mendix.com/x">Link</a> <a id="hash" href="#top">anchor</a></p>
<script>window.pwned = true;</script><button id="btn" onclick="window.pwned2=true">x</button>
`;
async function load(page, doc) {
  await page.unroute("**/*").catch(() => {});
  await page.route("http://hv.test/**", r => r.fulfill({ contentType: "text/html; charset=utf-8", body: doc }));
  await page.goto("http://hv.test/doc", { waitUntil: "load" });
}
const sizes = [[320, 640], [360, 800], [768, 1024], [800, 360], [1280, 800]];
(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  const check = (name, ok, info) => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? "  " + info : ""}`); };
  for (const [w, h] of sizes) {
    for (const mode of ["content", "parent"]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.addInitScript(() => { window.__msgs = []; window.ReactNativeWebView = { postMessage: m => window.__msgs.push(JSON.parse(m)) }; });
      const doc = buildDocument({ html, sizeMode: mode, zoom: mode === "parent", maxZoom: 5, allowScripts: false, nonce: "abc123", content: { fontSize: 16, padding: 12, linkColor: "#1565c0" } });
      await load(page, doc);
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        let worst = 0, who = "";
        for (const el of document.body.querySelectorAll("*")) {
          const b = el.getBoundingClientRect();
          if (b.right - vw > worst) { worst = b.right - vw; who = el.tagName + "#" + el.id; }
        }
        const g = id => document.getElementById(id).getBoundingClientRect();
        const hs = window.__msgs.filter(m => m.t === "h");
        return {
          vw, scrollW: document.documentElement.scrollWidth, worst, who,
          wide: [g("wide").width, g("wide").height], attr: [g("attr").width, g("attr").height],
          inline: [g("inline").width, g("inline").height], icon: g("icon").height,
          broken: document.getElementById("broken").classList.contains("hv-broken"),
          hv: !!window.__hv, pwned: !!window.pwned, ready: window.__msgs.some(m => m.t === "ready"),
          lastH: hs.length ? hs[hs.length - 1].v : null, realH: Math.ceil(document.documentElement.getBoundingClientRect().height), nH: hs.length
        };
      });
      const tag = `${w}x${h} ${mode}`;
      check(`${tag} no horizontal overflow`, r.scrollW <= r.vw && r.worst <= 1, `scrollW=${r.scrollW} vw=${r.vw} worst=${r.worst.toFixed(1)} ${r.who}`);
      check(`${tag} wide image fits, ratio 3:1`, r.wide[0] <= r.vw && Math.abs(r.wide[0] / r.wide[1] - 3) < 0.05, r.wide.join("x"));
      check(`${tag} width+height attrs keep ratio`, r.attr[0] <= r.vw && Math.abs(r.attr[0] / r.attr[1] - 2) < 0.05, r.attr.join("x"));
      check(`${tag} inline px image fits, ratio 2:1`, r.inline[0] <= r.vw && Math.abs(r.inline[0] / r.inline[1] - 2) < 0.05, r.inline.join("x"));
      check(`${tag} height-only icon stays 20px`, Math.abs(r.icon - 20) < 0.5, String(r.icon));
      check(`${tag} broken image marked`, r.broken);
      check(`${tag} viewer script runs, HTML script blocked`, r.hv && !r.pwned && r.ready);
      if (mode === "content") check(`${tag} reported height = real height`, r.lastH !== null && Math.abs(r.lastH - r.realH) <= 1, `reported=${r.lastH} real=${r.realH} msgs=${r.nH}`);
      else check(`${tag} no height messages in parent mode`, r.nH === 0);
      if (w === 360 && mode === "content") await page.screenshot({ path: __dirname + "/../dist/browser/phone-content.png", fullPage: true });
      // link tap -> message, no navigation; anchor -> no message
      await page.evaluate(() => { window.__msgs = []; });
      await page.tap("#lnk"); await page.tap("#hash"); await page.waitForTimeout(100);
      const links = await page.evaluate(() => window.__msgs.filter(m => m.t === "link").map(m => m.href));
      check(`${tag} link reported once, anchor ignored`, links.length === 1 && links[0] === "https://www.mendix.com/x", JSON.stringify(links));
      await page.tap("#btn"); const p2 = await page.evaluate(() => !!window.pwned2);
      check(`${tag} onclick attribute blocked`, !p2);
      if (mode === "content" && w === 360) {
        // rotate: width change -> new height reported
        await page.evaluate(() => { window.__msgs = []; });
        await page.setViewportSize({ width: 800, height: 360 }); await page.waitForTimeout(400);
        const rot = await page.evaluate(() => ({ h: window.__msgs.filter(m => m.t === "h").pop(), real: Math.ceil(document.documentElement.getBoundingClientRect().height) }));
        check(`rotate 360->800 reports new height`, rot.h && Math.abs(rot.h.v - rot.real) <= 1, JSON.stringify(rot));
        // the web view height follows the report: must not change the measured height (no loop)
        await page.evaluate(() => { window.__msgs = []; });
        await page.setViewportSize({ width: 800, height: rot.real }); await page.waitForTimeout(400);
        const after = await page.evaluate(() => window.__msgs.filter(m => m.t === "h").length);
        check(`height follow does not trigger a new report (no loop)`, after === 0, `msgs=${after}`);
        // tap broken image -> retry, still broken, no crash
        await page.tap("#broken"); await page.waitForTimeout(300);
        check(`tap broken image retries safely`, await page.evaluate(() => document.getElementById("broken").classList.contains("hv-broken")));
      }
      if (w === 360 && mode === "content") {}
      await page.close();
    }
  }
  // vh loop content: reports grow with the web view; the RN guard must stop it
  const page = await browser.newPage({ viewport: { width: 360, height: 100 } });
  await page.addInitScript(() => { window.__msgs = []; window.ReactNativeWebView = { postMessage: m => window.__msgs.push(JSON.parse(m)) }; });
  await load(page, buildDocument({ html: '<div style="height:100vh;padding:10px">vh</div><p>x</p>', sizeMode: "content", zoom: false, maxZoom: 5, allowScripts: false, nonce: "n" }));
  await page.waitForTimeout(300);
  const g1 = await page.evaluate(() => window.__msgs.filter(m => m.t === "h").pop().v);
  await page.setViewportSize({ width: 360, height: g1 }); await page.waitForTimeout(300);
  const g2 = await page.evaluate(() => window.__msgs.filter(m => m.t === "h").pop().v);
  check(`vh content grows with the view (guard needed, HeightGuard unit-tested)`, g2 > g1, `${g1} -> ${g2}`);
  // full document with its own head and quirks
  await load(page, buildDocument({ html: '<html><head><style>body{margin:40px}</style></head><body><p style="margin:30px 0">t</p></body></html>', sizeMode: "content", zoom: false, maxZoom: 5, allowScripts: false, nonce: "n" }));
  await page.setViewportSize({ width: 360, height: 640 }); await page.waitForTimeout(300);
  const fd = await page.evaluate(() => ({ h: window.__msgs.filter(m => m.t === "h").pop().v, real: Math.ceil(document.documentElement.getBoundingClientRect().height) }));
  check(`full document with body margins measured exactly`, Math.abs(fd.h - fd.real) <= 1 && fd.h > 100, JSON.stringify(fd));
  for (const [w, h] of sizes) {
    const pg = await browser.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    await load(pg, buildDocument({ html, sizeMode: "content", zoom: false, maxZoom: 5, allowScripts: false, nonce: "n", tables: "scroll", content: { padding: 12 } }));
    await pg.waitForTimeout(300);
    const t = await pg.evaluate(() => { const e = document.getElementById("tbl"); return { page: document.documentElement.scrollWidth, vw: innerWidth, tw: e.getBoundingClientRect().right, sw: e.scrollWidth, cw: e.clientWidth }; });
    check(`${w}x${h} scroll tables: page fits, table box within width`, t.page <= t.vw && t.tw <= t.vw + 1, JSON.stringify(t));
    if (w === 360) await pg.screenshot({ path: __dirname + "/../dist/browser/phone-scroll-table.png", clip: { x: 0, y: 0, width: 360, height: 900 } });
    await pg.close();
  }
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
