import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { useReauth } from "./Reauth";
import { describeDevice, enrollThisDevice, type DeviceState } from "../lib/deviceEnrollment";
import { activateDeviceLoginKey, deviceLoginMessage, deviceLoginSupported } from "../lib/deviceLogin";
import { nativeDeviceKeys } from "../lib/deviceKey";
import { readDeviceKeyRef } from "../lib/deviceLogin";
import { storage } from "../lib/storage";
import { useServerCapabilities } from "../lib/useServerCapabilities";

type Plan = Extract<DeviceState, { kind: "none" | "registered" | "replace-own" | "conflict" }>;

/**
 * E2.5: na de eerste volledige aanmelding biedt de app aan om Face ID-inloggen in te stellen. Alleen voor een gewone gebruiker met verplichte MFA, op een
 * iPhone, met de serverfunctie aan en een recent bewezen tweede factor (de server dwingt dat af). Eén keer per sessie; "Niet nu" of annuleren wordt onthouden
 * (geen aandringen); via Profiel kan het altijd later. Een lokale koppeling van een ander account wordt alleen na expliciete bevestiging vervangen.
 */
export function DeviceOffer() {
  const { api, me } = useAuth();
  const server = useServerCapabilities(api);
  const { run, dialog } = useReauth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const checked = useRef<string | null>(null);

  const userId = me?.user.id ?? null;
  const eligible = !me?.user.reviewAccount && !!userId && server.status === "ready" && server.caps.deviceAutoEnroll && deviceLoginSupported();

  useEffect(() => {
    if (!eligible || !userId || checked.current === userId) return;
    checked.current = userId; // hooguit één controle per gebruiker per sessie
    let active = true;
    void (async () => {
      if ((await storage.getDeviceOfferDeclined().catch(() => null)) === userId) return;
      const st = await describeDevice(api, userId);
      if (active && (st.kind === "none" || st.kind === "registered" || st.kind === "replace-own" || st.kind === "conflict")) setPlan(st);
    })();
    return () => { active = false; };
  }, [eligible, userId, api]);

  if (!plan || !me) return <>{dialog}</>;

  async function decline() {
    if (userId) await storage.setDeviceOfferDeclined(userId).catch(() => undefined);
    const ref = await readDeviceKeyRef();
    if (ref) await nativeDeviceKeys.remove(ref.tag).catch(() => undefined);
    await storage.clearDeviceKey();
    await storage.forgetPersistentSession();
    setPlan(null);
  }

  async function accept() {
    if (!plan || !me) return;
    setBusy(true);
    setMessage(null);
    try {
      if (plan.kind === "registered") {
        await run(() => activateDeviceLoginKey(api));
        await storage.persistSession();
        setPlan(null);
        return;
      }
      const res = await run(() => enrollThisDevice(api, { id: me.user.id, name: me.user.name }));
      if (res.ok) setPlan(null);
      else {
        setMessage(res.message);
        if (res.cancelled) await storage.setDeviceOfferDeclined(me.user.id).catch(() => undefined);
      }
    } catch (err) {
      setMessage(deviceLoginMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const conflict = plan.kind === "conflict";
  return (
    <>
      <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Snel aanmelden instellen" data-testid="device-offer">
        <div className="glass card stack lock-card">
          <h1>Wil je voortaan sneller toegang tot Ringtools?</h1>
          {conflict ? (
            <p>
              Snel aanmelden is op dit toestel al ingesteld voor {plan.kind === "conflict" && plan.ownerName ? `het account van ${plan.ownerName}` : "een ander account"}. Als je doorgaat, wordt die
              instelling op dit toestel vervangen door jouw account. Dat andere account kan nog steeds inloggen met een e-mailcode en tweede factor.
            </p>
          ) : (
            <p>
              Met de biometrie of beveiliging van je telefoon kun je Ringtools openen. Je hoeft dan geen e-mailcode meer te gebruiken. Je bevestigt dit nu één keer. Je kunt het
              later altijd weer uitzetten in je profiel.
            </p>
          )}
          {message && <p role="alert" className="error">{message}</p>}
          <button className="btn btn-primary" disabled={busy} onClick={() => void accept()}>{busy ? "Even geduld…" : conflict ? "Vervangen en instellen" : "Ja, stel dit in"}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void decline()}>Nee, ik log telkens opnieuw in</button>
        </div>
      </div>
      {dialog}
    </>
  );
}
