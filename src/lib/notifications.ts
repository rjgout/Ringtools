import { sendPushToUsers } from "./push";

/**
 * Generieke, niet-vertrouwelijke pushmeldingen per workflow-gebeurtenis.
 * Bevat bewust NOOIT namen, functies, stemresultaten of andere
 * persoonsgegevens: pushmeldingen kunnen zichtbaar zijn op een vergrendeld
 * scherm waar anderen ze kunnen lezen.
 */
export type PushEvent =
  | "NEW_PROPOSAL"
  | "ADVANCED_TO_HOGERAAD"
  | "REINVITE"
  | "PAUSED"
  | "TASK_ASSIGNED"
  | "TASK_COMPLETED"
  | "REMINDER_30_DAYS";

const PUSH_TEMPLATES: Record<PushEvent, { title: string; body: string }> = {
  NEW_PROPOSAL: {
    title: "Ringtools",
    body: "Er staat een nieuw voorstel klaar waarvoor jouw stem wordt gevraagd.",
  },
  ADVANCED_TO_HOGERAAD: {
    title: "Ringtools",
    body: "Er staat een voorstel klaar waarvoor jouw stem wordt gevraagd.",
  },
  REINVITE: {
    title: "Ringtools",
    body: "Je wordt opnieuw gevraagd om je stem kenbaar te maken.",
  },
  PAUSED: {
    title: "Ringtools",
    body: "Een voorstel is gepauzeerd en vraagt aandacht.",
  },
  TASK_ASSIGNED: {
    title: "Ringtools",
    body: "Er is een taak aan je toegewezen.",
  },
  TASK_COMPLETED: {
    title: "Ringtools",
    body: "Een toegewezen taak is afgerond.",
  },
  REMINDER_30_DAYS: {
    title: "Ringtools",
    body: "Een roeping staat al 30 dagen open en is nog niet verwerkt.",
  },
};

/**
 * Stuurt een generieke pushmelding naar een groep gebruikers. Faalt nooit
 * zichtbaar naar de aanroeper (sendPushToUsers vangt alle fouten per
 * gebruiker af) en blokkeert dus nooit de rest van de workflow.
 */
export async function pushNotify(userIds: string[], event: PushEvent, url = "/dashboard"): Promise<void> {
  if (userIds.length === 0) return;
  const template = PUSH_TEMPLATES[event];
  await sendPushToUsers(userIds, { ...template, url, tag: event });
}
