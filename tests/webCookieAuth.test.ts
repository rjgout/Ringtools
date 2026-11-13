import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createMagicLinkToken, createSession, createVerifiedSession, SESSION_COOKIE_NAME, RECENT_MFA_WINDOW_MS } from "@/lib/auth";
import { resetDatabase, createTestUser, createTestRing, createCalling } from "./setup";

const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));

const { handleApi } = await import("@/lib/api/router");

// Web/PWA: de sessiecookie op /api/mobile/v1. Deze tests beschrijven de beveiligingseisen: herkomst, eigen header, geen vermenging met
// Bearer, geen token in JSON, sessie-intrekking, rollen en ringisolatie. De native (Bearer-)weg moet daarbij ongewijzigd blijven.
const ORIGIN = "https://ringtools.test";
type Opts = { cookie?: string | null; headers?: Record<string, string | null>; body?: unknown; bearer?: string };

async function web(method: "GET" | "POST", path: string, opts: Opts = {}) {
  const url = new URL(`${ORIGIN}/api/mobile/v1${path}`);
  const headers = new Headers({ "X-Ringtools-Web": "1", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" });
  if (opts.cookie) headers.set("Cookie", `${SESSION_COOKIE_NAME}=${opts.cookie}`);
  if (opts.bearer) headers.set("Authorization", `Bearer ${opts.bearer}`);
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) headers.delete(k);
    else headers.set(k, v);
  }
  const res = await handleApi(new Request(url, { method, headers, body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}) }), path.split("?")[0].split("/").filter(Boolean));
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Record<string, any>, text, headers: res.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const login = async (userId: string) => (await createVerifiedSession(userId, "Browser")).rawToken;

beforeEach(async () => {
  await resetDatabase();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
  vi.stubEnv("APP_BASE_URL", ORIGIN);
});
afterEach(() => vi.unstubAllEnvs());

async function scene() {
  const ringA = await createTestRing("Ring A");
  const ringB = await createTestRing("Ring B");
  const president = await createTestUser("RINGPRESIDIUM", "President A", { ringId: ringA.id });
  const secretary = await createTestUser("RINGSECRETARIS", "Secretaris A", { ringId: ringA.id });
  const councillor = await createTestUser("HOGERAAD", "Raadslid A", { ringId: ringA.id });
  const outsider = await createTestUser("RINGPRESIDIUM", "President B", { ringId: ringB.id });
  return { ringA, ringB, president, secretary, councillor, outsider };
}

describe("Cookie-aanmelding: basis", () => {
  it("een geldige sessiecookie toegang tot het eigen profiel; antwoorden zijn no-store en zonder CORS-headers", async () => {
    const { president, ringA } = await scene();
    const res = await web("GET", "/me", { cookie: await login(president.id) });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(president.id);
    expect(res.body.rings.map((r: { id: string }) => r.id)).toEqual([ringA.id]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    for (const h of ["access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-headers"]) expect(res.headers.get(h)).toBeNull();
  });

  it("zonder cookie, met een onbekende of een misvormde cookie: 401", async () => {
    await scene();
    expect((await web("GET", "/me")).status).toBe(401);
    expect((await web("GET", "/me", { cookie: "a".repeat(43) })).status).toBe(401);
    expect((await web("GET", "/me", { cookie: "kort" })).status).toBe(401);
    expect((await web("GET", "/me", { cookie: "x".repeat(40) + "<script>" })).status).toBe(401);
  });

  it("een dubbele sessiecookie wordt niet geraden: 401", async () => {
    const { president, secretary } = await scene();
    const a = await login(president.id);
    const b = await login(secretary.id);
    const res = await web("GET", "/me", { headers: { Cookie: `${SESSION_COOKIE_NAME}=${a}; ${SESSION_COOKIE_NAME}=${b}` } });
    expect(res.status).toBe(401);
  });
});

describe("Cookie-aanmelding: herkomst en CSRF", () => {
  it("de cookie telt nooit zonder de eigen header (dus niet voor de Bearer-weg, formulieren of links)", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    expect((await web("GET", "/me", { cookie, headers: { "X-Ringtools-Web": null } })).status).toBe(401);
    expect((await web("POST", "/me/email-notifications", { cookie, body: { enabled: false }, headers: { "X-Ringtools-Web": null } })).status).toBe(401);
  });

  it("weigert een afwijkende waarde van de eigen header", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    for (const value of ["0", "true", "", "1, 1", " 2"]) {
      const res = await web("GET", "/me", { cookie, headers: { "X-Ringtools-Web": value } });
      expect([403, 401], `waarde ${JSON.stringify(value)}`).toContain(res.status);
      expect(res.body.user).toBeUndefined();
    }
  });

  it("weigert elke afwijkende Origin (andere site, subdomein, http, andere poort, null)", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    for (const origin of ["https://evil.example", "https://sub.ringtools.test", "http://ringtools.test", "https://ringtools.test:8443", "https://ringtools.test.evil.example", "null", "https://RINGTOOLS.test/"]) {
      const res = await web("GET", "/me", { cookie, headers: { Origin: origin } });
      expect(res.status, origin).toBe(403);
      expect(res.body.code).toBe("web-origin");
    }
  });

  it("weigert Sec-Fetch-Site anders dan same-origin, ook als Origin klopt of ontbreekt", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    for (const site of ["cross-site", "same-site", "none"]) {
      expect((await web("GET", "/me", { cookie, headers: { "Sec-Fetch-Site": site } })).status, site).toBe(403);
      expect((await web("GET", "/me", { cookie, headers: { "Sec-Fetch-Site": site, Origin: null } })).status, site).toBe(403);
    }
  });

  it("zonder Origin én zonder Sec-Fetch-Site wordt geweigerd; één van beide (correct) is genoeg", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    expect((await web("GET", "/me", { cookie, headers: { Origin: null, "Sec-Fetch-Site": null } })).status).toBe(403);
    expect((await web("GET", "/me", { cookie, headers: { Origin: null } })).status).toBe(200);
    expect((await web("GET", "/me", { cookie, headers: { "Sec-Fetch-Site": null } })).status).toBe(200);
  });

  it("een wijzigend verzoek zonder JSON-inhoudstype (formulierinzending) wordt geweigerd", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data", null]) {
      const res = await web("POST", "/me/email-notifications", { cookie, body: { enabled: false }, headers: { "Content-Type": type } });
      expect(res.status, String(type)).toBe(403);
      expect(res.body.code).toBe("web-content-type");
    }
    expect((await web("POST", "/me/email-notifications", { cookie, body: { enabled: true } })).status).toBe(200);
  });
});

describe("Geen vermenging van Bearer en cookie", () => {
  it("Bearer-token samen met de eigen header wordt geweigerd (400), ook als beide geldig zijn", async () => {
    const { president } = await scene();
    const token = await login(president.id);
    const res = await web("GET", "/me", { cookie: token, bearer: token });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("mixed-auth");
    expect((await web("GET", "/me", { bearer: token })).status).toBe(400);
    expect((await web("GET", "/me", { cookie: token, headers: { Authorization: "Basic abc" } })).status).toBe(400);
  });

  it("de native weg blijft ongewijzigd: Bearer zonder eigen header werkt en negeert een meegestuurde cookie van een ander account", async () => {
    const { president, secretary } = await scene();
    const bearer = await login(president.id);
    const otherCookie = await login(secretary.id);
    const url = new URL(`${ORIGIN}/api/mobile/v1/me`);
    const res = await handleApi(new Request(url, { headers: { Authorization: `Bearer ${bearer}`, Cookie: `${SESSION_COOKIE_NAME}=${otherCookie}` } }), ["me"]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(president.id);
  });

  it("de native weg geeft bij herverificatie/rotatie nog steeds een token in de JSON (en zet nooit een cookie)", async () => {
    const { president } = await scene();
    const bearer = await login(president.id);
    const { code } = await createMagicLinkToken(president.id, { withCode: true });
    const url = new URL(`${ORIGIN}/api/mobile/v1/auth/reauth`);
    const res = await handleApi(new Request(url, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ code }) }), ["auth", "reauth"]);
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as { token: string }).token).toBe("string");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("Het sessietoken komt nooit in JavaScript", () => {
  it("herverificatie via de cookie zet een nieuwe HttpOnly-cookie en geeft geen token in de JSON; de oude sessie vervalt", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    const { code } = await createMagicLinkToken(president.id, { withCode: true });
    const res = await web("POST", "/auth/reauth", { cookie, body: { code } });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.text).not.toMatch(/"token"/);
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{20,}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=\\d+$`));
    const fresh = /=([^;]+);/.exec(set)![1];
    expect(fresh).not.toBe(cookie);
    expect((await web("GET", "/me", { cookie: fresh })).status).toBe(200);
    expect((await web("GET", "/me", { cookie })).status).toBe(401);
  });

  it("uitloggen via de cookie trekt de sessie in en wist de cookie", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    const res = await web("POST", "/auth/logout", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0$`));
    expect((await web("GET", "/me", { cookie })).status).toBe(401);
  });

  it("routes die een token uitgeven of bij een toestel horen zijn voor de webclient afgesloten", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    const { code } = await createMagicLinkToken(president.id, { withCode: true });
    const publicRoutes: [string, unknown][] = [
      ["/auth/login", { email: president.email, code }],
      ["/auth/request-code", { email: president.email }],
      ["/auth/review/login", { email: president.email, password: "x" }],
      ["/invitations/activate", { token: "t".repeat(30), issueSession: true }],
      ["/auth/device/challenge", {}],
      ["/auth/device/login", {}],
      ["/trusted-devices/pair/claim", {}],
      ["/auth/mfa/totp/verify", {}],
      ["/devices/unregister", { token: "x" }],
    ];
    for (const [path, body] of publicRoutes) {
      const res = await web("POST", path, { cookie, body });
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe("web-not-allowed");
      expect(res.text, path).not.toMatch(/"token"/);
    }
    for (const path of ["/auth/device/status", "/auth/device/enroll/challenge", "/auth/device/disable", "/auth/reauth/passkey/options", "/devices/remove"]) {
      const res = await web("POST", path, { cookie });
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe("web-not-allowed");
    }
    // De code is niet verbruikt door de geweigerde aanroep: de bestaande website kan er nog mee inloggen.
    expect(await prisma.magicLinkToken.count({ where: { userId: president.id, usedAt: null } })).toBe(1);
    expect((await web("GET", "/meta")).status).toBe(200);
  });

  it("openbare routes controleren de herkomst ook: een andere site krijgt 403, geen inhoud", async () => {
    await scene();
    expect((await web("GET", "/meta", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });
});

describe("Sessie, MFA en intrekking via de cookie", () => {
  it("een sessie zonder voltooide MFA (pre-MFA) geeft nooit toegang", async () => {
    const { president } = await scene();
    const pending = await createSession(president.id, "Browser");
    expect((await web("GET", "/me", { cookie: pending.rawToken })).status).toBe(401);
  });

  it("intrekken van de sessie, deactiveren van het account of het lidmaatschap en een inactieve ring werken direct", async () => {
    const { president, secretary, councillor, ringA } = await scene();
    const c1 = await login(president.id);
    await prisma.session.deleteMany({ where: { userId: president.id } });
    expect((await web("GET", "/me", { cookie: c1 })).status).toBe(401);

    const c2 = await login(secretary.id);
    await prisma.user.update({ where: { id: secretary.id }, data: { active: false } });
    expect((await web("GET", "/me", { cookie: c2 })).status).toBe(401);

    const c3 = await login(councillor.id);
    expect((await web("GET", `/dashboard?ring=${ringA.id}`, { cookie: c3 })).status).toBe(200);
    await prisma.ringMembership.updateMany({ where: { userId: councillor.id }, data: { active: false } });
    expect((await web("GET", `/dashboard?ring=${ringA.id}`, { cookie: c3 })).status).toBe(404);
    await prisma.ringMembership.updateMany({ where: { userId: councillor.id }, data: { active: true } });
    await prisma.ring.update({ where: { id: ringA.id }, data: { active: false } });
    expect((await web("GET", `/dashboard?ring=${ringA.id}`, { cookie: c3 })).status).toBe(404);
  });

  it("een andere gebruiker kan via de webomgeving een sessie intrekken; die cookie werkt daarna niet meer", async () => {
    const { president } = await scene();
    const first = await login(president.id);
    const second = await login(president.id);
    const list = await web("GET", "/sessions", { cookie: first });
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    expect((await web("POST", `/sessions/${other.id}/revoke`, { cookie: first })).status).toBe(200);
    expect((await web("GET", "/me", { cookie: second })).status).toBe(401);
    expect((await web("GET", "/me", { cookie: first })).status).toBe(200);
  });

  it("gevoelige beheeracties vragen ook via de cookie een recente verificatie (reauth-required)", async () => {
    const { president, ringA } = await scene();
    await prisma.ringMembership.updateMany({ where: { userId: president.id }, data: { isRingManager: true } });
    const cookie = await login(president.id);
    await prisma.session.updateMany({ where: { userId: president.id }, data: { mfaAt: new Date(Date.now() - RECENT_MFA_WINDOW_MS - 60_000) } });
    const res = await web("POST", `/rings/${ringA.id}/invitations`, { cookie, body: { name: "Nieuw Lid", email: "nieuw@test.ringapeldoorn.nl", role: "HOGERAAD" } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("reauth-required");
    expect(await prisma.ringInvitation.count()).toBe(0);
  });

  it("het beheerdersaccount wordt ook via de cookie geweigerd en /admin blijft afgesloten", async () => {
    await scene();
    const admin = await createTestUser("ADMIN", "webmin");
    const cookie = await login(admin.id);
    const me = await web("GET", "/me", { cookie });
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("admin-web-only");
    expect((await web("GET", "/admin/rings", { cookie })).status).toBe(410);
  });
});

describe("Rollen en ringisolatie via de cookie (zelfde regels als de app)", () => {
  it("een lid van ring B ziet niets van ring A: overzicht, voorstellen, voorstel, gebruikers, uitnodigingen, inrichting", async () => {
    const { ringA, president, outsider } = await scene();
    const calling = await createCalling({ ringId: ringA.id, createdById: president.id, personName: "Voorgestelde Persoon", functionTitle: "Testroeping" });
    const cookie = await login(outsider.id);
    for (const path of [`/dashboard?ring=${ringA.id}`, `/callings?ring=${ringA.id}`, `/callings/${calling.id}`, `/rings/${ringA.id}/users`, `/rings/${ringA.id}/invitations`, `/rings/${ringA.id}/setup`, `/ontheffingen?ring=${ringA.id}`]) {
      const res = await web("GET", path, { cookie });
      expect([403, 404], path).toContain(res.status);
      expect(res.text, path).not.toContain("President A");
    }
  });

  it("gebruikersbeheer en uitnodigen zijn alleen voor de ringbeheerder van die ring; een hogeraadslid en een secretaris zonder beheer krijgen niets", async () => {
    const { ringA, president, secretary, councillor } = await scene();
    await prisma.ringMembership.updateMany({ where: { userId: president.id }, data: { isRingManager: true } });
    for (const user of [secretary, councillor]) {
      const cookie = await login(user.id);
      expect((await web("GET", `/rings/${ringA.id}/users`, { cookie })).status).toBe(404);
      const invite = await web("POST", `/rings/${ringA.id}/invitations`, { cookie, body: { name: "Nieuw Lid", email: "x@test.ringapeldoorn.nl", role: "HOGERAAD" } });
      expect([403, 404]).toContain(invite.status);
    }
    const manager = await login(president.id);
    expect((await web("GET", `/rings/${ringA.id}/users`, { cookie: manager })).status).toBe(200);
    const created = await web("POST", `/rings/${ringA.id}/invitations`, { cookie: manager, body: { name: "Nieuw Lid", email: "nieuw@test.ringapeldoorn.nl", role: "HOGERAAD" } });
    expect(created.status).toBe(200);
    expect(await prisma.ringInvitation.count({ where: { ringId: ringA.id } })).toBe(1);
    expect(created.text).not.toMatch(/tokenHash|codeHash/);
  });

  it("een hogeraadslid kan via de cookie zijn eigen overzicht en voorstellenlijst openen, maar geen voorstel verwijderen of verwerken", async () => {
    const { ringA, president, councillor } = await scene();
    const calling = await createCalling({ ringId: ringA.id, createdById: president.id, personName: "Voorgestelde Persoon", functionTitle: "Testroeping" });
    const cookie = await login(councillor.id);
    expect((await web("GET", `/dashboard?ring=${ringA.id}`, { cookie })).status).toBe(200);
    expect((await web("GET", `/callings?ring=${ringA.id}`, { cookie })).status).toBe(200);
    for (const action of ["delete", "process", "release"]) {
      const res = await web("POST", `/callings/${calling.id}/${action}`, { cookie });
      expect([400, 403, 404], action).toContain(res.status);
    }
    expect(await prisma.calling.count({ where: { id: calling.id } })).toBe(1);
  });
});

describe("Webpush en e-mailvoorkeur (alleen webomgeving)", () => {
  it("overzicht bevat geen endpoint of sleutels; verwijderen werkt alleen op eigen apparaten", async () => {
    const { president, secretary } = await scene();
    const mine = await prisma.pushSubscription.create({ data: { userId: president.id, endpoint: "https://fcm.googleapis.com/fcm/send/mine", p256dh: "p", auth: "a", userAgent: "Chrome Android" } });
    const theirs = await prisma.pushSubscription.create({ data: { userId: secretary.id, endpoint: "https://fcm.googleapis.com/fcm/send/theirs", p256dh: "p", auth: "a" } });
    const cookie = await login(president.id);
    const overview = await web("GET", "/web-push", { cookie });
    expect(overview.status).toBe(200);
    expect(overview.body.subscriptions).toEqual([{ id: mine.id, userAgent: "Chrome Android", createdAt: mine.createdAt.toISOString() }]);
    expect(overview.text).not.toMatch(/fcm\.googleapis|p256dh|"auth"/);
    expect((await web("POST", `/web-push/${theirs.id}/remove`, { cookie })).status).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { id: theirs.id } })).toBe(1);
    expect((await web("POST", `/web-push/${mine.id}/remove`, { cookie })).status).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { id: mine.id } })).toBe(0);
  });

  it("een ongeldig of vreemd endpoint wordt niet opgeslagen", async () => {
    const { president } = await scene();
    const cookie = await login(president.id);
    const res = await web("POST", "/web-push/subscribe", { cookie, body: { endpoint: "https://evil.example/push", keys: { p256dh: "x", auth: "y" } } });
    expect(res.body.ok).toBe(false);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("e-mailvoorkeur wijzigen werkt voor het eigen account; de webpush-routes bestaan niet voor de native (Bearer-)weg", async () => {
    const { president } = await scene();
    const token = await login(president.id);
    expect((await web("POST", "/me/email-notifications", { cookie: token, body: { enabled: false } })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: president.id } })).emailNotificationsEnabled).toBe(false);
    const url = new URL(`${ORIGIN}/api/mobile/v1/web-push`);
    const res = await handleApi(new Request(url, { headers: { Authorization: `Bearer ${token}` } }), ["web-push"]);
    expect(res.status).toBe(404);
  });
});
