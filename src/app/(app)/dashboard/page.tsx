import Link from "next/link";
import { requireUser } from "@/lib/session";

/**
 * Overzicht van de systeembeheerder (webmin). Gewone gebruikers werken in de gedeelde interface onder /app; de layout van `(app)`
 * verwijst hen vóór dit scherm door (zie `src/lib/webAppRedirect.ts`).
 */
export default async function DashboardPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") return null;
  return (
    <div className="space-y-4 py-4">
      <h1 className="text-xl font-semibold">Welkom, {user.name}</h1>
      <p className="text-[var(--text-muted)]">
        Als systeembeheerder beheer je de ringen, hun ringbeheerders en de technische instellingen van Ringtools.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/ringen" className="glass-card block">
          <div className="text-lg font-semibold">Ringbeheer</div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Ringen aanmaken, ringbeheerders aanwijzen en gebruikers beheren.</p>
        </Link>
        <a href="/instellingen" className="glass-card block">
          <div className="text-lg font-semibold">Instellingen</div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">SMTP-configuratie en wachtwoord beheren.</p>
        </a>
      </div>
    </div>
  );
}
