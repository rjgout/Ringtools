import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { parseTarget, routeFor } from "../src/lib/links";
import { ApiRequestError } from "../src/lib/api";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown>, finish: vi.fn(async () => {}) }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => ({ status: "signedOut", finishActivation: auth.finish, ...auth.value }) }));
vi.mock("../src/components/Reauth", () => ({ useReauth: () => ({ run: (fn: () => Promise<unknown>) => fn(), dialog: null }) }));

const { Activate } = await import("../src/screens/Activate");
const { UserManager } = await import("../src/screens/UserManager");

afterEach(cleanup);

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

describe("Uitnodigingslinks", () => {
  it("herkent alleen /uitnodiging/<token> op de eigen host; andere hosts en paden worden genegeerd", () => {
    expect(parseTarget(`https://ringapeldoorn.nl/uitnodiging/${TOKEN}`, "ringapeldoorn.nl")).toEqual({ kind: "invite", token: TOKEN });
    expect(parseTarget(`https://evil.example/uitnodiging/${TOKEN}`, "ringapeldoorn.nl")).toBeNull();
    expect(parseTarget(`http://ringapeldoorn.nl/uitnodiging/${TOKEN}`, "ringapeldoorn.nl")).toBeNull();
    expect(parseTarget("/uitnodiging/kort", "ringapeldoorn.nl")).toBeNull();
    expect(parseTarget(`/uitnodiging/${TOKEN}/extra`, "ringapeldoorn.nl")).toBeNull();
    expect(routeFor({ kind: "invite", token: TOKEN })).toBe(`/uitnodiging/${TOKEN}`);
  });
});

describe("Account activeren", () => {
  const FULL = { ok: true as const, signedIn: true as const, mfaRequired: false as const, email: "eva@example.nl", ringName: "Ring Zuid", token: "T".repeat(43), expiresAt: "2030-01-01T00:00:00Z", user: { id: "u1", name: "Eva", email: "eva@example.nl", emailNotificationsEnabled: true, mfaEnabled: false }, rings: [], pendingCount: 0 };

  it("toont de uitnodiging, activeert met één tik, neemt de sessie over, bevestigt kort en gaat vanzelf naar het overzicht (geen tweede e-mailcode)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.finish.mockClear();
    const previewInvitation = vi.fn(async () => ({ valid: true as const, name: "Eva", ringName: "Ring Zuid", roleLabel: "Ringsecretaris", expiresAt: "2030-01-01T00:00:00Z" }));
    const activateInvitation = vi.fn(async () => FULL);
    auth.value = { api: { previewInvitation, activateInvitation } };
    const onFinished = vi.fn();
    render(<Activate token={TOKEN} onFinished={onFinished} onCancel={() => {}} />);
    expect(await screen.findByText("Welkom, Eva")).toBeTruthy();
    expect(screen.getByText(/uitgenodigd voor Ring Zuid/)).toBeTruthy();
    expect(activateInvitation).not.toHaveBeenCalled(); // voorvertoning verbruikt niets
    fireEvent.click(screen.getByRole("button", { name: "Account activeren" }));
    expect(await screen.findByText("Je account is geactiveerd")).toBeTruthy();
    expect(screen.getByText(/Je bent ingelogd bij Ring Zuid/)).toBeTruthy();
    expect(screen.queryByText(/code van 8 cijfers/)).toBeNull();
    expect(activateInvitation).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, issueSession: true }));
    expect(auth.finish).toHaveBeenCalledWith(FULL); // token gaat naar de bestaande beveiligde opslag via finishActivation
    expect(onFinished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith("eva@example.nl", true);
    // Handmatig doorgaan na het automatisch doorgaan geeft geen tweede aanroep.
    fireEvent.click(screen.getByRole("button", { name: "Naar het overzicht" }));
    expect(onFinished).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("direct doorgaan met de knop (zonder te wachten)", async () => {
    auth.finish.mockClear();
    auth.value = { api: { previewInvitation: vi.fn(async () => ({ valid: true as const, name: "Eva", ringName: "Ring Zuid", roleLabel: "x", expiresAt: "2030-01-01T00:00:00Z" })), activateInvitation: vi.fn(async () => FULL) } };
    const onFinished = vi.fn();
    render(<Activate token={TOKEN} onFinished={onFinished} onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Account activeren" }));
    fireEvent.click(await screen.findByRole("button", { name: "Naar het overzicht" }));
    expect(onFinished).toHaveBeenCalledWith("eva@example.nl", true);
  });

  it("verplichte MFA: geen sessie overgenomen; uitleg en door naar inloggen met het e-mailadres", async () => {
    auth.finish.mockClear();
    const activateInvitation = vi.fn(async () => ({ ok: true as const, signedIn: false as const, mfaRequired: true, email: "mfa@example.nl", ringName: "Ring Zuid" }));
    auth.value = { api: { previewInvitation: vi.fn(async () => ({ valid: true as const, name: "Mfa", ringName: "Ring Zuid", roleLabel: "x", expiresAt: "2030-01-01T00:00:00Z" })), activateInvitation } };
    const onFinished = vi.fn();
    render(<Activate token={TOKEN} onFinished={onFinished} onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Account activeren" }));
    expect(await screen.findByText(/passkey/)).toBeTruthy();
    expect(auth.finish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Verder naar inloggen" }));
    expect(onFinished).toHaveBeenCalledWith("mfa@example.nl", false);
  });

  it("is er al iemand ingelogd, dan wordt geen sessie gevraagd en wordt niet van account gewisseld", async () => {
    auth.finish.mockClear();
    const activateInvitation = vi.fn(async () => ({ ok: true as const, signedIn: false as const, mfaRequired: false as const, email: "andere@example.nl", ringName: "Ring Zuid" }));
    auth.value = { status: "signedIn", api: { previewInvitation: vi.fn(async () => ({ valid: true as const, name: "Andere", ringName: "Ring Zuid", roleLabel: "x", expiresAt: "2030-01-01T00:00:00Z" })), activateInvitation } };
    render(<Activate token={TOKEN} onFinished={() => {}} onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Account activeren" }));
    await screen.findByText("Je account is geactiveerd");
    expect(activateInvitation).toHaveBeenCalledWith(expect.objectContaining({ issueSession: false }));
    expect(auth.finish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Terug naar het overzicht" })).toBeTruthy();
  });

  it("verlopen uitnodiging: duidelijke uitleg, geen technische termen, terugval naar activeringscode", async () => {
    auth.value = { api: { previewInvitation: vi.fn(async () => ({ valid: false as const, reason: "expired" as const })), activateInvitation: vi.fn() } };
    render(<Activate token={TOKEN} onFinished={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText("Deze uitnodiging is verlopen")).toBeTruthy();
    expect(screen.getByText(/Vraag de ringbeheerder om de uitnodiging opnieuw te versturen/)).toBeTruthy();
    expect(screen.queryByText(/token|api|server/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Ik heb een activeringscode" })).toBeTruthy();
  });

  it("al gebruikte of ingetrokken link: wijst naar inloggen", async () => {
    const onCancel = vi.fn();
    auth.value = { api: { previewInvitation: vi.fn(async () => ({ valid: false as const, reason: "invalid" as const })), activateInvitation: vi.fn() } };
    render(<Activate token={TOKEN} onFinished={() => {}} onCancel={onCancel} />);
    expect(await screen.findByText("Deze uitnodiging werkt niet (meer)")).toBeTruthy();
    expect(screen.getByText(/Heb je je account al geactiveerd\? Dan kun je gewoon inloggen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Naar inloggen" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("geen verbinding: opnieuw proberen herstelt; een onderbroken activatie kan opnieuw worden gestart", async () => {
    const previewInvitation = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError(0, "Geen verbinding met de server. Controleer je internetverbinding.", "network"))
      .mockResolvedValue({ valid: true, name: "Eva", ringName: "Ring Zuid", roleLabel: "Hoge raad", expiresAt: "2030-01-01T00:00:00Z" });
    const activateInvitation = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError(0, "Geen verbinding met de server. Controleer je internetverbinding.", "network"))
      .mockResolvedValue({ ok: true, signedIn: false, email: "eva@example.nl", ringName: "Ring Zuid", mfaRequired: true });
    auth.value = { api: { previewInvitation, activateInvitation } };
    render(<Activate token={TOKEN} onFinished={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText("Geen verbinding")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Account activeren" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Geen verbinding/);
    fireEvent.click(screen.getByRole("button", { name: "Account activeren" }));
    expect(await screen.findByText("Je account is geactiveerd")).toBeTruthy();
    expect(screen.getByText(/passkey/)).toBeTruthy(); // MFA-account: uitleg, geen omzeiling
  });

  it("handmatig met e-mailadres en code uit de mail (als de link de app niet opent)", async () => {
    const activateInvitation = vi.fn(async () => FULL);
    auth.value = { api: { previewInvitation: vi.fn(), activateInvitation } };
    render(<Activate onFinished={() => {}} onCancel={() => {}} />);
    const button = screen.getByRole("button", { name: "Account activeren" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: " eva@example.nl " } });
    fireEvent.change(screen.getByLabelText("Activeringscode"), { target: { value: "abcd-efgh-jkmn" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Account activeren" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Account activeren" }));
    expect(await screen.findByText("Je account is geactiveerd")).toBeTruthy();
    expect(activateInvitation).toHaveBeenCalledWith(expect.objectContaining({ email: "eva@example.nl", code: "ABCD-EFGH-JKMN" })); // invoer wordt genormaliseerd; de server normaliseert hetzelfde (hoofdletters, zonder streepjes)
  });

  it("foutmelding van de server (bijv. te veel pogingen) blijft zichtbaar en leest als gewone taal", async () => {
    const activateInvitation = vi.fn().mockRejectedValue(new ApiRequestError(429, "Te veel pogingen. Probeer het later opnieuw.", "invitation-rate-limited"));
    auth.value = { api: { previewInvitation: vi.fn(), activateInvitation } };
    render(<Activate onFinished={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "eva@example.nl" } });
    fireEvent.change(screen.getByLabelText("Activeringscode"), { target: { value: "ABCDEFGHJKMN" } });
    fireEvent.click(screen.getByRole("button", { name: "Account activeren" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Te veel pogingen. Probeer het later opnieuw.");
  });
});

describe("Uitnodigen in het gebruikersbeheer", () => {
  const items = [
    { id: "i1", name: "Nieuw Lid", email: "nieuw@example.nl", role: "RINGSECRETARIS", roleLabel: "Ringsecretaris", churchFunction: "", churchFunctionCode: "ONBEKEND", isRingManager: false, status: "VERSTUURD", sentAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-08T00:00:00Z", canResend: true, canRevoke: true },
    { id: "i2", name: "Verlopen Lid", email: "oud@example.nl", role: "HOGERAAD", roleLabel: "Hoge raad", churchFunction: "", churchFunctionCode: "ONBEKEND", isRingManager: false, status: "VERLOPEN", sentAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-08T00:00:00Z", canResend: true, canRevoke: true },
    { id: "i3", name: "Klaar Lid", email: "klaar@example.nl", role: "HOGERAAD", roleLabel: "Hoge raad", churchFunction: "", churchFunctionCode: "ONBEKEND", isRingManager: false, status: "GEACTIVEERD", sentAt: null, expiresAt: "2026-10-08T00:00:00Z", canResend: false, canRevoke: false },
  ];
  const mk = () => ({
    ringUsers: vi.fn(async () => ({ users: [] })),
    ringInvitations: vi.fn(async () => ({ invitations: items })),
    createInvitation: vi.fn(async () => ({ id: "i9", sent: true })),
    resendInvitation: vi.fn(async () => ({ id: "i1", sent: true })),
    revokeInvitation: vi.fn(async () => ({ ok: true })),
    addRingUser: vi.fn(),
  });

  it("toont statussen, verbergt afgeronde uitnodigingen standaard, en kan herinneren en intrekken (geen token of code zichtbaar)", async () => {
    const api = mk();
    auth.value = { api };
    render(<MemoryRouter><UserManager ringId="r1" /></MemoryRouter>);
    expect(await screen.findByText("Nieuw Lid")).toBeTruthy();
    expect(screen.getByText("Verstuurd")).toBeTruthy();
    expect(screen.getByText("Verlopen")).toBeTruthy();
    expect(screen.getByText(/De uitnodiging is verlopen. Verstuur hem opnieuw./)).toBeTruthy();
    expect(screen.queryByText("Klaar Lid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toon alle" }));
    expect(screen.getByText("Account geactiveerd")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/token|activeringscode/i);

    fireEvent.click(screen.getByRole("button", { name: "Herinneren" }));
    await waitFor(() => expect(api.resendInvitation).toHaveBeenCalledWith("i1"));
    fireEvent.click(screen.getAllByRole("button", { name: "Intrekken" })[0]);
    await waitFor(() => expect(api.revokeInvitation).toHaveBeenCalledWith("i1"));
  });

  it("nieuwe gebruikers worden uitgenodigd (geen rechtstreeks account, geen machtigingsveld)", async () => {
    const api = mk();
    auth.value = { api };
    render(<MemoryRouter><UserManager ringId="r1" /></MemoryRouter>);
    await screen.findByText("Nieuw Lid");
    fireEvent.click(screen.getByRole("button", { name: "Uitnodigen" }));
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Pieter Pauw" } });
    fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "pieter@example.nl" } });
    expect(screen.queryByLabelText("Machtiging")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Uitnodiging versturen" }));
    await waitFor(() => expect(api.createInvitation).toHaveBeenCalled());
    expect(api.addRingUser).not.toHaveBeenCalled();
    expect(api.createInvitation.mock.calls[0]).toEqual(["r1", expect.objectContaining({ name: "Pieter Pauw", email: "pieter@example.nl", isRingManager: false })]);
    expect(await screen.findByText(/De uitnodiging is verstuurd naar pieter@example.nl/)).toBeTruthy();
  });
});
