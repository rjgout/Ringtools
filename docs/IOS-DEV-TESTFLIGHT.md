# Ringtools Dev (iOS) via TestFlight

Variant van dezelfde mobiele codebase: **Ringtools Dev**, bundle-ID `nl.ringapeldoorn.ringtools.dev`, backend `https://dev.ringapeldoorn.nl`, naast de productieapp (`nl.ringapeldoorn.ringtools`) installeerbaar. De productieconfiguratie in Git blijft ongewijzigd: `mobile/scripts/configure-variant.mjs` past in de CI-werkkopie het bundle-ID, de weergavenaam en de Universal Links/webcredentials-host aan; `VITE_APP_VARIANT=dev` toont de banner "Ontwikkelomgeving – alleen testgegevens" (inlogscherm en in de app).

## Scheiding van productie
- Keychain-items (sessietoken, toestelsleutel) zijn per app (team + bundle-ID); de dev-app kan nooit productiesessies lezen en andersom. De API-basis (`VITE_API_URL`) is bij het bouwen vast `https://dev.ringapeldoorn.nl`; de dev-database en -sleutels delen niets met productie, dus een productietoken is op dev ongeldig.
- Dezelfde code, dus dezelfde authenticatie: e-mailcode, MFA, Face ID/toestelvergrendeling, sessiebeheer/intrekken en de afscherming in de appwisselaar (PrivacyScreen) werken ongewijzigd. Dit is met code en geautomatiseerde tests gecontroleerd, **niet** op een fysiek toestel.

## Wat jij bij Apple moet doen (eenmalig)
1. **App ID** `nl.ringapeldoorn.ringtools.dev` (Certificates, Identifiers & Profiles → Identifiers, *explicit*) met de capabilities **Push Notifications** en **Associated Domains**. (Bij automatische signing met de API-sleutel kan Xcode dit zelf aanmaken als de sleutel de rol Admin heeft; handmatig aanmaken is voorspelbaarder.)
2. **App-record** in App Store Connect: *Apps → + → Nieuwe app*, platform iOS, naam bijv. "Ringtools Dev", bundle-ID `nl.ringapeldoorn.ringtools.dev`, eigen SKU. Zonder app-record kan niets naar TestFlight worden geüpload.
3. **TestFlight**: interne testers toevoegen (jezelf) bij dat app-record.
4. **Push (APNs)**: een APNs-sleutel (.p8) is per team en werkt voor elke bundle-ID. Je mag de bestaande productiesleutel hergebruiken (technisch toegestaan); geadviseerd is een eigen sleutel voor dev als je een vrije plek hebt. Zet de waarden alleen in de Portainer-stack (`DEV_APNS_KEY_P8`, `DEV_APNS_KEY_ID`, `DEV_APNS_TEAM_ID`, `DEV_APNS_BUNDLE_ID=nl.ringapeldoorn.ringtools.dev`, `DEV_APNS_PRODUCTION=true`). Nooit in GitHub.
5. **Universal Links**: zet `DEV_APPLE_APP_ID=<Team-ID>.nl.ringapeldoorn.ringtools.dev` in de dev-stack, zodat `https://dev.ringapeldoorn.nl/.well-known/apple-app-site-association` het dev-app-ID bevat. De reverse proxy mag dit bestand niet omleiden.
6. **Signing**: zie hieronder. Beslis welke route je wilt.

## Signing: twee routes
Het huidige dev-workflow gebruikt (net als de productieworkflow tot 11 november) **automatische signing** met de App Store Connect API-sleutel. Dat maakt op elke tijdelijke runner een nieuw Apple Development-certificaat. Run 12 van de productieworkflow faalde daardoor op 12 november met: *"Your account has reached the maximum number of certificates"* en *"No profiles for 'nl.ringapeldoorn.ringtools' were found"*. Zolang het certificaatlimiet bereikt is, faalt ook de dev-build.

- **Route A (snelst, fragiel):** in het Apple-developerportaal de oude certificaten "Apple Development: Created via API" intrekken (Certificates → Revoke), daarna de dev-workflow starten. Elke volgende run verbruikt weer een plek; dit moet je dus periodiek herhalen.
- **Route B (aanbevolen, robuust):** handmatige signing met je bestaande **Apple Distribution**-certificaat (team-niveau; mag voor elk bundle-ID van je team worden gebruikt, dus technisch toegestaan en niet onveilig mits de secrets beschermd zijn) en een **App Store-provisioning profile voor het dev-bundle-ID**. Hiervoor zijn PR #6 (mechaniek, nog open/draft) en nieuwe secrets nodig (zie `docs/IOS-TESTFLIGHT.md` op die branch): `IOS_DISTRIBUTION_P12_BASE64`, `IOS_DISTRIBUTION_P12_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64` (het dev-profiel) en bestaand `IOS_TEAM_ID`. PR #6 is niet automatisch overgenomen; zodra jij route B kiest, neem ik de benodigde onderdelen gericht over en pas ik ze aan voor het dev-bundle-ID.

## Starten (er wordt niets geüpload tenzij jij dat zegt)
- Tag-start (werkt nu al): `git tag ios-dev-build-1.0.0-1 <commit>` + `git push origin ios-dev-build-1.0.0-1`. Bouwt een Release-archive + IPA, controleert bundle-ID en domeinen, bewaart de IPA als artifact en **uploadt nooit**.
- Handmatig via *Actions → iOS TestFlight – Ringtools Dev → Run workflow*: dit item verschijnt pas nadat het workflowbestand ook op `main` staat (GitHub-regel voor handmatige workflows). Daar staat *upload* standaard uit.
- Daarna, na jouw uitdrukkelijke akkoord, een run met *upload* aangevinkt (`xcrun altool --upload-app`).

## Controles in de workflow
Typecontrole/tests, `check:native-config` op de ongewijzigde productieconfiguratie, variant toepassen, build met `VITE_API_URL=https://dev.ringapeldoorn.nl`, Release-archive, daarna `verify-ios-bundle.py` op archive en IPA: bundle-ID `nl.ringapeldoorn.ringtools.dev`, versie/build, `applinks:`/`webcredentials:dev.ringapeldoorn.nl`, productie-APNs, Apple Distribution, App Store-profiel zonder apparatenlijst, privacymanifest.
