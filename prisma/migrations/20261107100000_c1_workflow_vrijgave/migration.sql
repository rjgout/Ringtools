-- CreateEnum
CREATE TYPE "DecisionMethod" AS ENUM ('INDIVIDUAL', 'MEETING');

-- AlterEnum
ALTER TYPE "CallingStatus" ADD VALUE 'PRESIDIUM_APPROVED';

-- AlterTable
ALTER TABLE "Calling" ADD COLUMN     "hogeraadApprovalMethod" "DecisionMethod",
ADD COLUMN     "hogeraadReleasedAt" TIMESTAMP(3),
ADD COLUMN     "hogeraadReleasedById" TEXT,
ADD COLUMN     "presidiumApprovalMethod" "DecisionMethod",
ADD COLUMN     "presidiumApprovedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GroupDecision" (
    "id" TEXT NOT NULL,
    "callingId" TEXT NOT NULL,
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

    CONSTRAINT "GroupDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallingAudit" (
    "id" TEXT NOT NULL,
    "callingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" TEXT,

    CONSTRAINT "CallingAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupDecision_callingId_stage_key" ON "GroupDecision"("callingId", "stage");

-- CreateIndex
CREATE INDEX "CallingAudit_callingId_createdAt_idx" ON "CallingAudit"("callingId", "createdAt");

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_hogeraadReleasedById_fkey" FOREIGN KEY ("hogeraadReleasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupDecision" ADD CONSTRAINT "GroupDecision_callingId_fkey" FOREIGN KEY ("callingId") REFERENCES "Calling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupDecision" ADD CONSTRAINT "GroupDecision_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupDecision" ADD CONSTRAINT "GroupDecision_presidingUserId_fkey" FOREIGN KEY ("presidingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingAudit" ADD CONSTRAINT "CallingAudit_callingId_fkey" FOREIGN KEY ("callingId") REFERENCES "Calling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingAudit" ADD CONSTRAINT "CallingAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

