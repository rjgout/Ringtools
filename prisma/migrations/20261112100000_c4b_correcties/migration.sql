-- C4-correcties. Strikt additief: er wordt niets verwijderd of overschreven.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CONFIDENTIAL_REMINDER';

-- Activiteit, herinnering (30 dagen) en markering voor beoordeling (90 dagen); lopende dossiers worden nooit automatisch verwijderd.
ALTER TABLE "Ontheffing" ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "reviewFlaggedAt" TIMESTAMP(3);
UPDATE "Ontheffing" SET "lastActivityAt" = "updatedAt";

-- Dankbetuiging: vastleggen of de gelegenheid is geboden (niet of er daadwerkelijk dank is uitgesproken).
-- De bestaande kolom "thankedAt" blijft ongewijzigd bestaan (verouderd, niet meer gebruikt); de waarde wordt overgenomen.
ALTER TABLE "OntheffingPerson" ADD COLUMN "thanksOffered" BOOLEAN;
UPDATE "OntheffingPerson" SET "thanksOffered" = ("thankedAt" IS NOT NULL) WHERE "announcedAt" IS NOT NULL;
