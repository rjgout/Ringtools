import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Een link met .panel kreeg display:block en overschreef .row (flex): label en getal plakten aan elkaar ("Ontheffingen0").
describe("Overzicht: opmaak", () => {
  const css = readFileSync("src/styles.css", "utf8");
  it("a.panel.row blijft een flex-rij zodat label en getal uit elkaar staan", () => {
    expect(css).toMatch(/a\.panel\.row,\s*button\.panel\.row\s*\{\s*display:\s*flex/);
  });
});

describe("Keuzelijsten", () => {
  const css = readFileSync("src/styles.css", "utf8");
  it("select heeft dezelfde hoogte als een invoerveld (iOS negeert min-height op native selects)", () => {
    expect(css).toMatch(/select\s*\{[^}]*appearance:\s*none;[^}]*height:\s*var\(--touch\)/);
    expect(css).toMatch(/input, select\s*\{\s*width: 100%; min-height: var\(--touch\)/);
  });
});

describe("Schakelaars", () => {
  const css = readFileSync("src/styles.css", "utf8");
  it("een checkbox wordt als schakelaar getekend (geen vinkje)", () => {
    expect(css).toMatch(/input\[type="checkbox"\]\s*\{[^}]*appearance:\s*none/);
    expect(css).toMatch(/input\[type="checkbox"\]:checked::after\s*\{\s*transform:\s*translateX/);
  });
});
