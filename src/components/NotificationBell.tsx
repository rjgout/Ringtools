"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NotificationPanel } from "./NotificationPanel";

const POLL_INTERVAL_MS = 20000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) return;
      const { count } = (await res.json()) as { count: number };
      setUnreadCount(count);
    } catch {
      // stil negeren: de bel probeert het gewoon bij de volgende poll opnieuw
    }
  }, []);

  useEffect(() => {
    // Eerste stand ophalen na mount, daarna lichte polling — alleen terwijl
    // het tabblad zichtbaar is (voorkomt onnodige databasebelasting als de
    // app op de achtergrond staat).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshUnreadCount();
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => void refreshUnreadCount(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshUnreadCount();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Meldingen, ${unreadCount} ongelezen` : "Meldingen"}
        aria-expanded={open}
        className="btn-ghost relative !min-h-[38px] !w-[38px] !p-0 text-lg"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[0.65rem] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationPanel
          onClose={() => setOpen(false)}
          onUnreadCountChange={setUnreadCount}
          onNotificationsChanged={refreshUnreadCount}
        />
      )}
    </div>
  );
}
