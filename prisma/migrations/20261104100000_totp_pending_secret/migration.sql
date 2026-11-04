-- AlterTable
ALTER TABLE "TotpCredential" ADD COLUMN "pendingSecretEncrypted" TEXT,
ADD COLUMN "pendingCreatedAt" TIMESTAMP(3);
