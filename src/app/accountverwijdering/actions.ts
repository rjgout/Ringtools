"use server";
import { cookies, headers } from "next/headers";
import { sendDeletionCode, confirmDeletionCode, requestAccountDeletion, AccountDeletionError } from "@/lib/accountDeletion";
import { getCurrentUser, requireRecentMfa } from "@/lib/session";
import { env } from "@/lib/env";
import { emailSchema } from "@/lib/validation";
export type DeletionResult = { ok: boolean; message: string };
const receiptCookie = "ringtools.deletion-receipt";
export async function deletionAction(_previous: DeletionResult | null, f: FormData): Promise<DeletionResult> {
  if (f.get("confirm") !== "on") return { ok: false, message: "Bevestig de gevolgen voor het volledige account." };
  const user = await getCurrentUser();
  let result;
  try {
    if (user) {
      await requireRecentMfa("/profiel/beveiliging/herverifieer?next=%2Faccountverwijdering");
      result = await requestAccountDeletion(user.id);
    } else {
      const email = emailSchema.safeParse(f.get("email"));
      if (!email.success) return { ok: false, message: "Vul een geldig e-mailadres in." };
      const key = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
      const code = String(f.get("code") ?? "").replace(/\s+/g, "");
      if (!code) {
        await sendDeletionCode(email.data, key);
        return { ok: true, message: "Als dit adres bij een gewoon account hoort, ontvang je een bevestigingscode. Vul deze hieronder in. Dit geeft geen toegang tot het account." };
      }
      result = await confirmDeletionCode(email.data, code, key);
      if (!result) return { ok: false, message: "Code ongeldig of verlopen. Vraag opnieuw een code aan." };
    }
    (await cookies()).set(receiptCookie, result.receipt, { httpOnly: true, secure: env.cookieSecure, sameSite: "lax", path: "/accountverwijdering", maxAge: 90 * 86400 });
    return { ok: true, message: "Verzoek ontvangen. Je hoeft niet apart te mailen of bellen. Herlaad deze pagina voor de status. Streeftermijn: 14 dagen." };
  } catch (e) {
    if (e instanceof AccountDeletionError) return { ok: false, message: e.message };
    throw e;
  }
}
