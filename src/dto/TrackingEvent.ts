export class TrackingEvent {
  constructor(
    public readonly occurredAt: Date,
    public readonly description: string,
    public readonly location?: string,
  ) {}
}
