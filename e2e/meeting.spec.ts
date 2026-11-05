import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { createCalling } from "../src/lib/workflow";
import { loginWithMagicLink } from "./helpers/mfa";
import { createE2eUser } from "./helpers/data";

// Vergadering op een laptop: een ringsecretaris of -administrateur legt een daadwerkelijk genomen besluit vast en geeft daarna expliciet vrij.
// Alle regels zitten server-side in workflow.ts (dezelfde functies als de app).

async function meeting(role: "RINGSECRETARIS" | "RINGADMINISTRATEUR") {
  const stamp = Date.now();
  const { user: staff, ringId } = await createE2eUser(role, `Vergaderstaf ${stamp}`);
  const president = (await createE2eUser("RINGPRESIDIUM", `Vergaderpresident ${stamp}`, { ringId })).user;
  const counselor = (await createE2eUser("RINGPRESIDIUM", `Vergaderraadgever ${stamp}`, { ringId })).user;
  const hr = (await createE2eUser("HOGERAAD", `Vergaderlid ${stamp}`, { ringId })).user;
  const calling = await createCalling({ ringId, personName: "Vergadering Persoon", functionTitle: "Vergaderfunctie", createdById: staff.id });
  return { staff, president, counselor, hr, calling, ringId };
}

for (const role of ["RINGSECRETARIS", "RINGADMINISTRATEUR"] as const) {
  test(`${role}: gezamenlijk presidiumbesluit vastleggen en expliciet vrijgeven in de browser`, async ({ page }) => {
    const m = await meeting(role);
    const { rawToken } = await createMagicLinkToken(m.staff.id);
    await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${m.calling.id}`)}`);
    await expect(page.getByRole("heading", { name: "Vergadering Persoon" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ondersteuningsronde ringpresidium" })).toBeVisible();

    // Zonder verklaring en zonder aanwezige presidiumleden wordt het besluit niet vastgelegd.
    await page.getByText("Gezamenlijk akkoord ringpresidium registreren (vergadering)").click();
    const form = page.getByRole("form", { name: "Gezamenlijk akkoord ringpresidium" });
    await form.getByLabel(/akkoord bevonden/).check();
    await form.getByRole("button", { name: "Besluit vastleggen" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: m.calling.id } })).status).toBe("PRESIDIUM_VOTING");

    await form.getByLabel(m.president.name).check();
    await Promise.all([page.waitForURL(/melding=besluit-vastgelegd/), form.getByRole("button", { name: "Besluit vastleggen" }).click()]);
    await expect(page.getByText("Het gezamenlijke besluit is vastgelegd.")).toBeVisible();
    await expect(page.getByText(/Presidium akkoord – wacht op vrijgave/).first()).toBeVisible();

    const after = await prisma.calling.findUniqueOrThrow({ where: { id: m.calling.id } });
    expect(after).toMatchObject({ status: "PRESIDIUM_APPROVED", presidiumApprovalMethod: "MEETING" });
    // De registrerende secretaris/administrateur is geen ondersteuner; er zijn geen reacties namens anderen.
    expect(await prisma.vote.count({ where: { callingId: m.calling.id } })).toBe(0);
    expect(await prisma.eligibleVoter.count({ where: { callingId: m.calling.id, userId: m.staff.id } })).toBe(0);
    // Besluit is zichtbaar met de aanwezigen; de hoge raad is nog niet gevraagd.
    await expect(page.getByRole("region", { name: "Gezamenlijk besluit ringpresidium" })).toContainText(m.president.name);
    expect(await prisma.eligibleVoter.count({ where: { callingId: m.calling.id, stage: "HOGERAAD" } })).toBe(0);
    // Ringstaf kreeg de melding 'wacht op vrijgave'; de hoge raad niet.
    expect(await prisma.notification.count({ where: { callingId: m.calling.id, type: "AWAITING_RELEASE", userId: m.staff.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: m.hr.id } })).toBe(0);

    // Het besluit is eenmalig: het formulier verdwijnt. Vrijgeven is een aparte, expliciete handeling.
    await expect(page.getByText("Gezamenlijk akkoord ringpresidium registreren")).toHaveCount(0);
    await Promise.all([page.waitForURL(new RegExp(`/roepingen/${m.calling.id}`)), page.getByRole("button", { name: "Vrijgeven aan de hoge raad" }).click()]);
    await page.waitForLoadState("networkidle");
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: m.calling.id } })).status).toBe("HOGERAAD_VOTING");
    expect(await prisma.notification.count({ where: { callingId: m.calling.id, type: "AWAITING_RELEASE" } })).toBe(3); // niet opnieuw
  });
}

test("hogeraadsbesluit vereist een voorzitter uit het presidium en legt afwezigen nooit als ondersteuning vast", async ({ page }) => {
  const m = await meeting("RINGSECRETARIS");
  await prisma.calling.update({ where: { id: m.calling.id }, data: { status: "PRESIDIUM_APPROVED" } });
  const { releaseToHogeraad } = await import("../src/lib/workflow");
  await releaseToHogeraad({ callingId: m.calling.id, actorId: m.president.id });
  const { rawToken } = await createMagicLinkToken(m.staff.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${m.calling.id}`)}`);

  await page.getByText("Gezamenlijk akkoord hoge raad registreren (vergadering)").click();
  const form = page.getByRole("form", { name: "Gezamenlijk akkoord hoge raad" });
  await form.getByLabel(/akkoord bevonden/).check();
  await form.getByRole("group", { name: "Aanwezig", exact: true }).getByRole("checkbox").first().check();
  await form.getByLabel("Voorzitter (lid van het ringpresidium)").selectOption(m.president.id);
  await Promise.all([page.waitForURL(/melding=besluit-vastgelegd/), form.getByRole("button", { name: "Besluit vastleggen" }).click()]);
  const after = await prisma.calling.findUniqueOrThrow({ where: { id: m.calling.id } });
  expect(after).toMatchObject({ status: "APPROVED", hogeraadApprovalMethod: "MEETING" });
  expect(await prisma.vote.count({ where: { callingId: m.calling.id } })).toBe(0);
});

test("een hogeraadslid ziet geen formulier voor gezamenlijke besluiten en kan er geen indienen", async ({ page }) => {
  const m = await meeting("RINGSECRETARIS");
  await prisma.calling.update({ where: { id: m.calling.id }, data: { status: "PRESIDIUM_APPROVED" } });
  const { releaseToHogeraad } = await import("../src/lib/workflow");
  await releaseToHogeraad({ callingId: m.calling.id, actorId: m.president.id });
  const { rawToken } = await createMagicLinkToken(m.hr.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${m.calling.id}`)}`);
  await expect(page.getByText(/Gezamenlijk akkoord .* registreren/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vrijgeven aan de hoge raad" })).toHaveCount(0);
});

test("een verlopen sessie tijdens de vergadering leidt naar inloggen, zonder besluit vast te leggen", async ({ page }) => {
  const m = await meeting("RINGSECRETARIS");
  const { rawToken } = await createMagicLinkToken(m.staff.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${m.calling.id}`)}`);
  await page.getByText("Gezamenlijk akkoord ringpresidium registreren (vergadering)").click();
  const form = page.getByRole("form", { name: "Gezamenlijk akkoord ringpresidium" });
  await form.getByLabel(m.president.name).check();
  await form.getByLabel(/akkoord bevonden/).check();
  await prisma.session.deleteMany({ where: { userId: m.staff.id } }); // sessie verlopen/ingetrokken
  await form.getByRole("button", { name: "Besluit vastleggen" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await prisma.calling.findUniqueOrThrow({ where: { id: m.calling.id } })).status).toBe("PRESIDIUM_VOTING");
  expect(await prisma.groupDecision.count({ where: { callingId: m.calling.id } })).toBe(0);
});

test("een secretaris van een andere ring heeft geen toegang tot dit voorstel", async ({ page }) => {
  const m = await meeting("RINGSECRETARIS");
  const other = await createE2eUser("RINGSECRETARIS", `Andere ring ${Date.now()}`);
  const { rawToken } = await createMagicLinkToken(other.user.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  const res = await page.goto(`/roepingen/${m.calling.id}`);
  expect(res?.status()).toBe(404);
});
