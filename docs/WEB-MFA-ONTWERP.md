# Ontwerp: MFA-keuze voor webgebruikers (fase E2 – E2.1 gebouwd achter vlag UIT; rest nog NIET gebouwd)

> **Status (bijgewerkt na E2.1):**
> - **E2.1 is gebouwd op de ontwikkelbranch, achter de functievlag `WEB_TOTP_ENABLED` (standaard UIT, niet geactiveerd, niet op main).** Beschrijving en beveiligingskeuzes: zie §9 onderaan.
> - **E2.2 t/m E2.5 (passkey als keuzemethode in een nieuw keuzescherm, vertrouwd toestel, number matching, beleid zoals verplichte MFA per rol) zijn alleen ontwerp.** Number matching is niet gebouwd en wordt niet als WebAuthn-equivalent gepresenteerd.
> - Zonder de vlag is het gedrag ongewijzigd: gewone gebruikers kennen alleen optionele passkey-verificatie; webmin = wachtwoord + verplichte TOTP; e-mailcode blijft eerste factor.

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
