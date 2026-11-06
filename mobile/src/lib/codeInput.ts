/**
 * Invoer van cijfercodes (e-mailcode van 8, authenticatorcode van 6 cijfers).
 * Plakken moet werken met spaties of streepjes ("123 456", "123-456"): daarom filteren we op cijfers in plaats van met een
 * vaste `maxLength` die een geplakte code met spatie afknipt (de code zou dan nooit volledig zijn).
 */
export function digitsOnly(value: string, length: number): string {
  return value.replace(/\D/g, "").slice(0, length);
}
