import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Vormgevingsfundament (HIG, fase V1): kleur- en spacingtokens, toegankelijkheid en contrast worden hier bewaakt.
const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const outsideTokens = noComments.replace(/:root\s*\{[^}]*\}/g, "");

function block(header: RegExp): Record<string, string> {
  const m = noComments.match(header);
  if (!m) throw new Error(`tokenblok niet gevonden: ${header}`);
  const out: Record<string, string> = {};
  for (const d of m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}
const light = block(/^\s*:root\s*\{([^}]*)\}/m);
const dark = { ...light, ...block(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/) };
const more = { ...light, ...block(/@media \(prefers-contrast: more\)\s*\{\s*:root\s*\{([^}]*)\}/) };
const darkMore = { ...dark, ...block(/@media \(prefers-contrast: more\) and \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/) };

function lum(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("Designtokens: geen hardcoded kleuren, geen verboden patronen", () => {
  it("buiten de :root-tokenblokken staat geen kleurliteraal (alleen rgb(var(--…)))", () => {
    const literals = outsideTokens.match(/#[0-9a-fA-F]{3,8}\b|rgba?\((?!\s*var\()/g);
    expect(literals).toBeNull();
  });
  it("geen `transition: all`, geen `100vw`", () => {
    expect(outsideTokens).not.toMatch(/transition:\s*all/);
    expect(outsideTokens).not.toMatch(/100vw/);
  });
  it("de viewport blokkeert zoomen niet en gebruikt de volledige schermbreedte", () => {
    expect(html).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
    expect(html).toMatch(/viewport-fit=cover/);
  });
  it("ruimtes (padding, margin, gap) staan op het 4/8pt-grid", () => {
    const bad: string[] = [];
    for (const d of outsideTokens.matchAll(/(padding|margin|gap)[a-z-]*:\s*([^;}]+)[;}]/g)) {
      for (const px of d[2].matchAll(/(\d+(?:\.\d+)?)px/g)) if (Number(px[1]) % 4 !== 0) bad.push(`${d[1]}: ${d[2]}`);
    }
    expect(bad).toEqual([]);
  });
  it("tekst gebruikt schaalbare eenheden (rem/Dynamic Type), geen vaste px-lettergroottes", () => {
    expect(outsideTokens.match(/font-size:\s*\d+(\.\d+)?px/g)).toBeNull();
    expect(css).toMatch(/-apple-system-body/);
    expect(css).toMatch(/-apple-system-title1/);
  });
  it("Reduce Motion, Reduce Transparency en Verhoogd contrast worden ondersteund; veilige schermranden aanwezig", () => {
    for (const q of ["prefers-reduced-motion", "prefers-reduced-transparency", "prefers-contrast"]) expect(css).toContain(q);
    for (const e of ["safe-area-inset-top", "safe-area-inset-bottom", "safe-area-inset-left", "safe-area-inset-right"]) expect(css).toContain(e);
  });
});

const modes = { licht: light, donker: dark, "licht + verhoogd contrast": more, "donker + verhoogd contrast": darkMore };
// [voorgrond, achtergrond, minimaal contrast]: llopende tekst 4,5:1; knoppen met vette 17 pt-tekst tellen als grote tekst (3:1) maar we eisen 4,5:1.
const pairs: [string, string, number][] = [
  ["text", "bg", 7], ["text", "bg-elevated", 7], ["text-muted", "bg-elevated", 4.5], ["text-muted", "bg", 4.5],
  ["tint", "bg-elevated", 4.5], ["tint", "bg", 4.5], ["on-tint", "tint", 4.5],
  ["on-success-fill", "success-fill", 4.5], ["on-danger-fill", "danger-fill", 4.5],
  ["success", "success-bg", 4.5], ["danger", "danger-bg", 4.5], ["warning-ink", "warning-bg", 4.5],
  ["danger", "bg-elevated", 4.5], ["success", "bg-elevated", 4.5],
];
describe("Contrast per weergavemodus (WCAG)", () => {
  for (const [name, tokens] of Object.entries(modes)) {
    it(`${name}: alle tekst/achtergrondparen halen hun minimum`, () => {
      const failures: string[] = [];
      for (const [fg, bg, min] of pairs) {
        const r = ratio(tokens[fg], tokens[bg]);
        if (r < min) failures.push(`${fg} op ${bg}: ${r.toFixed(2)} < ${min}`);
      }
      expect(failures).toEqual([]);
    });
  }
});
