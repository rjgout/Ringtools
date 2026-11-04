import { Link, NavLink } from "react-router-dom";
import { ApiRequestError } from "../lib/api";

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

export function TabBar({ unread, pending, canManageUsers = false }: { unread: number; pending: number; canManageUsers?: boolean }) {
  const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? " active" : ""}`;
  return (
    <nav className="tabbar" aria-label="Hoofdnavigatie">
      <NavLink to="/" end className={tab}>
        Overzicht
        {pending > 0 && <span className="dot" aria-label={`${pending} wachten op jou`}>{pending}</span>}
      </NavLink>
      <NavLink to="/voorstellen" className={tab}>
        Voorstellen
      </NavLink>
      {canManageUsers && (
        <NavLink to="/gebruikers" className={tab}>
          Gebruikers
        </NavLink>
      )}
      <NavLink to="/meldingen" className={tab}>
        Meldingen
        {unread > 0 && <span className="dot" aria-label={`${unread} ongelezen`}>{unread}</span>}
      </NavLink>
      <NavLink to="/profiel" className={tab}>
        Profiel
      </NavLink>
    </nav>
  );
}

export function CallingLink({ id, name, title, status, mine }: { id: string; name: string; title: string; status: string; mine?: boolean }) {
  return (
    <Link to={`/roepingen/${id}`} className="glass panel">
      <div className="row between">
        <div className="grow">
          <strong>{name}</strong>
          <div className="muted">{title}</div>
        </div>
        {mine ? <span className="badge">Jouw reactie</span> : <span className="badge ok">{status}</span>}
      </div>
    </Link>
  );
}
