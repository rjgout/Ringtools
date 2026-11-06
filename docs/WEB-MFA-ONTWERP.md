# MFA-keuze voor webgebruikers (fase E2) – ontwerp en werkelijke status

> **Status (actueel):**
> - **E2.1 – authenticator-app (TOTP) voor gewone webgebruikers: gebouwd en op `main`**, achter de functievlag `WEB_TOTP_ENABLED` (standaard **UIT**, niet geactiveerd). Zie §9.
> - **E2.2 – methodekeuze bij het inloggen (passkey aanbevolen, wisselen zonder nieuwe e-mailcode): gebouwd en op `main`**, werkt alleen met `WEB_TOTP_ENABLED=true`; met de vlag uit is het gedrag ongewijzigd. Zie §10.
> - **Functievlaggen, allemaal standaard UIT:** `WEB_TOTP_ENABLED` (web, E2.1/E2.2) en `NATIVE_PASSKEYS_ENABLED` (native passkeys, apart). Er is geen verplichte MFA ingevoerd en er zijn geen gebruikersinstellingen gewijzigd.
> - **Nog ontbreekt (alleen ontwerp, uitgesteld):** E2.3 vertrouwd toestel + apparaatsleutel; E2.4 number matching (`WEB_MFA_APP_ENABLED`, niet phishingbestendig en nooit als WebAuthn-equivalent gepresenteerd); E2.5 beleid (verplichte MFA per rol, herstelbeleid voor passkey-only accounts) en `Session.mfaMethod`.
> - Zonder de vlag: gewone gebruikers kennen alleen optionele passkey-verificatie; webmin = wachtwoord + verplichte TOTP (eigen, ongewijzigd pad); e-mailcode blijft eerste factor.

## 1. Doel
Gebruikers van de beveiligde webomgeving (bijv. een secretaris met een laptop) kiezen bij het inloggen uit de tweede-factormethoden die **voor hun account zijn geregistreerd**:

| | Methode | Phishingbestendig? | Bewijs |
|---|---|---|---|
| A | **Ringtools-app met number matching** | **Nee** (zie 4.4) | Handtekening van een vertrouwd toestel, met lokale biometrie/toestelcode |
| B | **Passkey (WebAuthn)** | **Ja** (origin-gebonden) | Door de server geverifieerde assertion |
| C | **Authenticator-app (TOTP)** | **Nee** | Zescijferige code (RFC 6238) |

Number matching en TOTP worden in de UI en documentatie **nooit** als equivalent van WebAuthn gepresenteerd. Een e-mailcode alleen is nooit een tweede factor voor een account met verplichte MFA.

## 2. Wat er al is (hergebruik)
- **Pending-login**: sessie met `mfaAt = null` (10 min), werkt uitsluitend op MFA-routes; volledige sessie pas via `promoteSessionToMfaVerified` (atomair, `count == 1`, `SessionNoLongerValidError`) met `Session.factorProvedAt` als bewijs in dezelfde sessie.
- **WebAuthn** (`src/lib/webauthn.ts`, `WebAuthnCredential`, `WebAuthnChallenge` met atomair verbruik, RP-ID/origin-allowlist, UV vereist) en de pagina's `/mfa/passkey`, API `/auth/mfa/passkey/*`, herverificatie `/auth/reauth/passkey/*`.
- **TOTP** (`src/lib/mfa.ts`, `TotpCredential`: versleuteld geheim, replay-teller `lastUsedCounter`, lockout, herstelcodes) — nu alleen voor webmin ingezet; het model is per `userId` en dus herbruikbaar.
- Herverificatie (`requireRecentMfa`, 15 min), `SecurityEvent`-logboek, rate limits, lockout, MFA-reset door webmin (`MFA_RESET_BY_ADMIN`).
- App: veilige opslag (Keychain/Keystore), `deviceId` per installatie, generieke pushmeldingen (`notify`, geen gevoelige inhoud), `PasskeyProvider`-patroon met functievlag.

## 3. Gebruikersstromen
**Inloggen (web).** 1) e-mailcode → pending-login. 2) Het keuzescherm toont uitsluitend de geregistreerde methoden (standaard: laatst gebruikte). 3) Methode A/B/C → volledige sessie. Wisselen van methode op dit scherm is toegestaan (elke methode is een volledige tweede factor); de pending-login blijft dezelfde en de teller van mislukte pogingen is per account gedeeld, zodat wisselen geen extra pogingen oplevert.

**Methode A in detail.**
1. Browser: "Kies *App*". Server maakt een `MfaApproval` aan, gekoppeld aan de pending-sessie, en toont een **nummer van 2 cijfers** (10–99) plus de tekst "Open de Ringtools-app en voer dit nummer in".
2. App (vertrouwd toestel, ingelogd): scherm **Aanmeldverzoeken** — toont openstaande verzoeken van dit account handmatig (pull); een generieke push ("Er is een aanmeldverzoek") mag helpen maar is **geen voorwaarde**. De gebruiker typt het nummer.
3. Server geeft bij een juist nummer de **context** terug (tijdstip, browser/besturingssysteem, grove regio of netwerk, "Heb jij dit gestart?") — pas ná het invoeren van het juiste nummer, nooit in de push.
4. De gebruiker kiest **Goedkeuren** of **Weigeren**; goedkeuren vraagt lokale biometrie/toestelcode die de apparaatsleutel ontgrendelt (zie 4.2); het toestel tekent de beslissing.
5. Server verifieert handtekening, koppelt aan het verzoek, zet het op `APPROVED` (eenmalig, atomair); de browser (poll met de pending-cookie) krijgt volledige sessie via `promoteSessionToMfaVerified`.
6. Weigeren/verlopen/te veel pogingen → verzoek `DENIED`/`EXPIRED`, pending-login vervalt, **melding en SecurityEvent** voor het account ("Een aanmelding is geweigerd").

**Registratie van een vertrouwd toestel.** Alleen vanuit een **webomgeving met recente MFA** (of via webmin-begeleiding): web toont een eenmalige koppelcode (+ QR) met korte geldigheid; in de app (ingelogd, ontgrendeld) voert de gebruiker de code in, het toestel genereert een sleutelpaar en registreert de publieke sleutel. **Nooit** koppelen alleen op grond van een e-mailcode of uitnodigingslink (dat zou de mailbox tot de tweede factor maken).

**Toestelvervanging/verlies.** Nieuw toestel koppelen vereist een bestaande geldige methode (oude toestel, passkey of TOTP). Verloren toestel: intrekken via webomgeving (andere methode) of via ringbeheerder/webmin-reset (zie beslissingen); een reset dwingt opnieuw registreren af en trekt alle sessies in.

**Methodebeheer** (`/profiel/beveiliging`): methoden toevoegen/verwijderen vereist recente MFA met een bestaande methode; de laatste methode kan niet worden verwijderd zolang MFA verplicht is; elke wijziging → `SecurityEvent` + melding.

## 4. Beveiligingsarchitectuur
### 4.1 Koppeling account ↔ toestel ↔ bevestiging ↔ browsersessie
Het nummer is een **bedieningshulp, geen geheim**. De veiligheid zit in:
- `MfaApproval { id, userId, pendingSessionId, number, nonce (≥128 bit), status, expiresAt (≈2 min), attempts, createdAt, context }`; hooguit één open verzoek per pending-sessie.
- Het toestel ondertekent (ES256, apparaatsleutel) een canoniek bericht: `{ v, approvalId, nonce, pendingSessionIdHash, userId, decision, audience = APP_BASE_URL, expiresAt }`. De server verifieert tegen de bij registratie opgeslagen publieke sleutel van **dat** toestel (`TrustedDevice`) en tegen de actuele DB-status (CAS: `PENDING → APPROVED` slechts één keer).
- Alleen de browser die de **pending-cookie** (httpOnly) bij dit verzoek houdt kan de sessie ontvangen; goedkeuring in de app geeft nooit zelf een sessie uit en kan niet voor een andere browsersessie worden hergebruikt.
- Gelijktijdige goedkeuring/afwijzing: CAS; de eerste wint, de rest krijgt "al afgehandeld". Replay: nonce + status + `expiresAt` + eenmalig verbruik.

### 4.2 Apparaatsleutel (sleutelbescherming)
Hardware-gebonden sleutelpaar op het toestel: iOS Secure Enclave (toegangscontrole `userPresence`/biometrie, `ThisDeviceOnly`), Android Keystore/StrongBox (`setUserAuthenticationRequired(true)`, biometrie of toestelcode, geen export). Het ondertekenen **vereist** de lokale gebruikersverificatie per bewerking (of binnen een korte, per sleutel afgedwongen tijdelijke autorisatie). Dit is een andere sleutel dan het sessietoken en wordt niet door de app-vergrendeling (document `APP-ONTGRENDELING-ONTWERP.md`) vervangen: de app-vergrendeling beschermt weergave, de apparaatsleutel bewijst goedkeuring.
Optioneel (beslissing): key attestation (Apple App Attest / Android Key Attestation) bij registratie als bewijs van hardware-binding; zonder attestation is registratie "trust on first use" binnen een MFA-beschermde stroom.

### 4.3 Beperkingen en misbruik
Vervaltijd ≈ 2 min · maximaal 3 foute nummers per verzoek (daarna `DENIED`) · maximaal N verzoeken per account/uur en per IP (rate limit) · **geen fatigue**: na 2 geweigerde/genegeerde verzoeken tijdelijke pauze en melding; pushes zijn generiek en gededupliceerd · verzoeken zijn alleen zichtbaar voor het account zelf (ringisolatie niet van toepassing; wel `userId`-controle server-side) · geen nummer, nonce of handtekening in pushmeldingen, logs of URL's.

### 4.4 Wat number matching wél en niet is
Number matching beschermt tegen **blind goedkeuren** (MFA-fatigue). Het beschermt **niet** tegen real-time phishing (aanvaller toont een nagebootste inlogpagina en relayt het nummer; de gebruiker "ziet" het verzoek dus als legitiem). Mitigaties: context in de app, expliciete "Weigeren"-knop met melding, korte vervaltijd. Voor hoge zekerheid blijft **WebAuthn** de enige phishingbestendige optie. De UI toont het beveiligingsniveau per methode ("Phishingbestendig" / "Standaard").

### 4.5 Geen downgrade
- Alleen vooraf geregistreerde methoden worden aangeboden; geen "ik heb geen toegang"-pad naar e-mail-only.
- Methoden toevoegen/verwijderen/vervangen vereist recente MFA met een bestaande methode; ringbeheerders kunnen **geen** methode stil toevoegen of verwijderen.
- Herstelroute mag niet zwakker zijn dan de normale route zonder zichtbare, gelogde, vertraagde procedure (zie beslissingen).
- Webmin blijft apart: wachtwoord + verplichte TOTP, niet vervangen door A/B/C.

## 5. Benodigde API's, data en native onderdelen
**Database (additief):** `TrustedDevice` (userId, deviceId, publicKey, algorithm, platform, label, attestation?, createdAt, lastUsedAt, revokedAt), `MfaApproval` (zie 4.1), `MfaPairing` (koppelcode-hash, userId, expiresAt, usedAt); kolom `Session.mfaMethod` (PASSKEY/TOTP/APP) voor weergave en policy; migratie additief, bestaande gebruikers ongewijzigd (geen methode gewijzigd, geen MFA ineens verplicht).
**Web-API/acties:** methodekeuze, `POST /mfa/app/start`, poll `GET /mfa/app/status` (pending-cookie), TOTP-inschrijving en -verificatie voor gewone gebruikers (hergebruik `mfa.ts`), beheerpagina.
**Mobiele API (`/api/mobile/v1`, authedRoute, gedeelde types + contracttest):** `GET /mfa/approvals`, `POST /mfa/approvals/lookup {number}`, `POST /mfa/approvals/:id/decision {signature}`, `POST /mfa/devices/pairing` (verifiëren koppelcode + publieke sleutel), `GET/POST /mfa/devices` (lijst/intrekken). Server beslist; client toont.
**Native:** sleutelgeneratie en ondertekenen met biometrie/toestelcode in Secure Enclave/Keystore. Kandidaten (**niets geïnstalleerd**, alle claims nog te verifiëren via broncode- en licentiereview zoals bij de passkey-plug-in): `@aparajita/capacitor-biometric-auth` (alleen biometrische prompt; geen sleutelgebonden ondertekening — onvoldoende voor 4.2 op zichzelf; de plug-in die wij al gebruiken voor Keychain, `@aparajita/capacitor-secure-storage`, bindt niet aan gebruikersverificatie), een community-plug-in voor Secure-Enclave/Keystore-ondertekening, of een **kleine eigen Capacitor-plug-in** (Swift `SecKeyCreateSignature` + `LAContext`, Kotlin `BiometricPrompt.CryptoObject` + `Signature`) — naar verwachting de beste beheersbaarheid, vereist onderhoud.
**Personal Team:** Secure Enclave en Keystore vereisen geen Associated Domains/entitlements; methode A werkt dus naar verwachting ook in `Debug-PersonalTeam` (nog te bevestigen op een toestel). Pushmeldingen ontbreken daar, daarom is het handmatige verzoekenscherm verplicht.

## 6. Risico's
| Risico | Maatregel |
|---|---|
| MFA-fatigue / blind goedkeuren | Number matching, context, rate limit, pauze, melding bij weigering |
| Real-time phishing relay | Niet volledig te voorkomen bij A/C; WebAuthn aanbieden en tonen; optioneel beleid "phishingbestendig verplicht" voor staf (beslissing) |
| Mailbox-overname → toestel registreren | Registratie alleen met recente MFA / webmin-begeleiding, nooit via e-mail alleen |
| Gestolen ontgrendeld toestel | Sleutel per bewerking achter biometrie/toestelcode; intrekken via ander kanaal |
| Gelijktijdige/herhaalde goedkeuring | CAS-status, nonce, eenmalig verbruik, atomaire sessiepromotie |
| Gevoelige info in push | Generieke tekst, geen nummer/nonce/context |
| Verlies van het enige toestel | Tweede methode verplicht stellen (advies), hersteldesign, webmin-reset met logging |
| Complexiteit/regressie | Gefaseerd, achter functievlaggen, bestaande MFA ongemoeid |

## 7. Afhankelijkheden met de mobiele app
Methode A hangt af van: (1) vertrouwd-toestel-registratie en apparaatsleutel (nieuwe native onderdelen), (2) scherm Aanmeldverzoeken, (3) bij voorkeur de app-vergrendeling (`APP-ONTGRENDELING-ONTWERP.md`) zodat het goedkeuringsscherm niet zonder lokale verificatie bereikbaar is. B en C zijn onafhankelijk van de app.

## 8. Voorgestelde gefaseerde implementatie
1. **E2.1 TOTP voor gewone gebruikers** (kleinste stap; hergebruikt `mfa.ts` volledig; webmin ongewijzigd) + methodekeuzescherm + methodebeheer met "recente MFA"-regel + `Session.mfaMethod`.
2. **E2.2 Passkey als keuzemethode** in het nieuwe keuzescherm (bestaande flow; geen nieuwe crypto).
3. **E2.3 Vertrouwd toestel + apparaatsleutel** (native onderzoek/plug-in, registratie, intrekken) — nog zonder inloggen.
4. **E2.4 Number matching** (API, web, app-scherm, push optioneel), eerst achter functievlag `WEB_MFA_APP_ENABLED` (standaard UIT), daarna toestelgebonden acceptatietest.
5. **E2.5 Beleid** (verplichte MFA per rol, herstel, attestation) pas na besluit eigenaar.
Per stap: backendtests (race/replay/expiry/ringisolatie), clienttests, Playwright, migratiecontrole op schone en gevulde database, CI per job; fysieke toesteltests blijven fase F.

## 9. Beslissingen eigenaar (vóór implementatie)
1. **Verplicht of vrijwillig?** Blijft MFA voor gewone webgebruikers optioneel (nu), of verplicht per rol (bijv. ringstaf)? En mag verplichte MFA beperkt worden tot phishingbestendig (passkey) voor staf?
2. **Methoden per account**: minimaal één, of minimaal twee (om verlies te overleven)?
3. **Herstel**: herstelcodes voor gebruikers? Wie mag MFA resetten (alleen webmin, of ook ringbeheerder met vertraging en melding)?
4. **Nummerlengte/vervaltijd** (voorstel 2 cijfers, 2 min) en of een extra "kies het juiste nummer op je telefoon"-variant gewenst is.
5. **Key attestation** vereisen of trust-on-first-use?
6. **Volgorde**: akkoord met E2.1 → E2.5, in het bijzonder TOTP eerst?
7. Mag voor ondertekening een **eigen kleine native plug-in** worden gebouwd (voorkeur) in plaats van een externe?

## 9. E2.1 – wat er werkelijk is gebouwd (functievlag `WEB_TOTP_ENABLED`, standaard UIT)

**Werking (hergebruikt `src/lib/mfa.ts`, pending-login, `factorProvedAt`, `promoteSessionToMfaVerified`; geen schemawijziging):**
- `src/lib/mfaMethods.ts` bepaalt de bruikbare methoden. Met de vlag uit telt een eventueel aanwezige TOTP voor een gewone gebruiker **nergens** mee; webmin houdt het eigen, ongewijzigde pad.
- **Inloggen:** na de e-mailcode kiest de gebruiker (alleen als er twee methoden zijn) passkey of authenticator-app; bij één methode volgt die direct. TOTP wordt alleen op een **bevestigde** instelling geverifieerd; rate limit 10/15 min, replay-bescherming en persistente lockout na 5 fouten.
- **Herstelcodes:** acht eenmalige codes (alleen hashes; eenmalige weergave) bij het instellen van de authenticator-app. Ze horen bij de authenticator-app: werken alleen bij een bevestigde TOTP en met de vlag aan. Nieuwe set maken vereist recente MFA en maakt de oude direct ongeldig. Verwijderen van de authenticator-app verwijdert de codes. Een gebruiker met alleen een passkey heeft geen herstelcodes; zij worden daarvoor niet aangeboden.
- **Eerste inschrijving met alleen een e-mailcode:** uitsluitend als er **werkelijk geen** methode is (bijv. na een reset). Methoden toevoegen of vervangen bij een al beveiligd account kan nooit met alleen een e-mailcode: in het profiel is recente MFA nodig, tijdens inloggen wordt het geweigerd (TOTP-pagina stuurt een passkey-gebruiker door; passkey-inschrijving blijft geblokkeerd bij een bestaande TOTP).
- **Minimaal één methode** volstaat. De interface beveelt een tweede methode en een passkey sterk aan (de sterkste methode, phishingbestendig; een code uit een app niet).
- **Invariant:** een account met ingeschakelde verificatie houdt altijd een bruikbare methode. Verwijderen van een passkey, van de authenticator-app en het inschakelen van verificatie lopen in één transactie met een rijvergrendeling op de gebruiker (`SELECT … FOR UPDATE`); gelijktijdige verwijderingen worden serieel afgehandeld (getest).
- **Races (TOTP):** een tijdstap wordt in één `UPDATE` geclaimd (`claimTotpStep`) met als voorwaarden: teller loopt strikt op (geen replay) **én** de instelling is op dat moment niet vergrendeld (ook niet in het venster tussen het tellen van de 5e fout en het zetten van de lockout: `failedAttempts < 5`). Gelijktijdige verzoeken serialiseren op de rij; een code wordt daardoor nooit geaccepteerd nadat een lockout effectief is geworden. Foute pogingen worden in één statement geteld (databaseklok, UTC); een verlopen lockout begint de teller opnieuw (geen blijvende blokkade). Getest, inclusief een race van de laatste foute poging tegen een geldige code.
- **Herstelcodes begrensd (persistent):** `TotpCredential.recoveryFailedAttempts/recoveryLockedUntil` (additieve migratie `20261117100000_e2_herstelcode_begrenzing`). Elke poging wordt vóór de controle atomair gereserveerd; de 5e poging zonder succes zet in dezelfde `UPDATE` een tijdelijke lockout van 15 minuten (ook voor de juiste code; overleeft herstarts). Een geslaagde code wist de teller; een verlopen lockout begint opnieuw. De lockout geldt alleen voor herstelcodes (TOTP blijft bruikbaar) en is nooit permanent. Geldt ook voor de webmin-API (`adminVerifyTotp`).
- **Webmin-reset (noodprocedure):** vereist recente MFA van de webmin, bevestiging dat de identiteit buiten Ringtools is gecontroleerd, en het intypen van het e-mailadres van de gebruiker. Eén transactie: alle passkeys, challenges, authenticator-app, herstelcodes, sessies en het auditspoor (`MFA_RESET_BY_ADMIN`, met de naam van de webmin); daarna een e-mail aan de gebruiker (best effort; een mislukte mail maakt de reset niet ongedaan en wordt aan de webmin getoond). Eindtoestand (eenduidig): `mfaEnabled` wordt door de reset **niet gewijzigd** (de rij wordt vergrendeld en de oude waarde in het auditspoor vastgelegd). Stond verificatie **aan**: geen methode en geen sessie, en bij de volgende inlog is een eerste inschrijving toegestaan omdat er werkelijk geen methode meer is. Stond verificatie **uit**: de gebruiker logt gewoon met de e-mailcode in en er valt niets te herstellen — de reset zet verificatie nooit stilzwijgend aan of uit. Een verzendfout van de e-mail staat in de melding aan de webmin en blijvend in het auditspoor. (Eerdere versies van dit document zeiden onterecht dat de reset verificatie aan zet.)
- **Vlag terugzetten (UIT) terwijl gebruikers al TOTP hebben:** hun TOTP en herstelcodes blijven bewaard maar tellen niet mee. Een gebruiker met alleen een authenticator-app kan dan niet inloggen en ziet een duidelijke melding (geen inschrijving met alleen een e-mailcode, want er bestaat een methode). Oplossing: vlag weer aan, of webmin-reset. Dit is getest (Playwright aan → uit → aan).
- **Native app:** ongewijzigd fail-closed. TOTP wordt in de app niet aangeboden; een TOTP-only account krijgt in de app de bestaande veilige melding (via de webapp inloggen/instellen).
- **Meldingen:** zodra TOTP is toegestaan spreken de teksten van "verificatie"; zonder de vlag blijven ze "passkey". Herstelcodes worden alleen genoemd waar ze bestaan.

**Bewust niet gebouwd:** verplichte MFA per rol; `Session.mfaMethod` (nog geen consument; additieve migratie zodra E2.3/E2.4 dat nodig hebben); mail aan de gebruiker bij het gebruiken van een herstelcode (wel in het beveiligingslogboek `RECOVERY_CODE_USED`).

**Open punten voor de eigenaar vóór activeren:** (1) bevestig dat de interne meldingsmail bij een reset acceptabel is; (2) bevestig het bewust beperkte bereik van herstelcodes (alleen bij TOTP); (3) verplichte MFA per rol en `Session.mfaMethod` zijn door de eigenaar uitgesteld; (4) back-up/herstel op de NAS eerst oefenen (`docs/BACKUP-HERSTEL.md`).

**Tests:** `tests/webTotp.test.ts` (22), `e2e/webTotp.spec.ts` (aan: 8, uit: 4; draai de spec met `E2E_WEB_TOTP=on|off` en een server met dezelfde `WEB_TOTP_ENABLED`; volgorde aan → uit → aan test het terugzetten van de vlag). **Activeren:** `WEB_TOTP_ENABLED=true` in de omgeving van de container, pas na akkoord van de eigenaar.

## 10. E2.2 – methodekeuze bij het inloggen (op main, achter `WEB_TOTP_ENABLED`; geen schemawijziging, geen nieuwe crypto)

**Al aanwezig na E2.1 (niet opnieuw gebouwd):** pending-login en sessiepromotie; WebAuthn-registratie en -verificatie met herverificatie; TOTP met replay-/lockoutbescherming; een eerste keuzescherm; doorsturen bij één methode; profielbeheer van passkeys en authenticator-app met recente MFA; de invariant dat de laatste bruikbare methode niet verwijderd kan worden; geen passkey-lockout (annuleren kan dus nooit blokkeren).

**Ontbrak en is nu gebouwd:**
- `loginPlan()` (`src/lib/mfaMethods.ts`): één bron die bepaalt of er direct passkey, direct TOTP, een keuze, een eerste inschrijving of "niet beschikbaar" (vlag uit + alleen TOTP) volgt. Beide pagina's (`/mfa/passkey`, `/mfa/totp`) gebruiken hem.
- Keuzescherm met de passkey als **aanbevolen** methode ("beschermt tegen phishing") en de authenticator-app met de uitleg "niet bestand tegen phishing".
- **Wisselen zonder nieuwe e-mailcode:** vanaf de passkeyverificatie naar de authenticator-app en omgekeerd (en terug naar het keuzescherm). De links verschijnen alleen als de gebruiker beide methoden werkelijk heeft.
- Passkeyverificatie: geannuleerd, verlopen of mislukt geeft een begrijpelijke melding (geen interne foutteksten), "Opnieuw proberen" en — indien beschikbaar — "Een andere methode gebruiken". Een verlopen inlogsessie (401) toont een duidelijke melding met "Opnieuw inloggen".
- Profiel: overzicht van de ingestelde methoden (aantal passkeys, authenticator-app) met aanbeveling voor een passkey.

**Ongewijzigd:** webmin-login; native app; herstelcodes uitsluitend bij TOTP; vlag uit = bestaand gedrag (passkey direct, TOTP-rij telt niet; alleen-TOTP is "niet beschikbaar", nooit e-mail-only); verplichte MFA per rol en `Session.mfaMethod` blijven uitgesteld.

**Tests:** `tests/loginPlan.test.ts` (3), `e2e/mfaKeuze.spec.ts` (aan: 7, uit: 2) met `E2E_WEB_TOTP=on|off`: alleen passkey, alleen TOTP, beide + wisselen in beide richtingen, passkey mislukt → TOTP, verlopen sessie, geen toegang/geen methode bijzetten met alleen de e-mailcode, profieloverzicht, vlag uit.

## 11. E2.3 – vertrouwde toestellen, mobiele MFA-login en automatische MFA (alle vlaggen standaard UIT)

Uitgangspunten en fasering: `docs/E2-3-ONTWIKKELPLAN.md`; onderzoek en plug-inbeoordeling: `docs/E2-3-TOESTELSLEUTELS-ONDERZOEK.md`.

- **Mobiele MFA-login (`NATIVE_TOTP_LOGIN_ENABLED`, vereist `WEB_TOTP_ENABLED`).** E-mailcode + TOTP-code of herstelcode in de app (`POST /auth/mfa/totp/verify`). De pending-login blijft zonder rechten; sessie pas na een server-side geverifieerde code (replaybescherming, vergrendeling, persistente herstelcodebegrenzing zoals op het web). Herverificatie in de app accepteert voor MFA-gebruikers een TOTP-code. Webmin en accounts zonder bevestigde TOTP: ongewijzigd gedrag. `GET /meta` meldt `nativeTotpLogin`.
- **Vertrouwde toestellen (`TRUSTED_DEVICES_ENABLED`).** Koppelcode (60 bits, alleen hash, 10 min, eenmalig, één lopende per gebruiker) wordt op de website na recente MFA aangemaakt (alleen niet-admin met `mfaEnabled`). Twee publieke stappen zonder app-sessie: `pair/claim` (atomisch eenmalig) en `pair/complete` (ECDSA P-256 publieke sleutel + handtekening over `ringtools-device-registration-v1\n<challenge>\n<installationId>` = bewijs van bezit; max. 3 foute bewijzen per claim; per-IP- en globale poginglimieten; maximaal 5 actieve toestellen; sleutel en installatie-ID uniek, een ingetrokken sleutel is nooit opnieuw te registreren). De code autoriseert uitsluitend een toestelregistratie: geen sessie, geen MFA-goedkeuring. Intrekken in het web met recente MFA (idempotent, atomisch).
  - **Beperkingen:** zonder attestatie kan de server niet bewijzen dat de sleutel in de Secure Enclave/StrongBox/TEE zit; de Android-beperking van ~5 s na gebruikersverificatie is niet gelijkwaardig aan gebruikersverificatie per handtekening.
  - **Een geregistreerd toestel is nog GEEN zelfstandige MFA-methode** en wordt nergens als inlogstap geaccepteerd (`verifyDeviceSignature` is een niet-ontsloten bouwsteen). E2.4 beoordeelt dit opnieuw. Bij een webmin-MFA-reset worden toestellen (nog) niet automatisch ingetrokken; dat is een punt voor E2.4, omdat een toestel nu geen toegangskracht heeft.
- **Automatische MFA (`AUTO_ENABLE_MFA`).** Zodra een gewone gebruiker zijn eerste passkey of authenticator-app bevestigd heeft, wordt `mfaEnabled` gezet — alleen als de gebruiker daarvoor geen bruikbare methode had, niet-admin is, en na een rij-vergrendelde hertelling (`src/lib/autoMfa.ts`). Een mislukte of onvolledige inschrijving activeert niets; bestaande accounts (met methode, ook met MFA bewust uit) worden niet omgezet; een fout laat MFA uit (geen uitsluiting). **Atomair:** de inschrijving/bevestiging (passkey aanmaken; TOTP bevestigen incl. herstelcodes) en het inschakelen gebeuren in één transactie met rijvergrendeling op de gebruiker; het aantal bruikbare methoden vóór de wijziging wordt binnen die transactie geteld, dus gelijktijdige inschrijvingen zijn serieel en precies één telt als eerste. Fouten worden niet onderdrukt: faalt iets, dan rolt alles terug. Herinschrijven (TOTP opnieuw instellen, tweede methode) wijzigt MFA nooit; wie zijn laatste methode had verwijderd en opnieuw begint, telt als eerste methode. **Uitsluitingsbeveiliging:** automatisch inschakelen gebeurt alleen als de app met die methode kan inloggen: TOTP vereist `NATIVE_TOTP_LOGIN_ENABLED`, passkey vereist `NATIVE_PASSKEYS_ENABLED`. Passkey-only gebruikers kunnen nu niet in (de Personal Team-build van) de app inloggen; voor hen blijft MFA dus uit totdat daar een veilige oplossing voor is. **Niet algemeen activeren** voordat inloggen in de app met e-mailcode + TOTP op een echt toestel is bevestigd, anders sluit een bevestigde methode de gebruiker uit de app.
- **Doelbeeld wachtwoordloos** (niet gebouwd): passkeys of een vertrouwde Ringtools-app zonder verplichte SMTP-afhankelijkheid; zie het ontwikkelplan.

**E2.3 – herstelronde na beoordeling eigenaar.**
- *iOS-doelversie:* `@perfood/capacitor-crypto-api` declareert `platforms: [.iOS(.v16)]`; de app en alle plug-ins staan op iOS 15 (alle zes `IPHONEOS_DEPLOYMENT_TARGET`-regels, ook `Debug-PersonalTeam`; `CapApp-SPM/Package.swift` wordt door `cap sync` op `.v15` gegenereerd). De minimale iOS-versie is **niet** verhoogd. In plaats daarvan past `patch-package` (8.0.1, postinstall) twee dingen aan in de plug-in (`mobile/patches/@perfood+capacitor-crypto-api+8.0.0.patch`): `Package.swift` `.v16` → `.v15` (de iOS 16-API's van de plug-in, passkeys, zitten achter `#available(iOS 16.0, *)` en worden door ons niet gebruikt) en het verwijderen van alle logregels. De Secure Enclave-functies die wij gebruiken bestaan sinds iOS 11. Gevolg: dezelfde ondersteunde toestellen als voorheen; **op een toestel met iOS 15 is de koppelflow niet op een echt toestel getest** (alleen compilatie in CI). Als de eigenaar liever iOS 16 als minimum kiest, vervalt de Package.swift-regel van de patch en gaan de zes deployment targets plus de gegenereerde `CapApp-SPM` mee omhoog (iPhone 7 en ouder vallen dan af).
- *Logging van de plug-in:* de plug-in schreef tag, data, handtekeningen en publieke sleutels naar de logs (iOS `print`, Android `Log.i`). Alle logregels zijn met de patch verwijderd (73 regels); de adapter logt niets. Wie de plug-in bijwerkt moet de patch opnieuw beoordelen; `patch-package` faalt bij een niet-passende patch. Dit beperkt logging in de plug-in aantoonbaar in de broncode, maar is niet getest op een echt toestel (logcat/Console).
- *Poginglimiet bij gelijktijdige foute bewijzen:* de teller wordt atomair verhoogd en begrensd (`failedAttempts < 3`), en het verbruiken van de koppeling in de eindtransactie vereist dezelfde voorwaarde.
- *Lokaal opslaan:* de app legt de sleutelverwijzing eerst lokaal vast en rondt daarna pas de serverregistratie af; mislukt opslaan, dan wordt de sleutel verwijderd en ontstaat er geen toestel op de server. Restrisico: gaat de afrondende aanvraag verloren terwijl de server het toestel wel registreerde, dan staat er een onbruikbaar toestel in de lijst; dat kan de gebruiker op de website intrekken en heeft geen toegangskracht (een toestel is geen MFA-methode).
- *Webmin-MFA-reset:* trekt in dezelfde transactie alle actieve vertrouwde toestellen van de gebruiker in en verwijdert openstaande koppelingen.
