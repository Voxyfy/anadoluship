import { Parcel } from './Parcel.js';

export class RateQuoteData {
  constructor(
    public readonly senderCity: string,
    public readonly receiverCity: string,
    public readonly parcel: Parcel,
    /** Bazı firmalar (örn. MNG) ilçe düzeyinde kod ister; onlarda bu alan zorunludur. */
    public readonly receiverDistrict?: string,
    public readonly senderDistrict?: string,
  ) {}
}
