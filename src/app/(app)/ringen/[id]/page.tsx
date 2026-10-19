import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { listRingMembers } from "@/lib/rings";
import { phaseLabel } from "@/lib/status";
import { AddMemberForm } from "@/app/(app)/gebruikers/UserForm";
import { MemberList } from "@/components/MemberList";
import { DeleteCallingButton } from "@/components/DeleteCallingButton";
import { RenameRingForm } from "../CreateRingForm";

export default async function RingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;

  const ring = await prisma.ring.findUnique({ where: { id } });
  if (!ring) notFound();

  const [members, callings, allUsers] = await Promise.all([
    listRingMembers(ring.id),
    prisma.calling.findMany({
      where: { ringId: ring.id, status: { not: "PROCESSED" } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { role: { not: "ADMIN" }, memberships: { none: { ringId: ring.id } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return (
    <div className="space-y-5 py-4">
      <div>
        <Link href="/ringen" className="text-sm text-[var(--text-muted)] underline">
          ← Alle ringen
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{ring.name}</h1>
      </div>

      <div className="glass-card">
        <RenameRingForm ringId={ring.id} name={ring.name} />
      </div>

      <AddMemberForm ringId={ring.id} existingUsers={allUsers} />

      <section className="space-y-3">
        <h2 className="font-semibold">Gebruikers van deze ring</h2>
        <MemberList members={members} viewerIsAdmin />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Roepingsvoorstellen</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Als systeembeheerder kun je een niet-verwerkt voorstel van deze ring definitief verwijderen (bijvoorbeeld een dubbel of
          per ongeluk aangemaakt voorstel).
        </p>
        {callings.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Geen openstaande voorstellen.</p>
        ) : (
          callings.map((c) => (
            <div key={c.id} className="glass-panel flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">{c.personName}</div>
                <div className="text-sm text-[var(--text-muted)]">
                  {c.functionTitle} · {phaseLabel(c)}
                </div>
              </div>
              <DeleteCallingButton callingId={c.id} />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
