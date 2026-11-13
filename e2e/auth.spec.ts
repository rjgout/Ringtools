import { test, expect } from "@playwright/test";

test("niet-ingelogde gebruiker wordt naar de inlogpagina gestuurd", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("de admin (webmin) kan inloggen met gebruikersnaam, wachtwoord en TOTP", async ({ page }) => {
  await loginAsAdmin(page, "webmin", "e2e-test-wachtwoord-123");
  await expect(page.getByRole("heading", { name: "Welkom, webmin" })).toBeVisible();
});

// Dat een identiteitsbevestiging alléén (zonder afgeronde MFA) geen
// toegang geeft, wordt hier niet apart met een admin-login getest (dat zou
// de rate-limit op admin-inlogpogingen onnodig belasten): zie
// tests/mfa.test.ts (exacte, deterministische dekking op sessieniveau) en
// e2e/mfa.spec.ts ("een magic link alleen geeft geen toegang...") voor de
// reguliere-gebruikersvariant van precies dit scenario.

test("fout wachtwoord wordt geweigerd", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("dit-is-fout");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();

  await expect(page.getByText("Onjuiste gebruikersnaam of wachtwoord.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

// Gebruikers- en ringbeheer door de webmin wordt gedekt in e2e/rings.spec.ts
// (ring aanmaken met eerste ringbeheerder), om de rate-limit op
// admin-inlogpogingen niet onnodig te belasten.

// Uitloggen (veilig, met serversessie-intrekking) wordt gedekt in e2e/webApp.spec.ts.
