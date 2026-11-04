import type { AppointAuthority, UnitKind } from "@prisma/client";
import { prisma } from "./prisma";
import { AuthorizationError, RingError, assertCanManageRing } from "./rings";
import { CATEGORIES, getCatalogEntry, isOutsideRingtoolsFunctionName, OUTSIDE_RINGTOOLS, type AuthorityRule } from "./catalog/callings";

/**
 * Ringinrichting: wijken/gemeenten (organisatorische instellingen, geen ledenregister), eigen roepingen per ring,
 * voortgangsoverzicht en de lijst van personen die een aanstelling mogen verrichten.
 * Autorisatie: webmin (elke ring) of ringbeheerder van die ring; alles server-side.
 */
export { RingError, AuthorizationError };

async function asManager(actorId: string, ringId: string) {
  await prisma.$transaction((tx) => assertCanManageRing(tx, actorId, ringId));
}

async function activeMember(ringId: string, userId: string, role?: "HOGERAAD") {
  return prisma.ringMembership.findFirst({
    where: { ringId, userId, active: true, user: { active: true }, ring: { active: true }, ...(role ? { role } : {}) },
  });
}

// ---- Wijken en gemeenten ----

export type UnitInput = {
  kind?: UnitKind;
  name?: string;
  active?: boolean;
  responsibleUserId?: string | null;
  defaultRoepenUserId?: string | null;
  defaultOndersteunenUserId?: string | null;
  defaultAanstellenUserId?: string | null;
};

export type UnitView = {
  id: string;
  kind: UnitKind;
  name: string;
  active: boolean;
  /** OK = actief hogeraadslid gekoppeld; VACANT = nog niemand; INACTIEF = gekoppelde persoon is niet meer actief. */
  responsibleStatus: "OK" | "VACANT" | "INACTIEF";
  responsible: { id: string; name: string } | null;
  defaults: { roepen: { id: string; name: string } | null; ondersteunen: { id: string; name: string } | null; aanstellen: { id: string; name: string } | null };
};

async function validateUnitPeople(ringId: string, input: UnitInput) {
  if (input.responsibleUserId) {
    if (!(await activeMember(ringId, input.responsibleUserId, "HOGERAAD"))) {
      throw new RingError("De verantwoordelijke moet een actief hogeraadslid van deze ring zijn.");
    }
  }
  for (const id of [input.defaultRoepenUserId, input.defaultOndersteunenUserId, input.defaultAanstellenUserId]) {
    if (id && !(await activeMember(ringId, id))) throw new RingError("Een standaardverantwoordelijke moet een actief lid van deze ring zijn.");
  }
}

function cleanName(raw: string | undefined): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) throw new RingError("Vul een naam in (2 tot 120 tekens).");
  return name;
}

export async function listUnits(ringId: string): Promise<UnitView[]> {
  const units = await prisma.ringUnit.findMany({
    where: { ringId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { responsibleUser: true, defaultRoepenUser: true, defaultOndersteunenUser: true, defaultAanstellenUser: true },
  });
  const memberRows = await prisma.ringMembership.findMany({ where: { ringId, active: true, user: { active: true } }, select: { userId: true, role: true } });
  const activeHogeraad = new Set(memberRows.filter((m) => m.role === "HOGERAAD").map((m) => m.userId));
  const activeAll = new Set(memberRows.map((m) => m.userId));
  const person = (u: { id: string; name: string } | null, ok: Set<string>) => (u && ok.has(u.id) ? { id: u.id, name: u.name } : null);
  return units.map((u) => ({
    id: u.id,
    kind: u.kind,
    name: u.name,
    active: u.active,
    responsibleStatus: !u.responsibleUser ? "VACANT" : activeHogeraad.has(u.responsibleUser.id) ? "OK" : "INACTIEF",
    responsible: person(u.responsibleUser, activeHogeraad),
    defaults: {
      roepen: person(u.defaultRoepenUser, activeAll),
      ondersteunen: person(u.defaultOndersteunenUser, activeAll),
      aanstellen: person(u.defaultAanstellenUser, activeAll),
    },
  }));
}

export async function createUnit(actorId: string, ringId: string, input: UnitInput & { kind: UnitKind }) {
  await asManager(actorId, ringId);
  if (input.kind !== "WIJK" && input.kind !== "GEMEENTE") throw new RingError("Kies wijk of gemeente.");
  const name = cleanName(input.name);
  if (await prisma.ringUnit.findFirst({ where: { ringId, name: { equals: name, mode: "insensitive" } } })) {
    throw new RingError("Er bestaat al een wijk of gemeente met deze naam.");
  }
  await validateUnitPeople(ringId, input);
  return prisma.ringUnit.create({
    data: {
      ringId, kind: input.kind, name,
      responsibleUserId: input.responsibleUserId || null,
      defaultRoepenUserId: input.defaultRoepenUserId || null,
      defaultOndersteunenUserId: input.defaultOndersteunenUserId || null,
      defaultAanstellenUserId: input.defaultAanstellenUserId || null,
    },
  });
}

export async function updateUnit(actorId: string, unitId: string, input: UnitInput) {
  const unit = await prisma.ringUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw new RingError("Deze wijk of gemeente bestaat niet.");
  await asManager(actorId, unit.ringId);

  const data: Record<string, unknown> = {};
  if (input.active === true && !unit.active) data.active = true;
  // Een gedeactiveerde unit krijgt geen nieuwe toewijzingen of wijzigingen: eerst heractiveren.
  const reactivating = input.active === true && !unit.active;
  const touchesAnythingElse = Object.keys(input).some((k) => k !== "active" && (input as Record<string, unknown>)[k] !== undefined);
  if (!unit.active && !reactivating && touchesAnythingElse) throw new RingError("Deze wijk of gemeente is gedeactiveerd. Activeer hem eerst opnieuw.");

  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (await prisma.ringUnit.findFirst({ where: { ringId: unit.ringId, name: { equals: name, mode: "insensitive" }, NOT: { id: unit.id } } })) {
      throw new RingError("Er bestaat al een wijk of gemeente met deze naam.");
    }
    data.name = name;
  }
  if (input.kind) data.kind = input.kind;
  if (input.active === false) data.active = false;
  await validateUnitPeople(unit.ringId, input);
  for (const key of ["responsibleUserId", "defaultRoepenUserId", "defaultOndersteunenUserId", "defaultAanstellenUserId"] as const) {
    if (input[key] !== undefined) data[key] = input[key] || null;
  }
  return prisma.ringUnit.update({ where: { id: unit.id }, data });
}

/** Voorstel voor een nieuw voorstel uit deze unit. Een vacature of inactieve persoon geeft géén voorstel en nooit een goedkeuring. */
export async function getUnitSuggestion(ringId: string, unitId: string) {
  const unit = (await listUnits(ringId)).find((u) => u.id === unitId && u.active);
  if (!unit) return null;
  return { unitId: unit.id, responsible: unit.responsible, responsibleStatus: unit.responsibleStatus, defaults: unit.defaults };
}

// ---- Eigen roepingen per ring ----

export type CustomCallingView = { id: string; name: string; category: string; active: boolean; source: "EIGEN" };

export async function listCustomCallings(ringId: string, opts: { includeInactive?: boolean } = {}): Promise<CustomCallingView[]> {
  const rows = await prisma.ringCustomCalling.findMany({ where: { ringId, ...(opts.includeInactive ? {} : { active: true }) }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, category: r.category, active: r.active, source: "EIGEN" as const }));
}

function cleanCategory(raw: string | undefined): string {
  const category = (raw ?? "").trim();
  if (!category) throw new RingError("Kies een categorie.");
  if (!CATEGORIES.includes(category) && category.length > 80) throw new RingError("De categorie is te lang.");
  return category;
}

export async function createCustomCalling(actorId: string, ringId: string, input: { name?: string; category?: string }) {
  await asManager(actorId, ringId);
  const name = cleanName(input.name);
  const category = cleanCategory(input.category);
  if (isOutsideRingtoolsFunctionName(name)) throw new RingError(OUTSIDE_RINGTOOLS);
  if (await prisma.ringCustomCalling.findFirst({ where: { ringId, name: { equals: name, mode: "insensitive" } } })) {
    throw new RingError("Deze eigen roeping bestaat al.");
  }
  return prisma.ringCustomCalling.create({ data: { ringId, name, category } });
}

/** Wijzigt alleen de eigen roeping; bestaande voorstellen behouden hun oorspronkelijke functienaam (die staat op het voorstel zelf). */
export async function updateCustomCalling(actorId: string, id: string, input: { name?: string; category?: string; active?: boolean }) {
  const row = await prisma.ringCustomCalling.findUnique({ where: { id } });
  if (!row) throw new RingError("Deze eigen roeping bestaat niet.");
  await asManager(actorId, row.ringId);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (isOutsideRingtoolsFunctionName(name)) throw new RingError(OUTSIDE_RINGTOOLS);
    if (await prisma.ringCustomCalling.findFirst({ where: { ringId: row.ringId, name: { equals: name, mode: "insensitive" }, NOT: { id } } })) {
      throw new RingError("Deze eigen roeping bestaat al.");
    }
    data.name = name;
  }
  if (input.category !== undefined) data.category = cleanCategory(input.category);
  if (typeof input.active === "boolean") data.active = input.active;
  return prisma.ringCustomCalling.update({ where: { id }, data });
}

// ---- Aanstellingsbevoegdheid ----

const ALLOWED: Record<AuthorityRule, AppointAuthority[]> = {
  RINGPRESIDENT: ["RINGPRESIDENT"],
  RINGPRESIDENT_OF_RAADGEVER: ["RINGPRESIDENT", "AANGEWEZEN_RAADGEVER"],
  RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID: ["RINGPRESIDENT", "AANGEWEZEN_RAADGEVER", "AANGEWEZEN_HOGERAADSLID"],
  // Bijzondere procedure of onbekende regel: geen automatische uitvoerders; een bevoegde externe persoon wordt handmatig geregistreerd.
  BIJZONDER: [],
  ONBEKEND: [],
};

/**
 * Personen die voor een standaardroeping de aanstelling mogen verrichten: alleen wie door de ringbeheerder expliciet is
 * aangewezen (Ringtools-rol of kerkelijke functie is op zichzelf geen machtiging) én nu actief is. Voor een eigen roeping
 * of een bijzondere procedure is de lijst leeg (handmatige registratie van een bevoegde uitvoerder).
 */
export async function eligibleAppointers(ringId: string, catalogCode: string | null, which: "appointedBy" | "grantedBy" = "appointedBy") {
  const entry = catalogCode ? getCatalogEntry(catalogCode) : null;
  return eligibleForRule(ringId, entry ? entry.ruleStatus : null, entry ? entry[which] : null);
}

/**
 * Personen die bij een gegeven regel én regelstatus bevoegd zijn. Los van de actuele catalogus, zodat een voorstel kan blijven werken
 * met de regel die bij indienen is vastgelegd (procedureSnapshot). Alleen een geverifieerde regel kent bevoegdheid toe; de personen
 * zelf worden altijd NU opnieuw bepaald (actief lidmaatschap en expliciete aanwijzing in deze ring).
 */
export async function eligibleForRule(ringId: string, ruleStatus: string | null, rule: string | null) {
  const allowed = ruleStatus === "GEVERIFIEERD" && rule && rule in ALLOWED ? ALLOWED[rule as AuthorityRule] : [];
  if (allowed.length === 0) return { rule: rule ?? null, appointers: [] as { id: string; name: string; authority: AppointAuthority }[] };
  const rows = await prisma.ringMembership.findMany({
    where: { ringId, active: true, user: { active: true }, ring: { active: true }, appointAuthority: { in: allowed } },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  return { rule, appointers: rows.map((m) => ({ id: m.userId, name: m.user.name, authority: m.appointAuthority })) };
}

// ---- Ringinrichting: voortgangsoverzicht ----

export type SetupStep = { key: string; label: string; done: boolean; detail: string };

export async function getRingSetup(ringId: string): Promise<{ steps: SetupStep[]; complete: boolean }> {
  const [members, units] = await Promise.all([
    prisma.ringMembership.findMany({ where: { ringId, active: true, user: { active: true } }, include: { user: true } }),
    listUnits(ringId),
  ]);
  const managers = members.filter((m) => m.isRingManager);
  const count = (role: string) => members.filter((m) => m.role === role).length;
  const activeUnits = units.filter((u) => u.active);
  const unlinked = activeUnits.filter((u) => u.responsibleStatus !== "OK").length;
  const hogeraad = count("HOGERAAD");
  const steps: SetupStep[] = [
    { key: "ring", label: "Ringnaam geregistreerd", done: true, detail: "" },
    { key: "first-user", label: "Eerste gebruiker aangewezen", done: managers.length > 0, detail: managers.length > 0 ? "" : "Wijs een eerste gebruiker aan." },
    { key: "manager", label: "Ringbeheerder aangewezen", done: managers.length > 0, detail: managers.length > 0 ? `${managers.length} ringbeheerder(s)` : "Geef een gebruiker de bevoegdheid Ringbeheerder." },
    {
      key: "activated", label: "Ringbeheerder uitgenodigd en geactiveerd",
      done: managers.some((m) => !!m.user.activatedAt),
      detail: managers.some((m) => !!m.user.activatedAt) ? "" : "Nog geen ringbeheerder heeft ingelogd.",
    },
    {
      key: "presidium", label: "Ringpresidium, secretaris en administrateur ingericht",
      done: count("RINGPRESIDIUM") > 0 && count("RINGSECRETARIS") > 0 && count("RINGADMINISTRATEUR") > 0,
      detail: `Presidium ${count("RINGPRESIDIUM")} (verwacht 3), secretaris ${count("RINGSECRETARIS")}, administrateur ${count("RINGADMINISTRATEUR")}`,
    },
    {
      key: "hogeraad", label: "Hogeraadsleden toegevoegd", done: hogeraad > 0,
      detail: hogeraad > 0 ? `${hogeraad} van 12 plaatsen bezet; vacatures zijn toegestaan.` : "Zonder hogeraadsleden blijft elk voorstel na het presidium wachten.",
    },
    { key: "units", label: "Wijken en gemeenten ingevoerd", done: activeUnits.length > 0, detail: `${activeUnits.length} actief` },
    {
      key: "unit-links", label: "Hogeraadsleden aan wijken en gemeenten gekoppeld", done: activeUnits.length > 0 && unlinked === 0,
      detail: activeUnits.length === 0 ? "Voer eerst wijken en gemeenten in." : unlinked === 0 ? "" : `${unlinked} zonder (actieve) verantwoordelijke`,
    },
  ];
  return { steps, complete: steps.every((s) => s.done) };
}
