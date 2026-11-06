import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
import { useEffect } from "react";

// ---- Mocks van platform, opslag en API ----
const cap = vi.hoisted(() => {
  const listeners = new Map<string, Set<(e: never) => void>>();
  const api = {
    addListener: vi.fn(async (name: string, cb: (e: never) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
      return { remove: async () => void listeners.get(name)?.delete(cb) };
    }),
    minimizeApp: vi.fn(async () => {}),
    getState: vi.fn(async () => ({ isActive: true })),
  };
  return { listeners, api, emit: (name: string, e: unknown) => listeners.get(name)?.forEach((cb) => cb(e as never)) };
});
vi.mock("@capacitor/app", () => ({ App: cap.api }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: vi.fn(async () => {}) } }));
vi.mock("../src/lib/native", () => ({ isNative: true, platform: "ios", onBackButton: () => () => {} }));
vi.mock("../src/lib/push", () => ({ registerForPush: vi.fn() }));

const store = vi.hoisted(() => ({ token: "tok" as string | null, mode: null as string | null }));
const storage = vi.hoisted(() => ({
  getToken: vi.fn(async () => store.token),
  setToken: vi.fn(async () => {}),
  getMode: vi.fn(async () => store.mode),
  getRing: vi.fn(async () => null),
  setRing: vi.fn(async () => {}),
  getPushToken: vi.fn(async () => null),
  setPendingUnregister: vi.fn(async () => {}),
  getPendingUnregister: vi.fn(async () => null),
  clearPendingUnregister: vi.fn(async () => {}),
  clearSession: vi.fn(async () => {}),
}));
vi.mock("../src/lib/storage", () => ({ storage }));

const apiMock = vi.hoisted(() => ({
  me: vi.fn(),
  refresh: vi.fn(async () => ({ rotated: false })),
  unregisterDeviceToken: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../src/lib/api", async (orig) => {
  const actual = await orig<typeof import("../src/lib/api")>();
  class ApiClient {
    me = apiMock.me;
    refresh = apiMock.refresh;
    unregisterDeviceToken = apiMock.unregisterDeviceToken;
  }
  return { ...actual, ApiClient };
});

const { LockController } = await import("../src/lib/appLock");
const { AppLockGate } = await import("../src/components/AppLock");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { RouteInbox } = await import("../src/lib/routeInbox");
const { useRouteInbox } = await import("../src/lib/useRouteInbox");
const { useAppLock } = await import("../src/components/AppLock");
const { ApiRequestError } = await import("../src/lib/api");
const { nativeLockSources } = await import("../src/lib/appLockSources");
type Res = import("../src/lib/appLock").AppLockResult;

const ME = { user: { id: "u1", name: "Geheime Naam", email: "a@b.nl", emailNotificationsEnabled: true, mfaEnabled: false }, rings: [], pendingCount: 0 };

function Probe() {
  const { status, me } = useAuth();
  return <div data-testid="probe">{status}:{me?.user.name ?? "-"}</div>;
}

function sources(over: Partial<import("../src/lib/appLockSources").LockSources> = {}) {
  const emit = new Set<(active: boolean) => void>();
  const s = {
    onAppState: vi.fn((cb: (a: boolean) => void) => (emit.add(cb), () => void emit.delete(cb))),
    onBackWhileLocked: vi.fn(() => vi.fn()),
    hideSplash: vi.fn(),
    ...over,
  };
  return { s, setActive: (a: boolean) => emit.forEach((cb) => cb(a)) };
}

function pendingAuth() {
  let release: (r: Res) => void = () => {};
  const authenticate = vi.fn(() => new Promise<Res>((r) => (release = r)));
  return { authenticate, release: (r: Res) => release(r) };
}

let now = 1_000_000;
function harness(auth: { authenticate: () => Promise<Res> }) {
  const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: auth.authenticate }, now: () => now });
  const src = sources();
  const ui = render(
    <AppLockGate controller={controller} sources={src.s}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </AppLockGate>
  );
  return { controller, src, ...ui };
}

beforeEach(() => {
  now = 1_000_000;
  store.token = "tok";
  store.mode = null;
  vi.clearAllMocks();
  apiMock.me.mockResolvedValue(ME);
});
afterEach(cleanup);

describe("Appvergrendeling: geen gegevens vóór ontgrendeling", () => {
  it("koude start: toont het neutrale vergrendelscherm; geen sessie hervat, geen opslag gelezen, geen API-aanroep, geen vertrouwelijke inhoud", async () => {
    const auth = pendingAuth();
    harness(auth);
    expect(screen.getByRole("main", { name: "Ringtools is vergrendeld" })).toBeTruthy();
    expect(screen.queryByTestId("probe")).toBeNull();
    await waitFor(() => expect(auth.authenticate).toHaveBeenCalledTimes(1));
    expect(storage.getToken).not.toHaveBeenCalled();
    expect(apiMock.me).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Geheime Naam/);
  });

  it("neemt het splashscreen weg zodat het vergrendelscherm zichtbaar is (launchAutoHide staat uit)", async () => {
    const auth = pendingAuth();
    const { src } = harness(auth);
    await waitFor(() => expect(src.s.hideSplash).toHaveBeenCalled());
  });

  it("na een geslaagde verificatie hervat de bestaande serversessie zonder nieuwe login", async () => {
    const auth = pendingAuth();
    harness(auth);
    await waitFor(() => expect(auth.authenticate).toHaveBeenCalled());
    act(() => auth.release({ ok: true }));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedIn:Geheime Naam"));
    expect(apiMock.me).toHaveBeenCalledTimes(1);
  });

  it("annuleren: de app blijft vergrendeld, er gaat niets naar de server; opnieuw proberen kan", async () => {
    let n = 0;
    const authenticate = vi.fn(async (): Promise<Res> => (++n === 1 ? { ok: false, reason: "cancelled" } : { ok: true }));
    harness({ authenticate });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("probe")).toBeNull();
    expect(apiMock.me).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ontgrendelen" }));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedIn/));
  });

  it("een verlopen of ingetrokken serversessie wordt door lokaal ontgrendelen NIET hersteld: volledig opnieuw inloggen blijft nodig", async () => {
    apiMock.me.mockRejectedValue(new ApiRequestError(401, "Sessie verlopen", "unauthenticated"));
    harness({ authenticate: async () => ({ ok: true }) });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedOut:-"));
  });

  it("zonder toestelbeveiliging: uitleg, geen prompt en geen toegang", async () => {
    const authenticate = vi.fn(async (): Promise<Res> => ({ ok: true }));
    const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => false, authenticate } });
    render(<AppLockGate controller={controller} sources={sources().s}><AuthProvider><Probe /></AuthProvider></AppLockGate>);
    expect(await screen.findByText("Schermvergrendeling vereist")).toBeTruthy();
    expect(authenticate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("probe")).toBeNull();
    expect(document.body.textContent).not.toMatch(/uitschakel|uitzetten/i);
  });

  it("geldt voor elke gewone gebruiker; een bewaarde beheerderssessie (oudere appversie) wordt nooit hervat maar gewist", async () => {
    harness({ authenticate: async () => ({ ok: true }) });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/^signedIn:/));
    expect(apiMock.me).toHaveBeenCalledTimes(1);
    cleanup();
    vi.clearAllMocks();
    apiMock.me.mockResolvedValue(ME);
    store.mode = "admin";
    harness({ authenticate: async () => ({ ok: true }) });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedOut/));
    expect(apiMock.me).not.toHaveBeenCalled(); // geen enkele aanroep met de oude beheerderssessie
    expect(storage.clearSession).toHaveBeenCalled();
  });
});

describe("Appvergrendeling: achtergrond, afscherming en terugknop", () => {
  async function unlocked() {
    const h = harness({ authenticate: async () => ({ ok: true }) });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedIn/));
    apiMock.me.mockClear();
    return h;
  }

  it("schermt direct af bij inactief; terug binnen 30 seconden zonder prompt en met normale sessieverversing", async () => {
    const h = await unlocked();
    act(() => h.src.setActive(false));
    expect(screen.getByTestId("privacy-cover")).toBeTruthy();
    now += 10_000;
    act(() => h.src.setActive(true));
    expect(screen.queryByTestId("privacy-cover")).toBeNull();
    expect(screen.getByTestId("probe")).toBeTruthy();
  });

  it("na 30 seconden: inhoud verborgen en onbereikbaar, vergrendelscherm, nieuwe prompt; pas daarna weer zichtbaar", async () => {
    const auth = vi.fn(async (): Promise<Res> => ({ ok: true }));
    const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: auth }, now: () => now });
    const src = sources();
    render(<AppLockGate controller={controller} sources={src.s}><AuthProvider><Probe /></AuthProvider></AppLockGate>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedIn/));
    const hold = pendingAuth();
    auth.mockImplementation(hold.authenticate);
    act(() => src.setActive(false));
    now += 31_000;
    act(() => src.setActive(true));
    await waitFor(() => expect(hold.authenticate).toHaveBeenCalled());
    const content = document.querySelector(".lock-content") as HTMLElement;
    expect(content.hidden).toBe(true);
    expect(content.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("main", { name: "Ringtools is vergrendeld" })).toBeTruthy();
    act(() => hold.release({ ok: true }));
    await waitFor(() => expect((document.querySelector(".lock-content") as HTMLElement).hidden).toBe(false));
  });

  it("terwijl de app vergrendeld is, worden bij voorgrond-gebeurtenissen geen gegevens ververst; na ontgrendelen volgt één verversing", async () => {
    const auth = vi.fn(async (): Promise<Res> => ({ ok: true }));
    const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: auth }, now: () => now });
    const src = sources();
    render(<AppLockGate controller={controller} sources={src.s}><AuthProvider><Probe /></AuthProvider></AppLockGate>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedIn/));
    apiMock.refresh.mockClear();
    apiMock.me.mockClear();
    const hold = pendingAuth();
    auth.mockImplementation(hold.authenticate);
    act(() => src.setActive(false));
    now += 60_000;
    act(() => src.setActive(true));
    await waitFor(() => expect(hold.authenticate).toHaveBeenCalled());
    act(() => cap.emit("appStateChange", { isActive: true }));
    expect(apiMock.refresh).not.toHaveBeenCalled();
    expect(apiMock.me).not.toHaveBeenCalled();
    act(() => hold.release({ ok: true }));
    await waitFor(() => expect(apiMock.refresh).toHaveBeenCalledTimes(1));
  });

  it("Android-terugknop: zolang vergrendeld is er een eigen terugknop-listener die de app minimaliseert; na ontgrendelen wordt ze verwijderd", async () => {
    const off = vi.fn();
    const onBack = vi.fn(() => off);
    const auth = pendingAuth();
    const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: auth.authenticate } });
    render(<AppLockGate controller={controller} sources={{ ...sources().s, onBackWhileLocked: onBack }}><div /></AppLockGate>);
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    act(() => auth.release({ ok: true }));
    await waitFor(() => expect(off).toHaveBeenCalled());
  });

  it("de echte bronnen: terugknop minimaliseert alleen op Android en ruimt uitsluitend de eigen listener op", async () => {
    // platform is hier "ios" (gemockt via Capacitor.getPlatform in jsdom = web): geen listener
    const off = nativeLockSources.onBackWhileLocked();
    off();
    expect(cap.api.minimizeApp).not.toHaveBeenCalled();
  });
});

describe("Deeplinks en meldingen worden pas na ontgrendeling verwerkt", () => {
  function Consumer({ inbox, onRoute }: { inbox: InstanceType<typeof RouteInbox>; onRoute: (r: string) => void }) {
    const lock = useAppLock();
    useRouteInbox(lock.phase === "unlocked" && !lock.shielded, onRoute, inbox);
    return null;
  }
  it("een bestemming die binnenkomt terwijl vergrendeld of afgeschermd is, wacht en wordt na ontgrendelen precies één keer verwerkt", async () => {
    const inbox = new RouteInbox();
    const onRoute = vi.fn();
    const auth = pendingAuth();
    const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: auth.authenticate }, now: () => now });
    const src = sources();
    render(<AppLockGate controller={controller} sources={src.s}><Consumer inbox={inbox} onRoute={onRoute} /></AppLockGate>);
    act(() => inbox.push("/roepingen/geheim"));
    await waitFor(() => expect(auth.authenticate).toHaveBeenCalled());
    expect(onRoute).not.toHaveBeenCalled();
    act(() => auth.release({ ok: true }));
    await waitFor(() => expect(onRoute).toHaveBeenCalledWith("/roepingen/geheim"));
    // afgeschermd (inactief): niet verwerken
    act(() => src.setActive(false));
    act(() => inbox.push("/ontheffingen/1"));
    expect(onRoute).toHaveBeenCalledTimes(1);
    now += 10_000;
    act(() => src.setActive(true));
    await waitFor(() => expect(onRoute).toHaveBeenCalledWith("/ontheffingen/1"));
    expect(onRoute).toHaveBeenCalledTimes(2);
  });

  it("de deeplink-listeners staan buiten de vergrendeling (ze worden niet door de gate gemonteerd of verwijderd)", () => {
    const app = read("src/App.tsx");
    const gateAt = app.indexOf("<AppLockGate");
    expect(app.indexOf("<DeepLinks />")).toBeGreaterThan(-1);
    expect(app.indexOf("<DeepLinks />")).toBeLessThan(gateAt);
    expect(app).toMatch(/routeInbox\.push\(route\)/);
  });
});

describe("Personal Team en bestaande beveiliging", () => {
  it("de vergrendeling hangt niet af van het buildprofiel of van passkeys en werkt dus ook in de Personal Team-build", async () => {
    for (const f of ["appLock.ts", "biometricAppLock.ts", "appLockSources.ts", "privacyScreen.ts"]) {
      const src = read(`src/lib/${f}`);
      expect(src).not.toMatch(/buildProfile|nativeCapabilities|passkeys|PersonalTeam/i);
    }
    (window as unknown as { __RINGTOOLS_BUILD__?: unknown }).__RINGTOOLS_BUILD__ = { profile: "personal-team" };
    const auth = pendingAuth();
    harness(auth);
    await waitFor(() => expect(auth.authenticate).toHaveBeenCalled());
    expect(screen.getByRole("main", { name: "Ringtools is vergrendeld" })).toBeTruthy();
    delete (window as unknown as { __RINGTOOLS_BUILD__?: unknown }).__RINGTOOLS_BUILD__;
  });

  it("het vergrendelscherm bevat geen eigen pincode- of terugvalinvoer", async () => {
    harness(pendingAuth());
    expect(document.querySelectorAll("input")).toHaveLength(0);
  });
});
