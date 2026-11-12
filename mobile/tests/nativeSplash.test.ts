import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ platform: "ios", system: vi.fn(), picture: vi.fn(), register: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => calls.platform }, registerPlugin: calls.register }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: calls.system } }));
import { hideNativeSplash } from "../src/lib/nativeSplash";
beforeEach(() => { vi.clearAllMocks(); calls.system.mockResolvedValue(undefined); calls.picture.mockResolvedValue(undefined); calls.register.mockReturnValue({ hide: calls.picture }); });
it("iOS behoudt uitsluitend de bestaande splash-hide", async () => {
  calls.platform = "ios"; await hideNativeSplash();
  expect(calls.system).toHaveBeenCalledOnce(); expect(calls.register).not.toHaveBeenCalled();
});
it("Android verwijdert ook de eigen beeldlaag, zelfs bij een fout van de standaardsplash", async () => {
  calls.platform = "android"; calls.system.mockRejectedValueOnce(new Error("niet beschikbaar")); await hideNativeSplash();
  expect(calls.register).toHaveBeenCalledWith("RingtoolsSplash"); expect(calls.picture).toHaveBeenCalledOnce();
});
it("herhaalde hide en een oudere Android-bridge blokkeren de opstart niet", async () => {
  calls.platform = "android"; calls.picture.mockRejectedValue(new Error("oudere bundel"));
  await expect(hideNativeSplash()).resolves.toBeUndefined(); await expect(hideNativeSplash()).resolves.toBeUndefined();
});
