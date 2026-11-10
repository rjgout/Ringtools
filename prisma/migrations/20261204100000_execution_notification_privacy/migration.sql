-- CreateEnum
CREATE TYPE "TaskNotificationState" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'CANCELLED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Calling" ADD COLUMN     "executionGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "executionReleasedAt" TIMESTAMP(3),
ADD COLUMN     "executionReleasedById" TEXT,
ADD COLUMN     "executionRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "taskNotificationId" TEXT;

-- CreateTable
CREATE TABLE "TaskNotification" (
    "id" TEXT NOT NULL,
    "callingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "releaseGeneration" INTEGER NOT NULL,
    "state" "TaskNotificationState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "TaskNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskNotification_state_createdAt_idx" ON "TaskNotification"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskNotification_callingId_task_revision_key" ON "TaskNotification"("callingId", "task", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_taskNotificationId_key" ON "Notification"("taskNotificationId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskNotificationId_fkey" FOREIGN KEY ("taskNotificationId") REFERENCES "TaskNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNotification" ADD CONSTRAINT "TaskNotification_callingId_fkey" FOREIGN KEY ("callingId") REFERENCES "Calling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNotification" ADD CONSTRAINT "TaskNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

