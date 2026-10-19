import { prisma } from "./prisma";
import type { SecurityEventType } from "@prisma/client";

/**
 * Beveiligingslogboek voor MFA-gerelateerde gebeurtenissen. `detail` mag
 * uitsluitend korte, niet-vertrouwelijke tekst bevatten (bv. een
 * apparaatlabel) — nooit OTP-codes, secrets of herstelcodes.
 */
export async function logSecurityEvent(input: {
  userId: string;
  type: SecurityEventType;
  actorUserId?: string;
  detail?: string;
}): Promise<void> {
  await prisma.securityEvent.create({
    data: {
      userId: input.userId,
      type: input.type,
      actorUserId: input.actorUserId,
      detail: input.detail,
    },
  });
}
