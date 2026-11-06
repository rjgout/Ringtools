import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createPairing, claimPairing, completePairing, registrationMessage, revokeTrustedDevice } from "@/lib/trustedDevices";
import { activationChallenge, confirmActivation, deviceChallengeMessage, loginChallenge, loginWithDevice, disableDeviceLogin, DEVICE_SESSION_MFA_AT, CHALLENGE_TTL_MS } from "@/lib/deviceLogin";
import { createSession, getActiveSession, isRecentlyMfaVerified } from "@/lib/auth";
import { resetDatabase, createTestUser } from "./setup";

// E2.4a: wachtwoordloos inloggen met een geactiveerd vertrouwd toestel, achter NATIVE_DEVICE_LOGIN_ENABLED (+ TRUSTED_DEVICES_ENABLED).
const { handleApi } = await import("@/lib/api/router");
const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});

let n = 0;
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, spki: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}
const sign = (k: crypto.KeyObject, m: string) => crypto.sign("sha256", Buffer.from(m), { key: k, dsaEncoding: "der" }).toString("base64");

async function mfaUser() {
  const u = await createTestUser("RINGSECRETARIS", `Inlog Lid ${++n}`, { email: `dl${n}@test.ringapeldoorn.nl` });
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true, activatedAt: new Date() } });
  return u;
}
async function registerDevice(userId: string, platform: "IOS" | "ANDROID" = "IOS") {
  const { code } = await createPairing(userId);
  const claim = await claimPairing(code);
  const kp = keyPair();
  const installationId = crypto.randomBytes(16).toString("hex");
  const { deviceId } = await completePairing({
    registrationToken: claim.registrationToken, publicKey: kp.spki, signature: sign(kp.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform, label: "Test-iPhone",
  });
  const device = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
  return { kp, installationId, deviceId, device };
}
async function activate(userId: string, d: Awaited<ReturnType<typeof registerDevice>>) {
  const c = await activationChallenge(userId, d.installationId);
  const msg = deviceChallengeMessage("ACTIVATE", { id: c.challengeId, challenge: c.challenge }, d.device);
  await confirmActivation(userId, d.installationId, c.challengeId, sign(d.kp.privateKey, msg));
}
async function loginParts(d: Awaited<ReturnType<typeof registerDevice>>) {
  const c = await loginChallenge(d.installationId);
  const msg = deviceChallengeMessage("LOGIN", { id: c.challengeId, challenge: c.challenge }, d.device);
  return { c, msg, sig: sign(d.kp.privateKey, msg) };
}
async function activeDevice() {
  const u = await mfaUser();
  const d = await registerDevice(u.id);
  await activate(u.id, d);
  return { u, d };
}

beforeEach(async () => {
  await resetDatabase();
  process.env.TRUSTED_DEVICES_ENABLED = "true";
  process.env.NATIVE_DEVICE_LOGIN_ENABLED = "true";
});

describe("Activeren als inlogmethode", () => {
  it("een geregistreerd toestel is GEEN inlogmethode totdat het expliciet is geactiveerd", async () => {
    const u = await mfaUser();
    const d = await registerDevice(u.id);
    await expect(loginChallenge(d.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("activeren vereist het bewijs van bezit van de sleutel (andere sleutel → geweigerd)", async () => {
    const u = await mfaUser();
    const d = await registerDevice(u.id);
    const c = await activationChallenge(u.id, d.installationId);
    const msg = deviceChallengeMessage("ACTIVATE", { id: c.challengeId, challenge: c.challenge }, d.device);
    await expect(confirmActivation(u.id, d.installationId, c.challengeId, sign(keyPair().privateKey, msg))).rejects.toMatchObject({ code: "invalid-proof" });
    expect((await prisma.trustedDevice.findUniqueOrThrow({ where: { id: d.deviceId } })).loginEnabledAt).toBeNull();
  });

  it("een inlogsignatuur kan niet als activering worden gebruikt (aparte contextlabels)", async () => {
    const u = await mfaUser();
    const d = await registerDevice(u.id);
    const c = await activationChallenge(u.id, d.installationId);
    const wrong = deviceChallengeMessage("LOGIN", { id: c.challengeId, challenge: c.challenge }, d.device);
    await expect(confirmActivation(u.id, d.installationId, c.challengeId, sign(d.kp.privateKey, wrong))).rejects.toMatchObject({ code: "invalid-proof" });
  });

  it("alleen de eigenaar activeert, alleen iOS, alleen niet-ingetrokken, niet voor een account zonder verplichte MFA", async () => {
    const a = await mfaUser();
    const b = await mfaUser();
    const d = await registerDevice(a.id);
    await expect(activationChallenge(b.id, d.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
    const android = await registerDevice(a.id, "ANDROID");
    await expect(activationChallenge(a.id, android.installationId)).rejects.toMatchObject({ code: "platform-not-supported" });
    await revokeTrustedDevice(a.id, d.deviceId, a.id);
    await expect(activationChallenge(a.id, d.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
  });

  it("API: activeren zonder recente MFA wordt geweigerd; een toestelsessie telt nooit als recente MFA", async () => {
    const { u, d } = await activeDevice();
    const { token } = await loginWithDevice({ installationId: d.installationId, ...(await (async () => { const p = await loginParts(d); return { challengeId: p.c.challengeId, signature: p.sig }; })()) });
    const res = await handleApi(
      new Request("http://localhost/api/mobile/v1/auth/device/activate/challenge", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ installationId: d.installationId }) }),
      ["auth", "device", "activate", "challenge"]
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("reauth-required");
    expect(isRecentlyMfaVerified(DEVICE_SESSION_MFA_AT)).toBe(false);
    expect(u.id).toBeTruthy();
  });
});

describe("Inloggen met een geactiveerd toestel", () => {
  it("geldige challenge + handtekening: volledige sessie, gebonden aan het toestel; geen e-mailcode/TOTP nodig", async () => {
    const { u, d } = await activeDevice();
    const p = await loginParts(d);
    const r = await loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig });
    expect(r.userId).toBe(u.id);
    const active = await getActiveSession(r.token);
    expect(active?.user.id).toBe(u.id);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.deviceId).toBe(d.deviceId);
    expect(await prisma.securityEvent.count({ where: { userId: u.id, type: "TRUSTED_DEVICE_LOGIN" } })).toBe(1);
  });

  it("replay: dezelfde challenge werkt maar één keer; gelijktijdige verificaties geven precies één sessie", async () => {
    const { d } = await activeDevice();
    const p = await loginParts(d);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig })));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await prisma.session.count()).toBe(1);
    await expect(loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig })).rejects.toMatchObject({ code: "invalid-challenge" });
  });

  it("ongeldige handtekening: geen sessie; na drie foute pogingen is de challenge dood, ook voor een goede handtekening", async () => {
    const { d } = await activeDevice();
    const p = await loginParts(d);
    const bad = sign(keyPair().privateKey, p.msg);
    for (let i = 0; i < 3; i++) await expect(loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: bad })).rejects.toMatchObject({ code: "invalid-proof" });
    await expect(loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig })).rejects.toMatchObject({ code: "invalid-challenge" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("gelijktijdige foute pogingen tellen begrensd (nooit voorbij de limiet)", async () => {
    const { d } = await activeDevice();
    const p = await loginParts(d);
    const bad = sign(keyPair().privateKey, p.msg);
    await Promise.all(Array.from({ length: 8 }, () => loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: bad }).catch(() => null)));
    expect((await prisma.deviceLoginChallenge.findUniqueOrThrow({ where: { id: p.c.challengeId } })).failedAttempts).toBe(3);
  });

  it("verlopen challenge wordt geweigerd", async () => {
    const { d } = await activeDevice();
    const p = await loginParts(d);
    await prisma.deviceLoginChallenge.update({ where: { id: p.c.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig })).rejects.toMatchObject({ code: "invalid-challenge" });
    expect(CHALLENGE_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("challenge voor een ander toestel/account is onbruikbaar (gebonden aan toestel en account)", async () => {
    const x = await activeDevice();
    const y = await activeDevice();
    const px = await loginParts(x.d);
    // y probeert de challenge van x te gebruiken, ondertekend met de eigen sleutel
    const msgForY = deviceChallengeMessage("LOGIN", { id: px.c.challengeId, challenge: px.c.challenge }, y.d.device);
    await expect(loginWithDevice({ installationId: y.d.installationId, challengeId: px.c.challengeId, signature: sign(y.d.kp.privateKey, msgForY) })).rejects.toMatchObject({ code: "invalid-challenge" });
    // x' challenge met het bericht van x maar de sleutel van y
    await expect(loginWithDevice({ installationId: x.d.installationId, challengeId: px.c.challengeId, signature: sign(y.d.kp.privateKey, px.msg) })).rejects.toMatchObject({ code: "invalid-proof" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("onbekend, ingetrokken of niet-geactiveerd toestel: geen challenge, geen sessie", async () => {
    await expect(loginChallenge("a".repeat(32))).rejects.toMatchObject({ code: "device-login-unavailable" });
    await expect(loginChallenge("kort")).rejects.toMatchObject({ code: "device-login-unavailable" });
    const { u, d } = await activeDevice();
    await revokeTrustedDevice(u.id, d.deviceId, u.id);
    await expect(loginChallenge(d.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
  });

  it("gedeactiveerd account kan niet inloggen, ook niet met een al uitgegeven challenge", async () => {
    const { u, d } = await activeDevice();
    const p = await loginParts(d);
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    await expect(loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig })).rejects.toMatchObject({ code: "device-login-unavailable" });
    expect(await prisma.session.count()).toBe(0);
  });

  it("intrekken tussen challenge en verificatie wint (gelijktijdig): geen sessie", async () => {
    const { u, d } = await activeDevice();
    const p = await loginParts(d);
    const [, login] = await Promise.allSettled([revokeTrustedDevice(u.id, d.deviceId, u.id), loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig })]);
    // na afloop: geen enkele sessie voor dit toestel mag bestaan
    expect(await prisma.session.count({ where: { deviceId: d.deviceId } })).toBe(0);
    expect(login).toBeDefined();
  });

  it("toestel intrekken beëindigt direct de via dat toestel verkregen sessies; andere sessies blijven", async () => {
    const { u, d } = await activeDevice();
    const p = await loginParts(d);
    const r = await loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig });
    await prisma.session.create({ data: { userId: u.id, tokenHash: "andere-sessie-hash", expiresAt: new Date(Date.now() + 1e7), mfaAt: new Date() } });
    expect(await getActiveSession(r.token)).not.toBeNull();
    await revokeTrustedDevice(u.id, d.deviceId, u.id);
    expect(await getActiveSession(r.token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(1);
  });

  it("uitzetten van wachtwoordloos inloggen: toestel blijft gekoppeld, sessies weg, inloggen niet meer mogelijk", async () => {
    const { u, d } = await activeDevice();
    const p = await loginParts(d);
    await loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig });
    expect(await disableDeviceLogin(u.id, d.deviceId, u.id)).toBe(true);
    expect(await prisma.session.count({ where: { deviceId: d.deviceId } })).toBe(0);
    expect((await prisma.trustedDevice.findUniqueOrThrow({ where: { id: d.deviceId } })).revokedAt).toBeNull();
    await expect(loginChallenge(d.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
  });

  it("persistente begrenzing: te veel challenges per toestel in het venster", async () => {
    const { d } = await activeDevice();
    for (let i = 0; i < 9; i++) await loginChallenge(d.installationId); // plus de activeringschallenge = 10 in het venster
    await expect(loginChallenge(d.installationId)).rejects.toMatchObject({ code: "rate-limited" });
  });

  it("de gebruiker is niet te wisselen: sessie hoort bij de eigenaar van het toestel, ook als een andere gebruiker bestaat", async () => {
    const x = await activeDevice();
    const other = await mfaUser();
    const p = await loginParts(x.d);
    const r = await loginWithDevice({ installationId: x.d.installationId, challengeId: p.c.challengeId, signature: p.sig });
    expect(r.userId).toBe(x.u.id);
    expect(r.userId).not.toBe(other.id);
  });
});

describe("Vlag en API", () => {
  let ip = 0;
  async function call(path: string, body: unknown, token?: string) {
    const res = await handleApi(
      new Request(`http://localhost/api/mobile/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `10.7.0.${++ip}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }),
      path.split("/").filter(Boolean)
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it("vlag uit: geen challenge, geen login, geen activering; /meta meldt het; toestelregistratie (E2.3) blijft werken", async () => {
    const { d } = await activeDevice();
    process.env.NATIVE_DEVICE_LOGIN_ENABLED = "false";
    expect((await call("/auth/device/challenge", { installationId: d.installationId })).status).toBe(404);
    expect((await call("/auth/device/login", { installationId: d.installationId, challengeId: "x", signature: "y" })).status).toBe(404);
    const meta = await handleApi(new Request("http://localhost/api/mobile/v1/meta"), ["meta"]);
    expect((await meta.json()).deviceLogin).toBe(false);
    const u2 = await mfaUser();
    await expect(registerDevice(u2.id)).resolves.toBeTruthy();
  });

  it("vlag aan zonder TRUSTED_DEVICES_ENABLED blijft uit", async () => {
    process.env.TRUSTED_DEVICES_ENABLED = "false";
    expect((await call("/auth/device/challenge", { installationId: "a".repeat(32) })).status).toBe(404);
  });

  it("volledige API-keten: challenge → login → sessie werkt op /me; e-mailcode-login blijft onaangetast", async () => {
    const { d } = await activeDevice();
    const c = await call("/auth/device/challenge", { installationId: d.installationId });
    expect(c.status).toBe(200);
    const msg = deviceChallengeMessage("LOGIN", { id: c.body.challengeId, challenge: c.body.challenge }, d.device);
    const l = await call("/auth/device/login", { installationId: d.installationId, challengeId: c.body.challengeId, signature: sign(d.kp.privateKey, msg) });
    expect(l.status).toBe(200);
    expect(l.body.token).toBeTruthy();
    expect(l.body.user).toBeTruthy();
    const me = await handleApi(new Request("http://localhost/api/mobile/v1/me", { headers: { Authorization: `Bearer ${l.body.token}` } }), ["me"]);
    expect(me.status).toBe(200);
  });

  it("webmin-MFA-reset-toestand: ingetrokken toestel + verwijderde sessies maken inloggen onmogelijk (zoals de reset ze achterlaat)", async () => {
    const { u, d } = await activeDevice();
    const p = await loginParts(d);
    const r = await loginWithDevice({ installationId: d.installationId, challengeId: p.c.challengeId, signature: p.sig });
    // zelfde bewerkingen als resetUserMfaAction
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: u.id } });
      await tx.trustedDevice.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    expect(await getActiveSession(r.token)).toBeNull();
    await expect(loginChallenge(d.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
    expect(await createSession).toBeTypeOf("function");
  });
});
