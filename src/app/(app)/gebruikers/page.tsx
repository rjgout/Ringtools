import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { requireRingManager } from "@/lib/ringContext";
import { listRingMembers } from "@/lib/rings";
import { AddMemberForm } from "./UserForm";
import { MemberList } from "@/components/MemberList";

export default async function GebruikersPage() {
  const user = await requireUser();
  // De webmin beheert gebruikers per ring via het ringbeheer.
  if (user.role === "ADMIN") redirect("/ringen");

  const ctx = await requireRingManager();
  const members = await listRingMembers(ctx.ring.id);

  return (
    <div className="space-y-5 py-4">
      <div>
        <h1 className="text-xl font-semibold">Gebruikersbeheer</h1>
        <p className="text-sm text-[var(--text-muted)]">{ctx.ring.name}</p>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        Nieuwe gebruikers loggen in met hun e-mailadres (inloglink). Er is geen openbare registratiepagina. Kerkelijke functie en
        rol binnen Ringtools zijn gescheiden: de functie geeft geen rechten, de rol bepaalt wat iemand in Ringtools mag.
      </p>

      <AddMemberForm ringId={ctx.ring.id} />

      <MemberList members={members} viewerIsAdmin={false} />
    </div>
  );
}
