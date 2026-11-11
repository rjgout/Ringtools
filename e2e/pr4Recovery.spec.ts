import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createVerifiedSession, SESSION_COOKIE_NAME } from "../src/lib/auth";
import { provisionReviewDemo } from "../src/lib/reviewDemo";
import { createE2eUser } from "./helpers/data";
const passwords = () => [1,2,3].map(() => randomBytes(24).toString("base64url"));

test("gewone gebruiker bewerken werkt; gemanipuleerde demo-mutatie geeft Nederlandse fout zonder serverfout", async ({ page }) => {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } });
  const { ringId: demoId } = await provisionReviewDemo(admin.id, passwords());
  const review = await prisma.ringMembership.findFirstOrThrow({ where: { ringId: demoId } });
  const { user, ringId } = await createE2eUser("HOGERAAD", `Fictief normaal lid ${Date.now()}`);
  const session = await createVerifiedSession(admin.id);
  await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: session.rawToken, url: test.info().project.use.baseURL as string }]);
  await page.goto(`/ringen/${ringId}`);
  await page.locator("summary").filter({ hasText: user.name }).click();
  const edit = page.locator("details[open] form").filter({ has: page.locator('input[name="membershipId"]') });
  await edit.locator('input[name="churchFunction"]').fill("Fictieve functie");
  await edit.locator('input[name="isRingManager"]').check();
  await edit.getByRole("button", { name: "Opslaan", exact: true }).click();
  await expect(edit.getByText("Opgeslagen.")).toBeVisible();
  expect((await prisma.ringMembership.findFirstOrThrow({ where: { userId: user.id, ringId } })).isRingManager).toBe(true);
  await edit.locator('input[name="membershipId"]').evaluate((node, id) => { (node as HTMLInputElement).value = id; }, review.id);
  await edit.getByRole("button", { name: "Opslaan", exact: true }).click();
  await expect(edit.getByText(/App Review/)).toBeVisible();
  await expect(page.getByText(/This page couldn't load|A server error occurred|23514|PrismaClient/)).toHaveCount(0);
  expect((await prisma.ringMembership.findUniqueOrThrow({ where: { id: review.id } })).isRingManager).toBe(false);
  await page.goto(`/ringen/${demoId}`);
  await expect(page.getByRole("link", { name: /Beheer reviewaccounts/ })).toBeVisible();
  await page.locator("summary").first().click();
  await expect(page.locator('input[name="membershipId"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /reset|Opslaan|toevoegen/i })).toHaveCount(0);
});

test("compacte aanmeldlinks behouden aanraakgebied, kleurmodi, grote tekst en navigatie", async ({ page }) => {
  test.skip(!process.env.E2E_MOBILE_URL, "Gebundelde mobiele client nodig");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(process.env.E2E_MOBILE_URL!);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const size of ["16px", "32px"]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = size; }, size);
      for (const name of ["Demoaccount", "Account en privacy"]) {
        const link = name === "Demoaccount" ? page.getByRole("button", { name, exact: true }) : page.getByRole("link", { name, exact: true });
        await expect(link).toBeVisible();
        const box = await link.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(await link.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.getByRole("button", { name: "Demoaccount", exact: true }).click();
  await expect(page.getByLabel("Wachtwoord", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Terug naar normaal aanmelden" }).click();
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Account en privacy", exact: true }).click();
  await expect(await popup).toHaveURL(/accountverwijdering/);
});

test("Review 3 opent alleen-lezen beheerdemonstratie via profiel zonder ringbeheerrechten", async ({ page }) => {
  test.skip(!process.env.E2E_MOBILE_URL, "Mobiele client nodig");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } }); const secrets = passwords();
  await provisionReviewDemo(admin.id, secrets);
  await page.goto(process.env.E2E_MOBILE_URL!);
  await page.getByRole("button", { name: "Demoaccount", exact: true }).click();
  await page.getByLabel("E-mailadres").fill("apple.review3@ringtools.invalid");
  await page.getByLabel("Wachtwoord", { exact: true }).fill(secrets[2]);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
  await page.getByRole("link", { name: "Profiel", exact: true }).click();
  await page.getByRole("link", { name: "Gebruikersbeheer – demo", exact: true }).click();
  await expect(page.locator("strong").filter({ hasText: /^Apple Review 1$/ })).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: /^Apple Review 2$/ })).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: /^Apple Review 3$/ })).toBeVisible();
  await expect(page.getByText(/Je krijgt geen ringbeheerrechten/)).toBeVisible();
  await expect(page.getByRole("button", { name: /toevoegen|Opslaan|uitnodigen/i })).toHaveCount(0);
});


test("reviewcookie kan geen web-MFA inschrijven; beveiligingspagina blijft begrijpelijk", async ({ page }) => {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } });
  await provisionReviewDemo(admin.id, passwords());
  const review = await prisma.user.findUniqueOrThrow({ where: { email: "apple.review1@ringtools.invalid" } });
  const s = await createVerifiedSession(review.id);
  await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: s.rawToken, url: test.info().project.use.baseURL as string }]);
  await page.goto("/profiel/beveiliging");
  await expect(page.getByRole("heading", { name: "Beveiliging demoaccount" })).toBeVisible();
  await expect(page.getByRole("button", { name: /inschrijven|inschakelen|toevoegen/ })).toHaveCount(0);
  const denied = await page.request.post("/api/webauthn/register/options"); expect(denied.status()).toBe(401);
  expect(await prisma.webAuthnCredential.count({ where: { userId: review.id } })).toBe(0);
});
