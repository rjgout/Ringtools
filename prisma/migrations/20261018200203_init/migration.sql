-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RINGPRESIDIUM', 'RINGSECRETARIS', 'RINGADMINISTRATEUR', 'HOGERAAD');

-- CreateEnum
CREATE TYPE "VoteStage" AS ENUM ('PRESIDIUM', 'HOGERAAD');

-- CreateEnum
CREATE TYPE "CallingStatus" AS ENUM ('PRESIDIUM_VOTING', 'PRESIDIUM_PAUSED', 'HOGERAAD_VOTING', 'HOGERAAD_PAUSED', 'APPROVED', 'PROCESSED');

-- CreateEnum
CREATE TYPE "OndersteuningContext" AS ENUM ('AVONDMAALSVERGADERING', 'RINGCONFERENTIE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calling" (
    "id" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "functionTitle" TEXT NOT NULL,
    "status" "CallingStatus" NOT NULL DEFAULT 'PRESIDIUM_VOTING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "reminder30SentAt" TIMESTAMP(3),
    "roepenAssigneeId" TEXT,
    "roepenDoneById" TEXT,
    "roepenDoneAt" TIMESTAMP(3),
    "ondersteunenAssigneeId" TEXT,
    "ondersteunenDoneById" TEXT,
    "ondersteunenDoneAt" TIMESTAMP(3),
    "ondersteunenContext" "OndersteuningContext",
    "aanstellenAssigneeId" TEXT,
    "aanstellenDoneById" TEXT,
    "aanstellenDoneAt" TIMESTAMP(3),

    CONSTRAINT "Calling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibleVoter" (
    "id" TEXT NOT NULL,
    "callingId" TEXT NOT NULL,
    "stage" "VoteStage" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibleVoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "callingId" TEXT NOT NULL,
    "stage" "VoteStage" NOT NULL,
    "userId" TEXT NOT NULL,
    "support" BOOLEAN NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmtpSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "host" TEXT,
    "port" INTEGER NOT NULL DEFAULT 587,
    "security" TEXT NOT NULL DEFAULT 'STARTTLS',
    "username" TEXT,
    "encryptedPassword" TEXT,
    "fromAddress" TEXT NOT NULL DEFAULT 'noreply@ringapeldoorn.nl',
    "fromName" TEXT NOT NULL DEFAULT 'Ringtools',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SmtpSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_active_idx" ON "User"("role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_tokenHash_key" ON "MagicLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLinkToken_userId_idx" ON "MagicLinkToken"("userId");

-- CreateIndex
CREATE INDEX "MagicLinkToken_expiresAt_idx" ON "MagicLinkToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Calling_status_idx" ON "Calling"("status");

-- CreateIndex
CREATE INDEX "Calling_processedAt_idx" ON "Calling"("processedAt");

-- CreateIndex
CREATE INDEX "Calling_createdAt_idx" ON "Calling"("createdAt");

-- CreateIndex
CREATE INDEX "EligibleVoter_callingId_stage_idx" ON "EligibleVoter"("callingId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "EligibleVoter_callingId_stage_userId_key" ON "EligibleVoter"("callingId", "stage", "userId");

-- CreateIndex
CREATE INDEX "Vote_callingId_stage_idx" ON "Vote"("callingId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_callingId_stage_userId_key" ON "Vote"("callingId", "stage", "userId");

-- AddForeignKey
ALTER TABLE "MagicLinkToken" ADD CONSTRAINT "MagicLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_roepenAssigneeId_fkey" FOREIGN KEY ("roepenAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_roepenDoneById_fkey" FOREIGN KEY ("roepenDoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_ondersteunenAssigneeId_fkey" FOREIGN KEY ("ondersteunenAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_ondersteunenDoneById_fkey" FOREIGN KEY ("ondersteunenDoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_aanstellenAssigneeId_fkey" FOREIGN KEY ("aanstellenAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_aanstellenDoneById_fkey" FOREIGN KEY ("aanstellenDoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleVoter" ADD CONSTRAINT "EligibleVoter_callingId_fkey" FOREIGN KEY ("callingId") REFERENCES "Calling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleVoter" ADD CONSTRAINT "EligibleVoter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_callingId_fkey" FOREIGN KEY ("callingId") REFERENCES "Calling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmtpSettings" ADD CONSTRAINT "SmtpSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
