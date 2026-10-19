"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { getRingContext } from "@/lib/ringContext";

/**
 * Markeert één melding als gelezen. Controleert expliciet dat de melding van
 * de ingelogde gebruiker zelf is (updateMany met userId in de where-clause,
 * niet alleen op id) — zo kan een gebruiker nooit de meldingen van iemand
 * anders als gelezen markeren, ook niet door een id te raden.
 */
export async function markNotificationReadAction(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}

/** Markeert alle meldingen van de actieve ring als gelezen (de lijst die de bel toont). */
export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  const ctx = await getRingContext();
  if (!ctx) return;
  await prisma.notification.updateMany({
    where: { userId: user.id, ringId: ctx.ring.id, readAt: null },
    data: { readAt: new Date() },
  });
}
