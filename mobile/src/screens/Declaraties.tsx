import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import type { DeclarationContext, DeclarationDetail, DeclarationListItem, DeclarationSubmitInput } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { formatEuro, prepareFile, type PreparedFile } from "../lib/declarationFiles";
import { ErrorState, PageHead, Spinner, StatusLabel } from "../components/ui";

export const NOT_ACTIVATED_NOTICE = "Declareren is voor deze ring, wijk of gemeente nog niet geactiveerd. Neem contact op met je plaatselijke leiders om de declaratiemodule te laten activeren.";
const RING_CONFIRM = "Weet je zeker dat deze declaratie voor de ring is en niet voor je wijk of gemeente?";
const tone = (s: string) => (s === "PROCESSED" ? "ok" : s === "REJECTED" ? "bad" : s === "NEEDS_INFO" ? "warn" : "neutral") as "ok" | "bad" | "warn" | "neutral";
const fmtDate = (iso: string) => new Date(iso).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
const errMsg = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Er ging iets mis. Probeer het opnieuw.");

function Row({ d }: { d: DeclarationListItem }) {
  return (
    <Link to={`/declaraties/${d.id}`} className="glass panel stack">
      <div className="row between"><strong>{formatEuro(d.amountCents)}</strong><StatusLabel tone={tone(d.status)}>{d.statusLabel}</StatusLabel></div>
      <span>{d.description}</span>
      <span className="muted">{d.organization} · {d.unitName ?? d.ringName} · {fmtDate(d.submittedAt)}</span>
    </Link>
  );
}

/** Naam bevestigen en voorkeursring/-eenheid kiezen (onboarding en later via het profiel). */
function ProfileForm({ ctx, onSaved, title }: { ctx: DeclarationContext; onSaved: () => void; title: string }) {
  const { api, reloadMe } = useAuth();
  const [name, setName] = useState(ctx.name);
  const [ringId, setRingId] = useState(ctx.preferredRingId ?? "");
  const [unitId, setUnitId] = useState(ctx.preferredUnitId ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const units = ctx.destinations.find((d) => d.ringId === ringId)?.units ?? [];
  async function save() {
    setBusy(true); setMsg(null);
    try { await api.saveDeclarationProfile({ name, ringId, unitId: unitId || null }); await reloadMe(); onSaved(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <form className="glass card stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2>{title}</h2>
      <label className="stack"><span>Je volledige naam</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
      <label className="stack"><span>Ring</span>
        <select value={ringId} onChange={(e) => { setRingId(e.target.value); setUnitId(""); }} required>
          <option value="">Kies je ring…</option>
          {ctx.destinations.map((d) => <option key={d.ringId} value={d.ringId}>{d.ringName}</option>)}
        </select>
      </label>
      {ringId && (
        <label className="stack"><span>Wijk of gemeente</span>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Geen (declaraties voor de ring)</option>
            {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name} ({u.kind === "WIJK" ? "wijk" : "gemeente"})</option>)}
          </select>
        </label>
      )}
      <span className="muted">Dit zijn alleen je voorkeuren; per declaratie kun je een andere bestemming kiezen.</span>
      {msg && <div role="alert" className="note bad">{msg}</div>}
      <button className="btn btn-primary" disabled={busy || !ringId || name.trim().length < 2}>Opslaan</button>
    </form>
  );
}

export function DeclaratiesHome() {
  const { api, ring } = useAuth();
  const ctx = useLoad(() => api.declarationContext(), []);
  const mine = useLoad(() => api.myDeclarations(), []);
  if (ctx.loading && !ctx.data) return <Spinner />;
  if (ctx.error) return <ErrorState error={ctx.error} onRetry={ctx.reload} />;
  const c = ctx.data!;
  if (!c.onboarded) {
    return (
      <div className="stack">
        <PageHead title="Declaraties" subtitle="Welkom! Controleer eerst je gegevens." />
        <ProfileForm ctx={c} title="Je gegevens" onSaved={() => void ctx.reload()} />
      </div>
    );
  }
  return (
    <div className="stack">
      <PageHead title="Declaraties" action={<Link className="btn btn-primary" to="/declaraties/nieuw">Nieuwe declaratie</Link>} />
      {(c.official.administer || c.official.president) && (
        <Link to="/declaraties/beheer" className="glass panel row between"><span>{c.official.administer ? "Declaraties verwerken" : "Declaraties inzien (alleen lezen)"}</span><span aria-hidden>›</span></Link>
      )}
      {ring?.isRingManager && <Link to="/declaraties/functies" className="glass panel row between"><span>Financiële functies beheren</span><span aria-hidden>›</span></Link>}
      <Link to="/declaraties/uitleg" className="glass panel row between"><span>Hoe declareer je?</span><span aria-hidden>›</span></Link>
      <h2>Mijn declaraties</h2>
      {mine.loading && !mine.data && <Spinner />}
      {mine.error && <ErrorState error={mine.error} onRetry={mine.reload} />}
      {mine.data?.items.length === 0 && <p className="empty">Je hebt nog geen declaraties ingediend.</p>}
      {mine.data?.items.map((d) => <Row key={d.id} d={d} />)}
      <Link to="/declaraties/profiel" className="muted">Mijn gegevens en voorkeuren wijzigen</Link>
    </div>
  );
}

export function DeclaratieProfiel() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const ctx = useLoad(() => api.declarationContext(), []);
  if (ctx.loading && !ctx.data) return <Spinner />;
  if (ctx.error) return <ErrorState error={ctx.error} onRetry={ctx.reload} />;
  return <div className="stack"><PageHead title="Mijn gegevens" /><ProfileForm ctx={ctx.data!} title="Naam en voorkeuren" onSaved={() => navigate("/declaraties", { replace: true })} /></div>;
}

export function DeclaratieUitleg() {
  return (
    <div className="stack">
      <PageHead title="Hoe declareer je?" />
      <div className="glass card stack">
        <ul className="stack">
          <li>Declareer alleen uitgaven die <strong>vooraf zijn goedgekeurd</strong>.</li>
          <li>Op de bon mogen alleen aankopen voor de kerk staan. Privé-aankopen reken je apart af (twee aparte transacties).</li>
          <li>Schrijf niets op de originele bon en streep geen producten of bedragen door.</li>
          <li>Blijven er producten over na een activiteit? Die hoef je niet af te trekken; bewaar ze voor later gebruik of zoek er een passende andere bestemming voor.</li>
          <li>Houd de originele bon heel. Extra uitleg zet je in Ringtools bij de declaratie.</li>
          <li>Het doel: de administrateur hoeft niets uit te rekenen.</li>
          <li>Ringtools betaalt niets uit. De administrateur verwerkt de declaratie in het kerkelijke systeem.</li>
        </ul>
      </div>
    </div>
  );
}

export function DeclaratieNieuw() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const ctx = useLoad(() => api.declarationContext(), []);
  const requestId = useRef(crypto.randomUUID().replace(/-/g, ""));
  const [ringId, setRingId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [ringConfirmed, setRingConfirmed] = useState(false);
  const [f, setF] = useState({ organization: "", approverName: "", forWhom: "", payeeName: "", amount: "", description: "", notes: "" });
  const [approved, setApproved] = useState(false);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ctx.data || ringId) return;
    setRingId(ctx.data.preferredRingId ?? "");
    setUnitId(ctx.data.preferredUnitId ?? "");
    setF((x) => ({ ...x, forWhom: ctx.data!.name, payeeName: ctx.data!.name }));
  }, [ctx.data, ringId]);

  const dest = ctx.data?.destinations.find((d) => d.ringId === ringId);
  const unit = dest?.units.find((u) => u.unitId === unitId);
  const activated = unitId ? !!unit?.activated : !!dest?.activated;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const total = useMemo(() => files.reduce((n, x) => n + x.sizeBytes, 0), [files]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setMsg(null);
    try {
      const next: PreparedFile[] = [];
      for (const file of Array.from(list)) next.push(await prepareFile(file));
      setFiles((cur) => [...cur, ...next].slice(0, 10));
    } catch (e) { setMsg(e instanceof Error ? e.message : "Het bestand kon niet worden toegevoegd."); }
  }

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const body: DeclarationSubmitInput = {
        clientRequestId: requestId.current, ringId, unitId: unitId || null, ringDirectConfirmed: unitId ? undefined : ringConfirmed,
        organization: f.organization, approverName: f.approverName, approvalConfirmed: approved, forWhom: f.forWhom, payeeName: f.payeeName,
        amount: f.amount, description: f.description, notes: f.notes, files: files.map((x) => ({ fileName: x.fileName, dataBase64: x.dataBase64 })),
      };
      const r = await api.submitDeclaration(body);
      navigate(`/declaraties/${r.id}`, { replace: true });
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }

  if (ctx.loading && !ctx.data) return <Spinner />;
  if (ctx.error) return <ErrorState error={ctx.error} onRetry={ctx.reload} />;
  const ready = ringId && activated && approved && files.length > 0 && (unitId || ringConfirmed) && f.organization.trim() && f.approverName.trim() && f.forWhom.trim() && f.payeeName.trim() && f.amount.trim() && f.description.trim();
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <PageHead title="Nieuwe declaratie" />
      <div className="glass card stack">
        <h2>Bestemming</h2>
        <label className="stack"><span>Ring</span>
          <select value={ringId} onChange={(e) => { setRingId(e.target.value); setUnitId(""); setRingConfirmed(false); }} required>
            <option value="">Kies…</option>
            {ctx.data!.destinations.map((d) => <option key={d.ringId} value={d.ringId}>{d.ringName}</option>)}
          </select>
        </label>
        {dest && (
          <label className="stack"><span>Wijk of gemeente</span>
            <select value={unitId} onChange={(e) => { setUnitId(e.target.value); setRingConfirmed(false); }}>
              <option value="">Rechtstreeks naar de ring</option>
              {dest.units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name}</option>)}
            </select>
          </label>
        )}
        {ringId && !unitId && <label className="row"><input type="checkbox" checked={ringConfirmed} onChange={(e) => setRingConfirmed(e.target.checked)} /> <span>{RING_CONFIRM}</span></label>}
        {ringId && !activated && <div role="alert" className="note bad">{NOT_ACTIVATED_NOTICE}</div>}
      </div>
      <div className="glass card stack">
        <h2>Gegevens</h2>
        <label className="stack"><span>Voor welke organisatie is de aankoop?</span><input value={f.organization} onChange={set("organization")} maxLength={120} required /></label>
        <label className="stack"><span>Wie heeft vooraf toestemming gegeven?</span><input value={f.approverName} onChange={set("approverName")} maxLength={120} required /></label>
        <label className="row"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> <span>Ik bevestig dat deze uitgave vooraf is goedgekeurd.</span></label>
        <label className="stack"><span>Voor wie is de declaratie?</span><input value={f.forWhom} onChange={set("forWhom")} maxLength={120} required /></label>
        <label className="stack"><span>Aan wie moet het geld worden overgemaakt?</span><input value={f.payeeName} onChange={set("payeeName")} maxLength={120} required /></label>
        <label className="stack"><span>Bedrag (€)</span><input inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="12,50" required /></label>
        <label className="stack"><span>Korte omschrijving</span><input value={f.description} onChange={set("description")} maxLength={500} required /></label>
        <label className="stack"><span>Opmerkingen (optioneel)</span><textarea value={f.notes} onChange={set("notes")} maxLength={2000} rows={3} /></label>
      </div>
      <div className="glass card stack">
        <h2>Bon(nen)</h2>
        <span className="muted">Maak een foto of voeg een bestaande foto of PDF toe. Alleen kerkelijke aankopen op de bon, niets doorgestreept of beschreven. <Link to="/declaraties/uitleg">Meer uitleg</Link></span>
        <div className="row">
          <label className="btn btn-ghost">Foto maken<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} /></label>
          <label className="btn btn-ghost">Foto of PDF kiezen<input type="file" accept="image/jpeg,image/png,application/pdf,image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} /></label>
        </div>
        {files.map((x, i) => (
          <div key={i} className="row between">
            <span className="row">{x.previewUrl && <img src={x.previewUrl} alt="" width={40} height={40} className="thumb" />}<span>{x.fileName}</span></span>
            <button type="button" className="btn btn-ghost" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>Verwijderen</button>
          </div>
        ))}
        {files.length > 0 && <span className="muted">{files.length} bijlage(n), {(total / 1024 / 1024).toFixed(1)} MB</span>}
      </div>
      {msg && <div role="alert" className="note bad">{msg}</div>}
      <button className="btn btn-primary" disabled={busy || !ready}>{busy ? "Bezig met indienen…" : "Declaratie indienen"}</button>
    </form>
  );
}

const ACTIONS: { status: string; label: string; needsNote: boolean }[] = [
  { status: "IN_PROGRESS", label: "In behandeling nemen", needsNote: false },
  { status: "NEEDS_INFO", label: "Aanvulling vragen", needsNote: true },
  { status: "PROCESSED", label: "Administratief verwerkt", needsNote: false },
  { status: "REJECTED", label: "Afwijzen", needsNote: true },
];

export function DeclaratieDetailScreen() {
  const { id } = useParams();
  const { api } = useAuth();
  const { data, error, loading, reload } = useLoad<DeclarationDetail>(() => api.declaration(id!), [id]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(status: string, needsNote: boolean) {
    if (needsNote && note.trim().length < 5) { setMsg("Geef een korte toelichting voor de declarant."); return; }
    setBusy(true); setMsg(null);
    try { await api.setDeclarationStatus(id!, status, note.trim() || undefined); setNote(""); await reload(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  async function download(attId: string) {
    try {
      const f = await api.declarationAttachment(id!, attId);
      const bin = atob(f.dataBase64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
      const a = document.createElement("a");
      a.href = url; a.download = f.fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) { setMsg(errMsg(e)); }
  }

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const d = data!;
  return (
    <div className="stack">
      <PageHead title={formatEuro(d.amountCents)} subtitle={<StatusLabel tone={tone(d.status)}>{d.statusLabel}</StatusLabel>} />
      {d.viewerRole === "president" && <div className="note" role="note">Je bekijkt deze declaratie alleen ter inzage. Je toegang wordt vastgelegd.</div>}
      <div className="glass card stack">
        <div><span className="muted">Omschrijving</span><div>{d.description}</div></div>
        <div><span className="muted">Declarant</span><div>{d.ownerName}</div></div>
        <div><span className="muted">Bestemming</span><div>{d.unitName ? `${d.unitName} (${d.ringName})` : d.ringName}</div></div>
        <div><span className="muted">Organisatie</span><div>{d.organization}</div></div>
        <div><span className="muted">Vooraf goedgekeurd door</span><div>{d.approverName}</div></div>
        <div><span className="muted">Voor</span><div>{d.forWhom}</div></div>
        <div><span className="muted">Overmaken aan</span><div>{d.payeeName}</div></div>
        {d.notes && <div><span className="muted">Opmerkingen</span><div>{d.notes}</div></div>}
        <div><span className="muted">Ingediend</span><div>{fmtDate(d.submittedAt)}</div></div>
      </div>
      <section className="glass card stack">
        <h2>Bijlagen</h2>
        {d.attachments.map((a) => <div key={a.id} className="row between"><span>{a.fileName}</span><button className="btn btn-ghost" onClick={() => void download(a.id)}>Downloaden</button></div>)}
      </section>
      <section className="glass card stack">
        <h2>Verloop</h2>
        {d.history.map((h, i) => <div key={i}><strong>{h.toLabel}</strong> <span className="muted">{fmtDate(h.at)}</span>{h.note && <div>{h.note}</div>}</div>)}
      </section>
      {d.canProcess && (
        <section className="glass card stack">
          <h2>Verwerken</h2>
          <span className="muted">Ringtools betaalt niets uit. Zet de declaratie pas op verwerkt als je haar zelf in het kerkelijke systeem hebt verwerkt.</span>
          <label className="stack"><span>Toelichting voor de declarant (verplicht bij aanvulling of afwijzing)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} /></label>
          {ACTIONS.filter((a) => a.status !== d.status).map((a) => <button key={a.status} className="btn btn-ghost" disabled={busy} onClick={() => void act(a.status, a.needsNote)}>{a.label}</button>)}
        </section>
      )}
      {msg && <div role="alert" className="note bad">{msg}</div>}
    </div>
  );
}

export function DeclaratieBeheer() {
  const { api } = useAuth();
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useLoad(() => api.officialDeclarations(status || undefined), [status]);
  return (
    <div className="stack">
      <PageHead title="Declaraties verwerken" />
      <label className="stack"><span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Alle</option>
          <option value="SUBMITTED">Ingediend</option><option value="SEEN">Gezien door administrateur</option><option value="IN_PROGRESS">In behandeling</option>
          <option value="NEEDS_INFO">Aanvulling nodig</option><option value="PROCESSED">Administratief verwerkt</option><option value="REJECTED">Afgewezen</option>
        </select>
      </label>
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.items.length === 0 && <p className="empty">Geen declaraties.</p>}
      {data?.items.map((d) => <Row key={d.id} d={d} />)}
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Financieel administrateur", unit: "both" },
  { value: "SUBADMIN", label: "Financieel subadministrateur", unit: "both" },
  { value: "RING_PRESIDENT_READ", label: "Ringpresident (alleen lezen)", unit: "ring" },
  { value: "UNIT_LEADER", label: "Bisschop / gemeentepresident (voor activering)", unit: "unit" },
] as const;

/** Ringbeheerders wijzen financiële functies aan op exact e-mailadres. Er is bewust geen zoeklijst van kerkleden. */
export function DeclaratieFuncties() {
  const { api, ring } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.financeOverview(ring!.id), [ring?.id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("ADMIN");
  const [unitId, setUnitId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opt = ROLE_OPTIONS.find((r) => r.value === role)!;
  const needsUnit = opt.unit === "unit";
  const usesUnit = opt.unit !== "ring" && unitId !== "";

  async function add() {
    setBusy(true); setMsg(null);
    try {
      await api.assignFinance(ring!.id, { email, role, unitId: opt.unit === "ring" ? null : unitId || null });
      setEmail(""); setMsg("De functie is vastgelegd. Is het adres nog niet bekend, dan wordt de functie gekoppeld zodra die persoon zich aanmeldt."); await reload();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  async function revoke(id: string, pending: boolean) {
    try { await api.revokeFinance(id, pending); await reload(); } catch (e) { setMsg(errMsg(e)); }
  }
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const a = data!;
  const missing = (m: string[]) => m.map((x) => (x === "leader" ? "ringpresident/bisschop/gemeentepresident" : "financieel administrateur")).join(" en ");
  return (
    <div className="stack">
      <PageHead title="Financiële functies" subtitle="Alleen op exact e-mailadres. Deze functies staan los van roepingen en geven geen toegang tot roepingen." />
      <section className="glass card stack">
        <h2>Activering</h2>
        <div className="row between"><span>Ring {ring?.name}</span>{a.activation.ring.activated ? <StatusLabel tone="ok">Geactiveerd</StatusLabel> : <StatusLabel tone="warn">Mist: {missing(a.activation.ring.missing)}</StatusLabel>}</div>
        {a.activation.units.map((u) => <div key={u.unitId} className="row between"><span>{u.name}</span>{u.activation.activated ? <StatusLabel tone="ok">Geactiveerd</StatusLabel> : <StatusLabel tone="warn">Mist: {missing(u.activation.missing)}</StatusLabel>}</div>)}
      </section>
      <form className="glass card stack" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <h2>Functie toekennen</h2>
        <label className="stack"><span>E-mailadres</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required /></label>
        <label className="stack"><span>Functie</span><select value={role} onChange={(e) => setRole(e.target.value)}>{ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
        {opt.unit !== "ring" && (
          <label className="stack"><span>{needsUnit ? "Wijk of gemeente" : "Voor"}</span>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required={needsUnit}>
              {!needsUnit && <option value="">De ring zelf</option>}{needsUnit && <option value="">Kies…</option>}
              {a.activation.units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name}</option>)}
            </select>
          </label>
        )}
        {msg && <div role="status">{msg}</div>}
        <button className="btn btn-primary" disabled={busy || !email || (needsUnit && !usesUnit)}>Toekennen</button>
      </form>
      <section className="stack">
        <h2>Aangewezen functionarissen</h2>
        {a.assignments.length === 0 && <p className="empty">Nog niemand aangewezen.</p>}
        {a.assignments.map((x) => (
          <div key={x.id} className="glass panel row between">
            <span className="stack"><strong>{x.name ?? x.email}</strong><span className="muted">{x.roleLabel}{x.unitName ? ` · ${x.unitName}` : " · ring"}{x.pending ? " · wacht op aanmelding" : ""}</span></span>
            <button className="btn btn-ghost" onClick={() => void revoke(x.id, x.pending)}>Intrekken</button>
          </div>
        ))}
      </section>
    </div>
  );
}

export function DeclaratieRoutes() {
  return (
    <Routes>
      <Route path="nieuw" element={<DeclaratieNieuw />} />
      <Route path="uitleg" element={<DeclaratieUitleg />} />
      <Route path="profiel" element={<DeclaratieProfiel />} />
      <Route path="beheer" element={<DeclaratieBeheer />} />
      <Route path="functies" element={<DeclaratieFuncties />} />
      <Route path=":id" element={<DeclaratieDetailScreen />} />
      <Route path="*" element={<DeclaratiesHome />} />
      <Route index element={<DeclaratiesHome />} />
    </Routes>
  );
}
