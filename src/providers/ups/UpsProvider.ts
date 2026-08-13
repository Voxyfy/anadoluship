import { ShippingProvider } from '../../contracts/ShippingProvider.js';
import { CreateShipmentData } from '../../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../../dto/ShipmentResponse.js';
import { TrackingResponse } from '../../dto/TrackingResponse.js';
import { TrackingEvent } from '../../dto/TrackingEvent.js';
import { CancelShipmentResponse } from '../../dto/CancelShipmentResponse.js';
import { Address } from '../../dto/Address.js';
import { ShipmentStatus } from '../../support/ShipmentStatus.js';
import { ShipmentFailedError } from '../../errors/AnadoluShipError.js';

export interface UpsProviderConfig {
  /** developer.ups.com'da "Create Application" ile oluşturulan uygulamanın kimlik bilgileri. */
  clientId: string;
  clientSecret: string;
  /** UPS Hesap/Gönderici Numarası (Shipper Number) — UPS.com profilinize bağlı gerçek bir gönderici hesabı gerektirir. */
  accountNumber: string;
  /** UPS Service Code, örn. '03' (Ground) — bkz. UPS Service Code tablosu. Varsayılan '03'. */
  serviceCode?: string;
  /** Sandbox: https://wwwcie.ups.com (CIE, varsayılan). Prod: https://onlinetools.ups.com. */
  baseUrl?: string;
}

interface UpsTokenResponse {
  token_type: string;
  access_token: string;
  expires_in: string;
}

interface UpsAddress {
  Name: string;
  AttentionName: string;
  Phone: { Number: string };
  Address: {
    AddressLine: string[];
    City: string;
    PostalCode: string;
    CountryCode: string;
  };
}

interface UpsShipmentResponseBody {
  ShipmentResponse: {
    Response: { ResponseStatus: { Code: string; Description: string } };
    ShipmentResults: {
      ShipmentIdentificationNumber: string;
      PackageResults: { TrackingNumber: string }[];
    };
  };
}

interface UpsVoidResponseBody {
  VoidShipmentResponse: {
    Response: { ResponseStatus: { Code: string; Description: string } };
    SummaryResult?: { Status: { Code: string; Description: string } };
  };
}

interface UpsTrackActivity {
  date: string;
  time: string;
  status: { type: string; description: string; code?: string };
  location?: { address?: { city?: string; stateProvince?: string; country?: string } };
}

interface UpsTrackResponseBody {
  trackResponse: {
    shipment: {
      inquiryNumber: string;
      package: { trackingNumber: string; activity: UpsTrackActivity[] }[];
    }[];
  };
}

const DEFAULT_BASE_URL = 'https://wwwcie.ups.com';

/**
 * UPS'in tek harfli hareket durum kodları (Track API v1, `activity[].status.type`):
 * D=Delivered, I=In Transit, M=Manifest (etiket oluşturuldu, henüz teslim alınmadı),
 * P=Pickup, X=Exception, W=Warehouse. Kaynak: UPS'in kamuya açık, yıllardır stabil
 * Track API dokümantasyonu — MNG'deki gibi indirilebilir bir OpenAPI dosyasından
 * değil, developer.ups.com'daki referans sayfalarından çıkarıldı.
 */
function mapUpsStatusType(type: string): ShipmentStatus {
  switch (type.toUpperCase()) {
    case 'M':
      return ShipmentStatus.Created;
    case 'P':
    case 'I':
      return ShipmentStatus.InTransit;
    case 'D':
      return ShipmentStatus.Delivered;
    case 'X':
      return ShipmentStatus.Exception;
    default:
      return ShipmentStatus.Unknown;
  }
}

function toUpsAddress(address: Address): UpsAddress {
  return {
    Name: address.fullName,
    AttentionName: address.fullName,
    Phone: { Number: address.phone },
    Address: {
      // UPS'in Address şeması ABD-eyalet modeline göre tasarlı (City + StateProvinceCode);
      // Türkiye adreslerinde ilçe (district) için ayrı bir alan yok, bu yüzden adres
      // satırına ekleniyor — bilinen bir basitleştirme, gerçek sandbox'a karşı
      // doğrulanmadı.
      AddressLine: [`${address.addressLine}, ${address.district}`],
      City: address.city,
      PostalCode: address.postalCode ?? '',
      CountryCode: 'TR',
    },
  };
}

/**
 * UPS Driver
 *
 * developer.ups.com'daki gerçek OpenAPI referans dokümantasyonuna (OAuth
 * Client Credentials, Shipping, Tracking API) karşı yazıldı. **Hiçbir
 * gerçek UPS hesabıyla ölçülmedi** — bir UPS gönderici hesap numarası
 * (Shipper Number) almak ödeme yöntemi eklemeyi gerektiriyor, bu adımı
 * kullanıcının kendisi tamamlamalı. MNG'nin OpenAPI zip'inin aksine, UPS'in
 * Tracking/Rating yanıt şemaları bu depoda indirilip tek tek doğrulanmadı —
 * UPS'in kamuya açık, uzun süredir stabil referans sayfalarına dayanıyor.
 *
 * `calculateRate` (`SupportsRateQuote`) bilerek implement edilmedi: UPS'in
 * Rating API'si doğru sonuç için posta kodu + ülke kodu ister, `RateQuoteData`
 * bu alanları içermiyor (`Address`'te `postalCode` var ama `RateQuoteData`'da
 * yok) — tahmini/eksik bir istek göndermek yerine bu yeteneği eklememeyi
 * seçtik.
 */
export class UpsProvider implements ShippingProvider {
  private token: { accessToken: string; expiresAt: number } | null = null;

  constructor(private readonly config: UpsProviderConfig) {}

  async createShipment(data: CreateShipmentData): Promise<ShipmentResponse> {
    const shipperAddress = toUpsAddress(data.sender);
    const receiverAddress = toUpsAddress(data.receiver);

    const response = await this.request<UpsShipmentResponseBody>('POST', '/api/shipments/v2409/ship', {
      ShipmentRequest: {
        Request: {
          RequestOption: 'nonvalidate',
          TransactionReference: { CustomerContext: data.referenceId },
        },
        Shipment: {
          Description: data.note || data.parcel.content || 'Shipment',
          Shipper: { ...shipperAddress, ShipperNumber: this.config.accountNumber },
          ShipTo: receiverAddress,
          ShipFrom: shipperAddress,
          PaymentInformation: {
            ShipmentCharge: { Type: '01', BillShipper: { AccountNumber: this.config.accountNumber } },
          },
          Service: { Code: this.config.serviceCode ?? '03' },
          Package: [
            {
              Packaging: { Code: '02' },
              PackageWeight: {
                UnitOfMeasurement: { Code: 'KGS' },
                Weight: String(Math.max(1, Math.ceil(data.parcel.weightGrams / 1000))),
              },
            },
          ],
        },
        LabelSpecification: { LabelImageFormat: { Code: 'GIF' } },
      },
    });

    const results = response.ShipmentResponse.ShipmentResults;

    return new ShipmentResponse(results.ShipmentIdentificationNumber, data.referenceId, undefined, response);
  }

  /** UPS Track API'nin `GET /track/v1/details/{inquiryNumber}` uç noktasını kullanır. */
  async trackShipment(trackingNumber: string): Promise<TrackingResponse> {
    const response = await this.request<UpsTrackResponseBody>(
      'GET',
      `/api/track/v1/details/${encodeURIComponent(trackingNumber)}`,
    );

    const shipment = response.trackResponse.shipment.at(0);
    const activities = shipment?.package.at(0)?.activity ?? [];

    const events = activities.map(
      (activity) =>
        new TrackingEvent(
          parseUpsActivityDate(activity.date, activity.time),
          activity.status.description,
          activity.location?.address?.city,
        ),
    );

    const status = activities.at(0) ? mapUpsStatusType(activities[0]!.status.type) : ShipmentStatus.Unknown;

    return new TrackingResponse(trackingNumber, status, events, response);
  }

  /** UPS Void Shipping API'nin `DELETE /shipments/{version}/void/cancel/{id}` uç noktasını kullanır. */
  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    const response = await this.request<UpsVoidResponseBody>(
      'DELETE',
      `/api/shipments/v2409/void/cancel/${encodeURIComponent(trackingNumber)}`,
    );

    const cancelled = response.VoidShipmentResponse.SummaryResult?.Status.Code === '1';

    return new CancelShipmentResponse(trackingNumber, cancelled, response);
  }

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.accessToken;
    }

    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');

    const res = await fetch(`${this.baseUrl}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      throw new ShipmentFailedError(`UPS token alınamadı (HTTP ${res.status})`, { status: res.status });
    }

    const json = (await res.json()) as UpsTokenResponse;
    this.token = {
      accessToken: json.access_token,
      expiresAt: Date.now() + Number(json.expires_in) * 1000,
    };

    return this.token.accessToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const accessToken = await this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        transId: cryptoRandomId(),
        transactionSrc: 'anadoluship',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      throw new ShipmentFailedError(`UPS API hatası (HTTP ${res.status}) — ${path}`, {
        status: res.status,
        path,
        body: await res.text().catch(() => undefined),
      });
    }

    return (await res.json()) as T;
  }
}

function parseUpsActivityDate(date: string, time: string): Date {
  // UPS "yyyyMMdd" + "HHmmss" formatını döndürür.
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const second = Number(time.slice(4, 6));

  return new Date(year, month - 1, day, hour, minute, second);
}

function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 32);
}
