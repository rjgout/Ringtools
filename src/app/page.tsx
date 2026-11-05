import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { PublicShell } from "@/components/public/PublicShell";

export const metadata: Metadata = {
  title: "Ringtools – roepingen en ontheffingen",
  description: "Ringtools ondersteunt het ringpresidium bij het beheer van roepingen, ontheffingen en bijbehorende processen. Voor bevoegde gebruikers, in de app en via de website.",
};

/**
 * Publieke startpagina (informatief). Toont nooit gegevens. Wie al is ingelogd (bijv. de geïnstalleerde webapp) gaat direct naar
 * het overzicht; bezoekers zonder sessie zien de uitleg en de knop Inloggen.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <PublicShell>
      <section className="glass-card space-y-4">
        <h1 className="text-2xl font-semibold">Ringtools</h1>
        <p>
          Ringtools helpt het ringpresidium om roepingen en ontheffingen overzichtelijk en zorgvuldig te laten verlopen: van het voorstel en de ondersteuning
          tot de vrijgave, de uitvoering en de administratieve verwerking.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login" className="btn btn-primary">
            Inloggen
          </Link>
          <Link href="/contact" className="btn btn-ghost">
            Contact
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2" aria-label="Over Ringtools">
        <div className="glass-card space-y-2">
          <h2 className="font-semibold">Voor wie is Ringtools?</h2>
          <p className="text-sm">
            Ringtools is bedoeld voor bevoegde gebruikers binnen een ring: het ringpresidium, de ringsecretaris en ringadministrateur, de hoge raad en de
            personen aan wie een taak is toegewezen. Er zijn geen openbare accounts; je wordt door de ringbeheerder uitgenodigd.
          </p>
        </div>
        <div className="glass-card space-y-2">
          <h2 className="font-semibold">Wat kun je ermee?</h2>
          <p className="text-sm">
            Roepingsvoorstellen indienen en ondersteunen, ontheffingen vertrouwelijk behandelen, besluiten uit een vergadering vastleggen, taken
            toewijzen en afronden en alles administratief verwerken. De regels van de kerkelijke procedures blijven leidend; Ringtools neemt geen
            beslissingen en houdt geen ledenregister bij.
          </p>
        </div>
        <div className="glass-card space-y-2">
          <h2 className="font-semibold">De app is het primaire platform</h2>
          <p className="text-sm">
            Ringtools werkt het best in de app voor iPhone en Android: meldingen, uitnodigingen en dagelijks gebruik lopen daarlangs. Links naar de
            app stores volgen zodra de apps zijn gepubliceerd.
          </p>
        </div>
        <div className="glass-card space-y-2">
          <h2 className="font-semibold">Inloggen op de website</h2>
          <p className="text-sm">
            Tijdens een vergadering kun je ook met een laptop via deze website inloggen, met hetzelfde account en dezelfde beveiliging als in de app
            (inlogcode per e-mail, en extra verificatie waar die geldt). Je ziet en doet alleen wat bij jouw rol hoort.
          </p>
          <Link href="/login" className="btn btn-primary">
            Inloggen
          </Link>
        </div>
      </section>

      <section className="glass-card space-y-2">
        <h2 className="font-semibold">Privacy en hulp</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <Link href="/privacy" className="underline">
              Privacy: welke gegevens Ringtools bewaart
            </Link>
          </li>
          <li>
            <Link href="/accountverwijdering" className="underline">
              Accountverwijdering aanvragen
            </Link>
          </li>
          <li>
            <Link href="/contact" className="underline">
              Contact en ondersteuning
            </Link>
          </li>
        </ul>
      </section>
    </PublicShell>
  );
}
