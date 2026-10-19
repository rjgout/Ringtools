import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { listRingsOverview } from "@/lib/rings";
import { CreateRingForm } from "./CreateRingForm";

export default async function RingenPage() {
  await requireRole(["ADMIN"]);

  const [rings, users] = await Promise.all([
    listRingsOverview(),
    prisma.user.findMany({
      where: { role: { not: "ADMIN" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return (
    <div className="space-y-5 py-4">
      <div>
        <h1 className="text-xl font-semibold">Ringbeheer</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Alleen de systeembeheerder kan ringen aanmaken. Elke ring beheert daarna zelf zijn gebruikers via de ringbeheerder.
        </p>
      </div>

      <div className="space-y-3">
        {rings.length === 0 && <p className="text-sm text-[var(--text-muted)]">Er zijn nog geen ringen.</p>}
        {rings.map((r) => (
          <Link key={r.id} href={`/ringen/${r.id}`} className="glass-card block">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-lg font-semibold">{r.name}</div>
              <span className="badge badge-neutral">
                {r.memberCount} {r.memberCount === 1 ? "gebruiker" : "gebruikers"}
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Ringbeheerder{r.managers.length === 1 ? "" : "s"}: {r.managers.length > 0 ? r.managers.join(", ") : "geen actieve ringbeheerder"}
            </p>
          </Link>
        ))}
      </div>

      <CreateRingForm existingUsers={users} />
    </div>
  );
}
