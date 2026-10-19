import type { Calling } from "@prisma/client";

export type TaskKey = "ROEPEN" | "ONDERSTEUNEN" | "AANSTELLEN";

export const TASK_ASSIGNEE_FIELD: Record<TaskKey, "roepenAssigneeId" | "ondersteunenAssigneeId" | "aanstellenAssigneeId"> = {
  ROEPEN: "roepenAssigneeId",
  ONDERSTEUNEN: "ondersteunenAssigneeId",
  AANSTELLEN: "aanstellenAssigneeId",
};

export function allTasksDone(calling: Calling): boolean {
  return !!(calling.roepenDoneAt && calling.ondersteunenDoneAt && calling.aanstellenDoneAt);
}

export function isReadyToProcess(calling: Calling): boolean {
  return calling.status === "APPROVED" && allTasksDone(calling) && !calling.processedAt;
}

/** Nederlandse weergavenaam voor de huidige procesfase, gebruikt in UI en e-mails. */
export function phaseLabel(calling: Calling): string {
  switch (calling.status) {
    case "PRESIDIUM_VOTING":
      return "Ondersteuningsronde ringpresidium";
    case "PRESIDIUM_PAUSED":
      return "Gepauzeerd – ringpresidium ondersteunt niet";
    case "HOGERAAD_VOTING":
      return "Ondersteuningsronde hoge raad";
    case "HOGERAAD_PAUSED":
      return "Gepauzeerd – hoge raad ondersteunt niet";
    case "APPROVED":
      if (calling.processedAt) return "Verwerkt";
      if (isReadyToProcess(calling)) return "Te verwerken";
      return "Goedgekeurd – uitvoering";
    case "PROCESSED":
      return "Verwerkt";
    default:
      return calling.status;
  }
}
