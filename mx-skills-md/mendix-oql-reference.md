# Mendix OQL — Tam Başvuru Kılavuzu (Studio Pro 10/11)

> Kaynak: <https://docs.mendix.com/refguide/oql/> ve alt sayfaları.
> Mendix dokümantasyonu **CC BY 4.0** lisansı ile yayınlanır. © Siemens Industry Software Netherlands B.V.
> Bu dosya o dokümantasyonun Türkçe açıklamalı, yeniden düzenlenmiş bir özetidir.

> ⚠️ **Sürüm uyarısı:** Bazı fonksiyonlar sadece **Mendix 11.x** ile geldi ve çoğu **sadece Java action** içinde çalışır.
> Her fonksiyonun yanında 🔵 **11.x** işareti var. Studio Pro **10.24** kullanıyorsanız bu fonksiyonları kullanmayın.

---

## İçindekiler

1. [OQL Nedir, Nerede Kullanılır](#1-oql-nedir-nerede-kullanılır)
2. [Clause Sırası](#2-clause-sırası)
3. [SELECT](#3-select)
4. [FROM ve JOIN](#4-from-ve-join)
5. [WHERE](#5-where)
6. [GROUP BY ve HAVING](#6-group-by-ve-having)
7. [ORDER BY, LIMIT, OFFSET](#7-order-by-limit-offset)
8. [UNION](#8-union)
9. [Subquery (Alt Sorgu)](#9-subquery-alt-sorgu)
10. [Veri Tipleri ve Literal'ler](#10-veri-tipleri-ve-literaller)
11. [Sistem Değişkenleri, Sabitler, Enum](#11-sistem-değişkenleri-sabitler-enum)
12. [Operatörler](#12-operatörler)
13. [CASE](#13-case)
14. [Fonksiyonlar](#14-fonksiyonlar)
15. [Aggregate Fonksiyonlar](#15-aggregate-fonksiyonlar)
16. [OQL vs XPath vs Expression](#16-oql-vs-xpath-vs-expression)
17. [Veritabanı Farkları](#17-veritabanı-farkları)
18. [Sık Hatalar ve Çözümler](#18-sık-hatalar-ve-çözümler)
19. [Hazır Tarif Kartları](#19-hazır-tarif-kartları)

---

## 1. OQL Nedir, Nerede Kullanılır

OQL (Object Query Language), Mendix'in **SQL benzeri** sorgu dilidir. Tablo yerine **entity**, kolon yerine **attribute** kullanır. Association'lar üzerinden **yol (path)** ile gezilebilir.

| Kullanım yeri | Not |
|---|---|
| **View Entity** | Domain model'de OQL ile tanımlanan sanal entity. Alias zorunludur. |
| **Dataset** | Rapor/grafik veri kaynağı. Parametre ve range parametresi destekler. |
| **Java action** | `Core.retrieveOQLDataTable(...)` vb. 11.x özelliklerinin çoğu sadece burada. |
| **OQL Module** (Marketplace) | Microflow'dan OQL çalıştırmak için. |

---

## 2. Clause Sırası

Zorunlu: `SELECT` ve `FROM`. Diğerleri opsiyonel ama **sıra sabittir**:

```
SELECT ...
FROM ...
WHERE ...
GROUP BY ...
HAVING ...        -- sadece GROUP BY ile
ORDER BY ...
LIMIT n
OFFSET n
```

---

## 3. SELECT

### Sözdizimi
```
SELECT [DISTINCT] { * | Entity/* | alias/* | ifade [[AS] kolon_alias] } [, ...]
```

| Özellik | Örnek | Not |
|---|---|---|
| Belirli attribute | `SELECT FirstName, LastName FROM Sales.Customer` | |
| Alias | `SELECT FirstName AS FName` | `AS` opsiyonel. Alias'ta **boşluk olmaz**. |
| Tüm attribute | `SELECT * FROM Sales.Customer` | Gizli `ID` kolonu da gelir |
| Bir entity'nin tümü | `SELECT Req/* FROM ...` | |
| Tekrarsız | `SELECT DISTINCT LastName FROM Sales.Customer` | NULL ayrı bir değer sayılır |
| Association üzerinden | `SELECT Sales.Request/Sales.Request_Customer/Sales.Customer/LastName AS CustomerName FROM Sales.Request` | Her iki yönden gidilebilir |
| Sistem association | `.../System.owner/System.User/Name` | `owner`/`changedBy` açıksa |

> ⚠️ **Rezerve kelime** olan entity adları (`Order`, `Group`) **çift tırnak** ister: `"Sales.Order"`.
> ⚠️ 1-N / N-N association üzerinden birden fazla kolon seçerseniz **kartezyen çarpım** oluşur. Bunun yerine `JOIN` kullanın.

---

## 4. FROM ve JOIN

### Sözdizimi
```
FROM { entity | (alt_sorgu) } [[AS] alias]
  { INNER | LEFT [OUTER] | RIGHT [OUTER] | FULL [OUTER] } JOIN
     { entity_yolu | entity | (alt_sorgu) } [[AS] alias] [ON koşul]
```

### JOIN türleri

| Tür | Döndürür |
|---|---|
| `JOIN` / `INNER JOIN` | Sadece eşleşen satırlar |
| `LEFT [OUTER] JOIN` | Soldaki tüm satırlar + eşleşenler (yoksa NULL) |
| `RIGHT [OUTER] JOIN` | Sağdaki tüm satırlar + eşleşenler |
| `FULL [OUTER] JOIN` | Her iki taraftaki tüm satırlar |

### İki JOIN yazımı

```sql
-- 1) Association üzerinden (ON opsiyonel) — ÖNERİLEN
SELECT Cust/LastName, Req/Number
FROM Sales.Customer Cust
JOIN Cust/Sales.Request_Customer/Sales.Request Req

-- 2) Koşul ile (ON zorunlu)
SELECT Cust/LastName, Req/Number
FROM Sales.Customer Cust
JOIN Sales.Request Req ON Cust.LastName = Req.CustomerName
```

### Virgülle çoklu FROM
```sql
SELECT * FROM Sales.Customer Cust, Sales.Request Req
WHERE Cust.LastName = Req.CustomerName
```
> WHERE olmadan **kartezyen çarpım** döner.

### Attribute erişimi
`Entity/Attribute` veya `alias/Attribute`. Bazı örneklerde `alias.Attribute` da kullanılır.

---

## 5. WHERE

```sql
SELECT FirstName, LastName FROM Sales.Customer
WHERE LastName = 'Doe'
```

| Kural | Açıklama |
|---|---|
| Öncelik | `AND`, `OR`'dan önce değerlendirilir. Parantez kullanın. |
| Association yolu | `WHERE Sales.Customer/Sales.Request_Customer/Sales.Request/Number = 1` |
| NULL sonucu | WHERE ifadesi NULL dönerse satır **gelmez** (FALSE sayılır) |

---

## 6. GROUP BY ve HAVING

```sql
SELECT Brand, SUM(Stock) AS SumStock, COUNT(*) AS LocationCount
FROM Sales.Location
GROUP BY Brand
HAVING COUNT(*) > 1
```

| Kural | Açıklama |
|---|---|
| SELECT içeriği | Sadece aggregate fonksiyonlar + GROUP BY'daki ifadeler |
| Fonksiyonla grup | `GROUP BY LENGTH(Brand)` → SELECT'te `Brand` tek başına **olamaz** |
| WHERE vs HAVING | WHERE gruplamadan **önce**, HAVING gruplamadan **sonra** |
| HAVING'de alt sorgu | `HAVING EXISTS (...)` / `IN (...)` desteklenir |

> ⚠️ GROUP BY'da **alias** ve **alt sorgu** kullanmayın. Bazı DB'ler destekler, bazıları desteklemez. Taşıma sorunu çıkar.

---

## 7. ORDER BY, LIMIT, OFFSET

```sql
SELECT Brand, City, LocationNumber
FROM Sales.Location
ORDER BY LocationNumber DESC, Brand ASC
LIMIT 3 OFFSET 2
```

| Kural | Açıklama |
|---|---|
| Varsayılan | `ASC` |
| Association yolu | `ORDER BY Sales.Customer/Sales.Request_Customer/Sales.Request/Number` |
| Fonksiyon | ORDER BY içinde **attribute fonksiyonu kullanılamaz** |
| View entity | ORDER BY **sadece LIMIT/OFFSET ile** kullanılabilir |
| OQL v2 alt sorgu | Alt sorguda ORDER BY **sadece LIMIT/OFFSET ile** |
| LIMIT/OFFSET | Her zaman ORDER BY ile birlikte kullanın (sıra yoksa sonuç belirsiz) |
| NULL sırası | DB'ye göre başta veya sonda |

---

## 8. UNION

```sql
SELECT FirstName, LastName FROM Sales.SalesPerson
UNION [ALL]
SELECT FirstName, LastName FROM Sales.Customer
ORDER BY FirstName
LIMIT 4
```

| Kural | Açıklama |
|---|---|
| `UNION` | Tekrarsız satırlar |
| `UNION ALL` | Tüm satırlar |
| Kolon sayısı/sırası | Tüm SELECT'lerde aynı olmalı |
| Kolon adları | İlk SELECT'ten alınır |
| ORDER BY/LIMIT | Varsayılan olarak **tüm sonuca** uygulanır |
| Tip uyumu | INTEGER/LONG/DECIMAL birleşir → en yüksek tip. Limitli + limitsiz STRING birleşir. |
| Parantezli UNION | 🔵 **11.15+**, sadece Java. Her parçaya ayrı ORDER BY/LIMIT. |

> ⚠️ Oracle ve SAP HANA, limitsiz STRING içeren UNION'ı desteklemez.

---

## 9. Subquery (Alt Sorgu)

| Yer | Kural | Örnek |
|---|---|---|
| **SELECT** | Tek satır, tek kolon dönmeli | `(SELECT COUNT(*) FROM Sales.Customer C WHERE C/LastName = Req/CustomerName) AS Cnt` |
| **FROM** | Alias verin | `FROM (SELECT * FROM Sales.Customer) AS Cust` |
| **WHERE değer** | Tek kolon, en fazla 1 satır | `WHERE Stock = (SELECT MAX(Stock) FROM ...)` |
| **WHERE IN** | Tek kolon, çok satır | `WHERE LastName IN (SELECT CustomerName FROM Sales.Request)` |
| **WHERE EXISTS** | Herhangi kolon/satır | `WHERE EXISTS (SELECT * FROM Sales.Request R WHERE R/CustomerName = Cust/LastName)` |
| **HAVING** | WHERE ile aynı kurallar | `HAVING SUM(Stock) <= (SELECT COUNT(*) FROM ...)` |

Alt sorgu dış sorgudaki entity'lere referans verebilir (correlated subquery).

---

## 10. Veri Tipleri ve Literal'ler

| OQL tipi | Mendix tipi | Literal örneği |
|---|---|---|
| `BOOLEAN` | Boolean | `TRUE`, `FALSE` |
| `DATETIME` | Date and time | Doğrudan literal **yok**. ISO string `'2025-07-05 00:00:00'` veya Unix saniye (LONG) |
| `DECIMAL` | Decimal | `5.3` |
| `INTEGER` | Integer/Long | `5` |
| `LONG` | Integer/Long | `5` |
| `STRING` | String | `'metin'` |
| — | — | `NULL` |

**Tip yükseltme önceliği (sayısal):** `DECIMAL` > `LONG` > `INTEGER`

---

## 11. Sistem Değişkenleri, Sabitler, Enum

### Sistem değişkenleri
Format: `'[%Değişken%]'` (tırnak içinde)

| Token | Not |
|---|---|
| `'[%CurrentUser%]'` | Sadece **referans** olarak. Cast edilemez. |
| `'[%UserRole_<Rol>%]'` | Sadece **referans** olarak. |
| `'[%CurrentObject%]'` | ❌ **OQL'de desteklenmez** |
| Tüm zaman token'ları | XPath ile aynı: `[%CurrentDateTime%]`, `[%BeginOfCurrentDay%]`, `[%YearLength%]` vb. |

```sql
SELECT Name FROM Sales.Person WHERE System.owner = '[%CurrentUser%]'

SELECT Name FROM Sales.Person
WHERE System.owner/System.User/System.UserRoles = '[%UserRole_Manager%]'

SELECT '[%BeginOfCurrentDay%] - 3 * [%YearLength%]' AS ThreeYearsAgo FROM Sales.Person
```

### Parametreler
Dataset ve Java'da: `$ParametreAdi`

### Sabitler 🔵 11.13+, sadece Java
```sql
SELECT * FROM Sales.Order WHERE Price >= $Sales.MinOrder
```

### Enumeration 🔵 11.13+, sadece Java
```sql
SELECT * FROM RealEstate.Properties
WHERE PropertyType = RealEstate.PropertyTypes#Apartment
```
> 10.x'te enum değerini **string key** ile karşılaştırın: `PropertyType = 'Apartment'`

---

## 12. Operatörler

### İkili (binary)

| Op | Anlam | Not |
|---|---|---|
| `+` | Toplama / **string birleştirme** | İlk operand STRING ise birleştirir |
| `-` | Çıkarma | |
| `*` | Çarpma | |
| `:` | **Bölme** | ⚠️ `/` değil! INTEGER/LONG bölmede kalan atılır |
| `%` | Mod | DECIMAL ile davranış DB'ye bağlı |
| `=` `!=` | Eşit / değil | NULL ile karşılaştırma → `IS NULL`'a çevrilir |
| `<` `<=` `>` `>=` | Karşılaştırma | |
| `AND` `OR` | Mantık | |

### Tekli (unary)
`-` (negatif), `NOT`

### Özel operatörler

| Op | Sözdizimi | Örnek |
|---|---|---|
| `LIKE` | `ifade LIKE desen` | `WHERE Name LIKE '%ment'` |
| `IN` | `ifade IN (liste \| alt_sorgu \| $param)` | `WHERE City IN ('Ankara', 'İzmir')` |
| `EXISTS` | `EXISTS (alt_sorgu)` | |
| `IS` | `ifade IS [NOT] NULL` | `WHERE Revenue IS NOT NULL` |

**LIKE joker karakterleri:**

| Karakter | Anlam |
|---|---|
| `%` | 0 veya daha fazla karakter |
| `_` | Tam 1 karakter |
| `\` | Kaçış karakteri (`\%`, `\_`, `\\`) |

> LIKE deseninde **fonksiyon kullanılamaz**. Sadece string literal veya parametre.

### Operatör önceliği (yüksekten düşüğe)
1. `*` `:` `%`
2. `-` (negatif) `+` `-`
3. `=` `>` `<` `>=` `<=` `!=` `IS` `IN` `EXISTS` `LIKE`
4. `NOT`
5. `AND`
6. `OR`

### NULL davranışı
Bir operand NULL ise sonuç NULL olur (`=` ve `!=` hariç).

---

## 13. CASE

### Basit
```sql
CASE Number
  WHEN 7 THEN TRUE
  ELSE FALSE
END AS IsLuckyNumber
```

### Genişletilmiş
```sql
CASE
  WHEN Price > 7  THEN 'Priority'
  WHEN Number = 7 THEN 'Lucky'
  ELSE 'Regular'
END AS OrderType
```

- `ELSE` yoksa ve hiçbir koşul tutmazsa → `NULL`.
- Farklı sayısal tipler → tip yükseltme kuralı (OQL v2). OQL v1'de ilk dalın tipi alınır.

---

## 14. Fonksiyonlar

### Tip dönüşümü

| Fonksiyon | Sözdizimi | Not |
|---|---|---|
| `CAST` | `CAST(ifade AS tip)` | Tip: BOOLEAN, DATETIME, DECIMAL[(p[,s])], INTEGER, LONG, STRING |
| `COALESCE` | `COALESCE(a, b, ...)` | İlk NULL olmayan değer |

**CAST destek tablosu (özet):**

| Kaynak → | BOOLEAN | DATETIME | DECIMAL | INTEGER/LONG | STRING |
|---|---|---|---|---|---|
| BOOLEAN | ✔ | ✘ | ✘ | ✘ | ✔* |
| DATETIME | ✘ | ✔ | ✘ | ✘ | ✔* |
| DECIMAL | ✘ | ✘ | ✔ | ✔* | ✔* |
| INTEGER/LONG | ✘ | ✘ | ✔ | ✔ | ✔ |
| STRING | ✘ | ✘ | ✔ | ✔ | ✔ |

`*` = Format/davranış DB'ye göre değişir.
`DECIMAL` varsayılan = `DECIMAL(28, 8)`.

```sql
-- Ondalıklı bölme için
SELECT CAST(Number AS DECIMAL) : 2 AS Half FROM Sales.Order
```

### Tarih

| Fonksiyon | Sözdizimi | Dönüş | Sürüm |
|---|---|---|---|
| `DATEPART` | `DATEPART(parça, tarih [, 'TZ'])` | INTEGER | 10 ✅ |
| `DATEDIFF` | `DATEDIFF(birim, başlangıç, bitiş [, 'TZ'])` | INTEGER | 10 ✅ |
| `DATEADD` | `DATEADD(parça, miktar, tarih [, 'TZ'])` | DATETIME | 🔵 11.9+, Java |
| `DATETRUNC` | `DATETRUNC(parça, tarih [, 'TZ'])` | DATETIME | 🔵 11.9+, Java |
| `DATEFORMAT` | `DATEFORMAT(tarih, 'desen')` | STRING | 🔵 11.12+ |
| `DATEPARSE` | `DATEPARSE(metin, 'desen')` | DATETIME | 🔵 11.10+, Java |

**DATEPART parçaları:**

| Parça | Aralık |
|---|---|
| `YEAR` | Yıl |
| `QUARTER` | 1–4 |
| `MONTH` | 1–12 |
| `DAYOFYEAR` | 1–366 |
| `DAY` | 1–31 |
| `WEEK` | 1–53 (DB'ye bağlı) |
| `WEEKDAY` | 1–7 (**1 = Pazar**, 7 = Cumartesi) |
| `HOUR` | 0–23 |
| `MINUTE` | 0–59 |
| `SECOND` | 0–59 |
| `MILLISECOND` | 0–999 |

**DATEDIFF birimleri:** YEAR, QUARTER, MONTH, DAY, WEEK, HOUR, MINUTE, SECOND, MILLISECOND

**Saat dilimi parametresi:** IANA adı (`'Europe/Istanbul'`, `'UTC'`). GMT offset desteklenmez. Varsayılan = kullanıcı saat dilimi.

> ⚠️ DATEDIFF hesaplaması DB'ye bağlıdır. `2001-12-31` ile `2002-01-01` arası YEAR farkı bazı DB'lerde 1, bazılarında 0.

### String

| Fonksiyon | Sözdizimi | Sürüm |
|---|---|---|
| `LENGTH` | `LENGTH(s)` | 10 ✅ |
| `LOWER` | `LOWER(s)` | 10 ✅ |
| `UPPER` | `UPPER(s)` | 10 ✅ |
| `REPLACE` | `REPLACE(s, aranan, yeni)` | 10 ✅ |
| `LOCATE` | `LOCATE(s, aranan [, atla])` → **1 tabanlı**, yoksa 0 | 🔵 11.9+, Java |
| `SUBSTRING` | `SUBSTRING(s, başlangıç [, uzunluk])` → **1 tabanlı** | 🔵 11.9+, Java |
| `TRIM` | `TRIM(s [, 'karakter'])` | 🔵 11.11+ |
| `LTRIM` / `RTRIM` | `LTRIM(s [, 'k'])` | 🔵 11.11+ |
| `LPAD` / `RPAD` | `LPAD(s, uzunluk [, dolgu])` | 🔵 11.12+ |

> `LOWER(Attr) = 'x'` index kullanamaz → performans düşer.
> `REPLACE` büyük/küçük harf duyarlılığı DB collation'a bağlıdır.

### Sayısal

| Fonksiyon | Sözdizimi | Not |
|---|---|---|
| `ROUND` | `ROUND(sayı, basamak)` | DECIMAL eşitlik karşılaştırması için kullanın |

### Dataset range

| Fonksiyon | Sözdizimi | Not |
|---|---|---|
| `RANGEBEGIN` | `RANGEBEGIN($range)` | Sadece dataset range parametresi |
| `RANGEEND` | `RANGEEND($range)` | Sadece dataset range parametresi |

---

## 15. Aggregate Fonksiyonlar

| Fonksiyon | Anlam |
|---|---|
| `COUNT(*)` / `COUNT(attr)` | Sayım |
| `SUM(attr)` | Toplam |
| `AVG(attr)` | Ortalama |
| `MIN(attr)` / `MAX(attr)` | En küçük / büyük |
| `STRING_AGG(...)` | String birleştirme (sözdizimini sürümünüzde doğrulayın) |

GROUP BY ile veya tüm tablo üzerinde kullanılır.

---

## 16. OQL vs XPath vs Expression

| Konu | OQL | XPath | Expression |
|---|---|---|---|
| Amaç | SQL benzeri sorgu, rapor, view entity | DB filtre | Değer hesaplama |
| Attribute | `Entity/Attr`, `alias/Attr` | `Attr` | `$Obj/Attr` |
| Boş kontrolü | `IS NULL` / `IS NOT NULL` | `= empty` / `= NULL` | `= empty` |
| Değil | `NOT` | `not(...)` | `not(...)` |
| Bölme | `:` | `div` | `div` veya `:` |
| String birleştirme | `+` | — | `+` |
| İçerir | `LIKE '%x%'` | `contains(Attr,'x')` | `contains($s,'x')` |
| Başlar | `LIKE 'x%'` | `starts-with(...)` | `startsWith(...)` |
| Yıl | `DATEPART(YEAR, Attr)` | `year-from-dateTime(Attr)` | `parseInteger(formatDateTime($T,'yyyy'))` |
| Koşul | `CASE WHEN ... END` | Yok | `if ... then ... else` |
| Gruplama | `GROUP BY` | Yok | Aggregate list aktivitesi |
| JOIN | Var | Yol ile | Yok |
| Şu an | `'[%CurrentDateTime%]'` | `'[%CurrentDateTime%]'` | `[%CurrentDateTime%]` |
| Büyük/küçük harf anahtar kelime | `SELECT`, `WHERE` (büyük önerilir) | küçük | küçük |

---

## 17. Veritabanı Farkları

OQL, SQL'e çevrilir. Sonuçlar DB'ye göre değişebilir.

| Konu | Fark |
|---|---|
| `=` ve sondaki boşluk | HSQLDB yok sayar, PostgreSQL saymaz |
| Büyük/küçük harf | DB ve collation'a bağlı |
| GROUP BY alias | HSQLDB, PostgreSQL, MariaDB, MySQL destekler |
| GROUP BY alt sorgu | PostgreSQL, MariaDB, MySQL destekler |
| CAST → STRING formatı | DB'ye göre farklı |
| `%` ile DECIMAL | PostgreSQL ve SQL Server'da DECIMAL parametre ile hata |
| UNION + limitsiz STRING | Oracle, SAP HANA desteklemez |
| DATEDIFF YEAR | DB'ye göre 0 veya 1 |
| WEEK numarası | DB'ye bağlı |
| `IN` farklı tipler | HSQLDB, PostgreSQL desteklemez |

> Lokal (HSQLDB) ile üretim (PostgreSQL/SQL Server) sonuçları farklı olabilir. **Üretim DB'sinde test edin.**

---

## 18. Sık Hatalar ve Çözümler

| # | Hata | Kök neden | Risk | Çözüm |
|---|---|---|---|---|
| 1 | Bölme hatası / beklenmedik sonuç | `/` kullanılmış | 9/10 | Bölme için `:` kullanın |
| 2 | Tam sayı bölmede kalan kayboluyor | INTEGER : INTEGER | 8/10 | `CAST(x AS DECIMAL) : y` |
| 3 | Fonksiyon bulunamadı (10.24) | 11.x fonksiyonu | 9/10 | 🔵 işaretlileri kullanmayın |
| 4 | `Order`/`Group` entity hatası | Rezerve kelime | 7/10 | `"Sales.Order"` |
| 5 | GROUP BY geçersiz | SELECT'te gruplanmamış attribute | 8/10 | Attribute'u GROUP BY'a ekleyin veya aggregate yapın |
| 6 | Satır sayısı patlıyor | Kartezyen çarpım | 8/10 | Association yolu yerine JOIN |
| 7 | `= NULL` çalışmıyor gibi | Karışık NULL mantığı | 6/10 | `IS NULL` kullanın |
| 8 | View entity ORDER BY hatası | LIMIT/OFFSET yok | 6/10 | LIMIT ekleyin veya sıralamayı widget'ta yapın |
| 9 | `[%CurrentObject%]` hatası | OQL'de desteklenmez | 6/10 | Parametre kullanın |
| 10 | Alias'ta boşluk | Desteklenmez | 4/10 | `Customer_Name` |
| 11 | DECIMAL eşitliği tutmuyor | Hassasiyet farkı | 5/10 | `ROUND(a, 2) = ROUND(b, 2)` |
| 12 | Lokal ve prod farklı sonuç | DB farkları | 6/10 | Bölüm 17, prod DB'de test |

---

## 19. Hazır Tarif Kartları

```sql
-- Marka başına toplam stok
SELECT Brand, SUM(Stock) AS SumStock
FROM Sales.Location
GROUP BY Brand

-- 1'den fazla lokasyonu olan markalar
SELECT Brand, COUNT(*) AS Cnt
FROM Sales.Location
GROUP BY Brand
HAVING COUNT(*) > 1

-- Müşteri + sipariş (siparişi olmayanlar dahil)
SELECT C/LastName, O/Number
FROM Sales.Customer C
LEFT JOIN C/Sales.Order_Customer/Sales.Order O

-- Siparişi OLMAYAN müşteriler
SELECT C/LastName
FROM Sales.Customer C
LEFT JOIN C/Sales.Order_Customer/Sales.Order O
WHERE O/ID IS NULL

-- Mevcut kullanıcının kayıtları
SELECT Name FROM Sales.Person
WHERE System.owner = '[%CurrentUser%]'

-- Bu yılın kayıtları
SELECT * FROM Sales.Period
WHERE DATEPART(YEAR, End) = DATEPART(YEAR, '[%CurrentDateTime%]')

-- Son 30 gün
SELECT * FROM Sales.Order
WHERE CreatedDate >= '[%BeginOfCurrentDay%] - 30 * [%DayLength%]'

-- Yaş hesabı
SELECT Name, DATEDIFF(YEAR, BirthDate, '[%CurrentDateTime%]') AS Age
FROM Sales.Person

-- Aylık gruplama (10.x uyumlu)
SELECT DATEPART(YEAR, OrderDate) AS Yil,
       DATEPART(MONTH, OrderDate) AS Ay,
       SUM(Total) AS Toplam
FROM Sales.Order
GROUP BY DATEPART(YEAR, OrderDate), DATEPART(MONTH, OrderDate)

-- Ad soyad birleştirme
SELECT FirstName + ' ' + LastName AS FullName FROM Sales.Customer

-- Boş değeri varsayılanla değiştir
SELECT COALESCE(Nickname, FirstName) AS DisplayName FROM Sales.Customer

-- Durum etiketi
SELECT Number,
  CASE
    WHEN Total > 1000 THEN 'Büyük'
    WHEN Total > 100  THEN 'Orta'
    ELSE 'Küçük'
  END AS Boyut
FROM Sales.Order

-- Sayfalama (sayfa 3, sayfa başı 20)
SELECT * FROM Sales.Customer
ORDER BY LastName
LIMIT 20 OFFSET 40

-- İsim arama (büyük/küçük harf duyarsız)
SELECT * FROM Sales.Customer
WHERE LOWER(LastName) LIKE '%yil%'

-- Enum filtresi (10.x)
SELECT * FROM Sales.Order WHERE Status = 'Approved'
```

---

*Lisans: Mendix dokümantasyonu CC BY 4.0. Bu özet aynı lisansla paylaşılabilir; kaynak gösterin.*
