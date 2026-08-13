import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PttProvider } from '../src/providers/ptt/PttProvider.js';
import { Address } from '../src/dto/Address.js';
import { Parcel } from '../src/dto/Parcel.js';
import { CreateShipmentData } from '../src/dto/CreateShipmentData.js';
import { ShipmentStatus } from '../src/support/ShipmentStatus.js';

function soapResponse(xmlBody: string, ok = true, status = 200): Response {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body>
${xmlBody}
</soap:Body>
</soap:Envelope>`;

  return { ok, status, text: async () => envelope } as Response;
}

/**
 * PttProvider'ı gerçek `fetch`'i mock'layarak test eder — bir PTT test
 * hesabı gerektirmez (kurumsal sözleşme gerektiriyor, gerçek kişiye kapalı).
 * WSDL'den çıkardığımız gerçek `kabulEkle2`/`barkodVeriSil`/`barkodSorgu`
 * eleman adlarına göre kod tarafının doğru SOAP isteği ürettiğini doğrular.
 */
describe('PttProvider (mocked HTTP)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createProvider(): PttProvider {
    return new PttProvider({ musteriId: 12345, sifre: 'ptt-pass', kullanici: 'ptt-user' });
  }

  it('sends kabulEkle2 with SOAPAction urn:kabulEkle2 and returns the barkod as tracking number', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<kabulEkle2Response xmlns="http://kabul.ptt.gov.tr">
<return>
<hataKodu>0</hataKodu>
<dongu>
<barkod>PTT123456789</barkod>
<donguSonuc>true</donguSonuc>
<donguHataKodu>0</donguHataKodu>
</dongu>
</return>
</kabulEkle2Response>`),
    );

    const result = await createProvider().createShipment(
      new CreateShipmentData(
        'ORDER-1',
        new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
        new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
        new Parcel(2000, 2, 1),
      ),
    );

    expect(result.trackingNumber).toBe('PTT123456789');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://pttws.ptt.gov.tr/PttVeriYukleme/services/Sorgu');
    expect(init.headers.SOAPAction).toBe('urn:kabulEkle2');
    expect(init.body).toContain('<musteriId>12345</musteriId>');
  });

  it('throws ShipmentFailedError when donguSonuc is false', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<kabulEkle2Response xmlns="http://kabul.ptt.gov.tr">
<return>
<hataKodu>0</hataKodu>
<dongu>
<donguSonuc>false</donguSonuc>
<donguHataKodu>7</donguHataKodu>
<donguAciklama>Geçersiz il kodu</donguAciklama>
</dongu>
</return>
</kabulEkle2Response>`),
    );

    await expect(
      createProvider().createShipment(
        new CreateShipmentData(
          'ORDER-1',
          new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
          new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
          new Parcel(1000, 1, 1),
        ),
      ),
    ).rejects.toThrow(/Geçersiz il kodu/);
  });

  it('maps aliciTeslimTarih presence to Delivered in trackShipment', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<barkodSorguResponse xmlns="http://hareket.ptt.gov.tr">
<return>
<hataKodu>0</hataKodu>
<barkod>PTT123456789</barkod>
<kabulTarih>2026-01-01</kabulTarih>
<aliciTeslimAdSoyad>Alıcı Ali</aliciTeslimAdSoyad>
<aliciTeslimTarih>2026-01-03</aliciTeslimTarih>
<sonIslemAciklama>Teslim edildi</sonIslemAciklama>
<sonIslemTarih>2026-01-03</sonIslemTarih>
</return>
</barkodSorguResponse>`),
    );

    const result = await createProvider().trackShipment('PTT123456789');

    expect(result.status).toBe(ShipmentStatus.Delivered);
    expect(result.events).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://pttws.ptt.gov.tr/GonderiHareketV2/services/Sorgu');
    expect(init.headers.SOAPAction).toBe('urn:barkodSorgu');
  });

  it('sends barkodVeriSil and reports success when hataKodu is 0', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<barkodVeriSilResponse xmlns="http://kabul.ptt.gov.tr">
<return>
<hataKodu>0</hataKodu>
<aciklama>Silindi</aciklama>
</return>
</barkodVeriSilResponse>`),
    );

    const result = await createProvider().cancelShipment('PTT123456789');

    expect(result.cancelled).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.SOAPAction).toBe('urn:barkodVeriSil');
  });
});
