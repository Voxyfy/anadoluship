import { describe, expect, it } from 'vitest';
import { Address, CreateShipmentData, MngProvider, Parcel } from '../src/index.js';

/**
 * Gerçek MNG/DHL eCommerce sandbox'ına karşı çalışır. Aşağıdaki ortam
 * değişkenleri tanımlı değilse otomatik atlanır — CI'da veya kimlik
 * bilgisi olmayan geliştiricilerde kırmadan geçer.
 *
 *   MNG_CLIENT_ID, MNG_CLIENT_SECRET      — Apizone'da oluşturduğunuz uygulama
 *   MNG_CUSTOMER_NUMBER, MNG_PASSWORD     — MNG test müşteri numarası/şifresi
 *
 * bkz. README "MNG ile başlarken" bölümü.
 */
const hasCredentials =
  !!process.env.MNG_CLIENT_ID &&
  !!process.env.MNG_CLIENT_SECRET &&
  !!process.env.MNG_CUSTOMER_NUMBER &&
  !!process.env.MNG_PASSWORD;

describe.skipIf(!hasCredentials)('MngProvider (gerçek sandbox)', () => {
  it('creates a shipment against testapi.mngkargo.com.tr', async () => {
    const provider = new MngProvider({
      clientId: process.env.MNG_CLIENT_ID!,
      clientSecret: process.env.MNG_CLIENT_SECRET!,
      customerNumber: process.env.MNG_CUSTOMER_NUMBER!,
      password: process.env.MNG_PASSWORD!,
    });

    const shipment = await provider.createShipment(
      new CreateShipmentData(
        `anadoluship-${Date.now()}`,
        new Address('AnadoluShip Test', '05000000000', 'İstanbul', 'Kadıköy', 'Örnek Mah. 1. Sk. No:1'),
        new Address('Alıcı Test', '05000000001', 'Ankara', 'Çankaya', 'Örnek Mah. 2. Sk. No:2'),
        new Parcel(1000, 1),
      ),
    );

    expect(shipment.trackingNumber).toBeTruthy();
  });
});
