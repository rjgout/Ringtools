/**
 * Nederlandse roepingencatalogus voor ringroepingen.
 *
 * Bronnen: (1) de functietitels en organisatiecategorieën uit het door de eigenaar aangeleverde LCR-overzicht (alleen
 * titels/categorieën; geen namen, bezettingen, steundata of unitgegevens), (2) Algemeen handboek 30.6, 30.7 en 30.8.3.
 * Het LCR-overzicht bevat geen functiecodes: de codes hieronder zijn stabiele INTERNE codes (geen LCR-codes).
 *
 * Alle bevoegdheidsregels zijn een samenvatting van het handboek en staan ter controle bij de eigenaar
 * (`reviewNotes`); Ringtools vervangt nooit de bevoegdheden die het handboek vastlegt.
 */
export const CATALOG_VERSION = "2026.11-1";

export type ApprovalRoute = "RINGPRESIDIUM_HOGE_RAAD" | "EERSTE_PRESIDIUM" | "AANGEWEZEN_AUTORITEIT" | "QUORUM_TWAALF";
/** Wie mag roepen/aanstellen. */
export type AuthorityRule =
  | "RINGPRESIDENT"
  | "RINGPRESIDENT_OF_RAADGEVER"
  | "RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID"
  | "BIJZONDER";
export type SupportVenue = "RINGCONFERENTIE" | "GEEN" | "NADER_BEPALEN";
export type AppointmentRequirement = "VERPLICHT" | "OPTIONEEL";
export type FunctionType = "PRESIDENT" | "RAADGEVER" | "SECRETARIS" | "LEIDER" | "DESKUNDIGE" | "LERAAR" | "VERTEGENWOORDIGER" | "OVERIG";

export type CatalogEntry = {
  /** Stabiele interne code (geen LCR-code). */
  code: string;
  name: string;
  /** Eventuele Engelse LCR-benaming als zoekalias. */
  aliases: string[];
  category: string;
  type: FunctionType;
  handbook: string[];
  approvalRoute: ApprovalRoute;
  /** Alleen true als de interne goedkeuring (ringpresidium + hoge raad) in Ringtools wordt gecoördineerd. */
  ringtoolsProcess: boolean;
  /** Eventuele extra goedkeuring buiten Ringtools. */
  extraApproval: string | null;
  grantedBy: AuthorityRule;
  appointedBy: AuthorityRule;
  supportVenue: SupportVenue;
  appointment: AppointmentRequirement;
  /** Verplichte vervolgvragen bij ontheffing (handboek 30.6: ontheffing president(e) ontheft ook de raadgevers). */
  releaseFollowUps: string[];
  /** Waarschuwing die bij selectie getoond wordt. */
  warning: string | null;
  /** Twijfelpunten (vertaling of regel) voor controle door de eigenaar. */
  reviewNotes: string[];
  active: boolean;
  source: "LCR-overzicht" | "opdracht-eigenaar";
  catalogVersion: string;
};

const HB = {
  roepingen: "Algemeen handboek 30.8.3 (roepingen op ringniveau)",
  ontheffing: "Algemeen handboek 30.6 (ontheffingen)",
  bisschop: "Algemeen handboek 30.7 (bisschoppen)",
};

type Overrides = Partial<Omit<CatalogEntry, "name" | "category" | "catalogVersion">>;

function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function entry(category: string, name: string, o: Overrides = {}): CatalogEntry {
  return {
    code: slug(name),
    name,
    aliases: [],
    category,
    type: "OVERIG",
    handbook: [HB.roepingen],
    approvalRoute: "RINGPRESIDIUM_HOGE_RAAD",
    ringtoolsProcess: true,
    extraApproval: null,
    grantedBy: "RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID",
    appointedBy: "RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID",
    supportVenue: "RINGCONFERENTIE",
    appointment: "VERPLICHT",
    releaseFollowUps: [],
    warning: null,
    reviewNotes: [],
    active: true,
    source: "LCR-overzicht",
    catalogVersion: CATALOG_VERSION,
    ...o,
  };
}

const TWIJFEL_VERTALING = "Nederlandse benaming is een uitgangsvertaling van de Engelse LCR-titel; controle door de eigenaar nodig.";
const NIET_BEVESTIGD = "Bevoegdheidsregel niet bevestigd in de beschikbare handboektekst; standaardregel voor overige ringroepingen toegepast. Controle door de eigenaar nodig.";
const BUITEN_RINGTOOLS = "Deze roeping volgt een procedure buiten Ringtools; Ringtools start hier geen goedkeuringsronde voor.";

const RP_OF_RG: Overrides = { grantedBy: "RINGPRESIDENT_OF_RAADGEVER", appointedBy: "RINGPRESIDENT_OF_RAADGEVER" };

export const CALLINGS: CatalogEntry[] = [
  // ---- Ringpresidium ----
  entry("Ringpresidium", "Ringpresident", {
    type: "PRESIDENT", approvalRoute: "AANGEWEZEN_AUTORITEIT", ringtoolsProcess: false, grantedBy: "BIJZONDER", appointedBy: "BIJZONDER",
    extraApproval: "Aangewezen algemeen autoriteit of gebiedszeventiger", warning: BUITEN_RINGTOOLS, handbook: [HB.roepingen],
  }),
  entry("Ringpresidium", "Eerste raadgever ringpresidium", {
    type: "RAADGEVER", approvalRoute: "EERSTE_PRESIDIUM", ringtoolsProcess: false, grantedBy: "BIJZONDER", appointedBy: "BIJZONDER",
    extraApproval: "Eerste Presidium (nieuwe raadgever in een bestaand ringpresidium)", warning: BUITEN_RINGTOOLS,
    reviewNotes: ["Bij een nieuw ringpresidium geldt een aangewezen algemeen autoriteit of gebiedszeventiger; hier is de regel voor een bestaand presidium aangehouden."],
  }),
  entry("Ringpresidium", "Tweede raadgever ringpresidium", {
    type: "RAADGEVER", approvalRoute: "EERSTE_PRESIDIUM", ringtoolsProcess: false, grantedBy: "BIJZONDER", appointedBy: "BIJZONDER",
    extraApproval: "Eerste Presidium (nieuwe raadgever in een bestaand ringpresidium)", warning: BUITEN_RINGTOOLS,
    reviewNotes: ["Bij een nieuw ringpresidium geldt een aangewezen algemeen autoriteit of gebiedszeventiger; hier is de regel voor een bestaand presidium aangehouden."],
  }),
  entry("Ringpresidium", "Ringadministrateur", { type: "SECRETARIS", ...RP_OF_RG }),
  entry("Ringpresidium", "Assistent-ringadministrateur", { type: "SECRETARIS", ...RP_OF_RG }),
  entry("Ringpresidium", "Assistent-ringadministrateur — ledenadministratie", { type: "SECRETARIS", ...RP_OF_RG }),
  entry("Ringpresidium", "Assistent-ringadministrateur — financiën", { type: "SECRETARIS", ...RP_OF_RG }),
  entry("Ringpresidium", "Ringsecretaris", { type: "SECRETARIS", ...RP_OF_RG }),
  entry("Ringpresidium", "Assistent-secretaris van de ring", { type: "SECRETARIS", ...RP_OF_RG }),

  // ---- Hoge raad ----
  entry("Hoge raad", "Hogeraadslid", {
    type: "OVERIG", ...RP_OF_RG, code: "hogeraadslid", aliases: ["Hogeraadslid ring"],
    reviewNotes: ["Naam gestandaardiseerd (LCR-titel: Hogeraadslid ring); controle door de eigenaar nodig."],
  }),

  // ---- Patriarch ----
  entry("Patriarch", "Ringpatriarch", {
    type: "OVERIG", approvalRoute: "QUORUM_TWAALF", ringtoolsProcess: false, grantedBy: "BIJZONDER", appointedBy: "BIJZONDER", code: "ringpatriarch",
    extraApproval: "Quorum der Twaalf", warning: BUITEN_RINGTOOLS, aliases: ["Patriarch"],
    reviewNotes: ["Naam gestandaardiseerd (LCR-titel: Patriarch); controle door de eigenaar nodig."],
  }),

  // ---- Zustershulpvereniging ----
  entry("Zustershulpvereniging van de ring", "ZHV-presidente", {
    type: "PRESIDENT", grantedBy: "RINGPRESIDENT", appointedBy: "RINGPRESIDENT", handbook: [HB.roepingen, HB.ontheffing],
    releaseFollowUps: ["eerste-raadgeefster-zhv-presidium-ring", "tweede-raadgeefster-zhv-presidium-ring"],
  }),
  entry("Zustershulpvereniging van de ring", "Eerste raadgeefster ZHV-presidium (ring)", { type: "RAADGEVER" }),
  entry("Zustershulpvereniging van de ring", "Tweede raadgeefster ZHV-presidium (ring)", { type: "RAADGEVER" }),
  entry("Zustershulpvereniging van de ring", "ZHV-secretaresse", { type: "SECRETARIS" }),

  // ---- Jongemannen ----
  entry("Jongemannen van de ring", "Jongemannenpresident", {
    type: "PRESIDENT", ...RP_OF_RG, handbook: [HB.roepingen, HB.ontheffing],
    releaseFollowUps: ["eerste-raadgever-jongemannen", "tweede-raadgever-jongemannen"],
    warning: "De jongemannenpresident is een hogeraadslid; de aanstelling gebeurt als hogeraadslid én afzonderlijk als organisatiepresident.",
  }),
  entry("Jongemannen van de ring", "Eerste raadgever jongemannen", { type: "RAADGEVER" }),
  entry("Jongemannen van de ring", "Tweede raadgever jongemannen", { type: "RAADGEVER" }),
  entry("Jongemannen van de ring", "Jongemannensecretaris", { type: "SECRETARIS" }),
  entry("Jongemannen van de ring", "Kampleider jongemannen", { type: "LEIDER", aliases: ["Young Men Camp Director"], reviewNotes: [TWIJFEL_VERTALING] }),
  entry("Jongemannen van de ring", "Assistent-kampleider jongemannen", { type: "LEIDER", aliases: ["Young Men Assistant Camp Director"], reviewNotes: [TWIJFEL_VERTALING] }),

  // ---- Jongevrouwen ----
  entry("Jongevrouwen van de ring", "Jongevrouwenpresidente", {
    type: "PRESIDENT", ...RP_OF_RG, handbook: [HB.roepingen, HB.ontheffing],
    releaseFollowUps: ["eerste-raadgeefster-jongevrouwen", "tweede-raadgeefster-jongevrouwen"],
  }),
  entry("Jongevrouwen van de ring", "Eerste raadgeefster jongevrouwen", { type: "RAADGEVER" }),
  entry("Jongevrouwen van de ring", "Tweede raadgeefster jongevrouwen", { type: "RAADGEVER" }),
  entry("Jongevrouwen van de ring", "Jongevrouwensecretaresse", { type: "SECRETARIS" }),
  entry("Jongevrouwen van de ring", "Kampleider jongevrouwen", { type: "LEIDER", aliases: ["Young Women Camp Director"], reviewNotes: [TWIJFEL_VERTALING] }),
  entry("Jongevrouwen van de ring", "Assistent-kampleider jongevrouwen", { type: "LEIDER", aliases: ["Young Women Assistant Camp Director"], reviewNotes: [TWIJFEL_VERTALING] }),

  // ---- Zondagsschool ----
  entry("Zondagsschool van de ring", "Zondagsschoolpresident", {
    type: "PRESIDENT", ...RP_OF_RG, handbook: [HB.roepingen, HB.ontheffing],
    releaseFollowUps: ["eerste-raadgever-zondagsschool", "tweede-raadgever-zondagsschool"],
    warning: "De zondagsschoolpresident is een hogeraadslid; de aanstelling gebeurt als hogeraadslid én afzonderlijk als organisatiepresident.",
  }),
  entry("Zondagsschool van de ring", "Eerste raadgever zondagsschool", { type: "RAADGEVER" }),
  entry("Zondagsschool van de ring", "Tweede raadgever zondagsschool", { type: "RAADGEVER" }),
  entry("Zondagsschool van de ring", "Zondagsschoolsecretaris", { type: "SECRETARIS" }),

  // ---- Jeugdwerk ----
  entry("Jeugdwerk van de ring", "Jeugdwerkpresidente (ring)", {
    type: "PRESIDENT", ...RP_OF_RG, handbook: [HB.roepingen, HB.ontheffing],
    releaseFollowUps: ["eerste-raadgeefster-jw-presidente-ring", "tweede-raadgeefster-jw-presidente-ring"],
  }),
  entry("Jeugdwerk van de ring", "Eerste raadgeefster JW-presidente (ring)", { type: "RAADGEVER" }),
  entry("Jeugdwerk van de ring", "Tweede raadgeefster JW-presidente (ring)", { type: "RAADGEVER" }),
  entry("Jeugdwerk van de ring", "Jeugdwerksecretaresse (ring)", { type: "SECRETARIS" }),
  entry("Jeugdwerk van de ring", "Jeugdwerkdirigente van de ring", { type: "LEIDER" }),

  // ---- Jonge alleenstaanden / alleenstaanden ----
  entry("Jonge alleenstaande", "Adviseur jonge alleenstaanden", { type: "OVERIG" }),
  entry("Jonge alleenstaande", "Ringvertegenwoordig(st)er jonge alleenstaanden", { type: "VERTEGENWOORDIGER" }),
  entry("Jonge alleenstaande", "Voorzitter comité jongvolwassenen", { type: "LEIDER", aliases: ["Young Single Adult Committee Chair"], reviewNotes: [TWIJFEL_VERTALING] }),
  entry("Jonge alleenstaande", "Lid comité jongvolwassenen", { type: "OVERIG", aliases: ["Young Single Adult Committee Member"], reviewNotes: [TWIJFEL_VERTALING] }),
  entry("Alleenstaande", "Vertegenwoordig(st)er alleenstaanden", { type: "VERTEGENWOORDIGER" }),

  // ---- Tempelwerk en familiegeschiedenis ----
  entry("Tempelwerk en familiegeschiedenis van de ring", "Consulent tempelwerk en familiegeschiedenis van de ring", { type: "DESKUNDIGE" }),
  entry("Tempelwerk en familiegeschiedenis van de ring", "Consulent tempelwerk en familiegeschiedenis - centrum voor familiegeschiedenis", { type: "DESKUNDIGE" }),

  // ---- Activiteiten en sporten ----
  entry("Activiteiten en sporten", "Leider culturele activiteiten", { type: "LEIDER" }),
  entry("Activiteiten en sporten", "Deskundige activiteitencomité", {
    type: "DESKUNDIGE",
    warning: "Volgens het handboek (30.8.3, noot 3) worden leden van het activiteitencomité door het ringpresidium uit de hoge raad aangewezen en niet geroepen, gesteund of aangesteld. Controleer of dit voor deze functie geldt.",
    reviewNotes: ["Koppeling met handboeknoot 3 (activiteitencomité) is een aanname; bevestig of deze functie een gewone roeping is."],
  }),
  entry("Activiteiten en sporten", "Leider lichamelijke activiteiten", { type: "LEIDER" }),
  entry("Activiteiten en sporten", "Coördinator sportofficials", { type: "OVERIG" }),
  entry("Activiteiten en sporten", "Sportofficial", { type: "OVERIG" }),
  entry("Activiteiten en sporten", "Sportdeskundige (ring)", { type: "DESKUNDIGE" }),

  // ---- Gebouwen en voorzieningen ----
  entry("Gebouwen en voorzieningen", "Manager/planner trektocht", { type: "LEIDER" }),
  entry("Gebouwen en voorzieningen", "Manager trektocht", { type: "LEIDER" }),
  entry("Gebouwen en voorzieningen", "Planner trektocht", { type: "OVERIG" }),
  entry("Gebouwen en voorzieningen", "Ringvertegenwoordiger onroerend goed", {
    type: "VERTEGENWOORDIGER",
    warning: "Volgens het handboek (30.8.3, noot 3) wordt de ringvertegenwoordiger kerkgebouwen door het ringpresidium uit de hoge raad aangewezen en niet geroepen, gesteund of aangesteld. Controleer of dit voor deze functie geldt.",
    reviewNotes: ["Koppeling met handboeknoot 3 (ringvertegenwoordiger kerkgebouwen) is een aanname."],
  }),
  entry("Gebouwen en voorzieningen", "Gebouwendeskundige (ring)", { type: "DESKUNDIGE" }),
  entry("Gebouwen en voorzieningen", "Ringplanner - gebouwen 1", { type: "OVERIG" }),
  entry("Gebouwen en voorzieningen", "Ringplanner - gebouwen 2", { type: "OVERIG" }),
  entry("Gebouwen en voorzieningen", "Ringplanner - gebouwen 3", { type: "OVERIG" }),
  entry("Gebouwen en voorzieningen", "Ringplanner - gebouwen 4", { type: "OVERIG" }),
  entry("Gebouwen en voorzieningen", "Ringplanner - gebouwen 5", { type: "OVERIG" }),
  entry("Gebouwen en voorzieningen", "Vrijwilliger-zendeling recreatiekamp", { type: "OVERIG" }),
  entry("Gebouwen en voorzieningen", "Manager recreatiekamp van de ring", { type: "LEIDER" }),
  entry("Gebouwen en voorzieningen", "Manager en planner recreatiekamp van de ring", { type: "LEIDER" }),
  entry("Gebouwen en voorzieningen", "Planner recreatiekamp van de ring", { type: "OVERIG" }),

  // ---- Geschiedenis, kerkcommunicatie, kerkwerkzendelingen, muziek, pre-militaire dienst ----
  entry("Geschiedenis", "Geschiedschrijver", { type: "OVERIG" }),
  entry("Kerkcommunicatie", "Communicatiebestuurder", { type: "LEIDER" }),
  entry("Kerkcommunicatie", "Communicatiedeskundige", { type: "DESKUNDIGE" }),
  entry("Kerkcommunicatie", "Assistent-communicatiebestuurder", { type: "OVERIG" }),
  entry("Kerkcommunicatie", "JustServe-deskundige", { type: "DESKUNDIGE" }),
  entry("Kerkwerkzendelingen", "Kerkwerkzendeling van de ring", { type: "OVERIG" }),
  entry("Kerkwerkzendelingen", "Deskundige kerkwerkzendeling", { type: "DESKUNDIGE" }),
  entry("Muziek", "Muziekcoördinator van de ring", { type: "LEIDER" }),
  entry("Muziek", "Muziekadviseur", { type: "OVERIG" }),
  entry("Muziek", "Muziekdeskundige", { type: "DESKUNDIGE" }),
  entry("Pre-militaire dienst", "Instructeur pre-militaire dienst", { type: "LERAAR", reviewNotes: [NIET_BEVESTIGD] }),

  // ---- Seminarie en instituut ----
  entry("Seminarie en instituut", "Instituutshoofd", { type: "LEIDER", reviewNotes: [NIET_BEVESTIGD] }),
  entry("Seminarie en instituut", "Instituutsleerkracht", { type: "LERAAR" }),
  entry("Seminarie en instituut", "Seminariehoofd", { type: "LEIDER", reviewNotes: [NIET_BEVESTIGD] }),
  entry("Seminarie en instituut", "Seminarieleerkracht", { type: "LERAAR" }),

  // ---- Technologie ----
  entry("Technologie", "Technisch specialist", { type: "DESKUNDIGE", reviewNotes: [NIET_BEVESTIGD] }),
  entry("Technologie", "Ringtolk", { type: "OVERIG", aliases: ["Stake Interpreter"], reviewNotes: [TWIJFEL_VERTALING] }),
  entry("Technologie", "Coördinator tolkendienst van de ring", { type: "LEIDER", aliases: ["Stake Interpretation Coordinator"], reviewNotes: [TWIJFEL_VERTALING] }),

  // ---- Verifiëren ----
  entry("Verifiëren", "Voorzitter verificatiecomité", {
    type: "LEIDER", reviewNotes: ["Volgens het handboek is de voorzitter van het verificatiecomité een raadgever in het ringpresidium; bevestig of hiervoor een afzonderlijke roeping nodig is."],
  }),
  entry("Verifiëren", "Lid verificatiecomité", { type: "OVERIG", reviewNotes: [NIET_BEVESTIGD] }),
  entry("Verifiëren", "Verificateur", {
    type: "OVERIG", ...RP_OF_RG, aliases: ["Ringverificateur"], supportVenue: "GEEN", appointment: "OPTIONEEL",
    warning: "Voor een verificateur is geen steunverlening; de ringpresident bepaalt of een aanstelling nodig is (handboek 30.8.3).",
  }),

  // ---- Voor de kracht van de jeugd, welzijn en zelfredzaamheid ----
  entry("Voor de kracht van de jeugd", "FSY-vertegenwoordiger", { type: "VERTEGENWOORDIGER", aliases: ["FSY representative"], reviewNotes: [NIET_BEVESTIGD] }),
  entry("Welzijn en zelfredzaamheid", "Begeleider zelfredzaamheidsgroep", { type: "OVERIG" }),
  entry("Welzijn en zelfredzaamheid", "Ringdeskundige handicaps", { type: "DESKUNDIGE" }),
  entry("Welzijn en zelfredzaamheid", "Activiteitenleid(st)er voor leden met een handicap", { type: "LEIDER" }),
  entry("Welzijn en zelfredzaamheid", "Welzijns- en zelfredzaamheidsdeskundige van de ring", { type: "DESKUNDIGE" }),

  // ---- Uitzondering: raadgevers in een bisschap (afgesproken met de eigenaar) ----
  entry("Bisschap (uitzondering)", "Eerste raadgever in de bisschap", {
    type: "RAADGEVER", source: "opdracht-eigenaar", grantedBy: "BIJZONDER", appointedBy: "BIJZONDER", handbook: [HB.bisschop],
    warning: "Uitzondering: de goedkeuring van een raadgever in een bisschap verloopt via ringpresidium en hoge raad. De bisschop zelf valt buiten Ringtools.",
    reviewNotes: ["Wie mag roepen en aanstellen is niet uit de beschikbare handboektekst bevestigd; controle door de eigenaar nodig."],
  }),
  entry("Bisschap (uitzondering)", "Tweede raadgever in de bisschap", {
    type: "RAADGEVER", source: "opdracht-eigenaar", grantedBy: "BIJZONDER", appointedBy: "BIJZONDER", handbook: [HB.bisschop],
    warning: "Uitzondering: de goedkeuring van een raadgever in een bisschap verloopt via ringpresidium en hoge raad. De bisschop zelf valt buiten Ringtools.",
    reviewNotes: ["Wie mag roepen en aanstellen is niet uit de beschikbare handboektekst bevestigd; controle door de eigenaar nodig."],
  }),
];

export const CATEGORIES: string[] = [...new Set(CALLINGS.map((c) => c.category))];

const BY_CODE = new Map(CALLINGS.map((c) => [c.code, c]));
export function getCatalogEntry(code: string): CatalogEntry | null {
  return BY_CODE.get(code) ?? null;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Doorzoekt de catalogus op naam, alias en categorie (zonder accenten/hoofdletters). Voorvoegsel-treffers eerst. */
export function searchCatalog(query: string, opts: { category?: string; includeInactive?: boolean } = {}): CatalogEntry[] {
  const q = normalize(query);
  const words = q.split(" ").filter(Boolean);
  const scored: { entry: CatalogEntry; score: number }[] = [];
  for (const c of CALLINGS) {
    if (!c.active && !opts.includeInactive) continue;
    if (opts.category && c.category !== opts.category) continue;
    if (words.length === 0) {
      scored.push({ entry: c, score: 0 });
      continue;
    }
    const names = [c.name, ...c.aliases].map(normalize);
    const hay = `${names.join(" ")} ${normalize(c.category)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const score = names.some((n) => n === q) ? 3 : names.some((n) => n.startsWith(q)) ? 2 : names.some((n) => n.includes(q)) ? 1 : 0;
    scored.push({ entry: c, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name, "nl")).map((s) => s.entry);
}
