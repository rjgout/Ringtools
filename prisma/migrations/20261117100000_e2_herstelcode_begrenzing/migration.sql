-- E2.1: persistente begrenzing van herstelcodepogingen (tijdelijke lockout, overleeft herstarts). Strikt additief.
ALTER TABLE "TotpCredential"
ADD COLUMN "recoveryFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "recoveryLockedUntil" TIMESTAMP(3);
