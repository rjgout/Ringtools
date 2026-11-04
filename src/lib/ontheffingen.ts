import type { AccountLinkMode, FollowUpAnswer, FunctionSource, Ontheffing, OntheffingPerson, OntheffingStatus, Prisma, Role, VoteStage } from "@prisma/client";
import { prisma } from "./prisma";
import { STAFF_ROLES, STAGE_ROLE } from "./rbac";
import { getCatalogEntry, CATALOG_VERSION, HOGERAAD_FUNCTION_CODES } from "./catalog/callings";
import { notify } from "./notifications";
import { AuthorizationError, CREATION_NOTIFY_LEASE_MS, WorkflowError, parseMeetingDate } from "./workflow";
import { procedureSnapshot, resolveFunction } from "./proposals";

/**
 * Ontheffingen (Fase C4): zelfstandige module, los van roepingsvoorstellen.
 *
 * Route: concept → ringpresidium (individueel of gezamenlijk besluit) → wachten op expliciete vrijgave → hoge raad (individueel of
 * gezamenlijk besluit) → uitvoering per persoon (persoonlijk informeren → bekendmaking en dankbetuiging → administratief verwerken) →
 * dossier verdwijnt 30 dagen na verwerking.
 *
 * Vertrouwelijkheid (kernregels):
 * - Ringtools heeft geen register van huidige roepingen. De betrokkene wordt NOOIT via de naam aan een account gekoppeld. De ringstaf
 *   identificeert het account zelf expliciet (`accountMode = GEKOPPELD`) of verklaart dat er geen Ringtools-account is (`GEEN_ACCOUNT`).
 * - Een gekoppeld account heeft nergens toegang tot het dossier (lijsten, aantallen, detail, stemmen, meldingen): `loadAccess` weigert
 *   met hetzelfde antwoord als bij een niet-bestaand dossier en `visibleWhere` sluit het dossier uit van elke opsomming.
 * - Een concept is alleen zichtbaar voor de aanmaker (voordat de koppeling vastligt kan niemand anders het zien).
 * - Meldingen zijn generiek ("vertrouwelijk voorstel"), zonder e-mail, en `notify` sluit gekoppelde accounts uit.
 * - Hoe een betrokken hogeraadslid na kennisgeving deelneemt aan de eigen behandeling is een OPEN vraag voor de eigenaar; tot die er is
 *   blijft een gekoppeld account altijd uitgesloten (zie docs/MIGRATIE-APP-ONLY.md, "Open vragen"). Hier is geen kerkelijke regel verzonnen.
 */

export const ONTHEFFING_RETENTION_DAYS = 30;
/** Lopende dossiers worden nooit automatisch verwijderd: na 30 dagen zonder activiteit volgt een herinnering, na 90 dagen een markering voor expliciete beoordeling. */
export const ONTHEFFING_REMINDER_DAYS = 30;
export const ONTHEFFING_REVIEW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
};

type Tx = Prisma.TransactionClient;
type Full = Ontheffing & { persons: OntheffingPerson[] };

// ---- Toegang en zichtbaarheid ----

async function activeMembership(userId: string, ringId: string) {
  return prisma.ringMembership.findFirst({
    where: { userId, ringId, active: true, user: { active: true, role: { not: "ADMIN" } }, ring: { active: true } },
  });
}

/**
 * Eén plek voor "mag deze gebruiker dit dossier zien": ongeldig, onbekend, betrokkene, concept van een ander en ongeautoriseerd geven allemaal
 * hetzelfde antwoord (AuthorizationError) zodat het bestaan van een dossier niet te achterhalen is.
 */
async function loadAccess(userId: string, id: string): Promise<{ o: Full; staff: boolean; hogeraadVoter: boolean; role: Role }> {
  const o = await prisma.ontheffing.findUnique({ where: { id }, include: { persons: true } });
  if (!o) throw new AuthorizationError();
  const m = await activeMembership(userId, o.ringId);
  if (!m) throw new AuthorizationError();
  if (o.persons.some((p) => p.userId === userId)) throw new AuthorizationError(); // de betrokkene zelf
  const staff = STAFF_ROLES.includes(m.role);
  if (o.status === "CONCEPT") {
    if (!staff || o.createdById !== userId) throw new AuthorizationError();
    return { o, staff, hogeraadVoter: false, role: m.role };
  }
  if (staff) return { o, staff, hogeraadVoter: false, role: m.role };
  // Overige leden (hoge raad): alleen als deelnemer van de lopende hogeraadronde.
  if (m.role === "HOGERAAD" && (o.status === "HOGERAAD_VOTING" || o.status === "HOGERAAD_PAUSED")) {
    const voter = await prisma.ontheffingVoter.findUnique({ where: { ontheffingId_stage_userId: { ontheffingId: o.id, stage: "HOGERAAD", userId } } });
    if (voter) return { o, staff: false, hogeraadVoter: true, role: m.role };
  }
  throw new AuthorizationError();
}

async function requireStaffAccess(userId: string, id: string) {
  const a = await loadAccess(userId, id);
  if (!a.staff) throw new AuthorizationError();
  return a;
}

/** Prisma-filter voor alles wat een gebruiker in deze ring mag zien; gebruikt voor lijsten én aantallen (nooit apart opnieuw bedacht). */
function visibleWhere(userId: string, ringId: string, role: Role): Prisma.OntheffingWhereInput {
  const notSubject: Prisma.OntheffingWhereInput = { persons: { none: { userId } } };
  if (STAFF_ROLES.includes(role)) {
    return { ringId, ...notSubject, OR: [{ status: { not: "CONCEPT" } }, { status: "CONCEPT", createdById: userId }] };
  }
  if (role === "HOGERAAD") {
    return { ringId, ...notSubject, status: { in: ["HOGERAAD_VOTING", "HOGERAAD_PAUSED"] }, voters: { some: { userId, stage: "HOGERAAD" } } };
  }
  return { id: "__geen__" };
}

async function audit(tx: Tx, ontheffingId: string, actorId: string, type: string, detail?: string | null) {
  await tx.ontheffingAudit.create({ data: { ontheffingId, actorId, type, detail: detail ?? null } });
}
/** Registreert inhoudelijke activiteit en start de herinnerings-/beoordelingstermijn opnieuw. */
async function touch(tx: Tx | typeof prisma, id: string) {
  await tx.ontheffing.update({ where: { id }, data: { lastActivityAt: new Date(), reminderSentAt: null, reviewFlaggedAt: null } });
}
async function lock(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Ontheffing" WHERE "id" = ${id} FOR UPDATE`;
}

// ---- Concept ----

export type PersonInput = {
  role: "HOOFD" | "RAADGEVER";
  followUpCode?: string | null;
  answer?: FollowUpAnswer;
  name?: string | null;
  naReason?: string | null;
  accountMode?: AccountLinkMode;
  userId?: string | null;
};
export type ConceptInput = Partial<{
  unitId: string | null;
  functionSource: FunctionSource | null;
  functionCode: string | null;
  procedureConfirmed: boolean;
  persons: PersonInput[];
}>;

function followUpsFor(source: FunctionSource | null, code: string | null): { code: string; name: string }[] {
  if (source !== "STANDAARD" || !code) return [];
  const entry = getCatalogEntry(code);
  return (entry?.releaseFollowUps ?? []).flatMap((c) => {
    const e = getCatalogEntry(c);
    return e ? [{ code: e.code, name: e.name }] : [];
  });
}

async function assertLinkable(tx: Tx, ringId: string, actorId: string, userId: string, others: OntheffingPerson[], selfId: string | null) {
  if (userId === actorId) throw new WorkflowError("Je kunt jezelf niet als betrokkene koppelen: je zou het dossier dan zelf niet meer kunnen zien.");
  const ok = await tx.ringMembership.count({ where: { ringId, userId, active: true, user: { active: true, role: { not: "ADMIN" } }, ring: { active: true } } });
  if (ok !== 1) throw new WorkflowError("Dit account is geen actief lid van deze ring.");
  if (others.some((p) => p.userId === userId && p.id !== selfId)) throw new WorkflowError("Dit account is al aan een andere betrokkene in dit dossier gekoppeld.");
}

async function applyConcept(tx: Tx, o: Full, actorId: string, input: ConceptInput) {
  const data: Prisma.OntheffingUncheckedUpdateInput = {};

  if ("unitId" in input) {
    if (input.unitId) {
      const unit = await tx.ringUnit.findFirst({ where: { id: input.unitId, ringId: o.ringId, active: true, ring: { active: true } } });
      if (!unit) throw new WorkflowError("Deze wijk of gemeente hoort niet bij deze ring of is gedeactiveerd.");
    }
    data.unitId = input.unitId || null;
  }
  if ("procedureConfirmed" in input) data.procedureConfirmed = input.procedureConfirmed === true;

  let functionChanged = false;
  let source = o.functionSource;
  let code = o.functionCode;
  if ("functionSource" in input || "functionCode" in input) {
    source = input.functionSource === "STANDAARD" || input.functionSource === "EIGEN" ? input.functionSource : null;
    code = typeof input.functionCode === "string" && input.functionCode ? input.functionCode : null;
    if (source && code) {
      const fn = await resolveFunction(o.ringId, source, code); // valideert (catalogus/eigen roeping van déze ring, geen bisschop, buiten-Ringtools)
      data.functionSource = source;
      data.functionCode = code;
      data.functionName = fn.name;
      data.joint = followUpsFor(source, code).length > 0;
      if (code !== o.functionCode || source !== o.functionSource) data.procedureConfirmed = false;
    } else {
      data.functionSource = null;
      data.functionCode = null;
      data.functionName = null;
      data.joint = false;
    }
    functionChanged = true;
  }
  if (Object.keys(data).length > 0) await tx.ontheffing.update({ where: { id: o.id }, data });

  // Personen: de hoofdpersoon altijd; raadgevers volgen uit de verplichte vervolgvragen van de gekozen functie.
  let persons = await tx.ontheffingPerson.findMany({ where: { ontheffingId: o.id } });
  const fnName = typeof data.functionName === "string" ? data.functionName : functionChanged ? "" : (o.functionName ?? "");
  if (!persons.some((p) => p.role === "HOOFD")) {
    await tx.ontheffingPerson.create({ data: { ontheffingId: o.id, role: "HOOFD", functionName: fnName, answer: "NAAM" } });
    persons = await tx.ontheffingPerson.findMany({ where: { ontheffingId: o.id } });
  } else if (functionChanged) {
    await tx.ontheffingPerson.updateMany({ where: { ontheffingId: o.id, role: "HOOFD" }, data: { functionName: fnName } });
  }
  if (functionChanged) {
    const wanted = followUpsFor(source, code);
    await tx.ontheffingPerson.deleteMany({ where: { ontheffingId: o.id, role: "RAADGEVER", followUpCode: { notIn: wanted.map((w) => w.code) } } });
    for (const w of wanted) {
      if (!persons.some((p) => p.followUpCode === w.code)) {
        await tx.ontheffingPerson.create({ data: { ontheffingId: o.id, role: "RAADGEVER", followUpCode: w.code, functionName: w.name, answer: "OPEN" } });
      }
    }
    persons = await tx.ontheffingPerson.findMany({ where: { ontheffingId: o.id } });
  }

  for (const pi of input.persons ?? []) {
    const row = pi.role === "HOOFD" ? persons.find((p) => p.role === "HOOFD") : persons.find((p) => p.role === "RAADGEVER" && p.followUpCode === (pi.followUpCode ?? null));
    if (!row) throw new WorkflowError("Deze persoon hoort niet bij de gekozen functie.");
    const upd: Prisma.OntheffingPersonUncheckedUpdateInput = {};
    let answer = row.answer;
    if (row.role === "RAADGEVER" && pi.answer) {
      if (!["OPEN", "NAAM", "NIET_VAN_TOEPASSING"].includes(pi.answer)) throw new WorkflowError("Ongeldig antwoord op de vervolgvraag.");
      answer = pi.answer;
      upd.answer = answer;
    }
    if ("name" in pi) upd.name = text(pi.name, 200);
    if ("naReason" in pi) upd.naReason = text(pi.naReason, 300);
    if (row.role === "RAADGEVER" && answer !== "NAAM") {
      // 'Niet van toepassing' (of nog open): geen persoon en dus ook geen koppeling.
      upd.name = null;
      upd.accountMode = "ONBEKEND";
      upd.userId = null;
    } else {
      if (answer === "NAAM" && row.role === "RAADGEVER") upd.naReason = null;
      if (pi.accountMode) {
        if (!["ONBEKEND", "GEKOPPELD", "GEEN_ACCOUNT"].includes(pi.accountMode)) throw new WorkflowError("Ongeldige keuze voor het account van de betrokkene.");
        if (pi.accountMode === "GEKOPPELD") {
          const uid = typeof pi.userId === "string" ? pi.userId : "";
          if (!uid) throw new WorkflowError("Kies het Ringtools-account van de betrokkene.");
          await assertLinkable(tx, o.ringId, actorId, uid, persons, row.id);
          upd.accountMode = "GEKOPPELD";
          upd.userId = uid;
        } else {
          upd.accountMode = pi.accountMode;
          upd.userId = null;
        }
      }
    }
    if (Object.keys(upd).length > 0) {
      await tx.ontheffingPerson.update({ where: { id: row.id }, data: upd });
      persons = await tx.ontheffingPerson.findMany({ where: { ontheffingId: o.id } });
    }
  }
}

export async function createConcept(actorId: string, ringId: string, input: ConceptInput): Promise<{ id: string }> {
  const m = await activeMembership(actorId, ringId);
  if (!m || !STAFF_ROLES.includes(m.role)) throw new AuthorizationError();
  return prisma.$transaction(async (tx) => {
    const created = await tx.ontheffing.create({ data: { ringId, createdById: actorId } });
    const full = await tx.ontheffing.findUniqueOrThrow({ where: { id: created.id }, include: { persons: true } });
    await applyConcept(tx, full, actorId, input);
    await audit(tx, created.id, actorId, "CONCEPT_CREATED");
    return { id: created.id };
  });
}

export async function updateConcept(actorId: string, id: string, input: ConceptInput): Promise<void> {
  await loadAccess(actorId, id);
  await prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const o = await tx.ontheffing.findUniqueOrThrow({ where: { id }, include: { persons: true } });
    if (o.status !== "CONCEPT") throw new WorkflowError("Een ingediend dossier kan niet meer als concept worden gewijzigd.");
    await applyConcept(tx, o, actorId, input);
    await touch(tx, id);
  });
}

// ---- Indienen ----

export type SubmitResult = { id: string; alreadySubmitted: boolean; notificationsDelivered: boolean };

export async function submitOntheffing(actorId: string, id: string): Promise<SubmitResult> {
  await loadAccess(actorId, id); // alleen de aanmaker van het concept (of ringstaf bij een reeds ingediend dossier)

  const created = await prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const o = await tx.ontheffing.findUniqueOrThrow({ where: { id }, include: { persons: true } });
    if (o.status !== "CONCEPT") return false;
    const ringId = o.ringId;

    const main = o.persons.find((p) => p.role === "HOOFD");
    const mainName = text(main?.name, 200);
    if (!main || !mainName || mainName.length < 2) throw new WorkflowError("Vul de naam van de persoon in.");

    const activeUnits = await tx.ringUnit.count({ where: { ringId, active: true } });
    if (activeUnits === 0) {
      throw new WorkflowError("De ringinrichting is nog niet compleet: er zijn geen wijken of gemeenten ingevoerd. Laat de ringbeheerder deze eerst invoeren; je concept blijft bewaard.");
    }
    const unit = o.unitId ? await tx.ringUnit.findFirst({ where: { id: o.unitId, ringId, active: true } }) : null;
    if (!unit) throw new WorkflowError("Kies de wijk of gemeente van herkomst.");

    const fn = await resolveFunction(ringId, o.functionSource, o.functionCode);
    if (fn.requiresConfirmation && !o.procedureConfirmed) {
      throw new WorkflowError("Bevestig dat de bevoegde leiding de procedure voor deze ontheffing heeft gecontroleerd.");
    }

    // Vervolgvragen en account-identificatie: alles moet expliciet beantwoord zijn (geen standaardwaarden).
    const followUps = followUpsFor(fn.source, fn.code);
    for (const f of followUps) {
      const p = o.persons.find((x) => x.role === "RAADGEVER" && x.followUpCode === f.code);
      if (!p || p.answer === "OPEN") throw new WorkflowError(`Beantwoord de vraag over de ${f.name.toLowerCase()}: vul de naam in of kies 'Niet van toepassing'.`);
      if (p.answer === "NAAM" && (!text(p.name, 200) || text(p.name, 200)!.length < 2)) throw new WorkflowError(`Vul de naam van de ${f.name.toLowerCase()} in.`);
    }
    const named = o.persons.filter((p) => p.role === "HOOFD" || p.answer === "NAAM");
    for (const p of named) {
      if (p.accountMode === "ONBEKEND") {
        throw new WorkflowError("Geef bij elke betrokkene aan of er een Ringtools-account is (en welk) of dat er geen account is. De app koppelt nooit automatisch op naam.");
      }
      if (p.accountMode === "GEKOPPELD") {
        if (!p.userId) throw new WorkflowError("Kies het Ringtools-account van de betrokkene.");
        await assertLinkable(tx, ringId, actorId, p.userId, o.persons, p.id);
      }
    }

    const now = new Date();
    const subjects = new Set(o.persons.flatMap((p) => (p.userId ? [p.userId] : [])));
    const presidium = await tx.ringMembership.findMany({ where: { ringId, role: "RINGPRESIDIUM", active: true, user: { active: true } }, select: { userId: true } });
    const voterIds = presidium.map((r) => r.userId).filter((u) => !subjects.has(u));

    await tx.ontheffingVoter.createMany({ data: voterIds.map((userId) => ({ ontheffingId: id, stage: "PRESIDIUM" as const, userId, lastInvitedAt: now })), skipDuplicates: true });
    await tx.ontheffing.update({
      where: { id },
      data: {
        status: "PRESIDIUM_VOTING", submittedAt: now,
        unitId: unit.id, unitNameSnapshot: unit.name, unitKindSnapshot: unit.kind,
        functionName: fn.name, catalogVersion: fn.entry ? CATALOG_VERSION : null, procedureSnapshot: procedureSnapshot(fn),
        procedureConfirmedAt: fn.requiresConfirmation ? now : null,
        notifyEvent: "SUBMITTED", notifyClaimedAt: null, lastActivityAt: now, reminderSentAt: null, reviewFlaggedAt: null,
      },
    });
    await audit(tx, id, actorId, "SUBMITTED", o.joint ? "gezamenlijk" : null);
    return true;
  });

  const delivered = await deliverOntheffingNotifications(id);
  return { id, alreadySubmitted: !created, notificationsDelivered: delivered !== "failed" && delivered !== "busy" };
}

// ---- Meldingen (herstelbaar, generiek, zonder e-mail) ----

export type OntheffingDelivery = "sent" | "nothing" | "busy" | "failed";

export async function deliverOntheffingNotifications(id: string, now: Date = new Date()): Promise<OntheffingDelivery> {
  const prev = await prisma.ontheffing.findUnique({ where: { id }, select: { ringId: true, notifyEvent: true, notifyClaimedAt: true } });
  if (!prev || !prev.notifyEvent) return "nothing";
  if (prev.notifyClaimedAt && now.getTime() - prev.notifyClaimedAt.getTime() < CREATION_NOTIFY_LEASE_MS) return "busy";
  const claimed = await prisma.ontheffing.updateMany({ where: { id, notifyEvent: prev.notifyEvent, notifyClaimedAt: prev.notifyClaimedAt }, data: { notifyClaimedAt: now } });
  if (claimed.count !== 1) return "busy";

  const event = prev.notifyEvent;
  const retry = prev.notifyClaimedAt !== null;
  const url = `/ontheffingen/${id}`;
  try {
    if (event === "SUBMITTED" || event === "RELEASED") {
      const stage: VoteStage = event === "SUBMITTED" ? "PRESIDIUM" : "HOGERAAD";
      const voters = await prisma.ontheffingVoter.findMany({ where: { ontheffingId: id, stage }, select: { userId: true } });
      await notify({
        userIds: voters.map((v) => v.userId), ringId: prev.ringId, ontheffingId: id, url, skipExisting: true,
        event: event === "SUBMITTED" ? "CONFIDENTIAL_PROPOSAL" : "CONFIDENTIAL_HOGERAAD",
      });
    } else if (event === "PAUSED") {
      const staff = await prisma.ringMembership.findMany({ where: { ringId: prev.ringId, role: "RINGPRESIDIUM", active: true, user: { active: true } }, select: { userId: true } });
      await notify({ userIds: staff.map((s) => s.userId), ringId: prev.ringId, ontheffingId: id, url, event: "CONFIDENTIAL_PAUSED", skipExisting: retry });
    }
    await prisma.ontheffing.updateMany({ where: { id, notifyEvent: event }, data: { notifyEvent: null, notifyClaimedAt: null } });
    return "sent";
  } catch (err) {
    console.error(`[ontheffingen] Meldingen voor dossier ${id} mislukt; wordt opnieuw geprobeerd:`, err);
    return "failed";
  }
}

export async function retryPendingOntheffingNotifications(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CREATION_NOTIFY_LEASE_MS);
  const pending = await prisma.ontheffing.findMany({
    where: { notifyEvent: { not: null }, updatedAt: { lt: cutoff }, OR: [{ notifyClaimedAt: null }, { notifyClaimedAt: { lt: cutoff } }] },
    select: { id: true }, take: 50,
  });
  let n = 0;
  for (const p of pending) if ((await deliverOntheffingNotifications(p.id, now)) === "sent") n++;
  return n;
}

// ---- Rondes: ondersteuning, gezamenlijk besluit, vrijgave ----

function stageFor(status: OntheffingStatus): VoteStage | null {
  if (status === "PRESIDIUM_VOTING" || status === "PRESIDIUM_PAUSED") return "PRESIDIUM";
  if (status === "HOGERAAD_VOTING" || status === "HOGERAAD_PAUSED") return "HOGERAAD";
  return null;
}

export async function castOntheffingVote(userId: string, id: string, support: boolean): Promise<OntheffingStatus> {
  const { o } = await loadAccess(userId, id);
  const stage = stageFor(o.status);
  if (!stage) throw new WorkflowError("Voor dit dossier is momenteel geen ondersteuningsronde open.");
  const [voter, m] = await Promise.all([
    prisma.ontheffingVoter.findUnique({ where: { ontheffingId_stage_userId: { ontheffingId: id, stage, userId } } }),
    activeMembership(userId, o.ringId),
  ]);
  if (!voter || !m || m.role !== STAGE_ROLE[stage]) throw new WorkflowError("Je kunt voor deze ondersteuningsronde geen ondersteuning uitbrengen.");
  await prisma.ontheffingVote.upsert({
    where: { ontheffingId_stage_userId: { ontheffingId: id, stage, userId } },
    update: { support }, create: { ontheffingId: id, stage, userId, support },
  });
  await touch(prisma, id);
  return recompute(id);
}

/**
 * Herberekent de status op basis van de reacties (idempotent, onder rij-lock). Alleen deelnemers die nu nog actief lid met de juiste rol zijn
 * tellen mee, zodat een gedeactiveerd lid een ronde niet blokkeert. Een lege groep leidt nooit tot goedkeuring; presidiumakkoord start de
 * hogeraadronde nooit automatisch.
 */
async function recompute(id: string): Promise<OntheffingStatus> {
  const { status, justPaused } = await prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const o = await tx.ontheffing.findUniqueOrThrow({ where: { id } });
    const stage = stageFor(o.status);
    if (!stage) return { status: o.status, justPaused: false };
    const rows = await tx.ontheffingVoter.findMany({ where: { ontheffingId: id, stage } });
    const active = await tx.ringMembership.findMany({
      where: { ringId: o.ringId, userId: { in: rows.map((r) => r.userId) }, role: STAGE_ROLE[stage], active: true, user: { active: true } },
      select: { userId: true },
    });
    const activeIds = new Set(active.map((a) => a.userId));
    const eligible = rows.filter((r) => activeIds.has(r.userId));
    const votes = await tx.ontheffingVote.findMany({ where: { ontheffingId: id, stage } });
    const anyNegative = votes.some((v) => !v.support);
    const allVoted = eligible.length > 0 && eligible.every((e) => votes.some((v) => v.userId === e.userId));
    const allPositive = allVoted && votes.filter((v) => activeIds.has(v.userId)).every((v) => v.support);

    if (anyNegative) {
      const paused = stage === "PRESIDIUM" ? "PRESIDIUM_PAUSED" : "HOGERAAD_PAUSED";
      const was = o.status === paused;
      await tx.ontheffing.update({ where: { id }, data: { status: paused, ...(was ? {} : { notifyEvent: "PAUSED", notifyClaimedAt: null }) } });
      return { status: paused as OntheffingStatus, justPaused: !was };
    }
    if (allPositive) {
      const now = new Date();
      if (stage === "PRESIDIUM") {
        await tx.ontheffing.update({ where: { id }, data: { status: "PRESIDIUM_APPROVED", presidiumApprovedAt: now, presidiumApprovalMethod: "INDIVIDUAL" } });
        return { status: "PRESIDIUM_APPROVED" as OntheffingStatus, justPaused: false };
      }
      await tx.ontheffing.update({ where: { id }, data: { status: "APPROVED", approvedAt: now, hogeraadApprovalMethod: "INDIVIDUAL" } });
      return { status: "APPROVED" as OntheffingStatus, justPaused: false };
    }
    const open = stage === "PRESIDIUM" ? "PRESIDIUM_VOTING" : "HOGERAAD_VOTING";
    await tx.ontheffing.update({ where: { id }, data: { status: open } });
    return { status: open as OntheffingStatus, justPaused: false };
  });
  if (justPaused) await deliverOntheffingNotifications(id);
  return status;
}

export type OntheffingDecisionInput = {
  stage: VoteStage;
  decidedOn: string;
  agreed: boolean;
  note?: string;
  presidingUserId?: string;
  presentUserIds?: string[];
  absentUserIds?: string[];
  resolveNegative?: boolean;
  resolutionNote?: string;
};

/**
 * Legt een in een vergadering genomen gezamenlijk besluit vast. Er worden nooit reacties namens anderen aangemaakt; één besluit geldt voor het hele
 * dossier (ook bij een gezamenlijke ontheffing: geen fictieve afzonderlijke goedkeuringsbesluiten per persoon).
 */
export async function registerOntheffingDecision(actorId: string, id: string, input: OntheffingDecisionInput): Promise<{ status: OntheffingStatus; alreadyRegistered: boolean }> {
  await requireStaffAccess(actorId, id);
  if (input.agreed !== true) throw new WorkflowError("Een gezamenlijk besluit kan alleen worden vastgelegd als het daadwerkelijk akkoord is vastgesteld.");
  const decidedOn = parseMeetingDate(input.decidedOn);
  const note = input.note?.trim().slice(0, 500) || null;

  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const o = await tx.ontheffing.findUniqueOrThrow({ where: { id }, include: { persons: true } });
    const existing = await tx.ontheffingDecision.findUnique({ where: { ontheffingId_stage: { ontheffingId: id, stage: input.stage } } });
    if (existing) return { status: o.status, alreadyRegistered: true };
    if (stageFor(o.status) !== input.stage) throw new WorkflowError("Voor deze fase kan nu geen gezamenlijk besluit worden vastgelegd.");

    const subjects = new Set(o.persons.flatMap((p) => (p.userId ? [p.userId] : [])));
    let presidingUserId: string | null = null;
    let present: string[] = [];
    let absent: string[] = [];
    if (input.stage === "HOGERAAD") {
      if (!input.presidingUserId) throw new WorkflowError("Geef aan welk lid van het ringpresidium de vergadering voorzat. Zonder presiderend lid is dit geen geldige vergadering.");
      if (subjects.has(input.presidingUserId)) throw new WorkflowError("De presiderende persoon moet een actief lid van het ringpresidium van deze ring zijn.");
      const presiding = await tx.ringMembership.findFirst({ where: { ringId: o.ringId, userId: input.presidingUserId, role: "RINGPRESIDIUM", active: true, user: { active: true } } });
      if (!presiding) throw new WorkflowError("De presiderende persoon moet een actief lid van het ringpresidium van deze ring zijn.");
      presidingUserId = input.presidingUserId;
      present = [...new Set(input.presentUserIds ?? [])];
      absent = [...new Set(input.absentUserIds ?? [])];
      if (present.length === 0) throw new WorkflowError("Geef aan welke hogeraadsleden aanwezig waren.");
      if (present.some((u) => absent.includes(u))) throw new WorkflowError("Iemand kan niet tegelijk aanwezig en afwezig zijn.");
      const eligible = new Set((await tx.ontheffingVoter.findMany({ where: { ontheffingId: id, stage: "HOGERAAD" }, select: { userId: true } })).map((e) => e.userId));
      if ([...present, ...absent].some((u) => !eligible.has(u))) throw new WorkflowError("Aanwezigen en afwezigen moeten deelnemers van de hogeraadsronde van dit dossier zijn.");
    } else {
      // Een gezamenlijk presidiumbesluit is het besluit van de presidiumleden zelf. De registrerende staf (ook een secretaris of administrateur) legt
      // uitsluitend vast wat is besloten: er moet minstens één actief, niet-betrokken presidiumlid zijn dat het besluit heeft genomen.
      const members = await tx.ringMembership.findMany({ where: { ringId: o.ringId, role: "RINGPRESIDIUM", active: true, user: { active: true } }, select: { userId: true } });
      const available = members.map((m) => m.userId).filter((u) => !subjects.has(u));
      if (available.length === 0) {
        throw new WorkflowError("Er is geen actief, niet-betrokken lid van het ringpresidium dat dit besluit kan hebben genomen. Een gezamenlijk presidiumbesluit kan dan niet worden vastgelegd.");
      }
      present = [...new Set(input.presentUserIds ?? [])];
      if (present.length === 0) {
        throw new WorkflowError("Geef aan welke leden van het ringpresidium het besluit hebben genomen. Een secretaris of administrateur legt alleen een werkelijk genomen besluit vast en neemt het niet zelf.");
      }
      if (present.some((u) => !available.includes(u))) {
        throw new WorkflowError("De leden die het besluit hebben genomen moeten actieve, niet-betrokken leden van het ringpresidium van deze ring zijn.");
      }
    }
    const negatives = await tx.ontheffingVote.count({ where: { ontheffingId: id, stage: input.stage, support: false } });
    let resolutionNote: string | null = null;
    if (negatives > 0) {
      resolutionNote = input.resolutionNote?.trim().slice(0, 500) || null;
      if (input.resolveNegative !== true || !resolutionNote || resolutionNote.length < 10) {
        throw new WorkflowError("Er is een negatieve reactie. Leg eerst vast hoe die is afgehandeld (bevestiging en toelichting); negatieve reacties worden nooit stilzwijgend overschreven.");
      }
    }
    await tx.ontheffingDecision.create({
      data: {
        ontheffingId: id, stage: input.stage, decidedOn, registeredById: actorId, agreed: true, note, presidingUserId,
        presentUserIds: present, absentUserIds: absent, overrodeNegativeVotes: negatives > 0, resolutionNote,
      },
    });
    await audit(tx, id, actorId, input.stage === "PRESIDIUM" ? "GROUP_DECISION_PRESIDIUM" : "GROUP_DECISION_HOGERAAD", negatives > 0 ? "met afhandeling van negatieve reactie(s)" : null);
    const now = new Date();
    const activity = { lastActivityAt: now, reminderSentAt: null, reviewFlaggedAt: null };
    const updated = input.stage === "PRESIDIUM"
      ? await tx.ontheffing.update({ where: { id }, data: { status: "PRESIDIUM_APPROVED", presidiumApprovedAt: now, presidiumApprovalMethod: "MEETING", ...activity } })
      : await tx.ontheffing.update({ where: { id }, data: { status: "APPROVED", approvedAt: now, hogeraadApprovalMethod: "MEETING", ...activity } });
    return { status: updated.status, alreadyRegistered: false };
  });
}

/** Expliciete, geautoriseerde en idempotente vrijgave aan de hoge raad. Een lege hoge raad (na uitsluiting van betrokkenen) blokkeert. */
export async function releaseOntheffingToHogeraad(actorId: string, id: string): Promise<{ released: boolean; alreadyReleased: boolean }> {
  await requireStaffAccess(actorId, id);
  const result = await prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const o = await tx.ontheffing.findUniqueOrThrow({ where: { id }, include: { persons: true } });
    if (o.hogeraadReleasedAt) return { released: false, alreadyReleased: true };
    if (o.status !== "PRESIDIUM_APPROVED") throw new WorkflowError("Dit dossier heeft geen presidiumakkoord dat op vrijgave wacht.");
    const subjects = new Set(o.persons.flatMap((p) => (p.userId ? [p.userId] : [])));
    const blockers = await releaseBlockers(tx, o);
    if (blockers.length > 0) throw new WorkflowError(blockers[0]);
    const hr = await tx.ringMembership.findMany({ where: { ringId: o.ringId, role: "HOGERAAD", active: true, user: { active: true } }, select: { userId: true } });
    const ids = hr.map((r) => r.userId).filter((u) => !subjects.has(u));
    const now = new Date();
    await tx.ontheffingVoter.createMany({ data: ids.map((userId) => ({ ontheffingId: id, stage: "HOGERAAD" as const, userId, lastInvitedAt: now })), skipDuplicates: true });
    await tx.ontheffing.update({ where: { id }, data: { status: "HOGERAAD_VOTING", hogeraadReleasedAt: now, hogeraadReleasedById: actorId, notifyEvent: "RELEASED", notifyClaimedAt: null, lastActivityAt: now, reminderSentAt: null, reviewFlaggedAt: null } });
    await audit(tx, id, actorId, "HOGERAAD_RELEASED");
    return { released: true, alreadyReleased: false };
  });
  if (result.released) await deliverOntheffingNotifications(id);
  return result;
}

// ---- Uitvoering per persoon ----

const INFORM_STATUSES: OntheffingStatus[] = ["PRESIDIUM_APPROVED", "HOGERAAD_VOTING", "HOGERAAD_PAUSED", "APPROVED"];

async function personFor(actorId: string, personId: string) {
  const p = await prisma.ontheffingPerson.findUnique({ where: { id: personId } });
  if (!p) throw new AuthorizationError();
  const a = await requireStaffAccess(actorId, p.ontheffingId);
  if (!(p.role === "HOOFD" || p.answer === "NAAM")) throw new WorkflowError("Voor deze vervolgvraag is geen persoon geregistreerd.");
  return { p, o: a.o };
}

/** Registreert dat het ringpresidium de betrokkene persoonlijk heeft geïnformeerd (buiten de app; Ringtools stuurt de betrokkene niets). */
export async function markInformed(actorId: string, personId: string): Promise<void> {
  const { p, o } = await personFor(actorId, personId);
  await prisma.$transaction(async (tx) => {
    await lock(tx, o.id);
    const cur = await tx.ontheffing.findUniqueOrThrow({ where: { id: o.id } });
    const person = await tx.ontheffingPerson.findUniqueOrThrow({ where: { id: p.id } });
    if (person.informedAt) return;
    if (!INFORM_STATUSES.includes(cur.status)) throw new WorkflowError("De betrokkene kan pas persoonlijk worden geïnformeerd nadat het ringpresidium akkoord is.");
    await tx.ontheffingPerson.update({ where: { id: p.id }, data: { informedAt: new Date(), informedById: actorId } });
    await audit(tx, o.id, actorId, "PERSON_INFORMED", person.role === "HOOFD" ? "hoofdpersoon" : "raadgever");
    await touch(tx, o.id);
  });
}

/**
 * Registreert de bekendmaking en of daarbij gelegenheid tot dankbetuiging is geboden. Verwerken vereist de bekendmaking, maar niet dat leden
 * daadwerkelijk dank hebben uitgesproken. Geen stemknoppen: het is een vastlegging van wat plaatsvond.
 */
export async function registerAnnouncement(actorId: string, personId: string, opts: { thanksOffered: boolean }): Promise<void> {
  if (typeof opts.thanksOffered !== "boolean") throw new WorkflowError("Geef aan of er gelegenheid tot dankbetuiging is geboden.");
  const { p, o } = await personFor(actorId, personId);
  await prisma.$transaction(async (tx) => {
    await lock(tx, o.id);
    const cur = await tx.ontheffing.findUniqueOrThrow({ where: { id: o.id } });
    const person = await tx.ontheffingPerson.findUniqueOrThrow({ where: { id: p.id } });
    if (cur.status !== "APPROVED") throw new WorkflowError("Bekendmaking kan pas worden vastgelegd nadat het besluit definitief is.");
    if (!person.informedAt) throw new WorkflowError("Informeer de betrokkene eerst persoonlijk voordat de bekendmaking wordt vastgelegd.");
    if (person.announcedAt) return; // idempotent: de eerste registratie blijft staan
    await tx.ontheffingPerson.update({ where: { id: p.id }, data: { announcedAt: new Date(), announcedById: actorId, thanksOffered: opts.thanksOffered } });
    await audit(tx, o.id, actorId, "PERSON_ANNOUNCED", opts.thanksOffered ? "gelegenheid tot dankbetuiging geboden" : "geen gelegenheid tot dankbetuiging geboden");
    await touch(tx, o.id);
  });
}

/** Administratief verwerken van één persoon; het dossier is verwerkt zodra alle personen verwerkt zijn. */
export async function processPerson(actorId: string, personId: string): Promise<{ dossierProcessed: boolean }> {
  const { p, o } = await personFor(actorId, personId);
  return prisma.$transaction(async (tx) => {
    await lock(tx, o.id);
    const cur = await tx.ontheffing.findUniqueOrThrow({ where: { id: o.id } });
    const person = await tx.ontheffingPerson.findUniqueOrThrow({ where: { id: p.id } });
    if (cur.status === "PROCESSED") return { dossierProcessed: true };
    if (cur.status !== "APPROVED") throw new WorkflowError("Verwerken kan pas nadat het besluit definitief is.");
    if (!person.processedAt) {
      if (!person.informedAt) throw new WorkflowError("Informeer de betrokkene eerst persoonlijk.");
      if (!person.announcedAt) throw new WorkflowError("Leg eerst de bekendmaking vast.");
      await tx.ontheffingPerson.update({ where: { id: p.id }, data: { processedAt: new Date(), processedById: actorId } });
      await audit(tx, o.id, actorId, "PERSON_PROCESSED", person.role === "HOOFD" ? "hoofdpersoon" : "raadgever");
      await touch(tx, o.id);
    }
    const all = await tx.ontheffingPerson.findMany({ where: { ontheffingId: o.id } });
    const counting = all.filter((x) => x.role === "HOOFD" || x.answer === "NAAM");
    if (counting.every((x) => x.processedAt)) {
      await tx.ontheffing.update({ where: { id: o.id }, data: { status: "PROCESSED", processedAt: new Date() } });
      await audit(tx, o.id, actorId, "PROCESSED");
      return { dossierProcessed: true };
    }
    return { dossierProcessed: false };
  });
}

/** Corrigeert de naam van een betrokkene (tikfout) zolang die niet is verwerkt; alleen de naam, nooit de koppeling of het antwoord. */
export async function renamePerson(actorId: string, personId: string, name: string): Promise<void> {
  const { p, o } = await personFor(actorId, personId);
  const clean = text(name, 200);
  if (!clean || clean.length < 2) throw new WorkflowError("Vul de naam van de persoon in.");
  if (o.status === "CONCEPT" || p.processedAt || o.status === "PROCESSED") throw new WorkflowError("De naam kan nu niet meer worden aangepast.");
  await prisma.$transaction(async (tx) => {
    await tx.ontheffingPerson.update({ where: { id: p.id }, data: { name: clean } });
    await audit(tx, o.id, actorId, "PERSON_RENAMED");
    await touch(tx, o.id);
  });
}

// ---- Verwijderen en opruimen ----

export async function deleteOntheffing(actorId: string, id: string, confirmed: boolean): Promise<void> {
  if (!confirmed) throw new WorkflowError("Bevestig dat je dit dossier definitief wilt verwijderen.");
  const { o } = await loadAccess(actorId, id);
  if (o.status !== "CONCEPT") await requireStaffAccess(actorId, id);
  await prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const fresh = await tx.ontheffing.findUnique({ where: { id } });
    if (!fresh) return;
    if (fresh.status === "PROCESSED") throw new WorkflowError("Verwerkte dossiers worden automatisch 30 dagen na verwerking verwijderd.");
    await tx.ontheffing.delete({ where: { id } }); // cascade: personen (en dus de tijdelijke accountkoppelingen), rondes, besluiten, audit, meldingen
  });
}

/**
 * Opruimregels: verwerkte dossiers 30 dagen na verwerking en concepten 30 dagen na de laatste wijziging. Met het dossier verdwijnen ook de personen en daarmee de tijdelijke koppeling aan een account.
 */
export async function deleteDueOntheffingen(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ONTHEFFING_RETENTION_DAYS * DAY_MS);
  const res = await prisma.ontheffing.deleteMany({
    where: { OR: [{ status: "PROCESSED", processedAt: { lte: cutoff } }, { status: "CONCEPT", updatedAt: { lt: cutoff } }] },
  });
  return res.count;
}

// ---- Weergave ----

const STATUS_LABEL: Record<OntheffingStatus, string> = {
  CONCEPT: "Concept",
  PRESIDIUM_VOTING: "Behandeling door het ringpresidium",
  PRESIDIUM_PAUSED: "Gepauzeerd (ringpresidium)",
  PRESIDIUM_APPROVED: "Akkoord ringpresidium — wacht op vrijgave",
  HOGERAAD_VOTING: "Behandeling door de hoge raad",
  HOGERAAD_PAUSED: "Gepauzeerd (hoge raad)",
  APPROVED: "Besluit genomen — uitvoering",
  PROCESSED: "Verwerkt",
};

export async function listOntheffingen(actorId: string, ringId: string) {
  const m = await activeMembership(actorId, ringId);
  if (!m) throw new AuthorizationError();
  const rows = await prisma.ontheffing.findMany({
    where: visibleWhere(actorId, ringId, m.role),
    include: { persons: { where: { role: "HOOFD" } }, votes: { where: { userId: actorId } }, voters: { where: { userId: actorId } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map((o) => {
    const stage = stageFor(o.status);
    const mine = stage ? o.voters.some((v) => v.stage === stage) && !o.votes.some((v) => v.stage === stage) : false;
    return {
      id: o.id, status: o.status, statusLabel: STATUS_LABEL[o.status],
      personName: o.persons[0]?.name ?? null, functionName: o.functionName, unitName: o.unitNameSnapshot,
      joint: o.joint, needsMyVote: mine, needsReview: STAFF_ROLES.includes(m.role) && !!o.reviewFlaggedAt && o.status !== "PROCESSED", updatedAt: o.updatedAt.toISOString(),
    };
  });
}

/** Aantallen voor badges: dezelfde zichtbaarheid als de lijst (een betrokkene ziet dus nooit een aantal dat naar het dossier verwijst). */
export async function ontheffingCounts(actorId: string, ringId: string): Promise<{ needsMyVote: number; open: number; needsReview: number }> {
  const m = await activeMembership(actorId, ringId);
  if (!m) return { needsMyVote: 0, open: 0, needsReview: 0 };
  const visible = visibleWhere(actorId, ringId, m.role);
  const open = await prisma.ontheffing.count({ where: { AND: [visible, { status: { notIn: ["PROCESSED", "CONCEPT"] } }] } });
  const needsMyVote = await prisma.ontheffing.count({
    where: {
      AND: [visible],
      OR: [
        { status: { in: ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED"] }, voters: { some: { userId: actorId, stage: "PRESIDIUM" } }, votes: { none: { userId: actorId, stage: "PRESIDIUM" } } },
        { status: { in: ["HOGERAAD_VOTING", "HOGERAAD_PAUSED"] }, voters: { some: { userId: actorId, stage: "HOGERAAD" } }, votes: { none: { userId: actorId, stage: "HOGERAAD" } } },
      ],
    },
  });
  const needsReview = STAFF_ROLES.includes(m.role)
    ? await prisma.ontheffing.count({ where: { AND: [visible, { status: { notIn: ["PROCESSED", "CONCEPT"] }, reviewFlaggedAt: { not: null } }] } })
    : 0;
  return { needsMyVote, open, needsReview };
}

export async function getOntheffingView(actorId: string, id: string) {
  const { o, staff, hogeraadVoter } = await loadAccess(actorId, id);
  const stage = stageFor(o.status);
  const [votes, voters, decisions, audits, myVote] = await Promise.all([
    prisma.ontheffingVote.findMany({ where: { ontheffingId: id } }),
    prisma.ontheffingVoter.findMany({ where: { ontheffingId: id } }),
    prisma.ontheffingDecision.findMany({ where: { ontheffingId: id }, orderBy: { registeredAt: "asc" } }),
    staff ? prisma.ontheffingAudit.findMany({ where: { ontheffingId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { name: true } } } }) : Promise.resolve([]),
    stage ? prisma.ontheffingVote.findUnique({ where: { ontheffingId_stage_userId: { ontheffingId: id, stage, userId: actorId } } }) : Promise.resolve(null),
  ]);

  const entry = o.functionSource === "STANDAARD" && o.functionCode ? getCatalogEntry(o.functionCode) : null;
  const snap = o.procedureSnapshot && typeof o.procedureSnapshot === "object" && !Array.isArray(o.procedureSnapshot) ? (o.procedureSnapshot as Record<string, unknown>) : null;
  const followUps = followUpsFor(o.functionSource, o.functionCode);
  const sees = (p: OntheffingPerson) => p.role === "HOOFD" || p.answer === "NAAM";
  const isVoterNow = !!stage && voters.some((v) => v.stage === stage && v.userId === actorId);
  const staffPresidiumVoter = stage === "PRESIDIUM" && isVoterNow;
  const canVote = (staffPresidiumVoter || (hogeraadVoter && stage === "HOGERAAD")) ?? false;

  const summary = (st: VoteStage) => {
    const el = voters.filter((v) => v.stage === st);
    const vs = votes.filter((v) => v.stage === st);
    return { eligible: el.length, responded: vs.length, positive: vs.filter((v) => v.support).length, negative: vs.filter((v) => !v.support).length };
  };

  const base = {
    id: o.id, ringId: o.ringId, status: o.status, statusLabel: STATUS_LABEL[o.status], joint: o.joint,
    unit: o.unitNameSnapshot ? { name: o.unitNameSnapshot, kind: o.unitKindSnapshot } : null,
    function: o.functionCode
      ? { source: o.functionSource, code: o.functionCode, name: o.functionName, ruleStatus: (snap?.ruleStatus as string) ?? (entry?.ruleStatus ?? "EIGEN"), warning: entry?.warning ?? null }
      : null,
    // Hogeraadsleden zien alleen wat nodig is om te beslissen: de betrokkenen (naam en functie), geen koppelings- of uitvoeringsgegevens.
    persons: o.persons.filter(sees).map((p) => ({ id: p.id, role: p.role, functionName: p.functionName, name: p.name })),
    viewer: {
      staff, canVote, myVote: myVote ? myVote.support : null,
      canSubmit: staff && o.status === "CONCEPT",
      canRelease: staff && o.status === "PRESIDIUM_APPROVED",
      canDecide: staff && !!stage,
      canDelete: staff && o.status !== "PROCESSED",
    },
  };
  if (!staff) return { ...base, stage };

  return {
    ...base, stage,
    submittedAt: o.submittedAt?.toISOString() ?? null,
    procedureConfirmed: o.procedureConfirmed,
    requiresConfirmation: o.functionSource === "EIGEN" || (entry ? entry.ruleStatus !== "GEVERIFIEERD" : false),
    unitId: o.unitId,
    followUps,
    // Staf ziet alle personen inclusief antwoorden op de vervolgvragen en de uitvoeringsstatus per persoon.
    persons: o.persons.map((p) => ({
      id: p.id, role: p.role, followUpCode: p.followUpCode, functionName: p.functionName, answer: p.answer, name: p.name, naReason: p.naReason,
      accountMode: p.accountMode, userId: p.userId,
      execution: sees(p)
        ? { informedAt: p.informedAt?.toISOString() ?? null, announcedAt: p.announcedAt?.toISOString() ?? null, thanksOffered: p.thanksOffered ?? null, processedAt: p.processedAt?.toISOString() ?? null }
        : null,
    })),
    rounds: { presidium: summary("PRESIDIUM"), hogeraad: summary("HOGERAAD") },
    decisions: decisions.map((d) => ({ stage: d.stage, decidedOn: d.decidedOn.toISOString().slice(0, 10), note: d.note, presentCount: d.presentUserIds.length, absentCount: d.absentUserIds.length, overrodeNegativeVotes: d.overrodeNegativeVotes })),
    audit: audits.map((a) => ({ type: a.type, actor: a.actor.name, createdAt: a.createdAt.toISOString(), detail: a.detail })),
    activity: { lastActivityAt: o.lastActivityAt.toISOString(), reminderSentAt: o.reminderSentAt?.toISOString() ?? null, needsReview: !!o.reviewFlaggedAt && o.status !== "PROCESSED" && o.status !== "CONCEPT" },
    retention: o.processedAt ? { deleteAfter: new Date(o.processedAt.getTime() + ONTHEFFING_RETENTION_DAYS * DAY_MS).toISOString() } : null,
    blockers: o.status === "PRESIDIUM_APPROVED" ? await releaseBlockers(prisma, o) : [],
  };
}

/**
 * Belemmeringen voor de vrijgave aan de hoge raad (leeg = vrij te geven); dezelfde controle voor de server en voor de weergave in de app.
 * - Er moet minstens één actief, niet-betrokken hogeraadslid zijn (een lege hoge raad leidt nooit tot goedkeuring).
 * - Is de betrokkene zelf hogeraadslid (functie hogeraadslid of organisatiepresident die hogeraadslid is, of een gekoppeld account met de rol
 *   hoge raad), dan moet die eerst persoonlijk zijn geïnformeerd door het ringpresidium voordat de hogeraadronde start.
 */
async function releaseBlockers(db: Tx | typeof prisma, o: Full): Promise<string[]> {
  const blockers: string[] = [];
  const subjects = new Set(o.persons.flatMap((p) => (p.userId ? [p.userId] : [])));
  const hr = await db.ringMembership.findMany({ where: { ringId: o.ringId, role: "HOGERAAD", active: true, user: { active: true } }, select: { userId: true } });
  if (hr.filter((r) => !subjects.has(r.userId)).length === 0) {
    blockers.push("Er zijn geen actieve hogeraadsleden die kunnen deelnemen. Zonder deelnemers kan er geen ondersteuningsronde starten.");
  }
  const mustBeInformed = new Set<string>();
  const main = o.persons.find((p) => p.role === "HOOFD");
  if (main && o.functionSource === "STANDAARD" && o.functionCode && HOGERAAD_FUNCTION_CODES.has(o.functionCode)) mustBeInformed.add(main.id);
  const linked = o.persons.filter((p) => p.userId);
  if (linked.length > 0) {
    const asHr = await db.ringMembership.findMany({ where: { ringId: o.ringId, role: "HOGERAAD", active: true, userId: { in: linked.map((p) => p.userId!) } }, select: { userId: true } });
    const hrIds = new Set(asHr.map((m) => m.userId));
    for (const p of linked) if (hrIds.has(p.userId!)) mustBeInformed.add(p.id);
  }
  if (o.persons.some((p) => mustBeInformed.has(p.id) && !p.informedAt)) {
    blockers.push("De betrokkene is hogeraadslid en moet eerst persoonlijk door het ringpresidium zijn geïnformeerd voordat de hoge raad de ontheffing te zien krijgt. Registreer eerst de persoonlijke kennisgeving.");
  }
  return blockers;
}

// ---- Openstaande dossiers: herinnering en beoordeling (geen automatische verwijdering) ----

/**
 * Er is (nog) geen vastgesteld bewaarbeleid voor lopende dossiers, dus ze worden nooit automatisch verwijderd. In plaats daarvan:
 * na 30 dagen zonder activiteit een herinnering aan het ringpresidium, na 90 dagen een markering "beoordeling nodig" (en nogmaals een melding).
 * Alleen een expliciete beoordeling door ringstaf (aanhouden of verwijderen) lost de markering op. Meldingen zijn generiek en gaan niet naar betrokkenen.
 */
export async function remindStaleOntheffingen(now: Date = new Date()): Promise<{ reminded: number; flagged: number }> {
  const t30 = new Date(now.getTime() - ONTHEFFING_REMINDER_DAYS * DAY_MS);
  const t90 = new Date(now.getTime() - ONTHEFFING_REVIEW_DAYS * DAY_MS);
  const open: Prisma.OntheffingWhereInput = { status: { notIn: ["CONCEPT", "PROCESSED"] } };
  let reminded = 0;
  let flagged = 0;

  const toRemind = await prisma.ontheffing.findMany({ where: { ...open, lastActivityAt: { lte: t30 }, reminderSentAt: null }, select: { id: true, ringId: true } });
  for (const o of toRemind) {
    if (await notifyPresidium(o.id, o.ringId)) {
      await prisma.ontheffing.updateMany({ where: { id: o.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      reminded++;
    }
  }
  const toFlag = await prisma.ontheffing.findMany({ where: { ...open, lastActivityAt: { lte: t90 }, reviewFlaggedAt: null }, select: { id: true, ringId: true } });
  for (const o of toFlag) {
    await prisma.ontheffing.updateMany({ where: { id: o.id, reviewFlaggedAt: null }, data: { reviewFlaggedAt: now } });
    await notifyPresidium(o.id, o.ringId);
    flagged++;
  }
  return { reminded, flagged };
}

async function notifyPresidium(id: string, ringId: string): Promise<boolean> {
  try {
    const staff = await prisma.ringMembership.findMany({ where: { ringId, role: "RINGPRESIDIUM", active: true, user: { active: true } }, select: { userId: true } });
    await notify({ userIds: staff.map((s) => s.userId), ringId, ontheffingId: id, event: "CONFIDENTIAL_REMINDER", url: `/ontheffingen/${id}` });
    return true;
  } catch (err) {
    console.error(`[ontheffingen] Herinnering voor dossier ${id} mislukt:`, err);
    return false;
  }
}

/** Expliciete beoordeling van een openstaand dossier: aanhouden start de termijnen opnieuw (verwijderen kan via deleteOntheffing). */
export async function reviewOntheffing(actorId: string, id: string): Promise<void> {
  const { o } = await requireStaffAccess(actorId, id);
  if (o.status === "CONCEPT" || o.status === "PROCESSED") throw new WorkflowError("Dit dossier hoeft niet te worden beoordeeld.");
  await prisma.$transaction(async (tx) => {
    await lock(tx, id);
    await touch(tx, id);
    await audit(tx, id, actorId, "REVIEWED", "aangehouden");
  });
}
