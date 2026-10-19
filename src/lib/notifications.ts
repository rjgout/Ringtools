import type { NotificationType, User } from "@prisma/client";
import { prisma } from "./prisma";
import { sendMail } from "./mailer";
import { sendPushToUsers } from "./push";

export type NotificationEvent = NotificationType;

/**
 * Generieke, niet-vertrouwelijke tekst per workflow-gebeurtenis. Wordt
 * gebruikt voor zowel het interne notificatiecentrum als pushmeldingen.
 * Bevat bewust NOOIT namen, functies, ondersteuningsresultaten of andere
 * persoonsgegevens: beide kunnen zichtbaar zijn op een vergrendeld scherm of
 * in een overzicht waar dat niet gewenst is. De e-mail (apart per aanroeper
 * opgebouwd via `buildEmail`) mag wél gedetailleerde inhoud bevatten, omdat
 * die alleen in de persoonlijke inbox van de ontvanger belandt.
 */
const TEMPLATES: Record<NotificationEvent, { title: string; message: string }> = {
  NEW_PROPOSAL: {
    title: "Nieuw voorstel",
    message: "Er staat een nieuw voorstel klaar waarvoor jouw ondersteuning wordt gevraagd.",
  },
  ADVANCED_TO_HOGERAAD: {
    title: "Voorstel naar hoge raad",
    message: "Er staat een voorstel klaar waarvoor jouw ondersteuning wordt gevraagd.",
  },
  REINVITE: {
    title: "Opnieuw ondersteuning gevraagd",
    message: "Je wordt opnieuw gevraagd om je ondersteuning kenbaar te maken.",
  },
  PAUSED: {
    title: "Voorstel gepauzeerd",
    message: "Een voorstel is gepauzeerd en vraagt aandacht.",
  },
  TASK_ASSIGNED: {
    title: "Nieuwe taak toegewezen",
    message: "Er is een taak aan je toegewezen.",
  },
  TASK_COMPLETED: {
    title: "Taak afgerond",
    message: "Een toegewezen taak is afgerond.",
  },
  SUPPORT_REMINDER: {
    title: "Herinnering ondersteuningsverzoek",
    message: "Er staat nog een ondersteuningsverzoek voor je open.",
  },
  REMINDER_30_DAYS: {
    title: "Nog te verwerken",
    message: "Een roeping staat al 30 dagen open en is nog niet verwerkt.",
  },
};

export type EmailBuilder = (user: User) => { subject: string; text: string } | Promise<{ subject: string; text: string }>;

/**
 * Centraal notificatieproces: voor elke (actieve) ontvanger wordt
 * 1) altijd een interne melding opgeslagen (ongeacht push-/e-mailvoorkeur),
 * 2) een generieke pushmelding verstuurd (als de ontvanger apparaten heeft),
 * 3) optioneel een gedetailleerde e-mail verstuurd (alleen als de ontvanger
 *    e-mailmeldingen aan heeft staan en de aanroeper een `buildEmail` meegeeft).
 *
 * Eén aanroep hiervan dekt dus altijd alle drie de kanalen tegelijk, zodat er
 * geen apart, onafhankelijk notificatiesysteem nodig is. Een mislukte
 * pushmelding of e-mail heeft geen invloed op de al opgeslagen interne
 * melding (die wordt altijd eerst, apart, vastgelegd).
 */
export async function notify(params: {
  userIds: string[];
  /** De ring waartoe deze melding behoort; ontvangers moeten er actief lid van zijn. */
  ringId: string;
  event: NotificationEvent;
  url: string;
  callingId?: string;
  buildEmail?: EmailBuilder;
}): Promise<void> {
  const { userIds, ringId, event, url, callingId, buildEmail } = params;
  if (userIds.length === 0) return;

  // Nooit naar gedeactiveerde gebruikers (ook niet intern) en nooit naar
  // personen die geen actief lid van deze ring (meer) zijn: meldingen van
  // verschillende ringen mogen nooit door elkaar lopen.
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, active: true, memberships: { some: { ringId, active: true } } },
  });
  if (users.length === 0) return;

  const template = TEMPLATES[event];

  // 1) Altijd intern opslaan, ongeacht push-/e-mailvoorkeuren.
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      ringId,
      type: event,
      title: template.title,
      message: template.message,
      targetUrl: url,
      callingId: callingId ?? null,
    })),
  });

  // 2) Pushmelding (sendPushToUsers stuurt vanzelf alleen naar wie
  // geregistreerde apparaten heeft, en ruimt verlopen abonnementen op).
  await sendPushToUsers(
    users.map((u) => u.id),
    { title: template.title, body: template.message, url, tag: event }
  );

  // 3) E-mail, alleen als de aanroeper gedetailleerde inhoud aanlevert én de
  // ontvanger e-mailmeldingen voor de workflow aan heeft staan.
  if (buildEmail) {
    for (const user of users) {
      if (!user.emailNotificationsEnabled) continue;
      try {
        const { subject, text } = await buildEmail(user);
        await sendMail({ to: user.email, subject, text });
      } catch (err) {
        console.error(`[notify] E-mail versturen naar ${user.email} mislukt (gebeurtenis ${event}):`, err);
      }
    }
  }
}
