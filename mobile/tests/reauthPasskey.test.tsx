import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ApiRequestError } from "../src/lib/api";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

const { useReauth } = await import("../src/components/Reauth");

afterEach(cleanup);

/** Kleine testcomponent: voert een "beheeractie" uit die eerst reauth-required geeft. */
function Harness({ action }: { action: () => Promise<string> }) {
  const { run, dialog } = useReauth();
  const [result, setResult] = useState("");
  return (
    <div>
      <button onClick={() => void run(action).then(setResult).catch((e: Error) => setResult(`fout:${e instanceof ApiRequestError ? e.code : e.message}`))}>Actie</button>
      <span data-testid="result">{result}</span>
      {dialog}
    </div>
  );
}
const flaky = () => vi.fn().mockRejectedValueOnce(new ApiRequestError(403, "Bevestig eerst opnieuw", "reauth-required")).mockResolvedValue("gelukt");

describe("Herverificatie voor gevoelige beheeracties", () => {
  it("account met verplichte MFA: vraagt een passkey (geen e-mailcode), probeert de actie daarna opnieuw", async () => {
    const reauthWithPasskey = vi.fn(async () => {});
    const requestReauthCode = vi.fn();
    auth.value = { reauth: vi.fn(), reauthWithPasskey, requestReauthCode, isAdmin: false, me: { user: { mfaEnabled: true } } };
    const action = flaky();
    render(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Actie" }));
    expect(await screen.findByText(/extra verificatie met een passkey/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stuur code" })).toBeNull(); // geen e-mailcode-route voor MFA-accounts
    fireEvent.click(screen.getByRole("button", { name: "Verifiëren met passkey" }));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("gelukt"));
    expect(reauthWithPasskey).toHaveBeenCalledTimes(1);
    expect(requestReauthCode).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("zonder passkey-provider: veilige melding, de actie wordt niet uitgevoerd en er is geen advies om MFA uit te zetten", async () => {
    const reauthWithPasskey = vi.fn().mockRejectedValue(new ApiRequestError(0, "Inloggen met een passkey is in deze versie van de app nog niet beschikbaar. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.", "passkey-unavailable"));
    auth.value = { reauth: vi.fn(), reauthWithPasskey, requestReauthCode: vi.fn(), isAdmin: false, me: { user: { mfaEnabled: true } } };
    const action = flaky();
    render(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Actie" }));
    fireEvent.click(await screen.findByRole("button", { name: "Verifiëren met passkey" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/nog niet beschikbaar/);
    expect(alert.textContent).not.toMatch(/uitschakel|uitzetten/i);
    expect(action).toHaveBeenCalledTimes(1); // niet opnieuw geprobeerd zonder bewijs van de tweede factor
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("fout:cancelled"));
  });

  it("gewone gebruiker zonder MFA houdt de e-mailcode-route; webmin houdt TOTP", async () => {
    auth.value = { reauth: vi.fn(), reauthWithPasskey: vi.fn(), requestReauthCode: vi.fn(async () => {}), isAdmin: false, me: { user: { mfaEnabled: false } } };
    render(<Harness action={flaky()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actie" }));
    expect(await screen.findByRole("button", { name: "Stuur code" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verifiëren met passkey" })).toBeNull();
    cleanup();
    auth.value = { reauth: vi.fn(), reauthWithPasskey: vi.fn(), requestReauthCode: vi.fn(), isAdmin: true, me: { user: { mfaEnabled: true } } };
    render(<Harness action={flaky()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actie" }));
    expect(await screen.findByText(/6-cijferige code uit je authenticator-app/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verifiëren met passkey" })).toBeNull(); // webmin blijft TOTP
  });
});
