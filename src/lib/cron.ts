import { cleanupDeletionData } from "./accountDeletion";
import cron from "node-cron";
import { env } from "./env";
import { sendDue30DayReminders, deleteDueProcessedCallings, retryPendingCreationNotifications, retryPendingReleaseNotifications } from "./workflow";
import { deleteExpiredAuthData } from "./auth";
import { deleteExpiredOpenLinks } from "./openLinks";
import { deleteStaleDrafts } from "./proposals";
import { deleteOldInvitations } from "./invitations";
import { deleteDueOntheffingen, remindStaleOntheffingen, retryPendingOntheffingNotifications } from "./ontheffingen";

let started = false;

/**
 * Start de achtergrondtaken. Beide taken lezen hun werk telkens opnieuw uit
 * de database (reminder30SentAt / processedAt), dus een herstart van de
 * container verliest geen voortgang en veroorzaakt geen dubbele e-mails.
 *
 * Dit draait in-process in dezelfde container als de webapp. Dat is bewust:
 * de applicatie draait als één replica op de NAS, dus een losse
 * workerservice zou alleen complexiteit toevoegen zonder voordeel.
 */
export function startBackgroundJobs(): void {
  if (started) return;
  started = true;

  const options = { timezone: env.timezone };

  // Elke nacht om 03:00 Europe/Amsterdam: herinneringen en opruiming.
  cron.schedule(
    "0 3 * * *",
    () => {
      runOnce().catch((err) => console.error("[cron] Onverwachte fout in achtergrondtaak:", err));
    },
    options
  );

  // Elke 10 minuten: aanmaakmeldingen die nooit (volledig) zijn afgeleverd alsnog afmaken (herstel na crash of tijdelijke storing).
  cron.schedule(
    "*/10 * * * *",
    () => {
      retryPendingCreationNotifications().catch((err) => console.error("[cron] Herhalen van aanmaakmeldingen mislukt:", err));
      retryPendingReleaseNotifications().catch((err) => console.error("[cron] Herhalen van meldingen 'wacht op vrijgave' mislukt:", err));
      retryPendingOntheffingNotifications().catch((err) => console.error("[cron] Herhalen van meldingen mislukt:", err));
    },
    options
  );

  // Ook één keer kort na opstarten uitvoeren, zodat een roeping niet wacht
  // tot de volgende nacht als de container net is herstart.
  runOnce().catch((err) => console.error("[cron] Onverwachte fout bij opstarten:", err));
}

async function runOnce(): Promise<void> {
  const reminders = await sendDue30DayReminders();
  if (reminders > 0) console.log(`[cron] ${reminders} herinnering(en) verstuurd.`);

  const expired = await deleteExpiredAuthData();
  const links = await deleteExpiredOpenLinks();
  if (expired.sessions + expired.magicLinks + expired.challenges + links > 0) {
    console.log(`[cron] Opgeruimd: ${expired.sessions} sessie(s), ${expired.magicLinks} inloglink(s), ${expired.challenges} passkey-challenge(s), ${links} koppeling(en).`);
  }

  const drafts = await deleteStaleDrafts();
  if (drafts > 0) console.log(`[cron] ${drafts} verlaten of ingediend concept(en) opgeruimd.`);

  const retried = await retryPendingCreationNotifications();
  if (retried > 0) console.log(`[cron] ${retried} aanmaakmelding(en) alsnog afgeleverd.`);

  const stale = await remindStaleOntheffingen();
  if (stale.reminded + stale.flagged > 0) console.log(`[cron] Ontheffingen: ${stale.reminded} herinnering(en), ${stale.flagged} gemarkeerd voor beoordeling.`);

  const ontheffingen = await deleteDueOntheffingen();
  if (ontheffingen > 0) console.log(`[cron] ${ontheffingen} ontheffingsdossier(s) volgens de bewaarregels verwijderd.`);

  const invitations = await deleteOldInvitations();
  if (invitations > 0) console.log(`[cron] ${invitations} oude uitnodiging(en) opgeruimd.`);

  const deleted = await deleteDueProcessedCallings();
  if (deleted > 0) console.log(`[cron] ${deleted} verwerkte roeping(en) na 30 dagen verwijderd.`);
  await cleanupDeletionData();
}
