import { useCallback, useEffect, useRef, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { AuthProvider, useAuth } from "./lib/auth";
import { API_HOST } from "./config";
import { isNative, onBackButton, onNetworkChange, setupNativeChrome } from "./lib/native";
import { parseTarget, routeFor } from "./lib/links";
import { Spinner, TabBar } from "./components/ui";
import { Login } from "./screens/Login";
import { Home } from "./screens/Home";
import { Callings } from "./screens/Callings";
import { CallingDetail } from "./screens/CallingDetail";
import { Notifications } from "./screens/Notifications";
import { Profile } from "./screens/Profile";
import { OpenLink } from "./screens/OpenLink";

/** Universele links/app-links en pushmeldingen: cold start, draaiende app en hervatten vanuit de achtergrond. */
function DeepLinks({ onTarget }: { onTarget: (route: string) => void }) {
  useEffect(() => {
    if (!isNative) return;
    const handle = (url?: string | null) => {
      const target = parseTarget(url, API_HOST);
      if (target) onTarget(routeFor(target));
    };
    void CapApp.getLaunchUrl().then((r) => handle(r?.url));
    const open = CapApp.addListener("appUrlOpen", (e) => handle(e.url));
    const tap = PushNotifications.addListener("pushNotificationActionPerformed", (a) => handle(String(a.notification.data?.url ?? "")));
    return () => {
      void open.then((h) => h.remove());
      void tap.then((h) => h.remove());
    };
  }, [onTarget]);
  return null;
}

function Shell() {
  const { status, api, ring, me } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [online, setOnline] = useState(true);
  const [unread, setUnread] = useState(0);
  const pendingRoute = useRef<string | null>(null);

  useEffect(() => void setupNativeChrome(), []);
  useEffect(() => void onNetworkChange(setOnline).then((off) => off), []);
  useEffect(() => onBackButton(() => (location.pathname !== "/" ? (navigate(-1), true) : false)), [location.pathname, navigate]);

  const goTo = useCallback(
    (route: string) => {
      // Zonder sessie: onthoud de bestemming en ga na het inloggen verder (het token blijft alleen in het geheugen).
      if (status !== "signedIn") pendingRoute.current = route;
      else navigate(route);
    },
    [navigate, status]
  );

  useEffect(() => {
    if (status === "signedIn" && pendingRoute.current) {
      navigate(pendingRoute.current);
      pendingRoute.current = null;
    }
  }, [status, navigate]);

  const refreshUnread = useCallback(() => {
    if (status !== "signedIn" || !ring) return;
    api.notifications(ring.id).then((n) => setUnread(n.unreadCount)).catch(() => {});
  }, [api, ring, status]);
  useEffect(refreshUnread, [refreshUnread, location.pathname]);

  if (status === "loading") return <main className="page center"><Spinner /></main>;
  if (status === "signedOut") return (<><DeepLinks onTarget={goTo} /><Login /></>);

  return (
    <div className="shell">
      <DeepLinks onTarget={goTo} />
      {!online && <div className="banner" role="status">Geen internetverbinding. Gegevens kunnen verouderd zijn.</div>}
      <main className="page">
        {!ring ? (
          <div className="glass card"><strong>Geen ring</strong><p className="muted">Je account is nog niet aan een ring gekoppeld.</p></div>
        ) : (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/voorstellen" element={<Callings />} />
            <Route path="/roepingen/:id" element={<CallingDetail />} />
            <Route path="/open/:token" element={<OpenLink />} />
            <Route path="/meldingen" element={<Notifications onChanged={refreshUnread} />} />
            <Route path="/profiel" element={<Profile />} />
            <Route path="*" element={<Home />} />
          </Routes>
        )}
      </main>
      <TabBar unread={unread} pending={me?.pendingCount ?? 0} />
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </HashRouter>
  );
}
