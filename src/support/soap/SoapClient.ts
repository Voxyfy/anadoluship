import { XMLParser } from 'fast-xml-parser';
import { ShipmentFailedError } from '../../errors/AnadoluShipError.js';

export interface SoapCallOptions {
  url: string;
  /** Boş string (`''`) gönderilmesi gereken servisler var (örn. Yurtiçi Kargo) — atlanmaz, her zaman header'a yazılır. */
  soapAction: string;
  /** `<soap:Body>` içine konacak, zaten namespace'lenmiş XML gövdesi. */
  bodyXml: string;
  headers?: Record<string, string>;
}

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: true });

/**
 * Ortak SOAP 1.1 istemcisi — Yurtiçi/Aras/Sürat/PTT driver'ları bunu
 * paylaşır. Zarf elle oluşturuluyor (XMLBuilder değil): her firmanın
 * gövdesi farklı namespace/eleman sırası gerektiriyor, elle şablon yazmak
 * WSDL'den çıkardığımız gerçek örneklerle bire bir eşleşmeyi kolaylaştırıyor.
 * Yanıt ayrıştırması `removeNSPrefix: true` ile yapılır — firmaların SOAP
 * prefix'leri (`soap:`, `soapenv:`, `S:` vb.) tutarsız olduğu için önek
 * bilgisini atıp düz eleman adlarıyla çalışmak daha güvenilir.
 */
export async function soapCall(options: SoapCallOptions): Promise<Record<string, unknown>> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<soap:Body>
${options.bodyXml}
</soap:Body>
</soap:Envelope>`;

  const res = await fetch(options.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: options.soapAction,
      ...options.headers,
    },
    body: envelope,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new ShipmentFailedError(`SOAP isteği başarısız (HTTP ${res.status}) — ${options.url}`, {
      status: res.status,
      body: text.slice(0, 2000),
    });
  }

  const parsed = parser.parse(text) as { Envelope?: { Body?: Record<string, unknown> } };
  const body = parsed.Envelope?.Body;

  if (!body) {
    throw new ShipmentFailedError('SOAP yanıtı ayrıştırılamadı — <Envelope>/<Body> bulunamadı', {
      raw: text.slice(0, 2000),
    });
  }

  if ('Fault' in body) {
    throw new ShipmentFailedError('SOAP Fault döndü', { fault: body.Fault });
  }

  return body;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** SOAP yanıtlarında tekil bir eleman bazen tek obje, bazen dizi olarak gelir (WSDL'de `maxOccurs='unbounded'`). */
export function firstOf<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}
