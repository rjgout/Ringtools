import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { storage } from "../lib/storage";
import { API_URL } from "../config";
import { useConfirm } from "./Dialog";
import { useReauth } from "./Reauth";
import type { DeletionStatus } from "../lib/api";

export const deletionLabel = (status: string) => ({ REQUESTED: "Ontvangen", IN_REVIEW: "In behandeling", BLOCKED: "Overdracht of beoordeling nodig", COMPLETED: "Account verwijderd" })[status] ?? status;
export function AccountPrivacy() {
  const { api, me } = useAuth();
  const confirm = useConfirm();
  const { run, dialog } = useReauth();
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void api.deletionStatus().then(r => { if (active) setStatus(r.request); }).catch(() => { if (active) setMessage("Status kon niet worden opgehaald. Probeer opnieuw."); }); return () => { active = false; }; }, [api]);
  async function request() {
    if (!await confirm({ title: "Account verwijderen?", message: "Dit verzoek betreft je volledige account in alle ringen. Na verwerking vervallen alle sessies, toestelsleutels, pushregistraties en lidmaatschappen. Open taken en beheer worden eerst overgedragen. Minimale historische procesgegevens mogen alleen met een vastgestelde grondslag tijdelijk gepseudonimiseerd blijven. Dit is geen tijdelijke deactivering.", confirmLabel: "Verwijdering aanvragen", danger: true })) return;
    setBusy(true); setMessage(null);
    try {
      const result = await run(() => api.requestDeletion());
      setStatus(result.request);
      await storage.setDeletionReceipt(result.receipt);
      setMessage("Je verzoek is ontvangen. Bewaar de status op dit toestel; ook na verwijdering kun je deze op het aanmeldscherm bekijken. Streeftermijn: 14 dagen. Je hoeft niet apart te mailen of bellen.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Aanvragen mislukt. Probeer opnieuw."); }
    finally { setBusy(false); }
  }
  return <section className="glass card stack" aria-label="Account en privacy"><h2>Account en privacy</h2>
    <p>Ringtools is een onafhankelijk hulpmiddel voor roepingen en ontheffingen, geen officiële kerkapp. Naam, e-mail, rol, ring, besluiten, taken en vertrouwelijke dossiers kunnen religieuze overtuiging of betrokkenheid onthullen.</p>
    <p>Geen advertenties of tracking. Je telefoon verwerkt Face ID, vingerafdruk of toestelcode zelf; Ringtools ontvangt geen biometrische kenmerken. Push gebruikt Apple of Google en bevat geen namen of functies.</p>
    <a className="btn btn-ghost" href={`${API_URL}/privacy`} target="_blank" rel="noreferrer">Privacyverklaring</a>
    <p className="muted">Verantwoordelijke: Raphael Gout · raphael@ringapeldoorn.nl. Verwijderen raakt alle ringen. Historische dossiers volgen de bewaartermijnen in de privacyverklaring; wettelijke grondslagen en uitzonderingen moeten door de verantwoordelijke worden vastgesteld.</p>
    {status && <div role="status"><strong>{deletionLabel(status.status)}</strong><p>Aangevraagd {new Date(status.requestedAt).toLocaleDateString("nl-NL")}. Streefdatum {new Date(status.dueAt).toLocaleDateString("nl-NL")}.</p>{status.blockerCount > 0 && <p>De beheerder draagt verantwoordelijkheden over en beoordeelt de bewaargegevens. Neem bij vertraging contact op met Raphael Gout.</p>}</div>}
    {message && <p role="status">{message}</p>}
    {!status && me && <button className="btn btn-ghost" disabled={busy} onClick={() => void request()}>{busy ? "Even geduld…" : "Account verwijderen aanvragen…"}</button>}
    {dialog}
  </section>;
}
export function DeletionReceipt() {
  const { api } = useAuth();
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  useEffect(() => { let active = true; void storage.getDeletionReceipt().then(r => { if (active) setReceipt(r); }); return () => { active = false; }; }, []);
  if (!receipt) return null;
  return <div className="stack"><button type="button" className="btn btn-ghost" onClick={() => { void api.deletionReceipt(receipt).then(r => { setStatus(r.request); setMessage(r.request ? null : "Ontvangstbewijs verlopen of niet gevonden."); }).catch(() => setMessage("Status tijdelijk niet beschikbaar.")); }}>Status verwijderverzoek</button>{status && <span role="status">{deletionLabel(status.status)}</span>}{message && <span role="status">{message}</span>}</div>;
}
