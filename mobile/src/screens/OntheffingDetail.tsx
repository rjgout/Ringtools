import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { OntheffingPerson, OntheffingView } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { ErrorState, Spinner } from "../components/ui";

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("nl-NL") : null);
const today = () => new Date().toISOString().slice(0, 10);
const AUDIT_LABEL: Record<string, string> = {
  CONCEPT_CREATED: "Concept gemaakt", SUBMITTED: "Ingediend", GROUP_DECISION_PRESIDIUM: "Gezamenlijk besluit ringpresidium", GROUP_DECISION_HOGERAAD: "Gezamenlijk besluit hoge raad",
  HOGERAAD_RELEASED: "Vrijgegeven aan de hoge raad", PERSON_INFORMED: "Persoonlijk geïnformeerd", PERSON_ANNOUNCED: "Bekendmaking vastgelegd", PERSON_PROCESSED: "Administratief verwerkt",
  PERSON_RENAMED: "Naam gecorrigeerd", PROCESSED: "Dossier verwerkt",
};

export function OntheffingDetail() {
  const { id } = useParams();
  const { api, ring } = useAuth();
  const navigate = useNavigate();
  const { data: v, error, loading, reload } = useLoad(() => api.ontheffing(id!), [id]);
  const members = useLoad(() => (v?.viewer.staff ? api.ringMembers(ring!.id) : Promise.resolve(null)), [v?.viewer.staff, ring?.id]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMessage(null);
    try { await fn(); if (ok) setMessage(ok); await reload(); } catch (err) { setMessage(err instanceof ApiRequestError ? err.message : "Dit lukt nu niet."); } finally { setBusy(false); }
  }

  if (loading && !v) return <Spinner />;
  if (error && !v) return <ErrorState error={error} onRetry={reload} />;
  if (!v) return null;

  const named = v.persons.filter((p) => p.role === "HOOFD" || p.answer === "NAAM" || p.answer === undefined);
  const executing = v.viewer.staff && ["PRESIDIUM_APPROVED", "HOGERAAD_VOTING", "HOGERAAD_PAUSED", "APPROVED", "PROCESSED"].includes(v.status);

  return (
    <div className="stack">
      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => navigate("/ontheffingen")}>‹ Terug</button>
      <div>
        <h1>{named[0]?.name ?? "Ontheffing"}</h1>
        <span className="muted">{v.function?.name}{v.unit ? ` · ${v.unit.kind === "GEMEENTE" ? "Gemeente" : "Wijk"} ${v.unit.name}` : ""}</span>
        <div><strong>{v.statusLabel}</strong></div>
      </div>
      {v.function?.warning && <div className="muted" role="note">{v.function.warning}</div>}
      {message && <div role="status" className="glass panel">{message}</div>}

      <div className="glass card stack">
        <strong>{v.joint ? "Betrokkenen (gezamenlijke ontheffing)" : "Betrokkene"}</strong>
        {v.persons.map((p) => <PersonRow key={p.id} v={v} p={p} busy={busy} act={act} showExecution={executing} />)}
      </div>

      {v.viewer.canVote && (
        <div className="glass card stack">
          <strong>Jouw reactie</strong>
          <span className="muted">{v.viewer.myVote === null ? "Je hebt nog niet gereageerd." : v.viewer.myVote ? "Je ondersteunt deze ontheffing." : "Je ondersteunt deze ontheffing niet."}</span>
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.voteOntheffing(v.id, true), "Je reactie is vastgelegd.")}>Ik ondersteun</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.voteOntheffing(v.id, false), "Je reactie is vastgelegd.")}>Ik ondersteun niet</button>
          </div>
        </div>
      )}

      {v.viewer.staff && v.rounds && (
        <div className="glass card stack">
          <strong>Voortgang</strong>
          <div className="row between"><span>Ringpresidium</span><span>{v.rounds.presidium.responded}/{v.rounds.presidium.eligible} gereageerd{v.rounds.presidium.negative ? `, ${v.rounds.presidium.negative} negatief` : ""}</span></div>
          <div className="row between"><span>Hoge raad</span><span>{v.rounds.hogeraad.eligible ? `${v.rounds.hogeraad.responded}/${v.rounds.hogeraad.eligible} gereageerd${v.rounds.hogeraad.negative ? `, ${v.rounds.hogeraad.negative} negatief` : ""}` : "nog niet gestart"}</span></div>
          {v.decisions?.map((d) => <div key={d.stage} className="muted">Gezamenlijk besluit {d.stage === "PRESIDIUM" ? "ringpresidium" : "hoge raad"} op {fmt(d.decidedOn)}{d.overrodeNegativeVotes ? " (met afhandeling van negatieve reactie)" : ""}</div>)}
        </div>
      )}

      {v.viewer.canRelease && (
        <div className="glass card stack">
          <strong>Vrijgave aan de hoge raad</strong>
          <span className="muted">Het ringpresidium is akkoord. De hoge raad start pas na jouw expliciete vrijgave.</span>
          {v.blockers?.map((b) => <div key={b} className="error" role="alert">{b}</div>)}
          <button className="btn btn-primary" disabled={busy || !!v.blockers?.length} onClick={() => window.confirm("Vrijgeven aan de hoge raad?") && act(() => api.releaseOntheffing(v.id), "Vrijgegeven aan de hoge raad.")}>Vrijgeven aan de hoge raad</button>
        </div>
      )}

      {v.viewer.canDecide && v.stage && <DecisionForm v={v} members={members.data?.members ?? []} busy={busy} act={act} />}

      {v.viewer.staff && v.audit && v.audit.length > 0 && (
        <div className="glass card stack">
          <strong>Verloop</strong>
          {v.audit.map((a, i) => <div key={i} className="muted">{fmt(a.createdAt)} · {AUDIT_LABEL[a.type] ?? a.type} · {a.actor}{a.detail ? ` (${a.detail})` : ""}</div>)}
        </div>
      )}
      {v.retention && <div className="muted">Dit dossier wordt na {fmt(v.retention.deleteAfter)} automatisch verwijderd.</div>}
      {v.viewer.canDelete && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => window.confirm("Dit dossier definitief verwijderen?") && act(async () => { await api.deleteOntheffing(v.id); navigate("/ontheffingen", { replace: true }); })}>Dossier verwijderen</button>
      )}
    </div>
  );
}

function PersonRow({ v, p, busy, act, showExecution }: { v: OntheffingView; p: OntheffingPerson; busy: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; showExecution: boolean }) {
  const { api } = useAuth();
  const ex = p.execution ?? null;
  const na = p.answer === "NIET_VAN_TOEPASSING";
  const [thanked, setThanked] = useState(false);
  const approved = v.status === "APPROVED";
  return (
    <div className="glass panel stack">
      <div>
        <strong>{na ? "Niet van toepassing" : p.name ?? "(naam ontbreekt)"}</strong>
        <div className="muted">{p.functionName}</div>
        {na && <div className="muted">Reden: {p.naReason || "niet opgegeven"}</div>}
        {v.viewer.staff && !na && p.accountMode && <div className="muted">{p.accountMode === "GEKOPPELD" ? "Gekoppeld Ringtools-account (uitgesloten van dit dossier)" : "Geen Ringtools-account"}</div>}
      </div>
      {showExecution && ex && (
        <>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <li>{ex.informedAt ? `✓ Persoonlijk geïnformeerd (${fmt(ex.informedAt)})` : "○ Persoonlijk informeren"}</li>
            <li>{ex.announcedAt ? `✓ Bekendgemaakt (${fmt(ex.announcedAt)})${ex.thankedAt ? " · dankbetuiging geregistreerd" : ""}` : "○ Bekendmaking en dankbetuiging"}</li>
            <li>{ex.processedAt ? `✓ Administratief verwerkt (${fmt(ex.processedAt)})` : "○ Administratief verwerken"}</li>
          </ul>
          {!ex.informedAt && v.status !== "PROCESSED" && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.ontheffingStep(p.id, "inform"), "Vastgelegd.")}>Persoonlijk geïnformeerd registreren</button>
          )}
          {approved && ex.informedAt && !ex.announcedAt && (
            <div className="stack">
              <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={thanked} onChange={(e) => setThanked(e.target.checked)} /> Er is ook een dankbetuiging uitgesproken</label>
              <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.ontheffingStep(p.id, "announce", { thanked }), "Vastgelegd.")}>Bekendmaking registreren</button>
            </div>
          )}
          {approved && ex.announcedAt && !ex.thankedAt && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.ontheffingStep(p.id, "announce", { thanked: true }), "Vastgelegd.")}>Dankbetuiging alsnog registreren</button>
          )}
          {approved && ex.announcedAt && !ex.processedAt && (
            <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.ontheffingStep(p.id, "process"), "Verwerkt.")}>Administratief verwerkt</button>
          )}
        </>
      )}
    </div>
  );
}

function DecisionForm({ v, members, busy, act }: { v: OntheffingView; members: { id: string; name: string; role: string }[]; busy: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const { api } = useAuth();
  const stage = v.stage!;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState("");
  const [presiding, setPresiding] = useState("");
  const [present, setPresent] = useState<string[]>([]);
  const [absent, setAbsent] = useState<string[]>([]);
  const [resolve, setResolve] = useState(false);
  const [resolution, setResolution] = useState("");
  const hr = members.filter((m) => m.role === "HOGERAAD");
  const pres = members.filter((m) => m.role === "RINGPRESIDIUM");
  const negative = (stage === "PRESIDIUM" ? v.rounds?.presidium.negative : v.rounds?.hogeraad.negative) ?? 0;
  const toggle = (list: string[], set: (l: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)}>Gezamenlijk besluit vastleggen ({stage === "PRESIDIUM" ? "ringpresidium" : "hoge raad"})</button>;
  return (
    <form className="glass card stack" aria-label="Gezamenlijk besluit" onSubmit={(e) => { e.preventDefault(); void act(() => api.ontheffingDecision(v.id, {
      stage, decidedOn: date, agreed, note: note || undefined, presidingUserId: presiding || undefined, presentUserIds: present, absentUserIds: absent, resolveNegative: resolve, resolutionNote: resolution || undefined,
    }), "Gezamenlijk besluit vastgelegd."); }}>
      <strong>Gezamenlijk besluit {stage === "PRESIDIUM" ? "ringpresidium" : "hoge raad"}</strong>
      <span className="muted">Alleen vastleggen als het besluit daadwerkelijk akkoord is genomen. Er worden geen reacties namens anderen aangemaakt.</span>
      <div><label htmlFor="d-date">Datum van het besluit</label><input id="d-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></div>
      {stage === "HOGERAAD" && (
        <>
          <div><label htmlFor="d-pres">Voorzitter van de vergadering (ringpresidium)</label>
            <select id="d-pres" value={presiding} onChange={(e) => setPresiding(e.target.value)} required><option value="">Kies…</option>{pres.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <fieldset className="stack"><legend>Aanwezige hogeraadsleden</legend>{hr.map((m) => <label key={m.id} className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={present.includes(m.id)} onChange={() => { toggle(present, setPresent, m.id); setAbsent(absent.filter((x) => x !== m.id)); }} /> {m.name}</label>)}</fieldset>
          <fieldset className="stack"><legend>Afwezig</legend>{hr.map((m) => <label key={m.id} className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={absent.includes(m.id)} onChange={() => { toggle(absent, setAbsent, m.id); setPresent(present.filter((x) => x !== m.id)); }} /> {m.name}</label>)}</fieldset>
          <span className="muted">Afwezigheid geldt nooit als ondersteuning. Een betrokkene van dit dossier kan niet aanwezig zijn.</span>
        </>
      )}
      <div><label htmlFor="d-note">Opmerking (optioneel)</label><input id="d-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
      {negative > 0 && (
        <div className="stack">
          <div className="error" role="alert">Er is een negatieve reactie. Leg vast hoe die is afgehandeld; negatieve reacties worden nooit stilzwijgend overschreven.</div>
          <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={resolve} onChange={(e) => setResolve(e.target.checked)} /> De negatieve reactie is besproken en afgehandeld</label>
          <div><label htmlFor="d-res">Toelichting (minimaal 10 tekens)</label><input id="d-res" value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={500} /></div>
        </div>
      )}
      <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> Het besluit is daadwerkelijk akkoord vastgesteld</label>
      <div className="row"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annuleren</button><button className="btn btn-primary" disabled={busy || !agreed}>Vastleggen</button></div>
    </form>
  );
}
