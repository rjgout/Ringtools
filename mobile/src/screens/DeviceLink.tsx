import { groupedCode } from "../lib/codeInput";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { registerThisDevice } from "../lib/deviceRegistration";

/** Koppelt dit toestel met een eenmalige code van de website (Beveiliging → Vertrouwde toestellen). Geen camera nodig: de code wordt overgetypt. */
export function DeviceLink({ onClose }: { onClose: () => void }) {
  const { api } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await registerThisDevice(api, code);
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(res.message);
  }

  return (
    <main className="page center">
      <div className="glass card stack" style={{ width: "100%", maxWidth: 420 }}>
      <h1>Toestel koppelen</h1>
      {done ? (
        <>
          <p role="status">Dit toestel is gekoppeld. Je kunt het op de website onder Beveiliging weer intrekken. Een gekoppeld toestel vervangt je passkey of authenticator-app niet.</p>
          <button type="button" className="btn btn-block" onClick={onClose}>Klaar</button>
        </>
      ) : (
        <form onSubmit={submit} className="stack">
          <p className="muted">Open op de website Beveiliging → Vertrouwde toestellen en kies &ldquo;Nieuw toestel koppelen&rdquo;. Typ de getoonde code hier over. Je wordt gevraagd je toestel te ontgrendelen.</p>
          <label htmlFor="pair-code">Koppelcode</label>
          <input id="pair-code" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={code} onChange={(e) => setCode(groupedCode(e.target.value))} inputMode="text" />
          {error && <p role="alert" className="error">{error}</p>}
          <button type="submit" className="btn btn-block" disabled={busy || code.trim().length === 0}>{busy ? "Bezig…" : "Koppelen"}</button>
          <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>Annuleren</button>
        </form>
      )}
      </div>
    </main>
  );
}
