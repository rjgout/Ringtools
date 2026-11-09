import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "../src/components/ui";
import { buildTabs, setNativeTabBarBridgeForTests, TAB_SYMBOLS, type NativeTabBarBridge } from "../src/lib/nativeTabBar";
import { emitKeyboardChange } from "../src/lib/native";
import { registerOverlay } from "../src/lib/overlays";
import { TAB_ROOT } from "../src/lib/navigation";

type Update = Parameters<NativeTabBarBridge["update"]>[0];

function fakeBridge(opts: { failUpdate?: boolean; neverResolve?: boolean; height?: number } = {}) {
  const calls = { update: [] as Update[], setHidden: [] as boolean[], remove: 0 };
  let select: (id: string) => void = () => {};
  let layout: (h: number) => void = () => {};
  const bridge: NativeTabBarBridge = {
    update: (o) => {
      calls.update.push(o);
      if (opts.neverResolve) return new Promise(() => {});
      return opts.failUpdate ? Promise.reject(new Error("geen plug-in")) : Promise.resolve({ height: opts.height ?? 83 });
    },
    setHidden: async (h) => void calls.setHidden.push(h),
    remove: async () => void (calls.remove += 1),
    onSelect: (cb) => ((select = cb), () => {}),
    onLayout: (cb) => ((layout = cb), () => {}),
  };
  return { bridge, calls, tap: (id: string) => act(() => select(id)), layout: (h: number) => act(() => layout(h)) };
}

let nav: ReturnType<typeof useNavigate>;
function Probe() {
  const l = useLocation();
  nav = useNavigate();
  return <div data-testid="path">{l.pathname}</div>;
}
const mount = (path = "/", props: Partial<Parameters<typeof TabBar>[0]> = {}) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <TabBar unread={0} pending={0} canManageUsers={false} {...props} />
    </MemoryRouter>
  );
const path = () => screen.getByTestId("path").textContent;

beforeEach(() => {
  delete document.documentElement.dataset.keyboard;
  delete document.documentElement.dataset.tabbar;
});
afterEach(() => {
  cleanup();
  setNativeTabBarBridgeForTests(null);
  vi.useRealTimers();
});

describe("buildTabs (gedeeld door de native en de webbalk)", () => {
  it("toont de vijf bestaande tabs in vaste volgorde, Beheer alleen voor ringbeheerders", () => {
    expect(buildTabs({ unread: 0, pending: 0, canManageUsers: false }).map((t) => t.id)).toEqual(["overzicht", "voorstellen", "meldingen", "profiel"]);
    expect(buildTabs({ unread: 0, pending: 0, canManageUsers: true }).map((t) => t.id)).toEqual(["overzicht", "voorstellen", "beheer", "meldingen", "profiel"]);
  });
  it("heeft per tab een SF Symbol en tellers alleen bij Overzicht (wachtend) en Meldingen (ongelezen)", () => {
    const tabs = buildTabs({ unread: 3, pending: 2, canManageUsers: true });
    for (const t of tabs) expect(t.symbol).toBe(TAB_SYMBOLS[t.id]);
    expect(Object.fromEntries(tabs.map((t) => [t.id, t.badge]))).toEqual({ overzicht: 2, voorstellen: 0, beheer: 0, meldingen: 3, profiel: 0 });
  });
  it("geeft toegankelijkheidslabels met de teller en nooit een negatieve teller", () => {
    const tabs = buildTabs({ unread: 4, pending: 1, canManageUsers: false });
    expect(tabs.find((t) => t.id === "meldingen")?.a11y).toBe("Meldingen, 4 ongelezen");
    expect(tabs.find((t) => t.id === "overzicht")?.a11y).toBe("Overzicht, 1 wachten op jou");
    expect(buildTabs({ unread: -2, pending: 0, canManageUsers: false }).find((t) => t.id === "meldingen")?.badge).toBe(0);
  });
});

describe("native tabbalk (iOS)", () => {
  it("vervangt de webbalk: geen dubbele footer, de hoogte van de balk wordt vrijgehouden", async () => {
    const f = fakeBridge({ height: 96 });
    setNativeTabBarBridgeForTests(f.bridge);
    const { container } = mount("/");
    await waitFor(() => expect(document.documentElement.dataset.tabbar).toBe("native"));
    expect(container.querySelector("nav.tabbar")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--native-tabbar-h")).toBe("96px");
    f.layout(0); // native meldt 0 als de balk verborgen is
    expect(document.documentElement.style.getPropertyValue("--native-tabbar-h")).toBe("0px");
  });

  it("stuurt tabs, tellers en geselecteerde tab naar native, en volgt de route (deeplink, melding, terug)", async () => {
    const f = fakeBridge();
    setNativeTabBarBridgeForTests(f.bridge);
    mount("/roepingen/abc", { unread: 5, pending: 2, canManageUsers: true });
    await waitFor(() => expect(f.calls.update.length).toBeGreaterThan(0));
    const first = f.calls.update[0];
    expect(first.selected).toBe("voorstellen");
    expect(first.tabs.map((t) => t.id)).toEqual(["overzicht", "voorstellen", "beheer", "meldingen", "profiel"]);
    expect(first.tabs.find((t) => t.id === "meldingen")?.badge).toBe(5);
    act(() => nav("/meldingen")); // bijvoorbeeld een pushmelding of deeplink
    await waitFor(() => expect(f.calls.update.at(-1)?.selected).toBe("meldingen"));
    act(() => nav("/beheer/inrichting"));
    await waitFor(() => expect(f.calls.update.at(-1)?.selected).toBe("beheer"));
    act(() => nav(-1)); // terugnavigatie
    await waitFor(() => expect(f.calls.update.at(-1)?.selected).toBe("meldingen"));
  });

  it("toont Beheer niet aan gebruikers zonder ringbeheerdersrechten", async () => {
    const f = fakeBridge();
    setNativeTabBarBridgeForTests(f.bridge);
    mount("/", { canManageUsers: false });
    await waitFor(() => expect(f.calls.update.length).toBeGreaterThan(0));
    expect(f.calls.update[0].tabs.some((t) => t.id === "beheer")).toBe(false);
  });

  it("opent bij een tik de juiste route", async () => {
    const f = fakeBridge();
    setNativeTabBarBridgeForTests(f.bridge);
    mount("/");
    await waitFor(() => expect(document.documentElement.dataset.tabbar).toBe("native"));
    for (const id of ["voorstellen", "meldingen", "profiel", "overzicht"] as const) {
      f.tap(id);
      await waitFor(() => expect(path()).toBe(TAB_ROOT[id]));
    }
  });

  it("opnieuw tikken op de actieve tab blijft ongewijzigd: omhoog scrollen, niet navigeren", async () => {
    const f = fakeBridge();
    setNativeTabBarBridgeForTests(f.bridge);
    const page = document.createElement("main");
    page.className = "page";
    const scrollTo = vi.fn();
    page.scrollTo = scrollTo as never;
    document.body.appendChild(page);
    mount("/voorstellen");
    await waitFor(() => expect(document.documentElement.dataset.tabbar).toBe("native"));
    f.tap("voorstellen");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(path()).toBe("/voorstellen");
    page.remove();
  });

  it("verbergt de balk bij vergrendeling/afscherming, toetsenbord en geopende overlays, en toont hem daarna weer", async () => {
    const f = fakeBridge();
    setNativeTabBarBridgeForTests(f.bridge);
    const view = mount("/");
    await waitFor(() => expect(document.documentElement.dataset.tabbar).toBe("native"));
    expect(f.calls.update[0].hidden).toBe(false);
    document.documentElement.dataset.keyboard = "open";
    act(() => emitKeyboardChange());
    await waitFor(() => expect(f.calls.setHidden.at(-1)).toBe(true));
    document.documentElement.dataset.keyboard = "closed";
    act(() => emitKeyboardChange());
    await waitFor(() => expect(f.calls.setHidden.at(-1)).toBe(false));
    let off = () => {};
    act(() => void (off = registerOverlay(() => {})));
    await waitFor(() => expect(f.calls.setHidden.at(-1)).toBe(true));
    act(() => off());
    await waitFor(() => expect(f.calls.setHidden.at(-1)).toBe(false));
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
        <TabBar unread={0} pending={0} canManageUsers={false} hidden />
      </MemoryRouter>
    );
    await waitFor(() => expect(f.calls.setHidden.at(-1)).toBe(true)); // vergrendeld
  });

  it("start verborgen als de app bij het opstarten vergrendeld is", async () => {
    const f = fakeBridge();
    setNativeTabBarBridgeForTests(f.bridge);
    mount("/", { hidden: true });
    await waitFor(() => expect(f.calls.update.length).toBeGreaterThan(0));
    expect(f.calls.update[0].hidden).toBe(true);
  });

  it("verwijdert de native balk als de balk niet meer getoond wordt (uitloggen, geen sessie)", async () => {
    const f = fakeBridge();
    setNativeTabBarBridgeForTests(f.bridge);
    const view = mount("/");
    await waitFor(() => expect(document.documentElement.dataset.tabbar).toBe("native"));
    view.unmount();
    expect(f.calls.remove).toBe(1);
    expect(document.documentElement.dataset.tabbar).toBeUndefined();
  });
});

describe("terugval naar de webbalk", () => {
  it("zonder native plug-in (browser, PWA, Android) staat de React-balk er gewoon", () => {
    const { container } = mount("/");
    expect(container.querySelector("nav.tabbar")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Overzicht/ })).toBeTruthy();
    expect(document.documentElement.dataset.tabbar).toBeUndefined();
  });

  it("als de native balk een fout geeft, komt de webbalk terug en werken de tabs", async () => {
    setNativeTabBarBridgeForTests(fakeBridge({ failUpdate: true }).bridge);
    const { container } = mount("/");
    await waitFor(() => expect(container.querySelector("nav.tabbar")).not.toBeNull());
    expect(document.documentElement.dataset.tabbar).toBeUndefined();
    act(() => screen.getByRole("link", { name: /Profiel/ }).click());
    await waitFor(() => expect(path()).toBe("/profiel"));
  });

  it("als de plug-in nooit antwoordt, blijft de app niet zonder navigatie", async () => {
    vi.useFakeTimers();
    setNativeTabBarBridgeForTests(fakeBridge({ neverResolve: true }).bridge);
    const { container } = mount("/");
    expect(container.querySelector("nav.tabbar")).toBeNull(); // eerst geen flits van een dubbele balk
    await act(async () => void vi.advanceTimersByTime(2100));
    expect(container.querySelector("nav.tabbar")).not.toBeNull();
  });
});
