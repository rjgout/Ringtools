"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";

export function PasskeyEnrollPanel({ redirectTo, onDone }: { redirectTo: string; onDone?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState("");
  const supported = typeof window !== "undefined" ? browserSupportsWebAuthn() : true;

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/webauthn/register/options", { method: "POST" });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options?.error || "Kon niet starten.");

      const attResp = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attResp, redirect: redirectTo, deviceLabel: deviceLabel || undefined }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.ok) throw new Error(result.error || "Registratie mislukt.");

      if (result.redirect) {
        router.push(result.redirect);
      } else {
        setDeviceLabel("");
        onDone?.();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registratie mislukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-[var(--danger)]">
        Dit apparaat of deze browser ondersteunt geen passkeys. Gebruik een recente versie van Safari (iPhone/iPad),
        Chrome, Edge of een andere moderne browser, of probeer het op een ander apparaat.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold">Registreer een passkey</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Gebruik Face ID, Touch ID, Windows Hello of de schermvergrendeling van je apparaat om veilig in te loggen,
          zonder wachtwoord.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="deviceLabel">
          Naam voor dit apparaat (optioneel)
        </label>
        <input
          id="deviceLabel"
          className="input"
          placeholder="Bv. iPhone van Jan"
          value={deviceLabel}
          onChange={(e) => setDeviceLabel(e.target.value)}
        />
      </div>
      <button type="button" onClick={register} disabled={busy} className="btn-primary w-full">
        {busy ? "Even geduld…" : "Passkey registreren"}
      </button>
      {error && <p className="text-center text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
