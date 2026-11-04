import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CALLINGS, CATALOG_VERSION, CATEGORIES, getCatalogEntry, renderReviewMarkdown, requiresProcedureConfirmation, reviewOverview, searchCatalog } from "@/lib/catalog/callings";

describe("Roepingencatalogus: structuur", () => {
  it("heeft unieke, stabiele interne codes en een versie; geen verzonnen LCR-codes", () => {
    const codes = CALLINGS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of CALLINGS) {
      expect(c.code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.catalogVersion).toBe(CATALOG_VERSION);
      expect(c.name.length).toBeGreaterThan(2);
    }
    expect(CATALOG_VERSION).toMatch(/^\d{4}\.\d{2}-\d+$/);
  });

  it("verwijst bij ontheffing alleen naar bestaande vervolgfuncties (president(e) → eerste en tweede raadgever)", () => {
    const presidents = CALLINGS.filter((c) => c.releaseFollowUps.length > 0);
    expect(presidents.map((c) => c.name)).toEqual([
      "ZHV-presidente", "Jongemannenpresident", "Jongevrouwenpresidente", "Zondagsschoolpresident", "Jeugdwerkpresidente (ring)",
    ]);
    for (const p of presidents) {
      expect(p.releaseFollowUps).toHaveLength(2);
      for (const code of p.releaseFollowUps) expect(getCatalogEntry(code)?.type).toBe("RAADGEVER");
    }
    // geen vervolgvragen bij secretarissen of andere functies die niet automatisch mee worden ontheven
    expect(CALLINGS.filter((c) => c.type === "SECRETARIS").every((c) => c.releaseFollowUps.length === 0)).toBe(true);
  });

  it("is Nederlandstalig: Engelse LCR-titels zijn vertaald en alleen als alias vindbaar, met controlemarkering", () => {
    const vertalingen: [string, string][] = [
      ["Young Men Camp Director", "Kampleider jongemannen"],
      ["Young Women Camp Director", "Kampleider jongevrouwen"],
      ["Young Single Adult Committee Chair", "Voorzitter comité jongvolwassenen"],
      ["Stake Interpreter", "Ringtolk"],
      ["Stake Interpretation Coordinator", "Coördinator tolkendienst van de ring"],
    ];
    for (const [english, dutch] of vertalingen) {
      const hit = searchCatalog(english)[0];
      expect(hit.name).toBe(dutch);
      expect(hit.reviewNotes.join(" ")).toMatch(/uitgangsvertaling/);
    }
    expect(CALLINGS.some((c) => /\b(Director|Interpreter|Chair|Committee)\b/.test(c.name))).toBe(false);
  });
});

describe("Roepingencatalogus: privacy (geen persoonsgegevens uit het LCR-overzicht)", () => {
  it("bevat alleen functietitels en categorieën: geen namen, datums, units of lidmaatschapsinformatie", () => {
    const text = JSON.stringify(CALLINGS.map(({ catalogVersion, ...rest }) => { void catalogVersion; return rest; })); // de cataloguversie is geen persoonsdatum
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/); // geen datums van steunverlening
    expect(text).not.toMatch(/\b(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)\b \d{4}/i);
    for (const c of CALLINGS) {
      expect(c.name).not.toMatch(/^[A-ZÀ-Ý][\wà-ÿ'’ -]+, [A-ZÀ-Ý]/); // "Achternaam, Voornaam"
      expect(c.name).not.toMatch(/^(Wijk|Gemeente) /);
      expect(Object.keys(c)).not.toContain("person");
    }
    // geen "Roeping vacant" of "Aantal:" uit het bronoverzicht
    expect(text).not.toMatch(/vacant|Aantal:/i);
    expect(CATEGORIES).not.toContain("Overige roepingen"); // koptekst uit de bron, geen categorie
  });

  it("het LCR-bronbestand (print.pdf) staat niet in de repository", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".git", ".next", "dist", "build", "test-results"].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.pdf$/i.test(name)) found.push(full);
      }
    };
    walk(process.cwd());
    expect(found).toEqual([]);
  });
});

describe("Roepingencatalogus: bevoegdheden per standaardroeping", () => {
  const rule = (name: string) => CALLINGS.find((c) => c.name === name)!;

  it("gebruikt per functie de juiste regel (geen algemene regel voor alle ringroepingen)", () => {
    expect(rule("Ringadministrateur")).toMatchObject({ grantedBy: "RINGPRESIDENT_OF_RAADGEVER", appointedBy: "RINGPRESIDENT_OF_RAADGEVER", ringtoolsProcess: true });
    expect(rule("ZHV-presidente")).toMatchObject({ grantedBy: "RINGPRESIDENT", appointedBy: "RINGPRESIDENT" });
    expect(rule("Hogeraadslid")).toMatchObject({ appointedBy: "RINGPRESIDENT_OF_RAADGEVER" });
    expect(rule("Seminarieleerkracht")).toMatchObject({ appointedBy: "RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID" });
    expect(rule("Ringsecretaris")).toMatchObject({ appointedBy: "RINGPRESIDENT_OF_RAADGEVER" });
  });

  it("de verificateur heeft geen steunverlening en een optionele aanstelling (uitzondering)", () => {
    expect(rule("Verificateur")).toMatchObject({ supportVenue: "GEEN", appointment: "OPTIONEEL" });
    expect(rule("Hogeraadslid")).toMatchObject({ supportVenue: "RINGCONFERENTIE", appointment: "VERPLICHT" });
  });

  it("ringpresident, nieuwe ringraadgevers en patriarch lopen via een procedure buiten Ringtools", () => {
    for (const n of ["Ringpresident", "Eerste raadgever ringpresidium", "Tweede raadgever ringpresidium", "Ringpatriarch"]) {
      expect(rule(n)).toMatchObject({ ringtoolsProcess: false, appointedBy: "BIJZONDER" });
      expect(rule(n).extraApproval).toBeTruthy();
    }
  });

  it("de bisschop zelf is niet opgenomen; alleen de raadgevers in een bisschap (afgesproken uitzondering)", () => {
    expect(CALLINGS.some((c) => /^bisschop$/i.test(c.name))).toBe(false);
    const bisschap = CALLINGS.filter((c) => c.category === "Bisschap (uitzondering)");
    expect(bisschap.map((c) => c.name)).toEqual(["Eerste raadgever in de bisschap", "Tweede raadgever in de bisschap"]);
    expect(bisschap.every((c) => c.source === "opdracht-eigenaar" && c.reviewNotes.length > 0)).toBe(true);
  });

  it("twijfelachtige regels en vertalingen zijn gemarkeerd voor controle", () => {
    expect(CALLINGS.filter((c) => c.reviewNotes.length > 0).length).toBeGreaterThan(10);
    expect(rule("Instituutshoofd").reviewNotes.join(" ")).toMatch(/niet geverifieerd/);
  });
});

describe("Roepingencatalogus: zoeken", () => {
  it("zoekt op naam, categorie, alias en zonder accenten of hoofdletters", () => {
    expect(searchCatalog("ringtolk")[0].name).toBe("Ringtolk");
    expect(searchCatalog("TOLK").map((c) => c.name)).toContain("Coördinator tolkendienst van de ring");
    expect(searchCatalog("coordinator tolk")[0].name).toBe("Coördinator tolkendienst van de ring");
    expect(searchCatalog("verifieren").every((c) => c.category === "Verifiëren" || /verifi/i.test(c.name))).toBe(true);
    expect(searchCatalog("", { category: "Muziek" }).map((c) => c.name)).toEqual(["Muziekadviseur", "Muziekcoördinator van de ring", "Muziekdeskundige"]);
    expect(searchCatalog("bestaatniet")).toEqual([]);
  });

  it("zet voorvoegsel-treffers vóór losse treffers", () => {
    const names = searchCatalog("seminarie").map((c) => c.name);
    expect(names[0]).toMatch(/^Seminarie/);
  });
});

describe("Roepingencatalogus: controle tegen de aangeleverde titellijst (alleen functietitels)", () => {
  // tests/fixtures/lcr-functietitels.json bevat uitsluitend functietitels, categorieën en vertaalstatus uit de door de
  // eigenaar aangeleverde lijst zonder personen. Geen namen, bezettingen, datums of units.
  const fixture: { categorie: string; lcr: string; nl: string; status: string }[] = JSON.parse(
    readFileSync(join(process.cwd(), "tests/fixtures/lcr-functietitels.json"), "utf8")
  );
  const names = (c: (typeof CALLINGS)[number]) => [c.name, ...c.aliases];

  it("elke titel uit de lijst is aanwezig in de juiste categorie (op Nederlandse of LCR-naam)", () => {
    expect(fixture.length).toBe(89);
    for (const row of fixture) {
      const hit = CALLINGS.find((c) => c.category === row.categorie && (names(c).includes(row.nl) || names(c).includes(row.lcr)));
      expect(hit, `${row.categorie} / ${row.nl}`).toBeTruthy();
      expect(hit!.name).toBe(row.nl); // de Nederlandse functienaam uit de lijst is de weergavenaam
    }
  });

  it("de catalogus bevat niets extra's behalve de afgesproken uitzondering (raadgevers in een bisschap)", () => {
    const unique = new Set(fixture.map((r) => `${r.categorie}|${r.nl}`));
    const extra = CALLINGS.filter((c) => !unique.has(`${c.category}|${c.name}`) && c.category !== "Bisschap (uitzondering)");
    expect(extra.map((c) => c.name)).toEqual([]);
  });

  it("voorlopige vertalingen en gestandaardiseerde namen zijn gemarkeerd voor controle door de eigenaar", () => {
    for (const row of fixture.filter((r) => r.status !== "Overgenomen uit Nederlandstalige LCR-lijst")) {
      const hit = CALLINGS.find((c) => c.category === row.categorie && c.name === row.nl)!;
      expect(hit.reviewNotes.length, row.nl).toBeGreaterThan(0);
      if (row.lcr !== row.nl) expect(hit.aliases).toContain(row.lcr); // LCR-naam blijft vindbaar
    }
  });
});

describe("Roepingencatalogus: verificatiestatus (geen ruimste standaardbevoegdheid bij onbekende regels)", () => {
  const verified = () => CALLINGS.filter((c) => c.ruleStatus === "GEVERIFIEERD");

  it("alleen expliciet genoemde functies zijn geverifieerd; alle andere regels zijn onbekend of bijzonder", () => {
    expect(verified().map((c) => c.name).sort()).toEqual([
      "Assistent-ringadministrateur", "Assistent-ringadministrateur — financiën", "Assistent-ringadministrateur — ledenadministratie",
      "Assistent-secretaris van de ring", "Coördinator tolkendienst van de ring",
      "Eerste raadgever jongemannen", "Eerste raadgever zondagsschool", "Eerste raadgeefster JW-presidente (ring)", "Eerste raadgeefster ZHV-presidium (ring)", "Eerste raadgeefster jongevrouwen",
      "Hogeraadslid", "Instituutsleerkracht", "Jeugdwerkpresidente (ring)", "Jeugdwerksecretaresse (ring)", "Jongemannenpresident", "Jongemannensecretaris",
      "Jongevrouwenpresidente", "Jongevrouwensecretaresse", "Ringadministrateur", "Ringsecretaris", "Seminarieleerkracht",
      "Tweede raadgever jongemannen", "Tweede raadgever zondagsschool", "Tweede raadgeefster JW-presidente (ring)", "Tweede raadgeefster ZHV-presidium (ring)", "Tweede raadgeefster jongevrouwen",
      "Verificateur", "Welzijns- en zelfredzaamheidsdeskundige van de ring", "ZHV-presidente", "ZHV-secretaresse", "Zondagsschoolpresident", "Zondagsschoolsecretaris",
    ].sort());
    for (const c of CALLINGS.filter((x) => x.ruleStatus === "TE_BEOORDELEN")) {
      expect(c.grantedBy, c.name).toBe("ONBEKEND");
      expect(c.appointedBy, c.name).toBe("ONBEKEND");
      expect(c.appointment, c.name).toBe("ONBEKEND");
      expect(c.supportVenue, c.name).toBe("NADER_BEPALEN");
      expect(c.warning, c.name).toMatch(/Menselijke controle nodig/);
      expect(c.reviewNotes.length, c.name).toBeGreaterThan(0);
      expect(requiresProcedureConfirmation(c)).toBe(true);
    }
    for (const c of CALLINGS.filter((x) => x.ruleStatus === "BIJZONDER")) expect(c.ringtoolsProcess, c.name).toBe(false);
    for (const c of verified()) {
      expect(c.grantedBy).not.toBe("ONBEKEND");
      expect(requiresProcedureConfirmation(c)).toBe(false);
    }
  });

  it("de twijfelgevallen en handboeknoot 3 behouden hun controlepunten en tonen een waarschuwing", () => {
    for (const n of ["Instituutshoofd", "Seminariehoofd", "Voorzitter verificatiecomité", "Lid verificatiecomité", "Technisch specialist", "Instructeur pre-militaire dienst", "Eerste raadgever in de bisschap", "Tweede raadgever in de bisschap", "Deskundige activiteitencomité", "Ringvertegenwoordiger onroerend goed"]) {
      const c = CALLINGS.find((x) => x.name === n)!;
      expect(c.ruleStatus, n).toBe("TE_BEOORDELEN");
      expect(c.warning, n).toMatch(/Menselijke controle nodig/);
    }
    expect(CALLINGS.find((c) => c.name === "Deskundige activiteitencomité")!.warning).toMatch(/noot 3/);
  });

  it("levert een overzicht van alle nog te controleren regels", () => {
    const o = reviewOverview();
    expect(o.version).toBe(CATALOG_VERSION);
    expect(o.total).toBe(CALLINGS.length);
    expect(o.verified).toBe(verified().length);
    expect(o.items.length).toBeGreaterThan(40);
    expect(o.items.every((i) => i.status !== "GEVERIFIEERD" || i.notes.length > 0)).toBe(true);
    expect(o.items.find((i) => i.name === "Ringtolk")?.notes.join(" ")).toMatch(/uitgangsvertaling/);
  });
});

describe("Roepingencatalogus: controleoverzicht voor de eigenaar", () => {
  it("docs/CATALOGUS-CONTROLE.md is actueel (genereer opnieuw met `npm run catalog:review`)", () => {
    const doc = readFileSync(join(process.cwd(), "docs/CATALOGUS-CONTROLE.md"), "utf8");
    expect(doc).toBe(renderReviewMarkdown());
    expect(doc).toMatch(/Instituutshoofd/);
    expect(doc).not.toMatch(/vacant|Aantal:/i);
  });
});
