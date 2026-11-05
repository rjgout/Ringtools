import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createMagicLinkToken, createSession, createVerifiedSession } from "@/lib/auth";
import { resetDatabase, createTestUser, createTestRing } from "./setup";

// Deze tests gebruiken de ECHTE WebAuthn-bibliotheek met een software-authenticator (geen mocks): zo worden RP ID, origin,
// challenge, user verification en teller werkelijk gecontroleerd. Alleen de native ceremonie op een toestel ontbreekt.
const { handleApi } = await import("@/lib/api/router");
const { androidOriginsFromFingerprints, allowedOrigins, verifyPasskeyAuthentication, startPasskeyAuthentication } = await import("@/lib/webauthn");

const WEB = "https://ringapeldoorn.nl";
const RP = "ringapeldoorn.nl";
const FINGERPRINT = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
const ANDROID_ORIGIN = `android:apk-key-hash:${Buffer.from(FINGERPRINT.replace(/:/g, ""), "hex").toString("base64url")}`;

const saved = { ...process.env };
function configure(on = true) {
  process.env.APP_BASE_URL = WEB;
  process.env.NATIVE_PASSKEYS_ENABLED = on ? "true" : "false";
  process.env.ANDROID_SHA256_FINGERPRINTS = FINGERPRINT;
}
afterAll(() => {
  process.env = saved;
});

beforeEach(async () => {
  await resetDatabase();
  configure(true);
});

let ip = 0;
let mailCounter = 0;
async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest();

function authenticator() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, "base64url"), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, "base64url")]);
  const credentialId = b64u(crypto.randomBytes(16));
  return {
    credentialId,
    cose,
    assert(o: { challenge: string; origin?: string; rpId?: string; counter?: number; uv?: boolean; type?: string }) {
      const clientData = JSON.stringify({ type: o.type ?? "webauthn.get", challenge: o.challenge, origin: o.origin ?? WEB, crossOrigin: false });
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(o.counter ?? 1);
      const authData = Buffer.concat([sha256(o.rpId ?? RP), Buffer.from([0x01 | (o.uv === false ? 0 : 0x04)]), counter]);
      const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
      return { id: credentialId, rawId: credentialId, type: "public-key", response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) }, clientExtensionResults: {} };
    },
  };
}

async function mfaUser(name = "Mfa Lid", opts: { passkey?: boolean; counter?: number } = {}) {
  const ring = await createTestRing(`Ring ${name}`);
  // Uniek e-mailadres per test: de inlogcode-rate-limit in de API is per adres en leeft de hele testrun.
  const user = await createTestUser("HOGERAAD", name, { ringId: ring.id, email: `mfa${++mailCounter}@test.ringapeldoorn.nl` });
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, activatedAt: new Date() } });
  const key = authenticator();
  if (opts.passkey !== false) {
    await prisma.webAuthnCredential.create({ data: { userId: user.id, credentialId: key.credentialId, publicKey: key.cose, counter: BigInt(opts.counter ?? 0), transports: "internal" } });
  }
  return { user, ring, key };
}

async function startLogin(userId: string, email: string) {
  const { code } = await createMagicLinkToken(userId, { withCode: true });
  return call("POST", "/auth/login", { body: { email, code } });
}
/** Volledige begin van de flow: pending-login + opties. */
async function pendingWithOptions(u: Awaited<ReturnType<typeof mfaUser>>) {
  const login = await startLogin(u.user.id, u.user.email);
  expect(login.status).toBe(200);
  const pendingToken = login.body.pendingToken as string;
  const opts = await call("POST", "/auth/mfa/passkey/options", { token: pendingToken });
  expect(opts.status).toBe(200);
  return { pendingToken, challenge: opts.body.options.challenge as string, login };
}
const verifyCall = (pendingToken: string, response: unknown) => call("POST", "/auth/mfa/passkey/verify", { token: pendingToken, body: { response } });

describe("Native passkey-login: pending-login", () => {
  it("functievlag uit: MFA-account kan niet via de app inloggen (oude, veilige weigering) en krijgt geen sessie of token", async () => {
    configure(false);
    const u = await mfaUser();
    const sessionsBefore = await prisma.session.count();
    const res = await startLogin(u.user.id, u.user.email);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("mfa-not-supported");
    expect(res.body.token).toBeUndefined();
    expect(res.body.pendingToken).toBeUndefined();
    expect(await prisma.session.count()).toBe(sessionsBefore);
    // Ook de overige routes blijven dicht.
    const pending = await createSession(u.user.id, "Ringtools-app (wacht op passkey)");
    expect((await call("POST", "/auth/mfa/passkey/options", { token: pending.rawToken })).status).toBe(403);
  });

  it("zonder geregistreerde passkey volgt een veilige melding (registreren blijft webapp-only), geen sessie", async () => {
    const u = await mfaUser("Zonder Key", { passkey: false });
    const res = await startLogin(u.user.id, u.user.email);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("mfa-enrollment-required");
    expect(res.body.token).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: u.user.id } })).toBe(0);
  });

  it("met MFA: e-mailcode geeft alleen een pending-login die nergens als sessie werkt", async () => {
    const u = await mfaUser();
    const login = await startLogin(u.user.id, u.user.email);
    expect(login.body).toMatchObject({ mfaRequired: true, method: "passkey" });
    expect(login.body.token).toBeUndefined();
    expect(login.body.user).toBeUndefined();
    const pending = login.body.pendingToken as string;
    const s = await prisma.session.findFirstOrThrow({ where: { userId: u.user.id } });
    expect(s.mfaAt).toBeNull();
    expect(s.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    for (const path of ["/me", "/dashboard", "/sessions", "/devices", `/rings/${u.ring.id}/users`, "/catalog/callings", "/ontheffingen"]) {
      expect((await call("GET", path, { token: pending })).status, path).toBe(401);
    }
    for (const path of ["/auth/refresh", "/auth/reauth", "/devices", "/auth/logout"]) {
      expect((await call("POST", path, { token: pending, body: {} })).status, path).toBe(401);
    }
    expect((await call("GET", "/admin/me", { token: pending })).status).toBe(401);
    // De code is eenmalig: opnieuw gebruiken lukt niet.
    const { code } = await createMagicLinkToken(u.user.id, { withCode: true });
    expect((await call("POST", "/auth/login", { body: { email: u.user.email, code } })).status).toBe(200);
    expect((await call("POST", "/auth/login", { body: { email: u.user.email, code } })).status).toBe(401);
  });

  it("een nieuwe login vervangt de vorige wachtende app-login (geen opeenhoping)", async () => {
    const u = await mfaUser();
    const a = await startLogin(u.user.id, u.user.email);
    const b = await startLogin(u.user.id, u.user.email);
    expect(await prisma.session.count({ where: { userId: u.user.id, mfaAt: null } })).toBe(1);
    expect((await call("POST", "/auth/mfa/passkey/options", { token: a.body.pendingToken })).status).toBe(401);
    expect((await call("POST", "/auth/mfa/passkey/options", { token: b.body.pendingToken })).status).toBe(200);
  });
});

describe("Native passkey-login: verificatie", () => {
  it("geldige assertion → volledige sessie; pending-token vervalt; teller en laatste gebruik worden bijgewerkt; auditregel", async () => {
    const u = await mfaUser("Eva", { counter: 3 });
    const { pendingToken, challenge } = await pendingWithOptions(u);
    const ok = await verifyCall(pendingToken, u.key.assert({ challenge, counter: 4 }));
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.token).not.toBe(pendingToken); // sessierotatie, geen sessiefixatie
    expect(ok.body.user.email).toBe(u.user.email);
    expect((await call("GET", "/me", { token: ok.body.token })).status).toBe(200);
    expect((await call("GET", "/me", { token: pendingToken })).status).toBe(401);
    expect((await call("POST", "/auth/mfa/passkey/options", { token: pendingToken })).status).toBe(401);
    const s = await prisma.session.findFirstOrThrow({ where: { userId: u.user.id } });
    expect(s.mfaAt).not.toBeNull();
    const cred = await prisma.webAuthnCredential.findFirstOrThrow({ where: { userId: u.user.id } });
    expect(Number(cred.counter)).toBe(4);
    expect(cred.lastUsedAt).not.toBeNull();
    expect((await prisma.securityEvent.findMany({ where: { userId: u.user.id, type: "MFA_VERIFIED" } })).length).toBe(1);
  });

  it("zonder eerst opties op te vragen (geen challenge) faalt de verificatie", async () => {
    const u = await mfaUser();
    const login = await startLogin(u.user.id, u.user.email);
    const res = await verifyCall(login.body.pendingToken, u.key.assert({ challenge: b64u(crypto.randomBytes(32)) }));
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("verkeerde challenge faalt; een challenge is eenmalig (hergebruik faalt, ook met geldige handtekening)", async () => {
    const u = await mfaUser();
    const { pendingToken, challenge } = await pendingWithOptions(u);
    expect((await verifyCall(pendingToken, u.key.assert({ challenge: b64u(crypto.randomBytes(32)) }))).status).toBe(401);
    // De challenge is na de mislukte poging verbruikt: dezelfde (juiste) assertion werkt nu niet meer.
    expect((await verifyCall(pendingToken, u.key.assert({ challenge }))).status).toBe(401);
    // Nieuwe opties geven een nieuwe challenge; de oude assertion blijft ongeldig (replay).
    const again = await call("POST", "/auth/mfa/passkey/options", { token: pendingToken });
    expect(again.body.options.challenge).not.toBe(challenge);
    expect((await verifyCall(pendingToken, u.key.assert({ challenge }))).status).toBe(401);
    // Ook deze mislukte poging verbruikte de lopende challenge: opnieuw opties vragen is nodig.
    const third = await call("POST", "/auth/mfa/passkey/options", { token: pendingToken });
    expect((await verifyCall(pendingToken, u.key.assert({ challenge: third.body.options.challenge }))).status).toBe(200);
  });

  it("een geslaagde assertion kan niet opnieuw worden afgespeeld (nieuwe login, oude assertion)", async () => {
    const u = await mfaUser();
    const first = await pendingWithOptions(u);
    const assertion = u.key.assert({ challenge: first.challenge, counter: 1 });
    expect((await verifyCall(first.pendingToken, assertion)).status).toBe(200);
    const second = await pendingWithOptions(u);
    expect((await verifyCall(second.pendingToken, assertion)).status).toBe(401);
  });

  it("verkeerde origin en verkeerde RP ID worden geweigerd; onbekende Android-origin ook", async () => {
    const u = await mfaUser();
    for (const variant of [{ origin: "https://evil.example" }, { origin: "https://ringapeldoorn.nl.evil.example" }, { origin: "http://ringapeldoorn.nl" }, { rpId: "evil.example" }, { origin: "android:apk-key-hash:onbekende-hash" }]) {
      const { pendingToken, challenge } = await pendingWithOptions(u);
      const res = await verifyCall(pendingToken, u.key.assert({ challenge, ...variant }));
      expect(res.status, JSON.stringify(variant)).toBe(401);
      expect(res.body.token).toBeUndefined();
    }
  });

  it("geconfigureerde Android-app-origin is toegestaan op de native route, maar nooit in de webapp-verificatie", async () => {
    const u = await mfaUser();
    const { pendingToken, challenge } = await pendingWithOptions(u);
    expect((await verifyCall(pendingToken, u.key.assert({ challenge, origin: ANDROID_ORIGIN }))).status).toBe(200);

    expect(allowedOrigins(false)).toEqual([WEB]);
    expect(allowedOrigins(true)).toEqual([WEB, ANDROID_ORIGIN]);
    const other = await mfaUser("Web Lid");
    const opts = (await startPasskeyAuthentication(other.user.id))!;
    const web = await verifyPasskeyAuthentication(other.user.id, other.key.assert({ challenge: opts.challenge, origin: ANDROID_ORIGIN, counter: 1 }) as never);
    expect(web.ok).toBe(false);
  });

  it("zonder user verification, met teller-regressie of verkeerd ceremonietype faalt de verificatie", async () => {
    const u = await mfaUser("Teller", { counter: 10 });
    const cases = [{ uv: false, counter: 11 }, { counter: 5 }, { counter: 10 }, { type: "webauthn.create", counter: 11 }];
    for (const c of cases) {
      const { pendingToken, challenge } = await pendingWithOptions(u);
      expect((await verifyCall(pendingToken, u.key.assert({ challenge, ...c }))).status, JSON.stringify(c)).toBe(401);
    }
    expect(Number((await prisma.webAuthnCredential.findFirstOrThrow({ where: { userId: u.user.id } })).counter)).toBe(10);
  });

  it("een passkey van een ander account (of andere ring) wordt niet geaccepteerd voor deze login", async () => {
    const a = await mfaUser("Account A");
    const b = await mfaUser("Account B");
    const { pendingToken, challenge } = await pendingWithOptions(a);
    const res = await verifyCall(pendingToken, b.key.assert({ challenge, counter: 1 }));
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: a.user.id, mfaAt: { not: null } } })).toBe(0);
    expect((await prisma.securityEvent.findMany({ where: { userId: a.user.id, type: "PASSKEY_LOGIN_FAILED" } })).length).toBeGreaterThan(0);
  });

  it("onjuist gevormde assertion geeft een nette fout (400), nooit een token of een 500", async () => {
    const u = await mfaUser();
    const { pendingToken } = await pendingWithOptions(u);
    for (const bad of [undefined, null, "tekst", {}, { id: "x", rawId: "x", type: "password", response: {} }, { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON: "!!", authenticatorData: "!!", signature: "!!" } }]) {
      const res = await call("POST", "/auth/mfa/passkey/verify", { token: pendingToken, body: { response: bad } });
      expect([400, 401]).toContain(res.status);
      expect(res.body.token).toBeUndefined();
    }
  });

  it("annuleren ruimt de pending-login direct op; daarna werkt er niets meer", async () => {
    const u = await mfaUser();
    const { pendingToken } = await pendingWithOptions(u);
    expect((await call("POST", "/auth/mfa/cancel", { token: pendingToken })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: u.user.id } })).toBe(0);
    expect((await call("POST", "/auth/mfa/passkey/options", { token: pendingToken })).status).toBe(401);
    expect((await call("POST", "/auth/mfa/cancel", { token: pendingToken })).status).toBe(200); // idempotent
    expect((await call("POST", "/auth/mfa/cancel", {})).status).toBe(401);
  });

  it("een verlopen pending-login, een gedeactiveerd account en een volledige sessie werken niet op de MFA-routes", async () => {
    const u = await mfaUser();
    const { pendingToken } = await pendingWithOptions(u);
    await prisma.session.updateMany({ where: { userId: u.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("POST", "/auth/mfa/passkey/options", { token: pendingToken })).status).toBe(401);

    const v = await mfaUser("Inactief");
    const p = await pendingWithOptions(v);
    await prisma.user.update({ where: { id: v.user.id }, data: { active: false } });
    expect((await call("POST", "/auth/mfa/passkey/options", { token: p.pendingToken })).status).toBe(401);
    expect((await verifyCall(p.pendingToken, v.key.assert({ challenge: p.challenge, counter: 1 }))).status).toBe(401);

    const w = await mfaUser("Volledig");
    const full = (await createVerifiedSession(w.user.id, "Test")).rawToken;
    expect((await call("POST", "/auth/mfa/passkey/options", { token: full })).status).toBe(401); // alleen wachtende sessies
  });

  it("webmin en web-pending-sessies kunnen de native passkey-route niet gebruiken", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    const adminPending = await createSession(admin.id, "Ringtools-app (wacht op passkey)");
    expect((await call("POST", "/auth/mfa/passkey/options", { token: adminPending.rawToken })).status).toBe(401);
    const u = await mfaUser();
    const web = await createSession(u.user.id, "Mozilla/5.0"); // wachtende websessie
    expect((await call("POST", "/auth/mfa/passkey/options", { token: web.rawToken })).status).toBe(401);
    const noMfa = await createTestUser("HOGERAAD", "Geen Mfa", { ringId: u.ring.id, email: "geen.mfa@test.ringapeldoorn.nl" });
    const p = await createSession(noMfa.id, "Ringtools-app (wacht op passkey)");
    expect((await call("POST", "/auth/mfa/passkey/options", { token: p.rawToken })).status).toBe(401);
  });

  it("te veel mislukte pogingen: vergrendeling, pending-login weg, ook een nieuwe login wordt tijdelijk geweigerd", async () => {
    const u = await mfaUser("Brute Force");
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const login = await startLogin(u.user.id, u.user.email);
      if (login.status !== 200) {
        last = login.status;
        break;
      }
      const opts = await call("POST", "/auth/mfa/passkey/options", { token: login.body.pendingToken });
      if (opts.status !== 200) {
        last = opts.status;
        break;
      }
      const res = await verifyCall(login.body.pendingToken, u.key.assert({ challenge: b64u(crypto.randomBytes(32)) }));
      last = res.status;
    }
    expect(last).toBe(429);
    const blocked = await startLogin(u.user.id, u.user.email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.pendingToken).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: u.user.id, mfaAt: null } })).toBe(0);
  });

  it("opties vragen is beperkt per gebruiker", async () => {
    const u = await mfaUser("Rate");
    const { pendingToken } = await pendingWithOptions(u);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call("POST", "/auth/mfa/passkey/options", { token: pendingToken })).status);
    expect(statuses).toContain(429);
  });
});

describe("Herverificatie met passkey (ingelogde MFA-gebruiker)", () => {
  it("geldige assertion roteert de sessie en maakt de herverificatie vers; gebruiker zonder MFA wordt geweigerd", async () => {
    const u = await mfaUser("Reauth");
    const token = (await createVerifiedSession(u.user.id, "Test")).rawToken;
    await prisma.session.updateMany({ where: { userId: u.user.id }, data: { mfaAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const opts = await call("POST", "/auth/reauth/passkey/options", { token });
    expect(opts.status).toBe(200);
    expect((await call("POST", "/auth/reauth/passkey/verify", { token, body: { response: u.key.assert({ challenge: b64u(crypto.randomBytes(32)) }) } })).status).toBe(401);
    const again = await call("POST", "/auth/reauth/passkey/options", { token });
    const ok = await call("POST", "/auth/reauth/passkey/verify", { token, body: { response: u.key.assert({ challenge: again.body.options.challenge, counter: 1 }) } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).not.toBe(token);
    expect((await call("GET", "/me", { token })).status).toBe(401);
    expect((await call("GET", "/me", { token: ok.body.token })).status).toBe(200);

    const plain = await createTestUser("HOGERAAD", "Geen Mfa Reauth", { ringId: u.ring.id, email: "geen.mfa.reauth@test.ringapeldoorn.nl" });
    const plainToken = (await createVerifiedSession(plain.id, "Test")).rawToken;
    expect((await call("POST", "/auth/reauth/passkey/options", { token: plainToken })).status).toBe(400);
  });
});

describe("Origins en configuratie", () => {
  it("androidOriginsFromFingerprints accepteert alleen geldige SHA-256-vingerafdrukken", () => {
    expect(androidOriginsFromFingerprints([FINGERPRINT])).toEqual([ANDROID_ORIGIN]);
    expect(androidOriginsFromFingerprints(["", "AA:BB", "zz".repeat(32), FINGERPRINT.slice(0, -3)])).toEqual([]);
    process.env.ANDROID_SHA256_FINGERPRINTS = "";
    expect(allowedOrigins(true)).toEqual([WEB]); // zonder configuratie geen Android-origin, geen wildcard
  });

  it("/meta meldt of native passkeys zijn ingeschakeld", async () => {
    expect((await call("GET", "/meta")).body.nativePasskeys).toBe(true);
    configure(false);
    expect((await call("GET", "/meta")).body.nativePasskeys).toBe(false);
  });
});

describe("Gelijktijdigheid: challenge en sessie zijn eenmalig te verbruiken", () => {
  it("meerdere gelijktijdige verificaties van dezelfde assertion: precies één slaagt en er ontstaat precies één volledige sessie", async () => {
    const u = await mfaUser("Race Verify");
    const { pendingToken, challenge } = await pendingWithOptions(u);
    const assertion = u.key.assert({ challenge, counter: 1 });
    // 4 parallelle verzoeken: blijft onder de vergrendelingsdrempel (5 mislukte pogingen), zodat het resultaat uitsluitend van de atomaire verbruiksregels afhangt.
    const results = await Promise.all(Array.from({ length: 4 }, () => verifyCall(pendingToken, assertion)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 401 && r.body.token === undefined)).toBe(true);
    expect(await prisma.session.count({ where: { userId: u.user.id, mfaAt: { not: null } } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: u.user.id, mfaAt: null } })).toBe(0);
    const winner = results.find((r) => r.status === 200)!;
    expect((await call("GET", "/me", { token: winner.body.token })).status).toBe(200);
  });

  it("de challenge zelf (bibliotheekniveau) is atomair: gelijktijdige verificaties met één challenge geven hooguit één succes", async () => {
    const u = await mfaUser("Race Challenge");
    for (let round = 0; round < 5; round++) {
      const opts = (await startPasskeyAuthentication(u.user.id))!;
      const assertion = u.key.assert({ challenge: opts.challenge, counter: round + 1 });
      const results = await Promise.all(Array.from({ length: 6 }, () => verifyPasskeyAuthentication(u.user.id, assertion as never, { native: true })));
      expect(results.filter((r) => r.ok), `ronde ${round}`).toHaveLength(1);
    }
  });

  it("promoteSessionToMfaVerified geeft bij gelijktijdige aanroepen voor één sessie hooguit één nieuwe sessie uit", async () => {
    const { promoteSessionToMfaVerified, SessionNoLongerValidError } = await import("@/lib/auth");
    const u = await mfaUser("Race Promote");
    const pending = await createSession(u.user.id, "Ringtools-app (wacht op passkey)");
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.user.id } });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => promoteSessionToMfaVerified(row.id, u.user.id, "Test")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof SessionNoLongerValidError)).toBe(true);
    expect(await prisma.session.count({ where: { userId: u.user.id } })).toBe(1);
    expect(pending.rawToken).toBeTruthy();
  });

  it("gelijktijdige herverificaties met één assertion: hooguit één rotatie, de oude sessie is daarna weg", async () => {
    const u = await mfaUser("Race Reauth");
    const token = (await createVerifiedSession(u.user.id, "Test")).rawToken;
    const opts = await call("POST", "/auth/reauth/passkey/options", { token });
    const assertion = u.key.assert({ challenge: opts.body.options.challenge, counter: 1 });
    const results = await Promise.all(Array.from({ length: 4 }, () => call("POST", "/auth/reauth/passkey/verify", { token, body: { response: assertion } })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.session.count({ where: { userId: u.user.id } })).toBe(1);
  });
});
