# Ringtools Dev (iOS) via TestFlight – handmatige signing

Variant van dezelfde mobiele codebase: **Ringtools Dev**, bundle-ID `nl.ringapeldoorn.ringtools.dev`, backend `https://dev.ringapeldoorn.nl`, naast de productieapp (`nl.ringapeldoorn.ringtools`) installeerbaar. De productieconfiguratie en -signing in Git blijven ongewijzigd: `mobile/scripts/configure-variant.mjs dev --manual-signing` past alleen in de werkkopie op de CI-runner het bundle-ID, de weergavenaam, de Universal Links-host, productie-APNs en de handmatige signing van de Release-configuratie aan. `VITE_APP_VARIANT=dev` toont de banner "Ontwikkelomgeving – alleen testgegevens".

## Waarom handmatige signing (geen nieuwe certificaten meer)
Automatische signing met de App Store Connect-sleutel maakt op elke tijdelijke runner een nieuw Apple Development-certificaat; run 12 van de productieworkflow faalde daardoor op 12 november met *"Your account has reached the maximum number of certificates"*. De dev-workflow gebruikt daarom **uitsluitend** een bestaand **Apple Distribution**-certificaat (.p12) en een **App Store-profiel** voor het dev-bundle-ID uit beschermde environment-secrets (mechaniek overgenomen en aangepast uit PR #6: `ios_distribution.py`, `ios_signing_policy.py`; PR #6 zelf is niet gemerged). Er is geen `-allowProvisioningUpdates`, geen API-sleutel bij het signen en dus nooit een nieuw certificaat of profiel. Een Distribution-certificaat is team-breed en mag voor elk bundle-ID van je team worden gebruikt; het productieprofiel/-bundle-ID wordt er niet door geraakt.

## Checklist 1 – Apple Developer (developer.apple.com → Certificates, Identifiers & Profiles)
1. **Identifier** `nl.ringapeldoorn.ringtools.dev` (App IDs → *explicit*). Capabilities: **Push Notifications** en **Associated Domains**. Zet dit aan *vóór* je het profiel maakt.
2. **Profile**: Profiles → + → *App Store Connect* (onder Distribution) → App ID `nl.ringapeldoorn.ringtools.dev` → het bestaande **Apple Distribution**-certificaat → naam "Ringtools Dev App Store" → *Generate* → download `.mobileprovision`. (Heb je capabilities later gewijzigd? Maak het profiel opnieuw.)
3. **Certificaat**: geen nieuw certificaat nodig. Zorg dat je het bestaande Apple Distribution-certificaat **mét privésleutel** als `.p12` kunt exporteren (zie checklist 3).
4. **APNs-sleutel** (.p8): bestaat al per team en werkt voor elk bundle-ID. Hergebruik is toegestaan; liever een eigen sleutel voor dev als er een vrije plek is. De waarden gaan alleen in de Portainer-dev-stack (`DEV_APNS_KEY_P8`, `DEV_APNS_KEY_ID`, `DEV_APNS_TEAM_ID`, `DEV_APNS_BUNDLE_ID=nl.ringapeldoorn.ringtools.dev`, `DEV_APNS_PRODUCTION=true`), nooit in GitHub.

## Checklist 2 – App Store Connect
1. *Apps → + → Nieuwe app*: platform iOS, naam bijv. "Ringtools Dev", bundle-ID `nl.ringapeldoorn.ringtools.dev`, eigen SKU. Zonder app-record kan niets worden geüpload.
2. *TestFlight*: voeg jezelf toe als interne tester. (Bij de eerste upload moet je eenmalig de exportconformiteitsvraag beantwoorden.)
3. De bestaande API-sleutel (`ASC_*` secrets) wordt alleen voor de **upload** gebruikt.

## Checklist 3 – GitHub: environment `testflight` (Settings → Environments → testflight)
Aanbevolen: *Required reviewers* (jijzelf) aanzetten en onder *Deployment branches and tags* ook de tags `ios-dev-*` toestaan.

| Secret | Nieuw? | Inhoud |
|---|---|---|
| `IOS_TEAM_ID` | bestaat | Apple Team-ID (10 tekens) |
| `IOS_DISTRIBUTION_P12_BASE64` | **nieuw** | bestaand Apple Distribution-certificaat + privésleutel (.p12), base64 |
| `IOS_DISTRIBUTION_P12_PASSWORD` | **nieuw** | wachtwoord van die .p12 |
| `IOS_DEV_PROVISIONING_PROFILE_BASE64` | **nieuw** | App Store-profiel voor `nl.ringapeldoorn.ringtools.dev` (.mobileprovision), base64 |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_P8_BASE64` | bestaan | alleen nodig voor de upload (modus `upload`) |

**Veilig aanleveren** (geen sleutels in de repository, chat, buildlogs of shellgeschiedenis; alleen *environment*-secrets, geen repository-secrets):
- P12 exporteren: op de Mac waar het certificaat staat: Sleutelhangertoegang → *Apple Distribution: …* (met privésleutel) → *Exporteer* → .p12 met een sterk, uniek wachtwoord. Dit macOS-formaat is importeerbaar. Komt je P12 uit Windows/OpenSSL 3 en weigert de importcontrole hem, exporteer dan opnieuw met het oudere formaat: `openssl pkcs12 -export -inkey sleutel.pem -in certificaat.pem -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -out distribution.p12`.
- Zonder bestand te plakken in een terminal: macOS `base64 -i distribution.p12 | tr -d '\n' | pbcopy`; Windows PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("distribution.p12")) | Set-Clipboard`. Plak daarna in *Add environment secret* in de GitHub-webinterface en leeg het klembord.
- Het wachtwoord typ je rechtstreeks in het secretveld (niet in een commando). Met de GitHub-CLI kan het ook zonder geschiedenis: `gh secret set IOS_DISTRIBUTION_P12_PASSWORD --env testflight` (vraagt verborgen om de waarde).
- Verwijder daarna de lokale .p12-/.mobileprovision-kopieën (of bewaar ze versleuteld). De workflow zet het materiaal alleen in een tijdelijke keychain op de runner en ruimt dat altijd op; waarden worden niet geprint.

## Starten – altijd via een tag op een commit die op `develop` staat
De workflow weigert een commit die niet op `develop` staat. Er is geen workflowbestand op `main` nodig.

1. **Importcontrole** (geen build): `git tag ios-dev-check-1.0.0-1 <commit>` en `git push origin ios-dev-check-1.0.0-1`. Controleert dat P12 + wachtwoord, team, geldigheid, privésleutel, profielgeldigheid, bundle-ID, Associated Domains en productie-APNs kloppen en dat macOS het certificaat kan importeren. Doe dit eerst: het toont direct of je export compatibel is.
2. **Ondertekende archive zonder upload**: `ios-dev-build-1.0.0-1`. Maakt een Release-archive met handmatige Apple Distribution-signing, exporteert de IPA en controleert zowel archive als IPA op: bundle-ID `nl.ringapeldoorn.ringtools.dev`, versie/build, Apple Distribution-handtekening van jouw team, profiel (App Store, geen apparatenlijst, juiste app-ID), `get-task-allow` uit, productie-APNs, `applinks:`/`webcredentials:dev.ringapeldoorn.nl` en privacymanifest. De backend komt uit `VITE_API_URL=https://dev.ringapeldoorn.nl`. De IPA blijft 3 dagen als artifact beschikbaar. **Er wordt niets geüpload.**
3. **TestFlight-upload (pas na jouw afzonderlijk akkoord)**: `ios-dev-upload-1.0.0-1` (build, controles en daarna `altool --upload-app`). Het buildnummer moet per versie oplopen.

Tagformaat: `ios-dev-<check|build|upload>-<versie>-<build>`; verhoog het buildnummer bij elke nieuwe poging van een upload.

## Scheiding van productie
- Keychain-items (sessietoken, toestelsleutel) zijn per app (team + bundle-ID); de dev-app kan geen productiesessies lezen. De API-basis is vast `https://dev.ringapeldoorn.nl`; dev-database en -sleutels delen niets met productie.
- Dezelfde code, dus dezelfde authenticatie (e-mailcode, MFA, Face ID/toestelvergrendeling, sessies intrekken, afscherming appwisselaar). Gecontroleerd met code en geautomatiseerde tests, **niet** op een fysiek toestel.
- De productieworkflow `ios-testflight.yml`, het Xcode-project, `App.entitlements` en het productie-bundle-ID zijn niet gewijzigd.
