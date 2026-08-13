export class LabelResponse {
  constructor(
    public readonly trackingNumber: string,
    /** Base64 PDF/PNG içerik veya indirilebilir URL — firmaya göre değişir. */
    public readonly format: 'pdf' | 'png' | 'zpl',
    public readonly content: string,
  ) {}
}
