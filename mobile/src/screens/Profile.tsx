import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { isNative } from "../lib/native";
import { APP_VERSION } from "../config";
import { nativeCapabilities, PERSONAL_TEAM_NOTICE } from "../lib/buildProfile";
import { useReauth } from "../components/Reauth";
import { activateDeviceLoginKey, deviceLoginMessage, deviceLoginSupported, readDeviceKeyRef } from "../lib/deviceLogin";
import { useServerCapabilities } from "../lib/useServerCapabilities";

export function Profile() {
  const { me, ring, api, selectRing, signOut, enablePush } = useAuth();
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const caps = nativeCapabilities();
  const sessions = useLoad(() => api.sessions(), []);
  const devices = useLoad(() => api.devices(), []);
  // E2.4a: dit toestel expliciet activeren als inlogmethode (Face ID). Vereist recente MFA; de server beslist.
  const server = useServerCapabilities(api);
  const { run, dialog } = useReauth();
  const [deviceState, setDeviceState] = useState<"unknown" | "none" | "registered" | "enabled">("unknown");
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const showDeviceLogin = server.caps.deviceLogin && deviceLoginSupported();
  useEffect(() => {
    if (!showDeviceLogin) return;
    let active = true;
    void (async () => {
      const ref = await readDeviceKeyRef();
      if (!ref) { if (active) setDeviceState("none"); return; }
      try {
        const st = await api.deviceStatus(ref.installationId);
        if (active) setDeviceState(!st.registered ? "none" : st.loginEnabled ? "enabled" : "registered");
      } catch {
        if (active) setDeviceState("unknown");
      }
    })();
    return () => { active = false; };
  }, [showDeviceLogin, api]);

  async function activateDevice() {
    setDeviceBusy(true);
    setDeviceMessage(null);
    try {
      await run(() => activateDeviceLoginKey(api));
      setDeviceState("enabled");
      setDeviceMessage("Wachtwoordloos inloggen staat aan voor dit toestel.");
    } catch (err) {
      setDeviceMessage(deviceLoginMessage(err));
    } finally {
      setDeviceBusy(false);
    }
  }

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
        {caps.limited && <div role="note" className="badge bad" style={{ whiteSpace: "normal", borderRadius: 12 }}>{PERSONAL_TEAM_NOTICE}</div>}
        {caps.limited ? null : isNative ? <button className="btn btn-primary" onClick={push}>Meldingen aanzetten op dit toestel</button> : <span className="muted">Alleen beschikbaar in de app.</span>}
        {pushMessage && <div role="status">{pushMessage}</div>}
        {devices.data?.devices.map((d) => (
          <div key={d.id} className="row between">
            <span>{d.platform === "ios" ? "iPhone/iPad" : "Android"}</span>
            <button className="btn btn-ghost" onClick={async () => { await api.setDeviceActive(d.id, !d.active); await devices.reload(); }}>{d.active ? "Uitzetten" : "Aanzetten"}</button>
          </div>
        ))}
      </section>

      {showDeviceLogin && (
        <section className="glass card stack" aria-label="Wachtwoordloos inloggen">
          <h2>Wachtwoordloos inloggen</h2>
          {deviceState === "enabled" ? (
            <span>Dit toestel kan inloggen met Face ID. Uitzetten kan op de website onder Beveiliging.</span>
          ) : deviceState === "registered" ? (
            <>
              <span className="muted">Gebruik dit toestel om zonder e-mailcode in te loggen. Je bevestigt elke keer met Face ID of je toestelcode. Je moet hiervoor eerst opnieuw je tweede factor bevestigen.</span>
              <button className="btn btn-primary" disabled={deviceBusy} onClick={() => void activateDevice()}>{deviceBusy ? "Even geduld…" : "Inloggen met Face ID inschakelen"}</button>
            </>
          ) : deviceState === "none" ? (
            <span className="muted">Dit toestel is nog niet gekoppeld. Koppel het eerst op het inlogscherm met een code van de website (Beveiliging → Vertrouwde toestellen).</span>
          ) : (
            <span className="muted">De status van dit toestel kon niet worden opgehaald.</span>
          )}
          {deviceMessage && <div role="status">{deviceMessage}</div>}
        </section>
      )}
      {dialog}

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
      <p className="muted">Ringtools {APP_VERSION}. MFA/passkeys, accountverwijdering en privacyinstellingen vind je voorlopig in de webapp.</p>
    </div>
  );
}
