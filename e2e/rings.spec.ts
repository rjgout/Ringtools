import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { createCalling } from "../src/lib/workflow";
import { loginAsAdmin, loginWithMagicLink } from "./helpers/mfa";
import { createE2eUser } from "./helpers/data";

test("webmin maakt een ring met een eerste ringbeheerder aan", async ({ page }) => {
  // Een TOTP-code mag niet binnen dezelfde periode hergebruikt worden: de login kan tot 30s wachten.
  test.setTimeout(90000);
  const stamp = Date.now();
  await loginAsAdmin(page, "webmin", "e2e-test-wachtwoord-123");
  await page.goto("/ringen");
  await page.waitForLoadState("networkidle");

  const form = page.getByTestId("create-ring-form");
  await form.locator('input[name="name"]').fill(`Ring E2E ${stamp}`);
  await form.locator('input[name="userName"]').fill(`Eerste Beheerder ${stamp}`);
  await form.locator('input[name="userEmail"]').fill(`eerste.${stamp}@test.ringapeldoorn.nl`);
  await form.locator('input[name="churchFunction"]').fill("Ringsecretaris");
  await form.getByRole("button", { name: "Ring aanmaken" }).click();

  await expect
    .poll(async () => prisma.ring.count({ where: { name: `Ring E2E ${stamp}` } }))
    .toBe(1);
  const membership = await prisma.ringMembership.findFirstOrThrow({
    where: { ring: { name: `Ring E2E ${stamp}` } },
  });
  expect(membership).toMatchObject({ isRingManager: true, active: true, churchFunction: "Ringsecretaris" });
});

test("een ringbeheerder voegt een gebruiker toe aan de eigen ring en ziet geen andere ringen", async ({ page }) => {
  const { user: manager, ringId } = await createE2eUser("RINGSECRETARIS", `Beheerder ${Date.now()}`, { isRingManager: true });
  const { user: foreign } = await createE2eUser("HOGERAAD", `Elders ${Date.now()}`);
  const { rawToken } = await createMagicLinkToken(manager.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/gebruikers");
  await expect(page.getByText(foreign.email)).toHaveCount(0);
  const stamp = Date.now();
  const form = page.getByTestId("create-user-form");
  await form.locator('input[name="name"]').fill(`Nieuw Lid ${stamp}`);
  await form.locator('input[name="email"]').fill(`nieuw.${stamp}@test.ringapeldoorn.nl`);
  await form.locator('input[name="churchFunction"]').fill("Hogeraadslid");
  await form.getByRole("button", { name: "Gebruiker toevoegen" }).click();

  await expect
    .poll(async () => prisma.ringMembership.count({ where: { ringId, user: { email: `nieuw.${stamp}@test.ringapeldoorn.nl` } } }))
    .toBe(1);

  // Een andere ring is niet via de URL te bereiken.
  const res = await page.goto("/ringen");
  expect(res?.url()).not.toMatch(/\/ringen$/);
});

test("herinneren en voorstel definitief verwijderen via de detailpagina", async ({ page }) => {
  const { user: president, ringId } = await createE2eUser("RINGPRESIDIUM", `Voorzitter ${Date.now()}`);
  const { user: second } = await createE2eUser("RINGPRESIDIUM", `Tweede ${Date.now()}`, { ringId });
  const calling = await createCalling({ ringId, personName: "Te Verwijderen", functionTitle: "Testfunctie", createdById: president.id });
  await prisma.eligibleVoter.updateMany({ where: { callingId: calling.id }, data: { lastInvitedAt: new Date(Date.now() - 2 * 3600_000) } });

  const { rawToken } = await createMagicLinkToken(president.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
  await expect(page).toHaveURL(new RegExp(`/roepingen/${calling.id}`));

  const section = page.locator("section", { hasText: "Ondersteuningsronde ringpresidium" });
  await expect(section.getByText(second.name, { exact: true })).toBeVisible();
  await expect(section.getByText("Nog niet gereageerd").first()).toBeVisible();
  await expect(page.getByText(/stemm|stem /i)).toHaveCount(0);

  await section.getByRole("button", { name: "Herinnering versturen" }).first().click();
  await expect
    .poll(async () => prisma.notification.count({ where: { type: "SUPPORT_REMINDER", callingId: calling.id } }))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Voorstel verwijderen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Weet je zeker dat je dit roepingsvoorstel definitief wilt verwijderen\?/)).toBeVisible();
  await dialog.getByRole("button", { name: "Annuleren" }).click();
  expect(await prisma.calling.count({ where: { id: calling.id } })).toBe(1);

  await page.getByRole("button", { name: "Voorstel verwijderen" }).click();
  await page.getByRole("button", { name: "Definitief verwijderen" }).click();
  await expect.poll(async () => prisma.calling.count({ where: { id: calling.id } })).toBe(0);
  expect(await prisma.user.count({ where: { id: president.id } })).toBe(1);
  expect(await prisma.notification.count({ where: { callingId: calling.id } })).toBe(0);
});

test.describe("Mobiel", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("de detailpagina met ondersteuningsronde en verwijderknop is op mobiel bruikbaar", async ({ page }) => {
    const { user: president, ringId } = await createE2eUser("RINGPRESIDIUM", `Mobiel ${Date.now()}`);
    const calling = await createCalling({ ringId, personName: "Mobiel", functionTitle: "F", createdById: president.id });
    const { rawToken } = await createMagicLinkToken(president.id);
    await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
    await expect(page.getByRole("button", { name: "Voorstel verwijderen" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
