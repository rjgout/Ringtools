import { useEffect, useState } from "react";
import type { ApiClient } from "./api";

let cached: boolean | null = null;

/** Of de declaratiemodule op de server aan staat (GET /meta). Zonder antwoord of zonder vlag: nee, nooit een gok. */
export function useDeclarationsEnabled(api: Pick<ApiClient, "meta">, active: boolean): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(cached);
  useEffect(() => {
    if (!active || cached !== null || typeof api.meta !== "function") return;
    let cancelled = false;
    api.meta().then((m) => { cached = m?.declarations === true; if (!cancelled) setEnabled(cached); }).catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, [api, active]);
  return active ? enabled : null;
}
