-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EXECUTION_AWAITING_RELEASE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveryKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_deliveryKey_key" ON "Notification"("deliveryKey");


-- Een teruggezet/geblokkeerd voorstel verliest vrijgave. Opnieuw goedkeuren is nooit automatisch opnieuw vrijgeven.
CREATE FUNCTION clear_execution_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('APPROVED', 'PROCESSED') THEN
    NEW."executionReleasedAt" := NULL;
    NEW."executionReleasedById" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Calling_execution_release" BEFORE INSERT OR UPDATE ON "Calling"
FOR EACH ROW EXECUTE FUNCTION clear_execution_release();
