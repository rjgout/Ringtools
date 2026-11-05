import { Ontheffingen } from "./screens/Ontheffingen";
import { OntheffingForm } from "./screens/OntheffingForm";
import { OntheffingDetail } from "./screens/OntheffingDetail";
import { useCallback, useEffect, useRef, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { AuthProvider, useAuth } from "./lib/auth";
import { API_HOST } from "./config";
import { isNative, onBackButton, onNetworkChange, setupNativeChrome } from "./lib/native";
import { installDeepLinkHandlers } from "./lib/deeplinks";
import { nativeCapabilities } from "./lib/buildProfile";
import { ErrorState, Spinner, TabBar } from "./components/ui";
import { Login } from "./screens/Login";
import { Home } from "./screens/Home";
import { Callings } from "./screens/Callings";
import { NewCalling } from "./screens/NewCalling";
import { CallingDetail } from "./screens/CallingDetail";
import { Notifications } from "./screens/Notifications";
import { Profile } from "./screens/Profile";
import { AdminHome } from "./screens/admin/AdminHome";
import { UserManager } from "./screens/UserManager";
import { RingSetup } from "./screens/RingSetup";
import { OpenLink } from "./screens/OpenLink";
import { Activate } from "./screens/Activate";

/**
 * Universele links/app-links en pushmeldingen: koude start, draaiende app en hervatten vanuit de achtergrond.
 * De listeners worden één keer geregistreerd (stabiele callback via een ref) en blijven bestaan, ook tijdens het
 * laden en na pushregistratie; er worden nooit listeners van andere onderdelen verwijderd.
 */
function DeepLinks({ onTarget }: { onTarget: (route: string) => void }) {
  const ref = useRef(onTarget);
  ref.current = onTarget;
  useEffect(() => {
    if (!isNative) return;
    return installDeepLinkHandlers(
      {
        getLaunchUrl: () => CapApp.getLaunchUrl(),
        onUrlOpen: (cb) => CapApp.addListener("appUrlOpen", cb),
        // In de Personal Team-testbuild is native push niet beschikbaar: geen plugin-listener registreren.
        onPushTap: (cb) =>
          nativeCapabilities().nativePush
            ? PushNotifications.addListener("pushNotificationActionPerformed", cb as never)
            : Promise.resolve({ remove: async () => {} }),
      },
      API_HOST,
      (route) => ref.current(route)
    );
  }, []);
  return null;
}

function Shell() {
  const { status, api, ring, me, startupError, retryStartup, signOut, isAdmin, reloadMe } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [online, setOnline] = useState(true);
  const [unread, setUnread] = useState(0);
  const pendingRoute = useRef<string | null>(null);
  // Uitnodiging activeren werkt zonder sessie: een token uit een link, of handmatige invoer (token ontbreekt).
  const [activation, setActivation] = useState<{ token?: string } | null>(null);
  const [loginEmail, setLoginEmail] = useState("");

  useEffect(() => void setupNativeChrome(), []);
  useEffect(() => void onNetworkChange(setOnline).then((off) => off), []);
  useEffect(() => onBackButton(() => (location.pathname !== "/" ? (navigate(-1), true) : false)), [location.pathname, navigate]);

  const goTo = useCallback(
    (route: string) => {
      const invite = /^\/uitnodiging\/([^/]+)$/.exec(route);
      if (invite) {
        setActivation({ token: invite[1] });
        return;
      }
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

  // DeepLinks staat in elke toestand gemonteerd, zodat een koude start via link of pushmelding niet verloren gaat.
  if (status === "loading") return (<><DeepLinks onTarget={goTo} /><main className="page center"><Spinner /></main></>);
  if (activation && status !== "unavailable") {
    return (
      <>
        <DeepLinks onTarget={goTo} />
        <Activate
          token={activation.token}
          onCancel={() => setActivation(null)}
          onFinished={(email, signedIn) => {
            setActivation(null);
            if (signedIn) navigate("/", { replace: true }); // direct ingelogd door de activatie: naar het overzicht
            else if (status === "signedOut") setLoginEmail(email);
            else void reloadMe(); // al ingelogd (bijvoorbeeld een extra ring): ringlijst verversen
          }}
        />
      </>
    );
  }
  if (status === "unavailable" && startupError) {
    return (
      <>
        <DeepLinks onTarget={goTo} />
        <main className="page center">
          <div className="glass card stack" style={{ width: "100%", maxWidth: 420 }}>
            <ErrorState error={startupError} onRetry={retryStartup} />
            <button className="btn btn-ghost" onClick={() => void signOut()}>Uitloggen op dit toestel</button>
          </div>
        </main>
      </>
    );
  }
  if (status === "signedOut") return (<><DeepLinks onTarget={goTo} /><Login key={loginEmail} initialEmail={loginEmail} onHaveInvitation={() => setActivation({})} /></>);

  // Webmin: uitsluitend het beheergedeelte (geen ringen, voorstellen of meldingen).
  if (isAdmin) return (<div className="shell"><DeepLinks onTarget={goTo} /><AdminHome /></div>);

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
            <Route path="/voorstellen/nieuw" element={<NewCalling />} />
            <Route path="/voorstellen/concept/:id" element={<NewCalling />} />
            <Route path="/roepingen/:id" element={<CallingDetail />} />
            <Route path="/ontheffingen" element={<Ontheffingen />} />
            <Route path="/ontheffingen/nieuw" element={<OntheffingForm />} />
            <Route path="/ontheffingen/concept/:id" element={<OntheffingForm />} />
            <Route path="/ontheffingen/:id" element={<OntheffingDetail />} />
            <Route path="/open/:token" element={<OpenLink />} />
            {ring.isRingManager && <Route path="/inrichting" element={<div className="stack"><h1>{ring.name}</h1><RingSetup ringId={ring.id} /></div>} />}
            {ring.isRingManager && <Route path="/gebruikers" element={<div className="stack"><h1>{ring.name}</h1><UserManager ringId={ring.id} /></div>} />}
            <Route path="/meldingen" element={<Notifications onChanged={refreshUnread} />} />
            <Route path="/profiel" element={<Profile />} />
            <Route path="*" element={<Home />} />
          </Routes>
        )}
      </main>
      <TabBar unread={unread} pending={me?.pendingCount ?? 0} canManageUsers={!!ring?.isRingManager} />
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
