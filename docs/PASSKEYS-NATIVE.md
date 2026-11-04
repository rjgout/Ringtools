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

## Beoordeling plug-ins voor Capacitor 8 (gecontroleerd via het npm-register; niets geïnstalleerd)
| Pakket | Versie / laatst bijgewerkt | Licentie | Opmerking |
|---|---|---|---|
| `@capgo/capacitor-passkey` | 8.5.8 · 2026-10-26 (aangemaakt 2026-04) | MPL-2.0 | Peer `@capacitor/core >=8`; geen runtime-dependencies, geen install-scripts; shimt `navigator.credentials.create/get` naar iOS `ASAuthorization` en Android Credential Manager. Twee maintainers (Capgo). **Voorkeur**, na toesteltest. |
| `@capawesome/capacitor-passkeys` | 0.1.2 · 2026-09-02 | MIT | Jong (0.x), peer `>=8`, geen dependencies/install-scripts; Capawesome-team. Alternatief; API nog niet stabiel. |
| `capacitor-webauthn` | 8.0.0 · 2026-03-24 | MIT | Eén maintainer, GitLab; iOS 16+/Android 9+. Minste voorkeur. |
Bij de keuze: versie vastpinnen (geen `^`), lockfile reviewen, `npm audit`, en de broncode van de native delen (Swift/Kotlin) doorlopen vóór opname. Android-origin hangt af van de app-handtekening, niet van de website — zie de vingerafdrukken hierboven.

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
