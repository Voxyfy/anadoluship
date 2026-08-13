export class CancelShipmentResponse {
  constructor(
    public readonly trackingNumber: string,
    public readonly cancelled: boolean,
    public readonly raw?: unknown,
  ) {}
}
