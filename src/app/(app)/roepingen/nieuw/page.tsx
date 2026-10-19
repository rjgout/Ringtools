import { requireRingRole } from "@/lib/ringContext";
import { STAFF_ROLES } from "@/lib/rbac";
import { listActiveUsers } from "@/lib/queries";
import { NewCallingForm } from "./NewCallingForm";

export default async function NewCallingPage() {
  const ctx = await requireRingRole(STAFF_ROLES);
  const users = await listActiveUsers(ctx.ring.id);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4">
      <h1 className="text-xl font-semibold">Nieuwe roeping</h1>
      <p className="text-sm text-[var(--text-muted)]">
        Na het indienen ontvangen alle actieve leden van het ringpresidium automatisch een persoonlijk ondersteuningsverzoek.
      </p>
      <NewCallingForm users={users} />
    </div>
  );
}
