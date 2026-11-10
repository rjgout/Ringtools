ALTER TABLE "Ring" ADD COLUMN "demoResetting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_review_email" CHECK ("accountKind" <> 'REVIEW' OR lower(email) ~ '^[^@[:space:]]+@ringtools[.]invalid$');
