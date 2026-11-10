import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ProvisionForm, ResetDemoForm, ReviewActiveForm, CompleteDeletionForm } from "./Forms";
export default async function ReviewManagementPage() {
  await requireRole(["ADMIN"]);
  const users = await prisma.user.findMany({ where: { accountKind: "REVIEW" }, select: { id: true, name: true, email: true, role: true, active: true }, orderBy: { email: "asc" } });
  const requests = await prisma.accountDeletionRequest.findMany({ where: { status: { not: "COMPLETED" } }, include: { user: { select: { name: true, email: true, active: true } } }, orderBy: { dueAt: "asc" } });
  return <div className="space-y-5 py-4"><h1>App Review en accountverwijdering</h1><p>Uitsluitend technisch beheer. Alle wijzigingen vereisen recente beheerders-MFA.</p>
    <ProvisionForm /><section className="glass-card space-y-3"><h2>Speciale reviewaccounts</h2>{users.map(u => <div key={u.id}><strong>{u.name}</strong> · {u.email} · {u.role} · {u.active ? "actief" : "ingetrokken"}<ReviewActiveForm id={u.id} active={u.active} /></div>)}</section><ResetDemoForm />
    <section className="space-y-4"><h2>Verwijderwachtrij</h2><p>Raphael Gout behandelt de verzoeken via deze wachtrij. Operationele streeftermijn: 14 dagen. Controleer de wachtrij regelmatig; dit is geen automatische toezegging van een juridische grondslag.</p>
      {requests.length === 0 && <p>Geen open verzoeken.</p>}{requests.map(r => <article key={r.id} className="glass-card space-y-3"><h3>{r.user?.name ?? "Verzoek"}</h3><p>{r.user?.email} · {r.status} · streefdatum {r.dueAt.toISOString().slice(0,10)} · {r.user?.active ? "actief" : "gedeactiveerd"}</p><CompleteDeletionForm id={r.id} /></article>)}
    </section></div>;
}
