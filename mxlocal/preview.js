"use strict";
// mxlocal preview <Module.Page>: an APPROXIMATE static picture of a page with the app's theme, without Studio Pro.
// The page's widget tree (plain units, inside its layout) becomes HTML with the DOM classes the Mendix client uses
// (mx-layoutgrid row col-*, mx-dataview, mx-listview, widget-datagrid, widget-gallery, btn btn-primary, form-group,
// ...), styled with the theme compiled as the dry run does (stylecheck.js). With Playwright (Chromium) it also takes
// phone, tablet and desktop screenshots. Data, conditional visibility, pluggable widget internals and the client's
// own layout code are not run: use it to judge colours, spacing, typography and layout, not behaviour.
const fs = require("fs");
const path = require("path");
const S = require("./stylecheck");

const VIEWPORTS = { phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] };
const esc = s => String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const words = t => (t && Array.isArray(t.Items) && t.Items.length ? (t.Items.find(i => /^en/.test(i.LanguageCode)) || t.Items[0]).Text || "" : "");
const tpl = c => (!c ? "" : c.Template ? words(c.Template) : c.Items ? words(c) : typeof c === "string" ? c : "").replace(/\{\d+\}/g, "…");

function makeRenderer(project, dir) {
    const byName = new Map();
    const moduleOf = id => {
        for (let c = id; c; c = project.units.get(c) && project.units.get(c).containerId) {
            const u = project.read(c);
            if (/^Projects\$Module/.test(u.$Type)) return u.Name;
        }
        return null;
    };
    for (const [id, x] of project.units) {
        if (x.containmentName !== "Documents") continue;
        const u = project.read(id);
        if (/^Forms\$(Page|Snippet|Layout)$/.test(u.$Type)) byName.set(`${moduleOf(id)}.${u.Name}`, u);
    }
    // the widget's own CSS classes: class, design property classes (dynamic classes need data: left out)
    const cls = (w, base = "") => {
        const a = w.Appearance;
        const extra = a ? [a.Class, ...S.appearanceClasses(dir, { ...a, Class: "", DynamicClasses: "" }).map(x => x.cls)] : [];
        return [base, ...extra].filter(Boolean).join(" ").trim();
    };
    const style = w => (w.Appearance && w.Appearance.Style ? ` style="${esc(w.Appearance.Style)}"` : "");
    const attrs = (w, base) => `class="${esc(cls(w, base))}"${style(w)}`;
    const kids = (list, ctx) => (list || []).map(x => widget(x, ctx)).join("\n");
    const label = (w, inner) => {
        const l = tpl(w.LabelTemplate);
        return `<div class="form-group${l ? "" : " no-columns"}">${l ? `<label class="control-label">${esc(l)}</label>` : ""}<div class="${l ? "" : ""}">${inner}</div></div>`;
    };
    const iconOf = w => {
        const i = w.Icon;
        if (!i) return "";
        if (i.$Type === "Forms$GlyphIcon") return `<span class="glyphicon glyphicon-${esc(String(i.Code))}" aria-hidden="true"></span> `;
        if (i.$Type === "Forms$IconCollectionIcon") return `<span class="mx-icon-lined mx-icon-${esc(String(i.Image || "").split(".").pop())}" aria-hidden="true"></span> `;
        return "";
    };
    // pluggable widgets: their property keys and values (CustomWidgets$WidgetObject)
    const props = cw => {
        const keys = new Map();
        const walkT = o => {
            if (!o || typeof o !== "object") return;
            if (Array.isArray(o)) return o.forEach(walkT);
            if (o.$Type === "CustomWidgets$WidgetPropertyType") keys.set(o.$ID, o.PropertyKey);
            for (const v of Object.values(o)) if (v && typeof v === "object") walkT(v);
        };
        walkT(cw.Type);
        const of = obj => Object.fromEntries(((obj && obj.Properties) || []).map(p => [keys.get(p.TypePointer) || p.TypePointer, p.Value || {}]));
        return { of, root: of(cw.Object) };
    };

    function widget(w, ctx) {
        if (!w || typeof w !== "object") return "";
        const t = String(w.$Type || "").replace(/^Forms\$/, "");
        switch (t) {
            case "DivContainer":
                return `<div ${attrs(w, "mx-container")}>${kids(w.Widgets, ctx)}</div>`;
            case "LayoutGrid": {
                const rows = (w.Rows || []).map(r => {
                    const cols = (r.Columns || []).map(c => {
                        const wt = (n, p) => (n === -1 ? `col-${p}` : n === -2 ? `col-${p}-auto` : `col-${p}-${n}`);
                        const k = [c.Weight !== undefined ? wt(c.Weight, "lg") : "col-lg", c.TabletWeight !== undefined ? wt(c.TabletWeight, "md") : "", c.PhoneWeight !== undefined ? wt(c.PhoneWeight, "sm").replace("col-sm-", "col-") : ""].filter(Boolean).join(" ").replace(/col-sm\b/, "col");
                        return `<div ${attrs(c, k)}>${kids(c.Widgets, ctx)}</div>`;
                    });
                    return `<div ${attrs(r, "row")}>${cols.join("")}</div>`;
                });
                return `<div ${attrs(w, "mx-layoutgrid")}><div class="mx-layoutgrid-fluid container-fluid">${rows.join("")}</div></div>`;
            }
            case "DynamicText":
            case "Text": {
                const tag = /^H[1-6]$/.test(w.RenderMode || "") ? w.RenderMode.toLowerCase() : w.RenderMode === "Paragraph" ? "p" : "span";
                return `<${tag} ${attrs(w, "mx-text")}>${esc(tpl(w.Content || w.Caption))}</${tag}>`;
            }
            case "Label":
                return `<span ${attrs(w, "mx-label")}>${esc(tpl(w.Caption))}</span>`;
            case "Title":
                return `<h1 ${attrs(w, "mx-title")}>${esc(ctx.title || "Page title")}</h1>`;
            case "ActionButton":
            case "LinkButton":
            case "DropDownButton": {
                const styleName = String(w.ButtonStyle || "Default").toLowerCase();
                const base = t === "LinkButton" || w.RenderType === "Link" ? "mx-link" : `btn mx-button btn-${styleName}`;
                return `<button type="button" ${attrs(w, base)}>${iconOf(w)}${esc(tpl(w.CaptionTemplate || w.Caption))}</button>`;
            }
            case "TextBox":
            case "DatePicker":
            case "ReferenceSelector":
                return `<div ${attrs(w, `mx-${t.toLowerCase()}`)}>${label(w, `<input class="form-control" type="text" placeholder="${esc(tpl(w.PlaceholderTemplate))}">`)}</div>`;
            case "TextArea":
                return `<div ${attrs(w, "mx-textarea")}>${label(w, `<textarea class="form-control mx-textarea-input" rows="3"></textarea>`)}</div>`;
            case "DropDown":
            case "ReferenceSetSelector":
                return `<div ${attrs(w, "mx-dropdown")}>${label(w, `<select class="form-control"><option>…</option></select>`)}</div>`;
            case "CheckBox":
                return `<div ${attrs(w, "mx-checkbox")}>${label(w, `<input type="checkbox">`)}</div>`;
            case "RadioButtonGroup":
                return `<div ${attrs(w, "mx-radiobuttons")}>${label(w, `<div class="radio"><input type="radio" checked> Yes</div><div class="radio"><input type="radio"> No</div>`)}</div>`;
            case "DataView":
                return `<div ${attrs(w, "mx-dataview")}><div class="mx-dataview-content">${kids(w.Widgets, ctx)}</div>${(w.FooterWidgets || []).length ? `<div class="mx-dataview-controls">${kids(w.FooterWidgets, ctx)}</div>` : ""}</div>`;
            case "ListView": {
                const item = kids(w.Widgets, ctx);
                return `<div ${attrs(w, "mx-listview")}><ul>${[1, 2, 3].map(() => `<li class="mx-listview-item">${item}</li>`).join("")}</ul></div>`;
            }
            case "GroupBox":
                return `<div ${attrs(w, "mx-groupbox")}><h2 class="mx-groupbox-header">${esc(tpl(w.CaptionTemplate || w.Caption))}</h2><div class="mx-groupbox-body">${kids(w.Widgets, ctx)}</div></div>`;
            case "TabControl":
            case "TabContainer": {
                const pages = w.TabPages || [];
                return `<div ${attrs(w, "mx-tabcontainer")}><ul class="mx-tabcontainer-tabs nav nav-tabs" role="tablist">${pages.map((p, i) => `<li class="${i ? "" : "active"}"><a>${esc(tpl(p.Caption))}</a></li>`).join("")}</ul><div class="mx-tabcontainer-content tab-content">${pages.length ? `<div class="mx-tabcontainer-pane tab-pane active">${kids(pages[0].Widgets, ctx)}</div>` : ""}</div></div>`;
            }
            case "StaticImageViewer":
            case "DynamicImageViewer":
                return `<img ${attrs(w, "mx-image img-responsive")} alt="${esc(tpl(w.AlternativeText))}" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#cbd5e1"/></svg>')}">`;
            case "SnippetCallWidget": {
                const qn = w.FormCall && (w.FormCall.Form || w.FormCall.Snippet);
                const sn = qn && byName.get(qn);
                if (!sn || ctx.depth > 6) return `<div class="mx-snippet">[snippet ${esc(qn || "?")}]</div>`;
                return `<div ${attrs(w, "mx-snippet")}>${kids(sn.Widgets || (sn.Content && sn.Content.Widgets), { ...ctx, depth: ctx.depth + 1 })}</div>`;
            }
            case "Placeholder": {
                const arg = (ctx.args || []).find(x => String(x.Parameter).split(".").pop() === w.Name);
                return arg ? `<div class="mx-placeholder">${kids(arg.Widgets, { ...ctx, args: arg.inner || [] })}</div>` : "";
            }
            case "ScrollContainer": {
                const reg = (r, n) => (r ? `<div class="mx-scrollcontainer-${n} region-${n}">${kids(r.Widgets, ctx)}</div>` : "");
                return `<div ${attrs(w, "mx-scrollcontainer")}>${reg(w.Top, "top")}<div class="mx-scrollcontainer-middle" style="display:flex">${reg(w.Left, "left")}${reg(w.CenterRegion || w.Center, "center").replace('region-center"', 'region-center" style="flex:1;min-width:0"')}${reg(w.Right, "right")}</div>${reg(w.Bottom, "bottom")}</div>`;
            }
            case "Header":
                return `<div ${attrs(w, "mx-header")}><div class="mx-header-left">${kids(w.LeftWidgets, ctx)}</div><div class="mx-header-center">${kids(w.CenterWidgets, ctx)}</div><div class="mx-header-right">${kids(w.RightWidgets, ctx)}</div></div>`;
            case "NavigationTree":
            case "MenuBar":
            case "SimpleMenuBar":
                return `<div ${attrs(w, t === "NavigationTree" ? "mx-navigationtree" : "mx-menubar")}><ul class="${t === "NavigationTree" ? "" : "mx-menubar-list"}"><li class="mx-menubar-item active"><a>Home</a></li><li class="mx-menubar-item"><a>Menu</a></li></ul></div>`;
            case "SidebarToggleButton":
                return `<button type="button" ${attrs(w, "btn mx-button btn-default toggle-btn")}>☰</button>`;
            case "DataGrid":
            case "TemplateGrid": {
                const cols = (w.Columns || []).map(c => tpl(c.Caption)).slice(0, 8);
                if (t === "TemplateGrid") return `<div ${attrs(w, "mx-templategrid")}><div class="mx-templategrid-content-wrapper">${[1, 2, 3].map(() => `<div class="mx-templategrid-item">${kids(w.Widgets, ctx)}</div>`).join("")}</div></div>`;
                return `<div ${attrs(w, "mx-datagrid mx-grid")}><table class="table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${[1, 2, 3].map(() => `<tr>${cols.map(() => "<td>…</td>").join("")}</tr>`).join("")}</tbody></table></div>`;
            }
        }
        if (w.$Type === "CustomWidgets$CustomWidget") {
            const id = (w.Type && w.Type.WidgetId) || "";
            const { of, root } = props(w);
            const nested = Object.values(root).flatMap(v => v.Widgets || []);
            if (/datagrid\.Datagrid$/.test(id)) {
                const cols = ((root.columns && root.columns.Objects) || []).map(o => of(o)).slice(0, 8);
                const head = cols.map(c => `<div class="th" role="columnheader"><div class="column-container"><div class="column-header">${esc(tpl(c.header && c.header.TextTemplate))}</div></div></div>`).join("");
                const cells = [1, 2, 3].map(() => `<div class="tr" role="row">${cols.map(() => '<div class="td" role="gridcell">…</div>').join("")}</div>`).join("");
                return `<div ${attrs(w, "widget-datagrid")}><div class="widget-datagrid-grid table" role="grid"><div class="widget-datagrid-grid-body table-content" style="display:grid;grid-template-columns:repeat(${cols.length || 1}, minmax(0, 1fr))"><div class="tr" role="row" style="display:contents">${head}</div>${cells.replace(/class="tr" role="row"/g, 'class="tr" role="row" style="display:contents"')}</div></div><div class="widget-datagrid-footer"><div class="widget-datagrid-paging"></div></div></div>`;
            }
            if (/gallery\.Gallery$/.test(id)) {
                const item = kids((root.content && root.content.Widgets) || [], ctx);
                return `<div ${attrs(w, "widget-gallery")}><div class="widget-gallery-items widget-gallery-lg-3 widget-gallery-md-2 widget-gallery-sm-1" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">${[1, 2, 3].map(() => `<div class="widget-gallery-item">${item}</div>`).join("")}</div></div>`;
            }
            return `<div ${attrs(w, `mx-customwidget widget-${esc(id.split(".").pop().toLowerCase())}`)} title="${esc(id)}">${nested.length ? kids(nested, ctx) : `<div style="padding:8px;border:1px dashed #94a3b8;font:12px sans-serif;color:#475569">${esc(id.split(".").pop())}</div>`}</div>`;
        }
        // unknown: its child widgets, if any
        const inner = Object.values(w).filter(Array.isArray).flatMap(l => l.filter(x => x && x.$Type && /\$(.*Widget|DivContainer|.*Button|.*Text|LayoutGrid|DataView|ListView)/.test(x.$Type)));
        return inner.length ? `<div class="mx-${esc(t.toLowerCase())}">${kids(inner, ctx)}</div>` : "";
    }

    // the page inside its layout (and the layout inside its master layout)
    function page(qn) {
        const p = byName.get(qn);
        if (!p) {
            const all = [...byName.keys()];
            const { suggest } = require("./ops-util");
            const s = suggest(qn, all, 5);
            throw new Error(`no page or snippet '${qn}'${s.length ? `. Did you mean: ${s.join(", ")}?` : ""}`);
        }
        if (p.$Type === "Forms$Snippet") return { title: qn, body: kids(p.Widgets || (p.Content && p.Content.Widgets), { depth: 0 }) };
        if (p.$Type === "Forms$Layout") throw new Error(`${qn} is a layout; preview a page that uses it`);
        const title = tpl(p.Title) || p.Name;
        const call = p.FormCall || p.LayoutCall || {};
        // a layout based on a master layout fills the master's placeholders with its arguments, which hold its own
        // placeholders (filled by the page's arguments)
        const layout = (name, args, depth) => {
            const l = name && byName.get(name);
            if (!l || !l.Content || depth > 4) return args.map(a => kids(a.Widgets, { depth: 0, title, args: a.inner || [] })).join("\n");
            const master = l.Content.LayoutCall;
            const mName = master && (master.Layout || master.Form);
            if (mName) return layout(mName, (master.Arguments || []).map(a => ({ ...a, inner: args })), depth + 1);
            return kids(l.Content.Widgets, { depth: 0, title, args });
        };
        const body = layout(call.Form || call.Layout, call.Arguments || [], 0);
        const layoutCls = (p.Appearance && p.Appearance.Class) || "";
        return { title, body: `<div class="mx-page ${esc(layoutCls)}">${body}</div>` };
    }
    return { page };
}

// -> { html, css: { ok, size, note }, title }
function render(client, model, qn) {
    const dir = client.project.dir;
    const r = makeRenderer(client.project, dir).page(qn);
    const c = S.compile(client, model, { disk: true });
    let css = "", note;
    if (c.ok) css = c.css;
    else {
        note = c.skipped ? `theme not compiled: ${c.skipped}` : `theme not compiled: ${c.error.text}`;
        css = "body{font-family:system-ui,sans-serif;margin:0}.row{display:flex;flex-wrap:wrap}.row>[class*=col]{flex:1 1 0;padding:8px}.btn{padding:6px 12px;border:1px solid #ccc;border-radius:4px}.btn-primary{background:#264ae5;color:#fff}.form-control{display:block;width:100%;padding:6px}";
    }
    const base = ["deployment/web", "theme/web"].map(d => path.join(dir, ...d.split("/"))).find(d => fs.existsSync(d));
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)} (approximate preview)</title>
${base ? `<base href="${esc(require("url").pathToFileURL(base + path.sep).href)}">` : ""}
<style>
${css.replace(/<\/style/gi, "<\\/style")}
</style>
<style>.mxlocal-approx{position:fixed;right:8px;bottom:8px;z-index:99999;font:11px system-ui,sans-serif;background:#111827;color:#fff;padding:3px 8px;border-radius:999px;opacity:.75}</style>
</head>
<body class="${c.ok ? "" : "mxlocal-nocss"}">
<div id="content" class="mx-app">
${r.body}
</div>
<div class="mxlocal-approx">approximate preview (mxlocal): no data, no conditional visibility</div>
</body>
</html>
`;
    return { html, title: r.title, css: { ok: !!c.ok, size: css.length, note } };
}

function findPlaywright() {
    const paths = [process.cwd(), __dirname, path.join(path.dirname(process.execPath), "..", "lib", "node_modules")];
    for (const name of ["playwright", "playwright-core"]) {
        try {
            return require(require.resolve(name, { paths }));
        } catch (e) {
            /* next */
        }
    }
    return null;
}

// out: the .html file; screenshots next to it as <name>.phone.png / .tablet.png / .desktop.png
async function preview(client, model, qn, outFile, log) {
    const r = render(client, model, qn);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, r.html);
    log(`PREVIEW (approximate: Mendix-like HTML, no data or behaviour) ${qn}: ${outFile} (${(r.html.length / 1024).toFixed(0)} KB${r.css.ok ? ", theme compiled" : `; ${r.css.note}`})`);
    const pw = findPlaywright();
    if (!pw) {
        log("Screenshots: Playwright is not installed (it is not part of mxlocal). To get them: npm install --no-save playwright (in any folder on NODE_PATH, or in mxlocal/) and npx playwright install chromium (or set PLAYWRIGHT_BROWSERS_PATH to a folder with Chromium). The HTML file opens in any browser.");
        return { ...r, shots: [] };
    }
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync("/opt/pw-browsers")) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
    const shots = [];
    let browser;
    try {
        browser = await pw.chromium.launch();
        for (const [name, [w, h]] of Object.entries(VIEWPORTS)) {
            const pg = await browser.newPage({ viewport: { width: w, height: h } });
            await pg.goto(require("url").pathToFileURL(outFile).href, { waitUntil: "load", timeout: 30000 });
            const png = outFile.replace(/\.html?$/i, "") + `.${name}.png`;
            await pg.screenshot({ path: png, fullPage: true });
            shots.push(png);
            await pg.close();
        }
        log(`Screenshots (approximate): ${shots.join(", ")}`);
    } catch (e) {
        log(`Screenshots: not taken (${String(e.message).split("\n")[0]}); the HTML file opens in any browser`);
    } finally {
        if (browser) await browser.close();
    }
    return { ...r, shots };
}

module.exports = { preview, render, findPlaywright, VIEWPORTS };
