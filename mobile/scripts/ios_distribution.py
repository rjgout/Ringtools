#!/usr/bin/env python3
"""Manual Distribution signing. Never creates certificates/profiles; sanitized failures only."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import zipfile
from ios_signing_policy import BUNDLE_ID, LINK_HOST, archive_command, export_options, material_digest, profile_errors


class SigningError(Exception):
    pass


def run(args, label, **kwargs):
    # Never forward security/xcodebuild diagnostics: they can contain identities or secrets.
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise SigningError(label + ' mislukt; geen automatische provisioning of fallback uitgevoerd.')
    return result.stdout


def decode_env(name):
    value = os.environ.get(name, '')
    if not value:
        raise SigningError('Environment secret ontbreekt: ' + name)
    try:
        data = base64.b64decode(''.join(value.split()), validate=True)
        if not data or len(data) > 1024 * 1024:
            raise ValueError()
        return data
    except (ValueError, TypeError):
        raise SigningError('Ongeldige base64 voor ' + name) from None


def certificate_info(p12, password, team):
    from cryptography.hazmat.primitives.serialization import pkcs12, Encoding, PublicFormat
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
    from cryptography import x509
    try:
        key, cert, _ = pkcs12.load_key_and_certificates(p12, password.encode())
        if key is None or cert is None:
            raise ValueError()
        if key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo) != cert.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo):
            raise ValueError()
        if not cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value.startswith('Apple Distribution:'):
            raise ValueError()
        if [v.value for v in cert.subject.get_attributes_for_oid(NameOID.ORGANIZATIONAL_UNIT_NAME)] != [team]:
            raise ValueError()
        now = datetime.now(timezone.utc)
        if not cert.not_valid_before_utc <= now < cert.not_valid_after_utc:
            raise ValueError()
        if ExtendedKeyUsageOID.CODE_SIGNING not in cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value:
            raise ValueError()
        der = cert.public_bytes(Encoding.DER)
        return der, hashlib.sha1(der).hexdigest().upper()
    except Exception:
        raise SigningError('P12 ongeldig: controleer wachtwoord, Distribution-identiteit, privésleutel, team en geldigheid.') from None


def workdir():
    root = Path(os.environ['RUNNER_TEMP']).resolve()
    work = root / ('ringtools-signing-' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT'])
    if not re.fullmatch(r'ringtools-signing-\d+-\d+', work.name) or work.is_symlink():
        raise SigningError('Ongeldige tijdelijke signinglocatie.')
    return work


def save(work, state):
    path = work / 'state.json'
    temporary = work / 'state.pending'
    temporary.unlink(missing_ok=True)
    private_file(temporary, json.dumps(state).encode())
    temporary.replace(path)


def private_file(path, data):
    # Create with restrictive permissions before writing any bytes.
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as handle:
        handle.write(data)


def cleanup(work):
    if not work.exists():
        return
    failures = []
    state_path = work / 'state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if 'search_list' in state:
        try:
            run(['security', 'list-keychains', '-d', 'user', '-s', *state['search_list']], 'Keychainzoeklijst herstellen')
        except SigningError:
            failures.append('keychainzoeklijst')
    keychain = work / 'signing.keychain-db'
    if keychain.exists():
        try:
            run(['security', 'delete-keychain', str(keychain)], 'Tijdelijke keychain verwijderen')
        except SigningError:
            failures.append('keychain')
    for item in state.get('profiles', []):
        path = Path(item['path'])
        try:
            if item['backup']:
                shutil.copy2(work / item['backup'], path)
                path.chmod(item['mode'])
            else:
                path.unlink(missing_ok=True)
        except OSError:
            failures.append('profiel')
    # Keep journal on failed restoration so always() can retry; never claim cleanup succeeded.
    if failures:
        raise SigningError('Opruimen onvolledig: ' + ', '.join(failures))
    shutil.rmtree(work)


def prepare(work, attestation=None):
    p12 = decode_env('IOS_DISTRIBUTION_P12_BASE64')
    profile_bytes = decode_env('IOS_PROVISIONING_PROFILE_BASE64')
    password = os.environ.get('IOS_DISTRIBUTION_P12_PASSWORD', '')
    team = os.environ.get('IOS_TEAM_ID', '')
    if not password or not re.fullmatch('[A-Z0-9]{10}', team):
        raise SigningError('P12-wachtwoord of geldige IOS_TEAM_ID ontbreekt.')
    der, fingerprint = certificate_info(p12, password, team)
    digest = material_digest(p12, profile_bytes)
    if attestation is not None and (attestation.get('material_sha256') != digest or attestation.get('commit') != os.environ['GITHUB_SHA']):
        raise SigningError('Importcontrole past niet bij deze commit en signingmiddelen; voer eerst opnieuw de afzonderlijke importcontrole uit.')
    work.mkdir(mode=0o700, exist_ok=False)
    state = {'team': team, 'certificate_sha1': fingerprint, 'profiles': [], 'material_sha256': digest}
    save(work, state)
    try:
        profile_file = work / 'profile.mobileprovision'
        private_file(profile_file, profile_bytes)
        profile = plistlib.loads(run(['security', 'cms', '-D', '-i', str(profile_file)], 'Profiel decoderen'))
        errors = profile_errors(profile, team, certificate=der)
        if errors:
            raise SigningError(' '.join(errors))
        state['profile_uuid'] = profile['UUID']
        state['search_list'] = shlex.split(run(['security', 'list-keychains', '-d', 'user'], 'Keychainzoeklijst lezen').decode())
        save(work, state)
        keychain = work / 'signing.keychain-db'
        keypass = secrets.token_urlsafe(40)
        run(['security', 'create-keychain', '-p', keypass, str(keychain)], 'Tijdelijke keychain maken')
        run(['security', 'set-keychain-settings', '-lut', '21600', str(keychain)], 'Keychaintimeout instellen')
        run(['security', 'unlock-keychain', '-p', keypass, str(keychain)], 'Keychain ontgrendelen')
        p12_file = work / 'distribution.p12'
        private_file(p12_file, p12)
        import_p12(p12_file, password, keychain)
        run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keypass, str(keychain)], 'Toegang voor codesign instellen')
        run(['security', 'list-keychains', '-d', 'user', '-s', str(keychain), *state['search_list']], 'Tijdelijke zoeklijst instellen')
        identities = run(['security', 'find-identity', '-v', '-p', 'codesigning', str(keychain)], 'Distribution-identiteit controleren').decode()
        if not re.search(r'\b' + fingerprint + r'\b', identities):
            raise SigningError('Geïmporteerd certificaat heeft geen vertrouwde geldige codesigning-identiteit.')
        for directory in [Path.home() / 'Library/MobileDevice/Provisioning Profiles', Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles']:
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / (profile['UUID'] + '.mobileprovision')
            if path.is_symlink():
                raise SigningError('Onveilige bestaande profiellocatie.')
            backup = None
            mode = path.stat().st_mode & 0o777 if path.exists() else None
            if path.exists():
                backup = 'profile-backup-' + str(len(state['profiles']))
                shutil.copy2(path, work / backup)
                (work / backup).chmod(0o600)
            state['profiles'].append({'path': str(path), 'backup': backup, 'mode': mode})
            save(work, state)  # journal before installing
            if path.exists():
                path.unlink()
            private_file(path, profile_bytes)
        p12_file.unlink()
        print('Distribution-identiteit en app-specifiek App Store-profiel gecontroleerd; tijdelijke import geslaagd.')
        return state
    except Exception:
        cleanup(work)
        raise


def import_p12(path, password, keychain):
    # Also exercised on macOS with ephemeral, self-signed synthetic material only.
    return run(['security', 'import', str(path), '-x', '-k', str(keychain), '-P', password,
                '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], 'PKCS#12-import (macOS; AES256-SHA256-compatibiliteit en wachtwoord controleren)')


def check_attestation(run_id, destination):
    if not re.fullmatch(r'\d+', run_id):
        raise SigningError('Een geslaagde afzonderlijke importcontrole-run is verplicht.')
    repo = 'rjgout/Ringtools'
    data = json.loads(run(['gh', 'api', f'repos/{repo}/actions/runs/{run_id}'], 'Importcontrole-run controleren'))
    if not (data.get('event') == 'workflow_dispatch' and data.get('conclusion') == 'success' and data.get('head_sha') == os.environ['GITHUB_SHA'] and data.get('head_branch') == 'main' and data.get('path') == '.github/workflows/ios-signing-import-check.yml'):
        raise SigningError('Importcontrole moet succesvol, handmatig en op dezelfde main-commit zijn uitgevoerd.')
    destination.mkdir(mode=0o700)
    run(['gh', 'run', 'download', run_id, '--repo', repo, '--name', 'ringtools-import-check-' + str(data['run_attempt']), '--dir', str(destination)], 'Importcontrolerapport ophalen')
    return json.loads((destination / 'import-check.json').read_text())


def verify_app(app, stage, state):
    run([sys.executable, 'scripts/verify-ios-bundle.py', '--stage', stage, '--app', str(app), '--bundle-id', BUNDLE_ID,
         '--team-id', state['team'], '--link-host', LINK_HOST, '--strict', '--version', os.environ['MARKETING_VERSION'], '--build', os.environ['BUILD_NUMBER']], 'Distributiecontrole ' + stage)
    print('Distributiecontrole ' + stage + ' geslaagd (identiteit, profiel, APNs, domeinen, privacy, versie).')


def one(paths):
    values = list(paths)
    if len(values) != 1:
        raise SigningError('Precies één app/IPA vereist.')
    return values[0]


def build(work):
    if os.environ.get('IOS_SIGNING_AUTHORIZED') != 'true':
        raise SigningError('Echte signing vereist afzonderlijke eigenaarstoestemming.')
    state = json.loads((work / 'state.json').read_text())
    version, number = os.environ['MARKETING_VERSION'], os.environ['BUILD_NUMBER']
    if not re.fullmatch(r'\d+\.\d+(\.\d+)?', version) or not re.fullmatch(r'\d+', number):
        raise SigningError('Ongeldige versie/build.')
    run(archive_command(state, work, version, number), 'Handmatige Distribution-archive')
    verify_app(one((work / 'Ringtools.xcarchive/Products/Applications').glob('*.app')), 'archive', state)
    private_file(work / 'ExportOptions.plist', plistlib.dumps(export_options(state)))
    run(['xcodebuild', '-exportArchive', '-archivePath', str(work / 'Ringtools.xcarchive'), '-exportOptionsPlist', str(work / 'ExportOptions.plist'), '-exportPath', str(work / 'export')], 'Handmatige Distribution-export')
    ipa = one((work / 'export').glob('*.ipa'))
    extracted = work / 'ipa'
    with zipfile.ZipFile(ipa) as archive:
        # ditto preserves IPA symlinks; reject traversal first.
        if any(p.startswith('/') or '..' in Path(p).parts for p in archive.namelist()):
            raise SigningError('Ongeldige IPA-paden.')
    run(['ditto', '-x', '-k', str(ipa), str(extracted)], 'IPA uitpakken')
    verify_app(one((extracted / 'Payload').glob('*.app')), 'ipa', state)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write('Ringtools: archive en IPA gecontroleerd met dezelfde handmatige Apple Distribution-identiteit; App Store-profiel, productie-APNs, Associated Domains, privacy en versie geldig.\n')


def upload(work):
    if os.environ.get('IOS_UPLOAD_AUTHORIZED') != 'true':
        raise SigningError('Upload vereist afzonderlijke toestemming.')
    state = json.loads((work / 'state.json').read_text())
    verify_app(one((work / 'ipa/Payload').glob('*.app')), 'ipa', state)
    keyid, issuer = os.environ.get('ASC_KEY_ID', ''), os.environ.get('ASC_ISSUER_ID', '')
    if not re.fullmatch('[A-Z0-9]{10}', keyid) or not re.fullmatch(r'[a-fA-F0-9-]{36}', issuer):
        raise SigningError('App Store Connect-identificatie ontbreekt/ongeldig.')
    keys = work / 'private_keys'
    keys.mkdir(mode=0o700)
    private_file(keys / ('AuthKey_' + keyid + '.p8'), decode_env('ASC_API_KEY_P8_BASE64'))
    ipa = one((work / 'export').glob('*.ipa'))
    run(['xcrun', 'altool', '--upload-app', '--type', 'ios', '-f', str(ipa), '--apiKey', keyid, '--apiIssuer', issuer], 'Expliciet goedgekeurde TestFlight-upload', cwd=work)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['import-check', 'prepare', 'build', 'upload', 'cleanup'])
    parser.add_argument('--import-run-id', default='')
    parser.add_argument('--no-attestation', action='store_true', help='Dev-variant: geen voorafgaande importcontrole-run vereist (de tag-start is de toestemming).')
    args = parser.parse_args()
    work = workdir()
    if args.action == 'cleanup':
        cleanup(work)
    elif args.action == 'import-check':
        if os.environ.get('IOS_IMPORT_AUTHORIZED') != 'true':
            raise SigningError('Importcontrole vereist afzonderlijke eigenaarstoestemming.')
        state = prepare(work)
        report = Path(os.environ['RUNNER_TEMP']) / 'ringtools-import-report'
        report.mkdir(mode=0o700)
        private_file(report / 'import-check.json', json.dumps({'commit': os.environ['GITHUB_SHA'], 'material_sha256': state['material_sha256']}).encode())
    elif args.action == 'prepare':
        if os.environ.get('IOS_SIGNING_AUTHORIZED') != 'true':
            raise SigningError('Echte signing vereist afzonderlijke eigenaarstoestemming.')
        if args.no_attestation:
            prepare(work)
        else:
            destination = Path(os.environ['RUNNER_TEMP']) / 'ringtools-import-attestation'
            try:
                report = check_attestation(args.import_run_id, destination)
                prepare(work, report)
            finally:
                shutil.rmtree(destination, ignore_errors=True)
    elif args.action == 'build':
        build(work)
    elif args.action == 'upload':
        upload(work)


if __name__ == '__main__':
    try:
        main()
    except SigningError as error:
        print('::error::' + str(error))
        sys.exit(1)
    except Exception:
        print('::error::Signingcontrole veilig gestopt; geen gevoelige diagnostiek gepubliceerd. Controleer configuratie en middelen.')
        sys.exit(1)
