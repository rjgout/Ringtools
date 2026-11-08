import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../lib/api";
import { TAB_ROOT, tabForPath, type TabId } from "../lib/navigation";

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

/**
 * Hoofdnavigatie (HIG: maximaal vijf tabs, icoon + label). Ringbeheerders krijgen één extra tab "Beheer" (gebruikers en inrichting
 * zitten daarin als segmenten) in plaats van twee losse tabs; zo blijft de balk op elk scherm passen.
 * Opnieuw tikken op de actieve tab brengt je terug naar de bovenkant van het hoofdscherm.
 */
export function TabBar({ unread, pending, canManageUsers = false }: { unread: number; pending: number; canManageUsers?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = tabForPath(location.pathname);
  const tabs: { id: TabId; label: string; badge?: number; badgeLabel?: string }[] = [
    { id: "overzicht", label: "Overzicht", badge: pending, badgeLabel: `${pending} wachten op jou` },
    { id: "voorstellen", label: "Voorstellen" },
    ...(canManageUsers ? [{ id: "beheer" as TabId, label: "Beheer" }] : []),
    { id: "meldingen", label: "Meldingen", badge: unread, badgeLabel: `${unread} ongelezen` },
    { id: "profiel", label: "Profiel" },
  ];
  const press = (id: TabId) => (e: React.MouseEvent) => {
    e.preventDefault();
    const root = TAB_ROOT[id];
    if (active === id && location.pathname === root) {
      document.querySelector("main.page")?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigate(root);
  };
  return (
    <nav className="tabbar" aria-label="Hoofdnavigatie">
      {tabs.map((t) => (
        <a key={t.id} href={`#${TAB_ROOT[t.id]}`} className={`tab${active === t.id ? " active" : ""}`} aria-current={active === t.id ? "page" : undefined} onClick={press(t.id)}>
          <span className="tab-icon-wrap">
            <TabIcon tab={t.id} />
            {!!t.badge && t.badge > 0 && <span className="dot" aria-label={t.badgeLabel}>{t.badge > 99 ? "99+" : t.badge}</span>}
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
