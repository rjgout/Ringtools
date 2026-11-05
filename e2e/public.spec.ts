import { test, expect } from "@playwright/test";
import { createMagicLinkToken } from "../src/lib/auth";
import { createE2eUser } from "./helpers/data";
import { loginWithMagicLink } from "./helpers/mfa";

test("de publieke startpagina legt Ringtools uit en heeft een duidelijke knop Inloggen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ringtools" })).toBeVisible();
  await expect(page.getByText(/roepingen en ontheffingen/).first()).toBeVisible();
  await expect(page.getByText(/primaire platform/)).toBeVisible();
  await expect(page.getByTestId("login-button")).toBeVisible();
  // Geen ingelogde of persoonlijke gegevens op de publieke pagina.
  await expect(page.getByText(/dashboard|uitloggen/i)).toHaveCount(0);

  await page.getByTestId("login-button").click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("E-mailadres")).toBeVisible();
});

for (const [path, heading] of [
  ["/privacy", "Privacy"],
  ["/contact", "Contact"],
  ["/accountverwijdering", "Accountverwijdering"],
] as const) {
  test(`${path} is openbaar bereikbaar zonder in te loggen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByTestId("login-button")).toBeVisible();
  });
}

test("de startpagina past op een telefoonscherm zonder horizontaal scrollen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.getByTestId("login-button")).toBeVisible();
});

test("een bestaande sessie gaat vanaf de startpagina direct naar het overzicht (webapp blijft werken)", async ({ page }) => {
  const { user } = await createE2eUser("RINGSECRETARIS", `Startpagina ${Date.now()}`);
  const { rawToken } = await createMagicLinkToken(user.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard/);
});
