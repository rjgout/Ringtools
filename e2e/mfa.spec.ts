import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { regenerateRecoveryCodes } from "../src/lib/mfa";
import { loginAsAdmin, loginWithMagicLink, addVirtualAuthenticator } from "./helpers/mfa";

test("een ongeldige TOTP-code wordt afgewezen bij het inloggen", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("e2e-test-wachtwoord-123");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/mfa\/totp/);

  await page.locator("#code").fill("000000");
  await page.locator('form button[type="submit"]').first().click();

  await expect(page.getByText("Ongeldige code.")).toBeVisible();
  await expect(page).toHaveURL(/\/mfa\/totp/);
});

test("een magic link alleen geeft geen toegang: de passkey-stap is verplicht", async ({ page }) => {
  const user = await prisma.user.create({
    data: { name: `Alleen link ${Date.now()}`, email: `alleen.link.${Date.now()}@test.ringapeldoorn.nl`, role: "HOGERAAD", active: true },
  });
  const { rawToken } = await createMagicLinkToken(user.id);

  await page.goto(`/auth/magic/${rawToken}`);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/mfa\/passkey/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("passkeyregistratie en een latere passkeylogin werken met user verification", async ({ page }) => {
  const user = await prisma.user.create({
    data: { name: `Passkey ${Date.now()}`, email: `passkey.${Date.now()}@test.ringapeldoorn.nl`, role: "HOGERAAD", active: true },
  });

  const { rawToken: firstToken } = await createMagicLinkToken(user.id);
  await loginWithMagicLink(page, `/auth/magic/${firstToken}`);
  await expect(page).toHaveURL(/\/dashboard/);
  expect(await prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(1);

  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL(/\/login/);

  // Tweede login: nu al een passkey geregistreerd, dus geen registratieknop
  // meer nodig — het verificatiepaneel start de ceremonie zelf.
  const { rawToken: secondToken } = await createMagicLinkToken(user.id);
  await page.goto(`/auth/magic/${secondToken}`);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/mfa\/passkey/);
  await expect(page.getByRole("button", { name: "Passkey registreren" })).not.toBeVisible();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("zonder user verification door de authenticator wordt de passkey geweigerd", async ({ page }) => {
  const user = await prisma.user.create({
    data: { name: `GeenUV ${Date.now()}`, email: `geen.uv.${Date.now()}@test.ringapeldoorn.nl`, role: "HOGERAAD", active: true },
  });
  const { rawToken } = await createMagicLinkToken(user.id);

  await page.goto(`/auth/magic/${rawToken}`);
  await addVirtualAuthenticator(page, { isUserVerified: false });
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/mfa\/passkey/);
  await page.getByRole("button", { name: "Passkey registreren" }).click();

  // userVerification=required: de browser/authenticator kan dit niet
  // garanderen, dus de ceremonie mislukt vóórdat de server iets ziet — de
  // registratieknop blijft staan (geen navigatie, geen opgeslagen passkey).
  await expect(page.getByRole("button", { name: "Passkey registreren" })).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/\/mfa\/passkey/);
  expect(await prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(0);
});

test("een herstelcode logt de admin eenmalig in; een tweede keer wordt geweigerd", async ({ page }) => {
  // Zelfstandige, robuuste opzet: een nieuwe set herstelcodes rechtstreeks
  // aanmaken (zoals confirmTotpEnrollmentAction dat server-side ook doet),
  // zodat deze test niet afhankelijk is van wélke eerdere test het
  // adminaccount heeft ingeschreven, en zonder een extra (rate-gelimiteerde)
  // wachtwoordlogin alleen om de codes te verversen.
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const [recoveryCode] = await regenerateRecoveryCodes(admin.id);

  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("e2e-test-wachtwoord-123");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/mfa\/totp/);
  await page.getByRole("button", { name: "Ik heb geen toegang tot mijn authenticator" }).click();
  await page.getByLabel("Herstelcode").fill(recoveryCode);
  await page.getByRole("button", { name: "Inloggen met herstelcode" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("button", { name: "Uitloggen" }).click();
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("e2e-test-wachtwoord-123");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/mfa\/totp/);
  await page.getByRole("button", { name: "Ik heb geen toegang tot mijn authenticator" }).click();
  await page.getByLabel("Herstelcode").fill(recoveryCode);
  await page.getByRole("button", { name: "Inloggen met herstelcode" }).click();
  await expect(page.getByText("Ongeldige of al gebruikte herstelcode.")).toBeVisible();
});

test("een API-route geeft geen toegang zonder volledig afgeronde MFA", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("e2e-test-wachtwoord-123");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/mfa\/totp/);

  const res = await page.request.get("/api/notifications");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ notifications: [], unreadCount: 0 });
});

test("een admin kan de MFA van een gebruiker resetten; de gebruiker moet daarna opnieuw registreren", async ({ page }) => {
  const user = await prisma.user.create({
    data: { name: `Reset Mij ${Date.now()}`, email: `reset.mij.${Date.now()}@test.ringapeldoorn.nl`, role: "HOGERAAD", active: true },
  });
  const { rawToken: enrollToken } = await createMagicLinkToken(user.id);
  await loginWithMagicLink(page, `/auth/magic/${enrollToken}`);
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("button", { name: "Uitloggen" }).click();

  await loginAsAdmin(page, "webmin", "e2e-test-wachtwoord-123");
  await page.goto("/gebruikers");
  const row = page.locator("details", { hasText: user.email });
  await row.locator("summary").click();

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "MFA resetten" }).click();
  await expect(row.getByText(/is gereset/)).toBeVisible();
  expect(await prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(0);

  await page.getByRole("button", { name: "Uitloggen" }).click();

  const { rawToken: secondToken } = await createMagicLinkToken(user.id);
  await page.goto(`/auth/magic/${secondToken}`);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/mfa\/passkey/);
  await expect(page.getByRole("button", { name: "Passkey registreren" })).toBeVisible();
});

test("een niet-adminrol ziet geen 'MFA resetten'-knop in gebruikersbeheer", async ({ page }) => {
  const manager = await prisma.user.create({
    data: { name: `Manager ${Date.now()}`, email: `manager.${Date.now()}@test.ringapeldoorn.nl`, role: "RINGPRESIDIUM", active: true },
  });
  const { rawToken } = await createMagicLinkToken(manager.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/gebruikers");
  await expect(page.getByRole("button", { name: "MFA resetten" })).toHaveCount(0);
});

test.describe("Mobiele interface", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("de passkey-inschrijving is op mobiel bruikbaar", async ({ page }) => {
    const user = await prisma.user.create({
      data: { name: `Mobiel MFA ${Date.now()}`, email: `mobiel.mfa.${Date.now()}@test.ringapeldoorn.nl`, role: "HOGERAAD", active: true },
    });
    const { rawToken } = await createMagicLinkToken(user.id);

    await page.goto(`/auth/magic/${rawToken}`);
    await addVirtualAuthenticator(page);
    await page.getByRole("button", { name: "Inloggen" }).click();
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await expect(page.getByRole("heading", { name: "Registreer een passkey" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Passkey registreren" })).toBeVisible();
  });
});
