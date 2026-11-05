/**
 * Native passkeys (C5.2) – clientarchitectuur. De app praat uitsluitend via deze smalle interface met het platform; de
 * server beslist (challenge, RP ID, origins, user verification, teller). Er is bewust nog GEEN native plug-in gekoppeld:
 * een passkey-ceremonie is alleen betrouwbaar te valideren op een fysiek toestel met geverifieerde Associated Domains
 * (iOS, `webcredentials:`) en Digital Asset Links (Android, `get_login_creds`). Zie docs/PASSKEYS-NATIVE.md.
 *
 * Een plug-in-adapter (bijv. `@capgo/capacitor-passkey`) registreert zich pas hier ná toesteltest en nooit in de
 * Personal Team-testbuild; zonder provider meldt de app veilig dat passkey-inloggen niet beschikbaar is (nooit een advies om MFA uit te zetten).
 */

/** Minimale JSON-vormen van WebAuthn (zoals de server ze levert/verwacht). */
export type PasskeyRequestOptions = {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: "required" | "preferred" | "discouraged";
  allowCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
};
export type PasskeyAssertion = {
  id: string;
  rawId: string;
  type: "public-key";
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
  clientExtensionResults: Record<string, unknown>;
};

export class PasskeyCancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}

/** Een passkey-ceremonie kon niet worden uitgevoerd (los van annuleren). `kind` bepaalt of opnieuw proberen zin heeft. */
export type PasskeyErrorKind = "not-supported" | "domain-not-associated" | "no-credential" | "invalid-options" | "failed";
export class PasskeyError extends Error {
  constructor(public readonly kind: PasskeyErrorKind, message: string) {
    super(message);
  }
  /** Opnieuw proberen op dit toestel zonder iets te wijzigen heeft geen zin. */
  get permanent() {
    return this.kind === "not-supported" || this.kind === "domain-not-associated" || this.kind === "invalid-options";
  }
}

export interface PasskeyProvider {
  /** Voert de native passkey-ceremonie uit. Gooit PasskeyCancelledError als de gebruiker annuleert. */
  authenticate(options: PasskeyRequestOptions): Promise<PasskeyAssertion>;
}

let provider: PasskeyProvider | null = null;

export function registerPasskeyProvider(p: PasskeyProvider | null) {
  provider = p;
}

/** Standaard null: geen native plug-in in deze build. */
export function getPasskeyProvider(): PasskeyProvider | null {
  return provider;
}

/** Native passkeys zijn alleen bruikbaar met een geregistreerde provider én als de server ze heeft ingeschakeld. */
export function passkeysUsable(serverEnabled: boolean | undefined, limitedBuild: boolean): boolean {
  return !limitedBuild && !!serverEnabled && provider !== null;
}

export const PASSKEY_UNAVAILABLE_MESSAGE =
  "Inloggen met een passkey is in deze versie van de app nog niet beschikbaar. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.";
