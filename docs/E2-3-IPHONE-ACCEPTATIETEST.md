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

---
# E2.4a – aanvullende acceptatietest: inloggen met Face ID (alleen na akkoord van de eigenaar op `docs/E2-4A-BEVEILIGINGSREVIEW.md`)

Voorbereiding: back-up gecontroleerd; in Portainer `NATIVE_DEVICE_LOGIN_ENABLED=true` (naast `TRUSTED_DEVICES_ENABLED=true`); `AUTO_ENABLE_MFA` blijft uit. Nieuwste build op de iPhone (controleer het build-ID onderaan het inlogscherm).

1. Het toestel is gekoppeld (E2.3). Op het inlogscherm staat nog GEEN "Inloggen met Face ID" zolang je niets hebt geactiveerd (controle: een gekoppeld toestel is geen inlogmethode).
2. Log in met e-mailcode + authenticator. Profiel → "Inloggen met Face ID inschakelen" → bevestig je tweede factor als daarom wordt gevraagd → Face ID. Verwacht: "staat aan".
3. Zonder recente tweede factor (wacht 15 min of log in via de toestelroute, zie 5) moet inschakelen opnieuw een verse tweede factor vragen.
4. Log uit. Verwacht: knop "Inloggen met Face ID". Tik erop → Face ID → direct het dashboard, zonder e-mailcode of TOTP.
5. Annuleer de Face ID-prompt: geen sessie, melding "Er is niet ingelogd" met herstelroute. Met toestelcode (indien toegestaan) moet het ook lukken — noteer dit.
6. Na inloggen via Face ID: probeer een gevoelige actie (gebruikersbeheer als ringbeheerder, of een toestel koppelen): moet een verse tweede factor vragen (toestelsessie telt niet als recente MFA).
7. Web: Beveiliging → Vertrouwde toestellen → "Uitzetten" bij wachtwoordloos inloggen: de app-sessie van dit toestel eindigt; de knop in de app geeft een melding. Daarna weer inschakelen.
8. Web: toestel intrekken: idem, en nieuwe aanmelding mislukt met een duidelijke melding en herstelroute. Opnieuw koppelen werkt.
9. App verwijderen en opnieuw installeren (sleutelverlies): "Inloggen met Face ID" ontbreekt of faalt veilig; inloggen met e-mailcode + authenticator en daarna opnieuw koppelen en activeren. Noteer of de oude sleutel in de keychain overleefde.
10. Controleer in de Xcode-console dat er geen challenge-, bericht- of handtekeninggegevens verschijnen.
11. Face ID-appvergrendeling, schermbeveiliging en de bestaande e-mailcode + TOTP-login werken ongewijzigd.

---

# E2.5 – acceptatietest: automatische Face ID-inrichting en vereenvoudigde vergrendeling

Voorbereiding: back-up gecontroleerd; in Portainer `TRUSTED_DEVICES_ENABLED=true`, `NATIVE_DEVICE_LOGIN_ENABLED=true`, `NATIVE_DEVICE_AUTO_ENROLL_ENABLED=true` (plus `WEB_TOTP_ENABLED`/`NATIVE_TOTP_LOGIN_ENABLED` voor inloggen met authenticator-app); `AUTO_ENABLE_MFA` blijft uit. Nieuwste build op de iPhone. Het account heeft MFA aan.

1. Verse installatie (of app verwijderen en opnieuw installeren), niet ingelogd: de app opent **direct het inlogscherm**, zonder Face ID-prompt en zonder vergrendelscherm.
2. Log in met e-mailcode + authenticator. Verwacht: direct na het inloggen een scherm "Inloggen met Face ID instellen". Tik "Instellen" → één Face ID-prompt → bevestiging. Geen koppelcode, geen navigatie naar Profiel.
3. Herhaal 1–2, maar kies "Niet nu" (of annuleer Face ID): je blijft ingelogd, er is niets geregistreerd (web: Beveiliging → Vertrouwde toestellen toont geen nieuw toestel) en de app dringt niet opnieuw aan. Profiel → "Inloggen met Face ID instellen" werkt daarna wel.
4. Zet de app 10 s op de achtergrond en terug: geen prompt. Meer dan 30 s: één Face ID-prompt.
5. Log uit: direct het inlogscherm, **zonder** extra Face ID-prompt. Sluit en open de app: nog steeds direct het inlogscherm (geen vergrendelscherm).
6. Tik "Inloggen met Face ID" op het inlogscherm: precies **één** Face ID-prompt, daarna direct het dashboard. Je wordt daarna niet nogmaals om ontgrendelen gevraagd.
7. Koude start terwijl je ingelogd bent: één Face ID-prompt voor de app, geen inhoud zichtbaar voor ontgrendelen; app-switcher toont het afschermscherm.
8. Intrekken van de sessie op het web terwijl de app open is: de app toont het inlogscherm zonder extra prompt.
9. Tweede account op dezelfde iPhone: log in met een ander account (MFA aan). Verwacht: aanbod vermeldt dat Face ID al is ingesteld voor het account van de eerste gebruiker; zonder bevestiging ("Vervangen en instellen") gebeurt er niets. Na bevestiging is alleen het nieuwe account gekoppeld.
10. Profiel: "Inloggen met Face ID: ingeschakeld" met "Uitschakelen" (vraagt een verse tweede factor); daarna kan het weer worden ingesteld.
11. Een account zonder MFA of het beheerdersaccount krijgt geen aanbod.
12. Xcode-console: geen challenges, berichten of handtekeningen zichtbaar.
