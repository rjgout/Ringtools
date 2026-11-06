import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function setup(methods: ("passkey" | "totp")[] = ["totp"], over: Record<string, unknown> = {}) {
  const api = {
    requestCode: vi.fn(async () => ({ ok: true, message: "Verstuurd." })),
    passkeyOptions: vi.fn(async () => ({ options: { challenge: "ch" } })),
    cancelMfa: vi.fn(async () => ({ ok: true })),
    meta: vi.fn(async () => ({ apiVersion: 1, minAppVersion: "1.0.0", nativeTotpLogin: true })),
  };
  const signIn = vi.fn(async () => ({ pendingToken: "p".repeat(43), methods }));
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
});
