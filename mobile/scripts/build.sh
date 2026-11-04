#!/usr/bin/env bash
# Bouwt de app met EAS.
# Gebruik:  ./scripts/build.sh <preview|production> [ios|android|all] [--submit] [--local]
#   --submit  na een productiebuild indienen bij TestFlight/Google Play
#   --local   op deze Mac bouwen i.p.v. in de EAS-cloud (iOS vereist Xcode; Android vereist Android SDK + JDK 17)
source "$(dirname "$0")/lib.sh"

profile="${1:-}"; platform="${2:-all}"; shift $(( $# > 1 ? 2 : $# )) || true
case "$profile" in preview|production) ;; *) die "Gebruik: $0 <preview|production> [ios|android|all] [--submit] [--local]" ;; esac
case "$platform" in ios|android|all) ;; *) die "Platform moet ios, android of all zijn." ;; esac
submit=0; local_build=0
for a in "$@"; do case "$a" in --submit) submit=1 ;; --local) local_build=1 ;; *) die "Onbekende optie $a" ;; esac; done
[ "$submit" -eq 0 ] || [ "$profile" = production ] || die "--submit kan alleen met het profiel production."
[ "$local_build" -eq 0 ] || [ "$platform" != all ] || die "Lokaal bouwen: kies ios of android (niet all)."

check_node
load_env
[ -n "${EAS_PROJECT_ID:-}" ] || die "EAS_PROJECT_ID ontbreekt in .env. Draai eerst ./scripts/mac-setup.sh."
eas whoami >/dev/null 2>&1 || eas login

[ -d node_modules ] || npm ci
npm run typecheck
npm test

bold "Bouwen: profiel=$profile platform=$platform$([ $local_build -eq 1 ] && echo ' (lokaal)')"
args=(build --platform "$platform" --profile "$profile")
if [ "$local_build" -eq 1 ]; then args+=(--local); fi
if [ "$submit" -eq 1 ] && [ "$local_build" -eq 0 ]; then args+=(--auto-submit); fi
eas "${args[@]}"
if [ "$submit" -eq 1 ] && [ "$local_build" -eq 1 ]; then
  eas submit --platform "$platform" --profile production --latest
fi
green "✓ Klaar. Resultaten staan op https://expo.dev (Builds)."
