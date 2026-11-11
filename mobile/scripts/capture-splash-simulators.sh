#!/usr/bin/env bash
# Alleen simulatorvalidatie: houdt vóór main() de echte iOS-launchscreen zichtbaar.
# Geen productiecode, authenticatie-aanpassing of netwerkverkeer vanuit de app.
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]]; then
  echo "iOS-simulators vereisen macOS met Xcode." >&2
  exit 1
fi
APP_PATH="${1:?Geef de gebouwde Debug-iphonesimulator/App.app op}"
OUTPUT="${2:?Geef de map voor screenshots op}"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")
mkdir -p "$OUTPUT"
xcrun simctl list devices available --json > "$OUTPUT/devices.json"
# Dezelfde native launchscreen op een echte iPhone- en iPad-simulator.
python3 - "$OUTPUT/devices.json" > "$OUTPUT/selected.tsv" <<'PY'
import json, sys
all_devices = [d for devices in json.load(open(sys.argv[1]))['devices'].values() for d in devices if d.get('isAvailable')]
for family in ('iPhone', 'iPad'):
    device = next((d for d in all_devices if d['name'].startswith(family)), None)
    if not device:
        raise SystemExit('Geen beschikbare ' + family + '-simulator')
    print(f"{family}\t{device['udid']}")
PY
DEVICE_ID=""
cleanup() {
  if [[ -n "$DEVICE_ID" ]]; then
    xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl shutdown "$DEVICE_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
while IFS=$'\t' read -r FAMILY DEVICE_ID; do
  xcrun simctl boot "$DEVICE_ID" || true
  xcrun simctl bootstatus "$DEVICE_ID" -b
  xcrun simctl status_bar "$DEVICE_ID" override --time '9:41' --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100
  xcrun simctl install "$DEVICE_ID" "$APP_PATH"
  for APPEARANCE in light dark; do
    xcrun simctl ui "$DEVICE_ID" appearance "$APPEARANCE"
    # SpringBoard toont de gecompileerde launchscreen terwijl het proces op de debugger wacht.
    xcrun simctl launch --terminate-running-process --wait-for-debugger "$DEVICE_ID" "$BUNDLE_ID"
    sleep 2
    xcrun simctl io "$DEVICE_ID" screenshot "$OUTPUT/${FAMILY}-${APPEARANCE}.png"
    xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_ID"
  done
  cleanup
  DEVICE_ID=""
done < "$OUTPUT/selected.tsv"
