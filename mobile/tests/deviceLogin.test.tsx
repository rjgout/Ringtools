import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiRequestError } from "../src/lib/api";
import { storage } from "../src/lib/storage";
import type { DeviceKeyProvider } from "../src/lib/deviceKey";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
vi.mock("../src/screens/AdminLogin", () => ({ AdminLogin: () => null }));
vi.mock("../src/lib/deviceLogin", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/deviceLogin")>("../src/lib/deviceLogin");
  return { ...actual, deviceLoginSupported: () => true };
});

const lib = await import("../src/lib/deviceLogin");
const { Login } = await import("../src/screens/Login");

afterEach(async () => {
  cleanup();
  await storage.setDeviceKey("");
});

const META_ON = { apiVersion: 1, minAppVersion: "1.0.0", nativePasskeys: false, nativeTotpLogin: true, trustedDevices: true, deviceLogin: true };
const REF = { installationId: "i".repeat(32), tag: "nl.ringapeldoorn.ringtools.devicekey.test" };

function keys(over: Partial<DeviceKeyProvider> = {}): DeviceKeyProvider & { sign: ReturnType<typeof vi.fn> } {
  return { available: () => true, create: vi.fn(async () => "SPKI"), sign: vi.fn(async () => "SIG"), remove: vi.fn(async () => {}), ...over } as never;
}
function apiMock(over: Record<string, unknown> = {}) {
  return {
    meta: vi.fn(async (): Promise<Record<string, unknown>> => META_ON),
    requestCode: vi.fn(async () => ({ ok: true, message: "Verstuurd." })),
    deviceChallenge: vi.fn(async () => ({ challengeId: "c1", challenge: "chal", deviceId: "d1", expiresAt: "x" })),
    deviceLogin: vi.fn(async () => ({ token: "t", expiresAt: "x", user: {}, rings: [], pendingCount: 0 })),
    deviceActivateChallenge: vi.fn(async () => ({ challengeId: "a1", challenge: "achal", deviceId: "d1", expiresAt: "x" })),
    deviceActivateConfirm: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}

describe("Berichtformaat en ondertekening (gelijk aan de server)", () => {
  it("login- en activeringsbericht hebben aparte contextlabels en binden challenge, toestel en installatie", () => {
    const ch = { challengeId: "c", challenge: "x", deviceId: "d" };
    expect(lib.challengeMessage("LOGIN", ch, "inst")).toBe("ringtools-device-login-v1\nc\nx\nd\ninst");
    expect(lib.challengeMessage("ACTIVATE", ch, "inst")).toBe("ringtools-device-login-activate-v1\nc\nx\nd\ninst");
    expect(lib.challengeMessage("LOGIN", ch, "inst")).not.toBe(lib.challengeMessage("ACTIVATE", ch, "inst"));
  });

  it("inloggen: challenge → ondertekenen met de lokale sleutel → server; geen e-mailcode", async () => {
    await storage.setDeviceKey(JSON.stringify(REF));
    const k = keys();
    const api = apiMock();
    const res = await lib.loginWithDeviceKey(api as never, k, "ios");
    expect(res.token).toBe("t");
    expect(k.sign).toHaveBeenCalledWith(REF.tag, `ringtools-device-login-v1\nc1\nchal\nd1\n${REF.installationId}`);
    expect((api.deviceLogin as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ installationId: REF.installationId, challengeId: "c1", signature: "SIG" });
  });

  it("geannuleerde Face ID of ontbrekende sleutel: geen sessie, geen serverlogin, herstelroute zonder automatische herregistratie", async () => {
    await storage.setDeviceKey(JSON.stringify(REF));
    const k = keys({ sign: vi.fn(async () => { throw new Error("user cancel 0xSECRET"); }) });
    const api = apiMock();
    const err = await lib.loginWithDeviceKey(api as never, k, "ios").catch((e) => e);
    expect(err).toBeInstanceOf(lib.DeviceLoginError);
    expect(err.message).toMatch(/Er is niet ingelogd/);
    expect(err.message).toMatch(/koppel dit toestel opnieuw/);
    expect(err.message).not.toMatch(/SECRET/);
    expect(api.deviceLogin).not.toHaveBeenCalled();
    expect(k.create).not.toHaveBeenCalled(); // nooit automatisch herregistreren
  });

  it("geen lokale sleutel of geen iOS: geen netwerkverkeer", async () => {
    const api = apiMock();
    await expect(lib.loginWithDeviceKey(api as never, keys(), "ios")).rejects.toMatchObject({ code: "no-key" });
    expect(api.deviceChallenge).not.toHaveBeenCalled();
    await expect(lib.loginWithDeviceKey(api as never, keys(), "android")).rejects.toMatchObject({ code: "unsupported" });
    await expect(lib.loginWithDeviceKey(api as never, keys({ available: () => false }), "ios")).rejects.toMatchObject({ code: "unsupported" });
  });

  it("ingetrokken/niet geactiveerd toestel: duidelijke melding met herstelroute, sleutel blijft onaangeroerd", () => {
    const msg = lib.deviceLoginMessage(new ApiRequestError(403, "Inloggen met dit toestel is niet beschikbaar.", "device-login-unavailable"));
    expect(msg).toMatch(/niet beschikbaar/);
    expect(msg).toMatch(/koppel dit toestel opnieuw/);
  });

  it("activeren: ondertekent de activeringschallenge (apart contextlabel)", async () => {
    await storage.setDeviceKey(JSON.stringify(REF));
    const k = keys();
    const api = apiMock();
    await lib.activateDeviceLoginKey(api as never, k, "ios");
    expect(k.sign).toHaveBeenCalledWith(REF.tag, `ringtools-device-login-activate-v1\na1\nachal\nd1\n${REF.installationId}`);
    expect(api.deviceActivateConfirm).toHaveBeenCalled();
  });
});

describe("Inlogscherm: Inloggen met Face ID", () => {
  function setup(opts: { deviceLogin?: boolean; key?: boolean; signInWithDevice?: () => Promise<void> } = {}) {
    const api = apiMock({ meta: vi.fn(async () => ({ ...META_ON, deviceLogin: opts.deviceLogin !== false })) });
    const signInWithDevice = vi.fn(opts.signInWithDevice ?? (async () => {}));
    auth.value = { api, signIn: vi.fn(), finishMfa: vi.fn(), finishMfaTotp: vi.fn(), signInWithDevice };
    return { api, signInWithDevice, ready: opts.key !== false ? storage.setDeviceKey(JSON.stringify(REF)) : Promise.resolve() };
  }

  it("knop zichtbaar met serveraanbod + lokale sleutel; klik start de toestelaanmelding zonder e-mailstap", async () => {
    const s = setup();
    await s.ready;
    render(<Login />);
    const btn = await screen.findByRole("button", { name: "Inloggen met Face ID of toestelcode" });
    fireEvent.click(btn);
    await waitFor(() => expect(s.signInWithDevice).toHaveBeenCalledTimes(1));
    expect((s.api.requestCode as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("geen knop zonder lokale sleutel of met de vlag uit; de bestaande e-mailroute blijft", async () => {
    const a = setup({ key: false });
    await a.ready;
    render(<Login />);
    await waitFor(() => expect((a.api.meta as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Inloggen met Face ID of toestelcode" })).toBeNull();
    expect(screen.getByLabelText("E-mailadres")).toBeTruthy();
    cleanup();
    const b = setup({ deviceLogin: false });
    await b.ready;
    render(<Login />);
    await waitFor(() => expect((b.api.meta as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Inloggen met Face ID of toestelcode" })).toBeNull();
  });

  it("mislukte aanmelding toont een melding en laat de gebruiker op het inlogscherm (geen zwakkere terugval)", async () => {
    const s = setup({ signInWithDevice: async () => { throw new lib.DeviceLoginError("De verificatie met dit toestel is geannuleerd of mislukt. Er is niet ingelogd. Lukt het niet?", "cancelled"); } });
    await s.ready;
    render(<Login />);
    fireEvent.click(await screen.findByRole("button", { name: "Inloggen met Face ID of toestelcode" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Er is niet ingelogd/);
    expect(screen.getByLabelText("E-mailadres")).toBeTruthy();
    expect(s.api.requestCode).not.toHaveBeenCalled();
  });
});
