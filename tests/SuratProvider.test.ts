import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuratProvider } from '../src/providers/surat/SuratProvider.js';
import { Address } from '../src/dto/Address.js';
import { Parcel } from '../src/dto/Parcel.js';
import { CreateShipmentData } from '../src/dto/CreateShipmentData.js';

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
 * SuratProvider'ı gerçek `fetch`'i mock'layarak test eder — bir Sürat
 * Kargo hesabı gerektirmez. WSDL'den çıkardığımız gerçek eleman adlarına
 * (`OrtakBarkodOlustur`/`GonderiGeriCek`) göre kod tarafının doğru SOAP
 * isteği ürettiğini doğrular.
 */
describe('SuratProvider (mocked HTTP)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createProvider(): SuratProvider {
    return new SuratProvider({ kullaniciAdi: 'surat-user', sifre: 'surat-pass' });
  }

  it('sends OrtakBarkodOlustur and returns KargoTakipNo as the tracking number', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<OrtakBarkodOlusturResponse xmlns="http://tempuri.org/">
<OrtakBarkodOlusturResult>
<isError>false</isError>
<Message>OK</Message>
<KargoTakipNo>SURAT-123</KargoTakipNo>
</OrtakBarkodOlusturResult>
</OrtakBarkodOlusturResponse>`),
    );

    const result = await createProvider().createShipment(
      new CreateShipmentData(
        'ORDER-1',
        new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
        new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
        new Parcel(2000, 2, 1),
      ),
    );

    expect(result.trackingNumber).toBe('SURAT-123');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://webservices.suratkargo.com.tr/services.asmx');
    expect(init.headers.SOAPAction).toBe('http://tempuri.org/OrtakBarkodOlustur');
  });

  it('throws ShipmentFailedError when isError is true', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<OrtakBarkodOlusturResponse xmlns="http://tempuri.org/">
<OrtakBarkodOlusturResult>
<isError>true</isError>
<Message>Geçersiz il/ilçe</Message>
</OrtakBarkodOlusturResult>
</OrtakBarkodOlusturResponse>`),
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
    ).rejects.toThrow(/Geçersiz il\/ilçe/);
  });

  it('throws trackShipment as not-implemented, without any network call', async () => {
    await expect(createProvider().trackShipment('SURAT-123')).rejects.toThrow(/trackShipment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an empty GonderiGeriCekResult as a successful cancellation', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<GonderiGeriCekResponse xmlns="http://tempuri.org/">
<GonderiGeriCekResult></GonderiGeriCekResult>
</GonderiGeriCekResponse>`),
    );

    const result = await createProvider().cancelShipment('SURAT-123');

    expect(result.cancelled).toBe(true);
  });
});
