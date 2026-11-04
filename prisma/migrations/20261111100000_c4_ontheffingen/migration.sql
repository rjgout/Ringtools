-- CreateEnum
CREATE TYPE "OntheffingStatus" AS ENUM ('CONCEPT', 'PRESIDIUM_VOTING', 'PRESIDIUM_PAUSED', 'PRESIDIUM_APPROVED', 'HOGERAAD_VOTING', 'HOGERAAD_PAUSED', 'APPROVED', 'PROCESSED');

-- CreateEnum
CREATE TYPE "OntheffingPersonRole" AS ENUM ('HOOFD', 'RAADGEVER');

-- CreateEnum
CREATE TYPE "FollowUpAnswer" AS ENUM ('OPEN', 'NAAM', 'NIET_VAN_TOEPASSING');

-- CreateEnum
CREATE TYPE "AccountLinkMode" AS ENUM ('ONBEKEND', 'GEKOPPELD', 'GEEN_ACCOUNT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CONFIDENTIAL_PROPOSAL';
ALTER TYPE "NotificationType" ADD VALUE 'CONFIDENTIAL_HOGERAAD';
ALTER TYPE "NotificationType" ADD VALUE 'CONFIDENTIAL_PAUSED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "ontheffingId" TEXT;

-- CreateTable
CREATE TABLE "Ontheffing" (
    "id" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "OntheffingStatus" NOT NULL DEFAULT 'CONCEPT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unitId" TEXT,
    "unitNameSnapshot" TEXT,
    "unitKindSnapshot" "UnitKind",
    "functionSource" "FunctionSource",
    "functionCode" TEXT,
    "functionName" TEXT,
    "catalogVersion" TEXT,
    "procedureSnapshot" JSONB,
    "procedureConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "procedureConfirmedAt" TIMESTAMP(3),
    "joint" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "presidiumApprovedAt" TIMESTAMP(3),
    "presidiumApprovalMethod" "DecisionMethod",
    "hogeraadReleasedAt" TIMESTAMP(3),
    "hogeraadReleasedById" TEXT,
    "hogeraadApprovalMethod" "DecisionMethod",
    "approvedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "notifyEvent" TEXT,
    "notifyClaimedAt" TIMESTAMP(3),

    CONSTRAINT "Ontheffing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OntheffingPerson" (
    "id" TEXT NOT NULL,
    "ontheffingId" TEXT NOT NULL,
    "role" "OntheffingPersonRole" NOT NULL,
    "followUpCode" TEXT,
    "functionName" TEXT NOT NULL,
    "answer" "FollowUpAnswer" NOT NULL DEFAULT 'OPEN',
    "name" TEXT,
    "naReason" TEXT,
    "accountMode" "AccountLinkMode" NOT NULL DEFAULT 'ONBEKEND',
    "userId" TEXT,
    "informedAt" TIMESTAMP(3),
    "informedById" TEXT,
    "announcedAt" TIMESTAMP(3),
    "announcedById" TEXT,
    "thankedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OntheffingPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OntheffingVoter" (
    "id" TEXT NOT NULL,
    "ontheffingId" TEXT NOT NULL,
    "stage" "VoteStage" NOT NULL,
    "userId" TEXT NOT NULL,
    "lastInvitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OntheffingVoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OntheffingVote" (
    "id" TEXT NOT NULL,
    "ontheffingId" TEXT NOT NULL,
    "stage" "VoteStage" NOT NULL,
    "userId" TEXT NOT NULL,
    "support" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OntheffingVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OntheffingDecision" (
    "id" TEXT NOT NULL,
    "ontheffingId" TEXT NOT NULL,
    "stage" "VoteStage" NOT NULL,
    "decidedOn" DATE NOT NULL,
    "registeredById" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agreed" BOOLEAN NOT NULL,
    "note" TEXT,
    "presidingUserId" TEXT,
    "presentUserIds" TEXT[],
    "absentUserIds" TEXT[],
    "overrodeNegativeVotes" BOOLEAN NOT NULL DEFAULT false,
    "resolutionNote" TEXT,

    CONSTRAINT "OntheffingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OntheffingAudit" (
    "id" TEXT NOT NULL,
    "ontheffingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" TEXT,

    CONSTRAINT "OntheffingAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ontheffing_ringId_status_idx" ON "Ontheffing"("ringId", "status");

-- CreateIndex
CREATE INDEX "Ontheffing_status_updatedAt_idx" ON "Ontheffing"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Ontheffing_processedAt_idx" ON "Ontheffing"("processedAt");

-- CreateIndex
CREATE INDEX "OntheffingPerson_ontheffingId_idx" ON "OntheffingPerson"("ontheffingId");

-- CreateIndex
CREATE INDEX "OntheffingPerson_userId_idx" ON "OntheffingPerson"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OntheffingPerson_ontheffingId_followUpCode_key" ON "OntheffingPerson"("ontheffingId", "followUpCode");

-- CreateIndex
CREATE INDEX "OntheffingVoter_userId_idx" ON "OntheffingVoter"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OntheffingVoter_ontheffingId_stage_userId_key" ON "OntheffingVoter"("ontheffingId", "stage", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OntheffingVote_ontheffingId_stage_userId_key" ON "OntheffingVote"("ontheffingId", "stage", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OntheffingDecision_ontheffingId_stage_key" ON "OntheffingDecision"("ontheffingId", "stage");

-- CreateIndex
CREATE INDEX "OntheffingAudit_ontheffingId_createdAt_idx" ON "OntheffingAudit"("ontheffingId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ontheffingId_fkey" FOREIGN KEY ("ontheffingId") REFERENCES "Ontheffing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ontheffing" ADD CONSTRAINT "Ontheffing_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ontheffing" ADD CONSTRAINT "Ontheffing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingPerson" ADD CONSTRAINT "OntheffingPerson_ontheffingId_fkey" FOREIGN KEY ("ontheffingId") REFERENCES "Ontheffing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingPerson" ADD CONSTRAINT "OntheffingPerson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingVoter" ADD CONSTRAINT "OntheffingVoter_ontheffingId_fkey" FOREIGN KEY ("ontheffingId") REFERENCES "Ontheffing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingVoter" ADD CONSTRAINT "OntheffingVoter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingVote" ADD CONSTRAINT "OntheffingVote_ontheffingId_fkey" FOREIGN KEY ("ontheffingId") REFERENCES "Ontheffing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingVote" ADD CONSTRAINT "OntheffingVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingDecision" ADD CONSTRAINT "OntheffingDecision_ontheffingId_fkey" FOREIGN KEY ("ontheffingId") REFERENCES "Ontheffing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingDecision" ADD CONSTRAINT "OntheffingDecision_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingDecision" ADD CONSTRAINT "OntheffingDecision_presidingUserId_fkey" FOREIGN KEY ("presidingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingAudit" ADD CONSTRAINT "OntheffingAudit_ontheffingId_fkey" FOREIGN KEY ("ontheffingId") REFERENCES "Ontheffing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntheffingAudit" ADD CONSTRAINT "OntheffingAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

