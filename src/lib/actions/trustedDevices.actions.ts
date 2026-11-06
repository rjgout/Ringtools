"use server";

import { revalidatePath } from "next/cache";
import { requireRecentMfa } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { createPairing, revokeTrustedDevice, TrustedDeviceError } from "@/lib/trustedDevices";

export type PairingResult = { ok: boolean; message: string; code?: string; expiresAt?: string };
export type RevokeResult = { ok: boolean; message: string };

/** Maakt een eenmalige koppelcode (zonder QR; de code wordt in de app handmatig ingevoerd). Vereist recente MFA. */
export async function createPairingCodeAction(): Promise<PairingResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  if (!rateLimit(`pairing-create:${session.user.id}`, 10, 60 * 60 * 1000).allowed) return { ok: false, message: "Je hebt veel koppelcodes aangevraagd. Probeer het later opnieuw." };
  try {
    const { code, expiresAt } = await createPairing(session.user.id);
    revalidatePath("/profiel/beveiliging");
    return { ok: true, message: "Voer deze code binnen 10 minuten in de Ringtools-app in.", code, expiresAt: expiresAt.toISOString() };
  } catch (err) {
    if (err instanceof TrustedDeviceError) return { ok: false, message: err.message };
    throw err;
  }
}

/** Trekt een toestel in; vereist recente MFA. Alleen eigen toestellen. */
export async function revokeTrustedDeviceAction(_prev: RevokeResult | null, formData: FormData): Promise<RevokeResult> {
  const session = await requireRecentMfa("/profiel/beveiliging/herverifieer");
  const id = String(formData.get("deviceId") ?? "");
  const done = id ? await revokeTrustedDevice(session.user.id, id, session.user.id) : false;
  revalidatePath("/profiel/beveiliging");
  return done ? { ok: true, message: "Toestel ingetrokken." } : { ok: false, message: "Dit toestel is niet gevonden of al ingetrokken." };
}
