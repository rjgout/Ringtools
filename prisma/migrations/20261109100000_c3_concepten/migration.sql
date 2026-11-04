-- CreateEnum
CREATE TYPE "FunctionSource" AS ENUM ('STANDAARD', 'EIGEN', 'VRIJE_TEKST');

-- AlterTable
ALTER TABLE "Calling" ADD COLUMN     "aanstellenExternalName" TEXT,
ADD COLUMN     "catalogVersion" TEXT,
ADD COLUMN     "functionCode" TEXT,
ADD COLUMN     "functionSource" "FunctionSource",
ADD COLUMN     "procedureConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "procedureConfirmedById" TEXT,
ADD COLUMN     "procedureSnapshot" JSONB,
ADD COLUMN     "roepenExternalName" TEXT,
ADD COLUMN     "unitId" TEXT,
ADD COLUMN     "unitKindSnapshot" "UnitKind",
ADD COLUMN     "unitNameSnapshot" TEXT;

-- CreateTable
CREATE TABLE "CallingDraft" (
    "id" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "personName" TEXT,
    "unitId" TEXT,
    "functionSource" "FunctionSource",
    "functionCode" TEXT,
    "functionName" TEXT,
    "roepenAssigneeId" TEXT,
    "ondersteunenAssigneeId" TEXT,
    "aanstellenAssigneeId" TEXT,
    "roepenExternalName" TEXT,
    "aanstellenExternalName" TEXT,
    "procedureConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "submittedCallingId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallingDraft_ringId_updatedAt_idx" ON "CallingDraft"("ringId", "updatedAt");

-- CreateIndex
CREATE INDEX "CallingDraft_submittedAt_idx" ON "CallingDraft"("submittedAt");

-- AddForeignKey
ALTER TABLE "Calling" ADD CONSTRAINT "Calling_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingDraft" ADD CONSTRAINT "CallingDraft_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingDraft" ADD CONSTRAINT "CallingDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

