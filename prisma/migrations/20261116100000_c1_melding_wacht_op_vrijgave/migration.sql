-- C1: melding aan de ringstaf bij "Presidium akkoord – wacht op vrijgave". Strikt additief.
ALTER TYPE "NotificationType" ADD VALUE 'AWAITING_RELEASE';

ALTER TABLE "Calling"
ADD COLUMN "releaseNotifyClaimedAt" TIMESTAMP(3),
ADD COLUMN "releaseNotifiedAt" TIMESTAMP(3);

-- Voorstellen die al op vrijgave wachten (of het presidiumakkoord al hadden) worden niet achteraf gemeld.
-- Voorstellen die nog in de presidiumronde zitten blijven NULL en krijgen de melding bij hun presidiumakkoord.
UPDATE "Calling" SET "releaseNotifiedAt" = NOW() WHERE "presidiumApprovedAt" IS NOT NULL OR "status" = 'PRESIDIUM_APPROVED';
