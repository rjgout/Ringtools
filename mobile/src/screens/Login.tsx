import { DeletionReceipt } from "../components/AccountPrivacy";
import { API_URL } from "../config";
import logo from "../../resources/icon.png";
import { digitsOnly } from "../lib/codeInput";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";
import { useServerCapabilities } from "../lib/useServerCapabilities";
import { deviceLoginMessage, deviceLoginSupported, readDeviceKeyRef } from "../lib/deviceLogin";
import { nativeCapabilities } from "../lib/buildProfile";
import { getPasskeyProvider, PASSKEY_UNAVAILABLE_MESSAGE, PasskeyCancelledError, PasskeyError, passkeysUsable } from "../lib/passkeys";

/** Inloggen met e-mail + 8-cijferige code uit de e-mail. De link in de mail opent deze app direct (universele link). */
export function Login({ initialEmail = "" }: { initialEmail?: string; onHaveInvitation?: () => void; onLinkDevice?: () => void }) {
  const { api, signIn, signInReview, finishMfa, finishMfaTotp, signInWithDevice } = useAuth();
  const [demo, setDemo] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "passkey" | "totp">("email");
  const [totpCode, setTotpCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Servercapaciteiten uit GET /meta: met automatische herpogingen (ook als de aanvraag tijdens de ontgrendeling werd geblokkeerd).
  const caps = useServerCapabilities(api);
  // E2.4a: knop "Inloggen met Face ID" alleen als de server het aanbiedt, dit een iPhone is en er een lokale toestelsleutel bestaat.
  const [hasDeviceKey, setHasDeviceKey] = useState(false);
  const [deviceOwner, setDeviceOwner] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void readDeviceKeyRef().then((r) => { if (active) { setHasDeviceKey(!!r); setDeviceOwner(r?.name ?? null); } });
    return () => { active = false; };
  }, []);
  const deviceLoginAvailable = caps.caps.deviceLogin && hasDeviceKey && deviceLoginSupported();

  async function loginWithDevice() {
    setBusy(true);
    setError(null);
    try {
      await signInWithDevice(); // geen e-mailcode: de server geeft pas na een geldige handtekening een sessie
    } catch (err) {
      setError(deviceLoginMessage(err));
      setBusy(false);
    }
  }

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestCode(email.trim());
      setInfo("We hebben een code naar je e-mailadres gestuurd.");
      setCode("");
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email.trim(), code.replace(/\s+/g, ""));
      if (result && "pendingToken" in result) {
        // Verplichte MFA: nog geen sessie. Eerst de tweede factor; een pending-login geeft nergens toegang.
        setPendingToken(result.pendingToken);
        setCode("");
        setBusy(false);
        // De server bepaalt welke tweede factor geldt. Ontbreekt die informatie: fail closed, geen gok en geen passkeyroute.
        const methods = result.methods ?? [];
        const passkeyOk = methods.includes("passkey") && getPasskeyProvider() !== null && passkeysUsable(true, nativeCapabilities().limited);
        if (passkeyOk) {
          setStep("passkey");
          await passkey(result.pendingToken);
        } else if (methods.includes("totp")) {
          setStep("totp"); // authenticator-app (of herstelcode), ook als het account daarnaast een passkey heeft
        } else if (methods.includes("passkey")) {
          await leavePasskey(PASSKEY_UNAVAILABLE_MESSAGE, result.pendingToken); // geen passkeyroute starten die hier niet beschikbaar is
        } else {
          await leavePasskey("De inlogmethode van je account kon niet worden vastgesteld. Werk de app bij of log in via de webapp.", result.pendingToken);
        }
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
      setBusy(false);
    }
  }

  async function leavePasskey(message: string | null, token: string | null = pendingToken) {
    setPendingToken(null);
    setStep("email");
    setError(message);
    if (token) await api.cancelMfa(token).catch(() => {}); // de wachtende login wordt direct opgeruimd
  }

  async function totp(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setBusy(true);
    setError(null);
    try {
      const value = totpCode.replace(/\s+/g, "");
      await finishMfaTotp(pendingToken, useRecovery ? { recoveryCode: totpCode.trim() } : { code: value });
    } catch (err) {
      if (err instanceof ApiRequestError && (err.code === "locked" || err.code === "unauthenticated" || err.code === "mfa-not-supported")) await leavePasskey(err.message);
      else setError(err instanceof ApiRequestError ? err.message : "De verificatie is niet gelukt. Probeer het opnieuw.");
      setTotpCode("");
    } finally {
      setBusy(false);
    }
  }

  async function passkey(token: string) {
    const provider = getPasskeyProvider();
    if (!provider || !passkeysUsable(true, nativeCapabilities().limited)) {
      await leavePasskey(PASSKEY_UNAVAILABLE_MESSAGE, token);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { options } = await api.passkeyOptions(token);
      const assertion = await provider.authenticate(options);
      await finishMfa(token, assertion);
    } catch (err) {
      if (err instanceof PasskeyError) {
        // Niet-herstelbaar op dit toestel (niet ondersteund, domein niet gekoppeld): de wachtende login wordt opgeruimd; anders opnieuw proberen of annuleren.
        if (err.permanent) await leavePasskey(err.message, token);
        else setError(err.message);
      } else if (err instanceof PasskeyCancelledError) setError("Je hebt de verificatie geannuleerd. Probeer het opnieuw of annuleer het inloggen.");
      else if (err instanceof ApiRequestError && (err.code === "locked" || err.status === 401 && err.code !== "passkey-failed")) await leavePasskey(err.message, token);
      else setError(err instanceof ApiRequestError ? err.message : "De verificatie is niet gelukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }


  async function review(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await signInReview(email.trim(), password); }
    catch (err) { setError(err instanceof ApiRequestError ? err.message : "Aanmelden is niet gelukt."); }
    finally { setBusy(false); setPassword(""); }
  }
  if (demo) return <main className="page center"><form className="glass card stack card-narrow" onSubmit={review}>
    <h1>Demoaccount</h1><p className="muted">Alleen voor de afgeschermde demonstratie met fictieve gegevens.</p>
    <label htmlFor="review-email">E-mailadres</label><input id="review-email" type="email" autoComplete="username" autoCapitalize="none" required value={email} onChange={e => setEmail(e.target.value)} />
    <label htmlFor="review-password">Wachtwoord</label><input id="review-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
    {error && <div className="error" role="alert">{error}</div>}
    <button className="btn btn-primary" disabled={busy}>{busy ? "Even geduld…" : "Aanmelden"}</button>
    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setDemo(false); setPassword(""); setEmail(initialEmail); setError(null); }}>Terug naar normaal aanmelden</button>
  </form></main>;

  return (
    <main className="page center">
      <form className="glass card stack card-narrow" onSubmit={step === "email" ? request : step === "code" ? login : step === "totp" ? totp : (e) => { e.preventDefault(); if (pendingToken) void passkey(pendingToken); }}>
        <div>
          <img src={logo} alt="Ringtools-logo" width="64" height="64" />
          <h1>Ringtools</h1>
          <span className="muted">Welkom bij Ringtools. Vul je e-mailadres in om verder te gaan.</span>
        </div>
        {step === "email" && deviceLoginAvailable && (
          <div className="stack">
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void loginWithDevice()}>{busy ? "Even geduld…" : "Inloggen met de beveiliging van je telefoon"}</button>
            <span className="muted">{deviceOwner ? `Voor het account van ${deviceOwner}. ` : ""}Bevestig met de beveiliging van je telefoon.</span>
            <strong>Of log in met een e-mailcode</strong>
          </div>
        )}
        {step === "totp" ? (
          <div>
            <strong>Bevestig dat jij het bent</strong>
            <p className="muted">{useRecovery ? "Vul een van je eenmalige herstelcodes in." : "Vul de 6-cijferige code uit je authenticator-app in."}</p>
            <label htmlFor="totp">{useRecovery ? "Herstelcode" : "Code uit je authenticator-app"}</label>
            <input id="totp" className="code" inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 11 : undefined} required value={totpCode} onChange={(e) => setTotpCode(useRecovery ? e.target.value : digitsOnly(e.target.value, 6))} autoFocus />
          </div>
        ) : step === "passkey" ? (
          <div>
            <strong>Bevestig dat jij het bent</strong>
            <p className="muted">Voor jouw account is extra verificatie met een passkey nodig. Volg de aanwijzingen van je toestel.</p>
          </div>
        ) : step === "email" ? (
          <div>
            <label htmlFor="email">E-mailadres</label>
            <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        ) : (
          <div>
            <label htmlFor="code">Inlogcode uit de e-mail</label>
            <input id="code" className="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(digitsOnly(e.target.value, 8))} autoFocus />
            {info && <p className="muted">{info}</p>}
            <p className="muted">Geen code ontvangen? Controleer ook je spammap.</p>
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || (step === "code" && code.replace(/\s+/g, "").length !== 8) || (step === "totp" && totpCode.replace(/\s+/g, "").length < (useRecovery ? 10 : 6))}>
          {busy ? "Even geduld…" : step === "email" ? "Verder" : step === "passkey" ? "Verifiëren met passkey" : "Inloggen"}
        </button>
        {step === "totp" && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => { setUseRecovery((v) => !v); setTotpCode(""); setError(null); }}>
            {useRecovery ? "Terug naar de authenticator-app" : "Ik heb geen toegang tot mijn authenticator"}
          </button>
        )}
        {(step === "passkey" || step === "totp") && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void leavePasskey(null)}>Annuleren</button>
        )}
        {step === "code" && <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => void request({ preventDefault() {} } as React.FormEvent)}>Opnieuw een code aanvragen</button>}
        {step === "code" && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
            Ander e-mailadres
          </button>
        )}
        {caps.status === "unavailable" && (
          <p className="muted" role="status">
            Sommige inlogopties konden niet worden opgehaald. <button type="button" className="btn btn-ghost" onClick={caps.retry}>Opnieuw proberen</button>
          </p>
        )}

        {step === "email" && <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => { setDemo(true); setEmail(""); setError(null); }}>Demoaccount</button>}
        {step === "email" && <><DeletionReceipt /><a className="btn btn-ghost" href={`${API_URL}/accountverwijdering`} target="_blank" rel="noreferrer">Account en privacy zonder toegang</a></>}
      </form>
    </main>
  );
}
