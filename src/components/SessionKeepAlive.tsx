"use client";

import { useEffect } from "react";

const MIN_INTERVAL_MS = 30 * 60 * 1000;
let lastRun = 0;

/**
 * Houdt de sessie in een (geïnstalleerde) app in leven: bij openen en bij het
 * terugkeren naar de app wordt de sessie server-side verlengd en zo nodig
 * geroteerd. Er worden geen tokens of gegevens in de pagina verwerkt; het
 * (HttpOnly) cookie wordt door de server gezet.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    async function refresh() {
      if (Date.now() - lastRun < MIN_INTERVAL_MS) return;
      lastRun = Date.now();
      try {
        await fetch("/api/session/refresh", { method: "POST", credentials: "same-origin" });
      } catch {
        lastRun = 0; // offline: bij de volgende gelegenheid opnieuw proberen
      }
    }
    // Even wachten: de eerste paginalading (en een eventuele service-worker-installatie) gaat voor.
    const timer = setTimeout(() => void refresh(), 3000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);
  return null;
}
