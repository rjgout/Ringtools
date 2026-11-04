-- CreateEnum
CREATE TYPE "ChurchFunctionCode" AS ENUM ('ONBEKEND', 'RINGPRESIDENT', 'EERSTE_RAADGEVER', 'TWEEDE_RAADGEVER', 'RINGSECRETARIS', 'RINGADMINISTRATEUR', 'HOGERAADSLID', 'ANDERS');

-- AlterTable
ALTER TABLE "RingMembership" ADD COLUMN     "churchFunctionCode" "ChurchFunctionCode" NOT NULL DEFAULT 'ONBEKEND';


-- ---------------------------------------------------------------------------------------------------------------------
-- Voorzichtige afleiding voor bestaande leden. Alleen waar het ondubbelzinnig is; bij elke twijfel blijft de functie ONBEKEND
-- (en dus zonder kerkelijke bevoegdheid) tot de ringbeheerder de functie vastlegt. Er wordt NOOIT een machtiging toegekend
-- of gewijzigd; bestaande machtigingen (appointAuthority) blijven staan en worden pas effectief bij een passende functie.
-- ---------------------------------------------------------------------------------------------------------------------

-- 1. Lid van de hoge raad (rol HOGERAAD) is per definitie hogeraadslid. Dit geeft op zichzelf geen enkele bevoegdheid.
UPDATE "RingMembership" SET "churchFunctionCode" = 'HOGERAADSLID' WHERE "role" = 'HOGERAAD';

-- 2. Ringpresident: de enige actieve houder van de expliciete (oude) aanwijzing RINGPRESIDENT in een ring met rol ringpresidium.
UPDATE "RingMembership" SET "churchFunctionCode" = 'RINGPRESIDENT'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", count(*) OVER (PARTITION BY "ringId") AS n
    FROM "RingMembership"
    WHERE "role" = 'RINGPRESIDIUM' AND "active" = true AND "appointAuthority" = 'RINGPRESIDENT'
  ) t WHERE t.n = 1
);

-- 3. Exacte omschrijving (vrije tekst) die ondubbelzinnig is, rol ringpresidium, actief, en de enige met die omschrijving in de ring.
--    Alleen als de ring de functie nog niet heeft; nooit twee houders van dezelfde functie.
UPDATE "RingMembership" m SET "churchFunctionCode" = 'RINGPRESIDENT'
WHERE m."churchFunctionCode" = 'ONBEKEND' AND m."role" = 'RINGPRESIDIUM' AND m."active" = true
  AND lower(btrim(m."churchFunction")) IN ('ringpresident', 'president van de ring')
  AND NOT EXISTS (SELECT 1 FROM "RingMembership" x WHERE x."ringId" = m."ringId" AND x."churchFunctionCode" = 'RINGPRESIDENT' AND x."active" = true)
  AND (SELECT count(*) FROM "RingMembership" y WHERE y."ringId" = m."ringId" AND y."role" = 'RINGPRESIDIUM' AND y."active" = true
       AND lower(btrim(y."churchFunction")) IN ('ringpresident', 'president van de ring')) = 1;

UPDATE "RingMembership" m SET "churchFunctionCode" = 'EERSTE_RAADGEVER'
WHERE m."churchFunctionCode" = 'ONBEKEND' AND m."role" = 'RINGPRESIDIUM' AND m."active" = true
  AND lower(btrim(m."churchFunction")) IN ('eerste raadgever', 'eerste raadgever ringpresidium', 'eerste raadgever in het ringpresidium')
  AND NOT EXISTS (SELECT 1 FROM "RingMembership" x WHERE x."ringId" = m."ringId" AND x."churchFunctionCode" = 'EERSTE_RAADGEVER' AND x."active" = true)
  AND (SELECT count(*) FROM "RingMembership" y WHERE y."ringId" = m."ringId" AND y."role" = 'RINGPRESIDIUM' AND y."active" = true
       AND lower(btrim(y."churchFunction")) IN ('eerste raadgever', 'eerste raadgever ringpresidium', 'eerste raadgever in het ringpresidium')) = 1;

UPDATE "RingMembership" m SET "churchFunctionCode" = 'TWEEDE_RAADGEVER'
WHERE m."churchFunctionCode" = 'ONBEKEND' AND m."role" = 'RINGPRESIDIUM' AND m."active" = true
  AND lower(btrim(m."churchFunction")) IN ('tweede raadgever', 'tweede raadgever ringpresidium', 'tweede raadgever in het ringpresidium')
  AND NOT EXISTS (SELECT 1 FROM "RingMembership" x WHERE x."ringId" = m."ringId" AND x."churchFunctionCode" = 'TWEEDE_RAADGEVER' AND x."active" = true)
  AND (SELECT count(*) FROM "RingMembership" y WHERE y."ringId" = m."ringId" AND y."role" = 'RINGPRESIDIUM' AND y."active" = true
       AND lower(btrim(y."churchFunction")) IN ('tweede raadgever', 'tweede raadgever ringpresidium', 'tweede raadgever in het ringpresidium')) = 1;

-- Bewust NIET afgeleid: secretaris/administrateur (rol is geen functie), raadgevers zonder exacte omschrijving, en alles wat dubbelzinnig is.
