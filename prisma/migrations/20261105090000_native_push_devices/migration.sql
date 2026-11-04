-- De eerdere tokens waren Expo-tokens van een nooit gepubliceerde app en zijn niet meer bruikbaar.
DELETE FROM "DevicePushToken";

-- AlterTable
ALTER TABLE "DevicePushToken" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'fcm',
ADD COLUMN "deviceId" TEXT,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "DevicePushToken_userId_deviceId_idx" ON "DevicePushToken"("userId", "deviceId");
