-- CreateEnum
CREATE TYPE "InvitationAuditAction" AS ENUM ('CREATED', 'SENT', 'SEND_FAILED', 'UPDATED', 'REVOKED', 'ACCEPTED', 'ACCEPT_REFUSED', 'CODE_FAILED');

-- CreateTable
CREATE TABLE "RingInvitation" (
    "id" TEXT NOT NULL,
    "ringId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "churchFunction" TEXT NOT NULL DEFAULT '',
    "churchFunctionCode" "ChurchFunctionCode" NOT NULL DEFAULT 'ONBEKEND',
    "isRingManager" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RingInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingInvitationAudit" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "action" "InvitationAuditAction" NOT NULL,
    "actorUserId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RingInvitationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RingInvitation_tokenHash_key" ON "RingInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "RingInvitation_ringId_email_idx" ON "RingInvitation"("ringId", "email");

-- CreateIndex
CREATE INDEX "RingInvitation_expiresAt_idx" ON "RingInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "RingInvitationAudit_invitationId_createdAt_idx" ON "RingInvitationAudit"("invitationId", "createdAt");

-- AddForeignKey
ALTER TABLE "RingInvitation" ADD CONSTRAINT "RingInvitation_ringId_fkey" FOREIGN KEY ("ringId") REFERENCES "Ring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingInvitation" ADD CONSTRAINT "RingInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingInvitation" ADD CONSTRAINT "RingInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingInvitationAudit" ADD CONSTRAINT "RingInvitationAudit_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "RingInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

