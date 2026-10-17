# Mendix XPath — Tam Başvuru Kılavuzu (Studio Pro 10/11)

> Kaynak: <https://docs.mendix.com/refguide/xpath/> ve alt sayfaları.
> Mendix dokümantasyonu **CC BY 4.0** lisansı ile yayınlanır. © Siemens Industry Software Netherlands B.V.
> Bu dosya o dokümantasyonun Türkçe açıklamalı, yeniden düzenlenmiş bir özetidir.

---

## İçindekiler

1. [XPath Nedir, Nerede Kullanılır](#1-xpath-nedir-nerede-kullanılır)
2. [Studio Pro vs Java Sözdizimi](#2-studio-pro-vs-java-sözdizimi)
3. [Constraint (Kısıt) Kuralları](#3-constraint-kısıt-kuralları)
4. [Operatörler](#4-operatörler)
5. [Keyword'ler: NULL / empty](#5-keywordler-null--empty)
6. [Sistem Değişkenleri (Token'lar)](#6-sistem-değişkenleri-tokenlar)
7. [Constraint Fonksiyonları](#7-constraint-fonksiyonları)
8. [Association ile Sorgu](#8-association-ile-sorgu)
9. [Aggregate Fonksiyonlar (Java)](#9-aggregate-fonksiyonlar-java)
10. [XPath vs Expression Farkları](#10-xpath-vs-expression-farkları)
11. [Performans Kuralları](#11-performans-kuralları)
12. [Sık Hatalar ve Çözümler](#12-sık-hatalar-ve-çözümler)
13. [Hazır Tarif Kartları](#13-hazır-tarif-kartları)

---

## 1. XPath Nedir, Nerede Kullanılır

XPath, Mendix'te **veritabanından veri filtrelemek** için kullanılan sorgu dilidir. Runtime, XPath'i SQL'e çevirir.

| Kullanım yeri | Örnek |
|---|---|
| Microflow → **Retrieve object(s)** (From Database) | `[Status = 'Active']` |
| Widget **Data source** → Database | Data Grid, List View, Data View |
| **Access rule** (entity güvenliği) | `[System.owner = '[%CurrentUser%]']` |
| Reference selector **constraint** | Seçenekleri daraltma |
| Java: `Core.createXPathQuery(...)` | Tam sorgu |

---

## 2. Studio Pro vs Java Sözdizimi

| Ortam | Yazım | Örnek |
|---|---|---|
| **Studio Pro** | Sadece köşeli parantez içindeki constraint. Entity bağlamdan gelir. | `[Name = 'Jansen']` |
| **Java** | `//Modül.Entity` + constraint | `//Sales.Customer[Name = 'Jansen']` |

Java örneği:

```java
List<IMendixObject> sonuc = Core
    .createXPathQuery("//Sales.Customer[Name='Jansen']")
    .execute(context);
```

### Visual Builder (Studio Pro 10.x+)

Retrieve / Data source ekranında **Builder** ile görsel constraint kurulabilir.

| Builder destekler | Builder desteklemez |
|---|---|
| is, is not, contains, does not contain, starts with, ends with | Tüm fonksiyonlar |
| And / Or grupları | `id` attribute'u |
| Değişken seçimi | İç içe constraint: `[Assoc/Entity[City = 'X' or City = 'Y']]` |
| | Değişkenle **başlayan** ifade: `[$Var = Assoc]` (ters yazın: `[Assoc = $Var]`) |

Desteklenmeyen bir şey yazarsanız XPath editörüne geçin.

---

## 3. Constraint (Kısıt) Kuralları

### Basit
```
[Name = 'Jansen']
```

### VE (iki yol — aynı sonuç)
```
[Name = 'Jansen'][Sales.Customer_Address/Sales.Address/City = 'Rotterdam']
[Name = 'Jansen' and Sales.Customer_Address/Sales.Address/City = 'Rotterdam']
```

> `id` ile sorgularken ek kısıtı **ayrı köşeli parantez** ile ekleyin:
> `[id = $Obj][Status = 'Active']`

### VEYA
```
[Name = 'Jansen' or Name = 'Smit']
```

### Öncelik (parantez)
```
[(Name = 'Jansen' or Name = 'Smit') and Sales.Customer_Address/Sales.Address/City = 'Rotterdam']
```

### Alt kısıt (sub-constraint)
Alt kısıt yolun **içine** yazılır. Sadece o adımı filtreler.

```
// Rotterdam VEYA Losdun'da yaşayan müşteriler
[Sales.Customer_Address/Sales.Address[City = 'Rotterdam' or City = 'Losdun']]

// Administrator rolüne sahip kullanıcılar
[System.UserRoles/System.UserRole[id = '[%UserRole_Administrator%]']]

// New Amsterdam (Guyana) — ara adımda filtre, sonra devam
[Sales.Customer_Address/Sales.Address[City = 'New Amsterdam']/Sales.Address_Country/Sales.Country/Name = 'Guyana']
```

> ⚠️ Köşeli parantezleri dikkatli sayın. Alt kısıt, ana kısıtın **tamamen içinde** olmalıdır.

---

## 4. Operatörler

### Karşılaştırma ve mantık

| Op | Anlam | Örnek |
|---|---|---|
| `=` | Eşit | `Price = 9.80` |
| `!=` | Eşit değil | `Price != 9.80` |
| `<` `<=` `>` `>=` | Küçük/büyük | `Price >= 9.80` |
| `and` | VE | `Price = 9.80 and Amount = 1` |
| `or` | VEYA | `Price = 9.80 or Price = 9.70` |

### Matematiksel

| Op | Örnek | Sonuç |
|---|---|---|
| `+` | `6 + 4` | 10 |
| `-` | `6 - 4` | 2 |
| `*` | `6 * 4` | 24 |
| `div` | `8 div 4` | 2 |

**Kısıtlar:**
- Matematiksel operatörler **sadece modelde tanımlı** XPath'lerde çalışır (Retrieve, access rule).
- **Client'tan gelen** sorgularda (widget data source) **kullanılamaz**.
- Java'da varsayılan kapalıdır: `.allowMathOperators(true)` ile açın.

> Davranış veritabanına göre değişebilir. Örnek: HSQLDB `=` ile sondaki boşlukları yok sayar, PostgreSQL saymaz.

---

## 5. Keyword'ler: NULL / empty

Attribute'un boş olup olmadığını kontrol eder. İkisi aynıdır.

```
[Name = NULL]
[Name = empty]
[Name != empty]
```

> ⚠️ `NULL`/`empty` **sadece attribute** için çalışır. Association varlığı için `not()` kullanın (Bölüm 8).

---

## 6. Sistem Değişkenleri (Token'lar)

Token'lar **tırnak içinde** yazılır: `'[%CurrentDateTime%]'`

### Nesne / kullanıcı

| Token | Anlam |
|---|---|
| `[%CurrentUser%]` | Oturumdaki kullanıcının GUID'i |
| `[%CurrentObject%]` | Bağlamdaki aktif nesnenin GUID'i |
| `[%UserRole_<RolAdı>%]` | Her user role için otomatik üretilir. Örnek: `[%UserRole_Administrator%]` |

### Zaman — anlık noktalar

| Token | Anlam |
|---|---|
| `[%CurrentDateTime%]` | Şu an |
| `[%BeginOfCurrentMinute%]` / `[%EndOfCurrentMinute%]` | Dakikanın başı / sonu |
| `[%BeginOfCurrentHour%]` / `[%EndOfCurrentHour%]` | Saatin başı / sonu |
| `[%BeginOfCurrentDay%]` / `[%EndOfCurrentDay%]` | Bugünün başı / sonu |
| `[%BeginOfYesterday%]` / `[%EndOfYesterday%]` | Dünün başı / sonu |
| `[%BeginOfTomorrow%]` / `[%EndOfTomorrow%]` | Yarının başı / sonu |
| `[%BeginOfCurrentWeek%]` / `[%EndOfCurrentWeek%]` | Haftanın başı / sonu |
| `[%BeginOfCurrentMonth%]` / `[%EndOfCurrentMonth%]` | Ayın başı / sonu |
| `[%BeginOfCurrentYear%]` / `[%EndOfCurrentYear%]` | Yılın başı / sonu |

Her biri için **UTC varyantı** da vardır: `[%BeginOfCurrentDayUTC%]` vb.

> ⚠️ UTC token'ları client tarafında "Localize = kapalı" attribute ile kullanmayın. Saat dilimi dönüşümü iki kez yapılır.

### Zaman — süreler (ekleme / çıkarma)

| Token | Süre |
|---|---|
| `[%SecondLength%]` | 1 saniye |
| `[%MinuteLength%]` | 1 dakika |
| `[%HourLength%]` | 1 saat |
| `[%DayLength%]` | 1 gün (24 saat) |
| `[%WeekLength%]` | 1 hafta |
| `[%MonthLength%]` | 1 ay |
| `[%YearLength%]` | 1 yıl |

**Kural:** Zaman token'ı ile süre token'ı **tek bir string** içinde birleştirilir:

```
[DateRegistered > '[%BeginOfCurrentDay%] - 3 * [%YearLength%]']
```

> Token'lar string içinde olduğu için **parantez ile gruplama yapılamaz**.

---

## 7. Constraint Fonksiyonları

### Boolean

| Fonksiyon | Anlam | Örnek |
|---|---|---|
| `true()` | Doğru | `[IsActive = true()]` |
| `false()` | Yanlış | `[IsActive = false()]` |
| `not(...)` | Olumsuzlama | `[not(contains(Name, 'test'))]` |

### String

| Fonksiyon | Anlam | Örnek |
|---|---|---|
| `contains(attr, 'x')` | İçerir | `[contains(Name, 'an')]` |
| `starts-with(attr, 'x')` | İle başlar | `[starts-with(Name, 'Jan')]` |
| `ends-with(attr, 'x')` | İle biter | `[ends-with(Email, '@firma.com')]` |
| `string-length(attr)` | Karakter sayısı | `[string-length(Code) = 5]` |
| `length(attr)` | Uzunluk | `[length(Name) > 3]` |

> Büyük/küçük harf duyarlılığı **veritabanına** bağlıdır.

### Tarih bileşenleri

Hepsi tamsayı döndürür. Çoğu sürümde opsiyonel ikinci parametre saat dilimi alır.

| Fonksiyon | Döndürür |
|---|---|
| `year-from-dateTime(attr)` | Yıl |
| `month-from-dateTime(attr)` | Ay (1–12) |
| `day-from-dateTime(attr)` | Ayın günü |
| `hours-from-dateTime(attr)` | Saat |
| `minutes-from-dateTime(attr)` | Dakika |
| `seconds-from-dateTime(attr)` | Saniye |
| `quarter-from-dateTime(attr)` | Çeyrek (1–4) |
| `day-of-year-from-dateTime(attr)` | Yılın günü |
| `week-from-dateTime(attr)` | Yılın haftası |
| `weekday-from-dateTime(attr)` | Haftanın günü (numaralandırmayı sürümünüzde doğrulayın) |

Örnek:
```
[year-from-dateTime(HireDate) = 2025]
[month-from-dateTime(BirthDate) = 10]
```

> ⚠️ Bu fonksiyonlar **sadece XPath** içinde çalışır. Microflow expression'da yoktur.
> Expression karşılığı: `parseInteger(formatDateTime($T, 'yyyy'))`.

---

## 8. Association ile Sorgu

| Amaç | XPath |
|---|---|
| Association üzerinden attribute | `[Sales.Customer_Address/Sales.Address/City = 'Rotterdam']` |
| Belirli nesneye bağlı olanlar | `[Sales.Order_Customer = $Customer]` |
| **Herhangi** bir bağlantısı olanlar | `[Sales.Customer_Order/Sales.Order]` |
| **Hiç** bağlantısı olmayanlar | `[not(Sales.Customer_Order/Sales.Order)]` |
| Kullanıcıya ait kayıtlar | `[System.owner = '[%CurrentUser%]']` |
| Kullanıcının rolü | `[System.UserRoles = '[%UserRole_Administrator%]']` |
| Kendi kendine referans | `[Module.Employee_Manager = $Manager]` |

> Association yönü önemlidir. Owner tarafından ve karşı taraftan yazım farklı olabilir. Studio Pro otomatik tamamlamayı kullanın.

---

## 9. Aggregate Fonksiyonlar (Java)

> **Sadece Java kodunda** kullanılır. Argüman tam XPath sorgusudur.
> `avg/max/min/sum` sayısal bir attribute ile bitmelidir.

| Fonksiyon | Örnek |
|---|---|
| `count` | `count(//Sales.Order)` |
| `sum` | `sum(//Sales.Order/TotalPrice)` |
| `avg` | `avg(//Sales.Order/TotalPrice)` |
| `max` | `max(//Sales.Order/TotalPrice)` |
| `min` | `min(//Sales.Order[Sales.Customer_Order/Sales.Customer/Name = 'Jansen']/TotalPrice)` |

Microflow'da aynı iş için: **Retrieve** + **Aggregate list** aktivitesi kullanın.

---

## 10. XPath vs Expression Farkları

| Konu | XPath | Microflow Expression |
|---|---|---|
| Amaç | DB filtreleme | Değer hesaplama |
| Sarmalama | `[ ... ]` | Yok |
| Attribute erişimi | Doğrudan: `Name` | `$Obj/Name` |
| Boş kontrolü | `= NULL` / `= empty` | `= empty` |
| Boolean | `true()` / `false()` | `true` / `false` |
| Değil | `not(...)` | `not(...)` |
| Şu an | `'[%CurrentDateTime%]'` | `[%CurrentDateTime%]` |
| Yıl | `year-from-dateTime(Attr)` | `parseInteger(formatDateTime($T,'yyyy'))` |
| String arama | `contains(Attr, 'x')` | `contains($S, 'x')` |
| Başlar | `starts-with(...)` (tireli) | `startsWith(...)` (camelCase) |
| Biter | `ends-with(...)` | `endsWith(...)` |
| Uzunluk | `string-length(Attr)` | `length($S)` |
| if/then/else | **Yok** | Var |

---

## 11. Performans Kuralları

| # | Kural | Neden |
|---|---|---|
| 1 | Aynı yolu bir constraint'te **tekrar yazmayın** | Ayrı JOIN'ler üretir, sorgu yavaşlar |
| 2 | Tekrar yerine **alt kısıt** kullanın | `[Assoc/Entity[City='A' or City='B']]` |
| 3 | Sık filtrelenen attribute'lara **index** ekleyin | Domain Model → Indexes |
| 4 | `contains` yerine mümkünse `starts-with` | Index kullanabilir |
| 5 | `not(...)` ve uzun association zincirleri pahalıdır | Gerekirse denormalize edin |
| 6 | Tarih fonksiyonu yerine token aralığı kullanın | `year-from-dateTime` index'i bozabilir |

Kötü / iyi örnek:
```
// KÖTÜ — aynı yol iki kez
[Sales.Customer_Address/Sales.Address/City = 'Rotterdam' or Sales.Customer_Address/Sales.Address/City = 'Losdun']

// İYİ — alt kısıt
[Sales.Customer_Address/Sales.Address[City = 'Rotterdam' or City = 'Losdun']]
```

---

## 12. Sık Hatalar ve Çözümler

| # | Hata | Kök neden | Risk | Çözüm |
|---|---|---|---|---|
| 1 | Token çalışmıyor | Tırnak eksik | 9/10 | `'[%CurrentDateTime%]'` |
| 2 | Association boş kontrolü çalışmıyor | `= empty` attribute içindir | 8/10 | `[not(Assoc/Entity)]` |
| 3 | `startsWith` bilinmiyor | Expression adı kullanılmış | 8/10 | XPath'te `starts-with` |
| 4 | Widget'ta `+`/`div` hata | Client sorgusunda matematik yasak | 7/10 | Microflow data source kullanın |
| 5 | Builder XPath'i açmıyor | Desteklenmeyen yapı | 5/10 | XPath editörüne geçin |
| 6 | Token içinde parantez hatası | String içinde gruplama yok | 6/10 | İfadeyi sadeleştirin |
| 7 | Yavaş sorgu | Tekrarlanan yol / index yok | 7/10 | Bölüm 11 |
| 8 | Saat kayması | UTC token + Localize | 6/10 | UTC'siz token kullanın |
| 9 | `id` ile çoklu kısıt hatası | Aynı parantezde birleştirilmiş | 5/10 | `[id = $X][Diğer]` |
| 10 | DB'ler arası farklı sonuç | Boşluk/harf duyarlılığı | 4/10 | Hedef DB'de test edin |

---

## 13. Hazır Tarif Kartları

```
// Bugün oluşturulanlar
[createdDate >= '[%BeginOfCurrentDay%]' and createdDate <= '[%EndOfCurrentDay%]']

// Bu hafta kaydolanlar
[DateRegistered >= '[%BeginOfCurrentWeek%]' and DateRegistered < '[%EndOfCurrentWeek%]']

// Bu ay
[Tarih >= '[%BeginOfCurrentMonth%]' and Tarih <= '[%EndOfCurrentMonth%]']

// Son 30 gün
[Tarih >= '[%BeginOfCurrentDay%] - 30 * [%DayLength%]']

// Son 3 yıl
[DateRegistered > '[%BeginOfCurrentDay%] - 3 * [%YearLength%]']

// Gelecek 7 gün içinde biten
[BitisTarihi >= '[%CurrentDateTime%]' and BitisTarihi <= '[%CurrentDateTime%] + 7 * [%DayLength%]']

// Mevcut kullanıcının kayıtları
[System.owner = '[%CurrentUser%]']

// Admin kullanıcılar
[System.UserRoles = '[%UserRole_Administrator%]']

// Boş olmayan e-posta
[Email != empty]

// Microflow değişkenine göre filtre
[Module.Order_Customer = $Customer]
[Status = $FilterStatus]

// Enum filtresi (key değeri ile)
[Status = 'Approved']

// Bağlı siparişi olmayan müşteriler
[not(Sales.Customer_Order/Sales.Order)]

// Belirli şehirlerden biri
[Sales.Customer_Address/Sales.Address[City = 'Ankara' or City = 'İstanbul']]

// Belirli yılda işe girenler
[year-from-dateTime(HireDate) = 2025]

// Aktif ve adı 'A' ile başlayan
[IsActive = true()][starts-with(Name, 'A')]
```

---

*Lisans: Mendix dokümantasyonu CC BY 4.0. Bu özet aynı lisansla paylaşılabilir; kaynak gösterin.*
