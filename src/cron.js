const cron = require('node-cron');
const mailer = require('./mailer');
const { listCallingsOlderThan, listRingpresidiumEmails, deleteCalling } = require('./models');

const DAYS_BEFORE_CLEANUP = 30;

function summarizeCalling(calling) {
  const lines = calling.votes.map(
    (v) => `- ${v.memberName}: ${v.support ? 'steunt' : 'steunt niet'}`
  );
  return [
    `Roeping: ${calling.name} (${calling.functie})`,
    `Volledig gesteund/beoordeeld op: ${new Date(calling.completedAt).toLocaleDateString('nl-NL')}`,
    '',
    'Reacties van de hogeraad:',
    ...lines,
    '',
    `Deze roeping is ${DAYS_BEFORE_CLEANUP} dagen geleden afgerond en is nog niet als "verwerkt" gemarkeerd.`,
    'De roeping is daarom nu automatisch uit het systeem verwijderd. Neem contact op met elkaar als dit niet de bedoeling was.',
  ].join('\n');
}

async function runCleanupCheck() {
  const stale = listCallingsOlderThan(DAYS_BEFORE_CLEANUP);
  if (stale.length === 0) return;

  const recipients = listRingpresidiumEmails();

  for (const calling of stale) {
    try {
      if (recipients.length > 0) {
        await mailer.sendMail({
          to: recipients.join(','),
          subject: `Roeping "${calling.name}" (${calling.functie}) nog niet verwerkt na 30 dagen`,
          text: summarizeCalling(calling),
        });
      } else {
        console.warn(`[cron] Geen e-mailadressen bekend bij ringpresidiumleden; roeping ${calling.id} wordt niet verwijderd.`);
        continue;
      }
      deleteCalling(calling.id);
      console.log(`[cron] Roeping "${calling.name}" verwijderd na 30 dagen en ringpresidium op de hoogte gebracht.`);
    } catch (err) {
      console.error(`[cron] Kon roeping ${calling.id} niet verwerken (e-mail mislukt), wordt later opnieuw geprobeerd:`, err.message);
    }
  }
}

function startCron() {
  // Elke dag om 06:00 controleren.
  cron.schedule('0 6 * * *', () => {
    runCleanupCheck().catch((err) => console.error('[cron] Onverwachte fout:', err));
  });
}

module.exports = { startCron, runCleanupCheck };
