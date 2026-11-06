import { useEffect, useState, useSyncExternalStore } from "react";
import { AdminLogin } from "./AdminLogin";
import { useAuth } from "../lib/auth";
import { nativeDeviceKeys } from "../lib/deviceKey";
import { ApiRequestError } from "../lib/api";
import { nativeCapabilities, PERSONAL_TEAM_NOTICE } from "../lib/buildProfile";
import { getPasskeyProvider, PASSKEY_UNAVAILABLE_MESSAGE, PasskeyCancelledError, PasskeyError, passkeysUsable, subscribePasskeyProvider } from "../lib/passkeys";

/** Inloggen met e-mail + 8-cijferige code uit de e-mail. De link in de mail opent deze app direct (universele link). */
export function Login({ initialEmail = "", onHaveInvitation, onLinkDevice }: { initialEmail?: string; onHaveInvitation?: () => void; onLinkDevice?: () => void }) {
  const { api, signIn, finishMfa, finishMfaTotp } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "passkey" | "totp">("email");
  const [totpCode, setTotpCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  // Servercapaciteit (functievlag) uit GET /meta; onbekend of mislukt = niet beschikbaar (veilige standaardmelding).
  // Reactief: de provider kan pas na het eerste renderen (en na /meta) geregistreerd worden.
  const providerReady = useSyncExternalStore(subscribePasskeyProvider, () => getPasskeyProvider() !== null);
  const [serverPasskeys, setServerPasskeys] = useState<boolean | undefined>(undefined);
  const [trustedDevices, setTrustedDevices] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => api.meta())
      .then((meta) => { if (active) { setServerPasskeys(meta?.nativePasskeys === true); setTrustedDevices(meta?.trustedDevices === true); } })
      .catch(() => {});
    return () => { active = false; };
  }, [api]);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestCode(email.trim());
      setInfo(res.message);
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
        const methods = result.methods ?? ["passkey"]; // oudere server of testdubbel: alleen passkey
        const passkeyOk = methods.includes("passkey") && getPasskeyProvider() !== null && passkeysUsable(true, nativeCapabilities().limited);
        if (passkeyOk || !methods.includes("totp")) {
          setStep("passkey");
          await passkey(result.pendingToken);
        } else {
          setStep("totp"); // authenticator-app (of herstelcode)
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

  if (admin) return <AdminLogin onBack={() => setAdmin(false)} />;

  return (
    <main className="page center">
      <form className="glass card stack" style={{ width: "100%", maxWidth: 420 }} onSubmit={step === "email" ? request : step === "code" ? login : step === "totp" ? totp : (e) => { e.preventDefault(); if (pendingToken) void passkey(pendingToken); }}>
        <div>
          <h1>Ringtools</h1>
          <span className="muted">Log in met je e-mailadres. Je ontvangt een code van 8 cijfers.</span>
        </div>
        {step === "totp" ? (
          <div>
            <strong>Bevestig dat jij het bent</strong>
            <p className="muted">{useRecovery ? "Vul een van je eenmalige herstelcodes in." : "Vul de 6-cijferige code uit je authenticator-app in."}</p>
            <label htmlFor="totp">{useRecovery ? "Herstelcode" : "Code uit je authenticator-app"}</label>
            <input id="totp" className="code" inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 11 : 6} required value={totpCode} onChange={(e) => setTotpCode(e.target.value)} autoFocus />
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
            <input id="code" className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            {info && <p className="muted">{info}</p>}
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || (step === "code" && code.replace(/\s+/g, "").length !== 8) || (step === "totp" && totpCode.replace(/\s+/g, "").length < (useRecovery ? 10 : 6))}>
          {busy ? "Even geduld…" : step === "email" ? "Stuur code" : step === "passkey" ? "Verifiëren met passkey" : "Inloggen"}
        </button>
        {step === "totp" && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => { setUseRecovery((v) => !v); setTotpCode(""); setError(null); }}>
            {useRecovery ? "Terug naar de authenticator-app" : "Ik heb geen toegang tot mijn authenticator"}
          </button>
        )}
        {(step === "passkey" || step === "totp") && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void leavePasskey(null)}>Annuleren</button>
        )}
        {step === "code" && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
            Ander e-mailadres
          </button>
        )}
        {nativeCapabilities().limited && <p role="note" className="muted">{PERSONAL_TEAM_NOTICE}</p>}
        {onHaveInvitation && step === "email" && <button type="button" className="btn btn-ghost btn-block" onClick={onHaveInvitation}>Ik heb een uitnodiging</button>}
        {onLinkDevice && trustedDevices && step === "email" && nativeDeviceKeys.available() && <button type="button" className="btn btn-ghost btn-block" onClick={onLinkDevice}>Toestel koppelen met een code</button>}
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setAdmin(true)}>Inloggen als beheerder (webmin)</button>
        {providerReady && passkeysUsable(serverPasskeys, nativeCapabilities().limited) ? (
          <p className="muted">Heeft jouw account extra verificatie met een passkey? Na de inlogcode verifieer je dan met je passkey op dit toestel.</p>
        ) : (
          <p className="muted">Accounts met passkey-verificatie kunnen in de app nog niet inloggen. Gebruik daarvoor voorlopig de webapp; je beveiliging blijft ongewijzigd.</p>
        )}
      </form>
    </main>
  );
}
