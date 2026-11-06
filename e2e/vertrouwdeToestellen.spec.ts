import { test, expect } from "@playwright/test";
import crypto from "crypto";
import { prisma } from "../src/lib/prisma";
import { completePairing, registrationMessage } from "../src/lib/trustedDevices";
import { codeFor, seedTotpUser, releaseReplayCounter, startLogin } from "./helpers/totp";

/**
 * E2.3 – vertrouwde toestellen op het web. Draait met `E2E_TRUSTED_DEVICES=on` of `off` (server met dezelfde TRUSTED_DEVICES_ENABLED).
 * Beide modi vereisen `WEB_TOTP_ENABLED=true` op de server: de testgebruiker meldt zich aan met een authenticator-app.
 */
const MODE = process.env.E2E_TRUSTED_DEVICES === "on" ? "on" : process.env.E2E_TRUSTED_DEVICES === "off" ? "off" : null;
test.skip(MODE === null, "Zet E2E_TRUSTED_DEVICES=on of off (en start de server met dezelfde TRUSTED_DEVICES_ENABLED-waarde).");
// Ongeldige combinatie, geen productfout: de testgebruiker meldt zich aan met een authenticator-app. Deze spec draait daarom alleen met E2E_WEB_TOTP=on;
// de dekking van "vertrouwde toestellen uit" komt uit de configuratie WEB_TOTP aan + TRUSTED uit (zie docs/E2-6-KWALITEITSRONDE.md).
test.skip(process.env.E2E_WEB_TOTP !== "on", "Vereist E2E_WEB_TOTP=on (ongeldige vlagcombinatie voor deze spec).");

async function loginWithTotp(page: import("@playwright/test").Page, name: string) {
  const { user, secret } = await seedTotpUser(name);
  await startLogin(page, user.id);
  await releaseReplayCounter(user.id);
  await page.locator("#code").fill(codeFor(secret));
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return user;
}

test.describe("vlag aan", () => {
  test.skip(MODE !== "on");

  test("koppelcode tonen, in de app 'claimen', toestel zien en intrekken", async ({ page, request }) => {
    const user = await loginWithTotp(page, "Toestel Web Een");
    await page.goto("/profiel/beveiliging");
    await expect(page.getByRole("heading", { name: "Vertrouwde toestellen" })).toBeVisible();
    await expect(page.getByText("Geen gekoppelde toestellen.")).toBeVisible();
    await page.getByRole("button", { name: "Nieuw toestel koppelen" }).click();
    const code = (await page.getByTestId("pairing-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const claim = await request.post("/api/mobile/v1/trusted-devices/pair/claim", { data: { code } });
    expect(claim.status()).toBe(200);
    const c = await claim.json();
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const installationId = crypto.randomBytes(16).toString("hex");
    await completePairing({
      registrationToken: c.registrationToken,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      signature: crypto.sign("sha256", Buffer.from(registrationMessage(c.challenge, installationId)), { key: privateKey, dsaEncoding: "der" }).toString("base64"),
      installationId,
      platform: "IOS",
      label: "Test-iPhone",
    });
    // hergebruik van dezelfde code mislukt
    expect((await request.post("/api/mobile/v1/trusted-devices/pair/claim", { data: { code } })).status()).toBe(400);

    await page.reload();
    await expect(page.getByText("Test-iPhone")).toBeVisible();
    await page.getByRole("button", { name: "Intrekken" }).click();
    await expect(page.getByText("Toestel ingetrokken.")).toBeVisible();
    await expect.poll(async () => (await prisma.trustedDevice.findFirst({ where: { userId: user.id } }))?.revokedAt != null).toBe(true);
  });
});

test.describe("vlag uit", () => {
  test.skip(MODE !== "off");

  test("geen paneel en de API-routes bestaan niet", async ({ page, request }) => {
    await loginWithTotp(page, "Toestel Web Twee");
    await page.goto("/profiel/beveiliging");
    await expect(page.getByRole("heading", { name: "Beveiliging", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vertrouwde toestellen" })).toHaveCount(0);
    expect((await request.post("/api/mobile/v1/trusted-devices/pair/claim", { data: { code: "AAAA-BBBB-CCCC" } })).status()).toBe(404);
  });
});
