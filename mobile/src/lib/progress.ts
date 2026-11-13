import type { CallingDetail } from "@shared/api-types";

/**
 * Tijdlijn "Voortgang" van een voorstel (app én webomgeving): dezelfde acht stappen als de bestaande website, afgeleid van wat de server
 * voor deze gebruiker teruggeeft. Puur en getest; toont nooit meer dan het voorsteldetail zelf al bevat.
 */
export type ProgressStep = { label: string; done: boolean };

export function progressSteps(c: Pick<CallingDetail, "status" | "tasks" | "processedAt">): ProgressStep[] {
  const approved = c.status === "APPROVED" || c.status === "PROCESSED";
  const presidiumDone = c.status !== "PRESIDIUM_VOTING" && c.status !== "PRESIDIUM_PAUSED";
  const released = approved || c.status.startsWith("HOGERAAD");
  const taskDone = (key: string) => !!c.tasks.find((t) => t.task === key)?.doneAt;
  return [
    { label: "Voorstel aangemaakt", done: true },
    { label: "Ringpresidium akkoord", done: presidiumDone },
    { label: "Vrijgegeven aan de hoge raad", done: released },
    { label: "Hoge raad akkoord", done: approved },
    { label: "Geroepen", done: taskDone("ROEPEN") },
    { label: "Ondersteund", done: taskDone("ONDERSTEUNEN") },
    { label: "Aangesteld", done: taskDone("AANSTELLEN") },
    { label: "Verwerkt", done: !!c.processedAt || c.status === "PROCESSED" },
  ];
}

/** Een algemene herinnering is alleen zinvol zolang er een ondersteuningsronde loopt, en alleen voor ringstaf. */
export function canShareReminder(c: Pick<CallingDetail, "status" | "me">): boolean {
  return c.me.isStaff && ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED", "HOGERAAD_VOTING", "HOGERAAD_PAUSED"].includes(c.status);
}

/**
 * Algemeen bericht voor een bestaande groep (bijvoorbeeld WhatsApp). Bevat bewust GEEN naam, roeping, ring of link naar een voorstel:
 * het bericht is voor iedereen in die groep zichtbaar.
 */
export const GENERAL_REMINDER = [
  "Ringtools – ondersteuning gevraagd",
  "",
  "Er staat een voorstel klaar waarvoor jullie ondersteuning wordt gevraagd.",
  "Open Ringtools om je reactie te geven. Je hebt hierover ook een persoonlijke melding ontvangen.",
].join("\n");
