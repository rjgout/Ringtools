# Aanmelden voor release 1.0

## Gedrag

De app begint met een e-mailadres en **Verder**. Daarna volgen de acht cijfers uit de mail, opnieuw aanvragen en adres wijzigen. Extra verificatie verschijnt alleen als het account die vereist. De webmin blijft uitsluitend op de website, met wachtwoord en verplichte TOTP.

Een nieuwe uitnodiging verstuurt een welkomstmail zonder activeringsgeheim. `IOS_INSTALL_URL` en `ANDROID_INSTALL_URL` mogen bestaande HTTPS-installatielinks bevatten, bijvoorbeeld een daadwerkelijk beschikbaar testkanaal. Zonder links verwijst de mail naar de installatie-instructies van de ringbeheerder; er worden geen storelinks verzonnen.

Een nog onbekend, geldig uitgenodigd adres krijgt een gehashte, kortlevende `InvitationLoginCode`, zonder dat een account wordt aangemaakt. Na verificatie worden account, geldige uitnodigingen, lidmaatschappen, deelnemers aan lopende rondes en sessie in één transactie vastgelegd. Een e-mailadvisorylock serialiseert gelijktijdige accountcreatie. Bestaande accounts krijgen dezelfde codeflow als voorheen; hun uitnodigingen worden geaccepteerd bij het afronden van een volledig geverifieerde e-mailcode-aanmelding, nooit bij een pending-MFA-sessie. De pending-sessie legt het daadwerkelijk geverifieerde adres vast. Een latere adreswijziging bewijst het nieuwe adres niet; een gewone herverificatie of `/me` accepteert daarom geen nieuwe uitnodiging. Bestaande actieve lidmaatschappen krijgen geen extra rechten; gedeactiveerde lidmaatschappen blijven gedeactiveerd. De ring, bevoegdheid van de uitnodiger, geldigheid en intrekking worden opnieuw gecontroleerd.

## Overgang van bestaande uitnodigingen

De migratie is additief. Geldige oude uitnodigingen werken ook met de normale e-mailcode. Bestaande tokens en codes blijven tijdens hun bestaande geldigheidsduur bruikbaar via de bestaande API en deeplinks, zodat reeds verstuurde mails bruikbaar blijven. Nieuwe welkomstmails tonen die geheimen niet. Er vindt geen bulkactivatie plaats en een nieuwe verzending verlengt of verandert geen bestaande accountrechten. Oude apps blijven de legacy-activatieroutes gebruiken; gebruikers van die apps kunnen een update nodig hebben om de nieuwe welkomstflow te gebruiken.

## Snel aanmelden

Na volledig aanmelden kan een gewone gebruiker snel aanmelden instellen, ook zonder vooraf ingestelde MFA. Registratie vereist een verse volledig geverifieerde sessie; bestaande MFA en gevoelige beheeracties blijven hun extra verificatie vereisen. De privésleutel blijft in Secure Enclave of hardware-backed Android Keystore. Challenges zijn eenmalig, kort geldig en gebonden aan doel, account en installatie. Een toestelsessie geldt niet als recente MFA.

Op Android vraagt de cryptoplug-in nu altijd om expliciete systeemverificatie vóór ondertekenen, ook wanneer het OS-authenticatievenster van vijf seconden nog openstaat. Het cryptografische OS-venster zelf is niet veranderd; dit is geen claim van OS-verificatie per cryptografische operatie. Op Android 7–10 gebruikt de ondertekenprompt uitsluitend sterke biometrie: die OS-versies ondersteunen de combinatie STRONG met toestelcode niet veilig in dezelfde prompt. Zonder sterke biometrie blijft gewone e-mailaanmelding beschikbaar; Android 11+ kan ook toestelcode gebruiken. Nieuwe registraties krijgen `loginProtocol=2`; oude Android-registraties met protocol 1 worden niet opeens als inlogmiddel geaccepteerd. De server bewijst sleutelbezit, niet hardwareattestatie. Het systeem bepaalt of biometrie of toestelcode bruikbaar is. Annuleren ondertekent niets en geeft geen toegang. Sleutelverlies of intrekking leidt terug naar e-mailaanmelding.

Bij **ja** mogen sessies beveiligd worden bewaard. Na sessieverloop haalt de app, na lokale ontgrendeling, een nieuwe challenge op en vraagt met de toestelsleutel een nieuwe sessie aan. De grenzen van 60 dagen inactiviteit en 180 dagen absolute sessieleeftijd blijven bestaan.

Bij **nee** blijft het bearer-token alleen in procesgeheugen. Een korte appwissel onderbreekt de sessie niet. Een nieuwe processtart vereist opnieuw e-mailverificatie. De bestaande appvergrendeling schermt meteen af en vraagt vanaf 30 seconden achtergrond opnieuw verificatie. Vanuit **Profiel → Aanmelden en beveiliging** kan snel aanmelden later worden ingesteld of uitgezet.

De sessie waarmee een toestel wordt ingericht is eveneens aan dat toestel gebonden. Intrekken van een gekoppelde sessie trekt ook de toestelaanmelding in; de app kan die intrekking niet omzeilen door automatisch een nieuwe sessie te vragen. Uitloggen verwijdert de lokale sleutelreferentie en de native sleutel en trekt online de gekoppelde sessies/toestelaanmelding in. Bij een netwerkfout wordt de intrekking uitsluitend in beveiligde opslag klaargezet voor herhaling zodra de app ontgrendeld verbinding heeft; offline kan de server vanzelfsprekend niet onmiddellijk worden bereikt.

Een niet-geheim, niet-geback-upt installatiekenmerk in de native app detecteert herinstallatie. Achtergebleven Keychainreferenties en sessies worden gewist voordat ze kunnen worden hervat. Het installatiekenmerk is geen authenticatiemiddel. Android-backups zijn uitgeschakeld. Biometrische wijzigingen/sleutelinvalidatie die door het OS worden gemeld geven geen automatische herregistratie; toestelcode blijft toegestaan waar het OS en sleutelbeleid die toestaan.

## Ingebruikname en controles

Pas eerst de additieve Prisma-migratie toe op een afzonderlijke testomgeving en controleer een databaseback-up vóór productie-invoering. De bestaande functievlaggen `TRUSTED_DEVICES_ENABLED`, `NATIVE_DEVICE_LOGIN_ENABLED` en `NATIVE_DEVICE_AUTO_ENROLL_ENABLED` bepalen de beschikbaarheid; productieactivering blijft een afzonderlijke eigenaarhandeling. Vlaggen voor bestaande MFA-methoden blijven van toepassing; zet die niet uit als oplossing voor ontbrekende platformondersteuning.

Geautomatiseerde dekking: `tests/simpleLogin.test.ts`, bestaande uitnodigings-/MFA-/ringisolatietests, `tests/deviceEnrollment.test.ts`, toestelinlog-/intrekkingsraces, `mobile/tests/sessionPersistence.test.ts`, toestelregistratie-/inlogtests en appvergrendelingstests. Testgegevens zijn synthetisch en staan uitsluitend in `_test`/`_e2e`-databases.

Fysieke acceptatie blijft nodig op iOS en Android: cold start, achtergrond/appwisselaar, Face ID/Touch ID/Android-biometrie, toestelcode, annuleren, ontbreken/veranderen van toestelbeveiliging, offline starten/herstel, sleutelinvalidation, herinstallatie, toestel-/accountwissel, sessieverloop en beheerintrekking. Een Linux-test met een nepsleutel bewijst geen Secure Enclave-/Keystoregedrag. iOS-builds vereisen macOS/Xcode. Er is geen productie- of TestFlight-publicatie onderdeel van deze wijziging.

## Uitgevoerde validatie — 10 november 2026

- Backend: 650 Vitest-tests geslaagd (43 bestanden), inclusief gelijktijdige rolwijziging, eenmalig codegebruik, multi-ringacceptatie, intrekking, MFA, gewijzigde e-mailidentiteit, sessieverloop en toestelintrekking.
- Mobiele client: 415 Vitest-tests geslaagd (44 bestanden). Typecontrole en productiebuild geslaagd.
- Root: Prisma-clientgeneratie en schemavalidatie, beide additieve migraties op afzonderlijke synthetische testdatabases, TypeScript, ESLint en Next.js-productiebuild geslaagd.
- Browser tegen de gebouwde server: 68 geslaagd met functies aan (7 bewust overgeslagen configuratievarianten); 11 geslaagd met functies uit (17 aan-varianten overgeslagen); 5 geslaagd met toestelinlog aan en automatische registratie uit. Chromium draaide via een externe Playwright-configuratie; de repositoryconfiguratie bleef behouden. De e2e-database en server gebruikten dezelfde configuratie. Synthetische VAPID-sleutels maakten de bestaande pushbeschikbaarheidstests uitvoerbaar; er zijn geen echte pushleveringen getest.
- Native configuratiecontrole geslaagd. Zeven Python-tests voor de iOS-bundelcontrole geslaagd.
- Android-debugbuild daadwerkelijk geslaagd met JDK 21 en Android SDK 36, inclusief de native installatieplug-in en de gewijzigde cryptoplug-in. Een schone `npm ci` heeft de bronpatch opnieuw succesvol toegepast; builduitvoer is niet in de patch opgenomen.
- HTTP-healthcheck gaf `{"status":"ok"}`. De oorspronkelijke Prisma-downloadblokkade is opgelost zonder checksum- of TLS-controles uit te schakelen.

Niet lokaal uitgevoerd: native iOS-build/configuratiebuild (Linux, `xcodebuild` ontbreekt), fysieke iOS-/Android-acceptatie, echte SMTP-, APNs- en FCM-levering en store-/TestFlight-publicatie. E-mailinhoud en afleverfouten zijn met het bestaande testtransport gecontroleerd. De lokale controles zijn geen claim van een uitgevoerde GitHub Actions-run; de mobiele workflow omvat ook de nieuwe backendbestanden en voert na push de passende controles uit.

De migratie houdt oude kolommen en geldige legacytokens intact. Oudere servers begrijpen de nieuwe uitnodigingscodeflow niet: een rollback van applicatiecode kan daarom aanvullende behandeling van nieuwe uitnodigingen vereisen. Verwijder bij een rollback geen tabellen of beveiligingsmetadata uit een actieve database. Een al vóór de update begonnen MFA-login zonder vastgelegd e-mailbewijs accepteert geen nieuwe uitnodigingen; daarvoor is een nieuwe codeaanmelding nodig.
