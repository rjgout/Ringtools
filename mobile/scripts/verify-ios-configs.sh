#!/usr/bin/env bash
# Controleert op macOS (xcodebuild) dat de iOS-configuraties zich gedragen zoals bedoeld, zonder signing:
#   Debug / Release     → productie-entitlements (aps-environment + applinks + webcredentials), buildprofiel "standard"
#   Debug-PersonalTeam  → GEEN entitlements (geen push, geen Associated Domains), buildprofiel "personal-team"
# Bouwt elk voor de simulator en inspecteert de effectieve entitlements (.xcent) en het buildprofiel in de app-bundel.
# Let op: gebruik hier geen `echo "$x" | grep -q` (SIGPIPE + pipefail geeft willekeurige valse fouten); gebruik here-strings.
set -euo pipefail
cd "$(dirname "$0")/../ios"
PROJECT=App/App.xcodeproj
fail() { echo "FOUT: $*" >&2; exit 1; }

settings() { xcodebuild -project "$PROJECT" -scheme "$1" -configuration "$2" -sdk iphonesimulator -showBuildSettings 2>&1; }

echo "== Build settings =="
for cfg in Debug Release; do
  s="$(settings App "$cfg")"
  grep -qE '^\s*CODE_SIGN_ENTITLEMENTS = App/App.entitlements$' <<<"$s" || fail "$cfg: productie-entitlements ontbreken"
  grep -qE '^\s*PRODUCT_BUNDLE_IDENTIFIER = nl\.ringapeldoorn\.ringtools$' <<<"$s" || fail "$cfg: onverwachte bundle-ID"
  echo "ok  $cfg"
done
s="$(settings App-PersonalTeam Debug-PersonalTeam)"
value="$(echo "$s" | sed -n 's/^ *CODE_SIGN_ENTITLEMENTS = *//p' | tr -d '[:space:]')"
if [ -n "$value" ]; then grep -E 'CODE_SIGN_ENTITLEMENTS|RINGTOOLS_BUILD_PROFILE|PRODUCT_BUNDLE_IDENTIFIER' <<<"$s" >&2 || true; fail "Debug-PersonalTeam: CODE_SIGN_ENTITLEMENTS moet leeg zijn (nu: '$value')"; fi
grep -qE '^\s*RINGTOOLS_BUILD_PROFILE = personal-team$' <<<"$s" || { grep -E 'RINGTOOLS|CODE_SIGN' <<<"$s" >&2 || true; fail "Debug-PersonalTeam: buildprofiel ontbreekt"; }
grep -qE '^\s*PRODUCT_BUNDLE_IDENTIFIER = nl\.ringapeldoorn\.ringtools\.dev$' <<<"$s" || fail "Debug-PersonalTeam: onverwachte bundle-ID"
echo "ok  Debug-PersonalTeam"

build_and_inspect() { # scheme config expect(standard|personal-team)
  local scheme="$1" cfg="$2" expect="$3" dd="$PWD/../build/dd-$2"
  rm -rf "$dd"
  # Ad-hoc ondertekening ("-") voor de simulator: geen Apple-account nodig, maar de entitlements worden wél in de
  # handtekening vastgelegd, zodat we de EFFECTIEVE entitlements kunnen uitlezen.
  xcodebuild -project "$PROJECT" -scheme "$scheme" -configuration "$cfg" -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" \
    CODE_SIGN_IDENTITY="-" CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" build >/dev/null
  local app; app="$(find "$dd/Build/Products" -name 'App.app' -maxdepth 3 | head -1)"
  [ -n "$app" ] || fail "$cfg: App.app niet gevonden"
  grep -q "profile:\"$expect\"" "$app/public/ringtools-build.js" || fail "$cfg: buildprofiel in de bundel is niet '$expect' ($(cat "$app/public/ringtools-build.js" 2>/dev/null))"
  codesign -v "$app" 2>/dev/null || fail "$cfg: app is niet (ad-hoc) ondertekend; entitlements zijn dan niet te controleren"
  # Voor simulatorbuilds legt Xcode de entitlements vast in een .xcent-bestand en in de Mach-O-sectie __TEXT,__entitlements;
  # de handtekening zelf bevat ze niet altijd. Lees daarom alle drie de bronnen.
  local xcent; xcent="$(find "$dd/Build/Intermediates.noindex" -name '*.xcent' -exec cat {} + 2>/dev/null || true)"
  local ent; ent="$(codesign -d --entitlements :- "$app" 2>/dev/null || true)
$xcent
$(strings -a "$app/App" 2>/dev/null | grep -E 'aps-environment|associated-domains|applinks:' || true)"
  if [ "$expect" = standard ]; then
    grep -q 'aps-environment' <<<"$ent" || fail "$cfg: aps-environment ontbreekt in de effectieve entitlements"
    grep -q 'com.apple.developer.associated-domains' <<<"$ent" || fail "$cfg: associated-domains ontbreekt in de effectieve entitlements"
    grep -q 'applinks:ringapeldoorn.nl' <<<"$ent" || fail "$cfg: applinks-domein ontbreekt in de effectieve entitlements"
    grep -q 'webcredentials:ringapeldoorn.nl' <<<"$ent" || fail "$cfg: webcredentials-domein (native passkeys) ontbreekt in de effectieve entitlements"
  else
    ! grep -q 'aps-environment' <<<"$ent" || fail "$cfg: aps-environment staat in de effectieve entitlements"
    ! grep -q 'associated-domains' <<<"$ent" || fail "$cfg: associated-domains staat in de effectieve entitlements"
  fi
  echo "ok  $cfg gebouwd en gecontroleerd (profiel $expect; effectieve entitlements: $(grep -c '<key>' <<<"$ent") sleutel(s))"
}
echo "== Simulatorbuilds =="
build_and_inspect App Debug standard
build_and_inspect App-PersonalTeam Debug-PersonalTeam personal-team
echo "Alle iOS-configuratiecontroles geslaagd."
