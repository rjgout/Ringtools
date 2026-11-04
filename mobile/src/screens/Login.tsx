import { useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";

/** Inloggen met e-mail + 8-cijferige code uit de e-mail. De link in de mail opent deze app direct (universele link). */
export function Login() {
  const { api, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
      await signIn(email.trim(), code.replace(/\s+/g, ""));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
      setBusy(false);
    }
  }

  return (
    <main className="page center">
      <form className="glass card stack" style={{ width: "100%", maxWidth: 420 }} onSubmit={step === "email" ? request : login}>
        <div>
          <h1>Ringtools</h1>
          <span className="muted">Log in met je e-mailadres. Je ontvangt een code van 8 cijfers.</span>
        </div>
        {step === "email" ? (
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
        <button className="btn btn-primary btn-block" disabled={busy || (step === "code" && code.replace(/\s+/g, "").length !== 8)}>
          {busy ? "Even geduld…" : step === "email" ? "Stuur code" : "Inloggen"}
        </button>
        {step === "code" && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
            Ander e-mailadres
          </button>
        )}
        <p className="muted">Het beheerdersaccount (webmin) en accounts met passkey-verificatie kunnen in de app nog niet inloggen. Gebruik daarvoor voorlopig de webapp; je beveiliging blijft ongewijzigd.</p>
      </form>
    </main>
  );
}
