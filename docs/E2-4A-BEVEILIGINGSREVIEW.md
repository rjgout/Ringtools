# E2.4a – beveiligingsreview: wachtwoordloos inloggen met een vertrouwd toestel

Status: gebouwd, **vlag `NATIVE_DEVICE_LOGIN_ENABLED` standaard UIT**. Niet activeren zonder akkoord van de eigenaar (zie "Beslissing vóór activering").

## Wat de server bewijst en wat niet

| Garantie | Server-side bewezen? |
|---|---|
| Bezit van de privésleutel die bij registratie is opgegeven (ECDSA P-256-handtekening over een eenmalige challenge) | **Ja** |
| Challenge is eenmalig, kort geldig (2 min), gebonden aan toestel en doel (LOGIN/ACTIVATE), atomair verbruikt | **Ja** |
| Account actief, toestel niet ingetrokken en expliciet geactiveerd, op het moment van verbruiken (rij-vergrendeld) | **Ja** |
| Sleutel zit in de Secure Enclave / is niet exporteerbaar | **Nee** (geen attestatie) |
| Bij elke handtekening vindt gebruikersverificatie (Face ID/toestelcode) plaats | **Nee** (door het besturingssysteem afgedwongen op iOS, maar niet server-verifieerbaar) |
| Het toestel is een echte iPhone met de echte Ringtools-app | **Nee** (geen App Attest/DeviceCheck) |

"Bewijs van sleutelbezit" is dus **niet** hetzelfde als "bewijs van hardwarebinding". Er wordt nergens beweerd dat dit passkey-equivalent of server-geattesteerd is.

## Beoordeling van de bouwstenen

- **iOS Secure Enclave.** De plug-in maakt de sleutel met `kSecAttrTokenIDSecureEnclave` en access control `.privateKeyUsage + .userPresence` (type `BIOMETRY_OR_PASSCODE`). Op iOS valt de plug-in niet terug op een softwaresleutel: lukt het niet (bijv. simulator), dan faalt het aanmaken. `SecKeyCreateSignature` gebruikt een nieuwe `LAContext`; het systeem (niet de app) vraagt bij elke handtekening Face ID/Touch ID of toestelcode, dus een aangepaste client kan de gebruikersverificatie niet overslaan *met een Secure Enclave-sleutel*. De privésleutel is niet exporteerbaar.
- **Zwakke plek: ongeattesteerde sleutel.** Een aangepaste client kan bij het koppelen in plaats daarvan een softwaresleutel aanleveren; de server ziet het verschil niet. Voorwaarde daarvoor is dat de aanvaller bij het koppelen al de tweede factor van de gebruiker heeft (de koppelcode vereist recente MFA op de website) of malware op het toestel draait. Een aanvaller met een kopieerbare softwaresleutel zou zonder Face ID kunnen inloggen. Dit is het hoofdrestrisico.
- **Toestelcode-terugval.** `.userPresence` staat Face ID *of* toestelcode toe. Wie de toestelcode kent (bijv. meegekeken) kan dus ook ondertekenen. De eigenaar sprak toestelcode toe "indien het beveiligingsbeleid dat toestaat"; dit is nu toegestaan. Strenger: sleuteltype `BIOMETRY` (`.biometryCurrentSet`, ongeldig bij wijziging van biometrie) voor nieuwe koppelingen — niet gedaan, omdat het gebruikers zonder biometrie buitensluit en een nieuwe koppeling per toestel vraagt.
- **Android.** De plug-in geeft de sleutel `setUserAuthenticationParameters(5, …)`: na *elke* geslaagde ontgrendeling van het toestel is de sleutel 5 seconden zonder nieuwe prompt bruikbaar. Dat is geen verificatie per handtekening en is voor zelfstandig inloggen **niet** acceptabel. Daarom: Android staat uit — app toont de knop alleen op iOS (`deviceLoginSupported`) en de server weigert activering voor toestellen met platform ≠ IOS. Let op: het platform is door de client opgegeven (niet geattesteerd); dit is een beleidsgrens, geen cryptografisch bewijs.
- **Plug-in en logging.** De plug-in logt na de loggingpatch niets meer (zie `docs/WEB-MFA-ONTWERP.md` §11). Challenges, berichten en handtekeningen worden nergens door de adapter of de nieuwe code gelogd.
- **Replay, challengevervanging, accountverwisseling.** Challenge is willekeurig (256 bit), eenmalig, aan één toestel en één doel gebonden; het ondertekende bericht bevat contextlabel (aparte labels voor LOGIN en ACTIVATE en ≠ registratie), challenge-ID, challenge, toestel-ID en installatie-ID. Een challenge van een ander toestel of doel levert een ongeldige handtekening of afwijzing; gelijktijdig verbruiken geeft precies één sessie (tests).
- **Verloren/ingetrokken toestel.** Intrekken (web, recente MFA) of een webmin-MFA-reset beëindigt direct alle via dat toestel aangemaakte sessies en maakt nieuwe aanmeldingen onmogelijk. Een verloren toestel zonder Face ID/toestelcode is daarmee niet bruikbaar; met bekende toestelcode wel, tot intrekken.
- **Sessiegezag.** Een sessie via een toestel krijgt `mfaAt` in het verleden: volledige toegang, maar **nooit "recente MFA"**. Gevoelige acties (gebruikersbeheer, nieuwe toestellen koppelen/activeren, intrekken) vragen altijd een verse tweede factor. Zo kan een toestelsessie zichzelf of andere toestellen niet verder uitbreiden.

## Afweging van de opties

1. **Huidige plug-in + aanvullende maatregelen (gekozen voor deze fase).** Expliciete activering met recente MFA en bewijs van bezit, alleen iOS, vlag UIT, sessie zonder recente-MFA-status, persistente pogingbegrenzing, directe intrekking van sessies. Past binnen Personal Team (geen entitlements). Restrisico: ongeattesteerde sleutel, toestelcode-terugval.
2. **Eigen beperkte native implementatie.** Zou `.biometryCurrentSet`, een expliciete controle dat de sleutel in de Secure Enclave zit (`kSecAttrTokenID`) en een Android-flow met `BiometricPrompt` + `CryptoObject` (verificatie per handtekening) kunnen afdwingen. Voordeel: strengere en controleerbare client; nadeel: eigen Swift/Kotlin zonder mogelijkheid om hier op een toestel te testen, onderhoud; en **de server kan het nog steeds niet verifiëren**. Aanbevolen vervolg vóór breed gebruik.
3. **Attestatie.** iOS App Attest/DeviceCheck vereist de capability `com.apple.developer.devicecheck.appattest-environment`, die een gratis Personal Team niet kan hebben; bovendien attesteert App Attest een eigen sleutel, niet onze Secure Enclave-loginsleutel, en bewijst het geen gebruikersverificatie per handtekening. Android Key Attestation kan wél aantonen dat een sleutel in TEE/StrongBox zit en hoe (inclusief `userAuthenticationRequired` en validiteitsduur) — dat is de weg om Android later veilig toe te laten. **Niet gebouwd; niet mogelijk voor iOS op Personal Team.**

## Beslissing vóór activering (eigenaar)

De route is geïmplementeerd maar uit. Voor activering op de NAS is een expliciet akkoord nodig op deze punten: (a) de server kan geen hardwarebinding of verificatie per handtekening bewijzen; (b) een softwaresleutel via een aangepaste client is niet te onderscheiden; (c) toestelcode-terugval is toegestaan; (d) Android blijft uit. Zonder dat akkoord: vlag uit laten.

## Voor E2.4b (webaanmelding goedkeuren met number matching) ontbreekt nog

Een server-gestuurde goedkeuringsstroom (weblogin-verzoek met nummer, pushloze ophaalroute of polling door de app), koppeling van het verzoek aan het toestel en de sessie, een veilig number-matching-protocol dat niet als phishingbestendig wordt gepresenteerd, throttling tegen "MFA-fatigue", en een besluit over het gebruik van deze unattested toestelsleutel als goedkeuringsfactor.

## Besluiten van de eigenaar en herstelronde

- Voor een **gecontroleerde test op de eigen iPhone** is geaccepteerd dat de server geen onafhankelijke hardwareattestatie of gebruikersverificatie per handtekening kan bewijzen, en het risico van een aangepaste client met een softwaresleutel (alleen binnen die test, met expliciete activering na recente MFA). Dit is **geen akkoord voor brede productieactivering**. Toestelcode als alternatief voor Face ID is toegestaan en wordt in de interface benoemd (knop "Inloggen met Face ID of toestelcode", uitleg dat wie de toestelcode kent ook kan inloggen). Android blijft uit.
- **Toestelbinding bij herverificatie:** `promoteSessionToMfaVerified` nam de `deviceId` niet over, waardoor een toestelsessie na TOTP-herverificatie niet meer door intrekken werd beëindigd. Nu blijft de binding behouden (en tokenrotatie wijzigt dezelfde rij), en een herverificatie voor een inmiddels ingetrokken of uitgezet toestel mislukt.
- **Intrekken versus gelijktijdig inloggen:** een inlog die vóór een intrekking begon kon na de intrekking nog een sessie vastleggen (de intrekking zag de nog niet gecommitte sessie niet). Nu geldt overal dezelfde vergrendelvolgorde: gebruikersrij → toestelrij (`FOR UPDATE`, `src/lib/deviceLocks.ts`) → pas daarna sessies lezen/schrijven. Gebruikt door inloggen, herverificatie, intrekken, uitzetten en (via de gebruikersvergrendeling) de webmin-reset. Elke volgorde eindigt met een mislukte inlog óf een sessie die door de latere intrekking wordt verwijderd. Deterministische tests met testhaken (`lockHooks`, uitsluitend voor tests) dekken beide volgorden: `tests/deviceLoginConcurrency.test.ts`.

## E2.5 – automatische toestelinrichting (vlag `NATIVE_DEVICE_AUTO_ENROLL_ENABLED`, standaard uit)

**Voorwaarden voor automatische inrichting:** volledige sessie (geen pending-login), niet-admin, `mfaEnabled`, **recente MFA** (`requireFreshAuth`; een toestelsessie telt niet), iOS, vlag aan (vereist `NATIVE_DEVICE_LOGIN_ENABLED`), minder dan 5 actieve toestellen, throttle 10 per 15 min.

**Protocol:** `POST /auth/device/enroll/challenge` maakt een `DeviceEnrollment` (3 min geldig, één openstaande per gebruiker) en `POST /auth/device/enroll/complete` verifieert een P-256-handtekening over `ringtools-device-enroll-v1\n{id}\n{challenge}\n{userId}\n{installationId}` (eigen contextlabel; bindt aan gebruiker en installatie). Registratie en activering gebeuren in **één transactie** met gebruikersvergrendeling en atomair verbruik; maximaal 3 mislukte pogingen; unieke publieke sleutel en installatie-ID. Annuleren laat niets achter. `POST /auth/device/disable` zet de toestelinlog uit (recente MFA).

**Accountbinding:** de server koppelt de sleutel aan de ingelogde gebruiker; de app bewaart `userId` en naam bij de lokale sleutelverwijzing. Een lokale koppeling van een ander (of onbekend) account wordt nooit stilzwijgend overschreven: eerst expliciete bevestiging; de vorige lokale sleutel wordt pas na serversucces verwijderd, bij falen wordt de vorige verwijzing exact hersteld.

**Appvergrendeling:** de vergrendeling beschermt een bestaande sessie. Zonder opgeslagen sessie (`storage.hasSession()` via `SecureStorage.keys()`, zonder het token te lezen; fout = fail-closed) start de app direct op het inlogscherm. Een geslaagde aanmelding telt als ontgrendeling (geen dubbele prompt); uitloggen/verlopen sessie toont het inlogscherm zonder prompt. Het apparaatsleutel blijft bij uitloggen bestaan.

**Restrisico's:** zonder attestatie bewijst de server geen hardwarebinding (ongewijzigd); een verlopen token geeft bij koude start nog één ontgrendelprompt vóór het inlogscherm; een verloren registratie-antwoord kan een wees-toestel op de server achterlaten (zichtbaar en intrekbaar op het web). Android blijft uit.
