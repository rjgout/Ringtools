"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireUser } from "@/lib/session";
import { setActiveRing } from "@/lib/ringContext";
import { createRingSchema, ringNameSchema } from "@/lib/validation";
import { createRing, renameRing, RingError, AuthorizationError } from "@/lib/rings";

export type ActionResult = { ok: boolean; message: string };

function optional(value: FormDataEntryValue | null): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" ? undefined : v;
}

/** Alleen de systeembeheerder (webmin) kan een nieuwe ring aanmaken, direct met de eerste ringbeheerder. */
export async function createRingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["ADMIN"]);

  const parsed = createRingSchema.safeParse({
    name: formData.get("name"),
    existingUserId: optional(formData.get("existingUserId")),
    userName: optional(formData.get("userName")),
    userEmail: optional(formData.get("userEmail")),
    churchFunction: formData.get("churchFunction"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || "Controleer de ingevulde gegevens." };
  }

  let ringId: string;
  try {
    const { ring } = await createRing({
      actorId: admin.id,
      ringName: parsed.data.name,
      existingUserId: parsed.data.existingUserId,
      name: parsed.data.userName,
      email: parsed.data.userEmail,
      churchFunction: parsed.data.churchFunction,
      role: parsed.data.role,
    });
    ringId = ring.id;
  } catch (err) {
    if (err instanceof RingError) return { ok: false, message: err.message };
    if (err instanceof AuthorizationError) return { ok: false, message: "Je hebt geen bevoegdheid voor deze actie." };
    throw err;
  }
  revalidatePath("/ringen");
  redirect(`/ringen/${ringId}`);
}

export async function renameRingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["ADMIN"]);
  const name = ringNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { ok: false, message: name.error.issues[0]?.message ?? "Ongeldige naam." };
  const ringId = String(formData.get("ringId") || "");

  try {
    await renameRing({ actorId: admin.id, ringId, name: name.data });
  } catch (err) {
    if (err instanceof RingError) return { ok: false, message: err.message };
    if (err instanceof AuthorizationError) return { ok: false, message: "Je hebt geen bevoegdheid voor deze actie." };
    throw err;
  }
  revalidatePath("/ringen", "layout");
  return { ok: true, message: "Naam opgeslagen." };
}

/** Wisselt de actieve ring; alleen mogelijk voor ringen waarvan de gebruiker actief lid is. */
export async function switchRingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ringId = String(formData.get("ringId") || "");
  await setActiveRing(user.id, ringId);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
