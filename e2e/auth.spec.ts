import { test, expect } from "@playwright/test";

test("niet-ingelogde gebruiker wordt naar de inlogpagina gestuurd", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("de admin (webmin) kan inloggen met gebruikersnaam en wachtwoord", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("e2e-test-wachtwoord-123");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Welkom, webmin" })).toBeVisible();
});

test("fout wachtwoord wordt geweigerd", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("dit-is-fout");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();

  await expect(page.getByText("Onjuiste gebruikersnaam of wachtwoord.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("admin kan een nieuwe gebruiker aanmaken via gebruikersbeheer", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("e2e-test-wachtwoord-123");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const uniqueEmail = `test.presidiumlid.${Date.now()}@e2e.ringapeldoorn.nl`;

  await page.goto("/gebruikers");
  const createForm = page.locator('form[data-testid="create-user-form"]');
  await createForm.locator('input[name="name"]').fill("Test Presidiumlid");
  await createForm.locator('input[name="email"]').fill(uniqueEmail);
  await createForm.locator('select[name="role"]').selectOption("RINGPRESIDIUM");
  await createForm.locator('button[type="submit"]').click();

  await expect(page.getByText("is aangemaakt.")).toBeVisible();
  await expect(page.getByText(uniqueEmail)).toBeVisible();
});

test("uitloggen werkt en blokkeert daarna weer toegang", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill("webmin");
  await page.getByLabel("Wachtwoord").fill("e2e-test-wachtwoord-123");
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
