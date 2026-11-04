# Privacy- en storevereisten (voorbereiding)

> Dit is een voorbereiding, geen juridisch advies. **Controleer de actuele eisen van Apple (App Review Guidelines, Privacy
> Nutrition Labels) en Google (Data Safety, beleid voor accountverwijdering) vlak vóór de release.** Concepttekst hieronder
> moet door de eigenaar/verwerkingsverantwoordelijke worden beoordeeld en aangevuld.

## Doel en doelgroep
Ringtools ondersteunt een kerkelijke ring bij het ondersteunen van roepingen (aanstellingen). Toegang uitsluitend **op uitnodiging**
(gebruikers worden door een ringbeheerder of de beheerder aangemaakt); er is geen openbare registratie en geen advertentie- of
trackingfunctionaliteit.

## Gegevensverwerking (inventaris)
| Gegeven | Doel | Waar | Bewaartermijn |
|---|---|---|---|
| Naam, e-mailadres, rol/functie, ringlidmaatschap | Account, autorisatie, notificaties | PostgreSQL (self-hosted) | Zolang lidmaatschap actief; verwijdering op verzoek |
| Roepingsvoorstellen (naam kandidaat, functie), stemmen/ondersteuning, taken | Kernfunctie | PostgreSQL | Verwerkte voorstellen worden 30 dagen na verwerking verwijderd |
| Ontheffingsdossiers (namen betrokkenen en raadgevers, functie, wijk/gemeente, besluitregistratie, tijdelijke accountkoppeling) | Procedure ontheffing | PostgreSQL | Verwerkt: 30 dagen na verwerking verwijderd (inclusief de accountkoppeling); concept: 30 dagen na laatste wijziging. Alleen zichtbaar voor ringstaf en deelnemers van de lopende ronde; nooit voor de betrokkene zelf; geen e-mail, geen namen in push |
| Sessietoken (gehasht op server; Keychain/Keystore op toestel), apparaatnaam/user-agent | Ingelogd blijven, apparaten beheren | PostgreSQL / toestel | 60 dagen inactiviteit, 180 dagen absoluut |
| Pushtoken (APNs/FCM), platform, installatie-ID | Pushmeldingen | PostgreSQL | Tot uitloggen/uitschakelen of ongeldig token |
| Web-push-abonnement (PWA) | Pushmeldingen web | PostgreSQL | Tot afmelden |
| Passkey-publieke sleutels, TOTP-geheim (versleuteld), herstelcodes (gehasht), beveiligingslogboek | MFA | PostgreSQL | Zolang account |
| E-mails (inlogcodes/-links, meldingen) | Communicatie | Eigen SMTP | Volgens mailprovider |

Geen verkoop van gegevens, geen derde-partij-analytics of -advertenties, geen locatie, contacten, foto's, microfoon of camera.
Pushlevering loopt via Apple (APNs) en Google (FCM) met alleen generieke tekst en een intern pad (geen namen/functies).
Verwerkers: eigen hosting (NAS), SMTP-provider, Apple/Google (push). Sluit waar nodig verwerkersovereenkomsten.

## Apple – App Privacy ("nutrition label") – concept
- **Data Linked to You:** Contact info (naam, e-mailadres); Identifiers (gebruikers-ID, apparaattoken voor push); User content (voorstellen/stemmen, functioneel).
- **Gebruik:** uitsluitend *App Functionality*; **geen** Tracking; geen Third-Party Advertising/Analytics.
- Uitzondering voor versleuteling: `ITSAppUsesNonExemptEncryption=false` (alleen standaard-HTTPS).
- Review Guideline **4.2 (Minimum Functionality)**: de app is geen website-wrapper; ze biedt native inloggen met veilige credentialopslag, pushmeldingen, deep links, offline-/foutafhandeling en ring-/ondersteuningsfunctionaliteit. Bouw geen decoratieve functies om review te omzeilen.

## Google Play – Data Safety – concept
- Verzamelde gegevens: *Persoonlijke info* (naam, e-mail), *App-activiteit/gebruikerscontent* (voorstellen, stemmen), *Apparaat- of andere ID's* (pushtoken). Alle: voor *app-functionaliteit*, niet gedeeld voor advertenties, niet verkocht.
- Gegevens versleuteld tijdens verzending (HTTPS): ja. Gebruikers kunnen verwijdering aanvragen: ja (zie hieronder).
- Doelgroep: volwassenen/leden van een kerkelijke ring; geen kinderen. Vul de inhoudsclassificatie en doelgroep in de Play Console zelf in.

## Accountverwijdering
Accounts worden niet in de app aangemaakt maar door de ring uitgenodigd; verwijdering gebeurt via de ringbeheerder/beheerder.
Document en publiceer een **webpagina met instructies en supportcontact** (vereist door Google voor een datasafety-formulier) en
overweeg een in-app "Verzoek tot verwijdering"-link (Apple-richtlijn 5.1.1(v) geldt voor apps waarin accounts worden aangemaakt; controleer de actuele tekst).
Op verzoek verwijdert de beheerder de gebruiker en bijbehorende apparaten/sessies/pushtokens (cascade in de database).
*Nog te doen door eigenaar:* verwijderverzoekpagina + supportadres kiezen.

## Te leveren storegegevens (niet in deze repo aanwezig)
- **Privacyverklaring** (publieke URL) en eventueel **gebruiksvoorwaarden**.
- **Supportcontact** (e-mail/URL) en marketing-URL (optioneel).
- **Appbeschrijving** (kort/lang), trefwoorden, categorie (Productiviteit/Lifestyle).
- **Screenshots** met fictieve gegevens: iPhone 6,9″ en iPad 13″ (indien iPad ondersteund), Android telefoon (en tablet). Gebruik uitsluitend fictieve namen.
- **App-icoon** (1024×1024 bron: `mobile/resources/icon.png`; gegenereerd via `npm run assets`).
- **Versiebeheer:** `versionName`/`MARKETING_VERSION` (semver, nu 1.0.0) en oplopende `versionCode`/`CURRENT_PROJECT_VERSION` per upload.

## Toegang voor reviewers (uitsluitend op uitnodiging)
Apple en Google vereisen dat reviewers de app kunnen gebruiken. Omdat inloggen via een e-mailcode loopt en er **geen
authenticatiebypass** mag bestaan, zijn er twee veilige opties; de eigenaar kiest:
1. **Aparte reviewomgeving** (eigen stack + eigen lege database, apart domein/`VITE_API_URL`-build of testflight-config) met uitsluitend **fictieve** ring, gebruikers en voorstellen, en een **mailbox voor reviewers** waarvan de inloggegevens in de reviewnotities staan, zodat de inlogcode ontvangen kan worden. Nooit echte roepingsgegevens of een publiek toegankelijke testomgeving met echte data.
2. Een tijdelijk, beperkt reviewaccount in diezelfde aparte omgeving, waarvan de mailbox door de eigenaar bewaakt wordt.
Leg in App Store Connect (App Review Information → Notes) en Play Console (App-toegang) uit dat de app op uitnodiging werkt en hoe de reviewer inlogt.
*Nog te doen door eigenaar:* reviewomgeving inrichten en seeden (fictief).

## Handmatige acceptatietests (op fysieke toestellen)
1. Installeren (TestFlight / Internal Testing), inloggen met code, app sluiten/openen → nog ingelogd.
2. E-mail met ondersteuningsverzoek ontvangen → link tikken: app opent het juiste voorstel (koude start, draaiende app, achtergrond); zonder app opent de browser.
3. Ondersteuning uitbrengen; resultaat verschijnt in de webapp. Gebruiker van een andere ring ziet het voorstel niet.
4. Pushmelding ontvangen (zonder namen), tikken opent het voorstel; geen dubbele melding op een toestel met PWA+app.
5. Meldingen per toestel uitzetten; uitloggen op afstand via "Aangemelde toestellen".
6. Vliegtuigstand: duidelijke offline-melding en herstel zodra er weer verbinding is.
7. Dark mode, iPad en kleine telefoon, grote tekst, toetsenbord bij inloggen, Android-terugknop.
8. Universal Links/App Links verificatie (`adb shell pm get-app-links`, Apple AASA-validatie) nadat de echte Team-ID en vingerafdrukken op de server staan.
