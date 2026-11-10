import type { Metadata } from "next";
import { PublicShell } from "@/components/public/PublicShell";

export const metadata: Metadata = { title: "Ringtools – contact", description: "Hulp en contact voor gebruikers van Ringtools." };
export const dynamic = "force-dynamic";

export default function ContactPage() {
  const email = "raphael@ringapeldoorn.nl";
  return (
    <PublicShell>
      <section className="glass-card space-y-3">
        <h1 className="text-xl font-semibold">Contact</h1>
        <p className="text-sm">
          Heb je een vraag over Ringtools, over inloggen of over je account? Neem dan eerst contact op met de ringbeheerder van jouw ring. Die kan je
          uitnodigen, je rol aanpassen en samen met de technisch beheerder problemen met je account oplossen.
        </p>
        {email ? (
          <p className="text-sm">
            Contactpersoon Raphael Gout. Technische vragen of een privacyverzoek kun je mailen naar{" "}
            <a className="underline" href={`mailto:${email}`}>
              {email}
            </a>
            .
          </p>
        ) : (
          <p className="text-sm">Technische vragen en privacyverzoeken loop je via de ringbeheerder van jouw ring; die schakelt zo nodig het technisch beheer in.</p>
        )}
        <p className="text-xs text-[var(--text-muted)]">Stuur nooit je inlogcode of activeringscode naar iemand; ook het beheer vraagt daar nooit om.</p>
      </section>
    </PublicShell>
  );
}
