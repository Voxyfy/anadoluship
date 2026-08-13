import { ShippingProvider } from '../../contracts/ShippingProvider.js';
import { CreateShipmentData } from '../../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../../dto/ShipmentResponse.js';
import { TrackingResponse } from '../../dto/TrackingResponse.js';
import { CancelShipmentResponse } from '../../dto/CancelShipmentResponse.js';
import { ShipmentStatus } from '../../support/ShipmentStatus.js';
import { ShipmentFailedError } from '../../errors/AnadoluShipError.js';
import { escapeXml, firstOf, soapCall } from '../../support/soap/SoapClient.js';

export interface YurticiProviderConfig {
  wsUserName: string;
  wsPassword: string;
  /**
   * Hesabınıza bağlı, gönderiden bağımsız sabit değerler — Yurtiçi Kargo
   * WSDL'inde `ShippingOrderVO` üzerinde zorunlu (`minOccurs` belirtilmemiş)
   * alanlar olarak tanımlı; sözleşmenizden/entegrasyon ekibinizden alınır.
   */
  taxOfficeId: number;
  ttDocumentId: number;
  dcSelectedCredit: number;
  dcCreditRule: number;
  /** Sandbox: http://testwebservices.yurticikargo.com:9090 (varsayılan). Prod: :8080. */
  baseUrl?: string;
}

interface YurticiDetailVO {
  cargoKey?: string;
  errCode?: number | string;
  errMessage?: string;
  invoiceKey?: string;
  operationStatus?: string;
}

const DEFAULT_BASE_URL = 'http://testwebservices.yurticikargo.com:9090';
const SERVICE_PATH = '/KOPSWebServices/ShippingOrderDispatcherServices';
const NS = 'http://yurticikargo.com.tr/ShippingOrderDispatcherServices';

/**
 * Yurtiçi Kargo'nun `operationStatus` alanı için WSDL'de enum/açıklama yok
 * ve gerçek bir örnek yanıt görmedik — bu eşleme **tahminidir, doğrulanmadı**.
 * Gerçek sandbox'a karşı ölçülene kadar temkinli davranın.
 */
function mapYurticiOperationStatus(status: string | undefined): ShipmentStatus {
  if (!status) {
    return ShipmentStatus.Unknown;
  }

  const normalized = status.toLocaleUpperCase('tr');

  if (normalized.includes('TESLIM EDILEMEDI') || normalized.includes('İADE')) {
    return ShipmentStatus.Exception;
  }
  if (normalized.includes('TESLIM')) {
    return ShipmentStatus.Delivered;
  }
  if (normalized.includes('IPTAL')) {
    return ShipmentStatus.Cancelled;
  }
  if (normalized.includes('DAGITIM') || normalized.includes('TRANSFER') || normalized.includes('SUBE')) {
    return ShipmentStatus.InTransit;
  }

  return ShipmentStatus.Unknown;
}

/**
 * Yurtiçi Kargo Driver
 *
 * Yurtiçi Kargo'nun kendi test/prod WSDL'lerinden (herkese açık, kimlik
 * doğrulama gerektirmeden indirildi — `?wsdl` sorgu parametresiyle)
 * doğrudan çıkarılan `createShipment`/`queryShipment`/`cancelShipment`
 * SOAP operasyonlarına göre yazıldı. **Hiçbir gerçek Yurtiçi Kargo test
 * hesabıyla ölçülmedi** — `wsUserName`/`wsPassword` başvuru gerektiriyor.
 *
 * WSDL, document/literal stilinde ve tüm operasyonlarda `soapAction=''`
 * (boş) kullanıyor — ayrım gövdedeki eleman adına göre yapılıyor.
 *
 * `trackShipment` sadece `queryShipment`'ın döndürdüğü **anlık durumu**
 * yansıtır — WSDL'de MNG/UPS'teki gibi ayrı bir hareket/olay listesi
 * (activity log) alanı yok, bu yüzden `TrackingResponse.events` her zaman
 * boş döner.
 */
export class YurticiProvider implements ShippingProvider {
  constructor(private readonly config: YurticiProviderConfig) {}

  async createShipment(data: CreateShipmentData): Promise<ShipmentResponse> {
    const kg = Math.max(0.1, data.parcel.weightGrams / 1000);
    const desi = data.parcel.desi ?? kg;

    const body = await this.call(`
<tns:createShipment xmlns:tns="${NS}">
  <wsUserName>${escapeXml(this.config.wsUserName)}</wsUserName>
  <wsPassword>${escapeXml(this.config.wsPassword)}</wsPassword>
  <userLanguage>TR</userLanguage>
  <ShippingOrderVO>
    <cargoKey>${escapeXml(data.referenceId)}</cargoKey>
    <invoiceKey>${escapeXml(data.referenceId)}</invoiceKey>
    <receiverCustName>${escapeXml(data.receiver.fullName)}</receiverCustName>
    <receiverAddress>${escapeXml(data.receiver.addressLine)}</receiverAddress>
    <cityName>${escapeXml(data.receiver.city)}</cityName>
    <townName>${escapeXml(data.receiver.district)}</townName>
    <receiverPhone1>${escapeXml(data.receiver.phone)}</receiverPhone1>
    <emailAddress>${escapeXml(data.receiver.email ?? '')}</emailAddress>
    <taxOfficeId>${this.config.taxOfficeId}</taxOfficeId>
    <desi>${desi}</desi>
    <kg>${kg}</kg>
    <cargoCount>${data.parcel.pieceCount}</cargoCount>
    <description>${escapeXml(data.note ?? data.parcel.content ?? '')}</description>
    <ttDocumentId>${this.config.ttDocumentId}</ttDocumentId>
    <dcSelectedCredit>${this.config.dcSelectedCredit}</dcSelectedCredit>
    <dcCreditRule>${this.config.dcCreditRule}</dcCreditRule>
  </ShippingOrderVO>
</tns:createShipment>`);

    const result = this.unwrap(body, 'createShipmentResponse', 'ShippingOrderResultVO');
    const detail = firstOf<YurticiDetailVO>(result?.shippingOrderDetailVO as never);

    if (detail?.errCode && Number(detail.errCode) !== 0) {
      throw new ShipmentFailedError(`Yurtiçi Kargo hatası: ${detail.errMessage ?? detail.errCode}`, {
        errCode: detail.errCode,
      });
    }

    return new ShipmentResponse(detail?.cargoKey ?? data.referenceId, data.referenceId, undefined, result);
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResponse> {
    const body = await this.call(`
<tns:queryShipment xmlns:tns="${NS}">
  <wsUserName>${escapeXml(this.config.wsUserName)}</wsUserName>
  <wsPassword>${escapeXml(this.config.wsPassword)}</wsPassword>
  <wsLanguage>TR</wsLanguage>
  <keys>${escapeXml(trackingNumber)}</keys>
  <keyType>0</keyType>
  <addHistoricalData>true</addHistoricalData>
  <onlyTracking>false</onlyTracking>
</tns:queryShipment>`);

    const result = this.unwrap(body, 'queryShipmentResponse', 'ShippingDeliveryVO');
    const detail = firstOf<YurticiDetailVO>(result?.shippingDeliveryDetailVO as never);

    return new TrackingResponse(trackingNumber, mapYurticiOperationStatus(detail?.operationStatus), [], result);
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    const body = await this.call(`
<tns:cancelShipment xmlns:tns="${NS}">
  <wsUserName>${escapeXml(this.config.wsUserName)}</wsUserName>
  <wsPassword>${escapeXml(this.config.wsPassword)}</wsPassword>
  <userLanguage>TR</userLanguage>
  <cargoKeys>${escapeXml(trackingNumber)}</cargoKeys>
</tns:cancelShipment>`);

    const result = this.unwrap(body, 'cancelShipmentResponse', 'ShippingOrderResultVO');
    const detail = firstOf<YurticiDetailVO>(result?.shippingCancelDetailVO as never);
    const cancelled = !detail?.errCode || Number(detail.errCode) === 0;

    return new CancelShipmentResponse(trackingNumber, cancelled, result);
  }

  private get endpoint(): string {
    return `${this.config.baseUrl ?? DEFAULT_BASE_URL}${SERVICE_PATH}`;
  }

  private async call(bodyXml: string): Promise<Record<string, unknown>> {
    return soapCall({ url: this.endpoint, soapAction: '', bodyXml });
  }

  /** `queryShipmentResponse.ShippingDeliveryVO` gibi iç içe sarmalayıcıları tek noktadan çözer. */
  private unwrap(
    body: Record<string, unknown>,
    responseElement: string,
    resultField: string,
  ): Record<string, unknown> | undefined {
    const response = (body[responseElement] ?? body) as Record<string, unknown> | undefined;

    return (response?.[resultField] ?? response) as Record<string, unknown> | undefined;
  }
}
