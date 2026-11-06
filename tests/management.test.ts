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

describe("Systeembeheer (webmin) niet meer via de app", () => {
  const adminPaths: [string, string][] = [
    ["POST", "/admin/auth/login"], ["POST", "/admin/auth/totp"], ["POST", "/admin/auth/reauth"], ["POST", "/admin/auth/refresh"], ["POST", "/admin/auth/logout"],
    ["GET", "/admin/me"], ["GET", "/admin/sessions"], ["GET", "/admin/rings"], ["POST", "/admin/rings"], ["POST", "/admin/rings/x/active"], ["GET", "/admin/users?q=ab"],
    ["GET", "/admin/rings/x/units"], ["POST", "/admin/units/x"], ["GET", "/admin/catalog/callings"], ["POST", "/admin/invitations/x/resend"],
  ];

  it("elke /admin-aanroep wordt afgewezen (410, admin-web-only): zonder sessie, met een gewone sessie en zelfs met een volledige beheerderssessie", async () => {
    const { admin } = await webmin();
    const ring = await createTestRing("Ring A");
    const manager = await createTestUser("RINGPRESIDIUM", "Beheerder", { ringId: ring.id, isRingManager: true });
    const tokens: Record<string, string | undefined> = { "geen sessie": undefined, "gewone gebruiker": await login(manager.id), "beheerderssessie": await login(admin.id) };
    for (const [who, token] of Object.entries(tokens)) {
      for (const [method, path] of adminPaths) {
        const r = await call(method, path, { token, body: {} });
        expect(r.status, `${who} ${method} ${path}`).toBe(410);
        expect(r.body.code, `${who} ${path}`).toBe("admin-web-only");
      }
    }
  });

  it("beheerder aanmelden via de app-API is onmogelijk: ook met het juiste wachtwoord ontstaat er geen (wachtende) sessie", async () => {
    const { admin, secret } = await webmin();
    const before = await prisma.session.count();
    const r1 = await call("POST", "/admin/auth/login", { body: { username: "webmin", password: "een-sterk-wachtwoord-123" } });
    expect(r1.status).toBe(410);
    expect(r1.body.pendingToken).toBeUndefined();
    const r2 = await call("POST", "/admin/auth/totp", { body: { code: totpNow(secret) } });
    expect(r2.status).toBe(410);
    expect(await prisma.session.count()).toBe(before);
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(0);
    // de gewone code-login weigert het beheerdersaccount ook (ongewijzigd)
    const code = await call("POST", "/auth/login", { body: { email: admin.email, code: "12345678" } });
    expect(code.status).toBeGreaterThanOrEqual(400);
    expect(code.body.token).toBeUndefined();
  });

  it("een bestaande beheerderssessie kan niets op de gewone routes (403) en geen enkele beheerroute (410)", async () => {
    const { admin } = await webmin();
    const ring = await createTestRing("Ring A");
    const token = await login(admin.id);
    for (const path of ["/me", "/dashboard", "/sessions", `/rings/${ring.id}/users`, `/rings/${ring.id}/units`, `/rings/${ring.id}/invitations`]) {
      const r = await call("GET", path, { token });
      expect(r.status, path).toBe(403);
      expect(r.body.code, path).toBe("admin-web-only");
    }
  });

  it("ringbeheerders beheren hun eigen ring zonder beheerderstoegang: geen ring aanmaken, geen bestaand account van een andere ring koppelen", async () => {
    const ring = await createTestRing("Ring A");
    const manager = await createTestUser("RINGPRESIDIUM", "Beheerder", { ringId: ring.id, isRingManager: true });
    const other = await createTestUser("HOGERAAD", "Elders", { ringId: (await createTestRing("Ring B")).id });
    const token = await login(manager.id);
    expect((await call("POST", "/rings", { token, body: { name: "Ring C" } })).status).toBeGreaterThanOrEqual(400);
    const link = await call("POST", `/rings/${ring.id}/users`, { token, body: { existingUserId: other.id, churchFunction: "Lid", role: "HOGERAAD", isRingManager: false } });
    expect([403, 400]).toContain(link.status);
    expect(await prisma.ringMembership.count({ where: { userId: other.id } })).toBe(1);
    expect(await prisma.ring.count()).toBe(2);
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
    // Een ringbeheerder voegt niet meer rechtstreeks toe, maar nodigt uit (C5.1); het geactiveerde lid verschijnt daarna in de lijst.
    const direct = await call("POST", `/rings/${ringA.id}/users`, { token, body: { name: "Nieuw Lid", email: "nieuw@test.ringapeldoorn.nl", churchFunction: "Ringsraadgever", role: "RINGSECRETARIS", isRingManager: false } });
    expect(direct.status).toBe(403);
    await createTestUser("RINGSECRETARIS", "Nieuw Lid", { ringId: ringA.id, churchFunction: "Ringsraadgever", email: "nieuw@test.ringapeldoorn.nl" });
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
    const denied = await call("POST", `/rings/${ringA.id}/invitations`, { token, body });
    expect(denied.body.code).toBe("reauth-required");
    expect((await call("POST", "/auth/reauth", { token, body: { code: "00000000" } })).status).toBe(401);
    const { createMagicLinkToken } = await import("@/lib/auth");
    const { code } = await createMagicLinkToken(manager.id, { withCode: true });
    const re = await call("POST", "/auth/reauth", { token, body: { code } });
    expect(re.status).toBe(200);
    expect((await call("POST", `/rings/${ringA.id}/invitations`, { token: re.body.token, body })).status).toBe(200);
  });
});
