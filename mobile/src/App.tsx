import { ReviewManagementDemo } from "./screens/ReviewManagementDemo";
import { OntheffingForm } from "./screens/OntheffingForm";
import { OntheffingDetail } from "./screens/OntheffingDetail";
import { useCallback, useEffect, useRef, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate, Navigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { AuthProvider, useAuth } from "./lib/auth";
import { API_HOST, APP_VARIANT } from "./config";
import { watchKeyboard, isNative, onBackButton, onNetworkChange, setupNativeChrome } from "./lib/native";
import { installDeepLinkHandlers } from "./lib/deeplinks";
import { routeInbox } from "./lib/routeInbox";
import { useRouteInbox } from "./lib/useRouteInbox";
import { AppLockGate, useAppLock } from "./components/AppLock";
import { appLock, nativeLockSources } from "./lib/appLockSources";
import { nativeCapabilities } from "./lib/buildProfile";
import { ErrorState, NavBar, Spinner, TabBar } from "./components/ui";
import { ConfirmProvider } from "./components/Dialog";
import { closeTopOverlay } from "./lib/overlays";
import { backAction, isTabRoot, navTitle, parentPath, titleOf } from "./lib/navigation";
import { Beheer } from "./screens/Beheer";
import { Login } from "./screens/Login";
import { DeviceLink } from "./screens/DeviceLink";
import { Home } from "./screens/Home";
import { Callings } from "./screens/Callings";
import { NewCalling } from "./screens/NewCalling";
import { CallingDetail } from "./screens/CallingDetail";
import { Notifications } from "./screens/Notifications";
import { Profile } from "./screens/Profile";
import { UserManager } from "./screens/UserManager";
import { RingSetup } from "./screens/RingSetup";
import { OpenLink } from "./screens/OpenLink";
import { Activate } from "./screens/Activate";
import { DeviceOffer } from "./components/DeviceOffer";

/**
 * Universele links/app-links en pushmeldingen: koude start, draaiende app en hervatten vanuit de achtergrond.
 * Staat BUITEN de appvergrendeling en blijft in elke toestand bestaan (ook vergrendeld), zodat een tik op een melding of link nooit
 * verloren gaat. De bestemming gaat alleen naar een tijdelijke postbus in het geheugen; pas na ontgrendeling verwerkt de Shell hem.
 * Er worden nooit listeners van andere onderdelen verwijderd.
 */
function DeepLinks() {
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
      (route) => routeInbox.push(route)
    );
  }, []);
  return null;
}

export function Shell() {
  const { status, api, ring, me, startupError, retryStartup, signOut, reloadMe } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [online, setOnline] = useState(true);
  const [unread, setUnread] = useState(0);
  const pendingRoute = useRef<string | null>(null);
  // Uitnodiging activeren werkt zonder sessie: een token uit een link, of handmatige invoer (token ontbreekt).
  const [activation, setActivation] = useState<{ token?: string } | null>(null);
  const [linkingDevice, setLinkingDevice] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");

  useEffect(() => void setupNativeChrome(), []);
  useEffect(() => watchKeyboard(), []); // tabbalk weg zolang het toetsenbord open is
  useEffect(() => void onNetworkChange(setOnline).then((off) => off), []);
  const lock = useAppLock();
  const lockedRef = useRef(false);
  lockedRef.current = lock.phase !== "unlocked";
  // Vergrendeld: de terugknop doet niets in de (verborgen) app; de vergrendeling zelf stuurt de app naar de achtergrond.
  /** Eén terugactie voor de navigatiebalk én de Android-terugknop: een stap terug in de app, of naar het bovenliggende scherm als er geen eerdere stap is. */
  const hasHistory = location.key !== "default";
  const goBack = useCallback((): boolean => {
    // Een open menu, dialoog of sheet sluit eerst; pas daarna navigeert de terugactie.
    if (closeTopOverlay()) return true;
    const action = backAction(location.pathname, hasHistory);
    if (!action) return false;
    if (action.kind === "history") navigate(-1);
    else navigate(action.to, { replace: true });
    return true;
  }, [location.pathname, hasHistory, navigate]);
  useEffect(() => onBackButton(() => (lockedRef.current ? true : goBack())), [goBack]);

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

  // Bestemmingen uit links/meldingen worden pas verwerkt als de app ontgrendeld en niet afgeschermd is.
  useRouteInbox(lock.phase === "unlocked" && !lock.shielded, goTo);

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

  // De deeplink-listeners staan buiten de vergrendeling (zie DeepLinks) en blijven in elke toestand bestaan.
  if (status === "loading") return (<><main className="page center"><Spinner /></main></>);
  if (activation && status !== "unavailable") {
    return (
      <>
        
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
        
        <main className="page center">
          <div className="glass card stack" style={{ width: "100%", maxWidth: 420 }}>
            <ErrorState error={startupError} onRetry={retryStartup} />
            <button className="btn btn-ghost" onClick={() => void signOut()}>Uitloggen op dit toestel</button>
          </div>
        </main>
      </>
    );
  }
  if (status === "signedOut" && linkingDevice) return <DeviceLink onClose={() => setLinkingDevice(false)} />;
  if (status === "signedOut") return (<><Login key={loginEmail} initialEmail={loginEmail} onHaveInvitation={() => setActivation({})} onLinkDevice={() => setLinkingDevice(true)} /></>);

  return (
    <div className="shell">
      
      {APP_VARIANT === "dev" && <div className="banner" role="note">Ontwikkelomgeving – alleen testgegevens</div>}
      {!online && <div className="banner" role="status">Geen internetverbinding. Gegevens kunnen verouderd zijn.</div>}
      {ring && !isTabRoot(location.pathname) && (
        <NavBar title={navTitle(location.pathname)} backLabel={titleOf(parentPath(location.pathname))} onBack={() => void goBack()} />
      )}
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
            <Route path="/ontheffingen" element={<Navigate to="/voorstellen" replace />} />
            <Route path="/ontheffingen/nieuw" element={<OntheffingForm />} />
            <Route path="/ontheffingen/concept/:id" element={<OntheffingForm />} />
            <Route path="/ontheffingen/:id" element={<OntheffingDetail />} />
            <Route path="/open/:token" element={<OpenLink />} />
            {ring.isRingManager && <Route path="/beheer" element={<Navigate to="/beheer/gebruikers" replace />} />}
            {ring.isRingManager && <Route path="/beheer/:section" element={<Beheer />} />}
            {ring.isRingManager && <Route path="/inrichting" element={<Navigate to="/beheer/inrichting" replace />} />}
            {ring.isRingManager && <Route path="/gebruikers" element={<Navigate to="/beheer/gebruikers" replace />} />}
            <Route path="/meldingen" element={<Notifications onChanged={refreshUnread} />} />
            <Route path="/demo-beheer" element={<ReviewManagementDemo />} />
            <Route path="/profiel" element={<Profile />} />
            <Route path="*" element={<Home />} />
          </Routes>
        )}
      </main>
      <DeviceOffer />
      <TabBar unread={unread} pending={me?.pendingCount ?? 0} canManageUsers={!!ring?.isRingManager} hidden={lock.phase !== "unlocked" || lock.shielded} />
    </div>
  );
}

export default function App() {
  return (
    <>
      <DeepLinks />
      <AppLockGate controller={appLock} sources={nativeLockSources}>
        <HashRouter>
          <AuthProvider>
            <ConfirmProvider>
              <Shell />
            </ConfirmProvider>
          </AuthProvider>
        </HashRouter>
      </AppLockGate>
    </>
  );
}
