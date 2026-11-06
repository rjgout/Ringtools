import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "./api";

/**
 * Servercapaciteiten (functievlaggen) uit GET /meta voor het inlogscherm.
 * - `loading`: nog niet bekend (geen verouderde of gokkende tekst tonen).
 * - `ready`: bekend; blijft actueel doordat een mislukte of (door de appvergrendeling) geblokkeerde aanvraag automatisch opnieuw wordt geprobeerd.
 * - `unavailable`: na alle pogingen niet gelukt; de gebruiker kan handmatig opnieuw proberen. Nooit een gok: zonder /meta wordt niets extra's aangeboden.
 * Dit bepaalt alleen wat het scherm toont. De server beslist bij het inloggen zelf welke tweede factor geldt.
 */
export type ServerCapabilities = { nativePasskeys: boolean; nativeTotpLogin: boolean; trustedDevices: boolean; deviceLogin: boolean };
export type CapabilityState = { status: "loading" | "ready" | "unavailable"; caps: ServerCapabilities };

const NONE: ServerCapabilities = { nativePasskeys: false, nativeTotpLogin: false, trustedDevices: false, deviceLogin: false };
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

export function useServerCapabilities(api: Pick<ApiClient, "meta">, delays: number[] = RETRY_DELAYS_MS): CapabilityState & { retry: () => void } {
  const [state, setState] = useState<CapabilityState>({ status: "loading", caps: NONE });
  const [round, setRound] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delaysRef = useRef(delays); // vaste referentie: een nieuwe array per render mag de aanvraag niet opnieuw starten
  delaysRef.current = delays;

  useEffect(() => {
    let active = true;
    const attempt = (n: number) => {
      Promise.resolve()
        .then(() => api.meta())
        .then((meta) => {
          if (!active) return;
          setState({
            status: "ready",
            caps: { nativePasskeys: meta?.nativePasskeys === true, nativeTotpLogin: meta?.nativeTotpLogin === true, trustedDevices: meta?.trustedDevices === true, deviceLogin: meta?.deviceLogin === true },
          });
        })
        .catch(() => {
          if (!active) return;
          if (n < delaysRef.current.length) timer.current = setTimeout(() => attempt(n + 1), delaysRef.current[n]);
          else setState((s) => ({ status: "unavailable", caps: s.caps }));
        });
    };
    setState((s) => (s.status === "ready" || s.status === "loading" ? s : { status: "loading", caps: s.caps }));
    attempt(0);
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [api, round]);

  const retry = useCallback(() => setRound((r) => r + 1), []);
  return { ...state, retry };
}
