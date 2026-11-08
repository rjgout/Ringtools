/**
 * Navigatielogica van de app (HIG: tabbalk voor de hoofdgebieden, navigatiebalk met terugknop voor diepere schermen).
 * Alles hier is puur en getest (tests/navigation.test.ts); de componenten gebruiken alleen deze functies.
 */
export type TabId = "overzicht" | "voorstellen" | "meldingen" | "profiel" | "beheer";

export const TAB_ROOT: Record<TabId, string> = {
  overzicht: "/",
  voorstellen: "/voorstellen",
  meldingen: "/meldingen",
  profiel: "/profiel",
  beheer: "/beheer/gebruikers",
};

/** Bij welk hoofdgebied een pad hoort (voor de actieve tab). Onbekende paden vallen terug op het overzicht. */
export function tabForPath(pathname: string): TabId {
  if (pathname.startsWith("/voorstellen") || pathname.startsWith("/roepingen") || pathname.startsWith("/ontheffingen")) return "voorstellen";
  if (pathname.startsWith("/meldingen")) return "meldingen";
  if (pathname.startsWith("/profiel")) return "profiel";
  if (pathname.startsWith("/beheer")) return "beheer";
  return "overzicht"; // ook /open/…
}

/** Hoofdschermen tonen een grote titel; alle andere schermen een navigatiebalk met terugknop. */
export function isTabRoot(pathname: string): boolean {
  return pathname === "/" || pathname === "/voorstellen" || pathname === "/meldingen" || pathname === "/profiel" || pathname.startsWith("/beheer");
}

/** Het bovenliggende scherm van een dieper scherm, voor de terugknop als er geen eerdere stap in de geschiedenis is (bijvoorbeeld na een melding of link). */
export function parentPath(pathname: string): string {
  if (pathname.startsWith("/voorstellen/")) return "/voorstellen";
  if (pathname.startsWith("/roepingen/")) return "/voorstellen";
  if (pathname.startsWith("/ontheffingen")) return "/voorstellen"; // ontheffingen staan in de lijst bij Voorstellen
  return "/";
}

const TITLES: [RegExp, string][] = [
  [/^\/voorstellen$/, "Voorstellen"],
  [/^\/$/, "Overzicht"],
];
/** Korte naam van een scherm, gebruikt als label van de terugknop ("‹ Voorstellen"). */
export function titleOf(pathname: string): string {
  return TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Terug";
}

/** Titel in het midden van de navigatiebalk van dieper liggende schermen. */
export function navTitle(pathname: string): string {
  if (pathname === "/voorstellen/nieuw") return "Nieuw voorstel";
  if (pathname.startsWith("/voorstellen/concept/")) return "Concept";
  if (pathname.startsWith("/roepingen/")) return "Voorstel";
  if (pathname === "/ontheffingen/nieuw") return "Nieuwe ontheffing";
  if (pathname.startsWith("/ontheffingen/concept/")) return "Concept";
  if (pathname.startsWith("/ontheffingen/")) return "Ontheffing";
  return "";
}

/**
 * Waar de terugknop (en de Android-terugknop) heen gaat: een stap terug in de geschiedenis als die er binnen de app is,
 * anders naar het bovenliggende scherm. Zo raakt niemand "vast" na het openen van een melding of link.
 * `hasHistory` is waar als dit niet de eerste vermelding van de sessie is (react-router: `location.key !== "default"`).
 * Op een hoofdscherm geeft dit `null` (de aanroeper laat de app naar de achtergrond gaan).
 */
export function backAction(pathname: string, hasHistory: boolean): { kind: "history" } | { kind: "path"; to: string } | null {
  if (isTabRoot(pathname)) return pathname === "/" ? null : { kind: "path", to: "/" };
  return hasHistory ? { kind: "history" } : { kind: "path", to: parentPath(pathname) };
}
