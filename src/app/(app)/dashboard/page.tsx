import Link from "next/link";
import { requireUser } from "@/lib/session";
import { requireRingContext } from "@/lib/ringContext";
import { isStaff } from "@/lib/rbac";
import { getStaffDashboardCounts, listAttentionCallingsForStaff, getHogeraadOverview } from "@/lib/queries";
import { phaseLabel } from "@/lib/status";
import { StatCard } from "@/components/StatCard";

export default async function DashboardPage() {
  const user = await requireUser();

  if (user.role === "ADMIN") {
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

  const ctx = await requireRingContext();

  if (isStaff(ctx.membership.role)) {
    const [counts, attention] = await Promise.all([
      getStaffDashboardCounts(ctx.ring.id),
      listAttentionCallingsForStaff(ctx.ring.id),
    ]);
    return (
      <div className="space-y-6 py-4">
        <h1 className="text-xl font-semibold">Welkom, {user.name}</h1>
        <p className="-mt-4 text-sm text-[var(--text-muted)]">{ctx.ring.name}</p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Bij ringpresidium" value={counts.presidium} href="/roepingen?filter=presidium" />
          <StatCard label="Bij hoge raad" value={counts.hogeraad} href="/roepingen?filter=hogeraad" />
          <StatCard label="Gepauzeerd" value={counts.paused} href="/roepingen?filter=gepauzeerd" tone="danger" />
          <StatCard label="Goedgekeurd" value={counts.approved} href="/roepingen?filter=goedgekeurd" />
          <StatCard label="Nog te roepen" value={counts.roepenOpen} href="/roepingen?filter=roepen" />
          <StatCard label="Nog te ondersteunen" value={counts.ondersteunenOpen} href="/roepingen?filter=ondersteunen" />
          <StatCard label="Nog aan te stellen" value={counts.aanstellenOpen} href="/roepingen?filter=aanstellen" />
          <StatCard label="Te verwerken" value={counts.readyToProcess} href="/roepingen?filter=verwerken" tone="success" />
        </div>

        {attention.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Vraagt aandacht</h2>
            <div className="space-y-2">
              {attention.map((c) => (
                <a key={c.id} href={`/roepingen/${c.id}`} className="glass-panel flex items-center justify-between">
                  <div>
                    <div className="font-medium">{c.personName}</div>
                    <div className="text-sm text-[var(--text-muted)]">{c.functionTitle}</div>
                  </div>
                  <span className="badge badge-danger">{phaseLabel(c)}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <Link href="/roepingen/nieuw" className="btn-primary fixed bottom-24 right-4 sm:static sm:w-auto">
          + Nieuwe roeping
        </Link>
      </div>
    );
  }

  // HOGERAAD
  const { pendingVotes, tasks } = await getHogeraadOverview(user.id, ctx.ring.id);
  return (
    <div className="space-y-6 py-4">
      <h1 className="text-xl font-semibold">Welkom, {user.name}</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Jouw openstaande ondersteuningsverzoeken</h2>
        {pendingVotes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Je hebt geen openstaande ondersteuningsverzoeken.</p>
        ) : (
          <div className="space-y-2">
            {pendingVotes.map((c) => (
              <a key={c.id} href={`/roepingen/${c.id}`} className="glass-panel flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.personName}</div>
                  <div className="text-sm text-[var(--text-muted)]">{c.functionTitle}</div>
                </div>
                <span className="badge badge-pending">Ondersteuning uitbrengen</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-muted)]">Jouw taken</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Je hebt geen openstaande taken.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((c) => (
              <a key={c.id} href={`/roepingen/${c.id}`} className="glass-panel flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.personName}</div>
                  <div className="text-sm text-[var(--text-muted)]">{c.functionTitle}</div>
                </div>
                <span className="badge badge-pending">Taak afhandelen</span>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
