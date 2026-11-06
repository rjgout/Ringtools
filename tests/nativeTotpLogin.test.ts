import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { createMagicLinkToken, createSession } from "@/lib/auth";
import { startTotpEnrollment, confirmTotpEnrollment, regenerateRecoveryCodes } from "@/lib/mfa";
import { resetDatabase, createTestUser, createTestRing } from "./setup";

// E2.3 (fase 1): native login van accounts met verplichte MFA via e-mailcode + authenticator-app, achter NATIVE_TOTP_LOGIN_ENABLED.
const { handleApi } = await import("@/lib/api/router");

const saved = { ...process.env };
function configure(o: { total?: boolean; web?: boolean } = {}) {
  process.env.WEB_TOTP_ENABLED = o.web === false ? "false" : "true";
  process.env.NATIVE_TOTP_LOGIN_ENABLED = o.total === false ? "false" : "true";
  process.env.NATIVE_PASSKEYS_ENABLED = "false";
}
afterAll(() => {
  process.env = saved;
});
beforeEach(async () => {
  await resetDatabase();
  configure();
});

let ip = 0;
let mail = 0;
async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json", "x-forwarded-for": `10.8.0.${++ip}` },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
function codeFor(secret: string, offset = 0) {
  return new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: Date.now() + offset * 30_000 });
}
async function totpUser(opts: { totp?: boolean } = {}) {
  const ring = await createTestRing(`Ring ${++mail}`);
  const user = await createTestUser("HOGERAAD", `Totp Lid ${mail}`, { ringId: ring.id, email: `ntl${mail}@test.ringapeldoorn.nl` });
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, activatedAt: new Date() } });
  let secret = "";
  if (opts.totp !== false) {
    secret = (await startTotpEnrollment(user.id, user.email)).secret;
    await confirmTotpEnrollment(user.id, user.email, codeFor(secret));
    await prisma.totpCredential.update({ where: { userId: user.id }, data: { lastUsedCounter: null } });
  }
  return { user, secret };
}
async function emailLogin(u: { user: { id: string; email: string } }) {
  const { code } = await createMagicLinkToken(u.user.id, { withCode: true });
  return call("POST", "/auth/login", { body: { email: u.user.email, code } });
}

describe("Native login met e-mailcode + authenticator-app", () => {
  it("vlag uit: oude, veilige weigering (geen pending-login, geen sessie)", async () => {
    configure({ total: false });
    const u = await totpUser();
    const res = await emailLogin(u);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("mfa-not-supported");
    expect(await prisma.session.count({ where: { userId: u.user.id } })).toBe(0);
  });

  it("vlag aan: de e-mailcode geeft alleen een pending-login (methode totp), die nergens als sessie werkt", async () => {
    const u = await totpUser();
    const res = await emailLogin(u);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mfaRequired: true, method: "totp", methods: ["totp"] });
    expect(res.body.token).toBeUndefined();
    expect((await call("GET", "/me", { token: res.body.pendingToken })).status).toBe(401);
  });

  it("de juiste code geeft een volledige sessie (nieuw token) en maakt de pending-sessie ongeldig; hergebruik van dezelfde code faalt", async () => {
    const u = await totpUser();
    const { pendingToken } = (await emailLogin(u)).body;
    const code = codeFor(u.secret, 1);
    const ok = await call("POST", "/auth/mfa/totp/verify", { token: pendingToken, body: { code } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.token).not.toBe(pendingToken);
    expect((await call("GET", "/me", { token: ok.body.token })).status).toBe(200);
    expect((await call("POST", "/auth/mfa/totp/verify", { token: pendingToken, body: { code } })).status).toBe(401); // pending-sessie is weg
    const second = (await emailLogin(u)).body.pendingToken;
    expect((await call("POST", "/auth/mfa/totp/verify", { token: second, body: { code } })).status).toBe(401); // replay
  });

  it("onjuiste codes: afgewezen; na vijf fouten lockout (ook een goede code werkt dan niet); geen sessie", async () => {
    const u = await totpUser();
    const { pendingToken } = (await emailLogin(u)).body;
    for (let i = 0; i < 5; i++) expect([401, 429]).toContain((await call("POST", "/auth/mfa/totp/verify", { token: pendingToken, body: { code: "000000" } })).status);
    const locked = await call("POST", "/auth/mfa/totp/verify", { token: pendingToken, body: { code: codeFor(u.secret, 1) } });
    expect([401, 429]).toContain(locked.status);
    expect(locked.body.token).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: u.user.id, mfaAt: { not: null } } })).toBe(0);
  });

  it("herstelcode werkt eenmalig en kent een persistente begrenzing", async () => {
    const u = await totpUser();
    const [good] = await regenerateRecoveryCodes(u.user.id);
    const { pendingToken } = (await emailLogin(u)).body;
    expect((await call("POST", "/auth/mfa/totp/verify", { token: pendingToken, body: { recoveryCode: "AAAAA-BBBBB" } })).status).toBe(401);
    const ok = await call("POST", "/auth/mfa/totp/verify", { token: pendingToken, body: { recoveryCode: good } });
    expect(ok.status).toBe(200);
    const again = (await emailLogin(u)).body.pendingToken;
    expect((await call("POST", "/auth/mfa/totp/verify", { token: again, body: { recoveryCode: good } })).status).toBe(401);
  });

  it("zonder bevestigde authenticator-app: geen TOTP-pad (veilige melding), geen sessie", async () => {
    const u = await totpUser({ totp: false });
    const res = await emailLogin(u);
    expect(res.status).toBe(403);
    const pending = await createSession(u.user.id, "Ringtools-app (wacht op passkey)");
    expect((await call("POST", "/auth/mfa/totp/verify", { token: pending.rawToken, body: { code: "123456" } })).status).toBe(403);
  });

  it("met WEB_TOTP_ENABLED uit telt de authenticator-app niet mee (fail-closed)", async () => {
    configure({ web: false });
    const u = await totpUser();
    expect((await emailLogin(u)).status).toBe(403);
  });

  it("webmin en een pending-sessie van het web kunnen dit pad niet gebruiken", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    const pending = await createSession(admin.id, "Ringtools-app (wacht op passkey)");
    expect((await call("POST", "/auth/mfa/totp/verify", { token: pending.rawToken, body: { code: "123456" } })).status).toBe(401);
    const u = await totpUser();
    const webPending = await createSession(u.user.id, "Mozilla/5.0"); // wachtende websessie, geen app-pending
    expect((await call("POST", "/auth/mfa/totp/verify", { token: webPending.rawToken, body: { code: codeFor(u.secret, 1) } })).status).toBe(401);
  });

  it("herverificatie in de app: accounts met MFA bevestigen met TOTP, nooit met een e-mailcode", async () => {
    const u = await totpUser();
    const { pendingToken } = (await emailLogin(u)).body;
    const session = await call("POST", "/auth/mfa/totp/verify", { token: pendingToken, body: { code: codeFor(u.secret, 1) } });
    const token = session.body.token as string;
    const { code: emailCode } = await createMagicLinkToken(u.user.id, { withCode: true });
    expect((await call("POST", "/auth/reauth", { token, body: { code: emailCode } })).status).toBe(403); // e-mailcode alleen: geweigerd
    expect((await call("POST", "/auth/reauth", { token, body: { code: "000000" } })).status).toBe(401);
    await prisma.totpCredential.update({ where: { userId: u.user.id }, data: { lastUsedCounter: null, failedAttempts: 0, lockedUntil: null } });
    const ok = await call("POST", "/auth/reauth", { token, body: { code: codeFor(u.secret, 1) } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
  });

  it("GET /meta meldt de functievlag", async () => {
    expect((await call("GET", "/meta")).body).toMatchObject({ nativeTotpLogin: true });
    configure({ total: false });
    expect((await call("GET", "/meta")).body).toMatchObject({ nativeTotpLogin: false });
  });
});
