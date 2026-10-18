import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { isStaff, canVotePresidium, canVoteHogeraad } from "@/lib/rbac";
import { getCallingDetail, listActiveUsers } from "@/lib/queries";
import { isReadyToProcess, phaseLabel } from "@/lib/status";
import { formatDate, formatDateTime } from "@/lib/format";
import { Timeline } from "@/components/Timeline";
import { VotingSection } from "@/components/VotingSection";
import { TaskRow } from "@/components/TaskRow";
import { WhatsAppShareButton } from "@/components/WhatsAppShareButton";
import { markProcessedAction } from "@/lib/actions/calling.actions";

export default async function CallingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  if (user.role === "ADMIN") redirect("/geen-toegang");

  const calling = await getCallingDetail(id);
  if (!calling) notFound();

  const staff = isStaff(user.role);

  const presidiumEligible = calling.eligibleVoters.filter((e) => e.stage === "PRESIDIUM");
  const presidiumVotes = calling.votes.filter((v) => v.stage === "PRESIDIUM");
  const hogeraadEligible = calling.eligibleVoters.filter((e) => e.stage === "HOGERAAD");
  const hogeraadVotes = calling.votes.filter((v) => v.stage === "HOGERAAD");

  const isHogeraadVoter = hogeraadEligible.some((e) => e.userId === user.id);
  const isPresidiumVoter = presidiumEligible.some((e) => e.userId === user.id);
  const isTaskAssignee =
    calling.roepenAssigneeId === user.id || calling.ondersteunenAssigneeId === user.id || calling.aanstellenAssigneeId === user.id;

  if (!staff && !isHogeraadVoter && !isPresidiumVoter && !isTaskAssignee) {
    redirect("/geen-toegang");
  }

  const users = staff ? await listActiveUsers() : [];
  const showWhatsApp = staff && (calling.status === "PRESIDIUM_VOTING" || calling.status === "PRESIDIUM_PAUSED" || calling.status === "HOGERAAD_VOTING" || calling.status === "HOGERAAD_PAUSED");

  return (
    <div className="space-y-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{calling.personName}</h1>
          <p className="text-[var(--text-muted)]">{calling.functionTitle}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Aangemaakt op {formatDate(calling.createdAt)} door {calling.createdBy.name}
          </p>
        </div>
        <span className="badge badge-neutral">{phaseLabel(calling)}</span>
      </div>

      {showWhatsApp && (
        <div className="glass-card">
          <p className="mb-2 text-sm text-[var(--text-muted)]">
            Deel een algemene herinnering in de WhatsApp-groep (zonder naam of persoonlijke link).
          </p>
          <WhatsAppShareButton />
        </div>
      )}

      <section className="glass-card">
        <h2 className="mb-2 font-semibold">Voortgang</h2>
        <Timeline calling={calling} />
      </section>

      {/*
        "Staff" (ringpresidium/secretaris/administrateur) ziet altijd de volledige
        uitslag. Of iemand ZELF ook mag stemmen is daarvan onafhankelijk: een
        ringpresidiumlid is zowel staff als stemgerechtigd, een secretaris/
        administrateur is staff maar stemt nooit mee, en een hogeraadslid is
        geen staff maar stemt wel (met alleen de eigen status, niet de hele
        uitslag van anderen).
      */}
      {(staff || isPresidiumVoter) && (
        <VotingSection
          title="Stemming ringpresidium"
          callingId={calling.id}
          eligible={presidiumEligible}
          votes={presidiumVotes}
          isStaff={staff}
          currentUserId={user.id}
          canCurrentUserVote={
            canVotePresidium(user.role) && (calling.status === "PRESIDIUM_VOTING" || calling.status === "PRESIDIUM_PAUSED")
          }
          paused={calling.status === "PRESIDIUM_PAUSED"}
        />
      )}

      {(hogeraadEligible.length > 0 && staff) || isHogeraadVoter ? (
        <VotingSection
          title="Stemming hoge raad"
          callingId={calling.id}
          eligible={hogeraadEligible}
          votes={hogeraadVotes}
          isStaff={staff}
          currentUserId={user.id}
          canCurrentUserVote={
            canVoteHogeraad(user.role) && (calling.status === "HOGERAAD_VOTING" || calling.status === "HOGERAAD_PAUSED")
          }
          paused={calling.status === "HOGERAAD_PAUSED"}
        />
      ) : null}

      {(staff || isTaskAssignee) && (
        <section className="space-y-3">
          <h2 className="font-semibold">Uitvoering</h2>
          <TaskRow
            callingId={calling.id}
            task="ROEPEN"
            label="Roepen"
            assignee={calling.roepenAssignee}
            doneBy={calling.roepenDoneBy}
            doneAt={calling.roepenDoneAt}
            canApproved={calling.status === "APPROVED"}
            canAssign={staff}
            canComplete={staff || calling.roepenAssigneeId === user.id}
            users={users}
          />
          <TaskRow
            callingId={calling.id}
            task="ONDERSTEUNEN"
            label="Ondersteunen"
            assignee={calling.ondersteunenAssignee}
            doneBy={calling.ondersteunenDoneBy}
            doneAt={calling.ondersteunenDoneAt}
            ondersteunenContext={calling.ondersteunenContext}
            canApproved={calling.status === "APPROVED"}
            canAssign={staff}
            canComplete={staff || calling.ondersteunenAssigneeId === user.id}
            users={users}
          />
          <TaskRow
            callingId={calling.id}
            task="AANSTELLEN"
            label="Aanstellen"
            assignee={calling.aanstellenAssignee}
            doneBy={calling.aanstellenDoneBy}
            doneAt={calling.aanstellenDoneAt}
            canApproved={calling.status === "APPROVED"}
            canAssign={staff}
            canComplete={staff || calling.aanstellenAssigneeId === user.id}
            users={users}
          />
        </section>
      )}

      {staff && isReadyToProcess(calling) && (
        <form action={markProcessedAction} className="glass-card">
          <input type="hidden" name="callingId" value={calling.id} />
          <p className="mb-3 text-sm text-[var(--text-muted)]">
            Alle stappen zijn afgerond. Na verwerken verdwijnt deze roeping uit de actieve werklijsten en wordt hij na 30 dagen
            automatisch verwijderd.
          </p>
          <button type="submit" className="btn-primary w-full">
            Markeren als verwerkt
          </button>
        </form>
      )}

      {calling.processedAt && (
        <p className="text-xs text-[var(--text-muted)]">
          Verwerkt op {formatDateTime(calling.processedAt)} door {calling.processedBy?.name ?? "onbekend"}.
        </p>
      )}
    </div>
  );
}
