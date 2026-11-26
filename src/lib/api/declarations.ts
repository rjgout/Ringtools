import { ApiError, str } from "./http";
import type { ApiAuth } from "./auth";
import * as decl from "../declarations/service";
import * as profile from "../declarations/profile";
import * as finance from "../declarations/finance";
import { env } from "../env";

/** Zet module-fouten om naar ApiError; zonder de functievlag bestaat de module niet (404). */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  if (!env.declarationsEnabled) throw new ApiError(404, "Niet gevonden.", "not-found");
  try {
    return await fn();
  } catch (err) {
    if (err instanceof decl.DeclarationError || err instanceof finance.FinanceError) throw new ApiError(err.status, err.message, err.code);
    throw err;
  }
}

export const context = (auth: ApiAuth) => guard(() => profile.getDeclarationContext(auth.user.id));
export const saveProfile = (auth: ApiAuth, body: Record<string, unknown>) => guard(async () => { await profile.saveDeclarationProfile(auth.user.id, body as { name: unknown; ringId: unknown; unitId?: unknown }); return { ok: true }; });
export const submit = (auth: ApiAuth, body: Record<string, unknown>) => guard(() => decl.submitDeclaration(auth.user.id, body as decl.DeclarationInput));
export const listMine = (auth: ApiAuth) => guard(async () => ({ items: await decl.listMine(auth.user.id) }));
export const listOfficial = (auth: ApiAuth, status: string | null) => guard(() => decl.listForOfficial(auth.user.id, { status }));
export const detail = (auth: ApiAuth, id: string) => guard(() => decl.openDeclaration(auth.user.id, id));
export const setStatus = (auth: ApiAuth, id: string, body: Record<string, unknown>) => guard(async () => ({ status: await decl.setStatus(auth.user.id, id, body.status, body.note) }));
export const download = (auth: ApiAuth, id: string, attachmentId: string) => guard(async () => {
  const f = await decl.downloadAttachment(auth.user.id, id, attachmentId);
  return { fileName: f.fileName, mimeType: f.mimeType, dataBase64: f.bytes.toString("base64") };
});

// Financiële functies (alleen ringbeheerders van de eigen ring; de service controleert dat server-side).
export const listAssignments = (auth: ApiAuth, ringId: string) => guard(() => finance.listAssignments(auth.user.id, ringId));
// Bewust één antwoord: de ringbeheerder leert niet of het adres al een account heeft.
export const assign = (auth: ApiAuth, ringId: string, body: Record<string, unknown>) => guard(async () => {
  await finance.assignFinanceRole({ actorId: auth.user.id, ringId, unitId: str(body.unitId) || null, email: str(body.email), role: body.role as never });
  return { ok: true };
});
export const revoke = (auth: ApiAuth, id: string, pending: boolean) => guard(async () => {
  if (pending) await finance.revokePendingAssignment({ actorId: auth.user.id, pendingId: id });
  else await finance.revokeFinanceAssignment({ actorId: auth.user.id, assignmentId: id });
  return { ok: true };
});
