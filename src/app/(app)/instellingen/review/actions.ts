"use server";
import { AuthorizationError } from "@/lib/workflow";
import { revalidatePath } from "next/cache";
import { requireRole, requireRecentMfa } from "@/lib/session";
import { provisionReviewDemo, resetReviewDemo, setReviewAccountActive, ReviewManagementError } from "@/lib/reviewDemo";
import { completeAccountDeletion, AccountDeletionError } from "@/lib/accountDeletion";
export type Result = { ok: boolean; message: string };
async function administrator() {
  const user = await requireRole(["ADMIN"]);
  await requireRecentMfa("/mfa/totp?redirect=%2Finstellingen%2Freview");
  return user;
}
const text = (f: FormData, key: string) => String(f.get(key) ?? "");
function failure(err: unknown): Result {
  if (err instanceof AuthorizationError) return { ok: false, message: "Je hebt geen bevoegdheid voor deze beheeractie." };
  if (err instanceof ReviewManagementError || err instanceof AccountDeletionError) return { ok: false, message: err.message };
  throw err;
}
export async function provisionAction(_previous: Result | null, form: FormData): Promise<Result> {
  const actor = await administrator();
  try {
    await provisionReviewDemo(actor.id, [1,2,3].map(i => text(form, `password${i}`)));
    revalidatePath("/instellingen/review");
    return { ok: true, message: "Reviewaccounts opgeslagen. Gewijzigde wachtwoorden hebben de bestaande sessies ingetrokken. Wachtwoorden worden niet getoond of bewaard in deze pagina." };
  } catch (err) { return failure(err); }
}
export async function resetDemoAction(_previous: Result | null, form: FormData): Promise<Result> {
  const actor = await administrator();
  if (text(form, "confirmation") !== "Ringtools Demo") return { ok: false, message: "Typ ter bevestiging Ringtools Demo." };
  try { await resetReviewDemo(actor.id); revalidatePath("/instellingen/review"); return { ok: true, message: "Alleen de fictieve demo is hersteld. Reviewers kunnen opnieuw aanmelden." }; }
  catch (err) { return failure(err); }
}
export async function reviewActiveAction(_previous: Result | null, form: FormData): Promise<Result> {
  const actor = await administrator();
  try { await setReviewAccountActive(actor.id, text(form, "userId"), text(form, "active") === "true"); revalidatePath("/instellingen/review"); return { ok: true, message: "Toegang bijgewerkt; bestaande sessies zijn ingetrokken." }; }
  catch (err) { return failure(err); }
}
export async function completeDeletionAction(_previous: Result | null, form: FormData): Promise<Result> {
  const actor = await administrator();
  try {
    const result = await completeAccountDeletion(actor.id, text(form, "requestId"), { identityChecked: text(form, "identityChecked") === "on", retentionReason: text(form, "retentionReason") });
    revalidatePath("/instellingen/review");
    return result.completed ? { ok: true, message: "Het volledige account, alle lidmaatschappen, sessies en credentials zijn verwijderd." } : { ok: false, message: `Eerst verantwoordelijkheid overdragen of procedures afronden: ${result.blockers.map(b => `${b.kind}: ${b.count}`).join(", ")}. Er is niets verwijderd.` };
  } catch (err) { return failure(err); }
}
