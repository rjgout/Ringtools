import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import type { TaskKey, TaskView } from "@shared/api-types";
import { ErrorState, Spinner } from "../components/ui";

export function CallingDetail() {
  const { id = "" } = useParams();
  const { api, ring, selectRing } = useAuth();
  const activeRingId = ring?.id;
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.calling(id), [id]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Het voorstel hoort bij een bepaalde ring: de server bepaalt dat, de app volgt (bijv. na een e-maillink).
  // Bewust in een effect (niet tijdens het renderen) en alleen als de ring daadwerkelijk anders is.
  const ringId = data?.ring.id;
  useEffect(() => {
    if (ringId && ringId !== activeRingId) void selectRing(ringId);
  }, [ringId, activeRingId, selectRing]);

  const [confirmDelete, setConfirmDelete] = useState(false);

  /** Voert een beheeractie uit, ververst het voorstel en toont de uitkomst. De server beslist over de bevoegdheid. */
  async function act<T>(run: () => Promise<T>, done: string | ((result: T) => string)) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await run();
      await reload();
      setMessage(typeof done === "function" ? done(result) : done);
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(support: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await api.vote(id, support);
      await reload();
      setMessage(support ? "Je ondersteuning is vastgelegd." : "Je reactie is vastgelegd.");
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => navigate(-1)}>
        ‹ Terug
      </button>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <div>
            <h1>{data.personName}</h1>
            <span className="muted">{data.functionTitle} · {data.ring.name}</span>
            <div><span className="badge ok">{data.phase}</span></div>
          </div>
          {data.rounds.map((r) => (
            <section key={r.stage} className="glass card stack" aria-label={r.title}>
              <div className="row between"><strong>{r.title}</strong><span className="badge">{r.state === "open" ? "Open" : r.state === "paused" ? "Gepauzeerd" : r.state === "done" ? "Afgerond" : "Nog niet gestart"}</span></div>
              {r.canRespond && (
                <>
                  <span className="muted">{r.myResponse === null ? "Ondersteun je dit voorstel?" : r.myResponse ? "Je ondersteunt dit voorstel." : "Je ondersteunt dit voorstel niet."}</span>
                  <div className="row">
                    <button className="btn btn-success" disabled={busy} onClick={() => vote(true)}>Ondersteunen</button>
                    <button className="btn btn-danger" disabled={busy} onClick={() => vote(false)}>Niet ondersteunen</button>
                  </div>
                </>
              )}
              {data.me.isStaff && r.state !== "upcoming" && r.participants.some((p) => p.support === null && p.stillInvolved) && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.remind(id), (res) => `${res.sent} herinnering(en) verstuurd${res.skippedRecent ? `, ${res.skippedRecent} recent al herinnerd` : ""}.`)}>Iedereen herinneren die nog niet heeft gereageerd</button>
              )}
              {data.me.isStaff && r.participants.map((p) => (
                <div key={p.userId} className="stack">
                  <div className="row between">
                    <span>{p.name}{!p.stillInvolved ? " (niet meer betrokken)" : ""}</span>
                    <span className={`badge ${p.support === true ? "ok" : p.support === false ? "bad" : ""}`}>{p.support === true ? "Ondersteunt" : p.support === false ? "Niet" : "Nog niet"}</span>
                  </div>
                  {p.stillInvolved && r.state !== "done" && r.state !== "upcoming" && (
                    <div className="row">
                      {p.support === null && <button className="btn btn-ghost" disabled={busy} aria-label={`Herinner ${p.name}`} onClick={() => act(() => api.remind(id, p.userId), `${p.name} is herinnerd.`)}>Herinner</button>}
                      {p.support === false && <button className="btn btn-ghost" disabled={busy} aria-label={`Vraag ${p.name} opnieuw`} onClick={() => act(() => api.reinvite(id, p.userId), `${p.name} is opnieuw om ondersteuning gevraagd.`)}>Opnieuw vragen</button>}
                      <button className="btn btn-ghost" disabled={busy} aria-label={`Verwijder ${p.name} uit de ronde`} onClick={() => act(() => api.removeParticipant(id, p.userId), `${p.name} is uit de ronde gehaald.`)}>Uit ronde</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
          {data.tasks.length > 0 && (
            <section className="glass card stack" aria-label="Taken">
              <strong>Taken</strong>
              {data.tasks.map((t) => (
                <TaskRow key={t.task} task={t} busy={busy} users={data.assignableUsers}
                  onAssign={(assigneeId) => act(() => api.assignTask(id, t.task, assigneeId), "Verantwoordelijke bijgewerkt.")}
                  onComplete={(opts) => act(() => api.completeTask(id, t.task, opts), "Taak geregistreerd.")} />
              ))}
            </section>
          )}
          {data.me.isStaff && (data.readyToProcess || data.canDelete) && (
            <section className="glass card stack" aria-label="Beheer">
              {data.readyToProcess && <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.markProcessed(id), "Het voorstel is administratief verwerkt.")}>Administratief verwerkt</button>}
              {data.canDelete && !confirmDelete && <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>Voorstel definitief verwijderen…</button>}
              {data.canDelete && confirmDelete && (
                <div className="stack" role="alertdialog" aria-label="Bevestig verwijderen">
                  <span>Dit verwijdert het voorstel en alle bijbehorende gegevens definitief. Dit kan niet ongedaan worden gemaakt.</span>
                  <div className="row">
                    <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Annuleren</button>
                    <button className="btn btn-danger" disabled={busy} onClick={async () => {
                      setBusy(true);
                      try { await api.deleteCalling(id, true); navigate("/voorstellen", { replace: true }); }
                      catch (err) { setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis."); setBusy(false); }
                    }}>Definitief verwijderen</button>
                  </div>
                </div>
              )}
            </section>
          )}
          {message && <div role="status" className="glass panel">{message}</div>}
        </>
      )}
    </div>
  );
}

function TaskRow({ task, users, busy, onAssign, onComplete }: {
  task: TaskView;
  users: { id: string; name: string }[];
  busy: boolean;
  onAssign: (assigneeId: string | null) => void;
  onComplete: (opts: { doneAt?: string; ondersteunenContext?: "AVONDMAALSVERGADERING" | "RINGCONFERENTIE" }) => void;
}) {
  const [context, setContext] = useState<"AVONDMAALSVERGADERING" | "RINGCONFERENTIE" | "">("");
  const [date, setDate] = useState("");
  const needsContext = (task.task as TaskKey) === "ONDERSTEUNEN";
  return (
    <div className="stack">
      <div className="row between">
        <strong>{task.label}</strong>
        <span className={`badge ${task.doneAt ? "ok" : ""}`}>{task.doneAt ? `Gedaan${task.doneBy ? ` door ${task.doneBy}` : ""}` : "Open"}</span>
      </div>
      {task.canAssign && !task.doneAt ? (
        <div>
          <label htmlFor={`as-${task.task}`}>Verantwoordelijke</label>
          <select id={`as-${task.task}`} value={task.assignee?.id ?? ""} disabled={busy} onChange={(e) => onAssign(e.target.value || null)}>
            <option value="">Niet toegewezen</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      ) : (
        <span className="muted">Verantwoordelijke: {task.assignee?.name ?? "niet toegewezen"}</span>
      )}
      {task.canComplete && !task.doneAt && (
        <>
          {needsContext && (
            <div>
              <label htmlFor="ctx">Waar is ondersteund?</label>
              <select id="ctx" value={context} onChange={(e) => setContext(e.target.value as typeof context)}>
                <option value="">Kies…</option>
                <option value="AVONDMAALSVERGADERING">Avondmaalsvergadering</option>
                <option value="RINGCONFERENTIE">Ringconferentie</option>
              </select>
            </div>
          )}
          <div><label htmlFor={`d-${task.task}`}>Datum (leeg = vandaag)</label><input id={`d-${task.task}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={busy || (needsContext && !context)}
            onClick={() => onComplete({ ...(date ? { doneAt: new Date(`${date}T12:00:00`).toISOString() } : {}), ...(needsContext && context ? { ondersteunenContext: context } : {}) })}>
            {task.label} registreren
          </button>
        </>
      )}
    </div>
  );
}
