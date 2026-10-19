"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { addMemberSchema, updateMemberSchema } from "@/lib/validation";
import { addMember, updateMember, RingError, AuthorizationError } from "@/lib/rings";

export type ActionResult = { ok: boolean; message: string };

function optional(value: FormDataEntryValue | null): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" ? undefined : v;
}

function failure(err: unknown): ActionResult {
  if (err instanceof RingError) return { ok: false, message: err.message };
  if (err instanceof AuthorizationError) return { ok: false, message: "Je hebt geen bevoegdheid voor deze actie." };
  throw err;
}

/** Voegt een gebruiker toe aan een ring. De bevoegdheid wordt in de lib server-side gecontroleerd (webmin of ringbeheerder van die ring). */
export async function addMemberAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();

  const parsed = addMemberSchema.safeParse({
    ringId: formData.get("ringId"),
    existingUserId: optional(formData.get("existingUserId")),
    name: optional(formData.get("name")),
    email: optional(formData.get("email")),
    churchFunction: formData.get("churchFunction"),
    role: formData.get("role"),
    isRingManager: formData.get("isRingManager") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }

  try {
    const { user, joinedRounds } = await addMember({ actorId: actor.id, ...parsed.data });
    revalidatePath("/gebruikers");
    revalidatePath(`/ringen/${parsed.data.ringId}`);
    const extra = joinedRounds > 0 ? ` Deze persoon is toegevoegd aan ${joinedRounds} lopende ondersteuningsronde(s).` : "";
    return { ok: true, message: `${user.name} is toegevoegd aan de ring.${extra}` };
  } catch (err) {
    return failure(err);
  }
}

export async function updateMemberAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireUser();

  const parsed = updateMemberSchema.safeParse({
    membershipId: formData.get("membershipId"),
    name: optional(formData.get("name")),
    email: optional(formData.get("email")),
    churchFunction: formData.get("churchFunction"),
    role: formData.get("role"),
    isRingManager: formData.get("isRingManager") === "on",
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }

  try {
    const { joinedRounds } = await updateMember({ actorId: actor.id, ...parsed.data });
    revalidatePath("/gebruikers");
    revalidatePath("/ringen", "layout");
    const extra = joinedRounds > 0 ? ` Toegevoegd aan ${joinedRounds} lopende ondersteuningsronde(s).` : "";
    return { ok: true, message: `Opgeslagen.${extra}` };
  } catch (err) {
    return failure(err);
  }
}
