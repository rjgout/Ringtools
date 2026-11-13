import { test, expect, type Page } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { createE2eUser } from "./helpers/data";
import { addVirtualAuthenticator, loginWithMagicLink, logoutFromApp, gotoStable } from "./helpers/mfa";
import { codeFor, seedTotpUser, releaseReplayCounter, startLogin, fakePasskeyRow } from "./helpers/totp";

/**
 * E2.2 – MFA-methodekeuze bij het inloggen. Draait met `E2E_WEB_TOTP=on` of `off` (server met dezelfde WEB_TOTP_ENABLED).
 */
const MODE = process.env.E2E_WEB_TOTP === "on" ? "on" : process.env.E2E_WEB_TOTP === "off" ? "off" : null;
test.skip(MODE === null, "Zet E2E_WEB_TOTP=on of off (en start de server met dezelfde WEB_TOTP_ENABLED-waarde).");

async function logout(page: Page) {
  await logoutFromApp(page);
}

async function submitTotp(page: Page, userId: string, secret: string) {
  await releaseReplayCounter(userId);
  await page.locator("#code").fill(codeFor(secret));
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
}

/** Gebruiker met een echte (virtuele) passkey ÉN een authenticator-app, uitgelogd en klaar voor een nieuwe inlog. */
async function userWithBoth(page: Page, name: string) {
  const { user, secret } = await seedTotpUser(name);
  await startLogin(page, user.id);
  await addVirtualAuthenticator(page);
  await submitTotp(page, user.id, secret);
  await gotoStable(page, "/profiel/beveiliging");
  await page.getByRole("button", { name: "Passkey toevoegen" }).click();
  await page.getByRole("button", { name: "Passkey registreren" }).click();
  await expect.poll(async () => prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(1);
  await logout(page);
  return { user, secret };
}

test.describe("vlag aan", () => {
  test.skip(MODE !== "on", "alleen met WEB_TOTP_ENABLED=true");

  test("alleen een passkey: direct passkeyverificatie, geen keuzescherm", async ({ page }) => {
    const { user } = await createE2eUser("HOGERAAD", `Keuze passkey ${Date.now()}`);
    await loginWithMagicLink(page, `/auth/magic/${(await createMagicLinkToken(user.id)).rawToken}`);
    await gotoStable(page, "/profiel/beveiliging");
    await page.getByRole("button", { name: "Passkey toevoegen" }).click();
    await page.getByRole("button", { name: "Passkey registreren" }).click();
    await expect(page.getByRole("button", { name: "Verificatie inschakelen" })).toBeEnabled();
    await page.getByRole("button", { name: "Verificatie inschakelen" }).click();
    await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true);
    await logout(page);

    await startLogin(page, user.id);
    await expect(page.getByTestId("mfa-chooser")).toHaveCount(0);
    await expect(page).toHaveURL(/\/app/); // passkey automatisch bevestigd
  });

  test("alleen een authenticator-app: direct TOTP, geen keuzescherm of wisselknop", async ({ page }) => {
    const { user, secret } = await seedTotpUser(`Keuze totp ${Date.now()}`);
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/totp/);
    await expect(page.getByTestId("mfa-chooser")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Een andere methode kiezen" })).toHaveCount(0);
    await submitTotp(page, user.id, secret);
  });

  test("beide methoden: keuzescherm met passkey als voorkeur; wisselen zonder nieuwe e-mailcode", async ({ page }) => {
    const { user, secret } = await userWithBoth(page, `Keuze beide ${Date.now()}`);

    // 1) keuzescherm; passkey aanbevolen
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await expect(page.getByTestId("mfa-chooser")).toBeVisible();
    await expect(page.getByText(/Aanbevolen/)).toBeVisible();
    // zonder verificatie geen toegang (geen e-mail-only terugval)
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    // 2) kies passkey
    await startLogin(page, user.id);
    await page.getByRole("link", { name: /Met een passkey/ }).click();
    await expect(page).toHaveURL(/\/app/);
    await logout(page);

    // 3) kies authenticator-app
    await startLogin(page, user.id);
    await page.getByRole("link", { name: /Met een authenticator-app/ }).click();
    await expect(page).toHaveURL(/\/mfa\/totp/);
    await submitTotp(page, user.id, secret);
    await logout(page);

    // 4) begin met passkey-pagina en wissel naar TOTP zonder nieuwe e-mailcode
    await startLogin(page, user.id);
    // de automatische passkey-ceremonie laten we hier mislukken (de gebruiker kiest liever een andere methode)
    await page.route("**/api/webauthn/authenticate/options", (route) => route.abort());
    await page.goto("/mfa/passkey?methode=passkey");
    await expect(page.locator("p[role=alert]")).toContainText("niet gelukt");
    await page.unroute("**/api/webauthn/authenticate/options");
    await page.getByRole("link", { name: /Een andere methode gebruiken/ }).click();
    await expect(page).toHaveURL(/\/mfa\/totp/);
    // 5) en terug via de TOTP-pagina naar het keuzescherm
    await page.getByRole("link", { name: "Een andere methode kiezen" }).click();
    await expect(page.getByTestId("mfa-chooser")).toBeVisible();
    await page.getByRole("link", { name: /Met een authenticator-app/ }).click();
    await submitTotp(page, user.id, secret);
  });

  test("passkey mislukt of geannuleerd: begrijpelijke melding, geen blokkade, daarna TOTP", async ({ page }) => {
    const { user, secret } = await seedTotpUser(`Keuze annuleren ${Date.now()}`);
    await fakePasskeyRow(user.id); // passkey bestaat, maar de authenticator kent hem niet -> ceremonie mislukt
    await startLogin(page, user.id);
    await addVirtualAuthenticator(page);
    await page.goto("/mfa/passkey?methode=passkey");
    const alert = page.locator("p[role=alert]");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/NotAllowed|Error|undefined|stack/i);
    await expect(alert).toContainText(/geannuleerd|verlopen|niet gelukt|kon niet|niet bekend/i);
    // opnieuw proberen blijft mogelijk (geen blokkade) ...
    await expect(page.getByRole("button", { name: "Opnieuw proberen" })).toBeEnabled();
    // ... en een andere methode kan zonder nieuwe e-mailcode
    await page.getByRole("link", { name: /Een andere methode gebruiken/ }).click();
    await expect(page).toHaveURL(/\/mfa\/totp/);
    await submitTotp(page, user.id, secret);
  });

  test("verlopen inlogsessie: melding en terug naar inloggen; ongeldige TOTP-code blokkeert de passkeyroute niet", async ({ page }) => {
    const { user, secret } = await seedTotpUser(`Keuze verlopen ${Date.now()}`);
    await fakePasskeyRow(user.id);
    await startLogin(page, user.id);

    // Ongeldige code: afgewezen, wisselen naar passkey-keuze blijft kan
    await page.goto("/mfa/totp");
    await releaseReplayCounter(user.id);
    await page.locator("#code").fill("000000");
    await page.getByRole("button", { name: "Inloggen", exact: true }).click();
    await expect(page.getByText("Ongeldige code.")).toBeVisible();
    await page.getByRole("link", { name: "Een andere methode kiezen" }).click();
    await expect(page.getByTestId("mfa-chooser")).toBeVisible();

    // Sessie verloopt tijdens de ceremonie (API geeft 401): duidelijke melding, geen toegang
    await page.route("**/api/webauthn/authenticate/options", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Niet ingelogd." }) }));
    await page.goto("/mfa/passkey?methode=passkey");
    await expect(page.locator("p[role=alert]")).toContainText("Je inlogsessie is verlopen");
    await expect(page.getByRole("link", { name: "Opnieuw inloggen" })).toBeVisible();
    await page.unroute("**/api/webauthn/authenticate/options");

    // Echt verlopen: pagina's sturen naar inloggen, API's weigeren
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await page.goto("/mfa/passkey");
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.post("/api/webauthn/authenticate/options")).status()).toBe(401);
    void secret;
  });

  test("bestaand MFA-account zonder voltooide verificatie krijgt geen toegang en kan geen methode bijzetten", async ({ page }) => {
    const { user } = await seedTotpUser(`Keuze geen terugval ${Date.now()}`);
    await fakePasskeyRow(user.id);
    await startLogin(page, user.id);
    for (const path of ["/dashboard", "/profiel/beveiliging", "/roepingen"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await startLogin(page, user.id);
    }
    expect((await page.request.post("/api/webauthn/register/options")).status()).toBe(403);
    await page.goto("/mfa/totp"); // geen QR/inschrijving: er bestaat al een methode
    await expect(page.getByAltText(/QR-code/)).toHaveCount(0);
  });

  test("profiel: overzicht van ingestelde methoden", async ({ page }) => {
    const { user } = await userWithBoth(page, `Keuze profiel ${Date.now()}`);
    await startLogin(page, user.id);
    await page.getByRole("link", { name: /Met een passkey/ }).click();
    await expect(page).toHaveURL(/\/app/);
    await gotoStable(page, "/profiel/beveiliging");
    const overview = page.getByTestId("methods-overview");
    await expect(overview).toContainText("Passkey: 1 geregistreerd");
    await expect(overview).toContainText("Authenticator-app: ingesteld");
  });
});

test.describe("vlag uit", () => {
  test.skip(MODE !== "off", "alleen met WEB_TOTP_ENABLED uit");

  test("passkey én TOTP-rij aanwezig: direct passkeyverificatie, geen keuzescherm of verwijzing naar de authenticator-app", async ({ page }) => {
    const { user } = await seedTotpUser(`Uit beide ${Date.now()}`);
    await fakePasskeyRow(user.id);
    await startLogin(page, user.id);
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await expect(page.getByTestId("mfa-chooser")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Bevestig met je passkey" })).toBeVisible();
    await expect(page.getByRole("link", { name: /authenticator/i })).toHaveCount(0);
    await page.goto("/mfa/totp");
    await expect(page).toHaveURL(/\/mfa\/passkey/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("alleen TOTP-rij: niet beschikbaar, geen inschrijving en geen e-mail-only toegang", async ({ page }) => {
    const { user } = await seedTotpUser(`Uit totp ${Date.now()}`);
    await startLogin(page, user.id);
    await expect(page.getByText(/niet beschikbaar/)).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});
