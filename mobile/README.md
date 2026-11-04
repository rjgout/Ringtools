# Ringtools – native iOS- en Android-app

Een echte app (React Native met [Expo](https://expo.dev), TypeScript) voor iPhone/iPad en Android.
De app praat met dezelfde Ringtools-server als de webapp, via een JSON-API (`/api/v1`) die dezelfde
regels, rechten en sessies gebruikt. De webapp blijft bestaan voor ringbeheer, gebruikersbeheer en
beveiligingsinstellingen.

## Wat de app kan

- Inloggen met je e-mailadres en een **inlogcode van 8 cijfers** (de link in de e-mail opent in de browser; de code werkt in de app).
- Blijvend ingelogd: het sessietoken staat in de iOS Keychain / Android Keystore en wordt bij het openen van de app verlengd en vernieuwd.
- Overzicht (wat wacht op jouw reactie, stand van zaken, aandachtspunten, jouw taken), lijst met voorstellen en filters.
- Voorstel bekijken, **Ondersteunen / Niet ondersteunen**, resultaten per persoon, **Herinnering versturen**, **Iedereen herinneren**,
  **Opnieuw ondersteuning vragen**, deelnemer uit de ronde verwijderen, taken toewijzen en afronden, markeren als verwerkt,
  **Voorstel verwijderen** (met de bevestigingstekst), nieuw voorstel aanmaken.
- Meerdere ringen met een ringwisselaar; elke ring blijft gescheiden (server-side afgedwongen).
- Meldingen (lijst) en **pushmeldingen** via Expo Push (APNs/FCM) zonder namen of functies; tikken opent het voorstel.
- **Universele links**: een link uit een e-mail (`/open/<token>`, `/roepingen/<id>`) opent direct de geïnstalleerde app (iOS Universal Links, Android App Links); zonder app opent hij gewoon in de browser.

Niet in de app (bewust, via de webapp): ringen aanmaken, gebruikers beheren, het beheerdersaccount (webmin), SMTP/instellingen en
beveiligingsinstellingen. Gebruikers met **passkey-verificatie ingeschakeld** kunnen nog niet in de app inloggen (passkeys in de app zijn nog niet gebouwd);
zij zetten die verificatie uit via Profiel → Beveiliging in de webapp of gebruiken de webapp.

## Bouwen op je MacBook (snelste route)

De builds draaien standaard in de **EAS-cloud** van Expo: je Mac hoeft daarvoor alleen Node.js te hebben (geen Xcode of Android Studio nodig).

**Eenmalig**
1. Installeer [Homebrew](https://brew.sh) en daarna Node: `brew install node@22`.
2. Een gratis account op [expo.dev](https://expo.dev); voor de store-versie ook een Apple Developer-account en een Google Play-ontwikkelaarsaccount.
3. Haal de code op en draai het installatiescript (het controleert alles, logt je in bij Expo, maakt het EAS-project en zet de variabelen in EAS):
   ```bash
   git clone https://github.com/rjgout/Ringtools.git && cd Ringtools/mobile
   cp .env.example .env        # zet EXPO_PUBLIC_API_URL op de https-URL van je Ringtools-server
   ./scripts/mac-setup.sh
   ```

**Bouwen** (telkens als de app zelf verandert)
```bash
./scripts/build.sh preview ios          # testversie voor je iPhone (via TestFlight/ad hoc; EAS vraagt bij de eerste keer om je Apple-login en regelt certificaten en push-sleutel)
./scripts/build.sh preview android      # APK: downloaden en direct op een Android-toestel installeren
./scripts/build.sh production all --submit   # store-versie bouwen én indienen (TestFlight / Google Play)
./scripts/build.sh production ios --local    # alternatief: op deze Mac bouwen (vereist Xcode); voor Android --local: Android SDK + JDK 17
```
De voortgang en de downloadlinks staan op expo.dev → je project → *Builds*. Het script voert vooraf de typecontrole en de tests uit.

**Na de eerste build nog te doen** (de uitleg staat in "Eenmalig instellen" hieronder):
- *App Store Connect*: maak de app aan met bundle-ID `nl.ringapeldoorn.ringtools` vóór de eerste `--submit`.
- *Google Play*: maak de app aan (`nl.ringapeldoorn.ringtools`); de eerste upload doe je handmatig via de Play Console (door Google vereist), daarna werkt `--submit`.
- *Pushmeldingen Android*: Firebase-project + `google-services.json`; zet dat bestand in EAS als bestand-variabele `GOOGLE_SERVICES_JSON` (`npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment production --environment preview --visibility secret`).
- *Universele links*: zet `APPLE_APP_ID` en `ANDROID_SHA256_FINGERPRINTS` op de server (stap 5 hieronder).

Problemen? `npm run doctor` controleert de projectinstellingen; `npx eas-cli build:list` toont de laatste builds.

## Eenmalig instellen (jij, met je Apple- en Google-account)

1. **Expo-account en project**: maak een gratis account op expo.dev, en in deze map:
   ```bash
   cd mobile
   npm ci
   npx eas-cli login
   npx eas-cli init          # maakt het EAS-project en geeft een project-ID
   ```
   Zet de uitkomst als GitHub-repositoryvariabele `EAS_PROJECT_ID` (en lokaal `export EAS_PROJECT_ID=...`).
2. **Server-URL**: zet de repositoryvariabele `EXPO_PUBLIC_API_URL` op de publieke **https**-URL van je Ringtools (gelijk aan `APP_BASE_URL`).
   De app en de universele links werken alleen met https en een echt domein.
3. **Apple**: `npx eas-cli credentials` / de eerste `eas build --platform ios` helpt je met inloggen bij je Apple Developer-account en maakt
   certificaten, provisioning en een APNs-sleutel aan (EAS beheert ze). Maak in App Store Connect een app aan met bundle-ID `nl.ringapeldoorn.ringtools`.
4. **Google**: maak in Play Console een app aan met pakketnaam `nl.ringapeldoorn.ringtools`; `eas build --platform android` maakt de ondertekeningssleutel.
   Voor pushmeldingen: maak een Firebase-project, voeg de Android-app toe en upload de FCM-service-account-sleutel met `eas credentials`.
5. **Universele links activeren** op je Ringtools-server (Portainer-stack, environment):
   - `APPLE_APP_ID` = `<TEAM-ID>.nl.ringapeldoorn.ringtools` (Team-ID staat in je Apple Developer-account);
   - `ANDROID_SHA256_FINGERPRINTS` = SHA-256-vingerafdruk van het app-ondertekeningscertificaat (Play Console → App-integriteit);
   - de server serveert dan `/.well-known/apple-app-site-association` en `/.well-known/assetlinks.json`. Controleer ze in de browser.
   - Het domein moet rechtstreeks bereikbaar zijn zonder omleiding naar een andere host.
6. **GitHub-secret** `EXPO_TOKEN` (expo.dev → Access tokens), zodat de workflow *Mobiele app (build en indienen)* kan bouwen.

## Bouwen en uitbrengen

```bash
# Interne testbuild (Android: APK, iOS: via TestFlight/ad hoc)
npx eas-cli build --platform all --profile preview
# Productie voor de stores
npx eas-cli build --platform all --profile production
npx eas-cli submit --platform all --profile production --latest
```

Of via GitHub: *Actions → Mobiele app (build en indienen) → Run workflow*. Een nieuwe versie van de **server** hoeft niet te wachten
op een nieuwe app, en de app hoeft alleen opnieuw te worden uitgebracht bij wijzigingen aan de app zelf.

## Ontwikkelen

```bash
cd mobile
npm ci
EXPO_PUBLIC_API_URL=https://jouw-server npx expo start     # Expo Go of een development build
npm test            # unit-tests (links, API-client)
npm run typecheck
```

Pushmeldingen en universele links werken alleen in een echte build op een fysiek toestel (niet in Expo Go of de simulator).

## Hoe de app met de server praat

- `POST /api/v1/auth/request-code` en `POST /api/v1/auth/login` (e-mail + code) → sessietoken (`Authorization: Bearer …`).
  Het token is een gewone Ringtools-sessie: dezelfde verlenging (60 dagen inactiviteit, 180 dagen absoluut), rotatie
  (`POST /api/v1/auth/refresh`), intrekken (uitloggen, deactiveren, beveiligingsreset) en apparaatlijst als in de webapp.
- Alle acties lopen door dezelfde bedrijfslogica en rechtencontroles als de webapp; een voorstel van een ring waar je geen lid van bent geeft `404`.
- Pushtokens (`POST /api/v1/devices`) worden bij uitloggen verwijderd. De server stuurt via de Expo Push-dienst alleen generieke tekst en een intern pad.
