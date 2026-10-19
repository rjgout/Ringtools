"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOS13Plus = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS13Plus;
}

export function InstallPwaCard() {
  // optimistisch: niets tonen tot de effect hieronder de echte waarden kent
  // (window/navigator bestaan niet tijdens server-side rendering).
  const [env, setEnv] = useState({ standalone: true, ios: false });
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [promptResult, setPromptResult] = useState<"accepted" | "dismissed" | null>(null);

  useEffect(() => {
    // Eenmalige uitlezing van platform/weergavemodus na mount (window/navigator
    // bestaan niet tijdens server-side rendering, dus dit kan niet tijdens render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnv({ standalone: isStandalone(), ios: isIOS() });

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Al als app geopend: geen installatie-uitleg nodig.
  if (env.standalone || installed) {
    return (
      <div className="glass-card">
        <h2 className="font-semibold">App installeren</h2>
        <p className="mt-2 text-sm text-[var(--success)]">✓ Ringtools is geïnstalleerd op dit apparaat.</p>
      </div>
    );
  }

  return (
    <div className="glass-card space-y-3">
      <h2 className="font-semibold">App installeren</h2>

      {env.ios && (
        <div className="space-y-2 text-sm text-[var(--text-muted)]">
          <p>Zet Ringtools op je beginscherm voor de volledige app-ervaring:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Tik onderin Safari op het deelicoon <span aria-hidden>⬆️</span>.
            </li>
            <li>Kies &quot;Zet op beginscherm&quot;.</li>
            <li>Tik op &quot;Voeg toe&quot;.</li>
          </ol>
        </div>
      )}

      {!env.ios && deferredPrompt && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-muted)]">Installeer Ringtools als app op dit apparaat.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={async () => {
              await deferredPrompt.prompt();
              const choice = await deferredPrompt.userChoice;
              setPromptResult(choice.outcome);
              setDeferredPrompt(null);
            }}
          >
            📲 Installeer Ringtools
          </button>
          {promptResult === "dismissed" && (
            <p className="text-xs text-[var(--text-muted)]">Je kunt dit later opnieuw proberen.</p>
          )}
        </div>
      )}

      {!env.ios && !deferredPrompt && (
        <p className="text-sm text-[var(--text-muted)]">
          Installeren wordt in deze browser niet (meer) aangeboden, of je gebruikt Ringtools al via een geïnstalleerde
          snelkoppeling. Kijk in het menu van je browser naar een optie als &quot;App installeren&quot; of &quot;Toevoegen
          aan startscherm&quot;.
        </p>
      )}
    </div>
  );
}
