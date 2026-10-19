import type { Role } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/format";
import { EditMemberForm } from "@/app/(app)/gebruikers/UserForm";
import { ResetMfaButton } from "@/components/mfa/ResetMfaButton";

type Member = {
  id: string;
  userId: string;
  role: Role;
  churchFunction: string;
  isRingManager: boolean;
  active: boolean;
  otherRingCount: number;
  user: { name: string; email: string };
};

/** Gebruikerslijst van één ring; gedeeld door het scherm van de ringbeheerder en dat van de webmin. */
export function MemberList({ members, viewerIsAdmin }: { members: Member[]; viewerIsAdmin: boolean }) {
  if (members.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nog geen gebruikers in deze ring.</p>;
  }
  return (
    <div className="space-y-3">
      {members.map((m) => (
        <details key={m.id} className="glass-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div>
              <div className="font-medium">{m.user.name}</div>
              <div className="text-sm text-[var(--text-muted)]">
                {m.user.email} · {ROLE_LABELS[m.role]}
                {m.churchFunction ? ` · ${m.churchFunction}` : ""}
              </div>
            </div>
            <span className="flex flex-wrap justify-end gap-1.5">
              {m.isRingManager && <span className="badge badge-neutral">Ringbeheerder</span>}
              <span className={`badge ${m.active ? "badge-success" : "badge-danger"}`}>{m.active ? "Actief" : "Gedeactiveerd"}</span>
            </span>
          </summary>
          <EditMemberForm
            membership={{
              id: m.id,
              name: m.user.name,
              email: m.user.email,
              role: m.role,
              churchFunction: m.churchFunction,
              isRingManager: m.isRingManager,
              active: m.active,
            }}
            canEditProfile={viewerIsAdmin || m.otherRingCount === 0}
          />
          {viewerIsAdmin && <ResetMfaButton userId={m.userId} userName={m.user.name} />}
        </details>
      ))}
    </div>
  );
}
