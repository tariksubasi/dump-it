# dump-it

Mendix projendeki **tüm iş mantığını** (microflow, nanoflow, workflow, sayfa, domain model, XPath, Java action, REST,
güvenlik...) yapay zekanın okuyabileceği düz metin dosyalarına döker. Sonra **OpenCode** (veya Claude Code) o klasörde
çalışır ve "bu nerede oluyor, bu bug nereden geliyor, bu değişiklik neyi etkiler" sorularına **dosya + adım numarasıyla**
cevap verir. Studio Pro'da yaptığın değişikliği **`/kontrol`** ile kontrol eder. İstersen modeli **`/degistir`** ile
**senin onayınla** kendisi değiştirir.

- Okuma ve kontrol için sadece **Python** ve **Git** lazım. `pip install` yok, internet yok.
- Mendix 9 / 10 / 11 projeleriyle çalışır.
- Export projene **hiçbir şey yazmaz**, sadece okur. Model değiştirme ayrı ve isteğe bağlıdır
  ([Modeli yapay zekayla değiştirmek](#modeli-yapay-zekayla-değiştirmek-mxlocal)).

---

## Kurulum (bir kere yapılır)

1. Python ve Git kurulu mu kontrol et (ikisi de sürüm numarası yazmalı):
   ```
   python --version
   git --version
   ```
   `python` bulunamazsa bu sayfadaki bütün komutlarda `python` yerine `py` yaz.
2. Aracı indir:
   ```
   git clone https://github.com/tariksubasi/dump-it.git C:\tools\dump-it
   ```
3. Çalışıyor mu diye dene (yardım metni çıkmalı):
   ```
   python C:\tools\dump-it\mxcontext.py --help
   ```

Aracın yeni sürümü çıkınca güncellemek için:
```
cd C:\tools\dump-it
git pull
```

### Mac: tek komutla kurulum

Terminal'e yapıştır:
```
curl -fsSL https://raw.githubusercontent.com/tariksubasi/dump-it/feature/local-sdk/scripts/setup-mac.sh | bash
```
Script sırayla şunları yapar: eksik araçları Homebrew ile kurar (git, Python, Node 22.13+, OpenCode), repoyu
`~/dump-it` içine alır, ev klasöründeki Mendix projelerini bulur ve sorar, `verify` ve `selftest`'i projenin bir
kopyasında çalıştırır, `.gitignore`'a `.mxlocal-backup/` ekler ve export alır. Modele hiçbir şey yazmaz. Belirli bir
proje için: `bash ~/dump-it/scripts/setup-mac.sh ~/Mendix/BenimProje`. Mac'te `mx check` (sadece Windows) çalışmaz.

---

## Her gün kullanım (adım adım)

1. **Studio Pro'da her şeyi kaydet** (Ctrl+S). Studio Pro'yu kapatmana gerek yok.
2. **Export'u çalıştır** (proje klasörünün yolunu yaz):
   ```
   python C:\tools\dump-it\mxcontext.py "C:\Projeler\BenimProje"
   ```
3. Birkaç saniye sonra projenin yanında **`C:\Projeler\BenimProje-context`** klasörü oluşur.
4. **OpenCode'u o klasörde aç:**
   ```
   cd C:\Projeler\BenimProje-context
   opencode
   ```
5. **Sorunu sor ya da isteği yaz** (aşağıda örnekler var). OpenCode nerede neyin değişmesi gerektiğini dosya ve adım
   numarasıyla söyler.
6. **Değişikliği Studio Pro'da kendin yap** ve **Ctrl+S** ile kaydet. (Ya da OpenCode'a yaptır: `/degistir`, aşağıya bak.)
7. **Aynı OpenCode konuşmasında yaz:**
   ```
   /kontrol
   ```
   OpenCode export'u yeniler, **sadece değişen yerlere** bakar ve şunu söyler: doğru olanlar, eksikler, yanlışlıkla
   değişen şeyler ve etkilenen diğer yerler.
8. **Eksik varsa** Studio Pro'da düzelt, kaydet ve 7. adımı tekrarla. OpenCode her seferinde işin tamamına bakar.
9. **Her şey doğruysa** OpenCode bu hali "kontrol edildi" olarak kaydeder. Bir sonraki kontrol sadece bundan sonraki
   değişiklikleri görür.
10. **Yeni bir iş için** OpenCode'da yeni bir konuşma aç ve 5. adımdan devam et.

### OpenCode komutları

| Komut | Ne yapar |
|---|---|
| `/kontrol` | Export'u yeniler ve Studio Pro'daki değişikliğini kontrol eder. Yeni konuşmadaysan ne yaptığını yaz: `/kontrol şirket pasifse testler gizlensin` |
| `/degistir <istek>` | Modeli OpenCode değiştirir (dry run, onay, uygulama). Bkz. [mxlocal](#modeli-yapay-zekayla-değiştirmek-mxlocal) |
| `/geri-al` | Son uygulanan değişikliği geri alır |
| `/senkron` | `git pull` / merge / branch değişikliğinden sonra export'u yeniler ve başlangıç noktası yapar |

OpenCode komutları otomatik olarak izinli çalıştırır. Sadece **modeli yazan** komutlar (`apply`, `undo`) her seferinde
senin onayını ister.

---

## Başka durumlar

1. **Projede `git pull` / merge yaptıysan ya da başka branch'e geçtiysen** OpenCode'da `/senkron` yaz. Böylece takım
   arkadaşlarının değişiklikleri senin kontrollerine karışmaz.
2. **Son günlerde ne değiştirdiğini** sorabilirsin:
   ```
   Dünden beri modelde neler değişti?
   ```

---

## Modeli yapay zekayla değiştirmek (mxlocal)

`mxlocal`, resmi **Mendix Model SDK**'yı internetsiz, doğrudan yerel `.mpr` dosyası üzerinde çalıştırır. OpenCode
kod yazmaz; hazır ve test edilmiş **işlemlerden** bir değişiklik dosyası doldurur. Mendix 10 / 11 (MPR v2) projeleri
için. Ek kurulum yok: gerekli her şey `C:\tools\dump-it\mxlocal` içinde gelir. İlk komut bütün modeli okur ve
`.mxlocal-backup\cache.bin` önbelleğini yazar; sonraki komutlar sadece değişen dokümanları yeniden okur (Mendix 11.6
örnek projede dry run ~2,2 sn → ~0,6 sn).

**MCP sunucusu (en hızlısı):** export, OpenCode'a ve Claude Code'a `mendix` adında bir MCP sunucusu kaydeder
(`opencode.json`, `.mcp.json`). Sunucu modeli bellekte açık tutar: bir dry run ~0,2 sn sürer. Yapay zeka `plan` aracıyla
değişikliği tek çağrıda yazar ve dener. Modeli **yazan** araç yoktur: uygulama yine senin onayınla
`python mx.py apply <KOD>` ile olur. Claude Code ilk açılışta `mendix` sunucusunu onaylamanı ister: onayla. Sunucu
istemiyorsan export'u `--no-mcp` ile al.

| Alan | Yapabildikleri |
|---|---|
| Domain model | Entity, attribute (tüm tipler), association, kalıtım (generalization), validation rule, event handler, index, enumeration |
| Microflow / nanoflow | Oluşturma; retrieve, create, change, commit, delete, rollback, call, log, mesaj, değişken, sayfa aç/kapat, ana sayfa; **karar (if), nesne tipi kararı + cast, döngü (liste / while), break, continue, hata yakalama (error handler)** |
| Liste ve diğer aksiyonlar | Liste oluşturma/değiştirme (ekle, çıkar, değiştir, temizle), aggregate (count, sum, average, min, max, all, any), liste işlemleri (union, intersect, subtract, contains, equals, head, tail, find, filter, sort, range), validation feedback, Java action ve JavaScript action çağırma (parametreleri kontrol edilerek), REST çağrısı (URL şablonu, method, header, timeout, metin ya da export mapping gövdesi; cevap yok / String / import mapping), import mapping ile içe aktarma, export mapping ile dışa aktarma, dosya indirme. Test projelerindeki aksiyonların ~%99'u |
| Var olan akış | Araya adım ekleme (döngü içine de), **tek bir adımı değiştirme** (XPath, değer, koşul, devre dışı bırakma...) ve **silme** |
| Sayfa | Bir entity için düzenleme formu (alan tipine göre input, Kaydet/İptal), boş sayfa ya da widget listesinden sayfa: layout grid, container, metin/başlık, data grid (klasik ya da projedeki bir Data grid 2'den kopya), seçili satırı gösteren data view (listenTo), list view (master-detail için data view içinde), butonlar, input'lar, **tab container, group box, snippet çağrısı, resim (image collection'dan statik ya da `System.Image` nesnesinin resmi), reference selector**; projede Studio Pro'nun kaydettiği bir örneği varsa **combo box ve gallery** (pluggable, Data grid 2 gibi kopyalanır; yoksa klasik karşılığı önerilerek reddedilir); her widget'ta **koşullu görünürlük** (attribute değer(ler)i ya da expression), input'larda **koşullu düzenlenebilirlik**, CSS class ve style; menü öğesi ve ana sayfa (rol bazlı da) |
| İlişkisel sayfalar | Her data widget'ında veri kaynağı: veritabanı (XPath), **association** (data view içinde bir referans, list view / grid / gallery / template grid için referans set ya da ters referans; yanlış yön açık hatayla), **microflow / nanoflow** (dönüş tipi kontrollü), **context** (list view öğesindeki data view), page parameter, listen. Her seviyede nesne bağlamı: grid -> seçili satırı gösteren data view -> association list view (satır başına düzenlenebilir input) -> context data view -> reference selector. **Parametre eşleme** (`params`): butonlar, snippet çağrıları ve microflow/nanoflow kaynakları için `$currentObject`, `$dataView1`, `$grid1.selection` (Multi seçim -> List parametresi), `$Parametre` ya da expression; tip kontrolü ve "bunu mu demek istediniz" |
| Grid ve gallery aksiyonları | Klasik grid kontrol çubuğu: Yeni / Düzenle / Sil / microflow-nanoflow (seçili satır ya da Multi seçimde satırlar listesi); Data grid 2 ve gallery `onClick`; Data grid 2'de dinamik metin ve özel içerik (satır başına widget) kolonları; **template grid**; **reference set selector**; seçilebilir nesneler microflow'dan; input, selector ve combo box'ta **on change** aksiyonu; `changeWidget` ile butonun aksiyonunu, onClick ve onChange'i değiştirme |
| Var olan sayfa | Var olan sayfa/snippet'e aynı widget'ları ekleme (container, data view, list view, group box, tab page, layout grid kolonu), widget değiştirme (yazı, etiket, görünürlük, düzenlenebilirlik, class, grid kolonları, XPath, isim), silme, taşıma; `widgets` komutu sayfanın widget ağacını gösterir |
| Modül | Yeni modül (domain model, modül güvenliği ve ayarlarıyla, Studio Pro'nun oluşturduğu gibi) ve modül rolleri |
| Güvenlik | Modül rolü, erişim kuralı, microflow/nanoflow/sayfa erişimi verme ve geri alma |
| Kullanıcı rolü | Yeni kullanıcı rolü (modül rolleriyle, `System.User` dahil), var olan kullanıcı rolüne modül rolü ekleme (ör. Administrator'a yeni modülün rolü) |
| Demo kullanıcı | Bir ya da birkaç kullanıcı rolüyle demo kullanıcı; entity'si diğer demo kullanıcılarınki gibi |
| Güvenlik seviyesi | Off / Prototype / Production, demo kullanıcıları açma/kapama, misafir (anonymous) erişimi |
| JSON entegrasyonu | Örnek JSON'dan JSON structure (Studio Pro'nun ürettiği isim, yol ve tiplerle), import ve export mapping (iç içe nesneler ve diziler association ile; eksik entity/attribute/association'ları aynı planda oluşturma ya da var olanlara isimle eşleme, "bunu mu demek istediniz" önerisiyle), import/export with mapping adımları |
| Diller ve çeviriler | Projeye dil ekleme (ör. `tr_TR`, istenirse varsayılan dil), var olan metinleri çevirme (`setTranslations`: sayfa başlığı, widget caption/metin/etiket/placeholder, enumeration caption'ı, mesaj ve validation feedback metni, validation rule mesajı, menü caption'ı), her op'ta dile göre metin (`"caption": {"en_US": "Save", "tr_TR": "Kaydet"}`; düz metin varsayılan dildir), çevrilecek metinleri listeleme (`python mx.py texts Modül --missing tr_TR`) |
| REST istemcisi (consumed REST) | Mendix 10.1+ REST client dokümanı: base URL, Basic kimlik doğrulama (constant ile şifre), operasyonlar (method, `{param}` path, query parametreleri, header'lar, metin şablonu ya da export mapping gövde, import mapping cevap), microflow'da `sendRestRequest` adımı. **Studio Pro'da kontrol edin**: test projelerinde Studio Pro'nun kaydettiği bir örnek yok, SDK metamodelinden kuruluyor |
| Published REST | Kaynak (resource) ve operasyonlar; path / query / header / gövde parametreleri, gövde için import mapping, sonuç için export mapping, istenirse operasyonun microflow'unu da oluşturma, roller, servis versiyonu (OpenAPI). **Studio Pro'da kontrol edin** |
| OData, XML | Published OData servisi (entity'ler, attribute'lar, anahtar, association, enumeration, ekleme/güncelleme/silme, sayfalama; Mendix 10.4+), `.xsd` dosyasından XML schema, XML schema ya da message definition üzerinden XML import/export mapping, entity'den message definition. **Studio Pro'da kontrol edin** (OData'nın tek örneği var, XML'in hiç yok). Consumed OData, SOAP web service ve business event: Studio Pro adımlarıyla reddedilir |
| Workflow | Workflow dokümanı: context entity, user task (görev sayfası, kullanıcı rolü / XPath / microflow ile atama, outcome'lar ve her outcome'un adımları), decision (Boolean ya da enumeration), parallel split, call microflow, call workflow, jump, timer, bildirim bekleme, end; user task sayfası (`createPage` `"kind": "userTaskPage"`: WorkflowUserTask parametresi, context nesnesi, outcome butonları); microflow aksiyonları: workflow başlatma, görevi tamamlama, durum değiştirme (abort/pause/...), context alma, jump-to, kilitleme, notify, görev/admin sayfası açma. **Studio Pro'da kontrol edin**: örnek yok, SDK metamodelinden kuruluyor |
| Diğer | Constant, scheduled event, doküman taşıma, yeniden adlandırma (modül dahil), silme |

Yapamadıkları (Studio Pro'da ya da SDK script'iyle): layout düzenleme, listede olmayan widget'lar (template grid,
reference set selector, file manager; Data grid 2, combo box ve gallery dışındaki pluggable widget'lar), parametreli
snippet çağrısı, design property'ler (Atlas toggle'ları), rol bazlı görünürlük, import/export mapping
dokümanının kendisi, JSON structure, consumed REST servisi, workflow, nesne gövdeli REST operasyonları; REST
çağrısında kimlik doğrulama, proxy, form-data/binary gövde; export with mapping ve reduce aggregate.

**Bir kere yapılır:**

1. Node sürümünü kontrol et, **22.13 veya üstü** olmalı:
   ```
   node --version
   ```
2. Projende kendi kendine kontrol çalıştır (projeye hiçbir şey yazmaz):
   ```
   node C:\tools\dump-it\mxlocal\mxlocal.js verify --project "C:\Projeler\BenimProje"
   ```
   İlk üç satır `identical` / `all mapped values identical` demeli.
3. Bütün işlemleri projenin **geçici bir kopyasında** dene (gerçek projeye hiçbir şey yazmaz):
   ```
   node C:\tools\dump-it\mxlocal\mxlocal.js selftest --project "C:\Projeler\BenimProje"
   ```
   50 kadar işlemi dener ve 16 kontrol yapar: kayıpsız kayıt, her işlemin modelde görünmesi, **Studio Pro'nun bu
   projede yazdığı yapıyla aynı yapı**, yeni modül ve güvenlik (kullanıcı rolü, demo kullanıcı), dashboard sayfası ve
   menü, Data grid 2 kopyası, modül yeniden adlandırma, byte byte okuma/yazma, SDK ile yeniden açma.
   Bütün satırlar `OK` demeli. 2. veya 3. adımda `FAIL` varsa model değiştirmeyi **kullanma**, çıktıyı bana gönder.
   `Note: first use` satırındaki tipler projende hiç yok; bunları Studio Pro'da görmek için `--keep` ekle, kopyayı
   Studio Pro'da aç ve Errors paneline bak.
4. Projenin `.gitignore` dosyasına şu satırı ekle (yedek klasörü projenin git'ine girmesin):
   ```
   .mxlocal-backup/
   ```
5. Export'u bir kere yeniden çalıştır. OpenCode'a `/degistir` komutu ve `guides\EDIT.txt` eklenir.

**Her değişiklikte:**

1. Projenin git'inde her şey commit'li olsun (ekstra güvenlik ağı).
2. OpenCode'a isteği yaz:
   ```
   /degistir Sales.Order entity'sine Note adında String(500) attribute ekle
   ```
3. OpenCode isimleri bulur, değişiklik dosyasını yazar ve **deneme çalıştırması** (dry run) yapar. Hiçbir şey yazılmaz.
   Sana planı, değişecek dokümanları, uyarıları ve **4 haneli bir onay kodu** gösterir.
4. **Studio Pro'yu kapat.** Studio Pro açıkken mxlocal yazmayı reddeder.
5. Uygunsa kodla onay ver:
   ```
   evet 7F3A
   ```
   OpenCode ayrıca komut için izin ister: **izin ver**. mxlocal önce `.mxlocal-backup\<tarih>` altına yedek alır, sonra
   yazar, her işlemin modelde olduğunu kontrol eder, export'u yeniler ve değişen dosyaları gösterir.
6. **Studio Pro'yu aç**, Errors panelinde hata olmadığına bak, gerekirse uygulamayı çalıştır.
7. Sorun varsa Studio Pro'yu kapatıp `/geri-al` yaz. Model, son uygulamadan önceki haline byte byte geri döner.
8. Her şey doğruysa projeyi her zamanki gibi commit et.

Bilinmesi gerekenler:

1. Onay kodu **son dry run'a** bağlıdır. Arada model değiştiyse (Studio Pro'da kaydettin, pull yaptın) uygulama
   reddedilir ve dry run tekrarlanır. Böylece onaylamadığın bir değişiklik yazılmaz.
2. Dry run şu uyarıları gösterir. Hepsini oku:
   - `EXPRESSION CHECK`: ifadede olmayan bir attribute ya da değişken var (`$Order/Remak` → `Remark`).
   - `OLD NAME STILL USED`: yeniden adlandırma; expression, XPath ve Java içindeki eski isimleri güncellemez.
   - `STILL USED BY`: silinen şeyi kullanan dokümanlar.
   - `NOT STORED`: script'in verdiği bir değer bu Mendix sürümünde saklanmıyor.
   - `first use in this project` / `never occurs`: bu tip projende ilk kez kullanılıyor. Studio Pro'da özellikle
     kontrol et.
   - `> Modül.Doküman -> Modül/Klasör`: doküman başka klasöre taşınıyor.
3. Var olan bir microflow'un tek adımını değiştirmek için OpenCode önce adımların kimliklerini (id) listeler
   (`python mx.py steps Modül.Microflow`), sonra o id ile değiştirir ya da siler.
4. Hiçbir işlem uymuyorsa OpenCode bunu `edits/gaps.jsonl`'e **eksik** olarak kaydeder (`python mx.py gap "..."`) ve
   sana Studio Pro adımlarını verir. Model SDK script'leri (`.js`) **varsayılan olarak kapalıdır**: bir script, onayından
   önce bilgisayarında her şeyi yapabilir. Güçlü bir modelle (ör. Claude) bilerek açmak için export'u
   `--allow-scripts` ile al.
5. Son söz Studio Pro'nundur: Errors paneli temiz değilse `/geri-al`.
6. **Geri alma güvenlidir:** uygulamadan sonra Studio Pro'da kaydettiysen `/geri-al` bunu silmez; neyin kaybolacağını
   listeler ve durur. Kabul edersen `python mx.py undo --force`. Sonradan gelen dosyalar silinmez, yedeğe taşınır.
7. **Değişiklik dosyaları kaybolmaz:** her uygulama değişikliğin kendisini de yedekler. Geri aldıktan sonra
   `python mx.py rerun` aynı değişikliği yeniden dener; dosya `edits/` içinden silinmişse yedekten geri getirir.
   Her dry run, uygulama ve geri alma `edits/journal.jsonl` içinde kayıtlıdır.

### OpenCode'a öğretmek

Ajan için yazılmış tam kılavuz: [`docs/OPENCODE.md`](docs/OPENCODE.md) (komutlar, işlemler, çıktıların anlamı,
hatalar). Export bunu `guides/MANUAL.md` olarak klasöre koyar ve `AI_GUIDE.txt` ona yönlendirir. OpenCode emin
olmadığında kendisi okur. İstersen konuşmanın başında şunu yaz:
```
guides/MANUAL.md dosyasını oku ve buna göre çalış.
```

### DeepSeek (ya da başka küçük bir model) ile kullanım

Kurulum bunları kendisi ayarlar: düşük temperature (0.1), kısa komutlar (`python mx.py ...`), adım adım protokol
(`guides\EDIT.txt`), hazır örnekler ve "bunu mu demek istedin?" önerili hata mesajları. Senin yapacakların:

1. **Konuşmaları kısa tut.** Her iş için yeni konuşma aç. Uzun konuşmada küçük modeller kuralları unutur.
2. **Bir istekte bir iş iste.** "Şu entity'yi ekle, şu microflow'u değiştir" yerine ikisini ayrı `/degistir` ile yap.
3. **İsimleri tam yaz** (`Modül.İsim`). Bilmiyorsan önce sor: `Order ile ilgili entity'ler neler?`
4. Model takılırsa (aynı hatayı 3 kez yapıyorsa) hatayı kopyalayıp yeni konuşmada `/degistir` ile tekrar dene.

> **Veri gizliliği:** DeepSeek'i bulut API'si üzerinden kullanıyorsan, OpenCode'un okuduğu her dosya (şirketin iş
> mantığı) o sunucuya gider. Bu, aşağıdaki 1. kurala aykırı olabilir. Şirketinin iznini al ya da modeli yerel çalıştır
> (Ollama, LM Studio, vLLM) veya veri sözleşmesi olan bir sağlayıcı kullan.

---

## Örnek sorular

```
PUT /rest/.../solver-test çağrılınca ne oluyor? Adım adım anlat, alt microflow'lar dahil.
```
```
Ulug.Company.Publishable alanını kim değiştiriyor, hangi sayfada düzenleniyor?
```
```
"Kullanıcı bulunamadı." mesajı hangi durumda dönüyor?
```
```
Nerede mail atıyoruz, nerede dış servise REST çağrısı yapıyoruz?
```
```
Yeni istek: şirket pasif olunca testleri öğrencilere görünmesin. Etkilenecek entity, microflow,
sayfa ve rolleri listele, yan etkileri söyle.
```
```
Student rolü hangi entity'leri silebilir?
```
```
Onay workflow'unda "Yönetici onayı" task'ı neden bazı kullanıcılara düşmüyor? Workflow "PaymentReceived"da neden bekliyor?
```
```
/degistir Sales.Invoice entity'si oluştur: Number AutoNumber, Total Decimal; Sales.Order'a bağla
```

---

## Çıktı klasöründe ne var?

| Dosya / klasör | Ne işe yarar |
|---|---|
| `AI_GUIDE.txt` | Yapay zekaya klasörü nasıl okuyacağını anlatır (OpenCode ve Claude Code otomatik yükler) |
| `guides/` | Değiştirme (`EDIT.txt`) ve kontrol (`CHECK.txt`) protokolleri; sadece gerektiğinde okunur |
| `mx.py` | Yapay zekanın kısa komutları: `python mx.py help` |
| `edits/` | Yapay zekanın yazdığı değişiklik dosyaları (export yenilense de silinmez) |
| `opencode.json`, `.opencode/` | OpenCode ayarları, izinler, `/komutlar` ve araçlar |
| `overview.txt` | Modüller, roller, menü, açılışta çalışan microflow |
| `index/entry-points.txt` | REST endpoint'leri, zamanlanmış işler, event handler'lar |
| `index/called-by.txt` | Bir microflow'u kim çağırıyor |
| `index/entity-usage.txt` | Bir entity'yi kim oluşturuyor / değiştiriyor / siliyor |
| `index/attributes.txt` | Bir alanı kim set ediyor, hangi sayfada görünüyor |
| `index/external-effects.txt` | REST çağrıları, task queue, mail/SSO gibi marketplace modül kullanımları |
| `index/security.txt` | Hangi rol neye erişebiliyor |
| `index/texts.txt` | Ekrandaki / hata mesajlarındaki yazılar (tüm diller) nerede geçiyor |
| `index/unused.txt` | Hiç kullanılmayan dokümanlar |
| `index/workflows.txt` | Workflow'lar: user task kime düşüyor, hangi sayfa, outcome'lar, timer'lar, bekleme noktalarını kim notify ediyor |
| `modules/<Modül>/...` | Her microflow, sayfa, Java action vb. için ayrı dosya |
| `.git` | Kontrol geçmişi (aşağıya bak) |

---

## Kontrol nasıl çalışıyor?

1. Export, `-context` klasöründe **sadece senin bilgisayarında duran ayrı bir git** tutar. Projenin kendi git'ine
   dokunmaz.
2. İlk export o anki modeli başlangıç noktası olarak kaydeder.
3. Sonraki her export, son kontrol edilen halden bu yana değişen dosyaları hazırlar. OpenCode bunları `git diff` ile
   okur; 900 dosya yerine sadece değişen birkaç dosyaya bakar.
4. Kontrol "her şey doğru" derse OpenCode bu hali kaydeder ve bu yeni başlangıç noktası olur.
5. `-context` klasörünü silersen geçmiş de silinir, sorun olmaz. Sonraki export yeniden başlar.

---

## Ek seçenekler

| Komut | Ne yapar |
|---|---|
| `-o D:\baska\klasor` | Çıktıyı başka yere yazar |
| `--include-marketplace` | Marketplace modüllerini de detaylı döker |
| `--show-constant-values` | Constant değerlerini de yazar (içinde şifre/API key olabilir, dikkat) |
| `--no-opencode-tools` | OpenCode'a özel araçları (`.opencode/tools`) yazmaz. OpenCode açılışta takılırsa kullan |
| `--no-mcp` | MCP sunucusunu kaydetmez; OpenCode daha yavaş, komut başına başlayan araçları kullanır |
| `--allow-scripts` | Ajanın Model SDK script'i (`.js`) çalıştırmasına izin verir. Script onaydan önce tam yetkiyle çalışır; sadece güvendiğin bir modelle kullan |

---

## Kurallar (önemli)

1. **`-context` klasörünü asla GitHub'a veya başka bir yere yükleme.** İçinde şirketin iş mantığı var. İçindeki git'e
   remote ekleme.
2. Şifreler ve demo kullanıcılar dışa aktarılmaz. Constant değerleri varsayılan olarak `***` ile gizlenir.
3. Yapay zekanın cevabını, özellikle güvenlik ve commit konularında, **Studio Pro'da kontrol et.**

---

## Sorun giderme

| Hata | Çözüm |
|---|---|
| `python` bulunamadı | `py mxcontext.py ...` dene |
| `No .mpr file found` | Yol yanlış. İçinde `.mpr` dosyası olan klasörü ver |
| `Refusing to overwrite` | Hedef klasör başka bir şey içeriyor. `-o` ile boş bir klasör ver |
| `Cannot clean ...` | Çıktı klasöründe açık bir dosya var. Onu kapatıp tekrar çalıştır |
| `git not found: change checks are disabled` | Git kurulu değil. Export çalışır ama `/kontrol` çalışmaz. Git'i kur |
| OpenCode kontrolde değişiklik bulamıyor | Studio Pro'da Ctrl+S yaptın mı? Kaydetmeden export eski modeli görür |
| `overview.txt` sonunda `WITHOUT A DEDICATED RENDERER` yazıyor | O tipler basit `key=value` olarak çıktı. Çalışır, sadece daha az okunaklıdır |
| `Studio Pro has this project open` | Studio Pro'yu kapat, tekrar dene |
| `Code ... does not match the last dry run` | Arada yeni bir dry run yapılmış. Son dry run'ın kodunu kullan |
| `The model changed since the dry run` | Studio Pro'da kaydettin ya da pull yaptın. OpenCode dry run'ı tekrarlar, yeni kodla onay ver |
| `Nothing to undo` | Geri alınacak bir uygulama yok (hepsi zaten geri alınmış) |
| `node:sqlite` / `No such built-in module` | Node 22.13'ten eski. Node'u güncelle |
| `/degistir` komutu yok | `node` PATH'te değil ya da `mxlocal\node_modules` eksik. `git pull` yap, export'u tekrar çalıştır |
| `MPR v1 format` | Proje eski formatta. Okuma ve kontrol çalışır, değiştirme çalışmaz |
| OpenCode açılırken uzun süre bekliyor | İnternet yoksa OpenCode `.opencode` için paket indirmeyi dener. Export'u `--no-opencode-tools` ile çalıştır |

**Claude Code kullanıyorsan:** klasördeki `CLAUDE.md` rehberi otomatik yükler. `/kontrol` gibi komutlar yerine aynı
isteği düz yazıyla yaz (örnek: `Değişikliğimi kontrol et, guides/CHECK.txt'ye göre`). Export klasöre
`.claude/settings.json` da yazar: `apply` ve `undo` senden onay ister; ajan kendi izin dosyalarını değiştiremez,
`git push` / `reset` / `checkout` gibi geçmişi bozan komutları çalıştıramaz.

---

## Otomatik test (CI)

Her push'ta GitHub Actions `scripts/ci.sh` çalıştırır: doküman örnekleri (`doccheck`), 16 herkese açık Mendix
projesinin (10.22 – 11.14) export'u ve her birinde `mxlocal selftest`. Projeler sabit commit'lere bağlıdır; kırmızı bir
çalışma her zaman dump-it'teki bir değişiklik demektir. Yerelde: `bash scripts/ci.sh` (projeleri `.ci-projects`
klasörüne indirir, ~1 GB).

## Eval (doğal dil testleri)

`eval/requests.json` içindeki Türkçe istekleri gerçek bir ajana yaptırır ve sonucu kontrol eder. Her istek temiz bir
kopyada çalışır: ajan dry run'a kadar gider, sonra script uygular, export'u yeniler ve beklenen isimlere ve metinlere
bakar. Başarı, tur sayısı ve süre raporlanır.
```
node eval/run.js --project C:\Projeler\Kopya\App.mpr --agent opencode --model deepseek/deepseek-chat
node eval/run.js --project ~/proje/App.mpr --agent claude --only attr,dashboard
```
Eval kendi kopyalarında çalışır; projene dokunmaz. DeepSeek ile çalıştırırsan kopyalanan model DeepSeek'e gider.

## Lisanslar

- `mxlocal/node_modules/mendixmodelsdk`: Mendix Model SDK, MIT lisansı.
- `mxlocal/storage-names.json`: [mxcli](https://github.com/mendixlabs/mxcli) projesinin üretilmiş Go tiplerinden
  türetilmiştir, Apache-2.0 lisansı.
- `mxlocal/list-markers.json`, `mxlocal/reference-catalog.json`: Studio Pro ile oluşturulmuş açık kaynak test
  projelerinden öğrenilmiştir: [mxcli](https://github.com/mendixlabs/mxcli) test projeleri (Apache-2.0) ve
  [mendix/testProjects](https://github.com/mendix/testProjects) (Mendix 10.22 – 11.12).
