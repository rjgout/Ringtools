import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { PublicShell } from "@/components/public/PublicShell";
import { getCurrentUser } from "@/lib/session";
import { getAccountDeletionStatus, getDeletionReceiptStatus } from "@/lib/accountDeletion";
import { DeletionForm } from "./Form";
export const metadata: Metadata = { title: "Ringtools – accountverwijdering", description: "Vraag de verwijdering van je volledige Ringtools-account aan." };
export const dynamic = "force-dynamic";
export default async function AccountDeletionPage() {
  const user = await getCurrentUser();
  const receipt = (await cookies()).get("ringtools.deletion-receipt")?.value;
  const status = user ? await getAccountDeletionStatus(user.id) : receipt ? await getDeletionReceiptStatus(receipt) : null;
  const labels: Record<string,string> = { REQUESTED: "Ontvangen", IN_REVIEW: "In behandeling", BLOCKED: "Overdracht of beoordeling nodig", COMPLETED: "Account verwijderd" };
  return <PublicShell><section className="glass-card space-y-3"><h1 className="text-xl font-semibold">Accountverwijdering</h1>
    <p>Vraag hier de verwijdering van je volledige account aan. Dit geldt voor alle ringen, ook als je account gedeactiveerd is. In de app vind je dezelfde aanvraag bij Profiel → Account en privacy.</p>
    <p>Na verwerking worden je accountidentiteit, alle lidmaatschappen, sessies, verificatiemethoden, toestelsleutels, pushregistraties en persoonlijke meldingen verwijderd. Dit is geen tijdelijke deactivering. Open taken en de laatste beheerder worden eerst overgedragen. Minimale historische registraties worden uitsluitend met een concreet vastgestelde grondslag tijdelijk gepseudonimiseerd; dat is geen volledige anonimisering.</p>
    <p>Raphael Gout behandelt de wachtrij, met als streeftermijn 14 dagen. Deze termijn is een werkafspraak, geen wettelijke bewaarplicht. Status en voltooiing zijn hier en via het ontvangstbewijs in de app zichtbaar. Bij vertraging: <a className="underline" href="mailto:raphael@ringapeldoorn.nl">raphael@ringapeldoorn.nl</a>. Mailen of bellen is geen vereiste voor het aanvragen.</p>
    {status && <div role="status"><strong>{labels[status.status]}</strong><p>Aangevraagd {new Date(status.requestedAt).toLocaleDateString("nl-NL")} · streefdatum {new Date(status.dueAt).toLocaleDateString("nl-NL")}</p>{status.blockerCount > 0 && <p>De beheerder moet nog verantwoordelijkheid overdragen of bewaargegevens beoordelen.</p>}</div>}
    {!status && <DeletionForm signedIn={!!user} />}
    <Link href="/privacy" className="underline">Privacyverklaring en bewaartermijnen</Link>
  </section></PublicShell>;
}
