import { ShippingProvider } from '../../contracts/ShippingProvider.js';
import { CreateShipmentData } from '../../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../../dto/ShipmentResponse.js';
import { TrackingResponse } from '../../dto/TrackingResponse.js';
import { CancelShipmentResponse } from '../../dto/CancelShipmentResponse.js';
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

const DEFAULT_BASE_URL = 'https://testapi.mngkargo.com.tr';

/** MNG'nin "10.03.2020 16:05:00" (dd.MM.yyyy HH:mm:ss) formatını `Date.parse` anlamaz. */
function parseMngDate(value: string): number {
  const [datePart = '01.01.1970', timePart = '00:00:00'] = value.split(' ');
  const [day = 1, month = 1, year = 1970] = datePart.split('.').map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);

  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/**
 * MNG Kargo Driver
 *
 * Apizone (DHL eCommerce API Developer Portal, sandbox.mngkargo.com.tr)
 * üzerinde yayınlanan "Barcode Command API" (v1.0) ve "Identity API"
 * (v1.0) şemalarına karşı yazıldı. Henüz gerçek sandbox çağrısıyla
 * ölçülmedi — bkz. README'deki doğrulama durumu.
 *
 * Kimlik doğrulama iki katmanlı:
 * 1. Uygulama seviyesi: her istekte `X-IBM-Client-Id` / `X-IBM-Client-Secret`
 *    header'ları (Apizone'da oluşturduğunuz uygulamanın kimlik bilgileri).
 * 2. Hesap seviyesi: `/mngapi/api/token`'a müşteri numarası + şifre ile
 *    POST atıp alınan JWT, `Authorization: Bearer` header'ında gönderilir.
 *
 * `trackShipment` henüz implement edilmedi — MNG'nin takip/sorgu API'si
 * (Standard/Plus Query) ayrıca incelenmeli, burada tahmini şema yazıp
 * doğrulanmamış bir driver bırakmaktan kaçınıldı.
 */
export class MngProvider implements ShippingProvider {
  private token: { jwt: string; expiresAt: number } | null = null;

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

  async trackShipment(_trackingNumber: string): Promise<TrackingResponse> {
    throw new ShipmentFailedError(
      "MngProvider henüz trackShipment implement etmiyor — MNG'nin Query API'si (Standard/Plus Query) henüz incelenip doğrulanmadı.",
      { driver: 'mng', capability: 'trackShipment' },
    );
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    await this.request('PUT', '/mngapi/api/barcodecmdapi/cancelshipment', {
      referenceId: trackingNumber,
      shipmentId: trackingNumber,
    });

    return new CancelShipmentResponse(trackingNumber, true);
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
    this.token = { jwt: json.jwt, expiresAt: parseMngDate(json.jwtExpireDate) };

    return this.token.jwt;
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    const jwt = await this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-IBM-Client-Id': this.config.clientId,
        'X-IBM-Client-Secret': this.config.clientSecret,
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
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
