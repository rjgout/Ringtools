-- Additief en veilig voor bestaande data: alle bestaande ringen blijven actief.
ALTER TABLE "Ring" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
