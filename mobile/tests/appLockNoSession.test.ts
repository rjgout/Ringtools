import { describe, expect, it, vi } from "vitest";
import { BACKGROUND_GRACE_MS, LockController, type AppLockProvider, type AppLockResult } from "../src/lib/appLock";

// E2.5: de appvergrendeling beschermt een BESTAANDE sessie. Zonder sessie direct het inlogscherm, zonder lokale ontgrendeling.
function setup() {
  let t = 1_000_000;
  const authenticate = vi.fn(async (): Promise<AppLockResult> => ({ ok: true }));
  const provider: AppLockProvider = { deviceSecure: async () => true, authenticate };
  const lock = new LockController({ enabled: true, provider, now: () => t, isAppActive: async () => true });
  return { lock, authenticate, advance: (ms: number) => void (t += ms), snap: () => lock.getSnapshot() };
}

describe("Appvergrendeling zonder sessie", () => {
  it("koude start zonder opgeslagen sessie: direct 'ontgrendeld' (inlogscherm), geen Face ID-prompt", async () => {
    const s = setup();
    s.lock.configureSession(false);
    expect(s.snap().phase).toBe("unlocked");
    await s.lock.start();
    expect(s.authenticate).not.toHaveBeenCalled();
    expect(s.snap().phase).toBe("unlocked");
  });

  it("koude start MET sessie (of een mislukte sessiecontrole): volledige vergrendeling en prompt", async () => {
    const s = setup();
    s.lock.configureSession(true);
    expect(s.snap().phase).toBe("locked");
    await s.lock.start();
    expect(s.authenticate).toHaveBeenCalledTimes(1);
  });

  it("zonder aanroep van configureSession blijft het gedrag fail-closed zoals voorheen", async () => {
    const s = setup();
    expect(s.snap().phase).toBe("locked");
    await s.lock.start();
    expect(s.authenticate).toHaveBeenCalledTimes(1);
  });

  it("zonder sessie: ook na meer dan 30 s in de achtergrond geen prompt (afscherming wel tijdens de achtergrond)", async () => {
    const s = setup();
    s.lock.configureSession(false);
    await s.lock.start();
    s.lock.appInactive();
    expect(s.snap().shielded).toBe(true); // appwisselaar blijft afgeschermd
    s.advance(BACKGROUND_GRACE_MS + 5_000);
    s.lock.appActive();
    expect(s.snap()).toMatchObject({ phase: "unlocked", shielded: false });
    expect(s.authenticate).not.toHaveBeenCalled();
  });

  it("inloggen: een zojuist geslaagde aanmelding telt als ontgrendeling (geen tweede prompt); daarna geldt de achtergrondtermijn weer", async () => {
    const s = setup();
    s.lock.configureSession(false);
    await s.lock.start();
    s.lock.sessionStarted(); // AuthProvider: status signedIn
    expect(s.snap().phase).toBe("unlocked");
    expect(s.authenticate).not.toHaveBeenCalled();
    s.lock.appInactive();
    s.advance(10_000);
    s.lock.appActive(); // < 30 s: geen prompt
    await Promise.resolve();
    expect(s.authenticate).not.toHaveBeenCalled();
    s.lock.appInactive();
    s.advance(BACKGROUND_GRACE_MS + 1);
    s.lock.appActive(); // > 30 s met sessie: vergrendelen en prompt
    await vi.waitFor(() => expect(s.authenticate).toHaveBeenCalledTimes(1));
  });

  it("uitloggen/verlopen sessie terwijl ontgrendeld: direct inlogscherm, geen prompt, ook niet na lange achtergrond", async () => {
    const s = setup();
    await s.lock.start();
    expect(s.authenticate).toHaveBeenCalledTimes(1);
    s.lock.sessionEnded();
    expect(s.snap()).toMatchObject({ phase: "unlocked", failure: null });
    s.lock.appInactive();
    s.advance(BACKGROUND_GRACE_MS * 3);
    s.lock.appActive();
    expect(s.authenticate).toHaveBeenCalledTimes(1); // geen tweede prompt
  });

  it("sessie verdwijnt terwijl vergrendeld (bijv. ingetrokken): geen prompt meer nodig, direct inlogscherm", async () => {
    const s = setup();
    await s.lock.start();
    s.lock.appInactive();
    s.advance(BACKGROUND_GRACE_MS + 1);
    s.authenticate.mockResolvedValueOnce({ ok: false, reason: "cancelled" });
    s.lock.appActive();
    await vi.waitFor(() => expect(s.snap().phase).toBe("locked"));
    s.lock.sessionEnded();
    expect(s.snap().phase).toBe("unlocked");
  });

  it("Face ID annuleren bij een bestaande sessie: blijft vergrendeld, niets zichtbaar", async () => {
    const s = setup();
    s.authenticate.mockResolvedValueOnce({ ok: false, reason: "cancelled" });
    s.lock.configureSession(true);
    await s.lock.start();
    expect(s.snap()).toMatchObject({ phase: "locked", failure: "cancelled" });
    expect(s.lock.isUnlocked()).toBe(false);
  });
});
