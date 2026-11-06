import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createPairing, claimPairing, completePairing, registrationMessage, revokeTrustedDevice } from "@/lib/trustedDevices";
import { activationChallenge, confirmActivation, deviceChallengeMessage, loginChallenge, loginWithDevice, disableDeviceLogin } from "@/lib/deviceLogin";
import { getActiveSession, promoteSessionToMfaVerified, rotateSessionIfDue, SessionNoLongerValidError } from "@/lib/auth";
import { lockHooks } from "@/lib/deviceLocks";
import { resetDatabase, createTestUser } from "./setup";

// E2.4a: deterministische concurrentietests (beide uitvoeringsvolgorden) voor toestelbinding, herverificatie, intrekken, uitzetten en reset.
// Een hook houdt een bewerking vast NADAT zij gebruiker en toestel heeft vergrendeld; de tegenpartij moet dan aantoonbaar wachten.
const saved = { ...process.env };
let n = 0;
const sign = (k: crypto.KeyObject, m: string) => crypto.sign("sha256", Buffer.from(m), { key: k, dsaEncoding: "der" }).toString("base64");

async function setup() {
  const u = await createTestUser("RINGSECRETARIS", `Race Lid ${++n}`, { email: `race${n}@test.ringapeldoorn.nl` });
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true, activatedAt: new Date() } });
  const { code } = await createPairing(u.id);
  const claim = await claimPairing(code);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const installationId = crypto.randomBytes(16).toString("hex");
  const { deviceId } = await completePairing({
    registrationToken: claim.registrationToken, publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    signature: sign(privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "IOS", label: "iPhone",
  });
  const device = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
  const a = await activationChallenge(u.id, installationId);
  await confirmActivation(u.id, installationId, a.challengeId, sign(privateKey, deviceChallengeMessage("ACTIVATE", { id: a.challengeId, challenge: a.challenge }, device)));
  const login = async () => {
    const c = await loginChallenge(installationId);
    return loginWithDevice({ installationId, challengeId: c.challengeId, signature: sign(privateKey, deviceChallengeMessage("LOGIN", { id: c.challengeId, challenge: c.challenge }, device)) });
  };
  return { u, deviceId, installationId, login };
}

function gate() {
  let release!: () => void;
  let reached!: () => void;
  const reachedP = new Promise<void>((r) => (reached = r));
  const wait = new Promise<void>((r) => (release = r));
  return { hook: async () => { reached(); await wait; }, reached: reachedP, release };
}
/** Is de belofte na een korte tijd nog onbeslist? (de tegenpartij hoort te wachten op de rijvergrendeling) */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  return (await Promise.race([p.then(() => "done", () => "done"), new Promise((r) => setTimeout(() => r(marker), 400))])) === marker;
}
const sessionsFor = (deviceId: string) => prisma.session.count({ where: { deviceId } });

beforeEach(async () => {
  await resetDatabase();
  process.env.TRUSTED_DEVICES_ENABLED = "true";
  process.env.NATIVE_DEVICE_LOGIN_ENABLED = "true";
});
afterEach(() => {
  for (const k of Object.keys(lockHooks)) delete lockHooks[k as keyof typeof lockHooks];
  process.env = { ...saved };
});

describe("A. toestelbinding blijft behouden", () => {
  it("toestelinlog → TOTP-herverificatie → toestel intrekken: sessie weg", async () => {
    const { u, deviceId, login } = await setup();
    const first = await login();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    const promoted = await promoteSessionToMfaVerified(row.id, u.id, "test");
    const after = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(after.deviceId).toBe(deviceId); // binding blijft na vervanging van de sessie
    expect(after.id).not.toBe(row.id);
    expect(await getActiveSession(first.token)).toBeNull(); // oud token is weg
    expect(await getActiveSession(promoted.rawToken)).not.toBeNull();
    await revokeTrustedDevice(u.id, deviceId, u.id);
    expect(await getActiveSession(promoted.rawToken)).toBeNull();
    expect(await sessionsFor(deviceId)).toBe(0);
  });

  it("toestelinlog → herverificatie → sessierotatie → toestel intrekken: sessie weg", async () => {
    const { u, deviceId, login } = await setup();
    await login();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    const promoted = await promoteSessionToMfaVerified(row.id, u.id, "test");
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { rotatedAt: old, createdAt: old } });
    const rot = await rotateSessionIfDue(promoted.rawToken);
    expect(rot.status === "ok" && rot.rotated).toBe(true);
    const token = rot.status === "ok" && rot.rotated ? rot.rawToken : "";
    expect((await prisma.session.findFirstOrThrow({ where: { userId: u.id } })).deviceId).toBe(deviceId);
    expect(await getActiveSession(token)).not.toBeNull();
    await revokeTrustedDevice(u.id, deviceId, u.id);
    expect(await getActiveSession(token)).toBeNull();
    expect(await sessionsFor(deviceId)).toBe(0);
  });

  it("toestelinlog → herverificatie → wachtwoordloos inloggen uitzetten: sessie weg, toestel blijft gekoppeld", async () => {
    const { u, deviceId, login } = await setup();
    await login();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    await promoteSessionToMfaVerified(row.id, u.id, "test");
    expect(await disableDeviceLogin(u.id, deviceId, u.id)).toBe(true);
    expect(await sessionsFor(deviceId)).toBe(0);
    expect((await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt).toBeNull();
  });

  it("toestelinlog → webmin-MFA-reset: alle sessies weg en toestel ingetrokken (zelfde bewerkingen als resetUserMfaAction)", async () => {
    const { u, deviceId, login, installationId } = await setup();
    const r = await login();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "mfaEnabled" FROM "User" WHERE "id" = ${u.id} FOR UPDATE`;
      await tx.session.deleteMany({ where: { userId: u.id } });
      await tx.trustedDevice.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    expect(await getActiveSession(r.token)).toBeNull();
    await expect(loginChallenge(installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
    expect(await sessionsFor(deviceId)).toBe(0);
  });
});

describe("B. intrekken/uitzetten/herverifiëren versus gelijktijdig inloggen – beide volgorden", () => {
  it("inlog is eerst (houdt de vergrendeling), intrekking start tijdens de inlog: intrekking wacht en verwijdert daarna de nieuwe sessie", async () => {
    const { u, deviceId, login } = await setup();
    const g = gate();
    lockHooks.loginAfterLock = g.hook;
    const loginP = login();
    await g.reached;
    const revokeP = revokeTrustedDevice(u.id, deviceId, u.id);
    expect(await stillPending(revokeP)).toBe(true);
    g.release();
    const [loginRes, revoked] = await Promise.all([loginP, revokeP]);
    expect(revoked).toBe(true);
    expect(await sessionsFor(deviceId)).toBe(0);
    expect(await getActiveSession(loginRes.token)).toBeNull();
  });

  it("intrekking is eerst (houdt de vergrendeling), inlog start tijdens de intrekking: inlog wacht en mislukt daarna", async () => {
    const { u, deviceId, login } = await setup();
    const c = login; // challenge + handtekening worden pas bij het aanroepen gemaakt
    const g = gate();
    lockHooks.revokeAfterLock = g.hook;
    const revokeP = revokeTrustedDevice(u.id, deviceId, u.id);
    await g.reached;
    const loginP = c();
    expect(await stillPending(loginP.catch(() => null))).toBe(true);
    g.release();
    expect(await revokeP).toBe(true);
    await expect(loginP).rejects.toMatchObject({ code: "device-login-unavailable" });
    expect(await sessionsFor(deviceId)).toBe(0);
  });

  it("uitzetten: inlog eerst → uitzetten wacht en verwijdert de sessie", async () => {
    const { u, deviceId, login } = await setup();
    const g = gate();
    lockHooks.loginAfterLock = g.hook;
    const loginP = login();
    await g.reached;
    const disableP = disableDeviceLogin(u.id, deviceId, u.id);
    expect(await stillPending(disableP)).toBe(true);
    g.release();
    const [res, disabled] = await Promise.all([loginP, disableP]);
    expect(disabled).toBe(true);
    expect(await sessionsFor(deviceId)).toBe(0);
    expect(await getActiveSession(res.token)).toBeNull();
  });

  it("uitzetten: uitzetten eerst → inlog wacht en mislukt", async () => {
    const { u, deviceId, login } = await setup();
    const g = gate();
    lockHooks.disableAfterLock = g.hook;
    const disableP = disableDeviceLogin(u.id, deviceId, u.id);
    await g.reached;
    const loginP = login();
    expect(await stillPending(loginP.catch(() => null))).toBe(true);
    g.release();
    expect(await disableP).toBe(true);
    await expect(loginP).rejects.toMatchObject({ code: "device-login-unavailable" });
    expect(await sessionsFor(deviceId)).toBe(0);
  });

  it("herverificatie eerst → intrekking wacht en verwijdert de vervangende sessie", async () => {
    const { u, deviceId, login } = await setup();
    await login();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    const g = gate();
    lockHooks.promoteAfterLock = g.hook;
    const promoteP = promoteSessionToMfaVerified(row.id, u.id, "test");
    await g.reached;
    const revokeP = revokeTrustedDevice(u.id, deviceId, u.id);
    expect(await stillPending(revokeP)).toBe(true);
    g.release();
    const [promoted, revoked] = await Promise.all([promoteP, revokeP]);
    expect(revoked).toBe(true);
    expect(await getActiveSession(promoted.rawToken)).toBeNull();
    expect(await sessionsFor(deviceId)).toBe(0);
  });

  it("intrekking eerst → herverificatie wacht en mislukt; er blijft geen sessie over", async () => {
    const { u, deviceId, login } = await setup();
    await login();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    const g = gate();
    lockHooks.revokeAfterLock = g.hook;
    const revokeP = revokeTrustedDevice(u.id, deviceId, u.id);
    await g.reached;
    const promoteP = promoteSessionToMfaVerified(row.id, u.id, "test");
    expect(await stillPending(promoteP.catch(() => null))).toBe(true);
    g.release();
    expect(await revokeP).toBe(true);
    await expect(promoteP).rejects.toBeInstanceOf(SessionNoLongerValidError);
    expect(await sessionsFor(deviceId)).toBe(0);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  });

  it("webmin-reset eerst (houdt de gebruikersvergrendeling) → inlog wacht en mislukt; inlog eerst → reset verwijdert alles", async () => {
    const { u, deviceId, login } = await setup();
    // reset eerst
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const resetP = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "mfaEnabled" FROM "User" WHERE "id" = ${u.id} FOR UPDATE`;
      locked();
      await hold;
      await tx.session.deleteMany({ where: { userId: u.id } });
      await tx.trustedDevice.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await lockedP;
    const loginP = login();
    expect(await stillPending(loginP.catch(() => null))).toBe(true);
    release();
    await resetP;
    await expect(loginP).rejects.toMatchObject({ code: "device-login-unavailable" });
    expect(await sessionsFor(deviceId)).toBe(0);
  });

  it("webmin-reset na een inlog die de vergrendeling houdt: de reset wacht en verwijdert de nieuwe sessie", async () => {
    const { u, deviceId, login } = await setup();
    const g = gate();
    lockHooks.loginAfterLock = g.hook;
    const loginP = login();
    await g.reached;
    const resetP = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "mfaEnabled" FROM "User" WHERE "id" = ${u.id} FOR UPDATE`;
      await tx.session.deleteMany({ where: { userId: u.id } });
      await tx.trustedDevice.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    expect(await stillPending(resetP)).toBe(true);
    g.release();
    const res = await loginP;
    await resetP;
    expect(await getActiveSession(res.token)).toBeNull();
    expect(await sessionsFor(deviceId)).toBe(0);
  });
});
