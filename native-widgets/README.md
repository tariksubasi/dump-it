# Mendix pluggable widget'ları (native + web)

Bu klasörde Mendix **10.24** için yazılmış pluggable widget'lar ve onları yapay zekâ ajanıyla (OpenCode + DeepSeek gibi) geliştirmek için iki **skill** dosyası var.

| Klasör / dosya | Ne |
|---|---|
| `back-navigation/` | Native: Android geri tuşu + iOS kaydırarak geri. `dist/1.0.5/dumpit.BackNavigation.mpk` |
| `html-viewer/` | Native: HTML gösterir, ekrana sığar, zoom, internet kesintisine dayanıklı. `dist/1.0.5/dumpit.HtmlViewer.mpk` |
| `skills/mendix-native-widget/SKILL.md` | Ajan için: native (React Native) widget yazma, build, test, paketleme — eksiksiz kurallar ve tablolar |
| `skills/mendix-web-widget/SKILL.md` | Ajan için: web (React) widget yazma, build, test, paketleme |

---

## 1. Hazır widget'ı kullanmak (npm gerekmez)

1. Repoyu clone/pull et.
2. `<widget-klasörü>/dist/<sürüm>/*.mpk` dosyasını Mendix projesinin **`widgets/`** klasörüne kopyala.
3. Studio Pro'da **F4** (App → Synchronize App Directory).
4. Widget, Toolbox'ta görünür (kategori: XML'deki `studioProCategory`).

| Sorun | Çözüm |
|---|---|
| Eski sürüm çalışıyor | `widgets/` içindeki eski aynı isimli mpk'ları sil, F4, uygulamayı yeniden başlat |
| "invalid child element translations" | XML'de `<translations>` önünde `<description>` olmalı (bizim widget'larda düzeltildi) |
| "Help url ... must be https" | `helpUrl` sadece https + mendix.com veya GitHub markdown olabilir; yoksa kaldır |
| Native widget Make It Native'de görünmüyor | Run Locally → uygulamayı tamamen kapat/aç |

---

## 2. Bilgisayar kurulumu (kaynak koddan build için)

| Gerekli | Sürüm | Kontrol |
|---|---|---|
| Node.js | **22.18 veya üstü** (22 LTS). Daha eskisinde build hiç başlamaz: "a minimum node version ^22.18.0 is required" | `node -v` |
| npm | 8 veya üstü (Node 22 ile 10.x gelir) | `npm -v` |
| Git | herhangi | `git --version` |
| Studio Pro | 10.24.x | — |
| (isteğe bağlı) xmllint | XML şema kontrolü | `xmllint --version` (Windows'ta yoksa atla) |

`node_modules` repoda **yok** (büyük ve işletim sistemine özel). Her widget klasöründe **bir kez** `npm install` gerekir.

---

## 3. Var olan widget'ı build etmek

```bash
cd native-widgets/html-viewer
npm install                                   # bir kez
npm run release                               # XML kontrol + build + mpk
# xmllint yoksa:  npx pluggable-widgets-tools release:native
```

Çıktı: `dist/<package.json version>/dumpit.<WidgetName>.mpk`

| Komut | Ne yapar |
|---|---|
| `npm run build` | Geliştirme build'i (`dist/tmp/widgets`) |
| `npm run release` | Üretim build'i + mpk |
| `npm test` | Jest birim testleri |
| `npm run lint` | Prettier + ESLint |
| `npx prettier --write "src/**/*.{ts,tsx}"` | Format düzeltme (XML'i formatlatma) |
| `npx tsc --noEmit -p .` | Tip kontrolü |

**Sürüm kuralı:** yeni mpk için `package.json` → `version` **ve** `src/package.xml` → `version="…"` aynı yeni değere çıkar. Aynı sürümle Studio Pro / Make It Native eski kodu kullanabilir.

**Projeye otomatik kopyalama:** `package.json` → `config.projectPath` alanına Mendix proje klasörünü yazarsan (örn. `"C:/Mendix/MyApp"`), `npm run build` ve `npm start` mpk'yı `widgets/` klasörüne kendisi kopyalar. **`npm run release` kopyalamaz**; release mpk'sını elle kopyala. `mendixHost` ve `developmentPort` alanlarını araç kullanmıyor.

**XML değiştiyse:** Studio Pro'da F4 → sayfadaki widget'a sağ tık → **Update widget**.

---

## 4. Yeni widget oluşturmak

İki yol var; ikisi de skill dosyalarında adım adım ve tam dosya içerikleriyle anlatılıyor.

| Yol | Ne zaman | Komut |
|---|---|---|
| A. Mendix generator | İnternet var, standart iskelet istiyorsun | `npx @mendix/generator-widget@10.24-latest MyWidget` (sorulara cevap ver: web/native, TypeScript, boş şablon). `@latest` yazma, o Mendix 11 sürümünü getirir. |
| B. Elle (skill'deki şablon) | Kontrol sende, ajan yapacak | Skill'deki "Scaffold" bölümündeki dosyaları oluştur → `npm install` → `npm run release` |
| C. Var olanı kopyala | En hızlı native başlangıç | `back-navigation`'ı kopyala, isimleri değiştir (skill'deki "rename checklist") |

Klasör adı **küçük harf ve tire** (`my-widget`), widget adı **PascalCase ve sadece harf** (`MyWidget`), `packagePath` **küçük harf, tiresiz** (`dumpit`).

---

## 5. Ajanla (OpenCode / DeepSeek) çalışmak

### 5.1 Skill'leri ajana tanıtmak

En garantili yol: proje kökündeki `opencode.json` dosyasına ekle (yoksa oluştur):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": [
    "native-widgets/skills/mendix-native-widget/SKILL.md",
    "native-widgets/skills/mendix-web-widget/SKILL.md"
  ]
}
```

Alternatif: dosyaları `.opencode/skill/<isim>/SKILL.md` (OpenCode skill klasörü) veya `.claude/skills/<isim>/SKILL.md` altına kopyala. Skill dosyalarının başındaki `name` / `description` alanları bu formata uygun.

> Gizlilik: Bulut bir model kullanıyorsan proje kodu ve veriler o servise gider. Gizli müşteri verisi, şifre, token içeren dosyaları ajana verme.

### 5.2 İlk kurulum prompt'u (kopyala-yapıştır)

```text
You are a senior Mendix 10.24 pluggable-widget engineer. Read native-widgets/skills/mendix-native-widget/SKILL.md
and native-widgets/skills/mendix-web-widget/SKILL.md fully before anything else. Answer me in Turkish, short sentences.

Task: set up my machine and this repo so I can build Mendix web and native widgets.
1. Check prerequisites (node -v, npm -v, git --version, xmllint --version). Show a table: tool | found | required | action.
   Do not install system tools yourself; tell me the exact command and wait.
2. For every folder in native-widgets/ that has a package.json: run `npm install`, then `npm run release`
   (if xmllint is missing: `npx pluggable-widgets-tools release:<web|native>`), `npm test`, `npm run lint`.
   Show a table: widget | install | release | test | lint | mpk path.
3. Ask me for my Mendix project folder. Put it in each package.json "config.projectPath" only after I say yes.
4. Scaffold a test widget by the skill's "Scaffold" section: one web widget `hello-web` (HelloWeb) and one native
   widget `hello-native` (HelloNative), packagePath "dumpit". Build both to .mpk. Show the file tree and the mpk paths.
5. Summarize in one table what works, what failed (with the exact error), and the next step.
Rules: one step at a time; never delete files outside native-widgets/; stop after the same error 3 times and show it;
never invent Mendix APIs — if the skill does not cover something, say "NOT IN SKILL" and ask.
```

### 5.3 Günlük iş prompt'u (yeni widget / değişiklik)

```text
Read the skill for this widget type (native-widgets/skills/mendix-<native|web>-widget/SKILL.md). Answer in Turkish.
[TASK] <ne istiyorum: örn. "liste verisini kart olarak gösteren web widget, arama + sayfalama, boşken mesaj">
Follow the skill workflow exactly:
1. Requirements table (property | type | required | default | why) and Studio Pro XML first; validate it.
2. Edge-case table (empty, loading, unavailable, read-only, validation error, no access, slow network, offline,
   long text, many items, small/large screen, portrait/landscape, dark mode, RTL, keyboard, accessibility).
3. Implement with the skill's patterns; no `any`, no setState in effects, refs written in useLayoutEffect.
4. Tests: unit (pure logic) + render tests for loading/empty/unavailable/error states.
5. Bump version in package.json AND src/package.xml, run release/test/lint, show results in a table.
Ask me only what you cannot find in the code or the skill (max 5 questions).
```

---

## 6. Sık hatalar

| Hata | Neden | Çözüm |
|---|---|---|
| `Cannot find a widget entry file` | `src/<WidgetName>.tsx` yok veya `widgetName` uyuşmuyor | Dosya adı = `package.json` → `widgetName` |
| XSD hatası (`npm run validate`) | XML'de yanlış sıra/eleman | Sıra: `caption`, `description`, sonra diğerleri (`returnType`, `translations`, …) |
| `Cannot update ref during render` (lint) | Render içinde `ref.current =` | `useLayoutEffect(() => { ref.current = x; })` |
| `set-state-in-effect` (lint) | Effect içinde senkron `setState` | Durumu türet / anahtar ile sakla / callback içinde set et |
| Prettier XML'i bozuyor | `prettier --write .` | Sadece `src/**/*.{ts,tsx}` |
| Native modül bulunamadı (uygulama açılırken çöker) | Native npm paketi uygulamada yok | Native Template `package.json`'a ekle + uygulamayı yeniden derle; Make It Native sadece içindeki modülleri bilir |
| Widget değişmiyor | Aynı sürüm / eski mpk | Sürümü artır, eski mpk'yı sil, F4 |
| Her komutta "Update dependencies?" sorusu | `react`, `react-native` veya `@types/react` package.json'a yazılmış | Onları sil (uygulama zaten sağlar). Soruyu atlamak için `CI=true` |
| `TS7016 Could not find a declaration file` | Tipleri olmayan npm paketi | `typings/modules.d.ts` içine `declare module "paket";` |
| Make It Native'de native paket çalışmıyor | Paket Make It Native'in içinde yok | Make It Native (10.24) içindeki paketler ve sürümleri native skill'in 9.3 bölümünde listelendi; listede olmayan paket için kendi dev uygulamanı derle |
| Lint yüzlerce hata | Windows CRLF satır sonu | `git config core.autocrlf input`, dosyaları LF yap |
