import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LockController, type AppLockProvider, type AppLockResult } from "../src/lib/appLock";
import { LockScreen } from "../src/components/AppLock";
import { checkPrivacyScreen, ensurePrivacyScreen, getPrivacyDiagnostics, PROTECTION_TIMEOUT_MS } from "../src/lib/privacyScreen";

// Regressietests voor de iOS-blokkade "De schermbeveiliging … kon niet worden ingeschakeld" (docs/BUGFIX-IOS-SCHERMBESCHERMING.md).

describe("oorzaak: een Capacitor-plug-inproxy mag nooit door een promise heen", () => {
  it("echte @capacitor/core-proxy: uit een async functie teruggeven hangt (bewijs); via een gewoon object werkt het", async () => {
    const proxy = registerPlugin<{ enable(): Promise<void> }>("ThenableProbe", { web: { enable: async () => {}, then: () => new Promise(() => {}) /* de native "then"-aanroep komt nooit tot een resolve */ } as never });
    const never = Symbol("hangt");
    const viaAsync = (async () => proxy)();
    const raced = await Promise.race([viaAsync.then(() => "opgelost"), new Promise((r) => setTimeout(() => r(never), 150))]);
    expect(raced).toBe(never); // de proxy heeft een `then` die nooit oplost: dit was de eeuwige hang op de iPhone
    // Zelfde proxy-soort, maar via een gewoon object aangeroepen (zoals privacyScreen.ts doet): werkt.
    const healthy = registerPlugin<{ enable(): Promise<void> }>("ThenableProbeOk", { web: { enable: async () => {} } as never });
    const viaObject = await (async () => ({ enable: () => healthy.enable() }))();
    await expect(viaObject.enable()).resolves.toBeUndefined();
  });
});

describe("checkPrivacyScreen: elke uitkomst heeft een veilige diagnosecode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("correct geregistreerde plug-in: ok", async () => {
    const enable = vi.fn(async () => {});
    const r = await checkPrivacyScreen({ native: true, available: () => true, load: async () => ({ enable }) });
    expect(r).toMatchObject({ ok: true, code: "ok" });
    expect(enable).toHaveBeenCalledTimes(1);
    expect(getPrivacyDiagnostics()?.code).toBe("ok");
  });

  it("standaardlader met een thenable plug-inobject (zoals de Capacitor-proxy): slaagt, hangt niet", async () => {
    vi.resetModules();
    vi.doMock("@capacitor-community/privacy-screen", () => ({
      PrivacyScreen: { enable: async () => {}, then: () => new Promise(() => {}) }, // gedraagt zich als de proxy
    }));
    const mod = await import("../src/lib/privacyScreen");
    const r = await mod.checkPrivacyScreen({ native: true, available: () => true });
    expect(r).toMatchObject({ ok: true, code: "ok" });
    vi.doUnmock("@capacitor-community/privacy-screen");
  });

  it("ontbrekende native registratie: plugin-missing (geen enable-aanroep)", async () => {
    const enable = vi.fn(async () => {});
    const r = await checkPrivacyScreen({ native: true, available: () => false, load: async () => ({ enable }) });
    expect(r).toMatchObject({ ok: false, code: "plugin-missing" });
    expect(enable).not.toHaveBeenCalled();
  });

  it("lader levert niets of faalt: plugin-missing / load-failed", async () => {
    expect(await checkPrivacyScreen({ native: true, available: () => true, load: async () => null })).toMatchObject({ ok: false, code: "plugin-missing" });
    expect(await checkPrivacyScreen({ native: true, available: () => true, load: async () => { throw new Error("chunk niet geladen"); } })).toMatchObject({ ok: false, code: "load-failed" });
  });

  it("time-out: enable() reageert niet binnen de limiet", async () => {
    const p = checkPrivacyScreen({ native: true, available: () => true, load: async () => ({ enable: () => new Promise<void>(() => {}) }) });
    await vi.advanceTimersByTimeAsync(PROTECTION_TIMEOUT_MS + 1);
    expect(await p).toMatchObject({ ok: false, code: "timeout" });
  });

  it("mislukte activering: enable-failed met alleen een korte foutcode, nooit de berichttekst", async () => {
    const err = Object.assign(new Error("geheim token abc123 in bericht"), { code: "UNIMPLEMENTED" });
    const r = await checkPrivacyScreen({ native: true, available: () => true, load: async () => ({ enable: async () => { throw err; } }) });
    expect(r).toMatchObject({ ok: false, code: "enable-failed", detail: "UNIMPLEMENTED" });
    expect(JSON.stringify(r)).not.toContain("abc123");
  });

  it("alleen een ontwikkelbrowser (niet native) heeft niets te verifiëren", async () => {
    expect(await checkPrivacyScreen({ native: false })).toMatchObject({ ok: true, code: "not-native" });
  });
});

describe("herstel bij opnieuw proberen en terugkeer", () => {
  const provider = (): AppLockProvider => ({ deviceSecure: async () => true, authenticate: vi.fn(async (): Promise<AppLockResult> => ({ ok: true })) });

  it("eerste poging mislukt (geblokkeerd, geen prompt); opnieuw proberen na herstel ontgrendelt normaal", async () => {
    let healthy = false;
    const p = provider();
    const lock = new LockController({
      enabled: true,
      provider: p,
      screenProtection: () => ensurePrivacyScreen({ native: true, available: () => true, load: async () => ({ enable: async () => { if (!healthy) throw new Error("x"); } }) }),
    });
    await lock.start();
    expect(lock.getSnapshot()).toMatchObject({ phase: "blocked", failure: "screen-protection" });
    expect(p.authenticate).not.toHaveBeenCalled(); // nooit ontgrendeld bij een echte beveiligingsfout
    healthy = true;
    await lock.unlock();
    expect(lock.getSnapshot()).toMatchObject({ phase: "unlocked", failure: null });
    expect(p.authenticate).toHaveBeenCalledTimes(1);
  });

  it("terugkeer binnen de grens met mislukte bescherming blokkeert; na herstel (volgende terugkeer/opnieuw proberen) weer toegang", async () => {
    let healthy = true;
    const lock = new LockController({
      enabled: true,
      provider: provider(),
      screenProtection: () => ensurePrivacyScreen({ native: true, available: () => true, load: async () => ({ enable: async () => { if (!healthy) throw new Error("x"); } }) }),
    });
    await lock.start();
    expect(lock.getSnapshot().phase).toBe("unlocked");
    lock.appInactive();
    healthy = false;
    lock.appActive();
    await vi.waitFor(() => expect(lock.getSnapshot()).toMatchObject({ phase: "blocked", failure: "screen-protection" }));
    healthy = true;
    await lock.unlock();
    expect(lock.getSnapshot().phase).toBe("unlocked");
  });
});

describe("melding: correct voor iOS én Android, met veilige diagnostiek", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("iOS noemt de app-switcher en geen schermafbeeldingen (die zijn op iOS bewust niet geblokkeerd)", async () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    await checkPrivacyScreen({ native: true, available: () => false });
    render(<LockScreen phase="blocked" failure="screen-protection" onUnlock={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/app-switcher/);
    expect(alert.textContent).not.toMatch(/schermafbeeldingen/);
    expect(screen.getByTestId("lock-diagnostics").textContent).toMatch(/plugin-missing/);
    expect(screen.getByRole("button", { name: "Opnieuw proberen" })).toBeTruthy();
  });

  it("Android noemt schermafbeeldingen en recente apps", async () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    render(<LockScreen phase="blocked" failure="screen-protection" onUnlock={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/schermafbeeldingen/);
  });
});
