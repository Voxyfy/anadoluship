# @voxyfy/anadoluship (Node.js / TypeScript)

Türk kargo firmaları (MNG Kargo, Yurtiçi Kargo, Aras Kargo, PTT Kargo, Sürat
Kargo, UPS) için tek arayüzlü, **framework'e bağımlı olmayan** bir kargo/gönderi
kütüphanesi.

> ⚠️ **Taslak aşama.** Bu depo henüz mimari iskelet halinde: contract'lar,
> DTO'lar ve `FakeProvider` (ağ çağrısı yapmayan sahte driver) hazır, ama
> **hiçbir gerçek kargo firması driver'ı henüz yazılmadı**. Sırada MNG var —
> bkz. [Yol Haritası](#yol-haritası).

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
| MNG Kargo | Planlandı (sıradaki) | REST/JSON, OAuth2 | Var — `sandbox.mngkargo.com.tr` ("Apizone", DHL eCommerce markalı), self-servis kayıt doğrulandı |
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

## Yol haritası

1. `ShippingProvider` sözleşmesi + `FakeProvider` — ✅ tamam
2. MNG Kargo driver'ı — self-servis sandbox sayesinde en hızlı doğrulanabilir, referans implementasyon
3. UPS driver'ı — global Developer Kit + CIE
4. Yurtiçi Kargo, Aras Kargo driver'ları — test host'u var, kimlik bilgisi süreci daha yavaş
5. PTT Kargo, Sürat Kargo driver'ları — sandbox netleştikçe/kurumsal erişim sağlandıkça

## İlgili projeler

- **[Voxyfy/anadolupay](https://github.com/Voxyfy/anadolupay)** — aynı driver
  mimarisinin Türk banka/ödeme sağlayıcıları için PHP/Laravel karşılığı.
- **[Voxyfy/anadolupay-node](https://github.com/Voxyfy/anadolupay-node)** —
  aynı mimarinin Node.js/TypeScript'e taşınmış hali; bu paketin doğrudan
  esin kaynağı.

## Lisans

MIT
