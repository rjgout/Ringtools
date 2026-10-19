import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { loginWithMagicLink } from "./helpers/mfa";

async function loginAsFreshUser(page: import("@playwright/test").Page, name: string) {
  const user = await prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}@test.ringapeldoorn.nl`,
      role: "HOGERAAD",
      active: true,
    },
  });
  const { rawToken } = await createMagicLinkToken(user.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent("/dashboard")}`);
  await expect(page).toHaveURL(/\/dashboard/);
  return user;
}

test("de notificatiebel toont een lege status als er geen meldingen zijn", async ({ page }) => {
  await loginAsFreshUser(page, `Leeg${Date.now()}`);

  const bell = page.getByRole("button", { name: "Meldingen" });
  await expect(bell).toBeVisible();
  await bell.click();

  await expect(page.getByText("Je bent helemaal bij!")).toBeVisible();
});

test("de bel toont het juiste aantal ongelezen meldingen en werkt bij het openen van een melding", async ({ page }) => {
  const user = await loginAsFreshUser(page, `Bel${Date.now()}`);

  const calling = await prisma.calling.create({
    // roepenAssigneeId = user.id: de testgebruiker moet ook daadwerkelijk
    // bevoegd zijn om deze roeping te bekijken (zoals bij een echte
    // TASK_ASSIGNED-melding), anders wijst de (terechte) autorisatiecontrole
    // op de detailpagina de toegang af.
    data: {
      personName: "Testpersoon",
      functionTitle: "Testfunctie",
      createdById: user.id,
      status: "APPROVED",
      roepenAssigneeId: user.id,
    },
  });
  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        type: "TASK_ASSIGNED",
        title: "Nieuwe taak toegewezen",
        message: "Er is een taak aan je toegewezen.",
        targetUrl: `/roepingen/${calling.id}`,
        callingId: calling.id,
      },
      {
        userId: user.id,
        type: "TASK_COMPLETED",
        title: "Taak afgerond",
        message: "Een toegewezen taak is afgerond.",
        targetUrl: `/roepingen/${calling.id}`,
        callingId: calling.id,
      },
    ],
  });

  await page.reload();
  await expect(page.getByRole("button", { name: "Meldingen, 2 ongelezen" })).toBeVisible();

  await page.getByRole("button", { name: "Meldingen, 2 ongelezen" }).click();
  await expect(page.getByText("Nieuwe taak toegewezen")).toBeVisible();
  await expect(page.getByText("Taak afgerond")).toBeVisible();

  // Een melding openen navigeert naar de doelpagina en markeert hem als gelezen.
  await page.getByText("Nieuwe taak toegewezen").click();
  await expect(page).toHaveURL(new RegExp(`/roepingen/${calling.id}`));

  const stillUnread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  expect(stillUnread).toBe(1);
});

test("alle meldingen als gelezen markeren werkt", async ({ page }) => {
  const user = await loginAsFreshUser(page, `AllesGelezen${Date.now()}`);
  await prisma.notification.createMany({
    data: [
      { userId: user.id, type: "TASK_ASSIGNED", title: "A", message: "a", targetUrl: "/dashboard" },
      { userId: user.id, type: "TASK_COMPLETED", title: "B", message: "b", targetUrl: "/dashboard" },
    ],
  });

  await page.reload();
  await page.getByRole("button", { name: "Meldingen, 2 ongelezen" }).click();
  await page.getByRole("button", { name: "Alles als gelezen markeren" }).click();

  await expect(page.getByRole("button", { name: "Meldingen" })).toBeVisible();
  // De knop verdwijnt al bij de optimistische UI-update, vóórdat de
  // server action is afgerond; poll daarom op de daadwerkelijke
  // database-status in plaats van één keer meteen te checken.
  await expect
    .poll(async () => prisma.notification.count({ where: { userId: user.id, readAt: null } }))
    .toBe(0);
});

test.describe("Mobiele interface", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("het meldingenpaneel is op mobiel bruikbaar als bottom sheet", async ({ page }) => {
    const user = await loginAsFreshUser(page, `Mobiel${Date.now()}`);
    await prisma.notification.create({
      data: { userId: user.id, type: "TASK_ASSIGNED", title: "Mobiele melding", message: "test", targetUrl: "/dashboard" },
    });

    await page.reload();
    await page.getByRole("button", { name: "Meldingen, 1 ongelezen" }).click();

    const panel = page.getByRole("dialog", { name: "Meldingen" });
    await expect(panel).toBeVisible();
    await expect(page.getByText("Mobiele melding")).toBeVisible();

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    // Bottom sheet: het paneel raakt de onderkant van het scherm.
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(844 - 2);

    // Sluitknop (alleen zichtbaar op mobiel) werkt.
    await page.getByRole("button", { name: "Sluiten" }).click();
    await expect(panel).not.toBeVisible();
  });
});
