import { Link } from "react-router-dom";
import { AccountPrivacy } from "../components/AccountPrivacy";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { isNative } from "../lib/native";
import { APP_VERSION, IS_WEB_APP } from "../config";
import { WebInstallSection, WebPushSection, WebSecuritySection } from "../web/WebProfileSections";
import { nativeCapabilities, PERSONAL_TEAM_NOTICE } from "../lib/buildProfile";
import { useReauth } from "../components/Reauth";
import { ActionMenu, MENU_ICONS } from "../components/Menu";
import { useConfirm } from "../components/Dialog";
import { activateDeviceLoginKey, deviceLoginMessage, deviceLoginSupported, readDeviceKeyRef } from "../lib/deviceLogin";
import { describeDevice, enrollThisDevice, type DeviceState } from "../lib/deviceEnrollment";
import { nativeDeviceKeys } from "../lib/deviceKey";
import { storage } from "../lib/storage";
import { useServerCapabilities } from "../lib/useServerCapabilities";

export function Profile() {
  const { me, ring, api, selectRing, signOut, enablePush } = useAuth();
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const caps = nativeCapabilities();
  const sessions = useLoad(() => api.sessions(), []);
  const devices = useLoad(() => (IS_WEB_APP ? Promise.resolve({ devices: [] }) : api.devices()), []);
  // Snel aanmelden (E2.4a/E2.5): status van dit toestel voor dit account; instellen, activeren of uitzetten. De server beslist (recente tweede factor).
  const server = useServerCapabilities(api);
  const { run, dialog } = useReauth();
  const [deviceState, setDeviceState] = useState<DeviceState>({ kind: "unknown" });
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const supported = server.caps.deviceLogin && deviceLoginSupported() && !!me;
  const showDeviceLogin = supported && !me?.user.reviewAccount;
  const meId = me?.user.id;
  async function refreshDevice() {
    if (meId) setDeviceState(await describeDevice(api, meId));
  }
  useEffect(() => {
    if (!showDeviceLogin || !meId) return;
    let active = true;
    void describeDevice(api, meId).then((st) => { if (active) setDeviceState(st); });
    return () => { active = false; };
  }, [showDeviceLogin, api, meId]);

  async function setUpFaceId() {
    if (!me) return;
    setDeviceBusy(true);
    setDeviceMessage(null);
    try {
      if (deviceState.kind === "registered") {
        await run(() => activateDeviceLoginKey(api));
      } else {
        const res = await run(() => enrollThisDevice(api, { id: me.user.id, name: me.user.name }));
        if (!res.ok) { setDeviceMessage(res.message); return; }
      }
      await storage.clearDeviceOfferDeclined().catch(() => undefined);
      setConfirmReplace(false);
      setDeviceMessage("Snel aanmelden staat aan.");
      await refreshDevice();
    } catch (err) {
      setDeviceMessage(deviceLoginMessage(err));
    } finally {
      setDeviceBusy(false);
    }
  }

  const confirm = useConfirm();
  async function turnOffFaceId() {
    const ok = await confirm({ title: "Snel aanmelden uitzetten?", message: "Op dit toestel log je daarna weer in met een e-mailcode en je tweede factor.", confirmLabel: "Uitzetten", danger: true });
    if (!ok) return;
    const ref = await readDeviceKeyRef();
    if (!ref) return;
    setDeviceBusy(true);
    setDeviceMessage(null);
    try {
      await run(() => api.deviceDisable(ref.installationId));
      await nativeDeviceKeys.remove(ref.tag).catch(() => undefined);
      await storage.clearDeviceKey();
      await storage.forgetPersistentSession();
      setDeviceMessage("Snel aanmelden is uitgezet voor dit toestel.");
      await refreshDevice();
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

      {IS_WEB_APP ? <><WebSecuritySection /><WebPushSection /><WebInstallSection /></> : <section className="glass card stack">
        <h2>Pushmeldingen</h2>
        {me?.user.reviewAccount && <p>De demo gebruikt alleen interne meldingen; er wordt geen push of e-mail verstuurd.</p>}
        <span className="muted">Je krijgt een melding zonder namen of functies; tikken opent het voorstel.</span>
        {caps.limited && <div role="note" className="note bad">{PERSONAL_TEAM_NOTICE}</div>}
        {caps.limited || me?.user.reviewAccount ? null : isNative ? <button className="btn btn-primary" onClick={push}>Meldingen aanzetten op dit toestel</button> : <span className="muted">Alleen beschikbaar in de app.</span>}
        {pushMessage && <div role="status">{pushMessage}</div>}
        {devices.data?.devices.map((d) => (
          <div key={d.id} className="row between">
            <span>{d.platform === "ios" ? "iPhone/iPad" : "Android"}</span>
            <button className="btn btn-ghost" onClick={async () => { await api.setDeviceActive(d.id, !d.active); await devices.reload(); }}>{d.active ? "Uitzetten" : "Aanzetten"}</button>
          </div>
        ))}
      </section>}

      {showDeviceLogin && (
        <section className="glass card stack" aria-label="Snel aanmelden">
          <h2>Aanmelden en beveiliging</h2>
          <label className="row between">
            <span>Snel aanmelden op dit toestel</span>
            <input type="checkbox" role="switch" checked={deviceState.kind === "enabled"}
              disabled={deviceBusy || deviceState.kind === "unknown" || (deviceState.kind === "conflict" && !confirmReplace) || (!server.caps.deviceAutoEnroll && deviceState.kind !== "registered" && deviceState.kind !== "enabled")}
              onChange={() => void (deviceState.kind === "enabled" ? turnOffFaceId() : setUpFaceId())} />
          </label>
          {deviceState.kind === "enabled" ? (
            <>
              <span>Ingeschakeld op dit toestel. Je bevestigt met de beveiliging van je telefoon.</span>
              <span className="muted">Vertrouwde toestellen beheer je op de website onder Beveiliging.</span>
            </>
          ) : deviceState.kind === "conflict" && !confirmReplace ? (
            <>
              <span className="muted">de beveiliging van je telefoon is op dit toestel al ingesteld voor {deviceState.ownerName ? `het account van ${deviceState.ownerName}` : "een ander account"}.</span>
              <button className="btn btn-primary" onClick={() => setConfirmReplace(true)}>Overzetten naar mijn account…</button>
            </>
          ) : !server.caps.deviceAutoEnroll && deviceState.kind !== "registered" ? (
            <span className="muted">Snel aanmelden is nog niet beschikbaar. Je kunt je e-mailcode blijven gebruiken.</span>
          ) : deviceState.kind === "unknown" ? (
            <span className="muted">De status kon niet worden opgehaald.</span>
          ) : (
            <>
              <span className="muted">
                {deviceState.kind === "conflict"
                  ? "Weet je het zeker? De instelling voor het andere account wordt op dit toestel vervangen; dat account kan nog inloggen met e-mailcode en tweede factor."
                  : "Log voortaan in met de beveiliging van je telefoon of toestelcode, zonder e-mailcode. Bevestig zo nodig opnieuw je identiteit."}
              </span>
            </>
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
            {!s.current && (
              <ActionMenu label={`Acties voor ${s.device}`} items={[{
                id: "revoke", label: "Sessie intrekken…", icon: MENU_ICONS.ban, danger: true,
                onSelect: () => void (async () => {
                  const ok = await confirm({ title: "Sessie intrekken?", message: `${s.device} wordt direct uitgelogd en moet opnieuw inloggen.`, confirmLabel: "Intrekken", danger: true });
                  if (ok) { await api.revokeSession(s.id); await sessions.reload(); }
                })(),
              }]} />
            )}
          </div>
        ))}
      </section>

      {me?.user.reviewAccount && ring?.role === "RINGSECRETARIS" && <Link className="glass panel" to="/demo-beheer">Gebruikersbeheer – demo</Link>}
      {IS_WEB_APP ? <a className="glass panel" href="/accountverwijdering">Account en privacy</a> : <AccountPrivacy />}
      {signOutError && <div className="error" role="alert">{signOutError}</div>}
      <button className="btn btn-ghost btn-block" onClick={() => void (async () => {
        setSignOutError(null);
        if (await confirm({ title: "Uitloggen?", message: IS_WEB_APP ? "Je moet daarna opnieuw inloggen met een e-mailcode." : "Je moet daarna opnieuw inloggen met een e-mailcode en je tweede factor.", confirmLabel: "Uitloggen" })) {
          try { await signOut(); } catch (err) { setSignOutError(err instanceof ApiRequestError ? err.message : "Uitloggen is niet gelukt. Probeer het opnieuw."); }
        }
      })()}>Uitloggen</button>
      <p className="muted">{IS_WEB_APP ? `Ringtools ${APP_VERSION} (web).` : `Ringtools ${APP_VERSION}. MFA en passkeys beheer je via de beveiligde website.`}</p>
    </div>
  );
}
