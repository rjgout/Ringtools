import type { EligibleVoter, User, Vote } from "@prisma/client";
import { castVoteAction, reinviteAction } from "@/lib/actions/calling.actions";

type EligibleWithUser = EligibleVoter & { user: User };
type VoteWithUser = Vote & { user: User };

export function VotingSection({
  title,
  callingId,
  eligible,
  votes,
  isStaff,
  currentUserId,
  canCurrentUserVote,
  paused,
}: {
  title: string;
  callingId: string;
  eligible: EligibleWithUser[];
  votes: VoteWithUser[];
  isStaff: boolean;
  currentUserId: string;
  canCurrentUserVote: boolean;
  paused: boolean;
}) {
  if (eligible.length === 0) return null;

  const voteByUserId = new Map(votes.map((v) => [v.userId, v]));
  const myVote = voteByUserId.get(currentUserId);

  return (
    <section className="glass-card space-y-4">
      <h2 className="font-semibold">{title}</h2>

      {isStaff ? (
        <ul className="space-y-2">
          {eligible.map((e) => {
            const vote = voteByUserId.get(e.userId);
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{e.user.name}</span>
                {vote ? (
                  <span className={`badge ${vote.support ? "badge-success" : "badge-danger"}`}>
                    {vote.support ? "✓ Ondersteunt" : "✗ Ondersteunt niet"}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="badge badge-pending">Nog niet gestemd</span>
                  </span>
                )}
                {vote && !vote.support && paused && (
                  <form action={reinviteAction}>
                    <input type="hidden" name="callingId" value={callingId} />
                    <input type="hidden" name="userId" value={e.userId} />
                    <button type="submit" className="btn-ghost !min-h-[32px] !px-3 text-xs">
                      Opnieuw uitnodigen
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          {myVote
            ? myVote.support
              ? "Je hebt dit voorstel ondersteund."
              : "Je hebt aangegeven dit voorstel niet te ondersteunen."
            : "Je bent gevraagd te stemmen over dit voorstel."}
        </p>
      )}

      {canCurrentUserVote && !myVote && (
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

      {canCurrentUserVote && myVote && (
        <form action={castVoteAction} className="flex gap-3">
          <input type="hidden" name="callingId" value={callingId} />
          <p className="flex-1 self-center text-xs text-[var(--text-muted)]">Je kunt je stem nog wijzigen zolang dit openstaat.</p>
          <button
            type="submit"
            name="support"
            value={myVote.support ? "false" : "true"}
            className={myVote.support ? "btn-danger !flex-none" : "btn-success !flex-none"}
          >
            {myVote.support ? "Wijzig naar niet ondersteunen" : "Wijzig naar ondersteunen"}
          </button>
        </form>
      )}
    </section>
  );
}
