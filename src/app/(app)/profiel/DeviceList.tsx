import { removeSubscriptionAction } from "@/lib/actions/push.actions";
import { formatDateTime } from "@/lib/format";

function labelFor(userAgent: string | null): string {
  if (!userAgent) return "Onbekend apparaat";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android-apparaat";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows-pc";
  return "Apparaat";
}

export function DeviceList({
  subscriptions,
}: {
  subscriptions: { id: string; userAgent: string | null; createdAt: Date }[];
}) {
  if (subscriptions.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nog geen apparaten geregistreerd voor pushnotificaties.</p>;
  }

  return (
    <ul className="space-y-2">
      {subscriptions.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
          <span>
            {labelFor(s.userAgent)} <span className="text-[var(--text-muted)]">· sinds {formatDateTime(s.createdAt)}</span>
          </span>
          <form action={removeSubscriptionAction}>
            <input type="hidden" name="id" value={s.id} />
            <button type="submit" className="btn-ghost !min-h-[32px] !px-3 text-xs">
              Verwijderen
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
