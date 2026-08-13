import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YurticiProvider } from '../src/providers/yurtici/YurticiProvider.js';
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
 * YurticiProvider'ı gerçek `fetch`'i mock'layarak test eder — bir Yurtiçi
 * Kargo test hesabı gerektirmez. WSDL'den (kimlik doğrulama gerektirmeden
 * herkese açık indirildi) çıkardığımız gerçek istek/yanıt eleman adlarına
 * göre kod tarafının doğru SOAP zarfı ürettiğini ve yanıtı doğru
 * ayrıştırdığını doğrular.
 */
describe('YurticiProvider (mocked HTTP)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createProvider(): YurticiProvider {
    return new YurticiProvider({
      wsUserName: 'ws-user',
      wsPassword: 'ws-pass',
      taxOfficeId: 1,
      ttDocumentId: 1,
      dcSelectedCredit: 1,
      dcCreditRule: 1,
    });
  }

  it('sends createShipment with an empty SOAPAction and parses ShippingOrderResultVO', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<createShipmentResponse xmlns="http://yurticikargo.com.tr/ShippingOrderDispatcherServices">
<ShippingOrderResultVO>
<outFlag>S</outFlag>
<outResult>Success</outResult>
<errCode>0</errCode>
<count>1</count>
<jobId>123</jobId>
<shippingOrderDetailVO>
<cargoKey>ORDER-1</cargoKey>
<errCode>0</errCode>
<invoiceKey>ORDER-1</invoiceKey>
</shippingOrderDetailVO>
</ShippingOrderResultVO>
</createShipmentResponse>`),
    );

    const result = await createProvider().createShipment(
      new CreateShipmentData(
        'ORDER-1',
        new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
        new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
        new Parcel(2000, 2, 3),
      ),
    );

    expect(result.trackingNumber).toBe('ORDER-1');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://testwebservices.yurticikargo.com:9090/KOPSWebServices/ShippingOrderDispatcherServices');
    expect(init.headers.SOAPAction).toBe('');
    expect(init.body).toContain('<wsUserName>ws-user</wsUserName>');
    expect(init.body).toContain('<cargoCount>3</cargoCount>');
  });

  it('throws ShipmentFailedError when shippingOrderDetailVO.errCode is non-zero', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<createShipmentResponse xmlns="http://yurticikargo.com.tr/ShippingOrderDispatcherServices">
<ShippingOrderResultVO>
<shippingOrderDetailVO>
<cargoKey>ORDER-1</cargoKey>
<errCode>12</errCode>
<errMessage>Geçersiz vergi dairesi</errMessage>
</shippingOrderDetailVO>
</ShippingOrderResultVO>
</createShipmentResponse>`),
    );

    await expect(
      createProvider().createShipment(
        new CreateShipmentData(
          'ORDER-1',
          new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
          new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
          new Parcel(1000, 1),
        ),
      ),
    ).rejects.toThrow(/Geçersiz vergi dairesi/);
  });

  it('maps operationStatus to a normalized status in trackShipment', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<queryShipmentResponse xmlns="http://yurticikargo.com.tr/ShippingOrderDispatcherServices">
<ShippingDeliveryVO>
<shippingDeliveryDetailVO>
<cargoKey>ORDER-1</cargoKey>
<operationStatus>TESLIM EDILDI</operationStatus>
</shippingDeliveryDetailVO>
</ShippingDeliveryVO>
</queryShipmentResponse>`),
    );

    const result = await createProvider().trackShipment('ORDER-1');

    expect(result.status).toBe(ShipmentStatus.Delivered);
    expect(result.events).toEqual([]);
  });

  it('sends cancelShipment and reports success when errCode is absent', async () => {
    fetchMock.mockImplementationOnce(async () =>
      soapResponse(`
<cancelShipmentResponse xmlns="http://yurticikargo.com.tr/ShippingOrderDispatcherServices">
<ShippingOrderResultVO>
<shippingCancelDetailVO>
<cargoKey>ORDER-1</cargoKey>
</shippingCancelDetailVO>
</ShippingOrderResultVO>
</cancelShipmentResponse>`),
    );

    const result = await createProvider().cancelShipment('ORDER-1');

    expect(result.cancelled).toBe(true);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toContain('<cargoKeys>ORDER-1</cargoKeys>');
  });
});
