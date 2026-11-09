import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../lib/api";
import { TAB_ROOT, tabForPath, type TabId } from "../lib/navigation";
import { buildTabs, getNativeTabBarBridge, nativeTabBarSupported } from "../lib/nativeTabBar";
import { hasOverlay, subscribeOverlays } from "../lib/overlays";
import { isKeyboardOpen, subscribeKeyboard } from "../lib/native";

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Laden" />;
}

/** Duidelijke fout- en offlinestatus met opnieuw proberen. */
export function ErrorState({ error, onRetry }: { error: ApiRequestError; onRetry?: () => void }) {
  return (
    <div className="glass card stack" role="alert">
      <strong>{error.isNetwork ? "Je bent offline" : "Dit lukt nu niet"}</strong>
      <span className="muted">{error.message}</span>
      {onRetry && (
        <button className="btn btn-primary" onClick={onRetry}>
          Opnieuw proberen
        </button>
      )}
    </div>
  );
}

const ICONS: Record<TabId, string> = {
  overzicht: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  voorstellen: "M6 3h9l4 4v14H6z M15 3v4h4 M9 12h6 M9 16h6",
  meldingen: "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7 M10 20a2 2 0 0 0 4 0",
  profiel: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6.5 18c1-3 3.2-4.5 5.5-4.5s4.5 1.5 5.5 4.5",
  beheer: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 7m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M8 17m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
};
function TabIcon({ tab }: { tab: TabId }) {
  return (
    <svg className="tab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[tab]} />
    </svg>
  );
}

type TabBarProps = { unread: number; pending: number; canManageUsers?: boolean; hidden?: boolean };

/** Waar een tik op een tab heen gaat; opnieuw tikken op de actieve tab brengt je terug naar de bovenkant van het hoofdscherm (ongewijzigd gedrag). */
function useTabPress() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = tabForPath(location.pathname);
  const latest = useRef({ active, pathname: location.pathname });
  latest.current = { active, pathname: location.pathname };
  const press = (id: TabId) => {
    const root = TAB_ROOT[id];
    const { active: now, pathname } = latest.current;
    if (now === id && pathname === root) {
      document.querySelector("main.page")?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigate(root);
  };
  return { active, press };
}

function useSignal(subscribe: (cb: () => void) => () => void, read: () => boolean) {
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    return subscribe(() => setValue(read()));
  }, [subscribe, read]);
  return value;
}

/**
 * Hoofdnavigatie (HIG: maximaal vijf tabs, icoon + label). Ringbeheerders krijgen één extra tab "Beheer" (gebruikers en inrichting
 * zitten daarin als segmenten) in plaats van twee losse tabs; zo blijft de balk op elk scherm passen.
 * Op iOS (app) tekent de native UITabBar (op iOS 26+ Liquid Glass) de balk; overal anders, en als de native balk niet start, de React-balk.
 */
export function TabBar(props: TabBarProps) {
  const native = useNativeTabBar(props);
  const root = document.documentElement;
  useEffect(() => {
    if (native === "web" || native === "off") delete root.dataset.tabbar;
  }, [native, root]);
  if (native === "native" || native === "pending") return null;
  return <WebTabBar {...props} />;
}

type NativeState = "off" | "pending" | "native" | "web";

/**
 * Houdt de native balk synchroon met de app: tabs en tellers, geselecteerde tab (volgt de route, dus ook bij deeplinks, meldingen en terug),
 * en zichtbaarheid (vergrendeld/afgeschermd, toetsenbord, geopende overlays). Faalt de plug-in, dan blijft de webbalk staan.
 */
function useNativeTabBar({ unread, pending, canManageUsers = false, hidden = false }: TabBarProps): NativeState {
  const supported = nativeTabBarSupported();
  const { active, press } = useTabPress();
  const [state, setState] = useState<NativeState>(supported ? "pending" : "off");
  const keyboard = useSignal(subscribeKeyboard, isKeyboardOpen);
  const overlay = useSignal(subscribeOverlays, hasOverlay);
  const pressRef = useRef(press);
  pressRef.current = press;
  const tabs = buildTabs({ unread, pending, canManageUsers });
  const tabsKey = JSON.stringify(tabs);
  const hide = hidden || keyboard || overlay;
  const hideRef = useRef(hide);
  hideRef.current = hide;
  const root = document.documentElement;

  // Selectie en luisteraars: één keer per aanmelding van de balk.
  useEffect(() => {
    if (!supported) return;
    const bridge = getNativeTabBarBridge();
    const offSelect = bridge.onSelect((id) => pressRef.current(id as TabId));
    const offLayout = bridge.onLayout((h) => root.style.setProperty("--native-tabbar-h", `${Math.max(0, Math.round(h))}px`));
    return () => {
      offSelect();
      offLayout();
      root.style.removeProperty("--native-tabbar-h");
      delete root.dataset.tabbar;
      void bridge.remove().catch(() => {});
    };
  }, [supported, root]);

  // Tabs, selectie, kleur en zichtbaarheid doorgeven.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    // Nooit blijven hangen zonder balk: reageert de plug-in niet binnen 2 s, dan neemt de webbalk het over.
    const timer = setTimeout(() => !cancelled && setState((st) => (st === "pending" ? "web" : st)), 2000);
    const tint = getComputedStyle(root).getPropertyValue("--tint").trim();
    getNativeTabBarBridge()
      .update({ tabs: JSON.parse(tabsKey) as typeof tabs, selected: active, tint: /^#[0-9a-f]{6}$/i.test(tint) ? tint : undefined, hidden: hideRef.current })
      .then(({ height }) => {
        if (cancelled) return;
        clearTimeout(timer);
        root.dataset.tabbar = "native";
        root.style.setProperty("--native-tabbar-h", `${Math.max(0, Math.round(height))}px`);
        setState("native");
      })
      .catch(() => {
        if (cancelled) return;
        root.style.removeProperty("--native-tabbar-h");
        setState("web"); // terugval: de webbalk blijft werken
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supported, tabsKey, active, root]);

  useEffect(() => {
    if (!supported || state !== "native") return;
    void getNativeTabBarBridge().setHidden(hide).catch(() => {});
  }, [supported, state, hide]);

  return state;
}

function WebTabBar({ unread, pending, canManageUsers = false }: TabBarProps) {
  const { active, press } = useTabPress();
  const tabs = buildTabs({ unread, pending, canManageUsers });
  return (
    <nav className="tabbar" aria-label="Hoofdnavigatie">
      {tabs.map((t) => (
        <a
          key={t.id}
          href={`#${TAB_ROOT[t.id]}`}
          className={`tab${active === t.id ? " active" : ""}`}
          aria-current={active === t.id ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            press(t.id);
          }}
        >
          <span className="tab-icon-wrap">
            <TabIcon tab={t.id} />
            {t.badge > 0 && <span className="dot" aria-label={t.id === "overzicht" ? `${t.badge} wachten op jou` : `${t.badge} ongelezen`}>{t.badge > 99 ? "99+" : t.badge}</span>}
          </span>
          <span className="tab-label">{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

/** Navigatiebalk voor schermen onder een hoofdgebied: terugknop met de naam van het vorige scherm en de titel van dit scherm. */
export function NavBar({ title, backLabel, onBack }: { title: string; backLabel: string; onBack: () => void }) {
  return (
    <header className="navbar material">
      <button type="button" className="navbar-back" onClick={onBack} aria-label={`Terug naar ${backLabel}`}>
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M10 2L2 10l8 8" /></svg>
        <span>{backLabel}</span>
      </button>
      <strong className="navbar-title">{title}</strong>
      <span className="navbar-spacer" aria-hidden="true" />
    </header>
  );
}

/** Segmentbesturing (HIG: segmented control) voor een kleine, gelijkwaardige keuze binnen één scherm. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Rij in een lijst: het type ("Voorstel" of "Ontheffing") staat er altijd duidelijk bij, zodat beide soorten in één lijst te onderscheiden zijn. */
export function ListItem({ to, name, kind, subtitle, status, tone = "ok" }: { to: string; name: string; kind: "Voorstel" | "Ontheffing"; subtitle?: string; status: string; tone?: "neutral" | "ok" | "warn" | "bad" }) {
  return (
    <Link to={to} className="glass panel">
      <div className="row between">
        <div className="grow">
          <strong>{name}</strong>
          <div className="row" style={{ flexWrap: "wrap", gap: "var(--space-2)", marginTop: 4 }}>
            <StatusLabel tone={kind === "Ontheffing" ? "warn" : "neutral"}>{kind}</StatusLabel>
            {subtitle && <span className="muted">{subtitle}</span>}
          </div>
        </div>
        <StatusLabel tone={tone}>{status}</StatusLabel>
      </div>
    </Link>
  );
}

export function CallingLink({ id, name, title, status, mine }: { id: string; name: string; title: string; status: string; mine?: boolean }) {
  return <ListItem to={`/roepingen/${id}`} name={name} kind="Voorstel" subtitle={title} status={mine ? "Jouw reactie" : status} tone={mine ? "warn" : "ok"} />;
}

/** Ontheffing in een lijst; het pad volgt uit de status (een concept opent het formulier). */
export function OntheffingLink({ o }: { o: { id: string; status: string; personName: string | null; functionName: string | null; unitName?: string | null; statusLabel: string; needsMyVote?: boolean; needsReview?: boolean } }) {
  const action = o.needsMyVote ? "Jouw reactie" : o.needsReview ? "Beoordeling nodig" : null;
  return (
    <ListItem
      to={o.status === "CONCEPT" ? `/ontheffingen/concept/${o.id}` : `/ontheffingen/${o.id}`}
      name={o.personName ?? "(nog geen naam)"}
      kind="Ontheffing"
      subtitle={`${o.functionName ?? "Nog geen roeping gekozen"}${o.unitName ? ` · ${o.unitName}` : ""}`}
      status={action ?? o.statusLabel}
      tone={action ? "warn" : "neutral"}
    />
  );
}

/** Eén statuslabel voor alle statussen (neutraal, ok, waarschuwing of fout). Kleur is nooit het enige signaal: de tekst zegt altijd de status. */
export function StatusLabel({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad"; children: React.ReactNode }) {
  return <span className={`status${tone === "neutral" ? "" : ` ${tone}`}`}>{children}</span>;
}

/** Paginakop: titel (en ondertitel) links, directe actie rechts (⋯ of een hoofdknop). Zo staan acties nooit onderaan een lange pagina. */
export function PageHead({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {subtitle && <span className="muted">{subtitle}</span>}
      </div>
      {action}
    </div>
  );
}
