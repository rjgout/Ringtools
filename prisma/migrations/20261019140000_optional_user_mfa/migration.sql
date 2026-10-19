-- AlterTable: passkey-verificatie voor reguliere gebruikers is voortaan optioneel (standaard uit).
ALTER TABLE "User" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
