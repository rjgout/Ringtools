import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { ApiClient, ApiRequestError } from "./api";
import { storage } from "./storage";
import { registerForPush, setBadge } from "./push";
import type { Me } from "./types";

export const API_URL = ((Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "").replace(/\/+$/, "");

type Status = "loading" | "signedOut" | "signedIn";

type AuthValue = {
  status: Status;
  me: Me | null;
  ringId: string | null;
  api: ApiClient;
  signIn: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<void>;
  selectRing: (id: string) => Promise<void>;
  enablePush: () => ReturnType<typeof registerForPush>;
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

  const clearSession = useCallback(async () => {
    tokenRef.current = null;
    setMe(null);
    setRingId(null);
    setStatus("signedOut");
    await storage.clear();
    await setBadge(0);
  }, []);

  const api = useMemo(
    () => new ApiClient({ baseUrl: API_URL, getToken: () => tokenRef.current, onUnauthorized: () => void clearSession() }),
    [clearSession]
  );

  const applyMe = useCallback(async (next: Me) => {
    setMe(next);
    const saved = await storage.getRing();
    const chosen = next.rings.find((r) => r.id === saved) ?? next.rings[0] ?? null;
    setRingId(chosen?.id ?? null);
    if (chosen) await storage.setRing(chosen.id);
    await setBadge(next.pendingCount);
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
        // Geen verbinding: sessie bewaren en offline-vriendelijk blijven falen; ongeldig: uitloggen (gebeurt via onUnauthorized).
        if (err instanceof ApiRequestError && err.status === 0) setStatus("signedOut");
      }
    })();
  }, [api, applyMe]);

  // Bij terugkeren naar de app: sessie verlengen en zo nodig het token vernieuwen.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active" || !tokenRef.current) return;
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
    });
    return () => sub.remove();
  }, [api, applyMe]);

  const signIn = useCallback(
    async (email: string, code: string) => {
      const result = await api.login(email, code, Device.deviceName ?? Platform.OS);
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
      /* server niet bereikbaar: lokaal toch uitloggen */
    }
    await clearSession();
  }, [api, clearSession]);

  const reloadMe = useCallback(async () => {
    await applyMe(await api.me());
  }, [api, applyMe]);

  const selectRing = useCallback(async (id: string) => {
    setRingId(id);
    await storage.setRing(id);
  }, []);

  const enablePush = useCallback(() => registerForPush(api), [api]);

  const value = useMemo<AuthValue>(
    () => ({ status, me, ringId, api, signIn, signOut, reloadMe, selectRing, enablePush }),
    [status, me, ringId, api, signIn, signOut, reloadMe, selectRing, enablePush]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
