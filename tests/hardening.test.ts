import { beforeEach, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { startTotpEnrollment, confirmTotpEnrollment, verifyTotpCode, isTotpConfirmed } from "@/lib/mfa";
import { isAllowedPushEndpoint, isValidPushKey } from "@/lib/pushEndpoint";
import { weakSecretReason } from "@/lib/bootstrap";
import { unregisterDeviceToken } from "@/lib/api/service";
import { resetDatabase, createTestUser } from "./setup";

beforeEach(async () => {
  await resetDatabase();
});

function codeFor(secretBase32: string, offsetSteps = 0): string {
  return new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) }).generate({ timestamp: Date.now() + offsetSteps * 30000 });
}

describe("TOTP opnieuw instellen laat het werkende secret intact tot bevestiging", () => {
  it("een niet afgeronde herinschrijving houdt de TOTP bevestigd en het oude secret werkend", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    const first = await startTotpEnrollment(admin.id, admin.email);
    expect((await confirmTotpEnrollment(admin.id, admin.email, codeFor(first.secret))).ok).toBe(true);

    const next = await startTotpEnrollment(admin.id, admin.email, true); // niet bevestigd
    expect(next.secret).not.toBe(first.secret);
    expect(await isTotpConfirmed(admin.id)).toBe(true);
    // de pagina voor een wachtwoord-only sessie zou dus verificatie (geen inschrijving) tonen
    await expect(startTotpEnrollment(admin.id, admin.email)).rejects.toThrow();
    // het oude secret werkt nog; het nieuwe is nog niet geldig voor inloggen
    expect(await verifyTotpCode(admin.id, admin.email, codeFor(first.secret, 1))).toBe("OK");
  });

  it("bevestigen met een code van het nieuwe secret wisselt het secret om", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    const first = await startTotpEnrollment(admin.id, admin.email);
    await confirmTotpEnrollment(admin.id, admin.email, codeFor(first.secret));
    const next = await startTotpEnrollment(admin.id, admin.email, true);

    const result = await confirmTotpEnrollment(admin.id, admin.email, codeFor(next.secret));
    expect(result.ok).toBe(true);
    const row = await prisma.totpCredential.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(row.pendingSecretEncrypted).toBeNull();
    expect(row.confirmedAt).not.toBeNull();
  });

  it("een code van het oude secret bevestigt de herinschrijving niet", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    const first = await startTotpEnrollment(admin.id, admin.email);
    await confirmTotpEnrollment(admin.id, admin.email, codeFor(first.secret));
    await startTotpEnrollment(admin.id, admin.email, true);
    // De oude code is al gebruikt/hoort bij het oude secret: geen omwisseling.
    const result = await confirmTotpEnrollment(admin.id, admin.email, codeFor(first.secret));
    expect(result.ok).toBe(false);
    expect(await isTotpConfirmed(admin.id)).toBe(true);
  });

  it("zonder lopende herinschrijving is een bevestigde TOTP niet opnieuw te 'bevestigen'", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    const first = await startTotpEnrollment(admin.id, admin.email);
    await confirmTotpEnrollment(admin.id, admin.email, codeFor(first.secret));
    const again = await confirmTotpEnrollment(admin.id, admin.email, codeFor(first.secret));
    expect(again.ok).toBe(false);
  });
});

describe("Web-push-endpoints", () => {
  it("accepteert alleen https-adressen van bekende push-services", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://db5.notify.windows.com/?token=abc")).toBe(true);
  });
  it("weigert interne, onbekende, http- en vreemd opgemaakte adressen", () => {
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://169.254.169.254/latest/meta-data",
      "https://db:5432/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com.nl/x",
      "https://example.com/x",
      "not a url",
      "",
      "https://fcm.googleapis.com/" + "a".repeat(3000),
    ]) {
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
    }
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint({ toString: () => "https://fcm.googleapis.com/x" })).toBe(false);
  });
  it("valideert de sleutels", () => {
    expect(isValidPushKey("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", 200)).toBe(true);
    expect(isValidPushKey("not base64url!", 200)).toBe(false);
    expect(isValidPushKey("", 200)).toBe(false);
    expect(isValidPushKey("a".repeat(300), 200)).toBe(false);
  });
});

describe("Zwakke bootstrap-geheimen", () => {
  it("weigert voorbeeldwaarden en te korte waarden", () => {
    expect(weakSecretReason("verander-dit-in-een-sterk-wachtwoord", 10)).toMatch(/voorbeeld/);
    expect(weakSecretReason("kort", 10)).toMatch(/korter/);
    expect(weakSecretReason("een-uniek-lang-wachtwoord-42", 10)).toBeNull();
  });
});

describe("Push-token afmelden zonder sessie", () => {
  it("verwijdert het token op basis van het token zelf", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const token = "dGVzdC1mY20tdG9rZW4tMTIzNDU2Nzg5MDpBUEE5MWJF";
    await prisma.devicePushToken.create({ data: { userId: user.id, token, platform: "android" } });
    await unregisterDeviceToken(token);
    expect(await prisma.devicePushToken.count()).toBe(0);
  });
  it("negeert ongeldige tokens", async () => {
    await expect(unregisterDeviceToken("zomaar")).resolves.toEqual({ ok: true });
  });
});
