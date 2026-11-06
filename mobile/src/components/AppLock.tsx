import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import type { LockController, LockFailure, LockPhase } from "../lib/appLock";
import { getPrivacyDiagnostics } from "../lib/privacyScreen";
import type { LockSources } from "../lib/appLockSources";

export type LockApi = {
  phase: LockPhase;
  shielded: boolean;
  failure: LockFailure | null;
  unlock: () => void;
  /** Stabiel en synchroon (niet afhankelijk van renders): mag er nu iets worden opgehaald? */
  isUnlocked: () => boolean;
  /** Stabiel: meldt zich nadat de vergrendeling is beoordeeld en de app ontgrendeld is (terugkeer of ontgrendelen). */
  onResume: (listener: () => void) => () => void;
};

/** Zonder provider (bijv. in tests van losse schermen) gedraagt de context zich als ontgrendeld. */
const LockContext = createContext<LockApi>({ phase: "unlocked", shielded: false, failure: null, unlock: () => {}, isUnlocked: () => true, onResume: () => () => {} });
export const useAppLock = () => useContext(LockContext);

const MESSAGES: Record<LockFailure, string> = {
  cancelled: "Ontgrendelen is geannuleerd. Tik op Ontgrendelen om het opnieuw te proberen.",
  failed: "Niet herkend. Probeer het opnieuw.",
  lockout: "Te veel mislukte pogingen. Ontgrendel eerst je toestel met de toestelcode en probeer het daarna opnieuw.",
  unavailable: "Ontgrendelen is op dit toestel nu niet beschikbaar. Controleer de beveiligingsinstellingen van je toestel en probeer het opnieuw.",
  "no-device-security": "",
  "screen-protection": "",
  error: "Ontgrendelen is niet gelukt. Probeer het opnieuw.",
};

/**
 * Melding bij een mislukte schermbescherming, per platform correct: op iOS gaat het om de afscherming in de app-switcher (schermafbeeldingen
 * zijn daar bewust niet geblokkeerd), op Android om schermafbeeldingen én de recente-apps-weergave.
 */
function protectionMessage(): string {
  const base =
    Capacitor.getPlatform() === "ios"
      ? "De schermbeveiliging (afscherming van Ringtools in de app-switcher) kon niet worden ingeschakeld."
      : "De schermbeveiliging (tegen schermafbeeldingen en inzage via recente apps) kon niet worden ingeschakeld.";
  return `${base} Ringtools blijft daarom vergrendeld. Probeer het opnieuw of start de app opnieuw.`;
}

const DIAGNOSIS: Record<string, string> = {
  "plugin-missing": "de beveiligingsmodule is niet in de app aanwezig",
  "load-failed": "de beveiligingsmodule kon niet worden geladen",
  "enable-failed": "de beveiligingsmodule gaf een fout",
  timeout: "de beveiligingsmodule reageerde niet op tijd",
};

/** Veilige diagnostiek voor support: alleen een code, de duur en een korte foutnaam; geen gebruikersgegevens. */
function ProtectionDiagnostics() {
  const d = getPrivacyDiagnostics();
  if (!d || d.ok) return null;
  return (
    <p className="muted" data-testid="lock-diagnostics">
      Technische code: {d.code}{d.detail ? ` (${d.detail})` : ""}, {d.ms} ms — {DIAGNOSIS[d.code] ?? "onbekende oorzaak"}.
    </p>
  );
}

/** Neutraal vergrendelscherm: toont nooit namen, voorstellen, ontheffingen of andere vertrouwelijke informatie. */
export function LockScreen({ phase, failure, onUnlock }: { phase: LockPhase; failure: LockFailure | null; onUnlock: () => void }) {
  const busy = phase === "authenticating";
  const noSecurity = phase === "blocked" && failure === "no-device-security";
  const retry = phase === "blocked" && failure === "screen-protection";
  return (
    <main className="lock-screen" aria-label="Ringtools is vergrendeld">
      <div className="glass card stack lock-card">
        <h1>Ringtools</h1>
        {noSecurity ? (
          <>
            <strong>Schermvergrendeling vereist</strong>
            <p className="muted">
              Ringtools bevat vertrouwelijke gegevens en kan alleen worden gebruikt als je toestel is beveiligd met een toestelcode of biometrie (Face ID,
              Touch ID of vingerafdruk). Stel dit in via de instellingen van je toestel en kom daarna terug.
            </p>
          </>
        ) : (
          <p className="muted">Ringtools is vergrendeld. Ontgrendel met Face ID, je vingerafdruk of de toestelcode.</p>
        )}
        {failure && !noSecurity && <p role="alert" className="error">{failure === "screen-protection" ? protectionMessage() : MESSAGES[failure]}</p>}
        {failure === "screen-protection" && <ProtectionDiagnostics />}
        <button className="btn btn-primary" onClick={onUnlock} disabled={busy}>
          {busy ? "Even geduld…" : noSecurity ? "Opnieuw controleren" : retry ? "Opnieuw proberen" : "Ontgrendelen"}
        </button>
      </div>
    </main>
  );
}

/** Neutrale afdekking zodra de app inactief wordt (aanvulling op de native afscherming voor de app-switcher). */
export function PrivacyCover() {
  return (
    <div className="privacy-cover" role="presentation" data-testid="privacy-cover">
      <span>Ringtools</span>
    </div>
  );
}

/**
 * Plaatst de hele app achter de vergrendeling. Vóór de eerste ontgrendeling worden de kinderen (AuthProvider, schermen, API-aanroepen)
 * NIET gemonteerd. Daarna blijven ze gemonteerd (zodat een halve inlogstap of invoer niet verloren gaat) maar zijn ze bij vergrendeling
 * verborgen en niet bereikbaar (`hidden` + `inert`). Deeplinks worden elders verzameld en pas na ontgrendeling verwerkt.
 */
export function AppLockGate({ controller, sources, children }: { controller: LockController; sources: LockSources; children: React.ReactNode }) {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [everUnlocked, setEverUnlocked] = useState(false);
  const unlocked = snap.phase === "unlocked";

  useEffect(() => {
    if (unlocked) setEverUnlocked(true);
  }, [unlocked]);

  useEffect(() => {
    sources.hideSplash();
    const off = sources.onAppState((active) => (active ? controller.appActive() : controller.appInactive()));
    void controller.start();
    return off;
  }, [controller, sources]);

  useEffect(() => (unlocked ? undefined : sources.onBackWhileLocked()), [unlocked, sources]);

  const unlock = useCallback(() => void controller.unlock(), [controller]);
  const api = useMemo<LockApi>(
    () => ({ phase: snap.phase, shielded: snap.shielded, failure: snap.failure, unlock, isUnlocked: controller.isUnlocked, onResume: controller.onResume }),
    [snap, unlock, controller]
  );

  return (
    <LockContext.Provider value={api}>
      {(unlocked || everUnlocked) && (
        <div className="lock-content" hidden={!unlocked} inert={!unlocked || snap.verifying} aria-hidden={!unlocked || snap.verifying}>
          {children}
        </div>
      )}
      {!unlocked && <LockScreen phase={snap.phase} failure={snap.failure} onUnlock={unlock} />}
      {snap.shielded && <PrivacyCover />}
    </LockContext.Provider>
  );
}
