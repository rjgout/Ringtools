import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { createCalling } from "../src/lib/workflow";
import { loginWithMagicLink } from "./helpers/mfa";
import { createE2eUser } from "./helpers/data";

// Regression test: een ringpresidiumlid is zowel "staff" (ziet de volledige
// uitslag) als deelnemer aan de ondersteuningsronde. Eerder liet de detailpagina een staff-lid
// nooit zijn eigen ondersteuningsknoppen zien. Deze test gaat via de echte browser-UI
// (met een geldige, programmatisch aangemaakte magic-link-token in plaats
// van een echte e-mail) door de volledige inlog- en ondersteuningsflow heen.

test("een ringpresidiumlid kan via de detailpagina zelf zijn presidiumondersteuning uitbrengen", async ({ page }) => {
  // Eigen ring per test: onafhankelijk van wat andere runs hebben achtergelaten.
  const { user: president, ringId } = await createE2eUser("RINGPRESIDIUM", `President E2E`);

  const calling = await createCalling({
    ringId,
    personName: "E2E Testpersoon",
    functionTitle: "Testfunctie",
    createdById: president.id,
  });

  const { rawToken } = await createMagicLinkToken(president.id);

  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
  await expect(page).toHaveURL(new RegExp(`/roepingen/${calling.id}`));

  // De volledige uitslag (staff-weergave) EN de eigen ondersteuningsknoppen moeten
  // allebei zichtbaar zijn voor een ringpresidiumlid.
  const voteSection = page.locator("section", { hasText: "Ondersteuningsronde ringpresidium" });
  await expect(voteSection.getByText(president.name, { exact: true })).toBeVisible();
  await expect(voteSection.getByRole("button", { name: /Ondersteunen/ })).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/roepingen/${calling.id}`)),
    voteSection.getByRole("button", { name: "👍 Ondersteunen" }).click(),
  ]);
  await page.waitForLoadState("networkidle");

  const updated = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
  // Presidium akkoord: nooit automatisch goedgekeurd (ook niet zonder hogeraadsleden) en geen automatische doorstart.
  expect(updated.status).toBe("PRESIDIUM_APPROVED");

  await expect(page.getByText("Presidium akkoord – wacht op vrijgave aan de hoge raad").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Vrijgeven aan de hoge raad" })).toBeVisible();
});
