import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Me } from "@shared/api-types";
import { ApiClient, ApiRequestError } from "../lib/api";
import { AuthContext, type AuthValue } from "../lib/auth";
import { API_BASE } from "../config";
import { currentAppTarget, toLogin, toReverify } from "./webPaths";

/**
 * Aanmeldlaag van de webomgeving (web/PWA). Zelfde `useAuth()`-contract als de app, maar zonder token:
 * - de sessie is de HttpOnly-cookie van de website; JavaScript ziet of bewaart nooit een sessietoken;
 * - "ingelogd" betekent dat `GET /me` slaagt; bij 401 (verlopen, ingetrokken, gedeactiveerd) gaat de browser naar de bestaande inlogpagina;
 * - aanmelden, MFA en herverificatie met een tweede factor lopen via de bestaande website; er is geen appvergrendeling, biometrie of toestelsleutel.
 * Alleen de gekozen ring (een niet-vertrouwelijke voorkeur) wordt in de browser onthouden.
 */
const RING_KEY = "ringtools.web.ring";
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const readRing = () => {
  try { return window.localStorage.getItem(RING_KEY); } catch { return null; }
};
const writeRing = (id: string) => {
  try { window.localStorage.setItem(RING_KEY, id); } catch { /* opslag niet beschikbaar: de eerste ring geldt */ }
};
const clearRing = () => {
  try { window.localStorage.removeItem(RING_KEY); } catch { /* opslag niet beschikbaar */ }
};
const AUTH_CHANNEL = "ringtools-auth";
/** Laat andere tabbladen van deze browser weten dat er is uitgelogd (zij gaan dan direct naar de inlogpagina). */
const announceLogout = () => {
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.postMessage("logout");
    channel.close();
  } catch { /* BroadcastChannel niet beschikbaar: andere tabbladen merken het bij hun volgende verzoek (401) */ }
};
type BadgeNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
const clearBadge = async () => {
  try { await (navigator as BadgeNavigator).clearAppBadge?.(); } catch { /* niet ondersteund */ }
};
const setBadge = async (count: number) => {
  const nav = navigator as BadgeNavigator;
  try { await (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.()); } catch { /* niet ondersteund */ }
};
/** Meldt de pushmelding-registratie van deze browser af (server én browser). Alleen de eigen registratie. */
async function unsubscribeThisBrowser(api: ApiClient): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.webPushUnsubscribe(subscription.endpoint).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}
const notOnWeb = async (): Promise<never> => {
  throw new ApiRequestError(0, "Dit is niet beschikbaar in de webomgeving.", "web-not-allowed");
};

export function WebAuthProvider({ children, redirect = (url: string) => window.location.assign(url) }: { children: React.ReactNode; redirect?: (url: string) => void }) {
  const [status, setStatus] = useState<AuthValue["status"]>("loading");
  const [startupError, setStartupError] = useState<ApiRequestError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [me, setMe] = useState<Me | null>(null);
  const [ringId, setRingId] = useState<string | null>(null);
  const leaving = useRef(false);
  const redirectRef = useRef(redirect);
  redirectRef.current = redirect;

  const goLogin = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setMe(null);
    setStatus("loading"); // geen inhoud meer tonen terwijl de browser naar de inlogpagina gaat
    redirectRef.current(toLogin(currentAppTarget()));
  }, []);

  const api = useMemo(() => new ApiClient({ baseUrl: API_BASE, getToken: () => null, webCookie: true, onUnauthorized: goLogin }), [goLogin]);

  const applyMe = useCallback((next: Me) => {
    setMe(next);
    const saved = readRing();
    const chosen = next.rings.find((r) => r.id === saved) ?? next.rings[0] ?? null;
    setRingId(chosen?.id ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    api.me().then(
      (next) => {
        if (cancelled) return;
        applyMe(next);
        setStartupError(null);
        setStatus("signedIn");
      },
      (err) => {
        if (cancelled || leaving.current) return;
        if (err instanceof ApiRequestError && err.status === 401) return; // onUnauthorized stuurt al door
        if (err instanceof ApiRequestError && err.status === 403) return goLogin(); // o.a. het beheerdersaccount: hoort op de website
        setStartupError(err instanceof ApiRequestError ? err : new ApiRequestError(0, "Ringtools is nu niet bereikbaar.", "network"));
        setStatus("unavailable");
      }
    );
    return () => { cancelled = true; };
  }, [api, applyMe, attempt, goLogin]);

  // Sessie verlengen (en zo nodig het token roteren: de server zet dan zelf een nieuwe HttpOnly-cookie) bij openen en terugkeren.
  useEffect(() => {
    if (status !== "signedIn") return;
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < REFRESH_INTERVAL_MS) return;
      last = Date.now();
      void api.refresh().catch(() => {});
      void api.me().then(applyMe).catch(() => {});
    };
    void api.refresh().catch(() => {});
    document.addEventListener("visibilitychange", tick);
    const timer = window.setInterval(tick, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", tick);
      window.clearInterval(timer);
    };
  }, [api, status, applyMe]);

  // App-badge op het pictogram (geïnstalleerde webapp): het aantal openstaande acties, net als de bel-teller in de app.
  useEffect(() => {
    if (status === "signedIn" && me) void setBadge(me.pendingCount);
  }, [status, me]);

  // Uitgelogd in een ander tabblad: hier ook direct naar de inlogpagina.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL);
      channel.onmessage = (e) => { if (e.data === "logout") goLogin(); };
    } catch { /* niet beschikbaar */ }
    return () => channel?.close();
  }, [goLogin]);

  const reloadMe = useCallback(async () => applyMe(await api.me()), [api, applyMe]);
  const selectRing = useCallback(async (id: string) => {
    if (!me?.rings.some((r) => r.id === id)) return;
    writeRing(id);
    setRingId(id);
  }, [me]);
  /**
   * Veilig uitloggen: de sessie wordt eerst op de server ingetrokken; pas daarna gaat de browser naar de inlogpagina. Lukt het intrekken niet
   * (geen verbinding, serverfout), dan blijft de gebruiker hier en krijgt hij een duidelijke melding: er wordt nooit "uitgelogd" getoond terwijl
   * de sessie nog geldt. Een sessie die al ongeldig is (401) telt als uitgelogd. Daarnaast: pushmeldingen van dit apparaat worden afgemeld
   * (op een gedeeld apparaat mogen meldingen niet bij de vorige gebruiker blijven aankomen), de onthouden ringkeuze wordt gewist, het
   * app-badge verdwijnt en andere geopende tabbladen gaan direct naar de inlogpagina.
   */
  const signOut = useCallback(async () => {
    try { await unsubscribeThisBrowser(api); } catch { /* best effort: de serversessie wordt hieronder in elk geval ingetrokken */ }
    try {
      await api.logout();
    } catch (err) {
      if (!(err instanceof ApiRequestError && err.status === 401)) {
        throw new ApiRequestError(err instanceof ApiRequestError ? err.status : 0, "Uitloggen is niet gelukt. Je bent nog ingelogd. Controleer je verbinding en probeer het opnieuw.", "logout-failed");
      }
    }
    leaving.current = true;
    clearRing();
    void clearBadge();
    announceLogout();
    setMe(null);
    setStatus("loading");
    redirectRef.current("/login");
  }, [api]);
  const reauth = useCallback(async (code: string) => { await api.userReauth(code); }, [api]); // de server zet de vervangen sessie als cookie
  const requestReauthCode = useCallback(async () => { await api.requestReauthCode(); }, [api]);
  // Accounts met een tweede factor bevestigen op de bestaande beveiligingspagina (passkey, authenticator-app); daarna terug naar dit scherm.
  const reauthWithPasskey = useCallback(async () => {
    redirectRef.current(toReverify(currentAppTarget()));
    await new Promise<void>(() => {});
  }, []);
  const enablePush = useCallback(async () => ({ ok: false, message: "Gebruik de knop bij Pushmeldingen in je profiel." }), []);
  const retryStartup = useCallback(() => setAttempt((n) => n + 1), []);

  const ring = me?.rings.find((r) => r.id === ringId) ?? null;
  const value = useMemo<AuthValue>(
    () => ({
      status, startupError, retryStartup, me, ring, api,
      signIn: notOnWeb, signInReview: notOnWeb, finishMfa: notOnWeb, finishMfaTotp: notOnWeb, signInWithDevice: notOnWeb, finishActivation: notOnWeb,
      reauth, reauthWithPasskey, requestReauthCode, signOut, reloadMe, selectRing, enablePush,
    }),
    [status, startupError, retryStartup, me, ring, api, reauth, reauthWithPasskey, requestReauthCode, signOut, reloadMe, selectRing, enablePush]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
