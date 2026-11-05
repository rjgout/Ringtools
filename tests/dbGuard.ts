/**
 * Bescherming tegen het per ongeluk wissen van echte gegevens: de testsuite (Vitest-reset, Playwright-data) werkt alleen op een database
 * die ondubbelzinnig een testdatabase is. Productie heet standaard `ringtools` en draait op host `db` (docker-compose); beide worden geweigerd.
 *
 * Regels: de databasenaam eindigt op `_test`, `_ci` of `_e2e`; de host is lokaal (localhost/127.0.0.1/::1); de naam is niet gelijk aan
 * `POSTGRES_DB` van de omgeving. Gebruik `TEST_DATABASE_URL` (Vitest) of `E2E_DATABASE_URL` (Playwright) om expliciet een testdatabase aan te wijzen.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertSafeTestDatabaseUrl(raw: string | undefined, env: Record<string, string | undefined> = process.env): string {
  if (!raw) {
    throw new Error(
      "Geen testdatabase ingesteld. Zet TEST_DATABASE_URL (Vitest) of E2E_DATABASE_URL (Playwright) op een afzonderlijke database, bijvoorbeeld " +
        "postgresql://postgres:…@localhost:5432/ringtools_test?schema=public (migraties toepassen met `npx prisma migrate deploy`)."
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("De testdatabase-URL is geen geldige URL.");
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/_(test|ci|e2e)$/.test(name)) {
    throw new Error(`Geweigerd: database "${name}" lijkt geen testdatabase (naam moet op _test, _ci of _e2e eindigen). De testsuite wist gegevens en draait nooit op een andere database.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Geweigerd: host "${url.hostname}" is niet lokaal. De testsuite draait alleen op localhost.`);
  }
  if (env.POSTGRES_DB && env.POSTGRES_DB === name) {
    throw new Error(`Geweigerd: database "${name}" is gelijk aan POSTGRES_DB van deze omgeving.`);
  }
  return raw;
}

/** Tweede vangnet vlak vóór destructieve acties (bijv. `resetDatabase`): controleert de database waarmee de prisma-client werkelijk verbindt. */
export function assertTestDatabaseNow(): void {
  assertSafeTestDatabaseUrl(process.env.DATABASE_URL);
}
