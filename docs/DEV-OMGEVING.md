# Development-omgeving Ringtools (`https://dev.ringapeldoorn.nl`)

Doel: nieuwe functionaliteit eerst op een volledig gescheiden omgeving testen. Productie (`main`, `https://ringapeldoorn.nl`) wijzigt alleen na het uitdrukkelijke akkoord van de eigenaar. Er is **geen automatische deployment**: de eigenaar bepaalt zelf wanneer de dev-container wordt bijgewerkt.

## 1. Branches en proces

| Branch | Doel | Image-tags |
|---|---|---|
| `main` | productie | `ghcr.io/rjgout/ringtools:latest`, `:sha-<kort>` (ongewijzigd; Watchtower op de NAS) |
| `develop` | permanente ontwikkelbranch | `ghcr.io/rjgout/ringtools:develop`, `:develop-<kort>` |
| `feature/*` | nieuwe functionaliteit | geen publicatie (alleen controles in pull requests) |

Werkwijze: `feature/*` → pull request naar `develop` (CI groen) → testen op de dev-omgeving → **alleen na uitdrukkelijk akkoord van de eigenaar** een pull request `develop` → `main`. Een develop-image krijgt nooit de tags `latest` of `sha-…` (de workflow controleert dat en faalt anders), dus kan nooit een productie-image overschrijven.

## 2. GitHub Actions

- **`docker-publish.yml`** – pull request (naar `main`/`develop`): typecontrole, vitest, volledige Docker-build + doorlichting, géén publicatie. Push naar `main`: ongewijzigd (tests, build, doorlichting, publiceren als `latest` + `sha-<kort>`). Push naar `develop`: tests, build, doorlichting, **Playwright (`e2e.yml`)** en pas daarna publiceren als `develop` + `develop-<kort>`. Nergens een deployment.
- **`e2e.yml`** – Playwright tegen een echte `next start` + gebundelde webclient + Postgres-testdatabase (`…_e2e`), in vijf legs: alle vlaggen uit, web-TOTP + vertrouwde toestellen aan, toestelinlog aan, toestelinrichting aan, en de gebundelde app-client (Bearer) tegen de server. Draait op pull requests en op `main`/`develop`.
- **`mobile-ci.yml`** – ongewijzigd (client, backend, Android debug-build, iOS simulator-build) plus een Android-controle dat de dev-variant bouwt met `nl.ringapeldoorn.ringtools.dev` en `dev.ringapeldoorn.nl`.
- **`ios-testflight-dev.yml`** / **`mobile-release-dev.yml`** – handmatige workflows voor de dev-apps (zie §7). Er wordt niets gepubliceerd zonder dat de eigenaar de workflow zelf start en (iOS) de uploadoptie aanvinkt.

## 3. Image

`ghcr.io/rjgout/ringtools:develop` (zelfde repository als productie; `linux/amd64`). Controleer in GitHub → Packages → ringtools dat de tag `develop` bestaat na de eerste groene push naar `develop`. Staat het pakket op *private*, geef de NAS dan leestoegang (Portainer → Registries → GitHub Container Registry met een persoonlijk token met alleen `read:packages`).

## 4. Volledig gescheiden omgeving

De stack `ringtools-dev` gebruikt eigen: database (`ringtools_dev_db`-volume, database `ringtools_dev`), `SETTINGS_ENCRYPTION_KEY` (sessie-/TOTP-/SMTP-geheimen worden daarmee versleuteld), webmin-wachtwoord, SMTP-instellingen (door webmin in de dev-database in te stellen), VAPID-/APNs-/FCM-sleutels, link-instellingen en accounts. De app slaat geen bestanden op in een bestandssysteem (alles zit in de database); er is dus geen aparte bestandsopslag nodig. **Kopieer geen productiegegevens** en gebruik geen productiewachtwoorden of -sleutels. Een dev-database en productie delen niets: sessies en tokens uit de ene omgeving werken niet in de andere.

### Bescherming tegen echte e-mails/meldingen

`APP_ENVIRONMENT=development` (staat vast in `docker-compose.dev.yml`) schakelt in de code (`src/lib/devGuard.ts`) in:
- **Uitgaande e-mail** (inlogcodes, uitnodigingen, meldingen, verwijderverzoeken) gaat uitsluitend naar adressen of domeinen in **`DEV_MAIL_ALLOWLIST`** (bijv. `tester@example.nl,@testdomein.nl`). Is de lijst leeg, dan verlaat er **niets** de omgeving. Een mail naar meerdere ontvangers gaat alleen uit als alle ontvangers zijn toegestaan.
- **Pushmeldingen** (web en native) gaan alleen naar accounts waarvan het e-mailadres op die lijst staat.
- Pagina's krijgen `X-Robots-Tag: noindex`; `/api/mobile/v1/meta` meldt `environment: "development"`; de dev-app toont "Ontwikkelomgeving" op het inlogscherm.

Voeg dus eerst je testers toe aan `DEV_MAIL_ALLOWLIST` voordat je ze uitnodigt. Dit is een software-vangnet: stel in de dev-SMTP-instellingen bij voorkeur een brievenbus in die alleen testers ontvangt.

### Toegang

Toegang tot dev loopt via de bestaande aanmelding (uitnodiging of bestaand dev-account, e-mailcode, MFA, biometrie). Account aanmaken kan alleen via webmin/uitnodiging. Zet **geen** HTTP-basisauthenticatie of IP-blokkade op `/api/`, `/.well-known/`, `/auth/`, `/open/`, `/uitnodiging/`, `/roepingen/` en `/app`: de mobiele apps, Universal Links/App Links en e-maillinks hebben die nodig. Extra afscherming op de reverse proxy (bijv. alleen jouw netwerk) is dus alleen veilig voor de pagina's die geen app-, link- of e-mailverkeer bedienen; de werkelijke bescherming is de verplichte authenticatie plus de ontvangersbeperking hierboven.

## 5. Docker Compose en variabelen

Bestand: **`docker-compose.dev.yml`** (plakken in Portainer, stacknaam `ringtools-dev`). Voorbeeld van de variabelen: **`.env.dev.example`**. Vul de waarden alleen in Portainer in.

| Variabele | Verplicht | Uitleg |
|---|---|---|
| `DEV_POSTGRES_PASSWORD` | ja | nieuw, lang, willekeurig; niet gelijk aan productie |
| `DEV_BOOTSTRAP_ADMIN_PASSWORD` | ja | wachtwoord van het webmin-account van dev (daarna verplicht TOTP-inschrijving bij eerste aanmelding) |
| `DEV_SETTINGS_ENCRYPTION_KEY` | ja | nieuwe sleutel (bijv. `openssl rand -base64 32`); niet wijzigen na eerste gebruik zonder de dev-database te resetten |
| `DEV_MAIL_ALLOWLIST` | aanbevolen | toegestane testadressen/-domeinen; leeg = geen e-mail/push |
| `DEV_APP_BASE_URL` | nee | standaard `https://dev.ringapeldoorn.nl` (moet exact de publieke URL zijn: cookies, Origin-controle, links) |
| `DEV_HTTP_PORT` | nee | hostpoort op de NAS, standaard `2819` (productie gebruikt 2809) |
| `DEV_POSTGRES_USER`, `DEV_POSTGRES_DB` | nee | standaard `ringtools_dev` |
| `DEV_BOOTSTRAP_ADMIN_USERNAME` | nee | standaard `webmin` |
| `DEV_COOKIE_SECURE` | nee | standaard `true` (houd `true` achter HTTPS) |
| `DEV_VAPID_PUBLIC_KEY`, `DEV_VAPID_PRIVATE_KEY`, `DEV_VAPID_SUBJECT` | nee | eigen webpush-sleutels (`npx web-push generate-vapid-keys`); leeg = uit |
| `DEV_APNS_KEY_P8` (of `…_FILE`), `DEV_APNS_KEY_ID`, `DEV_APNS_TEAM_ID`, `DEV_APNS_BUNDLE_ID`, `DEV_APNS_PRODUCTION` | nee | native push voor de iOS-dev-app; bundle-ID `nl.ringapeldoorn.ringtools.dev`; `true` voor TestFlight |
| `DEV_FCM_SERVICE_ACCOUNT_JSON` (of `…_FILE`) | nee | native push voor de Android-dev-app (eigen Firebase-project) |
| `DEV_APPLE_APP_ID` | voor Universal Links | `<Team-ID>.nl.ringapeldoorn.ringtools.dev` |
| `DEV_ANDROID_PACKAGE`, `DEV_ANDROID_SHA256_FINGERPRINTS` | voor App Links | `nl.ringapeldoorn.ringtools.dev` en de signing-vingerafdruk van de dev-app |
| `DEV_WEB_TOTP_ENABLED`, `DEV_NATIVE_TOTP_LOGIN_ENABLED`, `DEV_TRUSTED_DEVICES_ENABLED`, `DEV_NATIVE_DEVICE_LOGIN_ENABLED`, `DEV_NATIVE_DEVICE_AUTO_ENROLL_ENABLED`, `DEV_NATIVE_PASSKEYS_ENABLED`, `DEV_AUTO_ENABLE_MFA` | nee | functievlaggen, standaard `false` zoals productie; hier mag je ze bewust aanzetten om te testen |

## 6. Reverse proxy (`dev.ringapeldoorn.nl` → NAS)

- Doel: `http://<NAS-IP>:2819` (of de waarde van `DEV_HTTP_PORT`), HTTPS-certificaat voor `dev.ringapeldoorn.nl`.
- Stuur door: `Host` (origineel), `X-Forwarded-For`, `X-Forwarded-Proto: https`, `X-Forwarded-Host`. De app controleert `Origin` exact op `DEV_APP_BASE_URL`; de proxy mag `Origin`/`Sec-Fetch-Site` niet aanpassen of verwijderen.
- Geen WebSocket nodig. Time-outs ≥ 60 s (SMTP-verzending kan tot ~45 s duren). Request-body ≥ 1 MB is ruim voldoende.
- **Niet cachen** (geen proxycache voor `/api/`, `/app`, `/login`, `/auth/`); de app zet zelf `Cache-Control: no-store` waar nodig.
- HTTPS verplicht, HSTS aanbevolen. Sta `/.well-known/apple-app-site-association` en `/.well-known/assetlinks.json` zonder redirect en zonder authenticatie toe (Apple/Google halen die op; `Content-Type` laat de app zetten).
- DNS: A/AAAA/CNAME voor `dev.ringapeldoorn.nl` naar dezelfde NAS; het certificaat moet de dev-hostnaam dekken. Productie blijft ongewijzigd.

## 7. Mobiele development-apps

Eén codebase, een **variant** (`mobile/variants/dev.json`) die in CI de native projecten in de werkkopie aanpast; de productieconfiguratie in Git verandert niet.

| | iOS | Android |
|---|---|---|
| Naam | Ringtools Dev | Ringtools Dev |
| ID | `nl.ringapeldoorn.ringtools.dev` | `nl.ringapeldoorn.ringtools.dev` (application-ID; namespace onveranderd) |
| Backend | `https://dev.ringapeldoorn.nl` | idem |
| Links | `applinks:` en `webcredentials:dev.ringapeldoorn.nl` | App Links met host `dev.ringapeldoorn.nl` |
| Push | eigen APNs-sleutel/-topic (`DEV_APNS_*`) | eigen Firebase-project (`DEV_FCM_*`, `google-services.json` van dat project) |
| Distributie | TestFlight via `ios-testflight-dev.yml` | interne testtrack in de Play Console via `mobile-release-dev.yml` (AAB-artifact) |

Eenmalige stappen door de eigenaar (niet door deze repository te doen): app-record voor `nl.ringapeldoorn.ringtools.dev` in App Store Connect (en de capabilities Push + Associated Domains op dat App-ID in het Apple-developerportaal); Firebase-project/app voor de dev-package met eigen `google-services.json`; eigen upload-keystore of dezelfde `mobile-release`-secrets; interne testtrack-app voor het dev-package in de Play Console. GitHub-secrets: dezelfde als bij productie (`testflight`-omgeving) plus optioneel `DEV_GOOGLE_SERVICES_JSON_BASE64` (omgeving `mobile-release`).

Starten iOS: zie `docs/IOS-DEV-TESTFLIGHT.md` (tag `ios-dev-check|build|upload-<versie>-<build>` op een commit op `develop`; handmatige signing met het bestaande Apple Distribution-certificaat; **upload alleen met `ios-dev-upload-…`**). Android: GitHub → Actions → *Android – Ringtools Dev* (typ `dev`). Er wordt niets gepubliceerd zonder dat jij het doet.

## 8. Portainer: stack installeren en handmatig bijwerken

1. Portainer → *Stacks* → *Add stack* → naam **`ringtools-dev`** → *Web editor* → plak `docker-compose.dev.yml` (of *Repository*: `rjgout/Ringtools`, branch `develop`, bestand `docker-compose.dev.yml`; zonder auto-update).
2. *Environment variables* → *Advanced mode* → plak de regels uit `.env.dev.example` en vul de verplichte waarden in (nieuwe wachtwoorden/sleutels).
3. *Deploy the stack*. De app voert bij het starten zelf de databasemigraties uit en maakt het webmin-account aan. Controleer `https://dev.ringapeldoorn.nl/api/health`.
4. Meld je aan op `https://dev.ringapeldoorn.nl/login` → *Beheerder* met `webmin` en het dev-wachtwoord; schrijf TOTP in. Stel SMTP in (webmin → Instellingen → E-mail) en maak de dev-ring en testaccounts aan.
5. **Bijwerken (handmatig)**: Portainer → Stacks → `ringtools-dev` → *Update the stack* → zet *Re-pull image and redeploy* aan → *Update*. (Of: Containers → `ringtools-dev-app-1` → *Recreate* met *Pull latest image*.) De database en het volume blijven behouden. Er is geen Watchtower/automatische update voor deze stack (label `enable=false`).
6. **Terugzetten**: kies een eerdere tag in het compose-bestand (bijv. `ghcr.io/rjgout/ringtools:develop-<kort>`) en update de stack. Migraties zijn additief; draai bij twijfel eerst een databaseback-up (`docs/BACKUP-HERSTEL.md`, gebruik de dev-database).
7. **Dev-database resetten**: stack stoppen, volume `ringtools_dev_db` verwijderen, stack starten. Raakt productie niet.

## 9. Eenmalige acties voor de eigenaar op GitHub

- *Settings → Branches*: bescherm `develop` (CI-checks `build-and-push`, `Client en native configuratie`, `Mobiele backend…` verplicht) en laat `main` beschermd/ongewijzigd.
- Controleer dat Actions schrijfrechten voor *Packages* heeft (nodig voor `ghcr.io`).
