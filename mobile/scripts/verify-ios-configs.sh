#!/usr/bin/env bash
# Controleert op macOS (xcodebuild) dat de iOS-configuraties zich gedragen zoals bedoeld, zonder signing:
#   Debug / Release     → productie-entitlements (aps-environment + applinks), buildprofiel "standard"
#   Debug-PersonalTeam  → GEEN entitlements (geen push, geen Associated Domains), buildprofiel "personal-team"
# Bouwt elk voor de simulator en inspecteert de effectieve entitlements (.xcent) en het buildprofiel in de app-bundel.
set -euo pipefail
cd "$(dirname "$0")/../ios"
PROJECT=App/App.xcodeproj
fail() { echo "FOUT: $*" >&2; exit 1; }

settings() { xcodebuild -project "$PROJECT" -scheme "$1" -configuration "$2" -sdk iphonesimulator -showBuildSettings 2>/dev/null; }

echo "== Build settings =="
for cfg in Debug Release; do
  s="$(settings App "$cfg")"
  echo "$s" | grep -qE '^\s*CODE_SIGN_ENTITLEMENTS = App/App.entitlements$' || fail "$cfg: productie-entitlements ontbreken"
  echo "$s" | grep -qE '^\s*PRODUCT_BUNDLE_IDENTIFIER = nl\.ringapeldoorn\.ringtools$' || fail "$cfg: onverwachte bundle-ID"
  echo "ok  $cfg"
done
s="$(settings App-PersonalTeam Debug-PersonalTeam)"
echo "$s" | grep -qE '^\s*CODE_SIGN_ENTITLEMENTS =\s*$' || fail "Debug-PersonalTeam: CODE_SIGN_ENTITLEMENTS moet leeg zijn"
echo "$s" | grep -qE '^\s*RINGTOOLS_BUILD_PROFILE = personal-team$' || fail "Debug-PersonalTeam: buildprofiel ontbreekt"
echo "$s" | grep -qE '^\s*PRODUCT_BUNDLE_IDENTIFIER = nl\.ringapeldoorn\.ringtools\.dev$' || fail "Debug-PersonalTeam: onverwachte bundle-ID"
echo "ok  Debug-PersonalTeam"

build_and_inspect() { # scheme config expect(standard|personal-team)
  local scheme="$1" cfg="$2" expect="$3" dd="$PWD/../build/dd-$2"
  rm -rf "$dd"
  xcodebuild -project "$PROJECT" -scheme "$scheme" -configuration "$cfg" -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" CODE_SIGNING_ALLOWED=NO build >/dev/null
  local app; app="$(find "$dd/Build/Products" -name 'App.app' -maxdepth 3 | head -1)"
  [ -n "$app" ] || fail "$cfg: App.app niet gevonden"
  grep -q "profile:\"$expect\"" "$app/public/ringtools-build.js" || fail "$cfg: buildprofiel in de bundel is niet '$expect' ($(cat "$app/public/ringtools-build.js" 2>/dev/null))"
  local xcent; xcent="$(find "$dd/Build/Intermediates.noindex" -name '*.xcent' | head -1 || true)"
  if [ "$expect" = standard ]; then
    [ -n "$xcent" ] || fail "$cfg: geen .xcent gevonden om de entitlements te controleren"
    grep -q 'aps-environment' "$xcent" || fail "$cfg: aps-environment ontbreekt in de effectieve entitlements"
    grep -q 'com.apple.developer.associated-domains' "$xcent" || fail "$cfg: associated-domains ontbreekt in de effectieve entitlements"
  else
    if [ -n "$xcent" ]; then
      ! grep -q 'aps-environment' "$xcent" || fail "$cfg: aps-environment staat in de effectieve entitlements"
      ! grep -q 'associated-domains' "$xcent" || fail "$cfg: associated-domains staat in de effectieve entitlements"
    fi
    # Ook de gebouwde binary mag de entitlements niet bevatten.
    local bin="$app/App"
    ! strings -a "$bin" | grep -q 'com.apple.developer.associated-domains' || fail "$cfg: associated-domains zit in de binary"
    ! strings -a "$bin" | grep -q 'aps-environment' || fail "$cfg: aps-environment zit in de binary"
  fi
  echo "ok  $cfg gebouwd (profiel $expect)"
}
echo "== Simulatorbuilds =="
build_and_inspect App Debug standard
build_and_inspect App-PersonalTeam Debug-PersonalTeam personal-team
echo "Alle iOS-configuratiecontroles geslaagd."
