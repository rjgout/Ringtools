import type { Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "../../src/lib/prisma";
import { createMagicLinkToken } from "../../src/lib/auth";
import { startTotpEnrollment, confirmTotpEnrollment } from "../../src/lib/mfa";
import { decryptSecret } from "../../src/lib/crypto";
import { createE2eUser } from "./data";

export function codeFor(secret: string, offset = 0): string {
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate({ timestamp: Date.now() + offset * 30_000 });
}

/** Gebruiker met een bevestigde authenticator-app (zoals na inschrijving). */
export async function seedTotpUser(name: string, opts: { mfaEnabled?: boolean } = {}) {
  const { user } = await createE2eUser("HOGERAAD", name, { mfaEnabled: opts.mfaEnabled ?? true });
  const { secret } = await startTotpEnrollment(user.id, user.email);
  const done = await confirmTotpEnrollment(user.id, user.email, codeFor(secret));
  if (!done.ok) throw new Error("seed mislukt");
  return { user, secret };
}

/** Test-only: laat de replay-teller los zodat een volgende stap in hetzelfde 30s-venster opnieuw een code mag indienen. */
export async function releaseReplayCounter(userId: string) {
  await prisma.totpCredential.update({ where: { userId }, data: { lastUsedCounter: null, failedAttempts: 0, lockedUntil: null } });
}

/** Alleen de eerste factor: e-mailcode/magic link. Laat de gebruiker op de wachtende MFA-stap. */
export async function startLogin(page: Page, userId: string) {
  const { rawToken } = await createMagicLinkToken(userId);
  await page.goto(`/auth/magic/${rawToken}`);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/magic"), { timeout: 20000 });
}

export async function secretOf(userId: string) {
  const row = await prisma.totpCredential.findUniqueOrThrow({ where: { userId } });
  return decryptSecret(row.secretEncrypted);
}

export async function fakePasskeyRow(userId: string) {
  await prisma.webAuthnCredential.create({ data: { userId, credentialId: `fake-${userId}-${Date.now()}`, publicKey: Buffer.from([1, 2, 3]) } });
}
