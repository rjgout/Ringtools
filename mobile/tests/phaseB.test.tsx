import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ApiClient, ApiRequestError } from "../src/lib/api";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

import { renderUi } from "./ui";
const { UserManager } = await import("../src/screens/UserManager");

afterEach(cleanup);

describe("Geen systeembeheer meer in de app", () => {
  it("de client kent geen beheermodus of /admin-routes meer; alle verzoeken gaan naar de gewone routes", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => { urls.push(url); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "https://x/api", getToken: () => "sessie-token-sessie-token", fetchImpl });
    await api.sessions();
    await api.refresh();
    await api.ringUsers("r1");
    await api.updateRingUser("m1", { churchFunction: "F", role: "HOGERAAD", isRingManager: false, active: true });
    expect(urls).toEqual(["https://x/api/sessions", "https://x/api/auth/refresh", "https://x/api/rings/r1/users", "https://x/api/memberships/m1"]);
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
    for (const gone of ["admin", "adminLogin", "adminVerify", "adminMe", "adminReauth", "adminRings", "adminCreateRing", "adminRenameRing", "adminSetRingActive", "adminSearchUsers"]) {
      expect(gone in api).toBe(false);
    }
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
    auth.value = { api: { ringUsers: vi.fn(async () => ({ users })), updateRingUser }, reauth, requestReauthCode: vi.fn(async () => {}) };
    renderUi(<UserManager ringId="r1" />);
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
      reauth: vi.fn(), requestReauthCode: vi.fn(),
    };
    renderUi(<UserManager ringId="r1" />);
    fireEvent.click(await screen.findByLabelText("Wijzig Anna"));
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/minstens één actieve ringbeheerder/);
  });
});
