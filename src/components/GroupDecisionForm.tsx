"use client";

import { startTransition, useActionState } from "react";
import { registerGroupDecisionAction, type ActionResult } from "@/lib/actions/calling.actions";

type Person = { id: string; name: string };

/**
 * Formulier om een in de vergadering genomen gezamenlijk besluit vast te leggen. Alle regels worden server-side (workflow.ts) gecontroleerd;
 * dit formulier toont alleen de invoer. Een secretaris of administrateur legt vast wat anderen besloten en neemt het besluit niet zelf.
 */
export function GroupDecisionForm({
  callingId,
  stage,
  presidiumMembers,
  participants,
  hasNegative,
  today,
}: {
  callingId: string;
  stage: "PRESIDIUM" | "HOGERAAD";
  presidiumMembers: Person[];
  participants: Person[];
  hasNegative: boolean;
  today: string;
}) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(registerGroupDecisionAction, null);
  const label = stage === "PRESIDIUM" ? "ringpresidium" : "hoge raad";
  return (
    <details className="glass-card">
      <summary className="cursor-pointer font-semibold">Gezamenlijk akkoord {label} registreren (vergadering)</summary>
      <form
        // Bewust geen `action={...}`: React zou het formulier na een foutmelding leegmaken, en tijdens een vergadering moet de ingevoerde
        // informatie behouden blijven. De server blijft de enige die beslist.
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => dispatch(data));
        }}
        className="mt-3 space-y-3" aria-label={`Gezamenlijk akkoord ${label}`}>
        <input type="hidden" name="callingId" value={callingId} />
        <input type="hidden" name="stage" value={stage} />
        <p className="text-sm text-[var(--text-muted)]">
          Registreer alleen een besluit dat daadwerkelijk in een vergadering is genomen. Er worden geen reacties namens anderen vastgelegd; afwezigheid geldt nooit als
          ondersteuning.
        </p>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-red-600">
            {state.message}
          </p>
        )}
        <div>
          <label htmlFor={`gd-date-${stage}`} className="block text-sm font-medium">
            Datum van het besluit
          </label>
          <input id={`gd-date-${stage}`} name="decidedOn" type="date" required defaultValue={today} max={today} className="input" />
        </div>
        {stage === "PRESIDIUM" ? (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Leden van het ringpresidium die het besluit hebben genomen</legend>
            {presidiumMembers.map((m) => (
              <label key={m.id} className="flex items-center gap-2">
                <input type="checkbox" name="presentUserIds" value={m.id} /> {m.name}
              </label>
            ))}
            <p className="text-xs text-[var(--text-muted)]">Een secretaris of administrateur legt alleen vast wat het presidium heeft besloten en neemt dit besluit niet zelf.</p>
          </fieldset>
        ) : (
          <>
            <div>
              <label htmlFor="gd-presiding" className="block text-sm font-medium">
                Voorzitter (lid van het ringpresidium)
              </label>
              <select id="gd-presiding" name="presidingUserId" required className="input" defaultValue="">
                <option value="">Kies…</option>
                {presidiumMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Aanwezig</legend>
              {participants.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input type="checkbox" name="presentUserIds" value={m.id} /> {m.name}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Afwezig (geen ondersteuning geregistreerd)</legend>
              {participants.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input type="checkbox" name="absentUserIds" value={m.id} /> {m.name}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <div>
          <label htmlFor={`gd-note-${stage}`} className="block text-sm font-medium">
            Korte toelichting (optioneel)
          </label>
          <input id={`gd-note-${stage}`} name="note" maxLength={500} className="input" />
        </div>
        {hasNegative && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Er is een negatieve reactie</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="resolveNegative" value="yes" /> De negatieve reactie is in de vergadering afgehandeld (de reactie zelf blijft bewaard)
            </label>
            <label htmlFor={`gd-res-${stage}`} className="block text-sm">
              Hoe is dit afgehandeld? (minimaal 10 tekens, geen gevoelige details)
            </label>
            <input id={`gd-res-${stage}`} name="resolutionNote" maxLength={500} className="input" />
          </fieldset>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="agreed" value="yes" required /> Het {label} heeft dit voorstel in de vergadering akkoord bevonden
        </label>
        {stage === "PRESIDIUM" && <p className="text-xs text-[var(--text-muted)]">Na het vastleggen wacht het voorstel op een aparte, expliciete vrijgave aan de hoge raad.</p>}
        <button type="submit" className="btn btn-primary" disabled={pending} aria-disabled={pending}>
          {pending ? "Bezig…" : "Besluit vastleggen"}
        </button>
      </form>
    </details>
  );
}
