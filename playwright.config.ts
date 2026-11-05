import { defineConfig } from "@playwright/test";
import { assertSafeTestDatabaseUrl } from "./tests/dbGuard";

// De e2e-tests maken veel gegevens aan en delen de database met de server onder test: alleen een afzonderlijke testdatabase (E2E_DATABASE_URL of DATABASE_URL).
// Start de server met dezelfde DATABASE_URL.
process.env.DATABASE_URL = assertSafeTestDatabaseUrl(process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  // WebAuthn-ceremonies (passkeyregistratie/-login via de virtuele CDP-
  // authenticator) en TOTP-verificatie doorlopen meerdere netwerk-
  // rondjes; de standaard 5s bleek in deze (gedeelde, soms trage)
  // ontwikkelomgeving af en toe net te kort, zonder dat er iets mis was.
  expect: { timeout: 15000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:2810",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        channel: undefined,
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        },
      },
    },
  ],
});
