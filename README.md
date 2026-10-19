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
- [Multifactorauthenticatie (MFA)](#multifactorauthenticatie-mfa)
- [Meerdere ringen en ondersteuningsrondes](#meerdere-ringen-en-ondersteuningsrondes)
- [Bijwerken naar een nieuwe versie](#bijwerken-naar-een-nieuwe-versie)
- [Back-up](#back-up)
- [Tests](#tests)
- [Bekende beperkingen](#bekende-beperkingen)

## Functionaliteit

- **Meerdere ringen**: de systeembeheerder (`webmin`) maakt ringen aan; elke
  ring beheert zijn eigen gebruikers via een ringbeheerder. Ringen zijn
  strikt gescheiden. Zie
  [Meerdere ringen en ondersteuningsrondes](#meerdere-ringen-en-ondersteuningsrondes).
- **Rollen**: systeembeheerder (`webmin`) en, per ring, ringpresidium,
  ringsecretaris, ringadministrateur, hoge raad — elk met eigen rechten (zie
  `src/lib/rbac.ts`). Ringbeheerder is een aparte beheerrecht, los van de rol.
- **Inloggen**: reguliere gebruikers loggen in met een magic link per e-mail
  (geen wachtwoord, geen openbare registratiepagina). De systeembeheerder
  logt in met gebruikersnaam/wachtwoord.
- **Multifactorauthenticatie**: verplicht (TOTP) voor de systeembeheerder,
  optioneel en standaard uit voor gebruikers. Wie passkey-verificatie
  inschakelt, bevestigt na de magic link met een passkey (Face ID/Touch ID/Windows Hello/schermpincode);
  de systeembeheerder gebruikt een TOTP-authenticator-app.
  Zie [Multifactorauthenticatie (MFA)](#multifactorauthenticatie-mfa).
- **Roepingen**: aanmaken (naam + functie), met optioneel direct of later toe
  te wijzen verantwoordelijken voor roepen/ondersteunen/aanstellen.
- **Ondersteuningsronde ringpresidium → hoge raad**: automatische
  e-mailuitnodigingen, een reactie "Ondersteunt niet" pauzeert het voorstel
  (met zichtbare uitslag en een "Opnieuw ondersteuning vragen"-knop);
  wanneer iedereen ondersteunt gaat het voorstel automatisch door.
- **Uitvoering**: roepen, ondersteunen (met avondmaalsvergadering/
  ringconferentie) en aanstellen worden onafhankelijk geregistreerd.
- **Verwerken**: na afronding markeren als verwerkt; na 30 dagen wordt de
  roeping (en alle gekoppelde persoonsgegevens/ondersteuningsreacties) automatisch
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
- SMTP-wachtwoord en TOTP-secrets versleuteld (AES-256-GCM, dezelfde sleutel)
  opgeslagen in de database; herstelcodes en WebAuthn-publieke sleutels
  volgens hun eigen aard (respectievelijk alleen gehasht, resp. nooit
  geheim — zie [Multifactorauthenticatie (MFA)](#multifactorauthenticatie-mfa)).
- WebAuthn/FIDO2 via `@simplewebauthn/server`/`@simplewebauthn/browser` voor
  passkeys, TOTP via `otpauth` + `qrcode` — beide self-hosted, geen externe
  identiteits- of MFA-dienst.
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
| `SETTINGS_ENCRYPTION_KEY` | Ja | Lange, willekeurige sleutel voor het versleutelen van het SMTP-wachtwoord én de TOTP-secrets van het adminaccount (bv. `openssl rand -hex 32`). Bewaar deze goed: zonder deze sleutel kunnen noch het SMTP-wachtwoord, noch TOTP opnieuw ontsleuteld worden. |
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
   **Ringen** de eerste ring met een ringbeheerder aan (die daarna zelf de
   overige gebruikers toevoegt).

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
opnieuw ondersteuning gevraagd, gepauzeerd door een negatieve reactie, nieuwe taak
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
  (`targetUrl`) — dit voert **nooit** automatisch een ondersteuningsreactie uit of rondt een
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

## Multifactorauthenticatie (MFA)

Multifactorauthenticatie is **verplicht voor de systeembeheerder** (TOTP) en
**optioneel voor reguliere gebruikers** (passkey, standaard **uit**).

- **Standaard uit voor gebruikers**: de magic link geeft meteen toegang. Een
  gebruiker kan passkey-verificatie zelf inschakelen onder **Profiel →
  Beveiliging** (eerst een passkey registreren, dan *Verificatie
  inschakelen*) en daar ook weer uitschakelen (vereist dan een recente
  passkeybevestiging). Nieuwe en bestaande gebruikers staan na de migratie
  `20261019140000_optional_user_mfa` op *uit*; al geregistreerde passkeys
  blijven bewaard.
- **Zodra verificatie aan staat** bevestigt een magic link alleen de
  identiteit; dat geeft op zichzelf **geen toegang**. Pas na een geslaagde
  passkey krijgt de sessie toegang — bij elke nieuwe login en ongeacht hoe de
  sessie wordt aangesproken (pagina, server action of API-route).
- **Systeembeheerder**: altijd wachtwoord + TOTP, niet uit te schakelen.
- Een admin-reset van de MFA van een gebruiker (verwijdert de passkeys)
  laat de instelling aan staan: de gebruiker moet bij de volgende login
  opnieuw een passkey registreren.

### Hoe het werkt per rol

- **Systeembeheerder (`webmin`)**: gebruikersnaam + wachtwoord, daarna
  verplicht een 6-cijferige TOTP-code (30 seconden geldig) uit een
  standaard authenticator-app (Google Authenticator, Microsoft
  Authenticator, 1Password, enz.). Bij de eerste keer moet een QR-code
  gescand worden; daarna krijgt de beheerder 8 eenmalige herstelcodes te
  zien (precies één keer, bewaar ze veilig) voor als de authenticator-app
  niet beschikbaar is.
- **Reguliere gebruikers met verificatie ingeschakeld**: na het openen van de
  magic link volgt een **passkey** (WebAuthn/FIDO2) — Face ID, Touch ID, Windows Hello of de
  schermvergrendeling/pincode van het apparaat. De eerste keer wordt een
  passkey geregistreerd; daarna wordt bij elke volgende login met dezelfde
  passkey geverifieerd. Gebruikersverificatie (`userVerification: "required"`)
  is verplicht: een passkey zonder biometrie/pincode-bevestiging door het
  apparaat zelf wordt niet geaccepteerd. Reguliere gebruikers krijgen geen
  wachtwoord.

### Sessiemodel: geen toegang zonder afgeronde MFA

Een `Session`-rij krijgt pas een `mfaAt`-tijdstip zodra de tweede factor
geslaagd is; `getSessionUser()` in `src/lib/auth.ts` — de enige plek die
voor de rest van de applicatie (elke pagina, server action en API-route via
`requireUser`/`requireRole`/`getCurrentUser`) bepaalt of iemand toegang
heeft — geeft zonder dat tijdstip altijd `null` terug. Een sessie die enkel
de identiteit bevestigt (vlak na de magic link of het wachtwoord) is dus
sowieso te allen tijde ontoereikend, hoe dan ook benaderd. Die "wacht op
MFA"-sessie is bovendien maar 10 minuten geldig (in plaats van de normale 30
dagen). Bij een geslaagde MFA-verificatie wordt het sessietoken altijd
geroteerd (nieuwe databaserij, nieuw cookie) — zowel bij het inloggen als
bij het later opnieuw verifiëren voor een gevoelige actie.

### Beveiliging → gevoelige acties vereisen een recente verificatie

**Profiel → Beveiliging** toont MFA-status, en laat toe:

- (Systeembeheerder) TOTP opnieuw instellen en nieuwe herstelcodes genereren.
- (Overige rollen) passkeys beheren — toevoegen en verwijderen. De
  **laatste** passkey kan niet verwijderd worden (dat zou inloggen
  onmogelijk maken); eerst een nieuwe registreren.
- Actieve sessies bekijken en losse sessies beëindigen (de huidige sessie
  uitgezonderd — gebruik daarvoor "Uitloggen").

Elke wijziging hier vereist een **recente** (≤ 15 minuten) geslaagde
MFA-verificatie op de huidige sessie; is die verlopen, dan wordt eerst om
een nieuwe TOTP-code/passkeybevestiging gevraagd
(`/profiel/beveiliging/herverifieer`) voordat de wijziging wordt uitgevoerd.

### Admin-reset van de MFA van een gebruiker

Een systeembeheerder kan via **Ringen → (ring)** de MFA van een reguliere
gebruiker resetten (vereist zelf een recente verificatie). Dit verwijdert
direct alle passkeys en actieve sessies van die gebruiker en registreert
wie de reset uitvoerde en wanneer (`SecurityEvent`, type
`MFA_RESET_BY_ADMIN`). Bij de volgende magic link moet de gebruiker opnieuw
een passkey registreren — er is geen enkele weg die na een reset toegang
geeft zonder nieuwe MFA. **Controleer de identiteit van de gebruiker altijd
buiten de applicatie** (telefonisch, persoonlijk) voordat je een reset
uitvoert: dit scherm doet dat niet voor je.

### Noodprocedure: de systeembeheerder is alle factoren kwijt

Als zowel de TOTP-authenticator-app áls alle 8 herstelcodes verloren zijn,
is er bewust **geen** knop in de applicatie en **geen** environment
variable om dit te omzeilen. Herstel vereist directe, beveiligde toegang
tot de server/database:

```bash
# Verbind met de Postgres-container en verwijder de TOTP-inschrijving van
# het adminaccount. De beheerder kan dan weer met gebruikersnaam/wachtwoord
# inloggen en wordt automatisch opnieuw door de TOTP-inschrijving geleid.
psql "$DATABASE_URL" -c "
  DELETE FROM \"TotpCredential\" WHERE \"userId\" = (SELECT id FROM \"User\" WHERE role = 'ADMIN');
  DELETE FROM \"RecoveryCode\"   WHERE \"userId\" = (SELECT id FROM \"User\" WHERE role = 'ADMIN');
"
```

Dit vereist toegang tot de Portainer-stack/NAS zelf — exact de bedoeling:
een MFA-reset van de beheerder zelf mag nooit via de webapplicatie kunnen.

### Beveiligingsmaatregelen (samengevat)

- Alle controles zijn server-side (sessie, rol, eigenaarschap); de
  frontend wordt nergens vertrouwd.
- TOTP-codes zijn na gebruik niet opnieuw inzetbaar (replay-preventie op
  basis van het laatst geaccepteerde tijdvak) en worden na 5 mislukte
  pogingen 15 minuten vergrendeld (persistent, overleeft een herstart).
- WebAuthn-challenges zijn eenmalig en kortlevend; registratie/login
  controleren server-side de challenge, de origin en de RP ID — in
  productie dus uitsluitend `APP_BASE_URL` (`https://ringapeldoorn.nl`).
- Bij deactivering van een gebruiker (**Gebruikers**) worden alle sessies
  direct ingetrokken, zoals al het geval was vóór deze uitbreiding.
- Geen vertrouwelijke MFA-gegevens (secrets, codes) worden gelogd, en de
  service worker cachet nooit `/mfa/*`- of `/api/webauthn/*`-responses
  (dezelfde terughoudende allowlist als voor de rest van de app).
- Pushnotificaties linken altijd naar een pagina die zelf opnieuw
  autorisatie/MFA afdwingt; een pushmelding opent dus nooit meer toegang
  dan een gewone navigatie.

## Meerdere ringen en ondersteuningsrondes

### Ringen en rollen

- Alleen de **systeembeheerder** maakt en beheert ringen (menu **Ringen**).
  Bij het aanmaken kiest of maakt de webmin de **eerste gebruiker** met naam,
  e-mailadres, kerkelijke functie, rol in Ringtools en de verantwoordelijkheid
  als **ringbeheerder**.
- Een **ringbeheerder** voegt gebruikers van de **eigen ring** toe, wijzigt en
  deactiveert ze (menu **Gebruikers**). Een ring heeft altijd minstens één
  actieve ringbeheerder: de laatste kan niet worden gedeactiveerd of
  gedegradeerd (dit wordt in dezelfde databasetransactie afgedwongen).
- **Kerkelijke functie** (vrije tekst, geeft geen rechten), **rol in
  Ringtools** (ringpresidium, ringsecretaris, ringadministrateur, hoge raad)
  en **ringbeheerder** zijn gescheiden. Een ringbeheerder die secretaris of
  administrateur is, doet niet mee aan ondersteuningsrondes.
- Een gebruiker kan in **meerdere ringen** lid zijn met per ring een eigen
  functie en rol; een ringwisselaar bovenaan verschijnt bij meer dan één ring.
- **Tenantisolatie**: voorstellen, ondersteuningsrondes, taken en meldingen
  hebben een `ringId`; elke query en elke autorisatiecontrole gebeurt
  server-side op basis van het (actieve) lidmaatschap. De gekozen ring (cookie)
  wordt altijd tegen de lidmaatschappen gevalideerd.

### Ondersteuningsprocedure

De negenstapsprocedure is ongewijzigd. De terminologie is overal aangepast
(Ondersteuning uitbrengen, Ondersteuningsronde, Ondersteunt / Ondersteunt niet,
Nog niet gereageerd, Opnieuw ondersteuning vragen). Interne tabel- en
functienamen (`Vote`, `castVote`, …) zijn bewust ongewijzigd gebleven; bestaande
data blijft ongewijzigd.

- **Ondersteunt niet** pauzeert het voorstel. Het ringpresidium kan voor die
  persoon op **Opnieuw ondersteuning vragen** klikken; die persoon krijgt een
  nieuwe persoonlijke uitnodiging en kan de eigen reactie wijzigen. Reacties
  van anderen blijven behouden.
- **Handmatige herinneringen**: per ronde ziet het ringpresidium wie
  ondersteunt, wie niet, wie nog niet heeft gereageerd en wanneer voor het
  laatst is uitgenodigd. **Herinnering versturen** (per persoon) en **Iedereen
  herinneren** (alleen wie nog niet reageerde) gebruiken de bestaande
  meldingen-, push- en e-mailinfrastructuur en respecteren de voorkeuren.
  Dubbel versturen wordt voorkomen: per persoon geldt een wachttijd van
  1 uur sinds de laatste uitnodiging/herinnering, atomair afgedwongen.
- **Nieuwe leden tijdens een lopende ronde**: een nieuw (of geactiveerd /
  van rol gewijzigd) ringpresidium- of hogeraadslid wordt automatisch
  toegevoegd aan de onafgeronde rondes van de eigen groep in dezelfde ring,
  krijgt een persoonlijk verzoek en staat op "Nog niet gereageerd". Bestaande
  reacties blijven staan; een ronde rondt pas af als alle betrokkenen positief
  zijn (opnieuw gecontroleerd in dezelfde transactie). Afgeronde rondes
  worden nooit heropend of gewijzigd.
- **Gedeactiveerde of van rol gewijzigde deelnemers** veroorzaken nooit
  stilzwijgend een goedkeuring. De persoon staat nog in de ronde, wordt als
  "niet meer betrokken" gemarkeerd en kan niet meer reageren; het ringpresidium
  beslist expliciet met **Uit ronde verwijderen**.
- **Voorstel verwijderen** (ringpresidium, secretaris, administrateur en
  systeembeheerder, alleen in de eigen ring, zolang het voorstel niet is
  verwerkt): na een bevestigingsdialoog worden voorstel, ondersteuningsreacties,
  deelnemerslijsten, taken en interne meldingen in één transactie verwijderd.
  Accounts en ring blijven bestaan; er volgen geen e-mails of pushmeldingen
  meer en oude persoonlijke links tonen niets vertrouwelijks (404). Verwerkte
  voorstellen vallen onder de bestaande verwijdering na 30 dagen.

### Migratie

De migratie `20261019104633_multi_ring` behoudt alle data:

1. Nieuwe tabellen `Ring` en `RingMembership`; nullable `ringId`-kolommen.
2. Bestaat er data, dan wordt één ring **"Ring Apeldoorn"** aangemaakt; alle
   bestaande gebruikers worden lid met hun huidige rol, en alle bestaande
   voorstellen en meldingen horen bij die ring. Bij een lege database wordt
   geen ring aangemaakt (de webmin maakt de eerste ring).
3. Bestaande ringpresidium-, secretaris- en administrateur-gebruikers worden
   **ringbeheerder** (zij konden voorheen al gebruikers beheren), zodat de ring
   een beheerder heeft.
4. Pas daarna worden de kolommen verplicht gemaakt (`NOT NULL`).

Na het uitrollen: controleer onder **Ringen** (als webmin) of de ring en
ringbeheerders kloppen.

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
npm run test:e2e  # Playwright: inlog-, ring-, ondersteunings- en verwijderflows in een echte browser
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
roeping.

Voor **multifactorauthenticatie** zijn alle 14 gevraagde testscenario's
geautomatiseerd gedekt:

- `tests/mfa.test.ts` (Vitest, tegen een echte PostgreSQL-database): geldige/
  ongeldige/hergebruikte TOTP-codes, lockout na 5 pogingen, herstelcodes
  (eenmalig, nieuwe set maakt oude ongeldig), passkeyregistratie/-login met
  `userVerification: "required"` (de grens met `@simplewebauthn/server`
  gemockt — net als `web-push` elders in de testsuite — zodat de eigen
  opslag/foutafhandeling écht getest wordt, niet de cryptografie van de
  library zelf), een onbekende of bij een andere gebruiker horende passkey
  die altijd wordt afgewezen, een gesimuleerde tellerterugval (mogelijk
  gekloond apparaat), de verplichte MFA-gate op sessieniveau (een sessie
  direct na de magic link/het wachtwoord geeft nog geen toegang), sessie-
  rotatie na promotie, en dat bestaande ondersteunings-/workflowlogica ongewijzigd
  blijft werken.
- `e2e/mfa.spec.ts` (Playwright, een echte browser): een ongeldige TOTP-code
  wordt afgewezen, een magic link zonder passkey-stap geeft geen toegang,
  passkeyregistratie én een latere passkeylogin (via een virtuele WebAuthn-
  authenticator op het CDP-protocol, met echte user-verification-simulatie),
  weigering wanneer de authenticator geen user verification kan garanderen,
  herstelcode-login (eenmalig, een tweede poging wordt geweigerd), een
  API-route die zonder afgeronde MFA 401 teruggeeft, een admin-reset van de
  MFA van een gebruiker (met verplichte nieuwe passkeyregistratie daarna),
  dat een niet-adminrol de resetknop niet eens ziet, en een mobiel viewport
  voor het passkeyscherm. De bestaande `e2e/auth.spec.ts`, `voting.spec.ts`
  en `notifications.spec.ts` zijn bijgewerkt zodat hun logins de nieuwe,
  verplichte MFA-stap doorlopen (TOTP resp. passkey via dezelfde
  CDP-authenticator).

Laatste volledige validatieronde in deze ontwikkelomgeving: 108/108
Vitest-tests (waarvan 34 nieuw voor multi-ring, herinneringen, nieuwe
deelnemers en verwijderen: `tests/rings.test.ts`, `tests/support.test.ts`),
26/26 Playwright-tests (incl. `e2e/rings.spec.ts`), `npx eslint .`, `npx tsc --noEmit`,
`npx prisma validate` en een production build (`npm run build`) allemaal
zonder fouten. Een daadwerkelijke Docker-build/-run op een fysieke Synology
NAS, en een daadwerkelijke passkey-ceremonie op een fysiek iPhone/Android-
toestel (Face ID/Touch ID/Windows Hello) konden in deze ontwikkelomgeving
niet worden uitgevoerd — zie het eindrapport voor de precieze afbakening.

> **Let op bij lokaal herhaald draaien van de Playwright-suite:** het
> adminwachtwoord-login is (bewust, als beveiligingsmaatregel) beperkt tot
> 10 pogingen per 15 minuten per gebruikersnaam (in-memory, per
> containerinstantie). De suite zelf blijft daar ruim onder, maar meerdere
> volledige testruns kort na elkaar tegen **dezelfde draaiende
> containerinstantie** kunnen deze limiet gezamenlijk overschrijden — start
> de applicatie dan opnieuw op (reset het in-memory geheugen) voordat je de
> suite nogmaals draait.

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
- Passkeys vereisen een apparaat/browser met WebAuthn-ondersteuning en een
  platformauthenticator (Face ID, Touch ID, Windows Hello, een
  schermpincode) of een externe security key. Oudere browsers/apparaten
  zonder WebAuthn kunnen geen passkey registreren; de installatiehulp op de
  passkeyschermen wijst hier expliciet op, maar er is geen alternatieve
  (minder veilige) inlogmethode voor reguliere gebruikers.
- Verliest de systeembeheerder zowel de TOTP-authenticator-app als alle 8
  herstelcodes, dan is herstel uitsluitend mogelijk via directe toegang tot
  de server/database (zie de noodprocedure in
  [Multifactorauthenticatie (MFA)](#multifactorauthenticatie-mfa)) —
  bewust geen in-app-noodtoegang.
