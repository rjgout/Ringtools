import { castVoteAction, reinviteAction, remindAction, removeParticipantAction } from "@/lib/actions/calling.actions";
import { formatDateTime } from "@/lib/format";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";

export type SupportParticipant = {
  userId: string;
  name: string;
  /** true = ondersteunt, false = ondersteunt niet, null = nog niet gereageerd */
  support: boolean | null;
  lastInvitedAt: Date | null;
  /** Is deze persoon nog actief lid van de ring met de rol van deze groep? */
  stillInvolved: boolean;
};

/**
 * Ondersteuningsronde van één groep (ringpresidium of hoge raad). Het
 * ringpresidium (staf) ziet wie wel/niet/nog niet heeft gereageerd en kan
 * herinneringen sturen; een deelnemer ziet alleen de eigen status.
 */
export function SupportSection({
  title,
  callingId,
  participants,
  isStaff,
  currentUserId,
  canCurrentUserRespond,
  paused,
}: {
  title: string;
  callingId: string;
  participants: SupportParticipant[];
  isStaff: boolean;
  currentUserId: string;
  canCurrentUserRespond: boolean;
  paused: boolean;
}) {
  if (participants.length === 0) return null;

  const mine = participants.find((p) => p.userId === currentUserId);
  const myResponse = mine?.support ?? null;
  const supports = participants.filter((p) => p.support === true).length;
  const declines = participants.filter((p) => p.support === false).length;
  const waiting = participants.filter((p) => p.support === null);
  const remindable = waiting.filter((p) => p.stillInvolved);

  return (
    <section className="glass-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {isStaff && (
          <span className="text-xs text-[var(--text-muted)]">
            {supports} ondersteunt · {declines} ondersteunt niet · {waiting.length} nog niet gereageerd
          </span>
        )}
      </div>

      {isStaff ? (
        <>
          <ul className="space-y-3">
            {participants.map((p) => (
              <li key={p.userId} className="space-y-1.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.support === null ? (
                    <span className="badge badge-pending">Nog niet gereageerd</span>
                  ) : (
                    <span className={`badge ${p.support ? "badge-success" : "badge-danger"}`}>
                      {p.support ? "✓ Ondersteunt" : "✗ Ondersteunt niet"}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-[var(--text-muted)]">
                    Laatst uitgenodigd: {p.lastInvitedAt ? formatDateTime(p.lastInvitedAt) : "–"}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {p.support === null && p.stillInvolved && (
                      <form action={remindAction}>
                        <input type="hidden" name="callingId" value={callingId} />
                        <input type="hidden" name="userId" value={p.userId} />
                        <button type="submit" className="btn-ghost !min-h-[32px] !px-3 text-xs">
                          Herinnering versturen
                        </button>
                      </form>
                    )}
                    {p.support === false && paused && p.stillInvolved && (
                      <form action={reinviteAction}>
                        <input type="hidden" name="callingId" value={callingId} />
                        <input type="hidden" name="userId" value={p.userId} />
                        <button type="submit" className="btn-ghost !min-h-[32px] !px-3 text-xs">
                          Opnieuw ondersteuning vragen
                        </button>
                      </form>
                    )}
                  </span>
                </div>
                {!p.stillInvolved && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/5 p-2 dark:bg-white/5">
                    <span className="text-xs text-[var(--text-muted)]">
                      Deze persoon is niet meer actief betrokken (gedeactiveerd of andere rol). De ronde wacht tot dit expliciet
                      is afgehandeld.
                    </span>
                    <form action={removeParticipantAction}>
                      <input type="hidden" name="callingId" value={callingId} />
                      <input type="hidden" name="userId" value={p.userId} />
                      <ConfirmSubmitButton
                        className="btn-ghost !min-h-[32px] !px-3 text-xs"
                        message="Deze persoon uit de ondersteuningsronde verwijderen? Eventuele eerdere reactie van deze persoon vervalt. Als alle overige personen al ondersteunen, gaat het voorstel hierna direct door naar de volgende stap."
                      >
                        Uit ronde verwijderen
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {remindable.length > 0 && (
            <form action={remindAction}>
              <input type="hidden" name="callingId" value={callingId} />
              <button type="submit" className="btn-ghost w-full text-sm">
                Iedereen herinneren ({remindable.length})
              </button>
            </form>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          {myResponse === null
            ? "Je bent gevraagd je ondersteuning uit te brengen voor dit voorstel."
            : myResponse
              ? "Je hebt dit voorstel ondersteund."
              : "Je hebt aangegeven dit voorstel niet te ondersteunen."}
        </p>
      )}

      {canCurrentUserRespond && myResponse === null && (
        <form action={castVoteAction} className="flex gap-3">
          <input type="hidden" name="callingId" value={callingId} />
          <button type="submit" name="support" value="true" className="btn-success">
            👍 Ondersteunen
          </button>
          <button type="submit" name="support" value="false" className="btn-danger">
            👎 Niet ondersteunen
          </button>
        </form>
      )}

      {canCurrentUserRespond && myResponse !== null && (
        <form action={castVoteAction} className="flex gap-3">
          <input type="hidden" name="callingId" value={callingId} />
          <p className="flex-1 self-center text-xs text-[var(--text-muted)]">
            Je kunt je reactie nog wijzigen zolang de ondersteuningsronde openstaat.
          </p>
          <button
            type="submit"
            name="support"
            value={myResponse ? "false" : "true"}
            className={myResponse ? "btn-danger !flex-none" : "btn-success !flex-none"}
          >
            {myResponse ? "Wijzig naar niet ondersteunen" : "Wijzig naar ondersteunen"}
          </button>
        </form>
      )}
    </section>
  );
}
