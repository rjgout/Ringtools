import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiRequestError } from "../src/lib/api";
import { nativeCapabilities } from "../src/lib/buildProfile";
import { PasskeyCancelledError, PasskeyError, passkeysUsable, registerPasskeyProvider, getPasskeyProvider, type PasskeyAssertion } from "../src/lib/passkeys";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
vi.mock("../src/screens/AdminLogin", () => ({ AdminLogin: () => null }));

const { Login } = await import("../src/screens/Login");

afterEach(() => {
  cleanup();
  registerPasskeyProvider(null);
});

const ASSERTION: PasskeyAssertion = { id: "c", rawId: "c", type: "public-key", response: { clientDataJSON: "a", authenticatorData: "b", signature: "c" }, clientExtensionResults: {} };

function setup(over: Record<string, unknown> = {}) {
  const api = {
    requestCode: vi.fn(async () => ({ ok: true, message: "Verstuurd." })),
    passkeyOptions: vi.fn(async () => ({ options: { challenge: "ch" } })),
    cancelMfa: vi.fn(async () => ({ ok: true })),
  };
  const signIn = vi.fn(async () => ({ pendingToken: "p".repeat(43), methods: ["passkey" as const] }));
  const finishMfa = vi.fn(async () => {});
  auth.value = { api, signIn, finishMfa, ...over };
  return { api, signIn, finishMfa };
}

async function toCodeStep() {
  render(<Login />);
  fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "eva@example.nl" } });
  fireEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  fireEvent.change(await screen.findByLabelText("Inlogcode uit de e-mail"), { target: { value: "12345678" } });
  fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
}

describe("Native passkeys: clientarchitectuur", () => {
  it("is standaard niet beschikbaar: geen provider, en de Personal Team-build blokkeert het altijd", () => {
    expect(getPasskeyProvider()).toBeNull();
    expect(passkeysUsable(true, false)).toBe(false); // server aan, maar geen provider
    registerPasskeyProvider({ authenticate: async () => ASSERTION });
    expect(passkeysUsable(true, false)).toBe(true);
    expect(passkeysUsable(false, false)).toBe(false); // server uit
    expect(passkeysUsable(true, true)).toBe(false); // beperkte (Personal Team) build
    expect(nativeCapabilities("personal-team").passkeys).toBe(false);
    expect(nativeCapabilities("standard").passkeys).toBe(true);
  });
});

describe("Inloggen met verplichte MFA in de app", () => {
  it("zonder provider: veilige melding, de wachtende login wordt opgeruimd en er is geen advies om MFA uit te zetten", async () => {
    const { api, finishMfa } = setup();
    await toCodeStep();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/nog niet beschikbaar/);
    expect(alert.textContent).not.toMatch(/uitschakel|uitzetten|zet .* uit/i);
    expect(api.cancelMfa).toHaveBeenCalledWith("p".repeat(43));
    expect(api.passkeyOptions).not.toHaveBeenCalled();
    expect(finishMfa).not.toHaveBeenCalled();
    expect(screen.getByLabelText("E-mailadres")).toBeTruthy(); // terug op het beginscherm
  });

  it("met provider: opties → native ceremonie → afronden; pas dan bestaat er een sessie (finishMfa)", async () => {
    const authenticate = vi.fn(async () => ASSERTION);
    registerPasskeyProvider({ authenticate });
    const { api, finishMfa } = setup();
    await toCodeStep();
    await waitFor(() => expect(finishMfa).toHaveBeenCalledWith("p".repeat(43), ASSERTION));
    expect(api.passkeyOptions).toHaveBeenCalledWith("p".repeat(43));
    expect(authenticate).toHaveBeenCalledWith({ challenge: "ch" });
    expect(api.cancelMfa).not.toHaveBeenCalled();
  });

  it("geannuleerde ceremonie: duidelijke melding, opnieuw proberen of annuleren; annuleren ruimt de pending-login op", async () => {
    registerPasskeyProvider({ authenticate: vi.fn().mockRejectedValueOnce(new PasskeyCancelledError()).mockResolvedValue(ASSERTION) });
    const { api, finishMfa } = setup();
    await toCodeStep();
    expect((await screen.findByRole("alert")).textContent).toMatch(/geannuleerd/);
    expect(finishMfa).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Verifiëren met passkey" }));
    await waitFor(() => expect(finishMfa).toHaveBeenCalledTimes(1));

    cleanup();
    registerPasskeyProvider({ authenticate: vi.fn().mockRejectedValue(new PasskeyCancelledError()) });
    const second = setup();
    await toCodeStep();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(second.api.cancelMfa).toHaveBeenCalled());
    expect(api.cancelMfa).not.toHaveBeenCalled();
  });

  it("foute assertion of vergrendeling van de server wordt netjes getoond; bij vergrendeling terug naar het begin", async () => {
    registerPasskeyProvider({ authenticate: async () => ASSERTION });
    const first = setup({ finishMfa: vi.fn().mockRejectedValue(new ApiRequestError(401, "De passkey kon niet worden geverifieerd.", "passkey-failed")) });
    await toCodeStep();
    expect((await screen.findByRole("alert")).textContent).toBe("De passkey kon niet worden geverifieerd.");
    expect(first.api.cancelMfa).not.toHaveBeenCalled(); // opnieuw proberen mag

    cleanup();
    const locked = setup({ finishMfa: vi.fn().mockRejectedValue(new ApiRequestError(429, "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.", "locked")) });
    await toCodeStep();
    await waitFor(() => expect(locked.api.cancelMfa).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toMatch(/Te veel mislukte pogingen/);
  });

  it("een gewone login zonder MFA verandert niet (geen passkey-stap)", async () => {
    const { api } = setup({ signIn: vi.fn(async () => undefined) });
    await toCodeStep();
    await waitFor(() => expect((auth.value.signIn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    expect(api.passkeyOptions).not.toHaveBeenCalled();
    expect(api.cancelMfa).not.toHaveBeenCalled();
  });

  it("niet-herstelbare passkeyfout (niet ondersteund/domein niet gekoppeld): wachtende login opgeruimd en terug naar het begin; herstelbare fout: opnieuw proberen", async () => {
    registerPasskeyProvider({ authenticate: vi.fn().mockRejectedValue(new PasskeyError("domain-not-associated", "De app is nog niet gekoppeld aan de website voor passkeys. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.")) });
    const first = setup();
    await toCodeStep();
    await waitFor(() => expect(first.api.cancelMfa).toHaveBeenCalled());
    expect((await screen.findByRole("alert")).textContent).toMatch(/nog niet gekoppeld/);
    expect(first.finishMfa).not.toHaveBeenCalled();

    cleanup();
    registerPasskeyProvider({ authenticate: vi.fn().mockRejectedValueOnce(new PasskeyError("no-credential", "Er is op dit toestel geen passkey voor jouw account gevonden. Probeer een ander toestel of log in via de webapp.")).mockResolvedValue(ASSERTION) });
    const second = setup();
    await toCodeStep();
    expect((await screen.findByRole("alert")).textContent).toMatch(/geen passkey/);
    expect(second.api.cancelMfa).not.toHaveBeenCalled(); // opnieuw proberen mag
    fireEvent.click(screen.getByRole("button", { name: "Verifiëren met passkey" }));
    await waitFor(() => expect(second.finishMfa).toHaveBeenCalledTimes(1));
  });

  it("netwerkfout tijdens de passkey-stap: melding en opnieuw proberen, de login wordt niet als geslaagd behandeld", async () => {
    registerPasskeyProvider({ authenticate: async () => ASSERTION });
    const finishMfa = vi.fn().mockRejectedValueOnce(new ApiRequestError(0, "Geen verbinding met de server. Controleer je internetverbinding.", "network")).mockResolvedValue(undefined);
    const { api } = setup({ finishMfa });
    await toCodeStep();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Geen verbinding/);
    expect(api.cancelMfa).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Verifiëren met passkey" }));
    await waitFor(() => expect(finishMfa).toHaveBeenCalledTimes(2));
  });
});

describe("Inlogscherm: geen technische uitleg voor gewone gebruikers (E2.5)", () => {
  function withMeta(meta: () => Promise<unknown>, limited = false) {
    const s = setup({});
    (auth.value.api as Record<string, unknown>).meta = vi.fn(meta);
    if (limited) (window as unknown as { __RINGTOOLS_BUILD__?: unknown }).__RINGTOOLS_BUILD__ = { profile: "personal-team" };
    return s;
  }
  afterEach(() => { delete (window as { __RINGTOOLS_BUILD__?: unknown }).__RINGTOOLS_BUILD__; });
  const TECHNICAL = /passkey|authenticator|Secure Enclave|Personal Team|API/i;

  it.each([
    ["server uit", { apiVersion: 1, minAppVersion: "1.0.0", nativePasskeys: false }, false],
    ["server aan met provider", { apiVersion: 1, minAppVersion: "1.0.0", nativePasskeys: true }, false],
    ["Personal Team-build", { apiVersion: 1, minAppVersion: "1.0.0", nativePasskeys: true, nativeTotpLogin: true }, true],
  ])("%s: het inlogscherm toont geen uitleg over passkeys, TOTP, Secure Enclave of Personal Team", async (_n, meta, limited) => {
    withMeta(async () => meta, limited);
    registerPasskeyProvider({ authenticate: async () => ASSERTION });
    render(<Login />);
    await waitFor(() => expect((auth.value.api as { meta: ReturnType<typeof vi.fn> }).meta).toHaveBeenCalled());
    const text = document.body.textContent ?? "";
    expect(text.replace(/Inloggen als beheerder \(webmin\)/, "")).not.toMatch(TECHNICAL);
    expect(screen.getByLabelText("E-mailadres")).toBeTruthy();
  });

  it("meta mislukt: alleen een discrete herstelmelding (na alle pogingen), nooit een gok of technische uitleg", async () => {
    withMeta(async () => { throw new Error("netwerk"); });
    render(<Login />);
    await waitFor(() => expect((auth.value.api as { meta: ReturnType<typeof vi.fn> }).meta).toHaveBeenCalled());
    expect((document.body.textContent ?? "").replace(/Inloggen als beheerder \(webmin\)/, "")).not.toMatch(TECHNICAL);
  });
});
