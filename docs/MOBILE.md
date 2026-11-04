# Mobiele ontwikkeling en storepublicatie (Capacitor 8)

Ringtools heeft drie platforms: **Web/PWA**, **iOS** en **Android** (zie `AGENTS.md`). De iOS- en Android-app zijn
Capacitor 8-apps met een **lichte, gebundelde React-client** (`mobile/`) die via `/api/mobile/v1` met dezelfde backend
praat als de webapp. De app is geen wrapper om de website: er is geen `server.url`, de assets zitten in de app.

> Status: fundering. De app is **niet** App Store- of Play Store-ready (zie "Nog niet geïmplementeerd" en
> `docs/STORE-PRIVACY.md`). Er is niets gepubliceerd.

## Wat is er

| Onderdeel | Locatie |
|---|---|
| Client (Vite + React 19 + TypeScript) | `mobile/src` |
| Capacitor-config (geen `server.url`) | `mobile/capacitor.config.ts` |
| Native projecten | `mobile/ios` (SwiftPM), `mobile/android` (Gradle) |
| App-icoon/splash (bron) | `mobile/resources/{icon,splash}.png` → `npm run assets` |
| Mobiele API | `src/lib/api/` · route `src/app/api/mobile/v1/[...path]` |
| Gedeeld API-contract | `shared/api-types.ts` |
| Universele links (server) | `src/app/.well-known/apple-app-site-association`, `assetlinks.json` |
| Native push (server) | `src/lib/nativePush.ts` (APNs + FCM), `src/lib/push.ts` |
| Configuratiecontrole | `mobile/scripts/check-native-config.mjs` |

### Functies in de app nu
Inloggen (e-mail + 8-cijferige code), blijvend ingelogd (Keychain/Keystore, sessieverlenging + rotatie), ringwisselaar,
overzicht, voorstellen, voorstel bekijken, **ondersteunen / niet ondersteunen**, meldingen, pushregistratie per toestel,
aangemelde toestellen bekijken/intrekken, deep links (universele links, App Links, pushmelding-tik), offline-/foutstatus,
Android-terugknop, veilige schermranden, dark mode, native statusbar/splash/toetsenbord.

### Nog niet geïmplementeerd (bewust)
- Staf-acties in de app: nieuw voorstel, herinneren, taken, verwerken, verwijderen (nu in de webapp; API-routes bestaan al).
- Passkeys/WebAuthn in de app en inloggen voor gebruikers met passkey-verificatie of het beheerdersaccount (webapp).
- Biometrische ontgrendeling, offline cache van voorstellen, native delen in de UI (plugin is aanwezig, nog niet gebruikt).
- Eenmalige browser→app-authenticatieoverdracht: niet nodig; e-maillinks openen de app direct en de code-login werkt zonder cookies.
- Accountverwijdering in de app (zie `docs/STORE-PRIVACY.md`).
- Echte pushlevering: vereist APNs-/FCM-sleutels (zie "Pushconfiguratie"); niet getest met echte toestellen.

## Benodigde software (macOS)

- **Node.js 22** (`brew install node@22`), **Git**.
- **Xcode** (App Store, ≥ 16) + command line tools (`xcode-select --install`). Capacitor 8 gebruikt Swift Package Manager; CocoaPods is niet nodig.
- **Android Studio** (laatste stabiele) met Android SDK 36 en **JDK 21** (Android Studio bevat JDK 21).
- Optioneel: fysiek iPhone/Android-toestel met ontwikkelaarsmodus.

## Capacitor-commando's

```bash
cd mobile
npm ci
cp .env.example .env            # VITE_API_URL=https://ringapeldoorn.nl (publiek) ; app-ID's zijn voorlopig
npm run build                   # typecheck + gebundelde client in dist/
npm test                        # unit-tests van de client
npm run check:native-config     # controle van identiteit, links, privacy en geheimen
npx cap sync                    # kopieert dist/ en plugins naar ios/ en android/
npm run assets                  # genereert iconen/splash uit resources/ (na wijziging van de bron)
npm run ios                     # sync + open in Xcode
npm run android                 # sync + open in Android Studio
```

Het domein voor links wijzig je met `RINGTOOLS_APP_HOST=jouwdomein.nl node scripts/configure-native.mjs`
(past AndroidManifest en iOS-entitlements aan; moet gelijk zijn aan de host van `APP_BASE_URL`).

## Lokale testbuilds

- **Android (zonder signing):** `npm run build:android:debug` → `android/app/build/outputs/apk/debug/app-debug.apk`
  (draait op emulator/toestel). Vereist `ANDROID_HOME` of `android/local.properties` (`sdk.dir=…`), JDK 21.
- **iOS-simulator (zonder signing):** `npm run build:ios:simulator`, of in Xcode: scheme `App`, simulator kiezen, ▶︎.
- **Fysiek toestel:** in Xcode → target App → Signing & Capabilities → Team kiezen (Automatic signing); Android: toestel
  met USB-foutopsporing en ▶︎ in Android Studio. Pushmeldingen, universele links en Keychain/Keystore werken alleen
  betrouwbaar op een echt toestel.

> Wat zonder signing-referenties kan: web-/clientbuild, tests, `check:native-config`, Android **debug-APK**,
> iOS **simulatorbuild**. Wat signing vereist: iOS-archive/IPA, Android release-AAB (upload-keystore), TestFlight/Play-upload.

## Universal Links (iOS) en App Links (Android)

Eisen: e-maillinks (`https://<host>/open/<token>`, `/roepingen/<id>`) openen de geïnstalleerde app; zonder app werkt dezelfde
link in de webapp. Het token wordt alleen naar de eigen backend gestuurd en nooit gelogd.

1. Server-env (Portainer; **leeg laten tot je de echte waarden hebt**):
   - `APPLE_APP_ID` = `<TEAM-ID>.<bundle-id>` (Team-ID: Apple Developer → Membership).
   - `ANDROID_SHA256_FINGERPRINTS` = SHA-256 van het **app-ondertekeningscertificaat** (Play Console → App-integriteit; bij Play App Signing de *app signing key*, niet de upload key; kommagescheiden voor meerdere).
   - `ANDROID_PACKAGE` (standaard `nl.ringapeldoorn.ringtools`).
2. Controleer `https://<host>/.well-known/apple-app-site-association` en `/.well-known/assetlinks.json` (geen redirect, `application/json`).
3. iOS: de entitlement `applinks:<host>` staat in `mobile/ios/App/App/App.entitlements`; Associated Domains moet ook bij de App ID in het Developer-portaal aan staan.
4. Android: `android:autoVerify="true"` staat in `AndroidManifest.xml`; test met `adb shell pm get-app-links <package>`.
5. Gedrag in de app (`mobile/src/App.tsx`, `lib/links.ts`): koude start (`getLaunchUrl`), draaiende app en hervatten (`appUrlOpen`) en pushmelding-tik leiden naar `/roepingen/<id>` of `/open/<token>`. Alleen de eigen host en bekende paden worden herkend. Zonder sessie wordt de bestemming onthouden tot na het inloggen; autorisatie gebeurt altijd server-side.

## Pushconfiguratie

- **Web Push (bestaand):** VAPID, ongewijzigd.
- **Native:** `POST /api/mobile/v1/devices` registreert een toestel (platform, `deviceId`, token); de server kiest APNs (iOS) of FCM (Android). De app vraagt toestemming pas als de gebruiker op "Meldingen aanzetten" tikt.
- **Android (FCM):** Firebase-project → Android-app met je pakketnaam → `google-services.json` in `mobile/android/app/` (staat in `.gitignore`, **niet committen**) en een service-account-JSON op de server: `FCM_SERVICE_ACCOUNT_JSON`.
- **iOS (APNs):** Apple Developer → Keys → APNs-sleutel (`.p8`) → server-env `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (+ `APNS_PRODUCTION=false` voor sandbox/TestFlight-ontwikkelbuilds). Push-capability staat in de entitlements.
- **Geen dubbele meldingen:** een webabonnement van hetzelfde mobiele platform als een actief native toestel wordt overgeslagen (`webSubscriptionCoveredByNative`). Gebruikers kunnen per toestel meldingen uitzetten (`/devices/:id/active`).
- Meldingen bevatten alleen generieke tekst en een intern pad; nooit namen, functies of resultaten.

## Signing, TestFlight en Google Play Internal Testing

Betaalde accounts (door de eigenaar aan te maken):
- **Apple Developer Program** (≈ € 99/jaar) – App Store Connect, TestFlight, APNs-sleutels.
- **Google Play Console** (eenmalig ≈ US$ 25) – Play Internal Testing en publicatie.
- Firebase (gratis) voor FCM.

Eigenaar doet handmatig, **vóór** de eerste upload:
1. Definitieve **app-ID/bundle-ID** vaststellen (nu voorlopig `nl.ringapeldoorn.ringtools`); pas `RINGTOOLS_APP_ID`, Xcode en `applicationId` aan (en draai `check:native-config`). Na registratie bij de stores is dit niet meer te wijzigen.
2. **iOS:** App ID met Push Notifications + Associated Domains → app aanmaken in App Store Connect → in Xcode archiveren (Product → Archive) → Distribute → App Store Connect → TestFlight.
3. **Android:** upload-keystore genereren en veilig bewaren (`keytool`), `keystore.properties` lokaal (staat in `.gitignore`), `npm run build:android:aab` → `app-release.aab` uploaden in Play Console → Internal testing → testers toevoegen. Zet Play App Signing aan.
4. Storevermeldingen invullen (zie `docs/STORE-PRIVACY.md`), versies ophogen (`versionCode`/`CURRENT_PROJECT_VERSION`).
5. Pas na zorgvuldige tests op fysieke toestellen: productiereview indienen. Dit gebeurt nooit automatisch.

### CI
- `.github/workflows/docker-publish.yml` – web/Docker naar GHCR (ongewijzigd, alleen `main` publiceert).
- `.github/workflows/mobile-ci.yml` – client-typecheck/tests/build, `check:native-config`, Android **debug**-build (ubuntu) en iOS **simulator**-build (macOS-runner). Geen secrets, geen publicatie.
- `.github/workflows/mobile-release.yml` – **handmatig**; bouwt een ondertekende AAB / iOS-archive als de signing-secrets zijn ingesteld en uploadt ze alleen als artifact. Publiceert nooit naar de stores.

## Wat u zelf live moet testen
Zie de lijst onderaan `docs/STORE-PRIVACY.md` ("Handmatige acceptatietests").
