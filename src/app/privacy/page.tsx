import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public/PublicShell";

export const metadata: Metadata = { title: "Ringtools – privacy", description: "Welke gegevens Ringtools bewaart en hoe lang." };

export default function PrivacyPage() {
  return (
    <PublicShell>
      <section className="glass-card space-y-3">
        <h1 className="text-xl font-semibold">Privacy</h1>
        <p className="badge badge-neutral inline-block">Concept – nog vast te stellen door de eigenaar</p>
        <p className="text-sm">
          Ringtools bewaart zo weinig mogelijk. De gegevens staan in een eigen database op een server van het beheer (niet bij een externe clouddatabase), worden via een beveiligde verbinding
          verzonden en zijn alleen zichtbaar voor bevoegde leden van dezelfde ring. Er zijn geen advertenties, geen analytics van derden en geen verkoop van gegevens.
        </p>
        <h2 className="font-semibold">Welke gegevens</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>Account:</strong> naam, e-mailadres, rol en functie, ringlidmaatschap. Zolang het account bestaat; verwijdering op verzoek, handmatig door het technisch beheer.
          </li>
          <li>
            <strong>Roepingsvoorstellen:</strong> naam van de kandidaat en de functie, ondersteuning, taken. Verwerkte voorstellen worden 30 dagen na verwerking
            verwijderd; concepten die niet zijn ingediend verdwijnen na 30 dagen.
          </li>
          <li>
            <strong>Ontheffingen:</strong> vertrouwelijk, alleen zichtbaar voor de bevoegden in de procedure en nooit voor de betrokkene zelf. Verwerkte dossiers
            worden 30 dagen na verwerking verwijderd.
          </li>
          <li>
            <strong>Uitnodigingen:</strong> naam, e-mailadres, rol en status (de code zelf alleen als onleesbare controlewaarde); verwijderd 90 dagen na activatie,
            verlopen of intrekken.
          </li>
          <li>
            <strong>Beveiliging:</strong> sessies en apparaten, pushtokens, en een beveiligingslogboek zonder geheimen.
          </li>
        </ul>
        <p className="text-sm">
          Ringtools maakt geen blijvend ledenregister en neemt geen persoonsgegevens over uit het ledensysteem van de Kerk; alleen wat nodig is voor een lopend
          voorstel wordt tijdelijk bewaard.
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          Dit is een beknopte uitleg. De definitieve privacyverklaring wordt door de eigenaar van Ringtools vastgesteld. Een verzoek tot inzage of verwijdering: zie{" "}
          <Link href="/accountverwijdering" className="underline">
            Accountverwijdering
          </Link>{" "}
          en{" "}
          <Link href="/contact" className="underline">
            Contact
          </Link>
          .
        </p>
      </section>
    </PublicShell>
  );
}
