import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createVerifiedSession, SESSION_COOKIE_NAME } from "../src/lib/auth";
import { provisionReviewDemo, resetReviewDemo } from "../src/lib/reviewDemo";
import { createE2eUser } from "./helpers/data";
const passwords = [1,2,3].map(() => randomBytes(24).toString("base64url"));
async function administrator() { return prisma.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } }); }

test("beveiligd webbeheer provisiont en herstelt demo; reviewAPI bewaakt rollen en ringisolatie", async ({ page, request }) => {
  const admin = await administrator();
  const s = await createVerifiedSession(admin.id);
  await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: s.rawToken, url: test.info().project.use.baseURL as string }]);
  await page.goto("/instellingen/review");
  for (let i=0;i<3;i++) await page.getByLabel(`Nieuw wachtwoord Apple Review ${i+1}`).fill(passwords[i]);
  await page.getByRole("button", { name: "Reviewaccounts opslaan" }).click();
  await expect(page.getByText(/Reviewaccounts opgeslagen/)).toBeVisible();
  await page.getByLabel("Typ Ringtools Demo").fill("Ringtools Demo");
  await page.getByRole("button", { name: "Demo herstellen", exact: true }).click();
  await expect(page.getByText(/fictieve demo is hersteld/)).toBeVisible();
  const other = await createE2eUser("HOGERAAD", "Fictieve andere tenant");
  for (let i=0;i<3;i++) {
    const login = await request.post("/api/mobile/v1/auth/review/login", { data: { email: `apple.review${i+1}@ringtools.invalid`, password: passwords[i] } });
    expect(login.status()).toBe(200);
    const body = await login.json();
    expect(body.user.reviewAccount).toBe(true);
    expect(body.rings).toHaveLength(1); expect(body.rings[0].name).toBe("Ringtools Demo");
    const denied = await request.get(`/api/mobile/v1/dashboard?ring=${other.ringId}`, { headers: { Authorization: `Bearer ${body.token}` } });
    expect(denied.status()).toBe(404);
  }
});

test("gebruiker vraagt volledig verwijderen aan; beheer verwerkt; ontvangstbewijs bevestigt zonder login", async ({ page }) => {
  const { user } = await createE2eUser("HOGERAAD", `Fictieve verwijderaar ${Date.now()}`);
  const s = await createVerifiedSession(user.id);
  const url = test.info().project.use.baseURL as string;
  await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: s.rawToken, url }]);
  await page.goto("/accountverwijdering");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accountverwijdering aanvragen" }).click();
  await expect(page.getByText("Ontvangen", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText("Ontvangen", { exact: true })).toBeVisible();
  const admin = await administrator();
  const adminSession = await createVerifiedSession(admin.id);
  await page.context().addCookies([{ name: SESSION_COOKIE_NAME, value: adminSession.rawToken, url }]);
  await page.goto("/instellingen/review");
  const row = page.getByRole("article").filter({ hasText: user.name });
  await row.getByRole("checkbox").check();
  await row.getByRole("button", { name: "Volledig account verwijderen" }).click();
  await expect(row).toHaveCount(0);
  expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  await page.context().clearCookies({ name: SESSION_COOKIE_NAME });
  await page.goto("/accountverwijdering");
  await expect(page.getByText("Account verwijderd", { exact: true })).toBeVisible();
});

test("mobiele demo en privacy werken met echte backend op telefoon en tablet", async ({ page }) => {
  test.skip(!process.env.E2E_MOBILE_URL, "Start de Vite-client en wijs E2E_MOBILE_URL aan voor deze aanvullende browsercontrole.");
  const admin = await administrator(); await provisionReviewDemo(admin.id, passwords); await resetReviewDemo(admin.id);
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto(process.env.E2E_MOBILE_URL!);
  await page.getByRole("button", { name: "Demoaccount", exact: true }).click();
  await page.getByLabel("E-mailadres").fill("apple.review1@ringtools.invalid");
  await page.getByLabel("Wachtwoord", { exact: true }).fill(passwords[0]);
  await page.getByRole("button", { name: "Aanmelden", exact: true }).click();
  await expect(page.getByText("Ringtools Demo", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wacht op jouw reactie", exact: true })).toBeVisible();
  if (process.env.E2E_SCREENSHOTS === "on") await page.screenshot({ path: "docs/app-store/screenshots/browser-demo-telefoon.png", fullPage: true });
  await page.setViewportSize({ width: 1024, height: 1366 });
  if (process.env.E2E_SCREENSHOTS === "on") await page.screenshot({ path: "docs/app-store/screenshots/browser-demo-tablet.png", fullPage: true });
  await page.getByRole("link", { name: "Profiel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account en privacy", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Account verwijderen aanvragen…" }).click();
  await page.getByRole("button", { name: "Verwijdering aanvragen", exact: true }).click();
  await expect(page.getByText("Ontvangen", { exact: true })).toBeVisible();
});
