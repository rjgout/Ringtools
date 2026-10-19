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
- [PWA en Web Push](#pwa-en-web-push)
- [Notificatiecentrum](#notificatiecentrum)
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
- **Progressive Web App**: installeerbaar op beginscherm (iPhone/iPad/Android/
  desktop) zonder app store, met automatische updates en een offline-pagina.
  Geen vertrouwelijke data wordt offline gecachet.
- **Web Push**: pushnotificaties (met toestemming, nooit automatisch gevraagd)
  bij de belangrijkste workflow-gebeurtenissen, met algemene, niet-
  vertrouwelijke tekst. Meerdere apparaten per gebruiker. Beheer via
  **Profiel → Pushnotificaties / E-mailmeldingen**.
- **App-badge**: toont (waar ondersteund) het aantal openstaande acties op het
  app-icoon.
- **Notificatiecentrum**: een bel rechtsboven (voor alle ingelogde gebruikers)
  toont ongelezen meldingen voor dezelfde workflow-gebeurtenissen als e-mail/
  push, met een badge die automatisch bijwerkt. Zie
  [Notificatiecentrum](#notificatiecentrum) voor details.

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
- Web App Manifest (`src/app/manifest.ts`) + handgeschreven service worker
  (`public/sw.js`) voor PWA-installatie, auto-update en een offline-fallback.
- Web Push via de `web-push`-library (VAPID), subscriptions in PostgreSQL
  (`PushSubscription`-model) — geen Firebase of andere externe pushdienst.

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
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Nee | Nodig voor Web Push. Leeg laten schakelt pushnotificaties uit; de rest van de app blijft normaal werken. Genereren en bewaren: zie [PWA en Web Push](#pwa-en-web-push). |
| `VAPID_SUBJECT` | Nee (standaard `mailto:beheer@ringapeldoorn.nl`) | Contactadres dat pushdiensten mogen gebruiken bij misbruik, als `mailto:` of `https://` URL. |

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

## PWA en Web Push

### App installeren

Open de applicatie in de browser en ga naar **Profiel**. Daar staat een
installatiehulp die zichzelf aanpast aan het platform en verdwijnt zodra de
app al als PWA draait:

- **iPhone/iPad (Safari)**: toont de stappen om via het deelmenu ("Zet op
  beginscherm") te installeren — iOS biedt geen automatisch installatie-
  venster aan.
- **Android/desktop (Chrome, Edge)**: toont een knop die de browsereigen
  installatie-prompt opent, zodra de browser aangeeft dat dat kan.

Vereisten die al voldaan zijn door deze deployment: een geldig Web App
Manifest, een geregistreerde service worker, en HTTPS (via je reverse
proxy) — zonder HTTPS beschouwen browsers de app niet als installeerbaar
(`localhost` is als uitzondering altijd toegestaan voor lokaal testen).

### VAPID-sleutels genereren (voor Web Push)

```bash
npx web-push generate-vapid-keys
```

Zet de twee uitkomsten als `VAPID_PUBLIC_KEY` en `VAPID_PRIVATE_KEY` in de
Portainer-stack, en `VAPID_SUBJECT` op een `mailto:`-adres. **Genereer deze
sleutels precies één keer** en bewaar ze net zo zorgvuldig als een
wachtwoord: wijzig je ze later, dan werken alle tot dan toe geregistreerde
push-abonnementen niet meer en moet iedereen opnieuw inschakelen via
**Profiel → Pushnotificaties**. Omdat ze als environment variable in de
stack staan (niet in de broncode of image), blijven ze vanzelf behouden bij
het updaten van de container — zorg wel dat je de Portainer-stackconfiguratie
zelf meeneemt in je reguliere back-up.

Laat je `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` leeg, dan toont de app
duidelijk dat pushnotificaties niet geconfigureerd zijn; al het overige
blijft normaal werken.

### Testen op iPhone/iPad

1. Zorg dat de site via HTTPS bereikbaar is (reverse proxy).
2. Installeer Ringtools via **Profiel** op het beginscherm (zie hierboven) —
   dit is op iOS verplicht: Safari zelf ondersteunt geen Web Push, alleen een
   vanaf het beginscherm geopende PWA (vanaf iOS 16.4).
3. Open de geïnstalleerde app (niet Safari) en ga naar **Profiel →
   Pushnotificaties → 🔔 Pushnotificaties inschakelen**.
4. Sta de systeemmelding toe; verstuur daarna een testnotificatie via
   dezelfde pagina.

### Testen op Android

1. Open de site in Chrome (of een andere Chromium-browser).
2. Ga naar **Profiel → Pushnotificaties → 🔔 Pushnotificaties inschakelen**
   (dit werkt ook zonder dat de app als PWA geïnstalleerd is, al raden we
   installeren wel aan voor de volledige ervaring).
3. Sta de systeemmelding toe en verstuur een testnotificatie.

### Probleemoplossing

| Probleem | Mogelijke oorzaak |
|---|---|
| Geen installatieknop op Android/desktop | De browser biedt op dat moment geen `beforeinstallprompt` aan (al geïnstalleerd, of nog niet aan de installatiecriteria voldaan). Gebruik het browsermenu ("App installeren") als alternatief. |
| "Pushnotificaties zijn niet geconfigureerd" | `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` ontbreken in de stack. |
| Geen pushknop zichtbaar op iPhone/iPad | Ringtools is nog niet op het beginscherm geïnstalleerd, of je gebruikt Safari in plaats van de geïnstalleerde app. |
| "Meldingen zijn geblokkeerd" | De systeem- of browsertoestemming staat op geweigerd; dit is alleen in de systeem-/browserinstellingen van het apparaat zelf te herstellen. |
| Pushmelding komt niet aan, geen foutmelding in de app | Controleer de servercontainerlogs; een verlopen abonnement wordt automatisch opgeruimd (zichtbaar doordat het apparaat verdwijnt uit **Profiel → Jouw apparaten**). |
| App laadt oude versie na een update | De service worker ververst zichzelf automatisch zodra de nieuwe versie de controle overneemt; sluit en heropen de app als dit lang duurt. |

## Notificatiecentrum

Naast e-mail en Web Push heeft elke ingelogde gebruiker een **notificatiebel**
rechtsboven in de werkbalk (`src/components/NotificationBell.tsx`), die een
dropdown/bottom sheet opent met de meldingenlijst
(`src/components/NotificationPanel.tsx`).

### Eén centraal proces, geen tweede systeem

Alle 7 workflow-gebeurtenissen (nieuw voorstel, doorgestuurd naar hoge raad,
opnieuw uitnodigen na tegenstem, gepauzeerd door tegenstem, nieuwe taak
toegewezen, toegewezen taak afgerond, herinnering na 30 dagen onverwerkt)
lopen via **één** functie, `notify()` in `src/lib/notifications.ts`, die
vanuit `src/lib/workflow.ts` wordt aangeroepen. Voor elke gebeurtenis doet
`notify()` altijd, in deze volgorde:

1. **Interne melding opslaan** in de database (`Notification`-model) — dit
   gebeurt **altijd**, ook als een gebruiker push en/of e-mail heeft
   uitgeschakeld.
2. **Pushmelding versturen** als de gebruiker dat heeft ingeschakeld én VAPID
   is geconfigureerd.
3. **E-mail versturen** als de gebruiker dat heeft ingeschakeld én er een
   `buildEmail`-callback is meegegeven (niet elke gebeurtenis verstuurt een
   e-mail; magic-link-inlogmails lopen bewust buiten dit systeem en blijven
   altijd verzonden).

Een mislukte push of e-mail (bijvoorbeeld: SMTP nog niet geconfigureerd, of
een verlopen push-abonnement) gooit nooit een fout die de interne melding
alsnog tegenhoudt — die drie stappen zijn bewust onafhankelijk van elkaar.
Er is dus geen los, tweede notificatiesysteem: de bel hergebruikt exact
dezelfde koppelpunten als de bestaande e-mail/push-infrastructuur.

### Lezen, bijwerken en navigeren

- De bel toont een badge met het aantal **ongelezen** meldingen (verdwijnt
  bij 0) en haalt dit lichtgewicht op via `GET /api/notifications/unread-count`.
- Het openen van het paneel haalt de volledige lijst op via
  `GET /api/notifications` (laatste 30, nieuwste eerst) — beide endpoints
  zijn server-side gescoped op de ingelogde gebruiker (`getCurrentUser()`),
  nooit op basis van client-input.
- Een melding **openen** markeert hem meteen als gelezen
  (`markNotificationReadAction`) en navigeert naar de bijbehorende pagina
  (`targetUrl`) — dit voert **nooit** automatisch een stem uit of rondt een
  taak af, dat vereist altijd een expliciete actie van de gebruiker op die
  pagina zelf. Omdat de doelpagina's zelf server-side autorisatie afdwingen,
  kan een meldingslink die rechten nooit omzeilen.
- **"Alles als gelezen markeren"** (`markAllNotificationsReadAction`) werkt
  voor de hele lijst in één keer.
- Beide server actions filteren altijd op `userId: <ingelogde gebruiker>` in
  de Prisma-query, zodat een gebruiker nooit de melding van iemand anders kan
  lezen of als gelezen kan markeren.

### Automatisch bijwerken zonder herladen

De bel pollt elke 20 seconden `GET /api/notifications/unread-count`, maar
**pauzeert** zodra het tabblad niet zichtbaar is (Page Visibility API) om
onnodige databasebelasting te voorkomen. Dit is een bewuste, lichte keuze
die past bij een enkele NAS-instantie — geen WebSockets, Server-Sent Events
of externe realtime-dienst.

### App-badge blijft gescheiden

De bestaande PWA **app-badge** (`navigator.setAppBadge`, het aantal
openstaande acties op het app-icoon) en de **bel-badge** (ongelezen
meldingen) zijn volledig losse tellingen met eigen endpoints
(`/api/badge-count` respectievelijk `/api/notifications/unread-count`) en
updaten onafhankelijk van elkaar.

### Privacy en opruiming

- Meldingen bevatten algemene, niet-vertrouwelijke tekst (zoals de bestaande
  push/e-mailteksten) — geen namen of rollen in de titel/boodschap zelf.
- `Notification` heeft een optionele relatie naar `Calling` met
  `onDelete: Cascade`: zodra een roeping (en de bijbehorende
  persoonsgegevens) na de bestaande 30-dagenverwerkingstermijn automatisch
  wordt verwijderd, worden gekoppelde meldingen mee verwijderd — er blijft
  dus geen persoonsgegeven achter in het notificatiecentrum.
- Meldingen worden nooit door de service worker offline gecachet (de
  bestaande cache-allowlist in `public/sw.js` bevat uitsluitend statische,
  niet-gevoelige assets; `/api/notifications*` valt daarbuiten).

### Database en migratie

Het `Notification`-model (`prisma/schema.prisma`) is toegevoegd via de
migratie `prisma/migrations/20261019050837_notification_center`. Deze
migratie is **uitsluitend additief** (nieuwe `enum`, nieuwe tabel, nieuwe
indexen, nieuwe foreign key) en verwijdert of wijzigt geen bestaande kolommen
of data — veilig toe te passen op een bestaande database zonder dataverlies.
Er zijn geen nieuwe environment variables nodig voor deze functionaliteit.

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
Voor de PWA/pushtests (sectie 31 van de opdracht) geldt hetzelfde: manifest,
service worker, subscribe/unsubscribe, meerdere apparaten, de 7
workflow-gebeurtenissen en het ontbreken van vertrouwelijke data zijn
geautomatiseerd gedekt (`tests/push.test.ts`, `e2e/pwa.spec.ts`); een
daadwerkelijke pushmelding op een fysieke iPhone/Android-toestel is in deze
ontwikkelomgeving niet uit te voeren.

Voor het **notificatiecentrum** zijn alle 14 gevraagde testscenario's
geautomatiseerd gedekt in `tests/notifications.test.ts` (Vitest, tegen een
echte PostgreSQL-database) en `e2e/notifications.spec.ts` (Playwright, echte
browser inclusief een mobiel viewport voor de bottom sheet): opslag van
nieuwe meldingen, scoping op de juiste gebruiker, de bel die het juiste
aantal toont, gelezen-status, "alles als gelezen markeren", navigeren naar de
juiste pagina, server-side autorisatie, geen dubbele meldingen bij
PAUSED/TASK_COMPLETED, werken zonder Web Push, werken zonder
e-mailmeldingen, de bestaande push/e-mailfunctionaliteit die intact blijft,
de app-badge die onafhankelijk van de bel blijft werken, en het niet
achterblijven van persoonsgegevens na het verwijderen van een verwerkte
roeping. Laatste volledige validatieronde in deze ontwikkelomgeving: 54/54
Vitest-tests, 14/14 Playwright-tests, `npx eslint .`, `npx tsc --noEmit`,
`npx prisma validate` en een production build (`npm run build`) allemaal
zonder fouten. Een daadwerkelijke Docker-build/-run op een fysieke Synology
NAS kon in deze ontwikkelomgeving (geen Docker-daemon beschikbaar) niet
worden uitgevoerd — zie het eindrapport voor de precieze afbakening.

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
- Web Push op iOS werkt uitsluitend vanuit de op het beginscherm
  geïnstalleerde app (Apple-beperking vanaf iOS 16.4), niet vanuit Safari
  zelf. De installatiehulp op **Profiel** wijst hier expliciet op.
- Wijzig je de VAPID-sleutels na de eerste configuratie, dan verliezen alle
  al geregistreerde apparaten hun pushabonnement en moet iedereen dit
  opnieuw inschakelen.
- De service worker cachet bewust alleen statische, niet-gevoelige
  bestanden (iconen, build-assets, de offline-pagina). Dat betekent ook dat
  de app zonder internetverbinding geen eerder bekeken roepingen/gegevens
  toont — alleen een duidelijke offline-melding.
