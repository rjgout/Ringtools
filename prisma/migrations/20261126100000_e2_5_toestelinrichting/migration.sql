-- E2.5: automatische Face ID-inrichting vanuit een ingelogde sessie. Strikt additief (nieuwe tabel).
CREATE TABLE "DeviceEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceEnrollment_userId_createdAt_idx" ON "DeviceEnrollment"("userId", "createdAt");

ALTER TABLE "DeviceEnrollment" ADD CONSTRAINT "DeviceEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
