import cron from "node-cron";
import { env } from "./env";
import { sendDue30DayReminders, deleteDueProcessedCallings } from "./workflow";
import { deleteExpiredAuthData } from "./auth";
import { deleteExpiredOpenLinks } from "./openLinks";

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

  // Ook één keer kort na opstarten uitvoeren, zodat een roeping niet wacht
  // tot de volgende nacht als de container net is herstart.
  runOnce().catch((err) => console.error("[cron] Onverwachte fout bij opstarten:", err));
}

async function runOnce(): Promise<void> {
  const reminders = await sendDue30DayReminders();
  if (reminders > 0) console.log(`[cron] ${reminders} herinnering(en) verstuurd.`);

  const expired = await deleteExpiredAuthData();
  const links = await deleteExpiredOpenLinks();
  if (expired.sessions + expired.magicLinks + links > 0) {
    console.log(`[cron] Opgeruimd: ${expired.sessions} sessie(s), ${expired.magicLinks} inloglink(s), ${links} koppeling(en).`);
  }

  const deleted = await deleteDueProcessedCallings();
  if (deleted > 0) console.log(`[cron] ${deleted} verwerkte roeping(en) na 30 dagen verwijderd.`);
}
