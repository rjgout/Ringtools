import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { prisma } from "../../src/lib/prisma";
import { decryptSecret } from "../../src/lib/crypto";

const TOTP_PERIOD_SECONDS = 30;
// De server wijst een TOTP-code af die uit hetzelfde (of een eerder)
// tijdvak komt als de laatst geaccepteerde code (replay-preventie). Omdat
// losse tests binnen één tijdvak van 30 seconden na elkaar kunnen inloggen,
// zou een "toevallig" identieke code anders ten onrechte als ongeldig
// worden afgewezen — dit wacht net als een mens die een paar seconden
// wacht op de volgende code van de authenticator-app.
let lastSubmittedCounter: number | null = null;

function currentCounter(): number {
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
}

async function waitForFreshTotpWindow() {
  while (lastSubmittedCounter !== null && currentCounter() <= lastSubmittedCounter) {
    const msIntoPeriod = Date.now() % (TOTP_PERIOD_SECONDS * 1000);
    const msToWait = TOTP_PERIOD_SECONDS * 1000 - msIntoPeriod + 250;
    await new Promise((resolve) => setTimeout(resolve, msToWait));
  }
}

function currentCodeFor(secretBase32: string): string {
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: TOTP_PERIOD_SECONDS, secret: OTPAuth.Secret.fromBase32(secretBase32) });
  return totp.generate();
}

/**
 * Leest het (versleutelde) TOTP-secret van het adminaccount rechtstreeks uit
 * de database, net zoals de server dat zelf doet. Dit is robuuster dan het
 * cachen van een in-memory secret: het werkt ongeacht in welk testbestand of
 * -proces de inschrijving heeft plaatsgevonden, zonder van Playwright's
 * workerindeling af te hangen. De rij bestaat al zodra de inschrijvingspagina
 * voor het eerst gerenderd is (zie startTotpEnrollment in src/lib/mfa.ts).
 */
async function getAdminTotpSecret(): Promise<string> {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const credential = await prisma.totpCredential.findUniqueOrThrow({ where: { userId: admin.id } });
  return decryptSecret(credential.secretEncrypted);
}

async function submitCode(page: Page, secretBase32: string, submitButtonName: string) {
  await waitForFreshTotpWindow();
  await page.locator("#code").fill(currentCodeFor(secretBase32));
  lastSubmittedCounter = currentCounter();
  await page.getByRole("button", { name: submitButtonName, exact: true }).click();
}

/** Rondt de TOTP-stap af voor het adminaccount, zowel bij inschrijving als bij een latere login. */
export async function completeAdminTotpStep(page: Page) {
  await expect(page).toHaveURL(/\/mfa\/totp/);

  const enrolling = await page
    .getByRole("heading", { name: "Stel tweefactorauthenticatie in" })
    .isVisible()
    .catch(() => false);

  const secret = await getAdminTotpSecret();

  if (enrolling) {
    await submitCode(page, secret, "Bevestigen");
    await expect(page.getByRole("heading", { name: "TOTP is ingesteld" })).toBeVisible();
    await page.getByRole("button", { name: "Ik heb mijn herstelcodes opgeslagen, ga verder" }).click();
  } else {
    await submitCode(page, secret, "Inloggen");
  }
}

/** Logt het adminaccount (webmin) volledig in, inclusief de verplichte TOTP-stap. */
export async function loginAsAdmin(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Beheerder" }).click();
  await page.getByLabel("Gebruikersnaam").fill(username);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await completeAdminTotpStep(page);
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Registreert een virtuele WebAuthn-authenticator via het CDP-protocol, zodat
 * passkeyregistratie/-login in een echte (headless) Chromium-browser werkt
 * zonder een fysiek apparaat — vergelijkbaar met hoe browsers dit zelf bij
 * geautomatiseerd testen ondersteunen.
 */
export async function addVirtualAuthenticator(page: Page, { isUserVerified = true }: { isUserVerified?: boolean } = {}) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

/** Rondt de passkey-MFA-stap af: registreert (eerste keer) of verifieert (daarna) automatisch via de virtuele authenticator. */
export async function completePasskeyStep(page: Page) {
  await expect(page).toHaveURL(/\/mfa\/passkey/);

  const registerButton = page.getByRole("button", { name: "Passkey registreren" });
  if (await registerButton.isVisible().catch(() => false)) {
    await registerButton.click();
  }
  // Het verificatiepaneel start de ceremonie automatisch bij het laden van de pagina.
}

/** Logt een reguliere gebruiker in via een magic link, inclusief de verplichte passkey-stap. */
export async function loginWithMagicLink(page: Page, magicLinkPath: string, authenticatorOptions?: { isUserVerified?: boolean }) {
  // Eerst navigeren, dan pas de virtuele authenticator koppelen: zo is het
  // CDP-doel (target) al stabiel voordat WebAuthn.enable wordt aangeroepen,
  // in plaats van gekoppeld te zijn aan de nog lege eerste pagina.
  await page.goto(magicLinkPath);
  await addVirtualAuthenticator(page, authenticatorOptions);

  // Geen herhaalde klik bij traagheid: de magic link is eenmalig (het
  // token wordt bij de eerste klik al verbruikt), dus een "defensieve"
  // tweede klik zou een al-gebruikt token opnieuw indienen en de login
  // juist laten mislukken. Gewoon genoeg geduld hebben is hier correct.
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL(/\/mfa\/passkey/, { timeout: 20000 });

  await completePasskeyStep(page);
}
