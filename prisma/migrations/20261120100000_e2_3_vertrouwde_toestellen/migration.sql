-- E2.3: vertrouwde toestellen. Strikt additief: nieuwe enumwaarden, nieuwe tabellen; geen bestaande data of kolommen gewijzigd.
ALTER TYPE "SecurityEventType" ADD VALUE 'TRUSTED_DEVICE_PAIRING_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRUSTED_DEVICE_REGISTERED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRUSTED_DEVICE_REVOKED';

CREATE TYPE "TrustedDevicePlatform" AS ENUM ('IOS', 'ANDROID');

CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "platform" "TrustedDevicePlatform" NOT NULL,
    "installationId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaPairing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimTokenHash" TEXT,
    "challenge" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfaPairing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrustedDevice_installationId_key" ON "TrustedDevice"("installationId");
CREATE UNIQUE INDEX "TrustedDevice_publicKey_key" ON "TrustedDevice"("publicKey");
CREATE INDEX "TrustedDevice_userId_idx" ON "TrustedDevice"("userId");
CREATE UNIQUE INDEX "MfaPairing_codeHash_key" ON "MfaPairing"("codeHash");
CREATE UNIQUE INDEX "MfaPairing_claimTokenHash_key" ON "MfaPairing"("claimTokenHash");
CREATE INDEX "MfaPairing_userId_idx" ON "MfaPairing"("userId");

ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaPairing" ADD CONSTRAINT "MfaPairing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
