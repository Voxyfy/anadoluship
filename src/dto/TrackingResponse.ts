import { ShipmentStatus } from '../support/ShipmentStatus.js';
import { TrackingEvent } from './TrackingEvent.js';

export class TrackingResponse {
  constructor(
    public readonly trackingNumber: string,
    public readonly status: ShipmentStatus,
    public readonly events: TrackingEvent[] = [],
    public readonly raw?: unknown,
  ) {}
}
