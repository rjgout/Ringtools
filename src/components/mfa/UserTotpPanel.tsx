"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  startUserTotpEnrollmentAction,
  confirmUserTotpEnrollmentAction,
  removeUserTotpAction,
  type ActionResult,
  type TotpEnrollmentView,
} from "@/lib/actions/mfa.actions";

const initialState: ActionResult = { ok: false, message: "" };

/** Authenticator-app (TOTP) voor gewone gebruikers (E2.1, achter WEB_TOTP_ENABLED). Geen herstelcodes: herstel is een open beleidskeuze. */
export function UserTotpPanel({ configured, canRemove }: { configured: boolean; canRemove: boolean }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<TotpEnrollmentView | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [state, action, pending] = useActionState(async (prev: ActionResult, formData: FormData) => {
    const result = await confirmUserTotpEnrollmentAction(prev, formData);
    if (result.ok) {
      setEnrollment(null);
      router.refresh();
    }
    return result;
  }, initialState);

  async function start() {
    setMessage(null);
    try {
      setEnrollment(await startUserTotpEnrollmentAction());
    } catch {
      setMessage({ ok: false, text: "Kon de inschrijving niet starten." });
    }
  }

  async function remove() {
    setMessage(null);
    const result = await removeUserTotpAction();
    setMessage({ ok: result.ok, text: result.message });
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-muted)]">
        {configured
          ? "Een authenticator-app is ingesteld. Let op: een code uit een app is niet bestand tegen phishing; een passkey wel."
          : "Optioneel: bevestig inloggen met een 6-cijferige code uit een authenticator-app."}
      </p>

      {enrollment ? (
        <form action={action} className="space-y-3">
          <div className="flex justify-center">
            <Image src={enrollment.qrDataUrl} alt="QR-code voor de authenticator-app" width={200} height={200} className="rounded-2xl bg-white p-2" unoptimized />
          </div>
          <details className="text-sm text-[var(--text-muted)]">
            <summary className="cursor-pointer select-none">Kan je niet scannen? Voer de code handmatig in</summary>
            <p className="mt-2 break-all rounded-xl bg-black/5 p-3 font-mono text-xs dark:bg-white/5">{enrollment.secret}</p>
          </details>
          <label className="label" htmlFor="user-totp-code">
            Bevestigingscode
          </label>
          <input id="user-totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="input otp-input" placeholder="000000" />
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? "Even geduld…" : "Bevestigen"}
          </button>
          {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
        </form>
      ) : configured ? (
        canRemove && (
          <button type="button" onClick={remove} className="btn-ghost text-sm">
            Authenticator-app verwijderen
          </button>
        )
      ) : (
        <button type="button" onClick={start} className="btn-primary text-sm">
          Authenticator-app instellen
        </button>
      )}
      {configured && !canRemove && (
        <p className="text-xs text-[var(--text-muted)]">Dit is je enige methode; registreer eerst een passkey of schakel verificatie uit om hem te verwijderen.</p>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{message.text}</p>}
    </div>
  );
}
