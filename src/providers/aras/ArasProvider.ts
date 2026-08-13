import { ShippingProvider } from '../../contracts/ShippingProvider.js';
import { CreateShipmentData } from '../../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../../dto/ShipmentResponse.js';
import { TrackingResponse } from '../../dto/TrackingResponse.js';
import { CancelShipmentResponse } from '../../dto/CancelShipmentResponse.js';
import { ShipmentFailedError } from '../../errors/AnadoluShipError.js';
import { escapeXml, firstOf, soapCall } from '../../support/soap/SoapClient.js';

export interface ArasProviderConfig {
  userName: string;
  password: string;
  /** Sandbox: https://customerservicestest.araskargo.com.tr (varsayılan). */
  baseUrl?: string;
}

interface ArasOrderResultInfo {
  ResultCode?: string;
  ResultMessage?: string;
  InvoiceKey?: string;
}

interface ArasCanceledShipmentInfo {
  /** fast-xml-parser `true`/`1` gibi değerleri otomatik olarak boolean/number'a çevirir. */
  SuccessFlag?: string | boolean | number;
  OperationCode?: string;
  CargoKey?: string;
  InvoiceKey?: string;
  OperationMessage?: string;
}

const NS = 'http://tempuri.org/';
const DEFAULT_BASE_URL = 'https://customerservicestest.araskargo.com.tr';
const SERVICE_PATH = '/arascargoservice/arascargoservice.asmx';

/**
 * Aras Kargo Driver
 *
 * `customerservicestest.araskargo.com.tr/arascargoservice/arascargoservice.asmx?WSDL`
 * (herkese açık, kimlik doğrulama gerektirmeden indirildi — dikkat: yol
 * büyük/küçük harfe hassas, düz `arascargoservice.asmx` 404 döner, doğru
 * yol `/arascargoservice/arascargoservice.asmx`) üzerindeki `SetOrder` ve
 * `SetCanceledShipment` SOAP operasyonlarına göre yazıldı. **Hiçbir gerçek
 * Aras Kargo test hesabıyla ölçülmedi.**
 *
 * `trackShipment` bilerek implement edilmedi: WSDL'deki tek hareket/takip
 * operasyonu (`GetCargoTransaction`) bir ADO.NET DiffGram/DataSet
 * (`WEBCARGODATA13DataTable`) döndürüyor — WSDL şeması bu tabloya
 * `processContents="lax"` ile referans veriyor, yani sütun adları WSDL'de
 * tanımlı değil. Gerçek bir örnek yanıt görmeden sütun adlarını tahmin
 * edip kod yazmak, bu projenin kaçındığı türden bir varsayımdır.
 *
 * `ResultCode`/`SuccessFlag` alanlarının hangi değerin "başarı" anlamına
 * geldiği WSDL'de belgelenmiyor — gerçek bir yanıt örneği görülene kadar
 * bu alanlar üzerinden hata fırlatılmıyor, ham yanıt `raw` alanında
 * döndürülüyor.
 */
export class ArasProvider implements ShippingProvider {
  constructor(private readonly config: ArasProviderConfig) {}

  async createShipment(data: CreateShipmentData): Promise<ShipmentResponse> {
    const kg = Math.max(0.1, data.parcel.weightGrams / 1000);
    const desi = data.parcel.desi ?? kg;

    const body = await this.call('SetOrder', `
<tem:SetOrder xmlns:tem="${NS}">
  <tem:orderInfo>
    <tem:Order>
      <tem:UserName>${escapeXml(this.config.userName)}</tem:UserName>
      <tem:Password>${escapeXml(this.config.password)}</tem:Password>
      <tem:IntegrationCode>${escapeXml(data.referenceId)}</tem:IntegrationCode>
      <tem:ReceiverName>${escapeXml(data.receiver.fullName)}</tem:ReceiverName>
      <tem:ReceiverAddress>${escapeXml(data.receiver.addressLine)}</tem:ReceiverAddress>
      <tem:ReceiverPhone1>${escapeXml(data.receiver.phone)}</tem:ReceiverPhone1>
      <tem:ReceiverCityName>${escapeXml(data.receiver.city)}</tem:ReceiverCityName>
      <tem:ReceiverTownName>${escapeXml(data.receiver.district)}</tem:ReceiverTownName>
      <tem:VolumetricWeight>${desi}</tem:VolumetricWeight>
      <tem:Weight>${kg}</tem:Weight>
      <tem:PieceCount>${data.parcel.pieceCount}</tem:PieceCount>
      <tem:Description>${escapeXml(data.note ?? data.parcel.content ?? '')}</tem:Description>
    </tem:Order>
  </tem:orderInfo>
  <tem:userName>${escapeXml(this.config.userName)}</tem:userName>
  <tem:password>${escapeXml(this.config.password)}</tem:password>
</tem:SetOrder>`);

    const result = (body.SetOrderResponse as Record<string, unknown> | undefined)?.SetOrderResult as
      | Record<string, unknown>
      | undefined;
    const detail = firstOf<ArasOrderResultInfo>(result?.OrderResultInfo as never);

    return new ShipmentResponse(detail?.InvoiceKey ?? data.referenceId, data.referenceId, undefined, result);
  }

  async trackShipment(_trackingNumber: string): Promise<TrackingResponse> {
    throw new ShipmentFailedError(
      "ArasProvider henüz trackShipment implement etmiyor — WSDL'deki tek hareket sorgusu " +
        '(GetCargoTransaction) sütun adları tanımsız bir ADO.NET DiffGram döndürüyor, gerçek bir ' +
        'örnek yanıt görmeden alan adlarını tahmin etmemeyi seçtik.',
      { driver: 'aras', capability: 'trackShipment' },
    );
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    const body = await this.call('SetCanceledShipment', `
<tem:SetCanceledShipment xmlns:tem="${NS}">
  <tem:userName>${escapeXml(this.config.userName)}</tem:userName>
  <tem:password>${escapeXml(this.config.password)}</tem:password>
  <tem:language>TR</tem:language>
  <tem:cargoKey>
    <tem:string>${escapeXml(trackingNumber)}</tem:string>
  </tem:cargoKey>
</tem:SetCanceledShipment>`);

    const result = (body.SetCanceledShipmentResponse as Record<string, unknown> | undefined)
      ?.SetCanceledShipmentResult as Record<string, unknown> | undefined;
    const detail = firstOf<ArasCanceledShipmentInfo>(result?.CanceledShipmentInfo as never);
    const cancelled = detail?.SuccessFlag === true || detail?.SuccessFlag === 'true' || detail?.SuccessFlag === '1';

    return new CancelShipmentResponse(trackingNumber, cancelled, result);
  }

  private get endpoint(): string {
    return `${this.config.baseUrl ?? DEFAULT_BASE_URL}${SERVICE_PATH}`;
  }

  private async call(operation: string, bodyXml: string): Promise<Record<string, unknown>> {
    return soapCall({ url: this.endpoint, soapAction: `${NS}${operation}`, bodyXml });
  }
}
