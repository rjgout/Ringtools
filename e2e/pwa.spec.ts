import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/mfa";

test("het Web App Manifest bevat de vereiste velden", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();

  expect(manifest.name).toBe("Ringtools");
  expect(manifest.short_name).toBe("Ringtools");
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toBeTruthy();
  expect(manifest.background_color).toBeTruthy();

  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");

  const maskable = manifest.icons.filter((i: { purpose?: string }) => i.purpose === "maskable");
  expect(maskable.length).toBeGreaterThan(0);

  await page.goto("/login");
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("de offline-pagina en service worker zijn bereikbaar", async ({ request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBeTruthy();
  expect(await sw.text()).toContain("self.addEventListener");

  const offline = await request.get("/offline.html");
  expect(offline.ok()).toBeTruthy();
});

test("de service worker registreert zich in de browser", async ({ page }) => {
  await page.goto("/login");
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(registered).toBe(true);
});

test("werkt zonder Push-ondersteuning in de browser", async ({ page }) => {
  // Simuleer een browser zonder Push API: de pagina mag niet crashen.
  await page.addInitScript(() => {
    // @ts-expect-error - bewust verwijderen voor deze test
    delete window.PushManager;
  });

  await loginAsAdmin(page, "webmin", "e2e-test-wachtwoord-123");

  await page.goto("/profiel");
  await expect(page.getByRole("heading", { name: "Pushnotificaties" })).toBeVisible();
  await expect(page.getByText("browser ondersteunt geen pushnotificaties")).toBeVisible();
});
