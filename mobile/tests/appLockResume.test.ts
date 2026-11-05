import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LockController, type AppLockResult } from "../src/lib/appLock";

/** Beheersbare schermbeveiligingscontrole: elke aanroep levert een eigen "deferred" op. */
function setup() {
  let t = 1_000_000;
  const pending: Array<{ resolve: (v: boolean) => void; reject: (e: unknown) => void }> = [];
  let immediate: boolean | null = true; // eerste (ontgrendel)controle direct laten slagen
  const protection = vi.fn(
    () =>
      immediate !== null
        ? Promise.resolve(immediate)
        : new Promise<boolean>((resolve, reject) => void pending.push({ resolve, reject }))
  );
  const authenticate = vi.fn(async (): Promise<AppLockResult> => ({ ok: true }));
  const lock = new LockController({
    enabled: true,
    provider: { deviceSecure: async () => true, authenticate },
    screenProtection: protection,
    now: () => t,
  });
  const resumed = vi.fn();
  lock.onResume(resumed);
  return {
    lock, protection, authenticate, resumed, pending,
    advance: (ms: number) => void (t += ms),
    deferNext: () => void (immediate = null),
    snap: () => lock.getSnapshot(),
  };
}

async function unlocked() {
  const s = setup();
  await s.lock.start();
  expect(s.snap().phase).toBe("unlocked");
  s.resumed.mockClear();
  s.deferNext();
  return s;
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("Terugkeer binnen 30 s: de schermbescherming wordt eerst opnieuw bevestigd (fail-closed volgorde)", () => {
  it("tijdens een vertraagde controle blijft alles afgeschermd; geen hervatting, geen toegang", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.advance(5_000);
    s.lock.appActive();
    expect(s.protection).toHaveBeenCalledTimes(2); // ontgrendelen + deze controle
    expect(s.snap()).toMatchObject({ phase: "unlocked", shielded: true }); // afscherming blijft
    expect(s.lock.isUnlocked()).toBe(false); // geen API-verzoeken, geen sessieverversing
    expect(s.resumed).not.toHaveBeenCalled();
  });

  it("pas na bevestigde bescherming: afscherming op, toegang terug, precies één hervatting", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.advance(5_000);
    s.lock.appActive();
    s.pending[0].resolve(true);
    await vi.waitFor(() => expect(s.snap().shielded).toBe(false));
    expect(s.lock.isUnlocked()).toBe(true);
    expect(s.resumed).toHaveBeenCalledTimes(1);
    expect(s.authenticate).toHaveBeenCalledTimes(1); // geen nieuwe prompt binnen de grens
  });

  it("mislukte controle: geblokkeerd, nooit hervat", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.advance(1_000);
    s.lock.appActive();
    s.pending[0].resolve(false);
    await vi.waitFor(() => expect(s.snap()).toMatchObject({ phase: "blocked", failure: "screen-protection" }));
    expect(s.lock.isUnlocked()).toBe(false);
    expect(s.resumed).not.toHaveBeenCalled();
  });

  it("controle die een uitzondering geeft: geblokkeerd", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.lock.appActive();
    s.pending[0].reject(new Error("native fout"));
    await vi.waitFor(() => expect(s.snap().phase).toBe("blocked"));
    expect(s.resumed).not.toHaveBeenCalled();
  });

  it("hangende controle: na de tijdslimiet geblokkeerd (nooit eeuwig afgeschermd-maar-open of stil doorgelaten)", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.lock.appActive();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.snap()).toMatchObject({ phase: "blocked", failure: "screen-protection" });
    expect(s.lock.isUnlocked()).toBe(false);
    expect(s.resumed).not.toHaveBeenCalled();
  });

  it("een late uitkomst van een eerder gestarte controle verandert niets meer nadat is geblokkeerd", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.lock.appActive();
    await vi.advanceTimersByTimeAsync(10_000);
    s.pending[0].resolve(true); // te laat
    await Promise.resolve();
    expect(s.snap().phase).toBe("blocked");
    expect(s.resumed).not.toHaveBeenCalled();
  });

  it("snelle achtergrond-/voorgrondwisselingen: alleen de laatste controle telt; oudere uitkomsten geven geen toegang", async () => {
    const s = await unlocked();
    for (let i = 0; i < 3; i++) {
      s.lock.appInactive();
      s.advance(1_000);
      s.lock.appActive();
    }
    expect(s.pending).toHaveLength(3);
    s.pending[0].resolve(true); // verouderd
    s.pending[1].resolve(true); // verouderd
    await Promise.resolve();
    await Promise.resolve();
    expect(s.snap().shielded).toBe(true);
    expect(s.lock.isUnlocked()).toBe(false);
    expect(s.resumed).not.toHaveBeenCalled();
    s.pending[2].resolve(true);
    await vi.waitFor(() => expect(s.lock.isUnlocked()).toBe(true));
    expect(s.resumed).toHaveBeenCalledTimes(1);
  });

  it("wordt de app weer inactief tijdens de controle, dan gaat de afscherming niet op en volgt geen hervatting", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.lock.appActive();
    s.lock.appInactive(); // opnieuw weg vóór de uitkomst
    s.pending[0].resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.snap().shielded).toBe(true);
    expect(s.resumed).not.toHaveBeenCalled();
    s.deferNext();
    s.lock.appActive(); // terug: een nieuwe controle
    s.pending[1].resolve(true);
    await vi.waitFor(() => expect(s.snap().shielded).toBe(false));
    expect(s.resumed).toHaveBeenCalledTimes(1);
  });

  it("een mislukte oude controle nadat een nieuwere is gestart, beslist niet meer (de nieuwste is leidend)", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.lock.appActive();
    s.lock.appInactive();
    s.lock.appActive();
    s.pending[0].resolve(false); // verouderd
    await Promise.resolve();
    expect(s.snap().phase).toBe("unlocked");
    s.pending[1].resolve(true);
    await vi.waitFor(() => expect(s.lock.isUnlocked()).toBe(true));
  });

  it("de 30-secondenregel blijft: na 30 s of langer vergrendelen en prompt (de bescherming wordt vóór de prompt bevestigd)", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.advance(30_000);
    s.lock.appActive();
    expect(s.snap().phase).toMatch(/locked|authenticating/);
    expect(s.lock.isUnlocked()).toBe(false);
    expect(s.resumed).not.toHaveBeenCalled();
  });

  it("systeemdialogen: alleen inactief worden (zonder voorgrondgebeurtenis) blokkeert niets; verzoeken blijven mogelijk", async () => {
    const s = await unlocked();
    s.lock.appInactive(); // bijvoorbeeld de meldingstoestemming
    expect(s.snap()).toMatchObject({ phase: "unlocked", shielded: true });
    expect(s.lock.isUnlocked()).toBe(true); // de API-registratie na de dialoog mag doorgaan
    expect(s.protection).toHaveBeenCalledTimes(1); // pas bij terugkeer wordt opnieuw gecontroleerd
  });

  it("zonder schermbeveiligingsvoorwaarde (alleen tests/ontwikkelbrowser) gedraagt terugkeer zich als voorheen", async () => {
    const lock = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: async () => ({ ok: true }) } });
    await lock.start();
    const resumed = vi.fn();
    lock.onResume(resumed);
    lock.appInactive();
    lock.appActive();
    expect(lock.getSnapshot().shielded).toBe(false);
    expect(resumed).toHaveBeenCalledTimes(1);
  });
});
