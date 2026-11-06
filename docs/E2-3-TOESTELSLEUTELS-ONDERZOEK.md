# E2.3 – onderzoek: vertrouwde toestellen en hardwaregebonden sleutels (voor beslissing eigenaar)

**Status:** onderzoek afgerond, **nog niets gebouwd of gemerged**. Aanleiding om vóór de bouw te overleggen: de beveiligingsgaranties van de beschikbare plug-in zijn
beperkter dan de opdracht veronderstelt, en er zijn twee ontwerpconflicten. Branch: `claude/e2-3-vertrouwde-toestellen` (alleen dit document).

## 1. Beoordeelde plug-in: `@perfood/capacitor-crypto-api` 8.0.0
Enige gevonden onderhouden Capacitor-8-plug-in die niet-exporteerbare sleutels in Secure Enclave / Android Keystore aanmaakt en daarmee ondertekent.
Broncode van het npm-pakket gelezen (niet geïnstalleerd in het project).

| Eigenschap | Bevinding |
|---|---|
| Licentie / onderhoud | MIT; 3 maintainers; eerste release 2024-07, 8.0.0 op 2026-01-22; peer-afhankelijkheid alleen `@capacitor/core >=8` |
| Algoritme | ECDSA P-256 met SHA-256, handtekening ASN.1 DER (Android: base64 met regeleinden), publieke sleutel X.509/SPKI. Past op Node `crypto.verify` zonder extra bibliotheken |
| iOS | `SecKeyCreateRandomKey` met `kSecAttrTokenIDSecureEnclave`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`; privésleutel niet exporteerbaar; gebruikersverificatie per handtekening afgedwongen door de Secure Enclave via access control (`BIOMETRY`=`biometryCurrentSet`, `BIOMETRY_OR_PASSCODE`=`userPresence`). Zonder `type` heeft de sleutel **geen** gebruikersverificatie. In de simulator ontbreekt een Secure Enclave: aanmaken faalt (dus fail-closed) |
| iOS `hasSecureHardware()` | Geeft altijd `true` (hardgecodeerd), is dus **geen** bewijs |
| Android | `KeyGenParameterSpec`: StrongBox indien beschikbaar, anders TEE; daarna controle `KeyInfo.isInsideSecureHardware()` — bij `false` wordt de sleutel verwijderd en geweigerd. Dit is **fail-closed**: geen stille terugval op softwaresleutels |
| Android gebruikersverificatie | `setUserAuthenticationRequired(true)` met een **tijdvenster van 5 s** (`setUserAuthenticationParameters(5, …)`), niet per handtekening aan een `CryptoObject` gebonden. Elke biometrische verificatie door de app (bijvoorbeeld de appvergrendeling) autoriseert het gebruik van de sleutel gedurende 5 s. De plug-in toont daarnaast een `BiometricPrompt` bij een `InvalidKeyException`, maar dat is niet cryptografisch aan de handtekening gekoppeld |
| **Geen attestatie** | De plug-in levert alleen de publieke sleutel. Er is geen Android Key Attestation-keten en geen Apple App Attest. **De server kan dus niet verifiëren dat de sleutel in hardware staat**; een aangepaste of geroote client kan een softwaresleutel registreren. Hardwarebinding is alleen een eigenschap van de eerlijke app, niet bewijsbaar |
| Logging | `print`/`Log.i` schrijft tag, handtekening en het ondertekende bericht (de challenge) naar het systeemlogboek. Geen privésleutel, wel metadata. Niet aan te passen zonder fork of patch |
| Extra oppervlak | De plug-in bevat ook passkey-code (iOS `ASAuthorization`, Android `androidx.credentials` + Play Services auth). Ongebruikt, maar komt wel in de app. Geen nieuwe entitlements nodig zolang die functies niet worden aangeroepen |
| Webfallback | In de browser bewaart de plug-in sleutels in `localStorage`. Mag nooit op niet-native worden gebruikt (zou in de app worden afgeschermd) |
| Capacitor-proxyvalkuil | Plug-in nooit door een `async`-functie/`await` teruggeven (zie `docs/BUGFIX-IOS-SCHERMBESCHERMING.md`) |

**Conclusie:** geschikt voor *registratie met bewijs van bezit* (stap "sleutelpaar aanmaken, publieke sleutel + handtekening over een serverchallenge"). **Niet** geschikt om
de server te laten *vertrouwen* op hardwarebinding, en op Android is de gebruikersverificatie per handtekening zwakker dan op iOS. Een eigen kleine plug-in zou de
Android-verificatie kunnen verbeteren (per handtekening `CryptoObject`, `timeout 0`) en attestatie kunnen toevoegen, maar dat is ingrijpend en op deze omgeving niet te testen
(geen Xcode/toestel); daarom hier **niet** gebouwd.

## 2. Ontwerpconflicten die een besluit vragen
1. **Gebruikers met MFA kunnen nu niet in de app inloggen.** `NATIVE_PASSKEYS_ENABLED` staat uit, dus `/auth/login` weigert accounts met verplichte MFA. De opdracht eist
   (a) een bestaande, recent bewezen MFA-methode om te koppelen én (b) een ingelogde app. Voor een account met MFA sluiten die elkaar uit. Opties:
   - **A (aanbevolen):** de koppelcode zelf (alleen zichtbaar in een web-sessie met recente MFA) autoriseert de app; geen app-sessie vereist. Dit wijkt af van "app moet ingelogd zijn".
   - **B:** pairing alleen voor accounts zonder MFA en `registeredWithMfa=false` vastleggen; E2.4 vertrouwt dan alleen toestellen die met MFA zijn geregistreerd.
   - **C:** wachten tot native passkey-login in de app is geactiveerd (toesteltests nodig).
2. **QR-code scannen in de app** vraagt een camera-plug-in en een nieuwe cameratoestemming (store-/privacyimpact). Zonder scannen: handmatig invoeren van de code (QR op het web
   alleen als hulpmiddel voor het systeem-cameravenster niet bruikbaar). Voorstel: eerst alleen handmatige invoer; scannen later na akkoord.

## 3. Wat wél vast ligt (klaar om te bouwen na akkoord)
- Algoritme ES256 (P-256), sleutel-tag = willekeurige installatie-ID per registratie (hergebruik van een tag is nooit mogelijk; verweesde sleutels worden opgeruimd via `getECDSATags`).
- Registratie in twee stappen: **claim** (code + publieke sleutel → server geeft challenge, code atomair geclaimd, max. 5 pogingen per koppeling, 5 min geldig) en **complete**
  (handtekening over `ringtools-pairing-v1|pairingId|challenge|userId|installationId` met de nieuwe sleutel; pas dan wordt `TrustedDevice` aangemaakt).
- Tabellen `TrustedDevice` en `MfaPairing`, additief; geen wijziging van bestaande tabellen. Auditgebeurtenissen vragen drie nieuwe `SecurityEventType`-waarden
  (`ALTER TYPE … ADD VALUE`, onomkeerbaar; oudere code leest dat logboek nergens).
- Intrekken: recente MFA, atomair, ingetrokken sleutel wordt nooit meer geaccepteerd en kan niet opnieuw worden geregistreerd (publieke sleutel uniek).
- Functievlag `TRUSTED_DEVICES_ENABLED` (standaard uit); met de vlag aan is een toestel nog **geen** MFA-methode.
- Documentatie moet eerlijk vermelden: hardwarebinding is door de app gemeld en niet server-verifieerbaar; Android-verificatievenster 5 s; iOS Personal Team ondersteunt Secure Enclave
  zonder extra entitlements, maar dat is **alleen op een echte iPhone** te verifiëren (niet in de simulator).

## 4. Aanbeveling
1. Akkoord voor `@perfood/capacitor-crypto-api` (exact gepind) voor E2.3, met bovenstaande beperkingen duidelijk vastgelegd.
2. Kies A, B of C voor het MFA-versus-app-sessie-conflict.
3. Besluit over QR-scannen (cameratoestemming) of vooralsnog handmatig.
4. Plan vóór E2.4 een aparte stap voor **attestatie en per-handtekening-verificatie op Android** (eigen kleine Kotlin-uitbreiding of andere plug-in); E2.4 mag toestellen pas
   als MFA-methode vertrouwen als de hardwarebinding server-side is aangetoond.
