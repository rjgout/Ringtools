import { beforeEach, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession, hashPassword } from "@/lib/auth";
import { startTotpEnrollment, confirmTotpEnrollment } from "@/lib/mfa";
import { resetDatabase, createTestUser, createTestRing } from "./setup";

const { handleApi } = await import("@/lib/api/router");

beforeEach(async () => {
  await resetDatabase();
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const login = async (userId: string) => (await createVerifiedSession(userId, "Test")).rawToken;
const totpAt = (secret: string, offsetMs = 0) =>
  new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: Date.now() + offsetMs });
const totpNow = (secret: string) => totpAt(secret);
// Een TOTP-code mag maar één keer per tijdvak worden gebruikt (replay-preventie): na de inschrijving gebruiken we het volgende tijdvak.
const totpNext = (secret: string) => totpAt(secret, 30_000);

async function webmin(withTotp = true) {
  const admin = await createTestUser("ADMIN", "Webmin");
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword("een-sterk-wachtwoord-123") } });
  let secret = "";
  if (withTotp) {
    secret = (await startTotpEnrollment(admin.id, admin.email)).secret;
    expect((await confirmTotpEnrollment(admin.id, admin.email, totpNow(secret))).ok).toBe(true);
  }
  return { admin, secret };
}
const stale = (token: string) => prisma.session.updateMany({ data: { mfaAt: new Date(Date.now() - 60 * 60 * 1000) } }).then(() => token);

describe("Webmin: native login met wachtwoord + verplichte TOTP", () => {
  it("wachtwoord alleen geeft geen toegang; pas na TOTP ontstaat een volledige sessie", async () => {
    const { admin, secret } = await webmin();
    const bad = await call("POST", "/admin/auth/login", { body: { username: admin.name, password: "fout" } });
    expect(bad.status).toBe(401);
    const step1 = await call("POST", "/admin/auth/login", { body: { username: admin.name, password: "een-sterk-wachtwoord-123" } });
    expect(step1.status).toBe(200);
    const pending = step1.body.pendingToken as string;
    // Het tijdelijke token is nergens als sessie bruikbaar.
    for (const path of ["/admin/me", "/admin/rings", "/me", "/sessions"]) expect((await call("GET", path, { token: pending })).status).toBe(401);
    expect((await call("POST", "/admin/auth/totp", { token: pending, body: { code: "000000" } })).status).toBe(401);
    expect((await call("POST", "/admin/auth/totp", { body: { code: totpNow(secret) } })).status).toBe(401);
    const step2 = await call("POST", "/admin/auth/totp", { token: pending, body: { code: totpNext(secret) } });
    expect(step2.status).toBe(200);
    expect((await call("GET", "/admin/me", { token: step2.body.token })).status).toBe(200);
    // Het pending-token is verbruikt.
    expect((await call("POST", "/admin/auth/totp", { token: pending, body: { code: totpNow(secret) } })).status).toBe(401);
  });

  it("zonder ingestelde TOTP is er geen mobiele webmin-sessie (geen omzeiling)", async () => {
    const { admin } = await webmin(false);
    const res = await call("POST", "/admin/auth/login", { body: { username: admin.name, password: "een-sterk-wachtwoord-123" } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("totp-not-configured");
    expect(res.body.pendingToken).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it("webmin en gewone gebruikers houden elkaars API gescheiden", async () => {
    const { admin } = await webmin();
    const ring = await createTestRing("Ring A");
    const manager = await createTestUser("RINGPRESIDIUM", "Beheerder", { ringId: ring.id, isRingManager: true });
    const adminToken = await login(admin.id);
    const userToken = await login(manager.id);
    for (const path of ["/me", "/dashboard", "/sessions"]) expect((await call("GET", path, { token: adminToken })).status).toBe(403);
    for (const path of ["/admin/me", "/admin/rings", "/admin/users?q=be"]) expect((await call("GET", path, { token: userToken })).status).toBe(403);
    expect((await call("POST", "/admin/rings", { token: userToken, body: {} })).status).toBe(403);
  });

  it("herverificatie: gevoelige acties vereisen een verse TOTP; reauth levert een nieuw token", async () => {
    const { admin, secret } = await webmin();
    const token = await stale(await login(admin.id));
    const body = { name: "Ring Nieuw", userName: "Eerste Beheerder", userEmail: "eerste@test.ringapeldoorn.nl", churchFunction: "Bisschop", role: "RINGPRESIDIUM" };
    const denied = await call("POST", "/admin/rings", { token, body });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("reauth-required");
    expect((await call("POST", "/admin/auth/reauth", { token, body: { code: "123456" } })).status).toBe(401);
    const reauth = await call("POST", "/admin/auth/reauth", { token, body: { code: totpNext(secret) } });
    expect(reauth.status).toBe(200);
    expect((await call("GET", "/admin/me", { token })).status).toBe(401); // oud token is vervangen
    const created = await call("POST", "/admin/rings", { token: reauth.body.token, body });
    expect(created.status).toBe(200);
    expect(await prisma.ring.count({ where: { name: "Ring Nieuw" } })).toBe(1);
  });
});

describe("Ringbeheer door webmin", () => {
  it("maakt een ring met eerste ringbeheerder (functie + rol), wijzigt, deactiveert en heractiveert", async () => {
    const { admin } = await webmin();
    const token = await login(admin.id);
    const created = await call("POST", "/admin/rings", { token, body: { name: "Ring Zuid", userName: "Eva Beheer", userEmail: "eva@test.ringapeldoorn.nl", churchFunction: "Eerste ringsraadgever", role: "RINGPRESIDIUM" } });
    expect(created.status).toBe(200);
    const ringId = created.body.id as string;
    const m = await prisma.ringMembership.findFirstOrThrow({ where: { ringId }, include: { user: true } });
    expect(m).toMatchObject({ isRingManager: true, active: true, role: "RINGPRESIDIUM", churchFunction: "Eerste ringsraadgever" });
    expect((await call("POST", "/admin/rings", { token, body: { name: "ring zuid", userName: "X Y", userEmail: "x@t.nl", churchFunction: "Functie", role: "HOGERAAD" } })).status).toBe(400);
    expect((await call("POST", `/admin/rings/${ringId}/rename`, { token, body: { name: "Ring Zuidoost" } })).status).toBe(200);
    const list = await call("GET", "/admin/rings", { token });
    expect(list.body.rings.find((r: { id: string }) => r.id === ringId)).toMatchObject({ name: "Ring Zuidoost", active: true });

    // Deactiveren: leden verliezen direct alle toegang; niets wordt verwijderd.
    const eva = await login(m.userId);
    expect((await call("GET", "/me", { token: eva })).body.rings).toHaveLength(1);
    expect((await call("POST", `/admin/rings/${ringId}/active`, { token, body: { active: false } })).status).toBe(200);
    expect((await call("GET", "/me", { token: eva })).body.rings).toHaveLength(0);
    expect((await call("GET", `/rings/${ringId}/users`, { token: eva })).status).toBe(404);
    expect((await call("GET", `/dashboard?ring=${ringId}`, { token: eva })).status).toBe(404);
    expect(await prisma.ringMembership.count({ where: { ringId } })).toBe(1);
    expect((await call("POST", `/admin/rings/${ringId}/active`, { token, body: { active: true } })).status).toBe(200);
    expect((await call("GET", "/me", { token: eva })).body.rings).toHaveLength(1);
  });

  it("alleen webmin maakt ringen; een ringbeheerder kan geen ring aanmaken of een bestaand account koppelen", async () => {
    const ring = await createTestRing("Ring A");
    const manager = await createTestUser("RINGPRESIDIUM", "Beheerder", { ringId: ring.id, isRingManager: true });
    const other = await createTestUser("HOGERAAD", "Elders", { ringId: (await createTestRing("Ring B")).id });
    const token = await login(manager.id);
    expect((await call("POST", "/admin/rings", { token, body: { name: "Ring C", userName: "A B", userEmail: "ab@t.nl", churchFunction: "Functie", role: "HOGERAAD" } })).status).toBe(403);
    const link = await call("POST", `/rings/${ring.id}/users`, { token, body: { existingUserId: other.id, churchFunction: "Lid", role: "HOGERAAD", isRingManager: false } });
    expect([403, 400]).toContain(link.status);
    expect(await prisma.ringMembership.count({ where: { userId: other.id } })).toBe(1);
  });
});

describe("Gebruikersbeheer in de app", () => {
  async function setup() {
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const manager = await createTestUser("RINGPRESIDIUM", "Beheerder A", { ringId: ringA.id, isRingManager: true });
    const plain = await createTestUser("HOGERAAD", "Gewoon Lid", { ringId: ringA.id, churchFunction: "Bisschop" });
    const foreign = await createTestUser("RINGPRESIDIUM", "Beheerder B", { ringId: ringB.id, isRingManager: true });
    return { ringA, ringB, manager, plain, foreign };
  }

  it("beheerder voegt een gebruiker toe, wijzigt rol/functie en deactiveert; alleen binnen de eigen ring", async () => {
    const { ringA, ringB, manager, foreign } = await setup();
    const token = await login(manager.id);
    const added = await call("POST", `/rings/${ringA.id}/users`, { token, body: { name: "Nieuw Lid", email: "nieuw@test.ringapeldoorn.nl", churchFunction: "Ringsraadgever", role: "RINGSECRETARIS", isRingManager: false } });
    expect(added.status).toBe(200);
    const list = await call("GET", `/rings/${ringA.id}/users`, { token });
    const nieuw = list.body.users.find((u: { name: string }) => u.name === "Nieuw Lid");
    expect(nieuw).toMatchObject({ role: "RINGSECRETARIS", churchFunction: "Ringsraadgever", isRingManager: false, active: true });
    // wijzigen: functie + rol; een kerkelijke functie geeft nooit automatisch beheerrechten
    const upd = await call("POST", `/memberships/${nieuw.membershipId}`, { token, body: { churchFunction: "Bisschop", role: "HOGERAAD", isRingManager: false, active: true } });
    expect(upd.status).toBe(200);
    const newToken = await login(nieuw.userId);
    expect((await call("GET", `/rings/${ringA.id}/users`, { token: newToken })).status).toBe(404);
    expect((await call("POST", `/rings/${ringA.id}/users`, { token: newToken, body: { name: "X Y", email: "xy@t.nl", churchFunction: "Functie", role: "HOGERAAD", isRingManager: true } })).status).toBe(404);
    // andere beheerder aanwijzen, daarna deactiveren
    await call("POST", `/memberships/${nieuw.membershipId}`, { token, body: { churchFunction: "Bisschop", role: "HOGERAAD", isRingManager: true, active: true } });
    expect((await call("GET", `/rings/${ringA.id}/users`, { token: newToken })).status).toBe(200);
    expect((await call("POST", `/memberships/${nieuw.membershipId}`, { token, body: { churchFunction: "Bisschop", role: "HOGERAAD", isRingManager: false, active: false } })).status).toBe(200);
    expect((await call("GET", "/me", { token: newToken })).status).toBe(401); // geen actieve ring meer: sessie ingetrokken
    // andere ring: niets zichtbaar of wijzigbaar
    expect((await call("GET", `/rings/${ringB.id}/users`, { token })).status).toBe(404);
    const foreignMembership = await prisma.ringMembership.findFirstOrThrow({ where: { userId: foreign.id } });
    expect((await call("POST", `/memberships/${foreignMembership.id}`, { token, body: { churchFunction: "Functie", role: "HOGERAAD", isRingManager: true, active: true } })).status).toBe(404);
    expect((await call("POST", `/rings/${ringB.id}/users`, { token, body: { name: "In B", email: "inb@t.nl", churchFunction: "Functie", role: "HOGERAAD", isRingManager: false } })).status).toBe(404);
  });

  it("een ring behoudt altijd minstens één actieve ringbeheerder", async () => {
    const { ringA, manager } = await setup();
    const token = await login(manager.id);
    const membership = await prisma.ringMembership.findFirstOrThrow({ where: { userId: manager.id, ringId: ringA.id } });
    for (const patch of [{ isRingManager: false, active: true }, { isRingManager: true, active: false }]) {
      const res = await call("POST", `/memberships/${membership.id}`, { token, body: { churchFunction: "Functie", role: "RINGPRESIDIUM", ...patch } });
      expect(res.status).toBe(400);
    }
    expect((await prisma.ringMembership.findUniqueOrThrow({ where: { id: membership.id } })).isRingManager).toBe(true);
  });

  it("gebruikers zonder bevoegdheid krijgen geen toegang; ongeldige of ingetrokken sessies ook niet", async () => {
    const { ringA, plain } = await setup();
    const token = await login(plain.id);
    expect((await call("GET", `/rings/${ringA.id}/users`, { token })).status).toBe(404);
    expect((await call("GET", `/rings/${ringA.id}/users`)).status).toBe(401);
    expect((await call("GET", `/rings/${ringA.id}/users`, { token: "x".repeat(40) })).status).toBe(401);
    await prisma.session.deleteMany({ where: { userId: plain.id } });
    expect((await call("GET", "/me", { token })).status).toBe(401);
  });

  it("gevoelige gebruikersacties vereisen een recente verificatie; herverificatie met verse e-mailcode", async () => {
    const { ringA, manager } = await setup();
    const token = await stale(await login(manager.id));
    const body = { name: "Laat Lid", email: "laat@test.ringapeldoorn.nl", churchFunction: "Functie", role: "HOGERAAD", isRingManager: false };
    const denied = await call("POST", `/rings/${ringA.id}/users`, { token, body });
    expect(denied.body.code).toBe("reauth-required");
    expect((await call("POST", "/auth/reauth", { token, body: { code: "00000000" } })).status).toBe(401);
    const { createMagicLinkToken } = await import("@/lib/auth");
    const { code } = await createMagicLinkToken(manager.id, { withCode: true });
    const re = await call("POST", "/auth/reauth", { token, body: { code } });
    expect(re.status).toBe(200);
    expect((await call("POST", `/rings/${ringA.id}/users`, { token: re.body.token, body })).status).toBe(200);
  });
});

describe("Sessie-intrekking op afstand (webmin)", () => {
  it("een andere sessie van de webmin kan worden ingetrokken en werkt daarna niet meer", async () => {
    const { admin } = await webmin();
    const a = await login(admin.id);
    const b = await login(admin.id);
    const list = await call("GET", "/admin/sessions", { token: a });
    expect(list.body.sessions).toHaveLength(2);
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    expect((await call("POST", `/admin/sessions/${other.id}/revoke`, { token: a })).status).toBe(200);
    expect((await call("GET", "/admin/me", { token: b })).status).toBe(401);
    expect((await call("GET", "/admin/me", { token: a })).status).toBe(200);
  });
});
