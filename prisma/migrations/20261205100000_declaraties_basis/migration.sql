-- Declaratiemodule, fase 1: uitsluitend additief (nieuwe enumwaarden, kolom met standaardwaarde en nieuwe tabellen). Geen DROP/DELETE.
-- CreateEnum
CREATE TYPE "FinanceRole" AS ENUM ('ADMIN', 'SUBADMIN', 'RING_PRESIDENT_READ', 'UNIT_LEADER');

-- CreateEnum
CREATE TYPE "DeclarationStatus" AS ENUM ('SUBMITTED', 'SEEN', 'IN_PROGRESS', 'NEEDS_INFO', 'PROCESSED', 'REJECTED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'KERKLID';

-- AlterTable
ALTER TABLE "InvitationLoginCode" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'invitation';

-- CreateTable
CREATE TABLE "FinanceAssignment" (
    "id" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "unitId" TEXT,
    "userId" TEXT NOT NULL,
    "role" "FinanceRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "FinanceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingFinanceAssignment" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "unitId" TEXT,
    "role" "FinanceRole" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "PendingFinanceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclarationProfile" (
    "userId" TEXT NOT NULL,
    "preferredRingId" TEXT,
    "preferredUnitId" TEXT,
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeclarationProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Declaration" (
    "id" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "unitId" TEXT,
    "ringName" TEXT NOT NULL,
    "unitName" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "DeclarationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "sealed" BYTEA NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "seenById" TEXT,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Declaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclarationAttachment" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclarationAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclarationStatusEvent" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "fromStatus" "DeclarationStatus",
    "toStatus" "DeclarationStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclarationStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclarationAccessLog" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclarationAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceAssignment_userId_active_idx" ON "FinanceAssignment"("userId", "active");

-- CreateIndex
CREATE INDEX "FinanceAssignment_ringId_unitId_role_active_idx" ON "FinanceAssignment"("ringId", "unitId", "role", "active");

-- CreateIndex
CREATE INDEX "PendingFinanceAssignment_email_claimedAt_idx" ON "PendingFinanceAssignment"("email", "claimedAt");

-- CreateIndex
CREATE INDEX "Declaration_ringId_unitId_status_idx" ON "Declaration"("ringId", "unitId", "status");

-- CreateIndex
CREATE INDEX "Declaration_ownerId_submittedAt_idx" ON "Declaration"("ownerId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Declaration_ownerId_clientRequestId_key" ON "Declaration"("ownerId", "clientRequestId");

-- CreateIndex
CREATE INDEX "DeclarationAttachment_declarationId_position_idx" ON "DeclarationAttachment"("declarationId", "position");

-- CreateIndex
CREATE INDEX "DeclarationStatusEvent_declarationId_createdAt_idx" ON "DeclarationStatusEvent"("declarationId", "createdAt");

-- CreateIndex
CREATE INDEX "DeclarationAccessLog_declarationId_createdAt_idx" ON "DeclarationAccessLog"("declarationId", "createdAt");

-- AddForeignKey
ALTER TABLE "FinanceAssignment" ADD CONSTRAINT "FinanceAssignment_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAssignment" ADD CONSTRAINT "FinanceAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RingUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAssignment" ADD CONSTRAINT "FinanceAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingFinanceAssignment" ADD CONSTRAINT "PendingFinanceAssignment_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingFinanceAssignment" ADD CONSTRAINT "PendingFinanceAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RingUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclarationProfile" ADD CONSTRAINT "DeclarationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Declaration" ADD CONSTRAINT "Declaration_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Declaration" ADD CONSTRAINT "Declaration_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Declaration" ADD CONSTRAINT "Declaration_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RingUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclarationAttachment" ADD CONSTRAINT "DeclarationAttachment_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "Declaration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclarationStatusEvent" ADD CONSTRAINT "DeclarationStatusEvent_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "Declaration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclarationAccessLog" ADD CONSTRAINT "DeclarationAccessLog_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "Declaration"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dubbele actieve toekenning van dezelfde functie op dezelfde plek is onmogelijk (ook niet bij gelijktijdige verzoeken).
CREATE UNIQUE INDEX "FinanceAssignment_active_unique" ON "FinanceAssignment" ("userId", "ringId", "role", COALESCE("unitId", '')) WHERE "active";
CREATE UNIQUE INDEX "PendingFinanceAssignment_open_unique" ON "PendingFinanceAssignment" ("email", "ringId", "role", COALESCE("unitId", '')) WHERE "claimedAt" IS NULL;

-- Vorm van de functies afdwingen in de database (de server controleert dit ook).
ALTER TABLE "FinanceAssignment" ADD CONSTRAINT "FinanceAssignment_shape_check" CHECK (
  ("role" = 'UNIT_LEADER' AND "unitId" IS NOT NULL) OR ("role" = 'RING_PRESIDENT_READ' AND "unitId" IS NULL) OR "role" IN ('ADMIN', 'SUBADMIN'));
ALTER TABLE "PendingFinanceAssignment" ADD CONSTRAINT "PendingFinanceAssignment_shape_check" CHECK (
  ("role" = 'UNIT_LEADER' AND "unitId" IS NOT NULL) OR ("role" = 'RING_PRESIDENT_READ' AND "unitId" IS NULL) OR "role" IN ('ADMIN', 'SUBADMIN'));
ALTER TABLE "Declaration" ADD CONSTRAINT "Declaration_amount_check" CHECK ("amountCents" > 0 AND "amountCents" <= 100000000);
