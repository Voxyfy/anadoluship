export { AnadoluShip, createAnadoluShip } from './AnadoluShip.js';
export type { AnadoluShipConfig } from './AnadoluShip.js';

export type { ShippingProvider } from './contracts/ShippingProvider.js';
export {
  supportsLabelRetrieval,
  supportsRateQuote,
} from './contracts/capabilities.js';
export type {
  SupportsLabelRetrieval,
  SupportsRateQuote,
} from './contracts/capabilities.js';

export { Address } from './dto/Address.js';
export { Parcel } from './dto/Parcel.js';
export { CreateShipmentData } from './dto/CreateShipmentData.js';
export { ShipmentResponse } from './dto/ShipmentResponse.js';
export { TrackingEvent } from './dto/TrackingEvent.js';
export { TrackingResponse } from './dto/TrackingResponse.js';
export { CancelShipmentResponse } from './dto/CancelShipmentResponse.js';
export { LabelResponse } from './dto/LabelResponse.js';
export { RateQuoteData } from './dto/RateQuoteData.js';
export { RateQuoteResponse } from './dto/RateQuoteResponse.js';

export { ShipmentStatus } from './support/ShipmentStatus.js';

export {
  AnadoluShipError,
  DriverNotFoundError,
  ShipmentFailedError,
  UnsupportedCapabilityError,
} from './errors/AnadoluShipError.js';

export { FakeProvider } from './providers/FakeProvider.js';
export { MngProvider } from './providers/mng/MngProvider.js';
export type { MngProviderConfig } from './providers/mng/MngProvider.js';
