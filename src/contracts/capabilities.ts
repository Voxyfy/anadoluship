import { ShippingProvider } from './ShippingProvider.js';
import { LabelResponse } from '../dto/LabelResponse.js';
import { RateQuoteData } from '../dto/RateQuoteData.js';
import { RateQuoteResponse } from '../dto/RateQuoteResponse.js';

/**
 * Etiketi `createShipment()` yanıtına gömmeyen firmalar için ayrı bir
 * etiket/barkod alma çağrısı. MNG ve PTT gibi firmalarda ayrı bir API
 * çağrısı gerekir; Yurtiçi/Aras gibi firmalarda etiket create yanıtına
 * gömülü gelebilir — bu durumda driver bu arayüzü implement etmez.
 */
export interface SupportsLabelRetrieval {
  getLabel(trackingNumber: string): Promise<LabelResponse>;
}

export function supportsLabelRetrieval(
  provider: ShippingProvider,
): provider is ShippingProvider & SupportsLabelRetrieval {
  return typeof (provider as Partial<SupportsLabelRetrieval>).getLabel === 'function';
}

/**
 * Gönderi öncesi fiyat/tarife sorgusu. Sadece anlaşma bazlı sabit tarife
 * kullanmayan, API üzerinden dinamik fiyatlandırma sunan firmalarda
 * (örn. MNG) mevcuttur.
 */
export interface SupportsRateQuote {
  calculateRate(data: RateQuoteData): Promise<RateQuoteResponse>;
}

export function supportsRateQuote(
  provider: ShippingProvider,
): provider is ShippingProvider & SupportsRateQuote {
  return typeof (provider as Partial<SupportsRateQuote>).calculateRate === 'function';
}
