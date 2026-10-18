"use client";

import { useActionState } from "react";
import {
  updateSmtpSettingsAction,
  sendTestMailAction,
  changeAdminPasswordAction,
  type ActionResult,
} from "@/lib/actions/settings.actions";

const initialState: ActionResult = { ok: false, message: "" };

export function SmtpForm({
  current,
}: {
  current: { host: string; port: number; security: string; username: string; fromAddress: string; fromName: string };
}) {
  const [state, action, pending] = useActionState(updateSmtpSettingsAction, initialState);
  return (
    <form action={action} className="glass-card space-y-4">
      <h2 className="font-semibold">E-mail (SMTP)</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">SMTP-server</label>
          <input name="host" defaultValue={current.host} required className="input" placeholder="smtp.jouwprovider.nl" />
        </div>
        <div>
          <label className="label">SMTP-poort</label>
          <input name="port" type="number" defaultValue={current.port} required className="input" />
        </div>
        <div>
          <label className="label">Beveiliging</label>
          <select name="security" defaultValue={current.security} className="input">
            <option value="STARTTLS">STARTTLS</option>
            <option value="TLS">TLS</option>
            <option value="NONE">Geen</option>
          </select>
        </div>
        <div>
          <label className="label">SMTP-gebruikersnaam</label>
          <input name="username" defaultValue={current.username} className="input" />
        </div>
        <div>
          <label className="label">SMTP-wachtwoord</label>
          <input name="password" type="password" className="input" placeholder="Laat leeg om huidige wachtwoord te behouden" />
        </div>
        <div>
          <label className="label">Afzenderadres</label>
          <input name="fromAddress" type="email" defaultValue={current.fromAddress} required className="input" />
        </div>
        <div>
          <label className="label">Afzendernaam</label>
          <input name="fromName" defaultValue={current.fromName} required className="input" />
        </div>
      </div>
      {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Opslaan…" : "Instellingen opslaan"}
      </button>
    </form>
  );
}

export function TestMailForm({ adminEmail }: { adminEmail: string }) {
  const [state, action, pending] = useActionState(sendTestMailAction, initialState);
  return (
    <form action={action} className="glass-card space-y-3">
      <h2 className="font-semibold">Test e-mail versturen</h2>
      <input name="to" type="email" defaultValue={adminEmail} className="input" />
      {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-ghost">
        {pending ? "Versturen…" : "Test e-mail versturen"}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changeAdminPasswordAction, initialState);
  return (
    <form action={action} className="glass-card space-y-3">
      <h2 className="font-semibold">Eigen wachtwoord wijzigen</h2>
      <input name="currentPassword" type="password" placeholder="Huidig wachtwoord" required className="input" />
      <input name="newPassword" type="password" placeholder="Nieuw wachtwoord (min. 10 tekens)" required className="input" />
      <input name="confirmPassword" type="password" placeholder="Bevestig nieuw wachtwoord" required className="input" />
      {state.message && <p className={`text-sm ${state.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{state.message}</p>}
      <button type="submit" disabled={pending} className="btn-ghost">
        {pending ? "Opslaan…" : "Wachtwoord wijzigen"}
      </button>
    </form>
  );
}
