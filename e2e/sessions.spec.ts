import { test, expect } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken } from "../src/lib/auth";
import { createCalling } from "../src/lib/workflow";
import { createOpenLink } from "../src/lib/openLinks";
import { loginWithMagicLink } from "./helpers/mfa";
import { createE2eUser } from "./helpers/data";

test("een geïnstalleerde app blijft ingelogd na afsluiten en heropenen (cookie blijft bewaard)", async ({ browser }) => {
  const { user } = await createE2eUser("HOGERAAD", `Blijft ingelogd ${Date.now()}`);
  const { rawToken } = await createMagicLinkToken(user.id);

  const first = await browser.newContext();
  const page = await first.newPage();
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  await expect(page).toHaveURL(/\/dashboard/);

  // Het sessiecookie is HttpOnly, SameSite=Lax en een langlevend (persistent) cookie.
  const cookie = (await first.cookies()).find((c) => c.name === "ringtools_session");
  expect(cookie).toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Lax");
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 100 * 24 * 3600);

  // "App afsluiten": de browsersessie verdwijnt, het persistente cookie blijft.
  const state = await first.storageState();
  await first.close();

  const reopened = await browser.newContext({ storageState: state });
  const page2 = await reopened.newPage();
  await page2.goto("/dashboard");
  await expect(page2).toHaveURL(/\/dashboard/);
  await expect(page2.getByRole("button", { name: "Meldingen" })).toBeVisible();

  // De vernieuwroute verlengt de sessie zonder iets prijs te geven.
  const refresh = await page2.request.post("/api/session/refresh");
  expect(refresh.status()).toBe(200);
  expect(await refresh.json()).toEqual({ ok: true, rotated: false });
  await reopened.close();
});

test("een verlopen of ingetrokken sessie wordt na heropenen geweigerd", async ({ browser }) => {
  const { user } = await createE2eUser("HOGERAAD", `Ingetrokken ${Date.now()}`);
  const { rawToken } = await createMagicLinkToken(user.id);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
  await expect(page).toHaveURL(/\/dashboard/);

  await prisma.session.deleteMany({ where: { userId: user.id } }); // bijv. beveiligingsreset of deactivering
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  const refresh = await page.request.post("/api/session/refresh");
  expect(refresh.status()).toBe(401);
  await ctx.close();
});

test("browser en geïnstalleerde app werken onafhankelijk: uitloggen in de één laat de ander ingelogd", async ({ browser }) => {
  const { user } = await createE2eUser("HOGERAAD", `Twee apparaten ${Date.now()}`);
  const contexts = [];
  for (let i = 0; i < 2; i++) {
    const { rawToken } = await createMagicLinkToken(user.id);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginWithMagicLink(page, `/auth/magic/${rawToken}`);
    await expect(page).toHaveURL(/\/dashboard/);
    contexts.push({ ctx, page });
  }
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

  await contexts[0].page.getByRole("button", { name: "Uitloggen" }).click();
  await expect(contexts[0].page).toHaveURL(/\/login/);

  await contexts[1].page.goto("/dashboard");
  await expect(contexts[1].page).toHaveURL(/\/dashboard/);
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  for (const { ctx } of contexts) await ctx.close();
});

test("een e-maillink naar een voorstel bewaart de bestemming door het inloggen heen", async ({ page }) => {
  const { user, ringId } = await createE2eUser("RINGPRESIDIUM", `Bestemming ${Date.now()}`);
  const calling = await createCalling({ ringId, personName: "E2E Bestemming", functionTitle: "Testfunctie", createdById: user.id });

  // Niet ingelogd: de oorspronkelijke bestemming zit in de loginURL.
  await page.goto(`/roepingen/${calling.id}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/roepingen/${calling.id}`).replace(/%/g, "%")}`));
  await expect(page.getByText("E2E Bestemming")).toHaveCount(0); // niets vertrouwelijks zonder authenticatie

  // Na het inloggen via een link met die bestemming opent het voorstel.
  const { rawToken } = await createMagicLinkToken(user.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
  await expect(page).toHaveURL(new RegExp(`/roepingen/${calling.id}`));
  await expect(page.getByRole("heading", { name: "E2E Bestemming" })).toBeVisible();
});

test("/open/<token>: zonder sessie alleen keuzes, geen gegevens; met sessie direct naar het voorstel", async ({ page, browser }) => {
  const { user, ringId } = await createE2eUser("RINGPRESIDIUM", `Open link ${Date.now()}`);
  const calling = await createCalling({ ringId, personName: "Geheime Naam", functionTitle: "Geheime Functie", createdById: user.id });
  const url = await createOpenLink(user.id, calling.id);
  const path = new URL(url).pathname;

  await page.goto(path);
  await expect(page.getByTestId("open-in-browser")).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
  await expect(page.getByText("Geheime Naam")).toHaveCount(0);
  await expect(page.getByText("Geheime Functie")).toHaveCount(0);
  await expect(page.getByText(/niet rechtstreeks/)).toBeVisible();

  // Geen apparaten met meldingen: duidelijke fallback.
  await page.getByTestId("send-app-notification").click();
  await expect(page.getByRole("status")).toContainText("geen apparaten");

  // Ingelogd in deze browser: direct naar het voorstel (de rechten worden daar gecontroleerd).
  const { rawToken } = await createMagicLinkToken(user.id);
  const ctx = await browser.newContext();
  const page2 = await ctx.newPage();
  await loginWithMagicLink(page2, `/auth/magic/${rawToken}`);
  await page2.goto(path);
  await expect(page2).toHaveURL(new RegExp(`/roepingen/${calling.id}`));
  await ctx.close();

  // Ongeldige koppeling: geen enkele informatie.
  await page.goto("/open/bestaat-niet");
  await expect(page.getByText("ongeldig of verlopen")).toBeVisible();
});

test("een voorstel uit een andere ring schakelt de app naar die ring; geen toegang tot een vreemde ring", async ({ page }) => {
  const { user, ringId: ringA } = await createE2eUser("HOGERAAD", `Twee ringen ${Date.now()}`);
  const ringB = await prisma.ring.create({ data: { name: `E2E ring B ${Date.now()}` } });
  await prisma.ringMembership.create({ data: { userId: user.id, ringId: ringB.id, role: "RINGPRESIDIUM", churchFunction: "Presidium" } });
  const { user: creatorB } = await createE2eUser("RINGPRESIDIUM", `Maker B ${Date.now()}`, { ringId: ringB.id });
  const callingB = await createCalling({ ringId: ringB.id, personName: "Ring B voorstel", functionTitle: "F", createdById: creatorB.id });
  const { user: outsider, ringId: ringC } = await createE2eUser("RINGPRESIDIUM", `Buitenstaander ${Date.now()}`);
  const callingC = await createCalling({ ringId: ringC, personName: "Ring C voorstel", functionTitle: "F", createdById: outsider.id });
  expect(ringA).not.toBe(ringB.id);

  const { rawToken } = await createMagicLinkToken(user.id);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(`/roepingen/${callingB.id}`)}`);
  await expect(page.getByRole("heading", { name: "Ring B voorstel" })).toBeVisible();
  // De app schakelt naar ring B: het dashboard hoort dan bij ring B.
  await expect.poll(async () => {
    await page.goto("/dashboard");
    return page.locator("header").first().innerText();
  }).toContain(ringB.name);

  // Een voorstel van een ring waar de gebruiker geen lid van is, laat niets zien.
  const res = await page.goto(`/roepingen/${callingC.id}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Ring C voorstel")).toHaveCount(0);
});
