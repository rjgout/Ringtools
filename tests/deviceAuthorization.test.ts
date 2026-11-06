import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { startEnrollment, completeEnrollment, enrollmentMessage } from "@/lib/deviceEnrollment";
import { createVerifiedSession } from "@/lib/auth";
import { generateRawToken, hashToken } from "@/lib/crypto";
import { resetDatabase, createTestUser } from "./setup";

// E2.6 fase A3: server-side autorisatie van de toestelroutes, ongeacht wat de interface toont.
const { handleApi } = await import("@/lib/api/router");
const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});

let n = 0;
const sign = (k: crypto.KeyObject, m: string) => crypto.sign("sha256", Buffer.from(m), { key: k, dsaEncoding: "der" }).toString("base64");
async function user(over: { mfa?: boolean; active?: boolean; role?: "RINGSECRETARIS" | "ADMIN" } = {}) {
  const u = await createTestUser(over.role ?? "RINGSECRETARIS", `Autor Lid ${++n}`, { email: `au${n}@test.ringapeldoorn.nl` });
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: over.mfa ?? true, activatedAt: new Date(), active: over.active ?? true } });
  return u;
}
async function call(path: string, token: string, body: unknown = {}) {
  const res = await handleApi(
    new Request(`http://localhost/api/mobile/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-forwarded-for": `10.7.0.${n}` }, body: JSON.stringify(body) }),
    path.split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function enrolViaApi(token: string, userId: string) {
  const ch = await call("/auth/device/enroll/challenge", token);
  if (ch.status !== 200) return { ch };
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const installationId = crypto.randomBytes(16).toString("hex");
  const body = {
    enrollmentId: ch.body.enrollmentId, installationId, platform: "IOS", label: "iPhone",
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    signature: sign(privateKey, enrollmentMessage({ id: ch.body.enrollmentId, challenge: ch.body.challenge }, userId, installationId)),
  };
  return { ch, body, installationId };
}
async function pendingToken(userId: string) {
  const raw = generateRawToken();
  await prisma.session.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 3600_000), mfaAt: null } });
  return raw;
}

beforeEach(async () => {
  await resetDatabase();
  process.env.TRUSTED_DEVICES_ENABLED = "true";
  process.env.NATIVE_DEVICE_LOGIN_ENABLED = "true";
  process.env.NATIVE_DEVICE_AUTO_ENROLL_ENABLED = "true";
});

describe("Toestelroutes: autorisatie op de server", () => {
  it("een ander account kan het toestel van een gebruiker niet uitzetten (installationId alleen is geen recht)", async () => {
    const a = await user();
    const b = await user();
    const ta = (await createVerifiedSession(a.id)).rawToken;
    const tb = (await createVerifiedSession(b.id)).rawToken;
    const e = await enrolViaApi(ta, a.id);
    expect((await call("/auth/device/enroll/complete", ta, e.body)).status).toBe(200);
    const res = await call("/auth/device/disable", tb, { installationId: e.installationId });
    expect(res.body.ok).toBe(false);
    expect((await prisma.trustedDevice.findFirstOrThrow({ where: { userId: a.id } })).loginEnabledAt).not.toBeNull();
  });

  it("een ander account kan een openstaande inrichting van een gebruiker niet voltooien", async () => {
    const a = await user();
    const b = await user();
    const ta = (await createVerifiedSession(a.id)).rawToken;
    const tb = (await createVerifiedSession(b.id)).rawToken;
    const e = await enrolViaApi(ta, a.id);
    const stolen = await call("/auth/device/enroll/complete", tb, e.body);
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("ingetrokken sessie halverwege: voltooien geeft 401 en laat geen toestel achter", async () => {
    const a = await user();
    const ta = (await createVerifiedSession(a.id)).rawToken;
    const e = await enrolViaApi(ta, a.id);
    await prisma.session.deleteMany({ where: { userId: a.id } });
    expect((await call("/auth/device/enroll/complete", ta, e.body)).status).toBe(401);
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("gedeactiveerd account halverwege: voltooien wordt geweigerd en laat geen toestel achter", async () => {
    const a = await user();
    const ta = (await createVerifiedSession(a.id)).rawToken;
    const e = await enrolViaApi(ta, a.id);
    await prisma.user.update({ where: { id: a.id }, data: { active: false } });
    const res = await call("/auth/device/enroll/complete", ta, e.body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("pending-login (nog geen tweede factor) kan niet inrichten, uitzetten of status opvragen", async () => {
    const a = await user();
    const tp = await pendingToken(a.id);
    for (const p of ["/auth/device/enroll/challenge", "/auth/device/enroll/complete", "/auth/device/disable"]) {
      const r = await call(p, tp, {});
      expect([401, 403]).toContain(r.status);
    }
    expect(await prisma.deviceEnrollment.count()).toBe(0);
  });

  it("webmin kan niet via de gebruikersroute inrichten", async () => {
    const admin = await user({ role: "ADMIN" });
    const ta = (await createVerifiedSession(admin.id)).rawToken;
    const r = await call("/auth/device/enroll/challenge", ta);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.deviceEnrollment.count()).toBe(0);
  });

  it("toestelsessie (mfaAt = epoch) telt niet als recente MFA voor inrichten of uitzetten", async () => {
    const a = await user();
    const raw = generateRawToken();
    await prisma.session.create({ data: { userId: a.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 3600_000), mfaAt: new Date(1000) } });
    for (const p of ["/auth/device/enroll/challenge", "/auth/device/disable"]) {
      const r = await call(p, raw, { installationId: "x" });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("reauth-required");
    }
  });

  it("ingetrokken toestel kan niet opnieuw worden ingericht met dezelfde sleutel of installatie", async () => {
    const a = await user();
    const ta = (await createVerifiedSession(a.id)).rawToken;
    const e = await enrolViaApi(ta, a.id);
    expect((await call("/auth/device/enroll/complete", ta, e.body)).status).toBe(200);
    await prisma.trustedDevice.updateMany({ where: { userId: a.id }, data: { revokedAt: new Date(), loginEnabledAt: null } });
    const again = await startEnrollment(a.id);
    const msg = enrollmentMessage({ id: again.enrollmentId, challenge: again.challenge }, a.id, e.installationId!);
    await expect(completeEnrollment(a.id, { ...e.body!, enrollmentId: again.enrollmentId, signature: sign(crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey, msg) })).rejects.toBeTruthy();
    expect(await prisma.trustedDevice.count({ where: { userId: a.id, revokedAt: null } })).toBe(0);
  });
});

describe("Besluit eigenaar: weesapparaat na een verloren serverantwoord", () => {
  it("blijft zichtbaar en intrekbaar, biedt zonder sleutel geen toegang en laat de gebruiker de inrichting opnieuw proberen", async () => {
    const { listTrustedDevices, revokeTrustedDevice } = await import("@/lib/trustedDevices");
    const { loginChallenge, loginWithDevice } = await import("@/lib/deviceLogin");
    const a = await user();
    const ta = (await createVerifiedSession(a.id)).rawToken;

    // De server voltooide de inrichting, het antwoord ging verloren: de app kent dit toestel niet meer (sleutel is daar verwijderd).
    const first = await enrolViaApi(ta, a.id);
    expect((await call("/auth/device/enroll/complete", ta, first.body)).status).toBe(200);

    // Zichtbaar (voor de gebruiker op het web) ...
    const listed = await listTrustedDevices(a.id);
    expect(listed).toHaveLength(1);

    // ... zonder bezit van de privésleutel geen toegang (een handtekening van een andere sleutel faalt, ook met de juiste installatie-id)
    const c = await loginChallenge(first.installationId!);
    const forged = crypto.sign("sha256", Buffer.from("x"), { key: crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey, dsaEncoding: "der" }).toString("base64");
    await expect(loginWithDevice({ installationId: first.installationId!, challengeId: c.challengeId, signature: forged })).rejects.toBeTruthy();
    expect(await prisma.session.count({ where: { userId: a.id, deviceId: { not: null } } })).toBe(0);

    // De gebruiker kan opnieuw proberen (nieuwe sleutel en installatie) ...
    const second = await enrolViaApi(ta, a.id);
    expect((await call("/auth/device/enroll/complete", ta, second.body)).status).toBe(200);
    expect(await prisma.trustedDevice.count({ where: { userId: a.id, revokedAt: null } })).toBe(2);

    // ... en het wees-toestel is intrekbaar, waarna het nooit meer bruikbaar is.
    const orphan = await prisma.trustedDevice.findFirstOrThrow({ where: { userId: a.id, installationId: first.installationId } });
    expect(await revokeTrustedDevice(a.id, orphan.id, a.id)).toBe(true);
    await expect(loginChallenge(first.installationId!)).rejects.toBeTruthy();
    expect(await prisma.trustedDevice.count({ where: { userId: a.id, revokedAt: null } })).toBe(1);
  });
});
