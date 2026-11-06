import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { INVITATION_MAX_SENDS, INVITATION_RESEND_COOLDOWN_MS } from "@/lib/invitations";
import { resetDatabase, createTestUser, createTestRing } from "./setup";

// Gebruikersbeheer: toegangsstatus per gebruiker (geactiveerd?, uitnodigingsstatus, verzenddatum, opnieuw versturen) en ontbrekende inlogcodes.
const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));
const { handleApi } = await import("@/lib/api/router");

let ip = 0;
beforeEach(async () => {
  await resetDatabase();
  await prisma.ringInvitation.deleteMany();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, { method, headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` }, body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}) }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const login = async (id: string) => (await createVerifiedSession(id, "Test")).rawToken;

async function world() {
  const ringA = await createTestRing("Ring A");
  const ringB = await createTestRing("Ring B");
  const manager = await createTestUser("RINGSECRETARIS", "Beheerder", { ringId: ringA.id, isRingManager: true });
  const managerB = await createTestUser("RINGSECRETARIS", "Beheerder B", { ringId: ringB.id, isRingManager: true });
  const plain = await createTestUser("RINGSECRETARIS", "Gewone Secretaris", { ringId: ringA.id });
  return { ringA, ringB, manager, managerB, plain, token: await login(manager.id) };
}
type W = Awaited<ReturnType<typeof world>>;

/** Hogeraadslid dat (nog) niet is geactiveerd, met een uitnodiging in een bepaalde toestand. */
async function member(w: W, email: string, opts: { activated?: boolean; inv?: Partial<{ sentAt: Date | null; sendCount: number; acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }> | null } = {}) {
  const u = await prisma.user.create({ data: { name: `Lid ${email}`, email, role: "HOGERAAD", active: true, activatedAt: opts.activated ? new Date("2026-10-01T09:00:00Z") : null } });
  await prisma.ringMembership.create({ data: { userId: u.id, ringId: w.ringA.id, role: "HOGERAAD", churchFunction: "Hogeraadslid", churchFunctionCode: "HOGERAADSLID" } });
  let inv = null;
  if (opts.inv !== null) {
    inv = await prisma.ringInvitation.create({
      data: {
        ringId: w.ringA.id, createdById: w.manager.id, name: u.name, email, role: "HOGERAAD", churchFunction: "Hogeraadslid", churchFunctionCode: "HOGERAADSLID",
        tokenHash: `t-${email}`, codeHash: `c-${email}`, expiresAt: new Date(Date.now() + 5 * 86400_000), sentAt: new Date(Date.now() - 3 * 86400_000), sendCount: 1, ...(opts.inv ?? {}),
      },
    });
  }
  return { u, inv };
}
const users = async (w: W, token = w.token) => (await call("GET", `/rings/${w.ringA.id}/users`, { token })).body.users as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
const row = async (w: W, email: string) => (await users(w)).find((x) => x.email === email)!;

describe("Gebruikerslijst: toegangsstatus en uitnodiging per gebruiker", () => {
  it("niet geactiveerd met verstuurde uitnodiging: status, verzenddatum, verloopdatum en opnieuw versturen mogelijk", async () => {
    const w = await world();
    const { inv } = await member(w, "nieuw@test.nl");
    const r = await row(w, "nieuw@test.nl");
    expect(r.activated).toBe(false);
    expect(r.activatedAt).toBeNull();
    expect(r.invitation).toMatchObject({ id: inv!.id, status: "VERSTUURD", canResend: true, canRevoke: true, resendAvailableAt: null, resendBlockedReason: null });
    expect(r.invitation.sentAt).toBe(inv!.sentAt!.toISOString());
  });

  it("net verstuurd: de wachttijd voor opnieuw versturen wordt getoond (vroegste moment)", async () => {
    const w = await world();
    const sent = new Date(Date.now() - 60_000);
    await member(w, "net@test.nl", { inv: { sentAt: sent } });
    const r = await row(w, "net@test.nl");
    expect(r.invitation.resendAvailableAt).toBe(new Date(sent.getTime() + INVITATION_RESEND_COOLDOWN_MS).toISOString());
  });

  it("niet verstuurd, verlopen, ingetrokken, geaccepteerd en limiet bereikt hebben elk de juiste status en mogelijkheden", async () => {
    const w = await world();
    await member(w, "nv@test.nl", { inv: { sentAt: null, sendCount: 0 } });
    await member(w, "exp@test.nl", { inv: { expiresAt: new Date(Date.now() - 1000) } });
    await member(w, "rev@test.nl", { inv: { revokedAt: new Date() } });
    await member(w, "acc@test.nl", { activated: true, inv: { acceptedAt: new Date("2026-10-01T09:00:00Z") } });
    await member(w, "lim@test.nl", { inv: { sendCount: INVITATION_MAX_SENDS } });
    expect((await row(w, "nv@test.nl")).invitation).toMatchObject({ status: "NIET_VERSTUURD", canResend: true });
    expect((await row(w, "exp@test.nl")).invitation).toMatchObject({ status: "VERLOPEN", canResend: true });
    expect((await row(w, "rev@test.nl")).invitation).toMatchObject({ status: "INGETROKKEN", canResend: false, canRevoke: false });
    expect((await row(w, "acc@test.nl")).invitation).toMatchObject({ status: "GEACTIVEERD", canResend: false });
    expect((await row(w, "acc@test.nl")).activatedAt).toBe("2026-10-01T09:00:00.000Z");
    expect((await row(w, "lim@test.nl")).invitation).toMatchObject({ status: "VERSTUURD", canResend: false, resendBlockedReason: "LIMIET" });
  });

  it("bestaande gebruikers zonder uitnodiging (oude accounts) blijven werken: invitation is null", async () => {
    const w = await world();
    await member(w, "oud@test.nl", { activated: true, inv: null });
    const r = await row(w, "oud@test.nl");
    expect(r.invitation).toBeNull();
    expect(r.activated).toBe(true);
  });

  it("de meest recente uitnodiging telt; oudere uitnodigingen voor hetzelfde adres worden niet getoond", async () => {
    const w = await world();
    const { u } = await member(w, "twee@test.nl", { inv: { revokedAt: new Date() } });
    await prisma.ringInvitation.create({
      data: { ringId: w.ringA.id, createdById: w.manager.id, name: u.name, email: "twee@test.nl", role: "HOGERAAD", churchFunction: "x", churchFunctionCode: "HOGERAADSLID", tokenHash: "t-nieuw", codeHash: "c-nieuw", expiresAt: new Date(Date.now() + 86400_000), sentAt: new Date(Date.now() - 3600_000), sendCount: 1 },
    });
    expect((await row(w, "twee@test.nl")).invitation.status).toBe("VERSTUURD");
  });

  it("ringisolatie: een uitnodiging voor hetzelfde adres in een andere ring lekt niet; andere ring en gewone leden zien de lijst niet; nooit token of code", async () => {
    const w = await world();
    await member(w, "gedeeld@test.nl", { inv: null });
    await prisma.ringInvitation.create({
      data: { ringId: w.ringB.id, createdById: w.managerB.id, name: "X", email: "gedeeld@test.nl", role: "HOGERAAD", churchFunction: "x", churchFunctionCode: "HOGERAADSLID", tokenHash: "t-b", codeHash: "c-b", expiresAt: new Date(Date.now() + 86400_000), sentAt: new Date(), sendCount: 1 },
    });
    expect((await row(w, "gedeeld@test.nl")).invitation).toBeNull();
    expect((await call("GET", `/rings/${w.ringA.id}/users`, { token: await login(w.managerB.id) })).status).toBe(404);
    expect((await call("GET", `/rings/${w.ringA.id}/users`, { token: await login(w.plain.id) })).status).toBe(404);
    const raw = JSON.stringify((await call("GET", `/rings/${w.ringA.id}/users`, { token: w.token })).body) + JSON.stringify((await call("GET", `/rings/${w.ringA.id}/invitations`, { token: w.token })).body);
    expect(raw).not.toMatch(/tokenHash|codeHash|t-gedeeld|t-b\b|c-b\b/);
  });

  it("de uitnodigingenlijst bevat verzenddatum, wachttijd en limietreden", async () => {
    const w = await world();
    await member(w, "lijst@test.nl", { inv: { sentAt: new Date(Date.now() - 30_000) } });
    const list = (await call("GET", `/rings/${w.ringA.id}/invitations`, { token: w.token })).body.invitations as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const i = list.find((x) => x.email === "lijst@test.nl")!;
    expect(i).toMatchObject({ status: "VERSTUURD", canResend: true });
    expect(i.sentAt).toBeTruthy();
    expect(i.resendAvailableAt).toBeTruthy();
  });
});

describe("Opnieuw versturen vanuit het gebruikersbeheer: bestaande beveiliging blijft gelden", () => {
  it("werkt na de wachttijd, vereist recente verificatie, begrenst de wachttijd en legt een auditregel vast", async () => {
    const w = await world();
    const { inv } = await member(w, "opnieuw@test.nl", { inv: { sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1000) } });
    const res = await call("POST", `/invitations/${inv!.id}/resend`, { token: w.token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: true });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(await prisma.ringInvitationAudit.count({ where: { invitationId: inv!.id, action: "SENT" } })).toBe(1);
    // Direct daarna: wachttijd, geen tweede mail
    const again = await call("POST", `/invitations/${inv!.id}/resend`, { token: w.token });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    // Verouderde tweede factor: reauth-required
    await prisma.session.updateMany({ data: { mfaAt: new Date(Date.now() - 3600_000) } });
    await prisma.ringInvitation.update({ where: { id: inv!.id }, data: { sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1000) } });
    const stale = await call("POST", `/invitations/${inv!.id}/resend`, { token: w.token });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("reauth-required");
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("andere ring, gewone leden en een al geactiveerde uitnodiging: geweigerd, geen mail", async () => {
    const w = await world();
    const { inv } = await member(w, "x@test.nl", { inv: { sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1000) } });
    const accepted = (await member(w, "acc@test.nl", { activated: true, inv: { acceptedAt: new Date() } })).inv!;
    expect((await call("POST", `/invitations/${inv!.id}/resend`, { token: await login(w.managerB.id) })).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/invitations/${inv!.id}/resend`, { token: await login(w.plain.id) })).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/invitations/${accepted.id}/resend`, { token: w.token })).status).toBeGreaterThanOrEqual(400);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("Ontbrekende inlogcode: wat de server wel en niet verraadt", () => {
  const GENERIC = "Als dit e-mailadres bekend is bij Ringtools";
  it("onbekend adres, niet-geactiveerde uitnodiging zonder account en inactief account krijgen hetzelfde antwoord; alleen een actief account krijgt een mail", async () => {
    const w = await world();
    await prisma.ringInvitation.create({
      data: { ringId: w.ringA.id, createdById: w.manager.id, name: "Alleen Uitgenodigd", email: "uitgenodigd@test.nl", role: "HOGERAAD", churchFunction: "x", churchFunctionCode: "HOGERAADSLID", tokenHash: "t-u", codeHash: "c-u", expiresAt: new Date(Date.now() + 86400_000), sentAt: new Date(), sendCount: 1 },
    });
    const inactive = await createTestUser("HOGERAAD", "Inactief Account", { ringId: w.ringA.id, email: "inactief@test.nl" });
    await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });
    await createTestUser("HOGERAAD", "Actief Account", { ringId: w.ringA.id, email: "actief@test.nl" });

    const answers: string[] = [];
    for (const email of ["onbekend@test.nl", "uitgenodigd@test.nl", "inactief@test.nl", "actief@test.nl"]) {
      const r = await call("POST", "/auth/request-code", { body: { email } });
      expect(r.status, email).toBe(200);
      answers.push(JSON.stringify(r.body));
    }
    expect(new Set(answers).size).toBe(1); // geen verschil in het antwoord: geen accountenumeratie
    expect(JSON.parse(answers[0]).message).toContain(GENERIC);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect((sendMailMock.mock.calls[0][0] as { to: string }).to).toBe("actief@test.nl");
  });

  it("verzendlimiet voor inlogcodes (5 per 15 minuten per adres) geeft een duidelijke melding, ook voor onbekende adressen", async () => {
    await world();
    let last = 200;
    for (let i = 0; i < 6; i++) last = (await call("POST", "/auth/request-code", { body: { email: "limiet@test.nl" } })).status;
    expect(last).toBe(429);
  });

  it("SMTP-storing bij een inlogcode geeft een zichtbare foutmelding (geen stilzwijgend verlies)", async () => {
    const w = await world();
    await createTestUser("HOGERAAD", "Actief Account", { ringId: w.ringA.id, email: "storing@test.nl" });
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    const r = await call("POST", "/auth/request-code", { body: { email: "storing@test.nl" } });
    expect(r.status).toBe(429);
    expect(r.body.error ?? r.body.message).toMatch(/misging|mis bij het versturen|Probeer het later/i);
  });
});
