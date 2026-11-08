import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Ontwerpstandaard (docs/ONTWERPSTANDAARD.md): bewaakt wat zonder deze tests ongemerkt zou terugvallen.
const css = readFileSync("src/styles.css", "utf8");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const sources = walk("src").filter((f) => /\.tsx?$/.test(f));

describe("Ontwerpstandaard", () => {
  it("geen systeemdialogen: confirm/alert/prompt van de browser worden nergens gebruikt", () => {
    const offenders = sources.filter((f) => /\bwindow\.(confirm|alert|prompt)\(|[^.\w](confirm|alert|prompt)\(/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/await confirm\(|confirm\(\{/g, "")));
    expect(offenders).toEqual([]);
  });

  it("aanraakdoelen: icoonknop 48 × 48 px en menu-items minimaal 48 px (via --touch)", () => {
    expect(css).toMatch(/--touch:\s*48px/);
    expect(css).toMatch(/\.icon-btn\s*\{[^}]*width:\s*var\(--touch\);\s*height:\s*var\(--touch\)/);
    expect(css).toMatch(/\.menu-item\s*\{[^}]*min-height:\s*var\(--touch\)/);
    expect(css).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--touch\)/);
  });

  it("de bevestigingsdialoog ligt boven menu en sheet; het menu boven de sheet", () => {
    const z = (sel: string) => Number(new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1]);
    expect(z(".dialog-backdrop")).toBeGreaterThan(z(".menu"));
    expect(z(".menu")).toBeGreaterThan(z(".sheet"));
  });

  it("alleen kleurtokens, geen hardcoded kleuren in de nieuwe bediening (menu, dialoog, status)", () => {
    const block = css.slice(css.indexOf("Uniforme bediening"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\((?!\s*var\()/);
  });

  it("acties staan niet meer als losse knoppen onderaan: geen 'Voorstel definitief verwijderen…' knop op de pagina", () => {
    const src = readFileSync("src/screens/CallingDetail.tsx", "utf8");
    expect(src).not.toMatch(/setConfirmDelete/);
    expect(src).toMatch(/ActionMenu/);
  });
});
