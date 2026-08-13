import { ShippingProvider } from '../../contracts/ShippingProvider.js';
import { CreateShipmentData } from '../../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../../dto/ShipmentResponse.js';
import { TrackingResponse } from '../../dto/TrackingResponse.js';
import { TrackingEvent } from '../../dto/TrackingEvent.js';
import { CancelShipmentResponse } from '../../dto/CancelShipmentResponse.js';
import { ShipmentStatus } from '../../support/ShipmentStatus.js';
import { ShipmentFailedError } from '../../errors/AnadoluShipError.js';
import { escapeXml, firstOf, soapCall } from '../../support/soap/SoapClient.js';

export interface PttProviderConfig {
  musteriId: number;
  sifre: string;
  kullanici: string;
  /**
   * `kabulEkle2` isteğinin zorunlu gördüğü toplu-yükleme alanları — WSDL bu
   * alanların anlamını/geçerli değerlerini açıklamıyor, kurumsal
   * sözleşmenizden alınmalı. Varsayılanlar sadece derlensin diye konuldu,
   * **doğrulanmadı**.
   */
  dosyaAdi?: string;
  gonderiTip?: string;
  gonderiTur?: string;
  /** Kabul (create/cancel) servisi. Varsayılan: pttws.ptt.gov.tr (tek ortam — PTT'nin ayrı bir sandbox'ı olup olmadığı doğrulanamadı). */
  kabulBaseUrl?: string;
  /** Hareket (tracking) servisi. */
  hareketBaseUrl?: string;
}

interface PttOutputDongu2 {
  barkod?: string;
  donguAciklama?: string;
  donguHataKodu?: number;
  donguSonuc?: boolean;
}

interface PttOutputDetay {
  hataKodu?: number;
  aciklama?: string;
  barkod?: string;
  kabulTarih?: string;
  aliciTeslimAdSoyad?: string;
  aliciTeslimTarih?: string;
  sonIslemAciklama?: string;
  sonIslemTarih?: string;
  iadeTarih?: string;
  iadeNedeni?: string;
}

const DEFAULT_KABUL_BASE_URL = 'http://pttws.ptt.gov.tr';
const DEFAULT_HAREKET_BASE_URL = 'http://pttws.ptt.gov.tr';
const KABUL_PATH = '/PttVeriYukleme/services/Sorgu';
const HAREKET_PATH = '/GonderiHareketV2/services/Sorgu';
const KABUL_NS = 'http://kabul.ptt.gov.tr';
const HAREKET_NS = 'http://hareket.ptt.gov.tr';

function mapPttOutputDetayStatus(detail: PttOutputDetay | undefined): ShipmentStatus {
  if (!detail) {
    return ShipmentStatus.Unknown;
  }
  if (detail.aliciTeslimTarih) {
    return ShipmentStatus.Delivered;
  }
  if (detail.iadeTarih) {
    return ShipmentStatus.Returned;
  }
  if (detail.hataKodu && Number(detail.hataKodu) !== 0) {
    return ShipmentStatus.Exception;
  }
  if (detail.kabulTarih) {
    return ShipmentStatus.InTransit;
  }

  return ShipmentStatus.Unknown;
}

/**
 * PTT Kargo Driver
 *
 * PTT'nin iki farklı WSDL'inden (`PttVeriYukleme/services/Sorgu?wsdl` ve
 * `GonderiHareketV2/services/Sorgu?wsdl`, ikisi de kimlik doğrulama
 * gerektirmeden herkese açık indirildi) çıkardığımız gerçek `kabulEkle2`,
 * `barkodVeriSil` ve `barkodSorgu` SOAP operasyonlarına göre yazıldı.
 * **Hiçbir gerçek PTT test hesabıyla ölçülmedi** — kimlik bilgisi kurumsal
 * sözleşme gerektiriyor, gerçek kişiye kapalı.
 *
 * Önceki bir araştırmada bu operasyonların adı `PttVeriYukle2`/
 * `PttBarkodVeriSil` olarak not edilmişti — bunlar yanlıştı, üçüncü parti
 * bir PHP paketinin sınıf adlarıydı. WSDL'den doğrulanan gerçek SOAP
 * operasyon adları `kabulEkle2` ve `barkodVeriSil`'dir.
 *
 * `trackShipment`, `barkodSorgu`'nun döndürdüğü **anlık durumu**
 * yansıtır (Yurtiçi Kargo'daki gibi) — ayrı bir hareket/olay listesi yok,
 * bu yüzden `TrackingResponse.events` en fazla bir eleman içerir.
 */
export class PttProvider implements ShippingProvider {
  constructor(private readonly config: PttProviderConfig) {}

  async createShipment(data: CreateShipmentData): Promise<ShipmentResponse> {
    const body = await this.callKabul('kabulEkle2', `
<kabul:kabulEkle2 xmlns:kabul="${KABUL_NS}">
  <input>
    <musteriId>${this.config.musteriId}</musteriId>
    <sifre>${escapeXml(this.config.sifre)}</sifre>
    <kullanici>${escapeXml(this.config.kullanici)}</kullanici>
    <dosyaAdi>${escapeXml(this.config.dosyaAdi ?? 'anadoluship')}</dosyaAdi>
    <gonderiTip>${escapeXml(this.config.gonderiTip ?? '1')}</gonderiTip>
    <gonderiTur>${escapeXml(this.config.gonderiTur ?? '1')}</gonderiTur>
    <dongu>
      <aliciAdi>${escapeXml(data.receiver.fullName)}</aliciAdi>
      <aAdres>${escapeXml(data.receiver.addressLine)}</aAdres>
      <aliciIlAdi>${escapeXml(data.receiver.city)}</aliciIlAdi>
      <aliciIlceAdi>${escapeXml(data.receiver.district)}</aliciIlceAdi>
      <aliciTel>${escapeXml(data.receiver.phone)}</aliciTel>
      <aliciEmail>${escapeXml(data.receiver.email ?? '')}</aliciEmail>
      <agirlik>${Math.max(1, Math.round(data.parcel.weightGrams))}</agirlik>
      <desi>${data.parcel.desi ?? data.parcel.weightGrams / 1000}</desi>
      <musteriReferansNo>${escapeXml(data.referenceId)}</musteriReferansNo>
      <gondericibilgi>
        <gonderici_adi>${escapeXml(data.sender.fullName)}</gonderici_adi>
        <gonderici_adresi>${escapeXml(data.sender.addressLine)}</gonderici_adresi>
        <gonderici_il_ad>${escapeXml(data.sender.city)}</gonderici_il_ad>
        <gonderici_ilce_ad>${escapeXml(data.sender.district)}</gonderici_ilce_ad>
        <gonderici_telefonu>${escapeXml(data.sender.phone)}</gonderici_telefonu>
        <gonderici_email>${escapeXml(data.sender.email ?? '')}</gonderici_email>
      </gondericibilgi>
    </dongu>
  </input>
</kabul:kabulEkle2>`);

    const result = (body.kabulEkle2Response as Record<string, unknown> | undefined)?.return as
      | { hataKodu?: number; aciklama?: string; dongu?: PttOutputDongu2 | PttOutputDongu2[] }
      | undefined;
    const detail = firstOf<PttOutputDongu2>(result?.dongu);

    if (detail?.donguSonuc === false || (detail?.donguHataKodu && Number(detail.donguHataKodu) !== 0)) {
      throw new ShipmentFailedError(`PTT Kargo hatası: ${detail.donguAciklama ?? result?.aciklama ?? 'bilinmiyor'}`, {
        hataKodu: detail.donguHataKodu,
      });
    }

    return new ShipmentResponse(detail?.barkod ?? data.referenceId, data.referenceId, undefined, result);
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResponse> {
    const body = await this.callHareket('barkodSorgu', `
<hareket:barkodSorgu xmlns:hareket="${HAREKET_NS}">
  <input>
    <barkod>${escapeXml(trackingNumber)}</barkod>
    <musteri_no>${this.config.musteriId}</musteri_no>
    <sifre>${escapeXml(this.config.sifre)}</sifre>
    <kullanici>${escapeXml(this.config.kullanici)}</kullanici>
  </input>
</hareket:barkodSorgu>`);

    const detail = (body.barkodSorguResponse as Record<string, unknown> | undefined)?.return as
      | PttOutputDetay
      | undefined;

    const events: TrackingEvent[] = [];
    if (detail?.sonIslemTarih) {
      events.push(new TrackingEvent(new Date(detail.sonIslemTarih), detail.sonIslemAciklama ?? 'Son işlem'));
    }

    return new TrackingResponse(trackingNumber, mapPttOutputDetayStatus(detail), events, detail);
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    const body = await this.callKabul('barkodVeriSil', `
<kabul:barkodVeriSil xmlns:kabul="${KABUL_NS}">
  <inpDelete>
    <barcode>${escapeXml(trackingNumber)}</barcode>
    <dosyaAdi>${escapeXml(this.config.dosyaAdi ?? 'anadoluship')}</dosyaAdi>
    <musteriId>${this.config.musteriId}</musteriId>
    <sifre>${escapeXml(this.config.sifre)}</sifre>
  </inpDelete>
</kabul:barkodVeriSil>`);

    const result = (body.barkodVeriSilResponse as Record<string, unknown> | undefined)?.return as
      | { hataKodu?: number; aciklama?: string }
      | undefined;
    const cancelled = !result?.hataKodu || Number(result.hataKodu) === 0;

    return new CancelShipmentResponse(trackingNumber, cancelled, result);
  }

  private async callKabul(operation: string, bodyXml: string): Promise<Record<string, unknown>> {
    const url = `${this.config.kabulBaseUrl ?? DEFAULT_KABUL_BASE_URL}${KABUL_PATH}`;
    return soapCall({ url, soapAction: `urn:${operation}`, bodyXml });
  }

  private async callHareket(operation: string, bodyXml: string): Promise<Record<string, unknown>> {
    const url = `${this.config.hareketBaseUrl ?? DEFAULT_HAREKET_BASE_URL}${HAREKET_PATH}`;
    return soapCall({ url, soapAction: `urn:${operation}`, bodyXml });
  }
}
