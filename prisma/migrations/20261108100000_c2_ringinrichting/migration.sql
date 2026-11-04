-- CreateEnum
CREATE TYPE "AppointAuthority" AS ENUM ('NONE', 'RINGPRESIDENT', 'AANGEWEZEN_RAADGEVER', 'AANGEWEZEN_HOGERAADSLID');

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('WIJK', 'GEMEENTE');

-- AlterTable
ALTER TABLE "RingMembership" ADD COLUMN     "appointAuthority" "AppointAuthority" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RingUnit" (
    "id" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "kind" "UnitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "responsibleUserId" TEXT,
    "defaultRoepenUserId" TEXT,
    "defaultOndersteunenUserId" TEXT,
    "defaultAanstellenUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingCustomCalling" (
    "id" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RingCustomCalling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RingUnit_ringId_active_idx" ON "RingUnit"("ringId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RingUnit_ringId_name_key" ON "RingUnit"("ringId", "name");

-- CreateIndex
CREATE INDEX "RingCustomCalling_ringId_active_idx" ON "RingCustomCalling"("ringId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RingCustomCalling_ringId_name_key" ON "RingCustomCalling"("ringId", "name");

-- AddForeignKey
ALTER TABLE "RingUnit" ADD CONSTRAINT "RingUnit_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingUnit" ADD CONSTRAINT "RingUnit_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingUnit" ADD CONSTRAINT "RingUnit_defaultRoepenUserId_fkey" FOREIGN KEY ("defaultRoepenUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingUnit" ADD CONSTRAINT "RingUnit_defaultOndersteunenUserId_fkey" FOREIGN KEY ("defaultOndersteunenUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingUnit" ADD CONSTRAINT "RingUnit_defaultAanstellenUserId_fkey" FOREIGN KEY ("defaultAanstellenUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCustomCalling" ADD CONSTRAINT "RingCustomCalling_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bestaande gebruikers die al hebben ingelogd (of de systeembeheerder) gelden als geactiveerd; de rest blijft "nog niet geactiveerd".
UPDATE "User" SET "activatedAt" = "createdAt" WHERE "role" = 'ADMIN' OR EXISTS (SELECT 1 FROM "Session" s WHERE s."userId" = "User"."id");
