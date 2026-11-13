import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/lib/api";
import { useAuth } from "../src/lib/auth";
import { WebAuthProvider } from "../src/web/WebAuthProvider";
import { appUrlFor, consumeTargetParam, currentAppTarget, safeAppRoute, toLogin, toReverify } from "../src/web/webPaths";
import { canShareReminder, GENERAL_REMINDER, progressSteps } from "../src/lib/progress";
import { describeBrowser } from "../src/web/WebProfileSections";
import type { CallingDetail, Me } from "@shared/api-types";

// Webomgeving (web/PWA): dezelfde client, aangemeld met de HttpOnly-sessiecookie. Geen token, geen opslag van geheimen, 401 → inlogpagina.
const ME = { user: { id: "u1", name: "Test Gebruiker", email: "t@test.ringapeldoorn.nl", emailNotificationsEnabled: true, mfaEnabled: false, reviewAccount: false }, rings: [{ id: "r1", name: "Ring A", role: "RINGPRESIDIUM", churchFunction: "", isRingManager: false }, { id: "r2", name: "Ring B", role: "HOGERAAD", churchFunction: "", isRingManager: false }], pendingCount: 0 } as unknown as Me;

type Call = { url: string; init: RequestInit };
function stubFetch(handler: (path: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = handler(new URL(url, "http://localhost").pathname.replace("/api/mobile/v1", ""), init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}
const headersOf = (c: Call) => c.init.headers as Record<string, string>;

function Probe() {
  const a = useAuth();
  const [err, setErr] = useState("");
  return (
    <div>
      <span data-testid="status">{a.status}</span>
      <span data-testid="ring">{a.ring?.id ?? "-"}</span>
      <button onClick={() => void a.selectRing("r2")}>ring2</button>
      <button onClick={() => void a.selectRing("vreemd")}>vreemd</button>
      <button onClick={() => void a.signOut().catch((e: Error) => setErr(e.message))}>uit</button>
      <span data-testid="err">{err}</span>
      <button onClick={() => void a.reauth("12345678")}>reauth</button>
      <button onClick={() => void a.signIn("a@b.nl", "12345678").catch((e: Error) => { document.title = e.message; })}>signin</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ApiClient in de webomgeving", () => {
  it("stuurt de eigen header en de cookie van dezelfde oorsprong mee, nooit een Authorization-header, en vraagt geen cache", async () => {
    const calls = stubFetch(() => ({ status: 200, body: ME }));
    const api = new ApiClient({ baseUrl: "http://localhost/api/mobile/v1", getToken: () => "mag-nooit-mee", webCookie: true });
    await api.me();
    await api.setEmailNotifications(false);
    for (const c of calls) {
      expect(headersOf(c)["X-Ringtools-Web"]).toBe("1");
      expect(headersOf(c).Authorization).toBeUndefined();
      expect(headersOf(c)["Content-Type"]).toBe("application/json");
      expect(c.init.credentials).toBe("same-origin");
      expect(c.init.cache).toBe("no-store");
    }
  });
  it("de native client blijft ongewijzigd: Bearer-token, geen eigen header, geen credentials-instelling", async () => {
    const calls = stubFetch(() => ({ status: 200, body: ME }));
    await new ApiClient({ baseUrl: "http://localhost/api/mobile/v1", getToken: () => "tok" }).me();
    expect(headersOf(calls[0]).Authorization).toBe("Bearer tok");
    expect(headersOf(calls[0])["X-Ringtools-Web"]).toBeUndefined();
    expect(calls[0].init.credentials).toBeUndefined();
  });
  it("meldt een 401 altijd (er is geen token om op te controleren)", async () => {
    stubFetch(() => ({ status: 401, body: { error: "verlopen", code: "unauthenticated" } }));
    const onUnauthorized = vi.fn();
    await expect(new ApiClient({ baseUrl: "http://localhost/api/mobile/v1", getToken: () => null, webCookie: true, onUnauthorized }).me()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("WebAuthProvider", () => {
  it("ingelogd zodra /me slaagt; bewaart geen token en alleen de gekozen ring", async () => {
    stubFetch((path) => (path === "/me" ? { status: 200, body: ME } : { status: 200, body: { rotated: true, expiresAt: "x" } }));
    const redirect = vi.fn();
    render(<WebAuthProvider redirect={redirect}><Probe /></WebAuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    expect(screen.getByTestId("ring").textContent).toBe("r1");
    act(() => screen.getByText("ring2").click());
    await waitFor(() => expect(screen.getByTestId("ring").textContent).toBe("r2"));
    act(() => screen.getByText("vreemd").click()); // een ring waar je geen lid van bent wordt genegeerd
    expect(screen.getByTestId("ring").textContent).toBe("r2");
    expect(Object.keys(localStorage)).toEqual(["ringtools.web.ring"]);
    expect(sessionStorage.length).toBe(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("401 bij het opstarten: naar de bestaande inlogpagina met de huidige plek als terugkeeradres, zonder inhoud te tonen", async () => {
    stubFetch(() => ({ status: 401, body: { error: "x", code: "unauthenticated" } }));
    window.location.hash = "#/roepingen/abc";
    const redirect = vi.fn();
    render(<WebAuthProvider redirect={redirect}><Probe /></WebAuthProvider>);
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/app?to=" + encodeURIComponent("/roepingen/abc"))}`);
    expect(screen.getByTestId("status").textContent).toBe("loading");
  });

  it("403 (bijvoorbeeld het beheerdersaccount) gaat ook naar de website; een netwerkfout geeft 'niet beschikbaar' met opnieuw proberen", async () => {
    stubFetch(() => ({ status: 403, body: { error: "x", code: "admin-web-only" } }));
    const redirect = vi.fn();
    const first = render(<WebAuthProvider redirect={redirect}><Probe /></WebAuthProvider>);
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    first.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    render(<WebAuthProvider redirect={vi.fn()}><Probe /></WebAuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unavailable"));
  });

  it("uitloggen roept de server aan en gaat naar de inlogpagina; herverificatie bewaart niets", async () => {
    const calls = stubFetch((path) => (path === "/me" ? { status: 200, body: ME } : { status: 200, body: { ok: true } }));
    const redirect = vi.fn();
    render(<WebAuthProvider redirect={redirect}><Probe /></WebAuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    act(() => screen.getByText("reauth").click());
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/auth/reauth"))).toBe(true));
    expect(Object.keys(localStorage).filter((k) => k !== "ringtools.web.ring")).toEqual([]);
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("/login"));
    expect(calls.some((c) => c.url.endsWith("/auth/logout") && c.init.method === "POST")).toBe(true);
  });

  it("aanmelden met een code bestaat niet in de webomgeving (dat doet de website)", async () => {
    const calls = stubFetch((path) => (path === "/me" ? { status: 200, body: ME } : { status: 200, body: {} }));
    render(<WebAuthProvider redirect={vi.fn()}><Probe /></WebAuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    act(() => screen.getByText("signin").click());
    await waitFor(() => expect(document.title).toMatch(/niet beschikbaar/));
    expect(calls.some((c) => c.url.includes("/auth/login"))).toBe(false);
  });
});

describe("Veilig uitloggen in de webomgeving", () => {
  const signedInHandler = (logout: () => { status: number; body: unknown }) => (path: string) => (path === "/me" ? { status: 200, body: ME } : path === "/auth/logout" ? logout() : { status: 200, body: { rotated: false } });
  const mount = async (redirect = vi.fn()) => {
    render(<WebAuthProvider redirect={redirect}><Probe /></WebAuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    return redirect;
  };
  const posted: unknown[] = [];
  beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal("BroadcastChannel", class { onmessage: ((e: { data: unknown }) => void) | null = null; postMessage(m: unknown) { posted.push(m); } close() {} });
  });

  it("lukt het intrekken niet (geen verbinding of serverfout), dan blijft de gebruiker ingelogd met een duidelijke melding en gebeurt er niets anders", async () => {
    localStorage.setItem("ringtools.web.ring", "r2");
    const calls = stubFetch(signedInHandler(() => ({ status: 503, body: { error: "storing", code: "server" } })));
    const redirect = await mount();
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(screen.getByTestId("err").textContent).toMatch(/Uitloggen is niet gelukt\. Je bent nog ingelogd/));
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("signedIn");
    expect(localStorage.getItem("ringtools.web.ring")).toBe("r2");
    expect(posted).toEqual([]);
    expect(calls.filter((c) => c.url.endsWith("/auth/logout")).length).toBe(1);
  });

  it("een netwerkfout bij uitloggen telt ook als mislukt", async () => {
    let offline = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (offline && String(url).endsWith("/auth/logout")) throw new TypeError("offline");
      return new Response(JSON.stringify(String(url).endsWith("/me") ? ME : { rotated: false }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const redirect = await mount();
    offline = true;
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(screen.getByTestId("err").textContent).toMatch(/nog ingelogd/));
    expect(redirect).not.toHaveBeenCalled();
  });

  it("na een geslaagde intrekking: naar de inlogpagina, ringkeuze gewist, andere tabbladen op de hoogte, geen inhoud meer", async () => {
    localStorage.setItem("ringtools.web.ring", "r2");
    stubFetch(signedInHandler(() => ({ status: 200, body: { ok: true } })));
    const redirect = await mount();
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("/login"));
    expect(localStorage.getItem("ringtools.web.ring")).toBeNull();
    expect(posted).toEqual(["logout"]);
    expect(screen.getByTestId("status").textContent).toBe("loading");
  });

  it("een sessie die al ongeldig is (401) telt als uitgelogd", async () => {
    stubFetch(signedInHandler(() => ({ status: 401, body: { error: "verlopen", code: "unauthenticated" } })));
    const redirect = await mount();
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(redirect.mock.calls.every(([url]) => url === "/login" || String(url).startsWith("/login?next="))).toBe(true);
  });

  it("meldt de pushregistratie van dit apparaat af vóór het uitloggen (gedeeld apparaat)", async () => {
    const unsubscribe = vi.fn(async () => true);
    vi.stubGlobal("PushManager", class {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", unsubscribe }) } }) } });
    const calls = stubFetch(signedInHandler(() => ({ status: 200, body: { ok: true } })));
    const redirect = await mount();
    act(() => screen.getByText("uit").click());
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("/login"));
    const order = calls.map((c) => new URL(c.url, "http://x").pathname.replace("/api/mobile/v1", ""));
    expect(order.indexOf("/web-push/unsubscribe")).toBeGreaterThan(-1);
    expect(order.indexOf("/web-push/unsubscribe")).toBeLessThan(order.indexOf("/auth/logout"));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
  });

  it("een afmelding in een ander tabblad stuurt dit tabblad direct naar de inlogpagina", async () => {
    let channel: { onmessage: ((e: { data: unknown }) => void) | null } | null = null;
    vi.stubGlobal("BroadcastChannel", class { onmessage: ((e: { data: unknown }) => void) | null = null; constructor() { channel = this; } postMessage() {} close() {} });
    stubFetch(signedInHandler(() => ({ status: 200, body: { ok: true } })));
    const redirect = await mount();
    act(() => channel!.onmessage?.({ data: "logout" }));
    expect(redirect).toHaveBeenCalled();
  });
});

describe("webpaden", () => {
  it("alleen veilige interne routes; de bestemming gaat als /app?to=… door de website", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "javascript:alert(1)", "", "/a\nb"]) expect(safeAppRoute(bad)).toBeNull();
    expect(appUrlFor("/voorstellen")).toBe("/app?to=%2Fvoorstellen");
    expect(appUrlFor("/")).toBe("/app");
    expect(appUrlFor("//evil.example")).toBe("/app");
    expect(currentAppTarget({ hash: "#/profiel" })).toBe("/app?to=%2Fprofiel");
    expect(toLogin("/app")).toBe("/login?next=%2Fapp");
    expect(toReverify("/app?to=%2Fbeheer%2Fgebruikers")).toBe("/profiel/beveiliging/herverifieer?redirect=%2Fapp%3Fto%3D%252Fbeheer%252Fgebruikers");
  });
  it("?to= wordt bij het opstarten de hash-route en verdwijnt uit de adresbalk; een onveilige waarde wordt genegeerd", () => {
    const replaceState = vi.fn();
    const loc = (search: string) => ({ search, pathname: "/app", hash: "" }) as Location;
    expect(consumeTargetParam(loc("?to=%2Froepingen%2Fabc"), { replaceState } as unknown as History)).toBe("/roepingen/abc");
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/app#/roepingen/abc");
    expect(consumeTargetParam(loc("?to=%2F%2Fevil.example"), { replaceState } as unknown as History)).toBeNull();
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/app");
    expect(consumeTargetParam(loc(""), { replaceState } as unknown as History)).toBeNull();
  });
});

describe("Voortgang en algemene herinnering (app en web)", () => {
  const base = { status: "PRESIDIUM_VOTING", processedAt: null, tasks: [], me: { role: "RINGPRESIDIUM", isStaff: true } } as unknown as CallingDetail;
  const done = (c: Partial<CallingDetail>) => progressSteps({ ...base, ...c } as CallingDetail).filter((s) => s.done).map((s) => s.label);
  it("acht stappen in vaste volgorde, afgeleid van status en taken", () => {
    expect(progressSteps(base).map((s) => s.label)).toEqual(["Voorstel aangemaakt", "Ringpresidium akkoord", "Vrijgegeven aan de hoge raad", "Hoge raad akkoord", "Geroepen", "Ondersteund", "Aangesteld", "Verwerkt"]);
    expect(done({})).toEqual(["Voorstel aangemaakt"]);
    expect(done({ status: "PRESIDIUM_APPROVED" as never })).toEqual(["Voorstel aangemaakt", "Ringpresidium akkoord"]); // akkoord, nog niet vrijgegeven
    expect(done({ status: "HOGERAAD_VOTING" as never })).toEqual(["Voorstel aangemaakt", "Ringpresidium akkoord", "Vrijgegeven aan de hoge raad"]);
    expect(done({ status: "APPROVED" as never, tasks: [{ task: "ROEPEN", doneAt: "2026-01-01" }, { task: "ONDERSTEUNEN", doneAt: null }] as never })).toEqual(["Voorstel aangemaakt", "Ringpresidium akkoord", "Vrijgegeven aan de hoge raad", "Hoge raad akkoord", "Geroepen"]);
    expect(done({ status: "PROCESSED" as never, processedAt: "2026-01-02" })).toContain("Verwerkt");
  });
  it("de herinnering is alleen voor ringstaf tijdens een lopende ronde en bevat geen naam, roeping, ring of link", () => {
    expect(canShareReminder(base)).toBe(true);
    expect(canShareReminder({ ...base, me: { role: "HOGERAAD", isStaff: false } } as CallingDetail)).toBe(false);
    expect(canShareReminder({ ...base, status: "APPROVED" } as CallingDetail)).toBe(false);
    expect(GENERAL_REMINDER).not.toMatch(/https?:|@|\/roepingen|Ring [A-Z]/);
  });
});

describe("apparaatnaam voor het eigen webpush-overzicht", () => {
  it("herkent Chrome op Android en valt veilig terug", () => {
    expect(describeBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome op Android");
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox op Windows");
    expect(describeBrowser(null)).toBe("Onbekend apparaat");
  });
});
