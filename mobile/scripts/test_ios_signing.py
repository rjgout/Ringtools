import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

import yaml
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12, PrivateFormat
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

import ios_distribution as driver
from ios_signing_policy import BUNDLE_ID, archive_command, export_options, material_digest, profile_errors, distribution_errors
from signing_fixtures import TEAM, profile, entitlements

ROOT = Path(__file__).resolve().parents[2]
STATE = {'team': TEAM, 'certificate_sha1': 'A' * 40, 'profile_uuid': profile()['UUID']}


def p12_fixture(password=b'synthetic-only', cn='Apple Distribution: SYNTHETIC', team=TEAM, expired=False, private=True):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn), x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, team)])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=2))
            .not_valid_after(now + timedelta(days=-1 if expired else 2))
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CODE_SIGNING]), critical=False).sign(key, hashes.SHA256()))
    encryption = (PrivateFormat.PKCS12.encryption_builder().kdf_rounds(20000)
                  .key_cert_algorithm(pkcs12.PBES.PBESv2SHA256AndAES256CBC).hmac_hash(hashes.SHA256()).build(password))
    return pkcs12.serialize_key_and_certificates(b'SYNTHETIC ONLY', key if private else None, cert, None, encryption), cert.public_bytes(serialization.Encoding.DER)


class PolicyTests(unittest.TestCase):
    def test_app_store_profile(self):
        self.assertEqual(profile_errors(profile(), TEAM), [])
        self.assertEqual(distribution_errors(entitlements(), profile(), ['Apple Distribution: SYNTHETIC'], TEAM, TEAM), [])

    def test_profile_rejections(self):
        for changes in [dict(ProvisionedDevices=[]), dict(ProvisionedDevices=['synthetic']), dict(ProvisionsAllDevices=True),
                        dict(ExpirationDate=datetime.now() - timedelta(days=1)), dict(CreationDate=datetime.now() + timedelta(days=1)),
                        dict(ExpirationDate=None), dict(UUID='../bad'), dict(Platform=['macOS']), dict(TeamIdentifier=['OTHERTEAM1']),
                        dict(DeveloperCertificates=[]), dict(ApplicationIdentifierPrefix=[]), dict(Entitlements={})]:
            with self.subTest(changes=changes):
                p = profile(); p.update(changes)
                self.assertTrue(profile_errors(p, TEAM))
        for key, value in [('get-task-allow', True), ('get-task-allow', 'false'), ('beta-reports-active', False),
                           ('aps-environment', 'development'), ('application-identifier', 'OLDPREFIX1.*'),
                           ('com.apple.developer.team-identifier', 'OTHERTEAM1'), ('com.apple.developer.associated-domains', [])]:
            with self.subTest(key=key, value=value):
                p = profile(); p['Entitlements'][key] = value
                self.assertTrue(profile_errors(p, TEAM))
        self.assertTrue(profile_errors(profile(), TEAM, certificate=b'wrong-cert'))
        self.assertTrue(profile_errors(None, TEAM))
        self.assertTrue(profile_errors(profile(), ''))

    def test_profile_associated_domains_wildcard_is_valid_not_app_wildcard(self):
        p = profile(); p['Entitlements']['com.apple.developer.associated-domains'] = ['*']
        self.assertEqual(profile_errors(p, TEAM), [])
        ent = entitlements(); ent['com.apple.developer.associated-domains'] = ['*']
        self.assertTrue(distribution_errors(ent, p, ['Apple Distribution: SYNTHETIC'], TEAM, TEAM))

    def test_missing_or_wrong_signature_team_and_app_identity(self):
        for team in [None, '', 'OTHERTEAM1']:
            self.assertTrue(distribution_errors(entitlements(), profile(), ['Apple Distribution: SYNTHETIC'], team, TEAM))
        for key in ['application-identifier', 'com.apple.developer.team-identifier']:
            ent = entitlements(); del ent[key]
            self.assertTrue(distribution_errors(ent, profile(), ['Apple Distribution: SYNTHETIC'], TEAM, TEAM))

    def test_commands_pin_distribution_without_provisioning_capability(self):
        cmd = archive_command(STATE, Path('/tmp/synthetic'), '1.0.0', '42')
        self.assertIn('CODE_SIGN_STYLE=Manual', cmd)
        self.assertIn('CODE_SIGN_IDENTITY=' + STATE['certificate_sha1'], cmd)
        self.assertIn('RINGTOOLS_DISTRIBUTION_PROFILE_UUID=' + STATE['profile_uuid'], cmd)
        self.assertFalse(any(c.startswith('PROVISIONING_PROFILE_SPECIFIER=') or c.startswith('PRODUCT_BUNDLE_IDENTIFIER=') for c in cmd))
        self.assertNotRegex(' '.join(cmd), r'allowProvisioning|authenticationKey|Apple Development|Automatic')
        opts = export_options(STATE)
        self.assertEqual(opts['signingStyle'], 'manual')
        self.assertEqual(opts['signingCertificate'], STATE['certificate_sha1'])
        self.assertEqual(opts['provisioningProfiles'], {BUNDLE_ID: STATE['profile_uuid']})
        self.assertEqual(opts['method'], 'app-store-connect')
        self.assertFalse(opts['manageAppVersionAndBuildNumber'])
        self.assertEqual(plistlib.loads(plistlib.dumps(opts)), opts)

    def test_material_digest_binds_both_encrypted_files(self):
        self.assertNotEqual(material_digest(b'a', b'b'), material_digest(b'ab', b''))
        self.assertNotEqual(material_digest(b'a', b'b'), material_digest(b'a', b'c'))


class MaterialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p12, cls.der = p12_fixture()

    def test_aes256_sha256_synthetic_p12(self):
        der, sha = driver.certificate_info(self.p12, 'synthetic-only', TEAM)
        self.assertEqual(der, self.der)
        self.assertRegex(sha, r'^[A-F0-9]{40}$')

    def test_wrong_password_and_team(self):
        for password, team in [('wrong-secret-never-log', TEAM), ('synthetic-only', 'OTHERTEAM1')]:
            with self.assertRaises(driver.SigningError) as error:
                driver.certificate_info(self.p12, password, team)
            self.assertNotIn(password, str(error.exception))
        with self.assertRaises(driver.SigningError):
            driver.certificate_info(b'invalid', 'synthetic-only', TEAM)

    def test_development_expired_and_certificate_without_private_key(self):
        for kwargs in [dict(cn='Apple Development: SYNTHETIC'), dict(expired=True), dict(private=False)]:
            p12, _ = p12_fixture(**kwargs)
            with self.assertRaises(driver.SigningError):
                driver.certificate_info(p12, 'synthetic-only', TEAM)

    def test_missing_and_invalid_base64_fail_before_native_commands(self):
        for env in [{}, {'IOS_DISTRIBUTION_P12_BASE64': '!invalid!'}, {'IOS_DISTRIBUTION_P12_BASE64': 'AA=='}]:
            with patch.dict(os.environ, env, clear=True), patch.object(driver, 'run') as run:
                with self.assertRaises(driver.SigningError):
                    driver.prepare(Path('/not-created'))
                run.assert_not_called()

    def test_sensitive_subprocess_errors_are_sanitized(self):
        result = subprocess.CompletedProcess([], 1, b'PRIVATE SECRET', b'PASSWORD CERT NAME')
        with patch.object(driver.subprocess, 'run', return_value=result):
            with self.assertRaises(driver.SigningError) as error:
                driver.run(['security', 'synthetic'], 'Import')
        self.assertNotRegex(str(error.exception), 'PRIVATE|PASSWORD|CERT NAME')

    def test_attestation_mismatch_before_native_import(self):
        env = {'IOS_DISTRIBUTION_P12_BASE64': base64.b64encode(self.p12).decode(),
               'IOS_PROVISIONING_PROFILE_BASE64': base64.b64encode(b'profile').decode(),
               'IOS_DISTRIBUTION_P12_PASSWORD': 'synthetic-only', 'IOS_TEAM_ID': TEAM, 'GITHUB_SHA': 'synthetic'}
        with patch.dict(os.environ, env, clear=True), patch.object(driver, 'run') as run:
            with self.assertRaises(driver.SigningError):
                driver.prepare(Path('/not-created'), {'commit': 'synthetic', 'material_sha256': 'wrong'})
            run.assert_not_called()

    def test_import_then_cleanup_restores_own_profiles_and_search_list_on_every_failure(self):
        env = {'IOS_DISTRIBUTION_P12_BASE64': base64.b64encode(self.p12).decode(),
               'IOS_PROVISIONING_PROFILE_BASE64': base64.b64encode(b'CMS-synthetic').decode(),
               'IOS_DISTRIBUTION_P12_PASSWORD': 'synthetic-only', 'IOS_TEAM_ID': TEAM}
        # Inject errors at every native command, including before/after import.
        for failure in range(0, 10):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); work = root / 'work'; home = root / 'home'
                legacy = home / 'Library/MobileDevice/Provisioning Profiles'
                legacy.mkdir(parents=True)
                old = legacy / (profile()['UUID'] + '.mobileprovision'); old.write_bytes(b'old-profile'); old.chmod(0o640)
                other = legacy / 'other.mobileprovision'; other.write_bytes(b'unrelated')
                calls = []
                def native(args, label, **kwargs):
                    calls.append(args)
                    if len(calls) == failure + 1:
                        raise driver.SigningError('Synthetic injected failure')
                    if args[1:3] == ['cms', '-D']:
                        return plistlib.dumps(profile(self.der))
                    if args[1:3] == ['list-keychains', '-d'] and '-s' not in args:
                        return b'"/synthetic/login.keychain-db"\n'
                    if args[1] == 'create-keychain':
                        (work / 'signing.keychain-db').touch()
                    if args[1] == 'find-identity':
                        return driver.certificate_info(self.p12, 'synthetic-only', TEAM)[1].encode()
                    return b''
                with patch.dict(os.environ, env), patch.object(Path, 'home', return_value=home), patch.object(driver, 'run', side_effect=native):
                    try:
                        driver.prepare(work)
                    except driver.SigningError:
                        pass
                    try:
                        driver.cleanup(work)
                    except driver.SigningError:
                        # Retry cleanup after a restoration error; journal remains available.
                        driver.cleanup(work)
                self.assertFalse(work.exists())
                self.assertEqual(old.read_bytes(), b'old-profile')
                self.assertEqual(old.stat().st_mode & 0o777, 0o640)
                self.assertEqual(other.read_bytes(), b'unrelated')
                if any('create-keychain' in call for call in calls):
                    self.assertTrue(any(call[-1] == '/synthetic/login.keychain-db' and '-s' in call for call in calls))

    def test_no_real_build_without_separate_authorization(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(driver, 'run') as run:
            with self.assertRaises(driver.SigningError):
                driver.build(Path('/not-present'))
            with self.assertRaises(driver.SigningError):
                driver.upload(Path('/not-present'))
            run.assert_not_called()


class ArchitectureTests(unittest.TestCase):
    def load(self, name):
        return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)

    def test_manual_workflows_isolated_from_prs(self):
        for name in ['ios-testflight.yml', 'ios-signing-import-check.yml']:
            flow = self.load(name)
            self.assertEqual(list(flow['on']), ['workflow_dispatch'])
            job = next(iter(flow['jobs'].values()))
            self.assertEqual(job['environment'], 'testflight')
            for required in ["github.repository == 'rjgout/Ringtools'", "github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'"]:
                self.assertIn(required, job['if'])
            self.assertEqual(flow['concurrency']['group'], 'ringtools-ios-signing')
            self.assertEqual(flow['concurrency']['cancel-in-progress'], 'false')
            clean = [step for step in job['steps'] if step.get('run', '').endswith('ios_distribution.py cleanup')]
            self.assertEqual(len(clean), 1)
            self.assertEqual(clean[0]['if'], 'always()')
        for name in ['mobile-ci.yml', 'ios-signing-tests.yml']:
            text = (ROOT / '.github/workflows' / name).read_text()
            self.assertNotRegex(text, r'secrets\.(IOS_DISTRIBUTION|IOS_PROVISIONING|ASC_)|environment:\s*testflight')

    def test_secrets_only_scoped_to_necessary_steps(self):
        flow = self.load('ios-testflight.yml')
        inputs = flow['on']['workflow_dispatch']['inputs']
        self.assertEqual(inputs['upload']['default'], 'false')
        self.assertEqual(inputs['signing_authorized']['default'], 'false')
        job = flow['jobs']['testflight']
        self.assertNotIn('ASC_', json.dumps(job.get('env', {})))
        for step in job['steps']:
            if 'ASC_' in json.dumps(step):
                self.assertEqual(step['run'], 'python3 scripts/ios_distribution.py upload')
                self.assertEqual(step['if'], '${{ inputs.upload }}')
        imp = self.load('ios-signing-import-check.yml')
        self.assertEqual(imp['on']['workflow_dispatch']['inputs']['import_authorized']['default'], 'false')
        self.assertNotRegex(json.dumps(imp), r'ASC_|xcodebuild|altool|ios_distribution.py (build|upload)')
        artifact = next(s for s in imp['jobs']['import-check']['steps'] if 'upload-artifact' in s.get('uses', ''))
        self.assertEqual(artifact['with']['path'], '${{ runner.temp }}/ringtools-import-report/import-check.json')

    def test_no_automatic_signing_in_distribution_paths(self):
        for path in ['.github/workflows/ios-testflight.yml', '.github/workflows/ios-signing-import-check.yml',
                     'mobile/scripts/ios_distribution.py', 'mobile/scripts/ios_signing_policy.py']:
            self.assertNotRegex((ROOT / path).read_text(), r'allowProvisioning|authenticationKey|Apple Development|signingStyle[^\n]*automatic')
        project = (ROOT / 'mobile/ios/App/App.xcodeproj/project.pbxproj').read_text()
        for ident in ['504EC3151FED79650016851F', '504EC3181FED79650016851F']:
            block = project.split(ident + ' /* Release */ = {')[1].split('\n\t\t};')[0]
            self.assertIn('CODE_SIGN_STYLE = Manual;', block)
            self.assertIn('CODE_SIGN_IDENTITY = "Apple Distribution";', block)
        for ident in ['504EC3171FED79650016851F', 'A11CE00000000000000000A2']:
            block = project.split(ident + ' /* ')[1].split('\n\t\t};')[0]
            self.assertIn('CODE_SIGN_STYLE = Automatic;', block)

    def test_release_apns_is_explicitly_production_without_changing_debug(self):
        app = ROOT / 'mobile/ios/App/App'
        debug = plistlib.loads((app / 'App.entitlements').read_bytes())
        release = plistlib.loads((app / 'App-Store.entitlements').read_bytes())
        self.assertEqual(debug['aps-environment'], 'development')
        self.assertEqual(release['aps-environment'], 'production')
        self.assertEqual(debug['com.apple.developer.associated-domains'], release['com.apple.developer.associated-domains'])
        project = (app.parent / 'App.xcodeproj/project.pbxproj').read_text()
        block = project.split('504EC3181FED79650016851F /* Release */ = {')[1].split('\n\t\t};')[0]
        self.assertIn('CODE_SIGN_ENTITLEMENTS = App/App-Store.entitlements;', block)
        self.assertIn('PROVISIONING_PROFILE_SPECIFIER = "$(RINGTOOLS_DISTRIBUTION_PROFILE_UUID)";', block)

    def test_both_stages_have_same_distribution_gates(self):
        verifier = (ROOT / 'mobile/scripts/verify-ios-bundle.py').read_text()
        self.assertNotIn('if a.stage ==', verifier)
        for guard in ['distribution_errors(', 'profile_errors(', '"--verify", "--deep", "--strict"', 'certificate_sha1', 'PrivacyInfo.xcprivacy']:
            self.assertIn(guard, verifier)

    def test_failed_or_stale_import_run_is_rejected(self):
        for result in [dict(event='push'), dict(event='workflow_dispatch', conclusion='failure'),
                       dict(event='workflow_dispatch', conclusion='success', head_sha='wrong')]:
            with patch.dict(os.environ, {'GITHUB_SHA': 'synthetic'}), patch.object(driver, 'run', return_value=json.dumps(result).encode()) as run:
                with self.assertRaises(driver.SigningError):
                    driver.check_attestation('123', Path('/never-created'))
                self.assertEqual(run.call_count, 1)


@unittest.skipUnless(sys.platform == 'darwin', 'macOS keychain API unavailable; Linux tests cover P12 parsing and fail-closed policy')
class MacSyntheticImportTests(unittest.TestCase):
    def test_aes256_sha256_ephemeral_self_signed_import_only(self):
        # No Apple identity, provisioning, signing, account or API contact.
        p12, _ = p12_fixture(cn='SYNTHETIC KEYCHAIN COMPATIBILITY ONLY')
        with tempfile.TemporaryDirectory(prefix='ringtools-synthetic-') as directory:
            root = Path(directory); p12_file = root / 'synthetic.p12'; keychain = root / 'synthetic.keychain-db'
            driver.private_file(p12_file, p12)
            password = uuid.uuid4().hex
            try:
                driver.run(['security', 'create-keychain', '-p', password, str(keychain)], 'Synthetic keychain creation')
                driver.run(['security', 'unlock-keychain', '-p', password, str(keychain)], 'Synthetic keychain unlock')
                try:
                    driver.import_p12(p12_file, 'synthetic-only', keychain)
                    print('SYNTHETIC AES256-SHA256 macOS import: accepted. Owner P12 compatibility remains unverified.')
                except driver.SigningError as error:
                    self.assertIn('PKCS#12-import', str(error))
                    self.assertNotIn('synthetic-only', str(error))
                    print('SYNTHETIC AES256-SHA256 macOS import: rejected safely. Owner import remains blocked pending separate check.')
            finally:
                if keychain.exists():
                    driver.run(['security', 'delete-keychain', str(keychain)], 'Synthetic cleanup')
            self.assertFalse(keychain.exists())


if __name__ == '__main__':
    unittest.main()
