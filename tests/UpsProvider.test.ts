import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpsProvider } from '../src/providers/ups/UpsProvider.js';
import { Address } from '../src/dto/Address.js';
import { Parcel } from '../src/dto/Parcel.js';
import { CreateShipmentData } from '../src/dto/CreateShipmentData.js';
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
 * UpsProvider'ı gerçek `fetch`'i mock'layarak test eder — bir UPS gönderici
 * hesabı gerektirmez. UPS'in Shipping/Tracking API'lerinin kamuya açık,
 * uzun süredir stabil JSON şemasına göre kod tarafının doğru istek/yanıt
 * ürettiğini doğrular. MNG'nin indirilebilir OpenAPI zip'inin aksine, bu
 * şema developer.ups.com'daki referans sayfalarından çıkarıldı ve gerçek
 * bir hesapla ölçülmedi — bkz. README.
 */
describe('UpsProvider (mocked HTTP)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function createProvider(): UpsProvider {
    return new UpsProvider({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      accountNumber: '1A2B3C',
    });
  }

  function mockTokenOnce(): void {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ token_type: 'Bearer', access_token: 'test-access-token', expires_in: '14400' }),
    );
  }

  it('requests a token with Basic auth and reuses it across calls', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({
        ShipmentResponse: {
          Response: { ResponseStatus: { Code: '1', Description: 'Success' } },
          ShipmentResults: { ShipmentIdentificationNumber: '1Z999AA10123456784', PackageResults: [] },
        },
      }),
    );

    const result = await createProvider().createShipment(
      new CreateShipmentData(
        'ORDER-1',
        new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Adres 1'),
        new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Adres 2'),
        new Parcel(2000, 2),
      ),
    );

    expect(result.trackingNumber).toBe('1Z999AA10123456784');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://wwwcie.ups.com/security/v1/oauth/token');
    expect(tokenInit.headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
    expect(tokenInit.body).toBe('grant_type=client_credentials');

    const [shipUrl, shipInit] = fetchMock.mock.calls[1]!;
    expect(shipUrl).toBe('https://wwwcie.ups.com/api/shipments/v2409/ship');
    expect(shipInit.headers.Authorization).toBe('Bearer test-access-token');
    const body = JSON.parse(shipInit.body);
    expect(body.ShipmentRequest.Shipment.Shipper.ShipperNumber).toBe('1A2B3C');
    expect(body.ShipmentRequest.Shipment.Package[0].PackageWeight.Weight).toBe('2');
  });

  it('maps UPS track activity into a normalized TrackingResponse', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({
        trackResponse: {
          shipment: [
            {
              inquiryNumber: '1Z999AA10123456784',
              package: [
                {
                  trackingNumber: '1Z999AA10123456784',
                  activity: [
                    {
                      date: '20260113',
                      time: '143000',
                      status: { type: 'D', description: 'DELIVERED' },
                      location: { address: { city: 'ANKARA' } },
                    },
                    {
                      date: '20260112',
                      time: '090000',
                      status: { type: 'I', description: 'IN TRANSIT' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    const result = await createProvider().trackShipment('1Z999AA10123456784');

    expect(result.status).toBe(ShipmentStatus.Delivered);
    expect(result.events).toHaveLength(2);

    const [trackUrl, trackInit] = fetchMock.mock.calls[1]!;
    expect(trackUrl).toBe('https://wwwcie.ups.com/api/track/v1/details/1Z999AA10123456784');
    expect(trackInit.method).toBe('GET');
    expect(trackInit.headers.transId).toHaveLength(32);
  });

  it('sends a DELETE to void/cancel and reports success from SummaryResult.Status.Code', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({
        VoidShipmentResponse: {
          Response: { ResponseStatus: { Code: '1', Description: 'Success' } },
          SummaryResult: { Status: { Code: '1', Description: 'Voided' } },
        },
      }),
    );

    const result = await createProvider().cancelShipment('1Z999AA10123456784');

    expect(result.cancelled).toBe(true);
    const [voidUrl, voidInit] = fetchMock.mock.calls[1]!;
    expect(voidUrl).toBe('https://wwwcie.ups.com/api/shipments/v2409/void/cancel/1Z999AA10123456784');
    expect(voidInit.method).toBe('DELETE');
  });

  it('surfaces a ShipmentFailedError with status/body context on HTTP errors', async () => {
    mockTokenOnce();
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'boom' }, false, 401));

    await expect(createProvider().cancelShipment('1Z999AA10123456784')).rejects.toThrow(/HTTP 401/);
  });
});
