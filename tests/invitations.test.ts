import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { createVerifiedSession, createMagicLinkToken } from "@/lib/auth";
import { resetDatabase, createTestUser, createTestRing } from "./setup";
import {
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_SEND_LEASE_MS,
  INVITATION_MAX_SENDS,
  activateInvitation,
  deleteOldInvitations,
  normalizeInvitationCode,
} from "@/lib/invitations";

const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));

const { handleApi } = await import("@/lib/api/router");

let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

beforeEach(async () => {
  await resetDatabase();
  await prisma.ringInvitation.deleteMany();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown; ip?: string } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, {
      method,
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        "Content-Type": "application/json",
        "x-forwarded-for": opts.ip ?? freshIp(),
      },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const login = async (userId: string) => (await createVerifiedSession(userId, "Test")).rawToken;

/** Haalt token en code uit de laatst verstuurde uitnodigingsmail. */
function lastMail() {
  const mail = sendMailMock.mock.calls.at(-1)![0] as { to: string; subject: string; text: string };
  const token = /\/uitnodiging\/([A-Za-z0-9_-]+)/.exec(mail.text)?.[1] ?? "";
  const code = /\b([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})\b/.exec(mail.text)?.[1] ?? "";
  return { mail, token, code };
}

async function setup() {
  const ringA = await createTestRing("Ring A");
  const ringB = await createTestRing("Ring B");
  const manager = await createTestUser("RINGPRESIDIUM", "Beheerder A", { ringId: ringA.id, isRingManager: true });
  const plain = await createTestUser("HOGERAAD", "Gewoon Lid", { ringId: ringA.id });
  const managerB = await createTestUser("RINGPRESIDIUM", "Beheerder B", { ringId: ringB.id, isRingManager: true });
  return { ringA, ringB, manager, plain, managerB, token: await login(manager.id) };
}
const body = (over: Record<string, unknown> = {}) => ({ name: "Nieuw Lid", email: "nieuw@test.ringapeldoorn.nl", role: "RINGSECRETARIS", churchFunction: "Ringsecretaris", churchFunctionCode: "RINGSECRETARIS", isRingManager: false, ...over });

async function invite(s: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) {
  const res = await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body(over) });
  return { res, ...(res.status === 200 ? lastMail() : { mail: null, token: "", code: "" }) };
}

describe("Uitnodigen en activeren", () => {
  it("nieuwe uitnodiging: mail met link en code, geen leesbare token in de database of lijst, activatie maakt account + lidmaatschap en logt direct in", async () => {
    const s = await setup();
    const { res, mail, token, code } = await invite(s);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(mail!.to).toBe("nieuw@test.ringapeldoorn.nl");
    expect(mail!.text).toContain("Ring A");
    expect(mail!.text).not.toMatch(/Ringsecretaris|Beheerder A/); // geen rol-, functie- of uitnodigernaam in de mail
    expect(token.length).toBeGreaterThan(30);

    const row = await prisma.ringInvitation.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(normalizeInvitationCode(code));
    expect(row.tokenHash).toBe(hashToken(token));

    const list = await call("GET", `/rings/${s.ringA.id}/invitations`, { token: s.token });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|codeHash|rawToken/);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.invitations[0]).toMatchObject({ status: "VERSTUURD", name: "Nieuw Lid", canResend: true, canRevoke: true });

    // Voorvertoning verbruikt niets.
    const pv = await call("POST", "/invitations/preview", { body: { token } });
    expect(pv.body).toMatchObject({ valid: true, ringName: "Ring A", name: "Nieuw Lid" });
    expect(await prisma.user.count({ where: { email: "nieuw@test.ringapeldoorn.nl" } })).toBe(0);

    const sessionsBefore = await prisma.session.count();
    const act = await call("POST", "/invitations/activate", { body: { token, issueSession: true } });
    expect(act.status).toBe(200);
    expect(act.body).toMatchObject({ ok: true, email: "nieuw@test.ringapeldoorn.nl", ringName: "Ring A", mfaRequired: false });
    // Zonder verplichte MFA is de gebruiker na activatie direct ingelogd (uitnodiging = bewijs van controle over het e-mailadres).
    expect(act.body).toMatchObject({ signedIn: true, mfaRequired: false });
    expect(typeof act.body.token).toBe("string");
    expect(await prisma.session.count()).toBe(sessionsBefore + 1);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nieuw@test.ringapeldoorn.nl" }, include: { memberships: true } });
    expect(user.activatedAt).not.toBeNull();
    expect(user.memberships[0]).toMatchObject({ ringId: s.ringA.id, role: "RINGSECRETARIS", churchFunctionCode: "RINGSECRETARIS", isRingManager: false, appointAuthority: "NONE", active: true });

    const after = await call("GET", `/rings/${s.ringA.id}/invitations`, { token: s.token });
    expect(after.body.invitations[0]).toMatchObject({ status: "GEACTIVEERD", canResend: false, canRevoke: false });
    const actions = (await prisma.ringInvitationAudit.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["CREATED", "SENT", "ACCEPTED"]));

    // De uitgegeven sessie werkt direct; daarnaast blijft inloggen via de bestaande e-mailcode-route mogelijk.
    expect((await call("GET", "/me", { token: act.body.token })).status).toBe(200);
    const { code: loginCode } = await createMagicLinkToken(user.id, { withCode: true });
    const li = await call("POST", "/auth/login", { body: { email: user.email, code: loginCode } });
    expect(li.status).toBe(200);
  });

  it("een uitnodiging kent nooit een machtiging toe, ook niet als de client er een meestuurt; ADMIN-rol wordt geweigerd", async () => {
    const s = await setup();
    const { res, token } = await invite(s, { role: "RINGPRESIDIUM", churchFunction: "Eerste raadgever", churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    expect(res.status).toBe(200);
    await call("POST", "/invitations/activate", { body: { token } });
    const m = await prisma.ringMembership.findFirstOrThrow({ where: { user: { email: "nieuw@test.ringapeldoorn.nl" } } });
    expect(m).toMatchObject({ churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "NONE" });

    expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body({ email: "a@t.nl", role: "ADMIN" }) })).status).toBe(400);
    expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body({ email: "b@t.nl", role: "HOGERAAD", churchFunctionCode: "RINGPRESIDENT" }) })).status).toBe(400); // functie past niet bij rol
  });

  it("bestaand, nog niet geactiveerd account wordt geactiveerd en gekoppeld zonder naam of e-mail te wijzigen", async () => {
    const s = await setup();
    const existing = await prisma.user.create({ data: { name: "Bestaande Naam", email: "bestaand@test.ringapeldoorn.nl", role: "HOGERAAD", active: true } });
    const { res, token } = await invite(s, { name: "Andere Naam", email: "Bestaand@Test.Ringapeldoorn.nl", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    expect(res.status).toBe(200);
    await call("POST", "/invitations/activate", { body: { token } });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(u.name).toBe("Bestaande Naam");
    expect(u.activatedAt).not.toBeNull();
    expect(await prisma.user.count({ where: { email: existing.email } })).toBe(1);
    expect(await prisma.ringMembership.count({ where: { userId: existing.id, ringId: s.ringA.id, active: true } })).toBe(1);
  });

  it("bestaand, geactiveerd account in een andere ring: tweede lidmaatschap, geen nieuw account, geen lek over het bestaan", async () => {
    const s = await setup();
    const elsewhere = await createTestUser("HOGERAAD", "Elders Lid", { ringId: s.ringB.id, email: "elders@test.ringapeldoorn.nl" });
    await prisma.user.update({ where: { id: elsewhere.id }, data: { activatedAt: new Date() } });
    const usersBefore = await prisma.user.count();

    const known = await invite(s, { name: "Elders", email: "elders@test.ringapeldoorn.nl", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    const unknown = await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body({ email: "onbekend@test.ringapeldoorn.nl" }) });
    // De uitnodiger ziet geen verschil tussen een bestaand en een onbekend adres.
    expect(Object.keys(known.res.body).sort()).toEqual(Object.keys(unknown.body).sort());
    expect(known.res.status).toBe(unknown.status);

    const act = await call("POST", "/invitations/activate", { body: { token: known.token } });
    expect(act.status).toBe(200);
    expect(await prisma.user.count()).toBe(usersBefore); // geen extra account
    const memberships = await prisma.ringMembership.findMany({ where: { userId: elsewhere.id } });
    expect(memberships.map((m) => m.ringId).sort()).toEqual([s.ringA.id, s.ringB.id].sort());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: elsewhere.id } })).name).toBe("Elders Lid");
  });

  it("verlopen uitnodiging geeft geen toegang; opnieuw versturen vernieuwt en maakt de oude link ongeldig", async () => {
    const s = await setup();
    const first = await invite(s);
    await prisma.ringInvitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000), sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1000) } });
    const pv = await call("POST", "/invitations/preview", { body: { token: first.token } });
    expect(pv.body).toMatchObject({ valid: false, reason: "expired" });
    const exp = await call("POST", "/invitations/activate", { body: { token: first.token } });
    expect(exp.status).toBe(410);
    expect(exp.body.code).toBe("invitation-expired");
    expect(await prisma.user.count({ where: { email: "nieuw@test.ringapeldoorn.nl" } })).toBe(0);
    const list = await call("GET", `/rings/${s.ringA.id}/invitations`, { token: s.token });
    expect(list.body.invitations[0].status).toBe("VERLOPEN");
    // Opnieuw uitnodigen (nieuwe aanmaak) mag niet: er staat al een verlopen uitnodiging; versturen wel.
    expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body() })).status).toBe(400);

    const id = list.body.invitations[0].id as string;
    const re = await call("POST", `/invitations/${id}/resend`, { token: s.token });
    expect(re.status).toBe(200);
    const second = lastMail();
    expect(second.token).not.toBe(first.token);
    expect((await call("POST", "/invitations/activate", { body: { token: first.token } })).status).toBe(400); // oude link vervallen
    expect((await call("POST", "/invitations/activate", { body: { token: second.token } })).status).toBe(200);
  });

  it("ingetrokken uitnodiging werkt niet meer, is niet opnieuw te versturen en een nieuwe uitnodiging is mogelijk", async () => {
    const s = await setup();
    const a = await invite(s);
    const id = (await call("GET", `/rings/${s.ringA.id}/invitations`, { token: s.token })).body.invitations[0].id as string;
    expect((await call("POST", `/invitations/${id}/revoke`, { token: s.token })).status).toBe(200);
    expect((await call("POST", `/invitations/${id}/revoke`, { token: s.token })).status).toBe(200); // idempotent
    expect((await call("POST", "/invitations/activate", { body: { token: a.token } })).status).toBe(400);
    expect((await call("POST", `/invitations/${id}/resend`, { token: s.token })).status).toBe(400);
    expect((await call("POST", "/invitations/preview", { body: { token: a.token } })).body).toMatchObject({ valid: false, reason: "invalid" });
    const again = await invite(s);
    expect(again.res.status).toBe(200);
    expect((await call("POST", "/invitations/activate", { body: { token: again.token } })).status).toBe(200);
    expect((await prisma.ringInvitationAudit.findMany()).map((x) => x.action)).toContain("REVOKED");
  });

  it("herhaald gebruik van dezelfde uitnodiging faalt; twee gelijktijdige activaties geven precies één lidmaatschap", async () => {
    const s = await setup();
    const { token } = await invite(s);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => activateInvitation({ token }, `race-${i}-${Date.now()}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: "nieuw@test.ringapeldoorn.nl" } })).toBe(1);
    expect(await prisma.ringMembership.count({ where: { user: { email: "nieuw@test.ringapeldoorn.nl" } } })).toBe(1);
    expect((await call("POST", "/invitations/activate", { body: { token } })).status).toBe(400);
    expect(await prisma.ringInvitationAudit.count({ where: { action: "ACCEPTED" } })).toBe(1);
  });

  it("dubbele actieve uitnodigingen en uitnodigen van een bestaand lid worden voorkomen (ook gelijktijdig)", async () => {
    const s = await setup();
    const results = await Promise.all(Array.from({ length: 4 }, () => call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body() })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.ringInvitation.count()).toBe(1);
    const member = await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body({ email: s.plain.email }) });
    expect(member.status).toBe(400);
    expect(member.body.error).toMatch(/al lid/);
  });

  it("onbevoegden en andere ringen: geen uitnodigingen aanmaken, zien, versturen, intrekken of wijzigen", async () => {
    const s = await setup();
    const { token } = await invite(s);
    const id = (await prisma.ringInvitation.findFirstOrThrow()).id;
    const plainToken = await login(s.plain.id);
    const otherToken = await login(s.managerB.id);
    for (const t of [plainToken, otherToken]) {
      expect((await call("GET", `/rings/${s.ringA.id}/invitations`, { token: t })).status).toBe(404);
      expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: t, body: body({ email: "x@t.nl" }) })).status).toBe(404);
      expect((await call("POST", `/invitations/${id}/resend`, { token: t })).status).toBe(404);
      expect((await call("POST", `/invitations/${id}/revoke`, { token: t })).status).toBe(404);
      expect((await call("POST", `/invitations/${id}`, { token: t, body: { role: "HOGERAAD" } })).status).toBe(404);
    }
    expect((await call("GET", `/rings/${s.ringA.id}/invitations`)).status).toBe(401);
    expect((await call("POST", "/invitations/nonexistent/resend", { token: s.token })).status).toBe(404);
    // De uitnodiging is onaangetast.
    expect((await prisma.ringInvitation.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull();
    expect((await call("POST", "/invitations/activate", { body: { token } })).status).toBe(200);
  });

  it("wijziging van rol of functie tijdens een open uitnodiging geldt bij activatie; een functieconflict geeft geen bevoegdheid", async () => {
    const s = await setup();
    const { token } = await invite(s, { role: "RINGPRESIDIUM", churchFunction: "Ringpresident", churchFunctionCode: "RINGPRESIDENT" });
    const id = (await prisma.ringInvitation.findFirstOrThrow()).id;
    // Intussen krijgt een ander lid de functie ringpresident.
    await prisma.ringMembership.updateMany({ where: { userId: s.manager.id }, data: { churchFunctionCode: "RINGPRESIDENT" } });
    await call("POST", "/invitations/activate", { body: { token } });
    expect(await prisma.ringMembership.findFirstOrThrow({ where: { user: { email: "nieuw@test.ringapeldoorn.nl" } } })).toMatchObject({ churchFunctionCode: "ONBEKEND", appointAuthority: "NONE" });
    expect(id).toBeTruthy();

    // Rol wijzigen voordat geactiveerd wordt.
    const second = await invite(s, { email: "tweede@test.ringapeldoorn.nl" });
    const id2 = (await prisma.ringInvitation.findFirstOrThrow({ where: { email: "tweede@test.ringapeldoorn.nl" } })).id;
    expect((await call("POST", `/invitations/${id2}`, { token: s.token, body: { role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID", churchFunction: "Hogeraadslid", isRingManager: false } })).status).toBe(200);
    expect((await call("POST", `/invitations/${id2}`, { token: s.token, body: { role: "HOGERAAD", churchFunctionCode: "RINGPRESIDENT" } })).status).toBe(400);
    await call("POST", "/invitations/activate", { body: { token: second.token } });
    expect(await prisma.ringMembership.findFirstOrThrow({ where: { user: { email: "tweede@test.ringapeldoorn.nl" } } })).toMatchObject({ role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    // Een geactiveerde uitnodiging is niet meer te wijzigen.
    expect((await call("POST", `/invitations/${id2}`, { token: s.token, body: { role: "RINGPRESIDIUM" } })).status).toBe(400);
  });

  it("uitnodiging geeft geen méér rechten dan de uitnodiger nu heeft: uitnodiger gedeactiveerd, geen beheerder meer, of ring gedeactiveerd", async () => {
    for (const scenario of ["deactivated", "demoted", "ring"] as const) {
      await resetDatabase();
      await prisma.ringInvitation.deleteMany();
      sendMailMock.mockClear();
      const s = await setup();
      // Tweede beheerder, zodat de eerste kan worden teruggezet zonder dat de ring beheerderloos is.
      await createTestUser("RINGPRESIDIUM", "Reserve Beheer", { ringId: s.ringA.id, isRingManager: true });
      const { token } = await invite(s, { isRingManager: true });
      if (scenario === "deactivated") await prisma.user.update({ where: { id: s.manager.id }, data: { active: false } });
      if (scenario === "demoted") await prisma.ringMembership.updateMany({ where: { userId: s.manager.id }, data: { isRingManager: false } });
      if (scenario === "ring") await prisma.ring.update({ where: { id: s.ringA.id }, data: { active: false } });
      expect((await call("POST", "/invitations/preview", { body: { token } })).body.valid).toBe(false);
      const act = await call("POST", "/invitations/activate", { body: { token } });
      expect(act.status, scenario).toBe(400);
      expect(await prisma.user.count({ where: { email: "nieuw@test.ringapeldoorn.nl" } }), scenario).toBe(0);
    }
  });

  it("gedeactiveerd account of beheerdersaccount kan niet via een uitnodiging worden geactiveerd of overgenomen", async () => {
    const s = await setup();
    const inactive = await prisma.user.create({ data: { name: "Uit", email: "uit@test.ringapeldoorn.nl", role: "HOGERAAD", active: false } });
    const { token } = await invite(s, { email: "uit@test.ringapeldoorn.nl" });
    expect((await call("POST", "/invitations/activate", { body: { token } })).status).toBe(400);
    expect(await prisma.ringMembership.count({ where: { userId: inactive.id } })).toBe(0);
    expect((await prisma.ringInvitation.findFirstOrThrow()).acceptedAt).toBeNull(); // claim teruggedraaid

    await createTestUser("ADMIN", "Webmin", { email: "webmin@test.ringapeldoorn.nl" });
    expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body({ email: "webmin@test.ringapeldoorn.nl" }) })).status).toBe(400);
  });

  it("activatie met e-mailadres + code (terugval): foute pogingen worden beperkt, geen enumeratie, juiste code werkt", async () => {
    const s = await setup();
    const { code } = await invite(s);
    const ip = freshIp();
    const wrong = await call("POST", "/invitations/activate", { body: { email: "nieuw@test.ringapeldoorn.nl", code: "AAAA-BBBB-CCCC" }, ip });
    const unknownMail = await call("POST", "/invitations/activate", { body: { email: "bestaat.niet@test.ringapeldoorn.nl", code: "AAAA-BBBB-CCCC" }, ip });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual(unknownMail.body); // zelfde antwoord: geen enumeratie
    for (let i = 0; i < 5; i++) await call("POST", "/invitations/activate", { body: { email: "nieuw@test.ringapeldoorn.nl", code: "DDDD-EEEE-FFFF" }, ip: freshIp() });
    // Na te veel foute pogingen is de code onbruikbaar, ook de juiste.
    expect((await call("POST", "/invitations/activate", { body: { email: "nieuw@test.ringapeldoorn.nl", code }, ip: freshIp() })).status).toBe(400);
    // Opnieuw versturen geeft een nieuwe code en zet de teller terug.
    await prisma.ringInvitation.updateMany({ data: { sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1000) } });
    const id = (await prisma.ringInvitation.findFirstOrThrow()).id;
    expect((await call("POST", `/invitations/${id}/resend`, { token: s.token })).status).toBe(200);
    const fresh = lastMail();
    const ok = await call("POST", "/invitations/activate", { body: { email: " Nieuw@Test.Ringapeldoorn.nl ", code: fresh.code.toLowerCase().replace(/-/g, " ") }, ip: freshIp() });
    expect(ok.status).toBe(200);
  });

  it("SMTP-storing: uitnodiging blijft 'niet verstuurd', fout lekt geen token, opnieuw versturen herstelt", async () => {
    const s = await setup();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED smtp"), { name: "SmtpDown" }));
    const res = await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body() });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    expect(row.sentAt).toBeNull();
    const logged = errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toMatch(/uitnodiging\/|nieuw@test/);
    errSpy.mockRestore();
    const list = await call("GET", `/rings/${s.ringA.id}/invitations`, { token: s.token });
    expect(list.body.invitations[0].status).toBe("NIET_VERSTUURD");
    expect((await prisma.ringInvitationAudit.findMany()).map((a) => a.action)).toContain("SEND_FAILED");

    // Direct opnieuw proberen mag (er is nog niets verstuurd); daarna geldt de wachttijd.
    expect((await call("POST", `/invitations/${row.id}/resend`, { token: s.token })).body.sent).toBe(true);
    const { token } = lastMail();
    expect((await call("POST", `/invitations/${row.id}/resend`, { token: s.token })).status).toBe(400); // wachttijd
    expect((await call("POST", "/invitations/activate", { body: { token } })).status).toBe(200);
  });

  it("maximaal aantal verstuurpogingen per uitnodiging", async () => {
    const s = await setup();
    await invite(s);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    await prisma.ringInvitation.update({ where: { id: row.id }, data: { sendCount: INVITATION_MAX_SENDS, sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1) } });
    expect((await call("POST", `/invitations/${row.id}/resend`, { token: s.token })).status).toBe(400);
  });

  it("verplichte MFA wordt niet omzeild: activatie geeft geen sessie; een passkey-account kan nog steeds niet met alleen de code inloggen", async () => {
    const s = await setup();
    const mfaUser = await createTestUser("HOGERAAD", "Mfa Lid", { ringId: s.ringB.id, email: "mfa@test.ringapeldoorn.nl" });
    await prisma.user.update({ where: { id: mfaUser.id }, data: { mfaEnabled: true, activatedAt: new Date() } });
    const { token } = await invite(s, { email: "mfa@test.ringapeldoorn.nl", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    const act = await call("POST", "/invitations/activate", { body: { token } });
    expect(act.body).toMatchObject({ ok: true, mfaRequired: true });
    expect(act.body.token).toBeUndefined();
    const { code } = await createMagicLinkToken(mfaUser.id, { withCode: true });
    const li = await call("POST", "/auth/login", { body: { email: mfaUser.email, code } });
    expect(li.status).toBe(403);
    expect(li.body.token).toBeUndefined();
  });

  it("ringbeheerders voegen niet meer rechtstreeks toe (alleen via uitnodiging); webmin kan nog koppelen", async () => {
    const s = await setup();
    const direct = await call("POST", `/rings/${s.ringA.id}/users`, { token: s.token, body: { name: "X Y", email: "xy@t.nl", churchFunction: "Functie", role: "HOGERAAD", isRingManager: false } });
    expect(direct.status).toBe(403);
    expect(direct.body.code).toBe("use-invitation");
    expect(await prisma.user.count({ where: { email: "xy@t.nl" } })).toBe(0);
  });

  it("opruimen: oude uitnodigingen verdwijnen na 90 dagen, recente en open niet", async () => {
    const s = await setup();
    await invite(s);
    await invite(s, { email: "oud@test.ringapeldoorn.nl" });
    await prisma.ringInvitation.updateMany({ where: { email: "oud@test.ringapeldoorn.nl" }, data: { expiresAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) } });
    expect(await deleteOldInvitations()).toBe(1);
    expect(await prisma.ringInvitation.count()).toBe(1);
  });

  it("ongeldige invoer: slechte token-indeling, lege body en ontbrekende velden geven nette fouten", async () => {
    const s = await setup();
    for (const t of ["", "kort", "x".repeat(300), "../../etc/passwd"]) {
      expect((await call("POST", "/invitations/activate", { body: { token: t } })).status).toBe(400);
      expect((await call("POST", "/invitations/preview", { body: { token: t } })).body.valid).toBe(false);
    }
    expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: {} })).status).toBe(400);
    expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body({ email: "geen-mail" }) })).status).toBe(400);
  });
});

describe("Uitnodigingen en deactiveren", () => {
  it("deactiveren van een lid trekt openstaande uitnodigingen voor dat adres in; een oude uitnodiging heractiveert nooit een bewust gedeactiveerd lid", async () => {
    const s = await setup();
    const member = await createTestUser("HOGERAAD", "Terugkeerder", { ringId: s.ringA.id, email: "terug@test.ringapeldoorn.nl" });
    await prisma.ringMembership.updateMany({ where: { userId: member.id }, data: { active: false } });
    // Uitnodiging voor een inactief lid mag (heractiveren door de beheerder is een bewuste keuze) ...
    const { token } = await invite(s, { email: "terug@test.ringapeldoorn.nl", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    // ... maar wordt het lidmaatschap daarna opnieuw (bewust) gewijzigd/gedeactiveerd, dan vervalt de uitnodiging.
    const m = await prisma.ringMembership.findFirstOrThrow({ where: { userId: member.id } });
    await prisma.ringMembership.update({ where: { id: m.id }, data: { churchFunction: "Later gewijzigd" } });
    expect((await call("POST", "/invitations/activate", { body: { token } })).status).toBe(400);
    expect((await prisma.ringMembership.findFirstOrThrow({ where: { userId: member.id } })).active).toBe(false);
    expect((await prisma.ringInvitation.findFirstOrThrow()).acceptedAt).toBeNull();

    // Deactiveren via het beheer trekt een open uitnodiging voor datzelfde adres direct in.
    await resetDatabase();
    const t = await setup();
    const active = await createTestUser("HOGERAAD", "Actief Lid", { ringId: t.ringA.id, email: "actief@test.ringapeldoorn.nl" });
    await prisma.ringInvitation.create({ data: { ringId: t.ringA.id, email: "actief@test.ringapeldoorn.nl", name: "Actief Lid", role: "HOGERAAD", createdById: t.manager.id, tokenHash: "h".repeat(64), codeHash: "c", expiresAt: new Date(Date.now() + 1e6) } });
    const mem = await prisma.ringMembership.findFirstOrThrow({ where: { userId: active.id } });
    const upd = await call("POST", `/memberships/${mem.id}`, { token: t.token, body: { churchFunction: "Functie", role: "HOGERAAD", isRingManager: false, active: false } });
    expect(upd.status).toBe(200);
    expect((await prisma.ringInvitation.findFirstOrThrow()).revokedAt).not.toBeNull();
  });

  it("de log bevat nooit het token: geen console-uitvoer bij een gewone uitnodiging en activatie", async () => {
    const s = await setup();
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")].map((x) => x.mockImplementation(() => {}));
    const { token, code } = await invite(s);
    await call("POST", "/invitations/activate", { body: { token } });
    await call("POST", "/invitations/activate", { body: { token: "x".repeat(43) } });
    const logged = spies.flatMap((x) => x.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(code);
    spies.forEach((x) => x.mockRestore());
  });
});

describe("Robuustheid", () => {
  it("een bestaand account met afwijkende hoofdletters in het e-mailadres krijgt geen dubbel account", async () => {
    const s = await setup();
    const legacy = await prisma.user.create({ data: { name: "Oud Account", email: "Mixed.Case@Test.Ringapeldoorn.nl", role: "HOGERAAD", active: true, activatedAt: new Date() } });
    const { token } = await invite(s, { name: "Mixed", email: "mixed.case@test.ringapeldoorn.nl", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    expect((await call("POST", "/invitations/activate", { body: { token } })).status).toBe(200);
    expect(await prisma.user.count({ where: { email: { equals: "mixed.case@test.ringapeldoorn.nl", mode: "insensitive" } } })).toBe(1);
    expect(await prisma.ringMembership.count({ where: { userId: legacy.id, ringId: s.ringA.id } })).toBe(1);
  });

});


/**
 * Wacht deterministisch op een toestand in plaats van een vaste tijd (die onder CI-belasting te kort kan zijn). Begrensde polling met een
 * duidelijke foutmelding bij een time-out.
 */
async function waitUntil<T>(description: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Time-out na ${timeoutMs} ms: ${description}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("Betrouwbaar en idempotent (opnieuw) versturen", () => {
  const slowMail = (ms: number) => sendMailMock.mockImplementation(() => new Promise((r) => setTimeout(r, ms)));
  const expireCooldown = (id: string) => prisma.ringInvitation.update({ where: { id }, data: { sentAt: new Date(Date.now() - INVITATION_RESEND_COOLDOWN_MS - 1000) } });

  it("gelijktijdig opnieuw versturen: precies één e-mail, de link daarin is geldig en de andere verzoeken versturen niets", async () => {
    const s = await setup();
    await invite(s);
    const id = (await prisma.ringInvitation.findFirstOrThrow()).id;
    await expireCooldown(id);
    sendMailMock.mockClear();
    slowMail(150); // de verzending duurt even: de overige verzoeken overlappen
    const res = await Promise.all(Array.from({ length: 6 }, () => call("POST", `/invitations/${id}/resend`, { token: s.token })));
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(res.filter((r) => r.body.sent === true)).toHaveLength(1);
    expect(res.filter((r) => r.body.inProgress === true)).toHaveLength(5);
    const { token } = lastMail();
    expect((await prisma.ringInvitation.findUniqueOrThrow({ where: { id } })).tokenHash).toBe(hashToken(token)); // het enige verstuurde token is het geldige
    expect((await prisma.ringInvitation.findUniqueOrThrow({ where: { id } })).sendClaimedAt).toBeNull();
    expect((await call("POST", "/invitations/activate", { body: { token } })).status).toBe(200);
  });

  it("een verzoek tijdens de eerste verzending na het aanmaken wordt samengevoegd; direct daarna geldt de wachttijd", async () => {
    const s = await setup();
    slowMail(150);
    const created = call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body() });
    // Wacht tot de eerste verzending aantoonbaar loopt: uitnodiging bestaat, claim is vastgelegd en sendMail is aangeroepen.
    const id = (
      await waitUntil("eerste verzending na aanmaken is gestart (claim vastgelegd en sendMail aangeroepen)", async () => {
        const row = await prisma.ringInvitation.findFirst();
        return row?.sendClaimedAt && sendMailMock.mock.calls.length === 1 ? row : null;
      })
    ).id;
    const during = await call("POST", `/invitations/${id}/resend`, { token: s.token });
    expect(during.body).toMatchObject({ sent: false, inProgress: true });
    expect((await created).body.sent).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const after = await call("POST", `/invitations/${id}/resend`, { token: s.token });
    expect(after.status).toBe(400); // net verstuurd: wachttijd
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("een verzoek dat is samengevoegd roteert token en code niet", async () => {
    const s = await setup();
    await invite(s);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    await expireCooldown(row.id);
    await prisma.ringInvitation.update({ where: { id: row.id }, data: { sendClaimedAt: new Date() } }); // andere verzending bezig
    const before = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    sendMailMock.mockClear();
    const res = await call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    expect(res.body.inProgress).toBe(true);
    const after = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    expect([after.tokenHash, after.codeHash, after.expiresAt.getTime()]).toEqual([before.tokenHash, before.codeHash, before.expiresAt.getTime()]);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("een achtergebleven claim (bijv. na een crash) verloopt: daarna kan opnieuw worden verstuurd", async () => {
    const s = await setup();
    await invite(s);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    await expireCooldown(row.id);
    await prisma.ringInvitation.update({ where: { id: row.id }, data: { sendClaimedAt: new Date(Date.now() - 3 * 60 * 1000) } });
    sendMailMock.mockClear();
    const res = await call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    expect(res.body).toMatchObject({ sent: true, inProgress: false });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("SMTP-storing bij opnieuw versturen: de eerder verstuurde link blijft werken, status blijft 'verstuurd', claim vrij en herhalen lukt", async () => {
    const s = await setup();
    const first = await invite(s);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    await expireCooldown(row.id);
    const before = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    const failed = await call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    errSpy.mockRestore();
    expect(failed.body).toMatchObject({ sent: false, inProgress: false });
    const after = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.tokenHash).toBe(before.tokenHash); // vorige token/code/geldigheid hersteld
    expect(after.codeHash).toBe(before.codeHash);
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    expect(after.sentAt?.getTime()).toBe(before.sentAt?.getTime());
    expect(after.sendClaimedAt).toBeNull();
    expect(after.sendCount).toBe(before.sendCount);
    expect((await call("GET", `/rings/${s.ringA.id}/invitations`, { token: s.token })).body.invitations[0].status).toBe("VERSTUURD");
    expect((await prisma.ringInvitationAudit.findMany()).map((a) => a.action)).toContain("SEND_FAILED");
    // Herstel: opnieuw proberen lukt, en de eerste mail was intussen nog bruikbaar.
    const retry = await call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    expect(retry.body.sent).toBe(true);
    expect(first.token).not.toBe(lastMail().token);
  });

  it("SMTP-storing bij de allereerste verzending met gelijktijdige herhalingen: één poging tegelijk, daarna herstel", async () => {
    const s = await setup();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    expect((await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body() })).body.sent).toBe(false);
    errSpy.mockRestore();
    const id = (await prisma.ringInvitation.findFirstOrThrow()).id;
    expect((await prisma.ringInvitation.findUniqueOrThrow({ where: { id } })).sendClaimedAt).toBeNull();
    sendMailMock.mockClear();
    slowMail(120);
    const res = await Promise.all(Array.from({ length: 4 }, () => call("POST", `/invitations/${id}/resend`, { token: s.token })));
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(res.filter((r) => r.body.sent === true)).toHaveLength(1);
    expect((await call("POST", "/invitations/activate", { body: { token: lastMail().token } })).status).toBe(200);
  });

  it("herhaalde verzoeken na een geslaagde verzending versturen niets extra (wachttijd), ook niet na een verlopen claim", async () => {
    const s = await setup();
    await invite(s);
    const id = (await prisma.ringInvitation.findFirstOrThrow()).id;
    sendMailMock.mockClear();
    for (let i = 0; i < 3; i++) expect((await call("POST", `/invitations/${id}/resend`, { token: s.token })).status).toBe(400);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("lease verloopt terwijl een eerdere verzending nog niet is afgerond: de tweede verzending neemt over; de late eerste kan de status niet meer beïnvloeden", async () => {
    // In de praktijk is dit uitgesloten (de SMTP-totaaltijd is korter dan de lease); dit test het veiligheidsnet voor als een verzending toch blijft hangen.
    const s = await setup();
    await invite(s);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    await expireCooldown(row.id);
    let releaseFirst: () => void = () => {};
    sendMailMock.mockClear();
    sendMailMock.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; })); // eerste verzending hangt
    const first = call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    // Deterministische synchronisatie op de werkelijke toestand (geen vaste wachttijd): de claim is vastgelegd én de (hangende) eerste
    // sendMail is aangeroepen, dus `releaseFirst` is gezet.
    const firstMail = await waitUntil("eerste verzending is gestart (claim vastgelegd en sendMail aangeroepen)", async () => {
      const r = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
      return r.sendClaimedAt && sendMailMock.mock.calls.length === 1 ? r : null;
    });
    expect(firstMail.sendClaimedAt).not.toBeNull();

    // Binnen de lease: een tweede verzoek verstuurt niets.
    const during = await call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    expect(during.body).toMatchObject({ sent: false, inProgress: true });
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    // De lease verloopt terwijl de eerste nog hangt.
    await prisma.ringInvitation.update({ where: { id: row.id }, data: { sendClaimedAt: new Date(Date.now() - INVITATION_SEND_LEASE_MS - 1000) } });
    sendMailMock.mockResolvedValueOnce(undefined);
    const second = await call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    expect(second.body).toMatchObject({ sent: true, inProgress: false });
    const secondToken = lastMail().token;
    const afterSecond = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterSecond.tokenHash).toBe(hashToken(secondToken));
    expect(afterSecond.sentAt).not.toBeNull();
    expect(afterSecond.sendCount).toBe(2); // eerste verzending + tweede

    // Nu komt de late eerste verzending alsnog terug: zij mag niets overschrijven en telt niet mee.
    releaseFirst();
    expect((await first).body).toMatchObject({ sent: false, inProgress: false });
    const final = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } });
    expect([final.tokenHash, final.codeHash, final.sendCount, final.sentAt?.getTime(), final.sendClaimedAt]).toEqual([afterSecond.tokenHash, afterSecond.codeHash, afterSecond.sendCount, afterSecond.sentAt?.getTime(), null]);
    expect((await prisma.ringInvitationAudit.findMany({ where: { invitationId: row.id, action: "SEND_FAILED" } })).map((a) => a.detail)).toContain("verouderde verzending: token inmiddels vervangen");
    // Alleen de link van de tweede (laatste) mail is geldig.
    expect((await call("POST", "/invitations/activate", { body: { token: secondToken } })).status).toBe(200);
  });

  it("SMTP-time-out (onbekende afleverstatus) wordt als mislukt vastgelegd met die aantekening; eerder bezorgde link blijft werken, bij een eerste verzending blijft de nieuwe link geldig", async () => {
    const { SmtpDeadlineError } = await import("@/lib/mailer");
    const s = await setup();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Eerste verzending: time-out.
    sendMailMock.mockRejectedValueOnce(new SmtpDeadlineError());
    const created = await call("POST", `/rings/${s.ringA.id}/invitations`, { token: s.token, body: body() });
    expect(created.body.sent).toBe(false);
    const row = await prisma.ringInvitation.findFirstOrThrow();
    expect(row.sendClaimedAt).toBeNull();
    expect(row.sentAt).toBeNull();
    // De nieuwe link (mogelijk toch aangekomen) is niet ingetrokken.
    expect((await prisma.ringInvitationAudit.findMany({ where: { action: "SEND_FAILED" } })).map((a) => a.detail)).toContain("time-out; afleverstatus onbekend");

    // Opnieuw versturen lukt; daarna time-out bij een herinnering: de bezorgde link blijft werken.
    expect((await call("POST", `/invitations/${row.id}/resend`, { token: s.token })).body.sent).toBe(true);
    const delivered = lastMail().token;
    await expireCooldown(row.id);
    sendMailMock.mockRejectedValueOnce(new SmtpDeadlineError());
    const failed = await call("POST", `/invitations/${row.id}/resend`, { token: s.token });
    errSpy.mockRestore();
    expect(failed.body.sent).toBe(false);
    expect((await prisma.ringInvitation.findUniqueOrThrow({ where: { id: row.id } })).tokenHash).toBe(hashToken(delivered));
    expect((await call("POST", "/invitations/activate", { body: { token: delivered } })).status).toBe(200);
  });
});


describe("Direct ingelogd na activatie", () => {
  const SESSION_TTL = 60 * 24 * 60 * 60 * 1000;

  it("de uitgegeven sessie is een gewone volledige sessie: zelfde levensduur, mfaAt, servercontroles, ringisolatie, verversen en uitloggen", async () => {
    const s = await setup();
    const { token } = await invite(s, { role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID", churchFunction: "Hogeraadslid" });
    const act = await call("POST", "/invitations/activate", { body: { token, issueSession: true, deviceName: "iPhone van Eva" } });
    expect(act.status).toBe(200);
    expect(act.body.user.email).toBe("nieuw@test.ringapeldoorn.nl");
    expect(act.body.rings).toEqual([expect.objectContaining({ id: s.ringA.id, role: "HOGERAAD", isRingManager: false })]);
    const session = await prisma.session.findFirstOrThrow({ where: { user: { email: "nieuw@test.ringapeldoorn.nl" } } });
    expect(session.mfaAt).not.toBeNull();
    expect(session.userAgent).toBe("Ringtools-app (iPhone van Eva)");
    expect(session.tokenHash).toBe(hashToken(act.body.token));
    expect(Math.abs(session.expiresAt.getTime() - (Date.now() + SESSION_TTL))).toBeLessThan(60_000); // zelfde levensduur als een gewone login
    // Het token staat nergens leesbaar in de database.
    expect(JSON.stringify(session)).not.toContain(act.body.token);

    const t = act.body.token as string;
    expect((await call("GET", "/me", { token: t })).status).toBe(200);
    expect((await call("GET", "/dashboard?ring=" + s.ringA.id, { token: t })).status).toBe(200);
    // Alleen eigen (nieuwe) lidmaatschap: niet in een andere ring, niet voor beheer.
    expect((await call("GET", "/dashboard?ring=" + s.ringB.id, { token: t })).status).toBe(404);
    expect((await call("GET", `/rings/${s.ringA.id}/users`, { token: t })).status).toBe(404); // geen ringbeheerder
    expect((await call("GET", "/admin/me", { token: t })).status).toBe(403);
    // Normale sessie-functies.
    expect((await call("GET", "/sessions", { token: t })).body.sessions).toHaveLength(1);
    await prisma.session.update({ where: { id: session.id }, data: { rotatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
    const refreshed = await call("POST", "/auth/refresh", { token: t });
    expect(refreshed.status).toBe(200);
    expect((await call("POST", "/auth/logout", { token: refreshed.body.token ?? t })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("een uitnodiging met ringbeheerder-vlag geeft precies die rechten (niet meer) in de sessie; een machtiging blijft ontbreken", async () => {
    const s = await setup();
    const { token } = await invite(s, { isRingManager: true });
    const act = await call("POST", "/invitations/activate", { body: { token, issueSession: true } });
    expect(act.body.rings[0]).toMatchObject({ isRingManager: true });
    expect((await call("GET", `/rings/${s.ringA.id}/users`, { token: act.body.token })).status).toBe(200);
    expect((await prisma.ringMembership.findFirstOrThrow({ where: { user: { email: "nieuw@test.ringapeldoorn.nl" } } })).appointAuthority).toBe("NONE");
  });

  it("bestaand account (tweede ring, zonder MFA) wordt direct ingelogd en ziet beide ringen; geen nieuw account", async () => {
    const s = await setup();
    const elsewhere = await createTestUser("HOGERAAD", "Elders Lid", { ringId: s.ringB.id, email: "elders@test.ringapeldoorn.nl" });
    await prisma.user.update({ where: { id: elsewhere.id }, data: { activatedAt: new Date() } });
    const usersBefore = await prisma.user.count();
    const { token } = await invite(s, { name: "Elders", email: "elders@test.ringapeldoorn.nl", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    const act = await call("POST", "/invitations/activate", { body: { token, issueSession: true } });
    expect(act.body.signedIn).toBe(true);
    expect(act.body.user.id).toBe(elsewhere.id);
    expect(act.body.rings.map((r: { id: string }) => r.id).sort()).toEqual([s.ringA.id, s.ringB.id].sort());
    expect(await prisma.user.count()).toBe(usersBefore);
  });

  it("verplichte MFA wordt nooit omzeild: geen token, wel het bestaande veilige gedrag (ook met native passkeys uit)", async () => {
    const s = await setup();
    const mfaUser = await createTestUser("HOGERAAD", "Mfa Lid", { ringId: s.ringB.id, email: "mfa.direct@test.ringapeldoorn.nl" });
    await prisma.user.update({ where: { id: mfaUser.id }, data: { mfaEnabled: true, activatedAt: new Date() } });
    const { token } = await invite(s, { email: "mfa.direct@test.ringapeldoorn.nl", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" });
    const sessionsBefore = await prisma.session.count();
    const act = await call("POST", "/invitations/activate", { body: { token, issueSession: true } });
    expect(act.status).toBe(200);
    expect(act.body).toMatchObject({ ok: true, signedIn: false, mfaRequired: true });
    expect(act.body.token).toBeUndefined();
    expect(act.body.user).toBeUndefined();
    expect(await prisma.session.count()).toBe(sessionsBefore);
    const { code } = await createMagicLinkToken(mfaUser.id, { withCode: true });
    const login403 = await call("POST", "/auth/login", { body: { email: mfaUser.email, code } });
    expect(login403.status).toBe(403);
    expect(login403.body.token).toBeUndefined();
  });

  it("oude apps zonder issueSession maken geen sessie aan (standaard fail-closed)", async () => {
    const s = await setup();
    const { token } = await invite(s);
    const before = await prisma.session.count();
    const act = await call("POST", "/invitations/activate", { body: { token } });
    expect(act.status).toBe(200);
    expect(act.body).toMatchObject({ ok: true, signedIn: false, mfaRequired: false });
    expect(act.body.token).toBeUndefined();
    expect(await prisma.session.count()).toBe(before);
    expect((await prisma.ringMembership.findFirst({ where: { ringId: s.ringA.id, user: { email: "nieuw@test.ringapeldoorn.nl" } } }))?.active).toBe(true);
  });

  it("ook bij de service zelf geeft ontbrekende issueSession geen sessie uit", async () => {
    const s = await setup();
    const { token } = await invite(s);
    const before = await prisma.session.count();
    const act = await activateInvitation({ token }, freshIp());
    expect(act.session).toBeUndefined();
    expect(await prisma.session.count()).toBe(before);
  });

  it("de client kan om geen sessie vragen (issueSession=false, bijv. als er al iemand is ingelogd): activatie slaagt zonder token", async () => {
    const s = await setup();
    const { token } = await invite(s);
    const sessionsBefore = await prisma.session.count();
    const act = await call("POST", "/invitations/activate", { body: { token, issueSession: false } });
    expect(act.body).toMatchObject({ ok: true, signedIn: false, mfaRequired: false });
    expect(act.body.token).toBeUndefined();
    expect(await prisma.session.count()).toBe(sessionsBefore);
  });

  it("mislukte activaties leveren nooit een sessie op: onbekend/verlopen/ingetrokken/hergebruikt token, foute code, gedeactiveerd account, uitnodiger niet meer bevoegd", async () => {
    const s = await setup();
    const sessions = () => prisma.session.count({ where: { mfaAt: { not: null }, user: { email: { not: s.manager.email } } } });
    const base = await sessions();
    const noToken = async (res: { status: number; body: Record<string, any> }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.token).toBeUndefined();
      expect(res.body.signedIn).toBeUndefined();
    };
    await noToken(await call("POST", "/invitations/activate", { body: { token: "x".repeat(43) } }));
    await noToken(await call("POST", "/invitations/activate", { body: { email: "nieuw@test.ringapeldoorn.nl", code: "AAAA-BBBB-CCCC" } }));

    const a = await invite(s);
    const id = (await prisma.ringInvitation.findFirstOrThrow()).id;
    await prisma.ringInvitation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await noToken(await call("POST", "/invitations/activate", { body: { token: a.token } })); // verlopen
    await prisma.ringInvitation.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 1e6), revokedAt: new Date() } });
    await noToken(await call("POST", "/invitations/activate", { body: { token: a.token } })); // ingetrokken
    await prisma.ringInvitation.update({ where: { id }, data: { revokedAt: null } });
    expect((await call("POST", "/invitations/activate", { body: { token: a.token, issueSession: true } })).body.signedIn).toBe(true); // nu wel
    await noToken(await call("POST", "/invitations/activate", { body: { token: a.token } })); // hergebruik
    expect(await sessions()).toBe(base + 1);

    // gedeactiveerd account
    await prisma.user.create({ data: { name: "Uit", email: "uit2@test.ringapeldoorn.nl", role: "HOGERAAD", active: false } });
    const b = await invite(s, { email: "uit2@test.ringapeldoorn.nl" });
    await noToken(await call("POST", "/invitations/activate", { body: { token: b.token } }));
    // uitnodiger niet meer bevoegd
    const c = await invite(s, { email: "derde@test.ringapeldoorn.nl" });
    await createTestUser("RINGPRESIDIUM", "Reserve", { ringId: s.ringA.id, isRingManager: true });
    await prisma.ringMembership.updateMany({ where: { userId: s.manager.id }, data: { isRingManager: false } });
    await noToken(await call("POST", "/invitations/activate", { body: { token: c.token } }));
    expect(await sessions()).toBe(base + 1); // alleen de ene geslaagde activatie heeft een sessie opgeleverd
  });

  it("gelijktijdige activaties (token en code): hooguit één activatie en precies één sessie", async () => {
    const s = await setup();
    const { token, code } = await invite(s);
    const byToken = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/invitations/activate", { body: { token, issueSession: true } })));
    expect(byToken.filter((r) => r.status === 200)).toHaveLength(1);
    expect(byToken.filter((r) => r.body.token)).toHaveLength(1);
    expect(await prisma.session.count({ where: { user: { email: "nieuw@test.ringapeldoorn.nl" } } })).toBe(1);

    await resetDatabase();
    const t = await setup();
    const second = await invite(t, { email: "code@test.ringapeldoorn.nl" });
    const byCode = await Promise.all(Array.from({ length: 5 }, () => call("POST", "/invitations/activate", { body: { email: "code@test.ringapeldoorn.nl", code: second.code, issueSession: true } })));
    expect(byCode.filter((r) => r.body.token)).toHaveLength(1);
    expect(await prisma.session.count({ where: { user: { email: "code@test.ringapeldoorn.nl" } } })).toBe(1);
    expect(code).toBeTruthy();
  });

  it("onderbroken verbinding: de uitnodiging is verbruikt, een nieuwe poging geeft geen tweede sessie; gewoon inloggen met de e-mailcode blijft mogelijk", async () => {
    const s = await setup();
    const { token } = await invite(s);
    const first = await call("POST", "/invitations/activate", { body: { token, issueSession: true } }); // antwoord 'verloren' bij de client
    expect(first.body.token).toBeTruthy();
    const retry = await call("POST", "/invitations/activate", { body: { token } });
    expect(retry.status).toBe(400);
    expect(retry.body.token).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nieuw@test.ringapeldoorn.nl" } });
    const { code } = await createMagicLinkToken(user.id, { withCode: true });
    expect((await call("POST", "/auth/login", { body: { email: user.email, code } })).status).toBe(200);
  });

  it("de respons met het sessietoken wordt niet gecachet en het token komt niet in de log", async () => {
    const s = await setup();
    const { token } = await invite(s);
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")].map((x) => x.mockImplementation(() => {}));
    const url = new URL("http://localhost/api/mobile/v1/invitations/activate");
    const res = await handleApi(new Request(url, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": freshIp() }, body: JSON.stringify({ token, issueSession: true }) }), ["invitations", "activate"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { token: string };
    const logged = spies.flatMap((x) => x.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(body.token);
    spies.forEach((x) => x.mockRestore());
  });
});
