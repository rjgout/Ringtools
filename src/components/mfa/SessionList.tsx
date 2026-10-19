"use client";

import { useActionState } from "react";
import { revokeSessionAction, type ActionResult } from "@/lib/actions/mfa.actions";
import { formatDateTime } from "@/lib/format";

const initialState: ActionResult = { ok: false, message: "" };

type SessionRow = { id: string; userAgent: string | null; createdAt: Date; expiresAt: Date };

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Onbekend apparaat";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android-apparaat";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows-pc";
  return "Apparaat";
}

function SessionRowItem({ session, isCurrent }: { session: SessionRow; isCurrent: boolean }) {
  const [state, action, pending] = useActionState(revokeSessionAction, initialState);

  return (
    <li className="space-y-1 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">
            {deviceLabel(session.userAgent)} {isCurrent && <span className="badge badge-success ml-1">dit apparaat</span>}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Ingelogd op {formatDateTime(session.createdAt)} · verloopt {formatDateTime(session.expiresAt)}
          </div>
        </div>
        {!isCurrent && (
          <form action={action}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button type="submit" disabled={pending} className="btn-ghost !min-h-[32px] !px-3 text-xs">
              {pending ? "…" : "Beëindig"}
            </button>
          </form>
        )}
      </div>
      {state.message && <p className={state.ok ? "text-xs text-[var(--success)]" : "text-xs text-[var(--danger)]"}>{state.message}</p>}
    </li>
  );
}

export function SessionList({ sessions, currentSessionId }: { sessions: SessionRow[]; currentSessionId: string }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Geen actieve sessies gevonden.</p>;
  }

  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <SessionRowItem key={s.id} session={s} isCurrent={s.id === currentSessionId} />
      ))}
    </ul>
  );
}
