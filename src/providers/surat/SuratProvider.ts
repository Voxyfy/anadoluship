import { ShippingProvider } from '../../contracts/ShippingProvider.js';
import { CreateShipmentData } from '../../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../../dto/ShipmentResponse.js';
import { TrackingResponse } from '../../dto/TrackingResponse.js';
import { CancelShipmentResponse } from '../../dto/CancelShipmentResponse.js';
import { ShipmentFailedError } from '../../errors/AnadoluShipError.js';
import { escapeXml, soapCall } from '../../support/soap/SoapClient.js';

export interface SuratProviderConfig {
  kullaniciAdi: string;
  sifre: string;
  /**
   * `GonderiModel`'in zorunlu (`minOccurs='1'`) enum alanları — WSDL bu
   * kodların anlamını açıklamıyor, gerçek değerler hesap/panel
   * dokümantasyonundan alınmalı. Varsayılanlar sadece derlensin diye
   * konuldu, **doğrulanmadı**.
   */
  kargoTuru?: number;
  odemeTipi?: number;
  /** Sandbox yok — Sürat Kargo'da test/prod ayrımı bulunmuyor, tüm çağrılar gerçek ortama gider. */
  baseUrl?: string;
}

interface SuratResultMesaj {
  isError?: boolean | string;
  Message?: string;
  KargoTakipNo?: string;
}

const NS = 'http://tempuri.org/';
const DEFAULT_BASE_URL = 'https://webservices.suratkargo.com.tr';
const SERVICE_PATH = '/services.asmx';

/**
 * Sürat Kargo Driver
 *
 * `webservices.suratkargo.com.tr/services.asmx?wsdl` (herkese açık,
 * kimlik doğrulama gerektirmeden indirildi) üzerindeki `OrtakBarkodOlustur`
 * ve `GonderiGeriCek` SOAP operasyonlarına göre yazıldı. **Hiçbir gerçek
 * Sürat Kargo hesabıyla ölçülmedi** — ayrıca Sürat Kargo'nun test/sandbox
 * ortamı yok, tek ortam prod.
 *
 * `trackShipment` bilerek implement edilmedi: WSDL'deki tüm takip
 * operasyonları (`KargoTakipHareketDetayli`, `...V2`, `WebSiparisKoduToplu`
 * vb.), yapısı tanımsız düz bir `string` döndürüyor — WSDL şeması bu
 * string'in içeriğini (düz metin mi, gömülü XML mi, DataSet mi) tanımlamıyor.
 * Gerçek bir örnek yanıt görmeden bunu ayrıştırmaya çalışmak tahmine dayalı
 * olur, o yüzden bilerek atlandı.
 *
 * `cancelShipment` (`GonderiGeriCek`) de aynı şekilde düz `string` döner;
 * başarı/hata ayrımı için belgelenmiş bir kural yok. Burada **temkinli bir
 * sezgisel** kullanılıyor: yanıt boşsa veya "hata"/"error" kelimesi
 * geçmiyorsa başarılı sayılıyor — bu doğrulanmadı, gerçek sandbox
 * yanıtlarıyla karşılaştırılmalı.
 */
export class SuratProvider implements ShippingProvider {
  constructor(private readonly config: SuratProviderConfig) {}

  async createShipment(data: CreateShipmentData): Promise<ShipmentResponse> {
    const kg = Math.max(0.1, data.parcel.weightGrams / 1000);
    const desi = data.parcel.desi ?? kg;

    const body = await this.call('OrtakBarkodOlustur', `
<tem:OrtakBarkodOlustur xmlns:tem="${NS}">
  <tem:KullaniciAdi>${escapeXml(this.config.kullaniciAdi)}</tem:KullaniciAdi>
  <tem:Sifre>${escapeXml(this.config.sifre)}</tem:Sifre>
  <tem:Gonderi>
    <tem:KisiKurum>${escapeXml(data.receiver.fullName)}</tem:KisiKurum>
    <tem:AliciAdresi>${escapeXml(data.receiver.addressLine)}</tem:AliciAdresi>
    <tem:Il>${escapeXml(data.receiver.city)}</tem:Il>
    <tem:Ilce>${escapeXml(data.receiver.district)}</tem:Ilce>
    <tem:TelefonCep>${escapeXml(data.receiver.phone)}</tem:TelefonCep>
    <tem:Email>${escapeXml(data.receiver.email ?? '')}</tem:Email>
    <tem:KargoTuru>${this.config.kargoTuru ?? 1}</tem:KargoTuru>
    <tem:OdemeTipi>${this.config.odemeTipi ?? 1}</tem:OdemeTipi>
    <tem:ReferansNo>${escapeXml(data.referenceId)}</tem:ReferansNo>
    <tem:OzelKargoTakipNo>${escapeXml(data.referenceId)}</tem:OzelKargoTakipNo>
    <tem:Adet>${data.parcel.pieceCount}</tem:Adet>
    <tem:BirimDesi>${desi}</tem:BirimDesi>
    <tem:BirimKg>${kg}</tem:BirimKg>
    <tem:KargoIcerigi>${escapeXml(data.parcel.content ?? '')}</tem:KargoIcerigi>
    <tem:KapidanOdemeTahsilatTipi>${data.cashOnDeliveryAmount ? 1 : 0}</tem:KapidanOdemeTahsilatTipi>
  </tem:Gonderi>
</tem:OrtakBarkodOlustur>`);

    const result = (body.OrtakBarkodOlusturResponse as Record<string, unknown> | undefined)
      ?.OrtakBarkodOlusturResult as SuratResultMesaj | undefined;

    if (result?.isError === true || result?.isError === 'true') {
      throw new ShipmentFailedError(`Sürat Kargo hatası: ${result.Message ?? 'bilinmiyor'}`, {
        message: result.Message,
      });
    }

    return new ShipmentResponse(result?.KargoTakipNo ?? data.referenceId, data.referenceId, undefined, result);
  }

  async trackShipment(_trackingNumber: string): Promise<TrackingResponse> {
    throw new ShipmentFailedError(
      "SuratProvider henüz trackShipment implement etmiyor — WSDL'deki tüm takip operasyonları " +
        'yapısı tanımsız düz bir string döndürüyor, gerçek bir örnek yanıt görmeden ayrıştırmayı ' +
        'denemedik.',
      { driver: 'surat', capability: 'trackShipment' },
    );
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    const body = await this.call('GonderiGeriCek', `
<tem:GonderiGeriCek xmlns:tem="${NS}">
  <tem:KullaniciAdi>${escapeXml(this.config.kullaniciAdi)}</tem:KullaniciAdi>
  <tem:Sifre>${escapeXml(this.config.sifre)}</tem:Sifre>
  <tem:OzelKargoTakipNo>${escapeXml(trackingNumber)}</tem:OzelKargoTakipNo>
  <tem:IptalNeden>anadoluship</tem:IptalNeden>
</tem:GonderiGeriCek>`);

    const resultText = String(
      (body.GonderiGeriCekResponse as Record<string, unknown> | undefined)?.GonderiGeriCekResult ?? '',
    );
    const cancelled = resultText.length === 0 || !/hata|error/i.test(resultText);

    return new CancelShipmentResponse(trackingNumber, cancelled, resultText);
  }

  private get endpoint(): string {
    return `${this.config.baseUrl ?? DEFAULT_BASE_URL}${SERVICE_PATH}`;
  }

  private async call(operation: string, bodyXml: string): Promise<Record<string, unknown>> {
    return soapCall({ url: this.endpoint, soapAction: `${NS}${operation}`, bodyXml });
  }
}
