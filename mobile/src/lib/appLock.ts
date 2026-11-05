/**
 * Verplichte lokale appvergrendeling (E3). Een extra toegangscontrole BOVEN OP de serversessie: ze vervangt geen serverauthenticatie,
 * verplichte MFA of herverificatie. Dit bestand bevat uitsluitend de beleidslogica (framework- en plug-inonafhankelijk, volledig testbaar):
 *  - koude start: altijd vergrendeld; pas na een geslaagde lokale verificatie worden vertrouwelijke onderdelen gemonteerd;
 *  - naar de achtergrond/inactief: onmiddellijk afschermen; terug binnen BACKGROUND_GRACE_MS zonder nieuwe verificatie,
 *    daarna (of bij een onbetrouwbare klok) opnieuw vergrendelen;
 *  - fail-closed: elke fout, annulering of ontbrekende toestelbeveiliging laat de app vergrendeld (of geblokkeerd).
 * Er is bewust GEEN eigen pincode: de verificatie is die van het toestel (Face ID/Touch ID/biometrie of de toestelcode).
 */

/** Besluit eigenaar: na 30 seconden in de achtergrond is opnieuw ontgrendelen nodig. */
export const BACKGROUND_GRACE_MS = 30_000;

export type LockPhase = "locked" | "authenticating" | "unlocked" | "blocked";
export type LockFailure = "cancelled" | "failed" | "lockout" | "unavailable" | "no-device-security" | "error";

export type AppLockResult = { ok: true } | { ok: false; reason: LockFailure };

/** Smalle interface naar het platform; de plug-in zit achter een adapter (zie biometricAppLock.ts). */
export interface AppLockProvider {
  /** Is er een beveiligde schermvergrendeling (toestelcode of biometrie)? Zonder die geen toegang. */
  deviceSecure(): Promise<boolean>;
  /** Toont de systeemprompt (biometrie met terugval op de toestelcode). Gooit nooit: elke fout wordt een resultaat. */
  authenticate(): Promise<AppLockResult>;
}

export type LockSnapshot = { readonly phase: LockPhase; readonly shielded: boolean; readonly failure: LockFailure | null };

export type LockDeps = {
  /** Uitgeschakeld (alleen een gewone browser tijdens ontwikkeling): altijd ontgrendeld. Native is dit altijd aan. */
  enabled: boolean;
  provider: AppLockProvider | null;
  now?: () => number;
  /** Is de app op dit moment actief (voorgrond)? Voor het geval de app tijdens de prompt wegging. */
  isAppActive?: () => Promise<boolean>;
};

export class LockController {
  private snap: LockSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private awayAt: number | null = null;
  private inflight = false;
  /** Laatst bekende voorgrondstatus (ook bijgehouden tijdens een prompt). */
  private active = true;

  constructor(private readonly deps: LockDeps) {
    this.now = deps.now ?? (() => Date.now());
    // Koude start: vergrendeld, nog vóór enige asynchrone controle.
    this.snap = deps.enabled ? { phase: "locked", shielded: false, failure: null } : { phase: "unlocked", shielded: false, failure: null };
  }

  getSnapshot = (): LockSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private set(next: Partial<LockSnapshot>) {
    const merged = { ...this.snap, ...next };
    if (merged.phase === this.snap.phase && merged.shielded === this.snap.shielded && merged.failure === this.snap.failure) return;
    this.snap = merged;
    this.listeners.forEach((l) => l());
  }

  /** Eerste poging na het opstarten (zodra de app actief is). */
  async start(): Promise<void> {
    if (!this.deps.enabled) return;
    try {
      if (this.deps.isAppActive) this.active = await this.deps.isAppActive();
    } catch {
      this.active = true; // het ontgrendelscherm toont zelf niets vertrouwelijks
    }
    this.set({ shielded: !this.active });
    await this.unlock();
  }

  /** Vraagt de systeemverificatie. Alleen vanuit "locked" of "blocked"; gelijktijdige aanroepen starten geen tweede prompt. */
  async unlock(): Promise<void> {
    if (!this.deps.enabled || this.snap.phase === "unlocked" || this.inflight) return;
    this.inflight = true;
    this.set({ phase: "authenticating", failure: null });
    try {
      const provider = this.deps.provider;
      if (!provider) return this.fail("blocked", "unavailable"); // geen provider = nooit toegang
      let secure = false;
      try {
        secure = await provider.deviceSecure();
      } catch {
        return this.fail("blocked", "unavailable");
      }
      if (!secure) return this.fail("blocked", "no-device-security");
      const result = await provider.authenticate().catch((): AppLockResult => ({ ok: false, reason: "error" }));
      if (!result.ok) return this.fail("locked", result.reason);
      // Geslaagd. Is de app intussen naar de achtergrond gegaan, dan begint de afwezigheidsklok nu.
      this.awayAt = this.active ? null : this.now();
      this.set({ phase: "unlocked", failure: null, shielded: !this.active });
    } catch {
      this.fail("locked", "error");
    } finally {
      this.inflight = false;
    }
  }

  private fail(phase: "locked" | "blocked", failure: LockFailure) {
    this.awayAt = null;
    this.set({ phase, failure, shielded: !this.active });
  }

  /** App wordt inactief of gaat naar de achtergrond (ook systeemoverlays): onmiddellijk afschermen. */
  appInactive(): void {
    if (!this.deps.enabled) return;
    this.active = false;
    if (this.snap.phase === "unlocked" && this.awayAt === null && !this.inflight) this.awayAt = this.now();
    this.set({ shielded: true });
  }

  /** App is weer actief: opnieuw vergrendelen als de afwezigheid te lang was of de klok niet te vertrouwen is. */
  appActive(): void {
    if (!this.deps.enabled) return;
    this.active = true;
    if (this.inflight) return; // de eigen prompt veroorzaakt ook voorgrond-/achtergrondwisselingen; het resultaat bepaalt de toestand
    if (this.snap.phase === "unlocked") {
      const away = this.awayAt;
      this.awayAt = null;
      if (away !== null) {
        const elapsed = this.now() - away;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= BACKGROUND_GRACE_MS) {
          this.set({ phase: "locked", failure: null, shielded: false });
          void this.unlock(); // het systeem vraagt direct opnieuw om verificatie
          return;
        }
      }
      this.set({ shielded: false });
      return;
    }
    this.set({ shielded: false });
    // Na een vergrendeling door tijdsverloop of na ontbrekende toestelbeveiliging opnieuw proberen; na een bewuste annulering niet automatisch.
    if (this.snap.phase === "blocked" || (this.snap.phase === "locked" && this.snap.failure === null)) void this.unlock();
  }
}
