import { useState } from "react";
import type { AdminRing, Role, UserSearchHit } from "@shared/api-types";
import { useAuth } from "../../lib/auth";
import { useLoad } from "../../lib/useLoad";
import { ApiRequestError } from "../../lib/api";
import { useReauth } from "../../components/Reauth";
import { ErrorState, Spinner } from "../../components/ui";
import { UserManager } from "../UserManager";

const ROLES: { value: Role; label: string }[] = [
  { value: "RINGPRESIDIUM", label: "Ringpresidium" },
  { value: "RINGSECRETARIS", label: "Ringsecretaris" },
  { value: "RINGADMINISTRATEUR", label: "Ringadministrateur" },
  { value: "HOGERAAD", label: "Hoge raad" },
];

/** Systeembeheer voor de webmin: alle ringen bekijken, aanmaken, wijzigen, (de)activeren en gebruikers beheren. */
export function AdminHome() {
  const { api, me, signOut } = useAuth();
  const rings = useLoad(() => api.adminRings(), []);
  const sessions = useLoad(() => api.sessions(), []);
  const { run, dialog } = useReauth();
  const [selected, setSelected] = useState<AdminRing | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await run(fn);
      await rings.reload();
      setMessage(done);
    } catch (err) {
      if (!(err instanceof ApiRequestError && err.code === "cancelled")) setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    }
  }

  if (selected) {
    const current = rings.data?.rings.find((r) => r.id === selected.id) ?? selected;
    return (
      <main className="page stack">
        {dialog}
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSelected(null)}>‹ Alle ringen</button>
        <RingEditor ring={current} onRename={(name) => act(() => api.adminRenameRing(current.id, name), "Naam opgeslagen.")}
          onActive={(active) => act(() => api.adminSetRingActive(current.id, active), active ? "Ring geactiveerd." : "Ring gedeactiveerd: leden hebben geen toegang meer.")} />
        {message && <div role="status" className="glass panel">{message}</div>}
        <UserManager ringId={current.id} />
      </main>
    );
  }

  return (
    <main className="page stack">
      {dialog}
      <div><h1>Systeembeheer</h1><span className="muted">Ingelogd als {me?.user.name}</span></div>
      <div className="row between"><h2>Ringen</h2><button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>{creating ? "Sluiten" : "Nieuwe ring"}</button></div>
      {creating && <NewRing onCreate={(input) => act(async () => { await api.adminCreateRing(input); setCreating(false); }, "Ring aangemaakt.")} />}
      {rings.loading && !rings.data && <Spinner />}
      {rings.error && <ErrorState error={rings.error} onRetry={rings.reload} />}
      {message && <div role="status" className="glass panel">{message}</div>}
      {rings.data?.rings.map((r) => (
        <button key={r.id} className="glass panel" onClick={() => setSelected(r)} aria-label={`Beheer ${r.name}`}>
          <div className="row between">
            <div className="grow" style={{ textAlign: "left" }}><strong>{r.name}</strong><div className="muted">{r.memberCount} leden · {r.callingCount} voorstellen · {r.managers.join(", ") || "geen beheerder"}</div></div>
            <span className={`badge ${r.active ? "ok" : "bad"}`}>{r.active ? "Actief" : "Inactief"}</span>
          </div>
        </button>
      ))}

      <section className="glass card stack">
        <h2>Aangemelde toestellen</h2>
        {sessions.data?.sessions.map((s) => (
          <div key={s.id} className="row between">
            <span className="grow">{s.device}{s.current ? " (dit toestel)" : ""}</span>
            {!s.current && <button className="btn btn-ghost" onClick={async () => { await api.revokeSession(s.id); await sessions.reload(); }}>Intrekken</button>}
          </div>
        ))}
      </section>
      <button className="btn btn-ghost btn-block" onClick={() => void signOut()}>Uitloggen</button>
    </main>
  );
}

function RingEditor({ ring, onRename, onActive }: { ring: AdminRing; onRename: (name: string) => void; onActive: (active: boolean) => void }) {
  const [name, setName] = useState(ring.name);
  return (
    <section className="glass card stack">
      <h1>{ring.name}</h1>
      <div><label htmlFor="ring-name">Naam van de ring</label><input id="ring-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} /></div>
      <div className="row">
        <button className="btn btn-primary" disabled={name.trim() === ring.name || name.trim().length < 2} onClick={() => onRename(name.trim())}>Naam opslaan</button>
        <button className={`btn ${ring.active ? "btn-danger" : "btn-success"}`} onClick={() => onActive(!ring.active)}>{ring.active ? "Deactiveren" : "Activeren"}</button>
      </div>
      <span className="muted">Deactiveren verwijdert niets; leden hebben dan geen toegang meer tot deze ring tot je hem weer activeert.</span>
    </section>
  );
}

function NewRing({ onCreate }: { onCreate: (input: { name: string; existingUserId?: string; userName?: string; userEmail?: string; churchFunction: string; role: string }) => void }) {
  const { api } = useAuth();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserSearchHit[]>([]);
  const [chosen, setChosen] = useState<UserSearchHit | null>(null);
  const [churchFunction, setChurchFunction] = useState("");
  const [role, setRole] = useState<Role>("RINGPRESIDIUM");

  async function search(q: string) {
    setQuery(q);
    setChosen(null);
    if (q.trim().length < 2) return setHits([]);
    try { setHits((await api.adminSearchUsers(q.trim())).users); } catch { setHits([]); }
  }

  return (
    <form className="glass card stack" aria-label="Nieuwe ring" onSubmit={(e) => {
      e.preventDefault();
      onCreate({ name, churchFunction, role, ...(mode === "existing" ? { existingUserId: chosen!.id } : { userName, userEmail }) });
    }}>
      <strong>Nieuwe ring</strong>
      <div><label htmlFor="nr-name">Naam van de ring</label><input id="nr-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></div>
      <strong>Eerste ringbeheerder</strong>
      <div className="row">
        <button type="button" className={`btn ${mode === "new" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("new")}>Nieuw account</button>
        <button type="button" className={`btn ${mode === "existing" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("existing")}>Bestaand account</button>
      </div>
      {mode === "new" ? (
        <>
          <div><label htmlFor="nr-uname">Naam</label><input id="nr-uname" value={userName} onChange={(e) => setUserName(e.target.value)} required minLength={2} /></div>
          <div><label htmlFor="nr-uemail">E-mailadres</label><input id="nr-uemail" type="email" autoCapitalize="none" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} required /></div>
        </>
      ) : (
        <div>
          <label htmlFor="nr-search">Zoek op naam of e-mailadres</label>
          <input id="nr-search" value={query} onChange={(e) => void search(e.target.value)} />
          {hits.map((h) => <button type="button" key={h.id} className="glass panel" onClick={() => { setChosen(h); setHits([]); setQuery(`${h.name} (${h.email})`); }}>{h.name} · {h.email}</button>)}
        </div>
      )}
      <div><label htmlFor="nr-func">Kerkelijke functie</label><input id="nr-func" value={churchFunction} onChange={(e) => setChurchFunction(e.target.value)} required minLength={2} /></div>
      <div><label htmlFor="nr-role">Ringtools-rol</label><select id="nr-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
      <span className="muted">Deze persoon wordt direct ringbeheerder van de nieuwe ring.</span>
      <button className="btn btn-primary" disabled={mode === "existing" && !chosen}>Ring aanmaken</button>
    </form>
  );
}
