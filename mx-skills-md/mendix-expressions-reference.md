# Mendix Expressions — Tam Başvuru Kılavuzu (Studio Pro 10/11)

> Kaynak: <https://docs.mendix.com/refguide/expressions/> ve alt sayfaları.
> Mendix dokümantasyonu **CC BY 4.0** lisansı ile yayınlanır. © Siemens Industry Software Netherlands B.V.
> Bu dosya o dokümantasyonun Türkçe açıklamalı, yeniden düzenlenmiş bir özetidir.

---

## İçindekiler

1. [Temel Sözdizimi](#1-temel-sözdizimi)
2. [Sistem Öğeleri](#2-sistem-öğeleri)
3. [Operatörler](#3-operatörler)
4. [Özel Kontroller](#4-özel-kontroller)
5. [If İfadeleri](#5-if-ifadeleri)
6. [Matematik Fonksiyonları](#6-matematik-fonksiyonları)
7. [String Fonksiyonları](#7-string-fonksiyonları)
8. [Tarih Oluşturma](#8-tarih-oluşturma)
9. [Begin-of / End-of Tarih](#9-begin-of--end-of-tarih)
10. [Between (Arasındaki Fark)](#10-between-arasındaki-fark)
11. [Add / Subtract Tarih](#11-add--subtract-tarih)
12. [Trim to Date](#12-trim-to-date)
13. [toString, length, parseInteger](#13-tostring-length-parseinteger)
14. [Decimal Parse/Format](#14-decimal-parseformat)
15. [Tarih Parse/Format](#15-tarih-parseformat)
16. [Enumeration Fonksiyonları](#16-enumeration-fonksiyonları)
17. [Mendix'te OLMAYAN Fonksiyonlar](#17-mendixte-olmayan-fonksiyonlar)
18. [Sık Hatalar ve Çözümler](#18-sık-hatalar-ve-çözümler)
19. [Hazır Tarif Kartları](#19-hazır-tarif-kartları)

---

## 1. Temel Sözdizimi

| Öğe | Yazım | Örnek |
|---|---|---|
| Değişken / nesne | `$` + ad | `$Customer` |
| Attribute | `/` ile | `$Customer/Name` |
| Association | `Modül.Assoc` | `$Customer/CRM.Customer_Order` |
| Zincir erişim | çoklu `/` | `$Customer/CRM.Customer_Order/CRM.Order/Number` |
| String | **tek tırnak** | `'merhaba'` |
| Tırnak kaçışı | iki tek tırnak | `'this isn''t funny'` |
| Boş değer | `empty` | `$Obj = empty` |
| Boolean | `true` / `false` | |
| Decimal | nokta ile | `5.00` |
| Öncelik | parantez | `$A - (($A div 100) * $B)` |

**Kritik kural — değerlendirme sırası:**
Boş nesnenin attribute'una erişim hata verir. İfade o noktada durur ve `false` döner.

```
// YANLIŞ — $Obj boşsa hata, ikinci kısım hiç çalışmaz
$Obj/Attr != $Other/Attr or $Obj = empty

// DOĞRU — önce boş kontrolü
$Obj = empty or $Obj/Attr != $Other/Attr
```

Regex resource dokümanları expression içinde kullanılamaz. Regex'i string olarak verin.

---

## 2. Sistem Öğeleri

| Öğe | Tip | Not |
|---|---|---|
| `$currentUser` | `System.User` | Oturum açan kullanıcı. Önbellekli; güncel veri için DB'den retrieve edin. |
| `$currentSession` | `System.Session` | Mevcut oturum. Önbellekli. |

Ek token'lar (XPath ve bazı alanlarda): `[%CurrentDateTime%]`, `[%BeginOfCurrentDay%]` vb.

---

## 3. Operatörler

### Unary
| Op | Anlam |
|---|---|
| `-` | Negatif |

### Aritmetik
| Op | Anlam | Not |
|---|---|---|
| `*` | Çarpma | |
| `div` veya `:` | Bölme | Sonuç Decimal |
| `mod` | Mod | |
| `+` | Toplama / string birleştirme | En az bir taraf string ise birleştirir |
| `-` | Çıkarma | |

### İlişkisel
`<` `>` `<=` `>=` `=` `!=`

### Boolean
`and` `or` `not(...)`

> `not` bir fonksiyon gibi kullanılır: `not($Obj/IsActive)`

---

## 4. Özel Kontroller

| Kontrol | Yazım |
|---|---|
| Boş nesne | `$Obj = empty` / `$Obj != empty` |
| Boş üye | `$Obj/Attr = empty` |
| Yeni nesne mi | `isNew($Obj)` |
| Senkronize mi (offline) | `isSynced($Obj)` |
| Senkronizasyon sürüyor mu | `isSyncing()` |

---

## 5. If İfadeleri

```
if <koşul> then <değer1> else <değer2>
```

- `else` **zorunludur**.
- İki dal aynı tipte olmalı.
- İç içe kullanılabilir:

```
if $Pkg/Weight < 1.00 then 0.00
else if $Pkg/Weight < 5.00 then 5.00
else 10.00
```

---

## 6. Matematik Fonksiyonları

| Fonksiyon | İmza | Dönüş | Örnek → Sonuç |
|---|---|---|---|
| `max` | `max(a, b, ...)` | En hassas tip | `max(5, 1, 6.7)` → `6.7` |
| `min` | `min(a, b, ...)` | En hassas tip | `min(5, 1, 6.7)` → `1` |
| `round` | `round(sayı[, hassasiyet])` | 0 → Integer, diğer → Decimal | `round(3.5)` → `4` |
| `random` | `random()` | Decimal [0,1) | `0.3` |
| `floor` | `floor(sayı)` | Integer | `floor(-1.2)` → `-2` |
| `ceil` | `ceil(sayı)` | Integer | `ceil(-1.9)` → `-1` |
| `pow` | `pow(taban, üs)` | Decimal | `pow(2, 3)` → `8` |
| `abs` | `abs(sayı)` | Girdi tipi | `abs(-5)` → `5` |
| `sqrt` | `sqrt(sayı)` | Decimal | `sqrt(9)` → `3` |

**Notlar:**
- `max`/`min` tarihlerle de çalışır (tüm argümanlar Date and time olmalı).
- `round` davranışı App Settings → *Round numbers* ayarına bağlıdır (commercial / bankers).
- `sqrt` negatif girdi ile hata verir.
- sin/cos/factorial yok → Marketplace "Math" modülü.

---

## 7. String Fonksiyonları

> Tüm string fonksiyonları yeni değer döndürür. Orijinal string değişmez.
> Pozisyonlar **0'dan** başlar.

| Fonksiyon | İmza | Dönüş | Örnek → Sonuç |
|---|---|---|---|
| `toLowerCase` | `(s)` | String | `'ABc'` → `'abc'` |
| `toUpperCase` | `(s)` | String | `'abC'` → `'ABC'` |
| `substring` | `(s, başlangıç[, uzunluk])` | String | `substring('thisismystring', 6, 2)` → `'my'` |
| `find` | `(s, aranan[, başlangıç])` | Integer, yoksa `-1` | `find('thisismystring','my')` → `6` |
| `findLast` | `(s, aranan[, son_poz])` | Integer, yoksa `-1` | `findLast('thisismystring','t')` → `9` |
| `contains` | `(s, aranan)` | Boolean | Büyük/küçük harf duyarlı |
| `startsWith` | `(s, önek)` | Boolean | |
| `endsWith` | `(s, sonek)` | Boolean | |
| `trim` | `(s)` | String | Baş/son boşluk siler; boş → `''` |
| `isMatch` | `(s, regex)` | Boolean | Regex **tüm stringe** uyar (^…$ örtük) |
| `replaceAll` | `(s, regex, yeni)` | String | Backreference yok |
| `replaceFirst` | `(s, regex, yeni)` | String | |
| `+` | `a + b` | String | `4.73 + ' km'` → `'4.73 km'` |
| `urlEncode` | `(s)` | String | `'Hello, world!'` → `'Hello%2C+world%21'` |
| `urlDecode` | `(s)` | String | Tersi |

**Uyarılar:**
- `substring`: başlangıç string sonundan sonraysa veya uzunluk taşarsa **hata**. Güvenli kullanım:
  ```
  substring($S, 0, min(length($S), 20))
  ```
- `contains(x, '')` → `true` döner.
- `isMatch('234hello', '[0-9]+')` → `false` (tüm string eşleşmeli). Alt string için `'.*[0-9].*'` kullanın.
- Regex: microflow'da **Java**, client/nanoflow'da **JavaScript** regex motoru.
- Literal arama için regex'i `\Q...\E` ile sarın: `'\QPaul S. Mueller\E'`.

---

## 8. Tarih Oluşturma

```
dateTime(yıl[, ay[, gün[, saat[, dakika[, saniye]]]]])
dateTimeUTC(...)  // aynı, UTC takvimi
```

| Parametre | Aralık |
|---|---|
| yıl | 4 haneli, > 1799 |
| ay | 1–12 |
| gün | 1–31 |
| saat | 0–23 |
| dakika | 0–59 |
| saniye | 0–59 |

> ⚠️ **ÇOK ÖNEMLİ:** `dateTime` **değişken veya attribute kabul etmez**, sadece sabit sayı alır.
> `dateTime(2025, 1, 1)` ✅  — `dateTime($Yil, 1, 1)` ❌
> Değişkenden tarih üretmek için `parseDateTime` veya `trimTo...` / `beginOf...` kullanın.

- `dateTimeUTC`'yi client tarafında "Localize = kapalı" attribute'lara atamayın (çift saat dilimi dönüşümü olur).

---

## 9. Begin-of / End-of Tarih

| Fonksiyon | Anlam |
|---|---|
| `beginOfDay(t)` / `endOfDay(t)` | Günün başı / sonu |
| `beginOfWeek(t)` / `endOfWeek(t)` | Haftanın başı / sonu |
| `beginOfMonth(t)` / `endOfMonth(t)` | Ayın başı / sonu |
| `beginOfYear(t)` / `endOfYear(t)` | Yılın başı / sonu |

> Çoğu sürümde ikinci opsiyonel parametre UTC kullanımını belirler. Sürümünüzün dokümanını kontrol edin.

---

## 10. Between (Arasındaki Fark)

Sonuç her zaman **mutlak** (≥ 0) değerdir.

| Fonksiyon | Dönüş | Örnek → Sonuç |
|---|---|---|
| `millisecondsBetween(a, b)` | Decimal | 2 sn fark → `2000` |
| `secondsBetween(a, b)` | Decimal | |
| `minutesBetween(a, b)` | Decimal | |
| `hoursBetween(a, b)` | Decimal | 2.5 saat → `2.5` |
| `daysBetween(a, b)` | Decimal | Saati hesaba katar (6 saat → `0.25`) |
| `weeksBetween(a, b)` | Decimal | 8 gün → `1.142857…` |
| `calendarMonthsBetween(a, b)` | Integer/Long | Saati yok sayar |
| `calendarYearsBetween(a, b)` | Integer/Long | Saati yok sayar |

---

## 11. Add / Subtract Tarih

```
addX(tarih, miktar)        subtractX(tarih, miktar)
```

| Birim | Add | Subtract | UTC varyantı |
|---|---|---|---|
| Milisaniye | `addMilliseconds` | `subtractMilliseconds` | — |
| Saniye | `addSeconds` | `subtractSeconds` | — |
| Dakika | `addMinutes` | `subtractMinutes` | — |
| Saat | `addHours` | `subtractHours` | — |
| Gün | `addDays` | `subtractDays` | `addDaysUTC` / `subtractDaysUTC` |
| Hafta | `addWeeks` | `subtractWeeks` | `addWeeksUTC` / `subtractWeeksUTC` |
| Ay | `addMonths` | `subtractMonths` | `addMonthsUTC` / `subtractMonthsUTC` |
| Çeyrek | `addQuarters` | `subtractQuarters` | `addQuartersUTC` / `subtractQuartersUTC` |
| Yıl | `addYears` | `subtractYears` | `addYearsUTC` / `subtractYearsUTC` |

Örnek: `addMonths($Tarih, 1)`

---

## 12. Trim to Date

Tarihin alt birimlerini sıfırlar. **Değişken kabul eder.**

| Fonksiyon | Sonuç | UTC |
|---|---|---|
| `trimToSeconds(t)` | Milisaniye = 0 | — |
| `trimToMinutes(t)` | Saniye = 0 | — |
| `trimToHours(t)` | Dakika = 0 | `trimToHoursUTC` |
| `trimToDays(t)` | Saat 00:00 | `trimToDaysUTC` |
| `trimToMonths(t)` | Ayın 1'i, 00:00 | `trimToMonthsUTC` |
| `trimToYears(t)` | 1 Ocak, 00:00 | `trimToYearsUTC` |

---

## 13. toString, length, parseInteger

| Fonksiyon | İmza | Not |
|---|---|---|
| `toString(x)` | Herhangi tip → String | Sayı, tarih, boolean, enum |
| `length(s)` | String → Integer | Karakter sayısı |
| `parseInteger(s[, varsayılan])` | String → Integer/Long | Parse edilemezse varsayılan; yoksa hata |

---

## 14. Decimal Parse/Format

### parseDecimal
| Ortam | İmza |
|---|---|
| Microflow | `parseDecimal(s, format[, varsayılan])` |
| Nanoflow | `parseDecimal(s[, varsayılan])` |

| Girdi | Sonuç |
|---|---|
| `parseDecimal('3.45')` | `3.45` |
| `parseDecimal('abc', 5.05)` | `5.05` |
| `parseDecimal('abc', empty)` | `empty` |
| `parseDecimal($BosString)` | **hata** |
| `parseDecimal($BosString, 0)` | `0` ✅ güvenli |
| `parseDecimal('3,241.98', '#,###.##')` | `3241.98` (sadece microflow) |

### formatDecimal
| Ortam | İmza |
|---|---|
| Microflow | `formatDecimal(d, format[, locale])` |
| Nanoflow | `formatDecimal(d)` (kullanıcı locale'i) |

Örnek: `formatDecimal(1234.56, '#,###.#')` → `'1,234.5'` veya `'1.234,5'` (dile göre).
Format kuralları: Java `DecimalFormat`.

---

## 15. Tarih Parse/Format

### Fonksiyonlar

| Fonksiyon | İmza | Dönüş |
|---|---|---|
| `parseDateTime[UTC]` | `(s, format[, varsayılan])` | Date and time |
| `formatDateTime[UTC]` | `(t[, format])` | String |
| `formatDate[UTC]` | `(t)` | Tarih kısmı, locale formatı |
| `formatTime[UTC]` | `(t)` | Saat kısmı, locale formatı |
| `dateTimeToEpoch` | `(t)` | Long (ms, 1970'den beri) |
| `epochToDateTime` | `(long)` | Date and time |

### Pattern harfleri

| Harf | Anlam | Örnek |
|---|---|---|
| `yyyy` / `yy` | Takvim yılı | `2025` / `25` |
| `YYYY` | **ISO hafta yılı** ⚠️ | 31.12.2024 → `2025` |
| `MM` / `M` | Ay (sayı) | `01` / `1` |
| `MMM` / `MMMM` | Ay adı | `Kas` / `Kasım` |
| `LLL` / `LLLL` | Ay adı (bağımsız) | |
| `dd` / `d` | Ayın günü | `07` / `7` |
| `D` | Yılın günü | `133` |
| `E` / `EEEE` | Gün adı | `Sal` / `Salı` |
| `u` | Haftanın günü (1=Pzt) | `5` |
| `w` / `W` | Yılın / ayın haftası | |
| `HH` | Saat 0–23 | |
| `hh` | Saat 1–12 | |
| `k` / `K` | Saat 1–24 / 0–11 | |
| `mm` | Dakika | |
| `ss` | Saniye | |
| `SSS` | Milisaniye | |
| `a` | AM/PM | |
| `G` | Çağ | `AD` |
| `z` `Z` `X` | Saat dilimi (**sadece microflow**) | |

**Notlar:**
- Literal metin tek tırnak çiftiyle kaçılır: `'yyyy-MM-dd''T''HH:mm:ss'`.
- `parseDateTime` geçersiz ama "tarih benzeri" değeri taşırır: `'35-11-2015'` → 5 Aralık 2015.
- `yy` yüzyıl tahmini: microflow 80/20, nanoflow 50/50 kuralı.
- ⚠️ `YYYY` ile `yyyy`'yi karıştırmayın. Yıl sonunda yanlış yıl üretir.

---

## 16. Enumeration Fonksiyonları

| Fonksiyon | Dönüş |
|---|---|
| `getCaption($Obj/EnumAttr)` | Mevcut dildeki görünen ad |
| `getKey($Obj/EnumAttr)` | Teknik ad (key) |

Karşılaştırma: `$Obj/Status = Modul.StatusEnum.Approved`

---

## 17. Mendix'te OLMAYAN Fonksiyonlar

Bu fonksiyonlar diğer dillerde var ama Mendix expression'da **yok**. Syntax hatası verir.

| Yanlış (yok) | Doğru Mendix karşılığı |
|---|---|
| `year($T)` | `parseInteger(formatDateTime($T, 'yyyy'))` |
| `month($T)` | `parseInteger(formatDateTime($T, 'MM'))` |
| `day($T)` | `parseInteger(formatDateTime($T, 'dd'))` |
| `now()` | `[%CurrentDateTime%]` |
| `dateTime($Yil, $Ay, 1)` | `trimToMonths($T)` veya `parseDateTime(...)` |
| `isEmpty($x)` | `$x = empty` |
| `concat(a, b)` | `a + b` |
| `if ... then ...` (else'siz) | `else` ekleyin |
| `"çift tırnak"` | `'tek tırnak'` |
| `&&`, `\|\|`, `!` | `and`, `or`, `not()` |
| `==` | `=` |
| `x / y` | `x div y` veya `x : y` |

> XPath'te `year-from-dateTime()` gibi fonksiyonlar vardır. Bunlar **sadece XPath** içinde çalışır, expression'da çalışmaz.

---

## 18. Sık Hatalar ve Çözümler

| # | Hata | Kök neden | Risk | Çözüm |
|---|---|---|---|---|
| 1 | Unknown function `year` | Fonksiyon yok | 9/10 | Bölüm 17 tablosu |
| 2 | `dateTime` değişken kabul etmiyor | Sadece sabit alır | 9/10 | `trimToMonths` / `parseDateTime` |
| 3 | Null pointer / empty access | Boş nesne attribute | 8/10 | Önce `$X = empty or ...` |
| 4 | Tip uyumsuzluğu `if` dallarında | Dallar farklı tipte | 7/10 | İki dalı aynı tipe getirin |
| 5 | `substring` index out of range | Uzunluk aşımı | 7/10 | `min(length($S), n)` ile sınırlayın |
| 6 | `parseDecimal` boş string hatası | Varsayılan yok | 7/10 | İkinci parametre olarak `0` verin |
| 7 | Yıl sonunda yanlış yıl | `YYYY` kullanımı | 6/10 | `yyyy` kullanın |
| 8 | 3 saat kayma | UTC fonksiyonu + Localize | 6/10 | Client'ta UTC varyantı kullanmayın |
| 9 | `isMatch` beklenmedik `false` | Örtük `^…$` | 5/10 | `'.*desen.*'` kullanın |
| 10 | Regex farklı davranıyor | Java vs JS motoru | 4/10 | İki ortamda da test edin |

---

## 19. Hazır Tarif Kartları

```
// Ayın ilk günü (00:00)
trimToMonths($Tarih)

// Sonraki ayın ilk günü
addMonths(trimToMonths($Tarih), 1)

// Ayın son günü
endOfMonth($Tarih)

// Boş güvenli ayın ilk günü
if $Tarih = empty then empty else trimToMonths($Tarih)

// Tarihi Türkçe formatta göster
formatDateTime($Tarih, 'dd.MM.yyyy')

// Tarih + saat
formatDateTime($Tarih, 'dd.MM.yyyy HH:mm')

// ISO 8601
formatDateTime($Tarih, 'yyyy-MM-dd''T''HH:mm:ss')

// Yıl / ay sayısı
parseInteger(formatDateTime($Tarih, 'yyyy'))
parseInteger(formatDateTime($Tarih, 'MM'))

// Bugün mü?
trimToDays($Tarih) = trimToDays([%CurrentDateTime%])

// Yaş hesabı
calendarYearsBetween($DogumTarihi, [%CurrentDateTime%])

// Kaç gün kaldı (tam sayı)
floor(daysBetween([%CurrentDateTime%], $BitisTarihi))

// Güvenli string kısaltma
if length($Metin) > 50 then substring($Metin, 0, 50) + '…' else $Metin

// Boş string kontrolü
$Metin = empty or trim($Metin) = ''

// Mesaj içinde tarih
'Sonraki ayın ilk günü: ' + formatDateTime(addMonths(trimToMonths($Tarih), 1), 'dd.MM.yyyy')

// Enum caption
getCaption($Obj/Status)
```

---

*Lisans: Mendix dokümantasyonu CC BY 4.0. Bu özet aynı lisansla paylaşılabilir; kaynak gösterin.*
