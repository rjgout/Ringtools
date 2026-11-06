import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { startTotpEnrollment, confirmTotpEnrollment } from "@/lib/mfa";
import { autoEnableMfaAfterFirstMethod } from "@/lib/autoMfa";
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
});
afterEach(() => {
  delete process.env.AUTO_ENABLE_MFA;
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

  it("al ingeschakelde MFA blijft ongewijzigd (geen verzwakking)", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Vijf");
    await addPasskey(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true } });
    expect(await autoEnableMfaAfterFirstMethod(u.id, false)).toBe(false);
    expect(await mfa(u.id)).toBe(true);
  });

  it("zonder bruikbare methode (of voor admin) gebeurt niets, ook niet als de aanroeper dat vraagt", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Zes");
    expect(await autoEnableMfaAfterFirstMethod(u.id, false)).toBe(false);
    expect(await mfa(u.id)).toBe(false);
    const admin = await createTestUser("ADMIN", "Auto Admin");
    await addPasskey(admin.id);
    expect(await autoEnableMfaAfterFirstMethod(admin.id, false)).toBe(false);
    expect(await mfa(admin.id)).toBe(false);
  });

  it("TOTP-rij terwijl WEB_TOTP_ENABLED uit staat telt niet als bruikbare methode", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Zeven");
    expect((await enrolTotp(u.id, u.email)).ok).toBe(true);
    await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: false } });
    process.env.WEB_TOTP_ENABLED = "false";
    expect(await autoEnableMfaAfterFirstMethod(u.id, false)).toBe(false);
    expect(await mfa(u.id)).toBe(false);
  });

  it("gelijktijdige aanroepen schakelen precies één keer in", async () => {
    const u = await createTestUser("RINGSECRETARIS", "Auto Acht");
    await addPasskey(u.id);
    const results = await Promise.all([1, 2, 3, 4].map(() => autoEnableMfaAfterFirstMethod(u.id, false)));
    expect(results.filter(Boolean).length).toBe(1);
    expect(await mfa(u.id)).toBe(true);
  });
});
