import type { Role } from "@prisma/client";

/**
 * Rolverdeling (zie opdracht sectie 3):
 * - ADMIN: uitsluitend technisch beheer (instellingen, SMTP, het adminaccount).
 *   Neemt niet deel aan het roepingenproces.
 * - RINGPRESIDIUM: volledige workflowbevoegdheid + brengt ondersteuning uit in de presidiumronde.
 * - RINGSECRETARIS / RINGADMINISTRATEUR: dezelfde workflowbevoegdheid als het
 *   ringpresidium, maar brengen geen ondersteuning uit.
 * - HOGERAAD: alleen eigen openstaande ondersteuningsverzoeken en eigen taken.
 *
 * Deze workflowrollen gelden PER RING (RingMembership.role). Gebruikersbeheer
 * is daarvan losgekoppeld: dat is de aparte administratieve bevoegdheid
 * "ringbeheerder" (RingMembership.isRingManager). De kerkelijke functie
 * (RingMembership.churchFunction) is vrije tekst en geeft nooit rechten.
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

/**
 * Gebruikersbeheer is een administratieve bevoegdheid (ringbeheerder), los van
 * de workflowrol of kerkelijke functie. De systeemadministrator (webmin) mag
 * dit in elke ring; een ringbeheerder alleen in zijn eigen ring.
 */
export function canManageRingUsers(
  systemRole: Role,
  membership: { isRingManager: boolean; active: boolean } | null
): boolean {
  if (systemRole === "ADMIN") return true;
  return !!membership && membership.active && membership.isRingManager;
}

export function canManageSettings(role: Role): boolean {
  return role === "ADMIN";
}

export function canAssignRole(_assignerRole: Role, targetRole: Role): boolean {
  // Niemand mag via het gebruikersbeheer het ADMIN-account aanmaken of
  // iemand tot ADMIN promoveren: dat voorkomt ongeautoriseerde
  // bevoegdheidsverhoging. Het enige adminaccount wordt uitsluitend via de
  // BOOTSTRAP_ADMIN_* environment variables beheerd.
  return targetRole !== "ADMIN";
}

/** Workflowrollen die binnen een ring aan een lid toegekend kunnen worden. */
export const ASSIGNABLE_ROLES: Role[] = ["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR", "HOGERAAD"];

/** Welke rol deelneemt aan welke ondersteuningsronde. */
export const STAGE_ROLE = { PRESIDIUM: "RINGPRESIDIUM", HOGERAAD: "HOGERAAD" } as const satisfies Record<string, Role>;
