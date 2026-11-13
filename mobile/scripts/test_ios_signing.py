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


def p12_fixture(password=b'synthetic-only', cn='Apple Distribution: SYNTHETIC', team=TEAM, expired=False, private=True, legacy=False):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn), x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, team)])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=2))
            .not_valid_after(now + timedelta(days=-1 if expired else 2))
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CODE_SIGNING]), critical=False).sign(key, hashes.SHA256()))
    encryption = (PrivateFormat.PKCS12.encryption_builder().kdf_rounds(20000)
                  .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC if legacy else pkcs12.PBES.PBESv2SHA256AndAES256CBC)
                  .hmac_hash(hashes.SHA1() if legacy else hashes.SHA256()).build(password))
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


class DevVariantPolicyTests(unittest.TestCase):
    """De dev-variant gebruikt dezelfde policy met eigen bundle-ID en link-host; productie blijft de standaard."""

    def run_policy(self, env, code):
        full = {**os.environ, **env}
        return subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).parent, env=full, capture_output=True, text=True)

    def test_defaults_are_production(self):
        env = {k: v for k, v in os.environ.items() if k not in ('IOS_BUNDLE_ID', 'IOS_LINK_HOST')}
        out = subprocess.run([sys.executable, '-c', 'import ios_signing_policy as p;print(p.BUNDLE_ID, p.DOMAINS)'], cwd=Path(__file__).parent, env=env, capture_output=True, text=True)
        self.assertEqual(out.stdout.strip(), "nl.ringapeldoorn.ringtools ('applinks:ringapeldoorn.nl', 'webcredentials:ringapeldoorn.nl')")

    def test_dev_values_drive_profile_and_export_checks(self):
        code = ("import ios_signing_policy as p;from signing_fixtures import *;"
                "print(p.BUNDLE_ID, p.profile_errors(profile(), TEAM), p.export_options({'team':TEAM,'certificate_sha1':'A'*40,'profile_uuid':profile()['UUID']})['provisioningProfiles'])")
        out = self.run_policy({'IOS_BUNDLE_ID': 'nl.ringapeldoorn.ringtools.dev', 'IOS_LINK_HOST': 'dev.ringapeldoorn.nl'}, code)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("nl.ringapeldoorn.ringtools.dev [] {'nl.ringapeldoorn.ringtools.dev': '11111111-2222-3333-4444-555555555555'}", out.stdout)

    def test_invalid_environment_values_are_rejected(self):
        for env in ({'IOS_BUNDLE_ID': 'nl.example;rm'}, {'IOS_LINK_HOST': 'bad host'}, {'IOS_BUNDLE_ID': 'x'}):
            with self.subTest(env=env):
                self.assertNotEqual(self.run_policy(env, 'import ios_signing_policy').returncode, 0)

    def test_profile_for_production_bundle_is_rejected_for_dev(self):
        code = ("import ios_signing_policy as p;from signing_fixtures import *;pr=profile();pr['Entitlements']['application-identifier']='OLDPREFIX1.nl.ringapeldoorn.ringtools';"
                "print(bool(p.profile_errors(pr, TEAM)))")
        out = self.run_policy({'IOS_BUNDLE_ID': 'nl.ringapeldoorn.ringtools.dev', 'IOS_LINK_HOST': 'dev.ringapeldoorn.nl'}, code)
        self.assertEqual(out.stdout.strip(), 'True')


class DevWorkflowTests(unittest.TestCase):
    def load(self):
        return yaml.load((ROOT / '.github/workflows/ios-testflight-dev.yml').read_text(), Loader=yaml.BaseLoader)

    def test_triggers_are_only_dev_tags_and_manual(self):
        on = self.load()['on']
        self.assertEqual(set(on), {'push', 'workflow_dispatch'})
        self.assertEqual(set(on['push']), {'tags'})
        self.assertTrue(all(t.startswith('ios-dev-') for t in on['push']['tags']))

    def test_no_automatic_provisioning_or_certificate_creation(self):
        text = (ROOT / '.github/workflows/ios-testflight-dev.yml').read_text()
        code = '\n'.join(l for l in text.splitlines() if not l.lstrip().startswith('#'))
        self.assertNotRegex(code, r'allowProvisioningUpdates|authenticationKeyPath|-authenticationKey|Apple Development|xcodebuild')
        self.assertIn('ios_distribution.py', text)

    def test_signing_secrets_only_in_the_signing_steps_and_asc_key_only_for_upload(self):
        steps = self.load()['jobs']['testflight']['steps']
        for step in steps:
            env = step.get('env', {})
            blob = str(env) + step.get('run', '')
            checking_names_only = step.get('name', '').startswith('Benodigde secrets aanwezig')
            if 'IOS_DISTRIBUTION_P12' in blob and not checking_names_only:
                self.assertRegex(step.get('run', ''), r'ios_distribution\.py (prepare|import-check)')
            if 'ASC_API_KEY_P8_BASE64' in blob and not checking_names_only:
                self.assertIn('ios_distribution.py upload', step.get('run', ''))
        job_env = str(self.load()['jobs']['testflight'].get('env', {}))
        self.assertNotRegex(job_env, r'secrets\.')

    def test_dev_identity_and_no_production_values(self):
        text = (ROOT / '.github/workflows/ios-testflight-dev.yml').read_text()
        self.assertIn('nl.ringapeldoorn.ringtools.dev', text)
        self.assertIn('dev.ringapeldoorn.nl', text)
        self.assertNotRegex(text, r'BUNDLE_ID: nl\.ringapeldoorn\.ringtools\n')
        self.assertNotIn('https://ringapeldoorn.nl', text)

    def test_cleanup_always_runs(self):
        steps = self.load()['jobs']['testflight']['steps']
        self.assertTrue(any(s.get('if') == 'always()' and 'ios_distribution.py cleanup' in s.get('run', '') for s in steps))

    def test_only_commits_on_develop_and_signing_never_in_pr_workflows(self):
        text = (ROOT / '.github/workflows/ios-testflight-dev.yml').read_text()
        self.assertIn('merge-base --is-ancestor', text)
        self.assertIn('origin/develop', text)
        for name in ('mobile-ci.yml', 'docker-publish.yml', 'e2e.yml'):
            ci = (ROOT / '.github/workflows' / name).read_text()
            self.assertNotRegex(ci, r'IOS_DISTRIBUTION_P12|IOS_DEV_PROVISIONING|ios_distribution\.py')

    def test_upload_requires_upload_mode_and_asc_secrets_only_there(self):
        steps = self.load()['jobs']['testflight']['steps']
        upload = [s for s in steps if 'ios_distribution.py upload' in s.get('run', '')]
        self.assertEqual(len(upload), 1)
        self.assertIn("RT_MODE == 'upload'", upload[0]['if'])
        self.assertEqual(upload[0]['env']['IOS_UPLOAD_AUTHORIZED'], 'true')
        build = [s for s in steps if 'ios_distribution.py build' in s.get('run', '')][0]
        self.assertNotIn('ASC_', str(build.get('env', {})))


@unittest.skipUnless(sys.platform == 'darwin', 'macOS keychain API unavailable; Linux tests cover P12 parsing and fail-closed policy')
class MacSyntheticImportTests(unittest.TestCase):
    def test_compatible_synthetic_control_and_wrong_password(self):
        # A positive control prevents a broken import command being reported as AES incompatibility.
        p12, _ = p12_fixture(cn='SYNTHETIC COMPATIBILITY CONTROL ONLY', legacy=True)
        with tempfile.TemporaryDirectory(prefix='ringtools-synthetic-control-') as directory:
            root = Path(directory); p12_file = root / 'synthetic.p12'; keychain = root / 'synthetic.keychain-db'
            driver.private_file(p12_file, p12)
            password = uuid.uuid4().hex
            previous = driver.run(['security', 'list-keychains', '-d', 'user'], 'Read synthetic search-list control')
            try:
                driver.run(['security', 'create-keychain', '-p', password, str(keychain)], 'Synthetic keychain creation')
                driver.run(['security', 'unlock-keychain', '-p', password, str(keychain)], 'Synthetic keychain unlock')
                with self.assertRaises(driver.SigningError):
                    driver.import_p12(p12_file, 'deliberately-wrong-synthetic-password', keychain)
                driver.import_p12(p12_file, 'synthetic-only', keychain)
                print('SYNTHETIC compatible P12 control: imported; wrong password refused. No Apple credentials used.')
            finally:
                if keychain.exists():
                    driver.run(['security', 'delete-keychain', str(keychain)], 'Synthetic cleanup')
            self.assertFalse(keychain.exists())
            self.assertEqual(previous, driver.run(['security', 'list-keychains', '-d', 'user'], 'Check synthetic search-list control'))

    def test_aes256_sha256_ephemeral_self_signed_import_only(self):
        # No Apple identity, provisioning, signing, account or API contact.
        p12, _ = p12_fixture(cn='SYNTHETIC KEYCHAIN COMPATIBILITY ONLY')
        with tempfile.TemporaryDirectory(prefix='ringtools-synthetic-') as directory:
            root = Path(directory); p12_file = root / 'synthetic.p12'; keychain = root / 'synthetic.keychain-db'
            driver.private_file(p12_file, p12)
            password = uuid.uuid4().hex
            previous = driver.run(['security', 'list-keychains', '-d', 'user'], 'Read synthetic search-list control')
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
            self.assertEqual(previous, driver.run(['security', 'list-keychains', '-d', 'user'], 'Check synthetic search-list control'))


if __name__ == '__main__':
    unittest.main()
