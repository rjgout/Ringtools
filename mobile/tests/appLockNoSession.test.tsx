import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

// E2.5 op componentniveau: de ECHTE poort + AuthProvider zonder/met opgeslagen sessie.
const cap = vi.hoisted(() => {
  const listeners = new Map<string, Array<(e: never) => void>>();
  const api = {
    addListener: vi.fn(async (name: string, cb: (e: never) => void) => {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name)!.push(cb);
      return { remove: async () => void listeners.set(name, (listeners.get(name) ?? []).filter((x) => x !== cb)) };
    }),
    minimizeApp: vi.fn(async () => {}),
    getState: vi.fn(async () => ({ isActive: true })),
  };
  return { listeners, api, emit: (name: string, e: unknown) => [...(listeners.get(name) ?? [])].forEach((cb) => cb(e as never)) };
});
vi.mock("@capacitor/core", async (orig) => {
  const actual = await orig<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => "ios" } };
});
vi.mock("@capacitor/app", () => ({ App: cap.api }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: vi.fn(async () => {}) } }));
vi.mock("../src/lib/native", () => ({ isNative: true, platform: "ios", onBackButton: () => () => {} }));
vi.mock("../src/lib/push", () => ({ registerForPush: vi.fn() }));
const store = vi.hoisted(() => ({ token: null as string | null, deviceKey: null as string | null }));
const storage = vi.hoisted(() => ({
  hasSession: vi.fn(async () => store.token !== null),
  getDeviceKey: vi.fn(async () => store.deviceKey),
  getToken: vi.fn(async () => store.token),
  setToken: vi.fn(async (t: string) => void (store.token = t)),
  getMode: vi.fn(async () => null),
  getRing: vi.fn(async () => null),
  setRing: vi.fn(async () => {}),
  getPushToken: vi.fn(async () => null),
  setPendingUnregister: vi.fn(async () => {}),
  getPendingLogouts: vi.fn(async () => []), queueLogout: vi.fn(async () => {}), removeQueuedLogout: vi.fn(async () => {}),
  getPendingUnregister: vi.fn(async () => null),
  clearPendingUnregister: vi.fn(async () => {}),
  clearDeviceKey: vi.fn(async () => { store.deviceKey = null; }), clearDeviceOfferDeclined: vi.fn(async () => {}), clearSession: vi.fn(async () => void (store.token = null)),
}));
vi.mock("../src/lib/storage", () => ({ storage }));

const net = vi.hoisted(() => ({ calls: [] as string[], meStatus: 200 }));
const fakeFetch = async (url: string, init?: { method?: string }) => {
  const path = new URL(url).pathname.replace(/^\/api\/mobile\/v1/, "");
  net.calls.push(`${init?.method ?? "GET"} ${path}`);
  if (path === "/me" && net.meStatus !== 200) return { status: net.meStatus, ok: false, json: async () => ({ error: "x", code: "unauthenticated" }) } as unknown as Response;
  const body = path === "/me" ? { user: { id: "u1", name: "Geheime Naam", email: "a@b.nl", emailNotificationsEnabled: true, mfaEnabled: false }, rings: [], pendingCount: 0 } : path === "/auth/refresh" ? { rotated: false } : { ok: true };
  return { status: 200, ok: true, json: async () => body } as unknown as Response;
};

const { LockController } = await import("../src/lib/appLock");
const { AppLockGate } = await import("../src/components/AppLock");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { nativeLockSources } = await import("../src/lib/appLockSources");
type Res = import("../src/lib/appLock").AppLockResult;

let auth: ReturnType<typeof vi.fn<() => Promise<Res>>>;
let now = 1_000_000;
function Probe() {
  const { status, me, signOut } = useAuth();
  return (
    <div>
      <div data-testid="probe">{status}:{me?.user.name ?? "-"}</div>
      <button onClick={() => void signOut()}>uit</button>
    </div>
  );
}
async function mount() {
  const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: () => auth() }, now: () => now });
  controller.configureSession(await storage.hasSession().catch(() => true)); // zoals main.tsx
  render(<AppLockGate controller={controller} sources={nativeLockSources}><AuthProvider><Probe /></AuthProvider></AppLockGate>);
  return controller;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  store.token = null;
  store.deviceKey = null;
  net.calls = [];
  net.meStatus = 200;
  now = 1_000_000;
  cap.listeners.clear();
  vi.clearAllMocks();
  auth = vi.fn<() => Promise<Res>>(async () => ({ ok: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Opstarten met en zonder opgeslagen sessie", () => {
  it("koude start zonder sessie: direct het inlogscherm (signedOut), geen Face ID-prompt, geen vertrouwelijke inhoud", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedOut:-"));
    expect(auth).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Ringtools is vergrendeld")).toBeNull();
    expect(screen.queryByText(/Geheime Naam/)).toBeNull();
  });

  it("koude start met sessie: eerst Face ID; pas daarna wordt de sessie gebruikt", async () => {
    store.token = "tok";
    await mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedIn:Geheime Naam"));
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it("de sessiecontrole leest het token niet (alleen of de sleutel bestaat): getToken wordt vóór ontgrendelen niet aangeroepen", async () => {
    store.token = "tok";
    let release: (r: Res) => void = () => {};
    auth.mockImplementation(() => new Promise<Res>((r) => (release = r)));
    await mount();
    await waitFor(() => expect(auth).toHaveBeenCalled());
    expect(storage.hasSession).toHaveBeenCalled();
    expect(storage.getToken).not.toHaveBeenCalled();
    expect(net.calls).toEqual([]);
    act(() => release({ ok: true }));
    await waitFor(() => expect(storage.getToken).toHaveBeenCalled());
  });

  it("mislukte sessiecontrole: fail-closed, volledige vergrendeling", async () => {
    storage.hasSession.mockRejectedValueOnce(new Error("keychain"));
    await mount();
    await waitFor(() => expect(auth).toHaveBeenCalledTimes(1));
  });

  it("verlopen/ingetrokken sessie (401): terug naar het inlogscherm zonder tweede prompt, ook na lange achtergrond", async () => {
    store.token = "tok";
    net.meStatus = 401;
    await mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedOut:-"));
    expect(auth).toHaveBeenCalledTimes(1);
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 120_000;
    act(() => cap.emit("appStateChange", { isActive: true }));
    await Promise.resolve();
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it("uitloggen met verlopen sessie start geen automatische toestelaanmelding", async () => {
    store.token = "tok";
    await mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedIn:Geheime Naam"));
    store.deviceKey = JSON.stringify({ installationId: "01234567890123456789012345678901", tag: "synthetisch", userId: "u1" });
    net.calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.endsWith("/auth/logout")) return { status: 401, ok: false, json: async () => ({ error: "verlopen" }) } as Response;
      return fakeFetch(url, init);
    }));
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedOut:-"));
    expect(storage.queueLogout).toHaveBeenCalledWith("tok");
    expect(net.calls.some(c => c.includes("/auth/device/"))).toBe(false);
    expect(store.deviceKey).toBeNull();
  });

  it("uitloggen: sessie lokaal gewist, direct inlogscherm, geen extra prompt; daarna lange achtergrond zonder prompt", async () => {
    store.token = "tok";
    await mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedIn:Geheime Naam"));
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedOut:-"));
    expect(storage.clearSession).toHaveBeenCalled();
    expect(store.token).toBeNull();
    expect(screen.queryByText(/Geheime Naam/)).toBeNull();
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 120_000;
    act(() => cap.emit("appStateChange", { isActive: true }));
    await Promise.resolve();
    expect(auth).toHaveBeenCalledTimes(1); // alleen de oorspronkelijke koude start
  });

  it("Face ID annuleren bij koude start met sessie: geen beschermde gegevens zichtbaar", async () => {
    store.token = "tok";
    auth.mockResolvedValue({ ok: false, reason: "cancelled" });
    await mount();
    await waitFor(() => expect(screen.getByLabelText("Ringtools is vergrendeld")).toBeTruthy());
    expect(screen.queryByText(/Geheime Naam/)).toBeNull();
    expect(net.calls).toEqual([]);
  });
});
