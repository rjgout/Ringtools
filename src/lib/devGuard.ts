/**
 * Bescherming van de development-omgeving (APP_ENVIRONMENT=development).
 *
 * In ontwikkeling mogen e-mails (inlogcodes, uitnodigingen, meldingen) en pushmeldingen uitsluitend naar expliciet toegestane testers.
 * Fail-closed: zonder DEV_MAIL_ALLOWLIST verlaat er geen enkele e-mail of push de omgeving. In productie (standaard) doet deze module niets.
 *
 * DEV_MAIL_ALLOWLIST: komma- of regelgescheiden lijst met volledige e-mailadressen (tester@example.nl) en/of domeinen (@example.nl).
 * Gereserveerde testdomeinen (.invalid, .test, .example) worden nooit bezorgd; de bestaande .invalid-regel in de mailer blijft gelden.
 */

export function isDevelopmentEnvironment(): boolean {
  return (process.env.APP_ENVIRONMENT || "").trim().toLowerCase() === "development";
}

function allowlist(): string[] {
  return (process.env.DEV_MAIL_ALLOWLIST || "")
    .split(/[,\n;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Mag er in deze omgeving extern (e-mail of push) iets naar dit adres? In productie altijd ja; in development alleen voor toegestane testers. */
export function isRecipientAllowed(email: string | null | undefined): boolean {
  if (!isDevelopmentEnvironment()) return true;
  const address = (email || "").trim().toLowerCase();
  if (!address || !address.includes("@")) return false;
  return allowlist().some((rule) => (rule.startsWith("@") ? address.endsWith(rule) : address === rule));
}
