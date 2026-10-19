import type { OndersteuningContext, Role, User } from "@prisma/client";
import { assignTaskAction, completeTaskAction } from "@/lib/actions/calling.actions";
import { formatDate, ROLE_LABELS } from "@/lib/format";
import type { TaskKey } from "@/lib/status";

const CONTEXT_LABELS: Record<OndersteuningContext, string> = {
  AVONDMAALSVERGADERING: "Avondmaalsvergadering",
  RINGCONFERENTIE: "Ringconferentie",
};

export function TaskRow({
  callingId,
  task,
  label,
  assignee,
  assigneeRole,
  doneBy,
  doneAt,
  ondersteunenContext,
  canApproved,
  canAssign,
  canComplete,
  users,
}: {
  callingId: string;
  task: TaskKey;
  label: string;
  assignee: User | null;
  /** Rol van de verantwoordelijke binnen de ring van dit voorstel. */
  assigneeRole?: Role | null;
  doneBy: User | null;
  doneAt: Date | null;
  ondersteunenContext?: OndersteuningContext | null;
  canApproved: boolean;
  canAssign: boolean;
  canComplete: boolean;
  users: { id: string; name: string; role: Role }[];
}) {
  return (
    <div className="glass-panel space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{label}</h3>
        {doneAt ? (
          <span className="badge badge-success">Afgerond</span>
        ) : (
          <span className="badge badge-pending">Nog niet afgerond</span>
        )}
      </div>

      {doneAt ? (
        <p className="text-sm text-[var(--text-muted)]">
          Uitgevoerd door {doneBy?.name ?? "onbekend"} op {formatDate(doneAt)}
          {ondersteunenContext ? ` tijdens ${CONTEXT_LABELS[ondersteunenContext]}` : ""}.
        </p>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          {assignee
            ? `Toegewezen aan ${assignee.name}${assigneeRole ? ` (${ROLE_LABELS[assigneeRole]})` : ""}.`
            : "Nog niet toegewezen."}
        </p>
      )}

      {canAssign && !doneAt && (
        <form action={assignTaskAction} className="flex items-end gap-2">
          <input type="hidden" name="callingId" value={callingId} />
          <input type="hidden" name="task" value={task} />
          <select name="assigneeId" defaultValue={assignee?.id || ""} className="input !py-2 text-sm">
            <option value="">Nog niet toewijzen</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({ROLE_LABELS[u.role]})
              </option>
            ))}
          </select>
          <button type="submit" className="btn-ghost !min-h-[38px] !px-4 text-sm">
            Opslaan
          </button>
        </form>
      )}

      {canApproved && canComplete && !doneAt && (
        <form action={completeTaskAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <input type="hidden" name="callingId" value={callingId} />
          <input type="hidden" name="task" value={task} />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Werkelijke uitvoeringsdatum</label>
              <input type="date" name="doneAt" required defaultValue={new Date().toISOString().slice(0, 10)} className="input !py-2 text-sm" />
            </div>
            {task === "ONDERSTEUNEN" && (
              <div>
                <label className="label">Gelegenheid</label>
                <select name="ondersteunenContext" required className="input !py-2 text-sm">
                  <option value="AVONDMAALSVERGADERING">Avondmaalsvergadering</option>
                  <option value="RINGCONFERENTIE">Ringconferentie</option>
                </select>
              </div>
            )}
          </div>
          <button type="submit" className="btn-primary !min-h-[38px]">
            Markeer als uitgevoerd
          </button>
        </form>
      )}
    </div>
  );
}
