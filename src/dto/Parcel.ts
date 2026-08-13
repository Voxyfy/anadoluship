/** Gönderilecek paketin fiziksel özellikleri. */
export class Parcel {
  constructor(
    /** Gram cinsinden ağırlık. */
    public readonly weightGrams: number,
    public readonly desi?: number,
    public readonly pieceCount: number = 1,
    public readonly content?: string,
  ) {}
}
