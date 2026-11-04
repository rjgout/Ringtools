import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import type { Me, RingInfo } from "@shared/api-types";
import { ApiClient, ApiRequestError } from "./api";
import { storage } from "./storage";
import { API_BASE } from "../config";
import { isNative, platform } from "./native";
import { registerForPush } from "./push";

type Status = "loading" | "signedOut" | "signedIn";

type AuthValue = {
  status: Status;
  me: Me | null;
  ring: RingInfo | null;
  api: ApiClient;
  signIn: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<void>;
  selectRing: (id: string) => Promise<void>;
  enablePush: () => Promise<{ ok: boolean; message: string }>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth buiten AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [ringId, setRingId] = useState<string | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const clearSession = useCallback(async () => {
    // Onthoud het pushtoken tot de server het heeft afgemeld (ook bij 401 of zonder verbinding).
    const pushToken = await storage.getPushToken();
    if (pushToken) await storage.setPendingUnregister(pushToken);
    tokenRef.current = null;
    setMe(null);
    setRingId(null);
    setStatus("signedOut");
    await storage.clearSession();
    void flushRef.current();
  }, []);

  const api = useMemo(
    () => new ApiClient({ baseUrl: API_BASE, getToken: () => tokenRef.current, onUnauthorized: () => void clearSession() }),
    [clearSession]
  );

  useEffect(() => {
    flushRef.current = async () => {
      const pending = await storage.getPendingUnregister();
      if (!pending) return;
      try {
        await api.unregisterDeviceToken(pending);
        await storage.clearPendingUnregister();
      } catch {
        /* geen verbinding: bij de volgende start of terugkeer opnieuw proberen */
      }
    };
    void flushRef.current();
  }, [api]);

  const applyMe = useCallback(async (next: Me) => {
    setMe(next);
    const saved = await storage.getRing();
    const chosen = next.rings.find((r) => r.id === saved) ?? next.rings[0] ?? null;
    setRingId(chosen?.id ?? null);
    if (chosen) await storage.setRing(chosen.id);
  }, []);

  // Opstarten: bestaande sessie hervatten.
  useEffect(() => {
    (async () => {
      const token = await storage.getToken();
      if (!token) return setStatus("signedOut");
      tokenRef.current = token;
      try {
        await applyMe(await api.me());
        setStatus("signedIn");
      } catch (err) {
        // 401 wordt door onUnauthorized afgehandeld. Zonder verbinding de sessie bewaren en de app tonen.
        if (err instanceof ApiRequestError && err.isNetwork) {
          setStatus("signedIn");
        }
      }
    })();
  }, [api, applyMe]);

  // Terug naar de voorgrond: sessie verlengen en zo nodig het token vernieuwen.
  useEffect(() => {
    const onActive = async () => {
      void flushRef.current();
      if (!tokenRef.current) return;
      try {
        const result = await api.refresh();
        if (result.rotated && result.token) {
          tokenRef.current = result.token;
          await storage.setToken(result.token);
        }
        await applyMe(await api.me());
      } catch {
        /* 401 wordt door onUnauthorized afgehandeld; netwerkfouten negeren */
      }
    };
    if (isNative) {
      const sub = CapApp.addListener("appStateChange", (s) => s.isActive && void onActive());
      return () => void sub.then((h) => h.remove());
    }
    const handler = () => document.visibilityState === "visible" && void onActive();
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [api, applyMe]);

  const signIn = useCallback(
    async (email: string, code: string) => {
      const result = await api.login(email, code, platform === "web" ? "Browser" : platform === "ios" ? "iPhone/iPad" : "Android");
      tokenRef.current = result.token;
      await storage.setToken(result.token);
      await applyMe({ user: result.user, rings: result.rings, pendingCount: result.pendingCount });
      setStatus("signedIn");
    },
    [api, applyMe]
  );

  const signOut = useCallback(async () => {
    const pushToken = (await storage.getPushToken()) ?? undefined;
    try {
      await api.logout(pushToken);
    } catch {
      /* server niet bereikbaar: lokaal toch uitloggen; het pushtoken wordt later afgemeld */
    }
    await clearSession();
  }, [api, clearSession]);

  const reloadMe = useCallback(async () => {
    await applyMe(await api.me());
  }, [api, applyMe]);

  const selectRing = useCallback(async (id: string) => {
    // Alleen een keuze voor de weergave: de server controleert bij elk verzoek opnieuw het lidmaatschap.
    setRingId(id);
    await storage.setRing(id);
  }, []);

  const enablePush = useCallback(() => registerForPush(api), [api]);

  const ring = me?.rings.find((r) => r.id === ringId) ?? null;
  const value = useMemo<AuthValue>(
    () => ({ status, me, ring, api, signIn, signOut, reloadMe, selectRing, enablePush }),
    [status, me, ring, api, signIn, signOut, reloadMe, selectRing, enablePush]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
