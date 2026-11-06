import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiRequestError } from "../src/lib/api";
import { storage } from "../src/lib/storage";
import type { DeviceKeyProvider } from "../src/lib/deviceKey";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
vi.mock("../src/components/Reauth", () => ({ useReauth: () => ({ run: <T,>(fn: () => Promise<T>) => fn(), dialog: null }) }));
vi.mock("../src/lib/deviceLogin", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/deviceLogin")>("../src/lib/deviceLogin");
  return { ...actual, deviceLoginSupported: (k?: unknown, platform?: string) => (platform === undefined ? true : actual.deviceLoginSupported(k as never, platform)) };
});

const lib = await import("../src/lib/deviceEnrollment");
const { DeviceOffer } = await import("../src/components/DeviceOffer");

const ME = { id: "u1", name: "Eva Jansen" };
const PREV = { installationId: "p".repeat(32), tag: "tag-oud", userId: "u1", name: "Eva Jansen" };

function keys(over: Partial<DeviceKeyProvider> = {}) {
  return { available: () => true, create: vi.fn(async () => "SPKI"), sign: vi.fn(async () => "SIG"), remove: vi.fn(async () => {}), ...over } as DeviceKeyProvider & { create: ReturnType<typeof vi.fn>; sign: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
}
function api(over: Record<string, unknown> = {}) {
  return {
    deviceEnrollChallenge: vi.fn(async () => ({ enrollmentId: "e1", challenge: "chal", userId: "u1", expiresAt: "x" })),
    deviceEnrollComplete: vi.fn(async () => ({ ok: true, deviceId: "d1" })),
    deviceStatus: vi.fn(async () => ({ registered: true, loginEnabled: true })),
    meta: vi.fn(async () => ({ apiVersion: 1, minAppVersion: "1.0.0", deviceLogin: true, deviceAutoEnroll: true })),
    ...over,
  };
}
const refNow = async () => JSON.parse((await storage.getDeviceKey()) || "null");

beforeEach(async () => {
  await storage.setDeviceKey("");
  await storage.clearDeviceOfferDeclined();
});
afterEach(() => cleanup());

describe("Face ID automatisch inrichten (library)", () => {
  it("succes: challenge → nieuwe sleutel → handtekening (Face ID) → lokaal vastleggen voor dit account → serverregistratie; eerdere lokale sleutel pas daarna opgeruimd", async () => {
    await storage.setDeviceKey(JSON.stringify(PREV));
    const k = keys();
    const a = api();
    const res = await lib.enrollThisDevice(a as never, ME, k, "ios");
    expect(res).toEqual({ ok: true });
    const msg = k.sign.mock.calls[0][1] as string;
    expect(msg).toMatch(/^ringtools-device-enroll-v1\ne1\nchal\nu1\n[0-9a-f]{32}$/);
    const ref = await refNow();
    expect(ref).toMatchObject({ userId: "u1", name: "Eva Jansen" });
    expect(ref.tag).not.toBe("tag-oud");
    expect((a.deviceEnrollComplete as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ enrollmentId: "e1", publicKey: "SPKI", signature: "SIG", platform: "IOS" });
    expect(k.remove).toHaveBeenCalledWith("tag-oud");
  });

  it("Face ID geannuleerd: geen registratie, nieuwe sleutel verwijderd, lokale toestand ongewijzigd, gebruiker blijft ingelogd (geen fout)", async () => {
    await storage.setDeviceKey(JSON.stringify(PREV));
    const k = keys({ sign: vi.fn(async () => { throw new Error("user cancel"); }) });
    const a = api();
    const res = await lib.enrollThisDevice(a as never, ME, k, "ios");
    expect(res).toMatchObject({ ok: false, cancelled: true });
    expect(a.deviceEnrollComplete).not.toHaveBeenCalled();
    expect(k.remove).toHaveBeenCalledTimes(1);
    expect(k.remove).not.toHaveBeenCalledWith("tag-oud");
    expect(await refNow()).toMatchObject({ tag: "tag-oud" });
  });

  it("sleutelaanmaak mislukt: niets geregistreerd en niets gewijzigd", async () => {
    const k = keys({ create: vi.fn(async () => { throw new Error("se"); }) });
    const a = api();
    const res = await lib.enrollThisDevice(a as never, ME, k, "ios");
    expect(res.ok).toBe(false);
    expect(a.deviceEnrollComplete).not.toHaveBeenCalled();
    expect(await refNow()).toBeNull();
  });

  it("serverregistratie mislukt: vorige lokale koppeling exact hersteld, nieuwe sleutel verwijderd, oude sleutel behouden", async () => {
    await storage.setDeviceKey(JSON.stringify(PREV));
    const k = keys();
    const a = api({ deviceEnrollComplete: vi.fn(async () => { throw new ApiRequestError(400, "De inrichting is verlopen.", "invalid-enrollment"); }) });
    const res = await lib.enrollThisDevice(a as never, ME, k, "ios");
    expect(res).toMatchObject({ ok: false, cancelled: false });
    expect(await refNow()).toEqual(PREV);
    expect(k.remove).toHaveBeenCalledTimes(1);
    expect(k.remove).not.toHaveBeenCalledWith("tag-oud");
  });

  it("zonder eerdere koppeling en een mislukte registratie: geen verdwaalde lokale verwijzing", async () => {
    const a = api({ deviceEnrollComplete: vi.fn(async () => { throw new ApiRequestError(500, "x", null); }) });
    await lib.enrollThisDevice(a as never, ME, keys(), "ios");
    expect(await refNow()).toBeNull();
  });

  it("lokaal opslaan mislukt: er wordt niets op de server afgerond", async () => {
    const spy = vi.spyOn(storage, "setDeviceKey").mockRejectedValueOnce(new Error("keychain"));
    const k = keys();
    const a = api();
    const res = await lib.enrollThisDevice(a as never, ME, k, "ios");
    expect(res.ok).toBe(false);
    expect(a.deviceEnrollComplete).not.toHaveBeenCalled();
    expect(k.remove).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("zonder recente tweede factor (server: reauth-required) of zonder MFA: duidelijke melding, geen sleutel aangemaakt", async () => {
    const k = keys();
    const a = api({ deviceEnrollChallenge: vi.fn(async () => { throw new ApiRequestError(403, "Bevestig opnieuw.", "mfa-required"); }) });
    const res = await lib.enrollThisDevice(a as never, ME, k, "ios");
    expect(res).toMatchObject({ ok: false });
    expect((res as { message: string }).message).toMatch(/extra verificatie/);
    expect(k.create).not.toHaveBeenCalled();
  });

  it("niet op iOS: niet ondersteund en geen netwerkverkeer", async () => {
    const a = api();
    const res = await lib.enrollThisDevice(a as never, ME, keys(), "android");
    expect(res.ok).toBe(false);
    expect(a.deviceEnrollChallenge).not.toHaveBeenCalled();
  });
});

describe("Toestelstatus voor dit account (accountbinding)", () => {
  it("geen lokale sleutel → none; geregistreerd en actief → enabled; gekoppeld maar niet actief → registered", async () => {
    expect(await lib.describeDevice(api() as never, "u1")).toEqual({ kind: "none" });
    await storage.setDeviceKey(JSON.stringify(PREV));
    expect(await lib.describeDevice(api() as never, "u1")).toEqual({ kind: "enabled" });
    expect(await lib.describeDevice(api({ deviceStatus: vi.fn(async () => ({ registered: true, loginEnabled: false })) }) as never, "u1")).toEqual({ kind: "registered" });
  });

  it("lokale sleutel van dit account maar ingetrokken op de server → replace-own; van een ander of onbekend account → conflict (nooit stilzwijgend overnemen)", async () => {
    const gone = api({ deviceStatus: vi.fn(async () => ({ registered: false, loginEnabled: false })) });
    await storage.setDeviceKey(JSON.stringify(PREV));
    expect(await lib.describeDevice(gone as never, "u1")).toEqual({ kind: "replace-own" });
    expect(await lib.describeDevice(gone as never, "u2")).toEqual({ kind: "conflict", ownerName: "Eva Jansen" });
    await storage.setDeviceKey(JSON.stringify({ installationId: "q".repeat(32), tag: "t" })); // oude koppeling zonder eigenaar
    expect(await lib.describeDevice(gone as never, "u1")).toEqual({ kind: "conflict", ownerName: undefined });
  });

  it("status niet op te halen → unknown (geen aanbod)", async () => {
    await storage.setDeviceKey(JSON.stringify(PREV));
    expect(await lib.describeDevice(api({ deviceStatus: vi.fn(async () => { throw new Error("net"); }) }) as never, "u1")).toEqual({ kind: "unknown" });
  });
});

describe("Aanbod na de eerste aanmelding (DeviceOffer)", () => {
  function setup(over: { mfa?: boolean; flag?: boolean; status?: { registered: boolean; loginEnabled: boolean }; ref?: object | null } = {}) {
    const a = api({
      meta: vi.fn(async () => ({ apiVersion: 1, minAppVersion: "1.0.0", deviceLogin: true, deviceAutoEnroll: over.flag !== false })),
      ...(over.status ? { deviceStatus: vi.fn(async () => over.status) } : {}),
    });
    auth.value = { api: a, me: { user: { id: "u1", name: "Eva Jansen", mfaEnabled: over.mfa !== false } } };
    return a;
  }

  it("toont het aanbod voor een gewone gebruiker met MFA zonder lokale koppeling; 'Niet nu' onthoudt de keuze en sluit zonder iets te registreren", async () => {
    const a = setup();
    render(<DeviceOffer />);
    await screen.findByTestId("device-offer");
    expect(screen.getByRole("dialog").textContent).toMatch(/Face ID of, als je toestel dat toestaat, met je toestelcode/);
    fireEvent.click(screen.getByRole("button", { name: "Niet nu" }));
    await waitFor(() => expect(screen.queryByTestId("device-offer")).toBeNull());
    expect(await storage.getDeviceOfferDeclined()).toBe("u1");
    expect(a.deviceEnrollChallenge).not.toHaveBeenCalled();
    cleanup();
    render(<DeviceOffer />); // volgende sessie: niet opnieuw aandringen
    await waitFor(() => expect(a.meta).toHaveBeenCalled());
    expect(screen.queryByTestId("device-offer")).toBeNull();
  });

  it.each([
    ["account zonder verplichte MFA", { mfa: false }],
    ["serverfunctie uit", { flag: false }],
  ])("geen aanbod: %s", async (_n, over) => {
    const a = setup(over);
    render(<DeviceOffer />);
    await waitFor(() => expect(a.meta).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("device-offer")).toBeNull();
  });

  it("toestel al ingesteld en actief voor dit account: geen aanbod (niet opnieuw koppelen)", async () => {
    await storage.setDeviceKey(JSON.stringify(PREV));
    const a = setup({ status: { registered: true, loginEnabled: true } });
    render(<DeviceOffer />);
    await waitFor(() => expect(a.deviceStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("device-offer")).toBeNull();
  });

  it("andere gebruiker op hetzelfde toestel: alleen een expliciet aanbod om over te zetten; zonder bevestiging wordt niets overschreven", async () => {
    await storage.setDeviceKey(JSON.stringify({ ...PREV, userId: "u9", name: "Piet Bakker" }));
    setup({ status: { registered: false, loginEnabled: false } });
    render(<DeviceOffer />);
    const dlg = await screen.findByTestId("device-offer");
    expect(dlg.textContent).toMatch(/al ingesteld voor het account van Piet Bakker/);
    fireEvent.click(screen.getByRole("button", { name: "Niet nu" }));
    await waitFor(() => expect(screen.queryByTestId("device-offer")).toBeNull());
    expect(await refNow()).toMatchObject({ userId: "u9" });
  });
});
