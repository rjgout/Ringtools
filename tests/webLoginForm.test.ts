import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Website: het inlogformulier toont geen verwijzing naar het technische beheerdersaccount.
describe("Website-inlogformulier", () => {
  const src = readFileSync(resolve(__dirname, "../src/app/login/LoginForm.tsx"), "utf8");
  it("het gebruikersnaamveld heeft het neutrale label 'Gebruikersnaam' en geen placeholder 'webmin'", () => {
    expect(src).toContain("Gebruikersnaam");
    expect(src).not.toMatch(/placeholder\s*=\s*["']webmin["']/i);
    expect(src).not.toMatch(/placeholder\s*=\s*["'][^"']*webmin/i);
  });
});
