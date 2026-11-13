import { test, expect, devices, type Page } from "@playwright/test";
import { prisma } from "../src/lib/prisma";
import { createMagicLinkToken, SESSION_COOKIE_NAME } from "../src/lib/auth";
import { createCalling } from "../src/lib/workflow";
import { loginWithMagicLink } from "./helpers/mfa";
import { createE2eUser } from "./helpers/data";

// Web/PWA: de gedeelde interface (dezelfde client als de iOS-app) onder /app, met de sessiecookie.
// Vereist een gebouwde webomgeving (`npm run build:web` in mobile/).
// De telefoonprojecten gebruiken het Pixel-profiel van Playwright (Chromium met Android Chrome-kenmerken); dit is geen echt Android-toestel.
const SHOTS = process.env.E2E_SHOTS_DIR;
const pixel = { viewport: devices["Pixel 7"].viewport, userAgent: devices["Pixel 7"].userAgent, deviceScaleFactor: devices["Pixel 7"].deviceScaleFactor, isMobile: true, hasTouch: true };

async function login(page: Page, userId: string, target = "/app") {
  const { rawToken } = await createMagicLinkToken(userId);
  await loginWithMagicLink(page, `/auth/magic/${rawToken}?redirect=${encodeURIComponent(target)}`);
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

test.describe("webomgeving – telefoon (Android Chrome-profiel)", () => {
  test.use(pixel);

  test("niet ingelogd: /app gaat naar de bestaande inlogpagina en komt na inloggen terug op de gevraagde plek", async ({ page }) => {
    const { user, ringId } = await createE2eUser("RINGPRESIDIUM", "Terugkeer Test");
    const calling = await createCalling({ ringId, personName: "Persoon Terugkeer", functionTitle: "Testroeping", createdById: user.id });
    await page.goto(`/app?to=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(`/app?to=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
    await login(page, user.id, `/app?to=${encodeURIComponent(`/roepingen/${calling.id}`)}`);
    await expect(page.getByRole("heading", { name: "Persoon Terugkeer" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/app#/roepingen/${calling.id}$`));
  });

  test("ringpresidium: overzicht, voorstellen, ondersteunen, voortgang en algemene herinnering; geen token in de browser", async ({ page, context }) => {
    const { user, ringId } = await createE2eUser("RINGPRESIDIUM", "President Web");
    const calling = await createCalling({ ringId, personName: "Persoon Web", functionTitle: "Testroeping web", createdById: user.id });
    await login(page, user.id);
    await expect(page).toHaveURL(/\/app(#\/)?$/);
    await expect(page.getByRole("navigation", { name: "Hoofdnavigatie" })).toBeVisible();
    for (const tab of ["Overzicht", "Voorstellen", "Meldingen", "Profiel"]) await expect(page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: new RegExp(tab) })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Wacht op jouw reactie" })).toBeVisible();
    await shot(page, "telefoon-overzicht");

    await page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: /Voorstellen/ }).click();
    await expect(page.getByRole("heading", { name: "Voorstellen", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nieuw voorstel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nieuwe ontheffing" })).toBeVisible();
    await shot(page, "telefoon-voorstellen");
    await page.getByRole("link", { name: /Persoon Web/ }).click();
    await expect(page.getByRole("heading", { name: "Persoon Web" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Terug naar/ })).toBeVisible();

    // Voortgang (tijdlijn) en de algemene herinnering zonder persoonsgegevens.
    await page.getByText("Voortgang").click();
    await expect(page.getByText("Ringpresidium akkoord")).toBeVisible();
    await shot(page, "telefoon-voorstel");
    await page.getByRole("button", { name: "Acties voor dit voorstel" }).click();
    await expect(page.getByRole("menuitem", { name: "Algemene herinnering delen" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Ondersteunen via dezelfde bediening als in de app.
    await page.getByRole("button", { name: /^Ondersteunen/ }).first().click();
    await expect.poll(async () => prisma.vote.count({ where: { callingId: calling.id, userId: user.id } })).toBe(1);

    // Het sessietoken staat alleen in de HttpOnly-cookie: niet leesbaar voor scripts en nergens in de browseropslag.
    const cookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    const exposed = await page.evaluate((value) => {
      const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie;
      return { hasToken: dump.includes(value), keys: Object.keys(localStorage) };
    }, cookie.value);
    expect(exposed.hasToken).toBe(false);
    expect(exposed.keys.every((k) => k === "ringtools.web.ring")).toBe(true);
  });

  test("hogeraadslid: eigen overzicht en voorstellenlijst, geen Beheer-tab en geen beheerschermen", async ({ page }) => {
    const { user: president, ringId } = await createE2eUser("RINGPRESIDIUM", "President Raad");
    const { user: raadslid } = await createE2eUser("HOGERAAD", "Raadslid Web", { ringId });
    await createCalling({ ringId, personName: "Persoon Raad", functionTitle: "Testroeping raad", createdById: president.id });
    await login(page, raadslid.id);
    await expect(page.getByRole("navigation", { name: "Hoofdnavigatie" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: /Beheer/ })).toHaveCount(0);
    await page.goto("/app#/beheer/gebruikers");
    await expect(page.getByRole("heading", { name: /Gebruikers/ })).toHaveCount(0);
    const users = await page.request.get(`/api/mobile/v1/rings/${ringId}/users`, { headers: { "X-Ringtools-Web": "1", Origin: new URL(page.url()).origin } });
    expect(users.status()).toBe(404);
  });

  test("ringbeheerder: Beheer met uitnodigen (zelfde procedure als de app) en inrichting", async ({ page }) => {
    const { user, ringId } = await createE2eUser("RINGSECRETARIS", "Beheerder Web", { isRingManager: true });
    await login(page, user.id);
    await page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: /Beheer/ }).click();
    await expect(page).toHaveURL(/#\/beheer\/gebruikers$/);
    await expect(page.getByText("Beheerder Web").first()).toBeVisible();
    await shot(page, "telefoon-beheer");
    await page.getByRole("tab", { name: /Inrichting/ }).click();
    await expect(page).toHaveURL(/#\/beheer\/inrichting$/);
    expect(await prisma.ringInvitation.count({ where: { ringId } })).toBe(0);
  });

  test("profiel: beveiligingsbeheer op de website, webpush alleen na een tik, installeren, sessies; uitloggen wist de sessie", async ({ page, context }) => {
    const { user } = await createE2eUser("RINGPRESIDIUM", "Profiel Web");
    await login(page, user.id);
    await page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: /Profiel/ }).click();
    await expect(page.getByRole("heading", { name: "Aanmelden en beveiliging" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Verificatie, passkeys en herstelcodes beheren" })).toHaveAttribute("href", "/profiel/beveiliging");
    await expect(page.getByRole("heading", { name: "Pushmeldingen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Installeren" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aangemelde toestellen" })).toBeVisible();
    await expect(page.getByText(/Face ID/)).toHaveCount(1); // alleen de eerlijke uitleg dat de browser dit niet biedt
    await expect(page.getByText(/Snel aanmelden/)).toHaveCount(0);
    expect(await page.evaluate(() => (typeof Notification === "undefined" ? "n.v.t." : Notification.permission))).not.toBe("granted");
    await shot(page, "telefoon-profiel");

    await page.getByRole("button", { name: "Uitloggen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Uitloggen" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect((await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME)?.value ?? "").toBe("");
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("veilig uitloggen: mislukt het intrekken, dan blijf je ingelogd met een melding; daarna lukt het, ook met de terug-knop geen gegevens", async ({ page, context }) => {
    const { user } = await createE2eUser("RINGPRESIDIUM", "Uitloggen Web");
    await login(page, user.id);
    await page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: /Profiel/ }).click();
    await expect(page.getByRole("heading", { name: "Uitloggen Web" })).toBeVisible();

    await page.route("**/api/mobile/v1/auth/logout", (route) => route.abort("connectionfailed"));
    await page.getByRole("button", { name: "Uitloggen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Uitloggen" }).click();
    await expect(page.getByRole("alert")).toContainText("Uitloggen is niet gelukt. Je bent nog ingelogd");
    await expect(page).toHaveURL(/\/app/);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect((await context.cookies()).find((c) => c.name === SESSION_COOKIE_NAME)?.value).toBeTruthy();

    await page.unroute("**/api/mobile/v1/auth/logout");
    await page.getByRole("button", { name: "Uitloggen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Uitloggen" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Uitloggen Web")).toHaveCount(0);
  });

  test("sessie ingetrokken terwijl de webomgeving open staat: terug naar inloggen, geen gegevens meer", async ({ page }) => {
    const { user } = await createE2eUser("RINGPRESIDIUM", "Intrekken Web");
    await login(page, user.id);
    await expect(page.getByRole("navigation", { name: "Hoofdnavigatie" })).toBeVisible();
    await prisma.session.deleteMany({ where: { userId: user.id } });
    // De eerstvolgende aanvraag (hier: naar een ander scherm gaan) krijgt 401; de webomgeving toont dan niets meer en gaat naar de inlogpagina.
    await page.evaluate(() => { window.location.hash = "#/voorstellen"; });
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole("navigation", { name: "Hoofdnavigatie" })).toHaveCount(0);
  });

  test("oude adressen van de website verwijzen door naar hetzelfde scherm; de webmin blijft op de bestaande pagina's", async ({ page }) => {
    const { user, ringId } = await createE2eUser("RINGPRESIDIUM", "Doorverwijzen Web");
    const calling = await createCalling({ ringId, personName: "Persoon Oud Adres", functionTitle: "Testroeping", createdById: user.id });
    await login(page, user.id, `/roepingen/${calling.id}`);
    await expect(page).toHaveURL(new RegExp(`/app#/roepingen/${calling.id}$`));
    await expect(page.getByRole("heading", { name: "Persoon Oud Adres" })).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/app(#\/)?$/);
    await page.goto("/profiel/beveiliging");
    await expect(page.getByRole("heading", { name: "Beveiliging" })).toBeVisible();
  });

  test("geen vertrouwelijke gegevens in caches: API-antwoorden zijn no-store en de serviceworker bewaart alleen statische bestanden", async ({ page }) => {
    const { user, ringId } = await createE2eUser("RINGPRESIDIUM", "Cache Web");
    await createCalling({ ringId, personName: "Persoon Geheim Cache", functionTitle: "Testroeping", createdById: user.id });
    const apiCache: string[] = [];
    page.on("response", (r) => { if (r.url().includes("/api/mobile/v1/")) apiCache.push(r.headers()["cache-control"] ?? "(geen)"); });
    await login(page, user.id);
    await page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: /Voorstellen/ }).click();
    await expect(page.getByText("Persoon Geheim Cache")).toBeVisible();
    expect(apiCache.length).toBeGreaterThan(2);
    expect(apiCache.every((c) => c === "no-store")).toBe(true);
    await page.evaluate(() => navigator.serviceWorker?.ready);
    await page.reload();
    await expect(page.getByText("Persoon Geheim Cache")).toBeVisible();
    const cached = await page.evaluate(async () => {
      const out: { url: string; body: string }[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) out.push({ url: new URL(req.url).pathname, body: await (await cache.match(req))!.text() });
      }
      return out;
    });
    for (const entry of cached) {
      expect(entry.url, entry.url).toMatch(/^\/(icons\/|_next\/static\/|app\/assets\/|offline\.html$|manifest\.webmanifest$|favicon\.ico$)/);
      expect(entry.body).not.toContain("Persoon Geheim Cache");
    }
    expect(cached.some((c) => c.url.startsWith("/api/") || c.url === "/app")).toBe(false);
  });

  test("PWA: het manifest is installeerbaar en de webomgeving verwijst ernaar", async ({ page }) => {
    const { user } = await createE2eUser("RINGPRESIDIUM", "Manifest Web");
    await login(page, user.id);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/")))).toBe(true);
  });
});

test.describe("webomgeving – desktop", () => {
  test.use({ viewport: { width: 1366, height: 850 } });

  test("zelfde schermen met de hoofdnavigatie links; toetsenbordbediening werkt", async ({ page }) => {
    const { user, ringId } = await createE2eUser("RINGSECRETARIS", "Desktop Web", { isRingManager: true });
    await createCalling({ ringId, personName: "Persoon Desktop", functionTitle: "Testroeping desktop", createdById: user.id });
    await login(page, user.id);
    const nav = page.getByRole("navigation", { name: "Hoofdnavigatie" });
    await expect(nav).toBeVisible();
    const navBox = (await nav.boundingBox())!;
    const pageBox = (await page.locator("main.page").boundingBox())!;
    expect(navBox.x).toBeLessThan(10);
    expect(navBox.width).toBeLessThan(300);
    expect(pageBox.x).toBeGreaterThanOrEqual(navBox.x + navBox.width - 1);
    await shot(page, "desktop-overzicht");
    await nav.getByRole("link", { name: /Voorstellen/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Voorstellen", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: /Persoon Desktop/ }).click();
    await expect(page.getByRole("heading", { name: "Persoon Desktop" })).toBeVisible();
    await shot(page, "desktop-voorstel");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
