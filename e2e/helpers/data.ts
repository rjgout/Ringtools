import type { Role } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";

/**
 * Maakt een gebruiker in een eigen, nieuwe ring (zodat e2e-tests niet door
 * data van andere tests worden beïnvloed). Rechten volgen uit het lidmaatschap.
 */
export async function createE2eUser(
  role: Exclude<Role, "ADMIN">,
  name: string,
  opts: { ringId?: string; isRingManager?: boolean; churchFunction?: string; mfaEnabled?: boolean } = {}
) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const ringId = opts.ringId ?? (await prisma.ring.create({ data: { name: `E2E ring ${stamp}` } })).id;
  const user = await prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${stamp}@test.ringapeldoorn.nl`,
      role,
      active: true,
      mfaEnabled: opts.mfaEnabled ?? false, // passkey-verificatie is optioneel en staat standaard uit
      memberships: {
        create: { ringId, role, churchFunction: opts.churchFunction ?? "", isRingManager: opts.isRingManager ?? false },
      },
    },
  });
  return { user, ringId };
}
