import type { Calling, CallingDraft, FunctionSource, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { STAFF_ROLES } from "./rbac";
import { getCatalogEntry, requiresProcedureConfirmation, isOutsideRingtoolsFunctionName, OUTSIDE_RINGTOOLS, CATALOG_VERSION, type CatalogEntry } from "./catalog/callings";
import { eligibleAppointers, eligibleForRule, explainAuthorityGap, listUnits } from "./ringSetup";
import { WorkflowError, AuthorizationError, assertNotSecretariat, assignTask, createCallingInTx, deliverCreationNotifications } from "./workflow";

/**
 * Roepingsvoorstellen via concepten (Fase C3). Een concept mag onvolledig zijn, is alleen zichtbaar voor ringstaf van de eigen ring,
 * start geen ondersteuningsronde en verstuurt geen enkele melding. Bij indienen wordt alles opnieuw server-side gevalideerd; het
 * indienen is atomair en idempotent. De naam van de persoon wordt altijd handmatig ingevoerd (geen ledenregister, geen LCR-koppeling).
 */

export type DraftInput = Partial<{
  personName: string | null;
  unitId: string | null;
  functionSource: FunctionSource | null;
  functionCode: string | null;
  roepenAssigneeId: string | null;
  ondersteunenAssigneeId: string | null;
  aanstellenAssigneeId: string | null;
  roepenExternalName: string | null;
  aanstellenExternalName: string | null;
  procedureConfirmed: boolean;
}>;

/** Staf van een actieve ring met een actief account (de webmin neemt niet deel aan voorstellen). */
async function requireStaff(userId: string, ringId: string) {
  const m = await prisma.ringMembership.findFirst({
    where: { userId, ringId, active: true, role: { in: STAFF_ROLES }, user: { active: true, role: { not: "ADMIN" } }, ring: { active: true } },
  });
  if (!m) throw new AuthorizationError();
  return m;
}

async function draftFor(userId: string, draftId: string) {
  const draft = await prisma.callingDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new AuthorizationError(); // zelfde antwoord als "geen toegang": geen informatie over bestaan
  await requireStaff(userId, draft.ringId);
  return draft;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
};

// ---- Functie en procedure ----

export type ResolvedFunction = {
  source: "STANDAARD" | "EIGEN";
  code: string;
  name: string;
  category: string;
  entry: CatalogEntry | null;
  requiresConfirmation: boolean;
};

/** Zoekt de gekozen functie op binnen DEZE ring (eigen roepingen van andere ringen bestaan hier niet). Vrije tekst is niet toegestaan. */
export async function resolveFunction(ringId: string, source: FunctionSource | null, code: string | null): Promise<ResolvedFunction> {
  if (!source || !code) throw new WorkflowError("Kies een roeping uit de catalogus of een eigen roeping.");
  if (source === "STANDAARD") {
    const entry = getCatalogEntry(code);
    if (!entry || !entry.active) throw new WorkflowError("Deze roeping bestaat niet (meer) in de catalogus.");
    if (!entry.ringtoolsProcess) throw new WorkflowError("Voor deze roeping loopt de procedure buiten Ringtools; er kan hier geen voorstel voor worden ingediend.");
    return { source: "STANDAARD", code, name: entry.name, category: entry.category, entry, requiresConfirmation: requiresProcedureConfirmation(entry) };
  }
  if (source === "EIGEN") {
    const own = await prisma.ringCustomCalling.findFirst({ where: { id: code, ringId, active: true, ring: { active: true } } });
    if (!own) throw new WorkflowError("Deze eigen roeping bestaat niet in deze ring.");
    // Ook een eigen roeping die al bestaat (van vóór deze controle) kan hier niet meer worden gebruikt.
    if (isOutsideRingtoolsFunctionName(own.name)) throw new WorkflowError(OUTSIDE_RINGTOOLS);
    return { source: "EIGEN", code, name: own.name, category: own.category, entry: null, requiresConfirmation: true };
  }
  throw new WorkflowError("Kies een roeping uit de catalogus of een eigen roeping.");
}

export function procedureSnapshot(fn: ResolvedFunction): Prisma.InputJsonValue {
  const e = fn.entry;
  return {
    source: fn.source,
    code: fn.code,
    name: fn.name,
    category: fn.category,
    catalogVersion: e ? CATALOG_VERSION : null,
    ruleStatus: e ? e.ruleStatus : "EIGEN",
    approvalRoute: e?.approvalRoute ?? null,
    grantedBy: e?.grantedBy ?? null,
    appointedBy: e?.appointedBy ?? null,
    supportVenue: e?.supportVenue ?? null,
    appointment: e?.appointment ?? null,
    handbook: e?.handbook ?? [],
    reviewNotes: e?.reviewNotes ?? [],
    capturedAt: new Date().toISOString(),
  };
}

// ---- Verantwoordelijken ----

type Which = "grantedBy" | "appointedBy";

async function eligibleIds(ringId: string, fn: ResolvedFunction | null, which: Which): Promise<Set<string>> {
  if (!fn || fn.source !== "STANDAARD") return new Set();
  return new Set((await eligibleAppointers(ringId, fn.code, which)).appointers.map((a) => a.id));
}

async function assertMembers(ringId: string, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return;
  const n = await prisma.ringMembership.count({ where: { ringId, userId: { in: unique }, active: true, user: { active: true }, ring: { active: true } } });
  if (n !== unique.length) throw new WorkflowError("Een gekozen verantwoordelijke is geen actief lid van deze ring.");
}

/**
 * Valideert de gekozen taakverantwoordelijken. Roepen en aanstellen vereisen een aantoonbare bevoegdheid: alleen personen die voor een
 * geverifieerde standaardroeping expliciet zijn aangewezen. Bij een eigen of niet-geverifieerde roeping is een interne uitvoerder niet te
 * kiezen; dan kan een bevoegde externe persoon handmatig worden geregistreerd. Ondersteunen (steunverlening) kent geen bevoegdheidsregel.
 */
async function validateAssignees(ringId: string, fn: ResolvedFunction | null, a: {
  roepenAssigneeId: string | null; ondersteunenAssigneeId: string | null; aanstellenAssigneeId: string | null;
  roepenExternalName: string | null; aanstellenExternalName: string | null;
}) {
  await assertMembers(ringId, [a.roepenAssigneeId, a.ondersteunenAssigneeId, a.aanstellenAssigneeId]);
  if (a.ondersteunenAssigneeId) await assertNotSecretariat(ringId, a.ondersteunenAssigneeId);
  for (const [label, internal, external] of [["roepen", a.roepenAssigneeId, a.roepenExternalName], ["aanstellen", a.aanstellenAssigneeId, a.aanstellenExternalName]] as const) {
    if (internal && external) throw new WorkflowError(`Kies voor ${label} óf een persoon uit de ring óf een externe persoon, niet beide.`);
  }
  if (a.roepenAssigneeId && !(await eligibleIds(ringId, fn, "grantedBy")).has(a.roepenAssigneeId)) {
    throw new WorkflowError("Deze persoon heeft geen aangewezen bevoegdheid om voor deze functie te roepen. Kies een bevoegde persoon of registreer een externe persoon.");
  }
  if (a.aanstellenAssigneeId && !(await eligibleIds(ringId, fn, "appointedBy")).has(a.aanstellenAssigneeId)) {
    throw new WorkflowError("Deze persoon heeft geen aangewezen bevoegdheid om voor deze functie aan te stellen. Kies een bevoegde persoon of registreer een externe persoon.");
  }
}

/** Wijzigt achteraf een taakverantwoordelijke van een voorstel met vastgelegde procedure: dezelfde bevoegdheidscontrole, ook bij directe API-aanroepen. */
export async function assignTaskChecked(input: { actorId: string; callingId: string; task: "ROEPEN" | "ONDERSTEUNEN" | "AANSTELLEN"; assigneeId: string | null; externalName?: string | null }) {
  const calling = await prisma.calling.findUnique({ where: { id: input.callingId } });
  if (!calling) throw new AuthorizationError();
  await requireStaff(input.actorId, calling.ringId);
  if (calling.status === "PROCESSED") throw new WorkflowError("Deze roeping is al verwerkt.");
  const external = text(input.externalName, 120);
  const structured = calling.functionSource === "STANDAARD" || calling.functionSource === "EIGEN";
  if (input.task === "ONDERSTEUNEN") {
    if (external) throw new WorkflowError("Voor ondersteunen kan geen externe persoon worden geregistreerd.");
    return null; // geen bevoegdheidsregel: de bestaande workflow doet de rest
  }
  if (structured && input.assigneeId) {
    const which: Which = input.task === "ROEPEN" ? "grantedBy" : "appointedBy";
    // Bevoegdheid volgens de bij indienen vastgelegde procedure (snapshot), niet volgens de actuele catalogus. Alleen voor voorstellen
    // van vóór de snapshot (zonder procedureSnapshot) valt dit terug op de catalogus.
    const snap = calling.procedureSnapshot && typeof calling.procedureSnapshot === "object" && !Array.isArray(calling.procedureSnapshot)
      ? (calling.procedureSnapshot as Record<string, unknown>) : null;
    let allowedIds: Set<string>;
    if (snap) {
      const rule = typeof snap[which] === "string" ? (snap[which] as string) : null;
      const status = typeof snap.ruleStatus === "string" ? (snap.ruleStatus as string) : null;
      allowedIds = new Set((await eligibleForRule(calling.ringId, status, rule)).appointers.map((a) => a.id));
    } else if (calling.functionSource === "STANDAARD" && calling.functionCode) {
      allowedIds = await eligibleIds(calling.ringId, { source: "STANDAARD", code: calling.functionCode, name: calling.functionTitle, category: "", entry: null, requiresConfirmation: false }, which);
    } else {
      allowedIds = new Set();
    }
    if (!allowedIds.has(input.assigneeId)) {
      throw new WorkflowError("Deze persoon heeft geen aangewezen bevoegdheid voor deze stap. Kies een bevoegde persoon of registreer een externe persoon.");
    }
  }
  if (external && input.assigneeId) throw new WorkflowError("Kies óf een persoon uit de ring óf een externe persoon, niet beide.");
  if (external) {
    if (external.length < 2) throw new WorkflowError("Vul de naam van de externe persoon in.");
    return { externalName: external };
  }
  return null;
}

/**
 * Eén ingang voor het wijzigen van een taakverantwoordelijke (app-API én overgangswebapp): bevoegdheidscontrole, handmatige registratie van
 * een externe bevoegde persoon en daarna de bestaande workflow (meldingen aan de nieuwe verantwoordelijke).
 */
export async function assignTaskGuarded(input: { actorId: string; callingId: string; task: "ROEPEN" | "ONDERSTEUNEN" | "AANSTELLEN"; assigneeId: string | null; externalName?: string | null }) {
  const external = await assignTaskChecked(input);
  await assignTask({ callingId: input.callingId, task: input.task, assigneeId: input.assigneeId, externalName: external?.externalName ?? null });
}

/** Na een gekozen interne uitvoerder vervalt een eerder geregistreerde externe naam (er is steeds één uitvoerder per stap). */
export async function clearExternalName(callingId: string, task: "ROEPEN" | "AANSTELLEN") {
  await prisma.calling.update({ where: { id: callingId }, data: { [task === "ROEPEN" ? "roepenExternalName" : "aanstellenExternalName"]: null } });
}

// ---- Concepten ----

function clean(input: DraftInput): Partial<Prisma.CallingDraftUncheckedUpdateInput> {
  const data: Record<string, unknown> = {};
  if ("personName" in input) data.personName = text(input.personName, 200);
  for (const k of ["unitId", "functionCode", "roepenAssigneeId", "ondersteunenAssigneeId", "aanstellenAssigneeId"] as const) {
    if (k in input) data[k] = typeof input[k] === "string" && input[k] ? input[k] : null;
  }
  if ("functionSource" in input) data.functionSource = input.functionSource === "STANDAARD" || input.functionSource === "EIGEN" ? input.functionSource : null;
  for (const k of ["roepenExternalName", "aanstellenExternalName"] as const) if (k in input) data[k] = text(input[k], 120);
  if ("procedureConfirmed" in input) data.procedureConfirmed = input.procedureConfirmed === true;
  return data;
}

/** Een concept mag onvolledig zijn, maar verwijzingen die er wél in staan moeten bij deze ring horen (geen kruisverwijzing tussen ringen). */
async function assertRefsBelongToRing(ringId: string, d: Partial<CallingDraft>) {
  if (d.unitId) {
    const unit = await prisma.ringUnit.findFirst({ where: { id: d.unitId, ringId, active: true, ring: { active: true } } });
    if (!unit) throw new WorkflowError("Deze wijk of gemeente hoort niet bij deze ring of is gedeactiveerd.");
  }
  if (d.functionSource && d.functionCode) await resolveFunction(ringId, d.functionSource, d.functionCode);
  await assertMembers(ringId, [d.roepenAssigneeId, d.ondersteunenAssigneeId, d.aanstellenAssigneeId]);
}

export async function createDraft(actorId: string, ringId: string, input: DraftInput) {
  await requireStaff(actorId, ringId);
  const data = clean(input);
  await assertRefsBelongToRing(ringId, data as Partial<CallingDraft>);
  return prisma.callingDraft.create({ data: { ringId, createdById: actorId, ...(data as object) } });
}

export async function updateDraft(actorId: string, draftId: string, input: DraftInput) {
  const draft = await draftFor(actorId, draftId);
  if (draft.submittedAt) throw new WorkflowError("Dit concept is al ingediend.");
  const data = clean(input);
  await assertRefsBelongToRing(draft.ringId, { ...draft, ...(data as Partial<CallingDraft>) });
  return prisma.callingDraft.update({ where: { id: draft.id }, data: data as Prisma.CallingDraftUncheckedUpdateInput });
}

export async function deleteDraft(actorId: string, draftId: string) {
  const draft = await draftFor(actorId, draftId);
  await prisma.callingDraft.delete({ where: { id: draft.id } });
}

export async function listDrafts(actorId: string, ringId: string) {
  await requireStaff(actorId, ringId);
  const drafts = await prisma.callingDraft.findMany({ where: { ringId, submittedAt: null }, orderBy: { updatedAt: "desc" }, take: 50 });
  const units = new Map((await listUnits(ringId)).map((u) => [u.id, u.name]));
  return drafts.map((d) => ({
    id: d.id, personName: d.personName, functionCode: d.functionCode, functionSource: d.functionSource,
    unitName: d.unitId ? (units.get(d.unitId) ?? null) : null, updatedAt: d.updatedAt.toISOString(),
  }));
}

export type Suggestion = { userId: string; name: string; source: "UNIT_STANDAARD" | "UNIT_VERANTWOORDELIJKE" | "FUNCTIE_RINGPRESIDENT" | "FUNCTIE_ENIGE_BEVOEGDE"; basis?: string } | null;

/**
 * Voorgestelde verantwoordelijken. Alleen leden die volgens de geverifieerde procedure bevoegd zijn (kerkelijke functie + zo nodig expliciete machtiging)
 * komen in aanmerking; de rest van de regels staat in `eligibleForRule`. Volgorde van voorkeur:
 * 1. de standaardverantwoordelijke of het verantwoordelijke hogeraadslid van de wijk/gemeente, maar ALLEEN als die persoon bevoegd is (een wijkkoppeling
 *    is nooit een machtiging);
 * 2. de ringpresident, als de regel hem noemt en hij bevoegd is;
 * 3. de enige bevoegde persoon, als er precies één is.
 * Zijn er meer bevoegden en geen duidelijke keuze, dan wordt niets voorgesteld en kiest de gebruiker uit de bevoegden. Bij niet-geverifieerde of
 * bijzondere procedures wordt nooit iemand voorgesteld (menselijke controle nodig); een EXTERNE bevoegde uitvoerder zonder Ringtools-account wordt
 * altijd handmatig geregistreerd en nooit voorgesteld.
 */
export async function buildSuggestions(ringId: string, draft: Pick<CallingDraft, "unitId" | "functionSource" | "functionCode">) {
  const unit = draft.unitId ? (await listUnits(ringId)).find((u) => u.id === draft.unitId && u.active) ?? null : null;
  let fn: ResolvedFunction | null = null;
  try {
    fn = draft.functionSource && draft.functionCode ? await resolveFunction(ringId, draft.functionSource, draft.functionCode) : null;
  } catch {
    fn = null;
  }
  const std = fn && fn.source === "STANDAARD";
  const grantedList = std ? (await eligibleAppointers(ringId, fn!.code, "grantedBy")).appointers : [];
  const appointedList = std ? (await eligibleAppointers(ringId, fn!.code, "appointedBy")).appointers : [];
  const granted = new Set(grantedList.map((a) => a.id));
  const appointed = new Set(appointedList.map((a) => a.id));
  const pickFrom = (
    candidates: { id: string; name: string; source: "UNIT_STANDAARD" | "UNIT_VERANTWOORDELIJKE" }[],
    list: { id: string; name: string; authority: string; basis: string }[] | null
  ): Suggestion => {
    for (const c of candidates) {
      if (!list) return { userId: c.id, name: c.name, source: c.source };
      const hit = list.find((a) => a.id === c.id);
      if (hit) return { userId: c.id, name: c.name, source: c.source, basis: hit.basis };
    }
    if (!list) return null;
    const president = list.find((a) => a.authority === "RINGPRESIDENT");
    if (president) return { userId: president.id, name: president.name, source: "FUNCTIE_RINGPRESIDENT", basis: president.basis };
    if (list.length === 1) return { userId: list[0].id, name: list[0].name, source: "FUNCTIE_ENIGE_BEVOEGDE", basis: list[0].basis };
    return null;
  };
  const cands = (def: { id: string; name: string } | null | undefined) => [
    ...(def ? [{ ...def, source: "UNIT_STANDAARD" as const }] : []),
    ...(unit?.responsible ? [{ ...unit.responsible, source: "UNIT_VERANTWOORDELIJKE" as const }] : []),
  ];
  const entry = std ? fn!.entry : null;
  const note = async (allowed: Set<string>, rule: string | null) => {
    if (!fn) return null;
    if (fn.source !== "STANDAARD" || fn.entry?.ruleStatus !== "GEVERIFIEERD") {
      return "Menselijke controle nodig: voor deze functie zijn geen bevoegdheden vastgesteld. Registreer zo nodig een bevoegde externe persoon (zonder Ringtools-account).";
    }
    if (allowed.size > 0) return null;
    const why = await explainAuthorityGap(ringId, rule);
    return `Er is in deze ring niemand die dit voor deze functie mag. ${why.join(" ")} Leg eerst de kerkelijke functie en zo nodig de machtiging vast, of registreer een bevoegde externe persoon (zonder Ringtools-account).`.trim();
  };
  const names = new Map([...grantedList, ...appointedList].map((a) => [a.id, a.name]));
  return {
    unit: unit ? { id: unit.id, name: unit.name, kind: unit.kind, responsibleStatus: unit.responsibleStatus } : null,
    roepen: pickFrom(cands(unit?.defaults.roepen), std ? grantedList : []),
    ondersteunen: pickFrom(cands(unit?.defaults.ondersteunen), null),
    aanstellen: pickFrom(cands(unit?.defaults.aanstellen), std ? appointedList : []),
    notes: { roepen: await note(granted, entry?.grantedBy ?? null), aanstellen: await note(appointed, entry?.appointedBy ?? null) },
    eligible: {
      roepen: grantedList.map((a) => ({ id: a.id, name: names.get(a.id) ?? a.name, basis: a.basis, churchFunction: a.churchFunction })),
      aanstellen: appointedList.map((a) => ({ id: a.id, name: names.get(a.id) ?? a.name, basis: a.basis, churchFunction: a.churchFunction })),
    },
  };
}

export async function getDraftView(actorId: string, draftId: string) {
  const draft = await draftFor(actorId, draftId);
  let procedure: ResolvedFunction | null = null;
  try {
    procedure = draft.functionSource && draft.functionCode ? await resolveFunction(draft.ringId, draft.functionSource, draft.functionCode) : null;
  } catch {
    procedure = null;
  }
  return { draft, procedure, suggestions: await buildSuggestions(draft.ringId, draft) };
}

/**
 * Dient een concept in. Alles wordt opnieuw gevalideerd; het indienen is atomair en idempotent (rij-lock + 'submittedAt'): een herhaald verzoek of
 * dubbel tikken maakt nooit een tweede voorstel en verstuurt nooit dubbele meldingen. Na indienen worden de persoonsgegevens uit het concept gewist.
 */
export async function submitDraft(actorId: string, draftId: string): Promise<{ calling: Calling; alreadySubmitted: boolean; notificationsDelivered: boolean }> {
  const first = await draftFor(actorId, draftId);

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CallingDraft" WHERE "id" = ${draftId} FOR UPDATE`;
    const draft = await tx.callingDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.submittedAt && draft.submittedCallingId) {
      return { calling: await tx.calling.findUniqueOrThrow({ where: { id: draft.submittedCallingId } }), created: false };
    }
    const ringId = draft.ringId;

    const personName = text(draft.personName, 200);
    if (!personName || personName.length < 2) throw new WorkflowError("Vul de naam van de persoon in.");

    const activeUnits = await tx.ringUnit.count({ where: { ringId, active: true } });
    const unit = draft.unitId ? await tx.ringUnit.findFirst({ where: { id: draft.unitId, ringId, active: true } }) : null;
    if (draft.unitId && !unit) throw new WorkflowError("Deze wijk of gemeente hoort niet bij deze ring of is gedeactiveerd.");
    // De wijk of gemeente van herkomst is verplicht. Zolang de ringinrichting geen actieve wijken of gemeenten kent, kan er dus niets
    // worden ingediend (het concept blijft bewaard); de ringbeheerder of webmin richt eerst de wijken en gemeenten in.
    if (activeUnits === 0) {
      throw new WorkflowError("De ringinrichting is nog niet compleet: er zijn geen wijken of gemeenten ingevoerd. Laat de ringbeheerder deze eerst invoeren; je concept blijft bewaard.");
    }
    if (!unit) throw new WorkflowError("Kies de wijk of gemeente van herkomst.");

    const fn = await resolveFunction(ringId, draft.functionSource, draft.functionCode);
    if (fn.requiresConfirmation && !draft.procedureConfirmed) {
      throw new WorkflowError(
        fn.source === "EIGEN"
          ? "Bevestig dat de bevoegde leiding de procedure voor deze eigen roeping heeft gecontroleerd."
          : "Voor deze roeping zijn de bevoegdheden niet geverifieerd. Bevestig dat de bevoegde leiding de procedure heeft gecontroleerd."
      );
    }
    const assignees = {
      roepenAssigneeId: draft.roepenAssigneeId, ondersteunenAssigneeId: draft.ondersteunenAssigneeId, aanstellenAssigneeId: draft.aanstellenAssigneeId,
      roepenExternalName: text(draft.roepenExternalName, 120), aanstellenExternalName: text(draft.aanstellenExternalName, 120),
    };
    await validateAssignees(ringId, fn, assignees);

    const now = new Date();
    const { calling } = await createCallingInTx(tx, {
      ringId,
      personName,
      functionTitle: fn.name, // Nederlandse functienaam op het moment van indienen
      createdById: draft.createdById,
      roepenAssigneeId: assignees.roepenAssigneeId,
      ondersteunenAssigneeId: assignees.ondersteunenAssigneeId,
      aanstellenAssigneeId: assignees.aanstellenAssigneeId,
      meta: {
        unitId: unit?.id ?? null, unitNameSnapshot: unit?.name ?? null, unitKindSnapshot: unit?.kind ?? null,
        functionSource: fn.source, functionCode: fn.code, catalogVersion: fn.entry ? CATALOG_VERSION : null,
        procedureSnapshot: procedureSnapshot(fn),
        procedureConfirmedAt: fn.requiresConfirmation ? now : null, procedureConfirmedById: fn.requiresConfirmation ? actorId : null,
        roepenExternalName: assignees.roepenExternalName, aanstellenExternalName: assignees.aanstellenExternalName,
      },
    });
    await tx.callingDraft.update({
      where: { id: draftId },
      data: {
        submittedAt: now, submittedCallingId: calling.id,
        personName: null, unitId: null, functionCode: null, functionSource: null, functionName: null,
        roepenAssigneeId: null, ondersteunenAssigneeId: null, aanstellenAssigneeId: null, roepenExternalName: null, aanstellenExternalName: null,
      },
    });
    return { calling, created: true };
  });

  void first;
  // Het voorstel staat nu definitief in de database. Meldingen gaan los daarvan en zijn herstelbaar: ook bij een herhaald verzoek
  // (alreadySubmitted) wordt een eerder mislukte levering alsnog afgemaakt, zonder dubbele meldingen (claim + skipExisting).
  const delivery = await deliverCreationNotifications(outcome.calling.id);
  return { calling: outcome.calling, alreadySubmitted: !outcome.created, notificationsDelivered: delivery === "sent" || delivery === "already-sent" };
}

/** Opruimregels: verlaten concepten na 30 dagen zonder wijziging; ingediende concepten (alleen nog een sleutel) na 7 dagen. */
export const DRAFT_ABANDONED_DAYS = 30;
export const DRAFT_SUBMITTED_KEY_DAYS = 7;
export async function deleteStaleDrafts(now: Date = new Date()): Promise<number> {
  const day = 24 * 60 * 60 * 1000;
  const res = await prisma.callingDraft.deleteMany({
    where: {
      OR: [
        { submittedAt: null, updatedAt: { lt: new Date(now.getTime() - DRAFT_ABANDONED_DAYS * day) } },
        { submittedAt: { lt: new Date(now.getTime() - DRAFT_SUBMITTED_KEY_DAYS * day) } },
      ],
    },
  });
  return res.count;
}
