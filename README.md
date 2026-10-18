# Ringtools

Webapplicatie voor het beheer van roepingen en ondersteuningsprocedures van
**Ring Apeldoorn** (De Kerk van Jezus Christus van de Heiligen der Laatste
Dagen). Volledig self-hosted: geen externe diensten, geen betaalde API's.

## Inhoudsopgave

- [Functionaliteit](#functionaliteit)
- [Techniek](#techniek)
- [Environment variables](#environment-variables)
- [Lokaal draaien](#lokaal-draaien-ontwikkeling)
- [Installeren op de Synology NAS via Portainer](#installeren-op-de-synology-nas-via-portainer)
- [Bijwerken naar een nieuwe versie](#bijwerken-naar-een-nieuwe-versie)
- [Back-up](#back-up)
- [Tests](#tests)
- [Bekende beperkingen](#bekende-beperkingen)

## Functionaliteit

- **Rollen**: systeembeheerder (`webmin`), ringpresidium, ringsecretaris,
  ringadministrateur, hoge raad — elk met eigen rechten (zie `src/lib/rbac.ts`).
- **Inloggen**: reguliere gebruikers loggen in met een magic link per e-mail
  (geen wachtwoord, geen openbare registratiepagina). De systeembeheerder
  logt in met gebruikersnaam/wachtwoord.
- **Roepingen**: aanmaken (naam + functie), met optioneel direct of later toe
  te wijzen verantwoordelijken voor roepen/ondersteunen/aanstellen.
- **Stemming ringpresidium → hoge raad**: automatische e-mailuitnodigingen,
  een tegenstem pauzeert het voorstel (met zichtbare uitslag en een
  "opnieuw uitnodigen"-knop), unanimiteit schakelt automatisch door.
- **Uitvoering**: roepen, ondersteunen (met avondmaalsvergadering/
  ringconferentie) en aanstellen worden onafhankelijk geregistreerd.
- **Verwerken**: na afronding markeren als verwerkt; na 30 dagen wordt de
  roeping (en alle gekoppelde persoonsgegevens/stemmen) automatisch
  verwijderd. Een onverwerkte roeping krijgt na 30 dagen sinds aanmaken een
  eenmalige herinnering per e-mail naar het ringpresidium.
- **Instellingen**: SMTP-configuratie (versleuteld opgeslagen wachtwoord) met
  testmail-knop, uitsluitend voor de systeembeheerder.
- **WhatsApp**: een deelknop met een algemeen bericht (geen namen of
  persoonlijke links) via de deelmogelijkheden van het apparaat, met een
  kopieer-fallback.
- **Ontwerp**: mobile-first, "Liquid Glass"-geïnspireerd, licht/donker.

## Techniek

- Next.js 16 (App Router) + TypeScript + React 19 + Tailwind CSS 4.
- PostgreSQL + Prisma 6 (migraties worden bij het opstarten van de container
  automatisch toegepast).
- Server Actions voor alle schrijfacties (server-side autorisatie op elke
  actie, geen vertrouwen op de frontend).
- Achtergrondtaken (herinneringen/opruiming) draaien in-process via
  `node-cron`, lezen hun werk telkens uit de database en overleven dus een
  herstart van de container zonder dubbele e-mails.
- SMTP-wachtwoord versleuteld (AES-256-GCM) opgeslagen in de database.

## Environment variables

| Variabele | Verplicht | Omschrijving |
|---|---|---|
| `DATABASE_URL` | Ja | PostgreSQL-connectiestring. |
| `APP_BASE_URL` | Ja | Basis-URL waarmee e-maillinks worden opgebouwd (bv. `https://ringapeldoorn.nl`). |
| `BOOTSTRAP_ADMIN_USERNAME` | Nee (standaard `webmin`) | Gebruikersnaam van het admin-account, alleen gebruikt bij de allereerste start. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Ja (bij eerste start) | Wachtwoord van het admin-account bij aanmaak. Een later gewijzigd wachtwoord wordt bij herstart **nooit** overschreven. |
| `SETTINGS_ENCRYPTION_KEY` | Ja | Lange, willekeurige sleutel voor het versleutelen van het SMTP-wachtwoord (bv. `openssl rand -hex 32`). Bewaar deze goed. |
| `COOKIE_SECURE` | Nee (standaard `true`) | Zet op `false` als je zonder HTTPS test. |
| `PORT` | Nee (standaard `2809`) | Poort waarop de applicatie luistert. |

SMTP-gegevens worden **niet** via environment variables ingesteld, maar via
**Instellingen → E-mail** in de applicatie zelf (zie sectie hieronder),
zodat ze nergens in de broncode of Docker-image terechtkomen.

## Lokaal draaien (ontwikkeling)

```bash
cp .env.example .env   # pas DATABASE_URL etc. aan naar een lokale Postgres
npm install
npx prisma migrate dev
npm run dev
```

## Installeren op de Synology NAS via Portainer

### Stap 1 — GitHub Container Registry

Deze repository bevat een GitHub Actions-workflow
(`.github/workflows/docker-publish.yml`) die bij elke push naar `main`
automatisch een image bouwt, test en publiceert naar **GitHub Container
Registry** (`ghcr.io/<owner>/ringtools`). Zo hoeft Portainer/Docker op de NAS
zelf nooit te bouwen — dat voorkomt problemen die sommige Synology
Container Manager-versies hebben met multi-stage builds in Portainer-stacks.

Maak het package publiek (of regel registrytoegang) via **GitHub → je
profiel → Packages → ringtools → Package settings**, zodat de NAS de image
zonder inloggegevens kan pullen. Wil je het package privé houden, log dan op
de NAS eenmalig in met `docker login ghcr.io` met een Personal Access Token
dat `read:packages`-rechten heeft.

### Stap 2 — domein/HTTPS (reverse proxy)

De applicatie draait zelf zonder HTTPS; je regelt dit zelf extern (zoals
gevraagd). Richt in DSM een reverse proxy in die bijvoorbeeld
`https://ringapeldoorn.nl` doorstuurt naar `http://<NAS-IP>:2809`, met een
Let's Encrypt-certificaat.

### Stap 3 — map op de NAS (voor de database)

Maak in File Station een map aan voor de Postgres-data, bijvoorbeeld
`docker/ringtools/db`. Dat is de enige map die je zelf moet aanmaken; de
applicatie zelf heeft geen bestandsopslag nodig.

### Stap 4 — stack aanmaken in Portainer

1. **Stacks → Add stack**, naam bijvoorbeeld `ringtools`.
2. Kies **Repository** en vul de git-URL van deze repository in (branch
   `main`), of gebruik **Web editor** en plak de inhoud van
   `docker-compose.yml`.
3. Pas in `docker-compose.yml` het volume-pad van de `db`-service aan naar de
   map uit stap 3 als je liever een zichtbare NAS-map gebruikt in plaats van
   een Docker-volume (standaard gebruikt dit bestand een beheerd volume,
   `ringtools_db`, wat ook prima werkt en niet per se een eigen map vereist).
4. Vul de environment variables in (zie tabel hierboven):
   - `APP_BASE_URL`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`,
     `SETTINGS_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`.
5. **Deploy the stack**. Bij de eerste start worden de databasemigraties
   automatisch toegepast en wordt het admin-account aangemaakt.
6. Open `http://<NAS-IP>:2809` (of je domein) en log in met het admin-account.
   Stel daarna via **Instellingen → E-mail** de SMTP-gegevens in (nodig voor
   magic-link-logins en alle automatische e-mails) en maak via
   **Gebruikers** de eerste accounts aan.

## Bijwerken naar een nieuwe versie

Push naar `main` → GitHub Actions bouwt en publiceert automatisch een nieuwe
`ghcr.io`-image. Ga in Portainer naar de stack → **Pull and redeploy image**.
Migraties worden bij het herstarten automatisch toegepast; de database blijft
behouden.

## Back-up

Neem het Postgres-volume (`ringtools_db`, of de NAS-map als je daarvoor
gekozen hebt) mee in je Synology Hyper Backup-taak. Dat is de enige
persistente opslag van de applicatie.

## Tests

```bash
npm test        # Vitest: kritieke workflow-, autorisatie- en authenticatielogica
                 # (draait tegen een echte PostgreSQL-database)
npm run test:e2e  # Playwright: inlog-, gebruikersbeheer- en stem-flows in een echte browser
npx tsc --noEmit  # TypeScript-build
npx eslint .      # Linting
```

Zie het testrapport dat bij de implementatie is opgeleverd voor een overzicht
van welke van de 25 gevraagde testscenario's geautomatiseerd zijn gedekt en
welke (zoals het daadwerkelijk ontvangen van e-mail, of een Docker-build op
een echte Synology) niet in deze ontwikkelomgeving konden worden uitgevoerd.

## Bekende beperkingen

- De achtergrondtaken (herinneringen/opruiming, magic links, sessies) gaan
  uit van **één draaiende instantie** van de applicatie. Dat past bij een
  enkele NAS-deployment; schaal dit niet horizontaal zonder de in-memory
  rate limiter en cron-scheduler te vervangen door een gedeelde variant.
- Er is geen "wachtwoord vergeten"-herstel voor het admin-account buiten het
  wijzigen van `BOOTSTRAP_ADMIN_PASSWORD` vóór de allereerste start. Is het
  wachtwoord na de eerste start vergeten, dan is handmatige toegang tot de
  database nodig om het opnieuw te zetten.
- Twee dependency-advisories (`braces` via `eslint-config-next`,
  `deepmerge-ts` via `@prisma/config`) staan nog open in `npm audit`: dit zijn
  uitsluitend build-/CLI-tooling-afhankelijkheden (niet meegeleverd in de
  runtime-container) zonder niet-risicovolle oplossing die compatibel blijft
  met de huidige Next.js/Prisma-versies.
