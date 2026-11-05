# Ontwerp: verplichte beveiligde ontgrendeling van de Ringtools-app (iOS en Android) – nog NIET gebouwd

> **Status: alleen ontwerp en roadmap.** Er is niets geïnstalleerd of gebouwd. Definitieve keuzes (time-outs, sleutelbescherming, herstel) liggen bij de eigenaar (zie "Beslissingen"). De `App-PersonalTeam`-build, signing, provisioning en entitlements blijven ongewijzigd.

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
