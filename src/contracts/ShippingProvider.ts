import { CreateShipmentData } from '../dto/CreateShipmentData.js';
import { ShipmentResponse } from '../dto/ShipmentResponse.js';
import { TrackingResponse } from '../dto/TrackingResponse.js';
import { CancelShipmentResponse } from '../dto/CancelShipmentResponse.js';

/**
 * Kargo Sağlayıcı Arayüzü
 *
 * Tüm kargo firması driver'larının implement etmesi gereken temel
 * sözleşme. Her firma bu üç metodu (gönderi oluşturma, takip, iptal)
 * uygular; etiket alma ve fiyat sorgulama gibi firma bazında değişen
 * yetenekler `Supports*` arayüzleriyle bildirilir — bkz. `contracts/capabilities.ts`.
 */
export interface ShippingProvider {
  createShipment(data: CreateShipmentData): Promise<ShipmentResponse>;

  trackShipment(trackingNumber: string): Promise<TrackingResponse>;

  cancelShipment(trackingNumber: string): Promise<CancelShipmentResponse>;
}
