"use client";

import { useEffect, useState } from "react";
import { subscribePushAction, unsubscribePushAction, sendTestPushAction } from "@/lib/actions/push.actions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

type Status = "checking" | "unsupported" | "needs-install" | "denied" | "subscribed" | "available";

export function PushNotificationCard({ publicKey }: { publicKey: string | null }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshStatus() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      setStatus("unsupported");
      return;
    }
    if (isIOS() && !isStandalone()) {
      setStatus("needs-install");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    setStatus(existing ? "subscribed" : "available");
  }

  useEffect(() => {
    // Eenmalige statuscontrole na mount (vraagt o.a. de bestaande
    // push-subscription van de browser op); bevat zelf geen directe
    // setState-aanroep, alleen binnen de async refreshStatus()-functie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus();
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "available");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const result = await subscribePushAction(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, navigator.userAgent);
      setMessage(result.message);
      setStatus(result.ok ? "subscribed" : "available");
    } catch (err) {
      console.error(err);
      setMessage("Inschakelen van pushnotificaties is mislukt.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePushAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("available");
      setMessage("Pushnotificaties zijn uitgeschakeld voor dit apparaat.");
    } catch (err) {
      console.error(err);
      setMessage("Uitschakelen is mislukt.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    const result = await sendTestPushAction();
    setMessage(result.message);
    setBusy(false);
  }

  return (
    <div className="glass-card space-y-3">
      <h2 className="font-semibold">Pushnotificaties</h2>

      {!publicKey && (
        <p className="text-sm text-[var(--text-muted)]">
          Pushnotificaties zijn nog niet geconfigureerd door de systeembeheerder.
        </p>
      )}

      {publicKey && status === "checking" && <p className="text-sm text-[var(--text-muted)]">Status controleren…</p>}

      {publicKey && status === "unsupported" && (
        <p className="text-sm text-[var(--text-muted)]">
          Je browser ondersteunt geen pushnotificaties. Ringtools blijft verder gewoon werken.
        </p>
      )}

      {publicKey && status === "needs-install" && (
        <p className="text-sm text-[var(--text-muted)]">
          Zet Ringtools eerst op je beginscherm (zie &quot;App installeren&quot; hierboven) — op iPhone/iPad werken
          pushnotificaties alleen in de geïnstalleerde app, niet in Safari zelf.
        </p>
      )}

      {publicKey && status === "denied" && (
        <p className="text-sm text-[var(--text-muted)]">
          Meldingen zijn geblokkeerd voor Ringtools. Wijzig dit in de systeeminstellingen van je apparaat of browser om
          pushnotificaties te ontvangen.
        </p>
      )}

      {publicKey && status === "available" && (
        <button type="button" disabled={busy} onClick={enable} className="btn-primary">
          🔔 Pushnotificaties inschakelen
        </button>
      )}

      {publicKey && status === "subscribed" && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--success)]">✓ Pushnotificaties staan aan voor dit apparaat.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={sendTest} className="btn-ghost !min-h-[38px] text-sm">
              Testnotificatie versturen
            </button>
            <button type="button" disabled={busy} onClick={disable} className="btn-ghost !min-h-[38px] text-sm">
              Uitschakelen
            </button>
          </div>
        </div>
      )}

      {message && <p className="text-sm text-[var(--text-muted)]">{message}</p>}
    </div>
  );
}
