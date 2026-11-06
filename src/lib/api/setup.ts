import { prisma } from "../prisma";
import { isStaff } from "../rbac";
import { CATALOG_VERSION, CATEGORIES, getCatalogEntry, requiresProcedureConfirmation, searchCatalog, type CatalogEntry } from "../catalog/callings";
import {
  createCustomCalling, createUnit, eligibleAppointers, getRingSetup, listCustomCallings, listUnits, updateCustomCalling, updateUnit,
} from "../ringSetup";
import { ApiError, str } from "./http";
import type { ApiAuth } from "./auth";
import { assertCanSeeRingUsers, ringErrors, requireMembershipFor } from "./management";

const opt = (v: unknown) => (v === null ? null : typeof v === "string" ? v : undefined);

/**
 * Wijken en gemeenten van een ring. Ringbeheerders (en de webmin) zien het volledige overzicht voor het beheer. Ringstaf zonder
 * beheerrechten (ringpresidium, secretaris, administrateur) moet de actieve eenheden kunnen kiezen bij een nieuw voorstel: zij krijgen
 * alleen de actieve eenheden met naam en soort, zonder verantwoordelijken of standaarduitvoerders. Lezen is geen beheerrecht; aanmaken
 * en wijzigen blijven voorbehouden aan de ringbeheerder. Alle anderen krijgen hetzelfde "Niet gevonden" als voorheen.
 */
export async function unitsFor(auth: ApiAuth, ringId: string) {
  try {
    await assertCanSeeRingUsers(auth.user, ringId);
    return { units: await listUnits(ringId) };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  const membership = await requireMembershipFor(auth.user.id, ringId); // actief lid van een actieve ring, anders 404
  if (!isStaff(membership.role)) throw new ApiError(404, "Niet gevonden.", "not-found");
  const units = (await listUnits(ringId)).filter((u) => u.active);
  return {
    units: units.map((u) => ({
      id: u.id, kind: u.kind, name: u.name, active: true, responsibleStatus: "OK" as const, responsible: null,
      defaults: { roepen: null, ondersteunen: null, aanstellen: null },
    })),
  };
}

export async function createUnitFor(auth: ApiAuth, ringId: string, body: Record<string, unknown>) {
  await assertCanSeeRingUsers(auth.user, ringId);
  const kind = body.kind === "WIJK" || body.kind === "GEMEENTE" ? body.kind : null;
  if (!kind) throw new ApiError(400, "Kies wijk of gemeente.", "validation");
  const unit = await ringErrors(() =>
    createUnit(auth.user.id, ringId, {
      kind, name: str(body.name), responsibleUserId: opt(body.responsibleUserId),
      defaultRoepenUserId: opt(body.defaultRoepenUserId), defaultOndersteunenUserId: opt(body.defaultOndersteunenUserId), defaultAanstellenUserId: opt(body.defaultAanstellenUserId),
    })
  );
  return { id: unit.id };
}

export async function updateUnitFor(auth: ApiAuth, unitId: string, body: Record<string, unknown>) {
  const unit = await prisma.ringUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw new ApiError(404, "Niet gevonden.", "not-found");
  await assertCanSeeRingUsers(auth.user, unit.ringId);
  await ringErrors(() =>
    updateUnit(auth.user.id, unitId, {
      name: typeof body.name === "string" ? body.name : undefined,
      kind: body.kind === "WIJK" || body.kind === "GEMEENTE" ? body.kind : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      responsibleUserId: opt(body.responsibleUserId), defaultRoepenUserId: opt(body.defaultRoepenUserId),
      defaultOndersteunenUserId: opt(body.defaultOndersteunenUserId), defaultAanstellenUserId: opt(body.defaultAanstellenUserId),
    })
  );
  return { ok: true };
}

export async function setupFor(auth: ApiAuth, ringId: string) {
  await assertCanSeeRingUsers(auth.user, ringId);
  return getRingSetup(ringId);
}

export async function customCallingsFor(auth: ApiAuth, ringId: string) {
  await assertCanSeeRingUsers(auth.user, ringId);
  return { callings: await listCustomCallings(ringId, { includeInactive: true }) };
}

export async function createCustomCallingFor(auth: ApiAuth, ringId: string, body: Record<string, unknown>) {
  await assertCanSeeRingUsers(auth.user, ringId);
  const row = await ringErrors(() => createCustomCalling(auth.user.id, ringId, { name: str(body.name), category: str(body.category) }));
  return { id: row.id };
}

export async function updateCustomCallingFor(auth: ApiAuth, id: string, body: Record<string, unknown>) {
  const row = await prisma.ringCustomCalling.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "Niet gevonden.", "not-found");
  await assertCanSeeRingUsers(auth.user, row.ringId);
  await ringErrors(() =>
    updateCustomCalling(auth.user.id, id, {
      name: typeof body.name === "string" ? body.name : undefined,
      category: typeof body.category === "string" ? body.category : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    })
  );
  return { ok: true };
}

function standard(e: CatalogEntry) {
  return {
    code: e.code, source: "STANDAARD" as const, name: e.name, aliases: e.aliases, category: e.category, type: e.type, handbook: e.handbook,
    approvalRoute: e.approvalRoute, ringtoolsProcess: e.ringtoolsProcess, extraApproval: e.extraApproval, grantedBy: e.grantedBy,
    appointedBy: e.appointedBy, supportVenue: e.supportVenue, appointment: e.appointment, releaseFollowUps: e.releaseFollowUps,
    warning: e.warning, reviewNotes: e.reviewNotes, active: e.active, catalogVersion: e.catalogVersion,
    ruleStatus: e.ruleStatus as string, requiresProcedureConfirmation: requiresProcedureConfirmation(e),
  };
}

/** Doorzoekbare catalogus: standaardroepingen plus de eigen roepingen van DEZE ring (nooit van andere ringen). Voor ringstaf en ringbeheerders van die ring. */
export async function catalogFor(userId: string, ringId: string, q: string, category: string) {
  const membership = await requireMembershipFor(userId, ringId);
  if (!isStaff(membership.role) && !membership.isRingManager) throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
  return catalogResult(ringId, q, category);
}

async function catalogResult(ringId: string, q: string, category: string) {
  const needle = q.trim();
  const own = (await listCustomCallings(ringId))
    .filter((c) => (!category || c.category === category) && (!needle || `${c.name} ${c.category}`.toLowerCase().includes(needle.toLowerCase())))
    .map((c) => ({
      code: c.id, source: "EIGEN" as const, name: c.name, aliases: [] as string[], category: c.category, type: "OVERIG", handbook: [] as string[],
      approvalRoute: null, ringtoolsProcess: true, extraApproval: null, grantedBy: null, appointedBy: null, supportVenue: null, appointment: null,
      releaseFollowUps: [] as string[], active: true, catalogVersion: null, ruleStatus: "EIGEN" as string, requiresProcedureConfirmation: true,
      warning: "Eigen roeping: er worden geen bevoegdheden of bijzondere kerkelijke procedures afgeleid. Bevestig bij gebruik dat de bevoegde leiding de procedure heeft gecontroleerd.",
      reviewNotes: [] as string[],
    }));
  return { version: CATALOG_VERSION, categories: CATEGORIES, callings: [...searchCatalog(needle, { category: category || undefined }).map(standard), ...own] };
}

export async function appointersFor(userId: string, ringId: string, code: string) {
  const membership = await requireMembershipFor(userId, ringId);
  if (!isStaff(membership.role)) throw new ApiError(403, "Je hebt hiervoor geen bevoegdheid.", "forbidden");
  if (!getCatalogEntry(code)) {
    // Eigen roeping of onbekende code: geen afgeleide bevoegdheden.
    return { rule: null, appointers: [] };
  }
  return eligibleAppointers(ringId, code);
}
