import { describe, expect, it } from 'vitest';
import {
  Address,
  CreateShipmentData,
  createAnadoluShip,
  FakeProvider,
  Parcel,
  ShipmentStatus,
} from '../src/index.js';

describe('FakeProvider', () => {
  it('creates, tracks and cancels a shipment in memory', async () => {
    const anadoluship = createAnadoluShip({
      drivers: {
        fake: () => new FakeProvider(),
      },
    });

    const provider = anadoluship.driver('fake');

    const shipment = await provider.createShipment(
      new CreateShipmentData(
        'order-123',
        new Address('Gönderen A.Ş.', '05000000000', 'İstanbul', 'Kadıköy', 'Örnek Mah. 1. Sk. No:1'),
        new Address('Alıcı Ali', '05000000001', 'Ankara', 'Çankaya', 'Örnek Mah. 2. Sk. No:2'),
        new Parcel(1500, 2),
      ),
    );

    expect(shipment.trackingNumber).toMatch(/^FAKE-/);

    const tracking = await provider.trackShipment(shipment.trackingNumber);
    expect(tracking.status).toBe(ShipmentStatus.Created);

    const cancelled = await provider.cancelShipment(shipment.trackingNumber);
    expect(cancelled.cancelled).toBe(true);

    const trackingAfterCancel = await provider.trackShipment(shipment.trackingNumber);
    expect(trackingAfterCancel.status).toBe(ShipmentStatus.Cancelled);
  });

  it('throws DriverNotFoundError for unknown drivers', () => {
    const anadoluship = createAnadoluShip({ drivers: {} });

    expect(() => anadoluship.driver('unknown')).toThrowError(/bulunamadı/);
  });
});
