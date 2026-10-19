"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/lib/actions/notification.actions";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  targetUrl: string;
  readAt: string | null;
  createdAt: string;
};

const TYPE_ICON: Record<string, string> = {
  NEW_PROPOSAL: "🗳️",
  ADVANCED_TO_HOGERAAD: "⬆️",
  REINVITE: "🔁",
  PAUSED: "⏸️",
  TASK_ASSIGNED: "📌",
  TASK_COMPLETED: "✅",
  REMINDER_30_DAYS: "⏰",
};

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function NotificationPanel({
  onClose,
  onUnreadCountChange,
  onNotificationsChanged,
}: {
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
  onNotificationsChanged: () => void;
}) {
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : { notifications: [], unreadCount: 0 }))
      .then(({ notifications, unreadCount }: { notifications: NotificationItem[]; unreadCount: number }) => {
        if (cancelled) return;
        setNotifications(notifications);
        onUnreadCountChange(unreadCount);
      })
      .catch(() => {
        if (!cancelled) setNotifications([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openNotification(n: NotificationItem) {
    onClose();
    if (!n.readAt) {
      setNotifications((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? prev);
      onUnreadCountChange(Math.max(0, (notifications?.filter((x) => !x.readAt).length ?? 1) - 1));
      // Niet wachten op het opslaan van de gelezen-status: de navigatie naar
      // de doelpagina (die zelf opnieuw rechten controleert) mag niet
      // vertraagd worden door deze server-aanroep.
      void markNotificationReadAction(n.id).then(onNotificationsChanged);
    }
    router.push(n.targetUrl);
  }

  async function markAllRead() {
    setNotifications((prev) => prev?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? prev);
    onUnreadCountChange(0);
    await markAllNotificationsReadAction();
    onNotificationsChanged();
  }

  const unreadCount = notifications?.filter((n) => !n.readAt).length ?? 0;

  return (
    <>
      <div className="notif-backdrop" onClick={onClose} aria-hidden />
      <div className="notif-panel glass" role="dialog" aria-label="Meldingen">
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/5">
          <h2 className="font-semibold">Meldingen</h2>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-[var(--primary)]">
                Alles als gelezen markeren
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Sluiten" className="text-lg leading-none text-[var(--text-muted)] sm:hidden">
              ✕
            </button>
          </div>
        </div>

        <div className="notif-list">
          {notifications === null && <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Laden…</p>}

          {notifications !== null && notifications.length === 0 && (
            <div className="px-6 py-10 text-center">
              <div className="mb-2 text-3xl" aria-hidden>
                ✨
              </div>
              <p className="font-medium">Je bent helemaal bij!</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Geen nieuwe meldingen.</p>
            </div>
          )}

          {notifications?.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openNotification(n)}
              className={`notif-item ${!n.readAt ? "notif-item--unread" : ""}`}
            >
              <span className="notif-item__icon" aria-hidden>
                {TYPE_ICON[n.type] ?? "🔔"}
              </span>
              <span className="notif-item__body">
                <span className="notif-item__title">{n.title}</span>
                <span className="notif-item__message">{n.message}</span>
                <span className="notif-item__date">{formatWhen(n.createdAt)}</span>
              </span>
              {!n.readAt && <span className="notif-item__dot" aria-hidden />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
