import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Compatibiliteit met de gepubliceerde iOS-app 1.1.2 (build 11, commit 067b669): elke route die die versie op de server aantreft,
// moet blijven bestaan met dezelfde methode. De lijst is uit de router van die commit gehaald; nieuwe routes mogen erbij komen.
const routerSource = readFileSync(join(process.cwd(), "src/lib/api/router.ts"), "utf8");
const expected = readFileSync(join(process.cwd(), "tests/fixtures/ios-1.1.2-routes.txt"), "utf8").split("\n").filter(Boolean);

describe("iOS 1.1.2: alle routes van de mobiele API blijven bestaan", () => {
  it("de lijst is niet leeg", () => expect(expected.length).toBeGreaterThan(80));
  for (const line of expected) {
    const [method, path] = line.split(" ");
    it(`${method} ${path}`, () => {
      const re = new RegExp(`Route\\("${method}", "${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
      expect(routerSource).toMatch(re);
    });
  }
});
