import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { startTotpEnrollment, confirmTotpEnrollment } from "../src/lib/mfa";
import { decryptSecret } from "../src/lib/crypto";
import { createE2eUser } from "./helpers/data";
import { loginWithMagicLink, addVirtualAuthenticator, logoutFromApp, gotoStable } from "./helpers/mfa";

/**
 * E2.1 – authenticator-app (TOTP) voor gewone webgebruikers.
 * De functievlag staat op de server; deze spec draait daarom twee keer: `E2E_WEB_TOTP=on` en `E2E_WEB_TOTP=off`
 * (volgorde aan → uit → aan test ook het terugzetten van de vlag voor gebruikers die al TOTP hebben).
 */
const MODE = process.env.E2E_WEB_TOTP === "on" ? "on" : process.env.E2E_WEB_TOTP === "off" ? "off" : null;
test.skip(MODE === null, "Zet E2E_WEB_TOTP=on of off (en start de server met dezelfde WEB_TOTP_ENABLED-waarde).");

function codeFor(secret: string, offset = 0): string {
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate({ timestamp: Date.now() + offset * 30_000 });
}

/** Maakt een gebruiker met een bevestigde TOTP (zoals na inschrijving). Geeft het secret en de herstelcodes terug. */
async function seedTotpUser(name: string, opts: { mfaEnabled?: boolean; email?: string } = {}) {
  const { user } = await createE2eUser("HOGERAAD", name, { mfaEnabled: opts.mfaEnabled ?? true });
  const { secret } = await startTotpEnrollment(user.id, user.email);
  const done = await confirmTotpEnrollment(user.id, user.email, codeFor(secret));
  if (!done.ok) throw new Error("seed mislukt");
  return { user, secret, recoveryCodes: done.recoveryCodes };
}

/** Test-only: laat de replay-teller los zodat een volgende stap in hetzelfde 30s-venster opnieuw een code mag indienen. */
async function releaseReplayCounter(userId: string) {
  await prisma.totpCredential.update({ where: { userId }, data: { lastUsedCounter: null, failedAttempts: 0, lockedUntil: null } });
}

async function startLogin(page: Page, userId: string) {
  const { rawToken } = await createMagicLinkToken(userId);
  await page.goto(`/auth/magic/${rawToken}`);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/magic"), { timeout: 20000 });
}

async function submitLoginCode(page: Page, code: string) {
  await page.locator("#code").fill(code);
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
}

async function secretOf(userId: string) {
  const row = await prisma.totpCredential.findUniqueOrThrow({ where: { userId } });
  return decryptSecret(row.secretEncrypted);
}

// =====================================================================================================================
// Vlag AAN
// =====================================================================================================================
test.describe("vlag aan", () => {
  test.skip(MODE !== "on", "alleen met WEB_TOTP_ENABLED=true");

  test("inschrijven in het profiel: QR, bevestigen, acht herstelcodes eenmalig getoond, daarna verificatie inschakelen", async ({ page }) => {
    const { user } = await createE2eUser("HOGERAAD", `Inschrijven ${Date.now()}`);
    await loginWithMagicLink(page, `/auth/magic/${(await createMagicLinkToken(user.id)).rawToken}`);
    await gotoStable(page, "/profiel/beveiliging");

    await expect(page.getByRole("heading", { name: "Authenticator-app" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verificatie inschakelen" })).toBeDisabled();
    await page.getByRole("button", { name: "Authenticator-app instellen" }).click();
    await expect(page.getByAltText("QR-code voor de authenticator-app")).toBeVisible();

    // Foute code eerst
    await page.locator("#user-totp-code").fill("000000");
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(page.getByText(/Ongeldige code/)).toBeVisible();

    await page.locator("#user-totp-code").fill(codeFor(await secretOf(user.id)));
    await page.getByRole("button", { name: "Bevestigen" }).click();
    const panel = page.getByTestId("recovery-codes-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".recovery-codes span")).toHaveCount(8);
    // Alleen hashes in de database
    const rows = await prisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(8);
    const shown = await panel.locator(".recovery-codes span").allTextContents();
    expect(rows.some((r) => shown.includes(r.codeHash))).toBe(false);

    await page.getByRole("button", { name: "Ik heb mijn herstelcodes opgeslagen" }).click();
    await expect(page.getByTestId("recovery-codes-panel")).toHaveCount(0);
    await expect(page.getByTestId("suggest-passkey")).toBeVisible(); // sterke aanbeveling: passkey erbij
    await expect(page.getByRole("button", { name: "Verificatie inschakelen" })).toBeEnabled();
    await page.getByRole("button", { name: "Verificatie inschakelen" }).click();
    await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true);
    // Eigen gebruikersmeldingen: geen verwijzing naar "passkey-verificatie" als er TOTP bestaat
    await expect(page.getByText(/Passkey-verificatie/)).toHaveCount(0);
  });

  test("inloggen met TOTP; foute code wordt afgewezen; replay van dezelfde code mislukt", async ({ page }) => {
    const { user, secret } = await seedTotpUser(`Login ${Date.now()}`);
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/totp/);

    await submitLoginCode(page, "000000");
    await expect(page.getByText("Ongeldige code.")).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/); // nog geen sessie

    await startLogin(page, user.id);
    await releaseReplayCounter(user.id);
    const code = codeFor(secret);
    await submitLoginCode(page, code);
    await expect(page).toHaveURL(/\/app/);
    await logoutFromApp(page);

    // Replay: dezelfde code opnieuw (zelfde tijdstap) wordt geweigerd
    await startLogin(page, user.id);
    await submitLoginCode(page, code);
    await expect(page.getByText("Ongeldige code.")).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("lockout na vijf foute codes: ook een goede code werkt daarna niet meer", async ({ page }) => {
    const { user, secret } = await seedTotpUser(`Lockout ${Date.now()}`);
    await releaseReplayCounter(user.id);
    await startLogin(page, user.id);
    for (let i = 0; i < 5; i++) {
      await submitLoginCode(page, "000000");
      // wachten tot de server de poging heeft geteld
      await expect.poll(async () => (await prisma.totpCredential.findUniqueOrThrow({ where: { userId: user.id } })).failedAttempts).toBe(i + 1);
    }
    await expect(page.getByText(/Te veel mislukte pogingen/)).toBeVisible();
    await submitLoginCode(page, codeFor(secret));
    await expect(page.getByText(/Te veel mislukte pogingen/)).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    expect((await prisma.totpCredential.findUniqueOrThrow({ where: { userId: user.id } })).lockedUntil).not.toBeNull();
  });

  test("herstelcode: eenmalig bruikbaar bij inloggen; nieuwe set ongeldigt de oude", async ({ page }) => {
    const { user, recoveryCodes } = await seedTotpUser(`Herstel ${Date.now()}`);
    await startLogin(page, user.id);
    await page.getByRole("button", { name: "Ik heb geen toegang tot mijn authenticator" }).click();
    await page.locator("#recovery-code").fill(recoveryCodes[0]);
    await page.getByRole("button", { name: "Inloggen met herstelcode" }).click();
    await expect(page).toHaveURL(/\/app/);

    // nieuwe herstelcodes (sessie is recent geverifieerd)
    await gotoStable(page, "/profiel/beveiliging");
    await expect(page.getByText("Nog 7 van 8 herstelcodes ongebruikt.")).toBeVisible();
    await page.getByRole("button", { name: "Nieuwe herstelcodes maken" }).click();
    await expect(page.getByTestId("recovery-codes-panel").locator(".recovery-codes span")).toHaveCount(8);
    await page.getByRole("button", { name: "Ik heb mijn herstelcodes opgeslagen" }).click();
    await logoutFromApp(page);

    // oude code (nog ongebruikt in de oude set) werkt niet meer; de al gebruikte code ook niet
    await startLogin(page, user.id);
    await page.getByRole("button", { name: "Ik heb geen toegang tot mijn authenticator" }).click();
    await page.locator("#recovery-code").fill(recoveryCodes[1]);
    await page.getByRole("button", { name: "Inloggen met herstelcode" }).click();
    await expect(page.getByText("Ongeldige of al gebruikte herstelcode.")).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("herverificatie met TOTP vóór een beveiligingsactie; verwijderen laatste methode wordt geweigerd; uitschakelen en verwijderen kan", async ({ page }) => {
    const { user, secret } = await seedTotpUser(`Verwijderen ${Date.now()}`);
    await startLogin(page, user.id);
    await releaseReplayCounter(user.id);
    await submitLoginCode(page, codeFor(secret));
    await expect(page).toHaveURL(/\/app/);

    // Sessie ouder dan 15 minuten -> herverificatie nodig
    await prisma.session.updateMany({ where: { userId: user.id }, data: { mfaAt: new Date(Date.now() - 60 * 60 * 1000) } });
    await gotoStable(page, "/profiel/beveiliging");
    await page.getByRole("button", { name: "Verificatie uitschakelen" }).click();
    await expect(page).toHaveURL(/\/profiel\/beveiliging\/herverifieer/);
    await releaseReplayCounter(user.id);
    await page.locator("#code").fill("000000");
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(page.getByText("Ongeldige code.")).toBeVisible();
    await page.locator("#code").fill(codeFor(secret));
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(page).toHaveURL(/\/profiel\/beveiliging$/);

    // Enige methode + verificatie aan: geen verwijderknop, uitleg zichtbaar
    await expect(page.getByRole("button", { name: "Authenticator-app verwijderen" })).toHaveCount(0);
    await expect(page.getByText(/Dit is je enige methode/)).toBeVisible();

    await page.getByRole("button", { name: "Verificatie uitschakelen" }).click();
    await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(false);
    await page.reload();
    await page.getByRole("button", { name: "Authenticator-app verwijderen" }).click();
    await expect(page.getByText("Authenticator-app en herstelcodes verwijderd.")).toBeVisible();
    expect(await prisma.totpCredential.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
  });

  test("passkey én TOTP: keuzescherm; geen extra factor met alleen de e-mailcode (TOTP-pagina stuurt door naar passkey)", async ({ page }) => {
    const { user } = await seedTotpUser(`Keuze ${Date.now()}`);
    await prisma.webAuthnCredential.create({ data: { userId: user.id, credentialId: `keuze-${Date.now()}`, publicKey: Buffer.from([1, 2, 3]) } });
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await expect(page.getByText(/Hoe wil je bevestigen/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Met een passkey" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Met een authenticator-app" })).toBeVisible();

    // Gebruiker met alleen een passkey kan met de e-mailcode geen TOTP bijzetten
    const { user: passkeyUser } = await createE2eUser("HOGERAAD", `Alleen passkey ${Date.now()}`, { mfaEnabled: true });
    await prisma.webAuthnCredential.create({ data: { userId: passkeyUser.id, credentialId: `ap-${Date.now()}`, publicKey: Buffer.from([1, 2, 3]) } });
    await page.context().clearCookies();
    await startLogin(page, passkeyUser.id);
    await page.goto("/mfa/totp");
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await expect(page.getByAltText(/QR-code/)).toHaveCount(0);
    expect(await prisma.totpCredential.count({ where: { userId: passkeyUser.id } })).toBe(0);
  });

  test("eerste inschrijving tijdens inloggen kan alleen zonder bestaande methode (na reset)", async ({ page }) => {
    const { user } = await createE2eUser("HOGERAAD", `Eerste ${Date.now()}`, { mfaEnabled: true });
    await addVirtualAuthenticator(page);
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await page.getByRole("link", { name: /Liever een authenticator-app/ }).click();
    await expect(page).toHaveURL(/\/mfa\/totp/);
    const secret = await secretOf(user.id);
    await page.locator("#code").fill(codeFor(secret));
    await page.getByRole("button", { name: "Bevestigen" }).click();
    await expect(page.getByText("Bewaar je herstelcodes", { exact: false })).toBeVisible();
    await expect(page.locator(".recovery-codes span")).toHaveCount(8);
    await page.getByRole("button", { name: "Ik heb mijn herstelcodes opgeslagen, ga verder" }).click();
    await expect(page).toHaveURL(/\/app/);
  });

  test("terugzetten van de vlag: bestaande TOTP-gebruiker kan weer inloggen (rondreis aan → uit → aan)", async ({ page }) => {
    const email = "roundtrip-totp@test.ringapeldoorn.nl";
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const { user: created } = await createE2eUser("HOGERAAD", "Roundtrip", { mfaEnabled: true });
      user = await prisma.user.update({ where: { id: created.id }, data: { email } });
      const { secret } = await startTotpEnrollment(user.id, user.email);
      const done = await confirmTotpEnrollment(user.id, user.email, codeFor(secret));
      expect(done.ok).toBe(true);
    }
    await releaseReplayCounter(user.id);
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/totp/);
    await submitLoginCode(page, codeFor(await secretOf(user.id)));
    await expect(page).toHaveURL(/\/app/);
  });
});

// =====================================================================================================================
// Vlag UIT
// =====================================================================================================================
test.describe("vlag uit", () => {
  test.skip(MODE !== "off", "alleen met WEB_TOTP_ENABLED uit");

  test("geen authenticator-app in het profiel; bestaande teksten blijven 'passkey'", async ({ page }) => {
    const { user } = await createE2eUser("HOGERAAD", `Uit profiel ${Date.now()}`);
    await loginWithMagicLink(page, `/auth/magic/${(await createMagicLinkToken(user.id)).rawToken}`);
    await gotoStable(page, "/profiel/beveiliging");
    await expect(page.getByRole("heading", { name: "Authenticator-app" })).toHaveCount(0);
    await expect(page.getByText(/Passkey-verificatie/).first()).toBeVisible();
  });

  test("bestaande TOTP bij een gewone gebruiker telt niet mee: geen inloggen, geen herstelcodes, duidelijke melding; geen sessie", async ({ page }) => {
    const { user, secret, recoveryCodes } = await seedTotpUser(`Uit totp ${Date.now()}`);
    await releaseReplayCounter(user.id);
    await startLogin(page, user.id);
    await expect(page.getByText(/niet beschikbaar/)).toBeVisible();
    await expect(page.locator("#code")).toHaveCount(0);

    // Directe pogingen worden server-side geweigerd
    await page.goto("/mfa/totp");
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await expect(page.locator("#recovery-code")).toHaveCount(0);
    void secret;
    void recoveryCodes;
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    expect(await prisma.session.count({ where: { userId: user.id, mfaAt: { not: null } } })).toBe(0);
  });

  test("rondreis: bestaande TOTP-gebruiker kan met vlag uit niet inloggen", async ({ page }) => {
    const user = await prisma.user.findUnique({ where: { email: "roundtrip-totp@test.ringapeldoorn.nl" } });
    test.skip(!user, "rondreisgebruiker bestaat nog niet (draai eerst de run met de vlag aan)");
    if (!user) return;
    await releaseReplayCounter(user.id);
    await startLogin(page, user.id);
    await expect(page.getByText(/niet beschikbaar/)).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("passkey-only gebruiker: inloggen en keuze onveranderd (geen keuzescherm)", async ({ page }) => {
    const { user } = await createE2eUser("HOGERAAD", `Uit passkey ${Date.now()}`, { mfaEnabled: true });
    await addVirtualAuthenticator(page);
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await expect(page.getByText(/Hoe wil je bevestigen/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /authenticator-app/ })).toHaveCount(0);
  });
});
