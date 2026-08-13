/** Firma-bağımsız normalize edilmiş gönderi durumu. */
export enum ShipmentStatus {
  Created = 'created',
  InTransit = 'in_transit',
  OutForDelivery = 'out_for_delivery',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
  Returned = 'returned',
  Exception = 'exception',
  Unknown = 'unknown',
}
