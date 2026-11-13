import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { loginWithMagicLink } from "./helpers/mfa";
import { createE2eUser } from "./helpers/data";

async function openMeldingen(page: import("@playwright/test").Page) {
  await page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: /Meldingen/ }).click();
  await expect(page.getByRole("heading", { name: "Meldingen", level: 1 })).toBeVisible();
}

async function loginAsFreshUser(page: import("@playwright/test").Page, name: string) {
  const { user, ringId } = await createE2eUser("HOGERAAD", name);
  const { rawToken } = await createMagicLinkToken(user.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  await expect(page).toHaveURL(/\/app/);
  return { ...user, ringId };
}

test("de notificatiebel toont een lege status als er geen meldingen zijn", async ({ page }) => {
  await loginAsFreshUser(page, `Leeg${Date.now()}`);

  await openMeldingen(page);
  await expect(page.getByText("Geen meldingen.")).toBeVisible();
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
      ringId: user.ringId,
      createdById: user.id,
      status: "APPROVED",
      approvedAt: new Date(), executionReleasedAt: new Date(), executionRevision: 1, executionGeneration: 1,
      roepenAssigneeId: user.id,
    },
  });
  const delivery = await prisma.taskNotification.create({ data: { callingId: calling.id, userId: user.id, task: "ROEPEN", revision: 1, releaseGeneration: 1, state: "SENT", sentAt: new Date() } });
  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        ringId: user.ringId,
        type: "TASK_ASSIGNED",
        taskNotificationId: delivery.id,
        title: "Nieuwe taak toegewezen",
        message: "Er is een taak aan je toegewezen.",
        targetUrl: `/roepingen/${calling.id}`,
        callingId: calling.id,
      },
      {
        userId: user.id,
        ringId: user.ringId,
        type: "TASK_COMPLETED",
        title: "Taak afgerond",
        message: "Een toegewezen taak is afgerond.",
        targetUrl: `/roepingen/${calling.id}`,
        callingId: calling.id,
      },
    ],
  });

  await page.reload();
  await openMeldingen(page);
  await expect(page.getByText("Nieuwe taak toegewezen")).toBeVisible();
  await expect(page.getByText("Taak afgerond")).toBeVisible();

  // Een melding openen navigeert naar het voorstel.
  await page.getByText("Nieuwe taak toegewezen").click();
  await expect(page).toHaveURL(new RegExp(`/app#/roepingen/${calling.id}`));
  await expect(page.getByRole("heading", { name: "Testpersoon" })).toBeVisible();
});

test("alle meldingen als gelezen markeren werkt", async ({ page }) => {
  const user = await loginAsFreshUser(page, `AllesGelezen${Date.now()}`);
  await prisma.notification.createMany({
    data: [
      { userId: user.id, ringId: user.ringId, type: "REMINDER_30_DAYS", title: "A", message: "a", targetUrl: "/dashboard" },
      { userId: user.id, ringId: user.ringId, type: "REMINDER_30_DAYS", title: "B", message: "b", targetUrl: "/dashboard" },
    ],
  });

  await page.reload();
  await openMeldingen(page);
  await page.getByRole("button", { name: "Alles gelezen" }).click();
  await expect
    .poll(async () => prisma.notification.count({ where: { userId: user.id, readAt: null } }))
    .toBe(0);
});
