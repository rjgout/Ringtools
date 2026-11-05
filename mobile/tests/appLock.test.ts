import { describe, expect, it, vi } from "vitest";
import { BACKGROUND_GRACE_MS, LockController, type AppLockProvider, type AppLockResult } from "../src/lib/appLock";
import { createBiometricAppLockProvider, createLazyAppLockProvider, mapBiometricError } from "../src/lib/biometricAppLock";
import { ROUTE_TTL_MS, RouteInbox } from "../src/lib/routeInbox";

function setup(over: { secure?: boolean | Error; results?: AppLockResult[]; enabled?: boolean; provider?: AppLockProvider | null; active?: boolean } = {}) {
  let t = 1_000_000;
  const results = [...(over.results ?? [])];
  const authenticate = vi.fn(async (): Promise<AppLockResult> => results.shift() ?? { ok: true });
  let secure = over.secure ?? true;
  const deviceSecure = vi.fn(async () => {
    if (secure instanceof Error) throw secure;
    return secure;
  });
  const provider: AppLockProvider | null = over.provider === undefined ? { deviceSecure, authenticate } : over.provider;
  const lock = new LockController({ enabled: over.enabled ?? true, provider, now: () => t, isAppActive: async () => over.active ?? true });
  return {
    lock, authenticate, deviceSecure,
    queue: (...r: AppLockResult[]) => void results.push(...r),
    advance: (ms: number) => void (t += ms),
    setSecure: (v: boolean) => void (secure = v),
    snap: () => lock.getSnapshot(),
  };
}

describe("Appvergrendeling: koude start", () => {
  it("is vóór enige verificatie vergrendeld", () => {
    const s = setup();
    expect(s.snap()).toMatchObject({ phase: "locked", shielded: false, failure: null });
    expect(s.authenticate).not.toHaveBeenCalled();
  });

  it("ontgrendelt alleen na een geslaagde systeemverificatie", async () => {
    const s = setup();
    await s.lock.start();
    expect(s.authenticate).toHaveBeenCalledTimes(1);
    expect(s.snap().phase).toBe("unlocked");
  });

  it("annuleren laat de app vergrendeld en een nieuwe poging kan alsnog slagen", async () => {
    const s = setup({ results: [{ ok: false, reason: "cancelled" }, { ok: true }] });
    await s.lock.start();
    expect(s.snap()).toMatchObject({ phase: "locked", failure: "cancelled" });
    await s.lock.unlock();
    expect(s.snap().phase).toBe("unlocked");
  });

  it.each(["failed", "lockout", "unavailable", "error"] as const)("verificatiefout '%s' laat de app vergrendeld", async (reason) => {
    const s = setup({ results: [{ ok: false, reason }] });
    await s.lock.start();
    expect(s.snap()).toMatchObject({ phase: "locked", failure: reason });
  });

  it("een uitzondering uit de provider is nooit toegang", async () => {
    const provider: AppLockProvider = { deviceSecure: async () => true, authenticate: async () => { throw new Error("plug-in kapot"); } };
    const s = setup({ provider });
    await s.lock.start();
    expect(s.snap()).toMatchObject({ phase: "locked", failure: "error" });
  });

  it("zonder provider (plug-in niet te laden): geblokkeerd, nooit toegang", async () => {
    const s = setup({ provider: null });
    await s.lock.start();
    expect(s.snap()).toMatchObject({ phase: "blocked", failure: "unavailable" });
  });

  it("zonder toestelbeveiliging: geblokkeerd en er wordt niet eens een prompt getoond", async () => {
    const s = setup({ secure: false });
    await s.lock.start();
    expect(s.snap()).toMatchObject({ phase: "blocked", failure: "no-device-security" });
    expect(s.authenticate).not.toHaveBeenCalled();
  });

  it("een fout bij de beveiligingscontrole blokkeert", async () => {
    const s = setup({ secure: new Error("kapot") });
    await s.lock.start();
    expect(s.snap().phase).toBe("blocked");
    expect(s.authenticate).not.toHaveBeenCalled();
  });

  it("gelijktijdige ontgrendelpogingen starten maar één prompt", async () => {
    const s = setup();
    await Promise.all([s.lock.unlock(), s.lock.unlock(), s.lock.unlock()]);
    expect(s.authenticate).toHaveBeenCalledTimes(1);
  });

  it("uitgeschakeld (alleen gewone browser tijdens ontwikkelen): altijd ontgrendeld, nooit afgeschermd", async () => {
    const s = setup({ enabled: false, provider: null });
    await s.lock.start();
    s.lock.appInactive();
    s.lock.appActive();
    expect(s.snap()).toMatchObject({ phase: "unlocked", shielded: false });
  });
});

describe("Appvergrendeling: achtergrond en hervatten (30 seconden)", () => {
  async function unlocked(over: Parameters<typeof setup>[0] = {}) {
    const s = setup(over);
    await s.lock.start();
    expect(s.snap().phase).toBe("unlocked");
    s.authenticate.mockClear();
    return s;
  }

  it("schermt onmiddellijk af zodra de app inactief wordt en heft dat op bij terugkeer", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    expect(s.snap().shielded).toBe(true);
    s.lock.appActive();
    expect(s.snap()).toMatchObject({ shielded: false, phase: "unlocked" });
  });

  it("terug binnen 30 seconden: geen nieuwe verificatie", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.advance(BACKGROUND_GRACE_MS - 1);
    s.lock.appActive();
    expect(s.snap().phase).toBe("unlocked");
    expect(s.authenticate).not.toHaveBeenCalled();
  });

  it("na precies 30 seconden of langer: opnieuw vergrendeld en direct een nieuwe prompt", async () => {
    const s = await unlocked();
    s.queue({ ok: false, reason: "cancelled" });
    s.lock.appInactive();
    s.advance(BACKGROUND_GRACE_MS);
    s.lock.appActive();
    await vi.waitFor(() => expect(s.snap().phase).toBe("locked"));
    expect(s.authenticate).toHaveBeenCalledTimes(1);
    expect(s.snap().failure).toBe("cancelled"); // de prompt werd geannuleerd: de app blijft vergrendeld
  });

  it("een klok die terugloopt of onbetrouwbaar is, vergrendelt (fail-closed)", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.advance(-5_000);
    s.lock.appActive();
    await vi.waitFor(() => expect(s.authenticate).toHaveBeenCalledTimes(1));
  });

  it("herhaalde inactief-meldingen verversen de afwezigheidsklok niet (snelle wisselingen zijn geen omweg)", async () => {
    const s = await unlocked();
    s.lock.appInactive();
    s.advance(20_000);
    s.lock.appInactive(); // bijvoorbeeld een tweede overlay; de eerste vertrektijd blijft gelden
    s.advance(11_000);
    s.lock.appActive();
    await vi.waitFor(() => expect(s.authenticate).toHaveBeenCalledTimes(1));
  });

  it("kort wisselen blijft zonder verificatie, elke afwezigheid wordt apart gemeten", async () => {
    const s = await unlocked();
    for (let i = 0; i < 5; i++) {
      s.lock.appInactive();
      s.advance(10_000);
      s.lock.appActive();
    }
    expect(s.snap().phase).toBe("unlocked");
    expect(s.authenticate).not.toHaveBeenCalled();
  });

  it("annuleren en daarna terugkeren uit de achtergrond start niet automatisch opnieuw een prompt (geen promptlus)", async () => {
    const s = setup({ results: [{ ok: false, reason: "cancelled" }] });
    await s.lock.start();
    s.authenticate.mockClear();
    s.lock.appInactive();
    expect(s.snap().shielded).toBe(true);
    s.advance(5 * BACKGROUND_GRACE_MS);
    s.lock.appActive();
    expect(s.snap()).toMatchObject({ phase: "locked", failure: "cancelled", shielded: false });
    expect(s.authenticate).not.toHaveBeenCalled();
  });

  it("achtergrond-/voorgrondwisselingen tijdens de prompt zelf veranderen niets aan het beleid", async () => {
    let release: (r: AppLockResult) => void = () => {};
    const authenticate = vi.fn(() => new Promise<AppLockResult>((r) => (release = r)));
    const s = setup({ provider: { deviceSecure: async () => true, authenticate } });
    const started = s.lock.start();
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalled());
    s.lock.appInactive(); // de systeemprompt zet de app tijdelijk inactief
    s.lock.appActive();
    expect(s.snap().phase).toBe("authenticating");
    release({ ok: true });
    await started;
    expect(s.snap()).toMatchObject({ phase: "unlocked", shielded: false });
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("ging de app tijdens de prompt naar de achtergrond en slaagt de verificatie toch, dan blijft de app afgeschermd en loopt de klok", async () => {
    let release: (r: AppLockResult) => void = () => {};
    const authenticate = vi.fn(() => new Promise<AppLockResult>((r) => (release = r)));
    const s = setup({ provider: { deviceSecure: async () => true, authenticate } });
    const started = s.lock.start();
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalled());
    s.lock.appInactive();
    release({ ok: true });
    await started;
    expect(s.snap()).toMatchObject({ phase: "unlocked", shielded: true });
    s.advance(BACKGROUND_GRACE_MS + 1);
    s.lock.appActive();
    await vi.waitFor(() => expect(s.authenticate.mock.calls.length + authenticate.mock.calls.length).toBeGreaterThan(1));
    expect(s.snap().phase).not.toBe("unlocked");
  });

  it("een mislukte prompt terwijl de app inactief is laat het afschermscherm staan tot de app weer actief is", async () => {
    const s = setup({ results: [{ ok: false, reason: "cancelled" }], active: false });
    await s.lock.start();
    expect(s.snap()).toMatchObject({ phase: "locked", shielded: true });
    s.lock.appActive();
    expect(s.snap().shielded).toBe(false);
  });

  it("toestel eerst zonder, later met schermvergrendeling: bij terugkeer wordt opnieuw gecontroleerd", async () => {
    const s = setup({ secure: false });
    await s.lock.start();
    expect(s.snap().phase).toBe("blocked");
    s.setSecure(true);
    s.lock.appInactive();
    s.lock.appActive();
    await vi.waitFor(() => expect(s.snap().phase).toBe("unlocked"));
  });

  it("beveiliging verdwijnt terwijl de app ontgrendeld is: na 30 seconden geblokkeerd", async () => {
    const s = await unlocked();
    s.setSecure(false);
    s.lock.appInactive();
    s.advance(BACKGROUND_GRACE_MS);
    s.lock.appActive();
    await vi.waitFor(() => expect(s.snap().phase).toBe("blocked"));
    expect(s.authenticate).not.toHaveBeenCalled();
  });
});

describe("Biometrie-adapter", () => {
  it("vraagt iOS/Android om biometrie met terugval op de toestelcode (geen eigen terugval) en sterke Android-biometrie", async () => {
    const plugin = { checkBiometry: vi.fn(async () => ({ deviceIsSecure: true })), authenticate: vi.fn(async () => {}) };
    const p = createBiometricAppLockProvider(plugin);
    expect(await p.deviceSecure()).toBe(true);
    expect(await p.authenticate()).toEqual({ ok: true });
    expect(plugin.authenticate).toHaveBeenCalledWith(expect.objectContaining({ allowDeviceCredential: true, androidBiometryStrength: 1 }));
  });

  it("deviceIsSecure moet exact true zijn", async () => {
    for (const v of [undefined, false, "true", 1]) {
      const p = createBiometricAppLockProvider({ checkBiometry: async () => ({ deviceIsSecure: v as never }), authenticate: async () => {} });
      expect(await p.deviceSecure()).toBe(false);
    }
  });

  it.each([
    ["userCancel", "cancelled"], ["systemCancel", "cancelled"], ["appCancel", "cancelled"],
    ["authenticationFailed", "failed"], ["biometryLockout", "lockout"],
    ["passcodeNotSet", "no-device-security"], ["noDeviceCredential", "no-device-security"],
    ["biometryNotAvailable", "unavailable"], ["biometryNotEnrolled", "unavailable"],
    ["invalidContext", "error"], ["onbekend", "error"], [undefined, "error"],
  ])("foutcode %s wordt %s en is nooit succes", async (code, reason) => {
    expect(mapBiometricError(code)).toBe(reason);
    const p = createBiometricAppLockProvider({ checkBiometry: async () => ({ deviceIsSecure: true }), authenticate: async () => { throw Object.assign(new Error("x"), { code }); } });
    expect(await p.authenticate()).toEqual({ ok: false, reason });
  });

  it("de lazy provider gedraagt zich fail-closed als de plug-in niet laadt", async () => {
    const p = createLazyAppLockProvider(async () => null);
    await expect(p.deviceSecure()).rejects.toThrow();
    expect(await p.authenticate()).toEqual({ ok: false, reason: "error" });
    const lock = new LockController({ enabled: true, provider: p });
    await lock.start();
    expect(lock.getSnapshot().phase).toBe("blocked");
  });
});

describe("Postbus voor deeplinks en meldingen", () => {
  it("bewaart een bestemming in het geheugen, levert hem één keer en laat hem vervallen", () => {
    let t = 0;
    const inbox = new RouteInbox(() => t);
    inbox.push("/roepingen/abc");
    expect(inbox.take()).toBe("/roepingen/abc");
    expect(inbox.take()).toBeNull();
    inbox.push("/roepingen/abc");
    t += ROUTE_TTL_MS + 1;
    expect(inbox.take()).toBeNull();
  });
  it("een nieuwere bestemming vervangt de oude en clear() wist alles", () => {
    const inbox = new RouteInbox();
    inbox.push("/a");
    inbox.push("/b");
    expect(inbox.take()).toBe("/b");
    inbox.push("/c");
    inbox.clear();
    expect(inbox.take()).toBeNull();
  });
  it("meldt abonnees bij een nieuwe bestemming", () => {
    const inbox = new RouteInbox();
    const cb = vi.fn();
    const off = inbox.subscribe(cb);
    inbox.push("/a");
    off();
    inbox.push("/b");
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
