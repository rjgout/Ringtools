import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { useConfirm } from "../components/Dialog";
import { ActionMenu, MENU_ICONS } from "../components/Menu";

/**
 * Profielonderdelen die alleen in de browser bestaan: webpush (alleen na toestemming), installeren op het beginscherm, de e-mailvoorkeur en
 * de koppeling naar het beveiligingsbeheer op de website. Er wordt nergens native functionaliteit (Face ID, schermbescherming) beloofd.
 */
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from([...atob(padded)].map((c) => c.charCodeAt(0)));
}

/** Leesbare naam van een browser/toestel uit de user-agent (alleen voor het eigen apparatenoverzicht). */
export function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return "Onbekend apparaat";
  const os = /Android/.test(userAgent) ? "Android" : /iPhone|iPad|iPod/.test(userAgent) ? "iPhone/iPad" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X|Macintosh/.test(userAgent) ? "Mac" : /Linux/.test(userAgent) ? "Linux" : "";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  return os ? `${browser} op ${os}` : browser;
}

type PushStatus = "checking" | "unsupported" | "needs-install" | "denied" | "subscribed" | "available";

export function WebPushSection() {
  const { api } = useAuth();
  const confirm = useConfirm();
  const overview = useLoad(() => api.webPushOverview(), []);
  const [status, setStatus] = useState<PushStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const publicKey = overview.data?.publicKey ?? null;

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") return setStatus("unsupported");
    if (isIOS() && !isStandalone()) return setStatus("needs-install");
    if (Notification.permission === "denied") return setStatus("denied");
    const registration = await navigator.serviceWorker.ready;
    setStatus((await registration.pushManager.getSubscription()) ? "subscribed" : "available");
  }, []);
  useEffect(() => void refresh().catch(() => setStatus("unsupported")), [refresh]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      // Toestemming wordt alleen gevraagd na deze uitdrukkelijke tik op de knop.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setStatus(permission === "denied" ? "denied" : "available");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const result = await api.webPushSubscribe({ endpoint: json.endpoint, keys: json.keys });
      if (!result.ok) await subscription.unsubscribe().catch(() => {});
      setMessage(result.message);
      setStatus(result.ok ? "subscribed" : "available");
      await overview.reload();
    } catch {
      setMessage("Inschakelen van pushmeldingen is mislukt.");
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
        await api.webPushUnsubscribe(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("available");
      setMessage("Pushmeldingen zijn uitgeschakeld voor dit apparaat.");
      await overview.reload();
    } catch {
      setMessage("Uitschakelen is mislukt.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try { setMessage((await api.webPushTest()).message); } catch { setMessage("Versturen van de testmelding is mislukt."); } finally { setBusy(false); }
  }

  return (
    <section className="glass card stack" aria-label="Pushmeldingen">
      <h2>Pushmeldingen</h2>
      <span className="muted">Je krijgt een melding zonder namen of functies; tikken opent het voorstel.</span>
      {overview.data && !publicKey && <span className="muted">Pushmeldingen zijn nog niet ingesteld door de systeembeheerder.</span>}
      {publicKey && status === "unsupported" && <span className="muted">Deze browser ondersteunt geen pushmeldingen. Ringtools blijft verder gewoon werken.</span>}
      {publicKey && status === "needs-install" && <span className="muted">Zet Ringtools eerst op je beginscherm (zie “Installeren”): op iPhone en iPad werken pushmeldingen alleen in de geïnstalleerde webapp.</span>}
      {publicKey && status === "denied" && <span className="muted">Meldingen zijn geblokkeerd voor Ringtools. Sta ze toe in de instellingen van je browser of toestel.</span>}
      {publicKey && status === "available" && <button className="btn btn-primary" disabled={busy} onClick={() => void enable()}>Meldingen aanzetten op dit apparaat</button>}
      {publicKey && status === "subscribed" && (
        <div className="row row-wrap">
          <button className="btn btn-ghost btn-flex" disabled={busy} onClick={() => void test()}>Testmelding sturen</button>
          <button className="btn btn-ghost btn-flex" disabled={busy} onClick={() => void disable()}>Uitzetten op dit apparaat</button>
        </div>
      )}
      {message && <div role="status">{message}</div>}
      {overview.data?.subscriptions.map((s) => (
        <div key={s.id} className="row between">
          <span className="grow">{describeBrowser(s.userAgent)}</span>
          <ActionMenu label={`Acties voor ${describeBrowser(s.userAgent)}`} items={[{
            id: "remove", label: "Apparaat verwijderen…", icon: MENU_ICONS.ban, danger: true,
            onSelect: () => void (async () => {
              if (await confirm({ title: "Apparaat verwijderen?", message: "Dit apparaat ontvangt geen pushmeldingen meer.", confirmLabel: "Verwijderen", danger: true })) {
                await api.webPushRemove(s.id);
                await overview.reload();
                await refresh().catch(() => {});
              }
            })(),
          }]} />
        </div>
      ))}
    </section>
  );
}

export function WebInstallSection() {
  const [env, setEnv] = useState({ standalone: true, ios: false });
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setEnv({ standalone: isStandalone(), ios: isIOS() });
    const onBefore = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return (
    <section className="glass card stack" aria-label="Installeren">
      <h2>Installeren</h2>
      {env.standalone || installed ? (
        <span>Ringtools staat op het beginscherm van dit apparaat.</span>
      ) : env.ios ? (
        <span className="muted">Tik in Safari op het deelicoon, kies “Zet op beginscherm” en daarna “Voeg toe”.</span>
      ) : prompt ? (
        <>
          <span className="muted">Zet Ringtools als app op dit apparaat.</span>
          <button className="btn btn-primary" onClick={() => void prompt.prompt().then(() => prompt.userChoice).then(() => setPrompt(null))}>Ringtools installeren</button>
        </>
      ) : (
        <span className="muted">Open het menu van je browser en kies “App installeren” of “Toevoegen aan startscherm”.</span>
      )}
    </section>
  );
}

export function WebSecuritySection() {
  const { me, api, reloadMe } = useAuth();
  const [busy, setBusy] = useState(false);
  const enabled = me?.user.emailNotificationsEnabled ?? true;
  return (
    <section className="glass card stack" aria-label="Aanmelden en beveiliging">
      <h2>Aanmelden en beveiliging</h2>
      <span className="muted">Je meldt je aan met een e-mailcode en, als je die hebt ingesteld, een tweede stap. In de browser is er geen appvergrendeling met Face ID of schermbescherming; sluit het tabblad of log uit op een gedeeld apparaat.</span>
      <a className="btn btn-ghost" href="/profiel/beveiliging">Verificatie, passkeys en herstelcodes beheren</a>
      <label className="row between">
        <span>Meldingen ook per e-mail</span>
        <input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={() => void (async () => {
          setBusy(true);
          try { await api.setEmailNotifications(!enabled); await reloadMe(); } finally { setBusy(false); }
        })()} />
      </label>
      <span className="muted">Je inlogcode ontvang je altijd per e-mail.</span>
    </section>
  );
}
