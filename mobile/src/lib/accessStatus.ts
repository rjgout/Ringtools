import type { ManagedUser } from "@shared/api-types";

/**
 * Toegangsstatus van één gebruiker voor de ringbeheerder: is het account geactiveerd, wat is de status van de uitnodiging,
 * wanneer is die verstuurd en wat is de juiste vervolgstap. Alles hier is puur en getest (tests/accessStatus.test.ts).
 * Er worden nooit tokens of codes getoond; opnieuw versturen blijft een serveractie met recente verificatie, verzendlimiet en audit.
 */
export function formatWhen(iso: string, locale = "nl-NL"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const formatDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
};

export type AccessInfo = {
  activated: boolean;
  /** Korte status voor op de rij. */
  badge: string;
  /** Uitleg per regel (uitnodigingsstatus, verzenddatum). */
  lines: string[];
  /** Uitnodiging die opnieuw verstuurd kan worden (alleen bij een niet-geactiveerd account met een openstaande uitnodiging). */
  resendInvitationId: string | null;
  /** Reden waarom opnieuw versturen nu niet kan, of een wachttijd. */
  resendNote: string | null;
  /** Begrijpelijke vervolgstappen als een nieuwe uitnodiging niet de oplossing is. */
  guidance: string[] | null;
};

export function accessInfo(u: Pick<ManagedUser, "activated" | "activatedAt" | "active" | "email" | "invitation">, now = new Date()): AccessInfo {
  const inv = u.invitation ?? null;
  const lines: string[] = [];
  let resendInvitationId: string | null = null;
  let resendNote: string | null = null;
  let guidance: string[] | null = null;

  if (inv) {
    switch (inv.status) {
      case "NIET_VERSTUURD":
        lines.push("Uitnodiging aangemaakt, maar de e-mail is nog niet verstuurd.");
        break;
      case "VERSTUURD":
        lines.push(`Uitnodiging verstuurd op ${formatWhen(inv.sentAt ?? "")}, geldig tot ${formatDay(inv.expiresAt)}.`);
        break;
      case "VERLOPEN":
        lines.push(`Uitnodiging verlopen${inv.sentAt ? ` (verstuurd op ${formatWhen(inv.sentAt)})` : ""}.`);
        break;
      case "INGETROKKEN":
        lines.push("Uitnodiging ingetrokken.");
        break;
      case "GEACTIVEERD":
        lines.push(`Uitnodiging geaccepteerd${u.activatedAt ? ` op ${formatWhen(u.activatedAt)}` : ""}.`);
        break;
    }
  }

  if (u.activated) {
    if (u.activatedAt && !lines.some((l) => l.includes("geaccepteerd"))) lines.unshift(`Account geactiveerd op ${formatWhen(u.activatedAt)}.`);
    guidance = [
      "Opnieuw uitnodigen lost een ontbrekende inlogcode niet op: dit account is al geactiveerd.",
      `Laat de persoon op het inlogscherm van de app een nieuwe inlogcode aanvragen met precies dit e-mailadres: ${u.email}. Controleer op een typefout.`,
      "Kijk ook in de spammap. Er kunnen maximaal 5 codes per 15 minuten worden aangevraagd; wacht daarna even.",
      ...(u.active ? [] : ["Dit account staat op inactief: een inactief account krijgt geen inlogcode. Zet het eerst weer actief."]),
      "Komt er toch niets aan, dan is mogelijk de mailserver gestoord: neem dan contact op met de systeembeheerder.",
    ];
  } else if (inv && (inv.status === "VERSTUURD" || inv.status === "NIET_VERSTUURD" || inv.status === "VERLOPEN") && inv.canResend) {
    resendInvitationId = inv.id;
    if (inv.resendAvailableAt && new Date(inv.resendAvailableAt).getTime() > now.getTime()) {
      resendNote = `Net verstuurd. Opnieuw versturen kan vanaf ${formatWhen(inv.resendAvailableAt)}.`;
    }
  } else if (inv && inv.resendBlockedReason === "LIMIET") {
    resendNote = "De uitnodiging is al het maximale aantal keren verstuurd. Trek hem in en nodig de persoon opnieuw uit.";
  } else if (!inv) {
    guidance = [
      "Dit account heeft nog nooit ingelogd en er is geen uitnodiging gevonden.",
      `De persoon kan op het inlogscherm van de app zelf een inlogcode aanvragen met dit e-mailadres: ${u.email}.`,
    ];
  } else if (inv.status === "INGETROKKEN") {
    guidance = ["De uitnodiging is ingetrokken. Maak zo nodig een nieuwe uitnodiging aan, of laat de persoon een inlogcode aanvragen als het account al bestaat."];
  }

  return {
    activated: u.activated,
    badge: u.activated ? "Geactiveerd" : "Nog niet geactiveerd",
    lines,
    resendInvitationId,
    resendNote,
    guidance,
  };
}
