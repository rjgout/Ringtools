import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiClient, ApiRequestError } from "../src/lib/api";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

const { AdminLogin } = await import("../src/screens/AdminLogin");
const { UserManager } = await import("../src/screens/UserManager");
const { AdminHome } = await import("../src/screens/admin/AdminHome");

afterEach(cleanup);

describe("ApiClient: beheermodus", () => {
  it("gebruikt /admin-routes voor sessies, refresh en gebruikersbeheer; het wachtende token alleen in de header", async () => {
    const calls: { url: string; auth: string | null; body: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization ?? null, body: (init.body as string) ?? null });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "https://x/api", getToken: () => "sessie-token-sessie-token", fetchImpl });
    await api.adminVerify("wachtend-token-wachtend", { code: "123456" });
    expect(calls[0]).toMatchObject({ url: "https://x/api/admin/auth/totp", auth: "Bearer wachtend-token-wachtend" });
    expect(calls[0].url).not.toContain("wachtend");
    await api.sessions();
    expect(calls[1].url).toBe("https://x/api/sessions");
    api.admin = true;
    await api.sessions();
    await api.refresh();
    await api.ringUsers("r1");
    await api.updateRingUser("m1", { churchFunction: "F", role: "HOGERAAD", isRingManager: false, active: true });
    expect(calls.slice(2).map((c) => c.url)).toEqual(["https://x/api/admin/sessions", "https://x/api/admin/auth/refresh", "https://x/api/admin/rings/r1/users", "https://x/api/admin/memberships/m1"]);
    api.admin = false;
    await api.ringUsers("r1");
    expect(calls[6].url).toBe("https://x/api/rings/r1/users");
  });
});

describe("AdminLogin: wachtwoord en daarna verplicht TOTP", () => {
  it("rondt pas af na de tweede stap, ondersteunt herstelcodes en wist het wachtwoord uit de state", async () => {
    const adminStart = vi.fn(async () => "pending-token");
    const adminFinish = vi.fn(async () => {});
    auth.value = { adminStart, adminFinish };
    render(<AdminLogin onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText("Gebruikersnaam"), { target: { value: "webmin" } });
    fireEvent.change(screen.getByLabelText("Wachtwoord"), { target: { value: "geheim-geheim" } });
    fireEvent.click(screen.getByRole("button", { name: "Verder" }));
    await screen.findByLabelText("Code uit authenticator-app");
    expect(adminStart).toHaveBeenCalledWith("webmin", "geheim-geheim");
    expect(adminFinish).not.toHaveBeenCalled(); // wachtwoord alleen is geen toegang
    expect(screen.queryByDisplayValue("geheim-geheim")).toBeNull();
    fireEvent.change(screen.getByLabelText("Code uit authenticator-app"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await waitFor(() => expect(adminFinish).toHaveBeenCalledWith("pending-token", { code: "123456" }));
    fireEvent.click(screen.getByText("Gebruik een herstelcode"));
    fireEvent.change(screen.getByLabelText("Herstelcode"), { target: { value: "ABCD-EFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await waitFor(() => expect(adminFinish).toHaveBeenLastCalledWith("pending-token", { recoveryCode: "ABCD-EFGH" }));
  });

  it("toont de servermelding (bijv. TOTP niet ingesteld) en blijft bij stap 1", async () => {
    auth.value = { adminStart: vi.fn(async () => { throw new ApiRequestError(403, "Stel eerst TOTP in via de technische beheeromgeving (web).", "totp-not-configured"); }), adminFinish: vi.fn() };
    render(<AdminLogin onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText("Gebruikersnaam"), { target: { value: "webmin" } });
    fireEvent.change(screen.getByLabelText("Wachtwoord"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Verder" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/TOTP/);
    expect(screen.queryByLabelText("Code uit authenticator-app")).toBeNull();
  });
});

describe("Gebruikersbeheer in de app", () => {
  const users = [{ membershipId: "m1", userId: "u1", name: "Anna", email: "a@b.nl", churchFunction: "Bisschop", role: "HOGERAAD", isRingManager: false, active: true, otherRingCount: 0 }];

  it("herverificatie: bij 'reauth-required' vraagt de app een verse code en herhaalt daarna de actie", async () => {
    let first = true;
    const updateRingUser = vi.fn(async () => {
      if (first) { first = false; throw new ApiRequestError(403, "Bevestig eerst", "reauth-required"); }
      return { ok: true, joinedRounds: 0 };
    });
    const reauth = vi.fn(async () => {});
    auth.value = { api: { ringUsers: vi.fn(async () => ({ users })), updateRingUser }, reauth, requestReauthCode: vi.fn(async () => {}), isAdmin: false };
    render(<UserManager ringId="r1" />);
    fireEvent.click(await screen.findByLabelText("Wijzig Anna"));
    fireEvent.click(screen.getByLabelText(/Ringbeheerder/));
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stuur code" }));
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await waitFor(() => expect(reauth).toHaveBeenCalledWith("12345678"));
    await waitFor(() => expect(updateRingUser).toHaveBeenCalledTimes(2));
    expect(updateRingUser).toHaveBeenLastCalledWith("m1", expect.objectContaining({ isRingManager: true, role: "HOGERAAD", churchFunction: "Bisschop" }));
  });

  it("toont serverregels letterlijk, zoals het behoud van minstens één ringbeheerder", async () => {
    auth.value = {
      api: { ringUsers: vi.fn(async () => ({ users })), updateRingUser: vi.fn(async () => { throw new ApiRequestError(400, "Een ring moet altijd minstens één actieve ringbeheerder hebben.", "ring"); }) },
      reauth: vi.fn(), requestReauthCode: vi.fn(), isAdmin: false,
    };
    render(<UserManager ringId="r1" />);
    fireEvent.click(await screen.findByLabelText("Wijzig Anna"));
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/minstens één actieve ringbeheerder/);
  });
});

describe("Systeembeheer (webmin)", () => {
  it("maakt een ring met de eerste ringbeheerder (functie en rol) aan", async () => {
    const adminCreateRing = vi.fn(async () => ({ id: "n", name: "Ring Zuid" }));
    auth.value = {
      api: { adminRings: vi.fn(async () => ({ rings: [] })), sessions: vi.fn(async () => ({ sessions: [] })), adminCreateRing },
      me: { user: { name: "Webmin" } }, signOut: vi.fn(), reauth: vi.fn(), requestReauthCode: vi.fn(), isAdmin: true,
    };
    render(<AdminHome />);
    fireEvent.click(await screen.findByRole("button", { name: "Nieuwe ring" }));
    fireEvent.change(screen.getByLabelText("Naam van de ring"), { target: { value: "Ring Zuid" } });
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Eva Beheer" } });
    fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "eva@test.nl" } });
    fireEvent.change(screen.getByLabelText("Kerkelijke functie"), { target: { value: "Eerste raadgever" } });
    fireEvent.change(screen.getByLabelText("Ringtools-rol"), { target: { value: "RINGPRESIDIUM" } });
    fireEvent.click(screen.getByRole("button", { name: "Ring aanmaken" }));
    await waitFor(() => expect(adminCreateRing).toHaveBeenCalledWith({ name: "Ring Zuid", churchFunction: "Eerste raadgever", role: "RINGPRESIDIUM", userName: "Eva Beheer", userEmail: "eva@test.nl" }));
  });
});
