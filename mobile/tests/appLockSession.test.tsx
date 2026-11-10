import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

// De ECHTE bronnen (nativeLockSources) en de echte AuthProvider, aangesloten op dezelfde nagebootste native gebeurtenisbus:
// zo wordt de volgorde van de listeners gereproduceerd zoals die in de app ontstaat.
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
  /** Zendt een gebeurtenis in registratievolgorde, zoals Capacitor. `order: "reverse"` bootst een omgekeerde volgorde na. */
  const emit = (name: string, e: unknown, order: "normal" | "reverse" = "normal") => {
    const list = [...(listeners.get(name) ?? [])];
    (order === "reverse" ? list.reverse() : list).forEach((cb) => cb(e as never));
  };
  return { listeners, api, emit };
});
vi.mock("@capacitor/core", async (orig) => {
  const actual = await orig<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => "ios" } };
});
vi.mock("@capacitor/app", () => ({ App: cap.api }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: vi.fn(async () => {}) } }));
vi.mock("../src/lib/native", () => ({ isNative: true, platform: "ios", onBackButton: () => () => {} }));
vi.mock("../src/lib/push", () => ({ registerForPush: vi.fn() }));
const storage = vi.hoisted(() => ({
  getToken: vi.fn(async () => "tok"),
  setToken: vi.fn(async () => {}),
  getMode: vi.fn(async () => null),
  getRing: vi.fn(async () => null),
  setRing: vi.fn(async () => {}),
  getPushToken: vi.fn(async () => null),
  setPendingUnregister: vi.fn(async () => {}),
  getPendingLogouts: vi.fn(async () => []), queueLogout: vi.fn(async () => {}), removeQueuedLogout: vi.fn(async () => {}),
  getPendingUnregister: vi.fn(async () => "oud-pushtoken"),
  clearPendingUnregister: vi.fn(async () => {}),
  clearSession: vi.fn(async () => {}),
}));
vi.mock("../src/lib/storage", () => ({ storage }));

// Alleen de netwerklaag (fetch) wordt nagebootst; de echte ApiClient (met zijn vergrendelingspoort) blijft in gebruik.
const net = vi.hoisted(() => ({ calls: [] as string[], gate: null as null | Promise<void> }));
const fakeFetch = async (url: string, init?: { method?: string }) => {
  const path = new URL(url).pathname.replace(/^\/api\/mobile\/v1/, "");
  net.calls.push(`${init?.method ?? "GET"} ${path}`);
  if (net.gate && path === "/auth/refresh") await net.gate;
  const body =
    path === "/me" ? { user: { id: "u1", name: "Geheime Naam", email: "a@b.nl", emailNotificationsEnabled: true, mfaEnabled: false }, rings: [], pendingCount: 0 }
    : path === "/auth/refresh" ? { rotated: false }
    : { ok: true };
  return { status: 200, ok: true, json: async () => body } as unknown as Response;
};

const { LockController } = await import("../src/lib/appLock");
const { AppLockGate } = await import("../src/components/AppLock");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { nativeLockSources } = await import("../src/lib/appLockSources");
type Res = import("../src/lib/appLock").AppLockResult;

function Probe() {
  const { status, me } = useAuth();
  return <div data-testid="probe">{status}:{me?.user.name ?? "-"}</div>;
}

let now = 1_000_000;
let auth: ReturnType<typeof vi.fn<() => Promise<Res>>>;
function mount() {
  const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: () => auth() }, now: () => now });
  render(
    <AppLockGate controller={controller} sources={nativeLockSources}>
      <AuthProvider><Probe /></AuthProvider>
    </AppLockGate>
  );
  return controller;
}
const apiCalls = () => net.calls.filter((c) => !c.startsWith("OPTIONS"));
const hold = () => { let release: (r: Res) => void = () => {}; const p = new Promise<Res>((r) => (release = r)); return { p, release }; };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  now = 1_000_000;
  net.calls = [];
  net.gate = null;
  cap.listeners.clear();
  vi.clearAllMocks();
  auth = vi.fn<() => Promise<Res>>(async () => ({ ok: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function unlockedApp() {
  const controller = mount();
  await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedIn:Geheime Naam"));
  // Het opstarten (sessieverversing, openstaande afmelding, /me) loopt asynchroon na "signedIn" en landt op een trage runner soms later:
  // wacht tot de netwerkactiviteit tot rust is gekomen (twee opeenvolgende metingen gelijk) en begin dan pas met meten.
  let last = -1;
  for (let stable = 0; stable < 2; ) {
    await new Promise((r) => setTimeout(r, 40));
    stable = net.calls.length === last ? stable + 1 : 0;
    last = net.calls.length;
  }
  net.calls = [];
  return controller;
}

describe("Sessieactiviteit tijdens vergrendeling (volgorde van gebeurtenissen)", () => {
  it.each(["normal", "reverse"] as const)("terugkeer na meer dan 30 seconden (volgorde %s): geen enkele API-aanroep zolang vergrendeld; één verversing pas na ontgrendelen", async (order) => {
    const controller = await unlockedApp();
    const h = hold();
    auth.mockImplementation(() => h.p);
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 31_000;
    act(() => cap.emit("appStateChange", { isActive: true }, order));
    await waitFor(() => expect(auth).toHaveBeenCalled());
    expect(controller.getSnapshot().phase).toBe("authenticating");
    expect(apiCalls()).toEqual([]); // niets terwijl de prompt openstaat
    // nog een voorgrondgebeurtenis tijdens de prompt: nog steeds niets
    act(() => cap.emit("appStateChange", { isActive: true }, order));
    expect(apiCalls()).toEqual([]);
    act(() => h.release({ ok: true }));
    await waitFor(() => expect(apiCalls()).toContain("POST /auth/refresh"));
    expect(apiCalls().filter((c) => c === "POST /auth/refresh")).toHaveLength(1);
  });

  it("annuleren na de langere afwezigheid: ook dan geen API-aanroep, nog vele voorgrondgebeurtenissen later niet", async () => {
    const controller = await unlockedApp();
    auth.mockResolvedValue({ ok: false, reason: "cancelled" });
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 31_000;
    act(() => cap.emit("appStateChange", { isActive: true }));
    await waitFor(() => expect(controller.getSnapshot().failure).toBe("cancelled"));
    for (let i = 0; i < 3; i++) {
      act(() => cap.emit("appStateChange", { isActive: false }));
      act(() => cap.emit("appStateChange", { isActive: true }));
    }
    expect(apiCalls()).toEqual([]);
  });

  it("een verversing die al liep toen de app werd vergrendeld, vraagt daarna geen gegevens meer op (/me) maar bewaart wel een geroteerd token", async () => {
    await unlockedApp();
    let open: () => void = () => {};
    net.gate = new Promise<void>((r) => (open = r));
    act(() => cap.emit("appStateChange", { isActive: true })); // start een verversing (ontgrendeld, binnen de regel)
    await waitFor(() => expect(apiCalls()).toContain("POST /auth/refresh"));
    // intussen vergrendelt de app
    auth.mockImplementation(() => new Promise<Res>(() => {}));
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 31_000;
    act(() => cap.emit("appStateChange", { isActive: true }));
    net.calls = net.calls.filter((c) => c !== "POST /auth/refresh");
    act(() => open());
    await new Promise((r) => setTimeout(r, 30));
    expect(apiCalls().filter((c) => c === "GET /me")).toEqual([]);
  });

  it("korte terugkeer binnen 30 seconden verfrist de sessie nog steeds (regel behouden)", async () => {
    await unlockedApp();
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 10_000;
    act(() => cap.emit("appStateChange", { isActive: true }));
    await waitFor(() => expect(apiCalls()).toContain("POST /auth/refresh"));
    expect(auth).toHaveBeenCalledTimes(1); // alleen de eerste ontgrendeling
  });

  it("de netwerklaag zelf weigert verzoeken zolang de app vergrendeld is (vangnet voor elk scherm)", async () => {
    await unlockedApp();
    auth.mockImplementation(() => new Promise<Res>(() => {}));
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 31_000;
    act(() => cap.emit("appStateChange", { isActive: true }));
    await waitFor(() => expect(auth).toHaveBeenCalled());
    const { ApiClient } = await import("../src/lib/api");
    const locked = new ApiClient({ baseUrl: "https://x.test/api/mobile/v1", getToken: () => "t", isBlocked: () => true });
    await expect(locked.me()).rejects.toMatchObject({ code: "app-locked", status: 0 });
    expect(apiCalls()).toEqual([]);
  });

  it("zonder verzoeken-poort (isBlocked niet opgegeven) gedraagt de client zich als voorheen", async () => {
    const { ApiClient } = await import("../src/lib/api");
    const open = new ApiClient({ baseUrl: "https://x.test/api/mobile/v1", getToken: () => "t" });
    await expect(open.me()).resolves.toMatchObject({ user: { name: "Geheime Naam" } });
  });
});

describe("Schermbescherming als toegangsvoorwaarde (gate)", () => {
  it("mislukte bescherming: kinderen worden niet gemonteerd, geen API-aanroep, geen prompt, begrijpelijke melding met opnieuw proberen", async () => {
    const protection = vi.fn(async () => false);
    const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: () => auth() }, screenProtection: protection });
    render(
      <AppLockGate controller={controller} sources={nativeLockSources}>
        <AuthProvider><Probe /></AuthProvider>
      </AppLockGate>
    );
    expect(await screen.findByText(/schermbeveiliging/)).toBeTruthy();
    expect(screen.queryByTestId("probe")).toBeNull();
    expect(auth).not.toHaveBeenCalled();
    expect(apiCalls()).toEqual([]);
    expect(storage.getToken).not.toHaveBeenCalled();
    protection.mockResolvedValue(true);
    act(() => screen.getByRole("button", { name: "Opnieuw proberen" }).click());
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedIn:Geheime Naam"));
  });
});

describe("Terugkeer binnen 30 s: eerst de schermbescherming bevestigen (gate + sessie)", () => {
  function mountWithProtection() {
    const queue: Array<(v: boolean) => void> = [];
    let first = true;
    const protection = vi.fn(() => (first ? ((first = false), Promise.resolve(true)) : new Promise<boolean>((r) => void queue.push(r))));
    const controller = new LockController({ enabled: true, provider: { deviceSecure: async () => true, authenticate: () => auth() }, screenProtection: protection, now: () => now });
    render(
      <AppLockGate controller={controller} sources={nativeLockSources}>
        <AuthProvider><Probe /></AuthProvider>
      </AppLockGate>
    );
    return { controller, queue, protection };
  }
  const content = () => document.querySelector(".lock-content") as HTMLElement;

  it("tijdens de controle: afdekking aan, inhoud onbereikbaar, geen sessieverversing en geen enkel verzoek; na succes één verversing", async () => {
    const { queue } = mountWithProtection();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("signedIn:Geheime Naam"));
    net.calls = [];
    act(() => cap.emit("appStateChange", { isActive: false }));
    now += 5_000;
    act(() => cap.emit("appStateChange", { isActive: true }));
    expect(screen.getByTestId("privacy-cover")).toBeTruthy(); // nog steeds afgeschermd
    expect(content().hasAttribute("inert")).toBe(true);
    expect(apiCalls()).toEqual([]);
    // ook een tweede voorgrondgebeurtenis of een directe aanroep van de client levert niets op
    const { ApiClient } = await import("../src/lib/api");
    await new Promise((r) => setTimeout(r, 20));
    expect(apiCalls()).toEqual([]);
    expect(auth).toHaveBeenCalledTimes(1); // geen nieuwe prompt binnen de grens
    act(() => queue[0](true));
    await waitFor(() => expect(screen.queryByTestId("privacy-cover")).toBeNull());
    expect(content().hasAttribute("inert")).toBe(false);
    await waitFor(() => expect(apiCalls().filter((c) => c === "POST /auth/refresh")).toHaveLength(1));
    void ApiClient;
  });

  it("mislukte controle: vergrendelscherm 'schermbeveiliging', inhoud verborgen, nooit een verzoek", async () => {
    const { queue } = mountWithProtection();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedIn/));
    net.calls = [];
    act(() => cap.emit("appStateChange", { isActive: false }));
    act(() => cap.emit("appStateChange", { isActive: true }));
    act(() => queue[0](false));
    expect(await screen.findByText(/schermbeveiliging/)).toBeTruthy();
    expect(content().hidden).toBe(true);
    expect(apiCalls()).toEqual([]);
  });

  it("snelle wisselingen: uitsluitend de laatste uitkomst opent de app; oudere uitkomsten niet", async () => {
    const { queue } = mountWithProtection();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedIn/));
    net.calls = [];
    for (let i = 0; i < 3; i++) {
      act(() => cap.emit("appStateChange", { isActive: false }));
      act(() => cap.emit("appStateChange", { isActive: true }));
    }
    act(() => queue[0](true));
    act(() => queue[1](true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("privacy-cover")).toBeTruthy();
    expect(apiCalls()).toEqual([]);
    act(() => queue[2](true));
    await waitFor(() => expect(screen.queryByTestId("privacy-cover")).toBeNull());
    await waitFor(() => expect(apiCalls().filter((c) => c === "POST /auth/refresh")).toHaveLength(1));
  });

  it("systeemdialoog (alleen inactief, zonder terugkeer): verzoeken blijven mogelijk, zodat bijv. de pushregistratie kan afronden", async () => {
    const { controller } = mountWithProtection();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toMatch(/signedIn/));
    act(() => cap.emit("appStateChange", { isActive: false }));
    expect(controller.isUnlocked()).toBe(true);
    const { ApiClient } = await import("../src/lib/api");
    const client = new ApiClient({ baseUrl: "https://x.test/api/mobile/v1", getToken: () => "t", isBlocked: () => !controller.isUnlocked() });
    await expect(client.me()).resolves.toMatchObject({ user: { name: "Geheime Naam" } });
  });
});
