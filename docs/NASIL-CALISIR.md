# dump-it nasıl çalışır? (en basit anlatım)

## 1. Tek cümleyle

dump-it, Mendix projeni **sen konuşarak** değiştirmeni sağlar: "Order için bir sayfa yap" dersin, bir yapay zekâ
(Claude Code veya OpenCode) bunu küçük bir **iş listesine** çevirir, dump-it bu listeyi projene **güvenli** şekilde uygular.

## 2. Bir benzetme: tadilat ustası

Evin = Mendix projen (`.mpr` dosyası).

| Gerçek hayat | dump-it'te |
|---|---|
| Sen ustaya ne istediğini söylersin | Sen yapay zekâya Türkçe yazarsın |
| Usta bir iş listesi çıkarır | Yapay zekâ `edits/` klasörüne bir JSON dosyası yazar (değişiklik dosyası) |
| Usta önce kâğıt üstünde gösterir | **Dry run**: hiçbir şey değişmez, sadece ne olacağı yazılır |
| Sen "tamam" dersin | Ekranda bir **onay kodu** çıkar, sen o kodu verirsin |
| Usta işe başlar, eskisini saklar | **Apply**: önce yedek alınır, sonra yazılır |
| Beğenmezsen eski hâline döner | **Restore / undo**: yedekten geri alınır |

Kural: **Onay kodu olmadan hiçbir şey yazılmaz.** Yapay zekâ kendi kendine projeni bozamaz.

## 3. Adım adım bir istek

```
Sen:        "Müşteri listesi sayfası yap"
   │
   ▼
Yapay zekâ: python mx.py find Customer        ← önce projeye bakar (sadece okur)
            edits/musteri.json yazar          ← iş listesi: { "ops": [ { "op": "createPage", ... } ] }
            python mx.py dryrun musteri.json  ← deneme
   │
   ▼
dump-it:    "1. createPage Sales.Customer_Overview ...  Onay kodu: 7F3A"
            + kontroller: ifade hataları, XPath hataları, akış çizimi, erişim kuralları
   │
   ▼
Sen:        Studio Pro'yu kapatırsın, "7F3A ile uygula" dersin
   │
   ▼
dump-it:    yedek al → yaz → yeniden aç → "her şey yerinde mi?" kontrol et
   │
   ▼
Sen:        Studio Pro'yu açarsın, sayfa oradadır.
```

## 4. Parçalar neler?

| Parça | Ne işe yarar | Kim kullanır |
|---|---|---|
| `mxcontext.py` | Projeyi okunabilir metin dosyalarına döker (bir "harita"). Yapay zekâ projeyi buradan anlar | Kurulumda bir kez, sonra `refresh` |
| `mx.py` | Yapay zekânın kullandığı kısa komutlar: `find`, `usages`, `dryrun`, `apply`, `contract` ... | Yapay zekâ |
| `mxlocal/` | Asıl motor: Mendix Model SDK'yı **internet olmadan**, bilgisayarındaki `.mpr` üstünde çalıştırır | `mx.py` çağırır |
| `ops` (operasyonlar) | 250'den fazla hazır iş: `createEntity`, `createPage`, `createMicroflow`, `publishRest` ... | Değişiklik dosyasında |
| Selftest + CI | Her değişiklikten sonra 16 gerçek test projesinde her şeyi dener; GitHub'da gerçek Studio Pro kontrolü (mx check) çalışır | Geliştirici (biz) |
| `docs/OPENCODE.md` | Yapay zekânın kullanım kılavuzu: her operasyon için bir örnek | Yapay zekâ |

## 5. Değişiklik dosyası neye benzer?

```json
{ "ops": [
  { "op": "createEntity", "module": "Sales", "name": "Order",
    "attributes": [ { "name": "Number", "type": "String(20)" }, { "name": "Total", "type": "Decimal" } ] },
  { "op": "createCrud", "entity": "Sales.Order" }
] }
```

Okuması: "Sales modülünde Order entity'si yap, iki alanı olsun. Sonra ona liste ve düzenleme sayfaları üret."
Her satır bir iş. Sırayla yapılır. Biri hata verirse **hiçbiri** yazılmaz.

## 6. Güvenlik kemerleri

| Tehlike | dump-it ne yapar |
|---|---|
| Yapay zekâ yanlış bir şey yazar | Dry run önce gösterir; onay kodu sende |
| Studio Pro açıkken dosya değişir | Apply, Studio Pro'yu kapatmanı ister |
| Yazım hatası (`Totl` gibi) | "Bunu mu demek istedin: `Total`?" der, durdurur |
| Bozuk ifade / XPath | EXPRESSION CHECK ve XPATH CHECK yakalar |
| Bir şey silinir ama hâlâ kullanılıyordur | `STILL USED BY` listesini gösterir |
| Sonuç beğenilmez | `restore` (hepsini geri al) veya `undo` (bir kısmını geri al) |
| Studio Pro açamayacağı bir şey yazılır | GitHub'da gerçek Studio Pro kontrolü (mx check) her sürümde çalışır; açamadığı tipler yasaklanır (örnek: drop-down button) |
| Script ile her şeyi yapmak | Varsayılan olarak **kapalı** |
| Proje verisi buluta gider | DeepSeek gibi bulut modellerinde model içeriği dışarı gider: gizli projede yerel model kullan |

## 7. Ne yapamaz? (kısa)

- Studio Pro'nun bir dosyadan **içe aktardığı** şeyler: WSDL (SOAP), OData `$metadata`, OpenAPI'nin dokümana bağlanması.
  Bunlar için `python mx.py contract <dosya> <Modül>` dosyayı okur, yapılabilen kısmı plan olarak yazar, kalanı için Studio Pro adımlarını söyler.
- Marketplace modülü isteyen bazı şeyler: Excel importer, Database connector, ML model, Kafka.
- Test projelerinde örneği olmayan tipler yazılır ama dry run **"Studio Pro'da kontrol edin"** der.

Operasyon yetmezse yapay zekâ `python mx.py gap "<ne istendi>"` ile eksikliği kaydeder ve sana Studio Pro adımlarını verir.

## 8. En sık kullanılan 6 komut

| Komut | Ne yapar |
|---|---|
| `python mx.py find Order` | Adında "Order" geçen her şeyi bulur |
| `python mx.py usages Sales.Order` | Onu kim kullanıyor? |
| `python mx.py dryrun dosya.json` | Dener, hiçbir şey yazmaz, onay kodu verir |
| `python mx.py apply KOD` | Onaylanan denemeyi yazar (Studio Pro kapalı) |
| `python mx.py restore` | Son yazmayı geri alır |
| `python mx.py ops createPage` | Bir operasyonun alanlarını gösterir |

## 9. Hatırla

1. Önce **dry run**, sonra **onay kodu**, sonra **apply**.
2. Apply sırasında **Studio Pro kapalı** olmalı.
3. Apply'dan sonra Studio Pro'da projeyi aç ve **Errors** paneline bak.
