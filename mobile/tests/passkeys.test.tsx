import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiRequestError } from "../src/lib/api";
import { nativeCapabilities } from "../src/lib/buildProfile";
import { PasskeyCancelledError, passkeysUsable, registerPasskeyProvider, getPasskeyProvider, type PasskeyAssertion } from "../src/lib/passkeys";

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
  const signIn = vi.fn(async () => ({ pendingToken: "p".repeat(43) }));
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
});
