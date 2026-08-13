import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MngProvider } from '../src/providers/mng/MngProvider.js';
import { Address } from '../src/dto/Address.js';
import { Parcel } from '../src/dto/Parcel.js';
import { CreateShipmentData } from '../src/dto/CreateShipmentData.js';
import { RateQuoteData } from '../src/dto/RateQuoteData.js';
import { ShipmentStatus } from '../src/support/ShipmentStatus.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/**
 * MngProvider'ı gerçek `fetch`'i mock'layarak test eder — bir MNG test
 * müşteri hesabı gerektirmez. Bu testler, Apizone'daki gerçek OpenAPI
 * şemalarından çıkardığımız istek/yanıt biçimlerinin kod tarafında doğru
 * işlendiğini doğrular; MNG'nin sandbox'ının bizim gönderdiğimiz isteği
 * gerçekte kabul ettiğini DOĞRULAMAZ — o adım için bkz.
 * `MngProvider.live.test.ts` ve README "MNG ile başlarken".
 */
describe('MngProvider (mocked HTTP)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createProvider(): MngProvider {
    return new MngProvider({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      customerNumber: '312947702',
      password: 'ABCD1234',
    });
  }

  function mockTokenOnce(): void {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({
        jwt: 'test-jwt',
        refreshToken: 'refresh-token',
        jwtExpireDate: '01.01.2099 00:00:00',
        refreshTokenExpireDate: '01.01.2099 00:00:00',
      }),
    );
  }

  it('fetches a JWT once and reuses it, sending client + bearer headers on createShipment', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ referenceId: 'ORDER-1', invoiceId: 'INV-1', shipmentId: 'SHIP-1', barcodes: [] }),
    );

    const result = await createProvider().createShipment(
      new CreateShipmentData(
        'ORDER-1',
        new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
        new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
        new Parcel(2000, 2),
      ),
    );

    expect(result.trackingNumber).toBe('SHIP-1');
    expect(result.referenceId).toBe('ORDER-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://testapi.mngkargo.com.tr/mngapi/api/token');
    expect(tokenInit.headers['X-IBM-Client-Id']).toBe('client-id');
    expect(tokenInit.headers['X-IBM-Client-Secret']).toBe('client-secret');
    expect(JSON.parse(tokenInit.body)).toEqual({
      customerNumber: '312947702',
      password: 'ABCD1234',
      identityType: 1,
    });

    const [createUrl, createInit] = fetchMock.mock.calls[1]!;
    expect(createUrl).toBe('https://testapi.mngkargo.com.tr/mngapi/api/barcodecmdapi/createbarcode');
    expect(createInit.headers.Authorization).toBe('Bearer test-jwt');
    const body = JSON.parse(createInit.body);
    expect(body.referenceId).toBe('ORDER-1');
    expect(body.orderPieceList[0].kg).toBe(2);
  });

  it('maps MNG track events to a normalized TrackingResponse', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse([
        { eventStatus: 'Gönderi Hazırlandı', eventDateTime: '12-02-2019 20:30:45', location: 'Atalar Şube' },
        { eventStatus: 'Teslim Edildi', eventDateTime: '13-02-2019 14:56:00', location: 'İstanbul' },
      ]),
    );

    const result = await createProvider().trackShipment('SHIP-1');

    expect(result.events).toHaveLength(2);
    expect(result.status).toBe(ShipmentStatus.Delivered);
    const [, trackInit] = fetchMock.mock.calls[1]!;
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://testapi.mngkargo.com.tr/mngapi/api/standardqueryapi/trackshipmentByShipmentId/SHIP-1',
    );
    expect(trackInit.method).toBe('GET');
  });

  it('resolves city/district codes via CBS Info before calling /calculate', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () => jsonResponse([{ code: '34', name: 'İstanbul' }]));
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse([{ cityCode: '34', cityName: 'İstanbul', code: '541', name: 'Kadıköy' }]),
    );
    fetchMock.mockImplementationOnce(async () => jsonResponse({ finalTotal: 16.5 }));

    const result = await createProvider().calculateRate(
      new RateQuoteData('Ankara', 'İstanbul', new Parcel(1000, 1), 'Kadıköy'),
    );

    expect(result.amount).toBe(1650);
    expect(result.currency).toBe('TRY');

    const calculateCall = fetchMock.mock.calls.at(-1)!;
    expect(calculateCall[0]).toBe('https://testapi.mngkargo.com.tr/mngapi/api/standardqueryapi/calculate');
    const body = JSON.parse(calculateCall[1].body);
    expect(body.cityCode).toBe(34);
    expect(body.districtCode).toBe(541);
  });

  it('caches city/district codes across repeated calculateRate calls', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () => jsonResponse([{ code: '34', name: 'İstanbul' }]));
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse([{ cityCode: '34', cityName: 'İstanbul', code: '541', name: 'Kadıköy' }]),
    );
    fetchMock.mockImplementationOnce(async () => jsonResponse({ finalTotal: 10 }));
    fetchMock.mockImplementationOnce(async () => jsonResponse({ finalTotal: 12 }));

    const provider = createProvider();
    await provider.calculateRate(new RateQuoteData('Ankara', 'İstanbul', new Parcel(1000, 1), 'Kadıköy'));
    await provider.calculateRate(new RateQuoteData('Ankara', 'İstanbul', new Parcel(2000, 2), 'Kadıköy'));

    // token + getcities + getdistricts + calculate + calculate = 5, not 8
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('throws a clear error when receiverDistrict is missing, without any network call', async () => {
    await expect(
      createProvider().calculateRate(new RateQuoteData('Ankara', 'İstanbul', new Parcel(1000, 1))),
    ).rejects.toThrow(/receiverDistrict/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a PUT to /cancelshipment', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () => jsonResponse('OK'));

    const result = await createProvider().cancelShipment('SHIP-1');

    expect(result.cancelled).toBe(true);
    const [cancelUrl, cancelInit] = fetchMock.mock.calls[1]!;
    expect(cancelUrl).toBe('https://testapi.mngkargo.com.tr/mngapi/api/barcodecmdapi/cancelshipment');
    expect(cancelInit.method).toBe('PUT');
  });

  it('surfaces a ShipmentFailedError with status/body context on HTTP errors', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'boom' }, false, 500));

    await expect(createProvider().cancelShipment('SHIP-1')).rejects.toThrow(/HTTP 500/);
  });
});
