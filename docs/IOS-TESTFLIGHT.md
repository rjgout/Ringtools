# iOS-distributie en TestFlight

Status van de repository: **klaar voor de eerste TestFlight-build**. Wat alleen jij kunt doen (Apple-account, tweefactor, overeenkomsten) staat in "Handmatige stappen". Er staan geen certificaten, sleutels of wachtwoorden in Git.

## Vastgestelde identiteit

| Onderdeel | Waarde |
|---|---|
| Bundle-ID (bestaand, niet gewijzigd) | `nl.ringapeldoorn.ringtools` |
| Appnaam (weergave) | Ringtools |
| Versie / build (project) | `1.0` / `1` (de workflow zet versie en buildnummer per upload) |
| Minimum iOS | 18.0 |
| Team-ID | uit jouw Apple Developer-account → Membership; staat alleen in het GitHub-secret `IOS_TEAM_ID` en in de server-env `APNS_TEAM_ID`/`APPLE_APP_ID`, niet in Git |
| Entitlements (Debug/Release) | `aps-environment` (Xcode zet dit bij distributie op `production`), `applinks:ringapeldoorn.nl`, `webcredentials:ringapeldoorn.nl` |
| Gratis Personal Team | blijft apart bestaan: configuratie `Debug-PersonalTeam`, bundle-ID `….ringtools.dev`, geen entitlements. Raakt Release/TestFlight niet. |
| Privacymanifest | `mobile/ios/App/App/PrivacyInfo.xcprivacy` (geen tracking; verzamelde gegevens: naam, e-mail, gebruikers-ID, apparaattoken, gebruikersinhoud, alleen voor appfunctionaliteit) |
| Exportcompliance | `ITSAppUsesNonExemptEncryption = false` (alleen standaard-HTTPS) |
| Appicoon | `mobile/resources/icon.png` → 1024 × 1024, zonder transparantie; bewaakt door `npm run check:native-config` |

Wat in deze sessie is aangepast: zie de commit. Belangrijk: `AppDelegate.swift` gaf het APNs-apparaattoken niet door aan de Capacitor-plug-in (`didRegisterForRemoteNotificationsWithDeviceToken`); zonder die twee functies slaagt registratie voor pushmeldingen op iOS nooit. Dat is hersteld.

## Handmatige stappen (volgorde)

Alleen jij kunt dit doen; het zijn eenmalige handelingen.

1. **Overeenkomsten:** App Store Connect → *Agreements, Tax, and Banking*: accepteer de *Apple Developer Program License Agreement* en, voor betaalde apps, de bank-/belastinggegevens (niet nodig voor TestFlight).
2. **App ID registreren:** developer.apple.com → Certificates, Identifiers & Profiles → *Identifiers* → **+** → *App IDs* → *App* → beschrijving "Ringtools", **Explicit** Bundle ID `nl.ringapeldoorn.ringtools`. Vink de capabilities **Push Notifications** en **Associated Domains** aan. Is de ID al geregistreerd, controleer dan alleen die twee capabilities.
3. **App aanmaken in App Store Connect:** *Apps* → **+** → *New App*: Platform **iOS**, Naam **Ringtools** (is de naam al bezet, dan meldt Apple dat; kies dan bijv. "Ringtools Ring"), Primaire taal **Nederlands**, Bundle ID `nl.ringapeldoorn.ringtools`, SKU `ringtools-ios-001`, Toegang *Volledige toegang*. (Apple biedt geen API om een app-record aan te maken; dit moet in de webinterface.)
4. **App Store Connect API-sleutel (voor CI):** App Store Connect → *Users and Access* → *Integrations* → *App Store Connect API* → **+**: naam "Ringtools CI", toegang **Admin** (nodig voor automatisch beheerde signing). Download de `.p8` (kan maar één keer) en noteer *Key ID* en *Issuer ID*.
5. **APNs-sleutel (voor pushmeldingen):** developer.apple.com → *Keys* → **+** → vink *Apple Push Notifications service (APNs)* aan → download de `.p8` (eenmalig) en noteer *Key ID*. Deze sleutel hoort **alleen op de server**, niet in GitHub.
6. **GitHub-omgeving `testflight`:** repository → Settings → Environments → *New environment* `testflight` (zet optioneel *Required reviewers* aan, jijzelf). Voeg als *environment secrets* toe:
   - `ASC_KEY_ID` – Key ID van stap 4
   - `ASC_ISSUER_ID` – Issuer ID van stap 4
   - `ASC_API_KEY_P8_BASE64` – inhoud van die `.p8`, base64 (`base64 -i AuthKey_XXXX.p8 | pbcopy` op een Mac)
   - `IOS_TEAM_ID` – je Team-ID (Membership)
7. **Server-env (Portainer, door jou; ik wijzig de stack niet):**
   - `APNS_KEY_P8` (of een gemount bestand via `APNS_KEY_P8_FILE`), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=nl.ringapeldoorn.ringtools`; `APNS_PRODUCTION=true` (TestFlight en App Store gebruiken **altijd** productie-APNs).
   - `APPLE_APP_ID=<TEAM-ID>.nl.ringapeldoorn.ringtools` (voor Universal Links en native passkeys via `/.well-known/apple-app-site-association`).
   - Herstart de app-container pas na een back-up (`docs/BACKUP-HERSTEL.md`).
8. **Build starten:** GitHub → Actions → **iOS TestFlight (handmatig)** → *Run workflow* (laat *upload* aan). Eerste run: versie `1.0.0`, buildnummer leeg (= runnummer). Bij een fout in de signing staat in de log welke Apple-instelling ontbreekt.
9. **Verwerking:** na de upload verwerkt App Store Connect de build (5–20 min); je krijgt een e-mail. TestFlight → *iOS builds*. Er is bij de eerste build geen exportcompliance-vraag meer (staat in `Info.plist`).
10. **Testers:** App Store Connect → TestFlight → *Internal Testing* → **+** groep "Intern" → voeg jezelf (account met rol Admin/App Manager/Developer) toe en kies de build. Intern testen heeft geen Apple-review nodig.
11. **Installeren op je iPhone:** installeer de app **TestFlight** uit de App Store, open de uitnodigingsmail (of de TestFlight-app) met hetzelfde Apple-ID → **Installeer** bij Ringtools. Verwijder eerst de oude persoonlijke testversie (`….ringtools.dev`) om verwarring te voorkomen; haar data en push zijn niet te hergebruiken.

## Controles die de workflow zelf doet

`ios-testflight.yml` stopt als iets niet klopt: tests/build/`check:native-config`; Release-archive met automatische signing; IPA bevat `aps-environment = production`, `applinks:` en `webcredentials:`; geen `get-task-allow`; bundle-ID, versie en buildnummer kloppen; privacymanifest aanwezig. Daarna uploadt `altool` naar TestFlight. De API-sleutel staat alleen tijdelijk op de runner en wordt nooit geprint. De gewone CI (`mobile-ci.yml`) maakt bij elke wijziging ook een **Release-archive zonder signing** om Release-fouten vroeg te vangen.

## Pushmeldingen (APNs)

- Registratie: de app vraagt toestemming, ontvangt het apparaattoken via `AppDelegate` → `PushNotifications` en meldt het aan `/devices/register`; bij uitloggen, sessie-intrekking of een ongeldige-tokenreactie (`410`, `BadDeviceToken`, `Unregistered`) verwijdert de server het token.
- Backend: APNs-token-authenticatie (ES256 JWT) met sleutel uit server-env, HTTP/2, `apns-topic` = bundle-ID, productie of sandbox via `APNS_PRODUCTION`. **Eén server bedient één omgeving**: TestFlight en App Store → productie.
- Inhoud: uitsluitend generieke tekst en een intern pad; geen namen of roepingen. Het vergrendelscherm toont dus niets vertrouwelijks.
- Webpush (PWA) is een aparte route en wordt niet geraakt.
- *Niet aantoonbaar zonder fysiek toestel:* daadwerkelijke levering. Test na de eerste build op de iPhone (zie checklist).

## Acceptatiechecklist eerste TestFlight-build (iPhone)

Gebruik uitsluitend de testgegevens van **Ring Apeldoorn**; laat Ring Den Haag en andere ringen ongemoeid.

1. App start zonder crash; app-icoon en naam kloppen (geen "dev").
2. Inloggen met e-mailcode (en MFA waar die geldt); app sluiten en openen → nog ingelogd.
3. Face ID/appvergrendeling vraagt na 30 s op de achtergrond; vóór de ontgrendeling is niets zichtbaar; app-switcher toont het schermscherm.
4. Face ID-inrichting (alleen als de serverlags aan staan; staan uit): niets ongevraagd.
5. Ringisolatie: gebruiker van Ring Apeldoorn ziet niets van andere ringen.
6. Meldingen in de app (bel) verschijnen en openen het juiste voorstel/dossier.
7. **Push:** toestemming geven; een melding uitlokken (bijv. een ondersteuningsverzoek) → melding zonder namen; tikken opent het voorstel; uitloggen → geen pushes meer.
8. Deeplink: een e-maillink naar een voorstel opent de app (koud, achtergrond, draaiend). Controleer eerst dat `https://ringapeldoorn.nl/.well-known/apple-app-site-association` jouw `Team-ID.nl.ringapeldoorn.ringtools` toont.
9. Voorstel indienen/ondersteunen, ontheffing, gezamenlijk akkoord: gedrag ongewijzigd.
10. Vliegtuigmodus: duidelijke offlinemelding, geen vertrouwelijke gegevens in de cache.

## Resterende beperkingen

- App-record, App ID en sleutels kunnen niet vanuit deze repository worden aangemaakt (Apple-aanmelding met tweefactor).
- Publieke App Store-release staat bewust uit (andere procedure, reviewgegevens, `docs/STORE-PRIVACY.md`).
- Een iOS-build kon in de ontwikkelomgeving niet lokaal worden uitgevoerd (geen macOS/Xcode); de macOS-CI doet de simulatorbuild en de Release-archive zonder signing.
