# dump-it

Mendix projendeki **tüm iş mantığını** (microflow, nanoflow, workflow, sayfa, domain model, XPath, Java action, REST,
güvenlik...) yapay zekanın okuyabileceği düz metin dosyalarına döker. Sonra **OpenCode** (veya Claude Code) o klasörde
çalışır ve "bu nerede oluyor, bu bug nereden geliyor, bu değişiklik neyi etkiler" sorularına **dosya + adım numarasıyla**
cevap verir. Studio Pro'da yaptığın değişikliği de **"yaptım, kontrol et"** demen yeterli olacak şekilde kontrol eder.

- Sadece **Python** ve **Git** lazım. `pip install` yok, internet yok.
- Mendix 9 / 10 / 11 projeleriyle çalışır.
- Export projene **hiçbir şey yazmaz**, sadece okur. İstersen OpenCode modeli **senin onayınla** değiştirebilir
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
6. **Değişikliği Studio Pro'da kendin yap** ve **Ctrl+S** ile kaydet. (Ya da OpenCode'a yaptır, aşağıya bak.)
7. **Aynı OpenCode konuşmasında yaz:**
   ```
   Söylediğin değişiklikleri yaptım, kontrol eder misin?
   ```
   OpenCode export'u kendisi yeniler, **sadece değişen yerlere** bakar ve şunu söyler: doğru olanlar, eksikler,
   yanlışlıkla değişen şeyler ve etkilenen diğer yerler.
8. **Eksik varsa** Studio Pro'da düzelt, kaydet ve 7. adımı tekrarla. OpenCode her seferinde işin tamamına bakar.
9. **Her şey doğruysa** OpenCode bu hali "kontrol edildi" olarak kendisi kaydeder. Bir sonraki kontrol sadece bundan
   sonraki değişiklikleri görür.
10. **Yeni bir iş için** OpenCode'da yeni bir konuşma aç ve 5. adımdan devam et.

OpenCode ilk seferde `python` ve `git` komutlarını çalıştırmak için izin isteyebilir: **Always allow** de.

---

## Başka durumlar

1. **Projede `git pull` / merge yaptıysan ya da başka branch'e geçtiysen** OpenCode'a şunu yaz:
   ```
   Projeyi pull ettim, export'u yenile.
   ```
   OpenCode export'u yeniler ve bunu yeni başlangıç noktası yapar. Böylece takım arkadaşlarının değişiklikleri
   senin kontrollerine karışmaz.
2. **Yeni konuşmada kontrol istiyorsan** OpenCode önceki planı bilmez. Ne yapmak istediğini bir cümleyle yaz:
   ```
   Şirket pasif olunca testler öğrencilere görünmesin diye değişiklik yaptım, kontrol et.
   ```
3. **Son günlerde ne değiştirdiğini** sorabilirsin:
   ```
   Dünden beri modelde neler değişti?
   ```

---

## Modeli yapay zekayla değiştirmek (mxlocal)

`mxlocal`, resmi **Mendix Model SDK**'yı internetsiz, doğrudan yerel `.mpr` dosyası üzerinde çalıştırır. OpenCode bir
SDK script'i yazar, sen onaylarsın, mxlocal yedek alıp modeli yazar. Mendix 10 (MPR v2) projeleri için. Ek kurulum
yok: gerekli her şey `C:\tools\dump-it\mxlocal` içinde gelir.

**Bir kere yapılır:**

1. Node sürümünü kontrol et, **22.13 veya üstü** olmalı:
   ```
   node --version
   ```
2. Projende kendi kendine kontrol çalıştır (hiçbir şey yazmaz):
   ```
   node C:\tools\dump-it\mxlocal\mxlocal.js verify --project "C:\Projeler\BenimProje"
   ```
   İlk üç satır `identical` / `all mapped values identical` demeli. Demiyorsa model değiştirmeyi **kullanma**,
   çıktıyı bana gönder.
3. Projenin `.gitignore` dosyasına şu satırı ekle (yedek klasörü projenin git'ine girmesin):
   ```
   .mxlocal-backup/
   ```
4. Export'u bir kere yeniden çalıştır. `AI_GUIDE.txt` içine **MODEL EDIT** bölümü eklenir; OpenCode nasıl
   değiştireceğini oradan öğrenir.

**Her değişiklikte:**

1. Projenin git'inde her şey commit'li olsun (ekstra güvenlik ağı).
2. OpenCode'a isteği yaz:
   ```
   BilgeAdam.Video entity'sine Note adında String(200) attribute ekle.
   ```
3. OpenCode script'i yazar, **deneme çalıştırması** (dry run) yapar ve neyin değişeceğini gösterir. Hiçbir şey yazılmaz.
4. **Studio Pro'yu kapat.** Studio Pro açıkken mxlocal yazmayı reddeder.
5. Uygunsa yaz:
   ```
   Onaylıyorum, uygula.
   ```
   mxlocal önce `.mxlocal-backup\<tarih>` altına yedek alır, sonra yazar. OpenCode export'u yenileyip diff'ten
   değişikliğin tam ve doğru olduğunu kontrol eder.
6. **Studio Pro'yu aç**, Errors panelinde hata olmadığına bak, gerekirse uygulamayı çalıştır.
7. Sorun varsa Studio Pro'yu kapatıp OpenCode'a `Geri al.` yaz (veya kendin çalıştır):
   ```
   node C:\tools\dump-it\mxlocal\mxlocal.js restore --project "C:\Projeler\BenimProje"
   ```
   Model, son uygulamadan önceki haline byte byte geri döner.
8. Her şey doğruysa projeyi her zamanki gibi commit et.

Bilinmesi gerekenler:

1. Yeniden adlandırma (rename) tüm dokümanlardaki referansları günceller; **expression, XPath ve Java kodu içindeki**
   isimleri güncellemez. OpenCode bunları ayrıca arar.
2. SDK'nın bu Mendix sürümünde tanımadığı birkaç ayar (`verify` çıktısında listelenir) olduğu gibi korunur, script'ler
   onları göremez.
3. Son söz Studio Pro'nundur: Errors paneli temiz değilse geri al.

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
Söylediğin değişiklikleri yaptım, kontrol eder misin?
```

---

## Çıktı klasöründe ne var?

| Dosya / klasör | Ne işe yarar |
|---|---|
| `AI_GUIDE.txt` | Yapay zekaya klasörü nasıl okuyacağını ve değişiklikleri nasıl kontrol edeceğini anlatır (OpenCode otomatik yükler) |
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
4. Kontrol "her şey doğru" derse OpenCode commit atar ve bu yeni başlangıç noktası olur.
5. `-context` klasörünü silersen geçmiş de silinir, sorun olmaz. Sonraki export yeniden başlar.

---

## Ek seçenekler

| Komut | Ne yapar |
|---|---|
| `-o D:\baska\klasor` | Çıktıyı başka yere yazar |
| `--include-marketplace` | Marketplace modüllerini de detaylı döker |
| `--show-constant-values` | Constant değerlerini de yazar (içinde şifre/API key olabilir, dikkat) |

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
| `git not found: change checks are disabled` | Git kurulu değil. Export çalışır ama "kontrol et" özelliği çalışmaz. Git'i kur |
| OpenCode kontrolde değişiklik bulamıyor | Studio Pro'da Ctrl+S yaptın mı? Kaydetmeden export eski modeli görür |
| `overview.txt` sonunda `WITHOUT A DEDICATED RENDERER` yazıyor | O tipler basit `key=value` olarak çıktı. Çalışır, sadece daha az okunaklıdır |
| `Studio Pro has this project open` | Studio Pro'yu kapat, tekrar dene |
| `No backup '' in ...` | Geri alınacak bir uygulama yok (hepsi zaten geri alınmış) |
| `node:sqlite` / `No such built-in module` | Node 22.13'ten eski. Node'u güncelle |
| `AI_GUIDE.txt` içinde MODEL EDIT yok | `node` PATH'te değil ya da `mxlocal\node_modules` eksik. `git pull` yap |

**Claude Code kullanıyorsan:** ilk mesajda `Önce AI_GUIDE.txt dosyasını oku` de. OpenCode bunu kendisi yapar.

---

## Lisanslar

- `mxlocal/node_modules/mendixmodelsdk`: Mendix Model SDK, MIT lisansı.
- `mxlocal/storage-names.json`: [mxcli](https://github.com/mendixlabs/mxcli) projesinin üretilmiş Go tiplerinden
  türetilmiştir, Apache-2.0 lisansı.
