Hatanın kaynağını buldum (widget id ile mpk içindeki klasör uyuşmuyor). Şimdi bunu yakalayan bir kontrol aracını test ediyorum.

Now I'll add the check to the skills and the README.

DeepSeek widget id'sini elle yazmış ve id, mpk'nın içindeki klasörle uyuşmuyor. Sayfa widget'ı bir yolda arıyor, dosyalar başka bir klasörde duruyor. Mpk'nızı göremediğim için kesin değil, ama hata mesajı bu durumla birebir eşleşiyor.

**Neden oluyor**
- Mendix, sayfadaki import yolunu XML'deki id'den üretiyor: `tei.mealcard.TeiMealCard` → `widgets/tei/mealcard/TeiMealCard.android.js`.
- Build aracı ise dosyaları `<packagePath>/<widgetName küçük harf>/` altına yazıyor. Bunu araç kodunda doğruladım (`rollup.config.native.mjs:28`).
- `widgetName` "TeiMealCard" olunca dosyalar `tei/teimealcard/TeiMealCard.android.js` olur.
- Sonuç: sayfa `mealcard` klasörüne bakıyor, dosya `teimealcard` klasöründe. Metro "None of these files exist" diyor.

**Olası kök nedenler**

| # | Kök neden | Puan |
|---|---|---|
| 1 | id elle kısaltılmış: `tei.mealcard.TeiMealCard` (doğrusu `tei.teimealcard.TeiMealCard`) | **9/10** |
| 2 | `package.xml` → `<file path>` id ile uyuşmuyor | 6/10 |
| 3 | Eski mpk duruyor, F4 yapılmamış veya Run Locally yeniden başlatılmamış | 4/10 |
| 4 | mpk elle ziplenmiş ya da web olarak build edilmiş | 2/10 |

**Çözüm seçenekleri**

| Çözüm | Puan | Not |
|---|---|---|
| **A. id'yi build ile uyumlu yap:** `tei.teimealcard.TeiMealCard`, `package.xml` → `<file path="tei/teimealcard"/>` | **9/10** ✅ | En temiz yol. Sayfadaki widget'ı silip yeniden koymak gerekir. |
| B. `widgetName`'i `MealCard` yap (id: `tei.mealcard.MealCard`) | 6/10 | Dosya, tsx ve XML adlarının hepsi değişir. id yine değişir. |
| C. mpk'yı elle açıp klasörün adını değiştir | 2/10 | Her build'de bozulur. Yapmayın. |

**Adımlar (A)**
1. `src/TeiMealCard.xml` içinde id'yi `tei.teimealcard.TeiMealCard` yapın.
2. `src/package.xml` içinde `<file path="tei/teimealcard" />` yazın.
3. `package.json` ve `package.xml` içinde sürümü artırın.
4. `npm run release` çalıştırın.
5. `node <dump-it>/native-widgets/tools/check-mpk.mjs dist/<sürüm>/tei.TeiMealCard.mpk` çalıştırın. Çıktı **OK** olmalı.
6. `widgets/` klasöründeki eski mpk'yı silin, yenisini koyun, F4 yapın.
7. id değiştiği için sayfadaki eski widget hata verir. Onu silin, yenisini koyun, ayarlarını tekrar girin.
8. Run Locally'yi durdurup yeniden başlatın, sonra telefonda Reload yapın.

**Uç durumlar**

| Durum | Ne olur | Çözüm |
|---|---|---|
| Widget birden fazla sayfada | Hepsi kırmızı ekran verir | Studio Pro Errors listesinden her sayfayı bulun, widget'ı yeniden koyun |
| `widgets/` klasöründe aynı id'li iki mpk var | Hangisinin yükleneceği belli olmaz | Sadece yeni mpk kalsın |
| Kırmızı ekran sürüyor | Metro eski bundle'ı kullanıyor | Run Locally'yi yeniden başlatın, Make It Native'i kapatıp açın |
| Satır 26'daki `NativeEncodedImageViewer` | Hatanın sebebi değil, sayfa kodundan bir alıntı | Bir şey yapmayın |

**DeepSeek'in bunu tekrarlamaması için yaptıklarım** (commit `ff7d64c`, pushlandı):
- Yeni `native-widgets/tools/check-mpk.mjs`: npm install gerekmez, sadece Node yeter. id, `package.xml` ve mpk içindeki dosyaları karşılaştırır. Uyuşmazlıkta **FAIL** yazar ve doğru id'yi söyler.
- Hatanızı bir test mpk'sıyla yeniden ürettim. Araç aynı "Unable to resolve module" hatasını yakaladı ve doğru id'yi önerdi. Bizim 5 mpk'mızın hepsi **OK** verdi.
- Native skill'e kural #31 ve bir hata satırı ekledim: "id'yi elle yazma; her release'ten sonra check-mpk OK vermeli".
- Web skill'e, README'nin "Sık hatalar" tablosuna ve `widget-yap` komutuna da aynı kontrolü ekledim. Kontrol OK vermezse ajan durur.

Kontrol aracının çıktısını gönderirseniz kesin teşhisi söylerim.
