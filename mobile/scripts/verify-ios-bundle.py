#!/usr/bin/env python3
"""Controleert een iOS-app (uit een .xcarchive of een uitgepakte .ipa) met echte plist-parsers.

Gebruik:  verify-ios-bundle.py --stage archive|ipa --app <pad naar .app> --bundle-id ID --version X --build N [--team-id ID]

- stage "archive": de archive wordt met automatische signing met een Apple Development-identiteit gemaakt (zo werkt Xcode);
  hier wordt alleen gerapporteerd én gecontroleerd op bundle-ID, versie, buildnummer en privacymanifest.
- stage "ipa": de geëxporteerde IPA moet een echte distributiebuild zijn (Apple Distribution, App Store-profiel zonder
  apparaatlijst, get-task-allow uit, productie-APNs, Associated Domains).

Er worden nooit certificaten, sleutels of profielinhoud geprint, alleen namen, UUID's en ja/nee-uitkomsten.
Zie docs/IOS-TESTFLIGHT.md. Het verwerken van de gegevens staat in losse functies zodat ze getest kunnen worden
(scripts/test_verify_ios_bundle.py).
"""
import argparse
import os
import plistlib
import re
import subprocess
import sys


def run(cmd):
    return subprocess.run(cmd, capture_output=True, check=False)


def parse_authorities(codesign_stderr):
    """Geeft (authorities, team_identifier, identifier) uit de uitvoer van `codesign -dvv`."""
    auth, team, ident = [], None, None
    for line in codesign_stderr.splitlines():
        if line.startswith("Authority="):
            auth.append(line.split("=", 1)[1].strip())
        elif line.startswith("TeamIdentifier="):
            team = line.split("=", 1)[1].strip()
        elif line.startswith("Identifier="):
            ident = line.split("=", 1)[1].strip()
    return auth, team, ident


def truthy(value):
    return value is True


def check_distribution(ent, profile, authorities, team_identifier, expected_team=None):
    """Geeft een lijst fouten voor een distributiebuild (leeg = in orde). Pure functie, getest."""
    errors = []
    if truthy(ent.get("get-task-allow")):
        errors.append("get-task-allow staat aan in de entitlements van de app (dit is een ontwikkelbuild).")
    if ent.get("aps-environment") != "production":
        errors.append("aps-environment is %r; TestFlight en de App Store vereisen 'production'." % ent.get("aps-environment"))
    domains = ent.get("com.apple.developer.associated-domains") or []
    for needed in ("applinks:ringapeldoorn.nl", "webcredentials:ringapeldoorn.nl"):
        if needed not in domains:
            errors.append("Associated Domains mist %s." % needed)
    if not authorities or not authorities[0].startswith("Apple Distribution"):
        errors.append("De app is niet met 'Apple Distribution' ondertekend (eerste autoriteit: %r)." % (authorities[0] if authorities else None))
    if profile is None:
        errors.append("Er is geen ingebed provisioningprofiel (embedded.mobileprovision).")
    else:
        pent = profile.get("Entitlements", {})
        if profile.get("ProvisionedDevices"):
            errors.append("Het profiel bevat een apparatenlijst (ProvisionedDevices): dat is een ad-hoc/ontwikkelprofiel, geen App Store-profiel.")
        if truthy(profile.get("ProvisionsAllDevices")):
            errors.append("Het profiel is een enterprise-profiel (ProvisionsAllDevices).")
        if truthy(pent.get("get-task-allow")):
            errors.append("Het profiel staat get-task-allow toe (ontwikkelprofiel).")
    if expected_team and team_identifier and team_identifier != expected_team:
        errors.append("TeamIdentifier van de handtekening wijkt af van het verwachte team.")
    return errors


def load_plist_from_file(path):
    with open(path, "rb") as f:
        return plistlib.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["archive", "ipa"], required=True)
    ap.add_argument("--app", required=True)
    ap.add_argument("--bundle-id", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--team-id", default=os.environ.get("IOS_TEAM_ID", ""))
    a = ap.parse_args()

    failures = []
    info = load_plist_from_file(os.path.join(a.app, "Info.plist"))
    if info.get("CFBundleIdentifier") != a.bundle_id:
        failures.append("Bundle-ID is %r, verwacht %r." % (info.get("CFBundleIdentifier"), a.bundle_id))
    if info.get("CFBundleShortVersionString") != a.version:
        failures.append("Versie is %r, verwacht %r." % (info.get("CFBundleShortVersionString"), a.version))
    if info.get("CFBundleVersion") != a.build:
        failures.append("Buildnummer is %r, verwacht %r." % (info.get("CFBundleVersion"), a.build))
    if not os.path.isfile(os.path.join(a.app, "PrivacyInfo.xcprivacy")):
        failures.append("PrivacyInfo.xcprivacy ontbreekt in de app.")

    r = run(["codesign", "-d", "--entitlements", ":-", a.app])
    try:
        ent = plistlib.loads(r.stdout)
    except Exception:
        ent = {}
        failures.append("Entitlements zijn niet uit de handtekening te lezen (codesign gaf geen geldige plist).")
    r2 = run(["codesign", "-dvv", a.app])
    authorities, team_identifier, identifier = parse_authorities(r2.stderr.decode("utf-8", "replace"))

    profile = None
    prof_path = os.path.join(a.app, "embedded.mobileprovision")
    if os.path.isfile(prof_path):
        r3 = run(["security", "cms", "-D", "-i", prof_path])
        try:
            profile = plistlib.loads(r3.stdout)
        except Exception:
            failures.append("Het ingebedde provisioningprofiel is niet te decoderen.")

    # Diagnostiek: alleen namen en ja/nee, nooit sleutels of certificaten.
    print("::group::Ondertekening (%s)" % a.stage)
    print("Identifier (codesign):      %s" % identifier)
    print("Handtekeningautoriteiten:   %s" % " > ".join(authorities) if authorities else "Handtekeningautoriteiten:   (geen)")
    print("Team in handtekening:       %s" % ("aanwezig" if team_identifier else "ontbreekt"))
    print("get-task-allow (app):       %s" % ent.get("get-task-allow", "afwezig"))
    print("aps-environment (app):      %s" % ent.get("aps-environment", "afwezig"))
    print("Associated Domains (app):   %s" % ", ".join(ent.get("com.apple.developer.associated-domains", []) or ["afwezig"]))
    if profile is not None:
        pe = profile.get("Entitlements", {})
        print("Profiel:                    %s (%s)" % (profile.get("Name"), profile.get("UUID")))
        print("Profiel, apparatenlijst:    %s" % ("JA (ontwikkel/ad-hoc)" if profile.get("ProvisionedDevices") else "nee (App Store)"))
        print("Profiel, get-task-allow:    %s" % pe.get("get-task-allow", "afwezig"))
        print("Profiel, aps-environment:   %s" % pe.get("aps-environment", "afwezig"))
        print("Profiel, verloopt:          %s" % profile.get("ExpirationDate"))
    else:
        print("Profiel:                    geen embedded.mobileprovision")
    print("::endgroup::")

    if a.stage == "ipa":
        failures += check_distribution(ent, profile, authorities, team_identifier, a.team_id or None)

    if failures:
        for f in failures:
            print("::error::%s" % f)
        if a.stage == "ipa":
            print("::error::Hint: de export moet de archive (Apple Development) opnieuw ondertekenen met Apple Distribution en een App Store-profiel. "
                  "Controleer dat de App Store Connect API-sleutel de rol Admin heeft, dat de export-opties 'signingCertificate' = 'Apple Distribution' bevatten "
                  "en dat het App ID de capabilities Push Notifications en Associated Domains heeft.")
        sys.exit(1)
    print("Controle '%s' geslaagd." % a.stage)


if __name__ == "__main__":
    main()
