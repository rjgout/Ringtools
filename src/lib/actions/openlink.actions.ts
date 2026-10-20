"use server";

import { redirect } from "next/navigation";
import { sendOpenLinkPush, sendOpenLinkLoginMail } from "@/lib/openLinks";

/** Expliciete gebruikershandeling op /open/[token]: stuur een generieke melding naar de app van de ontvanger. */
export async function sendOpenLinkPushAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") || "");
  const result = await sendOpenLinkPush(token);
  redirect(`/open/${encodeURIComponent(token)}?resultaat=${result}`);
}

/** Expliciete gebruikershandeling op /open/[token]: stuur een inloglink naar het e-mailadres van de ontvanger. */
export async function sendOpenLinkLoginMailAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") || "");
  const result = await sendOpenLinkLoginMail(token);
  redirect(`/open/${encodeURIComponent(token)}?resultaat=${result}`);
}
