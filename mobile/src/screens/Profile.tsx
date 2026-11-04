import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { isNative } from "../lib/native";
import { APP_VERSION } from "../config";

export function Profile() {
  const { me, ring, api, selectRing, signOut, enablePush } = useAuth();
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const sessions = useLoad(() => api.sessions(), []);
  const devices = useLoad(() => api.devices(), []);

  async function push() {
    try {
      setPushMessage((await enablePush()).message);
      await devices.reload();
    } catch (err) {
      setPushMessage(err instanceof ApiRequestError ? err.message : "Er ging iets mis.");
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>{me?.user.name}</h1>
        <span className="muted">{me?.user.email}</span>
      </div>

      {me && me.rings.length > 1 && (
        <section className="stack" aria-label="Ring kiezen">
          <h2>Ring</h2>
          {me.rings.map((r) => (
            <button key={r.id} className="glass panel" onClick={() => void selectRing(r.id)} aria-pressed={r.id === ring?.id}>
              <div className="row between"><span>{r.name}</span>{r.id === ring?.id && <span className="badge ok">Actief</span>}</div>
            </button>
          ))}
        </section>
      )}

      <section className="glass card stack">
        <h2>Pushmeldingen</h2>
        <span className="muted">Je krijgt een melding zonder namen of functies; tikken opent het voorstel.</span>
        {isNative ? <button className="btn btn-primary" onClick={push}>Meldingen aanzetten op dit toestel</button> : <span className="muted">Alleen beschikbaar in de app.</span>}
        {pushMessage && <div role="status">{pushMessage}</div>}
        {devices.data?.devices.map((d) => (
          <div key={d.id} className="row between">
            <span>{d.platform === "ios" ? "iPhone/iPad" : "Android"}</span>
            <button className="btn btn-ghost" onClick={async () => { await api.setDeviceActive(d.id, !d.active); await devices.reload(); }}>{d.active ? "Uitzetten" : "Aanzetten"}</button>
          </div>
        ))}
      </section>

      <section className="glass card stack">
        <h2>Aangemelde toestellen</h2>
        {sessions.data?.sessions.map((s) => (
          <div key={s.id} className="row between">
            <span className="grow">{s.device}{s.current ? " (dit toestel)" : ""}</span>
            {!s.current && <button className="btn btn-ghost" onClick={async () => { await api.revokeSession(s.id); await sessions.reload(); }}>Uitloggen</button>}
          </div>
        ))}
      </section>

      <button className="btn btn-ghost btn-block" onClick={() => void signOut()}>Uitloggen</button>
      <p className="muted">Ringtools {APP_VERSION}. Ringbeheer, gebruikersbeheer, MFA/passkeys, accountverwijdering en privacyinstellingen vind je in de webapp.</p>
    </div>
  );
}
