# Native passkeys en MFA in de Capacitor-app

**Status (C5.2): server, API, clientarchitectuur en automatische tests zijn gebouwd; de native passkey-ceremonie is bewust NOG NIET aan een plug-in gekoppeld
en de functie staat standaard UIT.** Een passkey-ceremonie is alleen betrouwbaar te valideren op echte iOS- en Android-toestellen met geverifieerde
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
- `lib/passkeys.ts`: `PasskeyProvider`-interface, registratiepunt (`registerPasskeyProvider`) en `passkeysUsable(serverEnabled, limitedBuild)`. **Er is geen provider geregistreerd.**
- `lib/buildProfile.ts`: `passkeys` is `false` in het profiel `personal-team` (de gratis Apple Personal Team heeft geen Associated Domains en dus geen `webcredentials`).
- `Login.tsx`: bij `pendingToken` volgt de passkey-stap; zonder provider/zonder beschikbaarheid wordt de pending-login opgeruimd en de veilige melding getoond; geannuleerd → opnieuw proberen of annuleren; fout/vergrendeling netjes getoond.
- Sessietokens staan uitsluitend in Keychain/Keystore (`lib/storage.ts`); een pendingToken blijft alleen in het geheugen.

## Stand van zaken C5.2 (gap-analyse)
| Onderdeel | Status |
|---|---|
| Server: pending-login, passkey-opties/-verificatie, annuleren, herverificatie, origin-allowlist, lockout, rate limits, audit, `/meta`-vlag | ✅ gereed en getest (echte WebAuthn-verificatie), functievlag UIT |
| Gelijktijdigheid (atomaire challenge, hooguit één sessie per pending-login/herverificatie) | ✅ gereed en getest |
| Client: `PasskeyProvider`-interface, passkey-stap in Login (annuleren, fout, vergrendeling, veilige terugval) | ✅ gereed en getest |
| Client: herverificatie voor gevoelige beheeracties met passkey (`useReauth`, `reauthWithPasskey`) | ✅ toegevoegd in deze ronde; MFA-accounts krijgen nooit de e-mailcode-route; getest |
| `.well-known` (`webcredentials`, `get_login_creds`) alleen met configuratie | ✅ gereed |
| Keuze en koppeling van een native plug-in (iOS `ASAuthorization`, Android Credential Manager) | ⛔ **wacht op jouw beslissing** (zie opties) |
| iOS: `webcredentials:`-entitlement in `App.entitlements` (productie), Apple Team-ID | ⛔ extern (betaald Apple-programma) + beslissing |
| Android: Digital Asset Links met release-vingerafdruk(ken) | ⛔ extern (Play Console) |
| Toesteltests iOS en Android | ⛔ pas mogelijk na bovenstaande |
| Passkeys registreren in de app | bewust niet (blijft webapp-only tot bovenstaande bewezen is) |

## Keuze native plug-in – opties en aanbeveling (er is niets geïnstalleerd)
Beoordeeld door de gepubliceerde pakketten alleen-lezen te inspecteren (`npm pack --ignore-scripts`, niets uitgevoerd of geïnstalleerd):
| | **A. `@capawesome/capacitor-passkeys` 0.1.2** | **B. `@capgo/capacitor-passkey` 8.5.8** | **C. `capacitor-webauthn` 8.0.0** | **D. Eigen dunne plug-in** |
|---|---|---|---|---|
| Licentie | MIT | MPL-2.0 (bestandsgebonden copyleft; als afhankelijkheid werkbaar) | MIT | eigen |
| Onderhoud | Capawesome-team; 0.x (jong, 2026-07), API nog niet stabiel | Capgo; 8.x, veel releases, twee maintainers | één maintainer, GitLab; minder recent | wij |
| Dependencies / install-scripts | geen / geen | geen / geen — **maar** een `cap sync`-hook (`scripts/configure-native.js`) | niet nader geïnspecteerd | — |
| Wijzigt het hún native project automatisch? | **Nee** — alle configuratie (entitlement, Digital Asset Links) doe je zelf en zichtbaar | **Ja, als er domeinen zijn geconfigureerd**: de hook schrijft `webcredentials:` in de entitlements, zet `CODE_SIGN_ENTITLEMENTS` in `project.pbxproj` en voegt Android-meta-data/-resources toe. Dat botst met onze regel dat entitlements en de Personal Team-configuratie nooit ongezien wijzigen; te neutraliseren met `autoShim:false`/geen domeinen | n.v.t. | nee |
| API | expliciet: `isAvailable()`, `getPasskey(opts)`, `createPasskey(opts)`; WebAuthn-JSON zoals onze server; foutcodes (`CANCELED`, `DOMAIN_NOT_ASSOCIATED`, `NOT_SUPPORTED`) | shimt `navigator.credentials.get/create` | eigen API | naar wens |
| Omvang native code | ±120 (Swift) + ±170 (Java) regels per kerndeel; geen netwerk-/logcode behalve `CAPLog` bij fouten | ±70 + ±90 regels | — | 2× ±150 regels + onderhoud |
| Platformen | iOS 15+, Android (Credential Manager; README: API 28+) | iOS 15+, Android minSdk 24 | iOS 16+, Android 9+ | — |
**Aanbeveling: A (`@capawesome/capacitor-passkeys`)**, exact vastgepind (geen `^`), na een regel-voor-regel review van de ±300 regels native code en `npm audit`. Redenen: geen automatische wijzigingen aan entitlements/projectbestanden (past bij onze Personal Team-/productieregels), expliciete en kleine API die 1-op-1 op de WebAuthn-JSON van onze server aansluit, geen afhankelijkheden, MIT.
Risico: 0.x-versie. Mitigatie: de plug-in zit achter onze `PasskeyProvider`-interface (wisselen = één adapter), versie vastgepind, adapter getest met gemockte plug-in, toesteltests vóór activering. **Terugvaloptie: B**, uitsluitend met `plugins.CapacitorPasskey.autoShim = false` en zonder `domains`/`origin`, zodat de hook niets in onze native bestanden schrijft. D alleen als A en B bij de toesteltests tekortschieten.
**Beslissing van jou nodig (zie rapport):** welke optie, en akkoord om de gekozen plug-in toe te voegen (dat wijzigt `mobile/package.json`/lockfile en, na `cap sync`, de native projecten — nieuwe native plug-in = store-/privacyimpact, `docs/STORE-PRIVACY.md`).

### Gelijktijdigheid
- De challenge wordt atomair verbruikt (`DELETE … RETURNING`; tweede verzoek vindt niets) en `promoteSessionToMfaVerified` verwijdert de wachtende/te verifiëren sessie in dezelfde transactie en eist `count === 1`: bij parallelle verzoeken met één assertion slaagt hooguit één en ontstaat precies één volledige sessie.
  Regressietests: `tests/nativeMfa.test.ts` ("Gelijktijdigheid", "Herverificatie met passkey"). De RP ID-, origin-, user verification- en tellercontroles zijn ongewijzigd.

## Wat nog moet gebeuren vóór activering (externe configuratie en toesteltests)
1. **Eigenaar levert aan:** definitieve app-ID, Apple Team-ID (`APPLE_APP_ID = <TEAM-ID>.<bundle-id>`), en de SHA-256-vingerafdruk(ken) van het Android-**release**-ondertekeningscertificaat (Play Console → App-integriteit; ook de Play-app-signing-sleutel) in `ANDROID_SHA256_FINGERPRINTS`.
2. **Apple Developer (betaald programma):** capability *Associated Domains* met `webcredentials:ringapeldoorn.nl` naast `applinks:`. Pas dan `ios/App/App/App.entitlements` aan (productie-entitlements blijven verder ongewijzigd); **niet** in `Debug-PersonalTeam`. Draai `npm run check:native-config` en `scripts/verify-ios-configs.sh`.
3. **Plug-in kiezen en koppelen:** adapter die `PasskeyProvider` implementeert en zich registreert (alleen in builds met `passkeys`-capability), `cap sync`, iOS-simulator- en Android-debug-build.
4. **Server:** `NATIVE_PASSKEYS_ENABLED=true` pas ná de toesteltests; verhoog daarbij `MIN_APP_VERSION` (het antwoord van `/auth/login` verandert voor MFA-accounts van `403` naar `200 { mfaRequired }`; oudere appversies kennen dat niet).
5. **Toesteltests (handmatig, nog niet gedaan):** passkey aanmaken in de webapp en inloggen in de iOS-app; idem Android (Google Password Manager of andere provider); geannuleerde ceremonie; geen biometrie/schermvergrendeling; herinstallatie; meerdere passkeys; verlopen pending-login; `adb shell pm get-app-links` / Apple AASA-validator; Associated Domains/Asset Links geverifieerd.
6. Passkeys **registreren** in de app blijft webapp-only totdat bovenstaande bewezen is.

## Tests (CI, geen toestel) — `tests/nativeMfa.test.ts` (echte WebAuthn-verificatie met een software-authenticator, geen mocks)
Vlag uit; geen passkey; pending-login werkt nergens als sessie (o.a. `/me`, ringroutes, ontheffingen, admin); eenmalige code; geldige assertion (rotatie, teller, audit); ontbrekende/verkeerde/hergebruikte challenge; replay; verkeerde origin en RP ID;
Android-origin alleen native en alleen geconfigureerd; ontbrekende user verification; tellerregressie; verkeerd ceremonietype; passkey van ander account; misvormde assertion; annuleren; verlopen pending-login; gedeactiveerd account; webmin/web-pending/niet-MFA op de native route;
vergrendeling na mislukte pogingen; rate limiting; herverificatie met passkey. Client: `mobile/tests/passkeys.test.tsx`.
