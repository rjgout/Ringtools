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
export const CATALOG_VERSION = "2026.11-2";

export type ApprovalRoute = "RINGPRESIDIUM_HOGE_RAAD" | "EERSTE_PRESIDIUM" | "AANGEWEZEN_AUTORITEIT" | "QUORUM_TWAALF";
/** Wie mag roepen/aanstellen. */
export type AuthorityRule =
  | "RINGPRESIDENT"
  | "RINGPRESIDENT_OF_RAADGEVER"
  | "RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID"
  | "BIJZONDER"
  /** Onbekend: de juiste bevoegdheid is niet geverifieerd. Er worden dan geen bevoegdheden toegekend; menselijke controle is nodig. */
  | "ONBEKEND";
export type SupportVenue = "RINGCONFERENTIE" | "GEEN" | "NADER_BEPALEN";
export type AppointmentRequirement = "VERPLICHT" | "OPTIONEEL" | "ONBEKEND";
/**
 * GEVERIFIEERD: de regel staat expliciet in het handboek (30.8.3, zoals aangeleverd) voor déze functie.
 * TE_BEOORDELEN: de regel is niet geverifieerd; Ringtools kent geen bevoegdheden toe en vraagt menselijke controle.
 * BIJZONDER: bijzondere procedure (extra goedkeuring buiten Ringtools).
 */
export type RuleStatus = "GEVERIFIEERD" | "TE_BEOORDELEN" | "BIJZONDER";
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
  ruleStatus: RuleStatus;
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
    // Veilige standaard: onbekend. Geen ruimste bevoegdheid aannemen zolang de regel niet is geverifieerd.
    grantedBy: "ONBEKEND",
    appointedBy: "ONBEKEND",
    supportVenue: "NADER_BEPALEN",
    appointment: "ONBEKEND",
    ruleStatus: "TE_BEOORDELEN",
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
const NIET_BEVESTIGD = "Bevoegdheidsregel niet geverifieerd: de regels voor roepen, aanstellen, steunverlening en aanstellingsplicht staan hier als onbekend. Controle door de eigenaar nodig.";
const BUITEN_RINGTOOLS = "Deze roeping volgt een procedure buiten Ringtools; Ringtools start hier geen goedkeuringsronde voor.";

/** Geverifieerde regel (expliciet genoemd in handboek 30.8.3): wie mag roepen/aanstellen, steunverlening in ringconferentie, aanstelling verplicht. */
function V(rule: AuthorityRule = "RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID"): Overrides {
  return { ruleStatus: "GEVERIFIEERD", grantedBy: rule, appointedBy: rule, supportVenue: "RINGCONFERENTIE", appointment: "VERPLICHT" };
}
const RP_OF_RG: Overrides = V("RINGPRESIDENT_OF_RAADGEVER");
const BIJZONDER: Overrides = { ruleStatus: "BIJZONDER", grantedBy: "BIJZONDER", appointedBy: "BIJZONDER", supportVenue: "NADER_BEPALEN", appointment: "ONBEKEND" };
const HUMAN_CHECK =
  "Menselijke controle nodig: de bevoegdheden voor roepen en aanstellen, de steunverlening en de aanstellingsplicht zijn voor deze functie niet geverifieerd. Ringtools kent hier geen bevoegdheden aan toe.";

const RAW: CatalogEntry[] = [
  // ---- Ringpresidium ----
  entry("Ringpresidium", "Ringpresident", {
    type: "PRESIDENT", approvalRoute: "AANGEWEZEN_AUTORITEIT", ringtoolsProcess: false, ...BIJZONDER,
    extraApproval: "Aangewezen algemeen autoriteit of gebiedszeventiger", warning: BUITEN_RINGTOOLS, handbook: [HB.roepingen],
  }),
  entry("Ringpresidium", "Eerste raadgever ringpresidium", {
    type: "RAADGEVER", approvalRoute: "EERSTE_PRESIDIUM", ringtoolsProcess: false, ...BIJZONDER,
    extraApproval: "Eerste Presidium (nieuwe raadgever in een bestaand ringpresidium)", warning: BUITEN_RINGTOOLS,
    reviewNotes: ["Bij een nieuw ringpresidium geldt een aangewezen algemeen autoriteit of gebiedszeventiger; hier is de regel voor een bestaand presidium aangehouden."],
  }),
  entry("Ringpresidium", "Tweede raadgever ringpresidium", {
    type: "RAADGEVER", approvalRoute: "EERSTE_PRESIDIUM", ringtoolsProcess: false, ...BIJZONDER,
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
    type: "OVERIG", approvalRoute: "QUORUM_TWAALF", ringtoolsProcess: false, ...BIJZONDER, code: "ringpatriarch",
    extraApproval: "Quorum der Twaalf", warning: BUITEN_RINGTOOLS, aliases: ["Patriarch"],
    reviewNotes: ["Naam gestandaardiseerd (LCR-titel: Patriarch); controle door de eigenaar nodig."],
  }),

  // ---- Zustershulpvereniging ----
  entry("Zustershulpvereniging van de ring", "ZHV-presidente", {
    type: "PRESIDENT", ...V("RINGPRESIDENT"), handbook: [HB.roepingen, HB.ontheffing],
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
    type: "OVERIG", ...V("RINGPRESIDENT_OF_RAADGEVER"), aliases: ["Ringverificateur"], supportVenue: "GEEN", appointment: "OPTIONEEL",
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
    type: "RAADGEVER", source: "opdracht-eigenaar", handbook: [HB.bisschop],
    warning: "Uitzondering: de goedkeuring van een raadgever in een bisschap verloopt via ringpresidium en hoge raad. De bisschop zelf valt buiten Ringtools.",
    reviewNotes: ["Wie mag roepen en aanstellen is niet uit de beschikbare handboektekst bevestigd; controle door de eigenaar nodig."],
  }),
  entry("Bisschap (uitzondering)", "Tweede raadgever in de bisschap", {
    type: "RAADGEVER", source: "opdracht-eigenaar", handbook: [HB.bisschop],
    warning: "Uitzondering: de goedkeuring van een raadgever in een bisschap verloopt via ringpresidium en hoge raad. De bisschop zelf valt buiten Ringtools.",
    reviewNotes: ["Wie mag roepen en aanstellen is niet uit de beschikbare handboektekst bevestigd; controle door de eigenaar nodig."],
  }),
];

/**
 * Functies die in handboek 30.8.3 expliciet worden genoemd als "raadgever/secretaris in organisatiepresidium ring",
 * "seminarie- en instituutsleerkracht", "welzijnsdeskundige" of "tolkencoördinator" (ringpresident, aangewezen raadgever of hogeraadslid).
 */
const VERIFIED_RPRGH = new Set([
  "Eerste raadgeefster ZHV-presidium (ring)", "Tweede raadgeefster ZHV-presidium (ring)", "ZHV-secretaresse",
  "Eerste raadgever jongemannen", "Tweede raadgever jongemannen", "Jongemannensecretaris",
  "Eerste raadgeefster jongevrouwen", "Tweede raadgeefster jongevrouwen", "Jongevrouwensecretaresse",
  "Eerste raadgever zondagsschool", "Tweede raadgever zondagsschool", "Zondagsschoolsecretaris",
  "Eerste raadgeefster JW-presidente (ring)", "Tweede raadgeefster JW-presidente (ring)", "Jeugdwerksecretaresse (ring)",
  "Instituutsleerkracht", "Seminarieleerkracht",
  "Welzijns- en zelfredzaamheidsdeskundige van de ring", "Coördinator tolkendienst van de ring",
]);

export const CALLINGS: CatalogEntry[] = RAW.map((e) => {
  const verified = VERIFIED_RPRGH.has(e.name) ? { ...e, ...V() } : e;
  if (verified.ruleStatus !== "TE_BEOORDELEN") return verified;
  // Niet geverifieerd: expliciete waarschuwing en controlepunt, nooit een stilzwijgende standaardbevoegdheid.
  return {
    ...verified,
    warning: [verified.warning, HUMAN_CHECK].filter(Boolean).join(" "),
    reviewNotes: verified.reviewNotes.includes(NIET_BEVESTIGD) ? verified.reviewNotes : [...verified.reviewNotes, NIET_BEVESTIGD],
  };
});

export const CATEGORIES: string[] = [...new Set(CALLINGS.map((c) => c.category))];

function normName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * De bisschop zelf (handboek 30.7) volgt een procedure buiten de normale Ringtools-goedkeuring. De catalogus bevat hem daarom niet; deze
 * controle voorkomt dat hij via een eigen roeping alsnog in een Ringtools-proces terechtkomt. Raadgevers in de bisschap vallen er niet onder.
 */
export function isBishopFunctionName(name: string): boolean {
  const n = normName(name);
  return /\bbisschop\b/.test(n) && !/raadgever|raadgeefster|secretaris|secretaresse|administrateur/.test(n);
}
export const BISHOP_OUTSIDE_RINGTOOLS = "De procedure voor een bisschop (handboek 30.7) loopt buiten de normale Ringtools-goedkeuring; hiervoor kan in Ringtools niets worden ingediend.";

/** Gangbare schrijfwijzen van functies met een procedure buiten Ringtools, naast de exacte catalogusnamen (aanvullend; bewust strikt ankerend). */
const OUTSIDE_PATTERNS: RegExp[] = [
  /^(de )?(ring ?president|president van (de )?ring)$/,
  /^(de )?(eerste|tweede|1e|2e)? ?raadgever (in )?(het |de )?(ring ?presidium|presidium van (de )?ring)$/,
  /^(de )?(ring ?presidium) (eerste|tweede) raadgever$/,
  /^(de )?(ring ?)?patriarch$/,
];
let outsideNames: Set<string> | null = null;
/**
 * Is dit (eigen) roepingsnaam een functie met een procedure buiten Ringtools (ringpresident, raadgevers in het ringpresidium, ringpatriarch,
 * bisschop)? Afgeleid van de catalogus (`ringtoolsProcess = false`) plus gangbare varianten. Anker-vergelijking op de volledige naam, zodat
 * functies met vergelijkbare woorden (bijv. "Jongemannenpresident", "Eerste raadgever jongemannen", "Raadgever in de bisschap") niet worden geblokkeerd.
 */
export function isOutsideRingtoolsFunctionName(name: string): boolean {
  if (!outsideNames) {
    outsideNames = new Set<string>();
    for (const c of CALLINGS) if (!c.ringtoolsProcess) for (const n of [c.name, ...c.aliases]) outsideNames.add(normName(n));
  }
  const n = normName(name);
  if (!n) return false;
  return outsideNames.has(n) || OUTSIDE_PATTERNS.some((r) => r.test(n)) || isBishopFunctionName(name);
}
export const OUTSIDE_RINGTOOLS = "Deze functie volgt een procedure buiten Ringtools (ringpresident, raadgevers in het ringpresidium, ringpatriarch en bisschop). Hiervoor kan geen eigen roeping worden gebruikt of ingediend.";

/** Functies waarvan de betrokkene (ook) hogeraadslid is: de ontheffing vereist dan eerst persoonlijke kennisgeving vóór de hogeraadronde. */
export const HOGERAAD_FUNCTION_CODES = new Set(["hogeraadslid", "jongemannenpresident", "zondagsschoolpresident"]);

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

/** Vereist deze functie een expliciete bevestiging dat de bevoegde leiding de procedure heeft gecontroleerd? */
export function requiresProcedureConfirmation(entry: CatalogEntry): boolean {
  return entry.ruleStatus !== "GEVERIFIEERD";
}

export type ReviewItem = { code: string; name: string; category: string; status: RuleStatus; notes: string[] };

/** Overzicht van alle nog te controleren regels (voor de eigenaar). */
export function reviewOverview(): { version: string; total: number; verified: number; items: ReviewItem[] } {
  const items = CALLINGS.filter((c) => c.ruleStatus !== "GEVERIFIEERD" || c.reviewNotes.length > 0).map((c) => ({
    code: c.code, name: c.name, category: c.category, status: c.ruleStatus, notes: c.reviewNotes,
  }));
  return { version: CATALOG_VERSION, total: CALLINGS.length, verified: CALLINGS.filter((c) => c.ruleStatus === "GEVERIFIEERD").length, items };
}

/** Markdown-overzicht van alle nog te controleren regels (docs/CATALOGUS-CONTROLE.md; wordt door een test actueel gehouden). */
export function renderReviewMarkdown(): string {
  const o = reviewOverview();
  const group = (status: RuleStatus) => o.items.filter((i) => i.status === status);
  const table = (items: ReviewItem[]) =>
    ["| Functie | Categorie | Te controleren |", "|---|---|---|", ...items.map((i) => `| ${i.name} | ${i.category} | ${i.notes.map((n) => n.replace(/\|/g, "/")).join(" ")} |`)].join("\n");
  return [
    "# Catalogus roepingen – te controleren regels",
    "",
    "> Automatisch gegenereerd uit `src/lib/catalog/callings.ts` (`npm run catalog:review`). Niet handmatig aanpassen; wijzig de catalogus en genereer opnieuw.",
    "",
    `Cataloguversie **${o.version}** · ${o.total} functies · ${o.verified} met geverifieerde regel · ${o.items.length} met een controlepunt.`,
    "",
    "**Betekenis:** *geverifieerd* = de regel staat expliciet in het handboek (30.8.3, zoals aangeleverd). *Te beoordelen* = onbekend; Ringtools kent geen bevoegdheden toe, toont \"menselijke controle nodig\" en vraagt bij gebruik een bevestiging van de bevoegde leiding.",
    "*Bijzonder* = procedure buiten Ringtools. De bevoegdheidsregels zijn gebaseerd op een samenvatting van het handboek en staan ter controle bij de eigenaar.",
    "",
    `## Te beoordelen (${group("TE_BEOORDELEN").length})`,
    "",
    table(group("TE_BEOORDELEN")),
    "",
    `## Bijzondere procedure buiten Ringtools (${group("BIJZONDER").length})`,
    "",
    table(group("BIJZONDER")),
    "",
    `## Geverifieerd, maar met een controlepunt (${group("GEVERIFIEERD").length})`,
    "",
    table(group("GEVERIFIEERD")),
    "",
  ].join("\n");
}
