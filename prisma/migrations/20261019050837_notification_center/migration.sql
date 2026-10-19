-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_PROPOSAL', 'ADVANCED_TO_HOGERAAD', 'REINVITE', 'PAUSED', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'REMINDER_30_DAYS');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "callingId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_callingId_idx" ON "Notification"("callingId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_callingId_fkey" FOREIGN KEY ("callingId") REFERENCES "Calling"("id") ON DELETE CASCADE ON UPDATE CASCADE;
