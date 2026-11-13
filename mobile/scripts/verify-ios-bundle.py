#!/usr/bin/env python3
"""Identical fail-closed Distribution gates for both archive and exported IPA.
No certificate names, profile contents or private signing diagnostics are logged.
"""
import argparse
import os
import plistlib
import subprocess
import sys
import hashlib
import tempfile
from pathlib import Path
from ios_signing_policy import distribution_errors, profile_errors


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


def check_distribution(ent, profile, authorities, team_identifier, expected_team=None):
    return distribution_errors(ent, profile, authorities, team_identifier, expected_team)


def load_plist_from_file(path):
    with open(path, "rb") as f:
        return plistlib.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["archive", "ipa"], required=True)
    ap.add_argument("--app", required=True)
    ap.add_argument("--certificate-sha1", required=True)
    ap.add_argument("--bundle-id", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--build", required=True)
    ap.add_argument("--team-id", default=os.environ.get("IOS_TEAM_ID", ""))
    a = ap.parse_args()

    failures = []
    if run(["codesign", "--verify", "--deep", "--strict", a.app]).returncode:
        failures.append("Handtekeningcontrole mislukt.")
    info = load_plist_from_file(os.path.join(a.app, "Info.plist"))
    if info.get("CFBundleIdentifier") != a.bundle_id:
        failures.append("Bundle-ID wijkt af.")
    if info.get("CFBundleShortVersionString") != a.version:
        failures.append("Versie wijkt af.")
    if info.get("CFBundleVersion") != a.build:
        failures.append("Buildnummer wijkt af.")
    if not os.path.isfile(os.path.join(a.app, "PrivacyInfo.xcprivacy")):
        failures.append("PrivacyInfo.xcprivacy ontbreekt in de app.")

    r = run(["codesign", "-d", "--entitlements", ":-", a.app])
    try:
        ent = plistlib.loads(r.stdout)
        if r.returncode or not isinstance(ent, dict):
            raise ValueError()
    except Exception:
        ent = {}
        failures.append("Entitlements zijn niet uit de handtekening te lezen (codesign gaf geen geldige plist).")
    r2 = run(["codesign", "-dvv", a.app])
    authorities, team_identifier, identifier = parse_authorities(r2.stderr.decode("utf-8", "replace"))
    if r2.returncode or identifier != a.bundle_id:
        failures.append("Codehandtekening heeft geen overeenkomende appidentiteit.")

    profile = None
    prof_path = os.path.join(a.app, "embedded.mobileprovision")
    if os.path.isfile(prof_path):
        r3 = run(["security", "cms", "-D", "-i", prof_path])
        try:
            profile = plistlib.loads(r3.stdout)
            if r3.returncode:
                raise ValueError()
        except Exception:
            failures.append("Het ingebedde provisioningprofiel is niet te decoderen.")

    failures += distribution_errors(ent, profile, authorities, team_identifier, a.team_id, a.bundle_id)
    with tempfile.TemporaryDirectory() as directory:
        prefix = str(Path(directory) / "certificate-")
        result = run(["codesign", "-d", "--extract-certificates", prefix, a.app])
        leaf = Path(prefix + "0")
        if result.returncode or not leaf.is_file():
            failures.append("Ondertekeningscertificaat niet te controleren.")
        else:
            certificate = leaf.read_bytes()
            if hashlib.sha1(certificate).hexdigest().upper() != a.certificate_sha1.upper():
                failures.append("Ondertekeningscertificaat wijkt af van geselecteerde Distribution-identiteit.")
            failures += profile_errors(profile, a.team_id, a.bundle_id, certificate)

    if failures:
        for f in failures:
            print("::error::%s" % f)
        sys.exit(1)
    print("Controle '%s' geslaagd." % a.stage)


if __name__ == "__main__":
    main()
