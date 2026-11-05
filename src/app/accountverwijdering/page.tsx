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
          Accounts worden niet door gebruikers zelf aangemaakt maar door de ringbeheerder aangemaakt via een uitnodiging. Verwijdering verloopt daarom ook via de
          ring.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Vraag de ringbeheerder van jouw ring om je account te verwijderen of je lidmaatschap te beëindigen.</li>
          {email ? (
            <li>
              Lukt dat niet? Mail dan vanaf het e-mailadres van je account naar{" "}
              <a className="underline" href={`mailto:${email}`}>
                {email}
              </a>
              .
            </li>
          ) : (
            <li>Lukt dat niet, dan kan de ringbeheerder het technisch beheer inschakelen.</li>
          )}
          <li>Bij verwijdering worden je account en de bijbehorende apparaten, sessies en pushtokens verwijderd.</li>
        </ol>
        <p className="text-sm">
          Voor voorstellen en besluiten gelden vaste bewaartermijnen; zie{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          .
        </p>
      </section>
    </PublicShell>
  );
}
