import { Address } from './Address.js';
import { Parcel } from './Parcel.js';

export class CreateShipmentData {
  constructor(
    /** Satıcı/gönderen tarafın kendi sipariş/referans numarası. */
    public readonly referenceId: string,
    public readonly sender: Address,
    public readonly receiver: Address,
    public readonly parcel: Parcel,
    /** Kapıda ödeme (COD) tutarı — kuruş cinsinden, yoksa undefined. */
    public readonly cashOnDeliveryAmount?: number,
    public readonly note?: string,
  ) {}
}
