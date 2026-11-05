import { useCallback, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";

/**
 * Herverificatie voor gevoelige beheeracties. De server weigert de actie met code "reauth-required" als de laatste
 * tweede factor te oud is; hier vragen we dan een verse code (webmin: TOTP; gebruiker: e-mailcode) en proberen de
 * actie daarna opnieuw. Er wordt niets lokaal "onthouden": de server beslist.
 */
export function useReauth() {
  const { reauth, reauthWithPasskey, requestReauthCode, isAdmin, me } = useAuth();
  // Accounts met verplichte MFA (passkey) bevestigen met een passkey; een e-mailcode alleen is voor hen nooit genoeg (de server weigert dat).
  const usesPasskey = !isAdmin && !!me?.user.mfaEnabled;
  const [open, setOpen] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiter = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiter.current = { resolve, reject };
        setCode("");
        setError(null);
        setCodeSent(false);
        setOpen(true);
      }),
    []
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === "reauth-required") {
          await ask();
          return await fn();
        }
        throw err;
      }
    },
    [ask]
  );

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await requestReauthCode();
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPasskey() {
    setBusy(true);
    setError(null);
    try {
      await reauthWithPasskey();
      setOpen(false);
      waiter.current?.resolve();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "De verificatie is niet gelukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await reauth(code.replace(/\s+/g, ""));
      setOpen(false);
      waiter.current?.resolve();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setOpen(false);
    waiter.current?.reject(new ApiRequestError(0, "Herverificatie geannuleerd.", "cancelled"));
  }

  const dialog = open ? (
    <div className="glass card stack" role="dialog" aria-label="Bevestig je identiteit" style={{ position: "fixed", inset: "auto 12px 90px 12px", zIndex: 20 }}>
      <strong>Bevestig je identiteit</strong>
      {usesPasskey ? (
        <span className="muted">Voor jouw account is extra verificatie met een passkey nodig. Volg de aanwijzingen van je toestel.</span>
      ) : isAdmin ? (
        <span className="muted">Vul de huidige 6-cijferige code uit je authenticator-app in.</span>
      ) : codeSent ? (
        <span className="muted">Vul de 8-cijferige code uit de e-mail in.</span>
      ) : (
        <span className="muted">Voor deze beheeractie sturen we je een verse code per e-mail.</span>
      )}
      {usesPasskey ? (
        <button className="btn btn-primary" disabled={busy} onClick={() => void submitPasskey()}>{busy ? "Even geduld…" : "Verifiëren met passkey"}</button>
      ) : !isAdmin && !codeSent ? (
        <button className="btn btn-primary" disabled={busy} onClick={sendCode}>Stuur code</button>
      ) : (
        <form className="stack" onSubmit={submit}>
          <input aria-label="Code" className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={isAdmin ? 6 : 8} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          <button className="btn btn-primary" disabled={busy || code.replace(/\s+/g, "").length !== (isAdmin ? 6 : 8)}>Bevestigen</button>
        </form>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn btn-ghost" onClick={cancel}>Annuleren</button>
    </div>
  ) : null;

  return { run, dialog };
}
