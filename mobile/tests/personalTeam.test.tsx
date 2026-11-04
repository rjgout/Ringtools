import { beforeEach, describe, expect, it, vi } from "vitest";

/* Gedrag van de pushfunctie in de Personal Team-testbuild en bij ontbrekende pluginondersteuning. */
const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
  removeAllListeners: vi.fn(),
}));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: plugin }));
vi.mock("../src/lib/native", () => ({ isNative: true, platform: "ios" }));
vi.mock("../src/lib/storage", () => ({ storage: { deviceId: vi.fn(async () => "install-0001"), setPushToken: vi.fn(), clearPendingUnregister: vi.fn() } }));
const profile = vi.hoisted(() => ({ nativePush: false }));
vi.mock("../src/lib/buildProfile", async (orig) => ({
  ...(await orig<typeof import("../src/lib/buildProfile")>()),
  nativeCapabilities: () => ({ nativePush: profile.nativePush, universalLinks: profile.nativePush, limited: !profile.nativePush }),
}));
const { registerForPush } = await import("../src/lib/push");

describe("pushregistratie zonder native pushfunctionaliteit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Personal Team-testbuild: geen enkele pluginaanroep, duidelijke melding, geen crash of hang", async () => {
    profile.nativePush = false;
    const api = { registerDevice: vi.fn() };
    const result = await registerForPush(api as never);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/niet beschikbaar in deze testbuild/);
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(plugin.register).not.toHaveBeenCalled();
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it("standaardbuild waarvan de plugin faalt (bijv. ontbrekende entitlement): nette melding i.p.v. een uitzondering", async () => {
    profile.nativePush = true;
    plugin.checkPermissions.mockRejectedValue(new Error("not implemented"));
    const api = { registerDevice: vi.fn() };
    await expect(registerForPush(api as never)).resolves.toMatchObject({ ok: false });
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it("registratie die faalt na toestemming (registrationError) eindigt met een melding, niet met hangen", async () => {
    profile.nativePush = true;
    plugin.checkPermissions.mockResolvedValue({ receive: "granted" });
    const cbs: Record<string, (e: unknown) => void> = {};
    plugin.addListener.mockImplementation(async (ev: string, cb: (e: unknown) => void) => {
      cbs[ev] = cb;
      return { remove: async () => {} };
    });
    plugin.register.mockImplementation(async () => setTimeout(() => cbs.registrationError({ error: "no valid aps-environment" }), 0));
    const result = await registerForPush({ registerDevice: vi.fn() } as never);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/niet gelukt/);
  });
});
