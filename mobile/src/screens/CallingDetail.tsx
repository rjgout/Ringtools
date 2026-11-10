import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import type { CallingDetail as Detail, TaskKey, TaskView } from "@shared/api-types";
import { ErrorState, PageHead, Spinner, StatusLabel } from "../components/ui";
import { ActionMenu, MENU_ICONS } from "../components/Menu";
import { Sheet, useConfirm } from "../components/Dialog";

export function CallingDetail() {
  const { id = "" } = useParams();
  const { api, ring, selectRing } = useAuth();
  const activeRingId = ring?.id;
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.calling(id), [id]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // synchroon slot: een tweede tik vóór de volgende render start geen tweede verzoek
  const [message, setMessage] = useState<string | null>(null);

  // Het voorstel hoort bij een bepaalde ring: de server bepaalt dat, de app volgt (bijv. na een e-maillink).
  // Bewust in een effect (niet tijdens het renderen) en alleen als de ring daadwerkelijk anders is.
  const ringId = data?.ring.id;
  useEffect(() => {
    if (ringId && ringId !== activeRingId) void selectRing(ringId);
  }, [ringId, activeRingId, selectRing]);

  const confirm = useConfirm();

  /** Voert een beheeractie uit, ververst het voorstel en toont de uitkomst. De server beslist over de bevoegdheid. */
  async function act<T>(run: () => Promise<T>, done: string | ((result: T) => string)) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await run();
      await reload();
      setMessage(typeof done === "function" ? done(result) : done);
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function vote(support: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await api.vote(id, support);
      await reload();
      setMessage(support ? "Je ondersteuning is vastgelegd." : "Je reactie is vastgelegd.");
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function deleteCalling() {
    const ok = await confirm({
      title: "Voorstel verwijderen?",
      message: "Dit verwijdert het voorstel en alle bijbehorende gegevens definitief.",
      detail: "Deze actie kan niet ongedaan worden gemaakt.",
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await api.deleteCalling(id, true); navigate("/voorstellen", { replace: true }); }
    catch (err) { setMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis."); inFlight.current = false; setBusy(false); }
  }

  async function removeFromRound(userId: string, name: string) {
    const ok = await confirm({
      title: `${name} uit de ronde halen?`,
      message: `${name} hoeft niet meer te reageren en telt niet meer mee in deze ronde. Een eerdere reactie blijft bewaard.`,
      confirmLabel: "Uit ronde halen",
      danger: true,
    });
    if (ok) await act(() => api.removeParticipant(id, userId), `${name} is uit de ronde gehaald.`);
  }

  return (
    <div className="stack">
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <PageHead
            title={data.personName}
            subtitle={`${data.functionTitle} · ${data.ring.name}`}
            action={data.me.isStaff && data.canDelete ? (
              <ActionMenu label="Acties voor dit voorstel" items={[{ id: "delete", label: "Voorstel verwijderen…", icon: MENU_ICONS.trash, danger: true, onSelect: () => void deleteCalling() }]} disabled={busy} />
            ) : undefined}
          />
          <div>
            <div><StatusLabel tone="ok">{data.phase}</StatusLabel></div>
            {data.unit && <div className="muted">{data.unit.kind === "GEMEENTE" ? "Gemeente" : "Wijk"} {data.unit.name}</div>}
            {data.function?.needsReview && (
              <div className="note bad mt-1" role="note">
                Menselijke controle nodig: voor deze {data.function.source === "EIGEN" ? "eigen " : ""}roeping zijn de bevoegdheden niet geverifieerd{data.function.procedureConfirmed ? "; de bevoegde leiding heeft de procedure als gecontroleerd bevestigd" : ""}.
              </div>
            )}
          </div>
          {message && <div role="status" className="glass panel">{message}</div>}
          {data.me.isStaff && data.readyToProcess && (
            <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.markProcessed(id), "Het voorstel is administratief verwerkt.")}>Administratief verwerkt</button>
          )}
          {data.rounds.map((r) => (
            <section key={r.stage} className="glass card stack" aria-label={r.title}>
              <div className="row between"><strong>{r.title}</strong><StatusLabel tone={r.state === "done" ? "ok" : r.state === "paused" ? "warn" : "neutral"}>{r.state === "open" ? "Open" : r.state === "paused" ? "Gepauzeerd" : r.state === "done" ? "Afgerond" : "Nog niet gestart"}</StatusLabel></div>
              {r.canRespond && (
                <>
                  <span className="muted">{r.myResponse === null ? "Ondersteun je dit voorstel?" : r.myResponse ? "Je ondersteunt dit voorstel." : "Je ondersteunt dit voorstel niet."}</span>
                  <div className="row">
                    <button className="btn btn-success" disabled={busy} onClick={() => vote(true)}>Ondersteunen</button>
                    <button className="btn btn-danger" disabled={busy} onClick={() => vote(false)}>Niet ondersteunen</button>
                  </div>
                </>
              )}
              {data.me.isStaff && r.state !== "upcoming" && r.participants.some((p) => p.support === null && !p.meeting && p.stillInvolved) && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.remind(id), (res) => `${res.sent} herinnering(en) verstuurd${res.skippedRecent ? `, ${res.skippedRecent} recent al herinnerd` : ""}.`)}>Iedereen herinneren die nog niet heeft gereageerd</button>
              )}
              {data.me.isStaff && data.canRegisterGroupDecision?.[r.stage] && (
                <GroupDecisionForm stage={r.stage} detail={data} busy={busy}
                  onSubmit={(input) => act(() => api.groupDecision(id, { stage: r.stage, ...input }), "Het gezamenlijke besluit is vastgelegd.")} />
              )}
              {data.me.isStaff && r.participants.map((p) => (
                <div key={p.userId} className="stack">
                  <div className="row between">
                    <div className="grow">{p.name}{!p.stillInvolved ? " (niet meer betrokken)" : ""}</div>
                    <StatusLabel tone={p.support === true || (p.support === null && p.meeting === "AKKOORD") ? "ok" : p.support === false ? "bad" : "neutral"}>{participantLabel(p)}</StatusLabel>
                    {p.stillInvolved && r.state !== "done" && r.state !== "upcoming" && (
                      <ActionMenu label={`Acties voor ${p.name}`} disabled={busy} items={[
                        { id: "remind", label: "Herinner", icon: MENU_ICONS.remind, hidden: !(p.support === null && !p.meeting), onSelect: () => void act(() => api.remind(id, p.userId), `${p.name} is herinnerd.`) },
                        { id: "reinvite", label: "Opnieuw vragen", icon: MENU_ICONS.undo, hidden: p.support !== false, onSelect: () => void act(() => api.reinvite(id, p.userId), `${p.name} is opnieuw om ondersteuning gevraagd.`) },
                        { id: "remove", label: "Uit ronde halen…", icon: MENU_ICONS.ban, danger: true, onSelect: () => void removeFromRound(p.userId, p.name) },
                      ]} />
                    )}
                  </div>
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
          {data.canReleaseExecution && <section className="glass card stack" aria-label="Vrijgave voor uitvoering">
            <strong>Definitief goedgekeurd – wacht op vrijgave voor uitvoering</strong>
            <span className="muted">De vooraf aangewezen uitvoerders krijgen pas toegang en een generieke melding nadat je de uitvoering vrijgeeft.</span>
            <button className="btn btn-primary" disabled={busy} onClick={() => void (async () => {
              if (await confirm({ title: "Uitvoering vrijgeven?", message: "De roeping is definitief goedgekeurd. Open toegewezen taken worden nu zichtbaar voor de uitvoerders en zij ontvangen een generieke melding.", confirmLabel: "Vrijgeven voor uitvoering" })) await act(() => api.releaseExecution(id), "De uitvoering is vrijgegeven.");
            })()}>Vrijgeven voor uitvoering</button>
          </section>}
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
                  users={t.task === "ONDERSTEUNEN"
                    ? data.assignableUsers.filter((u) => u.role !== "RINGSECRETARIS" && u.role !== "RINGADMINISTRATEUR") // zij voeren in, maar begeleiden de steunverlening niet
                    : !data.eligibleAssignees || data.eligibleAssignees[t.task as "ROEPEN" | "AANSTELLEN"] === null
                    ? data.assignableUsers
                    : data.assignableUsers.filter((u) => data.eligibleAssignees[t.task as "ROEPEN" | "AANSTELLEN"]!.includes(u.id))}
                  restricted={t.task !== "ONDERSTEUNEN" && !!data.eligibleAssignees && data.eligibleAssignees[t.task as "ROEPEN" | "AANSTELLEN"] !== null}
                  onAssign={(assigneeId) => act(() => api.assignTask(id, t.task, assigneeId), "Verantwoordelijke bijgewerkt.")}
                  onComplete={(opts) => act(() => api.completeTask(id, t.task, opts), "Taak geregistreerd.")} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TaskRow({ task, users, busy, restricted = false, onAssign, onComplete }: {
  task: TaskView;
  users: { id: string; name: string }[];
  busy: boolean;
  restricted?: boolean;
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
        <StatusLabel tone={task.doneAt ? "ok" : "neutral"}>{task.doneAt ? `Gedaan${task.doneBy ? ` door ${task.doneBy}` : ""}` : "Open"}</StatusLabel>
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
      {task.canAssign && !task.doneAt && restricted && users.length === 0 && <span className="muted">Er is nog niemand bevoegd aangewezen voor deze functie.</span>}
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
  onSubmit: (input: { decidedOn: string; agreed: boolean; note?: string; presidingUserId?: string; presentUserIds?: string[]; absentUserIds?: string[]; resolveNegative?: boolean; resolutionNote?: string }) => void;
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
  const label = stage === "PRESIDIUM" ? "ringpresidium" : "hoge raad";
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)}>Gezamenlijk akkoord {label} registreren (vergadering)</button>;
  const members = round?.participants ?? [];
  const close = () => setOpen(false);
  const valid = agreed && decidedOn && (!hasNegative || (resolveNegative && resolutionNote.trim().length >= 10)) && present.length > 0 && (stage === "PRESIDIUM" || !!presiding);
  return (
    <Sheet title={`Gezamenlijk akkoord ${label}`} onClose={close}>
    <form className="stack" aria-label={`Gezamenlijk akkoord ${label}`} onSubmit={(e) => {
      e.preventDefault();
      close(); // de uitkomst (of fout) verschijnt bovenaan de pagina; de ingevulde gegevens blijven bewaard
      onSubmit({
        decidedOn, agreed, note: note || undefined, resolveNegative: hasNegative ? resolveNegative : undefined, resolutionNote: hasNegative ? resolutionNote : undefined,
        ...(stage === "HOGERAAD" ? { presidingUserId: presiding, presentUserIds: present, absentUserIds: absent } : { presentUserIds: present }),
      });
    }}>
      <span className="muted">Registreer alleen een besluit dat daadwerkelijk in een vergadering is genomen. Er worden geen reacties namens anderen vastgelegd; afwezigheid geldt nooit als ondersteuning.</span>
      <div><label htmlFor={`gd-date-${stage}`}>Datum van het besluit</label><input id={`gd-date-${stage}`} type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} required /></div>
      {stage === "PRESIDIUM" && (
        <fieldset className="stack"><legend>Leden van het ringpresidium die het besluit hebben genomen</legend>
          {detail.assignableUsers.filter((u) => u.role === "RINGPRESIDIUM").map((u) => <label key={u.id} className="row"><input type="checkbox" checked={present.includes(u.id)} onChange={() => toggle(present, setPresent, u.id)} /> {u.name}</label>)}
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
            {members.map((m) => <label key={m.userId} className="row"><input type="checkbox" checked={present.includes(m.userId)} disabled={absent.includes(m.userId)} onChange={() => toggle(present, setPresent, m.userId)} /> {m.name}</label>)}
          </fieldset>
          <fieldset className="stack"><legend>Afwezig</legend>
            {members.map((m) => <label key={m.userId} className="row"><input type="checkbox" checked={absent.includes(m.userId)} disabled={present.includes(m.userId)} onChange={() => toggle(absent, setAbsent, m.userId)} /> {m.name}</label>)}
          </fieldset>
        </>
      )}
      <div><label htmlFor={`gd-note-${stage}`}>Korte toelichting (optioneel)</label><input id={`gd-note-${stage}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
      {hasNegative && (
        <fieldset className="stack"><legend>Er is een negatieve reactie</legend>
          <label className="row"><input type="checkbox" checked={resolveNegative} onChange={(e) => setResolveNegative(e.target.checked)} /> De negatieve reactie is in de vergadering afgehandeld (de reactie zelf blijft bewaard)</label>
          <div><label htmlFor={`gd-res-${stage}`}>Hoe is dit afgehandeld? (minimaal 10 tekens, geen gevoelige details)</label><input id={`gd-res-${stage}`} value={resolutionNote} maxLength={500} onChange={(e) => setResolutionNote(e.target.value)} /></div>
        </fieldset>
      )}
      <label className="row"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> Het {label} heeft dit voorstel in de vergadering akkoord bevonden</label>
      {stage === "PRESIDIUM" && <span className="muted">Na het vastleggen wacht het voorstel op een aparte, expliciete vrijgave aan de hoge raad.</span>}
      <div className="row"><button type="button" className="btn btn-ghost" onClick={close}>Annuleren</button><button className="btn btn-primary" disabled={busy || !valid}>Besluit vastleggen</button></div>
    </form>
    </Sheet>
  );
}

/** Status van een deelnemer: eigen reactie, anders de uitkomst van een gezamenlijk besluit in een vergadering (telt niet als stem), anders nog niet gereageerd. */
export function participantLabel(p: { support: boolean | null; meeting?: "AKKOORD" | "AFWEZIG" | null }): string {
  if (p.support === true) return "Ondersteunt";
  if (p.support === false) return "Niet";
  if (p.meeting === "AKKOORD") return "Akkoord in vergadering";
  if (p.meeting === "AFWEZIG") return "Afwezig bij vergadering";
  return "Nog niet";
}
