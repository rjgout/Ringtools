#!/usr/bin/env bash
# Gedeelde hulpfuncties voor de Mac-scripts. Wordt met 'source' geladen.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MOBILE_DIR"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()   { red "✗ $*"; exit 1; }

load_env() {
  if [ -f .env ]; then set -a; . ./.env; set +a; fi
  [ -n "${EXPO_PUBLIC_API_URL:-}" ] || die "EXPO_PUBLIC_API_URL ontbreekt. Kopieer .env.example naar .env en vul de https-URL van je Ringtools in."
  case "$EXPO_PUBLIC_API_URL" in
    https://*) ;;
    *) die "EXPO_PUBLIC_API_URL moet met https:// beginnen (nu: $EXPO_PUBLIC_API_URL)." ;;
  esac
  case "$EXPO_PUBLIC_API_URL" in
    *example.nl*|*jouwdomein*) die "EXPO_PUBLIC_API_URL is nog de voorbeeldwaarde ($EXPO_PUBLIC_API_URL)." ;;
  esac
}

check_node() {
  command -v node >/dev/null || die "Node.js ontbreekt. Installeer met: brew install node@22"
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "Node.js $major is te oud; gebruik versie 20 of nieuwer (brew install node@22)."
}

eas() { npx --yes eas-cli@latest "$@"; }
