# E2.3 – acceptatietest op een echte iPhone (vóór activering in Portainer)

Vereisten: iPhone met iOS 18 of nieuwer, schermvergrendeling en Face ID/Touch ID ingesteld, Mac met Xcode, build `App-PersonalTeam` (zie `docs/MOBILE.md`, gratis Personal Team; geen nieuwe entitlements). Een simulator bewijst de Secure Enclave **niet**.

**Omgeving:** er is geen aparte testserver; `main` op de Synology NAS (Watchtower) is de enige omgeving. Voor je begint: (1) maak een databaseback-up en controleer die (`docs/BACKUP-HERSTEL.md`); (2) zet in Portainer alleen `WEB_TOTP_ENABLED=true`, `NATIVE_TOTP_LOGIN_ENABLED=true` en `TRUSTED_DEVICES_ENABLED=true` (de eigenaar doet dit zelf; de Watchtower-configuratie blijft ongewijzigd); `AUTO_ENABLE_MFA` blijft `false` totdat sectie C op de echte iPhone is bevestigd. Test met je eigen account; er worden geen automatische tests op de productiedatabase gedraaid. Terugdraaien = vlaggen weer op `false`.

## A. Voorbereiding
1. Installeer `App-PersonalTeam` via Xcode op de iPhone (`npm run cap:sync`, open `mobile/ios`, kies scheme `App-PersonalTeam`).
2. Web (laptop): log in als gewone gebruiker (niet webmin), stel onder Beveiliging een authenticator-app in, bewaar de herstelcodes, schakel verificatie in.

## A2. Controleer eerst welke bundel en welke server de app gebruikt
Onderaan het inlogscherm staat "Versie … · build <commit> · server <host>". Controleer dat de build overeenkomt met de gewenste commit (`git rev-parse --short HEAD` in je checkout) en de server met jouw NAS (`VITE_API_URL` in `mobile/.env`, anders is de standaard `https://ringapeldoorn.nl`). Een oude bundel toont de oude tekst en geen koppelknop. Na elke wijziging: `cd mobile && npm run build && npx cap sync ios` (of `npm run cap:sync`), daarna opnieuw bouwen in Xcode (Product → Clean Build Folder bij twijfel). De inlogopties ("Inlogopties worden opgehaald…") verschijnen na een paar seconden; lukt dat niet, dan staat er "Opnieuw proberen".

## B. Appvergrendeling (regressie)
3. Start de app: Face ID wordt gevraagd vóór enig scherm. App naar de achtergrond < 30 s en terug: geen prompt; > 30 s: opnieuw prompt. App-switcher toont een afgeschermd beeld.

## C. Inloggen met e-mailcode + TOTP
4. Log uit. Vul e-mailadres in, ontvang de code, vul in. **Verwacht:** een stap "Code uit je authenticator-app". Fout code → melding; juiste code → ingelogd.
5. Herhaal met een herstelcode (eenmalig; tweede keer dezelfde code moet falen).
6. Account met alleen een passkey: **verwacht** de melding dat inloggen in de app nog niet kan (geen verlaging van beveiliging).
7. Tijdens inloggen niet-herhaalbare codes: dezelfde TOTP-code binnen dezelfde 30 s een tweede keer wordt geweigerd.

## D. Toestel koppelen (Secure Enclave)
8. Web: Beveiliging → Vertrouwde toestellen → "Nieuw toestel koppelen". Code (XXXX-XXXX-XXXX, 10 min geldig) verschijnt.
9. App (uitgelogd mag): inlogscherm → "Toestel koppelen met een code" → code intikken. **Verwacht:** Face ID/toestelcode-prompt, daarna "gekoppeld". Web toont het toestel (na verversen).
10. Dezelfde code nogmaals proberen: **verwacht** foutmelding. Een verlopen code (> 10 min) idem.
11. Mislukte koppeling (annuleer de Face ID-prompt): **verwacht** generieke melding en géén toestel op het web.
12. Web: toestel intrekken (vraagt recente verificatie). Daarna dezelfde sleutel kan nooit opnieuw; een nieuwe koppeling met nieuwe code werkt wel.
13. Een gekoppeld toestel geeft **geen** toegang: uitloggen en inloggen vraagt nog steeds e-mailcode + TOTP.

## E. Sleutelgedrag (informatief; noteer de uitkomst)
14. Voeg een vingerafdruk/gezicht toe of wijzig biometrie: werkt ondertekenen daarna nog? (Sleutels met biometrie kunnen ongeldig worden.)
15. Verwijder de app en installeer opnieuw: blijft de sleutel in de keychain? (De app maakt bij elke koppeling een nieuwe sleutel; een oud toestel blijft in de weblijst tot intrekken.)
16. Controleer in Xcode → Devices → console dat tijdens stap 9 geen sleutel-, handtekening- of berichtgegevens van de plug-in verschijnen.

## F. Niet te testen / bekend
- Server kan zonder attestatie de hardwarebinding niet bewijzen; Android-venster ~5 s.
- Automatische MFA (`AUTO_ENABLE_MFA`) pas na slagen van sectie C testen: dan op een nieuw testaccount de eerste authenticator-app bevestigen → MFA gaat aan; met een tweede methode of bestaand account verandert niets.
- Passkey-only accounts in de Personal Team-app: nog geen aanmeldroute (openstaand).
