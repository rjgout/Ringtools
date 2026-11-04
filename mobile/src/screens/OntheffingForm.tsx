import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AccountLinkMode, FollowUpAnswer, OntheffingConceptInput, OntheffingView, RingMemberInfo } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { CallingPicker, type PickedCalling } from "../components/CallingPicker";
import { ErrorState, Spinner } from "../components/ui";

type Link = { mode: AccountLinkMode; userId: string };
type Adviser = { code: string; functionName: string; answer: FollowUpAnswer; name: string; reason: string; link: Link };

/** Identificatie van het Ringtools-account van een betrokkene: altijd expliciet, nooit automatisch op naam. */
function AccountChoice({ id, link, members, onChange }: { id: string; link: Link; members: RingMemberInfo[]; onChange: (l: Link) => void }) {
  return (
    <fieldset className="stack">
      <legend>Heeft deze persoon een Ringtools-account?</legend>
      <label className="row"><input type="radio" name={id} style={{ width: 24, minHeight: 24 }} checked={link.mode === "GEEN_ACCOUNT"} onChange={() => onChange({ mode: "GEEN_ACCOUNT", userId: "" })} /> Nee, geen Ringtools-account</label>
      <label className="row"><input type="radio" name={id} style={{ width: 24, minHeight: 24 }} checked={link.mode === "GEKOPPELD"} onChange={() => onChange({ mode: "GEKOPPELD", userId: link.userId })} /> Ja, dit account:</label>
      {link.mode === "GEKOPPELD" && (
        <select aria-label="Ringtools-account van de betrokkene" value={link.userId} onChange={(e) => onChange({ mode: "GEKOPPELD", userId: e.target.value })}>
          <option value="">Kies het account…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}
      <span className="muted">De app koppelt nooit automatisch op naam. Een gekoppeld account kan dit dossier nergens zien (geen lijst, aantal, melding of link) en doet niet mee aan de behandeling. De koppeling verdwijnt met het dossier.</span>
    </fieldset>
  );
}

export function OntheffingForm() {
  const { id } = useParams();
  const { api, ring } = useAuth();
  const navigate = useNavigate();
  const units = useLoad(() => api.units(ring!.id), [ring?.id]);
  const members = useLoad(() => api.ringMembers(ring!.id), [ring?.id]);
  const loaded = useLoad<OntheffingView | null>(() => (id ? api.ontheffing(id) : Promise.resolve(null)), [id]);

  const [name, setName] = useState("");
  const [link, setLink] = useState<Link>({ mode: "ONBEKEND", userId: "" });
  const [unitId, setUnitId] = useState("");
  const [picked, setPicked] = useState<PickedCalling | null>(null);
  const [advisers, setAdvisers] = useState<Adviser[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Vullen vanuit het opgeslagen concept (alleen als er nog niets is aangepast).
  useEffect(() => {
    const v = loaded.data;
    if (!v || dirty) return;
    const head = v.persons.find((p) => p.role === "HOOFD");
    setName(head?.name ?? "");
    setLink({ mode: head?.accountMode ?? "ONBEKEND", userId: head?.userId ?? "" });
    setUnitId(v.unitId ?? "");
    setPicked(v.function ? { code: v.function.code, source: (v.function.source ?? "STANDAARD") as "STANDAARD" | "EIGEN", name: v.function.name ?? "", category: "", customConfirmed: !!v.procedureConfirmed, requiresConfirmation: !!v.requiresConfirmation } : null);
    setAdvisers(v.persons.filter((p) => p.role === "RAADGEVER").map((p) => ({
      code: p.followUpCode ?? "", functionName: p.functionName, answer: p.answer ?? "OPEN", name: p.name ?? "", reason: p.naReason ?? "",
      link: { mode: p.accountMode ?? "ONBEKEND", userId: p.userId ?? "" },
    })));
  }, [loaded.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(() => members.data?.members ?? [], [members.data]);
  const mark = <T,>(setter: (v: T) => void) => (v: T) => { setDirty(true); setter(v); };

  function build(): OntheffingConceptInput {
    const persons: NonNullable<OntheffingConceptInput["persons"]> = [{ role: "HOOFD", name, accountMode: link.mode, userId: link.mode === "GEKOPPELD" ? link.userId : null }];
    for (const a of advisers) {
      persons.push({
        role: "RAADGEVER", followUpCode: a.code, answer: a.answer, name: a.answer === "NAAM" ? a.name : null, naReason: a.answer === "NIET_VAN_TOEPASSING" ? a.reason : null,
        accountMode: a.answer === "NAAM" ? a.link.mode : "ONBEKEND", userId: a.answer === "NAAM" && a.link.mode === "GEKOPPELD" ? a.link.userId : null,
      });
    }
    return { unitId: unitId || null, functionSource: picked?.source ?? null, functionCode: picked?.code ?? null, procedureConfirmed: !!picked?.customConfirmed, persons };
  }

  async function save(): Promise<string | null> {
    setMessage(null);
    try {
      let target = id ?? null;
      if (target) await api.updateOntheffing(target, build());
      else target = (await api.createOntheffing(ring!.id, build())).id;
      setDirty(false);
      return target;
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Opslaan lukt nu niet.");
      return null;
    }
  }

  async function onSave() {
    setBusy(true);
    const target = await save();
    setBusy(false);
    if (!target) return;
    if (!id) navigate(`/ontheffingen/concept/${target}`, { replace: true });
    else await loaded.reload();
    setMessage("Concept opgeslagen. Er is niets verstuurd.");
  }

  async function onSubmit() {
    setBusy(true);
    const target = await save();
    if (!target) { setBusy(false); return; }
    try {
      await api.submitOntheffing(target); // idempotent: bij dubbel tikken blijft het één dossier
      navigate(`/ontheffingen/${target}`, { replace: true });
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : "Indienen lukt nu niet.");
      if (!id) navigate(`/ontheffingen/concept/${target}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!id || !window.confirm("Dit concept definitief verwijderen?")) return;
    try { await api.deleteOntheffing(id); navigate("/ontheffingen", { replace: true }); } catch (err) { setMessage(err instanceof ApiRequestError ? err.message : "Verwijderen lukt nu niet."); }
  }

  const noUnits = !!units.data && units.data.units.filter((u) => u.active).length === 0;
  const waitingForFollowUps = !!picked && advisers.length === 0 && dirty;

  return (
    <div className="stack">
      <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => navigate("/ontheffingen")}>‹ Terug</button>
      <h1>{id ? "Concept ontheffing" : "Nieuwe ontheffing"}</h1>
      <span className="muted">Een concept is alleen voor jou zichtbaar en verstuurt niets. Naam handmatig invoeren; er wordt niets uit een ledenregister overgenomen.</span>
      {(loaded.loading && !loaded.data && !!id) && <Spinner />}
      {loaded.error && <ErrorState error={loaded.error} onRetry={loaded.reload} />}

      <div className="glass card stack">
        <strong>1. Betrokkene</strong>
        <div><label htmlFor="of-name">Naam</label><input id="of-name" value={name} onChange={(e) => mark(setName)(e.target.value)} autoComplete="off" maxLength={200} /></div>
        <AccountChoice id="main" link={link} members={candidates} onChange={mark(setLink)} />
      </div>

      <div className="glass card stack">
        <strong>2. Wijk of gemeente van herkomst</strong>
        <select id="of-unit" aria-label="Wijk of gemeente" value={unitId} onChange={(e) => mark(setUnitId)(e.target.value)}>
          <option value="">Kies…</option>
          {(units.data?.units ?? []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.kind === "WIJK" ? "Wijk" : "Gemeente"} {u.name}</option>)}
        </select>
        {noUnits && <div className="error" role="alert">De ringinrichting is nog niet compleet: er zijn geen wijken of gemeenten ingevoerd. Je kunt het concept opslaan, maar pas indienen nadat de ringbeheerder deze heeft ingevoerd.</div>}
      </div>

      <div className="glass card stack">
        <strong>3. Roeping</strong>
        <CallingPicker ringId={ring!.id} value={picked} onChange={mark(setPicked)} />
        <span className="muted">De ontheffing van een bisschop verloopt buiten Ringtools en is niet te kiezen.</span>
      </div>

      {advisers.length > 0 && (
        <div className="glass card stack">
          <strong>4. Raadgevers</strong>
          <span className="muted">Bij deze functie wordt volgens het handboek ook gevraagd naar de raadgevers. Beantwoord de vraag voor elke raadgever.</span>
          {advisers.map((a, i) => {
            const set = (patch: Partial<Adviser>) => { setDirty(true); setAdvisers(advisers.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
            return (
              <div key={a.code} className="glass panel stack">
                <strong>{a.functionName}</strong>
                <label className="row"><input type="radio" name={`ad-${a.code}`} style={{ width: 24, minHeight: 24 }} checked={a.answer === "NAAM"} onChange={() => set({ answer: "NAAM" })} /> Naam invullen</label>
                <label className="row"><input type="radio" name={`ad-${a.code}`} style={{ width: 24, minHeight: 24 }} checked={a.answer === "NIET_VAN_TOEPASSING"} onChange={() => set({ answer: "NIET_VAN_TOEPASSING" })} /> Niet van toepassing</label>
                {a.answer === "NAAM" && (
                  <>
                    <div><label htmlFor={`ad-name-${a.code}`}>Naam</label><input id={`ad-name-${a.code}`} value={a.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" /></div>
                    <AccountChoice id={`ad-link-${a.code}`} link={a.link} members={candidates} onChange={(l) => set({ link: l })} />
                  </>
                )}
                {a.answer === "NIET_VAN_TOEPASSING" && (
                  <div><label htmlFor={`ad-reason-${a.code}`}>Reden (optioneel)</label><input id={`ad-reason-${a.code}`} value={a.reason} onChange={(e) => set({ reason: e.target.value })} maxLength={300} /></div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {waitingForFollowUps && <span className="muted">Sla het concept op om te zien of voor deze functie vervolgvragen gelden.</span>}

      {message && <div role="alert" className="glass panel error">{message}</div>}
      <div className="row">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onSave}>Concept opslaan</button>
        <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !picked || !unitId} onClick={onSubmit}>Indienen bij ringpresidium</button>
      </div>
      {id && <button type="button" className="btn btn-ghost" onClick={onDelete}>Concept verwijderen</button>}
    </div>
  );
}
