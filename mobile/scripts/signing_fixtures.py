"""Public synthetic metadata only. Private test keys are generated in memory per test."""
from datetime import datetime, timedelta, timezone
from ios_signing_policy import BUNDLE_ID, DOMAINS
TEAM = 'TESTTEAM01'

def profile(certificate=b'synthetic-certificate'):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return {'Name': 'SYNTHETIC Ringtools App Store', 'UUID': '11111111-2222-3333-4444-555555555555',
            'Platform': ['iOS'], 'CreationDate': now - timedelta(days=1), 'ExpirationDate': now + timedelta(days=2),
            'TeamIdentifier': [TEAM], 'ApplicationIdentifierPrefix': ['OLDPREFIX1'],
            'DeveloperCertificates': [certificate], 'Entitlements': entitlements()}

def entitlements():
    return {'aps-environment': 'production', 'beta-reports-active': True, 'get-task-allow': False,
            'com.apple.developer.associated-domains': list(DOMAINS),
            'com.apple.developer.team-identifier': TEAM, 'application-identifier': 'OLDPREFIX1.' + BUNDLE_ID}
