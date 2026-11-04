import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import type { CallingDetail as Detail, TaskKey, TaskView } from "@shared/api-types";
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
            {data.unit && <div className="muted">{data.unit.kind === "GEMEENTE" ? "Gemeente" : "Wijk"} {data.unit.name}</div>}
            {data.function?.needsReview && (
              <div className="badge bad" role="note" style={{ whiteSpace: "normal", borderRadius: 12, marginTop: 6 }}>
                Menselijke controle nodig: voor deze {data.function.source === "EIGEN" ? "eigen " : ""}roeping zijn de bevoegdheden niet geverifieerd{data.function.procedureConfirmed ? "; de bevoegde leiding heeft de procedure als gecontroleerd bevestigd" : ""}.
              </div>
            )}
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
          {data.awaitingRelease && (
            <section className="glass card stack" aria-label="Vrijgave">
              <strong>Presidium akkoord – wacht op vrijgave aan de hoge raad</strong>
              <span className="muted">De hoge raad ontvangt pas een verzoek nadat een bevoegde gebruiker het voorstel expliciet vrijgeeft.</span>
              {data.canRelease && (
                <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.release(id), (r) => (r.alreadyReleased ? "Dit voorstel was al vrijgegeven." : "Het voorstel is vrijgegeven aan de hoge raad."))}>
                  Vrijgeven aan de hoge raad
                </button>
              )}
            </section>
          )}
          {data.me.isStaff && (["PRESIDIUM", "HOGERAAD"] as const).filter((st) => data.canRegisterGroupDecision?.[st]).map((st) => (
            <GroupDecisionForm key={st} stage={st} detail={data} busy={busy}
              onSubmit={(input) => act(() => api.groupDecision(id, { stage: st, ...input }), "Het gezamenlijke besluit is vastgelegd.")} />
          ))}
          {(data.groupDecisions ?? []).map((d) => (
            <section key={d.stage} className="glass card stack" aria-label={`Gezamenlijk besluit ${d.stage === "PRESIDIUM" ? "presidium" : "hoge raad"}`}>
              <strong>Gezamenlijk besluit {d.stage === "PRESIDIUM" ? "ringpresidium" : "hoge raad"} (vergadering)</strong>
              <span className="muted">Besloten op {d.decidedOn}; geregistreerd door {d.registeredBy}.</span>
              {d.presiding && <span>Voorzitter: {d.presiding}</span>}
              {d.present.length > 0 && <span>Aanwezig: {d.present.join(", ")}</span>}
              {d.absent.length > 0 && <span>Afwezig (geen ondersteuning geregistreerd): {d.absent.join(", ")}</span>}
              {d.overrodeNegativeVotes && <span className="badge">Negatieve reactie afgehandeld: {d.resolutionNote}</span>}
              {d.note && <span className="muted">{d.note}</span>}
            </section>
          ))}
          {data.tasks.length > 0 && (
            <section className="glass card stack" aria-label="Taken">
              <strong>Taken</strong>
              {data.tasks.map((t) => (
                <TaskRow key={t.task} task={t} busy={busy}
                  users={t.task === "ONDERSTEUNEN" || !data.eligibleAssignees || data.eligibleAssignees[t.task as "ROEPEN" | "AANSTELLEN"] === null
                    ? data.assignableUsers
                    : data.assignableUsers.filter((u) => data.eligibleAssignees[t.task as "ROEPEN" | "AANSTELLEN"]!.includes(u.id))}
                  restricted={t.task !== "ONDERSTEUNEN" && !!data.eligibleAssignees && data.eligibleAssignees[t.task as "ROEPEN" | "AANSTELLEN"] !== null}
                  onAssign={(assigneeId) => act(() => api.assignTask(id, t.task, assigneeId), "Verantwoordelijke bijgewerkt.")}
                  onExternal={(name) => act(() => api.assignTask(id, t.task, null, name), "Externe bevoegde persoon geregistreerd.")}
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

function TaskRow({ task, users, busy, restricted = false, onAssign, onExternal, onComplete }: {
  task: TaskView;
  users: { id: string; name: string }[];
  busy: boolean;
  restricted?: boolean;
  onAssign: (assigneeId: string | null) => void;
  onExternal?: (name: string) => void;
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
        <span className="muted">Verantwoordelijke: {task.assignee?.name ?? task.assigneeExternalName ?? "niet toegewezen"}</span>
      )}
      {task.canAssign && !task.doneAt && restricted && (
        <ExternalPerson current={task.assigneeExternalName} busy={busy} onSave={(n) => onExternal?.(n)} id={task.task} hint={users.length === 0 ? "Er is niemand aangewezen die dit voor deze functie mag; registreer zo nodig een bevoegde externe persoon." : "Alleen aangewezen bevoegde personen zijn te kiezen."} />
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

function GroupDecisionForm({ stage, detail, busy, onSubmit }: {
  stage: "PRESIDIUM" | "HOGERAAD";
  detail: Detail;
  busy: boolean;
  onSubmit: (input: { decidedOn: string; agreed: boolean; note?: string; presidingUserId?: string; presentUserIds?: string[]; absentUserIds?: string[]; resolveNegative?: boolean; resolutionNote?: string; releaseNow?: boolean }) => void;
}) {
  const round = detail.rounds.find((r) => r.stage === stage);
  const hasNegative = !!round?.participants.some((p) => p.support === false);
  const [open, setOpen] = useState(false);
  const [decidedOn, setDecidedOn] = useState(new Date().toISOString().slice(0, 10));
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState("");
  const [presiding, setPresiding] = useState("");
  const [present, setPresent] = useState<string[]>([]);
  const [absent, setAbsent] = useState<string[]>([]);
  const [resolveNegative, setResolveNegative] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [releaseNow, setReleaseNow] = useState(false);
  const label = stage === "PRESIDIUM" ? "ringpresidium" : "hoge raad";
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)}>Gezamenlijk akkoord {label} registreren (vergadering)</button>;
  const members = round?.participants ?? [];
  const valid = agreed && decidedOn && (!hasNegative || (resolveNegative && resolutionNote.trim().length >= 10)) && present.length > 0 && (stage === "PRESIDIUM" || !!presiding);
  return (
    <form className="glass card stack" aria-label={`Gezamenlijk akkoord ${label}`} onSubmit={(e) => {
      e.preventDefault();
      onSubmit({
        decidedOn, agreed, note: note || undefined, resolveNegative: hasNegative ? resolveNegative : undefined, resolutionNote: hasNegative ? resolutionNote : undefined,
        ...(stage === "HOGERAAD" ? { presidingUserId: presiding, presentUserIds: present, absentUserIds: absent } : { presentUserIds: present, releaseNow }),
      });
    }}>
      <strong>Gezamenlijk akkoord {label}</strong>
      <span className="muted">Registreer alleen een besluit dat daadwerkelijk in een vergadering is genomen. Er worden geen reacties namens anderen vastgelegd; afwezigheid geldt nooit als ondersteuning.</span>
      <div><label htmlFor={`gd-date-${stage}`}>Datum van het besluit</label><input id={`gd-date-${stage}`} type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} required /></div>
      {stage === "PRESIDIUM" && (
        <fieldset className="stack"><legend>Leden van het ringpresidium die het besluit hebben genomen</legend>
          {detail.assignableUsers.filter((u) => u.role === "RINGPRESIDIUM").map((u) => <label key={u.id} className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={present.includes(u.id)} onChange={() => toggle(present, setPresent, u.id)} /> {u.name}</label>)}
          <span className="muted">Een secretaris of administrateur legt alleen vast wat het presidium heeft besloten en neemt dit besluit niet zelf.</span>
        </fieldset>
      )}
      {stage === "HOGERAAD" && (
        <>
          <div>
            <label htmlFor="gd-presiding">Voorzitter (lid van het ringpresidium)</label>
            <select id="gd-presiding" value={presiding} onChange={(e) => setPresiding(e.target.value)} required>
              <option value="">Kies…</option>
              {detail.assignableUsers.filter((u) => u.role === "RINGPRESIDIUM").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <fieldset className="stack"><legend>Aanwezig</legend>
            {members.map((m) => <label key={m.userId} className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={present.includes(m.userId)} disabled={absent.includes(m.userId)} onChange={() => toggle(present, setPresent, m.userId)} /> {m.name}</label>)}
          </fieldset>
          <fieldset className="stack"><legend>Afwezig</legend>
            {members.map((m) => <label key={m.userId} className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={absent.includes(m.userId)} disabled={present.includes(m.userId)} onChange={() => toggle(absent, setAbsent, m.userId)} /> {m.name}</label>)}
          </fieldset>
        </>
      )}
      <div><label htmlFor={`gd-note-${stage}`}>Korte toelichting (optioneel)</label><input id={`gd-note-${stage}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
      {hasNegative && (
        <fieldset className="stack"><legend>Er is een negatieve reactie</legend>
          <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={resolveNegative} onChange={(e) => setResolveNegative(e.target.checked)} /> De negatieve reactie is in de vergadering afgehandeld (de reactie zelf blijft bewaard)</label>
          <div><label htmlFor={`gd-res-${stage}`}>Hoe is dit afgehandeld? (minimaal 10 tekens, geen gevoelige details)</label><input id={`gd-res-${stage}`} value={resolutionNote} maxLength={500} onChange={(e) => setResolutionNote(e.target.value)} /></div>
        </fieldset>
      )}
      <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> Het {label} heeft dit voorstel in de vergadering akkoord bevonden</label>
      {stage === "PRESIDIUM" && <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={releaseNow} onChange={(e) => setReleaseNow(e.target.checked)} /> Direct vrijgeven aan de hoge raad</label>}
      <div className="row"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annuleren</button><button className="btn btn-primary" disabled={busy || !valid}>Besluit vastleggen</button></div>
    </form>
  );
}

function ExternalPerson({ id, current, busy, hint, onSave }: { id: string; current: string | null; busy: boolean; hint: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(current ?? "");
  return (
    <div className="stack">
      <span className="muted">{hint}</span>
      <label htmlFor={`ext-${id}`}>Bevoegde externe persoon (handmatig)</label>
      <input id={`ext-${id}`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn btn-ghost" disabled={busy || name.trim().length < 2} onClick={() => onSave(name.trim())}>Externe persoon registreren</button>
    </div>
  );
}
