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

test("een ringbeheerder beheert alleen de eigen ring in /app en ziet geen andere ringen of rechtstreeks toevoegen", async ({ page }) => {
  const { user: manager } = await createE2eUser("RINGSECRETARIS", `Beheerder ${Date.now()}`, { isRingManager: true });
  const { user: foreign } = await createE2eUser("HOGERAAD", `Elders ${Date.now()}`);
  const { rawToken } = await createMagicLinkToken(manager.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  await expect(page).toHaveURL(/\/app/);

  // Oude webadres voor gebruikersbeheer verwijst naar dezelfde interface als de app.
  await page.goto("/gebruikers");
  await expect(page).toHaveURL(/\/app#\/beheer\/gebruikers/);
  await expect(page.getByText(manager.name).first()).toBeVisible();
  await expect(page.getByText(foreign.email)).toHaveCount(0);
  await expect(page.getByText(foreign.name)).toHaveCount(0);

  // Een andere ring is niet via de URL te bereiken; het webmin-ringbeheer is voor een gewone gebruiker afgesloten.
  await page.goto("/ringen");
  await expect(page).not.toHaveURL(/\/ringen$/);
});

test("voorstel definitief verwijderen via de gedeelde interface (annuleren verwijdert niets)", async ({ page }) => {
  const { user: president, ringId } = await createE2eUser("RINGPRESIDIUM", `Voorzitter ${Date.now()}`);
  const { user: second } = await createE2eUser("RINGPRESIDIUM", `Tweede ${Date.now()}`, { ringId });
  const calling = await createCalling({ ringId, personName: "Te Verwijderen", functionTitle: "Testfunctie", createdById: president.id });
  await prisma.eligibleVoter.updateMany({ where: { callingId: calling.id }, data: { lastInvitedAt: new Date(Date.now() - 2 * 3600_000) } });

  const { rawToken } = await createMagicLinkToken(president.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
  await expect(page).toHaveURL(new RegExp(`/app#/roepingen/${calling.id}`));
  await expect(page.getByRole("heading", { name: "Te Verwijderen" })).toBeVisible();
  await expect(page.getByText(second.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/stemm|stem /i)).toHaveCount(0);

  await page.getByRole("button", { name: "Acties voor dit voorstel" }).click();
  await page.getByRole("menuitem", { name: /Voorstel verwijderen/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Annuleren" }).click();
  expect(await prisma.calling.count({ where: { id: calling.id } })).toBe(1);

  await page.getByRole("button", { name: "Acties voor dit voorstel" }).click();
  await page.getByRole("menuitem", { name: /Voorstel verwijderen/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Verwijderen", exact: true }).click();
  await expect.poll(async () => prisma.calling.count({ where: { id: calling.id } })).toBe(0);
  expect(await prisma.user.count({ where: { id: president.id } })).toBe(1);
  expect(await prisma.notification.count({ where: { callingId: calling.id } })).toBe(0);
});
