import { Capacitor } from "@capacitor/core";
import { PrivacyScreen } from "@capacitor-community/privacy-screen";

/**
 * Schermbescherming (plug-in @capacitor-community/privacy-screen):
 *  - Android: FLAG_SECURE op het appvenster → geen schermafbeeldingen/schermopnames en geen inhoud in de recente-apps-weergave.
 *  - iOS: bij `willResignActive` legt de plug-in synchroon een neutrale weergave over de app, vóór de momentopname van de app-switcher
 *    (alleen zolang de bescherming is ingeschakeld). Schermafbeeldingen en schermopnames zijn op iOS met openbare API NIET betrouwbaar
 *    te blokkeren; de plug-in bevat een niet-gedocumenteerde laagtruc die we bewust uitzetten (`preventScreenshots: false`).
 *
 * FAIL-CLOSED: de bescherming geldt als voorwaarde voor toegang. `ensurePrivacyScreen()` geeft alleen `true` als de plug-in
 * beschikbaar is én `enable()` aantoonbaar is geslaagd binnen de tijdslimiet. In alle andere gevallen is het resultaat `false` en blijft
 * de app vergrendeld/geblokkeerd (zie LockController). Elke mislukking krijgt een korte, niet-gevoelige diagnosecode (`getPrivacyDiagnostics`).
 *
 * LESSEN (oorzaak van de iOS-blokkade, zie docs/BUGFIX-IOS-SCHERMBESCHERMING.md): een Capacitor-plug-in is een `Proxy` die voor ELKE
 * eigenschap — ook `then` — een native methode-aanroep teruggeeft. Wie zo'n proxy uit een `async`-functie teruggeeft of `await`, laat de
 * promise-afhandeling `proxy.then(...)` aanroepen; dat bereikt nooit een resolve en de promise hangt eeuwig. De plug-in wordt hier daarom
 * NOOIT als waarde doorgegeven, alleen via een gewoon object met losse functies aangeroepen.
 */
export const PROTECTION_TIMEOUT_MS = 3_000;

export type PrivacyPluginLike = { enable(): Promise<void> };

export type PrivacyScreenDeps = {
  /** Alleen een gewone ontwikkelbrowser is "niet native": daar bestaat geen native bescherming en is er niets te verifiëren. */
  native?: boolean;
  /** Is de native plug-in geregistreerd? (standaard: Capacitor.isPluginAvailable) */
  available?: () => boolean;
  /** Geeft een gewoon (niet-thenable) object met `enable()`; mag nooit de Capacitor-proxy zelf teruggeven. */
  load?: () => Promise<PrivacyPluginLike | null>;
  timeoutMs?: number;
  now?: () => number;
};

export type PrivacyCode = "ok" | "not-native" | "plugin-missing" | "load-failed" | "enable-failed" | "timeout";
export type PrivacyDiagnostics = { ok: boolean; code: PrivacyCode; ms: number; detail?: string };

let last: PrivacyDiagnostics | null = null;

/** Laatste uitkomst van de controle (alleen code, duur en een korte foutnaam; nooit gebruikersgegevens). */
export function getPrivacyDiagnostics(): PrivacyDiagnostics | null {
  return last;
}

/** Korte, veilige foutomschrijving: alleen naam/code, afgekapt; geen berichtteksten met mogelijk gevoelige inhoud. */
function safeDetail(err: unknown): string | undefined {
  const e = err as { code?: unknown; name?: unknown } | null;
  const raw = typeof e?.code === "string" ? e.code : typeof e?.name === "string" ? e.name : undefined;
  return raw ? raw.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || undefined : undefined;
}

/** Standaardlader: een gewoon object; de proxy zelf verlaat deze functie nooit via een promise. */
async function defaultLoad(): Promise<PrivacyPluginLike> {
  return { enable: () => PrivacyScreen.enable() };
}

export async function checkPrivacyScreen(deps: PrivacyScreenDeps = {}): Promise<PrivacyDiagnostics> {
  const now = deps.now ?? Date.now;
  const started = now();
  const done = (code: PrivacyCode, detail?: string): PrivacyDiagnostics => {
    const result: PrivacyDiagnostics = { ok: code === "ok" || code === "not-native", code, ms: Math.max(0, now() - started), ...(detail ? { detail } : {}) };
    last = result;
    if (!result.ok) console.warn(`[privacy-screen] mislukt: ${code}${detail ? ` (${detail})` : ""} na ${result.ms} ms`);
    return result;
  };

  const native = deps.native ?? Capacitor.isNativePlatform();
  if (!native) return done("not-native");
  if (!(deps.available ?? (() => Capacitor.isPluginAvailable("PrivacyScreen")))()) return done("plugin-missing"); // native niet geregistreerd

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attempt = (async (): Promise<PrivacyDiagnostics> => {
      let plugin: PrivacyPluginLike | null;
      try {
        plugin = await (deps.load ?? defaultLoad)();
      } catch (err) {
        return done("load-failed", safeDetail(err));
      }
      if (!plugin) return done("plugin-missing");
      try {
        await plugin.enable();
      } catch (err) {
        return done("enable-failed", safeDetail(err));
      }
      return done("ok");
    })();
    const timeout = new Promise<PrivacyDiagnostics>((resolve) => {
      timer = setTimeout(() => resolve(done("timeout")), deps.timeoutMs ?? PROTECTION_TIMEOUT_MS);
    });
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function ensurePrivacyScreen(deps: PrivacyScreenDeps = {}): Promise<boolean> {
  return (await checkPrivacyScreen(deps)).ok;
}
