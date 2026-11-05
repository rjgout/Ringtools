import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";
import { PublicShell } from "@/components/public/PublicShell";

export const metadata: Metadata = { title: "Ringtools – accountverwijdering", description: "Hoe je de verwijdering van je Ringtools-account aanvraagt." };
export const dynamic = "force-dynamic";

export default function AccountDeletionPage() {
  const email = env.contactEmail;
  return (
    <PublicShell>
      <section className="glass-card space-y-3">
        <h1 className="text-xl font-semibold">Accountverwijdering</h1>
        <p className="text-sm">
          Accounts worden niet door gebruikers zelf aangemaakt maar door de ringbeheerder aangemaakt via een uitnodiging. Er is geen knop om zelf je account te verwijderen;
          een verzoek loopt via de ring en het technisch beheer.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Vraag de ringbeheerder van jouw ring om je lidmaatschap te beëindigen. De ringbeheerder kan je toegang tot de ring direct stopzetten.</li>
          {email ? (
            <li>
              Wil je dat ook je accountgegevens worden verwijderd, mail dan vanaf het e-mailadres van je account naar{" "}
              <a className="underline" href={`mailto:${email}`}>
                {email}
              </a>
              .
            </li>
          ) : (
            <li>Wil je dat ook je accountgegevens worden verwijderd, vraag de ringbeheerder dan het technisch beheer in te schakelen.</li>
          )}
          <li>Het technisch beheer handelt zo&apos;n verzoek handmatig af. Er is nog geen vaste behandeltermijn vastgesteld.</li>
        </ol>
        <p className="text-sm">
          Voor voorstellen, ontheffingen en uitnodigingen gelden vaste bewaartermijnen; zie{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          .
        </p>
        <p className="text-xs text-[var(--text-muted)]">Conceptinformatie: de definitieve procedure wordt door de eigenaar van Ringtools vastgesteld.</p>
      </section>
    </PublicShell>
  );
}
