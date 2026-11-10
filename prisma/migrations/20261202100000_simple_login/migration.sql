CREATE TABLE "InvitationLoginCode" (
 "id" TEXT NOT NULL, "email" TEXT NOT NULL, "codeHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
 "attempts" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "InvitationLoginCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvitationLoginCode_email_expiresAt_idx" ON "InvitationLoginCode"("email", "expiresAt");

ALTER TABLE "TrustedDevice" ADD COLUMN "loginProtocol" INTEGER NOT NULL DEFAULT 1;
