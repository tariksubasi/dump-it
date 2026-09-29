# dump-it

Mendix projendeki **tüm iş mantığını** (microflow, nanoflow, sayfa, domain model, XPath, Java action, REST, güvenlik...)
yapay zekanın okuyabileceği düz metin dosyalarına döker. Sonra **OpenCode** (veya Claude Code) o klasörde çalışır ve
"bu nerede oluyor, bu bug nereden geliyor, bu değişiklik neyi etkiler" sorularına **dosya + adım numarasıyla** cevap verir.

- Sadece **Python** lazım. `pip install` yok, internet yok.
- Mendix 9 / 10 / 11 projeleriyle çalışır.
- Projene **hiçbir şey yazmaz**, sadece okur.

---

## Kurulum (bir kere yapılır)

1. Bu sayfada yeşil **Code** butonuna bas, **Download ZIP** ile indir.
2. Zip'i `C:\tools\dump-it` klasörüne çıkar.
3. Çalışıyor mu diye dene:
   ```
   python C:\tools\dump-it\mxcontext.py --help
   ```
   `python` bulunamazsa aynı komutu `py` ile dene.

---

## Her gün kullanım (adım adım)

1. **Studio Pro'da değişikliklerini kaydet** (Ctrl+S). Studio Pro'yu kapatmana gerek yok.
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
5. **Sorunu sor** (aşağıda örnekler var). Cevap dosya yolu ve adım numarasıyla gelir.
6. **Değişikliği Studio Pro'da kendin yap.** Yapay zeka modeli değiştirmez, sadece yol gösterir.
7. Model değişti mi? **1. adıma dön.**

---

## Model değişince tekrar çalıştırmalı mıyım?

**Evet.** Export o anın fotoğrafıdır. Şunlardan sonra 2. adımı tekrar çalıştır:

- Studio Pro'da bir şey değiştirip kaydettiysen,
- `git pull` / SVN update / merge yaptıysan,
- Başka bir branch'e geçtiysen.

Birkaç saniye sürer. OpenCode açık kalabilir, ama eski bilgilerle karışmasın diye **yeni bir konuşma başlat.**

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

---

## Çıktı klasöründe ne var?

| Dosya / klasör | Ne işe yarar |
|---|---|
| `AI_GUIDE.txt` | Yapay zekaya klasörü nasıl okuyacağını anlatır (OpenCode otomatik yükler) |
| `overview.txt` | Modüller, roller, menü, açılışta çalışan microflow |
| `index/entry-points.txt` | REST endpoint'leri, zamanlanmış işler, event handler'lar |
| `index/called-by.txt` | Bir microflow'u kim çağırıyor |
| `index/entity-usage.txt` | Bir entity'yi kim oluşturuyor / değiştiriyor / siliyor |
| `index/attributes.txt` | Bir alanı kim set ediyor, hangi sayfada görünüyor |
| `index/external-effects.txt` | REST çağrıları, task queue, mail/SSO gibi marketplace modül kullanımları |
| `index/security.txt` | Hangi rol neye erişebiliyor |
| `index/texts.txt` | Ekrandaki / hata mesajlarındaki yazılar (tüm diller) nerede geçiyor |
| `index/unused.txt` | Hiç kullanılmayan dokümanlar |
| `modules/<Modül>/...` | Her microflow, sayfa, Java action vb. için ayrı dosya |

---

## Ek seçenekler

| Komut | Ne yapar |
|---|---|
| `-o D:\baska\klasor` | Çıktıyı başka yere yazar |
| `--include-marketplace` | Marketplace modüllerini de detaylı döker |
| `--show-constant-values` | Constant değerlerini de yazar (içinde şifre/API key olabilir, dikkat) |

---

## Kurallar (önemli)

1. **`-context` klasörünü asla GitHub'a veya başka bir yere yükleme.** İçinde şirketin iş mantığı var.
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
| `overview.txt` sonunda `WITHOUT A DEDICATED RENDERER` yazıyor | O tipler basit `key=value` olarak çıktı. Çalışır, sadece daha az okunaklıdır |

**Claude Code kullanıyorsan:** ilk mesajda `Önce AI_GUIDE.txt dosyasını oku` de. OpenCode bunu kendisi yapar.
