import { useState } from "react";
import type { AppointAuthority, ChurchFunctionCode, InvitationItem, InvitationStatus, ManagedUser, Role } from "@shared/api-types";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/useLoad";
import { ApiRequestError } from "../lib/api";
import { useReauth } from "../components/Reauth";
import { ErrorState, Spinner } from "../components/ui";
import { accessInfo, formatWhen } from "../lib/accessStatus";

const ROLES: { value: Role; label: string }[] = [
  { value: "RINGPRESIDIUM", label: "Ringpresidium" },
  { value: "RINGSECRETARIS", label: "Ringsecretaris" },
  { value: "RINGADMINISTRATEUR", label: "Ringadministrateur" },
  { value: "HOGERAAD", label: "Hoge raad" },
];

type Draft = { name: string; email: string; churchFunction: string; churchFunctionCode: ChurchFunctionCode; role: Role; isRingManager: boolean; active: boolean; appointAuthority: AppointAuthority };
const EMPTY: Draft = { name: "", email: "", churchFunction: "", churchFunctionCode: "ONBEKEND", role: "HOGERAAD", isRingManager: false, active: true, appointAuthority: "NONE" };

/** Gestructureerde kerkelijke functies en bij welke Ringtools-rollen ze passen (de server dwingt dit af). */
export const CHURCH_FUNCTIONS: { value: ChurchFunctionCode; label: string; roles: Role[] | null }[] = [
  { value: "ONBEKEND", label: "Nog niet vastgelegd (geen bevoegdheden)", roles: null },
  { value: "RINGPRESIDENT", label: "Ringpresident", roles: ["RINGPRESIDIUM"] },
  { value: "EERSTE_RAADGEVER", label: "Eerste raadgever ringpresidium", roles: ["RINGPRESIDIUM"] },
  { value: "TWEEDE_RAADGEVER", label: "Tweede raadgever ringpresidium", roles: ["RINGPRESIDIUM"] },
  { value: "RINGSECRETARIS", label: "Ringsecretaris", roles: ["RINGSECRETARIS"] },
  { value: "RINGADMINISTRATEUR", label: "Ringadministrateur", roles: ["RINGADMINISTRATEUR"] },
  { value: "HOGERAADSLID", label: "Hogeraadslid", roles: ["HOGERAAD"] },
  { value: "ANDERS", label: "Andere functie (zie omschrijving)", roles: null },
];
export const functionLabel = (c: ChurchFunctionCode | undefined) => CHURCH_FUNCTIONS.find((f) => f.value === c)?.label ?? "Nog niet vastgelegd";

/** Machtigingen zijn alleen waar het handboek een "aangewezen" persoon vraagt, en alleen bij de passende functie. De ringpresident heeft er geen nodig. */
const authoritiesFor = (fn: ChurchFunctionCode): { value: AppointAuthority; label: string }[] => [
  { value: "NONE", label: "Geen machtiging" },
  ...(fn === "EERSTE_RAADGEVER" || fn === "TWEEDE_RAADGEVER" ? [{ value: "AANGEWEZEN_RAADGEVER" as const, label: "Aangewezen raadgever (machtiging)" }] : []),
  ...(fn === "HOGERAADSLID" ? [{ value: "AANGEWEZEN_HOGERAADSLID" as const, label: "Aangewezen hogeraadslid (machtiging)" }] : []),
];
const AUTHORITY_LABELS: Record<AppointAuthority, string> = { NONE: "", RINGPRESIDENT: "", AANGEWEZEN_RAADGEVER: "Aangewezen raadgever", AANGEWEZEN_HOGERAADSLID: "Aangewezen hogeraadslid" };

/**
 * Gebruikersbeheer voor één ring (ringbeheerder: eigen ring; webmin: elke ring). Alle regels — eigen ring,
 * minstens één actieve ringbeheerder, kerkelijke functie ≠ rechten — worden door de server afgedwongen.
 */
export function UserManager({ ringId }: { ringId: string }) {
  const { api } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.ringUsers(ringId), [ringId]);
  const { run, dialog } = useReauth();
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const invites = useLoad(() => api.ringInvitations(ringId), [ringId]);
  const [notice, setNotice] = useState<string | null>(null);

  function open(target: ManagedUser | "new") {
    setEditing(target);
    setMessage(null);
    setDraft(target === "new" ? EMPTY : { name: target.name, email: target.email, churchFunction: target.churchFunction, churchFunctionCode: target.churchFunctionCode ?? "ONBEKEND", role: target.role, isRingManager: target.isRingManager, active: target.active, appointAuthority: target.appointAuthority ?? "NONE" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setMessage(null);
    // Omschrijving is vrije tekst (geen bevoegdheid); zonder omschrijving gebruiken we de naam van de gekozen functie.
    const description = draft.churchFunction.trim() || (draft.churchFunctionCode === "ONBEKEND" ? "Functie nog niet vastgelegd" : functionLabel(draft.churchFunctionCode));
    const authority = authoritiesFor(draft.churchFunctionCode).some((a) => a.value === draft.appointAuthority) ? draft.appointAuthority : "NONE";
    try {
      if (editing === "new") {
        // Nieuwe mensen worden uitgenodigd (zij activeren zelf hun account); een machtiging legt de beheerder pas na activatie vast.
        const res = await run(() => api.createInvitation(ringId, { name: draft.name, email: draft.email, role: draft.role, churchFunction: description, churchFunctionCode: draft.churchFunctionCode, isRingManager: draft.isRingManager }));
        setNotice(res.sent ? `De uitnodiging is verstuurd naar ${draft.email.trim()}.` : "De uitnodiging is aangemaakt, maar de e-mail kon niet worden verstuurd. Probeer het onder 'Uitnodigingen' opnieuw.");
        await invites.reload();
      } else {
        await run(() => api.updateRingUser(editing.membershipId, { churchFunction: description, churchFunctionCode: draft.churchFunctionCode, role: draft.role, isRingManager: draft.isRingManager, active: draft.active, appointAuthority: authority, name: draft.name, email: draft.email }));
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiRequestError && err.code !== "cancelled" ? err.message : err instanceof ApiRequestError ? null : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  /** Gewone inlogmail (geen uitnodiging) naar het geregistreerde adres van een bestaand, actief lid; vereist recente verificatie. */
  async function sendLoginMail(userId: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await run(() => api.sendLoginMail(ringId, userId));
      setNotice(res.message);
      setEditing(null);
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiRequestError && err.code !== "cancelled" ? err.message : err instanceof ApiRequestError ? null : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  /** Uitnodiging opnieuw versturen voor een niet-geactiveerde gebruiker (zelfde serverfunctie als in "Uitnodigingen": recente verificatie, wachttijd, limiet en audit). */
  async function resend(invitationId: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await run(() => api.resendInvitation(invitationId));
      setNotice(res.inProgress ? "De uitnodiging wordt al verstuurd. Even geduld." : res.sent ? "De uitnodiging is opnieuw verstuurd." : "Versturen is niet gelukt. Probeer het later opnieuw.");
      setEditing(null);
      await invites.reload();
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiRequestError && err.code !== "cancelled" ? err.message : err instanceof ApiRequestError ? null : "Er ging iets mis.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {dialog}
      <div className="row between"><h2>Gebruikers</h2><button className="btn btn-primary" onClick={() => open("new")}>Uitnodigen</button></div>
      {notice && <div className="banner ok" role="status">{notice}</div>}
      <Invitations items={invites.data?.invitations ?? []} error={invites.error} onChanged={async (text) => { if (text) setNotice(text); await invites.reload(); await reload(); }} />
      {loading && !data && <Spinner />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data?.users.map((u) => (
        <button key={u.membershipId} className="glass panel" onClick={() => open(u)} aria-label={`Wijzig ${u.name}`}>
          <div className="row between">
            <div className="grow" style={{ textAlign: "left" }}>
              <strong>{u.name}</strong>
              <div className="muted">{functionLabel(u.churchFunctionCode)}{u.churchFunction && u.churchFunctionCode === "ANDERS" ? ` – ${u.churchFunction}` : ""} · Rol: {ROLES.find((r) => r.value === u.role)?.label}</div>
              {u.churchFunctionCode === "ONBEKEND" && (u.role === "RINGPRESIDIUM" || u.role === "HOGERAAD") && <div className="muted">Kerkelijke functie nog vast te leggen</div>}
              {accessInfo(u).lines.map((l) => <div key={l} className="muted">{l}</div>)}
            </div>
            <div className="stack" style={{ alignItems: "flex-end" }}>
              {u.isRingManager && <span className="badge ok">Ringbeheerder</span>}
              {u.appointAuthority && AUTHORITY_LABELS[u.appointAuthority] && <span className="badge">{AUTHORITY_LABELS[u.appointAuthority]}</span>}
              <span className={`badge${u.activated ? " ok" : ""}`}>{accessInfo(u).badge}</span>
              {!u.active && <span className="badge bad">Inactief</span>}
            </div>
          </div>
        </button>
      ))}

      {editing && (
        <form className="glass card stack" onSubmit={save} aria-label={editing === "new" ? "Iemand uitnodigen" : "Gebruiker wijzigen"}>
          <strong>{editing === "new" ? "Iemand uitnodigen" : "Gebruiker wijzigen"}</strong>
          {editing === "new" && <span className="muted">De persoon krijgt een e-mail met een link om het account te activeren.</span>}
          <div><label htmlFor="u-name">Naam</label><input id="u-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required minLength={2} /></div>
          <div><label htmlFor="u-email">E-mailadres</label><input id="u-email" type="email" autoCapitalize="none" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required /></div>
          <div>
            <label htmlFor="u-role">Ringtools-rol (toegang)</label>
            <select id="u-role" value={draft.role} onChange={(e) => {
              const role = e.target.value as Role;
              const fits = CHURCH_FUNCTIONS.find((f) => f.value === draft.churchFunctionCode)?.roles?.includes(role) ?? true;
              setDraft({ ...draft, role, churchFunctionCode: fits ? draft.churchFunctionCode : "ONBEKEND", appointAuthority: fits ? draft.appointAuthority : "NONE" });
            }}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <span className="muted">De rol regelt alleen toegang en gebruikersbeheer. Een rol geeft nooit kerkelijke bevoegdheid.</span>
          </div>
          <div>
            <label htmlFor="u-fcode">Kerkelijke functie</label>
            <select id="u-fcode" value={draft.churchFunctionCode} onChange={(e) => {
              const churchFunctionCode = e.target.value as ChurchFunctionCode;
              setDraft({ ...draft, churchFunctionCode, appointAuthority: authoritiesFor(churchFunctionCode).some((a) => a.value === draft.appointAuthority) ? draft.appointAuthority : "NONE" });
            }}>
              {CHURCH_FUNCTIONS.filter((f) => f.roles === null || f.roles.includes(draft.role)).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <span className="muted">De functie bepaalt welke bevoegdheden volgens de handboekprocedure mogelijk zijn. Bij &lsquo;Nog niet vastgelegd&rsquo; heeft iemand geen enkele bevoegdheid.</span>
          </div>
          <div><label htmlFor="u-func">Omschrijving (optioneel)</label><input id="u-func" value={draft.churchFunction} onChange={(e) => setDraft({ ...draft, churchFunction: e.target.value })} maxLength={200} /><span className="muted">Vrije tekst ter informatie; bepaalt nooit een bevoegdheid.</span></div>
          {editing !== "new" && <div>
            <label htmlFor="u-auth">Machtiging</label>
            <select id="u-auth" value={authoritiesFor(draft.churchFunctionCode).some((a) => a.value === draft.appointAuthority) ? draft.appointAuthority : "NONE"} onChange={(e) => setDraft({ ...draft, appointAuthority: e.target.value as AppointAuthority })}>
              {authoritiesFor(draft.churchFunctionCode).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <span className="muted">{draft.churchFunctionCode === "RINGPRESIDENT" ? "De ringpresident is op grond van zijn functie bevoegd; een aparte machtiging is niet nodig." : "Alleen een expliciet vastgelegde machtiging maakt een aangewezen raadgever of hogeraadslid bevoegd om te roepen of aan te stellen."}</span>
          </div>}
          {editing === "new" && <span className="muted">Een machtiging (aangewezen raadgever of hogeraadslid) kun je vastleggen nadat de persoon zijn account heeft geactiveerd.</span>}
          <label className="row"><input type="checkbox" checked={draft.isRingManager} onChange={(e) => setDraft({ ...draft, isRingManager: e.target.checked })} /> Ringbeheerder (beheert de gebruikers van deze ring)</label>
          {editing !== "new" && <label className="row"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Actief in deze ring</label>}
          {editing !== "new" && <AccessSection user={editing} busy={busy} onResend={resend} onLoginMail={sendLoginMail} />}
          {message && <div className="error" role="alert">{message}</div>}
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Annuleren</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Bezig…" : editing === "new" ? "Uitnodiging versturen" : "Opslaan"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Toegang en inlogcode van één gebruiker: status, verzenddatum en de juiste vervolgstap (opnieuw uitnodigen of uitleg). */
function AccessSection({ user, busy, onResend, onLoginMail }: { user: ManagedUser; busy: boolean; onResend: (invitationId: string) => void; onLoginMail: (userId: string) => void }) {
  const info = accessInfo(user);
  return (
    <section className="stack" aria-label="Toegang en inlogcode">
      <strong>Toegang en inlogcode</strong>
      <span className={`badge${info.activated ? " ok" : ""}`} style={{ alignSelf: "flex-start" }}>{info.badge}</span>
      {info.lines.map((l) => <span key={l} className="muted">{l}</span>)}
      {info.resendInvitationId && (
        <>
          <button type="button" className="btn btn-ghost" disabled={busy || !!info.resendNote} onClick={() => onResend(info.resendInvitationId!)}>Uitnodiging opnieuw versturen</button>
          {info.resendNote && <span className="muted">{info.resendNote}</span>}
        </>
      )}
      {!info.resendInvitationId && info.resendNote && <span className="muted">{info.resendNote}</span>}
      {info.loginMail.show && (
        <>
          <button type="button" className="btn btn-ghost" disabled={busy || !!info.loginMail.note} onClick={() => onLoginMail(user.userId)}>Inlogmail opnieuw versturen</button>
          <span className="muted">{info.loginMail.note ?? "Dit is een gewone inlogmail naar het geregistreerde adres, geen uitnodiging. Je ziet de code niet; alleen het lid ontvangt die."}</span>
        </>
      )}
      {info.guidance && (
        <div className="badge" role="note" style={{ whiteSpace: "normal", borderRadius: 12 }}>
          {info.guidance.map((g) => <div key={g}>{g}</div>)}
        </div>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<InvitationStatus, { text: string; cls: string }> = {
  NIET_VERSTUURD: { text: "Nog niet verstuurd", cls: "bad" },
  VERSTUURD: { text: "Verstuurd", cls: "" },
  VERLOPEN: { text: "Verlopen", cls: "bad" },
  INGETROKKEN: { text: "Ingetrokken", cls: "" },
  GEACTIVEERD: { text: "Account geactiveerd", cls: "ok" },
};

/** Overzicht van uitnodigingen met opnieuw versturen en intrekken. Token en code worden hier nooit getoond. */
function Invitations({ items, error, onChanged }: { items: InvitationItem[]; error: Error | null; onChanged: (notice?: string) => Promise<void> }) {
  const { api } = useAuth();
  const { run, dialog } = useReauth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  // Geactiveerde en ingetrokken uitnodigingen zijn historie: standaard verborgen.
  const open = items.filter((i) => i.status !== "GEACTIVEERD" && i.status !== "INGETROKKEN");
  const shown = show ? items : open;
  if (error || (items.length === 0)) return null;

  async function act(id: string, kind: "resend" | "revoke") {
    if (busyId) return;
    setBusyId(id);
    setMessage(null);
    try {
      if (kind === "resend") {
        const res = await run(() => api.resendInvitation(id));
        await onChanged(res.inProgress ? "De uitnodiging wordt al verstuurd. Even geduld." : res.sent ? "De uitnodiging is opnieuw verstuurd." : "Versturen is niet gelukt. Probeer het later opnieuw.");
      } else {
        await run(() => api.revokeInvitation(id));
        await onChanged("De uitnodiging is ingetrokken.");
      }
    } catch (err) {
      setMessage(err instanceof ApiRequestError && err.code !== "cancelled" ? err.message : null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="stack" aria-label="Uitnodigingen">
      {dialog}
      <div className="row between"><h2>Uitnodigingen</h2>{items.length > open.length && <button className="btn btn-ghost" onClick={() => setShow(!show)}>{show ? "Verberg afgeronde" : "Toon alle"}</button>}</div>
      {message && <div className="error" role="alert">{message}</div>}
      {shown.length === 0 && <span className="muted">Geen openstaande uitnodigingen.</span>}
      {shown.map((i) => (
        <div key={i.id} className="glass panel">
          <div className="row between">
            <div className="grow">
              <strong>{i.name}</strong>
              <div className="muted">{i.email} · {i.roleLabel}</div>
              <div className="muted">{i.sentAt ? `Verstuurd op ${formatWhen(i.sentAt)}` : "Nog niet verstuurd"}{i.status === "VERSTUURD" ? ` · geldig tot ${new Date(i.expiresAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}` : ""}</div>
              {i.status === "VERLOPEN" && <div className="muted">De uitnodiging is verlopen. Verstuur hem opnieuw.</div>}
              {i.resendAvailableAt && new Date(i.resendAvailableAt).getTime() > Date.now() && <div className="muted">Opnieuw versturen kan vanaf {formatWhen(i.resendAvailableAt)}.</div>}
              {i.resendBlockedReason === "LIMIET" && <div className="muted">Maximaal aantal verzendingen bereikt. Trek in en nodig opnieuw uit.</div>}
            </div>
            <span className={`badge ${STATUS_LABEL[i.status].cls}`}>{STATUS_LABEL[i.status].text}</span>
          </div>
          {(i.canResend || i.canRevoke) && (
            <div className="row" style={{ marginTop: 8 }}>
              {i.canResend && <button className="btn" disabled={busyId === i.id || (!!i.resendAvailableAt && new Date(i.resendAvailableAt).getTime() > Date.now())} onClick={() => void act(i.id, "resend")}>{i.status === "VERSTUURD" ? "Herinneren" : "Opnieuw versturen"}</button>}
              {i.canRevoke && <button className="btn btn-ghost" disabled={busyId === i.id} onClick={() => void act(i.id, "revoke")}>Intrekken</button>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
