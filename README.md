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
proje için: `bash ~/dump-it/scripts/setup-mac.sh ~/Mendix/BenimProje`. Mac'te projenin sürümündeki Studio Pro kuruluysa
Studio Pro kontrolü (`mx check`) de çalışır (bkz. [Studio Pro kontrolü](#studio-pro-kontrolü-mx-check)).

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
| Domain model | Entity, attribute (tüm tipler), association, kalıtım (generalization; `System.Image` / `System.FileDocument` / `System.User` dahil), validation rule, event handler, index, enumeration; **hesaplanan (calculated) attribute** (microflow ile; stored <-> calculated geçişi, kolon düşerse DATA LOSS satırı); **association ayarları** (Reference <-> ReferenceSet, owner Default/Both, Table/Column saklama, silmede: bağlıları da sil / tut / mesajla engelle; tip değişince DATA LOSS satırı); **view entity** (Mendix 11+, OQL'den; kolon tipleri seçilen attribute'lardan; Mendix 10'da açık mesajla reddedilir); external entity'ler (consumed OData) export'ta görünür, değiştirilmez |
| Microflow / nanoflow | Oluşturma; retrieve, create, change, commit, delete, rollback, call, log, mesaj, değişken, sayfa aç/kapat, ana sayfa; **karar (if), nesne tipi kararı + cast, döngü (liste / while), break, continue, hata yakalama (error handler)** |
| Enumeration kararı ve rule | **switch**: enumeration değerine göre her değer (ya da "A, B") için ayrı yol, kalanlar için `other`, boş değer için `empty`, sonra birleşme; **rule** dokümanı (Boolean ya da enumeration döner, sadece okur/hesaplar) ve rule çağıran karar (`if`/`switch` + `rule` + `args`) |
| Java / JavaScript action | `createJavaAction` / `createJavaScriptAction`: parametreler (metin, sayı, tarih, entity, liste, enumeration, tip parametresi `EntityType(T)` / `Object(T)` / `List(T)`, microflow / nanoflow), dönüş tipi, toolbox'ta aksiyon olarak gösterme; **Java/JS dosyası Studio Pro'nun ürettiği gibi** (`javasource/<modül>/actions/<Ad>.java`, `javascriptsource/.../<Ad>.js`) değişikliğin parçası: dry run'da görünür, yedeklenir, `/geri-al` ile geri alınır; var olan dosyanın import'ları, USER CODE ve EXTRA CODE kısmı korunur; uygulamadan sonra elle değiştirilmiş dosyayı geri alma silmez (önce sorar) |
| Akışı yeniden düzenleme | `moveAction` (adımı başka yere, bir karar dalına ya da döngüye taşıma; değişken sırası bozulursa reddedilir), `extractMicroflow` (ardışık adımları yeni alt microflow'a taşıyıp yerine çağrı koyar; parametreler kullanılan değişkenler, dönüş değeri sonra kullanılan değişken), `addAnnotation` ve aksiyonlarda `note` (not), `changeAction` ile karar koşulu/caption, rule argümanları, döngü koşulu |
| Akış yerleşimi (layout) | Eklenen adımlar akışı bozmaz: yalnızca eklenen yerden sonrası kayar, karar dalında dal kendi şeridinde kalır, döngü içeriğine göre (en dıştakine kadar) büyür, yoldaki nesneler kenara itilir, bağlı notlar adımla birlikte taşınır; silme/taşıma boşluğu kapatır. `formatMicroflow`: akışın tamamını Studio Pro düzeninde yeniden yerleştirir (iki kez çalıştırmak aynı sonucu verir). Dry run'da **LAYOUT CHECK** satırları (çakışan nesneler, döngü dışına taşan nesne, nesnenin içinden geçen akış, çok uzun ana hat); `--preview` ile önce/sonra SVG çizimi (`edits/preview/`) |
| Diğer aksiyonlar | **reduce** aggregate (dönüş tipi başlangıç değerinden, gerekirse `type`), **metrikler** (counter, increment, gauge), REST çağrısında **kimlik doğrulama** (constant/expression ile basic), header, timeout, **proxy** (varsayılan / yok / özel), **form-data** ve **binary (dosya)** gövde, export mapping gövdesi, cevap: yok / metin / **dosya dokümanı** / import mapping, hata gövdesini `$latestHttpResponse`'ta tutma |
| Liste ve diğer aksiyonlar | Liste oluşturma/değiştirme (ekle, çıkar, değiştir, temizle), aggregate (count, sum, average, min, max, all, any), liste işlemleri (union, intersect, subtract, contains, equals, head, tail, find, filter, sort, range), validation feedback, Java action ve JavaScript action çağırma (parametreleri kontrol edilerek), REST çağrısı (URL şablonu, method, header, timeout, metin ya da export mapping gövdesi; cevap yok / String / import mapping), import mapping ile içe aktarma, export mapping ile dışa aktarma, dosya indirme. Test projelerindeki aksiyonların ~%99'u |
| Var olan akış | Araya adım ekleme (döngü içine de), **tek bir adımı değiştirme** (XPath, değer, koşul, devre dışı bırakma, sıralama, aralık, referans set ekle/çıkar...) ve **silme** |
| Retrieve ve referans set | Veritabanından retrieve'da **sıralama** (`sort`: artan/azalan, referans üzerinden `"Order_Customer/Name"` da), **özel aralık** (`range`: offset + limit, ör. ilk 10) ve `first` ile sıralı tek nesne; association retrieve'da Studio Pro'daki gibi sıralama/aralık yok (açık mesajla reddedilir); create/change adımında referans set'e **ekleme/çıkarma** (`add` / `remove`: `$Nesne` ya da `$Liste`; Studio Pro'nun Add/Remove'u) |
| Snippet ve hazır sayfalar | **`createSnippet`**: nesne parametreli snippet (widget'lar `createPage` gibi; parametreyi gösteren data view), sayfalara `snippetCall` ile; **`createCrud`**: Studio Pro'nun "Generate overview pages"i gibi `<Entity>_Overview` (Data grid 2 kurulabiliyorsa onunla, değilse klasik grid; Yeni / Düzenle / Sil) ve `<Entity>_NewEdit` (Kaydet/İptal formu), istenirse menü öğesi, rollere sayfa erişimi ve entity erişim kuralı |
| Değiştirme ve silme | `changeConstant` (değer, tip, client'a açık), `changeScheduledEvent` (microflow, zamanlama, başlangıç saati, açık/kapalı), `changeValidationRule` / `deleteValidationRule`, `deleteEventHandler`, `changeIndex` / `deleteIndex`; enumeration değerinin **sırası** (`moveEnumerationValue`), dile göre caption'ı ve **resmi** (`changeEnumerationValue`, `addEnumerationValue` `image`) |
| Kim kullanıyor / kullanılmayanlar | `python mx.py usages Modül.İsim [--depth n]`: bir doküman, entity, attribute, association, enumeration değeri... kimler kullanıyor (isimle ve expression/XPath içinde), doküman doküman, yeriyle (widget adı, adım id, kolon). `python mx.py unused [Modül]`: kimsenin kullanmadığı dokümanlar, entity'ler, attribute'lar, enumeration değerleri (menü, ana sayfa, zamanlanmış görev, yayınlanan servis, event handler, Java'dan çağrılanlar, URL'li sayfalar hariç); sadece "muhtemelen kullanılmıyor", asla otomatik silmez. Büyük projede ~0,4 sn |
| Microflow imzası | `changeMicroflow`: parametre ekleme (çağıranların vereceği değerle), silme, yeniden adlandırma, tip; dönüş tipi ve değeri. **Tüm çağıranlar** (call adımları, rule kararları, sayfa butonları, data source, on change) güncellenir; parametre veremeyenler (zamanlanmış görev, menü, ana sayfa, event handler) varsa reddeder ve listeler |
| Kopyalama | `copyDocument`: sayfa, snippet, layout, microflow, nanoflow, rule, enumeration ya da entity'yi (attribute, validation ve erişim kurallarıyla; isterse association'larıyla) yeni isimle / başka modüle kopyalar; içindeki referanslar kopyaya bağlanır. `entity` eşlemesiyle sayfayı başka bir entity için kopyalar (attribute'lar isimle; eşleşmeyenler listelenip reddedilir ya da `skipUnmatched` ile çıkarılır). Başka modülde module role eşlemesi |
| Entity taşıma | `changeEntity` (persistable aç/kapat, kapatırken DATA LOSS uyarısı; doküman; domain model resmi), `moveEntity` (entity'yi başka modüle taşır: association'lar Studio Pro kurallarıyla, erişim kuralı rolleri eşlenir, tüm referanslar expression/XPath dahil güncellenir; veri korunur) |
| Sayfa | Bir entity için düzenleme formu (alan tipine göre input, Kaydet/İptal), boş sayfa ya da widget listesinden sayfa: layout grid, container, metin/başlık, data grid (klasik ya da `widgets/*.mpk`'den kurulan Data grid 2), seçili satırı gösteren data view (listenTo), list view (master-detail için data view içinde), butonlar, input'lar, **tab container, group box, snippet çağrısı, resim (image collection'dan statik ya da `System.Image` nesnesinin resmi), reference selector**; **combo box ve gallery** (pluggable, `widgets/*.mpk`'den kurulur; .mpk yoksa klasik karşılığı önerilerek reddedilir); her widget'ta **koşullu görünürlük** (attribute değer(ler)i ya da expression), input'larda **koşullu düzenlenebilirlik**, CSS class ve style; menü öğesi ve ana sayfa (rol bazlı da) |
| İlişkisel sayfalar | Her data widget'ında veri kaynağı: veritabanı (XPath), **association** (data view içinde bir referans, list view / grid / gallery / template grid için referans set ya da ters referans; yanlış yön açık hatayla), **microflow / nanoflow** (dönüş tipi kontrollü), **context** (list view öğesindeki data view), page parameter, listen. Her seviyede nesne bağlamı: grid -> seçili satırı gösteren data view -> association list view (satır başına düzenlenebilir input) -> context data view -> reference selector. **Parametre eşleme** (`params`): butonlar, snippet çağrıları ve microflow/nanoflow kaynakları için `$currentObject`, `$dataView1`, `$grid1.selection` (Multi seçim -> List parametresi), `$Parametre` ya da expression; tip kontrolü ve "bunu mu demek istediniz" |
| Grid ve gallery aksiyonları | Klasik grid kontrol çubuğu: Yeni / Düzenle / Sil / microflow-nanoflow (seçili satır ya da Multi seçimde satırlar listesi); Data grid 2 ve gallery `onClick`; Data grid 2'de dinamik metin ve özel içerik (satır başına widget) kolonları; **template grid**; **reference set selector**; seçilebilir nesneler microflow'dan; input, selector ve combo box'ta **on change** aksiyonu; `changeWidget` ile butonun aksiyonunu, onClick ve onChange'i değiştirme |
| Var olan sayfa | Var olan sayfa/snippet'e aynı widget'ları ekleme (container, data view, list view, group box, tab page, layout grid kolonu, **gallery öğesi, Data grid 2 özel içerik kolonu ve diğer pluggable widget listeleri** `slot` ile), widget değiştirme (yazı, etiket, görünürlük, düzenlenebilirlik, class, **design property**, grid kolonları, XPath, isim), silme, taşıma; **`changePage`**: başlık, URL, pop-up boyutu, parametre ekleme/silme/yeniden adlandırma (çağıranları bozacaksa listeleyip reddeder); `widgets` komutu sayfanın widget ağacını gösterir |
| Association yolları | Attribute alınan her yerde referans üzerinden yol: `"Order_Customer/Name"` (ya da `Modül.Assoc/Name`, entity adıyla `"Customer/Name"`, çok adımlı `"Order_Customer/Customer_Country/Name"`): klasik grid ve Data grid 2 kolonları, list view / gallery alanları, input'lar (Studio Pro'daki gibi salt okunur), sıralama, arama, Data grid 2 filtreleri, `{Assoc/Attr}` metinleri, attribute'a göre görünürlük/düzenlenebilirlik (expression'a çevrilir), reference selector ve combo box caption'ı. Studio Pro'nun yazdığı gibi saklanır (AttributeRef + association adımları); çoğa giden adım liste widget'ı önerilerek reddedilir |
| Buton aksiyonları | Buton, grid butonu, `onClick`, `onChange`/`onEnter`/`onLeave`/`onEnterKeyPress` ve menü öğesi için tek aksiyon modeli: sayfa açma, microflow/nanoflow, **nesne oluşturma** (`create`: sayfa + etrafındaki nesneye association ile bağlama), **link açma** (web/e-posta/telefon/SMS; sabit ya da attribute'tan), **çıkış** (`signOut`), **senkronizasyon** (offline profilde), **workflow başlatma**; seçenekler: **onay sorusu** (`confirm`, dile göre metin), **ilerleme çubuğu** (`progress` + mesaj), validation hatasında durma, seçimi koruma, sayfa kapatma, **sayfa başlığını değiştirme** (`pageTitle`) |
| Form ve doğrulama | Input'larda **zorunlu alan** (`required` + mesaj, Studio Pro'nun Required'ı) ve **özel doğrulama** (`validation`: expression + mesaj); **sayı/tarih formatı** (ondalık, basamak gruplama, tarih/saat/özel kalıp) input'ta, metin parametresinde ve klasik grid kolonunda; maske ve maksimum uzunluk; salt okunur görünüm (`readOnlyStyle`); data view'da **yatay/dikey form**, etiket genişliği, footer; **sayfa değişkenleri** (`variables`: değişkene bağlı input, expression ve parametrelerde `$Değişken`); reference selector'da **seçim sayfası** (`selectPage`); Data grid 2'de **Excel'e aktarma** (Data Widgets `Export_To_Excel` nanoflow'u + buton); projede native profil varsa **native alt menü ve ana sayfa** |
| Pluggable widget'lar ve görünüm | **Her pluggable widget** (`"widget": "pluggable"`): `widgets/*.mpk` tanımından Studio Pro'nun bıraktığı gibi kurulur (bütün özellikler varsayılan değerinde; test projelerindeki her Studio Pro örneğiyle birebir aynı tip), özellikler tip kontrolü ve "bunu mu demek istediniz" ile verilir; `python mx.py widgettype <ad>` özellikleri listeler. Data grid 2: **kolon filtreleri** (metin/sayı/tarih/açılır liste), **varsayılan sıralama**, sayfalama türü, checkbox seçimi, satır class'ı, kişiselleştirme attribute'u; klasik grid / template grid / list view'da **arama ve sıralama**; **Atlas design property'leri** (`"design": {"Spacing top": "Large"}`, tema dosyasından doğrulanır); **modül rolüne göre görünürlük**; **file manager ve image uploader**; sayfa **URL'i ve pop-up boyutu**; **page template / building block'tan sayfa** (`from`), **layout kopyalama** (`createLayout`), projede native layout varsa **native sayfa**; association yolu üzerinden liste (A/B) |
| Data grid 2 kolonları ve filtreler | Kolon başına **genişlik** (auto fill / auto fit / manuel + boyut, en az genişlik), **hizalama** (sol/orta/sağ), gizlenebilir (evet / varsayılan gizli / hayır), boyutlandırma, sürükleme, sıralama, kolon **görünürlük expression'ı**, hücre **tooltip**'i (`{Attribute}`), metin kaydırma, sabit ya da dinamik **hücre class'ı**: kurulu datagrid .mpk sürümünde ne varsa (olmayan alan sürümüyle birlikte reddedilir); `changeWidget` `columns.change` ile var olan kolonda değiştirme; klasik grid'de genişlik ve class. **Association filtresi**: `"Order_Customer/Name"` kolonunda `filter: true` müşteri açılır listesi (çoklu seçim, seçenek XPath'i; Data Widgets 3 örneği gibi, 2.x'te kolonun filterAssociation'ı); **grid / gallery üstünde filtreler** (`headerFilters`: birkaç attribute'ta tek arama kutusu, enum açılır listesi, association açılır listesi); grid dışındaki ya da sayfa değişkenine bağlı filtre net mesajla reddedilir. Liste/grid/gallery XPath'inde **sayfa değişkeni** (`[contains(Name, $Search)]`; bilinmeyen değişken "bunu mu demek istediniz", tip uyuşmazlığı dry run'da XPATH CHECK uyarısı) |
| Offline ve domain model düzeni | **`setOfflineSync`**: offline / native profilde entity başına senkronizasyon (tümü, XPath ile, hiçbiri (veri silinir / korunur), asla, online; `default` ayarı kaldırır); nanoflow'da **`synchronize`** aksiyonu (tümü, senkronize edilmemişler, verilen değişkenler); offline profil yoksa net mesajla reddedilir. Yeni entity'ler domain model'de **boş bir yere**, ilişkili entity'nin (parent ya da ilk association'ın diğer ucu) yanına konur; **`arrangeDomainModel`** `{ module, mode: compact \| grid }` diyagramı düzenler (yalnızca konumlar, her seferinde aynı sonuç); kutular üst üste binerse dry run'da **DOMAIN LAYOUT** uyarısı; `createEntity` dokümantasyon alır, renk reddedilir (Mendix saklamaz) |
| Menü ve navigasyon | Menü öğesi ekleme (sayfa ya da microflow, ikon, sıra: `after`/`before`), **taşıma ve sıralama** (alt menüye, en üste, kardeşlerin arasına), **değiştirme** (dile göre caption, açtığı sayfa/microflow, ikon, sayfasını açabilecek roller), **silme**; **menü dokümanı** (`Menus$MenuDocument`) oluşturma ve bir layout'taki menu bar / navigation tree'ye bağlama (`useMenu`); projede olmayan cihaz tipi için **navigasyon profili** (Tablet, Phone, offline'ları; Responsive menüsü kopyalanabilir) |
| Görünüm ve erişilebilirlik | Her widget'ta **dinamik class** (`dynamicClass`: expression, `$currentObject` kontrolüyle) ve **tab sırası** (`tabIndex`); butonda **ikon** (`glyphicon-pencil`, Atlas `mx-icon-add`, ikon koleksiyonu ya da image collection resmi; yanlış adda "bunu mu demek istediniz"), **sadece ikon** (`iconOnly`), **tooltip**, link görünümü (`renderType`), `ariaRole`; **drop-down buton** (`dropDownButton`: her öğenin kendi aksiyonu); input'ta **ekran okuyucu metni** (`ariaLabel`) ve `ariaRequired`; resimde **alternatif metin** (`alt`); container'da **HTML elemanı** (`renderMode`: section, nav, header, main ...), **tıklama aksiyonu** (`onClick`) ve `screenReaderHidden`; layout grid satır/kolonunda **dikey/yatay hizalama**, class, style, design, kolonlar arası boşluk; **çoklu seçimli design property** (`"Hide on": ["Phone", "Tablet"]`) ve ColorPicker'da özel renk; **sayfa class/style**'ı; `changePage` ile **layout değiştirme** (placeholder içerikleri aynı isimdekine taşınır, karşılığı olmayan dolu placeholder listelenip reddedilir); **layout'un kendi widget'larını** (header, sidebar, menü) ekleme/değiştirme/taşıma/silme (sayfaların kullandığı placeholder korunur). Dry run'da **A11Y CHECK** (başlıksız ve tooltip'siz buton, alternatif metinsiz resim, etiketsiz input, atlanan başlık seviyesi). Mendix'in saklamadığı şeyler (kolon offset/sırası, input tooltip'i, buton aria label'ı) alternatifiyle reddedilir |
| Tema (SCSS) | `theme/` ve `themesource/` altındaki `.scss`, `.css`, `design-properties.json` dosyalarını değiştirme (tam içerik, bul/değiştir, sona ekleme) ve `addCssClass` ile CSS class kuralı ekleme; **`addDesignProperty`** ile kendi design property'ni tanımlama (`themesource/<modül>/web/design-properties.json` + class'larının CSS kuralları modülün `main.scss`'inde; aynı değişiklikte widget'larda kullanılabilir); **`setThemeVariable`** ile marka renkleri, font, boşluk gibi SCSS değişkenleri (`theme/web/custom-variables.scss`; değer kontrolü, bilinmeyen değişkende "bunu mu demek istediniz"); dry run'da **diff** gösterilir, model gibi yedeklenir ve `/geri-al` ile geri alınır; bu klasörlerin dışı reddedilir |
| Native mobil stil | **`setNativeVariables`**: `theme/native/custom-variables.js` içindeki Atlas native değişkenleri (marka renkleri, font, boşluk, köşe yarıçapı; `"brand.primary"` gibi `grup.anahtar`), `{ "light": ..., "dark": ... }` ile **karanlık mod**, `"$border.radiusLarge"` ile başka değişkene referans; renk ve sayı kontrolü (`"16px"` yerine `16`), bilinmeyen adda "bunu mu demek istediniz". **`setNativeTokens`**: web temasıyla aynı token JSON'u (renk skalaları, spacing, radius, tipografi, elevation, dark) native değişkenlere eşlenir, karşılığı olmayanlar listelenir. **`addNativeStyle`**: kendi modülünün `themesource/<modül>/native/main.js` dosyasına React Native stil class'ı (widget elemanları: container, caption, icon ...; `"use": "$elevation.level2"` ile gölge seviyesi); web CSS'i (`box-shadow`, `background-color`, `px`) React Native karşılığıyla reddedilir. **`addNativeDesignProperty`**: `native/design-properties.json` içinde native design property (seçenek başına stil class'ı). Native sayfalarda widget `class` ve `design` (native temadan), inline CSS reddedilir. JS dosyaları güvenli şekilde ayrıştırılır (proje kodu çalıştırılmaz), `node --check` ile doğrulanır; dry run'da **diff** ve **NATIVE STYLE CHECK** (bozuk JS, bilinmeyen stil anahtarı, tanımsız class, iç içe kaydırma, tıklanabilir container içinde liste/buton); model gibi yedeklenir ve geri alınır; Marketplace modülleri (Atlas_Core ...) reddedilir |
| Native sayfalar | `createPage` `"native": true` ya da sayfa türü (`"popup"`, `"fullPage"`, `"topBarOnly"`, `"sideMenu"`): projenin o türdeki native layout'u kullanılır. Native sayfada text, container, buton, data view, list view, text box, text area, check box, date picker, radio buttons, drop-down, reference selector, resim, tab container, layout grid, snippet ve `widgets/*.mpk` içindeki **native pluggable widget**'lar; `addWidgets` / `changeWidget` / `moveWidget` / `deleteWidget` native sayfada da çalışır. Web'e özgü widget'lar (data grid, template grid, gallery, combo box, reference set selector, file manager, image uploader, group box, drop-down buton, web pluggable) ve `callWorkflow` native karşılığı söylenerek reddedilir; native sayfadan web sayfası (ve tersi) açılamaz; native sayfada microflow çağrısına "bağlantı gerekir" uyarısı; **native snippet** (`createSnippet` `"native": true`; native sayfa yalnızca native snippet gösterir); native alt menüde **ikon** ve **sıra** (`addMenuItem` `icon`, `after` / `before`); telefon özellikleri için `callJavaScript` yalnızca aksiyon adıyla (`"TakePicture"`, `"GetCurrentLocation"`; modül yoksa NativeMobileResources / NanoflowCommons'ı Marketplace'ten eklemesi söylenir); NATIVE STYLE CHECK native sayfadaki microflow veri kaynağı ve aksiyonunu da bildirir (bağlantı olmadan çalışmaz); `createLayout` native layout kopyasında `bottomBar`, `sidebar`, `popup`; uygulama olayları (App events widget'ı), deep link ve push bildirimleri için JavaScript aksiyonları (push servisinin kurulumu Studio Pro / Native Builder'da) |
| Marketplace paketleri | Widget `.mpk`'sını `widgets/` klasörüne kurma (`importWidget`; widget tipini söyler, aynı widget varsa `replace` ister), modül `.mpk`'sını içe aktarma (`importModulePackage`: dokümanlar kendi id'leriyle, `javasource`, `userlib`, `vendorlib`, `themesource`, `widgets` dosyaları); aynı isimde modül varsa, paket projeden yeni bir Mendix sürümü içinse ya da eski sürümün farklı saklanan dokümanları varsa reddeder ve Studio Pro adımlarını verir |
| Git merge (MPR v2) | `python mx.py mergecheck`: merge sonrası `.mpr` / `mprcontents` çakışmalarını doküman bazında analiz eder (tek tarafın değiştirdiği dokümanlar otomatik çözülür; iki tarafın da değiştirdiği dokümanlar için her tarafın ne değiştirdiğini gösterir); `python mx.py mergefix --pick "<doküman>=ours|theirs"` onay kodlu dry run yapar, `apply` birleşmiş unit dosyalarını yazar ve `.mpr` Unit tablosunu (ContentsHash) yeniden kurar; sonra `git add` + `git commit` |
| Modül | Yeni modül (domain model, modül güvenliği ve ayarlarıyla, Studio Pro'nun oluşturduğu gibi) ve modül rolleri |
| Güvenlik | Modül rolü, erişim kuralı ekleme / **değiştirme / silme** (attribute ve association başına ReadWrite/ReadOnly/None, XPath, create/delete, sonradan eklenen üyelerin hakkı; `System.Image`/`System.FileDocument`'ten gelen üyeler dahil, `System.User` üyeleri Studio Pro gibi listelenmez), microflow/nanoflow/sayfa erişimi verme ve geri alma |
| Kullanıcı rolü | Yeni kullanıcı rolü (modül rolleriyle, `System.User` dahil), var olan kullanıcı rolüne modül rolü ekleme (ör. Administrator'a yeni modülün rolü) |
| Demo kullanıcı | Bir ya da birkaç kullanıcı rolüyle demo kullanıcı; entity'si diğer demo kullanıcılarınki gibi |
| Güvenlik seviyesi | Off / Prototype / Production, demo kullanıcıları açma/kapama, misafir (anonymous) erişimi |
| JSON entegrasyonu | Örnek JSON'dan JSON structure (Studio Pro'nun ürettiği isim, yol ve tiplerle), import ve export mapping (iç içe nesneler ve diziler association ile; eksik entity/attribute/association'ları aynı planda oluşturma ya da var olanlara isimle eşleme, "bunu mu demek istediniz" önerisiyle), import/export with mapping adımları |
| Diller ve çeviriler | Projeye dil ekleme (ör. `tr_TR`, istenirse varsayılan dil), var olan metinleri çevirme (`setTranslations`: sayfa başlığı, widget caption/metin/etiket/placeholder, enumeration caption'ı, mesaj ve validation feedback metni, validation rule mesajı, menü caption'ı, **sistem metinleri** `system:mendix.signin.username`), her op'ta dile göre metin (`"caption": {"en_US": "Save", "tr_TR": "Kaydet"}`; düz metin varsayılan dildir), çevrilecek metinleri listeleme (`python mx.py texts Modül --missing tr_TR`) |
| Uygulama ayarları | After startup / before shutdown / health check microflow'u, hash algoritması (BCrypt/SSHA256), yuvarlama, haftanın ilk günü, varsayılan saat dilimi (`istanbul` -> `Europe/Istanbul` önerisi); **configuration** oluşturma/değiştirme (constant değerleri, custom runtime ayarları, root URL) |
| Resimler | Image collection oluşturma, export klasöründeki PNG/JPG/SVG dosyasını ekleme (en fazla 2 MB, tip içerikten okunur) |
| REST istemcisi (consumed REST) | Mendix 10.1+ REST client dokümanı: base URL, Basic kimlik doğrulama (constant ile şifre), operasyonlar (method, `{param}` path, query parametreleri, header'lar, metin şablonu ya da export mapping gövde, import mapping cevap), microflow'da `sendRestRequest` adımı. **Studio Pro'da kontrol edin**: test projelerinde Studio Pro'nun kaydettiği bir örnek yok, SDK metamodelinden kuruluyor |
| Published REST | Kaynak (resource) ve operasyonlar; path / query / header / gövde parametreleri, gövde için import mapping, sonuç için export mapping, istenirse operasyonun microflow'unu da oluşturma, roller, servis versiyonu (OpenAPI). **Studio Pro'da kontrol edin** |
| OData, XML | Published OData servisi (entity'ler, attribute'lar, anahtar, association, enumeration, ekleme/güncelleme/silme, sayfalama; Mendix 10.4+), `.xsd` dosyasından XML schema, XML schema ya da message definition üzerinden XML import/export mapping, entity'den message definition. **Studio Pro'da kontrol edin** (OData'nın tek örneği var, XML'in hiç yok). Consumed OData, SOAP web service ve business event: Studio Pro adımlarıyla reddedilir |
| Workflow | Workflow dokümanı: context entity, user task (görev sayfası, kullanıcı rolü / XPath / microflow ile atama, outcome'lar ve her outcome'un adımları), decision (Boolean ya da enumeration), parallel split, call microflow, call workflow, jump, timer, bildirim bekleme, end; user task sayfası (`createPage` `"kind": "userTaskPage"`: WorkflowUserTask parametresi, context nesnesi, outcome butonları); microflow aksiyonları: workflow başlatma, görevi tamamlama, durum değiştirme (abort/pause/...), context alma, jump-to, kilitleme, notify, görev/admin sayfası açma. **Studio Pro'da kontrol edin**: örnek yok, SDK metamodelinden kuruluyor |
| Diğer | Constant, scheduled event, doküman taşıma, yeniden adlandırma (modül dahil), silme |

Yapamadıkları (Studio Pro'da ya da SDK script'iyle): layout'un kendi widget'larını düzenleme, Data Widgets modülü
olmadan (ya da CSV'ye) Data grid 2 dışa aktarma, pluggable widget'larda ikon ve bağlı (linked) veri kaynağı (grid dışındaki filtre: `headerFilters` kullanılır), sayfa değişkenine bağlı filtre, offline profili olmayan uygulamada senkronizasyon ayarı (profil Studio Pro'da eklenir), entity rengi, native
navigasyon profili ekleme ve native pluggable widget'lar, görev/workflow açma butonları (microflow ile yapılır), çok seçenekli design property'ler (Hide on), consumed OData, SOAP web service, business event (net mesajla
reddedilir), çok dosyalı ya da attribute/choice içeren XML schema, OpenAPI'den REST import'u, çok kullanıcılı user
task ve var olan workflow'u düzenleme, ML model çağrısı, hata yakalayıcısı olan adımları taşıma/ayırma, Java/JavaScript
action'ı oluşturduktan sonra değiştirme; Mendix 10'da view entity, external entity oluşturma/değiştirme,
configuration'ın veritabanı ayarları. Örneği olmayan tipler (workflow, consumed REST, OData, XML, rule, calculated
attribute ve benzerleri) yazılır ama dry run "Studio Pro'da kontrol edin" der.

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
   `Note: first use` satırındaki tipler projende hiç yok; bunları Studio Pro'nun kendi kontrolünden geçirmek için
   `--mxcheck` ekle (Studio Pro kuruluysa kopya üzerinde `mx check` çalışır, yeni hataları doküman doküman listeler),
   ya da `--keep` ekle, kopyayı Studio Pro'da aç ve Errors paneline bak.
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
   yazar, her işlemin modelde olduğunu kontrol eder, export'u yeniler ve değişen dosyaları gösterir. Studio Pro
   kuruluysa bir de **STUDIO PRO CHECK** çalışır: Studio Pro'nun kendi kontrolü (`mx check`) modelin bir kopyasında;
   değişikliğin eklediği hatalar `! NEW` satırlarıyla gelir, projede zaten olan hatalar düşülür.
6. **Studio Pro'yu aç**, gerekirse uygulamayı çalıştır. STUDIO PRO CHECK çalışmadıysa önce Errors paneline bak.
7. Sorun varsa Studio Pro'yu kapatıp `/geri-al` yaz. Model, son uygulamadan önceki haline byte byte geri döner.
8. Her şey doğruysa projeyi her zamanki gibi commit et.

Bilinmesi gerekenler:

1. Onay kodu **son dry run'a** bağlıdır. Arada model değiştiyse (Studio Pro'da kaydettin, pull yaptın) uygulama
   reddedilir ve dry run tekrarlanır. Böylece onaylamadığın bir değişiklik yazılmaz.
2. Dry run şu uyarıları gösterir. Hepsini oku:
   - `XPATH CHECK` / `EXPRESSION CHECK`: XPath ya da ifadede olmayan bir attribute, ilişki, değişken, fonksiyon veya
     yanlış tip var (`$Order/Remak` → `Remark`, Decimal alana `'abc'`). `(warning)` olmayan satır varsa dry run
     onay kodu vermez; OpenCode değişiklik dosyasını düzeltip tekrar dener.
   - `OLD NAME STILL USED`: yeniden adlandırma; expression, XPath ve Java içindeki eski isimleri güncellemez.
   - `STILL USED BY`: silinen şeyi kullanan dokümanlar.
   - `NOT STORED`: script'in verdiği bir değer bu Mendix sürümünde saklanmıyor.
   - `first use in this project` / `never occurs`: bu tip projende ilk kez kullanılıyor. Uygulamadan sonraki
     STUDIO PRO CHECK `No new errors` diyorsa sorun yok; kontrol çalışmadıysa Studio Pro'da özellikle bak.
   - `> Modül.Doküman -> Modül/Klasör`: doküman başka klasöre taşınıyor.
3. Var olan bir microflow'un tek adımını değiştirmek için OpenCode önce adımların kimliklerini (id) listeler
   (`python mx.py steps Modül.Microflow`), sonra o id ile değiştirir ya da siler.
4. Hiçbir işlem uymuyorsa OpenCode bunu `edits/gaps.jsonl`'e **eksik** olarak kaydeder (`python mx.py gap "..."`) ve
   sana Studio Pro adımlarını verir. Model SDK script'leri (`.js`) **varsayılan olarak kapalıdır**: bir script, onayından
   önce bilgisayarında her şeyi yapabilir. Güçlü bir modelle (ör. Claude) bilerek açmak için export'u
   `--allow-scripts` ile al.
5. Son söz Studio Pro'nundur: STUDIO PRO CHECK `NEW` hata gösteriyorsa ya da Errors paneli temiz değilse `/geri-al`.
6. **Geri alma güvenlidir:** uygulamadan sonra Studio Pro'da kaydettiysen `/geri-al` bunu silmez; neyin kaybolacağını
   listeler ve durur. Kabul edersen `python mx.py undo --force`. Sonradan gelen dosyalar silinmez, yedeğe taşınır.
7. **Değişiklik dosyaları kaybolmaz:** her uygulama değişikliğin kendisini de yedekler. Geri aldıktan sonra
   `python mx.py rerun` aynı değişikliği yeniden dener; dosya `edits/` içinden silinmişse yedekten geri getirir.
   Her dry run, uygulama ve geri alma `edits/journal.jsonl` içinde kayıtlıdır.

### Studio Pro kontrolü (mx check)

Studio Pro'nun Errors panelindeki kontrolün komut satırı hali (`mx check`). mxlocal bunu **projenin geçici bir
kopyasında** çalıştırır (mx kontrol ettiği projeye dosya yazar; senin projene hiçbir şey yazılmaz) ve sonucu
doküman adlarıyla `STUDIO PRO CHECK` bloğunda gösterir. Değişiklikten önceki hatalar (her kayıtlı model için bir kez
hesaplanıp `.mxlocal-backup\mxcheck` içinde saklanır) düşülür, kalanlar `! NEW` satırlarıdır.

- **Ne zaman çalışır:** her `apply`'dan sonra (OpenCode bunu kendisi yapar), `python mx.py check` ile (sadece okur),
  dry run'da `python mx.py dryrun <dosya> --check` ile (değişiklik uygulanmış geçici kopyada).
- **Windows:** projenin sürümündeki Studio Pro kuruluysa kendisi bulur
  (`C:\Program Files\Mendix\<sürüm>\modeler\mx.exe` ya da kullanıcıya özel kurulum
  `%LOCALAPPDATA%\Programs\Mendix\<sürüm>\...`). Başka bir yerdeyse:
  ```
  setx MX_PATH "D:\Mendix\10.24.0.73019\modeler\mx.exe"
  ```
  (yeni bir terminal aç; klasör de verilebilir: `D:\Mendix\10.24.0.73019` ya da bütün sürümlerin olduğu `D:\Mendix`).
- **Mac:** `/Applications/Studio Pro <sürüm>.app` (ya da `~/Applications`) kendiliğinden bulunur. Başka yerdeyse
  `~/.zshrc` içine:
  ```
  export MX_PATH="/Applications/Studio Pro 10.24.0.73019.app/Contents/modeler/mx"
  ```
- **Linux / CI:** MxBuild'i `~/.mendix/mxbuild/<sürüm>/` altına aç (`bash scripts/get-mxbuild.sh 10.24.0.73019`).
- **Proje ayarı:** proje klasöründe `.mxlocal.json`:
  `{ "mx": "D:\\Mendix\\10.24.0.73019\\modeler\\mx.exe", "check": "apply", "checkTimeout": 900 }`
  (`"check": "apply"`: elle `apply --check` demeden her uygulamada; `"all"`: her dry run'da da; süre saniye).
- **Sürüm:** mx, projenin Mendix sürümüyle aynı olmalı (tercihen build numarası da). Başka bir ana/ara sürümün
  (ör. proje 10.24, mx 10.21) mx'i reddedilir: başka sürümün `mx check`'i modeli dönüştürür ya da hata verir. Aynı
  10.24 içinde başka bir yama sürümü bir notla kullanılır.
- **Bulunamazsa:** tek satır `STUDIO PRO CHECK: not run - mx not found ... set MX_PATH ...`; hata sayılmaz, kontrolü
  Studio Pro'da Errors panelinde yaparsın.
- **Denemek:** `node C:\tools\dump-it\mxlocal\mxlocal.js check --project "C:\Projeler\BenimProje"`.

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
| `--inside-project` | Çıktıyı Mendix proje klasörünün içine yazmaya izin verir (önerilmez, uyarı verir) |

---

## Koruma: ajan sadece `edits/` içine yazar

Zayıf modeller (DeepSeek, Qwen, ...) bazen export klasörüne, hatta Mendix projesine yardımcı `.js` / `.py`
dosyaları yazar. Export bunu engeller:

- **OpenCode** (`opencode.json`): ajan sadece `edits/*.json` dosyalarını düzenleyebilir (`--allow-scripts` ile
  `edits/*.js` de). Kabukta `>` / `>>` yönlendirmesi, here-doc (`<<EOF`), `tee`, `cp`, `mv`, `node`, `python -c`,
  `powershell`, `Set-Content`, `Out-File` gibi dosya yazan komutlar **yasak**; `cat` / `head` / `tail` artık sormadan
  çalışmaz. Python sadece `python mx.py ...` ile çalışır.
- **Claude Code**: `.claude/hooks/guard.py` her Write/Edit ve kabuk komutundan önce çalışır; `edits/` dışına yazmayı,
  dosyaya yönlendirmeyi ve `mx.py` dışında bir script çalıştırmayı reddeder (izin listesi ne derse desin).
- **Export yeri**: çıktı klasörü Mendix proje klasörünün içi olamaz (varsayılan zaten yanındaki `<Proje>-context`).
- **`python mx.py clean`**: export'un yazmadığı dosyaları listeler (yardımcı script'ler, notlar, elle değiştirilmiş
  export dosyaları). `python mx.py clean --move` onları `edits/stray/<zaman>/` altına taşır; hiçbir şey silinmez.
  Her dry run böyle dosya varsa uyarır; yeniden export da onları silmek yerine `edits/stray/` altına taşır.

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
| `Refusing to export into ...` | Çıktı klasörü Mendix projesinin içinde ya da onu içeriyor. `-o` vermeden çalıştır (yanına `<Proje>-context` yazar) |
| `WARNING: N file(s) outside edits/` | Ajan klasöre fazladan dosya yazmış. `python mx.py clean` ile bak, `--move` ile kenara al |
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

## Aktivite loglama (autolog)

`tools/autolog` içinde. Bir microflow'a `LogActivity` (nanoflow'a `JS_LogActivity`) çağrısını parametreleri boş
bırakarak ekle; tek komut flow adını, önceki aktivitenin adını ve değişkenini modelden okuyup doldurur.

1. Studio Pro'yu kapat ve işini commit et.
2. Önce dry run (hiçbir şey değiştirmez):
   ```
   python C:\tools\dump-it\tools\autolog\autolog.py "C:\Projeler\BenimProje"
   ```
3. Yazmak için sonuna `--apply` ekle. Sonra Studio Pro'yu aç ve F4 bas.

**Günlük modu (tam otomatik):** microflow'un sonuna, End'den önce tek bir `FlushJournal` koy. Sonra:
```
python C:\tools\dump-it\tools\autolog\autolog.py "C:\Projeler\BenimProje" --insert --apply
```
Araç her aktivitenin arkasına doldurulmuş bir `LogActivity` koyar (decision kolları, error handler yolları, loop
turları dahil). Çalışınca bütün adımlar tek bir `Journal` bloğu olarak yazılır. `--deep` çağrılan sub-microflow'ları
da ekler; `--remove` eklenen her şeyi siler.

Gerekli: `pip install pymongo`. İlk kurulum (Java action, JS action, `ClientLogEntry`) ve kurallar:
[tools/autolog/README.md](tools/autolog/README.md).

## Otomatik test (CI)

Her push'ta GitHub Actions `scripts/ci.sh` çalıştırır: doküman örnekleri (`doccheck`), izin koruması, sahte bir mx ile
STUDIO PRO CHECK testleri (`scripts/test-mxcheck.js`: bulma, sürüm eşleme, çıktı okuma, önceki hataları düşme,
`check` / `run --check` / `apply --check`), 16 herkese açık Mendix projesinin (10.22 – 11.14) export'u ve her birinde
`mxlocal selftest`. Her proje **ayrı ve paralel bir iş** (selftest proje başına ~5 dakika; liste
`bash scripts/ci.sh --list`). Ayrıca `mxcheck` işi iki projede (bir 10.24, bir 11.x) projenin tam sürümündeki
MxBuild'i Mendix CDN'den indirir (`scripts/get-mxbuild.sh`, önbellekli), `selftest --keep --mxcheck` çalıştırır ve
selftest'in eklediği her Studio Pro hatasında kırmızı olur; diğer işleri beklemez, onları da durdurmaz. Projeler
sabit commit'lere bağlıdır; kırmızı bir çalışma her zaman dump-it'teki bir değişiklik demektir.

Yerelde: `bash scripts/ci.sh` (projeleri `.ci-projects` klasörüne indirir, ~1 GB). Tek proje:
`CI_ONLY=Badge bash scripts/ci.sh`; sadece bazı aşamalar: `CI_STAGES=docs,mxcheck-fake bash scripts/ci.sh`; Studio Pro
kontrolüyle: `MX_PATH=... CI_ONLY=Badge CI_STAGES=selftest CI_SELFTEST_ARGS=--mxcheck bash scripts/ci.sh`.

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
