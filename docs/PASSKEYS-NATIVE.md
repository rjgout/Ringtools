# Native passkeys en MFA in de Capacitor-app – onderzoek en plan

**Status: niet geïmplementeerd.** Bewuste keuze: een passkey-ceremonie in een native app is alleen betrouwbaar te valideren op echte iOS- en
Android-toestellen met geverifieerde Associated Domains / Digital Asset Links. Dat kan hier niet volledig worden getest; een half geteste
MFA-implementatie is onverantwoord. Tot die tijd geldt:

- De bestaande server-side MFA-eisen blijven onverkort van kracht. `POST /api/mobile/v1/auth/login` weigert het beheerdersaccount en accounts
  met ingeschakelde passkey-verificatie (`403 mfa-not-supported`), **na** het verbruiken van de code, zonder sessie of token uit te geven.
- Een sessie zonder bewezen tweede factor (`mfaAt = null`) is als bearer onbruikbaar (`401`); het beheerdersaccount krijgt `403` op de app-API.
  Dit wordt getest in `tests/api.test.ts` ("MFA is via de mobiele API niet te omzeilen…").
- De app toont: *"Inloggen met een passkey wordt in de app nog niet ondersteund. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd."*
  **Er wordt nergens geadviseerd MFA uit te schakelen** (AGENTS.md verbiedt dat).

## Onderzoek (te verifiëren bij de start van de implementatie)
| Optie | Opmerking |
|---|---|
| `@capgo/capacitor-passkey` (major volgt Capacitor, 8.x) | Shimt `navigator.credentials.create/get` naar iOS `ASAuthorization` en Android Credential Manager. Op Android is de `origin` in `clientDataJSON` gebonden aan de app-handtekening (`android:apk-key-hash:…`), niet aan de website. |
| `capacitor-webauthn` 8.x | Eigen API (`startRegistration`/`startAuthentication`); iOS 16+, Android 9+ (API 28+). |
| Capawesome Passkeys | Ondersteunt Android/iOS/web; Capacitor-8-compatibiliteit niet bevestigd. |
Alle drie zijn externe plug-ins: beoordeel onderhoud, licentie en supply-chain-risico vóór gebruik, en pin versies.

## Vereiste server- en platformwijzigingen
1. **RP ID** blijft de registreerbare domeinnaam van `APP_BASE_URL` (nu `ringapeldoorn.nl`); de app gebruikt dezelfde RP ID zodat bestaande passkeys uit de webapp ook in de app werken.
2. **iOS – Associated Domains:** naast `applinks:` ook `webcredentials:ringapeldoorn.nl` in `App.entitlements`; `apple-app-site-association` krijgt `"webcredentials": { "apps": ["<TEAM-ID>.<bundle-id>"] }` (nu alleen `applinks`).
3. **Android – Digital Asset Links:** `assetlinks.json` krijgt naast `delegate_permission/common.handle_all_urls` ook `delegate_permission/common.get_login_creds` voor hetzelfde pakket en dezelfde vingerafdruk(ken).
4. **Server – toegestane origins:** `src/lib/webauthn.ts` accepteert nu alleen `APP_BASE_URL` als `expectedOrigin`. Voor native moet een **expliciete allowlist** komen: `https://<host>` (iOS) en `android:apk-key-hash:<base64url van de SHA-256 van het app-ondertekeningscertificaat>` (Android, uit `ANDROID_SHA256_FINGERPRINTS`). Geen wildcard; elke andere origin blijft geweigerd.
5. **Mobiele auth-flow (nieuw, MFA-compatibel):** `POST /auth/login` geeft voor een MFA-account **geen** token maar een kortlevende, enkelvoudig bruikbare *pending-login* (server-side sessie met `mfaAt = null`, alleen geldig voor `/auth/mfa/*`). Daarna `POST /auth/mfa/passkey/options` → native ceremonie → `POST /auth/mfa/passkey/verify`, dat pas bij een geldige assertion `promoteSessionToMfaVerified` uitvoert en dan het bearer-token uitgeeft. Hergebruik `verifyPasskeyAuthentication` en de bestaande challenge-opslag (5 min, enkelvoudig, per gebruiker). Een pending-sessie mag nooit andere routes bereiken (de huidige `authenticate()` blokkeert dat al).
6. **Passkey registreren in de app** blijft webapp-only totdat de bovenstaande flow bewezen is (registratie vereist een recente MFA-verificatie).
7. **Beheerdersaccount (webmin)** blijft webapp-only (TOTP).

## Benodigde tests (alle moeten slagen vóór release)
- Unit/integratie (CI, geen toestel): pending-login kan geen enkele andere route bereiken; verify zonder geldige assertion geeft geen token; hergebruikte of verlopen challenge faalt; verkeerde `origin`/RP ID faalt; allowlist accepteert precies de geconfigureerde web-/iOS-/Android-origins; teller-regressie faalt; MFA-account kan nooit een token krijgen via de code-login; rate limits; `mfaAt` wordt alleen na verify gezet.
- Contract: `shared/api-types.ts` uitgebreid + contracttest.
- Native (handmatig, fysiek toestel): passkey aanmaken in de webapp en inloggen in de iOS-app; idem Android (Google Password Manager / andere provider); gedrag zonder biometrie/schermvergrendeling; gedrag na herinstallatie; Associated Domains/Asset Links geverifieerd (`adb shell pm get-app-links`, Apple AASA-validator); geannuleerde ceremonie; meerdere passkeys.
- Beveiligingsreview van de nieuwe routes (ringisolatie raakt dit niet, maar identiteitsflow wel).

## Besluit
Implementeer pas als (a) een gekozen plug-in op beide platformen is geverifieerd op fysieke toestellen, (b) de bovenstaande server-tests groen zijn en (c) de eigenaar de definitieve app-ID's, Team-ID en vingerafdrukken heeft aangeleverd.
