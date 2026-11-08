import importlib.util, plistlib, unittest, os
spec = importlib.util.spec_from_file_location("v", os.path.join(os.path.dirname(__file__), "verify-ios-bundle.py"))
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)

GOOD_ENT = {"aps-environment": "production", "beta-reports-active": True,
            "com.apple.developer.associated-domains": ["applinks:ringapeldoorn.nl", "webcredentials:ringapeldoorn.nl"]}
GOOD_PROFILE = {"Name": "x", "Entitlements": {"aps-environment": "production"}}
AUTH = ["Apple Distribution: X (ABC)", "Apple Worldwide Developer Relations Certification Authority", "Apple Root CA"]

class T(unittest.TestCase):
    def test_distribution_ok(self):
        self.assertEqual(v.check_distribution(GOOD_ENT, GOOD_PROFILE, AUTH, "ABC", "ABC"), [])

    def test_beta_reports_true_is_not_get_task_allow(self):
        # Regressie: een App Store-profiel heeft beta-reports-active=<true/>; dat mag nooit als get-task-allow tellen.
        xml = plistlib.dumps(GOOD_ENT)
        self.assertEqual(v.check_distribution(plistlib.loads(xml), GOOD_PROFILE, AUTH, "ABC"), [])

    def test_get_task_allow_detected(self):
        e = dict(GOOD_ENT, **{"get-task-allow": True})
        self.assertTrue(any("get-task-allow" in x for x in v.check_distribution(e, GOOD_PROFILE, AUTH, "ABC")))

    def test_development_signing_detected(self):
        errs = v.check_distribution(GOOD_ENT, GOOD_PROFILE, ["Apple Development: Created via API (X)"], "ABC")
        self.assertTrue(any("Apple Distribution" in x for x in errs))

    def test_device_list_profile_detected(self):
        p = dict(GOOD_PROFILE, ProvisionedDevices=["udid"])
        self.assertTrue(any("apparatenlijst" in x for x in v.check_distribution(GOOD_ENT, p, AUTH, "ABC")))

    def test_sandbox_apns_and_missing_domain(self):
        e = dict(GOOD_ENT, **{"aps-environment": "development", "com.apple.developer.associated-domains": ["applinks:ringapeldoorn.nl"]})
        errs = v.check_distribution(e, GOOD_PROFILE, AUTH, "ABC")
        self.assertEqual(len(errs), 2)

    def test_parse_authorities(self):
        out = "Identifier=nl.x\nAuthority=Apple Distribution: X\nAuthority=Apple Root CA\nTeamIdentifier=ABC\n"
        self.assertEqual(v.parse_authorities(out), (["Apple Distribution: X", "Apple Root CA"], "ABC", "nl.x"))

if __name__ == "__main__":
    unittest.main()
