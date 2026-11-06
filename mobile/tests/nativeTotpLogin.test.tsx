import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useServerCapabilities } from "../src/lib/useServerCapabilities";
import { ApiRequestError } from "../src/lib/api";
import { registerPasskeyProvider } from "../src/lib/passkeys";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
vi.mock("../src/screens/AdminLogin", () => ({ AdminLogin: () => null }));

const { Login } = await import("../src/screens/Login");

afterEach(() => {
  cleanup();
  registerPasskeyProvider(null);
});

function setup(methods: ("passkey" | "totp")[] | null = ["totp"], over: Record<string, unknown> = {}) {
  const api = {
    requestCode: vi.fn(async () => ({ ok: true, message: "Verstuurd." })),
    passkeyOptions: vi.fn(async () => ({ options: { challenge: "ch" } })),
    cancelMfa: vi.fn(async () => ({ ok: true })),
    meta: vi.fn(async (): Promise<Record<string, unknown>> => ({ apiVersion: 1, minAppVersion: "1.0.0", nativeTotpLogin: true })),
  };
  const signIn = vi.fn(async () => ({ pendingToken: "p".repeat(43), ...(methods ? { methods } : {}) }));
  const finishMfa = vi.fn(async () => {});
  const finishMfaTotp = vi.fn(async () => {});
  auth.value = { api, signIn, finishMfa, finishMfaTotp, ...over };
  return { api, signIn, finishMfa, finishMfaTotp };
}

async function toTotpStep() {
  render(<Login />);
  fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "eva@example.nl" } });
  fireEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  fireEvent.change(await screen.findByLabelText("Inlogcode uit de e-mail"), { target: { value: "12345678" } });
  fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
}

describe("Inloggen met e-mailcode + authenticator-app in de app", () => {
  it("na de e-mailcode volgt een TOTP-stap; zonder juiste code geen sessie (finishMfaTotp pas na invoer)", async () => {
    const { finishMfaTotp, api } = setup();
    await toTotpStep();
    const input = await screen.findByLabelText("Code uit je authenticator-app");
    expect(finishMfaTotp).not.toHaveBeenCalled();
    expect(api.passkeyOptions).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
    await waitFor(() => expect(finishMfaTotp).toHaveBeenCalledWith("p".repeat(43), { code: "123456" }));
  });

  it("een onjuiste code geeft een melding en laat opnieuw proberen; vergrendeling ruimt de wachtende login op", async () => {
    const { finishMfaTotp, api } = setup();
    finishMfaTotp.mockRejectedValueOnce(new ApiRequestError(401, "Ongeldige code.", "invalid-code"));
    await toTotpStep();
    fireEvent.change(await screen.findByLabelText("Code uit je authenticator-app"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Ongeldige code/);
    expect(api.cancelMfa).not.toHaveBeenCalled();
    finishMfaTotp.mockRejectedValueOnce(new ApiRequestError(429, "Te veel mislukte pogingen.", "locked"));
    fireEvent.change(screen.getByLabelText("Code uit je authenticator-app"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
    await waitFor(() => expect(api.cancelMfa).toHaveBeenCalledWith("p".repeat(43)));
    expect(screen.getByLabelText("E-mailadres")).toBeTruthy(); // terug naar het begin
  });

  it("herstelcode: aparte invoer, wordt als recoveryCode verstuurd", async () => {
    const { finishMfaTotp } = setup();
    await toTotpStep();
    fireEvent.click(await screen.findByRole("button", { name: "Ik heb geen toegang tot mijn authenticator" }));
    fireEvent.change(screen.getByLabelText("Herstelcode"), { target: { value: "ABCDE-FGHJK" } });
    fireEvent.click(screen.getByRole("button", { name: "Inloggen" }));
    await waitFor(() => expect(finishMfaTotp).toHaveBeenCalledWith("p".repeat(43), { recoveryCode: "ABCDE-FGHJK" }));
  });

  it("annuleren ruimt de wachtende login op en brengt terug naar het begin", async () => {
    const { api } = setup();
    await toTotpStep();
    fireEvent.click(await screen.findByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(api.cancelMfa).toHaveBeenCalled());
    expect(screen.getByLabelText("E-mailadres")).toBeTruthy();
  });

  it("alleen passkey beschikbaar maar geen provider: oude veilige melding, geen TOTP-stap", async () => {
    const { finishMfaTotp } = setup(["passkey"]);
    await toTotpStep();
    expect((await screen.findByRole("alert")).textContent).toMatch(/nog niet beschikbaar/);
    expect(finishMfaTotp).not.toHaveBeenCalled();
  });

  it("Personal Team-build: passkey + TOTP → TOTP-stap (passkey is daar nooit beschikbaar, ook niet met een geregistreerde provider)", async () => {
    (window as unknown as { __RINGTOOLS_BUILD__?: unknown }).__RINGTOOLS_BUILD__ = { profile: "personal-team" };
    registerPasskeyProvider({ available: async () => true, authenticate: async () => { throw new Error("mag niet worden aangeroepen"); } } as never);
    try {
      const { api } = setup(["passkey", "totp"]);
      await toTotpStep();
      expect(await screen.findByLabelText("Code uit je authenticator-app")).toBeTruthy();
      expect(api.passkeyOptions).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as { __RINGTOOLS_BUILD__?: unknown }).__RINGTOOLS_BUILD__;
    }
  });

  it("passkey + TOTP met native passkeys UIT (geen provider): na de e-mailcode rechtstreeks naar de authenticatorcode", async () => {
    const { api } = setup(["passkey", "totp"]);
    api.meta.mockResolvedValue({ apiVersion: 1, minAppVersion: "1.0.0", nativePasskeys: false, nativeTotpLogin: true, trustedDevices: true });
    await toTotpStep();
    expect(await screen.findByLabelText("Code uit je authenticator-app")).toBeTruthy();
    expect(api.passkeyOptions).not.toHaveBeenCalled();
    expect(screen.queryByText(/nog niet beschikbaar/)).toBeNull();
  });

  it("ontbrekende methode-informatie: fail closed — geen passkeyroute, geen TOTP-gok, wachtende login opgeruimd, duidelijke melding", async () => {
    const { api, finishMfa, finishMfaTotp } = setup(null);
    await toTotpStep();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/kon niet worden vastgesteld/);
    expect(api.passkeyOptions).not.toHaveBeenCalled();
    expect(api.cancelMfa).toHaveBeenCalledWith("p".repeat(43));
    expect(finishMfa).not.toHaveBeenCalled();
    expect(finishMfaTotp).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Code uit je authenticator-app")).toBeNull();
  });

  it("alleen passkey aangeboden maar niet bruikbaar: veilige melding zonder passkeyroute", async () => {
    const { api } = setup(["passkey"]);
    await toTotpStep();
    expect((await screen.findByRole("alert")).textContent).toMatch(/nog niet beschikbaar/);
    expect(api.passkeyOptions).not.toHaveBeenCalled();
    expect(api.cancelMfa).toHaveBeenCalled();
  });

  it("scherm toont de ingeladen servercapaciteiten: koppelknop en TOTP-tekst, en geen verouderde passkey-melding", async () => {
    const { api } = setup();
    api.meta.mockResolvedValue({ apiVersion: 1, minAppVersion: "1.0.0", nativePasskeys: false, nativeTotpLogin: true, trustedDevices: true });
    render(<Login onLinkDevice={() => {}} />);
    expect(await screen.findByText(/authenticator-app\? Na de inlogcode/)).toBeTruthy();
    expect(screen.queryByText(/Accounts met passkey-verificatie kunnen in de app nog niet inloggen/)).toBeNull();
    expect(screen.getByTestId("build-info").textContent).toMatch(/build .* · server /);
  });
});

describe("Servercapaciteiten (/meta) – mislukt, vertraagd of geblokkeerd", () => {
  const META = { apiVersion: 1, minAppVersion: "1.0.0", nativePasskeys: false, nativeTotpLogin: true, trustedDevices: true };

  it("eerste aanvraag geblokkeerd door de appvergrendeling, daarna automatisch opnieuw: capaciteiten worden alsnog actueel", async () => {
    const meta = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError(0, "Ringtools is vergrendeld. Ontgrendel de app om verder te gaan.", "app-locked"))
      .mockResolvedValue(META);
    const client = { meta } as never;
    const { result } = renderHook(() => useServerCapabilities(client, [5, 5]));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.caps).toEqual({ nativePasskeys: false, nativeTotpLogin: true, trustedDevices: true });
    expect(meta).toHaveBeenCalledTimes(2);
  });

  it("blijvend mislukt: status 'unavailable' zonder aangeboden functies; handmatig opnieuw proberen herstelt", async () => {
    const meta = vi.fn().mockRejectedValue(new Error("netwerk"));
    const client = { meta } as never;
    const { result } = renderHook(() => useServerCapabilities(client, [1, 1]));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.caps).toEqual({ nativePasskeys: false, nativeTotpLogin: false, trustedDevices: false });
    meta.mockResolvedValue(META);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.caps.trustedDevices).toBe(true);
  });

  it("trage /meta: tijdens het wachten geen gokkende melding; resultaat verschijnt zodra het binnenkomt", async () => {
    let resolve!: (v: unknown) => void;
    const meta = vi.fn(() => new Promise((r) => { resolve = r; }));
    const client = { meta } as never;
    const { result } = renderHook(() => useServerCapabilities(client, [5]));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(meta).toHaveBeenCalled());
    await act(async () => { resolve(META); });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
