"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

export function PasskeyVerifyPanel({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" ? browserSupportsWebAuthn() : true;

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/webauthn/authenticate/options", { method: "POST" });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options?.error || "Kon niet starten.");

      const authResp = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResp, redirect: redirectTo }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.ok) throw new Error(result.error || "Verificatie mislukt.");

      router.push(result.redirect || redirectTo);
    } catch (err) {
      // Een geannuleerde of mislukte ceremonie geeft hier een foutmelding;
      // nooit automatisch opnieuw proberen zonder dat de gebruiker ernaar vraagt.
      setError(err instanceof Error ? err.message : "Verificatie mislukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  // Eén keer automatisch de ceremonie starten voor een vloeiende ervaring;
  // de gebruiker kan het ook zelf opnieuw starten via de knop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (supported) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!supported) {
    return (
      <p className="text-sm text-[var(--danger)]">
        Dit apparaat of deze browser ondersteunt geen passkeys. Gebruik een recente versie van Safari (iPhone/iPad),
        Chrome, Edge of een andere moderne browser, of probeer het op het apparaat waarop je je passkey hebt
        geregistreerd.
      </p>
    );
  }

  return (
    <div className="space-y-5 text-center">
      <div>
        <h2 className="font-semibold">Bevestig met je passkey</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Gebruik Face ID, Touch ID, Windows Hello of de schermvergrendeling van je apparaat.
        </p>
      </div>
      <button type="button" onClick={verify} disabled={busy} className="btn-primary w-full">
        {busy ? "Even geduld…" : "Opnieuw proberen"}
      </button>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
