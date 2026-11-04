import { useEffect, useMemo, useState } from "react";
import type { CatalogCalling, CatalogResult } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";
import { Spinner } from "../components/ui";

/** Soort regel voor weergave en filter. Bevoegdheden worden alleen bij "GEVERIFIEERD" aan personen gekoppeld. */
export type ProcedureKind = "GEVERIFIEERD" | "ALGEMEEN" | "BUITEN" | "EIGEN";

export function procedureKind(c: CatalogCalling): ProcedureKind {
  if (c.source === "EIGEN") return "EIGEN";
  if (!c.ringtoolsProcess || c.ruleStatus === "BIJZONDER") return "BUITEN";
  if (c.ruleStatus === "GEVERIFIEERD") return "GEVERIFIEERD";
  return "ALGEMEEN";
}

const KIND_LABEL: Record<ProcedureKind, string> = {
  GEVERIFIEERD: "Geverifieerde regels",
  ALGEMEEN: "Algemene ringprocedure – regels nog te beoordelen",
  BUITEN: "Buiten Ringtools",
  EIGEN: "Eigen roeping",
};
const KIND_BADGE: Record<ProcedureKind, string> = { GEVERIFIEERD: "ok", ALGEMEEN: "", BUITEN: "bad", EIGEN: "" };

const AUTHORITY_LABEL: Record<string, string> = {
  RINGPRESIDENT: "Ringpresident",
  RINGPRESIDENT_OF_RAADGEVER: "Ringpresident of aangewezen raadgever",
  RINGPRESIDENT_RAADGEVER_OF_HOGERAADSLID: "Ringpresident, aangewezen raadgever of aangewezen hogeraadslid",
  BIJZONDER: "Bijzondere procedure (buiten Ringtools)",
  ONBEKEND: "Niet vastgesteld – menselijke controle nodig",
};
const VENUE_LABEL: Record<string, string> = { RINGCONFERENTIE: "Ringconferentie", GEEN: "Geen steunverlening", NADER_BEPALEN: "Nader te bepalen" };
const APPOINTMENT_LABEL: Record<string, string> = { VERPLICHT: "Verplicht", OPTIONEEL: "Optioneel", ONBEKEND: "Niet vastgesteld" };
const ROUTE_LABEL: Record<string, string> = {
  RINGPRESIDIUM_HOGE_RAAD: "Algemene ringprocedure: ringpresidium → hoge raad (wordt in Ringtools gecoördineerd)",
  EERSTE_PRESIDIUM: "Eerste Presidium (buiten Ringtools)",
  AANGEWEZEN_AUTORITEIT: "Aangewezen algemeen autoriteit of gebiedszeventiger (buiten Ringtools)",
  QUORUM_TWAALF: "Quorum der Twaalf (buiten Ringtools)",
};

function Row({ label, value }: { label: string; value: string }) {
  return <div className="row between"><span className="muted">{label}</span><span style={{ textAlign: "right" }}>{value}</span></div>;
}

/**
 * Overzicht van de roepingencatalogus (alleen lezen). Toont per organisatie de functies met zoeken en filters, de procedure, bevoegdheden, steunverlening,
 * aanstellingsplicht, handboekverwijzingen en controlepunten. Onderscheid tussen expliciet geverifieerde regels, de algemene ringprocedure waarvan de
 * regels nog beoordeeld moeten worden, en functies buiten Ringtools. Het wijzigen van de catalogus verandert nooit de vastgelegde procedure van een bestaand dossier.
 */
export function CatalogOverview({ ringId }: { ringId: string }) {
  const { api } = useAuth();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<"" | ProcedureKind>("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [data, setData] = useState<CatalogResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api.catalog(ringId, q, category);
        if (!cancelled) { setData(res); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [api, ringId, q, category]);

  const shown = useMemo(
    () => (data?.callings ?? []).filter((c) => (!kind || procedureKind(c) === kind) && (!onlyReview || c.reviewNotes.length > 0 || procedureKind(c) === "ALGEMEEN")),
    [data, kind, onlyReview]
  );
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogCalling[]>();
    for (const c of shown) map.set(c.category, [...(map.get(c.category) ?? []), c]);
    return [...map.entries()];
  }, [shown]);
  const counts = useMemo(() => {
    const out: Record<ProcedureKind, number> = { GEVERIFIEERD: 0, ALGEMEEN: 0, BUITEN: 0, EIGEN: 0 };
    for (const c of data?.callings ?? []) out[procedureKind(c)]++;
    return out;
  }, [data]);

  return (
    <section className="glass card stack" aria-label="Roepingencatalogus">
      <h2>Roepingencatalogus</h2>
      <span className="muted">
        Alleen lezen. Catalogusversie {data?.version ?? "…"}. Wijzigingen in de catalogus gelden alleen voor nieuwe voorstellen en ontheffingen: een bestaand dossier behoudt de procedure die bij indienen is vastgelegd.
        De catalogus bevat alleen functietitels en regels, geen personen.
      </span>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="badge ok">{counts.GEVERIFIEERD} geverifieerd</span>
        <span className="badge">{counts.ALGEMEEN} nog te beoordelen</span>
        <span className="badge bad">{counts.BUITEN} buiten Ringtools</span>
        {counts.EIGEN > 0 && <span className="badge">{counts.EIGEN} eigen</span>}
      </div>
      <div><label htmlFor="co-q">Zoeken</label><input id="co-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></div>
      <div>
        <label htmlFor="co-cat">Organisatie</label>
        <select id="co-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Alle organisaties</option>
          {(data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="co-kind">Soort regel</label>
        <select id="co-kind" value={kind} onChange={(e) => setKind(e.target.value as "" | ProcedureKind)}>
          <option value="">Alle</option>
          <option value="GEVERIFIEERD">{KIND_LABEL.GEVERIFIEERD}</option>
          <option value="ALGEMEEN">{KIND_LABEL.ALGEMEEN}</option>
          <option value="BUITEN">{KIND_LABEL.BUITEN}</option>
          <option value="EIGEN">{KIND_LABEL.EIGEN}</option>
        </select>
      </div>
      <label className="row"><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Alleen functies met controlepunten of nog te beoordelen regels</label>
      {!data && !error && <Spinner />}
      {error && <div className="error" role="alert">{error}</div>}
      {data && shown.length === 0 && <span className="muted">Geen functies gevonden.</span>}
      {grouped.map(([cat, items]) => (
        <div key={cat} className="stack" role="group" aria-label={cat}>
          <strong>{cat}</strong>
          {items.map((c) => <CatalogItem key={`${c.source}-${c.code}`} c={c} />)}
        </div>
      ))}
    </section>
  );
}

function CatalogItem({ c }: { c: CatalogCalling }) {
  const kind = procedureKind(c);
  return (
    <details className="glass panel">
      <summary style={{ cursor: "pointer" }}>
        <span className="grow"><strong>{c.name}</strong> <span className={`badge ${KIND_BADGE[kind]}`}>{KIND_LABEL[kind]}</span></span>
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {kind === "EIGEN" && <div className="muted">Eigen roeping van deze ring: er worden geen bevoegdheden of bijzondere kerkelijke procedures afgeleid. Bij gebruik bevestigt de bevoegde leiding dat de procedure is gecontroleerd.</div>}
        {kind === "BUITEN" && <div className="error" role="note">Deze functie volgt een procedure buiten Ringtools. In Ringtools kan hiervoor niets worden ingediend.{c.extraApproval ? ` Extra goedkeuring: ${c.extraApproval}.` : ""}</div>}
        {kind === "ALGEMEEN" && <div className="muted" role="note">De algemene ringprocedure geldt, maar de bevoegdheden voor deze functie zijn niet geverifieerd. Ringtools kent hier geen bevoegdheden aan personen toe; menselijke controle is nodig en bij gebruik is een bevestiging van de bevoegde leiding verplicht.</div>}
        {c.approvalRoute && <Row label="Procedure" value={ROUTE_LABEL[c.approvalRoute] ?? c.approvalRoute} />}
        {kind !== "EIGEN" && <Row label="Roepen" value={AUTHORITY_LABEL[c.grantedBy ?? "ONBEKEND"] ?? "Niet vastgesteld"} />}
        {kind !== "EIGEN" && <Row label="Aanstellen" value={AUTHORITY_LABEL[c.appointedBy ?? "ONBEKEND"] ?? "Niet vastgesteld"} />}
        {kind !== "EIGEN" && <Row label="Steunverlening" value={VENUE_LABEL[c.supportVenue ?? "NADER_BEPALEN"] ?? "Nader te bepalen"} />}
        {kind !== "EIGEN" && <Row label="Aanstellingsplicht" value={APPOINTMENT_LABEL[c.appointment ?? "ONBEKEND"] ?? "Niet vastgesteld"} />}
        {c.releaseFollowUps.length > 0 && <div className="muted">Bij een ontheffing wordt verplicht naar de raadgevers gevraagd (gezamenlijke ontheffing).</div>}
        {c.handbook.length > 0 && <div><span className="muted">Handboek: </span>{c.handbook.join("; ")}</div>}
        {c.warning && <div className="muted">{c.warning}</div>}
        {c.reviewNotes.length > 0 && (
          <div><strong>Controlepunten</strong><ul>{c.reviewNotes.map((n, i) => <li key={i} className="muted">{n}</li>)}</ul></div>
        )}
        {c.aliases.length > 0 && <div className="muted">Ook bekend als: {c.aliases.join(", ")}</div>}
      </div>
    </details>
  );
}
