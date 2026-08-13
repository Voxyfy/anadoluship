import { randomUUID } from 'node:crypto';
import { ShippingProvider } from '../contracts/ShippingProvider.js';
import { CreateShipmentData } from '../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../dto/ShipmentResponse.js';
import { TrackingResponse } from '../dto/TrackingResponse.js';
import { CancelShipmentResponse } from '../dto/CancelShipmentResponse.js';
import { ShipmentStatus } from '../support/ShipmentStatus.js';

/**
 * Sahte Kargo Sağlayıcı
 *
 * Ağ çağrısı yapmaz, gönderileri bellekte tutar. Mimarinin (DTO'lar,
 * contract, yetenek tespiti, hata hiyerarşisi) doğru kurulduğunu
 * kanıtlamak için ilk driver olarak seçildi — gerçek bir kargo firması
 * kimliği gerektirmez.
 */
export class FakeProvider implements ShippingProvider {
  private readonly shipments = new Map<string, { data: CreateShipmentData; cancelled: boolean }>();

  async createShipment(data: CreateShipmentData): Promise<ShipmentResponse> {
    const trackingNumber = `FAKE-${randomUUID()}`;
    this.shipments.set(trackingNumber, { data, cancelled: false });

    return new ShipmentResponse(trackingNumber, data.referenceId);
  }

  async trackShipment(trackingNumber: string): Promise<TrackingResponse> {
    const shipment = this.shipments.get(trackingNumber);
    const status = !shipment
      ? ShipmentStatus.Unknown
      : shipment.cancelled
        ? ShipmentStatus.Cancelled
        : ShipmentStatus.Created;

    return new TrackingResponse(trackingNumber, status);
  }

  async cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse> {
    const shipment = this.shipments.get(trackingNumber);

    if (!shipment) {
      return new CancelShipmentResponse(trackingNumber, false);
    }

    shipment.cancelled = true;

    return new CancelShipmentResponse(trackingNumber, true);
  }
}
