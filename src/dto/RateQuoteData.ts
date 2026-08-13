import { Parcel } from './Parcel.js';

export class RateQuoteData {
  constructor(
    public readonly senderCity: string,
    public readonly receiverCity: string,
    public readonly parcel: Parcel,
  ) {}
}
