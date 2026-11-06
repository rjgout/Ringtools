# Mobiele ontwikkeling en storepublicatie (Capacitor 8)

Ringtools heeft drie platforms: **Web/PWA** (beveiligde webomgeving voor bevoegde gebruikers, blijvend; de publieke website is informatief met knop Inloggen), **iOS** en **Android** (zie `AGENTS.md`). De apps zijn het primaire platform; de website vervangt ze niet en wordt niet uitgeschakeld. De iOS- en Android-app zijn
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

### Appvergrendeling (E3, gebouwd) en gepland
- **Gebouwd:** verplichte ontgrendeling bij koude start en na 30 s achtergrond (Face ID/Touch ID/biometrie of toestelcode), afscherming van de app-switcher, Android `FLAG_SECURE`, blokkade zonder toestelbeveiliging. Plug-ins `@aparajita/capacitor-biometric-auth` 10.0.0 en `@capacitor-community/privacy-screen` 8.0.0; toevoegingen: `NSFaceIDUsageDescription`, `USE_BIOMETRIC`. Details, review, werking en openstaande toesteltests: [`APP-ONTGRENDELING-ONTWERP.md`](APP-ONTGRENDELING-ONTWERP.md). `App-PersonalTeam` is ongewijzigd en werkt met dezelfde vergrendeling. Niet op een fysiek toestel getest.
- **Gepland (ontwerp):** hardwaregebonden sessietoken (stap 2) en vertrouwd-toestel-goedkeuring (number matching) voor web-MFA: [`WEB-MFA-ONTWERP.md`](WEB-MFA-ONTWERP.md).

### Nog niet geïmplementeerd (bewust)
- Native passkeys, uitnodigingsprocedure en ontheffingen in de app: zie `docs/MIGRATIE-APP-ONLY.md` (Fasen C–D). _Fase B is gerealiseerd_ (gebruikers- en ringbeheer, [webmin-login met TOTP: later verwijderd, systeembeheer is uitsluitend via de website], herverificatie): nog op een fysiek toestel te testen.
- _Fase A is gerealiseerd_ (nieuw voorstel, verantwoordelijken, herinneren, opnieuw vragen, ronde-deelnemers, taken, verwerken, verwijderen): nog op een fysiek toestel te testen.
- Passkeys/WebAuthn in de app en inloggen voor gebruikers met passkey-verificatie of het beheerdersaccount: gebruik voorlopig de webapp. Er is **geen** advies om MFA uit te schakelen. Plan en tests: [`docs/PASSKEYS-NATIVE.md`](PASSKEYS-NATIVE.md).
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

## iPhone-test met een gratis Apple Personal Team (zonder betaald account)

Een gratis **Personal Team** ondersteunt de capabilities *Push Notifications* en *Associated Domains* niet; Xcode weigert dan te
bouwen met "Personal development teams do not support the Associated Domains and Push Notifications capabilities". Daarom is er een
**aparte buildconfiguratie** voor je eigen iPhone. De productieconfiguratie (voor TestFlight/App Store) blijft ongewijzigd.

| | `Debug` / `Release` (productie-entitlements) | **`Debug-PersonalTeam`** (scheme *App-PersonalTeam*) |
|---|---|---|
| Entitlements | `App/App.entitlements` (aps-environment + Associated Domains) | **geen** (`CODE_SIGN_ENTITLEMENTS` leeg) |
| Native push | ja (met APNs-sleutels op de server) | **niet beschikbaar** |
| Universal Links (links uit e-mail openen de app) | ja (met AASA op de server) | **niet beschikbaar** – een link in een e-mail opent de browser/webapp |
| Inloggen met code, ingelogd blijven, voorstellen bekijken, ondersteuning uitbrengen | ja | **ja** (zelfde client, API, sessies en MFA-regels) |
| Bundle-ID | `nl.ringapeldoorn.ringtools` | `nl.ringapeldoorn.ringtools.dev` (zie hieronder) |

Hoe het is opgebouwd (en waarom een `cap sync` het niet ongedaan maakt): de configuratie staat in `ios/PersonalTeam.xcconfig`, in het
Xcode-project (`Debug-PersonalTeam`) en in het gedeelde scheme `App-PersonalTeam`. `cap sync` overschrijft alleen
`ios/App/App/public`, `capacitor.config.json`, `config.xml` en `CapApp-SPM`. Een Xcode-buildfase ("Ringtools buildprofiel") zet in de app-bundel
`public/ringtools-build.js` met profiel `personal-team`; de client leest dat en toont een duidelijke melding, en roept de pushplugin dan
nooit aan (dus geen crash of hang). `npm run check:native-config` en, op macOS, `./scripts/verify-ios-configs.sh` (draait ook in CI) bewijzen dat
Debug/Release de productie-entitlements houden en `Debug-PersonalTeam` er geen heeft (effectieve entitlements en binary).

**Bundle-ID:** een gratis team geeft een bundle-ID vast aan dat team; een ID kan maar bij één Apple-team horen. Om te voorkomen dat je
productie-ID `nl.ringapeldoorn.ringtools` aan je Personal Team "vastzit" wanneer je later een betaald account neemt, gebruikt deze
testconfiguratie `nl.ringapeldoorn.ringtools.dev`. Liever toch de productie-ID? Zet `PRODUCT_BUNDLE_IDENTIFIER = nl.ringapeldoorn.ringtools` in
`ios/Local.xcconfig` (zie `ios/Local.xcconfig.example`; het bestand staat in `.gitignore`).

### Stappen (op je Mac)
1. Eenmalig: `brew install node@22`, Xcode installeren en openen, in Xcode → Settings → Accounts je Apple ID toevoegen (er verschijnt *Personal Team*).
2. Terminal:
   ```bash
   git clone https://github.com/rjgout/Ringtools.git && cd Ringtools/mobile    # of: git pull in je bestaande kopie
   cp .env.example .env          # zet VITE_API_URL op de https-URL van JOUW Ringtools-server (APP_BASE_URL)
   npm ci
   npm run build && npx cap sync ios
   npx cap open ios
   ```
   Draai `npm run build && npx cap sync ios` opnieuw na elke wijziging aan de client of de `.env`.
3. In Xcode: klik bovenin op het **scheme** (naast de Run-knop) en kies **App-PersonalTeam** (niet *App*).
4. Sluit je iPhone aan met een kabel, ontgrendel hem en kies **Trust**. Kies je iPhone in de **destination**-lijst naast het scheme. Zet op de iPhone *Instellingen → Privacy en beveiliging → Ontwikkelaarsmodus* aan en herstart indien gevraagd.
5. Klik links op het blauwe **App**-project → target **App** → tab **Signing & Capabilities**. Kies bovenaan de configuratie **Debug-PersonalTeam**, vink *Automatically manage signing* aan en kies als **Team** *Raphael Gout (Personal Team)*. Er mogen hier **geen** capabilities *Push Notifications* of *Associated Domains* staan (klik anders op het kruisje). Xcode schrijft je Team-ID in het project; **commit die wijziging niet**.
   - Alternatief zonder het project te wijzigen: zet `DEVELOPMENT_TEAM = <Team-ID>` in `ios/Local.xcconfig`.
6. Controleer in **Build Settings** (zoek *Code Signing Entitlements*) dat de waarde voor **Debug-PersonalTeam** leeg is.
7. Klik **Run** (▶︎, of ⌘R). Xcode bouwt en installeert op je iPhone.
8. Eerste keer: iPhone → *Instellingen → Algemeen → VPN en apparaatbeheer* → je Apple ID/ontwikkelaar → **Vertrouw**. Start de app opnieuw.
9. Een gratis Personal Team geeft apps **7 dagen** geldigheid; daarna opnieuw ▶︎ vanuit Xcode.

In de app zie je op het inlogscherm en onder *Profiel* de melding dat native push en Universal Links in deze testbuild niet beschikbaar zijn. Test: inloggen met e-mail + code uit de mail, de app sluiten en openen (nog ingelogd), voorstellen bekijken, ondersteuning uitbrengen. Links in e-mails openen de webapp in Safari.

> Simulatorbuild voor de Personal Team-configuratie: `npm run build:ios:simulator:personal`. Voor echte push/Universal Links en TestFlight is een betaald Apple Developer Program nodig (zie "Signing, TestFlight en Google Play Internal Testing").

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
### APNs: development versus production (en TestFlight)
- Een APNs-apparaattoken hoort bij **één** APNs-omgeving, bepaald door de `aps-environment`-entitlement waarmee de app is ondertekend:
  - **sandbox (development):** apps die rechtstreeks vanuit Xcode op een toestel draaien (development-provisioning, `aps-environment=development`, zoals in de repository).
  - **production:** **TestFlight- én App Store-builds**. Bij archiveren/exporteren voor App Store Connect zet Xcode de entitlement op `production` (distributie-provisioningprofiel). Een TestFlight-build gebruikt dus de **productie**-APNs, niet de sandbox.
- Server: `APNS_PRODUCTION=true` (standaard) → `api.push.apple.com`; `false` → `api.sandbox.push.apple.com`. Voor TestFlight en de store dus **true**. De server waarschuwt in de log als `false` is ingesteld. Eén server kan niet tegelijk tokens van beide omgevingen bedienen: test sandbox-builds met een aparte (test)omgeving.
- Controle van een gebouwde IPA: `unzip -q App.ipa -d x && codesign -d --entitlements :- x/Payload/App.app` moet `aps-environment` = `production` tonen (de handmatige release-workflow controleert dit automatisch en faalt anders).
- **Sleutels staan nooit in GitHub:** de APNs-`.p8` en de FCM-service-account-JSON horen alleen op de server (Portainer-omgevingsvariabelen, of als bestand gemount en via `APNS_KEY_P8_FILE` / `FCM_SERVICE_ACCOUNT_FILE` aangewezen). De GitHub-workflows hebben ze niet nodig; alleen `mobile-release.yml` gebruikt signing-secrets (certificaat/profiel), niet de pushsleutels.
- Valideer APNs-sandbox en APNs-production en TestFlight afzonderlijk op een echt toestel; ze zijn verschillende configuraties.

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
- `.github/workflows/mobile-ci.yml` – draait bij wijzigingen in `mobile/`, `shared/`, de mobiele backend (`src/lib/api/`, `auth.ts`, `nativePush.ts`, `push.ts`, `openLinks.ts`, `src/app/api/mobile/`, `src/app/.well-known/`, `prisma/`, de bijbehorende tests), `AGENTS.md` en `docs/MOBILE.md`: backend-regressietests met Postgres, client-typecheck/tests/build, `check:native-config`, Android **debug**-build (ubuntu) en iOS **simulator**-build (macOS-runner). Geen secrets, geen publicatie.
- `.github/workflows/mobile-release.yml` – **handmatig**; bouwt een ondertekende AAB / iOS-archive als de signing-secrets zijn ingesteld en uploadt ze alleen als artifact. Publiceert nooit naar de stores.

## Wat u zelf live moet testen
Zie de lijst onderaan `docs/STORE-PRIVACY.md` ("Handmatige acceptatietests").

## Ontheffingen (API, Fase C4)
Alle routes onder `/api/mobile/v1`, bearer-sessie met MFA-gate; webmin krijgt overal 403. **Elke `/admin/…`-route is gesloten (410 `admin-web-only`): systeembeheer gebeurt uitsluitend via de website.**
- `GET/POST /ontheffingen?ring=` (lijst / nieuw concept), `GET/POST /ontheffingen/:id` (weergave / concept wijzigen), `POST /ontheffingen/:id/submit` (idempotent), `/delete` (bevestiging verplicht), `/vote`, `/release` (idempotent),
  `/group-decision` (presidium: `presentUserIds` verplicht), `/review` (openstaand dossier aanhouden), `POST /ontheffingen/persons/:pid/{inform|announce|process|rename}` (`announce` vereist `thanksOffered: boolean`).
- Een betrokkene, een niet-deelnemer, een lid van een andere ring en een concept van iemand anders krijgen exact hetzelfde antwoord (403) als bij een onbestaand dossier.
- Dashboard bevat `ontheffingen: { needsMyVote, open }` met dezelfde zichtbaarheid; meldingen dragen `ontheffingId` (geen `callingId`) en zijn generiek. Deeplink: alleen het interne pad `/ontheffingen/<id>` (pushtik in de app),
  bewust geen universal link/app link en geen e-maillink (`apple-app-site-association` ongewijzigd).

`POST /callings/:id/group-decision` (fase `PRESIDIUM`): `presentUserIds` (leden van het ringpresidium die het besluit namen) is verplicht; secretaris/administrateur registreren alleen.

## Uitnodigingen en native MFA (C5)
- Beheer (bearer, ringbeheerder eigen ring; verse herverificatie vereist): `GET/POST /rings/:id/invitations`, `POST /invitations/:id` (wijzigen), `/invitations/:id/resend`, `/invitations/:id/revoke`. De lijst bevat nooit token of code.
- Ontvanger (geen sessie): `POST /invitations/preview {token}` en `POST /invitations/activate {token}` of `{email, code}`. Het token staat in de body, nooit in de URL. Antwoord: `{ ok, email, ringName, mfaRequired, signedIn }`. Zonder verplichte MFA bevat het antwoord direct een gewone volledige sessie (`token`, `expiresAt`, plus `user/rings/pendingCount` zoals bij een login; alleen in de JSON-respons, `no-store`); met verplichte MFA of zonder expliciet `issueSession:true` (onder andere bij oudere apps en als er al iemand is ingelogd) is `signedIn:false` en geen token. De app bewaart het token in Keychain/Keystore en gaat na een korte bevestiging naar het overzicht.
- Link in de uitnodigingsmail: `https://<host>/uitnodiging/<token>` (Universal Link/App Link; AASA en `AndroidManifest.xml` bevatten het pad `/uitnodiging/`; `check:native-config` bewaakt dat). Zonder werkende link: handmatige invoer van e-mailadres + activeringscode in de app.
- Native passkeys: plug-in `@capawesome/capacitor-passkeys` 0.1.2 (exact gepind) achter `PasskeyProvider`; `cap sync` voegt alleen de plug-in toe aan de Gradle-/SPM-bestanden. In `App.entitlements` (Debug/Release, niet Personal Team) staat naast `applinks:` nu `webcredentials:<host>`. Functievlag `NATIVE_PASSKEYS_ENABLED`, standaard uit: `POST /auth/login` geeft voor MFA-accounts `{ mfaRequired, pendingToken }`, daarna `/auth/mfa/passkey/options|verify` en `/auth/mfa/cancel`; zie `docs/PASSKEYS-NATIVE.md`.

## Kerkelijke functies en catalogus (C4.5)
- Gebruikersbeheer (`/rings/:id/users`, `/memberships/:id`) kent `churchFunctionCode` (functie, los van de Ringtools-rol) en `appointAuthority` (machtiging: alleen `AANGEWEZEN_RAADGEVER` bij eerste/tweede raadgever en `AANGEWEZEN_HOGERAADSLID` bij hogeraadslid; `RINGPRESIDENT` wordt geweigerd: de functie volstaat).
  Zonder `churchFunctionCode` blijft de bestaande functie behouden.
- `GET /catalog/callings` (ringstaf en ringbeheerders van de eigen ring) (alleen-lezen catalogus met procedure, bevoegdheden, steunverlening, aanstellingsplicht, handboek en controlepunten.
- Concept-voorstellen: `suggestions.roepen/aanstellen` bevat `source` (`UNIT_STANDAARD`, `UNIT_VERANTWOORDELIJKE`, `FUNCTIE_RINGPRESIDENT`, `FUNCTIE_ENIGE_BEVOEGDE`) en `basis`; `eligible.*` bevat uitsluitend bevoegde leden.


## Vertrouwde toestellen en MFA-login in de app (E2.3, alle vlaggen UIT)

- **Inloggen met MFA:** `NATIVE_TOTP_LOGIN_ENABLED` (+ `WEB_TOTP_ENABLED`): na de e-mailcode volgt een TOTP-/herstelcodestap. Naast `NATIVE_PASSKEYS_ENABLED` (apart, toesteltest nodig; niet mogelijk in de Personal Team-build).
- **Toestel koppelen:** `TRUSTED_DEVICES_ENABLED`; knop "Toestel koppelen met een code" op het inlogscherm (handmatige invoer, geen camera). Plug-in `@perfood/capacitor-crypto-api` **8.0.0 exact gepind** achter `mobile/src/lib/deviceKey.ts` (vervangbaar). Sleutel: ECDSA P-256, iOS Secure Enclave (toegang: biometrie of toestelcode), Android StrongBox of TEE (fail-closed). Elke registratie krijgt een nieuw installatie-ID en een eigen tag. Geen logging van berichten/handtekeningen in de adapter (de plug-in zelf kan data en handtekening loggen; zie onderzoeksdocument). Transitieve Android-afhankelijkheden: `androidx.biometric`, `androidx.credentials`(+play-services-auth) via de Capacitor-versievariabelen; iOS: alleen `capacitor-swift-pm`.
- De aanwezigheid van de plug-in veroorzaakt geen nieuwe entitlements of manifestrechten voor de app-functies; `Debug-PersonalTeam` blijft zonder entitlements (Secure Enclave-sleutels vragen er geen).
- **Echte toesteltests nodig (niet gedaan in deze omgeving):** zie `docs/E2-3-ONTWIKKELPLAN.md` ("Echte iPhone-tests").
- **Ringtools ondersteunt vanaf deze release iOS 18 of nieuwer** (besluit eigenaar): alle zes `IPHONEOS_DEPLOYMENT_TARGET`-regels (ook `Debug-PersonalTeam`) en `ios/App/CapApp-SPM/Package.swift` (`.iOS(.v18)`; Capacitor genereert dit uit het deployment target, en `.v18` vraagt swift-tools-version 6.0: die staat daarom in `capacitor.config.ts` onder `experimental.ios.spm.swiftToolsVersion`) staan op 18. De plug-in `@perfood/capacitor-crypto-api` 8.0.0 vraagt zelf minimaal iOS 16; die eis wordt niet aangepast. `patch-package` (`mobile/patches/`, `postinstall`) verwijdert uitsluitend de logregels van de plug-in. Toestellen met iOS 17 of ouder kunnen de app niet meer installeren. Het minimum wordt periodiek herzien op basis van Apple's beveiligingsondersteuning (zie `AGENTS.md`, Releases). Draai na `npm install` altijd `npm run cap:sync`.

**Inlogscherm en servercapaciteiten (herstel na iPhone-test):** `Login` haalt `GET /meta` op via `useServerCapabilities` (automatische herpogingen na 1/2/4/8/15 s, ook als de eerste aanvraag door de appvergrendeling werd geblokkeerd; daarna "Opnieuw proberen"). Zolang dit niet bekend is toont het scherm "Inlogopties worden opgehaald…", nooit een gok. De tweede factor bepaalt altijd de server (`methods` uit de login-respons); ontbreekt die informatie, dan faalt de app gesloten (geen passkeyroute, geen TOTP-gok) en wordt de wachtende login opgeruimd. Als de server TOTP aanbiedt en passkeys niet bruikbaar zijn (o.a. de Personal Team-build), gaat de app na de e-mailcode rechtstreeks naar de authenticatorcode. Het inlogscherm toont versie, build-ID (git-commit) en serverhost om te controleren welke bundel en welke server de app gebruikt; geen geheimen.

**Inloggen met Face ID (E2.4a, vlag UIT):** op het inlogscherm verschijnt "Inloggen met Face ID" alleen als `/meta.deviceLogin` aan staat, dit een iPhone/iPad is en er een lokale toestelsleutel bestaat. Activeren: Profiel → "Inloggen met Face ID inschakelen" (vraagt recente tweede factor). Geen e-mailcode, geen terugval naar een zwakkere methode; bij annuleren of een ontbrekende sleutel wordt er niet ingelogd en volgt een herstelroute (inloggen met e-mailcode + authenticator, daarna opnieuw koppelen; een eventuele oude lokale sleutel wordt na een geslaagde nieuwe koppeling opgeruimd). Geen nieuwe entitlements; `App-PersonalTeam` ongewijzigd. Android: niet beschikbaar.
