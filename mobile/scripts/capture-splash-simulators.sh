#!/usr/bin/env bash
# Native UIKit-snapshots van het werkelijk gecompileerde launchstoryboard.
# Tijdelijke testhost: geen wijziging aan Ringtools, authenticatie of splash-hide.
set -euxo pipefail
if [[ "$(uname -s)" != Darwin ]]; then
  echo "iOS-simulators vereisen macOS met Xcode." >&2
  exit 1
fi
APP_PATH="${1:?Geef de gebouwde Debug-iphonesimulator/App.app op}"
OUTPUT="${2:?Geef de map voor screenshots op}"
mkdir -p "$OUTPUT"
HOST="$OUTPUT/SplashCapture.app"
mkdir -p "$HOST"
# Gebruik exact de door Xcode gecompileerde productieresources, geen nagetekende UI.
python3 - "$APP_PATH" "$HOST" <<'PY'
from pathlib import Path
import plistlib, shutil, sys
app, host = map(Path, sys.argv[1:])
info = plistlib.load(open(app / 'Info.plist', 'rb'))
storyboard = list(app.rglob('LaunchScreen.storyboardc'))
if len(storyboard) != 1:
    raise SystemExit('Exact één gecompileerd launchstoryboard vereist')
shutil.copytree(storyboard[0], host / 'LaunchScreen.storyboardc', dirs_exist_ok=True)
shutil.copy2(app / 'Assets.car', host / 'Assets.car')
metadata = {
    'CFBundleIdentifier': info['CFBundleIdentifier'] + '.splashcapture',
    'CFBundleExecutable': 'SplashCapture', 'CFBundleName': 'Ringtools Splash Capture',
    'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0',
    'CFBundleDevelopmentRegion': 'en', 'LSRequiresIPhoneOS': True,
    'CFBundleSupportedPlatforms': ['iPhoneSimulator'], 'MinimumOSVersion': '18.0',
    'UIDeviceFamily': info['UIDeviceFamily'], 'UILaunchStoryboardName': 'LaunchScreen',
    'UISupportedInterfaceOrientations': info['UISupportedInterfaceOrientations'],
    'UISupportedInterfaceOrientations~ipad': info['UISupportedInterfaceOrientations~ipad'],
}
plistlib.dump(metadata, open(host / 'Info.plist', 'wb'))
PY
cat > "$OUTPUT/main.swift" <<'SWIFT'
import UIKit
@MainActor
class SplashCaptureDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = UIStoryboard(name: "LaunchScreen", bundle: nil).instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()
        return true
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(SplashCaptureDelegate.self))
SWIFT
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
ARCH=$(uname -m)
xcrun swiftc -sdk "$SDK" -target "$ARCH-apple-ios18.0-simulator" "$OUTPUT/main.swift" -o "$HOST/SplashCapture"
# Simulator-only ad-hoc signing, zonder eigenaarcertificaten of store-upload.
codesign --force --sign - "$HOST"
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$HOST/Info.plist")
xcrun simctl list devices available --json > "$OUTPUT/devices.json"
python3 - "$OUTPUT/devices.json" > "$OUTPUT/selected.tsv" <<'PY'
import json, re, sys
runtimes = json.load(open(sys.argv[1]))['devices']
compatible = [(tuple(map(int, re.findall(r'\d+', runtime.split('iOS-')[-1]))), devices) for runtime, devices in runtimes.items() if 'iOS-' in runtime]
all_devices = [d for version, devices in sorted(compatible, reverse=True) if version >= (18,) for d in devices if d.get('isAvailable')]
for family in ('iPhone', 'iPad'):
    device = next((d for d in all_devices if d['name'].startswith(family)), None)
    if not device:
        raise SystemExit('Geen beschikbare ' + family + '-simulator vanaf iOS 18')
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
  xcrun simctl install "$DEVICE_ID" "$HOST"
  for APPEARANCE in light dark; do
    xcrun simctl ui "$DEVICE_ID" appearance "$APPEARANCE"
    xcrun simctl launch --terminate-running-process "$DEVICE_ID" "$BUNDLE_ID"
    # Laat UIKit en CoreAnimation tekenen. Geen aanpassing aan productiecode/timing.
    sleep 2
    for ATTEMPT in 1 2 3 4 5; do
      xcrun simctl io "$DEVICE_ID" screenshot "$OUTPUT/${FAMILY}-${APPEARANCE}.png"
      if node "$(dirname "$0")/verify-splash-screenshot.mjs" "$OUTPUT/${FAMILY}-${APPEARANCE}.png"; then break; fi
      if [[ "$ATTEMPT" == 5 ]]; then exit 1; fi
      sleep 2
    done
    xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_ID"
  done
  cleanup
  DEVICE_ID=""
done < "$OUTPUT/selected.tsv"
