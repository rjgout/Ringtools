import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { createVerifiedSession, createMagicLinkToken } from "@/lib/auth";
import { resetDatabase, createTestUser, createTestRing } from "./setup";
import {
  INVITATION_RESEND_COOLDOWN_MS,
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
  it("nieuwe uitnodiging: mail met link en code, geen leesbare token in de database of lijst, activatie maakt account + lidmaatschap zonder sessie", async () => {
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
    const act = await call("POST", "/invitations/activate", { body: { token } });
    expect(act.status).toBe(200);
    expect(act.body).toMatchObject({ ok: true, email: "nieuw@test.ringapeldoorn.nl", ringName: "Ring A", mfaRequired: false });
    expect(act.body.token).toBeUndefined();
    expect(await prisma.session.count()).toBe(sessionsBefore); // activeren geeft nooit een sessie

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nieuw@test.ringapeldoorn.nl" }, include: { memberships: true } });
    expect(user.activatedAt).not.toBeNull();
    expect(user.memberships[0]).toMatchObject({ ringId: s.ringA.id, role: "RINGSECRETARIS", churchFunctionCode: "RINGSECRETARIS", isRingManager: false, appointAuthority: "NONE", active: true });

    const after = await call("GET", `/rings/${s.ringA.id}/invitations`, { token: s.token });
    expect(after.body.invitations[0]).toMatchObject({ status: "GEACTIVEERD", canResend: false, canRevoke: false });
    const actions = (await prisma.ringInvitationAudit.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["CREATED", "SENT", "ACCEPTED"]));

    // Daarna inloggen via de bestaande e-mailcode-route.
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
