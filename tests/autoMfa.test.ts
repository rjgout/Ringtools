import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { startTotpEnrollment, confirmTotpEnrollment } from "@/lib/mfa";
import { lockUserForEnrollment, enableMfaIfFirstMethod } from "@/lib/autoMfa";
import { resetDatabase, createTestUser } from "./setup";

vi.mock("server-only", () => ({}));

function code(secret: string): string {
  return new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate();
}
async function enrolTotp(userId: string, email: string) {
  const { secret } = await startTotpEnrollment(userId, email);
  return confirmTotpEnrollment(userId, email, code(secret));
}
async function addPasskey(userId: string, n = 1) {
  await prisma.webAuthnCredential.create({ data: { userId, credentialId: `cred-${userId}-${n}`, publicKey: Buffer.from("k") } });
}
const mfa = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).mfaEnabled;

beforeEach(async () => {
  await resetDatabase();
  process.env.WEB_TOTP_ENABLED = "true";
  process.env.AUTO_ENABLE_MFA = "true";
  process.env.NATIVE_TOTP_LOGIN_ENABLED = "true";
  process.env.NATIVE_PASSKEYS_ENABLED = "true";
});
afterEach(() => {
  delete process.env.AUTO_ENABLE_MFA;
  delete process.env.NATIVE_TOTP_LOGIN_ENABLED;
  delete process.env.NATIVE_PASSKEYS_ENABLED;
});

describe("Automatische MFA na de eerste bevestigde methode (AUTO_ENABLE_MFA)", () => {
  it("vlag uit (standaard): bevestigen van TOTP zet MFA niet aan", async () => {
    delete process.env.AUTO_ENABLE_MFA;
    const u = await createTestUser("RINGSECRETARIS", "Auto Een");
    expect((await enrolTotp(u.id, u.email)).ok).toBe(true);
    expect(await mfa(u.id)).toBe(false);
  });

  it("vlag aan: eerste bevestigde authenticator-app schakelt MFA in", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Twee");
    expect((await enrolTotp(u.id, u.email)).ok).toBe(true);
    expect(await mfa(u.id)).toBe(true);
    const ev = await prisma.securityEvent.findFirst({ where: { userId: u.id, detail: { contains: "automatisch" } } });
    expect(ev).not.toBeNull();
  });

  it("een onvolledige of foute bevestiging activeert niets", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Drie");
    await startTotpEnrollment(u.id, u.email);
    const res = await confirmTotpEnrollment(u.id, u.email, "000000");
    expect(res.ok).toBe(false);
    expect(await mfa(u.id)).toBe(false);
  });

  it("bestaande gebruiker met al een passkey en MFA bewust uit wordt niet omgezet door een nieuwe TOTP", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Vier");
    await addPasskey(u.id);
    expect((await enrolTotp(u.id, u.email)).ok).toBe(true);
    expect(await mfa(u.id)).toBe(false);
  });

  it("uitsluitingsbeveiliging: zonder app-login voor die methode blijft MFA uit (TOTP zonder NATIVE_TOTP_LOGIN_ENABLED, passkey zonder NATIVE_PASSKEYS_ENABLED)", async () => {
    delete process.env.NATIVE_TOTP_LOGIN_ENABLED;
    const u = await createTestUser("RINGSECRETARIS", "Auto Uitsluit");
    const r = await enrolTotp(u.id, u.email);
    expect(r.ok && r.mfaAutoEnabled).toBe(false);
    expect(await mfa(u.id)).toBe(false);
    delete process.env.NATIVE_PASSKEYS_ENABLED;
    const p = await createTestUser("RINGSECRETARIS", "Auto Passkey Only");
    const out = await prisma.$transaction(async (tx) => {
      const lock = await lockUserForEnrollment(tx, p.id);
      await tx.webAuthnCredential.create({ data: { userId: p.id, credentialId: `po-${p.id}`, publicKey: Buffer.from("k") } });
      return enableMfaIfFirstMethod(tx, p.id, lock!, "passkey");
    });
    expect(out).toBe(false);
    expect(await mfa(p.id)).toBe(false);
  });

  it("resultaat meldt of MFA door deze handeling is ingeschakeld", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Res");
    const r = await enrolTotp(u.id, u.email);
    expect(r.ok && r.mfaAutoEnabled).toBe(true);
  });

  it("herinschrijven van een bestaande TOTP (opnieuw instellen) wijzigt MFA niet, ook niet als MFA bewust uit staat", async () => {
    delete process.env.AUTO_ENABLE_MFA;
    const u = await createTestUser("RINGSECRETARIS", "Auto Her");
    await enrolTotp(u.id, u.email);
    process.env.AUTO_ENABLE_MFA = "true";
    expect(await mfa(u.id)).toBe(false);
    const { secret } = await startTotpEnrollment(u.id, u.email, true);
    const r = await confirmTotpEnrollment(u.id, u.email, code(secret));
    expect(r.ok && r.mfaAutoEnabled).toBe(false);
    expect(await mfa(u.id)).toBe(false);
  });

  it("gebruiker die zijn laatste methode had verwijderd en opnieuw begint, telt als eerste methode (gedocumenteerd)", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Opnieuw");
    delete process.env.AUTO_ENABLE_MFA;
    await enrolTotp(u.id, u.email);
    process.env.AUTO_ENABLE_MFA = "true";
    await prisma.totpCredential.deleteMany({ where: { userId: u.id } });
    expect((await enrolTotp(u.id, u.email)).ok).toBe(true);
    expect(await mfa(u.id)).toBe(true);
  });

  it("admin: bevestigen van TOTP zet mfaEnabled niet", async () => {
    const admin = await createTestUser("ADMIN", "Auto Admin2");
    const { secret } = await startTotpEnrollment(admin.id, admin.email);
    const r = await confirmTotpEnrollment(admin.id, admin.email, code(secret));
    expect(r.ok && r.mfaAutoEnabled).toBe(false);
    expect(await mfa(admin.id)).toBe(false);
  });

  it("atomair: faalt iets na het aanmaken van de methode, dan is er geen methode én geen MFA (rollback)", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Rollback");
    await expect(
      prisma.$transaction(async (tx) => {
        const lock = await lockUserForEnrollment(tx, u.id);
        await tx.webAuthnCredential.create({ data: { userId: u.id, credentialId: `rb-${u.id}`, publicKey: Buffer.from("k") } });
        expect(await enableMfaIfFirstMethod(tx, u.id, lock!, "passkey")).toBe(true);
        throw new Error("storing");
      })
    ).rejects.toThrow("storing");
    expect(await prisma.webAuthnCredential.count({ where: { userId: u.id } })).toBe(0);
    expect(await mfa(u.id)).toBe(false);
  });

  it("gelijktijdige inschrijvingen (passkey en TOTP): precies één telt als eerste methode, MFA staat daarna aan", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Race");
    const { secret } = await startTotpEnrollment(u.id, u.email);
    const passkey = prisma.$transaction(async (tx) => {
      const lock = await lockUserForEnrollment(tx, u.id);
      await tx.webAuthnCredential.create({ data: { userId: u.id, credentialId: `race-${u.id}`, publicKey: Buffer.from("k") } });
      return enableMfaIfFirstMethod(tx, u.id, lock!, "passkey");
    });
    const totp = confirmTotpEnrollment(u.id, u.email, code(secret)).then((r) => r.ok && r.mfaAutoEnabled);
    const results = await Promise.all([passkey, totp]);
    expect(results.filter(Boolean).length).toBe(1);
    expect(await mfa(u.id)).toBe(true);
    const events = await prisma.securityEvent.count({ where: { userId: u.id, detail: { contains: "automatisch" } } });
    expect(events).toBe(1);
  });

  it("al ingeschakelde MFA blijft ongewijzigd (geen verzwakking, geen dubbele melding)", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Vijf");
    await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true } });
    const r = await enrolTotp(u.id, u.email);
    expect(r.ok && r.mfaAutoEnabled).toBe(false);
    expect(await mfa(u.id)).toBe(true);
  });

  it("TOTP bevestigen terwijl WEB_TOTP_ENABLED uit staat telt niet als bruikbare methode: MFA blijft uit", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Zeven");
    const { secret } = await startTotpEnrollment(u.id, u.email);
    process.env.WEB_TOTP_ENABLED = "false";
    const r = await confirmTotpEnrollment(u.id, u.email, code(secret));
    expect(r.ok && r.mfaAutoEnabled).toBe(false);
    expect(await mfa(u.id)).toBe(false);
  });
});
