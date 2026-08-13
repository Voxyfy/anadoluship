/** Gönderici veya alıcı adres bilgisi. */
export class Address {
  constructor(
    public readonly fullName: string,
    public readonly phone: string,
    public readonly city: string,
    public readonly district: string,
    public readonly addressLine: string,
    public readonly email?: string,
    public readonly postalCode?: string,
  ) {}
}
