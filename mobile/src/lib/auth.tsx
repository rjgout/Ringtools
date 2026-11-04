import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import type { LoginResult, Me, RingInfo } from "@shared/api-types";
import { ApiClient, ApiRequestError } from "./api";
import { storage } from "./storage";
import { API_BASE } from "../config";
import { isNative, platform } from "./native";
import { registerForPush } from "./push";
import { resumeSession } from "./resume";
import type { PasskeyAssertion } from "./passkeys";

type Status = "loading" | "signedOut" | "signedIn" | "unavailable";

type AuthValue = {
  status: Status;
  /** Alleen bij status "unavailable": waarom de sessie niet hervat kon worden. */
  startupError: ApiRequestError | null;
  retryStartup: () => void;
  me: Me | null;
  ring: RingInfo | null;
  api: ApiClient;
  /** Webmin is ingelogd (beheergedeelte); er is dan geen ring of voorstel. */
  isAdmin: boolean;
  /** Geeft `{ pendingToken }` terug als er nog een passkey-verificatie nodig is (verplichte MFA); dan bestaat er nog géén sessie. */
  signIn: (email: string, code: string) => Promise<{ pendingToken: string } | void>;
  /** Rondt een pending-login af na een geslaagde passkey-ceremonie; pas hierna bestaat er een sessie. */
  finishMfa: (pendingToken: string, assertion: PasskeyAssertion) => Promise<void>;
  /** Webmin stap 1 (wachtwoord): geeft een wachtend token dat alleen voor stap 2 geldt. */
  adminStart: (username: string, password: string) => Promise<string>;
  /** Webmin stap 2 (TOTP of herstelcode): pas hierna bestaat er een sessie. */
  adminFinish: (pendingToken: string, proof: { code?: string; recoveryCode?: string }) => Promise<void>;
  /** Herverificatie voor gevoelige beheeracties; vervangt het sessietoken. */
  reauth: (code: string) => Promise<void>;
  /** Gewone gebruiker: vraagt een verse e-mailcode aan voor herverificatie. */
  requestReauthCode: () => Promise<void>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<void>;
  selectRing: (id: string) => Promise<void>;
  enablePush: () => Promise<{ ok: boolean; message: string }>;
};

const adminMe = (u: { id: string; name: string; email: string }): Me => ({
  user: { ...u, emailNotificationsEnabled: false, mfaEnabled: true },
  rings: [],
  pendingCount: 0,
});

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth buiten AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [startupError, setStartupError] = useState<ApiRequestError | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [me, setMe] = useState<Me | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ringId, setRingId] = useState<string | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const api_ref = useRef<ApiClient>(null as unknown as ApiClient);
  const clearSession = useCallback(async () => {
    // Onthoud het pushtoken tot de server het heeft afgemeld (ook bij 401 of zonder verbinding).
    const pushToken = await storage.getPushToken();
    if (pushToken) await storage.setPendingUnregister(pushToken);
    tokenRef.current = null;
    api_ref.current.admin = false;
    setIsAdmin(false);
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

  api_ref.current = api;
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

  // Opstarten: bestaande sessie hervatten. Eindigt altijd in signedOut, signedIn of unavailable (met opnieuw proberen).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      const adminMode = (await storage.getMode().catch(() => null)) === "admin";
      api.admin = adminMode;
      const result = await resumeSession({
        getToken: () => storage.getToken(),
        useToken: (t) => void (tokenRef.current = t),
        me: async () => (adminMode ? adminMe((await api.adminMe()).user) : api.me()),
      });
      if (cancelled) return;
      if (result.kind === "signedIn") {
        try {
          if (adminMode) setMe(result.me);
          else await applyMe(result.me);
          setIsAdmin(adminMode);
        } catch {
          /* ringkeuze niet te bewaren: doorgaan met de eerste ring */
        }
        if (cancelled) return;
        setStartupError(null);
        setStatus("signedIn");
      } else if (result.kind === "unavailable") {
        setStartupError(result.error);
        setStatus("unavailable");
      } else {
        tokenRef.current = null;
        api.admin = false;
        setStatus("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, applyMe, startupAttempt]);

  const retryStartup = useCallback(() => setStartupAttempt((n) => n + 1), []);

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
        if (api.admin) setMe(adminMe((await api.adminMe()).user));
        else await applyMe(await api.me());
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
      // Verplichte MFA: nog geen sessie; de aanroeper doorloopt de passkey-stap en rondt af met finishMfa().
      if ("mfaRequired" in result && result.mfaRequired) return { pendingToken: result.pendingToken };
      const full = result as LoginResult;
      tokenRef.current = full.token;
      await storage.setToken(full.token);
      await applyMe({ user: full.user, rings: full.rings, pendingCount: full.pendingCount });
      setStatus("signedIn");
    },
    [api, applyMe]
  );

  const finishMfa = useCallback(
    async (pendingToken: string, assertion: PasskeyAssertion) => {
      const result = await api.passkeyVerify(pendingToken, assertion);
      tokenRef.current = result.token;
      await storage.setToken(result.token);
      await applyMe({ user: result.user, rings: result.rings, pendingCount: result.pendingCount });
      setStatus("signedIn");
    },
    [api, applyMe]
  );

  const adminStart = useCallback(async (username: string, password: string) => (await api.adminLogin(username, password)).pendingToken, [api]);

  const adminFinish = useCallback(
    async (pendingToken: string, proof: { code?: string; recoveryCode?: string }) => {
      const result = await api.adminVerify(pendingToken, proof);
      api.admin = true;
      tokenRef.current = result.token;
      await storage.setToken(result.token);
      await storage.setMode("admin");
      const who = await api.adminMe();
      setMe(adminMe(who.user));
      setRingId(null);
      setIsAdmin(true);
      setStatus("signedIn");
    },
    [api]
  );

  const reauth = useCallback(
    async (code: string) => {
      const result = api.admin ? await api.adminReauth(code) : await api.userReauth(code);
      tokenRef.current = result.token;
      await storage.setToken(result.token);
    },
    [api]
  );

  const requestReauthCode = useCallback(async () => {
    if (me) await api.requestCode(me.user.email);
  }, [api, me]);

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
    () => ({ status, startupError, retryStartup, me, ring, api, isAdmin, signIn, finishMfa, adminStart, adminFinish, reauth, requestReauthCode, signOut, reloadMe, selectRing, enablePush }),
    [status, startupError, retryStartup, me, ring, api, isAdmin, signIn, finishMfa, adminStart, adminFinish, reauth, requestReauthCode, signOut, reloadMe, selectRing, enablePush]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
