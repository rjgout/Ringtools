# E2.3 – Ontwikkelplan: mobiele MFA-login, vertrouwde toestellen en automatische MFA

Status: vastgesteld op basis van de besluiten van de eigenaar na `docs/E2-3-TOESTELSLEUTELS-ONDERZOEK.md`.
Alle nieuwe functies staan **standaard uit** (vlaggen hieronder) en worden niet door ontwikkelaars/agents op productie geactiveerd.

## Vlaggen (allemaal standaard `false`)

| Vlag | Betekenis | Afhankelijkheid |
|---|---|---|
| `NATIVE_TOTP_LOGIN_ENABLED` | Inloggen in de app met e-mailcode + authenticator-app | `WEB_TOTP_ENABLED=true` |
| `TRUSTED_DEVICES_ENABLED` | Toestelregistratie met koppelcode en hardwaregebonden sleutel | – |
| `AUTO_ENABLE_MFA` | MFA automatisch aanzetten na de eerste bevestigde methode | pas aanzetten nadat app-login met MFA op een echt toestel is bevestigd |
| `NATIVE_PASSKEYS_ENABLED` | (bestaand, C5.2) native passkeys | toesteltest; niet mogelijk in Personal Team |

## Fase 1 – Mobiele MFA-login (voorwaarde voor al het andere)

Probleem: een account met `mfaEnabled` kan zich in de app niet aanmelden zolang native passkeys uit staan (`mfa-not-supported`).
Op de Personal Team-iPhone van de eigenaar kunnen native passkeys bovendien technisch niet (geen `webcredentials`-entitlement).

Gekozen tijdelijke oplossing (geen verlaging van beveiliging): **e-mailcode + TOTP-code** (of herstelcode) in de app.
- Pending-login blijft `mfaAt = null`; alleen `/auth/mfa/*` werkt; volledige sessie pas na een server-side geverifieerde TOTP-code in dezelfde sessie.
- Zelfde replaybescherming (`claimTotpStep`), vergrendeling en persistente herstelcodebegrenzing als op het web.
- Herverificatie (`/auth/reauth`) accepteert voor MFA-gebruikers een TOTP-code; een e-mailcode alleen volstaat nooit.
- Webmin-account en gebruikers zonder bevestigde TOTP krijgen het oude gedrag.

Eindbeeld (wachtwoordloos, **niet** in E2.3 gebouwd): passkeys of een vertrouwde Ringtools-app als sterke factor, zonder verplichte
SMTP-afhankelijkheid. De huidige ontwerpen sluiten daarop aan: de `loginPlan`/`methods`-lijst in `PendingLogin` is uitbreidbaar, het
toestelregister (fase 2) bewaart per toestel een publieke sleutel waarmee later een handtekening-challenge als methode kan worden toegevoegd
(E2.4, eigen beoordeling), en inloggen heeft dan geen e-mailcode meer nodig. Pas dan kan de e-mailstap voor MFA-accounts vervallen.

## Fase 2 – Vertrouwde toestellen (optie A: koppelcode)

- Koppelcode wordt op de website aangemaakt, uitsluitend door een niet-admin gebruiker met `mfaEnabled` en **recente MFA**; eenmalig, kort geldig, alleen hash opgeslagen.
- De app hoeft niet ingelogd te zijn; de code autoriseert **alleen** een toestelregistratie (geen sessie, geen MFA-goedkeuring).
- Twee stappen: *claim* (code → registratietoken + challenge) en *complete* (publieke sleutel + handtekening over challenge = bewijs van bezit).
- Handmatige invoer van de code; geen camera/QR.
- Sleutel: ECDSA P-256 in Secure Enclave (iOS) / StrongBox of TEE (Android) via `@perfood/capacitor-crypto-api` 8.0.0 (exact gepind) achter een vervangbare adapter (`mobile/src/lib/deviceKey.ts`).
- Beperkingen (vastgelegd): zonder attestatie kan de server **geen** hardwarebinding bewijzen; het Android-venster van 5 s is niet gelijkwaardig aan gebruikersverificatie per handtekening.
- Een geregistreerd toestel is **geen** zelfstandige MFA-methode (E2.4 beoordeelt opnieuw). Intrekken vereist recente MFA; een ingetrokken sleutel is nooit meer bruikbaar.

## Fase 3 – Automatische MFA (apart, ná fase 1, vóór wijziging van de inschrijvingslogica uitgewerkt)

Wens: MFA gaat vanzelf aan zodra een gebruiker zijn eerste passkey of authenticator-app **bevestigd** heeft.
Ontwerp:
- Alleen in dezelfde databasetransactie als de bevestiging (`confirmTotpEnrollment`, `verifyPasskeyRegistration`); rij-vergrendeling van de gebruiker.
- Alleen voor niet-admin gebruikers die vóór deze bevestiging **geen** bruikbare methode hadden en `mfaEnabled=false`; een onvolledige inschrijving activeert niets.
- Bestaande beveiligde accounts worden niet gewijzigd; bestaande gebruikers worden niet omgezet (alleen een nieuwe eerste bevestiging triggert).
- Atomair: inschrijving, herstelcodes en inschakelen in één transactie met rijvergrendeling; fouten worden niet onderdrukt.
- Uitsluitingsbeveiliging in code: TOTP-first schakelt alleen in met `NATIVE_TOTP_LOGIN_ENABLED`, passkey-first alleen met `NATIVE_PASSKEYS_ENABLED`; passkey-only gebruikers in de Personal Team-app blijven dus zonder automatische MFA.
- Veiligheidsvoorwaarde: de vlag blijft uit totdat inloggen in de app met MFA (fase 1) op een echt toestel is bevestigd, anders sluit een bevestigde methode de gebruiker uit de app.
- Auditgebeurtenis `MFA_VERIFIED`-achtig detail "automatisch ingeschakeld"; gebruikersmelding in de interface.

## Tests

Backend (vitest), mobiel (vitest), Playwright (vlag aan/uit), migratiecontrole op lege én gevulde testdatabase, volledige regressie
(E2.1/E2.2, app-vergrendeling, Face ID/30 s ongewijzigd), alle vier de mobiele CI-jobs.

## Echte iPhone-tests die nodig blijven

Face ID-vergrendeling en schermbescherming; inloggen met e-mailcode + TOTP; sleutelcreatie in de Secure Enclave; koppelflow met code van de website;
sleutelinvalidatie bij wijziging van biometrie; gedrag na herinstallatie (keychain-items kunnen blijven bestaan); beperkingen van de Personal Team-build.
Niet gedaan in deze omgeving: geen fysiek toestel beschikbaar.
