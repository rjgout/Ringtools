import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
import { renderUi } from "./ui";
const { UserManager } = await import("../src/screens/UserManager");
afterEach(cleanup);

const base = { churchFunction: "Hogeraadslid", churchFunctionCode: "HOGERAADSLID", role: "HOGERAAD", isRingManager: false, appointAuthority: "NONE", active: true, otherRingCount: 0 };
const users = [
  { ...base, membershipId: "m1", userId: "u1", name: "Nieuw Lid", email: "nieuw@example.nl", activated: false, activatedAt: null,
    invitation: { id: "i1", status: "VERSTUURD", sentAt: "2026-11-03T10:00:00Z", expiresAt: "2026-11-10T10:00:00Z", canResend: true, canRevoke: true, resendAvailableAt: null, resendBlockedReason: null } },
  { ...base, membershipId: "m2", userId: "u2", name: "Actief Lid", email: "actief@example.nl", activated: true, activatedAt: "2026-10-01T09:00:00Z",
    invitation: { id: "i2", status: "GEACTIVEERD", sentAt: "2026-09-28T10:00:00Z", expiresAt: "2026-10-05T10:00:00Z", canResend: false, canRevoke: false, resendAvailableAt: null, resendBlockedReason: null } },
  { ...base, membershipId: "m3", userId: "u3", name: "Zonder Uitnodiging", email: "zonder@example.nl", activated: false, activatedAt: null, invitation: null, canResendLoginMail: true, loginMailAvailableAt: null },
];

function setup(resend = vi.fn(async () => ({ id: "i1", sent: true }))) {
  auth.value = { api: { ringUsers: vi.fn(async () => ({ users })), ringInvitations: vi.fn(async () => ({ invitations: [] })), resendInvitation: resend }, reauth: vi.fn(), requestReauthCode: vi.fn() };
  renderUi(<UserManager ringId="r1" />);
  return resend;
}

describe("Gebruikersbeheer: toegangsstatus per gebruiker", () => {
  it("elke rij toont geactiveerd of nog niet geactiveerd, en de status en verzenddatum van de uitnodiging", async () => {
    setup();
    const nieuw = within(await screen.findByLabelText("Wijzig Nieuw Lid"));
    expect(nieuw.getByText("Nog niet geactiveerd")).toBeTruthy();
    expect(nieuw.getByText(/Uitnodiging verstuurd op .*geldig tot/)).toBeTruthy();
    const actief = within(screen.getByLabelText("Wijzig Actief Lid"));
    expect(actief.getByText("Geactiveerd")).toBeTruthy();
    expect(actief.getByText(/Uitnodiging geaccepteerd/)).toBeTruthy();
  });

  it("niet geactiveerd met openstaande uitnodiging: duidelijke actie om opnieuw te versturen (zelfde serveractie)", async () => {
    const resend = setup();
    fireEvent.click(await screen.findByLabelText("Wijzig Nieuw Lid"));
    const section = within(await screen.findByLabelText("Toegang en inlogcode"));
    fireEvent.click(section.getByRole("button", { name: "Uitnodiging opnieuw versturen" }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith("i1"));
    expect(await screen.findByText("De uitnodiging is opnieuw verstuurd.")).toBeTruthy();
  });

  it("geactiveerd account: geen knop om opnieuw uit te nodigen, maar uitleg met het e-mailadres en vervolgstappen", async () => {
    const resend = setup();
    fireEvent.click(await screen.findByLabelText("Wijzig Actief Lid"));
    const section = within(await screen.findByLabelText("Toegang en inlogcode"));
    expect(section.queryByRole("button", { name: "Uitnodiging opnieuw versturen" })).toBeNull();
    expect(section.getByText(/lost een ontbrekende inlogcode niet op/)).toBeTruthy();
    expect(section.getByText(/actief@example\.nl/)).toBeTruthy();
    expect(resend).not.toHaveBeenCalled();
  });

  it("account zonder uitnodiging: uitleg dat de persoon zelf een code kan aanvragen", async () => {
    setup();
    fireEvent.click(await screen.findByLabelText("Wijzig Zonder Uitnodiging"));
    const section = within(await screen.findByLabelText("Toegang en inlogcode"));
    expect(section.getByText(/nog nooit is ingelogd/)).toBeTruthy();
    expect(section.queryByRole("button", { name: "Uitnodiging opnieuw versturen" })).toBeNull();
    expect(section.getByRole("button", { name: "Inlogmail opnieuw versturen" })).toBeTruthy();
  });

  it("Inlogmail opnieuw versturen: roept de server aan (herverificatie via run), toont alleen het resultaat en nooit een code", async () => {
    const send = vi.fn(async () => ({ ok: true, message: "Er is een inlogmail verstuurd naar het geregistreerde e-mailadres van dit lid." }));
    setup();
    (auth.value.api as Record<string, unknown>).sendLoginMail = send;
    fireEvent.click(await screen.findByLabelText("Wijzig Zonder Uitnodiging"));
    fireEvent.click(await screen.findByRole("button", { name: "Inlogmail opnieuw versturen" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("r1", "u3"));
    expect(await screen.findByText(/inlogmail verstuurd/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b\d{8}\b/);
  });

  it("geen knop bij een lid met een openstaande uitnodiging; daar blijft Uitnodiging opnieuw versturen", async () => {
    setup();
    fireEvent.click(await screen.findByLabelText("Wijzig Nieuw Lid"));
    const section = within(await screen.findByLabelText("Toegang en inlogcode"));
    expect(section.queryByRole("button", { name: "Inlogmail opnieuw versturen" })).toBeNull();
    expect(section.getByRole("button", { name: "Uitnodiging opnieuw versturen" })).toBeTruthy();
  });

  it("serverweigering (wachttijd of limiet) blijft als melding zichtbaar en er wordt niets als gelukt getoond", async () => {
    const { ApiRequestError } = await import("../src/lib/api");
    const resend = vi.fn(async () => { throw new ApiRequestError(400, "Deze uitnodiging is net verstuurd. Wacht een paar minuten voordat je hem opnieuw verstuurt.", "ring"); });
    setup(resend as never);
    fireEvent.click(await screen.findByLabelText("Wijzig Nieuw Lid"));
    fireEvent.click(await screen.findByRole("button", { name: "Uitnodiging opnieuw versturen" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/net verstuurd/);
    expect(screen.queryByText("De uitnodiging is opnieuw verstuurd.")).toBeNull();
  });
});

describe("Inlogscherm: hulp bij een ontbrekende code (voor iedereen gelijk, geen accountenumeratie)", () => {
  it("na het aanvragen van een code staat er een algemene hint over spammap, adres en uitnodiging activeren", async () => {
    const api = { requestCode: vi.fn(async () => ({ ok: true, message: "Als dit e-mailadres bekend is bij Ringtools, is er een inlogcode verstuurd." })), meta: vi.fn(async () => ({ apiVersion: 1, minAppVersion: "1.0.0" })) };
    auth.value = { api, signIn: vi.fn(), finishMfa: vi.fn(), finishMfaTotp: vi.fn(), signInWithDevice: vi.fn(), cancelMfa: vi.fn() };
    const { Login } = await import("../src/screens/Login");
    renderUi(<Login onHaveInvitation={() => {}} />);
    fireEvent.change(await screen.findByLabelText("E-mailadres"), { target: { value: "lid@example.nl" } });
    fireEvent.click(screen.getByRole("button", { name: "Stuur code" }));
    expect(await screen.findByText(/Geen code ontvangen\? Controleer de spammap/)).toBeTruthy();
    expect(screen.getByText(/Ik heb een uitnodiging/)).toBeTruthy();
  });
});
