import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { createPairing, claimPairing, completePairing, revokeTrustedDevice, verifyDeviceSignature, registrationMessage, PAIRING_TTL_MS, MAX_ACTIVE_DEVICES } from "@/lib/trustedDevices";
import { resetDatabase, createTestUser } from "./setup";

// E2.3: vertrouwde toestellen (koppelcode + bewijs van bezit van een P-256-sleutel), achter TRUSTED_DEVICES_ENABLED.
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
function sign(privateKey: crypto.KeyObject, message: string, wrap = false) {
  const sig = crypto.sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "der" }).toString("base64");
  return wrap ? sig.replace(/(.{20})/g, "$1\n") : sig; // Android voegt regeleinden toe
}
async function mfaUser(over: { mfaEnabled?: boolean } = {}) {
  const u = await createTestUser("RINGSECRETARIS", `Toestel Lid ${++n}`, { email: `td${n}@test.ringapeldoorn.nl` });
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: over.mfaEnabled ?? true, activatedAt: new Date() } });
  return u;
}
async function register(userId: string, opts: { wrap?: boolean; kp?: ReturnType<typeof keyPair>; installationId?: string } = {}) {
  const { code } = await createPairing(userId);
  const claim = await claimPairing(code);
  const kp = opts.kp ?? keyPair();
  const installationId = opts.installationId ?? crypto.randomBytes(16).toString("hex");
  const res = await completePairing({
    registrationToken: claim.registrationToken,
    publicKey: kp.spki,
    signature: sign(kp.privateKey, registrationMessage(claim.challenge, installationId), opts.wrap),
    installationId,
    platform: "IOS",
    label: "Test-iPhone",
  });
  return { ...res, kp, claim, installationId, code };
}

beforeEach(async () => {
  await resetDatabase();
  process.env.TRUSTED_DEVICES_ENABLED = "true";
});

describe("Vertrouwde toestellen – koppelen", () => {
  it("volledig pad: code → claim → bewijs van bezit → toestel geregistreerd; geen sessie ontstaat", async () => {
    const u = await mfaUser();
    const sessionsBefore = await prisma.session.count();
    const r = await register(u.id, { wrap: true });
    const d = await prisma.trustedDevice.findUniqueOrThrow({ where: { id: r.deviceId } });
    expect(d).toMatchObject({ userId: u.id, platform: "IOS", label: "Test-iPhone", revokedAt: null });
    expect(await prisma.session.count()).toBe(sessionsBefore);
    expect(await prisma.securityEvent.count({ where: { userId: u.id, type: "TRUSTED_DEVICE_REGISTERED" } })).toBe(1);
    // de code is alleen als hash opgeslagen
    expect(JSON.stringify(await prisma.mfaPairing.findMany())).not.toContain(r.code.replace(/-/g, ""));
  });

  it("vlag uit: alles geweigerd", async () => {
    const u = await mfaUser();
    process.env.TRUSTED_DEVICES_ENABLED = "false";
    await expect(createPairing(u.id)).rejects.toMatchObject({ code: "not-available" });
    await expect(claimPairing("AAAA-BBBB-CCCC")).rejects.toMatchObject({ code: "not-available" });
  });

  it("alleen gewone gebruikers met verplichte MFA; admin en gebruiker zonder MFA geweigerd", async () => {
    const noMfa = await mfaUser({ mfaEnabled: false });
    await expect(createPairing(noMfa.id)).rejects.toMatchObject({ code: "mfa-required" });
    const admin = await createTestUser("ADMIN", "Toestel Admin");
    await expect(createPairing(admin.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("code is eenmalig: tweede claim, ongeldige en verlopen code falen", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    await claimPairing(code);
    await expect(claimPairing(code)).rejects.toMatchObject({ code: "invalid-code" });
    await expect(claimPairing("ZZZZ-ZZZZ-ZZZZ")).rejects.toMatchObject({ code: "invalid-code" });
    await expect(claimPairing("kort")).rejects.toMatchObject({ code: "invalid-code" });
    const { code: c2 } = await createPairing(u.id);
    await prisma.mfaPairing.updateMany({ where: { codeHash: hashToken(c2.replace(/-/g, "")) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(claimPairing(c2)).rejects.toMatchObject({ code: "invalid-code" });
    expect(PAIRING_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("gelijktijdige claims van dezelfde code: precies één wint", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => claimPairing(code)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  });

  it("een nieuwe koppelcode vervangt de vorige", async () => {
    const u = await mfaUser();
    const { code: first } = await createPairing(u.id);
    await createPairing(u.id);
    await expect(claimPairing(first)).rejects.toMatchObject({ code: "invalid-code" });
  });

  it("ongeldige handtekening (andere sleutel) wordt geweigerd; na drie pogingen is de registratie dood", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const claim = await claimPairing(code);
    const mine = keyPair();
    const other = keyPair();
    const installationId = crypto.randomBytes(16).toString("hex");
    const bad = () =>
      completePairing({ registrationToken: claim.registrationToken, publicKey: mine.spki, signature: sign(other.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "ANDROID", label: "x" });
    for (let i = 0; i < 3; i++) await expect(bad()).rejects.toMatchObject({ code: "invalid-proof" });
    // zelfs een goede handtekening werkt nu niet meer
    await expect(
      completePairing({ registrationToken: claim.registrationToken, publicKey: mine.spki, signature: sign(mine.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "ANDROID", label: "x" })
    ).rejects.toMatchObject({ code: "invalid-registration" });
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("handtekening over een ander bericht (andere installatie/challenge) wordt geweigerd", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const claim = await claimPairing(code);
    const kp = keyPair();
    await expect(
      completePairing({ registrationToken: claim.registrationToken, publicKey: kp.spki, signature: sign(kp.privateKey, registrationMessage("andere-challenge", "x".repeat(20))), installationId: "y".repeat(20), platform: "IOS", label: "x" })
    ).rejects.toMatchObject({ code: "invalid-proof" });
  });

  it("sleutel van een ander type (RSA / niet P-256) wordt geweigerd", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const claim = await claimPairing(code);
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const installationId = crypto.randomBytes(16).toString("hex");
    await expect(
      completePairing({ registrationToken: claim.registrationToken, publicKey: rsa.publicKey.export({ type: "spki", format: "der" }).toString("base64"), signature: "AAAA", installationId, platform: "IOS", label: "x" })
    ).rejects.toMatchObject({ code: "invalid-proof" });
  });

  it("gelijktijdige voltooiing met hetzelfde registratietoken: precies één toestel", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const claim = await claimPairing(code);
    const attempts = [1, 2, 3].map(() => {
      const kp = keyPair();
      const installationId = crypto.randomBytes(16).toString("hex");
      return completePairing({ registrationToken: claim.registrationToken, publicKey: kp.spki, signature: sign(kp.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "IOS", label: "x" });
    });
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await prisma.trustedDevice.count()).toBe(1);
  });

  it("MFA tussentijds uitgezet of account gedeactiveerd: voltooien geweigerd", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const claim = await claimPairing(code);
    await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: false } });
    const kp = keyPair();
    const installationId = crypto.randomBytes(16).toString("hex");
    await expect(
      completePairing({ registrationToken: claim.registrationToken, publicKey: kp.spki, signature: sign(kp.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "IOS", label: "x" })
    ).rejects.toMatchObject({ code: "invalid-registration" });
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("maximum aantal actieve toestellen; intrekken maakt ruimte", async () => {
    const u = await mfaUser();
    const ids: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_DEVICES; i++) ids.push((await register(u.id)).deviceId);
    await expect(createPairing(u.id)).rejects.toMatchObject({ code: "limit" });
    expect(await revokeTrustedDevice(u.id, ids[0], u.id)).toBe(true);
    await expect(createPairing(u.id)).resolves.toBeTruthy();
  });
});

describe("Vertrouwde toestellen – grenzen onder gelijktijdigheid", () => {
  it("gelijktijdige ongeldige bewijzen: de foutteller stopt exact op de limiet en daarna werkt ook een goed bewijs niet meer", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const claim = await claimPairing(code);
    const mine = keyPair();
    const other = keyPair();
    const installationId = crypto.randomBytes(16).toString("hex");
    const bad = () =>
      completePairing({ registrationToken: claim.registrationToken, publicKey: mine.spki, signature: sign(other.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "IOS", label: "x" }).catch(() => "fout");
    await Promise.all(Array.from({ length: 8 }, bad));
    expect((await prisma.mfaPairing.findFirstOrThrow({ where: { userId: u.id } })).failedAttempts).toBe(3);
    await expect(
      completePairing({ registrationToken: claim.registrationToken, publicKey: mine.spki, signature: sign(mine.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "IOS", label: "x" })
    ).rejects.toBeTruthy();
    expect(await prisma.trustedDevice.count()).toBe(0);
  });

  it("verlopen claim (registratietoken) wordt geweigerd", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const claim = await claimPairing(code);
    await prisma.mfaPairing.updateMany({ where: { userId: u.id }, data: { claimExpiresAt: new Date(Date.now() - 1000) } });
    const kp = keyPair();
    const installationId = crypto.randomBytes(16).toString("hex");
    await expect(
      completePairing({ registrationToken: claim.registrationToken, publicKey: kp.spki, signature: sign(kp.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "IOS", label: "x" })
    ).rejects.toMatchObject({ code: "invalid-registration" });
  });

  it("dezelfde sleutel in twee gelijktijdige registraties (zelfde of ander account): precies één slaagt", async () => {
    const a = await mfaUser();
    const b = await mfaUser();
    const kp = keyPair();
    const prep = async (userId: string) => {
      const { code } = await createPairing(userId);
      const claim = await claimPairing(code);
      const installationId = crypto.randomBytes(16).toString("hex");
      return () => completePairing({ registrationToken: claim.registrationToken, publicKey: kp.spki, signature: sign(kp.privateKey, registrationMessage(claim.challenge, installationId)), installationId, platform: "IOS", label: "x" });
    };
    const [fa, fb] = [await prep(a.id), await prep(b.id)];
    const results = await Promise.allSettled([fa(), fb()]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await prisma.trustedDevice.count()).toBe(1);
  });

  it("ingetrokken toestel: ook gelijktijdige handtekeningcontroles slagen niet meer na het intrekken", async () => {
    const u = await mfaUser();
    const r = await register(u.id);
    await revokeTrustedDevice(u.id, r.deviceId, u.id);
    const results = await Promise.all([1, 2, 3].map(() => verifyDeviceSignature(r.deviceId, "m", sign(r.kp.privateKey, "m"))));
    expect(results.some(Boolean)).toBe(false);
  });
});

describe("Vertrouwde toestellen – intrekken en handtekeningen", () => {
  it("ingetrokken toestel kan niet meer verifiëren en de sleutel kan niet opnieuw worden geregistreerd", async () => {
    const u = await mfaUser();
    const r = await register(u.id);
    const msg = "server-bericht";
    expect(await verifyDeviceSignature(r.deviceId, msg, sign(r.kp.privateKey, msg))).toBe(true);
    expect(await verifyDeviceSignature(r.deviceId, msg, sign(keyPair().privateKey, msg))).toBe(false);
    expect(await revokeTrustedDevice(u.id, r.deviceId, u.id)).toBe(true);
    expect(await revokeTrustedDevice(u.id, r.deviceId, u.id)).toBe(false); // idempotent
    expect(await verifyDeviceSignature(r.deviceId, msg, sign(r.kp.privateKey, msg))).toBe(false);
    await expect(register(u.id, { kp: r.kp })).rejects.toMatchObject({ code: "key-reused" });
  });

  it("een ander account kan een toestel niet intrekken", async () => {
    const a = await mfaUser();
    const b = await mfaUser();
    const r = await register(a.id);
    expect(await revokeTrustedDevice(b.id, r.deviceId, b.id)).toBe(false);
    expect((await prisma.trustedDevice.findUniqueOrThrow({ where: { id: r.deviceId } })).revokedAt).toBeNull();
  });

  it("gelijktijdig intrekken: precies één succes", async () => {
    const u = await mfaUser();
    const r = await register(u.id);
    const results = await Promise.all([1, 2, 3].map(() => revokeTrustedDevice(u.id, r.deviceId, u.id)));
    expect(results.filter(Boolean).length).toBe(1);
  });

  it("een geregistreerd toestel geeft geen sessie of MFA-voordeel: er is geen route die het als methode accepteert", async () => {
    const u = await mfaUser();
    const r = await register(u.id);
    expect(r.deviceId).toBeTruthy();
    const pending = await handleApi(new Request("http://localhost/api/mobile/v1/auth/mfa/device/verify", { method: "POST", body: "{}" }), ["auth", "mfa", "device", "verify"]);
    expect(pending.status).toBe(404);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe("Vertrouwde toestellen – API", () => {
  let ip = 0;
  async function call(path: string, body: unknown, ipAddr = `10.9.0.${++ip}`) {
    const url = new URL(`http://localhost/api/mobile/v1${path}`);
    const res = await handleApi(new Request(url, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ipAddr }, body: JSON.stringify(body) }), path.split("/").filter(Boolean));
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it("publieke claim/complete zonder inlog; app-sessie is niet nodig; /meta meldt de vlag", async () => {
    const u = await mfaUser();
    const { code } = await createPairing(u.id);
    const c = await call("/trusted-devices/pair/claim", { code });
    expect(c.status).toBe(200);
    const kp = keyPair();
    const installationId = crypto.randomBytes(16).toString("hex");
    const done = await call("/trusted-devices/pair/complete", {
      registrationToken: c.body.registrationToken,
      publicKey: kp.spki,
      signature: sign(kp.privateKey, registrationMessage(c.body.challenge, installationId)),
      installationId,
      platform: "ANDROID",
      label: "Pixel",
    });
    expect(done.status).toBe(200);
    expect(done.body).not.toHaveProperty("token");
    const meta = await handleApi(new Request("http://localhost/api/mobile/v1/meta"), ["meta"]);
    expect((await meta.json()).trustedDevices).toBe(true);
  });

  it("poginglimiet per IP op de claim", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call("/trusted-devices/pair/claim", { code: "AAAA-BBBB-CCCC" }, "10.9.9.9")).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[11]).toBe(429);
  });

  it("vlag uit: 404 op de routes", async () => {
    process.env.TRUSTED_DEVICES_ENABLED = "false";
    expect((await call("/trusted-devices/pair/claim", { code: "AAAA-BBBB-CCCC" })).status).toBe(404);
  });
});
