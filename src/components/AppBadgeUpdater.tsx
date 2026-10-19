"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type NavigatorWithBadge = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function AppBadgeUpdater() {
  const pathname = usePathname();

  useEffect(() => {
    const nav = navigator as NavigatorWithBadge;
    if (!nav.setAppBadge || !nav.clearAppBadge) return; // Badging API niet ondersteund: stil negeren.

    let cancelled = false;
    fetch("/api/badge-count")
      .then((res) => (res.ok ? res.json() : { count: 0 }))
      .then(({ count }: { count: number }) => {
        if (cancelled) return;
        if (count > 0) nav.setAppBadge!(count).catch(() => {});
        else nav.clearAppBadge!().catch(() => {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // Opnieuw bijwerken bij iedere paginawisseling binnen de app, zodat het
    // badge-aantal actueel blijft nadat een stem is uitgebracht of een taak
    // is afgerond.
  }, [pathname]);

  return null;
}
