import type { ChurchFunctionCode, Role } from "@prisma/client";

/**
 * Gestructureerde kerkelijke functies binnen de ring en wat ze betekenen voor bevoegdheden (Fase C4.5).
 *
 * Uitgangspunten (vastgesteld door de eigenaar):
 * - De Ringtools-rol (RingMembership.role) regelt toegang en gebruikersbeheer en geeft NOOIT kerkelijke bevoegdheid.
 * - De kerkelijke functie bepaalt welke bevoegdheden volgens de geverifieerde handboekprocedure MOGELIJK zijn.
 * - Waar het handboek een "aangewezen" raadgever of hogeraadslid vraagt, blijft de machtiging expliciet vastgelegd (RingMembership.appointAuthority).
 * - Bij onzekerheid (functie ONBEKEND of niet passend bij de rol) is er geen bevoegdheid: fail-closed.
 */

export const CHURCH_FUNCTION_LABELS: Record<ChurchFunctionCode, string> = {
  ONBEKEND: "Nog niet vastgelegd",
  RINGPRESIDENT: "Ringpresident",
  EERSTE_RAADGEVER: "Eerste raadgever ringpresidium",
  TWEEDE_RAADGEVER: "Tweede raadgever ringpresidium",
  RINGSECRETARIS: "Ringsecretaris",
  RINGADMINISTRATEUR: "Ringadministrateur",
  HOGERAADSLID: "Hogeraadslid",
  ANDERS: "Andere functie (zie omschrijving)",
};

/** Welke Ringtools-rollen passen bij een kerkelijke functie. `null` = elke rol (ONBEKEND/ANDERS). */
const ROLES_FOR: Record<ChurchFunctionCode, Role[] | null> = {
  ONBEKEND: null,
  ANDERS: null,
  RINGPRESIDENT: ["RINGPRESIDIUM"],
  EERSTE_RAADGEVER: ["RINGPRESIDIUM"],
  TWEEDE_RAADGEVER: ["RINGPRESIDIUM"],
  RINGSECRETARIS: ["RINGSECRETARIS"],
  RINGADMINISTRATEUR: ["RINGADMINISTRATEUR"],
  HOGERAADSLID: ["HOGERAAD"],
};

export function functionFitsRole(code: ChurchFunctionCode, role: Role): boolean {
  const roles = ROLES_FOR[code];
  return roles === null || roles.includes(role);
}

/** Functies waarvan er per ring hoogstens één actieve houder kan zijn. */
export const UNIQUE_FUNCTIONS: ChurchFunctionCode[] = ["RINGPRESIDENT", "EERSTE_RAADGEVER", "TWEEDE_RAADGEVER"];

export const RAADGEVER_FUNCTIONS: ChurchFunctionCode[] = ["EERSTE_RAADGEVER", "TWEEDE_RAADGEVER"];

export type AuthorityClass = "RINGPRESIDENT" | "AANGEWEZEN_RAADGEVER" | "AANGEWEZEN_HOGERAADSLID";

/**
 * Op welke grond een lid (actief, juiste rol) kerkelijk bevoegd kan zijn:
 * - ringpresident: de functie volstaat (geen aanvullende machtiging nodig);
 * - raadgever in het ringpresidium: alleen met expliciete machtiging "aangewezen raadgever";
 * - hogeraadslid: alleen met expliciete machtiging "aangewezen hogeraadslid".
 * Alles anders (onbekende functie, functie past niet bij de rol, machtiging zonder passende functie) levert `null`.
 */
export function authorityClassOf(m: { role: Role; churchFunctionCode: ChurchFunctionCode; appointAuthority: string }): AuthorityClass | null {
  if (m.churchFunctionCode === "RINGPRESIDENT" && m.role === "RINGPRESIDIUM") return "RINGPRESIDENT";
  if (RAADGEVER_FUNCTIONS.includes(m.churchFunctionCode) && m.role === "RINGPRESIDIUM" && m.appointAuthority === "AANGEWEZEN_RAADGEVER") return "AANGEWEZEN_RAADGEVER";
  if (m.churchFunctionCode === "HOGERAADSLID" && m.role === "HOGERAAD" && m.appointAuthority === "AANGEWEZEN_HOGERAADSLID") return "AANGEWEZEN_HOGERAADSLID";
  return null;
}

export const AUTHORITY_BASIS_LABEL: Record<AuthorityClass, string> = {
  RINGPRESIDENT: "Ringpresident (op grond van de functie)",
  AANGEWEZEN_RAADGEVER: "Aangewezen raadgever (functie + machtiging)",
  AANGEWEZEN_HOGERAADSLID: "Aangewezen hogeraadslid (functie + machtiging)",
};

/** Geldt de machtiging voor deze functie? (Voor validatie bij het vastleggen.) */
export function authorityFitsFunction(authority: string, code: ChurchFunctionCode): boolean {
  if (authority === "AANGEWEZEN_RAADGEVER") return RAADGEVER_FUNCTIONS.includes(code);
  if (authority === "AANGEWEZEN_HOGERAADSLID") return code === "HOGERAADSLID";
  return authority === "NONE";
}
