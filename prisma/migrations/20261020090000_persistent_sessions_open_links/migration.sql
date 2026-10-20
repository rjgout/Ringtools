-- AlterTable
ALTER TABLE "MagicLinkToken" ADD COLUMN     "codeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codeHash" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "prevTokenHash" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OpenLinkToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pushCount" INTEGER NOT NULL DEFAULT 0,
    "lastPushAt" TIMESTAMP(3),
    "lastMailAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenLinkToken_tokenHash_key" ON "OpenLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OpenLinkToken_userId_idx" ON "OpenLinkToken"("userId");

-- CreateIndex
CREATE INDEX "OpenLinkToken_callingId_idx" ON "OpenLinkToken"("callingId");

-- CreateIndex
CREATE INDEX "OpenLinkToken_expiresAt_idx" ON "OpenLinkToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_prevTokenHash_idx" ON "Session"("prevTokenHash");

-- AddForeignKey
ALTER TABLE "OpenLinkToken" ADD CONSTRAINT "OpenLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLinkToken" ADD CONSTRAINT "OpenLinkToken_callingId_fkey" FOREIGN KEY ("callingId") REFERENCES "Calling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

