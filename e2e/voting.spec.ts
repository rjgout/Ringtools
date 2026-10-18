import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { createCalling } from "../src/lib/workflow";

// Regression test: een ringpresidiumlid is zowel "staff" (ziet de volledige
// uitslag) als stemgerechtigd. Eerder liet de detailpagina een staff-lid
// nooit zijn eigen stemknoppen zien. Deze test gaat via de echte browser-UI
// (met een geldige, programmatisch aangemaakte magic-link-token in plaats
// van een echte e-mail) door de volledige inlog- en stemflow heen.

test("een ringpresidiumlid kan via de detailpagina zelf zijn presidiumstem uitbrengen", async ({ page }) => {
  // Zorg dat deze test onafhankelijk is van wat andere (e2e-)runs al in de
  // database hebben achtergelaten: de stemgerechtigden-snapshot bevat anders
  // ook oudere testgebruikers, waardoor de roeping nooit op "iedereen heeft
  // gestemd" uitkomt.
  await prisma.user.updateMany({ where: { role: "RINGPRESIDIUM" }, data: { active: false } });

  const president = await prisma.user.create({
    data: {
      name: `President E2E ${Date.now()}`,
      email: `president.e2e.${Date.now()}@test.ringapeldoorn.nl`,
      role: "RINGPRESIDIUM",
      active: true,
    },
  });

  const calling = await createCalling({
    personName: "E2E Testpersoon",
    functionTitle: "Testfunctie",
    createdById: president.id,
  });

  const { rawToken } = await createMagicLinkToken(president.id);

  await page.goto(`/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(new RegExp(`/roepingen/${calling.id}`));

  // De volledige uitslag (staff-weergave) EN de eigen stemknoppen moeten
  // allebei zichtbaar zijn voor een ringpresidiumlid.
  const voteSection = page.locator("section", { hasText: "Stemming ringpresidium" });
  await expect(voteSection.getByText(president.name, { exact: true })).toBeVisible();
  await expect(voteSection.getByRole("button", { name: /Ondersteunen/ })).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/roepingen/${calling.id}`)),
    voteSection.getByRole("button", { name: "👍 Ondersteunen" }).click(),
  ]);
  await page.waitForLoadState("networkidle");

  const updated = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
  expect(updated.status).toBe("APPROVED"); // enige stemgerechtigde, geen hogeraadsleden -> direct goedgekeurd

  await expect(page.getByText("Goedgekeurd")).toBeVisible();
});
