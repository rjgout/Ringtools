"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

/** Fout met een tekst die rechtstreeks aan de gebruiker getoond mag worden (afkomstig van onze eigen server, geen technische details). */
class UserFacingError extends Error {
  constructor(message: string, readonly sessionExpired = false) {
    super(message);
  }
}

/**
 * `alternativeHref`: link naar een andere ingestelde methode (alleen meegeven als die bestaat). Annuleren of mislukken blokkeert nooit:
 * de gebruiker kan opnieuw proberen of — zonder nieuwe e-mailcode — een andere methode kiezen.
 */
export function PasskeyVerifyPanel({ redirectTo, alternativeHref }: { redirectTo: string; alternativeHref?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const supported = typeof window !== "undefined" ? browserSupportsWebAuthn() : true;

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/webauthn/authenticate/options", { method: "POST" });
      const options = await optionsRes.json().catch(() => ({}));
      if (optionsRes.status === 401) throw new UserFacingError("Je inlogsessie is verlopen. Log opnieuw in.", true);
      if (!optionsRes.ok) throw new UserFacingError(options?.error || "De verificatie kon niet worden gestart. Probeer het opnieuw.");

      const authResp = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResp, redirect: redirectTo }),
      });
      const result = await verifyRes.json().catch(() => ({}));
      if (verifyRes.status === 401) throw new UserFacingError("Je inlogsessie is verlopen. Log opnieuw in.", true);
      if (!verifyRes.ok || !result.ok) throw new UserFacingError(result.error || "De verificatie met je passkey is niet gelukt. Probeer het opnieuw.");

      router.push(result.redirect || redirectTo);
    } catch (err) {
      // Geannuleerd, verlopen of mislukt: nooit automatisch opnieuw proberen en geen interne details tonen.
      if (err instanceof UserFacingError) {
        setError(err.message);
        if (err.sessionExpired) setExpired(true);
      } else if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) {
        setError("De passkey-verificatie is geannuleerd of verlopen. Probeer het opnieuw" + (alternativeHref ? " of kies een andere methode." : "."));
      } else {
        setError("De verificatie met je passkey is niet gelukt. Probeer het opnieuw" + (alternativeHref ? " of kies een andere methode." : "."));
      }
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
      {expired ? (
        <Link href="/login" className="btn-primary block w-full">
          Opnieuw inloggen
        </Link>
      ) : (
        <button type="button" onClick={verify} disabled={busy} className="btn-primary w-full">
          {busy ? "Even geduld…" : "Opnieuw proberen"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {alternativeHref && !expired && (
        <Link href={alternativeHref} className="block text-sm text-[var(--text-muted)] underline">
          Een andere methode gebruiken (authenticator-app)
        </Link>
      )}
    </div>
  );
}
