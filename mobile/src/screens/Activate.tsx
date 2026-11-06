import { groupedCode } from "../lib/codeInput";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InvitationPreview } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { ApiRequestError } from "../lib/api";
import { Spinner } from "../components/ui";
import { platform } from "../lib/native";

type Phase =
  | { kind: "checking" }
  | { kind: "ready"; preview: Extract<InvitationPreview, { valid: true }> }
  | { kind: "problem"; reason: "expired" | "invalid" | "network"; message?: string }
  | { kind: "manual" }
  | { kind: "done"; email: string; ringName: string; mfaRequired: boolean; signedIn: boolean };

/**
 * Account activeren met een uitnodiging. Twee wegen: de link uit de e-mail (token) of — als de link de app niet opent —
 * het e-mailadres en de activeringscode uit dezelfde mail. Alleen een expliciet aangevraagde sessie geeft zonder verplichte MFA
 * direct toegang; bij verplichte MFA volgt de bestaande inlogroute. Token en code verlaten het toestel alleen richting de eigen backend.
 */
export function Activate({ token, onFinished, onCancel }: { token?: string; onFinished: (email: string, signedIn: boolean) => void; onCancel: () => void }) {
  const { api, status, finishActivation } = useAuth();
  const [phase, setPhase] = useState<Phase>(token ? { kind: "checking" } : { kind: "manual" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const check = useCallback(async () => {
    if (!token) return;
    setPhase({ kind: "checking" });
    try {
      const p = await api.previewInvitation(token);
      setPhase(p.valid ? { kind: "ready", preview: p } : { kind: "problem", reason: p.reason });
    } catch (err) {
      setPhase({ kind: "problem", reason: "network", message: err instanceof ApiRequestError ? err.message : undefined });
    }
  }, [api, token]);
  useEffect(() => void check(), [check]);

  // Na een geslaagde activatie waarbij je direct bent ingelogd: kort bevestigen en vanzelf door naar het overzicht.
  const finished = useRef(false);
  const finish = useCallback((email: string, signedIn: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onFinished(email, signedIn);
  }, [onFinished]);
  useEffect(() => {
    if (phase.kind !== "done" || !phase.signedIn) return;
    const timer = setTimeout(() => finish(phase.email, true), 1500);
    return () => clearTimeout(timer);
  }, [phase, finish]);

  async function activate(input: { token: string } | { email: string; code: string }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Is er al iemand ingelogd, dan vragen we geen sessie (er wordt nooit stilzwijgend van account gewisseld).
      const res = await api.activateInvitation({
        ...input,
        deviceName: platform === "web" ? "Browser" : platform === "ios" ? "iPhone/iPad" : "Android",
        issueSession: status !== "signedIn",
      });
      // Zonder verplichte MFA: direct ingelogd; het token gaat meteen naar Keychain/Keystore (nooit via een URL).
      if (res.signedIn) await finishActivation(res);
      setPhase({ kind: "done", email: res.email, ringName: res.ringName, mfaRequired: res.mfaRequired, signedIn: res.signedIn });
    } catch (err) {
      // Bij een onderbroken verbinding is de uitnodiging mogelijk wel verwerkt: de gebruiker kan opnieuw proberen of gewoon inloggen.
      setError(err instanceof ApiRequestError ? err.message : "Er ging iets mis. Probeer het opnieuw.");
      if (err instanceof ApiRequestError && (err.code === "invitation-expired" || err.code === "invitation-invalid")) {
        setPhase({ kind: "problem", reason: err.code === "invitation-expired" ? "expired" : "invalid" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page center">
      <div className="glass card stack" style={{ width: "100%", maxWidth: 420 }}>
        <h1>Ringtools</h1>
        {phase.kind === "checking" && <Spinner />}

        {phase.kind === "ready" && (
          <>
            <div>
              <strong>Welkom, {phase.preview.name}</strong>
              <p className="muted">Je bent uitgenodigd voor {phase.preview.ringName}. Tik op de knop om je account te activeren.</p>
            </div>
            {error && <div className="error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void activate({ token: token! })}>{busy ? "Even geduld…" : "Account activeren"}</button>
            <button className="btn btn-ghost btn-block" onClick={onCancel}>Niet nu</button>
          </>
        )}

        {phase.kind === "problem" && (
          <>
            <div role="alert">
              <strong>
                {phase.reason === "expired" ? "Deze uitnodiging is verlopen" : phase.reason === "network" ? "Geen verbinding" : "Deze uitnodiging werkt niet (meer)"}
              </strong>
              <p className="muted">
                {phase.reason === "expired"
                  ? "Vraag de ringbeheerder om de uitnodiging opnieuw te versturen. Je ontvangt dan een nieuwe e-mail."
                  : phase.reason === "network"
                    ? phase.message ?? "Controleer je internetverbinding en probeer het opnieuw."
                    : "Heb je je account al geactiveerd? Dan kun je gewoon inloggen. Anders kan de ringbeheerder je opnieuw uitnodigen."}
              </p>
            </div>
            {phase.reason === "network" && <button className="btn btn-primary btn-block" onClick={() => void check()}>Opnieuw proberen</button>}
            {phase.reason !== "network" && <button className="btn btn-primary btn-block" onClick={onCancel}>Naar inloggen</button>}
            <button className="btn btn-ghost btn-block" onClick={() => setPhase({ kind: "manual" })}>Ik heb een activeringscode</button>
          </>
        )}

        {phase.kind === "manual" && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void activate({ email: email.trim(), code: code.trim() });
            }}
          >
            <p className="muted">Vul het e-mailadres en de activeringscode uit de uitnodigingsmail in.</p>
            <div>
              <label htmlFor="inv-email">E-mailadres</label>
              <input id="inv-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="inv-code">Activeringscode</label>
              <input id="inv-code" className="code" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" required value={code} onChange={(e) => setCode(groupedCode(e.target.value))} />
            </div>
            {error && <div className="error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length !== 12}>{busy ? "Even geduld…" : "Account activeren"}</button>
            <button type="button" className="btn btn-ghost btn-block" onClick={onCancel}>Terug naar inloggen</button>
          </form>
        )}

        {phase.kind === "done" && phase.signedIn && (
          <>
            <div role="status">
              <strong>Je account is geactiveerd</strong>
              <p className="muted">Je bent ingelogd bij {phase.ringName}. We brengen je naar het overzicht…</p>
            </div>
            <button className="btn btn-primary btn-block" onClick={() => finish(phase.email, true)}>Naar het overzicht</button>
          </>
        )}

        {phase.kind === "done" && !phase.signedIn && (
          <>
            <div role="status">
              <strong>Je account is geactiveerd</strong>
              <p className="muted">
                Je hebt nu toegang tot {phase.ringName}. Log in met je e-mailadres; je ontvangt een code van 8 cijfers.
                {phase.mfaRequired ? " Voor jouw account is extra verificatie met een passkey ingesteld; die gebruik je bij het inloggen." : ""}
              </p>
            </div>
            <button className="btn btn-primary btn-block" onClick={() => finish(phase.email, false)}>{status === "signedIn" ? "Terug naar het overzicht" : "Verder naar inloggen"}</button>
          </>
        )}
      </div>
    </main>
  );
}
