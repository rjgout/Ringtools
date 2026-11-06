/**
 * Invoer van cijfercodes (e-mailcode van 8, authenticatorcode van 6 cijfers).
 * Plakken moet werken met spaties of streepjes ("123 456", "123-456"): daarom filteren we op cijfers in plaats van met een
 * vaste `maxLength` die een geplakte code met spatie afknipt (de code zou dan nooit volledig zijn).
 */
export function digitsOnly(value: string, length: number): string {
  return value.replace(/\D/g, "").slice(0, length);
}

/**
 * Gegroepeerde code (bijvoorbeeld koppel- of uitnodigingscode "XXXX-XXXX-XXXX"): hoofdletters en cijfers, groepjes van 4 met een streepje.
 * Spaties, streepjes en regeleinden uit een geplakte code worden genegeerd, zodat een code met een extra spatie of nieuwe regel niet wordt afgekapt.
 */
export function groupedCode(value: string, length = 12, group = 4): string {
  const raw = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, length);
  return raw.replace(new RegExp(`(.{${group}})(?=.)`, "g"), "$1-");
}
