import { useCallback, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { digitsOnly } from "../lib/codeInput";
import { ApiRequestError } from "../lib/api";
import { IS_WEB_APP } from "../config";

/**
 * Herverificatie voor gevoelige beheeracties. De server weigert de actie met code "reauth-required" als de laatste
 * tweede factor te oud is; hier vragen we dan een verse code (webmin: TOTP; gebruiker: e-mailcode) en proberen de
 * actie daarna opnieuw. Er wordt niets lokaal "onthouden": de server beslist.
 */
export function useReauth() {
  const { reauth, reauthWithPasskey, requestReauthCode, me, api } = useAuth();
  // Accounts met verplichte MFA (passkey) bevestigen met een passkey; een e-mailcode alleen is voor hen nooit genoeg (de server weigert dat).
  const review = !!me?.user.reviewAccount;
  const mfaUser = !!me?.user.mfaEnabled;
  // Functievlag op de server: accounts met een authenticator-app bevestigen in de app met een 6-cijferige code (nooit met een e-mailcode alleen).
  const [totpServer, setTotpServer] = useState(false);
  const usesTotp = mfaUser && totpServer;
  const usesPasskey = mfaUser && !usesTotp;
  const [open, setOpen] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiter = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        // Webomgeving: een account met een tweede factor bevestigt op de bestaande beveiligingspagina van de website (passkey of authenticator-app)
        // en komt daarna terug op dit scherm; de actie wordt dan opnieuw gestart door de gebruiker. Er verschijnt hier geen codeveld.
        if (IS_WEB_APP && mfaUser) return void reauthWithPasskey().catch(reject);
        waiter.current = { resolve, reject };
        setCode("");
        setError(null);
        setCodeSent(false);
        setOpen(true);
        if (mfaUser) void Promise.resolve().then(() => api.meta()).then((m) => setTotpServer(m?.nativeTotpLogin === true)).catch(() => {});
      }),
    [mfaUser, api, reauthWithPasskey]
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
      await reauth(review ? code : code.replace(/\s+/g, ""));
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
    <div className="sheet-backdrop"><div className="glass card stack sheet" role="dialog" aria-modal="true" aria-label="Bevestig je identiteit">
      <strong>Bevestig je identiteit</strong>
      {review ? <span className="muted">Bevestig met het wachtwoord van je demoaccount.</span> : usesPasskey ? (
        <span className="muted">Voor jouw account is extra verificatie met een passkey nodig. Volg de aanwijzingen van je toestel.</span>
      ) : usesTotp ? (
        <span className="muted">Vul de huidige 6-cijferige code uit je authenticator-app in.</span>
      ) : codeSent ? (
        <span className="muted">Vul de 8-cijferige code uit de e-mail in.</span>
      ) : (
        <span className="muted">Voor deze beheeractie sturen we je een verse code per e-mail.</span>
      )}
      {usesPasskey ? (
        <button className="btn btn-primary" disabled={busy} onClick={() => void submitPasskey()}>{busy ? "Even geduld…" : "Verifiëren met passkey"}</button>
      ) : !review && !usesTotp && !codeSent ? (
        <button className="btn btn-primary" disabled={busy} onClick={sendCode}>Stuur code</button>
      ) : (
        <form className="stack" onSubmit={submit}>
          <input aria-label={review ? "Wachtwoord" : "Code"} type={review ? "password" : "text"} className={review ? "" : "code"} inputMode={review ? "text" : "numeric"} autoComplete={review ? "current-password" : "one-time-code"} value={code} onChange={(e) => setCode(review ? e.target.value : digitsOnly(e.target.value, usesTotp ? 6 : 8))} autoFocus required />
          <button className="btn btn-primary" disabled={busy || (review ? !code : code.replace(/\s+/g, "").length !== (usesTotp ? 6 : 8))}>Bevestigen</button>
        </form>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn btn-ghost" onClick={cancel}>Annuleren</button>
    </div></div>
  ) : null;

  return { run, dialog };
}
