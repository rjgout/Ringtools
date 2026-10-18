#!/bin/sh
set -e

echo "[entrypoint] Database-migraties toepassen..."
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Ringtools starten op poort ${PORT:-2809}..."
exec node_modules/.bin/next start -p "${PORT:-2809}"
