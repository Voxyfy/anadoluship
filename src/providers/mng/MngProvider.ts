import { ShippingProvider } from '../../contracts/ShippingProvider.js';
import { SupportsRateQuote } from '../../contracts/capabilities.js';
import { CreateShipmentData } from '../../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../../dto/ShipmentResponse.js';
import { TrackingResponse } from '../../dto/TrackingResponse.js';
import { TrackingEvent } from '../../dto/TrackingEvent.js';
import { CancelShipmentResponse } from '../../dto/CancelShipmentResponse.js';
import { RateQuoteData } from '../../dto/RateQuoteData.js';
import { RateQuoteResponse } from '../../dto/RateQuoteResponse.js';
import { ShipmentStatus } from '../../support/ShipmentStatus.js';
import { ShipmentFailedError } from '../../errors/AnadoluShipError.js';

export interface MngProviderConfig {
  /** Apizone'da oluşturduğunuz uygulamanın kimlik bilgileri (Kimlik Bilgileri sekmesi). */
  clientId: string;
  clientSecret: string;
  /** MNG Müşteri Numarası ve şifresi — token endpoint'i bunlarla giriş yapar, uygulama kimliğinden ayrıdır. */
  customerNumber: string;
  password: string;
  /** Sandbox: https://testapi.mngkargo.com.tr (varsayılan). Prod host'u henüz doğrulanmadı. */
  baseUrl?: string;
}

interface MngTokenResponse {
  jwt: string;
  refreshToken: string;
  jwtExpireDate: string;
  refreshTokenExpireDate: string;
}

interface CreateBarcodeApiResponse {
  referenceId: string;
  invoiceId: string;
  shipmentId: string;
  barcodes: { pieceNumber: number; value: string }[];
}

interface MngTrackEvent {
  eventStatus: string;
  eventStatusEn?: string;
  eventDateTime: string;
  location?: string;
  description?: string;
}

interface MngCityOrDistrict {
  code: string;
  name: string;
}

interface MngCalculateResponse {
  finalTotal: number;
}

const DEFAULT_BASE_URL = 'https://testapi.mngkargo.com.tr';

/** "10.03.2020 16:05:00" veya "12-02-2019 20:30:45" gibi dd{sep}MM{sep}yyyy formatlarını `Date.parse` anlamaz. */
function parseMngDate(value: string, separator: '.' | '-' = '.'): number {
  const [datePart = '', timePart = '00:00:00'] = value.split(' ');
  const [day = 1, month = 1, year = 1970] = datePart.split(separator).map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);

  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/** Türkçe karakterleri sadeleştirip küçük harfe çevirir — şehir/ilçe/durum adı eşleştirmede kullanılır. */
function foldTurkish(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * MNG'nin gönderi durum kodları sabit (bkz. Standard Query API şeması,
 * `ShipmentOUT.shipmentStatusCode` açıklaması): 1 Gönderi_Hazırlandı,
 * 2 Transfer_Aşamasında, 3 Teslimat_Birimine_Ulaştı,
 * 4 Alıcı_Adresine_Yönlendirildi, 5 Teslim_Edildi, 6 Teslim_Edilemedi,
 * 7 Geri_Geliyor, 8 Destek_Gerekiyor. API yanıtındaki `eventStatus` alanı
 * bu adları bazen boşluklu bazen alt çizgili döndürüyor, bu yüzden
 * karşılaştırmadan önce sadeleştiriyoruz.
 */
function mapMngEventStatus(eventStatus: string): ShipmentStatus {
  const key = foldTurkish(eventStatus);
  const table: [string, ShipmentStatus][] = [
    ['gonderihazirlandi', ShipmentStatus.Created],
    ['transferasamasinda', ShipmentStatus.InTransit],
    ['teslimatbirimineulasti', ShipmentStatus.InTransit],
    ['alicradresineyonlendirildi', ShipmentStatus.OutForDelivery],
    ['aliciadresineyonlendirildi', ShipmentStatus.OutForDelivery],
    ['teslimedildi', ShipmentStatus.Delivered],
    ['teslimedilemedi', ShipmentStatus.Exception],
    ['gerigeliyor', ShipmentStatus.Returned],
    ['destekgerekiyor', ShipmentStatus.Exception],
  ];

  return table.find(([k]) => k === key)?.[1] ?? ShipmentStatus.Unknown;
}

/**
 * MNG Kargo Driver
 *
 * Apizone (DHL eCommerce API Developer Portal, sandbox.mngkargo.com.tr)
 * üzerinde yayınlanan gerçek OpenAPI/Swagger şemalarına karşı yazıldı:
 * Identity API (auth), Barcode Command API (create/cancel), Standard Query
 * API (track/calculate) ve CBS Info API (şehir/ilçe kodu çözümleme).
 * **Henüz gerçek bir MNG test müşteri hesabıyla ölçülmedi** — bkz.
 * README'deki doğrulama durumu.
 *
 * Kimlik doğrulama iki katmanlı:
 * 1. Uygulama seviyesi: her istekte `X-IBM-Client-Id` / `X-IBM-Client-Secret`
 *    header'ları (Apizone'da oluşturduğunuz uygulamanın kimlik bilgileri).
 * 2. Hesap seviyesi: `/mngapi/api/token`'a müşteri numarası + şifre ile
 *    POST atıp alınan JWT, `Authorization: Bearer` header'ında gönderilir.
 *
 * `updateShipment` (Barcode Command'daki `PUT /updateshipment`) bilerek
 * `ShippingProvider` sözleşmesine eklenmedi — sözleşmenin kapsamında yok.
 * Standard/Plus Command, Plus/Bulk Query, Finance Query, International ve
 * Utility ürünleri incelendi ama `ShippingProvider`/`capabilities`
 * sözleşmesinde karşılığı olmadığı için implement edilmedi — bkz. README
 * "MNG ile neler yapılabiliyor" tablosu.
 */
export class MngProvider implements ShippingProvider, SupportsRateQuote {
  private token: { jwt: string; expiresAt: number } | null = null;
  private cityCodeCache: Map<string, string> | null = null;
  private readonly districtCodeCache = new Map<string, Map<string, string>>();

  constructor(private readonly config: MngProviderConfig) {}

  async createShipment(data: CreateShipmentData): Promise<ShipmentResponse> {
    const response = await this.request<CreateBarcodeApiResponse>('POST', '/mngapi/api/barcodecmdapi/createbarcode', {
      referenceId: data.referenceId,
      isCOD: data.cashOnDeliveryAmount ? 1 : 0,
      codAmount: data.cashOnDeliveryAmount ? data.cashOnDeliveryAmount / 100 : 0,
      message: data.note ?? '',
      orderPieceList: [
        {
          barcode: `${data.referenceId}_PARCA1`,
          desi: data.parcel.desi ?? 1,
          kg: Math.max(1, Math.ceil(data.parcel.weightGrams / 1000)),
          content: data.parcel.content ?? '',
        },
      ],
    });

    return new ShipmentResponse(response.shipmentId, response.referenceId, undefined, response);
  }

  /** Standard Query API'nin `GET /trackshipmentByShipmentId/{shipmentId}` uç noktasını kullanır. */
  async trackShipment(trackingNumber: string): Promise<TrackingResponse> {
    const events = await this.request<MngTrackEvent[]>(
      'GET',
      `/mngapi/api/standardqueryapi/trackshipmentByShipmentId/${encodeURIComponent(trackingNumber)}`,
    );

    const trackingEvents = events.map(
      (event) =>
        new TrackingEvent(new Date(parseMngDate(event.eventDateTime, '-')), event.description || event.eventStatus, event.location),
    );

    const lastEvent = events.at(-1);
    const status = lastEvent ? mapMngEventStatus(lastEvent.eventStatus) : ShipmentStatus.Unknown;

    return new TrackingResponse(trackingNumber, status, trackingEvents, events);
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    await this.request('PUT', '/mngapi/api/barcodecmdapi/cancelshipment', {
      referenceId: trackingNumber,
      shipmentId: trackingNumber,
    });

    return new CancelShipmentResponse(trackingNumber, true);
  }

  /**
   * Standard Query API'nin `POST /calculate` uç noktasını kullanır. MNG bu
   * çağrı için şehir/ilçe **adı değil kodu** ister; kodları CBS Info API'den
   * (`getcities`/`getdistricts`) çözüp önbelleğe alıyoruz. `data.receiverDistrict`
   * (RateQuoteData'da opsiyonel) verilmezse MNG'nin zorunlu alanı
   * karşılanamadığından açık bir hata fırlatılır — tahmini bir ilçe
   * seçmektense.
   */
  async calculateRate(data: RateQuoteData): Promise<RateQuoteResponse> {
    if (!data.receiverDistrict) {
      throw new ShipmentFailedError(
        "MNG calculateRate için alıcı ilçesi gerekli — RateQuoteData'da receiverDistrict alanını doldurun.",
        { driver: 'mng', capability: 'calculateRate' },
      );
    }

    const cityCode = await this.resolveCityCode(data.receiverCity);
    const districtCode = await this.resolveDistrictCode(cityCode, data.receiverDistrict);

    const response = await this.request<MngCalculateResponse>('POST', '/mngapi/api/standardqueryapi/calculate', {
      shipmentServiceType: 1,
      packagingType: 3,
      paymentType: 1,
      pickUpType: 1,
      deliveryType: 1,
      cityCode: Number(cityCode),
      districtCode: Number(districtCode),
      address: '',
      smsPreference1: 0,
      smsPreference2: 0,
      smsPreference3: 0,
      orderPieceList: [
        {
          barcode: 'RATE-QUOTE',
          desi: data.parcel.desi ?? 1,
          kg: Math.max(1, Math.ceil(data.parcel.weightGrams / 1000)),
        },
      ],
    });

    return new RateQuoteResponse(Math.round(response.finalTotal * 100), 'TRY');
  }

  private async resolveCityCode(cityName: string): Promise<string> {
    if (!this.cityCodeCache) {
      const cities = await this.request<MngCityOrDistrict[]>('GET', '/mngapi/api/cbsinfoapi/getcities');
      this.cityCodeCache = new Map(cities.map((city) => [foldTurkish(city.name), city.code]));
    }

    const code = this.cityCodeCache.get(foldTurkish(cityName));

    if (!code) {
      throw new ShipmentFailedError(`MNG şehir kodu bulunamadı: "${cityName}"`, { city: cityName });
    }

    return code;
  }

  private async resolveDistrictCode(cityCode: string, districtName: string): Promise<string> {
    let districts = this.districtCodeCache.get(cityCode);

    if (!districts) {
      const list = await this.request<MngCityOrDistrict[]>('GET', `/mngapi/api/cbsinfoapi/getdistricts/${cityCode}`);
      districts = new Map(list.map((district) => [foldTurkish(district.name), district.code]));
      this.districtCodeCache.set(cityCode, districts);
    }

    const code = districts.get(foldTurkish(districtName));

    if (!code) {
      throw new ShipmentFailedError(`MNG ilçe kodu bulunamadı: "${districtName}"`, { district: districtName, cityCode });
    }

    return code;
  }

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.jwt;
    }

    const res = await fetch(`${this.baseUrl}/mngapi/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IBM-Client-Id': this.config.clientId,
        'X-IBM-Client-Secret': this.config.clientSecret,
      },
      body: JSON.stringify({
        customerNumber: this.config.customerNumber,
        password: this.config.password,
        identityType: 1,
      }),
    });

    if (!res.ok) {
      throw new ShipmentFailedError(`MNG token alınamadı (HTTP ${res.status})`, { status: res.status });
    }

    const json = (await res.json()) as MngTokenResponse;
    this.token = { jwt: json.jwt, expiresAt: parseMngDate(json.jwtExpireDate, '.') };

    return this.token.jwt;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const jwt = await this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-IBM-Client-Id': this.config.clientId,
        'X-IBM-Client-Secret': this.config.clientSecret,
        Authorization: `Bearer ${jwt}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      throw new ShipmentFailedError(`MNG API hatası (HTTP ${res.status}) — ${path}`, {
        status: res.status,
        path,
        body: await res.text().catch(() => undefined),
      });
    }

    return (await res.json()) as T;
  }
}
