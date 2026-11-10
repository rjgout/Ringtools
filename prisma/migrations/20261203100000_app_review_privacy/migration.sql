-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('NORMAL', 'REVIEW', 'AUDIT');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('REQUESTED', 'IN_REVIEW', 'BLOCKED', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'REVIEW_LOGIN';
ALTER TYPE "SecurityEventType" ADD VALUE 'REVIEW_LOGIN_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'REVIEW_PASSWORD_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'REVIEW_DISABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'DEMO_PROVISIONED';
ALTER TYPE "SecurityEventType" ADD VALUE 'DEMO_RESET';
ALTER TYPE "SecurityEventType" ADD VALUE 'ACCOUNT_DELETION_REQUESTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ACCOUNT_DELETION_COMPLETED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountKind" "AccountKind" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "reviewRingId" TEXT;

-- AlterTable
ALTER TABLE "Ring" ADD COLUMN     "demoKey" TEXT,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ReviewCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "receiptHash" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "handledById" TEXT,
    "retentionReason" TEXT,
    "blockerCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDeletionChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRequest_userId_key" ON "AccountDeletionRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRequest_receiptHash_key" ON "AccountDeletionRequest"("receiptHash");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_dueAt_idx" ON "AccountDeletionRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "AccountDeletionChallenge_userId_expiresAt_idx" ON "AccountDeletionChallenge"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ring_demoKey_key" ON "Ring"("demoKey");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reviewRingId_fkey" FOREIGN KEY ("reviewRingId") REFERENCES "Ring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCredential" ADD CONSTRAINT "ReviewCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDeletionChallenge" ADD CONSTRAINT "AccountDeletionChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Review is een expliciete accountgrens, nooit een extra rol of clientuitzondering.
ALTER TABLE "User" ADD CONSTRAINT "User_review_shape" CHECK (
  ("accountKind" = 'REVIEW' AND "reviewRingId" IS NOT NULL AND role <> 'ADMIN' AND NOT "mfaEnabled")
  OR ("accountKind" = 'NORMAL' AND "reviewRingId" IS NULL)
  OR ("accountKind" = 'AUDIT' AND "reviewRingId" IS NULL AND NOT active AND role <> 'ADMIN')
);
CREATE FUNCTION ringtools_account_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."accountKind" = 'REVIEW' AND NOT EXISTS (SELECT 1 FROM "Ring" WHERE id = NEW."reviewRingId" AND "isDemo") THEN
    RAISE EXCEPTION 'Review account requires a demo ring' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "RingMembership" m JOIN "Ring" r ON r.id=m."ringId" WHERE m."userId"=NEW.id AND
      ((NEW."accountKind"='NORMAL' AND r."isDemo") OR NEW."accountKind"='AUDIT' OR
       (NEW."accountKind"='REVIEW' AND (NOT r."isDemo" OR r.id<>NEW."reviewRingId" OR m."isRingManager" OR m.role='ADMIN')))) THEN
    RAISE EXCEPTION 'Account scope conflicts with membership' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_account_scope" BEFORE INSERT OR UPDATE OF "accountKind", "reviewRingId", role, "mfaEnabled" ON "User"
FOR EACH ROW EXECUTE FUNCTION ringtools_account_scope_guard();
CREATE FUNCTION ringtools_membership_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "AccountKind"; target text; demo boolean;
BEGIN
  SELECT "accountKind", "reviewRingId" INTO kind,target FROM "User" WHERE id=NEW."userId";
  SELECT "isDemo" INTO demo FROM "Ring" WHERE id=NEW."ringId";
  IF kind='AUDIT' OR (kind='NORMAL' AND demo) OR
     (kind='REVIEW' AND (NOT demo OR NEW."ringId"<>target OR NEW."isRingManager" OR NEW.role='ADMIN')) THEN
    RAISE EXCEPTION 'Account cannot join this ring' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "RingMembership_account_scope" BEFORE INSERT OR UPDATE ON "RingMembership"
FOR EACH ROW EXECUTE FUNCTION ringtools_membership_scope_guard();
CREATE FUNCTION ringtools_demo_ring_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."isDemo" IS DISTINCT FROM OLD."isDemo" AND
     (EXISTS (SELECT 1 FROM "User" WHERE "reviewRingId"=NEW.id) OR EXISTS (SELECT 1 FROM "RingMembership" WHERE "ringId"=NEW.id)) THEN
    RAISE EXCEPTION 'Cannot convert an occupied ring' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Ring_demo_scope" BEFORE UPDATE OF "isDemo" ON "Ring"
FOR EACH ROW EXECUTE FUNCTION ringtools_demo_ring_guard();
