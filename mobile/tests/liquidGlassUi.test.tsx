import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavBar, StatusLabel } from "../src/components/ui";

// Gedeeld designsysteem (iOS 26-stijl): glas voor de bedieningslaag, effen oppervlakken voor inhoud; toegankelijkheid per weergavemodus.
const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

function tokens(header: RegExp): Record<string, string> {
  const m = bare.match(header);
  if (!m) throw new Error(`tokenblok niet gevonden: ${header}`);
  const out: Record<string, string> = {};
  for (const d of m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}
const light = tokens(/^\s*:root\s*\{([^}]*)\}/m);
const dark = { ...light, ...tokens(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/) };
const more = { ...light, ...tokens(/@media \(prefers-contrast: more\)\s*\{\s*:root\s*\{([^}]*)\}/) };
const darkMore = { ...dark, ...tokens(/@media \(prefers-contrast: more\)\s*\{\s*:root\s*\{([^}]*)\}/), ...tokens(/@media \(prefers-contrast: more\) and \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/) };
const reduced = { ...light, ...tokens(/@media \(prefers-reduced-transparency: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/) };

type RGB = [number, number, number];
const hex = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16)) as RGB;
const channels = (v: string): RGB => v.trim().split(/\s+/).map(Number) as RGB;
const blend = (fg: RGB, bg: RGB, a: number): RGB => fg.map((c, i) => c * a + bg[i] * (1 - a)) as RGB;
const lum = ([r, g, b]: RGB) => {
  const [x, y, z] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
};
const ratio = (a: RGB, b: RGB) => {
  const [p, q] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (p + 0.05) / (q + 0.05);
};

const modes = { licht: light, donker: dark, "licht + verhoogd contrast": more, "donker + verhoogd contrast": darkMore };

describe("Glas- en bedieningstokens", () => {
  it("alle modi definiëren glas, rand, schaduw, beweging en vormen", () => {
    for (const k of ["glass", "glass-alpha", "glass-strong-alpha", "glass-blur", "glass-edge", "glass-edge-alpha", "glass-shadow", "scrim-blur", "tint-rgb", "tint-fill-alpha", "field-bg", "elev-1", "elev-2", "ease", "dur-fast", "dur", "radius-pill", "radius-xl", "touch"])
      expect(light[k], `--${k}`).toBeTruthy();
  });
  it("Reduce Transparency maakt glas effen: geen blur, volle dekking, geen lichtrand", () => {
    expect(reduced["glass-alpha"]).toBe("1");
    expect(reduced["glass-strong-alpha"]).toBe("1");
    expect(reduced["glass-blur"]).toBe("0px");
    expect(reduced["scrim-blur"]).toBe("0px");
    expect(reduced["glass-edge-alpha"]).toBe("0");
  });
  it("Verhoogd contrast maakt glas nagenoeg dekkend", () => {
    expect(Number(more["glass-alpha"])).toBeGreaterThanOrEqual(0.95);
    expect(Number(darkMore["glass-alpha"])).toBeGreaterThanOrEqual(0.95);
  });
  it("Reduce Motion schakelt alle overgangen en animaties uit", () => {
    expect(bare).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after\s*\{[^}]*transition-duration: 0\.01ms[^}]*animation-duration: 0\.01ms/);
  });
});

describe("Contrast van bediening op glas en tint (alle modi)", () => {
  for (const [name, t] of Object.entries(modes)) {
    it(`${name}: tintkleur op glas, tint-gevulde knop, tekst op menu en veld halen 4,5:1`, () => {
      const bg = t["bg"].startsWith("#") ? hex(t["bg"]) : [0, 0, 0] as RGB;
      const elevated = hex(t["bg-elevated"]);
      const glassBase = channels(t["glass"]);
      const tint = hex(t["tint"]);
      const text = hex(t["text"]);
      const failures: string[] = [];
      // Glas boven het donkerste/lichtste mogelijke achtergrondpaar (pagina-achtergrond en kaart), met de dekking van het element.
      for (const [label, base, alpha] of [["icoonknop/menu op pagina", bg, Number(t["glass-strong-alpha"])], ["icoonknop/menu op kaart", elevated, Number(t["glass-strong-alpha"])], ["navigatiebalk op pagina", bg, Number(t["glass-alpha"])], ["navigatiebalk op kaart", elevated, Number(t["glass-alpha"])]] as [string, RGB, number][]) {
        const surface = blend(glassBase, base, alpha);
        if (ratio(tint, surface) < 4.5) failures.push(`${label}: tint ${ratio(tint, surface).toFixed(2)} (surface ${surface.map(Math.round)})`);
        if (ratio(text, surface) < 7 && label.includes("menu")) failures.push(`${label}: tekst ${ratio(text, surface).toFixed(2)}`);
      }
      const fillBase = blend(channels(t["tint-rgb"]), elevated, Number(t["tint-fill-alpha"]));
      if (ratio(tint, fillBase) < 4.5) failures.push(`secundaire knop: tint op tint-vulling ${ratio(tint, fillBase).toFixed(2)}`);
      const field = t["field-bg"].startsWith("#") ? hex(t["field-bg"]) : elevated;
      if (ratio(text, field) < 7) failures.push(`invoerveld: tekst ${ratio(text, field).toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }
  it("invoervelden zijn effen: geen transparantie of blur op input/select", () => {
    const m = bare.match(/(?:^|\n)input, select\s*\{([^}]*)\}/);
    expect(m?.[1]).toBeTruthy();
    expect(m![1]).not.toMatch(/backdrop-filter|rgb\(var\(--glass/);
    expect(m![1]).toMatch(/background: var\(--field-bg\)/);
  });
});

describe("Centrale componentstijlen", () => {
  it("knopvarianten: primair, secundair, destructief, tekst, icoon, uitgeschakeld", () => {
    for (const sel of [".btn-primary", ".btn-secondary", ".btn-destructive", ".btn-plain", ".icon-btn", ".btn:disabled"]) expect(bare).toContain(sel);
    expect(bare).toMatch(/\.btn\s*\{[^}]*border-radius: var\(--radius-pill\)/);
  });
  it("glasbediening (navigatiebalk, terugknop, icoonknop, menu) gebruikt de gedeelde glastokens", () => {
    for (const sel of [".navbar", ".navbar-back", ".icon-btn", ".menu"]) {
      const body = bare.match(new RegExp(`${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(body, sel).toMatch(/var\(--glass-(strong-)?alpha\)/);
      if (sel !== ".navbar-back") expect(body, sel).toMatch(/var\(--glass-blur\)/); // de terugknop ligt al op het glas van de balk
    }
  });
  it("de pagina schuift onder de navigatiebalk door en reserveert de gemeten hoogte", () => {
    expect(bare).toMatch(/\.navbar\s*\{[^}]*margin-bottom: calc\(-1 \* var\(--navbar-h/);
    expect(bare).toMatch(/\.navbar ~ \.page\s*\{\s*padding-top: calc\(var\(--navbar-h/);
  });
  it("statussen en fouten zijn niet alleen met kleur herkenbaar (symbool)", () => {
    for (const tone of ["ok", "warn", "bad"]) expect(bare).toMatch(new RegExp(`\\.status\\.${tone}::before`));
    expect(bare).toMatch(/\.error::before/);
  });
  it("lange teksten breken af en worden niet afgekapt (geen ellipsis in kaarten, rijen en titels)", () => {
    expect(bare).toMatch(/overflow-wrap: anywhere/);
    expect(bare.replace(/\.tab-label\s*\{[^}]*\}/, "")).not.toMatch(/text-overflow:\s*ellipsis/); // alleen de korte, vaste tablabels van de webterugval
    expect(bare).not.toMatch(/\.status\s*\{[^}]*white-space:\s*nowrap/);
  });
  it("dialoogknoppen staan onder elkaar bij grote tekst en alle bediening heeft minimaal 48 px", () => {
    expect(bare).toMatch(/\.dialog-actions\s*\{\s*flex-wrap: wrap/);
    expect(bare).toMatch(/--touch:\s*48px/);
  });
});

describe("Schermen gebruiken alleen de gedeelde bediening", () => {
  const dirs = ["../src/screens", "../src/components"].map((d) => resolve(__dirname, d));
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".tsx")).map((f) => ({ name: f, src: readFileSync(resolve(d, f), "utf8") })));
  it("geen inline kleuren, afrondingen of vaste afmetingen in componenten en schermen", () => {
    const offenders = files.filter((f) => /style=\{\{[^}]*(color|background|border|radius|width|height|fontSize|boxShadow)/i.test(f.src)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });
  it("geen browser-dialogen voor normale appacties (alert, confirm, prompt)", () => {
    const offenders = files.filter((f) => /\bwindow\.(alert|confirm|prompt)\s*\(|(^|[^.\w])(alert|prompt)\s*\(/.test(f.src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))).map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});

describe("NavBar en StatusLabel", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--navbar-h");
    vi.restoreAllMocks();
  });
  it("NavBar meet zijn hoogte voor de paginamarge, heeft één terugknop met duidelijke naam en ruimt op", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 91.2, width: 390, top: 0, left: 0, right: 390, bottom: 91.2, x: 0, y: 0, toJSON: () => ({}) });
    const onBack = vi.fn();
    const { unmount } = render(
      <MemoryRouter>
        <NavBar title="Een heel lange titel van een roeping die over twee regels moet lopen" backLabel="Voorstellen" onBack={onBack} />
      </MemoryRouter>
    );
    expect(document.documentElement.style.getPropertyValue("--navbar-h")).toBe("92px");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    screen.getByRole("button", { name: "Terug naar Voorstellen" }).click();
    expect(onBack).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.documentElement.style.getPropertyValue("--navbar-h")).toBe("");
  });
  it("StatusLabel toont altijd de tekst van de status (kleur en symbool zijn aanvullend)", () => {
    render(<><StatusLabel tone="ok">Akkoord</StatusLabel><StatusLabel tone="warn">Jouw reactie</StatusLabel><StatusLabel tone="bad">Afgewezen</StatusLabel><StatusLabel>Concept</StatusLabel></>);
    for (const t of ["Akkoord", "Jouw reactie", "Afgewezen", "Concept"]) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText("Akkoord").className).toBe("status ok");
  });
});
