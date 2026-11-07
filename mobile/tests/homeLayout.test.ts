import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Een link met .panel kreeg display:block en overschreef .row (flex): label en getal plakten aan elkaar ("Ontheffingen0").
describe("Overzicht: opmaak", () => {
  const css = readFileSync("src/styles.css", "utf8");
  it("a.panel.row blijft een flex-rij zodat label en getal uit elkaar staan", () => {
    expect(css).toMatch(/a\.panel\.row,\s*button\.panel\.row\s*\{\s*display:\s*flex/);
  });
});
