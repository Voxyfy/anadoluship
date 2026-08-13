export class RateQuoteResponse {
  constructor(
    /** Kuruş cinsinden tutar. */
    public readonly amount: number,
    public readonly currency: string = 'TRY',
    public readonly estimatedDays?: number,
  ) {}
}
