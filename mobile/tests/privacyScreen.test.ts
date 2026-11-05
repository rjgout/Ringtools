import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensurePrivacyScreen, PROTECTION_TIMEOUT_MS } from "../src/lib/privacyScreen";
import { LockController, type AppLockProvider, type AppLockResult } from "../src/lib/appLock";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ensurePrivacyScreen: fail-closed (Android FLAG_SECURE en iOS-afscherming)", () => {
  it("alleen true als de plug-in beschikbaar is en enable() slaagt", async () => {
    const enable = vi.fn(async () => {});
    expect(await ensurePrivacyScreen({ native: true, load: async () => ({ enable }) })).toBe(true);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("plug-in niet geregistreerd of niet te laden: false", async () => {
    expect(await ensurePrivacyScreen({ native: true, load: async () => null })).toBe(false);
    expect(await ensurePrivacyScreen({ native: true, load: async () => { throw new Error("import mislukt"); } })).toBe(false);
  });

  it("enable() weigert (bijvoorbeeld 'UNIMPLEMENTED' of een native fout): false", async () => {
    expect(await ensurePrivacyScreen({ native: true, load: async () => ({ enable: async () => { throw new Error("UNIMPLEMENTED"); } }) })).toBe(false);
  });

  it("enable() hangt: na de tijdslimiet false (geen eeuwig wachten, geen stille doorgang)", async () => {
    const p = ensurePrivacyScreen({ native: true, load: async () => ({ enable: () => new Promise<void>(() => {}) }) });
    await vi.advanceTimersByTimeAsync(PROTECTION_TIMEOUT_MS + 1);
    expect(await p).toBe(false);
  });

  it("alleen een ontwikkelbrowser (geen native platform) heeft niets te verifiëren", async () => {
    expect(await ensurePrivacyScreen({ native: false, load: async () => null })).toBe(true);
  });

  it("zonder opgegeven deps in jsdom (niet native) gedraagt de functie zich als ontwikkelbrowser", async () => {
    expect(await ensurePrivacyScreen()).toBe(true);
  });
});

describe("LockController: zonder aantoonbare schermbescherming geen toegang", () => {
  const ok = (): AppLockProvider => ({ deviceSecure: async () => true, authenticate: vi.fn(async (): Promise<AppLockResult> => ({ ok: true })) });

  it("bescherming mislukt: geblokkeerd, geen toestelcontrole en geen prompt", async () => {
    const provider = ok();
    const deviceSecure = vi.spyOn(provider, "deviceSecure");
    const lock = new LockController({ enabled: true, provider, screenProtection: async () => false });
    await lock.start();
    expect(lock.getSnapshot()).toMatchObject({ phase: "blocked", failure: "screen-protection" });
    expect(deviceSecure).not.toHaveBeenCalled();
    expect(provider.authenticate).not.toHaveBeenCalled();
  });

  it("bescherming gooit een fout: geblokkeerd", async () => {
    const lock = new LockController({ enabled: true, provider: ok(), screenProtection: async () => { throw new Error("native fout"); } });
    await lock.start();
    expect(lock.getSnapshot()).toMatchObject({ phase: "blocked", failure: "screen-protection" });
  });

  it("alleen exact true telt als bescherming", async () => {
    for (const v of [undefined, null, 0, "true", 1]) {
      const lock = new LockController({ enabled: true, provider: ok(), screenProtection: async () => v as never });
      await lock.start();
      expect(lock.getSnapshot().phase).toBe("blocked");
    }
  });

  it("herstelt zodra de bescherming weer lukt (opnieuw proberen / terugkeer)", async () => {
    let good = false;
    const lock = new LockController({ enabled: true, provider: ok(), screenProtection: async () => good });
    await lock.start();
    expect(lock.getSnapshot().phase).toBe("blocked");
    good = true;
    await lock.unlock();
    expect(lock.getSnapshot().phase).toBe("unlocked");
  });

  it("de bescherming wordt bij elke ontgrendeling opnieuw bevestigd", async () => {
    const protection = vi.fn(async () => true);
    let t = 0;
    const lock = new LockController({ enabled: true, provider: ok(), screenProtection: protection, now: () => t });
    await lock.start();
    lock.appInactive();
    t += 31_000;
    lock.appActive();
    await vi.waitFor(() => expect(protection.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("valt de bescherming weg terwijl de app ontgrendeld is (terugkeer binnen 30 s), dan wordt de app direct geblokkeerd", async () => {
    let good = true;
    let t = 0;
    const lock = new LockController({ enabled: true, provider: ok(), screenProtection: async () => good, now: () => t });
    await lock.start();
    expect(lock.getSnapshot().phase).toBe("unlocked");
    good = false;
    lock.appInactive();
    t += 5_000;
    lock.appActive();
    await vi.waitFor(() => expect(lock.getSnapshot()).toMatchObject({ phase: "blocked", failure: "screen-protection" }));
    expect(lock.isUnlocked()).toBe(false);
  });

  it("uitgeschakelde vergrendeling (ontwikkelbrowser) vraagt niets", async () => {
    const protection = vi.fn(async () => false);
    const lock = new LockController({ enabled: false, provider: null, screenProtection: protection });
    await lock.start();
    lock.appActive();
    expect(protection).not.toHaveBeenCalled();
    expect(lock.getSnapshot().phase).toBe("unlocked");
  });

  it("de productie-instantie is bedraad met de schermbescherming als voorwaarde (mag niet stilletjes verdwijnen)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/appLockSources.ts"), "utf8");
    expect(src).toMatch(/screenProtection:\s*\(\)\s*=>\s*ensurePrivacyScreen\(\)/);
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    expect(main).not.toMatch(/enablePrivacyScreen/);
  });
});
