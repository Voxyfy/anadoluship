# @voxyfy/anadoluship (Node.js / TypeScript)

Türk kargo firmaları (MNG Kargo, Yurtiçi Kargo, Aras Kargo, PTT Kargo, Sürat
Kargo, UPS) için tek arayüzlü, **framework'e bağımlı olmayan** bir kargo/gönderi
kütüphanesi.

> ⚠️ **Erken aşama.** `FakeProvider`'ın yanında artık bir gerçek driver var:
> **`MngProvider`** — Apizone'daki (sandbox.mngkargo.com.tr) gerçek OpenAPI/
> Swagger şemalarına karşı yazıldı (`createShipment`, `cancelShipment`).
> **Henüz gerçek bir MNG test müşteri hesabıyla ölçülmedi** — token endpoint'i
> için gereken müşteri numarası/şifresi ayrı bir kimlik doğrulama katmanı,
> bkz. [MNG ile başlarken](#mng-ile-başlarken). `trackShipment` bilerek
> implement edilmedi; MNG'nin sorgu API'si henüz incelenmedi ve tahmini şema
> ile sahte bir driver yazmaktansa açıkça "henüz yok" demeyi tercih ettik.

## Amacımız

[AnadoluPay](https://github.com/Voxyfy/anadolupay), Türk banka ve ödeme
sağlayıcılarını (NestPay, PayFor, PayFlex, iyzico, PayTR ve daha fazlası) tek
bir arayüzde toplayan, gerçek banka test ortamlarına karşı ölçülerek
doğrulanmış bir kütüphane ailesi (PHP + Node/TS portu). AnadoluShip, aynı
"çok sağlayıcı, tek API, driver mimarisi" yaklaşımını **kargo firmalarına**
taşıma girişimidir.

Neden bu işe değer bulduk:

- **Node/TS ekosisteminde bu paketin dengi yok.** Gördüğümüz kargo
  kütüphaneleri ya tek bir firmayı kapsıyor ya da web scraping tabanlı takip
  yapıyor. Çok sağlayıcılı, testli, gerçek API'ye dayanan bir paket bu
  ekosistemde henüz yok.
- **Mevcut açık kaynak girişimleri olgun değil.** İncelediğimiz en kapsamlı
  girişimde 12 firma × 6 fonksiyondan (create/track/cancel × yurt içi/yurt
  dışı) sadece 1'inin gerçekten çalıştığını, testlerin IDE tarafından
  üretilmiş boş iskeletler olduğunu ve projenin ~2 yıldır terk edildiğini
  gördük.
- **Sandbox/dokümantasyon durumu firmadan firmaya çok değişiyor.** MNG'nin
  self-servis geliştirici portalı (`sandbox.mngkargo.com.tr`, "Apizone" —
  şu anda DHL eCommerce markası altında yayınlanıyor) ve açık sandbox'ı var,
  kayıt olup API ürünlerine (Barcode Command, Bulk Query, CBS Info, Finance
  Query vb.) doğrudan erişilebiliyor; UPS'in global Developer Kit + CIE
  sandbox'ı var. Yurtiçi ve Aras'ın ayrı test host'ları var ama kimlik
  bilgisi almak kurumsal başvuruya bağlı. PTT belirsiz, Sürat'ta hiç sandbox
  yok. Bu yüzden driver'lar sırayla, doğrulanabilirlik kolaylığına göre
  yazılacak.

## Kurulum

```bash
npm install @voxyfy/anadoluship
```

```ts
import { createAnadoluShip, FakeProvider } from '@voxyfy/anadoluship';
```

Node.js 18 veya üzeri gerekir. Kütüphane framework'e bağımlı değildir; hangi
driver'ları hangi kimlik bilgileriyle kuracağınızı `createAnadoluShip({ drivers })`
çağrısında siz belirlersiniz.

## Mimari

| Kavram | Bu pakette |
|---|---|
| Driver sözleşmesi | `ShippingProvider` interface'i — `createShipment`, `trackShipment`, `cancelShipment` |
| Firma bazında değişen yetenekler | `contracts/capabilities.ts`'teki tip-koruyucu fonksiyonlar (`supportsLabelRetrieval`, `supportsRateQuote`) — etiket alma ve fiyat sorgusu her firmada yok |
| DTO'lar | `Address`, `Parcel`, `CreateShipmentData`, `ShipmentResponse`, `TrackingResponse`, `CancelShipmentResponse`, `LabelResponse`, `RateQuoteData/Response` — `dto/` altında |
| Durum normalizasyonu | `support/ShipmentStatus.ts` — firma yanıtları bu enum'a eşlenir |
| İstemci | `createAnadoluShip({ drivers })` — tipli bir fabrika, framework'e bağımlı değil |
| Hata hiyerarşisi | `errors/AnadoluShipError.ts` — `DriverNotFoundError`, `ShipmentFailedError`, `UnsupportedCapabilityError` |

İlk driver **`FakeProvider`** — ağ çağrısı yapmaz, gönderileri bellekte tutar.
Bilerek en başta seçildi: mimarinin (DTO'lar, contract, yetenek tespiti, hata
hiyerarşisi) doğru kurulduğunu kanıtlar ve gerçek bir kargo firması kimliği
gerektirmez.

```ts
import {
  createAnadoluShip,
  FakeProvider,
  CreateShipmentData,
  Address,
  Parcel,
} from '@voxyfy/anadoluship';

const anadoluship = createAnadoluShip({
  drivers: {
    fake: () => new FakeProvider(),
  },
});

const provider = anadoluship.driver('fake');

const shipment = await provider.createShipment(
  new CreateShipmentData(
    'order-123',
    new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Örnek Mah. 1. Sk. No:1'),
    new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Örnek Mah. 2. Sk. No:2'),
    new Parcel(1500, 2),
  ),
);

console.log(shipment.trackingNumber);
```

Firma bazında değişen yetenekleri kullanmadan önce tip-koruyucu ile kontrol
edin — her firma etiket alma veya fiyat sorgusu sunmaz:

```ts
import { supportsRateQuote } from '@voxyfy/anadoluship';

if (supportsRateQuote(provider)) {
  const quote = await provider.calculateRate(rateQuoteData);
}
```

## Kapsam ve doğrulama durumu (kargo firmaları)

| Firma | Driver durumu | API tipi | Sandbox/test ortamı |
|---|---|---|---|
| MNG Kargo | **Yazıldı, doğrulanmadı** — `MngProvider` (create+cancel) | REST/JSON, API key (`X-IBM-Client-Id/Secret`) + JWT bearer | Var — `sandbox.mngkargo.com.tr` ("Apizone", DHL eCommerce markalı), self-servis kayıt doğrulandı |
| UPS | Planlandı | REST, OAuth2 (global Developer Kit) | Var — global CIE, Türkiye'ye özel değil |
| Yurtiçi Kargo | Planlandı | SOAP/WSDL (+ kısmi REST) | Var — ayrı test host'u, kimlik başvuruya bağlı |
| Aras Kargo | Planlandı | SOAP/WSDL | Var — ayrı test host'u, kimlik başvuruya bağlı |
| PTT Kargo | Planlandı | SOAP/WSDL | Belirsiz — kanıt yetersiz |
| Sürat Kargo | Planlandı | SOAP/ASMX | Yok — muhtemelen prod'da düşük hacimli deneme gerekiyor |

AnadoluPay'de öğrenilen en kalıcı ders burada da geçerli: bir driver'ın "doğru
yazılmış olması" ile "gerçekten o kargo firmasına karşı çalışması" ayrı
şeyler. Her driver, yazıldıktan sonra ilgili firmanın test ortamına (varsa)
karşı doğrulanacak; sandbox'ı olmayan firmalarda bu adım daha yavaş ve
firma işbirliğine bağımlı olacak.

## MNG ile neler yapılabiliyor

Apizone'da MNG'nin altında 12 farklı API ürünü yayında. Bu tablo hangilerinin
`anadoluship`'e entegre edildiğini, hangilerinin henüz sadece keşfedildiğini
gösterir:

| API Ürünü | Ne işe yarar | Durum |
|---|---|---|
| **Identity** | Token/JWT üretimi (kimlik doğrulama katmanı) | ✅ `MngProvider` içinde kullanılıyor |
| **Barcode Command** | Sipariş oluşturma → gönderiye çevirme, güncelleme, iptal, barkod üretme | ✅ `createShipment`/`cancelShipment` yazıldı — `updateShipment` henüz yok |
| **Standard Query** | Sipariş/gönderi bilgisi, durum, hareket sorgusu **ve** taşıma ücreti hesaplama | ⏳ Planlandı — `trackShipment` ve `calculateRate` (`SupportsRateQuote`) için gereken bu |
| **Standard Command** | "Normal"/"İade" sipariş oluşturma, güncelleme, iptal | ⏳ İncelenmedi |
| **Plus Command** | Detaylı/Pazaryeri sipariş oluşturma, teslimat iptali, alıcı oluşturma, teslimat problemi yanıtlama | ⏳ İncelenmedi |
| **Plus Query** | İade gönderi listeleme, irsaliye no ile hareket, tarih/barkod ile gönderi bilgisi, teslimat problemi listeleme | ⏳ İncelenmedi |
| **Bulk Query** | Aynı istekte birden çok sipariş/gönderi bilgisi, durumu, hareketi | ⏳ İncelenmedi |
| **Finance Query** | Gönderiye ait fatura ve komisyon fatura listesi | ⏳ İncelenmedi — kapsam dışı olabilir |
| **CBS Info** | Şehir/ilçe/mahalle coğrafi veri, servis dışı bölge listesi | ⏳ İncelenmedi — adres doğrulama için ileride faydalı olabilir |
| **International** | Yurt dışı gönderi işlemleri | ⏳ İncelenmedi |
| **Utility** | API'lerle ilgili genel bilgi döndürür | ⏳ İncelenmedi — düşük öncelik |
| **Next Tahsilat Makbuzu** (Mobil Kurye API) | Kuryenin mobil uygulamasında tahsilat makbuzu | ❌ Kapsam dışı — B2B entegrasyon değil, kurye-içi mobil akış |

**Önemli not — kimlik doğrulama iki katmanlı:** `X-IBM-Client-Id`/
`X-IBM-Client-Secret` sadece *uygulamanızı* (Apizone'daki API tüketicisini)
tanımlar; her API ürününe **ayrı ayrı abone olmanız gerekir** (Barcode
Command'a abone olmak Identity'ye otomatik erişim vermez — bunu MNG driver'ını
test ederken 401 alarak öğrendik). Ayrıca `/token` çağrısının çalışması için
gereken **MNG Müşteri Numarası + şifresi** bambaşka bir katman: bu, Apizone
portal hesabınızın kullanıcı adı/şifresi değil, MNG'nin size ayrıca verdiği
**sayısal** bir hesap numarasıdır (Identity API'nin swagger dokümanı bu alanı
hatalı şekilde `string` gösteriyor, backend `int64` bekliyor). Bunu self-servis
olarak portaldan almanın bir yolu yok; portaldaki yorumlarda birden fazla
geliştirici aynı soruyu sorup yanıt alamamış — MNG/DHL eCommerce ile
doğrudan iletişime geçmek gerekiyor.

## Yol haritası

1. `ShippingProvider` sözleşmesi + `FakeProvider` — ✅ tamam
2. MNG Kargo driver'ı — ✅ `createShipment`/`cancelShipment` yazıldı, ⏳ gerçek sandbox'a karşı doğrulanacak (müşteri numarası bekleniyor), ⏳ `trackShipment`/`calculateRate` (Standard Query API inceleme bekliyor) — bkz. [MNG ile neler yapılabiliyor](#mng-ile-neler-yapılabiliyor)
3. UPS driver'ı — global Developer Kit + CIE
4. Yurtiçi Kargo, Aras Kargo driver'ları — test host'u var, kimlik bilgisi süreci daha yavaş
5. PTT Kargo, Sürat Kargo driver'ları — sandbox netleştikçe/kurumsal erişim sağlandıkça

## MNG ile başlarken

MNG driver'ını gerçek sandbox'a karşı denemek (veya kendi entegrasyonunuzu
yazmak) için Apizone üzerinde şu adımları izleyin:

1. **Hesap oluşturun** — [sandbox.mngkargo.com.tr](https://sandbox.mngkargo.com.tr)
   adresinde ücretsiz kayıt olun (portal "Apizone" / DHL eCommerce markası
   altında).
2. **Uygulama oluşturun** — *Uygulamalar → Yeni uygulama oluştur*. Sadece
   **Başlık** zorunlu. **"Application OAuth Redirect URL(s)"** alanını boş
   bırakabilirsiniz — bu alan sadece tarayıcı tabanlı OAuth2 Authorization
   Code akışı için var; MNG API'leri sunucu-sunucu (API key + JWT) ile
   çalıştığı için bu projede kullanılmıyor.
3. **Kimlik bilgilerinizi alın** — oluşturduğunuz uygulamanın *Abonelikler*
   sekmesinde **API Anahtarı** (`X-IBM-Client-Id`) ve **API Güvenlik
   Dizgisi** (`X-IBM-Client-Secret`, göz simgesiyle görünür hale gelir) yer
   alır.
4. **Barcode Command API'ye abone olun** — *API Ürünleri → Barcode Command →
   Default Plan → Seç*, uygulamanızı seçip aboneliği onaylayın (ücretsiz,
   onay gerektirmiyor).
5. **Test müşteri numarası/şifresi edinin** — bu, uygulama kimliğinden
   ayrı bir katman: `MngProvider`'ın kullandığı `/mngapi/api/token`
   endpoint'i bir **MNG Müşteri Numarası + şifresi** ister. Bunu
   **self-servis olarak portaldan alamıyoruz** — Identity API ürününün
   yorumlarında birden fazla geliştirici aynı soruyu sormuş
   ("test müşteri numarası nasıl alınır?") ve yanıtlanmamış durumda; MNG/DHL
   eCommerce ile iletişime geçmek gerekebilir.
6. **`.env` dosyanızı doldurun** — bu depodaki `.env.example`'ı kopyalayıp
   `MNG_CLIENT_ID`, `MNG_CLIENT_SECRET`, `MNG_CUSTOMER_NUMBER`,
   `MNG_PASSWORD` değerlerini girin. Bu dosya `.gitignore`'da hariç
   tutulur — hiçbir zaman commit'lemeyin.
7. **Kod ile çağırın:**

   ```ts
   import { MngProvider, CreateShipmentData, Address, Parcel } from '@voxyfy/anadoluship';

   const provider = new MngProvider({
     clientId: process.env.MNG_CLIENT_ID!,
     clientSecret: process.env.MNG_CLIENT_SECRET!,
     customerNumber: process.env.MNG_CUSTOMER_NUMBER!,
     password: process.env.MNG_PASSWORD!,
     // baseUrl: 'https://testapi.mngkargo.com.tr' (varsayılan, sandbox)
   });

   const shipment = await provider.createShipment(
     new CreateShipmentData(
       'order-123',
       new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Örnek Mah. 1. Sk. No:1'),
       new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Örnek Mah. 2. Sk. No:2'),
       new Parcel(1500, 2),
     ),
   );

   console.log(shipment.trackingNumber);
   ```

8. **Gerçek sandbox'a karşı test edin** — `tests/MngProvider.live.test.ts`,
   yukarıdaki 4 ortam değişkeni tanımlıysa gerçek `testapi.mngkargo.com.tr`
   uç noktasına çağrı yapar; tanımlı değilse otomatik atlanır (CI'yı
   kırmaz):

   ```bash
   MNG_CLIENT_ID=... MNG_CLIENT_SECRET=... MNG_CUSTOMER_NUMBER=... MNG_PASSWORD=... npm test
   ```

   Müşteri numarası/şifresi henüz elinizde yoksa (adım 5), bu test atlanmış
   olarak görünecektir — `createShipment`/`cancelShipment` kodu derlenip
   birim test kapsamında doğrulanmış olsa da, gerçek API'ye karşı henüz
   ölçülmemiş demektir.

## İlgili projeler

- **[Voxyfy/anadolupay](https://github.com/Voxyfy/anadolupay)** — aynı driver
  mimarisinin Türk banka/ödeme sağlayıcıları için PHP/Laravel karşılığı.
- **[Voxyfy/anadolupay-node](https://github.com/Voxyfy/anadolupay-node)** —
  aynı mimarinin Node.js/TypeScript'e taşınmış hali; bu paketin doğrudan
  esin kaynağı.

## Lisans

MIT
