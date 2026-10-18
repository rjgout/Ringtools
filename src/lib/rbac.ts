import type { Role } from "@prisma/client";

/**
 * Rolverdeling (zie opdracht sectie 3):
 * - ADMIN: uitsluitend technisch beheer (instellingen, SMTP, het adminaccount).
 *   Neemt niet deel aan het roepingenproces.
 * - RINGPRESIDIUM: volledige workflowbevoegdheid + stemt in de presidiumfase.
 * - RINGSECRETARIS / RINGADMINISTRATEUR: dezelfde workflow- en
 *   gebruikersbeheerbevoegdheid als het ringpresidium, maar stemmen niet mee.
 * - HOGERAAD: alleen eigen openstaande stemverzoeken en eigen taken.
 */

export const STAFF_ROLES: Role[] = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

export function canVotePresidium(role: Role): boolean {
  return role === "RINGPRESIDIUM";
}

export function canVoteHogeraad(role: Role): boolean {
  return role === "HOGERAAD";
}

export function canManageWorkflow(role: Role): boolean {
  return isStaff(role);
}

export function canManageUsers(role: Role): boolean {
  return role === "ADMIN" || isStaff(role);
}

export function canManageSettings(role: Role): boolean {
  return role === "ADMIN";
}

export function canAssignRole(_assignerRole: Role, targetRole: Role): boolean {
  // Niemand mag via de gebruikersbeheer-UI het ADMIN-account aanmaken of
  // iemand tot ADMIN promoveren: dat voorkomt ongeautoriseerde
  // bevoegdheidsverhoging. Het enige adminaccount wordt uitsluitend via de
  // BOOTSTRAP_ADMIN_* environment variables beheerd.
  return targetRole !== "ADMIN";
}

export const ASSIGNABLE_ROLES: Role[] = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"];
