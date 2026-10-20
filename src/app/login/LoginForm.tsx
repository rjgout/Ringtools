"use client";

import { useActionState, useState } from "react";
import { requestMagicLinkAction, loginWithCodeAction, adminLoginAction, type ActionResult } from "@/lib/actions/auth.actions";

const initialState: ActionResult = { ok: false, message: "" };

export function LoginForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const [emailValue, setEmailValue] = useState("");
  const [mode, setMode] = useState<"email" | "admin">("email");
  const [emailState, emailAction, emailPending] = useActionState(requestMagicLinkAction, initialState);
  const [codeState, codeAction, codePending] = useActionState(loginWithCodeAction, initialState);
  const [adminState, adminAction, adminPending] = useActionState(adminLoginAction, initialState);

  return (
    <div className="glass-card w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">Ringtools</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Ring Apeldoorn</p>
      </div>

      {linkError && (
        <p className="badge-danger mb-4 block rounded-xl px-4 py-2 text-center text-sm">
          Deze inloglink is ongeldig of verlopen. Vraag een nieuwe aan.
        </p>
      )}

      <div className="mb-5 flex gap-1 rounded-2xl bg-black/5 p-1 dark:bg-white/5">
        <button
          type="button"
          onClick={() => setMode("email")}
          className={`flex-1 rounded-xl py-2 text-sm font-medium transition ${
            mode === "email" ? "glass" : "text-[var(--text-muted)]"
          }`}
        >
          Inloggen met e-mail
        </button>
        <button
          type="button"
          onClick={() => setMode("admin")}
          className={`flex-1 rounded-xl py-2 text-sm font-medium transition ${
            mode === "admin" ? "glass" : "text-[var(--text-muted)]"
          }`}
        >
          Beheerder
        </button>
      </div>

      {mode === "email" ? (
        <form action={emailAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              E-mailadres
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              className="input"
              placeholder="naam@ringapeldoorn.nl"
            />
          </div>
          {next && <input type="hidden" name="redirect" value={next} />}
          <button type="submit" disabled={emailPending} className="btn-primary w-full">
            {emailPending ? "Even geduld…" : "Stuur inloglink"}
          </button>
          {emailState.message && (
            <p className={`text-center text-sm ${emailState.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
              {emailState.message}
            </p>
          )}
        </form>
      ) : null}

      {mode === "email" && emailState.ok ? (
        <form action={codeAction} className="mt-5 space-y-3 border-t border-black/10 pt-5 dark:border-white/10">
          <p className="text-sm text-[var(--text-muted)]">
            Gebruik je Ringtools als app op je beginscherm? Een link in de e-mail opent op een iPhone of iPad in de browser. Voer
            dan hier de code uit de e-mail in.
          </p>
          <div>
            <label className="label" htmlFor="code">
              Inlogcode (8 cijfers)
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{8,12}"
              required
              className="input"
              placeholder="12345678"
            />
          </div>
          <input type="hidden" name="email" value={emailValue} />
          {next && <input type="hidden" name="redirect" value={next} />}
          <button type="submit" disabled={codePending} className="btn-ghost w-full">
            {codePending ? "Even geduld…" : "Inloggen met code"}
          </button>
          {codeState.message && <p className="text-center text-sm text-[var(--danger)]">{codeState.message}</p>}
        </form>
      ) : null}

      {mode === "email" ? null : (
        <form action={adminAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="username">
              Gebruikersnaam
            </label>
            <input id="username" name="username" type="text" required autoFocus className="input" placeholder="webmin" />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Wachtwoord
            </label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
          </div>
          <button type="submit" disabled={adminPending} className="btn-primary w-full">
            {adminPending ? "Even geduld…" : "Inloggen"}
          </button>
          {adminState.message && <p className="text-center text-sm text-[var(--danger)]">{adminState.message}</p>}
        </form>
      )}
    </div>
  );
}
