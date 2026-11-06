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
export type LockFailure = "cancelled" | "failed" | "lockout" | "unavailable" | "no-device-security" | "screen-protection" | "error";

export type AppLockResult = { ok: true } | { ok: false; reason: LockFailure };

/** Smalle interface naar het platform; de plug-in zit achter een adapter (zie biometricAppLock.ts). */
export interface AppLockProvider {
  /** Is er een beveiligde schermvergrendeling (toestelcode of biometrie)? Zonder die geen toegang. */
  deviceSecure(): Promise<boolean>;
  /** Toont de systeemprompt (biometrie met terugval op de toestelcode). Gooit nooit: elke fout wordt een resultaat. */
  authenticate(): Promise<AppLockResult>;
}

/**
 * `verifying`: de app is voor een terugkeer binnen de grens al actief, maar de schermbescherming wordt nog opnieuw bevestigd.
 * Zolang dat loopt blijft alles afgeschermd en geldt de app als niet-ontgrendeld voor alle gegevens en verzoeken.
 */
export type LockSnapshot = { readonly phase: LockPhase; readonly shielded: boolean; readonly failure: LockFailure | null; readonly verifying: boolean };

/** Harde bovengrens voor één bevestiging van de schermbescherming; daarna geldt ze als mislukt (fail-closed). */
export const PROTECTION_CHECK_TIMEOUT_MS = 5_000;

export type LockDeps = {
  /** Uitgeschakeld (alleen een gewone browser tijdens ontwikkeling): altijd ontgrendeld. Native is dit altijd aan. */
  enabled: boolean;
  provider: AppLockProvider | null;
  now?: () => number;
  /** Is de app op dit moment actief (voorgrond)? Voor het geval de app tijdens de prompt wegging. */
  isAppActive?: () => Promise<boolean>;
  /**
   * Fail-closed voorwaarde: de native schermbescherming (Android FLAG_SECURE, afscherming app-switcher) moet aantoonbaar actief zijn.
   * Geeft dit `false` of gooit het, dan is er geen toegang. Niet opgegeven = geen voorwaarde (alleen tests).
   */
  screenProtection?: () => Promise<boolean>;
  protectionTimeoutMs?: number;
};

export class LockController {
  private snap: LockSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly resumeListeners = new Set<() => void>();
  private readonly now: () => number;
  private awayAt: number | null = null;
  private inflight = false;
  /** Laatst bekende voorgrondstatus (ook bijgehouden tijdens een prompt). */
  private active = true;
  /** Volgnummer van de laatste bevestiging van de schermbescherming; oudere uitkomsten tellen niet meer. */
  private verifySeq = 0;
  /**
   * E2.5: de vergrendeling beschermt een BESTAANDE sessie. Zonder sessie (uitgelogd, verlopen of ingetrokken) is er niets te beschermen: dan
   * verschijnt direct het inlogscherm zonder lokale ontgrendeling. Standaard `true` (fail-closed); alleen `configureSession(false)` en
   * `sessionEnded()` zetten dit uit, en alleen `sessionStarted()` zet het weer aan. De bestaande sessiecontrole (30 s achtergrond) blijft ongewijzigd.
   */
  private sessionRequired = true;

  constructor(private readonly deps: LockDeps) {
    this.now = deps.now ?? (() => Date.now());
    // Koude start: vergrendeld, nog vóór enige asynchrone controle.
    this.snap = deps.enabled ? { phase: "locked", shielded: false, failure: null, verifying: false } : { phase: "unlocked", shielded: false, failure: null, verifying: false };
  }

  getSnapshot = (): LockSnapshot => this.snap;

  /**
   * Vóór `start()` aanroepen met de uitkomst van een sessiecontrole die GEEN token leest (alleen of de sleutel bestaat). Bij `false` (geen opgeslagen
   * sessie) is er geen lokale ontgrendeling nodig; bij `true` (of een mislukte controle) geldt de volledige vergrendeling.
   */
  configureSession(hasSession: boolean): void {
    this.sessionRequired = hasSession;
    if (!this.deps.enabled || hasSession) return;
    this.set({ phase: "unlocked", failure: null, verifying: false });
  }

  /** Er is nu een sessie (inloggen geslaagd of hervat). Een zojuist geslaagde aanmelding telt als ontgrendeling: geen tweede prompt. */
  sessionStarted(): void {
    this.sessionRequired = true;
    this.awayAt = null;
  }

  /** De sessie is weg (uitloggen, verlopen, ingetrokken): niets meer te beschermen; direct het inlogscherm, zonder ontgrendelprompt. */
  sessionEnded(): void {
    this.sessionRequired = false;
    this.awayAt = null;
    this.verifySeq++;
    if (!this.deps.enabled) return;
    this.set({ phase: "unlocked", failure: null, verifying: false, shielded: !this.active });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Synchrone waarheid over de vergrendeling (geen React-render nodig): voor alles wat gegevens ophaalt. */
  isUnlocked = (): boolean => this.snap.phase === "unlocked" && !this.snap.verifying;

  /**
   * Wordt aangeroepen NADAT de vergrendeling is beoordeeld en de app ontgrendeld is: bij terugkeer binnen de grens, of na een
   * geslaagde ontgrendeling. Alleen hierna mag de sessie worden ververst; de volgorde van native gebeurtenissen speelt dan geen rol.
   */
  onResume = (listener: () => void): (() => void) => {
    this.resumeListeners.add(listener);
    return () => void this.resumeListeners.delete(listener);
  };

  private emitResume() {
    this.resumeListeners.forEach((l) => {
      try {
        l();
      } catch {
        /* een luisteraar mag de vergrendeling nooit verstoren */
      }
    });
  }

  private set(next: Partial<LockSnapshot>) {
    const merged = { ...this.snap, ...next };
    if (merged.phase === this.snap.phase && merged.shielded === this.snap.shielded && merged.failure === this.snap.failure && merged.verifying === this.snap.verifying) return;
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
    this.verifySeq++; // een lopende bevestiging bij terugkeer wordt vervangen door deze ontgrendeling
    this.set({ phase: "authenticating", failure: null, verifying: false });
    try {
      // Zonder aantoonbare schermbescherming nooit toegang, ook al zou de verificatie slagen.
      if (!(await this.protectionOk())) return this.fail("blocked", "screen-protection");
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
      if (this.active) this.emitResume();
    } catch {
      this.fail("locked", "error");
    } finally {
      this.inflight = false;
    }
  }

  /** Bevestigt de schermbescherming. Alleen een exact `true` binnen de tijdslimiet telt; fout, uitzondering of time-out = mislukt. */
  private async protectionOk(): Promise<boolean> {
    if (!this.deps.screenProtection) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.deps.protectionTimeoutMs ?? PROTECTION_CHECK_TIMEOUT_MS);
      });
      return (await Promise.race([this.deps.screenProtection(), timeout])) === true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Terugkeer binnen de grens: de app blijft afgeschermd en geldt als niet-ontgrendeld totdat de schermbescherming opnieuw is bevestigd.
   * Alleen de nieuwste bevestiging telt (snelle wisselingen); pas bij succes, een actieve app en een nog ontgrendelde toestand gaat de
   * afscherming op en volgt de hervatting. Mislukking, uitzondering of time-out blokkeert de app.
   */
  private async resumeAfterVerification() {
    const seq = ++this.verifySeq;
    this.set({ shielded: true, verifying: true });
    const ok = await this.protectionOk();
    if (seq !== this.verifySeq) return; // verouderd: een nieuwere gebeurtenis of ontgrendeling is leidend
    if (this.snap.phase !== "unlocked") return;
    if (!ok) {
      this.set({ verifying: false });
      this.fail("blocked", "screen-protection");
      return;
    }
    if (!this.active) {
      this.set({ verifying: false }); // weer weg: afgeschermd laten; de volgende terugkeer start een nieuwe bevestiging
      return;
    }
    this.set({ shielded: false, verifying: false });
    this.emitResume();
  }

  private fail(phase: "locked" | "blocked", failure: LockFailure) {
    this.awayAt = null;
    this.set({ phase, failure, shielded: !this.active, verifying: false });
  }

  /** App wordt inactief of gaat naar de achtergrond (ook systeemoverlays): onmiddellijk afschermen. */
  appInactive(): void {
    if (!this.deps.enabled) return;
    this.active = false;
    this.verifySeq++; // een lopende bevestiging is verouderd; de volgende terugkeer start een nieuwe
    if (this.sessionRequired && this.snap.phase === "unlocked" && this.awayAt === null && !this.inflight) this.awayAt = this.now();
    this.set({ shielded: true });
  }

  /** App is weer actief: opnieuw vergrendelen als de afwezigheid te lang was of de klok niet te vertrouwen is. */
  appActive(): void {
    this.active = true;
    if (!this.deps.enabled) return this.emitResume(); // ontwikkelbrowser: geen vergrendeling, wel gewoon verversen
    if (this.inflight) return; // de eigen prompt veroorzaakt ook voorgrond-/achtergrondwisselingen; het resultaat bepaalt de toestand
    if (this.snap.phase === "unlocked" && !this.sessionRequired) {
      this.set({ shielded: false }); // geen sessie: geen vergrendeling, wel de afscherming van de app-switcher opheffen
      this.emitResume();
      return;
    }
    if (this.snap.phase === "unlocked") {
      const away = this.awayAt;
      this.awayAt = null;
      if (away !== null) {
        const elapsed = this.now() - away;
        if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= BACKGROUND_GRACE_MS) {
          this.set({ phase: "locked", failure: null, shielded: false, verifying: false });
          void this.unlock(); // het systeem vraagt direct opnieuw om verificatie
          return;
        }
      }
      if (this.deps.screenProtection) {
        void this.resumeAfterVerification(); // eerst de schermbescherming bevestigen; pas daarna afscherming op en hervatten
        return;
      }
      this.set({ shielded: false });
      this.emitResume();
      return;
    }
    this.set({ shielded: false });
    // Na een vergrendeling door tijdsverloop of na ontbrekende toestelbeveiliging opnieuw proberen; na een bewuste annulering niet automatisch.
    if (this.snap.phase === "blocked" || (this.snap.phase === "locked" && this.snap.failure === null)) void this.unlock();
  }
}
