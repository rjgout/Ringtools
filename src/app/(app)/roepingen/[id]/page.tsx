import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getActiveMembership, getRingContext } from "@/lib/ringContext";
import { isStaff, canVotePresidium, canVoteHogeraad } from "@/lib/rbac";
import { getCallingDetail, listActiveUsers, getRoleByUserId, getStillInvolvedUserIds } from "@/lib/queries";
import { isReadyToProcess, phaseLabel } from "@/lib/status";
import { formatDate, formatDateTime } from "@/lib/format";
import { Timeline } from "@/components/Timeline";
import { SupportSection, type SupportParticipant } from "@/components/SupportSection";
import { TaskRow } from "@/components/TaskRow";
import { WhatsAppShareButton } from "@/components/WhatsAppShareButton";
import { RingSync } from "@/components/RingSync";
import { DeleteCallingButton } from "@/components/DeleteCallingButton";
import { markProcessedAction } from "@/lib/actions/calling.actions";

const MELDINGEN: Record<string, (q: Record<string, string | undefined>) => string> = {
  herinnering: (q) => {
    const sent = Number(q.verstuurd ?? 0);
    const skipped = Number(q.overgeslagen ?? 0);
    if (sent === 0 && skipped > 0) return "Er is minder dan een uur geleden al een uitnodiging of herinnering verstuurd; probeer het later opnieuw.";
    if (sent === 0) return "Er was niemand om te herinneren.";
    const base = `Herinnering verstuurd naar ${sent} ${sent === 1 ? "persoon" : "personen"}.`;
    return skipped > 0 ? `${base} ${skipped} ${skipped === 1 ? "persoon is" : "personen zijn"} overgeslagen (minder dan een uur geleden uitgenodigd of herinnerd).` : base;
  },
  "opnieuw-gevraagd": () => "Er is opnieuw om ondersteuning gevraagd.",
  "deelnemer-verwijderd": () => "De deelnemer is uit de ondersteuningsronde verwijderd.",
  "niet-verwijderd": () => "Het voorstel kon niet worden verwijderd.",
};

export default async function CallingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;

  if (user.role === "ADMIN") redirect("/geen-toegang");

  const calling = await getCallingDetail(id);
  if (!calling) notFound();

  // Tenantisolatie: autorisatie per voorstel, op basis van het (actieve)
  // lidmaatschap in de ring van DIT voorstel — niet van de gekozen ring. Wie
  // geen lid is, krijgt hetzelfde resultaat als bij een onbekend voorstel.
  const membership = await getActiveMembership(user.id, calling.ringId);
  if (!membership) notFound();

  const activeRing = await getRingContext();
  const staff = isStaff(membership.role);

  const presidiumEligible = calling.eligibleVoters.filter((e) => e.stage === "PRESIDIUM");
  const presidiumVotes = calling.votes.filter((v) => v.stage === "PRESIDIUM");
  const hogeraadEligible = calling.eligibleVoters.filter((e) => e.stage === "HOGERAAD");
  const hogeraadVotes = calling.votes.filter((v) => v.stage === "HOGERAAD");

  const isHogeraadParticipant = hogeraadEligible.some((e) => e.userId === user.id);
  const isPresidiumParticipant = presidiumEligible.some((e) => e.userId === user.id);
  const isTaskAssignee =
    calling.roepenAssigneeId === user.id || calling.ondersteunenAssigneeId === user.id || calling.aanstellenAssigneeId === user.id;

  if (!staff && !isHogeraadParticipant && !isPresidiumParticipant && !isTaskAssignee) {
    redirect("/geen-toegang");
  }

  const [users, roleByUserId, presidiumInvolved, hogeraadInvolved] = await Promise.all([
    staff ? listActiveUsers(calling.ringId) : Promise.resolve([]),
    getRoleByUserId(calling.ringId),
    getStillInvolvedUserIds(calling.ringId, "PRESIDIUM"),
    getStillInvolvedUserIds(calling.ringId, "HOGERAAD"),
  ]);

  function participantsOf(
    eligible: typeof presidiumEligible,
    votes: typeof presidiumVotes,
    involved: Set<string>
  ): SupportParticipant[] {
    const byUser = new Map(votes.map((v) => [v.userId, v]));
    return eligible.map((e) => ({
      userId: e.userId,
      name: e.user.name,
      support: byUser.get(e.userId)?.support ?? null,
      lastInvitedAt: e.lastInvitedAt,
      stillInvolved: involved.has(e.userId),
    }));
  }

  const showWhatsApp =
    staff &&
    (calling.status === "PRESIDIUM_VOTING" ||
      calling.status === "PRESIDIUM_PAUSED" ||
      calling.status === "HOGERAAD_VOTING" ||
      calling.status === "HOGERAAD_PAUSED");

  const meldingText = query.melding && MELDINGEN[query.melding] ? MELDINGEN[query.melding](query) : null;

  return (
    <div className="space-y-5 py-4">
      <RingSync ringId={calling.ringId} activeRingId={activeRing?.ring.id ?? null} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{calling.personName}</h1>
          <p className="text-[var(--text-muted)]">{calling.functionTitle}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {calling.ring.name} · Aangemaakt op {formatDate(calling.createdAt)} door {calling.createdBy.name}
          </p>
        </div>
        <span className="badge badge-neutral">{phaseLabel(calling)}</span>
      </div>

      {meldingText && (
        <p role="status" className="glass-panel text-sm">
          {meldingText}
        </p>
      )}

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
        "Staf" (ringpresidium/secretaris/administrateur) ziet altijd de volledige
        ondersteuningsresultaten. Of iemand ZELF ook ondersteuning uitbrengt is
        daarvan onafhankelijk: een ringpresidiumlid is zowel staf als deelnemer,
        een secretaris/administrateur is staf maar neemt nooit deel, en een
        hogeraadslid is geen staf maar brengt wel ondersteuning uit (met alleen
        de eigen status, niet de resultaten van anderen).
      */}
      {(staff || isPresidiumParticipant) && (
        <SupportSection
          title="Ondersteuningsronde ringpresidium"
          callingId={calling.id}
          participants={participantsOf(presidiumEligible, presidiumVotes, presidiumInvolved)}
          isStaff={staff}
          currentUserId={user.id}
          canCurrentUserRespond={
            canVotePresidium(membership.role) && (calling.status === "PRESIDIUM_VOTING" || calling.status === "PRESIDIUM_PAUSED")
          }
          paused={calling.status === "PRESIDIUM_PAUSED"}
        />
      )}

      {(hogeraadEligible.length > 0 && staff) || isHogeraadParticipant ? (
        <SupportSection
          title="Ondersteuningsronde hoge raad"
          callingId={calling.id}
          participants={participantsOf(hogeraadEligible, hogeraadVotes, hogeraadInvolved)}
          isStaff={staff}
          currentUserId={user.id}
          canCurrentUserRespond={
            canVoteHogeraad(membership.role) && (calling.status === "HOGERAAD_VOTING" || calling.status === "HOGERAAD_PAUSED")
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
            assigneeRole={calling.roepenAssigneeId ? roleByUserId.get(calling.roepenAssigneeId) : null}
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
            assigneeRole={calling.ondersteunenAssigneeId ? roleByUserId.get(calling.ondersteunenAssigneeId) : null}
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
            assigneeRole={calling.aanstellenAssigneeId ? roleByUserId.get(calling.aanstellenAssigneeId) : null}
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

      {staff && calling.status !== "PROCESSED" && !calling.processedAt && (
        <section className="glass-card space-y-3">
          <h2 className="font-semibold">Voorstel verwijderen</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Bijvoorbeeld voor een per ongeluk aangemaakt of dubbel voorstel. Dit verwijdert het voorstel definitief, inclusief alle
            ondersteuningsreacties, taken en meldingen.
          </p>
          <div className="flex">
            <DeleteCallingButton callingId={calling.id} />
          </div>
        </section>
      )}
    </div>
  );
}
