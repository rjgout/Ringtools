import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/format";
import { CreateUserForm, EditUserForm } from "./UserForm";

export default async function GebruikersPage() {
  await requireRole(["ADMIN", "RINGPRESIDIUM", "RINGSECRETARIS", "RINGADMINISTRATEUR"]);

  const users = await prisma.user.findMany({
    where: { role: { not: "ADMIN" } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-5 py-4">
      <h1 className="text-xl font-semibold">Gebruikersbeheer</h1>
      <p className="text-sm text-[var(--text-muted)]">
        Nieuwe gebruikers loggen in met hun e-mailadres (inloglink). Er is geen openbare registratiepagina.
      </p>

      <CreateUserForm />

      <div className="space-y-3">
        {users.map((u) => (
          <details key={u.id} className="glass-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <div className="font-medium">{u.name}</div>
                <div className="text-sm text-[var(--text-muted)]">
                  {u.email} · {ROLE_LABELS[u.role]}
                </div>
              </div>
              <span className={`badge ${u.active ? "badge-success" : "badge-danger"}`}>{u.active ? "Actief" : "Gedeactiveerd"}</span>
            </summary>
            <EditUserForm user={u} />
          </details>
        ))}
        {users.length === 0 && <p className="text-sm text-[var(--text-muted)]">Nog geen gebruikers aangemaakt.</p>}
      </div>
    </div>
  );
}
