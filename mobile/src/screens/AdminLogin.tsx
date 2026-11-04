import { useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";

/** Inloggen voor het beheerdersaccount (webmin): wachtwoord en daarna verplicht TOTP (of een herstelcode). */
export function AdminLogin({ onBack }: { onBack: () => void }) {
  const { adminStart, adminFinish } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  const step1 = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setPending(await adminStart(username.trim(), password));
      setPassword("");
    });
  };
  const step2 = (e: React.FormEvent) => {
    e.preventDefault();
    const value = code.replace(/\s+/g, "");
    void run(async () => {
      try {
        await adminFinish(pending!, useRecovery ? { recoveryCode: value } : { code: value });
      } catch (err) {
        // Een verlopen wachtend token vraagt opnieuw om het wachtwoord.
        if (err instanceof ApiRequestError && err.status === 401 && err.code === "unauthenticated") setPending(null);
        throw err;
      }
    });
  };

  return (
    <main className="page center">
      <form className="glass card stack" style={{ width: "100%", maxWidth: 420 }} onSubmit={pending ? step2 : step1}>
        <div>
          <h1>Beheerder</h1>
          <span className="muted">{pending ? "Vul de code uit je authenticator-app in." : "Log in met je beheerdersaccount. Daarna volgt verplicht een tweede stap."}</span>
        </div>
        {!pending ? (
          <>
            <div><label htmlFor="adm-user">Gebruikersnaam</label><input id="adm-user" autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div><label htmlFor="adm-pass">Wachtwoord</label><input id="adm-pass" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          </>
        ) : (
          <div>
            <label htmlFor="adm-code">{useRecovery ? "Herstelcode" : "Code uit authenticator-app"}</label>
            <input id="adm-code" className={useRecovery ? "" : "code"} inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" autoCapitalize="none" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Even geduld…" : pending ? "Bevestigen" : "Verder"}</button>
        {pending && <button type="button" className="btn btn-ghost btn-block" onClick={() => { setUseRecovery((v) => !v); setCode(""); setError(null); }}>{useRecovery ? "Gebruik authenticator-code" : "Gebruik een herstelcode"}</button>}
        <button type="button" className="btn btn-ghost btn-block" onClick={onBack}>Terug naar gewoon inloggen</button>
        <p className="muted">TOTP stel je eenmalig in via de technische beheeromgeving (web). Zonder TOTP is inloggen in de app niet mogelijk; MFA wordt nooit omzeild.</p>
      </form>
    </main>
  );
}
