"use strict";
// selftest phase DS (selftest-ds.js): the design system web theme layer (ds-theme.js, tokens.js, stylecheck.js) on a
// copy of its own (model + theme folders): createDesignModule (UI resources module, theme order, scaffold, prefix),
// setTokens (scale, dark set, Atlas variables), addComponentStyle (four levels, sorted _index.scss), addThemeAsset,
// addFont, addDesignProperty + changeDesignProperty in the design module, editThemeFile of a .webmanifest, a page that
// uses the classes; the STYLE CHECK (compile when the project has a web theme, class lint, inline style, contrast);
// stored, reopened with 0 errors and 0 deltas, new units byte for byte, every op's check; then removeComponentStyle,
// deleteDesignProperty (still used), setThemeModuleOrder; and the refusals (Marketplace module, unknown level / token
// group, existing component, fake image, Marketplace folder, incomplete order, broken manifest JSON, undefined SCSS
// variable and strict contrast through the STYLE CHECK).
const fs = require("fs");
const path = require("path");
const bson = require("./bson");
const { lostProperties } = require("./lost");
const S = require("./stylecheck");

function copyProject(src, dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src.mpr, path.join(dir, path.basename(src.mpr)));
    fs.cpSync(src.contents, path.join(dir, "mprcontents"), { recursive: true });
    for (const d of ["widgets", "theme", "themesource"]) if (fs.existsSync(path.join(src.dir, d))) fs.cpSync(path.join(src.dir, d), path.join(dir, d), { recursive: true });
    return path.join(dir, path.basename(src.mpr));
}

// fake but well-formed asset files (by their first bytes)
function assets(dir) {
    const e = path.join(dir, "edits");
    fs.mkdirSync(e, { recursive: true });
    fs.writeFileSync(path.join(e, "zz-regular.woff2"), Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60, 1)]));
    fs.writeFileSync(path.join(e, "zz-bold.woff2"), Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60, 2)]));
    fs.writeFileSync(path.join(e, "zz.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]));
    fs.writeFileSync(path.join(e, "fake.png"), "not an image");
    return path.join(e, "change.json");
}

async function dsPhase({ src, reopen, check, results, tmp, mod, layout, layoutProblems }) {
    const dir = path.join(tmp, "ds");
    const copy = copyProject(src, dir);
    const changeFile = assets(dir);
    const problems = [];
    const read = rel => (fs.existsSync(path.join(dir, rel)) ? fs.readFileSync(path.join(dir, rel), "utf8") : null);
    let s = await reopen(copy);
    s.client.changeFile = changeFile;
    const M = "ZzDs", F = "themesource/zzds/web";
    const pageLayouts = new Set(s.model.allLayouts().map(l => l.qualifiedName));
    const pageable = [...s.ctx.project.units.keys()].some(id => {
        const p = s.ctx.project.read(id);
        return p.$Type === "Forms$Page" && p.FormCall && pageLayouts.has(p.FormCall.Form);
    });
    const appStore = s.model.allModules().find(m => m.fromAppStore);
    const hasTheme = fs.existsSync(path.join(dir, "theme", "web", "main.scss"));
    const atlasVars = fs.existsSync(path.join(dir, "themesource", "atlas_core", "web", "_variables.scss"));
    const ps = s.model.allProjectSettings()[0];
    const webUi = !!(ps && (await ps.load()).settingsParts.find(p => p instanceof require("mendixmodelsdk").settings.WebUIProjectSettingsPart));
    const ops = [
        { op: "createDesignModule", name: M, prefix: "zz-" },
        { op: "setTokens", brand: "#0b5fff", tokens: { dark: true, darkMode: "auto", radius: { md: "6px" } } },
        { op: "addComponentStyle", level: "atom", name: "button", css: { padding: "$zz-space-2 $zz-space-4", "border-radius": "$zz-radius-md" } },
        { op: "addComponentStyle", level: "molecule", name: "card", scss: "background: var(--zz-surface-1);\nbox-shadow: $zz-shadow-1;\n&:hover { box-shadow: $zz-shadow-2; }" },
        { op: "addComponentStyle", level: "organism", name: "page-header", css: "display: flex; gap: $zz-space-4" },
        { op: "addComponentStyle", level: "utility", name: "stack", css: "display: flex; flex-direction: column; gap: $zz-space-2" },
        { op: "addComponentStyle", level: "atom", name: "avatar", css: "border-radius: $zz-radius-pill" },
        { op: "addThemeAsset", from: "edits/zz.png", to: `${F}/images/zz.png` },
        { op: "addFont", family: "ZzSans", files: [{ from: "edits/zz-regular.woff2" }, { from: "edits/zz-bold.woff2", weight: 700 }] },
        { op: "addDesignProperty", widgetType: "DivContainer", name: "Zz look", type: "Dropdown", module: M, options: [{ name: "Flat", class: "zz-look-flat", css: "box-shadow: none" }, { name: "Raised", class: "zz-look-raised", css: "box-shadow: $zz-shadow-2" }] },
        { op: "changeDesignProperty", widgetType: "DivContainer", name: "Zz look", addOptions: [{ name: "Outlined", class: "zz-look-outlined", css: "border: 1px solid $zz-border-subtle" }], renameOptions: { Flat: "Plain" } },
        { op: "editThemeFile", path: "theme/web/zz.webmanifest", content: "{ \"theme_color\": \"#0B5FFF\" }\n" }
    ];
    if (pageable) ops.push({ op: "createPage", module: mod, name: "ZzDs_Page", title: "Zz", widgets: [{ widget: "container", name: "zzDsCard", class: "zz-card", design: { "Zz look": "Raised" }, widgets: [{ widget: "container", name: "zzDsInner", class: "zz-nope", style: "color: #123456", widgets: [{ widget: "text", name: "zzDsText", text: "Zz" }] }] }] });
    const before = new Set(s.ctx.project.units.keys());
    try {
        await s.ops.runPlan({ ops }, () => {});
    } catch (e) {
        check("ds: design system web theme ops", false, e.message.slice(0, 300));
        return;
    }
    await s.model.flushChanges();
    // STYLE CHECK of this change: compiles (with a web theme), no errors, the page's unknown class and inline style
    const style = await S.styleCheck(s.client, s.model, {});
    if (style.errors) problems.push(`STYLE CHECK errors: ${style.lines.filter(l => !/^\((warning|info)\)/.test(l)).join(" / ").slice(0, 300)}`);
    if (hasTheme && !style.lines.some(l => /^\(info\) compiled: /.test(l))) problems.push(`STYLE CHECK did not compile the theme: ${style.lines.join(" / ").slice(0, 200)}`);
    if (!hasTheme && !style.lines.some(l => /compile skipped/.test(l))) problems.push("STYLE CHECK: no 'compile skipped' line without a web theme");
    if (pageable && !style.lines.some(l => /zzDsInner: class 'zz-nope'/.test(l))) problems.push(`STYLE CHECK misses the undefined class zz-nope: ${style.lines.join(" / ").slice(0, 300)}`);
    if (pageable && style.lines.some(l => /class 'zz-card'|class 'zz-look-raised'/.test(l))) problems.push("STYLE CHECK reports a defined class (zz-card / zz-look-raised)");
    if (pageable && !style.lines.some(l => /zzDsInner: inline style/.test(l))) problems.push("STYLE CHECK misses the inline style");
    if (!style.lines.some(l => /tokens ZzDs: all \d+ text\/background pairs pass/.test(l))) problems.push(`STYLE CHECK: no token contrast line: ${style.lines.join(" / ").slice(0, 200)}`);
    // store, reopen
    const enc = s.client.encode();
    enc.plainFiles = require("./files").encode(s.client);
    problems.push(...lostProperties(s.client, s.model, enc));
    problems.push(...layoutProblems(layout, enc).problems.slice(0, 4));
    s.client.project.writeEncoded(enc);
    s = await reopen(copy);
    s.client.changeFile = changeFile;
    problems.push(...(await s.ops.checkPlan({ ops })));
    for (const u of s.model.allUnits().filter(u => u.isLoadable && !u.isLoaded)) await s.model.loadUnitById(u.id, false).catch(e => problems.push(`reopen: ${e.message}`));
    await s.model.flushChanges();
    if (s.client.log.length) problems.push(`${s.client.log.length} deltas on reopen`);
    for (const id of s.ctx.project.units.keys()) {
        if (before.has(id)) continue;
        const b = s.ctx.project.readBytes(id);
        if (!bson.encode(bson.decode(b)).equals(b)) problems.push(`unit ${id} does not roundtrip byte for byte`);
    }
    // the files
    const say = (ok, msg) => ok || problems.push(msg);
    const main = read(`${F}/main.scss`) || "";
    say(/^\/\/ @ds-prefix: zz-$/m.test(main) && ["tokens", "atoms", "molecules", "organisms", "utilities"].every(l => main.includes(`@import "${l}/index";`)), `${F}/main.scss: no prefix header or layer imports`);
    say(read(`${F}/atoms/_index.scss`) && /@import "avatar";\n@import "button";/.test(read(`${F}/atoms/_index.scss`)), "atoms/_index.scss is not sorted (avatar, button)");
    say(/\.zz-card \{[\s\S]*&:hover/.test(read(`${F}/molecules/_card.scss`) || ""), "molecules/_card.scss: no .zz-card with its nesting");
    const tokScss = read(`${F}/tokens/_tokens.scss`) || "", cssVars = read(`${F}/tokens/_css-vars.scss`) || "";
    say(/\$zz-color-primary-500: #0b5fff/.test(tokScss) && /\$zz-color-primary-50: #/.test(tokScss) && /\$zz-radius-md: 6px/.test(tokScss), "_tokens.scss: no primary scale / radius");
    say(/--zz-surface-1:/.test(cssVars) && /\.zz-dark,\n\[data-theme="dark"\]/.test(cssVars) && /prefers-color-scheme: dark/.test(cssVars), "_css-vars.scss: no :root vars, dark class block or device dark block");
    say(/^@import "tokens";\n@import "fonts";\n@import "css-vars";$/m.test(read(`${F}/tokens/_index.scss`) || ""), "tokens/_index.scss: tokens, fonts, css-vars not in that order");
    say(/font-family: "ZzSans";[\s\S]*fonts\/zz\/zzsans-700\.woff2/.test(read(`${F}/tokens/_fonts.scss`) || "") && fs.existsSync(path.join(dir, ...`${F}/fonts/zz/zzsans-400.woff2`.split("/"))), "addFont: no @font-face / font file");
    say(fs.existsSync(path.join(dir, ...`${F}/images/zz.png`.split("/"))), "addThemeAsset: image missing");
    let dp = {};
    try {
        dp = JSON.parse(read(`${F}/design-properties.json`) || "{}");
    } catch (e) {
        problems.push("design-properties.json is not JSON");
    }
    const look = (dp.DivContainer || []).find(p => p.name === "Zz look");
    say(look && look.options.map(o => o.name).join(",") === "Plain,Raised,Outlined" && (look.options[0].oldNames || []).includes("Flat"), `design property options: ${look ? look.options.map(o => o.name).join(",") : "missing"}`);
    if (atlasVars) say(/^\$brand-primary:\s*#0b5fff;/m.test(read("theme/web/custom-variables.scss") || "") && /^\$font-family-base:\s*'ZzSans'/m.test(read("theme/web/custom-variables.scss") || ""), "setTokens / addFont: Atlas $brand-primary / $font-family-base not set");
    const m = s.model.allModules().find(x => x.name === M);
    say(m && m.isThemeModule, `${M} is not a UI resources module`);
    if (webUi) {
        const order = S.uiOrder(s.model, S.webPart(s.model));
        say(order[order.length - 1] === M || order.indexOf(M) > Math.max(-1, ...s.model.allModules().filter(x => x.isThemeModule && x.fromAppStore).map(x => order.indexOf(x.name))), `theme order puts ${M} before a Marketplace UI module: ${order.join(", ")}`);
    }
    // phase 2: remove a component, delete the used design property, move the module first in the order
    const order2 = webUi ? [M, ...S.uiOrder(s.model, S.webPart(s.model)).filter(n => n !== M)] : null;
    const ops2 = [
        { op: "removeComponentStyle", level: "utility", name: "stack" },
        { op: "deleteDesignProperty", widgetType: "DivContainer", name: "Zz look" },
        ...(order2 ? [{ op: "setThemeModuleOrder", order: order2 }] : [])
    ];
    const lines = [];
    await s.ops.runPlan({ ops: ops2 }, l => lines.push(l));
    if (pageable && !lines.some(l => /STILL USED BY[^\n]*ZzDs_Page zzDsCard/.test(l))) problems.push(`deleteDesignProperty does not name the widget that uses it: ${lines.join(" / ").slice(0, 200)}`);
    await s.model.flushChanges();
    const enc2 = s.client.encode();
    enc2.plainFiles = require("./files").encode(s.client);
    s.client.project.writeEncoded(enc2);
    s = await reopen(copy);
    s.client.changeFile = changeFile;
    problems.push(...(await s.ops.checkPlan({ ops: ops2 })));
    await s.model.flushChanges();
    if (s.client.log.length) problems.push(`${s.client.log.length} deltas on reopen (phase 2)`);
    say(!/stack/.test(read(`${F}/utilities/_index.scss`) || "") && !fs.existsSync(path.join(dir, ...`${F}/utilities/_stack.scss`.split("/"))), "removeComponentStyle: file or @import left");
    // refusals: each on a fresh session (some ops run and the STYLE CHECK refuses them)
    const refusals = [
        [{ op: "addComponentStyle", level: "atomm", name: "x", css: "color: red" }, /Did you mean: atom/],
        [{ op: "addComponentStyle", level: "atom", name: "button", css: "color: red" }, /exists; give "replace": true/],
        [{ op: "addComponentStyle", level: "atom", name: "Bad Name", css: "color: red" }, /kebab case/],
        [{ op: "setTokens", tokens: { colours: {} } }, /Did you mean: colors/],
        [{ op: "setTokens", brand: "blue-ish" }, /not a colour/],
        [{ op: "addThemeAsset", from: "edits/fake.png", to: "theme/web/zz2.png" }, /not a \.png file by its content/],
        [{ op: "addThemeAsset", from: "edits/zz.png", to: "theme/web/zz.exe" }, /not a font or image file/],
        [{ op: "editThemeFile", path: "theme/web/zz.webmanifest", append: "{" }, /valid JSON/],
        [{ op: "createDesignModule", name: M, prefix: "yy-" }, /already has the prefix zz-/],
        [{ op: "changeDesignProperty", widgetType: "DivContainer", name: "Zz lok", newName: "x" }, /no design property 'Zz lok'/],
        ...(appStore ? [[{ op: "createDesignModule", name: appStore.name }, /Marketplace module/], [{ op: "addThemeAsset", from: "edits/zz.png", to: `themesource/${appStore.name.toLowerCase()}/web/zz.png` }, /Marketplace module/]] : []),
        ...(order2 && order2.length > 1 ? [[{ op: "setThemeModuleOrder", order: [M] }, /missing/]] : [])
    ];
    for (const [o, re] of refusals) {
        const t = await reopen(copy);
        t.client.changeFile = changeFile;
        let msg = "";
        try {
            msg = (await t.ops.runPlan({ ops: [o] }, () => {})).join(" ") || "(it ran)";
        } catch (e) {
            msg = e.message;
        }
        if (!re.test(msg)) problems.push(`${o.op} ${o.name || o.path || o.to || ""} not refused with ${re}: ${msg.slice(0, 160)}`);
    }
    // the STYLE CHECK refuses: an undefined SCSS variable (with a web theme) and a contrast below AA with strict
    const styled = async (o, opts) => {
        const t = await reopen(copy);
        t.client.changeFile = changeFile;
        await t.ops.runPlan({ ops: [o] }, () => {});
        await t.model.flushChanges();
        return S.styleCheck(t.client, t.model, opts);
    };
    if (hasTheme) {
        const r = await styled({ op: "addComponentStyle", level: "organism", name: "broken", css: "color: $zz-not-a-token" }, {});
        if (!r.errors || !r.lines.some(l => /organisms\/_broken\.scss:\d+: Undefined variable/.test(l))) problems.push(`STYLE CHECK does not refuse an undefined variable with file:line: ${r.lines.join(" / ").slice(0, 200)}`);
    }
    const low = await styled({ op: "setTokens", tokens: { text: { secondary: "#b0b0b0" } }, atlas: false }, { strict: true });
    if (!low.errors || !low.lines.some(l => /text\.secondary on surface \d: contrast [\d.]+:1, WCAG AA needs 4\.5:1 \(strict\)/.test(l))) problems.push(`STYLE CHECK strict does not refuse a low contrast: ${low.lines.join(" / ").slice(0, 200)}`);
    const what = ["createDesignModule (UI resources module, theme order, scaffold, prefix)", "setTokens (scale, dark + device dark, Atlas variables)", "addComponentStyle x5 (sorted _index.scss)", "addThemeAsset", "addFont",
        "addDesignProperty + changeDesignProperty", "editThemeFile .webmanifest", pageable && "page using the classes", hasTheme ? "STYLE CHECK compile" : "STYLE CHECK (compile skipped: no web theme)", pageable && "class lint + inline style", "contrast",
        "removeComponentStyle", "deleteDesignProperty (still used)", order2 && "setThemeModuleOrder", `${refusals.length + (hasTheme ? 2 : 1)} refusals`].filter(Boolean);
    if (!hasTheme) results.push("SKIP ds: theme compile: this project has no theme/web/main.scss");
    if (!pageable) results.push("SKIP ds: page using the design classes: no page with a layout");
    if (!appStore) results.push("SKIP ds: Marketplace module refusals: no Marketplace module");
    check(`ds: ${what.join("; ")}; stored, reopen 0 errors / 0 deltas`, !problems.length, [...new Set(problems)].slice(0, 6).join("; "));
}

module.exports = { dsPhase };
