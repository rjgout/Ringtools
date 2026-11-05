import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { startTotpEnrollment, confirmTotpEnrollment } from "@/lib/mfa";
import { loginPlan } from "@/lib/mfaMethods";
import { resetDatabase, createTestUser } from "./setup";

vi.mock("server-only", () => ({}));

async function addTotp(userId: string, email: string) {
  const { secret } = await startTotpEnrollment(userId, email);
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  expect((await confirmTotpEnrollment(userId, email, totp.generate())).ok).toBe(true);
}
async function addPasskey(userId: string) {
  await prisma.webAuthnCredential.create({ data: { userId, credentialId: `c-${userId}`, publicKey: Buffer.from("x") } });
}

beforeEach(async () => {
  await resetDatabase();
  process.env.WEB_TOTP_ENABLED = "true";
});
afterEach(() => {
  delete process.env.WEB_TOTP_ENABLED;
});

describe("E2.2 – welke stap volgt na de e-mailcode (loginPlan)", () => {
  it("alleen passkey → passkey; alleen TOTP → totp; beide → keuze; geen → inschrijving", async () => {
    const a = await createTestUser("HOGERAAD", "Alleen passkey");
    await addPasskey(a.id);
    const b = await createTestUser("HOGERAAD", "Alleen totp");
    await addTotp(b.id, b.email);
    const c = await createTestUser("HOGERAAD", "Beide");
    await addPasskey(c.id);
    await addTotp(c.id, c.email);
    const d = await createTestUser("HOGERAAD", "Geen");
    expect((await loginPlan(a)).plan).toBe("passkey");
    expect((await loginPlan(b)).plan).toBe("totp");
    expect((await loginPlan(c)).plan).toBe("choose");
    expect((await loginPlan(d)).plan).toBe("enroll");
  });

  it("vlag uit: TOTP telt niet mee — passkey blijft passkey, beide wordt passkey, alleen TOTP is ‘niet beschikbaar’ (nooit inschrijven of e-mail-only)", async () => {
    const both = await createTestUser("HOGERAAD", "Beide");
    await addPasskey(both.id);
    await addTotp(both.id, both.email);
    const onlyTotp = await createTestUser("HOGERAAD", "Alleen totp");
    await addTotp(onlyTotp.id, onlyTotp.email);
    delete process.env.WEB_TOTP_ENABLED;
    expect((await loginPlan(both)).plan).toBe("passkey");
    expect((await loginPlan(onlyTotp)).plan).toBe("unavailable");
  });

  it("een onbevestigde TOTP-rij maakt van ‘alleen passkey’ geen keuze, en van ‘niets’ geen TOTP-login", async () => {
    const a = await createTestUser("HOGERAAD", "Passkey");
    await addPasskey(a.id);
    await startTotpEnrollment(a.id, a.email); // niet bevestigd
    expect((await loginPlan(a)).plan).toBe("passkey");
    const b = await createTestUser("HOGERAAD", "Niets");
    await startTotpEnrollment(b.id, b.email);
    expect((await loginPlan(b)).plan).toBe("enroll");
  });
});
