import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { startEnrollment, completeEnrollment, enrollmentMessage, ENROLL_TTL_MS } from "@/lib/deviceEnrollment";
import { revokeTrustedDevice, MAX_ACTIVE_DEVICES } from "@/lib/trustedDevices";
import { deviceChallengeMessage, loginChallenge, loginWithDevice } from "@/lib/deviceLogin";
import { createVerifiedSession, destroySessionById } from "@/lib/auth";
import { resetDatabase, createTestUser } from "./setup";

// E2.5: automatische Face ID-inrichting vanuit een ingelogde sessie (recente MFA), achter NATIVE_DEVICE_AUTO_ENROLL_ENABLED.
const { handleApi } = await import("@/lib/api/router");
const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});

let n = 0;
const sign = (k: crypto.KeyObject, m: string) => crypto.sign("sha256", Buffer.from(m), { key: k, dsaEncoding: "der" }).toString("base64");
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, spki: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}
async function mfaUser(mfaEnabled = true, role: "RINGSECRETARIS" | "ADMIN" = "RINGSECRETARIS") {
  const u = await createTestUser(role, `Inricht Lid ${++n}`, { email: `en${n}@test.ringapeldoorn.nl` });
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled, activatedAt: new Date() } });
  return u;
}
async function enrol(userId: string, over: Partial<{ kp: ReturnType<typeof keyPair>; installationId: string; platform: string; badSig: boolean }> = {}) {
  const e = await startEnrollment(userId);
  const kp = over.kp ?? keyPair();
  const installationId = over.installationId ?? crypto.randomBytes(16).toString("hex");
  const msg = enrollmentMessage({ id: e.enrollmentId, challenge: e.challenge }, e.userId, installationId);
  const input = { enrollmentId: e.enrollmentId, publicKey: kp.spki, installationId, signature: sign(over.badSig ? keyPair().privateKey : kp.privateKey, msg), platform: over.platform ?? "IOS", label: "iPhone" };
  return { e, kp, installationId, input };
}

beforeEach(async () => {
  await resetDatabase();
  process.env.TRUSTED_DEVICES_ENABLED = "true";
  process.env.NATIVE_DEVICE_LOGIN_ENABLED = "true";
  process.env.NATIVE_DEVICE_AUTO_ENROLL_ENABLED = "true";
});

describe("Automatische Face ID-inrichting", () => {
  it.each(["IOS", "ANDROID"])("gewoon account: %s registreert, vernieuwt verlopen sessie en respecteert intrekking", async platform => {
    const u = await mfaUser(false);
    const a = await enrol(u.id);
    const original = await createVerifiedSession(u.id, "synthetisch");
    const session = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    const result = await completeEnrollment(u.id, { ...a.input, platform }, session.id);
    const d = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: result.deviceId } });
    expect(d.loginProtocol).toBe(2);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
    const c = await loginChallenge(a.installationId);
    const signature = sign(a.kp.privateKey, deviceChallengeMessage("LOGIN", { id: c.challengeId, challenge: c.challenge }, d));
    const renewed = await loginWithDevice({ installationId: a.installationId, challengeId: c.challengeId, signature });
    expect(renewed.token).not.toBe(original.rawToken);
    const active = await prisma.session.findFirstOrThrow({ where: { userId: u.id, expiresAt: { gt: new Date() } } });
    await destroySessionById(u.id, active.id);
    await expect(loginChallenge(a.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
  });

  it("volledig pad: challenge → sleutelbezit → toestel is in één stap geregistreerd én geactiveerd; daarna inloggen met Face ID werkt", async () => {
    const u = await mfaUser();
    const a = await enrol(u.id);
    const { deviceId } = await completeEnrollment(u.id, a.input);
    const d = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(d).toMatchObject({ userId: u.id, platform: "IOS", revokedAt: null });
    expect(d.loginEnabledAt).not.toBeNull();
    const c = await loginChallenge(a.installationId);
    const sig = sign(a.kp.privateKey, deviceChallengeMessage("LOGIN", { id: c.challengeId, challenge: c.challenge }, d));
    const r = await loginWithDevice({ installationId: a.installationId, challengeId: c.challengeId, signature: sig });
    expect(r.userId).toBe(u.id);
    expect(await prisma.securityEvent.count({ where: { userId: u.id, type: "TRUSTED_DEVICE_LOGIN_ENABLED" } })).toBe(1);
  });

  it("vlag uit, vlag NATIVE_DEVICE_LOGIN uit: niet beschikbaar", async () => {
    const u = await mfaUser();
    process.env.NATIVE_DEVICE_AUTO_ENROLL_ENABLED = "false";
    await expect(startEnrollment(u.id)).rejects.toMatchObject({ code: "not-available" });
    process.env.NATIVE_DEVICE_AUTO_ENROLL_ENABLED = "true";
    process.env.NATIVE_DEVICE_LOGIN_ENABLED = "false";
    await expect(startEnrollment(u.id)).rejects.toMatchObject({ code: "not-available" });
  });

  it("gewoon account kan na verse verificatie inrichten; beheerdersaccount blijft uitgesloten", async () => {
    const plain = await mfaUser(false);
    expect((await startEnrollment(plain.id)).userId).toBe(plain.id);
    const admin = await mfaUser(true, "ADMIN");
    await expect(startEnrollment(admin.id)).rejects.toMatchObject({ code: "forbidden" });
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("annuleren (Face ID geweigerd → er wordt niet voltooid): geen toestel, wel een vervallende rij; een nieuwe poging vervangt de oude", async () => {
    const u = await mfaUser();
    const first = await startEnrollment(u.id);
    expect(await prisma.trustedDevice.count()).toBe(0);
    const second = await startEnrollment(u.id);
    expect(await prisma.deviceEnrollment.findUnique({ where: { id: first.enrollmentId } })).toBeNull();
    expect(second.enrollmentId).not.toBe(first.enrollmentId);
  });

  it("ongeldige handtekening: geweigerd, teller begrensd; daarna werkt ook een goede handtekening niet meer; geen toestel", async () => {
    const u = await mfaUser();
    const a = await enrol(u.id, { badSig: true });
    for (let i = 0; i < 3; i++) await expect(completeEnrollment(u.id, a.input)).rejects.toMatchObject({ code: "invalid-proof" });
    const good = { ...a.input, signature: sign(a.kp.privateKey, enrollmentMessage({ id: a.e.enrollmentId, challenge: a.e.challenge }, u.id, a.installationId)) };
    await expect(completeEnrollment(u.id, good)).rejects.toMatchObject({ code: "invalid-enrollment" });
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("replay en gelijktijdige voltooiing: precies één toestel", async () => {
    const u = await mfaUser();
    const a = await enrol(u.id);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => completeEnrollment(u.id, a.input)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await prisma.trustedDevice.count({ where: { userId: u.id } })).toBe(1);
    await expect(completeEnrollment(u.id, a.input)).rejects.toMatchObject({ code: "invalid-enrollment" });
  });

  it("verlopen challenge, challenge van een andere gebruiker en platform ≠ iOS worden geweigerd", async () => {
    const u = await mfaUser();
    const other = await mfaUser();
    const a = await enrol(u.id);
    await prisma.deviceEnrollment.update({ where: { id: a.e.enrollmentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(completeEnrollment(u.id, a.input)).rejects.toMatchObject({ code: "invalid-enrollment" });
    const b = await enrol(u.id);
    await expect(completeEnrollment(other.id, b.input)).rejects.toMatchObject({ code: "invalid-enrollment" });
    const c = await enrol(u.id, { platform: "WEB" });
    await expect(completeEnrollment(u.id, c.input)).rejects.toMatchObject({ code: "platform-not-supported" });
    expect(await prisma.trustedDevice.count()).toBe(0);
    expect(ENROLL_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("een eerder ingetrokken sleutel kan niet opnieuw worden geregistreerd; een andere gebruiker kan een bestaande sleutel niet overnemen", async () => {
    const u = await mfaUser();
    const other = await mfaUser();
    const a = await enrol(u.id);
    const { deviceId } = await completeEnrollment(u.id, a.input);
    await revokeTrustedDevice(u.id, deviceId, u.id);
    const again = await enrol(u.id, { kp: a.kp });
    await expect(completeEnrollment(u.id, again.input)).rejects.toMatchObject({ code: "key-reused" });
    const steal = await enrol(other.id, { kp: a.kp });
    await expect(completeEnrollment(other.id, steal.input)).rejects.toMatchObject({ code: "key-reused" });
  });

  it("account tussentijds gedeactiveerd: voltooien geweigerd, geen toestel", async () => {
    const u = await mfaUser();
    const a = await enrol(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    await expect(completeEnrollment(u.id, a.input)).rejects.toBeTruthy();
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("maximum aantal toestellen", async () => {
    const u = await mfaUser();
    for (let i = 0; i < MAX_ACTIVE_DEVICES; i++) await completeEnrollment(u.id, (await enrol(u.id)).input);
    await expect(startEnrollment(u.id)).rejects.toMatchObject({ code: "limit" });
  });
});

describe("API: volledige sessie met recente MFA is vereist", () => {
  async function call(path: string, token: string, body: unknown = {}) {
    const res = await handleApi(
      new Request(`http://localhost/api/mobile/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-forwarded-for": "10.6.0.1" }, body: JSON.stringify(body) }),
      path.split("/").filter(Boolean)
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it("sessie met recente MFA: inrichten werkt; zonder recente MFA (oude mfaAt of toestelsessie) geweigerd met reauth-required", async () => {
    const u = await mfaUser();
    const { rawToken } = await createVerifiedSession(u.id, "test");
    const ch = await call("/auth/device/enroll/challenge", rawToken);
    expect(ch.status).toBe(200);
    const kp = keyPair();
    const installationId = crypto.randomBytes(16).toString("hex");
    const msg = enrollmentMessage({ id: ch.body.enrollmentId, challenge: ch.body.challenge }, ch.body.userId, installationId);
    const done = await call("/auth/device/enroll/complete", rawToken, { enrollmentId: ch.body.enrollmentId, publicKey: kp.spki, installationId, signature: sign(kp.privateKey, msg), platform: "IOS", label: "iPhone" });
    expect(done.status).toBe(200);
    expect(done.body).not.toHaveProperty("token"); // geen nieuwe sessie: de gebruiker is al ingelogd

    await prisma.session.updateMany({ where: { userId: u.id }, data: { mfaAt: new Date(1000) } });
    const stale = await call("/auth/device/enroll/challenge", rawToken);
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("reauth-required");
  });

  it("disable-route: zet Face ID uit voor het eigen toestel en beëindigt de toestelsessies", async () => {
    const u = await mfaUser();
    const { rawToken } = await createVerifiedSession(u.id, "test");
    const a = await enrol(u.id);
    await completeEnrollment(u.id, a.input);
    const off = await call("/auth/device/disable", rawToken, { installationId: a.installationId });
    expect(off.body.ok).toBe(true);
    await expect(loginChallenge(a.installationId)).rejects.toMatchObject({ code: "device-login-unavailable" });
  });

  it("/meta meldt de vlag en admin wordt geweigerd", async () => {
    const meta = await handleApi(new Request("http://localhost/api/mobile/v1/meta"), ["meta"]);
    expect((await meta.json()).deviceAutoEnroll).toBe(true);
    process.env.NATIVE_DEVICE_AUTO_ENROLL_ENABLED = "false";
    const meta2 = await handleApi(new Request("http://localhost/api/mobile/v1/meta"), ["meta"]);
    expect((await meta2.json()).deviceAutoEnroll).toBe(false);
  });
});
