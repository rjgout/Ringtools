import { requireRole } from "@/lib/session";
import { listActiveUsers } from "@/lib/queries";
import { NewCallingForm } from "./NewCallingForm";

export default async function NewCallingPage() {
  await requireRole(["RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"]);
  const users = await listActiveUsers();

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4">
      <h1 className="text-xl font-semibold">Nieuwe roeping</h1>
      <p className="text-sm text-[var(--text-muted)]">
        Na het indienen ontvangen alle actieve leden van het ringpresidium automatisch een e-mail om te stemmen.
      </p>
      <NewCallingForm users={users} />
    </div>
  );
}
