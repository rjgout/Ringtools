import { prisma } from "../prisma";
import { buildSuggestions, createDraft, deleteDraft, getDraftView, listDrafts, submitDraft, updateDraft, type DraftInput } from "../proposals";
import { mapErrors } from "./service";

function parse(body: Record<string, unknown>): DraftInput {
  const out: DraftInput = {};
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : null);
  for (const k of ["personName", "unitId", "functionCode", "roepenAssigneeId", "ondersteunenAssigneeId", "aanstellenAssigneeId", "roepenExternalName", "aanstellenExternalName"] as const) {
    if (k in body) out[k] = str(k);
  }
  if ("functionSource" in body) out.functionSource = body.functionSource === "STANDAARD" || body.functionSource === "EIGEN" ? body.functionSource : null;
  if ("procedureConfirmed" in body) out.procedureConfirmed = body.procedureConfirmed === true;
  return out;
}

export async function createDraftFor(userId: string, ringId: string, body: Record<string, unknown>) {
  const draft = await mapErrors(() => createDraft(userId, ringId, parse(body)));
  return { id: draft.id };
}
export async function updateDraftFor(userId: string, id: string, body: Record<string, unknown>) {
  await mapErrors(() => updateDraft(userId, id, parse(body)));
  return { ok: true };
}
export async function deleteDraftFor(userId: string, id: string) {
  await mapErrors(() => deleteDraft(userId, id));
  return { ok: true };
}
export async function listDraftsFor(userId: string, ringId: string) {
  return { drafts: await mapErrors(() => listDrafts(userId, ringId)) };
}
export async function getDraftFor(userId: string, id: string) {
  const view = await mapErrors(() => getDraftView(userId, id));
  const d = view.draft;
  const p = view.procedure;
  return {
    draft: {
      id: d.id, ringId: d.ringId, personName: d.personName, unitId: d.unitId, functionSource: d.functionSource, functionCode: d.functionCode,
      roepenAssigneeId: d.roepenAssigneeId, ondersteunenAssigneeId: d.ondersteunenAssigneeId, aanstellenAssigneeId: d.aanstellenAssigneeId,
      roepenExternalName: d.roepenExternalName, aanstellenExternalName: d.aanstellenExternalName, procedureConfirmed: d.procedureConfirmed,
      submitted: !!d.submittedAt, updatedAt: d.updatedAt.toISOString(),
    },
    procedure: p
      ? {
          source: p.source, code: p.code, name: p.name, category: p.category, ruleStatus: p.entry?.ruleStatus ?? "EIGEN",
          requiresConfirmation: p.requiresConfirmation, warning: p.entry?.warning ?? "Eigen roeping: er worden geen bevoegdheden of bijzondere kerkelijke procedures afgeleid.",
          reviewNotes: p.entry?.reviewNotes ?? [],
        }
      : null,
    suggestions: view.suggestions,
  };
}
/** Suggesties zonder concept (bijv. na het kiezen van unit en functie, vóór opslaan). */
export async function suggestionsFor(userId: string, ringId: string, query: URLSearchParams) {
  const m = await prisma.ringMembership.findFirst({ where: { userId, ringId, active: true, ring: { active: true } } });
  if (!m) return { suggestions: null };
  const src = query.get("source");
  return {
    suggestions: await buildSuggestions(ringId, {
      unitId: query.get("unit") || null, functionSource: src === "STANDAARD" || src === "EIGEN" ? src : null, functionCode: query.get("code") || null,
    }),
  };
}
export async function submitDraftFor(userId: string, id: string) {
  const r = await mapErrors(() => submitDraft(userId, id));
  return { id: r.calling.id, alreadySubmitted: r.alreadySubmitted };
}
