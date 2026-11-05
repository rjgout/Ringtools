import { describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl } from "./dbGuard";

const ok = "postgresql://postgres:x@localhost:5432/ringtools_test?schema=public";

describe("testdatabase-bescherming", () => {
  it("accepteert lokale databases met een testnaam", () => {
    for (const name of ["ringtools_test", "ringtools_ci", "ringtools_e2e"]) {
      expect(assertSafeTestDatabaseUrl(`postgresql://u:p@localhost:5432/${name}?schema=public`, {})).toContain(name);
    }
    expect(assertSafeTestDatabaseUrl("postgresql://u:p@127.0.0.1:5432/x_test", {})).toBeTruthy();
  });

  it("weigert de productienaam, productiehost en onbekende namen", () => {
    expect(() => assertSafeTestDatabaseUrl("postgresql://u:p@db:5432/ringtools?schema=public", {})).toThrow(/testdatabase/);
    expect(() => assertSafeTestDatabaseUrl("postgresql://u:p@localhost:5432/ringtools", {})).toThrow(/testdatabase/);
    expect(() => assertSafeTestDatabaseUrl("postgresql://u:p@localhost:5432/ringtools_test_backup", {})).toThrow();
    expect(() => assertSafeTestDatabaseUrl("postgresql://u:p@nas.local:5432/ringtools_test", {})).toThrow(/lokaal/);
    expect(() => assertSafeTestDatabaseUrl("postgresql://u:p@db:5432/ringtools_test", {})).toThrow(/lokaal/);
  });

  it("weigert een naam gelijk aan POSTGRES_DB, een ontbrekende of ongeldige URL", () => {
    expect(() => assertSafeTestDatabaseUrl(ok, { POSTGRES_DB: "ringtools_test" })).toThrow(/POSTGRES_DB/);
    expect(() => assertSafeTestDatabaseUrl(undefined, {})).toThrow(/TEST_DATABASE_URL/);
    expect(() => assertSafeTestDatabaseUrl("geen-url", {})).toThrow(/geldige URL/);
  });
});
