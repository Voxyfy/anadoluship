import { DriverNotFoundError, ShipmentFailedError } from './errors/AnadoluShipError.js';
import type { ShippingProvider } from './contracts/ShippingProvider.js';

export interface AnadoluShipConfig {
  /** Driver adı → fabrika fonksiyonu. Her fabrika bir `ShippingProvider` üretir. */
  drivers: Record<string, () => ShippingProvider>;
}

/**
 * AnadoluShip İstemcisi
 *
 * Kargo firması driver'larını yönetir ve farklı Türk kargo
 * sağlayıcılarıyla etkileşim için birleşik bir arayüz sunar.
 *
 * AnadoluPay'deki `createAnadoluPay({ drivers })` deseniyle aynı: her
 * driver bir fabrika fonksiyonu, framework'e bağımlılık yok.
 *
 *     const anadoluship = createAnadoluShip({
 *       drivers: {
 *         fake: () => new FakeProvider(),
 *       },
 *     });
 *
 *     const provider = anadoluship.driver('fake');
 */
export class AnadoluShip {
  private readonly resolved = new Map<string, ShippingProvider>();

  constructor(private readonly config: AnadoluShipConfig) {}

  /** Belirtilen kargo sağlayıcı driver'ını döndürür (ilk çağrıda üretir, sonra önbellekten verir). */
  driver(name: string): ShippingProvider {
    const cached = this.resolved.get(name);

    if (cached) {
      return cached;
    }

    const factory = this.config.drivers[name];

    if (!factory) {
      throw new DriverNotFoundError(name, this.available());
    }

    const instance = factory();

    if (
      typeof instance?.createShipment !== 'function' ||
      typeof instance?.trackShipment !== 'function' ||
      typeof instance?.cancelShipment !== 'function'
    ) {
      throw new ShipmentFailedError(`Driver '${name}' must implement ShippingProvider.`, {
        driver: name,
      });
    }

    this.resolved.set(name, instance);

    return instance;
  }

  /** Yapılandırılmış tüm driver anahtarlarını döndürür. */
  available(): string[] {
    return Object.keys(this.config.drivers);
  }
}

/** `new AnadoluShip(config)` için kısa yol. */
export function createAnadoluShip(config: AnadoluShipConfig): AnadoluShip {
  return new AnadoluShip(config);
}
