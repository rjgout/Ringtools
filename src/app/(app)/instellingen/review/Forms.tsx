"use client";
import { useActionState } from "react";
import { provisionAction, resetDemoAction, reviewActiveAction, completeDeletionAction } from "./actions";
function Message({ result }: { result: { ok: boolean; message: string } | null }) { return result ? <p role="status" className={result.ok ? "text-sm" : "text-sm text-[var(--danger)]"}>{result.message}</p> : null; }
export function ProvisionForm() {
  const [state, action, pending] = useActionState(provisionAction, null);
  return <form action={action} className="glass-card space-y-3"><h2>Reviewaccounts provisioneren of wachtwoorden wijzigen</h2>
    <p>Genereer drie unieke wachtwoorden in je wachtwoordmanager (minimaal 20 tekens, maximaal 72 UTF-8-bytes). Leeg laten behoudt een bestaand wachtwoord. Ze worden nooit in de pagina teruggestuurd. Voer de gekozen waarden uitsluitend zelf in App Store Connect in.</p>
    {[1,2,3].map(i => <label key={i} className="block">Nieuw wachtwoord Apple Review {i}<input name={`password${i}`} type="password" autoComplete="new-password" className="mt-1 block w-full" /></label>)}
    <button disabled={pending} className="btn-primary">Reviewaccounts opslaan</button><Message result={state} /></form>;
}
export function ResetDemoForm() {
  const [state, action, pending] = useActionState(resetDemoAction, null);
  return <form action={action} className="glass-card space-y-3"><h2>Fictieve gegevens herstellen</h2><p>Beëindigt demosessies en wist uitsluitend de gemarkeerde demogegevens. Tijdens het herstel is demoaanmelding geblokkeerd. Een mislukte reset houdt de demo uitgeschakeld totdat het herstel opnieuw slaagt.</p>
    <label>Typ Ringtools Demo<input name="confirmation" required autoComplete="off" /></label><button disabled={pending} className="btn-ghost">Demo herstellen</button><Message result={state} /></form>;
}
export function ReviewActiveForm({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(reviewActiveAction, null);
  return <form action={action}><input type="hidden" name="userId" value={id} /><input type="hidden" name="active" value={String(!active)} />
    <button disabled={pending} className="btn-ghost">{active ? "Reviewtoegang intrekken" : "Reviewtoegang herstellen"}</button><Message result={state} /></form>;
}
export function CompleteDeletionForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(completeDeletionAction, null);
  return <form action={action} className="space-y-3"><input type="hidden" name="requestId" value={id} />
    <label className="flex gap-2"><input type="checkbox" name="identityChecked" required />Verzoek en identiteit gecontroleerd</label>
    <label className="block">Concrete grondslag voor eventueel noodzakelijk behoud van procesregistraties<textarea name="retentionReason" className="block w-full" placeholder="Alleen een werkelijk vastgestelde grondslag; geen persoonsgegevens of verzonnen bewaarplicht." /></label>
    <p className="text-sm">Open taken, lopende deelname en het laatste ringbeheer moeten eerst via de normale beheerfuncties worden overgedragen. Zonder historische referenties wordt het account volledig gewist. Historische referenties vereisen een afzonderlijk gemotiveerde beoordeling en worden van de accountidentiteit ontdaan; dit is geen garantie van volledige anonimiteit.</p>
    <button disabled={pending} className="btn-danger">Volledig account verwijderen</button><Message result={state} /></form>;
}
