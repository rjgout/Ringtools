"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { activateRingAction } from "@/lib/actions/ring.actions";

/**
 * Wanneer een voorstel uit een andere ring dan de actieve ring wordt geopend (e-mail of
 * melding), schakelt dit naar die ring zodat de rest van de app erbij past.
 */
export function RingSync({ ringId, activeRingId }: { ringId: string; activeRingId: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (ringId === activeRingId) return;
    activateRingAction(ringId).then((ok) => {
      if (ok) router.refresh();
    });
  }, [ringId, activeRingId, router]);
  return null;
}
