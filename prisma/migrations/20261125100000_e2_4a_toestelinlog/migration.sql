-- E2.4a: wachtwoordloos inloggen met een vertrouwd toestel. Strikt additief (nieuwe enumwaarden, kolommen en tabel; niets verwijderd of gewijzigd).
ALTER TYPE "SecurityEventType" ADD VALUE 'TRUSTED_DEVICE_LOGIN_ENABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRUSTED_DEVICE_LOGIN_DISABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRUSTED_DEVICE_LOGIN';

CREATE TYPE "DeviceChallengePurpose" AS ENUM ('LOGIN', 'ACTIVATE');

ALTER TABLE "TrustedDevice" ADD COLUMN "loginEnabledAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "deviceId" TEXT;

CREATE TABLE "DeviceLoginChallenge" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "purpose" "DeviceChallengePurpose" NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceLoginChallenge_deviceId_createdAt_idx" ON "DeviceLoginChallenge"("deviceId", "createdAt");
CREATE INDEX "Session_deviceId_idx" ON "Session"("deviceId");

ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "TrustedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceLoginChallenge" ADD CONSTRAINT "DeviceLoginChallenge_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "TrustedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
