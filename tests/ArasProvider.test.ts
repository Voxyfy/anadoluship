import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArasProvider } from '../src/providers/aras/ArasProvider.js';
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
 * ArasProvider'ı gerçek `fetch`'i mock'layarak test eder — bir Aras Kargo
 * test hesabı gerektirmez. WSDL'den çıkardığımız gerçek eleman adlarına
 * (SetOrder/SetCanceledShipment) göre kod tarafının doğru SOAP isteği
 * ürettiğini doğrular.
 */
describe('ArasProvider (mocked HTTP)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createProvider(): ArasProvider {
    return new ArasProvider({ userName: 'aras-user', password: 'aras-pass' });
  }

  it('sends SetOrder with the http://tempuri.org/SetOrder SOAPAction', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<SetOrderResponse xmlns="http://tempuri.org/">
<SetOrderResult>
<OrderResultInfo>
<ResultCode>0</ResultCode>
<ResultMessage>Başarılı</ResultMessage>
<InvoiceKey>ARAS-INV-1</InvoiceKey>
</OrderResultInfo>
</SetOrderResult>
</SetOrderResponse>`),
    );

    const result = await createProvider().createShipment(
      new CreateShipmentData(
        'ORDER-1',
        new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
        new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
        new Parcel(2000, 2, 1),
      ),
    );

    expect(result.trackingNumber).toBe('ARAS-INV-1');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://customerservicestest.araskargo.com.tr/arascargoservice/arascargoservice.asmx');
    expect(init.headers.SOAPAction).toBe('http://tempuri.org/SetOrder');
    expect(init.body).toContain('<tem:IntegrationCode>ORDER-1</tem:IntegrationCode>');
  });

  it('throws trackShipment as not-implemented, without any network call', async () => {
    await expect(createProvider().trackShipment('ARAS-INV-1')).rejects.toThrow(/trackShipment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends SetCanceledShipment and reports success when SuccessFlag is "true"', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<SetCanceledShipmentResponse xmlns="http://tempuri.org/">
<SetCanceledShipmentResult>
<CanceledShipmentInfo>
<SuccessFlag>true</SuccessFlag>
<CargoKey>ARAS-INV-1</CargoKey>
</CanceledShipmentInfo>
</SetCanceledShipmentResult>
</SetCanceledShipmentResponse>`),
    );

    const result = await createProvider().cancelShipment('ARAS-INV-1');

    expect(result.cancelled).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.SOAPAction).toBe('http://tempuri.org/SetCanceledShipment');
  });
});
