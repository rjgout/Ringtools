import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginListenerHandle } from "@capacitor/core";

/** Minimale, getrouwe fake van de Capacitor PushNotifications-plugin: houdt listeners per event bij. */
const plugin = vi.hoisted(() => {
  type Cb = (e: never) => void;
  const listeners = new Map<string, Set<Cb>>();
  const state = { token: "fcm-token-" + "x".repeat(30), permission: "granted" as "granted" | "denied" | "prompt", registerFails: false };
  const fire = (event: string, payload: unknown) => [...(listeners.get(event) ?? [])].forEach((cb) => cb(payload as never));
  const api = {
    addListener: vi.fn(async (event: string, cb: Cb): Promise<PluginListenerHandle> => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return { remove: async () => void listeners.get(event)!.delete(cb) };
    }),
    removeAllListeners: vi.fn(async () => void listeners.clear()),
    checkPermissions: vi.fn(async () => ({ receive: state.permission })),
    requestPermissions: vi.fn(async () => ({ receive: "granted" })),
    register: vi.fn(async () => {
      setTimeout(() => (state.registerFails ? fire("registrationError", { error: "x" }) : fire("registration", { value: state.token })), 0);
    }),
  };
  return { api, listeners, state, fire, count: (e: string) => listeners.get(e)?.size ?? 0 };
});

vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: plugin.api }));
vi.mock("../src/lib/native", () => ({ isNative: true, platform: "ios" }));
const storageMock = vi.hoisted(() => ({
  deviceId: vi.fn(async () => "install-0001"),
  setPushToken: vi.fn(async () => {}),
  clearPendingUnregister: vi.fn(async () => {}),
}));
vi.mock("../src/lib/storage", () => ({ storage: storageMock }));

const { obtainPushToken, registerForPush } = await import("../src/lib/push");
const { installDeepLinkHandlers } = await import("../src/lib/deeplinks");

const HOST = "ringapeldoorn.nl";
const ID = "cm0abcdefghijklmnop";

beforeEach(() => {
  plugin.listeners.clear();
  plugin.state.permission = "granted";
  plugin.state.registerFails = false;
  vi.clearAllMocks();
});

function install(onRoute = vi.fn(), launchUrl: string | null = null) {
  const urlListeners = new Set<(e: { url: string }) => void>();
  const stop = installDeepLinkHandlers(
    {
      getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : null),
      onUrlOpen: async (cb) => {
        urlListeners.add(cb);
        return { remove: async () => void urlListeners.delete(cb) };
      },
      onPushTap: (cb) => plugin.api.addListener("pushNotificationActionPerformed", cb as never),
    },
    HOST,
    onRoute
  );
  return { onRoute, stop, openUrl: (url: string) => urlListeners.forEach((cb) => cb({ url })), urlListeners };
}
const tap = (url: string) => plugin.fire("pushNotificationActionPerformed", { actionId: "tap", notification: { data: { url } } });
const flush = () => new Promise((r) => setTimeout(r, 5));

describe("Pushregistratie", () => {
  it("levert het token, registreert het bij de server en ruimt alleen de eigen listeners op", async () => {
    const api = { registerDevice: vi.fn(async () => ({ ok: true })) };
    const result = await registerForPush(api as never);
    expect(result.ok).toBe(true);
    expect(api.registerDevice).toHaveBeenCalledWith(plugin.state.token, "ios", "install-0001");
    expect(storageMock.setPushToken).toHaveBeenCalledWith(plugin.state.token);
    expect(plugin.count("registration")).toBe(0);
    expect(plugin.count("registrationError")).toBe(0);
    expect(plugin.api.removeAllListeners).not.toHaveBeenCalled();
  });

  it("vraagt geen toestemming als die al geweigerd is en registreert dan niets", async () => {
    plugin.state.permission = "denied";
    const api = { registerDevice: vi.fn() };
    expect((await registerForPush(api as never)).ok).toBe(false);
    expect(plugin.api.register).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it("een registratiefout geeft een nette melding en laat geen listeners achter", async () => {
    plugin.state.registerFails = true;
    const api = { registerDevice: vi.fn() };
    expect((await registerForPush(api as never)).ok).toBe(false);
    expect(plugin.count("registration") + plugin.count("registrationError")).toBe(0);
  });

  it("een time-out ruimt de listeners op", async () => {
    plugin.api.register.mockImplementationOnce(async () => {}); // OS antwoordt nooit
    expect(await obtainPushToken(20)).toBeNull();
    expect(plugin.count("registration") + plugin.count("registrationError")).toBe(0);
  });
});

describe("Tikken op een pushmelding blijft werken (listener voor pushNotificationActionPerformed blijft bestaan)", () => {
  it("na pushregistratie navigeert een tik nog steeds naar het voorstel", async () => {
    const { onRoute } = install();
    await flush();
    expect(plugin.count("pushNotificationActionPerformed")).toBe(1);
    await registerForPush({ registerDevice: vi.fn(async () => ({ ok: true })) } as never);
    expect(plugin.count("pushNotificationActionPerformed")).toBe(1); // niet verwijderd door de registratie
    tap(`/roepingen/${ID}`);
    expect(onRoute).toHaveBeenCalledWith(`/roepingen/${ID}`);
  });

  it("herhaalde pushregistratie laat het aantal listeners gelijk en de tik blijft één keer afgehandeld worden", async () => {
    const { onRoute } = install();
    await flush();
    const api = { registerDevice: vi.fn(async () => ({ ok: true })) };
    for (let i = 0; i < 3; i++) await registerForPush(api as never);
    expect(api.registerDevice).toHaveBeenCalledTimes(3);
    expect(plugin.count("pushNotificationActionPerformed")).toBe(1);
    expect(plugin.count("registration")).toBe(0);
    tap(`/roepingen/${ID}`);
    expect(onRoute).toHaveBeenCalledTimes(1);
  });

  it("app volledig gesloten (koude start): de launch-URL wordt afgehandeld en een bewaarde tik komt aan zodra de listener er is", async () => {
    const cold = install(vi.fn(), `https://${HOST}/open/${ID}`);
    await flush();
    expect(cold.onRoute).toHaveBeenCalledWith(`/open/${ID}`);
    // Capacitor levert een tik die de app startte nadat de listener geregistreerd is
    tap(`/roepingen/${ID}`);
    expect(cold.onRoute).toHaveBeenLastCalledWith(`/roepingen/${ID}`);
  });

  it("app op de achtergrond: universele link (appUrlOpen) en pushtik leiden naar het juiste voorstel", async () => {
    const bg = install();
    await flush();
    bg.openUrl(`https://${HOST}/roepingen/${ID}`);
    tap(`/roepingen/${ID}`);
    expect(bg.onRoute.mock.calls).toEqual([[`/roepingen/${ID}`], [`/roepingen/${ID}`]]);
  });

  it("app al geopend: links en tikken werken; vreemde bestemmingen worden genegeerd", async () => {
    const live = install();
    await flush();
    live.openUrl(`https://evil.example/roepingen/${ID}`);
    live.openUrl(`https://${HOST}/dashboard`);
    tap("https://evil.example/x");
    tap("//evil.example/x");
    expect(live.onRoute).not.toHaveBeenCalled();
    live.openUrl(`https://${HOST}/open/${ID}`);
    expect(live.onRoute).toHaveBeenCalledWith(`/open/${ID}`);
  });

  it("stoppen verwijdert alleen de eigen listeners", async () => {
    const other = vi.fn();
    await plugin.api.addListener("pushNotificationActionPerformed", other as never); // listener van een ander onderdeel
    const { stop, onRoute } = install();
    await flush();
    stop();
    await flush();
    tap(`/roepingen/${ID}`);
    expect(onRoute).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    expect(plugin.api.removeAllListeners).not.toHaveBeenCalled();
  });
});
