export class AnadoluShipError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = 'AnadoluShipError';
  }
}

export class DriverNotFoundError extends AnadoluShipError {
  constructor(driver: string, available: string[]) {
    super(`Driver '${driver}' bulunamadı. Yapılandırılmış driver'lar: ${available.join(', ') || '(yok)'}`, {
      driver,
      available,
    });
    this.name = 'DriverNotFoundError';
  }
}

export class ShipmentFailedError extends AnadoluShipError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = 'ShipmentFailedError';
  }
}

export class UnsupportedCapabilityError extends AnadoluShipError {
  constructor(driver: string, capability: string) {
    super(`Driver '${driver}' '${capability}' yeteneğini desteklemiyor.`, { driver, capability });
    this.name = 'UnsupportedCapabilityError';
  }
}
