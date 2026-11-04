import type { AccountLinkMode, FollowUpAnswer, FunctionSource } from "@prisma/client";
import {
  castOntheffingVote, createConcept, deleteOntheffing, getOntheffingView, listOntheffingen, markInformed, processPerson, registerAnnouncement,
  registerOntheffingDecision, releaseOntheffingToHogeraad, renamePerson, reviewOntheffing, submitOntheffing, updateConcept, type ConceptInput, type PersonInput,
} from "../ontheffingen";
import { ApiError, str } from "./http";
import { mapErrors } from "./service";

function parsePersons(raw: unknown): PersonInput[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 5) throw new ApiError(400, "Ongeldige gegevens van de betrokkenen.", "validation");
  return raw.map((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const p: PersonInput = { role: o.role === "RAADGEVER" ? "RAADGEVER" : "HOOFD" };
    if ("followUpCode" in o) p.followUpCode = typeof o.followUpCode === "string" ? o.followUpCode : null;
    if ("name" in o) p.name = typeof o.name === "string" ? o.name : null;
    if ("naReason" in o) p.naReason = typeof o.naReason === "string" ? o.naReason : null;
    if (typeof o.answer === "string") p.answer = o.answer as FollowUpAnswer;
    if (typeof o.accountMode === "string") p.accountMode = o.accountMode as AccountLinkMode;
    if ("userId" in o) p.userId = typeof o.userId === "string" ? o.userId : null;
    return p;
  });
}

function parseConcept(body: Record<string, unknown>): ConceptInput {
  const out: ConceptInput = {};
  if ("unitId" in body) out.unitId = typeof body.unitId === "string" && body.unitId ? body.unitId : null;
  if ("functionSource" in body) out.functionSource = (body.functionSource === "STANDAARD" || body.functionSource === "EIGEN" ? body.functionSource : null) as FunctionSource | null;
  if ("functionCode" in body) out.functionCode = typeof body.functionCode === "string" && body.functionCode ? body.functionCode : null;
  if ("procedureConfirmed" in body) out.procedureConfirmed = body.procedureConfirmed === true;
  const persons = parsePersons(body.persons);
  if (persons) out.persons = persons;
  return out;
}

export const listFor = async (userId: string, ringId: string) => ({ ontheffingen: await mapErrors(() => listOntheffingen(userId, ringId)) });
export const createFor = async (userId: string, ringId: string, body: Record<string, unknown>) => mapErrors(() => createConcept(userId, ringId, parseConcept(body)));
export const viewFor = (userId: string, id: string) => mapErrors(() => getOntheffingView(userId, id));
export async function updateFor(userId: string, id: string, body: Record<string, unknown>) {
  await mapErrors(() => updateConcept(userId, id, parseConcept(body)));
  return { ok: true };
}
export const submitFor = (userId: string, id: string) => mapErrors(() => submitOntheffing(userId, id));
export async function deleteFor(userId: string, id: string, confirmed: boolean) {
  await mapErrors(() => deleteOntheffing(userId, id, confirmed));
  return { ok: true };
}
export async function voteFor(userId: string, id: string, support: unknown) {
  if (typeof support !== "boolean") throw new ApiError(400, "Geef aan of je ondersteunt.", "validation");
  return { status: await mapErrors(() => castOntheffingVote(userId, id, support)) };
}
export async function releaseFor(userId: string, id: string) {
  return mapErrors(() => releaseOntheffingToHogeraad(userId, id));
}
export async function decisionFor(userId: string, id: string, body: Record<string, unknown>) {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (body.stage !== "PRESIDIUM" && body.stage !== "HOGERAAD") throw new ApiError(400, "Kies de fase van het besluit.", "validation");
  return mapErrors(() =>
    registerOntheffingDecision(userId, id, {
      stage: body.stage as "PRESIDIUM" | "HOGERAAD", decidedOn: str(body.decidedOn), agreed: body.agreed === true, note: str(body.note) || undefined,
      presidingUserId: str(body.presidingUserId) || undefined, presentUserIds: ids(body.presentUserIds), absentUserIds: ids(body.absentUserIds),
      resolveNegative: body.resolveNegative === true, resolutionNote: str(body.resolutionNote) || undefined,
    })
  );
}
export async function reviewFor(userId: string, id: string) {
  await mapErrors(() => reviewOntheffing(userId, id));
  return { ok: true };
}
export async function personStepFor(userId: string, personId: string, step: string, body: Record<string, unknown>) {
  if (step === "inform") { await mapErrors(() => markInformed(userId, personId)); return { ok: true }; }
  if (step === "announce") { await mapErrors(() => registerAnnouncement(userId, personId, { thanksOffered: body.thanksOffered as boolean })); return { ok: true }; }
  if (step === "process") return mapErrors(() => processPerson(userId, personId));
  if (step === "rename") { await mapErrors(() => renamePerson(userId, personId, str(body.name))); return { ok: true }; }
  throw new ApiError(404, "Niet gevonden.", "not-found");
}
