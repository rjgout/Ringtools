#!/usr/bin/env bash
# Eenmalige voorbereiding op je MacBook: dependencies, controles, Expo/EAS-login,
# EAS-project en de omgevingsvariabelen die de cloud-build nodig heeft.
# Gebruik:  cd mobile && ./scripts/mac-setup.sh
source "$(dirname "$0")/lib.sh"

bold "1/6  Omgeving controleren"
[ "$(uname)" = "Darwin" ] || echo "Let op: dit script is bedoeld voor macOS; het werkt ook elders, maar lokale iOS-builds kunnen alleen op een Mac."
check_node
if [ ! -f .env ]; then
  cp .env.example .env
  die "Ik heb mobile/.env aangemaakt. Zet daarin EXPO_PUBLIC_API_URL en start dit script opnieuw."
fi
load_env
green "✓ Node $(node -v), server-URL $EXPO_PUBLIC_API_URL"

bold "2/6  Dependencies installeren"
npm ci

bold "3/6  App controleren (typecheck, tests, expo-doctor)"
npm run typecheck
npm test
npx expo-doctor

bold "4/6  Inloggen bij Expo"
if ! eas whoami >/dev/null 2>&1; then eas login; fi
green "✓ Ingelogd als $(eas whoami)"

bold "5/6  EAS-project"
if [ -z "${EAS_PROJECT_ID:-}" ]; then
  echo "Er is nog geen EAS_PROJECT_ID. Ik maak het project nu aan (beantwoord de vragen van EAS)."
  eas init
  echo
  read -r -p "Plak hier de project-ID die EAS net toonde (UUID): " pid
  [[ "$pid" =~ ^[0-9a-fA-F-]{36}$ ]] || die "Dat lijkt geen project-ID (UUID)."
  if grep -q '^EAS_PROJECT_ID=' .env; then sed -i.bak "s|^EAS_PROJECT_ID=.*|EAS_PROJECT_ID=$pid|" .env && rm -f .env.bak; else echo "EAS_PROJECT_ID=$pid" >> .env; fi
  export EAS_PROJECT_ID="$pid"
fi
green "✓ EAS_PROJECT_ID=$EAS_PROJECT_ID"

bold "6/6  Variabelen voor de cloud-build in EAS zetten"
for name in EXPO_PUBLIC_API_URL EAS_PROJECT_ID; do
  value="${!name}"
  eas env:create --name "$name" --value "$value" --environment production --environment preview \
    --visibility plaintext --non-interactive --force >/dev/null 2>&1 \
    && green "✓ $name ingesteld in EAS" \
    || echo "  (kon $name niet automatisch zetten; zet hem met: npx eas-cli env:create)"
done

echo
green "Klaar. Volgende stappen:"
echo "  ./scripts/build.sh preview ios       # testbuild voor je iPhone (TestFlight/ad hoc)"
echo "  ./scripts/build.sh preview android   # APK om direct te installeren"
echo "  ./scripts/build.sh production all --submit   # store-versie bouwen en indienen"
echo "Apple/Google-accounts koppelen: zie 'Bouwen op je MacBook' in mobile/README.md."
