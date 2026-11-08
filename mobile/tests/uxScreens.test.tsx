import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { answerDialog, pickMenuItem, renderUi } from "./ui";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
const { UserManager } = await import("../src/screens/UserManager");
afterEach(cleanup);

const base = { churchFunction: "Hogeraadslid", churchFunctionCode: "HOGERAADSLID", role: "HOGERAAD", isRingManager: false, appointAuthority: "NONE", otherRingCount: 0, invitation: null };
const users = [
  { ...base, membershipId: "m1", userId: "u1", name: "Actief Lid", email: "actief@example.nl", activated: true, activatedAt: "2026-10-01T09:00:00Z", active: true, canResendLoginMail: true, loginMailAvailableAt: null },
  { ...base, membershipId: "m2", userId: "u2", name: "Inactief Lid", email: "inactief@example.nl", activated: true, activatedAt: "2026-10-01T09:00:00Z", active: false },
];

function setup(extra: Record<string, unknown> = {}) {
  const updateRingUser = vi.fn(async () => ({ ok: true }));
  auth.value = { api: { ringUsers: vi.fn(async () => ({ users })), ringInvitations: vi.fn(async () => ({ invitations: [] })), updateRingUser, ...extra }, reauth: vi.fn(), requestReauthCode: vi.fn() };
  renderUi(<UserManager ringId="r1" />);
  return { updateRingUser };
}

describe("Gebruikersbeheer: acties staan bij de rij", () => {
  it("elke rij heeft een eigen menu; geen actieknoppen onderaan de pagina", async () => {
    setup();
    await screen.findByLabelText("Wijzig Actief Lid");
    expect(screen.getByRole("button", { name: "Acties voor Actief Lid" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acties voor Inactief Lid" })).toBeTruthy();
    // Geen formulier onderaan zolang er niets gekozen is.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("Deactiveren vraagt eerst bevestiging met de gevolgen; annuleren voert niets uit", async () => {
    const { updateRingUser } = setup();
    await screen.findByLabelText("Wijzig Actief Lid");
    pickMenuItem("Acties voor Actief Lid", /Deactiveren/);
    const dialog = await screen.findByRole("alertdialog", { name: "Actief Lid deactiveren?" });
    expect(within(dialog).getByText(/kan daarna niet meer inloggen/)).toBeTruthy();
    answerDialog("Annuleren");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(updateRingUser).not.toHaveBeenCalled();
  });

  it("Deactiveren na bevestiging stuurt precies één verzoek, ook bij herhaald tikken", async () => {
    const { updateRingUser } = setup();
    await screen.findByLabelText("Wijzig Actief Lid");
    pickMenuItem("Acties voor Actief Lid", /Deactiveren/);
    const ok = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactiveren" });
    fireEvent.click(ok);
    fireEvent.click(ok);
    await waitFor(() => expect(updateRingUser).toHaveBeenCalledTimes(1));
    expect(updateRingUser).toHaveBeenCalledWith("m1", expect.objectContaining({ active: false }));
  });

  it("een inactief lid kan zonder bevestiging worden geheractiveerd en heeft geen inlogmail-actie", async () => {
    const { updateRingUser } = setup();
    await screen.findByLabelText("Wijzig Inactief Lid");
    fireEvent.click(screen.getByRole("button", { name: "Acties voor Inactief Lid" }));
    const menu = screen.getByRole("menu", { name: "Acties voor Inactief Lid" });
    expect(within(menu).queryByRole("menuitem", { name: /Inlogmail/ })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Heractiveren" }));
    await waitFor(() => expect(updateRingUser).toHaveBeenCalledWith("m2", expect.objectContaining({ active: true })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Wijzigen opent het formulier als sheet bovenaan (niet onderaan de lijst) en Annuleren sluit het", async () => {
    setup();
    await screen.findByLabelText("Wijzig Actief Lid");
    pickMenuItem("Acties voor Actief Lid", "Wijzigen");
    const sheet = await screen.findByRole("dialog", { name: "Gebruiker wijzigen" });
    expect(within(sheet).getByLabelText("Naam")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Annuleren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("de serverfout van een menuactie blijft zichtbaar (geen stille mislukking)", async () => {
    const { ApiRequestError } = await import("../src/lib/api");
    const updateRingUser = vi.fn(async () => { throw new ApiRequestError(400, "Er moet minstens één actieve ringbeheerder overblijven.", "ring"); });
    setup({ updateRingUser });
    await screen.findByLabelText("Wijzig Actief Lid");
    pickMenuItem("Acties voor Actief Lid", /Deactiveren/);
    await screen.findByRole("alertdialog");
    answerDialog("Deactiveren");
    expect(await screen.findByText(/minstens één actieve ringbeheerder/)).toBeTruthy();
  });
});
