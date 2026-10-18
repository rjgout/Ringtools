import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listCallings, type CallingFilter } from "@/lib/queries";
import { phaseLabel } from "@/lib/status";
import { formatDate } from "@/lib/format";

const FILTERS: { key: CallingFilter; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "presidium", label: "Bij ringpresidium" },
  { key: "hogeraad", label: "Bij hoge raad" },
  { key: "gepauzeerd", label: "Gepauzeerd" },
  { key: "goedgekeurd", label: "Goedgekeurd" },
  { key: "roepen", label: "Nog te roepen" },
  { key: "ondersteunen", label: "Nog te ondersteunen" },
  { key: "aanstellen", label: "Nog aan te stellen" },
  { key: "verwerken", label: "Te verwerken" },
];

export default async function RoepingenPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireRole(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"]);
  const { filter: filterRaw } = await searchParams;
  const filter = (FILTERS.some((f) => f.key === filterRaw) ? filterRaw : "alle") as CallingFilter;

  const callings = await listCallings(filter);

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Roepingen</h1>
        <Link href="/roepingen/nieuw" className="btn-primary !min-h-[40px] !px-4 text-sm">
          + Nieuwe roeping
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <a
            key={f.key}
            href={`/roepingen?filter=${f.key}`}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${
              filter === f.key ? "glass" : "text-[var(--text-muted)]"
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      {callings.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Geen roepingen in dit overzicht.</p>
      ) : (
        <div className="space-y-2">
          {callings.map((c) => (
            <a key={c.id} href={`/roepingen/${c.id}`} className="glass-panel flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{c.personName}</div>
                <div className="text-sm text-[var(--text-muted)]">{c.functionTitle}</div>
                <div className="text-xs text-[var(--text-muted)]">Aangemaakt op {formatDate(c.createdAt)}</div>
              </div>
              <span
                className={`badge ${
                  c.status.endsWith("PAUSED") ? "badge-danger" : c.status === "APPROVED" ? "badge-success" : "badge-pending"
                }`}
              >
                {phaseLabel(c)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
