#!/bin/sh
# Oefent het herstellen van een back-up in een AFZONDERLIJKE database (<POSTGRES_DB>_oefen); de echte database wordt nooit aangeraakt.
#
# Gebruik:  scripts/db-restore-oefen.sh <db-container> <dumpbestand>     herstel in <POSTGRES_DB>_oefen en toon een vergelijking
#           scripts/db-restore-oefen.sh <db-container> --opruimen        verwijder de oefendatabase weer
#
# POSTGRES_USER en POSTGRES_DB bestaan alleen binnen de container (enkele aanhalingstekens, uitgebreid in de container).
set -eu

DOCKER="${DOCKER:-docker}"
CONTAINER="${1:-}"
ARG="${2:-}"
if [ -z "$CONTAINER" ] || [ -z "$ARG" ]; then
  echo "Gebruik: $0 <db-container> <dumpbestand|--opruimen>" >&2
  exit 2
fi

dbexec() { "$DOCKER" exec "$CONTAINER" sh -c "$1"; }

if [ "$ARG" = "--opruimen" ]; then
  dbexec 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}_oefen\""'
  echo "OK: oefendatabase verwijderd."
  exit 0
fi

DUMP="$ARG"
if [ ! -s "$DUMP" ]; then
  echo "FOUT: dumpbestand ontbreekt of is leeg: $DUMP" >&2
  exit 1
fi

# Veiligheid: de oefennaam moet afwijken van de echte database (door de _oefen-achtervoegsel altijd het geval; toch expliciet gecontroleerd).
dbexec '[ "${POSTGRES_DB}_oefen" != "$POSTGRES_DB" ]' || { echo "FOUT: oefendatabase zou gelijk zijn aan de echte database." >&2; exit 1; }

dbexec 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}_oefen\"" -c "CREATE DATABASE \"${POSTGRES_DB}_oefen\""' \
  || { echo "FOUT: oefendatabase aanmaken mislukt." >&2; exit 1; }

if ! "$DOCKER" exec -i "$CONTAINER" sh -c 'pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_oefen" --no-owner --exit-on-error' < "$DUMP"; then
  echo "FOUT: herstellen is mislukt; de oefendatabase blijft staan voor onderzoek (--opruimen om te verwijderen)." >&2
  exit 1
fi

echo "== Vergelijking (de echte database kan sinds de dump zijn veranderd; verschillen zijn dan normaal) =="
echo "database: gebruikers | voorstellen | ringen | migraties"
dbexec 'for d in "$POSTGRES_DB" "${POSTGRES_DB}_oefen"; do
  printf "%s: " "$d"
  psql -U "$POSTGRES_USER" -d "$d" -At -F " | " -c "select (select count(*) from \"User\"), (select count(*) from \"Calling\"), (select count(*) from \"Ring\"), (select count(*) from _prisma_migrations)"
done' || { echo "FOUT: vergelijking mislukt." >&2; exit 1; }
echo "OK: herstel in de oefendatabase geslaagd. Verwijder hem met: $0 $CONTAINER --opruimen"
