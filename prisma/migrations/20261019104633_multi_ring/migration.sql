-- Multi-ring: Ring + RingMembership, ringId op Calling en Notification.
-- Alle bestaande gegevens worden veilig aan één standaardring gekoppeld
-- ("Ring Apeldoorn"); er wordt niets verwijderd of overschreven.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_REMINDER';

-- DropIndex
DROP INDEX "Notification_userId_readAt_idx";

-- CreateTable
CREATE TABLE "Ring" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ring_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "churchFunction" TEXT NOT NULL DEFAULT '',
    "isRingManager" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RingMembership_pkey" PRIMARY KEY ("id")
);

-- AlterTable (eerst nullable; na de backfill pas verplicht)
ALTER TABLE "Calling" ADD COLUMN "ringId" TEXT;
ALTER TABLE "EligibleVoter" ADD COLUMN "lastInvitedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "ringId" TEXT;

-- Backfill: standaardring alleen aanmaken als er al gegevens bestaan
-- (een nieuwe, lege installatie begint zonder ringen).
INSERT INTO "Ring" ("id", "name", "createdAt", "updatedAt")
SELECT 'ring_standaard', 'Ring Apeldoorn', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User" WHERE "role" <> 'ADMIN')
   OR EXISTS (SELECT 1 FROM "Calling")
   OR EXISTS (SELECT 1 FROM "Notification");

-- Elke bestaande niet-adminaccount wordt lid van de standaardring met de
-- huidige rol. Wie vóór deze wijziging gebruikers mocht beheren (ringpresidium,
-- -secretaris, -administrateur) wordt ringbeheerder, zodat niemand bevoegdheid
-- verliest en de ring meteen minstens één beheerder heeft.
INSERT INTO "RingMembership" ("id", "userId", "ringId", "role", "churchFunction", "isRingManager", "active", "createdAt", "updatedAt")
SELECT
  'rm_' || u."id",
  u."id",
  'ring_standaard',
  u."role",
  CASE u."role"
    WHEN 'RINGPRESIDIUM' THEN 'Ringpresidium'
    WHEN 'RINGSECRETARIS' THEN 'Ringsecretaris'
    WHEN 'RINGADMINISTRATEUR' THEN 'Ringadministrateur'
    ELSE 'Hoge raad'
  END,
  u."role" IN ('RINGPRESIDIUM', 'RINGSECRETARIS', 'RINGADMINISTRATEUR'),
  u."active",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" <> 'ADMIN';

UPDATE "Calling" SET "ringId" = 'ring_standaard' WHERE "ringId" IS NULL;
UPDATE "Notification" SET "ringId" = 'ring_standaard' WHERE "ringId" IS NULL;

-- Bestaande deelnemers: de aanmaakdatum is het moment van de uitnodiging.
UPDATE "EligibleVoter" SET "lastInvitedAt" = "createdAt" WHERE "lastInvitedAt" IS NULL;

ALTER TABLE "Calling" ALTER COLUMN "ringId" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "ringId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Ring_name_key" ON "Ring"("name");

-- CreateIndex
CREATE INDEX "RingMembership_ringId_active_role_idx" ON "RingMembership"("ringId", "active", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RingMembership_userId_ringId_key" ON "RingMembership"("userId", "ringId");

-- CreateIndex
CREATE INDEX "Calling_ringId_status_idx" ON "Calling"("ringId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_ringId_readAt_idx" ON "Notification"("userId", "ringId", "readAt");

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingMembership" ADD CONSTRAINT "RingMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingMembership" ADD CONSTRAINT "RingMembership_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;
