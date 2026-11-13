import importlib.util, plistlib, unittest, os
import contextlib
import copy
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("v", os.path.join(os.path.dirname(__file__), "verify-ios-bundle.py"))
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)

from signing_fixtures import profile, entitlements, TEAM
GOOD_ENT = entitlements()
GOOD_PROFILE = profile()
AUTH = ["Apple Distribution: X (ABC)", "Apple Worldwide Developer Relations Certification Authority", "Apple Root CA"]

class T(unittest.TestCase):
    def test_distribution_ok(self):
        self.assertEqual(v.check_distribution(GOOD_ENT, GOOD_PROFILE, AUTH, TEAM, TEAM), [])

    def test_beta_reports_true_is_not_get_task_allow(self):
        # Regressie: een App Store-profiel heeft beta-reports-active=<true/>; dat mag nooit als get-task-allow tellen.
        xml = plistlib.dumps(GOOD_ENT)
        self.assertEqual(v.check_distribution(plistlib.loads(xml), GOOD_PROFILE, AUTH, TEAM, TEAM), [])

    def test_get_task_allow_detected(self):
        e = dict(GOOD_ENT, **{"get-task-allow": True})
        self.assertTrue(any("get-task-allow" in x for x in v.check_distribution(e, GOOD_PROFILE, AUTH, TEAM, TEAM)))

    def test_development_signing_detected(self):
        errs = v.check_distribution(GOOD_ENT, GOOD_PROFILE, ["Apple Development: Created via API (X)"], TEAM, TEAM)
        self.assertTrue(any("Apple Distribution" in x for x in errs))

    def test_device_list_profile_detected(self):
        p = dict(GOOD_PROFILE, ProvisionedDevices=["udid"])
        self.assertTrue(any("apparatenlijst" in x for x in v.check_distribution(GOOD_ENT, p, AUTH, TEAM, TEAM)))

    def test_sandbox_apns_and_missing_domain(self):
        e = dict(GOOD_ENT, **{"aps-environment": "development", "com.apple.developer.associated-domains": ["applinks:ringapeldoorn.nl"]})
        errs = v.check_distribution(e, GOOD_PROFILE, AUTH, TEAM, TEAM)
        self.assertEqual(len(errs), 2)

    def test_parse_authorities(self):
        out = "Identifier=nl.x\nAuthority=Apple Distribution: X\nAuthority=Apple Root CA\nTeamIdentifier=ABC\n"
        self.assertEqual(v.parse_authorities(out), (["Apple Distribution: X", "Apple Root CA"], "ABC", "nl.x"))

class BundleStageTests(unittest.TestCase):
    def check_stage(self, stage, mutation=None):
        ent, prof = copy.deepcopy(GOOD_ENT), copy.deepcopy(GOOD_PROFILE)
        info = {"CFBundleIdentifier": "nl.ringapeldoorn.ringtools", "CFBundleShortVersionString": "1.0.0", "CFBundleVersion": "42"}
        authority_team = TEAM
        signature_valid = True
        if mutation == "signature":
            signature_valid = False
        elif mutation == "team":
            authority_team = "OTHERTEAM1"
        elif mutation in ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]:
            info[mutation] = "wrong"
        elif mutation == "cert":
            prof["DeveloperCertificates"] = [b"wrong-certificate"]
        elif mutation == "development":
            ent["get-task-allow"] = True
        elif mutation == "apns":
            ent["aps-environment"] = "development"
        elif mutation == "domains":
            ent["com.apple.developer.associated-domains"] = []
        elif mutation == "app-identity":
            ent["application-identifier"] = "OTHER.fake.app"
        elif mutation == "profile-kind":
            prof["ProvisionedDevices"] = []
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "App.app"; app.mkdir()
            (app / "Info.plist").write_bytes(plistlib.dumps(info))
            (app / "embedded.mobileprovision").touch()
            if mutation != "privacy":
                (app / "PrivacyInfo.xcprivacy").touch()
            def native(args):
                output, stderr, code = b"", b"", 0
                if "--verify" in args:
                    code = 0 if signature_valid else 1
                elif "--entitlements" in args:
                    output = plistlib.dumps(ent)
                elif "-dvv" in args:
                    stderr = ("Identifier=nl.ringapeldoorn.ringtools\nAuthority=Apple Distribution: SYNTHETIC\nTeamIdentifier=" + authority_team + "\n").encode()
                elif "cms" in args:
                    output = plistlib.dumps(prof)
                elif "--extract-certificates" in args:
                    Path(args[args.index("--extract-certificates") + 1] + "0").write_bytes(b"synthetic-certificate")
                else:
                    self.fail("Unexpected native operation")
                return subprocess.CompletedProcess(args, code, output, stderr)
            argv = ["verify", "--stage", stage, "--app", str(app), "--bundle-id", "nl.ringapeldoorn.ringtools", "--version", "1.0.0", "--build", "42", "--team-id", TEAM,
                    "--certificate-sha1", hashlib.sha1(b"synthetic-certificate").hexdigest()]
            with patch.object(sys, "argv", argv), patch.object(v, "run", side_effect=native), contextlib.redirect_stdout(io.StringIO()):
                if mutation:
                    with self.assertRaises(SystemExit) as error:
                        v.main()
                    self.assertEqual(error.exception.code, 1)
                else:
                    v.main()

    def test_archive_and_ipa_accept_distribution(self):
        for stage in ["archive", "ipa"]:
            with self.subTest(stage=stage):
                self.check_stage(stage)

    def test_archive_and_ipa_reject_same_invalid_materials(self):
        for stage in ["archive", "ipa"]:
            for mutation in ["signature", "team", "CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion", "cert", "development", "apns", "domains", "app-identity", "profile-kind", "privacy"]:
                with self.subTest(stage=stage, mutation=mutation):
                    self.check_stage(stage, mutation)

if __name__ == "__main__":
    unittest.main()
