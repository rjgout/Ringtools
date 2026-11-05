# Verplichte beveiligde ontgrendeling van de Ringtools-app (iOS en Android) – E3 stap 1 (UI-vergrendeling) gebouwd; sleutelgebonden token nog NIET

> **Status:** de eigenaar heeft de keuzes vastgesteld (zie sectie 11) en toestemming gegeven voor **stap 1: veilige UI-vergrendeling** (Optie A, hieronder). Die is **gebouwd en geautomatiseerd getest, maar niet op een fysiek toestel getest** (zie sectie 12). De hardwaregebonden tokenbescherming (Optie B) is **niet** gebouwd; het concrete vervolgvoorstel staat in sectie 13. De `App-PersonalTeam`-build, signing, provisioning en entitlements zijn ongewijzigd.

## 1. Uitgangspunt (voorkeur eigenaar)
Vertrouwelijke gegevens (voorstellen, ontheffingen) mogen pas zichtbaar worden na **lokale ontgrendeling met biometrie of de toestelcode**. Geen aparte Ringtools-pincode als vervanging van de toestelbeveiliging. De vergrendeling is een **extra toegangscontrole**: ze vervangt geen serverauthenticatie, verplichte MFA of herverificatie bij gevoelige acties, en slaat geen biometrische gegevens op of verwerkt ze op de backend.

## 2. Wat er nu is
- Sessietoken, `deviceId` en ring staan in Keychain/Keystore via `@aparajita/capacitor-secure-storage` (iOS `afterFirstUnlockThisDeviceOnly`, `setSynchronize(false)`), **zonder** koppeling aan gebruikersverificatie: zodra het toestel na herstart eenmaal is ontgrendeld is het token voor de app leesbaar. Wie een ontgrendeld toestel in handen heeft ziet alles.
- `lib/resume.ts` (sessie hervatten met time-outs), `appStateChange`-listener in `lib/auth.tsx`, `lib/native.ts` (statusbalk/terugknop). Geen schermvergrendeling, geen bescherming van de app-switcher.

## 3. Gewenst gedrag
1. Koude start → **ontgrendelscherm** (neutraal, zonder namen/roepingen/ontheffingen). Er wordt **geen API-aanroep met gegevens** gedaan en geen gevoelige UI gerenderd vóór ontgrendeling.
2. Ontgrendelen: Face ID / Touch ID / vingerafdruk / gezicht of de toestelcode (officiële mechanismen, zie 5).
3. Terug uit de achtergrond: opnieuw vergrendelen na een instelbare **tolerantie** (voorstel: direct bij koude start; 0–60 s na achtergrond; waarde = beslissing eigenaar).
4. Annuleren of mislukken → app blijft vergrendeld; na herhaalde mislukkingen volgt de systeemuitwijkregeling (toestelcode); geen eigen telling die het systeem omzeilt.
5. Geldige accountsessie blijft; ontgrendelen veroorzaakt **geen** nieuwe e-maillogin.
6. Uitloggen: sessie en gevoelige lokale gegevens volgens bestaand beleid wissen (token, ring, pending push-ontkoppeling); de vergrendelinstelling zelf is geen gevoelig gegeven.
7. **Afzonderlijk behandelen:** koude start · resume uit achtergrond · terugkeer na push-tik/deeplink (eerst ontgrendelen, daarna pas navigeren; het doelpad wordt bewaard in geheugen) · herstart van het toestel · app-switcher.

## 4. Beveiligingseisen
- **Privacyscherm**: bij `inactive`/`background` meteen een neutraal scherm tonen en de snapshot van de app-switcher verbergen (iOS: overlay op `willResignActive`; Android: `FLAG_SECURE` en/of overlay; beide ook voor schermopnames op gevoelige schermen — keuze eigenaar).
- Geen gegevens in meldingen of lokale caches; er is nu geen offline cache van voorstellen (blijft zo).
- **Toestel zonder schermvergrendeling/biometrie**: de app moet dit detecteren (iOS `canEvaluatePolicy(.deviceOwnerAuthentication)`; Android `BiometricManager.canAuthenticate(BIOMETRIC_STRONG | DEVICE_CREDENTIAL)`) en dan **niet ongemerkt toegang geven**: duidelijke melding en keuze (beslissing): app blokkeren totdat een toestelcode is ingesteld, of uitloggen.
- Gewijzigde biometrische instellingen (nieuwe vingerafdruk/gezicht): bij sleutelgebonden bescherming (4a) wordt de sleutel ongeldig (`biometryCurrentSet`/`setInvalidatedByBiometricEnrollment`) → zwaardere herstelstap, zie 6.
- Verloren/gestolen toestel: sessie-intrekking op afstand bestaat al (`/sessions`); de vergrendeling komt daar náást.
- Fail-closed: bij fouten in de vergrendelcode blijft de app vergrendeld (geen "doorlaten bij twijfel"), met een eindtoestand "Opnieuw proberen / uitloggen" (nooit een eeuwig laadscherm, zie `lib/resume.ts`).

## 5. Native mogelijkheden (niets geïnstalleerd)
- **iOS**: `LocalAuthentication` (`LAContext.evaluatePolicy(.deviceOwnerAuthentication)` = biometrie met terugval op toestelcode). Face ID vereist `NSFaceIDUsageDescription` in `Info.plist` (Personal Team-compatibel; geen entitlement nodig).
- **Android**: `androidx.biometric.BiometricPrompt` met `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` (let op: de combinatie `DEVICE_CREDENTIAL` met `CryptoObject` is pas vanaf Android 11/API 30 ondersteund; permissie `USE_BIOMETRIC`).
- **Plug-ins (te beoordelen op licentie, Capacitor 8, broncode zoals bij de passkey-plug-in; nog niets gekozen):** `@aparajita/capacitor-biometric-auth` (heeft Capacitor 8-ondersteuning volgens de npm-beschrijving; levert een *prompt*, geen sleutelgebonden beveiliging), alternatieven van Capgo/Capawesome, of een **eigen kleine plug-in** die beide platformmechanismen aanroept. Dezelfde aanpak als de passkey-integratie: exact pinnen, adapter achter een eigen interface (`AppLockProvider`), buildprofiel respecteren.
- **Onafhankelijk van passkeys**: de vergrendeling heeft geen Associated Domains of `webcredentials:` nodig en kan dus ook in `Debug-PersonalTeam` werken; de Personal Team-build blijft volledig bruikbaar (de vergrendeling zou daar zelfs als eerste testbaar zijn). Raakt de native passkeyvlag niet.

## 6. Kernvraag: alleen de UI vergrendelen, of de sessiesleutel cryptografisch koppelen?
**Optie A – UI-vergrendeling.** Token blijft in Keychain/Keystore (zoals nu); de app toont niets vóór `evaluatePolicy`/`BiometricPrompt` slaagt.
 + Eenvoudig, robuust, werkt met bestaande ingelogde gebruikers zonder migratie, geen ongeldige-sleutelproblemen, geen risico op onbedoeld uitloggen.
 − Beschermt tegen iemand die de app opent, **niet** tegen een aanvaller met rootrechten/jailbreak of een app-binary-manipulatie die de controle overslaat: het token is dan nog leesbaar zodra het toestel eenmaal is ontgrendeld.

**Optie B – Sleutelgebonden token.** Het sessietoken wordt versleuteld met een hardwaresleutel die alleen na lokale verificatie bruikbaar is (iOS Keychain `kSecAccessControlUserPresence`/`.biometryCurrentSet` of Secure Enclave; Android Keystore `setUserAuthenticationRequired(true)`).
 + Aantoonbaar sterker: zonder verificatie is het token niet te lezen; past bij de hoge vertrouwelijkheid.
 − Migratie van bestaande ingelogde gebruikers (token opnieuw versleutelen; ze moeten eenmalig ontgrendelen), sleutel kan ongeldig worden bij wijziging van biometrie/toestelcode → opnieuw inloggen met e-mailcode (+ MFA) als **herstelpad**, complexiteit op Android (API-niveaus, `DEVICE_CREDENTIAL`), meer testtoestellen nodig, risico op uitsluiting als de implementatie fout gaat.

**Aanbeveling (ter beoordeling):** gefaseerd — **eerst Optie A** (waarde direct, laag risico), **daarna Optie B** achter een functievlag en met een duidelijke herstelroute; Optie B ook voor de apparaatsleutel van web-MFA-methode A (`WEB-MFA-ONTWERP.md`), omdat die toch hardwaregebonden moet zijn. Bestaande ingelogde gebruikers: bij de eerste start na de update vragen we éénmalig te ontgrendelen (A) resp. migreren we het token stil na een geslaagde ontgrendeling (B); bij een mislukte migratie → uitloggen en normaal opnieuw inloggen (geen dataverlies, de server bewaart alles).

## 7. Gebruiksgemak
Tolerantie na achtergrond (kort) in plaats van elke keer; ontgrendelen met één handeling; geen volledige login (e-mailcode/MFA) bij ontgrendelen; duidelijke teksten bij annuleren/uitval; Android-terugknop sluit de app op het ontgrendelscherm (geen omzeiling); 48 px-doelen, dark mode, veilige schermranden (bestaande ontwerpregels).

## 8. Risico's
| Risico | Maatregel |
|---|---|
| Alleen UI-lock omzeilbaar op geroot/gejailbreakt toestel | Optie B (fase 2); verwachtingsmanagement in documentatie |
| Gebruiker buitengesloten door ongeldige sleutel | Duidelijk herstelpad (uitloggen → e-mailcode + MFA); nooit gegevensverlies |
| Toestel zonder schermvergrendeling | Detectie + blokkeren/waarschuwen (beslissing) |
| Snapshot in app-switcher lekt namen | Privacyscherm op `inactive`/`background`, `FLAG_SECURE` |
| Deeplink/push-tik omzeilt vergrendeling | Doelpad bewaren, eerst ontgrendelen, dan navigeren; test per toestand |
| Regressie in resume/sessiehervatting | Eindtoestanden afdwingen; tests voor alle toestanden; buildprofiel respecteren |
| Plug-in-risico (0.x, onderhoud) | Exact pinnen, adapter, review, eventueel eigen plug-in |

## 9. Gefaseerde implementatie
1. **L1 Ontwerpbesluiten** (zie 10) + plug-in/eigen plug-in-review (geen installatie zonder toestemming).
2. **L2 Optie A:** `AppLockProvider`-interface + adapter, ontgrendelscherm, vergrendelstatus (geheugen), privacyscherm, toestelcontrole, vergrendelbeleid (koude start/resume), deeplink-/push-doelpad bewaren; tests (client: alle toestanden, geen API-aanroep vóór ontgrendelen; native config; Personal Team-profiel); CI iOS/Android.
3. **L3 Optie B** achter vlag (`APP_LOCK_BOUND_TOKEN`), migratie bestaande sessies, herstelroute, extra tests.
4. **Fase F:** toesteltests op iPhone (Face ID/Touch ID/code, Personal Team) en Android (verschillende API-niveaus/fabrikanten).

## 10. Beslissingen eigenaar (vóór implementatie)
1. Tolerantie na achtergrond (0 / 30 s / 60 s / 5 min)? Koude start altijd vergrendelen?
2. Optie A eerst en B later (aanbeveling), of direct B?
3. Toestel zonder schermvergrendeling: app blokkeren, of uitloggen?
4. Privacyscherm/`FLAG_SECURE`: ook op Android-schermopnames blokkeren?
5. Herstelprocedure bij ongeldige sleutel: opnieuw inloggen met e-mailcode + MFA (voorstel)?
6. Plug-in versus eigen kleine native plug-in; akkoord met review vóór installatie?
7. Geldt de verplichting ook voor `webmin` in de app en voor de Personal Team-testbuild?

## 11. Vastgestelde keuzes eigenaar (E3)
Verplicht voor alle appgebruikers en alle rollen (ook webmin) · koude start altijd ontgrendelen · na **30 seconden** in de achtergrond opnieuw ontgrendelen · Face ID/Touch ID/biometrie of de toestelcode · zonder toestelbeveiliging toegang blokkeren met uitleg · app-switcher onmiddellijk afschermen · Android-schermafbeeldingen blokkeren op vertrouwelijke schermen · Personal Team blijft ondersteund · herstel = gewoon opnieuw inloggen met bestaande authenticatie (en eventuele MFA) · eerst UI-vergrendeling, hardwaregebonden sleutelbescherming als afzonderlijke vervolgstap. Geen eigen Ringtools-pincode.

## 12. Uitvoering stap 1 (gebouwd)
### 12.1 Gekozen oplossing en beveiligingsreview (exact gepind, niets anders geïnstalleerd)
| Doel | Pakket (exact) | Licentie | Review |
|---|---|---|---|
| Systeemverificatie | `@aparajita/capacitor-biometric-auth` **10.0.0** | MIT | Native broncode integraal gelezen (iOS ±140 regels Swift, Android ±520 regels Java). Alleen `LocalAuthentication` (`deviceOwnerAuthentication` = biometrie met terugval op de toestelcode; `touchIDAuthenticationAllowableReuseDuration = 0`) resp. `androidx.biometric.BiometricPrompt` (`BIOMETRIC_STRONG`/`DEVICE_CREDENTIAL`). Geen netwerk, geen opslag (geen `UserDefaults`/`SharedPreferences`/bestanden), geen logging, geen analytics, geen installatiescripts. Dependencies: alleen `@capacitor/*` (^8). Eén extra transparante `AuthActivity` (+ `androidx.biometric 1.1.0`, appcompat, material). `checkBiometry` levert `deviceIsSecure` (iOS `canEvaluatePolicy(.deviceOwnerAuthentication)`, Android `KeyguardManager.isKeyguardSecure`) — gebruikt voor het blokkeren zonder toestelbeveiliging. Vereist `NSFaceIDUsageDescription` (toegevoegd). Eén beheerder; 10 majors → daarom exact gepind achter onze eigen `AppLockProvider`-adapter. |
| Afscherming | `@capacitor-community/privacy-screen` **8.0.0** | MIT | Native broncode gelezen. Android: `FLAG_SECURE` op het appvenster. iOS: bij `willResignActive` wordt synchroon een neutraal scherm over de app gelegd (vóór de momentopname van de app-switcher). Geen netwerk, opslag of logging, geen dependencies (peer `@capacitor/core >=8`). Bevat tevens een niet-gedocumenteerde laagtruc (`UITextField.isSecureTextEntry` + herparenting van de vensterlaag) om iOS-screenshots te blokkeren: **bewust uitgezet** (`preventScreenshots: false`), omdat die afhankelijk is van interne UIKit-structuur en iOS screenshots met openbare API niet betrouwbaar kan blokkeren. |
Integriteit lockfile = gereviewde tarballs (sha512 vergeleken). `npm audit --omit=dev`: 0 bevindingen (de 4 matige dev-meldingen via `@capacitor/assets` bestonden al). Geen blokkerende bevinding. Een eigen plug-in was niet nodig.

### 12.2 Wijzigingen door `cap sync` en aan het native project (gecontroleerd)
`cap sync`: uitsluitend registratie in `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle` en `ios/App/CapApp-SPM/Package.swift`. Handmatig toegevoegd (noodzakelijk): `NSFaceIDUsageDescription` in `Info.plist` (een tekst, geen entitlement/capability), `USE_BIOMETRIC` in `AndroidManifest.xml`, `PrivacyScreen`-configuratie in `capacitor.config.ts`. **Geen** wijziging aan signing, provisioning, schemes, `project.pbxproj`, entitlements, Associated Domains of push. `check:native-config` borgt dit voortaan (Face ID-tekst, permissie, PrivacyScreen-config).

### 12.3 Werking (bestanden: `lib/appLock.ts`, `lib/biometricAppLock.ts`, `lib/appLockSources.ts`, `components/AppLock.tsx`, `lib/routeInbox.ts`, `lib/useRouteInbox.ts`, `lib/privacyScreen.ts`)
- **Structuur:** `App` = `DeepLinks` (buiten de vergrendeling) + `AppLockGate` > `HashRouter` > `AuthProvider` > `Shell`. Zolang er nooit is ontgrendeld worden `AuthProvider`/`Shell` **niet gemonteerd**: geen token lezen uit Keychain/Keystore, geen `/me`, geen enkele API-aanroep, geen vertrouwelijke UI.
- **Toestanden** (`LockController`, puur en volledig getest): `locked` → `authenticating` → `unlocked` | `blocked` (geen/niet te controleren toestelbeveiliging of plug-in niet te laden). Fail-closed: elke fout, annulering of uitzondering = vergrendeld/geblokkeerd.
- **Koude start:** altijd vergrendeld; direct systeemprompt; annuleren/mislukken → vergrendeld met begrijpelijke melding en knop "Ontgrendelen" (geen promptlus).
- **Achtergrond (30 s):** bij elk `inactive`/`background` (ook systeemoverlays en de eigen prompt) wordt direct afgeschermd; de vertrektijd wordt één keer vastgelegd (herhaalde meldingen verversen de klok niet). Bij terugkeer: < 30 s → doorgaan; ≥ 30 s, negatieve of onbetrouwbare klok → opnieuw vergrendelen en direct prompt. Na een bewuste annulering volgt geen automatische nieuwe prompt. Elke afwezigheid wordt apart gemeten (kort wisselen blijft toegestaan; zie sectie 14, punt 1).
- **Tijdens de prompt:** voorgrond-/achtergrondwisselingen die de systeemprompt zelf veroorzaakt (Face ID, `AuthActivity`) wijzigen het beleid niet; gaat de app tijdens de prompt écht weg en slaagt de verificatie, dan blijft de app afgeschermd en loopt de klok vanaf dat moment.
- **Na vergrendelen:** de kinderen blijven gemonteerd maar zijn `hidden` + `inert` (een halve inlogstap gaat niet verloren); er worden dan geen sessieverversingen uitgevoerd (`AuthProvider`); na ontgrendelen volgt één verversing.
- **Deeplinks/notificaties:** de listeners blijven buiten de gate bestaan (permanente les); bestemmingen gaan naar een tijdelijke geheugenpostbus (TTL 5 min, nooit opgeslagen) en worden pas verwerkt als de app ontgrendeld én niet afgeschermd is.
- **Sessie:** lokaal ontgrendelen laat een geldige serversessie intact (geen nieuwe e-mailcode); een verlopen/ingetrokken sessie wordt nooit hersteld (`/me` → 401 → volledig inloggen). Server, MFA, herverificatie en ringisolatie zijn onaangeroerd.
- **Terugknop (Android):** zolang vergrendeld minimaliseert de eigen listener de app; de (verborgen) Shell consumeert de knop zonder te navigeren.
- **Splashscreen:** `launchAutoHide` staat uit; het ontgrendelscherm neemt het splashscreen zelf weg zodat annuleren niet op een eeuwig splashscherm eindigt.

### 12.4 Afscherming van vertrouwelijke inhoud
Android: `FLAG_SECURE` (screenshots, schermopnames en recente-appsweergave geblokkeerd). iOS: native afscherming vóór de app-switcher-momentopname + JS-afdekking. **iOS-screenshots en schermopnames worden niet geblokkeerd** (technisch niet betrouwbaar mogelijk met openbare API); de inhoud is wel afgeschermd in de app-switcher en vóór ontgrendeling. Vertrouwelijke gegevens verschijnen niet in pushmeldingen (ongewijzigd, generiek).

### 12.5 Personal Team
De vergrendeling gebruikt geen buildprofiel, Associated Domains, push- of passkey-capabilities en is onafhankelijk van native passkeys; `Debug-PersonalTeam` is ongewijzigd en werkt met dezelfde vergrendeling (een test borgt dat de vergrendelingscode niet naar het buildprofiel verwijst). Nog niet op een toestel getest.

### 12.6 Openstaande fysieke acceptatietests (fase F; **niet** uitgevoerd)
iPhone (Face ID én Touch ID/alleen toestelcode; ook `App-PersonalTeam`) en Android (verschillende API-niveaus/fabrikanten, vingerafdruk/gezicht/alleen schermvergrendeling, API 28–29-terugval): koude start; annuleren; te veel foute pogingen/lockout; toestel zonder schermvergrendeling; < en > 30 s achtergrond; app-switcher en recente apps (geen inhoud); Android-screenshot geblokkeerd; iOS-screenshot (verwacht: mogelijk); push-tik en universele link vanuit koude start en vanuit achtergrond (pas na ontgrendelen); Android-terugknop; Face ID-toestemming geweigerd; prompt tijdens telefoongesprek/meldingen; biometrie opnieuw ingesteld; toestel herstart; sessie intussen ingetrokken.

## 13. Vervolgvoorstel: hardwaregebonden sessietoken (stap 2; NIET gebouwd, aparte opdracht)
**Doel:** het sessietoken is zonder lokale gebruikersverificatie niet leesbaar, ook niet voor een aanvaller met rootrechten/jailbreak of een gemanipuleerde app. (Nu bewaakt alleen de UI-vergrendeling de toegang; het token staat in Keychain/Keystore met `afterFirstUnlockThisDeviceOnly` zonder gebruikersverificatie.)
**Ontwerp.**
- *iOS:* een Keychain-item met `SecAccessControl` (`.userPresence` of `.biometryCurrentSet`/`.devicePasscode` volgens beleid, `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`) voor een willekeurige 256-bit **data-encryption-key (DEK)**; bij voorkeur een Secure Enclave-sleutel (EC P-256, `kSecAttrTokenIDSecureEnclave`) waarmee de DEK wordt "gewrapt" (ECIES). Het sessietoken staat versleuteld (AES-GCM met de DEK) in de bestaande opslag; lezen vereist een geslaagde `LAContext`-verificatie.
- *Android:* Keystore-sleutel (AES-256-GCM, StrongBox indien beschikbaar) met `setUserAuthenticationRequired(true)`, `setUserAuthenticationParameters(timeout/0, AUTH_BIOMETRIC_STRONG | AUTH_DEVICE_CREDENTIAL)` (API 30+; op API 24–29 `setUserAuthenticationValidityDurationSeconds`), `setInvalidatedByBiometricEnrollment(true|false)` (beleid), gebruikt via `BiometricPrompt.CryptoObject`. Versleutelen/ontsleutelen van het token gebeurt na de prompt.
- *Eén prompt:* de ontgrendeling van E3 en het vrijgeven van de sleutel worden **dezelfde** prompt (CryptoObject/`LAContext` hergebruiken), zodat de gebruiker niet twee keer hoeft te verifiëren. De 30-seconden-regel blijft: het ontsleutelde token blijft alleen in het geheugen en wordt bij vergrendelen gewist.
- *Implementatie:* vermoedelijk een **kleine eigen Capacitor-plug-in** (de huidige plug-ins bieden geen sleutelgebonden cryptografie); alternatief: een gereviewde community-plug-in. Vooraf: review en toestemming.
**Migratie van bestaande sessies.** Bij de eerste start na de update (na de gewone ontgrendeling): bestaand token lezen → versleutelen met de nieuwe sleutel → oude opslag wissen → vlag `tokenFormat=v2`. Mislukt dit in welke stap dan ook: **uitloggen** (token wissen) en normaal opnieuw inloggen; nooit een half gemigreerde toestand (schrijf nieuw, verifieer lezen, pas dan wis oud). Idempotent en herstartbaar.
**Ongeldig geworden sleutels** (nieuwe vingerafdruk/gezicht, toestelcode gewijzigd/verwijderd, backup-herstel naar een ander toestel, Keystore-fout): `KeyPermanentlyInvalidatedException`/`errSecItemNotFound`/`errSecAuthFailed` → token onbruikbaar → lokaal wissen en terug naar het inlogscherm (e-mailcode + MFA). **Geen dataverlies:** alle gegevens staan op de server; alleen de toestelsessie verdwijnt; het pushtoken wordt via de bestaande "pending unregister" opgeruimd.
**Risico's op buitensluiten en mitigaties.** (1) Fout in de implementatie → altijd het herstelpad "opnieuw inloggen" beschikbaar houden, ook zonder netwerk een duidelijke melding; (2) fabrikant-eigenaardigheden (Keystore/StrongBox) → feature-detectie, terugval naar niet-StrongBox, uitgebreide toesteltests; (3) gebruiker zonder toestelcode → blijft geblokkeerd (E3); (4) migratiecrash → idempotente, stapsgewijze migratie; (5) uitrol → achter functievlag `APP_LOCK_BOUND_TOKEN` (standaard UIT), eerst intern/TestFlight/Play-intern.
**Samenhang met web-MFA (number matching, `WEB-MFA-ONTWERP.md`).** Dezelfde native plug-in kan de **apparaatsleutel** voor goedkeuringen leveren (een tweede, aparte sleutel, `userPresence` per ondertekening). Sessietoken-DEK en apparaatsleutel mogen nooit dezelfde sleutel zijn (verschillende doelen en levensduur). Beide gebruiken dezelfde ontgrendelprompt-infrastructuur; de goedkeuring blijft per bewerking afzonderlijk verifiëren, ook binnen de 30 seconden. Door nu één `AppLockProvider`-grens te hebben kan de eigen plug-in later worden toegevoegd zonder de UI te herschrijven.
**Beslissingen vóór stap 2:** biometrie-invalidatie bij nieuwe biometrie (streng) of toestelcode-alleen (soepel); eigen plug-in versus gereviewde community-plug-in; StrongBox verplicht of voorkeur; uitrolstrategie en wanneer de vlag aan mag.

## 14. Bekende beperkingen en restpunten (eerlijke rapportage)
1. **Korte afwezigheden:** de 30 seconden gelden per afwezigheid; wie met een al ontgrendelde app steeds binnen 30 s terugkeert, hoeft niet opnieuw te verifiëren. Een optionele cumulatieve limiet (bijv. 5 minuten ontgrendeld totaal) is mogelijk — keuze eigenaar.
2. **UI-vergrendeling ≠ cryptografische bescherming:** zie sectie 6/13. Het token kan op een geroot/gejailbreakt toestel worden uitgelezen tot stap 2 is gebouwd.
3. **iOS-screenshots/schermopnames** blijven mogelijk (zie 12.4).
4. **Android API 28–29:** `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` is daar niet toegestaan; de plug-in valt terug op `WEAK | DEVICE_CREDENTIAL`.
5. **Geen toesteltests:** simulator-/debugbuilds bewijzen alleen dat het compileert en start.
6. **De mobiele client in een gewone browser** (alleen ontwikkelen) heeft de vergrendeling uit; de productieapp is uitsluitend de gebundelde native app.

## 15. Beveiligingsreview na oplevering (twee aangetoonde risico's, verholpen)
**1. Sessieverversing tijdens vergrendeling – aangetoond en verholpen.** De `appStateChange`-listener van `AuthProvider` registreerde vóór die van de gate (kinderen-effecten eerst) en las een `unlockedRef` die pas bij een React-render werd bijgewerkt. Bij terugkeer na > 30 s ging daardoor `refresh` + `/me` (en het afmelden van een oud pushtoken) de deur uit terwijl de app al moest worden vergrendeld, in beide listenervolgordes; een verversing die al liep ging bovendien na het vergrendelen door met `/me`. Reproductietests (`mobile/tests/appLockSession.test.tsx`) faalden vóór de fix (5 van 7).
Verhelp: (a) sessieverversing loopt **uitsluitend** via `LockController.onResume`, dat pas afgaat nadat de terugkeer is beoordeeld en de app ontgrendeld is (bij terugkeer binnen de grens en na een geslaagde ontgrendeling), dus onafhankelijk van de gebeurtenisvolgorde en van React-renders; (b) `AuthProvider` controleert vóór elke stap synchroon `isUnlocked()` (controllerstand, geen render-afgeleide ref) en laat een al lopende verversing na het vergrendelen geen gegevens (`/me`) meer ophalen — een geroteerd sessietoken wordt wel bewaard, anders raakt de sessie zoek; (c) vangnet: `ApiClient` heeft een `isBlocked`-poort en weigert **elk** verzoek (zonder netwerkverkeer, fout `app-locked`) zolang de app niet ontgrendeld is, ook voor schermen die zelf iets ophalen. Bewust niet geblokkeerd tijdens enkel *afschermen* (inactief): systeemdialogen (zoals de meldingstoestemming) mogen hun API-registratie afronden. De 30-secondenregel is ongewijzigd.
**2. Mislukte schermbescherming – aangetoond en verholpen.** De oude `enablePrivacyScreen()` slikte elke fout (plug-in niet geregistreerd, `UNIMPLEMENTED`, native fout, hangende aanroep) en was niet gekoppeld aan toegang: de app toonde dan zonder `FLAG_SECURE` (Android) of zonder iOS-afscherming vertrouwelijke gegevens, ongemerkt. Verhelp: `ensurePrivacyScreen()` geeft alleen `true` als de plug-in native beschikbaar is én `enable()` binnen 3 s slaagt; de `LockController` eist dit bij **elke** ontgrendeling, vóór de toestelcontrole en de prompt. Mislukt het of gooit het, dan is de app **geblokkeerd** (nieuw scherm "schermbeveiliging kon niet worden ingeschakeld", met "Opnieuw proberen"), `AuthProvider` wordt niet gemonteerd en er is geen API-verkeer. Bij terugkeer binnen 30 s wordt de bescherming opnieuw bevestigd; lukt dat niet, dan wordt de ontgrendelde app direct geblokkeerd. Een test borgt dat de productie-instantie deze voorwaarde houdt. Let op: de bescherming zelf (Android `FLAG_SECURE`, iOS-overlay) blijft platformgedrag dat op toestellen nog bewezen moet worden (§12.6).

## 16. Vervolgcorrectie: volgorde bij terugkeer binnen 30 seconden (fail-closed)
**Bevinding (aangetoond):** bij terugkeer binnen de grens hief `LockController.appActive()` de afscherming op en meldde de hervatting (sessieverversing, verzoeken) *vóór* de asynchrone bevestiging van de native schermbescherming; vertrouwelijke inhoud en API-verkeer waren dus even beschikbaar zonder bevestigde bescherming, en een mislukte bevestiging blokkeerde pas achteraf. De regressietests faalden vóór de fix (7 van 12).
**Correctie:** bij terugkeer begint een toestand `verifying`: de afscherming blijft aan, de inhoud is `inert`, `isUnlocked()` is `false` (dus geen sessieverversing en — via de `ApiClient`-poort — geen enkel verzoek) en de hervatting (`onResume`) wacht. Pas bij een bevestigde bescherming, een actieve app en een nog ontgrendelde toestand gaat de afscherming op en volgt precies één hervatting. Mislukking, uitzondering of time-out (controller-bovengrens 5 s, bovenop de 3 s van de plug-inaanroep) blokkeert de app. Alleen de nieuwste bevestiging telt (volgnummer): snelle achtereenvolgende wisselingen, een nieuwe `inactive` tijdens de controle en late uitkomsten van oudere controles kunnen de app nooit openen. Ongewijzigd: de 30-secondenregel (≥ 30 s = vergrendelen + prompt, met bevestiging vóór de prompt) en het gedrag bij systeemdialogen (alleen inactief worden blokkeert niets, zodat bijvoorbeeld de pushregistratie kan afronden; pas de *terugkeer* start een bevestiging). Restpunt: een API-aanroep die precies in het (normaal milliseconde-korte) bevestigingsvenster na een systeemdialoog valt, wordt geweigerd (`app-locked`) en kan opnieuw worden geprobeerd.
