"""Pure, fail-closed Ringtools App Store signing policy (no Apple/network operations)."""
from datetime import datetime, timezone
import hashlib
import re
import shlex
import uuid

import os

# Standaard de productieapp. De dev-variant zet IOS_BUNDLE_ID/IOS_LINK_HOST (ios-testflight-dev.yml); de waarden worden streng gevalideerd.
BUNDLE_ID = os.environ.get('IOS_BUNDLE_ID', 'nl.ringapeldoorn.ringtools')
LINK_HOST = os.environ.get('IOS_LINK_HOST', 'ringapeldoorn.nl')
if not re.fullmatch(r'[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+', BUNDLE_ID) or not re.fullmatch(r'[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}', LINK_HOST):
    raise SystemExit('Ongeldige IOS_BUNDLE_ID of IOS_LINK_HOST.')
DOMAINS = ('applinks:' + LINK_HOST, 'webcredentials:' + LINK_HOST)


def profile_errors(profile, team, bundle=BUNDLE_ID, certificate=None, now=None):
    errors = []
    if not isinstance(profile, dict):
        return ['App Store-profiel ontbreekt.']
    ent = profile.get('Entitlements', {})
    if not isinstance(ent, dict):
        return ['Profielentitlements ongeldig.']
    now = now or datetime.now(timezone.utc)
    for name, future in [('ExpirationDate', True), ('CreationDate', False)]:
        value = profile.get(name)
        if not isinstance(value, datetime):
            errors.append('Profieldatum ontbreekt of is ongeldig.')
        elif (value.replace(tzinfo=timezone.utc) > now) != future:
            errors.append('Profiel is verlopen of nog niet geldig.')
    try:
        if str(uuid.UUID(profile.get('UUID', ''))) != profile.get('UUID', '').lower():
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        errors.append('Profiel-UUID ongeldig.')
    if not profile.get('Name') or 'iOS' not in profile.get('Platform', []):
        errors.append('Geen benoemd iOS-profiel.')
    if 'ProvisionedDevices' in profile:
        errors.append('Profiel heeft een apparatenlijst; geen App Store-profiel.')
    if profile.get('ProvisionsAllDevices', False) is not False:
        errors.append('Enterprise-profiel niet toegestaan.')
    if ent.get('get-task-allow') is not False:
        errors.append('Profiel moet get-task-allow expliciet uitschakelen.')
    if ent.get('beta-reports-active') is not True:
        errors.append('App Store-distributiemarker ontbreekt.')
    if ent.get('aps-environment') != 'production':
        errors.append('Profiel vereist productie-APNs.')
    if not re.fullmatch(r'[A-Z0-9]{10}', team or '') or profile.get('TeamIdentifier') != [team] or ent.get('com.apple.developer.team-identifier') != team:
        errors.append('Profielteam komt niet overeen.')
    prefixes = profile.get('ApplicationIdentifierPrefix', [])
    if not isinstance(prefixes, list) or len(prefixes) != 1 or ent.get('application-identifier') != prefixes[0] + '.' + bundle:
        errors.append('Profiel vereist een expliciete overeenkomende appidentiteit.')
    domains = ent.get('com.apple.developer.associated-domains', [])
    if not isinstance(domains, list) or not ('*' in domains or all(d in domains for d in DOMAINS)):
        errors.append('Profiel mist Associated Domains.')
    certs = profile.get('DeveloperCertificates', [])
    if not isinstance(certs, list) or not certs or any(not isinstance(c, bytes) for c in certs):
        errors.append('Profielcertificaten ontbreken.')
    elif certificate is not None and certificate not in certs:
        errors.append('Certificaat komt niet voor in het profiel.')
    return errors


def distribution_errors(ent, profile, authorities, team_identifier, expected_team, bundle=BUNDLE_ID):
    errors = profile_errors(profile, expected_team, bundle)
    if ent.get('get-task-allow', False) is not False:
        errors.append('get-task-allow staat aan of is ongeldig in de app.')
    if ent.get('aps-environment') != 'production':
        errors.append('App vereist productie-APNs (aps-environment).')
    for domain in DOMAINS:
        if domain not in ent.get('com.apple.developer.associated-domains', []):
            errors.append('Associated Domains mist ' + domain + '.')
    if not authorities or not authorities[0].startswith('Apple Distribution:'):
        errors.append('App is niet met Apple Distribution ondertekend.')
    if not expected_team or team_identifier != expected_team or ent.get('com.apple.developer.team-identifier') != expected_team:
        errors.append('Handtekeningteam ontbreekt of wijkt af.')
    if profile and ent.get('application-identifier') != profile.get('Entitlements', {}).get('application-identifier'):
        errors.append('Appidentiteit komt niet overeen met het profiel.')
    return errors


def material_digest(p12, profile):
    return hashlib.sha256(hashlib.sha256(p12).digest() + hashlib.sha256(profile).digest()).hexdigest()


def archive_command(state, work, version, build):
    return ['xcodebuild', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release',
            '-destination', 'generic/platform=iOS', '-archivePath', str(work / 'Ringtools.xcarchive'),
            'CODE_SIGN_STYLE=Manual', 'CODE_SIGN_IDENTITY=' + state['certificate_sha1'],
            'DEVELOPMENT_TEAM=' + state['team'],
            'RINGTOOLS_DISTRIBUTION_PROFILE_UUID=' + state['profile_uuid'],
            'OTHER_CODE_SIGN_FLAGS=--keychain ' + shlex.quote(str(work / 'signing.keychain-db')),
            'MARKETING_VERSION=' + version, 'CURRENT_PROJECT_VERSION=' + build, 'archive']


def export_options(state):
    return {'method': 'app-store-connect', 'destination': 'export', 'teamID': state['team'],
            'signingStyle': 'manual', 'signingCertificate': state['certificate_sha1'],
            'provisioningProfiles': {BUNDLE_ID: state['profile_uuid']},
            'manageAppVersionAndBuildNumber': False, 'uploadSymbols': True}
