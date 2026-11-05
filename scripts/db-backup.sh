#!/bin/sh
# Maakt een logische back-up (pg_dump, custom formaat) van de Ringtools-database in de db-container.
#
# Gebruik:  scripts/db-backup.sh <db-container> [doelmap]
#   Voorbeeld op de NAS:  scripts/db-backup.sh ringtools-db-1 /volume1/backups/ringtools
#
# POSTGRES_USER en POSTGRES_DB bestaan alleen BINNEN de container; de commando's staan daarom tussen enkele aanhalingstekens en worden
# door de shell in de container uitgebreid. Er wordt niets op de host verondersteld. Bij een fout blijft er geen (half) bestand achter.
set -eu

DOCKER="${DOCKER:-docker}"
CONTAINER="${1:-}"
DIR="${2:-.}"
if [ -z "$CONTAINER" ]; then
  echo "Gebruik: $0 <db-container> [doelmap]" >&2
  exit 2
fi

mkdir -p "$DIR"
OUT="$DIR/ringtools-$(date +%Y%m%d-%H%M%S).dump"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT INT TERM

if ! "$DOCKER" exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$TMP"; then
  echo "FOUT: pg_dump is mislukt (containernaam, gebruiker of database onjuist, of de database draait niet)." >&2
  exit 1
fi
if [ ! -s "$TMP" ]; then
  echo "FOUT: de back-up is leeg." >&2
  exit 1
fi
# Leesbaarheidscontrole: pg_restore --list leest alleen de inhoudsopgave van de dump, er wordt niets hersteld.
if ! "$DOCKER" exec -i "$CONTAINER" sh -c 'pg_restore --list > /dev/null' < "$TMP"; then
  echo "FOUT: de back-up is niet leesbaar (pg_restore --list mislukt)." >&2
  exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT INT TERM
echo "OK: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
