-- C3-correctie: herstelbare aanmaakmeldingen. Additief; bestaande voorstellen gelden als reeds gemeld (geen nasturen).
ALTER TABLE "Calling" ADD COLUMN "creationNotifyClaimedAt" TIMESTAMP(3),
ADD COLUMN "creationNotifiedAt" TIMESTAMP(3);

UPDATE "Calling" SET "creationNotifiedAt" = "createdAt";
