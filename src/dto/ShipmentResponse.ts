export class ShipmentResponse {
  constructor(
    /** Kargo firmasının ürettiği takip/barkod numarası. */
    public readonly trackingNumber: string,
    public readonly referenceId: string,
    /** Firma create yanıtına etiketi gömdüyse burada döner; yoksa `getLabel()` ile ayrıca istenir. */
    public readonly labelUrl?: string,
    public readonly raw?: unknown,
  ) {}
}
