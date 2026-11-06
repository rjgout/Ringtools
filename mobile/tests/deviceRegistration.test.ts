import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../src/lib/api";
import { nativeDeviceKeys, DeviceKeyError, type DeviceKeyProvider } from "../src/lib/deviceKey";
import { storage } from "../src/lib/storage";
import { registerThisDevice, registrationMessage, normalizeCode } from "../src/lib/deviceRegistration";

function fakeKeys(over: Partial<DeviceKeyProvider> = {}): DeviceKeyProvider & { remove: ReturnType<typeof vi.fn> } {
  return {
    available: () => true,
    create: vi.fn(async () => "SPKI"),
    sign: vi.fn(async () => "SIG"),
    remove: vi.fn(async () => {}),
    ...over,
  } as never;
}
function fakeApi(over: Record<string, unknown> = {}) {
  return {
    claimDevicePairing: vi.fn(async () => ({ registrationToken: "t".repeat(43), challenge: "chal", expiresAt: "x" })),
    completeDevicePairing: vi.fn(async () => ({ ok: true, deviceId: "d1" })),
    ...over,
  } as never;
}

describe("Toestel koppelen (adapter en orchestratie)", () => {
  it("normaliseert de code en gebruikt hetzelfde bericht als de server", () => {
    expect(normalizeCode("abcd-efgh-jklm")).toBe("ABCDEFGHJKLM");
    expect(registrationMessage("C", "I")).toBe("ringtools-device-registration-v1\nC\nI");
  });

  it("succes: claim → sleutel → handtekening over de challenge → afronden; sleutel blijft bewaard", async () => {
    const keys = fakeKeys();
    const api = fakeApi();
    const res = await registerThisDevice(api, "abcd-efgh-jklm", keys);
    expect(res).toEqual({ ok: true });
    const claim = (api as never as { claimDevicePairing: ReturnType<typeof vi.fn> }).claimDevicePairing;
    expect(claim).toHaveBeenCalledWith("ABCDEFGHJKLM");
    const signCall = (keys.sign as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(signCall[1]).toMatch(/^ringtools-device-registration-v1\nchal\n[0-9a-f]{32}$/);
    const complete = (api as never as { completeDevicePairing: ReturnType<typeof vi.fn> }).completeDevicePairing.mock.calls[0][0];
    expect(complete).toMatchObject({ publicKey: "SPKI", signature: "SIG" });
    expect(keys.remove).not.toHaveBeenCalled();
    // unieke tag per registratie
    expect(signCall[0]).toContain(complete.installationId);
  });

  it("te korte code: geen netwerkverzoek, geen sleutel", async () => {
    const keys = fakeKeys();
    const api = fakeApi();
    expect((await registerThisDevice(api, "ABC", keys)).ok).toBe(false);
    expect(keys.create).not.toHaveBeenCalled();
  });

  it("ongeldige code (API-fout): melding van de server, geen sleutel aangemaakt", async () => {
    const keys = fakeKeys();
    const api = fakeApi({ claimDevicePairing: vi.fn(async () => { throw new ApiRequestError(400, "De koppelcode is ongeldig of verlopen.", "invalid-code"); }) });
    const res = await registerThisDevice(api, "AAAA-BBBB-CCCC", keys);
    expect(res).toEqual({ ok: false, message: "De koppelcode is ongeldig of verlopen." });
    expect(keys.create).not.toHaveBeenCalled();
  });

  it("annuleren van de ontgrendeling bij het ondertekenen: sleutel wordt verwijderd, generieke melding zonder plug-indetails", async () => {
    const keys = fakeKeys({ sign: vi.fn(async () => { throw new Error("plugin: secret detail 0xDEADBEEF"); }) });
    const res = await registerThisDevice(fakeApi(), "AAAA-BBBB-CCCC", keys);
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).not.toMatch(/0xDEADBEEF|plugin/);
    expect(keys.remove).toHaveBeenCalledTimes(1);
  });

  it("afronden door de server geweigerd: sleutel wordt verwijderd", async () => {
    const keys = fakeKeys();
    const api = fakeApi({ completeDevicePairing: vi.fn(async () => { throw new ApiRequestError(400, "Het bewijs van bezit van de sleutel is ongeldig.", "invalid-proof"); }) });
    const res = await registerThisDevice(api, "AAAA-BBBB-CCCC", keys);
    expect(res.ok).toBe(false);
    expect(keys.remove).toHaveBeenCalledTimes(1);
  });

  it("niet-native omgeving: niet beschikbaar, adapter weigert en logt niets", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(nativeDeviceKeys.available()).toBe(false);
    await expect(nativeDeviceKeys.create("t")).rejects.toBeInstanceOf(DeviceKeyError);
    const res = await registerThisDevice(fakeApi(), "AAAA-BBBB-CCCC");
    expect(res.ok).toBe(false);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("lokaal opslaan mislukt: er wordt GEEN serverregistratie afgerond en de sleutel wordt verwijderd", async () => {
    const spy = vi.spyOn(storage, "setDeviceKey").mockRejectedValueOnce(new Error("keychain"));
    const keys = fakeKeys();
    const api = fakeApi();
    const res = await registerThisDevice(api, "AAAA-BBBB-CCCC", keys);
    expect(res.ok).toBe(false);
    expect((api as never as { completeDevicePairing: ReturnType<typeof vi.fn> }).completeDevicePairing).not.toHaveBeenCalled();
    expect(keys.remove).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("afronden mislukt: de lokaal opgeslagen verwijzing wordt weer gewist", async () => {
    const clear = vi.spyOn(storage, "clearDeviceKey");
    const api = fakeApi({ completeDevicePairing: vi.fn(async () => { throw new ApiRequestError(400, "x", "invalid-proof"); }) });
    await registerThisDevice(api, "AAAA-BBBB-CCCC", fakeKeys());
    expect(clear).toHaveBeenCalledTimes(1);
    clear.mockRestore();
  });
});
