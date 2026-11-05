# Native passkeys en MFA in de Capacitor-app

**Status (C5.2): server, API, clientarchitectuur, de native plug-in (Capawesome 0.1.2) met adapter en de automatische tests zijn gebouwd; de functie staat standaard UIT
en is op geen enkel fysiek toestel getest.** Een passkey-ceremonie is alleen betrouwbaar te valideren op echte iOS- en Android-toestellen met geverifieerde
Associated Domains / Digital Asset Links. Wat daarvoor nodig is staat onderaan ("Wat nog moet gebeuren vóór activering"). Er is op geen enkel fysiek toestel getest.

## Beveiligingsuitgangspunten (onveranderd)
- Een account met verplichte MFA krijgt **nooit** een volledige sessie op de e-mailcode alleen. Het beheerdersaccount (webmin) blijft apart op wachtwoord + TOTP en gebruikt geen passkeys in de app.
- Een sessie zonder bewezen tweede factor (`mfaAt = null`) is op elke gewone route onbruikbaar (`401`); het beheerdersaccount krijgt `403` op de gebruikers-API.
- De app adviseert nergens MFA uit te schakelen (AGENTS.md). Ontbrekende ondersteuning geeft altijd de veilige melding: *"Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd."*

## Gebouwde stroom (achter de functievlag `NATIVE_PASSKEYS_ENABLED=true`, standaard `false`)
1. `POST /auth/login` (e-mailcode, eenmalig, rate-limited). Voor een account met `mfaEnabled`:
   - vlag uit → ongewijzigd `403 mfa-not-supported` (code verbruikt, geen sessie);
   - vlag aan, geen passkey geregistreerd → `403 mfa-enrollment-required` (registreren blijft webapp-only: dat vereist een recente MFA-verificatie);
   - vlag aan, passkey aanwezig → `200 { mfaRequired: true, method: "passkey", pendingToken, expiresAt }`: een **pending-login** (sessie met `mfaAt = null`, 10 min). Per gebruiker bestaat maximaal één wachtende app-login; wachtende weblogins blijven onaangeroerd.
2. `POST /auth/mfa/passkey/options` (Bearer = pendingToken) → WebAuthn-opties; challenge 5 min, eenmalig, per gebruiker; ≤10 aanvragen per 15 min.
3. De app voert de native passkey-ceremonie uit (`mobile/src/lib/passkeys.ts`, interface `PasskeyProvider`).
4. `POST /auth/mfa/passkey/verify` `{ response }` → de server verifieert met `@simplewebauthn/server`: RP ID, toegestane origins, challenge, `userVerification: required`, handtekening en tellerregressie.
   Alleen bij succes: pending-sessie vervalt, **nieuw** token (sessierotatie, geen sessiefixatie), `mfaAt` = nu, auditregel `MFA_VERIFIED`. Een passkey van een ander account wordt geweigerd.
5. `POST /auth/mfa/cancel` ruimt een pending-login direct op (geannuleerde ceremonie; idempotent).
6. Herverificatie voor gevoelige beheeracties van een ingelogde MFA-gebruiker: `POST /auth/reauth/passkey/options|verify` (roteert de sessie).
7. Misbruikbeperking: ≥5 mislukte verificaties binnen 15 min → pending-login verwijderd en het account 15 min vergrendeld voor nieuwe app-logins (in-memory, één serverinstantie; TOTP van de webmin heeft zijn eigen persistente lockout).
8. `/meta` meldt `nativePasskeys` zodat de app weet of de server de functie aan heeft.

### Toegestane origins (`src/lib/webauthn.ts`, `allowedOrigins`)
- **Webapp:** uitsluitend `APP_BASE_URL` (bijv. `https://ringapeldoorn.nl`). RP ID = hostnaam daarvan.
- **Native route:** `APP_BASE_URL` (iOS-app-passkeys hebben origin `https://<RP ID>`) **plus** per vingerafdruk in `ANDROID_SHA256_FINGERPRINTS` de origin `android:apk-key-hash:<base64url(SHA-256)>`. Geen wildcard; ongeldige vingerafdrukken worden genegeerd; zonder configuratie is er geen Android-origin. Een Android-origin wordt in de webapp-verificatie nooit geaccepteerd.
- `/.well-known/apple-app-site-association` krijgt (alleen met `APPLE_APP_ID`) `webcredentials.apps`; `assetlinks.json` krijgt (alleen met vingerafdrukken) ook `delegate_permission/common.get_login_creds`. Zonder configuratie blijven beide leeg: er wordt niets verzonnen.

### Client (`mobile/src`)
- `lib/passkeys.ts`: `PasskeyProvider`-interface, registratiepunt (`registerPasskeyProvider`) en `passkeysUsable(serverEnabled, limitedBuild)`. De Capawesome-adapter (`lib/capawesomePasskeys.ts`) registreert zich alleen native en niet in de Personal Team-build.
- `lib/buildProfile.ts`: `passkeys` is `false` in het profiel `personal-team` (de gratis Apple Personal Team heeft geen Associated Domains en dus geen `webcredentials`).
- `Login.tsx`: bij `pendingToken` volgt de passkey-stap; zonder provider/zonder beschikbaarheid wordt de pending-login opgeruimd en de veilige melding getoond; geannuleerd → opnieuw proberen of annuleren; fout/vergrendeling netjes getoond.
- Sessietokens staan uitsluitend in Keychain/Keystore (`lib/storage.ts`); een pendingToken blijft alleen in het geheugen.

## Stand van zaken C5.2
| Onderdeel | Status |
|---|---|
| Server: pending-login, passkey-opties/-verificatie, annuleren, herverificatie, origin-allowlist, lockout, rate limits, audit, `/meta`-vlag | ✅ gereed en getest (echte WebAuthn-verificatie), functievlag UIT |
| Gelijktijdigheid (atomaire challenge, hooguit één sessie per pending-login/herverificatie) | ✅ gereed en getest |
| Client: `PasskeyProvider`-interface, passkey-stap in Login, herverificatie met passkey (`useReauth`) | ✅ gereed en getest |
| Native plug-in **`@capawesome/capacitor-passkeys` 0.1.2** (exact gepind, integriteit gecontroleerd) + adapter `mobile/src/lib/capawesomePasskeys.ts` | ✅ geïntegreerd en getest met gemockte plug-in; simulator-/debug-builds in CI |
| Productie-entitlement `webcredentials:ringapeldoorn.nl` in `App.entitlements` (Debug/Release); `Debug-PersonalTeam` onaangetast | ✅ voorbereid (zie hieronder) |
| Passkeys **registreren** in de app | bewust niet in C5.2 (blijft webapp-only: registratie vereist een recente MFA-verificatie; er is geen native registratie-API en de adapter gebruikt `createPasskey` niet) |
| Apple Team-ID / `APPLE_APP_ID`, Android-vingerafdrukken, toesteltests, `NATIVE_PASSKEYS_ENABLED=true` | ⛔ extern/eigenaar (zie "Nodig voor een fysieke passkeytest") |

## Gekozen plug-in en beveiligingsreview
Keuze eigenaar: **optie A, `@capawesome/capacitor-passkeys`**, exact `0.1.2` (laatste versie; peer `@capacitor/core >=8`, app gebruikt 8.6; `npm install --save-exact`; lockfile-integriteit
`sha512-egaDs8M1…Hw==` is gelijk aan het tarball dat voor de review is uitgepakt). Licentie MIT; **geen runtime-dependencies, geen install-/postinstall-scripts**; het pakket brengt geen `cap sync`-hook mee.
Native code is regel voor regel gelezen (iOS ±120 regels Swift, Android ±170 regels Java; `ios/Plugin`, `android/src/main`):
| Onderwerp | Bevinding |
|---|---|
| Netwerkverkeer | **Geen** (geen `URLSession`/`HttpURLConnection`/sockets/analytics). Alleen de systeemdiensten `ASAuthorizationController` (iOS) en AndroidX Credential Manager (+ `credentials-play-services-auth` 1.5.0, officiële Google-bibliotheken). |
| Gegevensverwerking | De challenge, opties en assertion gaan alleen tussen webview ↔ plug-in ↔ besturingssysteem. Er wordt niets opgeslagen (geen bestanden, geen Preferences). De plug-in leest/schrijft geen sessietokens; die blijven uitsluitend in Keychain/Keystore via `lib/storage.ts`. |
| Logging | iOS: `CAPLog.print("[Passkeys] ", error)`; Android: `Logger.error(TAG, message, exception)` — alleen de foutmelding/stack van het systeem, nooit challenge, credential of handtekening. Capacitor logt standaard alleen in debugbuilds (`loggingBehavior` niet overschreven). Onze adapter geeft technische foutteksten nooit aan de gebruiker door. |
| Foutafhandeling | Foutcodes `CANCELED`, `NOT_SUPPORTED`, `DOMAIN_NOT_ASSOCIATED`, `NO_CREDENTIAL`, `GET_FAILED`/`CREATE_FAILED` worden door de adapter vertaald (annuleren; niet ondersteund; domein niet gekoppeld; geen passkey; overig). Onbekend = gewone mislukking, nooit een sessie. |
| Beperkingen (risico, gemitigeerd) | (1) iOS `isAvailable()` geeft altijd `true` — de adapter vertrouwt daarom op de foutcodes. (2) iOS bewaart per instantie één lopende afhandeling: twee gelijktijdige aanroepen overschrijven elkaar — de adapter laat maar één ceremonie tegelijk toe. (3) Android geeft de volledige optie-JSON door aan Credential Manager (onbekende velden worden genegeerd) — de adapter geeft alleen `challenge`, `rpId`, `allowCredentials` (zonder transports), `timeout` en `userVerification:"required"` door. (4) Het plug-inresultaat bevat geen `clientExtensionResults` — de adapter vult `{}`. (5) 0.x-versie: API kan breken — exact gepind en achter onze `PasskeyProvider`-interface. |
| Vertrouwensgrens | De plug-in beslist niets: de server geeft de challenge uit en verifieert alles (RP ID, origin, user verification, handtekening, teller, eenmalige challenge). De adapter weigert bovendien opties waarvan de `rpId` niet exact de eigen backendhost is of waarvan de challenge geen geldig base64url is, vraagt altijd user verification en begrenst de time-out. |
| `npm audit` | Productie (`--omit=dev`): **0**. Volledig: 4 *moderate* (`uuid` via `@capacitor/assets`, een dev-hulpmiddel voor icoongeneratie) — aanwezig vóór en na het toevoegen van de plug-in; niet gerelateerd, niet in de app-bundel. |
Geen blokkerende beveiligings- of compatibiliteitskwestie gevonden; daarom is doorgegaan met de integratie.

## Adapter (`mobile/src/lib/capawesomePasskeys.ts`)
- `createCapawesomeProvider(plugin, expectedRpId)` implementeert `PasskeyProvider.authenticate` (alleen authenticatie). `registerCapawesomePasskeys` (aangeroepen in `main.tsx`) koppelt de provider **uitsluitend** op een native toestel en **niet** in de Personal Team-build (`nativeCapabilities().passkeys`). Het koppelen schakelt niets in: zolang `NATIVE_PASSKEYS_ENABLED` uit staat geeft de server voor MFA-accounts `403 mfa-not-supported` en blijft de veilige melding zichtbaar.
- Foutafhandeling in de UI (`Login.tsx`, `useReauth`): annuleren → opnieuw proberen of annuleren (pending-login wordt opgeruimd); niet ondersteund / domein niet gekoppeld → pending-login opgeruimd en veilige melding (nooit een advies om MFA uit te zetten); geen passkey of overige fout → opnieuw proberen; netwerkfout → melding en opnieuw proberen (de pending-login blijft 10 min geldig); een mislukte controle levert nooit een sessie op (de sessie ontstaat uitsluitend na `POST /auth/mfa/passkey/verify` op de server).

## Wijzigingen door `cap sync` (gecontroleerd)
Alleen de verwachte registratie van de plug-in, niets anders: `android/capacitor.settings.gradle` (+`include ':capawesome-capacitor-passkeys'`), `android/app/capacitor.build.gradle` (+`implementation project(':capawesome-capacitor-passkeys')`) en `ios/App/CapApp-SPM/Package.swift` (+package en product `CapawesomeCapacitorPasskeys`).
Geen wijziging aan `project.pbxproj`, `Info.plist`, `AndroidManifest.xml`, signing, schemes, `PersonalTeam.xcconfig` of de Personal Team-configuratie. De plug-in vraagt geen extra permissies (geen Face ID-/biometrie-sleutel in `Info.plist` nodig voor passkeys via `ASAuthorizationController`; Android: geen manifest-aanpassing).

## Voorbereiding productieconfiguratie (zonder aannames over ontbrekende gegevens)
- iOS: `ios/App/App/App.entitlements` (gebruikt door Debug en Release, **niet** door `Debug-PersonalTeam`) bevat naast `applinks:ringapeldoorn.nl` nu ook `webcredentials:ringapeldoorn.nl` (zelfde host; `configure-native.mjs` houdt beide gelijk). `check:native-config` en `verify-ios-configs.sh` (CI, macOS) controleren: Debug/Release **met** `webcredentials`; Personal Team **zonder** enige entitlement of Associated Domain.
- Server: `.well-known/apple-app-site-association` krijgt `webcredentials.apps` zodra `APPLE_APP_ID` is gezet; `assetlinks.json` krijgt `get_login_creds` naast `handle_all_urls` zodra `ANDROID_SHA256_FINGERPRINTS` is gezet. Zonder die waarden blijven de bestanden leeg: er is niets verzonnen.

## Nodig voor een fysieke passkeytest (iPhone en Android)
**Gegevens van de eigenaar (nooit door ons te verzinnen):**
1. **Apple Team-ID** van het betaalde developer-account en het definitieve bundle-ID → `APPLE_APP_ID=<TEAM-ID>.<bundle-id>` in de serveromgeving (Portainer-stack, handmatig door de eigenaar).
2. **Android-ondertekeningsvingerafdruk(ken) (SHA-256)** — van de sleutel waarmee de testbuild is ondertekend (debug-keystore voor een lokale test; bij Play App Signing de *app signing key*, niet de upload key) → `ANDROID_SHA256_FINGERPRINTS` (komma-gescheiden) en optioneel `ANDROID_PACKAGE` (standaard `nl.ringapeldoorn.ringtools`). Dezelfde vingerafdruk bepaalt ook de toegestane `android:apk-key-hash:`-origin op de server.
3. Het domein `ringapeldoorn.nl` moet `/.well-known/apple-app-site-association` en `/.well-known/assetlinks.json` zonder redirect als `application/json` serveren (zie `docs/MOBILE.md`).

**iPhone:**
- **Niet mogelijk met `App-PersonalTeam`** (gratis Personal Team: geen Associated Domains → `DOMAIN_NOT_ASSOCIATED`; de app registreert de provider daar bewust niet).
- Nodig: betaald Apple Developer Program, App ID met capability *Associated Domains*, een provisioning profile met die capability, een Debug-/Release-build met de productie-entitlements (die nu `webcredentials:ringapeldoorn.nl` bevatten) op een fysiek toestel met iOS 15+ en een ingestelde schermvergrendeling/biometrie; de iCloud-sleutelhanger (of een andere passkey-provider) staat aan.
- Voorwaarde op de server: `APPLE_APP_ID` gezet, AASA bereikbaar (iOS cachet het bestand via de Apple-CDN; na een wijziging kan het even duren).

**Android:**
- Fysiek toestel of emulator met Google Play-services, Android 9+ (API 28+), schermvergrendeling en een passkey-provider (Google Password Manager); build ondertekend met de sleutel waarvan de vingerafdruk is geconfigureerd; `adb shell pm get-app-links nl.ringapeldoorn.ringtools` toont de gekoppelde domeinen.

**Gezamenlijk, in deze volgorde:**
1. Account met `mfaEnabled` en een passkey (aangemaakt in de **webapp**, dezelfde RP ID).
2. Serveromgeving gezet (punten 1–2), `NATIVE_PASSKEYS_ENABLED=true` en `MIN_APP_VERSION` verhoogd (het antwoord van `/auth/login` verandert voor MFA-accounts van `403` naar `200 { mfaRequired }`). **Pas door de eigenaar, na akkoord.**
3. Testscenario's: inloggen (e-mailcode → passkey → ingelogd); annuleren; geen passkey op dit toestel; verkeerd account; verlopen pending-login (10 min); vliegtuigmodus tijdens de stap; herstart van de app in de passkey-stap; herverificatie bij een beheeractie; sessie-intrekking; webmin blijft TOTP.
4. Bevestig op het toestel dat zonder passkey **geen** sessie ontstaat en dat accounts zonder MFA ongewijzigd inloggen.
Een geslaagde CI-simulator- of debug-build bewijst **alleen** dat de plug-in compileert en de app start — niet dat passkeys op een fysiek toestel werken.

### Gelijktijdigheid
- De challenge wordt atomair verbruikt (`DELETE … RETURNING`; tweede verzoek vindt niets) en `promoteSessionToMfaVerified` verwijdert de wachtende/te verifiëren sessie in dezelfde transactie en eist `count === 1`: bij parallelle verzoeken met één assertion slaagt hooguit één en ontstaat precies één volledige sessie.
  Regressietests: `tests/nativeMfa.test.ts` ("Gelijktijdigheid", "Herverificatie met passkey"). De RP ID-, origin-, user verification- en tellercontroles zijn ongewijzigd.

## Activering (door de eigenaar)
`NATIVE_PASSKEYS_ENABLED` blijft **uit** tot de punten onder "Nodig voor een fysieke passkeytest" zijn afgerond. Passkeys **registreren** in de app blijft webapp-only totdat de toesteltests zijn geslaagd.

## Tests (CI, geen toestel) — `tests/nativeMfa.test.ts` (echte WebAuthn-verificatie met een software-authenticator, geen mocks)
Vlag uit; geen passkey; pending-login werkt nergens als sessie (o.a. `/me`, ringroutes, ontheffingen, admin); eenmalige code; geldige assertion (rotatie, teller, audit); ontbrekende/verkeerde/hergebruikte challenge; replay; verkeerde origin en RP ID;
Android-origin alleen native en alleen geconfigureerd; ontbrekende user verification; tellerregressie; verkeerd ceremonietype; passkey van ander account; misvormde assertion; annuleren; verlopen pending-login; gedeactiveerd account; webmin/web-pending/niet-MFA op de native route;
vergrendeling na mislukte pogingen; rate limiting; herverificatie met passkey. Client: `mobile/tests/passkeys.test.tsx`, `mobile/tests/reauthPasskey.test.tsx`, `mobile/tests/capawesomePasskeys.test.ts` (adapter met gemockte plug-in: opties, RP ID-/challengecontrole, user verification, foutcodes, één ceremonie tegelijk, registratie alleen native en niet in Personal Team).
