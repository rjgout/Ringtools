"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { sendTestWebPush, subscribeWebPush, unsubscribeWebPush } from "@/lib/webPush";

export type ActionResult = { ok: boolean; message: string };

export type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function subscribePushAction(input: SubscriptionInput, userAgent?: string): Promise<ActionResult> {
  const user = await requireUser();
  return subscribeWebPush(user.id, input, userAgent);
}

export async function unsubscribePushAction(endpoint: string): Promise<ActionResult> {
  const user = await requireUser();
  return unsubscribeWebPush(user.id, endpoint);
}

export async function sendTestPushAction(): Promise<ActionResult> {
  const user = await requireUser();
  return sendTestWebPush(user.id);
}

export async function removeSubscriptionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  await prisma.pushSubscription.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/profiel");
}

export async function updateEmailPreferenceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const enabled = formData.get("emailNotificationsEnabled") === "on";
  await prisma.user.update({ where: { id: user.id }, data: { emailNotificationsEnabled: enabled } });
  return {
    ok: true,
    message: enabled
      ? "E-mailmeldingen staan aan."
      : "E-mailmeldingen staan uit. Je ontvangt nog wel altijd je inloglink per e-mail.",
  };
}
