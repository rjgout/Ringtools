"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { sendPushToUser, isPushConfigured, PushNotConfiguredError } from "@/lib/push";

export type ActionResult = { ok: boolean; message: string };

export type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function subscribePushAction(input: SubscriptionInput, userAgent?: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!isPushConfigured()) {
    return { ok: false, message: "Pushnotificaties zijn niet geconfigureerd door de beheerder." };
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent, lastSeenAt: new Date() },
    create: {
      userId: user.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent,
    },
  });

  return { ok: true, message: "Pushnotificaties zijn ingeschakeld voor dit apparaat." };
}

export async function unsubscribePushAction(endpoint: string): Promise<ActionResult> {
  const user = await requireUser();
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return { ok: true, message: "Pushnotificaties zijn uitgeschakeld voor dit apparaat." };
}

export async function sendTestPushAction(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const before = await prisma.pushSubscription.count({ where: { userId: user.id } });
    if (before === 0) {
      return { ok: false, message: "Er is nog geen apparaat geregistreerd voor pushnotificaties." };
    }
    await sendPushToUser(user.id, {
      title: "Ringtools",
      body: "Dit is een testnotificatie. Als je dit ziet, werken pushnotificaties op dit apparaat.",
      url: "/profiel",
    });
    return { ok: true, message: "Testnotificatie verstuurd." };
  } catch (err) {
    if (err instanceof PushNotConfiguredError) {
      return { ok: false, message: err.message };
    }
    console.error("[push] Testnotificatie mislukt:", err);
    return { ok: false, message: "Versturen van de testnotificatie is mislukt." };
  }
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
